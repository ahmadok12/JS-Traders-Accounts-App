/** Printable document in a new window (GDN / invoice). Plain HTML so it prints the same on any printer. */
export interface PrintSpec {
  company: string;
  title: string;
  docNo: string;
  meta: [string, string][];
  columns: { label: string; align?: "right" }[];
  rows: string[][];
  totals?: [string, string][];
  notes?: string | null;
  signatures?: string[];
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function printDocument(p: PrintSpec) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  const th = p.columns.map((c) => `<th style="text-align:${c.align ?? "left"}">${esc(c.label)}</th>`).join("");
  const body = p.rows.map((r) => `<tr>${r.map((v, i) => `<td style="text-align:${p.columns[i]?.align ?? "left"}">${esc(v)}</td>`).join("")}</tr>`).join("");
  const totals = (p.totals ?? []).map(([k, v], i, a) => `<tr class="${i === a.length - 1 ? "grand" : ""}"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.docNo)}</title><style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px;font-size:13px}
    h1{font-size:20px;margin:0}.co{font-size:15px;font-weight:600}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 20px;margin-bottom:16px}.meta div span{display:block;font-size:10px;text-transform:uppercase;color:#666}
    table.l{width:100%;border-collapse:collapse}table.l th{font-size:10px;text-transform:uppercase;color:#444;border-bottom:1px solid #111;padding:6px 4px}
    table.l td{border-bottom:1px solid #ddd;padding:6px 4px;vertical-align:top}.tot{margin-left:auto;margin-top:10px}.tot td{padding:3px 4px}.tot td:last-child{text-align:right;min-width:120px}
    .grand td{font-weight:700;border-top:1px solid #111}.sig{display:flex;gap:40px;margin-top:60px}.sig div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:11px;color:#444}
    @page{margin:14mm}
  </style></head><body>
  <div class="top"><div><div class="co">${esc(p.company)}</div></div><div style="text-align:right"><h1>${esc(p.title)}</h1><div>${esc(p.docNo)}</div></div></div>
  <div class="meta">${p.meta.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join("")}</div>
  <table class="l"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
  ${totals ? `<table class="tot">${totals}</table>` : ""}
  ${p.notes ? `<p style="margin-top:16px"><b>Notes:</b> ${esc(p.notes)}</p>` : ""}
  ${p.signatures?.length ? `<div class="sig">${p.signatures.map((s) => `<div>${esc(s)}</div>`).join("")}</div>` : ""}
  <script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
  return true;
}
