import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCircle2, Cylinder, TriangleAlert, Undo2, UserRound } from "lucide-react";
import { Badge, Button, Input, cn } from "@jst/ui";
import { AllocRollsNote, useAllocRolls } from "../inventory/rolls";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { formatDateTime } from "@jst/utilities";
import { qtyFmt, n } from "../sales/common";

export const PICK_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { OPEN: "warning", IN_PROGRESS: "info", DONE: "success", CANCELLED: "neutral" };
export const pickLabel = (s: string) => (s === "IN_PROGRESS" ? "In progress" : s === "DONE" ? "Picked" : s.charAt(0) + s.slice(1).toLowerCase());

export interface PickLine {
  id: string; line_no: number; qty_requested: number; qty_picked: number | null; shortage_reason: string | null; picked_at: string | null; picked_by: string | null;
  product_id: string; variant_id: string | null; allocation_id: string; shortage_status: "PENDING" | "RESOLVED" | null; shortage_action: string | null; shortage_note: string | null; follow_up_task_id: string | null;
  product: { name: string; sku: string; tracking_type: string; uom: { code: string } | null } | null; variant: { name: string } | null;
}
export interface PickEvent { id: string; event: string; from_user: string | null; to_user: string | null; note: string | null; created_at: string; created_by: string | null }
export interface PickAssignee { id: string; user_id: string; assigned_at: string; acknowledged_at: string | null; removed_at: string | null }

const LINE_SELECT = "id, line_no, product_id, variant_id, qty_requested, qty_picked, shortage_reason, picked_at, picked_by, allocation_id, shortage_status, shortage_action, shortage_note, follow_up_task_id, product:products(name, sku, tracking_type, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)";

