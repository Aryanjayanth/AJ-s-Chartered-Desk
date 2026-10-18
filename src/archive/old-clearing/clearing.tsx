import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Wand2,
  CheckCircle2,
  ReceiptIndianRupee,
  FileCheck,
  CircleDollarSign,
  Plus,
  Minus,
  Briefcase,
  FileText,
  Clock,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoAccess, PageHeader, ReasonDialog, Field, NativeSelect } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentFirm, useUserFirms } from "@/hooks/use-firm";
import { KIND_IS_COST, KIND_LABEL } from "@/lib/expenses";
import { cn } from "@/lib/utils";
import { errMsg, fmtDate, inr, invoiceDisplayStatus, MODES, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clearing")({
  validateSearch: (s: Record<string, unknown>): { payment?: string; client?: string } => ({
    payment: typeof s.payment === "string" ? s.payment : undefined,
    client: typeof s.client === "string" ? s.client : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Payment Clearing — AJ's Chartered Desk" },
      {
        name: "description",
        content:
          "Select a client to clear completed jobs, grant discounts, view expenses, and square off.",
      },
    ],
  }),
  component: ClearingPage,
});

type Pay = {
  id: string;
  client_id: string;
  job_id: string | null;
  amount: number | string;
  allocated_amount: number | string;
  payment_date: string;
  payment_code: string;
  mode: string;
  status: string;
  clients: { name: string; client_code: string } | null;
};

type Expense = {
  id: string;
  job_id: string | null;
  client_id: string | null;
  amount: number;
  category: string;
  description: string;
  kind: "overhead" | "tax" | "reimbursement";
  expense_date: string;
};

type CompletedJob = {
  id: string;
  job_code: string;
  title: string;
  client_id: string;
  status: string;
  financial_status: string | null;
  fee: number;
  discount: number;
  net_amount: number;
  completed_at: string | null;
  created_at: string;
  checklist: unknown;
  clients: { id: string; name: string; client_code: string } | null;
  job_clearing:
    | {
        id: string;
        status: "draft" | "cleared" | "squared_off";
        advance: number;
        tds_tcs: number;
        discount: number;
        other_deduction: number;
        other_addition: number;
        final_amount: number;
        cleared_at: string | null;
        squared_off_at: string | null;
      }[]
    | null;
};

type Inv = {
  id: string;
  job_id: string | null;
  client_id: string;
  outstanding: number | string | null;
  total: number | string;
  subtotal: number | string;
  tax_amount: number | string;
  tax_rate: number | string;
  due_date: string;
  invoice_date: string;
  invoice_no: string;
  description: string | null;
  status: string;
};

type JobDraft = {
  advance: string;
  discount: string;
  tds_tcs: string;
  other_deduction: string;
  other_addition: string;
  tax_rate: string;
  notes: string;
};

const num = (v: string | number | undefined) =>
  Number.isFinite(Number(v)) && v !== "" && v !== undefined ? Number(v) : 0;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const avail = (p: Pay) => Math.max(0, Number(p.amount) - Number(p.allocated_amount));

const getJobFinancials = (j: CompletedJob, d?: JobDraft) => {
  const draft = d || {
    advance: "0",
    discount: "0",
    tds_tcs: "0",
    other_deduction: "0",
    other_addition: "0",
    tax_rate: "0",
    notes: "",
  };
  const gross = Number(j.fee || j.net_amount || 0);
  const disc = num(draft.discount);
  const tds = num(draft.tds_tcs);
  const oDed = num(draft.other_deduction);
  const oAdd = num(draft.other_addition);
  const rate = num(draft.tax_rate);
  const netFinal = Math.max(0, gross - disc - tds - oDed + oAdd);
  const taxAmt = Math.round(((netFinal * rate) / 100) * 100) / 100;
  const totalWithTax = netFinal + taxAmt;
  const adv = num(draft.advance);
  const balDue = Math.max(0, totalWithTax - adv);
  const isFullyCovered = balDue === 0;
  return {
    gross,
    disc,
    tds,
    oDed,
    oAdd,
    rate,
    netFinal,
    taxAmt,
    totalWithTax,
    adv,
    balDue,
    isFullyCovered,
  };
};

