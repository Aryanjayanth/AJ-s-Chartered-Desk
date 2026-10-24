import { supabase } from "@/integrations/supabase/client";
import { downloadXlsx, type Cell } from "@/lib/io/write";
import { fmtDate, inr, today } from "@/lib/format";

interface BackupOptions {
  firmName?: string;
  userEmail?: string;
}

export async function downloadCompleteFirmBackup(options: BackupOptions = {}) {
  // Fetch current user and firm details
  const { data: userRes } = await supabase.auth.getUser();
  const userEmail = options.userEmail || userRes?.user?.email || "Admin";

  const { data: dbFirmRes } = await supabase.rpc("current_firm_id");
  const activeFirmId = dbFirmRes as string | null;

  // 1. Fetch all reference maps for readable foreign keys
  const [clientsRes, servicesRes, profilesRes] = await Promise.all([
    supabase.from("clients").select("id, name, client_code"),
    supabase.from("services").select("id, name, service_code"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);

  const clientMap = new Map<string, { name: string; code: string }>();
  (clientsRes.data ?? []).forEach((c) =>
    clientMap.set(c.id, { name: c.name, code: c.client_code }),
  );

  const serviceMap = new Map<string, { name: string; code: string }>();
  (servicesRes.data ?? []).forEach((s) =>
    serviceMap.set(s.id, { name: s.name, code: s.service_code }),
  );

  const profileMap = new Map<string, string>();
  (profilesRes.data ?? []).forEach((p) => profileMap.set(p.id, p.full_name || p.email || "Staff"));

  // 2. Fetch all firm tables
  const [
    clientsData,
    servicesData,
    clientServicesData,
    jobsData,
    invoicesData,
    invoiceItemsData,
    paymentsData,
    allocationsData,
    expensesData,
    settingsData,
  ] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("services").select("*").order("name"),
    supabase.from("client_services").select("*").order("created_at"),
    supabase.from("jobs").select("*").order("job_code"),
    supabase.from("invoices").select("*").order("invoice_no"),
    supabase.from("invoice_items").select("*").order("created_at"),
    supabase.from("payments").select("*").order("payment_code"),
    supabase.from("payment_allocations").select("*").order("created_at"),
    supabase.from("expenses").select("*").order("expense_date"),
    supabase.from("settings").select("*").limit(1).maybeSingle(),
  ]);

  const invoiceNoMap = new Map<string, string>();
  (invoicesData.data ?? []).forEach((inv) => invoiceNoMap.set(inv.id, inv.invoice_no));

  const paymentCodeMap = new Map<string, string>();
  (paymentsData.data ?? []).forEach((pay) => paymentCodeMap.set(pay.id, pay.payment_code));

  const effectiveFirmName = options.firmName || settingsData.data?.firm_name || "Practice";

  const sheets: { name: string; header: string[]; rows: Cell[][] }[] = [];

  // Sheet 1: Backup Summary
  const summaryRows: Cell[][] = [
    ["Practice Name", effectiveFirmName],
    ["Backup Date", today()],
    ["Backup Timestamp (UTC)", new Date().toISOString()],
    ["Exported By", userEmail],
    ["Firm ID", activeFirmId || "—"],
    [],
    ["Module / Entity", "Total Records"],
    ["Clients", clientsData.data?.length ?? 0],
    ["Services", servicesData.data?.length ?? 0],
    ["Recurring Schedules (Retainers)", clientServicesData.data?.length ?? 0],
    ["Jobs & Tasks", jobsData.data?.length ?? 0],
    ["Invoices", invoicesData.data?.length ?? 0],
    ["Invoice Line Items", invoiceItemsData.data?.length ?? 0],
    ["Payments & Receipts", paymentsData.data?.length ?? 0],
    ["Payment Allocations", allocationsData.data?.length ?? 0],
    ["Expenses", expensesData.data?.length ?? 0],
  ];
  sheets.push({
    name: "Backup Summary",
    header: ["System Property", "Value"],
    rows: summaryRows,
  });

  // Sheet 2: Clients
  if (clientsData.data) {
    sheets.push({
      name: "Clients",
      header: [
        "Client Code",
        "Name",
        "Type",
        "Mobile",
        "Email",
        "PAN",
        "TAN",
        "GSTIN",
        "Address",
        "Assigned Staff",
        "Status",
        "Notes",
        "Created At",
      ],
      rows: clientsData.data.map((c) => [
        c.client_code,
        c.name,
        c.client_type || "",
        c.mobile || "",
        c.email || "",
        c.pan || "",
        c.tan || "",
        c.gstin || "",
        c.address || "",
        c.assigned_staff ? profileMap.get(c.assigned_staff) || c.assigned_staff : "",
        c.status || "active",
        c.notes || "",
        c.created_at ? fmtDate(c.created_at) : "",
      ]),
    });
  }

  // Sheet 3: Services
  if (servicesData.data) {
    sheets.push({
      name: "Services",
      header: [
        "Service Code",
        "Service Name",
        "Category / Type",
        "Billing Type",
        "Frequency",
        "Auto-Invoice",
        "Active",
        "Description",
      ],
      rows: servicesData.data.map((s) => [
        s.service_code,
        s.name,
        s.service_type || "",
        s.billing_type || "",
        s.frequency || "",
        s.auto_invoice ? "Yes" : "No",
        s.active ? "Yes" : "No",
        s.description || "",
      ]),
    });
  }

  // Sheet 4: Recurring Schedules (Client Services)
  if (clientServicesData.data) {
    sheets.push({
      name: "Recurring Schedules",
      header: [
        "Client Code",
        "Client Name",
        "Service Code",
        "Service Name",
        "Frequency",
        "Agreed Fee",
        "Start Date",
        "End Date",
        "Due Days",
        "Assigned Staff",
        "Auto-Invoice",
        "Status",
        "Notes",
      ],
      rows: clientServicesData.data.map((cs) => {
        const client = clientMap.get(cs.client_id);
        const svc = serviceMap.get(cs.service_id);
        return [
          client?.code || "",
          client?.name || "",
          svc?.code || "",
          svc?.name || "",
          cs.frequency,
          cs.agreed_fee,
          fmtDate(cs.start_date),
          cs.end_date ? fmtDate(cs.end_date) : "Ongoing",
          cs.due_days,
          cs.assigned_staff ? profileMap.get(cs.assigned_staff) || cs.assigned_staff : "",
          cs.auto_invoice ? "Yes" : "No",
          cs.status,
          cs.notes || "",
        ];
      }),
    });
  }

  // Sheet 5: Jobs & Tasks
  if (jobsData.data) {
    sheets.push({
      name: "Jobs and Tasks",
      header: [
        "Job Code",
        "Title",
        "Client Code",
        "Client Name",
        "Service Name",
        "Period Start",
        "Period End",
        "Due Date",
        "Fee",
        "Discount",
        "Net Amount",
        "Status",
        "Financial Status",
        "Assigned Staff",
        "Auto-Invoice",
        "Notes",
        "Created At",
      ],
      rows: jobsData.data.map((j) => {
        const client = clientMap.get(j.client_id);
        const svc = serviceMap.get(j.service_id);
        return [
          j.job_code,
          j.title,
          client?.code || "",
          client?.name || "",
          svc?.name || "",
          j.period_start ? fmtDate(j.period_start) : "",
          j.period_end ? fmtDate(j.period_end) : "",
          j.due_date ? fmtDate(j.due_date) : "",
          j.fee ?? 0,
          j.discount ?? 0,
          j.net_amount ?? 0,
          j.status,
          j.financial_status,
          j.assigned_staff ? profileMap.get(j.assigned_staff) || j.assigned_staff : "",
          j.auto_invoice ? "Yes" : "No",
          j.notes || "",
          j.created_at ? fmtDate(j.created_at) : "",
        ];
      }),
    });
  }

  // Sheet 6: Invoices
  if (invoicesData.data) {
    sheets.push({
      name: "Invoices",
      header: [
        "Invoice No",
        "Invoice Date",
        "Due Date",
        "Client Code",
        "Client Name",
        "Subtotal",
        "Discount",
        "Tax Rate (%)",
        "Tax Amount",
        "Total Amount",
        "Paid Amount",
        "Outstanding Balance",
        "Status",
        "Notes",
      ],
      rows: invoicesData.data.map((inv) => {
        const client = clientMap.get(inv.client_id);
        return [
          inv.invoice_no,
          fmtDate(inv.invoice_date),
          inv.due_date ? fmtDate(inv.due_date) : "",
          client?.code || "",
          client?.name || "",
          inv.subtotal,
          inv.discount,
          inv.tax_rate,
          inv.tax_amount,
          inv.total,
          inv.amount_paid,
          inv.outstanding,
          inv.status,
          inv.notes || "",
        ];
      }),
    });
  }

  // Sheet 7: Invoice Line Items
  if (invoiceItemsData.data) {
    sheets.push({
      name: "Invoice Items",
      header: ["Invoice No", "Item Description", "Amount"],
      rows: invoiceItemsData.data.map((it) => [
        invoiceNoMap.get(it.invoice_id) || it.invoice_id,
        it.description,
        it.amount,
      ]),
    });
  }

  // Sheet 8: Payments & Receipts
  if (paymentsData.data) {
    sheets.push({
      name: "Payments",
      header: [
        "Receipt No",
        "Payment Date",
        "Client Code",
        "Client Name",
        "Payment Mode",
        "Reference / UTR",
        "Total Amount",
        "Allocated Amount",
        "Status",
        "Narration",
      ],
      rows: paymentsData.data.map((pay) => {
        const client = clientMap.get(pay.client_id);
        return [
          pay.payment_code,
          fmtDate(pay.payment_date),
          client?.code || "",
          client?.name || "",
          pay.mode,
          pay.reference || "",
          pay.amount,
          pay.allocated_amount,
          pay.status,
          pay.narration || "",
        ];
      }),
    });
  }

  // Sheet 9: Payment Allocations
  if (allocationsData.data) {
    sheets.push({
      name: "Payment Allocations",
      header: ["Receipt No", "Invoice No", "Allocated Amount", "Allocated Date"],
      rows: allocationsData.data.map((pa) => [
        paymentCodeMap.get(pa.payment_id) || pa.payment_id,
        invoiceNoMap.get(pa.invoice_id) || pa.invoice_id,
        pa.amount,
        pa.created_at ? fmtDate(pa.created_at) : "",
      ]),
    });
  }

  // Sheet 10: Expenses
  if (expensesData.data) {
    sheets.push({
      name: "Expenses",
      header: [
        "Expense Date",
        "Category",
        "Kind",
        "Amount",
        "Payment Mode",
        "Paid To",
        "Reference",
        "Description",
      ],
      rows: expensesData.data.map((ex) => [
        fmtDate(ex.expense_date),
        ex.category,
        ex.kind,
        ex.amount,
        ex.mode || "",
        ex.paid_to || "",
        ex.reference || "",
        ex.description || "",
      ]),
    });
  }

  // Sheet 11: Firm Settings
  if (settingsData.data) {
    const s = settingsData.data;
    sheets.push({
      name: "Practice Settings",
      header: ["Configuration Key", "Value"],
      rows: [
        ["Firm Name", s.firm_name || ""],
        ["Office Address", s.address || ""],
        ["GSTIN", s.gstin || ""],
        ["PAN", s.pan || ""],
        ["Phone Number", s.phone || ""],
        ["Email Address", s.email || ""],
        ["Bank Details", s.bank_details || ""],
        ["Default Tax Rate (%)", s.default_tax_rate ?? 0],
        ["Invoice Terms & Conditions", s.invoice_terms || ""],
      ],
    });
  }

  const safeFirm = effectiveFirmName.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 30);
  const stampStr = new Date().toISOString().slice(0, 10);
  const filename = `${safeFirm}_Complete_Backup_${stampStr}.xlsx`;

  await downloadXlsx(filename, sheets);

  const totalRecordCount =
    (clientsData.data?.length ?? 0) +
    (servicesData.data?.length ?? 0) +
    (clientServicesData.data?.length ?? 0) +
    (jobsData.data?.length ?? 0) +
    (invoicesData.data?.length ?? 0) +
    (paymentsData.data?.length ?? 0) +
    (expensesData.data?.length ?? 0);

  return {
    filename,
    sheetsCount: sheets.length,
    recordsCount: totalRecordCount,
  };
}
