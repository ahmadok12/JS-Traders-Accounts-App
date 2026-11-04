/**
 * Settings → Calculators: the system stock calculators used on sales orders and quotations.
 * Each calculator has inputs (typed, chosen, or worked out from other inputs) and items, each with a rule
 * (formula) for its quantity and an optional default price. A live preview runs every rule with the default inputs,
 * so a wrong rule shows up before saving.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Calculator, Plus, Save, Trash2 } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { useUnsavedGuard } from "../lib/unsaved";
import { ProductPicker, VariantPicker, useProductMeta } from "../inventory/pickers";
import { money } from "../accounting/common";
import { n, qtyFmt } from "../sales/common";
import { evalQty, resolveVars, type CalcVariable } from "../sales/calc/formula";

interface Tpl { id: string; code: string; name: string; description: string | null; unit_label: string; qty_var: string; variables: CalcVariable[]; sort_order: number; is_active: boolean }
type Kind = "number" | "choice" | "formula";
interface VarRow { key: string; rid: string; code: string; label: string; kind: Kind; def: string; options: string; formula: string; unit: string; hint: string; short?: string }
interface ItemRow { rid: string; product_id: string | null; variant_id: string | null; formula: string; note: string; price: string }
interface Draft { name: string; description: string; unit_label: string; qty_var: string; sort_order: string; is_active: boolean; vars: VarRow[]; items: ItemRow[] }

const rid = () => crypto.randomUUID();
const toVarRow = (v: CalcVariable): VarRow => ({
  key: v.key, rid: rid(), code: v.key, label: v.label, kind: v.formula ? "formula" : v.type === "choice" ? "choice" : "number",
  def: v.default == null ? "" : String(v.default), options: (v.options ?? []).join(", "), formula: v.formula ?? "", unit: v.unit ?? "", hint: v.hint ?? "", short: v.short,
});
const toVariable = (r: VarRow): CalcVariable => {
  const base: CalcVariable = { key: r.code.trim(), label: r.label.trim() || r.code.trim() };
  if (r.unit.trim()) base.unit = r.unit.trim();
  if (r.hint.trim()) base.hint = r.hint.trim();
  if (r.short) base.short = r.short;
  if (r.kind === "formula") return { ...base, formula: r.formula.trim() };
  if (r.kind === "choice") {
    const opts = r.options.split(",").map((s) => s.trim()).filter(Boolean);
    return { ...base, type: "choice", options: opts, default: r.def.trim() || opts[0] || "" };
  }
  const d = n(r.def);
  return { ...base, type: "number", default: Number.isFinite(d) && r.def.trim() !== "" ? d : 0, step: 1 };
};

const NEW_DRAFT = (): Draft => ({
  name: "", description: "", unit_label: "line", qty_var: "N", sort_order: "10", is_active: true,
  vars: [toVarRow({ key: "L", label: "Farm length (ft)", type: "number", default: 430, unit: "ft", short: "Length" }),
         toVarRow({ key: "W", label: "Farm width (ft)", type: "number", default: 50, unit: "ft", short: "Width" }),
         toVarRow({ key: "N", label: "No. of lines", type: "number", default: 1, short: "Lines" })],
  items: [{ rid: rid(), product_id: null, variant_id: null, formula: "N", note: "1 per line", price: "" }],
});

export function CalculatorSettings() {
  const { companyId, can } = useAccess();
  const canEdit = can("settings.manage");
  const list = useQuery({
    queryKey: ["calc-templates-all", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("calc_templates").select("id, code, name, description, unit_label, qty_var, variables, sort_order, is_active").eq("company_id", companyId!).order("sort_order").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Tpl[];
    },
  });
  const [sel, setSel] = React.useState<string | "new" | null>(null);
  React.useEffect(() => { if (sel == null && list.data?.length) setSel(list.data[0].id); }, [list.data, sel]);
  const tpl = list.data?.find((t) => t.id === sel) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit p-2">
        <div className="mb-1 px-2 pt-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Calculators</div>
        {list.isLoading ? <Skeleton className="h-24" /> : (
          <div className="space-y-1">
            {(list.data ?? []).map((t) => (
              <button key={t.id} type="button" onClick={() => setSel(t.id)}
                className={cn("w-full rounded-control px-2 py-1.5 text-left text-sm", sel === t.id ? "bg-primary/10 font-semibold text-primary" : "hover:bg-subtle")}>
                {t.name} {!t.is_active && <Badge tone="neutral">off</Badge>}
              </button>
            ))}
          </div>
        )}
        {canEdit && <Button size="sm" variant="ghost" className="mt-2 w-full" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSel("new")}>New calculator</Button>}
      </Card>
      {sel === "new" ? <CalcEditor key="new" tpl={null} canEdit={canEdit} onSaved={(id) => setSel(id)} />
        : tpl ? <CalcEditor key={tpl.id} tpl={tpl} canEdit={canEdit} onSaved={(id) => setSel(id)} />
        : <Card><EmptyState icon={<Calculator className="h-6 w-6" />} title="No calculator chosen" /></Card>}
    </div>
  );
}

function CalcEditor({ tpl, canEdit, onSaved }: { tpl: Tpl | null; canEdit: boolean; onSaved: (id: string) => void }) {
  const { companyId, can } = useAccess();
  const canPrices = can(P.salesViewPrices);
  const qc = useQueryClient();
  const items = useQuery({
    queryKey: ["calc-template-items-edit", tpl?.id],
    enabled: !!tpl,
    queryFn: async () => {
      const [it, pr] = await Promise.all([
        sb().from("calc_template_items").select("id, line_no, product_id, variant_id, formula, note").eq("template_id", tpl!.id).order("line_no"),
        canPrices ? sb().rpc("calc_template_prices", { p_template_id: tpl!.id }) : Promise.resolve({ data: [], error: null }),
      ]);
      if (it.error) throw it.error;
      const pm = new Map(((pr.data ?? []) as { item_id: string; default_price: number | null }[]).map((x) => [x.item_id, x.default_price]));
      return ((it.data ?? []) as { id: string; product_id: string; variant_id: string | null; formula: string; note: string | null }[])
        .map((x): ItemRow => ({ rid: x.id, product_id: x.product_id, variant_id: x.variant_id, formula: x.formula, note: x.note ?? "", price: pm.get(x.id) == null ? "" : String(Number(pm.get(x.id))) }));
    },
  });
  const [d, setD] = React.useState<Draft | null>(tpl ? null : NEW_DRAFT());
  const [snap, setSnap] = React.useState<string>(tpl ? "" : JSON.stringify(NEW_DRAFT()));
  React.useEffect(() => {
    if (!tpl || !items.data || d) return;
    const init: Draft = { name: tpl.name, description: tpl.description ?? "", unit_label: tpl.unit_label, qty_var: tpl.qty_var, sort_order: String(tpl.sort_order), is_active: tpl.is_active,
      vars: (tpl.variables ?? []).map(toVarRow), items: items.data };
    setD(init); setSnap(JSON.stringify(init));
  }, [tpl, items.data, d]);
  const dirty = !!d && JSON.stringify(d) !== snap;
  const { dialog } = useUnsavedGuard(dirty);

  // live check: every input rule and item rule, with the default inputs
  const check = React.useMemo(() => {
    if (!d) return null;
    const defs = d.vars.map(toVariable);
    const errors: string[] = [];
    const codes = d.vars.map((v) => v.code.trim());
    codes.forEach((c, i) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) errors.push(`Input ${i + 1}: code "${c}" — letters, digits and _ only`);
      else if (codes.indexOf(c) !== i) errors.push(`Input code ${c} is used twice`);
    });
    if (!codes.includes(d.qty_var)) errors.push("Choose which input is the number of lines");
    const { vars, errors: ve } = resolveVars(defs, {});
    for (const [k, e] of Object.entries(ve)) errors.push(`Input ${k}: ${e}`);
    const qty = d.items.map((it, i) => {
      if (!it.formula.trim()) { errors.push(`Item ${i + 1}: enter the rule`); return { q: null as number | null, err: "enter the rule" }; }
      try { return { q: evalQty(it.formula, vars), err: null as string | null }; } catch (e) { errors.push(`Item ${i + 1}: ${(e as Error).message}`); return { q: null, err: (e as Error).message }; }
    });
    d.items.forEach((it, i) => { if (!it.product_id) errors.push(`Item ${i + 1}: choose the product`); });
    if (!d.name.trim()) errors.push("Enter the calculator name");
    if (!d.items.length) errors.push("Add at least one item");
    return { vars, qty, errors, defs };
  }, [d]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("save_calc_template", {
        p_id: tpl?.id ?? null,
        p_header: { company_id: companyId, code: tpl?.code ?? d!.name, name: d!.name, description: d!.description, unit_label: d!.unit_label, qty_var: d!.qty_var,
          sort_order: d!.sort_order, is_active: d!.is_active, variables: check!.defs },
        p_items: d!.items.map((it) => ({ product_id: it.product_id, variant_id: it.variant_id, formula: it.formula, note: it.note, default_price: it.price.replace(/,/g, "") || null })),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { setSnap(JSON.stringify(d)); toast.success("Calculator saved — the sales order and quotation calculators use it now"); qc.invalidateQueries(); onSaved(id); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!d || !check) return <Card className="p-4"><Skeleton className="h-60" /></Card>;
  const setVar = (r: string, p: Partial<VarRow>) => setD((s) => s && ({ ...s, vars: s.vars.map((v) => (v.rid === r ? { ...v, ...p } : v)) }));
  const setItem = (r: string, p: Partial<ItemRow>) => setD((s) => s && ({ ...s, items: s.items.map((v) => (v.rid === r ? { ...v, ...p } : v)) }));
  const move = (i: number, by: number) => setD((s) => {
    if (!s) return s; const a = [...s.items]; const j = i + by; if (j < 0 || j >= a.length) return s; [a[i], a[j]] = [a[j], a[i]]; return { ...s, items: a };
  });
  const td = "border-b border-line/70 px-2 py-1.5 align-top";
  const ro = !canEdit;

  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Name (printed on invoice)" required className="lg:col-span-2"><Input value={d.name} disabled={ro} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Customer buys per"><Input value={d.unit_label} disabled={ro} onChange={(e) => setD({ ...d, unit_label: e.target.value })} /></Field>
        <Field label="Order in the list"><Input inputMode="numeric" value={d.sort_order} disabled={ro} onChange={(e) => setD({ ...d, sort_order: e.target.value })} /></Field>
        <Field label="Status"><div className="pt-1.5"><Checkbox checked={d.is_active} disabled={ro} onChange={(v) => setD({ ...d, is_active: v })} label="In use" /></div></Field>
        <Field label="Description" className="sm:col-span-2 lg:col-span-5"><Input value={d.description} disabled={ro} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
      </div>

      <section>
        <div className="mb-1 flex items-end justify-between">
          <div>
            <h3 className="text-sm font-semibold">Inputs</h3>
            <p className="text-xs text-ink-muted">Typed (a number), chosen (from options) or worked out (a rule using other inputs). The code is what rules use, e.g. <code>L</code>, <code>N</code>, <code>ROOM</code>.</p>
          </div>
          <Field label="Number of lines is" className="w-48">
            <select className="h-control rounded-control border border-line bg-white px-2 text-sm" disabled={ro} value={d.qty_var} onChange={(e) => setD({ ...d, qty_var: e.target.value })}>
              {d.vars.filter((v) => v.kind === "number").map((v) => <option key={v.rid} value={v.code}>{v.code} — {v.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-8 w-[90px] px-2">Code</th><th className="px-2">Label</th><th className="w-[120px] px-2">Kind</th>
              <th className="w-[220px] px-2">Default / options / rule</th><th className="w-[70px] px-2">Unit</th><th className="px-2">Hint</th><th className="w-[90px] px-2 text-right">Now</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {d.vars.map((v) => (
                <tr key={v.rid}>
                  <td className={td}><Input className="h-control-sm font-mono" value={v.code} disabled={ro} onChange={(e) => setVar(v.rid, { code: e.target.value.replace(/\s/g, "") })} /></td>
                  <td className={td}><Input className="h-control-sm" value={v.label} disabled={ro} onChange={(e) => setVar(v.rid, { label: e.target.value })} /></td>
                  <td className={td}>
                    <select className="h-control-sm w-full rounded-control border border-line bg-white px-1 text-sm" disabled={ro} value={v.kind} onChange={(e) => setVar(v.rid, { kind: e.target.value as Kind })}>
                      <option value="number">Typed number</option><option value="choice">Choice</option><option value="formula">Worked out</option>
                    </select>
                  </td>
                  <td className={td}>
                    {v.kind === "formula" ? <Input className="h-control-sm font-mono" placeholder="ceil(L/8)" value={v.formula} disabled={ro} onChange={(e) => setVar(v.rid, { formula: e.target.value })} />
                      : v.kind === "choice" ? (
                        <div className="space-y-1">
                          <Input className="h-control-sm" placeholder="Side, Centre" value={v.options} disabled={ro} onChange={(e) => setVar(v.rid, { options: e.target.value })} />
                          <Input className="h-control-sm" placeholder="default (first option)" value={v.def} disabled={ro} onChange={(e) => setVar(v.rid, { def: e.target.value })} />
                        </div>
                      ) : <Input className="h-control-sm text-right tabular-nums" placeholder="default" value={v.def} disabled={ro} onChange={(e) => setVar(v.rid, { def: e.target.value })} />}
                  </td>
                  <td className={td}><Input className="h-control-sm" value={v.unit} disabled={ro} onChange={(e) => setVar(v.rid, { unit: e.target.value })} /></td>
                  <td className={td}><Input className="h-control-sm" value={v.hint} disabled={ro} onChange={(e) => setVar(v.rid, { hint: e.target.value })} /></td>
                  <td className={cn(td, "pt-2.5 text-right font-mono text-xs")}>{String(check.vars[v.code.trim()] ?? "—")}</td>
                  <td className={cn(td, "text-center")}>{!ro && <Button size="icon-sm" variant="ghost" aria-label="Remove input" onClick={() => setD({ ...d, vars: d.vars.filter((x) => x.rid !== v.rid) })}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ro && <Button size="sm" variant="ghost" className="mt-1" icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setD({ ...d, vars: [...d.vars, { key: "", rid: rid(), code: `X${d.vars.length + 1}`, label: "", kind: "number", def: "", options: "", formula: "", unit: "", hint: "" }] })}>Add input</Button>}
      </section>

      <section>
        <h3 className="text-sm font-semibold">Items and rules</h3>
        <p className="mb-1 text-xs text-ink-muted">
          Rules use the input codes with <code>+ − * /</code>, brackets, <code>ceil()</code> (round up), <code>floor()</code>, <code>round()</code>, <code>min()</code>, <code>max()</code> and
          {" "}<code>ROOM=='Centre' ? 2 : 1</code> (if … then … else). “Preview” runs the rule with the default inputs.
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-8 w-16 px-2" /><th className="min-w-[300px] px-2">Item</th><th className="w-[220px] px-2">Rule</th><th className="px-2">Rule in words</th>
              {canPrices && <th className="w-[120px] px-2 text-right">Default price</th>}<th className="w-[110px] px-2 text-right">Preview</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {d.items.map((it, i) => (
                <ItemEditRow key={it.rid} idx={i} row={it} td={td} ro={ro} canPrices={canPrices} preview={check.qty[i]} onChange={(p) => setItem(it.rid, p)}
                  onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => setD({ ...d, items: d.items.filter((x) => x.rid !== it.rid) })} />
              ))}
            </tbody>
          </table>
        </div>
        {!ro && <Button size="sm" variant="ghost" className="mt-1" icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setD({ ...d, items: [...d.items, { rid: rid(), product_id: null, variant_id: null, formula: "", note: "", price: "" }] })}>Add item</Button>}
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
        {check.errors.length > 0 && <p className="mr-auto text-xs text-danger">{check.errors[0]}{check.errors.length > 1 ? ` (+${check.errors.length - 1} more)` : ""}</p>}
        {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
        {canEdit && <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} disabled={!dirty && !!tpl}
          onClick={() => (check.errors.length ? toast.error(check.errors[0]) : save.mutate())}>Save calculator</Button>}
      </div>
      {dialog}
    </Card>
  );
}

function ItemEditRow({ idx, row, td, ro, canPrices, preview, onChange, onUp, onDown, onRemove }: {
  idx: number; row: ItemRow; td: string; ro: boolean; canPrices: boolean; preview: { q: number | null; err: string | null };
  onChange: (p: Partial<ItemRow>) => void; onUp: () => void; onDown: () => void; onRemove: () => void;
}) {
  const meta = useProductMeta(row.product_id);
  return (
    <tr className="group">
      <td className={cn(td, "whitespace-nowrap text-2xs text-ink-faint")}>
        <span className="mr-1">{idx + 1}</span>
        {!ro && <><button type="button" aria-label="Move up" onClick={onUp}><ArrowUp className="inline h-3 w-3" /></button><button type="button" aria-label="Move down" onClick={onDown}><ArrowDown className="inline h-3 w-3" /></button></>}
      </td>
      <td className={td}>
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1"><ProductPicker value={row.product_id} disabled={ro} onChange={(v) => onChange({ product_id: v, variant_id: null })} invalid={!row.product_id} /></div>
          {meta.data?.has_variants && <div className="w-[38%] shrink-0"><VariantPicker productId={row.product_id} value={row.variant_id} disabled={ro} onChange={(v) => onChange({ variant_id: v })} /></div>}
        </div>
      </td>
      <td className={td}><Input className={cn("h-control-sm font-mono", preview.err && "border-danger")} value={row.formula} disabled={ro} onChange={(e) => onChange({ formula: e.target.value })} />
        {preview.err && <p className="mt-0.5 text-2xs text-danger">{preview.err}</p>}</td>
      <td className={td}><Input className="h-control-sm" value={row.note} disabled={ro} onChange={(e) => onChange({ note: e.target.value })} /></td>
      {canPrices && <td className={td}><Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="—" value={row.price} disabled={ro} onChange={(e) => onChange({ price: e.target.value })} />
        {row.price.trim() !== "" && preview.q != null && <div className="mt-0.5 text-right text-2xs text-ink-muted">{money(preview.q * n(row.price))}</div>}</td>}
      <td className={cn(td, "pt-2.5 text-right font-semibold tabular-nums")}>{preview.q == null ? "—" : qtyFmt(preview.q)} <span className="text-2xs font-normal text-ink-faint">{meta.data?.uom}</span></td>
      <td className={cn(td, "text-center")}>{!ro && <Button size="icon-sm" variant="ghost" aria-label="Remove item" className="opacity-50 group-hover:opacity-100" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
    </tr>
  );
}
