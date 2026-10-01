import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Plus, Save, ShoppingCart, Trash2 } from "lucide-react";
import { Badge, Button, ErpDialog, Field, FormGrid, Input, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { useUnsavedGuard } from "../lib/unsaved";
import { CustomerPicker, ProductPicker, VariantPicker, useProductMeta } from "../inventory/pickers";
import { money } from "../accounting/common";
import { n, qtyFmt, useItemAvailability, useLastPrice, useWarehouses, type Wh } from "./common";

type Row = Record<string, unknown>;
interface Line { key: string; id: string | null; product_id: string | null; variant_id: string | null; unit_price: string; notes: string; alloc: Record<string, string>; sent: Record<string, number>; held: Record<string, number>; /** quantity to spread over warehouses automatically (from a quotation) */ want?: number }
const newLine = (): Line => ({ key: crypto.randomUUID(), id: null, product_id: null, variant_id: null, unit_price: "", notes: "", alloc: {}, sent: {}, held: {} });
const sentTotal = (l: Line) => Object.values(l.sent).reduce((a, v) => a + v, 0);
export interface SoInitial { header: Row; lines: { id: string | null; want?: number; product_id: string; variant_id: string | null; unit_price: number | null; notes: string | null; allocations: { warehouse_id: string; quantity: number; status: string; delivered_quantity?: number; reserved_quantity?: number }[] }[] }

export function SalesOrderForm({ id, initial, revise = false, quotationId, onCancel, onClose, onSaved }: {
  id: string | null; initial: SoInitial | null; /** editing an approved / part-delivered order */ revise?: boolean; /** converting this quotation */ quotationId?: string; onCancel: () => void; onClose: () => void; onSaved: (id: string) => void;
}) {
  const { companyId, can } = useAccess();
  const canPrices = can(P.salesViewPrices);
  const qc = useQueryClient();
  const whs = useWarehouses();
  const idem = React.useRef(crypto.randomUUID());
  const init = React.useMemo(() => ({
    customer_id: ((initial?.header.customer_id as string | undefined) ?? null) as string | null,
    order_date: (initial?.header.order_date as string) ?? new Date().toISOString().slice(0, 10),
    customer_reference: (initial?.header.customer_reference as string) ?? "",
    notes: (initial?.header.notes as string) ?? "",
    lines: initial?.lines.length
      ? initial.lines.map((l) => ({
          key: l.id ?? crypto.randomUUID(), id: l.id, want: l.want, product_id: l.product_id, variant_id: l.variant_id, unit_price: l.unit_price == null ? "" : String(Number(l.unit_price)), notes: l.notes ?? "",
          alloc: Object.fromEntries(l.allocations.filter((a) => (revise ? a.status !== "CANCELLED" : a.status === "OPEN")).map((a) => [a.warehouse_id, String(Number(a.quantity))])),
          sent: Object.fromEntries(l.allocations.filter((a) => Number(a.delivered_quantity ?? 0) > 0).map((a) => [a.warehouse_id, Number(a.delivered_quantity)])),
          held: Object.fromEntries(l.allocations.filter((a) => Number(a.reserved_quantity ?? 0) > 0).map((a) => [a.warehouse_id, Number(a.reserved_quantity)])),
        }))
      : [newLine()],
  }), [initial, revise]);
  const [f, setF] = React.useState(init);
  const snapshot = React.useRef(JSON.stringify(init));
  const dirty = JSON.stringify(f) !== snapshot.current;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const [showErrors, setShowErrors] = React.useState(false);
  const setLine = (key: string, patch: Partial<Line>) => setF((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const lineTotal = (l: Line) => Object.values(l.alloc).reduce((a, v) => a + (n(v) > 0 ? n(v) : 0), 0);
  const used = f.lines.filter((l) => l.product_id || lineTotal(l) > 0);
  const errors: Record<string, string> = {};
  if (!f.customer_id) errors.customer = "Choose the customer";
  if (!used.length) errors.lines = "Add at least one item";
  for (const l of used) {
    if (!l.product_id) errors[`${l.key}.p`] = "Choose the item";
    else if (lineTotal(l) <= 0) errors[`${l.key}.q`] = "Enter a quantity for at least one warehouse";
    else {
      const under = Object.entries(l.sent).find(([w, q]) => n(l.alloc[w] ?? "0") < q);
      if (under) errors[`${l.key}.q`] = `${qtyFmt(under[1])} already sent from ${whs.data?.find((w) => w.id === under[0])?.code ?? "a warehouse"} — the quantity cannot be less`;
    }
    if (l.unit_price.trim() !== "" && !(n(l.unit_price) >= 0)) errors[`${l.key}.price`] = "Invalid price";
  }
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const total = used.reduce((a, l) => a + (l.unit_price.trim() === "" ? 0 : lineTotal(l) * n(l.unit_price)), 0);
  const pending = used.filter((l) => l.product_id && l.unit_price.trim() === "").length;

  const save = useMutation({
    mutationFn: async (approve: boolean) => {
      const payload = {
        p_header: { company_id: companyId, customer_id: f.customer_id, order_date: f.order_date, customer_reference: f.customer_reference, notes: f.notes },
        p_lines: used.map((l) => ({
          id: l.id, product_id: l.product_id, variant_id: l.variant_id, unit_price: l.unit_price.replace(/,/g, "") || null, notes: l.notes || null,
          allocations: Object.entries(l.alloc).filter(([, v]) => n(v) > 0).map(([warehouse_id, v]) => ({ warehouse_id, quantity: v.replace(/,/g, "") })),
        })),
      };
      if (revise) {
        const r = await sb().rpc("revise_sales_order", { p_id: id, ...payload });
        if (r.error) throw r.error;
        return { nid: id!, approve: false };
      }
      const { data, error } = await sb().rpc("save_sales_order", {
        p_id: id,
        p_header: { company_id: companyId, customer_id: f.customer_id, order_date: f.order_date, customer_reference: f.customer_reference, notes: f.notes },
        p_lines: used.map((l) => ({
          id: l.id, product_id: l.product_id, variant_id: l.variant_id, unit_price: l.unit_price.replace(/,/g, "") || null, notes: l.notes || null,
          allocations: Object.entries(l.alloc).filter(([, v]) => n(v) > 0).map(([warehouse_id, v]) => ({ warehouse_id, quantity: v.replace(/,/g, "") })),
        })),
        p_idempotency_key: id ? null : idem.current,
      });
      if (error) throw error;
      const nid = data as string;
      if (quotationId) {
        const q = await sb().rpc("link_quotation_order", { p_quotation_id: quotationId, p_so_id: nid });
        if (q.error) throw Object.assign(q.error, { savedId: nid });
      }
      if (approve) {
        const r = await sb().rpc("approve_sales_order", { p_id: nid });
        if (r.error) throw Object.assign(r.error, { savedId: nid });
      }
      return { nid, approve };
    },
    onSuccess: ({ nid, approve }) => {
      snapshot.current = JSON.stringify(f); idem.current = crypto.randomUUID();
      toast.success(approve ? "Sales order approved — stock reserved" : revise ? "Order updated — reserved stock adjusted" : "Sales order saved"); qc.invalidateQueries(); onSaved(nid);
    },
    onError: (e: Error & { savedId?: string }) => {
      if (e.savedId) { snapshot.current = JSON.stringify(f); toast.error(`Saved, but not approved: ${friendlyError(e)}`); qc.invalidateQueries(); onSaved(e.savedId); }
      else toast.error(friendlyError(e));
    },
  });
  const submit = (approve: boolean) => {
    setShowErrors(true);
    if (Object.keys(errors).length) { toast.error("Please fix the highlighted fields"); return; }
    if (!save.isPending) save.mutate(approve);
  };

  return (
    <>
      <ErpDialog
        open onRequestClose={() => guard(onClose)} size="xl" icon={<ShoppingCart className="h-4 w-4" />}
        title={id ? `Edit ${String(initial?.header.doc_no ?? "")}` : "New Sales Order"} status={revise ? <Badge tone="info">Approved order</Badge> : <Badge tone="warning">Awaiting approval</Badge>}
        footer={
          <>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1 text-right text-sm">
              {canPrices && <>Total <b className="tabular-nums">{money(total)}</b>{pending > 0 && <span className="ml-1 text-xs text-warning">+ {pending} item{pending > 1 ? "s" : ""} price pending</span>}</>}
            </div>
            <Button onClick={() => guard(onCancel)}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)}>{revise ? "Save changes" : "Save"}</Button>
            {!revise && can(P.salesApprove) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={() => submit(true)}>Save & approve</Button>}
          </>
        }
      >
        <FormGrid cols={4}>
          <Field label="Customer" required error={err("customer")} className="sm:col-span-2"><CustomerPicker value={f.customer_id} onChange={(v) => setF((s) => ({ ...s, customer_id: v }))} /></Field>
          <Field label="Order date" required><Input type="date" value={f.order_date} onChange={(e) => setF((s) => ({ ...s, order_date: e.target.value }))} /></Field>
          <Field label="Customer's PO / reference"><Input value={f.customer_reference} onChange={(e) => setF((s) => ({ ...s, customer_reference: e.target.value }))} /></Field>
        </FormGrid>
        {revise && <p className="mb-2 rounded-control bg-info/10 px-2 py-1.5 text-xs text-info">This order is approved. Saving re-reserves stock for what is still to be sent. Quantities cannot go below what was already dispatched, and dispatched items cannot be removed.</p>}
        <p className="mb-2 text-xs text-ink-muted">Enter how many to send from each warehouse.{canPrices && <> Leave the price empty if it is not agreed yet — it stays <b>Pending</b> (never zero) until invoicing.</>}</p>
        {err("lines") && <p className="mb-2 text-xs text-danger">{err("lines")}</p>}
        <div className="space-y-2">
          {f.lines.map((l, i) => (
            <SoLine key={l.key} idx={i} line={l} customerId={f.customer_id} showPrice={canPrices} warehouses={whs.data ?? []} err={err}
              onChange={(p) => setLine(l.key, p)} onRemove={f.lines.length > 1 && sentTotal(l) === 0 ? () => setF((s) => ({ ...s, lines: s.lines.filter((x) => x.key !== l.key) })) : undefined} />
          ))}
        </div>
        <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setF((s) => ({ ...s, lines: [...s.lines, newLine()] }))}>Add item</Button>
        <Field label="Notes" className="mt-3"><Textarea rows={2} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></Field>
      </ErpDialog>
      {dialog}
    </>
  );
}

