import * as React from "react";
import * as RD from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { Button, cn } from "./primitives";

/**
 * ERP dialog shell (spec §5.5.1A "Dialog/modal treatment", §5.5.7).
 * Dimmed backdrop → centred white dialog → compact header (icon + title + status)
 * → independently scrolling body → sticky footer. On small screens it becomes a
 * full-screen sheet. Close requests go through `onRequestClose` so callers can
 * intercept them when there are unsaved changes.
 */
export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";
const sizeClass: Record<DialogSize, string> = {
  sm: "sm:max-w-dialog-sm",
  md: "sm:max-w-dialog-md",
  lg: "sm:max-w-dialog-lg",
  xl: "sm:max-w-dialog-xl",
  full: "",
};
const centred = "sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-h-[90vh] sm:w-[calc(100vw-48px)]";
/** full: a document workspace that uses the whole screen (long orders, invoices, GDNs) */
const fullScreen = "sm:inset-3 lg:inset-4";

/** Document colour accents — each document type gets its own header tint so it is recognisable at a glance. */
export type DialogAccent = "neutral" | "order" | "quote" | "dispatch" | "invoice" | "picking" | "pricing" | "purchase" | "bill" | "return";
const accentClass: Record<DialogAccent, { bar: string; head: string; icon: string }> = {
  neutral: { bar: "", head: "", icon: "border border-line bg-subtle text-ink-2" },
  order: { bar: "before:bg-indigo-500", head: "bg-gradient-to-r from-indigo-50 via-white to-white", icon: "bg-indigo-600 text-white shadow-sm" },
  quote: { bar: "before:bg-violet-500", head: "bg-gradient-to-r from-violet-50 via-white to-white", icon: "bg-violet-600 text-white shadow-sm" },
  dispatch: { bar: "before:bg-amber-500", head: "bg-gradient-to-r from-amber-50 via-white to-white", icon: "bg-amber-500 text-white shadow-sm" },
  invoice: { bar: "before:bg-emerald-500", head: "bg-gradient-to-r from-emerald-50 via-white to-white", icon: "bg-emerald-600 text-white shadow-sm" },
  purchase: { bar: "before:bg-teal-500", head: "bg-gradient-to-r from-teal-50 via-white to-white", icon: "bg-teal-600 text-white shadow-sm" },
  bill: { bar: "before:bg-orange-500", head: "bg-gradient-to-r from-orange-50 via-white to-white", icon: "bg-orange-600 text-white shadow-sm" },
  pricing: { bar: "before:bg-rose-500", head: "bg-gradient-to-r from-rose-50 via-white to-white", icon: "bg-rose-600 text-white shadow-sm" },
  return: { bar: "before:bg-red-500", head: "bg-gradient-to-r from-red-50 via-white to-white", icon: "bg-red-600 text-white shadow-sm" },
  picking: { bar: "before:bg-sky-500", head: "bg-gradient-to-r from-sky-50 via-white to-white", icon: "bg-sky-600 text-white shadow-sm" },
};

export function ErpDialog({
  open,
  onRequestClose,
  title,
  subtitle,
  icon,
  status,
  size = "md",
  accent = "neutral",
  headerActions,
  footer,
  children,
}: {
  open: boolean;
  onRequestClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  status?: React.ReactNode;
  size?: DialogSize;
  accent?: DialogAccent;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RD.Root open={open} onOpenChange={(o) => !o && onRequestClose()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-[rgba(17,24,39,0.35)] backdrop-blur-[1px] data-[state=open]:animate-in" />
        <RD.Content
          // Escape / outside click are routed to onRequestClose (which may prompt)
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onRequestClose();
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            onRequestClose();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-surface shadow-dialog focus:outline-none",
            "inset-0 sm:rounded-dialog sm:border sm:border-line",
            size === "full" ? fullScreen : cn("sm:inset-auto", centred),
            sizeClass[size],
          )}
        >
          <div className={cn("relative flex items-center gap-3 border-b border-line px-5", size === "full" ? "py-3.5" : "py-3",
            accent !== "neutral" && "before:absolute before:inset-y-0 before:left-0 before:w-1", accentClass[accent].bar, accentClass[accent].head)}>
            {icon && <div className={cn("flex shrink-0 items-center justify-center rounded-control", size === "full" ? "h-9 w-9" : "h-8 w-8", accentClass[accent].icon)}>{icon}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <RD.Title className={cn("truncate font-semibold tracking-tight text-ink", size === "full" ? "text-xl" : "text-lg")}>{title}</RD.Title>
                {status}
              </div>
              {subtitle ? (
                <RD.Description className="truncate text-xs text-ink-muted">{subtitle}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RD.Description>
              )}
            </div>
            {headerActions}
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onRequestClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", size === "full" ? "px-4 py-4 sm:px-6" : "px-5 py-4")}>{children}</div>
          {footer && <div className={cn("flex flex-wrap items-center gap-2 border-t border-line px-5 py-3", size === "full" ? "bg-white shadow-[0_-4px_12px_rgba(16,24,40,0.05)]" : "bg-subtle/60")}>{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Generic confirmation. Destructive tone uses red styling and separated buttons. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  return (
    <RD.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-[60] bg-[rgba(17,24,39,0.40)]" />
        <RD.Content className="fixed left-1/2 top-1/2 z-[61] w-[calc(100vw-32px)] max-w-dialog-sm -translate-x-1/2 -translate-y-1/2 rounded-dialog border border-line bg-surface p-5 shadow-dialog focus:outline-none">
          <div className="flex gap-3">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                tone === "destructive" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
              )}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <RD.Title className="text-base font-semibold text-ink">{title}</RD.Title>
              <RD.Description asChild>
                <div className="mt-1 text-sm text-ink-muted">{message}</div>
              </RD.Description>
              {children}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} autoFocus>
              {cancelLabel}
            </Button>
            <Button variant={tone === "destructive" ? "destructive" : "primary"} loading={loading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Standard unsaved-changes prompt (spec §5.5.6 wording). */
export function UnsavedChangesDialog({ open, onKeepEditing, onDiscard }: { open: boolean; onKeepEditing: () => void; onDiscard: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="Unsaved changes"
      message="You have unsaved changes. Leave without saving?"
      cancelLabel="Keep Editing"
      confirmLabel="Discard Changes"
      tone="destructive"
      onCancel={onKeepEditing}
      onConfirm={onDiscard}
    />
  );
}
