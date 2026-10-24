/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReceivableType = "invoice" | "job" | "expense";

export interface ReceivableItem {
  id: string;
  type: ReceivableType;
  reference_no: string;
  invoice_no: string; // compatibility with existing views
  client_id: string;
  client_name: string;
  clients: { id: string; name: string; assigned_staff: string | null } | null;
  assigned_staff: string | null;
  service_id: string | null;
  service_name: string;
  invoice_items: Array<{
    amount: number;
    description: string;
    jobs?: {
      job_code: string;
      service_id: string | null;
      services?: { name: string } | null;
    } | null;
  }>;
  description: string;
  date: string;
  invoice_date: string; // compatibility
  due_date: string;
  total: number;
  amount_paid: number;
  outstanding: number;
  status: string;
  raw: any;
}

export function useReceivables(enabled: boolean) {
  return useQuery({
    queryKey: ["receivables"],
    enabled,
    queryFn: async (): Promise<ReceivableItem[]> => {
      // 1. Fetch Invoices (unsettled / active)
      const invPromise = supabase
        .from("invoices")
        .select(
          "*, clients(id,name,assigned_staff), jobs(id,job_code,status), invoice_items(amount, description, jobs(job_code, status, service_id, services(name)))",
        )
        .in("status", ["unpaid", "partially_paid", "paid"])
        .order("due_date");

      // 2. Fetch Completed Jobs (both recurring and non-recurring)
      const jobsPromise = supabase
        .from("jobs")
        .select(
          "id, job_code, title, client_id, service_id, fee, discount, net_amount, due_date, status, financial_status, created_at, clients(id, name, assigned_staff), services(id, name), invoice_items(invoice_id, invoices(id, invoice_no, status)), job_clearing(advance, discount, final_amount, status)",
        )
        .eq("status", "completed")
        .order("created_at", { ascending: false });

      // 3. Fetch Client Expenses (out-of-pocket & reimbursable client expenses)
      const expPromise = supabase
        .from("expenses")
        .select(
          "id, kind, expense_date, category, description, amount, mode, reference, paid_to, notes, client_id, job_id, created_at, clients(id, name, assigned_staff), jobs(job_code, title, service_id, services(name))",
        )
        .not("client_id", "is", null)
        .order("expense_date", { ascending: false });

      const [invRes, jobsRes, expRes] = await Promise.all([invPromise, jobsPromise, expPromise]);

      if (invRes.error) throw invRes.error;
      if (jobsRes.error) throw jobsRes.error;
      if (expRes.error) throw expRes.error;

      const items: ReceivableItem[] = [];

      // Process Invoices
      for (const inv of invRes.data ?? []) {
        const out = Number(inv.outstanding ?? 0);
        if (out <= 0) continue;

        // An invoice linked to job(s) should strictly only come to outstanding if the job is completed/done
        const linkedJobStatuses = [
          (inv as any).jobs?.status,
          ...((inv.invoice_items as any[]) || []).map((x: any) => x.jobs?.status),
        ].filter(Boolean);

        if (linkedJobStatuses.length > 0 && linkedJobStatuses.some((st) => st !== "completed")) {
          continue;
        }

        const svcName =
          inv.invoice_items
            ?.map((x: any) => x.jobs?.services?.name)
            .filter(Boolean)
            .join(", ") ||
          inv.description ||
          "Invoice";

        items.push({
          id: inv.id,
          type: "invoice",
          reference_no: inv.invoice_no,
          invoice_no: inv.invoice_no,
          client_id: inv.client_id,
          client_name: inv.clients?.name ?? "Unknown Client",
          clients: inv.clients,
          assigned_staff: inv.clients?.assigned_staff ?? null,
          service_id: inv.invoice_items?.[0]?.jobs?.service_id ?? null,
          service_name: svcName,
          invoice_items: inv.invoice_items ?? [],
          description: inv.description ?? "",
          date: inv.invoice_date,
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          total: Number(inv.total || 0),
          amount_paid: Number(inv.amount_paid || 0),
          outstanding: out,
          status: inv.status,
          raw: inv,
        });
      }

      // Process Completed Jobs (both recurring and non-recurring)
      for (const j of jobsRes.data ?? []) {
        const hasActiveInvoice = (j as any).invoice_items?.some(
          (it: any) => it.invoices && it.invoices.status !== "cancelled",
        );
        const clearingRec = Array.isArray((j as any).job_clearing)
          ? (j as any).job_clearing[0]
          : (j as any).job_clearing;

        // Skip if already active in invoice, marked closed/invoiced, or cleared
        if (
          hasActiveInvoice ||
          j.financial_status === "closed" ||
          j.financial_status === "invoiced" ||
          clearingRec?.status === "cleared"
        ) {
          continue;
        }

        const advance = Number(clearingRec?.advance || 0);
        const fee = Number(j.fee || 0);
        const discount = Number(j.discount || clearingRec?.discount || 0);
        const netOwed = Math.max(0, fee - discount - advance);

        // Include any completed job with an outstanding unbilled balance
        if (netOwed <= 0) continue;

        const svcName = (j as any).services?.name ?? j.title ?? "Job";
        const jobDate = j.created_at
          ? j.created_at.slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const jobDueDate = j.due_date ?? jobDate;

        items.push({
          id: j.id,
          type: "job",
          reference_no: j.job_code,
          invoice_no: j.job_code,
          client_id: j.client_id,
          client_name: (j as any).clients?.name ?? "Unknown Client",
          clients: (j as any).clients,
          assigned_staff: (j as any).clients?.assigned_staff ?? null,
          service_id: j.service_id ?? null,
          service_name: svcName,
          invoice_items: [
            {
              amount: netOwed,
              description: j.title,
              jobs: {
                job_code: j.job_code,
                service_id: j.service_id,
                services: (j as any).services,
              },
            },
          ],
          description: j.title,
          date: jobDate,
          invoice_date: jobDate,
          due_date: jobDueDate,
          total: fee - discount,
          amount_paid: advance,
          outstanding: netOwed,
          status: "unbilled",
          raw: j,
        });
      }

      // Process Client Expenses (unreimbursed / uncleared)
      for (const e of expRes.data ?? []) {
        const isCleared =
          e.notes?.includes("Cleared in") ||
          e.notes?.toLowerCase().includes("reimbursed") ||
          e.notes?.toLowerCase().includes("settled");
        if (isCleared) continue;

        const amt = Number(e.amount || 0);
        if (amt <= 0) continue;

        const expDate =
          e.expense_date ??
          (e.created_at ? e.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
        const svcName = (e as any).jobs?.services?.name
          ? `${(e as any).jobs.services.name} (${e.category})`
          : e.category || "Reimbursement";

        items.push({
          id: e.id,
          type: "expense",
          reference_no: `EXP-${e.category || "Client"}`,
          invoice_no: `EXP-${e.category || "Client"}`,
          client_id: e.client_id!,
          client_name: (e as any).clients?.name ?? "Unknown Client",
          clients: (e as any).clients,
          assigned_staff: (e as any).clients?.assigned_staff ?? null,
          service_id: (e as any).jobs?.service_id ?? null,
          service_name: svcName,
          invoice_items: [
            {
              amount: amt,
              description: `${e.category}: ${e.description || ""}`.trim(),
              jobs: (e as any).jobs
                ? {
                    job_code: (e as any).jobs.job_code,
                    service_id: (e as any).jobs.service_id,
                    services: (e as any).jobs.services,
                  }
                : null,
            },
          ],
          description: e.description || e.category || "Out of pocket expense",
          date: expDate,
          invoice_date: expDate,
          due_date: expDate,
          total: amt,
          amount_paid: 0,
          outstanding: amt,
          status: "unreimbursed",
          raw: e,
        });
      }

      // Sort by due date ascending
      return items.sort((a, b) => (a.due_date > b.due_date ? 1 : -1));
    },
  });
}
