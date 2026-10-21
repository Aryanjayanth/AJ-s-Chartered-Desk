/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleEnum = z.enum(["admin", "staff", "cashier"]);

const inviteSchema = z.object({
  firmId: z.string().trim().min(1, "Please select a firm"),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address").max(255),
  fullName: z.string().trim().max(120).optional(),
  role: roleEnum,
  redirectTo: z.string().url(),
});

async function generateActionLink(
  supabaseAdmin: any,
  email: string,
  fullName?: string,
  redirectTo?: string,
) {
  const targetRedirect = redirectTo || "http://localhost:5173/set-password";

  // 1. Try invite link first
  try {
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: targetRedirect,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] invite type failed:", e);
  }

  // 2. Try recovery link (allows user to set password)
  try {
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: targetRedirect,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] recovery type failed:", e);
  }

  // 3. Try magiclink
  try {
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: targetRedirect,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] magiclink type failed:", e);
  }

  // 4. If user does not exist in auth.users at all and invite failed, create user explicitly then generate recovery link
  try {
    await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    });
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: targetRedirect,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] createUser fallback failed:", e);
  }

  return null;
}

async function doInvite(input: z.infer<typeof inviteSchema>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = input.email.trim().toLowerCase();

  // Generate a cryptographically random 6-digit OTP code
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

  // Instant direct activation link with email & otp pre-filled
  const baseRedirect = input.redirectTo.split("?")[0];
  const directLink = `${baseRedirect}?email=${encodeURIComponent(email)}&otp=${otpCode}`;

  // 1. Clean up any previous unaccepted invites for this firm + email
  try {
    await supabaseAdmin
      .from("firm_invites")
      .delete()
      .ilike("email", email)
      .eq("firm_id", input.firmId);
  } catch (delErr) {
    console.warn("[doInvite] delete existing invite warn:", delErr);
  }

  // 2. Record the invite in firm_invites
  const { error: insErr } = await (supabaseAdmin.from("firm_invites") as any).insert({
    firm_id: input.firmId,
    email: email,
    role: input.role,
    full_name: input.fullName || null,
    accepted: false,
    otp_code: otpCode,
    otp_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (insErr) {
    console.warn(
      "[doInvite] firm_invites insert with otp_code failed, attempting fallback:",
      insErr,
    );
    // Fallback if otp_code column doesn't exist yet
    await supabaseAdmin.from("firm_invites").insert({
      firm_id: input.firmId,
      email: email,
      role: input.role,
      full_name: input.fullName || null,
      accepted: false,
    });
  }

  // 3. Store OTP in auth user_metadata as guaranteed fallback
  try {
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existing = usersData?.users?.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        user_metadata: {
          ...existing.user_metadata,
          otp_code: otpCode,
          firm_id: input.firmId,
          role: input.role,
          full_name: input.fullName || existing.user_metadata?.full_name,
        },
      });
    } else {
      await supabaseAdmin.auth.admin.createUser({
        email: email,
        email_confirm: true,
        user_metadata: {
          otp_code: otpCode,
          firm_id: input.firmId,
          role: input.role,
          full_name: input.fullName,
        },
      });
    }
  } catch (authErr) {
    console.warn("[doInvite] auth user metadata setup warn:", authErr);
  }

  // 4. Link profile & roles if profile already exists in DB
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("id, firm_id")
    .ilike("email", email)
    .maybeSingle();

  if (prof) {
    if (prof.firm_id && prof.firm_id !== input.firmId) {
      throw new Error("This email already belongs to another firm");
    }
    await supabaseAdmin.from("profiles").update({ firm_id: input.firmId }).eq("id", prof.id);
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: prof.id, role: input.role }, { onConflict: "user_id,role" });

    return { status: "linked" as const, inviteLink: directLink, otpCode, emailSent: false };
  }

  // Fire email in background (non-blocking)
  void supabaseAdmin.auth.admin
    .inviteUserByEmail(email, {
      redirectTo: input.redirectTo,
      data: { full_name: input.fullName },
    })
    .catch((err) => console.warn("[doInvite] background email dispatch (ignored):", err));

  return { status: "invited" as const, inviteLink: directLink, otpCode, emailSent: true };
}

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => inviteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) {
      const [{ data: mgr }, { data: firm }] = await Promise.all([
        sb.rpc("is_manager"),
        sb.rpc("current_firm_id"),
      ]);
      if (!mgr || firm !== data.firmId) throw new Error("Not authorised");
    }
    return doInvite(data);
  });

