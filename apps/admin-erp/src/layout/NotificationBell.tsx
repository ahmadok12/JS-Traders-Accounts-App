import * as React from "react";
import { useNavigate } from "react-router-dom";
import * as Pop from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bell, CheckCheck, CircleAlert, Info, Settings2 } from "lucide-react";
import { Button, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";

interface Ntf { id: string; rule_code: string; title: string; body: string | null; link: string | null; severity: "info" | "warning" | "danger"; created_at: string; read_at: string | null }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};

/**
 * In-app notifications (spec §21). The database evaluates the notification rules for the signed-in
 * user (refresh_my_notifications); items clear themselves once the condition is gone
 * (the order is approved, the cheque deposited …).
 */
export function NotificationBell() {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const first = React.useRef(true);

  const refresh = useQuery({
    queryKey: ["notifications-refresh", companyId],
    enabled: !!companyId,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb().rpc("refresh_my_notifications", { p_company: companyId });
      if (error) throw error;
      const r = data as { new: number; unread: number };
      if (!first.current && r.new > 0) toast.info(`${r.new} new notification${r.new === 1 ? "" : "s"}`, { action: { label: "Show", onClick: () => setOpen(true) } });
      first.current = false;
      qc.invalidateQueries({ queryKey: ["notifications", companyId] });
      return r;
    },
  });

  const list = useQuery({
    queryKey: ["notifications", companyId],
    enabled: !!companyId && refresh.isSuccess,
    queryFn: async () => {
      const { data, error } = await sb().from("notifications").select("id, rule_code, title, body, link, severity, created_at, read_at")
        .eq("company_id", companyId!).is("resolved_at", null).order("created_at", { ascending: false }).limit(60);
      if (error) throw error;
      return (data ?? []) as Ntf[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await sb().rpc("mark_notifications_read", { p_company: companyId, p_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", companyId] }),
  });

  // the database is older than Stage 12 → no bell
  if (refresh.isError) return null;
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  const openItem = (n: Ntf) => {
    if (!n.read_at) markRead.mutate([n.id]);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Pop.Root open={open} onOpenChange={setOpen}>
      <Pop.Trigger asChild>
        <button className="relative flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-subtle hover:text-ink" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </Pop.Trigger>
      <Pop.Portal>
        <Pop.Content align="end" sideOffset={6} className="z-50 flex max-h-[min(560px,80vh)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-pop">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <div className="flex-1 text-sm font-semibold text-ink">Notifications</div>
            {unread > 0 && <Button variant="ghost" size="sm" icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={() => markRead.mutate(null)}>Mark all read</Button>}
            {can("settings.manage") && (
              <Button variant="ghost" size="icon-sm" aria-label="Notification settings" title="Notification settings" onClick={() => { setOpen(false); navigate("/settings?tab=notifications"); }}>
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading ? <p className="p-4 text-sm text-ink-muted">Loading…</p> : items.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-muted">You're all caught up.</div>
            ) : items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)}
                className={cn("flex w-full items-start gap-2.5 border-b border-line/70 px-3 py-2.5 text-left hover:bg-subtle", !n.read_at && "bg-info-soft/40")}>
                <span className={cn("mt-0.5 shrink-0", n.severity === "danger" ? "text-danger" : n.severity === "warning" ? "text-warning" : "text-info")}>
                  {n.severity === "danger" ? <CircleAlert className="h-4 w-4" /> : n.severity === "warning" ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", n.read_at ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-ink-muted">{n.body}</span>}
                  <span className="block text-2xs text-ink-faint">{ago(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-label="Unread" />}
              </button>
            ))}
          </div>
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}
