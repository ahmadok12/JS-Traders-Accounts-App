import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FileUp, GitMerge, Link2, Plus, Scale, ShieldAlert, Sparkles, Trash2, Undo2, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErpDialog, Field, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { formatDate, formatDateTime } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { useUrlState } from "../inventory/DocPage";
import { AccountPicker, BankPicker, PartyPicker, money, num, today, useBanks, useSystemAccounts } from "../accounting/common";
import { rpc, useAction } from "../purchasing/common";
import { FIELD_LABEL, buildRows, findHeaderRow, guessMapping, readStatementFile, type DateFormat, type Field as SField, type Grid, type StatementRow } from "./statementParse";

const icon = <Scale className="h-4 w-4" />;
const th = "h-8 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";
const amt = (v: number) => <span className={cn("tabular-nums", v < 0 ? "text-danger" : "text-success")}>{v < 0 ? "−" : "+"}{money(Math.abs(v))}</span>;

interface SLine { id: string; line_date: string; description: string | null; reference: string | null; cheque_no: string | null; amount: number; balance: number | null; status: string; ignore_reason: string | null; import_no: string; match_group: string | null; reconciliation_id: string | null; is_authorised_duplicate: boolean }
interface BLine { id: string; entry_id: string; entry_no: string; entry_date: string; entry_type: string; memo: string | null; reference: string | null; party_name: string | null; description: string | null; amount: number; match_group: string | null; reversal_of: string | null; reversed_by_entry: string | null }
interface Summary { ledger_balance: number; book_not_on_statement: number; book_items: number; statement_not_in_books: number; statement_items: number; adjusted_balance: number; statement_balance: number | null; difference: number | null; last_statement_balance: number | null; reconciled_until: string | null }

export function BankRecPage() {
  const { can } = useAccess();
  const { params, update } = useUrlState();
  const banks = useBanks();
  const bank = params.get("bank") ?? banks.data?.find((b) => b.account_kind === "BANK")?.id ?? banks.data?.[0]?.id ?? null;
  const tab = params.get("tab") ?? "rec";
  if (!(can("journals.view") || can("bank.reconcile"))) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Bank reconciliation is restricted." /></Card>;
  const b = banks.data?.find((x) => x.id === bank);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Bank Reconciliation" icon={icon}
        description="Import the bank statement, match its lines with the entries in our books (suggestions are only suggestions), create what is missing, then finalize up to the statement date. Nothing is ever posted outside the normal accounting engine." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-72"><BankPicker value={bank} onChange={(v) => update({ bank: v })} /></div>
        {b && b.currency !== "PKR" && <Badge tone="info">{b.currency} account — amounts in {b.currency}</Badge>}
        <Tabs value={tab} onChange={(t) => update({ tab: t === "rec" ? null : t })} tabs={[{ key: "rec", label: "Reconcile" }, { key: "import", label: "Import statement" }, { key: "matched", label: "Matched" }, { key: "history", label: "History" }]} />
      </div>
      {!bank ? <Card><EmptyState icon={icon} title="Choose a bank account" /></Card> : (
        <>
          {tab === "rec" && <ReconcileTab bankId={bank} />}
          {tab === "import" && <ImportTab bankId={bank} onDone={() => update({ tab: null })} />}
          {tab === "matched" && <MatchedTab bankId={bank} />}
          {tab === "history" && <HistoryTab bankId={bank} />}
        </>
      )}
    </div>
  );
}

