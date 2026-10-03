import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, ChevronRight } from "lucide-react";
import { Badge, Button, ErpDialog, Field, Input, Skeleton } from "@jst/ui";
import { friendlyError, sb } from "@jst/data-access";
import { formatDateTime } from "@jst/utilities";
import { qtyFmt, useWarehouses } from "../sales/common";
import { PICK_TONE, PickProgress, PickerChips, pickLabel, staffOf, usePickingStaff } from "./common";
import { usePickingRealtime } from "./realtime";

export interface SoTask {
  id: string; doc_no: string; status: string; created_at: string; warehouse: { code: string } | null;
  lines: { qty_picked: number | null; shortage_status: string | null }[]; team: { user_id: string; acknowledged_at: string | null; removed_at: string | null }[];
}

/** picking tasks of one sales order (live) */
export function useSoTasks(soId: string | null) {
  usePickingRealtime(!!soId);
  return useQuery({
    queryKey: ["list", "picking_tasks", "so", soId],
    enabled: !!soId,
    queryFn: async () => {
      const { data, error } = await sb().from("picking_tasks")
        .select("id, doc_no, status, created_at, warehouse:warehouses(code), lines:picking_task_lines!picking_task_lines_task_id_fkey(qty_picked, shortage_status), team:picking_task_assignees(user_id, acknowledged_at, removed_at)")
        .eq("sales_order_id", soId!).order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as SoTask[];
    },
  });
}

export function SoPickingTab({ tasks, onOpen }: { tasks: SoTask[]; onOpen: (id: string) => void }) {
  const staff = usePickingStaff();
  const names = new Map((staff.data ?? []).map((s) => [s.user_id, s.full_name]));
  if (!tasks.length) return <p className="text-xs text-ink-muted">Not sent to pickers yet — use “Send to pickers”.</p>;
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {tasks.map((t) => {
        const team = t.team.filter((m) => !m.removed_at);
        const short = t.lines.some((l) => l.shortage_status === "PENDING");
        return (
          <button key={t.id} onClick={() => onOpen(t.id)} className="flex items-center gap-3 rounded-card border border-line bg-white p-3 text-left hover:border-sky-400">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-sm font-semibold">{t.doc_no}</span><span className="font-mono text-xs text-ink-muted">{t.warehouse?.code}</span>
                <Badge tone={PICK_TONE[t.status]}>{pickLabel(t.status)}</Badge>{short && <Badge tone="danger">Short — decide</Badge>}</div>
              <div className="text-xs text-ink-muted">{team.length ? team.map((m) => `${names.get(m.user_id) ?? "…"}${m.acknowledged_at ? " ✓" : ""}`).join(", ") : "No picker"} · {formatDateTime(t.created_at)}</div>
              <PickProgress lines={t.lines} />
            </div>
            <ChevronRight className="h-4 w-4 text-ink-faint" />
          </button>
        );
      })}
    </div>
  );
}

interface PickLineRow { sales_order_line_id: string; allocations: { warehouse_id: string; free: number }[] }

/** One step from the sales order: (approve and) send everything still to pick to the chosen staff of each warehouse. */
export function SendToPickersDialog({ soId, docNo, draft, onClose }: { soId: string; docNo: string; draft: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const whs = useWarehouses();
  const staff = usePickingStaff();
  const [who, setWho] = React.useState<Record<string, string[]>>({});
  const [note, setNote] = React.useState("");
  const lines = useQuery({
    queryKey: ["so-pick-lines", soId],
    queryFn: async () => {
      const { data, error } = await sb().rpc("so_pick_lines", { p_so_id: soId });
      if (error) throw error;
      return (data ?? []) as PickLineRow[];
    },
  });
  // what is still to pick per warehouse (a draft has nothing picked yet: its allocations are all free)
  const perWh = React.useMemo(() => {
    const m = new Map<string, { items: number; qty: number }>();
    for (const l of lines.data ?? []) for (const a of l.allocations) {
      const free = Number(a.free);
      if (free <= 0) continue;
      const cur = m.get(a.warehouse_id) ?? { items: 0, qty: 0 };
      m.set(a.warehouse_id, { items: cur.items + 1, qty: cur.qty + free });
    }
    return m;
  }, [lines.data]);
  const used = (whs.data ?? []).filter((w) => perWh.has(w.id));
  const plan = Object.fromEntries(used.map((w) => [w.id, who[w.id] ?? []]).filter(([, v]) => (v as string[]).length));
  const go = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("start_so_picking", { p_so_id: soId, p_plan: plan, p_notes: note || null });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    onSuccess: (ids) => { toast.success(`${draft ? "Approved — " : ""}${ids.length} picking task${ids.length > 1 ? "s" : ""} sent, pickers' phones are buzzing`); qc.invalidateQueries(); onClose(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog open onRequestClose={onClose} size="md" accent="picking" icon={<BellRing className="h-4 w-4" />}
      title={draft ? `Approve & send ${docNo} to pickers` : `Send ${docNo} to pickers`}
      subtitle="Everything still to pick in each warehouse goes to the staff you choose there"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<BellRing className="h-3.5 w-3.5" />} disabled={!Object.keys(plan).length} loading={go.isPending} onClick={() => go.mutate()}>{draft ? "Approve & buzz" : "Send & buzz"}</Button></>}>
      {lines.isLoading ? <Skeleton className="h-24" /> : lines.error ? <p className="text-sm text-danger">{friendlyError(lines.error)}</p> : used.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-4 text-center text-sm text-ink-muted">Everything on this order is already in picking or dispatched.</p>
      ) : (
        <div className="space-y-3">
          {used.map((w) => (
            <div key={w.id} className="rounded-card border border-line p-3">
              <div className="mb-2 flex items-baseline gap-2"><span className="font-mono text-sm font-semibold">{w.code}</span><span className="text-sm text-ink-muted">{w.name}</span>
                <span className="ml-auto text-xs text-ink-muted">{perWh.get(w.id)!.items} item{perWh.get(w.id)!.items > 1 ? "s" : ""} · {qtyFmt(perWh.get(w.id)!.qty)} units</span></div>
              <PickerChips people={staffOf(staff.data, w.id)} value={who[w.id] ?? []} onChange={(v) => setWho((s) => ({ ...s, [w.id]: v }))} />
            </div>
          ))}
          <Field label="Note for the pickers"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. load on the Daewoo truck at 4 pm" /></Field>
        </div>
      )}
    </ErpDialog>
  );
}
