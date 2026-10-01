import { useQuery } from "@tanstack/react-query";
import { Input, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { formatNumber } from "@jst/utilities";
import { LookupPicker } from "../inventory/pickers";

export type EntryType = "RECEIPT" | "PAYMENT" | "TRANSFER" | "JOURNAL" | "OPENING" | "SYSTEM";
export type PartyType = "CUSTOMER" | "SUPPLIER" | "EMPLOYEE";

export const ENTRY_LABEL: Record<EntryType, string> = {
  RECEIPT: "Receipt",
  PAYMENT: "Payment",
  TRANSFER: "Bank / cash transfer",
  JOURNAL: "Journal",
  OPENING: "Opening balance",
  SYSTEM: "System entry",
};
export const ENTRY_TONE: Record<EntryType, "success" | "danger" | "info" | "neutral" | "warning"> = {
  RECEIPT: "success", PAYMENT: "danger", TRANSFER: "info", JOURNAL: "neutral", OPENING: "warning", SYSTEM: "neutral",
};

export const money = (v: number | string | null | undefined) => (v == null || v === "" ? "" : formatNumber(Number(v), 2));
export const num = (s: string) => Number(String(s ?? "").replace(/,/g, ""));
export const today = () => new Date().toISOString().slice(0, 10);

export function AccountPicker(p: { value: string | null; onChange: (v: string | null) => void; invalid?: boolean; disabled?: boolean; placeholder?: string; accountType?: string }) {
  return (
    <LookupPicker {...p} clearable={false} placeholder={p.placeholder ?? "Account…"}
      spec={{ table: "chart_of_accounts", label: "name", secondary: "code", filters: { is_group: false, is_active: true, ...(p.accountType ? { account_type: p.accountType } : {}) } }} />
  );
}
export function BankPicker(p: { value: string | null; onChange: (v: string | null) => void; invalid?: boolean; disabled?: boolean; placeholder?: string }) {
  return <LookupPicker {...p} clearable={false} placeholder={p.placeholder ?? "Bank / cash account…"} spec={{ table: "bank_accounts", label: "name", secondary: "code", filters: { is_active: true } }} />;
}
export function PartyPicker({ type, ...p }: { type: PartyType; value: string | null; onChange: (v: string | null) => void; invalid?: boolean; disabled?: boolean }) {
  const spec = type === "EMPLOYEE"
    ? { table: "employees", label: "full_name", secondary: "code", filters: { is_active: true } }
    : { table: type === "CUSTOMER" ? "customers" : "suppliers", label: "name", secondary: "code", filters: { is_active: true } };
  return <LookupPicker key={type} {...p} clearable={false} placeholder={type === "CUSTOMER" ? "Customer…" : type === "SUPPLIER" ? "Supplier…" : "Employee…"} spec={spec} />;
}

/** System accounts by key (AR_CONTROL, AP_CONTROL, OPENING_BALANCE …) and which accounts need a party. */
export function useSystemAccounts() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["system-accounts", companyId],
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("chart_of_accounts").select("id, code, name, system_key").eq("company_id", companyId!).not("system_key", "is", null);
      if (error) throw error;
      const byKey: Record<string, { id: string; code: string; name: string }> = {};
      const partyOf: Record<string, PartyType> = {};
      for (const a of data ?? []) {
        byKey[a.system_key as string] = { id: a.id, code: a.code, name: a.name };
        const k = a.system_key as string;
        if (k === "AR_CONTROL" || k === "CUSTOMER_ADVANCE") partyOf[a.id] = "CUSTOMER";
        if (k === "AP_CONTROL" || k === "SUPPLIER_ADVANCE") partyOf[a.id] = "SUPPLIER";
        if (k === "EMPLOYEE_ADVANCE" || k === "EMPLOYEE_PAYABLE") partyOf[a.id] = "EMPLOYEE";
      }
      return { byKey, partyOf };
    },
  });
}

