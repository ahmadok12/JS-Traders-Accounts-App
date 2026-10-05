import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, Globe2, Link2, Plus, RotateCcw, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { LookupPicker } from "../inventory/pickers";
import { money, num, today } from "../accounting/common";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { rpc, useAction, useCan, useSupplierName } from "../purchasing/common";
import { CurrencySelect, FxDiff, FxTile, PaySourceFields, emptySource, fx, rateText, sourcePayload, type PaySource } from "./common";

type Row = Record<string, unknown> & { id: string };
const icon = <Globe2 className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";
const FILTERS = [{ label: "Not fully applied", open: true }, { label: "Posted", status: "POSTED" }, { label: "Through agents", agent: true }, { label: "All" }] as { label: string; status?: string; open?: boolean; agent?: boolean }[];

export function FxPaymentsPage() {
  const { companyId, can } = useAccess();
  const c = useCan();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("view");
  const [creating, setCreating] = React.useState(params.get("new") === "1");
  const flt = FILTERS[f];
  const list = useEntityList<Row>({
    table: "fx_payments_v", select: "id, doc_no, pay_date, supplier_id, supplier_name, currency, fx_amount, fx_rate, amount_pkr, source_kind, bank_name, agent_name, source_currency, applied, unapplied, fx_diff, bills, status, reference, exchange_reference",
    companyId, search: q, searchColumns: ["doc_no", "supplier_name", "reference", "exchange_reference", "agent_name"],
    filters: { status: flt.open ? "POSTED" : flt.status, source_kind: flt.agent ? "AGENT" : undefined },
    orderBy: { column: "pay_date", ascending: false }, page, pageSize: 50, enabled: c.costs || can("journals.view"),
  });
  if (!(c.costs || can("journals.view"))) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Foreign payments are restricted." /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) => !flt.open || Number(r.unapplied) > 0);
  const canPay = c.approve && can("journals.create");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Foreign Payments" icon={icon}
        description="Payments to suppliers in RMB, USD and other currencies. Each payment keeps its own exchange rate; when it is applied to a bill the difference from the bill rate is booked as exchange gain or loss. Pay from our bank or through a payment agent."
        actions={canPay && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New foreign payment</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search payment / supplier / agent / slip…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id })} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "d", header: "Payment", width: "130px", cell: (r) => <span className="font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.pay_date as string) },
              { key: "s", header: "Supplier", cell: (r) => <span>{String(r.supplier_name)}{r.bills ? <span className="text-xs text-ink-muted"> · {String(r.bills)}</span> : null}</span> },
              { key: "v", header: "Paid via", width: "170px", hideBelow: "md", cell: (r) => r.source_kind === "AGENT" ? <span><Badge tone="info">agent</Badge> <span className="text-xs">{String(r.agent_name)}</span></span> : <span className="text-xs">{String(r.bank_name ?? "")}</span> },
              { key: "a", header: "Amount", width: "170px", align: "right", cell: (r) => <span className="tabular-nums"><b>{fx(r.fx_amount as number, r.currency as string)}</b><div className="text-2xs text-ink-muted">@ {rateText(r.fx_rate as number)} = {money(r.amount_pkr as number)}</div></span> },
              { key: "u", header: "Not applied", width: "130px", align: "right", cell: (r) => Number(r.unapplied) > 0 && r.status === "POSTED" ? <span className="font-medium tabular-nums text-warning">{money(r.unapplied as number)}</span> : <span className="text-ink-faint">—</span> },
              { key: "fx", header: "FX", width: "120px", align: "right", hideBelow: "lg", cell: (r) => <FxDiff v={r.fx_diff as number} /> },
              { key: "st", header: "", width: "90px", cell: (r) => r.status === "REVERSED" ? <Badge tone="danger">reversed</Badge> : null },
            ]}
            empty={<EmptyState icon={icon} title="No foreign payments" description="Record a payment in RMB / USD to a supplier — from the bank or through an agent." />} />
        )}
      </Card>
      {creating && <FxPayDialog onClose={() => { setCreating(false); if (params.get("new")) update({ new: null }); }} onDone={(id) => { setCreating(false); update({ new: null, view: id }); }} />}
      {view && <FxPaymentDialog id={view} onClose={() => update({ view: null })} />}
    </div>
  );
}

