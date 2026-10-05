import { describe, expect, it } from "vitest";
import { asOfPreset, periodRange } from "../../apps/admin-erp/src/reports/periods";
import { defaultPeriodRange, latestN } from "../../apps/admin-erp/src/reports/ReportView";
import type { ReportDef } from "../../apps/admin-erp/src/reports/registry";

const now = new Date(2026, 9, 7); // Wed 7 Oct 2026

describe("periodRange", () => {
  it("covers the common presets", () => {
    expect(periodRange("today", now)).toEqual({ from: "2026-10-07", to: "2026-10-07" });
    expect(periodRange("yesterday", now)).toEqual({ from: "2026-10-06", to: "2026-10-06" });
    expect(periodRange("week", now)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("lastweek", now)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(periodRange("month", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("lastmonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("quarter", now)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("lastquarter", now)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodRange("year", now)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("lastyear", now)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(periodRange("last10", now)).toEqual({ from: null, to: null });
  });
  it("handles January and Sunday edges", () => {
    expect(periodRange("lastmonth", new Date(2026, 0, 15))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("week", new Date(2026, 9, 11))).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });
  it("as-of shortcuts", () => {
    expect(asOfPreset("lastmonthend", now)).toBe("2026-09-30");
    expect(asOfPreset("lastquarterend", now)).toBe("2026-09-30");
    expect(asOfPreset("lastyearend", now)).toBe("2025-12-31");
  });
});

describe("report defaults", () => {
  const tx = { code: "x", dateKey: "d", params: ["range"], rangePreset: "month" } as unknown as ReportDef;
  const summary = { code: "y", params: ["range"], rangePreset: "year" } as unknown as ReportDef;
  it("transaction reports open on Last 10", () => {
    expect(defaultPeriodRange(tx, new URLSearchParams()).period).toBe("last10");
    expect(defaultPeriodRange(summary, new URLSearchParams()).period).toBe("year");
    expect(defaultPeriodRange(summary, new URLSearchParams("period=last10")).period).toBe("year"); // not offered for summaries
    expect(defaultPeriodRange(tx, new URLSearchParams("from=2026-01-01&to=2026-01-31"))).toEqual({ period: "custom", from: "2026-01-01", to: "2026-01-31" });
  });
  it("latestN keeps the newest N, drops the opening line", () => {
    const rows = [{ row_kind: "OPENING", d: "2026-01-01", __index: 0 }, ...Array.from({ length: 15 }, (_, i) => ({ d: `2026-02-${String(i + 1).padStart(2, "0")}`, __index: i + 1 }))];
    const out = latestN(tx, rows, "last10");
    expect(out).toHaveLength(10);
    expect(out[0].d).toBe("2026-02-15");
    expect(out.some((r) => r.row_kind === "OPENING")).toBe(false);
    expect(latestN(tx, rows, "month")).toHaveLength(16);
  });
});
