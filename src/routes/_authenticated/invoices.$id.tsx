import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Pencil, Printer, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, NoAccess, ReasonDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { useUserFirms } from "@/hooks/use-firm";
import { fetchFirmBillingDetails, updateInvoiceBillingDetails } from "@/lib/firms.functions";
import { errMsg, fmtDate, inr, invoiceDisplayStatus, MODES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Invoice — AJ's Chartered Desk" },
      { name: "description", content: "Invoice preview." },
    ],
  }),
  component: InvoiceView,
});

function words(n: number): string {
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]} ${a[x % 10]}`.trim());
  const three = (x: number) =>
    x >= 100 ? `${a[Math.floor(x / 100)]} Hundred ${two(x % 100)}`.trim() : two(x);
  n = Math.floor(n);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7);
  n %= 1e7;
  const lk = Math.floor(n / 1e5);
  n %= 1e5;
  const th = Math.floor(n / 1e3);
  n %= 1e3;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(" ");
}

function InvoiceView() {
  const { id } = Route.useParams();
  const { isFinance, loading } = useRoles();
  const { data: userFirms } = useUserFirms();
  const qc = useQueryClient();
  const [cancel, setCancel] = useState(false);
  const [selectedFirmId, setSelectedFirmId] = useState<string>("");
  const [editHeaderOpen, setEditHeaderOpen] = useState(false);
  const [editFirmId, setEditFirmId] = useState("");
  const [editCustomName, setEditCustomName] = useState("");
  const [editInvoiceNo, setEditInvoiceNo] = useState("");
  const [isSavingHeader, setIsSavingHeader] = useState(false);

  const q = useQuery({
    queryKey: ["invoice", id],
    enabled: isFinance,
    queryFn: async () => {
      const iRes = await supabase
        .from("invoices")
        .select("*, clients(*)")
        .eq("id", id)
        .maybeSingle();
      if (iRes.error) throw iRes.error;
      const invData = iRes.data;
      if (!invData)
        return { inv: null, items: [], allocs: [], discounts: [], settings: null, firm: null };

      const [items, al, disc, s, f] = await Promise.all([
        supabase.from("invoice_items").select("*, jobs(job_code)").eq("invoice_id", id),
        supabase
          .from("payment_allocations")
          .select("*, payments(payment_code, payment_date, mode, reference)")
          .eq("invoice_id", id)
          .order("created_at"),
        supabase.from("discounts").select("*").eq("invoice_id", id),
        invData.firm_id
          ? supabase.from("settings").select("*").eq("firm_id", invData.firm_id).maybeSingle()
          : supabase.from("settings").select("*").maybeSingle(),
        invData.firm_id
          ? supabase.from("firms").select("*").eq("id", invData.firm_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      return {
        inv: invData,
        items: items.data ?? [],
        allocs: al.data ?? [],
        discounts: disc.data ?? [],
        settings: s.data,
        firm: f.data,
      };
    },
  });

  const effectiveFirmId = selectedFirmId || q.data?.inv?.firm_id;

  const firmDetailsQuery = useQuery({
    queryKey: ["invoice-firm-details", effectiveFirmId],
    enabled: Boolean(effectiveFirmId),
    queryFn: async () => {
      if (!effectiveFirmId) return null;
      try {
        const res = await fetchFirmBillingDetails({ data: { firmId: effectiveFirmId } });
        return res;
      } catch (err) {
        console.warn("fetchFirmBillingDetails fallback:", err);
        const [sRes, fRes] = await Promise.all([
          supabase.from("settings").select("*").eq("firm_id", effectiveFirmId).maybeSingle(),
          supabase.from("firms").select("*").eq("id", effectiveFirmId).maybeSingle(),
        ]);
        return { settings: sRes.data, firm: fRes.data };
      }
    },
  });

  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  if (q.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  const d = q.data;
  if (!d?.inv)
    return (
      <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
        Invoice not found.
      </div>
    );
  const { inv } = d;
  const activeFirm = firmDetailsQuery.data?.firm ?? d.firm;
  const activeSettings = firmDetailsQuery.data?.settings ?? d.settings;
  const c = inv.clients!;

  const doCancel = async (reason: string) => {
    const { error } = await supabase.rpc("cancel_invoice", { _invoice_id: id, _reason: reason });
    if (error) {
      toast.error(errMsg(error));
      throw error;
    }
    toast.success("Invoice cancelled");
    qc.invalidateQueries();
  };

  const handleSaveHeader = async () => {
    setIsSavingHeader(true);
    try {
      await updateInvoiceBillingDetails({
        data: {
          invoiceId: id,
          firmId: editFirmId || undefined,
          invoiceNo: editInvoiceNo.trim() || undefined,
          customFirmName: editCustomName.trim() || undefined,
        },
      });
      if (editFirmId) {
        setSelectedFirmId(editFirmId);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["invoice", id] }),
        qc.invalidateQueries({ queryKey: ["invoice-firm-details", editFirmId || effectiveFirmId] }),
        qc.invalidateQueries({ queryKey: ["invoices"] }),
      ]);
      toast.success("Invoice billing details and pattern updated successfully");
      setEditHeaderOpen(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setIsSavingHeader(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to="/invoices" className="text-sm text-primary hover:underline">
            ← Invoices
          </Link>
          <StatusBadge status={invoiceDisplayStatus(inv)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {userFirms && userFirms.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs shadow-xs">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-muted-foreground">Print As:</span>
              <select
                aria-label="Select billing firm name to print on invoice"
                value={effectiveFirmId ?? ""}
                onChange={async (e) => {
                  const newFid = e.target.value;
                  setSelectedFirmId(newFid);
                  if (newFid) {
                    try {
                      await updateInvoiceBillingDetails({
                        data: { invoiceId: id, firmId: newFid },
                      });
                      await Promise.all([
                        qc.invalidateQueries({ queryKey: ["invoice", id] }),
                        qc.invalidateQueries({ queryKey: ["invoice-firm-details", newFid] }),
                      ]);
                      toast.success(
                        `Invoice billing entity set to "${userFirms.find((f) => f.id === newFid)?.name || "selected firm"}"`,
                      );
                    } catch (err) {
                      toast.error(errMsg(err));
                    }
                  }
                }}
                className="bg-transparent font-semibold text-foreground focus:outline-none cursor-pointer"
              >
                {userFirms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium cursor-pointer"
            onClick={() => {
              setEditFirmId(effectiveFirmId || "");
              setEditCustomName(
                inv.description || activeSettings?.firm_name || activeFirm?.name || "",
              );
              setEditInvoiceNo(inv.invoice_no || "");
              setEditHeaderOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit Bill Header &amp; No.
          </Button>

          {inv.status !== "cancelled" && (
            <Button variant="outline" className="text-destructive" onClick={() => setCancel(true)}>
              <XCircle className="mr-1 h-4 w-4" />
              Cancel Invoice
            </Button>
          )}
          <Button onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Print / PDF
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-8 text-sm print:border-0 print:p-0">
        <div className="flex justify-between border-b pb-4 gap-4">
          <div className="flex items-start gap-3">
            {activeFirm?.logo_url && (
              <img
                src={activeFirm.logo_url}
                alt=""
                className="h-12 w-12 object-contain rounded-md"
              />
            )}
            <div>
              <div className="text-lg font-bold">
                {inv.description || activeSettings?.firm_name || activeFirm?.name}
              </div>
              <div className="whitespace-pre-line text-muted-foreground">
                {activeSettings?.address}
              </div>
              {activeSettings?.gstin && <div>GSTIN: {activeSettings.gstin}</div>}
              {activeSettings?.pan && <div>PAN: {activeSettings.pan}</div>}
              {activeSettings?.phone && <div>Phone: {activeSettings.phone}</div>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-semibold tracking-wide">TAX INVOICE</div>
            <div className="mt-1">
              No: <span className="font-mono font-bold">{inv.invoice_no}</span>
            </div>
            <div>Date: {fmtDate(inv.invoice_date)}</div>
            <div>Due: {fmtDate(inv.due_date)}</div>
            {inv.status === "cancelled" && (
              <div className="mt-1 font-bold text-destructive">CANCELLED</div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b py-4">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Bill To</div>
            <div className="font-semibold">{c.name}</div>
            <div className="text-muted-foreground">{c.address}</div>
            {c.gstin && <div>GSTIN: {c.gstin}</div>}
            {c.pan && <div>PAN: {c.pan}</div>}
          </div>
          <div className="text-right text-muted-foreground">
            {c.email}
            <br />
            {c.mobile}
          </div>
        </div>
        <table className="my-4 w-full">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="py-2">#</th>
              <th>Description</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((it, idx) => (
              <tr key={it.id} className="border-b">
                <td className="py-2">{idx + 1}</td>
                <td>
                  {it.description}
                  {it.jobs?.job_code && (
                    <span className="ml-2 text-xs text-muted-foreground">({it.jobs.job_code})</span>
                  )}
                </td>
                <td className="text-right tabular-nums">{inr(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto w-72 space-y-1">
          <R k="Subtotal" v={inr(inv.subtotal)} />
          {Number(inv.discount) > 0 && <R k="Less: Discount" v={`− ${inr(inv.discount)}`} />}
          {Number(inv.tax_rate) > 0 && (
            <>
              <R k={`CGST @ ${Number(inv.tax_rate) / 2}%`} v={inr(Number(inv.tax_amount) / 2)} />
              <R k={`SGST @ ${Number(inv.tax_rate) / 2}%`} v={inr(Number(inv.tax_amount) / 2)} />
            </>
          )}
          <div className="flex justify-between border-t pt-1 text-base font-bold">
            <span>Total</span>
            <span>{inr(inv.total)}</span>
          </div>
          <R k="Amount Paid" v={inr(inv.amount_paid)} />
          <div className="flex justify-between font-semibold">
            <span>Balance Due</span>
            <span>{inr(inv.outstanding)}</span>
          </div>
        </div>
        <div className="mt-4 text-xs">
          <span className="text-muted-foreground">Amount in words:</span> Rupees{" "}
          {words(Number(inv.total))} Only
        </div>
        {inv.notes && <div className="mt-2 text-xs text-muted-foreground">Notes: {inv.notes}</div>}
        {activeSettings?.bank_details && (
          <div className="mt-2 whitespace-pre-line text-xs">
            Bank: {activeSettings.bank_details}
          </div>
        )}
        <div className="mt-6 flex justify-between text-xs text-muted-foreground">
          <span />
          <span>
            For {activeSettings?.firm_name || activeFirm?.name}
            <br />
            <br />
            Authorised Signatory
          </span>
        </div>
      </div>

      <div className="no-print mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">Payments applied</h3>
          {d.allocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments applied yet.</p>
          ) : (
            d.allocs.map((a) => (
              <div
                key={a.id}
                className="flex justify-between border-b py-1.5 text-sm last:border-0"
              >
                <span className={a.reversed ? "line-through text-muted-foreground" : ""}>
                  {a.payments?.payment_code} · {fmtDate(a.payments?.payment_date)} ·{" "}
                  {MODES[a.payments?.mode ?? "other"]}
                </span>
                <span className="tabular-nums">
                  {inr(a.amount)}
                  {a.reversed && <span className="ml-1 text-xs text-destructive">reversed</span>}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">Discount record</h3>
          {d.discounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No discount applied.</p>
          ) : (
            d.discounts.map((x) => (
              <div key={x.id} className="text-sm">
                Original {inr(x.original_amount)} − Discount {inr(x.discount_amount)} = Net{" "}
                {inr(x.net_amount)}
                <div className="text-xs text-muted-foreground">
                  {x.reason} · {fmtDate(x.created_at)}
                </div>
              </div>
            ))
          )}
          {inv.cancel_reason && (
            <div className="mt-2 text-sm text-destructive">Cancelled: {inv.cancel_reason}</div>
          )}
        </div>
      </div>
      <ReasonDialog
        open={cancel}
        onOpenChange={setCancel}
        title="Cancel invoice?"
        description="The invoice stays on record as Cancelled and its jobs become billable again."
        confirmLabel="Cancel Invoice"
        destructive
        onConfirm={doCancel}
      />

      {/* Dialog for customizing billing firm name & invoice numbering pattern */}
      <Dialog open={editHeaderOpen} onOpenChange={setEditHeaderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              Edit Billing Firm &amp; Invoice Pattern
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {userFirms && userFirms.length > 0 && (
              <Field label="Billing Practice Entity">
                <select
                  value={editFirmId}
                  onChange={(e) => setEditFirmId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {userFirms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Firm / Company Name on Bill">
              <Input
                value={editCustomName}
                onChange={(e) => setEditCustomName(e.target.value)}
                placeholder="e.g. Sharma & Associates CA"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Overrides the printable firm heading on this bill.
              </p>
            </Field>

            <Field label="Invoice Number / Pattern">
              <Input
                value={editInvoiceNo}
                onChange={(e) => setEditInvoiceNo(e.target.value)}
                className="font-mono"
                placeholder="e.g. INV/2026/001"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Customize the invoice identifier (e.g. INV0001-1026, CA/26-27/001).
              </p>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditHeaderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveHeader} disabled={isSavingHeader}>
              {isSavingHeader ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
const R = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{k}</span>
    <span className="tabular-nums">{v}</span>
  </div>
);
