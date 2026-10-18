import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/DataTable";
import { NativeSelect, NoAccess, PageHeader, StatCard } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { daysBetween, errMsg, fmtDate, inr, MODES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/reconciliation")({
  head: () => ({
    meta: [
      { title: "Reconciliation — AJ's Chartered Desk" },
      { name: "description", content: "Bank and cash reconciliation." },
    ],
  }),
  component: ReconPage,
});

function parseDate(s: string) {
  const t = s.trim();
  const m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return null;
}
function splitCsv(line: string) {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function ReconPage() {
  const { isFinance, loading } = useRoles();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("unmatched");
  const q = useQuery({
    queryKey: ["recon"],
    enabled: isFinance,
    queryFn: async () => {
      const [t, p] = await Promise.all([
        supabase.from("bank_transactions").select("*").order("txn_date", { ascending: false }),
        supabase
          .from("payments")
          .select("id,payment_code,amount,payment_date,reference,mode,status,clients(name)")
          .neq("status", "reversed"),
      ]);
      if (t.error) throw t.error;
      return { txns: t.data, payments: p.data ?? [] };
    },
  });
  if (loading) return null;
  if (!isFinance) return <NoAccess />;

  const txns = q.data?.txns ?? [];
  const pays = q.data?.payments ?? [];
  const matchedIds = new Set(txns.map((t) => t.matched_payment_id).filter(Boolean));
  const suggest = (t: (typeof txns)[number]) => {
    if (t.direction !== "credit") return { match: null, mismatch: null };
    const free = pays.filter((p) => !matchedIds.has(p.id));
    const byRef = t.reference
      ? free.find((p) => p.reference && p.reference.toLowerCase() === t.reference!.toLowerCase())
      : undefined;
    if (byRef && Number(byRef.amount) === Number(t.amount)) return { match: byRef, mismatch: null };
    if (byRef) return { match: null, mismatch: byRef };
    const byAmt = free.find(
      (p) =>
        Number(p.amount) === Number(t.amount) &&
        Math.abs(daysBetween(p.payment_date, t.txn_date)) <= 3 &&
        p.mode !== "cash",
    );
    return { match: byAmt ?? null, mismatch: null };
  };
  const dupKey = (t: (typeof txns)[number]) => `${t.txn_date}|${t.amount}|${t.reference ?? ""}`;
  const counts = txns.reduce<Record<string, number>>(
    (a, t) => ((a[dupKey(t)] = (a[dupKey(t)] ?? 0) + 1), a),
    {},
  );
  const rows = txns.filter(
    (t) =>
      filter === "all" || (filter === "duplicates" ? counts[dupKey(t)] > 1 : t.status === filter),
  );
  const unmatchedPays = pays.filter((p) => p.mode !== "cash" && !matchedIds.has(p.id));

  const onFile = async (f: File) => {
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const head = splitCsv(lines[0]).map((h) => h.toLowerCase());
    const idx = (n: string[]) => head.findIndex((h) => n.some((x) => h.includes(x)));
    const di = idx(["date"]),
      de = idx(["desc", "narration", "particular"]),
      re = idx(["ref", "utr", "cheque"]),
      am = idx(["amount"]),
      dc = idx(["debit/credit", "type", "dr/cr", "cr/dr"]);
    const cr = idx(["credit"]),
      dr = idx(["debit"]);
    const batch = `CSV-${new Date().toISOString().slice(0, 16)}`;
    const recs: {
      txn_date: string;
      description: string;
      reference: string | null;
      amount: number;
      direction: string;
      import_batch: string;
    }[] = [];
    let bad = 0;
    for (const l of lines.slice(1)) {
      const c = splitCsv(l);
      const date = parseDate(c[di] ?? "");
      let amount = 0,
        direction = "credit";
      if (am >= 0 && c[am]) {
        amount = Number(c[am].replace(/[₹,\s]/g, ""));
        direction = dc >= 0 && /^d/i.test(c[dc] ?? "") ? "debit" : amount < 0 ? "debit" : "credit";
      } else if (cr >= 0 || dr >= 0) {
        const crv = Number((c[cr] ?? "").replace(/[₹,\s]/g, "")) || 0;
        const drv = Number((c[dr] ?? "").replace(/[₹,\s]/g, "")) || 0;
        amount = crv || drv;
        direction = crv ? "credit" : "debit";
      }
      if (!date || !amount) {
        bad++;
        continue;
      }
      recs.push({
        txn_date: date,
        description: c[de] ?? "",
        reference: re >= 0 ? c[re] || null : null,
        amount: Math.abs(amount),
        direction,
        import_batch: batch,
      });
    }
    if (!recs.length)
      return toast.error(
        "No valid rows. Expected columns: Date, Description, Reference, Amount, Debit/Credit",
      );
    const { error } = await supabase.from("bank_transactions").insert(recs);
    if (error) return toast.error(errMsg(error));
    toast.success(`Imported ${recs.length} transactions${bad ? ` (${bad} rows skipped)` : ""}`);
    qc.invalidateQueries({ queryKey: ["recon"] });
  };
  const reconcile = async (id: string, paymentId: string | null, status = "reconciled") => {
    const { error } = await supabase
      .from("bank_transactions")
      .update({ status, matched_payment_id: paymentId })
      .eq("id", id);
    if (error) return toast.error(errMsg(error));
    toast.success(status === "reconciled" ? "Marked reconciled" : "Updated");
    qc.invalidateQueries({ queryKey: ["recon"] });
  };

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Match bank statement lines to recorded payments. Nothing is matched without your confirmation."
        actions={
          <>
            <input
              ref={file}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <Button onClick={() => file.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />
              Import CSV
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Reconciled"
          value={txns.filter((t) => t.status === "reconciled").length}
          tone="success"
        />
        <StatCard
          label="Unmatched bank lines"
          value={txns.filter((t) => t.status === "unmatched").length}
          tone="warning"
        />
        <StatCard
          label="Possible duplicates"
          value={txns.filter((t) => counts[dupKey(t)] > 1).length}
          tone="danger"
        />
        <StatCard
          label="Payments not in bank"
          value={unmatchedPays.length}
          hint="Non-cash payments without a matched bank line"
        />
      </div>
      <DataTable
        rows={rows}
        loading={q.isLoading}
        empty="No bank transactions in this view. Import a CSV statement to begin."
        search={(t) => `${t.description} ${t.reference} ${t.amount}`}
        toolbar={
          <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40">
            <option value="unmatched">Unmatched</option>
            <option value="reconciled">Reconciled</option>
            <option value="ignored">Ignored</option>
            <option value="duplicates">Possible duplicates</option>
            <option value="all">All</option>
          </NativeSelect>
        }
        columns={[
          { key: "d", header: "Date", sort: (t) => t.txn_date, render: (t) => fmtDate(t.txn_date) },
          { key: "description", header: "Description" },
          { key: "reference", header: "Reference", className: "font-mono text-xs" },
          {
            key: "a",
            header: "Amount",
            align: "right",
            render: (t) => (
              <span className={t.direction === "debit" ? "text-destructive" : ""}>
                {t.direction === "debit" ? "−" : ""}
                {inr(t.amount)}
              </span>
            ),
          },
          {
            key: "s",
            header: "Status",
            render: (t) => (
              <span className="flex gap-1">
                <StatusBadge status={t.status} />
                {counts[dupKey(t)] > 1 && <StatusBadge status="overdue" className="!text-[10px]" />}
              </span>
            ),
          },
          {
            key: "m",
            header: "Suggested match",
            render: (t) => {
              if (t.status === "reconciled") {
                const p = pays.find((x) => x.id === t.matched_payment_id);
                return p ? (
                  <span className="text-xs">
                    {p.payment_code} · {p.clients?.name}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Manual</span>
                );
              }
              if (t.status !== "unmatched") return null;
              const { match, mismatch } = suggest(t);
              if (match)
                return (
                  <span className="text-xs">
                    {match.payment_code} · {match.clients?.name} · {inr(match.amount)} ·{" "}
                    {fmtDate(match.payment_date)}
                  </span>
                );
              if (mismatch)
                return (
                  <span className="text-xs text-destructive">
                    Amount mismatch: {mismatch.payment_code} recorded {inr(mismatch.amount)}
                  </span>
                );
              return <span className="text-xs text-muted-foreground">No candidate</span>;
            },
          },
          {
            key: "x",
            header: "",
            render: (t) => {
              if (t.status !== "unmatched")
                return t.status === "reconciled" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => reconcile(t.id, null, "unmatched")}
                  >
                    Undo
                  </Button>
                ) : null;
              const { match } = suggest(t);
              const free = pays.filter((p) => !matchedIds.has(p.id));
              return (
                <div className="flex flex-wrap gap-1">
                  {match && (
                    <Button size="sm" onClick={() => reconcile(t.id, match.id)}>
                      Confirm match
                    </Button>
                  )}
                  <NativeSelect
                    className="h-8 w-44 text-xs"
                    value=""
                    onChange={(e) => e.target.value && reconcile(t.id, e.target.value)}
                  >
                    <option value="">Match to payment…</option>
                    {free.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.payment_code} · {p.clients?.name} · {inr(p.amount)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button size="sm" variant="outline" onClick={() => reconcile(t.id, null)}>
                    Mark reconciled
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => reconcile(t.id, null, "ignored")}
                  >
                    Ignore
                  </Button>
                </div>
              );
            },
          },
        ]}
      />
      {unmatchedPays.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Recorded payments with no bank line</h2>
          <DataTable
            rows={unmatchedPays}
            pageSize={8}
            columns={[
              { key: "payment_code", header: "Payment", className: "font-mono text-xs" },
              { key: "c", header: "Client", render: (p) => p.clients?.name },
              { key: "d", header: "Date", render: (p) => fmtDate(p.payment_date) },
              { key: "m", header: "Mode", render: (p) => MODES[p.mode] },
              { key: "reference", header: "Reference" },
              { key: "a", header: "Amount", align: "right", render: (p) => inr(p.amount) },
              { key: "s", header: "Allocation", render: (p) => <StatusBadge status={p.status} /> },
            ]}
          />
        </div>
      )}
    </div>
  );
}
