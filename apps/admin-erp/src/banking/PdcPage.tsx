import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, Ban, CheckCircle2, FileText, Landmark, Plus, Repeat, RotateCcw, ShieldAlert, StickyNote, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { formatDate, formatDateTime } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { BankPicker, PartyPicker, money, num, today } from "../accounting/common";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { rpc, useAction } from "../purchasing/common";

type Row = Record<string, unknown> & { id: string };
type Dir = "RECEIVED" | "ISSUED";
const icon = <Landmark className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";
export const PDC_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { HELD: "info", DEPOSITED: "warning", CLEARED: "success", BOUNCED: "danger", RETURNED: "neutral", CANCELLED: "neutral" };
const statusLabel = (r: Row) => (r.status === "HELD" ? (r.is_due ? "due" : r.direction === "ISSUED" ? "issued" : "in hand") : String(r.status).toLowerCase());
const FILTERS = [
  { label: "Open", status: "OPEN" }, { label: "Due", status: "DUE" }, { label: "Deposited", status: "DEPOSITED" }, { label: "Bounced", status: "BOUNCED" }, { label: "Cleared", status: "CLEARED" }, { label: "All" },
] as { label: string; status?: string }[];
const EVENT_LABEL: Record<string, string> = { RECEIVED: "Received", ISSUED: "Issued", DEPOSITED: "Deposited", UNDO_DEPOSIT: "Deposit taken back", CLEARED: "Cleared", UNDO_CLEAR: "Clearing undone",
  BOUNCED: "Bounced", BANK_CHARGES: "Bank charges", RE_PRESENTED: "Re-presented", RETURNED: "Returned to party", CANCELLED: "Cancelled", NOTE: "Note" };

