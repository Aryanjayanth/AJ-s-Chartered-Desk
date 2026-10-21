import { supabase } from "@/integrations/supabase/client";

export const STANDARD_SERVICES_LIST = [
  {
    name: "GST Filing (GSTR-3B & GSTR-1)",
    service_type: "GST",
    billing_type: "recurring",
    frequency: "monthly",
    auto_invoice: false,
    active: true,
    description: "Monthly GSTR-1 & GSTR-3B preparation, reconciliation, and filing",
  },
  {
    name: "GST Registration & Amendments",
    service_type: "GST",
    billing_type: "one_time",
    frequency: "one_time",
    auto_invoice: false,
    active: true,
    description: "New GST registration, core and non-core amendments, cancellation",
  },
  {
    name: "TDS / TCS Return Filing",
    service_type: "Income Tax",
    billing_type: "recurring",
    frequency: "quarterly",
    auto_invoice: false,
    active: true,
    description: "Quarterly TDS/TCS calculation, challan verification, and return filing",
  },
  {
    name: "Income Tax Return (ITR)",
    service_type: "Income Tax",
    billing_type: "recurring",
    frequency: "yearly",
    auto_invoice: false,
    active: true,
    description: "Annual Income Tax Return filing for Individuals, Firms, and Corporates",
  },
  {
    name: "Tax Audit (Form 3CA / 3CB & 3CD)",
    service_type: "Income Tax",
    billing_type: "one_time",
    frequency: "one_time",
    auto_invoice: false,
    active: true,
    description: "Tax audit under section 44AB of the Income Tax Act",
  },
  {
    name: "Accounting & Bookkeeping",
    service_type: "Accounting & Bookkeeping",
    billing_type: "recurring",
    frequency: "monthly",
    auto_invoice: false,
    active: true,
    description: "Monthly accounting, ledger posting, bank reconciliation, and MIS",
  },
  {
    name: "Statutory Audit",
    service_type: "Statutory Audit",
    billing_type: "one_time",
    frequency: "one_time",
    auto_invoice: false,
    active: true,
    description: "Statutory audit of company accounts under the Companies Act",
  },
  {
    name: "ROC & MCA Compliance (AOC-4, MGT-7)",
    service_type: "ROC & MCA Compliance",
    billing_type: "recurring",
    frequency: "yearly",
    auto_invoice: false,
    active: true,
    description: "Annual returns, financial statement filings, and Director KYC",
  },
  {
    name: "Payroll Processing & PF / ESI",
    service_type: "Payroll & PF / ESI",
    billing_type: "recurring",
    frequency: "monthly",
    auto_invoice: false,
    active: true,
    description: "Monthly payroll computation, payslips, and PF/ESI compliance",
  },
  {
    name: "Company / LLP Incorporation",
    service_type: "Company / LLP Incorporation",
    billing_type: "one_time",
    frequency: "one_time",
    auto_invoice: false,
    active: true,
    description: "Name reservation, SPICe+ filing, DIN, MOA/AOA, and Certificate of Incorporation",
  },
];

export async function fetchFirmServices(firmId?: string) {
  let query = supabase
    .from("services")
    .select(
      "id, name, service_type, billing_type, frequency, auto_invoice, active, description, service_code, firm_id",
    )
    .eq("active", true)
    .order("name");

  if (firmId) {
    query = query.eq("firm_id", firmId);
  }

  const { data, error } = await query;

  if (error) {
    console.warn("Error fetching services:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Explicitly loads standard CA practice services into a firm.
 * Must only be called upon explicit user request (e.g. clicking 'Load Standard Services'),
 * never automatically, to ensure firm data isolation.
 */
export async function seedStandardServices(firmId?: string) {
  const payload = STANDARD_SERVICES_LIST.map((svc) => ({
    ...svc,
    ...(firmId ? { firm_id: firmId } : {}),
  }));

  const { data, error } = await supabase
    .from("services")
    .insert(payload)
    .select(
      "id, name, service_type, billing_type, frequency, auto_invoice, active, description, service_code, firm_id",
    );

  if (error) {
    console.error("Could not seed standard services:", error);
    throw error;
  }

  return data ?? [];
}
