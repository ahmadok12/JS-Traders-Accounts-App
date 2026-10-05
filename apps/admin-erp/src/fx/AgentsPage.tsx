import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Handshake, Plus, Receipt, RotateCcw, ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { useUrlState } from "../inventory/DocPage";
import { LookupPicker } from "../inventory/pickers";
import { AccountPicker, BankPicker, DateRangeBar, money, num, presetRange, today, useBanks, type DateRange } from "../accounting/common";
import { AttachmentsPanel } from "../attachments/Attachments";
import { rpc, useAction } from "../purchasing/common";
import { FxPaymentDialog, FxPayDialog } from "./FxPaymentsPage";
import { CurrencySelect, FxTile, fx, rateText, useHolderBalance } from "./common";

type Row = Record<string, unknown> & { id: string };
const icon = <Handshake className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";
type Kind = "FUND" | "REFUND" | "CHARGE" | "OPENING";
const KIND_LABEL: Record<Kind, string> = { FUND: "Funds sent to agent", REFUND: "Refund from agent", CHARGE: "Agent charges / commission", OPENING: "Opening balance" };
const KIND_TONE: Record<Kind, "info" | "success" | "warning" | "neutral"> = { FUND: "info", REFUND: "success", CHARGE: "warning", OPENING: "neutral" };

interface Summary { agent_id: string; code: string; name: string; currency: string; opening_fx: number; funded_fx: number; refunded_fx: number; settled_fx: number; charges_fx: number; converted_fx: number; balance_fx: number; balance_pkr: number; funded_pkr: number; settled_pkr: number; settlements: number }

export function AgentsPage() {
  const { companyId, can } = useAccess();
  const { params, update } = useUrlState();
  const tab = params.get("tab") ?? "balances";
  const [range, setRange] = React.useState<DateRange>(presetRange("all"));
  const [txn, setTxn] = React.useState<null | { kind: Kind; agent?: string; currency?: string }>(null);
  const [settle, setSettle] = React.useState(false);
  const ledger = params.get("agent") && params.get("cur") ? { agent: params.get("agent")!, cur: params.get("cur")! } : null;
  const sum = useQuery({
    queryKey: ["agent-summary", companyId, range.from, range.to], enabled: !!companyId,
    queryFn: async () => (await rpc<Summary[]>("agent_summary", { p_company_id: companyId, p_from: range.from, p_to: range.to })) ?? [],
  });
  const viewOk = can("payment_agents.view") || can("journals.view");
  if (!viewOk) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Payment agent accounts are restricted." /></Card>;
  const manage = can("payment_agents.manage") && can("journals.create");
  const rows = sum.data ?? [];
  const adv = rows.filter((r) => Number(r.balance_pkr) > 0).reduce((s, r) => s + Number(r.balance_pkr), 0);
  const pay = rows.filter((r) => Number(r.balance_pkr) < 0).reduce((s, r) => s - Number(r.balance_pkr), 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Payment Agent Accounts" icon={icon}
        description="Money exchanges / agents who pay foreign suppliers for us. Company bank → agent (an advance, per currency) → supplier settlement. A balance below zero means the agent paid before we funded it — we owe the agent."
        actions={manage && <>
          <Button icon={<ArrowUpRight className="h-4 w-4" />} onClick={() => setTxn({ kind: "FUND" })}>Fund agent</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setSettle(true)}>Supplier settlement</Button>
        </>} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <FxTile k="Advances with agents (PKR)" v={money(adv)} />
        <FxTile k="Owed to agents (PKR)" v={money(pay)} hot={pay > 0} />
        <FxTile k="Funded in period (PKR)" v={money(rows.reduce((s, r) => s + Number(r.funded_pkr), 0))} />
        <FxTile k="Settled for suppliers (PKR)" v={money(rows.reduce((s, r) => s + Number(r.settled_pkr), 0))} />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
          <Tabs value={tab} onChange={(t) => update({ tab: t === "balances" ? null : t })} tabs={[{ key: "balances", label: "Balances by currency" }, { key: "txns", label: "Funding & charges" }, { key: "settlements", label: "Supplier settlements" }]} />
          <div className="ml-auto"><DateRangeBar value={range} onChange={setRange} /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {tab === "balances" && (sum.isLoading ? <Skeleton className="h-40" /> : sum.error ? <p className="text-sm text-danger">{friendlyError(sum.error)}</p> : rows.length === 0
            ? <EmptyState icon={icon} title="No agent activity yet" description="Fund an agent or record an opening balance to start." />
            : (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-subtle"><tr>
                    <th className={th}>Agent</th><th className={th}>Account</th><th className={cn(th, "text-right")}>Opening</th><th className={cn(th, "text-right")}>Funded</th><th className={cn(th, "text-right")}>Settled for suppliers</th>
                    <th className={cn(th, "text-right")}>Charges</th><th className={cn(th, "text-right")}>Refunds / conversions</th><th className={cn(th, "text-right")}>Balance</th><th className={cn(th, "text-right")}>PKR value</th><th className={th} />
                  </tr></thead>
                  <tbody>{rows.map((r) => {
                    const b = Number(r.balance_fx);
                    return (
                      <tr key={r.agent_id + r.currency} className="hover:bg-subtle/50">
                        <td className={td}><span className="font-medium">{r.name}</span> <span className="text-2xs text-ink-muted">{r.code}</span></td>
                        <td className={td}><Badge>{r.currency}</Badge></td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(r.opening_fx)}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(r.funded_fx)}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(r.settled_fx)}{r.settlements ? <span className="text-2xs text-ink-muted"> ({r.settlements})</span> : null}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(r.charges_fx)}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(Number(r.converted_fx) - Number(r.refunded_fx))}</td>
                        <td className={cn(td, "text-right")}><span className={cn("font-semibold tabular-nums", b < 0 && "text-danger")}>{money(Math.abs(b))}</span> <span className="text-2xs text-ink-muted">{b < 0 ? "we owe" : b > 0 ? "advance" : ""}</span></td>
                        <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{money(r.balance_pkr)}</td>
                        <td className={cn(td, "whitespace-nowrap text-right")}>
                          <Button size="sm" variant="ghost" icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => update({ agent: r.agent_id, cur: r.currency })}>Ledger</Button>
                          {manage && <Button size="sm" variant="ghost" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => setTxn({ kind: "FUND", agent: r.agent_id, currency: r.currency })}>Fund</Button>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            ))}
          {tab === "txns" && <AgentTxnList manage={manage} onNew={(k) => setTxn({ kind: k })} />}
          {tab === "settlements" && <SettlementList />}
        </div>
      </Card>
      {txn && <AgentTxnDialog kind={txn.kind} agentId={txn.agent} currency={txn.currency} onClose={() => setTxn(null)} />}
      {settle && <FxPayDialog onClose={() => setSettle(false)} onDone={() => { setSettle(false); toast.success("Settlement recorded"); }} />}
      {ledger && <LedgerDialog kind="AGENT" holderId={ledger.agent} currency={ledger.cur} onClose={() => update({ agent: null, cur: null })} />}
    </div>
  );
}

