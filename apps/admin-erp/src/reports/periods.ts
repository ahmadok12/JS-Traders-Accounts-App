/** Report period presets. Week starts Monday. Dates are local (Pakistan time), not UTC. */
export type PeriodKey =
  | "last10" | "last25" | "last50" | "last100"
  | "today" | "yesterday" | "week" | "lastweek" | "month" | "lastmonth" | "quarter" | "lastquarter" | "year" | "lastyear" | "all" | "custom";

export const LAST_N: Partial<Record<PeriodKey, number>> = { last10: 10, last25: 25, last50: 50, last100: 100 };

export const PERIOD_GROUPS: { label: string; items: [PeriodKey, string][] }[] = [
  { label: "Latest", items: [["last10", "Last 10 transactions"], ["last25", "Last 25 transactions"], ["last50", "Last 50 transactions"], ["last100", "Last 100 transactions"]] },
  { label: "Period", items: [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["lastweek", "Last week"], ["month", "This month"], ["lastmonth", "Last month"],
    ["quarter", "This quarter"], ["lastquarter", "Last quarter"], ["year", "This year"], ["lastyear", "Last year"], ["all", "All dates"]] },
  { label: "", items: [["custom", "Custom dates…"]] },
];
export const PERIOD_LABEL = Object.fromEntries(PERIOD_GROUPS.flatMap((g) => g.items)) as Record<PeriodKey, string>;

export const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function periodRange(k: PeriodKey, now = new Date()): { from: string | null; to: string | null } {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const q = Math.floor(m / 3);
  const r = (a: Date, b: Date) => ({ from: isoLocal(a), to: isoLocal(b) });
  switch (k) {
    case "today": return r(now, now);
    case "yesterday": { const t = new Date(y, m, d - 1); return r(t, t); }
    case "week": return r(new Date(y, m, d - day), new Date(y, m, d - day + 6));
    case "lastweek": return r(new Date(y, m, d - day - 7), new Date(y, m, d - day - 1));
    case "month": return r(new Date(y, m, 1), new Date(y, m + 1, 0));
    case "lastmonth": return r(new Date(y, m - 1, 1), new Date(y, m, 0));
    case "quarter": return r(new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 0));
    case "lastquarter": return r(new Date(y, q * 3 - 3, 1), new Date(y, q * 3, 0));
    case "year": return r(new Date(y, 0, 1), new Date(y, 11, 31));
    case "lastyear": return r(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    default: return { from: null, to: null }; // last N, all, custom (custom keeps its own dates)
  }
}

/** "as of" shortcuts for balance-type reports */
export function asOfPreset(k: "today" | "lastmonthend" | "lastquarterend" | "lastyearend", now = new Date()): string {
  const y = now.getFullYear(), m = now.getMonth();
  switch (k) {
    case "lastmonthend": return isoLocal(new Date(y, m, 0));
    case "lastquarterend": return isoLocal(new Date(y, Math.floor(m / 3) * 3, 0));
    case "lastyearend": return isoLocal(new Date(y - 1, 11, 31));
    default: return isoLocal(now);
  }
}