/* ================================================================== reconcile */
function ReconcileTab({ bankId }: { bankId: string }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const manage = can("bank.reconcile");
  const latest = useQuery({ queryKey: ["bank-latest-line", bankId], queryFn: async () => {
    const { data } = await sb().from("bank_statement_lines").select("line_date").eq("bank_account_id", bankId).order("line_date", { ascending: false }).limit(1);
    return (data?.[0]?.line_date as string | undefined) ?? today();
  } });
  const [to, setTo] = React.useState<string | null>(null);
  const toDate = to ?? latest.data ?? today();
  const [stmtBal, setStmtBal] = React.useState<string>("");
  const [showIgnored, setShowIgnored] = React.useState(false);
  const [selS, setSelS] = React.useState<string[]>([]);
  const [selB, setSelB] = React.useState<string[]>([]);
  const [suggest, setSuggest] = React.useState(false);
  const [create, setCreate] = React.useState<SLine | null>(null);
  const [ignore, setIgnore] = React.useState<SLine | null>(null);
  const [bookOnly, setBookOnly] = React.useState(false);
  const [finalize, setFinalize] = React.useState(false);
  const lines = useQuery({ queryKey: ["bank-rec-lines", bankId, toDate, showIgnored], queryFn: async () => {
    let s = sb().from("bank_statement_lines_v").select("id, line_date, description, reference, cheque_no, amount, balance, status, ignore_reason, import_no, match_group, reconciliation_id, is_authorised_duplicate")
      .eq("bank_account_id", bankId).lte("line_date", toDate).order("line_date").order("line_no");
    s = showIgnored ? s.in("status", ["UNMATCHED", "IGNORED"]) : s.eq("status", "UNMATCHED");
    const [a, c] = await Promise.all([s.limit(1000),
      sb().from("bank_ledger_lines_v").select("id, entry_id, entry_no, entry_date, entry_type, memo, reference, party_name, description, amount, match_group, reversal_of, reversed_by_entry")
        .eq("bank_account_id", bankId).is("match_group", null).order("entry_date").limit(1000)]);
    if (a.error) throw a.error; if (c.error) throw c.error;
    return { st: (a.data ?? []) as SLine[], bk: (c.data ?? []) as BLine[] };
  } });
  const sum = useQuery({ queryKey: ["bank-rec-summary", bankId, toDate, stmtBal], queryFn: async () =>
    ((await rpc<Summary[]>("bank_rec_summary", { p_bank_account_id: bankId, p_to: toDate, p_statement_balance: stmtBal.trim() ? num(stmtBal) : null })) ?? [])[0] ?? null });
  React.useEffect(() => { setSelS([]); setSelB([]); }, [bankId, toDate]);
  const refresh = () => qc.invalidateQueries();
  const match = useAction((v: { kind: string; note?: string }) => rpc("bank_match", { p_bank_account_id: bankId, p_statement_line_ids: selS, p_journal_line_ids: selB, p_kind: v.kind, p_note: v.note ?? null, p_score: null }),
    "Matched", () => { setSelS([]); setSelB([]); setBookOnly(false); });
  const pairs = useAction(() => rpc<number>("bank_match_reversal_pairs", { p_bank_account_id: bankId }), "Reversed vouchers paired off");
  const unignore = useAction((id: string) => rpc("bank_line_ignore", { p_line_id: id, p_ignore: false, p_reason: null }), "Line is back to unmatched");
  const st = lines.data?.st ?? [], bk = lines.data?.bk ?? [];
  const sS = st.filter((l) => selS.includes(l.id)).reduce((a, l) => a + Number(l.amount), 0);
  const sB = bk.filter((l) => selB.includes(l.id)).reduce((a, l) => a + Number(l.amount), 0);
  const diffSel = Math.round((sS - sB) * 100) / 100;
  const s = sum.data;
  const diff = Number(s?.difference ?? 0);
  const toggle = (arr: string[], set: (v: string[]) => void, id: string) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const hasReversals = bk.some((l) => l.reversal_of || l.reversed_by_entry);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Statement up to"><Input type="date" className="w-40" value={toDate} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Statement closing balance" hint={s?.last_statement_balance != null ? `Last balance on the statement: ${money(s.last_statement_balance)}` : "Type it from the statement"}>
            <Input className="w-44 text-right tabular-nums" inputMode="decimal" placeholder={s?.last_statement_balance != null ? String(s.last_statement_balance) : ""} value={stmtBal} onChange={(e) => setStmtBal(e.target.value)} /></Field>
          <div className="text-sm text-ink-muted">Reconciled until <b className="text-ink">{s?.reconciled_until ? formatDate(s.reconciled_until) : "never"}</b></div>
          <div className="ml-auto flex flex-wrap gap-2">
            {manage && <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setSuggest(true)}>Suggest matches</Button>}
            {manage && hasReversals && <Button icon={<GitMerge className="h-4 w-4" />} loading={pairs.isPending} onClick={() => pairs.mutate(undefined)} title="A voucher and its reversal cancel out — match them together">Pair reversed vouchers</Button>}
            {manage && <Button variant="primary" icon={<CheckCheck className="h-4 w-4" />} disabled={!s || s.statement_balance == null} onClick={() => setFinalize(true)}>Finalize</Button>}
          </div>
        </div>
        {s && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-6">
            <Stat k="Balance in our books" v={money(s.ledger_balance)} />
            <Stat k={`− In books, not on statement (${s.book_items})`} v={money(s.book_not_on_statement)} />
            <Stat k={`+ On statement, not in books (${s.statement_items})`} v={money(s.statement_not_in_books)} />
            <Stat k="= Adjusted book balance" v={money(s.adjusted_balance)} />
            <Stat k="Statement balance" v={s.statement_balance == null ? "—" : money(s.statement_balance)} />
            <Stat k="Difference" v={s.statement_balance == null ? "—" : money(diff)} tone={s.statement_balance == null ? undefined : Math.abs(diff) < 0.005 ? "ok" : "bad"} />
          </div>
        )}
      </Card>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm font-semibold">Bank statement — not matched <Badge>{st.filter((l) => l.status === "UNMATCHED").length}</Badge>
            <label className="ml-auto flex items-center gap-1.5 text-xs font-normal text-ink-muted"><input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> show ignored</label></div>
          <div className="min-h-0 flex-1 overflow-auto">
            {lines.isLoading ? <Skeleton className="m-3 h-32" /> : st.length === 0 ? <p className="p-4 text-sm text-ink-muted">Nothing left on the statement up to {formatDate(toDate)}. Import a statement if you haven't.</p> : (
              <table className="w-full text-sm"><tbody>{st.map((l) => (
                <tr key={l.id} className={cn("cursor-pointer hover:bg-subtle/50", selS.includes(l.id) && "bg-sky-50", l.status === "IGNORED" && "opacity-50")} onClick={() => l.status === "UNMATCHED" && manage && toggle(selS, setSelS, l.id)}>
                  <td className={cn(td, "w-8")}>{l.status === "UNMATCHED" && <input type="checkbox" readOnly checked={selS.includes(l.id)} />}</td>
                  <td className={cn(td, "w-20 text-xs")}>{formatDate(l.line_date)}</td>
                  <td className={cn(td, "text-xs")}>{l.description}{l.cheque_no ? <span className="text-ink-muted"> · chq {l.cheque_no}</span> : null}{l.reference ? <span className="text-ink-muted"> · {l.reference}</span> : null}
                    {l.status === "IGNORED" && <div className="text-2xs text-warning">ignored: {l.ignore_reason}</div>}</td>
                  <td className={cn(td, "w-28 text-right")}>{amt(Number(l.amount))}</td>
                  <td className={cn(td, "w-20 whitespace-nowrap text-right")} onClick={(e) => e.stopPropagation()}>
                    {manage && l.status === "UNMATCHED" && <>
                      <Button size="icon-sm" variant="ghost" title="Create the missing entry" onClick={() => setCreate(l)}><Plus className="h-3.5 w-3.5" /></Button>
                      <Button size="icon-sm" variant="ghost" title="Ignore (e.g. duplicate shown by the bank)" onClick={() => setIgnore(l)}><Trash2 className="h-3.5 w-3.5" /></Button></>}
                    {manage && l.status === "IGNORED" && <Button size="icon-sm" variant="ghost" title="Stop ignoring" onClick={() => unignore.mutate(l.id)}><Undo2 className="h-3.5 w-3.5" /></Button>}
                  </td>
                </tr>))}</tbody></table>
            )}
          </div>
        </Card>
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm font-semibold">Our books — not matched <Badge>{bk.length}</Badge>
            <span className="ml-auto text-xs font-normal text-ink-muted">all dates (cheques may clear later)</span></div>
          <div className="min-h-0 flex-1 overflow-auto">
            {lines.isLoading ? <Skeleton className="m-3 h-32" /> : bk.length === 0 ? <p className="p-4 text-sm text-ink-muted">Every book entry on this account is matched.</p> : (
              <table className="w-full text-sm"><tbody>{bk.map((l) => (
                <tr key={l.id} className={cn("cursor-pointer hover:bg-subtle/50", selB.includes(l.id) && "bg-sky-50", l.entry_date > toDate && "text-ink-muted")} onClick={() => manage && toggle(selB, setSelB, l.id)}>
                  <td className={cn(td, "w-8")}><input type="checkbox" readOnly checked={selB.includes(l.id)} /></td>
                  <td className={cn(td, "w-20 text-xs")}>{formatDate(l.entry_date)}</td>
                  <td className={cn(td, "text-xs")}><button className="font-mono text-primary hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/vouchers?view=${l.entry_id}`); }}>{l.entry_no}</button> {l.party_name ?? l.memo}
                    {l.reference ? <span className="text-ink-muted"> · {l.reference}</span> : null}{l.reversal_of || l.reversed_by_entry ? <Badge tone="neutral" className="ml-1">reversal</Badge> : null}</td>
                  <td className={cn(td, "w-28 text-right")}>{amt(Number(l.amount))}</td>
                </tr>))}</tbody></table>
            )}
          </div>
        </Card>
      </div>
      {manage && (selS.length > 0 || selB.length > 0) && (
        <Card className="flex flex-wrap items-center gap-3 border-primary px-3 py-2 text-sm">
          <span>Statement <b className="tabular-nums">{money(sS)}</b> ({selS.length})</span>
          <span>Books <b className="tabular-nums">{money(sB)}</b> ({selB.length})</span>
          <span className={cn("font-semibold", diffSel === 0 ? "text-success" : "text-danger")}>{diffSel === 0 ? "Agrees" : `Difference ${money(diffSel)}`}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setSelS([]); setSelB([]); }}>Clear</Button>
            {selS.length === 0 && selB.length > 0 && <Button onClick={() => setBookOnly(true)} title="Entries the bank will never show (opening balance, before the statement period…)">Book-only…</Button>}
            <Button variant="primary" icon={<Link2 className="h-3.5 w-3.5" />} disabled={!selS.length || !selB.length || diffSel !== 0} loading={match.isPending} onClick={() => match.mutate({ kind: "MANUAL" })}>
              Match {selS.length}:{selB.length}</Button>
          </div>
        </Card>
      )}
      {suggest && <SuggestDialog bankId={bankId} to={toDate} onClose={() => { setSuggest(false); refresh(); }} />}
      {create && <CreateEntryDialog line={create} bankId={bankId} onClose={() => setCreate(null)} />}
      {ignore && <IgnoreDialog line={ignore} onClose={() => setIgnore(null)} />}
      {bookOnly && <BookOnlyDialog total={sB} onClose={() => setBookOnly(false)} onConfirm={(note) => match.mutate({ kind: "BOOK_ONLY", note })} loading={match.isPending} />}
      {finalize && s && <FinalizeDialog bankId={bankId} to={toDate} summary={s} onClose={() => setFinalize(false)} canException={can("bank.reconcile_exception")} />}
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "ok" | "bad" }) {
  return <div className={cn("rounded-card border border-line px-3 py-2", tone === "ok" && "border-emerald-200 bg-emerald-50/60", tone === "bad" && "border-red-200 bg-red-50/60")}>
    <div className="text-2xs uppercase tracking-wide text-ink-muted">{k}</div><div className="text-base font-semibold tabular-nums">{v}</div></div>;
}

