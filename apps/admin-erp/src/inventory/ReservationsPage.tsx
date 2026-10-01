import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightCircle, Bookmark, ExternalLink, Plus, ShieldAlert, Trash2, Unlock } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue,
  PageHeader, SectionTitle, Skeleton, Textarea, cn,
} from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatNumber, humanize } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "./DocPage";
import { STATUS_TONE } from "./docConfigs";
import { Availability, CustomerPicker, ProductPicker, VariantPicker, WarehousePicker, useProductMeta } from "./pickers";

type Row = Record<string, unknown> & { id: string };
const FILTERS = [
  { label: "Active", status: "ACTIVE" },
  { label: "Converted", status: "CONVERTED" },
  { label: "Released", status: "RELEASED" },
  { label: "All", status: undefined },
];
const icon = <Bookmark className="h-4 w-4" />;
const today = () => new Date().toISOString().slice(0, 10);
const isExpired = (r: Row) => r.status === "ACTIVE" && !!r.expires_on && String(r.expires_on) < today();
const qty = (v: unknown) => formatNumber(Number(v), Number.isInteger(Number(v)) ? 0 : 2);

export function ReservationsPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const creating = params.get("new") === "1";
  const viewId = params.get("view");

  const list = useEntityList<Row>({
    table: "reservation_orders",
    select:
      "id, doc_no, reserved_on, expires_on, status, customer_reference, customer:customers(name), lines:reservations(count), so:sales_orders!reservation_orders_so_fk(doc_no)",
    companyId,
    search: q,
    searchColumns: ["doc_no", "customer_reference", "notes"],
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false },
    page,
    pageSize: 25,
    enabled: can(P.inventoryView) || can(P.salesView),
  });

  if (!can(P.inventoryView) && !can(P.salesView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Reserved Orders"
        icon={icon}
        description="Hold stock for a customer's order, then convert it into a sales order in one click — the stock stays held throughout."
        actions={can(P.inventoryReserve) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1" })}>New Reserved Order</Button>}
      />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search order no. / customer ref…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable
            loading={list.isLoading}
            rows={list.data?.rows ?? []}
            onView={(r) => update({ view: r.id })}
            page={page}
            pageSize={25}
            total={list.data?.total ?? null}
            onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "Order", width: "150px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "c", header: "Customer", cell: (r) => (r.customer as { name: string } | null)?.name ?? <span className="text-ink-faint">No customer (stock hold)</span> },
              { key: "ref", header: "Customer ref.", hideBelow: "lg", cell: (r) => (r.customer_reference as string) || "" },
              { key: "d", header: "Reserved", width: "110px", hideBelow: "sm", cell: (r) => formatDate(r.reserved_on as string) },
              { key: "e", header: "Expires", width: "110px", hideBelow: "md", cell: (r) => r.expires_on ? <span className={isExpired(r) ? "font-medium text-warning" : ""}>{formatDate(r.expires_on as string)}</span> : <span className="text-ink-faint">—</span> },
              { key: "l", header: "Lines", align: "right", width: "60px", cell: (r) => (r.lines as { count: number }[])?.[0]?.count ?? 0 },
              { key: "so", header: "Sales order", hideBelow: "md", cell: (r) => (r.so as { doc_no: string } | null)?.doc_no ? <span className="font-mono text-xs">{(r.so as { doc_no: string }).doc_no}</span> : "" },
              { key: "s", header: "Status", width: "110px", cell: (r) => isExpired(r) ? <Badge tone="warning">Expired</Badge> : <Badge tone={r.status === "CONVERTED" ? "success" : STATUS_TONE[String(r.status)]}>{humanize(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No reserved orders" description="Reserve stock for a customer's order before it is confirmed." />}
          />
        )}
      </Card>
      {creating && <ReservedOrderForm onClose={() => update({ new: null })} onSaved={(id) => update({ new: null, view: id })} />}
      {viewId && <ReservedOrderDialog id={viewId} onClose={() => update({ view: null })} />}
    </div>
  );
}

/* ================================================================= form (create or add items) */
interface ResLine { key: string; warehouse_id: string | null; product_id: string | null; variant_id: string | null; quantity: string }
const newLine = (wh: string | null = null): ResLine => ({ key: crypto.randomUUID(), warehouse_id: wh, product_id: null, variant_id: null, quantity: "" });

function ReservedOrderForm({ existing, onClose, onSaved }: { existing?: Row; onClose: () => void; onSaved: (id: string) => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const idem = React.useRef(crypto.randomUUID());
  const [h, setH] = React.useState<{ customer_id: string | null; expires_on: string; customer_reference: string; notes: string }>({
    customer_id: (existing?.customer_id as string) ?? null,
    expires_on: (existing?.expires_on as string) ?? "",
    customer_reference: (existing?.customer_reference as string) ?? "",
    notes: (existing?.notes as string) ?? "",
  });
  const [lines, setLines] = React.useState<ResLine[]>([newLine()]);
  const [showErr, setShowErr] = React.useState(false);
  const initial = React.useRef(JSON.stringify({ h, lines: [] }));
  const used = lines.filter((l) => l.product_id || l.quantity || l.warehouse_id);
  const dirty = JSON.stringify({ h, lines: used }) !== initial.current;
  const { guard, dialog } = useUnsavedGuard(dirty);

  const errs: Record<string, string> = {};
  if (!existing && used.length === 0) errs.lines = "Add at least one item";
  for (const l of used) {
    if (!l.warehouse_id) errs[`${l.key}.w`] = "Warehouse";
    if (!l.product_id) errs[`${l.key}.p`] = "Product";
    if (!(Number(l.quantity) > 0)) errs[`${l.key}.q`] = "Qty > 0";
  }

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("save_reservation_order", {
        p_id: existing?.id ?? null,
        p_header: { company_id: companyId, ...h },
        p_lines: used.map((l) => ({ warehouse_id: l.warehouse_id, product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })),
        p_idempotency_key: existing ? null : idem.current,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      initial.current = JSON.stringify({ h, lines: used });
      toast.success(existing ? "Reserved order updated" : "Stock reserved");
      qc.invalidateQueries();
      onSaved(id);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const submit = () => {
    setShowErr(true);
    if (Object.keys(errs).length) return toast.error("Please complete the highlighted items");
    if (!save.isPending) save.mutate();
  };

  return (
    <>
      <ErpDialog
        open
        onRequestClose={() => guard(onClose)}
        title={existing ? `Edit ${existing.doc_no}` : "New Reserved Order"}
        icon={icon}
        size="xl"
        footer={<>{dirty && <span className="text-xs text-warning">Unsaved changes</span>}<div className="flex-1" /><Button onClick={() => guard(onClose)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{existing ? "Save" : "Reserve stock"}</Button></>}
      >
        <FormGrid cols={4}>
          <Field label="Customer" hint="Leave empty for a plain stock hold" className="sm:col-span-2"><CustomerPicker value={h.customer_id} onChange={(v) => setH({ ...h, customer_id: v })} /></Field>
          <Field label="Hold until (expiry)"><Input type="date" min={today()} value={h.expires_on} onChange={(e) => setH({ ...h, expires_on: e.target.value })} /></Field>
          <Field label="Customer ref. / PO (optional)" hint="Customer's PO number or a short note — prints on SO, GDN and invoice"><Input value={h.customer_reference} onChange={(e) => setH({ ...h, customer_reference: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-4"><Textarea rows={1} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        </FormGrid>
        <SectionTitle action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((ls) => [...ls, newLine(ls[ls.length - 1]?.warehouse_id ?? null)])}>Add item</Button>}>
          {existing ? "Add items" : "Items to reserve"}
        </SectionTitle>
        <p className="mb-2 text-xs text-ink-muted">Reserve the same item from several warehouses by adding one line per warehouse.</p>
        {showErr && errs.lines && <p className="mb-2 text-xs text-danger">{errs.lines}</p>}
        <div className="space-y-2">
          {lines.map((l, i) => (
            <ResLineRow key={l.key} idx={i} line={l} errs={showErr ? errs : {}}
              onChange={(p) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...p } : x)))}
              onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((x) => x.key !== l.key)) : undefined} />
          ))}
        </div>
      </ErpDialog>
      {dialog}
    </>
  );
}

function ResLineRow({ idx, line, errs, onChange, onRemove }: { idx: number; line: ResLine; errs: Record<string, string>; onChange: (p: Partial<ResLine>) => void; onRemove?: () => void }) {
  const meta = useProductMeta(line.product_id);
  return (
    <div className="grid grid-cols-12 items-start gap-2 rounded-control border border-line p-2">
      <div className="col-span-12 flex items-center gap-2 md:col-span-3">
        <span className="w-5 shrink-0 text-center text-2xs text-ink-faint">{idx + 1}</span>
        <div className="min-w-0 flex-1"><WarehousePicker value={line.warehouse_id} onChange={(v) => onChange({ warehouse_id: v })} invalid={!!errs[`${line.key}.w`]} /></div>
      </div>
      <div className="col-span-12 md:col-span-4"><ProductPicker warehouseId={line.warehouse_id} value={line.product_id} onChange={(v) => onChange({ product_id: v, variant_id: null })} invalid={!!errs[`${line.key}.p`]} /></div>
      <div className="col-span-6 md:col-span-2"><VariantPicker productId={line.product_id} warehouseId={line.warehouse_id} value={line.variant_id} onChange={(v) => onChange({ variant_id: v })} /></div>
      <div className="col-span-5 md:col-span-2">
        <div className="flex items-center gap-1.5">
          <Input inputMode="decimal" className="text-right" placeholder="Qty" value={line.quantity} invalid={!!errs[`${line.key}.q`]} onChange={(e) => onChange({ quantity: e.target.value })} />
          <span className="w-8 text-2xs text-ink-faint">{meta.data?.uom}</span>
        </div>
        <Availability warehouseId={line.warehouse_id} productId={line.product_id} variantId={line.variant_id} />
      </div>
      <div className="col-span-1 flex justify-end">{onRemove && <Button size="icon-sm" variant="ghost" aria-label="Remove line" onClick={onRemove}><Trash2 className="h-3.5 w-3.5 text-ink-faint" /></Button>}</div>
    </div>
  );
}

/* ================================================================= view */
interface ResRow {
  id: string; doc_no: string; quantity: number; status: string; release_reason: string | null;
  warehouse: { code: string; name: string }; product: { name: string; sku: string; uom: { code: string } }; variant: { name: string } | null;
}

function ReservedOrderDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState("lines");
  const [confirm, setConfirm] = React.useState<null | "convert" | "releaseAll" | { line: ResRow }>(null);
  const [reason, setReason] = React.useState("");
  const [convCustomer, setConvCustomer] = React.useState<string | null>(null);
  const [convRef, setConvRef] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const doc = useQuery({
    queryKey: ["record", "reservation_orders", id],
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from("reservation_orders").select("id, company_id, doc_no, customer_id, reserved_on, expires_on, customer_reference, status, notes, converted_sales_order_id, converted_at, released_at, release_reason, created_at, customer:customers(name, code), so:sales_orders!reservation_orders_so_fk(doc_no, status)").eq("id", id).single(),
        sb().from("reservations").select("id, doc_no, quantity, status, release_reason, warehouse:warehouses(code, name), product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)").eq("reservation_order_id", id).order("doc_no"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      return { header: h.data as unknown as Row, lines: l.data as unknown as ResRow[] };
    },
  });

  const act = useMutation({
    mutationFn: async (kind: "convert" | "releaseAll" | "releaseLine") => {
      if (kind === "convert") {
        const { data, error } = await sb().rpc("convert_reservation_to_sales_order", { p_order_id: id, p_customer_id: convCustomer, p_customer_reference: convRef || null, p_notes: null });
        if (error) throw error;
        return data as string;
      }
      const r = kind === "releaseAll"
        ? await sb().rpc("release_reservation_order", { p_id: id, p_reason: reason || null })
        : await sb().rpc("release_reservation", { p_id: (confirm as { line: ResRow }).line.id, p_reason: reason || null });
      if (r.error) throw r.error;
      return null;
    },
    onSuccess: (soId, kind) => {
      qc.invalidateQueries();
      setConfirm(null);
      setReason("");
      if (kind === "convert" && soId) {
        toast.success("Sales order created — reserved stock transferred to it");
        navigate(`/sales-orders?view=${soId}`);
      } else toast.success(kind === "releaseAll" ? "All reserved stock released" : "Line released");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const h = doc.data?.header;
  const lines = doc.data?.lines ?? [];
  const active = h?.status === "ACTIVE";
  const activeLines = lines.filter((l) => l.status === "ACTIVE");
  const cust = h?.customer as { name: string; code: string } | null;
  const so = h?.so as { doc_no: string; status: string } | null;

  if (adding && h) return <ReservedOrderForm existing={h} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />;

  return (
    <>
      <ErpDialog
        open
        onRequestClose={onClose}
        size="xl"
        icon={icon}
        title={h ? String(h.doc_no) : "Reserved Order"}
        subtitle={cust ? `${cust.name} · ${cust.code}` : h ? "Stock hold (no customer)" : undefined}
        status={h ? (isExpired(h) ? <Badge tone="warning">Expired</Badge> : <Badge tone={h.status === "CONVERTED" ? "success" : STATUS_TONE[String(h.status)]}>{humanize(String(h.status))}</Badge>) : null}
        footer={
          <>
            {active && can(P.inventoryReserve) && <Button variant="destructive-ghost" icon={<Unlock className="h-3.5 w-3.5" />} onClick={() => setConfirm("releaseAll")}>Release all</Button>}
            <div className="flex-1" />
            <Button onClick={onClose}>Close</Button>
            {active && can(P.inventoryReserve) && <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Edit / add items</Button>}
            {active && can(P.salesManage) && activeLines.length > 0 && (
              <Button variant="primary" icon={<ArrowRightCircle className="h-3.5 w-3.5" />} onClick={() => { setConvRef(String(h?.customer_reference ?? "")); setConfirm("convert"); }}>Convert to Sales Order</Button>
            )}
            {so && <Button variant="primary" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/sales-orders?view=${h!.converted_sales_order_id}`)}>Open {so.doc_no}</Button>}
          </>
        }
      >
        {doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : h && (
          <>
            {isExpired(h) && <div className="mb-3 rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning">This hold expired on {formatDate(h.expires_on as string)}. The stock is still reserved until you convert or release it.</div>}
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <KeyValue label="Customer">{cust?.name ?? null}</KeyValue>
              <KeyValue label="Reserved on">{formatDate(h.reserved_on as string)}</KeyValue>
              <KeyValue label="Hold until">{h.expires_on ? formatDate(h.expires_on as string) : null}</KeyValue>
              <KeyValue label="Customer ref.">{(h.customer_reference as string) || null}</KeyValue>
              {so ? <KeyValue label="Sales order"><span className="font-mono text-xs">{so.doc_no}</span> <Badge tone={STATUS_TONE[so.status] ?? "neutral"}>{humanize(so.status)}</Badge></KeyValue> : <KeyValue label="Active lines">{activeLines.length}</KeyValue>}
              {h.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-5">{String(h.notes)}</KeyValue> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.length})` }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : [])]} />
            {tab === "history" ? <AuditTimeline table="reservation_orders" id={id} /> : (
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">Line</th><th className="px-3">Warehouse</th><th className="px-3">Item</th><th className="px-3 text-right">Qty</th><th className="px-3">Status</th><th className="w-24" />
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const td = "h-row border-b border-line/70 px-3";
                      return (
                        <tr key={l.id} className={cn(l.status === "RELEASED" && "text-ink-faint")}>
                          <td className={cn(td, "font-mono text-xs")}>{l.doc_no.split("-").pop()}</td>
                          <td className={td}><span className="font-mono text-xs">{l.warehouse.code}</span> {l.warehouse.name}</td>
                          <td className={td}>{l.product.name}{l.variant ? <span className="text-ink-muted"> · {l.variant.name}</span> : null}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{qty(l.quantity)} <span className="text-2xs text-ink-faint">{l.product.uom?.code}</span></td>
                          <td className={td}>
                            <Badge tone={l.status === "ACTIVE" ? "info" : l.status === "CONSUMED" ? "success" : "neutral"}>{l.status === "ACTIVE" && h.status === "CONVERTED" ? "Held by SO" : humanize(l.status)}</Badge>
                            {l.release_reason && <span className="ml-2 text-2xs">{l.release_reason}</span>}
                          </td>
                          <td className={cn(td, "text-right")}>
                            {active && l.status === "ACTIVE" && can(P.inventoryReserve) && (
                              <Button size="sm" variant="ghost" onClick={() => setConfirm({ line: l })}>Release</Button>
                            )}
                          </td>
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

      <ConfirmDialog
        open={confirm === "convert"}
        title={`Convert ${h?.doc_no ?? ""} to a sales order?`}
        message={<>A sales order is created from the <b>{activeLines.length} active line(s)</b>, grouped per product with the same warehouse split. The reserved stock moves to the sales order without being released. The SO starts as a draft awaiting approval.</>}
        confirmLabel="Create sales order"
        loading={act.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => (!cust && !convCustomer ? toast.error("Choose the customer") : act.mutate("convert"))}
      >
        <div className="mt-3 space-y-2">
          {!cust && <Field label="Customer" required><CustomerPicker value={convCustomer} onChange={setConvCustomer} /></Field>}
          <Field label="Customer ref. / PO (optional)" hint="Customer's PO number or a short note — prints on SO, GDN and invoice"><Input value={convRef} onChange={(e) => setConvRef(e.target.value)} /></Field>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "releaseAll" || (typeof confirm === "object" && confirm !== null)}
        title={confirm === "releaseAll" ? `Release all of ${h?.doc_no ?? ""}?` : "Release this line?"}
        message={confirm === "releaseAll" ? "All held stock on this order becomes available again. The order is kept for history." : "This quantity becomes available again."}
        tone="destructive"
        confirmLabel="Release"
        loading={act.isPending}
        onCancel={() => { setConfirm(null); setReason(""); }}
        onConfirm={() => act.mutate(confirm === "releaseAll" ? "releaseAll" : "releaseLine")}
      >
        <Field label="Reason (optional)" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer changed mind" /></Field>
      </ConfirmDialog>
    </>
  );
}