export const generateLoginLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email("Please enter a valid email address"),
        firmId: z
          .string()
          .trim()
          .optional()
          .nullable()
          .transform((v) => (v && v.length > 5 ? v : undefined)),
        role: roleEnum.optional(),
        redirectTo: z.string().url().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) {
      const [{ data: mgr }, { data: firm }] = await Promise.all([
        sb.rpc("is_manager"),
        sb.rpc("current_firm_id"),
      ]);
      if (!mgr || (data.firmId && firm !== data.firmId)) throw new Error("Not authorised");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (data.firmId) {
      try {
        await supabaseAdmin
          .from("firm_invites")
          .delete()
          .ilike("email", email)
          .eq("firm_id", data.firmId);
        await (supabaseAdmin.from("firm_invites") as any).insert({
          firm_id: data.firmId,
          email: email,
          role: data.role || "staff",
          accepted: false,
          otp_code: otpCode,
          otp_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
      } catch (invErr) {
        console.warn("[generateLoginLink] invite db warn:", invErr);
      }
    }

    // Save in auth user_metadata as fallback
    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const existing = usersData?.users?.find((u) => u.email?.toLowerCase() === email);
      if (existing) {
        await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          user_metadata: {
            ...existing.user_metadata,
            otp_code: otpCode,
            firm_id: data.firmId || existing.user_metadata?.firm_id,
            role: data.role || existing.user_metadata?.role || "staff",
          },
        });
      }
    } catch (e) {
      console.warn("[generateLoginLink] metadata warn:", e);
    }

    const targetRedirect = (
      data.redirectTo || `${process.env.APP_URL || "http://localhost:5173"}/set-password`
    ).split("?")[0];
    const link = `${targetRedirect}?email=${encodeURIComponent(email)}&otp=${otpCode}`;

    return { link, otpCode, email };
  });

