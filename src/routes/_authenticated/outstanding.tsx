import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { DataTable } from "@/components/app/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ClientSelect,
  NativeSelect,
  NoAccess,
  PageHeader,
  StatCard,
  DateRangePicker,
} from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { useReceivables } from "@/hooks/use-receivables";
import {
  ageingBucket,
  BUCKETS,
  daysBetween,
  downloadCsv,
  fmtDate,
  inr,
  invoiceDisplayStatus,
  label,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/outstanding")({
  head: () => ({
    meta: [
      { title: "Outstanding — CA PracticeDesk" },
      { name: "description", content: "Receivables outstanding." },
    ],
  }),
  component: OutstandingPage,
});

function OutstandingPage() {
  const { isFinance, loading } = useRoles();
  const { data: profiles } = useProfiles();
  const q = useReceivables(isFinance);
  const [fl, setFl] = useState({
    client: "",
    service: "",
    staff: "",
    bucket: "",
    status: "",
    from: "",
    to: "",
  });
  const [view, setView] = useState<"invoice" | "client">("invoice");
  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  const all = (q.data ?? []).filter((i) => Number(i.outstanding) > 0);
  const svcOf = (i: (typeof all)[number]) =>
    i.invoice_items
      .map((x) => x.jobs?.services?.name)
      .filter(Boolean)
      .join(", ");
  const rows = all.filter(
    (i) =>
      (!fl.client || i.client_id === fl.client) &&
      (!fl.service || i.invoice_items.some((x) => x.jobs?.service_id === fl.service)) &&
      (!fl.staff || i.clients?.assigned_staff === fl.staff) &&
      (!fl.bucket || ageingBucket(i.due_date) === fl.bucket) &&
      (!fl.status || invoiceDisplayStatus(i) === fl.status) &&
      (!fl.from || i.invoice_date >= fl.from) &&
      (!fl.to || i.invoice_date <= fl.to),
  );
  const clients = [...new Map(all.map((i) => [i.client_id, i.clients?.name])).entries()];
  const services = [
    ...new Map(
      all
        .flatMap((i) =>
          i.invoice_items.map((x) => [x.jobs?.service_id, x.jobs?.services?.name] as const),
        )
        .filter(([k]) => k),
    ).entries(),
  ];
  const s = (k: keyof typeof fl) => (e: { target: { value: string } }) =>
    setFl((p) => ({ ...p, [k]: e.target.value }));
  const sum = (k: "total" | "amount_paid" | "outstanding") =>
    rows.reduce((a, i) => a + Number(i[k]), 0);

  const byClient = Object.values(
    rows.reduce<
      Record<
        string,
        {
          id: string;
          name: string;
          total: number;
          paid: number;
          out: number;
          br: Record<string, number>;
        }
      >
    >((acc, i) => {
      const c = (acc[i.client_id] ??= {
        id: i.client_id,
        name: i.clients?.name ?? "",
        total: 0,
        paid: 0,
        out: 0,
        br: {},
      });
      c.total += Number(i.total);
      c.paid += Number(i.amount_paid);
      c.out += Number(i.outstanding);
      const ratio = Number(i.outstanding) / Number(i.total || 1);
      i.invoice_items.forEach((it) => {
        const n = it.jobs?.services?.name ?? "Other";
        c.br[n] = (c.br[n] ?? 0) + Number(it.amount) * ratio;
      });
      return acc;
    }, {}),
  );

  return (
    <div>
      <PageHeader
        title="Outstanding"
        subtitle="Unsettled invoices (cancelled invoices excluded)"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 font-medium"
              disabled={!rows.length}
              onClick={() => {
                const stamp = new Date().toISOString().slice(0, 10);
                if (view === "client") {
                  downloadCsv(
                    `outstanding_by_client_${stamp}.csv`,
                    byClient.map((c) => ({
                      Client: c.name,
                      Receivable: c.total,
                      Paid: c.paid,
                      Outstanding: c.out,
                    })),
                  );
                } else {
                  downloadCsv(
                    `outstanding_invoices_${stamp}.csv`,
                    rows.map((i) => ({
                      "Invoice No": i.invoice_no,
                      Client: i.clients?.name ?? "",
                      Service: svcOf(i) || i.description,
                      "Invoice Date": fmtDate(i.invoice_date),
                      "Due Date": fmtDate(i.due_date),
                      Ageing: ageingBucket(i.due_date),
                      "Original Amount": i.total,
                      "Paid Amount": i.amount_paid,
                      Outstanding: i.outstanding,
                      Status: label(invoiceDisplayStatus(i)),
                    })),
                  );
                }
              }}
              title="Export filtered outstanding data to CSV"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <NativeSelect
              value={view}
              onChange={(e) => setView(e.target.value as "invoice" | "client")}
              className="w-44"
            >
              <option value="invoice">Invoice-wise</option>
              <option value="client">Client-wise</option>
            </NativeSelect>
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Invoices" value={rows.length} />
        <StatCard label="Original Amount" value={inr(sum("total"))} />
        <StatCard label="Paid" value={inr(sum("amount_paid"))} tone="success" />
        <StatCard label="Outstanding" value={inr(sum("outstanding"))} tone="danger" />
      </div>
      {view === "invoice" ? (
        <DataTable
          rows={rows}
          loading={q.isLoading}
          empty="Nothing outstanding."
          search={(i) => `${i.invoice_no} ${i.clients?.name}`}
          exportFilename="outstanding_invoices"
          exportTransform={(i) => ({
            "Invoice No": i.invoice_no,
            Client: i.clients?.name ?? "",
            Service: svcOf(i) || i.description,
            "Invoice Date": fmtDate(i.invoice_date),
            "Due Date": fmtDate(i.due_date),
            Ageing: ageingBucket(i.due_date),
            "Original Amount": i.total,
            "Paid Amount": i.amount_paid,
            Outstanding: i.outstanding,
            Status: label(invoiceDisplayStatus(i)),
          })}
          toolbar={
            <>
              <ClientSelect
                value={fl.client}
                onChange={(id) => setFl((p) => ({ ...p, client: id }))}
                placeholder="All clients"
                className="w-44"
                allowClear
              />
              <NativeSelect value={fl.service} onChange={s("service")} className="w-40">
                <option value="">All services</option>
                {services.map(([id, n]) => (
                  <option key={id} value={id!}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={fl.staff} onChange={s("staff")} className="w-36">
                <option value="">All staff</option>
                {profiles?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={fl.bucket} onChange={s("bucket")} className="w-36">
                <option value="">All ageing</option>
                {BUCKETS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </NativeSelect>
              <NativeSelect value={fl.status} onChange={s("status")} className="w-36">
                <option value="">All statuses</option>
                {["unpaid", "partially_paid", "overdue"].map((x) => (
                  <option key={x} value={x}>
                    {label(x)}
                  </option>
                ))}
              </NativeSelect>
              <DateRangePicker
                from={fl.from}
                to={fl.to}
                onFromChange={(val) => setFl((p) => ({ ...p, from: val }))}
                onToChange={(val) => setFl((p) => ({ ...p, to: val }))}
                label="Date"
              />
            </>
          }
          columns={[
            {
              key: "c",
              header: "Client",
              sort: (i) => i.clients?.name ?? "",
              render: (i) => (
                <Link
                  to="/clients/$id"
                  params={{ id: i.client_id }}
                  className="font-medium hover:underline"
                >
                  {i.clients?.name}
                </Link>
              ),
            },
            {
              key: "n",
              header: "Invoice",
              render: (i) => (
                <Link
                  to="/invoices/$id"
                  params={{ id: i.id }}
                  className="font-mono text-xs text-primary"
                >
                  {i.invoice_no}
                </Link>
              ),
            },
            {
              key: "j",
              header: "Job / Service",
              render: (i) => <span className="text-xs">{svcOf(i) || i.description}</span>,
            },
            { key: "d", header: "Inv. Date", render: (i) => fmtDate(i.invoice_date) },
            {
              key: "dd",
              header: "Due",
              sort: (i) => i.due_date,
              render: (i) => fmtDate(i.due_date),
            },
            { key: "t", header: "Original", align: "right", render: (i) => inr(i.total) },
            { key: "p", header: "Paid", align: "right", render: (i) => inr(i.amount_paid) },
            {
              key: "o",
              header: "Outstanding",
              align: "right",
              sort: (i) => Number(i.outstanding),
              render: (i) => <b>{inr(i.outstanding)}</b>,
            },
            {
              key: "od",
              header: "Days Overdue",
              align: "right",
              sort: (i) => daysBetween(i.due_date),
              render: (i) => Math.max(0, daysBetween(i.due_date)),
            },
            { key: "b", header: "Ageing", render: (i) => ageingBucket(i.due_date) },
            {
              key: "s",
              header: "Status",
              render: (i) => <StatusBadge status={invoiceDisplayStatus(i)} />,
            },
          ]}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {byClient.length === 0 && (
            <div className="col-span-full rounded-lg border bg-card p-12 text-center text-muted-foreground">
              Nothing outstanding.
            </div>
          )}
          {byClient.map((c) => (
            <div key={c.id} className="rounded-lg border bg-card p-4">
              <Link
                to="/clients/$id"
                params={{ id: c.id }}
                className="font-semibold hover:underline"
              >
                {c.name}
              </Link>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Receivable</div>
                  {inr(c.total)}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Paid</div>
                  <span className="text-success">{inr(c.paid)}</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Outstanding</div>
                  <b className="text-destructive">{inr(c.out)}</b>
                </div>
              </div>
              <div className="mt-3 border-t pt-2 text-sm">
                {Object.entries(c.br).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="tabular-nums">{inr(Math.round(v))}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
