import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, Lock, Unlock, Plus, Building2, Check, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, NoAccess, PageHeader } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";
import { useCurrentFirm, useSuperAdmin, useUserFirms } from "@/hooks/use-firm";
import { useAdminPrivacy } from "@/hooks/use-admin-privacy";
import { AvatarPicker } from "@/components/app/EntityAvatar";
import { registerPracticeFirm, switchActiveFirm } from "@/lib/firms.functions";
import { errMsg } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Firm registration, multi-firm management, and administration settings.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { isManager, loading: rolesLoading } = useRoles();
  const { isSuperAdmin, loading: saLoading } = useSuperAdmin();
  const { privacyMode, setPrivacyMode } = useAdminPrivacy();
  const qc = useQueryClient();
  const { data: currentFirm } = useCurrentFirm();
  const { data: userFirms } = useUserFirms();

  const [registerOpen, setRegisterOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["settings", currentFirm?.id],
    queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data,
  });

  useEffect(() => {
    if (q.data) {
      setF(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, String(v ?? "")])));
    }
  }, [q.data]);

  useEffect(() => {
    setLogo(currentFirm?.logo_url ?? null);
  }, [currentFirm?.logo_url]);

  if (rolesLoading || saLoading) return null;
  if (!isManager && !isSuperAdmin) return <NoAccess />;

  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const saveCurrentFirm = async () => {
    if (!f.firm_name?.trim()) return toast.error("Firm name is required");
    if (!q.data) return toast.error("Settings not found for this firm");
    const { error } = await supabase
      .from("settings")
      .update({
        firm_name: f.firm_name.trim(),
        address: f.address,
        gstin: f.gstin?.toUpperCase().trim(),
        pan: f.pan?.toUpperCase().trim(),
        phone: f.phone?.trim(),
        email: f.email?.trim(),
        bank_details: f.bank_details,
        default_tax_rate: Number(f.default_tax_rate || 0),
        invoice_terms: f.invoice_terms,
      })
      .eq("id", q.data.id);

    if (!error && q.data.firm_id) {
      await supabase
        .from("firms")
        .update({ name: f.firm_name.trim(), logo_url: logo })
        .eq("id", q.data.firm_id);
    }
    if (error) return toast.error(errMsg(error));
    toast.success("Firm settings saved successfully");
    qc.invalidateQueries();
  };

  const handleSwitchFirm = async (firmId: string) => {
    try {
      await switchActiveFirm({ data: { firmId } });
    } catch {
      const { error } = await supabase.rpc("set_acting_firm", {
        _firm_id: firmId,
      });
      if (error) return toast.error(errMsg(error));
    }
    toast.success("Active firm switched");
    qc.invalidateQueries();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Settings & Multi-Firm Management"
        subtitle="Manage your registered practice entities, billing details, and workspace preferences."
        actions={
          isManager || isSuperAdmin ? (
            <Button onClick={() => setRegisterOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Register New Firm / Company Name
            </Button>
          ) : undefined
        }
      />

      {/* Super Admin Privacy Control */}
      {isSuperAdmin && (
        <div className="flex items-center justify-between rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {privacyMode ? (
                <Lock className="h-4 w-4 text-slate-400" />
              ) : (
                <Unlock className="h-4 w-4 text-emerald-500" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold">Platform Privacy Controls</div>
              <div className="text-xs text-muted-foreground">
                {privacyMode ? "Restricted Super Admin View" : "Full Console View"}
              </div>
            </div>
          </div>
          <Switch
            checked={!privacyMode}
            onCheckedChange={(unlocked) => setPrivacyMode(!unlocked)}
          />
        </div>
      )}

      {/* Registered Firms List */}
      <Card className="shadow-none">
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">
                Registered Firms &amp; Practice Entities
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                All practice firms registered under your AJ's Chartered Desk account. Switch between firms or
                register additional legal entities.
              </CardDescription>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {userFirms?.length ?? 1} firm{(userFirms?.length ?? 1) === 1 ? "" : "s"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {userFirms?.map((uFirm) => {
              const isCurrent = uFirm.id === currentFirm?.id;
              return (
                <div
                  key={uFirm.id}
                  className={`flex flex-col justify-between rounded-lg border p-4 transition-all ${
                    isCurrent
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/60 hover:border-primary/40 bg-card"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted border font-semibold text-primary">
                      {uFirm.logo_url ? (
                        <img
                          src={uFirm.logo_url}
                          alt=""
                          className="h-full w-full object-contain rounded-lg"
                        />
                      ) : (
                        uFirm.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate text-foreground">
                          {uFirm.name}
                        </span>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                            <Check className="h-3 w-3" /> Active
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {uFirm.city ? `${uFirm.city} • ` : ""}
                        {uFirm.owner_email || uFirm.phone || "Active"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2 border-t pt-2.5">
                    {!isCurrent ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs font-medium"
                        onClick={() => handleSwitchFirm(uFirm.id)}
                      >
                        Switch to this Firm
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground font-medium">
                        Currently Editing
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Active Firm Profile Settings */}
      {currentFirm && (
        <Card className="shadow-none">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-semibold">
              Edit Active Firm: {currentFirm.name}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Configure name, GSTIN, PAN, bank account, and invoice billing parameters for the
              currently active firm.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <AvatarPicker name={f.firm_name} value={logo} onChange={setLogo} square />
              </div>

              <Field label="Firm / Company Name *" className="sm:col-span-2">
                <Input
                  value={f.firm_name ?? ""}
                  onChange={set("firm_name")}
                  placeholder="e.g. Sharma & Associates CA"
                />
              </Field>

              <Field label="Registered Address" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={f.address ?? ""}
                  onChange={set("address")}
                  placeholder="Office address"
                />
              </Field>

              <Field label="GSTIN">
                <Input
                  value={f.gstin ?? ""}
                  onChange={set("gstin")}
                  className="uppercase font-mono"
                  placeholder="27ABCDE1234F1Z5"
                  maxLength={15}
                />
              </Field>

              <Field label="PAN">
                <Input
                  value={f.pan ?? ""}
                  onChange={set("pan")}
                  className="uppercase font-mono"
                  placeholder="ABCDE1234F"
                  maxLength={10}
                />
              </Field>

              <Field label="Official Phone">
                <Input
                  value={f.phone ?? ""}
                  onChange={set("phone")}
                  placeholder="+91 98765 43210"
                />
              </Field>

              <Field label="Billing Email">
                <Input
                  value={f.email ?? ""}
                  onChange={set("email")}
                  placeholder="billing@firm.com"
                />
              </Field>

              <Field label="Default GST Rate (%)">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={f.default_tax_rate ?? ""}
                  onChange={set("default_tax_rate")}
                  placeholder="18"
                />
              </Field>

              <Field label="Bank Details (Printed on Invoices)" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={f.bank_details ?? ""}
                  onChange={set("bank_details")}
                  placeholder="Bank Name: HDFC Bank&#10;A/C No: 50200012345678&#10;IFSC: HDFC0001234&#10;UPI ID: firm@hdfcbank"
                />
              </Field>

              <Field
                label="Invoice Notes / Default Terms (Printed on Invoices)"
                className="sm:col-span-2"
              >
                <Textarea
                  rows={2}
                  value={f.invoice_terms ?? ""}
                  onChange={set("invoice_terms")}
                  placeholder="e.g. Terms: Payment due within 15 days. Subject to local jurisdiction."
                />
              </Field>
            </div>

            <div className="pt-2">
              <Button onClick={saveCurrentFirm}>Save Active Firm Settings</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Register New Firm Modal */}
      {registerOpen && <RegisterFirmDialog open={registerOpen} onOpenChange={setRegisterOpen} />}
    </div>
  );
}

function RegisterFirmDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    city: "",
    phone: "",
    address: "",
    gstin: "",
    pan: "",
    bank_details: "",
    default_tax_rate: "18",
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleRegister = async () => {
    if (!form.name.trim()) return toast.error("Firm name is required");

    setSaving(true);
    try {
      try {
        await registerPracticeFirm({
          data: {
            name: form.name.trim(),
            phone: form.phone.trim() || null,
            city: form.city.trim() || null,
            logoUrl: logo,
            address: form.address.trim() || null,
            gstin: form.gstin.toUpperCase().trim() || null,
            pan: form.pan.toUpperCase().trim() || null,
            bankDetails: form.bank_details.trim() || null,
            defaultTaxRate: Number(form.default_tax_rate) || 18,
          },
        });
      } catch (srvErr) {
        // Fallback to RPC if server function fails
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).rpc("register_firm", {
          _name: form.name.trim(),
          _phone: form.phone.trim() || null,
          _city: form.city.trim() || null,
          _logo_url: logo,
          _address: form.address.trim() || null,
          _gstin: form.gstin.toUpperCase().trim() || null,
          _pan: form.pan.toUpperCase().trim() || null,
          _bank_details: form.bank_details.trim() || null,
          _default_tax_rate: Number(form.default_tax_rate) || 0,
        });
        if (error) throw error;
      }

      toast.success("New firm registered and set as active!");
      qc.invalidateQueries();
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register New Firm Entity — AJ's Chartered Desk</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-4">
            <AvatarPicker name={form.name} value={logo} onChange={setLogo} square />
            <div className="text-xs text-muted-foreground">
              Upload company logo or letterhead badge for this firm.
            </div>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Firm Name *" className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={set("name")}
                placeholder="e.g. Apex Tax Advisors LLP"
              />
            </Field>

            <Field label="City / Region">
              <Input value={form.city} onChange={set("city")} placeholder="e.g. Mumbai" />
            </Field>

            <Field label="Phone">
              <Input value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
            </Field>

            <Field label="Address" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.address}
                onChange={set("address")}
                placeholder="Registered office address"
              />
            </Field>

            <Field label="GSTIN">
              <Input
                value={form.gstin}
                onChange={set("gstin")}
                className="uppercase font-mono"
                placeholder="27ABCDE1234F1Z5"
                maxLength={15}
              />
            </Field>

            <Field label="PAN">
              <Input
                value={form.pan}
                onChange={set("pan")}
                className="uppercase font-mono"
                placeholder="ABCDE1234F"
                maxLength={10}
              />
            </Field>

            <Field label="Default GST %">
              <Input
                type="number"
                min={0}
                value={form.default_tax_rate}
                onChange={set("default_tax_rate")}
                placeholder="18"
              />
            </Field>

            <Field label="Bank Details" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.bank_details}
                onChange={set("bank_details")}
                placeholder="Bank Name, A/C No, IFSC, UPI"
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleRegister} disabled={saving}>
            {saving ? "Registering…" : "Register Firm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
