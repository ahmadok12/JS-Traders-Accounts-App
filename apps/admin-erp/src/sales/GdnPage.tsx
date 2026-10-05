import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, ExternalLink, FileText, Pencil, Plus, Printer, RotateCcw, Save, ShieldAlert, Truck, Undo2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, SearchableSelect, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { MovementsTable } from "../inventory/MovementsTable";
import { money, today } from "../accounting/common";
import { fetchGdnLinePrices, n, qtyFmt } from "./common";
import { printDocument } from "./print";
import { PricingStrip } from "../pricing/PricingPage";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";

type Row = Record<string, unknown> & { id: string };
export const GDN_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { DRAFT: "warning", POSTED: "success", CANCELLED: "neutral", REVERSED: "danger" };
const gdnLabel = (s: string) => (s === "DRAFT" ? "Draft" : s === "POSTED" ? "Dispatched" : s.charAt(0) + s.slice(1).toLowerCase());
const FILTERS = [
  { label: "To invoice", status: "POSTED", uninvoiced: true },
  { label: "Drafts", status: "DRAFT" },
  { label: "Dispatched", status: "POSTED" },
  { label: "Cancelled / reversed", statuses: ["CANCELLED", "REVERSED"] },
  { label: "All" },
] as { label: string; status?: string; statuses?: string[]; uninvoiced?: boolean }[];
const icon = <Truck className="h-4 w-4" />;
const leftToInvoice = (ls: { quantity: number; invoiced_qty: number; returned_open_qty?: number }[]) => ls.reduce((a, l) => a + Number(l.quantity) - Number(l.invoiced_qty) - Number(l.returned_open_qty ?? 0), 0);

