/**
 * Report registry — every report the app offers, in one place (spec §20).
 * A report is a fixed, permission-checked data source (a database report function or view)
 * plus its parameters and columns. Saved reports and report shortcuts refer to these codes;
 * nothing ever builds SQL from configuration.
 */
import { sb } from "@jst/data-access";

export type ParamKey = "range" | "asOf" | "customer" | "supplier" | "warehouse" | "bank" | "account" | "party" | "compare" | "payType" | "entity";
export interface PartyRef { type: "CUSTOMER" | "SUPPLIER" | "AGENT" | "EMPLOYEE"; id: string }
export interface Params {
  from?: string | null; to?: string | null; asOf?: string | null; customer?: string | null; supplier?: string | null; warehouse?: string | null;
  bank?: string | null; account?: string | null; party?: PartyRef | null; compare?: boolean; payType?: string | null; entity?: string | null;
  /** period preset (periods.ts) — "last10" etc. means: all dates, newest N rows */
  period?: string | null;
}
export type Kind = "text" | "money" | "qty" | "date" | "datetime" | "pct" | "int" | "badge" | "rate";
export interface Col { key: string; label: string; kind?: Kind; total?: boolean; hidden?: boolean; width?: string }
export type Row = Record<string, unknown>;
export interface ReportDef {
  code: string;
  title: string;
  category: Category;
  description: string;
  /** any of these permissions shows the report */
  perms: string[];
  params?: ParamKey[];
  /** parameters that must be filled before running */
  required?: ParamKey[];
  columns?: Col[];
  run?: (p: Params, companyId: string) => Promise<Row[]>;
  /** document / record the row opens */
  link?: (r: Row) => string | null;
  /** default grouping column */
  groupBy?: string;
  /** an existing full screen instead of a generic table */
  route?: string;
  /** date column: enables "Last 10 / 25 … transactions" (the default) */
  dateKey?: string;
  /** default date range preset when there is no dateKey */
  rangePreset?: "month" | "year" | "all" | "prev";
  /** quick view: columns to show and how many rows */
  quick?: { columns: string[]; limit?: number; sortDesc?: string };
}
export type Category = "Inventory" | "Sales" | "Purchasing & imports" | "Finance" | "Cash, bank & cheques" | "People" | "Administration";
export const CATEGORIES: Category[] = ["Sales", "Inventory", "Purchasing & imports", "Finance", "Cash, bank & cheques", "People", "Administration"];

async function call<T = Row>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}
const d = (v?: string | null) => v || null;

