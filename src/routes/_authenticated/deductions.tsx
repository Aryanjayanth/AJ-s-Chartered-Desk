/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BadgePercent,
  Download,
  ExternalLink,
  ChevronDown,
  FileSpreadsheet,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/app/DataTable";
import {
  DateRangePicker,
  NativeSelect,
  NoAccess,
  PageHeader,
  StatCard,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles, useClientLookup } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { fmtDate, inr } from "@/lib/format";
import { downloadCsv, downloadXlsx, type Cell } from "@/lib/io/write";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/deductions")({
  head: () => ({
    meta: [
      { title: "Deductions & TDS — AJ's Chartered Desk" },
      {
        name: "description",
        content:
          "Practice register of client fee deductions, TDS withholdings, and billing concessions.",
      },
    ],
  }),
  component: DeductionsPage,
});

export interface DeductionRow {
  id: string;
  source: "job_creation" | "clearing_settlement" | "tds_withheld" | "invoice";
  sourceLabel: string;
  sourceTone: "primary" | "warning" | "info" | "secondary";
  date: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  pan: string | null;
  gstin: string | null;
  jobId: string | null;
  jobCode: string | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  title: string;
  serviceName: string;
  grossFee: number;
  deductionAmount: number;
  deductionPct: number;
  netAmount: number;
  status: string;
  financialStatus: string;
  notes: string | null;
}

