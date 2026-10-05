import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban, Banknote, CheckCircle2, FileText, Link2, Plus, Printer, Receipt, RotateCcw, Save, ShieldAlert, Trash2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { LookupPicker, ProductPicker, VariantPicker, WarehousePicker, useProductMeta } from "../inventory/pickers";
import { AccountPicker, BankPicker, money, num, today } from "../accounting/common";
import { printDocument } from "../sales/print";
import { DiscountField } from "../sales/common";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { BILL_TONE, CurrencyInput, rpc, useAction, useCan, useItemInfo, useSupplierName } from "./common";
import { ApplyEarlierFxDialog, FxPayDialog } from "../fx/FxPaymentsPage";
import { FxDiff, PaySourceFields, emptySource, rateText, sourcePayload, type PaySource } from "../fx/common";

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
  const [quick, setQuick] = React.useState(params.get("quick") === "1");
  const flt = FILTERS[f];
  const list = useEntityList<Row>({
    table: "supplier_bills_v", select: "id, doc_no, bill_date, due_date, supplier_name, supplier_invoice_no, currency, total_amount, total_pkr, paid_pkr, outstanding_pkr, outstanding_fx, payment_status, status, discount_amount, is_quick",
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
        actions={<>
          {c.approve && c.receive && <Button icon={<Zap className="h-4 w-4" />} title="Goods arrived with the supplier's invoice — receive and bill in one step" onClick={() => setQuick(true)}>Quick bill</Button>}
          {c.manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setPicking(true)}>New bill</Button>}
        </>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search bill / supplier / invoice no…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
          {flt.unpaid && <span className="ml-auto text-sm text-ink-muted">Owed: <b className="tabular-nums text-ink">PKR {money(due)}</b></span>}
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id })} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "d", header: "Bill", width: "120px", cell: (r) => <span className="font-mono text-xs font-medium">{String(r.doc_no)}{r.is_quick ? <span className="ml-1 font-sans text-2xs text-ink-muted">quick</span> : null}</span> },
              { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.bill_date as string) },
              { key: "s", header: "Supplier", cell: (r) => <span>{String(r.supplier_name)}{r.supplier_invoice_no ? <span className="text-xs text-ink-muted"> · {String(r.supplier_invoice_no)}</span> : null}</span> },
              { key: "t", header: "Amount", width: "150px", align: "right", cell: (r) => <span className="tabular-nums">{r.currency !== "PKR" && <span className="text-2xs text-ink-muted">{String(r.currency)} {money(r.total_amount as number)} = </span>}{money(r.total_pkr as number)}</span> },
              { key: "o", header: "Outstanding", width: "140px", align: "right", cell: (r) => r.status !== "POSTED" ? null : r.currency !== "PKR"
                ? <span className={cn("font-medium tabular-nums", Number(r.outstanding_fx) > 0 && "text-danger")}>{String(r.currency)} {money(r.outstanding_fx as number)}{Number(r.outstanding_fx) > 0 && <div className="text-2xs font-normal text-ink-muted">PKR {money(r.outstanding_pkr as number)} at bill rate</div>}</span>
                : <span className={cn("font-medium tabular-nums", Number(r.outstanding_pkr) > 0 && "text-danger")}>{money(r.outstanding_pkr as number)}</span> },
              { key: "due", header: "Due", width: "100px", hideBelow: "lg", cell: (r) => (r.due_date ? formatDate(r.due_date as string) : null) },
              { key: "st", header: "Status", width: "130px", cell: (r) => r.status === "POSTED" ? <Badge tone={PAY_TONE[String(r.payment_status)]}>{String(r.payment_status).replace("_", " ").toLowerCase()}</Badge> : <Badge tone={BILL_TONE[String(r.status)]}>{String(r.status).toLowerCase()}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No bills" description="Make one from received goods or for an expense." />} />
        )}
      </Card>
      {picking && <NewBillDialog onClose={() => setPicking(false)} onCreated={(id) => { setPicking(false); update({ view: id }); }} />}
      {quick && <QuickBillDialog onClose={() => { setQuick(false); if (params.get("quick")) update({ quick: null }); }} onPosted={(id) => { setQuick(false); update({ quick: null, view: id }); }} />}
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
        sb().from("supplier_bills_v").select("paid_pkr, outstanding_pkr, payment_status, paid_fx, outstanding_fx, fx_diff, paid_actual_pkr").eq("id", id).maybeSingle(),
        sb().from("supplier_bill_lines").select("*").eq("bill_id", id).order("line_no"),
        sb().from("supplier_bill_allocations").select("id, amount, created_at, payment_entry_id, status, entry:journal_entries(entry_no, entry_date, reference)").eq("bill_id", id).eq("status", "ACTIVE").order("created_at"),
      ]);
      if (h.error) throw h.error;
      return { h: h.data as Row, v: v.data as { paid_pkr: number; outstanding_pkr: number; payment_status: string; paid_fx: number; outstanding_fx: number; fx_diff: number; paid_actual_pkr: number } | null, lines: (l.data ?? []) as Row[], allocs: (a.data ?? []) as Row[] };
    },
  });
  const h = q.data?.h;
  const st = String(h?.status ?? "DRAFT");
  const draft = st === "DRAFT";
  const editable = draft && c.manage;
  const [head, setHead] = React.useState({ bill_date: today(), due_date: "", supplier_invoice_no: "", currency: "PKR", fx_rate: "1", notes: "", discount_amount: "" });
  const [lines, setLines] = React.useState<BLine[]>([]);
  const [payNow, setPayNow] = React.useState(false);
  const [pay, setPay] = React.useState({ bank: null as string | null, amount: "", date: today(), reference: "", rate: "" });
  const [paySrc, setPaySrc] = React.useState<PaySource>(emptySource());
  const [tab, setTab] = React.useState("lines");
  const [ask, setAsk] = React.useState<null | "post" | "reverse" | "cancel" | "pay" | "apply">(null);
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (!q.data) return;
    const x = q.data.h;
    setHead({ bill_date: x.bill_date as string, due_date: (x.due_date as string) ?? "", supplier_invoice_no: (x.supplier_invoice_no as string) ?? "", currency: x.currency as string, fx_rate: String(x.fx_rate), notes: (x.notes as string) ?? "", discount_amount: Number(x.discount_amount) ? String(Number(x.discount_amount)) : "" });
    const src = (x.status === "DRAFT" ? (x.lines_draft as Row[]) : q.data.lines) ?? [];
    setLines(src.map((l) => ({ kind: l.kind as "ITEM" | "EXPENSE", receipt_line_id: (l.receipt_line_id as string) ?? null, receipt_no: (l.receipt_no as string) ?? "", product_id: (l.product_id as string) ?? null,
      variant_id: (l.variant_id as string) ?? null, account_id: (l.account_id as string) ?? null, description: (l.description as string) ?? "",
      quantity: String(Number(l.quantity)), unit_price: l.unit_price == null ? "" : String(Number(l.unit_price)) })));
  }, [q.data]);
  const info = useItemInfo(lines.map((l) => l.product_id), lines.map((l) => l.variant_id));
  const fx = num(head.fx_rate) || 1;
  const gross = lines.reduce((s, l) => s + Math.round((num(l.quantity) || 0) * (num(l.unit_price) || 0) * 100) / 100, 0);
  const disc = num(head.discount_amount) || 0;
  const total = gross - disc;
  const missing = lines.filter((l) => !l.unit_price.trim()).length;
  const setLine = (i: number, p: Partial<BLine>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const payload = () => lines.map((l) => ({ kind: l.kind, receipt_line_id: l.receipt_line_id, account_id: l.account_id, description: l.description || null, quantity: num(l.quantity), unit_price: l.unit_price.trim() ? num(l.unit_price) : null }));
  const save = useAction(() => rpc("save_supplier_bill", { p_id: id, p_header: { company_id: companyId, supplier_id: h?.supplier_id, ...head, fx_rate: fx, discount_amount: disc }, p_lines: payload() }), "Saved");
  const post = useAction(async () => {
    await rpc("save_supplier_bill", { p_id: id, p_header: { company_id: companyId, supplier_id: h?.supplier_id, ...head, fx_rate: fx, discount_amount: disc }, p_lines: payload() });
    await rpc("post_supplier_bill", { p_id: id, p_pay: !payNow ? null : head.currency === "PKR"
      ? { bank_account_id: pay.bank, amount: num(pay.amount), date: pay.date, reference: pay.reference || null }
      : { amount: num(pay.amount), fx_rate: num(pay.rate), date: pay.date, reference: pay.reference || null, source: sourcePayload(paySrc) } });
  }, payNow ? "Bill posted and paid" : "Bill posted — the amount is on the supplier's account", () => setAsk(null));
  const reverse = useAction(() => rpc("reverse_supplier_bill", { p_id: id, p_reason: reason }), "Bill reversed", () => { setAsk(null); setReason(""); });
  const cancel = useAction(() => rpc("cancel_supplier_bill", { p_id: id }), "Draft cancelled", () => { setAsk(null); onClose(); });
  const unalloc = useAction((aid: string) => rpc("remove_supplier_allocation", { p_id: aid }), "Payment unlinked from this bill");
  const linkShip = useAction((v: string | null) => rpc("set_bill_shipment", { p_bill_id: id, p_shipment_id: v }), (v) => (v ? "Linked to the shipment" : "Shipment link removed"));
  const foreign = String(h?.currency ?? "PKR") !== "PKR";
  const outstanding = q.data?.v?.outstanding_pkr ?? 0;
  const outstandingFx = q.data?.v?.outstanding_fx ?? 0;
  const owes = foreign ? outstandingFx : outstanding;
  const sup = h?.supplier as { name: string; code: string; city: string | null } | undefined;
  const print = () => {
    if (!h) return;
    printDocument({ company: company?.company_name ?? "", title: "Supplier Bill", docNo: String(h.doc_no),
      meta: [["Supplier", sup?.name ?? ""], ["Bill date", formatDate(h.bill_date as string)], ["Supplier invoice", String(h.supplier_invoice_no ?? "")], ["Currency", `${h.currency}${h.currency !== "PKR" ? ` @ ${h.fx_rate}` : ""}`]],
      columns: [{ label: "#" }, { label: "Item / expense" }, { label: "Qty", align: "right" }, { label: "Price", align: "right" }, { label: "Amount", align: "right" }],
      rows: lines.map((l, i) => [String(i + 1), l.kind === "ITEM" ? `${info.data?.products.get(l.product_id ?? "")?.name ?? ""}${l.receipt_no ? ` (${l.receipt_no})` : ""}` : l.description, l.quantity, money(num(l.unit_price)), money(num(l.quantity) * num(l.unit_price))]),
      totals: [...(disc ? [["Subtotal", money(gross)], ["Discount", `-${money(disc)}`]] as [string, string][] : []), ["Total " + String(h.currency), money(total)], ...(h.currency !== "PKR" ? [["PKR", money(total * fx)] as [string, string]] : [])], signatures: ["Checked by", "Approved by"] });
  };
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="bill" icon={icon} title={h ? String(h.doc_no) : "Bill"} subtitle={sup ? `${sup.name}${sup.city ? ` · ${sup.city}` : ""}` : undefined}
        status={h ? <>{h.is_quick ? <Badge tone="neutral" className="mr-1">Quick</Badge> : null}{st === "POSTED" ? <Badge tone={PAY_TONE[q.data?.v?.payment_status ?? "UNPAID"]}>{String(q.data?.v?.payment_status ?? "").replace("_", " ").toLowerCase()}</Badge> : <Badge tone={BILL_TONE[st]}>{st.toLowerCase()}</Badge>}</> : null}
        footer={h && <>
          {draft && c.manage && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel draft</Button>}
          {st === "POSTED" && c.approve && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk("reverse")}>Reverse</Button>}
          <div className="flex-1" />
          {h.journal_entry_id ? <Button icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/vouchers?view=${h.journal_entry_id}`)}>Accounting entry</Button> : null}
          <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>
          <Button onClick={onClose}>Close</Button>
          {editable && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save draft</Button>}
          {draft && c.approve && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={missing > 0} title={missing ? "Enter every price first" : undefined} onClick={() => setAsk("post")}>{payNow ? "Post & pay" : "Post bill"}</Button>}
          {st === "POSTED" && owes > 0 && c.approve && can("journals.create") && <>
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
              <Field label="For shipment" hint="Import charges (lines on Landed Cost Clearing) wait for this shipment's landed cost">
                <LookupPicker value={(h.shipment_id as string) ?? null} disabled={!c.manage || st === "REVERSED" || st === "CANCELLED"} placeholder="(not an import cost)" spec={{ table: "shipments", label: "doc_no", secondary: "bl_no" }}
                  onChange={(v) => linkShip.mutate(v)} />
              </Field>
            </FormGrid>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {(disc > 0 || editable) && <div className="rounded-card border border-line px-3 py-2"><div className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Discount ({head.currency})</div>
                {editable ? <DiscountField className="mt-1" base={gross} value={head.discount_amount} onChange={(v) => setHead((s) => ({ ...s, discount_amount: v }))} />
                  : <div className="text-lg font-semibold tabular-nums">{money(disc)}</div>}</div>}
              <Tile k={`Total ${head.currency}${disc ? " (after discount)" : ""}`} v={money(total)} />
              {head.currency !== "PKR" && <Tile k="Total PKR" v={money(total * fx)} />}
              {st === "POSTED" && !foreign && <Tile k="Paid" v={money(q.data?.v?.paid_pkr)} />}
              {st === "POSTED" && !foreign && <Tile k="Outstanding" v={money(outstanding)} hot={outstanding > 0} />}
              {st === "POSTED" && foreign && <Tile k={`Paid ${head.currency}`} v={money(q.data?.v?.paid_fx)} />}
              {st === "POSTED" && foreign && <Tile k={`Outstanding ${head.currency}`} v={money(outstandingFx)} hot={outstandingFx > 0} />}
              {st === "POSTED" && foreign && Number(q.data?.v?.paid_fx) > 0 && <div className="rounded-card border border-line px-3 py-2"><div className="text-2xs uppercase tracking-wide text-ink-muted">Exchange difference</div>
                <div className="text-lg font-semibold"><FxDiff v={q.data?.v?.fx_diff} /></div><div className="text-2xs text-ink-muted">actually paid PKR {money(q.data?.v?.paid_actual_pkr)}</div></div>}
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
                      <Checkbox checked={payNow} onChange={(v) => { setPayNow(v); if (v && !pay.amount) setPay((s) => ({ ...s, amount: String(total) })); }}
                        label="Pay Supplier Now" description={head.currency !== "PKR" ? `Pay in ${head.currency} at this payment's own rate — the difference from the bill rate is booked as exchange gain / loss.` : "Records the payment with the bill. Paying more than the bill keeps the extra as an advance to the supplier."} />
                      {payNow && head.currency !== "PKR" && (
                        <FormGrid cols={2} className="mt-2">
                          <Field label="Paid from" required className="sm:col-span-2"><PaySourceFields value={paySrc} onChange={setPaySrc} currency={head.currency} fxAmount={num(pay.amount) || 0} rate={num(pay.rate) || 0} /></Field>
                          <Field label={`Amount (${head.currency})`} required><Input className="text-right tabular-nums" inputMode="decimal" value={pay.amount} onChange={(e) => setPay((s) => ({ ...s, amount: e.target.value }))} /></Field>
                          <Field label={`Payment rate (PKR per 1 ${head.currency})`} required hint={`Bill rate ${head.fx_rate}`}><Input className="text-right tabular-nums" inputMode="decimal" value={pay.rate} onChange={(e) => setPay((s) => ({ ...s, rate: e.target.value }))} /></Field>
                          <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay((s) => ({ ...s, date: e.target.value }))} /></Field>
                          <Field label="Reference"><Input value={pay.reference} onChange={(e) => setPay((s) => ({ ...s, reference: e.target.value }))} /></Field>
                          {num(pay.amount) > 0 && num(pay.rate) > 0 && <p className="text-xs text-ink-muted sm:col-span-2">PKR cost {money(num(pay.amount) * num(pay.rate))} · <FxDiff v={Math.min(num(pay.amount), total) * (num(pay.rate) - fx)} /></p>}
                        </FormGrid>
                      )}
                      {payNow && head.currency === "PKR" && (
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
            {tab === "pay" && <BillSettlements billId={id} currency={String(h.currency)} canUnlink={c.approve} onUnlink={(aid) => unalloc.mutate(aid)} />}
            {tab === "files" && <AttachmentsPanel entityType="supplier_bills" entityId={id} />}
            {tab === "history" && <AuditTimeline table="supplier_bills" id={id} />}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask === "post"} title="Post this bill?" confirmLabel={payNow ? "Post & pay" : "Post"} loading={post.isPending} onCancel={() => setAsk(null)} onConfirm={() => post.mutate(undefined)}
        message={`${head.currency !== "PKR" ? `${head.currency} ${money(total)} @ ${fx} = ` : ""}PKR ${money(total * fx)} goes on ${sup?.name ?? "the supplier"}'s account. Received goods: clears “goods received not billed”; any price difference adjusts stock value; receipts without a cost are costed from this bill.${payNow ? ` ${head.currency} ${money(num(pay.amount))} is paid now.` : ""}`} />
      <ConfirmDialog open={ask === "reverse"} title="Reverse this bill?" tone="destructive" confirmLabel="Reverse" loading={reverse.isPending} onCancel={() => setAsk(null)} onConfirm={() => reverse.mutate(undefined)}
        message="Its accounting entry is reversed and the receipts can be billed again. Unlink any payments first.">
        <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "cancel"} title="Cancel this draft?" tone="destructive" confirmLabel="Cancel draft" loading={cancel.isPending} onCancel={() => setAsk(null)} onConfirm={() => cancel.mutate(undefined)} message="The receipts become available to bill again." />
      {ask === "pay" && h && !foreign && <PayBillDialog bill={h} outstanding={outstanding} onClose={() => setAsk(null)} />}
      {ask === "apply" && h && !foreign && <ApplyPaymentDialog bill={h} outstanding={outstanding} onClose={() => setAsk(null)} />}
      {ask === "pay" && h && foreign && <FxPayDialog supplierId={String(h.supplier_id)} currency={String(h.currency)} billId={id} amount={outstandingFx} onClose={() => setAsk(null)} onDone={() => setAsk(null)} />}
      {ask === "apply" && h && foreign && <ApplyEarlierFxDialog bill={h} outstanding={outstandingFx} onClose={() => setAsk(null)} />}
    </>
  );
}

