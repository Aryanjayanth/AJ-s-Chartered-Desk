import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  LayoutGrid,
  List,
  Mail,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  UserRound,
  X,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/app/DataTable";
import { ChipFilterRow, ChipSelect, PageHeader, ConfirmDeleteDialog, type ChipOption } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientForm } from "@/components/app/ClientForm";
import { EntityAvatar } from "@/components/app/EntityAvatar";
import { useProfiles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import {
  CLIENT_STATUSES,
  CLIENT_TYPES,
  GST_TYPES,
  STANDARD_INDUSTRIES,
  optionValues,
  uniqSorted,
} from "@/lib/client-options";
import { downloadCsv, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({
    meta: [
      { title: "Clients — CA PracticeDesk" },
      { name: "description", content: "Client master." },
    ],
  }),
  component: ClientsPage,
});

type Filters = {
  term: string;
  clientType: string;
  status: string;
  industry: string;
  staff: string;
  gstType: string;
  from: string;
  to: string;
};

const NO_FILTERS: Filters = {
  term: "",
  clientType: "",
  status: "",
  industry: "",
  staff: "",
  gstType: "",
  from: "",
  to: "",
};

/** Everything a user might plausibly search a client by, in one place. */
const haystack = (c: Record<string, unknown>) =>
  [
    c.name,
    c.client_code,
    c.client_type,
    c.status,
    c.industry,
    c.business_type,
    c.pan,
    c.tan,
    c.gstin,
    c.gst_type,
    c.mobile,
    c.secondary_phone,
    c.email,
    c.address,
    c.notes,
    c.contact_person_name,
    c.contact_person_phone,
    c.contact_person_role,
  ]
    .map((v) => String(v ?? ""))
    .join(" ")
    .toLowerCase();

const toChips = (vals: string[]): ChipOption<string>[] => vals.map((v) => ({ value: v, label: v }));

