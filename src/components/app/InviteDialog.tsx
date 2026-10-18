import { useState, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Link2, Sparkles, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field } from "./common";
import { inviteUser } from "@/lib/firms.functions";
import { ROLES, type Role } from "@/hooks/use-roles";
import { useSuperAdmin } from "@/hooks/use-firm";
import { errMsg, label } from "@/lib/format";

export function InviteDialog({
  firm,
  open,
  onClose,
}: {
  firm?: { id: string; name: string } | null;
  open?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isSuperAdmin } = useSuperAdmin();
  const run = useServerFn(inviteUser);

  const [selectedFirmId, setSelectedFirmId] = useState<string>(firm?.id || "");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [createdOtp, setCreatedOtp] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState("");
  const [invitedRole, setInvitedRole] = useState<Role>("staff");
  const [emailSent, setEmailSent] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);

  // Sync selected firm when prop changes
  useEffect(() => {
    if (firm?.id) setSelectedFirmId(firm.id);
  }, [firm?.id]);

  // Load firms if super admin and no firm was explicitly passed
  const firmsQ = useQuery({
    queryKey: ["firms-list-for-invite"],
    enabled: isSuperAdmin && !firm,
    queryFn: async () => {
      const { data, error } = await supabase.from("firms").select("id, name, status").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const isOpen = open !== undefined ? open : !!firm;

  const resetAll = () => {
    setEmail("");
    setName("");
    setRole("staff");
    setCreatedLink(null);
    setCreatedOtp(null);
    setInvitedEmail("");
    setEmailSent(false);
    setCopiedLink(false);
    setCopiedOtp(false);
    setCopiedMsg(false);
    onClose();
  };

  const copyLink = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink);
    setCopiedLink(true);
    toast.success("Direct activation link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const copyOtp = () => {
    if (!createdOtp) return;
    navigator.clipboard.writeText(createdOtp);
    setCopiedOtp(true);
    toast.success("OTP code copied to clipboard!");
    setTimeout(() => setCopiedOtp(false), 2500);
  };

  const copyFullMessage = () => {
    const inviteUrl = createdLink || `${window.location.origin}/set-password`;
    const message = `Hello! You have been invited to AJ's Chartered Desk for ${targetFirmName}.\n\nYour 6-digit OTP code is: ${createdOtp || "N/A"}\n\nActivate your account and set your password here:\n${inviteUrl}`;
    navigator.clipboard.writeText(message);
    setCopiedMsg(true);
    toast.success("Complete invitation message copied (ready for WhatsApp / SMS)!");
    setTimeout(() => setCopiedMsg(false), 2500);
  };

  const targetFirmId = firm?.id || selectedFirmId;
  const targetFirmName =
    firm?.name || firmsQ.data?.find((f) => f.id === selectedFirmId)?.name || "Selected Firm";

  const send = async () => {
    if (!targetFirmId) {
      toast.error("Please select a firm");
      return;
    }
    if (!email.trim()) {
      toast.error("Please enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      const r = await run({
        data: {
          firmId: targetFirmId,
          email: email.trim().toLowerCase(),
          fullName: name.trim() || undefined,
          role,
          redirectTo: `${window.location.origin}/set-password`,
        },
      });
      qc.invalidateQueries();

      if (r.inviteLink || r.otpCode) {
        setCreatedLink(r.inviteLink);
        setCreatedOtp(r.otpCode || null);
        setInvitedEmail(email.trim().toLowerCase());
        setInvitedRole(role);
        setEmailSent(!!r.emailSent);
        toast.success("Invite and OTP generated successfully!");
      } else {
        toast.success(
          r.status === "invited"
            ? `Invite created for ${email}`
            : "User linked to firm successfully",
        );
        resetAll();
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && resetAll()}>
      <DialogContent className="max-w-md">
        {createdLink || createdOtp ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <Sparkles className="h-6 w-6" />
              </div>
              <DialogTitle className="text-center">
                Credentials Ready for {invitedEmail}
              </DialogTitle>
              <DialogDescription className="text-center">
                Role: <span className="font-semibold text-foreground">{label(invitedRole)}</span> at{" "}
                <span className="font-semibold text-foreground">{targetFirmName}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              {/* 6-Digit OTP Box */}
              {createdOtp && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                    <span className="font-semibold text-foreground">6-Digit Security OTP</span>
                    <span className="text-[11px] text-muted-foreground">Valid for 7 days</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-2xl font-bold tracking-[0.25em] text-primary">
                      {createdOtp}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={copyOtp}
                      className="shrink-0 gap-1.5 h-8 font-medium"
                    >
                      {copiedOtp ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copiedOtp ? "Copied" : "Copy OTP"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Direct Activation Link Box */}
              {createdLink && (
                <div className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                    <span className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 text-primary" /> Direct Link:
                    </span>
                    {emailSent && (
                      <span className="text-emerald-600 dark:text-emerald-400">✓ Email Sent</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={createdLink}
                      readOnly
                      onFocus={(e) => e.target.select()}
                      className="font-mono text-xs select-all bg-background border-border/80 h-8"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={copyLink}
                      className="shrink-0 gap-1.5 h-8"
                    >
                      {copiedLink ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copiedLink ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Copy Full Message Option */}
              <div className="pt-1 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 text-xs"
                  onClick={copyFullMessage}
                >
                  {copiedMsg ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedMsg ? "Message Copied!" : "Copy WhatsApp Message"}
                </Button>
                {createdLink && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/40"
                    onClick={() => window.open(createdLink, "_blank", "noopener,noreferrer")}
                    title="Test Open"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button onClick={resetAll} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-primary" />
                Invite User & Generate Link
              </DialogTitle>
              <DialogDescription>
                {firm
                  ? `Generate a direct activation link and invite a team member to ${firm.name}.`
                  : "Select a firm, role, and email to create an instant activation link."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* If super admin and no firm was locked, show firm selector */}
              {!firm && isSuperAdmin && (
                <Field label="Select Firm *">
                  <div className="relative">
                    <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <select
                      value={selectedFirmId}
                      onChange={(e) => setSelectedFirmId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">-- Choose a firm --</option>
                      {(firmsQ.data ?? []).map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} {f.status === "suspended" ? "(Suspended)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
              )}

              <Field label="Full name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                />
              </Field>

              <Field label="Email *">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="rahul@example.com"
                  required
                />
              </Field>

              <Field label="Role">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="admin">Owner / Admin (Full Access)</option>
                  <option value="staff">Staff (Job Execution)</option>
                  <option value="cashier">Cashier (Billing & Payments)</option>
                </select>
              </Field>
            </div>

            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={resetAll}>
                Cancel
              </Button>
              <Button onClick={send} disabled={busy || !email || (!firm && !selectedFirmId)}>
                {busy ? "Generating…" : "Generate Link & Invite"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
