import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Briefcase, Building, Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ClientSelect, Field, FormScreen, NativeSelect } from "./common";
import { useClientLookup } from "@/hooks/use-roles";
import { useCurrentFirm, useUserFirms } from "@/hooks/use-firm";
import { errMsg, FREQS, inr, today } from "@/lib/format";
import { firstDuePreview, monthLabel, normalizeServiceType } from "@/lib/service-options";
import { fetchFirmServices } from "@/lib/standard-services";
import { cn } from "@/lib/utils";

export interface JobServiceRow {
  service_id: string;
  service_name: string;
  service_type?: string;
  fee: string;
  advance: string;
  deductions: string;
}

interface JobFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialClientId?: string;
}

export function JobForm({ open, onOpenChange, initialClientId }: JobFormProps) {
  const qc = useQueryClient();
  const { data: clients } = useClientLookup();
  const { data: currentFirm } = useCurrentFirm();
  const { data: userFirms } = useUserFirms();

  const [selectedFirmId, setSelectedFirmId] = useState(currentFirm?.id ?? "");
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [taskDate, setTaskDate] = useState(today());
  const [items, setItems] = useState<JobServiceRow[]>([]);
  const [servicesPopoverOpen, setServicesPopoverOpen] = useState(false);
  const [autoInvoice, setAutoInvoice] = useState(false);
  const [generalNotes, setGeneralNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (currentFirm?.id && !selectedFirmId) {
      setSelectedFirmId(currentFirm.id);
    }
  }, [currentFirm?.id, selectedFirmId]);

  // Fetch active services list (with automatic standard fallback seeding)
  const servicesQuery = useQuery({
    queryKey: ["active-services", selectedFirmId, currentFirm?.id],
    queryFn: () => fetchFirmServices(),
  });

  // Fetch client retainers/assignments to auto-populate fees if preconfigured
  const clientServicesQuery = useQuery({
    queryKey: ["client-services-assignments", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("client_services")
        .select(
          "id, service_id, agreed_fee, frequency, due_days, assigned_staff, auto_invoice, status",
        )
        .eq("client_id", clientId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(clientId),
  });

  // Fetch full details of the selected client (mobile, client_type, assigned_staff)
  const clientDetailsQuery = useQuery({
    queryKey: ["client-details-for-job", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, client_code, client_type, mobile, assigned_staff")
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(clientId),
  });

  const selectedClient = clientDetailsQuery.data;
  const availableServices = servicesQuery.data ?? [];
  const clientServices = clientServicesQuery.data ?? [];

  // Group services by type for quick organized selection (GST Registration -> GST, TDS/Tax Audit -> Income Tax)
  const serviceGroups = useMemo(() => {
    const map = new Map<string, typeof availableServices>();
    for (const s of availableServices) {
      const type = normalizeServiceType(s.service_type, s.name);
      if (!map.has(type)) map.set(type, []);
      map.get(type)!.push(s);
    }
    return Array.from(map.entries());
  }, [availableServices]);

  // Toggle a single service in/out of the selected items
  const toggleService = (serviceId: string) => {
    const existingIndex = items.findIndex((it) => it.service_id === serviceId);
    if (existingIndex >= 0) {
      setItems((prev) => prev.filter((it) => it.service_id !== serviceId));
    } else {
      const svc = availableServices.find((s) => s.id === serviceId);
      if (!svc) return;

      const retainer = clientServices.find((cs) => cs.service_id === serviceId);
      const defaultFee =
        retainer?.agreed_fee != null && retainer.agreed_fee > 0 ? String(retainer.agreed_fee) : "";

      const newItem: JobServiceRow = {
        service_id: svc.id,
        service_name: svc.name,
        service_type: svc.service_type,
        fee: defaultFee,
        advance: "",
        deductions: "",
      };

      setItems((prev) => [...prev, newItem]);
    }
  };

  // Select all services in available list
  const selectAllServices = () => {
    const existingIds = new Set(items.map((it) => it.service_id));
    const newItems: JobServiceRow[] = [...items];

    for (const svc of availableServices) {
      if (!existingIds.has(svc.id)) {
        const retainer = clientServices.find((cs) => cs.service_id === svc.id);
        const defaultFee =
          retainer?.agreed_fee != null && retainer.agreed_fee > 0
            ? String(retainer.agreed_fee)
            : "";

        newItems.push({
          service_id: svc.id,
          service_name: svc.name,
          service_type: svc.service_type,
          fee: defaultFee,
          advance: "",
          deductions: "",
        });
      }
    }
    setItems(newItems);
  };

  const clearAllServices = () => {
    setItems([]);
  };

  const handleUpdateItem = (
    serviceId: string,
    field: "fee" | "advance" | "deductions",
    val: string,
  ) => {
    setItems((prev) =>
      prev.map((item) => (item.service_id === serviceId ? { ...item, [field]: val } : item)),
    );
  };

  const handleRemoveItem = (serviceId: string) => {
    setItems((prev) => prev.filter((item) => item.service_id !== serviceId));
  };

  // Computations for summary (aggregated across all services)
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.fee) || 0), 0),
    [items],
  );
  const totalAdvance = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.advance) || 0), 0),
    [items],
  );
  const totalDeductions = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.deductions) || 0), 0),
    [items],
  );
  const totalOutstanding = Math.max(0, subtotal - totalAdvance - totalDeductions);

  const hasRecurringSelected = useMemo(() => {
    return items.some((it) => {
      const svc = availableServices.find((s) => s.id === it.service_id);
      return svc?.billing_type === "recurring" || (svc?.frequency && svc.frequency !== "one_time");
    });
  }, [items, availableServices]);

  const handleSave = async () => {
    if (!clientId) {
      toast.error("Please select a client");
      return;
    }
    if (items.length === 0) {
      toast.error("Please select at least one service for this job");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const feeNum = Number(item.fee);
      if (isNaN(feeNum) || feeNum < 0) {
        toast.error(`Please enter a valid fee amount for "${item.service_name}"`);
        return;
      }
      const advNum = Number(item.advance) || 0;
      if (advNum < 0) {
        toast.error(`Advance cannot be negative for "${item.service_name}"`);
        return;
      }
      const dedNum = Number(item.deductions) || 0;
      if (dedNum < 0) {
        toast.error(`Deductions cannot be negative for "${item.service_name}"`);
        return;
      }
    }

    setSaving(true);
    try {
      const defaultStaff = selectedClient?.assigned_staff || null;

      // Ensure active firm in DB matches to prevent RLS "firm isolation" violation
      const { data: dbFirmRes } = await supabase.rpc("current_firm_id");
      const activeFirmId = (dbFirmRes as string | null) || currentFirm?.id || null;

      // Prepare configs for each service item
      const itemConfigs: {
        item: JobServiceRow;
        svc: any;
        csId: string | null;
        periodStart: string | null;
        periodEnd: string | null;
        dueDate: string | null;
      }[] = [];
      let hasRecurringServices = false;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const svc = availableServices.find((s) => s.id === item.service_id);
        const isRecurring =
          svc?.billing_type === "recurring" || (svc?.frequency && svc.frequency !== "one_time");

        let csId: string | null = null;
        let periodStart: string | null = taskDate || null;
        let periodEnd: string | null = taskDate || null;
        let dueDate: string | null = null;

        if (isRecurring && svc) {
          hasRecurringServices = true;
          const freq = svc.frequency || "monthly";
          const existingCs = clientServices.find((cs) => cs.service_id === item.service_id);
          const dueDays = existingCs?.due_days ?? 20;
          const preview = firstDuePreview(taskDate, freq, dueDays);
          periodStart = preview?.periodStart ?? taskDate;
          periodEnd = preview?.periodEnd ?? taskDate;
          dueDate = preview?.dueDate ?? null;

          csId = existingCs?.id ?? null;

          if (!csId) {
            // Insert active retainer schedule
            const csPayload: any = {
              client_id: clientId,
              service_id: item.service_id,
              agreed_fee: Number(item.fee) || 0,
              frequency: freq,
              start_date: periodStart || today(),
              end_date: null,
              due_days: dueDays,
              assigned_staff: defaultStaff,
              status: "active",
              notes: generalNotes.trim() || null,
              auto_invoice: autoInvoice,
            };
            if (activeFirmId) csPayload.firm_id = activeFirmId;

            const { data: newCs, error: csErr } = await supabase
              .from("client_services")
              .insert(csPayload)
              .select("id")
              .single();

            if (csErr) {
              console.warn("Could not auto-create retainer in client_services", csErr);
            } else if (newCs) {
              csId = newCs.id;
            }
          } else if (existingCs?.status !== "active") {
            // Re-activate existing retainer if paused
            await supabase
              .from("client_services")
              .update({ status: "active", agreed_fee: Number(item.fee) || 0 })
              .eq("id", csId);
          }
        } else {
          dueDate = taskDate;
        }

        itemConfigs.push({
          item,
          svc,
          csId,
          periodStart,
          periodEnd,
          dueDate,
        });
      }

      // Create 1 job per service ("1 service go to one job")
      const createdJobs: { id: string; fee: number; job_code: string; title: string }[] = [];

      for (const config of itemConfigs) {
        const { item, svc, csId, periodStart, periodEnd, dueDate } = config;
        const fee = Number(item.fee) || 0;
        const adv = Number(item.advance) || 0;
        const ded = Number(item.deductions) || 0;

        let jobTitle = item.service_name;
        if (
          periodStart &&
          (svc?.billing_type === "recurring" || (svc?.frequency && svc.frequency !== "one_time"))
        ) {
          const periodStr = monthLabel(periodStart);
          if (!jobTitle.includes(periodStr)) {
            jobTitle = `${jobTitle} – ${periodStr}`;
          }
        }

        const safeCreatedAt =
          taskDate && !isNaN(new Date(taskDate).getTime())
            ? new Date(`${taskDate}T12:00:00Z`).toISOString()
            : new Date().toISOString();

        const jobToInsert: any = {
          client_id: clientId,
          service_id: item.service_id,
          client_service_id: csId,
          title: jobTitle,
          fee: fee,
          discount: 0,
          assigned_staff: defaultStaff,
          checklist: [],
          notes: generalNotes.trim() || null,
          auto_invoice: autoInvoice,
          due_date: dueDate || null,
          period_start: periodStart || null,
          period_end: periodEnd || null,
          created_at: safeCreatedAt,
          status: "pending",
          financial_status: "open",
        };
        if (activeFirmId) jobToInsert.firm_id = activeFirmId;

        // Check for existing recurring job to avoid duplicate constraint error
        let currentJob: { id: string; fee: number; job_code: string } | null = null;
        if (csId && periodStart) {
          const { data: existingJob } = await supabase
            .from("jobs")
            .select("id, fee, job_code")
            .eq("client_service_id", csId)
            .eq("period_start", periodStart)
            .maybeSingle();

          if (existingJob) {
            const { data: updatedJob, error: updateErr } = await supabase
              .from("jobs")
              .update({
                fee,
                notes: generalNotes.trim() || null,
                due_date: dueDate || null,
                auto_invoice: autoInvoice,
              })
              .eq("id", existingJob.id)
              .select("id, fee, job_code")
              .single();

            if (updateErr) throw updateErr;
            currentJob = updatedJob ?? existingJob;
          }
        }

        if (!currentJob) {
          const { data: inserted, error: insertError } = await supabase
            .from("jobs")
            .insert([jobToInsert])
            .select("id, fee, job_code")
            .single();

          if (insertError) throw insertError;
          currentJob = inserted;
        }

        // Save clearing record and record advance payment if entered
        if (currentJob && (adv > 0 || ded > 0)) {
          try {
            await supabase.rpc("save_job_clearing", {
              _job_id: currentJob.id,
              _advance: adv,
              _tds_tcs: 0,
              _discount: 0,
              _other_deduction: ded,
              _other_addition: 0,
              _notes: "Initial advance/deductions on job creation",
            });
          } catch (clearingErr) {
            console.warn("Could not save initial clearing for job", currentJob.id, clearingErr);
          }

          // If advance was entered, record an actual payment receipt so it reflects in client balance and clearing
          if (adv > 0) {
            try {
              const { data: authData } = await supabase.auth.getUser();
              const currentUserId = authData?.user?.id ?? null;
              const payPayload: any = {
                client_id: clientId,
                job_id: null,
                amount: adv,
                mode: "bank",
                payment_date: taskDate || today(),
                reference: null,
                narration: `General advance deposit from ${selectedClient?.name || "client"}`,
                created_by: currentUserId,
              };
              if (activeFirmId) payPayload.firm_id = activeFirmId;
              await supabase.from("payments").insert(payPayload);
            } catch (payErr) {
              console.warn(
                "Could not record advance payment receipt for job",
                currentJob.id,
                payErr,
              );
            }
          }
        }

        if (currentJob) {
          createdJobs.push({
            id: currentJob.id,
            fee: currentJob.fee,
            job_code: currentJob.job_code,
            title: jobTitle,
          });
        }
      }

      // If recurring services were involved, trigger background generation of recurring jobs
      if (hasRecurringServices) {
        try {
          await supabase.rpc("generate_recurring_jobs", { _upto: today() });
        } catch (rpcErr) {
          console.warn("generate_recurring_jobs notice:", rpcErr);
        }
      }

      toast.success(
        createdJobs.length === 1
          ? `Job ${createdJobs[0]?.job_code ?? ""} created successfully`
          : `Created ${createdJobs.length} jobs successfully (${createdJobs.map((j) => j.job_code).join(", ")})`,
      );
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks"] });
      qc.invalidateQueries({ queryKey: ["job-lookup"] });
      qc.invalidateQueries({ queryKey: ["client_jobs_list"] });
      qc.invalidateQueries({ queryKey: ["client-services"] });
      qc.invalidateQueries({ queryKey: ["client360"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["open-payments"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] });
      qc.invalidateQueries({ queryKey: ["clearing-v2-data"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const selectedServiceIds = new Set(items.map((it) => it.service_id));

  return (
    <FormScreen
      title="Create Job"
      subtitle="Register client compliance and service jobs with direct pricing"
      onClose={() => onOpenChange(false)}
      closeDisabled={saving}
      footer={
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving
              ? "Creating..."
              : items.length > 1
                ? `Create Job (${items.length} Services · ${inr(subtotal)})`
                : "Create Job"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Top: Client Selection & Task Date Card */}
        <section className="rounded-xl border bg-card p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
                Billing Firm / Company
              </label>
              <div className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-xs font-medium text-foreground">
                <Building className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{currentFirm?.name || "Active Practice Firm"}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
                Client *
              </label>
              <ClientSelect
                value={clientId}
                onChange={(id) => setClientId(id)}
                placeholder="Search and select client by name or code…"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
                Date of Creation *
              </label>
              <Input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="h-9 text-xs font-mono bg-background"
              />
            </div>
          </div>

          {selectedClient && (
            <div className="rounded-lg border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Building className="h-3.5 w-3.5 text-primary" />
                <span>{selectedClient.name}</span>
                {selectedClient.client_code && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {selectedClient.client_code}
                  </span>
                )}
              </div>
              {selectedClient.client_type && (
                <div>
                  Type:{" "}
                  <span className="font-medium text-foreground">{selectedClient.client_type}</span>
                </div>
              )}
              {selectedClient.mobile && (
                <div>
                  Mobile: <span className="font-mono text-foreground">{selectedClient.mobile}</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Unified Service & Pricing Box */}
        <section className="rounded-xl border bg-card p-5 space-y-5 shadow-xs">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide">Services & Pricing</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select all services and enter the corresponding fees.
              </p>
            </div>
            {items.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {items.length} Selected
              </span>
            )}
          </div>

          {/* Service Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Popover open={servicesPopoverOpen} onOpenChange={setServicesPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={servicesPopoverOpen}
                  className="min-w-[280px] justify-between h-9 text-xs font-normal bg-background"
                >
                  <span className="flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                    {items.length === 0 ? (
                      <span className="text-muted-foreground">Select services all at once…</span>
                    ) : (
                      <span className="font-medium text-foreground">
                        {items.length} service{items.length === 1 ? "" : "s"} selected
                      </span>
                    )}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[360px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search services..." className="h-9 text-xs" />
                  <CommandList className="max-h-72">
                    <CommandEmpty>
                      <div className="py-2 text-center space-y-2">
                        <p>
                          {servicesQuery.isLoading ? "Loading services…" : "No services found."}
                        </p>
                        {!servicesQuery.isLoading && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={async () => {
                              await fetchFirmServices();
                              qc.invalidateQueries({ queryKey: ["active-services"] });
                            }}
                          >
                            Load Standard CA Services
                          </Button>
                        )}
                      </div>
                    </CommandEmpty>
                    <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] bg-muted/40">
                      <button
                        type="button"
                        onClick={selectAllServices}
                        className="font-medium text-primary hover:underline cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={clearAllServices}
                        className="font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Clear All
                      </button>
                    </div>
                    {serviceGroups.map(([groupName, groupSvcs]) => (
                      <CommandGroup key={groupName} heading={groupName}>
                        {groupSvcs.map((svc) => {
                          const isSelected = selectedServiceIds.has(svc.id);
                          return (
                            <CommandItem
                              key={svc.id}
                              value={`${svc.name} ${svc.service_type || ""}`}
                              onSelect={() => toggleService(svc.id)}
                              className="cursor-pointer text-xs flex items-center justify-between"
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className={cn(
                                    "flex h-4 w-4 items-center justify-center rounded border",
                                    isSelected
                                      ? "bg-primary border-primary text-primary-foreground"
                                      : "border-input",
                                  )}
                                >
                                  {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                                </div>
                                <span className={cn(isSelected && "font-medium")}>{svc.name}</span>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Quick Pick Service Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground mr-1">
                Quick pick:
              </span>
              {availableServices.slice(0, 5).map((s) => {
                const isSelected = selectedServiceIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleService(s.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {isSelected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Recurring Compliance Notice */}
          {hasRecurringSelected && (
            <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-muted-foreground">
              <RefreshCw className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-foreground">Recurring Compliance Work:</span>{" "}
                Creating this job will automatically register the client retainer schedule and
                generate recurring cycle jobs without duplicates.
              </div>
            </div>
          )}

          {/* Unified SERVICE | AMT Table Grid */}
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-muted/10">
              <Briefcase className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <h4 className="mt-2 text-sm font-semibold text-foreground">
                No services selected yet
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Select services from the dropdown or quick chips above to enter amounts.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border bg-background overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b bg-muted/60 font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="py-2.5 px-3 w-10 text-center">#</th>
                      <th className="py-2.5 px-4 min-w-[200px]">Service</th>
                      <th className="py-2.5 px-3 w-36 text-right">Amount (₹) *</th>
                      <th className="py-2.5 px-3 w-36 text-right">Advance (₹)</th>
                      <th className="py-2.5 px-3 w-36 text-right">Deductions / TDS (₹)</th>
                      <th className="py-2.5 px-3 w-28 text-right">Net Due (₹)</th>
                      <th className="py-2.5 px-3 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, idx) => {
                      const feeNum = Number(item.fee) || 0;
                      const advNum = Number(item.advance) || 0;
                      const dedNum = Number(item.deductions) || 0;
                      const rowNet = Math.max(0, feeNum - advNum - dedNum);

                      return (
                        <tr
                          key={item.service_id}
                          className="hover:bg-muted/20 transition-colors group"
                        >
                          <td className="py-2.5 px-3 text-center font-mono text-muted-foreground">
                            {idx + 1}
                          </td>

                          <td className="py-2.5 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-foreground text-sm">
                                {item.service_name}
                              </span>
                              {(() => {
                                const svc = availableServices.find((s) => s.id === item.service_id);
                                const isRec =
                                  svc?.billing_type === "recurring" ||
                                  (svc?.frequency && svc.frequency !== "one_time");
                                if (!isRec) return null;
                                return (
                                  <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                                    <RefreshCw className="h-2.5 w-2.5" />
                                    Recurring (
                                    {svc?.frequency
                                      ? FREQS[svc.frequency] || svc.frequency
                                      : "Monthly"}
                                    )
                                  </span>
                                );
                              })()}
                            </div>
                            {item.service_type && (
                              <span className="inline-block rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground font-medium mt-0.5">
                                {item.service_type}
                              </span>
                            )}
                          </td>

                          {/* Amount (₹) */}
                          <td className="py-2.5 px-3">
                            <div className="relative">
                              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-muted-foreground text-xs font-semibold">
                                ₹
                              </div>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={item.fee}
                                onChange={(e) =>
                                  handleUpdateItem(item.service_id, "fee", e.target.value)
                                }
                                placeholder="0.00"
                                className="h-8 pl-5 text-right font-mono font-semibold text-xs bg-background"
                              />
                            </div>
                          </td>

                          {/* Advance (₹) */}
                          <td className="py-2.5 px-3">
                            <div className="relative">
                              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-muted-foreground text-xs font-semibold">
                                ₹
                              </div>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={item.advance}
                                onChange={(e) =>
                                  handleUpdateItem(item.service_id, "advance", e.target.value)
                                }
                                placeholder="0.00"
                                className="h-8 pl-5 text-right font-mono text-xs bg-background"
                              />
                            </div>
                          </td>

                          {/* Deductions / TDS (₹) */}
                          <td className="py-2.5 px-3">
                            <div className="relative">
                              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-muted-foreground text-xs font-semibold">
                                ₹
                              </div>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={item.deductions}
                                onChange={(e) =>
                                  handleUpdateItem(item.service_id, "deductions", e.target.value)
                                }
                                placeholder="0.00"
                                className="h-8 pl-5 text-right font-mono text-xs bg-background"
                              />
                            </div>
                          </td>

                          {/* Net Due (₹) */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-foreground text-xs whitespace-nowrap">
                            {inr(rowNet)}
                          </td>

                          {/* Remove action */}
                          <td className="py-2.5 px-3 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveItem(item.service_id)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Remove service"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Subtotal & Financial Breakdown Strip */}
              <div className="bg-muted/40 px-4 py-2.5 border-t flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="font-medium text-muted-foreground">
                  Total Services: <strong className="text-foreground">{items.length}</strong>
                </span>
                <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
                  <div>
                    <span className="text-muted-foreground">Subtotal: </span>
                    <span className="font-semibold">{inr(subtotal)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Advances: </span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      − {inr(totalAdvance)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Deductions: </span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      − {inr(totalDeductions)}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-foreground pl-2 border-l">
                    <span>Net Balance: </span>
                    <span className="text-primary">{inr(totalOutstanding)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Integrated Financial Summary Breakdown Cards */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Financial Summary Breakdown
              </span>
              <span className="text-[11px] text-muted-foreground">
                Aggregated from {items.length} service{items.length === 1 ? "" : "s"} above
              </span>
            </div>

            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              <div className="rounded-lg border bg-background p-3">
                <div className="text-[11px] font-medium text-muted-foreground">
                  Gross Fee Amount
                </div>
                <div className="text-base font-bold font-mono text-foreground mt-0.5">
                  {inr(subtotal)}
                </div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-[11px] font-medium text-muted-foreground">Total Advances</div>
                <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {totalAdvance > 0 ? `− ${inr(totalAdvance)}` : inr(0)}
                </div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-[11px] font-medium text-muted-foreground">
                  Total Deductions / TDS
                </div>
                <div className="text-base font-bold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                  {totalDeductions > 0 ? `− ${inr(totalDeductions)}` : inr(0)}
                </div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="text-[11px] font-semibold text-primary">
                  Total Outstanding Amount
                </div>
                <div className="text-lg font-bold font-mono text-primary mt-0.5">
                  {inr(totalOutstanding)}
                </div>
              </div>
            </div>
          </div>

          {/* General Notes & Auto-Invoice Toggle */}
          <div className="space-y-3 pt-2">
            <Field label="General Notes / Remarks (Optional)">
              <Textarea
                rows={2}
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
                placeholder="Any additional notes or instructions for this job work..."
              />
            </Field>

            <div className="flex items-center gap-2.5 rounded-lg border p-3 bg-muted/20">
              <input
                type="checkbox"
                id="batch_auto_invoice"
                checked={autoInvoice}
                onChange={(e) => setAutoInvoice(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
              />
              <label
                htmlFor="batch_auto_invoice"
                className="text-xs font-medium cursor-pointer select-none"
              >
                Automatically raise invoice when these jobs are marked Completed
              </label>
            </div>
          </div>
        </section>
      </div>
    </FormScreen>
  );
}
