import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { X, ChevronDown, Trash2, Calendar } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Shared layout constants so every full-screen record form lines up exactly. */
export const FORM_SCREEN_CLASS =
  "-m-5 flex min-h-[calc(100svh-4rem)] flex-col bg-background md:-m-8";
export const FORM_HEADER_CLASS =
  "sticky top-16 z-10 flex shrink-0 items-center justify-between gap-4 border-b bg-card px-6 py-4";
export const FORM_BODY_CLASS = "mx-auto w-full max-w-5xl space-y-8 px-6 py-6";
export const FORM_FOOTER_CLASS =
  "flex shrink-0 items-center justify-end gap-2 border-t bg-card px-6 py-3";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "success" | "warning" | "danger" | "info";
  hint?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning-foreground",
            tone === "danger" && "text-destructive",
            tone === "info" && "text-primary",
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function Field({
  label,
  children,
  className,
  hint,
  error,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs text-destructive font-medium">{error}</p>}
    </div>
  );
}

export function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.className,
      )}
    />
  );
}

export type ChipOption<T extends string> = { value: T; label: string; hint?: string };

/**
 * Horizontal (wrapping) single-select. Replaces dropdowns for short, known option
 * sets so every choice stays visible and is one click away.
 */
export function ChipSelect<T extends string>({
  value,
  onChange,
  options,
  allowEmpty,
  emptyLabel = "Any",
  className,
  ariaLabel,
  counts,
}: {
  value: T | "";
  onChange: (v: T | "") => void;
  options: readonly ChipOption<T>[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  ariaLabel?: string;
  /** When provided, each chip shows how many rows it would match; empty ones dim. */
  counts?: Record<string, number>;
}) {
  const chip = (active: boolean, count?: number) =>
    cn(
      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary text-primary-foreground shadow-xs"
        : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      !active && count === 0 && "opacity-40",
    );

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label={ariaLabel}>
      {allowEmpty && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={chip(value === "")}
          aria-pressed={value === ""}
        >
          {emptyLabel}
        </button>
      )}
      {options.map((o) => {
        const count = counts?.[o.value];
        return (
          <button
            key={o.value}
            type="button"
            title={
              count === undefined ? o.hint : `${o.label} — ${count} client${count === 1 ? "" : "s"}`
            }
            onClick={() => onChange(o.value === value ? "" : o.value)}
            className={chip(value === o.value, count)}
            aria-pressed={value === o.value}
          >
            {o.label}
            {count !== undefined && <span className="ml-1 opacity-70 tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One filter dimension in a horizontal filter bar: fixed label left, chips wrap right. */
export function ChipFilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="w-32 shrink-0 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Titled card used to group fields in the full-screen client/service forms. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Shell for the full-width record editors (client, service). Renders inside
 * <main>, bleeding past its padding with negative margins so the form fills the
 * content area while the sidebar stays visible.
 */
export function FormScreen({
  title,
  subtitle,
  onClose,
  closeDisabled,
  label,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  label?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className={cn(FORM_SCREEN_CLASS)} role="dialog" aria-label={label ?? title}>
      <div className={FORM_HEADER_CLASS}>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={FORM_BODY_CLASS}>{children}</div>
      </div>
      <div className={FORM_FOOTER_CLASS}>{footer}</div>
    </div>
  );
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  destructive?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Field label="Reason (required)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!reason.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NoAccess() {
  return (
    <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
      You don't have permission to view this page.
    </div>
  );
}

export function ChecklistFilter({
  label: filterLabel,
  options,
  selected,
  onChange,
  className,
  emptyLabel,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  className?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((v) => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const getEmptyText = () => {
    if (emptyLabel) return emptyLabel;
    const lower = filterLabel.toLowerCase();
    if (lower.endsWith("status")) return `All ${lower}es`;
    if (lower.endsWith("s")) return `All ${lower}`;
    return `All ${lower}s`;
  };

  const displayText =
    selected.length === 0
      ? getEmptyText()
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label || selected[0]
        : `${filterLabel} (${selected.length})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-9 justify-between font-normal text-xs", className)}
        >
          <span className="truncate">{displayText}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 px-1">
          <span className="text-xs font-semibold text-muted-foreground">{filterLabel}</span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-primary hover:underline font-medium"
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {options.map((opt) => {
            const isChecked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
              >
                <Checkbox checked={isChecked} onCheckedChange={() => toggle(opt.value)} />
                <span className="flex-1 truncate">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  label = "Date",
  className,
}: {
  from: string;
  to: string;
  onFromChange: (val: string) => void;
  onToChange: (val: string) => void;
  label?: string;
  className?: string;
}) {
  const hasValue = Boolean(from || to);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-input bg-background px-2 h-9 text-xs shadow-xs focus-within:ring-2 focus-within:ring-ring focus-within:border-primary",
        className,
      )}
    >
      <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {label && <span className="text-muted-foreground whitespace-nowrap">{label}:</span>}
      <input
        type="date"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        className="bg-transparent text-xs outline-none focus:outline-none w-[84px] sm:w-[88px] text-foreground cursor-pointer"
        title="From date"
      />
      <span className="text-muted-foreground text-[10px]">—</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        className="bg-transparent text-xs outline-none focus:outline-none w-[84px] sm:w-[88px] text-foreground cursor-pointer"
        title="To date"
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => {
            onFromChange("");
            onToChange("");
          }}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded-sm hover:bg-muted"
          title="Clear date range"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ClientSelect, type ClientOption, type ClientSelectProps } from "./ClientSelect";