export function GdnPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";
  const soParam = params.get("so");
  const editParam = params.get("edit") === "1";
  const allowed = can(P.salesView) || can(P.inventoryView);

  const list = useEntityList<Row>({
    table: "gdns",
    select: "id, doc_no, gdn_date, status, transport_details, customer:customers(name, code), so:sales_orders(doc_no), lines:gdn_lines(quantity, invoiced_qty, returned_open_qty)",
    companyId, search: q, searchColumns: ["doc_no", "transport_details"],
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: allowed,
  });
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const flt = FILTERS[f];
  const rows = (list.data?.rows ?? []).filter((r) =>
    (!flt.statuses || flt.statuses.includes(String(r.status))) && (!flt.uninvoiced || leftToInvoice(r.lines as { quantity: number; invoiced_qty: number }[]) > 0));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Dispatch (GDN)" icon={icon}
        description="Goods delivery notes take stock out of the warehouse it actually left. Partial deliveries are fine — the order stays open for the rest."
        actions={can(P.salesDispatch) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New GDN</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search GDN no. / transport…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable
            loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null, so: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "GDN", width: "130px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "d", header: "Date", width: "105px", cell: (r) => formatDate(r.gdn_date as string) },
              { key: "c", header: "Customer", cell: (r) => { const c = r.customer as { name: string; code: string } | null; return c ? <span>{c.name} <span className="text-2xs text-ink-faint">{c.code}</span></span> : <span className="text-ink-faint">—</span>; } },
              { key: "so", header: "Sales order", width: "130px", hideBelow: "md", cell: (r) => <span className="font-mono text-xs">{(r.so as { doc_no: string } | null)?.doc_no}</span> },
              { key: "t", header: "Transport", hideBelow: "lg", cell: (r) => <span className="text-xs text-ink-muted">{(r.transport_details as string) || ""}</span> },
              {
                key: "inv", header: "Invoiced", width: "120px", hideBelow: "md", cell: (r) => {
                  if (r.status !== "POSTED") return null;
                  const ls = r.lines as { quantity: number; invoiced_qty: number }[];
                  const left = leftToInvoice(ls), tot = ls.reduce((a, l) => a + Number(l.quantity), 0);
                  return left <= 0 ? <Badge tone="success">Invoiced</Badge> : left < tot ? <Badge tone="info">Part invoiced</Badge> : <Badge tone="warning">Not invoiced</Badge>;
                },
              },
              { key: "s", header: "Status", width: "120px", cell: (r) => <Badge tone={GDN_TONE[String(r.status)]}>{gdnLabel(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No dispatches" description="Open an approved sales order and press “Create GDN”, or use “New GDN”." />}
          />
        )}
      </Card>
      {(viewId || creating) && (
        <GdnDialog key={viewId ?? "new"} id={viewId} soId={soParam} startEdit={editParam} onClose={() => update({ view: null, new: null, so: null, edit: null })} onSaved={(id) => update({ view: id, new: null, so: null, edit: null })} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- data */
interface DraftItem { allocation_id: string; quantity: number }
function useGdn(id: string | null) {
  return useQuery({
    queryKey: ["record", "gdns", id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from("gdns").select("id, doc_no, gdn_date, status, sales_order_id, customer_id, transport_details, notes, lines_draft, posted_at, reversed_at, reversal_reason, customer:customers(name, code, city), so:sales_orders(doc_no, customer_reference)").eq("id", id!).single(),
        sb().from("gdn_lines").select("id, line_no, quantity, invoiced_qty, returned_open_qty, returned_credit_qty, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name), warehouse:warehouses(code, name)").eq("gdn_id", id!).order("line_no"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      const pm = await fetchGdnLinePrices([id!]);
      const lines = ((l.data ?? []) as unknown as GdnLine[]).map((x) => ({ ...x, unit_price: pm.get(x.id) ?? null }));
      return { header: h.data as unknown as Row, lines };
    },
  });
}
interface GdnLine {
  id: string; line_no: number; quantity: number; invoiced_qty: number; returned_open_qty?: number; returned_credit_qty?: number; unit_price: number | null;
  product: { name: string; sku: string; uom: { code: string } | null }; variant: { name: string } | null; warehouse: { code: string; name: string };
}

interface DispatchRow {
  allocation_id: string; line_no: number; ordered: number; delivered: number; remaining: number;
  product_id: string; variant_id: string | null; product: string; sku: string; uom: string; variant: string | null; is_bundle: boolean; rolls: boolean;
  warehouse_id: string; wh_code: string; on_hand: number | null;
}
/** What is left to dispatch on a sales order: one row per item × warehouse (open allocations) with stock on hand there. */
function useDispatchRows(soId: string | null) {
  return useQuery({
    queryKey: ["so-dispatch-rows", soId],
    enabled: !!soId,
    queryFn: async () => {
      const { data, error } = await sb().from("sales_order_lines")
        .select("id, line_no, product_id, variant_id, product:products(name, sku, is_bundle, tracking_type, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name), allocations:sales_order_line_warehouse_allocations(id, warehouse_id, quantity, delivered_quantity, status, warehouse:warehouses(code))")
        .eq("sales_order_id", soId!).eq("is_active", true).order("line_no");
      if (error) throw error;
      type L = { line_no: number; product_id: string; variant_id: string | null; product: { name: string; sku: string; is_bundle: boolean; tracking_type: string; uom: { code: string } | null }; variant: { name: string } | null; allocations: { id: string; warehouse_id: string; quantity: number; delivered_quantity: number; status: string; warehouse: { code: string } }[] };
      const lines = (data ?? []) as unknown as L[];
      const pids = Array.from(new Set(lines.map((l) => l.product_id)));
      const stock = new Map<string, number>();
      if (pids.length) {
        const s = await sb().from("stock_on_hand").select("warehouse_id, product_id, variant_id, on_hand").in("product_id", pids);
        if (s.error) throw s.error;
        for (const r of s.data ?? []) stock.set(`${r.warehouse_id}|${r.product_id}|${r.variant_id ?? ""}`, Number(r.on_hand));
      }
      const out: DispatchRow[] = [];
      for (const l of lines) for (const a of l.allocations) {
        if (a.status === "CANCELLED") continue;
        out.push({
          allocation_id: a.id, line_no: l.line_no, ordered: Number(a.quantity), delivered: Number(a.delivered_quantity),
          remaining: a.status === "OPEN" ? Math.max(0, Number(a.quantity) - Number(a.delivered_quantity)) : 0,
          product_id: l.product_id, variant_id: l.variant_id, product: l.product.name, sku: l.product.sku, uom: l.product.uom?.code ?? "", variant: l.variant?.name ?? null,
          is_bundle: l.product.is_bundle, rolls: l.product.tracking_type === "PHYSICAL_UNIT",
          warehouse_id: a.warehouse_id, wh_code: a.warehouse.code,
          on_hand: l.product.is_bundle ? null : stock.get(`${a.warehouse_id}|${l.product_id}|${l.variant_id ?? ""}`) ?? 0,
        });
      }
      return out.sort((a, b) => a.line_no - b.line_no || a.wh_code.localeCompare(b.wh_code));
    },
  });
}

function useOpenOrders() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["open-sales-orders", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("sales_orders").select("id, doc_no, order_date, status, customer:customers(name, code)")
        .eq("company_id", companyId!).in("status", ["APPROVED", "PARTIALLY_DELIVERED"]).order("order_date", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const c = r.customer as unknown as { name: string; code: string } | null;
        return { value: r.id as string, label: `${r.doc_no} · ${c?.name ?? ""}`, secondary: `${formatDate(r.order_date as string)}${r.status === "PARTIALLY_DELIVERED" ? " · part delivered" : ""}` };
      });
    },
  });
}

/* ---------------------------------------------------------------- dialog */
function GdnDialog({ id, soId, startEdit, onClose, onSaved }: { id: string | null; soId: string | null; startEdit?: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const doc = useGdn(id);
  const [mode, setMode] = React.useState<"view" | "edit">(id && !startEdit ? "view" : "edit");
  const editable = !id || doc.data?.header.status === "DRAFT";
  if (mode === "edit" && (!id || doc.data) && editable) {
    return <GdnForm id={id} header={doc.data?.header ?? null} presetSo={soId} onCancel={() => (id ? setMode("view") : onClose())} onClose={onClose} onSaved={(nid) => { setMode("view"); onSaved(nid); }} />;
  }
  return <GdnView id={id!} doc={doc} onEdit={() => setMode("edit")} onClose={onClose} />;
}

function GdnForm({ id, header, presetSo, onCancel, onClose, onSaved }: {
  id: string | null; header: Row | null; presetSo: string | null; onCancel: () => void; onClose: () => void; onSaved: (id: string) => void;
}) {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const idem = React.useRef(crypto.randomUUID());
  const orders = useOpenOrders();
  const [soId, setSoId] = React.useState<string | null>((header?.sales_order_id as string | undefined) ?? presetSo ?? null);
  const [date, setDate] = React.useState<string>((header?.gdn_date as string | undefined) ?? today());
  const [transport, setTransport] = React.useState<string>((header?.transport_details as string | undefined) ?? "");
  const [notes, setNotes] = React.useState<string>((header?.notes as string | undefined) ?? "");
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [touched, setTouched] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const rows = useDispatchRows(soId);
  const { guard, dialog } = useUnsavedGuard(touched);
  const initFor = React.useRef<string | null>(null);

  // Fill the quantities once per order: the saved draft when editing, otherwise everything still to send.
  React.useEffect(() => {
    if (!rows.data || !soId || initFor.current === soId) return;
    initFor.current = soId;
    const draft = new Map(((header?.lines_draft as DraftItem[] | undefined) ?? []).map((d) => [d.allocation_id, d.quantity]));
    const fromDraft = header && header.sales_order_id === soId;
    setQty(Object.fromEntries(rows.data.map((r) => [r.allocation_id, fromDraft ? (draft.has(r.allocation_id) ? String(Number(draft.get(r.allocation_id))) : "") : r.remaining > 0 ? String(r.remaining) : ""])));
  }, [rows.data, soId, header]);

  const edit = <T,>(fn: (v: T) => void) => (v: T) => { setTouched(true); fn(v); };
  const errors: Record<string, string> = {};
  if (!soId) errors.so = "Choose the sales order";
  const send = (rows.data ?? []).filter((r) => n(qty[r.allocation_id]) > 0);
  for (const r of rows.data ?? []) {
    const v = qty[r.allocation_id] ?? "";
    if (v.trim() === "") continue;
    if (!(n(v) >= 0)) errors[r.allocation_id] = "Invalid";
    else if (n(v) > r.remaining + 1e-9) errors[r.allocation_id] = `Only ${qtyFmt(r.remaining)} left`;
  }
  if (soId && rows.data && !send.length) errors.lines = "Enter the quantity sent for at least one item";
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const shortStock = send.filter((r) => r.on_hand != null && n(qty[r.allocation_id]) > r.on_hand);

  const save = useMutation({
    mutationFn: async (post: boolean) => {
      const { data, error } = await sb().rpc("save_gdn", {
        p_id: id,
        p_header: { company_id: companyId, sales_order_id: soId, gdn_date: date, transport_details: transport, notes },
        p_lines: send.map((r) => ({ allocation_id: r.allocation_id, quantity: (qty[r.allocation_id] ?? "").replace(/,/g, "") })),
        p_idempotency_key: id ? null : idem.current,
      });
      if (error) throw error;
      const nid = data as string;
      if (post) {
        const r = await sb().rpc("post_gdn", { p_id: nid });
        if (r.error) throw Object.assign(r.error, { savedId: nid });
      }
      return { nid, post };
    },
    onSuccess: ({ nid, post }) => {
      setTouched(false); idem.current = crypto.randomUUID();
      toast.success(post ? "Dispatched — stock taken out of the warehouse" : "GDN saved as draft"); qc.invalidateQueries(); onSaved(nid);
    },
    onError: (e: Error & { savedId?: string }) => {
      if (e.savedId) { setTouched(false); toast.error(`Saved as draft, but not dispatched: ${friendlyError(e)}`); qc.invalidateQueries(); onSaved(e.savedId); }
      else toast.error(friendlyError(e));
    },
  });
  const submit = (post: boolean) => {
    setShowErrors(true);
    if (Object.keys(errors).length) { toast.error("Please fix the highlighted fields"); return; }
    if (!save.isPending) save.mutate(post);
  };
  const total = send.reduce((a, r) => a + n(qty[r.allocation_id]), 0);

  return (
    <>
      <ErpDialog open onRequestClose={() => guard(onClose)} size="full" accent="dispatch" icon={icon}
        title={id ? `Edit ${String(header?.doc_no ?? "")}` : "New GDN"} status={<Badge tone="warning">Draft</Badge>}
        footer={
          <>
            {touched && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1 text-right text-sm">Sending <b className="tabular-nums">{qtyFmt(total)}</b> in {send.length} line{send.length === 1 ? "" : "s"}</div>
            <Button onClick={() => guard(onCancel)}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)}>Save draft</Button>
            {can(P.salesDispatch) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={() => submit(true)}>Save & dispatch</Button>}
          </>
        }
      >
        <FormGrid cols={4}>
          <Field label="Sales order" required error={err("so")} className="sm:col-span-2">
            <SearchableSelect value={soId} options={orders.data ?? []} invalid={!!err("so")} placeholder={orders.isLoading ? "Loading…" : "Approved sales order…"} emptyText="No approved orders waiting for dispatch"
              onChange={edit((v: string | null) => { setSoId(v); initFor.current = null; })} />
          </Field>
          <Field label="Dispatch date" required><Input type="date" value={date} onChange={(e) => { setTouched(true); setDate(e.target.value); }} /></Field>
          <Field label="Transport / vehicle / bilty"><Input value={transport} placeholder="e.g. LEA-1234, Daewoo bilty 5521" onChange={(e) => { setTouched(true); setTransport(e.target.value); }} /></Field>
        </FormGrid>
        {soId && (
          rows.isLoading ? <Skeleton className="h-32" /> : rows.error ? <p className="text-sm text-danger">{friendlyError(rows.error)}</p> : (
            <>
              <p className="mb-2 text-xs text-ink-muted">Enter what is physically leaving each warehouse now. Send less for a part delivery — the rest stays on the order. Rolls are cut automatically (best fit); bundles take their components.</p>
              {err("lines") && <p className="mb-2 text-xs text-danger">{err("lines")}</p>}
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">Item</th><th className="px-3">From</th><th className="px-3 text-right">Ordered</th><th className="px-3 text-right">Sent before</th>
                    <th className="px-3 text-right">Left</th><th className="w-[130px] px-3 text-right">Send now</th><th className="border-l border-line px-3 text-right font-normal normal-case text-ink-faint">In stock there</th>
                  </tr></thead>
                  <tbody>
                    {rows.data!.map((r) => {
                      const td = "border-b border-line/70 px-3 py-1.5 align-middle";
                      const v = qty[r.allocation_id] ?? "";
                      const short = r.on_hand != null && n(v) > r.on_hand;
                      return (
                        <tr key={r.allocation_id} className={cn(r.remaining <= 0 && "text-ink-faint")}>
                          <td className={td}>
                            <div className="font-medium">{r.product}{r.variant && <span className="font-normal text-ink-muted"> · {r.variant}</span>}</div>
                            <div className="text-2xs text-ink-muted">{r.sku}{r.is_bundle && " · bundle"}{r.rolls && " · rolls"}</div>
                          </td>
                          <td className={cn(td, "font-mono text-xs")}>{r.wh_code}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(r.ordered)}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(r.delivered)}</td>
                          <td className={cn(td, "text-right tabular-nums font-medium")}>{qtyFmt(r.remaining)} <span className="text-2xs font-normal text-ink-faint">{r.uom}</span></td>
                          <td className={cn(td, "text-right")}>
                            {r.remaining > 0 ? (
                              <>
                                <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0" aria-label={`Send now: ${r.product} from ${r.wh_code}`} value={v} invalid={!!err(r.allocation_id) || short}
                                  onChange={(e) => { setTouched(true); setQty((s) => ({ ...s, [r.allocation_id]: e.target.value })); }} />
                                {err(r.allocation_id) && <div className="text-2xs text-danger">{err(r.allocation_id)}</div>}
                              </>
                            ) : <span className="text-2xs">done</span>}
                          </td>
                          <td className={cn(td, "border-l border-line text-right text-xs tabular-nums text-ink-muted", short && "font-medium text-danger")}>{r.on_hand == null ? <span className="text-2xs text-ink-faint">components</span> : qtyFmt(r.on_hand)}</td>
                        </tr>
                      );
                    })}
                    {rows.data!.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-xs text-ink-muted">Nothing left to dispatch on this order.</td></tr>}
                  </tbody>
                </table>
              </div>
              {shortStock.length > 0 && <p className="mt-2 text-xs text-danger">Not enough stock in the warehouse for {shortStock.length} line{shortStock.length > 1 ? "s" : ""} — dispatch will be refused. Receive or transfer stock first, or send less.</p>}
            </>
          )
        )}
        <Field label="Notes" className="mt-3"><Textarea rows={2} value={notes} onChange={(e) => { setTouched(true); setNotes(e.target.value); }} /></Field>
      </ErpDialog>
      {dialog}
    </>
  );
}

