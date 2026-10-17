/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Plus, X, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/app/DataTable";
import {
  ChipSelect,
  Field,
  FormScreen,
  NativeSelect,
  PageHeader,
  Section,
  ConfirmDeleteDialog,
  type ChipOption,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentFirm, useUserFirms } from "@/hooks/use-firm";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { RECURRING_FREQS, SERVICE_TYPES } from "@/lib/service-options";
import { fetchFirmServices } from "@/lib/standard-services";

export const Route = createFileRoute("/_authenticated/services")({
  head: () => ({
    meta: [
      { title: "Services — CA PracticeDesk" },
      { name: "description", content: "Service master." },
    ],
  }),
  component: ServicesPage,
});

type Svc = Tables<"services">;
type Option = ChipOption<string>;

const toChips = (vals: readonly string[]): Option[] => vals.map((v) => ({ value: v, label: v }));

const TYPE_OPTIONS = toChips(SERVICE_TYPES);
const FREQ_OPTIONS: Option[] = RECURRING_FREQS.map((f) => ({ value: f.value, label: f.label }));

const FREQ_LABEL: Record<string, string> = Object.fromEntries(
  RECURRING_FREQS.map((f) => [f.value, f.label]),
);

const Req = () => <span className="ml-0.5 font-semibold text-destructive">*</span>;

