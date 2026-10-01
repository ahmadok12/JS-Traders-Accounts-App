/** Formatting helpers shared across apps. Money is never a float in storage;
 *  these helpers only format values returned as numeric strings/numbers. */

export function formatNumber(v: number | string | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-PK", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** PENDING/UNKNOWN is never shown as zero (spec invariant 7). */
export function formatMoney(v: number | string | null | undefined, currency = "PKR", decimals = 2): string {
  if (v === null || v === undefined || v === "") return "Pending";
  return `${currency} ${formatNumber(v, decimals)}`;
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function humanize(code: string | null | undefined): string {
  if (!code) return "";
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Shallow diff: returns only keys whose values changed (used to send minimal updates). */
export function diffObject<T extends Record<string, unknown>>(before: Partial<T>, after: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const a = normalizeEmpty(after[k]);
    const b = normalizeEmpty(before[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = a as T[keyof T];
  }
  return out;
}

export function normalizeEmpty(v: unknown): unknown {
  if (v === "" || v === undefined) return null;
  return v;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
