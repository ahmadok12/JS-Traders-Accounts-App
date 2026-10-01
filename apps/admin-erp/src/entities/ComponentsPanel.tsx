import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, SectionTitle, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { formatNumber } from "@jst/utilities";
import type { ExtraPanelProps } from "../entity/types";
import { ProductPicker, VariantPicker } from "../inventory/pickers";

type CompRow = {
  id: string;
  quantity: number;
  sort_order: number;
  component_product_id: string;
  component_variant_id: string | null;
  product: { name: string; sku: string; uom: { code: string } | null };
  variant: { name: string } | null;
};

const qtyFmt = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 3);

/**
 * What an assembled item or bundle is made of (spec §8.6 / §8.7).
 * A list for "All variants" applies to every variant; a variant can have its own
 * list, which then replaces the general one for that variant.
 */
export function ComponentsPanel({ record, canManage }: ExtraPanelProps) {
  const productId = String(record.id);
  const hasVariants = Boolean(record.has_variants);
  const isBundle = Boolean(record.is_bundle);
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [scope, setScope] = React.useState<string | null>(null); // null = all variants

  const variants = useQuery({
    queryKey: ["variants-of", productId],
    enabled: hasVariants,
    queryFn: async () => {
      const { data, error } = await sb().from("product_variants").select("id, name").eq("product_id", productId).eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useQuery({
    queryKey: ["components", productId],
    queryFn: async () => {
      const { data, error } = await sb()
        .from("product_components")
        .select("id, quantity, sort_order, parent_variant_id, component_product_id, component_variant_id, product:products!product_components_component_product_id_fkey(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants!product_components_component_variant_id_fkey(name)")
        .eq("parent_product_id", productId)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as (CompRow & { parent_variant_id: string | null })[];
    },
  });

  const list = (rows.data ?? []).filter((r) => r.parent_variant_id === scope);
  const variantsWithOwn = new Set((rows.data ?? []).map((r) => r.parent_variant_id).filter(Boolean) as string[]);

  const buildable = useQuery({
    queryKey: ["buildable", productId, scope, rows.dataUpdatedAt],
    queryFn: async () => {
      const { data, error } = await sb().rpc("product_buildable", { p_product_id: productId, p_variant_id: scope });
      if (error) throw error;
      const ids = (data ?? []).map((d: { warehouse_id: string }) => d.warehouse_id);
      const wh = ids.length ? await sb().from("warehouses").select("id, code, name").in("id", ids) : { data: [] };
      const names = new Map((wh.data ?? []).map((w) => [w.id, `${w.code} · ${w.name}`]));
      return (data ?? []).map((d: { warehouse_id: string; buildable: number }) => ({ ...d, name: names.get(d.warehouse_id) ?? "" }));
    },
    enabled: list.length > 0,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["components", productId] });
  };

  const [add, setAdd] = React.useState<{ product_id: string | null; variant_id: string | null; qty: string }>({ product_id: null, variant_id: null, qty: "1" });
  const addRow = useMutation({
    mutationFn: async () => {
      const { error } = await sb().from("product_components").insert({
        company_id: companyId,
        parent_product_id: productId,
        parent_variant_id: scope,
        component_product_id: add.product_id,
        component_variant_id: add.variant_id,
        quantity: add.qty.replace(/,/g, ""),
        sort_order: list.length,
      });
      if (error) throw error;
    },
    onSuccess: () => { setAdd({ product_id: null, variant_id: null, qty: "1" }); refresh(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const updateQty = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: string }) => {
      const { error } = await sb().from("product_components").update({ quantity: qty }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e) => { toast.error(friendlyError(e)); refresh(); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from("product_components").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e) => toast.error(friendlyError(e)),
  });

  const addQty = Number(add.qty.replace(/,/g, ""));
  const canAdd = !!add.product_id && add.qty.trim() !== "" && !Number.isNaN(addQty) && addQty > 0;
  const usingGeneral = scope !== null && !variantsWithOwn.has(scope);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        {isBundle
          ? "Items included in one bundle. The bundle's stock is worked out from these items — the bundle itself is not stocked."
          : "Components used to build one unit. Posting an Assembly order takes these out of stock and adds the finished item."}
      </p>

      {hasVariants && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">List for:</span>
          <div className="flex flex-wrap rounded-control border border-line bg-subtle p-0.5">
            {[{ id: null as string | null, name: "All variants" }, ...(variants.data ?? [])].map((v) => (
              <button
                key={v.id ?? "all"}
                type="button"
                onClick={() => setScope(v.id)}
                className={cn("h-[26px] rounded-[6px] px-2.5 text-xs font-medium", scope === v.id ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}
              >
                {v.name}
                {v.id && variantsWithOwn.has(v.id) && <span className="ml-1 text-info">•</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {usingGeneral && (
        <p className="text-xs text-ink-muted">
          This variant uses the <b>All variants</b> list. Add a component here only if this variant needs a different list — it will then replace the general list for this variant.
        </p>
      )}

      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-8 px-3">Component</th>
              <th className="px-3">Variant</th>
              <th className="w-40 px-3 text-right">Qty per unit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b border-line/70 last:border-0">
                <td className="h-row px-3"><div className="font-medium">{r.product?.name}</div><div className="text-2xs text-ink-muted">{r.product?.sku}</div></td>
                <td className="px-3 text-xs">{r.variant?.name ?? <span className="text-ink-faint">—</span>}</td>
                <td className="px-3 text-right">
                  {canManage ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <Input
                        key={`${r.id}-${r.quantity}`}
                        defaultValue={qtyFmt(Number(r.quantity))}
                        inputMode="decimal"
                        className="h-control-sm w-20 text-right tabular-nums"
                        aria-label={`Quantity of ${r.product?.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.replace(/,/g, "").trim();
                          if (v !== "" && Number(v) > 0 && Number(v) !== Number(r.quantity)) updateQty.mutate({ id: r.id, qty: v });
                        }}
                      />
                      <span className="w-9 text-left text-2xs text-ink-faint">{r.product?.uom?.code}</span>
                    </div>
                  ) : (
                    <span className="tabular-nums">{qtyFmt(Number(r.quantity))} <span className="text-2xs text-ink-faint">{r.product?.uom?.code}</span></span>
                  )}
                </td>
                <td className="px-1 text-right">
                  {canManage && (
                    <Button size="icon-sm" variant="ghost" aria-label="Remove component" onClick={() => remove.mutate(r.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-ink-faint" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.isLoading && list.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-xs text-ink-muted">No components yet{canManage ? " — add them below." : "."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="grid grid-cols-12 items-start gap-2 rounded-card border border-dashed border-line-strong p-2">
          <div className="col-span-12 md:col-span-5">
            <ProductPicker showStock={false} placeholder="Add component…" value={add.product_id} onChange={(v) => setAdd((a) => ({ ...a, product_id: v, variant_id: null }))} filters={{ is_bundle: false }} />
          </div>
          <div className="col-span-6 md:col-span-3">
            <VariantPicker showStock={false} productId={add.product_id} value={add.variant_id} onChange={(v) => setAdd((a) => ({ ...a, variant_id: v }))} />
          </div>
          <div className="col-span-3 md:col-span-2">
            <Input inputMode="decimal" className="text-right tabular-nums" value={add.qty} onChange={(e) => setAdd((a) => ({ ...a, qty: e.target.value }))} aria-label="Quantity per unit" placeholder="Qty" />
          </div>
          <div className="col-span-3 md:col-span-2">
            <Button className="w-full justify-center" icon={<Plus className="h-3.5 w-3.5" />} disabled={!canAdd} loading={addRow.isPending} onClick={() => addRow.mutate()}>Add</Button>
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div>
          <SectionTitle>{isBundle ? "Bundles available from component stock" : "Can be built from stock now"}</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {(buildable.data ?? []).filter((b: { buildable: number }) => Number(b.buildable) > 0).map((b: { warehouse_id: string; name: string; buildable: number }) => (
              <Badge key={b.warehouse_id} tone="info">{b.name}: <b className="ml-1 tabular-nums">{qtyFmt(Number(b.buildable))}</b></Badge>
            ))}
            {buildable.data && !(buildable.data as { buildable: number }[]).some((b) => Number(b.buildable) > 0) && (
              <span className="text-xs text-ink-muted">Not enough components in any warehouse.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
