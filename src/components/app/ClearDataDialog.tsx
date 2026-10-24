import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Trash2,
  CheckCircle2,
  ShieldAlert,
  Copy,
  Check,
  FileSpreadsheet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errMsg } from "@/lib/format";
import { CompleteBackupButton } from "./CompleteBackupButton";

const CONFIRM_PHRASE = "RESET ALL DATA";

interface ClearDataDialogProps {
  firmId?: string;
  firmName?: string;
  className?: string;
}

export function ClearDataDialog({ firmId, firmName, className }: ClearDataDialogProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const isConfirmed = confirmInput.trim().toUpperCase() === CONFIRM_PHRASE;

  const handleClear = async () => {
    if (!isConfirmed) return;
    setLoading(true);

    try {
      const { data, error } = await (supabase.rpc as any)("clear_firm_test_data", {
        p_firm_id: firmId ?? null,
      });

      if (error) {
        // If function doesn't exist yet on the database
        if (error.code === "42883" || error.message?.includes("clear_firm_test_data")) {
          throw new Error(
            "The clear_firm_test_data SQL migration has not been applied to your database yet. Run supabase/clear_all_test_data.sql in your Supabase SQL Editor.",
          );
        }
        throw error;
      }

      const res = data as { message?: string } | null;
      toast.success(
        res?.message || "All practice test data has been successfully cleared.",
      );

      // Invalidate all active queries to reflect pristine state
      qc.invalidateQueries();
      setOpen(false);
      setConfirmInput("");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const copySqlScript = async () => {
    try {
      await navigator.clipboard.writeText(
        `-- Run in Supabase SQL Editor to wipe test transactions:\nselect public.clear_firm_test_data(${firmId ? `'${firmId}'` : 'null'});`,
      );
      setCopied(true);
      toast.success("SQL command copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setConfirmInput("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" className={className}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          Reset Practice Data
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base text-destructive">
                Reset / Clear All Practice Data
              </DialogTitle>
              <DialogDescription className="text-xs">
                {firmName ? `For practice: ${firmName}` : "For your active firm"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-destructive">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>Permanent & Irreversible Deletion</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed opacity-90">
              This action will permanently wipe all practice records from this database. This
              cannot be undone.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/40 p-2.5">
              <span className="font-semibold text-destructive block mb-1">Will Be Deleted:</span>
              <ul className="space-y-1 text-[11px] text-muted-foreground list-disc list-inside">
                <li>All Clients & Contacts</li>
                <li>Compliance Jobs & Tasks</li>
                <li>Invoices & Line items</li>
                <li>Payments, Receipts & Clearing</li>
                <li>Expenses & Deductions</li>
                <li>Document Number Counters</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-muted/40 p-2.5">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 block mb-1">
                Will Be Preserved:
              </span>
              <ul className="space-y-1 text-[11px] text-muted-foreground list-disc list-inside">
                <li>Firm Profile & Settings</li>
                <li>User Accounts & Logins</li>
                <li>Roles & Permissions</li>
                <li>Master Services Catalogue</li>
                <li>Super Admin access</li>
              </ul>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[11px] text-muted-foreground">
                Download an offline backup first:
              </span>
            </div>
            <CompleteBackupButton
              variant="outline"
              size="sm"
              label="Backup Now"
              className="h-7 text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
            />
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-medium text-foreground">
              To proceed, type <span className="font-mono font-bold text-destructive">{CONFIRM_PHRASE}</span> below:
            </label>
            <Input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={`Type "${CONFIRM_PHRASE}" to confirm`}
              className="font-mono text-xs"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={copySqlScript}
            className="text-xs text-muted-foreground gap-1.5 order-2 sm:order-1"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            Copy SQL Script
          </Button>

          <div className="flex items-center gap-2 order-1 sm:order-2 ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleClear}
              disabled={!isConfirmed || loading}
              className="text-xs font-semibold gap-1.5"
            >
              {loading ? (
                "Clearing Data…"
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Wipe Practice Data
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
