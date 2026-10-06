import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, CheckCircle2, Plus, Save, Scissors, ShoppingCart, Trash2 } from "lucide-react";
import { Badge, Button, ConfirmDialog, ErpDialog, Field, FormGrid, Input, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { useUnsavedGuard } from "../lib/unsaved";
import { CustomerPicker, ProductPicker, VariantPicker, useProductMeta } from "../inventory/pickers";
import { money } from "../accounting/common";
import { DiscountField, n, qtyFmt, useItemAvailability, useLastPrice, useWarehouses, type Wh } from "./common";
import { PickerChips, staffOf, usePickingStaff } from "../picking/common";
import { ReportShortcuts } from "../reports/Shortcuts";
import { RollCutsEditor, fmtQty, sumCuts, useRolls, type Cuts } from "../inventory/rolls";

type Row = Record<string, unknown>;
interface Line { key: string; id: string | null; product_id: string | null; variant_id: string | null; unit_price: string; notes: string; alloc: Record<string, string>; sent: Record<string, number>; held: Record<string, number>; /** roll items: warehouse → chosen rolls (unit_id → qty); missing/empty = Auto */ rolls?: Record<string, Cuts>; /** quantity to spread over warehouses automatically (from a quotation) */ want?: number }
const newLine = (): Line => ({ key: crypto.randomUUID(), id: null, product_id: null, variant_id: null, unit_price: "", notes: "", alloc: {}, sent: {}, held: {} });
const sentTotal = (l: Line) => Object.values(l.sent).reduce((a, v) => a + v, 0);
export interface SoInitial { header: Row; lines: { id: string | null; want?: number; product_id: string; variant_id: string | null; unit_price: number | null; notes: string | null; allocations: { warehouse_id: string; quantity: number; status: string; delivered_quantity?: number; reserved_quantity?: number; roll_cuts?: { unit_id: string; qty: number }[] | null }[] }[] }

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
    discount: Number(initial?.header.discount_amount ?? 0) ? String(Number(initial?.header.discount_amount)) : "",
    lines: initial?.lines.length
      ? initial.lines.map((l) => ({
          key: l.id ?? crypto.randomUUID(), id: l.id, want: l.want, product_id: l.product_id, variant_id: l.variant_id, unit_price: l.unit_price == null ? "" : String(Number(l.unit_price)), notes: l.notes ?? "",
          alloc: Object.fromEntries(l.allocations.filter((a) => (revise ? a.status !== "CANCELLED" : a.status === "OPEN")).map((a) => [a.warehouse_id, String(Number(a.quantity))])),
          sent: Object.fromEntries(l.allocations.filter((a) => Number(a.delivered_quantity ?? 0) > 0).map((a) => [a.warehouse_id, Number(a.delivered_quantity)])),
          held: Object.fromEntries(l.allocations.filter((a) => Number(a.reserved_quantity ?? 0) > 0).map((a) => [a.warehouse_id, Number(a.reserved_quantity)])),
          rolls: Object.fromEntries(l.allocations.filter((a) => a.status !== "CANCELLED" && a.roll_cuts?.length)
            .map((a) => [a.warehouse_id, Object.fromEntries(a.roll_cuts!.map((c) => [c.unit_id, String(Number(c.qty))]))])),
        }))
      : [newLine()],
  }), [initial, revise]);
  const [f, setF] = React.useState(init);
  const snapshot = React.useRef(JSON.stringify(init));
  const dirty = JSON.stringify(f) !== snapshot.current;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const [showErrors, setShowErrors] = React.useState(false);
  const [pickers, setPickers] = React.useState<Record<string, string[]>>({});
  const staff = usePickingStaff();
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
    for (const [w, c] of Object.entries(l.rolls ?? {})) {
      const cut = sumCuts(c);
      if (cut > 0 && n(l.alloc[w] ?? "0") > 0 && cut > n(l.alloc[w]) + 1e-9) errors[`${l.key}.q`] = `Rolls chosen (${qtyFmt(cut)}) are more than the quantity from ${whs.data?.find((x) => x.id === w)?.code ?? "a warehouse"}`;
    }
    if (l.unit_price.trim() !== "" && !(n(l.unit_price) >= 0)) errors[`${l.key}.price`] = "Invalid price";
  }
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const total = used.reduce((a, l) => a + (l.unit_price.trim() === "" ? 0 : lineTotal(l) * n(l.unit_price)), 0);
  const pending = used.filter((l) => l.product_id && l.unit_price.trim() === "").length;
  const disc = n(f.discount) || 0;
  if (canPrices && f.discount.trim() !== "" && !(n(f.discount) >= 0)) errors.discount = "Invalid discount";
  else if (canPrices && disc > total + 0.001) errors.discount = "Discount is more than the order value";
  const initDisc = n(init.discount) || 0;
  /** the discount is saved separately (needs price access) */
  const saveDiscount = async (sid: string) => {
    if (!canPrices || (disc === initDisc && sid === id)) return;
    const r = await sb().rpc("set_sales_order_discount", { p_id: sid, p_amount: disc });
    if (r.error) throw Object.assign(r.error, { savedId: sid });
  };

  const hadRolls = React.useMemo(() => init.lines.some((l) => Object.keys(l.rolls ?? {}).length > 0), [init]);
  /** chosen rolls are saved after the order (they need the saved line ids) */
  const saveRolls = async (sid: string) => {
    const want = used.filter((l) => Object.values(l.rolls ?? {}).some((c) => sumCuts(c) > 0));
    if (!want.length && !hadRolls) return;
    const { data, error } = await sb().from("sales_order_lines").select("id, product_id, variant_id, line_no").eq("sales_order_id", sid).eq("is_active", true).order("line_no");
    if (error) throw Object.assign(error, { savedId: sid });
    const rows = (data ?? []) as { id: string; product_id: string; variant_id: string | null }[];
    const taken = new Set<string>();
    const idOf = (l: Line) => {
      if (l.id && rows.some((r) => r.id === l.id)) { taken.add(l.id); return l.id; }
      const r = rows.find((x) => !taken.has(x.id) && !used.some((u) => u.id === x.id) && x.product_id === l.product_id && (x.variant_id ?? null) === (l.variant_id ?? null));
      if (r) taken.add(r.id);
      return r?.id ?? null;
    };
    const lineIds = new Map(used.map((l) => [l.key, idOf(l)]));
    const plan = want.flatMap((l) => Object.entries(l.rolls ?? {})
      .filter(([w, c]) => sumCuts(c) > 0 && n(l.alloc[w] ?? "0") > 0 && lineIds.get(l.key))
      .map(([warehouse_id, c]) => ({ line_id: lineIds.get(l.key), warehouse_id,
        cuts: Object.entries(c).filter(([, q]) => n(q) > 0).map(([unit_id, q]) => ({ unit_id, qty: q.replace(/,/g, "") })) })));
    const r = await sb().rpc("set_so_roll_plan", { p_so_id: sid, p_plan: plan });
    if (r.error) throw Object.assign(r.error, { savedId: sid, rollsFailed: true });
  };

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
        await saveDiscount(id!);
        await saveRolls(id!);
        if (approve && sending) {
          const t = await sb().rpc("start_so_picking", { p_so_id: id, p_plan: plan, p_notes: f.notes || null });
          if (t.error) throw Object.assign(t.error, { savedId: id });
          return { nid: id!, approve: false, tasks: (t.data as string[]).length };
        }
        return { nid: id!, approve: false, tasks: 0 };
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
      await saveDiscount(nid);
      await saveRolls(nid);
      if (quotationId) {
        const q = await sb().rpc("link_quotation_order", { p_quotation_id: quotationId, p_so_id: nid });
        if (q.error) throw Object.assign(q.error, { savedId: nid });
      }
      if (approve && sending) {
        const t = await sb().rpc("start_so_picking", { p_so_id: nid, p_plan: plan, p_notes: f.notes || null });
        if (t.error) throw Object.assign(t.error, { savedId: nid });
        return { nid, approve, tasks: (t.data as string[]).length };
      }
      if (approve) {
        const r = await sb().rpc("approve_sales_order", { p_id: nid });
        if (r.error) throw Object.assign(r.error, { savedId: nid });
      }
      return { nid, approve, tasks: 0 };
    },
    onSuccess: ({ nid, approve, tasks }) => {
      snapshot.current = JSON.stringify(f); idem.current = crypto.randomUUID();
      toast.success(tasks ? `${revise ? "Order updated" : "Approved"} — ${tasks} picking task${tasks > 1 ? "s" : ""} sent, pickers' phones are buzzing` : approve ? "Sales order approved — stock reserved" : revise ? "Order updated — reserved stock adjusted" : "Sales order saved"); qc.invalidateQueries(); onSaved(nid);
    },
    onError: (e: Error & { savedId?: string }) => {
      if (e.savedId && (e as { rollsFailed?: boolean }).rollsFailed) { toast.error(`Order saved, but the roll choice was not: ${friendlyError(e)}`); qc.invalidateQueries(); onSaved(e.savedId); }
      else if (e.savedId) { snapshot.current = JSON.stringify(f); toast.error(`Saved, but not ${sending ? "sent to pickers" : "approved"}: ${friendlyError(e)}`); qc.invalidateQueries(); onSaved(e.savedId); }
      else toast.error(friendlyError(e));
    },
  });
  const submit = (approve: boolean) => {
    setShowErrors(true);
    if (Object.keys(errors).length) { toast.error("Please fix the highlighted fields"); return; }
    if (!save.isPending) save.mutate(approve);
  };

  const showPickers = can(P.pickingManage);
  const usedWh = (whs.data ?? []).filter((w) => used.some((l) => n(l.alloc[w.id] ?? "0") > (l.sent[w.id] ?? 0)));
  const plan = Object.fromEntries(usedWh.map((w) => [w.id, pickers[w.id] ?? []]).filter(([, v]) => (v as string[]).length));
  const sending = Object.keys(plan).length > 0;
  const primaryLabel = revise ? (sending ? "Save & send to pickers" : null) : can(P.salesApprove) ? (sending ? "Save, approve & send to pickers" : "Save & approve") : null;
  const qtyTotal = used.reduce((a, l) => a + lineTotal(l), 0);

  return (
    <>
      <ErpDialog
        open onRequestClose={() => guard(onClose)} size="full" accent="order" icon={<ShoppingCart className="h-4 w-4" />}
        headerActions={<ReportShortcuts voucher="SALES_ORDER" context={{ CUSTOMER: f.customer_id }} />}
        title={id ? `Edit ${String(initial?.header.doc_no ?? "")}` : "New Sales Order"} status={revise ? <Badge tone="info">Approved order</Badge> : <Badge tone="warning">Awaiting approval</Badge>}
        subtitle={`${used.length} item${used.length === 1 ? "" : "s"} · ${qtyFmt(qtyTotal)} units`}
        footer={
          <>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1 text-right">
              {canPrices && <span className="mr-4 inline-flex items-start gap-2 text-sm text-ink-muted"><span className="pt-1.5">Discount</span><DiscountField base={total} value={f.discount} onChange={(v) => setF((s) => ({ ...s, discount: v }))} />{err("discount") && <span className="pt-1.5 text-xs text-danger">{err("discount")}</span>}</span>}
              {canPrices && <span className="text-sm text-ink-muted">Order total <b className="ml-1 text-lg tabular-nums text-ink">{money(total - disc)}</b>{pending > 0 && <span className="ml-1 text-xs text-warning">+ {pending} price{pending > 1 ? "s" : ""} pending</span>}</span>}
            </div>
            <Button onClick={() => guard(onCancel)}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)}>{revise ? "Save changes" : "Save draft"}</Button>
            {primaryLabel && <Button variant="primary" icon={sending ? <BellRing className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={() => submit(true)}>{primaryLabel}</Button>}
          </>
        }
      >
        <div className="mx-auto max-w-[1600px] space-y-4">
          <section className="rounded-card border border-line bg-subtle/50 p-3">
            <FormGrid cols={4}>
              <Field label="Customer" required error={err("customer")} className="sm:col-span-2"><CustomerPicker value={f.customer_id} onChange={(v) => setF((s) => ({ ...s, customer_id: v }))} /></Field>
              <Field label="Order date" required><Input type="date" value={f.order_date} onChange={(e) => setF((s) => ({ ...s, order_date: e.target.value }))} /></Field>
              <Field label="Customer's PO / reference"><Input value={f.customer_reference} onChange={(e) => setF((s) => ({ ...s, customer_reference: e.target.value }))} /></Field>
            </FormGrid>
          </section>
          {revise && <p className="rounded-control bg-info/10 px-3 py-2 text-xs text-info">This order is approved. Saving re-reserves stock for what is still to be sent. Quantities cannot go below what was already dispatched, and dispatched items cannot be removed.</p>}
          <section>
            <div className="mb-2 flex items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Items</h3>
                <p className="text-xs text-ink-muted">Quantity to send from each warehouse.{canPrices && <> Leave the price empty if not agreed yet — it stays <b>Pending</b> until invoicing.</>}</p>
              </div>
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setF((s) => ({ ...s, lines: [...s.lines, newLine()] }))}>Add item</Button>
            </div>
            {err("lines") && <p className="mb-2 text-xs text-danger">{err("lines")}</p>}
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="sticky top-0 z-[1]">
                  <tr className="bg-indigo-50/70 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-9 w-10 px-2 text-center">#</th>
                    <th className="min-w-[280px] px-2">Item</th>
                    {(whs.data ?? []).map((w) => <th key={w.id} className="w-[128px] px-2 text-right"><span className="font-mono">{w.code}</span><div className="font-normal normal-case tracking-normal text-ink-faint">{w.name}</div></th>)}
                    <th className="w-[96px] px-2 text-right">Total</th>
                    {canPrices && <><th className="w-[150px] px-2 text-right">Unit price</th><th className="w-[130px] px-2 text-right">Amount</th></>}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {f.lines.map((l, i) => (
                    <SoLine key={l.key} idx={i} line={l} customerId={f.customer_id} showPrice={canPrices} warehouses={whs.data ?? []} err={err}
                      onChange={(p) => setLine(l.key, p)} onRemove={f.lines.length > 1 && sentTotal(l) === 0 ? () => setF((s) => ({ ...s, lines: s.lines.filter((x) => x.key !== l.key) })) : undefined} />
                  ))}
                </tbody>
              </table>
            </div>
            <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setF((s) => ({ ...s, lines: [...s.lines, newLine()] }))}>Add another item</Button>
          </section>
          <div className={cn("grid gap-4", showPickers && "lg:grid-cols-2")}>
            {showPickers && (
              <section className="rounded-card border border-sky-200 bg-sky-50/40 p-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><BellRing className="h-4 w-4 text-sky-600" /> Send to warehouse staff</h3>
                <p className="mb-2 text-xs text-ink-muted">{revise ? "Choose pickers to create picking tasks for what is still to pick." : "Choose pickers and use “Save, approve & send” — the order is approved and their phones buzz straight away."} Leave empty to do it later.</p>
                {usedWh.length === 0 ? <p className="text-xs text-ink-faint">Enter quantities first.</p> : (
                  <div className="space-y-2">
                    {usedWh.map((w) => (
                      <div key={w.id} className="flex flex-wrap items-start gap-3 rounded-control bg-white p-2">
                        <span className="w-16 shrink-0 pt-1 font-mono text-xs font-semibold">{w.code}</span>
                        <div className="min-w-0 flex-1"><PickerChips people={staffOf(staff.data, w.id)} value={pickers[w.id] ?? []} onChange={(v) => setPickers((s) => ({ ...s, [w.id]: v }))} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            <section><Field label="Notes"><Textarea rows={showPickers ? 4 : 2} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></Field></section>
          </div>
        </div>
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
  const td = "border-b border-line/70 px-2 py-1.5 align-top";
  const [rollWh, setRollWh] = React.useState<Wh | null>(null);
  const isRoll = !!meta.data?.rolls && ready;
  return (
    <tr className="group bg-white hover:bg-indigo-50/30">
      <td className={cn(td, "pt-3 text-center text-2xs text-ink-faint")}>{idx + 1}</td>
      <td className={td}>
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1">
            <ProductPicker value={line.product_id} disabled={locked} onChange={(v) => onChange({ product_id: v, variant_id: null, alloc: {} })} invalid={!!err(`${line.key}.p`)} />
          </div>
          {needsVariant && <div className="w-[42%] shrink-0"><VariantPicker productId={line.product_id} value={line.variant_id} disabled={locked} onChange={(v) => onChange({ variant_id: v })} /></div>}
        </div>
        {err(`${line.key}.p`) && <p className="mt-0.5 text-2xs text-danger">{err(`${line.key}.p`)}</p>}
        {meta.data?.is_bundle && <p className="mt-0.5 text-2xs text-ink-muted">Bundle — availability from its components</p>}
        {err(`${line.key}.q`) && <p className="mt-0.5 text-2xs text-danger">{err(`${line.key}.q`)}</p>}
      </td>
      {warehouses.map((w) => {
        const raw = avail.data?.get(w.id);
        // stock already held for this order counts as available to it
        const a = raw || line.held[w.id] ? { on_hand: raw?.on_hand ?? 0, reserved: (raw?.reserved ?? 0) - (line.held[w.id] ?? 0), available: (raw?.available ?? 0) + (line.held[w.id] ?? 0) } : undefined;
        const v = line.alloc[w.id] ?? "";
        const over = a && n(v) - (line.sent[w.id] ?? 0) > a.available;
        return (
          <td key={w.id} className={td}>
            <Input inputMode="decimal" aria-label={`Quantity from ${w.code}`} disabled={!ready} placeholder="0" value={v}
              className={cn("h-control-sm text-right tabular-nums", n(v) > 0 && !over && "border-indigo-300 bg-white", over && "border-danger bg-danger-soft/40")}
              onChange={(e) => onChange({ alloc: { ...line.alloc, [w.id]: e.target.value } })} />
            {ready && (
              <div className={cn("mt-0.5 text-right text-2xs tabular-nums", over ? "text-danger" : (a?.available ?? 0) <= 0 ? "text-ink-faint" : "text-ink-muted")} title={a ? `On hand ${qtyFmt(a.on_hand)} · reserved ${qtyFmt(a.reserved)}` : "No stock"}>
                {over ? "over · " : ""}avail {qtyFmt(a?.available ?? 0)}{(line.sent[w.id] ?? 0) > 0 && <> · {qtyFmt(line.sent[w.id])} sent</>}
              </div>
            )}
            {isRoll && (n(v) > 0 || (a?.available ?? 0) > 0) && (() => {
              const c = line.rolls?.[w.id] ?? {};
              const chosen = Object.values(c).filter((q) => n(q) > 0).length;
              return (
                <button type="button" onClick={() => setRollWh(w)} title="Choose which rolls to cut"
                  className={cn("mt-0.5 flex w-full items-center justify-end gap-1 text-2xs hover:underline", chosen ? "font-medium text-primary" : "text-info")}>
                  <Scissors className="h-3 w-3" />{chosen ? `${chosen} roll${chosen > 1 ? "s" : ""} · ${qtyFmt(sumCuts(c))}` : "Rolls: auto"}
                </button>
              );
            })()}
          </td>
        );
      })}
      <td className={cn(td, "pt-2.5 text-right font-semibold tabular-nums")}>{total > 0 ? qtyFmt(total) : <span className="text-ink-faint">—</span>} <span className="text-2xs font-normal text-ink-faint">{meta.data?.uom}</span></td>
      {showPrice && (
        <td className={td}>
          <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="Pending" aria-label="Unit price" value={line.unit_price} invalid={!!err(`${line.key}.price`)}
            onChange={(e) => onChange({ unit_price: e.target.value })} />
          {last.data && (
            <button type="button" className="mt-0.5 block w-full text-right text-2xs text-info hover:underline" onClick={() => onChange({ unit_price: String(Number(last.data!.unit_price)) })}>
              last {money(last.data.unit_price)}
            </button>
          )}
        </td>
      )}
      {showPrice && <td className={cn(td, "pt-2.5 text-right tabular-nums")}>{line.unit_price.trim() !== "" && total > 0 ? money(total * n(line.unit_price)) : <span className="text-ink-faint">—</span>}</td>}
      <td className={cn(td, "pt-1.5 text-center")}>
        {onRemove && <Button size="icon-sm" variant="ghost" aria-label="Remove item" className="opacity-50 group-hover:opacity-100" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>}
        {rollWh && (
          <RollChoiceDialog wh={rollWh} productId={line.product_id} variantId={line.variant_id} uom={meta.data?.uom ?? ""} qty={n(line.alloc[rollWh.id] ?? "0")}
            sent={line.sent[rollWh.id] ?? 0} value={line.rolls?.[rollWh.id] ?? {}} productName={meta.data?.name ?? ""}
            onDone={(c) => {
              // no quantity typed yet → the quantity becomes what was chosen from the rolls
              const cut = sumCuts(c);
              const q = n(line.alloc[rollWh.id] ?? "0");
              onChange({ rolls: { ...(line.rolls ?? {}), [rollWh.id]: c }, ...(cut > 0 && !(q > 0) ? { alloc: { ...line.alloc, [rollWh.id]: String(cut) } } : {}) });
              setRollWh(null);
            }} onCancel={() => setRollWh(null)} />
        )}
      </td>
    </tr>
  );
}

/** Choose rolls for one warehouse of an order line: Auto (best fit when dispatched) or specific rolls and how much from each. */
function RollChoiceDialog({ wh, productId, variantId, uom, qty, sent, value, productName, onDone, onCancel }: {
  wh: Wh; productId: string | null; variantId: string | null; uom: string; qty: number; sent: number; value: Cuts; productName: string;
  onDone: (c: Cuts) => void; onCancel: () => void;
}) {
  const [mode, setMode] = React.useState<"auto" | "pick">(Object.keys(value).length ? "pick" : "auto");
  const [cuts, setCuts] = React.useState<Cuts>(value);
  const rolls = useRolls(wh.id, productId, variantId);
  const total = sumCuts(cuts);
  const noQty = !(qty > 0);
  const tooMuch = mode === "pick" && !noQty && total > qty + 1e-9;
  return (
    <ConfirmDialog open wide title={`Rolls — ${productName} from ${wh.code}`} confirmLabel="Done"
      message={noQty
        ? `Choose rolls and how much to cut from each — the order quantity from ${wh.code} is filled in from your choice.`
        : `Order quantity from ${wh.code}: ${fmtQty(qty)} ${uom}${sent > 0 ? ` (${fmtQty(sent)} already dispatched)` : ""}. Chosen rolls are cut first when the GDN is dispatched; anything not covered is cut automatically.`}
      onCancel={onCancel}
      onConfirm={() => { if (tooMuch) { toast.error(`Rolls add up to ${fmtQty(total)} — more than ${fmtQty(qty)} ${uom}`); return; } onDone(mode === "auto" ? {} : Object.fromEntries(Object.entries(cuts).filter(([, q]) => n(q) > 0))); }}>
      <div className="mt-3 text-left">
        <RollCutsEditor mode={mode} cuts={cuts} onMode={setMode} onCuts={setCuts} warehouseId={wh.id} productId={productId} variantId={variantId} uom={uom} />
        {mode === "pick" && noQty && <div className="mt-2 text-xs tabular-nums text-ink-muted">{fmtQty(total)} {uom} chosen</div>}
        {mode === "pick" && !noQty && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("tabular-nums", tooMuch ? "text-danger" : total < qty ? "text-ink-muted" : "text-success")}>
              {fmtQty(total)} of {fmtQty(qty)} {uom} chosen{total < qty && total > 0 ? ` — ${fmtQty(qty - total)} will be cut automatically` : ""}
            </span>
            {rolls.data && total < qty && (
              <button type="button" className="text-info hover:underline" onClick={() => {
                // fill the rest from the smallest rolls that are not chosen yet
                let left = qty - total; const c = { ...cuts };
                for (const r of rolls.data!) { if (left <= 0) break; if (c[r.id]) continue; const take = Math.min(left, Number(r.remaining_qty)); c[r.id] = String(take); left -= take; }
                setCuts(c);
              }}>Fill the rest</button>
            )}
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
