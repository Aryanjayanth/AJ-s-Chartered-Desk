import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ageingBucket,
  BUCKETS,
  inr,
  invoiceDisplayStatus,
  jobDisplayStatus,
  label,
  MODES,
} from "@/lib/format";

/**
 * The charts read a handful of fields off four different tables (invoices,
 * payments, jobs, bank transactions). Typing the union structurally keeps the
 * `invoiceDisplayStatus` / `jobDisplayStatus` helpers usable without casting.
 */
type ChartRow = {
  status: string | null;
  due_date?: string | null;
  invoice_date?: string | null;
  payment_date?: string | null;
  outstanding?: number | null;
  total?: number | null;
  amount?: number | null;
  mode?: string | null;
  clients?: { name?: string | null } | null;
};

export type ChartData = { i: ChartRow[]; p: ChartRow[]; j: ChartRow[]; b: ChartRow[] };

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--primary)",
  "var(--muted-foreground)",
];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="h-64">{children}</div>
    </div>
  );
}

const Empty = () => (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    No data
  </div>
);

function PieBox({
  data,
  isCurrency = false,
}: {
  data: { name: string; value: number }[];
  isCurrency?: boolean;
}) {
  const d = data.filter((x) => x.value > 0);
  if (!d.length) return <Empty />;
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie
          data={d}
          dataKey="value"
          nameKey="name"
          innerRadius={45}
          outerRadius={85}
          paddingAngle={2}
        >
          {d.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => (isCurrency ? inr(v) : v.toLocaleString("en-IN"))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ReportCharts({ data }: { data: ChartData }) {
  const live = data.i.filter((i) => i.status !== "cancelled");
  const pays = data.p.filter((p) => p.status !== "reversed");

  const months = new Map<string, { month: string; Invoiced: number; Collected: number }>();
  const m = (dt: string | null | undefined) => {
    if (!dt || dt.length < 7) return null;
    const k = dt.slice(0, 7);
    if (!months.has(k)) months.set(k, { month: k, Invoiced: 0, Collected: 0 });
    return months.get(k)!;
  };
  live.forEach((i) => {
    const entry = m(i.invoice_date);
    if (entry) entry.Invoiced += Number(i.total || 0);
  });
  pays.forEach((p) => {
    const entry = m(p.payment_date);
    if (entry) entry.Collected += Number(p.amount || 0);
  });
  const trend = [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map((x) => ({ ...x, month: `${x.month.slice(5)}-${x.month.slice(0, 4)}` }));

  const modes = Object.entries(MODES).map(([k, v]) => ({
    name: v,
    value: pays.filter((p) => p.mode === k).reduce((a, p) => a + Number(p.amount), 0),
  }));
  const open = live.filter(
    (i) => Number(i.outstanding) > 0 && (i.status === "unpaid" || i.status === "partially_paid"),
  );
  const ageing = BUCKETS.map((b) => ({
    name: b,
    value: open
      .filter((i) => ageingBucket(i.due_date ?? "") === b)
      .reduce((a, i) => a + Number(i.outstanding), 0),
  }));
  const invStatus = Object.entries(
    data.i.reduce<Record<string, number>>((a, i) => {
      const s = label(
        invoiceDisplayStatus({
          status: i.status ?? "",
          due_date: i.due_date ?? "",
          outstanding: i.outstanding ?? null,
        }),
      );
      a[s] = (a[s] ?? 0) + 1;
      return a;
    }, {}),
  ).map(([name, value]) => ({ name, value }));
  const jobStatus = Object.entries(
    data.j.reduce<Record<string, number>>((a, j) => {
      const s = label(jobDisplayStatus({ status: j.status ?? "", due_date: j.due_date ?? null }));
      a[s] = (a[s] ?? 0) + 1;
      return a;
    }, {}),
  ).map(([name, value]) => ({ name, value }));
  const byClient = Object.values(
    open.reduce<Record<string, { name: string; Outstanding: number }>>((a, i) => {
      const n = i.clients?.name ?? "—";
      a[n] ??= { name: n, Outstanding: 0 };
      a[n].Outstanding += Number(i.outstanding);
      return a;
    }, {}),
  )
    .sort((a, b) => b.Outstanding - a.Outstanding)
    .slice(0, 8);
  const recon = ["reconciled", "unmatched", "ignored"].map((s) => ({
    name: label(s),
    value: data.b.filter((b) => b.status === s).length,
  }));
  const short = (v: number) =>
    v >= 10000000
      ? `₹${(v / 10000000).toFixed(1)}Cr`
      : v >= 100000
        ? `₹${(v / 100000).toFixed(1)}L`
        : v >= 1000
          ? `₹${(v / 1000).toFixed(0)}k`
          : `₹${v}`;

  return (
    <div className="no-print mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div className="md:col-span-2">
        <Card title="Invoiced vs Collected (monthly)">
          {trend.length ? (
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={short} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Invoiced" stroke="var(--chart-1)" strokeWidth={2} />
                <Line type="monotone" dataKey="Collected" stroke="var(--chart-2)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </Card>
      </div>
      <Card title="Collections by payment mode (₹)">
        <PieBox data={modes} isCurrency={true} />
      </Card>
      <Card title="Outstanding by ageing (₹)">
        <PieBox data={ageing} isCurrency={true} />
      </Card>
      <Card title="Invoice status (count)">
        <PieBox data={invStatus} />
      </Card>
      <Card title="Job status (count)">
        <PieBox data={jobStatus} />
      </Card>
      <div className="md:col-span-2">
        <Card title="Top clients by outstanding">
          {byClient.length ? (
            <ResponsiveContainer>
              <BarChart data={byClient}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={short} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Bar dataKey="Outstanding" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </Card>
      </div>
      <Card title="Bank reconciliation (lines)">
        <PieBox data={recon} />
      </Card>
    </div>
  );
}
