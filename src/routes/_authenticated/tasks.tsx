/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Check,
  Clock,
  Download,
  ListChecks,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  XCircle,
  Layers,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  ConfirmDeleteDialog,
  DateRangePicker,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { usePermissions } from "@/hooks/use-permissions";
import { deleteJobs } from "@/lib/firms.functions";
import { downloadCsv, errMsg, fmtDate, JOB_STATUSES, jobDisplayStatus, label } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks & Subtasks — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Actionable checklist subtasks and compliance workflow tracking.",
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
  checklist: ChecklistItem[];
  assigned_staff: string | null;
  assigned_staff_name: string | null;
}

interface SubtaskRow {
  id: string;
  jobId: string;
  jobCode: string;
  jobTitle: string;
  clientName: string;
  serviceName: string;
  assignedStaff: string;
  dueDate: string | null;
  itemIndex: number;
  label: string;
  done: boolean;
  jobStatus: string;
  totalItems: number;
  itemNumber: number;
}

function TasksPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canEdit, canDelete } = usePermissions();

  const [activeTab, setActiveTab] = useState<"subtasks" | "jobs">("subtasks");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [checklistFilter, setChecklistFilter] = useState<"all" | "pending" | "completed">(
    "pending",
  );
  const [clientFilter, setClientFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [subtasksToDelete, setSubtasksToDelete] = useState<SubtaskRow[] | null>(null);
  const [jobsToDelete, setJobsToDelete] = useState<FlatJobItem[] | null>(null);
  const [forceDeleteJobs, setForceDeleteJobs] = useState(false);
  const [isDeletingJobs, setIsDeletingJobs] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["jobs", "tasks-view"],
    queryFn: async (): Promise<FlatJobItem[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,job_code,client_id,service_id,title,status,financial_status,due_date,created_at,checklist,assigned_staff,clients(id,name,client_code),services(id,name),profiles!jobs_assigned_staff_fkey(full_name)",
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch jobs for tasks:", error);
        throw error;
      }

      return (data ?? []).map((j: any) => ({
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
        checklist: Array.isArray(j.checklist) ? j.checklist : [],
        assigned_staff: j.assigned_staff ?? null,
        assigned_staff_name: j.profiles?.full_name ?? null,
      }));
    },
  });

  const jobsList = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);

  // Flattened Subtasks list extracted from all jobs
  const subtasksList = useMemo<SubtaskRow[]>(() => {
    const list: SubtaskRow[] = [];
    for (const job of jobsList) {
      const items =
        Array.isArray(job.checklist) && job.checklist.length > 0
          ? job.checklist
          : [
              // If job doesn't have an explicit checklist yet, represent default primary task
              { label: job.title || "Compliance work execution", done: job.status === "completed" },
            ];

      items.forEach((item, idx) => {
        list.push({
          id: `${job.id}-${idx}`,
          jobId: job.id,
          jobCode: job.job_code,
          jobTitle: job.title,
          clientName: job.client_name ?? "—",
          serviceName: job.service_name ?? "—",
          assignedStaff: job.assigned_staff_name ?? "Unassigned",
          dueDate: job.due_date,
          itemIndex: idx,
          label: item.label || `Task Step ${idx + 1}`,
          done: !!item.done,
          jobStatus: job.status,
          totalItems: items.length,
          itemNumber: idx + 1,
        });
      });
    }
    return list;
  }, [jobsList]);

  const uniqueServices = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of jobsList) {
      if (t.service_id && t.service_name) {
        map.set(t.service_id, t.service_name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [jobsList]);

  // Toggle checklist subtask directly in Supabase and sync job status
  const handleToggleSubtask = async (subtask: SubtaskRow) => {
    if (!canEdit("jobs")) {
      toast.error("Not authorised to edit tasks");
      return;
    }
    const job = jobsList.find((j) => j.id === subtask.jobId);
    if (!job) return;

    let updatedChecklist: ChecklistItem[] = [];
    const hasExistingChecklist = Array.isArray(job.checklist) && job.checklist.length > 0;

    const nextDone = !subtask.done;
    if (hasExistingChecklist) {
      updatedChecklist = job.checklist.map((it, idx) =>
        idx === subtask.itemIndex ? { ...it, done: nextDone } : it,
      );
    } else {
      updatedChecklist = [{ label: subtask.label, done: nextDone }];
    }

    const allDone = updatedChecklist.length > 0 && updatedChecklist.every((it) => it.done);
    const anyDone = updatedChecklist.some((it) => it.done);
    const doneCount = updatedChecklist.filter((it) => it.done).length;
    const totalCount = updatedChecklist.length;

    // Direct update to jobs table to persist checklist and status immediately
    const jobUpdates: Record<string, any> = {
      checklist: updatedChecklist,
    };
    if (allDone) {
      jobUpdates.status = "completed";
      jobUpdates.completed_at = new Date().toISOString();
    } else if (!nextDone && job.status === "completed") {
      jobUpdates.status = "in_progress";
      jobUpdates.completed_at = null;
    } else if (job.status === "pending" && (nextDone || anyDone)) {
      jobUpdates.status = "in_progress";
    }

    const { error } = await supabase
      .from("jobs")
      .update(jobUpdates as never)
      .eq("id", job.id);

    if (error) {
      toast.error(errMsg(error));
      return;
    }

    // Auto-advance or revert job status via RPC to trigger audit logs and auto-invoicing
    if (allDone && job.status !== "completed") {
      await supabase.rpc("update_job_status", {
        _job_id: job.id,
        _status: "completed",
        _reason: `All ${totalCount} checklist tasks completed (${doneCount}/${totalCount})`,
      });
      toast.success(
        `All ${totalCount} tasks completed! Job "${job.job_code}" marked as done & moved to Clearing Desk.`,
      );
    } else if (!nextDone && job.status === "completed") {
      await supabase.rpc("update_job_status", {
        _job_id: job.id,
        _status: "in_progress",
        _reason: "Checklist subtask reopened",
      });
      toast.info(`Task reopened — Job "${job.job_code}" returned to In Progress`);
    } else if (job.status === "pending" && (nextDone || anyDone)) {
      await supabase.rpc("update_job_status", {
        _job_id: job.id,
        _status: "in_progress",
        _reason: "Checklist subtask started",
      });
      toast.success(
        `Marked "${subtask.label}" done (${doneCount}/${totalCount}) — Job in progress`,
      );
    } else {
      toast.success(
        nextDone
          ? `Marked "${subtask.label}" done (${doneCount}/${totalCount})`
          : `Marked "${subtask.label}" pending (${doneCount}/${totalCount})`,
      );
    }

    await Promise.all([
      qc.invalidateQueries({ queryKey: ["jobs"] }),
      qc.invalidateQueries({ queryKey: ["jobs", "tasks-view"] }),
      qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] }),
      qc.invalidateQueries({ queryKey: ["clearing-v2-jobs"] }),
    ]);
  };

  // Filtered Subtasks
  const filteredSubtasks = useMemo(() => {
    return subtasksList.filter((st) => {
      if (checklistFilter === "pending" && st.done) return false;
      if (checklistFilter === "completed" && !st.done) return false;

      if (selectedStatuses.length > 0) {
        const job = jobsList.find((j) => j.id === st.jobId);
        const dStatus = job ? jobDisplayStatus(job) : st.jobStatus;
        if (!selectedStatuses.includes(dStatus)) return false;
      }

      if (clientFilter) {
        const job = jobsList.find((j) => j.id === st.jobId);
        if (job?.client_id !== clientFilter) return false;
      }

      if (serviceFilter) {
        const job = jobsList.find((j) => j.id === st.jobId);
        if (job?.service_id !== serviceFilter) return false;
      }

      if (dateFrom && st.dueDate && st.dueDate < dateFrom) return false;
      if (dateTo && st.dueDate && st.dueDate > dateTo) return false;

      if (searchFilter) {
        const s = searchFilter.toLowerCase();
        const hay =
          `${st.label} ${st.jobCode} ${st.jobTitle} ${st.clientName} ${st.serviceName} ${st.assignedStaff}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }

      return true;
    });
  }, [
    subtasksList,
    checklistFilter,
    selectedStatuses,
    clientFilter,
    serviceFilter,
    dateFrom,
    dateTo,
    searchFilter,
    jobsList,
  ]);

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

  // Bulk subtask completion toggle
  const handleBulkSubtasksDone = async (
    subtasks: SubtaskRow[],
    done: boolean,
    clearSelection: () => void,
  ) => {
    if (!canEdit("jobs")) {
      toast.error("Not authorised to edit tasks");
      return;
    }
    const toastId = toast.loading(
      `Marking ${subtasks.length} subtask(s) as ${done ? "completed" : "pending"}...`,
    );
    try {
      const map = new Map<string, Set<number>>();
      for (const st of subtasks) {
        if (!map.has(st.jobId)) map.set(st.jobId, new Set());
        map.get(st.jobId)!.add(st.itemIndex);
      }

      for (const [jobId, indices] of map.entries()) {
        const job = jobsList.find((j) => j.id === jobId);
        if (!job) continue;
        const currentChecklist =
          Array.isArray(job.checklist) && job.checklist.length > 0
            ? [...job.checklist]
            : [{ label: job.title || "Compliance work execution", done: false }];

        const updatedChecklist = currentChecklist.map((it, idx) =>
          indices.has(idx) ? { ...it, done } : it,
        );
        const allDone = updatedChecklist.length > 0 && updatedChecklist.every((it) => it.done);

        const updates: Record<string, any> = { checklist: updatedChecklist };
        if (allDone) {
          updates.status = "completed";
          updates.completed_at = new Date().toISOString();
        } else if (!done && job.status === "completed") {
          updates.status = "in_progress";
          updates.completed_at = null;
        }

        await supabase
          .from("jobs")
          .update(updates as never)
          .eq("id", jobId);
        if (allDone && job.status !== "completed") {
          await supabase.rpc("update_job_status", {
            _job_id: jobId,
            _status: "completed",
            _reason: "All checklist subtasks completed via bulk action",
          });
        }
      }

      toast.dismiss(toastId);
      toast.success(`Marked ${subtasks.length} subtask(s) as ${done ? "completed" : "pending"}`);
      clearSelection();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        qc.invalidateQueries({ queryKey: ["jobs", "tasks-view"] }),
        qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] }),
        qc.invalidateQueries({ queryKey: ["clearing-v2-jobs"] }),
      ]);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    }
  };

  // Bulk deletion of subtasks from job checklists
  const handleBulkDeleteSubtasks = async () => {
    if (!subtasksToDelete || subtasksToDelete.length === 0) return;
    const toastId = toast.loading(`Deleting ${subtasksToDelete.length} checklist subtask(s)...`);
    try {
      const map = new Map<string, Set<number>>();
      for (const st of subtasksToDelete) {
        if (!map.has(st.jobId)) map.set(st.jobId, new Set());
        map.get(st.jobId)!.add(st.itemIndex);
      }

      for (const [jobId, indices] of map.entries()) {
        const job = jobsList.find((j) => j.id === jobId);
        if (!job) continue;
        const currentChecklist = Array.isArray(job.checklist) ? job.checklist : [];
        const newChecklist = currentChecklist.filter((_, idx) => !indices.has(idx));
        await supabase
          .from("jobs")
          .update({ checklist: newChecklist as never })
          .eq("id", jobId);
      }

      toast.dismiss(toastId);
      toast.success(`Deleted ${subtasksToDelete.length} checklist subtask(s)`);
      setSubtasksToDelete(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        qc.invalidateQueries({ queryKey: ["jobs", "tasks-view"] }),
      ]);
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
      const res = await deleteJobs({ data: { jobIds: ids, force } });
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
  const totalSubtasks = subtasksList.length;
  const pendingSubtasks = subtasksList.filter((s) => !s.done).length;
  const completedSubtasks = subtasksList.filter((s) => s.done).length;
  const overdueJobsCount = jobsList.filter((j) => jobDisplayStatus(j) === "overdue").length;

  const statusOptions = [...JOB_STATUSES, "overdue"].map((s) => ({
    value: s,
    label: label(s),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks & Subtasks"
        subtitle="Individual checklist tasks and compliance activity tracking across all active jobs."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/jobs">
                View All Jobs
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Checklist Subtasks</div>
            <div className="text-xl font-bold">{totalSubtasks}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Pending Subtasks</div>
            <div className="text-xl font-bold text-amber-600">{pendingSubtasks}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completed Subtasks</div>
            <div className="text-xl font-bold text-emerald-600">{completedSubtasks}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Overdue Compliance</div>
            <div className="text-xl font-bold text-rose-600">{overdueJobsCount}</div>
          </div>
        </div>
      </div>

      {/* View Switcher Tabs: Individual Subtasks vs Parent Jobs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={activeTab === "subtasks" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("subtasks")}
            className="gap-1.5 h-8 text-xs font-medium"
          >
            <ListChecks className="h-3.5 w-3.5" />
            Individual Subtasks Checklist ({filteredSubtasks.length})
          </Button>
          <Button
            type="button"
            variant={activeTab === "jobs" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("jobs")}
            className="gap-1.5 h-8 text-xs font-medium"
          >
            <Layers className="h-3.5 w-3.5" />
            Parent Jobs Summary ({filteredJobs.length})
          </Button>
        </div>

        {activeTab === "subtasks" && (
          <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-lg text-xs">
            <span className="text-[11px] font-medium text-muted-foreground px-1.5">Checklist:</span>
            <Button
              type="button"
              variant={checklistFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setChecklistFilter("all")}
              className="h-6 px-2 text-xs"
            >
              All
            </Button>
            <Button
              type="button"
              variant={checklistFilter === "pending" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setChecklistFilter("pending")}
              className="h-6 px-2 text-xs text-amber-600"
            >
              Pending Only
            </Button>
            <Button
              type="button"
              variant={checklistFilter === "completed" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setChecklistFilter("completed")}
              className="h-6 px-2 text-xs text-emerald-600"
            >
              Completed
            </Button>
          </div>
        )}
      </div>

      {/* Tab 1: Actionable Individual Subtasks View */}
      {activeTab === "subtasks" ? (
        <DataTable
          rows={filteredSubtasks}
          loading={jobsQuery.isLoading}
          selectable
          bulkActions={(selectedSubtasks, clearSelection) => (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit("jobs") && (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 text-xs font-medium gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                    onClick={() => handleBulkSubtasksDone(selectedSubtasks, true, clearSelection)}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Mark Done ({selectedSubtasks.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                    onClick={() => handleBulkSubtasksDone(selectedSubtasks, false, clearSelection)}
                  >
                    <Clock className="h-3.5 w-3.5 text-amber-600" />
                    Mark Pending
                  </Button>
                </>
              )}

              {canDelete("jobs") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 cursor-pointer"
                  onClick={() => setSubtasksToDelete(selectedSubtasks)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Selected ({selectedSubtasks.length})
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 font-medium bg-background cursor-pointer"
                onClick={() => {
                  const dataToExport = selectedSubtasks.map((s) => ({
                    "Subtask Item": s.label,
                    Status: s.done ? "Completed" : "Pending",
                    "Job Code": s.jobCode,
                    "Job Title": s.jobTitle,
                    Client: s.clientName,
                    Service: s.serviceName,
                    "Assigned Staff": s.assignedStaff,
                    "Due Date": fmtDate(s.dueDate),
                  }));
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCsv(`subtasks_selected_${stamp}.csv`, dataToExport);
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Export Selected ({selectedSubtasks.length})
              </Button>
            </div>
          )}
          empty="No checklist subtasks found for the selected filters."
          search={(s) => `${s.label} ${s.jobCode} ${s.jobTitle} ${s.clientName} ${s.serviceName}`}
          exportFilename="checklist_subtasks"
          exportTransform={(s) => ({
            "Subtask Item": s.label,
            Done: s.done ? "Yes" : "No",
            "Job Code": s.jobCode,
            "Job Title": s.jobTitle,
            Client: s.clientName,
            Service: s.serviceName,
            "Assigned Staff": s.assignedStaff,
            "Due Date": fmtDate(s.dueDate),
          })}
          toolbar={
            <>
              {/* Multi-select Checklist Filter for Status */}
              <ChecklistFilter
                label="Job Status"
                options={statusOptions}
                selected={selectedStatuses}
                onChange={setSelectedStatuses}
                className="w-36"
              />

              <ClientSelect
                value={clientFilter}
                onChange={setClientFilter}
                placeholder="All clients"
                className="w-40 text-xs h-9"
                allowClear
              />

              <NativeSelect
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="w-36 text-xs h-9"
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
                label="Due"
              />
            </>
          }
          columns={[
            {
              key: "status",
              header: "Status",
              className: "w-28",
              sort: (st) => (st.done ? "Completed" : "Pending"),
              render: (st) => (
                <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => handleToggleSubtask(st)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors cursor-pointer",
                      st.done
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20",
                    )}
                    title={st.done ? "Click to reopen task" : "Click to mark done"}
                  >
                    {st.done ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" />
                        <span>Done</span>
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3 text-amber-600" />
                        <span>Pending</span>
                      </>
                    )}
                  </button>
                </div>
              ),
            },
            {
              key: "label",
              header: "Checklist Subtask",
              sort: (st) => st.label,
              render: (st) => (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "font-medium text-sm",
                        st.done ? "line-through text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {st.label}
                    </span>
                    {st.totalItems > 1 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] py-0 px-1.5 font-normal text-muted-foreground"
                      >
                        Step {st.itemNumber} of {st.totalItems}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-mono text-primary font-semibold">
                      {st.jobCode}
                    </span>
                    <span>·</span>
                    <span className="truncate max-w-[200px]">{st.jobTitle}</span>
                  </div>
                </div>
              ),
            },
            {
              key: "client",
              header: "Client",
              sort: (st) => st.clientName,
              render: (st) => (
                <span className="font-medium text-xs text-foreground">{st.clientName}</span>
              ),
            },
            {
              key: "service",
              header: "Service",
              sort: (st) => st.serviceName,
              render: (st) => (
                <span className="inline-block rounded bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground">
                  {st.serviceName}
                </span>
              ),
            },
            {
              key: "assigned",
              header: "Staff",
              render: (st) => (
                <span className="text-xs text-muted-foreground">{st.assignedStaff}</span>
              ),
            },
            {
              key: "due_date",
              header: "Due Date",
              sort: (st) => st.dueDate ?? "",
              render: (st) => (
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {fmtDate(st.dueDate)}
                </span>
              ),
            },
            {
              key: "action",
              header: "",
              render: (st) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate({ to: "/jobs/$id", params: { id: st.jobId } });
                  }}
                  title="Open full job"
                >
                  Open Job
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              ),
            },
          ]}
        />
      ) : (
        /* Tab 2: Parent Jobs Summary View */
        <DataTable
          rows={filteredJobs}
          loading={jobsQuery.isLoading}
          selectable
          bulkActions={(selected, clearSelection) => (
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
                      onClick={() => handleBulkStatus(selected, "completed", clearSelection)}
                      className="cursor-pointer gap-2"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Completed</span>
                    </DropdownMenuItem>
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
                    "Task to Perform": j.title,
                    Client: j.client_name ?? "",
                    Status: label(jobDisplayStatus(j)),
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
          search={(j) => `${j.job_code} ${j.title} ${j.client_name ?? ""}`}
          exportFilename="parent_jobs"
          exportTransform={(j) => ({
            "Job Code": j.job_code,
            "Job Title": j.title,
            Client: j.client_name ?? "",
            Status: label(jobDisplayStatus(j)),
            "Checklist Progress": `${j.checklist.filter((i) => i.done).length}/${j.checklist.length} done`,
            "Created Date": fmtDate(j.created_at),
          })}
          toolbar={
            <>
              <ChecklistFilter
                label="Status"
                options={statusOptions}
                selected={selectedStatuses}
                onChange={setSelectedStatuses}
                className="w-36"
              />

              <ClientSelect
                value={clientFilter}
                onChange={setClientFilter}
                placeholder="All clients"
                className="w-40 text-xs h-9"
                allowClear
              />

              <NativeSelect
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="w-36 text-xs h-9"
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
            </>
          }
          columns={[
            {
              key: "job_code",
              header: "Job Code",
              sort: (j) => j.job_code,
              render: (j) => (
                <span className="font-mono text-xs font-bold text-primary">{j.job_code}</span>
              ),
            },
            {
              key: "service",
              header: "Service",
              sort: (j) => j.service_name ?? "",
              render: (j) => (
                <span className="inline-block rounded bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground">
                  {j.service_name ?? "—"}
                </span>
              ),
            },
            {
              key: "title",
              header: "Job Title",
              sort: (j) => j.title,
              render: (j) => <span className="font-medium text-foreground">{j.title}</span>,
            },
            {
              key: "client",
              header: "Client",
              sort: (j) => j.client_name ?? "",
              render: (j) => (
                <span className="font-medium text-muted-foreground">{j.client_name ?? "—"}</span>
              ),
            },
            {
              key: "progress",
              header: "Checklist Progress",
              render: (j) => {
                const total = j.checklist.length;
                const done = j.checklist.filter((i) => i.done).length;
                if (total === 0) return <span className="text-xs text-muted-foreground">—</span>;
                const pct = Math.round((done / total) * 100);
                return (
                  <div className="space-y-1 min-w-[120px]">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        {done} of {total} done
                      </span>
                      <span className="font-medium font-mono">{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          done === total ? "bg-emerald-500" : "bg-primary",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              },
            },
            {
              key: "due_date",
              header: "Due Date",
              sort: (j) => j.due_date ?? "",
              render: (j) => (
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {fmtDate(j.due_date)}
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
      )}

      <ConfirmDeleteDialog
        open={Boolean(subtasksToDelete)}
        onOpenChange={(open) => !open && setSubtasksToDelete(null)}
        title={`Delete ${subtasksToDelete?.length ?? 0} Selected Checklist Subtask(s)?`}
        description="Are you sure you want to delete the selected checklist subtasks? This will remove them from the corresponding jobs' checklists."
        onConfirm={handleBulkDeleteSubtasks}
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
