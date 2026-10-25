/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Printer,
  TrendingDown,
  TrendingUp,
  Wallet,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/app/DataTable";
import { NoAccess } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentFirm } from "@/hooks/use-firm";
import { downloadCsv, fmtDate, fmtDateTime, inr, MODES, today } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/daily-report")({
  head: () => ({
    meta: [
      { title: "Day's Report — AJ's Chartered Desk" },
      { name: "description", content: "Executive daily, monthly, and yearly practice performance ledger." },
    ],
  }),
  component: DailyReportPage,
});

type PeriodMode = "day" | "month" | "year";

function getMonthRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function getYearRange(yearStr: string) {
  const y = Number(yearStr);
  return {
    start: `${y}-01-01`,
    end: `${y}-12-31`,
  };
}

function DailyReportPage() {
  const { isManager, isFinance, loading } = useRoles();
  const { canSeeAmounts } = usePermissions();
  const { data: currentFirm } = useCurrentFirm();

  const currentDay = today();
  const currentMonthStr = currentDay.slice(0, 7);
  const currentYearStr = currentDay.slice(0, 4);

  const [mode, setMode] = useState<PeriodMode>("day");
  const [selectedDay, setSelectedDay] = useState(currentDay);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);
  const [selectedYear, setSelectedYear] = useState(currentYearStr);
  const [activeTab, setActiveTab] = useState("collections");

  // Determine active start & end date strings based on selected period mode
  const { startDate, endDate, periodLabel } = useMemo(() => {
    if (mode === "day") {
      return {
        startDate: selectedDay,
        endDate: selectedDay,
        periodLabel: fmtDate(selectedDay),
      };
    }
    if (mode === "month") {
      const range = getMonthRange(selectedMonth);
      const dateObj = new Date(selectedMonth + "-01");
      const monthName = dateObj.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      return {
        startDate: range.start,
        endDate: range.end,
        periodLabel: monthName,
      };
    }
    // year
    const range = getYearRange(selectedYear);
    return {
      startDate: range.start,
      endDate: range.end,
      periodLabel: `Year ${selectedYear}`,
    };
  }, [mode, selectedDay, selectedMonth, selectedYear]);

  // Navigate periods
  const handlePrev = () => {
    if (mode === "day") {
      const d = new Date(selectedDay);
      d.setDate(d.getDate() - 1);
      setSelectedDay(d.toISOString().slice(0, 10));
    } else if (mode === "month") {
      const [y, m] = selectedMonth.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      const prevM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      setSelectedMonth(prevM);
    } else {
      setSelectedYear(String(Number(selectedYear) - 1));
    }
  };

  const handleNext = () => {
    if (mode === "day") {
      const d = new Date(selectedDay);
      d.setDate(d.getDate() + 1);
      setSelectedDay(d.toISOString().slice(0, 10));
    } else if (mode === "month") {
      const [y, m] = selectedMonth.split("-").map(Number);
      const d = new Date(y, m, 1);
      const nextM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      setSelectedMonth(nextM);
    } else {
      setSelectedYear(String(Number(selectedYear) + 1));
    }
  };

  const handleResetToCurrent = () => {
    setSelectedDay(currentDay);
    setSelectedMonth(currentMonthStr);
    setSelectedYear(currentYearStr);
  };

  // Queries for the period
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = `${endDate}T23:59:59.999Z`;

  // 1. Tasks Created
  const createdJobsQuery = useQuery({
    queryKey: ["daily-jobs-created", startDate, endDate, currentFirm?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,job_code,title,client_id,status,fee,discount,net_amount,created_at,clients(name),services(name)")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // 2. Tasks Cleared (Marked completed during the period via completed_at or status)
  const clearedJobsQuery = useQuery({
    queryKey: ["daily-jobs-cleared", startDate, endDate, currentFirm?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,job_code,title,client_id,status,fee,discount,net_amount,completed_at,created_at,clients(name),services(name)")
        .eq("status", "completed")
        .gte("completed_at", startIso)
        .lte("completed_at", endIso)
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // 3. Payments / Collections Received
  const paymentsQuery = useQuery({
    queryKey: ["daily-payments", startDate, endDate, currentFirm?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,payment_code,client_id,job_id,amount,mode,payment_date,reference,narration,status,created_at,clients(name)")
        .neq("status", "reversed")
        .gte("payment_date", startDate)
        .lte("payment_date", endDate)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // 4. Invoices Created
  const invoicesQuery = useQuery({
    queryKey: ["daily-invoices", startDate, endDate, currentFirm?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_no,client_id,invoice_date,total,amount_paid,outstanding,status,created_at,clients(name)")
        .gte("invoice_date", startDate)
        .lte("invoice_date", endDate)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // 5. Practice Expenses Incurred
  const expensesQuery = useQuery({
    queryKey: ["daily-expenses", startDate, endDate, currentFirm?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id,expense_date,category,paid_to,description,amount,mode,created_at")
        .gte("expense_date", startDate)
        .lte("expense_date", endDate)
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Aggregated Totals
  const tasksCreated = createdJobsQuery.data ?? [];
  const tasksCleared = clearedJobsQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];

  const totalReceived = useMemo(
    () => payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [payments],
  );

  const totalInvoiced = useMemo(
    () => invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0),
    [invoices],
  );

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0),
    [expenses],
  );

  const netDayBalance = totalReceived - totalExpenses;

  const totalClearedFee = useMemo(
    () => tasksCleared.reduce((sum, j) => sum + Number(j.net_amount || j.fee || 0), 0),
    [tasksCleared],
  );

  // Export period summary as CSV
  const handleExportCsv = () => {
    const summaryRows = [
      { Metric: "Report Period", Value: periodLabel },
      { Metric: "Tasks Created", Value: tasksCreated.length },
      { Metric: "Tasks Cleared (Completed)", Value: tasksCleared.length },
      { Metric: "Total Fee Cleared", Value: totalClearedFee },
      { Metric: "Total Collections Received", Value: totalReceived },
      { Metric: "Invoices Generated", Value: invoices.length },
      { Metric: "Total Billed Amount", Value: totalInvoiced },
      { Metric: "Total Expenses", Value: totalExpenses },
      { Metric: "Net Day Balance (Collections - Expenses)", Value: netDayBalance },
    ];
    downloadCsv(`Days_Report_${mode}_${startDate}_to_${endDate}.csv`, summaryRows);
  };

  if (loading) return null;
  if (!isManager && !isFinance) return <NoAccess />;

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight text-foreground">Day's Report</h1>
            <span className="text-xs bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full border border-primary/20">
              {mode === "day" ? "Daily Ledger" : mode === "month" ? "Monthly Summary" : "Annual Ledger"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Consolidated practice ledger for tasks created, tasks cleared, collections, invoices, expenses, and net balance.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-8 gap-1.5 text-xs cursor-pointer shadow-xs"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Report
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-8 gap-1.5 text-xs cursor-pointer shadow-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Period Selection Controls Bar */}
      <Card className="shadow-none border-border/70 bg-card/60">
        <CardContent className="p-3.5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Mode Switcher */}
            <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-lg border border-border/50 shrink-0">
              <Button
                type="button"
                variant={mode === "day" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs font-semibold px-3 cursor-pointer"
                onClick={() => setMode("day")}
              >
                Day
              </Button>
              <Button
                type="button"
                variant={mode === "month" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs font-semibold px-3 cursor-pointer"
                onClick={() => setMode("month")}
              >
                Monthly
              </Button>
              <Button
                type="button"
                variant={mode === "year" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs font-semibold px-3 cursor-pointer"
                onClick={() => setMode("year")}
              >
                Yearly
              </Button>
            </div>

            {/* Date Pickers & Navigation */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 cursor-pointer shadow-xs"
                onClick={handlePrev}
                title="Previous period"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {mode === "day" && (
                <Input
                  type="date"
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  className="h-8 text-xs font-medium w-[145px] shadow-xs"
                />
              )}

              {mode === "month" && (
                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="h-8 text-xs font-medium w-[150px] shadow-xs"
                />
              )}

              {mode === "year" && (
                <Input
                  type="number"
                  min="2020"
                  max="2040"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="h-8 text-xs font-medium w-[100px] shadow-xs"
                />
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 cursor-pointer shadow-xs"
                onClick={handleNext}
                title="Next period"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-primary font-medium cursor-pointer"
                onClick={handleResetToCurrent}
              >
                {mode === "day" ? "Today" : mode === "month" ? "This Month" : "This Year"}
              </Button>
            </div>

            {/* Active Period Display Badge */}
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Viewing Period
              </div>
              <div className="text-sm font-bold text-foreground flex items-center gap-1.5 md:justify-end">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {periodLabel}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* High-Level Stat Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {/* 1. Tasks Created */}
        <Card className="shadow-none border-border/70 bg-card/80">
          <CardHeader className="p-3 pb-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Tasks Created
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-foreground font-mono">
              {tasksCreated.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              New tasks assigned
            </div>
          </CardContent>
        </Card>

        {/* 2. Tasks Cleared */}
        <Card className="shadow-none border-border/70 bg-card/80">
          <CardHeader className="p-3 pb-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Tasks Cleared
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {tasksCleared.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {canSeeAmounts("jobs") ? inr(totalClearedFee) : "Completed"}
            </div>
          </CardContent>
        </Card>

        {/* 3. Total Received (Inflow) */}
        <Card className="shadow-none border-border/70 bg-card/80">
          <CardHeader className="p-3 pb-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Total Received
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-primary font-mono truncate">
              {canSeeAmounts("payments") ? inr(totalReceived) : "-"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {payments.length} collection receipts
            </div>
          </CardContent>
        </Card>

        {/* 4. Invoices Created */}
        <Card className="shadow-none border-border/70 bg-card/80">
          <CardHeader className="p-3 pb-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Invoices Created
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-foreground font-mono">
              {invoices.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              Billed: {canSeeAmounts("jobs") ? inr(totalInvoiced) : "-"}
            </div>
          </CardContent>
        </Card>

        {/* 5. Total Expenses */}
        <Card className="shadow-none border-border/70 bg-card/80">
          <CardHeader className="p-3 pb-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Total Expenses
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-destructive font-mono truncate">
              {canSeeAmounts("expenses") ? inr(totalExpenses) : "-"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {expenses.length} expense vouchers
            </div>
          </CardContent>
        </Card>

        {/* 6. Day's Balance */}
        <Card className={cn(
          "shadow-none border",
          netDayBalance >= 0
            ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-950/20"
            : "border-destructive/40 bg-destructive/5 dark:bg-destructive/95/20"
        )}>
          <CardHeader className="p-3 pb-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              {mode === "day" ? "Day's Balance" : mode === "month" ? "Month Balance" : "Annual Balance"}
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className={cn(
              "text-2xl font-bold font-mono truncate",
              netDayBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            )}>
              {canSeeAmounts("payments") && canSeeAmounts("expenses") ? inr(netDayBalance) : "-"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
              {netDayBalance >= 0 ? (
                <>
                  <TrendingUp className="h-3 w-3 text-emerald-600" />
                  <span>Net Inflow</span>
                </>
              ) : (
                <>
                  <TrendingDown className="h-3 w-3 text-destructive" />
                  <span>Net Outflow</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Drill-down Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/50 p-1 border border-border/60">
          <TabsTrigger value="collections" className="text-xs font-semibold gap-1.5 cursor-pointer">
            <Wallet className="h-3.5 w-3.5" />
            Collections ({payments.length})
          </TabsTrigger>
          <TabsTrigger value="cleared" className="text-xs font-semibold gap-1.5 cursor-pointer">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Tasks Cleared ({tasksCleared.length})
          </TabsTrigger>
          <TabsTrigger value="created" className="text-xs font-semibold gap-1.5 cursor-pointer">
            <Clock className="h-3.5 w-3.5" />
            Tasks Created ({tasksCreated.length})
          </TabsTrigger>
          <TabsTrigger value="invoices" className="text-xs font-semibold gap-1.5 cursor-pointer">
            <FileText className="h-3.5 w-3.5" />
            Invoices ({invoices.length})
          </TabsTrigger>
          <TabsTrigger value="expenses" className="text-xs font-semibold gap-1.5 cursor-pointer">
            <TrendingDown className="h-3.5 w-3.5 text-destructive" />
            Expenses ({expenses.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Collections */}
        <TabsContent value="collections" className="m-0">
          <Card className="shadow-none border-border/70">
            <CardHeader className="p-4 pb-2 border-b border-border/40 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Collections Received in {periodLabel}</CardTitle>
                <p className="text-xs text-muted-foreground">All cash, UPI, bank transfer receipts recorded in this period.</p>
              </div>
              <div className="font-mono text-sm font-bold text-primary">
                Total: {canSeeAmounts("payments") ? inr(totalReceived) : "-"}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                rows={payments}
                empty="No payment collections recorded during this period."
                columns={[
                  {
                    key: "payment_code",
                    header: "Receipt #",
                    render: (p: any) => (
                      <Link
                        to="/payments"
                        search={{ client: p.client_id, job: p.job_id ?? undefined }}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                      >
                        {p.payment_code}
                      </Link>
                    ),
                  },
                  {
                    key: "client",
                    header: "Client",
                    render: (p: any) => (
                      <span className="font-medium text-foreground text-xs">
                        {p.clients?.name ?? "Unknown"}
                      </span>
                    ),
                  },
                  {
                    key: "mode",
                    header: "Mode & Details",
                    render: (p: any) => (
                      <div className="space-y-0.5">
                        <span className="text-xs uppercase font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/50">
                          {MODES[p.mode] ?? p.mode}
                        </span>
                        {p.narration && (
                          <div className="text-[11px] text-muted-foreground truncate max-w-[240px]">
                            {p.narration}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: "payment_date",
                    header: "Payment Date",
                    render: (p: any) => <span className="text-xs">{fmtDate(p.payment_date)}</span>,
                  },
                  {
                    key: "amount",
                    header: "Amount",
                    align: "right",
                    render: (p: any) => (
                      <span className="font-mono text-xs font-bold text-foreground">
                        {canSeeAmounts("payments") ? inr(p.amount) : "-"}
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (p: any) => <StatusBadge status={p.status} />,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Tasks Cleared */}
        <TabsContent value="cleared" className="m-0">
          <Card className="shadow-none border-border/70">
            <CardHeader className="p-4 pb-2 border-b border-border/40 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Tasks Cleared (Completed) in {periodLabel}</CardTitle>
                <p className="text-xs text-muted-foreground">Jobs marked as Completed/Done in this period, ready for invoice & squared-off clearing.</p>
              </div>
              <div className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                Cleared Fee: {canSeeAmounts("jobs") ? inr(totalClearedFee) : "-"}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                rows={tasksCleared}
                empty="No tasks were marked completed during this period."
                columns={[
                  {
                    key: "job_code",
                    header: "Job Code",
                    render: (j: any) => (
                      <Link
                        to="/jobs/$id"
                        params={{ id: String(j.id) }}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                      >
                        {j.job_code}
                      </Link>
                    ),
                  },
                  {
                    key: "title",
                    header: "Task / Service",
                    render: (j: any) => (
                      <div>
                        <div className="font-medium text-xs text-foreground">{j.title}</div>
                        <div className="text-[11px] text-muted-foreground">{j.services?.name ?? "Service"}</div>
                      </div>
                    ),
                  },
                  {
                    key: "client",
                    header: "Client",
                    render: (j: any) => (
                      <span className="text-xs font-medium text-foreground">
                        {j.clients?.name ?? "Unknown"}
                      </span>
                    ),
                  },
                  {
                    key: "completed_at",
                    header: "Cleared On",
                    render: (j: any) => <span className="text-xs">{j.completed_at ? fmtDateTime(j.completed_at) : "Completed"}</span>,
                  },
                  {
                    key: "fee",
                    header: "Net Fee",
                    align: "right",
                    render: (j: any) => (
                      <span className="font-mono text-xs font-bold text-foreground">
                        {canSeeAmounts("jobs") ? inr(j.net_amount || j.fee || 0) : "-"}
                      </span>
                    ),
                  },
                  {
                    key: "actions",
                    header: "Action",
                    align: "right",
                    render: (j: any) => (
                      <Link
                        to="/clearing"
                        search={{ client: j.client_id, job: String(j.id) }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        Clear / Invoice
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Tasks Created */}
        <TabsContent value="created" className="m-0">
          <Card className="shadow-none border-border/70">
            <CardHeader className="p-4 pb-2 border-b border-border/40">
              <CardTitle className="text-sm font-semibold">New Tasks Created in {periodLabel}</CardTitle>
              <p className="text-xs text-muted-foreground">All compliance jobs and service requests initiated in this timeframe.</p>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                rows={tasksCreated}
                empty="No new tasks were created during this period."
                columns={[
                  {
                    key: "job_code",
                    header: "Job Code",
                    render: (j: any) => (
                      <Link
                        to="/jobs/$id"
                        params={{ id: String(j.id) }}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                      >
                        {j.job_code}
                      </Link>
                    ),
                  },
                  {
                    key: "title",
                    header: "Task / Title",
                    render: (j: any) => (
                      <div>
                        <div className="font-medium text-xs text-foreground">{j.title}</div>
                        <div className="text-[11px] text-muted-foreground">{j.services?.name ?? "Service"}</div>
                      </div>
                    ),
                  },
                  {
                    key: "client",
                    header: "Client",
                    render: (j: any) => (
                      <span className="text-xs font-medium text-foreground">
                        {j.clients?.name ?? "Unknown"}
                      </span>
                    ),
                  },
                  {
                    key: "created_at",
                    header: "Created Time",
                    render: (j: any) => <span className="text-xs">{fmtDateTime(j.created_at)}</span>,
                  },
                  {
                    key: "fee",
                    header: "Fee",
                    align: "right",
                    render: (j: any) => (
                      <span className="font-mono text-xs font-bold text-foreground">
                        {canSeeAmounts("jobs") ? inr(j.net_amount || j.fee || 0) : "-"}
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (j: any) => <StatusBadge status={j.status} />,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Invoices Created */}
        <TabsContent value="invoices" className="m-0">
          <Card className="shadow-none border-border/70">
            <CardHeader className="p-4 pb-2 border-b border-border/40 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Invoices Generated in {periodLabel}</CardTitle>
                <p className="text-xs text-muted-foreground">Client fee invoices created or finalized during this period.</p>
              </div>
              <div className="font-mono text-sm font-bold text-foreground">
                Total Billed: {canSeeAmounts("jobs") ? inr(totalInvoiced) : "-"}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                rows={invoices}
                empty="No invoices were created during this period."
                columns={[
                  {
                    key: "invoice_no",
                    header: "Invoice #",
                    render: (inv: any) => (
                      <Link
                        to="/invoices/$id"
                        params={{ id: String(inv.id) }}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                      >
                        {inv.invoice_no}
                      </Link>
                    ),
                  },
                  {
                    key: "client",
                    header: "Client",
                    render: (inv: any) => (
                      <span className="text-xs font-medium text-foreground">
                        {inv.clients?.name ?? "Unknown"}
                      </span>
                    ),
                  },
                  {
                    key: "invoice_date",
                    header: "Invoice Date",
                    render: (inv: any) => <span className="text-xs">{fmtDate(inv.invoice_date)}</span>,
                  },
                  {
                    key: "total",
                    header: "Total Billed",
                    align: "right",
                    render: (inv: any) => (
                      <span className="font-mono text-xs font-bold text-foreground">
                        {canSeeAmounts("jobs") ? inr(inv.total) : "-"}
                      </span>
                    ),
                  },
                  {
                    key: "outstanding",
                    header: "Outstanding",
                    align: "right",
                    render: (inv: any) => (
                      <span className="font-mono text-xs font-semibold text-amber-600">
                        {canSeeAmounts("jobs") ? inr(inv.outstanding) : "-"}
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (inv: any) => <StatusBadge status={inv.status} />,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: Expenses */}
        <TabsContent value="expenses" className="m-0">
          <Card className="shadow-none border-border/70">
            <CardHeader className="p-4 pb-2 border-b border-border/40 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Expenses Logged in {periodLabel}</CardTitle>
                <p className="text-xs text-muted-foreground">Practice costs, vendor payments, and operational outlays recorded.</p>
              </div>
              <div className="font-mono text-sm font-bold text-destructive">
                Total Expenses: {canSeeAmounts("expenses") ? inr(totalExpenses) : "-"}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                rows={expenses}
                empty="No practice expenses recorded during this period."
                columns={[
                  {
                    key: "category",
                    header: "Category",
                    render: (exp: any) => (
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border/50">
                        {exp.category}
                      </span>
                    ),
                  },
                  {
                    key: "paid_to",
                    header: "Payee / Paid To",
                    render: (exp: any) => <span className="text-xs font-medium text-foreground">{exp.paid_to || "-"}</span>,
                  },
                  {
                    key: "description",
                    header: "Description",
                    render: (exp: any) => (
                      <span className="text-xs text-muted-foreground truncate max-w-[280px] block">
                        {exp.description || "-"}
                      </span>
                    ),
                  },
                  {
                    key: "expense_date",
                    header: "Date",
                    render: (exp: any) => <span className="text-xs">{fmtDate(exp.expense_date)}</span>,
                  },
                  {
                    key: "amount",
                    header: "Amount",
                    align: "right",
                    render: (exp: any) => (
                      <span className="font-mono text-xs font-bold text-destructive">
                        {canSeeAmounts("expenses") ? inr(exp.amount) : "-"}
                      </span>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
