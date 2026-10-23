import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/app/DataTable";
import { ClientSelect, Field, NativeSelect, NoAccess, PageHeader } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";
import { useCurrentFirm } from "@/hooks/use-firm";
import { ReportCharts } from "@/components/app/ReportCharts";
import {
  ageingBucket,
  daysBetween,
  downloadCsv,
  fmtDate,
  fmtDateTime,
  FREQS,
  inr,
  invoiceDisplayStatus,
  jobDisplayStatus,
  label,
  MODES,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — AJ's Chartered Desk" },
      { name: "description", content: "Practice and financial reports." },
    ],
  }),
  component: ReportsPage,
});

const REPORTS = [
  "Client Report",
  "Service Report",
  "Job Status Report",
  "Job History Report",
  "Invoice Report",
  "Collection Report",
  "Payment Mode Report",
  "Payment Clearing Report",
  "Outstanding Report",
  "Ageing Report",
  "Cash Collection Report",
  "Bank Collection Report",
  "UPI Collection Report",
  "Unallocated Payment Report",
  "Reconciliation Report",
  "Audit Report",
];
type Row = Record<string, string | number> & { id: string };

function ReportsPage() {
  const { isFinance, isManager, loading } = useRoles();
  const { data: currentFirm } = useCurrentFirm();
  const [r, setR] = useState(REPORTS[0]);
  const [f, setF] = useState({ from: "", to: "", client: "", service: "" });
  const [activeRange, setActiveRange] = useState<string>("ALL");

  const setRangeDays = (label: string, days: number | null) => {
    setActiveRange(label);
    if (days === null) {
      setF((p) => ({ ...p, from: "", to: "" }));
      return;
    }
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setF((p) => ({
      ...p,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    }));
  };
  const q = useQuery({
    queryKey: ["report-data", currentFirm?.id],
    enabled: isFinance && Boolean(currentFirm?.id),
    queryFn: async () => {
      const [c, s, j, h, i, p, a, b, au] = await Promise.all([
        supabase.from("clients").select("*"),
        supabase.from("services").select("*"),
        supabase.from("jobs").select("*, clients(name), services(name)"),
        supabase
          .from("job_status_history")
          .select("*, jobs(job_code,title,client_id,service_id)")
          .order("changed_at", { ascending: false }),
        supabase.from("invoices").select("*, clients(name), invoice_items(jobs(service_id))"),
        supabase.from("payments").select("*, clients(name)"),
        supabase
          .from("payment_allocations")
          .select("*, payments(payment_code,client_id,clients(name)), invoices(invoice_no)"),
        supabase.from("bank_transactions").select("*"),
        isManager
          ? supabase
              .from("audit_logs")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(1000)
          : Promise.resolve({ data: [] }),
      ]);
      return {
        c: c.data ?? [],
        s: s.data ?? [],
        j: j.data ?? [],
        h: h.data ?? [],
        i: i.data ?? [],
        p: p.data ?? [],
        a: a.data ?? [],
        b: b.data ?? [],
        au: au.data ?? [],
      };
    },
  });
  const d = q.data;
  const inRange = (dt?: string | null) =>
    !dt || ((!f.from || dt.slice(0, 10) >= f.from) && (!f.to || dt.slice(0, 10) <= f.to));
  const okC = (id?: string | null) => !f.client || id === f.client;
  const okS = (id?: string | null) => !f.service || id === f.service;

  const rows: Row[] = useMemo(() => {
    if (!d) return [];
    const pay = (mode?: string) =>
      d.p
        .filter(
          (p) =>
            p.status !== "reversed" &&
            (!mode || p.mode === mode) &&
            okC(p.client_id) &&
            inRange(p.payment_date),
        )
        .map((p) => ({
          id: p.id,
          Payment: p.payment_code,
          Date: fmtDate(p.payment_date),
          Client: p.clients?.name ?? "",
          Mode: MODES[p.mode],
          Reference: p.reference ?? "",
          Amount: inr(p.amount),
          Status: label(p.status),
        }));
    switch (r) {
      case "Client Report":
        return d.c
          .filter((c) => okC(c.id) && inRange(c.created_at))
          .map((c) => ({
            id: c.id,
            ID: c.client_code,
            Name: c.name,
            Type: c.client_type,
            PAN: c.pan ?? "",
            GSTIN: c.gstin ?? "",
            Mobile: c.mobile ?? "",
            Status: label(c.status),
            Created: fmtDate(c.created_at),
          }));
      case "Service Report":
        return d.s
          .filter((s) => okS(s.id))
          .map((s) => {
            const js = d.j.filter(
              (j) => j.service_id === s.id && okC(j.client_id) && inRange(j.created_at),
            );
            return {
              id: s.id,
              Service: s.name,
              Type: s.service_type,
              Frequency: FREQS[s.frequency],
              Jobs: js.length,
              Completed: js.filter((j) => j.status === "completed").length,
              "Job Value": inr(js.reduce((a, j) => a + Number(j.net_amount), 0)),
            };
          });
      case "Job Status Report":
        return d.j
          .filter((j) => okC(j.client_id) && okS(j.service_id) && inRange(j.due_date))
          .map((j) => ({
            id: j.id,
            Job: j.job_code,
            Title: j.title,
            Client: j.clients?.name ?? "",
            Service: j.services?.name ?? "",
            Due: fmtDate(j.due_date),
            Net: inr(j.net_amount),
            Status: label(jobDisplayStatus(j)),
            Billing: label(j.financial_status),
          }));
      case "Job History Report":
        return d.h
          .filter((h) => okC(h.jobs?.client_id) && okS(h.jobs?.service_id) && inRange(h.changed_at))
          .map((h) => ({
            id: h.id,
            Job: h.jobs?.job_code ?? "",
            Title: h.jobs?.title ?? "",
            From: label(h.old_status),
            To: label(h.new_status),
            Reason: h.reason ?? "",
            When: fmtDateTime(h.changed_at),
          }));
      case "Invoice Report":
        return d.i
          .filter(
            (i) =>
              okC(i.client_id) &&
              (!f.service || i.invoice_items.some((x) => x.jobs?.service_id === f.service)) &&
              inRange(i.invoice_date),
          )
          .map((i) => ({
            id: i.id,
            Invoice: i.invoice_no,
            Date: fmtDate(i.invoice_date),
            Client: i.clients?.name ?? "",
            Subtotal: inr(i.subtotal),
            Discount: inr(i.discount),
            Tax: inr(i.tax_amount),
            Total: inr(i.total),
            Paid: inr(i.amount_paid),
            Outstanding: inr(i.outstanding),
            Status: label(invoiceDisplayStatus(i)),
          }));
      case "Collection Report":
        return pay();
      case "Cash Collection Report":
        return pay("cash");
      case "Bank Collection Report":
        return pay("bank");
      case "UPI Collection Report":
        return pay("upi");
      case "Payment Mode Report":
        return Object.entries(MODES).map(([k, v]) => {
          const ps = d.p.filter(
            (p) =>
              p.mode === k &&
              p.status !== "reversed" &&
              okC(p.client_id) &&
              inRange(p.payment_date),
          );
          return {
            id: k,
            Mode: v,
            Count: ps.length,
            Amount: inr(ps.reduce((a, p) => a + Number(p.amount), 0)),
          };
        });
      case "Payment Clearing Report":
        return d.a
          .filter((a) => okC(a.payments?.client_id) && inRange(a.created_at))
          .map((a) => ({
            id: a.id,
            Payment: a.payments?.payment_code ?? "",
            Client: a.payments?.clients?.name ?? "",
            Invoice: a.invoices?.invoice_no ?? "",
            Amount: inr(a.amount),
            Date: fmtDate(a.created_at),
            Status: a.reversed ? "Reversed" : "Active",
          }));
      case "Outstanding Report":
      case "Ageing Report": {
        const invRows = d.i
          .filter(
            (i) =>
              i.status !== "cancelled" &&
              Number(i.outstanding) > 0 &&
              okC(i.client_id) &&
              inRange(i.invoice_date),
          )
          .map((i) => ({
            id: i.id,
            Type: "Invoice",
            Reference: i.invoice_no,
            Client: i.clients?.name ?? "",
            Date: fmtDate(i.invoice_date),
            Due: fmtDate(i.due_date),
            Total: inr(i.total),
            Paid: inr(i.amount_paid),
            Outstanding: inr(i.outstanding),
            "Days Overdue": Math.max(0, daysBetween(i.due_date)),
            Bucket: ageingBucket(i.due_date),
          }));

        const jobRows = d.j
          .filter(
            (j) =>
              j.status === "completed" &&
              j.financial_status === "open" &&
              Number(j.net_amount || 0) > 0 &&
              okC(j.client_id) &&
              okS(j.service_id) &&
              inRange(j.due_date),
          )
          .map((j) => ({
            id: j.id,
            Type: "Completed Job",
            Reference: j.job_code,
            Client: j.clients?.name ?? "",
            Date: fmtDate(j.created_at),
            Due: fmtDate(j.due_date),
            Total: inr(j.net_amount),
            Paid: inr(0),
            Outstanding: inr(j.net_amount),
            "Days Overdue": Math.max(0, daysBetween(j.due_date)),
            Bucket: ageingBucket(j.due_date),
          }));

        return [...invRows, ...jobRows];
      }
      case "Unallocated Payment Report":
        return d.p
          .filter(
            (p) =>
              p.status !== "reversed" &&
              Number(p.amount) > Number(p.allocated_amount) &&
              okC(p.client_id) &&
              inRange(p.payment_date),
          )
          .map((p) => ({
            id: p.id,
            Payment: p.payment_code,
            Client: p.clients?.name ?? "",
            Date: fmtDate(p.payment_date),
            Amount: inr(p.amount),
            Unallocated: inr(Number(p.amount) - Number(p.allocated_amount)),
          }));
      case "Reconciliation Report":
        return d.b
          .filter((b) => inRange(b.txn_date))
          .map((b) => ({
            id: b.id,
            Date: fmtDate(b.txn_date),
            Description: b.description ?? "",
            Reference: b.reference ?? "",
            Amount: inr(b.amount),
            "Dr/Cr": label(b.direction),
            Status: label(b.status),
          }));
      case "Audit Report":
        return d.au
          .filter((a) => inRange(a.created_at))
          .map((a) => ({
            id: String(a.id),
            When: fmtDateTime(a.created_at),
            Module: label(a.module),
            Action: label(a.action),
            Record: a.record_id ?? "",
            Reason: a.reason ?? "",
          }));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, r, f]);

  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  const cols = rows[0] ? Object.keys(rows[0]).filter((k) => k !== "id") : [];
  const exportRows = rows.map(({ id: _id, ...rest }) => rest);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={r}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" />
              Print / PDF
            </Button>
            <Button
              onClick={() => downloadCsv(`${r.replace(/\s/g, "_")}.csv`, exportRows)}
              disabled={!rows.length}
            >
              <Download className="mr-1 h-4 w-4" />
              Export CSV
            </Button>
          </>
        }
      />
      <div className="no-print mb-4 rounded-lg border bg-card p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Quick Period Filter
          </div>
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
            {[
              { label: "1M", days: 30 },
              { label: "2M", days: 60 },
              { label: "3M", days: 90 },
              { label: "6M", days: 180 },
              { label: "1Y", days: 365 },
              { label: "ALL", days: null },
            ].map((rng) => (
              <button
                key={rng.label}
                type="button"
                onClick={() => setRangeDays(rng.label, rng.days)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activeRange === rng.label
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {rng.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Report">
            <NativeSelect value={r} onChange={(e) => setR(e.target.value)}>
              {REPORTS.filter((x) => isManager || x !== "Audit Report").map((x) => (
                <option key={x}>{x}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="From">
            <Input
              type="date"
              value={f.from}
              onChange={(e) => {
                setActiveRange("");
                setF({ ...f, from: e.target.value });
              }}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={f.to}
              onChange={(e) => {
                setActiveRange("");
                setF({ ...f, to: e.target.value });
              }}
            />
          </Field>
          <Field label="Client">
            <ClientSelect
              value={f.client}
              onChange={(id) => setF({ ...f, client: id })}
              clients={d?.c}
              placeholder="All clients"
              allowClear
            />
          </Field>
          <Field label="Service">
            <NativeSelect
              value={f.service}
              onChange={(e) => setF({ ...f, service: e.target.value })}
            >
              <option value="">All</option>
              {d?.s.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </div>
      {d && (
        <ReportCharts
          data={{
            i: d.i.filter((i) => okC(i.client_id) && inRange(i.invoice_date)),
            p: d.p.filter((p) => okC(p.client_id) && inRange(p.payment_date)),
            j: d.j.filter((j) => okC(j.client_id) && okS(j.service_id) && inRange(j.due_date)),
            b: d.b.filter((b) => inRange(b.txn_date)),
          }}
        />
      )}
      <DataTable
        key={r}
        rows={rows}
        loading={q.isLoading}
        pageSize={25}
        empty="No data for these filters."
        search={(x) => Object.values(x).join(" ")}
        columns={cols.map((k) => ({
          key: k,
          header: k,
          sort: (x: Row) => x[k],
          align: /Amount|Total|Paid|Outstanding|Subtotal|Discount|Tax|Net|Value|Unallocated/.test(k)
            ? ("right" as const)
            : undefined,
        }))}
      />
    </div>
  );
}
