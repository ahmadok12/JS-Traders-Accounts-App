import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Badge, Card, Input, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { ROLE_LABELS } from "@jst/permissions";

interface RuleRow {
  code: string; category: string; label: string; description: string; permission: string | null; enabled: boolean;
  roles: string[]; params: Record<string, unknown>; default_roles: string[]; sort: number;
}
const ROLES = ["ADMINISTRATOR", "OWNER", "ACCOUNTANT", "WAREHOUSE_MANAGER", "SALESPERSON"];

export function NotificationSettings() {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notification-rules", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().rpc("notification_rules_effective", { p_company: companyId });
      if (error) throw error;
      return (data ?? []) as RuleRow[];
    },
  });
  const save = useMutation({
    mutationFn: async (r: RuleRow) => {
      const { error } = await sb().rpc("save_notification_rule", { p_company: companyId, p_code: r.code, p_enabled: r.enabled, p_roles: r.roles, p_params: r.params });
      if (error) throw error;
    },
    onMutate: async (r) => {
      qc.setQueryData<RuleRow[]>(["notification-rules", companyId], (old) => old?.map((x) => (x.code === r.code ? r : x)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-refresh"] }),
    onError: (e) => { toast.error(friendlyError(e)); qc.invalidateQueries({ queryKey: ["notification-rules", companyId] }); },
  });
  const canEdit = can("settings.manage");
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <Card className="p-4 text-sm text-danger">{friendlyError(q.error)}</Card>;
  const rows = q.data ?? [];
  const cats = [...new Set(rows.map((r) => r.category))];
  return (
    <div className="max-w-5xl space-y-3">
      <Card className="flex gap-3 p-3 text-sm text-ink-2">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <div>Choose what shows in the bell at the top of the screen, and for which roles. A person only receives a notification if their role is ticked
          <b> and</b> they have the permission to act on it. Notifications disappear by themselves when the job is done (order approved, cheque deposited …).</div>
      </Card>
      {cats.map((c) => (
        <Card key={c} className="overflow-hidden">
          <div className="border-b border-line bg-subtle px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{c}</div>
          {rows.filter((r) => r.category === c).map((r) => (
            <div key={r.code} className={cn("flex flex-col gap-2 border-b border-line/70 px-3 py-2.5 last:border-0 md:flex-row md:items-center", !r.enabled && "opacity-60")}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#111827]" checked={r.enabled} disabled={!canEdit} onChange={(e) => save.mutate({ ...r, enabled: e.target.checked })} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{r.label}</span>
                  <span className="block text-xs text-ink-muted">{r.description}</span>
                </span>
              </label>
              {"days" in r.params && (
                <div className="flex items-center gap-1 text-xs text-ink-muted">
                  {r.code === "PAYMENT_RECEIVED" ? "Show for" : "Warn"}
                  <DaysInput value={Number(r.params.days)} disabled={!canEdit || !r.enabled} onSave={(n) => save.mutate({ ...r, params: { ...r.params, days: n } })} />
                  {r.code === "PAYMENT_RECEIVED" ? "day(s)" : "day(s) ahead"}
                </div>
              )}
              {r.code === "APPROVAL_LIMIT" ? <Badge tone="info">Goes to the approvers set in each limit</Badge> : (
                <div className="flex flex-wrap gap-1">
                  {ROLES.map((x) => {
                    const on = r.roles.includes(x);
                    return (
                      <button key={x} disabled={!canEdit || !r.enabled} onClick={() => save.mutate({ ...r, roles: on ? r.roles.filter((y) => y !== x) : [...r.roles, x] })}
                        className={cn("h-6 rounded-full border px-2 text-2xs", on ? "border-ink bg-ink text-white" : "border-line text-ink-muted hover:border-line-strong")}>
                        {ROLE_LABELS[x] ?? x}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

function DaysInput({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (n: number) => void }) {
  const [v, setV] = React.useState(String(value));
  React.useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Math.max(1, Math.min(60, Math.round(Number(v) || 1))); setV(String(n)); if (n !== value) onSave(n); };
  return <Input className="h-control-sm w-14 text-center" type="number" min={1} max={60} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}
