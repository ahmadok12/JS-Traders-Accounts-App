import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, CalendarDays, Check, Coins, Factory, HandCoins, Plus, ShieldAlert, Tags, UserCog, Wallet, X } from "lucide-react";
import { Button, Card, Checkbox, ConfirmDialog, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, SearchableSelect, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useProfileNames } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { StatusFilter, useUrlState } from "../inventory/DocPage";
import { ProductPicker, VariantPicker } from "../inventory/pickers";
import { BankPicker, money, num, today } from "../accounting/common";
import { qtyFmt } from "../sales/common";
import { EmployeePicker, PAY_TYPES, StatusPill, fromMonthInput, monthLabel, monthStart, payTypeLabel, rpc, toMonthInput, useEmployeeNames, useHrAction, useHrOverview, type HrRow } from "./common";

const th = "h-9 px-3 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-3 py-2";

export function HrPage() {
  const { can } = useAccess();
  const { params, update } = useUrlState();
  const tab = params.get("tab") ?? "pay";
  if (!can(P.payrollView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Salaries and payroll are restricted." /></Card>;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <PageHeader title="HR & Pay" icon={<UserCog className="h-4 w-4" />}
        description="Salaries (effective-dated), bonuses and deductions, advances, leave and assembly piece-rates. Everything approved here flows into the monthly payroll." />
      <Tabs value={tab} onChange={(t) => update({ tab: t === "pay" ? null : t })} tabs={[
        { key: "pay", label: "Salaries" }, { key: "items", label: "Bonuses & deductions" }, { key: "advances", label: "Advances" },
        { key: "leave", label: "Leave" }, { key: "rates", label: "Labour rates" }, { key: "labour", label: "Assembly labour" },
      ]} />
      {tab === "pay" && <SalariesTab />}
      {tab === "items" && <ItemsTab />}
      {tab === "advances" && <AdvancesTab />}
      {tab === "leave" && <LeaveTab />}
      {tab === "rates" && <RatesTab />}
      {tab === "labour" && <LabourTab />}
    </div>
  );
}

/* ───────────────────────────── salaries ───────────────────────────── */
function SalariesTab() {
  const list = useHrOverview();
  const [open, setOpen] = React.useState<HrRow | null>(null);
  const rows = list.data ?? [];
  const total = rows.filter((r) => r.status !== "LEFT" && r.payroll_eligible).reduce((s, r) => s + Number(r.current_salary ?? 0), 0);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
        <span className="text-ink-muted">Monthly salary bill</span><span className="font-semibold tabular-nums">PKR {money(total)}</span>
        <div className="flex-1" /><span className="text-xs text-ink-muted">Add employees under People → Employees. Click a row to set salary and payment details.</span>
      </div>
      {list.isLoading ? <Skeleton className="m-4 h-32" /> : list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className={th}>Employee</th><th className={th}>Position</th><th className={cn(th, "text-right")}>Monthly salary</th><th className={th}>Since</th>
            <th className={cn(th, "text-right")}>Advance owed</th><th className={cn(th, "text-right")}>Salary owed to them</th><th className={th}>Paid by</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee_id} className="cursor-pointer hover:bg-subtle/60" onClick={() => setOpen(r)}>
                <td className={td}><div className="font-medium">{r.full_name}</div><div className="text-2xs text-ink-muted">{r.code}{!r.payroll_eligible && " · not on payroll"}</div></td>
                <td className={cn(td, "text-ink-2")}>{[r.position, r.department].filter(Boolean).join(" · ")}</td>
                <td className={cn(td, "text-right font-medium tabular-nums")}>{r.current_salary == null ? <span className="text-warning">Not set</span> : money(r.current_salary)}</td>
                <td className={cn(td, "text-xs text-ink-muted")}>{r.salary_from ? formatDate(r.salary_from) : ""}</td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(r.advance_outstanding) ? money(r.advance_outstanding) : <span className="text-ink-faint">—</span>}</td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(r.payable_balance) ? money(r.payable_balance) : <span className="text-ink-faint">—</span>}</td>
                <td className={cn(td, "text-xs")}>{r.payment_method === "BANK" ? "Bank" : "Cash"}</td>
                <td className={td}><StatusPill s={r.status === "ACTIVE" ? "APPROVED" : r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {open && <EmployeePayDialog row={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function EmployeePayDialog({ row, onClose }: { row: HrRow; onClose: () => void }) {
  const { can } = useAccess();
  const hist = useQuery({
    queryKey: ["hr", "salary-history", row.employee_id],
    queryFn: async () => {
      const [s, d] = await Promise.all([
        sb().from("employee_salary_assignments").select("id, monthly_salary, effective_from, effective_to, note, created_at, created_by").eq("employee_id", row.employee_id).order("effective_from", { ascending: false }),
        sb().from("employee_payment_details").select("*").eq("employee_id", row.employee_id).maybeSingle(),
      ]);
      if (s.error) throw s.error;
      return { salaries: s.data ?? [], details: d.data as Record<string, string> | null };
    },
  });
  const names = useProfileNames((hist.data?.salaries ?? []).map((s) => s.created_by as string));
  const [sal, setSal] = React.useState("");
  const [from, setFrom] = React.useState(monthStart());
  const [note, setNote] = React.useState("");
  const [pd, setPd] = React.useState<Record<string, string>>({});
  const [elig, setElig] = React.useState(row.payroll_eligible);
  React.useEffect(() => { if (hist.data) setPd({ payment_method: "CASH", ...(hist.data.details ?? {}) }); }, [hist.data]);
  const setSalary = useHrAction(() => rpc("set_employee_salary", { p_employee_id: row.employee_id, p_monthly_salary: num(sal), p_effective_from: from, p_note: note || null }),
    "Salary saved", () => { setSal(""); setNote(""); });
  const saveDetails = useHrAction(() => rpc("set_employee_payment_details", { p_employee_id: row.employee_id, p_details: { ...pd, payroll_eligible: elig } }), "Payment details saved");
  const canDetails = can(P.payrollManage) || can("employees.view_restricted");
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<Wallet className="h-4 w-4" />} title={row.full_name} subtitle={[row.code, row.position].filter(Boolean).join(" · ")}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Close</Button></>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Monthly salary</h3>
          {can(P.payrollApprove) ? (
            <div className="rounded-card border border-line p-3">
              <FormGrid cols={2}>
                <Field label="New monthly salary (PKR)" required><Input inputMode="decimal" className="text-right tabular-nums" value={sal} onChange={(e) => setSal(e.target.value)} /></Field>
                <Field label="Starts from" required><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="Note" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. annual increment" /></Field>
              </FormGrid>
              <div className="mt-2 flex justify-end"><Button variant="primary" size="sm" disabled={!sal} loading={setSalary.isPending} onClick={() => setSalary.mutate(undefined)}>Save salary</Button></div>
              <p className="mt-1 text-2xs text-ink-muted">Earlier months keep the salary they were paid with. Payroll uses the salary in force at the end of the month.</p>
            </div>
          ) : <p className="text-xs text-ink-muted">Only the owner / administrator can change salaries.</p>}
          <ol className="mt-3 space-y-1.5">
            {(hist.data?.salaries ?? []).map((s) => (
              <li key={s.id as string} className="flex items-baseline gap-2 rounded-control bg-subtle px-3 py-1.5 text-sm">
                <span className="font-semibold tabular-nums">{money(s.monthly_salary as number)}</span>
                <span className="text-xs text-ink-muted">{formatDate(s.effective_from as string)} → {s.effective_to ? formatDate(s.effective_to as string) : "now"}</span>
                <span className="ml-auto truncate text-2xs text-ink-muted">{s.note as string} · {names.data?.[s.created_by as string] ?? ""}</span>
              </li>
            ))}
            {hist.data && !hist.data.salaries.length && <li className="text-sm text-warning">No salary set yet.</li>}
          </ol>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Payment details <span className="text-2xs font-normal text-ink-muted">(restricted)</span></h3>
          {!canDetails ? <p className="text-xs text-ink-muted">Hidden for your role.</p> : (
            <div className="rounded-card border border-line p-3">
              <FormGrid cols={2}>
                <Field label="Paid by">
                  <SearchableSelect value={pd.payment_method ?? "CASH"} onChange={(v) => setPd((s) => ({ ...s, payment_method: v ?? "CASH" }))}
                    options={[{ value: "CASH", label: "Cash" }, { value: "BANK", label: "Bank transfer" }]} />
                </Field>
                <Field label="Bank"><Input value={pd.bank_name ?? ""} onChange={(e) => setPd((s) => ({ ...s, bank_name: e.target.value }))} /></Field>
                <Field label="Account title"><Input value={pd.account_title ?? ""} onChange={(e) => setPd((s) => ({ ...s, account_title: e.target.value }))} /></Field>
                <Field label="Account no."><Input value={pd.account_number ?? ""} onChange={(e) => setPd((s) => ({ ...s, account_number: e.target.value }))} /></Field>
                <Field label="IBAN" className="sm:col-span-2"><Input value={pd.iban ?? ""} onChange={(e) => setPd((s) => ({ ...s, iban: e.target.value }))} /></Field>
              </FormGrid>
              <div className="mt-3"><Checkbox checked={elig} onChange={setElig} label="On payroll" description="Untick for people who are not paid through payroll." /></div>
              <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" loading={saveDetails.isPending} onClick={() => saveDetails.mutate(undefined)}>Save details</Button></div>
            </div>
          )}
        </section>
      </div>
    </ErpDialog>
  );
}

/* ───────────────────────────── bonuses & deductions ───────────────────────────── */
const ITEM_FILTERS = [{ label: "To approve", status: "PENDING" }, { label: "Approved", status: "APPROVED" }, { label: "All" }] as { label: string; status?: string }[];
function ItemsTab() {
  const { can, companyId } = useAccess();
  const [f, setF] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const [sel, setSel] = React.useState<string[]>([]);
  const names = useEmployeeNames();
  const items = useQuery({
    queryKey: ["hr", "items", companyId, f],
    enabled: !!companyId,
    queryFn: async () => {
      let q = sb().from("employee_pay_items").select("id, employee_id, direction, item_type, amount, quantity, rate, item_date, period_month, description, status, payroll_run_id, decision_note, source_type")
        .eq("company_id", companyId!).neq("item_type", "ASSEMBLY_LABOUR").order("item_date", { ascending: false }).limit(300);
      if (ITEM_FILTERS[f].status) q = q.eq("status", ITEM_FILTERS[f].status!);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const decide = useHrAction((approve: boolean) => rpc("decide_pay_items", { p_ids: sel, p_approve: approve }), (a) => (a ? "Approved" : "Rejected"), () => setSel([]));
  const cancel = useHrAction((id: string) => rpc("cancel_pay_item", { p_id: id }), "Cancelled");
  const rows = items.data ?? [];
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <StatusFilter items={ITEM_FILTERS} value={f} onChange={(i) => { setF(i); setSel([]); }} />
        <div className="flex-1" />
        {can(P.payrollApprove) && sel.length > 0 && <>
          <Button size="sm" variant="destructive-ghost" icon={<X className="h-3.5 w-3.5" />} loading={decide.isPending} onClick={() => decide.mutate(false)}>Reject ({sel.length})</Button>
          <Button size="sm" variant="primary" icon={<Check className="h-3.5 w-3.5" />} loading={decide.isPending} onClick={() => decide.mutate(true)}>Approve ({sel.length})</Button>
        </>}
        {can(P.payrollManage) && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Add bonus / deduction</Button>}
      </div>
      {items.isLoading ? <Skeleton className="m-4 h-24" /> : rows.length === 0 ? <EmptyState icon={<Coins className="h-6 w-6" />} title="Nothing here" description="Bonuses, overtime, allowances and fines are added here, approved by the owner, and paid with that month's payroll." /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className={cn(th, "w-8")} /><th className={th}>Employee</th><th className={th}>Type</th><th className={th}>For month</th><th className={th}>Description</th><th className={cn(th, "text-right")}>Amount</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const pending = r.status === "PENDING";
              return (
                <tr key={r.id as string}>
                  <td className={td}>{pending && can(P.payrollApprove) && <input type="checkbox" checked={sel.includes(r.id as string)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.id as string] : s.filter((x) => x !== r.id)))} />}</td>
                  <td className={cn(td, "font-medium")}>{names.data?.get(r.employee_id as string) ?? "…"}</td>
                  <td className={td}>{payTypeLabel(r.item_type as string)}</td>
                  <td className={cn(td, "text-xs")}>{monthLabel(r.period_month as string)}</td>
                  <td className={cn(td, "text-xs text-ink-2")}>{r.description as string}{r.decision_note ? <span className="text-ink-muted"> · {r.decision_note as string}</span> : null}</td>
                  <td className={cn(td, "text-right font-medium tabular-nums", r.direction === "DEDUCTION" && "text-danger")}>{r.direction === "DEDUCTION" ? "−" : ""}{money(r.amount as number)}</td>
                  <td className={td}><StatusPill s={r.payroll_run_id ? "APPLIED" : String(r.status)} /></td>
                  <td className={cn(td, "text-right")}>{["PENDING", "APPROVED"].includes(String(r.status)) && can(P.payrollManage) && !r.source_type &&
                    <Button size="icon-sm" variant="destructive-ghost" title="Cancel" onClick={() => cancel.mutate(r.id as string)}><Ban className="h-3.5 w-3.5" /></Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {adding && <AddItemDialog onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddItemDialog({ onClose }: { onClose: () => void }) {
  const [emp, setEmp] = React.useState<string | null>(null);
  const [type, setType] = React.useState("BONUS");
  const [amt, setAmt] = React.useState("");
  const [date, setDate] = React.useState(today());
  const [month, setMonth] = React.useState(toMonthInput(monthStart()));
  const [desc, setDesc] = React.useState("");
  const dir = PAY_TYPES.find((t) => t.value === type)!.direction;
  const save = useHrAction(() => rpc("add_pay_item", { p_employee_id: emp, p_direction: dir, p_type: type, p_amount: num(amt), p_date: date, p_month: fromMonthInput(month), p_description: desc || null }),
    "Added — waiting for approval", onClose);
  return (
    <ConfirmDialog open title="Add bonus / deduction" confirmLabel="Add" loading={save.isPending} onCancel={onClose} onConfirm={() => save.mutate(undefined)}
      message="It is paid (or deducted) with the payroll of the chosen month once approved.">
      <FormGrid cols={2} className="mt-3">
        <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>
        <Field label="Type" required><SearchableSelect value={type} onChange={(v) => setType(v ?? "BONUS")} options={PAY_TYPES.map((t) => ({ value: t.value, label: t.label, secondary: t.direction === "EARNING" ? "adds to pay" : "reduces pay" }))} /></Field>
        <Field label="Amount (PKR)" required><Input inputMode="decimal" className="text-right tabular-nums" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Payroll month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Eid bonus, 12 hours overtime, late fine" /></Field>
      </FormGrid>
    </ConfirmDialog>
  );
}

/* ───────────────────────────── advances ───────────────────────────── */
const ADV_FILTERS = [{ label: "Outstanding", statuses: ["REQUESTED", "OPEN"] }, { label: "Settled", statuses: ["RECOVERED", "WRITTEN_OFF"] }, { label: "All" }] as { label: string; statuses?: string[] }[];
function AdvancesTab() {
  const { can, companyId } = useAccess();
  const [f, setF] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const [act, setAct] = React.useState<{ kind: "approve" | "repay" | "writeoff" | "reject" | "history"; row: Record<string, unknown> } | null>(null);
  const names = useEmployeeNames();
  const list = useQuery({
    queryKey: ["hr", "advances", companyId, f],
    enabled: !!companyId,
    queryFn: async () => {
      let q = sb().from("employee_advances").select("*").eq("company_id", companyId!).order("advance_date", { ascending: false }).limit(300);
      if (ADV_FILTERS[f].statuses) q = q.in("status", ADV_FILTERS[f].statuses!);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = list.data ?? [];
  const outstanding = rows.filter((r) => r.status === "OPEN").reduce((s, r) => s + Number(r.amount) - Number(r.recovered_amount) - Number(r.written_off_amount), 0);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <StatusFilter items={ADV_FILTERS} value={f} onChange={setF} />
        <span className="text-sm text-ink-muted">Outstanding: <b className="tabular-nums text-ink">PKR {money(outstanding)}</b></span>
        <div className="flex-1" />
        {can(P.payrollManage) && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>New advance</Button>}
      </div>
      {list.isLoading ? <Skeleton className="m-4 h-24" /> : rows.length === 0 ? <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No advances" description="An advance is money the employee owes back — it is recovered from salary month by month, or repaid in cash." /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className={th}>No.</th><th className={th}>Employee</th><th className={th}>Date</th><th className={th}>Reason</th><th className={cn(th, "text-right")}>Amount</th>
            <th className={cn(th, "text-right")}>Recovered</th><th className={cn(th, "text-right")}>Left</th><th className={cn(th, "text-right")}>Per month</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const left = Number(r.amount) - Number(r.recovered_amount) - Number(r.written_off_amount);
              return (
                <tr key={r.id as string}>
                  <td className={cn(td, "font-mono text-xs")}><button className="text-primary hover:underline" onClick={() => setAct({ kind: "history", row: r })}>{r.doc_no as string}</button></td>
                  <td className={cn(td, "font-medium")}>{names.data?.get(r.employee_id as string) ?? "…"}</td>
                  <td className={cn(td, "text-xs")}>{formatDate(r.advance_date as string)}</td>
                  <td className={cn(td, "max-w-[220px] truncate text-xs text-ink-2")}>{r.reason as string}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{money(r.amount as number)}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{Number(r.recovered_amount) ? money(r.recovered_amount as number) : "—"}</td>
                  <td className={cn(td, "text-right font-semibold tabular-nums")}>{r.status === "OPEN" ? money(left) : "—"}</td>
                  <td className={cn(td, "text-right tabular-nums text-xs")}>{r.recovery_per_month ? money(r.recovery_per_month as number) : "—"}</td>
                  <td className={td}><StatusPill s={String(r.status)} /></td>
                  <td className={cn(td, "whitespace-nowrap text-right")}>
                    {r.status === "REQUESTED" && can(P.payrollApprove) && <>
                      <Button size="sm" variant="ghost" onClick={() => setAct({ kind: "reject", row: r })}>Reject</Button>
                      <Button size="sm" variant="primary" onClick={() => setAct({ kind: "approve", row: r })}>Approve & pay</Button></>}
                    {r.status === "OPEN" && can(P.payrollManage) && <Button size="sm" variant="ghost" onClick={() => setAct({ kind: "repay", row: r })}>Repaid…</Button>}
                    {r.status === "OPEN" && can(P.payrollApprove) && <Button size="sm" variant="destructive-ghost" onClick={() => setAct({ kind: "writeoff", row: r })}>Write off…</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {adding && <NewAdvanceDialog onClose={() => setAdding(false)} />}
      {act && act.kind !== "history" && <AdvanceActionDialog kind={act.kind} row={act.row} name={names.data?.get(act.row.employee_id as string) ?? ""} onClose={() => setAct(null)} />}
      {act?.kind === "history" && <AdvanceHistory row={act.row} name={names.data?.get(act.row.employee_id as string) ?? ""} onClose={() => setAct(null)} />}
    </Card>
  );
}

function NewAdvanceDialog({ onClose }: { onClose: () => void }) {
  const { can } = useAccess();
  const [emp, setEmp] = React.useState<string | null>(null);
  const [amt, setAmt] = React.useState("");
  const [per, setPer] = React.useState("");
  const [date, setDate] = React.useState(today());
  const [bank, setBank] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const save = useHrAction(async () => {
    const id = await rpc("request_employee_advance", { p_employee_id: emp, p_amount: num(amt), p_date: date, p_reason: reason, p_recovery_per_month: per ? num(per) : null, p_bank_account_id: bank });
    if (can(P.payrollApprove) && bank) await rpc("approve_employee_advance", { p_id: id, p_bank_account_id: bank, p_date: date });
  }, can(P.payrollApprove) && bank ? "Advance paid and recorded" : "Advance requested — waiting for approval", onClose);
  return (
    <ConfirmDialog open title="New employee advance" confirmLabel={can(P.payrollApprove) && bank ? "Pay advance" : "Request"} loading={save.isPending} onCancel={onClose} onConfirm={() => save.mutate(undefined)}
      message="The advance is the employee's debt (not an expense). It is recovered from salary each month or repaid in cash.">
      <FormGrid cols={2} className="mt-3">
        <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>
        <Field label="Amount (PKR)" required><Input inputMode="decimal" className="text-right tabular-nums" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Recover per month"><Input inputMode="decimal" className="text-right tabular-nums" value={per} onChange={(e) => setPer(e.target.value)} placeholder="manual" /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Paid from"><BankPicker value={bank} onChange={setBank} placeholder="Cash / bank…" /></Field>
        <Field label="Reason" className="sm:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </FormGrid>
    </ConfirmDialog>
  );
}

function AdvanceActionDialog({ kind, row, name, onClose }: { kind: "approve" | "repay" | "writeoff" | "reject"; row: Record<string, unknown>; name: string; onClose: () => void }) {
  const left = Number(row.amount) - Number(row.recovered_amount) - Number(row.written_off_amount);
  const [bank, setBank] = React.useState<string | null>((row.bank_account_id as string) ?? null);
  const [amt, setAmt] = React.useState(String(left));
  const [date, setDate] = React.useState(kind === "approve" ? String(row.advance_date) : today());
  const [text, setText] = React.useState("");
  const go = useHrAction(() =>
    kind === "approve" ? rpc("approve_employee_advance", { p_id: row.id, p_bank_account_id: bank, p_date: date })
    : kind === "reject" ? rpc("reject_employee_advance", { p_id: row.id, p_note: text })
    : kind === "repay" ? rpc("repay_employee_advance", { p_id: row.id, p_amount: num(amt), p_bank_account_id: bank, p_date: date, p_note: text })
    : rpc("write_off_employee_advance", { p_id: row.id, p_amount: num(amt), p_reason: text, p_date: date }),
  kind === "approve" ? "Advance paid" : kind === "reject" ? "Rejected" : kind === "repay" ? "Repayment recorded" : "Written off", onClose);
  const title = { approve: `Approve & pay ${row.doc_no} — ${name}`, reject: `Reject ${row.doc_no}`, repay: `Repayment — ${name}`, writeoff: `Write off — ${name}` }[kind];
  const msg = {
    approve: `PKR ${money(row.amount as number)} is paid out of the chosen account and booked to Employee Advances.`,
    reject: "The request is closed; nothing is paid.",
    repay: `Outstanding PKR ${money(left)}. The money received reduces the advance.`,
    writeoff: `Outstanding PKR ${money(left)}. The written-off amount becomes a salary expense. This needs a reason.`,
  }[kind];
  return (
    <ConfirmDialog open title={title} message={msg} tone={kind === "writeoff" || kind === "reject" ? "destructive" : "default"} confirmLabel={kind === "approve" ? "Pay advance" : kind === "reject" ? "Reject" : kind === "repay" ? "Record" : "Write off"}
      loading={go.isPending} onCancel={onClose} onConfirm={() => go.mutate(undefined)}>
      <FormGrid cols={2} className="mt-3">
        {(kind === "approve" || kind === "repay") && <Field label={kind === "approve" ? "Paid from" : "Received into"} required className="sm:col-span-2"><BankPicker value={bank} onChange={setBank} /></Field>}
        {(kind === "repay" || kind === "writeoff") && <Field label="Amount" required><Input inputMode="decimal" className="text-right tabular-nums" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>}
        {kind !== "reject" && <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        {kind !== "approve" && <Field label={kind === "writeoff" ? "Reason" : "Note"} required={kind === "writeoff"} className="sm:col-span-2"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>}
      </FormGrid>
    </ConfirmDialog>
  );
}

function AdvanceHistory({ row, name, onClose }: { row: Record<string, unknown>; name: string; onClose: () => void }) {
  const tx = useQuery({
    queryKey: ["hr", "advance-tx", row.id],
    queryFn: async () => {
      const { data, error } = await sb().from("employee_advance_transactions").select("id, kind, amount, txn_date, reversed, note, journal_entry_id, payroll_run_id, created_at").eq("advance_id", row.id as string).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const label: Record<string, string> = { GRANT: "Advance paid", PAYROLL_RECOVERY: "Recovered from salary", REPAYMENT: "Repaid", WRITE_OFF: "Written off" };
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<HandCoins className="h-4 w-4" />} title={`${row.doc_no} · ${name}`} subtitle={row.reason as string}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Close</Button></>}>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Date</th><th className={th}>What</th><th className={cn(th, "text-right")}>Amount</th><th className={th}>Note</th></tr></thead>
        <tbody>{(tx.data ?? []).map((t) => (
          <tr key={t.id as string} className={cn(t.reversed && "text-ink-faint line-through")}>
            <td className={cn(td, "text-xs")}>{formatDate(t.txn_date as string)}</td><td className={td}>{label[t.kind as string]}{t.reversed && " (reversed)"}</td>
            <td className={cn(td, "text-right tabular-nums")}>{money(t.amount as number)}</td><td className={cn(td, "text-xs text-ink-muted")}>{t.note as string}</td>
          </tr>))}</tbody>
      </table>
    </ErpDialog>
  );
}

/* ───────────────────────────── leave ───────────────────────────── */
function LeaveTab() {
  const { can, companyId } = useAccess();
  const [year, setYear] = React.useState(new Date().getFullYear());
  const [adding, setAdding] = React.useState(false);
  const [types, setTypes] = React.useState(false);
  const names = useEmployeeNames();
  const lt = useQuery({
    queryKey: ["hr", "leave-types", companyId],
    enabled: !!companyId,
    queryFn: async () => (await sb().from("leave_types").select("*").eq("company_id", companyId!).order("name")).data ?? [],
  });
  const reqs = useQuery({
    queryKey: ["hr", "leave", companyId, year],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("employee_leave_requests").select("*").eq("company_id", companyId!)
        .gte("from_date", `${year}-01-01`).lte("from_date", `${year}-12-31`).order("from_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const bal = useQuery({
    queryKey: ["hr", "leave-bal", companyId, year],
    enabled: !!companyId,
    queryFn: async () => (await sb().rpc("leave_balances", { p_company_id: companyId, p_year: year })).data as { employee_id: string; employee_name: string; leave_type: string; is_paid: boolean; entitled: number; taken: number; pending: number; remaining: number }[] ?? [],
  });
  const decide = useHrAction((v: { id: string; approve: boolean | null }) => rpc("decide_leave", { p_id: v.id, p_approve: v.approve }), (v) => (v.approve == null ? "Cancelled" : v.approve ? "Approved" : "Rejected"));
  const typeName = new Map((lt.data ?? []).map((t) => [t.id as string, t]));
  const byEmp = new Map<string, { name: string; cells: Record<string, { taken: number; rem: number; paid: boolean; ent: number }> }>();
  for (const b of bal.data ?? []) {
    const e = byEmp.get(b.employee_id) ?? { name: b.employee_name, cells: {} };
    e.cells[b.leave_type] = { taken: Number(b.taken), rem: Number(b.remaining), paid: b.is_paid, ent: Number(b.entitled) };
    byEmp.set(b.employee_id, e);
  }
  const typeCols = Array.from(new Set((bal.data ?? []).map((b) => b.leave_type)));
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <CalendarDays className="h-4 w-4 text-ink-muted" /><span className="text-sm font-semibold">Leave requests</span>
          <Input type="number" className="h-control-sm w-24" value={year} onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())} />
          <div className="flex-1" />
          {can(P.payrollManage) && <Button size="sm" variant="ghost" icon={<Tags className="h-3.5 w-3.5" />} onClick={() => setTypes(true)}>Leave types</Button>}
          {can(P.payrollManage) && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Record leave</Button>}
        </div>
        {(reqs.data ?? []).length === 0 ? <p className="p-4 text-sm text-ink-muted">No leave recorded in {year}.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className={th}>Employee</th><th className={th}>Type</th><th className={th}>Dates</th><th className={cn(th, "text-right")}>Days</th><th className={th}>Reason</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody>{(reqs.data ?? []).map((r) => {
              const t = typeName.get(r.leave_type_id as string);
              return (
                <tr key={r.id as string}>
                  <td className={cn(td, "font-medium")}>{names.data?.get(r.employee_id as string) ?? "…"}</td>
                  <td className={td}>{t?.name as string}{t && !t.is_paid && <span className="ml-1 text-2xs text-warning">unpaid</span>}</td>
                  <td className={cn(td, "text-xs")}>{formatDate(r.from_date as string)} → {formatDate(r.to_date as string)}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(r.days)}</td>
                  <td className={cn(td, "text-xs text-ink-2")}>{r.reason as string}</td>
                  <td className={td}><StatusPill s={String(r.status)} /></td>
                  <td className={cn(td, "whitespace-nowrap text-right")}>
                    {r.status === "REQUESTED" && <>
                      <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id as string, approve: false })}>Reject</Button>
                      <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: r.id as string, approve: true })}>Approve</Button></>}
                    {["REQUESTED", "APPROVED"].includes(String(r.status)) && <Button size="icon-sm" variant="destructive-ghost" title="Cancel" onClick={() => decide.mutate({ id: r.id as string, approve: null })}><Ban className="h-3.5 w-3.5" /></Button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-3 py-2 text-sm font-semibold">Balances {year} <span className="text-2xs font-normal text-ink-muted">taken / left of the yearly entitlement</span></div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className={th}>Employee</th>{typeCols.map((c) => <th key={c} className={cn(th, "text-right")}>{c}</th>)}</tr></thead>
          <tbody>{Array.from(byEmp.entries()).map(([id, e]) => (
            <tr key={id}><td className={cn(td, "font-medium")}>{e.name}</td>
              {typeCols.map((c) => { const x = e.cells[c]; return <td key={c} className={cn(td, "text-right tabular-nums")}>{!x ? "" : !x.paid || !x.ent ? (x.taken ? `${qtyFmt(x.taken)} taken` : "—") :
                <span><span className="text-ink-muted">{qtyFmt(x.taken)} /</span> <b className={cn(x.rem < 0 && "text-danger")}>{qtyFmt(x.rem)}</b></span>}</td>; })}
            </tr>))}</tbody>
        </table></div>
      </Card>
      {adding && <LeaveDialog types={(lt.data ?? []).filter((t) => t.is_active) as { id: string; name: string; is_paid: boolean }[]} onClose={() => setAdding(false)} />}
      {types && <LeaveTypesDialog types={(lt.data ?? []) as LeaveType[]} onClose={() => setTypes(false)} />}
    </div>
  );
}

function LeaveDialog({ types, onClose }: { types: { id: string; name: string; is_paid: boolean }[]; onClose: () => void }) {
  const { can } = useAccess();
  const [emp, setEmp] = React.useState<string | null>(null);
  const [type, setType] = React.useState<string | null>(types[0]?.id ?? null);
  const [from, setFrom] = React.useState(today());
  const [to, setTo] = React.useState(today());
  const [days, setDays] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [approve, setApprove] = React.useState(true);
  const save = useHrAction(async () => {
    const id = await rpc("request_leave", { p_employee_id: emp, p_leave_type_id: type, p_from: from, p_to: to, p_days: days ? num(days) : null, p_reason: reason || null });
    if (approve) await rpc("decide_leave", { p_id: id, p_approve: true });
  }, approve ? "Leave recorded and approved" : "Leave requested", onClose);
  return (
    <ConfirmDialog open title="Record leave" confirmLabel="Save" loading={save.isPending} onCancel={onClose} onConfirm={() => save.mutate(undefined)}
      message="Unpaid leave is deducted in that month's payroll (salary ÷ days in month × days).">
      <FormGrid cols={2} className="mt-3">
        <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>
        <Field label="Leave type" required className="sm:col-span-2"><SearchableSelect value={type} onChange={setType} options={types.map((t) => ({ value: t.id, label: t.name, secondary: t.is_paid ? "paid" : "unpaid" }))} /></Field>
        <Field label="From" required><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></Field>
        <Field label="To" required><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Days" hint="e.g. 0.5 for half a day"><Input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} placeholder="all days" /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </FormGrid>
      {can(P.payrollManage) && <div className="mt-3"><Checkbox checked={approve} onChange={setApprove} label="Approve now" /></div>}
    </ConfirmDialog>
  );
}

type LeaveType = { id: string; code: string; name: string; is_paid: boolean; annual_days: number; is_active: boolean };
function LeaveTypesDialog({ types, onClose }: { types: LeaveType[]; onClose: () => void }) {
  const { companyId } = useAccess();
  const [rows, setRows] = React.useState<(LeaveType & { dirty?: boolean })[]>(types.map((t) => ({ ...t })));
  const save = useHrAction(async () => {
    for (const r of rows.filter((x) => x.dirty)) {
      await rpc("save_leave_type", { p_company_id: companyId, p_id: r.id || null, p_code: r.code, p_name: r.name, p_is_paid: r.is_paid, p_annual_days: Number(r.annual_days) || 0, p_active: r.is_active });
    }
  }, "Leave types saved", onClose);
  const upd = (i: number, p: Partial<LeaveType>) => setRows((s) => s.map((r, j) => (j === i ? { ...r, ...p, dirty: true } : r)));
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<Tags className="h-4 w-4" />} title="Leave types"
      footer={<><Button variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((s) => [...s, { id: "", code: "", name: "", is_paid: true, annual_days: 0, is_active: true, dirty: true }])}>Add type</Button>
        <div className="flex-1" /><Button onClick={onClose}>Close</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Code</th><th className={th}>Name</th><th className={cn(th, "text-right")}>Days / year</th><th className={th}>Paid</th><th className={th}>Active</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id || i}>
            <td className={td}><Input className="h-control-sm w-24" value={r.code} onChange={(e) => upd(i, { code: e.target.value })} /></td>
            <td className={td}><Input className="h-control-sm" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
            <td className={td}><Input className="h-control-sm w-20 text-right" inputMode="decimal" value={String(r.annual_days)} onChange={(e) => upd(i, { annual_days: Number(e.target.value) || 0 })} /></td>
            <td className={td}><input type="checkbox" checked={r.is_paid} onChange={(e) => upd(i, { is_paid: e.target.checked })} /></td>
            <td className={td}><input type="checkbox" checked={r.is_active} onChange={(e) => upd(i, { is_active: e.target.checked })} /></td>
          </tr>))}</tbody>
      </table>
    </ErpDialog>
  );
}

/* ───────────────────────────── labour rates ───────────────────────────── */
function RatesTab() {
  const { can, companyId } = useAccess();
  const [adding, setAdding] = React.useState(false);
  const [all, setAll] = React.useState(false);
  const names = useEmployeeNames();
  const list = useQuery({
    queryKey: ["hr", "rates", companyId, all],
    enabled: !!companyId,
    queryFn: async () => {
      let q = sb().from("assembly_labour_rates").select("id, product_id, variant_id, employee_id, rate, effective_from, effective_to, note, product:products(name, sku), variant:product_variants(name)")
        .eq("company_id", companyId!).order("effective_from", { ascending: false });
      if (!all) q = q.or(`effective_to.is.null,effective_to.gte.${today()}`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Factory className="h-4 w-4 text-ink-muted" /><span className="text-sm font-semibold">Piece rates for assembly work</span>
        <Checkbox checked={all} onChange={setAll} label="Show old rates" />
        <div className="flex-1" />
        {can(P.payrollApprove) && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Set rate</Button>}
      </div>
      {(list.data ?? []).length === 0 ? <EmptyState icon={<Factory className="h-6 w-6" />} title="No labour rates yet" description="Set how much is paid per cooler / fan assembled. Employees keep their salary; approved assembly work is paid on top." /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className={th}>Item</th><th className={th}>For</th><th className={cn(th, "text-right")}>Rate per item</th><th className={th}>From</th><th className={th}>To</th><th className={th}>Note</th></tr></thead>
          <tbody>{(list.data ?? []).map((r) => (
            <tr key={r.id as string} className={cn(r.effective_to && String(r.effective_to) < today() && "text-ink-muted")}>
              <td className={td}><div className="font-medium">{(r.product as unknown as { name: string })?.name}{r.variant ? <span className="font-normal text-ink-muted"> · {(r.variant as unknown as { name: string }).name}</span> : null}</div></td>
              <td className={td}>{r.employee_id ? names.data?.get(r.employee_id as string) : <span className="text-ink-muted">Everyone</span>}</td>
              <td className={cn(td, "text-right font-semibold tabular-nums")}>{money(r.rate as number)}</td>
              <td className={cn(td, "text-xs")}>{formatDate(r.effective_from as string)}</td>
              <td className={cn(td, "text-xs")}>{r.effective_to ? formatDate(r.effective_to as string) : "—"}</td>
              <td className={cn(td, "text-xs text-ink-muted")}>{r.note as string}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {adding && <RateDialog onClose={() => setAdding(false)} />}
    </Card>
  );
}

function RateDialog({ onClose }: { onClose: () => void }) {
  const { companyId } = useAccess();
  const [prod, setProd] = React.useState<string | null>(null);
  const [vari, setVari] = React.useState<string | null>(null);
  const [emp, setEmp] = React.useState<string | null>(null);
  const [rate, setRate] = React.useState("");
  const [from, setFrom] = React.useState(today());
  const [note, setNote] = React.useState("");
  const save = useHrAction(() => rpc("set_labour_rate", { p_company_id: companyId, p_product_id: prod, p_variant_id: vari, p_employee_id: emp, p_rate: num(rate), p_effective_from: from, p_note: note || null }), "Rate saved", onClose);
  return (
    <ConfirmDialog open title="Set labour rate" confirmLabel="Save rate" loading={save.isPending} onCancel={onClose} onConfirm={() => save.mutate(undefined)}
      message="The new rate applies to assembly done from the start date. Work already paid keeps its old rate.">
      <FormGrid cols={2} className="mt-3">
        <Field label="Item assembled" required className="sm:col-span-2"><ProductPicker value={prod} onChange={(v) => { setProd(v); setVari(null); }} showStock={false} /></Field>
        <Field label="Variant (optional)"><VariantPicker productId={prod} value={vari} onChange={setVari} showStock={false} /></Field>
        <Field label="Only for employee (optional)"><EmployeePicker value={emp} onChange={setEmp} placeholder="Everyone" /></Field>
        <Field label="Rate per item (PKR)" required><Input inputMode="decimal" className="text-right tabular-nums" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="Starts from" required><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Note" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </FormGrid>
    </ConfirmDialog>
  );
}

/* ───────────────────────────── assembly labour report ───────────────────────────── */
function LabourTab() {
  const { companyId } = useAccess();
  const [month, setMonth] = React.useState(toMonthInput(monthStart()));
  const names = useEmployeeNames();
  const list = useQuery({
    queryKey: ["hr", "labour", companyId, month],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("employee_pay_items").select("id, employee_id, amount, quantity, rate, item_date, description, status, payroll_run_id, created_at")
        .eq("company_id", companyId!).eq("item_type", "ASSEMBLY_LABOUR").eq("period_month", fromMonthInput(month)).neq("status", "CANCELLED").order("item_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = list.data ?? [];
  const byEmp = new Map<string, { q: number; a: number }>();
  for (const r of rows) { const e = byEmp.get(r.employee_id as string) ?? { q: 0, a: 0 }; e.q += Number(r.quantity); e.a += Number(r.amount); byEmp.set(r.employee_id as string, e); }
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm font-semibold">Assembly labour for</span>
        <Input type="month" className="h-control-sm w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
        <span className="text-xs text-ink-muted">Approved on assembly orders (Inventory → Assembly → Labour tab). Paid with the payroll of this month.</span>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from(byEmp.entries()).map(([id, e]) => (
          <Card key={id} className="p-3"><div className="text-sm font-medium">{names.data?.get(id)}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">PKR {money(e.a)}</div><div className="text-xs text-ink-muted">{qtyFmt(e.q)} items</div></Card>
        ))}
      </div>
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? <p className="p-4 text-sm text-ink-muted">No approved assembly labour in {monthLabel(fromMonthInput(month))}.</p> : (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Date</th><th className={th}>Employee</th><th className={th}>Assembly</th><th className={cn(th, "text-right")}>Qty</th><th className={cn(th, "text-right")}>Rate</th><th className={cn(th, "text-right")}>Amount</th><th className={th}>Payroll</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id as string}><td className={cn(td, "text-xs")}>{formatDate(r.item_date as string)}</td><td className={cn(td, "font-medium")}>{names.data?.get(r.employee_id as string)}</td>
                <td className={cn(td, "text-xs")}>{r.description as string}</td><td className={cn(td, "text-right tabular-nums")}>{qtyFmt(r.quantity)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{money(r.rate as number)}</td><td className={cn(td, "text-right font-medium tabular-nums")}>{money(r.amount as number)}</td>
                <td className={td}><StatusPill s={r.payroll_run_id ? "APPLIED" : "APPROVED"} /></td></tr>))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

