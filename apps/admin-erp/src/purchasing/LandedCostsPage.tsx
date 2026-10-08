import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban, Calculator, CheckCircle2, Download, FileText, Plus, Printer, Receipt, RotateCcw, Save, ShieldAlert, Ship, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { LookupPicker } from "../inventory/pickers";
import { AccountPicker, BankPicker, money, num, today } from "../accounting/common";
import { qtyFmt } from "../sales/common";
import { printDocument } from "../sales/print";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { CurrencyInput, rpc, useAction, useCan } from "./common";
import { PickImportCostsDialog, RecordImportCostDialog, type ExpenseEntry, type ImportCost } from "./ImportCosts";

type JRow = { entry_date: string; description: string | null; entry: { entry_no: string } | null; account: { name: string } | null };
const jlineLabel = (r: JRow | null) => (r ? `${formatDate(r.entry_date)} · ${r.entry?.entry_no ?? ""} · ${r.account?.name ?? ""}` : undefined);

type RecRow = { reference: string | null; cost_date: string; rbill: { doc_no: string } | null; entry: { entry_no: string } | null; rsup: { name: string } | null; rbank: { name: string } | null };
const recordedLabel = (r: RecRow | null) => (r ? `${formatDate(r.cost_date)} · ${r.rbill?.doc_no ?? r.entry?.entry_no ?? ""} · ${r.rsup?.name ?? r.rbank?.name ?? ""}` : undefined);

type Row = Record<string, unknown> & { id: string };
const icon = <Calculator className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5 align-top";
const sel = "h-control w-full rounded-control border border-line bg-surface px-2 text-sm disabled:opacity-60";
const FILTERS = [{ label: "Drafts", status: "DRAFT" }, { label: "Posted", status: "POSTED" }, { label: "All" }] as { label: string; status?: string }[];
const TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = { DRAFT: "warning", POSTED: "success", REVERSED: "danger", CANCELLED: "neutral" };

export const COMPONENTS = [["FREIGHT", "Freight"], ["INSURANCE", "Insurance"], ["CUSTOMS", "Customs duty & taxes"], ["CLEARING", "Clearing agent"], ["PORT", "Port / terminal / D.O."], ["BANK", "Bank / LC charges"], ["OTHER", "Other"]] as const;
const PAYEES = [["SUPPLIER", "Bill from forwarder / agent"], ["BANK", "Paid from bank / cash"], ["BILLED", "Already on a supplier bill"], ["ESTIMATE", "Estimate — bill not received yet"]] as const;
const METHODS = [["VALUE", "By value"], ["WEIGHT", "By weight"], ["QUANTITY", "By quantity"], ["VOLUME", "By volume (CBM)"], ["PERCENT", "By percentage"], ["MANUAL", "Amount per item"]] as const;
const compLabel = (c: string) => COMPONENTS.find(([k]) => k === c)?.[1] ?? c;

interface Cand { receipt_line_id: string; receipt_id: string; receipt_no: string; doc_date: string; product_name: string; variant_name: string | null; uom: string | null; quantity: number; unit_cost_pkr: number | null; landed_pkr: number; weight_kg: number; cbm: number }
interface Charge { key: string; component: string; description: string; payee_type: string; supplier_id: string | null; bank_account_id: string | null; reference: string; currency: string; fx_rate: string;
  amount: string; treatment: string; expense_account_id: string | null; method: string; manual: Record<string, string>; settles_charge_id: string | null;
  /** a cost recorded earlier (bill / payment on Landed Cost Clearing) */ import_cost_id: string | null; /** an expense entry already booked */ journal_line_id: string | null; recorded?: string }
const newCharge = (component = "FREIGHT"): Charge => ({ key: crypto.randomUUID(), component, description: "", payee_type: "SUPPLIER", supplier_id: null, bank_account_id: null, reference: "",
  currency: "PKR", fx_rate: "1", amount: "", treatment: "CAPITALIZE", expense_account_id: null, method: component === "FREIGHT" ? "WEIGHT" : "VALUE", manual: {}, settles_charge_id: null, import_cost_id: null, journal_line_id: null });
const pkr = (c: Charge) => Math.round((num(c.amount) || 0) * (c.currency === "PKR" ? 1 : num(c.fx_rate) || 0) * 100) / 100;

