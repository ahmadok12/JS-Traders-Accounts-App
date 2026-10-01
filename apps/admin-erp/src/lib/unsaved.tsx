import * as React from "react";
import { useBlocker } from "react-router-dom";
import { UnsavedChangesDialog } from "@jst/ui";

/**
 * Unsaved-change protection (spec §5.5.6).
 * - Each editable form registers its dirty flag in a tiny global store.
 * - ONE <NavigationGuard/> (in the app shell) handles SPA route changes and
 *   browser close/reload for all registered forms (router allows one blocker).
 * - `guard(action)` protects local actions: dialog close, cancel, record switch.
 */
const dirtyForms = new Set<symbol>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function useAnyDirty() {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => dirtyForms.size > 0,
  );
}

export function useUnsavedGuard(dirty: boolean) {
  const token = React.useRef(Symbol("form"));
  const [pending, setPending] = React.useState<null | (() => void)>(null);

  React.useEffect(() => {
    const t = token.current;
    if (dirty) dirtyForms.add(t);
    else dirtyForms.delete(t);
    emit();
    return () => {
      dirtyForms.delete(t);
      emit();
    };
  }, [dirty]);

  const guard = React.useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty],
  );

  const dialog = (
    <UnsavedChangesDialog
      open={pending !== null}
      onKeepEditing={() => setPending(null)}
      onDiscard={() => {
        const a = pending;
        setPending(null);
        dirtyForms.delete(token.current);
        emit();
        a?.();
      }}
    />
  );
  return { guard, dialog };
}

export function NavigationGuard() {
  const dirty = useAnyDirty();

  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  return (
    <UnsavedChangesDialog
      open={blocker.state === "blocked"}
      onKeepEditing={() => blocker.reset?.()}
      onDiscard={() => blocker.proceed?.()}
    />
  );
}