function DeductionsPage() {
  const navigate = useNavigate();
  const { isFinance, isManager, loading: rolesLoading } = useRoles();
  const { canView, canSeeAmounts } = usePermissions();
  const { data: clients } = useClientLookup();

  // Filters
  const [clientFilter, setClientFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const deductionsQuery = useQuery({
    queryKey: ["deductions"],
    enabled: canView("jobs") || isFinance || isManager,
    queryFn: async (): Promise<DeductionRow[]> => {
      // 1. Fetch all jobs where discount > 0 (created during job creation or updated)
      const jobsPromise = supabase
        .from("jobs")
        .select(
          `
          id,
          job_code,
          title,
          fee,
          discount,
          net_amount,
          status,
          financial_status,
          created_at,
          due_date,
          notes,
          clients (id, name, client_code, pan, gstin),
          services (id, name, service_type),
          job_clearing (id, advance, tds_tcs, discount, other_deduction, final_amount, status, notes)
        `,
        )
        .gt("discount", 0)
        .order("created_at", { ascending: false });

      // 2. Fetch job clearing records with TDS/TCS or additional clearing deductions
      const clearingPromise = supabase
        .from("job_clearing")
        .select(
          `
          id,
          job_id,
          advance,
          tds_tcs,
          discount,
          other_deduction,
          final_amount,
          status,
          notes,
          created_at,
          jobs (
            id,
            job_code,
            title,
            fee,
            discount,
            net_amount,
            status,
            financial_status,
            created_at,
            clients (id, name, client_code, pan, gstin),
            services (id, name, service_type)
          )
        `,
        )
        .or("tds_tcs.gt.0,other_deduction.gt.0")
        .order("created_at", { ascending: false });

      // 3. Fetch invoice discounts
      const invoicesPromise = supabase
        .from("invoices")
        .select(
          `
          id,
          invoice_no,
          invoice_date,
          subtotal,
          discount,
          total,
          status,
          notes,
          clients (id, name, client_code, pan, gstin),
          job_id,
          jobs (id, job_code, title)
        `,
        )
        .gt("discount", 0)
        .order("invoice_date", { ascending: false });

      const [jobsRes, clearingRes, invoicesRes] = await Promise.all([
        jobsPromise,
        clearingPromise,
        invoicesPromise,
      ]);

      const records: DeductionRow[] = [];
      const handledJobIds = new Set<string>();

      // A. Process Job Creation Deductions
      (jobsRes.data ?? []).forEach((j: any) => {
        const client = j.clients;
        const svc = j.services;
        const fee = Number(j.fee) || 0;
        const ded = Number(j.discount) || 0;
        const net = Number(j.net_amount) || Math.max(0, fee - ded);
        const pct = fee > 0 ? (ded / fee) * 100 : 0;
        const clearing = Array.isArray(j.job_clearing) ? j.job_clearing[0] : j.job_clearing;

        records.push({
          id: `job-${j.id}`,
          source: "job_creation",
          sourceLabel: "Job Creation Deduction",
          sourceTone: "primary",
          date: j.created_at ? j.created_at.slice(0, 10) : "",
          clientId: j.client_id,
          clientName: client?.name ?? "Unknown Client",
          clientCode: client?.client_code ?? "—",
          pan: client?.pan ?? null,
          gstin: client?.gstin ?? null,
          jobId: j.id,
          jobCode: j.job_code,
          invoiceId: null,
          invoiceNo: null,
          title: j.title || svc?.name || "Professional Services",
          serviceName: svc?.name || "Services",
          grossFee: fee,
          deductionAmount: ded,
          deductionPct: Math.round(pct * 10) / 10,
          netAmount: net,
          status: j.status,
          financialStatus: j.financial_status,
          notes: clearing?.notes || j.notes || "Initial deduction on job setup",
        });

        handledJobIds.add(j.id);
      });

      // B. Process Additional Clearing TDS/TCS or Deductions
      (clearingRes.data ?? []).forEach((c: any) => {
        const j = c.jobs;
        if (!j) return;
        const client = j.clients;
        const svc = j.services;
        const tds = Number(c.tds_tcs) || 0;
        const otherDed = Number(c.other_deduction) || 0;
        const fee = Number(j.fee) || Number(j.net_amount) || 0;

        if (tds > 0) {
          records.push({
            id: `tds-${c.id}`,
            source: "tds_withheld",
            sourceLabel: "TDS / TCS Withheld",
            sourceTone: "warning",
            date: c.created_at
              ? c.created_at.slice(0, 10)
              : j.created_at
                ? j.created_at.slice(0, 10)
                : "",
            clientId: j.client_id,
            clientName: client?.name ?? "Unknown Client",
            clientCode: client?.client_code ?? "—",
            pan: client?.pan ?? null,
            gstin: client?.gstin ?? null,
            jobId: j.id,
            jobCode: j.job_code,
            invoiceId: null,
            invoiceNo: null,
            title: j.title || svc?.name || "TDS Withholding",
            serviceName: svc?.name || "Services",
            grossFee: fee,
            deductionAmount: tds,
            deductionPct: fee > 0 ? Math.round((tds / fee) * 100 * 10) / 10 : 0,
            netAmount: Math.max(0, fee - tds),
            status: j.status,
            financialStatus: c.status || j.financial_status,
            notes: c.notes || "Client TDS/TCS deduction recorded in settlement",
          });
        }

        if (otherDed > 0) {
          records.push({
            id: `clearing-ded-${c.id}`,
            source: "clearing_settlement",
            sourceLabel: "Settlement Deduction",
            sourceTone: "info",
            date: c.created_at
              ? c.created_at.slice(0, 10)
              : j.created_at
                ? j.created_at.slice(0, 10)
                : "",
            clientId: j.client_id,
            clientName: client?.name ?? "Unknown Client",
            clientCode: client?.client_code ?? "—",
            pan: client?.pan ?? null,
            gstin: client?.gstin ?? null,
            jobId: j.id,
            jobCode: j.job_code,
            invoiceId: null,
            invoiceNo: null,
            title: j.title || svc?.name || "Clearing Settlement Deduction",
            serviceName: svc?.name || "Services",
            grossFee: fee,
            deductionAmount: otherDed,
            deductionPct: fee > 0 ? Math.round((otherDed / fee) * 100 * 10) / 10 : 0,
            netAmount: Math.max(0, fee - otherDed),
            status: j.status,
            financialStatus: c.status || j.financial_status,
            notes: c.notes || "Settlement deduction during clearing",
          });
        }
      });

      // C. Process Invoice Discounts
      (invoicesRes.data ?? []).forEach((inv: any) => {
        const client = inv.clients;
        const sub = Number(inv.subtotal) || 0;
        const ded = Number(inv.discount) || 0;
        const tot = Number(inv.total) || Math.max(0, sub - ded);
        const pct = sub > 0 ? (ded / sub) * 100 : 0;

        records.push({
          id: `inv-${inv.id}`,
          source: "invoice",
          sourceLabel: "Invoice Concession",
          sourceTone: "secondary",
          date: inv.invoice_date || "",
          clientId: inv.client_id,
          clientName: client?.name ?? "Unknown Client",
          clientCode: client?.client_code ?? "—",
          pan: client?.pan ?? null,
          gstin: client?.gstin ?? null,
          jobId: inv.job_id || null,
          jobCode: inv.jobs?.job_code || null,
          invoiceId: inv.id,
          invoiceNo: inv.invoice_no,
          title: inv.invoice_no ? `Invoice ${inv.invoice_no}` : "Billing Discount",
          serviceName: inv.jobs?.title || "Invoice Billing",
          grossFee: sub,
          deductionAmount: ded,
          deductionPct: Math.round(pct * 10) / 10,
          netAmount: tot,
          status: inv.status,
          financialStatus: inv.status,
          notes: inv.notes || "Invoice commercial discount",
        });
      });

      // Sort by date descending
      return records.sort((a, b) => b.date.localeCompare(a.date));
    },
  });

  // Filtered rows
  const filteredRows = useMemo(() => {
    return (deductionsQuery.data ?? []).filter((r) => {
      if (clientFilter && r.clientId !== clientFilter) return false;
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (dateFrom && r.date && r.date < dateFrom) return false;
      if (dateTo && r.date && r.date > dateTo) return false;
      return true;
    });
  }, [deductionsQuery.data, clientFilter, sourceFilter, dateFrom, dateTo]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let grossTotal = 0;
    let deductionTotal = 0;
    let netTotal = 0;
    const clientSet = new Set<string>();
    const jobSet = new Set<string>();

    filteredRows.forEach((r) => {
      grossTotal += r.grossFee;
      deductionTotal += r.deductionAmount;
      netTotal += r.netAmount;
      if (r.clientId) clientSet.add(r.clientId);
      if (r.jobId) jobSet.add(r.jobId);
    });

    const avgRate = grossTotal > 0 ? (deductionTotal / grossTotal) * 100 : 0;

    return {
      grossTotal,
      deductionTotal,
      netTotal,
      avgRate: Math.round(avgRate * 10) / 10,
      clientCount: clientSet.size,
      entryCount: filteredRows.length,
      jobCount: jobSet.size,
    };
  }, [filteredRows]);

  // Export handlers
  const handleExportCsv = () => {
    const filename = `Deductions_Register_${new Date().toISOString().slice(0, 10)}.csv`;
    const headers = [
      "Date",
      "Client Code",
      "Client Name",
      "PAN",
      "Reference (Job/Inv)",
      "Service Description",
      "Source",
      "Gross Fee (₹)",
      "Deduction Amount (₹)",
      "Deduction (%)",
      "Net Billable (₹)",
      "Status",
      "Notes",
    ];

    const rows: Cell[][] = filteredRows.map((r) => [
      r.date ? fmtDate(r.date) : "—",
      r.clientCode,
      r.clientName,
      r.pan || "—",
      r.jobCode || r.invoiceNo || "—",
      r.title,
      r.sourceLabel,
      canSeeAmounts("jobs") ? r.grossFee : "—",
      canSeeAmounts("jobs") ? r.deductionAmount : "—",
      canSeeAmounts("jobs") ? `${r.deductionPct}%` : "—",
      canSeeAmounts("jobs") ? r.netAmount : "—",
      r.status,
      r.notes || "",
    ]);

    downloadCsv(filename, headers, rows);
  };

  const handleExportXlsx = async () => {
    const filename = `Deductions_TDS_Register_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const headers = [
      "Date",
      "Client Code",
      "Client Name",
      "Client PAN",
      "Reference No",
      "Service Description",
      "Deduction Category",
      "Gross Fee",
      "Deduction Amount",
      "Deduction Rate (%)",
      "Net Billable Fee",
      "Current Status",
      "Remarks / Notes",
    ];

    const rows: Cell[][] = filteredRows.map((r) => [
      r.date ? fmtDate(r.date) : "—",
      r.clientCode,
      r.clientName,
      r.pan || "—",
      r.jobCode || r.invoiceNo || "—",
      r.title,
      r.sourceLabel,
      canSeeAmounts("jobs") ? r.grossFee : "—",
      canSeeAmounts("jobs") ? r.deductionAmount : "—",
      canSeeAmounts("jobs") ? r.deductionPct : "—",
      canSeeAmounts("jobs") ? r.netAmount : "—",
      r.status,
      r.notes || "",
    ]);

    await downloadXlsx(filename, [
      {
        name: "Deductions & TDS",
        header: headers,
        rows,
      },
    ]);
  };

  if (rolesLoading) return null;
  if (!canView("jobs") && !isFinance && !isManager) return <NoAccess />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deductions & TDS"
        subtitle="Practice register of client fee deductions, TDS withholdings, and commercial concessions."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-medium"
              >
                <Download className="h-3.5 w-3.5" />
                Export
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={handleExportXlsx}
                className="gap-2 text-xs cursor-pointer"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Export to Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportCsv}
                className="gap-2 text-xs cursor-pointer"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
                Export to CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        <StatCard
          label="Total Deductions / TDS"
          value={canSeeAmounts("jobs") ? inr(metrics.deductionTotal) : "—"}
          tone="danger"
          hint={`${metrics.entryCount} total deduction entries`}
        />
        <StatCard
          label="Gross Agreed Value"
          value={canSeeAmounts("jobs") ? inr(metrics.grossTotal) : "—"}
          tone="info"
          hint="Original agreed fees before deduction"
        />
        <StatCard
          label="Net Realized Revenue"
          value={canSeeAmounts("jobs") ? inr(metrics.netTotal) : "—"}
          tone="success"
          hint="Net billable after deductions"
        />
        <StatCard
          label="Effective Deduction %"
          value={`${metrics.avgRate}%`}
          hint="Average reduction across billed work"
        />
        <StatCard
          label="Clients Affected"
          value={metrics.clientCount}
          hint={`${metrics.jobCount} job works impacted`}
        />
      </div>

      {/* Main Deductions Register Table */}
      <DataTable
        rows={filteredRows}
        loading={deductionsQuery.isLoading}
        onRowClick={(r) => {
          if (r.jobId) {
            navigate({ to: "/jobs/$id", params: { id: r.jobId } });
          } else if (r.invoiceId) {
            navigate({ to: "/invoices/$id", params: { id: r.invoiceId } });
          }
        }}
        empty="No deductions found matching your filter criteria."
        search={(r) =>
          `${r.clientName} ${r.clientCode} ${r.jobCode ?? ""} ${r.invoiceNo ?? ""} ${r.title} ${r.pan ?? ""} ${r.notes ?? ""}`
        }
        searchPlaceholder="Search client, code, PAN, job code, or notes…"
        toolbar={
          <>
            <div className="w-44 sm:w-48">
              <NativeSelect
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="h-9 text-xs"
              >
                <option value="">All Clients</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.client_code ? `[${c.client_code}] ` : ""}
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="w-44 sm:w-48">
              <NativeSelect
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="h-9 text-xs"
              >
                <option value="all">All Deduction Types</option>
                <option value="job_creation">Job Creation Deductions</option>
                <option value="tds_withheld">TDS / TCS Withholdings</option>
                <option value="clearing_settlement">Settlement Deductions</option>
                <option value="invoice">Invoice Concessions</option>
              </NativeSelect>
            </div>

            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
            />

            {(clientFilter || sourceFilter !== "all" || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClientFilter("");
                  setSourceFilter("all");
                  setDateFrom("");
                  setDateTo("");
                }}
                className="h-9 text-xs text-muted-foreground hover:text-foreground"
              >
                Reset
              </Button>
            )}
          </>
        }
        columns={[
          {
            key: "date",
            header: "Date",
            sort: (r) => r.date,
            render: (r) => (
              <div className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {r.date ? fmtDate(r.date) : "—"}
              </div>
            ),
          },
          {
            key: "client",
            header: "Client",
            sort: (r) => r.clientName,
            render: (r) => (
              <div className="min-w-[180px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground text-sm hover:underline cursor-pointer">
                    {r.clientName}
                  </span>
                  {r.clientCode && (
                    <span className="font-mono text-[10px] bg-muted px-1.5 py-0.2 rounded font-medium text-muted-foreground">
                      {r.clientCode}
                    </span>
                  )}
                </div>
                {r.pan && (
                  <div className="text-[11px] font-mono text-muted-foreground">PAN: {r.pan}</div>
                )}
              </div>
            ),
          },
          {
            key: "ref",
            header: "Job / Reference",
            sort: (r) => r.jobCode || r.invoiceNo || "",
            render: (r) => (
              <div className="min-w-[160px]">
                <div className="flex items-center gap-1">
                  {r.jobCode ? (
                    <Link
                      to="/jobs/$id"
                      params={{ id: r.jobId! }}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline"
                    >
                      {r.jobCode}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </Link>
                  ) : r.invoiceNo ? (
                    <Link
                      to="/invoices/$id"
                      params={{ id: r.invoiceId! }}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline"
                    >
                      {r.invoiceNo}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <div className="line-clamp-1 text-xs text-muted-foreground font-medium">
                  {r.title}
                </div>
              </div>
            ),
          },
          {
            key: "type",
            header: "Deduction Type",
            render: (r) => {
              const badgeClass =
                r.source === "job_creation"
                  ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                  : r.source === "tds_withheld"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : r.source === "clearing_settlement"
                      ? "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                      : "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300";

              return (
                <div className="flex flex-col gap-1 items-start">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
                      badgeClass,
                    )}
                  >
                    {r.sourceLabel}
                  </span>
                  {r.notes && (
                    <span className="line-clamp-1 max-w-[200px] text-[10px] text-muted-foreground italic">
                      {r.notes}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            key: "gross",
            header: "Gross Fee",
            align: "right",
            sort: (r) => r.grossFee,
            render: (r) => (
              <span className="font-mono text-xs text-muted-foreground">
                {canSeeAmounts("jobs") ? inr(r.grossFee) : "—"}
              </span>
            ),
          },
          {
            key: "deduction",
            header: "Deduction (₹)",
            align: "right",
            sort: (r) => r.deductionAmount,
            render: (r) => (
              <div className="text-right">
                <span className="font-mono font-semibold text-xs text-amber-600 dark:text-amber-400">
                  {canSeeAmounts("jobs") ? `− ${inr(r.deductionAmount)}` : "—"}
                </span>
                {r.deductionPct > 0 && (
                  <div className="text-[10px] font-mono text-muted-foreground">
                    ({r.deductionPct}%)
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "net",
            header: "Net Billable",
            align: "right",
            sort: (r) => r.netAmount,
            render: (r) => (
              <span className="font-mono font-semibold text-xs text-foreground">
                {canSeeAmounts("jobs") ? inr(r.netAmount) : "—"}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (r) => (
              <div className="flex flex-col gap-1">
                <StatusBadge status={r.status} />
              </div>
            ),
          },
          {
            key: "actions",
            header: "",
            align: "right",
            render: (r) => (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (r.jobId) {
                      navigate({ to: "/jobs/$id", params: { id: r.jobId } });
                    } else if (r.invoiceId) {
                      navigate({ to: "/invoices/$id", params: { id: r.invoiceId } });
                    }
                  }}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
