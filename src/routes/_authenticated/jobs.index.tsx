/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Plus,
  CheckCircle2,
  ArrowRight,
  Download,
  Check,
  Clock,
  PauseCircle,
  XCircle,
  Trash2,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/app/DataTable";
import {
  ClientSelect,
  NativeSelect,
  PageHeader,
  ChecklistFilter,
  DateRangePicker,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useProfiles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentFirm } from "@/hooks/use-firm";
import { JobForm } from "@/components/app/JobForm";
import { readList } from "@/lib/supabase-read";
import { deleteJobs } from "@/lib/firms.functions";
import {
  downloadCsv,
  errMsg,
  fmtDate,
  inr,
  JOB_STATUSES,
  jobDisplayStatus,
  label,
} from "@/lib/format";
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
  const { data: currentFirm } = useCurrentFirm();
  const [open, setOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [jobsToDelete, setJobsToDelete] = useState<any[] | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [clearSelectionCallback, setClearSelectionCallback] = useState<(() => void) | null>(null);
  const [fl, setFl] = useState({
    client: "",
    service: "",
    staff: "",
    company: "",
    from: "",
    to: "",
  });

  const executeDeleteJobs = async (force: boolean) => {
    if (!jobsToDelete || jobsToDelete.length === 0) return;
    setIsDeleting(true);
    const count = jobsToDelete.length;
    const toastId = toast.loading(
      force
        ? `Force deleting ${count} job(s) and detaching linked records...`
        : `Deleting ${count} job(s)...`,
    );
    try {
      const ids = jobsToDelete.map((j) => j.id);
      const res = await deleteJobs({ data: { jobIds: ids, force } });
      toast.dismiss(toastId);
      if (res.deleted > 0) {
        toast.success(`Successfully deleted ${res.deleted} job(s)`);
      }
      if (res.failed > 0) {
        toast.error(
          `${res.failed} job(s) could not be deleted due to linked records. Use "Force Delete" to override.`,
        );
        // keep modal open and enable force delete toggle so user can proceed with 1-click
        setForceDelete(true);
        setIsDeleting(false);
        return;
      }
      clearSelectionCallback?.();
      setJobsToDelete(null);
      setForceDelete(false);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks-view"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    } finally {
      setIsDeleting(false);
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
            const companyMatch = j.notes?.match(/\[Company:\s*([^\]]+)\]/);
            const companyName = companyMatch ? companyMatch[1] : null;
            return {
              ...j,
              company_name: companyName,
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
  const uniqueCompanies = useMemo(() => {
    const list: string[] = [];
    if (currentFirm?.name) list.push(currentFirm.name);
    for (const j of all) {
      if (j.company_name && !list.includes(j.company_name)) {
        list.push(j.company_name);
      }
    }
    return list;
  }, [all, currentFirm?.name]);

  const rows = all.filter(
    (j) =>
      (selectedStatuses.length === 0 || selectedStatuses.includes(jobDisplayStatus(j))) &&
      (!fl.client || j.client_id === fl.client) &&
      (!fl.service || j.service_id === fl.service) &&
      (!fl.staff || j.assigned_staff === fl.staff) &&
      (!fl.company ||
        (fl.company === currentFirm?.name
          ? !j.company_name || j.company_name === currentFirm?.name
          : j.company_name === fl.company)) &&
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

            {canDelete("jobs") && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 cursor-pointer"
                onClick={() => {
                  setJobsToDelete(selectedJobs);
                  setClearSelectionCallback(() => clearSelection);
                  setForceDelete(false);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedJobs.length})
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 font-medium bg-background"
              onClick={() => {
                const dataToExport = selectedJobs.map((j) => ({
                  "Job Code": j.job_code,
                  Title: j.title,
                  Client: j.client_name ?? "",
                  Service: j.service_name ?? "",
                  Status: label(jobDisplayStatus(j)),
                  "Period Start": fmtDate(j.period_start),
                  "Period End": fmtDate(j.period_end),
                  "Created Date": fmtDate(j.created_at),
                  "Due Date": fmtDate(j.due_date),
                  Fee: canSeeAmounts("jobs") && j.fee != null ? j.fee : "—",
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
        search={(j) => `${j.job_code} ${j.title} ${j.client_name ?? ""} ${j.company_name ?? ""}`}
        exportFilename="jobs"
        exportTransform={(j) => ({
          "Job Code": j.job_code,
          Title: j.title,
          "Billing Company": j.company_name || currentFirm?.name || "Practice Firm",
          Client: j.client_name ?? "",
          Service: j.service_name ?? "",
          Status: label(jobDisplayStatus(j)),
          "Period Start": fmtDate(j.period_start),
          "Period End": fmtDate(j.period_end),
          "Created Date": fmtDate(j.created_at),
          "Due Date": fmtDate(j.due_date),
          Fee: canSeeAmounts("jobs") && j.fee != null ? j.fee : "—",
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
            {uniqueCompanies.length > 1 && (
              <NativeSelect value={fl.company} onChange={s("company")} className="w-36">
                <option value="">All companies</option>
                {uniqueCompanies.map((cName) => (
                  <option key={cName} value={cName}>
                    {cName}
                  </option>
                ))}
              </NativeSelect>
            )}
            <ClientSelect
              value={fl.client}
              onChange={(id) => setFl((p) => ({ ...p, client: id }))}
              placeholder="All clients"
              className="w-40"
              allowClear
            />
            <NativeSelect value={fl.service} onChange={s("service")} className="w-36">
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
            <DateRangePicker
              from={fl.from}
              to={fl.to}
              onFromChange={(val) => setFl((p) => ({ ...p, from: val }))}
              onToChange={(val) => setFl((p) => ({ ...p, to: val }))}
              label="Date"
            />
          </>
        }
        columns={[
          {
            key: "job_code",
            header: "Job Code",
            sort: (j) => j.job_code,
            render: (j) => (
              <span className="font-mono text-xs font-semibold text-primary">{j.job_code}</span>
            ),
          },
          {
            key: "title",
            header: "Title / Service",
            sort: (j) => j.title,
            render: (j) => (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{j.title}</span>
                {j.company_name && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary/90">
                    <Building2 className="h-3 w-3 shrink-0" />
                    {j.company_name}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: "c",
            header: "Client",
            sort: (j) => j.client_name ?? "",
            render: (j) => (
              <span className="font-medium text-muted-foreground">{j.client_name}</span>
            ),
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
        ]}
      />

      <Dialog
        open={Boolean(jobsToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setJobsToDelete(null);
            setForceDelete(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete {jobsToDelete?.length ?? 0} Selected Job(s)?
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Are you sure you want to delete the selected job(s)? This action cannot be undone.
            </p>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="max-h-36 overflow-y-auto rounded-md border bg-muted/40 p-2 space-y-1 text-xs">
              {jobsToDelete?.map((j) => (
                <div key={j.id} className="flex items-center justify-between py-0.5">
                  <span className="font-mono font-medium">{j.job_code}</span>
                  <span className="truncate max-w-[200px] text-muted-foreground">
                    {j.title || j.client_name}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="force-delete-jobs-modal"
                  checked={forceDelete}
                  onCheckedChange={(checked) => setForceDelete(Boolean(checked))}
                />
                <div className="grid gap-1 leading-tight">
                  <label
                    htmlFor="force-delete-jobs-modal"
                    className="text-xs font-semibold cursor-pointer text-amber-700 dark:text-amber-400"
                  >
                    Force delete if there are issues
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Automatically detaches linked records (audit history, draft clearings, expenses,
                    billing references) so the deletion succeeds cleanly.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setJobsToDelete(null);
                setForceDelete(false);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => executeDeleteJobs(forceDelete)}
              disabled={isDeleting}
            >
              {isDeleting
                ? "Deleting..."
                : forceDelete
                  ? `Force Delete (${jobsToDelete?.length})`
                  : `Delete (${jobsToDelete?.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
