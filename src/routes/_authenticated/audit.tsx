import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  History,
  FileText,
  User,
  Calendar,
  RotateCcw,
  Code,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/app/DataTable";
import { DateRangePicker, NativeSelect, NoAccess, PageHeader } from "@/components/app/common";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { fmtDate, fmtDateTime, inr, label } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — AJ's Chartered Desk" },
      { name: "description", content: "Every important change, recorded and verifiable." },
    ],
  }),
  component: AuditPage,
});

interface AuditRow {
  id: number | string;
  created_at: string;
  user_id: string | null;
  module: string;
  action: string;
  record_id: string | null;
  reason: string | null;
  old_value: unknown;
  new_value: unknown;
}

interface FieldDiff {
  key: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
  isDifferent: boolean;
  isNew: boolean;
  isDeleted: boolean;
}

function formatFieldValue(key: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";

  const lowerKey = key.toLowerCase();

  // Currency fields
  if (
    lowerKey.includes("amount") ||
    lowerKey.includes("fee") ||
    lowerKey.includes("total") ||
    lowerKey.includes("subtotal") ||
    lowerKey.includes("discount") ||
    lowerKey.includes("balance")
  ) {
    const num = Number(val);
    if (!isNaN(num)) return inr(num);
  }

  // Date fields (YYYY-MM-DD or ISO timestamp)
  if (typeof val === "string") {
    if (
      (lowerKey.includes("date") ||
        lowerKey.includes("created_at") ||
        lowerKey.includes("period")) &&
      /^\d{4}-\d{2}-\d{2}/.test(val)
    ) {
      return val.includes("T") ? fmtDateTime(val) : fmtDate(val);
    }
    return val;
  }

  if (typeof val === "object") {
    return JSON.stringify(val);
  }

  return String(val);
}

function parseAuditDiff(oldVal: unknown, newVal: unknown): FieldDiff[] {
  const oldObj = (oldVal && typeof oldVal === "object" ? oldVal : {}) as Record<string, unknown>;
  const newObj = (newVal && typeof newVal === "object" ? newVal : {}) as Record<string, unknown>;

  const allKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));
  const ignoredKeys = new Set(["id", "firm_id", "created_at", "updated_at"]);

  const diffs: FieldDiff[] = [];

  for (const k of allKeys) {
    if (ignoredKeys.has(k)) continue;
    const vOld = oldObj[k];
    const vNew = newObj[k];
    const strOld = JSON.stringify(vOld);
    const strNew = JSON.stringify(vNew);
    const isDifferent = strOld !== strNew;
    const isNew = vOld === undefined && vNew !== undefined;
    const isDeleted = vOld !== undefined && vNew === undefined;

    const formattedLabel = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    diffs.push({
      key: k,
      label: formattedLabel,
      oldValue: vOld,
      newValue: vNew,
      isDifferent,
      isNew,
      isDeleted,
    });
  }

  // Changed/new fields first, then alphabetical
  diffs.sort((a, b) => {
    if (a.isDifferent && !b.isDifferent) return -1;
    if (!a.isDifferent && b.isDifferent) return 1;
    return a.label.localeCompare(b.label);
  });

  return diffs;
}