/** the same split the server makes (it is the one that counts) */
function splitCharge(c: Charge, lines: Cand[]): Map<string, number> | string {
  const out = new Map<string, number>();
  const amt = pkr(c);
  if (c.treatment !== "CAPITALIZE" || c.settles_charge_id || amt === 0) return out;
  if (!lines.length) return "choose the goods";
  const base = (l: Cand) => c.method === "VALUE" ? Math.round(l.quantity * (l.unit_cost_pkr ?? 0) * 100) / 100 : c.method === "WEIGHT" ? Number(l.weight_kg) : c.method === "QUANTITY" ? Number(l.quantity)
    : c.method === "VOLUME" ? Number(l.cbm) : num(c.manual[l.receipt_line_id] ?? "") || 0;
  if (c.method === "VALUE" && lines.some((l) => l.unit_cost_pkr == null)) return "some goods have no purchase cost yet";
  const sum = lines.reduce((a, l) => a + base(l), 0);
  if (sum <= 0) return c.method === "WEIGHT" ? "no weight on these goods" : c.method === "VOLUME" ? "no CBM on these goods" : "nothing to split by";
  if (c.method === "PERCENT" && Math.abs(sum - 100) > 0.01) return `percentages add up to ${Math.round(sum * 100) / 100}`;
  if (c.method === "MANUAL" && Math.abs(sum - amt) > 0.01) return `amounts add up to ${money(sum)}, not ${money(amt)}`;
  let left = amt;
  lines.forEach((l, i) => {
    const v = i === lines.length - 1 ? Math.round(left * 100) / 100 : c.method === "MANUAL" ? Math.round(base(l) * 100) / 100 : Math.round((amt * base(l) / sum) * 100) / 100;
    left -= v; out.set(l.receipt_line_id, v);
  });
  return out;
}

export function LandedCostsPage() {
  const { companyId } = useAccess();
  const c = useCan();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "2") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("view");
  const creating = params.get("new") === "1";
  const flt = FILTERS[f] ?? FILTERS[2];
  const [recording, setRecording] = React.useState(false);
  const list = useEntityList<Row>({
    table: "landed_costs", select: "id, doc_no, doc_date, status, notes, shipment:shipments(doc_no, bl_no), charges:landed_cost_charges(amount_pkr, is_active, payee_type, settled_by, component)",
    companyId, search: q, searchColumns: ["doc_no", "notes"], filters: { status: flt.status }, orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: c.costs,
  });
  if (!c.costs) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Landed cost needs permission to see purchase costs." /></Card>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Landed Cost" icon={icon}
        description="Freight, insurance, customs, clearing, port and bank charges added to the cost of the goods they brought in — split by value, weight, quantity, volume, percentage or by hand. Enter estimates now and replace them with the actual bills later."
        actions={<>
          {c.costs && <Button icon={<Receipt className="h-4 w-4" />} onClick={() => setRecording(true)}>Record import cost</Button>}
          {c.manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New landed cost</Button>}
        </>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: String(i), page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={list.data?.rows ?? []} onView={(r) => update({ view: r.id, new: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "d", header: "No.", width: "110px", cell: (r) => <span className="font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.doc_date as string) },
              { key: "s", header: "Shipment", width: "180px", cell: (r) => { const sh = r.shipment as { doc_no: string; bl_no: string | null } | null; return sh ? <span><span className="font-mono text-xs">{sh.doc_no}</span>{sh.bl_no ? <span className="text-xs text-ink-muted"> · {sh.bl_no}</span> : null}</span> : <span className="text-xs text-ink-faint">—</span>; } },
              { key: "c", header: "Charges", cell: (r) => <span className="text-xs text-ink-2">{Array.from(new Set(((r.charges as { component: string; is_active: boolean }[]) ?? []).filter((x) => x.is_active).map((x) => compLabel(x.component)))).join(", ")}</span> },
              { key: "t", header: "Total PKR", width: "130px", align: "right", cell: (r) => <span className="tabular-nums">{money(((r.charges as { amount_pkr: number; is_active: boolean }[]) ?? []).filter((x) => x.is_active).reduce((a, x) => a + Number(x.amount_pkr), 0))}</span> },
              { key: "st", header: "Status", width: "150px", cell: (r) => {
                const open = ((r.charges as { is_active: boolean; payee_type: string; settled_by: string | null }[]) ?? []).filter((x) => x.is_active && x.payee_type === "ESTIMATE" && !x.settled_by).length;
                return <span className="flex gap-1"><Badge tone={TONE[String(r.status)]}>{String(r.status).toLowerCase()}</Badge>{r.status === "POSTED" && open > 0 && <Badge tone="warning">estimate</Badge>}</span>;
              } },
            ]}
            empty={<EmptyState icon={icon} title="No landed cost yet" description="Open a shipment that has been received and use “Add landed cost”, or start one here." />} />
        )}
      </Card>
      {recording && <RecordImportCostDialog shipmentId={null} onClose={() => setRecording(false)} />}
      {(creating || view) && <LandedCostDialog id={view} shipmentId={params.get("shipment")} onClose={() => update({ view: null, new: null, shipment: null })} onSaved={(id) => update({ view: id, new: null, shipment: null })} />}
    </div>
  );
}