function ServicesPage() {
  const { canCreate, canEdit, canDelete } = usePermissions();
  const qc = useQueryClient();
  const { data: userFirms } = useUserFirms();
  const [editing, setEditing] = useState<Svc | "new" | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<Svc | null>(null);

  const handleDeleteService = async (service: Svc) => {
    const { error } = await supabase.from("services").delete().eq("id", service.id);
    if (error) {
      if (error.message.includes("violates foreign key") || (error as any).code === "23503") {
        toast.error(
          `Cannot delete "${service.name}" because it is currently assigned to clients or used in compliance jobs.`,
        );
      } else {
        toast.error(errMsg(error));
      }
    } else {
      toast.success(`Service "${service.name}" deleted successfully`);
      qc.invalidateQueries({ queryKey: ["services-all"] });
    }
  };

  const q = useQuery({
    queryKey: ["services-all"],
    queryFn: async () => {
      const data = await fetchFirmServices();
      return (data ?? []) as Svc[];
    },
  });

  // Live counts so the chips can be appended with whatever exists beyond the
  // canonical list, without letting the two drift apart.
  const options = useMemo(() => {
    const data = q.data ?? [];
    const merge = (canonical: Option[], values: string[]) => {
      const known = new Set(canonical.map((c) => c.value));
      return [
        ...canonical,
        ...[...new Set(values.filter((v) => v && !known.has(v)))].map((v) => ({
          value: v,
          label: v,
        })),
      ];
    };
    return {
      type: merge(
        TYPE_OPTIONS,
        data.map((s) => s.service_type),
      ),
      freq: merge(
        FREQ_OPTIONS,
        data.map((s) => s.frequency),
      ),
    };
  }, [q.data]);

  if (editing) {
    return (
      <ServiceForm
        svc={editing === "new" ? null : editing}
        options={options}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Services"
        subtitle="What your firm offers. Fees and due-day rules are set per client assignment."
        actions={
          canCreate("services") && (
            <div className="flex items-center gap-2">
              {(!q.data || q.data.length === 0) && !q.isLoading && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await fetchFirmServices();
                    await qc.invalidateQueries({ queryKey: ["services-all"] });
                    toast.success("Standard CA practice services loaded");
                  }}
                >
                  Load Standard Services
                </Button>
              )}
              <Button onClick={() => setEditing("new")}>
                <Plus className="mr-1 h-4 w-4" />
                Add Service
              </Button>
            </div>
          )
        }
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty="No services defined yet."
        search={(s) => `${s.name} ${s.service_type} ${s.service_code}`}
        exportFilename="services"
        exportTransform={(s) => ({
          "Service Code": s.service_code,
          "Service Name": s.name,
          "Service Type": s.service_type,
          "Billing Type": s.billing_type === "recurring" ? "Recurring" : "One-time",
          Frequency:
            s.frequency === "one_time" ? "One-time" : (FREQ_LABEL[s.frequency] ?? s.frequency),
          "Auto-Invoice": s.auto_invoice ? "Yes" : "No",
          Status: s.active ? "Active" : "Inactive",
          "Scope of Work": s.description ?? "",
          "Created Date": fmtDate(s.created_at),
        })}
        onRowClick={canEdit("services") ? (s) => setEditing(s) : undefined}
        columns={[
          {
            key: "service_code",
            header: "ID",
            className: "font-mono text-xs",
            sort: (s) => Number(String(s.service_code).replace(/\D/g, "")) || 0,
          },
          {
            key: "name",
            header: "Service",
            sort: (s) => s.name,
            render: (s) => <span className="font-medium">{s.name}</span>,
          },
          { key: "service_type", header: "Type", sort: (s) => s.service_type },
          {
            key: "b",
            header: "Recurring",
            render: (s) => (
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.billing_type === "recurring" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {s.billing_type === "recurring" ? "Recurring" : "One-time"}
              </span>
            ),
          },
          {
            key: "f",
            header: "Frequency",
            render: (s) =>
              s.frequency === "one_time" ? "—" : (FREQ_LABEL[s.frequency] ?? s.frequency),
          },
          { key: "d", header: "Scope", render: (s) => (s.description ? "Yes" : "—") },
          {
            key: "ai",
            header: "Auto-Invoice",
            render: (s) => (
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.auto_invoice ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}
              >
                {s.auto_invoice ? "Yes" : "No"}
              </span>
            ),
          },
          {
            key: "a",
            header: "Status",
            render: (s) => <StatusBadge status={s.active ? "active" : "inactive"} />,
          },
          { key: "created_at", header: "Created", render: (s) => fmtDate(s.created_at) },
          ...(canDelete("services")
            ? [
                {
                  key: "actions",
                  header: "",
                  className: "w-10 text-center",
                  render: (s: Svc) => (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Delete service"
                      onClick={(e) => {
                        e.stopPropagation();
                        setServiceToDelete(s);
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

      <ConfirmDeleteDialog
        open={Boolean(serviceToDelete)}
        onOpenChange={(open) => !open && setServiceToDelete(null)}
        title={`Delete Service "${serviceToDelete?.name ?? ""}"?`}
        description="Are you sure you want to delete this service? Services that are assigned to clients or referenced by active compliance jobs cannot be deleted."
        onConfirm={async () => {
          if (serviceToDelete) {
            await handleDeleteService(serviceToDelete);
          }
        }}
      />
    </div>
  );
}

/** Labelled on/off switch. */
function Switch({
  checked,
  onChange,
  label,
  hint,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          checked ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      <span className="sr-only" id={`${id}-state`}>
        {checked ? label + " is on" : label + " is off"}
      </span>
    </div>
  );
}

function ServiceForm({
  svc,
  options,
  onClose,
}: {
  svc: Svc | null;
  options: { type: Option[]; freq: Option[] };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: userFirms } = useUserFirms();
  const { data: currentFirm } = useCurrentFirm();
  const [firmId, setFirmId] = useState(svc?.firm_id || currentFirm?.id || "");
  const [name, setName] = useState(svc?.name ?? "");
  const [type, setType] = useState(svc?.service_type ?? "");
  const [recurring, setRecurring] = useState(svc ? svc.billing_type !== "one_time" : false);
  const [freq, setFreq] = useState(svc && svc.frequency !== "one_time" ? svc.frequency : "monthly");
  // Remembered so flipping the toggle off and on again restores the choice.
  const [lastRecurringFreq, setLastRecurringFreq] = useState(freq);
  const [description, setDescription] = useState(svc?.description ?? "");
  const [autoInvoice, setAutoInvoice] = useState(svc?.auto_invoice ?? false);
  const [active, setActive] = useState(svc?.active ?? true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!firmId && currentFirm?.id) {
      setFirmId(currentFirm.id);
    }
  }, [currentFirm?.id, firmId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggleRecurring = (on: boolean) => {
    setRecurring(on);
    if (!on) {
      // Park the current choice so switching back restores it.
      if (freq !== "one_time") setLastRecurringFreq(freq);
    } else {
      setFreq(lastRecurringFreq);
    }
  };

  const pickFreq = (v: string) => {
    setFreq(v);
    setLastRecurringFreq(v);
  };

  const save = async () => {
    if (name.trim().length < 2) return toast.error("Service Name is required");
    if (!type.trim()) return toast.error("Service Type is required");
    if (recurring && !freq) return toast.error("Frequency is required");

    setBusy(true);
    const payload = {
      name: name.trim(),
      service_type: type.trim(),
      description: description.trim() || null,
      billing_type: recurring ? "recurring" : "one_time",
      frequency: recurring ? freq : "one_time",
      auto_invoice: autoInvoice,
      active,
      ...(firmId ? { firm_id: firmId } : {}),
    };
    const { error } = svc
      ? await supabase.from("services").update(payload).eq("id", svc.id)
      : await supabase.from("services").insert(payload);
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(svc ? "Service updated" : "Service added");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <FormScreen
      title={svc ? `Edit ${svc.name}` : "Add Service"}
      label={svc ? `Edit ${svc.name}` : "Add Service"}
      subtitle={
        <>
          Fields marked <span className="font-semibold text-destructive">*</span> are mandatory.
          Fees and due-day rules are set when you assign this service to a client.
        </>
      }
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : svc ? "Save Changes" : "Add Service"}
          </Button>
        </>
      }
    >
      <Section title="Service Identity">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={
              <>
                Service Name <Req />
              </>
            }
            className="sm:col-span-2"
          >
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter service name"
            />
          </Field>
          <Field label="Service Code">
            <Input
              value={svc?.service_code ?? "assigned on save"}
              readOnly
              disabled
              className="bg-muted font-mono"
            />
          </Field>
        </div>
        <Field
          label={
            <>
              Service Type <Req />
            </>
          }
        >
          <ChipSelect
            ariaLabel="Service Type"
            value={type}
            onChange={(v) => setType(v)}
            options={options.type}
          />
        </Field>
        <Field label="Scope of Work" hint="Optional">
          <Textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter scope of work"
          />
        </Field>
      </Section>

      <Section
        title="Billing Cycle"
        hint="Recurring services generate a job every cycle until the assignment ends."
      >
        <Switch
          id="svc-recurring"
          label="Recurring"
          hint="Off means this service runs once per assignment."
          checked={recurring}
          onChange={toggleRecurring}
        />
        {recurring && (
          <Field
            label={
              <>
                Frequency <Req />
              </>
            }
          >
            <ChipSelect
              ariaLabel="Frequency"
              value={freq}
              onChange={(v) => v && pickFreq(v)}
              options={options.freq}
            />
          </Field>
        )}
      </Section>

      <Section title="Behaviour">
        <Switch
          id="svc-autoinvoice"
          label="Auto-Invoice on completion"
          hint="Raise an invoice automatically when jobs for this service are marked Completed."
          checked={autoInvoice}
          onChange={setAutoInvoice}
        />
        <Switch
          id="svc-active"
          label="Active"
          hint="Inactive services stay on record but can't be picked for new assignments."
          checked={active}
          onChange={setActive}
        />
      </Section>
    </FormScreen>
  );
}
