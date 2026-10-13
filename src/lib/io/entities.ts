/**
 * Declarative registry of importable/exportable entities.
 *
 * The same definitions drive the template file, the file parser, row validation
 * and the export writer — so the documented format can never drift from the
 * format actually accepted.
 *
 * Import is deliberately limited to master/reference data. Invoice and payment
 * totals are computed by security-definer RPCs in Postgres and those tables
 * carry no INSERT grant for staff, so importing them directly would bypass the
 * rules the whole billing engine depends on — why: financial records are never
 * written by a client.
 */

import type { Database } from "@/integrations/supabase/types";

export type ColType =
  | "text"
  | "longtext"
  | "email"
  | "phone"
  | "pan"
  | "tan"
  | "gstin"
  | "enum"
  | "number"
  | "date"
  | "boolean"
  | "ref";

export type Col = {
  /** Database column. */
  key: string;
  /** Header written into the template / expected on import. */
  label: string;
  type: ColType;
  required?: boolean;
  /** Allowed values for `enum` columns. */
  options?: readonly string[];
  /** Value written into the template's example row. */
  sample: string;
  /** Extra guidance shown in the template's Format sheet. */
  note?: string;
  /** For `ref` columns: which entity the human-readable value resolves against. */
  ref?: "clients" | "services";
  /** Present on export but ignored on import (server-managed). */
  computed?: boolean;
};

export type TableName = keyof Database["public"]["Tables"] & string;

export type Entity = {
  key: "clients" | "services" | "client_services" | "jobs" | "invoices" | "payments";
  table: TableName;
  label: string;
  blurb: string;
  importable: boolean;
  /** Shown in the UI when importable is false. */
  importBlockReason?: string;
  /** Columns compared against existing rows to spot duplicates. */
  dedupe: string[];
  columns: Col[];
};

export const CLIENT_TYPES = [
  "Company",
  "Partnership",
  "LLP",
  "Proprietorship",
  "Individual",
  "HUF",
  "Trust",
  "Society",
  "NPO",
  "Others",
] as const;

export const GST_TYPES = ["Regular", "Composition", "Unregistered", "SEZ"] as const;

export const CLIENT_STATUSES = ["active", "inactive", "suspended"] as const;

export const CONCERN_ROLES = [
  "Owner",
  "Partner",
  "Director",
  "Promoter",
  "Accountant",
  "Company Secretary",
  "Office Manager",
  "Others",
] as const;

export const SERVICE_TYPES = [
  "GST",
  "Income Tax",
  "Accounting",
  "Payroll",
  "Audit",
  "Compliance",
  "Advisory",
  "Other",
] as const;

export const FREQS = ["one_time", "monthly", "quarterly", "half_yearly", "yearly"] as const;

export const BILLING_TYPES = ["recurring", "one_time"] as const;

export const CS_STATUSES = ["active", "paused", "stopped"] as const;