function LandedCostDialog({ id, shipmentId, onClose, onSaved }: { id: string | null; shipmentId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { companyId, company } = useAccess();
  const c = useCan();
  const navigate = useNavigate();
  const files = useAttachments("landed_costs", id);
  const idem = React.useRef(crypto.randomUUID());
  const doc = useQuery({
    queryKey: ["record", "landed_costs", id], enabled: !!id,
    queryFn: async () => {
      const [h, ch, t] = await Promise.all([
        sb().from("landed_costs").select("*, shipment:shipments(doc_no, bl_no)").eq("id", id!).single(),
        sb().from("landed_cost_charges").select("*, supplier:suppliers(name), bank:bank_accounts(name), bill:supplier_bills(id, doc_no), recorded:import_costs!landed_cost_charges_import_cost_id_fkey(reference, cost_date, rbill:supplier_bills(doc_no), entry:journal_entries(entry_no), rsup:suppliers(name), rbank:bank_accounts(name)), jline:journal_lines(entry_date, description, entry:journal_entries(entry_no), account:chart_of_accounts(name))").eq("landed_cost_id", id!).eq("is_active", true).order("line_no"),
        sb().from("landed_cost_targets").select("receipt_line_id, receipt:goods_receipt_lines(receipt_id)").eq("landed_cost_id", id!).eq("is_active", true),
      ]);
      if (h.error) throw h.error;
      if (ch.error) throw ch.error;
      return { h: h.data as Row, charges: (ch.data ?? []) as Row[], targets: (t.data ?? []) as unknown as Row[] };
    },
  });
  const h = doc.data?.h;
  const st = String(h?.status ?? "DRAFT");
  const draft = st === "DRAFT";
  const editable = draft && c.manage;
  const [ship, setShip] = React.useState<string | null>(shipmentId);
  const [date, setDate] = React.useState(today());
  const [notes, setNotes] = React.useState("");
  const [receipts, setReceipts] = React.useState<string[]>([]);
  const [addReceipt, setAddReceipt] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Set<string> | null>(null);
  const [charges, setCharges] = React.useState<Charge[]>([newCharge("FREIGHT")]);
  const [tab, setTab] = React.useState("charges");
  const [ask, setAsk] = React.useState<null | "post" | "reverse" | "cancel">(null);
  const [pick, setPick] = React.useState(false);
  const addRecorded = (rows: ImportCost[], ex: ExpenseEntry[]) => {
    setCharges((x) => [...x.filter((y) => y.amount.trim() !== "" || y.import_cost_id || y.journal_line_id), ...ex.map((r) => ({ ...newCharge(/freight/i.test(r.account_name) ? "FREIGHT" : "OTHER"),
      description: r.description ?? r.account_name, payee_type: "BILLED", reference: r.reference ?? "", amount: String(Number(r.amount)), journal_line_id: r.journal_line_id, method: "VALUE",
      recorded: `${formatDate(r.entry_date)} · ${r.entry_no} · ${r.account_name}${r.party_name ?? r.paid_from ? ` · ${r.party_name ?? r.paid_from}` : ""}` })), ...rows.map((r) => ({ ...newCharge(r.component), description: r.description ?? "", payee_type: "BILLED",
      reference: r.reference ?? "", amount: String(Number(r.amount_pkr)), import_cost_id: r.id,
      recorded: `${formatDate(r.cost_date)} · ${r.bill?.doc_no ?? r.entry?.entry_no ?? ""} · ${r.supplier?.name ?? r.bank?.name ?? ""}${r.currency !== "PKR" ? ` · ${r.currency} ${money(r.amount)}` : ""}` }))]);
    setPick(false);
  };
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (!doc.data) return;
    const x = doc.data.h;
    setShip((x.shipment_id as string) ?? null); setDate(x.doc_date as string); setNotes((x.notes as string) ?? "");
    const tr = doc.data.targets;
    setPicked(new Set(tr.map((t) => t.receipt_line_id as string)));
    if (!x.shipment_id) setReceipts(Array.from(new Set(tr.map((t) => (t.receipt as { receipt_id: string } | null)?.receipt_id).filter(Boolean) as string[])));
    setCharges(doc.data.charges.length ? doc.data.charges.map((k) => ({ key: k.id, component: String(k.component), description: (k.description as string) ?? "", payee_type: String(k.payee_type),
      supplier_id: (k.supplier_id as string) ?? null, bank_account_id: (k.bank_account_id as string) ?? null, reference: (k.reference as string) ?? "", currency: String(k.currency), fx_rate: String(k.fx_rate),
      amount: String(Number(k.amount)), treatment: String(k.treatment), expense_account_id: (k.expense_account_id as string) ?? null, method: String(k.method),
      manual: Object.fromEntries(Object.entries((k.manual as Record<string, unknown>) ?? {}).map(([a, b]) => [a, String(b)])), settles_charge_id: (k.settles_charge_id as string) ?? null, import_cost_id: (k.import_cost_id as string) ?? null, journal_line_id: (k.journal_line_id as string) ?? null, recorded: recordedLabel(k.recorded as RecRow | null) ?? jlineLabel(k.jline as JRow | null) })) : [newCharge()]);
  }, [doc.data]);

  const cands = useQuery({
    queryKey: ["lc-candidates", ship, receipts.join()], enabled: !!ship || receipts.length > 0,
    queryFn: async () => (await rpc<Cand[]>("lc_candidate_lines", { p_company: companyId, p_shipment_id: ship, p_receipt_ids: receipts.length ? receipts : null })) ?? [],
  });
  const estimates = useQuery({
    queryKey: ["lc-estimates", ship], enabled: editable,
    queryFn: async () => (await rpc<{ charge_id: string; doc_no: string; component: string; description: string | null; amount_pkr: number; shipment_no: string | null }[]>("open_landed_cost_estimates", { p_company: companyId, p_shipment_id: ship })) ?? [],
  });
  const freightAcc = useQuery({ queryKey: ["sys-account", "FREIGHT", companyId], queryFn: async () => (await sb().from("chart_of_accounts").select("id").eq("company_id", companyId!).eq("system_key", "FREIGHT").maybeSingle()).data?.id as string | undefined });
  const posted = useQuery({ queryKey: ["lc-allocs", id, st], enabled: !!id && !draft, queryFn: async () => (await rpc<{ charge_id: string; receipt_line_id: string; amount_pkr: number }[]>("lc_preview", { p_id: id })) ?? [] });

  const all = cands.data ?? [];
  const chosen = all.filter((l) => !picked || picked.has(l.receipt_line_id));
  const setCh = (k: string, p: Partial<Charge>) => setCharges((x) => x.map((y) => (y.key === k ? { ...y, ...p } : y)));
  const splits = charges.map((ch) => ({ ch, s: splitCharge(ch, chosen) }));
  const errors = splits.filter((x) => typeof x.s === "string").map((x) => `${compLabel(x.ch.component)}: ${x.s as string}`);
  const postedMap = new Map<string, Map<string, number>>();
  for (const a of posted.data ?? []) { if (!postedMap.has(a.charge_id)) postedMap.set(a.charge_id, new Map()); postedMap.get(a.charge_id)!.set(a.receipt_line_id, Number(a.amount_pkr)); }
  const splitMap = new Map(splits.map((x) => [x.ch.key, x.s]));
  const share = (ch: Charge, line: string) => {
    if (!draft) return postedMap.get(ch.key)?.get(line) ?? 0;
    const m = splitMap.get(ch.key);
    return m && typeof m !== "string" ? m.get(line) ?? 0 : 0;
  };
  const capCharges = charges.filter((ch) => draft ? ch.treatment === "CAPITALIZE" && !ch.settles_charge_id : postedMap.has(ch.key));
  const total = charges.reduce((a, ch) => a + pkr(ch), 0);
  const capTotal = draft ? capCharges.reduce((a, ch) => a + pkr(ch), 0) : (posted.data ?? []).reduce((a, x) => a + Number(x.amount_pkr), 0);
  const lineRows = (draft ? chosen : all.filter((l) => (posted.data ?? []).some((a) => a.receipt_line_id === l.receipt_line_id)));

  const payload = () => ({
    p_header: { company_id: companyId, doc_date: date, shipment_id: ship, notes },
    p_targets: chosen.map((l) => l.receipt_line_id),
    p_charges: charges.filter((ch) => ch.amount.trim() !== "").map((ch) => ({ component: ch.component, description: ch.description || null, payee_type: ch.payee_type,
      supplier_id: ch.supplier_id, bank_account_id: ch.bank_account_id, reference: ch.reference || null, currency: ch.payee_type === "BANK" ? "PKR" : ch.currency, fx_rate: ch.payee_type === "BANK" ? 1 : num(ch.fx_rate) || 0,
      amount: num(ch.amount), treatment: ch.treatment, expense_account_id: ch.treatment === "EXPENSE" ? ch.expense_account_id ?? freightAcc.data ?? null : null,
      method: ch.method, manual: Object.fromEntries(Object.entries(ch.manual).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, num(v)])), settles_charge_id: ch.settles_charge_id, import_cost_id: ch.import_cost_id, journal_line_id: ch.journal_line_id })),
  });
  const save = useAction(async () => {
    const nid = await rpc<string>("save_landed_cost", { p_id: id, ...payload(), p_idempotency_key: id ? null : idem.current });
    return nid;
  }, "Saved");
  const post = useAction(async () => {
    const nid = await rpc<string>("save_landed_cost", { p_id: id, ...payload(), p_idempotency_key: id ? null : idem.current });
    await rpc("post_landed_cost", { p_id: nid });
    return nid;
  }, "Landed cost posted — the goods now carry it in their cost");
  const reverse = useAction(() => rpc("reverse_landed_cost", { p_id: id, p_reason: reason, p_date: null }), "Landed cost reversed", () => { setAsk(null); setReason(""); });
  const cancel = useAction(() => rpc("cancel_landed_cost", { p_id: id }), "Draft cancelled", () => { setAsk(null); onClose(); });

  const print = () => {
    if (!h) return;
    printDocument({ docType: "LANDED_COST", company: company?.company_name ?? "", title: "Landed cost", docNo: String(h.doc_no),
      meta: [["Date", formatDate(h.doc_date as string)], ["Shipment", (h.shipment as { doc_no: string } | null)?.doc_no ?? ""], ["Status", st.toLowerCase()]],
      columns: [{ label: "Charge" }, { label: "Paid / owed to" }, { label: "Treatment" }, { label: "Split" }, { label: "PKR", align: "right" }],
      rows: (doc.data?.charges ?? []).map((k) => [`${compLabel(String(k.component))}${k.description ? ` — ${k.description}` : ""}`,
        (k.supplier as { name: string } | null)?.name ?? (k.bank as { name: string } | null)?.name ?? (k.payee_type === "ESTIMATE" ? "Estimate" : "Landed cost clearing"),
        k.treatment === "EXPENSE" ? "Expense" : "Stock cost", METHODS.find(([m]) => m === k.method)?.[1] ?? "", money(k.amount_pkr as number)]),
      totals: [["Total", money(total)]], notes: (h.notes as string) ?? null, signatures: ["Prepared by", "Approved by"] });
  };

  const shipLabel = h?.shipment as { doc_no: string; bl_no: string | null } | null | undefined;
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="bill" icon={icon} title={h ? String(h.doc_no) : "New landed cost"}
        subtitle={shipLabel ? `Shipment ${shipLabel.doc_no}${shipLabel.bl_no ? ` · B/L ${shipLabel.bl_no}` : ""}` : undefined} status={h ? <Badge tone={TONE[st]}>{st.toLowerCase()}</Badge> : null}
        footer={<>
          {id && draft && c.manage && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel draft</Button>}
          {st === "POSTED" && c.approve && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk("reverse")}>Reverse</Button>}
          <div className="flex-1 text-right text-sm text-ink-muted">Total <b className="tabular-nums text-ink">PKR {money(total)}</b>{capTotal !== total && <span className="ml-2 text-xs">· {money(capTotal)} on stock cost</span>}</div>
          {ship && <Button icon={<Ship className="h-3.5 w-3.5" />} onClick={() => navigate(`/shipments?view=${ship}`)}>Shipment</Button>}
          {h?.journal_entry_id ? <Button icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/vouchers?view=${h.journal_entry_id}`)}>Accounting entry</Button> : null}
          {id && <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>}
          <Button onClick={onClose}>Close</Button>
          {editable && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (nid) => { idem.current = crypto.randomUUID(); onSaved(nid as string); } })}>Save draft</Button>}
          {editable && c.approve && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={errors.length > 0 || total <= 0} title={errors[0]} onClick={() => setAsk("post")}>Post</Button>}
        </>}>
        {id && doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : (
          <>
            <FormGrid cols={4} className="mb-3">
              <Field label="Shipment" className="sm:col-span-2" hint={!ship ? "Or add goods receipts below (local purchases)" : undefined}>
                <LookupPicker value={ship} onChange={(v) => { setShip(v); setPicked(null); }} disabled={!editable} placeholder="Choose the shipment…" spec={{ table: "shipments", label: "doc_no", secondary: "bl_no" }} />
              </Field>
              <Field label="Date"><Input type="date" disabled={!editable} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              {!ship && editable && <Field label="Add a goods receipt"><LookupPicker value={addReceipt} placeholder="GRN…" spec={{ table: "goods_receipts", label: "doc_no", secondary: "doc_date", filters: { status: "POSTED" } }}
                onChange={(v) => { if (v && !receipts.includes(v)) setReceipts((x) => [...x, v]); setAddReceipt(null); }} /></Field>}
            </FormGrid>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "charges", label: `Charges (${charges.length})` }, { key: "goods", label: `Goods & split (${lineRows.length})` },
              ...(id ? [{ key: "files", label: filesLabel(files.data?.length) }, { key: "history", label: "History" }] : [])]} />
            {tab === "charges" && (
              <div className="space-y-2">
                {charges.map((ch, i) => (
                  <ChargeCard key={ch.key} ch={ch} n={i + 1} editable={editable} lines={chosen} estimates={estimates.data ?? []} error={typeof splits[i]?.s === "string" ? (splits[i].s as string) : undefined}
                    bill={doc.data?.charges.find((k) => k.id === ch.key)?.bill as { id: string; doc_no: string } | null | undefined}
                    onChange={(p) => setCh(ch.key, p)} onRemove={charges.length > 1 ? () => setCharges((x) => x.filter((y) => y.key !== ch.key)) : undefined} />
                ))}
                {editable && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setPick(true)}>Pick costs</Button>
                    {COMPONENTS.map(([k, l]) => <Button key={k} size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCharges((x) => [...x, newCharge(k)])}>{l}</Button>)}
                  </div>
                )}
                <Field label="Notes"><Textarea rows={2} disabled={!editable} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              </div>
            )}
            {tab === "goods" && (
              <>
                {!ship && receipts.length === 0 ? <p className="text-sm text-ink-muted">Choose the shipment (or add goods receipts) to see the goods.</p> : (
                  <div className="overflow-x-auto rounded-card border border-line">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead className="bg-subtle"><tr>
                        {editable && <th className={cn(th, "w-8")} />}<th className={th}>Item</th><th className={cn(th, "w-24")}>Receipt</th><th className={cn(th, "w-20 text-right")}>Qty</th>
                        <th className={cn(th, "w-24 text-right")}>Weight</th><th className={cn(th, "w-24 text-right")}>Unit cost</th>
                        {capCharges.map((ch) => <th key={ch.key} className={cn(th, "w-28 text-right")}>{compLabel(ch.component)}</th>)}
                        <th className={cn(th, "w-28 text-right")}>Landed</th><th className={cn(th, "w-28 text-right")}>New unit cost</th>
                      </tr></thead>
                      <tbody>{(editable ? all : lineRows).map((l) => {
                        const on = !picked || picked.has(l.receipt_line_id);
                        const add = capCharges.reduce((a, ch) => a + (on ? share(ch, l.receipt_line_id) : 0), 0);
                        const before = draft ? Number(l.landed_pkr) : Number(l.landed_pkr) - (st === "POSTED" ? add : 0);
                        const unit = l.unit_cost_pkr == null ? null : (Number(l.quantity) * Number(l.unit_cost_pkr) + before + add) / Number(l.quantity);
                        return (
                          <tr key={l.receipt_line_id} className={cn(!on && "opacity-50")}>
                            {editable && <td className={td}><input type="checkbox" checked={on} onChange={(e) => setPicked(() => { const nx = new Set(picked ?? all.map((x) => x.receipt_line_id)); e.target.checked ? nx.add(l.receipt_line_id) : nx.delete(l.receipt_line_id); return nx; })} /></td>}
                            <td className={td}>{l.product_name}{l.variant_name ? <span className="text-ink-muted"> · {l.variant_name}</span> : null}</td>
                            <td className={cn(td, "font-mono text-xs")}>{l.receipt_no}</td>
                            <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.quantity)} <span className="text-2xs text-ink-muted">{l.uom}</span></td>
                            <td className={cn(td, "text-right tabular-nums")}>{Number(l.weight_kg) ? `${qtyFmt(l.weight_kg)} kg` : <span className="text-ink-faint">—</span>}</td>
                            <td className={cn(td, "text-right tabular-nums")}>{l.unit_cost_pkr == null ? <Badge tone="warning">pending</Badge> : money(l.unit_cost_pkr)}</td>
                            {capCharges.map((ch) => <td key={ch.key} className={cn(td, "text-right tabular-nums")}>{on ? money(share(ch, l.receipt_line_id)) : ""}</td>)}
                            <td className={cn(td, "text-right font-medium tabular-nums")}>{money(add)}</td>
                            <td className={cn(td, "text-right font-semibold tabular-nums")}>{unit == null ? "—" : money(unit)}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                )}
                {editable && errors.length > 0 && <p className="mt-2 text-xs text-danger">{errors.join(" · ")}</p>}
                <p className="mt-2 text-xs text-ink-muted">“New unit cost” = purchase cost + all landed cost so far, per unit. Goods already sold take their share straight into cost of goods sold. An actual bill that replaces an estimate moves only the difference, split like the estimate was.</p>
              </>
            )}
            {tab === "files" && id && <AttachmentsPanel entityType="landed_costs" entityId={id} />}
            {tab === "history" && id && <AuditTimeline table="landed_costs" id={id} />}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask === "post"} title="Post this landed cost?" loading={post.isPending} confirmLabel="Post" onCancel={() => setAsk(null)}
        onConfirm={() => post.mutate(undefined, { onSuccess: (nid) => { setAsk(null); onSaved(nid as string); } })}
        message={`PKR ${money(capTotal)} is added to the cost of the goods; ${money(total - capTotal)} goes to expenses or replaces estimates. Charges billed by a forwarder / agent become supplier bills you can pay from Supplier Bills; estimates wait on “Accrued Import Costs” until the actual bill replaces them.`} />
      <ConfirmDialog open={ask === "reverse"} title="Reverse this landed cost?" tone="destructive" confirmLabel="Reverse" loading={reverse.isPending} onCancel={() => setAsk(null)} onConfirm={() => reverse.mutate(undefined)}
        message="The goods' cost goes back, the accounting entry and the supplier bills it made are reversed (bills that were already paid must be unlinked from their payments first).">
        <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      {pick && <PickImportCostsDialog shipmentId={ship} exclude={charges.map((x) => x.import_cost_id).filter(Boolean) as string[]} excludeLines={charges.map((x) => x.journal_line_id).filter(Boolean) as string[]} onClose={() => setPick(false)} onPick={addRecorded} />}
      <ConfirmDialog open={ask === "cancel"} title="Cancel this draft?" tone="destructive" confirmLabel="Cancel draft" loading={cancel.isPending} onCancel={() => setAsk(null)} onConfirm={() => cancel.mutate(undefined)} message="Nothing has been posted from it." />
    </>
  );
}

function ChargeCard({ ch, n, editable, lines, estimates, error, bill, onChange, onRemove }: {
  ch: Charge; n: number; editable: boolean; lines: Cand[]; estimates: { charge_id: string; doc_no: string; component: string; description: string | null; amount_pkr: number; shipment_no: string | null }[];
  error?: string; bill?: { id: string; doc_no: string } | null; onChange: (p: Partial<Charge>) => void; onRemove?: () => void;
}) {
  const navigate = useNavigate();
  const est = estimates.find((e) => e.charge_id === ch.settles_charge_id);
  const myEstimates = estimates.filter((e) => e.component === ch.component || e.charge_id === ch.settles_charge_id);
  return (
    <div className={cn("rounded-card border p-3", error && editable ? "border-danger/50" : "border-line")}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700">{n}</span>
        <select className={cn(sel, "w-56 font-medium")} disabled={!editable} value={ch.component} onChange={(e) => onChange({ component: e.target.value })}>{COMPONENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <Input className="flex-1" disabled={!editable} placeholder="Description (optional)" value={ch.description} onChange={(e) => onChange({ description: e.target.value })} />
        {bill && <Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/supplier-bills?view=${bill.id}`)}>{bill.doc_no}</Button>}
        {editable && onRemove && <Button size="icon-sm" variant="destructive-ghost" aria-label="Remove charge" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
      {(ch.import_cost_id || ch.journal_line_id) && <div className="mb-2 flex items-center gap-2 rounded-control bg-emerald-50 px-2 py-1 text-xs text-emerald-800"><Badge tone="success">{ch.journal_line_id ? "Booked expense" : "Recorded cost"}</Badge>{ch.recorded}</div>}
      <FormGrid cols={4}>
        {!(ch.import_cost_id || ch.journal_line_id) && <Field label="Paid how">
          <select className={sel} disabled={!editable} value={ch.payee_type} onChange={(e) => onChange({ payee_type: e.target.value, ...(e.target.value === "ESTIMATE" ? { settles_charge_id: null } : {}) })}>
            {PAYEES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>}
        {ch.payee_type === "SUPPLIER" && <Field label="Forwarder / agent" required><LookupPicker value={ch.supplier_id} onChange={(v) => onChange({ supplier_id: v })} disabled={!editable} clearable={false} placeholder="Who billed it…" spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} /></Field>}
        {ch.payee_type === "BANK" && <Field label="Paid from" required><BankPicker value={ch.bank_account_id} onChange={(v) => onChange({ bank_account_id: v })} disabled={!editable} /></Field>}
        {!(ch.import_cost_id || ch.journal_line_id) && (ch.payee_type === "BILLED" || ch.payee_type === "ESTIMATE") && <div className="hidden sm:block" />}
        <Field label={ch.payee_type === "BANK" ? "Cheque / reference" : "Bill / GD / reference no."}><Input disabled={!editable || !!(ch.import_cost_id || ch.journal_line_id)} value={ch.reference} onChange={(e) => onChange({ reference: e.target.value })} /></Field>
        <Field label="Amount" required hint={ch.currency !== "PKR" && ch.payee_type !== "BANK" ? `= PKR ${money(pkr(ch))}` : undefined}>
          <div className="flex gap-1.5">
            <Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable || !!(ch.import_cost_id || ch.journal_line_id)} value={ch.amount} onChange={(e) => onChange({ amount: e.target.value })} />
            {ch.payee_type !== "BANK" && !(ch.import_cost_id || ch.journal_line_id) && <CurrencyInput currency={ch.currency} rate={ch.fx_rate} disabled={!editable} onCurrency={(v) => onChange({ currency: v })} onRate={(v) => onChange({ fx_rate: v })} />}
          </div>
        </Field>
        {ch.payee_type !== "ESTIMATE" && myEstimates.length > 0 && (
          <Field label="Replaces estimate" className="sm:col-span-2" hint={est ? `Estimate PKR ${money(est.amount_pkr)} → only the difference ${money(pkr(ch) - Number(est.amount_pkr))} changes the goods' cost` : undefined}>
            <select className={sel} disabled={!editable} value={ch.settles_charge_id ?? ""} onChange={(e) => onChange({ settles_charge_id: e.target.value || null })}>
              <option value="">— no, a new charge —</option>
              {myEstimates.map((e) => <option key={e.charge_id} value={e.charge_id}>{e.doc_no} · {compLabel(e.component)}{e.description ? ` (${e.description})` : ""} · PKR {money(e.amount_pkr)}</option>)}
            </select>
          </Field>
        )}
        {!ch.settles_charge_id && (
          <Field label="Goes to">
            <select className={sel} disabled={!editable} value={ch.treatment} onChange={(e) => onChange({ treatment: e.target.value })}>
              <option value="CAPITALIZE">Cost of the goods</option><option value="EXPENSE">Expense (not in stock cost)</option>
            </select>
          </Field>
        )}
        {!ch.settles_charge_id && ch.treatment === "EXPENSE" && <Field label="Expense account"><AccountPicker value={ch.expense_account_id} onChange={(v) => onChange({ expense_account_id: v })} disabled={!editable} accountType="EXPENSE" placeholder="Freight & Clearing" /></Field>}
        {!ch.settles_charge_id && ch.treatment === "CAPITALIZE" && (
          <Field label="Split over the goods">
            <select className={sel} disabled={!editable} value={ch.method} onChange={(e) => onChange({ method: e.target.value })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
        )}
      </FormGrid>
      {!ch.settles_charge_id && ch.treatment === "CAPITALIZE" && (ch.method === "PERCENT" || ch.method === "MANUAL") && (
        <div className="mt-2 rounded-control bg-subtle/60 p-2">
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">{ch.method === "PERCENT" ? "Percentage for each item (must make 100)" : `Amount for each item (must make PKR ${money(pkr(ch))})`}</div>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {lines.map((l) => (
              <label key={l.receipt_line_id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{l.product_name}{l.variant_name ? ` · ${l.variant_name}` : ""} <span className="text-ink-faint">({l.receipt_no})</span></span>
                <Input className="h-control-sm w-24 text-right tabular-nums" inputMode="decimal" disabled={!editable} value={ch.manual[l.receipt_line_id] ?? ""}
                  onChange={(e) => onChange({ manual: { ...ch.manual, [l.receipt_line_id]: e.target.value } })} />
              </label>
            ))}
          </div>
        </div>
      )}
      {error && editable && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