function AuditPage() {
  const { isManager, loading } = useRoles();
  const { data: profiles } = useProfiles();
  const [mod, setMod] = useState("");
  const [act, setAct] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sel, setSel] = useState<AuditRow | null>(null);

  const q = useQuery<AuditRow[]>({
    queryKey: ["audit", mod, act, from, to],
    enabled: isManager,
    queryFn: async () => {
      let qq = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (mod) qq = qq.eq("module", mod);
      if (act) qq = qq.ilike("action", `%${act}%`);
      if (from) qq = qq.gte("created_at", from);
      if (to) qq = qq.lte("created_at", `${to}T23:59:59`);

      const { data, error } = await qq;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  if (loading) return null;
  if (!isManager) return <NoAccess />;

  const uname = (id: string | null) =>
    id ? (profiles?.find((p) => p.id === id)?.full_name ?? id.slice(0, 8)) : "System Automated";

  const summary = (v: unknown) => {
    const o = (v ?? {}) as Record<string, unknown>;
    return String(
      o.client_code ?? o.job_code ?? o.invoice_no ?? o.payment_code ?? o.name ?? o.title ?? "",
    );
  };

  const hasActiveFilters = Boolean(mod || act || from || to);

  const diffList = sel ? parseAuditDiff(sel.old_value, sel.new_value) : [];
  const changedOnlyList = diffList.filter((d) => d.isDifferent);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Trail"
        subtitle="Chronological audit log tracking every data update, deletion, and financial operation."
      />

      <DataTable<AuditRow>
        rows={q.data}
        loading={q.isLoading}
        pageSize={20}
        empty="No audit records match the current filters."
        searchPlaceholder="Search user, module, action, record, reason…"
        search={(a) =>
          `${a.module} ${a.action} ${a.record_id ?? ""} ${uname(a.user_id)} ${summary(a.new_value)} ${a.reason ?? ""}`
        }
        exportFilename="audit_trail_logs"
        exportTransform={(a) => ({
          Timestamp: fmtDateTime(a.created_at),
          User: uname(a.user_id),
          Module: label(a.module),
          Action: label(a.action),
          "Record Reference": summary(a.new_value) || a.record_id || "",
          Reason: a.reason ?? "",
        })}
        onRowClick={(a) => setSel(a)}
        toolbar={
          <>
            <NativeSelect
              value={mod}
              onChange={(e) => setMod(e.target.value)}
              className="w-36 text-xs h-9"
            >
              <option value="">All modules</option>
              {[
                "clients",
                "services",
                "client_services",
                "jobs",
                "invoices",
                "discounts",
                "payments",
                "payment_allocations",
                "payment_reversals",
                "expenses",
                "bank_transactions",
                "user_roles",
                "settings",
              ].map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </NativeSelect>

            <NativeSelect
              value={act}
              onChange={(e) => setAct(e.target.value)}
              className="w-32 text-xs h-9"
            >
              <option value="">All actions</option>
              <option value="create">Created / Added</option>
              <option value="update">Updated</option>
              <option value="delete">Deleted</option>
              <option value="cancel">Cancelled</option>
              <option value="reverse">Reversed</option>
            </NativeSelect>

            <DateRangePicker
              from={from}
              to={to}
              onFromChange={setFrom}
              onToChange={setTo}
              label="Date"
            />

            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMod("");
                  setAct("");
                  setFrom("");
                  setTo("");
                }}
                className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                title="Reset all filters"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </>
        }
        columns={[
          {
            key: "created_at",
            header: "Date & Time",
            className: "w-44 whitespace-nowrap",
            sort: (a) => a.created_at,
            render: (a) => (
              <span className="font-mono text-xs text-muted-foreground">
                {fmtDateTime(a.created_at)}
              </span>
            ),
          },
          {
            key: "user_id",
            header: "User",
            className: "w-36",
            sort: (a) => uname(a.user_id),
            render: (a) => (
              <div className="flex items-center gap-1.5 truncate">
                <span
                  className="font-medium text-xs text-foreground truncate"
                  title={uname(a.user_id)}
                >
                  {uname(a.user_id)}
                </span>
              </div>
            ),
          },
          {
            key: "module",
            header: "Module",
            className: "min-w-[110px] whitespace-nowrap",
            sort: (a) => a.module,
            render: (a) => (
              <span className="inline-flex items-center rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                {label(a.module)}
              </span>
            ),
          },
          {
            key: "action",
            header: "Action",
            className: "min-w-[170px] whitespace-nowrap",
            sort: (a) => a.action,
            render: (a) => {
              const actionStr = a.action.toLowerCase();
              const isCreate =
                actionStr.includes("create") ||
                actionStr.includes("insert") ||
                actionStr.includes("seed");
              const isDanger =
                actionStr.includes("delete") ||
                actionStr.includes("cancel") ||
                actionStr.includes("reverse");

              return (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border select-none whitespace-nowrap tracking-tight",
                    isCreate
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                      : isDanger
                        ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30"
                        : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      isCreate ? "bg-emerald-500" : isDanger ? "bg-rose-500" : "bg-blue-500",
                    )}
                  />
                  {label(a.action)}
                </span>
              );
            },
          },
          {
            key: "record",
            header: "Record",
            className: "min-w-[140px]",
            render: (a) => {
              const rec = summary(a.new_value ?? a.old_value);
              return (
                <span className="font-mono text-xs font-semibold text-primary truncate block max-w-[200px]">
                  {rec || a.record_id?.slice(0, 8) || "—"}
                </span>
              );
            },
          },
          {
            key: "reason",
            header: "Reason / Notes",
            className: "max-w-[200px]",
            render: (a) => (
              <span
                className="text-xs text-muted-foreground truncate block max-w-[200px]"
                title={a.reason ?? ""}
              >
                {a.reason || <span className="opacity-40 italic">None provided</span>}
              </span>
            ),
          },
        ]}
      />

      {/* Human-Readable Detail & Comparison Modal */}
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3 border-b bg-muted/20">
            <div className="flex items-center justify-between gap-2 pr-6">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {sel ? label(sel.module) : ""}
                </span>
                <DialogTitle className="text-base font-semibold">
                  {sel ? label(sel.action) : ""} Operation
                </DialogTitle>
              </div>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Performed by{" "}
              <strong className="text-foreground">{uname(sel?.user_id ?? null)}</strong> on{" "}
              {sel?.created_at ? fmtDateTime(sel.created_at) : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Reason Banner if present */}
            {sel?.reason && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
                <span className="font-semibold block mb-0.5">Stated Reason:</span>
                {sel.reason}
              </div>
            )}

            {/* Structured Comparison View */}
            <Tabs defaultValue="diff" className="w-full">
              <TabsList className="grid grid-cols-3 w-full h-8 text-xs">
                <TabsTrigger value="diff" className="text-xs">
                  Changes Only ({changedOnlyList.length})
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs">
                  All Fields ({diffList.length})
                </TabsTrigger>
                <TabsTrigger value="raw" className="text-xs gap-1">
                  <Code className="h-3 w-3" /> Raw JSON
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Changes Only */}
              <TabsContent value="diff" className="mt-3">
                {changedOnlyList.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground border rounded-lg bg-muted/20">
                    No field-level changes detected between records.
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 border-b font-medium text-muted-foreground">
                        <tr>
                          <th className="py-2 px-3 w-36">Field</th>
                          <th className="py-2 px-3">Previous Value</th>
                          <th className="py-2 px-3">New Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {changedOnlyList.map((item) => (
                          <tr key={item.key} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 px-3 font-medium text-foreground whitespace-nowrap">
                              {item.label}
                            </td>
                            <td className="py-2.5 px-3">
                              {item.oldValue !== undefined ? (
                                <span className="inline-block rounded px-1.5 py-0.5 bg-rose-500/10 text-rose-700 dark:text-rose-300 line-through">
                                  {formatFieldValue(item.key, item.oldValue)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60 italic">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {item.newValue !== undefined ? (
                                <span className="inline-block rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium">
                                  {formatFieldValue(item.key, item.newValue)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60 italic">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              {/* Tab 2: All Fields */}
              <TabsContent value="all" className="mt-3">
                <div className="rounded-lg border overflow-hidden max-h-80 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b font-medium text-muted-foreground sticky top-0">
                      <tr>
                        <th className="py-2 px-3 w-36">Field</th>
                        <th className="py-2 px-3">Previous Value</th>
                        <th className="py-2 px-3">New Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {diffList.map((item) => (
                        <tr
                          key={item.key}
                          className={cn(
                            "transition-colors",
                            item.isDifferent
                              ? "bg-amber-500/5 hover:bg-amber-500/10"
                              : "hover:bg-muted/30",
                          )}
                        >
                          <td className="py-2 px-3 font-medium text-foreground whitespace-nowrap">
                            {item.label}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={cn(
                                item.isDifferent && item.oldValue !== undefined
                                  ? "text-rose-600 line-through"
                                  : "text-muted-foreground",
                              )}
                            >
                              {formatFieldValue(item.key, item.oldValue)}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={cn(
                                item.isDifferent && item.newValue !== undefined
                                  ? "text-emerald-600 font-medium"
                                  : "text-foreground",
                              )}
                            >
                              {formatFieldValue(item.key, item.newValue)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* Tab 3: Raw JSON */}
              <TabsContent value="raw" className="mt-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                      Previous Value (JSON)
                    </div>
                    <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px]">
                      {sel?.old_value ? JSON.stringify(sel.old_value, null, 2) : "null"}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                      New Value (JSON)
                    </div>
                    <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px]">
                      {sel?.new_value ? JSON.stringify(sel.new_value, null, 2) : "null"}
                    </pre>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
