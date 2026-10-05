/** Bank statement file → rows. CSV is parsed here; Excel (.xlsx) through read-excel-file (loaded only when needed). */
export type Cell = string | number | Date | boolean | null;
export type Grid = Cell[][];

export async function readStatementFile(file: File): Promise<Grid> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file");
    return (await readXlsxFile(file)) as Grid;
  }
  if (name.endsWith(".xls")) throw new Error("Old .xls files are not supported — open it in Excel and save as .xlsx or CSV");
  return parseCsv(await file.text());
}

export function parseCsv(text: string): Grid {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Grid = [];
  let row: Cell[] = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => String(c ?? "").trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => String(c ?? "").trim() !== "")) rows.push(row);
  return rows;
}

export type Field = "date" | "value_date" | "description" | "reference" | "cheque_no" | "debit" | "credit" | "amount" | "balance";
export const FIELD_LABEL: Record<Field, string> = {
  date: "Date", value_date: "Value date", description: "Description / narration", reference: "Reference", cheque_no: "Cheque no.",
  debit: "Withdrawal / debit (money out)", credit: "Deposit / credit (money in)", amount: "Amount (+ in / − out)", balance: "Balance",
};
const GUESS: [Field, RegExp][] = [
  ["value_date", /value\s*date/i], ["date", /(^|\s)(txn|tran|transaction|posting|book)?\s*date/i], ["cheque_no", /(cheque|chq|check|instrument)\s*(no|#|number)?/i],
  ["reference", /ref|reference|utr|trx\s*id|transaction\s*id/i], ["description", /desc|narration|particular|detail|remark|memo/i],
  ["debit", /debit|withdraw|paid\s*out|dr\.?$/i], ["credit", /credit|deposit|paid\s*in|cr\.?$/i], ["balance", /balance|bal\.?$/i], ["amount", /amount|amt/i],
];

/** first row that looks like a header (≥3 text cells and not mostly numbers) */
export function findHeaderRow(g: Grid): number {
  for (let i = 0; i < Math.min(g.length, 30); i++) {
    const cells = g[i].map((c) => String(c ?? "").trim()).filter(Boolean);
    if (cells.length >= 3 && cells.filter((c) => /[a-z]/i.test(c) && !/^\d/.test(c)).length >= 3) return i;
  }
  return 0;
}

export function guessMapping(header: Cell[]): Partial<Record<Field, number>> {
  const m: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const s = String(h ?? "").trim();
    if (!s) return;
    for (const [f, re] of GUESS) if (m[f] === undefined && re.test(s)) { m[f] = i; break; }
  });
  return m;
}

export type DateFormat = "auto" | "DMY" | "MDY" | "YMD";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => (y < 100 ? (y += 2000) : y, m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

export function parseDate(v: Cell, fmt: DateFormat): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number") { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([a-z]{3,9})[-/., ]+(\d{2,4})/i);
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return mo ? iso(+m[3], mo, +m[1]) : null; }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (fmt === "MDY" || (fmt === "auto" && a <= 12 && b > 12)) return iso(y, a, b);
    return iso(y, b, a); // DMY (Pakistan default)
  }
  return null;
}

/** "1,234.50" · "(1,234.50)" · "1,234.50 Dr" · "-" → number | null */
export function parseAmount(v: Cell): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (!s || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bdr\.?$/i.test(s)) { neg = true; s = s.replace(/\bdr\.?$/i, ""); }
  s = s.replace(/\bcr\.?$/i, "").replace(/[^0-9.\-]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  const n = Number(s);
  if (!isFinite(n) || s === "") return null;
  return neg ? -n : n;
}

export interface StatementRow { date: string; value_date: string | null; description: string; reference: string; cheque_no: string; amount: number; balance: number | null; raw: Record<string, string> }

export function buildRows(g: Grid, headerRow: number, map: Partial<Record<Field, number>>, fmt: DateFormat): { rows: StatementRow[]; problems: string[] } {
  const header = g[headerRow] ?? [];
  const rows: StatementRow[] = [];
  const problems: string[] = [];
  const cell = (r: Cell[], f: Field) => (map[f] === undefined ? null : r[map[f]!]);
  for (let i = headerRow + 1; i < g.length; i++) {
    const r = g[i];
    const date = parseDate(cell(r, "date"), fmt);
    let amount: number | null;
    if (map.amount !== undefined) amount = parseAmount(cell(r, "amount"));
    else {
      const dr = parseAmount(cell(r, "debit")), cr = parseAmount(cell(r, "credit"));
      amount = dr == null && cr == null ? null : Math.abs(cr ?? 0) - Math.abs(dr ?? 0);
    }
    if (!date && (amount == null || amount === 0)) continue;                 // totals / blank / footer rows
    if (!date) { problems.push(`Row ${i + 1}: no readable date`); continue; }
    if (amount == null || amount === 0) continue;                              // opening-balance lines etc.
    const raw: Record<string, string> = {};
    header.forEach((h, j) => { raw[String(h ?? `col${j + 1}`) || `col${j + 1}`] = r[j] instanceof Date ? (r[j] as Date).toISOString().slice(0, 10) : String(r[j] ?? ""); });
    rows.push({ date, value_date: parseDate(cell(r, "value_date"), fmt), description: String(cell(r, "description") ?? "").trim(), reference: String(cell(r, "reference") ?? "").trim(),
      cheque_no: String(cell(r, "cheque_no") ?? "").trim(), amount: Math.round(amount * 100) / 100, balance: parseAmount(cell(r, "balance")), raw });
  }
  return { rows, problems };
}
