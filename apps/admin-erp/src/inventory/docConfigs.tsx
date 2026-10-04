import { ArrowLeftRight, PackagePlus, SlidersHorizontal } from "lucide-react";
import type * as React from "react";
import { P } from "@jst/permissions";

export type DocType = "GOODS_RECEIPT" | "STOCK_TRANSFER" | "STOCK_ADJUSTMENT";

export const ADJUSTMENT_REASONS = [
  { value: "OPENING_BALANCE", label: "Opening stock" },
  { value: "INITIAL_COUNT", label: "Initial count" },
  { value: "FOUND_STOCK", label: "Found stock" },
  { value: "DAMAGE", label: "Damage" },
  { value: "LOSS", label: "Loss / missing" },
  { value: "COUNT_CORRECTION", label: "Count correction" },
  { value: "WAREHOUSE_CORRECTION", label: "Warehouse correction" },
  { value: "OTHER", label: "Other" },
];

export interface InvDocConfig {
  type: DocType;
  route: string;
  title: string;
  singular: string;
  description: string;
  icon: React.ReactNode;
  table: string;
  linesTable: string;
  linesFk: string;
  saveRpc: string;
  perms: { create: string; post: string; reverse: string };
  listSelect: string;
  recordSelect: string;
  linesSelect: string;
  /** transfer lines have from/to locations; adjustments are signed */
  kind: "receipt" | "transfer" | "adjustment";
  searchColumns: string[];
}

const I = "h-4 w-4";
const lineProduct =
  "product:products(sku, name, has_variants, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(sku, name)";

export const INV_DOCS: Record<DocType, InvDocConfig> = {
  GOODS_RECEIPT: {
    type: "GOODS_RECEIPT",
    route: "goods-receipts",
    title: "Goods Receipts",
    singular: "Goods Receipt",
    description: "Stock received into a warehouse — against a purchase order or on its own. Quantities only; the purchase cost is entered later (Purchase Costs) or set by the supplier bill.",
    icon: <PackagePlus className={I} />,
    table: "goods_receipts",
    linesTable: "goods_receipt_lines",
    linesFk: "receipt_id",
    saveRpc: "save_goods_receipt",
    perms: { create: P.inventoryReceive, post: P.inventoryReceive, reverse: P.inventoryPost },
    listSelect:
      "id, doc_no, doc_date, status, cost_status, supplier_reference, warehouse:warehouses(code, name), supplier:suppliers(name), lines:goods_receipt_lines(count)",
    recordSelect:
      "id, company_id, doc_no, doc_date, status, cost_status, purchase_order_id, warehouse_id, supplier_id, supplier_reference, notes, posted_at, posted_by, reversed_at, reversal_reason, created_at, created_by, warehouse:warehouses(code, name), supplier:suppliers(name)",
    linesSelect: `id, line_no, product_id, variant_id, location_id, quantity, billed_qty, notes, ${lineProduct}, location:warehouse_locations(code, name)`,
    kind: "receipt",
    searchColumns: ["doc_no", "supplier_reference"],
  },
  STOCK_TRANSFER: {
    type: "STOCK_TRANSFER",
    route: "stock-transfers",
    title: "Stock Transfers",
    singular: "Stock Transfer",
    description: "Move stock between warehouses or locations. Out and in are posted together as one transaction.",
    icon: <ArrowLeftRight className={I} />,
    table: "stock_transfers",
    linesTable: "stock_transfer_lines",
    linesFk: "transfer_id",
    saveRpc: "save_stock_transfer",
    perms: { create: P.inventoryTransfer, post: P.inventoryTransfer, reverse: P.inventoryPost },
    listSelect:
      "id, doc_no, doc_date, status, reference, from:warehouses!stock_transfers_from_warehouse_id_fkey(code, name), to:warehouses!stock_transfers_to_warehouse_id_fkey(code, name), lines:stock_transfer_lines(count)",
    recordSelect:
      "id, company_id, doc_no, doc_date, status, from_warehouse_id, to_warehouse_id, reference, transport_details, notes, posted_at, posted_by, reversed_at, reversal_reason, created_at, created_by, from:warehouses!stock_transfers_from_warehouse_id_fkey(code, name), to:warehouses!stock_transfers_to_warehouse_id_fkey(code, name)",
    linesSelect: `id, line_no, product_id, variant_id, from_location_id, to_location_id, quantity, notes, ${lineProduct}, from_location:warehouse_locations!stock_transfer_lines_from_location_id_fkey(code), to_location:warehouse_locations!stock_transfer_lines_to_location_id_fkey(code)`,
    kind: "transfer",
    searchColumns: ["doc_no", "reference"],
  },
  STOCK_ADJUSTMENT: {
    type: "STOCK_ADJUSTMENT",
    route: "stock-adjustments",
    title: "Adjustments & Opening Stock",
    singular: "Stock Adjustment",
    description: "Opening stock, damage, loss and corrections. Every adjustment needs a reason and is approved (posted) by an authorised user.",
    icon: <SlidersHorizontal className={I} />,
    table: "stock_adjustments",
    linesTable: "stock_adjustment_lines",
    linesFk: "adjustment_id",
    saveRpc: "save_stock_adjustment",
    perms: { create: P.inventoryAdjust, post: P.inventoryPost, reverse: P.inventoryPost },
    listSelect: "id, doc_no, doc_date, status, reason, reference, warehouse:warehouses(code, name), lines:stock_adjustment_lines(count)",
    recordSelect:
      "id, company_id, doc_no, doc_date, status, warehouse_id, reason, entry_mode, reference, notes, posted_at, posted_by, reversed_at, reversal_reason, created_at, created_by, warehouse:warehouses(code, name)",
    linesSelect: `id, line_no, product_id, variant_id, location_id, quantity, target_qty, system_qty, notes, ${lineProduct}, location:warehouse_locations(code, name)`,
    kind: "adjustment",
    searchColumns: ["doc_no", "reference"],
  },
};

export const SOURCE_ROUTE: Record<string, string> = {
  GOODS_RECEIPT: "/goods-receipts",
  STOCK_TRANSFER: "/stock-transfers",
  STOCK_ADJUSTMENT: "/stock-adjustments",
  STOCK_COUNT: "/stock-counts",
  ASSEMBLY_ORDER: "/assembly",
};

export const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "warning",
  POSTED: "success",
  CANCELLED: "neutral",
  REVERSED: "danger",
  OPEN: "info",
  CLOSED: "neutral",
  ACTIVE: "info",
  RELEASED: "neutral",
  CONSUMED: "success",
  PENDING: "warning",
  COUNTED: "info",
};
