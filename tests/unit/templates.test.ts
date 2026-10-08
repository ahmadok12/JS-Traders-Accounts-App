import { describe, expect, it } from "vitest";
import { applyTemplate, autoHeaderLines, mergeSettings, renderHtml, type PrintSpecBase, type TemplateBundle } from "../../apps/admin-erp/src/documents/template";
import { renderPdf } from "../../apps/admin-erp/src/sales/pdf";
import { cfPayload, validateCf, type CfDef } from "../../apps/admin-erp/src/lib/customFields";
import { nextCode } from "../../apps/admin-erp/src/settings/NumberingSettings";
import { DOC_TYPES } from "../../apps/admin-erp/src/documents/registry";

const spec: PrintSpecBase = {
  company: "JS Traders", title: "Sales Invoice", docNo: "INV-2026-00007", docType: "SALES_INVOICE",
  meta: [["Customer", "Al-Noor Farm"], ["Invoice date", "08 Oct 2026"], ["Due date", ""], ["Customer ref.", "PO-1"], ["Delivery notes", "GDN-2026-00003"]],
  columns: [{ label: "#" }, { label: "Item" }, { label: "Qty", align: "right" }, { label: "Price", align: "right" }, { label: "Amount", align: "right" }],
  rows: [["1", "Drinker <line>", "10 PCS", "1,450.00", "14,500.00"]],
  totals: [["Subtotal", "14,500.00"], ["Total", "14,500.00"]],
  notes: "Gate 2", signatures: ["Prepared by", "Customer signature"],
};
const company = { name: "JS Traders", legal_name: "JS Traders (Pvt) Ltd", address: "Depalpur Road, Okara", phone: "0300-1234567", email: "info@jstradersokr.shop", ntn: "1234567-8", strn: null };