interface Settlement { allocation_id: string; settle_date: string; payment_no: string; payment_entry_id: string; fx_payment_id: string | null; paid_via: string | null; fx_amount: number; bill_rate: number; pay_rate: number; carrying_pkr: number; actual_pkr: number; fx_diff: number }
function BillSettlements({ billId, currency, canUnlink, onUnlink }: { billId: string; currency: string; canUnlink: boolean; onUnlink: (id: string) => void }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["bill-settlements", billId], queryFn: async () => (await rpc<Settlement[]>("bill_settlements", { p_bill_id: billId })) ?? [] });
  const rows = q.data ?? [];
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (!rows.length) return <p className="text-sm text-ink-muted">No payments yet.</p>;
  const foreign = currency !== "PKR";
  const sfx = rows.reduce((s, r) => s + Number(r.fx_amount), 0), spk = rows.reduce((s, r) => s + Number(r.actual_pkr), 0), sd = rows.reduce((s, r) => s + Number(r.fx_diff), 0);
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-sm">
        <thead className="bg-subtle"><tr><th className={th}>Date</th><th className={th}>Payment</th><th className={th}>Paid via</th><th className={cn(th, "text-right")}>{currency}</th>
          {foreign && <><th className={cn(th, "text-right")}>Rate paid</th><th className={cn(th, "text-right")}>At bill rate</th></>}<th className={cn(th, "text-right")}>PKR paid</th>{foreign && <th className={cn(th, "text-right")}>FX</th>}<th className={cn(th, "w-10")} /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.allocation_id}>
              <td className={cn(td, "text-xs")}>{formatDate(r.settle_date)}</td>
              <td className={cn(td, "font-mono text-xs")}><button className="text-primary hover:underline" onClick={() => navigate(r.fx_payment_id ? `/fx-payments?view=${r.fx_payment_id}` : `/vouchers?view=${r.payment_entry_id}`)}>{r.payment_no}</button></td>
              <td className={cn(td, "text-xs")}>{r.paid_via}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(r.fx_amount)}</td>
              {foreign && <><td className={cn(td, "text-right tabular-nums")}>{rateText(r.pay_rate)}</td><td className={cn(td, "text-right tabular-nums text-ink-muted")}>{money(r.carrying_pkr)}</td></>}
              <td className={cn(td, "text-right tabular-nums")}>{money(r.actual_pkr)}</td>
              {foreign && <td className={cn(td, "text-right")}><FxDiff v={r.fx_diff} /></td>}
              <td className={td}>{canUnlink && <Button size="icon-sm" variant="ghost" title={foreign ? "Unlink (the exchange difference is reversed; the payment stays as an advance)" : "Unlink from this bill (the payment stays as an advance)"} onClick={() => onUnlink(r.allocation_id)}><X className="h-3.5 w-3.5" /></Button>}</td>
            </tr>
          ))}
          <tr className="bg-subtle/60 font-semibold"><td className={td} colSpan={3}>Total{foreign && sfx > 0 ? <span className="ml-2 text-2xs font-normal text-ink-muted">average rate {rateText(spk / sfx)} (report only)</span> : null}</td>
            <td className={cn(td, "text-right tabular-nums")}>{money(sfx)}</td>{foreign && <><td className={td} /><td className={td} /></>}<td className={cn(td, "text-right tabular-nums")}>{money(spk)}</td>{foreign && <td className={cn(td, "text-right")}><FxDiff v={sd} /></td>}<td className={td} /></tr>
        </tbody>
      </table>
    </div>
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


