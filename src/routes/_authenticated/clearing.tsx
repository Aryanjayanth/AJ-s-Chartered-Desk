import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  CheckCircle2,
  Clock,
  ArrowRight,
  Search,
  Check,
  Calendar,
  AlertCircle,
  FileText,
  Wallet,
  ReceiptIndianRupee,
  ChevronRight,
  TrendingUp,
  Briefcase,
  Layers,
  ArrowUpRight,
  Info,
  DollarSign,
  User,
  ShieldCheck,
  CheckCheck,
  ArrowLeft,
  X,
  CreditCard,
  Building,
  RotateCcw,
  Plus,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Field, NativeSelect, NoAccess } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentFirm } from "@/hooks/use-firm";
import { cn } from "@/lib/utils";
import {
  errMsg,
  fmtDate,
  inr,
  invoiceDisplayStatus,
  JOB_STATUSES,
  jobDisplayStatus,
  MODES,
  today,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clearing")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { client?: string; job?: string } => ({
    client: typeof s.client === "string" ? s.client : undefined,
    job: typeof s.job === "string" ? s.job : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Payment Clearing — CA PracticeDesk" },
      {
        name: "description",
        content:
          "Client financial clearing, unbilled work, reimbursable expenses, future tasks, advances, and auto-settlement.",
      },
    ],
  }),
  component: ClearingPage,
});

interface V2Job {
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
  due_date: string | null;
  clients: { id: string; name: string; client_code: string } | null;
  services: { id: string; name: string } | null;
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
      }[]
    | null;
}

interface V2Payment {
  id: string;
  client_id: string;
  job_id: string | null;
  amount: number | string;
  allocated_amount: number | string;
  payment_date: string;
  payment_code: string;
  mode: string;
  narration: string | null;
  clients: { name: string; client_code: string } | null;
}

interface V2Invoice {
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
}

interface V2Expense {
  id: string;
  kind: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number | string | null;
  mode: string;
  paid_to: string | null;
  reference: string | null;
  client_id: string | null;
  job_id: string | null;
}

const avail = (p: V2Payment) => Math.max(0, Number(p.amount) - Number(p.allocated_amount));

