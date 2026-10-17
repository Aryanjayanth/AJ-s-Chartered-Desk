import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ExternalLink,
  Receipt,
  CheckCircle2,
  ListChecks,
  Plus,
  Trash2,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect, ConfirmDeleteDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { useUserFirms } from "@/hooks/use-firm";
import {
  errMsg,
  fmtDate,
  fmtDateTime,
  inr,
  JOB_STATUSES,
  jobDisplayStatus,
  label,
} from "@/lib/format";
import { clearingLabel, isWorkflow, STAGES, type WorkflowStages } from "@/lib/job-workflow";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/jobs/$id")({
  head: () => ({
    meta: [
      { title: "Job — CA PracticeDesk" },
      { name: "description", content: "Job details and status history." },
    ],
  }),
  component: JobDetail,
});

function JobDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isFinance } = useRoles();
  const { canEdit, canDelete, canSeeAmounts } = usePermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { data: profiles } = useProfiles();
  const pname = (u: string | null) => profiles?.find((p) => p.id === u)?.full_name ?? "System";

  const handleDeleteJob = async () => {
    const jobCode = job?.job_code ?? "";
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) {
      if (error.message.includes("violates foreign key") || (error as any).code === "23503") {
        toast.error(`Cannot delete job ${jobCode} because it already has financial transactions.`);
      } else {
        toast.error(errMsg(error));
      }
    } else {
      toast.success(`Job ${jobCode} deleted successfully`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      navigate({ to: "/jobs" });
    }
  };
  const q = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const [j, h] = await Promise.all([
        supabase
          .from("jobs")
          .select(
            "*, clients(name), services(name), invoice_items(invoice_id, invoices(id, invoice_no, status, total, amount_paid, outstanding, invoice_date))",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("job_status_history")
          .select("*")
          .eq("job_id", id)
          .order("changed_at", { ascending: false }),
      ]);
      if (j.error) throw j.error;
      return { job: j.data, history: h.data ?? [] };
    },
  });
  // The single source of truth for workflow position. Everything below renders
  // from this rather than recomputing stage rules in the browser.
  const wf = useQuery({
    queryKey: ["job-workflow", id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("job_workflow", { _job_id: id });
      if (error) throw error;
      if (!isWorkflow(data)) throw new Error("Unexpected workflow response");
      return data;
    },
  });

  const payQ = useQuery({
    queryKey: ["job-payments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,payment_code,amount,payment_date,status,mode")
        .eq("job_id", id)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: userFirms } = useUserFirms();
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState({
    firm_id: "",
    due_date: "",
    assigned_staff: "",
    notes: "",
    fee: "",
    discount: "",
  });
  const [checklist, setChecklist] = useState<WorkflowStages | null>(null);
  const [newItemText, setNewItemText] = useState("");
  const [raising, setRaising] = useState(false);
  const job = q.data?.job;

  // checklist is a jsonb array of { label, done }. Normalise defensively since
  // it is user-editable data that predates any schema guarantee.
  const rawItems = useMemo(() => {
    const c = job?.checklist;
    return Array.isArray(c) ? (c as Json[]) : [];
  }, [job?.checklist]);
  const items = useMemo(
    () =>
      rawItems.map((it) => {
        const o = (it ?? {}) as {
          id?: unknown;
          label?: unknown;
          done?: unknown;
          fee?: unknown;
          service_id?: unknown;
        };
        return {
          id: typeof o.id === "string" ? o.id : undefined,
          label: typeof o.label === "string" ? o.label : "",
          done: o.done === true,
          fee: typeof o.fee === "number" ? o.fee : undefined,
          service_id: typeof o.service_id === "string" ? o.service_id : undefined,
        };
      }),
    [rawItems],
  );
  const toggleItem = async (idx: number) => {
    const next = items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it));
    setChecklist(
      next.reduce<WorkflowStages>(
        (acc, it) => ({ ...acc, [it.label]: it.done }),
        {} as WorkflowStages,
      ),
    );
    const { error } = await supabase.from("jobs").update({ checklist: next }).eq("id", id);
    if (error) {
      toast.error(errMsg(error));
      setChecklist(null);
    } else {
      const allDone = next.length > 0 && next.every((it) => it.done);
      const nextDone = next[idx].done;

      if (allDone && job?.status !== "completed") {
        await supabase.rpc("update_job_status", {
          _job_id: id,
          _status: "completed",
          _reason: "All checklist items completed",
        });
        toast.success("All checklist steps completed — Job marked Completed!");
      } else if (!nextDone && job?.status === "completed") {
        await supabase.rpc("update_job_status", {
          _job_id: id,
          _status: "in_progress",
          _reason: "Checklist step reopened",
        });
        toast.info("Checklist step reopened — Job returned to In Progress");
      } else if (job?.status === "pending" && nextDone) {
        await supabase.rpc("update_job_status", {
          _job_id: id,
          _status: "in_progress",
          _reason: "Checklist started",
        });
      }

      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] });
    }
  };

  const addItem = async () => {
    const text = newItemText.trim();
    if (!text) return;
    const next = [...items, { label: text, done: false }];
    const { error } = await supabase.from("jobs").update({ checklist: next }).eq("id", id);
    if (error) {
      toast.error(errMsg(error));
    } else {
      setNewItemText("");
      qc.invalidateQueries({ queryKey: ["job", id] });
    }
  };

  const deleteItem = async (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    const { error } = await supabase.from("jobs").update({ checklist: next }).eq("id", id);
    if (error) {
      toast.error(errMsg(error));
    } else {
      qc.invalidateQueries({ queryKey: ["job", id] });
    }
  };

  const loadStandardChecklist = async () => {
    const standardSteps = [
      { label: "Client Data & Documents Received", done: false },
      { label: "Data Verification & Draft Computation", done: false },
      { label: "Client Review & Approval", done: false },
      { label: "Challan / Tax Paid (if applicable)", done: false },
      { label: "Filed on Government Portal", done: false },
      { label: "Acknowledgement & Final Copy Shared", done: false },
    ];
    const { error } = await supabase.from("jobs").update({ checklist: standardSteps }).eq("id", id);
    if (error) {
      toast.error(errMsg(error));
    } else {
      toast.success("Standard compliance checklist loaded");
      qc.invalidateQueries({ queryKey: ["job", id] });
    }
  };

  const markJobCompletedFromChecklist = async () => {
    if (!canEdit("jobs")) return toast.error("Not authorised");
    const { error } = await supabase.rpc("update_job_status", {
      _job_id: id,
      _status: "completed",
      _reason: "Checklist completed",
    });
    if (error) return toast.error(errMsg(error));
    toast.success("Job marked as Completed! Ready for clearing.");
    qc.invalidateQueries();
  };

  useEffect(() => {
    if (job) {
      setStatus(job.status);
      setEdit({
        firm_id: job.firm_id ?? "",
        due_date: job.due_date ?? "",
        assigned_staff: job.assigned_staff ?? "",
        notes: job.notes ?? "",
        fee: String(job.fee),
        discount: String(job.discount),
      });
    }
  }, [job]);

  if (q.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!job)
    return (
      <div className="space-y-4">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Jobs</span>
        </Link>
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          Job not found or not accessible.
        </div>
      </div>
    );

  const updateStatus = async () => {
    if (status === job.status) return;
    if (!canEdit("jobs")) return toast.error("You cannot change job status");
    const { error } = await supabase.rpc("update_job_status", {
      _job_id: id,
      _status: status,
      _reason: reason,
    });
    if (error) return toast.error(errMsg(error));
    toast.success("Status updated");
    setReason("");
    qc.invalidateQueries();
  };

  const raiseInvoiceNow = async () => {
    setRaising(true);
    const linkedPaymentId = payQ.data?.[0]?.id || null;
    const { data: invId, error } = await supabase.rpc("create_invoice_for_job", {
      _job_id: id,
      _payment_id: linkedPaymentId,
      _invoice_date: new Date().toISOString().slice(0, 10),
      _due_date: job.due_date ?? new Date().toISOString().slice(0, 10),
      _tax_rate: 0,
      _notes: "",
      _extra_desc: "",
      _extra_amount: 0,
    });
    setRaising(false);
    if (error) return toast.error(errMsg(error));
    toast.success("Invoice generated successfully!", {
      action: invId
        ? {
            label: "Open Invoice",
            onClick: () => navigate({ to: "/invoices/$id", params: { id: invId } }),
          }
        : undefined,
    });
    qc.invalidateQueries();
  };

  const saveEdit = async () => {
    if (!canEdit("jobs")) return toast.error("You cannot edit jobs");
    const fee = Number(edit.fee),
      disc = Number(edit.discount);
    if (
      job.financial_status !== "open" &&
      (fee !== Number(job.fee) || disc !== Number(job.discount))
    )
      return toast.error("Fee can't change after invoicing — adjust via the invoice");
    if (disc > fee || disc < 0) return toast.error("Discount must be between 0 and fee");
    const { error } = await supabase
      .from("jobs")
      .update({
        due_date: edit.due_date || null,
        assigned_staff: edit.assigned_staff || null,
        notes: edit.notes || null,
        fee,
        discount: disc,
        ...(edit.firm_id ? { firm_id: edit.firm_id } : {}),
      })
      .eq("id", id);
    if (error) return toast.error(errMsg(error));
    toast.success("Job saved");
    qc.invalidateQueries();
  };

  const inv = (
    job.invoice_items as Array<{
      invoice_id: string;
      invoices: {
        id: string;
        invoice_no: string;
        status: string;
        total: number;
        amount_paid: number;
        outstanding: number;
        invoice_date: string;
      } | null;
    }> | null
  )?.[0]?.invoices;

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Jobs</span>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="shadow-none">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{job.job_code}</span>
                <StatusBadge status={jobDisplayStatus(job)} />
                {inv ? (
                  <Link
                    to="/invoices/$id"
                    params={{ id: inv.id }}
                    className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/70 hover:bg-muted border border-border/60 transition-colors"
                    title="Click to view linked invoice"
                  >
                    <StatusBadge
                      status={job.financial_status === "closed" ? "paid" : inv.status || "invoiced"}
                    />
                    <span className="font-mono text-[11px] text-primary underline underline-offset-2">
                      {inv.invoice_no}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                  </Link>
                ) : (
                  <StatusBadge status={job.financial_status} />
                )}
                {canDelete("jobs") && !inv && job.financial_status !== "closed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto text-destructive hover:bg-destructive hover:text-destructive-foreground h-7 text-xs"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete Job
                  </Button>
                )}
              </div>
              <h1 className="mt-1 text-2xl font-semibold">{job.title}</h1>
              <Link
                to="/clients/$id"
                params={{ id: job.client_id }}
                className="text-sm text-primary hover:underline"
              >
                {job.clients?.name}
              </Link>

              {inv && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Linked Invoice
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {inv.invoice_no}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · Date: {fmtDate(inv.invoice_date)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · Total:{" "}
                        <span className="font-medium text-foreground">{inr(inv.total)}</span>
                      </span>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/invoices/$id" params={{ id: inv.id }}>
                      Open Invoice
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              )}

              {!inv && wf.data && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {wf.data.invoice_available
                        ? "Payment is squared off. This job is ready to invoice."
                        : (wf.data.blocked_reason ?? "This job is not ready to invoice yet.")}
                    </div>
                  </div>
                  {wf.data.invoice_available && isFinance ? (
                    <Button size="sm" onClick={raiseInvoiceNow} disabled={raising}>
                      <Receipt className="mr-1.5 h-4 w-4" />
                      {raising ? "Raising..." : "Create Invoice"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate({
                          to: "/clearing",
                          search: { job: id },
                        })
                      }
                    >
                      Go to payment clearing
                    </Button>
                  )}
                </div>
              )}

              {wf.data && (
                <div className="mt-4 rounded-lg border border-border/60 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Workflow
                  </div>
                  <ol className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
                    {STAGES.map((s, i) => {
                      const done = wf.data!.stages[s.key];
                      const stamp = s.stamp?.(wf.data!);
                      return (
                        <li
                          key={s.key}
                          className={`rounded-md border px-2 py-1.5 text-[11px] ${
                            done
                              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                              : "bg-muted/40 text-muted-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-1 font-medium">
                            <span
                              className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] ${
                                done ? "bg-emerald-600 text-white" : "bg-muted-foreground/30"
                              }`}
                            >
                              {done ? "✓" : i + 1}
                            </span>
                            {s.label}
                          </div>
                          {stamp && <div className="mt-0.5 opacity-70">{fmtDate(stamp)}</div>}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Service</div>
                  {job.services?.name}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Billing Firm / Company</div>
                  <span className="font-medium text-foreground">
                    {job.notes?.match(/\[Company:\s*([^\]]+)\]/)?.[1] ?? userFirms?.find((f) => f.id === job.firm_id)?.name ?? "Practice Firm"}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Period</div>
                  {fmtDate(job.period_start)} → {fmtDate(job.period_end)}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Due</div>
                  {fmtDate(job.due_date)}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Created</div>
                  {fmtDate(job.created_at)}
                </div>
                {canSeeAmounts("jobs") && (() => {
                  const advancePaid = (payQ.data ?? []).reduce((acc, p) => acc + Number(p.amount || 0), 0);
                  const netAmount = Number(job.net_amount ?? job.fee ?? 0);
                  const balanceDue = Math.max(0, netAmount - advancePaid);
                  return (
                    <>
                      <div>
                        <div className="text-xs text-muted-foreground">Gross Fee</div>
                        <span className="font-mono">{inr(job.fee)}</span>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Discount / Deductions</div>
                        <span className="font-mono text-amber-600 dark:text-amber-400">
                          {Number(job.discount) > 0 ? `− ${inr(job.discount)}` : inr(0)}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Net Billable</div>
                        <span className="font-mono font-semibold">{inr(job.net_amount)}</span>
                      </div>
                      {advancePaid > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground">Advance Received</div>
                          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {inr(advancePaid)}
                          </span>
                        </div>
                      )}
                      {advancePaid > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground">Remaining Balance</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className={`font-mono font-bold ${balanceDue > 0 ? "text-primary" : "text-emerald-600 dark:text-emerald-400"}`}
                            >
                              {inr(balanceDue)}
                            </span>
                            {balanceDue > 0 ? (
                              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                Partial Payment
                              </span>
                            ) : (
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                Fully Covered
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
          {canEdit("jobs") && (
            <Card className="shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Edit Job</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field label="Fee (₹)">
                  <Input
                    type="number"
                    value={edit.fee}
                    disabled={job.financial_status !== "open"}
                    onChange={(e) => setEdit({ ...edit, fee: e.target.value })}
                  />
                </Field>
                <Field label="Discount (₹)">
                  <Input
                    type="number"
                    value={edit.discount}
                    disabled={job.financial_status !== "open"}
                    onChange={(e) => setEdit({ ...edit, discount: e.target.value })}
                  />
                </Field>
                <Field label="Due Date">
                  <Input
                    type="date"
                    value={edit.due_date}
                    onChange={(e) => setEdit({ ...edit, due_date: e.target.value })}
                  />
                </Field>
                <Field label="Assigned Staff">
                  <NativeSelect
                    value={edit.assigned_staff}
                    onChange={(e) => setEdit({ ...edit, assigned_staff: e.target.value })}
                  >
                    <option value="">—</option>
                    {profiles?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name ?? p.email}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {userFirms && userFirms.length > 0 && (
                  <Field label="Billing Firm / Entity (Invoice Header)">
                    <NativeSelect
                      value={edit.firm_id}
                      disabled={job.financial_status !== "open"}
                      onChange={(e) => setEdit({ ...edit, firm_id: e.target.value })}
                    >
                      {userFirms.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} {f.city ? `(${f.city})` : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea
                    rows={2}
                    value={edit.notes}
                    onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Button onClick={saveEdit}>Save changes</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-sm">
                  <ListChecks className="h-4 w-4 text-primary" />
                  <span>Job Checklist</span>
                </div>
                {items.length > 0 && (
                  <span className="text-xs font-mono font-medium text-muted-foreground">
                    {items.filter((i) => i.done).length}/{items.length}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Progress bar */}
              {items.length > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{
                      width: `${Math.round((items.filter((i) => i.done).length / items.length) * 100)}%`,
                    }}
                  />
                </div>
              )}

              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
                  <p className="text-xs text-muted-foreground">No checklist items yet.</p>
                  {canEdit("jobs") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={loadStandardChecklist}
                      className="text-xs h-8"
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
                      Load Compliance Steps
                    </Button>
                  )}
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map((it, i) => (
                    <li
                      key={`${it.label}-${i}`}
                      className="group flex items-center justify-between gap-2 rounded-md p-1.5 hover:bg-muted/40 transition-colors"
                    >
                      <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-xs select-none">
                        <input
                          type="checkbox"
                          checked={it.done}
                          onChange={() => toggleItem(i)}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                        <div className="flex flex-1 items-center justify-between gap-2 pr-1">
                          <span
                            className={
                              it.done
                                ? "line-through text-muted-foreground opacity-60 transition-all"
                                : "text-foreground font-medium transition-all"
                            }
                          >
                            {it.label}
                          </span>
                          {it.fee != null && it.fee > 0 && canSeeAmounts("jobs") && (
                            <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                              {inr(it.fee)}
                            </span>
                          )}
                        </div>
                      </label>
                      {canEdit("jobs") && (
                        <button
                          type="button"
                          onClick={() => deleteItem(i)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 transition-opacity"
                          title="Delete item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Add checklist item */}
              {canEdit("jobs") && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Input
                    placeholder="Add checklist step…"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addItem();
                      }
                    }}
                    className="h-8 text-xs bg-background"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={addItem}
                    disabled={!newItemText.trim()}
                    className="h-8 px-2.5 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {/* One-click Complete Job button when checklist is done */}
              {items.length > 0 &&
                items.every((it) => it.done) &&
                job.status !== "completed" &&
                canEdit("jobs") && (
                  <Button
                    size="sm"
                    onClick={markJobCompletedFromChecklist}
                    className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs h-8"
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Complete Job & Clear
                  </Button>
                )}
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Related Records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Job</span>
                <span className="font-mono">{job.job_code}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payment</span>
                {payQ.data?.length ? (
                  <Link
                    to="/payments"
                    className="font-mono text-primary underline underline-offset-2"
                  >
                    {payQ.data[0].payment_code}
                    {payQ.data.length > 1 ? ` +${payQ.data.length - 1} more` : ""}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not Created</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Invoice</span>
                {inv ? (
                  <Link
                    to="/invoices/$id"
                    params={{ id: inv.id }}
                    className="font-mono text-primary underline underline-offset-2"
                  >
                    {inv.invoice_no}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not Yet Created</span>
                )}
              </div>
              {wf.data && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Clearing</span>
                    <span>{clearingLabel(wf.data.clearing_status)}</span>
                  </div>
                  {Number(wf.data.final_amount) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Final amount</span>
                      <span className="font-mono">{inr(wf.data.final_amount)}</span>
                    </div>
                  )}
                  {wf.data.overdue && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Payment overdue
                    </div>
                  )}
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  navigate({
                    to: "/clearing",
                    search: { job: id },
                  })
                }
              >
                Payment clearing
              </Button>
            </CardContent>
          </Card>

          {canEdit("jobs") && (
            <Card className="shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Update Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                  {JOB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </NativeSelect>
                <Textarea
                  placeholder="Reason (optional)"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button className="w-full" disabled={status === job.status} onClick={updateStatus}>
                  Update
                </Button>
              </CardContent>
            </Card>
          )}
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Status History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative ml-2 border-l">
                {q.data!.history.map((h) => (
                  <li key={h.id} className="mb-4 ml-4">
                    <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-card bg-primary" />
                    <div className="text-sm">
                      {h.old_status ? <>{label(h.old_status)} → </> : null}
                      <span className="font-medium">{label(h.new_status)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pname(h.changed_by)} · {fmtDateTime(h.changed_at)}
                    </div>
                    {h.reason && (
                      <div className="text-xs italic text-muted-foreground">{h.reason}</div>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete Job ${job.job_code}?`}
        description="Are you sure you want to delete this job? This action cannot be undone. Jobs with financial transactions cannot be deleted."
        onConfirm={handleDeleteJob}
      />
    </div>
  );
}
