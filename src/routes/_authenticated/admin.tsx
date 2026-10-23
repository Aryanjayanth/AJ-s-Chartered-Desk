import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Plus,
  ArrowRight,
  Users,
  Mail,
  MapPin,
  Search,
  Trash2,
  Lock,
  ShieldAlert,
  Link2,
  Check,
  Copy,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field, NoAccess, PageHeader, StatCard } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { AvatarPicker, EntityAvatar } from "@/components/app/EntityAvatar";
import { useSuperAdmin } from "@/hooks/use-firm";
import { useAdminPrivacy } from "@/hooks/use-admin-privacy";
import { createFirm, deleteFirm } from "@/lib/firms.functions";
import { InviteDialog } from "@/components/app/InviteDialog";
import { errMsg, fmtDate, inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Firms Console — AJ's Chartered Desk" },
      { name: "description", content: "Manage all firms on the platform." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { isSuperAdmin, loading } = useSuperAdmin();
  const { privacyMode } = useAdminPrivacy();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<{ id: string; name: string } | null>(null);
  const [generateLinkOpen, setGenerateLinkOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [term, setTerm] = useState("");
  const runDelete = useServerFn(deleteFirm);
  const [deleting, setDeleting] = useState(false);

  const q = useQuery({
    queryKey: ["firm-overview"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("firm_overview");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (loading) return null;
  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center space-y-4">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-1">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Platform Super Admin Console</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The Firms Console is reserved for multi-firm Platform Super Administrators. To configure your firm's profile, GSTIN, PAN, bank accounts, and legal entities, please use <strong>Firm Settings</strong>.
        </p>
        <div className="flex items-center justify-center gap-3 pt-3">
          <Button asChild>
            <Link to="/settings">
              Open Firm Settings
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  const firms = (q.data ?? []).filter((f) =>
    `${f.name} ${f.owner_email} ${f.city}`.toLowerCase().includes(term.toLowerCase()),
  );
  const all = q.data ?? [];

  const openFirm = async (id: string) => {
    if (privacyMode) return;
    const { error } = await supabase.rpc("set_acting_firm", { _firm_id: id });
    if (error) return toast.error(errMsg(error));
    await qc.invalidateQueries();
    navigate({ to: "/dashboard" });
  };

  const toggleStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("firms")
      .update({ status: status === "active" ? "suspended" : "active" })
      .eq("id", id);
    if (error) return toast.error(errMsg(error));
    toast.success(status === "active" ? "Firm suspended" : "Firm reactivated");
    qc.invalidateQueries({ queryKey: ["firm-overview"] });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Try direct RPC first
      const { error: rpcErr } = await supabase.rpc("delete_firm", { _firm_id: deleteTarget.id });

      if (!rpcErr) {
        toast.success(`Firm "${deleteTarget.name}" deleted successfully`);
        qc.invalidateQueries({ queryKey: ["firm-overview"] });
        setDeleteTarget(null);
        return;
      }

      // Fallback to server function
      await runDelete({ data: { firmId: deleteTarget.id } });
      toast.success(`Firm "${deleteTarget.name}" deleted successfully`);
      qc.invalidateQueries({ queryKey: ["firm-overview"] });
      setDeleteTarget(null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Firms Console"
        subtitle="Every firm on your platform, in one place"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setGenerateLinkOpen(true)}>
              <Link2 className="mr-1.5 h-4 w-4 text-primary" />
              Generate Access Link
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New Firm
            </Button>
          </div>
        }
      />

      {/* Top Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total Firms" value={all.length} tone="info" />
        <StatCard
          label="Active Firms"
          value={all.filter((f) => f.status === "active").length}
          tone="success"
        />
        {privacyMode ? (
          <StatCard
            label="Suspended Firms"
            value={all.filter((f) => f.status === "suspended").length}
            tone="warning"
          />
        ) : (
          <>
            <StatCard
              label="Total Invoiced"
              value={inr(all.reduce((a, f) => a + Number(f.invoiced), 0))}
            />
            <StatCard
              label="Outstanding"
              value={inr(all.reduce((a, f) => a + Number(f.outstanding), 0))}
              tone="danger"
            />
          </>
        )}
      </div>

      {/* Search Input */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search firms…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {q.isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : firms.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center text-muted-foreground">
            <Building2 className="h-10 w-10" />
            No firms yet. Create your first firm to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {firms.map((f) => (
            <Card
              key={f.id}
              className="flex h-full flex-col justify-between transition-shadow hover:shadow-md"
            >
              <CardContent className="flex flex-1 flex-col p-6">
                {/* Header: Avatar, Name & Status */}
                <div className="flex items-start gap-3">
                  <EntityAvatar
                    name={f.name}
                    src={f.logo_url}
                    square
                    className="h-11 w-11 text-base shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-base leading-snug">{f.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Since {fmtDate(f.created_at)}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={f.status} />
                  </div>
                </div>

                {/* Details Section with Consistent Baseline */}
                <div className="my-4 min-h-[64px] space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 truncate">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="truncate">{f.owner_email || "No email listed"}</span>
                  </div>
                  <div className="flex items-center gap-2 truncate">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="truncate">{f.city || "No city specified"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    <span>
                      {f.users} users · {f.clients} clients
                    </span>
                  </div>
                </div>

                {/* Financial Totals (Only when Privacy Mode is OFF) */}
                {!privacyMode && (
                  <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Invoiced</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums">
                        {inr(Number(f.invoiced))}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Outstanding</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-destructive">
                        {inr(Number(f.outstanding))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Bottom Action Buttons: Aligned cleanly */}
                <div className="mt-auto space-y-2 border-t border-border/50 pt-4">
                  {/* Primary Open Firm Action */}
                  {privacyMode ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-full text-xs opacity-75 cursor-not-allowed"
                      disabled
                    >
                      <Lock className="mr-1.5 h-3.5 w-3.5" />
                      Open firm
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-9 w-full text-xs font-medium"
                      onClick={() => openFirm(f.id)}
                    >
                      Open firm
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  )}

                  {/* Secondary Actions in Balanced 2-Column Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-normal"
                      onClick={() => setInviteFor({ id: f.id, name: f.name })}
                    >
                      Invite / Link
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 border border-border/40 text-xs font-normal"
                      onClick={() => toggleStatus(f.id, f.status)}
                    >
                      {f.status === "active" ? "Suspend" : "Activate"}
                    </Button>
                  </div>

                  {/* Delete Firm Button (Only when Suspended) */}
                  {f.status === "suspended" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 w-full text-xs font-normal transition-colors"
                      onClick={() => setDeleteTarget({ id: f.id, name: f.name })}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Delete Firm
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <DialogTitle>Delete Firm</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete{" "}
              <strong className="text-foreground">{deleteTarget?.name}</strong>? This will remove
              all associated clients, services, jobs, and invoices. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Permanently Delete Firm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewFirmDialog open={open} onOpenChange={setOpen} />
      <InviteDialog firm={inviteFor} onClose={() => setInviteFor(null)} />
      <InviteDialog open={generateLinkOpen} onClose={() => setGenerateLinkOpen(false)} />
    </div>
  );
}

function NewFirmDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const run = useServerFn(createFirm);
  const [f, setF] = useState({ name: "", ownerName: "", ownerEmail: "", phone: "", city: "" });
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdResult, setCreatedResult] = useState<{
    link: string;
    otpCode?: string | null;
    email: string;
    firmName: string;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const resetAll = () => {
    setF({ name: "", ownerName: "", ownerEmail: "", phone: "", city: "" });
    setLogo(null);
    setCreatedResult(null);
    setCopiedLink(false);
    setCopiedOtp(false);
    setCopiedMsg(false);
    onOpenChange(false);
  };

  const copyLink = () => {
    if (!createdResult?.link) return;
    navigator.clipboard.writeText(createdResult.link);
    setCopiedLink(true);
    toast.success("Owner activation link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const copyOtp = () => {
    if (!createdResult?.otpCode) return;
    navigator.clipboard.writeText(createdResult.otpCode);
    setCopiedOtp(true);
    toast.success("Owner OTP code copied to clipboard!");
    setTimeout(() => setCopiedOtp(false), 2500);
  };

  const copyFullMessage = () => {
    if (!createdResult) return;
    const inviteUrl = createdResult.link || `${window.location.origin}/set-password`;
    const message = `Hello! You have been invited as Owner to AJ's Chartered Desk for ${createdResult.firmName}.\n\nYour 6-digit OTP code is: ${createdResult.otpCode || "N/A"}\n\nActivate your account and set your password here:\n${inviteUrl}`;
    navigator.clipboard.writeText(message);
    setCopiedMsg(true);
    toast.success("Complete invitation message copied (ready for WhatsApp / SMS)!");
    setTimeout(() => setCopiedMsg(false), 2500);
  };

  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Firm name is required");
    if (!/^\S+@\S+\.\S+$/.test(f.ownerEmail)) return toast.error("Valid owner email is required");
    setBusy(true);
    try {
      const r = await run({
        data: {
          ...f,
          logoUrl: logo,
          redirectTo: `${window.location.origin}/set-password`,
        },
      });
      qc.invalidateQueries({ queryKey: ["firm-overview"] });

      if (r.inviteLink || r.otpCode) {
        setCreatedResult({
          link: r.inviteLink || "",
          otpCode: r.otpCode || null,
          email: f.ownerEmail,
          firmName: f.name,
        });
        toast.success(`Firm "${f.name}" created successfully!`);
      } else {
        toast.success(
          r.status === "invited"
            ? `Firm created — invite sent to ${f.ownerEmail}`
            : "Firm created and existing account linked",
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
    <Dialog open={open} onOpenChange={(o) => !o && resetAll()}>
      <DialogContent className="max-w-lg">
        {createdResult ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <Sparkles className="h-6 w-6" />
              </div>
              <DialogTitle className="text-center">
                Firm Created: {createdResult.firmName}
              </DialogTitle>
              <DialogDescription className="text-center">
                Owner account created for{" "}
                <span className="font-semibold text-foreground">{createdResult.email}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              {/* 6-Digit OTP Box */}
              {createdResult.otpCode && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                    <span className="font-semibold text-foreground">6-Digit Security OTP</span>
                    <span className="text-[11px] text-muted-foreground">Valid for 7 days</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-2xl font-bold tracking-[0.25em] text-primary">
                      {createdResult.otpCode}
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

              {/* Direct Link Box */}
              {createdResult.link && (
                <div className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                    <span className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 text-primary" /> Direct Owner Login Link:
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={createdResult.link}
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

              {/* Share Actions */}
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
                {createdResult.link && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/40"
                    onClick={() => window.open(createdResult.link, "_blank", "noopener,noreferrer")}
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
              <DialogTitle>Create a new firm</DialogTitle>
              <DialogDescription>
                A direct activation link will be generated for the firm owner.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3.5">
              <AvatarPicker name={f.name} value={logo} onChange={setLogo} square />
              <Field label="Firm name">
                <Input
                  required
                  value={f.name}
                  onChange={set("name")}
                  placeholder="e.g. Mehta & Associates"
                />
              </Field>
              <Field label="Owner full name">
                <Input
                  required
                  value={f.ownerName}
                  onChange={set("ownerName")}
                  placeholder="e.g. Rajesh Kumar"
                />
              </Field>
              <Field label="Owner email">
                <Input
                  required
                  type="email"
                  value={f.ownerEmail}
                  onChange={set("ownerEmail")}
                  placeholder="ca.owner@firm.com"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <Input value={f.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
                </Field>
                <Field label="City">
                  <Input value={f.city} onChange={set("city")} placeholder="e.g. Mumbai" />
                </Field>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? "Creating…" : "Create firm"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
