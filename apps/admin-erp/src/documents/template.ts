/**
 * Document template engine (spec §19.2).
 * A screen describes WHAT is on a document (PrintSpec: values from the saved record);
 * the company's template decides HOW it looks — logo, header, titles, which columns,
 * terms, signatures, footer. Values are never changed by a template, so a finalized
 * document always reprints with its own historical figures.
 *
 * Templates: one company-wide "DEFAULT" row (look & header) + optional one per document type.
 */
import { sb } from "@jst/data-access";
import { docTypeDef } from "./registry";

export interface PrintSpecBase {
  company: string;
  title: string;
  docNo: string;
  meta: [string, string][];
  columns: { label: string; align?: "right" }[];
  rows: string[][];
  totals?: [string, string][];
  notes?: string | null;
  signatures?: string[];
  /** extra lines under the company name (address, phone) */
  companyLines?: string[];
  /** template to apply (registry key) */
  docType?: string;
}

export interface TemplateSettings {
  // look (company-wide, can be overridden per document)
  accent?: string;
  fontSize?: "small" | "normal" | "large";
  paper?: "A4" | "A5" | "Letter";
  showLogo?: boolean;
  logoPosition?: "left" | "right";
  logoHeight?: number;
  headerName?: "name" | "legal_name";
  /** null / undefined = automatic (address, phone · email, NTN / STRN) */
  headerLines?: string | null;
  footer?: string;
  showPageNumbers?: boolean;
  // per document
  title?: string;
  columns?: Record<string, { hidden?: boolean; label?: string }>;
  hiddenMeta?: string[];
  terms?: string;
  showNotes?: boolean;
  showSignatures?: boolean;
  /** null / undefined = the screen's own signature boxes */
  signatures?: string[] | null;
  showTotals?: boolean;
}

export interface CompanyInfo {
  name: string;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  ntn: string | null;
  strn: string | null;
}

export interface TemplateBundle {
  settings: Required<Pick<TemplateSettings, "accent" | "fontSize" | "paper" | "showLogo" | "logoPosition" | "logoHeight" | "headerName" | "showPageNumbers" | "showNotes" | "showSignatures" | "showTotals">> & TemplateSettings;
  logo: string | null;
  company: CompanyInfo | null;
}

export const LOOK_DEFAULTS = {
  accent: "#111111",
  fontSize: "normal" as const,
  paper: "A4" as const,
  showLogo: true,
  logoPosition: "left" as const,
  logoHeight: 16,
  headerName: "legal_name" as const,
  showPageNumbers: true,
  showNotes: true,
  showSignatures: true,
  showTotals: true,
};

/** keys a per-document template may set; look keys come from DEFAULT unless the document overrides them */
export function mergeSettings(def: TemplateSettings | null | undefined, doc: TemplateSettings | null | undefined): TemplateBundle["settings"] {
  const clean = (o: TemplateSettings | null | undefined) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== "")) as TemplateSettings;
  return { ...LOOK_DEFAULTS, ...clean(def), ...clean(doc) };
}

export function autoHeaderLines(c: CompanyInfo | null): string[] {
  if (!c) return [];
  const tax = [c.ntn ? `NTN ${c.ntn}` : "", c.strn ? `STRN ${c.strn}` : ""].filter(Boolean).join(" · ");
  return [c.address ?? "", [c.phone, c.email].filter(Boolean).join(" · "), tax].map((s) => s.trim()).filter(Boolean);
}

export interface RenderedDoc {
  companyName: string;
  companyLines: string[];
  logo: string | null;
  logoPosition: "left" | "right";
  logoHeight: number;
  title: string;
  docNo: string;
  meta: [string, string][];
  columns: { label: string; align?: "right" }[];
  rows: string[][];
  totals: [string, string][];
  notes: string | null;
  terms: string | null;
  signatures: string[];
  footer: string | null;
  accent: string;
  fontScale: number;
  paper: "A4" | "A5" | "Letter";
  showPageNumbers: boolean;
}

