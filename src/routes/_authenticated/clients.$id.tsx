/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, Phone, Pencil, Plus, ArrowLeft, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/app/DataTable";
import { Field, NativeSelect, StatCard, ConfirmDeleteDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientForm } from "@/components/app/ClientForm";
import { EntityAvatar } from "@/components/app/EntityAvatar";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { useCurrentFirm } from "@/hooks/use-firm";
import { usePermissions } from "@/hooks/use-permissions";
import { readList } from "@/lib/supabase-read";
import { firstDuePreview, monthLabel } from "@/lib/service-options";
import { cn } from "@/lib/utils";
import {
  errMsg,
  fmtDate,
  fmtDateTime,
  FREQS,
  inr,
  invoiceDisplayStatus,
  jobDisplayStatus,
  label,
  MODES,
  today,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clients/$id")({
  head: () => ({
    meta: [
      { title: "Client Profile — AJ's Chartered Desk" },
      { name: "description", content: "Client 360° profile." },
    ],
  }),
  component: ClientProfile,
});

function ClientProfile() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { isFinance, isManager } = useRoles();
  const { canEdit, canCreate, canDelete, canView } = usePermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canSeePayments = canView("payments");
  // Service assignments live on client_services, which answers to either the
  // Clients or the Recurring module in Postgres, so mirror that here.
  const canLinkService = canCreate("recurring") || canCreate("clients");
  const canEditService = canEdit("recurring") || canEdit("clients");
  const { data: profiles } = useProfiles();
  const pname = (u: string | null) =>
    profiles?.find((p) => p.id === u)?.full_name ?? (u ? "Staff" : "System");
  const [edit, setEdit] = useState(false);
  const [link, setLink] = useState(false);
  const qc = useQueryClient();

  const handleDeleteClient = async () => {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) {
      if (error.message.includes("violates foreign key") || (error as any).code === "23503") {
        toast.error(`Cannot delete client because they have active jobs, invoices, or payments.`);
      } else {
        toast.error(errMsg(error));
      }
    } else {
      toast.success("Client deleted successfully");
      qc.invalidateQueries({ queryKey: ["clients"] });
      navigate({ to: "/clients" });
    }
  };

  const q = useQuery({
    queryKey: ["client360", id, isFinance, isManager, canSeePayments],
    queryFn: async () => {
      const c = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
      if (c.error) throw c.error;
      // Both go through RPCs so fee/net_amount arrive blank unless this user
      // holds the matching "amounts" grant. readList falls back to the current
      // RLS policies when the permissions migration has not been applied.
      const [cs, jobs] = await Promise.all([
        readList("client_services_list", { _client_id: id }, async () => {
          const r = await supabase
            .from("client_services")
            .select(
              "id,client_id,service_id,agreed_fee,frequency,start_date,end_date,due_days,assigned_staff,status,notes,created_at,services(name,service_type,auto_invoice),profiles!client_services_assigned_staff_fkey(full_name)",
            )
            .eq("client_id", id)
            .order("created_at");
          if (r.error) return { data: null, error: r.error };
          return {
            data: (r.data ?? []).map((x) => ({
              id: x.id,
              client_id: x.client_id,
              service_id: x.service_id,
              service_name: x.services?.name ?? null,
              service_type: x.services?.service_type ?? null,
              auto_invoice: x.services?.auto_invoice ?? null,
              agreed_fee: x.agreed_fee,
              frequency: x.frequency,
              start_date: x.start_date,
              end_date: x.end_date,
              due_days: x.due_days,
              assigned_staff: x.assigned_staff,
              assigned_staff_name: x.profiles?.full_name ?? null,
              status: x.status,
              notes: x.notes,
              created_at: x.created_at,
            })),
            error: null,
          };
        }),
        readList("client_jobs_list", { _client_id: id }, async () => {
          const r = await supabase
            .from("jobs")
            .select(
              "id,job_code,client_id,service_id,title,period_start,period_end,fee,discount,net_amount,due_date,assigned_staff,status,financial_status,notes,auto_invoice,created_at,services(name),profiles!jobs_assigned_staff_fkey(full_name),invoice_items(invoice_id,invoices(id,invoice_no,status))",
            )
            .eq("client_id", id)
            .order("job_code", { ascending: true });
          if (r.error) return { data: null, error: r.error };
          return {
            data: (r.data ?? []).map((j) => {
              const invsMap = new Map<string, { id: string; invoice_no: string; status: string }>();
              if (Array.isArray(j.invoice_items)) {
                for (const item of j.invoice_items as any[]) {
                  if (item?.invoices?.id) {
                    invsMap.set(item.invoices.id, item.invoices);
                  }
                }
              }
              const connectedInvs = Array.from(invsMap.values());
              const inv = connectedInvs[0] ?? null;
              return {
                ...j,
                service_name: j.services?.name ?? null,
                assigned_staff_name: j.profiles?.full_name ?? null,
                invoices: connectedInvs,
                invoice_id: inv?.id ?? null,
                invoice_no: inv?.invoice_no ?? null,
                invoice_status: inv?.status ?? null,
              };
            }),
            error: null,
          };
        }),
      ]);
      let invoices: Awaited<ReturnType<typeof fetchInv>> = [];
      let payments: Awaited<ReturnType<typeof fetchPay>> = [];
      if (isFinance) invoices = await fetchInv(id);
      if (isFinance || canSeePayments) payments = await fetchPay(id);
      let activity: {
        id: number;
        action: string;
        module: string;
        created_at: string;
        record_id: string | null;
        user_id: string | null;
        reason: string | null;
      }[] = [];
      if (isManager) {
        const ids = [
          id,
          ...cs.map((s) => s.id),
          ...jobs.map((j) => j.id),
          ...invoices.map((i) => i.id),
          ...payments.map((p) => p.id),
        ];
        const a = await supabase
          .from("audit_logs")
          .select("id,action,module,created_at,record_id,user_id,reason")
          .in("record_id", ids)
          .order("created_at", { ascending: false })
          .limit(100);
        activity = (a.data as typeof activity) ?? [];
      }
      return {
        client: c.data,
        cs,
        jobs,
        invoices,
        payments,
        activity,
      };
    },
  });

  const toggleCs = async (csId: string, status: string) => {
    const { error } = await supabase.from("client_services").update({ status }).eq("id", csId);
    if (error) return toast.error(errMsg(error));
    toast.success(`Service ${status}`);
    qc.invalidateQueries({ queryKey: ["client360"] });
  };
  const toggleCsAutoInvoice = async (csId: string, current: boolean) => {
    const { error } = await supabase
      .from("client_services")
      .update({ auto_invoice: !current })
      .eq("id", csId);
    if (error) return toast.error(errMsg(error));
    toast.success(!current ? "Auto-invoicing enabled" : "Auto-invoicing disabled");
    qc.invalidateQueries({ queryKey: ["client360"] });
  };

  const d = q.data;
  if (q.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!d?.client)
    return (
      <div className="space-y-4">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Clients</span>
        </Link>
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          Client not found or you do not have permission to access this record.
        </div>
      </div>
    );
  const c = d.client;
  const live = d.invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
  const out = live.filter((i) => Number(i.outstanding) > 0);

  // Editing takes over the whole content area; sidebar stays visible.
  if (edit) return <ClientForm open onOpenChange={setEdit} client={c} />;

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Clients</span>
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <EntityAvatar name={c.name} src={c.avatar_url} className="h-16 w-16 text-xl" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{c.name}</h1>
              <StatusBadge status={c.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="font-mono">{c.client_code}</span>
              {c.mobile && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {c.mobile}
                </span>
              )}
              {c.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  {c.email}
                </span>
              )}
              {c.pan && <span>PAN {c.pan}</span>}
              {c.gstin && <span>GSTIN {c.gstin}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit("clients") && (
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil className="mr-1 h-4 w-4" />
              Edit
            </Button>
          )}
          {canDelete("clients") && (
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete Client
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          {isFinance && (
            <>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
            </>
          )}
          {canSeePayments && <TabsTrigger value="payments">Payments</TabsTrigger>}
          {isManager && <TabsTrigger value="activity">Activity</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total Jobs" value={d.jobs.length} />
            <StatCard
              label="Completed"
              value={d.jobs.filter((j) => j.status === "completed").length}
              tone="success"
            />
            <StatCard
              label="Pending"
              value={
                d.jobs.filter((j) => ["pending", "in_progress", "on_hold"].includes(j.status))
                  .length
              }
              tone="warning"
            />
            <StatCard
              label="Overdue"
              value={d.jobs.filter((j) => jobDisplayStatus(j) === "overdue").length}
              tone="danger"
            />
            {isFinance && (
              <>
                <StatCard
                  label="Total Invoiced"
                  value={inr(live.reduce((s, i) => s + Number(i.total), 0))}
                  tone="info"
                />
                <StatCard
                  label="Total Paid"
                  value={inr(live.reduce((s, i) => s + Number(i.amount_paid), 0))}
                  tone="success"
                />
                <StatCard
                  label="Outstanding"
                  value={inr(live.reduce((s, i) => s + Number(i.outstanding), 0))}
                  tone="danger"
                />
                <StatCard
                  label="Unallocated"
                  value={
                    d.payments.every((p) => p.amount == null)
                      ? "—"
                      : inr(
                          d.payments
                            .filter((p) => p.status !== "reversed")
                            .reduce((s, p) => s + Number(p.amount) - Number(p.allocated_amount), 0),
                        )
                  }
                  tone="warning"
                />
              </>
            )}
          </div>
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Contacts
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">Phone Number</div>
                  <div className="font-medium">{c.mobile || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Secondary Phone</div>
                  <div className="font-medium">{c.secondary_phone || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Email</div>
                  <div className="truncate font-medium">{c.email || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Primary Concerned Person</div>
                  <div className="font-medium">{c.contact_person_name || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Role</div>
                  <div className="font-medium">{c.contact_person_role || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Concerned Person's Phone</div>
                  <div className="font-medium">{c.contact_person_phone || "—"}</div>
                </div>
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
              {[
                ["Type", c.client_type],
                ["GST Type", c.gst_type],
                ["Business", c.business_type],
                ["Industry", c.industry],
                ["TAN", c.tan],
                ["Address", c.address],
                ["Notes", c.notes],
                ["Created", fmtDate(c.created_at)],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs text-muted-foreground">{k}</div>
                  <div>{v || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="services" className="mt-4">
          <DataTable
            rows={d.cs}
            empty="No services linked to this client."
            toolbar={
              canLinkService && (
                <Button size="sm" className="ml-auto" onClick={() => setLink(true)}>
                  <Plus className="mr-1 h-4 w-4" />
                  Link Service
                </Button>
              )
            }
            columns={[
              {
                key: "s",
                header: "Service",
                render: (r) => <span className="font-medium">{r.service_name}</span>,
              },
              { key: "f", header: "Frequency", render: (r) => FREQS[r.frequency] },
              {
                key: "fee",
                header: "Agreed Fee",
                align: "right",
                render: (r) => (r.agreed_fee == null ? "—" : inr(r.agreed_fee)),
              },
              { key: "sd", header: "Start", render: (r) => fmtDate(r.start_date) },
              { key: "ed", header: "End", render: (r) => fmtDate(r.end_date) },
              { key: "dd", header: "Due", render: (r) => `${r.due_days} days after period` },
              {
                key: "ai",
                header: "Auto-Invoice",
                render: (r) =>
                  canEditService ? (
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => toggleCsAutoInvoice(r.id, !!r.auto_invoice)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${r.auto_invoice ? "bg-primary" : "bg-muted-foreground/30"}`}
                        title={
                          r.auto_invoice
                            ? "Auto-invoicing ON: click to turn off"
                            : "Auto-invoicing OFF: click to turn on"
                        }
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${r.auto_invoice ? "translate-x-4" : "translate-x-0"}`}
                        />
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.auto_invoice ? "bg-sky-500/10 text-sky-600" : "text-muted-foreground"}`}
                    >
                      {r.auto_invoice ? "Yes" : "No"}
                    </span>
                  ),
              },
              { key: "st", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              {
                key: "a",
                header: "",
                render: (r) =>
                  canEditService && (
                    <div className="flex gap-1">
                      {r.status === "active" ? (
                        <Button size="sm" variant="ghost" onClick={() => toggleCs(r.id, "paused")}>
                          Pause
                        </Button>
                      ) : r.status === "paused" ? (
                        <Button size="sm" variant="ghost" onClick={() => toggleCs(r.id, "active")}>
                          Resume
                        </Button>
                      ) : null}
                      {r.status !== "stopped" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => toggleCs(r.id, "stopped")}
                        >
                          Stop
                        </Button>
                      )}
                    </div>
                  ),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="jobs" className="mt-4">
          <DataTable
            rows={d.jobs}
            empty="No jobs for this client."
            defaultSortKey="job_code"
            defaultSortDir={1}
            search={(j) => `${j.job_code} ${j.title}`}
            columns={[
              {
                key: "job_code",
                header: "Job",
                className: "whitespace-nowrap min-w-[110px]",
                sort: (j) => j.job_code,
                render: (j) => (
                  <Link
                    to="/jobs/$id"
                    params={{ id: j.id }}
                    className="font-mono text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                  >
                    {j.job_code}
                  </Link>
                ),
              },
              { key: "title", header: "Title" },
              {
                key: "created",
                header: "Created Date",
                sort: (j) => j.created_at ?? "",
                render: (j) => (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(j.created_at)}
                  </span>
                ),
              },
              {
                key: "due",
                header: "Due",
                sort: (j) => j.due_date ?? "",
                render: (j) => fmtDate(j.due_date),
              },
              {
                key: "net",
                header: "Net",
                align: "right",
                render: (j) => (j.net_amount == null ? "—" : inr(j.net_amount)),
              },
              {
                key: "st",
                header: "Status",
                render: (j) => <StatusBadge status={jobDisplayStatus(j)} />,
              },
              {
                key: "fs",
                header: "Billing",
                className: "whitespace-nowrap min-w-[130px]",
                render: (j) => {
                  const invList = (j as any).invoices as
                    Array<{ id: string; invoice_no: string; status: string }> | undefined;
                  if (invList && invList.length > 0) {
                    return (
                      <div
                        className="flex flex-wrap items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {invList.map((inv) => (
                          <Link
                            key={inv.id}
                            to="/invoices/$id"
                            params={{ id: inv.id }}
                            className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/60 hover:bg-muted border border-border/50 transition-colors whitespace-nowrap"
                            title={`Click to open Invoice ${inv.invoice_no}`}
                          >
                            <StatusBadge
                              status={
                                j.financial_status === "closed" ? "paid" : inv.status || "invoiced"
                              }
                            />
                            <span className="font-mono text-[11px] text-primary underline underline-offset-2 group-hover:text-primary/80 whitespace-nowrap">
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
                  return (
                    <div className="inline-flex items-center gap-1.5">
                      <StatusBadge status={j.financial_status} />
                      {j.auto_invoice && (
                        <span
                          className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400"
                          title="Auto-invoice enabled on completion"
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
        </TabsContent>

        {isFinance && (
          <>
            <TabsContent value="invoices" className="mt-4">
              <InvTable rows={d.invoices} />
            </TabsContent>
            <TabsContent value="outstanding" className="mt-4">
              <InvTable rows={out} empty="Nothing outstanding — all settled." />
              {out.length > 0 && (
                <div className="mt-2 text-right text-sm font-semibold">
                  Total outstanding: {inr(out.reduce((s, i) => s + Number(i.outstanding), 0))}
                </div>
              )}
            </TabsContent>
          </>
        )}

        {canSeePayments && (
          <TabsContent value="payments" className="mt-4">
            <DataTable
              rows={d.payments}
              empty="No payments from this client."
              columns={[
                { key: "payment_code", header: "Payment", className: "font-mono text-xs" },
                { key: "d", header: "Date", render: (p) => fmtDate(p.payment_date) },
                { key: "m", header: "Mode", render: (p) => MODES[p.mode] },
                { key: "reference", header: "Reference" },
                {
                  key: "a",
                  header: "Amount",
                  align: "right",
                  render: (p) => (p.amount == null ? "—" : inr(p.amount)),
                },
                {
                  key: "al",
                  header: "Allocated",
                  align: "right",
                  render: (p) => (p.allocated_amount == null ? "—" : inr(p.allocated_amount)),
                },
                { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
              ]}
            />
          </TabsContent>
        )}

        {isManager && (
          <TabsContent value="activity" className="mt-4">
            <DataTable
              rows={d.activity}
              empty="No activity recorded yet for this client."
              columns={[
                { key: "t", header: "Timestamp", render: (a) => fmtDateTime(a.created_at) },
                {
                  key: "user",
                  header: "Done By",
                  render: (a) => (
                    <span className="font-medium text-foreground">{pname(a.user_id)}</span>
                  ),
                },
                {
                  key: "action",
                  header: "Action",
                  render: (a) => (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                        a.action === "insert" &&
                          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        a.action === "update" && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                        a.action === "delete" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                        !["insert", "update", "delete"].includes(a.action) &&
                          "bg-muted text-muted-foreground",
                      )}
                    >
                      {a.action === "insert"
                        ? "Created"
                        : a.action === "update"
                          ? "Updated"
                          : a.action === "delete"
                            ? "Deleted"
                            : label(a.action)}
                    </span>
                  ),
                },
                {
                  key: "module",
                  header: "Area",
                  render: (a) => <span className="capitalize">{label(a.module)}</span>,
                },
                {
                  key: "details",
                  header: "Notes / Details",
                  render: (a) =>
                    a.reason ? (
                      <span className="text-xs italic text-muted-foreground">{a.reason}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          </TabsContent>
        )}
      </Tabs>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete Client "${c.name}"?`}
        description="Are you sure you want to permanently delete this client? Clients with financial records (invoices, jobs, or payments) cannot be deleted."
        onConfirm={handleDeleteClient}
      />

      <LinkServiceDialog open={link} onOpenChange={setLink} clientId={id} />
    </div>
  );
}

const fetchInv = async (id: string) => {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("client_id", id)
    .order("invoice_date", { ascending: false });
  if (error) throw error;
  return data;
};
// Via the RPC so `amount` arrives blank unless the caller holds the payments
// amounts grant; reading the table directly would ship every figure.
const fetchPay = async (id: string) =>
  readList("client_payments_list", { _client_id: id }, async () => {
    const r = await supabase
      .from("payments")
      .select(
        "id,payment_code,client_id,job_id,amount,allocated_amount,mode,payment_date,reference,narration,status,created_at",
      )
      .eq("client_id", id)
      .order("payment_date", { ascending: false });
    if (r.error) return { data: null, error: r.error };
    return { data: r.data ?? [], error: null };
  });

function InvTable({
  rows,
  empty = "No invoices.",
}: {
  rows: Awaited<ReturnType<typeof fetchInv>>;
  empty?: string;
}) {
  return (
    <DataTable
      rows={rows}
      empty={empty}
      columns={[
        {
          key: "n",
          header: "Invoice",
          render: (i) => (
            <Link
              to="/invoices/$id"
              params={{ id: i.id }}
              className="font-mono text-xs text-primary hover:underline"
            >
              {i.invoice_no}
            </Link>
          ),
        },
        { key: "d", header: "Date", render: (i) => fmtDate(i.invoice_date) },
        { key: "dd", header: "Due", render: (i) => fmtDate(i.due_date) },
        { key: "t", header: "Total", align: "right", render: (i) => inr(i.total) },
        { key: "p", header: "Paid", align: "right", render: (i) => inr(i.amount_paid) },
        { key: "o", header: "Outstanding", align: "right", render: (i) => inr(i.outstanding) },
        {
          key: "s",
          header: "Status",
          render: (i) => <StatusBadge status={invoiceDisplayStatus(i)} />,
        },
      ]}
    />
  );
}

function LinkServiceDialog({
  open,
  onOpenChange,
  clientId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
}) {
  const qc = useQueryClient();
  const { data: currentFirm } = useCurrentFirm();
  const { data: profiles } = useProfiles();
  const svcs = useQuery({
    queryKey: ["services-active", currentFirm?.id],
    queryFn: async () => {
      let query = supabase.from("services").select("*").eq("active", true).order("name");
      if (currentFirm?.id) {
        query = query.eq("firm_id", currentFirm.id);
      }
      return (await query).data ?? [];
    },
    enabled: Boolean(currentFirm?.id),
  });
  const [f, setF] = useState({
    service_id: "",
    agreed_fee: "",
    frequency: "monthly",
    start_date: today(),
    end_date: "",
    due_days: "20",
    assigned_staff: "",
    notes: "",
    auto_invoice: false,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const pick = (sid: string) => {
    const s = svcs.data?.find((x) => x.id === sid);
    // Fees and due-day rules now live on the assignment, so nothing is prefilled
    // from the service beyond its cycle and its auto-invoice default.
    setF((p) => ({
      ...p,
      service_id: sid,
      frequency: s?.frequency === "one_time" ? "one_time" : "monthly",
      auto_invoice: s?.auto_invoice ?? false,
    }));
  };

  // Preview of the first job this assignment produces. Mirrors
  // generate_recurring_jobs_for_firm, so what is shown is what gets created.
  const preview = firstDuePreview(f.start_date, f.frequency, Number(f.due_days) || 0);

  const save = async () => {
    if (!f.service_id) return toast.error("Choose a service");
    if (!(Number(f.agreed_fee) >= 0) || f.agreed_fee === "")
      return toast.error("Enter a valid fee");
    if (f.end_date && f.end_date < f.start_date)
      return toast.error("End date must be after start date");

    // Prevent adding duplicate recurring service to the same client
    const { data: existingCs } = await supabase
      .from("client_services")
      .select("id, status")
      .eq("client_id", clientId)
      .eq("service_id", f.service_id)
      .neq("status", "stopped")
      .maybeSingle();

    if (existingCs) {
      return toast.error(
        "This recurring service is already assigned to this client. You cannot add the same recurring schedule twice.",
      );
    }

    const { error } = await supabase.from("client_services").insert({
      client_id: clientId,
      service_id: f.service_id,
      agreed_fee: Number(f.agreed_fee),
      frequency: f.frequency,
      start_date: f.start_date,
      end_date: f.end_date || null,
      due_days: Number(f.due_days) || 0,
      assigned_staff: f.assigned_staff || null,
      notes: f.notes || null,
      auto_invoice: f.auto_invoice,
    });
    if (error) return toast.error(errMsg(error));

    try {
      await supabase.rpc("generate_recurring_jobs", { _upto: today() });
    } catch {
      // non-fatal
    }
    toast.success("Service linked and recurring job populated");
    qc.invalidateQueries({ queryKey: ["client360"] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["client-services"] });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link Service to Client</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service *" className="sm:col-span-2">
            <NativeSelect value={f.service_id} onChange={(e) => pick(e.target.value)}>
              <option value="">Select…</option>
              {svcs.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Agreed Fee (₹) *">
            <Input type="number" min={0} value={f.agreed_fee} onChange={set("agreed_fee")} />
          </Field>
          <Field label="Frequency">
            <NativeSelect value={f.frequency} onChange={set("frequency")}>
              {Object.entries(FREQS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Start Date">
            <Input type="date" value={f.start_date} onChange={set("start_date")} />
          </Field>
          <Field label="End Date">
            <Input type="date" value={f.end_date} onChange={set("end_date")} />
          </Field>
          <Field label="Due (days after period end)">
            <Input type="number" min={0} value={f.due_days} onChange={set("due_days")} />
          </Field>
          {preview && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-xs sm:col-span-2">
              <div className="mb-1 font-medium text-foreground">First job this will create</div>
              <div className="text-muted-foreground">
                {f.frequency === "one_time" ? (
                  <>
                    One-time job on{" "}
                    <span className="font-mono">{fmtDate(preview.periodStart)}</span>
                  </>
                ) : (
                  <>
                    Period{" "}
                    <span className="font-medium text-foreground">
                      {monthLabel(preview.periodStart)} ({fmtDate(preview.periodStart)} to{" "}
                      {fmtDate(preview.periodEnd)})
                    </span>
                  </>
                )}{" "}
                &rarr; due{" "}
                <span className="font-medium text-foreground">{fmtDate(preview.dueDate)}</span>
              </div>
            </div>
          )}
          <Field label="Assigned Staff">
            <NativeSelect value={f.assigned_staff} onChange={set("assigned_staff")}>
              <option value="">—</option>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ?? p.email}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-2 rounded-md border p-2.5 bg-muted/20 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Invoicing Policy:</span> Invoices are
            generated upon recording or clearing client payment against tasks.
          </div>
          <Field label="Notes" className="sm:col-span-2">
            <Input value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