function AgentTxnList({ manage, onNew }: { manage: boolean; onNew: (k: Kind) => void }) {
  const { companyId } = useAccess();
  const [page, setPage] = React.useState(1);
  const [view, setView] = React.useState<string | null>(null);
  const list = useEntityList<Row>({ table: "payment_agent_transactions_v", select: "id, doc_no, txn_date, agent_name, kind, currency, amount, fx_rate, amount_pkr, bank_name, reference, status",
    companyId, orderBy: { column: "txn_date", ascending: false }, page, pageSize: 50 });
  return (
    <>
      {manage && <div className="mb-2 flex flex-wrap gap-2">
        {(["FUND", "REFUND", "CHARGE", "OPENING"] as Kind[]).map((k) => <Button key={k} size="sm" icon={k === "REFUND" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : k === "CHARGE" ? <Receipt className="h-3.5 w-3.5" /> : k === "OPENING" ? <Wallet className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => onNew(k)}>{KIND_LABEL[k]}</Button>)}
      </div>}
      <DataTable loading={list.isLoading} rows={list.data?.rows ?? []} onView={(r) => setView(r.id)} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={setPage}
        columns={[
          { key: "d", header: "No.", width: "120px", cell: (r) => <span className="font-mono text-xs">{String(r.doc_no)}</span> },
          { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.txn_date as string) },
          { key: "a", header: "Agent", cell: (r) => String(r.agent_name) },
          { key: "k", header: "What", width: "200px", cell: (r) => <Badge tone={KIND_TONE[r.kind as Kind]}>{KIND_LABEL[r.kind as Kind]}</Badge> },
          { key: "b", header: "Bank", width: "160px", hideBelow: "md", cell: (r) => String(r.bank_name ?? "") },
          { key: "m", header: "Amount", width: "180px", align: "right", cell: (r) => <span className="tabular-nums"><b>{fx(r.amount as number, r.currency as string)}</b>{r.currency !== "PKR" && <div className="text-2xs text-ink-muted">@ {rateText(r.fx_rate as number)} = {money(r.amount_pkr as number)}</div>}</span> },
          { key: "s", header: "", width: "90px", cell: (r) => r.status === "REVERSED" ? <Badge tone="danger">reversed</Badge> : null },
        ]}
        empty={<EmptyState icon={icon} title="Nothing yet" description="Funds sent to agents, refunds, charges and opening balances appear here." />} />
      {view && <AgentTxnView id={view} onClose={() => setView(null)} />}
    </>
  );
}

