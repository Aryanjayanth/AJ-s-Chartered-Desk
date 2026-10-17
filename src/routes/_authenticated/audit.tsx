import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/app/DataTable";
import { NativeSelect, NoAccess, PageHeader } from "@/components/app/common";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { fmtDateTime, label } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — CA PracticeDesk" },
      { name: "description", content: "Every important change, recorded." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { isManager, loading } = useRoles();
  const { data: profiles } = useProfiles();
  const [mod, setMod] = useState("");
  const [from, setFrom] = useState("");
  const [sel, setSel] = useState<{
    old_value: unknown;
    new_value: unknown;
    module: string;
    action: string;
  } | null>(null);
  const q = useQuery({
    queryKey: ["audit", mod, from],
    enabled: isManager,
    queryFn: async () => {
      let qq = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (mod) qq = qq.eq("module", mod);
      if (from) qq = qq.gte("created_at", from);
      const { data, error } = await qq;
      if (error) throw error;
      return data;
    },
  });
  if (loading) return null;
  if (!isManager) return <NoAccess />;
  const uname = (id: string | null) =>
    id ? (profiles?.find((p) => p.id === id)?.full_name ?? id.slice(0, 8)) : "System";
  const summary = (v: unknown) => {
    const o = (v ?? {}) as Record<string, unknown>;
    return String(
      o.client_code ?? o.job_code ?? o.invoice_no ?? o.payment_code ?? o.name ?? o.title ?? "",
    );
  };

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Immutable log of every important operation" />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        pageSize={25}
        empty="No audit records."
        search={(a) =>
          `${a.module} ${a.action} ${a.record_id} ${uname(a.user_id)} ${summary(a.new_value)} ${a.reason ?? ""}`
        }
        exportFilename="audit_logs"
        exportTransform={(a) => ({
          Timestamp: fmtDateTime(a.created_at),
          User: uname(a.user_id),
          Module: label(a.module),
          Action: label(a.action),
          "Record ID": a.record_id,
          Summary: summary(a.new_value),
          Reason: a.reason ?? "",
        })}
        onRowClick={(a) => setSel(a)}
        toolbar={
          <>
            <NativeSelect value={mod} onChange={(e) => setMod(e.target.value)} className="w-48">
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
                "bank_transactions",
                "user_roles",
                "settings",
              ].map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </NativeSelect>
            <span className="text-xs text-muted-foreground">From</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-40"
            />
          </>
        }
        columns={[
          { key: "t", header: "Date / Time", render: (a) => fmtDateTime(a.created_at) },
          { key: "u", header: "User", render: (a) => uname(a.user_id) },
          { key: "m", header: "Module", render: (a) => label(a.module) },
          { key: "a", header: "Action", render: (a) => label(a.action) },
          {
            key: "r",
            header: "Record",
            render: (a) => (
              <span className="text-xs">
                {summary(a.new_value ?? a.old_value) || a.record_id?.slice(0, 8)}
              </span>
            ),
          },
          { key: "reason", header: "Reason", render: (a) => a.reason ?? "—" },
        ]}
      />
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{sel && `${label(sel.module)} · ${label(sel.action)}`}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Old value</div>
              <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(sel?.old_value, null, 2) ?? "—"}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">New value</div>
              <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(sel?.new_value, null, 2) ?? "—"}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