interface Sug { statement_line_id: string; journal_line_id: string; score: number; reasons: string; line_date: string; entry_date: string; amount: number; description: string | null; entry_no: string; party_name: string | null }
function SuggestDialog({ bankId, to, onClose }: { bankId: string; to: string; onClose: () => void }) {
  const [days, setDays] = React.useState("7");
  const q = useQuery({ queryKey: ["bank-suggest", bankId, to, days], queryFn: async () => (await rpc<Sug[]>("bank_match_suggestions", { p_bank_account_id: bankId, p_from: null, p_to: to, p_days: Number(days) || 7 })) ?? [] });
  const [off, setOff] = React.useState<string[]>([]);
  const rows = q.data ?? [];
  const chosen = rows.filter((r) => !off.includes(r.statement_line_id));
  const go = useAction(() => rpc("bank_accept_suggestions", { p_bank_account_id: bankId, p_pairs: chosen.map((r) => ({ statement_line_id: r.statement_line_id, journal_line_id: r.journal_line_id, score: r.score })) }),
    `Matched ${chosen.length}`, onClose);
  return (
    <ErpDialog open onRequestClose={onClose} size="xl" icon={<Sparkles className="h-4 w-4" />} title="Suggested matches" subtitle="Same amount, close dates; cheque no. / reference / party name raise the score. Untick any you don't agree with."
      footer={<><label className="flex items-center gap-2 text-sm text-ink-muted">Date window ± <Input className="h-control-sm w-16 text-right" value={days} onChange={(e) => setDays(e.target.value)} /> days</label><div className="flex-1" />
        <Button onClick={onClose}>Close</Button><Button variant="primary" disabled={!chosen.length} loading={go.isPending} onClick={() => go.mutate(undefined)}>Accept {chosen.length}</Button></>}>
      {q.isLoading ? <Skeleton className="h-32" /> : rows.length === 0 ? <p className="text-sm text-ink-muted">No suggestions — match by hand or create the missing entries.</p> : (
        <table className="w-full text-sm">
          <thead><tr><th className={th} /><th className={th}>Statement</th><th className={th}>Book entry</th><th className={cn(th, "text-right")}>Amount</th><th className={th}>Why</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.statement_line_id}>
              <td className={td}><input type="checkbox" checked={!off.includes(r.statement_line_id)} onChange={() => setOff((s) => (s.includes(r.statement_line_id) ? s.filter((x) => x !== r.statement_line_id) : [...s, r.statement_line_id]))} /></td>
              <td className={cn(td, "text-xs")}>{formatDate(r.line_date)} · {r.description}</td>
              <td className={cn(td, "text-xs")}>{formatDate(r.entry_date)} · <span className="font-mono">{r.entry_no}</span> {r.party_name}</td>
              <td className={cn(td, "text-right")}>{amt(Number(r.amount))}</td>
              <td className={cn(td, "text-xs")}><Badge tone={r.score >= 80 ? "success" : r.score >= 60 ? "info" : "warning"}>{r.score}</Badge> {r.reasons}</td>
            </tr>))}</tbody>
        </table>
      )}
    </ErpDialog>
  );
}