interface OpenBill { id: string; doc_no: string; bill_date: string; supplier_invoice_no: string | null; currency: string; fx_rate: number; total_amount: number; outstanding_fx: number }
function useOpenFxBills(supplierId: string | null | undefined, currency: string | null | undefined) {
  return useQuery({
    queryKey: ["open-fx-bills", supplierId, currency],
    enabled: !!supplierId && !!currency && currency !== "PKR",
    queryFn: async () => {
      const { data, error } = await sb().from("supplier_bills_v").select("id, doc_no, bill_date, supplier_invoice_no, currency, fx_rate, total_amount, outstanding_fx")
        .eq("supplier_id", supplierId!).eq("currency", currency!).eq("status", "POSTED").gt("outstanding_fx", 0).order("bill_date");
      if (error) throw error;
      return (data ?? []) as OpenBill[];
    },
  });
}

/** New foreign payment. Prefill supplier / currency / bill when opened from a bill. */
export function FxPayDialog({ supplierId, currency: cur0, billId, amount, onClose, onDone }: {
  supplierId?: string; currency?: string; billId?: string; amount?: number; onClose: () => void; onDone?: (id: string) => void;
}) {
  const { companyId } = useAccess();
  const idem = React.useRef(crypto.randomUUID());
  const [sup, setSup] = React.useState<string | null>(supplierId ?? null);
  const supInfo = useSupplierName(sup);
  const [cur, setCur] = React.useState(cur0 ?? "");
  const [h, setH] = React.useState({ amount: amount ? String(amount) : "", rate: "", date: today(), reference: "", exchange_reference: "", supplier_bank_reference: "", notes: "" });
  const [shipment, setShipment] = React.useState<string | null>(null);
  const [src, setSrc] = React.useState<PaySource>(emptySource());
  const [apply, setApply] = React.useState<Record<string, string>>({});
  const [showErr, setShowErr] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => { if (!cur && supInfo.data?.default_currency && supInfo.data.default_currency !== "PKR") setCur(supInfo.data.default_currency); }, [supInfo.data?.default_currency, cur]);
  const bills = useOpenFxBills(sup, cur);
  const amt = num(h.amount) || 0;
  const rate = num(h.rate) || 0;
  const pkr = Math.round(amt * rate * 100) / 100;
  // default application: the bill it was opened from, else oldest first
  React.useEffect(() => {
    if (!bills.data) return;
    const next: Record<string, string> = {};
    let left = amt;
    const order = billId ? [...bills.data].sort((a) => (a.id === billId ? -1 : 1)) : bills.data;
    for (const b of order) { if (left <= 0) break; if (billId && b.id !== billId) continue; const x = Math.min(left, Number(b.outstanding_fx)); next[b.id] = String(Math.round(x * 100) / 100); left -= x; }
    setApply(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills.data, amt]);
  const applied = Object.values(apply).reduce((s, v) => s + (num(v) || 0), 0);
  const fxEst = (bills.data ?? []).reduce((s, b) => s + (num(apply[b.id] ?? "") || 0) * (rate - Number(b.fx_rate)), 0);
  const errors: Record<string, string> = {};
  if (!sup) errors.sup = "Choose the supplier";
  if (!cur || cur === "PKR") errors.cur = "Choose the foreign currency";
  if (!(amt > 0)) errors.amount = "Enter the amount paid";
  if (!(rate > 0)) errors.rate = "Enter this payment's rate";
  if (src.kind === "BANK" ? !src.bank_account_id : !src.agent_id) errors.src = src.kind === "BANK" ? "Choose the bank / cash account" : "Choose the payment agent";
  if (src.kind === "AGENT" && src.source_currency !== "PKR" && src.source_currency !== cur && !(num(src.source_amount) > 0)) errors.src = `Enter the ${src.source_currency} taken from the agent`;
  if (applied > amt + 0.001) errors.apply = "Applied to bills more than was paid";
  for (const b of bills.data ?? []) if ((num(apply[b.id] ?? "") || 0) > Number(b.outstanding_fx) + 0.001) errors.apply = `${b.doc_no} has only ${money(b.outstanding_fx)} outstanding`;
  const err = (k: string) => (showErr ? errors[k] : undefined);
  const go = useAction(() => rpc<string>("pay_supplier_fx", {
    p_company_id: companyId, p_supplier_id: sup, p_currency: cur, p_fx_amount: amt, p_fx_rate: rate, p_date: h.date, p_source: sourcePayload(src),
    p_bills: Object.entries(apply).filter(([, v]) => num(v) > 0).map(([bill_id, v]) => ({ bill_id, amount: num(v) })),
    p_extra: { reference: h.reference, exchange_reference: h.exchange_reference, supplier_bank_reference: h.supplier_bank_reference, notes: h.notes, shipment_id: shipment },
    p_idempotency_key: idem.current,
  }), "Foreign payment recorded");
  const tryGo = () => { setShowErr(true); const k = Object.keys(errors); if (k.length) { toast.error(errors[k[0]]); return; } setConfirm(true); };
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="xl" accent="bill" icon={icon} title="Foreign payment to a supplier" subtitle="Each payment keeps its own exchange rate"
        footer={<>
          <div className="flex-1 text-sm">{amt > 0 && rate > 0 && <>PKR cost <b className="tabular-nums">{money(pkr)}</b></>}{applied > 0 && Math.abs(fxEst) >= 0.01 && <span className="ml-3 text-xs">Estimated {fxEst > 0 ? "exchange loss" : "exchange gain"} <b className="tabular-nums">{money(Math.abs(fxEst))}</b></span>}</div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={tryGo}>Record payment</Button>
        </>}>
        <FormGrid cols={4} className="mb-3">
          <Field label="Supplier" required error={err("sup")} className="sm:col-span-2">
            <LookupPicker value={sup} disabled={!!supplierId} onChange={(v) => { setSup(v); setApply({}); }} clearable={false} placeholder="Supplier…" spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} />
          </Field>
          <Field label="Currency paid" required error={err("cur")}><CurrencySelect foreignOnly value={cur} disabled={!!cur0} onChange={(v) => { setCur(v); setApply({}); }} /></Field>
          <Field label="Date"><Input type="date" value={h.date} onChange={(e) => setH((s) => ({ ...s, date: e.target.value }))} /></Field>
          <Field label={`Amount (${cur || "currency"})`} required error={err("amount")}><Input className="text-right tabular-nums" inputMode="decimal" value={h.amount} onChange={(e) => setH((s) => ({ ...s, amount: e.target.value }))} /></Field>
          <Field label={`Rate of this payment (PKR per 1 ${cur || "unit"})`} required error={err("rate")} hint="The actual rate — never averaged"><Input className="text-right tabular-nums" inputMode="decimal" value={h.rate} onChange={(e) => setH((s) => ({ ...s, rate: e.target.value }))} /></Field>
          <Field label="PKR cost"><div className="flex h-control items-center justify-end rounded-control border border-line bg-subtle px-3 text-sm font-semibold tabular-nums">{money(pkr)}</div></Field>
          <Field label="For shipment (optional)"><LookupPicker value={shipment} onChange={setShipment} placeholder="(none)" spec={{ table: "shipments", label: "doc_no", secondary: "bl_no" }} /></Field>
        </FormGrid>
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-card border border-line p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Paid from</div>
            <PaySourceFields value={src} onChange={setSrc} currency={cur} fxAmount={amt} rate={rate} err={err("src")} />
          </div>
          <FormGrid cols={2}>
            <Field label="Reference"><Input value={h.reference} onChange={(e) => setH((s) => ({ ...s, reference: e.target.value }))} /></Field>
            <Field label="Exchange / agent slip no."><Input value={h.exchange_reference} onChange={(e) => setH((s) => ({ ...s, exchange_reference: e.target.value }))} /></Field>
            <Field label="Supplier's bank / TT reference"><Input value={h.supplier_bank_reference} onChange={(e) => setH((s) => ({ ...s, supplier_bank_reference: e.target.value }))} /></Field>
            <Field label="Notes"><Input value={h.notes} onChange={(e) => setH((s) => ({ ...s, notes: e.target.value }))} /></Field>
          </FormGrid>
        </div>
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Apply to bills <span className="font-normal normal-case">— leave blank to keep it as an advance and apply later</span></div>
        {!sup || !cur ? <p className="rounded-card border border-line px-3 py-3 text-sm text-ink-muted">Choose the supplier and currency to see their open bills.</p>
          : (bills.data ?? []).length === 0 ? <p className="rounded-card border border-line px-3 py-3 text-sm text-ink-muted">No open {cur} bills for this supplier — the payment is kept as an advance.</p> : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead className="bg-subtle"><tr><th className={th}>Bill</th><th className={th}>Date</th><th className={cn(th, "text-right")}>Bill rate</th><th className={cn(th, "text-right")}>Outstanding {cur}</th><th className={cn(th, "w-36 text-right")}>Apply</th><th className={cn(th, "text-right")}>FX at this rate</th></tr></thead>
              <tbody>{(bills.data ?? []).map((b) => {
                const a = num(apply[b.id] ?? "") || 0;
                return (
                  <tr key={b.id}>
                    <td className={cn(td, "font-mono text-xs")}>{b.doc_no}{b.supplier_invoice_no && <div className="font-sans text-2xs text-ink-muted">{b.supplier_invoice_no}</div>}</td>
                    <td className={cn(td, "text-xs")}>{formatDate(b.bill_date)}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{rateText(b.fx_rate)}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{money(b.outstanding_fx)}</td>
                    <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={apply[b.id] ?? ""} onChange={(e) => setApply((s) => ({ ...s, [b.id]: e.target.value }))} /></td>
                    <td className={cn(td, "text-right")}>{a > 0 && rate > 0 ? <FxDiff v={a * (rate - Number(b.fx_rate))} /> : null}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {err("apply") && <p className="mt-1 text-xs text-danger">{err("apply")}</p>}
        {amt > 0 && applied < amt && <p className="mt-1 text-xs text-ink-muted">{cur} {money(amt - applied)} stays as an advance to the supplier until applied.</p>}
      </ErpDialog>
      <ConfirmDialog open={confirm} title="Record this foreign payment?" confirmLabel="Record" loading={go.isPending} onCancel={() => setConfirm(false)}
        onConfirm={() => go.mutate(undefined, { onSuccess: (id) => { setConfirm(false); onDone ? onDone(id as string) : onClose(); }, onError: () => { setConfirm(false); idem.current = crypto.randomUUID(); } })}
        message={`${cur} ${money(amt)} @ ${h.rate} = PKR ${money(pkr)} paid to ${supInfo.data?.name ?? "the supplier"}${src.kind === "AGENT" ? " through the agent" : ""}.${applied > 0 ? ` ${cur} ${money(applied)} is applied to bills now.` : ""}`} />
    </>
  );
}

export function FxPaymentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAccess();
  const c = useCan();
  const navigate = useNavigate();
  const files = useAttachments("fx_payments", id);
  const q = useQuery({
    queryKey: ["record", "fx_payments", id],
    queryFn: async () => {
      const [h, a] = await Promise.all([
        sb().from("fx_payments_v").select("*").eq("id", id).single(),
        sb().from("supplier_bill_allocations").select("id, bill_id, fx_amount, bill_rate, pay_rate, amount, pkr_at_payment, fx_diff, settle_date, fx_entry_id, bill:supplier_bills(doc_no, supplier_invoice_no)").eq("fx_payment_id", id).eq("status", "ACTIVE").order("created_at"),
      ]);
      if (h.error) throw h.error;
      return { h: h.data as Row, allocs: (a.data ?? []) as Row[] };
    },
  });
  const h = q.data?.h;
  const [tab, setTab] = React.useState("applied");
  const [ask, setAsk] = React.useState<null | "reverse" | "apply">(null);
  const [reason, setReason] = React.useState("");
  const reverse = useAction(() => rpc("reverse_fx_payment", { p_id: id, p_reason: reason }), "Payment reversed", () => { setAsk(null); setReason(""); });
  const unlink = useAction((aid: string) => rpc("remove_supplier_allocation", { p_id: aid }), "Unlinked — the exchange difference was reversed");
  const posted = h?.status === "POSTED";
  const canAct = c.approve && can("journals.create");
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="xl" accent="bill" icon={icon} title={h ? String(h.doc_no) : "Foreign payment"} subtitle={h ? `${h.supplier_name} · ${formatDate(h.pay_date as string)}` : undefined}
        status={h ? <Badge tone={posted ? (Number(h.unapplied) > 0 ? "warning" : "success") : "danger"}>{posted ? (Number(h.unapplied) > 0 ? "not fully applied" : "applied") : "reversed"}</Badge> : null}
        footer={h && <>
          {posted && c.approve && can("journals.post") && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk("reverse")}>Reverse</Button>}
          <div className="flex-1" />
          {h.journal_entry_id ? <Button icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/vouchers?view=${h.journal_entry_id}`)}>Accounting entry</Button> : null}
          <Button onClick={onClose}>Close</Button>
          {posted && Number(h.unapplied) > 0 && canAct && <Button variant="primary" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setAsk("apply")}>Apply to bills</Button>}
        </>}>
        {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : h && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <FxTile k={`Paid ${h.currency}`} v={money(h.fx_amount as number)} sub={`@ ${rateText(h.fx_rate as number)}`} />
              <FxTile k="PKR cost" v={money(h.amount_pkr as number)} />
              <FxTile k="Applied" v={money(h.applied as number)} />
              <FxTile k="Not applied (advance)" v={money(h.unapplied as number)} hot={Number(h.unapplied) > 0 && posted} />
              <FxTile k="Exchange difference" v={<FxDiff v={h.fx_diff as number} />} />
            </div>
            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
              <div><dt className="text-2xs uppercase text-ink-muted">Paid via</dt><dd>{h.source_kind === "AGENT" ? <>Agent <b>{String(h.agent_name)}</b> — from its {String(h.source_currency)} account ({money(h.source_amount as number)})</> : String(h.bank_name ?? "")}</dd></div>
              <div><dt className="text-2xs uppercase text-ink-muted">Reference</dt><dd>{String(h.reference ?? "—")}</dd></div>
              <div><dt className="text-2xs uppercase text-ink-muted">Exchange slip</dt><dd>{String(h.exchange_reference ?? "—")}</dd></div>
              <div><dt className="text-2xs uppercase text-ink-muted">Supplier bank ref.</dt><dd>{String(h.supplier_bank_reference ?? "—")}</dd></div>
              {h.shipment_no ? <div><dt className="text-2xs uppercase text-ink-muted">Shipment</dt><dd>{String(h.shipment_no)}</dd></div> : null}
              {h.notes ? <div className="col-span-2"><dt className="text-2xs uppercase text-ink-muted">Notes</dt><dd>{String(h.notes)}</dd></div> : null}
              {h.reversal_reason ? <div className="col-span-2"><dt className="text-2xs uppercase text-ink-muted">Reversal reason</dt><dd>{String(h.reversal_reason)}</dd></div> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "applied", label: `Bills (${q.data?.allocs.length ?? 0})` }, { key: "files", label: filesLabel(files.data?.length) }, { key: "history", label: "History" }]} />
            {tab === "applied" && ((q.data?.allocs ?? []).length === 0 ? <p className="text-sm text-ink-muted">Not applied to any bill yet.</p> : (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-subtle"><tr><th className={th}>Bill</th><th className={th}>Date</th><th className={cn(th, "text-right")}>{String(h.currency)}</th><th className={cn(th, "text-right")}>Bill rate</th><th className={cn(th, "text-right")}>At bill rate</th><th className={cn(th, "text-right")}>Actual PKR</th><th className={cn(th, "text-right")}>FX</th><th className={cn(th, "w-10")} /></tr></thead>
                  <tbody>{(q.data?.allocs ?? []).map((a) => {
                    const b = a.bill as { doc_no: string; supplier_invoice_no: string | null } | null;
                    return (
                      <tr key={a.id}>
                        <td className={cn(td, "font-mono text-xs")}><button className="text-primary hover:underline" onClick={() => navigate(`/supplier-bills?view=${a.bill_id}`)}>{b?.doc_no}</button></td>
                        <td className={cn(td, "text-xs")}>{formatDate(a.settle_date as string)}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(a.fx_amount as number)}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{rateText(a.bill_rate as number)}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(a.amount as number)}</td>
                        <td className={cn(td, "text-right tabular-nums")}>{money(a.pkr_at_payment as number)}</td>
                        <td className={cn(td, "text-right")}><FxDiff v={a.fx_diff as number} /></td>
                        <td className={td}>{posted && canAct && <Button size="icon-sm" variant="ghost" title="Unlink (the exchange difference is reversed)" onClick={() => unlink.mutate(a.id)}><X className="h-3.5 w-3.5" /></Button>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            ))}
            {tab === "files" && <AttachmentsPanel entityType="fx_payments" entityId={id} />}
            {tab === "history" && <AuditTimeline table="fx_payments" id={id} />}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask === "reverse"} title="Reverse this payment?" tone="destructive" confirmLabel="Reverse" loading={reverse.isPending} onCancel={() => setAsk(null)} onConfirm={() => reverse.mutate(undefined)}
        message="It is unlinked from its bills (their exchange differences are reversed) and the payment entry is reversed. If paid through an agent, the agent's balance goes back up.">
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      {ask === "apply" && h && <ApplyFxDialog payment={h} onClose={() => setAsk(null)} />}
    </>
  );
}

/** Apply a payment's unapplied amount to open bills of the same supplier and currency. */
function ApplyFxDialog({ payment, onClose }: { payment: Row; onClose: () => void }) {
  const bills = useOpenFxBills(payment.supplier_id as string, payment.currency as string);
  const [amt, setAmt] = React.useState<Record<string, string>>({});
  const free = Number(payment.unapplied);
  const rate = Number(payment.fx_rate);
  const sum = Object.values(amt).reduce((s, v) => s + (num(v) || 0), 0);
  const go = useAction(() => rpc("apply_fx_payment", { p_fx_payment_id: payment.id, p_bills: Object.entries(amt).filter(([, v]) => num(v) > 0).map(([bill_id, v]) => ({ bill_id, amount: num(v) })), p_date: null }),
    "Applied — exchange difference booked", onClose);
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<Link2 className="h-4 w-4" />} title={`Apply ${payment.doc_no} to bills`}
      footer={<><span className="text-sm text-ink-muted">Applying {String(payment.currency)} {money(sum)} of {money(free)}</span><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={sum <= 0 || sum > free + 0.001} loading={go.isPending} onClick={() => go.mutate(undefined)}>Apply</Button></>}>
      {(bills.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">No open {String(payment.currency)} bills for this supplier.</p> : (
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Bill</th><th className={cn(th, "text-right")}>Bill rate</th><th className={cn(th, "text-right")}>Outstanding</th><th className={cn(th, "w-32 text-right")}>Apply</th><th className={cn(th, "text-right")}>FX</th></tr></thead>
          <tbody>{(bills.data ?? []).map((b) => {
            const a = num(amt[b.id] ?? "") || 0;
            return (
              <tr key={b.id}><td className={cn(td, "font-mono text-xs")}>{b.doc_no}<div className="font-sans text-2xs text-ink-muted">{formatDate(b.bill_date)}</div></td>
                <td className={cn(td, "text-right tabular-nums")}>{rateText(b.fx_rate)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{money(b.outstanding_fx)}</td>
                <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" placeholder={String(Math.min(free, Number(b.outstanding_fx)))} value={amt[b.id] ?? ""} onChange={(e) => setAmt((s) => ({ ...s, [b.id]: e.target.value }))} /></td>
                <td className={cn(td, "text-right")}>{a > 0 ? <FxDiff v={a * (rate - Number(b.fx_rate))} /> : null}</td></tr>
            );
          })}</tbody>
        </table>
      )}
    </ErpDialog>
  );
}

/** Used by the bill: apply earlier foreign payments of the same supplier + currency to this bill. */
export function ApplyEarlierFxDialog({ bill, outstanding, onClose }: { bill: Row; outstanding: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ["supplier-open-fx", bill.supplier_id, bill.currency],
    queryFn: async () => (await rpc<{ fx_payment_id: string; doc_no: string; pay_date: string; fx_rate: number; unapplied: number; reference: string | null; paid_via: string | null }[]>("supplier_open_fx_payments", { p_supplier_id: bill.supplier_id, p_currency: bill.currency })) ?? [] });
  const [amt, setAmt] = React.useState<Record<string, string>>({});
  const go = useAction(async () => {
    for (const p of q.data ?? []) {
      const v = num(amt[p.fx_payment_id] ?? "0");
      if (v > 0) await rpc("apply_fx_payment", { p_fx_payment_id: p.fx_payment_id, p_bills: [{ bill_id: bill.id, amount: v }], p_date: null });
    }
  }, "Applied — exchange difference booked", onClose);
  const sum = Object.values(amt).reduce((s, v) => s + (num(v) || 0), 0);
  const billRate = Number(bill.fx_rate);
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<Link2 className="h-4 w-4" />} title={`Use an earlier ${bill.currency} payment — ${bill.doc_no}`}
      footer={<><span className="text-sm text-ink-muted">Applying {String(bill.currency)} {money(sum)} of {money(outstanding)}</span><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={sum <= 0 || sum > outstanding + 0.001} loading={go.isPending} onClick={() => go.mutate(undefined)}>Apply</Button></>}>
      {(q.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">No unapplied {String(bill.currency)} payments or advances for this supplier.</p> : (
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Payment</th><th className={th}>Via</th><th className={cn(th, "text-right")}>Rate</th><th className={cn(th, "text-right")}>Free</th><th className={cn(th, "w-32 text-right")}>Apply</th><th className={cn(th, "text-right")}>FX</th></tr></thead>
          <tbody>{(q.data ?? []).map((p) => {
            const a = num(amt[p.fx_payment_id] ?? "") || 0;
            return (
              <tr key={p.fx_payment_id}><td className={cn(td, "font-mono text-xs")}>{p.doc_no}<div className="font-sans text-2xs text-ink-muted">{formatDate(p.pay_date)} {p.reference}</div></td>
                <td className={cn(td, "text-xs")}>{p.paid_via}</td>
                <td className={cn(td, "text-right tabular-nums")}>{rateText(p.fx_rate)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{money(p.unapplied)}</td>
                <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" placeholder={String(Math.min(p.unapplied, outstanding))} value={amt[p.fx_payment_id] ?? ""}
                  onChange={(e) => setAmt((s) => ({ ...s, [p.fx_payment_id]: e.target.value }))} /></td>
                <td className={cn(td, "text-right")}>{a > 0 ? <FxDiff v={a * (Number(p.fx_rate) - billRate)} /> : null}</td></tr>
            );
          })}</tbody>
        </table>
      )}
    </ErpDialog>
  );
}

