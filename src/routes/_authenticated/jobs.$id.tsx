/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Receipt,
  Trash2,
  Check,
  RefreshCw,
  MoreVertical,
  Pencil,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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
import { clearingLabel, isWorkflow, type JobWorkflow } from "@/lib/job-workflow";

function stripSystemNotes(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes
    .replace(/\[Company:\s*[^\]]+\]/gi, "")
    .replace(/\[Batch:\s*[^\]]+\]/gi, "")
    .trim();
}

export const Route = createFileRoute("/_authenticated/jobs/$id")({
  head: () => ({
    meta: [
      { title: "Job — AJ's Chartered Desk" },
      { name: "description", content: "Job details and status history." },
    ],
  }),
  component: JobDetail,
});

function JobDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    if (id === "new") navigate({ to: "/jobs" });
  }, [id, navigate]);
  const { isFinance } = useRoles();
  const { canEdit, canUpdate, canDelete, canSeeAmounts } = usePermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
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
    enabled: id !== "new",
  });
  // The single source of truth for workflow position. Everything below renders
  // from this rather than recomputing stage rules in the browser.
  const wf = useQuery<JobWorkflow>({
    queryKey: ["job-workflow", id],
    queryFn: async (): Promise<JobWorkflow> => {
      const { data, error } = await supabase.rpc("job_workflow", { _job_id: id });
      if (error) throw error;
      if (!isWorkflow(data)) throw new Error("Unexpected workflow response");
      return data;
    },
    enabled: id !== "new",
  });

  const payQ = useQuery({
    queryKey: ["job-payments", id],
    queryFn: async () => {
      // Payments may be linked directly to the job (advance on creation) or
      // allocated later through an invoice for this job (clearing). Resolve both.
      const { data: direct } = await supabase
        .from("payments")
        .select("id,payment_code,amount,payment_date,status,mode")
        .eq("job_id", id)
        .order("payment_date", { ascending: false });

      const { data: items } = await supabase
        .from("invoice_items")
        .select("invoice_id")
        .eq("job_id", id);
      const invoiceIds = (items ?? []).map((x: { invoice_id: string }) => x.invoice_id);
      let allocated: {
        id: string;
        payment_code: string;
        amount: number;
        payment_date: string;
        status: string;
        mode: string;
      }[] = [];
      if (invoiceIds.length > 0) {
        const { data: allocs } = await supabase
          .from("payment_allocations")
          .select("payment_id")
          .in("invoice_id", invoiceIds);
        const paymentIds = [
          ...new Set((allocs ?? []).map((a: { payment_id: string }) => a.payment_id)),
        ];
        if (paymentIds.length > 0) {
          const { data: pays } = await supabase
            .from("payments")
            .select("id,payment_code,amount,payment_date,status,mode")
            .in("id", paymentIds)
            .order("payment_date", { ascending: false });
          allocated = (pays ?? []) as typeof allocated;
        }
      }

      const merged = [...(direct ?? []), ...allocated];
      const seen = new Set<string>();
      return merged.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
    },
    enabled: id !== "new",
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
  const job = q.data?.job;

  useEffect(() => {
    if (job) {
      setStatus(job.status);
      setEdit({
        firm_id: job.firm_id ?? "",
        due_date: job.due_date ?? "",
        assigned_staff: job.assigned_staff ?? "",
        notes: stripSystemNotes(job.notes),
        fee: String(job.fee),
        discount: String(job.discount),
      });
    }
  }, [job]);

  if (id === "new") return null;
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

  const markJobDone = async (completed: boolean) => {
    if (!canEdit("jobs")) return toast.error("You cannot change job status");
    const newStatus = completed ? "completed" : "in_progress";
    const { error } = await supabase.rpc("update_job_status", {
      _job_id: id,
      _status: newStatus,
      _reason: completed ? "Marked as completed" : "Reopened job to In Progress",
    });
    if (error) return toast.error(errMsg(error));

    toast.success(
      completed
        ? "Job marked as Completed! Added to receivables awaiting payment clearing."
        : "Job reopened to In Progress",
    );
    qc.invalidateQueries({ queryKey: ["job", id] });
    qc.invalidateQueries({ queryKey: ["jobs-list"] });
    qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] });
    qc.invalidateQueries({ queryKey: ["receivables"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
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

    const existingCompany = job.notes?.match(/\[Company:\s*[^\]]+\]/)?.[0];
    const existingBatch = job.notes?.match(/\[Batch:\s*[^\]]+\]/)?.[0];
    const cleanUserNotes = edit.notes.trim();
    const parts = [existingCompany, existingBatch, cleanUserNotes].filter(Boolean);
    const finalNotes = parts.length > 0 ? parts.join("\n") : null;

    const { error } = await supabase
      .from("jobs")
      .update({
        due_date: edit.due_date || null,
        assigned_staff: edit.assigned_staff || null,
        notes: finalNotes,
        fee,
        discount: disc,
        ...(edit.firm_id ? { firm_id: edit.firm_id } : {}),
      })
      .eq("id", id);
    if (error) return toast.error(errMsg(error));
    toast.success("Job saved");
    setIsEditing(false);
    qc.invalidateQueries();
  };

  const invsMap = new Map<
    string,
    {
      id: string;
      invoice_no: string;
      status: string;
      total: number;
      amount_paid: number;
      outstanding: number;
      invoice_date: string;
    }
  >();
  if (Array.isArray(job.invoice_items)) {
    for (const item of job.invoice_items as any[]) {
      if (item?.invoices?.id) {
        invsMap.set(item.invoices.id, item.invoices);
      }
    }
  }
  const connectedInvoices = Array.from(invsMap.values());
  const hasInvoices = connectedInvoices.length > 0;
  const inv = connectedInvoices[0] ?? null;

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
                {hasInvoices ? (
                  connectedInvoices.map((i) => (
                    <Link
                      key={i.id}
                      to="/invoices/$id"
                      params={{ id: i.id }}
                      className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/70 hover:bg-muted border border-border/60 transition-colors whitespace-nowrap"
                      title={`Click to view linked invoice ${i.invoice_no}`}
                    >
                      <StatusBadge
                        status={job.financial_status === "closed" ? "paid" : i.status || "invoiced"}
                      />
                      <span className="font-mono text-[11px] text-primary underline underline-offset-2 whitespace-nowrap">
                        {i.invoice_no}
                      </span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                    </Link>
                  ))
                ) : (
                  <StatusBadge status={job.financial_status} />
                )}
                {/* Prominent Mark as Done / Reopen Button + Edit Job + Safe Dropdown for Delete */}
                <div className="ml-auto flex items-center gap-2">
                  {canEdit("jobs") && (
                    <Button
                      size="sm"
                      variant={isEditing ? "secondary" : "outline"}
                      className="h-8 text-xs font-medium gap-1.5"
                      onClick={() => setIsEditing((v) => !v)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {isEditing ? "Close Editor" : "Edit Job"}
                    </Button>
                  )}

                  {canEdit("jobs") &&
                    (job.status !== "completed" ? (
                      <Button
                        size="sm"
                        className="h-8 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm"
                        onClick={() => markJobDone(true)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Mark as Done
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground gap-1.5"
                        onClick={() => markJobDone(false)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reopen Job
                      </Button>
                    ))}

                  {canDelete("jobs") && !inv && job.financial_status !== "closed" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="More options"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive cursor-pointer gap-2"
                          onClick={() => setDeleteOpen(true)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete Job</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <h1
                  className={cn(
                    "text-2xl font-semibold transition-all",
                    job.status === "completed"
                      ? "line-through text-muted-foreground/75"
                      : "text-foreground",
                  )}
                >
                  {job.title}
                </h1>
                {job.status === "completed" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    Completed
                  </span>
                )}
              </div>
              <Link
                to="/clients/$id"
                params={{ id: job.client_id }}
                className="text-sm text-primary hover:underline"
              >
                {job.clients?.name}
              </Link>

              {hasInvoices && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {connectedInvoices.length > 1
                      ? `Linked Invoices (${connectedInvoices.length})`
                      : "Linked Invoice"}
                  </div>
                  {connectedInvoices.map((i) => (
                    <div
                      key={i.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">
                            {i.invoice_no}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            · Date: {fmtDate(i.invoice_date)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            · Total:{" "}
                            <span className="font-medium text-foreground">{inr(i.total)}</span>
                          </span>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/invoices/$id" params={{ id: i.id }}>
                          Open Invoice
                          <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {isFinance && !hasInvoices && wf.data && (
                job.status === "completed" ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-foreground">
                        Awaiting payment clearing to generate invoice
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Invoices are strictly generated upon recording or clearing a payment against
                        this task.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          navigate({
                            to: "/clearing",
                            search: { client: job.client_id, job: id },
                          })
                        }
                        className="gap-1.5 shadow-xs"
                      >
                        <Receipt className="h-4 w-4" />
                        Record / Clear Payment
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/70 bg-muted/10 p-3">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-amber-500" />
                        Task In Progress — Mark as Done to Enable Payment Clearing
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Payment clearing and invoice generation are strictly unlocked once the task is marked as Done. You can record advance deposits anytime.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate({
                            to: "/payments",
                            search: { client: job.client_id, job: id },
                          })
                        }
                        className="gap-1.5 shadow-xs text-xs cursor-pointer"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        Record Advance Payment
                      </Button>
                    </div>
                  </div>
                )
              )}

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Service</div>
                  {job.services?.name}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Billing Firm / Company</div>
                  <span className="font-medium text-foreground">
                    {job.notes?.match(/\[Company:\s*([^\]]+)\]/)?.[1] ??
                      userFirms?.find((f) => f.id === job.firm_id)?.name ??
                      "Practice Firm"}
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
                {canSeeAmounts("jobs") &&
                  (() => {
                    const advancePaid = (payQ.data ?? []).reduce(
                      (acc, p) => acc + Number(p.amount || 0),
                      0,
                    );
                    const netAmount = Number(job.net_amount ?? job.fee ?? 0);
                    const balanceDue = Math.max(0, netAmount - advancePaid);
                    return (
                      <>
                        <div>
                          <div className="text-xs text-muted-foreground">Gross Fee</div>
                          <span className="font-mono">{inr(job.fee)}</span>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            Discount / Deductions (TDS)
                          </div>
                          <span className="font-mono text-amber-600 dark:text-amber-400">
                            {Number(job.discount) > 0 ? `− ${inr(job.discount)}` : inr(0)}
                          </span>
                        </div>
                        {wf.data && Number(wf.data.tds_tcs) > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground">TDS / TCS Withheld</div>
                            <span className="font-mono text-amber-600 dark:text-amber-400">
                              − {inr(wf.data.tds_tcs)}
                            </span>
                          </div>
                        )}
                        {wf.data && Number(wf.data.other_deduction) > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground">Other Deductions</div>
                            <span className="font-mono text-amber-600 dark:text-amber-400">
                              − {inr(wf.data.other_deduction)}
                            </span>
                          </div>
                        )}
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
                              ) : advancePaid > netAmount ? (
                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  Surplus / Credit ({inr(advancePaid - netAmount)})
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
                {stripSystemNotes(job.notes) && (
                  <div className="sm:col-span-4 mt-1 rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground border border-border/40">
                    <span className="font-semibold text-foreground mr-1.5">Notes:</span>
                    {stripSystemNotes(job.notes)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          {canEdit("jobs") && isEditing && (
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
              <CardTitle className="text-sm">Related Records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Job</span>
                <span className="font-mono">{job.job_code}</span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-muted-foreground">Payments</span>
                <div className="text-right text-xs space-y-1.5">
                  {payQ.data && payQ.data.length > 0 && (
                    <div className="space-y-1">
                      {payQ.data.map((p) => (
                        <div key={p.id} className="space-y-0.5">
                          {isFinance ? (
                            <Link
                              to="/clearing"
                              search={{ client: job.client_id, payment: p.id, job: id }}
                              className="font-mono text-primary font-semibold underline underline-offset-2 hover:opacity-80"
                            >
                              {p.payment_code}
                            </Link>
                          ) : (
                            <span className="font-mono font-semibold text-foreground">
                              {p.payment_code}
                            </span>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            {inr(p.amount)} ·{" "}
                            {p.status === "allocated" ? "Cleared" : label(p.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {isFinance && job.financial_status !== "closed" && (
                    <Link
                      to="/clearing"
                      search={{ client: job.client_id, job: id }}
                      className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      <span>Clear Balance</span>
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground">
                  Invoice{connectedInvoices.length > 1 ? "s" : ""}
                </span>
                {hasInvoices ? (
                  <div className="flex flex-col items-end gap-1">
                    {connectedInvoices.map((i) => (
                      <Link
                        key={i.id}
                        to="/invoices/$id"
                        params={{ id: i.id }}
                        className="font-mono text-primary underline underline-offset-2 text-xs"
                      >
                        {i.invoice_no}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">Not Yet Created</span>
                )}
              </div>
              {wf.data && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Clearing</span>
                    <span>{clearingLabel(wf.data.clearing_status)}</span>
                  </div>
                  {Number(wf.data.tds_tcs) > 0 && (
                    <div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400">
                      <span>TDS / TCS</span>
                      <span className="font-mono">− {inr(wf.data.tds_tcs)}</span>
                    </div>
                  )}
                  {Number(wf.data.job_discount || wf.data.clearing_discount) > 0 && (
                    <div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400">
                      <span>Discount / Deductions</span>
                      <span className="font-mono">
                        −{" "}
                        {inr(
                          Math.max(
                            Number(wf.data.job_discount || 0),
                            Number(wf.data.clearing_discount || 0),
                          ),
                        )}
                      </span>
                    </div>
                  )}
                  {Number(wf.data.other_deduction) > 0 && (
                    <div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400">
                      <span>Other Deductions</span>
                      <span className="font-mono">− {inr(wf.data.other_deduction)}</span>
                    </div>
                  )}
                  {(() => {
                    const effectiveDiscount = Math.max(
                      Number(wf.data.job_discount || 0),
                      Number(wf.data.clearing_discount || 0),
                    );
                    const effectiveFinal = Math.max(
                      0,
                      Number(job.fee || 0) -
                        effectiveDiscount -
                        Number(wf.data.tds_tcs || 0) -
                        Number(wf.data.other_deduction || 0) -
                        Number(wf.data.advance || 0),
                    );
                    if (effectiveFinal <= 0) return null;
                    return (
                      <div className="flex items-center justify-between font-medium">
                        <span className="text-muted-foreground">Final amount</span>
                        <span className="font-mono">{inr(effectiveFinal)}</span>
                      </div>
                    );
                  })()}
                  {wf.data.overdue && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Payment overdue
                    </div>
                  )}
                </>
              )}
              {isFinance && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() =>
                    navigate({
                      to: "/clearing",
                      search: { client: job.client_id, job: id },
                    })
                  }
                >
                  Payment clearing
                </Button>
              )}
            </CardContent>
          </Card>

          {canUpdate("jobs") && (
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
