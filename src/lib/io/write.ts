import type { Entity } from "./entities";

export type Cell = string | number | boolean | null;

/** RFC-4180 field escaping. */
const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // A leading =, +, - or @ makes Excel treat the cell as a formula.
  const needsGuard = /^[=+\-@\t\r]/.test(s);
  const body = needsGuard ? `'${s}` : s;
  return /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
};

export const toCsv = (header: string[], rows: Cell[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const downloadCsv = (filename: string, header: string[], rows: Cell[][]) => {
  // BOM so Excel opens UTF-8 (₹, en-dashes) correctly instead of mojibake.
  const blob = new Blob(["﻿" + toCsv(header, rows)], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, filename);
};

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/**
 * Excel needs a few extra libs in the browser bundle; load it on demand so the
 * cost stays out of the main chunk.
 */
const loadExcel = () => import("exceljs");

const HEADER_FILL = "FF1E293B";
const REQUIRED_FILL = "FFDC2626";
const OPTIONAL_FILL = "FF475569";
const SAMPLE_FILL = "FFF1F5F9";

/** Builds the template: a data sheet plus a "Format" sheet documenting every column. */
export async function buildTemplateXlsx(entity: Entity): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "AJ's Chartered Desk";
  wb.created = new Date();

  const cols = entity.columns.filter((c) => !c.computed);
  const sheetName = entity.label.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 28) || "Data";

  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.addRow(cols.map((c) => c.label));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  header.height = 26;
  header.commit();

  // Two example rows: one blank (to fill in) and one filled (to show the shape).
  // These must be added before any range-based validation is applied.
  ws.addRow(cols.map(() => ""));
  ws.addRow(cols.map((c) => c.sample));
  ws.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SAMPLE_FILL } };
  ws.getRow(3).font = { italic: true, color: { argb: "FF64748B" } };

  // Real Excel dropdowns for enum columns so users cannot invent values.
  // Applied as a range (not per cell) — touching individual cells here would
  // materialise rows and push the sample rows out of position.
  const FIRST_FILL_ROW = 2;
  const LAST_FILL_ROW = 500;
  // `dataValidations` exists on exceljs's Worksheet at runtime and is the
  // supported way to add a range-scoped rule, but it is missing from the
  // shipped type declarations — hence this narrow cast.
  const validationHost = ws as unknown as {
    dataValidations: { add: (range: string, rule: Record<string, unknown>) => void };
  };
  cols.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    const range = `${letter}${FIRST_FILL_ROW}:${letter}${LAST_FILL_ROW}`;

    if (c.type === "enum" && c.options?.length) {
      validationHost.dataValidations.add(range, {
        type: "list",
        allowBlank: true,
        formulae: [`"${c.options.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: `Invalid ${c.label}`,
        error: `Choose one of: ${c.options.join(", ")}`,
      });
    } else if (c.type === "phone") {
      validationHost.dataValidations.add(range, {
        type: "textLength",
        operator: "equal",
        allowBlank: !c.required,
        formulae: [10],
        showInputMessage: true,
        promptTitle: "10-Digit Mobile",
        prompt: "Enter exactly 10 digits without country code or spaces.",
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: `Invalid ${c.label}`,
        error: "Phone number must be exactly 10 digits.",
      });
    } else if (c.type === "pan") {
      validationHost.dataValidations.add(range, {
        type: "textLength",
        operator: "equal",
        allowBlank: true,
        formulae: [10],
        showInputMessage: true,
        promptTitle: "10-Character PAN",
        prompt: "5 letters, 4 numbers, 1 letter (e.g. ABCDE1234F).",
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: `Invalid ${c.label}`,
        error: "PAN must be exactly 10 characters.",
      });
    }
  });

  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.min(
      Math.max(c.label.length + 4, c.sample.length + 2, (c.note?.length ?? 0) + 2),
      42,
    );
  });

  // ---- Format sheet ----
  const doc = wb.addWorksheet("Format", { views: [{ state: "frozen", ySplit: 1 }] });
  doc.columns = [
    { header: "Column", key: "label", width: 30 },
    { header: "Required", key: "required", width: 11 },
    { header: "Format", key: "type", width: 14 },
    { header: "Allowed values / guidance", key: "guide", width: 62 },
  ];
  const dh = doc.getRow(1);
  dh.font = { bold: true, color: { argb: "FFFFFFFF" } };
  dh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };

  const notes = [
    "",
    `ENTITY: ${entity.label} — ${entity.blurb}`,
    "",
    "HOW TO USE THIS FILE",
    "1. Fill the columns on the '" + sheetName + "' sheet. Do not rename or reorder the headers.",
    "2. Leave the grey example row (row 3) in place or delete it — the importer skips blank rows.",
    "3. Import it from Administration → Import / Export.",
    "4. For enum columns use the dropdown. Everything else accepts free text.",
    "5. Dates must be YYYY-MM-DD (2026-04-01). Numbers must be plain digits — no ₹, no commas.",
    "",
  ];
  notes.forEach((n) => doc.addRow([n]));

  doc.addRow([]);
  cols.forEach((c) => {
    const guide = c.type === "enum" ? `One of: ${c.options?.join(" | ")}` : (c.note ?? "");
    const row = doc.addRow([c.label, c.required ? "Yes" : "No", c.type, guide]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: c.required ? REQUIRED_FILL : OPTIONAL_FILL },
    };
    row.getCell(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(4).alignment = { wrapText: true, vertical: "top" };
  });

  doc.addRow([]);
  doc.addRow(["Computed by AJ's Chartered Desk (ignored on import):"]);
  entity.columns
    .filter((c) => c.computed)
    .forEach((c) => doc.addRow([c.label, "—", c.type, c.note ?? "Generated automatically."]));

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function downloadTemplateXlsx(entity: Entity) {
  const blob = await buildTemplateXlsx(entity);
  downloadBlob(blob, `${entity.key}_template_${stamp()}.xlsx`);
}

/** CSV twin of the template, for people who prefer a plain spreadsheet. */
export function downloadTemplateCsv(entity: Entity) {
  const cols = entity.columns.filter((c) => !c.computed);
  const guide = cols.map((c) => {
    const g = c.type === "enum" ? `one of: ${c.options?.join(" | ")}` : (c.note ?? "");
    return [c.label, c.required ? "REQUIRED" : "optional", c.type, g];
  });
  const rows: Cell[][] = [
    [],
    [`${entity.label} — ${entity.blurb}`],
    [],
    ["Column", "Required", "Format", "Allowed values / guidance"],
    ...guide,
  ];
  downloadCsv(`${entity.key}_template_${stamp()}.csv`, [], rows);
}

export async function downloadXlsx(
  filename: string,
  sheets: { name: string; header: string[]; rows: Cell[][] }[],
) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "AJ's Chartered Desk";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 28) || "Data");
    ws.addRow(s.header);
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    h.commit();
    for (const r of s.rows) ws.addRow(r);
    ws.columns.forEach((c, i) => {
      c.width = Math.min(Math.max(String(s.header[i] ?? "").length + 6, 12), 40);
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
