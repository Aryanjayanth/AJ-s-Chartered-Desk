/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, Fragment } from "react";
import {
  Plus,
  ArrowRight,
  Download,
  Building2,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  RotateCcw,
  Trash2,
  Layers,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
      { title: "Jobs — AJ's Chartered Desk" },
      { name: "description", content: "Parent jobs management (combined task packages)." },
    ],
  }),
  component: JobsPage,
});

interface JobRow {
  id: string;
  job_code: string;
  client_id: string;
  service_id: string;
  client_service_id: string | null;
  title: string;
  period_start: string | null;
  period_end: string | null;
  fee: number | null;
  discount: number | null;
  net_amount: number | null;
  due_date: string | null;
  assigned_staff: string | null;
  assigned_staff_name: string | null;
  status: string;
  financial_status: string;
  notes: string | null;
  auto_invoice: boolean;
  created_at: string | null;
  client_name: string | null;
  service_name: string | null;
  invoices: Array<{ id: string; invoice_no: string; status: string }>;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_status: string | null;
  company_name: string | null;
}

interface JobGroup {
  key: string;
  job_code: string;
  client_id: string;
  client_name: string | null;
  company_name: string | null;
  created_at: string | null;
  tasks: JobRow[];
  invoices: Array<{ id: string; invoice_no: string; status: string }>;
  title: string;
  status: string;
  due_date: string | null;
  assigned_staff_name: string | null;
  total_fee: number;
  total_net: number;
  financial_status: string;
}

function aggregateStatus(tasks: JobRow[]): string {
  if (tasks.every((t) => t.status === "completed")) return "completed";
  if (tasks.some((t) => t.status === "cancelled")) return "cancelled";
  if (tasks.some((t) => t.status === "on_hold")) return "on_hold";
  if (tasks.some((t) => t.status === "in_progress")) return "in_progress";
  return "pending";
}

function JobsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canCreate, canEdit, canDelete, canSeeAmounts } = usePermissions();
  const { data: profiles } = useProfiles();
  const { data: currentFirm } = useCurrentFirm();
  const [open, setOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [jobsToDelete, setJobsToDelete] = useState<JobRow[] | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [clearSelectionCallback, setClearSelectionCallback] = useState<(() => void) | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [codeSortDir, setCodeSortDir] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
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
        setForceDelete(true);
        setIsDeleting(false);
        return;
      }
      clearSelectionCallback?.();
      setJobsToDelete(null);
      setForceDelete(false);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks-view"] });
      qc.invalidateQueries({ queryKey: ["receivables"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const q = useQuery({
    queryKey: ["jobs"],
    queryFn: () =>
      readList("jobs_list", {}, async () => {
        const { data, error } = await supabase
          .from("jobs")
          .select(
            "id,job_code,client_id,service_id,client_service_id,title,period_start,period_end,fee,discount,net_amount,due_date,assigned_staff,status,financial_status,notes,auto_invoice,created_at,clients(name),services(name),profiles!jobs_assigned_staff_fkey(full_name),invoice_items(invoice_id,invoices(id,invoice_no,status))",
          )
          .order("job_code", { ascending: true });
        if (error) return { data: null, error };
        return {
          data: (data ?? []).map((j: any) => {
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
            const companyMatch = j.notes?.match(/\[Company:\s*([^\]]+)\]/);
            const companyName = companyMatch ? companyMatch[1] : null;
            return {
              ...j,
              company_name: companyName,
              client_name: j.clients?.name ?? null,
              service_name: j.services?.name ?? null,
              assigned_staff_name: j.profiles?.full_name ?? null,
              invoices: taskInvoices,
              invoice_id: firstInv?.id ?? null,
              invoice_no: firstInv?.invoice_no ?? null,
              invoice_status: firstInv?.status ?? null,
            };
          }),
          error: null,
        };
      }),
  });

  const all = useMemo(() => (q.data ?? []) as JobRow[], [q.data]);

  // Group tasks that were created together in the same JobForm submission batch
  // Single tasks or separate submissions have their own distinct key so they NEVER merge!
  const groups = useMemo<JobGroup[]>(() => {
    const map = new Map<string, JobRow[]>();
    for (const j of all) {
      const batchMatch = j.notes?.match(/\[Batch:\s*([^\]]+)\]/);
      const key = (j as any).batch_id || (batchMatch ? batchMatch[1] : j.job_code || j.id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(j);
    }
    const out: JobGroup[] = [];
    for (const [key, tasks] of map.entries()) {
      tasks.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      const first = tasks[0];
      const groupInvsMap = new Map<string, { id: string; invoice_no: string; status: string }>();
      for (const t of tasks) {
        for (const inv of t.invoices ?? []) {
          if (inv?.id && !groupInvsMap.has(inv.id)) {
            groupInvsMap.set(inv.id, inv);
          }
        }
      }
      const groupInvoices = Array.from(groupInvsMap.values());

      out.push({
        key,
        job_code: first.job_code,
        client_id: first.client_id,
        client_name: first.client_name,
        company_name: first.company_name,
        created_at: first.created_at,
        tasks,
        invoices: groupInvoices,
        title: tasks.map((t) => t.title).join(" + "),
        status: aggregateStatus(tasks),
        due_date:
          tasks
            .map((t) => t.due_date)
            .filter(Boolean)
            .sort()[0] ?? null,
        assigned_staff_name: first.assigned_staff_name,
        total_fee: tasks.reduce((s, t) => s + (Number(t.fee) || 0), 0),
        total_net: tasks.reduce((s, t) => s + (Number(t.net_amount) || 0), 0),
        financial_status: tasks.every((t) => t.financial_status === "closed")
          ? "closed"
          : tasks.some((t) => t.financial_status === "invoiced")
            ? "invoiced"
            : "open",
      });
    }
    // sort by job_code in requested direction (natural alphanumeric sort)
    out.sort((a, b) => {
      const cmp = (a.job_code ?? "").localeCompare(b.job_code ?? "", undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return codeSortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [all, codeSortDir]);

  const clients = [...new Map(all.map((j) => [j.client_id, j.client_name])).entries()];
  const services = [...new Map(all.map((j) => [j.service_id, j.service_name])).entries()];
  const uniqueCompanies = useMemo(() => {
    const list: string[] = [];
    if (currentFirm?.name) list.push(currentFirm.name);
    for (const j of all) {
      if (j.company_name && !list.includes(j.company_name)) list.push(j.company_name);
    }
    return list;
  }, [all, currentFirm?.name]);

  const filteredGroups = groups.filter((g) => {
    if (searchQuery.trim()) {
      const sq = searchQuery.toLowerCase().trim();
      const matchesJob =
        (g.job_code && g.job_code.toLowerCase().includes(sq)) ||
        (g.client_name && g.client_name.toLowerCase().includes(sq)) ||
        (g.company_name && g.company_name.toLowerCase().includes(sq)) ||
        (g.title && g.title.toLowerCase().includes(sq));
      const matchesTask = g.tasks.some(
        (t) =>
          (t.title && t.title.toLowerCase().includes(sq)) ||
          (t.notes && t.notes.toLowerCase().includes(sq)) ||
          (t.service_name && t.service_name.toLowerCase().includes(sq)) ||
          (t.assigned_staff_name && t.assigned_staff_name.toLowerCase().includes(sq)) ||
          (t.invoice_no && t.invoice_no.toLowerCase().includes(sq)),
      );
      if (!matchesJob && !matchesTask) return false;
    }
    if (selectedStatuses.length > 0) {
      const dStatus = jobDisplayStatus(g);
      if (!selectedStatuses.includes(dStatus)) return false;
    }
    if (fl.client && g.client_id !== fl.client) return false;
    if (fl.service && !g.tasks.some((t) => t.service_id === fl.service)) return false;
    if (fl.staff && !g.tasks.some((t) => t.assigned_staff === fl.staff)) return false;
    if (
      fl.company &&
      (fl.company === currentFirm?.name
        ? g.company_name && g.company_name !== currentFirm?.name
        : g.company_name !== fl.company)
    )
      return false;
    if (fl.from && g.created_at && g.created_at.slice(0, 10) < fl.from) return false;
    if (fl.to && g.created_at && g.created_at.slice(0, 10) > fl.to) return false;
    return true;
  });

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
    selectedStatuses.length > 0 ||
    fl.client ||
    fl.service ||
    fl.staff ||
    fl.company ||
    fl.from ||
    fl.to,
  );

  const resetAllFilters = () => {
    setSearchQuery("");
    setSelectedStatuses([]);
    setFl({ client: "", service: "", staff: "", company: "", from: "", to: "" });
  };

  const handleExportCsv = () => {
    const dataToExport = filteredGroups.flatMap((g) =>
      g.tasks.map((t) => ({
        "Job Code": g.job_code,
        Client: g.client_name ?? "",
        Company: g.company_name ?? "",
        "Job Title": g.title,
        "Task Title": t.title,
        Service: t.service_name ?? "",
        "Assigned Staff": t.assigned_staff_name ?? "",
        Status: label(jobDisplayStatus(g)),
        "Task Status": label(t.status),
        "Created Date": fmtDate(g.created_at),
        Fee: t.fee ?? 0,
        "Invoice No": t.invoice_no ?? "",
      })),
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`jobs_${stamp}.csv`, dataToExport);
  };

  const s = (k: keyof typeof fl) => (e: { target: { value: string } }) =>
    setFl((p) => ({ ...p, [k]: e.target.value }));

  // Metrics
  const totalJobs = groups.length;
  const pendingJobs = groups.filter(
    (g) => jobDisplayStatus(g) === "pending" || g.status === "pending",
  ).length;
  const completedJobs = groups.filter((g) => g.status === "completed").length;
  const overdueJobsCount = groups.filter((g) => jobDisplayStatus(g) === "overdue").length;

  if (open) {
    return <JobForm open={open} onOpenChange={setOpen} />;
  }

  const toggleExpand = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Jobs"
        subtitle="Parent compliance jobs (task1 + task2 + ... bundles). For simplified individual tasks, see Tasks."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={!filteredGroups.length}
              className="h-9 text-xs gap-1.5 font-medium"
              title="Export filtered jobs to CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button variant="outline" asChild>
              <Link to="/tasks">
                View Tasks (simplified)
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

      {/* KPI Stats Cards */}
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

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 border-b p-2.5 sm:p-3">
          <div className="relative w-full sm:w-44 md:w-48 lg:w-52 shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search jobs, clients, tasks…"
              className="pl-8 pr-8 h-9 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <ChecklistFilter
            label="Status"
            options={[...JOB_STATUSES, "overdue"].map((x) => ({
              value: x,
              label: label(x),
            }))}
            selected={selectedStatuses}
            onChange={setSelectedStatuses}
            className="w-32"
          />
          {uniqueCompanies.length > 1 && (
            <NativeSelect value={fl.company} onChange={s("company")} className="w-32">
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
            className="w-36"
            allowClear
          />
          <NativeSelect value={fl.service} onChange={s("service")} className="w-32">
            <option value="">All services</option>
            {services.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={fl.staff} onChange={s("staff")} className="w-32">
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
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetAllFilters}
              className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
              title="Reset all filters"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted/60 font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="py-2.5 px-2 w-8"></th>
                <th className="py-2.5 px-3 min-w-[130px] whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setCodeSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    className="inline-flex items-center gap-1.5 hover:text-foreground font-semibold uppercase tracking-wider transition-colors cursor-pointer text-left select-none"
                    title={`Sorted by Job Code (${codeSortDir === "asc" ? "Ascending: JOB-001 → JOB-999" : "Descending: JOB-999 → JOB-001"}). Click to reverse.`}
                  >
                    <span>Job Code</span>
                    <ArrowUpDown className="h-3.5 w-3.5 text-primary shrink-0" />
                  </button>
                </th>
                <th className="py-2.5 px-4 min-w-[260px]">Tasks (combined)</th>
                <th className="py-2.5 px-3">Client</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Created</th>
                {/* Note: Due column removed per user request */}
                {canSeeAmounts("jobs") && (
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Fee</th>
                )}
                <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                <th className="py-2.5 px-3 min-w-[130px] whitespace-nowrap">Billing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredGroups.map((g) => {
                const isExpanded = !!expanded[g.key];
                const isCompleted = g.status === "completed";
                const firstTask = g.tasks[0];
                return (
                  <Fragment key={g.key}>
                    <tr
                      className="hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => toggleExpand(g.key)}
                    >
                      <td className="py-2.5 px-2 text-center">
                        {g.tasks.length > 1 ? (
                          isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={cn(
                            "font-mono text-xs font-semibold text-primary whitespace-nowrap",
                            isCompleted && "line-through text-primary/75",
                          )}
                        >
                          {g.job_code}
                        </span>
                        {g.tasks.length > 1 && (
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {g.tasks.length} tasks
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={cn(
                            "font-medium transition-all",
                            isCompleted
                              ? "line-through text-muted-foreground/75"
                              : "text-foreground",
                          )}
                        >
                          {g.title}
                        </span>
                        {g.company_name && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary/90">
                            <Building2 className="h-3 w-3 shrink-0" />
                            {g.company_name}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-muted-foreground">
                        {g.client_name ?? "-"}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(g.created_at)}
                      </td>
                      {canSeeAmounts("jobs") && (
                        <td className="py-2.5 px-3 text-right font-mono font-semibold whitespace-nowrap">
                          {inr(g.total_fee)}
                        </td>
                      )}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <StatusBadge status={jobDisplayStatus(g as any)} />
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {g.invoices && g.invoices.length > 0 ? (
                          <div
                            className="flex flex-wrap items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {g.invoices.map((inv) => (
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
                            {g.financial_status !== "closed" &&
                              g.tasks.some((t) => !t.invoices || t.invoices.length === 0) && (
                                <StatusBadge status={g.financial_status} />
                              )}
                          </div>
                        ) : (
                          <StatusBadge status={g.financial_status} />
                        )}
                      </td>
                    </tr>
                    {isExpanded && g.tasks.length > 1 && (
                      <tr className="bg-muted/20">
                        <td colSpan={canSeeAmounts("jobs") ? 8 : 7} className="p-0">
                          <div className="px-8 py-2 space-y-1">
                            {g.tasks.map((t) => (
                              <div
                                key={t.id}
                                className="flex flex-wrap items-center gap-3 rounded border bg-background px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/40"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate({ to: "/jobs/$id", params: { id: t.id } });
                                }}
                              >
                                <span
                                  className={cn(
                                    "font-mono text-[11px] font-semibold text-primary whitespace-nowrap",
                                    t.status === "completed" && "line-through text-primary/75",
                                  )}
                                >
                                  {t.job_code}
                                </span>
                                <span
                                  className={cn(
                                    "font-medium",
                                    t.status === "completed" &&
                                      "line-through text-muted-foreground/75",
                                  )}
                                >
                                  {t.title}
                                </span>
                                <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px]">
                                  {t.service_name ?? "-"}
                                </span>
                                {canSeeAmounts("jobs") && t.fee != null && (
                                  <span className="ml-auto font-mono">{inr(t.fee)}</span>
                                )}
                                {t.invoices && t.invoices.length > 0 ? (
                                  <div
                                    className="flex items-center gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {t.invoices.map((inv) => (
                                      <Link
                                        key={inv.id}
                                        to="/invoices/$id"
                                        params={{ id: inv.id }}
                                        className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted/70 hover:bg-muted border border-border/50 transition-colors whitespace-nowrap"
                                        title={`Invoice ${inv.invoice_no}`}
                                      >
                                        <span className="font-mono text-primary underline underline-offset-1">
                                          {inv.invoice_no}
                                        </span>
                                      </Link>
                                    ))}
                                  </div>
                                ) : (
                                  <StatusBadge
                                    status={t.financial_status}
                                    className="text-[10px] px-1.5 py-0"
                                  />
                                )}
                                <StatusBadge status={jobDisplayStatus(t)} />
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredGroups.length === 0 && (
                <tr>
                  <td
                    colSpan={canSeeAmounts("jobs") ? 8 : 7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No jobs match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
