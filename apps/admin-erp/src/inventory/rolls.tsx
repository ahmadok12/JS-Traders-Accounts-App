import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Scissors, X } from "lucide-react";
import { Button, Input, cn } from "@jst/ui";
import { sb } from "@jst/data-access";
import { formatNumber } from "@jst/utilities";

/** A roll on an inbound line (new roll, optional label/lot). */
export interface RollEntry { key: string; qty: string; label: string }
export type CutMode = "auto" | "pick";
/** Outbound: unit_id → quantity to cut */
export type Cuts = Record<string, string>;

export interface RollRow { id: string; unit_no: string; remaining_qty: number; original_qty: number; label: string | null; parent_unit_id: string | null }

const n = (s: string) => Number(String(s).replace(/,/g, ""));
export const fmtQty = (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : 2);
export const sumRolls = (r: RollEntry[]) => r.reduce((a, x) => a + (Number.isNaN(n(x.qty)) ? 0 : n(x.qty)), 0);
export const sumCuts = (c: Cuts) => Object.values(c).reduce((a, x) => a + (x.trim() === "" || Number.isNaN(n(x)) ? 0 : n(x)), 0);
export const newRoll = (qty = ""): RollEntry => ({ key: crypto.randomUUID(), qty, label: "" });

/** Rolls with stock for an item in a warehouse, smallest first (the order Auto would use them). */
export function useRolls(warehouseId: string | null, productId: string | null, variantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["rolls", warehouseId, productId, variantId],
    enabled: enabled && !!warehouseId && !!productId,
    staleTime: 5_000,
    queryFn: async () => {
      let q = sb().from("physical_units").select("id, unit_no, remaining_qty, original_qty, label, parent_unit_id")
        .eq("warehouse_id", warehouseId!).eq("product_id", productId!).gt("remaining_qty", 0);
      q = variantId ? q.eq("variant_id", variantId) : q.is("variant_id", null);
      const { data, error } = await q.order("remaining_qty").limit(300);
      if (error) throw error;
      return (data ?? []) as RollRow[];
    },
  });
}