export function ClearingPage() {
  const { isFinance, loading } = useRoles();
  const { canView } = usePermissions();
  const { data: currentFirm } = useCurrentFirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();

  // Search & Filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "has_balance" | "has_unbilled" | "has_pending_tasks" | "has_expenses"
  >("all");

  // Full-screen client view mode: null = overview list, string = full screen workspace
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"unbilled" | "future_tasks" | "advances" | "invoices">(
    "unbilled",
  );

  // Payment Modal state for collecting shortfall & clearing 100% Paid (nothing goes to unpaid)
  const [paymentModal, setPaymentModal] = useState<{
    jobId?: string;
    jobCode?: string;
    grossWork: number;
    advanceUsed: number;
    shortfall: number;
    discountAwarded: number;
    amount: number;
    mode: string;
    paymentDate: string;
    reference: string;
  } | null>(null);

  // Per-job adjustment discounts inside full-screen view
  const [jobDiscounts, setJobDiscounts] = useState<Record<string, number>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  // 1. Fetch ALL Jobs (both completed and pending/future tasks)
  const allJobsQuery = useQuery({
    queryKey: ["clearing-v2-jobs"],
    enabled: isFinance,
    queryFn: async (): Promise<V2Job[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,job_code,title,client_id,status,financial_status,fee,discount,net_amount,completed_at,created_at,due_date,clients(id,name,client_code),services(id,name),job_clearing(id,status,advance,tds_tcs,discount,other_deduction,other_addition,final_amount)",
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as V2Job[];
    },
  });

  // 2. Fetch Payments (advances / receipts)
  const paymentsQuery = useQuery({
    queryKey: ["clearing-v2-payments"],
    enabled: isFinance,
    queryFn: async (): Promise<V2Payment[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, clients(name, client_code)")
        .neq("status", "reversed")
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as V2Payment[];
    },
  });

  // 3. Fetch Invoices
  const invoicesQuery = useQuery({
    queryKey: ["clearing-v2-invoices"],
    enabled: isFinance,
    queryFn: async (): Promise<V2Invoice[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id,job_id,client_id,outstanding,total,subtotal,tax_amount,tax_rate,due_date,invoice_date,invoice_no,description,status",
        )
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as V2Invoice[];
    },
  });

  // 4. Fetch Client Reimbursable Expenses & Outlays
  const expensesQuery = useQuery({
    queryKey: ["clearing-v2-expenses"],
    enabled: isFinance,
    queryFn: async (): Promise<V2Expense[]> => {
      const { data, error } = await supabase
        .from("expenses")
        .select(
          "id,kind,expense_date,category,description,amount,mode,paid_to,reference,client_id,job_id",
        )
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as V2Expense[];
    },
  });

  // 5. Fetch Clients lookup
  const clientsQuery = useQuery({
    queryKey: ["clearing-v2-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, client_code, client_type, mobile")
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsList = allJobsQuery.data ?? [];
  const paymentsList = paymentsQuery.data ?? [];
  const invoicesList = invoicesQuery.data ?? [];
  const expensesList = expensesQuery.data ?? [];
  const clientsList = clientsQuery.data ?? [];

  // Group everything client-centrically
  const clientSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        clientCode: string;
        clientType: string;
        mobile: string | null;
        totalAdvanceBalance: number;
        completedJobs: V2Job[];
        unbilledJobs: V2Job[];
        futureAndPendingTasks: V2Job[];
        unbilledFeeTotal: number;
        openInvoices: V2Invoice[];
        openInvoicesTotal: number;
        payments: V2Payment[];
        expenses: V2Expense[];
        reimbursableExpensesTotal: number;
      }
    >();

    // Seed from all clients
    for (const c of clientsList) {
      map.set(c.id, {
        clientId: c.id,
        clientName: c.name,
        clientCode: c.client_code ?? "—",
        clientType: c.client_type ?? "individual",
        mobile: c.mobile,
        totalAdvanceBalance: 0,
        completedJobs: [],
        unbilledJobs: [],
        futureAndPendingTasks: [],
        unbilledFeeTotal: 0,
        openInvoices: [],
        openInvoicesTotal: 0,
        payments: [],
        expenses: [],
        reimbursableExpensesTotal: 0,
      });
    }

    // Assign jobs
    for (const j of jobsList) {
      if (!j.client_id) continue;
      let entry = map.get(j.client_id);
      if (!entry) {
        entry = {
          clientId: j.client_id,
          clientName: j.clients?.name ?? "Unknown Client",
          clientCode: j.clients?.client_code ?? "—",
          clientType: "individual",
          mobile: null,
          totalAdvanceBalance: 0,
          completedJobs: [],
          unbilledJobs: [],
          futureAndPendingTasks: [],
          unbilledFeeTotal: 0,
          openInvoices: [],
          openInvoicesTotal: 0,
          payments: [],
          expenses: [],
          reimbursableExpensesTotal: 0,
        };
        map.set(j.client_id, entry);
      }

      if (j.status === "completed") {
        entry.completedJobs.push(j);
        if (j.financial_status !== "invoiced" && j.financial_status !== "closed") {
          entry.unbilledJobs.push(j);
          entry.unbilledFeeTotal += Number(j.net_amount || j.fee || 0);
        }
      } else {
        entry.futureAndPendingTasks.push(j);
      }
    }

    // Assign payments
    for (const p of paymentsList) {
      if (!p.client_id) continue;
      let entry = map.get(p.client_id);
      if (!entry) {
        entry = {
          clientId: p.client_id,
          clientName: p.clients?.name ?? "Unknown Client",
          clientCode: p.clients?.client_code ?? "—",
          clientType: "individual",
          mobile: null,
          totalAdvanceBalance: 0,
          completedJobs: [],
          unbilledJobs: [],
          futureAndPendingTasks: [],
          unbilledFeeTotal: 0,
          openInvoices: [],
          openInvoicesTotal: 0,
          payments: [],
          expenses: [],
          reimbursableExpensesTotal: 0,
        };
        map.set(p.client_id, entry);
      }
      entry.payments.push(p);
      entry.totalAdvanceBalance += avail(p);
    }

    // Assign invoices
    for (const inv of invoicesList) {
      if (!inv.client_id) continue;
      const entry = map.get(inv.client_id);
      if (entry) {
        const out = Number(inv.outstanding ?? 0);
        if (out > 0) {
          entry.openInvoices.push(inv);
          entry.openInvoicesTotal += out;
        }
      }
    }

    // Assign expenses (reimbursables / outlays)
    for (const exp of expensesList) {
      const cid = exp.client_id || jobsList.find((j) => j.id === exp.job_id)?.client_id;
      if (!cid) continue;
      const entry = map.get(cid);
      if (entry) {
        entry.expenses.push(exp);
        entry.reimbursableExpensesTotal += Number(exp.amount || 0);
      }
    }

    return Array.from(map.values())
      .filter(
        (c) =>
          c.totalAdvanceBalance > 0 ||
          c.unbilledJobs.length > 0 ||
          c.futureAndPendingTasks.length > 0 ||
          c.openInvoices.length > 0 ||
          c.expenses.length > 0,
      )
      .sort((a, b) => {
        if (a.unbilledJobs.length > 0 && b.unbilledJobs.length === 0) return -1;
        if (a.unbilledJobs.length === 0 && b.unbilledJobs.length > 0) return 1;
        if (a.totalAdvanceBalance > 0 && b.totalAdvanceBalance === 0) return -1;
        if (a.totalAdvanceBalance === 0 && b.totalAdvanceBalance > 0) return 1;
        return a.clientName.localeCompare(b.clientName);
      });
  }, [clientsList, jobsList, paymentsList, invoicesList, expensesList]);

  // Overall KPIs
  const overallKPIs = useMemo(() => {
    let totalAdvance = 0;
    let totalUnbilledWork = 0;
    let totalFutureTasks = 0;
    let totalOpenInvoices = 0;
    let totalExpenses = 0;

    for (const c of clientSummaries) {
      totalAdvance += c.totalAdvanceBalance;
      totalUnbilledWork += c.unbilledFeeTotal;
      totalFutureTasks += c.futureAndPendingTasks.length;
      totalOpenInvoices += c.openInvoicesTotal;
      totalExpenses += c.reimbursableExpensesTotal;
    }

    return {
      totalAdvance,
      totalUnbilledWork,
      totalFutureTasks,
      totalOpenInvoices,
      totalExpenses,
    };
  }, [clientSummaries]);

  // Filtered rows for the list view
  const filteredSummaries = useMemo(() => {
    return clientSummaries.filter((c) => {
      if (statusFilter === "has_balance" && c.totalAdvanceBalance <= 0) return false;
      if (statusFilter === "has_unbilled" && c.unbilledJobs.length <= 0) return false;
      if (statusFilter === "has_pending_tasks" && c.futureAndPendingTasks.length <= 0) return false;
      if (statusFilter === "has_expenses" && c.reimbursableExpensesTotal <= 0) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hay = `${c.clientName} ${c.clientCode} ${c.mobile || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [clientSummaries, statusFilter, searchQuery]);

  // Selected client detail for Full Screen
  const selectedClient = useMemo(() => {
    if (!selectedClientId) return null;
    return clientSummaries.find((c) => c.clientId === selectedClientId) ?? null;
  }, [clientSummaries, selectedClientId]);

  // Open Full Screen for a Client
  const openClientFullScreen = (clientId: string) => {
    setSelectedClientId(clientId);
    setActiveTab("unbilled");

    // Initialize drafts for unbilled jobs
    const target = clientSummaries.find((c) => c.clientId === clientId);
    if (target) {
      const initialDrafts: Record<
        string,
        {
          advance: string;
          discount: string;
          tds_tcs: string;
          other_addition: string;
          notes: string;
        }
      > = {};
      target.unbilledJobs.forEach((j) => {
        const clr = j.job_clearing?.[0];
        const jobExpenses = target.expenses.filter((e) => e.job_id === j.id);
        const autoExpAdd = jobExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

        initialDrafts[j.id] = {
          advance: clr ? String(clr.advance || 0) : "0",
          discount: clr ? String(clr.discount || 0) : "0",
          tds_tcs: clr ? String(clr.tds_tcs || 0) : "0",
          other_addition: clr
            ? String(clr.other_addition || 0)
            : autoExpAdd > 0
              ? String(autoExpAdd)
              : "0",
          notes: "",
        };
      });
      setJobDrafts(initialDrafts);
    }
  };

  // Close Full Screen view and return to table
  const closeFullScreen = () => {
    setSelectedClientId(null);
  };

  // Auto-open client from search params (?client=... or ?job=...)
  useEffect(() => {
    if (search.client) {
      openClientFullScreen(search.client);
    } else if (search.job && jobsList.length > 0) {
      const match = jobsList.find((j) => j.id === search.job);
      if (match?.client_id) {
        openClientFullScreen(match.client_id);
      }
    }
  }, [search.client, search.job, jobsList]);

  // Calculation helper for client unbilled statistics
  const clientUnbilledStats = useMemo(() => {
    if (!selectedClient) {
      return {
        totalWorkToBill: 0,
        advanceInHand: 0,
        shortfall: 0,
        isFullyCovered: false,
      };
    }
    let totalWorkToBill = 0;
    for (const j of selectedClient.unbilledJobs) {
      const fee = Number(j.net_amount || j.fee || 0);
      const outlays = selectedClient.expenses
        .filter((e) => e.job_id === j.id)
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const disc = jobDiscounts[j.id] || 0;
      totalWorkToBill += Math.max(0, fee + outlays - disc);
    }
    const advanceInHand = selectedClient.totalAdvanceBalance;
    const shortfall = Math.max(0, totalWorkToBill - advanceInHand);
    const isFullyCovered = advanceInHand >= totalWorkToBill && totalWorkToBill > 0;

    return {
      totalWorkToBill,
      advanceInHand,
      shortfall,
      isFullyCovered,
    };
  }, [selectedClient, jobDiscounts]);

  // Execute 100% Full Clearance (Guarantees zero unpaid balance)
  const executeFullClearance = async (params: {
    client: typeof selectedClient;
    jobs: V2Job[];
    newPayment?: { id: string; amount: number } | null;
    overrideDiscounts?: Record<string, number>;
  }) => {
    const targetClient = params.client;
    if (!targetClient) return;
    setIsProcessing(true);
    let count = 0;
    try {
      // Build pool of available payments for this client
      const paymentPool = targetClient.payments
        .map((p) => ({ id: p.id, avail: avail(p) }))
        .filter((p) => p.avail > 0);

      if (params.newPayment) {
        paymentPool.push({
          id: params.newPayment.id,
          avail: params.newPayment.amount,
        });
      }

      for (const j of params.jobs) {
        const fee = Number(j.net_amount || j.fee || 0);
        const outlays = targetClient.expenses
          .filter((e) => e.job_id === j.id)
          .reduce((sum, e) => sum + Number(e.amount || 0), 0);
        const disc = params.overrideDiscounts?.[j.id] ?? (jobDiscounts[j.id] || 0);
        const netJobAmount = Math.max(0, fee + outlays - disc);

        // 1. Save clearing: Note _other_addition is 0 so outlays are not double counted with _extra_amount
        await supabase.rpc("save_job_clearing", {
          _job_id: j.id,
          _advance: netJobAmount,
          _tds_tcs: 0,
          _discount: disc,
          _other_deduction: 0,
          _other_addition: 0,
          _notes: "Settled via Payment Clearing (100% Paid)",
        });

        // 2. Mark Cleared
        await supabase.rpc("mark_job_cleared", {
          _job_id: j.id,
          _notes: "Settled via Payment Clearing (100% Paid)",
        });

        // 3. Square Off
        await supabase.rpc("sq_off_job_clearing", {
          _job_id: j.id,
          _notes: "Settled via Payment Clearing (100% Paid)",
        });

        // 4. Create Invoice
        const matchingPay = paymentPool.find((p) => p.avail > 0);
        const { data: invId, error: invErr } = await supabase.rpc("create_invoice_for_job", {
          _job_id: j.id,
          _payment_id: matchingPay ? matchingPay.id : (null as unknown as string),
          _invoice_date: today(),
          _due_date: today(),
          _tax_rate: 0,
          _notes: "Generated from Payment Clearing Desk",
          _extra_desc: outlays > 0 ? "Reimbursable Client Outlays" : "",
          _extra_amount: outlays,
        });

        if (invErr) throw invErr;

        // 5. Allocate payments to cover invoice 100% (so outstanding = 0, status = 'paid')
        if (invId && netJobAmount > 0) {
          let needed = netJobAmount;
          for (const p of paymentPool) {
            if (p.avail > 0 && needed > 0) {
              const use = Math.min(needed, p.avail);
              await supabase.rpc("allocate_payment", {
                _payment_id: p.id,
                _allocations: [{ invoice_id: invId, amount: use }],
              });
              p.avail -= use;
              needed -= use;
            }
          }
        }

        count++;
      }

      toast.success(
        `Successfully settled ${count} job${count === 1 ? "" : "s"} for ${targetClient.clientName} (100% Paid, ₹0 Unpaid)!`,
      );
      setPaymentModal(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["clearing-v2-jobs"] }),
        qc.invalidateQueries({ queryKey: ["clearing-v2-payments"] }),
        qc.invalidateQueries({ queryKey: ["clearing-v2-invoices"] }),
        qc.invalidateQueries({ queryKey: ["clearing-v2-expenses"] }),
        qc.invalidateQueries({ queryKey: ["open-payments"] }),
        qc.invalidateQueries({ queryKey: ["completed-jobs-clearing"] }),
      ]);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Clear all unbilled jobs: if advance covers 100%, settle immediately; otherwise open collection modal
  const handleClearAllJobs = async (clientSummary?: typeof selectedClient) => {
    const target = clientSummary || selectedClient;
    if (!target) return;
    if (target.unbilledJobs.length === 0) {
      toast.info("No unbilled completed jobs found for this client.");
      return;
    }

    let totalWork = 0;
    for (const j of target.unbilledJobs) {
      const fee = Number(j.net_amount || j.fee || 0);
      const outlays = target.expenses
        .filter((e) => e.job_id === j.id)
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const disc = jobDiscounts[j.id] || 0;
      totalWork += Math.max(0, fee + outlays - disc);
    }

    const advanceAvail = target.totalAdvanceBalance;
    if (advanceAvail >= totalWork) {
      // 100% covered by advance!
      await executeFullClearance({ client: target, jobs: target.unbilledJobs, newPayment: null });
    } else {
      // Shortfall: open payment modal to collect shortfall or award discount
      const shortfall = totalWork - advanceAvail;
      setSelectedClientId(target.clientId);
      setPaymentModal({
        grossWork: totalWork,
        advanceUsed: advanceAvail,
        shortfall: shortfall,
        discountAwarded: 0,
        amount: shortfall,
        mode: "upi",
        paymentDate: today(),
        reference: "",
      });
    }
  };

  // Clear single job: if advance covers 100%, settle immediately; otherwise prompt to collect or discount shortfall
  const handleClearSingleJob = async (job: V2Job) => {
    if (!selectedClient) return;
    const fee = Number(job.net_amount || job.fee || 0);
    const outlays = selectedClient.expenses
      .filter((e) => e.job_id === job.id)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const disc = jobDiscounts[job.id] || 0;
    const netJobAmount = Math.max(0, fee + outlays - disc);

    const advanceAvail = selectedClient.totalAdvanceBalance;
    if (advanceAvail >= netJobAmount) {
      // Advance covers it 100%!
      await executeFullClearance({ client: selectedClient, jobs: [job], newPayment: null });
    } else {
      // Shortfall: prompt to collect difference or award discount
      const shortfall = netJobAmount - advanceAvail;
      setPaymentModal({
        jobId: job.id,
        jobCode: job.job_code,
        grossWork: netJobAmount,
        advanceUsed: advanceAvail,
        shortfall: shortfall,
        discountAwarded: 0,
        amount: shortfall,
        mode: "upi",
        paymentDate: today(),
        reference: "",
      });
    }
  };

  // Record payment for shortfall & instantly clear (100% Paid, ₹0 Unpaid)
  const handleConfirmPaymentAndClear = async () => {
    if (!selectedClient || !paymentModal) return;

    setIsProcessing(true);
    try {
      const additionalDisc = paymentModal.discountAwarded || 0;
      const newDiscounts = { ...jobDiscounts };

      if (additionalDisc > 0) {
        if (paymentModal.jobId) {
          newDiscounts[paymentModal.jobId] =
            (newDiscounts[paymentModal.jobId] || 0) + additionalDisc;
        } else {
          let rem = additionalDisc;
          for (const j of selectedClient.unbilledJobs) {
            if (rem <= 0) break;
            const fee = Number(j.net_amount || j.fee || 0);
            const cur = newDiscounts[j.id] || 0;
            const canTake = Math.max(0, fee - cur);
            const take = Math.min(rem, canTake);
            newDiscounts[j.id] = cur + take;
            rem -= take;
          }
        }
        setJobDiscounts(newDiscounts);
      }

      // 1. If money is being collected, record payment receipt into payments table as general client balance
      let newPayRecord: { id: string; amount: number } | null = null;
      if (paymentModal.amount > 0) {
        const { data: payRecord, error: payErr } = await supabase
          .from("payments")
          .insert({
            client_id: selectedClient.clientId,
            job_id: null,
            amount: paymentModal.amount,
            mode: paymentModal.mode,
            payment_date: paymentModal.paymentDate,
            reference: paymentModal.reference.trim() || null,
            narration: `General client payment collected at Clearing Desk for ${selectedClient.clientName}`,
          })
          .select("id, amount")
          .single();

        if (payErr) throw payErr;
        newPayRecord = { id: payRecord.id, amount: Number(payRecord.amount) };
      }

      // 2. Execute 100% full clearance
      const targetJobs = paymentModal.jobId
        ? selectedClient.unbilledJobs.filter((j) => j.id === paymentModal.jobId)
        : selectedClient.unbilledJobs;

      await executeFullClearance({
        client: selectedClient,
        jobs: targetJobs,
        newPayment: newPayRecord,
        overrideDiscounts: newDiscounts,
      });
    } catch (err) {
      toast.error(errMsg(err));
      setIsProcessing(false);
    }
  };

  // Quick settlement of an existing open invoice using client advance money jar
  const handleSettleOpenInvoice = async (inv: V2Invoice) => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.rpc("allocate_client_jar_to_invoice", {
        _invoice_id: inv.id,
      });
      if (error) throw error;
      toast.success(`Allocated ₹${data ?? 0} from client advance jar to invoice ${inv.invoice_no}!`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["clearing-v2-invoices"] }),
        qc.invalidateQueries({ queryKey: ["clearing-v2-payments"] }),
        qc.invalidateQueries({ queryKey: ["open-payments"] }),
      ]);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Quick link / unlink of client reimbursable expense to a job
  const handleLinkExpenseToJob = async (expenseId: string, jobId: string | null) => {
    try {
      const { error } = await supabase
        .from("expenses")
        .update({ job_id: jobId })
        .eq("id", expenseId);
      if (error) throw error;
      toast.success(jobId ? "Expense attached to job!" : "Expense detached from job.");
      await qc.invalidateQueries({ queryKey: ["clearing-v2-expenses"] });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Modal dialog for collecting shortfall payment or awarding discount before 100% full clearance
  const renderPaymentModal = () => (
    <Dialog open={!!paymentModal} onOpenChange={(open) => !open && setPaymentModal(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Clear Payment (100% Paid)
          </DialogTitle>
        </DialogHeader>

        {paymentModal && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/40 p-3 border text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Client:</span>
                <span className="font-semibold text-foreground">
                  {selectedClient?.clientName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Settling:</span>
                <span className="font-semibold text-foreground">
                  {paymentModal.jobCode ? `Job ${paymentModal.jobCode}` : "All Unbilled Jobs"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Work Bill Total:</span>
                <span className="font-mono font-medium text-foreground">
                  {inr(paymentModal.grossWork)}
                </span>
              </div>
              {paymentModal.advanceUsed > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Advance Jar Absorbed:</span>
                  <span className="font-mono text-emerald-600 font-medium">
                    - {inr(paymentModal.advanceUsed)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Remaining Shortfall:</span>
                <span className="font-mono text-amber-600 font-semibold">
                  {inr(paymentModal.shortfall)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {/* Optional Discount Award Card */}
              <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">
                    Award Discount (Waiver)
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Max: {inr(paymentModal.shortfall)}
                  </span>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={paymentModal.shortfall}
                  value={paymentModal.discountAwarded || ""}
                  placeholder="₹0 discount"
                  onChange={(e) => {
                    const disc = Math.min(
                      paymentModal.shortfall,
                      Math.max(0, Number(e.target.value) || 0),
                    );
                    const remCollect = Math.max(0, paymentModal.shortfall - disc);
                    setPaymentModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            discountAwarded: disc,
                            amount: remCollect,
                          }
                        : null,
                    );
                  }}
                  className="font-mono bg-background text-xs h-8"
                />
                <p className="text-[11px] text-muted-foreground">
                  Award a discount to waive off fees and clear the payment without leaving any unpaid balance.
                </p>
              </div>

              {paymentModal.amount > 0 ? (
                <>
                  <Field label="Amount to Collect (₹) *">
                    <Input
                      type="number"
                      min={0}
                      value={paymentModal.amount}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value) || 0);
                        setPaymentModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                amount: val,
                              }
                            : null,
                        );
                      }}
                      className="font-mono font-semibold"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Payment Mode">
                      <NativeSelect
                        value={paymentModal.mode}
                        onChange={(e) =>
                          setPaymentModal((prev) =>
                            prev ? { ...prev, mode: e.target.value } : null,
                          )
                        }
                      >
                        {MODES.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>

                    <Field label="Payment Date">
                      <Input
                        type="date"
                        value={paymentModal.paymentDate}
                        onChange={(e) =>
                          setPaymentModal((prev) =>
                            prev ? { ...prev, paymentDate: e.target.value } : null,
                          )
                        }
                      />
                    </Field>
                  </div>

                  <Field label="Reference / Transaction ID (Optional)">
                    <Input
                      placeholder="e.g. UPI Ref, IMPS No, Cheque #"
                      value={paymentModal.reference}
                      onChange={(e) =>
                        setPaymentModal((prev) =>
                          prev ? { ...prev, reference: e.target.value } : null,
                        )
                      }
                    />
                  </Field>
                </>
              ) : (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                  Full shortfall of {inr(paymentModal.shortfall)} waived off as discount. Ready to clear 100% paid with ₹0 collection needed!
                </div>
              )}
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              <span>
                100% Full Clearance: Invoice will be marked <strong>Paid in Full</strong> with{" "}
                <strong>₹0 outstanding</strong>. No partially paid or open bills will be created.
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setPaymentModal(null)} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            onClick={handleConfirmPaymentAndClear}
            disabled={isProcessing || !paymentModal}
          >
            {isProcessing
              ? "Clearing 100%..."
              : paymentModal?.amount > 0
                ? `Collect ${inr(paymentModal.amount)} & Clear (100% Paid)`
                : `Award ${inr(paymentModal?.discountAwarded || 0)} Discount & Clear (100% Paid)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (loading) return null;
  if (!isFinance) return <NoAccess />;

  // -------------------------------------------------------------
  // FULL SCREEN WORKSPACE VIEW FOR SELECTED CLIENT
  // -------------------------------------------------------------
  if (selectedClient) {
    return (
      <div className="space-y-4 animate-in fade-in-50 duration-200">
        {/* Full Screen Top Navigation & Actions Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={closeFullScreen}
              className="h-9 px-3 gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Clients</span>
            </Button>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {selectedClient.clientName}
                </h1>
                <Badge variant="outline" className="font-mono text-xs font-semibold">
                  {selectedClient.clientCode}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {selectedClient.mobile ? `+91 ${selectedClient.mobile}` : "No phone"} •{" "}
                <span className="capitalize">{selectedClient.clientType}</span>
              </div>
            </div>
          </div>

          {/* Quick Action Button in Header */}
          <div className="flex items-center gap-2">
            {selectedClient.unbilledJobs.length > 0 &&
              (clientUnbilledStats.isFullyCovered ? (
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 cursor-pointer shadow-sm"
                  onClick={() => handleClearAllJobs(selectedClient)}
                  disabled={isProcessing}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isProcessing ? "Settling 100%…" : "1-Click Clear All (100% Paid)"}
                </Button>
              ) : (
                <Button
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-1.5 cursor-pointer shadow-sm"
                  onClick={() => handleClearAllJobs(selectedClient)}
                  disabled={isProcessing}
                >
                  <CreditCard className="h-4 w-4" />
                  {isProcessing
                    ? "Processing…"
                    : `Collect ${inr(clientUnbilledStats.shortfall)} & Clear All`}
                </Button>
              ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={closeFullScreen}
              className="h-9 text-xs cursor-pointer"
            >
              <X className="h-4 w-4 mr-1" /> Close
            </Button>
          </div>
        </div>

        {/* Settlement Overview Banner (Clear, Simple, 100% Paid Guaranteed) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Card 1: Completed Work */}
          <Card className="border-border/70 shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Completed Work to Settle
                  </span>
                  <div className="text-2xl font-bold font-mono text-foreground mt-1">
                    {inr(clientUnbilledStats.totalWorkToBill)}
                  </div>
                </div>
                <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <ReceiptIndianRupee className="h-5 w-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {selectedClient.unbilledJobs.length} completed job
                {selectedClient.unbilledJobs.length === 1 ? "" : "s"}
                {selectedClient.expenses.length > 0
                  ? ` · ${selectedClient.expenses.length} outlay${selectedClient.expenses.length === 1 ? "" : "s"} (${inr(selectedClient.reimbursableExpensesTotal)})`
                  : ""}
              </p>
            </CardContent>
          </Card>

          {/* Card 2: Advance in Hand */}
          <Card className="border-border/70 shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Client Advance Jar
                  </span>
                  <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                    {inr(clientUnbilledStats.advanceInHand)}
                  </div>
                </div>
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Wallet className="h-5 w-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {selectedClient.payments.length} advance receipt
                {selectedClient.payments.length === 1 ? "" : "s"} on deposit
              </p>
            </CardContent>
          </Card>

          {/* Card 3: Settlement Status */}
          <Card
            className={cn(
              "shadow-xs transition-colors",
              selectedClient.unbilledJobs.length === 0
                ? "border-emerald-500/30 bg-emerald-500/5"
                : clientUnbilledStats.isFullyCovered
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-amber-500/40 bg-amber-500/10",
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Settlement Status
                  </span>
                  <div
                    className={cn(
                      "text-xl font-bold font-mono mt-1",
                      selectedClient.unbilledJobs.length === 0 || clientUnbilledStats.isFullyCovered
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {selectedClient.unbilledJobs.length === 0
                      ? "✓ All Clear"
                      : clientUnbilledStats.isFullyCovered
                        ? "✓ 100% Covered"
                        : `Shortfall: ${inr(clientUnbilledStats.shortfall)}`}
                  </div>
                </div>
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center",
                    selectedClient.unbilledJobs.length === 0 || clientUnbilledStats.isFullyCovered
                      ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/20 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {selectedClient.unbilledJobs.length === 0 || clientUnbilledStats.isFullyCovered ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <AlertCircle className="h-5 w-5" />
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {selectedClient.unbilledJobs.length === 0
                  ? "All completed jobs are invoiced & cleared."
                  : clientUnbilledStats.isFullyCovered
                    ? "Advance fully covers all unbilled work. Ready to clear!"
                    : `Advance covers ${inr(clientUnbilledStats.advanceInHand)}. Collect shortfall to settle 100%.`}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Full Screen Workspace Tabs */}
        <Card className="shadow-sm">
          <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
            <div className="border-b px-4 pt-2">
              <TabsList className="bg-transparent gap-2 h-11 p-0">
                <TabsTrigger
                  value="unbilled"
                  className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none px-4 text-xs font-semibold h-11"
                >
                  Unbilled Jobs & Reimbursables ({selectedClient.unbilledJobs.length} jobs ·{" "}
                  {selectedClient.expenses.length} outlays)
                </TabsTrigger>
                <TabsTrigger
                  value="future_tasks"
                  className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none px-4 text-xs font-semibold h-11"
                >
                  Future & Pending Tasks ({selectedClient.futureAndPendingTasks.length})
                </TabsTrigger>
                <TabsTrigger
                  value="advances"
                  className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none px-4 text-xs font-semibold h-11"
                >
                  Client Advance Receipts ({selectedClient.payments.length})
                </TabsTrigger>
                <TabsTrigger
                  value="invoices"
                  className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none px-4 text-xs font-semibold h-11"
                >
                  Invoices & History ({selectedClient.openInvoices.length})
                </TabsTrigger>
              </TabsList>
            </div>

            {/* TAB 1: UNBILLED JOBS (CLEARING DESK) */}
            <TabsContent value="unbilled" className="p-4 m-0 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/30 p-3 rounded-lg border">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Completed Jobs Ready for Clearance
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Every clearance settles 100% of the bill with ₹0 unpaid balance. No open
                    receivables are created.
                  </p>
                </div>
                {selectedClient.unbilledJobs.length > 0 &&
                  (clientUnbilledStats.isFullyCovered ? (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs gap-1.5 cursor-pointer"
                      onClick={() => handleClearAllJobs(selectedClient)}
                      disabled={isProcessing}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      1-Click Clear All With Advance
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs gap-1.5 cursor-pointer"
                      onClick={() => handleClearAllJobs(selectedClient)}
                      disabled={isProcessing}
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      Collect {inr(clientUnbilledStats.shortfall)} & Clear All
                    </Button>
                  ))}
              </div>

              {selectedClient.unbilledJobs.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-xl bg-muted/10">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2 opacity-80" />
                  <p className="text-sm font-semibold text-foreground">
                    All completed jobs are cleared and invoiced!
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Check the &quot;Future &amp; Pending Tasks&quot; tab for upcoming work pipeline.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-semibold border-b uppercase text-[11px]">
                      <tr>
                        <th className="py-3 px-4">Job Info</th>
                        <th className="py-3 px-3">Completed On</th>
                        <th className="py-3 px-3">Agreed Fee</th>
                        <th className="py-3 px-3">Outlays / Expenses</th>
                        <th className="py-3 px-3">Discount (₹)</th>
                        <th className="py-3 px-3">Total Net Bill</th>
                        <th className="py-3 px-3">Coverage Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedClient.unbilledJobs.map((j) => {
                        const fee = Number(j.net_amount || j.fee || 0);
                        const linkedExpenses = selectedClient.expenses.filter(
                          (e) => e.job_id === j.id,
                        );
                        const outlays = linkedExpenses.reduce(
                          (sum, e) => sum + Number(e.amount || 0),
                          0,
                        );
                        const disc = jobDiscounts[j.id] || 0;
                        const totalJobBill = Math.max(0, fee + outlays - disc);
                        const jobShortfall = Math.max(
                          0,
                          totalJobBill - selectedClient.totalAdvanceBalance,
                        );
                        const isJobCovered = selectedClient.totalAdvanceBalance >= totalJobBill;

                        return (
                          <tr key={j.id} className="hover:bg-muted/20 transition-colors">
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-foreground text-xs">{j.title}</div>
                              <div className="text-[11px] font-mono text-muted-foreground">
                                Code: {j.job_code}
                              </div>
                            </td>

                            <td className="py-3.5 px-3 text-muted-foreground">
                              {j.completed_at ? fmtDate(j.completed_at) : "Recently"}
                            </td>

                            <td className="py-3.5 px-3 font-mono font-bold text-foreground">
                              {inr(fee)}
                            </td>

                            <td className="py-3.5 px-3">
                              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                                {inr(outlays)}
                              </span>
                              {linkedExpenses.length > 0 && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {linkedExpenses.length} expense
                                  {linkedExpenses.length === 1 ? "" : "s"} linked
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-3">
                              <Input
                                type="number"
                                min={0}
                                placeholder="0"
                                className="h-7 w-20 text-xs font-mono font-medium"
                                value={jobDiscounts[j.id] || ""}
                                onChange={(e) =>
                                  setJobDiscounts((prev) => ({
                                    ...prev,
                                    [j.id]: Math.max(0, Number(e.target.value) || 0),
                                  }))
                                }
                              />
                            </td>

                            <td className="py-3.5 px-3 font-mono font-bold text-foreground text-xs">
                              {inr(totalJobBill)}
                            </td>

                            <td className="py-3.5 px-3">
                              {isJobCovered ? (
                                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1 font-medium">
                                  <Check className="h-3 w-3" /> Fully Covered
                                </Badge>
                              ) : (
                                <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1 font-medium">
                                  <AlertCircle className="h-3 w-3" /> Shortfall: {inr(jobShortfall)}
                                </Badge>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-right">
                              {isJobCovered ? (
                                <Button
                                  size="sm"
                                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 cursor-pointer font-medium"
                                  onClick={() => handleClearSingleJob(j)}
                                  disabled={isProcessing}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Clear (100% Paid)
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  className="h-8 text-xs gap-1 cursor-pointer font-medium bg-primary hover:bg-primary/90 text-primary-foreground"
                                  onClick={() => handleClearSingleJob(j)}
                                  disabled={isProcessing}
                                >
                                  <CreditCard className="h-3.5 w-3.5" />
                                  Collect &amp; Clear
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* SECTION 2: CLIENT REIMBURSABLE EXPENSES & OUTLAYS ON SAME PAGE */}
              <div className="border-t pt-5 space-y-3">
                <div className="bg-muted/30 p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <ReceiptIndianRupee className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                      Client Reimbursable Expenses &amp; Outlays ({selectedClient.expenses.length})
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Direct government fees, challans, stamp duty, or expenses paid on behalf of
                      this client. Attach them to an unbilled job above to roll into billing.
                    </p>
                  </div>
                  <div className="text-sm font-semibold font-mono text-rose-600 dark:text-rose-400">
                    Total Outlays: {inr(selectedClient.reimbursableExpensesTotal)}
                  </div>
                </div>

                {selectedClient.expenses.length === 0 ? (
                  <div className="text-center py-8 border border-dashed rounded-xl bg-muted/10">
                    <CheckCircle2 className="h-9 w-9 text-muted-foreground mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-semibold text-foreground">
                      No reimbursable expenses recorded for this client.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/50 text-muted-foreground font-semibold border-b uppercase text-[11px]">
                        <tr>
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-3">Category</th>
                          <th className="py-3 px-3">Description</th>
                          <th className="py-3 px-3">Job Link</th>
                          <th className="py-3 px-3">Mode</th>
                          <th className="py-3 px-3">Amount</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedClient.expenses.map((exp) => {
                          const linkedJob = jobsList.find((j) => j.id === exp.job_id);
                          return (
                            <tr key={exp.id} className="hover:bg-muted/20 transition-colors">
                              <td className="py-3.5 px-4 font-mono text-muted-foreground">
                                {fmtDate(exp.expense_date)}
                              </td>
                              <td className="py-3.5 px-3">
                                <Badge variant="outline" className="text-[10px] uppercase">
                                  {exp.category}
                                </Badge>
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-medium text-foreground">{exp.description}</div>
                                {exp.paid_to && (
                                  <div className="text-[11px] text-muted-foreground">
                                    Paid to: {exp.paid_to}
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-3">
                                {linkedJob ? (
                                  <Badge variant="secondary" className="text-[10px] font-mono">
                                    {linkedJob.job_code}
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] text-amber-600 bg-amber-500/10 border-amber-500/20"
                                  >
                                    Unassigned Outlay
                                  </Badge>
                                )}
                              </td>
                              <td className="py-3.5 px-3 text-muted-foreground uppercase text-[11px]">
                                {exp.mode}
                              </td>
                              <td className="py-3.5 px-3 font-mono font-bold text-rose-600 dark:text-rose-400">
                                {inr(exp.amount || 0)}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                {linkedJob ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs text-muted-foreground hover:text-destructive cursor-pointer"
                                    onClick={() => handleLinkExpenseToJob(exp.id, null)}
                                  >
                                    Unlink
                                  </Button>
                                ) : selectedClient.unbilledJobs.length === 1 ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs gap-1 cursor-pointer hover:bg-primary/10 hover:text-primary hover:border-primary"
                                    onClick={() =>
                                      handleLinkExpenseToJob(
                                        exp.id,
                                        selectedClient.unbilledJobs[0].id,
                                      )
                                    }
                                  >
                                    <Plus className="h-3 w-3" /> Attach to{" "}
                                    {selectedClient.unbilledJobs[0].job_code}
                                  </Button>
                                ) : selectedClient.unbilledJobs.length > 1 ? (
                                  <NativeSelect
                                    className="h-7 text-xs w-36"
                                    value=""
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleLinkExpenseToJob(exp.id, e.target.value);
                                      }
                                    }}
                                  >
                                    <option value="" disabled>
                                      Attach to Job…
                                    </option>
                                    {selectedClient.unbilledJobs.map((j) => (
                                      <option key={j.id} value={j.id}>
                                        {j.job_code}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">
                                    No active jobs
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* TAB 2: FUTURE & PENDING TASKS */}
            <TabsContent value="future_tasks" className="p-4 m-0 space-y-4">
              <div className="bg-muted/30 p-3 rounded-lg border">
                <h3 className="text-sm font-semibold text-foreground">
                  Upcoming Compliance &amp; Operational Pipeline
                </h3>
                <p className="text-xs text-muted-foreground">
                  Review all upcoming deadlines, pending tasks, and retainers scheduled for this
                  client.
                </p>
              </div>

              {selectedClient.futureAndPendingTasks.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-xl bg-muted/10">
                  <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-semibold text-foreground">
                    No upcoming or pending tasks for this client.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-semibold border-b uppercase text-[11px]">
                      <tr>
                        <th className="py-3 px-4">Task / Job Title</th>
                        <th className="py-3 px-3">Job Code</th>
                        <th className="py-3 px-3">Due Date</th>
                        <th className="py-3 px-3">Fee Amount</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-4 text-right">Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedClient.futureAndPendingTasks.map((t) => (
                        <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-3.5 px-4">
                            <span className="font-semibold text-foreground">{t.title}</span>
                          </td>
                          <td className="py-3.5 px-3 font-mono text-muted-foreground">
                            {t.job_code}
                          </td>
                          <td className="py-3.5 px-3 text-muted-foreground">
                            {t.due_date ? fmtDate(t.due_date) : "No due date set"}
                          </td>
                          <td className="py-3.5 px-3 font-mono font-medium">{inr(t.fee)}</td>
                          <td className="py-3.5 px-3">
                            <StatusBadge status={t.status} />
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 cursor-pointer"
                              onClick={() => navigate({ to: `/jobs/${t.id}` })}
                            >
                              View <ArrowUpRight className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* TAB 3: CLIENT ADVANCE RECEIPTS */}
            <TabsContent value="advances" className="p-4 m-0 space-y-4">
              <div className="bg-muted/30 p-3 rounded-lg border">
                <h3 className="text-sm font-semibold text-foreground">
                  Client Advance Receipts &amp; Money Jar
                </h3>
                <p className="text-xs text-muted-foreground">
                  History of payments and unallocated balances currently credited to this client.
                </p>
              </div>

              {selectedClient.payments.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-xl bg-muted/10">
                  <Wallet className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-semibold text-foreground">
                    No payment receipts on record for this client.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-semibold border-b uppercase text-[11px]">
                      <tr>
                        <th className="py-3 px-4">Receipt Code</th>
                        <th className="py-3 px-3">Payment Date</th>
                        <th className="py-3 px-3">Mode</th>
                        <th className="py-3 px-3">Total Amount</th>
                        <th className="py-3 px-3">Available Balance</th>
                        <th className="py-3 px-4">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedClient.payments.map((p) => {
                        const unalloc = avail(p);
                        return (
                          <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                            <td className="py-3.5 px-4 font-mono font-semibold text-foreground">
                              {p.payment_code}
                            </td>
                            <td className="py-3.5 px-3 text-muted-foreground">
                              {fmtDate(p.payment_date)}
                            </td>
                            <td className="py-3.5 px-3">
                              <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                {p.mode}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-3 font-mono font-bold text-foreground">
                              {inr(p.amount)}
                            </td>
                            <td className="py-3.5 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {inr(unalloc)}
                            </td>
                            <td className="py-3.5 px-4 text-muted-foreground">
                              {p.narration || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* TAB 4: OPEN INVOICES */}
            <TabsContent value="invoices" className="p-4 m-0 space-y-4">
              <div className="bg-muted/30 p-3 rounded-lg border">
                <h3 className="text-sm font-semibold text-foreground">
                  Billed Invoices &amp; Receivables
                </h3>
                <p className="text-xs text-muted-foreground">
                  Invoices issued for completed work that are open or partially settled.
                </p>
              </div>

              {selectedClient.openInvoices.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-xl bg-muted/10">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2 opacity-80" />
                  <p className="text-sm font-semibold text-foreground">
                    No outstanding invoices for this client.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-semibold border-b uppercase text-[11px]">
                      <tr>
                        <th className="py-3 px-4">Invoice No</th>
                        <th className="py-3 px-3">Date</th>
                        <th className="py-3 px-3">Total Amount</th>
                        <th className="py-3 px-3">Outstanding Due</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-4 text-right">View</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedClient.openInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-semibold text-foreground">
                            {inv.invoice_no}
                          </td>
                          <td className="py-3.5 px-3 text-muted-foreground">
                            {fmtDate(inv.invoice_date)}
                          </td>
                          <td className="py-3.5 px-3 font-mono font-medium">{inr(inv.total)}</td>
                          <td className="py-3.5 px-3 font-mono font-bold text-rose-600 dark:text-rose-400">
                            {inr(inv.outstanding ?? 0)}
                          </td>
                          <td className="py-3.5 px-3">
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {inv.status}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {selectedClient.totalAdvanceBalance > 0 &&
                                (inv.outstanding ?? 0) > 0 && (
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 cursor-pointer font-medium"
                                    onClick={() => handleSettleOpenInvoice(inv)}
                                    disabled={isProcessing}
                                  >
                                    <Check className="h-3 w-3" />
                                    Settle with Advance
                                  </Button>
                                )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 cursor-pointer"
                                onClick={() => navigate({ to: `/invoices/${inv.id}` })}
                              >
                                Open <ArrowUpRight className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>

        {renderPaymentModal()}
      </div>
    );
  }

  // -------------------------------------------------------------
  // MAIN CLIENTS LIST VIEW
  // -------------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Page Header */}
      <PageHeader
        title="Payment Clearing"
        subtitle="Comprehensive 360° clearing desk: monitor advances, future tasks, unbilled work, and settle accounts in 1 click."
      />

      {/* KPI Highlight Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card className="border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-400">
                  Total Client Advances
                </p>
                <p className="text-2xl font-bold font-mono tracking-tight text-emerald-700 dark:text-emerald-300 mt-1">
                  {inr(overallKPIs.totalAdvance)}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Wallet className="h-5 w-5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Available advance funds ready to absorb fees
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-blue-50/30 dark:bg-blue-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-blue-800 dark:text-blue-400">
                  Unbilled Completed Work
                </p>
                <p className="text-2xl font-bold font-mono tracking-tight text-blue-700 dark:text-blue-300 mt-1">
                  {inr(overallKPIs.totalUnbilledWork)}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-blue-500/15 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <ReceiptIndianRupee className="h-5 w-5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Work completed awaiting invoice creation
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-amber-800 dark:text-amber-400">
                  Pending &amp; Future Tasks
                </p>
                <p className="text-2xl font-bold font-mono tracking-tight text-amber-700 dark:text-amber-300 mt-1">
                  {overallKPIs.totalFutureTasks}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <Clock className="h-5 w-5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Active compliance pipeline across practice
            </p>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-purple-50/30 dark:bg-purple-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-purple-800 dark:text-purple-400">
                  Unpaid Invoices
                </p>
                <p className="text-2xl font-bold font-mono tracking-tight text-purple-700 dark:text-purple-300 mt-1">
                  {inr(overallKPIs.totalOpenInvoices)}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-purple-500/15 flex items-center justify-center text-purple-600 dark:text-purple-400">
                <FileText className="h-5 w-5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Open receivables billed to clients
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Control Bar: Filters & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-muted/40 p-3 rounded-lg border">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by client name, code, or phone number…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-background text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground mr-1">Filter:</span>
          <Button
            size="sm"
            variant={statusFilter === "all" ? "default" : "outline"}
            onClick={() => setStatusFilter("all")}
            className="h-8 text-xs cursor-pointer"
          >
            All Clients ({clientSummaries.length})
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "has_unbilled" ? "default" : "outline"}
            onClick={() => setStatusFilter("has_unbilled")}
            className="h-8 text-xs cursor-pointer"
          >
            Unbilled Work
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "has_expenses" ? "default" : "outline"}
            onClick={() => setStatusFilter("has_expenses")}
            className="h-8 text-xs cursor-pointer"
          >
            Reimbursables ({clientSummaries.filter((c) => c.reimbursableExpensesTotal > 0).length})
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "has_balance" ? "default" : "outline"}
            onClick={() => setStatusFilter("has_balance")}
            className="h-8 text-xs cursor-pointer"
          >
            Has Advance
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "has_pending_tasks" ? "default" : "outline"}
            onClick={() => setStatusFilter("has_pending_tasks")}
            className="h-8 text-xs cursor-pointer"
          >
            Future Tasks
          </Button>
        </div>
      </div>

      {/* Main Client Summary Table */}
      <Card>
        <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Clients Clearing Portfolio ({filteredSummaries.length})
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            Click any client to open full screen workspace
          </span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Client Details</th>
                <th className="py-3 px-3">Available Advance</th>
                <th className="py-3 px-3">Unbilled Work</th>
                <th className="py-3 px-3">Future / Pending Tasks</th>
                <th className="py-3 px-3">Open Invoices</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSummaries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    No clients match your search criteria.
                  </td>
                </tr>
              ) : (
                filteredSummaries.map((c) => {
                  const hasAdvance = c.totalAdvanceBalance > 0;
                  const hasUnbilled = c.unbilledJobs.length > 0;
                  const canAbsorb =
                    hasAdvance &&
                    hasUnbilled &&
                    c.totalAdvanceBalance >= c.unbilledFeeTotal + c.reimbursableExpensesTotal;

                  return (
                    <tr
                      key={c.clientId}
                      className="hover:bg-muted/30 transition-colors cursor-pointer group"
                      onClick={() => openClientFullScreen(c.clientId)}
                    >
                      {/* Client Details */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-xs shrink-0">
                            {c.clientName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                              {c.clientName}
                              <Badge
                                variant="outline"
                                className="text-[10px] font-mono py-0 px-1 font-normal"
                              >
                                {c.clientCode}
                              </Badge>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {c.mobile ? `+91 ${c.mobile}` : "No phone"} • {c.clientType}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Advance Balance */}
                      <td className="py-3.5 px-3">
                        <div className="font-mono font-semibold text-sm text-emerald-700 dark:text-emerald-400">
                          {inr(c.totalAdvanceBalance)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {c.payments.length} receipt{c.payments.length === 1 ? "" : "s"}
                        </div>
                      </td>

                      {/* Unbilled Work */}
                      <td className="py-3.5 px-3">
                        {c.unbilledJobs.length > 0 || c.reimbursableExpensesTotal > 0 ? (
                          <div>
                            <span className="font-mono font-medium text-foreground">
                              {inr(c.unbilledFeeTotal + c.reimbursableExpensesTotal)}
                            </span>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {c.unbilledJobs.length > 0 && (
                                <span className="text-[10px] text-amber-600 font-medium">
                                  {c.unbilledJobs.length} job
                                  {c.unbilledJobs.length === 1 ? "" : "s"}
                                </span>
                              )}
                              {c.reimbursableExpensesTotal > 0 && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 text-rose-600 bg-rose-500/10 border-rose-500/20"
                                >
                                  +{inr(c.reimbursableExpensesTotal)} outlays
                                </Badge>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </td>

                      {/* Future / Pending Tasks */}
                      <td className="py-3.5 px-3">
                        {c.futureAndPendingTasks.length > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="secondary"
                              className="text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                            >
                              <Clock className="h-3 w-3 mr-1" />
                              {c.futureAndPendingTasks.length} pending
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">All clear</span>
                        )}
                      </td>

                      {/* Open Invoices */}
                      <td className="py-3.5 px-3">
                        {c.openInvoices.length > 0 ? (
                          <div>
                            <span className="font-mono font-medium text-rose-600 dark:text-rose-400">
                              {inr(c.openInvoicesTotal)}
                            </span>
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              ({c.openInvoices.length} inv)
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">Nil</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {canAbsorb && (
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 cursor-pointer font-medium"
                              onClick={() => handleClearAllJobs(c)}
                              disabled={isProcessing}
                            >
                              <Check className="h-3 w-3" />
                              1-Click Clear (100% Paid)
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 cursor-pointer"
                            onClick={() => openClientFullScreen(c.clientId)}
                          >
                            Open Desk
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {renderPaymentModal()}
    </div>
  );
}
