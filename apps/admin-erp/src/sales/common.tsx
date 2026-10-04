import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { formatNumber } from "@jst/utilities";

export const qtyFmt = (v: unknown) => formatNumber(Number(v), Number.isInteger(Number(v)) ? 0 : 2);
export const n = (s: string | number | null | undefined) => Number(String(s ?? "").replace(/,/g, ""));

export interface Wh { id: string; code: string; name: string }
/** Active warehouses — the sales order quantity fields are generated from this list (§9.2, no fixed columns). */
export function useWarehouses() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["warehouses-active", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("warehouses").select("id, code, name").eq("company_id", companyId!).eq("is_active", true).order("code");
      if (error) throw error;
      return (data ?? []) as Wh[];
    },
  });
}

export interface Avail { on_hand: number; reserved: number; available: number }
/** Stock per warehouse for one item: on hand, reserved, available to allocate. Bundles: buildable from components. */
export function useItemAvailability(productId: string | null, variantId: string | null, opts: { isBundle?: boolean; needsVariant?: boolean } = {}) {
  return useQuery({
    queryKey: ["item-availability", productId, variantId, opts.isBundle],
    enabled: !!productId && !(opts.needsVariant && !variantId),
    staleTime: 5_000,
    queryFn: async () => {
      const m = new Map<string, Avail>();
      if (opts.isBundle) {
        const { data, error } = await sb().rpc("product_buildable", { p_product_id: productId, p_variant_id: variantId });
        if (error) throw error;
        for (const r of (data ?? []) as { warehouse_id: string; buildable: number }[]) m.set(r.warehouse_id, { on_hand: Number(r.buildable), reserved: 0, available: Number(r.buildable) });
        return m;
      }
      let q = sb().from("stock_on_hand").select("warehouse_id, on_hand, reserved, available").eq("product_id", productId!);
      q = variantId ? q.eq("variant_id", variantId) : q.is("variant_id", null);
      const { data, error } = await q;
      if (error) throw error;
      for (const r of data ?? []) m.set(r.warehouse_id as string, { on_hand: Number(r.on_hand), reserved: Number(r.reserved), available: Number(r.available) });
      return m;
    },
  });
}

/** Last price charged to this customer for this item (a suggestion, §9.5). */
export function useLastPrice(customerId: string | null, productId: string | null, variantId: string | null) {
  return useQuery({
    queryKey: ["last-price", customerId, productId, variantId],
    enabled: !!customerId && !!productId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("last_sale_price", { p_customer_id: customerId, p_product_id: productId, p_variant_id: variantId });
      if (error) throw error;
      return ((data ?? []) as { unit_price: number; invoice_date: string; doc_no: string }[])[0] ?? null;
    },
  });
}

export const SO_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "warning", APPROVED: "info", PARTIALLY_DELIVERED: "info", DELIVERED: "success", CLOSED: "neutral", CANCELLED: "neutral",
};
export const soLabel = (s: string) => (s === "DRAFT" ? "Awaiting approval" : s === "PARTIALLY_DELIVERED" ? "Part delivered" : s.charAt(0) + s.slice(1).toLowerCase());

/**
 * Selling prices are hidden from warehouse roles (§3.3): SO / GDN line prices are not readable
 * from the tables; these RPCs return them only to users with sales.view_prices.
 */
export function useCanSeePrices() {
  const { can } = useAccess();
  return can("sales.view_prices");
}
export function useSoLinePrices(soIds: string[]) {
  const canSee = useCanSeePrices();
  const ids = Array.from(new Set(soIds)).sort();
  return useQuery({
    queryKey: ["so-line-prices", ids.join()],
    enabled: canSee && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await sb().rpc("so_line_prices", { p_so_ids: ids });
      if (error) throw error;
      const byLine = new Map<string, number | null>();
      const bySo = new Map<string, { line_id: string; unit_price: number | null }[]>();
      for (const r of (data ?? []) as { sales_order_id: string; line_id: string; unit_price: number | null }[]) {
        const p = r.unit_price == null ? null : Number(r.unit_price);
        byLine.set(r.line_id, p);
        bySo.set(r.sales_order_id, [...(bySo.get(r.sales_order_id) ?? []), { line_id: r.line_id, unit_price: p }]);
      }
      return { byLine, bySo };
    },
  });
}
export async function fetchGdnLinePrices(gdnIds: string[]) {
  if (!gdnIds.length) return new Map<string, number | null>();
  const { data, error } = await sb().rpc("gdn_line_prices", { p_gdn_ids: gdnIds });
  if (error) throw error;
  return new Map(((data ?? []) as { line_id: string; unit_price: number | null }[]).map((r) => [r.line_id, r.unit_price == null ? null : Number(r.unit_price)]));
}

/**
 * Discount box used on every sales and purchase document: type an amount, or switch to % and it
 * works out the amount from the document's value (and keeps it in step while lines change).
 * The amount is what gets saved.
 */
export function DiscountField({ value, onChange, base, disabled, className }: { value: string; onChange: (v: string) => void; base: number; disabled?: boolean; className?: string }) {
  const [pct, setPct] = React.useState<string | null>(null);
  const fromPct = (p: string) => { const a = Math.round(base * (n(p) || 0)) / 100; return a ? String(a) : ""; };
  React.useEffect(() => {
    if (pct == null) return;
    const a = fromPct(pct);
    if (a !== value) onChange(a);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, pct]);
  const amt = n(value) || 0;
  const shownPct = base > 0 && amt > 0 ? Math.round((amt / base) * 10000) / 100 : 0;
  return (
    <div className={cn("inline-flex flex-col items-end", className)}>
      <div className="flex items-center gap-1">
        <Input inputMode="decimal" aria-label={pct == null ? "Discount amount" : "Discount percent"} className="h-control-sm w-[110px] text-right tabular-nums" placeholder="0" disabled={disabled}
          value={pct ?? value} onChange={(e) => (pct == null ? onChange(e.target.value) : setPct(e.target.value))} />
        <button type="button" disabled={disabled} title={pct == null ? "Enter as a percentage" : "Enter as an amount"}
          className="h-control-sm w-9 rounded-control border border-line bg-white text-xs font-semibold text-ink-muted hover:bg-subtle disabled:opacity-50"
          onClick={() => (pct == null ? setPct(shownPct ? String(shownPct) : "") : setPct(null))}>{pct == null ? "Rs" : "%"}</button>
      </div>
      {pct != null && amt > 0 && <span className="mt-0.5 text-2xs tabular-nums text-ink-muted">= {formatNumber(amt, 2)}</span>}
      {pct == null && shownPct > 0 && <span className="mt-0.5 text-2xs tabular-nums text-ink-muted">{shownPct}%</span>}
    </div>
  );
}
