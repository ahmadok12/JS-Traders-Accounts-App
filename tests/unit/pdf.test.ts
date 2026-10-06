import { describe, expect, it } from "vitest";
import { buildPdf, pdfFileName, waNumber } from "../../apps/admin-erp/src/sales/pdf";

describe("voucher PDF + WhatsApp helpers", () => {
  it("normalises Pakistani numbers for WhatsApp", () => {
    expect(waNumber("0300-6801122")).toBe("923006801122");
    expect(waNumber("+92 333 7654321")).toBe("923337654321");
    expect(waNumber("0092-301-4412233")).toBe("923014412233");
    expect(waNumber("3001234567")).toBe("923001234567");
    expect(waNumber("042-35761234")).toBe("924235761234");
    expect(waNumber("")).toBeNull();
    expect(waNumber("123")).toBeNull();
  });
  it("makes a safe file name", () => {
    expect(pdfFileName("GDN-2026-00001", "Al-Noor Farm 1 (Broiler)")).toBe("GDN-2026-00001 - Al-Noor Farm 1 (Broiler).pdf");
    expect(pdfFileName("GDN-1", 'A/B: "C"')).toBe("GDN-1 - A-B- -C-.pdf");
  });
  it("builds a PDF", async () => {
    const blob = await buildPdf({
      company: "JS Traders", title: "Delivery Note", docNo: "GDN-2026-00001", companyLines: ["Okara", "0300-0000000"],
      meta: [["Customer", "Al-Noor Farm 1, Okara"], ["Date", "06 Oct 2026"], ["Sales order", "SO-2026-00001"], ["Customer ref.", ""], ["Transport", "Mazda LES-1234"]],
      columns: [{ label: "#" }, { label: "Item" }, { label: "From" }, { label: "Quantity", align: "right" }],
      rows: Array.from({ length: 60 }, (_, i) => [String(i + 1), `Item ${i + 1}`, "WH-01", `${i + 1} PCS`]),
      notes: "Handle with care", signatures: ["Dispatched by", "Driver / transporter", "Received by (customer)"],
    });
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(3000);
  });
});
