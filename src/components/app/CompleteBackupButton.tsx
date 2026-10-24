import { useState } from "react";
import { Download, Loader2, ShieldCheck, Database } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useRoles } from "@/hooks/use-roles";
import { useCurrentFirm } from "@/hooks/use-firm";
import { downloadCompleteFirmBackup } from "@/lib/complete-backup";
import { errMsg } from "@/lib/format";

interface CompleteBackupButtonProps extends ButtonProps {
  label?: string;
  showIcon?: boolean;
}

/**
 * Complete Firm Backup button.
 * STRICTLY RESTRICTED TO ADMIN (Manager role).
 * Returns null for staff and cashier.
 */
export function CompleteBackupButton({
  label = "Complete Backup",
  showIcon = true,
  className,
  variant = "default",
  size = "default",
  ...props
}: CompleteBackupButtonProps) {
  const { isManager, loading: rolesLoading } = useRoles();
  const { data: currentFirm } = useCurrentFirm();
  const [busy, setBusy] = useState(false);

  // Gated strictly for Admin only
  if (rolesLoading || !isManager) {
    return null;
  }

  const handleDownload = async () => {
    setBusy(true);
    const toastId = toast.loading("Generating complete practice backup…");
    try {
      const result = await downloadCompleteFirmBackup({
        firmName: currentFirm?.name,
      });
      toast.success(
        `Complete backup downloaded! (${result.recordsCount} records across ${result.sheetsCount} sheets)`,
        { id: toastId, duration: 5000 },
      );
    } catch (err) {
      console.error("Backup failed:", err);
      toast.error(`Backup failed: ${errMsg(err)}`, { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy}
      onClick={handleDownload}
      title="Download complete practice backup (Admin Only)"
      className={className}
      {...props}
    >
      {busy ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin text-current" />
      ) : showIcon ? (
        <Database className="mr-1.5 h-4 w-4 text-current" />
      ) : null}
      <span>{busy ? "Backing up…" : label}</span>
    </Button>
  );
}