function IgnoreDialog({ line, onClose }: { line: SLine; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const go = useAction(() => rpc("bank_line_ignore", { p_line_id: line.id, p_ignore: true, p_reason: reason }), "Line ignored", onClose);
  return (
    <ConfirmDialog open title="Ignore this statement line?" confirmLabel="Ignore" loading={go.isPending} onCancel={onClose} onConfirm={() => go.mutate(undefined)}
      message={`${formatDate(line.line_date)} · ${line.description ?? ""} · ${money(line.amount)}. Use for lines the bank shows twice or that never touch our money. It is kept and can be un-ignored.`}>
      <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </ConfirmDialog>
  );
}

function BookOnlyDialog({ total, onClose, onConfirm, loading }: { total: number; onClose: () => void; onConfirm: (note: string) => void; loading: boolean }) {
  const [note, setNote] = React.useState(Math.abs(total) < 0.005 ? "They cancel out" : "");
  return (
    <ConfirmDialog open title="Clear without a statement line?" confirmLabel="Mark as cleared" loading={loading} onCancel={onClose} onConfirm={() => onConfirm(note)}
      message={`For book entries the bank will never show — e.g. the opening balance or entries before the first imported statement. Total ${money(total)}.`}>
      <Field label="Why" required={Math.abs(total) >= 0.005} className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. opening balance / before statement period" /></Field>
    </ConfirmDialog>
  );
}

type CType = "ACCOUNT" | "CUSTOMER" | "SUPPLIER" | "BANK";
interface CLine { key: string; type: CType; id: string | null; amount: string; description: string }
function CreateEntryDialog({ line, bankId, onClose }: { line: SLine; bankId: string; onClose: () => void }) {
  const sys = useSystemAccounts();
  const banks = useBanks();
  const bankCur = banks.data?.find((b) => b.id === bankId)?.currency ?? "PKR";
  const inflow = Number(line.amount) > 0;
  const [rate, setRate] = React.useState("");
  const pkr = bankCur === "PKR" ? Math.abs(Number(line.amount)) : Math.round(Math.abs(Number(line.amount)) * (num(rate) || 0) * 100) / 100;
  const [memo, setMemo] = React.useState(line.description ?? "");
  const [rows, setRows] = React.useState<CLine[]>([{ key: crypto.randomUUID(), type: inflow ? "CUSTOMER" : "ACCOUNT", id: null, amount: String(Math.abs(Number(line.amount))), description: "" }]);
  React.useEffect(() => { if (rows.length === 1) setRows((r) => [{ ...r[0], amount: String(pkr) }]); }, [pkr]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, r) => s + (num(r.amount) || 0), 0);
  const setRow = (k: string, p: Partial<CLine>) => setRows((s) => s.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const types = rows.map((r) => r.type);
  const kind = types.every((t) => t === "BANK") ? "TRANSFER" : inflow && types.includes("CUSTOMER") ? "RECEIPT" : !inflow && types.includes("SUPPLIER") ? "PAYMENT"
    : types.every((t) => t === "ACCOUNT") ? (inflow ? "RECEIPT" : "EXPENSE") : "JOURNAL";
  const counter = rows.filter((r) => num(r.amount) > 0).map((r) => {
    const k = sys.data?.byKey;
    if (r.type === "CUSTOMER") return { account_id: k?.AR_CONTROL?.id, party_type: "CUSTOMER", party_id: r.id, amount: num(r.amount), description: r.description };
    if (r.type === "SUPPLIER") return { account_id: k?.AP_CONTROL?.id, party_type: "SUPPLIER", party_id: r.id, amount: num(r.amount), description: r.description };
    if (r.type === "BANK") return { account_id: banks.data?.find((b) => b.id === r.id)?.gl_account_id, bank_account_id: r.id, amount: num(r.amount), description: r.description };
    return { account_id: r.id, amount: num(r.amount), description: r.description };
  });
  const go = useAction(() => rpc("bank_line_create_entry", { p_line_id: line.id, p_kind: kind, p_counter: counter, p_extra: { memo, fx_rate: bankCur === "PKR" ? null : num(rate) } }), "Entry posted and matched", onClose);
  const ok = rows.every((r) => r.id) && Math.abs(total - pkr) < 0.005 && pkr > 0;
  const KIND_LABEL: Record<string, string> = { RECEIPT: "Receipt", PAYMENT: "Payment", EXPENSE: "Expense payment", TRANSFER: "Bank transfer", JOURNAL: "Journal" };
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<Plus className="h-4 w-4" />} title="Create the missing entry" subtitle={`${formatDate(line.line_date)} · ${line.description ?? ""}`}
      footer={<><span className="text-sm">Creates a <b>{KIND_LABEL[kind]}</b> dated {formatDate(line.line_date)}{Math.abs(total - pkr) >= 0.005 && <span className="ml-2 text-danger">lines {money(total)} ≠ {money(pkr)}</span>}</span>
        <div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} loading={go.isPending} onClick={() => go.mutate(undefined)}>Post & match</Button></>}>
      <div className="mb-3 flex items-center gap-3 rounded-card bg-subtle px-3 py-2 text-sm">{inflow ? "Money in" : "Money out"} {amt(Number(line.amount))}{bankCur !== "PKR" && <span className="text-ink-muted">{bankCur}</span>}
        {bankCur !== "PKR" && <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">Rate (PKR per 1 {bankCur}) <Input className="h-control-sm w-24 text-right" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}</div>
      <Field label="Narration" className="mb-3"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{inflow ? "Received from / for" : "Paid to / for"} <span className="font-normal normal-case">— split over several lines if needed (PKR)</span></div>
      <div className="space-y-2">{rows.map((r) => (
        <div key={r.key} className="grid items-start gap-2 sm:grid-cols-[140px_1fr_120px_32px]">
          <select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={r.type} onChange={(e) => setRow(r.key, { type: e.target.value as CType, id: null })}>
            <option value="CUSTOMER">Customer</option><option value="SUPPLIER">Supplier</option><option value="ACCOUNT">Account (income / expense…)</option><option value="BANK">Another bank / cash</option>
          </select>
          {r.type === "CUSTOMER" || r.type === "SUPPLIER" ? <PartyPicker type={r.type} value={r.id} onChange={(v) => setRow(r.key, { id: v })} />
            : r.type === "BANK" ? <BankPicker value={r.id} onChange={(v) => setRow(r.key, { id: v })} />
            : <AccountPicker value={r.id} onChange={(v) => setRow(r.key, { id: v })} />}
          <Input className="text-right tabular-nums" inputMode="decimal" value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} />
          {rows.length > 1 ? <Button size="icon-sm" variant="ghost" onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))}><X className="h-3.5 w-3.5" /></Button> : <span />}
        </div>))}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((s) => [...s, { key: crypto.randomUUID(), type: "ACCOUNT", id: null, amount: String(Math.max(0, pkr - total)), description: "" }])}>Split — add line</Button>
      <p className="mt-2 text-xs text-ink-muted">Posted through the normal accounting engine and matched to this line. Receipts can then be applied to invoices from the voucher.</p>
    </ErpDialog>
  );
}

