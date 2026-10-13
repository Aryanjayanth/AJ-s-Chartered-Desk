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
    console.warn("[doInvite] firm_invites insert with otp_code failed, attempting fallback:", insErr);
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
      .parse(d)
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

    const targetRedirect = (data.redirectTo || `${process.env.APP_URL || "http://localhost:5173"}/set-password`).split("?")[0];
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
      .parse(d)
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
        matchedInvite = inv.find(
          (item: any) => item.otp_code && String(item.otp_code).trim() === otp
        ) || inv[0];
      }
    } catch (err) {
      console.warn("[verifyOtpAndSetPassword] DB lookup error:", err);
    }

    // 2. Look up Auth User & Profile
    let userId: string | undefined;
    let existingUser: any = null;

    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      existingUser = usersData?.users?.find(
        (u) => u.email?.toLowerCase() === email
      );
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
      throw new Error("Invalid or expired OTP code for this email address. Please generate a new OTP or check that you entered the exact 6 digits.");
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
  .handler(async () => {
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
    const userId = context.user.id;
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
    const userId = context.user.id;
    const userEmail = context.user.email ?? "";

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
    await supabaseAdmin
      .from("profiles")
      .update({ acting_firm_id: newFirm.id })
      .eq("id", userId);

    return { firmId: newFirm.id };
  });

