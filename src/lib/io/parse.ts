import type { Col, Entity } from "./entities";

export type ParsedFile = {
  header: string[];
  rows: string[][];
  sheetNames: string[];
  /** Non-fatal problems, e.g. extra sheets in a workbook. */
  warnings: string[];
};

/** RFC-4180 CSV reader: handles quoted fields, embedded commas/newlines and CRLF. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  // Strip BOM if present.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Ignore a trailing blank line.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r") {
      // swallow; the \n does the work
    } else if (ch === "\n") {
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length) endRow();

  if (!rows.length) return { header: [], rows: [] };
  const [header, ...rest] = rows;
  return {
    header: header.map((h) => h.trim()),
    rows: rest,
  };
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    const { header, rows } = parseCsv(text);
    return { header, rows, sheetNames: [], warnings: [] };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());

    // Skip the documentation sheet if the user re-uploads our own template.
    const ws =
      wb.getWorksheet("Format") && !wb.worksheets.some((w) => w.name !== "Format")
        ? wb.getWorksheet(wb.worksheets[0].name)
        : wb.worksheets[0];
    if (!ws) throw new Error("That workbook has no sheets.");

    const warnings: string[] = [];
    const others = wb.worksheets.filter((w) => w.id !== ws.id).map((w) => w.name);
    if (others.length)
      warnings.push(`Only the "${ws.name}" sheet was read. Ignored: ${others.join(", ")}`);

    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (r) => {
      const values = (r.values as unknown[]) ?? [];
      const line: string[] = [];
      // exceljs arrays are 1-indexed with a hole at 0.
      for (let i = 1; i < values.length; i++) {
        const v = values[i];
        line.push(cellToString(v));
      }
      grid.push(line);
    });

    // Find the header row: the first row with at least 2 non-empty cells that
    // looks like labels rather than data.
    let headIdx = grid.findIndex(
      (l) => l.filter((c) => c.trim()).length >= 2 && !/^\d+$/.test(l[1]?.trim() ?? ""),
    );
    if (headIdx === -1) throw new Error("Could not find a header row in that file.");
    while (headIdx > 0 && grid[headIdx].filter((c) => c.trim()).length === 0) headIdx--;

    const header = grid[headIdx].map((h) => h.trim());
    const rows = grid.slice(headIdx + 1).filter((l) => l.some((c) => c.trim()));
    return { header, rows, sheetNames: wb.worksheets.map((w) => w.name), warnings };
  }
  throw new Error("Unsupported file type. Use a .csv or .xlsx file.");
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return o.text;
    if (o.result !== undefined) return String(o.result);
  }
  return String(v);
}

// ---------------------------------------------------------------- validation

export type RowStatus = "new" | "duplicate" | "invalid";

export type RowPlan = {
  id: string;
  index: number;
  /** Original file row number (1-based, counting the header). */
  line: number;
  values: Record<string, string>;
  errors: string[];
  /** Matching existing row, when this import collides with live data. */
  match?: { id: string; label: string };
  /** User's decision for duplicates. */
  decision: "create" | "update" | "skip";
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;
const PHONE_10_RE = /^[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (s: string) => s.replace(/\u00a0/g, " ").trim();

/** Strips common phone formatting (+91, leading 0, spaces, dashes) to extract raw digits */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^0-9]/g, "");
  // If user entered +91 or 91 with 12 digits, extract the 10 digits
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

