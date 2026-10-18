import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2, PlusCircle, History, Columns2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/app/DataTable";
import {
  ClientSelect,
  Field,
  NativeSelect,
  NoAccess,
  PageHeader,
  ReasonDialog,
  StatCard,
} from "@/components/app/common";
import { usePermissions } from "@/hooks/use-permissions";
import { useClientLookup } from "@/hooks/use-roles";
import { readList } from "@/lib/supabase-read";
import { cn } from "@/lib/utils";
import { errMsg, fmtDate, inr, MODES, today } from "@/lib/format";
import {
  CATEGORY_SUGGESTIONS,
  EXPENSE_KINDS,
  KIND_BLURB,
  KIND_IS_COST,
  KIND_LABEL,
  MODULE,
  type ExpenseDraft,
  type ExpenseKind,
  type ExpenseRow,
} from "@/lib/expenses";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Firm overheads, tax paid on a client's behalf, and reimbursements.",
      },
    ],
  }),
  component: ExpensesPage,
});

const emptyDraft: ExpenseDraft = {
  kind: "overhead",
  expense_date: today(),
  category: "",
  description: "",
  amount: "",
  mode: "bank",
  reference: "",
  paid_to: "",
  notes: "",
  client_id: "",
  job_id: "",
};

function ExpensesPage() {
  const { canView, canCreate, canEdit, canDelete, canSeeAmounts } = usePermissions();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<{ id: string; what: string } | null>(null);
  const [filter, setFilter] = useState<ExpenseKind | "">("");
  const [view, setView] = useState<"entry" | "history">("entry");
  const { data: clients } = useClientLookup();

  // Read through the RPC so `amount` is already NULL unless this user holds the
  // expenses "amounts" grant; the table renders a dash rather than reading a
  // figure the server deliberately withheld.
  const q = useQuery({
    queryKey: ["expenses"],
    enabled: canView(MODULE),
    queryFn: () => readList("expenses_list", {}, () => expenseTableFallback()),
  });

  const { data: jobs } = useQuery({
    queryKey: ["expense-job-lookup"],
    enabled: canView(MODULE),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,job_code,title,client_id")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const all = (q.data ?? []) as ExpenseRow[];
    return filter ? all.filter((e) => e.kind === filter) : all;
  }, [q.data, filter]);

  // Only overhead is a genuine cost, so the headline figure excludes the other
  // two kinds rather than presenting one misleading total.
  const totals = useMemo(() => {
    const all = (q.data ?? []) as ExpenseRow[];
    const sum = (k: ExpenseKind) =>
      all.filter((e) => e.kind === k && e.amount != null).reduce((s, e) => s + Number(e.amount), 0);
    const hidden = all.some((e) => e.amount == null);
    return {
      overhead: sum("overhead"),
      tax: sum("tax"),
      reimbursement: sum("reimbursement"),
      hidden,
      visible: all.some((e) => e.amount != null),
    };
  }, [q.data]);

  const set =
    <K extends keyof ExpenseDraft>(k: K) =>
    (v: ExpenseDraft[K]) =>
      setDraft((p) => ({ ...p, [k]: v }));

  const jobsForClient = useMemo(() => {
    if (!draft.client_id) return jobs ?? [];
    return (jobs ?? []).filter((j) => j.client_id === draft.client_id);
  }, [jobs, draft.client_id]);

  const save = async () => {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return toast.error("Amount must be greater than zero");
    if (draft.expense_date > today()) return toast.error("Date can't be in the future");

    setBusy(true);
    const category = draft.category.trim() || "Other";
    const description = draft.description.trim() || category || "Expense";
    const payload = {
      kind: draft.kind,
      expense_date: draft.expense_date,
      category,
      description,
      amount,
      mode: draft.mode,
      reference: draft.reference.trim() || null,
      paid_to: draft.paid_to.trim() || null,
      notes: draft.notes.trim() || null,
      client_id: draft.client_id || null,
      job_id: draft.job_id || null,
    };
    const { error } = await supabase.from("expenses").insert(payload);
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success("Expense recorded");
    setDraft({ ...emptyDraft, kind: draft.kind });
    qc.invalidateQueries();
  };

  const remove = async (reason: string) => {
    if (!del) return;
    const { error } = await supabase.rpc("delete_expense", {
      _expense_id: del.id,
      _reason: reason,
    });
    if (error) {
      toast.error(errMsg(error));
      throw error;
    }
    toast.success("Expense deleted");
    setDel(null);
    qc.invalidateQueries();
  };

  if (!canView(MODULE)) return <NoAccess />;

  const renderForm = (compact = false) => (
    <Card className="shadow-none">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Record an Expense</CardTitle>
          {!compact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setView("history")}
            >
              View History ({rows.length})
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-3.5"
        >
          <Field label="Client (Optional)">
            <ClientSelect
              value={draft.client_id}
              onChange={(id) => {
                set("client_id")(id);
                set("job_id")("");
              }}
              noneLabel="Firm Overhead (No client)"
              placeholder="Select client or search…"
            />
          </Field>

          {draft.client_id && (
            <Field label="Job (Optional)" hint="Leave unselected for general client expense">
              <NativeSelect value={draft.job_id} onChange={(e) => set("job_id")(e.target.value)}>
                <option value="">General client expense (Not tied to a specific job)</option>
                {jobsForClient.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_code} · {j.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <NativeSelect
                value={draft.kind}
                onChange={(e) => set("kind")(e.target.value as ExpenseKind)}
              >
                {EXPENSE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Category">
              <Input
                list="category-suggestions"
                value={draft.category}
                onChange={(e) => set("category")(e.target.value)}
                placeholder="Category name…"
              />
              <datalist id="category-suggestions">
                {CATEGORY_SUGGESTIONS[draft.kind].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹) *">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.amount}
                onChange={(e) => set("amount")(e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                max={today()}
                value={draft.expense_date}
                onChange={(e) => set("expense_date")(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment Mode">
              <NativeSelect value={draft.mode} onChange={(e) => set("mode")(e.target.value)}>
                {Object.entries(MODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Paid To">
              <Input
                value={draft.paid_to}
                onChange={(e) => set("paid_to")(e.target.value)}
                placeholder="Payee / vendor"
              />
            </Field>
          </div>

          <Field label="Reference">
            <Input
              value={draft.reference}
              onChange={(e) => set("reference")(e.target.value)}
              placeholder="UTR / Challan / Bill no."
            />
          </Field>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={draft.notes}
              onChange={(e) => set("notes")(e.target.value)}
              placeholder="Additional remarks…"
            />
          </Field>

          <Field label="Description (Optional)">
            <Input
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="Enter description (optional)…"
            />
          </Field>

          <Button className="w-full font-medium" disabled={busy}>
            {busy ? "Saving…" : "Save Expense"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );

  const renderTable = (compact = false) => (
    <div>
      {!compact && canCreate(MODULE) && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Total expenses recorded: <strong className="text-foreground">{rows.length}</strong>
          </div>
          <Button
            size="sm"
            onClick={() => setView("entry")}
            className="h-8 text-xs gap-1.5 font-medium cursor-pointer"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Record an Expense
          </Button>
        </div>
      )}
      <DataTable
        rows={rows}
        loading={q.isLoading}
        empty={
          filter
            ? `No ${KIND_LABEL[filter as ExpenseKind].toLowerCase()} recorded yet.`
            : "No expenses recorded yet."
        }
        search={(e) =>
          `${e.category} ${e.description} ${e.reference ?? ""} ${e.paid_to ?? ""} ${e.job_code ?? ""} ${e.client_name ?? ""}`
        }
        exportFilename="expenses"
        exportTransform={(e) => ({
          Client: e.client_name ?? "Firm Overhead",
          "Job Code": e.job_code ?? "",
          Date: fmtDate(e.expense_date),
          Kind: KIND_LABEL[e.kind],
          Category: e.category,
          Description: e.description,
          "Paid To": e.paid_to ?? "",
          Mode: MODES[e.mode] ?? e.mode,
          Reference: e.reference ?? "",
          Amount: canSeeAmounts("expenses") && e.amount != null ? e.amount : "—",
          Notes: e.notes ?? "",
        })}
        columns={[
          {
            key: "client_name",
            header: "Client / Job",
            align: "left",
            sort: (e) => e.client_name ?? "",
            render: (e) => (
              <div className="flex flex-col min-w-[140px]">
                <span className="font-semibold text-sm text-foreground leading-tight">
                  {e.client_name ?? (
                    <span className="text-muted-foreground/80 font-normal italic">
                      Firm Overhead
                    </span>
                  )}
                </span>
                {e.job_code ? (
                  <span className="text-[11px] font-mono font-medium text-muted-foreground flex items-center gap-1 mt-0.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70"></span>
                    {e.job_code}
                  </span>
                ) : null}
              </div>
            ),
          },
          {
            key: "description",
            header: "Description",
            render: (e) => (
              <div className="flex flex-col max-w-[280px]">
                <span className="text-sm font-medium text-foreground leading-snug">
                  {e.description}
                </span>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                  {e.paid_to && (
                    <span>
                      Paid to:{" "}
                      <strong className="font-medium text-foreground/80">{e.paid_to}</strong>
                    </span>
                  )}
                  {e.reference && (
                    <span className="font-mono text-[11px] bg-muted/60 px-1.5 py-0.5 rounded border border-border/40">
                      Ref: {e.reference}
                    </span>
                  )}
                </div>
              </div>
            ),
          },
          {
            key: "kind",
            header: "Kind",
            render: (e) => (
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
                  KIND_IS_COST[e.kind]
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                    : e.kind === "tax"
                      ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20"
                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
                )}
              >
                {KIND_LABEL[e.kind]}
              </span>
            ),
          },
          {
            key: "category",
            header: "Category",
            sort: (e) => e.category,
            render: (e) => (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground border border-border/40 whitespace-nowrap">
                {e.category}
              </span>
            ),
          },
          {
            key: "expense_date",
            header: "Date",
            sort: (e) => e.expense_date,
            render: (e) => (
              <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">
                {fmtDate(e.expense_date)}
              </span>
            ),
          },
          {
            key: "mode",
            header: "Mode",
            render: (e) => (
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap",
                  e.mode === "bank"
                    ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                    : e.mode === "cash"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                      : "bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20",
                )}
              >
                {MODES[e.mode] ?? e.mode}
              </span>
            ),
          },
          {
            key: "amount",
            header: "Amount",
            align: "right",
            sort: (e) => Number(e.amount ?? 0),
            render: (e) => (
              <span className="font-semibold text-sm tabular-nums text-foreground">
                {e.amount == null ? "—" : inr(e.amount)}
              </span>
            ),
          },
          ...(canDelete(MODULE)
            ? [
                {
                  key: "x",
                  header: "",
                  render: (e: ExpenseRow) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Delete this expense"
                      onClick={() =>
                        setDel({ id: e.id, what: `${e.description} · ${inr(e.amount)}` })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Every rupee that leaves the firm, kept apart by kind so the totals mean something."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setView("entry")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer",
                  view === "entry"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Expense Entry
              </button>
              <button
                type="button"
                onClick={() => setView("history")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer",
                  view === "history"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <History className="h-3.5 w-3.5" />
                Expense History {rows.length > 0 && `(${rows.length})`}
              </button>
            </div>

            {view === "history" && (
              <NativeSelect
                value={filter}
                onChange={(e) => setFilter(e.target.value as ExpenseKind | "")}
                className="w-36 text-xs h-8"
                aria-label="Filter by kind"
              >
                <option value="">All kinds</option>
                {EXPENSE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Firm overhead"
          value={totals.hidden ? "—" : inr(totals.overhead)}
          tone="warning"
        />
        <StatCard
          label="Tax paid for clients"
          value={totals.hidden ? "—" : inr(totals.tax)}
          tone="info"
        />
        <StatCard label="Reimbursements" value={totals.hidden ? "—" : inr(totals.reimbursement)} />
      </div>
      {totals.hidden && (
        <p className="mb-4 text-xs text-muted-foreground">
          Amounts are hidden because your role does not include the Expenses → Amounts grant. An
          Admin can switch it on under Roles &amp; Permissions.
        </p>
      )}

      {view === "entry" && (
        <div className="max-w-2xl mx-auto space-y-4">
          {canCreate(MODULE) ? (
            renderForm(false)
          ) : (
            <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              You do not have permission to record expenses.
            </div>
          )}

          {rows.length > 0 && (
            <Card className="shadow-none border border-border/60">
              <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent Expenses
                </CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs text-primary px-2"
                  onClick={() => setView("history")}
                >
                  View all ({rows.length}) →
                </Button>
              </CardHeader>
              <CardContent className="p-0 divide-y divide-border/40 text-xs">
                {rows.slice(0, 5).map((e) => (
                  <div key={e.id} className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-foreground">
                        {e.description || e.category}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtDate(e.expense_date)} · {e.category} {e.paid_to && `· To: ${e.paid_to}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-semibold">
                        {e.amount != null ? inr(e.amount) : "—"}
                      </div>
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {MODES[e.mode] ?? e.mode}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {view === "history" && <div>{renderTable(false)}</div>}

      <ReasonDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete this expense?"
        description={
          del
            ? `${del.what} will be removed permanently and the deletion recorded in the audit trail with your reason.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}

/**
 * Fallback for a database where the expenses_list() RPC does not exist yet.
 * Kept deliberately plain: it returns the raw amount, because the masking that
 * expenses_list() performs is the reason the RPC exists, and silently dropping
 * it here would hide figures the role is allowed to see.
 */
async function expenseTableFallback() {
  const { data, error } = await supabase
    .from("expenses")
    .select(
      "id,kind,expense_date,category,description,amount,mode,reference,paid_to,notes,client_id,job_id,created_at,clients(name),jobs(job_code)",
    )
    .order("expense_date", { ascending: false });
  if (error) return { data: null, error };
  return {
    data: (data ?? []).map((e) => {
      const row = e as unknown as {
        id: string;
        clients: { name: string } | null;
        jobs: { job_code: string } | null;
      };
      const {
        clients: c,
        jobs: j,
        ...rest
      } = e as unknown as Record<string, unknown> & {
        clients: unknown;
        jobs: unknown;
      };
      return {
        ...rest,
        client_name: (c as { name: string } | null)?.name ?? null,
        job_code: (j as { job_code: string } | null)?.job_code ?? null,
        id: row.id,
      } as ExpenseRow;
    }),
    error: null,
  };
}
