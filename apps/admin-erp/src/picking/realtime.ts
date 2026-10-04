import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@jst/data-access";

/**
 * Live picking data (Supabase Realtime). Any change to tasks, lines or pickers refreshes the
 * open screens within a moment — row-level security decides which changes each user receives.
 */
export function usePickingRealtime(enabled = true) {
  const qc = useQueryClient();
  const [live, setLive] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const refresh = () => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        qc.invalidateQueries({ queryKey: ["record", "picking_tasks"] });
        qc.invalidateQueries({ queryKey: ["list", "picking_tasks"] });
        qc.invalidateQueries({ queryKey: ["my-picking"] });
        qc.invalidateQueries({ queryKey: ["picking-staff"] });
        qc.invalidateQueries({ queryKey: ["so-pick-lines"] });
        qc.invalidateQueries({ queryKey: ["pending-shortages"] });
        qc.invalidateQueries({ queryKey: ["my-jobs"] });
        qc.invalidateQueries({ queryKey: ["job"] });
        qc.invalidateQueries({ queryKey: ["warehouse-desk"] });
      }, 250);
    };
    const ch = sb().channel(`picking-live-${Math.random().toString(36).slice(2)}`);
    for (const table of ["picking_tasks", "picking_task_lines", "picking_task_assignees", "warehouse_job_assignees", "stock_count_lines", "receipt_check_lines"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    ch.subscribe((status) => setLive(status === "SUBSCRIBED"));
    // when the phone wakes up / tab returns, catch up immediately
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timer != null) window.clearTimeout(timer);
      void sb().removeChannel(ch);
    };
  }, [enabled, qc]);
  return live;
}

export interface StaffNotification {
  id: string; kind: string; urgent: boolean; title: string; body: string | null; task_id: string | null; created_at: string; read_at: string | null;
  job_type?: "COUNT" | "RECEIPT" | "PRICE" | null; job_id?: string | null;
}

/**
 * My notifications: unread ones on start + new ones live. `onNew` fires for each newly
 * arrived notification (not for the ones already waiting when the screen opened).
 */
export function useMyNotifications(userId: string | null | undefined, onNew?: (n: StaffNotification) => void) {
  const qc = useQueryClient();
  const cb = React.useRef(onNew);
  cb.current = onNew;
  const q = useQuery({
    queryKey: ["my-notifications", userId],
    enabled: !!userId,
    refetchInterval: 60_000, // safety net if the live connection drops
    queryFn: async () => {
      const { data, error } = await sb().from("staff_notifications").select("id, kind, urgent, title, body, task_id, job_type, job_id, created_at, read_at")
        .eq("user_id", userId!).is("read_at", null).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as StaffNotification[];
    },
  });
  React.useEffect(() => {
    if (!userId) return;
    const ch = sb().channel(`notify-${userId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_notifications", filter: `user_id=eq.${userId}` }, (p) => {
        const row = p.new as StaffNotification;
        cb.current?.(row);
        qc.invalidateQueries({ queryKey: ["my-notifications", userId] });
      })
      .subscribe();
    return () => { void sb().removeChannel(ch); };
  }, [userId, qc]);
  const ack = React.useCallback(async (ids?: string[]) => {
    await sb().rpc("ack_staff_notifications", { p_ids: ids ?? null });
    qc.invalidateQueries({ queryKey: ["my-notifications", userId] });
  }, [qc, userId]);
  return { unread: q.data ?? [], ack, refetch: q.refetch };
}
