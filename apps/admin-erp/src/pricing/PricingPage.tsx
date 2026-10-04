import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, ExternalLink, History, Save, Send, ShieldAlert, Tag, Undo2, UserRoundCog } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, Input, KeyValue, PageHeader, SearchableSelect, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList, useProfileNames } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { CustomerPicker, ProductPicker } from "../inventory/pickers";
import { money } from "../accounting/common";
import { n, qtyFmt } from "../sales/common";

type Row = Record<string, unknown> & { id: string };
export const PRICE_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  OPEN: "warning", SUBMITTED: "info", RETURNED: "danger", APPROVED: "success", CANCELLED: "neutral",
};
export const priceLabel = (s: string) =>
  ({ OPEN: "Waiting for prices", SUBMITTED: "To review", RETURNED: "Sent back", APPROVED: "Approved", CANCELLED: "Cancelled" })[s] ?? s;
const EVENT_LABEL: Record<string, string> = {
  CREATED: "Sent for pricing", SAVED: "Saved", SUBMITTED: "Prices submitted", RETURNED: "Sent back", APPROVED: "Approved",
  REASSIGNED: "Reassigned", CANCELLED: "Cancelled",
};
const icon = <Tag className="h-4 w-4" />;

export interface PendingPrice {
  source_type: "SO" | "GDN"; source_id: string; sales_order_id: string; doc_no: string; doc_date: string; status: string;
  customer_id: string; customer_name: string; missing_lines: number; missing_qty: number;
  open_task_id: string | null; open_task_no: string | null; open_task_status: string | null;
}
export function usePendingPrices() {
  const { companyId, can } = useAccess();
  return useQuery({
    queryKey: ["pending-prices", companyId],
    enabled: !!companyId && can(P.salesViewPrices),
    queryFn: async () => {
      const { data, error } = await sb().rpc("pending_prices", { p_company_id: companyId });
      if (error) throw error;
      return (data ?? []) as PendingPrice[];
    },
  });
}
export function usePricingPeople() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["pricing-people", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("pricing_people", { p_company_id: companyId });
      if (error) throw error;
      return (data ?? []) as { user_id: string; full_name: string; can_approve: boolean }[];
    },
  });
}

