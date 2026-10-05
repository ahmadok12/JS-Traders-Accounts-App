import { describe, expect, it, vi } from "vitest";
vi.mock("@jst/data-access", () => ({ sb: () => ({}) }));
import { REPORT, REPORTS, paramsFromContext, previousPeriod } from "../../apps/admin-erp/src/reports/registry";

describe("report registry", () => {
  it("has unique codes and every runnable report has columns", () => {
    expect(new Set(REPORTS.map((r) => r.code)).size).toBe(REPORTS.length);
    for (const r of REPORTS) expect(!!r.route || (!!r.run && (r.columns?.length ?? 0) > 0)).toBe(true);
  });
  it("maps shortcut context only to declared parameters", () => {
    expect(paramsFromContext(REPORT.customer_ledger, { party: "CUSTOMER" }, { CUSTOMER: "c1" })).toEqual({ party: { type: "CUSTOMER", id: "c1" } });
    expect(paramsFromContext(REPORT.customer_ledger, { party: "CUSTOMER" }, {})).toBeNull();
    expect(paramsFromContext(REPORT.sales_register, { sql: "CUSTOMER" }, { CUSTOMER: "c1" })).toBeNull();
    expect(paramsFromContext(REPORT.bank_book, { bank: "BANK_ACCOUNT" }, { BANK_ACCOUNT: "b1" })).toEqual({ bank: "b1" });
  });
  it("previous period has the same length", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual(["2026-08-31", "2026-09-30"]);
  });
});
