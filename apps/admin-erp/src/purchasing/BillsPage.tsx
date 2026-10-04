import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban, Banknote, CheckCircle2, FileText, Link2, Plus, Printer, Receipt, RotateCcw, Save, ShieldAlert, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { LookupPicker } from "../inventory/pickers";
import { AccountPicker, BankPicker, money, num, today } from "../accounting/common";
import { printDocument } from "../sales/print";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { BILL_TONE, CurrencyInput, rpc, useAction, useCan, useItemInfo } from "./common";

type Row = Record<string, unknown> & { id: string };
const icon = <Receipt className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";
const FILTERS = [
  { label: "To pay", status: "POSTED", unpaid: true }, { label: "Drafts", status: "DRAFT" }, { label: "Posted", status: "POSTED" }, { label: "All" },
] as { label: string; status?: string; unpaid?: boolean }[];
const PAY_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { UNPAID: "danger", PART_PAID: "warning", PAID: "success" };

export function BillsPage() {
  const { companyId } = useAccess();
  const c = useCan();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("view");
  const [picking, setPicking] = React.useState(false);
  const flt = FILTERS[f];
  const list = useEntityList<Row>({
    table: "supplier_bills_v", select: "id, doc_no, bill_date, due_date, supplier_name, supplier_invoice_no, currency, total_amount, total_pkr, paid_pkr, outstanding_pkr, payment_status, status",
    companyId, search: q, searchColumns: ["doc_no", "supplier_invoice_no", "supplier_name"], filters: { status: flt.status },
    orderBy: { column: "bill_date", ascending: false }, page, pageSize: 50, enabled: c.costs,
  });
  if (!c.costs) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Supplier bills are restricted." /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) => !flt.unpaid || Number(r.outstanding_pkr) > 0);
  const due = rows.reduce((s, r) => s + Number(r.outstanding_pkr ?? 0), 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Supplier Bills" icon={icon}
        description="The supplier's invoice. Made from goods receipts (it clears “goods received not billed” and fixes any cost difference) or for expenses. Posting puts the amount on the supplier's account; tick Pay Supplier Now to pay it at once."
        actions={c.manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setPicking(true)}>New bill</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search bill / supplier / invoice no…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
          {flt.unpaid && <span className="ml-auto text-sm text-ink-muted">Owed: <b className="tabular-nums text-ink">PKR {money(due)}</b></span>}
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id })} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "d", header: "Bill", width: "120px", cell: (r) => <span className="font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.bill_date as string) },
              { key: "s", header: "Supplier", cell: (r) => <span>{String(r.supplier_name)}{r.supplier_invoice_no ? <span className="text-xs text-ink-muted"> · {String(r.supplier_invoice_no)}</span> : null}</span> },
              { key: "t", header: "Amount", width: "150px", align: "right", cell: (r) => <span className="tabular-nums">{r.currency !== "PKR" && <span className="text-2xs text-ink-muted">{String(r.currency)} {money(r.total_amount as number)} = </span>}{money(r.total_pkr as number)}</span> },
              { key: "o", header: "Outstanding", width: "130px", align: "right", cell: (r) => <span className={cn("font-medium tabular-nums", Number(r.outstanding_pkr) > 0 && "text-danger")}>{r.status === "POSTED" ? money(r.outstanding_pkr as number) : ""}</span> },
              { key: "due", header: "Due", width: "100px", hideBelow: "lg", cell: (r) => (r.due_date ? formatDate(r.due_date as string) : null) },
              { key: "st", header: "Status", width: "130px", cell: (r) => r.status === "POSTED" ? <Badge tone={PAY_TONE[String(r.payment_status)]}>{String(r.payment_status).replace("_", " ").toLowerCase()}</Badge> : <Badge tone={BILL_TONE[String(r.status)]}>{String(r.status).toLowerCase()}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No bills" description="Make one from received goods or for an expense." />} />
        )}
      </Card>
      {picking && <NewBillDialog onClose={() => setPicking(false)} onCreated={(id) => { setPicking(false); update({ view: id }); }} />}
      {view && <BillDialog id={view} onClose={() => update({ view: null })} />}
    </div>
  );
}

function NewBillDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { companyId } = useAccess();
  const [sup, setSup] = React.useState<string | null>(null);
  const [sel, setSel] = React.useState<string[]>([]);
  const rec = useQuery({ queryKey: ["unbilled", companyId, sup], enabled: !!companyId,
    queryFn: async () => (await rpc<{ receipt_id: string; doc_no: string; doc_date: string; supplier_id: string; supplier_name: string; purchase_order_no: string | null; lines_to_bill: number; cost_status: string }[]>("unbilled_receipts", { p_company_id: companyId, p_supplier_id: sup })) ?? [] });
  const fromReceipts = useAction(() => rpc<string>("create_bill_from_receipts", { p_company_id: companyId, p_receipt_ids: sel }), "Draft bill made from the receipts");
  const blank = useAction(() => rpc<string>("save_supplier_bill", { p_id: null, p_header: { company_id: companyId, supplier_id: sup, bill_date: today(), currency: "PKR", fx_rate: 1 },
    p_lines: [{ kind: "EXPENSE", account_id: null, quantity: 1, unit_price: null }] }), "Draft bill made");
  const rows = rec.data ?? [];
  const supOf = (id: string) => rows.find((r) => r.receipt_id === id)?.supplier_id;
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title="New supplier bill"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!sel.length} loading={fromReceipts.isPending} onClick={() => fromReceipts.mutate(undefined, { onSuccess: (id) => onCreated(id as string) })}>Bill the selected receipts</Button></>}>
      <Field label="Supplier" className="mb-3"><LookupPicker value={sup} onChange={(v) => { setSup(v); setSel([]); }} placeholder="All suppliers" spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} /></Field>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Received goods not yet billed</div>
      {rows.length === 0 ? <p className="rounded-card border border-line px-3 py-4 text-sm text-ink-muted">Nothing waiting to be billed{sup ? " for this supplier" : ""}.</p> : (
        <div className="max-h-80 overflow-y-auto rounded-card border border-line">
          {rows.map((r) => {
            const on = sel.includes(r.receipt_id);
            const other = sel.length > 0 && supOf(sel[0]) !== r.supplier_id;
            return (
              <label key={r.receipt_id} className={cn("flex cursor-pointer items-center gap-3 border-t border-line/70 px-3 py-2 text-sm first:border-t-0", other && "cursor-not-allowed opacity-40")}>
                <input type="checkbox" checked={on} disabled={other} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.receipt_id] : s.filter((x) => x !== r.receipt_id)))} />
                <span className="font-mono text-xs font-medium">{r.doc_no}</span><span>{formatDate(r.doc_date)}</span><span className="flex-1 truncate">{r.supplier_name}</span>
                {r.purchase_order_no && <span className="font-mono text-xs text-ink-muted">{r.purchase_order_no}</span>}
                <span className="text-xs text-ink-muted">{r.lines_to_bill} item(s)</span>
                <Badge tone={r.cost_status === "APPROVED" ? "success" : "warning"}>{r.cost_status === "APPROVED" ? "costed" : "cost pending"}</Badge>
              </label>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex items-center gap-3 rounded-card border border-dashed border-line p-3 text-sm">
        <span className="flex-1 text-ink-muted">A bill for services or expenses (rent, freight, repairs…) — no goods received.</span>
        <Button disabled={!sup} title={sup ? undefined : "Choose the supplier first"} loading={blank.isPending} onClick={() => blank.mutate(undefined, { onSuccess: (id) => onCreated(id as string) })}>Expense bill</Button>
      </div>
    </ErpDialog>
  );
}

interface BLine { kind: "ITEM" | "EXPENSE"; receipt_line_id?: string | null; receipt_no?: string; product_id?: string | null; variant_id?: string | null; account_id?: string | null; description: string; quantity: string; unit_price: string }

function BillDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { companyId, company, can } = useAccess();
  const c = useCan();
  const navigate = useNavigate();
  const files = useAttachments("supplier_bills", id);
  const q = useQuery({
    queryKey: ["record", "supplier_bills", id],
    queryFn: async () => {
      const [h, v, l, a] = await Promise.all([
        sb().from("supplier_bills").select("*, supplier:suppliers(name, code, city)").eq("id", id).single(),
        sb().from("supplier_bills_v").select("paid_pkr, outstanding_pkr, payment_status").eq("id", id).maybeSingle(),
        sb().from("supplier_bill_lines").select("*").eq("bill_id", id).order("line_no"),
        sb().from("supplier_bill_allocations").select("id, amount, created_at, payment_entry_id, status, entry:journal_entries(entry_no, entry_date, reference)").eq("bill_id", id).eq("status", "ACTIVE").order("created_at"),
      ]);
      if (h.error) throw h.error;
      return { h: h.data as Row, v: v.data as { paid_pkr: number; outstanding_pkr: number; payment_status: string } | null, lines: (l.data ?? []) as Row[], allocs: (a.data ?? []) as Row[] };
    },
  });
  const h = q.data?.h;
  const st = String(h?.status ?? "DRAFT");
  const draft = st === "DRAFT";
  const editable = draft && c.manage;
  const [head, setHead] = React.useState({ bill_date: today(), due_date: "", supplier_invoice_no: "", currency: "PKR", fx_rate: "1", notes: "" });
  const [lines, setLines] = React.useState<BLine[]>([]);
  const [payNow, setPayNow] = React.useState(false);
  const [pay, setPay] = React.useState({ bank: null as string | null, amount: "", date: today(), reference: "" });
  const [tab, setTab] = React.useState("lines");
  const [ask, setAsk] = React.useState<null | "post" | "reverse" | "cancel" | "pay" | "apply">(null);
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (!q.data) return;
    const x = q.data.h;
    setHead({ bill_date: x.bill_date as string, due_date: (x.due_date as string) ?? "", supplier_invoice_no: (x.supplier_invoice_no as string) ?? "", currency: x.currency as string, fx_rate: String(x.fx_rate), notes: (x.notes as string) ?? "" });
    const src = (x.status === "DRAFT" ? (x.lines_draft as Row[]) : q.data.lines) ?? [];
    setLines(src.map((l) => ({ kind: l.kind as "ITEM" | "EXPENSE", receipt_line_id: (l.receipt_line_id as string) ?? null, receipt_no: (l.receipt_no as string) ?? "", product_id: (l.product_id as string) ?? null,
      variant_id: (l.variant_id as string) ?? null, account_id: (l.account_id as string) ?? null, description: (l.description as string) ?? "",
      quantity: String(Number(l.quantity)), unit_price: l.unit_price == null ? "" : String(Number(l.unit_price)) })));
  }, [q.data]);
  const info = useItemInfo(lines.map((l) => l.product_id), lines.map((l) => l.variant_id));
  const fx = num(head.fx_rate) || 1;
  const total = lines.reduce((s, l) => s + Math.round((num(l.quantity) || 0) * (num(l.unit_price) || 0) * 100) / 100, 0);
  const missing = lines.filter((l) => !l.unit_price.trim()).length;
  const setLine = (i: number, p: Partial<BLine>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const payload = () => lines.map((l) => ({ kind: l.kind, receipt_line_id: l.receipt_line_id, account_id: l.account_id, description: l.description || null, quantity: num(l.quantity), unit_price: l.unit_price.trim() ? num(l.unit_price) : null }));
  const save = useAction(() => rpc("save_supplier_bill", { p_id: id, p_header: { company_id: companyId, supplier_id: h?.supplier_id, ...head, fx_rate: fx }, p_lines: payload() }), "Saved");
  const post = useAction(async () => {
    await rpc("save_supplier_bill", { p_id: id, p_header: { company_id: companyId, supplier_id: h?.supplier_id, ...head, fx_rate: fx }, p_lines: payload() });
    await rpc("post_supplier_bill", { p_id: id, p_pay: payNow ? { bank_account_id: pay.bank, amount: num(pay.amount), date: pay.date, reference: pay.reference || null } : null });
  }, payNow ? "Bill posted and paid" : "Bill posted — the amount is on the supplier's account", () => setAsk(null));
  const reverse = useAction(() => rpc("reverse_supplier_bill", { p_id: id, p_reason: reason }), "Bill reversed", () => { setAsk(null); setReason(""); });
  const cancel = useAction(() => rpc("cancel_supplier_bill", { p_id: id }), "Draft cancelled", () => { setAsk(null); onClose(); });
  const unalloc = useAction((aid: string) => rpc("remove_supplier_allocation", { p_id: aid }), "Payment unlinked from this bill");
  const outstanding = q.data?.v?.outstanding_pkr ?? 0;
  const sup = h?.supplier as { name: string; code: string; city: string | null } | undefined;
  const print = () => {
    if (!h) return;
    printDocument({ company: company?.company_name ?? "", title: "Supplier Bill", docNo: String(h.doc_no),
      meta: [["Supplier", sup?.name ?? ""], ["Bill date", formatDate(h.bill_date as string)], ["Supplier invoice", String(h.supplier_invoice_no ?? "")], ["Currency", `${h.currency}${h.currency !== "PKR" ? ` @ ${h.fx_rate}` : ""}`]],
      columns: [{ label: "#" }, { label: "Item / expense" }, { label: "Qty", align: "right" }, { label: "Price", align: "right" }, { label: "Amount", align: "right" }],
      rows: lines.map((l, i) => [String(i + 1), l.kind === "ITEM" ? `${info.data?.products.get(l.product_id ?? "")?.name ?? ""}${l.receipt_no ? ` (${l.receipt_no})` : ""}` : l.description, l.quantity, money(num(l.unit_price)), money(num(l.quantity) * num(l.unit_price))]),
      totals: [["Total " + String(h.currency), money(total)], ...(h.currency !== "PKR" ? [["PKR", money(total * fx)] as [string, string]] : [])], signatures: ["Checked by", "Approved by"] });
  };
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="bill" icon={icon} title={h ? String(h.doc_no) : "Bill"} subtitle={sup ? `${sup.name}${sup.city ? ` · ${sup.city}` : ""}` : undefined}
        status={h ? (st === "POSTED" ? <Badge tone={PAY_TONE[q.data?.v?.payment_status ?? "UNPAID"]}>{String(q.data?.v?.payment_status ?? "").replace("_", " ").toLowerCase()}</Badge> : <Badge tone={BILL_TONE[st]}>{st.toLowerCase()}</Badge>) : null}
        footer={h && <>
          {draft && c.manage && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel draft</Button>}
          {st === "POSTED" && c.approve && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk("reverse")}>Reverse</Button>}
          <div className="flex-1" />
          {h.journal_entry_id ? <Button icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/vouchers?view=${h.journal_entry_id}`)}>Accounting entry</Button> : null}
          <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>
          <Button onClick={onClose}>Close</Button>
          {editable && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save draft</Button>}
          {draft && c.approve && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={missing > 0} title={missing ? "Enter every price first" : undefined} onClick={() => setAsk("post")}>{payNow ? "Post & pay" : "Post bill"}</Button>}
          {st === "POSTED" && outstanding > 0 && h.currency === "PKR" && c.approve && can("journals.create") && <>
            <Button icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setAsk("apply")}>Use earlier payment</Button>
            <Button variant="primary" icon={<Banknote className="h-3.5 w-3.5" />} onClick={() => setAsk("pay")}>Pay</Button></>}
        </>}>
        {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : h && (
          <>
            <FormGrid cols={4} className="mb-3">
              <Field label="Supplier's invoice no."><Input disabled={!editable} value={head.supplier_invoice_no} onChange={(e) => setHead((s) => ({ ...s, supplier_invoice_no: e.target.value }))} /></Field>
              <Field label="Bill date"><Input type="date" disabled={!editable} value={head.bill_date} onChange={(e) => setHead((s) => ({ ...s, bill_date: e.target.value }))} /></Field>
              <Field label="Due date"><Input type="date" disabled={!editable} value={head.due_date} onChange={(e) => setHead((s) => ({ ...s, due_date: e.target.value }))} /></Field>
              <Field label="Currency"><CurrencyInput currency={head.currency} rate={head.fx_rate} disabled={!editable} onCurrency={(v) => setHead((s) => ({ ...s, currency: v }))} onRate={(v) => setHead((s) => ({ ...s, fx_rate: v }))} /></Field>
            </FormGrid>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile k={`Total ${head.currency}`} v={money(total)} />
              {head.currency !== "PKR" && <Tile k="Total PKR" v={money(total * fx)} />}
              {st === "POSTED" && <Tile k="Paid" v={money(q.data?.v?.paid_pkr)} />}
              {st === "POSTED" && <Tile k="Outstanding" v={money(outstanding)} hot={outstanding > 0} />}
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Lines (${lines.length})` }, ...(st === "POSTED" ? [{ key: "pay", label: `Payments (${q.data?.allocs.length ?? 0})` }] : []),
              { key: "files", label: filesLabel(files.data?.length) }, { key: "history", label: "History" }]} />
            {tab === "lines" && (
              <>
                <div className="overflow-x-auto rounded-card border border-line">
                  <table className="w-full text-sm">
                    <thead className="bg-subtle"><tr><th className={cn(th, "w-8")}>#</th><th className={th}>Item / expense</th><th className={cn(th, "w-28 text-right")}>Qty</th><th className={cn(th, "w-36 text-right")}>Price ({head.currency})</th><th className={cn(th, "w-36 text-right")}>Amount</th><th className={cn(th, "w-10")} /></tr></thead>
                    <tbody>{lines.map((l, i) => {
                      const it = info.data?.products.get(l.product_id ?? "");
                      return (
                        <tr key={i} className="align-top">
                          <td className={cn(td, "pt-3 text-ink-muted")}>{i + 1}</td>
                          <td className={td}>{l.kind === "ITEM"
                            ? <div className="pt-1"><div className="font-medium">{it?.name}{l.variant_id && <span className="font-normal text-ink-muted"> · {info.data?.variants.get(l.variant_id)}</span>}</div>
                                <div className="text-2xs text-ink-muted">{it?.sku}{l.receipt_no ? ` · received on ${l.receipt_no}` : ""}</div></div>
                            : editable ? <div className="grid gap-1.5 sm:grid-cols-2"><AccountPicker value={l.account_id ?? null} onChange={(v) => setLine(i, { account_id: v })} placeholder="Expense account…" />
                                <Input value={l.description} placeholder="What for" onChange={(e) => setLine(i, { description: e.target.value })} /></div>
                              : <div className="pt-1">{l.description}</div>}</td>
                          <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                            {l.kind === "ITEM" && <div className="mt-0.5 text-right text-2xs text-ink-muted">{it?.uom}</div>}</td>
                          <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} placeholder="Price" value={l.unit_price} invalid={draft && !l.unit_price.trim()} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>
                          <td className={cn(td, "pt-3 text-right tabular-nums")}>{l.unit_price.trim() ? money((num(l.quantity) || 0) * num(l.unit_price)) : <Badge tone="warning">Pending</Badge>}</td>
                          <td className={td}>{editable && lines.length > 1 && <Button size="icon-sm" variant="destructive-ghost" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  {editable && <div className="border-t border-line px-2 py-2"><Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((s) => [...s, { kind: "EXPENSE", description: "", quantity: "1", unit_price: "" }])}>Add expense line</Button>
                    <span className="ml-2 text-xs text-ink-muted">e.g. freight or loading charged on the same invoice</span></div>}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Field label="Notes"><Textarea rows={2} disabled={!editable} value={head.notes} onChange={(e) => setHead((s) => ({ ...s, notes: e.target.value }))} /></Field>
                  {draft && c.approve && can("journals.create") && (
                    <div className={cn("rounded-card border p-3", payNow ? "border-primary" : "border-line")}>
                      <Checkbox checked={payNow} disabled={head.currency !== "PKR"} onChange={(v) => { setPayNow(v); if (v && !pay.amount) setPay((s) => ({ ...s, amount: String(total) })); }}
                        label="Pay Supplier Now" description={head.currency !== "PKR" ? "For PKR bills — foreign-currency payments come with multi-currency settlement." : "Records the payment with the bill. Paying more than the bill keeps the extra as an advance to the supplier."} />
                      {payNow && (
                        <FormGrid cols={2} className="mt-2">
                          <Field label="Paid from" required className="sm:col-span-2"><BankPicker value={pay.bank} onChange={(v) => setPay((s) => ({ ...s, bank: v }))} /></Field>
                          <Field label="Amount" required><Input className="text-right tabular-nums" inputMode="decimal" value={pay.amount} onChange={(e) => setPay((s) => ({ ...s, amount: e.target.value }))} /></Field>
                          <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay((s) => ({ ...s, date: e.target.value }))} /></Field>
                          <Field label="Reference / cheque no." className="sm:col-span-2"><Input value={pay.reference} onChange={(e) => setPay((s) => ({ ...s, reference: e.target.value }))} /></Field>
                          {num(pay.amount) > total && <p className="text-xs text-warning sm:col-span-2">PKR {money(num(pay.amount) - total)} more than the bill — kept as an advance to this supplier.</p>}
                        </FormGrid>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            {tab === "pay" && (
              <div className="space-y-1.5">
                {(q.data?.allocs ?? []).length === 0 ? <p className="text-sm text-ink-muted">No payments yet.</p> : (q.data?.allocs ?? []).map((a) => {
                  const e = a.entry as { entry_no: string; entry_date: string; reference: string | null } | null;
                  return (
                    <div key={a.id} className="flex items-center gap-3 rounded-card border border-line px-3 py-2 text-sm">
                      <span className="w-24 text-xs">{formatDate(e?.entry_date)}</span>
                      <button className="font-mono text-xs text-primary hover:underline" onClick={() => navigate(`/vouchers?view=${a.payment_entry_id}`)}>{e?.entry_no}</button>
                      <span className="text-xs text-ink-muted">{e?.reference}</span>
                      <span className="ml-auto font-medium tabular-nums">{money(a.amount as number)}</span>
                      {c.approve && <Button size="icon-sm" variant="ghost" title="Unlink from this bill (the payment stays as an advance)" onClick={() => unalloc.mutate(a.id)}><X className="h-3.5 w-3.5" /></Button>}
                    </div>
                  );
                })}
              </div>
            )}
            {tab === "files" && <AttachmentsPanel entityType="supplier_bills" entityId={id} />}
            {tab === "history" && <AuditTimeline table="supplier_bills" id={id} />}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask === "post"} title="Post this bill?" confirmLabel={payNow ? "Post & pay" : "Post"} loading={post.isPending} onCancel={() => setAsk(null)} onConfirm={() => post.mutate(undefined)}
        message={`PKR ${money(total * fx)} goes on ${sup?.name ?? "the supplier"}'s account. Received goods: clears “goods received not billed”; any price difference adjusts stock value; receipts without a cost are costed from this bill.${payNow ? ` PKR ${money(num(pay.amount))} is paid now.` : ""}`} />
      <ConfirmDialog open={ask === "reverse"} title="Reverse this bill?" tone="destructive" confirmLabel="Reverse" loading={reverse.isPending} onCancel={() => setAsk(null)} onConfirm={() => reverse.mutate(undefined)}
        message="Its accounting entry is reversed and the receipts can be billed again. Unlink any payments first.">
        <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "cancel"} title="Cancel this draft?" tone="destructive" confirmLabel="Cancel draft" loading={cancel.isPending} onCancel={() => setAsk(null)} onConfirm={() => cancel.mutate(undefined)} message="The receipts become available to bill again." />
      {ask === "pay" && h && <PayBillDialog bill={h} outstanding={outstanding} onClose={() => setAsk(null)} />}
      {ask === "apply" && h && <ApplyPaymentDialog bill={h} outstanding={outstanding} onClose={() => setAsk(null)} />}
    </>
  );
}

function Tile({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return <div className={cn("rounded-card border border-line px-3 py-2", hot && "border-red-200 bg-red-50/60")}><div className="text-2xs uppercase tracking-wide text-ink-muted">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>;
}

function PayBillDialog({ bill, outstanding, onClose }: { bill: Row; outstanding: number; onClose: () => void }) {
  const { companyId } = useAccess();
  const [bank, setBank] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState(String(outstanding));
  const [date, setDate] = React.useState(today());
  const [ref, setRef] = React.useState("");
  const go = useAction(() => rpc("pay_supplier_bills", { p_company_id: companyId, p_supplier_id: bill.supplier_id, p_bank_account_id: bank, p_amount: num(amount), p_date: date, p_reference: ref || null,
    p_bills: [{ bill_id: bill.id, amount: Math.min(num(amount), outstanding) }] }), "Payment recorded", onClose);
  return (
    <ConfirmDialog open title={`Pay ${bill.doc_no}`} confirmLabel="Pay" loading={go.isPending} onCancel={onClose} onConfirm={() => go.mutate(undefined)}
      message={`Outstanding PKR ${money(outstanding)}. Pay part or all; anything above the bill is kept as an advance to the supplier.`}>
      <FormGrid cols={2} className="mt-3">
        <Field label="Paid from" required className="sm:col-span-2"><BankPicker value={bank} onChange={setBank} /></Field>
        <Field label="Amount" required><Input className="text-right tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reference / cheque no." className="sm:col-span-2"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </FormGrid>
    </ConfirmDialog>
  );
}

function ApplyPaymentDialog({ bill, outstanding, onClose }: { bill: Row; outstanding: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ["supplier-open-payments", bill.supplier_id], queryFn: async () => (await rpc<{ entry_id: string; entry_no: string; entry_date: string; amount: number; unallocated: number; reference: string | null }[]>("supplier_open_payments", { p_supplier_id: bill.supplier_id })) ?? [] });
  const [amt, setAmt] = React.useState<Record<string, string>>({});
  const go = useAction(async () => {
    for (const p of q.data ?? []) {
      const v = num(amt[p.entry_id] ?? "0");
      if (v > 0) await rpc("allocate_supplier_payment", { p_entry_id: p.entry_id, p_allocations: [{ bill_id: bill.id, amount: v }] });
    }
  }, "Payment applied to the bill", onClose);
  const sum = Object.values(amt).reduce((s, v) => s + (num(v) || 0), 0);
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<Link2 className="h-4 w-4" />} title={`Use an earlier payment — ${bill.doc_no}`}
      footer={<><span className="text-sm text-ink-muted">Applying PKR {money(sum)} of {money(outstanding)}</span><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={sum <= 0 || sum > outstanding} loading={go.isPending} onClick={() => go.mutate(undefined)}>Apply</Button></>}>
      {(q.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">No unallocated payments or advances for this supplier.</p> : (
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Voucher</th><th className={th}>Date</th><th className={cn(th, "text-right")}>Free</th><th className={cn(th, "w-32 text-right")}>Apply</th></tr></thead>
          <tbody>{(q.data ?? []).map((p) => (
            <tr key={p.entry_id}><td className={cn(td, "font-mono text-xs")}>{p.entry_no}<div className="font-sans text-2xs text-ink-muted">{p.reference}</div></td><td className={cn(td, "text-xs")}>{formatDate(p.entry_date)}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(p.unallocated)}</td>
              <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={amt[p.entry_id] ?? ""} placeholder={String(Math.min(p.unallocated, outstanding))}
                onChange={(e) => setAmt((s) => ({ ...s, [p.entry_id]: e.target.value }))} /></td></tr>))}</tbody>
        </table>
      )}
    </ErpDialog>
  );
}

