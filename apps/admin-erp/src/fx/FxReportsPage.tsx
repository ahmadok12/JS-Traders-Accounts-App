import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Coins, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, cn } from "@jst/ui";
import { friendlyError, useAccess } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { useUrlState } from "../inventory/DocPage";
import { DateRangeBar, money, presetRange, type DateRange } from "../accounting/common";
import { rpc } from "../purchasing/common";
import { LedgerDialog } from "./AgentsPage";
import { FxTile, rateText } from "./common";

const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";
type Kind = "SUPPLIER" | "AGENT" | "BANK";
interface Bal { holder_id: string; code: string; name: string; currency: string; fx_balance: number; pkr_balance: number; carrying_rate: number | null; last_date: string | null }
interface Gl { entry_id: string; entry_no: string; entry_date: string; source_type: string | null; source_id: string | null; party_name: string | null; memo: string | null; description: string | null; loss: number; gain: number }
const SRC: Record<string, string> = { FX_SETTLEMENT: "Bill settled", CURRENCY_CONVERSION: "Conversion" };

export function FxReportsPage() {
  const { companyId, can } = useAccess();
  const { params, update } = useUrlState();
  const tab = params.get("tab") ?? "SUPPLIER";
  const [asOf, setAsOf] = React.useState("");
  const [range, setRange] = React.useState<DateRange>(presetRange("year"));
  const [foreignOnly, setForeignOnly] = React.useState(true);
  const [ledger, setLedger] = React.useState<null | { kind: Kind; id: string; cur: string }>(null);
  const navigate = useNavigate();
  const isBal = tab === "SUPPLIER" || tab === "AGENT" || tab === "BANK";
  const bal = useQuery({ queryKey: ["currency-balances", companyId, tab, asOf], enabled: !!companyId && isBal,
    queryFn: async () => (await rpc<Bal[]>("currency_balances", { p_company_id: companyId, p_kind: tab, p_as_of: asOf || null })) ?? [] });
  const gl = useQuery({ queryKey: ["fx-gl", companyId, range.from, range.to], enabled: !!companyId && tab === "FX",
    queryFn: async () => (await rpc<Gl[]>("fx_gain_loss_report", { p_company_id: companyId, p_from: range.from, p_to: range.to })) ?? [] });
  if (!can("journals.view")) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Needs accounting access." /></Card>;
  const rows = (bal.data ?? []).filter((r) => !foreignOnly || r.currency !== "PKR" || tab === "AGENT");
  const byCur = new Map<string, { fx: number; pkr: number }>();
  for (const r of rows) { const x = byCur.get(r.currency) ?? { fx: 0, pkr: 0 }; x.fx += Number(r.fx_balance); x.pkr += Number(r.pkr_balance); byCur.set(r.currency, x); }
  const loss = (gl.data ?? []).reduce((s, r) => s + Number(r.loss), 0), gain = (gl.data ?? []).reduce((s, r) => s + Number(r.gain), 0);
  const sideLabel = (v: number) => tab === "SUPPLIER" ? (v >= 0 ? "we owe" : "advance") : tab === "AGENT" ? (v >= 0 ? "advance" : "we owe") : (v >= 0 ? "" : "overdrawn");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Currency Balances & FX" icon={<Coins className="h-4 w-4" />}
        description="Balances kept in each currency (with their PKR value at the rates actually used) and realized exchange gain / loss. The carrying rate is an average for reporting only — postings always use each transaction's own rate." />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
          <Tabs value={tab} onChange={(t) => update({ tab: t === "SUPPLIER" ? null : t })} tabs={[{ key: "SUPPLIER", label: "Suppliers" }, { key: "AGENT", label: "Payment agents" }, { key: "BANK", label: "Bank accounts" }, { key: "FX", label: "Realized FX gain / loss" }]} />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {isBal ? <>
              {tab !== "AGENT" && <label className="flex items-center gap-1.5 text-xs text-ink-muted"><input type="checkbox" checked={foreignOnly} onChange={(e) => setForeignOnly(e.target.checked)} /> Foreign currencies only</label>}
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">As of <input type="date" className="h-control-sm rounded-control border border-line px-2 text-sm" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
            </> : <DateRangeBar value={range} onChange={setRange} />}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {isBal && (bal.isLoading ? <Skeleton className="h-40" /> : bal.error ? <p className="text-sm text-danger">{friendlyError(bal.error)}</p> : (
            <>
              {byCur.size > 0 && <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[...byCur.entries()].map(([c, v]) => <FxTile key={c} k={`Total ${c}`} v={money(v.fx)} sub={c !== "PKR" ? `PKR ${money(v.pkr)}` : undefined} />)}
              </div>}
              {rows.length === 0 ? <EmptyState icon={<Coins className="h-6 w-6" />} title="No balances" description="Nothing open in these currencies." /> : (
                <div className="overflow-x-auto rounded-card border border-line">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-subtle"><tr><th className={th}>Name</th><th className={th}>Currency</th><th className={cn(th, "text-right")}>Balance</th><th className={cn(th, "text-right")}>PKR value</th>
                      <th className={cn(th, "text-right")}>Carrying rate</th><th className={th}>Last activity</th><th className={th} /></tr></thead>
                    <tbody>{rows.map((r) => (
                      <tr key={r.holder_id + r.currency} className="hover:bg-subtle/50">
                        <td className={td}><span className="font-medium">{r.name}</span> <span className="text-2xs text-ink-muted">{r.code}</span></td>
                        <td className={td}><Badge>{r.currency}</Badge></td>
                        <td className={cn(td, "text-right")}><span className="font-semibold tabular-nums">{money(Math.abs(r.fx_balance))}</span> <span className="text-2xs text-ink-muted">{sideLabel(Number(r.fx_balance))}</span></td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(r.pkr_balance)}</td>
                        <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{r.currency === "PKR" ? "" : rateText(r.carrying_rate)}</td>
                        <td className={cn(td, "text-xs")}>{r.last_date ? formatDate(r.last_date) : ""}</td>
                        <td className={cn(td, "text-right")}><Button size="sm" variant="ghost" icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => setLedger({ kind: tab as Kind, id: r.holder_id, cur: r.currency })}>Ledger</Button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          ))}
          {tab === "FX" && (gl.isLoading ? <Skeleton className="h-40" /> : gl.error ? <p className="text-sm text-danger">{friendlyError(gl.error)}</p> : (
            <>
              <div className="mb-3 grid grid-cols-3 gap-3 md:max-w-2xl">
                <FxTile k="Exchange losses" v={money(loss)} />
                <FxTile k="Exchange gains" v={money(gain)} />
                <FxTile k={gain - loss >= 0 ? "Net gain" : "Net loss"} v={money(Math.abs(gain - loss))} hot={gain - loss < 0} />
              </div>
              {(gl.data ?? []).length === 0 ? <EmptyState icon={<Coins className="h-6 w-6" />} title="No exchange differences" description="They appear when foreign payments are applied to bills at a different rate, or on conversions." /> : (
                <div className="overflow-x-auto rounded-card border border-line">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-subtle"><tr><th className={th}>Date</th><th className={th}>Entry</th><th className={th}>From</th><th className={th}>Party</th><th className={th}>Details</th><th className={cn(th, "text-right")}>Loss</th><th className={cn(th, "text-right")}>Gain</th></tr></thead>
                    <tbody>{(gl.data ?? []).map((r, i) => (
                      <tr key={i}>
                        <td className={cn(td, "text-xs")}>{formatDate(r.entry_date)}</td>
                        <td className={cn(td, "font-mono text-xs")}><button className="text-primary hover:underline" onClick={() => navigate(`/vouchers?view=${r.entry_id}`)}>{r.entry_no}</button></td>
                        <td className={cn(td, "text-xs")}>{SRC[r.source_type ?? ""] ?? (r.source_type ? r.source_type.toLowerCase().replace(/_/g, " ") : "Journal")}</td>
                        <td className={td}>{r.party_name}</td>
                        <td className={cn(td, "text-xs text-ink-muted")}>{r.description ?? r.memo}</td>
                        <td className={cn(td, "text-right tabular-nums text-danger")}>{Number(r.loss) ? money(r.loss) : ""}</td>
                        <td className={cn(td, "text-right tabular-nums text-success")}>{Number(r.gain) ? money(r.gain) : ""}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          ))}
        </div>
      </Card>
      {ledger && <LedgerDialog kind={ledger.kind} holderId={ledger.id} currency={ledger.cur} onClose={() => setLedger(null)} />}
    </div>
  );
}
