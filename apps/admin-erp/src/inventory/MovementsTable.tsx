import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Badge, DataTable } from "@jst/ui";
import { friendlyError, sb } from "@jst/data-access";
import { formatDateTime, formatNumber, humanize } from "@jst/utilities";
import { SOURCE_ROUTE } from "./docConfigs";

export interface LedgerRow {
  id: string;
  created_at: string;
  movement_date: string;
  movement_type: string;
  warehouse_code: string;
  location_code: string | null;
  product_name: string;
  sku: string;
  variant_name: string | null;
  quantity: number;
  balance_after: number;
  source_type: string;
  source_id: string;
  source_doc_no: string | null;
  reason: string | null;
  reversal_of: string | null;
  physical_unit_id: string | null;
  unit_no: string | null;
}

export const LEDGER_SELECT =
  "id, created_at, movement_date, movement_type, warehouse_code, location_code, product_name, sku, variant_name, quantity, balance_after, source_type, source_id, source_doc_no, reason, reversal_of, physical_unit_id, unit_no";

export function movementTone(t: string): "success" | "danger" | "info" | "warning" | "neutral" {
  if (t === "OPENING" || t === "PURCHASE_RECEIPT" || t === "TRANSFER_IN" || t === "RETURN" || t === "ASSEMBLY_IN" || t === "DISASSEMBLY_IN") return "success";
  if (t === "SALES_GDN" || t === "TRANSFER_OUT" || t === "DAMAGE" || t === "ASSEMBLY_OUT" || t === "DISASSEMBLY_OUT") return "danger";
  return "info";
}

/** Bounded list of movements for a document or an item (read-only, View → source document). */
export function MovementsTable({
  sourceId,
  unitId,
  item,
  limit = 50,
  showItem = true,
}: {
  sourceId?: string;
  /** one roll's history */
  unitId?: string;
  item?: { warehouseId?: string | null; productId: string; variantId: string | null };
  limit?: number;
  showItem?: boolean;
}) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["ledger", sourceId, unitId, item?.warehouseId, item?.productId, item?.variantId, limit],
    queryFn: async () => {
      let qq = sb().from("stock_ledger").select(LEDGER_SELECT).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
      if (sourceId) qq = qq.eq("source_id", sourceId);
      if (unitId) qq = qq.eq("physical_unit_id", unitId);
      if (item) {
        qq = qq.eq("product_id", item.productId);
        if (item.warehouseId) qq = qq.eq("warehouse_id", item.warehouseId);
        qq = item.variantId ? qq.eq("variant_id", item.variantId) : qq.is("variant_id", null);
      }
      const { data, error } = await qq;
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
  });
  if (q.error) return <p className="text-sm text-danger">{friendlyError(q.error)}</p>;
  return (
    <div className="overflow-hidden rounded-card border border-line">
      <DataTable
        loading={q.isLoading}
        rows={q.data ?? []}
        onView={sourceId ? undefined : (r) => navigate(`${SOURCE_ROUTE[r.source_type] ?? "/stock"}?view=${r.source_id}`)}
        columns={[
          { key: "t", header: "When", width: "150px", cell: (r) => <span className="tabular-nums text-ink-2">{formatDateTime(r.created_at)}</span> },
          { key: "type", header: "Movement", cell: (r) => <Badge tone={r.reversal_of ? "warning" : movementTone(r.movement_type)}>{r.reversal_of ? "Reversal · " : ""}{humanize(r.movement_type)}</Badge> },
          ...(showItem
            ? [{ key: "item", header: "Item", cell: (r: LedgerRow) => <span>{r.product_name}{r.variant_name ? <span className="text-ink-muted"> · {r.variant_name}</span> : null}</span> }]
            : []),
          { key: "wh", header: "Wh / Loc", cell: (r) => <span className="text-xs">{r.warehouse_code}{r.location_code ? ` / ${r.location_code}` : ""}</span> },
          ...((q.data ?? []).some((r) => r.unit_no)
            ? [{ key: "roll", header: "Roll", cell: (r: LedgerRow) => <span className="whitespace-nowrap font-mono text-xs">{r.unit_no ?? ""}</span> }]
            : []),
          { key: "doc", header: "Document", cell: (r) => <span className="font-mono text-xs">{r.source_doc_no ?? (r.source_type === "LOCATION_SETTING" ? "Setting change" : "")}</span> },
          { key: "q", header: "Qty", align: "right", cell: (r) => <span className={Number(r.quantity) < 0 ? "text-danger" : "text-success"}>{Number(r.quantity) > 0 ? "+" : ""}{formatNumber(r.quantity, Number.isInteger(Number(r.quantity)) ? 0 : 2)}</span> },
          { key: "b", header: "Balance", align: "right", cell: (r) => formatNumber(r.balance_after, Number.isInteger(Number(r.balance_after)) ? 0 : 2) },
        ]}
        empty={<p className="py-6 text-center text-xs text-ink-muted">No movements</p>}
      />
    </div>
  );
}
