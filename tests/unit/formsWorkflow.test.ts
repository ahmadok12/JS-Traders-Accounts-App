import { describe, expect, it } from "vitest";
import { mergeLayouts, type FormLayoutRow } from "../../apps/admin-erp/src/lib/formLayouts";
import { cfPayload, validateCf, type CfDef } from "../../apps/admin-erp/src/lib/customFields";

const row = (role: string, p: Partial<FormLayoutRow>): FormLayoutRow => ({
  entity: "customers", role_code: role, hidden_fields: [], required_fields: [], hidden_sections: [], open_sections: [], ...p,
});

describe("forms per role", () => {
  const rows = [
    row("SALESPERSON", { hidden_fields: ["ntn", "credit_limit"], required_fields: ["phone"], hidden_sections: ["credit"] }),
    row("ACCOUNTANT", { hidden_fields: ["ntn"], open_sections: ["credit"] }),
  ];
  it("one role: its own layout", () => {
    const l = mergeLayouts(rows, ["SALESPERSON"]);
    expect([...l.hidden].sort()).toEqual(["credit_limit", "ntn"]);
    expect([...l.required]).toEqual(["phone"]);
    expect(l.hiddenSections.has("credit")).toBe(true);
  });
  it("two roles: hidden only when both hide it; required when either requires it", () => {
    const l = mergeLayouts(rows, ["SALESPERSON", "ACCOUNTANT"]);
    expect([...l.hidden]).toEqual(["ntn"]);
    expect([...l.required]).toEqual(["phone"]);
    expect(l.hiddenSections.size).toBe(0);
    expect(l.openSections.has("credit")).toBe(true);
  });
  it("a role without a layout sees the whole form", () => {
    const l = mergeLayouts(rows, ["SALESPERSON", "OWNER"]);
    expect(l.hidden.size).toBe(0);
    expect([...l.required]).toEqual(["phone"]);
  });
  it("required wins over hidden", () => {
    const l = mergeLayouts([row("SALESPERSON", { hidden_fields: ["phone"] }), row("OWNER", { hidden_fields: ["phone"], required_fields: ["phone"] })], ["SALESPERSON", "OWNER"]);
    expect(l.hidden.has("phone")).toBe(false);
    expect(l.required.has("phone")).toBe(true);
  });
});

describe("new custom field types", () => {
  const base = { code: "", options: [], help_text: null, show_in_list: false, sort_order: 0, is_active: true };
  const defs: CfDef[] = [
    { ...base, id: "f", entity: "customers", label: "Capacity", field_type: "formula", required: false, formula: "{a} * {b}" },
    { ...base, id: "t", entity: "customers", label: "Last visit", field_type: "datetime", required: false },
    { ...base, id: "r", entity: "customers", label: "Referred by", field_type: "reference", required: true, ref_entity: "customers" },
    { ...base, id: "d", entity: "sales_orders", label: "Site contact", field_type: "text", required: true },
  ];
  it("formula values are never sent (the database calculates them)", () => {
    const p = cfPayload(defs, { f: "99", t: "2026-11-02T22:30", r: "abc", d: "" });
    expect("f" in p).toBe(false);
    expect(p.t).toBe(new Date("2026-11-02T22:30").toISOString());
    expect(p.r).toBe("abc");
    expect(p.d).toBeNull();
  });
  it("required document fields may stay empty while editing (checked at approve / post)", () => {
    const e = validateCf(defs, { f: "", t: "", r: "", d: "" });
    expect(e.r).toBe("Required");
    expect(e.d).toBeUndefined();
    expect(e.f).toBeUndefined();
  });
});
