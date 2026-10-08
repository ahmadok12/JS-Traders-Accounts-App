import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban, Banknote, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Plus, Printer, RefreshCw, RotateCcw, Send, ShieldAlert, Undo2, WalletCards } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList, useProfileNames } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { StatusFilter, useUrlState } from "../inventory/DocPage";
import { BankPicker, money, num, today } from "../accounting/common";
import { printDocument } from "../sales/print";
import { fromMonthInput, monthLabel, monthStart, payTypeLabel, rpc, toMonthInput, useEmployeeNames, useHrAction } from "./common";

type Row = Record<string, unknown> & { id: string };
const TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { DRAFT: "warning", APPROVED: "info", POSTED: "success", REVERSED: "danger", CANCELLED: "neutral" };
const LABEL: Record<string, string> = { DRAFT: "Draft — review", APPROVED: "Approved — post it", POSTED: "Posted", REVERSED: "Reversed", CANCELLED: "Cancelled" };
const FILTERS = [{ label: "Open", statuses: ["DRAFT", "APPROVED"] }, { label: "Posted", statuses: ["POSTED"] }, { label: "All" }] as { label: string; statuses?: string[] }[];
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted whitespace-nowrap";
const td = "border-t border-line/70 px-2 py-2";

export function PayrollPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const f = Number(params.get("f") ?? "0") || 0;
  const viewId = params.get("view");
  const [creating, setCreating] = React.useState(false);
  const list = useEntityList<Row>({
    table: "payroll_runs", select: "id, doc_no, period_month, posting_date, status, employees_count, gross_total, net_total, paid_total, recovery_total",
    companyId, orderBy: { column: "period_month", ascending: false }, page: 1, pageSize: 100, enabled: can(P.payrollView),
  });
  if (!can(P.payrollView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Payroll is restricted." /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) => !FILTERS[f].statuses || FILTERS[f].statuses!.includes(String(r.status)));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Payroll" icon={<WalletCards className="h-4 w-4" />}
        description="One payroll per month: fixed salary + assembly labour + approved bonuses − unpaid leave − deductions − advance recovery. Review, approve, post to the accounts, then pay."
        actions={can(P.payrollManage) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New payroll</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-line px-3 py-2"><StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null })} /></div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id })}
            columns={[
              { key: "m", header: "Month", width: "130px", cell: (r) => <span className="font-semibold">{monthLabel(r.period_month as string)}</span> },
              { key: "d", header: "No.", width: "110px", cell: (r) => <span className="font-mono text-xs">{String(r.doc_no)}</span> },
              { key: "n", header: "Employees", width: "100px", align: "right", cell: (r) => String(r.employees_count) },
              { key: "g", header: "Gross", align: "right", cell: (r) => <span className="tabular-nums">{money(r.gross_total as number)}</span> },
              { key: "net", header: "Net pay", align: "right", cell: (r) => <span className="font-medium tabular-nums">{money(r.net_total as number)}</span> },
              { key: "p", header: "Paid", align: "right", hideBelow: "md", cell: (r) => <span className={cn("tabular-nums", Number(r.paid_total) < Number(r.net_total) && r.status === "POSTED" && "text-warning")}>{money(r.paid_total as number)}</span> },
              { key: "s", header: "Status", width: "170px", cell: (r) => <Badge tone={TONE[String(r.status)]}>{r.status === "POSTED" && Number(r.paid_total) < Number(r.net_total) ? "Posted — salaries due" : LABEL[String(r.status)]}</Badge> },
            ]}
            empty={<EmptyState icon={<WalletCards className="h-6 w-6" />} title="No payroll yet" description="Set salaries in HR & Pay, then start this month's payroll." />} />
        )}
      </Card>
      {creating && <NewRunDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); update({ view: id }); }} />}
      {viewId && <RunDialog id={viewId} onClose={() => update({ view: null })} />}
    </div>
  );
}

function NewRunDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { companyId } = useAccess();
  const [month, setMonth] = React.useState(toMonthInput(monthStart()));
  const [post, setPost] = React.useState("");
  const go = useHrAction(async () => onCreated(await rpc("create_payroll_run", { p_company_id: companyId, p_month: fromMonthInput(month), p_posting_date: post || null }) as string), "Payroll calculated");
  return (
    <ConfirmDialog open title="New payroll" confirmLabel="Calculate" loading={go.isPending} onCancel={onClose} onConfirm={() => go.mutate(undefined)}
      message="Everyone on payroll is included with their salary for the month, approved bonuses / deductions / assembly labour, approved unpaid leave and advance recovery. You can review and recalculate before approving.">
      <FormGrid cols={2} className="mt-3">
        <Field label="Month" required><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Accounting date" hint="default: last day of the month"><Input type="date" value={post} onChange={(e) => setPost(e.target.value)} /></Field>
      </FormGrid>
    </ConfirmDialog>
  );
}

interface Line {
  id: string; employee_id: string; monthly_salary: number; days_in_month: number; days_worked: number; basic_salary: number; unpaid_leave_days: number; leave_deduction: number;
  assembly_labour: number; bonus: number; other_earnings: number; gross: number; other_deductions: number; advance_outstanding: number; advance_recovery: number;
  net_pay: number; paid_amount: number; note: string | null;
  components: { items?: { id: string; type: string; direction: string; amount: number; qty: number | null; rate: number | null; date: string; description: string | null }[];
    leaves?: { type: string; paid: boolean; from: string; to: string; days: number }[]; recovery_manual?: boolean };
}