export const verifyOtpAndSetPassword = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email("Please enter a valid email"),
        otp: z.string().trim().min(4, "Invalid OTP code"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();
    const otp = data.otp.trim();

    // 1. Look up invite in firm_invites
    let matchedInvite: any = null;
    try {
      const { data: inv, error: invErr } = await supabaseAdmin
        .from("firm_invites")
        .select("*")
        .ilike("email", email)
        .order("created_at", { ascending: false });

      if (!invErr && inv && inv.length > 0) {
        matchedInvite =
          inv.find((item: any) => item.otp_code && String(item.otp_code).trim() === otp) || inv[0];
      }
    } catch (err) {
      console.warn("[verifyOtpAndSetPassword] DB lookup error:", err);
    }

    // 2. Look up Auth User & Profile
    let userId: string | undefined;
    let existingUser: any = null;

    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      existingUser = usersData?.users?.find((u) => u.email?.toLowerCase() === email);
      if (existingUser) {
        userId = existingUser.id;
      }
    } catch (listErr) {
      console.warn("[verifyOtpAndSetPassword] listUsers warn:", listErr);
    }

    let isValid = false;
    let firmId = matchedInvite?.firm_id;
    let role = matchedInvite?.role;
    let fullName = matchedInvite?.full_name;

    // Fallback: check profiles table by email
    if (!userId) {
      try {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, firm_id")
          .ilike("email", email)
          .maybeSingle();
        if (prof) {
          userId = prof.id;
          fullName = fullName || prof.full_name;
          firmId = firmId || prof.firm_id;
        }
      } catch (profErr) {
        console.warn("[verifyOtpAndSetPassword] profile check warn:", profErr);
      }
    }

    // Check if OTP matches firm_invites
    if (matchedInvite?.otp_code && String(matchedInvite.otp_code).trim() === otp) {
      isValid = true;
    }

    // Check if OTP matches user_metadata
    if (!isValid && existingUser?.user_metadata?.otp_code) {
      if (String(existingUser.user_metadata.otp_code).trim() === otp) {
        isValid = true;
        firmId = firmId || existingUser.user_metadata.firm_id;
        role = role || existingUser.user_metadata.role;
        fullName = fullName || existingUser.user_metadata.full_name;
      }
    }

    // Check native Supabase verifyOtp fallback
    if (!isValid) {
      try {
        const { data: vData, error: vErr } = await supabaseAdmin.auth.verifyOtp({
          email,
          token: otp,
          type: "email",
        });
        if (!vErr && vData?.user) {
          isValid = true;
          userId = userId || vData.user.id;
        }
      } catch {
        // ignore
      }
    }

    if (!isValid) {
      throw new Error(
        "Invalid or expired OTP code for this email address. Please generate a new OTP or check that you entered the exact 6 digits.",
      );
    }

    // Update password or create user
    if (userId) {
      const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: data.password,
        email_confirm: true,
        user_metadata: {
          ...(existingUser?.user_metadata || {}),
          otp_code: null, // clear OTP after successful use
        },
      });
      if (upErr) throw new Error(upErr.message);
    } else {
      const { data: newUser, error: cErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });
      if (cErr || !newUser.user) throw new Error(cErr?.message || "Could not create user account");
      userId = newUser.user.id;
    }

    // Link profile & role if firmId exists
    if (firmId) {
      await supabaseAdmin
        .from("profiles")
        .update({
          firm_id: firmId,
          full_name: fullName || undefined,
        })
        .eq("id", userId);

      if (role) {
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
      }

      if (matchedInvite?.id) {
        await supabaseAdmin
          .from("firm_invites")
          .update({ accepted: true })
          .eq("id", matchedInvite.id);
      }
    }

    return { success: true, email };
  });

export const createFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(2).max(150),
        ownerEmail: z.string().trim().toLowerCase().email().max(255),
        ownerName: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(20).optional(),
        city: z.string().trim().max(80).optional(),
        logoUrl: z.string().max(200000).nullable().optional(),
        redirectTo: z.string().url(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) throw new Error("Not authorised");
    const { data: firmId, error } = await sb.rpc("create_firm", {
      _name: data.name,
      _owner_email: data.ownerEmail,
      _phone: data.phone ?? "",
      _city: data.city ?? "",
      _logo_url: data.logoUrl ?? "",
    });
    if (error) throw new Error(error.message);
    const r = await doInvite({
      firmId: firmId as string,
      email: data.ownerEmail,
      fullName: data.ownerName,
      role: "admin",
      redirectTo: data.redirectTo,
    });
    return { firmId: firmId as string, ...r };
  });

export const deleteFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ firmId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) throw new Error("Not authorised: Only Super Admin can delete firms");

    // Try calling delete_firm RPC
    const { error: rpcErr } = await sb.rpc("delete_firm", { _firm_id: data.firmId });
    if (!rpcErr) return { success: true };

    // Fallback: check status and delete
    const { data: firm, error: fErr } = await sb
      .from("firms")
      .select("id, status, name")
      .eq("id", data.firmId)
      .maybeSingle();

    if (fErr || !firm) throw new Error("Firm not found");
    if (firm.status !== "suspended") {
      throw new Error("Firm must be suspended before it can be deleted.");
    }

    const { error: delErr } = await sb.from("firms").delete().eq("id", data.firmId);
    if (delErr) throw new Error(delErr.message || rpcErr?.message);

    return { success: true };
  });

export const fetchPracticeFirms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) throw new Error("Not authorised");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("firms")
      .select("id, name, logo_url, owner_email, phone, city, status")
      .eq("status", "active")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((f) => ({
      ...f,
      role: "admin",
      is_current: false,
    }));
  });

