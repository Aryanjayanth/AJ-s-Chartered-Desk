import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, CheckCircle2, ArrowRight, Download, Check, Clock, PauseCircle, XCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/app/DataTable";
import { ClientSelect, NativeSelect, PageHeader, ChecklistFilter, ConfirmDeleteDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useProfiles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { JobForm } from "@/components/app/JobForm";
import { readList } from "@/lib/supabase-read";
import { downloadCsv, errMsg, fmtDate, inr, JOB_STATUSES, jobDisplayStatus, label } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/jobs/")({
  head: () => ({
    meta: [
      { title: "Jobs — CA PracticeDesk" },
      { name: "description", content: "Job work management." },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canCreate, canEdit, canDelete, canSeeAmounts } = usePermissions();
  const { data: profiles } = useProfiles();
  const [open, setOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [jobToDelete, setJobToDelete] = useState<{ id: string; job_code: string } | null>(null);
  const [fl, setFl] = useState({
    client: "",
    service: "",
    staff: "",
    from: "",
    to: "",
  });

  const handleDeleteJob = async (jobId: string, jobCode: string) => {
    const { error } = await supabase.from("jobs").delete().eq("id", jobId);
    if (error) {
      if (error.message.includes("violates foreign key") || (error as any).code === "23503") {
        toast.error(`Cannot delete job ${jobCode} because it has financial history (invoices or payments).`);
      } else {
        toast.error(errMsg(error));
      }
    } else {
      toast.success(`Job ${jobCode} deleted successfully`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    }
  };

  const handleBulkStatus = async (
    selectedJobs: any[],
    newStatus: string,
    clearSelection: () => void,
  ) => {
    if (!canEdit("jobs")) {
      toast.error("You are not authorised to update job status");
      return;
    }
    const toastId = toast.loading(`Updating ${selectedJobs.length} jobs to ${label(newStatus)}…`);
    try {
      let count = 0;
      for (const j of selectedJobs) {
        const { error } = await supabase.rpc("update_job_status", {
          _job_id: j.id,
          _status: newStatus,
          _reason: `Status changed to ${newStatus} via bulk action`,
        });
        if (!error) count++;
      }
      toast.dismiss(toastId);
      toast.success(`Successfully updated ${count} job(s) to ${label(newStatus)}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    }
  };


  // Read through the RPC rather than the table
  const q = useQuery({
    queryKey: ["jobs"],
    queryFn: () =>
      readList("jobs_list", {}, async () => {
        const { data, error } = await supabase
          .from("jobs")
          .select(
            "id,job_code,client_id,service_id,client_service_id,title,period_start,period_end,fee,discount,net_amount,due_date,assigned_staff,status,financial_status,notes,auto_invoice,created_at,clients(name),services(name),profiles!jobs_assigned_staff_fkey(full_name),invoice_items(invoice_id,invoices(id,invoice_no,status))",
          )
          .order("created_at", { ascending: false });
        if (error) return { data: null, error };
        return {
          data: (data ?? []).map((j) => {
            const inv = (
              j.invoice_items as Array<{
                invoice_id: string;
                invoices: { id: string; invoice_no: string; status: string } | null;
              }> | null
            )?.[0]?.invoices;
            return {
              ...j,
              client_name: j.clients?.name ?? null,
              service_name: j.services?.name ?? null,
              assigned_staff_name: j.profiles?.full_name ?? null,
              invoice_id: inv?.id ?? null,
              invoice_no: inv?.invoice_no ?? null,
              invoice_status: inv?.status ?? null,
            };
          }),
          error: null,
        };
      }),
  });
  const all = q.data ?? [];
  const clients = [...new Map(all.map((j) => [j.client_id, j.client_name])).entries()];
  const services = [...new Map(all.map((j) => [j.service_id, j.service_name])).entries()];
  const rows = all.filter(
    (j) =>
      (selectedStatuses.length === 0 || selectedStatuses.includes(jobDisplayStatus(j))) &&
      (!fl.client || j.client_id === fl.client) &&
      (!fl.service || j.service_id === fl.service) &&
      (!fl.staff || j.assigned_staff === fl.staff) &&
      (!fl.from || (j.created_at ? j.created_at.slice(0, 10) >= fl.from : false)) &&
      (!fl.to || (j.created_at ? j.created_at.slice(0, 10) <= fl.to : false)),
  );
  const s = (k: keyof typeof fl) => (e: { target: { value: string } }) =>
    setFl((p) => ({ ...p, [k]: e.target.value }));

  if (open) {
    return <JobForm open={open} onOpenChange={setOpen} />;
  }

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="All compliance and engagement work"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/tasks">
                View Tasks &amp; Subtasks
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
            {canCreate("jobs") && (
              <Button onClick={() => setOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Create Job
              </Button>
            )}
          </div>
        }
      />
      <DataTable
        rows={rows}
        loading={q.isLoading}
        selectable
        bulkActions={(selectedJobs, clearSelection) => (
          <div className="flex items-center gap-2">
            {canEdit("jobs") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="default" className="h-8 text-xs font-medium">
                    Mark as…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => handleBulkStatus(selectedJobs, "completed", clearSelection)}
                    className="cursor-pointer gap-2"
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Completed</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleBulkStatus(selectedJobs, "in_progress", clearSelection)}
                    className="cursor-pointer gap-2"
                  >
                    <Clock className="h-3.5 w-3.5 text-blue-600" />
                    <span>In Progress</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleBulkStatus(selectedJobs, "on_hold", clearSelection)}
                    className="cursor-pointer gap-2"
                  >
                    <PauseCircle className="h-3.5 w-3.5 text-amber-600" />
                    <span>On Hold</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleBulkStatus(selectedJobs, "cancelled", clearSelection)}
                    className="cursor-pointer gap-2 text-destructive"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Cancelled</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 font-medium bg-background"
              onClick={() => {
                const dataToExport = selectedJobs.map((j) => ({
                  "Job Code": j.job_code,
                  "Title": j.title,
                  "Client": j.client_name ?? "",
                  "Service": j.service_name ?? "",
                  "Status": label(jobDisplayStatus(j)),
                  "Period Start": fmtDate(j.period_start),
                  "Period End": fmtDate(j.period_end),
                  "Created Date": fmtDate(j.created_at),
                  "Due Date": fmtDate(j.due_date),
                  "Fee": canSeeAmounts("jobs") && j.fee != null ? j.fee : "—",
                  "Net Amount": canSeeAmounts("jobs") && j.net_amount != null ? j.net_amount : "—",
                  "Assigned Staff": j.assigned_staff_name ?? "",
                  "Auto-Invoice": j.auto_invoice ? "Yes" : "No",
                }));
                const stamp = new Date().toISOString().slice(0, 10);
                downloadCsv(`jobs_selected_${stamp}.csv`, dataToExport);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export Selected ({selectedJobs.length})
            </Button>
          </div>
        )}
        onRowClick={(j) => navigate({ to: "/jobs/$id", params: { id: j.id } })}
        empty="No jobs match these filters."
        search={(j) => `${j.job_code} ${j.title} ${j.client_name ?? ""}`}
        exportFilename="jobs"
        exportTransform={(j) => ({
          "Job Code": j.job_code,
          "Title": j.title,
          "Client": j.client_name ?? "",
          "Service": j.service_name ?? "",
          "Status": label(jobDisplayStatus(j)),
          "Period Start": fmtDate(j.period_start),
          "Period End": fmtDate(j.period_end),
          "Created Date": fmtDate(j.created_at),
          "Due Date": fmtDate(j.due_date),
          "Fee": canSeeAmounts("jobs") && j.fee != null ? j.fee : "—",
          "Net Amount": canSeeAmounts("jobs") && j.net_amount != null ? j.net_amount : "—",
          "Assigned Staff": j.assigned_staff_name ?? "",
          "Auto-Invoice": j.auto_invoice ? "Yes" : "No",
        })}
        toolbar={
          <>
            <ChecklistFilter
              label="Status"
              options={[...JOB_STATUSES, "overdue"].map((x) => ({
                value: x,
                label: label(x),
              }))}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
              className="w-36"
            />
            <ClientSelect
              value={fl.client}
              onChange={(id) => setFl((p) => ({ ...p, client: id }))}
              placeholder="All clients"
              className="w-44"
              allowClear
            />
            <NativeSelect value={fl.service} onChange={s("service")} className="w-40">
              <option value="">All services</option>
              {services.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={fl.staff} onChange={s("staff")} className="w-36">
              <option value="">All staff</option>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </NativeSelect>
            <span className="text-xs text-muted-foreground">Date</span>
            <Input type="date" value={fl.from} onChange={s("from")} className="h-9 w-36" />
            <Input type="date" value={fl.to} onChange={s("to")} className="h-9 w-36" />
          </>
        }
        columns={[
          {
            key: "job_code",
            header: "Job Code",
            sort: (j) => j.job_code,
            render: (j) => (
              <span className="font-mono text-xs font-semibold text-primary">
                {j.job_code}
              </span>
            ),
          },
          {
            key: "title",
            header: "Title / Service",
            sort: (j) => j.title,
            render: (j) => <span className="font-medium text-foreground">{j.title}</span>,
          },
          {
            key: "c",
            header: "Client",
            sort: (j) => j.client_name ?? "",
            render: (j) => <span className="font-medium text-muted-foreground">{j.client_name}</span>,
          },
          {
            key: "created_at",
            header: "Created Date",
            sort: (j) => j.created_at ?? "",
            render: (j) => (
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                {fmtDate(j.created_at)}
              </span>
            ),
          },
          {
            key: "st",
            header: "Status",
            render: (j) => <StatusBadge status={jobDisplayStatus(j)} />,
          },
          {
            key: "fs",
            header: "Billing",
            render: (j) => {
              if (j.invoice_id && j.invoice_no) {
                return (
                  <Link
                    to="/invoices/$id"
                    params={{ id: j.invoice_id }}
                    className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/60 hover:bg-muted border border-border/50 transition-colors"
                    title={`Click to open Invoice ${j.invoice_no}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <StatusBadge
                      status={
                        j.financial_status === "closed" ? "paid" : j.invoice_status || "invoiced"
                      }
                    />
                    <span className="font-mono text-[11px] text-primary underline underline-offset-2 group-hover:text-primary/80">
                      {j.invoice_no}
                    </span>
                  </Link>
                );
              }
              return (
                <div className="inline-flex items-center gap-1.5">
                  <StatusBadge status={j.financial_status} />
                  {j.auto_invoice && (
                    <span
                      className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400"
                      title="Auto-invoicing enabled on job completion"
                    >
                      Auto
                    </span>
                  )}
                </div>
              );
            },
          },
          ...(canDelete("jobs")
            ? [
                {
                  key: "actions",
                  header: "",
                  className: "w-10 text-center",
                  render: (j: any) => {
                    const hasBilling = Boolean(j.invoice_id || j.financial_status === "closed");
                    return (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={hasBilling}
                        title={hasBilling ? "Cannot delete job with invoice/clearing" : "Delete job"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setJobToDelete({ id: j.id, job_code: j.job_code });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    );
                  },
                },
              ]
            : []),
        ]}
      />

      <ConfirmDeleteDialog
        open={Boolean(jobToDelete)}
        onOpenChange={(open) => !open && setJobToDelete(null)}
        title={`Delete Job ${jobToDelete?.job_code ?? ""}?`}
        description="Are you sure you want to delete this job? This action cannot be undone. Jobs with financial transactions cannot be deleted."
        onConfirm={async () => {
          if (jobToDelete) {
            await handleDeleteJob(jobToDelete.id, jobToDelete.job_code);
          }
        }}
      />
    </div>
  );
}