export function PdcPage() {
  const { companyId, can } = useAccess();
  const { params, update } = useUrlState();
  const dir = (params.get("dir") as Dir) ?? "RECEIVED";
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("view");
  const [creating, setCreating] = React.useState(false);
  const st = FILTERS[f].status;
  const list = useEntityList<Row>({
    table: "pdc_records_v", select: "id, doc_no, direction, party_name, cheque_no, cheque_date, received_date, amount, drawer_bank, bank_name, status, is_due, days_to_due, bounce_count, allocated",
    companyId, search: q, searchColumns: ["doc_no", "cheque_no", "party_name", "drawer_bank"],
    filters: { direction: dir, status: st === "OPEN" || st === "DUE" ? undefined : st, is_due: st === "DUE" ? true : undefined },
    orderBy: { column: "cheque_date", ascending: st !== "CLEARED" && !!st }, page, pageSize: 50, enabled: can("journals.view") || can("pdc.manage"),
  });
  const summary = useQuery({ queryKey: ["pdc-summary", companyId, dir], enabled: !!companyId, queryFn: async () => {
    const { data } = await sb().from("pdc_records_v").select("status, amount, is_due, days_to_due").eq("company_id", companyId!).eq("direction", dir).in("status", ["HELD", "DEPOSITED", "BOUNCED"]);
    const rows = (data ?? []) as { status: string; amount: number; is_due: boolean; days_to_due: number | null }[];
    const s = (p: (r: (typeof rows)[number]) => boolean) => rows.filter(p).reduce((a, r) => a + Number(r.amount), 0);
    return { hand: s((r) => r.status === "HELD"), due: s((r) => r.is_due), week: s((r) => r.status !== "BOUNCED" && r.days_to_due != null && r.days_to_due > 0 && r.days_to_due <= 7), dep: s((r) => r.status === "DEPOSITED"), bounced: s((r) => r.status === "BOUNCED") };
  } });
  if (!(can("journals.view") || can("pdc.manage"))) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Cheques are restricted." /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) => st !== "OPEN" || ["HELD", "DEPOSITED", "BOUNCED"].includes(String(r.status)));
  const sm = summary.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Post-dated Cheques" icon={icon}
        description={dir === "RECEIVED" ? "Cheques received from customers. The customer's account is credited when the cheque is received (it sits in “cheques in hand”); the money reaches the bank when it clears. A bounce puts the amount back on the customer's account."
          : "Cheques we issued to suppliers. The supplier's account is debited when the cheque is handed over (“cheques issued”); the bank is paid out when it clears. A bounce puts the amount back on the supplier's account."}
        actions={can("pdc.manage") && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>{dir === "RECEIVED" ? "Cheque received" : "Cheque issued"}</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex rounded-control border border-line bg-subtle p-0.5">
          {(["RECEIVED", "ISSUED"] as Dir[]).map((d) => (
            <button key={d} type="button" onClick={() => update({ dir: d === "RECEIVED" ? null : d, page: null, view: null })}
              className={cn("h-[30px] rounded-[6px] px-3 text-sm font-medium", dir === d ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>
              {d === "RECEIVED" ? "Received from customers" : "Issued to suppliers"}
            </button>
          ))}
        </div>
        {sm && <div className="flex flex-wrap gap-2 text-sm">
          <Chip k={dir === "RECEIVED" ? "In hand" : "Issued, not cleared"} v={sm.hand} />
          <Chip k="Due now" v={sm.due} hot={sm.due > 0} />
          <Chip k="Due in 7 days" v={sm.week} />
          {dir === "RECEIVED" && <Chip k="Deposited" v={sm.dep} />}
          <Chip k="Bounced" v={sm.bounced} hot={sm.bounced > 0} />
        </div>}
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search cheque no. / party / bank…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id })} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "c", header: "Cheque", width: "150px", cell: (r) => <span><span className="font-mono text-xs font-medium">{String(r.cheque_no)}</span><div className="text-2xs text-ink-muted">{String(r.doc_no)}</div></span> },
              { key: "d", header: "Cheque date", width: "120px", cell: (r) => <span>{formatDate(r.cheque_date as string)}{r.days_to_due != null && Number(r.days_to_due) > 0 && <div className="text-2xs text-ink-muted">in {String(r.days_to_due)} day(s)</div>}</span> },
              { key: "p", header: dir === "RECEIVED" ? "From" : "To", cell: (r) => <span>{String(r.party_name)}{r.drawer_bank ? <span className="text-xs text-ink-muted"> · {String(r.drawer_bank)}</span> : null}</span> },
              { key: "b", header: dir === "RECEIVED" ? "Deposited in" : "Drawn on", width: "170px", hideBelow: "md", cell: (r) => <span className="text-xs">{String(r.bank_name ?? "")}</span> },
              { key: "a", header: "Amount", width: "130px", align: "right", cell: (r) => <b className="tabular-nums">{money(r.amount as number)}</b> },
              { key: "s", header: "Status", width: "130px", cell: (r) => <span><Badge tone={r.is_due ? "warning" : PDC_TONE[String(r.status)]}>{statusLabel(r)}</Badge>{Number(r.bounce_count) > 0 && r.status !== "BOUNCED" ? <span className="ml-1 text-2xs text-danger">bounced ×{String(r.bounce_count)}</span> : null}</span> },
            ]}
            empty={<EmptyState icon={icon} title="No cheques" description={dir === "RECEIVED" ? "Record post-dated cheques received from customers." : "Record cheques issued to suppliers."} />} />
        )}
      </Card>
      {creating && <NewPdcDialog direction={dir} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); update({ view: id }); }} />}
      {view && <PdcDialog id={view} onClose={() => update({ view: null })} />}
    </div>
  );
}

function Chip({ k, v, hot }: { k: string; v: number; hot?: boolean }) {
  return <span className={cn("rounded-control border px-2.5 py-1", hot ? "border-red-200 bg-red-50 text-danger" : "border-line bg-surface")}>{k} <b className="tabular-nums">{money(v)}</b></span>;
}

