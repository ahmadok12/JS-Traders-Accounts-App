import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Cylinder, TriangleAlert, Undo2 } from "lucide-react";
import { Badge, Button, Input, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { qtyFmt, n } from "../sales/common";

export const PICK_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { OPEN: "warning", IN_PROGRESS: "info", DONE: "success", CANCELLED: "neutral" };
export const pickLabel = (s: string) => (s === "IN_PROGRESS" ? "In progress" : s === "DONE" ? "Picked" : s.charAt(0) + s.slice(1).toLowerCase());

export interface PickLine {
  id: string; line_no: number; qty_requested: number; qty_picked: number | null; shortage_reason: string | null; picked_at: string | null;
  product: { name: string; sku: string; tracking_type: string; uom: { code: string } | null } | null; variant: { name: string } | null;
}
export interface PickEvent { id: string; event: string; from_user: string | null; to_user: string | null; note: string | null; created_at: string; created_by: string | null }

export function usePickingTask(id: string | null, refetchMs?: number) {
  return useQuery({
    queryKey: ["record", "picking_tasks", id],
    enabled: !!id,
    refetchInterval: refetchMs,
    queryFn: async () => {
      const [h, l, e] = await Promise.all([
        sb().from("picking_tasks").select("*, warehouse:warehouses(code, name)").eq("id", id!).single(),
        sb().from("picking_task_lines").select("id, line_no, qty_requested, qty_picked, shortage_reason, picked_at, product:products(name, sku, tracking_type, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)").eq("task_id", id!).order("line_no"),
        sb().from("picking_task_events").select("id, event, from_user, to_user, note, created_at, created_by").eq("task_id", id!).order("created_at"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      return { header: h.data as Record<string, unknown> & { id: string }, lines: (l.data ?? []) as unknown as PickLine[], events: (e.data ?? []) as PickEvent[] };
    },
  });
}

/** People who can be given picking work (managers only — returns nothing for others). */
export function useAssignees() {
  const { companyId, can } = useAccess();
  return useQuery({
    queryKey: ["picking-assignees", companyId],
    enabled: !!companyId && can("picking.manage"),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("picking_assignees", { p_company_id: companyId });
      if (error) throw error;
      return (data ?? []) as { user_id: string; full_name: string; email: string }[];
    },
  });
}

/**
 * One item to pick: "Picked all" in one tap, or "Short" with the quantity found and a reason.
 * Used on the phone (big targets) and in the office task view.
 */
export function PickLineCard({ line, editable, big = false }: { line: PickLine; editable: boolean; big?: boolean }) {
  const qc = useQueryClient();
  const [short, setShort] = React.useState(false);
  const [qty, setQty] = React.useState("");
  const [reason, setReason] = React.useState("");
  const rec = useMutation({
    mutationFn: async (v: { qty: number | null; reason?: string }) => {
      const { error } = await sb().rpc("record_pick", { p_line_id: line.id, p_qty: v.qty, p_reason: v.reason ?? null });
      if (error) throw error;
    },
    onSuccess: () => { setShort(false); setQty(""); setReason(""); qc.invalidateQueries({ queryKey: ["record", "picking_tasks"] }); qc.invalidateQueries({ queryKey: ["my-picking"] }); qc.invalidateQueries({ queryKey: ["list"] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const done = line.qty_picked != null;
  const isShort = done && Number(line.qty_picked) < Number(line.qty_requested);
  const uom = line.product?.uom?.code ?? "";
  return (
    <div className={cn("rounded-card border bg-surface", big ? "p-3" : "p-2", done ? (isShort ? "border-warning/60" : "border-success/50 bg-success/5") : "border-line")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={cn("font-medium", big ? "text-base" : "text-sm")}>{line.product?.name ?? "Item"}{line.variant && <span className="font-normal text-ink-muted"> · {line.variant.name}</span>}</div>
          <div className="text-2xs text-ink-muted">{line.product?.sku}{line.product?.tracking_type === "PHYSICAL_UNIT" && <span className="ml-1 inline-flex items-center gap-0.5"><Cylinder className="inline h-3 w-3" /> roll item</span>}</div>
        </div>
        <div className="text-right">
          <div className={cn("font-semibold tabular-nums", big ? "text-xl" : "text-base")}>{qtyFmt(line.qty_requested)} <span className="text-xs font-normal text-ink-faint">{uom}</span></div>
          {done && <div className={cn("text-xs tabular-nums", isShort ? "text-warning" : "text-success")}>{isShort ? `${qtyFmt(line.qty_picked)} found` : "picked"}</div>}
        </div>
      </div>
      {isShort && line.shortage_reason && <p className="mt-1 flex items-center gap-1 text-xs text-warning"><TriangleAlert className="h-3 w-3" /> {line.shortage_reason}</p>}
      {editable && !done && !short && (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" className={cn("flex-1", big && "h-11 text-base")} icon={<Check className="h-4 w-4" />} loading={rec.isPending} onClick={() => rec.mutate({ qty: Number(line.qty_requested) })}>
            Picked all
          </Button>
          <Button className={cn(big && "h-11 text-base")} icon={<TriangleAlert className="h-4 w-4" />} onClick={() => setShort(true)}>Short</Button>
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
              onClick={() => (qty.trim() === "" || !(n(qty) >= 0) || n(qty) > Number(line.qty_requested) ? toast.error(`Enter 0 to ${qtyFmt(line.qty_requested)}`) : !reason.trim() ? toast.error("Say why it is short") : rec.mutate({ qty: n(qty), reason }))}>
              Save
            </Button>
          </div>
        </div>
      )}
      {editable && done && (
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
  CREATED: "Task created", ASSIGNED: "Assigned", REASSIGNED: "Reassigned", STARTED: "Picking started", COMPLETED: "Picking finished", CANCELLED: "Cancelled", GDN: "GDN made",
};
export function shortStatusBadge(s: string) { return <Badge tone={PICK_TONE[s]}>{pickLabel(s)}</Badge>; }
