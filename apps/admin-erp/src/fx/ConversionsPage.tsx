import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightLeft, Plus, RotateCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, cn } from "@jst/ui";
import { friendlyError, useAccess, useEntityList } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { useUrlState } from "../inventory/DocPage";
import { LookupPicker } from "../inventory/pickers";
import { BankPicker, money, num, today, useBanks } from "../accounting/common";
import { AttachmentsPanel } from "../attachments/Attachments";
import { rpc, useAction } from "../purchasing/common";
import { CurrencySelect, FxDiff, FxTile, fx, rateText, useHolderBalance } from "./common";

type Row = Record<string, unknown> & { id: string };
const icon = <ArrowRightLeft className="h-4 w-4" />;
type Holder = "SUPPLIER" | "AGENT" | "BANK";
const HOLDER_LABEL: Record<Holder, string> = { SUPPLIER: "Supplier balance", AGENT: "Agent's money", BANK: "Our bank money" };

export function ConversionsPage() {
  const { companyId, can } = useAccess();
  const { params, update } = useUrlState();
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("view");
  const [creating, setCreating] = React.useState(false);
  const list = useEntityList<Row>({ table: "currency_conversions_v", select: "id, doc_no, conv_date, holder_kind, holder_name, from_currency, from_amount, from_rate, from_pkr, to_currency, to_amount, to_rate, to_pkr, fx_diff, status, reference",
    companyId, orderBy: { column: "conv_date", ascending: false }, page, pageSize: 50, enabled: can("journals.view") });
  if (!can("journals.view")) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Currency conversions are restricted." /></Card>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Currency Conversions" icon={icon}
        description="Move a balance from one currency to another without changing old transactions — e.g. a supplier's RMB balance becomes a USD balance, an agent converts our PKR into RMB, or money moves between a PKR and a USD account. Any PKR difference is booked as exchange gain or loss."
        actions={can("journals.create") && can("journals.post") && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New conversion</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={list.data?.rows ?? []} onView={(r) => update({ view: r.id })} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "d", header: "No.", width: "130px", cell: (r) => <span className="font-mono text-xs">{String(r.doc_no)}</span> },
              { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.conv_date as string) },
              { key: "h", header: "What", cell: (r) => <span><Badge>{HOLDER_LABEL[r.holder_kind as Holder]}</Badge> {String(r.holder_name ?? "")}</span> },
              { key: "f", header: "From", width: "170px", align: "right", cell: (r) => <span className="tabular-nums">{fx(r.from_amount as number, r.from_currency as string)}<div className="text-2xs text-ink-muted">@ {rateText(r.from_rate as number)} = {money(r.from_pkr as number)}</div></span> },
              { key: "t", header: "To", width: "170px", align: "right", cell: (r) => <span className="tabular-nums">{fx(r.to_amount as number, r.to_currency as string)}<div className="text-2xs text-ink-muted">@ {rateText(r.to_rate as number)} = {money(r.to_pkr as number)}</div></span> },
              { key: "x", header: "FX", width: "120px", align: "right", cell: (r) => <FxDiff v={r.fx_diff as number} /> },
              { key: "s", header: "", width: "80px", cell: (r) => r.status === "REVERSED" ? <Badge tone="danger">reversed</Badge> : null },
            ]}
            empty={<EmptyState icon={icon} title="No conversions" description="Convert a supplier, agent or bank balance from one currency to another." />} />
        )}
      </Card>
      {creating && <ConversionDialog onClose={() => setCreating(false)} />}
      {view && <ConversionView id={view} onClose={() => update({ view: null })} />}
    </div>
  );
}

