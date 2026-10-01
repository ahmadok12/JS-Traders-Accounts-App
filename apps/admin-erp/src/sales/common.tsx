import { useQuery } from "@tanstack/react-query";
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