/** Live refresh of price tasks for every open pricing screen. */
function usePricingRealtime(enabled: boolean) {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (!enabled) return;
    const ch = sb().channel(`pricing-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "price_tasks" }, () => {
        qc.invalidateQueries({ queryKey: ["list", "price_tasks"] });
        qc.invalidateQueries({ queryKey: ["price-task"] });
        qc.invalidateQueries({ queryKey: ["pending-prices"] });
      })
      .subscribe();
    return () => { void sb().removeChannel(ch); };
  }, [enabled, qc]);
}

const FILTERS = [
  { label: "Mine", mine: true },
  { label: "To review", status: "SUBMITTED" },
  { label: "Waiting", status: "OPEN" },
  { label: "Sent back", status: "RETURNED" },
  { label: "Approved", status: "APPROVED" },
  { label: "All" },
] as { label: string; status?: string; mine?: boolean }[];

export function PricingPage() {
  const { can, companyId, session } = useAccess();
  const { params, update } = useUrlState();
  const tab = params.get("tab") ?? "tasks";
  const viewId = params.get("view");
  const allowed = can(P.salesViewPrices) || can(P.pricingEnter);
  usePricingRealtime(allowed);
  const pending = usePendingPrices();
  const waiting = (pending.data ?? []).filter((p) => !p.open_task_id).length;
  const [send, setSend] = React.useState<PendingPrice | null>(null);
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Pricing" icon={icon}
        description="Goods can leave before the price is agreed. Send the order or GDN for pricing, the owner or salesperson enters prices, and the accountant approves them — the approved price flows into the invoice." />
      <Tabs value={tab} onChange={(t) => update({ tab: t === "tasks" ? null : t, f: null, page: null, q: null })} tabs={[
        { key: "tasks", label: "Price tasks" },
        ...(can(P.salesViewPrices) ? [{ key: "pending", label: `Waiting for a price${waiting ? ` (${waiting})` : ""}` }, { key: "history", label: "Price history" }] : []),
      ]} />
      {tab === "tasks" && <TaskList me={session?.user.id ?? ""} companyId={companyId} onView={(id) => update({ view: id })} />}
      {tab === "pending" && <PendingList rows={pending.data ?? []} loading={pending.isLoading} error={pending.error} onSend={setSend} onOpenTask={(id) => update({ view: id })} />}
      {tab === "history" && <PriceHistory />}
      {send && <SendForPricingDialog source={send} onClose={() => setSend(null)} onCreated={(id) => { setSend(null); update({ view: id, tab: null }); }} />}
      {viewId && <PriceTaskDialog id={viewId} onClose={() => update({ view: null })} />}
    </div>
  );
}

function TaskList({ me, companyId, onView }: { me: string; companyId: string | null; onView: (id: string) => void }) {
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const flt = FILTERS[f];
  const list = useEntityList<Row>({
    table: "price_tasks",
    select: "id, doc_no, source_type, status, assigned_to, due_date, created_at, submitted_at, revision, customer:customers(name), so:sales_orders(doc_no), gdn:gdns(doc_no), lines:price_task_lines(id)",
    companyId, search: q, searchColumns: ["doc_no"],
    filters: { status: flt.status, assigned_to: flt.mine ? me : undefined },
    orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: !!companyId,
  });
  const rows = (list.data?.rows ?? []).filter((r) => !flt.mine || !["APPROVED", "CANCELLED"].includes(String(r.status)));
  const names = useProfileNames(rows.map((r) => r.assigned_to as string));
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search PT no…" />
        <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
      </div>
      {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
        <DataTable loading={list.isLoading} rows={rows} onView={(r) => onView(r.id)}
          page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
          columns={[
            { key: "doc", header: "Task", width: "110px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
            { key: "src", header: "For", width: "150px", cell: (r) => <span className="font-mono text-xs">{r.source_type === "GDN" ? (r.gdn as { doc_no: string } | null)?.doc_no : (r.so as { doc_no: string } | null)?.doc_no}</span> },
            { key: "c", header: "Customer", cell: (r) => (r.customer as { name: string } | null)?.name },
            { key: "n", header: "Items", width: "70px", align: "right", cell: (r) => (r.lines as unknown[]).length },
            { key: "a", header: "Pricing by", width: "160px", hideBelow: "md", cell: (r) => <span className={cn(r.assigned_to === me && "font-medium")}>{names.data?.[r.assigned_to as string] ?? "…"}{r.assigned_to === me && " (you)"}</span> },
            { key: "d", header: "Due", width: "100px", hideBelow: "lg", cell: (r) => r.due_date ? formatDate(r.due_date as string) : null },
            { key: "s", header: "Status", width: "140px", cell: (r) => <Badge tone={PRICE_TONE[String(r.status)]}>{priceLabel(String(r.status))}</Badge> },
          ]}
          empty={<EmptyState icon={icon} title="No price tasks" description="Orders and GDNs without prices are listed under “Waiting for a price”." />} />
      )}
    </Card>
  );
}

function PendingList({ rows, loading, error, onSend, onOpenTask }: {
  rows: PendingPrice[]; loading: boolean; error: unknown; onSend: (r: PendingPrice) => void; onOpenTask: (id: string) => void;
}) {
  const navigate = useNavigate();
  const data = rows.map((r) => ({ ...r, id: `${r.source_type}:${r.source_id}` }));
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {error ? <p className="p-4 text-sm text-danger">{friendlyError(error)}</p> : (
        <DataTable loading={loading} rows={data}
          onView={(r) => navigate(r.source_type === "GDN" ? `/gdn?view=${r.source_id}` : `/sales-orders?view=${r.source_id}`)}
          columns={[
            { key: "t", header: "Document", width: "160px", cell: (r) => <span className="flex items-center gap-1.5"><Badge tone={r.source_type === "GDN" ? "warning" : "info"}>{r.source_type === "GDN" ? "Dispatched" : "Order"}</Badge><span className="font-mono text-xs">{r.doc_no}</span></span> },
            { key: "d", header: "Date", width: "100px", cell: (r) => formatDate(r.doc_date) },
            { key: "c", header: "Customer", cell: (r) => r.customer_name },
            { key: "n", header: "Items without price", width: "140px", align: "right", cell: (r) => <span className="tabular-nums">{r.missing_lines} <span className="text-ink-muted">· {qtyFmt(r.missing_qty)} qty</span></span> },
            { key: "s", header: "", width: "220px", align: "right", cell: (r) => r.open_task_id
              ? <Button size="sm" onClick={(e) => { e.stopPropagation(); onOpenTask(r.open_task_id!); }}>{r.open_task_no} · {priceLabel(r.open_task_status ?? "")}</Button>
              : <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); onSend(r); }}>Send for pricing</Button> },
          ]}
          empty={<EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Everything has a price" description="Orders or GDNs saved without a price show up here." />} />
      )}
    </Card>
  );
}

/** Choose who prices it; their screen chimes. */
export function SendForPricingDialog({ source, onClose, onCreated }: {
  source: { source_type: "SO" | "GDN"; source_id: string; doc_no: string; customer_name?: string; missing_lines?: number };
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const people = usePricingPeople();
  const [who, setWho] = React.useState<string | null>(null);
  const [due, setDue] = React.useState("");
  const [note, setNote] = React.useState("");
  const create = useMutation({
    mutationFn: async () => {
      if (!who) throw new Error("Choose who will enter the prices");
      const { data, error } = await sb().rpc("create_price_task", { p_company_id: companyId, p_source_type: source.source_type, p_source_id: source.source_id,
        p_assignee: who, p_due: due || null, p_notes: note || null });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { toast.success("Sent for pricing"); qc.invalidateQueries(); onCreated(id); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ConfirmDialog open title={`Send ${source.doc_no} for pricing`} confirmLabel="Send" loading={create.isPending} onCancel={onClose} onConfirm={() => create.mutate()}
      message={`${source.customer_name ? `${source.customer_name} · ` : ""}${source.missing_lines ?? ""}${source.missing_lines ? " item(s) without a price. " : ""}The person you choose enters the prices; the accountant then approves them.`}>
      <div className="mt-3 space-y-3">
        <Field label="Prices to be entered by">
          <SearchableSelect value={who} onChange={(v) => setWho(v)} placeholder={people.isLoading ? "Loading…" : "Owner or salesperson…"}
            options={(people.data ?? []).map((p) => ({ value: p.user_id, label: p.full_name, secondary: p.can_approve ? "can also approve" : undefined }))} />
        </Field>
        <Field label="Needed by"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer wants the rate confirmed by phone" /></Field>
      </div>
    </ConfirmDialog>
  );
}

interface TaskLine {
  id: string; line_no: number; product_id: string; variant_id: string | null; quantity: number; last_price: number | null; last_price_date: string | null; last_price_doc: string | null;
  entered_price: number | null; approved_price: number | null; note: string | null;
  product: { name: string; sku: string; uom: { code: string } | null } | null; variant: { name: string } | null;
}
interface TaskEvent { id: string; event: string; actor: string | null; at: string; note: string | null; prices: { line_id: string; entered: number | null; approved: number | null }[] | null }

export function usePriceTask(id: string | null) {
  return useQuery({
    queryKey: ["price-task", id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l, e] = await Promise.all([
        sb().from("price_tasks").select("*, customer:customers(name, city, default_currency), so:sales_orders(doc_no), gdn:gdns(doc_no)").eq("id", id!).single(),
        sb().from("price_task_lines").select("id, line_no, product_id, variant_id, quantity, last_price, last_price_date, last_price_doc, entered_price, approved_price, note, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)").eq("task_id", id!).order("line_no"),
        sb().from("price_task_events").select("id, event, actor, at, note, prices").eq("task_id", id!).order("at"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      if (e.error) throw e.error;
      return { h: h.data as Record<string, unknown> & { id: string; status: string; assigned_to: string; doc_no: string; company_id: string }, lines: (l.data ?? []) as unknown as TaskLine[], events: (e.data ?? []) as TaskEvent[] };
    },
  });
}

export function PriceTaskDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, session } = useAccess();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const t = usePriceTask(id);
  const people = usePricingPeople();
  const [tab, setTab] = React.useState("lines");
  const [price, setPrice] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState<Record<string, string>>({});
  const [appr, setAppr] = React.useState<Record<string, string>>({});
  const [ask, setAsk] = React.useState<null | "submit" | "return" | "approve" | "reassign" | "cancel">(null);
  const [text, setText] = React.useState("");
  const [who, setWho] = React.useState<string | null>(null);
  const h = t.data?.h;
  const lines = t.data?.lines ?? [];
  const events = t.data?.events ?? [];
  const names = useProfileNames([h?.assigned_to, ...events.map((e) => e.actor)]);
  React.useEffect(() => {
    if (!t.data) return;
    setPrice(Object.fromEntries(t.data.lines.map((l) => [l.id, l.entered_price == null ? "" : String(Number(l.entered_price))])));
    setNote(Object.fromEntries(t.data.lines.map((l) => [l.id, l.note ?? ""])));
    setAppr(Object.fromEntries(t.data.lines.map((l) => [l.id, String(Number(l.approved_price ?? l.entered_price ?? ""))])));
  }, [t.data]);

  const me = session?.user.id;
  const status = h?.status ?? "";
  const canEnter = ["OPEN", "RETURNED"].includes(status) && (h?.assigned_to === me || can(P.pricingApprove)) && (can(P.pricingEnter) || can(P.pricingApprove));
  const canReview = status === "SUBMITTED" && can(P.pricingApprove);
  const canManage = !["APPROVED", "CANCELLED"].includes(status) && can(P.salesViewPrices) && (can(P.salesManage) || can(P.salesDispatch) || can(P.pricingApprove) || can(P.pricingEnter));
  const payload = () => lines.map((l) => ({ id: l.id, price: price[l.id]?.trim() ? String(n(price[l.id])) : null, note: note[l.id] || null }));
  const done = (msg: string) => { toast.success(msg); setAsk(null); setText(""); qc.invalidateQueries(); };
  const fail = (e: unknown) => toast.error(friendlyError(e));
  const save = useMutation({ mutationFn: async () => { const { error } = await sb().rpc("save_price_task", { p_task_id: id, p_lines: payload() }); if (error) throw error; }, onSuccess: () => done("Saved"), onError: fail });
  const submit = useMutation({ mutationFn: async () => { const { error } = await sb().rpc("submit_price_task", { p_task_id: id, p_lines: payload(), p_note: text || null }); if (error) throw error; }, onSuccess: () => done("Submitted to the accountant"), onError: fail });
  const ret = useMutation({ mutationFn: async () => { const { error } = await sb().rpc("return_price_task", { p_task_id: id, p_reason: text }); if (error) throw error; }, onSuccess: () => done("Sent back"), onError: fail });
  const approve = useMutation({
    mutationFn: async () => {
      const changes = lines.filter((l) => appr[l.id]?.trim() && n(appr[l.id]) !== Number(l.entered_price)).map((l) => ({ id: l.id, price: String(n(appr[l.id])) }));
      const { error } = await sb().rpc("approve_price_task", { p_task_id: id, p_lines: changes, p_note: text || null });
      if (error) throw error;
    }, onSuccess: () => done("Approved — prices are now on the order, GDN and draft invoices"), onError: fail,
  });
  const reassign = useMutation({ mutationFn: async () => { const { error } = await sb().rpc("reassign_price_task", { p_task_id: id, p_assignee: who, p_note: text || null }); if (error) throw error; }, onSuccess: () => done("Reassigned"), onError: fail });
  const cancel = useMutation({ mutationFn: async () => { const { error } = await sb().rpc("cancel_price_task", { p_task_id: id, p_reason: text || null }); if (error) throw error; }, onSuccess: () => done("Cancelled"), onError: fail });

  const cur = (h?.customer as { default_currency?: string } | null)?.default_currency ?? "PKR";
  const shown = (l: TaskLine) => (canEnter ? (price[l.id]?.trim() ? n(price[l.id]) : null) : canReview ? (appr[l.id]?.trim() ? n(appr[l.id]) : null) : (l.approved_price ?? l.entered_price));
  const total = lines.reduce((s, l) => s + (shown(l) ?? 0) * Number(l.quantity), 0);
  const missing = lines.filter((l) => shown(l) == null).length;
  const srcDoc = h ? (h.source_type === "GDN" ? (h.gdn as { doc_no: string } | null)?.doc_no : (h.so as { doc_no: string } | null)?.doc_no) : "";

  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="pricing" icon={icon}
        title={h ? `${h.doc_no} · prices for ${srcDoc}` : "Price task"} subtitle={(h?.customer as { name: string } | null)?.name}
        status={h ? <Badge tone={PRICE_TONE[status]}>{priceLabel(status)}</Badge> : null}
        footer={
          <>
            {canManage && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel task</Button>}
            {canManage && <Button variant="ghost" icon={<UserRoundCog className="h-3.5 w-3.5" />} onClick={() => { setWho(h?.assigned_to ?? null); setAsk("reassign"); }}>Reassign</Button>}
            <div className="flex-1" />
            {h && <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(h.source_type === "GDN" ? `/gdn?view=${h.gdn_id}` : `/sales-orders?view=${h.sales_order_id}`)}>{srcDoc}</Button>}
            <Button onClick={onClose}>Close</Button>
            {canEnter && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
            {canEnter && <Button variant="primary" icon={<Send className="h-3.5 w-3.5" />} disabled={missing > 0} title={missing ? "Enter every price first" : undefined} onClick={() => setAsk("submit")}>Submit for approval</Button>}
            {canReview && <Button variant="destructive-ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setAsk("return")}>Send back</Button>}
            {canReview && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={missing > 0} onClick={() => setAsk("approve")}>Approve prices</Button>}
          </>
        }>
        {t.isLoading ? <Skeleton className="h-40" /> : t.error ? <p className="text-sm text-danger">{friendlyError(t.error)}</p> : h && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-6">
              <KeyValue label="Customer">{(h.customer as { name: string } | null)?.name}</KeyValue>
              <KeyValue label={h.source_type === "GDN" ? "GDN" : "Sales order"}>{srcDoc}</KeyValue>
              <KeyValue label="Prices by">{names.data?.[h.assigned_to] ?? "…"}</KeyValue>
              <KeyValue label="Needed by">{h.due_date ? formatDate(h.due_date as string) : null}</KeyValue>
              <KeyValue label="Value"><span className="font-semibold tabular-nums">{cur} {money(total)}</span>{missing > 0 && <span className="ml-1 text-xs text-warning">· {missing} missing</span>}</KeyValue>
              <KeyValue label="Revision">{Number(h.revision) || null}</KeyValue>
              {h.notes ? <KeyValue label="Note" className="col-span-2 md:col-span-6">{String(h.notes)}</KeyValue> : null}
            </dl>
            {status === "RETURNED" && h.return_reason ? (
              <div className="mb-3 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><b>Sent back:</b> {String(h.return_reason)}</div>
            ) : null}
            {status === "SUBMITTED" && !canReview && <div className="mb-3 rounded-card border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">Submitted {formatDateTime(h.submitted_at as string)} — waiting for the accountant.</div>}
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.length})` }, { key: "history", label: `History (${events.length})` }]} />
            {tab === "lines" && (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-subtle"><tr className="text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-9 w-10 px-3">#</th><th className="px-3">Item</th><th className="px-3 text-right">Qty</th>
                    <th className="px-3 text-right">Last price to this customer</th>
                    <th className="w-40 px-3 text-right">Price entered</th>
                    {(canReview || status === "APPROVED") && <th className="w-40 px-3 text-right">Approved price</th>}
                    <th className="px-3 text-right">Amount</th><th className="px-3">Note</th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const p = shown(l);
                      const changed = canReview && appr[l.id]?.trim() && n(appr[l.id]) !== Number(l.entered_price);
                      return (
                        <tr key={l.id} className="border-t border-line/70 align-top">
                          <td className="px-3 py-2 text-ink-muted">{l.line_no}</td>
                          <td className="px-3 py-2"><div className="font-medium">{l.product?.name}{l.variant && <span className="font-normal text-ink-muted"> · {l.variant.name}</span>}</div><div className="text-2xs text-ink-muted">{l.product?.sku}</div></td>
                          <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.quantity)} <span className="text-2xs text-ink-muted">{l.product?.uom?.code}</span></td>
                          <td className="px-3 py-2 text-right">
                            {l.last_price != null ? <div><span className="tabular-nums">{money(l.last_price)}</span>
                              {canEnter && <button className="ml-1 text-2xs text-primary hover:underline" onClick={() => setPrice((s) => ({ ...s, [l.id]: String(Number(l.last_price)) }))}>use</button>}
                              <div className="text-2xs text-ink-muted">{l.last_price_doc} · {formatDate(l.last_price_date)}</div></div>
                              : <span className="text-xs text-ink-faint">never sold</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canEnter ? <Input className="text-right tabular-nums" inputMode="decimal" value={price[l.id] ?? ""} placeholder="Price"
                              onChange={(e) => setPrice((s) => ({ ...s, [l.id]: e.target.value }))} />
                              : l.entered_price == null ? <Badge tone="warning">Pending</Badge> : <span className="tabular-nums">{money(l.entered_price)}</span>}
                          </td>
                          {(canReview || status === "APPROVED") && (
                            <td className="px-3 py-2 text-right">
                              {canReview ? <Input className={cn("text-right tabular-nums", changed && "border-warning")} inputMode="decimal" value={appr[l.id] ?? ""}
                                onChange={(e) => setAppr((s) => ({ ...s, [l.id]: e.target.value }))} />
                                : <span className="font-medium tabular-nums text-success">{money(l.approved_price)}</span>}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right tabular-nums">{p == null ? <span className="text-ink-faint">—</span> : money(p * Number(l.quantity))}</td>
                          <td className="px-3 py-2">{canEnter ? <Input value={note[l.id] ?? ""} onChange={(e) => setNote((s) => ({ ...s, [l.id]: e.target.value }))} placeholder="optional" />
                            : <span className="text-xs text-ink-muted">{l.note}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {tab === "history" && <TaskHistory events={events} lines={lines} names={names.data ?? {}} />}
          </>
        )}
      </ErpDialog>

      <ConfirmDialog open={ask === "submit"} title="Submit prices for approval?" confirmLabel="Submit" loading={submit.isPending}
        message="The accountant is alerted to review them. You can't change them unless they are sent back." onCancel={() => setAsk(null)} onConfirm={() => submit.mutate()}>
        <Field label="Note for the accountant" className="mt-3"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "return"} title="Send prices back" confirmLabel="Send back" tone="destructive" loading={ret.isPending}
        message="They go back to the person who entered them, with your reason." onCancel={() => setAsk(null)} onConfirm={() => ret.mutate()}>
        <Field label="Reason" className="mt-3"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. rate for fan 36&quot; is below cost" /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "approve"} title="Approve these prices?" confirmLabel="Approve" loading={approve.isPending}
        message={`Prices are written onto ${srcDoc}, its GDN lines and any draft invoice still waiting for them, and saved to this customer's price history. On the invoice they are locked.`}
        onCancel={() => setAsk(null)} onConfirm={() => approve.mutate()}>
        <Field label="Note" className="mt-3"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "reassign"} title="Give this price task to someone else" confirmLabel="Reassign" loading={reassign.isPending}
        message="They are alerted; prices already typed stay." onCancel={() => setAsk(null)} onConfirm={() => reassign.mutate()}>
        <Field label="Prices to be entered by" className="mt-3">
          <SearchableSelect value={who} onChange={(v) => setWho(v)} options={(people.data ?? []).map((p) => ({ value: p.user_id, label: p.full_name }))} />
        </Field>
        <Field label="Note" className="mt-3"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "cancel"} title="Cancel this price task?" confirmLabel="Cancel task" tone="destructive" loading={cancel.isPending}
        message="The items go back to “Waiting for a price”. Nothing is written to the order." onCancel={() => setAsk(null)} onConfirm={() => cancel.mutate()}>
        <Field label="Reason" className="mt-3"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}