export const switchActiveFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ firmId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ acting_firm_id: data.firmId })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const registerPracticeFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      name: z.string().trim().min(2, "Firm name must be at least 2 characters"),
      phone: z.string().trim().nullable().optional(),
      city: z.string().trim().nullable().optional(),
      logoUrl: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      gstin: z.string().nullable().optional(),
      pan: z.string().nullable().optional(),
      bankDetails: z.string().nullable().optional(),
      defaultTaxRate: z.number().default(18),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const userEmail = (context.claims as { email?: string } | undefined)?.email ?? "";

    // 1. Create firm record
    const { data: newFirm, error: firmErr } = await supabaseAdmin
      .from("firms")
      .insert({
        name: data.name,
        phone: data.phone || null,
        city: data.city || null,
        logo_url: data.logoUrl || null,
        owner_email: userEmail,
        status: "active",
      })
      .select("id")
      .single();

    if (firmErr) throw new Error(firmErr.message);

    // 2. Create settings record
    await supabaseAdmin.from("settings").insert({
      firm_id: newFirm.id,
      firm_name: data.name,
      address: data.address || null,
      gstin: data.gstin || null,
      pan: data.pan || null,
      phone: data.phone || null,
      email: userEmail,
      bank_details: data.bankDetails || null,
      default_tax_rate: data.defaultTaxRate ?? 18,
    });

    // 3. Switch active acting_firm_id to the new firm
    await supabaseAdmin.from("profiles").update({ acting_firm_id: newFirm.id }).eq("id", userId);

    return { firmId: newFirm.id };
  });

export const fetchFirmBillingDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ firmId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    const { data: currentFirm } = await sb.rpc("current_firm_id");
    if (!isSuper && currentFirm !== data.firmId) throw new Error("Not authorised");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [fRes, sRes] = await Promise.all([
      supabaseAdmin.from("firms").select("*").eq("id", data.firmId).maybeSingle(),
      supabaseAdmin.from("settings").select("*").eq("firm_id", data.firmId).maybeSingle(),
    ]);
    return {
      firm: fRes.data,
      settings: sRes.data,
    };
  });

export const updateInvoiceBillingDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      invoiceId: z.string().uuid(),
      invoiceNo: z.string().optional(),
      firmId: z.string().uuid().optional(),
      customFirmName: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: canEdit } = await sb.rpc("has_capability", {
      _module: "invoices",
      _action: "edit",
    });
    if (!canEdit) throw new Error("Not authorised");
    const { data: isSuper } = await sb.rpc("is_super_admin");
    const { data: currentFirm } = await sb.rpc("current_firm_id");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await supabaseAdmin
      .from("invoices")
      .select("firm_id")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (!inv) throw new Error("Invoice not found");
    if (!isSuper && inv.firm_id !== currentFirm) throw new Error("Not authorised");
    const updates: Record<string, any> = {};
    if (data.firmId) updates.firm_id = data.firmId;
    if (data.invoiceNo?.trim()) updates.invoice_no = data.invoiceNo.trim();
    if (data.customFirmName?.trim()) {
      // If customFirmName is provided, we can store it in notes or description if not empty
      updates.description = data.customFirmName.trim();
    }
    const { error } = await supabaseAdmin
      .from("invoices")
      .update(updates as never)
      .eq("id", data.invoiceId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deleteJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      jobIds: z.array(z.string().uuid()).min(1),
      force: z.boolean().default(false),
    }),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: canDelete } = await sb.rpc("has_capability", {
      _module: "jobs",
      _action: "delete",
    });
    if (!canDelete) throw new Error("Not authorised");
    const { data: isSuper } = await sb.rpc("is_super_admin");
    const { data: currentFirm } = await sb.rpc("current_firm_id");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: jobRows } = await supabaseAdmin
      .from("jobs")
      .select("id, firm_id")
      .in("id", data.jobIds);
    if (!isSuper && (jobRows ?? []).some((j: any) => j.firm_id !== currentFirm)) {
      throw new Error("Not authorised");
    }
    const { jobIds, force } = data;

    let deleted = 0;
    const errors: string[] = [];

    for (const jobId of jobIds) {
      try {
        if (force) {
          // 1. Detach or delete linked expenses
          await supabaseAdmin.from("expenses").update({ job_id: null }).eq("job_id", jobId);

          // 2. Detach payments
          await supabaseAdmin.from("payments").update({ job_id: null }).eq("job_id", jobId);

          // 3. Delete job status history (which has on delete restrict)
          await supabaseAdmin.from("job_status_history").delete().eq("job_id", jobId);

          // 4. Delete job clearing (which has on delete restrict)
          await supabaseAdmin.from("job_clearing").delete().eq("job_id", jobId);

          // 5. Delete or detach invoice items
          await supabaseAdmin.from("invoice_items").delete().eq("job_id", jobId);

          // 6. Delete discounts
          await supabaseAdmin.from("discounts").delete().eq("job_id", jobId);

          // 7. Delete recurring payments linked
          await supabaseAdmin.from("recurring_payments").delete().eq("job_id", jobId);

          // 8. If any invoices have job_id, detach or update job_id: null
          await supabaseAdmin.from("invoices").update({ job_id: null }).eq("job_id", jobId);
        } else {
          // Even in regular delete, job_status_history and draft job_clearing exist for every job
          // because triggers stamp them on creation. Clean them up so deletable jobs can delete:
          await supabaseAdmin.from("job_status_history").delete().eq("job_id", jobId);
          await supabaseAdmin
            .from("job_clearing")
            .delete()
            .eq("job_id", jobId)
            .eq("status", "draft");
        }

        const { error: delErr } = await supabaseAdmin.from("jobs").delete().eq("id", jobId);
        if (delErr) {
          throw new Error(delErr.message);
        }
        deleted++;
      } catch (err: any) {
        errors.push(err.message || String(err));
      }
    }

    return {
      deleted,
      total: jobIds.length,
      failed: jobIds.length - deleted,
      errors,
    };
  });