export function usePickingTask(id: string | null) {
  return useQuery({
    queryKey: ["record", "picking_tasks", id],
    enabled: !!id,
    refetchInterval: 60_000, // realtime does the work; this is only a safety net
    queryFn: async () => {
      const [h, l, e, a] = await Promise.all([
        sb().from("picking_tasks").select("*, warehouse:warehouses(code, name)").eq("id", id!).single(),
        sb().from("picking_task_lines").select(LINE_SELECT).eq("task_id", id!).order("line_no"),
        sb().from("picking_task_events").select("id, event, from_user, to_user, note, created_at, created_by").eq("task_id", id!).order("created_at"),
        sb().from("picking_task_assignees").select("id, user_id, assigned_at, acknowledged_at, removed_at").eq("task_id", id!).is("removed_at", null).order("assigned_at"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      return {
        header: h.data as Record<string, unknown> & { id: string; warehouse_id: string; sales_order_id: string; status: string; doc_no: string },
        lines: (l.data ?? []) as unknown as PickLine[], events: (e.data ?? []) as PickEvent[], team: (a.data ?? []) as PickAssignee[],
      };
    },
  });
}

export interface StaffRow {
  user_id: string; full_name: string; email: string; phone: string | null; is_active: boolean; is_staff: boolean;
  warehouse_ids: string[]; open_tasks: number; last_ack_at: string | null;
}
/** Everyone who can pick (managers only — returns nothing for others), with their warehouses. */
export function usePickingStaff() {
  const { companyId, can } = useAccess();
  return useQuery({
    queryKey: ["picking-staff", companyId],
    enabled: !!companyId && can("picking.manage"),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("picking_staff", { p_company_id: companyId });
      if (error) throw error;
      return (data ?? []) as StaffRow[];
    },
  });
}
/** Pickers who work in a warehouse (explicit warehouse membership). */
export const staffOf = (staff: StaffRow[] | undefined, warehouseId: string | null | undefined) =>
  (staff ?? []).filter((s) => s.is_active && !!warehouseId && s.warehouse_ids.includes(warehouseId));

/** Older call sites: id → name list. */
export function useAssignees() {
  const s = usePickingStaff();
  return { ...s, data: s.data?.map((x) => ({ user_id: x.user_id, full_name: x.full_name, email: x.email })) };
}

export const loginLabel = (email: string | null | undefined) => (email ?? "").replace(/@staff\.jstradersokr\.shop$/i, "");

/** Pick one or many pickers as chips. */
export function PickerChips({ people, value, onChange, empty }: { people: StaffRow[]; value: string[]; onChange: (v: string[]) => void; empty?: React.ReactNode }) {
  if (!people.length) return <p className="text-xs text-ink-faint">{empty ?? "No staff in this warehouse yet — add or move staff in Warehouse Staff."}</p>;
  const all = people.every((p) => value.includes(p.user_id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {people.length > 1 && (
        <button type="button" onClick={() => onChange(all ? [] : people.map((p) => p.user_id))}
          className={cn("rounded-full border px-2.5 py-1 text-xs", all ? "border-primary bg-primary text-primary-fg" : "border-dashed border-line-strong text-ink-muted hover:text-ink")}>
          {all ? "All ✓" : "All"}
        </button>
      )}
      {people.map((p) => {
        const on = value.includes(p.user_id);
        return (
          <button key={p.user_id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== p.user_id) : [...value, p.user_id])}
            className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/5 font-medium text-ink" : "border-line text-ink-2 hover:border-ink-faint")}>
            {on ? <Check className="h-3 w-3" /> : <UserRound className="h-3 w-3 text-ink-faint" />}{p.full_name}
            {p.open_tasks > 0 && <span className="text-2xs text-ink-faint">· {p.open_tasks} open</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One item to pick: "Picked all" in one tap, or "Short" with the quantity found and a reason.
 * Used on the phone (big targets) and in the office task view.
 */
export function PickLineCard({ line, editable, big = false, names, extra }: { line: PickLine; editable: boolean; big?: boolean; names?: Map<string, string>; extra?: React.ReactNode }) {
  const qc = useQueryClient();
  const [short, setShort] = React.useState(false);
  const [qty, setQty] = React.useState("");
  const [reason, setReason] = React.useState("");
  const rec = useMutation({
    mutationFn: async (v: { qty: number | null; reason?: string }) => {
      const { error } = await sb().rpc("record_pick", { p_line_id: line.id, p_qty: v.qty, p_reason: v.reason ?? null });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      setShort(false); setQty(""); setReason("");
      if (v.qty != null && v.qty < Number(line.qty_requested)) toast.success("Shortage sent to the manager");
      qc.invalidateQueries({ queryKey: ["record", "picking_tasks"] }); qc.invalidateQueries({ queryKey: ["my-picking"] }); qc.invalidateQueries({ queryKey: ["list"] });
    },
    onError: (e) => { toast.error(friendlyError(e)); qc.invalidateQueries({ queryKey: ["record", "picking_tasks"] }); },
  });
  const done = line.qty_picked != null;
  const isShort = done && Number(line.qty_picked) < Number(line.qty_requested);
  const uom = line.product?.uom?.code ?? "";
  const who = line.picked_by ? names?.get(line.picked_by) : null;
  const isRoll = line.product?.tracking_type === "PHYSICAL_UNIT";
  const chosen = useAllocRolls(isRoll ? [line.allocation_id] : []);
  return (
    <div className={cn("rounded-card border bg-surface", big ? "p-3" : "p-2", done ? (isShort ? "border-warning/60 bg-warning-soft/40" : "border-success/50 bg-success/5") : "border-line")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={cn("font-medium", big ? "text-base" : "text-sm")}>{line.product?.name ?? "Item"}{line.variant && <span className="font-normal text-ink-muted"> · {line.variant.name}</span>}</div>
          <div className="text-2xs text-ink-muted">{line.product?.sku}{line.product?.tracking_type === "PHYSICAL_UNIT" && <span className="ml-1 inline-flex items-center gap-0.5"><Cylinder className="inline h-3 w-3" /> roll item</span>}</div>
          {isRoll && <AllocRollsNote className={big ? "mt-1 text-xs" : "mt-0.5"} rolls={chosen.data?.get(line.allocation_id)} uom={uom} />}
        </div>
        <div className="text-right">
          <div className={cn("font-semibold tabular-nums", big ? "text-xl" : "text-base")}>{qtyFmt(line.qty_requested)} <span className="text-xs font-normal text-ink-faint">{uom}</span></div>
          {done && <div className={cn("text-xs tabular-nums", isShort ? "text-warning" : "text-success")}>{isShort ? `${qtyFmt(line.qty_picked)} found` : "picked"}{who ? ` · ${who}` : ""}</div>}
        </div>
      </div>
      {isShort && line.shortage_reason && <p className="mt-1 flex items-center gap-1 text-xs text-warning"><TriangleAlert className="h-3 w-3" /> {line.shortage_reason}</p>}
      {isShort && line.shortage_status === "PENDING" && <p className="mt-1 text-2xs font-medium text-warning">Waiting for the manager's decision</p>}
      {isShort && line.shortage_status === "RESOLVED" && (
        <p className="mt-1 flex items-center gap-1 text-2xs text-ink-muted"><CheckCircle2 className="h-3 w-3 text-success" />
          {line.shortage_action === "REDUCE_ORDER" ? "Manager removed the missing quantity from the order" : line.shortage_action === "REPICK" ? "Manager sent the missing quantity to another picker" : "Manager kept it on the order for later"}
        </p>
      )}
      {extra}
      {editable && !done && !short && (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" className={cn("flex-1", big && "h-12 text-base")} icon={<Check className="h-4 w-4" />} loading={rec.isPending} onClick={() => rec.mutate({ qty: Number(line.qty_requested) })}>
            Picked all
          </Button>
          <Button className={cn(big && "h-12 text-base")} icon={<TriangleAlert className="h-4 w-4" />} onClick={() => setShort(true)}>Short</Button>
        </div>
      )}
      {editable && !done && short && (
        <div className="mt-2 space-y-2 rounded-control bg-subtle p-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">Found</span>
            <Input inputMode="decimal" autoFocus className={cn("w-28 text-right tabular-nums", big && "h-11 text-base")} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
            <span className="text-xs text-ink-muted">of {qtyFmt(line.qty_requested)} {uom}</span>
          </div>
          <Input className={cn(big && "h-11 text-base")} placeholder="Why short? (e.g. not on shelf, damaged)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setShort(false)}>Back</Button>
            <Button variant="primary" className="flex-1" loading={rec.isPending}
              onClick={() => (qty.trim() === "" || !(n(qty) >= 0) || n(qty) >= Number(line.qty_requested) ? toast.error(`Enter 0 to ${qtyFmt(Number(line.qty_requested) - 1)} — or use “Picked all”`) : !reason.trim() ? toast.error("Say why it is short") : rec.mutate({ qty: n(qty), reason }))}>
              Submit short
            </Button>
          </div>
        </div>
      )}
      {editable && done && line.shortage_status !== "RESOLVED" && (
        <div className="mt-1 text-right">
          <button className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink" disabled={rec.isPending} onClick={() => rec.mutate({ qty: null })}><Undo2 className="h-3 w-3" /> Undo</button>
        </div>
      )}
    </div>
  );
}

export function PickProgress({ lines }: { lines: { qty_picked: number | null }[] }) {
  const done = lines.filter((l) => l.qty_picked != null).length;
  const pct = lines.length ? (done / lines.length) * 100 : 0;
  return (
    <div className="w-full">
      <div className="text-2xs tabular-nums text-ink-muted">{done} / {lines.length} ticked</div>
      <div className="h-1.5 rounded-full bg-subtle"><div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export const EVENT_LABEL: Record<string, string> = {
  CREATED: "Task created", ASSIGNED: "Picker added", UNASSIGNED: "Picker removed", REASSIGNED: "Reassigned", STARTED: "Picking started",
  SHORT: "Short", SHORTAGE_RESOLVED: "Shortage decided", COMPLETED: "Picking finished", CANCELLED: "Cancelled", GDN: "GDN made",
};
export function shortStatusBadge(s: string) { return <Badge tone={PICK_TONE[s]}>{pickLabel(s)}</Badge>; }

export function SeenBadge({ a }: { a: PickAssignee }) {
  return a.acknowledged_at
    ? <span className="text-2xs text-success" title={formatDateTime(a.acknowledged_at)}>✓ seen</span>
    : <span className="animate-pulse text-2xs font-medium text-warning">not seen yet</span>;
}
