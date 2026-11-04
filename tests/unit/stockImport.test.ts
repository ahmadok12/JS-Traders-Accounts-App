import { describe, expect, it } from "vitest";
import { findHeader, matchRows, type CatalogItem } from "../../apps/admin-erp/src/inventory/stockImport";

const cat: CatalogItem[] = [
  { product_id: "p1", variant_id: null, sku: "P-00001", product: "Feed Pipe Collar", variant: null, uom: "PCS", rolls: false },
  { product_id: "p2", variant_id: "v1", sku: "P-00002-01", product: "Feed Pipe Round", variant: "China", uom: "PCS", rolls: false },
  { product_id: "p2", variant_id: "v2", sku: "P-00002-02", product: "Feed Pipe Round", variant: "Local", uom: "PCS", rolls: false },
  { product_id: "p3", variant_id: null, sku: "P-00011", product: "Augar 45mm", variant: null, uom: "FT", rolls: true },
];
const whs = [{ id: "w1", code: "WH-01", name: "Main" }, { id: "w2", code: "WH-02", name: "Shop" }];

describe("counted stock import", () => {
  it("finds the header row under a title", () => {
    expect(findHeader([["JS Traders stock count"], [], ["SKU", "Product", "Variant", "Unit", "Counted qty"]])?.at).toBe(2);
    expect(findHeader([["Item", "Quantity"]])?.col).toMatchObject({ product: 0, qty: 1 });
    expect(findHeader([["Name", "Price"]])).toBeNull();
  });
  it("matches by SKU or by product + variant, skips empty quantities, keeps 0", () => {
    const { rows, problem } = matchRows([
      ["SKU", "Product", "Variant", "Counted qty"],
      ["P-00001", "Feed Pipe Collar", "", 120],
      ["", "Feed Pipe Round", "local", "35"],
      ["P-00011", "", "", "1,250.5"],
      ["P-00002-01", "", "", ""],          // not counted yet
      ["P-00002-01", "", "", 0],           // counted: none
    ], cat, whs, "w1");
    expect(problem).toBeNull();
    expect(rows.map((r) => [r.product_id, r.variant_id, r.qty, r.error])).toEqual([
      ["p1", null, 120, null], ["p2", "v2", 35, null], ["p3", null, 1250.5, null], ["p2", "v1", 0, null],
    ]);
  });
  it("explains what is wrong with a row", () => {
    const { rows } = matchRows([
      ["Product", "Variant", "Qty"],
      ["Feed Pipe Round", "", 5], ["Feed Pipe Round", "Blue", 5], ["Unknown thing", "", 5], ["Feed Pipe Collar", "", -3], ["Feed Pipe Collar", "", "abc"],
    ], cat, whs, "w1");
    expect(rows.map((r) => r.error)).toEqual([
      "“Feed Pipe Round” has variants — fill the Variant column", "Variant “Blue” of “Feed Pipe Round” not found",
      "“Unknown thing” is not in the product list", "Quantity is not a number (0 or more)", "Quantity is not a number (0 or more)",
    ]);
  });
  it("uses a Warehouse column and adds up the same item in one warehouse", () => {
    const { rows } = matchRows([
      ["SKU", "Warehouse", "Count"],
      ["P-00001", "WH-01", 10], ["P-00001", "wh-01", 5], ["P-00001", "Shop", 7], ["P-00001", "Nowhere", 1],
    ], cat, whs, null);
    expect(rows.map((r) => [r.warehouse_id, r.qty, r.error])).toEqual([["w1", 15, null], ["w2", 7, null], [null, 1, "Warehouse “Nowhere” not found"]]);
  });
  it("needs a warehouse when the sheet has none", () => {
    expect(matchRows([["SKU", "Qty"], ["P-00001", 4]], cat, whs, null).rows[0].error).toBe("Choose the warehouse");
  });
});