function SettlementList() {
  const { companyId } = useAccess();
  const [page, setPage] = React.useState(1);
  const [view, setView] = React.useState<string | null>(null);
  const list = useEntityList<Row>({ table: "fx_payments_v", select: "id, doc_no, pay_date, supplier_name, agent_name, source_currency, source_amount, currency, fx_amount, fx_rate, amount_pkr, bills, shipment_no, exchange_reference, status",
    companyId, filters: { source_kind: "AGENT" }, orderBy: { column: "pay_date", ascending: false }, page, pageSize: 50 });
  return (
    <>
      <DataTable loading={list.isLoading} rows={list.data?.rows ?? []} onView={(r) => setView(r.id)} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={setPage}
        columns={[
          { key: "d", header: "Payment", width: "130px", cell: (r) => <span className="font-mono text-xs">{String(r.doc_no)}</span> },
          { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.pay_date as string) },
          { key: "a", header: "Agent", width: "160px", cell: (r) => String(r.agent_name) },
          { key: "s", header: "Supplier / bills / shipment", cell: (r) => <span>{String(r.supplier_name)}<span className="text-xs text-ink-muted">{r.bills ? ` · ${r.bills}` : " · not applied yet"}{r.shipment_no ? ` · ${r.shipment_no}` : ""}</span></span> },
          { key: "f", header: "From agent", width: "150px", align: "right", cell: (r) => <span className="tabular-nums">{fx(r.source_amount as number, r.source_currency as string)}</span> },
          { key: "t", header: "Supplier got", width: "170px", align: "right", cell: (r) => <span className="tabular-nums"><b>{fx(r.fx_amount as number, r.currency as string)}</b><div className="text-2xs text-ink-muted">@ {rateText(r.fx_rate as number)} = {money(r.amount_pkr as number)}</div></span> },
          { key: "x", header: "Slip", width: "100px", hideBelow: "lg", cell: (r) => String(r.exchange_reference ?? "") },
          { key: "st", header: "", width: "80px", cell: (r) => r.status === "REVERSED" ? <Badge tone="danger">reversed</Badge> : null },
        ]}
        empty={<EmptyState icon={icon} title="No settlements" description="Supplier payments made through an agent appear here." />} />
      {view && <FxPaymentDialog id={view} onClose={() => setView(null)} />}
    </>
  );
}

