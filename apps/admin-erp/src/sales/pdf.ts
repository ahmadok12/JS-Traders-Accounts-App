/**
 * Vouchers as real PDF files (same layout as the printed page), plus "send to WhatsApp".
 * jsPDF is loaded only when a PDF is made, so it does not slow down the app.
 */
import type { PrintSpec } from "./print";

export interface PdfSpec extends PrintSpec {
  /** extra lines under the company name (address, phone) */
  companyLines?: string[];
}

export const pdfFileName = (docNo: string, customer?: string | null) =>
  `${docNo}${customer ? ` - ${customer}` : ""}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() + ".pdf";

export async function buildPdf(p: PdfSpec): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  let y = M + 2;

  // header: company left, title right
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(p.company || "", M, y);
  doc.setFontSize(18);
  doc.text(p.title, W - M, y, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(p.docNo, W - M, y + 6, { align: "right" });
  let cy = y + 5;
  doc.setFontSize(9); doc.setTextColor(90);
  for (const l of p.companyLines ?? []) { if (l) { doc.text(l, M, cy); cy += 4.2; } }
  doc.setTextColor(0);
  y = Math.max(cy, y + 9) + 1;
  doc.setLineWidth(0.6); doc.line(M, y, W - M, y);
  y += 6;

  // meta grid, 3 columns
  const colW = (W - 2 * M) / 3;
  const meta = p.meta.filter(([, v]) => v != null);
  for (let i = 0; i < meta.length; i += 3) {
    let rowH = 0;
    for (let j = 0; j < 3 && i + j < meta.length; j++) {
      const [k, v] = meta[i + j];
      const x = M + j * colW;
      doc.setFontSize(7.5); doc.setTextColor(110); doc.text(k.toUpperCase(), x, y);
      doc.setFontSize(10); doc.setTextColor(0);
      const lines = doc.splitTextToSize(v || "—", colW - 4) as string[];
      doc.text(lines, x, y + 4.5);
      rowH = Math.max(rowH, 4.5 + lines.length * 4.4);
    }
    y += rowH + 3;
  }

  // lines
  autoTable(doc, {
    startY: y + 1,
    margin: { left: M, right: M },
    head: [p.columns.map((c) => c.label)],
    body: p.rows,
    theme: "plain",
    styles: { fontSize: 9.5, cellPadding: 1.8, lineColor: [221, 221, 221], lineWidth: { bottom: 0.2 } },
    headStyles: { fontSize: 8, textColor: 60, fontStyle: "bold", lineColor: [17, 17, 17], lineWidth: { bottom: 0.4 } },
    columnStyles: Object.fromEntries(p.columns.map((c, i) => [i, { halign: c.align ?? "left" }])),
    didParseCell: (d) => { if (d.section === "head") d.cell.styles.halign = p.columns[d.column.index]?.align ?? "left"; },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;

  if (p.totals?.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: W - M - 80, right: M },
      body: p.totals,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 1.3 },
      columnStyles: { 1: { halign: "right" } },
      didParseCell: (d) => { if (d.row.index === p.totals!.length - 1) { d.cell.styles.fontStyle = "bold"; } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;
  }

  if (p.notes) {
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(`Notes: ${p.notes}`, W - 2 * M) as string[];
    doc.text(lines, M, y + 2);
    y += lines.length * 4.5 + 4;
  }

  if (p.signatures?.length) {
    const H = doc.internal.pageSize.getHeight();
    if (y + 28 > H - M) { doc.addPage(); y = M; }
    const sy = Math.max(y + 22, H - M - 12);
    const n = p.signatures.length, gap = 10, sw = (W - 2 * M - gap * (n - 1)) / n;
    doc.setFontSize(8.5); doc.setTextColor(70); doc.setLineWidth(0.3);
    p.signatures.forEach((s, i) => { const x = M + i * (sw + gap); doc.line(x, sy, x + sw, sy); doc.text(s, x, sy + 4); });
    doc.setTextColor(0);
  }

  // footer page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(`${p.docNo} · page ${i} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 6, { align: "right" });
  }
  return doc.output("blob");
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function savePdf(p: PdfSpec, name: string) {
  const blob = await buildPdf(p);
  downloadBlob(blob, name);
  return blob;
}

/** Pakistani numbers → international digits for WhatsApp (0300-1234567 → 923001234567). */
export function waNumber(raw?: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "92" + d.slice(1);
  else if (d.length === 10 && d.startsWith("3")) d = "92" + d;
  return d.length >= 10 ? d : null;
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export type WaResult = "shared" | "opened" | "cancelled";

/**
 * Send a voucher to WhatsApp.
 * Phone / tablet: the share sheet opens with the PDF attached — choose WhatsApp and the chat.
 * PC: the PDF is saved to Downloads and WhatsApp (desktop app) opens on the customer's chat with a message
 *     typed in — drag the PDF into the chat (or click the paper-clip) and send.
 */
export async function sendPdfToWhatsApp(p: PdfSpec, name: string, phone: string | null, message: string, useWeb = false): Promise<WaResult> {
  const blob = await buildPdf(p);
  const file = new File([blob], name, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isPhone() && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text: message, title: p.docNo }); return "shared"; }
    catch (e) { if ((e as Error).name === "AbortError") return "cancelled"; }
  }
  downloadBlob(blob, name);
  // give the download a moment to start before handing over to WhatsApp
  await new Promise((r) => setTimeout(r, 400));
  openWhatsApp(phone, message, useWeb);
  return "opened";
}

export function openWhatsApp(phone: string | null, message: string, useWeb = false) {
  const n = waNumber(phone);
  const text = encodeURIComponent(message);
  const url = useWeb
    ? `https://web.whatsapp.com/send?${n ? `phone=${n}&` : ""}text=${text}`
    : `whatsapp://send?${n ? `phone=${n}&` : ""}text=${text}`;
  if (useWeb) window.open(url, "_blank");
  else window.location.href = url;
}