function ClearingPage() {
  const { isFinance, loading } = useRoles();
  const { canView } = usePermissions();
  const { data: currentFirm } = useCurrentFirm();
  const { data: userFirms } = useUserFirms();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canViewExpenses = canView("expenses");

  const [selectedFirmId, setSelectedFirmId] = useState(currentFirm?.id ?? "");
  const [cid, setCid] = useState<string | undefined>(search.client);
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<"all" | "has_advance" | "has_unbilled">("all");
  const [drafts, setDrafts] = useState<Record<string, JobDraft>>({});
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});
  const [jobTab, setJobTab] = useState<"pending" | "invoiced" | "all">("pending");
  const [busy, setBusy] = useState(false);
  const [invoiceModalJob, setInvoiceModalJob] = useState<CompletedJob | null>(null);
  const [invTaxRate, setInvTaxRate] = useState("18");
  const [invDueDate, setInvDueDate] = useState(today());
  const [invNotes, setInvNotes] = useState("");

  useEffect(() => {
    if (currentFirm?.id && !selectedFirmId) {
      setSelectedFirmId(currentFirm.id);
    }
  }, [currentFirm?.id, selectedFirmId]);

  // 1. Fetch Completed Jobs
  const jobsQ = useQuery({
    queryKey: ["completed-jobs-clearing"],
    enabled: isFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,job_code,title,client_id,status,financial_status,fee,discount,net_amount,completed_at,created_at,checklist,clients(id,name,client_code),job_clearing(id,status,advance,tds_tcs,discount,other_deduction,other_addition,final_amount,cleared_at,squared_off_at)",
        )
        .eq("status", "completed")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CompletedJob[];
    },
  });

  // 2. Fetch Payments
  const paysQ = useQuery({
    queryKey: ["open-payments"],
    enabled: isFinance,
    queryFn: async () =>
      ((
        await supabase
          .from("payments")
          .select("*, clients(name, client_code)")
          .neq("status", "reversed")
          .order("payment_date", { ascending: false })
      ).data ?? []) as Pay[],
  });

  // 3. Fetch Expenses for context
  const expQ = useQuery({
    queryKey: ["clearing-expenses"],
    enabled: isFinance && canViewExpenses,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id,job_id,client_id,amount,category,description,kind,expense_date")
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Expense[];
    },
  });

  // 4. Fetch Client Invoices
  const invsQ = useQuery({
    queryKey: ["client-invoices-all"],
    enabled: isFinance,
    queryFn: async () =>
      ((
        await supabase
          .from("invoices")
          .select(
            "id,job_id,client_id,outstanding,total,subtotal,tax_amount,tax_rate,due_date,invoice_date,invoice_no,description,status",
          )
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
      ).data ?? []) as Inv[],
  });

  // Group clients by completed jobs & payments
  const clientGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        code: string;
        jobs: CompletedJob[];
        unbilledJobsCount: number;
        totalJobFee: number;
        totalAvailMoney: number;
        payments: Pay[];
      }
    >();

    // Add clients with completed jobs
    for (const j of jobsQ.data ?? []) {
      const c = j.clients;
      if (!c) continue;
      const x = map.get(j.client_id) ?? {
        id: j.client_id,
        name: c.name,
        code: c.client_code,
        jobs: [],
        unbilledJobsCount: 0,
        totalJobFee: 0,
        totalAvailMoney: 0,
        payments: [],
      };
      x.jobs.push(j);
      if (j.financial_status !== "invoiced" && j.financial_status !== "closed") {
        x.unbilledJobsCount += 1;
        x.totalJobFee += Number(j.net_amount || j.fee || 0);
      }
      map.set(j.client_id, x);
    }

    // Add payments
    for (const p of paysQ.data ?? []) {
      const c = p.clients;
      const unallocated = avail(p);
      const x = map.get(p.client_id) ?? {
        id: p.client_id,
        name: c?.name ?? "—",
        code: c?.client_code ?? "—",
        jobs: [],
        unbilledJobsCount: 0,
        totalJobFee: 0,
        totalAvailMoney: 0,
        payments: [],
      };
      x.payments.push(p);
      x.totalAvailMoney += unallocated;
      map.set(p.client_id, x);
    }

    return [...map.values()].sort((a, b) => {
      // Prioritize clients with unbilled jobs or available money
      if (a.unbilledJobsCount > 0 && b.unbilledJobsCount === 0) return -1;
      if (a.unbilledJobsCount === 0 && b.unbilledJobsCount > 0) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [jobsQ.data, paysQ.data]);

  const filteredClientGroups = useMemo(() => {
    return clientGroups.filter((g) => {
      if (clientFilter === "has_advance" && g.totalAvailMoney <= 0) return false;
      if (clientFilter === "has_unbilled" && g.unbilledJobsCount <= 0) return false;
      if (clientSearch.trim()) {
        const s = clientSearch.trim().toLowerCase();
        const hay = `${g.name} ${g.code}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [clientGroups, clientFilter, clientSearch]);

  // Set default active client
  useEffect(() => {
    if (cid) return;
    if (clientGroups.length > 0) {
      const target = search.payment
        ? paysQ.data?.find((p) => p.id === search.payment)?.client_id
        : undefined;
      setCid(target ?? clientGroups[0].id);
    }
  }, [clientGroups, cid, search.payment, paysQ.data]);

  const currentClient = clientGroups.find((g) => g.id === cid);
  const clientJobs = useMemo(() => {
    return (jobsQ.data ?? []).filter((j) => j.client_id === cid);
  }, [jobsQ.data, cid]);

  const pendingClientJobs = useMemo(() => {
    return clientJobs.filter(
      (j) => j.financial_status !== "invoiced" && j.financial_status !== "closed",
    );
  }, [clientJobs]);

  const invoicedClientJobs = useMemo(() => {
    return clientJobs.filter(
      (j) => j.financial_status === "invoiced" || j.financial_status === "closed",
    );
  }, [clientJobs]);

  const displayedJobs = useMemo(() => {
    if (jobTab === "pending") return pendingClientJobs;
    if (jobTab === "invoiced") return invoicedClientJobs;
    return clientJobs;
  }, [jobTab, pendingClientJobs, invoicedClientJobs, clientJobs]);

  const clientExpenses = useMemo(() => {
    return (expQ.data ?? []).filter(
      (e) => e.client_id === cid || clientJobs.some((j) => j.id === e.job_id),
    );
  }, [expQ.data, cid, clientJobs]);

  const unassignedClientExpenses = useMemo(() => {
    return clientExpenses.filter((e) => !e.job_id);
  }, [clientExpenses]);

  const clientPayments = useMemo(() => {
    return (paysQ.data ?? []).filter((p) => p.client_id === cid);
  }, [paysQ.data, cid]);

  const clientInvoices = useMemo(() => {
    return (invsQ.data ?? []).filter((i) => i.client_id === cid);
  }, [invsQ.data, cid]);

  // Financial calculations for active client
  const totalClientReceived = useMemo(() => {
    return clientPayments.reduce((s, p) => s + avail(p), 0);
  }, [clientPayments]);

  const totalAllocated = useMemo(() => {
    return Object.values(drafts).reduce((s, d) => s + num(d.advance), 0);
  }, [drafts]);

  const clientRemainingAdvance = totalClientReceived - totalAllocated;

  const coveredJobsCount = useMemo(() => {
    return pendingClientJobs.filter((j) => {
      const fin = getJobFinancials(j, drafts[j.id]);
      return fin.isFullyCovered;
    }).length;
  }, [pendingClientJobs, drafts]);

  const handleQuickDiscountToSettle = (jobId: string, shortfall: number) => {
    setDrafts((prev) => {
      const d = prev[jobId] || {
        advance: "0",
        discount: "0",
        tds_tcs: "0",
        other_deduction: "0",
        other_addition: "0",
        tax_rate: "0",
        notes: "",
      };
      const curDisc = num(d.discount);
      return {
        ...prev,
        [jobId]: {
          ...d,
          discount: String(curDisc + shortfall),
        },
      };
    });
    toast.success(`Applied ₹${shortfall} discount so job is settled in full!`);
  };

  // Seed drafts for current client's jobs with smart auto-allocation from money jar
  useEffect(() => {
    if (!clientJobs.length) return;
    setDrafts((prev) => {
      const next = { ...prev };
      let pool = totalClientReceived;

      for (const j of clientJobs) {
        if (!next[j.id]) {
          const c = j.job_clearing?.[0];
          const gross = Number(j.fee || j.net_amount || 0);
          const disc = c ? Number(c.discount || 0) : 0;
          const tds = c ? Number(c.tds_tcs || 0) : 0;
          const oDed = c ? Number(c.other_deduction || 0) : 0;
          const oAdd = c ? Number(c.other_addition || 0) : 0;
          const netPayable = Math.max(0, gross - disc - tds - oDed + oAdd);

          // If advance was saved use it; otherwise auto-draw from client's money jar
          let advStr = "0";
          if (c && c.advance > 0) {
            advStr = str(c.advance);
          } else if (
            pool > 0 &&
            j.financial_status !== "invoiced" &&
            j.financial_status !== "closed"
          ) {
            const autoAdv = Math.min(pool, netPayable);
            advStr = String(autoAdv);
            pool -= autoAdv;
          }

          next[j.id] = {
            advance: advStr,
            discount: c ? str(c.discount) : "0",
            tds_tcs: c ? str(c.tds_tcs) : "0",
            other_deduction: c ? str(c.other_deduction) : "0",
            other_addition: c ? str(c.other_addition) : "0",
            tax_rate: "0",
            notes: "",
          };
        }
      }
      return next;
    });
  }, [clientJobs, totalClientReceived]);

  // Auto-fill available client money into jobs (Auto Square-Off)
  const handleAutoFill = () => {
    let moneyPool = totalClientReceived;
    const nextDrafts = { ...drafts };

    for (const j of pendingClientJobs) {
      const d = nextDrafts[j.id] || {
        advance: "0",
        discount: "0",
        tds_tcs: "0",
        other_deduction: "0",
        other_addition: "0",
        tax_rate: "0",
        notes: "",
      };

      // Compute net payable with GST tax before advance
      const gross = Number(j.fee || j.net_amount || 0);
      const disc = num(d.discount);
      const tds = num(d.tds_tcs);
      const oDed = num(d.other_deduction);
      const oAdd = num(d.other_addition);
      const rate = num(d.tax_rate);
      const netPayable = Math.max(0, gross - disc - tds - oDed + oAdd);
      const taxAmt = Math.round(((netPayable * rate) / 100) * 100) / 100;
      const totalInv = netPayable + taxAmt;

      const toAlloc = Math.min(moneyPool, totalInv);
      nextDrafts[j.id] = {
        ...d,
        advance: String(toAlloc),
      };
      moneyPool -= toAlloc;
    }

    setDrafts(nextDrafts);
    toast.success("Auto-filled client advance across completed jobs!");
  };

  // Settle any existing unpaid invoice from client money jar
  const handleSettleInvoiceFromJar = async (invId: string) => {
    setBusy(true);
    try {
      // @ts-expect-error newly created RPC
      const { error: rpcErr } = await supabase.rpc("allocate_client_jar_to_invoice", {
        _invoice_id: invId,
      });

      if (rpcErr) {
        // Fallback: iterate payments and call allocate_payment
        const inv = clientInvoices.find((i) => i.id === invId);
        let needed = Number(inv?.outstanding || 0);
        for (const p of clientPayments) {
          const av = avail(p);
          if (av > 0 && needed > 0) {
            const take = Math.min(needed, av);
            await supabase.rpc("allocate_payment", {
              _payment_id: p.id,
              _allocations: [{ invoice_id: invId, amount: take }],
            });
            needed -= take;
          }
        }
      }

      toast.success("Settled invoice from client money jar!");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["open-payments"] }),
        qc.invalidateQueries({ queryKey: ["client-invoices-all"] }),
        qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] }),
        qc.invalidateQueries({ queryKey: ["payments-list"] }),
        qc.invalidateQueries({ queryKey: ["jobs-list"] }),
      ]);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Save all job clearing adjustments, square off, and automatically generate invoices
  const handleSaveAndSquareOff = async (jobId?: string, autoInvoice = true) => {
    if (!cid) return;

    let targetJobs: CompletedJob[] = [];
    if (jobId) {
      const single = clientJobs.find((j) => j.id === jobId);
      if (!single) return;
      const fin = getJobFinancials(single, drafts[single.id]);
      if (!fin.isFullyCovered) {
        toast.error(
          `Cannot square off: ₹${fin.balDue} is unpaid. Advance payment or discount is required to settle in full.`,
        );
        return;
      }
      targetJobs = [single];
    } else {
      // Bulk square off: ONLY process jobs that are 100% covered by advance or discount!
      targetJobs = pendingClientJobs.filter((j) => {
        const fin = getJobFinancials(j, drafts[j.id]);
        return fin.isFullyCovered;
      });

      if (targetJobs.length === 0) {
        toast.error(
          "No pending jobs are fully covered by advance or discount. Uncovered jobs cannot be squared off as unpaid.",
        );
        return;
      }
    }

    setBusy(true);
    let invoicedCount = 0;

    try {
      for (const j of targetJobs) {
        if (j.financial_status === "invoiced" || j.financial_status === "closed") continue;
        const d = drafts[j.id] || {
          advance: "0",
          discount: "0",
          tds_tcs: "0",
          other_deduction: "0",
          other_addition: "0",
          tax_rate: "0",
          notes: "",
        };

        const matchingPay = clientPayments.find((p) => p.job_id === j.id || avail(p) > 0);

        // Try single atomic RPC first
        // @ts-expect-error square_off_and_invoice_job may be newly added to Supabase
        const { data: atomicInvId, error: atomicErr } = await supabase.rpc(
          "square_off_and_invoice_job",
          {
            _job_id: j.id,
            _advance: num(d.advance),
            _tds_tcs: num(d.tds_tcs),
            _discount: num(d.discount),
            _other_deduction: num(d.other_deduction),
            _other_addition: num(d.other_addition),
            _tax_rate: num(d.tax_rate || 0),
            _notes: d.notes.trim() || "",
          },
        );

        if (!atomicErr && atomicInvId) {
          invoicedCount++;
          continue;
        }

        // Fallback sequence if RPC not yet created
        // 1. Save clearing (ignore if already cleared)
        await supabase.rpc("save_job_clearing", {
          _job_id: j.id,
          _advance: num(d.advance),
          _tds_tcs: num(d.tds_tcs),
          _discount: num(d.discount),
          _other_deduction: num(d.other_deduction),
          _other_addition: num(d.other_addition),
          _notes: d.notes.trim(),
        });

        // 2. Mark Cleared
        await supabase.rpc("mark_job_cleared", {
          _job_id: j.id,
          _notes: d.notes.trim(),
        });

        // 3. Square Off
        await supabase.rpc("sq_off_job_clearing", {
          _job_id: j.id,
          _notes: d.notes.trim(),
        });

        // 4. Create Invoice automatically if requested
        if (autoInvoice) {
          const { data: fbInvId, error: invErr } = await supabase.rpc("create_invoice_for_job", {
            _job_id: j.id,
            _payment_id: matchingPay ? matchingPay.id : (null as unknown as string),
            _invoice_date: today(),
            _due_date: today(),
            _tax_rate: num(d.tax_rate || 0),
            _notes: d.notes.trim() || "",
            _extra_desc: "",
            _extra_amount: 0,
          });

          if (!invErr && fbInvId) {
            invoicedCount++;
            // Allocate advance from money jar if specified
            let neededAdv = num(d.advance);
            if (neededAdv > 0) {
              for (const p of clientPayments) {
                const av = avail(p);
                if (av > 0 && neededAdv > 0) {
                  const take = Math.min(neededAdv, av);
                  await supabase.rpc("allocate_payment", {
                    _payment_id: p.id,
                    _allocations: [{ invoice_id: fbInvId, amount: take }],
                  });
                  neededAdv -= take;
                }
              }
            }
          }
        }
      }

      // Clean up drafts for processed jobs
      setDrafts((prev) => {
        const next = { ...prev };
        for (const j of targetJobs) {
          delete next[j.id];
        }
        return next;
      });

      // Refetch and invalidate all related queries
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["open-payments"] }),
        qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] }),
        qc.invalidateQueries({ queryKey: ["client-invoices-all"] }),
        qc.invalidateQueries({ queryKey: ["payments-list"] }),
        qc.invalidateQueries({ queryKey: ["jobs-list"] }),
      ]);

      toast.success(
        invoicedCount > 0
          ? `Squared off & settled ${invoicedCount} covered job(s) in full!`
          : "Covered jobs squared off successfully!",
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Generate Invoice handler for a squared-off job
  const handleCreateInvoice = async () => {
    if (!invoiceModalJob) return;
    setBusy(true);
    try {
      const matchingPay = clientPayments.find(
        (p) => p.job_id === invoiceModalJob.id || avail(p) > 0,
      );
      const { data: invId, error } = await supabase.rpc("create_invoice_for_job", {
        _job_id: invoiceModalJob.id,
        _payment_id: matchingPay ? matchingPay.id : (null as unknown as string),
        _invoice_date: today(),
        _due_date: invDueDate || today(),
        _tax_rate: num(invTaxRate),
        _notes: invNotes.trim() || "",
        _extra_desc: "",
        _extra_amount: 0,
      });

      if (error) throw error;
      if (invId && selectedFirmId) {
        await supabase.from("invoices").update({ firm_id: selectedFirmId }).eq("id", invId);
      }

      // Invalidate queries
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["open-payments"] }),
        qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] }),
        qc.invalidateQueries({ queryKey: ["client-invoices-all"] }),
      ]);

      toast.success("Invoice generated successfully!");
      setInvoiceModalJob(null);
      navigate({ to: "/invoices/$id", params: { id: invId } });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  if (!isFinance) return <NoAccess />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payment Clearing"
        subtitle="Select a client to clear completed jobs against received money, grant discounts & TDS, and square off before invoicing."
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left Column: Client List */}
        <Card className="shadow-none">
          <CardHeader className="pb-3 border-b space-y-2.5">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Clients / Companies</span>
              <span className="text-xs font-mono font-normal text-muted-foreground">
                {filteredClientGroups.length} of {clientGroups.length}
              </span>
            </CardTitle>

            {/* Quick Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search 300+ clients by name or code…"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="h-8 pl-8 text-xs bg-muted/40"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => setClientFilter("all")}
                className={cn(
                  "px-2 py-0.5 rounded-md font-medium transition-colors",
                  clientFilter === "all"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setClientFilter("has_advance")}
                className={cn(
                  "px-2 py-0.5 rounded-md font-medium transition-colors",
                  clientFilter === "has_advance"
                    ? "bg-emerald-600 text-white font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                Has Advance
              </button>
              <button
                type="button"
                onClick={() => setClientFilter("has_unbilled")}
                className={cn(
                  "px-2 py-0.5 rounded-md font-medium transition-colors",
                  clientFilter === "has_unbilled"
                    ? "bg-blue-600 text-white font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                Has Unbilled
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-3 max-h-[calc(100vh-270px)] overflow-y-auto">
            {filteredClientGroups.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No clients match your search or filter.
              </p>
            )}
            {filteredClientGroups.map((g) => {
              const isSelected = cid === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setCid(g.id)}
                  className={cn(
                    "w-full rounded-xl border p-3.5 text-left text-sm transition-all hover:bg-muted/50",
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                      : "border-border/60 bg-card",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground truncate max-w-[180px]">
                      {g.name}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">{g.code}</span>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-muted/40 p-2 rounded-lg border border-border/40">
                      <div className="text-muted-foreground text-[10px] uppercase font-medium">
                        Advance Balance
                      </div>
                      <div className="font-mono font-bold text-emerald-600 mt-0.5">
                        {inr(g.totalAvailMoney)}
                      </div>
                    </div>
                    <div className="bg-muted/40 p-2 rounded-lg border border-border/40">
                      <div className="text-muted-foreground text-[10px] uppercase font-medium">
                        Unbilled Work
                      </div>
                      <div className="font-mono font-bold text-primary mt-0.5">
                        {inr(g.totalJobFee)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{g.jobs.length} completed job(s)</span>
                    <span>{g.payments.length} payment(s)</span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Right Column: Selected Client's Clearing Station */}
        <div className="space-y-4 lg:col-span-2">
          {!currentClient ? (
            <Card className="shadow-none p-12 text-center text-muted-foreground">
              Select a client to clear completed jobs and square off payments.
            </Card>
          ) : (
            <>
              {/* Money Jar Summary Card */}
              <Card className="shadow-none border-primary/20 bg-primary/[0.02]">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                    <div>
                      <h3 className="font-semibold text-base text-foreground">
                        {currentClient.name}
                      </h3>
                      <p className="text-xs text-muted-foreground font-mono">
                        Code: {currentClient.code} · {clientJobs.length} Completed Job(s)
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {totalClientReceived > 0 && pendingClientJobs.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleAutoFill}
                          disabled={busy}
                          className="text-xs"
                        >
                          <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-500" />
                          Auto-Fill Advance
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleSaveAndSquareOff(undefined, true)}
                        disabled={busy || coveredJobsCount === 0}
                        className={cn(
                          "text-xs font-medium",
                          coveredJobsCount > 0
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                            : "",
                        )}
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        {coveredJobsCount === 0
                          ? "No Jobs Covered (Awaiting Payment)"
                          : `Square Off Covered Jobs (${coveredJobsCount}/${pendingClientJobs.length})`}
                      </Button>
                    </div>
                  </div>

                  {/* 4 Summary Metric Cards */}
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg bg-emerald-50/50 p-2.5 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/40">
                      <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                        Total Advance Received
                      </div>
                      <div className="mt-1 font-mono text-lg font-bold text-emerald-600">
                        {inr(totalClientReceived)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {clientPayments.length} payment receipt(s)
                      </div>
                    </div>

                    <div className="rounded-lg bg-primary/5 p-2.5 border border-primary/20">
                      <div className="text-[11px] font-medium text-primary">Completed Work Fee</div>
                      <div className="mt-1 font-mono text-lg font-bold text-foreground">
                        {inr(
                          clientJobs.reduce((s, j) => s + Number(j.net_amount || j.fee || 0), 0),
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Across all done jobs</div>
                    </div>

                    <div className="rounded-lg bg-blue-50/50 p-2.5 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/40">
                      <div className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                        Allocated to Work
                      </div>
                      <div className="mt-1 font-mono text-lg font-bold text-blue-600">
                        {inr(totalAllocated)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">From advance receipts</div>
                    </div>

                    <div className="rounded-lg bg-amber-50/50 p-2.5 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/40">
                      <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        Remaining Advance
                      </div>
                      <div
                        className={cn(
                          "mt-1 font-mono text-lg font-bold",
                          clientRemainingAdvance < 0 ? "text-destructive" : "text-amber-600",
                        )}
                      >
                        {inr(clientRemainingAdvance)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {clientRemainingAdvance < 0 ? "Exceeds received" : "Remaining balance"}
                      </div>
                    </div>
                  </div>

                  {/* Firm Costs & Expenses Breakdown */}
                  {clientExpenses.length > 0 && (
                    <div className="mt-3 space-y-2 bg-muted/40 p-3 rounded-lg border text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                          <ReceiptIndianRupee className="h-3.5 w-3.5 text-primary" />
                          Client Reimbursables & Out-of-Pocket Expenses ({
                            clientExpenses.length
                          }{" "}
                          items):
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {inr(clientExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0))}
                        </span>
                      </div>
                      <div className="divide-y divide-border/40 max-h-36 overflow-y-auto pt-1">
                        {clientExpenses.map((e) => (
                          <div
                            key={e.id}
                            className="py-1 flex items-center justify-between text-[11px]"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">
                                {fmtDate(e.expense_date)}
                              </span>
                              <span className="font-medium text-foreground">{e.description}</span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {e.category}
                              </span>
                              {e.job_id ? (
                                <span className="font-mono text-[10px] text-primary">
                                  Job linked
                                </span>
                              ) : (
                                <span className="rounded bg-amber-500/10 text-amber-600 px-1 text-[10px] font-medium">
                                  Unassigned client expense
                                </span>
                              )}
                            </div>
                            <span className="font-mono font-medium text-foreground">
                              {inr(e.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Jobs List Section */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <FileCheck className="h-4 w-4 text-primary" />
                    Completed Jobs ({clientJobs.length})
                  </h4>

                  <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-xs">
                    <button
                      type="button"
                      className={cn(
                        "px-2.5 py-1 rounded-md font-medium transition-colors",
                        jobTab === "pending"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setJobTab("pending")}
                    >
                      Pending Clearing ({pendingClientJobs.length})
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "px-2.5 py-1 rounded-md font-medium transition-colors",
                        jobTab === "invoiced"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setJobTab("invoiced")}
                    >
                      Invoiced & Settled ({invoicedClientJobs.length})
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "px-2.5 py-1 rounded-md font-medium transition-colors",
                        jobTab === "all"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setJobTab("all")}
                    >
                      All ({clientJobs.length})
                    </button>
                  </div>
                </div>

                {displayedJobs.length === 0 ? (
                  jobTab === "pending" ? (
                    <Card className="shadow-none p-8 text-center text-sm text-muted-foreground border-dashed">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 mb-3">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div className="font-semibold text-foreground">
                        All Jobs Cleared & Invoiced! 🎉
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                        There are no pending jobs awaiting clearing for this client. You can view
                        raised invoices in the Billing History below.
                      </p>
                    </Card>
                  ) : (
                    <Card className="shadow-none p-8 text-center text-sm text-muted-foreground">
                      No jobs found in this view.
                    </Card>
                  )
                ) : (
                  displayedJobs.map((j) => {
                    const d = drafts[j.id] || {
                      advance: "0",
                      discount: "0",
                      tds_tcs: "0",
                      other_deduction: "0",
                      other_addition: "0",
                      tax_rate: "0",
                      notes: "",
                    };

                    const fin = getJobFinancials(j, d);
                    const {
                      gross,
                      disc,
                      tds,
                      oDed,
                      oAdd,
                      rate,
                      netFinal,
                      taxAmt,
                      totalWithTax,
                      adv,
                      balDue,
                      isFullyCovered,
                    } = fin;

                    const cStatus = j.job_clearing?.[0]?.status;
                    const isInvoiced =
                      j.financial_status === "invoiced" || j.financial_status === "closed";
                    const isExpanded = expandedJobs[j.id] ?? false;

                    const jobExps = clientExpenses.filter((e) => e.job_id === j.id);

                    return (
                      <Card
                        key={j.id}
                        className={cn(
                          "shadow-none transition-all border",
                          isInvoiced
                            ? "bg-muted/10 opacity-75 border-border/40"
                            : cStatus === "squared_off"
                              ? "border-blue-300 bg-blue-50/20 dark:border-blue-900"
                              : "border-border hover:border-primary/40",
                        )}
                      >
                        <CardContent className="p-4 space-y-3">
                          {/* Job Card Header */}
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-primary">
                                  {j.job_code}
                                </span>
                                <h5 className="font-medium text-sm text-foreground">{j.title}</h5>
                                {isInvoiced ? (
                                  <StatusBadge status="invoiced" />
                                ) : cStatus === "squared_off" ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200">
                                    Squared Off
                                  </span>
                                ) : isFullyCovered ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200">
                                    ✓ Fully Covered
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 border border-amber-300">
                                    Shortfall: {inr(balDue)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                <span>Done: {fmtDate(j.completed_at || j.created_at)}</span>
                                {jobExps.length > 0 && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-amber-600 font-medium bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                      Firm Cost / Out-of-pocket:{" "}
                                      {inr(jobExps.reduce((s, e) => s + Number(e.amount), 0))}
                                    </span>
                                    {!isInvoiced && (
                                      <button
                                        type="button"
                                        className="text-[11px] text-primary hover:underline font-medium"
                                        onClick={() => {
                                          const expTotal = jobExps.reduce(
                                            (s, e) => s + Number(e.amount),
                                            0,
                                          );
                                          const curr = Number(d.other_addition) || 0;
                                          setDrafts((prev) => ({
                                            ...prev,
                                            [j.id]: {
                                              ...d,
                                              other_addition: String(curr + expTotal),
                                            },
                                          }));
                                          toast.success(
                                            `Added ${inr(expTotal)} firm expense to Extra Fee (+)`,
                                          );
                                        }}
                                      >
                                        + Bill to Client
                                      </button>
                                    )}
                                  </div>
                                )}
                                {!isInvoiced && unassignedClientExpenses.length > 0 && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground text-[11px]">
                                      Unassigned client expense:{" "}
                                      {inr(
                                        unassignedClientExpenses.reduce(
                                          (s, e) => s + Number(e.amount),
                                          0,
                                        ),
                                      )}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-[11px] text-amber-600 hover:underline font-medium"
                                      onClick={() => {
                                        const unassignedTotal = unassignedClientExpenses.reduce(
                                          (s, e) => s + Number(e.amount),
                                          0,
                                        );
                                        const curr = Number(d.other_addition) || 0;
                                        setDrafts((prev) => ({
                                          ...prev,
                                          [j.id]: {
                                            ...d,
                                            other_addition: String(curr + unassignedTotal),
                                          },
                                        }));
                                        toast.success(
                                          `Added ${inr(unassignedTotal)} client expenses to Extra Fee (+)`,
                                        );
                                      }}
                                    >
                                      + Add to this Bill
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {isInvoiced ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs font-medium"
                                  onClick={() =>
                                    navigate({
                                      to: "/clearing/$jobId",
                                      params: { jobId: j.id },
                                      search: {},
                                    })
                                  }
                                >
                                  View Sheet
                                </Button>
                              ) : cStatus === "squared_off" ? (
                                <Button
                                  size="sm"
                                  className="h-8 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                  onClick={() => setInvoiceModalJob(j)}
                                >
                                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                                  Create Invoice
                                </Button>
                              ) : isFullyCovered ? (
                                <Button
                                  size="sm"
                                  className="h-8 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                  disabled={busy}
                                  onClick={() => handleSaveAndSquareOff(j.id, true)}
                                >
                                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                  Square Off & Settle (Paid)
                                </Button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs font-medium border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                                    onClick={() => handleQuickDiscountToSettle(j.id, balDue)}
                                    title={`Apply ₹${balDue} discount so this job is settled in full`}
                                  >
                                    + Discount {inr(balDue)} to Settle
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled
                                    className="h-8 text-xs font-medium cursor-not-allowed opacity-75 bg-muted text-muted-foreground"
                                    title="Cannot square off without advance money or discount"
                                  >
                                    Awaiting {inr(balDue)}
                                  </Button>
                                </div>
                              )}

                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2 text-xs"
                                onClick={() =>
                                  setExpandedJobs((prev) => ({ ...prev, [j.id]: !isExpanded }))
                                }
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* Clean 6-Column Financial Row */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 bg-muted/30 p-3 rounded-lg border border-border/50 text-xs">
                            <div>
                              <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                                Job Fee (Gross)
                              </span>
                              <span className="font-mono font-semibold text-sm">{inr(gross)}</span>
                            </div>

                            <div>
                              <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                                Discount (–)
                              </span>
                              <Input
                                type="number"
                                min={0}
                                disabled={isInvoiced}
                                className="h-7 text-xs font-mono mt-0.5 bg-background"
                                value={d.discount}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [j.id]: { ...d, discount: e.target.value },
                                  }))
                                }
                                placeholder="0"
                              />
                            </div>

                            <div>
                              <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                                TDS / TCS (–)
                              </span>
                              <Input
                                type="number"
                                min={0}
                                disabled={isInvoiced}
                                className="h-7 text-xs font-mono mt-0.5 bg-background"
                                value={d.tds_tcs}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [j.id]: { ...d, tds_tcs: e.target.value },
                                  }))
                                }
                                placeholder="0"
                              />
                            </div>

                            <div>
                              <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                                GST Rate
                              </span>
                              <NativeSelect
                                disabled={isInvoiced}
                                className="h-7 text-xs mt-0.5 bg-background"
                                value={d.tax_rate || "0"}
                                onChange={(e) => {
                                  const newRate = e.target.value;
                                  const rateVal = num(newRate);
                                  const newTax =
                                    Math.round(((netFinal * rateVal) / 100) * 100) / 100;
                                  const newTot = netFinal + newTax;
                                  const currentAdv = num(d.advance);
                                  const maxJar = clientRemainingAdvance + currentAdv;
                                  const newAdv = Math.min(newTot, maxJar);

                                  setDrafts((prev) => ({
                                    ...prev,
                                    [j.id]: {
                                      ...d,
                                      tax_rate: newRate,
                                      advance: String(newAdv),
                                    },
                                  }));
                                }}
                              >
                                <option value="0">0% (None)</option>
                                <option value="18">18% GST</option>
                                <option value="12">12% GST</option>
                                <option value="5">5% GST</option>
                              </NativeSelect>
                            </div>

                            <div>
                              <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                                Total Invoice
                              </span>
                              <span className="font-mono font-bold text-sm text-primary block mt-1">
                                {inr(totalWithTax)}
                              </span>
                              {taxAmt > 0 && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  (+{inr(taxAmt)} GST)
                                </span>
                              )}
                            </div>

                            <div>
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground text-[10px] uppercase font-medium">
                                  Allocate Advance
                                </span>
                                {!isInvoiced && (
                                  <button
                                    type="button"
                                    className="text-[10px] text-primary underline font-medium"
                                    onClick={() => {
                                      const maxPossible = Math.min(
                                        totalWithTax,
                                        clientRemainingAdvance + num(d.advance),
                                      );
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [j.id]: { ...d, advance: String(maxPossible) },
                                      }));
                                    }}
                                  >
                                    Max
                                  </button>
                                )}
                              </div>
                              <Input
                                type="number"
                                min={0}
                                disabled={isInvoiced}
                                className="h-7 text-xs font-mono mt-0.5 text-emerald-600 font-bold bg-background"
                                value={d.advance}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [j.id]: { ...d, advance: e.target.value },
                                  }))
                                }
                                placeholder="0"
                              />
                            </div>
                          </div>

                          {/* Settlement Status Bar */}
                          {!isInvoiced && (
                            <div
                              className={cn(
                                "flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md text-xs font-medium border",
                                isFullyCovered
                                  ? "bg-emerald-50/70 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800/60 dark:text-emerald-300"
                                  : "bg-amber-50/70 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800/60 dark:text-amber-300",
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground font-normal">
                                  Settlement:
                                </span>
                                {isFullyCovered ? (
                                  <span className="font-semibold flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline" />
                                    100% Settled ({inr(adv)} advance) · ₹0 Balance Due
                                  </span>
                                ) : (
                                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                                    Shortfall: {inr(balDue)} unpaid
                                  </span>
                                )}
                              </div>
                              <div>
                                {isFullyCovered ? (
                                  <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                                    Ready to Square Off as Paid in Full
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-amber-700 dark:text-amber-300">
                                    Needs advance payment or discount to square off
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Expanded Details */}
                          {isExpanded && (
                            <div className="pt-2 border-t space-y-2 text-xs">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                  <span className="text-muted-foreground font-medium block">
                                    Other Deductions (–):
                                  </span>
                                  <Input
                                    type="number"
                                    min={0}
                                    disabled={isInvoiced}
                                    className="h-7 text-xs font-mono mt-1"
                                    value={d.other_deduction}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [j.id]: { ...d, other_deduction: e.target.value },
                                      }))
                                    }
                                    placeholder="0"
                                  />
                                </div>
                                <div>
                                  <span className="text-muted-foreground font-medium block">
                                    Extra Fee / Out-of-pocket (+):
                                  </span>
                                  <Input
                                    type="number"
                                    min={0}
                                    disabled={isInvoiced}
                                    className="h-7 text-xs font-mono mt-1"
                                    value={d.other_addition}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [j.id]: { ...d, other_addition: e.target.value },
                                      }))
                                    }
                                    placeholder="0"
                                  />
                                </div>
                                <div>
                                  <span className="text-muted-foreground font-medium block">
                                    Clearing Remarks:
                                  </span>
                                  <Input
                                    disabled={isInvoiced}
                                    className="h-7 text-xs mt-1"
                                    value={d.notes}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [j.id]: { ...d, notes: e.target.value },
                                      }))
                                    }
                                    placeholder="Remarks or bank reference..."
                                  />
                                </div>
                              </div>

                              {jobExps.length > 0 && (
                                <div className="mt-2 bg-muted/40 p-2.5 rounded border space-y-1">
                                  <div className="font-semibold text-muted-foreground">
                                    Expenses Incurred for {j.job_code}:
                                  </div>
                                  {jobExps.map((e) => (
                                    <div
                                      key={e.id}
                                      className="flex justify-between items-center text-[11px]"
                                    >
                                      <span>
                                        {e.description || e.category} · {fmtDate(e.expense_date)}
                                      </span>
                                      <span className="font-mono">{inr(e.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>

              {/* Invoices Raised & Billing History (At the ending) */}
              <div className="mt-6 border-t pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-primary" />
                    Invoices Raised & Billing History ({clientInvoices.length})
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    Generated after clearing & squaring off
                  </span>
                </div>

                {clientInvoices.length === 0 ? (
                  <Card className="shadow-none p-6 text-center text-xs text-muted-foreground">
                    No invoices generated for this client yet. Once a job is squared off, click
                    "Create Invoice" above.
                  </Card>
                ) : (
                  <Card className="shadow-none">
                    <div className="divide-y text-xs">
                      {clientInvoices.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between p-3 hover:bg-muted/40 transition-colors"
                        >
                          <div>
                            <div className="font-mono font-semibold text-primary">
                              {inv.invoice_no}
                            </div>
                            <div className="text-muted-foreground text-[11px]">
                              Date: {fmtDate(inv.invoice_date)} · Due: {fmtDate(inv.due_date)} ·{" "}
                              {inv.description}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 text-right">
                            <div>
                              <div className="font-mono font-bold">{inr(inv.total)}</div>
                              <div className="text-[11px] text-muted-foreground">
                                Due: {inr(inv.outstanding)}
                              </div>
                            </div>
                            <StatusBadge status={inv.status} />
                            <div className="flex items-center gap-1.5">
                              {inv.status !== "paid" &&
                                Number(inv.outstanding || 0) > 0 &&
                                totalClientReceived > 0 && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300"
                                    disabled={busy}
                                    onClick={() => handleSettleInvoiceFromJar(inv.id)}
                                  >
                                    Settle from Jar
                                  </Button>
                                )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() =>
                                  navigate({ to: "/invoices/$id", params: { id: inv.id } })
                                }
                              >
                                View
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Invoice Generation Modal for Squared-Off Job */}
      {invoiceModalJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md shadow-lg animate-in fade-in zoom-in-95">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Generate Invoice for {invoiceModalJob.job_code}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground">
                Payment clearing is complete. Generate the official tax invoice for{" "}
                <strong>{currentClient?.name}</strong>.
              </p>

              <div className="bg-muted/40 p-3 rounded-lg border text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service / Title:</span>
                  <span className="font-medium">{invoiceModalJob.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Net Taxable Fee:</span>
                  <span className="font-mono font-bold">
                    {inr(
                      invoiceModalJob.job_clearing?.[0]?.final_amount ||
                        invoiceModalJob.net_amount ||
                        invoiceModalJob.fee,
                    )}
                  </span>
                </div>
              </div>

              <Field label="Billing Entity / Company *">
                <NativeSelect
                  value={selectedFirmId}
                  onChange={(e) => setSelectedFirmId(e.target.value)}
                >
                  {userFirms && userFirms.length > 0 ? (
                    userFirms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))
                  ) : (
                    <option value={currentFirm?.id ?? ""}>
                      {currentFirm?.name ?? "Default Firm"}
                    </option>
                  )}
                </NativeSelect>
              </Field>

              <Field label="GST / Tax Rate (%)">
                <NativeSelect value={invTaxRate} onChange={(e) => setInvTaxRate(e.target.value)}>
                  <option value="0">0% (Exempt)</option>
                  <option value="5">5% GST</option>
                  <option value="12">12% GST</option>
                  <option value="18">18% GST (Standard)</option>
                  <option value="28">28% GST</option>
                </NativeSelect>
              </Field>

              <Field label="Payment Due Date">
                <Input
                  type="date"
                  value={invDueDate}
                  onChange={(e) => setInvDueDate(e.target.value)}
                />
              </Field>

              <Field label="Invoice Notes (Optional)">
                <Input
                  value={invNotes}
                  onChange={(e) => setInvNotes(e.target.value)}
                  placeholder="Terms or bank remarks..."
                />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setInvoiceModalJob(null)}
                >
                  Cancel
                </Button>
                <Button size="sm" disabled={busy} onClick={handleCreateInvoice}>
                  {busy ? "Generating…" : "Generate Invoice"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
