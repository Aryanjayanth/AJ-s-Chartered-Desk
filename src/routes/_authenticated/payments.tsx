import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  Wallet,
  Users,
  Receipt,
  PlusCircle,
  History,
  ArrowRight,
  Clock,
  Download,
  RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/app/DataTable";
import {
  ClientSelect,
  DateRangePicker,
  Field,
  NativeSelect,
  PageHeader,
  ReasonDialog,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useClientLookup, useRoles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { recordPaymentEntry } from "@/lib/firms.functions";
import { readList } from "@/lib/supabase-read";
import { downloadCsv, errMsg, fmtDate, fmtDateTime, inr, MODES, today } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — AJ's Chartered Desk" },
      { name: "description", content: "Record client payments, advances, and collections." },
    ],
  }),
  component: PaymentsPage,
});

const emptyPayment = {
  job_id: "",
  amount: "",
  mode: "upi",
  payment_date: today(),
  reference: "",
  narration: "",
};

function PaymentsPage() {
  const navigate = useNavigate();
  const { user } = useRouteContext({ from: "/_authenticated" });
  const { isFinance } = useRoles();
  const { canCreate, canEdit, canSeeAmounts } = usePermissions();
  const qc = useQueryClient();
  const { data: clients } = useClientLookup();

  // Active view switcher: "entry" | "history"
  const [view, setView] = useState<"entry" | "history">("entry");

  // History filters state
  const [payFilters, setPayFilters] = useState({
    client: "",
    mode: "",
    status: "",
    dateBasis: "received",
    from: "",
    to: "",
  });

  // Payment Form state
  const [payClientId, setPayClientId] = useState("");
  const [payForm, setPayForm] = useState(emptyPayment);
  const [payBusy, setPayBusy] = useState(false);
  const [rev, setRev] = useState<string | null>(null);

  const { data: jobs } = useQuery({
    queryKey: ["job-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,job_code,title,client_id,status,due_date,fee,discount,net_amount,services(name)",
        )
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const payClientJobs = useMemo(() => {
    if (!payClientId) return [];
    return (jobs ?? []).filter((j) => j.client_id === payClientId);
  }, [jobs, payClientId]);

  // Payments Query
  const payQuery = useQuery({
    queryKey: ["payments"],
    queryFn: () =>
      readList("payments_list", {}, () =>
        supabase
          .from("payments")
          .select(
            "id,payment_code,client_id,job_id,amount,mode,payment_date,reference,narration,status,created_at",
          )
          .order("created_at", { ascending: false }),
      ),
  });

  const cname = (id: string | null) =>
    id ? (clients?.find((c) => c.id === id)?.name ?? "—") : "—";
  const jcode = (id: string | null) =>
    id ? (jobs?.find((j) => j.id === id)?.job_code ?? null) : null;

  // Financial calculations
  const totalInflow = useMemo(() => {
    const p = payQuery.data ?? [];
    return p
      .filter((r) => r.status !== "reversed" && r.amount != null)
      .reduce((sum, r) => sum + Number(r.amount), 0);
  }, [payQuery.data]);

  const activePayments = useMemo(() => {
    const p = payQuery.data ?? [];
    return p.filter((r) => r.status !== "reversed");
  }, [payQuery.data]);

  const uniqueClientsCount = useMemo(() => {
    const set = new Set(activePayments.map((p) => p.client_id).filter(Boolean));
    return set.size;
  }, [activePayments]);

  const handlePayClientChange = (id: string) => {
    setPayClientId(id);
    setPayForm((prev) => ({ ...prev, job_id: "" }));
  };

  const setP = (k: keyof typeof payForm) => (e: { target: { value: string } }) =>
    setPayForm((prev) => ({ ...prev, [k]: e.target.value }));

  // Save Payment
  const savePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate("payments")) return toast.error("You do not have permission to record payments");
    if (!payClientId) return toast.error("Please select a client");
    const amt = Number(payForm.amount);
    if (!(amt > 0)) return toast.error("Amount must be greater than zero");
    if (payForm.payment_date > today()) return toast.error("Payment date can't be in the future");

    setPayBusy(true);
    try {
      const res = await recordPaymentEntry({
        data: {
          clientId: payClientId,
          jobId: payForm.job_id || null,
          amount: amt,
          paymentDate: payForm.payment_date,
          mode: payForm.mode,
          narration: payForm.narration.trim() || undefined,
          isAdvance: true,
          autoAllocate: true,
        },
      });

      setPayBusy(false);
      if (payForm.job_id && res.allocatedToJob && res.allocatedToJob > 0) {
        if (res.remainingCredit && res.remainingCredit > 0) {
          toast.success(
            `Payment of ${inr(amt)} recorded: ${inr(res.allocatedToJob)} cleared against job, and remaining ${inr(res.remainingCredit)} is stored as client credit!`,
          );
        } else {
          toast.success(`Payment of ${inr(amt)} recorded and cleared against job!`);
        }
      } else {
        toast.success("Payment recorded successfully", {
          description: "Recorded as General Client Deposit Balance.",
          action: {
            label: "View History",
            onClick: () => setView("history"),
          },
        });
      }
      setPayForm(emptyPayment);
      setPayClientId("");
      qc.invalidateQueries();
    } catch (err) {
      setPayBusy(false);
      toast.error(errMsg(err));
    }
  };

  const reversePayment = async (reason: string) => {
    const { error } = await supabase.rpc("reverse_payment", { _payment_id: rev!, _reason: reason });
    if (error) {
      toast.error(errMsg(error));
      throw error;
    }
    toast.success("Payment reversed; allocations undone");
    qc.invalidateQueries();
  };

  const renderForm = (compact = false) => (
    <Card className="shadow-none">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold">Record a Payment</CardTitle>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-primary" />
            Entry time: {fmtDateTime(new Date().toISOString())}
          </div>
          {!compact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setView("history")}
            >
              View History ({activePayments.length})
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <form onSubmit={savePayment} className="space-y-3.5">
          <Field label="Client *">
            <ClientSelect
              value={payClientId}
              onChange={handlePayClientChange}
              placeholder="Search and select client…"
            />
          </Field>

          {payClientId && (
            <Field label="Link to Job (Optional)">
              <NativeSelect
                value={payForm.job_id}
                onChange={(e) => {
                  const selJobId = e.target.value;
                  const selJob = payClientJobs.find((j) => j.id === selJobId);
                  setPayForm((prev) => ({
                    ...prev,
                    job_id: selJobId,
                    amount: prev.amount
                      ? prev.amount
                      : selJob
                        ? String(selJob.net_amount || selJob.fee || "")
                        : "",
                    narration: prev.narration
                      ? prev.narration
                      : selJob
                        ? `Advance payment for job ${selJob.job_code}`
                        : "",
                  }));
                }}
              >
                <option value="">General Client Deposit / Balance (No specific job)</option>
                {payClientJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_code} — {j.title} (Fee: {inr(j.net_amount || j.fee || 0)})
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Automatically clears against this job up to its required fee. Any excess amount
                stays in client credit balance for future clearing.
              </p>
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Amount (₹) *">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={payForm.amount}
                onChange={setP("amount")}
                placeholder="0.00"
                className="font-mono text-base font-semibold"
              />
            </Field>

            <Field label="Date Received *">
              <Input
                type="date"
                max={today()}
                value={payForm.payment_date}
                onChange={setP("payment_date")}
              />
            </Field>

            <Field label="Payment Mode">
              <NativeSelect value={payForm.mode} onChange={setP("mode")}>
                {Object.entries(MODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <Field label="Narration / Remarks (Optional)">
            <Input
              value={payForm.narration}
              onChange={setP("narration")}
              placeholder="e.g. Advance payment / Bank deposit / Received in full"
            />
          </Field>

          <Button className="w-full font-medium" disabled={payBusy}>
            {payBusy ? "Saving…" : "Save Payment Receipt"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );

  const renderTable = (compact = false) => {
    const filteredPayments = (payQuery.data ?? []).filter((p) => {
      if (payFilters.client && p.client_id !== payFilters.client) return false;
      if (payFilters.mode && p.mode !== payFilters.mode) return false;
      if (payFilters.status && p.status !== payFilters.status) return false;
      const basisDate =
        payFilters.dateBasis === "entered"
          ? p.created_at
            ? p.created_at.slice(0, 10)
            : null
          : p.payment_date;
      if (payFilters.from && (!basisDate || basisDate < payFilters.from)) return false;
      if (payFilters.to && (!basisDate || basisDate > payFilters.to)) return false;
      return true;
    });

    return (
      <div>
        {!compact && canCreate("payments") && (
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Total active receipts:{" "}
              <strong className="text-foreground">{activePayments.length}</strong>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 font-medium cursor-pointer"
                onClick={() => {
                  const dataToExport = filteredPayments.map((p) => ({
                    "Receipt Code": p.payment_code,
                    Client: cname(p.client_id),
                    Job: jcode(p.job_id) ?? "Client Balance",
                    "Received Date": fmtDate(p.payment_date),
                    "Entered Date": fmtDate(p.created_at),
                    Mode: MODES[p.mode] ?? p.mode,
                    Amount: canSeeAmounts("payments") && p.amount != null ? p.amount : "-",
                    Status: p.status,
                    Notes: p.narration ?? "",
                  }));
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCsv(`payments_${stamp}.csv`, dataToExport);
                }}
                disabled={!filteredPayments.length}
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
              <Button
                size="sm"
                onClick={() => setView("entry")}
                className="h-8 text-xs gap-1.5 font-medium cursor-pointer"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Record a Payment
              </Button>
            </div>
          </div>
        )}
        <DataTable
          rows={filteredPayments}
          loading={payQuery.isLoading}
          onRowClick={
            isFinance
              ? (p) => {
                  navigate({
                    to: "/clearing",
                    search: {
                      client: p.client_id,
                      payment: p.id,
                      job: p.job_id || undefined,
                    },
                  });
                }
              : undefined
          }
          empty="No payments match these filters."
          search={(p) =>
            `${p.payment_code} ${cname(p.client_id)} ${jcode(p.job_id) ?? "Client Balance"}`
          }
          exportTransform={(p) => ({
            "Receipt Code": p.payment_code,
            Client: cname(p.client_id),
            Job: jcode(p.job_id) ?? "Client Balance",
            "Received Date": fmtDate(p.payment_date),
            "Entered Date": fmtDate(p.created_at),
            Mode: MODES[p.mode] ?? p.mode,
            Amount: canSeeAmounts("payments") && p.amount != null ? p.amount : "—",
            Status: p.status,
            Notes: p.narration ?? "",
          })}
          toolbar={
            <>
              <NativeSelect
                value={payFilters.mode}
                onChange={(e) => setPayFilters((p) => ({ ...p, mode: e.target.value }))}
                className="w-32"
              >
                <option value="">All modes</option>
                {Object.entries(MODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                value={payFilters.status}
                onChange={(e) => setPayFilters((p) => ({ ...p, status: e.target.value }))}
                className="w-32"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="reversed">Reversed</option>
              </NativeSelect>
              <NativeSelect
                value={payFilters.dateBasis}
                onChange={(e) => setPayFilters((p) => ({ ...p, dateBasis: e.target.value }))}
                className="w-40"
              >
                <option value="received">By Received date</option>
                <option value="entered">By Entered date</option>
              </NativeSelect>
              <DateRangePicker
                from={payFilters.from}
                to={payFilters.to}
                onFromChange={(val) => setPayFilters((p) => ({ ...p, from: val }))}
                onToChange={(val) => setPayFilters((p) => ({ ...p, to: val }))}
                label="Date"
              />
              {(payFilters.mode || payFilters.status || payFilters.from || payFilters.to) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setPayFilters((p) => ({
                      ...p,
                      mode: "",
                      status: "",
                      from: "",
                      to: "",
                    }))
                  }
                  className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                  title="Reset all filters"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
            </>
          }
          columns={[
            {
              key: "payment_code",
              header: "Receipt",
              sort: (p) => p.payment_code,
              className: "font-mono text-xs font-semibold text-primary",
            },
            {
              key: "c",
              header: "Client / Job",
              render: (p) => (
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-sm text-foreground">
                    {cname(p.client_id)}
                  </span>
                  {jcode(p.job_id) ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-primary">
                      <span className="text-[10px] px-1 py-0.2 bg-primary/10 rounded">Job</span>
                      {jcode(p.job_id)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Client Balance
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "d",
              header: "Received",
              sort: (p) => p.payment_date,
              render: (p) => fmtDate(p.payment_date),
            },
            {
              key: "entered",
              header: "Entered",
              sort: (p) => p.created_at ?? "",
              render: (p) => (
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {fmtDate(p.created_at)}
                </span>
              ),
            },
            {
              key: "mode",
              header: "Mode",
              render: (p) => (
                <span className="text-xs uppercase text-muted-foreground">
                  {MODES[p.mode] ?? p.mode}
                </span>
              ),
            },
            {
              key: "a",
              header: "Amount",
              align: "right",
              sort: (p) => Number(p.amount),
              render: (p) => (
                <span className="font-mono font-semibold text-foreground">
                  {canSeeAmounts("payments") && p.amount != null ? inr(p.amount) : "—"}
                </span>
              ),
            },
            {
              key: "s",
              header: "Status",
              render: (p) => <StatusBadge status={p.status} />,
            },
            ...(isFinance
              ? [
                  {
                    key: "clearing",
                    header: "Clearing",
                    render: (p: (typeof filteredPayments)[number]) =>
                      p.status !== "reversed" && (
                        <Button
                          size="sm"
                          variant={p.status === "allocated" ? "ghost" : "outline"}
                          className="h-7 text-xs px-2.5 font-medium"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate({
                              to: "/clearing",
                              search: {
                                client: p.client_id,
                                payment: p.id,
                                job: p.job_id || undefined,
                              },
                            });
                          }}
                        >
                          {p.status === "allocated" ? "View Clearing" : "Clear"}
                        </Button>
                      ),
                  },
                ]
              : []),
            ...(canEdit("payments")
              ? [
                  {
                    key: "x",
                    header: "",
                    render: (p: { id: string; status: string }) =>
                      p.status !== "reversed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRev(p.id);
                          }}
                        >
                          Reverse
                        </Button>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payment Entry"
        subtitle="Record client payments, advances, and collections with direct receipt tracking."
        actions={
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
              Record Payment
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
              Payment History {activePayments.length > 0 && `(${activePayments.length})`}
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/50">
            <ArrowDownLeft className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Total Collections</div>
            <div className="text-base font-bold text-foreground">
              {canSeeAmounts("payments") ? inr(totalInflow) : "—"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Active Receipts</div>
            <div className="text-base font-bold text-foreground">{activePayments.length}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-950/50">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Clients Collected From</div>
            <div className="text-base font-bold text-foreground">{uniqueClientsCount}</div>
          </div>
        </div>
      </div>

      {/* Switchable Views */}
      {view === "entry" && (
        <div className="max-w-2xl mx-auto space-y-4">
          {canCreate("payments") ? (
            renderForm(false)
          ) : (
            <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              You do not have permission to record payments.
            </div>
          )}

          {activePayments.length > 0 && (
            <Card className="shadow-none border border-border/60">
              <CardHeader className="py-2.5 px-4 border-b border-border/40">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Recent Payment Receipts</span>
                  <button
                    type="button"
                    onClick={() => setView("history")}
                    className="text-primary hover:underline font-medium cursor-pointer"
                  >
                    View All History ({activePayments.length}) →
                  </button>
                </div>
              </CardHeader>
              <div className="divide-y text-xs">
                {activePayments.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/30"
                  >
                    <div>
                      <div className="font-semibold text-foreground">{cname(p.client_id)}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {p.payment_code} · {fmtDate(p.payment_date)} · {MODES[p.mode] ?? p.mode}
                        {p.narration ? ` · ${p.narration}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-foreground">
                        {canSeeAmounts("payments") && p.amount != null ? inr(p.amount) : "—"}
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {view === "history" && <div>{renderTable(false)}</div>}

      {/* Reverse Payment Dialog */}
      <ReasonDialog
        open={!!rev}
        onOpenChange={(o) => !o && setRev(null)}
        title="Reverse payment?"
        description="The payment stays on record as Reversed. Any allocations are undone and invoice balances restored."
        confirmLabel="Reverse"
        destructive
        onConfirm={reversePayment}
      />
    </div>
  );
}
