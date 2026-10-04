import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Calculator, CheckCircle2, ExternalLink, FileText, History, Link2, Save, Send, ShieldAlert, Undo2, UserRoundCog } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, SearchableSelect, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList, useProfileNames } from "@jst/data-access";
import { formatDate, formatDateTime } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { StatusFilter, useUrlState } from "../inventory/DocPage";
import { LookupPicker, ProductPicker } from "../inventory/pickers";
import { money, num } from "../accounting/common";
import { qtyFmt } from "../sales/common";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { COST_TONE, CurrencyInput, costLabel, rpc, useAction, useCan, useItemInfo } from "./common";

type Row = Record<string, unknown> & { id: string };
const icon = <Calculator className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";
const TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { OPEN: "warning", SUBMITTED: "info", RETURNED: "danger", APPROVED: "success", CANCELLED: "neutral" };
const LABEL: Record<string, string> = { OPEN: "Waiting for costs", SUBMITTED: "To approve", RETURNED: "Sent back", APPROVED: "Approved", CANCELLED: "Cancelled" };
const FILTERS = [{ label: "Mine", mine: true }, { label: "To approve", status: "SUBMITTED" }, { label: "Waiting", status: "OPEN" }, { label: "Sent back", status: "RETURNED" }, { label: "All" }] as { label: string; status?: string; mine?: boolean }[];

export function useCostPeople() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["cost-people", companyId], enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => (await rpc<{ user_id: string; full_name: string; can_approve: boolean }[]>("cost_people", { p_company_id: companyId })) ?? [],
  });
}

