import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown, ChevronLeft, ChevronRight, Download, Inbox, Search, CheckSquare, Square, MinusSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  align?: "right" | "left";
  className?: string;
};

export interface DataTableProps<T extends { id: string | number }> {
  rows: T[] | undefined;
  columns: Column<T>[];
  search?: (row: T) => string;
  loading?: boolean;
  empty?: string;
  toolbar?: ReactNode;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
  exportFilename?: string;
  exportTransform?: (row: T) => Record<string, unknown>;
  selectable?: boolean;
  selectedIds?: (string | number)[];
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => ReactNode;
}

export function DataTable<T extends { id: string | number }>({
  rows,
  columns,
  search,
  loading,
  empty = "No records found",
  toolbar,
  pageSize = 15,
  onRowClick,
  footer,
  exportFilename,
  exportTransform,
  selectable,
  selectedIds: controlledSelectedIds,
  onSelectionChange,
  bulkActions,
}: DataTableProps<T>) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const [internalSelectedIds, setInternalSelectedIds] = useState<(string | number)[]>([]);

  const isControlled = controlledSelectedIds !== undefined;
  const selectedIds = isControlled ? controlledSelectedIds : internalSelectedIds;

  const setSelectedIds = (ids: (string | number)[]) => {
    if (!isControlled) {
      setInternalSelectedIds(ids);
    }
    onSelectionChange?.(ids);
  };

  const filtered = useMemo(() => {
    let r = rows ?? [];
    if (q && search) {
      const s = q.toLowerCase();
      r = r.filter((x) => search(x).toLowerCase().includes(s));
    }
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sort) {
      const f = col.sort;
      r = [...r].sort((a, b) => (f(a) > f(b) ? dir : f(a) < f(b) ? -dir : 0));
    }
    return r;
  }, [rows, q, search, sortKey, dir, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * pageSize, cur * pageSize + pageSize);

  const selectedRows = useMemo(() => {
    const idSet = new Set(selectedIds);
    return (rows ?? []).filter((r) => idSet.has(r.id));
  }, [rows, selectedIds]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));
  const someFilteredSelected =
    filtered.some((r) => selectedIds.includes(r.id)) && !allFilteredSelected;

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((r) => r.id));
    }
  };

  const toggleSelectRow = (id: string | number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const clearSelection = () => setSelectedIds([]);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Bulk Action Bar when rows are selected */}
      {selectable && selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-primary/10 px-3.5 py-2.5 transition-colors">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              {selectedIds.length}
            </span>
            <span className="text-xs font-semibold text-foreground">
              {selectedIds.length} item{selectedIds.length === 1 ? "" : "s"} selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {bulkActions ? (
              bulkActions(selectedRows, clearSelection)
            ) : (
              exportFilename && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 font-medium bg-background"
                  onClick={() => {
                    const dataToExport = exportTransform
                      ? selectedRows.map(exportTransform)
                      : selectedRows.map((r) => {
                          const out: Record<string, unknown> = {};
                          for (const col of columns) {
                            if (!col.header || col.key === "x" || col.key === "actions") continue;
                            const val = (r as Record<string, unknown>)[col.key];
                            out[col.header] = val ?? "";
                          }
                          return out;
                        });
                    const stamp = new Date().toISOString().slice(0, 10);
                    downloadCsv(`${exportFilename}_selected_${stamp}.csv`, dataToExport);
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Selected ({selectedIds.length})
                </Button>
              )
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={clearSelection}
            >
              Deselect All
            </Button>
          </div>
        </div>
      ) : (
        (search || toolbar || exportFilename) && (
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            {search && (
              <div className="relative w-full sm:w-48 lg:w-56 shrink-0">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search…"
                  className="pl-8 h-9"
                />
              </div>
            )}
            {toolbar}
            {exportFilename && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 ml-auto text-xs gap-1.5 font-medium shrink-0"
                onClick={() => {
                  const dataToExport = exportTransform
                    ? filtered.map(exportTransform)
                    : filtered.map((r) => {
                        const out: Record<string, unknown> = {};
                        for (const col of columns) {
                          if (!col.header || col.key === "x" || col.key === "actions") continue;
                          const val = (r as Record<string, unknown>)[col.key];
                          out[col.header] = val ?? "";
                        }
                        return out;
                      });
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCsv(`${exportFilename}_${stamp}.csv`, dataToExport);
                }}
                disabled={!filtered.length}
                title="Export current filtered data to CSV"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            )}
          </div>
        )
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {selectable && (
                <th className="w-9 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none"
                    title={allFilteredSelected ? "Deselect all" : "Select all"}
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : someFilteredSelected ? (
                      <MinusSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 opacity-50" />
                    )}
                  </button>
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 py-2.5 font-medium whitespace-nowrap",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => {
                        if (sortKey === c.key) setDir((d) => (d === 1 ? -1 : 1));
                        else {
                          setSortKey(c.key);
                          setDir(1);
                        }
                      }}
                    >
                      {c.header}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t">
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-2">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : slice.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  {empty}
                </td>
              </tr>
            ) : (
              slice.map((r) => {
                const isSelected = selectedIds.includes(r.id);
                return (
                  <tr
                    key={r.id}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn(
                      "border-t transition-colors hover:bg-muted/40",
                      isSelected && "bg-primary/5 hover:bg-primary/10",
                      onRowClick && "cursor-pointer",
                    )}
                  >
                    {selectable && (
                      <td className="w-9 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => toggleSelectRow(r.id, e)}
                          className="flex items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-primary" />
                          ) : (
                            <Square className="h-4 w-4 opacity-50 hover:opacity-100" />
                          )}
                        </button>
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-3 py-2.5",
                          c.align === "right" && "text-right tabular-nums",
                          c.className,
                        )}
                      >
                        {c.render
                          ? c.render(r)
                          : String((r as Record<string, unknown>)[c.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer}
        </table>
      </div>
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          {filtered.length} record{filtered.length === 1 ? "" : "s"}
          {selectedIds.length > 0 && ` (${selectedIds.length} selected)`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={cur === 0}
            onClick={() => setPage(cur - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            Page {cur + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={cur >= pages - 1}
            onClick={() => setPage(cur + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
