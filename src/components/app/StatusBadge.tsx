import { cn } from "@/lib/utils";
import { label } from "@/lib/format";

const tone: Record<string, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning-foreground border-warning/40",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/30",
  muted: "bg-muted text-muted-foreground border-border",
};

const map: Record<string, keyof typeof tone> = {
  active: "success",
  completed: "success",
  paid: "success",
  allocated: "success",
  reconciled: "success",
  closed: "success",
  pending: "warning",
  partially_paid: "warning",
  partially_allocated: "warning",
  unallocated: "warning",
  on_hold: "warning",
  paused: "warning",
  unmatched: "warning",
  invoiced: "info",
  in_progress: "info",
  unpaid: "info",
  unbilled: "warning",
  unreimbursed: "warning",
  open: "muted",
  draft: "muted",
  overdue: "danger",
  cancelled: "danger",
  reversed: "danger",
  suspended: "danger",
  stopped: "danger",
  inactive: "muted",
  ignored: "muted",
  // Import review states
  new: "success",
  duplicate: "warning",
  invalid: "danger",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone[map[status] ?? "muted"],
        className,
      )}
    >
      {label(status)}
    </span>
  );
}
