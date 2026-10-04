import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Download, Scale, ShieldAlert, Tags } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErpDialog, Field, Input, PageHeader, Skeleton, cn } from "@jst/ui";
import { friendlyError, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { money, num, today } from "../accounting/common";
import { qtyFmt } from "../sales/common";
import { SearchBox, StatusFilter } from "./DocPage";
import { rpc, useAction } from "../purchasing/common";

interface VRow { product_id: string; variant_id: string | null; sku: string; product_name: string; variant_name: string | null; uom: string | null; qty: number; pending_qty: number;
  receipt_pending_qty: number; avg_cost: number | null; value: number; last_cost: number | null }
interface Totals { stock_value: number; ledger_value: number; difference: number; items_waiting: number }
const FILTERS = [{ label: "All items" }, { label: "Waiting for cost" }, { label: "Negative / zero" }];
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";

/** what is in stock and what it is worth, at moving average cost */
export function StockValuationPage() {
  const { companyId, can } = useAccess();
  const ok = can(P.inventoryValuation);
  const [q, setQ] = React.useState("");
  const [f, setF] = React.useState(0);
  const [ask, setAsk] = React.useState<null | "align" | "opening">(null);
  const rows = useQuery({ queryKey: ["stock-valuation", companyId], enabled: ok && !!companyId, queryFn: async () => (await rpc<VRow[]>("stock_valuation", { p_company: companyId })) ?? [] });
  const tot = useQuery({ queryKey: ["stock-valuation-totals", companyId], enabled: ok && !!companyId, queryFn: async () => ((await rpc<Totals[]>("stock_valuation_totals", { p_company: companyId })) ?? [])[0] });
  const align = useAction(() => rpc("align_inventory_ledger", { p_company: companyId, p_date: null }), "Inventory account brought in line with the stock value", () => setAsk(null));
  if (!ok) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Stock values need the “see stock values” permission." /></Card>;
  const t = q.trim().toLowerCase();
  const list = (rows.data ?? []).filter((r) => (!t || `${r.product_name} ${r.variant_name ?? ""} ${r.sku}`.toLowerCase().includes(t))
    && (f !== 1 || Number(r.pending_qty) > 0) && (f !== 2 || Number(r.qty) <= 0));
  const waitingOther = (rows.data ?? []).filter((r) => Number(r.pending_qty) - Number(r.receipt_pending_qty) > 0.0001);
  const exportCsv = () => {
    const head = ["SKU", "Item", "Variant", "Qty", "Unit", "Waiting for cost", "Average cost", "Value"];
    const body = list.map((r) => [r.sku, r.product_name, r.variant_name ?? "", r.qty, r.uom ?? "", r.pending_qty, r.avg_cost ?? "", r.value]);
    const csv = [head, ...body].map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `stock-value-${today()}.csv`; a.click();
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Stock Value" icon={<Coins className="h-4 w-4" />}
        description="Every item at its moving average cost (purchase cost + landed cost). Goods leave at the average cost — that is the cost of goods sold on each GDN. Goods whose purchase cost is not known yet are counted but not valued until their cost is approved or billed."
        actions={<>
          <Button icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export</Button>
          {waitingOther.length > 0 && can("journals.create") && <Button icon={<Tags className="h-4 w-4" />} onClick={() => setAsk("opening")}>Set opening stock cost</Button>}
        </>} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile k="Stock value" v={tot.data ? `PKR ${money(tot.data.stock_value)}` : "…"} />
        <Tile k="Inventory account" v={tot.data ? `PKR ${money(tot.data.ledger_value)}` : "…"} />
        <div className={cn("rounded-card border px-3 py-2", tot.data && Math.abs(Number(tot.data.difference)) > 0.009 ? "border-amber-300 bg-amber-50/60" : "border-line")}>
          <div className="text-2xs uppercase tracking-wide text-ink-muted">Difference</div>
          <div className="flex items-center gap-2"><span className="text-lg font-semibold tabular-nums">{tot.data ? money(tot.data.difference) : "…"}</span>
            {tot.data && Math.abs(Number(tot.data.difference)) > 0.009 && can("journals.create") && <Button size="sm" variant="ghost" icon={<Scale className="h-3.5 w-3.5" />} onClick={() => setAsk("align")}>Bring in line</Button>}</div>
        </div>
        <Tile k="Items waiting for a cost" v={tot.data ? String(tot.data.items_waiting) : "…"} hot={!!tot.data && tot.data.items_waiting > 0} />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={setQ} placeholder="Search item / SKU…" />
          <StatusFilter items={FILTERS} value={f} onChange={setF} />
          <span className="ml-auto text-sm text-ink-muted">{list.length} items · <b className="tabular-nums text-ink">PKR {money(list.reduce((a, r) => a + Number(r.value), 0))}</b></span>
        </div>
        {rows.error ? <p className="p-4 text-sm text-danger">{friendlyError(rows.error)}</p> : rows.isLoading ? <Skeleton className="m-3 h-40" /> : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="sticky top-0 bg-subtle"><tr><th className={th}>Item</th><th className={cn(th, "w-28 text-right")}>On hand</th><th className={cn(th, "w-36 text-right")}>Waiting for cost</th>
                <th className={cn(th, "w-32 text-right")}>Average cost</th><th className={cn(th, "w-36 text-right")}>Value (PKR)</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={`${r.product_id}:${r.variant_id ?? ""}`} className="hover:bg-subtle/50">
                  <td className={td}><div className="font-medium">{r.product_name}{r.variant_name ? <span className="font-normal text-ink-muted"> · {r.variant_name}</span> : null}</div><div className="text-2xs text-ink-muted">{r.sku}</div></td>
                  <td className={cn(td, "text-right tabular-nums", Number(r.qty) < 0 && "text-danger")}>{qtyFmt(r.qty)} <span className="text-2xs text-ink-muted">{r.uom}</span></td>
                  <td className={cn(td, "text-right tabular-nums")}>{Number(r.pending_qty) > 0 ? <span title={Number(r.receipt_pending_qty) > 0 ? `${qtyFmt(r.receipt_pending_qty)} on receipts waiting for cost approval / bill` : "Opening or found stock without a cost"}>
                    <Badge tone="warning">{qtyFmt(r.pending_qty)}</Badge></span> : <span className="text-ink-faint">—</span>}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{r.avg_cost == null ? <span className="text-ink-faint">—</span> : money(r.avg_cost)}</td>
                  <td className={cn(td, "text-right font-medium tabular-nums")}>{money(r.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <ConfirmDialog open={ask === "align"} title="Bring the Inventory account in line?" loading={align.isPending} confirmLabel="Post adjustment" onCancel={() => setAsk(null)} onConfirm={() => align.mutate(undefined)}
        message={`Posts PKR ${money(Math.abs(Number(tot.data?.difference ?? 0)))} between Inventory and Inventory Adjustments so the account equals the stock value. Do this once when starting stock valuation; after that they stay together by themselves.`} />
      {ask === "opening" && <OpeningCostDialog rows={waitingOther} onClose={() => setAsk(null)} />}
    </div>
  );
}

function Tile({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return <div className={cn("rounded-card border border-line px-3 py-2", hot && "border-amber-300 bg-amber-50/60")}><div className="text-2xs uppercase tracking-wide text-ink-muted">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>;
}

function OpeningCostDialog({ rows, onClose }: { rows: VRow[]; onClose: () => void }) {
  const { companyId } = useAccess();
  const [date, setDate] = React.useState(today());
  const [cost, setCost] = React.useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [`${r.product_id}:${r.variant_id ?? ""}`, r.last_cost == null ? "" : String(Math.round(Number(r.last_cost) * 100) / 100)])));
  const go = useAction(() => rpc("set_opening_stock_cost", { p_company: companyId, p_date: date, p_note: null,
    p_lines: rows.map((r) => ({ product_id: r.product_id, variant_id: r.variant_id, unit_cost: cost[`${r.product_id}:${r.variant_id ?? ""}`]?.trim() ? num(cost[`${r.product_id}:${r.variant_id ?? ""}`]) : null })) }),
    "Opening stock valued", onClose);
  const total = rows.reduce((a, r) => a + (Number(r.pending_qty) - Number(r.receipt_pending_qty)) * (num(cost[`${r.product_id}:${r.variant_id ?? ""}`] ?? "") || 0), 0);
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<Tags className="h-4 w-4" />} title="Opening stock cost"
      footer={<><div className="flex-1 text-sm text-ink-muted">Total <b className="tabular-nums text-ink">PKR {money(total)}</b></div><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={go.isPending} disabled={total <= 0} onClick={() => go.mutate(undefined)}>Value the stock</Button></>}>
      <p className="mb-3 text-sm text-ink-2">Stock that came in as opening balance (or was found) has no purchase cost. Enter what each unit cost you — the value goes to Inventory against Opening Balance Equity. Goods on receipts still waiting for cost approval are not here; approve their cost in Purchase Costs.</p>
      <Field label="Date" className="mb-3 w-48"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="max-h-[50vh] overflow-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-subtle"><tr><th className={th}>Item</th><th className={cn(th, "w-32 text-right")}>Without cost</th><th className={cn(th, "w-36 text-right")}>Unit cost (PKR)</th><th className={cn(th, "w-32 text-right")}>Value</th></tr></thead>
          <tbody>{rows.map((r) => {
            const k = `${r.product_id}:${r.variant_id ?? ""}`;
            const qn = Number(r.pending_qty) - Number(r.receipt_pending_qty);
            return (
              <tr key={k}><td className={td}>{r.product_name}{r.variant_name ? <span className="text-ink-muted"> · {r.variant_name}</span> : null}</td>
                <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(qn)} <span className="text-2xs text-ink-muted">{r.uom}</span></td>
                <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={cost[k] ?? ""} onChange={(e) => setCost((x) => ({ ...x, [k]: e.target.value }))} /></td>
                <td className={cn(td, "text-right tabular-nums")}>{money(qn * (num(cost[k] ?? "") || 0))}</td></tr>
            );
          })}</tbody>
        </table>
      </div>
    </ErpDialog>
  );
}
