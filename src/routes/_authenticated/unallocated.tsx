import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/DataTable";
import { NoAccess, PageHeader, StatCard } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { daysBetween, fmtDate, inr, MODES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/unallocated")({
  head: () => ({
    meta: [
      { title: "Unallocated Payments — AJ's Chartered Desk" },
      { name: "description", content: "Payments not yet cleared." },
    ],
  }),
  component: UnallocatedPage,
});

function UnallocatedPage() {
  const { isFinance, loading } = useRoles();
  const q = useQuery({
    queryKey: ["unallocated"],
    enabled: isFinance,
    queryFn: async () =>
      (
        await supabase
          .from("payments")
          .select("*, clients(name)")
          .in("status", ["unallocated", "partially_allocated"])
          .order("payment_date")
      ).data ?? [],
  });
  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  const total = (q.data ?? []).reduce(
    (s, p) => s + Number(p.amount) - Number(p.allocated_amount),
    0,
  );
  return (
    <div>
      <PageHeader
        title="Unallocated Payments"
        subtitle="Money received but not yet set off against invoices"
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Payments" value={q.data?.length ?? 0} />
        <StatCard label="Unallocated Balance" value={inr(total)} tone="warning" />
      </div>
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty="No unallocated payments — everything is cleared."
        search={(p) => `${p.payment_code} ${p.clients?.name} ${p.reference}`}
        exportFilename="unallocated_payments"
        exportTransform={(p) => ({
          "Payment Code": p.payment_code,
          Client: p.clients?.name ?? "",
          "Payment Date": fmtDate(p.payment_date),
          "Age (Days)": daysBetween(p.payment_date),
          Mode: MODES[p.mode] ?? p.mode,
          Reference: p.reference ?? "",
          "Total Amount": p.amount,
          "Allocated Amount": p.allocated_amount,
          "Unallocated Balance": Number(p.amount) - Number(p.allocated_amount),
          Status: p.status,
        })}
        columns={[
          { key: "payment_code", header: "Payment", className: "font-mono text-xs" },
          {
            key: "c",
            header: "Client",
            sort: (p) => p.clients?.name ?? "",
            render: (p) => <span className="font-medium">{p.clients?.name}</span>,
          },
          {
            key: "d",
            header: "Date",
            sort: (p) => p.payment_date,
            render: (p) => fmtDate(p.payment_date),
          },
          { key: "age", header: "Age", render: (p) => `${daysBetween(p.payment_date)} days` },
          { key: "m", header: "Mode", render: (p) => MODES[p.mode] },
          { key: "reference", header: "Reference" },
          { key: "a", header: "Amount", align: "right", render: (p) => inr(p.amount) },
          {
            key: "b",
            header: "Unallocated",
            align: "right",
            sort: (p) => Number(p.amount) - Number(p.allocated_amount),
            render: (p) => <b>{inr(Number(p.amount) - Number(p.allocated_amount))}</b>,
          },
          { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
          {
            key: "x",
            header: "",
            render: (p) => (
              <Button asChild size="sm" variant="outline">
                <Link to="/clearing" search={{ payment: p.id }}>
                  Clear
                </Link>
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
