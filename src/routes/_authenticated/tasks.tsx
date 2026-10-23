/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Check,
  Clock,
  Download,
  Layers,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  XCircle,
  ArrowRight,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { usePermissions } from "@/hooks/use-permissions";
import { useProfiles } from "@/hooks/use-roles";
import { deleteJobs } from "@/lib/firms.functions";
import { downloadCsv, errMsg, fmtDate, inr, JOB_STATUSES, jobDisplayStatus, label } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Parent job summary, compliance workflow tracking, and billing status.",
      },
    ],
  }),
  component: TasksPage,
});

interface ChecklistItem {
  id?: string;
  label: string;
  done: boolean;
}

interface FlatJobItem {
  id: string;
  job_code: string;
  title: string;
  client_id: string;
  client_name: string | null;
  client_code: string | null;
  service_id: string;
  service_name: string | null;
  status: string;
  financial_status: string;
  created_at: string | null;
  due_date: string | null;
  period_start?: string | null;
  checklist: ChecklistItem[];
  assigned_staff: string | null;
  assigned_staff_name: string | null;
  fee: number | null;
  net_amount: number | null;
  auto_invoice?: boolean | null;
  invoices: Array<{ id: string; invoice_no: string; status: string }>;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_status: string | null;
}

function TasksPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canEdit, canDelete, canSeeAmounts } = usePermissions();

  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [jobsToDelete, setJobsToDelete] = useState<FlatJobItem[] | null>(null);
  const [forceDeleteJobs, setForceDeleteJobs] = useState(false);
  const [isDeletingJobs, setIsDeletingJobs] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["jobs", "tasks-view"],
    queryFn: async (): Promise<FlatJobItem[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,job_code,client_id,service_id,title,status,financial_status,due_date,created_at,period_start,checklist,assigned_staff,fee,net_amount,auto_invoice,clients(id,name,client_code),services(id,name),profiles!jobs_assigned_staff_fkey(full_name),invoice_items(invoice_id,invoices(id,invoice_no,status))",
        )
        .order("job_code", { ascending: true });

      if (error) {
        console.error("Failed to fetch jobs for tasks:", error);
        throw error;
      }

      return (data ?? []).map((j: any) => {
        const invsMap = new Map<string, { id: string; invoice_no: string; status: string }>();
        if (Array.isArray(j.invoice_items)) {
          for (const item of j.invoice_items) {
            if (item?.invoices?.id) {
              invsMap.set(item.invoices.id, item.invoices);
            }
          }
        }
        const taskInvoices = Array.from(invsMap.values());
        const firstInv = taskInvoices[0] ?? null;
        return {
          id: j.id,
          job_code: j.job_code ?? "",
          title: j.title ?? "",
          client_id: j.client_id ?? "",
          client_name: j.clients?.name ?? null,
          client_code: j.clients?.client_code ?? null,
          service_id: j.service_id ?? "",
          service_name: j.services?.name ?? null,
          status: j.status ?? "pending",
          financial_status: j.financial_status ?? "open",
          created_at: j.created_at ?? null,
          due_date: j.due_date ?? null,
          period_start: j.period_start ?? null,
          checklist: Array.isArray(j.checklist) ? j.checklist : [],
          assigned_staff: j.assigned_staff ?? null,
          assigned_staff_name: j.profiles?.full_name ?? null,
          fee: j.fee ?? null,
          net_amount: j.net_amount ?? null,
          auto_invoice: j.auto_invoice ?? false,
          invoices: taskInvoices,
          invoice_id: firstInv?.id ?? null,
          invoice_no: firstInv?.invoice_no ?? null,
          invoice_status: firstInv?.status ?? null,
        };
      });
    },
  });

  const { data: profiles } = useProfiles();

  const doneByQuery = useQuery({
    queryKey: ["job-status-history", "completed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_status_history")
        .select("job_id, changed_by, changed_at, new_status")
        .eq("new_status", "completed")
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const doneByMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of doneByQuery.data ?? []) {
      if (!map.has(h.job_id)) {
        const name = profiles?.find((p: any) => p.id === h.changed_by)?.full_name ?? "Unknown";
        map.set(h.job_id, name);
      }
    }
    return map;
  }, [doneByQuery.data, profiles]);

  const jobsList = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);

  const uniqueServices = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of jobsList) {
      if (t.service_id && t.service_name) {
        map.set(t.service_id, t.service_name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [jobsList]);

  // Display name helper: For recurring tasks, append the month name at end (e.g. "Service Name – Oct 2026")
  const displayServiceName = (j: FlatJobItem) => {
    const baseName = j.service_name || j.title || "—";
    const monthRegex = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/i;
    if (monthRegex.test(baseName)) {
      return baseName;
    }
    if (j.title && monthRegex.test(j.title)) {
      return j.title;
    }

    const isExplicitNonRecurring =
      baseName.toLowerCase().includes("non-recurring") ||
      baseName.toLowerCase().includes("non - recurring") ||
      (j.title &&
        (j.title.toLowerCase().includes("non-recurring") ||
          j.title.toLowerCase().includes("non - recurring")));

    const isRecurring =
      !isExplicitNonRecurring &&
      (baseName.toLowerCase().includes("recurring") ||
        (j.title && j.title.toLowerCase().includes("recurring")) ||
        Boolean(j.period_start && j.period_end && j.period_start !== j.period_end));

    if (isRecurring) {
      const dt = j.period_start || j.due_date || j.created_at;
      if (dt) {
        const d = new Date(dt);
        if (!isNaN(d.getTime())) {
          const monthYear = d.toLocaleString("en-IN", { month: "short", year: "numeric" });
          return `${baseName} – ${monthYear}`;
        }
      }
    }
    return baseName;
  };

  // Filtered Jobs
  const filteredJobs = useMemo(() => {
    return jobsList.filter((j) => {
      if (selectedStatuses.length > 0) {
        const dStatus = jobDisplayStatus(j);
        if (!selectedStatuses.includes(dStatus)) return false;
      }
      if (clientFilter && j.client_id !== clientFilter) return false;
      if (serviceFilter && j.service_id !== serviceFilter) return false;
      if (dateFrom && j.created_at && j.created_at.slice(0, 10) < dateFrom) return false;
      if (dateTo && j.created_at && j.created_at.slice(0, 10) > dateTo) return false;
      if (searchFilter) {
        const s = searchFilter.toLowerCase();
        const hay =
          `${j.job_code} ${j.title} ${j.service_name ?? ""} ${j.client_name ?? ""} ${j.client_code ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [jobsList, selectedStatuses, clientFilter, serviceFilter, dateFrom, dateTo, searchFilter]);

  // Bulk status update for jobs
  const handleBulkStatus = async (
    selected: FlatJobItem[],
    newStatus: string,
    clearSelection: () => void,
  ) => {
    if (!canEdit("jobs")) {
      toast.error("You are not authorised to update jobs");
      return;
    }

    const toastId = toast.loading(`Updating ${selected.length} jobs to ${label(newStatus)}…`);
    try {
      let count = 0;
      for (const item of selected) {
        const { error } = await supabase.rpc("update_job_status", {
          _job_id: item.id,
          _status: newStatus,
          _reason: `Status changed to ${newStatus} via Tasks bulk action`,
        });
        if (!error) {
          count++;
        }
      }
      toast.dismiss(toastId);
      toast.success(`Successfully updated ${count} job(s) to ${label(newStatus)}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks-view"] });
      qc.invalidateQueries({ queryKey: ["receivables"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    }
  };

  // Bulk deletion of jobs
  const handleBulkDeleteJobs = async (force: boolean) => {
    if (!jobsToDelete || jobsToDelete.length === 0) return;
    setIsDeletingJobs(true);
    const count = jobsToDelete.length;
    const toastId = toast.loading(
      force
        ? `Force deleting ${count} job(s) and detaching linked records...`
        : `Deleting ${count} job(s)...`,
    );

    try {
      const ids = jobsToDelete.map((j) => j.id);
      const res = await deleteJobs(ids, force);
      toast.dismiss(toastId);

      if (res.deleted > 0) {
        toast.success(`Successfully deleted ${res.deleted} job(s)`);
      }
      if (res.failed > 0) {
        toast.error(
          `${res.failed} job(s) could not be deleted due to linked records. Use "Force Delete" to override.`,
        );
        setForceDeleteJobs(true);
        setIsDeletingJobs(false);
        return;
      }
      setJobsToDelete(null);
      setForceDeleteJobs(false);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks-view"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    } finally {
      setIsDeletingJobs(false);
    }
  };

  // Metrics
  const totalJobs = jobsList.length;
  const pendingJobs = jobsList.filter((j) => jobDisplayStatus(j) === "pending" || j.status === "pending").length;
  const completedJobs = jobsList.filter((j) => j.status === "completed").length;
  const overdueJobsCount = jobsList.filter((j) => jobDisplayStatus(j) === "overdue").length;

  const statusOptions = [...JOB_STATUSES, "overdue"].map((s) => ({
    value: s,
    label: label(s),
  }));

  const handleExportTasksCsv = () => {
    const dataToExport = filteredJobs.map((j) => ({
      "Job Code": j.job_code,
      Service: displayServiceName(j),
      Client: j.client_name ?? "",
      Status: label(jobDisplayStatus(j)),
      Fee: canSeeAmounts("jobs") && j.fee != null ? j.fee : "",
      "Billing Status": j.invoice_no ?? j.financial_status,
      "Done By": j.status === "completed" ? (doneByMap.get(j.id) ?? "-") : "-",
      "Created Date": fmtDate(j.created_at),
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`tasks_${stamp}.csv`, dataToExport);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle="Manage compliance jobs, work assignments, and deliverables."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportTasksCsv}
              disabled={!filteredJobs.length}
              className="h-9 text-xs gap-1.5 font-medium"
              title="Export filtered tasks to CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button variant="outline" asChild>
              <Link to="/jobs">
                View All Jobs
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      {/* KPI Stats Cards matching the screenshot */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total Jobs</div>
            <div className="text-xl font-bold">{totalJobs}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Pending Jobs</div>
            <div className="text-xl font-bold text-amber-600">{pendingJobs}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completed Jobs</div>
            <div className="text-xl font-bold text-emerald-600">{completedJobs}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Overdue Jobs</div>
            <div className="text-xl font-bold text-rose-600">{overdueJobsCount}</div>
          </div>
        </div>
      </div>

      {/* Main Jobs Table */}
      <DataTable
        rows={filteredJobs}
        loading={jobsQuery.isLoading}
        selectable
        defaultSortKey="job_code"
        defaultSortDir={1}
        bulkActions={(selected, clearSelection) => (
          <div className="flex items-center gap-2">
            {canEdit("jobs") && (
              <>
                <Button
                  size="sm"
                  className="h-8 text-xs font-medium gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm cursor-pointer"
                  onClick={() => handleBulkStatus(selected, "completed", clearSelection)}
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark Done ({selected.length})
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8 text-xs font-medium">
                      Update
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleBulkStatus(selected, "in_progress", clearSelection)}
                      className="cursor-pointer gap-2"
                    >
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                      <span>In Progress</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleBulkStatus(selected, "on_hold", clearSelection)}
                      className="cursor-pointer gap-2"
                    >
                      <PauseCircle className="h-3.5 w-3.5 text-amber-600" />
                      <span>On Hold</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleBulkStatus(selected, "cancelled", clearSelection)}
                      className="cursor-pointer gap-2 text-destructive"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Cancelled</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {canDelete("jobs") && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 cursor-pointer"
                onClick={() => setJobsToDelete(selected)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selected.length})
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 font-medium bg-background cursor-pointer"
              onClick={() => {
                const dataToExport = selected.map((j) => ({
                  "Job Code": j.job_code,
                  Service: displayServiceName(j),
                  Client: j.client_name ?? "",
                  Status: label(jobDisplayStatus(j)),
                  Fee: canSeeAmounts("jobs") && j.fee != null ? j.fee : "",
                  "Billing Status": j.invoice_no ?? j.financial_status,
                  "Done By": j.status === "completed" ? (doneByMap.get(j.id) ?? "-") : "-",
                  "Created Date": fmtDate(j.created_at),
                }));
                const stamp = new Date().toISOString().slice(0, 10);
                downloadCsv(`tasks_selected_${stamp}.csv`, dataToExport);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export Selected ({selected.length})
            </Button>
          </div>
        )}
        onRowClick={(j) => navigate({ to: "/jobs/$id", params: { id: j.id } })}
        empty="No jobs match these filters."
        search={(j) => `${j.job_code} ${j.title} ${j.service_name ?? ""} ${j.client_name ?? ""}`}
        toolbar={
          <>
            <ChecklistFilter
              label="Status"
              options={statusOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
              className="w-32"
            />

            <ClientSelect
              value={clientFilter}
              onChange={setClientFilter}
              placeholder="All clients"
              className="w-36 text-xs h-9"
              allowClear
            />

            <NativeSelect
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="w-32 text-xs h-9"
            >
              <option value="">All services</option>
              {uniqueServices.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>

            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              label="Date"
            />

            {(selectedStatuses.length > 0 || clientFilter || serviceFilter || dateFrom || dateTo) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedStatuses([]);
                  setClientFilter("");
                  setServiceFilter("");
                  setDateFrom("");
                  setDateTo("");
                }}
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
            key: "job_code",
            header: "Job Code",
            className: "min-w-[120px] whitespace-nowrap",
            sort: (j) => j.job_code,
            render: (j) => (
              <span className="font-mono text-xs font-bold text-primary whitespace-nowrap">
                {j.job_code}
              </span>
            ),
          },
          {
            key: "service",
            header: "Service",
            sort: (j) => displayServiceName(j),
            render: (j) => {
              const isDone = j.status === "completed";
              return (
                <span
                  className={cn(
                    "inline-block rounded px-2 py-0.5 text-xs font-medium select-none transition-all",
                    isDone
                      ? "bg-muted/40 text-muted-foreground line-through decoration-muted-foreground/70"
                      : "bg-muted/60 text-foreground",
                  )}
                >
                  {displayServiceName(j)}
                </span>
              );
            },
          },
          {
            key: "client",
            header: "Client",
            sort: (j) => j.client_name ?? "",
            render: (j) => (
              <span className="font-medium text-xs text-foreground">{j.client_name ?? "—"}</span>
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
            key: "fee",
            header: "Fee",
            sort: (j) => j.fee ?? 0,
            render: (j) => (
              <span className="text-xs font-mono font-semibold">
                {canSeeAmounts("jobs") && j.fee != null ? inr(j.fee) : "-"}
              </span>
            ),
          },
          {
            key: "billing",
            header: "Billing",
            className: "min-w-[130px] whitespace-nowrap",
            render: (j) => {
              if (j.invoices && j.invoices.length > 0) {
                return (
                  <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {j.invoices.map((inv) => (
                      <Link
                        key={inv.id}
                        to="/invoices/$id"
                        params={{ id: inv.id }}
                        className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/60 hover:bg-muted border border-border/50 transition-colors whitespace-nowrap"
                        title={`Click to open Invoice ${inv.invoice_no}`}
                      >
                        <span className="font-mono text-[11px] text-primary underline underline-offset-2 whitespace-nowrap">
                          {inv.invoice_no}
                        </span>
                      </Link>
                    ))}
                    {j.financial_status !== "closed" && (
                      <StatusBadge status={j.financial_status} />
                    )}
                  </div>
                );
              }
              return <StatusBadge status={j.financial_status} />;
            },
          },
          {
            key: "done_by",
            header: "Done By",
            render: (j) => (
              <span className="text-xs text-muted-foreground">
                {j.status === "completed" ? (doneByMap.get(j.id) ?? "-") : "-"}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (j) => <StatusBadge status={jobDisplayStatus(j)} />,
          },
        ]}
      />

      <Dialog
        open={Boolean(jobsToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setJobsToDelete(null);
            setForceDeleteJobs(false);
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
                  id="force-delete-tasks-jobs"
                  checked={forceDeleteJobs}
                  onCheckedChange={(checked) => setForceDeleteJobs(Boolean(checked))}
                />
                <div className="grid gap-1 leading-tight">
                  <label
                    htmlFor="force-delete-tasks-jobs"
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
                setForceDeleteJobs(false);
              }}
              disabled={isDeletingJobs}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleBulkDeleteJobs(forceDeleteJobs)}
              disabled={isDeletingJobs}
            >
              {isDeletingJobs
                ? "Deleting..."
                : forceDeleteJobs
                  ? `Force Delete (${jobsToDelete?.length})`
                  : `Delete (${jobsToDelete?.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
