import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchableSelect, cn, type SelectOption } from "@jst/ui";
import { makeLookupLoader, sb, useAccess, type LookupSpec } from "@jst/data-access";
import { formatNumber } from "@jst/utilities";

/** Shared-dropdown wrapper bound to a lookup spec (server-side search). */
export function LookupPicker({
  spec,
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  clearable = true,
  id,
}: {
  spec: LookupSpec;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  id?: string;
}) {
  const { companyId } = useAccess();
  const key = JSON.stringify(spec) + companyId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = React.useMemo(() => makeLookupLoader(spec, companyId), [key]);
  return (
    <SearchableSelect
      id={id}
      value={value}
      onChange={(v) => onChange(v)}
      loadOptions={loader.load}
      resolveOption={loader.resolve}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
      clearable={clearable}
    />
  );
}

export function WarehousePicker(p: { value: string | null; onChange: (v: string | null) => void; invalid?: boolean; disabled?: boolean; id?: string }) {
  return <LookupPicker {...p} clearable={false} placeholder="Select warehouse…" spec={{ table: "warehouses", label: "name", secondary: "code", filters: { is_active: true } }} />;
}
export function SupplierPicker(p: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; id?: string }) {
  return <LookupPicker {...p} placeholder="Supplier (optional)" spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} />;
}
export function CustomerPicker(p: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; id?: string }) {
  return <LookupPicker {...p} placeholder="Customer (optional)" spec={{ table: "customers", label: "name", secondary: "code", filters: { is_active: true } }} />;
}
/**
 * Stock figures for a set of products (optionally one warehouse), used to decorate
 * dropdown options. Bounded: only the ids currently shown in the dropdown.
 */
async function availabilityFor(productIds: string[], warehouseId: string | null, byVariant: boolean) {
  const out = new Map<string, number>();
  if (!productIds.length) return out;
  let q = sb().from("stock_on_hand").select("product_id, variant_id, available").in("product_id", productIds);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data } = await q.limit(1000);
  for (const r of data ?? []) {
    const key = byVariant ? String(r.variant_id) : String(r.product_id);
    out.set(key, (out.get(key) ?? 0) + Number(r.available));
  }
  return out;
}

const availText = (n: number | undefined, wh: string | null) =>
  n === undefined ? (wh ? "0 avail here" : "no stock") : `${formatNumber(n, Number.isInteger(n) ? 0 : 2)} avail${wh ? " here" : ""}`;

/**
 * Product dropdown with live availability in each option
 * ("P-00004 · 20 avail here"). With a warehouse → that warehouse; without → all
 * warehouses the user can see. Server-side search; never loads the full list.
 */
export function ProductPicker({
  warehouseId = null,
  showStock = true,
  filters,
  placeholder = "Search product…",
  ...p
}: {
  value: string | null; onChange: (v: string | null) => void; invalid?: boolean; disabled?: boolean; id?: string;
  warehouseId?: string | null; showStock?: boolean;
  /** extra equality filters, e.g. { is_assembled: true } */
  filters?: Record<string, boolean | string>;
  placeholder?: string;
}) {
  const { companyId, can } = useAccess();
  const withStock = showStock && can("inventory.view");
  const fkey = JSON.stringify(filters ?? {});
  const base = React.useMemo(
    () => makeLookupLoader({ table: "products", label: "name", secondary: "sku", filters: { is_active: true, ...(filters ?? {}) } }, companyId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId, fkey],
  );
  const decorate = React.useCallback(
    async (opts: SelectOption[]) => {
      if (!withStock) return opts;
      const av = await availabilityFor(opts.map((o) => o.value), warehouseId, false);
      return opts.map((o) => ({ ...o, secondary: `${availText(av.get(o.value), warehouseId)} · ${o.secondary ?? ""}` }));
    },
    [withStock, warehouseId],
  );
  const load = React.useCallback(async (s: string) => decorate(await base.load(s)), [base, decorate]);
  const resolve = React.useCallback(async (v: string) => {
    const o = await base.resolve(v);
    return o ? (await decorate([o]))[0] : null;
  }, [base, decorate]);
  return (
    <SearchableSelect
      key={warehouseId ?? "all"}
      {...p}
      clearable={false}
      placeholder={placeholder}
      loadOptions={load}
      resolveOption={resolve}
    />
  );
}

