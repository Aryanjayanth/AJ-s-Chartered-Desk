export const inr = (n: number | string | null | undefined): string => {
  if (n === null || n === undefined || n === "") return "₹0";
  const v = Number(n);
  if (isNaN(v)) return "₹0";
  const isNegative = v < 0;
  const absVal = Math.abs(v);
  const formatted = absVal.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return isNegative ? `-₹${formatted}` : `₹${formatted}`;
};

export const inrShort = (n: number | string | null | undefined): string => {
  const v = Number(n ?? 0);
  if (isNaN(v)) return "₹0";
  const isNeg = v < 0;
  const abs = Math.abs(v);
  let str = "";
  if (abs >= 10000000) {
    str = `${(abs / 10000000).toFixed(2).replace(/\.00$/, "")} Cr`;
  } else if (abs >= 100000) {
    str = `${(abs / 100000).toFixed(2).replace(/\.00$/, "")} L`;
  } else if (abs >= 1000) {
    str = `${(abs / 1000).toFixed(1).replace(/\.0$/, "")} k`;
  } else {
    str = abs.toLocaleString("en-IN");
  }
  return isNeg ? `-₹${str}` : `₹${str}`;
};

export const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return "—";
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return "—";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  const str = String(d).trim();
  if (!str) return "—";
  // Already in DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
  // If in DD-MM-YYYY, convert to DD/MM/YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split("-");
    return `${dd}/${mm}/${yyyy}`;
  }
  // If YYYY-MM-DD or starts with YYYY-MM-DD from an ISO string
  const isoMatch = str.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${dd}/${mm}/${yyyy}`;
  }
  // Fallback to Date parser
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, "0");
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return str;
};

export const fmtDateTime = (d: string | Date | null | undefined): string => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!dt || isNaN(dt.getTime())) return fmtDate(d);
  return `${fmtDate(dt)} ${dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
};

export const today = () => new Date().toISOString().slice(0, 10);

export const daysBetween = (from?: string | null, to: string = today()): number => {
  if (!from) return 0;
  const t1 = new Date(to).getTime();
  const t2 = new Date(from).getTime();
  if (isNaN(t1) || isNaN(t2)) return 0;
  return Math.floor((t1 - t2) / 86400000);
};

export const ageingBucket = (dueDate?: string | null): string => {
  if (!dueDate) return "Current";
  const d = daysBetween(dueDate);
  if (isNaN(d) || d <= 0) return "Current";
  if (d <= 30) return "1–30 Days";
  if (d <= 60) return "31–60 Days";
  if (d <= 90) return "61–90 Days";
  return "90+ Days";
};
export const BUCKETS = ["Current", "1–30 Days", "31–60 Days", "61–90 Days", "90+ Days"];

export const label = (s: string | null | undefined) =>
  (s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const MODES: Record<string, string> = {
  cash: "Cash",
  bank: "Bank Transfer",
  upi: "UPI",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};
export const FREQS: Record<string, string> = {
  one_time: "One Time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  yearly: "Yearly",
};
export const JOB_STATUSES = ["pending", "in_progress", "completed", "on_hold", "cancelled"];

export type InvoiceLike = { status: string; due_date: string; outstanding: number | null };
export const invoiceDisplayStatus = (i: InvoiceLike) =>
  (i.status === "unpaid" || i.status === "partially_paid") &&
  Number(i.outstanding) > 0 &&
  i.due_date < today()
    ? "overdue"
    : i.status;

export type JobLike = { status: string; due_date: string | null };
export const jobDisplayStatus = (j: JobLike) =>
  j.due_date && j.due_date < today() && !["completed", "cancelled"].includes(j.status)
    ? "overdue"
    : j.status;

export const errMsg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: string }).message)
    : "Something went wrong";

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.map(esc).join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}
