import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { TrendingUp, Calendar, ArrowUpRight, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { PageHeader, StatCard } from "@/components/app/common";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ageingBucket,
  BUCKETS,
  fmtDate,
  fmtDateTime,
  inr,
  invoiceDisplayStatus,
  jobDisplayStatus,
  label,
  MODES,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — CA PracticeDesk" },
      { name: "description", content: "Firm overview." },
    ],
  }),
  component: Dashboard,
});

const COLORS = [
  "var(--chart-3)",
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-5)",
  "var(--chart-4)",
];

type TimeRange = "1M" | "2M" | "3M" | "6M" | "1Y" | "ALL";

function getRangeDays(range: TimeRange): number | null {
  switch (range) {
    case "1M":
      return 30;
    case "2M":
      return 60;
    case "3M":
      return 90;
    case "6M":
      return 180;
    case "1Y":
      return 365;
    case "ALL":
      return null;
  }
}

function Dashboard() {
  const { isFinance, loading } = useRoles();
  const { canView } = usePermissions();
  const [range, setRange] = useState<TimeRange>("1M");

  const q = useQuery({
    queryKey: ["dashboard"],
    enabled: isFinance,
    queryFn: async () => {
      const [c, j, i, p, a] = await Promise.all([
        supabase.from("clients").select("id,status,created_at"),
        supabase.from("jobs").select("id,status,due_date,created_at"),
        supabase
          .from("invoices")
          .select("id,status,total,outstanding,due_date,invoice_date,created_at"),
        supabase
          .from("payments")
          .select("id,amount,mode,status,allocated_amount,payment_date,created_at"),
        supabase
          .from("audit_logs")
          .select("id,action,module,created_at,new_value")
          .in("module", [
            "jobs",
            "invoices",
            "payments",
            "payment_allocations",
            "payment_reversals",
            "discounts",
          ])
          .order("created_at", { ascending: false })
          .limit(12),
      ]);
      for (const r of [c, j, i, p]) if (r.error) throw r.error;
      return {
        clients: c.data!,
        jobs: j.data!,
        invoices: i.data!,
        payments: p.data!,
        activity: a.data ?? [],
      };
    },
  });

  const d = q.data;
  const daysLimit = getRangeDays(range);
  const cutoffDate = useMemo(() => {
    if (!daysLimit) return null;
    const dt = new Date();
    dt.setDate(dt.getDate() - daysLimit);
    return dt.toISOString().slice(0, 10);
  }, [daysLimit]);

  // Filter entities according to stock-market range selector
  const allJobs = d?.jobs ?? [];
  const jobs = useMemo(() => {
    if (!cutoffDate) return allJobs;
    return allJobs.filter((j) => (j.created_at ? j.created_at.slice(0, 10) >= cutoffDate : true));
  }, [allJobs, cutoffDate]);

  const js = (s: string) => jobs.filter((x) => jobDisplayStatus(x) === s).length;

  const allInvoices = d?.invoices ?? [];
  const openInv = useMemo(() => {
    return allInvoices.filter((x) => {
      if (x.status === "cancelled" || x.status === "draft") return false;
      if (cutoffDate) {
        const invDate = x.invoice_date || (x.created_at ? x.created_at.slice(0, 10) : "");
        if (invDate && invDate < cutoffDate) return false;
      }
      return true;
    });
  }, [allInvoices, cutoffDate]);

  const allPayments = d?.payments ?? [];
  const live = useMemo(() => {
    return allPayments.filter((x) => {
      if (x.status === "reversed") return false;
      if (cutoffDate) {
        const payDate = x.payment_date || (x.created_at ? x.created_at.slice(0, 10) : "");
        if (payDate && payDate < cutoffDate) return false;
      }
      return true;
    });
  }, [allPayments, cutoffDate]);

  const totalInvoiced = openInv.reduce((s, x) => s + Number(x.total), 0);
  const collected = live.reduce((s, x) => s + Number(x.amount), 0);
  const outstanding = openInv.reduce((s, x) => s + Number(x.outstanding), 0);
  const unalloc = live.reduce((s, x) => s + Number(x.amount) - Number(x.allocated_amount), 0);

  // Stock-market timeline performance trend
  const timelineData = useMemo(() => {
    const pointsMap = new Map<
      string,
      { date: string; Invoiced: number; Collected: number; Outstanding: number }
    >();

    openInv.forEach((inv) => {
      const dt = inv.invoice_date ? inv.invoice_date.slice(0, 10) : inv.created_at?.slice(0, 10);
      if (!dt) return;
      const key = daysLimit && daysLimit <= 60 ? dt : dt.slice(0, 7); // day or month
      const curr = pointsMap.get(key) ?? { date: key, Invoiced: 0, Collected: 0, Outstanding: 0 };
      curr.Invoiced += Number(inv.total) || 0;
      curr.Outstanding += Number(inv.outstanding) || 0;
      pointsMap.set(key, curr);
    });

    live.forEach((p) => {
      const dt = p.payment_date ? p.payment_date.slice(0, 10) : p.created_at?.slice(0, 10);
      if (!dt) return;
      const key = daysLimit && daysLimit <= 60 ? dt : dt.slice(0, 7);
      const curr = pointsMap.get(key) ?? { date: key, Invoiced: 0, Collected: 0, Outstanding: 0 };
      curr.Collected += Number(p.amount) || 0;
      pointsMap.set(key, curr);
    });

    const sorted = [...pointsMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({
        ...v,
        formattedDate: k.length === 10 ? fmtDate(k) : k,
      }));

    return sorted;
  }, [openInv, live, daysLimit]);

  const jobChart = ["pending", "in_progress", "completed", "cancelled", "overdue"].map((s) => ({
    name: label(s),
    value: js(s),
  }));

  const modeChart = Object.entries(MODES).map(([k, v]) => ({
    name: v,
    value: live.filter((x) => x.mode === k).reduce((s, x) => s + Number(x.amount), 0),
  }));

  const ageChart = BUCKETS.map((b) => ({
    name: b,
    value: openInv
      .filter((x) => Number(x.outstanding) > 0 && ageingBucket(x.due_date) === b)
      .reduce((s, x) => s + Number(x.outstanding), 0),
  }));

  if (loading) return null;
  if (!isFinance) {
    const landing = canView("payments")
      ? "/payments"
      : canView("jobs")
        ? "/jobs"
        : canView("clients")
          ? "/clients"
          : "/roles";
    return <Navigate to={landing} />;
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live practice performance and financial analytics."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
              Range:
            </span>
            <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs font-semibold">
              {(["1M", "2M", "3M", "6M", "1Y", "ALL"] as TimeRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all cursor-pointer",
                    range === r
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r === "3M" ? "1Q" : r}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total Clients" value={d?.clients.length ?? "—"} />
        <StatCard
          label="Active Clients"
          value={d?.clients.filter((x) => x.status === "active").length ?? "—"}
          tone="success"
        />
        <StatCard label="Jobs in Period" value={jobs.length} />
        <StatCard label="Pending Jobs" value={js("pending") + js("in_progress")} tone="warning" />
        <StatCard label="Completed Jobs" value={js("completed")} tone="success" />
        <StatCard label="Overdue Jobs" value={js("overdue")} tone="danger" />
        <StatCard label="Total Invoiced" value={inr(totalInvoiced)} tone="info" />
        <StatCard label="Total Collected" value={inr(collected)} tone="success" />
        <StatCard
          label="Total Outstanding"
          value={inr(outstanding)}
          tone="danger"
          hint={`${openInv.filter((x) => invoiceDisplayStatus(x) === "overdue").length} overdue in period`}
        />
        <StatCard label="Unallocated Payments" value={inr(unalloc)} tone="warning" />
      </div>

      {/* Stock-Market Style Financial Trend Chart */}
      <Card className="mt-4 shadow-none">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Financial Performance Trend
                </CardTitle>
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                  {range === "1M"
                    ? "Last 1 Month"
                    : range === "2M"
                      ? "Last 2 Months"
                      : range === "3M"
                        ? "Last Quarter (3 Months)"
                        : range === "6M"
                          ? "Last 6 Months"
                          : range === "1Y"
                            ? "Last 1 Year"
                            : "All Time"}
                </span>
              </div>
              <CardDescription className="text-xs mt-0.5">
                Comparison of Invoiced fees, Collections, and Outstanding balances over the selected
                timeframe.
              </CardDescription>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-muted-foreground">Invoiced:</span>
                <span className="font-semibold text-foreground">{inr(totalInvoiced)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">Collected:</span>
                <span className="font-semibold text-foreground">{inr(collected)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-muted-foreground">Due:</span>
                <span className="font-semibold text-foreground">{inr(outstanding)}</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-72 pt-2">
          {timelineData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No financial activity found in the selected {range} range.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorInvoiced" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorDue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="formattedDate" fontSize={11} tickLine={false} />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(val: number, name: string) => [inr(val), name]}
                  labelFormatter={(l) => `Period: ${l}`}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                <Area
                  type="monotone"
                  dataKey="Invoiced"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorInvoiced)"
                />
                <Area
                  type="monotone"
                  dataKey="Collected"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorCollected)"
                />
                <Area
                  type="monotone"
                  dataKey="Outstanding"
                  stroke="#f43f5e"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fillOpacity={1}
                  fill="url(#colorDue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Grid of Auxiliary Charts */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Job Status</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={jobChart}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                >
                  {jobChart.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Collections by Payment Mode</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer>
              <BarChart data={modeChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Receivables Ageing</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer>
              <BarChart data={ageChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis fontSize={11} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Bar dataKey="value" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Activity Log */}
      <Card className="mt-4 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {(d?.activity.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {d!.activity.map((a) => {
                const nv = (a.new_value ?? {}) as Record<string, unknown>;
                const ref = String(
                  nv.job_code ?? nv.invoice_no ?? nv.payment_code ?? nv.reversal_ref ?? "",
                );
                return (
                  <li key={a.id} className="flex justify-between py-2">
                    <span>
                      <span className="font-medium">{label(a.module)}</span> {a.action}{" "}
                      {ref && <span className="text-muted-foreground">· {ref}</span>}
                      {nv.status ? (
                        <span className="text-muted-foreground"> → {label(String(nv.status))}</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(a.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
