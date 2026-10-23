import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Briefcase, Receipt, ArrowRight, RotateCcw, Search, ReceiptIndianRupee } from "lucide-react";
import { DataTable } from "@/components/app/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ClientSelect,
  NativeSelect,
  NoAccess,
  PageHeader,
  StatCard,
  DateRangePicker,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { useReceivables, type ReceivableItem } from "@/hooks/use-receivables";
import { supabase } from "@/integrations/supabase/client";
import {
  ageingBucket,
  BUCKETS,
  daysBetween,
  downloadCsv,
  errMsg,
  fmtDate,
  inr,
  invoiceDisplayStatus,
  label,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/outstanding")({
  head: () => ({
    meta: [
      { title: "Outstanding — AJ's Chartered Desk" },
      { name: "description", content: "Receivables outstanding across invoices, completed jobs, and client expenses." },
    ],
  }),
  component: OutstandingPage,
});

function OutstandingPage() {
  const { isFinance, loading } = useRoles();
  const { data: profiles } = useProfiles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useReceivables(isFinance);

  const [fl, setFl] = useState({
    type: "",
    client: "",
    service: "",
    staff: "",
    bucket: "",
    status: "",
    from: "",
    to: "",
  });
  const [view, setView] = useState<"client" | "invoice">("client");
  const [clientSearch, setClientSearch] = useState("");

  if (loading) return null;
  if (!isFinance) return <NoAccess />;

  const all = (q.data ?? []).filter((i) => Number(i.outstanding) > 0);

  const svcOf = (i: ReceivableItem) =>
    i.invoice_items
      ?.map((x) => x.jobs?.services?.name)
      .filter(Boolean)
      .join(", ") || i.service_name || i.description;

  const rows = all.filter(
    (i) =>
      (!fl.type || i.type === fl.type) &&
      (!fl.client || i.client_id === fl.client) &&
      (!fl.service ||
        i.service_id === fl.service ||
        i.invoice_items?.some((x) => x.jobs?.service_id === fl.service)) &&
      (!fl.staff || i.clients?.assigned_staff === fl.staff || i.assigned_staff === fl.staff) &&
      (!fl.bucket || ageingBucket(i.due_date) === fl.bucket) &&
      (!fl.status || (i.type === "invoice" ? invoiceDisplayStatus(i) === fl.status : i.status === fl.status)) &&
      (!fl.from || (i.date || i.invoice_date) >= fl.from) &&
      (!fl.to || (i.date || i.invoice_date) <= fl.to),
  );

  const clients = [...new Map(all.map((i) => [i.client_id, i.client_name || i.clients?.name])).entries()];
  const services = [
    ...new Map(
      all
        .flatMap((i) => [
          [i.service_id, i.service_name] as const,
          ...(i.invoice_items?.map((x) => [x.jobs?.service_id, x.jobs?.services?.name] as const) ?? []),
        ])
        .filter(([k, n]) => k && n),
    ).entries(),
  ];

  const s = (k: keyof typeof fl) => (e: { target: { value: string } }) =>
    setFl((p) => ({ ...p, [k]: e.target.value }));

  const sum = (k: "total" | "amount_paid" | "outstanding") =>
    rows.reduce((a, i) => a + Number(i[k] || 0), 0);

  // Category counts
  const invCount = all.filter((i) => i.type === "invoice").length;
  const jobCount = all.filter((i) => i.type === "job").length;
  const expCount = all.filter((i) => i.type === "expense").length;

  const invTotal = all.filter((i) => i.type === "invoice").reduce((a, b) => a + b.outstanding, 0);
  const jobTotal = all.filter((i) => i.type === "job").reduce((a, b) => a + b.outstanding, 0);
  const expTotal = all.filter((i) => i.type === "expense").reduce((a, b) => a + b.outstanding, 0);

  const byClient = Object.values(
    rows.reduce<
      Record<
        string,
        {
          id: string;
          name: string;
          total: number;
          paid: number;
          out: number;
          invoicesOut: number;
          jobsOut: number;
          expensesOut: number;
          itemCount: number;
          br: Record<string, number>;
        }
      >
    >((acc, i) => {
      const c = (acc[i.client_id] ??= {
        id: i.client_id,
        name: i.client_name || i.clients?.name || "Unknown Client",
        total: 0,
        paid: 0,
        out: 0,
        invoicesOut: 0,
        jobsOut: 0,
        expensesOut: 0,
        itemCount: 0,
        br: {},
      });
      c.total += Number(i.total);
      c.paid += Number(i.amount_paid);
      c.out += Number(i.outstanding);
      c.itemCount += 1;

      if (i.type === "invoice") c.invoicesOut += Number(i.outstanding);
      else if (i.type === "job") c.jobsOut += Number(i.outstanding);
      else if (i.type === "expense") c.expensesOut += Number(i.outstanding);

      const ratio = Number(i.outstanding) / Number(i.total || 1);
      if (i.invoice_items && i.invoice_items.length > 0) {
        i.invoice_items.forEach((it) => {
          const n = it.jobs?.services?.name ?? i.service_name ?? "Other";
          c.br[n] = (c.br[n] ?? 0) + Number(it.amount) * ratio;
        });
      } else {
        const n = i.service_name ?? "Other";
        c.br[n] = (c.br[n] ?? 0) + Number(i.outstanding);
      }
      return acc;
    }, {}),
  ).sort((a, b) => b.out - a.out);

  const filteredByClient = byClient.filter(
    (c) =>
      !clientSearch ||
      c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
      Object.keys(c.br).some((k) => k.toLowerCase().includes(clientSearch.toLowerCase())),
  );

  const toolbarContent = (
    <>
      <NativeSelect value={fl.type} onChange={s("type")} className="w-32">
        <option value="">All types</option>
        <option value="invoice">Invoices only</option>
        <option value="job">Completed jobs</option>
        <option value="expense">Client expenses</option>
      </NativeSelect>
      <ClientSelect
        value={fl.client}
        onChange={(id) => setFl((p) => ({ ...p, client: id }))}
        placeholder="All clients"
        className="w-36"
        allowClear
      />
      <NativeSelect value={fl.service} onChange={s("service")} className="w-32">
        <option value="">All services</option>
        {services.map(([id, n]) => (
          <option key={id} value={id!}>
            {n}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect value={fl.staff} onChange={s("staff")} className="w-32">
        <option value="">All staff</option>
        {profiles?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect value={fl.bucket} onChange={s("bucket")} className="w-32">
        <option value="">All ageing</option>
        {BUCKETS.map((b) => (
          <option key={b}>{b}</option>
        ))}
      </NativeSelect>
      <NativeSelect value={fl.status} onChange={s("status")} className="w-32">
        <option value="">All statuses</option>
        {["unpaid", "partially_paid", "unbilled", "unreimbursed", "overdue"].map((x) => (
          <option key={x} value={x}>
            {label(x)}
          </option>
        ))}
      </NativeSelect>
      <DateRangePicker
        from={fl.from}
        to={fl.to}
        onFromChange={(val) => setFl((p) => ({ ...p, from: val }))}
        onToChange={(val) => setFl((p) => ({ ...p, to: val }))}
        label="Date"
      />
      {(fl.type || fl.client || fl.service || fl.staff || fl.bucket || fl.status || fl.from || fl.to) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setFl({
              type: "",
              client: "",
              service: "",
              staff: "",
              bucket: "",
              status: "",
              from: "",
              to: "",
            })
          }
          className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          title="Reset all filters"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      )}
    </>
  );

  return (
    <div>
      <PageHeader
        title="Outstanding"
        subtitle="Unsettled invoices, completed unbilled jobs, and client reimbursable expenses"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 font-medium"
              disabled={!rows.length}
              onClick={() => {
                const stamp = new Date().toISOString().slice(0, 10);
                if (view === "client") {
                  downloadCsv(
                    `outstanding_by_client_${stamp}.csv`,
                    byClient.map((c) => ({
                      Client: c.name,
                      Receivable: c.total,
                      Paid: c.paid,
                      "Invoices Out": c.invoicesOut,
                      "Jobs Out": c.jobsOut,
                      "Expenses Out": c.expensesOut,
                      "Total Outstanding": c.out,
                    })),
                  );
                } else {
                  downloadCsv(
                    `outstanding_items_${stamp}.csv`,
                    rows.map((i) => ({
                      Type: label(i.type),
                      Reference: i.reference_no,
                      Client: i.client_name || i.clients?.name || "",
                      "Service / Description": svcOf(i) || i.description,
                      Date: fmtDate(i.date || i.invoice_date),
                      "Due Date": fmtDate(i.due_date),
                      Ageing: ageingBucket(i.due_date),
                      "Original Amount": i.total,
                      "Paid Amount": i.amount_paid,
                      Outstanding: i.outstanding,
                      Status: label(i.type === "invoice" ? invoiceDisplayStatus(i) : i.status),
                    })),
                  );
                }
              }}
              title="Export filtered outstanding data to CSV"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <NativeSelect
              value={view}
              onChange={(e) => setView(e.target.value as "invoice" | "client")}
              className="w-44"
            >
              <option value="invoice">Item-wise</option>
              <option value="client">Client-wise</option>
            </NativeSelect>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Items"
          value={rows.length}
          help={`${invCount} Invoices • ${jobCount} Completed Jobs • ${expCount} Expenses`}
        />
        <StatCard label="Original Amount" value={inr(sum("total"))} />
        <StatCard label="Paid / Cleared" value={inr(sum("amount_paid"))} tone="success" />
        <StatCard label="Total Outstanding" value={inr(sum("outstanding"))} tone="danger" />
      </div>

      {/* Quick Type Selection Tabs / Badges */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFl((p) => ({ ...p, type: "" }))}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !fl.type
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          <span>All Outstanding</span>
          <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[10px]">
            {all.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFl((p) => ({ ...p, type: p.type === "invoice" ? "" : "invoice" }))}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            fl.type === "invoice"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20"
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          <span>Invoices ({inr(invTotal)})</span>
          <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[10px]">
            {invCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFl((p) => ({ ...p, type: p.type === "job" ? "" : "job" }))}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            fl.type === "job"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
          }`}
        >
          <Briefcase className="h-3.5 w-3.5" />
          <span>Completed Jobs ({inr(jobTotal)})</span>
          <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[10px]">
            {jobCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFl((p) => ({ ...p, type: p.type === "expense" ? "" : "expense" }))}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            fl.type === "expense"
              ? "bg-amber-600 text-white shadow-sm"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Client Expenses ({inr(expTotal)})</span>
          <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[10px]">
            {expCount}
          </span>
        </button>
      </div>

      {view === "invoice" ? (
        <DataTable
          rows={rows}
          loading={q.isLoading}
          empty="Nothing outstanding."
          search={(i) => `${i.reference_no} ${i.client_name || i.clients?.name} ${i.service_name} ${i.description}`}
          exportFilename="outstanding_receivables"
          exportTransform={(i) => ({
            Type: label(i.type),
            Reference: i.reference_no,
            Client: i.client_name || i.clients?.name || "",
            Service: svcOf(i) || i.description,
            Date: fmtDate(i.date || i.invoice_date),
            "Due Date": fmtDate(i.due_date),
            Ageing: ageingBucket(i.due_date),
            "Original Amount": i.total,
            "Paid Amount": i.amount_paid,
            Outstanding: i.outstanding,
            Status: label(i.type === "invoice" ? invoiceDisplayStatus(i) : i.status),
          })}
          toolbar={toolbarContent}
          columns={[
            {
              key: "type",
              header: "Type",
              render: (i) => {
                if (i.type === "invoice") {
                  return (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                      <Receipt className="h-3 w-3" />
                      Invoice
                    </span>
                  );
                }
                if (i.type === "job") {
                  return (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <Briefcase className="h-3 w-3" />
                      Job Done
                    </span>
                  );
                }
                return (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <FileText className="h-3 w-3" />
                    Expense
                  </span>
                );
              },
            },
            {
              key: "c",
              header: "Client",
              sort: (i) => i.client_name || i.clients?.name || "",
              render: (i) => (
                <Link
                  to="/clients/$id"
                  params={{ id: i.client_id }}
                  className="font-medium hover:underline text-foreground"
                >
                  {i.client_name || i.clients?.name}
                </Link>
              ),
            },
            {
              key: "n",
              header: "Ref / Item",
              render: (i) => {
                if (i.type === "invoice") {
                  return (
                    <Link
                      to="/invoices/$id"
                      params={{ id: i.id }}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {i.reference_no}
                    </Link>
                  );
                }
                if (i.type === "job") {
                  return (
                    <Link
                      to="/jobs/$id"
                      params={{ id: i.id }}
                      className="font-mono text-xs text-emerald-600 hover:underline"
                    >
                      {i.reference_no}
                    </Link>
                  );
                }
                return (
                  <Link
                    to="/expenses"
                    className="font-mono text-xs text-amber-600 hover:underline"
                  >
                    {i.reference_no}
                  </Link>
                );
              },
            },
            {
              key: "j",
              header: "Service / Description",
              render: (i) => (
                <div className="max-w-[220px] truncate" title={svcOf(i) || i.description}>
                  <span className="text-xs">{svcOf(i) || i.description}</span>
                </div>
              ),
            },
            { key: "d", header: "Date", render: (i) => fmtDate(i.date || i.invoice_date) },
            {
              key: "dd",
              header: "Due",
              sort: (i) => i.due_date,
              render: (i) => fmtDate(i.due_date),
            },
            { key: "t", header: "Original", align: "right", render: (i) => inr(i.total) },
            { key: "p", header: "Paid", align: "right", render: (i) => inr(i.amount_paid) },
            {
              key: "o",
              header: "Outstanding",
              align: "right",
              sort: (i) => Number(i.outstanding),
              render: (i) => <b>{inr(i.outstanding)}</b>,
            },
            {
              key: "od",
              header: "Days Overdue",
              align: "right",
              sort: (i) => daysBetween(i.due_date),
              render: (i) => Math.max(0, daysBetween(i.due_date)),
            },
            { key: "b", header: "Ageing", render: (i) => ageingBucket(i.due_date) },
            {
              key: "s",
              header: "Status",
              render: (i) => (
                <StatusBadge
                  status={i.type === "invoice" ? invoiceDisplayStatus(i) : i.status}
                />
              ),
            },
            {
              key: "act",
              header: "Action",
              render: (i) => {
                if (i.type === "job") {
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs font-medium border-primary/30 text-primary hover:bg-primary/10 gap-1"
                      asChild
                    >
                      <Link
                        to="/clearing"
                        search={{
                          client: i.client_id,
                          job: i.id,
                        }}
                      >
                        <ReceiptIndianRupee className="h-3 w-3" />
                        Clear Payment
                      </Link>
                    </Button>
                  );
                }
                if (i.type === "invoice") {
                  return (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs font-medium text-primary hover:bg-primary/10 gap-1"
                      asChild
                    >
                      <Link to="/invoices/$id" params={{ id: i.id }}>
                        <span>View</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  );
                }
                return (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 gap-1"
                    asChild
                  >
                    <Link to="/clearing" search={{ client: i.client_id }}>
                      <span>Clear</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                );
              },
            },
          ]}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search clients or services in outstanding..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
            {toolbarContent}
          </div>

          {clientSearch && (
            <div className="text-xs text-muted-foreground">
              Showing {filteredByClient.length} of {byClient.length} clients
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredByClient.length === 0 && (
              <div className="col-span-full rounded-lg border bg-card p-12 text-center text-muted-foreground">
                {clientSearch ? "No clients matching search." : "Nothing outstanding."}
              </div>
            )}
            {filteredByClient.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border bg-card p-4 space-y-3 flex flex-col justify-between hover:border-primary/40 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to="/clients/$id"
                        params={{ id: c.id }}
                        className="font-semibold hover:underline text-foreground text-base block line-clamp-1"
                        title={c.name}
                      >
                        {c.name}
                      </Link>
                      <span className="text-[11px] text-muted-foreground">
                        {c.itemCount} pending {c.itemCount === 1 ? "item" : "items"}
                      </span>
                    </div>
                    <b className="text-base text-destructive tabular-nums shrink-0">{inr(c.out)}</b>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-sm bg-muted/30 p-2.5 rounded-md border border-border/60">
                    <div>
                      <div className="text-xs text-muted-foreground">Receivable</div>
                      <span className="font-medium text-xs tabular-nums">{inr(c.total)}</span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Paid</div>
                      <span className="text-success font-medium text-xs tabular-nums">{inr(c.paid)}</span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Outstanding</div>
                      <b className="text-destructive font-semibold text-xs tabular-nums">{inr(c.out)}</b>
                    </div>
                  </div>

                  {/* Sub-breakdown by item type */}
                  <div className="space-y-1.5 text-xs">
                    {c.invoicesOut > 0 && (
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                          <Receipt className="h-3 w-3" /> Invoices Outstanding
                        </span>
                        <span className="tabular-nums font-medium text-foreground">{inr(c.invoicesOut)}</span>
                      </div>
                    )}
                    {c.jobsOut > 0 && (
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <Briefcase className="h-3 w-3" /> Completed Jobs Unbilled
                        </span>
                        <span className="tabular-nums font-medium text-foreground">{inr(c.jobsOut)}</span>
                      </div>
                    )}
                    {c.expensesOut > 0 && (
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                          <FileText className="h-3 w-3" /> Client Expenses
                        </span>
                        <span className="tabular-nums font-medium text-foreground">{inr(c.expensesOut)}</span>
                      </div>
                    )}
                  </div>

                  {/* Service breakdown */}
                  {Object.keys(c.br).length > 0 && (
                    <div className="border-t pt-2 text-xs space-y-1">
                      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                        Service Breakdown
                      </div>
                      {Object.entries(c.br)
                        .slice(0, 3)
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between">
                            <span className="text-muted-foreground truncate max-w-[180px]">{k}</span>
                            <span className="tabular-nums font-medium">{inr(Math.round(v))}</span>
                          </div>
                        ))}
                      {Object.keys(c.br).length > 3 && (
                        <div className="text-[11px] text-muted-foreground italic">
                          +{Object.keys(c.br).length - 3} more services
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Action Footer */}
                <div className="border-t pt-3 flex items-center justify-between gap-1.5 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs font-medium gap-1 flex-1"
                    onClick={() => {
                      setFl((p) => ({ ...p, client: c.id }));
                      setView("invoice");
                    }}
                  >
                    <span>View {c.itemCount} Items</span>
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs font-medium text-primary hover:bg-primary/10 gap-1 px-2.5"
                    asChild
                  >
                    <Link to="/clearing" search={{ client: c.id }}>
                      <span>Clear</span>
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs font-medium text-muted-foreground hover:text-foreground gap-1 px-2.5"
                    asChild
                  >
                    <Link to="/clients/$id" params={{ id: c.id }}>
                      <span>Ledger</span>
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