function AgentTxnDialog({ kind: k0, agentId, currency, onClose }: { kind: Kind; agentId?: string; currency?: string; onClose: () => void }) {
  const { companyId } = useAccess();
  const banks = useBanks();
  const idem = React.useRef(crypto.randomUUID());
  const [kind, setKind] = React.useState<Kind>(k0);
  const [f, setF] = React.useState({ agent: agentId ?? null as string | null, currency: currency ?? "PKR", amount: "", rate: "", bank: null as string | null, expense: null as string | null, date: today(), reference: "", notes: "", payable: false });
  const set = <K extends keyof typeof f>(key: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [key]: v }));
  const bal = useHolderBalance("AGENT", f.agent, f.currency);
  const amt = num(f.amount) || 0;
  const rate = f.currency === "PKR" ? 1 : num(f.rate) || 0;
  const bankCur = banks.data?.find((b) => b.id === f.bank)?.currency;
  const go = useAction(() => rpc("save_agent_transaction", { p_header: { company_id: companyId, kind, agent_id: f.agent, currency: f.currency, amount: kind === "OPENING" && f.payable ? -amt : amt, fx_rate: rate,
    bank_account_id: f.bank, expense_account_id: f.expense, txn_date: f.date, reference: f.reference, notes: f.notes }, p_idempotency_key: idem.current }), "Recorded", onClose);
  const errs: string[] = [];
  if (!f.agent) errs.push("Choose the agent");
  if (!(amt > 0)) errs.push("Enter the amount");
  if (!(rate > 0)) errs.push("Enter the rate");
  if ((kind === "FUND" || kind === "REFUND") && !f.bank) errs.push("Choose the bank / cash account");
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title={KIND_LABEL[kind]}
      footer={<><div className="flex-1 text-sm">{f.currency !== "PKR" && amt > 0 && rate > 0 && <>PKR <b className="tabular-nums">{money(amt * rate)}</b></>}</div><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={go.isPending} onClick={() => (errs.length ? toast.error(errs[0]) : go.mutate(undefined))}>Record</Button></>}>
      <div className="mb-3 flex flex-wrap rounded-control border border-line bg-subtle p-0.5">
        {(["FUND", "REFUND", "CHARGE", "OPENING"] as Kind[]).map((x) => (
          <button key={x} type="button" onClick={() => setKind(x)} className={cn("h-[28px] flex-1 rounded-[6px] px-2.5 text-xs font-medium", kind === x ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>{KIND_LABEL[x]}</button>
        ))}
      </div>
      <FormGrid cols={2}>
        <Field label="Payment agent" required><LookupPicker value={f.agent} onChange={(v) => set("agent", v)} clearable={false} placeholder="Agent…" spec={{ table: "payment_agents", label: "name", secondary: "code", filters: { is_active: true } }} /></Field>
        <Field label="Agent's account (currency)" hint={f.agent ? `Balance now: ${money(bal.data?.fx_balance ?? 0)}` : undefined}><CurrencySelect value={f.currency} onChange={(v) => set("currency", v)} /></Field>
        <Field label={`Amount (${f.currency})`} required><Input className="text-right tabular-nums" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
        {f.currency !== "PKR" ? <Field label={`Rate (PKR per 1 ${f.currency})`} required hint={kind === "FUND" ? "What the agent gave per rupee for this funding" : undefined}><Input className="text-right tabular-nums" inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} /></Field> : <div />}
        {(kind === "FUND" || kind === "REFUND") && <Field label={kind === "FUND" ? "Paid from" : "Received into"} required className="sm:col-span-2"
          hint={bankCur && bankCur !== "PKR" ? `${bankCur} account — ${bankCur} ${money(amt)} moves` : `PKR ${money(amt * rate)} ${kind === "FUND" ? "leaves" : "comes into"} the account`}><BankPicker value={f.bank} onChange={(v) => set("bank", v)} /></Field>}
        {kind === "CHARGE" && <Field label="Expense account" hint="Blank = Bank Charges" className="sm:col-span-2"><AccountPicker value={f.expense} onChange={(v) => set("expense", v)} accountType="EXPENSE" placeholder="Bank Charges" /></Field>}
        {kind === "OPENING" && <Field label="Side" className="sm:col-span-2">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" checked={!f.payable} onChange={() => set("payable", false)} /> Agent holds our money (advance)</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={f.payable} onChange={() => set("payable", true)} /> We owe the agent</label>
          </div></Field>}
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Reference / slip no."><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </FormGrid>
    </ErpDialog>
  );
}

function AgentTxnView({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, companyId } = useAccess();
  const navigate = useNavigate();
  const list = useEntityList<Row>({ table: "payment_agent_transactions_v", select: "*", companyId, filters: { id }, page: 1, pageSize: 1 });
  const r = list.data?.rows?.[0];
  const [ask, setAsk] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const rev = useAction(() => rpc("reverse_agent_transaction", { p_id: id, p_reason: reason }), "Reversed", () => { setAsk(false); onClose(); });
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title={r ? String(r.doc_no) : "…"} subtitle={r ? `${KIND_LABEL[r.kind as Kind]} · ${r.agent_name}` : undefined}
        status={r?.status === "REVERSED" ? <Badge tone="danger">reversed</Badge> : null}
        footer={r && <>
          {r.status === "POSTED" && can("payment_agents.manage") && can("journals.post") && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk(true)}>Reverse</Button>}
          <div className="flex-1" />
          {r.journal_entry_id ? <Button onClick={() => navigate(`/vouchers?view=${r.journal_entry_id}`)}>Accounting entry</Button> : null}
          <Button onClick={onClose}>Close</Button></>}>
        {!r ? <Skeleton className="h-24" /> : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
              <FxTile k={`Amount ${r.currency}`} v={money(Math.abs(Number(r.amount)))} sub={Number(r.amount) < 0 ? "we owe the agent" : undefined} />
              {r.currency !== "PKR" && <FxTile k="Rate" v={rateText(r.fx_rate as number)} />}
              <FxTile k="PKR" v={money(Math.abs(Number(r.amount_pkr)))} />
            </div>
            <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-2xs uppercase text-ink-muted">Date</dt><dd>{formatDate(r.txn_date as string)}</dd></div>
              {r.bank_name ? <div><dt className="text-2xs uppercase text-ink-muted">Bank</dt><dd>{String(r.bank_name)}</dd></div> : null}
              {r.expense_account_name ? <div><dt className="text-2xs uppercase text-ink-muted">Expense</dt><dd>{String(r.expense_account_name)}</dd></div> : null}
              <div><dt className="text-2xs uppercase text-ink-muted">Reference</dt><dd>{String(r.reference ?? "—")}</dd></div>
              {r.notes ? <div className="col-span-2"><dt className="text-2xs uppercase text-ink-muted">Notes</dt><dd>{String(r.notes)}</dd></div> : null}
            </dl>
            <AttachmentsPanel entityType="payment_agent_transactions" entityId={id} />
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask} title="Reverse this?" tone="destructive" confirmLabel="Reverse" loading={rev.isPending} onCancel={() => setAsk(false)} onConfirm={() => rev.mutate(undefined)} message="A reversal entry is posted; the original stays in history.">
        <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}