/** Inbound: list of roll lengths. Empty list = the whole quantity arrives as one roll. */
export function RollLengthsEditor({ rolls, onChange, uom, fallbackQty, compact }: {
  rolls: RollEntry[]; onChange: (r: RollEntry[]) => void; uom: string; fallbackQty?: string; compact?: boolean;
}) {
  const [bulk, setBulk] = React.useState<{ count: string; len: string }>({ count: "", len: "" });
  const total = sumRolls(rolls);
  const addBulk = () => {
    const c = Math.floor(n(bulk.count)); const l = n(bulk.len);
    if (!(c > 0 && c <= 500 && l > 0)) return;
    onChange([...rolls.filter((r) => r.qty.trim() !== ""), ...Array.from({ length: c }, () => newRoll(String(l)))]);
    setBulk({ count: "", len: "" });
  };
  if (!rolls.length) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>Arrives as <b className="text-ink">one roll</b>{fallbackQty && n(fallbackQty) > 0 ? <> of {fmtQty(n(fallbackQty))} {uom}</> : null}.</span>
        <Button size="sm" variant="ghost" icon={<Scissors className="h-3.5 w-3.5" />} onClick={() => onChange(fallbackQty && n(fallbackQty) > 0 ? [newRoll(String(n(fallbackQty)))] : [newRoll()])}>
          Enter roll lengths
        </Button>
      </div>
    );
  }
  return (
    <div className={cn("space-y-1.5", compact ? "" : "rounded-control bg-subtle/60 p-2")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {rolls.map((r, i) => (
          <div key={r.key} className="flex items-center gap-1 rounded-control border border-line bg-surface pl-1.5">
            <span className="text-2xs text-ink-faint">#{i + 1}</span>
            <Input inputMode="decimal" aria-label={`Roll ${i + 1} length`} className="h-control-sm w-20 border-0 px-1 text-right tabular-nums shadow-none"
              placeholder="Length" value={r.qty} onChange={(e) => onChange(rolls.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} />
            <Input aria-label={`Roll ${i + 1} lot / label`} className="h-control-sm w-24 border-0 px-1 text-xs shadow-none" placeholder="Lot (opt.)"
              value={r.label} onChange={(e) => onChange(rolls.map((x) => (x.key === r.key ? { ...x, label: e.target.value } : x)))} />
            <button type="button" aria-label="Remove roll" className="px-1 text-ink-faint hover:text-danger" onClick={() => onChange(rolls.filter((x) => x.key !== r.key))}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...rolls, newRoll()])}>Roll</Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        <span>Add</span>
        <Input inputMode="numeric" aria-label="Number of rolls" className="h-control-sm w-14 text-right" placeholder="No." value={bulk.count} onChange={(e) => setBulk((b) => ({ ...b, count: e.target.value }))} />
        <span>rolls ×</span>
        <Input inputMode="decimal" aria-label="Length of each roll" className="h-control-sm w-20 text-right" placeholder="Length" value={bulk.len} onChange={(e) => setBulk((b) => ({ ...b, len: e.target.value }))} />
        <span>{uom}</span>
        <Button size="sm" onClick={addBulk} disabled={!(n(bulk.count) > 0 && n(bulk.len) > 0)}>Add</Button>
        <span className="ml-auto tabular-nums">{rolls.length} roll{rolls.length === 1 ? "" : "s"} · <b className="text-ink">{fmtQty(total)} {uom}</b></span>
      </div>
    </div>
  );
}

/** Outbound: cut automatically, or choose rolls and how much from each. */
export function RollCutsEditor({ mode, cuts, onMode, onCuts, warehouseId, productId, variantId, uom }: {
  mode: CutMode; cuts: Cuts; onMode: (m: CutMode) => void; onCuts: (c: Cuts) => void;
  warehouseId: string | null; productId: string | null; variantId: string | null; uom: string;
}) {
  const rolls = useRolls(warehouseId, productId, variantId);
  const total = sumCuts(cuts);
  const over = (r: RollRow) => { const v = cuts[r.id]; return !!v && n(v) > Number(r.remaining_qty); };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-control border border-line bg-subtle p-0.5" role="radiogroup" aria-label="Which roll">
          {([["auto", "Auto"], ["pick", "Choose rolls"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onMode(m)}
              className={cn("h-[24px] rounded-[6px] px-2 text-xs font-medium", mode === m ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-muted">
          {mode === "auto"
            ? "Cuts from the smallest roll that covers it (least off-cut)."
            : <>Cutting <b className="tabular-nums text-ink">{fmtQty(total)} {uom}</b> from {Object.values(cuts).filter((v) => v.trim() !== "" && n(v) > 0).length} roll(s).</>}
        </span>
        {rolls.data && <span className="ml-auto text-2xs text-ink-faint">{rolls.data.length} roll{rolls.data.length === 1 ? "" : "s"} in stock</span>}
      </div>
      {mode === "pick" && (
        <div className="flex flex-wrap gap-1.5">
          {(rolls.data ?? []).map((r) => (
            <label key={r.id} className={cn("flex items-center gap-1.5 rounded-control border bg-surface py-0.5 pl-2 pr-1 text-xs", over(r) ? "border-danger" : cuts[r.id] ? "border-primary" : "border-line")}>
              <span className="font-mono">{r.unit_no}</span>
              <span className="tabular-nums text-ink-muted">{fmtQty(Number(r.remaining_qty))}{r.label ? ` · ${r.label}` : ""}</span>
              <Input inputMode="decimal" aria-label={`Cut from ${r.unit_no}`} className="h-[24px] w-16 px-1 text-right tabular-nums" placeholder="Cut"
                value={cuts[r.id] ?? ""} onChange={(e) => { const c = { ...cuts }; if (e.target.value.trim() === "") delete c[r.id]; else c[r.id] = e.target.value; onCuts(c); }} />
              <button type="button" className="rounded px-1 text-2xs text-info hover:underline" onClick={() => onCuts({ ...cuts, [r.id]: String(Number(r.remaining_qty)) })}>All</button>
            </label>
          ))}
          {rolls.data && rolls.data.length === 0 && <span className="text-xs text-ink-muted">No rolls of this item in this warehouse.</span>}
        </div>
      )}
    </div>
  );
}

export interface AllocRoll { allocation_id: string; unit_id: string; unit_no: string; qty: number; roll_remaining: number; label: string | null }
/** Rolls chosen on sales-order lines that are still to be cut, by allocation (order line × warehouse). */
export function useAllocRolls(allocationIds: (string | null | undefined)[]) {
  const ids = [...new Set(allocationIds.filter((x): x is string => !!x))].sort();
  return useQuery({
    queryKey: ["alloc-rolls", ids],
    enabled: ids.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("alloc_roll_picks", { p_alloc_ids: ids });
      if (error) throw error;
      const m = new Map<string, AllocRoll[]>();
      for (const r of (data ?? []) as AllocRoll[]) m.set(r.allocation_id, [...(m.get(r.allocation_id) ?? []), r]);
      return m;
    },
  });
}

/** "✂ R-00002 × 500 · R-00003 × 200" */
export function AllocRollsNote({ rolls, uom, className }: { rolls: AllocRoll[] | undefined; uom?: string; className?: string }) {
  if (!rolls?.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1 text-2xs text-primary", className)} title="Rolls chosen on the sales order">
      <Scissors className="h-3 w-3" />
      {rolls.map((r) => <span key={r.unit_id} className="rounded bg-primary/10 px-1 font-mono">{r.unit_no} × {fmtQty(Number(r.qty))}{uom ? ` ${uom}` : ""}{r.label ? ` (${r.label})` : ""}</span>)}
    </span>
  );
}