/* ---------------------------------------------------------------- quick bill (goods arrive with the invoice) */
interface QBLine { key: string; kind: "ITEM" | "EXPENSE"; product_id: string | null; variant_id: string | null; warehouse_id: string | null; account_id: string | null; qty: string; price: string; desc: string }
const newQB = (kind: "ITEM" | "EXPENSE", wh: string | null = null): QBLine => ({ key: crypto.randomUUID(), kind, product_id: null, variant_id: null, warehouse_id: wh, account_id: null, qty: kind === "EXPENSE" ? "1" : "", price: "", desc: "" });

export function QuickBillDialog({ onClose, onPosted }: { onClose: () => void; onPosted: (id: string) => void }) {
  const { companyId, can } = useAccess();
  const idem = React.useRef(crypto.randomUUID());
  const [sup, setSup] = React.useState<string | null>(null);
  const supInfo = useSupplierName(sup);
  const [head, setHead] = React.useState({ supplier_invoice_no: "", bill_date: today(), due_date: "", currency: "PKR", fx_rate: "1", notes: "", discount: "" });
  const [lines, setLines] = React.useState<QBLine[]>([newQB("ITEM")]);
  const [payNow, setPayNow] = React.useState(false);
  const [pay, setPay] = React.useState({ bank: null as string | null, amount: "", date: today(), reference: "", rate: "" });
  const [paySrc, setPaySrc] = React.useState<PaySource>(emptySource());
  const [showErrors, setShowErrors] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    const cur = supInfo.data?.default_currency;
    if (cur) setHead((s) => ({ ...s, currency: cur, fx_rate: cur === "PKR" ? "1" : s.fx_rate }));
  }, [supInfo.data?.default_currency]);
  const setLine = (key: string, p: Partial<QBLine>) => setLines((s) => s.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const used = lines.filter((l) => (l.kind === "ITEM" ? !!l.product_id : !!l.account_id) || num(l.qty) > 0 || l.price.trim() !== "");
  const gross = used.reduce((s, l) => s + Math.round((num(l.qty) || 0) * (num(l.price) || 0) * 100) / 100, 0);
  const disc = num(head.discount) || 0;
  const total = gross - disc;
  const fx = head.currency === "PKR" ? 1 : num(head.fx_rate) || 0;
  const errors: Record<string, string> = {};
  if (!sup) errors.sup = "Choose the supplier";
  if (!used.length) errors.lines = "Add at least one line";
  if (head.currency !== "PKR" && !(fx > 0)) errors.fx = "Enter the exchange rate";
  for (const l of used) {
    if (l.kind === "ITEM" && !l.product_id) errors[`${l.key}.p`] = "Choose the item";
    if (l.kind === "ITEM" && !l.warehouse_id) errors[`${l.key}.w`] = "Choose the warehouse";
    if (l.kind === "EXPENSE" && !l.account_id) errors[`${l.key}.a`] = "Choose the expense account";
    if (!(num(l.qty) > 0)) errors[`${l.key}.q`] = "Enter the quantity";
    if (l.price.trim() === "" || !(num(l.price) >= 0)) errors[`${l.key}.price`] = "Enter the price";
  }
  if (disc > gross + 0.001) errors.disc = "Discount is more than the bill";
  else if (used.length && total <= 0) errors.disc = "The bill total must be more than 0";
  if (payNow && head.currency === "PKR" && (!pay.bank || !(num(pay.amount) > 0))) errors.pay = "Choose the account and the amount paid";
  if (payNow && head.currency !== "PKR" && (!(num(pay.amount) > 0) || !(num(pay.rate) > 0) || (paySrc.kind === "BANK" ? !paySrc.bank_account_id : !paySrc.agent_id))) errors.pay = "Choose where it was paid from, the amount and this payment's rate";
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const canPay = can("journals.create");

  const post = useAction(() => rpc<string>("quick_supplier_bill", {
    p_header: { company_id: companyId, supplier_id: sup, supplier_invoice_no: head.supplier_invoice_no, bill_date: head.bill_date, due_date: head.due_date || null,
      currency: head.currency, fx_rate: fx || 1, discount_amount: disc, notes: head.notes },
    p_lines: used.map((l) => ({ kind: l.kind, product_id: l.product_id, variant_id: l.variant_id, warehouse_id: l.warehouse_id, account_id: l.account_id,
      quantity: num(l.qty), unit_price: num(l.price), description: l.desc || null })),
    p_pay: !payNow ? null : head.currency === "PKR" ? { bank_account_id: pay.bank, amount: num(pay.amount), date: pay.date, reference: pay.reference || null }
      : { amount: num(pay.amount), fx_rate: num(pay.rate), date: pay.date, reference: pay.reference || null, source: sourcePayload(paySrc) },
    p_idempotency_key: idem.current,
  }), payNow ? "Goods received, bill posted and paid" : "Goods received and bill posted");
  const tryPost = () => {
    setShowErrors(true);
    const k = Object.keys(errors);
    if (k.length) { toast.error(errors[k.find((x) => !x.includes(".")) ?? k[0]] ?? "Please fix the highlighted fields"); return; }
    setConfirm(true);
  };
  const whCount = new Set(used.filter((l) => l.kind === "ITEM").map((l) => l.warehouse_id)).size;
  const lastWh = [...lines].reverse().find((l) => l.kind === "ITEM" && l.warehouse_id)?.warehouse_id ?? null;

  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="bill" icon={<Zap className="h-4 w-4" />} title="Quick supplier bill" subtitle="Receive the goods and post the bill in one step"
        footer={<>
          <div className="flex-1 text-right text-sm">Total <b className="tabular-nums">{head.currency} {money(total)}</b>{head.currency !== "PKR" && fx > 0 && <span className="ml-1 text-xs text-ink-muted">≈ PKR {money(total * fx)}</span>}</div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={post.isPending} onClick={tryPost}>{payNow ? "Receive, post & pay" : "Receive & post"}</Button>
        </>}>
        <FormGrid cols={4} className="mb-3">
          <Field label="Supplier" required error={err("sup")} className="sm:col-span-2">
            <LookupPicker value={sup} onChange={setSup} clearable={false} placeholder="Supplier…" spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} />
          </Field>
          <Field label="Supplier's invoice no."><Input value={head.supplier_invoice_no} onChange={(e) => setHead((s) => ({ ...s, supplier_invoice_no: e.target.value }))} /></Field>
          <Field label="Bill date" required><Input type="date" value={head.bill_date} onChange={(e) => setHead((s) => ({ ...s, bill_date: e.target.value }))} /></Field>
          <Field label="Due date"><Input type="date" value={head.due_date} onChange={(e) => setHead((s) => ({ ...s, due_date: e.target.value }))} /></Field>
          <Field label="Currency" error={err("fx")}><CurrencyInput currency={head.currency} rate={head.fx_rate} onCurrency={(v) => setHead((s) => ({ ...s, currency: v }))} onRate={(v) => setHead((s) => ({ ...s, fx_rate: v }))} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Input value={head.notes} onChange={(e) => setHead((s) => ({ ...s, notes: e.target.value }))} /></Field>
        </FormGrid>
        {err("lines") && <p className="mb-2 text-xs text-danger">{err("lines")}</p>}
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="bg-subtle"><tr>
              <th className={cn(th, "w-8 text-center")}>#</th><th className={th}>Item / expense</th><th className={cn(th, "w-[200px]")}>Into warehouse</th>
              <th className={cn(th, "w-[110px] text-right")}>Qty</th><th className={cn(th, "w-[140px] text-right")}>Price ({head.currency})</th><th className={cn(th, "w-[130px] text-right")}>Amount</th><th className={cn(th, "w-10")} />
            </tr></thead>
            <tbody>{lines.map((l, i) => (
              <QuickBillLine key={l.key} idx={i} line={l} supplierId={sup} currency={head.currency} err={err} onChange={(p) => setLine(l.key, p)}
                onRemove={lines.length > 1 ? () => setLines((s) => s.filter((x) => x.key !== l.key)) : undefined} />
            ))}</tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-2 py-2">
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((s) => [...s, newQB("ITEM", lastWh)])}>Add item</Button>
            <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((s) => [...s, newQB("EXPENSE")])}>Add expense line</Button>
            <span className="text-xs text-ink-muted">freight, loading etc. on the same invoice</span>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            {canPay && (
              <div className={cn("rounded-card border p-3", payNow ? "border-primary" : "border-line")}>
                <Checkbox checked={payNow} onChange={(v) => { setPayNow(v); if (v && !pay.amount && total > 0) setPay((s) => ({ ...s, amount: String(total) })); }}
                  label="Pay Supplier Now" description={head.currency !== "PKR" ? `Pay in ${head.currency} at this payment's own rate (bank or payment agent).` : "Records the payment with the bill. Paying more than the bill keeps the extra as an advance to the supplier."} />
                {payNow && head.currency !== "PKR" && (
                  <FormGrid cols={2} className="mt-2">
                    <Field label="Paid from" required className="sm:col-span-2"><PaySourceFields value={paySrc} onChange={setPaySrc} currency={head.currency} fxAmount={num(pay.amount) || 0} rate={num(pay.rate) || 0} /></Field>
                    <Field label={`Amount (${head.currency})`} required><Input className="text-right tabular-nums" inputMode="decimal" value={pay.amount} onChange={(e) => setPay((s) => ({ ...s, amount: e.target.value }))} /></Field>
                    <Field label={`Payment rate (PKR per 1 ${head.currency})`} required><Input className="text-right tabular-nums" inputMode="decimal" value={pay.rate} onChange={(e) => setPay((s) => ({ ...s, rate: e.target.value }))} /></Field>
                    <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay((s) => ({ ...s, date: e.target.value }))} /></Field>
                    <Field label="Reference"><Input value={pay.reference} onChange={(e) => setPay((s) => ({ ...s, reference: e.target.value }))} /></Field>
                  </FormGrid>
                )}
                {payNow && head.currency === "PKR" && (
                  <FormGrid cols={2} className="mt-2">
                    <Field label="Paid from" required className="sm:col-span-2"><BankPicker value={pay.bank} onChange={(v) => setPay((s) => ({ ...s, bank: v }))} /></Field>
                    <Field label="Amount" required><Input className="text-right tabular-nums" inputMode="decimal" value={pay.amount} onChange={(e) => setPay((s) => ({ ...s, amount: e.target.value }))} /></Field>
                    <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay((s) => ({ ...s, date: e.target.value }))} /></Field>
                    <Field label="Reference / cheque no." className="sm:col-span-2"><Input value={pay.reference} onChange={(e) => setPay((s) => ({ ...s, reference: e.target.value }))} /></Field>
                    {num(pay.amount) > total && <p className="text-xs text-warning sm:col-span-2">PKR {money(num(pay.amount) - total)} more than the bill — kept as an advance to this supplier.</p>}
                  </FormGrid>
                )}
                {err("pay") && <p className="mt-1 text-xs text-danger">{err("pay")}</p>}
              </div>
            )}
            <p className="mt-2 text-xs text-ink-muted">Posting makes a goods receipt for each warehouse (stock goes in now), then posts the bill — its prices, less the discount, become the stock cost.</p>
          </div>
          <dl className="space-y-1.5 self-start rounded-card bg-subtle p-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{money(gross)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Discount</dt>
              <dd><DiscountField base={gross} value={head.discount} onChange={(v) => setHead((s) => ({ ...s, discount: v }))} /></dd></div>
            <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><dt>Total {head.currency}</dt><dd className="tabular-nums">{money(total)}</dd></div>
            {head.currency !== "PKR" && fx > 0 && <div className="flex justify-between text-ink-muted"><dt>In PKR</dt><dd className="tabular-nums">{money(total * fx)}</dd></div>}
            {payNow && num(pay.amount) > 0 && <div className="flex justify-between text-ink-muted"><dt>Balance after payment</dt><dd className="tabular-nums">{money(Math.max(0, total - num(pay.amount)))}</dd></div>}
            {err("disc") && <p className="text-xs text-danger">{err("disc")}</p>}
          </dl>
        </div>
      </ErpDialog>
      <ConfirmDialog open={confirm} title="Receive goods and post the bill?" loading={post.isPending} confirmLabel={payNow ? "Receive, post & pay" : "Receive & post"}
        onCancel={() => setConfirm(false)}
        onConfirm={() => post.mutate(undefined, { onSuccess: (id) => { setConfirm(false); onPosted(id as string); }, onError: () => { setConfirm(false); idem.current = crypto.randomUUID(); } })}
        message={`${whCount ? `Stock goes into ${whCount} warehouse${whCount > 1 ? "s" : ""} now. ` : ""}PKR ${money(total * (fx || 1))} goes on ${supInfo.data?.name ?? "the supplier"}'s account.${payNow ? ` ${head.currency} ${money(num(pay.amount))} is paid now.` : ""} Use Reverse on the bill to correct it later.`} />
    </>
  );
}

