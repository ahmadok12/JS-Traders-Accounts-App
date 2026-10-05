/** Report exports: CSV, Excel (.xlsx, loaded only when used) and a print view (save as PDF from the browser). */
import { formatDate, formatDateTime, formatNumber } from "@jst/utilities";
import type { Col, Row } from "./registry";

export interface ExportRow { kind: "row" | "group" | "subtotal" | "total"; row: Row; label?: string }

export function cellText(c: Col, v: unknown): string {
  if (v == null || v === "") return "";
  switch (c.kind) {
    case "money": return formatNumber(Number(v), 2);
    case "qty": return formatNumber(Number(v), Number.isInteger(Number(v)) ? 0 : 3);
    case "rate": return String(Number(Number(v).toFixed(6)));
    case "pct": return `${formatNumber(Number(v), 1)}%`;
    case "int": return String(v);
    case "date": return formatDate(String(v));
    case "datetime": return formatDateTime(String(v));
    case "badge": return String(v).replace(/_/g, " ").toLowerCase();
    default: return String(v);
  }
}
const numeric = (c: Col) => c.kind === "money" || c.kind === "qty" || c.kind === "pct" || c.kind === "int" || c.kind === "rate";

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileBase = (title: string) => `${title.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

export function exportCsv(title: string, cols: Col[], rows: ExportRow[]) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const raw = (c: Col, v: unknown) => (v == null ? "" : numeric(c) ? String(v) : cellText(c, v));
  const lines = [cols.map((c) => q(c.label)).join(",")];
  for (const r of rows) lines.push(cols.map((c, i) => q(i === 0 && r.label ? r.label : raw(c, r.row[c.key]))).join(","));
  download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${fileBase(title)}.csv`);
}

export async function exportXlsx(title: string, subtitle: string, cols: Col[], rows: ExportRow[]) {
  const { default: writeXlsxFile } = await import("write-excel-file");
  const head = cols.map((c) => ({ value: c.label, fontWeight: "bold", align: numeric(c) ? "right" : "left", backgroundColor: "#F3F4F6" }));
  const body = rows.map((r) => cols.map((c, i) => {
    const v = r.row[c.key];
    const bold = r.kind !== "row" ? "bold" : undefined;
    if (i === 0 && r.label) return { value: r.label, fontWeight: bold };
    if (v == null || v === "") return null;
    if (numeric(c)) return { value: Number(v), type: Number, format: c.kind === "money" ? "#,##0.00" : c.kind === "pct" ? "0.0" : c.kind === "int" ? "0" : "#,##0.###", fontWeight: bold };
    if (c.kind === "date") return { value: new Date(String(v).slice(0, 10) + "T00:00:00"), type: Date, format: "dd-mmm-yyyy", fontWeight: bold };
    return { value: cellText(c, v), fontWeight: bold };
  }));
  const data = [[{ value: title, fontWeight: "bold", fontSize: 14 }], [{ value: subtitle }], [], head, ...body];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeXlsxFile as any)(data, { fileName: `${fileBase(title)}.xlsx`, columns: cols.map((c) => ({ width: numeric(c) ? 14 : c.key.includes("name") || c.label.length > 14 ? 28 : 18 })) });
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export function printReport(company: string, title: string, subtitle: string, cols: Col[], rows: ExportRow[]) {
  const w = window.open("", "_blank", "width=1100,height=900");
  if (!w) return false;
  const th = cols.map((c) => `<th class="${numeric(c) ? "r" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows.map((r) => `<tr class="${r.kind}">${cols.map((c, i) => `<td class="${numeric(c) ? "r" : ""}">${esc(i === 0 && r.label ? r.label : cellText(c, r.row[c.key]))}</td>`).join("")}</tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;font-size:11px}
    .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
    h1{font-size:17px;margin:0}.co{font-size:13px;font-weight:600}.sub{color:#555}
    table{width:100%;border-collapse:collapse}th{font-size:9px;text-transform:uppercase;color:#444;border-bottom:1px solid #111;padding:5px 4px;text-align:left}
    td{border-bottom:1px solid #e5e7eb;padding:4px}.r{text-align:right;white-space:nowrap}
    tr.group td{background:#f3f4f6;font-weight:600}tr.subtotal td{font-weight:600;border-top:1px solid #999}tr.total td{font-weight:700;border-top:2px solid #111}
    .foot{margin-top:10px;color:#777;font-size:9px}@page{margin:10mm;size:auto}
  </style></head><body><div class="top"><div><div class="co">${esc(company)}</div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></div>
  <div class="sub">Printed ${esc(new Date().toLocaleString())}</div></div>
  <table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
  <div class="foot">${rows.filter((r) => r.kind === "row").length} rows</div>
  <script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
  return true;
}
