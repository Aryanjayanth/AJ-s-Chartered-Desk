/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Wallet,
  ReceiptIndianRupee,
  CheckCircle2,
  Clock,
  Plus,
  ArrowRight,
  ArrowLeft,
  CreditCard,
  Building,
  Calendar,
  AlertCircle,
  FileText,
  Percent,
  Search,
  Check,
  X,
  Layers,
  Sparkles,
  Zap,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PageHeader,
  Field,
  NativeSelect,
  ClientSelect,
  DateRangePicker,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { DataTable } from "@/components/app/DataTable";
import { usePermissions } from "@/hooks/use-permissions";
import { manualAllocatePayment, recordPaymentEntry } from "@/lib/firms.functions";
import { cn } from "@/lib/utils";
import {
  errMsg,
  fmtDate,
  inr,
  JOB_STATUSES,
  jobDisplayStatus,
  label,
  MODES,
  today,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clearing")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { client?: string; payment?: string; job?: string } => ({
    client: typeof s.client === "string" ? s.client : undefined,
    payment: typeof s.payment === "string" ? s.payment : undefined,
    job: typeof s.job === "string" ? s.job : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Payment Clearing — AJ's Chartered Desk" },
      {
        name: "description",
        content:
          "Manual payment clearing and allocation desk across jobs and reimbursable client expenses.",
      },
    ],
  }),
  component: ClearingDeskPage,
});

interface PaymentRow {
  id: string;
  payment_code: string;
  client_id: string;
  client_name: string;
  client_code: string;
  client_mobile?: string | null;
  job_id?: string | null;
  job_code?: string | null;
  job_title?: string | null;
  amount: number;
  allocated_amount: number;
  available_amount: number;
  payment_date: string;
  mode: string;
  status: string;
  narration: string | null;
  cleared_jobs?: {
    job_id?: string;
    job_code?: string;
    title?: string;
    allocated_amount: number;
    invoice_no?: string;
  }[];
}

interface ClientJob {
  id: string;
  job_code: string;
  title: string;
  client_id: string;
  status: string;
  financial_status: string | null;
  fee: number;
  discount: number;
  net_amount: number;
  paid_amount: number;
  service_name: string;
  due_date: string | null;
  created_at: string;
  invoice_no?: string | null;
  invoice_id?: string | null;
}

interface ClientExpense {
  id: string;
  kind: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  mode: string;
  client_id: string | null;
  job_id: string | null;
  notes: string | null;
}

