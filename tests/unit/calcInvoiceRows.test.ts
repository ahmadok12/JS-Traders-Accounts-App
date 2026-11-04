import { describe, expect, it } from "vitest";
import { customerRows } from "../../apps/admin-erp/src/sales/calc/invoiceRows";

const lines = [
  { line_no: 1, label: "Augar 45mm", quantity: 1720, uom: "FT", unit_price: 200 },          // 344,000
  { line_no: 2, label: "Feed Pan · China", quantity: 700, uom: "PCS", unit_price: 140 },    // 98,000 (688 in package + 12 loose)
  { line_no: 3, label: "Winch Handle", quantity: 1, uom: "PCS", unit_price: 3640 },         // 3,640
];
// package items: 344,000 + 688×140 (96,320) + 3,640 = 443,960; discount 3,960 → 440,000 = 4 × 110,000
const pk = {
  packages: [{ id: "p1", name: "Branch Feeding Line", unit_label: "line", quantity: 4, billed: 443960, full: 443960, discount: 3960 }],
  parts: [{ line_no: 1, package_id: "p1", qty: 1720 }, { line_no: 2, package_id: "p1", qty: 688 }, { line_no: 3, package_id: "p1", qty: 1 }],
};
const subtotal = 344000 + 98000 + 3640;

describe("invoice — customer view of calculator packages", () => {
  it("prints one row per package with lines × price per line, loose items separately", () => {
    const r = customerRows(lines, pk, 3960, subtotal);
    expect(r.rows).toEqual([
      { kind: "package", label: "Branch Feeding Line", quantity: 4, uom: "lines", unit_price: 110000, amount: 440000 },
      { kind: "item", label: "Feed Pan · China", quantity: 12, uom: "PCS", unit_price: 140, amount: 1680 },
    ]);
    expect(r.subtotal).toBe(441680);
    expect(r.discount).toBe(0);
    expect(r.subtotal - r.discount).toBe(subtotal - 3960);   // same invoice total
  });
  it("keeps an order-level discount on top as its own line", () => {
    const r = customerRows(lines, pk, 3960 + 680, subtotal);
    expect(r.discount).toBe(680);
    expect(r.subtotal - r.discount).toBe(subtotal - 3960 - 680);
  });
  it("shows the delivered share of a part-delivered package", () => {
    const half = { ...pk, packages: [{ ...pk.packages[0], billed: 221980 }] };
    const r = customerRows(lines.slice(0, 1).map((l) => ({ ...l, quantity: 860 })), { ...half, parts: [{ line_no: 1, package_id: "p1", qty: 860 }] }, 1980, 172000);
    expect(r.rows[0]).toMatchObject({ kind: "package", quantity: 2, amount: 220000, unit_price: 110000 });
  });
  it("never takes more package discount than the invoice has", () => {
    const r = customerRows(lines, pk, 1000, subtotal);
    expect(r.packageDiscount).toBe(1000);
    expect(r.discount).toBe(0);
  });
  it("without packages prints the items as they are", () => {
    const r = customerRows(lines, { packages: [], parts: [] }, 0, subtotal);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((x) => x.kind === "item")).toBe(true);
  });
});