function QuickBillLine({ idx, line, supplierId, currency, err, onChange, onRemove }: {
  idx: number; line: QBLine; supplierId: string | null; currency: string; err: (k: string) => string | undefined; onChange: (p: Partial<QBLine>) => void; onRemove?: () => void;
}) {
  const { companyId } = useAccess();
  const meta = useProductMeta(line.product_id);
  const needsVariant = !!meta.data?.has_variants;
  // last price paid to this supplier for this item (same currency) — filled in as a suggestion
  const last = useQuery({
    queryKey: ["last-purchase-price", supplierId, line.product_id, line.variant_id, currency],
    enabled: line.kind === "ITEM" && !!supplierId && !!line.product_id && (!needsVariant || !!line.variant_id),
    staleTime: 60_000,
    queryFn: async () => {
      const rows = (await rpc<{ price_date: string; variant_id: string | null; currency: string; unit_price: number; source_doc: string | null }[]>("purchase_price_history",
        { p_company_id: companyId, p_supplier_id: supplierId, p_product_id: line.product_id, p_limit: 20 })) ?? [];
      return rows.find((r) => (r.variant_id ?? null) === (line.variant_id ?? null) && r.currency === currency) ?? null;
    },
  });
  React.useEffect(() => {
    if (last.data && line.price === "") onChange({ price: String(Number(last.data.unit_price)) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last.data]);
  const tdc = "border-t border-line/70 px-2 py-1.5 align-top";
  return (
    <tr className="group bg-white">
      <td className={cn(tdc, "pt-3 text-center text-2xs text-ink-faint")}>{idx + 1}</td>
      <td className={tdc}>
        {line.kind === "ITEM" ? (
          <div className="flex gap-1.5">
            <div className="min-w-0 flex-1"><ProductPicker value={line.product_id} showStock={false} invalid={!!err(`${line.key}.p`)} onChange={(v) => onChange({ product_id: v, variant_id: null, price: "" })} /></div>
            {needsVariant && <div className="w-[42%] shrink-0"><VariantPicker productId={line.product_id} value={line.variant_id} showStock={false} onChange={(v) => onChange({ variant_id: v, price: "" })} /></div>}
          </div>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            <AccountPicker value={line.account_id} onChange={(v) => onChange({ account_id: v })} placeholder="Expense account…" />
            <Input value={line.desc} placeholder="What for (e.g. freight)" onChange={(e) => onChange({ desc: e.target.value })} />
          </div>
        )}
        {(err(`${line.key}.p`) || err(`${line.key}.a`)) && <p className="mt-0.5 text-2xs text-danger">{err(`${line.key}.p`) ?? err(`${line.key}.a`)}</p>}
        {line.kind === "ITEM" && <input className="mt-1 w-full bg-transparent text-xs text-ink-muted outline-none placeholder:text-ink-faint" placeholder="Note (optional)" value={line.desc} onChange={(e) => onChange({ desc: e.target.value })} />}
      </td>
      <td className={tdc}>{line.kind === "ITEM" ? <><WarehousePicker value={line.warehouse_id} invalid={!!err(`${line.key}.w`)} onChange={(v) => onChange({ warehouse_id: v })} />
        {err(`${line.key}.w`) && <p className="mt-0.5 text-2xs text-danger">{err(`${line.key}.w`)}</p>}</> : <span className="block pt-2 text-xs text-ink-faint">expense — no stock</span>}</td>
      <td className={tdc}>
        <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0" aria-label="Quantity" value={line.qty} invalid={!!err(`${line.key}.q`)} onChange={(e) => onChange({ qty: e.target.value })} />
        {line.kind === "ITEM" && meta.data?.uom && <div className="mt-0.5 text-right text-2xs text-ink-muted">{meta.data.uom}</div>}
      </td>
      <td className={tdc}>
        <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0.00" aria-label="Price" value={line.price} invalid={!!err(`${line.key}.price`)} onChange={(e) => onChange({ price: e.target.value })} />
        {last.data && <div className="mt-0.5 text-right text-2xs text-ink-muted" title={last.data.source_doc ?? undefined}>last {money(last.data.unit_price)} · {formatDate(last.data.price_date)}</div>}
      </td>
      <td className={cn(tdc, "pt-2.5 text-right tabular-nums")}>{num(line.qty) > 0 && line.price.trim() !== "" ? money(num(line.qty) * num(line.price)) : <span className="text-ink-faint">—</span>}</td>
      <td className={cn(tdc, "pt-1.5 text-center")}>{onRemove && <Button size="icon-sm" variant="ghost" aria-label="Remove line" className="opacity-50 group-hover:opacity-100" onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>}</td>
    </tr>
  );
}
