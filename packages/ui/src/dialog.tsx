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
export type DialogSize = "sm" | "md" | "lg" | "xl";
const sizeClass: Record<DialogSize, string> = {
  sm: "sm:max-w-dialog-sm",
  md: "sm:max-w-dialog-md",
  lg: "sm:max-w-dialog-lg",
  xl: "sm:max-w-dialog-xl",
};

export function ErpDialog({
  open,
  onRequestClose,
  title,
  subtitle,
  icon,
  status,
  size = "md",
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
            "fixed z-50 flex flex-col bg-surface shadow-dialog focus:outline-none",
            "inset-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:max-h-[90vh] sm:w-[calc(100vw-48px)] sm:rounded-dialog sm:border sm:border-line",
            sizeClass[size],
          )}
        >
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            {icon && <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-subtle text-ink-2">{icon}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <RD.Title className="truncate text-lg font-semibold text-ink">{title}</RD.Title>
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
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line bg-subtle/60 px-5 py-3">{footer}</div>}
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
