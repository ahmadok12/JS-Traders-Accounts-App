/**
 * System stock calculator: choose a calculator (Branch Feeding Line …), enter its inputs (farm length, lines, feed room),
 * and the item quantities are worked out from the rules. Every item, quantity and price can be changed; "Extra" adds
 * spare pieces on top of the rule. The result becomes a PACKAGE on the sales order (customer documents show only
 * "4 lines × price per line"), with the items as normal order lines behind it.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, ErpDialog, Field, Input, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { ProductPicker, VariantPicker, useProductMeta } from "../../inventory/pickers";
import { money } from "../../accounting/common";
import { DiscountField, n, qtyFmt, type Wh } from "../common";
import { evalQty, resolveVars, type CalcVariable } from "./formula";

export interface CalcTemplate { id: string; code: string; name: string; description: string | null; unit_label: string; qty_var: string; variables: CalcVariable[] }
interface TplItem { id: string; line_no: number; product_id: string; variant_id: string | null; formula: string; note: string | null }

/** One item of a package as the sales order form keeps it */
export interface PkgItem { lineKey?: string; product_id: string; variant_id: string | null; calc_qty: number | null; total: number; unit_price: string }
export interface PkgDraft {
  key: string; id: string | null; template_id: string | null; name: string; unit_label: string; quantity: number;
  inputs: Record<string, string | number>; discount: string;
}
export interface CalcResult { pkg: PkgDraft; items: PkgItem[]; warehouseId: string }

interface Row { key: string; lineKey?: string; product_id: string | null; variant_id: string | null; formula: string | null; note: string | null; calc: string | null; extra: string; price: string }

export function useCalcTemplates() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["calc-templates", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("calc_templates").select("id, code, name, description, unit_label, qty_var, variables").eq("company_id", companyId!).eq("is_active", true).order("sort_order").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as CalcTemplate[];
    },
  });
}

function useTemplateItems(templateId: string | null) {
  const { can } = useAccess();
  return useQuery({
    queryKey: ["calc-template-items", templateId],
    enabled: !!templateId,
    queryFn: async () => {
      const [it, pr] = await Promise.all([
        sb().from("calc_template_items").select("id, line_no, product_id, variant_id, formula, note").eq("template_id", templateId!).order("line_no"),
        can(P.salesViewPrices) ? sb().rpc("calc_template_prices", { p_template_id: templateId }) : Promise.resolve({ data: [], error: null }),
      ]);
      if (it.error) throw it.error;
      const prices = new Map(((pr.data ?? []) as { item_id: string; default_price: number | null }[]).map((x) => [x.item_id, x.default_price]));
      return ((it.data ?? []) as TplItem[]).map((x) => ({ ...x, default_price: prices.get(x.id) ?? null }));
    },
  });
}

const fmtIn = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000));

