import { createFileRoute, Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoAccess, PageHeader, StatCard } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";
import { useReceivables } from "@/hooks/use-receivables";
import { ageingBucket, BUCKETS, downloadCsv, inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ageing")({
  head: () => ({
    meta: [
      { title: "Ageing — AJ's Chartered Desk" },
      { name: "description", content: "Receivables ageing analysis." },
    ],
  }),
  component: AgeingPage,
});

function AgeingPage() {
  const { isFinance, loading } = useRoles();
  const q = useReceivables(isFinance);
  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  const open = (q.data ?? []).filter((i) => Number(i.outstanding) > 0);
  const totals = Object.fromEntries(
    BUCKETS.map((b) => [
      b,
      open
        .filter((i) => ageingBucket(i.due_date) === b)
        .reduce((s, i) => s + Number(i.outstanding), 0),
    ]),
  );
  const clients = Object.values(
    open.reduce<Record<string, { id: string; name: string; b: Record<string, number>; t: number }>>(
      (acc, i) => {
        const c = (acc[i.client_id] ??= {
          id: i.client_id,
          name: i.clients?.name ?? "",
          b: {},
          t: 0,
        });
        const k = ageingBucket(i.due_date);
        c.b[k] = (c.b[k] ?? 0) + Number(i.outstanding);
        c.t += Number(i.outstanding);
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b.t - a.t);
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader
        title="Receivables Ageing"
        subtitle="Outstanding grouped by days past due date"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 font-medium"
            disabled={!clients.length}
            onClick={() => {
              const stamp = new Date().toISOString().slice(0, 10);
              downloadCsv(
                `receivables_ageing_${stamp}.csv`,
                clients.map((c) => ({
                  Client: c.name,
                  "Current (0 days)": c.b["Current"] || 0,
                  "1–30 Days": c.b["1–30 Days"] || 0,
                  "31–60 Days": c.b["31–60 Days"] || 0,
                  "61–90 Days": c.b["61–90 Days"] || 0,
                  "90+ Days": c.b["90+ Days"] || 0,
                  "Total Outstanding": c.t,
                })),
              );
            }}
            title="Export ageing analysis to CSV"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {BUCKETS.map((b, i) => (
          <StatCard
            key={b}
            label={b}
            value={inr(totals[b])}
            tone={i === 0 ? "info" : i < 2 ? "warning" : "danger"}
          />
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5">Client</th>
              {BUCKETS.map((b) => (
                <th key={b} className="px-3 text-right">
                  {b}
                </th>
              ))}
              <th className="px-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  No receivables to age.
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2.5">
                  <Link
                    to="/clients/$id"
                    params={{ id: c.id }}
                    className="font-medium hover:underline"
                  >
                    {c.name}
                  </Link>
                </td>
                {BUCKETS.map((b) => (
                  <td key={b} className="px-3 text-right tabular-nums">
                    {c.b[b] ? inr(c.b[b]) : "—"}
                  </td>
                ))}
                <td className="px-3 text-right font-semibold tabular-nums">{inr(c.t)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2.5">Total</td>
              {BUCKETS.map((b) => (
                <td key={b} className="px-3 text-right tabular-nums">
                  {inr(totals[b])}
                </td>
              ))}
              <td className="px-3 text-right tabular-nums">{inr(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