function useDraftPreview(items: DraftItem[] | undefined, enabled: boolean, soId: string | null) {
  const ids = (items ?? []).map((d) => d.allocation_id);
  return useQuery({
    queryKey: ["gdn-draft-preview", ids.join()],
    enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await sb().from("sales_order_line_warehouse_allocations")
        .select("id, warehouse:warehouses(code, name), line:sales_order_lines(id, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name))").in("id", ids);
      if (error) throw error;
      const m = new Map((data ?? []).map((a) => [a.id as string, a as unknown as { warehouse: GdnLine["warehouse"]; line: { id: string; product: GdnLine["product"]; variant: GdnLine["variant"] } }]));
      const pr = soId ? await sb().rpc("so_line_prices", { p_so_ids: [soId] }) : { data: [] };
      const pm = new Map(((pr.data ?? []) as { line_id: string; unit_price: number | null }[]).map((x) => [x.line_id, x.unit_price]));
      return (items ?? []).map((d, i): GdnLine => {
        const a = m.get(d.allocation_id);
        return { id: d.allocation_id, line_no: i + 1, quantity: Number(d.quantity), invoiced_qty: 0, unit_price: a ? pm.get(a.line.id) ?? null : null,
          product: a?.line.product ?? { name: "…", sku: "", uom: null }, variant: a?.line.variant ?? null, warehouse: a?.warehouse ?? { code: "", name: "" } };
      });
    },
  });
}