export function VariantPicker({
  productId,
  warehouseId = null,
  showStock = true,
  ...p
}: { productId: string | null; value: string | null; onChange: (v: string | null) => void; invalid?: boolean; disabled?: boolean; warehouseId?: string | null; showStock?: boolean }) {
  const { can } = useAccess();
  const meta = useProductMeta(productId);
  const withStock = showStock && can("inventory.view");
  const base = React.useMemo(
    () => makeLookupLoader({ table: "product_variants", label: "name", secondary: "sku", filters: { product_id: productId ?? "", is_active: true }, companyScoped: false }, null),
    [productId],
  );
  const decorate = React.useCallback(
    async (opts: SelectOption[]) => {
      if (!withStock || !productId) return opts;
      const av = await availabilityFor([productId], warehouseId, true);
      return opts.map((o) => ({ ...o, secondary: `${availText(av.get(o.value), warehouseId)} · ${o.secondary ?? ""}` }));
    },
    [withStock, productId, warehouseId],
  );
  const load = React.useCallback(async (s: string) => decorate(await base.load(s)), [base, decorate]);
  const resolve = React.useCallback(async (v: string) => {
    const o = await base.resolve(v);
    return o ? (await decorate([o]))[0] : null;
  }, [base, decorate]);
  if (!productId || (meta.data && !meta.data.has_variants)) {
    return <div className="flex h-control items-center rounded-control bg-subtle px-2.5 text-xs text-ink-faint">{productId ? "No variants" : "—"}</div>;
  }
  return (
    <SearchableSelect
      key={`${productId}|${warehouseId ?? "all"}`}
      {...p}
      clearable={false}
      placeholder="Variant…"
      loadOptions={load}
      resolveOption={resolve}
    />
  );
}
export function LocationPicker({ warehouseId, ...p }: { warehouseId: string | null; value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  if (!warehouseId) return <div className="flex h-control items-center rounded-control bg-subtle px-2.5 text-xs text-ink-faint">—</div>;
  return (
    <LookupPicker
      {...p}
      placeholder="No location"
      spec={{ table: "warehouse_locations", label: "code", secondary: "name", filters: { warehouse_id: warehouseId, is_active: true }, companyScoped: false }}
    />
  );
}

export interface ProductMeta {
  id: string;
  has_variants: boolean;
  uom: string;
  allow_decimal: boolean;
  /** tracked by individual roll / physical unit */
  rolls: boolean;
  is_bundle: boolean;
  name: string;
}
export function useProductMeta(productId: string | null) {
  return useQuery({
    queryKey: ["product-meta", productId],
    enabled: !!productId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb()
        .from("products")
        .select("id, name, has_variants, is_bundle, tracking_type, uom:units_of_measure!products_base_uom_id_fkey(code, allow_decimal)")
        .eq("id", productId!)
        .single();
      if (error) throw error;
      const u = data.uom as unknown as { code: string; allow_decimal: boolean };
      return { id: data.id, has_variants: data.has_variants, uom: u?.code ?? "", allow_decimal: u?.allow_decimal ?? false, rolls: data.tracking_type === "PHYSICAL_UNIT", is_bundle: !!data.is_bundle, name: data.name } as ProductMeta;
    },
  });
}

/** On hand / reserved / available for one item in one warehouse (all locations). */
export function useStockFigures(warehouseId: string | null, productId: string | null, variantId: string | null) {
  const meta = useProductMeta(productId);
  const ready = !!warehouseId && !!productId && !!meta.data && (!meta.data.has_variants || !!variantId);
  const q = useQuery({
    queryKey: ["availability", warehouseId, productId, variantId],
    enabled: ready,
    staleTime: 5_000,
    queryFn: async () => {
      let qq = sb().from("stock_on_hand").select("on_hand, reserved, available").eq("warehouse_id", warehouseId!).eq("product_id", productId!);
      qq = variantId ? qq.eq("variant_id", variantId) : qq.is("variant_id", null);
      const { data, error } = await qq.maybeSingle();
      if (error) throw error;
      return data ?? { on_hand: 0, reserved: 0, available: 0 };
    },
  });
  return { ready, meta, data: q.data };
}

/** Live availability for one item in one warehouse — a decision aid; the server re-checks on post. */
export function Availability({ warehouseId, productId, variantId, className }: { warehouseId: string | null; productId: string | null; variantId: string | null; className?: string }) {
  const { ready, meta, data } = useStockFigures(warehouseId, productId, variantId);
  const q = { data };
  if (!ready || !q.data) return <span className={cn("text-2xs text-ink-faint", className)}>&nbsp;</span>;
  const avail = Number(q.data.available);
  return (
    <span className={cn("whitespace-nowrap text-2xs tabular-nums", avail <= 0 ? "text-danger" : "text-ink-muted", className)}>
      Avail {formatNumber(avail, meta.data?.allow_decimal ? 2 : 0)} {meta.data?.uom}
      {Number(q.data.reserved) > 0 && <> · Res {formatNumber(q.data.reserved, 0)}</>}
    </span>
  );
}