function SoLine({ idx, line, customerId, showPrice, warehouses, err, onChange, onRemove }: {
  idx: number; line: Line; showPrice: boolean; customerId: string | null; warehouses: Wh[]; err: (k: string) => string | undefined;
  onChange: (p: Partial<Line>) => void; onRemove?: () => void;
}) {
  const meta = useProductMeta(line.product_id);
  const needsVariant = !!meta.data?.has_variants;
  const avail = useItemAvailability(line.product_id, line.variant_id, { isBundle: meta.data?.is_bundle, needsVariant });
  const last = useLastPrice(customerId, line.product_id, line.variant_id);
  const total = Object.values(line.alloc).reduce((a, v) => a + (n(v) > 0 ? n(v) : 0), 0);
  const ready = !!line.product_id && (!needsVariant || !!line.variant_id);
  const locked = sentTotal(line) > 0;
  // quotation lines: spread the quantity over the warehouses with the most stock
  React.useEffect(() => {
    if (!line.want || Object.keys(line.alloc).length || !avail.data || !warehouses.length) return;
    let left = line.want;
    const out: Record<string, string> = {};
    for (const w of [...warehouses].sort((a, b) => (avail.data!.get(b.id)?.available ?? 0) - (avail.data!.get(a.id)?.available ?? 0))) {
      const take = Math.min(left, Math.max(0, avail.data.get(w.id)?.available ?? 0));
      if (take > 0) { out[w.id] = String(take); left -= take; }
      if (left <= 0) break;
    }
    if (left > 0) { const first = warehouses[0].id; out[first] = String(n(out[first] ?? "0") + left); }
    onChange({ alloc: out, want: undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.want, avail.data, warehouses]);
  return (
    <div className="rounded-card border border-line bg-surface p-2">
      <div className="grid grid-cols-12 items-start gap-2">
        <div className="col-span-12 flex items-center gap-2 md:col-span-5">
          <span className="w-5 shrink-0 text-center text-2xs text-ink-faint">{idx + 1}</span>
          <div className="min-w-0 flex-1">
            <ProductPicker value={line.product_id} disabled={locked} onChange={(v) => onChange({ product_id: v, variant_id: null, alloc: {} })} invalid={!!err(`${line.key}.p`)} />
            {err(`${line.key}.p`) && <p className="mt-0.5 text-2xs text-danger">{err(`${line.key}.p`)}</p>}
          </div>
        </div>
        <div className="col-span-6 md:col-span-3"><VariantPicker productId={line.product_id} value={line.variant_id} disabled={locked} onChange={(v) => onChange({ variant_id: v })} /></div>
        <div className={cn("col-span-5 md:col-span-3", !showPrice && "invisible")}>
          <Input inputMode="decimal" className="text-right tabular-nums" placeholder="Price (pending)" aria-label="Unit price" value={line.unit_price} invalid={!!err(`${line.key}.price`)}
            onChange={(e) => onChange({ unit_price: e.target.value })} />
          {showPrice && last.data && (
            <button type="button" className="mt-0.5 text-2xs text-info hover:underline" onClick={() => onChange({ unit_price: String(Number(last.data!.unit_price)) })}>
              Last charged {money(last.data.unit_price)} ({last.data.doc_no})
            </button>
          )}
        </div>
        <div className="col-span-1 flex justify-end">
          {onRemove && <Button size="icon-sm" variant="ghost" aria-label="Remove item" onClick={onRemove}><Trash2 className="h-3.5 w-3.5 text-ink-faint" /></Button>}
        </div>
      </div>
      {ready && (
        <div className="mt-2 border-t border-dashed border-line pt-2 md:pl-7">
          <div className="flex flex-wrap items-start gap-2">
            {warehouses.map((w) => {
              const raw = avail.data?.get(w.id);
              // stock already held for this order counts as available to it
              const a = raw || line.held[w.id] ? { on_hand: raw?.on_hand ?? 0, reserved: (raw?.reserved ?? 0) - (line.held[w.id] ?? 0), available: (raw?.available ?? 0) + (line.held[w.id] ?? 0) } : undefined;
              const v = line.alloc[w.id] ?? "";
              const over = a && n(v) - (line.sent[w.id] ?? 0) > a.available;
              return (
                <label key={w.id} className={cn("w-[132px] rounded-control border p-1.5", n(v) > 0 ? (over ? "border-danger" : "border-primary") : "border-line")}>
                  <div className="flex items-baseline justify-between text-2xs">
                    <span className="font-mono font-medium">{w.code}</span>
                    <span className={cn("tabular-nums", (a?.available ?? 0) <= 0 ? "text-ink-faint" : "text-ink-muted")} title={a ? `On hand ${qtyFmt(a.on_hand)} · reserved ${qtyFmt(a.reserved)}` : "No stock"}>
                      avail {qtyFmt(a?.available ?? 0)}
                    </span>
                  </div>
                  <Input inputMode="decimal" aria-label={`Quantity from ${w.code}`} className="mt-1 h-control-sm text-right tabular-nums" placeholder="0" value={v}
                    onChange={(e) => onChange({ alloc: { ...line.alloc, [w.id]: e.target.value } })} />
                  {over && <span className="text-2xs text-danger">more than available</span>}
                  {(line.sent[w.id] ?? 0) > 0 && <span className="block text-2xs text-ink-muted">{qtyFmt(line.sent[w.id])} sent</span>}
                </label>
              );
            })}
            <div className="ml-auto self-center text-right">
              <div className="text-2xs uppercase text-ink-muted">Total</div>
              <div className="text-base font-semibold tabular-nums">{qtyFmt(total)} <span className="text-2xs font-normal text-ink-faint">{meta.data?.uom}</span></div>
              {showPrice && line.unit_price.trim() !== "" && total > 0 && <div className="text-xs tabular-nums text-ink-muted">{money(total * n(line.unit_price))}</div>}
            </div>
          </div>
          {meta.data?.is_bundle && <p className="mt-1 text-2xs text-ink-muted">Bundle — availability is worked out from its components; components are taken when dispatched.</p>}
          {err(`${line.key}.q`) && <p className="mt-1 text-2xs text-danger">{err(`${line.key}.q`)}</p>}
        </div>
      )}
    </div>
  );
}