function ConversionDialog({ onClose }: { onClose: () => void }) {
  const { companyId } = useAccess();
  const banks = useBanks();
  const idem = React.useRef(crypto.randomUUID());
  const [kind, setKind] = React.useState<Holder>("SUPPLIER");
  const [f, setF] = React.useState({ supplier: null as string | null, agent: null as string | null, fromBank: null as string | null, toBank: null as string | null,
    fromCur: "CNY", fromAmt: "", fromRate: "", toCur: "USD", toAmt: "", toRate: "", date: today(), reference: "", notes: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const holder = kind === "SUPPLIER" ? f.supplier : kind === "AGENT" ? f.agent : f.fromBank;
  const bal = useHolderBalance(kind, holder, f.fromCur);
  // bank accounts fix the currencies
  React.useEffect(() => {
    if (kind !== "BANK") return;
    const fb = banks.data?.find((b) => b.id === f.fromBank)?.currency; const tb = banks.data?.find((b) => b.id === f.toBank)?.currency;
    setF((s) => ({ ...s, fromCur: fb ?? s.fromCur, toCur: tb ?? s.toCur }));
  }, [kind, f.fromBank, f.toBank, banks.data]);
  // suggest the carrying rate of what is being converted
  React.useEffect(() => {
    if (f.fromCur !== "PKR" && !f.fromRate && bal.data?.carrying_rate) set("fromRate", String(bal.data.carrying_rate));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bal.data?.carrying_rate]);
  const fa = num(f.fromAmt) || 0, ta = num(f.toAmt) || 0;
  const fr = f.fromCur === "PKR" ? 1 : num(f.fromRate) || 0;
  const fp = Math.round(fa * fr * 100) / 100;
  const tr = f.toCur === "PKR" ? 1 : f.toRate.trim() ? num(f.toRate) : ta > 0 ? fp / ta : 0;
  const tp = f.toCur === "PKR" ? ta : f.toRate.trim() ? Math.round(ta * tr * 100) / 100 : fp;
  const diff = kind === "SUPPLIER" ? tp - fp : fp - tp;
  const go = useAction(() => rpc("save_currency_conversion", { p_header: { company_id: companyId, holder_kind: kind, supplier_id: f.supplier, agent_id: f.agent, from_bank_id: f.fromBank, to_bank_id: f.toBank,
    from_currency: f.fromCur, from_amount: fa, from_rate: fr, to_currency: f.toCur, to_amount: ta, to_rate: f.toRate.trim() ? num(f.toRate) : null, conv_date: f.date, reference: f.reference, notes: f.notes }, p_idempotency_key: idem.current }),
    "Conversion posted", onClose);
  const errs: string[] = [];
  if (kind === "SUPPLIER" && !f.supplier) errs.push("Choose the supplier");
  if (kind === "AGENT" && !f.agent) errs.push("Choose the agent");
  if (kind === "BANK" && (!f.fromBank || !f.toBank)) errs.push("Choose both accounts");
  if (f.fromCur === f.toCur) errs.push("Choose two different currencies");
  if (!(fa > 0 && ta > 0)) errs.push("Enter both amounts");
  if (!(fr > 0)) errs.push(`Enter the rate the ${f.fromCur} is carried at`);
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title="Currency conversion"
      footer={<><div className="flex-1 text-sm">{fa > 0 && ta > 0 && <>Exchange {diff > 0 ? "loss" : diff < 0 ? "gain" : "difference"} <b className="tabular-nums">{money(Math.abs(diff))}</b></>}</div>
        <Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} onClick={() => (errs.length ? toast.error(errs[0]) : go.mutate(undefined))}>Post conversion</Button></>}>
      <div className="mb-3 flex rounded-control border border-line bg-subtle p-0.5">
        {(["SUPPLIER", "AGENT", "BANK"] as Holder[]).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn("h-[28px] flex-1 rounded-[6px] px-2.5 text-xs font-medium", kind === k ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>{HOLDER_LABEL[k]}</button>
        ))}
      </div>
      <FormGrid cols={2} className="mb-3">
        {kind === "SUPPLIER" && <Field label="Supplier" required className="sm:col-span-2"><LookupPicker value={f.supplier} onChange={(v) => set("supplier", v)} clearable={false} spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} /></Field>}
        {kind === "AGENT" && <Field label="Payment agent" required className="sm:col-span-2"><LookupPicker value={f.agent} onChange={(v) => set("agent", v)} clearable={false} spec={{ table: "payment_agents", label: "name", secondary: "code", filters: { is_active: true } }} /></Field>}
        {kind === "BANK" && <><Field label="From account" required><BankPicker value={f.fromBank} onChange={(v) => set("fromBank", v)} /></Field><Field label="To account" required><BankPicker value={f.toBank} onChange={(v) => set("toBank", v)} /></Field></>}
      </FormGrid>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-card border border-line p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">From</div>
          <FormGrid cols={2}>
            <Field label="Currency"><CurrencySelect value={f.fromCur} disabled={kind === "BANK"} onChange={(v) => { set("fromCur", v); set("fromRate", ""); }} /></Field>
            <Field label="Amount" hint={holder ? `Balance ${money(bal.data?.fx_balance ?? 0)}` : undefined}><Input className="text-right tabular-nums" inputMode="decimal" value={f.fromAmt} onChange={(e) => set("fromAmt", e.target.value)} /></Field>
            {f.fromCur !== "PKR" && <Field label="Carried at (PKR per 1)" hint="Suggested: its average carrying rate" className="sm:col-span-2"><Input className="text-right tabular-nums" inputMode="decimal" value={f.fromRate} onChange={(e) => set("fromRate", e.target.value)} /></Field>}
          </FormGrid>
          <p className="mt-2 text-right text-sm">PKR value <b className="tabular-nums">{money(fp)}</b></p>
        </div>
        <div className="rounded-card border border-line p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">To</div>
          <FormGrid cols={2}>
            <Field label="Currency"><CurrencySelect value={f.toCur} disabled={kind === "BANK"} onChange={(v) => set("toCur", v)} /></Field>
            <Field label="Amount"><Input className="text-right tabular-nums" inputMode="decimal" value={f.toAmt} onChange={(e) => set("toAmt", e.target.value)} /></Field>
            {f.toCur !== "PKR" && <Field label="Rate (PKR per 1)" hint="Blank = same PKR value (no gain / loss)" className="sm:col-span-2"><Input className="text-right tabular-nums" inputMode="decimal" placeholder={tr ? rateText(tr) : ""} value={f.toRate} onChange={(e) => set("toRate", e.target.value)} /></Field>}
          </FormGrid>
          <p className="mt-2 text-right text-sm">PKR value <b className="tabular-nums">{money(tp)}</b></p>
        </div>
      </div>
      <FormGrid cols={3} className="mt-3">
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Reference"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </FormGrid>
      {kind === "SUPPLIER" && <p className="mt-2 text-xs text-ink-muted">Old bills stay in their own currency for history; the supplier's balance moves to the new currency.</p>}
    </ErpDialog>
  );
}