function useRun(id: string) {
  return useQuery({
    queryKey: ["payroll", "run", id],
    queryFn: async () => {
      const [h, l, p] = await Promise.all([
        sb().from("payroll_runs").select("*").eq("id", id).single(),
        sb().from("payroll_lines").select("*").eq("run_id", id).eq("is_active", true),
        sb().from("payroll_payments").select("id, payment_date, amount, bank_account_id, journal_entry_id, created_at, employee_id, reference, status, reversal_reason, lines, bank:bank_accounts(name)").eq("run_id", id).order("created_at"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      return { h: h.data as Row, lines: (l.data ?? []) as unknown as Line[], payments: p.data ?? [] };
    },
  });
}

function RunDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, company } = useAccess();
  const navigate = useNavigate();
  const run = useRun(id);
  const names = useEmployeeNames();
  const h = run.data?.h;
  const st = String(h?.status ?? "");
  const lines = [...(run.data?.lines ?? [])].sort((a, b) => (names.data?.get(a.employee_id) ?? "").localeCompare(names.data?.get(b.employee_id) ?? ""));
  const people = useProfileNames([h?.approved_by as string, h?.posted_by as string, h?.created_by as string]);
  const [open, setOpen] = React.useState<string | null>(null);
  const [rec, setRec] = React.useState<Record<string, string>>({});
  const [ask, setAsk] = React.useState<null | "approve" | "post" | "reverse" | "cancel" | "pay" | "unapprove">(null);
  const [reason, setReason] = React.useState("");
  const [undoPay, setUndoPay] = React.useState<Row | null>(null);
  const [paySel, setPaySel] = React.useState<string[]>([]);
  React.useEffect(() => { setRec(Object.fromEntries((run.data?.lines ?? []).map((l) => [l.id, String(Number(l.advance_recovery))]))); }, [run.data]);
  const done = () => { setAsk(null); setReason(""); };
  const recalc = useHrAction(() => rpc("recalc_payroll_run", { p_run_id: id }), "Recalculated");
  const setLine = useHrAction((l: Line) => rpc("set_payroll_line", { p_line_id: l.id, p_advance_recovery: num(rec[l.id] ?? "0") }), "Recovery updated");
  const approve = useHrAction((yes: boolean) => rpc("approve_payroll_run", { p_run_id: id, p_approve: yes }), (y) => (y ? "Approved" : "Back to draft"), done);
  const post = useHrAction(() => rpc("post_payroll_run", { p_run_id: id }), "Posted to the accounts — salaries are now owed to employees", done);
  const undo = useHrAction(() => rpc("reverse_salary_payment", { p_payment_id: undoPay!.id, p_reason: reason }), "Payment reversed — the salary is due again", () => { setUndoPay(null); setReason(""); });
  const reverse = useHrAction(() => rpc("reverse_payroll_run", { p_run_id: id, p_reason: reason }), "Payroll reversed", done);
  const cancel = useHrAction(() => rpc("cancel_payroll_run", { p_run_id: id }), "Payroll cancelled", () => { done(); onClose(); });

  const tot = (k: keyof Line) => lines.reduce((s, l) => s + Number(l[k] ?? 0), 0);
  const unpaid = lines.filter((l) => Number(l.net_pay) > Number(l.paid_amount));
  const draft = st === "DRAFT";
  const print = () => {
    if (!h) return;
    printDocument({ docType: "PAYROLL",
      company: company?.company_name ?? "", title: "Payroll Register", docNo: String(h.doc_no),
      meta: [["Month", monthLabel(h.period_month as string)], ["Status", LABEL[st] ?? st], ["Accounting date", formatDate(h.posting_date as string)]],
      columns: [{ label: "Employee" }, { label: "Salary", align: "right" }, { label: "Days", align: "right" }, { label: "Leave ded.", align: "right" }, { label: "Labour", align: "right" },
        { label: "Bonus/other", align: "right" }, { label: "Gross", align: "right" }, { label: "Deductions", align: "right" }, { label: "Advance", align: "right" }, { label: "Net pay", align: "right" }, { label: "Signature" }],
      rows: lines.map((l) => [names.data?.get(l.employee_id) ?? "", money(l.basic_salary), `${l.days_worked}/${l.days_in_month}`, money(l.leave_deduction), money(l.assembly_labour),
        money(Number(l.bonus) + Number(l.other_earnings)), money(l.gross), money(l.other_deductions), money(l.advance_recovery), money(l.net_pay), ""]),
      totals: [["Gross", money(tot("gross"))], ["Deductions", money(tot("other_deductions"))], ["Advance recovered", money(tot("advance_recovery"))], ["Net pay", money(tot("net_pay"))]],
      signatures: ["Prepared by", "Approved by", "Paid by"],
    });
  };

  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="invoice" icon={<WalletCards className="h-4 w-4" />}
        title={h ? `Payroll ${monthLabel(h.period_month as string)}` : "Payroll"} subtitle={h ? String(h.doc_no) : undefined}
        status={h ? <Badge tone={TONE[st]}>{LABEL[st]}</Badge> : null}
        footer={h && <>
          {["DRAFT", "APPROVED"].includes(st) && can(P.payrollManage) && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel payroll</Button>}
          {st === "POSTED" && can(P.payrollApprove) && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk("reverse")}>Reverse</Button>}
          <div className="flex-1" />
          {h.journal_entry_id ? <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/vouchers?view=${h.journal_entry_id}`)}>Accounting entry</Button> : null}
          <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print register</Button>
          <Button onClick={onClose}>Close</Button>
          {draft && can(P.payrollManage) && <Button icon={<RefreshCw className="h-3.5 w-3.5" />} loading={recalc.isPending} onClick={() => recalc.mutate(undefined)}>Recalculate</Button>}
          {draft && can(P.payrollApprove) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setAsk("approve")}>Approve</Button>}
          {st === "APPROVED" && can(P.payrollApprove) && <Button icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setAsk("unapprove")}>Back to draft</Button>}
          {st === "APPROVED" && (can(P.payrollManage) || can(P.payrollApprove)) && <Button variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setAsk("post")}>Post to accounts</Button>}
          {st === "POSTED" && unpaid.length > 0 && can(P.payrollManage) && <Button variant="primary" icon={<Banknote className="h-3.5 w-3.5" />} onClick={() => setAsk("pay")}>Pay salaries{paySel.length ? ` (${paySel.length})` : ""}</Button>}
        </>}>
        {run.isLoading ? <Skeleton className="h-48" /> : run.error ? <p className="text-sm text-danger">{friendlyError(run.error)}</p> : h && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-6">
              {[["Employees", String(lines.length)], ["Gross", money(tot("gross"))], ["Deductions", money(tot("other_deductions"))], ["Advance recovered", money(tot("advance_recovery"))],
                ["Net pay", money(tot("net_pay"))], ["Paid", money(tot("paid_amount"))]].map(([k, v], i) => (
                <div key={k} className={cn("rounded-card border border-line px-3 py-2", i === 4 && "border-emerald-300 bg-emerald-50/60")}><div className="text-2xs uppercase tracking-wide text-ink-muted">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
              ))}
            </div>
            <dl className="mb-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
              <KeyValue label="Accounting date">{formatDate(h.posting_date as string)}</KeyValue>
              <KeyValue label="Calculated">{h.calculated_at ? formatDateTime(h.calculated_at as string) : null}</KeyValue>
              <KeyValue label="Approved">{h.approved_at ? `${people.data?.[h.approved_by as string] ?? ""} · ${formatDateTime(h.approved_at as string)}` : null}</KeyValue>
              <KeyValue label="Posted">{h.posted_at ? `${people.data?.[h.posted_by as string] ?? ""} · ${formatDateTime(h.posted_at as string)}` : null}</KeyValue>
              {h.reversal_reason ? <KeyValue label="Reversal reason">{String(h.reversal_reason)}</KeyValue> : null}
            </dl>
            {draft && <p className="mb-2 rounded-control bg-warning-soft/60 px-3 py-1.5 text-xs text-warning">Draft: changed a salary, bonus, leave or labour since? Press Recalculate. Advance recovery can be changed per employee.</p>}
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-sm">
                <thead className="bg-subtle"><tr>
                  {st === "POSTED" && <th className={cn(th, "w-8")} />}
                  <th className={th}>Employee</th><th className={cn(th, "text-right")}>Salary</th><th className={cn(th, "text-right")}>Days</th><th className={cn(th, "text-right")}>Unpaid leave</th>
                  <th className={cn(th, "text-right")}>Assembly</th><th className={cn(th, "text-right")}>Bonus</th><th className={cn(th, "text-right")}>Other</th><th className={cn(th, "text-right")}>Gross</th>
                  <th className={cn(th, "text-right")}>Deductions</th><th className={cn(th, "text-right")}>Advance recovery</th><th className={cn(th, "text-right")}>Net pay</th><th className={cn(th, "text-right")}>Paid</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const ex = open === l.id;
                    const due = Number(l.net_pay) - Number(l.paid_amount);
                    return (
                      <React.Fragment key={l.id}>
                        <tr className={cn("align-top", ex && "bg-subtle/60")}>
                          {st === "POSTED" && <td className={td}>{due > 0 && <input type="checkbox" checked={paySel.includes(l.id)} onChange={(e) => setPaySel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} />}</td>}
                          <td className={td}><button className="flex items-center gap-1 text-left font-medium hover:text-primary" onClick={() => setOpen(ex ? null : l.id)}>
                            {ex ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{names.data?.get(l.employee_id) ?? "…"}</button>
                            {l.note && <div className="pl-5 text-2xs text-ink-muted">{l.note}</div>}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{money(l.basic_salary)}{Number(l.basic_salary) !== Number(l.monthly_salary) && <div className="text-2xs text-ink-muted">of {money(l.monthly_salary)}</div>}</td>
                          <td className={cn(td, "text-right tabular-nums text-xs")}>{Number(l.days_worked)}/{l.days_in_month}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{Number(l.leave_deduction) ? <span className="text-danger">−{money(l.leave_deduction)}<div className="text-2xs text-ink-muted">{Number(l.unpaid_leave_days)} day(s)</div></span> : "—"}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{Number(l.assembly_labour) ? money(l.assembly_labour) : "—"}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{Number(l.bonus) ? money(l.bonus) : "—"}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{Number(l.other_earnings) ? money(l.other_earnings) : "—"}</td>
                          <td className={cn(td, "text-right font-medium tabular-nums")}>{money(l.gross)}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{Number(l.other_deductions) ? <span className="text-danger">−{money(l.other_deductions)}</span> : "—"}</td>
                          <td className={cn(td, "text-right")}>
                            {Number(l.advance_outstanding) <= 0 ? "—" : draft && can(P.payrollManage) ? (
                              <div className="flex items-center justify-end gap-1">
                                <Input className="h-control-sm w-24 text-right tabular-nums" inputMode="decimal" value={rec[l.id] ?? ""} onChange={(e) => setRec((s) => ({ ...s, [l.id]: e.target.value }))} />
                                {num(rec[l.id] ?? "0") !== Number(l.advance_recovery) && <Button size="sm" onClick={() => setLine.mutate(l)}>Set</Button>}
                              </div>
                            ) : <span className="tabular-nums">−{money(l.advance_recovery)}</span>}
                            {Number(l.advance_outstanding) > 0 && <div className="text-2xs text-ink-muted">owes {money(l.advance_outstanding)}</div>}
                          </td>
                          <td className={cn(td, "text-right font-semibold tabular-nums", Number(l.net_pay) < 0 && "text-danger")}>{money(l.net_pay)}</td>
                          <td className={cn(td, "text-right tabular-nums", due > 0 && st === "POSTED" && "text-warning")}>{Number(l.paid_amount) ? money(l.paid_amount) : "—"}</td>
                        </tr>
                        {ex && (
                          <tr className="bg-subtle/60"><td colSpan={st === "POSTED" ? 13 : 12} className="px-6 pb-3 pt-0">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div><div className="mb-1 text-2xs font-semibold uppercase text-ink-muted">Bonuses, labour & deductions</div>
                                {(l.components.items ?? []).length === 0 ? <p className="text-xs text-ink-muted">None</p> : (l.components.items ?? []).map((it) => (
                                  <div key={it.id} className="flex gap-2 text-xs"><span className="w-28 shrink-0 text-ink-muted">{payTypeLabel(it.type)}</span><span className="flex-1 truncate">{it.description}{it.qty ? ` · ${it.qty} × ${money(it.rate)}` : ""}</span>
                                    <span className={cn("tabular-nums", it.direction === "DEDUCTION" && "text-danger")}>{it.direction === "DEDUCTION" ? "−" : ""}{money(it.amount)}</span></div>))}
                              </div>
                              <div><div className="mb-1 text-2xs font-semibold uppercase text-ink-muted">Leave this month</div>
                                {(l.components.leaves ?? []).length === 0 ? <p className="text-xs text-ink-muted">None</p> : (l.components.leaves ?? []).map((lv, i) => (
                                  <div key={i} className="text-xs">{lv.type} · {formatDate(lv.from)} → {formatDate(lv.to)} · {lv.days} day(s) {lv.paid ? <span className="text-success">paid</span> : <span className="text-danger">unpaid</span>}</div>))}
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(run.data?.payments ?? []).length > 0 && (
              <div className="mt-3 rounded-card border border-line p-3 text-sm">
                <div className="mb-1 text-2xs font-semibold uppercase text-ink-muted">Payments</div>
                {(run.data?.payments ?? []).map((p) => {
                  const rev = p.status === "REVERSED";
                  const who = p.employee_id ? names.data?.get(p.employee_id as string) : `${((p.lines as unknown[]) ?? []).length} employees together`;
                  return (
                    <div key={p.id as string} className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line/60 py-1.5 first:border-t-0", rev && "text-ink-faint line-through")}>
                      <span className="w-24 text-xs">{formatDate(p.payment_date as string)}</span>
                      <span className="font-medium">{who}</span>
                      <span className="text-xs text-ink-muted">{(p.bank as unknown as { name: string } | null)?.name}{p.reference ? ` · ref ${p.reference}` : ""}</span>
                      {rev && <span className="text-2xs no-underline">reversed: {p.reversal_reason as string}</span>}
                      <span className="ml-auto font-medium tabular-nums">{money(p.amount as number)}</span>
                      <button className="text-xs text-primary hover:underline" onClick={() => navigate(`/vouchers?view=${p.journal_entry_id}`)}>voucher</button>
                      {!rev && can(P.payrollManage) && <button className="text-xs text-danger hover:underline" onClick={() => setUndoPay(p as Row)}>reverse</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask === "approve"} title="Approve this payroll?" confirmLabel="Approve" loading={approve.isPending} onCancel={() => setAsk(null)} onConfirm={() => approve.mutate(true)}
        message={`Net pay PKR ${money(tot("net_pay"))} for ${lines.length} employee(s). After approval the figures are locked until posted (or sent back to draft).`} />
      <ConfirmDialog open={ask === "unapprove"} title="Send back to draft?" confirmLabel="Back to draft" loading={approve.isPending} onCancel={() => setAsk(null)} onConfirm={() => approve.mutate(false)}
        message="It can then be recalculated and changed." />
      <ConfirmDialog open={ask === "post"} title="Post to the accounts?" confirmLabel="Post" loading={post.isPending} onCancel={() => setAsk(null)} onConfirm={() => post.mutate(undefined)}
        message="Salaries & Wages and Assembly Labour are charged; net pay becomes owed to each employee (Employee Payable) and recovered advances reduce Employee Advances. Bonuses, labour and leave in this payroll are marked as paid." />
      {ask === "pay" && <PayDialog runId={id} month={monthLabel(h?.period_month as string)} lines={unpaid} names={names.data} preselect={paySel}
        onClose={() => setAsk(null)} onDone={() => { setAsk(null); setPaySel([]); }} />}
      <ConfirmDialog open={!!undoPay} title="Reverse this salary payment?" tone="destructive" confirmLabel="Reverse payment" loading={undo.isPending}
        onCancel={() => { setUndoPay(null); setReason(""); }} onConfirm={() => undo.mutate(undefined)}
        message={`PKR ${money(undoPay?.amount as number)} — its voucher is reversed and the salary shows as unpaid again (e.g. a transfer that bounced or a wrong amount).`}>
        <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "reverse"} title="Reverse this payroll?" tone="destructive" confirmLabel="Reverse" loading={reverse.isPending} onCancel={() => setAsk(null)} onConfirm={() => reverse.mutate(undefined)}
        message="The accounting entry is reversed, advance recoveries are undone and bonuses / labour / leave go back to waiting. Salaries already paid must be reversed first.">
        <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "cancel"} title="Cancel this payroll?" tone="destructive" confirmLabel="Cancel payroll" loading={cancel.isPending} onCancel={() => setAsk(null)} onConfirm={() => cancel.mutate(undefined)}
        message="Nothing has been posted. Everything it picked up becomes available for a new payroll of this month." />
    </>
  );
}

interface PayDetail { employee_id: string; payment_method: string; bank_name: string | null; account_title: string | null; account_number: string | null; iban: string | null }

/**
 * Paying salaries: each employee separately (one voucher each — e.g. a transfer to their own bank account, with its transfer reference)
 * or several employees together (one voucher — e.g. a cash envelope run or one bulk bank payment). Amounts can be partial.
 */
function PayDialog({ runId, month, lines, names, preselect, onClose, onDone }: {
  runId: string; month: string; lines: Line[]; names?: Map<string, string>; preselect: string[]; onClose: () => void; onDone: () => void;
}) {
  const details = useQuery({
    queryKey: ["payroll", "pay-details", lines.map((l) => l.employee_id).join(",")],
    queryFn: async () => {
      const { data } = await sb().from("employee_payment_details").select("employee_id, payment_method, bank_name, account_title, account_number, iban").in("employee_id", lines.map((l) => l.employee_id));
      return new Map(((data ?? []) as PayDetail[]).map((d) => [d.employee_id, d]));
    },
  });
  const [sel, setSel] = React.useState<string[]>(preselect.length ? preselect : lines.map((l) => l.id));
  const [amt, setAmt] = React.useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(Number(l.net_pay) - Number(l.paid_amount))])));
  const [ref, setRef] = React.useState<Record<string, string>>({});
  const [separate, setSeparate] = React.useState<boolean | null>(null);
  const [bank, setBank] = React.useState<string | null>(null);
  const [date, setDate] = React.useState(today());
  const [common, setCommon] = React.useState("");
  // default: separately when everyone chosen is paid by bank transfer
  React.useEffect(() => {
    if (separate !== null || !details.data) return;
    const chosen = lines.filter((l) => sel.includes(l.id));
    setSeparate(chosen.length > 0 && chosen.every((l) => details.data!.get(l.employee_id)?.payment_method === "BANK"));
  }, [details.data, separate, sel, lines]);
  const chosen = lines.filter((l) => sel.includes(l.id));
  const total = chosen.reduce((s, l) => s + (num(amt[l.id] ?? "0") || 0), 0);
  const go = useHrAction(() => rpc("pay_payroll_salaries", {
    p_run_id: runId, p_bank_account_id: bank, p_date: date, p_separate: !!separate, p_reference: common || null,
    p_lines: chosen.map((l) => ({ line_id: l.id, amount: String(num(amt[l.id] ?? "0")), reference: ref[l.id] || null })),
  }), (/* */) => (separate ? `${chosen.length} payment voucher(s) made` : "One payment voucher made"), onDone);
  const card = (on: boolean, title: string, text: string, v: boolean) => (
    <button type="button" onClick={() => setSeparate(v)}
      className={cn("flex-1 rounded-card border-2 p-3 text-left transition", on ? "border-primary bg-primary/5" : "border-line hover:border-line-strong")}>
      <div className="text-sm font-semibold">{title}</div><div className="text-xs text-ink-muted">{text}</div>
    </button>
  );
  return (
    <ErpDialog open onRequestClose={onClose} size="xl" icon={<Banknote className="h-4 w-4" />} title={`Pay salaries — ${month}`}
      footer={<><span className="text-sm text-ink-muted">{chosen.length} employee(s) · <b className="tabular-nums text-ink">PKR {money(total)}</b></span><div className="flex-1" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Banknote className="h-3.5 w-3.5" />} disabled={!bank || !chosen.length || total <= 0} loading={go.isPending} onClick={() => go.mutate(undefined)}>
          {separate ? `Pay separately (${chosen.length} vouchers)` : "Pay together (1 voucher)"}</Button></>}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        {card(separate === true, "Each employee separately", "One payment per employee — e.g. transfer to their own bank account. Enter each transfer's reference.", true)}
        {card(separate === false, "Several together", "One payment for the group — e.g. cash handed out, or one bulk bank payment.", false)}
      </div>
      <FormGrid cols={3} className="mb-3">
        <Field label="Paid from (our account)" required><BankPicker value={bank} onChange={setBank} placeholder="Cash / bank…" /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={separate ? "Reference (if one for all)" : "Reference / cheque no."}><Input value={common} onChange={(e) => setCommon(e.target.value)} /></Field>
      </FormGrid>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <thead className="bg-subtle"><tr>
            <th className={cn(th, "w-8")}><input type="checkbox" checked={sel.length === lines.length} onChange={(e) => setSel(e.target.checked ? lines.map((l) => l.id) : [])} /></th>
            <th className={th}>Employee</th><th className={th}>Pay to</th><th className={cn(th, "text-right")}>Still owed</th><th className={cn(th, "w-36 text-right")}>Pay now</th>
            {separate && <th className={cn(th, "w-44")}>Transfer ref.</th>}
          </tr></thead>
          <tbody>{lines.map((l) => {
            const d = details.data?.get(l.employee_id);
            const on = sel.includes(l.id);
            const owed = Number(l.net_pay) - Number(l.paid_amount);
            return (
              <tr key={l.id} className={cn(!on && "text-ink-faint")}>
                <td className={td}><input type="checkbox" checked={on} onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /></td>
                <td className={cn(td, "font-medium")}>{names?.get(l.employee_id) ?? "…"}</td>
                <td className={cn(td, "text-xs")}>{d?.payment_method === "BANK"
                  ? <span>{d.bank_name ?? "Bank"} · {d.account_title ? `${d.account_title} · ` : ""}<span className="font-mono">{d.iban || d.account_number || "no account no."}</span></span>
                  : <span className="text-ink-muted">Cash</span>}</td>
                <td className={cn(td, "text-right tabular-nums")}>{money(owed)}</td>
                <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" disabled={!on} value={amt[l.id] ?? ""} onChange={(e) => setAmt((s) => ({ ...s, [l.id]: e.target.value }))} /></td>
                {separate && <td className={td}><Input className="h-control-sm" disabled={!on} value={ref[l.id] ?? ""} placeholder="IBFT / cheque no." onChange={(e) => setRef((s) => ({ ...s, [l.id]: e.target.value }))} /></td>}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">Pay less than owed to pay in parts — the rest stays due. A payment made by mistake (or a bounced transfer) can be reversed from the Payments list.</p>
    </ErpDialog>
  );
}
