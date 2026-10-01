import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, History, ShieldAlert } from "lucide-react";
import { Badge, Card, DataTable, EmptyState, ErpDialog, KeyValue, PageHeader, SearchableSelect, SectionTitle, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList, makeLookupLoader } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDateTime, formatNumber, humanize } from "@jst/utilities";
import { LEDGER_SELECT, MovementsTable, movementTone, type LedgerRow } from "./MovementsTable";
import { SearchBox, StatusFilter, useUrlState } from "./DocPage";
import { SOURCE_ROUTE } from "./docConfigs";
import { useNavigate } from "react-router-dom";
import { useStorageLocations } from "../lib/settings";

interface ItemRow {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  product_alias: string | null;
  variant_id: string | null;
  variant_name: string | null;
  variant_sku: string | null;
  uom_code: string;
  reorder_level: number | null;
  on_hand: number;
  reserved: number;
  available: number;
  is_negative: boolean;
  is_low: boolean;
  last_movement_at: string | null;
  by_warehouse: Record<string, { on_hand: number; reserved: number; available: number }>;
}
interface WhCol { id: string; code: string; name: string }

const qty = (v: number | string, dec?: number) => {
  const n = Number(v);
  return formatNumber(n, dec ?? (Number.isInteger(n) ? 0 : 2));
};

function WarehouseFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { companyId } = useAccess();
  const loader = React.useMemo(() => makeLookupLoader({ table: "warehouses", label: "name", secondary: "code" }, companyId), [companyId]);
  return (
    <div className="w-56">
      <SearchableSelect value={value} onChange={onChange} loadOptions={loader.load} resolveOption={loader.resolve} placeholder="All warehouses" />
    </div>
  );
}

/** Warehouses the user can see — these become the dynamic stock columns (spec §9.2). */
function useWarehouseColumns(companyId: string | null) {
  return useQuery({
    queryKey: ["wh-columns", companyId],
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("warehouses").select("id, code, name").eq("company_id", companyId!).eq("is_active", true).order("code").limit(50);
      if (error) throw error;
      return (data ?? []) as WhCol[];
    },
  });
}

const SOH_FILTERS = [
  { label: "All", filters: {} },
  { label: "Low stock", filters: { is_low: true } },
  { label: "Negative", filters: { is_negative: true } },
];

/** Stock on hand: one row per product + variant, one column per warehouse. */
export function StockOnHandPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const wh = params.get("wh");
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("item");
  const whs = useWarehouseColumns(companyId);

  const list = useQuery({
    queryKey: ["list", "stock_item_summary", companyId, q, wh, f, page],
    enabled: !!companyId && can(P.inventoryView),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let qq = sb()
        .from("stock_item_summary")
        .select("id, product_id, sku, product_name, product_alias, variant_id, variant_name, variant_sku, uom_code, reorder_level, on_hand, reserved, available, is_negative, is_low, last_movement_at, by_warehouse", { count: "exact" })
        .eq("company_id", companyId!);
      for (const [k, v] of Object.entries(SOH_FILTERS[f].filters)) qq = qq.eq(k, v as boolean);
      if (wh) qq = qq.contains("by_warehouse", { [wh]: {} });
      if (q.trim()) {
        const t = `%${q.replace(/[%_,()*\\]/g, " ").trim()}%`;
        qq = qq.or(["product_name", "sku", "product_alias", "variant_name"].map((c) => `${c}.ilike.${t}`).join(","));
      }
      const from = (page - 1) * 50;
      const { data, error, count } = await qq.order("product_name").order("variant_name", { nullsFirst: true }).range(from, from + 49);
      if (error) throw error;
      return { rows: (data ?? []) as ItemRow[], total: count ?? 0 };
    },
  });

  if (!can(P.inventoryView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const cols = (whs.data ?? []).filter((w) => !wh || w.id === wh);
  const selected = list.data?.rows.find((r) => r.id === view) ?? null;

  const whColumns = cols.map((w) => ({
    key: `wh_${w.id}`,
    header: <span title={w.name}>{w.code}<span className="ml-1 font-normal normal-case text-ink-faint">{w.name}</span></span>,
    align: "right" as const,
    cell: (r: ItemRow) => {
      const b = r.by_warehouse?.[w.id];
      if (!b) return <span className="text-ink-faint">—</span>;
      const reserved = Number(b.reserved);
      return (
        <div className="leading-tight">
          <div className={Number(b.on_hand) < 0 ? "font-semibold text-danger" : ""}>{qty(b.on_hand)}</div>
          {reserved > 0 && <div className="text-2xs text-info">{qty(reserved)} reserved</div>}
        </div>
      );
    },
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Stock on Hand" icon={<Boxes className="h-4 w-4" />} description="One row per item, one column per warehouse. Available = total on hand − reserved." />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search product / SKU / variant…" />
          <WarehouseFilter value={wh} onChange={(v) => update({ wh: v, page: null })} />
          <StatusFilter items={SOH_FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? (
          <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p>
        ) : (
          <DataTable
            loading={list.isLoading || whs.isLoading}
            rows={list.data?.rows ?? []}
            onView={(r) => update({ item: r.id })}
            page={page}
            pageSize={50}
            total={list.data?.total ?? null}
            onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "p", header: "Product", cell: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.product_name}</div><div className="text-2xs text-ink-muted">{r.sku}{r.product_alias ? ` · ${r.product_alias}` : ""}</div></div> },
              { key: "v", header: "Variant", cell: (r) => r.variant_name ? <span>{r.variant_name} <span className="text-2xs text-ink-faint">{r.variant_sku}</span></span> : <span className="text-ink-faint">—</span> },
              ...whColumns,
              ...(cols.length > 1 ? [{ key: "t", header: "Total", align: "right" as const, className: "bg-subtle/60", cell: (r: ItemRow) => <span className={cn("font-semibold", r.is_negative && "text-danger")}>{qty(r.on_hand)}</span> }] : []),
              { key: "av", header: "Available", align: "right", cell: (r) => <div className="leading-tight"><div className="font-medium">{qty(wh ? r.by_warehouse?.[wh]?.available ?? 0 : r.available)}</div>{Number(r.reserved) > 0 && !wh && <div className="text-2xs text-ink-faint">{qty(r.reserved)} held</div>}</div> },
              { key: "u", header: "Unit", width: "56px", cell: (r) => <span className="text-xs text-ink-muted">{r.uom_code}</span> },
              { key: "s", header: "", width: "80px", hideBelow: "md", cell: (r) => r.is_negative ? <Badge tone="danger">Negative</Badge> : r.is_low ? <Badge tone="warning" >Low</Badge> : null },
            ]}
            empty={<EmptyState icon={<Boxes className="h-6 w-6" />} title={q || wh ? "No matching stock" : "No stock yet"} description="Post opening stock or a goods receipt to see balances here." />}
          />
        )}
      </Card>
      {view && selected && <StockItemDialog row={selected} warehouses={whs.data ?? []} onClose={() => update({ item: null })} />}
    </div>
  );
}