function useCostRealtime() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const ch = sb().channel(`costs-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_cost_tasks" }, () => {
        qc.invalidateQueries({ queryKey: ["list", "purchase_cost_tasks"] }); qc.invalidateQueries({ queryKey: ["cost-task"] }); qc.invalidateQueries({ queryKey: ["pending-costs"] });
      }).subscribe();
    return () => { void sb().removeChannel(ch); };
  }, [qc]);
}

export function CostsPage() {
  const c = useCan();
  const { params, update } = useUrlState();
  const tab = params.get("tab") ?? "tasks";
  const view = params.get("view");
  useCostRealtime();
  if (!c.costs) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="Purchase costs are restricted." /></Card>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Purchase Costs" icon={icon}
        description="Goods can be received before the price is known. The cost is entered later (by you or the person you assign), the accountant approves it, and the stock is valued — or the supplier bill sets it." />
      <Tabs value={tab} onChange={(t) => update({ tab: t === "tasks" ? null : t, f: null })} tabs={[
        { key: "tasks", label: "Cost tasks" }, { key: "pending", label: "Waiting for a cost" }, { key: "items", label: "Item costs" }, { key: "history", label: "Supplier price history" }]} />
      {tab === "tasks" && <TaskList onView={(id) => update({ view: id })} />}
      {tab === "pending" && <PendingCosts onOpenTask={(id) => update({ view: id })} />}
      {tab === "items" && <ItemCosts />}
      {tab === "history" && <PriceHistory />}
      {view && <CostTaskDialog id={view} onClose={() => update({ view: null })} />}
    </div>
  );
}

function TaskList({ onView }: { onView: (id: string) => void }) {
  const { companyId, session } = useAccess();
  const { params, update } = useUrlState();
  const f = Number(params.get("f") ?? "0") || 0;
  const flt = FILTERS[f];
  const list = useEntityList<Row>({
    table: "purchase_cost_tasks", select: "id, doc_no, status, assigned_to, due_date, currency, created_at, receipt:goods_receipts(doc_no, doc_date), supplier:suppliers(name), lines:purchase_cost_task_lines(id)",
    companyId, filters: { status: flt.status, assigned_to: flt.mine ? session?.user.id : undefined }, orderBy: { column: "created_at", ascending: false }, page: 1, pageSize: 100,
  });
  const rows = (list.data?.rows ?? []).filter((r) => !flt.mine || !["APPROVED", "CANCELLED"].includes(String(r.status)));
  const names = useProfileNames(rows.map((r) => r.assigned_to as string));
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-line px-3 py-2"><StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null })} /></div>
      <DataTable loading={list.isLoading} rows={rows} onView={(r) => onView(r.id)}
        columns={[
          { key: "d", header: "Task", width: "110px", cell: (r) => <span className="font-mono text-xs font-medium">{String(r.doc_no)}</span> },
          { key: "g", header: "Receipt", width: "150px", cell: (r) => <span className="font-mono text-xs">{(r.receipt as { doc_no: string } | null)?.doc_no}</span> },
          { key: "s", header: "Supplier", cell: (r) => (r.supplier as { name: string } | null)?.name },
          { key: "n", header: "Items", width: "70px", align: "right", cell: (r) => (r.lines as unknown[]).length },
          { key: "a", header: "Costs by", width: "150px", hideBelow: "md", cell: (r) => names.data?.[r.assigned_to as string] ?? "…" },
          { key: "st", header: "Status", width: "140px", cell: (r) => <Badge tone={TONE[String(r.status)]}>{LABEL[String(r.status)]}</Badge> },
        ]}
        empty={<EmptyState icon={icon} title="No cost tasks" description="Receipts waiting for a cost are under “Waiting for a cost”." />} />
    </Card>
  );
}

interface Pending { receipt_id: string; doc_no: string; doc_date: string; supplier_name: string | null; warehouse_code: string; purchase_order_no: string | null; missing_lines: number; total_lines: number; task_id: string | null; task_no: string | null; task_status: string | null }
function PendingCosts({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { companyId } = useAccess();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["pending-costs", companyId], enabled: !!companyId, queryFn: async () => (await rpc<Pending[]>("pending_purchase_costs", { p_company_id: companyId })) ?? [] });
  const rows = (q.data ?? []).map((r) => ({ ...r, id: r.receipt_id }));
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DataTable loading={q.isLoading} rows={rows} onView={(r) => navigate(`/goods-receipts?view=${r.receipt_id}`)}
        columns={[
          { key: "d", header: "Receipt", width: "150px", cell: (r) => <span className="font-mono text-xs font-medium">{r.doc_no}</span> },
          { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.doc_date) },
          { key: "s", header: "Supplier", cell: (r) => r.supplier_name ?? <span className="text-ink-faint">—</span> },
          { key: "po", header: "PO", width: "120px", hideBelow: "md", cell: (r) => <span className="font-mono text-xs">{r.purchase_order_no}</span> },
          { key: "m", header: "Without cost", width: "120px", align: "right", cell: (r) => `${r.missing_lines} of ${r.total_lines}` },
          { key: "t", header: "", width: "200px", align: "right", cell: (r) => r.task_id
            ? <Button size="sm" onClick={(e) => { e.stopPropagation(); onOpenTask(r.task_id!); }}>{r.task_no} · {LABEL[r.task_status ?? ""]}</Button>
            : <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); navigate(`/goods-receipts?view=${r.receipt_id}`); }}>Enter / assign cost</Button> },
        ]}
        empty={<EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Every receipt has a cost" />} />
    </Card>
  );
}

function ItemCosts() {
  const { companyId } = useAccess();
  const q = useQuery({ queryKey: ["item-costs", companyId], enabled: !!companyId, queryFn: async () => (await rpc<Row[]>("item_purchase_costs", { p_company_id: companyId })) ?? [] });
  const rows = (q.data ?? []).map((r, i) => ({ ...r, id: `${r.product_id}-${r.variant_id}-${i}` }) as Row);
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <p className="border-b border-line px-3 py-2 text-xs text-ink-muted">Average purchase cost in PKR over everything received with a cost (approved receipt costs and bills). Landed costs (freight, duty) are added in the shipments stage.</p>
      <DataTable loading={q.isLoading} rows={rows}
        columns={[
          { key: "p", header: "Item", cell: (r) => <span>{String(r.product_name)}{r.variant_name ? <span className="text-ink-muted"> · {String(r.variant_name)}</span> : null}</span> },
          { key: "q", header: "Qty costed", width: "120px", align: "right", cell: (r) => qtyFmt(r.costed_qty) },
          { key: "a", header: "Average cost", width: "140px", align: "right", cell: (r) => <span className="font-semibold tabular-nums">{money(r.avg_cost_pkr as number)}</span> },
          { key: "l", header: "Last cost", width: "140px", align: "right", cell: (r) => <span className="tabular-nums">{money(r.last_cost_pkr as number)}</span> },
          { key: "d", header: "Last received", width: "120px", hideBelow: "md", cell: (r) => formatDate(r.last_cost_date as string) },
        ]}
        empty={<EmptyState icon={icon} title="No costed receipts yet" />} />
    </Card>
  );
}

function PriceHistory() {
  const { companyId } = useAccess();
  const navigate = useNavigate();
  const [sup, setSup] = React.useState<string | null>(null);
  const [prod, setProd] = React.useState<string | null>(null);
  const q = useQuery({ queryKey: ["purchase-history", companyId, sup, prod], enabled: !!companyId,
    queryFn: async () => (await rpc<Row[]>("purchase_price_history", { p_company_id: companyId, p_supplier_id: sup, p_product_id: prod, p_limit: 500 })) ?? [] });
  const rows = (q.data ?? []).map((r, i) => ({ ...r, id: `${r.source_id}-${i}` }) as Row);
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="w-64"><LookupPicker value={sup} onChange={setSup} placeholder="All suppliers" spec={{ table: "suppliers", label: "name", secondary: "code", filters: {} }} /></div>
        <div className="w-72"><ProductPicker value={prod} onChange={setProd} showStock={false} placeholder="All items" /></div>
      </div>
      <DataTable loading={q.isLoading} rows={rows} onView={(r) => navigate(r.source === "BILL" ? `/supplier-bills?view=${r.source_id}` : `/goods-receipts?view=${r.source_id}`)}
        columns={[
          { key: "d", header: "Date", width: "100px", cell: (r) => formatDate(r.price_date as string) },
          { key: "s", header: "Supplier", cell: (r) => String(r.supplier_name ?? "") },
          { key: "p", header: "Item", cell: (r) => <span>{String(r.product_name)}{r.variant_name ? <span className="text-ink-muted"> · {String(r.variant_name)}</span> : null}</span> },
          { key: "q", header: "Qty", width: "80px", align: "right", hideBelow: "md", cell: (r) => qtyFmt(r.quantity) },
          { key: "u", header: "Price", width: "140px", align: "right", cell: (r) => <span className="font-medium tabular-nums">{r.currency !== "PKR" && <span className="text-2xs text-ink-muted">{String(r.currency)} </span>}{money(r.unit_price as number)}</span> },
          { key: "k", header: "PKR", width: "110px", align: "right", hideBelow: "md", cell: (r) => <span className="tabular-nums text-ink-muted">{money(r.unit_price_pkr as number)}</span> },
          { key: "src", header: "From", width: "150px", cell: (r) => <span className="flex items-center gap-1.5"><Badge tone={r.source === "BILL" ? "success" : "info"}>{r.source === "BILL" ? "Bill" : "Receipt cost"}</Badge><span className="font-mono text-xs">{String(r.source_doc)}</span></span> },
        ]}
        empty={<EmptyState icon={<History className="h-6 w-6" />} title="No purchase prices yet" />} />
    </Card>
  );
}

/* ───────────────────────── cost task dialog ───────────────────────── */
interface TLine { id: string; line_no: number; receipt_line_id: string; product_id: string; variant_id: string | null; quantity: number; last_cost: number | null; last_cost_currency: string | null; last_cost_date: string | null; last_cost_doc: string | null; entered_cost: number | null; approved_cost: number | null; note: string | null }
export function CostTaskDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { session } = useAccess();
  const c = useCan();
  const navigate = useNavigate();
  const people = useCostPeople();
  const files = useAttachments("purchase_cost_tasks", id);
  const q = useQuery({
    queryKey: ["cost-task", id],
    queryFn: async () => {
      const [h, l, e] = await Promise.all([
        sb().from("purchase_cost_tasks").select("*, receipt:goods_receipts(doc_no, doc_date, warehouse:warehouses(code)), supplier:suppliers(name)").eq("id", id).single(),
        sb().from("purchase_cost_task_lines").select("*").eq("task_id", id).order("line_no"),
        sb().from("purchase_cost_task_events").select("*").eq("task_id", id).order("at"),
      ]);
      if (h.error) throw h.error;
      return { h: h.data as Row, lines: (l.data ?? []) as TLine[], events: (e.data ?? []) as Row[] };
    },
  });
  const h = q.data?.h;
  const lines = q.data?.lines ?? [];
  const info = useItemInfo(lines.map((l) => l.product_id), lines.map((l) => l.variant_id));
  const names = useProfileNames([h?.assigned_to as string, ...(q.data?.events ?? []).map((e) => e.actor as string)]);
  const st = String(h?.status ?? "");
  const canEnter = ["OPEN", "RETURNED"].includes(st) && ((h?.assigned_to === session?.user.id && c.costs) || c.approve);
  const canReview = st === "SUBMITTED" && c.approve;
  const [cur, setCur] = React.useState("PKR");
  const [rate, setRate] = React.useState("1");
  const [cost, setCost] = React.useState<Record<string, string>>({});
  const [appr, setAppr] = React.useState<Record<string, string>>({});
  const [tab, setTab] = React.useState("lines");
  const [ask, setAsk] = React.useState<null | "submit" | "return" | "approve" | "reassign" | "cancel">(null);
  const [text, setText] = React.useState("");
  const [who, setWho] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!q.data) return;
    setCur(String(q.data.h.currency)); setRate(String(q.data.h.fx_rate));
    setCost(Object.fromEntries(q.data.lines.map((l) => [l.id, l.entered_cost == null ? "" : String(Number(l.entered_cost))])));
    setAppr(Object.fromEntries(q.data.lines.map((l) => [l.id, String(Number(l.approved_cost ?? l.entered_cost ?? ""))])));
  }, [q.data]);
  const payload = () => lines.map((l) => ({ id: l.id, cost: cost[l.id]?.trim() ? String(num(cost[l.id])) : null }));
  const done = () => { setAsk(null); setText(""); };
  const save = useAction(() => rpc("save_cost_task", { p_task_id: id, p_currency: cur, p_fx: num(rate) || 1, p_lines: payload() }), "Saved");
  const submit = useAction(() => rpc("submit_cost_task", { p_task_id: id, p_currency: cur, p_fx: num(rate) || 1, p_lines: payload(), p_note: text || null }), "Submitted to the accountant", done);
  const ret = useAction(() => rpc("return_cost_task", { p_task_id: id, p_reason: text }), "Sent back", done);
  const approve = useAction(() => rpc("approve_cost_task", { p_task_id: id, p_note: text || null,
    p_lines: lines.filter((l) => appr[l.id]?.trim() && num(appr[l.id]) !== Number(l.entered_cost)).map((l) => ({ id: l.id, cost: String(num(appr[l.id])) })) }), "Approved — stock valued (Inventory / Goods received not billed)", done);
  const reassign = useAction(() => rpc("reassign_cost_task", { p_task_id: id, p_assignee: who, p_note: text || null }), "Reassigned", done);
  const cancel = useAction(() => rpc("cancel_cost_task", { p_task_id: id, p_reason: text || null }), "Cancelled", done);
  const shown = (l: TLine) => (canEnter ? (cost[l.id]?.trim() ? num(cost[l.id]) : null) : canReview ? (appr[l.id]?.trim() ? num(appr[l.id]) : null) : (l.approved_cost ?? l.entered_cost));
  const total = lines.reduce((s, l) => s + (shown(l) ?? 0) * Number(l.quantity), 0);
  const missing = lines.filter((l) => shown(l) == null).length;
  const evLabel: Record<string, string> = { CREATED: "Sent for costing", SUBMITTED: "Costs submitted", RETURNED: "Sent back", APPROVED: "Approved", REASSIGNED: "Reassigned", CANCELLED: "Cancelled" };
  const rcpt = h?.receipt as { doc_no: string; doc_date: string; warehouse: { code: string } | null } | undefined;
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="purchase" icon={icon} title={h ? `${h.doc_no} · cost of ${rcpt?.doc_no}` : "Cost task"} subtitle={(h?.supplier as { name: string } | null)?.name}
        status={h ? <Badge tone={TONE[st]}>{LABEL[st]}</Badge> : null}
        footer={<>
          {!["APPROVED", "CANCELLED"].includes(st) && (c.costs || c.manage) && <>
            <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel task</Button>
            <Button variant="ghost" icon={<UserRoundCog className="h-3.5 w-3.5" />} onClick={() => { setWho((h?.assigned_to as string) ?? null); setAsk("reassign"); }}>Reassign</Button></>}
          <div className="flex-1" />
          {h && <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/goods-receipts?view=${h.receipt_id}`)}>{rcpt?.doc_no}</Button>}
          <Button onClick={onClose}>Close</Button>
          {canEnter && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>}
          {canEnter && <Button variant="primary" icon={<Send className="h-3.5 w-3.5" />} disabled={missing > 0} onClick={() => setAsk("submit")}>Submit for approval</Button>}
          {canReview && <Button variant="destructive-ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setAsk("return")}>Send back</Button>}
          {canReview && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={missing > 0} onClick={() => setAsk("approve")}>Approve costs</Button>}
        </>}>
        {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : h && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-6">
              <KeyValue label="Supplier">{(h.supplier as { name: string } | null)?.name ?? null}</KeyValue>
              <KeyValue label="Receipt">{rcpt ? `${rcpt.doc_no} · ${formatDate(rcpt.doc_date)}` : null}</KeyValue>
              <KeyValue label="Costs by">{names.data?.[h.assigned_to as string] ?? "…"}</KeyValue>
              <KeyValue label="Currency">{canEnter ? <CurrencyInput currency={cur} rate={rate} onCurrency={setCur} onRate={setRate} /> : `${h.currency}${h.currency !== "PKR" ? ` @ ${h.fx_rate}` : ""}`}</KeyValue>
              <KeyValue label="Value"><span className="font-semibold tabular-nums">{cur} {money(total)}</span>{cur !== "PKR" && <span className="block text-xs text-ink-muted">PKR {money(total * (num(rate) || 0))}</span>}</KeyValue>
              <KeyValue label="Needed by">{h.due_date ? formatDate(h.due_date as string) : null}</KeyValue>
            </dl>
            {st === "RETURNED" && h.return_reason ? <div className="mb-3 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><b>Sent back:</b> {String(h.return_reason)}</div> : null}
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.length})` }, { key: "files", label: filesLabel(files.data?.length) }, { key: "history", label: "History" }]} />
            {tab === "lines" && (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-subtle"><tr><th className={th}>#</th><th className={th}>Item</th><th className={cn(th, "text-right")}>Qty</th><th className={cn(th, "text-right")}>Last price from supplier</th>
                    <th className={cn(th, "w-36 text-right")}>Unit cost entered</th>{(canReview || st === "APPROVED") && <th className={cn(th, "w-36 text-right")}>Approved</th>}<th className={cn(th, "text-right")}>Amount</th></tr></thead>
                  <tbody>{lines.map((l) => {
                    const it = info.data?.products.get(l.product_id);
                    const v = shown(l);
                    return (
                      <tr key={l.id}>
                        <td className={cn(td, "text-ink-muted")}>{l.line_no}</td>
                        <td className={td}><div className="font-medium">{it?.name}{l.variant_id && <span className="font-normal text-ink-muted"> · {info.data?.variants.get(l.variant_id)}</span>}</div><div className="text-2xs text-ink-muted">{it?.sku}</div></td>
                        <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.quantity)} <span className="text-2xs text-ink-muted">{it?.uom}</span></td>
                        <td className={cn(td, "text-right")}>{l.last_cost != null ? <div><span className="tabular-nums">{l.last_cost_currency !== "PKR" && <span className="text-2xs">{l.last_cost_currency} </span>}{money(l.last_cost)}</span>
                          {canEnter && l.last_cost_currency === cur && <button className="ml-1 text-2xs text-primary hover:underline" onClick={() => setCost((s) => ({ ...s, [l.id]: String(Number(l.last_cost)) }))}>use</button>}
                          <div className="text-2xs text-ink-muted">{l.last_cost_doc} · {formatDate(l.last_cost_date)}</div></div> : <span className="text-xs text-ink-faint">first purchase</span>}</td>
                        <td className={td}>{canEnter ? <Input className="text-right tabular-nums" inputMode="decimal" placeholder="Cost" value={cost[l.id] ?? ""} onChange={(e) => setCost((s) => ({ ...s, [l.id]: e.target.value }))} />
                          : l.entered_cost == null ? <Badge tone="warning">Pending</Badge> : <span className="block text-right tabular-nums">{money(l.entered_cost)}</span>}</td>
                        {(canReview || st === "APPROVED") && <td className={td}>{canReview ? <Input className="text-right tabular-nums" inputMode="decimal" value={appr[l.id] ?? ""} onChange={(e) => setAppr((s) => ({ ...s, [l.id]: e.target.value }))} />
                          : <span className="block text-right font-medium tabular-nums text-success">{money(l.approved_cost)}</span>}</td>}
                        <td className={cn(td, "text-right tabular-nums")}>{v == null ? "—" : money(v * Number(l.quantity))}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
            {tab === "files" && <AttachmentsPanel entityType="purchase_cost_tasks" entityId={id} />}
            {tab === "history" && (
              <ol className="space-y-2">{(q.data?.events ?? []).map((e) => (
                <li key={e.id} className="rounded-card border border-line p-3 text-sm"><span className="font-medium">{evLabel[String(e.event)]}</span>
                  <span className="text-ink-muted"> by {names.data?.[e.actor as string] ?? "…"} · {formatDateTime(e.at as string)}</span>{e.note ? <p className="mt-1">{String(e.note)}</p> : null}</li>))}</ol>
            )}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask === "submit"} title="Submit costs for approval?" confirmLabel="Submit" loading={submit.isPending} onCancel={() => setAsk(null)} onConfirm={() => submit.mutate(undefined)} message="The accountant is alerted to approve them.">
        <Field label="Note" className="mt-3"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field></ConfirmDialog>
      <ConfirmDialog open={ask === "return"} title="Send costs back" tone="destructive" confirmLabel="Send back" loading={ret.isPending} onCancel={() => setAsk(null)} onConfirm={() => ret.mutate(undefined)} message="They go back with your reason.">
        <Field label="Reason" required className="mt-3"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field></ConfirmDialog>
      <ConfirmDialog open={ask === "approve"} title="Approve these costs?" confirmLabel="Approve" loading={approve.isPending} onCancel={() => setAsk(null)} onConfirm={() => approve.mutate(undefined)}
        message={`The stock on ${rcpt?.doc_no} is valued at PKR ${money(total * (num(rate) || 1))}: Inventory is debited and “Goods received not billed” credited until the supplier's bill arrives.`}>
        <Field label="Note" className="mt-3"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field></ConfirmDialog>
      <ConfirmDialog open={ask === "reassign"} title="Give this cost task to someone else" confirmLabel="Reassign" loading={reassign.isPending} onCancel={() => setAsk(null)} onConfirm={() => reassign.mutate(undefined)} message="They are alerted.">
        <Field label="Costs to be entered by" className="mt-3"><SearchableSelect value={who} onChange={setWho} options={(people.data ?? []).map((p) => ({ value: p.user_id, label: p.full_name }))} /></Field></ConfirmDialog>
      <ConfirmDialog open={ask === "cancel"} title="Cancel this cost task?" tone="destructive" confirmLabel="Cancel task" loading={cancel.isPending} onCancel={() => setAsk(null)} onConfirm={() => cancel.mutate(undefined)} message="The receipt goes back to “waiting for a cost”.">
        <Field label="Reason" className="mt-3"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field></ConfirmDialog>
    </>
  );
}