interface OpenDoc { id: string; doc_no: string; date: string; outstanding: number }
function NewPdcDialog({ direction, onClose, onDone }: { direction: Dir; onClose: () => void; onDone: (id: string) => void }) {
  const { companyId } = useAccess();
  const idem = React.useRef(crypto.randomUUID());
  const [f, setF] = React.useState({ party: null as string | null, cheque_no: "", cheque_date: "", received_date: today(), amount: "", drawer_bank: "", drawer_branch: "", drawer_account: "", bank: null as string | null, reference: "", notes: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const [alloc, setAlloc] = React.useState<Record<string, string>>({});
  const docs = useQuery({ queryKey: ["pdc-open-docs", direction, f.party], enabled: !!f.party, queryFn: async () => {
    if (direction === "RECEIVED") {
      const { data } = await sb().from("sales_invoices_v").select("id, doc_no, invoice_date, outstanding").eq("customer_id", f.party!).eq("status", "POSTED").gt("outstanding", 0).order("invoice_date");
      return ((data ?? []) as { id: string; doc_no: string; invoice_date: string; outstanding: number }[]).map((d) => ({ id: d.id, doc_no: d.doc_no, date: d.invoice_date, outstanding: Number(d.outstanding) })) as OpenDoc[];
    }
    const { data } = await sb().from("supplier_bills_v").select("id, doc_no, bill_date, outstanding_pkr").eq("supplier_id", f.party!).eq("status", "POSTED").eq("currency", "PKR").gt("outstanding_pkr", 0).order("bill_date");
    return ((data ?? []) as { id: string; doc_no: string; bill_date: string; outstanding_pkr: number }[]).map((d) => ({ id: d.id, doc_no: d.doc_no, date: d.bill_date, outstanding: Number(d.outstanding_pkr) })) as OpenDoc[];
  } });
  const amt = num(f.amount) || 0;
  const used = Object.values(alloc).reduce((s, v) => s + (num(v) || 0), 0);
  const fillOldest = () => { let left = amt; const n: Record<string, string> = {}; for (const d of docs.data ?? []) { if (left <= 0) break; const x = Math.min(left, d.outstanding); n[d.id] = String(x); left -= x; } setAlloc(n); };
  const go = useAction(() => rpc<string>("save_pdc", { p_header: { company_id: companyId, direction, party_id: f.party, cheque_no: f.cheque_no, cheque_date: f.cheque_date, received_date: f.received_date, amount: amt,
    drawer_bank: f.drawer_bank, drawer_branch: f.drawer_branch, drawer_account: f.drawer_account, bank_account_id: f.bank, reference: f.reference, notes: f.notes },
    p_allocations: Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([id, v]) => (direction === "RECEIVED" ? { invoice_id: id, amount: num(v) } : { bill_id: id, amount: num(v) })),
    p_idempotency_key: idem.current }), "Cheque recorded");
  const errs: string[] = [];
  if (!f.party) errs.push(direction === "RECEIVED" ? "Choose the customer" : "Choose the supplier");
  if (!f.cheque_no.trim()) errs.push("Enter the cheque number");
  if (!f.cheque_date) errs.push("Enter the date on the cheque");
  if (!(amt > 0)) errs.push("Enter the amount");
  if (direction === "ISSUED" && !f.bank) errs.push("Choose our bank account");
  if (used > amt + 0.001) errs.push("Allocated more than the cheque");
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title={direction === "RECEIVED" ? "Cheque received" : "Cheque issued"}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={go.isPending} onClick={() => (errs.length ? toast.error(errs[0]) : go.mutate(undefined, { onSuccess: (id) => onDone(id as string), onError: () => { idem.current = crypto.randomUUID(); } }))}>Record cheque</Button></>}>
      <FormGrid cols={3} className="mb-3">
        <Field label={direction === "RECEIVED" ? "Customer" : "Supplier"} required className="sm:col-span-2"><PartyPicker type={direction === "RECEIVED" ? "CUSTOMER" : "SUPPLIER"} value={f.party} onChange={(v) => { set("party", v); setAlloc({}); }} /></Field>
        <Field label="Amount (PKR)" required><Input className="text-right tabular-nums" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
        <Field label="Cheque no." required><Input value={f.cheque_no} onChange={(e) => set("cheque_no", e.target.value)} /></Field>
        <Field label="Date on the cheque" required hint="When it can be presented"><Input type="date" value={f.cheque_date} onChange={(e) => set("cheque_date", e.target.value)} /></Field>
        <Field label={direction === "RECEIVED" ? "Received on" : "Handed over on"}><Input type="date" value={f.received_date} onChange={(e) => set("received_date", e.target.value)} /></Field>
        {direction === "RECEIVED" ? <>
          <Field label="Customer's bank"><Input value={f.drawer_bank} placeholder="e.g. HBL" onChange={(e) => set("drawer_bank", e.target.value)} /></Field>
          <Field label="Branch"><Input value={f.drawer_branch} onChange={(e) => set("drawer_branch", e.target.value)} /></Field>
          <Field label="Account no."><Input value={f.drawer_account} onChange={(e) => set("drawer_account", e.target.value)} /></Field>
        </> : <Field label="Drawn on (our bank)" required className="sm:col-span-3"><BankPicker value={f.bank} onChange={(v) => set("bank", v)} /></Field>}
        <Field label="Reference"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </FormGrid>
      {f.party && (
        <>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Pays {direction === "RECEIVED" ? "invoices" : "bills"} <span className="font-normal normal-case">— optional; the rest stays on account</span>
            {(docs.data ?? []).length > 0 && amt > 0 && <Button size="sm" variant="ghost" onClick={fillOldest}>Oldest first</Button>}</div>
          {(docs.data ?? []).length === 0 ? <p className="rounded-card border border-line px-3 py-2 text-sm text-ink-muted">Nothing outstanding.</p> : (
            <div className="max-h-56 overflow-y-auto rounded-card border border-line">
              <table className="w-full text-sm">
                <thead className="bg-subtle"><tr><th className={th}>{direction === "RECEIVED" ? "Invoice" : "Bill"}</th><th className={th}>Date</th><th className={cn(th, "text-right")}>Outstanding</th><th className={cn(th, "w-36 text-right")}>Apply</th></tr></thead>
                <tbody>{(docs.data ?? []).map((d) => (
                  <tr key={d.id}><td className={cn(td, "font-mono text-xs")}>{d.doc_no}</td><td className={cn(td, "text-xs")}>{formatDate(d.date)}</td><td className={cn(td, "text-right tabular-nums")}>{money(d.outstanding)}</td>
                    <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={alloc[d.id] ?? ""} onChange={(e) => setAlloc((s) => ({ ...s, [d.id]: e.target.value }))} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ErpDialog>
  );
}

type Act = "DEPOSIT" | "CLEAR" | "BOUNCE" | "REPRESENT" | "RETURN" | "CANCEL" | "UNDO_CLEAR" | "UNDO_DEPOSIT" | "NOTE";
const ACT_LABEL: Record<Act, string> = { DEPOSIT: "Deposit in bank", CLEAR: "Mark cleared", BOUNCE: "Bounced", REPRESENT: "Re-present", RETURN: "Return to customer", CANCEL: "Cancel cheque",
  UNDO_CLEAR: "Undo clearing", UNDO_DEPOSIT: "Take back deposit", NOTE: "Add note" };

export function PdcDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAccess();
  const navigate = useNavigate();
  const files = useAttachments("pdc_records", id);
  const q = useQuery({ queryKey: ["record", "pdc_records", id], queryFn: async () => {
    const [h, ev, al] = await Promise.all([
      sb().from("pdc_records_v").select("*").eq("id", id).single(),
      sb().from("pdc_events").select("*, bank:bank_accounts(name), entry:journal_entries(entry_no)").eq("pdc_id", id).order("created_at"),
      sb().from("pdc_allocations_v").select("*").eq("pdc_id", id).eq("status", "ACTIVE"),
    ]);
    if (h.error) throw h.error;
    return { h: h.data as Row, events: (ev.data ?? []) as Row[], allocs: (al.data ?? []) as Row[] };
  } });
  const h = q.data?.h;
  const [tab, setTab] = React.useState("timeline");
  const [act, setAct] = React.useState<Act | null>(null);
  const manage = can("pdc.manage");
  const st = String(h?.status ?? "");
  const received = h?.direction === "RECEIVED";
  const actions: Act[] = !h || !manage ? [] : [
    ...(received && st === "HELD" ? ["DEPOSIT" as Act] : []),
    ...((received ? st === "DEPOSITED" : st === "HELD" || st === "DEPOSITED") ? ["CLEAR" as Act, "BOUNCE" as Act] : []),
    ...(st === "BOUNCED" ? ["REPRESENT" as Act] : []),
    ...(st === "HELD" || st === "BOUNCED" ? [received ? "RETURN" as Act : "CANCEL" as Act] : []),
    ...(st === "DEPOSITED" && received ? ["UNDO_DEPOSIT" as Act] : []),
    ...(st === "CLEARED" ? ["UNDO_CLEAR" as Act] : []),
  ];
  const ICON: Partial<Record<Act, React.ReactNode>> = { DEPOSIT: <ArrowDownToLine className="h-3.5 w-3.5" />, CLEAR: <CheckCircle2 className="h-3.5 w-3.5" />, BOUNCE: <AlertTriangle className="h-3.5 w-3.5" />,
    REPRESENT: <Repeat className="h-3.5 w-3.5" />, RETURN: <Ban className="h-3.5 w-3.5" />, CANCEL: <Ban className="h-3.5 w-3.5" />, UNDO_CLEAR: <Undo2 className="h-3.5 w-3.5" />, UNDO_DEPOSIT: <RotateCcw className="h-3.5 w-3.5" /> };
  const primary: Act | undefined = actions.find((a) => a === "CLEAR" || a === "DEPOSIT" || a === "REPRESENT");
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="xl" icon={icon} title={h ? `Cheque ${h.cheque_no}` : "Cheque"} subtitle={h ? `${h.doc_no} · ${received ? "from" : "to"} ${h.party_name}` : undefined}
        status={h ? <Badge tone={h.is_due ? "warning" : PDC_TONE[st]}>{statusLabel(h)}</Badge> : null}
        footer={h && <>
          {actions.filter((a) => a !== primary).map((a) => <Button key={a} variant={a === "BOUNCE" || a === "RETURN" || a === "CANCEL" ? "destructive-ghost" : "ghost"} icon={ICON[a]} onClick={() => setAct(a)}>{ACT_LABEL[a]}</Button>)}
          <div className="flex-1" />
          {manage && <Button icon={<StickyNote className="h-3.5 w-3.5" />} onClick={() => setAct("NOTE")}>Note</Button>}
          <Button onClick={onClose}>Close</Button>
          {primary && <Button variant="primary" icon={ICON[primary]} onClick={() => setAct(primary)}>{ACT_LABEL[primary]}</Button>}
        </>}>
        {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : h && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile k="Amount" v={money(h.amount as number)} />
              <Tile k="Date on cheque" v={formatDate(h.cheque_date as string)} sub={h.days_to_due != null ? (Number(h.days_to_due) > 0 ? `in ${h.days_to_due} day(s)` : "due") : undefined} hot={!!h.is_due} />
              <Tile k={received ? "Deposited in" : "Drawn on"} v={String(h.bank_name ?? "—")} sub={h.deposit_date ? `on ${formatDate(h.deposit_date as string)}` : undefined} />
              <Tile k={received ? "Applied to invoices" : "Applied to bills"} v={money(h.allocated as number)} />
            </div>
            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
              <div><dt className="text-2xs uppercase text-ink-muted">{received ? "Received on" : "Handed over on"}</dt><dd>{formatDate(h.received_date as string)}</dd></div>
              {received && <div><dt className="text-2xs uppercase text-ink-muted">Customer's bank</dt><dd>{[h.drawer_bank, h.drawer_branch, h.drawer_account].filter(Boolean).join(" · ") || "—"}</dd></div>}
              {h.cleared_date ? <div><dt className="text-2xs uppercase text-ink-muted">Cleared</dt><dd>{formatDate(h.cleared_date as string)}</dd></div> : null}
              {Number(h.bounce_count) > 0 && <div><dt className="text-2xs uppercase text-ink-muted">Bounced</dt><dd className="text-danger">{String(h.bounce_count)}× {h.bounce_reason ? `· ${h.bounce_reason}` : ""}</dd></div>}
              {h.reference ? <div><dt className="text-2xs uppercase text-ink-muted">Reference</dt><dd>{String(h.reference)}</dd></div> : null}
              {h.notes ? <div className="col-span-2"><dt className="text-2xs uppercase text-ink-muted">Notes</dt><dd>{String(h.notes)}</dd></div> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "timeline", label: `Timeline (${q.data?.events.length ?? 0})` }, { key: "applied", label: `${received ? "Invoices" : "Bills"} (${q.data?.allocs.length ?? 0})` },
              { key: "files", label: filesLabel(files.data?.length) }, { key: "history", label: "History" }]} />
            {tab === "timeline" && (
              <ol className="relative ml-2 border-l border-line pl-4">
                {(q.data?.events ?? []).map((e) => {
                  const en = e.entry as { entry_no: string } | null;
                  return (
                    <li key={e.id} className="mb-3">
                      <span className={cn("absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full", e.event === "BOUNCED" ? "bg-red-500" : e.event === "CLEARED" ? "bg-emerald-500" : "bg-slate-400")} />
                      <div className="text-sm"><b>{EVENT_LABEL[String(e.event)] ?? String(e.event)}</b> <span className="text-ink-muted">· {formatDate(e.event_date as string)}</span>
                        {e.bank ? <span className="text-ink-muted"> · {(e.bank as { name: string }).name}</span> : null}
                        {e.event === "BANK_CHARGES" && <span className="text-ink-muted"> · {money(e.amount as number)}</span>}
                        {en && <button className="ml-2 font-mono text-xs text-primary hover:underline" onClick={() => navigate(`/vouchers?view=${e.journal_entry_id}`)}>{en.entry_no}</button>}</div>
                      {e.note ? <div className="text-xs text-ink-muted">{String(e.note)}</div> : null}
                      <div className="text-2xs text-ink-faint">{formatDateTime(e.created_at as string)}</div>
                    </li>
                  );
                })}
              </ol>
            )}
            {tab === "applied" && ((q.data?.allocs ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">Not applied to any {received ? "invoice" : "bill"}.{h.current_entry_id ? <> Apply it from the <button className="text-primary hover:underline" onClick={() => navigate(`/vouchers?view=${h.current_entry_id}`)}>receipt / payment entry</button>{received ? "" : " or from the bill (Use earlier payment)"}.</> : null}</p>
            ) : (
              <div className="space-y-1.5">{(q.data?.allocs ?? []).map((a) => (
                <div key={String(a.allocation_id)} className="flex items-center gap-3 rounded-card border border-line px-3 py-2 text-sm">
                  <button className="font-mono text-xs text-primary hover:underline" onClick={() => navigate(a.doc_kind === "INVOICE" ? `/invoices?view=${a.doc_id}` : `/supplier-bills?view=${a.doc_id}`)}>{String(a.doc_no)}</button>
                  <span className="ml-auto tabular-nums">{money(a.amount as number)}</span>
                </div>))}
              </div>
            ))}
            {tab === "files" && <AttachmentsPanel entityType="pdc_records" entityId={id} />}
            {tab === "history" && <AuditTimeline table="pdc_records" id={id} />}
            {h.current_entry_id ? <div className="mt-3"><Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/vouchers?view=${h.current_entry_id}`)}>{received ? "Receipt entry" : "Payment entry"}</Button></div> : null}
          </>
        )}
      </ErpDialog>
      {act && h && <PdcActionDialog pdc={h} act={act} onClose={() => setAct(null)} />}
    </>
  );
}

function Tile({ k, v, sub, hot }: { k: string; v: string; sub?: string; hot?: boolean }) {
  return <div className={cn("rounded-card border border-line px-3 py-2", hot && "border-amber-200 bg-amber-50/60")}><div className="text-2xs uppercase tracking-wide text-ink-muted">{k}</div><div className="truncate text-lg font-semibold tabular-nums">{v}</div>{sub && <div className="text-2xs text-ink-muted">{sub}</div>}</div>;
}

function PdcActionDialog({ pdc, act, onClose }: { pdc: Row; act: Act; onClose: () => void }) {
  const received = pdc.direction === "RECEIVED";
  const [d, setD] = React.useState({ date: act === "CLEAR" && String(pdc.cheque_date) > today() ? String(pdc.cheque_date) : today(), bank: ((pdc.bank_account_id as string | null) ?? null) as string | null, reason: "", charges: "", note: "" });
  const go = useAction(() => rpc("pdc_action", { p_id: pdc.id, p_action: act, p_data: { date: d.date, bank_account_id: d.bank, reason: d.reason, bank_charges: d.charges ? num(d.charges) : null, note: d.note } }), `${ACT_LABEL[act]} — done`, onClose);
  const msg: Record<Act, string> = {
    DEPOSIT: "The cheque goes to the bank for collection. No money moves in the books until it clears.",
    CLEAR: received ? `PKR ${money(pdc.amount as number)} comes into the bank; cheques in hand go down.` : `PKR ${money(pdc.amount as number)} goes out of the bank; cheques issued go down.`,
    BOUNCE: received ? "The receipt is reversed — the customer owes the amount again and it is released from the invoices it paid." : "The payment is reversed — we owe the supplier again and the bills it paid are open again.",
    REPRESENT: received ? "The cheque is recorded again (customer credited). Choose the bank if it is deposited right away." : "The cheque is handed over again (supplier debited).",
    RETURN: "The cheque goes back to the customer; the receipt is reversed.", CANCEL: "The cheque is cancelled; the payment is reversed.",
    UNDO_CLEAR: "The clearing entry is reversed; the cheque is back to deposited / issued.", UNDO_DEPOSIT: "The cheque is back in hand.", NOTE: "Adds a note to the cheque's timeline.",
  };
  const danger = act === "BOUNCE" || act === "RETURN" || act === "CANCEL" || act === "UNDO_CLEAR";
  return (
    <ConfirmDialog open title={`${ACT_LABEL[act]} — cheque ${pdc.cheque_no}`} tone={danger ? "destructive" : undefined} confirmLabel={ACT_LABEL[act]} loading={go.isPending} onCancel={onClose} onConfirm={() => go.mutate(undefined)} message={msg[act]}>
      <FormGrid cols={2} className="mt-3">
        {act !== "NOTE" && <Field label="Date"><Input type="date" value={d.date} onChange={(e) => setD((s) => ({ ...s, date: e.target.value }))} /></Field>}
        {(act === "DEPOSIT" || (act === "REPRESENT" && received)) && <Field label={act === "REPRESENT" ? "Deposit in (optional)" : "Bank account"} required={act === "DEPOSIT"} className="sm:col-span-2"><BankPicker value={d.bank} onChange={(v) => setD((s) => ({ ...s, bank: v }))} /></Field>}
        {act === "BOUNCE" && <>
          <Field label="Reason"><Input value={d.reason} placeholder="e.g. insufficient funds" onChange={(e) => setD((s) => ({ ...s, reason: e.target.value }))} /></Field>
          {pdc.bank_account_id ? <Field label="Bank charges (PKR)" hint="Deducted by our bank"><Input className="text-right tabular-nums" inputMode="decimal" value={d.charges} onChange={(e) => setD((s) => ({ ...s, charges: e.target.value }))} /></Field> : null}
        </>}
        {(act === "NOTE" || act === "UNDO_CLEAR" || act === "RETURN" || act === "CANCEL" || act === "REPRESENT") && <Field label={act === "NOTE" ? "Note" : act === "UNDO_CLEAR" ? "Reason" : "Note"} required={act === "NOTE" || act === "UNDO_CLEAR"} className="sm:col-span-2">
          <Textarea rows={2} value={d.note} onChange={(e) => setD((s) => ({ ...s, note: e.target.value }))} /></Field>}
      </FormGrid>
    </ConfirmDialog>
  );
}