function StockItemDialog({ row, warehouses, onClose }: { row: ItemRow; warehouses: WhCol[]; onClose: () => void }) {
  const [wh, setWh] = React.useState<string | null>(null);
  const locs = useQuery({
    queryKey: ["balances-by-loc", row.product_id, row.variant_id],
    queryFn: async () => {
      let q = sb().from("stock_balances").select("id, warehouse_id, on_hand, location:warehouse_locations(code, name)").eq("product_id", row.product_id);
      q = row.variant_id ? q.eq("variant_id", row.variant_id) : q.is("variant_id", null);
      const { data, error } = await q.order("on_hand", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const present = warehouses.filter((w) => row.by_warehouse?.[w.id]);
  const locOn = useStorageLocations().enabled;
  return (
    <ErpDialog
      open
      onRequestClose={onClose}
      size="xl"
      icon={<Boxes className="h-4 w-4" />}
      title={`${row.product_name}${row.variant_name ? ` · ${row.variant_name}` : ""}`}
      subtitle={row.variant_sku ?? row.sku}
      status={row.is_negative ? <Badge tone="danger">Negative</Badge> : row.is_low ? <Badge tone="warning">Low stock</Badge> : null}
    >
      <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KeyValue label="Total on hand"><span className="text-lg font-semibold tabular-nums">{qty(row.on_hand)} {row.uom_code}</span></KeyValue>
        <KeyValue label="Reserved"><span className="text-lg tabular-nums">{qty(row.reserved)}</span></KeyValue>
        <KeyValue label="Available"><span className="text-lg font-semibold tabular-nums">{qty(row.available)}</span></KeyValue>
        <KeyValue label="Last movement">{formatDateTime(row.last_movement_at)}</KeyValue>
      </dl>
      <SectionTitle>{locOn ? "By warehouse & location" : "By warehouse"}</SectionTitle>
      {locs.isLoading ? <Skeleton className="h-16" /> : (
        <div className="mb-4 grid gap-2 md:grid-cols-2">
          {present.map((w) => {
            const b = row.by_warehouse[w.id];
            const inWh = (locs.data ?? []).filter((l) => l.warehouse_id === w.id);
            return (
              <div key={w.id} className="rounded-card border border-line p-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-sm font-medium"><span className="font-mono text-xs text-ink-muted">{w.code}</span> {w.name}</div>
                  <div className="text-xs tabular-nums text-ink-muted">on hand <b className="text-ink">{qty(b.on_hand)}</b> · reserved {qty(b.reserved)} · avail <b className="text-ink">{qty(b.available)}</b></div>
                </div>
                {locOn && <div className="mt-2 flex flex-wrap gap-1.5">
                  {inWh.map((l) => { const loc = l.location as unknown as { code: string; name: string } | null; return (
                    <span key={l.id} className="rounded-control border border-line bg-subtle px-2 py-0.5 text-xs"><span className="text-ink-muted">{loc ? loc.code : "No location"}</span> <b className="tabular-nums">{qty(l.on_hand)}</b></span>
                  ); })}
                </div>}
              </div>
            );
          })}
        </div>
      )}
      <SectionTitle action={
        <div className="flex rounded-control border border-line bg-subtle p-0.5">
          {[{ id: null as string | null, code: "All" }, ...present].map((w) => (
            <button key={w.id ?? "all"} onClick={() => setWh(w.id)} className={cn("h-[24px] rounded-[6px] px-2 text-xs font-medium", wh === w.id ? "bg-surface text-ink shadow-card" : "text-ink-muted")}>{w.code}</button>
          ))}
        </div>
      }>Recent movements</SectionTitle>
      <MovementsTable item={{ warehouseId: wh, productId: row.product_id, variantId: row.variant_id }} showItem={false} limit={30} />
    </ErpDialog>
  );
}

const TYPE_OPTIONS = ["OPENING", "PURCHASE_RECEIPT", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "DAMAGE", "SALES_GDN", "RETURN"].map((v) => ({ value: v, label: humanize(v) }));

/** Full movement ledger (authoritative history). */
export function StockLedgerPage() {
  const { can, companyId } = useAccess();
  const navigate = useNavigate();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const wh = params.get("wh");
  const type = params.get("type");
  const page = Number(params.get("page") ?? "1") || 1;

  const list = useEntityList<LedgerRow>({
    table: "stock_ledger",
    select: LEDGER_SELECT,
    companyId,
    search: q,
    searchColumns: ["product_name", "sku", "source_doc_no", "variant_name"],
    filters: { warehouse_id: wh ?? undefined, movement_type: type ?? undefined },
    orderBy: { column: "created_at", ascending: false },
    page,
    pageSize: 50,
    enabled: can(P.inventoryView),
  });
  if (!can(P.inventoryView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Stock Movements" icon={<History className="h-4 w-4" />} description="Every stock change, in order. Append-only — corrections appear as reversals." />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search product / document…" />
          <WarehouseFilter value={wh} onChange={(v) => update({ wh: v, page: null })} />
          <div className="w-48"><SearchableSelect value={type} onChange={(v) => update({ type: v, page: null })} options={TYPE_OPTIONS} placeholder="All movement types" /></div>
        </div>
        {list.error ? (
          <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p>
        ) : (
          <DataTable
            loading={list.isLoading}
            rows={list.data?.rows ?? []}
            onView={(r) => navigate(`${SOURCE_ROUTE[r.source_type] ?? "/stock"}?view=${r.source_id}`)}
            page={page}
            pageSize={50}
            total={list.data?.total ?? null}
            onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "t", header: "When", width: "150px", cell: (r) => <span className="whitespace-nowrap tabular-nums text-ink-2">{formatDateTime(r.created_at)}</span> },
              { key: "type", header: "Movement", cell: (r) => <Badge tone={r.reversal_of ? "warning" : movementTone(r.movement_type)}>{r.reversal_of ? "Reversal · " : ""}{humanize(r.movement_type)}</Badge> },
              { key: "doc", header: "Document", cell: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.source_doc_no ?? (r.source_type === "LOCATION_SETTING" ? "Setting change" : "")}</span> },
              { key: "item", header: "Item", cell: (r) => <span>{r.product_name}{r.variant_name ? <span className="text-ink-muted"> · {r.variant_name}</span> : null}</span> },
              { key: "wh", header: "Wh / Loc", hideBelow: "md", cell: (r) => <span className="text-xs">{r.warehouse_code}{r.location_code ? ` / ${r.location_code}` : ""}</span> },
              { key: "q", header: "Qty", align: "right", cell: (r) => <span className={Number(r.quantity) < 0 ? "text-danger" : "text-success"}>{Number(r.quantity) > 0 ? "+" : ""}{qty(r.quantity)}</span> },
              { key: "b", header: "Balance", align: "right", hideBelow: "sm", cell: (r) => qty(r.balance_after) },
              { key: "r", header: "Reason", hideBelow: "lg", cell: (r) => <span className="text-xs text-ink-muted">{r.reason ? humanize(r.reason) : ""}</span> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
