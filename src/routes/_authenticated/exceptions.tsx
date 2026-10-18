import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { NoAccess, PageHeader } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";
import { fmtDate, inr, invoiceDisplayStatus, jobDisplayStatus } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/exceptions")({
  head: () => ({
    meta: [
      { title: "Exceptions — AJ's Chartered Desk" },
      { name: "description", content: "Items needing attention." },
    ],
  }),
  component: ExceptionsPage,
});

function ExceptionsPage() {
  const { isFinance, loading } = useRoles();
  const q = useQuery({
    queryKey: ["exceptions"],
    enabled: isFinance,
    queryFn: async () => {
      const [p, j, i, b, a] = await Promise.all([
        supabase
          .from("payments")
          .select(
            "id,payment_code,client_id,amount,allocated_amount,payment_date,reference,status,clients(name)",
          )
          .neq("status", "reversed"),
        supabase
          .from("jobs")
          .select("id,job_code,title,status,due_date,financial_status,clients(name)"),
        supabase
          .from("invoices")
          .select(
            "id,invoice_no,status,due_date,total,subtotal,discount,amount_paid,outstanding,clients(name), invoice_items(job_id)",
          ),
        supabase
          .from("bank_transactions")
          .select("id,txn_date,description,amount,status")
          .eq("status", "unmatched"),
        supabase.from("payment_allocations").select("payment_id,amount,reversed"),
      ]);
      return {
        p: p.data ?? [],
        j: j.data ?? [],
        i: i.data ?? [],
        b: b.data ?? [],
        a: a.data ?? [],
      };
    },
  });
  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  const d = q.data ?? { p: [], j: [], i: [], b: [], a: [] };

  const unalloc = d.p.filter((p) => Number(p.amount) > Number(p.allocated_amount));
  const dupKey = (p: (typeof d.p)[number]) => `${p.client_id}|${p.amount}|${p.payment_date}`;
  const cnt = d.p.reduce<Record<string, number>>(
    (a, p) => ((a[dupKey(p)] = (a[dupKey(p)] ?? 0) + 1), a),
    {},
  );
  const refCnt = d.p.reduce<Record<string, number>>(
    (a, p) => (p.reference ? ((a[p.reference] = (a[p.reference] ?? 0) + 1), a) : a),
    {},
  );
  const dups = d.p.filter((p) => cnt[dupKey(p)] > 1 || (p.reference && refCnt[p.reference] > 1));
  const overdueJobs = d.j.filter((j) => jobDisplayStatus(j) === "overdue");
  const overdueInv = d.i.filter((i) => invoiceDisplayStatus(i) === "overdue");
  const allocSum = d.a
    .filter((x) => !x.reversed)
    .reduce<Record<string, number>>(
      (s, x) => ((s[x.payment_id] = (s[x.payment_id] ?? 0) + Number(x.amount)), s),
      {},
    );
  const mismatch = d.p.filter(
    (p) =>
      Math.abs((allocSum[p.id] ?? 0) - Number(p.allocated_amount)) > 0.01 ||
      Number(p.allocated_amount) > Number(p.amount),
  );
  const paidJobIds = new Set(
    d.i
      .filter((i) => Number(i.amount_paid) > 0)
      .flatMap((i) => i.invoice_items.map((x) => x.job_id)),
  );
  const cancelledPaid = d.j.filter((j) => j.status === "cancelled" && paidJobIds.has(j.id));
  const unusual = d.i.filter(
    (i) => Number(i.subtotal) > 0 && Number(i.discount) / Number(i.subtotal) >= 0.2,
  );

  return (
    <div>
      <PageHeader title="Exceptions" subtitle="Things that need a second look" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Box title="Unallocated Payments" n={unalloc.length} empty="No unallocated payments">
          {unalloc.map((p) => (
            <Li
              key={p.id}
              l={
                <Link
                  to="/clearing"
                  search={{ payment: p.id }}
                  className="text-primary hover:underline"
                >
                  {p.payment_code} · {p.clients?.name}
                </Link>
              }
              r={inr(Number(p.amount) - Number(p.allocated_amount))}
            />
          ))}
        </Box>
        <Box title="Duplicate Payment Candidates" n={dups.length} empty="No duplicate candidates">
          {dups.map((p) => (
            <Li
              key={p.id}
              l={`${p.payment_code} · ${p.clients?.name} · ${fmtDate(p.payment_date)} · ${p.reference ?? ""}`}
              r={inr(p.amount)}
            />
          ))}
        </Box>
        <Box title="Unmatched Bank Transactions" n={d.b.length} empty="All bank lines matched">
          {d.b.map((b) => (
            <Li
              key={b.id}
              l={
                <Link to="/reconciliation" className="hover:underline">
                  {fmtDate(b.txn_date)} · {b.description}
                </Link>
              }
              r={inr(b.amount)}
            />
          ))}
        </Box>
        <Box title="Overdue Jobs" n={overdueJobs.length} empty="No overdue jobs">
          {overdueJobs.map((j) => (
            <Li
              key={j.id}
              l={
                <Link to="/jobs/$id" params={{ id: j.id }} className="text-primary hover:underline">
                  {j.job_code} · {j.title} · {j.clients?.name}
                </Link>
              }
              r={`Due ${fmtDate(j.due_date)}`}
            />
          ))}
        </Box>
        <Box title="Overdue Invoices" n={overdueInv.length} empty="No overdue invoices">
          {overdueInv.map((i) => (
            <Li
              key={i.id}
              l={
                <Link
                  to="/invoices/$id"
                  params={{ id: i.id }}
                  className="text-primary hover:underline"
                >
                  {i.invoice_no} · {i.clients?.name}
                </Link>
              }
              r={inr(i.outstanding)}
            />
          ))}
        </Box>
        <Box
          title="Payment Allocation Mismatches"
          n={mismatch.length}
          empty="All allocations reconcile with payment amounts"
        >
          {mismatch.map((p) => (
            <Li
              key={p.id}
              l={p.payment_code}
              r={`${inr(p.allocated_amount)} vs ${inr(allocSum[p.id] ?? 0)}`}
            />
          ))}
        </Box>
        <Box title="Cancelled Jobs with Payments" n={cancelledPaid.length} empty="None">
          {cancelledPaid.map((j) => (
            <Li key={j.id} l={`${j.job_code} · ${j.title}`} r={j.clients?.name ?? ""} />
          ))}
        </Box>
        <Box
          title="Invoices with Unusual Adjustments (≥20% discount)"
          n={unusual.length}
          empty="None"
        >
          {unusual.map((i) => (
            <Li
              key={i.id}
              l={
                <Link
                  to="/invoices/$id"
                  params={{ id: i.id }}
                  className="text-primary hover:underline"
                >
                  {i.invoice_no} · {i.clients?.name}
                </Link>
              }
              r={`${inr(i.discount)} off ${inr(i.subtotal)}`}
            />
          ))}
        </Box>
      </div>
    </div>
  );
}

function Box({
  title,
  n,
  empty,
  children,
}: {
  title: string;
  n: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <span
          className={`rounded-full px-2 text-xs font-semibold ${n ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success"}`}
        >
          {n}
        </span>
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto text-sm">
        {n === 0 ? (
          <li className="px-4 py-6 text-center text-muted-foreground">{empty}</li>
        ) : (
          children
        )}
      </ul>
    </div>
  );
}
const Li = ({ l, r }: { l: ReactNode; r: ReactNode }) => (
  <li className="flex justify-between gap-3 px-4 py-2">
    <span className="truncate">{l}</span>
    <span className="shrink-0 tabular-nums text-muted-foreground">{r}</span>
  </li>
);