function FinalizeDialog({ bankId, to, summary, onClose, canException }: { bankId: string; to: string; summary: Summary; onClose: () => void; canException: boolean }) {
  const [note, setNote] = React.useState("");
  const diff = Number(summary.difference ?? 0);
  const off = Math.abs(diff) >= 0.005;
  const go = useAction(() => rpc("finalize_bank_reconciliation", { p_bank_account_id: bankId, p_to: to, p_statement_balance: summary.statement_balance, p_exception_note: off ? note : null }), `Reconciled up to ${formatDate(to)}`, onClose);
  return (
    <ConfirmDialog open title={`Finalize up to ${formatDate(to)}?`} tone={off ? "destructive" : undefined} confirmLabel="Finalize" loading={go.isPending} onCancel={onClose} onConfirm={() => go.mutate(undefined)}
      message={off ? `There is still a difference of ${money(diff)}. ${canException ? "You can finalize only with an approved exception note." : "Only an administrator can finalize with a difference — match or create the missing entries first."}`
        : `Statement balance ${money(summary.statement_balance)} agrees with the books. Matches up to this date are locked (undo the reconciliation to change them).`}>
      {off && canException && <Field label="Approved exception — explain the difference" required className="mt-3"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      {summary.book_items > 0 && <p className="mt-2 text-xs text-ink-muted">{summary.book_items} book entr{summary.book_items === 1 ? "y is" : "ies are"} not on the statement yet (e.g. uncleared cheques) — they carry forward.</p>}
    </ConfirmDialog>
  );
}

/* ================================================================== import */
function ImportTab({ bankId, onDone }: { bankId: string; onDone: () => void }) {
  const { can } = useAccess();
  const [file, setFile] = React.useState<File | null>(null);
  const [grid, setGrid] = React.useState<Grid | null>(null);
  const [hdr, setHdr] = React.useState(0);
  const [map, setMap] = React.useState<Partial<Record<SField, number>>>({});
  const [fmt, setFmt] = React.useState<DateFormat>("auto");
  const [closing, setClosing] = React.useState("");
  const [result, setResult] = React.useState<null | { imported: number; skipped: { index: number; date: string; amount: number; description: string | null }[] }>(null);
  const [force, setForce] = React.useState<number[]>([]);
  const imports = useQuery({ queryKey: ["bank-imports", bankId], queryFn: async () =>
    ((await sb().from("bank_statement_imports").select("id, doc_no, file_name, statement_from, statement_to, lines_total, lines_imported, lines_skipped, closing_balance, created_at").eq("bank_account_id", bankId).order("created_at", { ascending: false }).limit(30)).data ?? []) as Record<string, unknown>[] });
  const load = async (f: File) => {
    try {
      const g = await readStatementFile(f);
      const h = findHeaderRow(g);
      setFile(f); setGrid(g); setHdr(h); setMap(guessMapping(g[h] ?? [])); setResult(null); setForce([]);
    } catch (e) { toast.error((e as Error).message); }
  };
  const parsed = React.useMemo(() => (grid ? buildRows(grid, hdr, map, fmt) : { rows: [] as StatementRow[], problems: [] as string[] }), [grid, hdr, map, fmt]);
  React.useEffect(() => { const last = [...parsed.rows].reverse().find((r) => r.balance != null); if (last && !closing) setClosing(String(last.balance)); }, [parsed.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const payload = (rows: StatementRow[], forced = false) => rows.map((r) => ({ date: r.date, value_date: r.value_date, description: r.description, reference: r.reference, cheque_no: r.cheque_no, amount: r.amount, balance: r.balance, raw: r.raw, force: forced }));
  const go = useAction(() => rpc<{ imported: number; skipped: { index: number; date: string; amount: number; description: string | null }[] }>("import_bank_statement", { p_bank_account_id: bankId,
    p_meta: { file_name: file?.name, closing_balance: closing ? num(closing) : null, statement_from: parsed.rows[0]?.date ?? null, statement_to: parsed.rows.at(-1)?.date ?? null }, p_lines: payload(parsed.rows) }),
    "Statement imported");
  const again = useAction(() => rpc("import_bank_statement", { p_bank_account_id: bankId, p_meta: { file_name: (file?.name ?? "") + " (authorised duplicates)" }, p_lines: payload(force.map((i) => parsed.rows[i]), true) }),
    "Authorised duplicates imported", () => { setForce([]); setResult((r) => (r ? { ...r, skipped: r.skipped.filter((s) => !force.includes(s.index)) } : r)); });
  const header = grid?.[hdr] ?? [];
  const hasAmount = map.amount !== undefined || map.debit !== undefined || map.credit !== undefined;
  const inSum = parsed.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0), outSum = parsed.rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  if (!can("bank.reconcile")) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Importing statements needs bank reconciliation rights." /></Card>;
  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto lg:grid-cols-[1fr_320px]">
      <Card className="p-3">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line p-6 text-sm text-ink-muted hover:border-primary">
          <FileUp className="h-6 w-6" /><span><b className="text-ink">Choose the statement file</b> — CSV or Excel (.xlsx) downloaded from the bank</span>
          {file && <span className="text-ink">{file.name}</span>}
          <input type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
        </label>
        {grid && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field label="Header row"><select className="h-control w-full rounded-control border border-line bg-surface px-2 text-sm" value={hdr} onChange={(e) => { const h = Number(e.target.value); setHdr(h); setMap(guessMapping(grid[h] ?? [])); }}>
                {grid.slice(0, 30).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.slice(0, 4).map((c) => String(c ?? "")).join(" | ").slice(0, 60)}</option>)}</select></Field>
              <Field label="Dates are written as"><select className="h-control w-full rounded-control border border-line bg-surface px-2 text-sm" value={fmt} onChange={(e) => setFmt(e.target.value as DateFormat)}>
                <option value="auto">Automatic (day first)</option><option value="DMY">Day/Month/Year</option><option value="MDY">Month/Day/Year</option><option value="YMD">Year-Month-Day</option></select></Field>
              <Field label="Closing balance on the statement"><Input className="text-right tabular-nums" inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} /></Field>
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Which column is which</div>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {(Object.keys(FIELD_LABEL) as SField[]).map((f) => (
                <Field key={f} label={FIELD_LABEL[f]}>
                  <select className="h-control w-full rounded-control border border-line bg-surface px-2 text-sm" value={map[f] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                    <option value="">—</option>{header.map((h, i) => <option key={i} value={i}>{String(h ?? `Column ${i + 1}`) || `Column ${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            {map.amount !== undefined && (map.debit !== undefined || map.credit !== undefined) && <p className="mt-1 text-xs text-warning">Both a signed amount and debit/credit columns are chosen — the signed amount is used.</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span><b>{parsed.rows.length}</b> lines</span><span>In {amt(inSum)}</span><span>Out {amt(outSum)}</span>
              {parsed.rows.length > 0 && <span className="text-ink-muted">{formatDate(parsed.rows[0].date)} → {formatDate(parsed.rows.at(-1)!.date)}</span>}
              {parsed.problems.length > 0 && <span className="text-warning">{parsed.problems.length} row(s) skipped: {parsed.problems.slice(0, 2).join("; ")}</span>}
              <Button variant="primary" className="ml-auto" disabled={!parsed.rows.length || map.date === undefined || !hasAmount} loading={go.isPending}
                onClick={() => go.mutate(undefined, { onSuccess: (r) => setResult(r as never) })}>Import {parsed.rows.length} lines</Button>
            </div>
            <div className="mt-2 max-h-72 overflow-auto rounded-card border border-line">
              <table className="w-full text-xs"><thead className="bg-subtle"><tr><th className={th}>Date</th><th className={th}>Description</th><th className={th}>Ref / cheque</th><th className={cn(th, "text-right")}>Amount</th><th className={cn(th, "text-right")}>Balance</th></tr></thead>
                <tbody>{parsed.rows.slice(0, 200).map((r, i) => (
                  <tr key={i}><td className={td}>{formatDate(r.date)}</td><td className={td}>{r.description}</td><td className={td}>{[r.reference, r.cheque_no].filter(Boolean).join(" · ")}</td>
                    <td className={cn(td, "text-right")}>{amt(r.amount)}</td><td className={cn(td, "text-right tabular-nums")}>{r.balance == null ? "" : money(r.balance)}</td></tr>))}</tbody></table>
            </div>
          </>
        )}
        {result && (
          <div className="mt-3 rounded-card border border-line p-3 text-sm">
            <p><b>{result.imported}</b> new line(s) imported. {result.skipped.length > 0 ? <><b>{result.skipped.length}</b> were already imported before and were skipped.</> : null}</p>
            {result.skipped.length > 0 && (
              <>
                <p className="mt-1 text-xs text-ink-muted">If a skipped line really is a separate transaction (same date, amount and text twice across statements), tick it and import it on purpose.</p>
                <div className="mt-2 max-h-48 overflow-auto">{result.skipped.map((s) => (
                  <label key={s.index} className="flex items-center gap-2 py-0.5 text-xs"><input type="checkbox" checked={force.includes(s.index)} onChange={() => setForce((f) => (f.includes(s.index) ? f.filter((x) => x !== s.index) : [...f, s.index]))} />
                    {formatDate(s.date)} · {s.description} · {money(s.amount)}</label>))}</div>
                {force.length > 0 && <Button size="sm" className="mt-2" loading={again.isPending} onClick={() => again.mutate(undefined)}>Import {force.length} as authorised duplicate(s)</Button>}
              </>
            )}
            <Button size="sm" variant="primary" className="mt-2" onClick={onDone}>Go to reconcile</Button>
          </div>
        )}
      </Card>
      <Card className="p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Imported statements</div>
        {(imports.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">None yet.</p> : (imports.data ?? []).map((i) => (
          <div key={String(i.id)} className="border-t border-line/70 py-2 text-xs first:border-t-0">
            <div className="flex justify-between"><span className="font-mono font-medium">{String(i.doc_no)}</span><span className="text-ink-muted">{formatDateTime(i.created_at as string)}</span></div>
            <div className="truncate">{String(i.file_name ?? "")}</div>
            <div className="text-ink-muted">{i.statement_from ? `${formatDate(i.statement_from as string)} → ${formatDate(i.statement_to as string)} · ` : ""}{String(i.lines_imported)} imported{Number(i.lines_skipped) ? `, ${i.lines_skipped} duplicates skipped` : ""}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ================================================================== matched + history */
function MatchedTab({ bankId }: { bankId: string }) {
  const { can } = useAccess();
  const [removed, setRemoved] = React.useState(false);
  const q = useQuery({ queryKey: ["bank-groups", bankId, removed], queryFn: async () =>
    ((await sb().from("bank_match_groups_v").select("*").eq("bank_account_id", bankId).eq("status", removed ? "REMOVED" : "ACTIVE").order(removed ? "removed_at" : "statement_date", { ascending: false }).limit(300)).data ?? []) as Record<string, unknown>[] });
  const [ask, setAsk] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const un = useAction(() => rpc("bank_unmatch", { p_group_id: ask, p_reason: reason }), "Unmatched", () => { setAsk(null); setReason(""); });
  const KIND: Record<string, string> = { SUGGESTED: "suggested", MANUAL: "manual", CREATED: "created", BOOK_ONLY: "book only" };
  return (
    <Card className="min-h-0 flex-1 overflow-auto p-3">
      <label className="mb-2 flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={removed} onChange={(e) => setRemoved(e.target.checked)} /> Show removed matches (history)</label>
      {q.isLoading ? <Skeleton className="h-32" /> : (q.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">Nothing here.</p> : (
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Statement</th><th className={th}>Books</th><th className={cn(th, "text-right")}>Amount</th><th className={th}>How</th><th className={th} /></tr></thead>
          <tbody>{(q.data ?? []).map((g) => (
            <tr key={String(g.group_id)}>
              <td className={cn(td, "text-xs")}>{g.statement_date ? `${formatDate(g.statement_date as string)} · ${g.statement_text ?? ""}` : <span className="text-ink-muted">—</span>}{Number(g.statement_lines) > 1 && <Badge className="ml-1">{String(g.statement_lines)} lines</Badge>}</td>
              <td className={cn(td, "text-xs")}>{formatDate(g.book_date as string)} · <span className="font-mono">{String(g.entries ?? "")}</span></td>
              <td className={cn(td, "text-right")}>{amt(Number(g.book_amount))}</td>
              <td className={cn(td, "text-xs")}><Badge tone={g.kind === "BOOK_ONLY" ? "warning" : "neutral"}>{KIND[String(g.kind)]}</Badge> {g.reconciliation_id ? <Badge tone="success">reconciled</Badge> : null}
                {g.note ? <div className="text-2xs text-ink-muted">{String(g.note)}</div> : null}
                {removed && <div className="text-2xs text-danger">removed {formatDateTime(g.removed_at as string)}{g.removed_reason ? ` — ${g.removed_reason}` : ""}</div>}</td>
              <td className={cn(td, "text-right")}>{!removed && can("bank.reconcile") && !g.reconciliation_id && <Button size="sm" variant="ghost" icon={<Unlink className="h-3.5 w-3.5" />} onClick={() => setAsk(String(g.group_id))}>Unmatch</Button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      <ConfirmDialog open={!!ask} title="Unmatch?" confirmLabel="Unmatch" tone="destructive" loading={un.isPending} onCancel={() => setAsk(null)} onConfirm={() => un.mutate(undefined)} message="Both sides go back to unmatched. The old match is kept in history.">
        <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </Card>
  );
}

function HistoryTab({ bankId }: { bankId: string }) {
  const { can } = useAccess();
  const q = useQuery({ queryKey: ["bank-recs", bankId], queryFn: async () =>
    ((await sb().from("bank_reconciliations").select("*").eq("bank_account_id", bankId).order("finalized_at", { ascending: false })).data ?? []) as Record<string, unknown>[] });
  const [ask, setAsk] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const undo = useAction(() => rpc("undo_bank_reconciliation", { p_id: ask, p_reason: reason }), "Reconciliation undone", () => { setAsk(null); setReason(""); });
  const latest = (q.data ?? []).find((r) => r.status === "FINALIZED");
  return (
    <Card className="min-h-0 flex-1 overflow-auto p-3">
      {(q.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">This account has not been reconciled yet.</p> : (
        <table className="w-full text-sm">
          <thead><tr><th className={th}>No.</th><th className={th}>Up to</th><th className={cn(th, "text-right")}>Statement</th><th className={cn(th, "text-right")}>Books</th><th className={cn(th, "text-right")}>Not on stmt</th>
            <th className={cn(th, "text-right")}>Difference</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody>{(q.data ?? []).map((r) => (
            <tr key={String(r.id)}>
              <td className={cn(td, "font-mono text-xs")}>{String(r.doc_no)}</td>
              <td className={td}>{formatDate(r.period_to as string)}<div className="text-2xs text-ink-muted">{formatDateTime(r.finalized_at as string)}</div></td>
              <td className={cn(td, "text-right tabular-nums")}>{money(r.statement_balance as number)}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(r.ledger_balance as number)}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(r.book_not_on_statement as number)}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(r.difference as number)}{r.exception_note ? <div className="text-2xs text-warning">{String(r.exception_note)}</div> : null}</td>
              <td className={td}><Badge tone={r.status === "FINALIZED" ? "success" : "neutral"}>{String(r.status).toLowerCase()}</Badge>{r.undo_reason ? <div className="text-2xs text-ink-muted">{String(r.undo_reason)}</div> : null}</td>
              <td className={cn(td, "text-right")}>{latest?.id === r.id && can("bank.reconcile") && <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setAsk(String(r.id))}>Undo</Button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      <ConfirmDialog open={!!ask} title="Undo this reconciliation?" tone="destructive" confirmLabel="Undo" loading={undo.isPending} onCancel={() => setAsk(null)} onConfirm={() => undo.mutate(undefined)}
        message="Its matches are unlocked and the account's reconciled-until date goes back. The record stays in history.">
        <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </Card>
  );
}

