/**
 * Counted stock from Excel / CSV → stock count lines.
 * The sheet needs a header row with at least a quantity column ("Counted qty", "Qty", "Quantity", "Count") and either
 * "SKU" or "Product" (+ "Variant"). An optional "Warehouse" column (code or name) splits the rows into one count per
 * warehouse. Rows with an empty quantity are skipped (not counted yet); 0 is a real count.
 */
export type Cell = string | number | Date | boolean | null | undefined;
export interface CatalogItem { product_id: string; variant_id: string | null; sku: string; product: string; variant: string | null; uom: string; rolls: boolean }
export interface WhRef { id: string; code: string; name: string }
export interface ImportRow { row: number; product_id: string | null; variant_id: string | null; label: string; qty: number | null; warehouse_id: string | null; error: string | null; uom: string }

const norm = (v: Cell) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const HEAD = {
  sku: ["sku", "code", "item code", "product code"],
  product: ["product", "item", "product name", "item name", "name"],
  variant: ["variant", "type", "origin"],
  qty: ["counted qty", "counted quantity", "counted", "count", "qty", "quantity", "physical qty", "stock"],
  warehouse: ["warehouse", "wh", "store"],
};

export function findHeader(grid: Cell[][]): { at: number; col: Record<keyof typeof HEAD, number> } | null {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const cells = grid[r].map(norm);
    const col = Object.fromEntries(Object.entries(HEAD).map(([k, names]) => [k, cells.findIndex((c) => names.includes(c))])) as Record<keyof typeof HEAD, number>;
    if (col.qty >= 0 && (col.sku >= 0 || col.product >= 0)) return { at: r, col };
  }
  return null;
}

export function parseQty(v: Cell): number | null | "bad" {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(x) && x >= 0 ? x : "bad";
}

export function matchRows(grid: Cell[][], catalog: CatalogItem[], warehouses: WhRef[], defaultWh: string | null): { rows: ImportRow[]; problem: string | null } {
  const h = findHeader(grid);
  if (!h) return { rows: [], problem: "No header row found — the sheet needs a “Counted qty” column and a “SKU” or “Product” column" };
  const bySku = new Map(catalog.map((c) => [c.sku.toLowerCase(), c]));
  const byName = new Map<string, CatalogItem[]>();
  for (const c of catalog) { const k = norm(c.product); byName.set(k, [...(byName.get(k) ?? []), c]); }
  const whOf = (v: Cell) => { const k = norm(v); return warehouses.find((w) => w.code.toLowerCase() === k || w.name.toLowerCase() === k) ?? null; };
  const rows: ImportRow[] = [];
  for (let r = h.at + 1; r < grid.length; r++) {
    const g = grid[r] ?? [];
    const sku = h.col.sku >= 0 ? String(g[h.col.sku] ?? "").trim() : "";
    const pname = h.col.product >= 0 ? String(g[h.col.product] ?? "").trim() : "";
    const vname = h.col.variant >= 0 ? String(g[h.col.variant] ?? "").trim() : "";
    if (!sku && !pname) continue;
    const q = parseQty(g[h.col.qty]);
    if (q === null) continue;                                   // not counted yet
    let item: CatalogItem | null = null; let error: string | null = null;
    if (sku) item = bySku.get(sku.toLowerCase()) ?? null;
    if (!item && pname) {
      const cands = byName.get(norm(pname)) ?? [];
      const hasVariants = cands.some((c) => c.variant_id);
      if (!cands.length) error = `“${pname}” is not in the product list`;
      else if (hasVariants && !vname) error = `“${pname}” has variants — fill the Variant column`;
      else item = cands.find((c) => (c.variant ? norm(c.variant) === norm(vname) : !vname)) ?? (hasVariants ? null : cands[0]);
      if (!item && !error) error = `Variant “${vname}” of “${pname}” not found`;
    }
    if (!item && !error) error = `SKU “${sku}” not found`;
    if (item && item.variant_id == null && catalog.some((c) => c.product_id === item!.product_id && c.variant_id)) { error = `${item.product} has variants — use the variant SKU`; item = null; }
    if (q === "bad") error = "Quantity is not a number (0 or more)";
    let wh: string | null = defaultWh;
    if (h.col.warehouse >= 0 && String(g[h.col.warehouse] ?? "").trim()) {
      const w = whOf(g[h.col.warehouse]);
      if (!w) error = error ?? `Warehouse “${String(g[h.col.warehouse])}” not found`; else wh = w.id;
    }
    if (!wh && !error) error = "Choose the warehouse";
    rows.push({ row: r + 1, product_id: item?.product_id ?? null, variant_id: item?.variant_id ?? null, uom: item?.uom ?? "",
      label: item ? `${item.product}${item.variant ? ` · ${item.variant}` : ""}` : pname || sku, qty: q === "bad" ? null : q, warehouse_id: wh, error });
  }
  // the same item twice in one warehouse: counts are added up (two racks), shown once
  const seen = new Map<string, ImportRow>();
  const out: ImportRow[] = [];
  for (const x of rows) {
    if (x.error || !x.product_id) { out.push(x); continue; }
    const k = `${x.warehouse_id}|${x.product_id}|${x.variant_id ?? ""}`;
    const prev = seen.get(k);
    if (prev) { prev.qty = (prev.qty ?? 0) + (x.qty ?? 0); prev.label = prev.label.includes("(added up") ? prev.label : `${prev.label} (added up from several rows)`; }
    else { seen.set(k, x); out.push(x); }
  }
  return { rows: out, problem: out.length ? null : "No rows with a counted quantity" };
}
