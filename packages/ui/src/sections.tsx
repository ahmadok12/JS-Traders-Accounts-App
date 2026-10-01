import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Badge, cn } from "./primitives";

/**
 * Progressive-disclosure section (spec §5.5.10).
 * - Collapsing hides the section but NEVER clears its draft values — the
 *   children stay mounted (hidden) so form state is preserved.
 * - `populated` auto-opens the section on first render for existing records
 *   and shows a "Has data" chip when collapsed, so data is never hidden.
 * - `mode="checkbox"` for business toggles (e.g. "Receive Payment Now"),
 *   `mode="disclosure"` for "More details" style reveal.
 */
export function ConditionalSection({
  label,
  description,
  populated = false,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  mode = "disclosure",
  children,
  className,
}: {
  label: string;
  description?: string;
  populated?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  mode?: "checkbox" | "disclosure";
  children: React.ReactNode;
  className?: string;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen || populated);
  const open = controlledOpen ?? uncontrolled;
  const set = (v: boolean) => {
    setUncontrolled(v);
    onOpenChange?.(v);
  };
  const regionId = React.useId();

  return (
    <div className={cn("rounded-card border border-line", open ? "bg-surface" : "bg-subtle/50", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => set(!open)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
      >
        {mode === "checkbox" ? (
          <span
            aria-hidden
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded border",
              open ? "border-primary bg-primary text-white" : "border-line-strong bg-surface",
            )}
          >
            {open && (
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2.5 6.5l2.5 2.5 4.5-5" />
              </svg>
            )}
          </span>
        ) : (
          <ChevronRight className={cn("h-4 w-4 text-ink-muted transition-transform", open && "rotate-90")} />
        )}
        <span className="flex-1">
          <span className="text-sm font-medium text-ink">{label}</span>
          {description && <span className="ml-2 text-xs text-ink-muted">{description}</span>}
        </span>
        {!open && populated && <Badge tone="info">Has data</Badge>}
      </button>
      <div id={regionId} hidden={!open} className="border-t border-line px-3 pb-1 pt-3">
        {children}
      </div>
    </div>
  );
}

/** Responsive multi-column form grid (compact, reflows on narrow screens). */
export function FormGrid({ cols = 3, children, className }: { cols?: 2 | 3 | 4; children: React.ReactNode; className?: string }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={cn("grid grid-cols-1 gap-x-3 gap-y-0.5", c, className)}>{children}</div>;
}