function GdnView({ id, doc, onEdit, onClose }: { id: string; doc: ReturnType<typeof useGdn>; onEdit: () => void; onClose: () => void }) {
  const { can, company } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState("lines");
  const files = useAttachments("gdns", id);
  const [confirm, setConfirm] = React.useState<null | "post" | "cancel" | "reverse" | "correct" | "blocked">(null);
  const [reason, setReason] = React.useState("");
  const h = doc.data?.header;
  const invoices = useGdnInvoices((h?.customer_id as string | undefined) ?? null, doc.data?.lines.map((l) => l.id) ?? []);
  const status = String(h?.status ?? "");
  const draft = useDraftPreview(h?.lines_draft as DraftItem[] | undefined, status === "DRAFT", (h?.sales_order_id as string | undefined) ?? null);
  const lines = status === "DRAFT" ? draft.data ?? [] : doc.data?.lines ?? [];
  const act = useMutation({
    mutationFn: async (kind: "post" | "cancel" | "reverse" | "correct") => {
      const r = kind === "post" ? await sb().rpc("post_gdn", { p_id: id })
        : kind === "cancel" ? await sb().rpc("cancel_gdn", { p_id: id })
        : kind === "correct" ? await sb().rpc("correct_gdn", { p_id: id, p_reason: reason.trim() || "Corrected" })
        : await sb().rpc("reverse_gdn", { p_id: id, p_reason: reason.trim() });
      if (r.error) throw r.error;
      return r.data as unknown;
    },
    onSuccess: (data, kind) => {
      toast.success(kind === "post" ? "Dispatched — stock taken out of the warehouse" : kind === "cancel" ? "Draft GDN cancelled"
        : kind === "correct" ? "Original reversed — edit the new draft and dispatch it" : "GDN reversed — stock returned and re-reserved for the order");
      setConfirm(null); setReason(""); qc.invalidateQueries();
      if (kind === "correct") navigate(`/gdn?view=${data as string}&edit=1`);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const cust = h?.customer as { name: string; code: string; city: string | null } | null | undefined;
  const so = h?.so as { doc_no: string; customer_reference: string | null } | null | undefined;
  const left = leftToInvoice(doc.data?.lines ?? []);
  const invoicedAny = (doc.data?.lines ?? []).some((l) => Number(l.invoiced_qty) > 0);

  const print = () => {
    if (!h) return;
    const ok = printDocument({
      company: company?.company_name ?? "", title: "Delivery Note", docNo: String(h.doc_no),
      meta: [["Customer", `${cust?.name ?? ""}${cust?.city ? `, ${cust.city}` : ""}`], ["Date", formatDate(h.gdn_date as string)], ["Sales order", so?.doc_no ?? ""],
        ["Customer ref.", so?.customer_reference ?? ""], ["Transport", (h.transport_details as string) ?? ""]],
      columns: [{ label: "#" }, { label: "Item" }, { label: "From" }, { label: "Quantity", align: "right" }],
      rows: lines.map((l, i) => [String(i + 1), `${l.product.name}${l.variant ? ` · ${l.variant.name}` : ""}`, l.warehouse.code, `${qtyFmt(l.quantity)} ${l.product.uom?.code ?? ""}`]),
      notes: h.notes as string | null, signatures: ["Dispatched by", "Driver / transporter", "Received by (customer)"],
    });
    if (!ok) toast.error("Allow pop-ups to print");
  };

  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="dispatch" icon={icon}
        title={h ? String(h.doc_no) : "GDN"} subtitle={cust ? `${cust.name}${cust.city ? ` · ${cust.city}` : ""}` : undefined}
        status={h ? <Badge tone={GDN_TONE[status]}>{gdnLabel(status)}</Badge> : null}
        footer={
          <>
            {status === "DRAFT" && can(P.salesDispatch) && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm("cancel")}>Cancel draft</Button>}
            {status === "POSTED" && can(P.salesDispatch) && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setConfirm(invoicedAny ? "blocked" : "reverse")}>Reverse</Button>}
            <div className="flex-1" />
            {so && <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/sales-orders?view=${h!.sales_order_id}`)}>{so.doc_no}</Button>}
            {h && status !== "CANCELLED" && <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>}
            <Button onClick={onClose}>Close</Button>
            {status === "DRAFT" && can(P.salesDispatch) && <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
            {status === "POSTED" && can(P.salesDispatch) && <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setConfirm(invoicedAny ? "blocked" : "correct")}>Edit</Button>}
            {status === "DRAFT" && can(P.salesDispatch) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("post")}>Dispatch</Button>}
            {status === "POSTED" && can(P.salesReturn) && <Button icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => navigate(`/sales-returns?new=1&gdn=${id}`)}>Return goods</Button>}
            {status === "POSTED" && left > 0 && can(P.salesInvoice) && <Button variant="primary" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/invoices?new=1&gdn=${id}`)}>Create invoice</Button>}
          </>
        }
      >
        {doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : h && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <KeyValue label="Customer">{cust?.name ?? null}</KeyValue>
              <KeyValue label="Date">{formatDate(h.gdn_date as string)}</KeyValue>
              <KeyValue label="Sales order">{so?.doc_no ?? null}</KeyValue>
              <KeyValue label="Transport">{(h.transport_details as string) || null}</KeyValue>
              {h.posted_at ? <KeyValue label="Dispatched">{formatDateTime(h.posted_at as string)}</KeyValue> : <KeyValue label="Dispatched">{null}</KeyValue>}
              {h.reversal_reason ? <KeyValue label="Reversal reason" className="col-span-2">{String(h.reversal_reason)}</KeyValue> : null}
              {h.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-5">{String(h.notes)}</KeyValue> : null}
            </dl>
            {status === "POSTED" && <PricingStrip sourceType="GDN" sourceId={id} docNo={String(h.doc_no)} customerName={cust?.name} />}
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: "lines", label: `Items (${lines.length})` },
              ...(status !== "DRAFT" && status !== "CANCELLED" ? [{ key: "moves", label: "Stock movements" }] : []),
              { key: "files", label: filesLabel(files.data?.length) }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : []),
            ]} />
            {tab === "history" && <AuditTimeline table="gdns" id={id} />}
            {tab === "files" && <AttachmentsPanel entityType="gdns" entityId={id} />}
            {tab === "moves" && <MovementsTable sourceId={id} />}
            {tab === "lines" && (
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">#</th><th className="px-3">Item</th><th className="px-3">From</th><th className="px-3 text-right">Quantity</th>
                    {status === "POSTED" && <th className="px-3 text-right">Invoiced</th>}{status === "POSTED" && <th className="px-3 text-right">Returned</th>}{can(P.salesViewPrices) && <th className="px-3 text-right">Price</th>}
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const td = "border-b border-line/70 px-3 py-2 align-top";
                      return (
                        <tr key={l.id}>
                          <td className={cn(td, "w-8 text-ink-faint")}>{l.line_no}</td>
                          <td className={td}><div className="font-medium">{l.product.name}{l.variant && <span className="font-normal text-ink-muted"> · {l.variant.name}</span>}</div><div className="text-2xs text-ink-muted">{l.product.sku}</div></td>
                          <td className={cn(td, "font-mono text-xs")} title={l.warehouse.name}>{l.warehouse.code}</td>
                          <td className={cn(td, "text-right tabular-nums font-medium")}>{qtyFmt(l.quantity)} <span className="text-2xs font-normal text-ink-faint">{l.product.uom?.code}</span></td>
                          {status === "POSTED" && <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.invoiced_qty)}</td>}
                          {status === "POSTED" && <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{Number(l.returned_open_qty ?? 0) + Number(l.returned_credit_qty ?? 0) > 0 ? qtyFmt(Number(l.returned_open_qty ?? 0) + Number(l.returned_credit_qty ?? 0)) : ""}</td>}
                          {can(P.salesViewPrices) && <td className={cn(td, "text-right tabular-nums")}>{l.unit_price == null ? <Badge tone="warning">Pending</Badge> : money(l.unit_price)}</td>}
                        </tr>
                      );
                    })}
                    {lines.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-xs text-ink-muted">{draft.isLoading ? "Loading…" : "No items."}</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={confirm === "post"} title={`Dispatch ${h?.doc_no ?? ""}?`} message="Stock is taken out of each warehouse now and the order's reservation is used up. Rolls are cut automatically."
        confirmLabel="Dispatch" loading={act.isPending} onCancel={() => setConfirm(null)} onConfirm={() => act.mutate("post")} />
      <ConfirmDialog open={confirm === "cancel"} title={`Cancel ${h?.doc_no ?? ""}?`} message="The draft is kept for history; nothing has left the warehouse." tone="destructive"
        confirmLabel="Cancel draft" cancelLabel="Keep" loading={act.isPending} onCancel={() => setConfirm(null)} onConfirm={() => act.mutate("cancel")} />
      <ConfirmDialog open={confirm === "correct"} title={`Edit ${h?.doc_no ?? ""}?`}
        message="A dispatched GDN cannot be changed in place. It will be reversed (stock goes back and is held for the order) and a new draft copy opens for you to correct and dispatch again."
        confirmLabel="Reverse & edit copy" cancelLabel="Keep" loading={act.isPending}
        onCancel={() => { setConfirm(null); setReason(""); }} onConfirm={() => act.mutate("correct")}>
        <Field label="What is being corrected?" className="mt-3"><Textarea rows={2} value={reason} placeholder="e.g. wrong quantity / wrong warehouse" onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <ErpDialog open={confirm === "blocked"} onRequestClose={() => setConfirm(null)} size="sm" icon={<FileText className="h-4 w-4" />} title="This GDN is already invoiced"
        footer={<><div className="flex-1" /><Button onClick={() => setConfirm(null)}>Close</Button></>}>
        <p className="text-sm">To change or reverse it, first reverse (or edit) the invoice — that frees the GDN again.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(invoices.data ?? []).map((i) => (
            <Button key={i.id} size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/invoices?view=${i.id}`)}>{i.doc_no}</Button>
          ))}
        </div>
      </ErpDialog>
      <ConfirmDialog open={confirm === "reverse"} title={`Reverse ${h?.doc_no ?? ""}?`} tone="destructive"
        message="Use this when goods came back or the GDN was wrong. Stock returns to the same warehouse (and the same rolls) and is reserved for the order again."
        confirmLabel="Reverse" cancelLabel="Keep" loading={act.isPending}
        onCancel={() => { setConfirm(null); setReason(""); }} onConfirm={() => (reason.trim() ? act.mutate("reverse") : toast.error("Enter a reason"))}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}

/** Posted invoices that bill any line of this GDN (sources link invoice lines to GDN lines). */
function useGdnInvoices(customerId: string | null, gdnLineIds: string[]) {
  return useQuery({
    queryKey: ["gdn-invoices", customerId, gdnLineIds.join()],
    enabled: !!customerId && gdnLineIds.length > 0,
    queryFn: async () => {
      const { data, error } = await sb().from("sales_invoices").select("id, doc_no, lines:sales_invoice_lines(sources)")
        .eq("customer_id", customerId!).eq("status", "POSTED").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      const set = new Set(gdnLineIds);
      return ((data ?? []) as unknown as { id: string; doc_no: string; lines: { sources: { gdn_line_id: string }[] }[] }[])
        .filter((i) => i.lines.some((l) => (l.sources ?? []).some((x) => set.has(x.gdn_line_id))))
        .map((i) => ({ id: i.id, doc_no: i.doc_no }));
    },
  });
}