/** Label every chip with how many clients carry that value. */
const tally = (vals: Array<string | null | undefined>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of vals) {
    const k = String(v ?? "").trim();
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

function ClientsPage() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [showFilters, setShowFilters] = useState(false);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [clientToDelete, setClientToDelete] = useState<{ id: string; name: string } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canCreate, canDelete } = usePermissions();
  const { data: profiles } = useProfiles();
  const pname = useCallback(
    (id: string | null) => profiles?.find((p) => p.id === id)?.full_name ?? "—",
    [profiles],
  );

  const handleDeleteClient = async (id: string, name: string) => {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) {
      if (error.message.includes("violates foreign key") || (error as any).code === "23503") {
        toast.error(`Cannot delete "${name}" because they have active jobs, invoices, or payments.`);
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success(`Client "${name}" deleted successfully`);
      qc.invalidateQueries({ queryKey: ["clients"] });
    }
  };

  const q = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const all = useMemo(() => q.data ?? [], [q.data]);

  const set = (k: keyof Filters) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  // Canonical option sets first, so every choice is offered even before any client
  // uses it; values that exist only in the data (custom industries, new statuses)
  // are appended so nothing becomes unfilterable.
  const options = useMemo(
    () => ({
      clientType: toChips(
        optionValues(
          CLIENT_TYPES,
          all.map((c) => c.client_type),
        ),
      ),
      status: CLIENT_STATUSES.map((s) => ({ ...s })),
      industry: toChips(
        optionValues(
          STANDARD_INDUSTRIES,
          all.map((c) => c.industry ?? c.business_type),
        ),
      ),
      gstType: toChips(
        optionValues(
          GST_TYPES,
          all.map((c) => c.gst_type),
        ),
      ),
      staff: [
        { value: "__unassigned", label: "Unassigned" },
        ...uniqSorted(all.map((c) => c.assigned_staff)).map((id) => ({
          value: id,
          label: pname(id) === "—" ? "Unknown staff" : pname(id),
        })),
      ],
    }),
    [all, pname],
  );

  // Counts per option value so an empty filter choice is visibly empty.
  const counts = useMemo(
    () => ({
      clientType: tally(all.map((c) => c.client_type)),
      status: tally(all.map((c) => c.status)),
      industry: tally(all.map((c) => c.industry ?? c.business_type)),
      gstType: tally(all.map((c) => c.gst_type)),
      staff: tally([
        ...all.filter((c) => !c.assigned_staff).map(() => "__unassigned"),
        ...all.map((c) => c.assigned_staff),
      ]),
    }),
    [all],
  );

  const rows = useMemo(() => {
    const term = f.term.trim().toLowerCase();
    return all.filter((c) => {
      if (term && !haystack(c).includes(term)) return false;
      if (f.clientType && c.client_type !== f.clientType) return false;
      if (f.status && c.status !== f.status) return false;
      if (f.industry && (c.industry ?? c.business_type) !== f.industry) return false;
      if (f.gstType && c.gst_type !== f.gstType) return false;
      if (f.staff === "__unassigned" && c.assigned_staff) return false;
      if (f.staff && f.staff !== "__unassigned" && c.assigned_staff !== f.staff) return false;
      if (f.from && c.created_at && String(c.created_at).slice(0, 10) < f.from) return false;
      if (f.to && c.created_at && String(c.created_at).slice(0, 10) > f.to) return false;
      return true;
    });
  }, [all, f]);

  const activeCount = useMemo(
    () =>
      (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter((k) => k !== "term" && !!f[k]).length,
    [f],
  );

  const go = (id: string) => navigate({ to: "/clients/$id", params: { id } });

  const toggle = (
    <div className="flex rounded-md border p-0.5">
      <Button
        size="sm"
        variant={view === "cards" ? "secondary" : "ghost"}
        className="h-8 px-2"
        onClick={() => setView("cards")}
        aria-label="Card view"
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant={view === "table" ? "secondary" : "ghost"}
        className="h-8 px-2"
        onClick={() => setView("table")}
        aria-label="Table view"
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );

  // While the form is open it replaces the list entirely, so it gets the whole
  // content area to itself while the sidebar stays put.
  return open ? (
    <ClientForm open={open} onOpenChange={setOpen} />
  ) : (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Clients"
        subtitle={
          activeCount || f.term
            ? `${rows.length} of ${all.length} clients match`
            : `${all.length} client${all.length === 1 ? "" : "s"} in your practice`
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 font-medium"
              disabled={!rows.length}
              onClick={() => {
                const stamp = new Date().toISOString().slice(0, 10);
                downloadCsv(
                  `clients_${stamp}.csv`,
                  rows.map((c) => ({
                    "Client Code": c.client_code,
                    "Name": c.name,
                    "Client Type": c.client_type,
                    "Status": c.status,
                    "Mobile": c.mobile,
                    "Secondary Phone": c.secondary_phone ?? "",
                    "Email": c.email ?? "",
                    "PAN": c.pan ?? "",
                    "TAN": c.tan ?? "",
                    "GSTIN": c.gstin ?? "",
                    "GST Type": c.gst_type ?? "",
                    "Industry": c.industry ?? c.business_type ?? "",
                    "Contact Person": c.contact_person_name ?? "",
                    "Contact Phone": c.contact_person_phone ?? "",
                    "Contact Role": c.contact_person_role ?? "",
                    "Assigned Staff": pname(c.assigned_staff),
                    "Address": c.address,
                  })),
                );
              }}
              title="Export filtered clients to CSV"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            {toggle}
            {canCreate("clients") && (
              <Button onClick={() => setOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Add Client
              </Button>
            )}
          </>
        }
      />

      {/* Unified search + filters — one term drives both card and table views */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 pr-9"
              placeholder="Search name, code, PAN, GSTIN, phone, address, contact…"
              value={f.term}
              onChange={(e) => set("term")(e.target.value)}
            />
            {f.term && (
              <button
                type="button"
                onClick={() => set("term")("")}
                className="absolute right-2.5 top-2.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters || activeCount ? "secondary" : "outline"}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal className="mr-1 h-4 w-4" />
            Filters
            {activeCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
          {(activeCount > 0 || f.term) && (
            <Button variant="ghost" size="sm" onClick={() => setF(NO_FILTERS)}>
              Clear all
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="rounded-lg border bg-card">
            <ChipFilterRow label="Type">
              <ChipSelect
                allowEmpty
                emptyLabel="All types"
                ariaLabel="Filter by client type"
                value={f.clientType}
                onChange={set("clientType")}
                options={options.clientType}
                counts={counts.clientType}
              />
            </ChipFilterRow>
            <ChipFilterRow label="Status">
              <ChipSelect
                allowEmpty
                emptyLabel="All statuses"
                ariaLabel="Filter by status"
                value={f.status}
                onChange={set("status")}
                options={options.status}
                counts={counts.status}
              />
            </ChipFilterRow>
            <ChipFilterRow label="Industry">
              <ChipSelect
                allowEmpty
                emptyLabel="All industries"
                ariaLabel="Filter by industry"
                value={f.industry}
                onChange={set("industry")}
                options={options.industry}
                counts={counts.industry}
              />
            </ChipFilterRow>
            <ChipFilterRow label="GST Type">
              <ChipSelect
                allowEmpty
                emptyLabel="All GST types"
                ariaLabel="Filter by GST type"
                value={f.gstType}
                onChange={set("gstType")}
                options={options.gstType}
                counts={counts.gstType}
              />
            </ChipFilterRow>
            <ChipFilterRow label="Assigned Staff">
              <ChipSelect
                allowEmpty
                emptyLabel="All staff"
                ariaLabel="Filter by assigned staff"
                value={f.staff}
                onChange={set("staff")}
                options={options.staff}
                counts={counts.staff}
              />
            </ChipFilterRow>
            <ChipFilterRow label="Onboarded Date">
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={f.from}
                  onChange={(e) => set("from")(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={f.to}
                  onChange={(e) => set("to")(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
                {(f.from || f.to) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    onClick={() => setF((p) => ({ ...p, from: "", to: "" }))}
                  >
                    Clear dates
                  </Button>
                )}
              </div>
            </ChipFilterRow>
          </div>
        )}
      </div>

      {q.isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : view === "cards" ? (
        rows.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              {all.length === 0
                ? "No clients yet — add your first client."
                : "No clients match your search or filters."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((c) => (
              <Card
                key={c.id}
                className="cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => go(c.id)}
              >
                <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                  <EntityAvatar name={c.name} src={c.avatar_url} className="h-16 w-16 text-xl" />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.client_type} · <span className="font-mono">{c.client_code}</span>
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                  <div className="w-full space-y-1 border-t pt-3 text-xs text-muted-foreground">
                    {(c.contact_person_name || c.contact_person_phone) && (
                      <div className="flex items-center justify-center gap-1.5 truncate">
                        <UserRound className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {[c.contact_person_name, c.contact_person_role, c.contact_person_phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    )}
                    {c.mobile && (
                      <div className="flex items-center justify-center gap-1.5">
                        <Phone className="h-3 w-3" />
                        {c.mobile}
                      </div>
                    )}
                    {c.email && (
                      <div className="flex items-center justify-center gap-1.5 truncate">
                        <Mail className="h-3 w-3" />
                        {c.email}
                      </div>
                    )}
                    <div>Staff: {pname(c.assigned_staff)}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <DataTable
          rows={rows}
          loading={q.isLoading}
          empty={
            all.length === 0
              ? "No clients yet — add your first client."
              : "No clients match your search or filters."
          }
          pageSize={20}
          exportFilename="clients"
          onRowClick={(c) => go(c.id)}
          columns={[
            {
              key: "name",
              header: "Client",
              sort: (c) => c.name,
              render: (c) => (
                <span className="flex items-center gap-2 font-medium">
                  <EntityAvatar name={c.name} src={c.avatar_url} className="h-7 w-7 text-xs" />
                  {c.name}
                </span>
              ),
            },
            {
              key: "client_code",
              header: "ID",
              className: "font-mono text-xs",
              sort: (c) => Number(String(c.client_code).replace(/\D/g, "")) || 0,
            },
            { key: "client_type", header: "Type" },
            { key: "pan", header: "PAN", className: "font-mono text-xs" },
            {
              key: "contact_person_name",
              header: "Concerned Person",
              render: (c) =>
                c.contact_person_name || c.contact_person_phone ? (
                  <span className="block">
                    <span className="block font-medium">{c.contact_person_name ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[c.contact_person_role, c.contact_person_phone]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            {
              key: "mobile",
              header: "Phone",
              render: (c) => (
                <span className="block">
                  <span className="block">{c.mobile}</span>
                  {c.secondary_phone && (
                    <span className="block text-xs text-muted-foreground">{c.secondary_phone}</span>
                  )}
                </span>
              ),
            },
            { key: "staff", header: "Staff", render: (c) => pname(c.assigned_staff) },
            { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
            {
              key: "created_at",
              header: "Created",
              sort: (c) => c.created_at,
              render: (c) => fmtDate(c.created_at),
            },
            ...(canDelete("clients")
              ? [
                  {
                    key: "actions",
                    header: "",
                    className: "w-10 text-center",
                    render: (c: any) => (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Delete client"
                        onClick={(e) => {
                          e.stopPropagation();
                          setClientToDelete({ id: c.id, name: c.name });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      <ConfirmDeleteDialog
        open={Boolean(clientToDelete)}
        onOpenChange={(open) => !open && setClientToDelete(null)}
        title={`Delete Client "${clientToDelete?.name ?? ""}"?`}
        description="Are you sure you want to permanently delete this client? Clients with financial records (invoices, jobs, or payments) cannot be deleted."
        onConfirm={async () => {
          if (clientToDelete) {
            await handleDeleteClient(clientToDelete.id, clientToDelete.name);
          }
        }}
      />
    </div>
  );
}