/** Bank / cash accounts with their GL account (vouchers post to the GL account and carry the bank). */
export function useBanks() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["banks-gl", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("bank_accounts").select("id, code, name, currency, gl_account_id, account_kind").eq("company_id", companyId!).eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Account names for a set of ids (draft lines store ids only). */
export function useAccountNames(ids: string[]) {
  const list = Array.from(new Set(ids.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["account-names", list.join()],
    enabled: list.length > 0,
    queryFn: async () => {
      const { data, error } = await sb().from("chart_of_accounts").select("id, code, name").in("id", list);
      if (error) throw error;
      return new Map((data ?? []).map((a) => [a.id as string, `${a.code} · ${a.name}`]));
    },
  });
}

/** Party names for lines: CUSTOMER/SUPPLIER/EMPLOYEE ids → name */
export function usePartyNames(parties: { type: string | null; id: string | null }[]) {
  const key = parties.filter((p) => p.id).map((p) => `${p.type}:${p.id}`).sort().join();
  return useQuery({
    queryKey: ["party-names", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const ids = (t: string) => parties.filter((p) => p.type === t && p.id).map((p) => p.id!) as string[];
      const m = new Map<string, string>();
      const [c, s, e] = await Promise.all([
        ids("CUSTOMER").length ? sb().from("customers").select("id, name").in("id", ids("CUSTOMER")) : Promise.resolve({ data: [] }),
        ids("SUPPLIER").length ? sb().from("suppliers").select("id, name").in("id", ids("SUPPLIER")) : Promise.resolve({ data: [] }),
        ids("EMPLOYEE").length ? sb().from("employees").select("id, full_name").in("id", ids("EMPLOYEE")) : Promise.resolve({ data: [] }),
      ]);
      for (const r of (c.data ?? []) as { id: string; name: string }[]) m.set(r.id, r.name);
      for (const r of (s.data ?? []) as { id: string; name: string }[]) m.set(r.id, r.name);
      for (const r of (e.data ?? []) as { id: string; full_name: string }[]) m.set(r.id, r.full_name);
      return m;
    },
  });
}

/* ---------------------------------------------------------------- date range */
export interface DateRange { from: string | null; to: string | null }
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export function presetRange(k: string): DateRange {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (k) {
    case "month": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "prev": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "year": return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default: return { from: null, to: null };
  }
}
const PRESETS = [["all", "All"], ["month", "This month"], ["prev", "Last month"], ["year", "This year"]] as const;
export function DateRangeBar({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const active = PRESETS.find(([k]) => { const r = presetRange(k); return r.from === value.from && r.to === value.to; })?.[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-control border border-line bg-subtle p-0.5">
        {PRESETS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => onChange(presetRange(k))}
            className={cn("h-[26px] rounded-[6px] px-2.5 text-xs font-medium", active === k ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>{label}</button>
        ))}
      </div>
      <Input type="date" aria-label="From" className="h-control-sm w-36" value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || null })} />
      <span className="text-xs text-ink-faint">to</span>
      <Input type="date" aria-label="To" className="h-control-sm w-36" value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value || null })} />
    </div>
  );
}

export function Amount({ v, className }: { v: number | string | null | undefined; className?: string }) {
  if (v == null || v === "" || Number(v) === 0) return <span className={cn("text-ink-faint", className)}>—</span>;
  return <span className={cn("tabular-nums", className)}>{money(v)}</span>;
}

/** Balance with plain-language side ("they owe" / "we owe") */
export function BalanceText({ v, partyType }: { v: number; partyType: PartyType | "BANK" }) {
  if (Math.abs(v) < 0.005) return <span className="tabular-nums text-ink-faint">0.00</span>;
  const label = partyType === "BANK" ? (v >= 0 ? "" : " overdrawn")
    : partyType === "SUPPLIER" ? (v >= 0 ? " we owe" : " they owe")
    : (v >= 0 ? " they owe" : " we owe");
  return <span className="whitespace-nowrap tabular-nums font-medium">{money(Math.abs(v))}<span className="text-2xs font-normal text-ink-muted">{label}</span></span>;
}