const PAYMENT_MODES = [
  { value: "bank", label: "Bank Transfer / NEFT / RTGS" },
  { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

function ClearingDeskPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const qc = useQueryClient();
  const { canCreate, canEdit } = usePermissions();

  // Filters for Main Payments History View
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "partial" | "cleared">(
    "available",
  );
  const [clientFilter, setClientFilter] = useState<string>(search.client ?? "");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Record Payment Modal state
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [recordForm, setRecordForm] = useState({
    clientId: search.client ?? "",
    jobId: search.job ?? "",
    amount: "",
    paymentDate: today(),
    mode: "bank",
    narration: "Advance Client Deposit",
  });
  const [isSavingRecord, setIsSavingRecord] = useState(false);

  // Complete Window Allocation Workspace State
  const [allocatingPayment, setAllocatingPayment] = useState<PaymentRow | null>(null);
  const [jobAllocations, setJobAllocations] = useState<
    Record<string, { amount: number; discount: number }>
  >({});
  const [expenseAllocations, setExpenseAllocations] = useState<
    Record<string, { amount: number; discount: number }>
  >({});
  const [isAllocating, setIsAllocating] = useState(false);

  // 1. Fetch All Payments (including linked job and cleared jobs from allocations)
  const paymentsQuery = useQuery({
    queryKey: ["clearing-payments-list"],
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          `id, payment_code, client_id, job_id, amount, allocated_amount, payment_date, mode, status, narration,
           clients(id, name, client_code, mobile),
           jobs:job_id(id, job_code, title),
           payment_allocations(
             amount,
             invoices(id, invoice_no, job_id, jobs:job_id(id, job_code, title))
           )`,
        )
        .order("payment_date", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((p: any) => {
        const amt = Number(p.amount || 0);
        const alloc = Number(p.allocated_amount || 0);
        const avail = Math.max(0, amt - alloc);

        const clearedList: {
          job_id?: string;
          job_code?: string;
          title?: string;
          allocated_amount: number;
          invoice_no?: string;
        }[] = [];

        (p.payment_allocations ?? []).forEach((pa: any) => {
          const inv = pa.invoices;
          if (inv?.jobs) {
            clearedList.push({
              job_id: inv.jobs.id,
              job_code: inv.jobs.job_code,
              title: inv.jobs.title,
              allocated_amount: Number(pa.amount || 0),
              invoice_no: inv.invoice_no,
            });
          }
        });

        return {
          id: p.id,
          payment_code: p.payment_code ?? "—",
          client_id: p.client_id,
          client_name: p.clients?.name ?? "Unknown Client",
          client_code: p.clients?.client_code ?? "",
          client_mobile: p.clients?.mobile ?? null,
          job_id: p.job_id ?? null,
          job_code: p.jobs?.job_code ?? null,
          job_title: p.jobs?.title ?? null,
          amount: amt,
          allocated_amount: alloc,
          available_amount: avail,
          payment_date: p.payment_date ?? today(),
          mode: p.mode ?? "bank",
          status: p.status ?? "unallocated",
          narration: p.narration ?? null,
          cleared_jobs: clearedList,
        };
      });
    },
  });

  // 2. Fetch Jobs for clearing
  const jobsQuery = useQuery({
    queryKey: ["clearing-jobs-list"],
    queryFn: async (): Promise<ClientJob[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, job_code, title, client_id, status, financial_status, fee, discount, net_amount, due_date, created_at, services(name), invoice_items(invoice_id, invoices(id, invoice_no, status, total, amount_paid, outstanding)), job_clearing(advance, discount, final_amount, status)",
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((j: any) => {
        const fee = Number(j.fee || 0);
        const discount = Number(j.discount || 0);
        const baseNet = Number(j.net_amount || fee);

        const clearingRec = Array.isArray(j.job_clearing) ? j.job_clearing[0] : j.job_clearing;
        const initialAdvance = Number(clearingRec?.advance || 0);

        const activeInvs = ((j.invoice_items as any[]) ?? [])
          .map((it: any) => it.invoices)
          .filter((inv: any) => inv && inv.status !== "cancelled");

        const hasInvoice = activeInvs.length > 0;
        const firstInv = activeInvs[0];

        const invPaid = activeInvs.reduce(
          (sum: number, inv: any) => sum + Number(inv.amount_paid || 0),
          0,
        );
        const invOutstanding = activeInvs.reduce(
          (sum: number, inv: any) =>
            sum +
            Math.max(
              0,
              Number(inv.outstanding ?? Number(inv.total || 0) - Number(inv.amount_paid || 0)),
            ),
          0,
        );

        // Effective prior paid amount (from invoice allocations or initial advance)
        const totalPriorPaid = hasInvoice ? invPaid : initialAdvance;

        // If invoiced, the net due to be cleared is the actual unpaid invoice outstanding; otherwise deduct initial advance
        const netDue = hasInvoice ? invOutstanding : Math.max(0, baseNet - initialAdvance);

        return {
          id: j.id,
          job_code: j.job_code ?? "",
          title: j.title ?? "",
          client_id: j.client_id ?? "",
          status: j.status ?? "pending",
          financial_status: j.financial_status ?? "open",
          fee,
          discount,
          net_amount: netDue,
          paid_amount: totalPriorPaid,
          service_name: j.services?.name ?? "General Service",
          due_date: j.due_date ?? null,
          created_at: j.created_at ?? "",
          invoice_no: firstInv?.invoice_no ?? null,
          invoice_id: firstInv?.id ?? null,
        };
      });
    },
  });

  // 3. Fetch Reimbursable Expenses for clearing (both linked and unlinked to jobs)
  const expensesQuery = useQuery({
    queryKey: ["clearing-expenses-list"],
    queryFn: async (): Promise<ClientExpense[]> => {
      const { data, error } = await supabase
        .from("expenses")
        .select(
          "id, kind, expense_date, category, description, amount, mode, client_id, job_id, notes",
        )
        .order("expense_date", { ascending: false });

      if (error) throw error;
      return (data ?? []) as ClientExpense[];
    },
  });

  const allPayments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);
  const allJobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  const allExpenses = useMemo(() => expensesQuery.data ?? [], [expensesQuery.data]);

  // Filtered Payments for main table
  const filteredPayments = useMemo(() => {
    return allPayments.filter((p) => {
      if (statusFilter === "available" && p.available_amount <= 0) return false;
      if (statusFilter === "partial" && (p.allocated_amount <= 0 || p.available_amount <= 0))
        return false;
      if (statusFilter === "cleared" && p.available_amount > 0) return false;

      if (clientFilter && p.client_id !== clientFilter) return false;
      if (dateFrom && p.payment_date < dateFrom) return false;
      if (dateTo && p.payment_date > dateTo) return false;

      return true;
    });
  }, [allPayments, statusFilter, clientFilter, dateFrom, dateTo]);

  // Overall KPIs
  const totalAvailableAdvance = useMemo(() => {
    return allPayments.reduce((sum, p) => sum + p.available_amount, 0);
  }, [allPayments]);

  const totalUnclearedJobsFee = useMemo(() => {
    return allJobs
      .filter((j) => j.financial_status !== "closed")
      .reduce((sum, j) => sum + j.net_amount, 0);
  }, [allJobs]);

  const totalReimbursableExpenses = useMemo(() => {
    return allExpenses
      .filter((e) => e.client_id && !e.notes?.includes("Cleared in"))
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  }, [allExpenses]);

  // Open Allocation Workspace in Complete Window
  const handleOpenAllocation = (payment: PaymentRow, targetJobId?: string) => {
    setAllocatingPayment(payment);
    const initialJobAllocs: Record<string, { amount: number; discount: number }> = {};

    const targetId = targetJobId || payment.job_id || search.job;
    const clientJobs = allJobs.filter(
      (j) => j.client_id === payment.client_id && j.financial_status !== "closed" && j.net_amount > 0,
    );

    if (targetId) {
      const targetJob = clientJobs.find((j) => j.id === targetId);
      if (targetJob && payment.available_amount > 0) {
        initialJobAllocs[targetJob.id] = {
          amount: Math.min(payment.available_amount, targetJob.net_amount),
          discount: 0,
        };
      }
    } else if (clientJobs.length === 1 && payment.available_amount > 0) {
      const singleJob = clientJobs[0];
      initialJobAllocs[singleJob.id] = {
        amount: Math.min(payment.available_amount, singleJob.net_amount),
        discount: 0,
      };
    }

    setJobAllocations(initialJobAllocs);
    setExpenseAllocations({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // URL deep-linking (?payment=... or ?job=... or ?client=...)
  useEffect(() => {
    if (!allPayments.length) return;
    if (search.payment) {
      const match = allPayments.find((p) => p.id === search.payment);
      if (match && (!allocatingPayment || allocatingPayment.id !== match.id)) {
        handleOpenAllocation(match, search.job);
      }
    } else if (search.job) {
      const match = allPayments.find(
        (p) =>
          (p.job_id === search.job || (search.client && p.client_id === search.client)) &&
          p.available_amount > 0,
      );
      if (match && (!allocatingPayment || allocatingPayment.id !== match.id)) {
        handleOpenAllocation(match, search.job);
      } else if (!match && allJobs.length > 0 && !allocatingPayment) {
        // No unallocated credit available for this client: automatically open Record & Clear Payment modal for this job!
        const targetJob = allJobs.find((j) => j.id === search.job);
        if (targetJob && targetJob.net_amount > 0 && !isRecordModalOpen) {
          setRecordForm({
            clientId: targetJob.client_id,
            jobId: targetJob.id,
            amount: String(targetJob.net_amount),
            paymentDate: today(),
            mode: "bank",
            narration: `Clearing settlement for job ${targetJob.job_code} (${targetJob.title})`,
          });
          setIsRecordModalOpen(true);
        }
      }
    }
  }, [search.payment, search.job, search.client, allPayments]);

  // Jobs needing payment for the selected client in the allocation workspace
  const clientJobsToPay = useMemo(() => {
    if (!allocatingPayment) return [];
    return allJobs.filter(
      (j) =>
        j.client_id === allocatingPayment.client_id &&
        j.financial_status !== "closed" &&
        j.net_amount > 0,
    );
  }, [allocatingPayment, allJobs]);

  // Expenses needing payment for the selected client in the allocation workspace
  const clientExpensesToPay = useMemo(() => {
    if (!allocatingPayment) return [];
    return allExpenses.filter(
      (e) => e.client_id === allocatingPayment.client_id && !e.notes?.includes("Cleared in"),
    );
  }, [allocatingPayment, allExpenses]);

  // Auto-fill all open dues up to available balance
  const handleAutoAllocateAll = () => {
    if (!allocatingPayment || paymentAvailable <= 0) return;
    let rem = paymentAvailable;
    const nextJobAllocs: Record<string, { amount: number; discount: number }> = {};
    const nextExpAllocs: Record<string, { amount: number; discount: number }> = {};

    if (allocatingPayment.job_id) {
      const linked = clientJobsToPay.find((j) => j.id === allocatingPayment.job_id);
      if (linked && rem > 0) {
        const amt = Math.min(rem, linked.net_amount);
        nextJobAllocs[linked.id] = { amount: amt, discount: 0 };
        rem -= amt;
      }
    }

    for (const job of clientJobsToPay) {
      if (job.id === allocatingPayment.job_id) continue;
      if (rem <= 0) break;
      const amt = Math.min(rem, job.net_amount);
      if (amt > 0) {
        nextJobAllocs[job.id] = { amount: amt, discount: 0 };
        rem -= amt;
      }
    }

    for (const exp of clientExpensesToPay) {
      if (rem <= 0) break;
      const amt = Math.min(rem, exp.amount);
      if (amt > 0) {
        nextExpAllocs[exp.id] = { amount: amt, discount: 0 };
        rem -= amt;
      }
    }

    setJobAllocations(nextJobAllocs);
    setExpenseAllocations(nextExpAllocs);
    toast.success("Auto-filled available payment balance across open dues");
  };

  // Live calculation of manual allocations
  const currentLiveJobAllocTotal = useMemo(() => {
    return Object.values(jobAllocations).reduce((sum, j) => sum + (Number(j.amount) || 0), 0);
  }, [jobAllocations]);

  const currentLiveExpAllocTotal = useMemo(() => {
    return Object.values(expenseAllocations).reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
  }, [expenseAllocations]);

  const currentLiveTotalAllocated = currentLiveJobAllocTotal + currentLiveExpAllocTotal;
  const paymentAvailable = allocatingPayment?.available_amount ?? 0;
  const liveRemaining = paymentAvailable - currentLiveTotalAllocated;
  const isOverallocated = liveRemaining < -0.01;

  // Real-time individual allocation & discount error detection
  const individualErrors = useMemo(() => {
    const list: { id: string; name: string; message: string }[] = [];

    clientJobsToPay.forEach((job) => {
      const alloc = Number(jobAllocations[job.id]?.amount || 0);
      const disc = Number(jobAllocations[job.id]?.discount || 0);
      const maxAllowed = Math.max(0, job.net_amount - disc);

      if (disc > job.net_amount + 0.01) {
        list.push({
          id: job.id,
          name: job.job_code,
          message: `Job ${job.job_code}: Discount (${inr(disc)}) exceeds net due (${inr(job.net_amount)})`,
        });
      }
      if (alloc > maxAllowed + 0.01) {
        list.push({
          id: job.id,
          name: job.job_code,
          message: `Job ${job.job_code}: Allocation (${inr(alloc)}) exceeds allowable balance (${inr(maxAllowed)})`,
        });
      }
    });

    clientExpensesToPay.forEach((exp) => {
      const alloc = Number(expenseAllocations[exp.id]?.amount || 0);
      const disc = Number(expenseAllocations[exp.id]?.discount || 0);
      const maxAllowed = Math.max(0, exp.amount - disc);

      if (disc > exp.amount + 0.01) {
        list.push({
          id: exp.id,
          name: exp.description || "Outlay",
          message: `Outlay "${exp.description}": Discount (${inr(disc)}) exceeds outlay amount (${inr(exp.amount)})`,
        });
      }
      if (alloc > maxAllowed + 0.01) {
        list.push({
          id: exp.id,
          name: exp.description || "Outlay",
          message: `Outlay "${exp.description}": Allocation (${inr(alloc)}) exceeds allowable balance (${inr(maxAllowed)})`,
        });
      }
    });

    return list;
  }, [clientJobsToPay, clientExpensesToPay, jobAllocations, expenseAllocations]);

  const hasIndividualErrors = individualErrors.length > 0;
  const cannotConfirm = isOverallocated || hasIndividualErrors;
  const firstErrorMessage = isOverallocated
    ? `Total allocation (${inr(currentLiveTotalAllocated)}) exceeds available payment (${inr(paymentAvailable)}) by ${inr(Math.abs(liveRemaining))}`
    : individualErrors[0]?.message ?? "";

  const hasJobAction = useMemo(() => {
    return Object.values(jobAllocations).some((j) => (j.amount || 0) > 0 || (j.discount || 0) > 0);
  }, [jobAllocations]);

  const hasExpAction = useMemo(() => {
    return Object.values(expenseAllocations).some(
      (e) => (e.amount || 0) > 0 || (e.discount || 0) > 0,
    );
  }, [expenseAllocations]);

  const currentLiveJobDiscTotal = useMemo(() => {
    return Object.values(jobAllocations).reduce((sum, j) => sum + (Number(j.discount) || 0), 0);
  }, [jobAllocations]);

  const currentLiveExpDiscTotal = useMemo(() => {
    return Object.values(expenseAllocations).reduce(
      (sum, e) => sum + (Number(e?.discount) || 0),
      0,
    );
  }, [expenseAllocations]);

  const currentLiveTotalDiscount = currentLiveJobDiscTotal + currentLiveExpDiscTotal;

  // Manual allocation input updater for a Job
  const handleJobAmountChange = (jobId: string, amountStr: string) => {
    if (amountStr === "") {
      setJobAllocations((prev) => ({
        ...prev,
        [jobId]: { amount: 0, discount: prev[jobId]?.discount ?? 0 },
      }));
      return;
    }
    const val = parseFloat(amountStr);
    if (isNaN(val)) return;
    setJobAllocations((prev) => ({
      ...prev,
      [jobId]: {
        amount: Math.max(0, val),
        discount: prev[jobId]?.discount ?? 0,
      },
    }));
  };

  const handleJobDiscountChange = (jobId: string, discStr: string) => {
    if (discStr === "") {
      setJobAllocations((prev) => ({
        ...prev,
        [jobId]: { amount: prev[jobId]?.amount ?? 0, discount: 0 },
      }));
      return;
    }
    const val = parseFloat(discStr);
    if (isNaN(val)) return;
    setJobAllocations((prev) => ({
      ...prev,
      [jobId]: {
        amount: prev[jobId]?.amount ?? 0,
        discount: Math.max(0, val),
      },
    }));
  };

  // Manual allocation input updater for an Expense
  const handleExpenseAmountChange = (expId: string, amountStr: string) => {
    if (amountStr === "") {
      setExpenseAllocations((prev) => ({
        ...prev,
        [expId]: { amount: 0, discount: prev[expId]?.discount ?? 0 },
      }));
      return;
    }
    const val = parseFloat(amountStr);
    if (isNaN(val)) return;
    setExpenseAllocations((prev) => ({
      ...prev,
      [expId]: {
        amount: Math.max(0, val),
        discount: prev[expId]?.discount ?? 0,
      },
    }));
  };

  // Manual discount/waiver input updater for an Expense
  const handleExpenseDiscountChange = (expId: string, discStr: string) => {
    if (discStr === "") {
      setExpenseAllocations((prev) => ({
        ...prev,
        [expId]: { amount: prev[expId]?.amount ?? 0, discount: 0 },
      }));
      return;
    }
    const val = parseFloat(discStr);
    if (isNaN(val)) return;
    setExpenseAllocations((prev) => ({
      ...prev,
      [expId]: {
        amount: prev[expId]?.amount ?? 0,
        discount: Math.max(0, val),
      },
    }));
  };

  // Save Manual Allocation
  const handleConfirmManualAllocation = async () => {
    if (!allocatingPayment) return;
    if (cannotConfirm) {
      toast.error(firstErrorMessage);
      return;
    }

    let targetJobAllocs = { ...jobAllocations };
    const targetExpAllocs = { ...expenseAllocations };

    let hasJobAction = Object.values(targetJobAllocs).some(
      (j) => (j.amount || 0) > 0 || (j.discount || 0) > 0,
    );
    const hasExpAction = Object.values(targetExpAllocs).some(
      (e) => (e.amount || 0) > 0 || (e.discount || 0) > 0,
    );

    // If nothing entered yet, auto-allocate available balance to target or first job
    if (!hasJobAction && !hasExpAction) {
      if (paymentAvailable > 0 && clientJobsToPay.length > 0) {
        const target =
          (allocatingPayment.job_id &&
            clientJobsToPay.find((j) => j.id === allocatingPayment.job_id)) ||
          clientJobsToPay[0];
        const amt = Math.min(paymentAvailable, target.net_amount);
        targetJobAllocs = { [target.id]: { amount: amt, discount: 0 } };
        setJobAllocations(targetJobAllocs);
        hasJobAction = true;
      } else {
        toast.error(
          "Please enter manual allocation amount(s) or discount(s) for at least one job or expense.",
        );
        return;
      }
    }

    const totalToAllocate =
      Object.values(targetJobAllocs).reduce((sum, j) => sum + (Number(j.amount) || 0), 0) +
      Object.values(targetExpAllocs).reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);

    if (totalToAllocate > paymentAvailable + 0.01) {
      toast.error(
        `Total allocation (${inr(totalToAllocate)}) exceeds available payment balance (${inr(paymentAvailable)})`,
      );
      return;
    }

    // Validate that no expense allocation exceeds its actual outlay amount or net due
    for (const [expId, item] of Object.entries(targetExpAllocs)) {
      if ((item.amount || 0) <= 0 && (item.discount || 0) <= 0) continue;
      const exp = clientExpensesToPay.find((e) => e.id === expId);
      const maxExpDue = exp ? Math.max(0, exp.amount - (item.discount || 0)) : 0;
      if (exp && item.amount > maxExpDue + 0.01) {
        toast.error(
          `Outlay "${exp.description}" allocation (${inr(item.amount)}) exceeds net outlay due (${inr(maxExpDue)})`,
        );
        return;
      }
      if (exp && (item.discount || 0) > exp.amount + 0.01) {
        toast.error(
          `Outlay "${exp.description}" discount (${inr(item.discount)}) cannot exceed outlay amount (${inr(exp.amount)})`,
        );
        return;
      }
    }

    // Validate that no job allocation exceeds its net due
    for (const [jobId, item] of Object.entries(targetJobAllocs)) {
      if ((item.amount || 0) <= 0 && (item.discount || 0) <= 0) continue;
      const job = clientJobsToPay.find((j) => j.id === jobId);
      const maxJobDue = job ? Math.max(0, job.net_amount - (item.discount || 0)) : 0;
      if (job && item.amount > maxJobDue + 0.01) {
        toast.error(
          `Job "${job.job_code}" allocation (${inr(item.amount)}) exceeds net due (${inr(maxJobDue)})`,
        );
        return;
      }
      if (job && (item.discount || 0) > job.net_amount + 0.01) {
        toast.error(
          `Job "${job.job_code}" discount (${inr(item.discount)}) cannot exceed fee (${inr(job.net_amount)})`,
        );
        return;
      }
    }

    setIsAllocating(true);
    const toastId = toast.loading("Processing manual allocation & clearing...");

    try {
      const jAllocs = Object.entries(targetJobAllocs)
        .filter(([_, v]) => (v.amount || 0) > 0 || (v.discount || 0) > 0)
        .map(([jobId, v]) => ({
          jobId,
          amount: v.amount || 0,
          discount: v.discount || 0,
        }));

      const eAllocs = Object.entries(targetExpAllocs)
        .filter(([_, v]) => (v.amount || 0) > 0 || (v.discount || 0) > 0)
        .map(([expenseId, v]) => ({
          expenseId,
          amount: v.amount || 0,
          discount: v.discount || 0,
        }));

      const res = await manualAllocatePayment({
        data: {
          paymentId: allocatingPayment.id,
          jobAllocations: jAllocs,
          expenseAllocations: eAllocs,
        },
      });

      toast.dismiss(toastId);
      toast.success("Payment cleared successfully.", {
        description:
          res.remainingBalance > 0
            ? `Remaining credit balance: ${inr(res.remainingBalance)}.`
            : "Payment is now fully allocated and cleared.",
      });

      setAllocatingPayment(null);
      setJobAllocations({});
      setExpenseAllocations({});

      // Invalidate queries to refresh live data (non-blocking)
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["clearing-payments-list"] }),
        qc.invalidateQueries({ queryKey: ["clearing-jobs-list"] }),
        qc.invalidateQueries({ queryKey: ["clearing-expenses-list"] }),
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        qc.invalidateQueries({ queryKey: ["invoices"] }),
        qc.invalidateQueries({ queryKey: ["payments"] }),
      ]);

      navigate({ to: "/payments" });
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    } finally {
      setIsAllocating(false);
    }
  };

  // Save new Payment Entry (Advance / Deposit)
  const handleSavePaymentEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordForm.clientId) {
      toast.error("Please select a client");
      return;
    }
    const amt = parseFloat(recordForm.amount);
    if (!amt || amt <= 0) {
      toast.error("Please enter a valid payment amount greater than zero");
      return;
    }

    setIsSavingRecord(true);
    const toastId = toast.loading("Saving payment entry...");
    try {
      const res = await recordPaymentEntry({
        data: {
          clientId: recordForm.clientId,
          jobId: recordForm.jobId || null,
          amount: amt,
          paymentDate: recordForm.paymentDate,
          mode: recordForm.mode,
          narration: recordForm.narration,
          isAdvance: true,
          autoAllocate: true,
        },
      });

      toast.dismiss(toastId);
      if (recordForm.jobId && res.allocatedToJob && res.allocatedToJob > 0) {
        if (res.remainingCredit && res.remainingCredit > 0) {
          toast.success(
            `Payment of ${inr(amt)} recorded: ${inr(res.allocatedToJob)} cleared against job, and remaining ${inr(res.remainingCredit)} is stored as client credit!`,
          );
        } else {
          toast.success(`Payment of ${inr(amt)} recorded and cleared against job!`);
        }
      } else {
        toast.success(`Payment of ${inr(amt)} recorded successfully into client deposit history.`);
      }

      setIsRecordModalOpen(false);
      setRecordForm({
        clientId: "",
        jobId: "",
        amount: "",
        paymentDate: today(),
        mode: "bank",
        narration: "Advance Client Deposit",
      });

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["clearing-payments-list"] }),
        qc.invalidateQueries({ queryKey: ["payments"] }),
      ]);
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    } finally {
      setIsSavingRecord(false);
    }
  };

  // =========================================================================
  // VIEW 1: COMPLETE WINDOW PAYMENT ALLOCATION WORKSPACE
  // (Rendered in full page view, NOT a popup modal, with both Jobs & Expenses together)
  // =========================================================================
  if (allocatingPayment) {
    return (
      <div className="space-y-6 pb-12">
        {/* Workspace Top Sticky Navigation Bar */}
        <div className="sticky top-16 z-20 -mx-4 -mt-4 bg-background/95 backdrop-blur px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAllocatingPayment(null);
                setJobAllocations({});
                setExpenseAllocations({});
              }}
              className="h-8 gap-1.5 text-xs font-medium cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Payments History
            </Button>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-primary">
                  {allocatingPayment.payment_code}
                </span>
                <span className="text-sm font-bold text-foreground">
                  {allocatingPayment.client_name}
                </span>
                {allocatingPayment.client_code && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {allocatingPayment.client_code}
                  </Badge>
                )}
                {allocatingPayment.job_code && (
                  <Badge className="font-mono text-[10px] bg-primary/10 text-primary border-primary/30">
                    Job: {allocatingPayment.job_code}
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Receipt Date: {fmtDate(allocatingPayment.payment_date)} · Mode:{" "}
                <span className="capitalize">
                  {MODES[allocatingPayment.mode as keyof typeof MODES] ?? allocatingPayment.mode}
                </span>
                {allocatingPayment.narration ? ` · ${allocatingPayment.narration}` : ""}
                {allocatingPayment.job_title ? ` · Created for: ${allocatingPayment.job_title}` : ""}
              </div>
            </div>
          </div>

          {/* Top Header Actions (Quick fill shortcut; Confirm & Cancel buttons are below in the main action bar) */}
          <div className="flex items-center gap-2">
            {paymentAvailable > 0 &&
              (clientJobsToPay.length > 0 || clientExpensesToPay.length > 0) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAutoAllocateAll}
                  disabled={isAllocating}
                  className="gap-1.5 text-xs font-semibold text-primary border-primary/30 hover:bg-primary/5 cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Quick Clear (Auto-Fill)
                </Button>
              )}
          </div>
        </div>

        {/* Live Calculation KPI Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-muted/40 p-4 rounded-xl border">
          <div>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">
              Total Payment Receipt
            </div>
            <div className="font-mono text-lg font-bold text-foreground mt-0.5">
              {inr(allocatingPayment.amount)}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">
              Prior Allocated
            </div>
            <div className="font-mono text-lg font-bold text-muted-foreground mt-0.5">
              {inr(allocatingPayment.allocated_amount)}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">
              Available to Clear
            </div>
            <div className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {inr(paymentAvailable)}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">
              Allocating Now
            </div>
            <div className="font-mono text-lg font-bold text-primary mt-0.5">
              {inr(currentLiveTotalAllocated)}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              Jobs: {inr(currentLiveJobAllocTotal)} · Outlays: {inr(currentLiveExpAllocTotal)}
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l pt-2 sm:pt-0 sm:pl-3">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">
              Remaining Balance
            </div>
            <div
              className={cn(
                "font-mono text-lg font-bold mt-0.5",
                liveRemaining < 0
                  ? "text-destructive"
                  : liveRemaining === 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400",
              )}
            >
              {inr(liveRemaining)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {liveRemaining < 0
                ? "⚠️ Overallocated"
                : liveRemaining === 0
                  ? "✓ 100% Allocated"
                  : "Stays as credit balance"}
            </div>
          </div>
        </div>

        {/* Previous Cleared History Card (if this payment already cleared jobs/invoices) */}
        {allocatingPayment.cleared_jobs && allocatingPayment.cleared_jobs.length > 0 && (
          <Card className="border border-emerald-500/30 bg-emerald-500/5 shadow-none">
            <CardHeader className="py-2.5 px-4 border-b border-emerald-500/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <CardTitle className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  Past Clearing History for this Payment ({allocatingPayment.cleared_jobs.length}{" "}
                  allocation{allocatingPayment.cleared_jobs.length > 1 ? "s" : ""})
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-3 divide-y divide-emerald-500/10 text-xs">
              {allocatingPayment.cleared_jobs.map((cj, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-primary">{cj.job_code}</span>
                    <span className="text-foreground">{cj.title}</span>
                    {cj.invoice_no && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {cj.invoice_no}
                      </Badge>
                    )}
                  </div>
                  <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    Cleared: {inr(cj.allocated_amount)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isOverallocated && (
          <div className="text-xs font-semibold text-destructive flex items-center gap-2 bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Total allocation ({inr(currentLiveTotalAllocated)}) exceeds available payment (
              {inr(paymentAvailable)}) by {inr(Math.abs(liveRemaining))}. Please reduce the entered
              amounts.
            </span>
          </div>
        )}

        {hasIndividualErrors && (
          <div className="text-xs font-semibold text-destructive flex items-center gap-2 bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Allocation error: {firstErrorMessage}. Please correct the entered amounts or discounts to match the remaining dues.
            </span>
          </div>
        )}

        {/* BOTH JOBS AND EXPENSES ON THE SAME PAGE (NO TABS) */}
        <div className="space-y-8">
          {/* SECTION 1: JOBS NEEDING PAYMENT */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="flex items-center gap-2">
                <ReceiptIndianRupee className="h-4 w-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">
                  Jobs Needing Payment ({clientJobsToPay.length})
                </h2>
              </div>
              <div className="flex items-center gap-3">
                {paymentAvailable > 0 && clientJobsToPay.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAutoAllocateAll}
                    className="h-7 text-xs text-primary font-semibold hover:bg-primary/10 gap-1 cursor-pointer"
                  >
                    <Zap className="h-3 w-3" />
                    Quick Auto-Fill
                  </Button>
                )}
                <div className="text-xs font-mono font-medium text-muted-foreground">
                  Allocated to Jobs:{" "}
                  <span className="font-bold text-foreground">{inr(currentLiveJobAllocTotal)}</span>
                </div>
              </div>
            </div>

            {clientJobsToPay.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                No open or unbilled jobs found for this client.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {clientJobsToPay.map((job) => {
                  const curAlloc = jobAllocations[job.id]?.amount ?? "";
                  const curDisc = jobAllocations[job.id]?.discount ?? "";
                  const curAllocNum = parseFloat(String(curAlloc)) || 0;
                  const curDiscNum = parseFloat(String(curDisc)) || 0;
                  const netDue = Math.max(0, job.net_amount - curDiscNum);
                  const isAllocExceeded = curAllocNum > netDue + 0.01;
                  const isDiscExceeded = curDiscNum > job.net_amount + 0.01;
                  const isCardOverLimit = isAllocExceeded || isDiscExceeded;

                  return (
                    <div
                      key={job.id}
                      className={cn(
                        "rounded-lg border p-4 bg-card transition-all space-y-3",
                        isCardOverLimit
                          ? "border-destructive/80 bg-destructive/5 shadow-xs"
                          : Number(curAlloc) > 0
                            ? "border-primary/60 shadow-xs bg-primary/2"
                            : "hover:border-border",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-primary">
                              {job.job_code}
                            </span>
                            {allocatingPayment.job_id === job.id && (
                              <Badge className="bg-primary text-primary-foreground text-[10px] font-semibold">
                                Origin Job for Payment
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-[10px]">
                              {job.service_name}
                            </Badge>
                            <StatusBadge status={job.status} />
                            {isCardOverLimit && (
                              <Badge variant="destructive" className="text-[10px] font-bold">
                                Exceeds Due
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs font-semibold text-foreground mt-1">
                            {job.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            Created: {fmtDate(job.created_at)}
                            {job.due_date ? ` · Due: ${fmtDate(job.due_date)}` : ""}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[11px] text-muted-foreground">
                            Fee: <span className="font-mono font-semibold">{inr(job.fee)}</span>
                          </div>
                          {job.discount > 0 && (
                            <div className="text-[10px] text-emerald-600 font-mono">
                              Prior Discount: -{inr(job.discount)}
                            </div>
                          )}
                          {job.paid_amount > 0 && (
                            <div className="text-[10px] text-blue-600 font-mono">
                              Prior Paid: -{inr(job.paid_amount)}
                              {job.invoice_no ? ` (${job.invoice_no})` : ""}
                            </div>
                          )}
                          <div className="text-sm font-mono font-bold text-primary mt-0.5">
                            Net Due: {inr(job.net_amount)}
                          </div>
                          {curDiscNum > 0 && (
                            <div className="text-[11px] font-mono font-semibold text-emerald-600">
                              After Disc: {inr(netDue)}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Manual Entry Inputs with Fast Fill Action Box */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-3 border-t items-end">
                        <div className="sm:col-span-6">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              Manual Amount to Allocate (₹) *
                              {isAllocExceeded && (
                                <span className="text-[10px] text-destructive font-bold">
                                  (MAX: {inr(netDue)})
                                </span>
                              )}
                            </label>
                            {netDue > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const allocWithoutCurrent =
                                    currentLiveTotalAllocated - curAllocNum;
                                  const roomAvailable = Math.max(
                                    0,
                                    paymentAvailable - allocWithoutCurrent,
                                  );
                                  const targetAmt = Math.min(netDue, roomAvailable);
                                  handleJobAmountChange(job.id, String(targetAmt));
                                }}
                                className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                              >
                                Fill Full ({inr(netDue)})
                              </button>
                            )}
                          </div>
                          <div className="relative">
                            <Input
                              type="number"
                              min={0}
                              max={netDue}
                              step="any"
                              value={curAlloc}
                              onChange={(e) =>
                                handleJobAmountChange(job.id, e.target.value)
                              }
                              placeholder="0.00"
                              className={cn(
                                "font-mono text-xs h-9 pr-12 font-semibold transition-colors",
                                isAllocExceeded
                                  ? "border-destructive text-destructive bg-destructive/10 ring-1 ring-destructive focus-visible:ring-destructive"
                                  : Number(curAlloc) > 0 && "border-primary/50",
                              )}
                            />
                            {Number(curAlloc) > 0 && (
                              <button
                                type="button"
                                onClick={() => handleJobAmountChange(job.id, "")}
                                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Clear amount"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          {isAllocExceeded ? (
                            <div className="flex items-center justify-between gap-1 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[11px] font-semibold mt-1.5 animate-in fade-in">
                              <div className="flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>Allocation ({inr(curAllocNum)}) exceeds net due ({inr(netDue)})</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleJobAmountChange(job.id, String(netDue))}
                                className="underline text-[10px] font-bold shrink-0 hover:opacity-80 cursor-pointer"
                              >
                                Set to {inr(netDue)}
                              </button>
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Max allowable allocation for this job is {inr(netDue)}
                            </p>
                          )}
                        </div>

                        <div className="sm:col-span-6">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              Award Discount (₹) (Optional)
                              {isDiscExceeded && (
                                <span className="text-[10px] text-destructive font-bold">
                                  (MAX: {inr(job.net_amount)})
                                </span>
                              )}
                            </label>
                            {job.net_amount > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                Max: {inr(job.net_amount)}
                              </span>
                            )}
                          </div>
                          <div className="relative">
                            <Input
                              type="number"
                              min={0}
                              max={job.net_amount}
                              step="any"
                              value={curDisc}
                              onChange={(e) =>
                                handleJobDiscountChange(job.id, e.target.value)
                              }
                              placeholder="0.00"
                              className={cn(
                                "font-mono text-xs h-9 pr-12 transition-colors",
                                isDiscExceeded
                                  ? "border-destructive text-destructive bg-destructive/10 ring-1 ring-destructive focus-visible:ring-destructive"
                                  : Number(curDisc) > 0 && "border-emerald-500/50",
                              )}
                            />
                            {Number(curDisc) > 0 && (
                              <button
                                type="button"
                                onClick={() => handleJobDiscountChange(job.id, "")}
                                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Clear discount"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          {isDiscExceeded ? (
                            <div className="flex items-center justify-between gap-1 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[11px] font-semibold mt-1.5 animate-in fade-in">
                              <div className="flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>Discount ({inr(curDiscNum)}) exceeds remaining fee ({inr(job.net_amount)})</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleJobDiscountChange(job.id, String(job.net_amount))}
                                className="underline text-[10px] font-bold shrink-0 hover:opacity-80 cursor-pointer"
                              >
                                Set to {inr(job.net_amount)}
                              </button>
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Reduces fee and squares off remaining invoice balance
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: REIMBURSABLE EXPENSES & OUTLAYS (Directly on the same page) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-amber-600" />
                <h2 className="text-base font-bold text-foreground">
                  Reimbursable Expenses &amp; Outlays ({clientExpensesToPay.length})
                </h2>
              </div>
              <div className="text-xs font-mono font-medium text-muted-foreground">
                Allocated to Outlays:{" "}
                <span className="font-bold text-foreground">{inr(currentLiveExpAllocTotal)}</span>
              </div>
            </div>

            {clientExpensesToPay.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                No uncleared reimbursable expenses found for this client.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {clientExpensesToPay.map((exp) => {
                  const curExpAlloc = expenseAllocations[exp.id]?.amount ?? "";
                  const curExpDisc = expenseAllocations[exp.id]?.discount ?? "";
                  const curExpAllocNum = parseFloat(String(curExpAlloc)) || 0;
                  const curExpDiscNum = parseFloat(String(curExpDisc)) || 0;
                  const netExpDue = Math.max(0, exp.amount - curExpDiscNum);
                  const isExpAllocExceeded = curExpAllocNum > netExpDue + 0.01;
                  const isExpDiscExceeded = curExpDiscNum > exp.amount + 0.01;
                  const isExpCardOverLimit = isExpAllocExceeded || isExpDiscExceeded;

                  return (
                    <div
                      key={exp.id}
                      className={cn(
                        "rounded-lg border p-4 bg-card transition-all space-y-3",
                        isExpCardOverLimit
                          ? "border-destructive/80 bg-destructive/5 shadow-xs"
                          : Number(curExpAlloc) > 0 || Number(curExpDisc) > 0
                            ? "border-amber-500/60 shadow-xs bg-amber-500/2"
                            : "hover:border-border",
                      )}
                    >
                      {/* Top Details & Figures Row */}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">
                              {exp.description}
                            </span>
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {exp.category}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] capitalize">
                              {exp.kind}
                            </Badge>
                            {exp.mode && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                Paid via {exp.mode}
                              </span>
                            )}
                            {isExpCardOverLimit && (
                              <Badge variant="destructive" className="text-[10px] font-bold">
                                Exceeds Due
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Expense Date: {fmtDate(exp.expense_date)}
                            {exp.job_id && (
                              <span className="ml-2 font-mono text-[10px] text-primary">
                                Linked to Job
                              </span>
                            )}
                            {exp.notes && (
                              <span className="ml-2 text-[10px] italic">· Note: {exp.notes}</span>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[11px] text-muted-foreground">
                            Outlay Incurred:{" "}
                            <span className="font-mono font-semibold">{inr(exp.amount)}</span>
                          </div>
                          {curExpDiscNum > 0 && (
                            <div className="text-[10px] text-emerald-600 font-mono">
                              Waiver / Discount: -{inr(curExpDiscNum)}
                            </div>
                          )}
                          <div className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                            Net Outlay Due: {inr(netExpDue)}
                          </div>
                        </div>
                      </div>

                      {/* Manual Entry Inputs with Fast Fill Action Box (2 Columns, Big & Clear) */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-3 border-t items-end">
                        <div className="sm:col-span-6">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              Manual Reimbursement (₹) *
                              {isExpAllocExceeded && (
                                <span className="text-[10px] text-destructive font-bold">
                                  (MAX: {inr(netExpDue)})
                                </span>
                              )}
                            </label>
                            {netExpDue > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const allocWithoutCurrent =
                                    currentLiveTotalAllocated - curExpAllocNum;
                                  const roomAvailable = Math.max(
                                    0,
                                    paymentAvailable - allocWithoutCurrent,
                                  );
                                  const targetAmt = Math.min(netExpDue, roomAvailable);
                                  handleExpenseAmountChange(exp.id, String(targetAmt));
                                }}
                                className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                              >
                                Fill Full Outlay ({inr(netExpDue)})
                              </button>
                            )}
                          </div>
                          <div className="relative">
                            <Input
                              type="number"
                              min={0}
                              max={netExpDue}
                              step="any"
                              value={curExpAlloc}
                              onChange={(e) =>
                                handleExpenseAmountChange(exp.id, e.target.value)
                              }
                              placeholder="0.00"
                              className={cn(
                                "font-mono text-xs h-9 pr-12 font-semibold transition-colors",
                                isExpAllocExceeded
                                  ? "border-destructive text-destructive bg-destructive/10 ring-1 ring-destructive focus-visible:ring-destructive"
                                  : Number(curExpAlloc) > 0 && "border-amber-500/50",
                              )}
                            />
                            {Number(curExpAlloc) > 0 && (
                              <button
                                type="button"
                                onClick={() => handleExpenseAmountChange(exp.id, "")}
                                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Clear reimbursement"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          {isExpAllocExceeded ? (
                            <div className="flex items-center justify-between gap-1 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[11px] font-semibold mt-1.5 animate-in fade-in">
                              <div className="flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>Reimbursement ({inr(curExpAllocNum)}) exceeds outlay due ({inr(netExpDue)})</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleExpenseAmountChange(exp.id, String(netExpDue))}
                                className="underline text-[10px] font-bold shrink-0 hover:opacity-80 cursor-pointer"
                              >
                                Set to {inr(netExpDue)}
                              </button>
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Max allowable reimbursement is {inr(netExpDue)}
                            </p>
                          )}
                        </div>

                        <div className="sm:col-span-6">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              Award Discount / Waiver (₹) (Optional)
                              {isExpDiscExceeded && (
                                <span className="text-[10px] text-destructive font-bold">
                                  (MAX: {inr(exp.amount)})
                                </span>
                              )}
                            </label>
                            {exp.amount > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                Max: {inr(exp.amount)}
                              </span>
                            )}
                          </div>
                          <div className="relative">
                            <Input
                              type="number"
                              min={0}
                              max={exp.amount}
                              step="any"
                              value={curExpDisc}
                              onChange={(e) =>
                                handleExpenseDiscountChange(exp.id, e.target.value)
                              }
                              placeholder="0.00"
                              className={cn(
                                "font-mono text-xs h-9 pr-12 transition-colors",
                                isExpDiscExceeded
                                  ? "border-destructive text-destructive bg-destructive/10 ring-1 ring-destructive focus-visible:ring-destructive"
                                  : Number(curExpDisc) > 0 && "border-emerald-500/50",
                              )}
                            />
                            {Number(curExpDisc) > 0 && (
                              <button
                                type="button"
                                onClick={() => handleExpenseDiscountChange(exp.id, "")}
                                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Clear discount"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          {isExpDiscExceeded ? (
                            <div className="flex items-center justify-between gap-1 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[11px] font-semibold mt-1.5 animate-in fade-in">
                              <div className="flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>Discount ({inr(curExpDiscNum)}) exceeds outlay amount ({inr(exp.amount)})</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleExpenseDiscountChange(exp.id, String(exp.amount))}
                                className="underline text-[10px] font-bold shrink-0 hover:opacity-80 cursor-pointer"
                              >
                                Set to {inr(exp.amount)}
                              </button>
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Waives client reimbursement obligation for this outlay
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Floating Bar */}
        <div className="sticky bottom-4 z-20 bg-card border p-4 rounded-xl shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <div>
              Total Allocating:{" "}
              <span className="font-mono font-bold text-foreground text-sm">
                {inr(currentLiveTotalAllocated)}
              </span>{" "}
              (Jobs: {inr(currentLiveJobAllocTotal)}, Outlays: {inr(currentLiveExpAllocTotal)})
              {currentLiveTotalDiscount > 0 && (
                <span className="text-emerald-600 font-medium ml-2 font-mono">
                  · Discounts Awarded: {inr(currentLiveTotalDiscount)}
                </span>
              )}
            </div>
            <div
              className={cn(
                "font-medium",
                liveRemaining < 0
                  ? "text-destructive"
                  : liveRemaining === 0
                    ? "text-emerald-600 font-semibold"
                    : "text-muted-foreground",
              )}
            >
              {liveRemaining < 0
                ? `Exceeds available payment by ${inr(Math.abs(liveRemaining))}`
                : liveRemaining === 0
                  ? "✓ 100% of Available Receipt Allocated"
                  : `Remaining credit balance: ${inr(liveRemaining)} (stays in advance jar for next clearing)`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAllocatingPayment(null);
                setJobAllocations({});
                setExpenseAllocations({});
              }}
              disabled={isAllocating}
            >
              Cancel
            </Button>
            {cannotConfirm && (
              <span className="text-xs text-destructive font-semibold hidden md:inline-flex items-center gap-1 max-w-md truncate">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {firstErrorMessage}
              </span>
            )}
            <Button
              size="sm"
              onClick={handleConfirmManualAllocation}
              disabled={
                isAllocating ||
                cannotConfirm ||
                (!hasJobAction && !hasExpAction && paymentAvailable <= 0)
              }
              className={cn(
                "gap-1.5 font-semibold shadow-sm transition-all",
                cannotConfirm && "opacity-75 cursor-not-allowed",
              )}
            >
              <Check className="h-4 w-4" />
              {isAllocating
                ? "Allocating…"
                : cannotConfirm
                  ? isOverallocated
                    ? `Overallocated (${inr(Math.abs(liveRemaining))})`
                    : "Exceeds Limit"
                  : currentLiveTotalAllocated > 0
                    ? `Confirm Manual Allocation (${inr(currentLiveTotalAllocated)})`
                    : "Confirm Clearing"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: MAIN PAYMENT CLEARING DESK & PAYMENT HISTORY
  // =========================================================================
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Clearing Desk"
        subtitle="Payment entry history and manual allocation against jobs and reimbursable client expenses."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/outstanding">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs font-medium">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Client Pendings
              </Button>
            </Link>
            <Link to="/ageing">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs font-medium">
                <CalendarClock className="h-3.5 w-3.5 text-primary" />
                Receivables Ageing
              </Button>
            </Link>
            {canCreate("payments") && (
              <Button onClick={() => setIsRecordModalOpen(true)} className="gap-1.5 shadow-sm">
                <Plus className="h-4 w-4" />
                Record Payment Entry
              </Button>
            )}
          </div>
        }
      />

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="shadow-none border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Available Advance Balance
              </p>
              <h3 className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {inr(totalAvailableAdvance)}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-1">
                Unallocated funds across all active client receipts
              </p>
            </div>
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Uncleared Jobs Due
              </p>
              <h3 className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
                {inr(totalUnclearedJobsFee)}
              </h3>
              <div className="mt-1">
                <Link
                  to="/outstanding"
                  className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
                >
                  View client pendings & ageing →
                </Link>
              </div>
            </div>
            <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <ReceiptIndianRupee className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Client Outlays &amp; Expenses
              </p>
              <h3 className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                {inr(totalReimbursableExpenses)}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-1">
                Direct client fees &amp; expenses awaiting reimbursement
              </p>
            </div>
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <CreditCard className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Payment History & Clearing Table */}
      <DataTable
        rows={filteredPayments}
        loading={paymentsQuery.isLoading}
        search={(p) =>
          `${p.payment_code} ${p.client_name} ${p.client_code} ${p.job_code ?? ""} ${p.job_title ?? ""} ${p.cleared_jobs?.map((c) => c.job_code).join(" ") ?? ""} ${p.narration ?? ""}`
        }
        exportFilename="payment_clearing_history"
        onRowClick={(p) => handleOpenAllocation(p)}
        toolbar={
          <>
            {/* Quick Status Segmented Filter */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg text-xs">
              <Button
                type="button"
                variant={statusFilter === "available" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("available")}
                className="h-7 px-2.5 text-xs font-medium"
              >
                Available to Allocate
              </Button>
              <Button
                type="button"
                variant={statusFilter === "partial" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("partial")}
                className="h-7 px-2.5 text-xs font-medium text-amber-600"
              >
                Partially Allocated
              </Button>
              <Button
                type="button"
                variant={statusFilter === "cleared" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("cleared")}
                className="h-7 px-2.5 text-xs font-medium text-emerald-600"
              >
                Fully Cleared
              </Button>
              <Button
                type="button"
                variant={statusFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("all")}
                className="h-7 px-2.5 text-xs font-medium text-muted-foreground"
              >
                All
              </Button>
            </div>

            <ClientSelect
              value={clientFilter}
              onChange={setClientFilter}
              placeholder="All clients"
              className="w-44 text-xs h-9"
              allowClear
            />

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
            key: "payment_code",
            header: "Receipt & Date",
            className: "w-28",
            sort: (p) => p.payment_date,
            render: (p) => (
              <div>
                <span className="font-mono text-xs font-semibold text-primary block leading-tight">
                  {p.payment_code}
                </span>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap block mt-0.5">
                  {fmtDate(p.payment_date)}
                </span>
              </div>
            ),
          },
          {
            key: "client_name",
            header: "Client",
            className: "min-w-[120px] max-w-[170px]",
            sort: (p) => p.client_name,
            render: (p) => (
              <div>
                <div className="text-xs font-medium text-foreground truncate" title={p.client_name}>
                  {p.client_name}
                </div>
                {p.client_code && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {p.client_code}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: "job",
            header: "Origin / Cleared Against",
            className: "min-w-[130px] max-w-[180px]",
            sort: (p) => p.job_code ?? p.cleared_jobs?.[0]?.job_code ?? "",
            render: (p) => (
              <div className="space-y-0.5">
                {p.job_code ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] uppercase font-semibold text-muted-foreground">
                      For:
                    </span>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] font-bold text-primary bg-primary/5 border-primary/20 py-0 px-1.5 h-4.5"
                      title={p.job_title ?? undefined}
                    >
                      {p.job_code}
                    </Badge>
                  </div>
                ) : null}
                {p.cleared_jobs && p.cleared_jobs.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {p.cleared_jobs.map((cj, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="text-[9px] font-mono py-0 px-1.5 h-4.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                        title={`${cj.job_code}: ${cj.title} (${inr(cj.allocated_amount)})`}
                      >
                        {cj.job_code} ({inr(cj.allocated_amount)})
                      </Badge>
                    ))}
                  </div>
                ) : !p.job_code ? (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    General Advance
                  </span>
                ) : null}
              </div>
            ),
          },
          {
            key: "mode",
            header: "Mode",
            className: "w-16",
            render: (p) => (
              <Badge variant="outline" className="text-[10px] capitalize font-medium py-0 px-1.5 whitespace-nowrap">
                {MODES[p.mode as keyof typeof MODES] ?? p.mode}
              </Badge>
            ),
          },
          {
            key: "amount",
            header: "Total",
            className: "w-24 text-right",
            sort: (p) => p.amount,
            render: (p) => <span className="font-mono text-xs font-semibold">{inr(p.amount)}</span>,
          },
          {
            key: "allocated_amount",
            header: "Allocated",
            className: "w-20 text-right",
            sort: (p) => p.allocated_amount,
            render: (p) => (
              <span className="font-mono text-xs text-muted-foreground">
                {inr(p.allocated_amount)}
              </span>
            ),
          },
          {
            key: "available_amount",
            header: "Available",
            className: "w-24 text-right",
            sort: (p) => p.available_amount,
            render: (p) => (
              <span
                className={cn(
                  "font-mono text-xs font-bold",
                  p.available_amount > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground opacity-60",
                )}
              >
                {inr(p.available_amount)}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            className: "w-28 text-center",
            render: (p) => {
              if (p.available_amount <= 0) {
                return (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] py-0 px-1.5 whitespace-nowrap"
                  >
                    Fully Cleared
                  </Badge>
                );
              }
              if (p.allocated_amount > 0) {
                return (
                  <Badge
                    variant="outline"
                    className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0 px-1.5 whitespace-nowrap"
                  >
                    Partially Allocated
                  </Badge>
                );
              }
              return (
                <Badge
                  variant="outline"
                  className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px] py-0 px-1.5 whitespace-nowrap"
                >
                  Unallocated
                </Badge>
              );
            },
          },
          {
            key: "action",
            header: "",
            className: "w-20 text-right",
            render: (p) => (
              <Button
                size="sm"
                variant={p.available_amount > 0 ? "default" : "outline"}
                className="h-7 text-xs px-2.5 font-medium cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAllocation(p);
                }}
              >
                {p.available_amount > 0 ? "Clear" : "View"}
              </Button>
            ),
          },
        ]}
      />

      {/* RECORD PAYMENT ENTRY DIALOG */}
      <Dialog open={isRecordModalOpen} onOpenChange={setIsRecordModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              {recordForm.jobId ? "Record & Clear Job Payment" : "Record Payment Entry"}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {recordForm.jobId
                ? "This payment will automatically clear and settle against the selected job."
                : "Add a client deposit or payment. It will be recorded into payment history ready for manual allocation."}
            </p>
          </DialogHeader>

          <form onSubmit={handleSavePaymentEntry} className="space-y-4 py-2">
            <Field label="Client *">
              <ClientSelect
                value={recordForm.clientId}
                onChange={(id) => setRecordForm((p) => ({ ...p, clientId: id, jobId: "" }))}
                placeholder="Select client…"
              />
            </Field>

            {recordForm.clientId && (
              <Field label="Link to Job (Optional)">
                <NativeSelect
                  value={recordForm.jobId}
                  onChange={(e) => {
                    const selJobId = e.target.value;
                    const selJob = allJobs.find((j) => j.id === selJobId);
                    setRecordForm((p) => ({
                      ...p,
                      jobId: selJobId,
                      amount: p.amount ? p.amount : selJob ? String(selJob.net_amount) : p.amount,
                      narration:
                        p.narration && p.narration !== "Advance Client Deposit"
                          ? p.narration
                          : selJob
                            ? `Advance for ${selJob.job_code}`
                            : p.narration,
                    }));
                  }}
                >
                  <option value="">General Client Deposit / Unlinked</option>
                  {allJobs
                    .filter((j) => j.client_id === recordForm.clientId)
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.job_code} — {j.title} (Net Due: {inr(j.net_amount)})
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₹) *">
                <Input
                  type="number"
                  min="0.01"
                  step="any"
                  value={recordForm.amount}
                  onChange={(e) => setRecordForm((p) => ({ ...p, amount: e.target.value }))}
                  placeholder="0.00"
                  className="font-mono text-sm font-semibold"
                  required
                />
              </Field>

              <Field label="Payment Date *">
                <Input
                  type="date"
                  max={today()}
                  value={recordForm.paymentDate}
                  onChange={(e) => setRecordForm((p) => ({ ...p, paymentDate: e.target.value }))}
                  required
                />
              </Field>
            </div>

            <Field label="Payment Mode *">
              <NativeSelect
                value={recordForm.mode}
                onChange={(e) => setRecordForm((p) => ({ ...p, mode: e.target.value }))}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field label="Narration / Note">
              <Input
                value={recordForm.narration}
                onChange={(e) => setRecordForm((p) => ({ ...p, narration: e.target.value }))}
                placeholder="e.g. Advance payment / Bank deposit"
              />
            </Field>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRecordModalOpen(false)}
                disabled={isSavingRecord}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSavingRecord}>
                {isSavingRecord
                  ? "Saving…"
                  : recordForm.jobId
                    ? "Save & Clear Job"
                    : "Save Payment Entry"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
