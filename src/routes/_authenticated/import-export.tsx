import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChipSelect, NativeSelect, NoAccess, PageHeader, StatCard } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { ENTITIES, importableEntities, type Entity } from "@/lib/io/entities";
import { parseFile, planRows, toPayload, type RowPlan } from "@/lib/io/parse";
import { fetchRows, fetchSimple, insertRow, updateRow } from "@/lib/io/db";
import {
  downloadCsv,
  downloadTemplateCsv,
  downloadTemplateXlsx,
  downloadXlsx,
  type Cell,
} from "@/lib/io/write";
import { errMsg } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/import-export")({
  head: () => ({
    meta: [
      { title: "Import / Export — AJ's Chartered Desk" },
      { name: "description", content: "Bulk import and export of practice data." },
    ],
  }),
  component: ImportExportPage,
});

function ImportExportPage() {
  const { isManager } = useRoles();
  if (!isManager) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title="Import / Export" subtitle="Bulk data movement" />
        <NoAccess />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Import / Export"
        subtitle="Move data in and out of your practice in bulk."
      />
      <Tabs defaultValue="export">
        <TabsList>
          <TabsTrigger value="export">
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </TabsTrigger>
          <TabsTrigger value="import">
            <Upload className="mr-1.5 h-4 w-4" />
            Import
          </TabsTrigger>
        </TabsList>
        <TabsContent value="export" className="mt-4">
          <ExportPanel />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <ImportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------- export

function ExportPanel() {
  const [selected, setSelected] = useState<string[]>(["clients"]);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const chosen = ENTITIES.filter((e) => selected.includes(e.key));

  const run = async () => {
    if (!chosen.length) return toast.error("Select at least one thing to export.");
    setBusy(true);
    try {
      const sheets: { name: string; header: string[]; rows: Cell[][] }[] = [];

      for (const entity of chosen) {
        const rows = await fetchRows(entity.table);
        const decorated = await decorate(entity, rows);
        sheets.push({
          name: entity.label.replace(/[^A-Za-z0-9 ]/g, ""),
          header: entity.columns.map((c) => c.label),
          rows: decorated,
        });
      }

      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "csv" && sheets.length === 1) {
        const s = sheets[0];
        downloadCsv(`AJ's Chartered Desk_${chosen[0].key}_${stamp}.csv`, s.header, s.rows);
      } else if (format === "csv") {
        // Several entities in one CSV is ambiguous, so fall back to a workbook.
        await downloadXlsx(
          `AJ's Chartered Desk_export_${stamp}.xlsx`,
          sheets.map((s) => ({ ...s, name: s.name || "Data" })),
        );
        toast.info("Multiple entities export as a single Excel workbook, one sheet each.");
      } else {
        await downloadXlsx(
          `AJ's Chartered Desk_export_${stamp}.xlsx`,
          sheets.map((s) => ({ ...s, name: s.name || "Data" })),
        );
      }
      toast.success(`Exported ${chosen.map((c) => c.label).join(", ")}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardContent className="p-5">
          <div className="mb-4">
            <h3 className="font-semibold">What do you want to export?</h3>
            <p className="text-xs text-muted-foreground">
              Pick one or more. Each becomes its own sheet in the downloaded file.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ENTITIES.map((e) => (
              <label
                key={e.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(e.key)}
                  onChange={() => toggle(e.key)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{e.label}</span>
                  <span className="block text-xs text-muted-foreground">{e.blurb}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-4 border-t pt-4">
            <div className="w-52">
              <div className="mb-1.5 text-xs font-medium">File format</div>
              <ChipSelect
                ariaLabel="Export format"
                value={format}
                onChange={(v) => setFormat((v as "xlsx" | "csv") || "xlsx")}
                options={[
                  { value: "xlsx", label: "Excel (.xlsx)" },
                  { value: "csv", label: "CSV (.csv)" },
                ]}
              />
            </div>
            <Button onClick={run} disabled={busy || !chosen.length}>
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1 h-4 w-4" />
              )}
              Export {chosen.length || "nothing"}
              {chosen.length > 1 ? " entities" : chosen.length === 1 ? ` · ${chosen[0].label}` : ""}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <Info className="h-3.5 w-3.5" />
            Exports are a point-in-time snapshot
          </div>
          Exports include every record in your firm. Use them for backups, migrating to another
          system, or handing work to an accountant. Re-importing an export into the same firm will
          flag every row as a duplicate rather than creating copies.
        </CardContent>
      </Card>
    </div>
  );
}

/** Resolves reference columns to readable names and maps columns to headers. */
async function decorate(entity: Entity, rows: Record<string, unknown>[]): Promise<Cell[][]> {
  const refCols = entity.columns.filter((c) => c.type === "ref");

  const lookups: Record<string, Map<string, string>> = {};
  if (refCols.length) {
    await Promise.all(
      refCols.map(async (c) => {
        const table = c.ref === "clients" ? "clients" : "services";
        const rows = await fetchSimple(table, "id, name");
        const m = new Map<string, string>();
        rows.forEach((r) => m.set(String(r.id), String(r.name ?? "")));
        lookups[c.ref ?? table] = m;
      }),
    );
  }

  return rows.map((row) =>
    entity.columns.map((c) => {
      if (c.type === "ref") {
        const m = lookups[c.ref ?? ""];
        return m?.get(String(row[c.key] ?? "")) ?? "";
      }
      const v = row[c.key];
      return v === null || v === undefined ? "" : (v as Cell);
    }),
  );
}

// ------------------------------------------------------------------- import

type Phase = "pick" | "review" | "done";

function ImportPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entityKey, setEntityKey] = useState<string>(importableEntities[0].key);
  const entity = useMemo(
    () => ENTITIES.find((e) => e.key === entityKey) ?? importableEntities[0],
    [entityKey],
  );

  const [fileName, setFileName] = useState("");
  const [plans, setPlans] = useState<RowPlan[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [absent, setAbsent] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  } | null>(null);

  /** Lookup tables used to resolve the human-readable names in a file to ids. */
  const refs = useQuery({
    queryKey: ["import-refs", entity.key],
    enabled: phase !== "pick",
    queryFn: async () => {
      const [cl, sv] = await Promise.all([
        fetchSimple("clients", "id, name, client_code"),
        fetchSimple("services", "id, name, service_code"),
      ]);

      // A file may reference a record by its name or its code — accept both.
      const clientLookup = new Map<string, string>();
      cl.forEach((c) => {
        if (c.name) clientLookup.set(String(c.name).toUpperCase(), String(c.id));
        if (c.client_code) clientLookup.set(String(c.client_code).toUpperCase(), String(c.id));
      });
      const serviceLookup = new Map<string, string>();
      sv.forEach((s) => {
        if (s.name) serviceLookup.set(String(s.name).toUpperCase(), String(s.id));
        if (s.service_code) serviceLookup.set(String(s.service_code).toUpperCase(), String(s.id));
      });

      // Retainers dedupe on client+service, matched by name before ids resolve.
      let retainers: Map<string, { id: string; label: string }> | undefined;
      if (entity.key === "client_services") {
        const cs = await fetchSimple("client_services", "id, client_id, service_id");
        const cname = new Map(cl.map((c) => [String(c.id), String(c.name ?? "")]));
        const sname = new Map(sv.map((s) => [String(s.id), String(s.name ?? "")]));
        retainers = new Map();
        cs.forEach((r) => {
          const cn = cname.get(String(r.client_id)) ?? "?";
          const sn = sname.get(String(r.service_id)) ?? "?";
          retainers!.set(`${cn}::${sn}`.toUpperCase(), {
            id: String(r.id),
            label: `${cn} → ${sn}`,
          });
        });
      }

      return { clientLookup, serviceLookup, retainers };
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const parsed = await parseFile(file);
      setFileName(file.name);
      if (!parsed.header.length) throw new Error("That file has no header row.");

      // Wait for the lookup tables before planning duplicates.
      await refs.refetch();
      const data = refs.data;

      // Dedupe keys must match exactly what dedupeKey() builds: the entity's
      // dedupe columns, uppercased and joined with "::".
      const map = new Map<string, { id: string; label: string }>();
      if (entity.key === "clients") {
        const rows = await fetchSimple("clients", "id, name, pan");
        rows.forEach((r) => {
          const pan = String(r.pan ?? "").toUpperCase();
          if (pan) map.set(pan, { id: String(r.id), label: `${r.name} (${r.pan})` });
        });
      } else if (entity.key === "services") {
        const rows = await fetchSimple("services", "id, name");
        rows.forEach((r) => {
          const name = String(r.name ?? "").toUpperCase();
          if (name) map.set(name, { id: String(r.id), label: String(r.name) });
        });
      } else {
        for (const [k, v] of data?.retainers ?? []) map.set(k, v);
      }

      const {
        plans: built,
        missingColumns,
        absentOptional,
      } = planRows(entity, parsed.header, parsed.rows, map);
      setMissing(missingColumns);
      setAbsent(absentOptional);
      setWarnings(parsed.warnings);

      // Resolve ref columns and flag anything that does not exist yet.
      const withRefs = built.map((p) => {
        const next = { ...p, errors: [...p.errors] };
        for (const c of entity.columns.filter((x) => x.type === "ref")) {
          const v = (p.values[c.key] ?? "").trim().toUpperCase();
          if (!v) continue;
          const lookup = c.ref === "clients" ? data?.clientLookup : data?.serviceLookup;
          const resolved = lookup?.get(v);
          if (!resolved) {
            next.errors.push(
              `${c.label} "${p.values[c.key]}" not found — create the ${
                c.ref === "clients" ? "client" : "service"
              } first`,
            );
          } else {
            next.values[c.key] = resolved;
          }
        }
        return next;
      });

      setPlans(withRefs);
      setPhase("review");
    } catch (e) {
      toast.error(errMsg(e));
      setPlans([]);
      setPhase("pick");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setAll = (decision: RowPlan["decision"]) =>
    setPlans((ps) =>
      ps.map((p) =>
        p.errors.length
          ? p
          : { ...p, decision: p.match && decision === "create" ? "create" : decision },
      ),
    );

  const stats = useMemo(() => {
    const invalid = plans.filter((p) => p.errors.length);
    const dupes = plans.filter((p) => !p.errors.length && p.match);
    const fresh = plans.filter((p) => !p.errors.length && !p.match);
    const willCreate = plans.filter((p) => !p.errors.length && p.decision === "create");
    const willUpdate = plans.filter((p) => !p.errors.length && p.decision === "update");
    return {
      invalid,
      dupes,
      fresh,
      willCreate,
      willUpdate,
      actionable: willCreate.length + willUpdate.length,
      skipped: plans.length - invalid.length - willCreate.length - willUpdate.length,
    };
  }, [plans]);

  const execute = async () => {
    setBusy(true);
    const counters = { created: 0, updated: 0, skipped: 0, failed: 0 };
    try {
      for (const p of stats.willCreate) {
        const error = await insertRow(entity.table, toPayload(entity, p.values));
        if (error) counters.failed++;
        else counters.created++;
      }
      for (const p of stats.willUpdate) {
        const error = await updateRow(entity.table, p.match!.id, toPayload(entity, p.values));
        if (error) counters.failed++;
        else counters.updated++;
      }
      counters.skipped = stats.skipped + stats.invalid.length;

      setResult(counters);
      setPhase("done");
      qc.invalidateQueries();
      if (counters.created || counters.updated) {
        toast.success(
          `${counters.created} created, ${counters.updated} updated${
            counters.failed ? `, ${counters.failed} failed` : ""
          }`,
        );
      } else toast.info("Nothing was imported.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPlans([]);
    setMissing([]);
    setAbsent([]);
    setWarnings([]);
    setResult(null);
    setFileName("");
    setPhase("pick");
  };

  return (
    <div className="space-y-4">
      {/* Step 1 — entity + template + file */}
      <Card className="shadow-none">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              1
            </span>
            <div>
              <h3 className="font-semibold">Choose the data and download the template</h3>
              <p className="text-xs text-muted-foreground">
                The template lists every column, which are required, and the exact format each one
                expects.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-medium">What are you importing?</div>
              <NativeSelect
                value={entityKey}
                onChange={(e) => {
                  setEntityKey(e.target.value);
                  reset();
                }}
              >
                {importableEntities.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
              </NativeSelect>
              <p className="mt-1.5 text-xs text-muted-foreground">{entity.blurb}</p>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium">Get the blank template</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadTemplateXlsx(entity)}
                  disabled={busy}
                >
                  <FileSpreadsheet className="mr-1 h-4 w-4" />
                  Excel template
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadTemplateCsv(entity)}>
                  <Download className="mr-1 h-4 w-4" />
                  CSV template
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                The Excel template has a <span className="font-medium">Format</span> sheet
                explaining every column, plus dropdowns so you can&apos;t pick an invalid value.
              </p>
            </div>
          </div>

          <div className="mt-5 border-t pt-4">
            <div className="mb-1.5 text-xs font-medium">2. Fill it in and upload</div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xlsm,text/csv"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-4 w-4" />
                )}
                Choose file…
              </Button>
              {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Not importable explainer */}
      {phase === "pick" && (
        <Card className="shadow-none">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Info className="h-4 w-4" />
              Why can&apos;t I import invoices or payments?
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {ENTITIES.filter((e) => !e.importable).map((e) => (
                <li key={e.key}>
                  <span className="font-medium text-foreground">{e.label}:</span>{" "}
                  {e.importBlockReason}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              All of them can still be <span className="font-medium">exported</span> for backup or
              migration.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — review */}
      {phase === "review" && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Rows read" value={plans.length} />
            <StatCard label="New" value={stats.fresh.length} tone="success" />
            <StatCard label="Duplicates" value={stats.dupes.length} tone="warning" />
            <StatCard label="Problems" value={stats.invalid.length} tone="danger" />
          </div>

          {(missing.length > 0 || warnings.length > 0) && (
            <Card className="border-destructive/40 bg-destructive/5 shadow-none">
              <CardContent className="p-4 text-sm">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Fix these before importing
                </div>
                {missing.length > 0 && (
                  <p className="text-xs">
                    Your file is missing required column{missing.length === 1 ? "" : "s"}{" "}
                    {missing.map((m) => (
                      <span
                        key={m}
                        className="mr-1 rounded bg-destructive/10 px-1.5 py-0.5 font-mono"
                      >
                        {m}
                      </span>
                    ))}
                    . Re-download the template and use its exact headers.
                  </p>
                )}
                {warnings.map((w) => (
                  <p key={w} className="text-xs">
                    {w}
                  </p>
                ))}
                <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
                  Start over
                </Button>
              </CardContent>
            </Card>
          )}

          {missing.length === 0 && absent.length > 0 && (
            <Card className="shadow-none">
              <CardContent className="p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Not in your file (optional):</span>{" "}
                {absent.join(", ")}. Those fields will be left blank.
              </CardContent>
            </Card>
          )}

          {stats.dupes.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5 shadow-none">
              <CardContent className="p-4">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <ArrowLeftRight className="h-4 w-4" />
                  {stats.dupes.length} row{stats.dupes.length === 1 ? "" : "s"} already exist
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  These match a record already in your firm. They are{" "}
                  <span className="font-medium">skipped</span> for now — choose what should happen
                  to each one below, or apply a decision to all of them.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAll("skip")}>
                    Skip all
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAll("update")}>
                    Overwrite all with file values
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAll("create")}>
                    Create all as new copies
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="shadow-none">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                <h3 className="font-semibold">Review every row</h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Start over
                  </Button>
                  <Button
                    onClick={execute}
                    disabled={busy || stats.actionable === 0 || missing.length > 0}
                  >
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Import {stats.actionable} row{stats.actionable === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">Row</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">
                        {entity.columns.find((c) => !c.computed)?.label ?? "Record"}
                      </th>
                      <th className="px-3 py-2.5 font-medium">Issues / existing match</th>
                      <th className="px-3 py-2.5 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => {
                      const primary = entity.columns.find((c) => !c.computed)?.key ?? "name";
                      return (
                        <tr key={p.id} className="border-t align-top">
                          <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                            {p.line}
                          </td>
                          <td className="px-3 py-2.5">
                            {p.errors.length ? (
                              <StatusBadge status="invalid" />
                            ) : p.match ? (
                              <StatusBadge status="duplicate" />
                            ) : (
                              <StatusBadge status="new" />
                            )}
                          </td>
                          <td className="max-w-[16rem] truncate px-3 py-2.5 font-medium">
                            {p.values[primary] || "—"}
                          </td>
                          <td className="max-w-md px-3 py-2.5 text-xs">
                            {p.errors.length ? (
                              <ul className="space-y-0.5 text-destructive">
                                {p.errors.map((e) => (
                                  <li key={e}>{e}</li>
                                ))}
                              </ul>
                            ) : p.match ? (
                              <span className="text-muted-foreground">
                                Matches{" "}
                                <span className="font-medium text-foreground">{p.match.label}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {p.errors.length ? (
                              <span className="text-xs text-muted-foreground">Cannot import</span>
                            ) : (
                              <select
                                value={p.decision}
                                onChange={(e) =>
                                  setPlans((ps) =>
                                    ps.map((x) =>
                                      x.id === p.id
                                        ? { ...x, decision: e.target.value as RowPlan["decision"] }
                                        : x,
                                    ),
                                  )
                                }
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              >
                                {p.match ? (
                                  <>
                                    <option value="skip">Skip — keep existing</option>
                                    <option value="update">Overwrite with file</option>
                                    <option value="create">Create as new copy</option>
                                  </>
                                ) : (
                                  <option value="create">Create new</option>
                                )}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {stats.willCreate.length} to create · {stats.willUpdate.length} to overwrite ·{" "}
                  {stats.skipped} skipped · {stats.invalid.length} unusable
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Step 4 — done */}
      {phase === "done" && result && (
        <Card className="shadow-none">
          <CardContent className="p-6">
            <div className="mb-4 flex items-center gap-2">
              {result.failed ? (
                <XCircle className="h-5 w-5 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-success" />
              )}
              <h3 className="font-semibold">Import finished</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Created" value={result.created} tone="success" />
              <StatCard label="Overwritten" value={result.updated} tone="info" />
              <StatCard label="Skipped" value={result.skipped} />
              <StatCard
                label="Failed"
                value={result.failed}
                tone={result.failed ? "danger" : undefined}
              />
            </div>
            {result.failed > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Some rows were rejected by the database — most often a duplicate that appeared while
                you were reviewing, or a value that violates a business rule. Re-run the import to
                see the exact reason on each row.
              </p>
            )}
            <Button className="mt-4" variant="outline" onClick={reset}>
              Import another file
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
