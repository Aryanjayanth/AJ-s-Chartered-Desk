import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Receipt, Briefcase, FileText, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoAccess, PageHeader, StatCard } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";
import { useReceivables, type ReceivableType } from "@/hooks/use-receivables";
import { ageingBucket, BUCKETS, downloadCsv, inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ageing")({
  head: () => ({
    meta: [
      { title: "Ageing — AJ's Chartered Desk" },
      {
        name: "description",
        content:
          "Receivables ageing analysis across invoices, completed jobs, and client expenses.",
      },
    ],
  }),
  component: AgeingPage,
});

function AgeingPage() {
  const { isFinance, loading } = useRoles();
  const q = useReceivables(isFinance);
  const [typeFilter, setTypeFilter] = useState<ReceivableType | "">("");
  const [search, setSearch] = useState("");

  if (loading) return null;
  if (!isFinance) return <NoAccess />;

  const allOpen = (q.data ?? []).filter((i) => Number(i.outstanding) > 0);
  const open = typeFilter ? allOpen.filter((i) => i.type === typeFilter) : allOpen;

  const totals = Object.fromEntries(
    BUCKETS.map((b) => [
      b,
      open
        .filter((i) => ageingBucket(i.due_date) === b)
        .reduce((s, i) => s + Number(i.outstanding), 0),
    ]),
  );

  const clients = Object.values(
    open.reduce<
      Record<
        string,
        {
          id: string;
          name: string;
          b: Record<string, number>;
          t: number;
          invTotal: number;
          jobTotal: number;
          expTotal: number;
        }
      >
    >((acc, i) => {
      const c = (acc[i.client_id] ??= {
        id: i.client_id,
        name: i.client_name || i.clients?.name || "",
        b: {},
        t: 0,
        invTotal: 0,
        jobTotal: 0,
        expTotal: 0,
      });
      const k = ageingBucket(i.due_date) || "Current";
      c.b[k] = (c.b[k] ?? 0) + Number(i.outstanding);
      c.t += Number(i.outstanding);

      if (i.type === "invoice") c.invTotal += Number(i.outstanding);
      else if (i.type === "job") c.jobTotal += Number(i.outstanding);
      else if (i.type === "expense") c.expTotal += Number(i.outstanding);

      return acc;
    }, {}),
  ).sort((a, b) => b.t - a.t);

  const filteredClients = clients.filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const grand = Object.values(totals).reduce((a, b) => a + b, 0);

  const totalInv = allOpen
    .filter((i) => i.type === "invoice")
    .reduce((a, b) => a + b.outstanding, 0);
  const totalJobs = allOpen.filter((i) => i.type === "job").reduce((a, b) => a + b.outstanding, 0);
  const totalExp = allOpen
    .filter((i) => i.type === "expense")
    .reduce((a, b) => a + b.outstanding, 0);

  return (
    <div>
      <PageHeader
        title="Receivables Ageing"
        subtitle="Outstanding balances grouped by days past due date (Invoices, Completed Jobs & Expenses)"
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
                  "Invoices Out": c.invTotal,
                  "Jobs Out": c.jobTotal,
                  "Expenses Out": c.expTotal,
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

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTypeFilter("")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !typeFilter
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          <span>All Receivables</span>
          <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[10px]">
            {allOpen.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter(typeFilter === "invoice" ? "" : "invoice")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            typeFilter === "invoice"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20"
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          <span>Invoices ({inr(totalInv)})</span>
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter(typeFilter === "job" ? "" : "job")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            typeFilter === "job"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
          }`}
        >
          <Briefcase className="h-3.5 w-3.5" />
          <span>Completed Jobs ({inr(totalJobs)})</span>
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter(typeFilter === "expense" ? "" : "expense")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            typeFilter === "expense"
              ? "bg-amber-600 text-white shadow-sm"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Expenses ({inr(totalExp)})</span>
        </button>
      </div>

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

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client in ageing..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
        {search && (
          <span className="text-xs text-muted-foreground">
            Showing {filteredClients.length} of {clients.length} clients
          </span>
        )}
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
              <th className="px-3 text-right">Total Outstanding</th>
              <th className="px-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted-foreground">
                  {search ? "No clients matching search." : "No receivables to age."}
                </td>
              </tr>
            )}
            {filteredClients.map((c) => (
              <tr key={c.id} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2.5">
                  <Link
                    to="/clients/$id"
                    params={{ id: c.id }}
                    className="font-medium hover:underline text-foreground block"
                  >
                    {c.name}
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    {c.invTotal > 0 && (
                      <span className="text-blue-600 dark:text-blue-400">
                        Inv: {inr(c.invTotal)}
                      </span>
                    )}
                    {c.jobTotal > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Jobs: {inr(c.jobTotal)}
                      </span>
                    )}
                    {c.expTotal > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        Exp: {inr(c.expTotal)}
                      </span>
                    )}
                  </div>
                </td>
                {BUCKETS.map((b) => (
                  <td key={b} className="px-3 text-right tabular-nums">
                    {c.b[b] ? inr(c.b[b]) : "—"}
                  </td>
                ))}
                <td className="px-3 text-right font-semibold tabular-nums text-destructive">
                  {inr(c.t)}
                </td>
                <td className="px-3 text-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-primary hover:bg-primary/10 gap-1 px-2"
                    asChild
                  >
                    <Link to="/clearing" search={{ client: c.id }}>
                      <span>Clear</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                </td>
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
              <td className="px-3 text-right tabular-nums text-destructive">{inr(grand)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
