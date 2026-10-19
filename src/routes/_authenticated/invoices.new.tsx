import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  NativeSelect,
  NoAccess,
  PageHeader,
  Section,
  StatCard,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { useCurrentFirm, useUserFirms } from "@/hooks/use-firm";
import { updateInvoiceBillingDetails } from "@/lib/firms.functions";
import { errMsg, fmtDate, inr, today } from "@/lib/format";
import { isWorkflow, type JobWorkflow } from "@/lib/job-workflow";

export const Route = createFileRoute("/_authenticated/invoices/new")({
  head: () => ({
    meta: [
      { title: "Create Invoice — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Raise an invoice for a job whose payment has been squared off.",
      },
    ],
  }),
  component: NewInvoicePage,
});

/**
 * Only jobs the backend will actually accept are offered. `job_workflow` runs
 * the same assertion as `create_invoice_for_job`, so a job listed here is
 * guaranteed to pass -- and anything not listed is blocked at the database even
 * if someone reaches it by URL.
 */
type Candidate = { job: JobWorkflow; jobCode: string; title: string; status: string; clientId?: string };

function NewInvoicePage() {
  const { isFinance, loading } = useRoles();
  const { data: currentFirm } = useCurrentFirm();
  const { data: userFirms } = useUserFirms();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [selectedFirmId, setSelectedFirmId] = useState(currentFirm?.id ?? "");
  const [customInvoiceNo, setCustomInvoiceNo] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    invoice_date: today(),
    due_date: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
    tax_rate: "",
    notes: "",
    extra_desc: "",
    extra_amount: "",
  });

  useEffect(() => {
    if (currentFirm?.id && !selectedFirmId) {
      setSelectedFirmId(currentFirm.id);
    }
  }, [currentFirm?.id, selectedFirmId]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data,
  });

  const jobsQ = useQuery({
    queryKey: ["invoiceable-jobs"],
    enabled: isFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,job_code,title,status,client_id")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const out: Candidate[] = [];
      for (const j of data ?? []) {
        const { data: w } = await supabase.rpc("job_workflow", { _job_id: j.id });
        if (isWorkflow(w)) {
          out.push({
            job: w,
            jobCode: j.job_code,
            title: j.title,
            status: j.status,
            clientId: j.client_id,
          });
        }
      }
      return out;
    },
  });

  const clientsQ = useQuery({
    queryKey: ["job-client-names", "invoiceable"],
    enabled: isFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, clients(client_code, name)")
        .limit(500);
      if (error) throw error;
      const m: Record<string, { client_code: string; name: string }> = {};
      for (const r of data ?? []) {
        const c = (r as { clients?: { client_code: string; name: string } | null }).clients;
        if (c) m[r.id] = c;
      }
      return m;
    },
  });

  const taxRate =
    f.tax_rate === "" ? Number(settings.data?.default_tax_rate ?? 0) : Number(f.tax_rate);

  const picked = (jobsQ.data ?? []).find((c) => c.job.job_id === sel);
  const base = picked ? Number(picked.job.final_amount) : 0;
  const extra = Number(f.extra_amount || 0);
  const sub = base + extra;
  const tax = Math.round(sub * taxRate) / 100;
  const total = sub + tax;

  const eligible = (jobsQ.data ?? []).filter((c) => c.job.invoice_available);
  const blocked = (jobsQ.data ?? []).filter((c) => !c.job.invoice_available);

  const save = async () => {
    if (!picked) return toast.error("Select a job to invoice");
    if (f.due_date < f.invoice_date)
      return toast.error("Due date must not be before the invoice date");
    if (total <= 0) return toast.error("Invoice total must be greater than zero");
    setBusy(true);
    const { data, error } = await supabase.rpc("create_invoice_for_job", {
      _job_id: picked.job.job_id,
      _payment_id: null,
      _invoice_date: f.invoice_date,
      _due_date: f.due_date,
      _tax_rate: taxRate,
      _notes: f.notes.trim(),
      _extra_desc: f.extra_desc.trim(),
      _extra_amount: extra,
    });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    if (data) {
      if (selectedFirmId || customInvoiceNo?.trim()) {
        try {
          await updateInvoiceBillingDetails({
            data: {
              invoiceId: data,
              firmId: selectedFirmId || undefined,
              invoiceNo: customInvoiceNo.trim() || undefined,
            },
          });
        } catch (updateErr) {
          console.warn("Invoice billing details update warning:", updateErr);
        }
      }
    }
    toast.success("Invoice created successfully");
    qc.invalidateQueries();
    if (data) navigate({ to: "/invoices/$id", params: { id: data } });
  };

  if (loading) return null;
  if (!isFinance) return <NoAccess />;

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/invoices"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Invoices</span>
        </Link>
      </div>

      <PageHeader
        title="Create Invoice"
        subtitle="An invoice can only be raised for a job whose payment clearing has been squared off."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section
            title="Select job"
            hint="Only jobs that have cleared payment appear here. This list is produced by the same database check that creates the invoice."
          >
            {jobsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Checking job eligibility…</p>
            ) : eligible.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-sm font-medium">No job is ready to invoice</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  A job becomes eligible once it is completed and its payment clearing is squared
                  off.
                </p>
              </div>
            ) : (
              <ul className="divide-y rounded-lg border">
                {eligible.map((c) => {
                  const cl = clientsQ.data?.[c.job.job_id];
                  const on = sel === c.job.job_id;
                  return (
                    <li key={c.job.job_id}>
                      <button
                        type="button"
                        onClick={() => setSel(on ? null : c.job.job_id)}
                        className={`flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          on ? "bg-primary/10" : "hover:bg-muted/40"
                        }`}
                      >
                        <span
                          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            on
                              ? "border-primary bg-primary text-white"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{c.jobCode}</span>
                        <span className="flex-1 font-medium">{c.title}</span>
                        {cl && (
                          <span className="text-xs text-muted-foreground">
                            {cl.client_code} · {cl.name}
                          </span>
                        )}
                        <StatusBadge status={c.status} />
                        <span className="tabular-nums font-mono">{inr(c.job.final_amount)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {blocked.length > 0 && (
              <details className="mt-4 rounded-lg border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  {blocked.length} job{blocked.length > 1 ? "s" : ""} not yet eligible
                </summary>
                <ul className="divide-y border-t text-sm">
                  {blocked.map((c) => (
                    <li key={c.job.job_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-xs text-muted-foreground">{c.jobCode}</span>
                      <span className="flex-1">{c.title}</span>
                      <span className="text-xs text-muted-foreground">{c.job.blocked_reason}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate({
                            to: "/clearing",
                            search: { client: c.clientId, job: c.job.job_id },
                          })
                        }
                      >
                        Clear payment
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Section>

          <Section title="Invoice details">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Billing Entity / Company *" className="sm:col-span-2">
                <NativeSelect
                  value={selectedFirmId}
                  onChange={(e) => setSelectedFirmId(e.target.value)}
                >
                  {userFirms && userFirms.length > 0 ? (
                    userFirms.map((firm) => (
                      <option key={firm.id} value={firm.id}>
                        {firm.name}
                      </option>
                    ))
                  ) : (
                    <option value={currentFirm?.id ?? ""}>
                      {currentFirm?.name ?? "Default Firm"}
                    </option>
                  )}
                </NativeSelect>
              </Field>
              <Field label="Invoice Number / Pattern" hint="Leave blank for auto sequence">
                <Input
                  value={customInvoiceNo}
                  onChange={(e) => setCustomInvoiceNo(e.target.value)}
                  placeholder="e.g. INV/2026/001"
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Invoice date">
                <Input type="date" value={f.invoice_date} onChange={set("invoice_date")} />
              </Field>
              <Field label="Due date">
                <Input type="date" value={f.due_date} onChange={set("due_date")} />
              </Field>
              <Field
                label="GST %"
                hint={
                  f.tax_rate === "" ? `Default ${settings.data?.default_tax_rate ?? 0}%` : undefined
                }
              >
                <Input type="number" step="0.01" value={f.tax_rate} onChange={set("tax_rate")} />
              </Field>
              <Field label="Additional line" className="sm:col-span-2">
                <Input
                  placeholder="e.g. Consultation charges"
                  value={f.extra_desc}
                  onChange={set("extra_desc")}
                />
              </Field>
              <Field label="Additional amount (₹)">
                <Input
                  type="number"
                  min={0}
                  value={f.extra_amount}
                  onChange={set("extra_amount")}
                />
              </Field>
              <Field label="Notes" className="sm:col-span-3">
                <Textarea rows={2} value={f.notes} onChange={set("notes")} />
              </Field>
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {picked ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Job</span>
                    <span className="font-mono">{picked.jobCode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross fee</span>
                    <span className="tabular-nums">{inr(picked.job.gross_fee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Adjustments</span>
                    <span className="tabular-nums">
                      −
                      {inr(
                        Number(picked.job.advance) +
                          Number(picked.job.tds_tcs) +
                          Number(picked.job.clearing_discount) +
                          Number(picked.job.other_deduction) -
                          Number(picked.job.other_addition),
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Cleared amount</span>
                    <span className="tabular-nums">{inr(base)}</span>
                  </div>
                  {extra > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Additional line</span>
                      <span className="tabular-nums">{inr(extra)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST @ {taxRate}%</span>
                    <span className="tabular-nums">{inr(tax)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 text-base font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{inr(total)}</span>
                  </div>
                  <p className="pt-1 text-xs text-muted-foreground">
                    The invoice is raised on the cleared amount, not the gross job fee, so the
                    square-off and the billed figure always agree.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a job to see the invoice summary.
                </p>
              )}
              <Button className="w-full" disabled={!picked || busy} onClick={save}>
                {busy ? "Creating…" : "Create invoice"}
              </Button>
            </CardContent>
          </Card>

          <StatCard
            label="Eligible jobs"
            value={eligible.length}
            tone={eligible.length ? "success" : "warning"}
            hint="Completed and squared off"
          />
        </div>
      </div>
    </div>
  );
}
