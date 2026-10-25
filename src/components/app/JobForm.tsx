/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Briefcase,
  Building,
  Check,
  ChevronsUpDown,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
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
import { ClientForm } from "@/components/app/ClientForm";
import { useClientLookup } from "@/hooks/use-roles";
import { useCurrentFirm, useUserFirms } from "@/hooks/use-firm";
import { errMsg, FREQS, inr, today } from "@/lib/format";
import { firstDuePreview, monthLabel, normalizeServiceType } from "@/lib/service-options";
import { fetchFirmServices, seedStandardServices } from "@/lib/standard-services";
import { recordPaymentEntry } from "@/lib/firms.functions";
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
  const [selectedCompanyName, setSelectedCompanyName] = useState(currentFirm?.name ?? "");
  const [customCompanyName, setCustomCompanyName] = useState("");
  const [isCustomCompany, setIsCustomCompany] = useState(false);
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [taskDate, setTaskDate] = useState(today());
  const [items, setItems] = useState<JobServiceRow[]>([]);
  const [servicesPopoverOpen, setServicesPopoverOpen] = useState(false);
  const [autoInvoice, setAutoInvoice] = useState(false);
  const [generalNotes, setGeneralNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Persistent storage for custom company / trade names
  const storageKey = `ca_custom_companies_${currentFirm?.id || "global"}`;
  const [rememberedCompanies, setRememberedCompanies] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`ca_custom_companies_${currentFirm?.id || "global"}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!currentFirm?.id) return;
    try {
      const raw = localStorage.getItem(`ca_custom_companies_${currentFirm.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRememberedCompanies((prev) => Array.from(new Set([...prev, ...parsed])));
        }
      }
    } catch {
      // ignore
    }
  }, [currentFirm?.id]);

  // Fetch unique companies previously entered on past jobs
  const pastCompaniesQuery = useQuery({
    queryKey: ["past-job-companies", currentFirm?.id],
    queryFn: async () => {
      if (!currentFirm?.id) return [];
      const { data, error } = await supabase
        .from("jobs")
        .select("notes")
        .eq("firm_id", currentFirm.id)
        .ilike("notes", "%[Company:%")
        .limit(300);
      if (error || !data) return [];
      const found = new Set<string>();
      for (const j of data) {
        const match = j.notes?.match(/\[Company:\s*([^\]]+)\]/);
        if (match?.[1]?.trim()) {
          found.add(match[1].trim());
        }
      }
      return Array.from(found);
    },
    enabled: Boolean(currentFirm?.id),
  });

  const saveCustomCompany = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setRememberedCompanies((prev) => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed];
      try {
        localStorage.setItem(
          `ca_custom_companies_${currentFirm?.id || "global"}`,
          JSON.stringify(next),
        );
      } catch (e) {
        console.warn("Could not save company to localStorage", e);
      }
      return next;
    });
  };

  const allCompanyOptions = useMemo(() => {
    const firmList = (userFirms ?? []).filter((f) => Boolean(f?.name));
    const firmNames = new Set(firmList.map((f) => f.name));
    if (currentFirm?.name) firmNames.add(currentFirm.name);

    const customList = new Set<string>();
    for (const c of [...rememberedCompanies, ...(pastCompaniesQuery.data ?? [])]) {
      const trimmed = c?.trim();
      if (trimmed && !firmNames.has(trimmed)) {
        customList.add(trimmed);
      }
    }

    return {
      firms:
        firmList.length > 0
          ? firmList
          : currentFirm
            ? [{ id: currentFirm.id, name: currentFirm.name }]
            : [],
      customs: Array.from(customList),
    };
  }, [userFirms, currentFirm, rememberedCompanies, pastCompaniesQuery.data]);

  useEffect(() => {
    if (currentFirm?.id && !selectedFirmId) {
      setSelectedFirmId(currentFirm.id);
    }
    if (currentFirm?.name && !selectedCompanyName) {
      setSelectedCompanyName(currentFirm.name);
    }
  }, [currentFirm?.id, currentFirm?.name, selectedFirmId, selectedCompanyName]);

  // Fetch active services list scoped to selected or current firm
  const activeFirmId = selectedFirmId || currentFirm?.id;
  const servicesQuery = useQuery({
    queryKey: ["active-services", activeFirmId],
    queryFn: () => fetchFirmServices(activeFirmId),
    enabled: Boolean(activeFirmId),
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
  const availableServices = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);
  const clientServices = useMemo(() => clientServicesQuery.data ?? [], [clientServicesQuery.data]);

  // Fetch existing recurring jobs for this client to prevent duplicate recurring job creation
  const existingRecurringJobsQuery = useQuery({
    queryKey: ["client-existing-recurring-jobs", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_code, title, service_id, client_service_id, period_start")
        .eq("client_id", clientId)
        .not("period_start", "is", null);
      if (error) return [];
      return data ?? [];
    },
    enabled: Boolean(clientId),
  });

  const getDuplicateJob = useCallback(
    (serviceId: string) => {
      const svc = availableServices.find((s) => s.id === serviceId);
      const isRecurring =
        svc?.billing_type === "recurring" || (svc?.frequency && svc.frequency !== "one_time");
      if (!isRecurring || !taskDate) return null;

      const freq = svc?.frequency || "monthly";
      const existingCs = clientServices.find((cs) => cs.service_id === serviceId);
      const dueDays = existingCs?.due_days ?? 20;
      const preview = firstDuePreview(taskDate, freq, dueDays);
      const periodStart = preview?.periodStart ?? taskDate;
      if (!periodStart) return null;

      const existingList = existingRecurringJobsQuery.data ?? [];
      return (
        existingList.find(
          (j) =>
            (j.service_id === serviceId || (existingCs && j.client_service_id === existingCs.id)) &&
            j.period_start === periodStart,
        ) ?? null
      );
    },
    [availableServices, clientServices, taskDate, existingRecurringJobsQuery.data],
  );

  const hasDuplicateRecurring = useMemo(() => {
    return items.some((it) => Boolean(getDuplicateJob(it.service_id)));
  }, [items, getDuplicateJob]);

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
      if (dedNum > feeNum) {
        toast.error(
          `Deduction (${inr(dedNum)}) cannot exceed the agreed fee (${inr(feeNum)}) for "${item.service_name}"`,
        );
        return;
      }
      const maxAdvanceAllowed = Math.max(0, feeNum - dedNum);
      if (advNum > maxAdvanceAllowed) {
        toast.error(
          `Advance (${inr(advNum)}) cannot exceed the required net amount (${inr(maxAdvanceAllowed)}) for "${item.service_name}"`,
        );
        return;
      }
    }

    // Pre-flight check: Verify no duplicate recurring jobs exist for this client and cycle
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const svc = availableServices.find((s) => s.id === item.service_id);
      const isRecurring =
        svc?.billing_type === "recurring" || (svc?.frequency && svc.frequency !== "one_time");

      if (isRecurring && svc) {
        const freq = svc.frequency || "monthly";
        const existingCs = clientServices.find((cs) => cs.service_id === item.service_id);
        const dueDays = existingCs?.due_days ?? 20;
        const preview = firstDuePreview(taskDate, freq, dueDays);
        const periodStart = preview?.periodStart ?? taskDate;

        if (periodStart) {
          let checkQuery = supabase
            .from("jobs")
            .select("id, job_code, title, period_start")
            .eq("client_id", clientId)
            .eq("period_start", periodStart);

          if (existingCs?.id) {
            checkQuery = checkQuery.or(
              `client_service_id.eq.${existingCs.id},service_id.eq.${item.service_id}`,
            );
          } else {
            checkQuery = checkQuery.eq("service_id", item.service_id);
          }

          const { data: existingJobs } = await checkQuery.limit(1);

          if (existingJobs && existingJobs.length > 0) {
            const existing = existingJobs[0];
            const cycleName = monthLabel(periodStart);
            toast.error(
              `Recurring job for "${item.service_name}" already exists for ${cycleName} (${existing.job_code || "Job #" + existing.id.slice(0, 8)}). You cannot add the same recurring job twice.`,
              { duration: 6000 },
            );
            return;
          }
        }
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
      const submissionBatchId =
        itemConfigs.length > 1
          ? `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          : `JOB-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      let sharedJobCode: string | null = null;

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

        const effectiveCompanyName = isCustomCompany
          ? customCompanyName.trim()
          : selectedCompanyName.trim();
        if (effectiveCompanyName) {
          saveCustomCompany(effectiveCompanyName);
        }
        let jobNotes = generalNotes.trim() || null;
        if (submissionBatchId) {
          jobNotes = jobNotes
            ? `[Batch: ${submissionBatchId}]\n${jobNotes}`
            : `[Batch: ${submissionBatchId}]`;
        }
        if (effectiveCompanyName && effectiveCompanyName !== currentFirm?.name) {
          jobNotes = jobNotes
            ? `[Company: ${effectiveCompanyName}]\n${jobNotes}`
            : `[Company: ${effectiveCompanyName}]`;
        }

        const jobToInsert: any = {
          client_id: clientId,
          service_id: item.service_id,
          client_service_id: csId,
          batch_id: submissionBatchId,
          ...(sharedJobCode ? { job_code: sharedJobCode } : {}),
          title: jobTitle,
          fee: fee,
          discount: Math.min(ded, fee),
          assigned_staff: defaultStaff,
          checklist: [],
          notes: jobNotes,
          auto_invoice: autoInvoice,
          due_date: dueDate || null,
          period_start: periodStart || null,
          period_end: periodEnd || null,
          created_at: safeCreatedAt,
          status: "pending",
          financial_status: "open",
        };
        if (activeFirmId) jobToInsert.firm_id = activeFirmId;

        // Check for existing recurring job to prevent duplicate creation
        let currentJob: { id: string; fee: number; job_code: string } | null = null;
        if (csId && periodStart) {
          const { data: existingJob } = await supabase
            .from("jobs")
            .select("id, fee, job_code")
            .eq("client_service_id", csId)
            .eq("period_start", periodStart)
            .maybeSingle();

          if (existingJob) {
            throw new Error(
              `Recurring job for "${item.service_name}" already exists for ${monthLabel(periodStart)} (${existingJob.job_code}). You cannot add the same recurring job twice.`,
            );
          }
        }

        const { data: inserted, error: insertError } = await supabase
          .from("jobs")
          .insert([jobToInsert])
          .select("id, fee, job_code")
          .single();

        if (insertError) {
          if (
            insertError.code === "23505" ||
            insertError.message?.includes("jobs_recurring_unique")
          ) {
            throw new Error(
              `Recurring job for "${item.service_name}" already exists for this cycle. Duplicate recurring jobs are not allowed.`,
            );
          }
          throw insertError;
        }
        currentJob = inserted;
        if (!sharedJobCode && currentJob?.job_code) {
          sharedJobCode = currentJob.job_code;
        }

        // Save clearing record and record advance payment if entered
        if (currentJob && (adv > 0 || ded > 0)) {
          if (ded > 0) {
            try {
              await supabase.rpc("save_job_clearing", {
                _job_id: currentJob.id,
                _advance: 0,
                _tds_tcs: 0,
                _discount: 0, // discount is stored on jobs.discount to avoid double-deduction
                _other_deduction: 0,
                _other_addition: 0,
                _notes: "Initial deductions on job creation",
              });
            } catch (clearingErr) {
              console.warn("Could not save initial clearing for job", currentJob.id, clearingErr);
            }

            try {
              await supabase.from("discounts").insert({
                job_id: currentJob.id,
                original_amount: fee,
                discount_amount: ded,
                net_amount: Math.max(0, fee - ded),
                reason: "Initial deductions on job creation",
              });
            } catch (discErr) {
              console.warn("Could not log discounts table record", discErr);
            }
          }

          // If advance was entered, record an actual payment receipt and auto-allocate it to this job!
          if (adv > 0) {
            try {
              await recordPaymentEntry({
                data: {
                  clientId,
                  jobId: currentJob.id,
                  amount: adv,
                  paymentDate: taskDate || today(),
                  mode: "bank",
                  narration: `Advance payment for job ${currentJob.job_code} (${jobTitle})`,
                  isAdvance: true,
                  autoAllocate: true,
                },
              });
            } catch (payErr) {
              // Fallback: direct insert with allocated_amount set so it doesn't leave an unallocated stray receipt
              try {
                const { data: authData } = await supabase.auth.getUser();
                const currentUserId = authData?.user?.id ?? null;
                const payPayload: any = {
                  client_id: clientId,
                  job_id: currentJob.id,
                  amount: adv,
                  allocated_amount: adv,
                  mode: "bank",
                  payment_date: taskDate || today(),
                  reference: null,
                  narration: `Advance payment for job ${currentJob.job_code} (${jobTitle})`,
                  status: "allocated",
                  created_by: currentUserId,
                };
                if (activeFirmId) payPayload.firm_id = activeFirmId;
                await supabase.from("payments").insert(payPayload);
              } catch (fallbackErr) {
                console.warn(
                  "Could not record advance payment receipt for job",
                  currentJob.id,
                  fallbackErr,
                );
              }
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
      qc.invalidateQueries({ queryKey: ["deductions"] });
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
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || hasDuplicateRecurring}
            className={cn(
              hasDuplicateRecurring &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90 opacity-90",
            )}
          >
            {saving
              ? "Creating..."
              : hasDuplicateRecurring
                ? "Cannot Add Duplicate Recurring Job"
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
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
                  Billing Firm / Company
                </label>
                {!isCustomCompany ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomCompany(true);
                      setCustomCompanyName("");
                    }}
                    className="text-[11px] text-primary hover:underline font-medium"
                  >
                    + Enter new name
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomCompany(false);
                      if (customCompanyName.trim()) {
                        saveCustomCompany(customCompanyName.trim());
                        setSelectedCompanyName(customCompanyName.trim());
                      }
                    }}
                    className="text-[11px] text-muted-foreground hover:underline font-medium"
                  >
                    Back to list
                  </button>
                )}
              </div>
              {isCustomCompany ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={customCompanyName}
                    onChange={(e) => setCustomCompanyName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (customCompanyName.trim()) {
                          saveCustomCompany(customCompanyName.trim());
                          setSelectedCompanyName(customCompanyName.trim());
                          setIsCustomCompany(false);
                        }
                      }
                    }}
                    placeholder="Enter company / trade name…"
                    className="h-9 text-xs flex-1"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-9 px-2.5 text-xs shrink-0 font-medium"
                    onClick={() => {
                      if (customCompanyName.trim()) {
                        saveCustomCompany(customCompanyName.trim());
                        setSelectedCompanyName(customCompanyName.trim());
                        setIsCustomCompany(false);
                      }
                    }}
                    disabled={!customCompanyName.trim()}
                  >
                    Save & Select
                  </Button>
                </div>
              ) : (
                <NativeSelect
                  value={selectedCompanyName || currentFirm?.name || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__custom__") {
                      setIsCustomCompany(true);
                      setCustomCompanyName("");
                    } else {
                      setSelectedCompanyName(val);
                      const matchedFirm = userFirms?.find((f) => f.name === val);
                      if (matchedFirm) {
                        setSelectedFirmId(matchedFirm.id);
                      } else {
                        setSelectedFirmId(currentFirm?.id ?? "");
                      }
                    }
                  }}
                  className="h-9 text-xs font-medium"
                >
                  <optgroup label="Practice Firms">
                    {allCompanyOptions.firms.map((f) => (
                      <option key={f.id} value={f.name}>
                        {f.name} {f.id === currentFirm?.id ? "(Default)" : ""}
                      </option>
                    ))}
                  </optgroup>

                  {allCompanyOptions.customs.length > 0 && (
                    <optgroup label="Saved Companies / Entities">
                      {allCompanyOptions.customs.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  <option value="__custom__">+ Enter another company name…</option>
                </NativeSelect>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
                Client *
              </label>
              <ClientSelect
                value={clientId}
                onChange={(id) => setClientId(id)}
                placeholder="Search and select client by name or code…"
                onAddNewClient={() => setAddClientOpen(true)}
              />
              {addClientOpen && (
                <ClientForm
                  open={addClientOpen}
                  onOpenChange={setAddClientOpen}
                  onSaved={(newClient) => {
                    qc.invalidateQueries({ queryKey: ["client-lookup"] });
                    if (newClient?.id) setClientId(newClient.id);
                  }}
                />
              )}
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
                              await seedStandardServices(activeFirmId);
                              qc.invalidateQueries({ queryKey: ["active-services", activeFirmId] });
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
                          const dupJob = getDuplicateJob(svc.id);
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
                              {dupJob && (
                                <span className="text-[10px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded font-medium">
                                  Existing ({dupJob.job_code || "Job exists"})
                                </span>
                              )}
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
          {hasRecurringSelected && !hasDuplicateRecurring && (
            <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-muted-foreground">
              <RefreshCw className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-foreground">Recurring Compliance Work:</span>{" "}
                Creating this job will automatically register the client retainer schedule and
                generate recurring cycle jobs without duplicates.
              </div>
            </div>
          )}

          {/* Duplicate Recurring Job Warning Alert */}
          {hasDuplicateRecurring && (
            <div className="flex items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <div>
                <span className="font-semibold">Duplicate Recurring Job Detected:</span> One or more
                selected services already have an active recurring job for this cycle. You cannot
                create the same recurring job twice.
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
                      const dupJob = getDuplicateJob(item.service_id);

                      return (
                        <tr
                          key={item.service_id}
                          className={cn(
                            "hover:bg-muted/20 transition-colors group",
                            dupJob && "bg-destructive/5 hover:bg-destructive/10",
                          )}
                        >
                          <td className="py-2.5 px-3 text-center font-mono text-muted-foreground">
                            {idx + 1}
                          </td>

                          <td className="py-2.5 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "font-semibold text-sm",
                                  dupJob ? "text-destructive" : "text-foreground",
                                )}
                              >
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
                              {dupJob && (
                                <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                                  <AlertCircle className="h-2.5 w-2.5" />
                                  Already Exists ({dupJob.job_code || "Active"})
                                </span>
                              )}
                            </div>
                            {item.service_type && (
                              <span className="inline-block rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground font-medium mt-0.5">
                                {item.service_type}
                              </span>
                            )}
                            {dupJob && (
                              <p className="mt-1 text-[11px] font-semibold text-destructive flex items-center gap-1">
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                Recurring job for this cycle already exists ({dupJob.job_code}). You
                                cannot create duplicate recurring jobs.
                              </p>
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
                                max={Math.max(0, feeNum - dedNum)}
                                step="0.01"
                                value={item.advance}
                                onChange={(e) =>
                                  handleUpdateItem(item.service_id, "advance", e.target.value)
                                }
                                placeholder="0.00"
                                className={`h-8 pl-5 text-right font-mono text-xs bg-background ${
                                  advNum > Math.max(0, feeNum - dedNum)
                                    ? "border-destructive text-destructive focus-visible:ring-destructive"
                                    : ""
                                }`}
                              />
                            </div>
                            {advNum > Math.max(0, feeNum - dedNum) && (
                              <p className="text-[10px] text-destructive text-right mt-0.5 font-medium">
                                Exceeds {inr(Math.max(0, feeNum - dedNum))}
                              </p>
                            )}
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
                                max={feeNum}
                                step="0.01"
                                value={item.deductions}
                                onChange={(e) =>
                                  handleUpdateItem(item.service_id, "deductions", e.target.value)
                                }
                                placeholder="0.00"
                                className={`h-8 pl-5 text-right font-mono text-xs bg-background ${
                                  dedNum > feeNum
                                    ? "border-destructive text-destructive focus-visible:ring-destructive"
                                    : ""
                                }`}
                              />
                            </div>
                            {dedNum > feeNum && (
                              <p className="text-[10px] text-destructive text-right mt-0.5 font-medium">
                                Exceeds {inr(feeNum)}
                              </p>
                            )}
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

            <div className="rounded-lg border p-3 bg-muted/20 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Invoicing Policy:</span> Invoices are
              generated automatically when client payments are allocated to tasks.
            </div>
          </div>
        </section>
      </div>
    </FormScreen>
  );
}
