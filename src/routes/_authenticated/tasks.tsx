import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
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
import { ClientSelect, NativeSelect, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { usePermissions } from "@/hooks/use-permissions";
import { downloadCsv, errMsg, fmtDate, JOB_STATUSES, jobDisplayStatus, label } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — CA PracticeDesk" },
      { name: "description", content: "Flat, single-line task and job management." },
    ],
  }),
  component: TasksPage,
});

interface FlatTaskItem {
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
}

function TasksPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canEdit } = usePermissions();

  const [fl, setFl] = useState({
    status: "",
    client: "",
    service: "",
    search: "",
    from: "",
    to: "",
  });

  const jobsQuery = useQuery({
    queryKey: ["jobs", "tasks"],
    queryFn: async (): Promise<FlatTaskItem[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,job_code,client_id,service_id,title,status,financial_status,due_date,created_at,clients(id,name,client_code),services(id,name)",
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
      }));
    },
  });

  const tasksList = jobsQuery.data ?? [];

  const uniqueServices = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasksList) {
      if (t.service_id && t.service_name) {
        map.set(t.service_id, t.service_name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasksList]);

  // Quick range helper
  const setRangeDays = (days: number | null) => {
    if (days === null) {
      setFl((p) => ({ ...p, from: "", to: "" }));
      return;
    }
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setFl((p) => ({
      ...p,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    }));
  };

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasksList.filter((j) => {
      if (fl.status) {
        const dStatus = jobDisplayStatus(j);
        if (dStatus !== fl.status) return false;
      }
      if (fl.client && j.client_id !== fl.client) return false;
      if (fl.service && j.service_id !== fl.service) return false;
      if (fl.from && j.created_at && j.created_at.slice(0, 10) < fl.from) return false;
      if (fl.to && j.created_at && j.created_at.slice(0, 10) > fl.to) return false;
      if (fl.search) {
        const s = fl.search.toLowerCase();
        const hay = `${j.job_code} ${j.title} ${j.service_name ?? ""} ${j.client_name ?? ""} ${j.client_code ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [tasksList, fl]);

  // Bulk status update
  const handleBulkStatus = async (
    selected: FlatTaskItem[],
    newStatus: string,
    clearSelection: () => void,
  ) => {
    if (!canEdit("jobs")) {
      toast.error("You are not authorised to update jobs");
      return;
    }

    const toastId = toast.loading(`Updating ${selected.length} tasks to ${label(newStatus)}…`);
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
      toast.success(`Successfully updated ${count} task(s) to ${label(newStatus)}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    }
  };

  // Metrics
  const totalCount = tasksList.length;
  const pendingCount = tasksList.filter((j) => j.status === "pending" || j.status === "in_progress").length;
  const completedCount = tasksList.filter((j) => j.status === "completed").length;
  const overdueCount = tasksList.filter((j) => jobDisplayStatus(j) === "overdue").length;

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Single-line task list — click any row to open the job."
      />

      {/* KPI Stats Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total Tasks</div>
            <div className="text-xl font-bold">{totalCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">In Progress / Pending</div>
            <div className="text-xl font-bold">{pendingCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Overdue</div>
            <div className="text-xl font-bold text-rose-600">{overdueCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completed</div>
            <div className="text-xl font-bold text-emerald-600">{completedCount}</div>
          </div>
        </div>
      </div>

      <DataTable
        rows={filteredTasks}
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

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 font-medium bg-background"
              onClick={() => {
                const dataToExport = selected.map((j) => ({
                  "Job Code": j.job_code,
                  "Task to Perform": j.title,
                  "Client": j.client_name ?? "",
                  "Status": label(jobDisplayStatus(j)),
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
        empty="No tasks match these filters."
        search={(j) => `${j.job_code} ${j.title} ${j.client_name ?? ""}`}
        exportFilename="tasks"
        exportTransform={(j) => ({
          "Job Code": j.job_code,
          "Task to Perform": j.title,
          "Client": j.client_name ?? "",
          "Status": label(jobDisplayStatus(j)),
          "Created Date": fmtDate(j.created_at),
        })}
        toolbar={
          <>
            <NativeSelect
              value={fl.status}
              onChange={(e) => setFl((p) => ({ ...p, status: e.target.value }))}
              className="w-36 text-xs h-9"
            >
              <option value="">All statuses</option>
              {[...JOB_STATUSES, "overdue"].map((x) => (
                <option key={x} value={x}>
                  {label(x)}
                </option>
              ))}
            </NativeSelect>

            <ClientSelect
              value={fl.client}
              onChange={(id) => setFl((p) => ({ ...p, client: id }))}
              placeholder="All clients"
              className="w-44 text-xs h-9"
              allowClear
            />

            <NativeSelect
              value={fl.service}
              onChange={(e) => setFl((p) => ({ ...p, service: e.target.value }))}
              className="w-40 text-xs h-9"
            >
              <option value="">All services</option>
              {uniqueServices.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>

            <span className="text-xs text-muted-foreground whitespace-nowrap">Date</span>
            <Input
              type="date"
              value={fl.from}
              onChange={(e) => setFl((p) => ({ ...p, from: e.target.value }))}
              className="h-9 w-32 text-xs"
            />
            <Input
              type="date"
              value={fl.to}
              onChange={(e) => setFl((p) => ({ ...p, to: e.target.value }))}
              className="h-9 w-32 text-xs"
            />

            <div className="flex items-center gap-1 border-l pl-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setRangeDays(30)}
              >
                1M
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setRangeDays(60)}
              >
                2M
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setRangeDays(90)}
              >
                3M
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setRangeDays(null)}
              >
                All
              </Button>
            </div>
          </>
        }
        columns={[
          {
            key: "job_code",
            header: "Job Code",
            sort: (j) => j.job_code,
            render: (j) => (
              <span className="font-mono text-xs font-bold text-primary">
                {j.job_code}
              </span>
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
            header: "Task to Perform",
            sort: (j) => j.title,
            render: (j) => (
              <span className="font-medium text-foreground">
                {j.title}
              </span>
            ),
          },
          {
            key: "client",
            header: "Client",
            sort: (j) => j.client_name ?? "",
            render: (j) => <span className="font-medium text-muted-foreground">{j.client_name ?? "—"}</span>,
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
            key: "status",
            header: "Status",
            render: (j) => <StatusBadge status={jobDisplayStatus(j)} />,
          },
        ]}
      />
    </div>
  );
}
