/**
 * Service master options and the due-date arithmetic used by the assignment form.
 *
 * The date maths here MUST stay in step with `generate_recurring_jobs_for_firm`
 * in Postgres — that function is what actually creates the jobs, so a preview
 * that disagrees with it would be worse than no preview at all.
 *   one_time  -> due = start_date + due_days
 *   recurring -> period_start = date_trunc('month', start_date)
 *                period_end   = period_start + step - 1 day
 *                due          = period_end + due_days
 *
 * Note the periods are a ROLLING window from the month the assignment starts,
 * not calendar-aligned. A quarterly retainer starting 20-11-2026 covers
 * 01-11-2026 to 31-01-2027, because the generator does `ps + interval '3 months'`.
 * That is deliberate and must not be "corrected" here without changing the SQL.
 */

export const SERVICE_TYPES = [
  "GST",
  "Income Tax",
  "Statutory Audit",
  "Internal Audit",
  "Accounting & Bookkeeping",
  "Payroll & PF / ESI",
  "ROC & MCA Compliance",
  "Company / LLP Incorporation",
  "Management Consultancy",
  "Appeals & Litigation",
  "Other",
] as const;

/** Canonical mapping helper to ensure GST registration groups under GST, and TDS/TCS & Tax Audits under Income Tax */
export const normalizeServiceType = (type: string | null | undefined, name?: string): string => {
  const t = (type ?? "").trim();
  const n = (name ?? "").trim().toLowerCase();
  if (
    t === "GST Registration & Amendments" ||
    t === "GST Registration" ||
    n.includes("gst registration")
  )
    return "GST";
  if (
    t === "TDS / TCS" ||
    t === "TDS/TCS" ||
    t === "TDS" ||
    t === "Tax Audit" ||
    n.includes("tds") ||
    n.includes("tcs") ||
    n.includes("tax audit")
  )
    return "Income Tax";
  return t || "Other";
};

/** Frequencies offered when a service is recurring. `one_time` is not offered. */
export const RECURRING_FREQS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-Yearly" },
  { value: "yearly", label: "Yearly" },
] as const;

export type RecurringFreq = (typeof RECURRING_FREQS)[number]["value"];

const FREQ_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

/** End of the period that begins at `iso`, matching the RPC's `ps + step - 1 day`. */
export const periodEndFor = (iso: string, freq: string) => {
  const months = FREQ_MONTHS[freq] ?? 1;
  const start = new Date(`${monthStart(iso)}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + months);
  start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString().slice(0, 10);
};

export type DuePreview = {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
};

/** First job this assignment would produce — the same one the generator creates. */
export const firstDuePreview = (
  startDate: string,
  freq: string,
  dueDays: number,
): DuePreview | null => {
  if (!startDate) return null;
  const days = Number.isFinite(dueDays) ? dueDays : 0;
  if (freq === "one_time") {
    return { periodStart: startDate, periodEnd: startDate, dueDate: addDays(startDate, days) };
  }
  const ps = monthStart(startDate);
  const pe = periodEndFor(ps, freq);
  return { periodStart: ps, periodEnd: pe, dueDate: addDays(pe, days) };
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** e.g. "Apr 2026". Accepts an ISO date. */
export const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
};
