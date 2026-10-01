import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarCheck, Lock, LockOpen, Scale, ShieldAlert, Wallet } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, SearchableSelect, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { useUrlState } from "../inventory/DocPage";
import { Amount, BalanceText, DateRangeBar, ENTRY_LABEL, money, presetRange, today, useBanks, type DateRange, type EntryType, type PartyType } from "./common";
import { VoucherDialog } from "./VoucherDialog";

function NoAccess() {
  return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="You don't have permission to view accounting reports." /></Card>;
}
const th = "px-3 text-2xs font-semibold uppercase tracking-wide text-ink-muted";

/* ================================================================== RECEIVABLES / PAYABLES */
interface BalRow { party_id: string; code: string; name: string; city: string | null; balance: number; last_date: string | null; linked_party_id: string | null; linked_balance: number | null }

export function BalancesPage({ partyType }: { partyType: PartyType }) {
  const { can, companyId } = useAccess();
  const [asOf, setAsOf] = React.useState<string>("");
  const [q, setQ] = React.useState("");
  const [net, setNet] = React.useState(false);
  const rows = useQuery({
    queryKey: ["party-balances", companyId, partyType, asOf],
    enabled: !!companyId && can(P.journalsView),
    queryFn: async () => {
      const { data, error } = await sb().rpc("party_balances", { p_company_id: companyId, p_party_type: partyType, p_as_of: asOf || null });
      if (error) throw error;
      return (data ?? []) as BalRow[];
    },
  });
  if (!can(P.journalsView)) return <NoAccess />;
  const isCust = partyType === "CUSTOMER";
  const list = (rows.data ?? [])
    .map((r) => ({ ...r, shown: Number(r.balance) + (net ? Number(r.linked_balance ?? 0) : 0) }))
    .filter((r) => Math.abs(r.shown) >= 0.005 && (!q || `${r.name} ${r.code} ${r.city ?? ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.shown - a.shown);
  const total = list.reduce((a, r) => a + r.shown, 0);
  const hasLinked = (rows.data ?? []).some((r) => r.linked_party_id);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={isCust ? "Receivables" : "Payables"} icon={<Wallet className="h-4 w-4" />}
        description={isCust ? "What each customer owes, from posted entries. Click a name for their statement." : "What we owe each supplier, from posted entries. Click a name for their statement."} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
          <Input className="h-control-sm w-64" placeholder={`Search ${isCust ? "customer" : "supplier"}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">As of <Input type="date" className="h-control-sm w-36" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
          {hasLinked && (
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={net} onChange={(e) => setNet(e.target.checked)} />
              Net off parties who are also {isCust ? "suppliers" : "customers"}</label>
          )}
          <div className="ml-auto text-sm">Total <b className="tabular-nums">{money(Math.abs(total))}</b> <span className="text-xs text-ink-muted">{total >= 0 ? (isCust ? "receivable" : "payable") : (isCust ? "we owe" : "they owe")}</span></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.isLoading ? <Skeleton className="m-3 h-40" /> : rows.error ? <p className="p-3 text-sm text-danger">{friendlyError(rows.error)}</p> : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-subtle"><tr className="text-left"><th className={cn(th, "h-8")}>Code</th><th className={th}>{isCust ? "Customer" : "Supplier"}</th>
                <th className={cn(th, "hidden md:table-cell")}>City</th><th className={cn(th, "hidden md:table-cell")}>Last activity</th>
                {net && <th className={cn(th, "text-right")}>As {isCust ? "supplier" : "customer"}</th>}<th className={cn(th, "text-right")}>Balance</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.party_id} className="border-b border-line/70 hover:bg-subtle/60">
                    <td className="h-row px-3 font-mono text-xs">{r.code}</td>
                    <td className="px-3"><Link className="font-medium hover:text-info hover:underline" to={`/statements?type=${partyType}&party=${r.party_id}`}>{r.name}</Link>{r.linked_party_id && <Badge tone="neutral" className="ml-1.5">also {isCust ? "supplier" : "customer"}</Badge>}</td>
                    <td className="hidden px-3 text-xs md:table-cell">{r.city}</td>
                    <td className="hidden px-3 text-xs md:table-cell">{r.last_date ? formatDate(r.last_date) : ""}</td>
                    {net && <td className="px-3 text-right text-xs"><Amount v={r.linked_balance} /></td>}
                    <td className="px-3 text-right"><BalanceText v={r.shown} partyType={partyType} /></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-xs text-ink-muted">No outstanding balances.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== CASH & BANK BOOK */
interface BookRow { row_kind: string; entry_id: string | null; entry_no: string | null; entry_date: string | null; entry_type: EntryType | null; memo: string | null; reference: string | null; party_name: string | null; debit: number | null; credit: number | null; balance: number }

export function BankBookPage() {
  const { can } = useAccess();
  const { params, update } = useUrlState();
  const banks = useBanks();
  const bankId = params.get("bank") ?? banks.data?.[0]?.id ?? null;
  const range: DateRange = params.has("from") || params.has("to") ? { from: params.get("from") || null, to: params.get("to") || null } : presetRange("month");
  const [open, setOpen] = React.useState<string | null>(null);
  const balances = useQuery({
    queryKey: ["bank-balances", (banks.data ?? []).map((b) => b.id).join()],
    enabled: !!banks.data?.length,
    queryFn: async () => {
      const ids = banks.data!.map((b) => b.id);
      const { data, error } = await sb().from("journal_lines").select("bank_account_id, debit, credit").in("bank_account_id", ids).limit(100000);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of data ?? []) m.set(r.bank_account_id as string, (m.get(r.bank_account_id as string) ?? 0) + Number(r.debit) - Number(r.credit));
      return m;
    },
  });
  const book = useQuery({
    queryKey: ["bank-book", bankId, range.from, range.to],
    enabled: !!bankId,
    queryFn: async () => {
      const { data, error } = await sb().rpc("bank_book", { p_bank_account_id: bankId, p_from: range.from, p_to: range.to });
      if (error) throw error;
      return (data ?? []) as BookRow[];
    },
  });
  if (!can(P.journalsView)) return <NoAccess />;
  const rows = book.data ?? [];
  const opening = Number(rows.find((r) => r.row_kind === "OPENING")?.balance ?? 0);
  const txns = rows.filter((r) => r.row_kind === "TXN");
  const closing = txns.length ? Number(txns[txns.length - 1].balance) : opening;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Cash & Bank Book" icon={<Wallet className="h-4 w-4" />} description="Money in and out of each bank / cash account with a running balance. Click a row to open the voucher." />
      <div className="mb-3 flex flex-wrap gap-2">
        {(banks.data ?? []).map((b) => (
          <button key={b.id} onClick={() => update({ bank: b.id })}
            className={cn("rounded-card border px-3 py-2 text-left", b.id === bankId ? "border-primary bg-surface shadow-card" : "border-line bg-surface hover:border-line-strong")}>
            <div className="text-xs text-ink-muted">{b.name}</div>
            <div className="text-base font-semibold tabular-nums">{balances.data ? money(balances.data.get(b.id) ?? 0) : "…"} <span className="text-2xs font-normal text-ink-faint">{b.currency}</span></div>
          </button>
        ))}
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <DateRangeBar value={range} onChange={(r) => update({ from: r.from ?? "", to: r.to ?? "" })} />
          <div className="ml-auto flex gap-3 text-sm"><span>Opening <b className="tabular-nums">{money(opening)}</b></span><span>Closing <b className="tabular-nums">{money(closing)}</b></span></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {book.isLoading ? <Skeleton className="m-3 h-40" /> : book.error ? <p className="p-3 text-sm text-danger">{friendlyError(book.error)}</p> : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-subtle"><tr className="text-left"><th className={cn(th, "h-8")}>Date</th><th className={th}>Voucher</th><th className={th}>Type</th><th className={th}>Party / details</th>
                <th className={cn(th, "text-right")}>Money in</th><th className={cn(th, "text-right")}>Money out</th><th className={cn(th, "text-right")}>Balance</th></tr></thead>
              <tbody>
                <tr className="border-b border-line/70 bg-subtle/40"><td className="h-row px-3 text-xs">{range.from ? formatDate(range.from) : ""}</td><td colSpan={5} className="px-3 text-xs font-medium">Opening balance</td><td className="px-3 text-right tabular-nums">{money(opening)}</td></tr>
                {txns.map((r) => (
                  <tr key={r.entry_id!} className="cursor-pointer border-b border-line/70 hover:bg-subtle/60" onClick={() => setOpen(r.entry_id)}>
                    <td className="h-row whitespace-nowrap px-3 text-xs">{formatDate(r.entry_date!)}</td>
                    <td className="px-3 font-mono text-xs text-info">{r.entry_no}</td>
                    <td className="px-3 text-xs">{r.entry_type ? ENTRY_LABEL[r.entry_type] : ""}</td>
                    <td className="max-w-[320px] truncate px-3 text-xs">{r.party_name && <b className="font-medium">{r.party_name}</b>}{r.party_name && (r.memo || r.reference) ? " · " : ""}<span className="text-ink-muted">{[r.reference, r.memo].filter(Boolean).join(" · ")}</span></td>
                    <td className="px-3 text-right text-success"><Amount v={r.debit} /></td>
                    <td className="px-3 text-right text-danger"><Amount v={r.credit} /></td>
                    <td className="px-3 text-right tabular-nums font-medium">{money(r.balance)}</td>
                  </tr>
                ))}
                {txns.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-xs text-ink-muted">No movements in this period.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      {open && <VoucherDialog id={open} onClose={() => setOpen(null)} onSaved={() => undefined} onOpen={setOpen} />}
    </div>
  );
}

/* ================================================================== TRIAL BALANCE */
interface TbRow { account_id: string; code: string; name: string; account_type: string; parent_code: string | null; debit: number; credit: number }
const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const TYPE_LABEL: Record<string, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" };

export function TrialBalancePage() {
  const { can, companyId } = useAccess();
  const [asOf, setAsOf] = React.useState(today());
  const tb = useQuery({
    queryKey: ["trial-balance", companyId, asOf],
    enabled: !!companyId && can(P.journalsView),
    queryFn: async () => {
      const { data, error } = await sb().rpc("trial_balance", { p_company_id: companyId, p_as_of: asOf || null });
      if (error) throw error;
      return (data ?? []) as TbRow[];
    },
  });
  if (!can(P.journalsView)) return <NoAccess />;
  const rows = tb.data ?? [];
  const tDr = rows.reduce((a, r) => a + Number(r.debit), 0), tCr = rows.reduce((a, r) => a + Number(r.credit), 0);
  const ok = Math.abs(tDr - tCr) < 0.005;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Trial Balance" icon={<Scale className="h-4 w-4" />} description="Balance of every account with activity. Total debits always equal total credits."
        actions={<label className="flex items-center gap-1.5 text-xs text-ink-muted">As of <Input type="date" className="h-control-sm w-36" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>} />
      <Card className="min-h-0 flex-1 overflow-auto">
        {tb.isLoading ? <Skeleton className="m-3 h-40" /> : tb.error ? <p className="p-3 text-sm text-danger">{friendlyError(tb.error)}</p> : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-subtle"><tr className="text-left"><th className={cn(th, "h-8 w-24")}>Code</th><th className={th}>Account</th><th className={cn(th, "text-right")}>Debit</th><th className={cn(th, "text-right")}>Credit</th></tr></thead>
            <tbody>
              {TYPE_ORDER.map((t) => {
                const g = rows.filter((r) => r.account_type === t);
                if (!g.length) return null;
                return (
                  <React.Fragment key={t}>
                    <tr className="bg-subtle/50"><td colSpan={4} className="h-7 px-3 text-xs font-semibold">{TYPE_LABEL[t]}</td></tr>
                    {g.map((r) => (
                      <tr key={r.account_id} className="border-b border-line/70">
                        <td className="h-row px-3 font-mono text-xs">{r.code}</td><td className="px-3">{r.name}</td>
                        <td className="px-3 text-right"><Amount v={r.debit} /></td><td className="px-3 text-right"><Amount v={r.credit} /></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-xs text-ink-muted">No posted entries yet.</td></tr>}
              <tr className="border-t-2 border-line-strong font-semibold"><td className="h-row px-3" colSpan={2}>Total {rows.length > 0 && <Badge tone={ok ? "success" : "danger"} className="ml-2">{ok ? "Balanced" : "Out of balance"}</Badge>}</td>
                <td className="px-3 text-right tabular-nums">{money(tDr)}</td><td className="px-3 text-right tabular-nums">{money(tCr)}</td></tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== PERIODS */
interface PeriodRow { id: string; name: string; start_date: string; end_date: string; status: string; closed_at: string | null }

export function PeriodsPage() {
  const { can, companyId } = useAccess();
  const qc = useQueryClient();
  const [year, setYear] = React.useState<string | null>(String(new Date().getFullYear()));
  const [confirm, setConfirm] = React.useState<PeriodRow | null>(null);
  const periods = useQuery({
    queryKey: ["periods", companyId, year],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("accounting_periods").select("id, name, start_date, end_date, status, closed_at")
        .eq("company_id", companyId!).gte("start_date", `${year}-01-01`).lte("start_date", `${year}-12-31`).order("start_date");
      if (error) throw error;
      return (data ?? []) as PeriodRow[];
    },
  });
  const create = useMutation({
    mutationFn: async () => { const { error } = await sb().rpc("create_accounting_periods", { p_company_id: companyId, p_year: Number(year) }); if (error) throw error; },
    onSuccess: () => { toast.success(`Periods for ${year} created`); qc.invalidateQueries({ queryKey: ["periods"] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const toggle = useMutation({
    mutationFn: async (p: PeriodRow) => { const { error } = await sb().rpc("set_period_status", { p_id: p.id, p_status: p.status === "OPEN" ? "CLOSED" : "OPEN" }); if (error) throw error; },
    onSuccess: () => { setConfirm(null); toast.success("Period updated"); qc.invalidateQueries({ queryKey: ["periods"] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  if (!can(P.journalsView) && !can(P.periodsManage)) return <NoAccess />;
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - 3 + i)).map((y) => ({ value: y, label: y }));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Accounting Periods" icon={<CalendarCheck className="h-4 w-4" />}
        description="Close a month once its books are final — nothing can then be posted or reversed on those dates. Dates without a period are open." />
      <Card className="max-w-3xl p-3">
        <div className="mb-3 flex items-center gap-2">
          <div className="w-32"><SearchableSelect value={year} onChange={setYear} options={years} clearable={false} /></div>
          {can(P.periodsManage) && (periods.data?.length ?? 0) < 12 && <Button loading={create.isPending} onClick={() => create.mutate()}>Create monthly periods for {year}</Button>}
        </div>
        {periods.isLoading ? <Skeleton className="h-40" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className={cn(th, "h-8")}>Period</th><th className={th}>Dates</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody>
              {(periods.data ?? []).map((p) => (
                <tr key={p.id} className="border-b border-line/70">
                  <td className="h-row px-3 font-medium">{p.name}</td>
                  <td className="px-3 text-xs">{formatDate(p.start_date)} – {formatDate(p.end_date)}</td>
                  <td className="px-3"><Badge tone={p.status === "OPEN" ? "success" : "neutral"}>{p.status === "OPEN" ? "Open" : "Closed"}</Badge>{p.closed_at && <span className="ml-2 text-2xs text-ink-faint">{formatDateTime(p.closed_at)}</span>}</td>
                  <td className="px-3 text-right">{can(P.periodsManage) && (
                    <Button size="sm" variant="ghost" icon={p.status === "OPEN" ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />} onClick={() => setConfirm(p)}>{p.status === "OPEN" ? "Close" : "Reopen"}</Button>
                  )}</td>
                </tr>
              ))}
              {periods.data?.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-xs text-ink-muted">No periods for {year} yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      <ConfirmDialog open={!!confirm} title={confirm?.status === "OPEN" ? `Close ${confirm?.name}?` : `Reopen ${confirm?.name}?`}
        message={confirm?.status === "OPEN" ? "No entries can be posted or reversed on these dates until the period is reopened. Drafts dated in it must be posted or cancelled first." : "Entries can again be posted on these dates."}
        confirmLabel={confirm?.status === "OPEN" ? "Close period" : "Reopen"} loading={toggle.isPending}
        onCancel={() => setConfirm(null)} onConfirm={() => confirm && toggle.mutate(confirm)} />
    </div>
  );
}