/* ---------------------------------------------------------------- currency ledger (agents, suppliers, banks) */
interface LRow { row_kind: string; entry_id: string | null; entry_no: string | null; entry_date: string | null; source_type: string | null; memo: string | null; reference: string | null; description: string | null;
  fx_in: number | null; fx_out: number | null; rate: number | null; pkr_in: number | null; pkr_out: number | null; fx_balance: number; pkr_balance: number }

export function LedgerDialog({ kind, holderId, currency, onClose }: { kind: "AGENT" | "SUPPLIER" | "BANK"; holderId: string; currency: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [range, setRange] = React.useState<DateRange>(presetRange("all"));
  const q = useQuery({ queryKey: ["currency-ledger", kind, holderId, currency, range.from, range.to],
    queryFn: async () => (await rpc<LRow[]>("currency_ledger", { p_kind: kind, p_holder_id: holderId, p_currency: currency, p_from: range.from, p_to: range.to })) ?? [] });
  const name = useQuery({ queryKey: ["holder-name", kind, holderId], queryFn: async () => {
    const t = kind === "AGENT" ? "payment_agents" : kind === "SUPPLIER" ? "suppliers" : "bank_accounts";
    const { data } = await sb().from(t).select("name").eq("id", holderId).single();
    return (data as { name: string } | null)?.name ?? "";
  } });
  const inLabel = kind === "SUPPLIER" ? "Bills / we owe more" : "In";
  const outLabel = kind === "SUPPLIER" ? "Paid / settled" : "Out";
  const last = (q.data ?? []).at(-1);
  return (
    <ErpDialog open onRequestClose={onClose} size="full" icon={<BookOpen className="h-4 w-4" />} title={`${name.data ?? ""} — ${currency} ledger`}
      subtitle="Every line keeps the rate of its own transaction; PKR running balance alongside" footer={<><div className="flex-1" /><Button onClick={onClose}>Close</Button></>}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DateRangeBar value={range} onChange={setRange} />
        {last && <span className="ml-auto text-sm">Balance <b className="tabular-nums">{currency} {money(last.fx_balance)}</b> <span className="text-ink-muted">· PKR {money(last.pkr_balance)}</span></span>}
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-subtle"><tr>
              <th className={th}>Date</th><th className={th}>Entry</th><th className={th}>Details</th>
              <th className={cn(th, "text-right")}>{inLabel}</th><th className={cn(th, "text-right")}>{outLabel}</th><th className={cn(th, "text-right")}>Rate</th>
              <th className={cn(th, "text-right")}>Balance {currency}</th><th className={cn(th, "text-right")}>PKR in</th><th className={cn(th, "text-right")}>PKR out</th><th className={cn(th, "text-right")}>PKR balance</th>
            </tr></thead>
            <tbody>{(q.data ?? []).map((r, i) => (
              <tr key={i} className={r.row_kind === "OPENING" ? "bg-subtle/50 font-medium" : undefined}>
                <td className={cn(td, "text-xs")}>{r.entry_date ? formatDate(r.entry_date) : ""}</td>
                <td className={cn(td, "font-mono text-xs")}>{r.entry_id ? <button className="text-primary hover:underline" onClick={() => navigate(`/vouchers?view=${r.entry_id}`)}>{r.entry_no}</button> : null}</td>
                <td className={cn(td, "text-xs")}>{r.row_kind === "OPENING" ? "Opening balance" : <>{r.description ?? r.memo}{r.reference ? <span className="text-ink-muted"> · {r.reference}</span> : null}</>}</td>
                <td className={cn(td, "text-right tabular-nums")}>{money(r.fx_in)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{money(r.fx_out)}</td>
                <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{rateText(r.rate)}</td>
                <td className={cn(td, "text-right font-medium tabular-nums")}>{money(r.fx_balance)}</td>
                <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{money(r.pkr_in)}</td>
                <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{money(r.pkr_out)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{money(r.pkr_balance)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </ErpDialog>
  );
}