export function validateValue(col: Col, raw: string): string | null {
  const v = clean(raw);
  if (!v) return null; // emptiness is handled by the required check
  switch (col.type) {
    case "email":
      return EMAIL_RE.test(v) ? null : "not a valid email address";
    case "phone": {
      const digits = normalizePhone(v);
      return PHONE_10_RE.test(digits) ? null : "must be exactly 10 digits (e.g. 9876543210)";
    }
    case "pan":
      return PAN_RE.test(v.toUpperCase())
        ? null
        : "must be exactly 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)";
    case "tan":
      return TAN_RE.test(v.toUpperCase())
        ? null
        : "must be 4 letters, 5 digits, 1 letter (e.g. DELA12345B)";
    case "gstin":
      return GSTIN_RE.test(v.toUpperCase()) ? null : "must be 15 characters (e.g. 29ABCDE1234F1Z5)";
    case "number": {
      const n = Number(v.replace(/,/g, ""));
      return Number.isFinite(n) && n >= 0
        ? null
        : "must be a positive number, digits only (no ₹ or commas)";
    }
    case "date":
      return DATE_RE.test(v) && !Number.isNaN(Date.parse(v))
        ? null
        : "must be YYYY-MM-DD (e.g. 2026-04-01)";
    case "enum": {
      const allowed = col.options ?? [];
      const match = allowed.find((o) => o.toLowerCase() === v.toLowerCase());
      if (!match) return `must be one of: ${allowed.join(", ")}`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * Turns a parsed file into per-row plans: values keyed by column, validation
 * errors, and a duplicate flag when the row collides with existing data.
 */
export function planRows(
  entity: Entity,
  header: string[],
  rows: string[][],
  existing: Map<string, { id: string; label: string }>,
): { plans: RowPlan[]; missingColumns: string[]; absentOptional: string[] } {
  const cols = entity.columns.filter((c) => !c.computed);

  // Match headers case-insensitively and ignore surrounding whitespace.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headerIndex = new Map<string, number>();
  header.forEach((h, i) => headerIndex.set(norm(h), i));

  // Only a missing *required* column makes a file unusable. Optional columns may
  // be left out entirely — that is the whole point of them being optional.
  const absent = cols.filter((c) => !headerIndex.has(norm(c.label)));
  const missingColumns = absent.filter((c) => c.required).map((c) => c.label);
  const absentOptional = absent.filter((c) => !c.required).map((c) => c.label);

  const plans: RowPlan[] = [];

  rows.forEach((line, i) => {
    const values: Record<string, string> = {};
    const errors: string[] = [];

    for (const c of cols) {
      const idx = headerIndex.get(norm(c.label));
      const raw = idx === undefined ? "" : (line[idx] ?? "");
      const v = clean(raw);

      if (!v) {
        values[c.key] = "";
        if (c.required) errors.push(`${c.label} is required`);
        continue;
      }

      const problem = validateValue(c, v);
      if (problem) errors.push(`${c.label} ${problem}`);
      values[c.key] = problem ? "" : v;
    }

    // Duplicates are matched on the entity's dedupe columns, and only count
    // when every dedupe column has a value to match on.
    const dedupeValues = entity.dedupe.map((k) => clean(values[k] ?? "")).filter(Boolean);
    const match =
      dedupeValues.length === entity.dedupe.length
        ? existing.get(dedupeKey(entity, values))
        : undefined;

    plans.push({
      id: `r${i}`,
      index: i,
      line: i + 2,
      values,
      errors,
      match,
      // Duplicates default to skip so nothing live is overwritten by accident.
      decision: match ? "skip" : "create",
    });
  });

  return { plans, missingColumns, absentOptional };
}

export const dedupeKey = (entity: Entity, values: Record<string, string>) =>
  entity.dedupe.map((k) => clean(values[k] ?? "").toUpperCase()).join("::");

/** Human label for an existing row, used in the review table. */
export const rowLabel = (r: Record<string, unknown>) =>
  String(r.name ?? r.invoice_no ?? r.payment_code ?? r.job_code ?? r.id ?? "");

export function coerce(col: Col, raw: string): unknown {
  const v = clean(raw);
  if (!v) return null;
  switch (col.type) {
    case "number":
      return Number(v.replace(/,/g, ""));
    case "boolean":
      return !/^(no|n|false|0)$/i.test(v);
    case "date":
      return v;
    case "enum":
      return col.options?.find((o) => o.toLowerCase() === v.toLowerCase()) ?? v;
    case "phone":
      return normalizePhone(v);
    default:
      return col.type === "pan" || col.type === "tan" || col.type === "gstin" ? v.toUpperCase() : v;
  }
}

/**
 * Builds the insert/update payload for a row, honouring server-managed columns.
 *
 * Blank optional values are deliberately OMITTED rather than written as null.
 * On insert that yields the column default; on update it leaves the existing
 * value untouched — why: a file that simply omits a column must never be able to
 * wipe data it says nothing about.
 */
export function toPayload(entity: Entity, values: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const c of entity.columns) {
    if (c.computed) continue;
    const v = coerce(c, values[c.key] ?? "");
    if (v === null && !c.required) continue;
    out[c.key] = v;
  }
  return out;
}