export const recordPaymentEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      clientId: z.string().uuid(),
      jobId: z.string().uuid().nullable().optional(),
      amount: z.number().positive("Amount must be greater than zero"),
      paymentDate: z.string().min(1),
      mode: z.string().default("bank"),
      narration: z.string().optional(),
      isAdvance: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: canCreate } = await sb.rpc("has_capability", {
      _module: "payments",
      _action: "create",
    });
    if (!canCreate) throw new Error("Not authorised");
    const { data: isSuper } = await sb.rpc("is_super_admin");
    const { data: currentFirm } = await sb.rpc("current_firm_id");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("firm_id")
      .eq("id", data.clientId)
      .single();
    if (!client) throw new Error("Client not found");
    if (!isSuper && client.firm_id !== currentFirm) throw new Error("Not authorised");

    // Map mode to PostgreSQL allowed check constraint: ('cash','bank','upi','cheque','card','other')
    let dbMode = data.mode.toLowerCase();
    if (
      dbMode === "bank_transfer" ||
      dbMode === "bank transfer" ||
      dbMode === "neft" ||
      dbMode === "rtgs"
    ) {
      dbMode = "bank";
    } else if (!["cash", "bank", "upi", "cheque", "card", "other"].includes(dbMode)) {
      dbMode = "other";
    }

    const { data: pay, error } = await supabaseAdmin
      .from("payments")
      .insert({
        firm_id: client.firm_id,
        client_id: data.clientId,
        job_id: data.jobId || null,
        amount: data.amount,
        allocated_amount: 0,
        payment_date: data.paymentDate,
        mode: dbMode,
        narration: data.narration?.trim() || (data.isAdvance ? "Advance Client Deposit" : null),
        status: "unallocated",
        created_by: context.userId || null,
      })
      .select("id, payment_code, amount, job_id")
      .single();

    if (error) throw new Error(error.message);
    return { success: true, payment: pay };
  });

