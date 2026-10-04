import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban, FileText, Plus, Receipt } from "lucide-react";
import { Badge, Button, ConfirmDialog, ErpDialog, Field, FormGrid, Input, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { LookupPicker } from "../inventory/pickers";
import { BankPicker, money, num, today } from "../accounting/common";
import { CurrencyInput, rpc, useAction, useCan } from "./common";

export const COST_TYPES = [["FREIGHT", "Freight"], ["INSURANCE", "Insurance"], ["CUSTOMS", "Customs duty & taxes"], ["CLEARING", "Clearing agent"], ["PORT", "Port / terminal / D.O."], ["BANK", "Bank / LC charges"], ["OTHER", "Other"]] as const;
export const costTypeLabel = (c: string) => COST_TYPES.find(([k]) => k === c)?.[1] ?? c;
const sel = "h-control w-full rounded-control border border-line bg-surface px-2 text-sm disabled:opacity-60";
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5 align-top";

export interface ImportCost {
  id: string; shipment_id: string | null; component: string; description: string | null; source_type: "BILL" | "PAYMENT"; bill_id: string | null; journal_entry_id: string | null;
  reference: string | null; cost_date: string; currency: string; amount: number; amount_pkr: number; status: "OPEN" | "USED" | "CANCELLED";
  supplier: { name: string } | null; bank: { name: string } | null; bill: { doc_no: string } | null; entry: { entry_no: string } | null; shipment: { doc_no: string } | null;
  used: { landed_cost: { id: string; doc_no: string } | null } | null;
}
const SELECT = "id, shipment_id, component, description, source_type, bill_id, journal_entry_id, reference, cost_date, currency, amount, amount_pkr, status, supplier:suppliers(name), bank:bank_accounts(name), bill:supplier_bills(doc_no), entry:journal_entries(entry_no), shipment:shipments(doc_no), used:landed_cost_charges!import_costs_used_charge_id_fkey(landed_cost:landed_costs(id, doc_no))";

/** costs recorded for a shipment (or, with withUnlinked, also those not tied to any shipment) */
export function useImportCosts(shipmentId: string | null, opts: { onlyOpen?: boolean; withUnlinked?: boolean } = {}) {
  const { companyId } = useAccess();
  const c = useCan();
  return useQuery({
    queryKey: ["import-costs", companyId, shipmentId, opts.onlyOpen, opts.withUnlinked], enabled: c.costs && !!companyId && (!!shipmentId || !!opts.withUnlinked),
    queryFn: async () => {
      let q = sb().from("import_costs").select(SELECT).eq("company_id", companyId!).neq("status", "CANCELLED").order("cost_date");
      if (opts.onlyOpen) q = q.eq("status", "OPEN");
      if (shipmentId && opts.withUnlinked) q = q.or(`shipment_id.eq.${shipmentId},shipment_id.is.null`);
      else if (shipmentId) q = q.eq("shipment_id", shipmentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ImportCost[];
    },
  });
}

/** record a freight / clearing / customs … cost when it happens: as the forwarder's bill (payable) or as a payment from bank / cash */
export function RecordImportCostDialog({ shipmentId, onClose }: { shipmentId: string | null; onClose: () => void }) {
  const { companyId, can } = useAccess();
  const c = useCan();
  const idem = React.useRef(crypto.randomUUID());
  const [f, setF] = React.useState({ shipment_id: shipmentId, component: "FREIGHT", description: "", payee_type: c.approve ? "SUPPLIER" : "BANK", supplier_id: null as string | null,
    bank_account_id: null as string | null, reference: "", currency: "PKR", fx_rate: "1", amount: "", cost_date: today() });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const go = useAction(() => rpc("record_import_cost", { p_company: companyId, p_data: { ...f, amount: num(f.amount), fx_rate: num(f.fx_rate) || 1, currency: f.payee_type === "BANK" ? "PKR" : f.currency }, p_idempotency_key: idem.current }),
    f.payee_type === "SUPPLIER" ? "Recorded — the bill is on the forwarder's account" : "Recorded — payment entered", onClose);
  const pkr = (num(f.amount) || 0) * (f.payee_type === "BANK" || f.currency === "PKR" ? 1 : num(f.fx_rate) || 0);
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<Receipt className="h-4 w-4" />} title="Record import cost"
      footer={<><div className="flex-1 text-sm text-ink-muted">PKR <b className="tabular-nums text-ink">{money(pkr)}</b></div><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={go.isPending} disabled={!(num(f.amount) > 0)} onClick={() => go.mutate(undefined)}>Record</Button></>}>
      <p className="mb-3 text-sm text-ink-2">Record the cost now. It goes to <b>Landed Cost Clearing</b> and waits there. When the goods are received, open the landed cost and use <b>Pick recorded costs</b> to add it to the goods' cost.</p>
      <FormGrid cols={2}>
        <Field label="Shipment" hint={!f.shipment_id ? "Can be linked later" : undefined}><LookupPicker value={f.shipment_id} onChange={(v) => set({ shipment_id: v })} placeholder="Shipment…" spec={{ table: "shipments", label: "doc_no", secondary: "bl_no" }} /></Field>
        <Field label="Cost type"><select className={sel} value={f.component} onChange={(e) => set({ component: e.target.value })}>{COST_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="How" className="sm:col-span-2">
          <div className="flex gap-2">
            {c.approve && <button type="button" className={cn("flex-1 rounded-control border px-3 py-2 text-left text-sm", f.payee_type === "SUPPLIER" ? "border-primary bg-primary/5" : "border-line")} onClick={() => set({ payee_type: "SUPPLIER" })}>
              <b>Bill from forwarder / agent</b><div className="text-xs text-ink-muted">A supplier bill is posted; pay it later from Supplier Bills</div></button>}
            {can("journals.create") && <button type="button" className={cn("flex-1 rounded-control border px-3 py-2 text-left text-sm", f.payee_type === "BANK" ? "border-primary bg-primary/5" : "border-line")} onClick={() => set({ payee_type: "BANK", currency: "PKR", fx_rate: "1" })}>
              <b>Paid from bank / cash</b><div className="text-xs text-ink-muted">A payment voucher is posted now</div></button>}
          </div>
        </Field>
        {f.payee_type === "SUPPLIER" ? (
          <Field label="Forwarder / agent" required><LookupPicker value={f.supplier_id} onChange={(v) => set({ supplier_id: v })} clearable={false} placeholder="Who billed it…" spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} /></Field>
        ) : (
          <Field label="Paid from" required><BankPicker value={f.bank_account_id} onChange={(v) => set({ bank_account_id: v })} /></Field>
        )}
        <Field label={f.payee_type === "SUPPLIER" ? "Their bill no." : "Cheque / reference"}><Input value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
        <Field label="Amount" required>
          <div className="flex gap-1.5">
            <Input className="text-right tabular-nums" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />
            {f.payee_type === "SUPPLIER" && <CurrencyInput currency={f.currency} rate={f.fx_rate} onCurrency={(v) => set({ currency: v })} onRate={(v) => set({ fx_rate: v })} />}
          </div>
        </Field>
        <Field label="Date"><Input type="date" value={f.cost_date} onChange={(e) => set({ cost_date: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2"><Input placeholder="e.g. Ocean freight Ningbo–Karachi" value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      </FormGrid>
    </ErpDialog>
  );
}

/** list of recorded costs for a shipment, with cancel for unused ones */
export function ImportCostsPanel({ shipmentId, canRecord }: { shipmentId: string; canRecord: boolean }) {
  const navigate = useNavigate();
  const c = useCan();
  const costs = useImportCosts(shipmentId);
  const [adding, setAdding] = React.useState(false);
  const [cancel, setCancel] = React.useState<ImportCost | null>(null);
  const [reason, setReason] = React.useState("");
  const drop = useAction(() => rpc("cancel_import_cost", { p_id: cancel!.id, p_reason: reason }), "Cost cancelled — its bill / payment was reversed", () => { setCancel(null); setReason(""); });
  const rows = costs.data ?? [];
  const open = rows.filter((r) => r.status === "OPEN").reduce((a, r) => a + Number(r.amount_pkr), 0);
  const used = rows.filter((r) => r.status === "USED").reduce((a, r) => a + Number(r.amount_pkr), 0);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <span>Waiting for landed cost: <b className="tabular-nums">PKR {money(open)}</b></span>
        <span className="text-ink-muted">Already in goods' cost: <span className="tabular-nums">PKR {money(used)}</span></span>
        {canRecord && <Button size="sm" className="ml-auto" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Record cost</Button>}
      </div>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-subtle"><tr><th className={cn(th, "w-24")}>Date</th><th className={th}>Cost</th><th className={th}>Billed by / paid from</th><th className={cn(th, "w-32")}>Entry</th>
            <th className={cn(th, "w-36 text-right")}>PKR</th><th className={cn(th, "w-36")}>Status</th><th className={cn(th, "w-10")} /></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={7} className={cn(td, "py-4 text-center text-ink-muted")}>Nothing recorded yet. Record freight, clearing and other charges as their bills come in.</td></tr> : rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{formatDate(r.cost_date)}</td>
              <td className={td}><div className="font-medium">{costTypeLabel(r.component)}</div><div className="text-2xs text-ink-muted">{r.description}{r.reference ? ` · ${r.reference}` : ""}</div></td>
              <td className={td}>{r.supplier?.name ?? r.bank?.name}</td>
              <td className={td}>{r.bill ? <button className="font-mono text-xs text-info hover:underline" onClick={() => navigate(`/supplier-bills?view=${r.bill_id}`)}>{r.bill.doc_no}</button>
                : r.entry ? <button className="font-mono text-xs text-info hover:underline" onClick={() => navigate(`/vouchers?view=${r.journal_entry_id}`)}>{r.entry.entry_no}</button> : null}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(r.amount_pkr)}{r.currency !== "PKR" && <div className="text-2xs text-ink-muted">{r.currency} {money(r.amount)}</div>}</td>
              <td className={td}>{r.status === "USED" ? <button onClick={() => r.used?.landed_cost && navigate(`/landed-costs?view=${r.used.landed_cost.id}`)}><Badge tone="success">in {r.used?.landed_cost?.doc_no ?? "landed cost"}</Badge></button> : <Badge tone="warning">waiting</Badge>}</td>
              <td className={td}>{r.status === "OPEN" && c.approve && <Button size="icon-sm" variant="destructive-ghost" aria-label="Cancel cost" title="Cancel (reverses its bill / payment)" onClick={() => setCancel(r)}><Ban className="h-3.5 w-3.5" /></Button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {adding && <RecordImportCostDialog shipmentId={shipmentId} onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!cancel} title="Cancel this cost?" tone="destructive" confirmLabel="Cancel cost" loading={drop.isPending} onCancel={() => setCancel(null)} onConfirm={() => drop.mutate(undefined)}
        message={cancel?.source_type === "BILL" ? "Its supplier bill is reversed (it must not have a payment allocated)." : "Its payment voucher is reversed."}>
        <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

/** choose recorded costs to put on a landed cost */
export function PickImportCostsDialog({ shipmentId, exclude, onClose, onPick }: { shipmentId: string | null; exclude: string[]; onClose: () => void; onPick: (c: ImportCost[]) => void }) {
  const costs = useImportCosts(shipmentId, { onlyOpen: true, withUnlinked: true });
  const rows = (costs.data ?? []).filter((r) => !exclude.includes(r.id));
  const [sel2, setSel] = React.useState<string[] | null>(null);
  const chosen = sel2 ?? rows.filter((r) => r.shipment_id && r.shipment_id === shipmentId).map((r) => r.id);
  const total = rows.filter((r) => chosen.includes(r.id)).reduce((a, r) => a + Number(r.amount_pkr), 0);
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<FileText className="h-4 w-4" />} title="Pick recorded costs"
      footer={<><div className="flex-1 text-sm text-ink-muted">{chosen.length} chosen · PKR <b className="tabular-nums text-ink">{money(total)}</b></div><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!chosen.length} onClick={() => onPick(rows.filter((r) => chosen.includes(r.id)))}>Add to landed cost</Button></>}>
      {costs.isLoading ? <p className="text-sm text-ink-muted">Loading…</p> : rows.length === 0 ? <p className="text-sm text-ink-muted">No recorded costs waiting{shipmentId ? " for this shipment" : ""}. Use “Record cost” on the shipment when a forwarder or agent bill comes in.</p> : (
        <table className="w-full text-sm">
          <thead><tr><th className={cn(th, "w-8")} /><th className={th}>Cost</th><th className={th}>Shipment</th><th className={th}>Billed by / paid from</th><th className={cn(th, "text-right")}>PKR</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setSel(chosen.includes(r.id) ? chosen.filter((x) => x !== r.id) : [...chosen, r.id])}>
              <td className={td}><input type="checkbox" readOnly checked={chosen.includes(r.id)} /></td>
              <td className={td}><div className="font-medium">{costTypeLabel(r.component)}</div><div className="text-2xs text-ink-muted">{formatDate(r.cost_date)} · {r.description}{r.bill ? ` · ${r.bill.doc_no}` : r.entry ? ` · ${r.entry.entry_no}` : ""}</div></td>
              <td className={td}>{r.shipment?.doc_no ?? <span className="text-xs text-warning">not linked</span>}</td>
              <td className={td}>{r.supplier?.name ?? r.bank?.name}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(r.amount_pkr)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </ErpDialog>
  );
}
