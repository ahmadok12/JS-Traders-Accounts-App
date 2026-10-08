/**
 * Vouchers as real PDF files (same layout as the printed page), plus "send to WhatsApp".
 * jsPDF is loaded only when a PDF is made, so it does not slow down the app.
 */
import type { PrintSpec } from "./print";
import { applyTemplate, loadTemplate, templateCompany, type RenderedDoc } from "../documents/template";

export interface PdfSpec extends PrintSpec {}

export const pdfFileName = (docNo: string, customer?: string | null) =>
  `${docNo}${customer ? ` - ${customer}` : ""}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() + ".pdf";

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function imageSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => res(null);
    img.src = src;
  });
}

export async function buildPdf(p: PdfSpec): Promise<Blob> {
  const t = await loadTemplate(templateCompany(), p.docType);
  return renderPdf(applyTemplate(p, t));
}

export async function renderPdf(d: RenderedDoc): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: d.paper === "Letter" ? "letter" : d.paper === "A5" ? "a5" : "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = d.paper === "A5" ? 10 : 14;
  const f = (pt: number) => pt * d.fontScale;
  const accent = hexRgb(d.accent);
  let y = M + 2;

  // logo
  let logoW = 0;
  const logoH = d.logoHeight;
  if (d.logo) {
    const sz = await imageSize(d.logo);
    if (sz && sz.h > 0) {
      logoW = Math.min(60, (sz.w / sz.h) * logoH);
      const fmt = d.logo.startsWith("data:image/png") ? "PNG" : "JPEG";
      try {
        if (d.logoPosition === "left") doc.addImage(d.logo, fmt, M, M - 2, logoW, logoH);
        else doc.addImage(d.logo, fmt, W - M - logoW, M - 2, logoW, logoH);
      } catch { logoW = 0; }
    }
  }
  const leftX = d.logo && logoW && d.logoPosition === "left" ? M + logoW + 4 : M;
  const titleY = d.logo && logoW && d.logoPosition === "right" ? M + logoH + 4 : y;

  // header: company left, title right
  doc.setFont("helvetica", "bold"); doc.setFontSize(f(14));
  doc.text(d.companyName || "", leftX, y);
  doc.setFontSize(f(18)); doc.setTextColor(...accent);
  doc.text(d.title, W - M, titleY, { align: "right" });
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal"); doc.setFontSize(f(10));
  doc.text(d.docNo, W - M, titleY + 6, { align: "right" });
  let cy = y + 5;
  doc.setFontSize(f(9)); doc.setTextColor(90);
  for (const l of d.companyLines) { doc.text(l, leftX, cy); cy += 4.2; }
  doc.setTextColor(0);
  y = Math.max(cy, titleY + 9, d.logo && logoW ? M - 2 + logoH + 2 : 0) + 1;
  doc.setDrawColor(...accent); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); doc.setDrawColor(0);
  y += 6;

  // meta grid, 3 columns
  const colW = (W - 2 * M) / 3;
  const meta = d.meta.filter(([, v]) => v != null);
  for (let i = 0; i < meta.length; i += 3) {
    let rowH = 0;
    for (let j = 0; j < 3 && i + j < meta.length; j++) {
      const [k, v] = meta[i + j];
      const x = M + j * colW;
      doc.setFontSize(f(7.5)); doc.setTextColor(110); doc.text(k.toUpperCase(), x, y);
      doc.setFontSize(f(10)); doc.setTextColor(0);
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
    head: [d.columns.map((c) => c.label)],
    body: d.rows,
    theme: "plain",
    styles: { fontSize: f(9.5), cellPadding: 1.8, lineColor: [221, 221, 221], lineWidth: { bottom: 0.2 } },
    headStyles: { fontSize: f(8), textColor: 60, fontStyle: "bold", lineColor: accent, lineWidth: { bottom: 0.4 } },
    columnStyles: Object.fromEntries(d.columns.map((c, i) => [i, { halign: c.align ?? "left" }])),
    didParseCell: (c) => { if (c.section === "head") c.cell.styles.halign = d.columns[c.column.index]?.align ?? "left"; },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;

  if (d.totals.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: W - M - 80, right: M },
      body: d.totals,
      theme: "plain",
      styles: { fontSize: f(10), cellPadding: 1.3 },
      columnStyles: { 1: { halign: "right" } },
      didParseCell: (c) => { if (c.row.index === d.totals.length - 1) { c.cell.styles.fontStyle = "bold"; } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;
  }

  const para = (label: string | null, text: string, size: number) => {
    doc.setFontSize(f(size));
    const lines = doc.splitTextToSize(label ? `${label} ${text}` : text, W - 2 * M) as string[];
    if (y + lines.length * 4.5 + 4 > H - M - 8) { doc.addPage(); y = M; }
    doc.text(lines, M, y + 2);
    y += lines.length * 4.5 + 4;
  };
  if (d.notes) para("Notes:", d.notes, 9.5);
  if (d.terms) {
    doc.setTextColor(90); doc.setFontSize(f(7.5)); doc.text("TERMS & CONDITIONS", M, y + 2); y += 4; doc.setTextColor(40);
    para(null, d.terms, 8.5); doc.setTextColor(0);
  }

  if (d.signatures.length) {
    if (y + 28 > H - M - (d.footer ? 8 : 0)) { doc.addPage(); y = M; }
    const sy = Math.max(y + 22, H - M - 12 - (d.footer ? 8 : 0));
    const n = d.signatures.length, gap = 10, sw = (W - 2 * M - gap * (n - 1)) / n;
    doc.setFontSize(f(8.5)); doc.setTextColor(70); doc.setLineWidth(0.3);
    d.signatures.forEach((s, i) => { const x = M + i * (sw + gap); doc.line(x, sy, x + sw, sy); doc.text(s, x, sy + 4); });
    doc.setTextColor(0);
  }

  // footer text + page numbers on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(f(7.5)); doc.setTextColor(140);
    if (d.footer) doc.text(doc.splitTextToSize(d.footer, W - 2 * M - 40) as string[], W / 2, H - 10, { align: "center" });
    if (d.showPageNumbers) doc.text(`${d.docNo} · page ${i} of ${pages}`, W - M, H - 6, { align: "right" });
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