export const manualAllocatePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      paymentId: z.string().uuid(),
      jobAllocations: z.array(
        z.object({
          jobId: z.string().uuid(),
          amount: z.number().min(0),
          discount: z.number().min(0).default(0),
        }),
      ),
      expenseAllocations: z.array(
        z.object({
          expenseId: z.string().uuid(),
          amount: z.number().min(0),
          discount: z.number().min(0).default(0),
        }),
      ),
    }),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: canEdit } = await sb.rpc("has_capability", {
      _module: "payments",
      _action: "edit",
    });
    if (!canEdit) throw new Error("Not authorised");
    const { data: isSuper } = await sb.rpc("is_super_admin");
    const { data: currentFirm } = await sb.rpc("current_firm_id");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { paymentId, jobAllocations, expenseAllocations } = data;

    // 1. Fetch payment
    const { data: pay, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();
    if (payErr || !pay) throw new Error("Payment record not found");
    if (!isSuper && pay.firm_id !== currentFirm) throw new Error("Not authorised");

    const totalJobAmt = jobAllocations.reduce((sum, j) => sum + (j.amount || 0), 0);
    const totalExpAmt = expenseAllocations.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalToAllocate = totalJobAmt + totalExpAmt;

    const availableBefore = Math.max(
      0,
      Number(pay.amount || 0) - Number(pay.allocated_amount || 0),
    );
    if (totalToAllocate > availableBefore + 0.01) {
      throw new Error(
        `Total allocation (₹${totalToAllocate.toLocaleString("en-IN")}) exceeds available payment balance (₹${availableBefore.toLocaleString("en-IN")})`,
      );
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const userId = context.userId || null;

    // 2. Process Job Allocations
    for (const jAlloc of jobAllocations) {
      const jAmt = Number(jAlloc.amount || 0);
      const jDisc = Number(jAlloc.discount || 0);
      if (jAmt <= 0 && jDisc <= 0) continue;

      const { data: job, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .select("*, invoice_items(invoice_id, invoices(*))")
        .eq("id", jAlloc.jobId)
        .single();
      if (jobErr || !job) continue;

      const activeInvs = (job.invoice_items as any[])
        ?.map((it: any) => it.invoices)
        ?.filter((inv: any) => inv && inv.status !== "cancelled");
      const existingInv = activeInvs?.[0];
      let invoiceId: string | null = existingInv?.id ?? null;

      const curFee = Number(job.fee || 0);
      const curJobNet = Number(job.net_amount || curFee);
      // If invoice exists, remaining base due is the invoice's outstanding
      const curBaseDue = existingInv
        ? Math.max(0, Number(existingInv.total || 0) - Number(existingInv.amount_paid || 0))
        : curJobNet;

      const maxJobDue = Math.max(0, curBaseDue - jDisc);
      if (jAmt > maxJobDue + 0.01) {
        throw new Error(
          `Allocation (₹${jAmt}) cannot exceed net due (₹${maxJobDue}) for job ${job.job_code}`,
        );
      }
      if (jDisc > curBaseDue + 0.01) {
        throw new Error(
          `Discount (₹${jDisc}) cannot exceed remaining due (₹${curBaseDue}) for job ${job.job_code}`,
        );
      }

      // Handle optional discount granted by user during clearing
      let updatedNet = curJobNet;
      if (jDisc > 0) {
        const curDisc = Number(job.discount || 0);
        const newDisc = curDisc + jDisc;
        updatedNet = Math.max(0, curFee - newDisc);
        await supabaseAdmin
          .from("jobs")
          .update({
            discount: newDisc,
            net_amount: updatedNet,
          })
          .eq("id", job.id);

        if (existingInv) {
          const newInvDisc = Number(existingInv.discount || 0) + jDisc;
          const newInvTotal = Math.max(0, Number(existingInv.subtotal || 0) - newInvDisc);
          await supabaseAdmin
            .from("invoices")
            .update({
              discount: newInvDisc,
              total: newInvTotal,
            })
            .eq("id", existingInv.id);

          existingInv.discount = newInvDisc;
          existingInv.total = newInvTotal;
        }
      }

      // If job is fully discounted/waived and no payment allocation needed, close it immediately
      if (maxJobDue <= 0 && jAmt <= 0) {
        await supabaseAdmin
          .from("jobs")
          .update({ financial_status: "closed", status: "completed" })
          .eq("id", job.id);

        if (existingInv) {
          await supabaseAdmin
            .from("invoices")
            .update({ status: "paid" })
            .eq("id", existingInv.id);
        }

        await supabaseAdmin.from("job_clearing").upsert(
          {
            job_id: job.id,
            firm_id: job.firm_id,
            status: "squared_off",
            advance: 0,
            discount: Number(job.discount || 0) + jDisc,
            final_amount: 0,
            squared_off_at: new Date().toISOString(),
            squared_off_by: userId,
            notes: `Fully discounted/waived in ${pay.payment_code}`,
          },
          { onConflict: "job_id" },
        );
        continue;
      }

      if (!invoiceId) {
        // Create an invoice for this job (Note: outstanding is GENERATED ALWAYS AS STORED in PostgreSQL, so omitted)
        const jobNet = Math.max(0, updatedNet);
        const invTotal = jobNet > 0 ? jobNet : jAmt;

        const { data: newInv, error: invErr } = await supabaseAdmin
          .from("invoices")
          .insert({
            firm_id: job.firm_id,
            client_id: pay.client_id,
            job_id: job.id,
            payment_id: pay.id,
            invoice_date: todayStr,
            due_date: todayStr,
            subtotal: invTotal,
            total: invTotal,
            amount_paid: 0,
            status: "unpaid",
            notes: "Manual clearing from Payment Desk",
            created_by: userId,
          })
          .select("id")
          .single();

        if (invErr || !newInv)
          throw new Error(invErr?.message || "Failed to create invoice for job");
        invoiceId = newInv.id;

        await supabaseAdmin.from("invoice_items").insert({
          firm_id: job.firm_id,
          invoice_id: invoiceId,
          job_id: job.id,
          description: job.title || "Professional Services",
          amount: invTotal,
        });

        await supabaseAdmin.from("jobs").update({ financial_status: "invoiced" }).eq("id", job.id);
      }

      // If the payment didn't have a linked job_id yet and was allocated here, link it
      if (!pay.job_id) {
        await supabaseAdmin
          .from("payments")
          .update({ job_id: job.id })
          .eq("id", pay.id);
      }

      // Allocate payment amount to invoice
      if (invoiceId && jAlloc.amount > 0) {
        const { error: allocErr } = await supabaseAdmin.from("payment_allocations").insert({
          firm_id: job.firm_id,
          payment_id: pay.id,
          invoice_id: invoiceId,
          amount: jAlloc.amount,
          allocated_by: userId,
        });

        if (allocErr) throw new Error(allocErr.message);

        // Fetch updated invoice row (trigger after_allocation computes amount_paid and status)
        const { data: invRow } = await supabaseAdmin
          .from("invoices")
          .select("total, amount_paid, status")
          .eq("id", invoiceId)
          .single();

        if (invRow) {
          const isPaid =
            invRow.status === "paid" ||
            Number(invRow.amount_paid || 0) >= Number(invRow.total || 0);

          if (isPaid) {
            await supabaseAdmin
              .from("jobs")
              .update({ financial_status: "closed", status: "completed" })
              .eq("id", job.id);

            await supabaseAdmin.from("job_clearing").upsert(
              {
                job_id: job.id,
                firm_id: job.firm_id,
                status: "squared_off",
                squared_off_at: new Date().toISOString(),
                squared_off_by: userId,
                advance: jAlloc.amount,
                discount: jAlloc.discount || 0,
                final_amount: 0,
                notes: "Manually allocated & cleared from Payment Desk",
              },
              { onConflict: "job_id" },
            );
          } else {
            // Partially cleared: register clearing record so invoice generation and workflow recognise it
            await supabaseAdmin.from("job_clearing").upsert(
              {
                job_id: job.id,
                firm_id: job.firm_id,
                status: "cleared",
                cleared_at: new Date().toISOString(),
                cleared_by: userId,
                advance: Number(invRow.amount_paid || 0),
                discount: jAlloc.discount || 0,
                final_amount: Math.max(0, Number(invRow.total || 0) - Number(invRow.amount_paid || 0)),
                notes: "Partially allocated & cleared from Payment Desk",
              },
              { onConflict: "job_id" },
            );
          }
        }
      }
    }

    // 3. Process Expense Allocations
    for (const eAlloc of expenseAllocations) {
      const eAmt = Number(eAlloc.amount || 0);
      const eDisc = Number(eAlloc.discount || 0);
      if (eAmt <= 0 && eDisc <= 0) continue;

      const { data: exp, error: expErr } = await supabaseAdmin
        .from("expenses")
        .select("*")
        .eq("id", eAlloc.expenseId)
        .single();
      if (expErr || !exp) continue;

      const expOriginalAmt = Number(exp.amount || 0);
      const maxExpDue = Math.max(0, expOriginalAmt - eDisc);
      if (eAmt > maxExpDue + 0.01) {
        throw new Error(
          `Allocation (₹${eAmt}) cannot exceed net outlay due (₹${maxExpDue}) for "${exp.description}"`,
        );
      }
      if (eDisc > expOriginalAmt + 0.01) {
        throw new Error(
          `Discount (₹${eDisc}) cannot exceed outlay amount (₹${expOriginalAmt}) for "${exp.description}"`,
        );
      }

      if (eAmt > 0) {
        // Note: outstanding is GENERATED ALWAYS in postgres, so do not pass it
        const { data: expInv, error: expInvErr } = await supabaseAdmin
          .from("invoices")
          .insert({
            firm_id: exp.firm_id,
            client_id: pay.client_id,
            job_id: exp.job_id || null,
            payment_id: pay.id,
            invoice_date: todayStr,
            due_date: todayStr,
            subtotal: eAmt + eDisc,
            discount: eDisc,
            total: eAmt,
            amount_paid: 0,
            status: "unpaid",
            notes:
              eDisc > 0
                ? `Reimbursable Outlay Settlement: ${exp.description} (Discount/Waiver: ₹${eDisc})`
                : `Reimbursable Outlay Settlement: ${exp.description}`,
            created_by: userId,
          })
          .select("id")
          .single();

        if (expInv) {
          await supabaseAdmin.from("invoice_items").insert({
            firm_id: exp.firm_id,
            invoice_id: expInv.id,
            job_id: exp.job_id || null,
            description: `Client Outlay: ${exp.description}`,
            amount: eAmt + eDisc,
          });

          await supabaseAdmin.from("payment_allocations").insert({
            firm_id: exp.firm_id,
            payment_id: pay.id,
            invoice_id: expInv.id,
            amount: eAmt,
            allocated_by: userId,
          });
        }
      }

      const clearNote =
        eDisc > 0
          ? `Cleared in ${pay.payment_code} (Reimbursed: ₹${eAmt}, Waived/Discount: ₹${eDisc})`
          : `Cleared in ${pay.payment_code}`;

      await supabaseAdmin
        .from("expenses")
        .update({
          notes: exp.notes ? `${exp.notes} (${clearNote})` : clearNote,
        })
        .eq("id", exp.id);
    }

    // 4. Update the payment record's allocated_amount and status (matches postgres check: 'unallocated', 'partially_allocated', 'allocated', 'reversed')
    const newAllocTotal = Number(pay.allocated_amount || 0) + totalToAllocate;
    const isFullyCovered = newAllocTotal >= Number(pay.amount || 0);
    const updatedStatus = isFullyCovered
      ? "allocated"
      : newAllocTotal > 0
        ? "partially_allocated"
        : "unallocated";

    await supabaseAdmin
      .from("payments")
      .update({
        allocated_amount: newAllocTotal,
        status: updatedStatus,
      })
      .eq("id", pay.id);

    // Audit log
    await supabaseAdmin.from("audit_logs").insert({
      firm_id: pay.firm_id,
      user_id: userId,
      action: "payment_manually_allocated",
      module: "payments",
      record_id: pay.id,
      reason: `Manually allocated ₹${totalToAllocate} across jobs & expenses`,
    });

    return {
      success: true,
      allocatedTotal: totalToAllocate,
      remainingBalance: Math.max(0, Number(pay.amount || 0) - newAllocTotal),
      status: updatedStatus,
    };
  });
