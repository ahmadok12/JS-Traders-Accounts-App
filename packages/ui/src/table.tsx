import * as React from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { Button, Skeleton, cn } from "./primitives";

/**
 * Compact, information-dense data table (spec §5.5.1A tables, §5.5.5 View-first).
 * - Sticky header, low-contrast separators, numeric right alignment.
 * - View is the primary row action; there is no inline Edit/Delete.
 * - Server-side pagination only — the table never receives an unbounded set.
 */
export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
}

const hideClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  onView,
  empty,
  rowActions,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  onView?: (row: T) => void;
  empty?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  page?: number;
  pageSize?: number;
  total?: number | null;
  onPageChange?: (page: number) => void;
}) {
  const hasActions = !!onView || !!rowActions;
  const pages = total != null && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width }}
                  className={cn(
                    "h-9 whitespace-nowrap border-b border-line bg-subtle px-3 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.hideBelow && hideClass[c.hideBelow],
                  )}
                >
                  {c.header}
                </th>
              ))}
              {hasActions && <th className="h-9 w-[1%] border-b border-line bg-subtle px-3" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn("h-row border-b border-line/70 px-3", c.hideBelow && hideClass[c.hideBelow])}>
                      <Skeleton className="h-3 w-3/4" />
                    </td>
                  ))}
                  {hasActions && <td className="border-b border-line/70" />}
                </tr>
              ))}
            {!loading &&
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="group cursor-default hover:bg-subtle"
                  onDoubleClick={() => onView?.(r)}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "h-row border-b border-line/70 px-3 text-ink",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center",
                        c.hideBelow && hideClass[c.hideBelow],
                        c.className,
                      )}
                    >
                      {c.cell(r)}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="h-row whitespace-nowrap border-b border-line/70 px-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onView && (
                          <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => onView(r)} aria-label="View">
                            <span className="hidden sm:inline">View</span>
                          </Button>
                        )}
                        {rowActions?.(r)}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (empty ?? <div className="py-10 text-center text-sm text-ink-muted">No records</div>)}
      </div>
      {onPageChange && page != null && (
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-ink-muted">
          <span className="tabular-nums">
            {total != null && total > 0
              ? `${(page - 1) * (pageSize ?? 0) + 1}–${Math.min(page * (pageSize ?? 0), total)} of ${total.toLocaleString()}`
              : total === 0
                ? "0 records"
                : ""}
          </span>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button size="icon-sm" variant="ghost" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