describe("document templates", () => {
  it("without a template prints exactly what the screen sent", () => {
    const d = applyTemplate(spec, null);
    expect(d.title).toBe("Sales Invoice");
    expect(d.columns.map((c) => c.label)).toEqual(["#", "Item", "Qty", "Price", "Amount"]);
    expect(d.rows[0]).toHaveLength(5);
    expect(d.signatures).toEqual(["Prepared by", "Customer signature"]);
    expect(d.totals).toHaveLength(2);
  });

  it("hides / renames columns, hides meta, adds terms + footer, never changes values", () => {
    const t: TemplateBundle = {
      settings: mergeSettings({ accent: "#0055aa", footer: "Thank you", headerName: "legal_name" },
        { title: "Tax Invoice", columns: { "#": { hidden: true }, Qty: { label: "Quantity" } }, hiddenMeta: ["Customer ref."], terms: "No returns after 7 days", signatures: ["Accounts", "Customer"] }),
      logo: null, company,
    };
    const d = applyTemplate(spec, t);
    expect(d.title).toBe("Tax Invoice");
    expect(d.columns.map((c) => c.label)).toEqual(["Item", "Quantity", "Price", "Amount"]);
    expect(d.rows[0]).toEqual(["Drinker <line>", "10 PCS", "1,450.00", "14,500.00"]);
    expect(d.meta.map(([k]) => k)).not.toContain("Customer ref.");
    expect(d.companyName).toBe("JS Traders (Pvt) Ltd");
    expect(d.companyLines).toEqual(["Depalpur Road, Okara", "0300-1234567 · info@jstradersokr.shop", "NTN 1234567-8"]);
    expect(d.signatures).toEqual(["Accounts", "Customer"]);
    expect(d.accent).toBe("#0055aa");
    const html = renderHtml(d);
    expect(html).toContain("No returns after 7 days");
    expect(html).toContain("Thank you");
    expect(html).toContain("Drinker &lt;line&gt;"); // escaped
    expect(html).not.toContain("<script>");
  });

  it("never hides every column and ignores a bad colour", () => {
    const all = Object.fromEntries(spec.columns.map((c) => [c.label, { hidden: true }]));
    const d = applyTemplate(spec, { settings: mergeSettings({ accent: "red;}" }, { columns: all }), logo: null, company: null });
    expect(d.columns).toHaveLength(5);
    expect(d.accent).toBe("#111111");
  });

  it("can switch off totals, notes and signatures", () => {
    const d = applyTemplate(spec, { settings: mergeSettings(null, { showTotals: false, showNotes: false, showSignatures: false }), logo: null, company: null });
    expect(d.totals).toEqual([]); expect(d.notes).toBeNull(); expect(d.signatures).toEqual([]);
  });

  it("document settings override the company look; blanks fall back", () => {
    const m = mergeSettings({ accent: "#222222", fontSize: "large", paper: "A4" }, { accent: "", paper: "A5" });
    expect(m.accent).toBe("#222222"); expect(m.fontSize).toBe("large"); expect(m.paper).toBe("A5");
  });

  it("auto header lines skip empty parts", () => {
    expect(autoHeaderLines({ ...company, phone: null, email: null, ntn: null })).toEqual(["Depalpur Road, Okara"]);
  });

  it("builds a templated PDF on A5 with terms and footer", async () => {
    const d = applyTemplate({ ...spec, rows: Array.from({ length: 40 }, (_, i) => [String(i + 1), `Item ${i + 1}`, "1 PCS", "10.00", "10.00"]) },
      { settings: mergeSettings({ footer: "Meezan Bank 0123", paper: "A5" }, { terms: "Terms line 1\nTerms line 2" }), logo: null, company });
    const blob = await renderPdf(d);
    expect(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  it("every registered document has sample rows matching its columns", () => {
    for (const d of DOC_TYPES) for (const r of d.sampleRows) expect(r.length, d.key).toBe(d.columns.length);
  });
});

describe("custom fields", () => {
  const defs: CfDef[] = [
    { id: "a", entity: "customers", code: "cap", label: "Capacity", field_type: "number", options: [], required: true, help_text: null, show_in_list: false, sort_order: 1, is_active: true },
    { id: "b", entity: "customers", code: "shed", label: "Shed", field_type: "dropdown", options: ["Open", "Controlled"], required: false, help_text: null, show_in_list: false, sort_order: 2, is_active: true },
    { id: "c", entity: "customers", code: "vip", label: "VIP", field_type: "checkbox", options: [], required: false, help_text: null, show_in_list: false, sort_order: 3, is_active: true },
    { id: "d", entity: "customers", code: "days", label: "Days", field_type: "multi_select", options: ["Mon", "Tue"], required: false, help_text: null, show_in_list: false, sort_order: 4, is_active: true },
  ];
  it("validates required, numbers and choices", () => {
    expect(validateCf(defs, { a: "", b: "", c: false, d: [] })).toEqual({ a: "Required" });
    expect(validateCf(defs, { a: "abc", b: "Cage", c: false, d: [] })).toEqual({ a: "Enter a number", b: "Choose from the list" });
    expect(validateCf(defs, { a: "20000", b: "Open", c: true, d: ["Mon"] })).toEqual({});
  });
  it("builds the save payload", () => {
    expect(cfPayload(defs, { a: "20000", b: "", c: false, d: ["Tue"] })).toEqual({ a: 20000, b: null, c: false, d: ["Tue"] });
  });
});

describe("numbering preview", () => {
  it("matches the database format", () => {
    expect(nextCode({ prefix: "INV-", next_number: 7, padding: 5, reset_yearly: true, current_year: 2026 }, 2026)).toBe("INV-2026-00007");
    expect(nextCode({ prefix: "INV-", next_number: 7, padding: 5, reset_yearly: true, current_year: 2025 }, 2026)).toBe("INV-2026-00001");
    expect(nextCode({ prefix: "C-", next_number: 10, padding: 4, reset_yearly: false }, 2026)).toBe("C-0010");
  });
});