export const REPORTS: ReportDef[] = [
  /* ------------------------------------------------------------------ Sales */
  { code: "sales_register", dateKey: "invoice_date", title: "Sales register", category: "Sales", perms: ["sales.view_prices"], params: ["range", "customer"], rangePreset: "month",
    description: "Every posted invoice with paid / outstanding and, with stock-value rights, cost of goods and margin.",
    run: (p, c) => call("rpt_sales_register", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_customer: d(p.customer) }),
    link: (r) => `/invoices?view=${r.invoice_id}`,
    columns: [
      { key: "invoice_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Invoice" }, { key: "customer", label: "Customer" },
      { key: "subtotal", label: "Subtotal", kind: "money", total: true, hidden: true }, { key: "discount", label: "Discount", kind: "money", total: true, hidden: true },
      { key: "total", label: "Total", kind: "money", total: true }, { key: "paid", label: "Paid", kind: "money", total: true }, { key: "outstanding", label: "Outstanding", kind: "money", total: true },
      { key: "payment_status", label: "Status", kind: "badge" }, { key: "due_date", label: "Due", kind: "date", hidden: true },
      { key: "cogs", label: "Cost of goods", kind: "money", total: true }, { key: "margin", label: "Margin", kind: "money", total: true }, { key: "margin_pct", label: "Margin %", kind: "pct" },
    ],
    quick: { columns: ["invoice_date", "doc_no", "total", "outstanding"], limit: 10, sortDesc: "invoice_date" } },
  { code: "sales_by_item", title: "Sales by item", category: "Sales", perms: ["sales.view_prices"], params: ["range", "customer"], rangePreset: "month",
    description: "Quantity and value sold per item / variant, average price, number of customers.",
    run: (p, c) => call("rpt_sales_by_item", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_customer: d(p.customer) }),
    columns: [{ key: "sku", label: "SKU" }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" }, { key: "category", label: "Category", hidden: true },
      { key: "qty", label: "Qty", kind: "qty", total: true }, { key: "amount", label: "Amount", kind: "money", total: true }, { key: "avg_price", label: "Avg price", kind: "money" },
      { key: "invoices", label: "Invoices", kind: "int" }, { key: "customers", label: "Customers", kind: "int" }, { key: "last_sold", label: "Last sold", kind: "date" }],
    quick: { columns: ["item", "variant", "qty", "avg_price", "last_sold"], limit: 10 } },
  { code: "dispatch_register", dateKey: "gdn_date", title: "Dispatch (GDN) register", category: "Sales", perms: ["sales.view", "inventory.view"], params: ["range", "warehouse", "customer"], rangePreset: "month",
    description: "Every dispatched line by warehouse, with how much has been invoiced.",
    run: (p, c) => call("rpt_dispatch_register", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_warehouse: d(p.warehouse), p_customer: d(p.customer) }),
    link: (r) => `/gdn?view=${r.gdn_id}`,
    columns: [{ key: "gdn_date", label: "Date", kind: "date" }, { key: "doc_no", label: "GDN" }, { key: "sales_order", label: "Order" }, { key: "customer", label: "Customer" },
      { key: "warehouse", label: "Warehouse" }, { key: "sku", label: "SKU", hidden: true }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" },
      { key: "quantity", label: "Qty", kind: "qty", total: true }, { key: "invoiced_qty", label: "Invoiced", kind: "qty", total: true }, { key: "not_invoiced", label: "Not invoiced", kind: "qty", total: true }] },
  { code: "sales_returns", dateKey: "return_date", title: "Sales returns (from customers)", category: "Sales", perms: ["sales.return", "sales.view", "inventory.view"],
    params: ["range", "warehouse", "customer"], rangePreset: "month",
    description: "Goods customers sent back: which GDN, which warehouse they came back into, condition, and how much was credited.",
    run: (p, c) => call("rpt_sales_returns", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_warehouse: d(p.warehouse), p_customer: d(p.customer) }),
    link: (r) => `/sales-returns?view=${r.return_id}`,
    columns: [{ key: "return_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Return" }, { key: "status", label: "Status", kind: "badge" }, { key: "gdn_no", label: "GDN" },
      { key: "customer", label: "Customer" }, { key: "warehouse", label: "Back into" }, { key: "sku", label: "SKU", hidden: true }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" },
      { key: "quantity", label: "Qty", kind: "qty", total: true }, { key: "condition", label: "Condition", kind: "badge" }, { key: "not_invoiced_qty", label: "Not yet invoiced", kind: "qty", total: true, hidden: true },
      { key: "credited_qty", label: "Credited", kind: "qty", total: true, hidden: true }, { key: "credit_amount", label: "Credit", kind: "money", total: true }, { key: "reason", label: "Reason" }] },
  { code: "pending_orders", title: "Pending / part-delivered orders", category: "Sales", perms: ["sales.view"], params: ["customer"],
    description: "Sales order lines not yet fully dispatched, with the warehouses they wait in and their age.",
    run: (p, c) => call("rpt_pending_orders", { p_company: c, p_customer: d(p.customer) }),
    link: (r) => `/sales-orders?view=${r.sales_order_id}`, groupBy: "customer",
    columns: [{ key: "order_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Order" }, { key: "customer", label: "Customer" }, { key: "status", label: "Status", kind: "badge" },
      { key: "item", label: "Item" }, { key: "variant", label: "Variant" }, { key: "ordered", label: "Ordered", kind: "qty" }, { key: "delivered", label: "Delivered", kind: "qty" },
      { key: "open_qty", label: "Open", kind: "qty", total: true }, { key: "warehouses", label: "Waiting in" }, { key: "open_value", label: "Open value", kind: "money", total: true },
      { key: "age_days", label: "Age (days)", kind: "int" }],
    quick: { columns: ["doc_no", "item", "open_qty", "age_days"], limit: 10 } },
  { code: "customer_aging", title: "Receivables ageing", category: "Sales", perms: ["journals.view"], params: ["asOf"],
    description: "What each customer owes, split by how overdue the invoices are (by due date). Total = customer ledger balance; “other” is opening balances / unapplied receipts.",
    run: (p, c) => call("rpt_aging", { p_company: c, p_party_type: "CUSTOMER", p_as_of: d(p.asOf) }),
    link: (r) => `/statements?type=CUSTOMER&party=${r.party_id}`,
    columns: [{ key: "code", label: "Code", hidden: true }, { key: "name", label: "Customer" }, { key: "city", label: "City", hidden: true },
      { key: "not_due", label: "Not due", kind: "money", total: true }, { key: "d1_30", label: "1–30", kind: "money", total: true }, { key: "d31_60", label: "31–60", kind: "money", total: true },
      { key: "d61_90", label: "61–90", kind: "money", total: true }, { key: "d90_plus", label: "90+", kind: "money", total: true }, { key: "other", label: "Other / on account", kind: "money", total: true },
      { key: "balance", label: "Balance", kind: "money", total: true }, { key: "oldest_due", label: "Oldest due", kind: "date" }, { key: "open_docs", label: "Open invoices", kind: "int" }] },
  { code: "customer_open_invoices", title: "Open invoices (ageing detail)", category: "Sales", perms: ["sales.view_prices", "journals.view"], params: ["asOf", "party"],
    description: "Every unpaid invoice with its due date, days overdue and bucket.",
    run: (p, c) => call("rpt_aging_detail", { p_company: c, p_party_type: "CUSTOMER", p_as_of: d(p.asOf), p_party: p.party?.id ?? null }),
    link: (r) => `/invoices?view=${r.doc_id}`, groupBy: "party",
    columns: [{ key: "party", label: "Customer" }, { key: "doc_no", label: "Invoice" }, { key: "doc_date", label: "Date", kind: "date" }, { key: "due_date", label: "Due", kind: "date" },
      { key: "days_overdue", label: "Days overdue", kind: "int" }, { key: "bucket", label: "Bucket", kind: "badge" }, { key: "total", label: "Invoice total", kind: "money" }, { key: "outstanding", label: "Outstanding", kind: "money", total: true }],
    quick: { columns: ["doc_no", "due_date", "days_overdue", "outstanding"], limit: 10 } },
  { code: "customer_ledger", dateKey: "entry_date", title: "Customer ledger", category: "Sales", perms: ["journals.view"], params: ["range", "party"], required: ["party"], rangePreset: "all",
    description: "Opening balance, every entry and the running balance of one customer.",
    run: (p) => call("party_statement", { p_party_type: "CUSTOMER", p_party_id: p.party?.id, p_from: d(p.from), p_to: d(p.to), p_include_linked: false }),
    link: (r) => (r.entry_id ? `/vouchers?view=${r.entry_id}` : null), columns: LEDGER_COLS(),
    quick: { columns: ["entry_date", "entry_no", "debit", "credit", "balance"], limit: 10, sortDesc: "__index" } },

  /* ------------------------------------------------------------------ Inventory */
  { code: "stock_summary", title: "Stock summary", category: "Inventory", perms: ["inventory.view"], params: ["asOf", "warehouse"],
    description: "Quantity per item and warehouse (today or on a past date), reserved, available, reorder level and — with stock-value rights — value.",
    run: (p, c) => call("rpt_stock_summary", { p_company: c, p_as_of: d(p.asOf), p_warehouse: d(p.warehouse) }), groupBy: "warehouse",
    columns: [{ key: "sku", label: "SKU" }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" }, { key: "category", label: "Category", hidden: true }, { key: "warehouse", label: "Warehouse" },
      { key: "qty", label: "On hand", kind: "qty", total: true }, { key: "reserved", label: "Reserved", kind: "qty", total: true }, { key: "available", label: "Available", kind: "qty", total: true },
      { key: "uom", label: "Unit" }, { key: "reorder_level", label: "Reorder level", kind: "qty", hidden: true }, { key: "avg_cost", label: "Avg cost", kind: "money" }, { key: "value", label: "Value", kind: "money", total: true }],
    quick: { columns: ["warehouse", "qty", "reserved", "available"], limit: 20 } },
  { code: "low_stock", title: "Low / critical stock", category: "Inventory", perms: ["inventory.view"], params: ["warehouse"],
    description: "Items whose available quantity (all warehouses) is at or below their reorder level.",
    run: async (p, c) => (await call("rpt_stock_summary", { p_company: c, p_as_of: null, p_warehouse: d(p.warehouse) })).filter((r) => r.below_reorder),
    columns: [{ key: "sku", label: "SKU" }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" }, { key: "warehouse", label: "Warehouse" }, { key: "available", label: "Available here", kind: "qty" },
      { key: "item_total", label: "Available (all)", kind: "qty" }, { key: "reorder_level", label: "Reorder level", kind: "qty" }, { key: "uom", label: "Unit" }] },
  { code: "stock_movement_summary", title: "Stock movement summary", category: "Inventory", perms: ["inventory.view"], params: ["range", "warehouse"], rangePreset: "month",
    description: "Opening + purchases + transfers + sales + assembly + adjustments = closing, per item and warehouse.",
    run: (p, c) => call("rpt_stock_movement_summary", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_warehouse: d(p.warehouse) }),
    columns: [{ key: "sku", label: "SKU", hidden: true }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" }, { key: "warehouse", label: "Warehouse" },
      { key: "opening", label: "Opening", kind: "qty", total: true }, { key: "purchases", label: "Purchases", kind: "qty", total: true }, { key: "transfers_in", label: "Transfers in", kind: "qty", total: true },
      { key: "transfers_out", label: "Transfers out", kind: "qty", total: true }, { key: "sales", label: "Sales", kind: "qty", total: true }, { key: "assembly", label: "Assembly", kind: "qty", total: true },
      { key: "adjustments", label: "Adjustments", kind: "qty", total: true }, { key: "closing", label: "Closing", kind: "qty", total: true }] },
  { code: "count_variance", dateKey: "count_date", title: "Stock count variance", category: "Inventory", perms: ["inventory.view"], params: ["range", "warehouse"], rangePreset: "year",
    description: "Approved count differences (counted vs system) with their value.",
    run: (p, c) => call("rpt_count_variance", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_warehouse: d(p.warehouse) }),
    link: (r) => `/stock-counts?view=${r.count_id}`,
    columns: [{ key: "count_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Count" }, { key: "warehouse", label: "Warehouse" }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" },
      { key: "system_qty", label: "System", kind: "qty" }, { key: "counted_qty", label: "Counted", kind: "qty" }, { key: "variance", label: "Variance", kind: "qty", total: true },
      { key: "variance_value", label: "Value", kind: "money", total: true }, { key: "counted_by", label: "Counted by" }, { key: "note", label: "Note", hidden: true }] },
  { code: "stock_ledger", title: "Stock movements (ledger)", category: "Inventory", perms: ["inventory.view"], route: "/stock-ledger", description: "Every stock movement with document links." },
  { code: "stock_value", title: "Stock value", category: "Inventory", perms: ["inventory.valuation"], route: "/stock-valuation", description: "Moving-average value per item vs the Inventory account." },
  { code: "reservations", title: "Customer reservations", category: "Inventory", perms: ["inventory.view", "sales.view"], route: "/reservations", description: "Stock held for customers." },

  /* ------------------------------------------------------------------ Purchasing & imports */
  { code: "purchase_register", dateKey: "bill_date", title: "Purchase register", category: "Purchasing & imports", perms: ["purchasing.costs"], params: ["range", "supplier"], rangePreset: "month",
    description: "Every posted supplier bill — currency, PKR, paid, outstanding and exchange difference.",
    run: (p, c) => call("rpt_purchase_register", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_supplier: d(p.supplier) }),
    link: (r) => `/supplier-bills?view=${r.bill_id}`,
    columns: [{ key: "bill_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Bill" }, { key: "supplier", label: "Supplier" }, { key: "supplier_invoice_no", label: "Their invoice" },
      { key: "currency", label: "Cur." }, { key: "total_fx", label: "Amount", kind: "money" }, { key: "fx_rate", label: "Rate", kind: "rate", hidden: true }, { key: "total_pkr", label: "PKR", kind: "money", total: true },
      { key: "paid_pkr", label: "Paid (PKR)", kind: "money", total: true }, { key: "outstanding_pkr", label: "Outstanding (PKR)", kind: "money", total: true }, { key: "outstanding_fx", label: "Outstanding (cur.)", kind: "money", hidden: true },
      { key: "fx_diff", label: "FX diff.", kind: "money", total: true, hidden: true }, { key: "payment_status", label: "Status", kind: "badge" }],
    quick: { columns: ["bill_date", "doc_no", "total_pkr", "outstanding_pkr"], limit: 10, sortDesc: "bill_date" } },
  { code: "purchase_returns", dateKey: "return_date", title: "Purchase returns (to suppliers)", category: "Purchasing & imports", perms: ["purchasing.return", "purchasing.view", "inventory.view"],
    params: ["range", "warehouse", "supplier"], rangePreset: "month",
    description: "Goods sent back to suppliers: which goods receipt, from which warehouse, before or after the supplier billed them, and their value.",
    run: (p, c) => call("rpt_purchase_returns", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_warehouse: d(p.warehouse), p_supplier: d(p.supplier) }),
    link: (r) => `/purchase-returns?view=${r.return_id}`,
    columns: [{ key: "return_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Return" }, { key: "status", label: "Status", kind: "badge" }, { key: "receipt_no", label: "GRN" },
      { key: "supplier", label: "Supplier" }, { key: "warehouse", label: "From" }, { key: "sku", label: "SKU", hidden: true }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" },
      { key: "quantity", label: "Qty", kind: "qty", total: true }, { key: "before_billing_qty", label: "Before billing", kind: "qty", total: true, hidden: true },
      { key: "after_billing_qty", label: "After billing", kind: "qty", total: true, hidden: true }, { key: "value_pkr", label: "Value", kind: "money", total: true }, { key: "reason", label: "Reason" }] },
  { code: "purchases_by_item", title: "Purchases by item", category: "Purchasing & imports", perms: ["purchasing.view", "inventory.view"], params: ["range", "supplier"], rangePreset: "year",
    description: "Quantity received per item, cost + landed cost and average unit cost (cost columns need cost rights).",
    run: (p, c) => call("rpt_purchases_by_item", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_supplier: d(p.supplier) }),
    columns: [{ key: "sku", label: "SKU", hidden: true }, { key: "item", label: "Item" }, { key: "variant", label: "Variant" }, { key: "qty_received", label: "Qty received", kind: "qty", total: true },
      { key: "cost_pkr", label: "Cost (PKR)", kind: "money", total: true }, { key: "landed_pkr", label: "Landed cost", kind: "money", total: true }, { key: "avg_unit_cost", label: "Avg unit cost", kind: "money" },
      { key: "uncosted_qty", label: "Cost pending", kind: "qty", total: true }, { key: "receipts", label: "Receipts", kind: "int" }, { key: "last_received", label: "Last received", kind: "date" }],
    quick: { columns: ["item", "qty_received", "avg_unit_cost", "last_received"], limit: 10 } },
  { code: "supplier_aging", title: "Payables ageing", category: "Purchasing & imports", perms: ["journals.view"], params: ["asOf"],
    description: "What we owe each supplier by how overdue the bills are. Total = supplier ledger balance (PKR).",
    run: (p, c) => call("rpt_aging", { p_company: c, p_party_type: "SUPPLIER", p_as_of: d(p.asOf) }),
    link: (r) => `/statements?type=SUPPLIER&party=${r.party_id}`,
    columns: [{ key: "name", label: "Supplier" }, { key: "not_due", label: "Not due", kind: "money", total: true }, { key: "d1_30", label: "1–30", kind: "money", total: true },
      { key: "d31_60", label: "31–60", kind: "money", total: true }, { key: "d61_90", label: "61–90", kind: "money", total: true }, { key: "d90_plus", label: "90+", kind: "money", total: true },
      { key: "other", label: "Other / advances", kind: "money", total: true }, { key: "balance", label: "Balance", kind: "money", total: true }, { key: "oldest_due", label: "Oldest due", kind: "date" }] },
  { code: "supplier_open_bills", title: "Open bills (ageing detail)", category: "Purchasing & imports", perms: ["purchasing.costs", "journals.view"], params: ["asOf", "party"],
    description: "Every unpaid supplier bill with its due date and bucket.",
    run: (p, c) => call("rpt_aging_detail", { p_company: c, p_party_type: "SUPPLIER", p_as_of: d(p.asOf), p_party: p.party?.id ?? null }),
    link: (r) => `/supplier-bills?view=${r.doc_id}`, groupBy: "party",
    columns: [{ key: "party", label: "Supplier" }, { key: "doc_no", label: "Bill" }, { key: "doc_date", label: "Date", kind: "date" }, { key: "due_date", label: "Due", kind: "date" },
      { key: "days_overdue", label: "Days overdue", kind: "int" }, { key: "bucket", label: "Bucket", kind: "badge" }, { key: "outstanding", label: "Outstanding (PKR)", kind: "money", total: true }],
    quick: { columns: ["doc_no", "due_date", "days_overdue", "outstanding"], limit: 10 } },
  { code: "supplier_ledger", dateKey: "entry_date", title: "Supplier ledger", category: "Purchasing & imports", perms: ["journals.view"], params: ["range", "party"], required: ["party"], rangePreset: "all",
    description: "Opening balance, every entry and the running balance of one supplier (+ = we owe).",
    run: (p) => call("party_statement", { p_party_type: "SUPPLIER", p_party_id: p.party?.id, p_from: d(p.from), p_to: d(p.to), p_include_linked: false }),
    link: (r) => (r.entry_id ? `/vouchers?view=${r.entry_id}` : null), columns: LEDGER_COLS(),
    quick: { columns: ["entry_date", "entry_no", "debit", "credit", "balance"], limit: 10, sortDesc: "__index" } },
  { code: "shipments", title: "Shipments & ETA", category: "Purchasing & imports", perms: ["purchasing.view"], params: ["range"], rangePreset: "year",
    description: "Every shipment with status, ETA / late days, goods value, received quantity and landed cost %.",
    run: (p, c) => call("rpt_shipments", { p_company: c, p_from: d(p.from), p_to: d(p.to) }), link: (r) => `/shipments?view=${r.shipment_id}`,
    columns: [{ key: "doc_no", label: "Shipment" }, { key: "supplier", label: "Supplier" }, { key: "mode", label: "Mode" }, { key: "status", label: "Status", kind: "badge" },
      { key: "bl_no", label: "B/L", hidden: true }, { key: "etd", label: "ETD", kind: "date" }, { key: "eta", label: "ETA", kind: "date" }, { key: "ata", label: "Arrived", kind: "date" },
      { key: "days_late", label: "Days late", kind: "int" }, { key: "currency", label: "Cur.", hidden: true }, { key: "goods_value_pkr", label: "Goods value (PKR)", kind: "money", total: true },
      { key: "qty", label: "Qty", kind: "qty", hidden: true }, { key: "received_qty", label: "Received", kind: "qty", hidden: true },
      { key: "landed_cost_pkr", label: "Landed cost", kind: "money", total: true }, { key: "landed_pct", label: "Landed %", kind: "pct" }] },
  { code: "landed_costs", dateKey: "doc_date", title: "Landed cost charges", category: "Purchasing & imports", perms: ["purchasing.costs"], params: ["range"], rangePreset: "year",
    description: "Every landed-cost charge (freight, customs, clearing …), who it was paid to and how it was split.",
    run: (p, c) => call("rpt_landed_costs", { p_company: c, p_from: d(p.from), p_to: d(p.to) }), link: (r) => `/landed-costs?view=${r.landed_cost_id}`, groupBy: "component",
    columns: [{ key: "doc_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Landed cost" }, { key: "status", label: "Status", kind: "badge" }, { key: "shipment", label: "Shipment" },
      { key: "component", label: "Component" }, { key: "description", label: "Description", hidden: true }, { key: "payee", label: "Paid to" }, { key: "currency", label: "Cur." },
      { key: "amount", label: "Amount", kind: "money" }, { key: "amount_pkr", label: "PKR", kind: "money", total: true }, { key: "treatment", label: "Treatment" }, { key: "method", label: "Split by" }] },
  { code: "fx_payments", dateKey: "pay_date", title: "Foreign payments", category: "Purchasing & imports", perms: ["purchasing.costs", "journals.view"], params: ["range", "supplier"], rangePreset: "year",
    description: "Payments in RMB / USD with the rate of each payment, PKR cost and exchange difference.",
    run: async (p, c) => {
      let q = sb().from("fx_payments_v").select("*").eq("company_id", c).eq("status", "POSTED");
      if (p.from) q = q.gte("pay_date", p.from); if (p.to) q = q.lte("pay_date", p.to); if (p.supplier) q = q.eq("supplier_id", p.supplier);
      const { data, error } = await q.order("pay_date"); if (error) throw error; return data ?? [];
    },
    link: (r) => `/fx-payments?view=${r.id}`,
    columns: [{ key: "pay_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Payment" }, { key: "supplier_name", label: "Supplier" }, { key: "currency", label: "Cur." },
      { key: "fx_amount", label: "Amount", kind: "money" }, { key: "fx_rate", label: "Rate", kind: "rate" }, { key: "amount_pkr", label: "PKR", kind: "money", total: true },
      { key: "agent_name", label: "Agent" }, { key: "bank_name", label: "Bank", hidden: true }, { key: "unapplied", label: "Not applied", kind: "money" }, { key: "fx_diff", label: "FX diff.", kind: "money", total: true }, { key: "bills", label: "Bills" }] },
  { code: "agents", title: "Payment agent accounts", category: "Purchasing & imports", perms: ["payment_agents.view", "journals.view"], route: "/agent-accounts", description: "Agent funding, settlements, balances per currency." },
  { code: "fx_balances", title: "Currency balances & FX gain/loss", category: "Purchasing & imports", perms: ["journals.view"], route: "/fx", description: "Balances per currency and realized exchange gain / loss." },

  /* ------------------------------------------------------------------ Finance */
  { code: "profit_loss", title: "Profit & loss", category: "Finance", perms: ["journals.view"], params: ["range", "compare"], rangePreset: "month",
    description: "Income − cost of goods − expenses for the period, optionally against the previous period of the same length.",
    run: (p, c) => {
      const prev = p.compare && p.from && p.to ? previousPeriod(p.from, p.to) : null;
      return call("rpt_profit_loss", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_cmp_from: prev?.[0] ?? null, p_cmp_to: prev?.[1] ?? null });
    },
    link: (r) => `/reports/general_ledger?account=${r.account_id}`, groupBy: "section",
    columns: [{ key: "section", label: "Section" }, { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "parent", label: "Group", hidden: true },
      { key: "amount", label: "Amount", kind: "money", total: true }, { key: "compare_amount", label: "Previous period", kind: "money", total: true }] },
  { code: "balance_sheet", title: "Balance sheet", category: "Finance", perms: ["journals.view"], params: ["asOf"],
    description: "Assets = liabilities + equity as of a date (profit not yet closed shows under equity).",
    run: (p, c) => call("rpt_balance_sheet", { p_company: c, p_as_of: d(p.asOf) }), groupBy: "section",
    link: (r) => (r.account_id ? `/reports/general_ledger?account=${r.account_id}` : null),
    columns: [{ key: "section", label: "Section" }, { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "parent", label: "Group", hidden: true }, { key: "amount", label: "Amount", kind: "money", total: true }] },
  { code: "general_ledger", dateKey: "entry_date", title: "General ledger", category: "Finance", perms: ["journals.view"], params: ["account", "range"], required: ["account"], rangePreset: "month",
    description: "Every line on one account with opening and running balance.",
    run: (p, c) => call("rpt_general_ledger", { p_company: c, p_account: p.account, p_from: d(p.from), p_to: d(p.to) }),
    link: (r) => (r.entry_id ? `/vouchers?view=${r.entry_id}` : null),
    columns: [{ key: "entry_date", label: "Date", kind: "date" }, { key: "entry_no", label: "Entry" }, { key: "entry_type", label: "Type", kind: "badge", hidden: true }, { key: "party", label: "Party" },
      { key: "memo", label: "Narration" }, { key: "description", label: "Line", hidden: true }, { key: "debit", label: "Debit", kind: "money", total: true }, { key: "credit", label: "Credit", kind: "money", total: true },
      { key: "balance", label: "Balance", kind: "money" }] },
  { code: "trial_balance", title: "Trial balance", category: "Finance", perms: ["journals.view"], params: ["asOf"], description: "Debit and credit balance of every account as of a date.",
    run: (p, c) => call("trial_balance", { p_company_id: c, p_as_of: d(p.asOf) }), link: (r) => `/reports/general_ledger?account=${r.account_id}`,
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "account_type", label: "Type", kind: "badge" }, { key: "parent_code", label: "Group", hidden: true },
      { key: "debit", label: "Debit", kind: "money", total: true }, { key: "credit", label: "Credit", kind: "money", total: true }] },
  { code: "party_ledger", dateKey: "entry_date", title: "Party ledger", category: "Finance", perms: ["journals.view"], params: ["party", "range"], required: ["party"], rangePreset: "all",
    description: "Ledger of any customer, supplier, payment agent or employee.",
    run: (p) => call("party_statement", { p_party_type: p.party?.type, p_party_id: p.party?.id, p_from: d(p.from), p_to: d(p.to), p_include_linked: false }),
    link: (r) => (r.entry_id ? `/vouchers?view=${r.entry_id}` : null), columns: LEDGER_COLS(),
    quick: { columns: ["entry_date", "entry_no", "debit", "credit", "balance"], limit: 10, sortDesc: "__index" } },
  { code: "receivables", title: "Receivables (balances)", category: "Finance", perms: ["journals.view"], route: "/receivables", description: "Customer balances as of a date." },
  { code: "payables", title: "Payables (balances)", category: "Finance", perms: ["journals.view"], route: "/payables", description: "Supplier balances as of a date." },

  /* ------------------------------------------------------------------ Cash, bank & cheques */
  { code: "cash_bank_summary", title: "Cash & bank summary", category: "Cash, bank & cheques", perms: ["journals.view"], params: ["range"], rangePreset: "month",
    description: "Opening, money in, money out and closing for every bank / cash account, with reconciliation status.",
    run: (p, c) => call("rpt_cash_bank_summary", { p_company: c, p_from: d(p.from), p_to: d(p.to) }), link: (r) => `/bank-book?bank=${r.bank_account_id}`,
    columns: [{ key: "name", label: "Account" }, { key: "kind", label: "Kind", kind: "badge" }, { key: "currency", label: "Cur.", hidden: true }, { key: "opening", label: "Opening", kind: "money", total: true },
      { key: "money_in", label: "In", kind: "money", total: true }, { key: "money_out", label: "Out", kind: "money", total: true }, { key: "closing", label: "Closing", kind: "money", total: true },
      { key: "reconciled_until", label: "Reconciled until", kind: "date" }, { key: "unmatched_items", label: "Not reconciled", kind: "int" }] },
  { code: "bank_book", dateKey: "entry_date", title: "Cash / bank book", category: "Cash, bank & cheques", perms: ["journals.view"], params: ["bank", "range"], required: ["bank"], rangePreset: "month",
    description: "Every movement on one bank / cash account with running balance.",
    run: (p) => call("bank_book", { p_bank_account_id: p.bank, p_from: d(p.from), p_to: d(p.to) }), link: (r) => (r.entry_id ? `/vouchers?view=${r.entry_id}` : null),
    columns: [{ key: "entry_date", label: "Date", kind: "date" }, { key: "entry_no", label: "Entry" }, { key: "party_name", label: "Party" }, { key: "memo", label: "Narration" },
      { key: "reference", label: "Reference", hidden: true }, { key: "debit", label: "In", kind: "money", total: true }, { key: "credit", label: "Out", kind: "money", total: true }, { key: "balance", label: "Balance", kind: "money" }],
    quick: { columns: ["entry_date", "entry_no", "debit", "credit", "balance"], limit: 10, sortDesc: "__index" } },
  { code: "uncleared_items", title: "Unreconciled bank items", category: "Cash, bank & cheques", perms: ["journals.view"], params: ["bank", "asOf"], required: ["bank"],
    description: "Book entries on a bank account not yet matched to the bank statement (uncleared cheques, deposits in transit).",
    run: (p, c) => call("rpt_uncleared_items", { p_company: c, p_bank: p.bank, p_as_of: d(p.asOf) }), link: (r) => `/vouchers?view=${r.entry_id}`,
    columns: [{ key: "entry_date", label: "Date", kind: "date" }, { key: "entry_no", label: "Entry" }, { key: "entry_type", label: "Type", kind: "badge" }, { key: "party", label: "Party" },
      { key: "memo", label: "Narration" }, { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", kind: "money", total: true }, { key: "age_days", label: "Age (days)", kind: "int" }],
    quick: { columns: ["entry_date", "entry_no", "amount", "age_days"], limit: 10 } },
  { code: "pdc_register", dateKey: "cheque_date", title: "PDC register", category: "Cash, bank & cheques", perms: ["journals.view", "pdc.manage"], params: ["range", "party"], rangePreset: "all",
    description: "Post-dated cheques received and issued with status, due date and bounce count.",
    run: async (p, c) => {
      let q = sb().from("pdc_records_v").select("*").eq("company_id", c);
      if (p.from) q = q.gte("cheque_date", p.from); if (p.to) q = q.lte("cheque_date", p.to); if (p.party?.id) q = q.eq("party_id", p.party.id);
      const { data, error } = await q.order("cheque_date"); if (error) throw error; return data ?? [];
    },
    link: (r) => `/pdc?view=${r.id}${r.direction === "ISSUED" ? "&dir=ISSUED" : ""}`, groupBy: "status",
    columns: [{ key: "direction", label: "Received / issued", kind: "badge" }, { key: "cheque_date", label: "Cheque date", kind: "date" }, { key: "cheque_no", label: "Cheque" },
      { key: "party_name", label: "Party" }, { key: "drawer_bank", label: "Their bank", hidden: true }, { key: "bank_name", label: "Our bank" }, { key: "amount", label: "Amount", kind: "money", total: true },
      { key: "status", label: "Status", kind: "badge" }, { key: "bounce_count", label: "Bounced", kind: "int" }, { key: "doc_no", label: "No.", hidden: true }],
    quick: { columns: ["cheque_date", "cheque_no", "amount", "status"], limit: 10, sortDesc: "cheque_date" } },
  { code: "bank_reconciliation", title: "Bank reconciliation", category: "Cash, bank & cheques", perms: ["journals.view", "bank.reconcile"], route: "/bank-reconciliation", description: "Statement import, matching and reconciliation history." },

  /* ------------------------------------------------------------------ People */
  { code: "payroll_register", title: "Payroll register", category: "People", perms: ["payroll.view"], params: ["range"], rangePreset: "year",
    description: "Salary, labour, bonuses, deductions, advance recovery, net pay and unpaid balance per employee per month.",
    run: (p, c) => call("rpt_payroll_register", { p_company: c, p_from: d(p.from), p_to: d(p.to) }), link: (r) => `/payroll?view=${r.run_id}`, groupBy: "period_month",
    columns: [{ key: "period_month", label: "Month", kind: "date" }, { key: "run_no", label: "Run", hidden: true }, { key: "employee", label: "Employee" }, { key: "department", label: "Department", hidden: true },
      { key: "basic_salary", label: "Salary", kind: "money", total: true }, { key: "assembly_labour", label: "Labour", kind: "money", total: true }, { key: "bonus", label: "Bonus", kind: "money", total: true },
      { key: "other_earnings", label: "Other earnings", kind: "money", total: true }, { key: "gross", label: "Gross", kind: "money", total: true }, { key: "leave_deduction", label: "Leave ded.", kind: "money", total: true },
      { key: "other_deductions", label: "Other ded.", kind: "money", total: true }, { key: "advance_recovery", label: "Advance rec.", kind: "money", total: true }, { key: "net_pay", label: "Net", kind: "money", total: true },
      { key: "paid", label: "Paid", kind: "money", total: true }, { key: "unpaid", label: "Unpaid", kind: "money", total: true }] },
  { code: "employee_advances", title: "Employee advances & recovery", category: "People", perms: ["payroll.view"],
    description: "Every advance with amount recovered, written off and still outstanding.",
    run: (_p, c) => call("rpt_employee_advances", { p_company: c }),
    columns: [{ key: "advance_date", label: "Date", kind: "date" }, { key: "doc_no", label: "Advance" }, { key: "employee", label: "Employee" }, { key: "amount", label: "Amount", kind: "money", total: true },
      { key: "recovered", label: "Recovered", kind: "money", total: true }, { key: "written_off", label: "Written off", kind: "money", total: true }, { key: "outstanding", label: "Outstanding", kind: "money", total: true },
      { key: "per_month", label: "Per month", kind: "money" }, { key: "status", label: "Status", kind: "badge" }, { key: "reason", label: "Reason", hidden: true }] },
  { code: "pay_items", dateKey: "item_date", title: "Bonuses, overtime & other pay items", category: "People", perms: ["payroll.view"], params: ["range", "payType"], rangePreset: "year",
    description: "Approved / pending bonuses, overtime, allowances, fines and labour earnings.",
    run: (p, c) => call("rpt_pay_items", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_type: d(p.payType) }), groupBy: "item_type",
    columns: [{ key: "item_date", label: "Date", kind: "date" }, { key: "employee", label: "Employee" }, { key: "item_type", label: "Type", kind: "badge" }, { key: "direction", label: "Earning / deduction", hidden: true },
      { key: "product", label: "Assembled item" }, { key: "quantity", label: "Qty", kind: "qty", total: true }, { key: "rate", label: "Rate", kind: "money" }, { key: "amount", label: "Amount", kind: "money", total: true },
      { key: "status", label: "Status", kind: "badge" }, { key: "description", label: "Description", hidden: true }] },
  { code: "labour_earnings", dateKey: "item_date", title: "Assembly labour earnings", category: "People", perms: ["payroll.view", "labour.supervise"], params: ["range"], rangePreset: "month",
    description: "Piece-rate labour: quantity, rate and earning per employee and assembled item.",
    run: (p, c) => call("rpt_pay_items", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_type: "ASSEMBLY_LABOUR" }), groupBy: "employee",
    columns: [{ key: "item_date", label: "Date", kind: "date" }, { key: "employee", label: "Employee" }, { key: "product", label: "Item / variant" }, { key: "quantity", label: "Qty", kind: "qty", total: true },
      { key: "rate", label: "Rate", kind: "money" }, { key: "amount", label: "Earning", kind: "money", total: true }, { key: "status", label: "Status", kind: "badge" }] },

  /* ------------------------------------------------------------------ Administration */
  { code: "activity", dateKey: "created_at", title: "Audit / activity", category: "Administration", perms: ["audit.view"], params: ["range", "entity"], rangePreset: "month",
    description: "Who created or changed what, and when (latest 5,000 changes in the range).",
    run: (p, c) => call("rpt_activity", { p_company: c, p_from: d(p.from), p_to: d(p.to), p_entity: d(p.entity), p_user: null }),
    columns: [{ key: "created_at", label: "When", kind: "datetime" }, { key: "user_name", label: "User" }, { key: "action", label: "Action", kind: "badge" }, { key: "entity_type", label: "Record type" },
      { key: "changed_fields", label: "Fields changed" }, { key: "entity_id", label: "Record id", hidden: true }] },
];

