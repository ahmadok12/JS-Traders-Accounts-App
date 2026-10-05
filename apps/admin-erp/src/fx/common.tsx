import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { BankPicker, money, num } from "../accounting/common";
import { LookupPicker } from "../inventory/pickers";
import { rpc } from "../purchasing/common";

export const fx = (v: number | string | null | undefined, cur?: string | null) => (v == null || v === "" ? "" : `${cur ? cur + " " : ""}${money(v)}`);
export const rateText = (v: number | string | null | undefined) => (v == null || v === "" ? "" : String(Number(Number(v).toFixed(4))));

/** Active currencies from the database (codes are what postings use — e.g. CNY for RMB). */
export function useCurrencies() {
  return useQuery({
    queryKey: ["currencies"],
    staleTime: 30 * 60_000,
    queryFn: async () => ((await sb().from("currencies").select("code, name, symbol").eq("is_active", true).order("code")).data ?? []) as { code: string; name: string; symbol: string | null }[],
  });
}

export function CurrencySelect({ value, onChange, foreignOnly, disabled, className }: { value: string; onChange: (v: string) => void; foreignOnly?: boolean; disabled?: boolean; className?: string }) {
  const q = useCurrencies();
  const list = (q.data ?? []).filter((c) => !foreignOnly || c.code !== "PKR");
  return (
    <select className={cn("h-control w-full rounded-control border border-line bg-surface px-2 text-sm", className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Currency…</option>}
      {list.map((c) => <option key={c.code} value={c.code}>{c.code}{c.code === "CNY" ? " (RMB)" : ""} — {c.name}</option>)}
    </select>
  );
}

/** Balance of one holder (supplier / agent / bank) in one currency + its carrying rate (reporting only). */
export function useHolderBalance(kind: "SUPPLIER" | "AGENT" | "BANK", holderId: string | null | undefined, currency: string | null | undefined) {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["currency-balance", kind, holderId, currency],
    enabled: !!companyId && !!holderId && !!currency,
    queryFn: async () => {
      const rows = (await rpc<{ holder_id: string; currency: string; fx_balance: number; pkr_balance: number; carrying_rate: number | null }[]>("currency_balances", { p_company_id: companyId, p_kind: kind, p_as_of: null })) ?? [];
      return rows.find((r) => r.holder_id === holderId && r.currency === currency) ?? { holder_id: holderId!, currency: currency!, fx_balance: 0, pkr_balance: 0, carrying_rate: null };
    },
  });
}

export interface PaySource { kind: "BANK" | "AGENT"; bank_account_id: string | null; agent_id: string | null; source_currency: string; source_amount: string }
export const emptySource = (): PaySource => ({ kind: "BANK", bank_account_id: null, agent_id: null, source_currency: "PKR", source_amount: "" });
export const sourcePayload = (s: PaySource) =>
  s.kind === "BANK" ? { kind: "BANK", bank_account_id: s.bank_account_id } : { kind: "AGENT", agent_id: s.agent_id, source_currency: s.source_currency, source_amount: s.source_amount ? num(s.source_amount) : null };

/** Paid from: a bank / cash account, or a payment agent's sub-account (agent settlement). */
export function PaySourceFields({ value, onChange, currency, fxAmount, rate, err }: {
  value: PaySource; onChange: (v: PaySource) => void; currency: string; fxAmount: number; rate: number; err?: string;
}) {
  const set = (p: Partial<PaySource>) => onChange({ ...value, ...p });
  const bal = useHolderBalance("AGENT", value.kind === "AGENT" ? value.agent_id : null, value.source_currency);
  const pkr = Math.round(fxAmount * rate * 100) / 100;
  const takes = value.source_currency === "PKR" ? pkr : value.source_currency === currency ? fxAmount : num(value.source_amount) || 0;
  const left = (bal.data?.fx_balance ?? 0) - takes;
  return (
    <div className="space-y-2">
      <div className="flex rounded-control border border-line bg-subtle p-0.5">
        {(["BANK", "AGENT"] as const).map((k) => (
          <button key={k} type="button" onClick={() => set({ kind: k })}
            className={cn("h-[28px] flex-1 rounded-[6px] px-2.5 text-xs font-medium", value.kind === k ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>
            {k === "BANK" ? "From our bank / cash" : "Through a payment agent"}
          </button>
        ))}
      </div>
      {value.kind === "BANK" ? (
        <BankPicker value={value.bank_account_id} onChange={(v) => set({ bank_account_id: v })} invalid={!!err} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <LookupPicker value={value.agent_id} onChange={(v) => set({ agent_id: v })} clearable={false} invalid={!!err} placeholder="Payment agent…"
            spec={{ table: "payment_agents", label: "name", secondary: "code", filters: { is_active: true } }} />
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-ink-muted">from its</span>
            <CurrencySelect value={value.source_currency} onChange={(v) => set({ source_currency: v, source_amount: "" })} />
          </div>
          {value.source_currency !== "PKR" && value.source_currency !== currency && (
            <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-2">{value.source_currency} taken from the agent
              <Input className="h-control-sm w-36 text-right tabular-nums" inputMode="decimal" value={value.source_amount} onChange={(e) => set({ source_amount: e.target.value })} />
            </label>
          )}
          {value.agent_id && (
            <p className="text-xs text-ink-muted sm:col-span-2">
              Agent's {value.source_currency} balance: <b className={cn("tabular-nums", (bal.data?.fx_balance ?? 0) < 0 ? "text-danger" : "text-ink")}>{money(bal.data?.fx_balance ?? 0)}</b>
              {bal.data?.carrying_rate && value.source_currency !== "PKR" ? <> (funded at about {rateText(bal.data.carrying_rate)})</> : null}
              {takes > 0 && <> → after this <b className={cn("tabular-nums", left < 0 ? "text-warning" : "text-ink")}>{money(left)}</b>{left < 0 && " — the agent pays before being funded (we will owe the agent)"}</>}
            </p>
          )}
        </div>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

export function FxTile({ k, v, hot, sub }: { k: string; v: React.ReactNode; hot?: boolean; sub?: React.ReactNode }) {
  return (
    <div className={cn("rounded-card border border-line px-3 py-2", hot && "border-red-200 bg-red-50/60")}>
      <div className="text-2xs uppercase tracking-wide text-ink-muted">{k}</div>
      <div className="text-lg font-semibold tabular-nums">{v}</div>
      {sub && <div className="text-2xs text-ink-muted">{sub}</div>}
    </div>
  );
}

/** + loss / − gain → plain words */
export function FxDiff({ v }: { v: number | string | null | undefined }) {
  const n = Number(v ?? 0);
  if (Math.abs(n) < 0.005) return <span className="text-ink-faint">—</span>;
  return <span className={cn("tabular-nums font-medium", n > 0 ? "text-danger" : "text-success")}>{money(Math.abs(n))} <span className="text-2xs font-normal">{n > 0 ? "loss" : "gain"}</span></span>;
}