export function CalculatorDialog({ warehouses, initial, onDone, onCancel }: {
  warehouses: Wh[];
  /** editing a package already on the order */
  initial?: { pkg: PkgDraft; items: PkgItem[]; warehouseId: string | null } | null;
  onDone: (r: CalcResult) => void; onCancel: () => void;
}) {
  const { can } = useAccess();
  const canPrices = can(P.salesViewPrices);
  const tpls = useCalcTemplates();
  const [tplId, setTplId] = React.useState<string | null>(initial?.pkg.template_id ?? null);
  React.useEffect(() => { if (!tplId && tpls.data?.length) setTplId(tpls.data[0].id); }, [tpls.data, tplId]);
  const tpl = tpls.data?.find((t) => t.id === tplId) ?? null;
  const items = useTemplateItems(tplId);
  const [inputs, setInputs] = React.useState<Record<string, string | number>>(initial?.pkg.inputs ?? {});
  const [wh, setWh] = React.useState<string>(initial?.warehouseId ?? warehouses[0]?.id ?? "");
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [discount, setDiscount] = React.useState(initial?.pkg.discount ?? "");
  const [remember, setRemember] = React.useState(false);
  const [name, setName] = React.useState(initial?.pkg.name ?? "");

  // fill the rows once the template items arrive (or from the package being edited)
  React.useEffect(() => {
    if (rows || !items.data || !tpl) return;
    if (!name) setName(tpl.name);
    if (initial?.items.length && initial.pkg.template_id === tpl.id) {
      // editing: match items to their rules; a stored quantity that differs from the rule was typed over by hand
      const { vars: v0 } = resolveVars(tpl.variables ?? [], initial.pkg.inputs);
      const unused = [...items.data];
      setRows(initial.items.map((it) => {
        const ix = unused.findIndex((t) => t.product_id === it.product_id);
        const t = ix >= 0 ? unused.splice(ix, 1)[0] : null;
        let ruleQ: number | null = null;
        if (t) { try { ruleQ = evalQty(t.formula, v0); } catch { ruleQ = null; } }
        const base = it.calc_qty ?? it.total;
        return { key: crypto.randomUUID(), lineKey: it.lineKey, product_id: it.product_id, variant_id: it.variant_id, formula: t?.formula ?? null, note: t?.note ?? null,
          calc: t && ruleQ != null && Math.abs(ruleQ - base) < 1e-9 ? null : fmtIn(base),
          extra: it.total !== base ? fmtIn(it.total - base) : "", price: it.unit_price };
      }));
      return;
    }
    setRows(items.data.map((t) => ({ key: crypto.randomUUID(), product_id: t.product_id, variant_id: t.variant_id, formula: t.formula, note: t.note, calc: null, extra: "",
      price: t.default_price == null ? "" : String(Number(t.default_price)) })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data, tpl]);

  const defs = tpl?.variables ?? [];
  const { vars, errors: varErr } = React.useMemo(() => resolveVars(defs, inputs), [defs, inputs]);
  const units = Number(vars[tpl?.qty_var ?? "N"] ?? 0) || 0;
  const computed = (r: Row): { q: number | null; err?: string } => {
    if (!r.formula) return { q: null };
    try { return { q: evalQty(r.formula, vars) }; } catch (e) { return { q: null, err: (e as Error).message }; }
  };
  const calcOf = (r: Row) => (r.calc != null ? n(r.calc) || 0 : computed(r).q ?? 0);
  const totalOf = (r: Row) => Math.max(0, calcOf(r) + (n(r.extra) || 0));
  const setRow = (key: string, p: Partial<Row>) => setRows((s) => (s ?? []).map((r) => (r.key === key ? { ...r, ...p } : r)));

  const live = (rows ?? []).filter((r) => r.product_id && totalOf(r) > 0);
  const subtotal = live.reduce((a, r) => a + (r.price.trim() === "" ? 0 : Math.round(totalOf(r) * n(r.price) * 100) / 100), 0);
  const pendingPrices = live.filter((r) => r.price.trim() === "").length;
  const disc = n(discount) || 0;
  const net = subtotal - disc;
  const perUnit = units > 0 ? net / units : 0;
  const [perUnitText, setPerUnitText] = React.useState<string | null>(null);

  const problems: string[] = [];
  if (!tpl) problems.push("Choose a calculator");
  if (Object.keys(varErr).length) problems.push("Check the inputs");
  if (!(units > 0)) problems.push(`Enter the number of ${tpl?.unit_label ?? "line"}s`);
  if (!wh) problems.push("Choose the warehouse");
  if (!live.length) problems.push("No items with a quantity");
  if ((rows ?? []).some((r) => r.price.trim() !== "" && !(n(r.price) >= 0))) problems.push("A price is not a number");
  if ((rows ?? []).some((r) => r.extra.trim() !== "" && !Number.isFinite(n(r.extra)))) problems.push("An extra quantity is not a number");
  if (canPrices && disc > subtotal + 0.001) problems.push("Discount is more than the items");
  if ((rows ?? []).some((r) => !r.product_id)) problems.push("Choose the item on every row (or remove empty rows)");

  const apply = async () => {
    if (problems.length) { toast.error(problems[0]); return; }
    if (remember && canPrices && tpl) {
      const prices = live.filter((r) => r.price.trim() !== "").map((r) => ({ product_id: r.product_id, variant_id: r.variant_id, price: r.price.replace(/,/g, "") }));
      const res = await sb().rpc("set_calc_template_prices", { p_template_id: tpl.id, p_prices: prices });
      if (res.error) toast.error(`Prices not remembered: ${friendlyError(res.error)}`);
      else if (Number(res.data) > 0) toast.success(`${res.data} default price${Number(res.data) > 1 ? "s" : ""} saved for next time`);
    }
    const inputsOut = Object.fromEntries(defs.filter((d) => !d.formula).map((d) => [d.key, vars[d.key] as string | number]));
    onDone({
      warehouseId: wh,
      pkg: { key: initial?.pkg.key ?? crypto.randomUUID(), id: initial?.pkg.id ?? null, template_id: tpl!.id, name: name.trim() || tpl!.name, unit_label: tpl!.unit_label,
        quantity: units, inputs: inputsOut, discount: canPrices ? (disc ? String(disc) : "") : initial?.pkg.discount ?? "" },
      items: live.map((r) => ({ lineKey: r.lineKey, product_id: r.product_id!, variant_id: r.variant_id, calc_qty: r.formula || r.calc != null ? calcOf(r) : null, total: totalOf(r), unit_price: r.price.trim() })),
    });
  };

  const td = "border-b border-line/70 px-2 py-1.5 align-top";
  return (
    <ErpDialog open onRequestClose={onCancel} size="full" accent="order" icon={<Calculator className="h-4 w-4" />}
      title={initial ? `Edit ${initial.pkg.name}` : "System calculator"}
      subtitle={tpl ? `${tpl.name}${units > 0 ? ` · ${qtyFmt(units)} ${tpl.unit_label}${units === 1 ? "" : "s"}` : ""}` : undefined}
      footer={
        <>
          {canPrices && <Checkbox checked={remember} onChange={setRemember} label="Remember these prices for next time" />}
          <div className="flex-1 text-right text-sm text-ink-muted">
            {canPrices && <>Total <b className="ml-1 text-lg tabular-nums text-ink">{money(net)}</b>{units > 0 && <span className="ml-2">= {money(perUnit)} per {tpl?.unit_label ?? "line"}</span>}{pendingPrices > 0 && <span className="ml-1 text-xs text-warning">+ {pendingPrices} price{pendingPrices > 1 ? "s" : ""} pending</span>}</>}
          </div>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => void apply()}>{initial ? "Update order" : "Add to order"}</Button>
        </>
      }>
      <div className="mx-auto max-w-[1400px] space-y-4">
        {tpls.isLoading ? <Skeleton className="h-20" /> : !tpls.data?.length ? <p className="text-sm text-ink-muted">No calculators are set up yet.</p> : (
          <div className="flex flex-wrap gap-2">
            {tpls.data.map((t) => (
              <button key={t.id} type="button" disabled={!!initial && t.id !== tplId}
                onClick={() => { if (t.id !== tplId) { setTplId(t.id); setRows(null); setName(t.name); setInputs({}); } }}
                className={cn("rounded-card border px-3 py-2 text-left text-sm transition", t.id === tplId ? "border-primary bg-primary/5 font-semibold text-primary" : "border-line hover:border-primary/60 disabled:opacity-40")}>
                {t.name}{t.description && <div className="text-2xs font-normal text-ink-muted">{t.description}</div>}
              </button>
            ))}
          </div>
        )}

        {tpl && (
          <section className="rounded-card border border-line bg-subtle/50 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {defs.filter((d) => !d.formula).map((d) => (
                <Field key={d.key} label={d.label} error={varErr[d.key]} hint={d.hint}>
                  {d.type === "choice" ? (
                    <div className="flex gap-1">
                      {(d.options ?? []).map((o) => {
                        const on = String(vars[d.key]) === o;
                        return <button key={o} type="button" onClick={() => setInputs((s) => ({ ...s, [d.key]: o }))}
                          className={cn("h-control flex-1 rounded-control border text-sm", on ? "border-primary bg-primary text-white" : "border-line bg-white hover:bg-subtle")}>{o}</button>;
                      })}
                    </div>
                  ) : (
                    <Input inputMode="decimal" className="text-right tabular-nums" value={String(inputs[d.key] ?? d.default ?? "")}
                      onChange={(e) => setInputs((s) => ({ ...s, [d.key]: e.target.value }))} />
                  )}
                </Field>
              ))}
              <Field label="Send from warehouse">
                <select className="h-control w-full rounded-control border border-line bg-white px-2 text-sm" value={wh} onChange={(e) => setWh(e.target.value)}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </Field>
              <Field label="Name on invoice"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            </div>
            {defs.some((d) => d.formula) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-muted">
                {defs.filter((d) => d.formula).map((d) => <span key={d.key} className="rounded-control bg-white px-2 py-1">{d.label}: <b className="tabular-nums text-ink">{String(vars[d.key])}</b></span>)}
              </div>
            )}
          </section>
        )}

        {tpl && (items.isLoading || !rows ? <Skeleton className="h-60" /> : (
          <section>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr className="bg-indigo-50/70 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-9 w-10 px-2 text-center">#</th>
                    <th className="min-w-[320px] px-2">Item</th>
                    <th className="w-[130px] px-2 text-right">By rule</th>
                    <th className="w-[100px] px-2 text-right">Extra</th>
                    <th className="w-[100px] px-2 text-right">Total</th>
                    {canPrices && <><th className="w-[130px] px-2 text-right">Unit price</th><th className="w-[130px] px-2 text-right">Amount</th></>}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <CalcRow key={r.key} idx={i} row={r} td={td} canPrices={canPrices} computed={computed(r)} total={totalOf(r)}
                      onChange={(p) => setRow(r.key, p)} onRemove={() => setRows((s) => (s ?? []).filter((x) => x.key !== r.key))} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setRows((s) => [...(s ?? []), { key: crypto.randomUUID(), product_id: null, variant_id: null, formula: null, note: null, calc: "", extra: "", price: "" }])}>Add an item</Button>
              {canPrices && (
                <div className="w-full max-w-[420px] space-y-1.5 rounded-card border border-line p-3 text-sm">
                  <div className="flex justify-between"><span className="text-ink-muted">Items total</span><span className="tabular-nums">{money(subtotal)}</span></div>
                  <div className="flex items-start justify-between gap-2"><span className="pt-1.5 text-ink-muted">Discount</span>
                    <DiscountField base={subtotal} value={discount} onChange={(v) => { setDiscount(v); setPerUnitText(null); }} /></div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">Price per {tpl.unit_label} <span className="text-2xs">(quoted)</span></span>
                    <Input inputMode="decimal" className="h-control-sm w-[150px] text-right tabular-nums" aria-label="Price per line"
                      value={perUnitText ?? (units > 0 && subtotal > 0 ? String(Math.round(perUnit * 100) / 100) : "")}
                      onChange={(e) => {
                        setPerUnitText(e.target.value);
                        const v = n(e.target.value);
                        if (units > 0 && Number.isFinite(v) && e.target.value.trim() !== "") setDiscount(String(Math.max(0, Math.round((subtotal - v * units) * 100) / 100)));
                      }} onBlur={() => setPerUnitText(null)} />
                  </div>
                  <div className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>{qtyFmt(units)} {tpl.unit_label}{units === 1 ? "" : "s"}</span><span className="tabular-nums">{money(net)}</span></div>
                  <p className="text-2xs text-ink-muted">The invoice shows only {name || tpl.name} — {qtyFmt(units)} × {money(perUnit)}. Delivery notes list every item.</p>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </ErpDialog>
  );
}

function CalcRow({ idx, row, td, canPrices, computed, total, onChange, onRemove }: {
  idx: number; row: Row; td: string; canPrices: boolean; computed: { q: number | null; err?: string }; total: number;
  onChange: (p: Partial<Row>) => void; onRemove: () => void;
}) {
  const meta = useProductMeta(row.product_id);
  const needsVariant = !!meta.data?.has_variants;
  const overridden = row.calc != null && row.formula != null;
  const zero = total <= 0;
  return (
    <tr className={cn("group bg-white", zero && "bg-subtle/40 text-ink-faint")}>
      <td className={cn(td, "pt-3 text-center text-2xs text-ink-faint")}>{idx + 1}</td>
      <td className={td}>
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1"><ProductPicker value={row.product_id} onChange={(v) => onChange({ product_id: v, variant_id: null })} invalid={!row.product_id} /></div>
          {needsVariant && <div className="w-[38%] shrink-0"><VariantPicker productId={row.product_id} value={row.variant_id} onChange={(v) => onChange({ variant_id: v })} invalid={!row.variant_id} /></div>}
        </div>
        {row.note && <p className="mt-0.5 text-2xs text-ink-muted">{row.note}</p>}
        {computed.err && <p className="mt-0.5 text-2xs text-danger">Rule “{row.formula}”: {computed.err}</p>}
      </td>
      <td className={td}>
        <div className="flex items-center justify-end gap-1">
          {overridden && <button type="button" title="Back to the rule" className="text-info" onClick={() => onChange({ calc: null })}><RotateCcw className="h-3.5 w-3.5" /></button>}
          <Input inputMode="decimal" className={cn("h-control-sm w-[90px] text-right tabular-nums", overridden && "border-warning")} aria-label="Quantity by rule"
            value={row.calc ?? (computed.q == null ? "" : fmtIn(computed.q))} onChange={(e) => onChange({ calc: e.target.value })} />
        </div>
        {overridden && <div className="mt-0.5 text-right text-2xs text-warning">rule says {computed.q == null ? "—" : qtyFmt(computed.q)}</div>}
      </td>
      <td className={td}><Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0" aria-label="Extra pieces" value={row.extra} onChange={(e) => onChange({ extra: e.target.value })} /></td>
      <td className={cn(td, "pt-2.5 text-right font-semibold tabular-nums")}>{zero ? <span className="font-normal">—</span> : qtyFmt(total)} <span className="text-2xs font-normal text-ink-faint">{meta.data?.uom}</span>
        {meta.data?.rolls && !zero && <div><Badge tone="info">roll</Badge></div>}</td>
      {canPrices && (
        <>
          <td className={td}><Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="Pending" aria-label="Unit price" value={row.price} onChange={(e) => onChange({ price: e.target.value })} /></td>
          <td className={cn(td, "pt-2.5 text-right tabular-nums")}>{row.price.trim() !== "" && total > 0 ? money(total * n(row.price)) : <span className="text-ink-faint">—</span>}</td>
        </>
      )}
      <td className={cn(td, "pt-1.5 text-center")}>
        <Button size="icon-sm" variant="ghost" aria-label="Remove item" className="opacity-50 group-hover:opacity-100" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
      </td>
    </tr>
  );
}
