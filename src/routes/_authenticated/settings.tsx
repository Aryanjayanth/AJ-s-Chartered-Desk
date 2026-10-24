import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Save, Database, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, NoAccess, PageHeader } from "@/components/app/common";
import { CompleteBackupButton } from "@/components/app/CompleteBackupButton";
import { ClearDataDialog } from "@/components/app/ClearDataDialog";
import { useRoles } from "@/hooks/use-roles";
import { useCurrentFirm, useSuperAdmin } from "@/hooks/use-firm";
import { AvatarPicker } from "@/components/app/EntityAvatar";
import { errMsg } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Firm Settings — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Configure your firm profile, tax information, and invoice billing details.",
      },
    ],
  }),
  component: SettingsPage,
});

export function SettingsPage() {
  const { isManager, loading: rolesLoading } = useRoles();
  const { isSuperAdmin, loading: saLoading } = useSuperAdmin();
  const qc = useQueryClient();
  const { data: currentFirm } = useCurrentFirm();

  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Record<string, string>>({
    firm_name: "",
    address: "",
    gstin: "",
    pan: "",
    phone: "",
    email: "",
    bank_details: "",
    default_tax_rate: "0",
    invoice_terms: "",
  });
  const [logo, setLogo] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["settings", currentFirm?.id],
    queryFn: async () => {
      if (currentFirm?.id) {
        const { data } = await supabase
          .from("settings")
          .select("*")
          .eq("firm_id", currentFirm.id)
          .maybeSingle();
        if (data) return data;
      }
      return (await supabase.from("settings").select("*").maybeSingle()).data;
    },
  });

  useEffect(() => {
    if (q.data) {
      // Check if values in database are the demo seed data; if so, keep them blank so user enters real data
      const isDemoFirm =
        q.data.firm_name === "Sharma & Associates, Chartered Accountants" ||
        q.data.firm_name === "Default Firm";
      const isDemoAddress = q.data.address === "2nd Floor, MG Road, Bengaluru 560001";
      const isDemoGstin = q.data.gstin === "29AAAFS1234K1Z5";

      setF({
        firm_name: isDemoFirm
          ? currentFirm?.name &&
            currentFirm.name !== "Sharma & Associates, Chartered Accountants" &&
            currentFirm.name !== "Default Firm"
            ? currentFirm.name
            : ""
          : q.data.firm_name || "",
        address: isDemoAddress ? "" : q.data.address || "",
        gstin: isDemoGstin ? "" : q.data.gstin || "",
        pan: q.data.pan || "",
        phone: q.data.phone || currentFirm?.phone || "",
        email: q.data.email || currentFirm?.owner_email || "",
        bank_details: q.data.bank_details || "",
        default_tax_rate: q.data.default_tax_rate != null ? String(q.data.default_tax_rate) : "0",
        invoice_terms: q.data.invoice_terms || "",
      });
    } else if (currentFirm) {
      const isDemoFirm =
        currentFirm.name === "Sharma & Associates, Chartered Accountants" ||
        currentFirm.name === "Default Firm";
      setF({
        firm_name: isDemoFirm ? "" : currentFirm.name || "",
        address: "",
        gstin: "",
        pan: "",
        phone: currentFirm.phone || "",
        email: currentFirm.owner_email || "",
        bank_details: "",
        default_tax_rate: "0",
        invoice_terms: "",
      });
    }
  }, [q.data, currentFirm]);

  useEffect(() => {
    setLogo(currentFirm?.logo_url ?? null);
  }, [currentFirm?.logo_url]);

  if (rolesLoading || saLoading) return null;
  if (!isManager && !isSuperAdmin) return <NoAccess />;

  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const saveCurrentFirm = async () => {
    if (!f.firm_name?.trim()) return toast.error("Firm name is required");

    setSaving(true);
    try {
      const firmId = currentFirm?.id;

      // 1. Update or Insert settings record
      if (q.data?.id) {
        const { error } = await supabase
          .from("settings")
          .update({
            firm_name: f.firm_name.trim(),
            address: f.address?.trim() || null,
            gstin: f.gstin?.toUpperCase().trim() || null,
            pan: f.pan?.toUpperCase().trim() || null,
            phone: f.phone?.trim() || null,
            email: f.email?.trim() || null,
            bank_details: f.bank_details?.trim() || null,
            default_tax_rate: Number(f.default_tax_rate || 0),
            invoice_terms: f.invoice_terms?.trim() || null,
          })
          .eq("id", q.data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("settings").insert({
          firm_id: firmId || undefined,
          firm_name: f.firm_name.trim(),
          address: f.address?.trim() || null,
          gstin: f.gstin?.toUpperCase().trim() || null,
          pan: f.pan?.toUpperCase().trim() || null,
          phone: f.phone?.trim() || null,
          email: f.email?.trim() || null,
          bank_details: f.bank_details?.trim() || null,
          default_tax_rate: Number(f.default_tax_rate || 0),
          invoice_terms: f.invoice_terms?.trim() || null,
        });
        if (error) throw error;
      }

      // 2. Sync firm name, logo, phone to firms table
      if (firmId) {
        await supabase
          .from("firms")
          .update({
            name: f.firm_name.trim(),
            logo_url: logo,
            phone: f.phone?.trim() || null,
          })
          .eq("id", firmId);
      }

      toast.success("Firm settings saved successfully");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["current-firm"] });
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Firm Settings"
        subtitle="Configure your firm's identity, contact information, tax registration, and billing details."
        actions={
          <CompleteBackupButton
            variant="outline"
            size="sm"
            className="border-border/80 font-medium text-xs h-8"
            label="Complete Backup"
          />
        }
      />

      <Card className="shadow-none border">
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Practice Identity & Profile</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Basic information about your practice. This is displayed on client invoices and
            receipts.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <AvatarPicker name={f.firm_name} value={logo} onChange={setLogo} square />
            </div>

            <Field label="Firm / Practice Name *" className="sm:col-span-2">
              <Input
                value={f.firm_name ?? ""}
                onChange={set("firm_name")}
                placeholder="Enter firm name"
              />
            </Field>

            <Field label="Registered Office Address" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={f.address ?? ""}
                onChange={set("address")}
                placeholder="Enter office address"
              />
            </Field>

            <Field label="Official Phone">
              <Input
                value={f.phone ?? ""}
                onChange={set("phone")}
                placeholder="Enter phone number"
              />
            </Field>

            <Field label="Billing Email">
              <Input
                type="email"
                value={f.email ?? ""}
                onChange={set("email")}
                placeholder="Enter billing email"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none border">
        <CardHeader className="pb-4 border-b">
          <CardTitle className="text-base font-semibold">Tax & Registration</CardTitle>
          <CardDescription className="text-xs">
            Official GST and PAN numbers for tax compliance.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="GSTIN">
              <Input
                value={f.gstin ?? ""}
                onChange={set("gstin")}
                className="uppercase font-mono"
                placeholder="Enter GSTIN"
                maxLength={15}
              />
            </Field>

            <Field label="PAN">
              <Input
                value={f.pan ?? ""}
                onChange={set("pan")}
                className="uppercase font-mono"
                placeholder="Enter PAN"
                maxLength={10}
              />
            </Field>

            <Field label="Default GST Rate (%)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={f.default_tax_rate ?? ""}
                onChange={set("default_tax_rate")}
                placeholder="0"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none border">
        <CardHeader className="pb-4 border-b">
          <CardTitle className="text-base font-semibold">Bank Details & Invoice Notes</CardTitle>
          <CardDescription className="text-xs">
            Payment instructions and terms that are printed on your client invoices and receipts.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <Field label="Bank Details (Printed on Invoices)">
            <Textarea
              rows={3}
              value={f.bank_details ?? ""}
              onChange={set("bank_details")}
              placeholder="Bank Name, Account Number, IFSC Code, UPI ID"
            />
          </Field>

          <Field label="Default Invoice Terms & Conditions">
            <Textarea
              rows={2}
              value={f.invoice_terms ?? ""}
              onChange={set("invoice_terms")}
              placeholder="Terms and payment conditions to print on invoices..."
            />
          </Field>
        </CardContent>
      </Card>

      {/* Complete Backup for Admins */}
      <Card className="shadow-none border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Firm Data Backup & Disaster Recovery
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Download a complete, offline Excel backup containing all data in your practice
                (Clients, Services, Retainers, Jobs, Invoices, Payments, Expenses, and Settings).
              </CardDescription>
            </div>
            <CompleteBackupButton
              variant="default"
              className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
              label="Download Complete Backup"
            />
          </div>
        </CardHeader>
      </Card>

      {/* Danger Zone: Clear / Reset Test Data for Admins */}
      {isManager && (
        <Card className="shadow-none border border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Danger Zone: Reset Practice Test Data
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Permanently purge all test clients, compliance jobs, invoices, payments, and settlements.
                  Firm profile, team logins, roles, and master services are kept intact.
                </CardDescription>
              </div>
              <ClearDataDialog
                firmId={currentFirm?.id}
                firmName={currentFirm?.name}
                className="shrink-0"
              />
            </div>
          </CardHeader>
        </Card>
      )}

      <div className="flex items-center justify-end pt-2 pb-6">
        <Button onClick={saveCurrentFirm} disabled={saving} className="px-6 gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