export const ENTITIES: Entity[] = [
  {
    key: "clients",
    table: "clients",
    label: "Clients",
    blurb: "Client master — identity, tax identifiers, contacts and addresses.",
    importable: true,
    dedupe: ["pan"],
    columns: [
      // --- Mandatory columns first ---
      {
        key: "name",
        label: "Client Name",
        type: "text",
        required: true,
        sample: "Acme Corporation Pvt Ltd",
        note: "Legal or trading name of the entity. (Required)",
      },
      {
        key: "client_type",
        label: "Client Type",
        type: "enum",
        required: true,
        options: CLIENT_TYPES,
        sample: "Company",
        note: "Select from dropdown. (Required)",
      },
      {
        key: "address",
        label: "Address",
        type: "longtext",
        required: true,
        sample: "14 Church Street, Bengaluru 560001",
        note: "Full billing address. (Required)",
      },
      {
        key: "mobile",
        label: "Phone Number",
        type: "phone",
        required: true,
        sample: "9876543210",
        note: "Exactly 10 digits mobile number. (Required)",
      },
      // --- Optional columns ---
      {
        key: "secondary_phone",
        label: "Secondary Phone",
        type: "phone",
        sample: "9876543211",
        note: "Optional alternate 10-digit number.",
      },
      { key: "email", label: "Email", type: "email", sample: "accounts@acme.com", note: "Optional valid email address." },
      {
        key: "pan",
        label: "PAN",
        type: "pan",
        sample: "ABCDE1234F",
        note: "Exactly 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). Optional.",
      },
      {
        key: "tan",
        label: "TAN",
        type: "tan",
        sample: "DELA12345B",
        note: "10 characters: 4 letters, 5 digits, 1 letter. Optional.",
      },
      {
        key: "gstin",
        label: "GSTIN",
        type: "gstin",
        sample: "29ABCDE1234F1Z5",
        note: "15 alphanumeric characters. Optional.",
      },
      {
        key: "gst_type",
        label: "GST Type",
        type: "enum",
        options: GST_TYPES,
        sample: "Regular",
        note: "Leave blank if the client is unregistered.",
      },
      {
        key: "industry",
        label: "Industry / Business Type",
        type: "text",
        sample: "Information Technology (IT / Software)",
        note: "Any value accepted. Optional.",
      },
      {
        key: "contact_person_name",
        label: "Name of Concerned Person",
        type: "text",
        sample: "Ravi Menon",
        note: "Optional contact person name.",
      },
      {
        key: "contact_person_phone",
        label: "Concerned Person's Phone",
        type: "phone",
        sample: "9876543212",
        note: "Optional 10-digit phone number.",
      },
      {
        key: "contact_person_role",
        label: "Concerned Person's Role",
        type: "enum",
        options: CONCERN_ROLES,
        sample: "Owner",
        note: "Optional role/designation.",
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        options: CLIENT_STATUSES,
        sample: "active",
        note: "active, inactive, or suspended. Leave blank for active.",
      },
      { key: "notes", label: "Notes", type: "longtext", sample: "Referred by Mr. Rao.", note: "Optional internal notes." },
      {
        key: "client_code",
        label: "Client Code",
        type: "text",
        computed: true,
        sample: "CL0001",
        note: "Sequential per firm. Generated automatically, so ignore this column on import.",
      },
    ],
  },
  {
    key: "services",
    table: "services",
    label: "Services",
    blurb: "Your price list — what you sell, how often, and at what fee.",
    importable: true,
    dedupe: ["name"],
    columns: [
      {
        key: "name",
        label: "Service Name",
        type: "text",
        required: true,
        sample: "GST Monthly Filing",
      },
      {
        key: "service_type",
        label: "Service Type",
        type: "enum",
        options: SERVICE_TYPES,
        sample: "GST",
      },
      {
        key: "description",
        label: "Description",
        type: "longtext",
        sample: "Monthly GSTR-1 and GSTR-3B preparation and filing.",
      },
      {
        key: "frequency",
        label: "Frequency",
        type: "enum",
        required: true,
        options: FREQS,
        sample: "monthly",
      },
      {
        key: "billing_type",
        label: "Billing Type",
        type: "enum",
        required: true,
        options: BILLING_TYPES,
        sample: "recurring",
      },
      {
        key: "active",
        label: "Active",
        type: "boolean",
        sample: "Yes",
        note: "Yes or No. Leave blank for Yes.",
      },
    ],
  },
  {
    key: "client_services",
    table: "client_services",
    label: "Client Retainers",
    blurb: "Which client buys which service, at what agreed fee and frequency.",
    importable: true,
    dedupe: ["client", "service"],
    columns: [
      {
        key: "client",
        label: "Client",
        type: "ref",
        ref: "clients",
        required: true,
        sample: "Acme Corporation Pvt Ltd",
        note: "Match by client name or client code. The client must already exist.",
      },
      {
        key: "service",
        label: "Service",
        type: "ref",
        ref: "services",
        required: true,
        sample: "GST Monthly Filing",
        note: "Match by service name or service code. The service must already exist.",
      },
      {
        key: "agreed_fee",
        label: "Agreed Fee",
        type: "number",
        required: true,
        sample: "4500",
        note: "In rupees, no symbol or separators.",
      },
      {
        key: "frequency",
        label: "Frequency",
        type: "enum",
        required: true,
        options: FREQS,
        sample: "monthly",
      },
      {
        key: "start_date",
        label: "Start Date",
        type: "date",
        sample: "2026-04-01",
        note: "YYYY-MM-DD. Leave blank for today.",
      },
      {
        key: "end_date",
        label: "End Date",
        type: "date",
        sample: "",
        note: "YYYY-MM-DD. Leave blank for an open-ended retainer.",
      },
      { key: "due_days", label: "Due Days", type: "number", sample: "20" },
      { key: "status", label: "Status", type: "enum", options: CS_STATUSES, sample: "active" },
      { key: "notes", label: "Notes", type: "longtext", sample: "" },
    ],
  },
  {
    key: "jobs",
    table: "jobs",
    label: "Jobs",
    blurb: "Compliance work items. Generated automatically from retainers every day.",
    importable: false,
    importBlockReason:
      "Jobs are generated by the daily recurring-job scheduler and their status moves through update_job_status. Creating them by hand would produce duplicate or orphaned work.",
    dedupe: [],
    columns: [
      { key: "job_code", label: "Job Code", type: "text", sample: "JOB0001-1026" },
      { key: "title", label: "Title", type: "text", sample: "GSTR-3B — Apr 2026" },
      { key: "status", label: "Status", type: "text", sample: "pending" },
      { key: "due_date", label: "Due Date", type: "date", sample: "2026-05-20" },
      { key: "net_amount", label: "Net Amount", type: "number", sample: "4500" },
    ],
  },
  {
    key: "invoices",
    table: "invoices",
    label: "Invoices",
    blurb: "Tax invoices and their GST totals.",
    importable: false,
    importBlockReason:
      "Invoice subtotal, discount and CGST/SGST/IGST are computed inside the create_invoice function. Direct inserts would bypass those rules, so invoices can only be created through the app or the API.",
    dedupe: [],
    columns: [
      { key: "invoice_no", label: "Invoice No", type: "text", sample: "INV0001-1026" },
      { key: "invoice_date", label: "Invoice Date", type: "date", sample: "2026-05-01" },
      { key: "due_date", label: "Due Date", type: "date", sample: "2026-05-21" },
      { key: "subtotal", label: "Subtotal", type: "number", sample: "4500" },
      { key: "total", label: "Total", type: "number", sample: "4725" },
      { key: "paid", label: "Paid", type: "number", sample: "0" },
      { key: "outstanding", label: "Outstanding", type: "number", sample: "4725" },
      { key: "status", label: "Status", type: "text", sample: "unpaid" },
    ],
  },
  {
    key: "payments",
    table: "payments",
    label: "Payments",
    blurb: "Money received, and its allocation to invoices.",
    importable: false,
    importBlockReason:
      "A payment only becomes meaningful once it is allocated, and allocation is validated by the allocate_payment function (it can never exceed the invoice balance). Opening balances belong in invoices, not payments.",
    dedupe: [],
    columns: [
      { key: "payment_code", label: "Receipt No", type: "text", sample: "REC0001-1026" },
      { key: "payment_date", label: "Payment Date", type: "date", sample: "2026-05-02" },
      { key: "mode", label: "Mode", type: "text", sample: "bank" },
      { key: "reference", label: "Reference", type: "text", sample: "UTR123456789" },
      { key: "amount", label: "Amount", type: "number", sample: "4725" },
      { key: "allocated", label: "Allocated", type: "number", sample: "0" },
      { key: "status", label: "Status", type: "text", sample: "unallocated" },
    ],
  },
];

export const entityByKey = (key: string) => ENTITIES.find((e) => e.key === key);

export const importableEntities = ENTITIES.filter((e) => e.importable);