function TaskHistory({ events, lines, names }: { events: TaskEvent[]; lines: TaskLine[]; names: Record<string, string> }) {
  const label = new Map(lines.map((l) => [l.id, `${l.product?.name ?? ""}${l.variant ? ` · ${l.variant.name}` : ""}`]));
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="rounded-card border border-line p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <History className="h-3.5 w-3.5 text-ink-muted" />
            <span className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</span>
            <span className="text-ink-muted">by {e.actor ? names[e.actor] ?? "…" : "system"} · {formatDateTime(e.at)}</span>
          </div>
          {e.note && <p className="mt-1 text-sm text-ink-2">{e.note}</p>}
          {e.prices && e.prices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {e.prices.map((p) => (
                <span key={p.line_id} className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs">
                  {label.get(p.line_id)}: <b className="tabular-nums">{p.approved != null ? money(p.approved) : p.entered != null ? money(p.entered) : "—"}</b>
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function PriceHistory() {
  const { companyId } = useAccess();
  const [cust, setCust] = React.useState<string | null>(null);
  const [prod, setProd] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const list = useEntityList<Row>({
    table: "customer_product_prices",
    select: "id, unit_price, currency, quantity, effective_date, source_type, source_id, source_doc_no, recorded_by, customer:customers(name), product:products(name, sku), variant:product_variants(name)",
    companyId, filters: { customer_id: cust ?? undefined, product_id: prod ?? undefined },
    orderBy: { column: "effective_date", ascending: false }, page, pageSize: 50, enabled: !!companyId,
  });
  const navigate = useNavigate();
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="w-64"><CustomerPicker value={cust} onChange={(v) => { setCust(v); setPage(1); }} /></div>
        <div className="w-72"><ProductPicker value={prod} onChange={(v) => { setProd(v); setPage(1); }} showStock={false} /></div>
        <span className="text-xs text-ink-muted">Every price charged on a posted invoice or approved on a price task.</span>
      </div>
      {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
        <DataTable loading={list.isLoading} rows={list.data?.rows ?? []} page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={setPage}
          onView={(r) => navigate(r.source_type === "INVOICE" ? `/invoices?view=${r.source_id}` : `/pricing?view=${r.source_id}`)}
          columns={[
            { key: "d", header: "Date", width: "100px", cell: (r) => formatDate(r.effective_date as string) },
            { key: "c", header: "Customer", cell: (r) => (r.customer as { name: string } | null)?.name },
            { key: "p", header: "Item", cell: (r) => <span>{(r.product as { name: string } | null)?.name}{r.variant ? <span className="text-ink-muted"> · {(r.variant as { name: string }).name}</span> : null}</span> },
            { key: "q", header: "Qty", width: "80px", align: "right", hideBelow: "md", cell: (r) => r.quantity == null ? null : qtyFmt(r.quantity) },
            { key: "u", header: "Price", width: "130px", align: "right", cell: (r) => <span className="font-medium tabular-nums">{r.currency !== "PKR" && <span className="text-2xs text-ink-muted">{String(r.currency)} </span>}{money(r.unit_price as number)}</span> },
            { key: "s", header: "From", width: "160px", cell: (r) => <span className="flex items-center gap-1.5"><Badge tone={r.source_type === "INVOICE" ? "success" : "info"}>{r.source_type === "INVOICE" ? "Invoice" : "Approved"}</Badge><span className="font-mono text-xs">{String(r.source_doc_no ?? "")}</span></span> },
          ]}
          empty={<EmptyState icon={<History className="h-6 w-6" />} title="No prices yet" description="Prices appear here once invoices are posted or price tasks are approved." />} />
      )}
    </Card>
  );
}

/** Strip on an order / GDN: unpriced items → send for pricing, or the open task. */
export function PricingStrip({ sourceType, sourceId, docNo, customerName }: { sourceType: "SO" | "GDN"; sourceId: string; docNo: string; customerName?: string }) {
  const { can } = useAccess();
  const navigate = useNavigate();
  const pending = usePendingPrices();
  const [open, setOpen] = React.useState(false);
  if (!can(P.salesViewPrices)) return null;
  const row = (pending.data ?? []).find((p) => p.source_type === sourceType && p.source_id === sourceId);
  if (!row) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-rose-200 bg-rose-50/60 px-3 py-2 text-sm">
      <Tag className="h-4 w-4 text-rose-600" />
      <span><b>{row.missing_lines}</b> item{row.missing_lines > 1 ? "s have" : " has"} no selling price yet — a missing price is not zero; it can't be invoiced until approved.</span>
      <div className="flex-1" />
      {row.open_task_id
        ? <Button size="sm" onClick={() => navigate(`/pricing?view=${row.open_task_id}`)}>{row.open_task_no} · {priceLabel(row.open_task_status ?? "")}</Button>
        : <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Send for pricing</Button>}
      {open && <SendForPricingDialog source={{ source_type: sourceType, source_id: sourceId, doc_no: docNo, customer_name: customerName, missing_lines: row.missing_lines }}
        onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); navigate(`/pricing?view=${id}`); }} />}
    </div>
  );
}
