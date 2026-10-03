import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { chime, systemNotify, unlockOnFirstGesture } from "./alarm";
import { useMyNotifications, type StaffNotification } from "./realtime";

/**
 * Office side: shortages and finished picking pop up with a chime on any ERP screen.
 * Shortage alerts stay on screen until opened or dismissed.
 */
export function ManagerAlerts() {
  const { session, can } = useAccess();
  const navigate = useNavigate();
  const enabled = can(P.pickingManage);
  React.useEffect(() => { if (enabled) unlockOnFirstGesture(); }, [enabled]);

  const show = React.useCallback((nt: StaffNotification, ack: (ids?: string[]) => Promise<void>) => {
    chime();
    const open = () => { void ack([nt.id]); if (nt.task_id) navigate(`/picking?view=${nt.task_id}`); };
    toast[nt.kind === "SHORTAGE" ? "warning" : "success"](nt.title, {
      id: nt.id, description: nt.body ?? undefined,
      duration: nt.kind === "SHORTAGE" ? Infinity : 10_000,
      action: nt.task_id ? { label: "Open", onClick: open } : undefined,
      onDismiss: () => void ack([nt.id]), onAutoClose: () => void ack([nt.id]),
    });
    if (document.visibilityState !== "visible") void systemNotify(nt.title, nt.body ?? "", { tag: nt.id, url: nt.task_id ? `/picking?view=${nt.task_id}` : "/picking" });
  }, [navigate]);

  const ackRef = React.useRef<(ids?: string[]) => Promise<void>>(async () => undefined);
  const notes = useMyNotifications(enabled ? session?.user.id : null, (nt) => show(nt, ackRef.current));
  ackRef.current = notes.ack;

  // alerts that arrived while the ERP was closed
  const shownInitial = React.useRef(false);
  React.useEffect(() => {
    if (shownInitial.current || !notes.unread.length) return;
    shownInitial.current = true;
    for (const nt of notes.unread.slice(0, 5).reverse()) show(nt, notes.ack);
  }, [notes.unread, notes.ack, show]);
  return null;
}
