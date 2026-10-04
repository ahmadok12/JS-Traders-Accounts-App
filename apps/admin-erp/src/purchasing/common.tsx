import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError, sb, useAccess } from "@jst/data-access";

export const CURRENCIES = ["PKR", "RMB", "USD", "AED", "EUR"];
export const PO_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "warning", APPROVED: "info", PARTIALLY_RECEIVED: "info", RECEIVED: "success", CLOSED: "neutral", CANCELLED: "neutral",
};
export const poLabel = (s: string) =>
  ({ DRAFT: "Draft", APPROVED: "Approved — to receive", PARTIALLY_RECEIVED: "Part received", RECEIVED: "Received", CLOSED: "Closed", CANCELLED: "Cancelled" })[s] ?? s;
export const BILL_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { DRAFT: "warning", POSTED: "success", CANCELLED: "neutral", REVERSED: "danger" };
export const COST_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { PENDING: "warning", ENTERED: "info", APPROVED: "success" };
export const costLabel = (s: string | null | undefined) => ({ PENDING: "Cost pending", ENTERED: "Cost to approve", APPROVED: "Costed" })[s ?? ""] ?? "—";

export async function rpc<T = unknown>(name: string, args: Record<string, unknown>) {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw error;
  return data as T;
}

/** run an RPC, toast, refresh purchasing screens */
export function useAction<V>(fn: (v: V) => Promise<unknown>, ok: string | ((v: V) => string), after?: (v: V) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_d, v) => {
      toast.success(typeof ok === "function" ? ok(v) : ok);
      qc.invalidateQueries();
      after?.(v);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}

export interface ItemInfo { name: string; sku: string; uom: string }
/** names / SKU / unit for a set of products and variants */
export function useItemInfo(productIds: (string | null | undefined)[], variantIds: (string | null | undefined)[]) {
  const p = Array.from(new Set(productIds.filter(Boolean))) as string[];
  const v = Array.from(new Set(variantIds.filter(Boolean))) as string[];
  return useQuery({
    queryKey: ["item-info", p.sort().join(","), v.sort().join(",")],
    enabled: p.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const [pr, vr] = await Promise.all([
        sb().from("products").select("id, name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)").in("id", p),
        v.length ? sb().from("product_variants").select("id, name").in("id", v) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const products = new Map(((pr.data ?? []) as unknown as { id: string; name: string; sku: string; uom: { code: string } | null }[]).map((x) => [x.id, { name: x.name, sku: x.sku, uom: x.uom?.code ?? "" }]));
      const variants = new Map(((vr.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
      return { products, variants };
    },
  });
}

export function useSupplierName(id: string | null | undefined) {
  return useQuery({
    queryKey: ["supplier-name", id],
    enabled: !!id,
    staleTime: 300_000,
    queryFn: async () => (await sb().from("suppliers").select("name, code, default_currency").eq("id", id!).single()).data as { name: string; code: string; default_currency: string } | null,
  });
}

export function CurrencyInput({ currency, rate, onCurrency, onRate, disabled }: { currency: string; rate: string; onCurrency: (c: string) => void; onRate: (r: string) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={currency} disabled={disabled}
        onChange={(e) => { onCurrency(e.target.value); if (e.target.value === "PKR") onRate("1"); }}>
        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      {currency !== "PKR" && (
        <label className="flex items-center gap-1 text-xs text-ink-muted">@
          <input className="h-control w-24 rounded-control border border-line bg-surface px-2 text-right text-sm tabular-nums" inputMode="decimal" value={rate} disabled={disabled}
            onChange={(e) => onRate(e.target.value)} /> PKR</label>
      )}
    </div>
  );
}

export function useCan() {
  const { can } = useAccess();
  return React.useMemo(() => ({
    view: can("purchasing.view"), manage: can("purchasing.manage"), approve: can("purchasing.approve"), costs: can("purchasing.costs"), receive: can("inventory.receive"),
  }), [can]);
}
