import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, ClipboardList, ExternalLink, Lock, Pencil, Plus, ShieldAlert, ShoppingCart, Truck } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, KeyValue, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { money } from "../accounting/common";
import { SO_TONE, qtyFmt, soLabel, useSoLinePrices } from "./common";
import { SalesOrderForm, type SoInitial } from "./SalesOrderForm";

type Row = Record<string, unknown> & { id: string };
const FILTERS = [
  { label: "Open", statuses: ["DRAFT", "APPROVED", "PARTIALLY_DELIVERED"] },
  { label: "Awaiting approval", status: "DRAFT" },
  { label: "To dispatch", statuses: ["APPROVED", "PARTIALLY_DELIVERED"] },
  { label: "Delivered", status: "DELIVERED" },
  { label: "Closed / cancelled", statuses: ["CLOSED", "CANCELLED"] },
  { label: "All" },
] as { label: string; status?: string; statuses?: string[] }[];
const icon = <ShoppingCart className="h-4 w-4" />;

export function SalesOrdersPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";

  const list = useEntityList<Row>({
    table: "sales_orders",
    select: "id, doc_no, order_date, status, customer_reference, customer:customers(name, code), lines:sales_order_lines(id, quantity, delivered_qty, is_active)",
    companyId, search: q, searchColumns: ["doc_no", "customer_reference"],
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: can(P.salesView),
  });
  const canPrices = can(P.salesViewPrices);
  const prices = useSoLinePrices((list.data?.rows ?? []).map((r) => r.id));
  if (!can(P.salesView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) => !FILTERS[f].statuses || FILTERS[f].statuses!.includes(String(r.status)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Sales Orders" icon={icon}
        description="Quantities per warehouse, prices (or pending), approval reserves stock. Dispatch with a GDN, then invoice."
        actions={can(P.salesManage) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New Sales Order</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search SO no. / customer ref…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable
            loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "Sales order", width: "140px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "d", header: "Date", width: "105px", cell: (r) => formatDate(r.order_date as string) },
              { key: "c", header: "Customer", cell: (r) => { const c = r.customer as { name: string; code: string }; return <span>{c.name} <span className="text-2xs text-ink-faint">{c.code}</span></span>; } },
              { key: "ref", header: "Customer ref.", hideBelow: "lg", cell: (r) => (r.customer_reference as string) || "" },
              {
                key: "prog", header: "Delivered", width: "150px", hideBelow: "md", cell: (r) => {
                  const ls = (r.lines as { quantity: number; delivered_qty: number; is_active: boolean }[]).filter((l) => l.is_active);
                  const o = ls.reduce((a, l) => a + Number(l.quantity), 0), d = ls.reduce((a, l) => a + Number(l.delivered_qty), 0);
                  const pct = o > 0 ? Math.min(100, (d / o) * 100) : 0;
                  return <div className="w-full"><div className="text-2xs tabular-nums text-ink-muted">{qtyFmt(d)} / {qtyFmt(o)}</div><div className="h-1.5 rounded-full bg-subtle"><div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} /></div></div>;
                },
              },
              ...(canPrices ? [{
                key: "amt", header: "Value", align: "right" as const, width: "130px", hideBelow: "md" as const, cell: (r: Row) => {
                  const ls = (r.lines as { id: string; quantity: number; is_active: boolean }[]).filter((l) => l.is_active);
                  if (!prices.data) return null;
                  const pr = (l: { id: string }) => prices.data!.byLine.get(l.id) ?? null;
                  const pend = ls.some((l) => pr(l) == null);
                  return <span className="tabular-nums">{money(ls.reduce((a, l) => a + Number(l.quantity) * Number(pr(l) ?? 0), 0))}{pend && <span className="ml-1 text-2xs text-warning">+pending</span>}</span>;
                },
              }] : []),
              { key: "s", header: "Status", width: "140px", cell: (r) => <Badge tone={SO_TONE[String(r.status)]}>{soLabel(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No sales orders" description="Create one with “New Sales Order”, or convert a Reserved Order." />}
          />
        )}
      </Card>
      {(viewId || creating) && <SalesOrderDialog id={viewId} onClose={() => update({ view: null, new: null })} onSaved={(id) => update({ view: id, new: null })} />}
    </div>
  );
}

interface SoLine {
  id: string; line_no: number; quantity: number; delivered_qty: number; unit_price: number | null; notes: string | null; product_id: string; variant_id: string | null;
  product: { name: string; sku: string; uom: { code: string } }; variant: { name: string } | null;
  allocations: { id: string; warehouse_id: string; quantity: number; reserved_quantity: number; delivered_quantity: number; status: string; warehouse: { code: string; name: string } }[];
}

function useSo(id: string | null) {
  return useQuery({
    queryKey: ["record", "sales_orders", id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l, g] = await Promise.all([
        sb().from("sales_orders").select("id, doc_no, order_date, status, customer_id, customer_reference, notes, approved_at, cancelled_at, cancel_reason, closed_at, close_reason, source_reservation_order_id, customer:customers(name, code, city), source:reservation_orders!sales_orders_source_reservation_order_id_fkey(doc_no), quote:quotations!sales_orders_source_quotation_id_fkey(id, doc_no)").eq("id", id!).single(),
        sb().from("sales_order_lines").select("id, line_no, quantity, delivered_qty, notes, product_id, variant_id, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name), allocations:sales_order_line_warehouse_allocations(id, warehouse_id, quantity, reserved_quantity, delivered_quantity, status, warehouse:warehouses(code, name))").eq("sales_order_id", id!).eq("is_active", true).order("line_no"),
        sb().from("gdns").select("id, doc_no, gdn_date, status").eq("sales_order_id", id!).order("created_at"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      // prices come separately (hidden from warehouse roles — the RPC returns nothing for them)
      const pr = await sb().rpc("so_line_prices", { p_so_ids: [id] });
      const pm = new Map(((pr.data ?? []) as { line_id: string; unit_price: number | null }[]).map((x) => [x.line_id, x.unit_price]));
      const lines = (l.data as unknown as SoLine[]).map((x) => ({ ...x, unit_price: pm.get(x.id) ?? null }));
      return { header: h.data as unknown as Row, lines, gdns: (g.data ?? []) as { id: string; doc_no: string; gdn_date: string; status: string }[] };
    },
  });
}

export function SalesOrderDialog({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const doc = useSo(id);
  const [mode, setMode] = React.useState<"view" | "edit">(id ? "view" : "edit");
  React.useEffect(() => setMode(id ? "view" : "edit"), [id]);
  if (mode === "edit" && (!id || doc.data)) {
    const initial: SoInitial | null = doc.data ? { header: doc.data.header, lines: doc.data.lines.map((l) => ({ ...l })) } : null;
    const revise = !!doc.data && String(doc.data.header.status) !== "DRAFT";
    return <SalesOrderForm id={id} initial={initial} revise={revise} onCancel={() => (id ? setMode("view") : onClose())} onClose={onClose} onSaved={(nid) => { setMode("view"); onSaved(nid); }} />;
  }
  return <SoView id={id!} doc={doc} onEdit={() => setMode("edit")} onClose={onClose} />;
}

function SoView({ id, doc, onEdit, onClose }: { id: string; doc: ReturnType<typeof useSo>; onEdit: () => void; onClose: () => void }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState("lines");
  const [confirm, setConfirm] = React.useState<null | "approve" | "cancel" | "close">(null);
  const [reason, setReason] = React.useState("");
  const act = useMutation({
    mutationFn: async (kind: "approve" | "cancel" | "close") => {
      const r = kind === "approve" ? await sb().rpc("approve_sales_order", { p_id: id })
        : kind === "cancel" ? await sb().rpc("cancel_sales_order", { p_id: id, p_reason: reason.trim() })
        : await sb().rpc("close_sales_order", { p_id: id, p_reason: reason.trim() });
      if (r.error) throw r.error;
    },
    onSuccess: (_d, kind) => { toast.success(kind === "approve" ? "Approved — stock reserved" : kind === "cancel" ? "Cancelled — reserved stock released" : "Closed — remaining reservations released"); setConfirm(null); setReason(""); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const h = doc.data?.header;
  const status = String(h?.status ?? "");
  const cust = h?.customer as { name: string; code: string; city: string | null } | undefined;
  const src = h?.source as { doc_no: string } | null;
  const lines = doc.data?.lines ?? [];
  const total = lines.reduce((a, l) => a + Number(l.quantity) * Number(l.unit_price ?? 0), 0);
  const pending = lines.filter((l) => l.unit_price == null).length;
  const dispatchable = ["APPROVED", "PARTIALLY_DELIVERED"].includes(status);
  const canPrices = can(P.salesViewPrices);
  const quote = h?.quote as { doc_no: string } | null | undefined;

  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="xl" icon={icon}
        title={h ? String(h.doc_no) : "Sales Order"} subtitle={cust ? `${cust.name}${cust.city ? ` · ${cust.city}` : ""}` : undefined}
        status={h ? <Badge tone={SO_TONE[status]}>{soLabel(status)}</Badge> : null}
        footer={
          <>
            {["DRAFT", "APPROVED"].includes(status) && can(P.salesManage) && !lines.some((l) => Number(l.delivered_qty) > 0) && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm("cancel")}>Cancel order</Button>}
            {dispatchable && can(P.salesManage) && lines.some((l) => Number(l.delivered_qty) > 0) && <Button variant="destructive-ghost" icon={<Lock className="h-3.5 w-3.5" />} onClick={() => setConfirm("close")}>Close order</Button>}
            <div className="flex-1" />
            {src && <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/reservations?view=${h!.source_reservation_order_id}`)}>{src.doc_no}</Button>}
            <Button onClick={onClose}>Close</Button>
            {(status === "DRAFT" ? can(P.salesManage) : ["APPROVED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(status) && can(P.salesManage) && can(P.salesApprove)) &&
              <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
            {status === "DRAFT" && can(P.salesApprove) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("approve")}>Approve</Button>}
            {quote && canPrices && <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/quotations?view=${(h!.quote as { id: string }).id}`)}>{quote.doc_no}</Button>}
            {dispatchable && can(P.pickingManage) && <Button icon={<ClipboardList className="h-3.5 w-3.5" />} onClick={() => navigate(`/picking?new=1&so=${id}`)}>Picking task</Button>}
            {dispatchable && can(P.salesDispatch) && <Button variant="primary" icon={<Truck className="h-3.5 w-3.5" />} onClick={() => navigate(`/gdn?new=1&so=${id}`)}>Create GDN</Button>}
          </>
        }
      >
        {doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : h && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <KeyValue label="Customer">{cust?.name}</KeyValue>
              <KeyValue label="Order date">{formatDate(h.order_date as string)}</KeyValue>
              <KeyValue label="Customer ref.">{(h.customer_reference as string) || null}</KeyValue>
              {canPrices ? <KeyValue label="Value"><span className="font-semibold tabular-nums">{money(total)}</span>{pending > 0 && <span className="ml-1 text-xs text-warning">+ {pending} pending</span>}</KeyValue>
                : <KeyValue label="From quotation">{quote?.doc_no ?? null}</KeyValue>}
              {h.approved_at ? <KeyValue label="Approved">{formatDateTime(h.approved_at as string)}</KeyValue> : <KeyValue label="From reservation">{src?.doc_no ?? null}</KeyValue>}
              {h.cancel_reason ? <KeyValue label="Cancel reason" className="col-span-2">{String(h.cancel_reason)}</KeyValue> : null}
              {h.close_reason ? <KeyValue label="Close reason" className="col-span-2">{String(h.close_reason)}</KeyValue> : null}
              {h.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-5">{String(h.notes)}</KeyValue> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: "lines", label: `Items (${lines.length})` },
              { key: "gdns", label: `Dispatches (${doc.data!.gdns.filter((g) => g.status !== "CANCELLED").length})` },
              ...(can("audit.view") ? [{ key: "history", label: "History" }] : []),
            ]} />
            {tab === "history" && <AuditTimeline table="sales_orders" id={id} />}
            {tab === "gdns" && (
              <div className="flex flex-wrap gap-2">
                {doc.data!.gdns.map((g) => (
                  <button key={g.id} onClick={() => navigate(`/gdn?view=${g.id}`)} className="rounded-control border border-line px-3 py-1.5 text-left text-xs hover:border-primary">
                    <div className="font-mono font-medium">{g.doc_no}</div><div className="text-ink-muted">{formatDate(g.gdn_date)} · {g.status.toLowerCase()}</div>
                  </button>
                ))}
                {doc.data!.gdns.length === 0 && <p className="text-xs text-ink-muted">Nothing dispatched yet.</p>}
              </div>
            )}
            {tab === "lines" && (
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">#</th><th className="px-3">Item</th><th className="px-3">Per warehouse (ordered · delivered)</th>
                    <th className="px-3 text-right">Qty</th>{canPrices && <><th className="px-3 text-right">Price</th><th className="px-3 text-right">Amount</th></>}
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const td = "border-b border-line/70 px-3 py-2 align-top";
                      return (
                        <tr key={l.id}>
                          <td className={cn(td, "w-8 text-ink-faint")}>{l.line_no}</td>
                          <td className={td}><div className="font-medium">{l.product.name}{l.variant ? <span className="font-normal text-ink-muted"> · {l.variant.name}</span> : null}</div><div className="text-2xs text-ink-muted">{l.product.sku}</div></td>
                          <td className={td}>
                            <div className="flex flex-wrap gap-1.5">
                              {l.allocations.filter((a) => a.status !== "CANCELLED").map((a) => (
                                <span key={a.id} className={cn("inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-xs", a.status === "CLOSED" ? "border-line text-ink-faint" : "border-line bg-subtle")}>
                                  <span className="font-mono">{a.warehouse.code}</span>
                                  <span className="tabular-nums font-medium">{qtyFmt(a.quantity)}</span>
                                  <span className="tabular-nums text-ink-muted">· {qtyFmt(a.delivered_quantity)} sent</span>
                                  {Number(a.reserved_quantity) > 0 && <Badge tone="info">{qtyFmt(a.reserved_quantity)} held</Badge>}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className={cn(td, "text-right tabular-nums font-medium")}>{qtyFmt(l.quantity)} <span className="text-2xs font-normal text-ink-faint">{l.product.uom?.code}</span><div className="text-2xs font-normal text-ink-muted">{qtyFmt(l.delivered_qty)} delivered</div></td>
                          {canPrices && <td className={cn(td, "text-right tabular-nums")}>{l.unit_price == null ? <Badge tone="warning">Pending</Badge> : money(l.unit_price)}</td>}
                          {canPrices && <td className={cn(td, "text-right tabular-nums")}>{l.unit_price == null ? "" : money(Number(l.quantity) * Number(l.unit_price))}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={confirm === "approve"} title={`Approve ${h?.doc_no ?? ""}?`} message="Stock is reserved in each warehouse for this order and it is released to the warehouse for dispatch."
        confirmLabel="Approve" loading={act.isPending} onCancel={() => setConfirm(null)} onConfirm={() => act.mutate("approve")} />
      <ConfirmDialog open={confirm === "cancel" || confirm === "close"} title={confirm === "close" ? `Close ${h?.doc_no ?? ""}?` : `Cancel ${h?.doc_no ?? ""}?`}
        message={confirm === "close" ? "What has been delivered stays. The rest will not be delivered and its reserved stock is released." : "All stock reserved for this order is released. The order is kept for history."}
        tone="destructive" confirmLabel={confirm === "close" ? "Close order" : "Cancel order"} cancelLabel="Keep order" loading={act.isPending}
        onCancel={() => { setConfirm(null); setReason(""); }} onConfirm={() => (reason.trim() ? act.mutate(confirm!) : toast.error("Enter a reason"))}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}