/** Pure: screen spec + template → what is printed. */
export function applyTemplate(p: PrintSpecBase, t: TemplateBundle | null): RenderedDoc {
  const s = t?.settings ?? mergeSettings(null, null);
  const c = t?.company ?? null;
  const colCfg = s.columns ?? {};
  const keep = p.columns.map((col) => !colCfg[col.label]?.hidden);
  // never hide every column
  const anyKept = keep.some(Boolean);
  const columns = p.columns
    .filter((_, i) => !anyKept || keep[i])
    .map((col) => ({ ...col, label: colCfg[col.label]?.label?.trim() || col.label }));
  const rows = p.rows.map((r) => r.filter((_, i) => !anyKept || keep[i]));
  const hiddenMeta = new Set(s.hiddenMeta ?? []);
  const companyName = (s.headerName === "legal_name" ? c?.legal_name || c?.name : c?.name) || p.company;
  const lines = s.headerLines != null && s.headerLines.trim() !== ""
    ? s.headerLines.split("\n").map((l) => l.trim()).filter(Boolean)
    : (p.companyLines?.filter(Boolean).length ? p.companyLines.filter(Boolean) : autoHeaderLines(c));
  const sigs = s.showSignatures === false ? [] : (s.signatures && s.signatures.length ? s.signatures : p.signatures ?? []);
  return {
    companyName,
    companyLines: lines,
    logo: s.showLogo ? t?.logo ?? null : null,
    logoPosition: s.logoPosition,
    logoHeight: Math.min(40, Math.max(8, Number(s.logoHeight) || 16)),
    title: s.title?.trim() || p.title,
    docNo: p.docNo,
    meta: p.meta.filter(([k]) => !hiddenMeta.has(k)),
    columns,
    rows,
    totals: s.showTotals === false ? [] : p.totals ?? [],
    notes: s.showNotes === false ? null : p.notes?.trim() || null,
    terms: s.terms?.trim() || null,
    signatures: sigs.filter((x) => x.trim()),
    footer: s.footer?.trim() || null,
    accent: /^#[0-9a-f]{6}$/i.test(s.accent ?? "") ? s.accent! : LOOK_DEFAULTS.accent,
    fontScale: s.fontSize === "small" ? 0.9 : s.fontSize === "large" ? 1.12 : 1,
    paper: s.paper,
    showPageNumbers: s.showPageNumbers !== false,
  };
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const nl = (v: string) => esc(v).replace(/\n/g, "<br>");

/** Pure: printable HTML (also used for the live preview in Settings). */
export function renderHtml(d: RenderedDoc, opts: { autoPrint?: boolean } = {}): string {
  const fs = (px: number) => `${Math.round(px * d.fontScale * 10) / 10}px`;
  const th = d.columns.map((c) => `<th style="text-align:${c.align ?? "left"}">${esc(c.label)}</th>`).join("");
  const body = d.rows.map((r) => `<tr>${r.map((v, i) => `<td style="text-align:${d.columns[i]?.align ?? "left"}">${esc(v)}</td>`).join("")}</tr>`).join("");
  const totals = d.totals.map(([k, v], i, a) => `<tr class="${i === a.length - 1 ? "grand" : ""}"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  const logo = d.logo ? `<img class="logo" src="${esc(d.logo)}" alt="">` : "";
  const co = `<div class="co-block">${d.logoPosition === "left" ? logo : ""}<div><div class="co">${esc(d.companyName)}</div>${d.companyLines.map((l) => `<div class="cl">${esc(l)}</div>`).join("")}</div></div>`;
  const ttl = `<div class="ttl">${d.logoPosition === "right" ? logo : ""}<h1>${esc(d.title)}</h1><div class="no">${esc(d.docNo)}</div></div>`;
  const page = d.paper === "A5" ? "A5" : d.paper === "Letter" ? "letter" : "A4";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.docNo)}</title><style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:28px;font-size:${fs(13)}}
    h1{font-size:${fs(20)};margin:0;color:${d.accent}}.co{font-size:${fs(15)};font-weight:600}.cl{font-size:${fs(11)};color:#555}
    .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid ${d.accent};padding-bottom:10px;margin-bottom:14px}
    .co-block{display:flex;gap:10px;align-items:flex-start}.ttl{text-align:right}.ttl .logo{display:block;margin:0 0 6px auto}.no{font-size:${fs(12)}}
    .logo{height:${d.logoHeight * 3.78}px;max-width:220px;object-fit:contain}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 20px;margin-bottom:16px}.meta div span{display:block;font-size:${fs(10)};text-transform:uppercase;color:#666}
    table.l{width:100%;border-collapse:collapse}table.l th{font-size:${fs(10)};text-transform:uppercase;color:#444;border-bottom:1px solid ${d.accent};padding:6px 4px}
    table.l td{border-bottom:1px solid #ddd;padding:6px 4px;vertical-align:top}.tot{margin-left:auto;margin-top:10px}.tot td{padding:3px 4px}.tot td:last-child{text-align:right;min-width:120px}
    .grand td{font-weight:700;border-top:1px solid ${d.accent}}.sig{display:flex;gap:40px;margin-top:56px}.sig div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:${fs(11)};color:#444}
    .terms{margin-top:16px;font-size:${fs(11.5)};color:#333;white-space:normal}.terms b{display:block;font-size:${fs(10)};text-transform:uppercase;color:#666;margin-bottom:2px}
    .foot{margin-top:28px;border-top:1px solid #ddd;padding-top:6px;font-size:${fs(10)};color:#666;text-align:center}
    @page{size:${page};margin:14mm}
  </style></head><body>
  <div class="top">${co}${ttl}</div>
  <div class="meta">${d.meta.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join("")}</div>
  <table class="l"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
  ${totals ? `<table class="tot">${totals}</table>` : ""}
  ${d.notes ? `<p style="margin-top:16px"><b>Notes:</b> ${nl(d.notes)}</p>` : ""}
  ${d.terms ? `<div class="terms"><b>Terms &amp; conditions</b>${nl(d.terms)}</div>` : ""}
  ${d.signatures.length ? `<div class="sig">${d.signatures.map((s) => `<div>${esc(s)}</div>`).join("")}</div>` : ""}
  ${d.footer ? `<div class="foot">${nl(d.footer)}</div>` : ""}
  ${opts.autoPrint ? "<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>" : ""}</body></html>`;
}

// ------------------------------------------------------------------ loading (cached a few minutes)
type Row = { doc_type: string; settings: TemplateSettings; logo: string | null };
let cache: { companyId: string; at: number; rows: Row[]; company: CompanyInfo | null } | null = null;
const TTL = 3 * 60_000;

export function clearTemplateCache() {
  cache = null;
}

/** the company whose templates apply (set by the app shell when the company changes) */
let activeCompanyId: string | null = null;
export function setTemplateCompany(id: string | null) {
  if (id !== activeCompanyId) cache = null;
  activeCompanyId = id;
}
export const templateCompany = () => activeCompanyId;

async function loadAll(companyId: string) {
  if (cache && cache.companyId === companyId && Date.now() - cache.at < TTL) return cache;
  const [t, c] = await Promise.all([
    sb().from("document_templates").select("doc_type, settings, logo").eq("company_id", companyId),
    sb().from("companies").select("name, legal_name, address, phone, email, ntn, strn").eq("id", companyId).single(),
  ]);
  // a missing table (migration not applied yet) must never block printing
  cache = { companyId, at: Date.now(), rows: t.error ? [] : ((t.data ?? []) as Row[]), company: c.error ? null : (c.data as CompanyInfo) };
  return cache;
}

export async function loadTemplate(companyId: string | null | undefined, docType?: string | null): Promise<TemplateBundle | null> {
  if (!companyId) return null;
  try {
    const all = await loadAll(companyId);
    const def = all.rows.find((r) => r.doc_type === "DEFAULT");
    const doc = docType ? all.rows.find((r) => r.doc_type === docType) : undefined;
    return { settings: mergeSettings(def?.settings, doc?.settings), logo: def?.logo ?? null, company: all.company };
  } catch {
    return null;
  }
}

/** the template's title default for a doc type (for the editor) */
export const defaultTitle = (docType: string) => docTypeDef(docType)?.title ?? "";