/* ───────────────────────── goods receipt: purchase panel ───────────────────────── */
interface LineCost { line_id: string; unit_cost: number | null; unit_cost_pkr: number | null; cost_source: string | null; billed_qty: number; currency: string | null; fx_rate: number | null }
/** Shown on a goods receipt for purchasing users: PO link, costs, enter cost now / send for costing, make the bill. */
export function ReceiptPurchasePanel({ receipt, lines }: { receipt: Row; lines: Row[] }) {
  const { companyId } = useAccess();
  const c = useCan();
  const navigate = useNavigate();
  const people = useCostPeople();
  const st = String(receipt.status);
  const costs = useQuery({ queryKey: ["receipt-costs", receipt.id], enabled: c.costs && st === "POSTED", queryFn: async () => (await rpc<LineCost[]>("receipt_line_costs", { p_receipt_id: receipt.id })) ?? [] });
  const po = useQuery({ queryKey: ["receipt-po", receipt.purchase_order_id], enabled: !!receipt.purchase_order_id,
    queryFn: async () => (await sb().from("purchase_orders").select("id, doc_no, currency, fx_rate").eq("id", receipt.purchase_order_id as string).single()).data as { id: string; doc_no: string; currency: string; fx_rate: number } | null });
  const task = useQuery({ queryKey: ["receipt-task", receipt.id], enabled: c.costs && st === "POSTED",
    queryFn: async () => (await sb().from("purchase_cost_tasks").select("id, doc_no, status").eq("receipt_id", receipt.id).in("status", ["OPEN", "SUBMITTED", "RETURNED"]).maybeSingle()).data as { id: string; doc_no: string; status: string } | null });
  const cmap = new Map((costs.data ?? []).map((x) => [x.line_id, x]));
  const uncosted = lines.filter((l) => cmap.get(l.id as string)?.unit_cost == null);
  const [entering, setEntering] = React.useState(false);
  const [assign, setAssign] = React.useState(false);
  const [linkPo, setLinkPo] = React.useState(false);
  const [cur, setCur] = React.useState("PKR");
  const [rate, setRate] = React.useState("1");
  const [val, setVal] = React.useState<Record<string, string>>({});
  const [who, setWho] = React.useState<string | null>(null);
  const [due, setDue] = React.useState("");
  const [poId, setPoId] = React.useState<string | null>(null);
  React.useEffect(() => { if (po.data) { setCur(po.data.currency); setRate(String(po.data.fx_rate)); } }, [po.data]);
  const enter = useAction(() => rpc("enter_receipt_cost", { p_receipt_id: receipt.id, p_currency: cur, p_fx: num(rate) || 1, p_approve: true,
    p_costs: uncosted.filter((l) => val[l.id as string]?.trim()).map((l) => ({ receipt_line_id: l.id, unit_cost: String(num(val[l.id as string])) })) }),
    c.approve ? "Cost entered and approved — stock valued" : "Cost entered — sent to the accountant for approval", () => setEntering(false));
  const send = useAction(() => rpc<string>("create_cost_task", { p_receipt_id: receipt.id, p_assignee: who, p_due: due || null }), "Sent for costing", () => setAssign(false));
  const link = useAction(() => rpc("link_receipt_to_po", { p_receipt_id: receipt.id, p_po_id: poId }), "Linked to the purchase order", () => setLinkPo(false));
  const bill = useAction(() => rpc<string>("create_bill_from_receipts", { p_company_id: companyId, p_receipt_ids: [receipt.id] }), "Draft bill made");
  if (!c.view && !c.costs) return null;
  const billedAll = lines.every((l) => Number(l.billed_qty ?? 0) >= Number(l.quantity));
  return (
    <div className="mb-4 rounded-card border border-teal-200 bg-teal-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Purchase</span>
        {po.data ? <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/purchase-orders?view=${po.data!.id}`)}>{po.data.doc_no}</Button>
          : <span className="text-sm text-ink-muted">Not against a purchase order</span>}
        {st === "DRAFT" && c.receive && <Button size="sm" variant="ghost" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setLinkPo(true)}>{po.data ? "Change PO" : "Link to PO"}</Button>}
        {c.costs && st === "POSTED" && <Badge tone={COST_TONE[String(receipt.cost_status)]}>{costLabel(String(receipt.cost_status))}</Badge>}
        {task.data && <Button size="sm" onClick={() => navigate(`/purchase-costs?view=${task.data!.id}`)}>{task.data.doc_no} · {LABEL[task.data.status]}</Button>}
        <div className="flex-1" />
        {c.costs && st === "POSTED" && uncosted.length > 0 && !task.data && <>
          <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setAssign(true)}>Send for costing</Button>
          <Button size="sm" variant="primary" icon={<Calculator className="h-3.5 w-3.5" />} onClick={() => setEntering((x) => !x)}>Enter purchase cost now</Button></>}
        {c.manage && c.costs && st === "POSTED" && !!receipt.supplier_id && !billedAll && <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} loading={bill.isPending}
          onClick={() => bill.mutate(undefined, { onSuccess: (bid) => navigate(`/supplier-bills?view=${bid}`) })}>Make supplier bill</Button>}
      </div>
      {c.costs && st === "POSTED" && (costs.data ?? []).some((x) => x.unit_cost != null) && !entering && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">{lines.map((l) => { const x = cmap.get(l.id as string); return x?.unit_cost != null ? (
          <span key={l.id as string} className="rounded-full border border-line bg-white px-2 py-0.5">#{String(l.line_no)} · {x.currency !== "PKR" && `${x.currency} `}{money(x.unit_cost)}{x.currency !== "PKR" && ` = PKR ${money(x.unit_cost_pkr)}`}
            {x.cost_source === "BILL" && <span className="text-ink-muted"> (bill)</span>}{Number(x.billed_qty) > 0 && <span className="text-success"> · billed {qtyFmt(x.billed_qty)}</span>}</span>) : null; })}</div>
      )}
      {entering && (
        <div className="mt-3 rounded-card border border-line bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-3"><span className="text-sm font-medium">Unit cost per item</span><CurrencyInput currency={cur} rate={rate} onCurrency={setCur} onRate={setRate} />
            <span className="text-xs text-ink-muted">{c.approve ? "Approved straight away (you can approve costs)." : "Goes to the accountant for approval."}</span></div>
          <table className="w-full text-sm"><tbody>{uncosted.map((l) => (
            <tr key={l.id as string}><td className="py-1 pr-2">{(l.product as { name: string } | null)?.name}{l.variant ? <span className="text-ink-muted"> · {(l.variant as { name: string }).name}</span> : null}</td>
              <td className="w-24 py-1 text-right tabular-nums">{qtyFmt(l.quantity)}</td>
              <td className="w-36 py-1 pl-2"><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={val[l.id as string] ?? ""} onChange={(e) => setVal((s) => ({ ...s, [l.id as string]: e.target.value }))} /></td>
              <td className="w-32 py-1 text-right tabular-nums text-ink-muted">{val[l.id as string]?.trim() ? money(num(val[l.id as string]) * Number(l.quantity)) : ""}</td></tr>))}</tbody></table>
          <div className="mt-2 flex justify-end gap-2"><Button size="sm" onClick={() => setEntering(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={uncosted.some((l) => !val[l.id as string]?.trim())} loading={enter.isPending} onClick={() => enter.mutate(undefined)}>{c.approve ? "Save & approve cost" : "Submit cost"}</Button></div>
        </div>
      )}
      <ConfirmDialog open={assign} title="Send for costing" confirmLabel="Send" loading={send.isPending} onCancel={() => setAssign(false)} onConfirm={() => send.mutate(undefined)}
        message="The person you choose enters the purchase cost; the accountant approves it.">
        <FormGrid cols={2} className="mt-3">
          <Field label="Costs to be entered by" className="sm:col-span-2"><SearchableSelect value={who} onChange={setWho} options={(people.data ?? []).map((p) => ({ value: p.user_id, label: p.full_name }))} /></Field>
          <Field label="Needed by"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </FormGrid>
      </ConfirmDialog>
      <ConfirmDialog open={linkPo} title="Link this receipt to a purchase order" confirmLabel="Link" loading={link.isPending} onCancel={() => setLinkPo(false)} onConfirm={() => link.mutate(undefined)}
        message="When the receipt is posted, the quantities count as received on that order.">
        <Field label="Purchase order" className="mt-3"><LookupPicker value={poId} onChange={setPoId} placeholder="Approved PO…"
          spec={{ table: "purchase_orders", label: "doc_no", secondary: "status", filters: receipt.supplier_id ? { supplier_id: receipt.supplier_id as string } : {} }} /></Field>
      </ConfirmDialog>
    </div>
  );
}
