/**
 * Printable documents known to the template engine (Settings → Documents).
 * `columns` / `meta` are the labels each screen sends to the printer — the template can
 * rename or hide them. `sample` feeds the live preview in the editor.
 */
export interface DocTypeDef {
  key: string;
  label: string;
  group: "Sales" | "Purchasing" | "Accounting" | "HR";
  title: string;
  columns: { label: string; align?: "right" }[];
  meta: string[];
  signatures: string[];
  sampleRows: string[][];
  sampleTotals?: [string, string][];
}

const item = ["#", "Item", "Qty", "Price", "Amount"] as const;
const itemCols = item.map((l) => ({ label: l, align: (["Qty", "Price", "Amount"] as string[]).includes(l) ? ("right" as const) : undefined }));
const pricedRows = [
  ["1", "Nipple drinker line 3m · Red", "120 PCS", "1,450.00", "174,000.00"],
  ["2", "Feeder pan — automatic", "40 PCS", "2,300.00", "92,000.00"],
];
const pricedTotals: [string, string][] = [["Subtotal", "266,000.00"], ["Discount", "-6,000.00"], ["Total", "260,000.00"]];

export const DOC_TYPES: DocTypeDef[] = [
  { key: "QUOTATION", label: "Quotation", group: "Sales", title: "Quotation", columns: itemCols,
    meta: ["Customer", "Date", "Valid until", "Your reference"], signatures: ["Prepared by", "Accepted by (customer)"], sampleRows: pricedRows, sampleTotals: pricedTotals },
  { key: "SALES_ORDER", label: "Sales order", group: "Sales", title: "Sales Order", columns: itemCols,
    meta: ["Customer", "Date", "Customer ref.", "Status"], signatures: ["Prepared by", "Approved by"], sampleRows: pricedRows, sampleTotals: pricedTotals },
  { key: "GDN", label: "Delivery note (GDN)", group: "Sales", title: "Delivery Note",
    columns: [{ label: "#" }, { label: "Item" }, { label: "From" }, { label: "Quantity", align: "right" }],
    meta: ["Customer", "Date", "Sales order", "Customer ref.", "Transport"], signatures: ["Dispatched by", "Driver / transporter", "Received by (customer)"],
    sampleRows: [["1", "Nipple drinker line 3m · Red", "WH-01", "120 PCS"], ["2", "Feeder pan — automatic", "WH-02", "40 PCS"]] },
  { key: "SALES_INVOICE", label: "Sales invoice", group: "Sales", title: "Sales Invoice", columns: itemCols,
    meta: ["Customer", "Invoice date", "Due date", "Customer ref.", "Delivery notes"], signatures: ["Prepared by", "Customer signature"], sampleRows: pricedRows, sampleTotals: pricedTotals },
  { key: "SALES_RETURN", label: "Sales return", group: "Sales", title: "Goods Return Note (from customer)",
    columns: [{ label: "#" }, { label: "Item" }, { label: "Into" }, { label: "Condition" }, { label: "Quantity", align: "right" }],
    meta: ["Customer", "Date", "GDN", "Reason"], signatures: ["Received by (warehouse)", "Returned by (customer / driver)", "Checked by"],
    sampleRows: [["1", "Feeder pan — automatic", "WH-01", "Good", "4 PCS"]] },
  { key: "RECEIPT_VOUCHER", label: "Receipt voucher", group: "Accounting", title: "Receipt Voucher",
    columns: [{ label: "Account" }, { label: "Description" }, { label: "Debit", align: "right" }, { label: "Credit", align: "right" }],
    meta: ["Received from", "Date", "Reference", "Bank / cash"], signatures: ["Received by", "Approved by"],
    sampleRows: [["1010 · Meezan Current", "Cheque 004512", "150,000.00", ""], ["1200 · Accounts receivable", "Al-Noor Poultry Farm", "", "150,000.00"]],
    sampleTotals: [["Amount", "150,000.00"]] },
  { key: "PAYMENT_VOUCHER", label: "Payment voucher", group: "Accounting", title: "Payment Voucher",
    columns: [{ label: "Account" }, { label: "Description" }, { label: "Debit", align: "right" }, { label: "Credit", align: "right" }],
    meta: ["Paid to", "Date", "Reference", "Bank / cash"], signatures: ["Prepared by", "Approved by", "Received by"],
    sampleRows: [["5300 · Freight", "Loader rent", "8,500.00", ""], ["1000 · Cash in hand", "", "", "8,500.00"]], sampleTotals: [["Amount", "8,500.00"]] },
  { key: "JOURNAL_VOUCHER", label: "Journal voucher", group: "Accounting", title: "Journal Voucher",
    columns: [{ label: "Account" }, { label: "Description" }, { label: "Debit", align: "right" }, { label: "Credit", align: "right" }],
    meta: ["Date", "Reference", "Memo"], signatures: ["Prepared by", "Approved by"],
    sampleRows: [["5100 · Salaries", "", "45,000.00", ""], ["2100 · Salaries payable", "", "", "45,000.00"]], sampleTotals: [["Total", "45,000.00"]] },
  { key: "PURCHASE_ORDER", label: "Purchase order", group: "Purchasing", title: "Purchase Order", columns: itemCols,
    meta: ["Supplier", "Date", "Expected", "Currency", "Supplier ref."], signatures: ["Prepared by", "Approved by"], sampleRows: pricedRows, sampleTotals: pricedTotals },
  { key: "SUPPLIER_BILL", label: "Supplier bill", group: "Purchasing", title: "Supplier Bill",
    columns: [{ label: "#" }, { label: "Item / expense" }, { label: "Qty", align: "right" }, { label: "Price", align: "right" }, { label: "Amount", align: "right" }],
    meta: ["Supplier", "Bill date", "Supplier invoice", "Currency"], signatures: ["Checked by", "Approved by"], sampleRows: pricedRows, sampleTotals: pricedTotals },
  { key: "PURCHASE_RETURN", label: "Purchase return", group: "Purchasing", title: "Goods Return Note (to supplier)",
    columns: [{ label: "#" }, { label: "Item" }, { label: "Quantity", align: "right" }],
    meta: ["Supplier", "Date", "Goods receipt", "Reason"], signatures: ["Dispatched by (warehouse)", "Received by (supplier / transporter)", "Approved by"],
    sampleRows: [["1", "Nipple drinker line 3m · Red", "10 PCS"]] },
  { key: "SHIPMENT", label: "Shipment / packing list", group: "Purchasing", title: "Shipment / Packing list",
    columns: [{ label: "#" }, { label: "Item" }, { label: "Container" }, { label: "Qty", align: "right" }, { label: "Pkgs", align: "right" }, { label: "Weight kg", align: "right" }, { label: "CBM", align: "right" }],
    meta: ["Supplier", "B/L / AWB", "Vessel / voyage", "From", "To", "ETD / ETA", "Containers", "Commercial invoice", "GD no."], signatures: [],
    sampleRows: [["1", "Feeder pan — automatic", "MSKU1234567", "400 PCS", "20", "820", "6.4"]], sampleTotals: [["Total weight kg", "820"], ["Total CBM", "6.4"]] },
  { key: "LANDED_COST", label: "Landed cost", group: "Purchasing", title: "Landed cost",
    columns: [{ label: "Charge" }, { label: "Paid / owed to" }, { label: "Treatment" }, { label: "Split" }, { label: "PKR", align: "right" }],
    meta: ["Date", "Shipment", "Status"], signatures: ["Prepared by", "Approved by"],
    sampleRows: [["Sea freight", "Forwarder", "Stock cost", "By weight", "120,000.00"]], sampleTotals: [["Total", "120,000.00"]] },
  { key: "PAYROLL", label: "Payroll register", group: "HR", title: "Payroll Register",
    columns: [{ label: "Employee" }, { label: "Salary", align: "right" }, { label: "Days", align: "right" }, { label: "Leave ded.", align: "right" }, { label: "Labour", align: "right" },
      { label: "Bonus/other", align: "right" }, { label: "Gross", align: "right" }, { label: "Deductions", align: "right" }, { label: "Advance", align: "right" }, { label: "Net pay", align: "right" }, { label: "Signature" }],
    meta: ["Month", "Status", "Accounting date"], signatures: ["Prepared by", "Approved by", "Paid by"],
    sampleRows: [["Imran Ali", "35,000", "30/31", "0", "4,200", "0", "39,200", "0", "2,000", "37,200", ""]], sampleTotals: [["Net pay", "37,200"]] },
];

export type DocTypeKey = (typeof DOC_TYPES)[number]["key"];
export const docTypeDef = (key?: string | null) => DOC_TYPES.find((d) => d.key === key);