function ConversionView({ id, onClose }: { id: string; onClose: () => void }) {
  const { companyId, can } = useAccess();
  const navigate = useNavigate();
  const q = useEntityList<Row>({ table: "currency_conversions_v", select: "*", companyId, filters: { id }, page: 1, pageSize: 1 });
  const r = q.data?.rows?.[0];
  const [ask, setAsk] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const rev = useAction(() => rpc("reverse_currency_conversion", { p_id: id, p_reason: reason }), "Conversion reversed", () => { setAsk(false); onClose(); });
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title={r ? String(r.doc_no) : "…"} subtitle={r ? `${HOLDER_LABEL[r.holder_kind as Holder]} · ${r.holder_name ?? ""}` : undefined}
        status={r?.status === "REVERSED" ? <Badge tone="danger">reversed</Badge> : null}
        footer={r && <>
          {r.status === "POSTED" && can("journals.post") && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk(true)}>Reverse</Button>}
          <div className="flex-1" />
          {r.journal_entry_id ? <Button onClick={() => navigate(`/vouchers?view=${r.journal_entry_id}`)}>Accounting entry</Button> : null}
          <Button onClick={onClose}>Close</Button></>}>
        {!r ? <Skeleton className="h-24" /> : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
              <FxTile k="From" v={fx(r.from_amount as number, r.from_currency as string)} sub={`@ ${rateText(r.from_rate as number)} = PKR ${money(r.from_pkr as number)}`} />
              <FxTile k="To" v={fx(r.to_amount as number, r.to_currency as string)} sub={`@ ${rateText(r.to_rate as number)} = PKR ${money(r.to_pkr as number)}`} />
              <FxTile k="Exchange difference" v={<FxDiff v={r.fx_diff as number} />} />
            </div>
            <p className="mb-3 text-sm text-ink-muted">{formatDate(r.conv_date as string)}{r.reference ? ` · ${r.reference}` : ""}{r.notes ? ` · ${r.notes}` : ""}</p>
            <AttachmentsPanel entityType="currency_conversions" entityId={id} />
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask} title="Reverse this conversion?" tone="destructive" confirmLabel="Reverse" loading={rev.isPending} onCancel={() => setAsk(false)} onConfirm={() => rev.mutate(undefined)} message="A reversal entry is posted; the balance moves back to the original currency.">
        <Field label="Reason" required className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}