function LEDGER_COLS(): Col[] {
  return [{ key: "entry_date", label: "Date", kind: "date" }, { key: "entry_no", label: "Entry" }, { key: "entry_type", label: "Type", kind: "badge", hidden: true }, { key: "memo", label: "Details" },
    { key: "reference", label: "Reference", hidden: true }, { key: "debit", label: "Debit", kind: "money", total: true }, { key: "credit", label: "Credit", kind: "money", total: true }, { key: "balance", label: "Balance", kind: "money" }];
}

export function previousPeriod(from: string, to: string): [string, string] {
  const f = new Date(from + "T00:00:00Z"), t = new Date(to + "T00:00:00Z");
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const pt = new Date(f.getTime() - 86400000), pf = new Date(pt.getTime() - (days - 1) * 86400000);
  return [pf.toISOString().slice(0, 10), pt.toISOString().slice(0, 10)];
}

export const REPORT = Object.fromEntries(REPORTS.map((r) => [r.code, r])) as Record<string, ReportDef>;
export const canSee = (r: ReportDef, can: (p: string) => boolean) => r.perms.some((p) => can(p));

/** shortcut contexts → which report parameter they can fill */
export type ContextKey = "CUSTOMER" | "SUPPLIER" | "PRODUCT" | "BANK_ACCOUNT" | "PARTY" | "VOUCHER";
export type Context = Partial<Record<ContextKey, string | PartyRef | null | undefined>>;
export function paramsFromContext(r: ReportDef, mapping: Record<string, string>, ctx: Context): Params | null {
  const p: Params = {};
  for (const [param, key] of Object.entries(mapping)) {
    const v = ctx[key as ContextKey];
    if (!v) return null;
    if (param === "party") p.party = typeof v === "string" ? { type: key === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER", id: v } : v;
    else if (param === "customer" || param === "supplier" || param === "bank" || param === "warehouse" || param === "account") p[param] = typeof v === "string" ? v : v.id;
    else return null; // only declared parameter names are accepted
  }
  for (const req of r.required ?? []) if (!(p as Record<string, unknown>)[req]) return null;
  return p;
}
