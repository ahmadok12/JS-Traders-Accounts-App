import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, ClipboardList, Lock, PackagePlus, Plus, Printer, Save, ShieldAlert, Trash2, Unlock } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { LookupPicker, ProductPicker, VariantPicker, WarehousePicker } from "../inventory/pickers";
import { money, num, today } from "../accounting/common";
import { qtyFmt } from "../sales/common";
import { printDocument } from "../sales/print";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { CurrencyInput, PO_TONE, poLabel, rpc, useAction, useCan, useItemInfo } from "./common";

type Row = Record<string, unknown> & { id: string };
const FILTERS = [
  { label: "Open", statuses: ["DRAFT", "APPROVED", "PARTIALLY_RECEIVED"] },
  { label: "To receive", statuses: ["APPROVED", "PARTIALLY_RECEIVED"] },
  { label: "Received", statuses: ["RECEIVED"] },
  { label: "All" },
] as { label: string; statuses?: string[] }[];
const icon = <ClipboardList className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5";

export function PurchaseOrdersPage() {
  const { companyId } = useAccess();
  const c = useCan();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("view");
  const creating = params.get("new") === "1";
  const list = useEntityList<Row>({
    table: "purchase_orders", select: "id, doc_no, order_date, expected_date, status, currency, supplier_reference, supplier:suppliers(name), lines:purchase_order_lines(quantity, received_qty, is_active)",
    companyId, search: q, searchColumns: ["doc_no", "supplier_reference"], orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: c.view,
  });
  if (!c.view) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) => !FILTERS[f].statuses || FILTERS[f].statuses!.includes(String(r.status)));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Purchase Orders" icon={icon}
        description="What you ordered from suppliers. Approve it, receive the goods (in parts if they arrive in parts), then cost and bill them."
        actions={c.manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New purchase order</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search PO / supplier ref…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "d", header: "PO", width: "130px", cell: (r) => <span className="font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "dt", header: "Date", width: "100px", cell: (r) => formatDate(r.order_date as string) },
              { key: "s", header: "Supplier", cell: (r) => (r.supplier as { name: string } | null)?.name },
              { key: "r", header: "Received", width: "130px", hideBelow: "md", cell: (r) => {
                const ls = ((r.lines as { quantity: number; received_qty: number; is_active: boolean }[]) ?? []).filter((l) => l.is_active);
                const all = ls.reduce((s, l) => s + Number(l.quantity), 0), got = ls.reduce((s, l) => s + Math.min(Number(l.received_qty), Number(l.quantity)), 0);
                return <div className="flex items-center gap-2"><div className="h-1.5 w-16 rounded-full bg-field"><div className="h-full rounded-full bg-success" style={{ width: `${all ? (got / all) * 100 : 0}%` }} /></div><span className="text-xs tabular-nums">{qtyFmt(got)}/{qtyFmt(all)}</span></div>;
              } },
              { key: "e", header: "Expected", width: "100px", hideBelow: "lg", cell: (r) => (r.expected_date ? formatDate(r.expected_date as string) : null) },
              { key: "c", header: "Cur.", width: "60px", hideBelow: "lg", cell: (r) => String(r.currency) },
              { key: "st", header: "Status", width: "170px", cell: (r) => <Badge tone={PO_TONE[String(r.status)]}>{poLabel(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No purchase orders" description="Create one to order goods from a supplier." />} />
        )}
      </Card>
      {(creating || view) && <PoDialog id={view} onClose={() => update({ view: null, new: null })} onSaved={(id) => update({ view: id, new: null })} />}
    </div>
  );
}

interface PoLine { id?: string; product_id: string | null; variant_id: string | null; quantity: string; unit_price: string; received_qty: number; notes: string }
interface PoHead { supplier_id: string | null; order_date: string; expected_date: string; warehouse_id: string | null; currency: string; fx_rate: string; supplier_reference: string; notes: string }

function usePo(id: string | null) {
  const c = useCan();
  return useQuery({
    queryKey: ["record", "purchase_orders", id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l, p, g] = await Promise.all([
        sb().from("purchase_orders").select("*, supplier:suppliers(name, code, city)").eq("id", id!).single(),
        sb().from("purchase_order_lines").select("id, line_no, product_id, variant_id, quantity, received_qty, notes").eq("purchase_order_id", id!).eq("is_active", true).order("line_no"),
        c.costs ? sb().rpc("po_line_prices", { p_po_id: id }) : Promise.resolve({ data: [] }),
        sb().from("goods_receipts").select("id, doc_no, doc_date, status, cost_status, warehouse:warehouses(code)").eq("purchase_order_id", id!).order("doc_date"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      const prices = new Map(((p.data ?? []) as { line_id: string; unit_price: number | null }[]).map((x) => [x.line_id, x.unit_price]));
      return { h: h.data as Row, lines: (l.data ?? []).map((x) => ({ ...x, unit_price: prices.get(x.id as string) ?? null })) as (Row & { quantity: number; received_qty: number; unit_price: number | null })[], receipts: (g.data ?? []) as Row[] };
    },
  });
}

function PoDialog({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { companyId, company } = useAccess();
  const c = useCan();
  const navigate = useNavigate();
  const po = usePo(id);
  const files = useAttachments("purchase_orders", id);
  const h = po.data?.h;
  const st = String(h?.status ?? "DRAFT");
  const editable = c.manage && (!id || st === "DRAFT");
  const [head, setHead] = React.useState<PoHead>({ supplier_id: null, order_date: today(), expected_date: "", warehouse_id: null, currency: "PKR", fx_rate: "1", supplier_reference: "", notes: "" });
  const [lines, setLines] = React.useState<PoLine[]>([{ product_id: null, variant_id: null, quantity: "", unit_price: "", received_qty: 0, notes: "" }]);
  const [tab, setTab] = React.useState("lines");
  const [ask, setAsk] = React.useState<null | "cancel" | "close" | "receive">(null);
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (!po.data) return;
    const x = po.data.h;
    setHead({ supplier_id: x.supplier_id as string, order_date: x.order_date as string, expected_date: (x.expected_date as string) ?? "", warehouse_id: (x.warehouse_id as string) ?? null,
      currency: x.currency as string, fx_rate: String(x.fx_rate), supplier_reference: (x.supplier_reference as string) ?? "", notes: (x.notes as string) ?? "" });
    setLines(po.data.lines.map((l) => ({ id: l.id, product_id: l.product_id as string, variant_id: (l.variant_id as string) ?? null, quantity: String(Number(l.quantity)),
      unit_price: l.unit_price == null ? "" : String(Number(l.unit_price)), received_qty: Number(l.received_qty), notes: (l.notes as string) ?? "" })));
  }, [po.data]);
  const info = useItemInfo(lines.map((l) => l.product_id), lines.map((l) => l.variant_id));
  const total = lines.reduce((s, l) => s + (num(l.quantity) || 0) * (num(l.unit_price) || 0), 0);
  const missing = lines.filter((l) => l.product_id && !l.unit_price.trim()).length;

  const save = useAction(async (andApprove: boolean) => {
    const nid = await rpc<string>("save_purchase_order", { p_id: id, p_header: { company_id: companyId, ...head, fx_rate: num(head.fx_rate) || 1 },
      p_lines: lines.filter((l) => l.product_id).map((l) => ({ id: l.id ?? null, product_id: l.product_id, variant_id: l.variant_id, quantity: num(l.quantity), unit_price: l.unit_price.trim() ? num(l.unit_price) : null, notes: l.notes })) });
    if (andApprove) await rpc("set_purchase_order_status", { p_id: nid, p_action: "APPROVE" });
    return nid;
  }, (a) => (a ? "Saved and approved" : "Saved"));
  const status = useAction((a: string) => rpc("set_purchase_order_status", { p_id: id, p_action: a, p_reason: reason || null }), (a) => ({ APPROVE: "Approved", CANCEL: "Cancelled", CLOSE: "Closed — nothing more to receive", REOPEN: "Reopened" })[a] ?? "Done", () => { setAsk(null); setReason(""); });

  const setLine = (i: number, p: Partial<PoLine>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const print = () => {
    if (!h) return;
    printDocument({
      company: company?.company_name ?? "", title: "Purchase Order", docNo: String(h.doc_no),
      meta: [["Supplier", (h.supplier as { name: string }).name], ["Date", formatDate(h.order_date as string)], ["Expected", h.expected_date ? formatDate(h.expected_date as string) : ""],
        ["Currency", String(h.currency)], ["Supplier ref.", String(h.supplier_reference ?? "")]],
      columns: c.costs ? [{ label: "#" }, { label: "Item" }, { label: "Qty", align: "right" }, { label: "Price", align: "right" }, { label: "Amount", align: "right" }] : [{ label: "#" }, { label: "Item" }, { label: "Qty", align: "right" }],
      rows: lines.map((l, i) => {
        const it = info.data?.products.get(l.product_id ?? "");
        const name = `${it?.name ?? ""}${l.variant_id ? ` · ${info.data?.variants.get(l.variant_id) ?? ""}` : ""}`;
        return c.costs ? [String(i + 1), name, `${l.quantity} ${it?.uom ?? ""}`, money(num(l.unit_price)), money(num(l.quantity) * num(l.unit_price))] : [String(i + 1), name, `${l.quantity} ${it?.uom ?? ""}`];
      }),
      totals: c.costs ? [["Total " + String(h.currency), money(total)]] : [], notes: h.notes as string | null, signatures: ["Prepared by", "Approved by"],
    });
  };
  const doSave = (approve: boolean) => save.mutate(approve, { onSuccess: (nid) => onSaved(nid as string) });

  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="purchase" icon={icon} title={h ? String(h.doc_no) : "New purchase order"}
        subtitle={(h?.supplier as { name: string } | undefined)?.name} status={h ? <Badge tone={PO_TONE[st]}>{poLabel(st)}</Badge> : null}
        footer={<>
          {id && ["DRAFT", "APPROVED"].includes(st) && c.manage && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel order</Button>}
          {id && ["APPROVED", "PARTIALLY_RECEIVED"].includes(st) && c.manage && <Button variant="ghost" icon={<Lock className="h-3.5 w-3.5" />} onClick={() => setAsk("close")}>Close (no more coming)</Button>}
          {id && st === "CLOSED" && c.manage && <Button variant="ghost" icon={<Unlock className="h-3.5 w-3.5" />} onClick={() => status.mutate("REOPEN")}>Reopen</Button>}
          <div className="flex-1" />
          {id && <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>}
          <Button onClick={onClose}>Close</Button>
          {editable && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => doSave(false)}>Save draft</Button>}
          {editable && c.approve && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => doSave(true)}>Save & approve</Button>}
          {id && ["APPROVED", "PARTIALLY_RECEIVED"].includes(st) && c.receive && <Button variant="primary" icon={<PackagePlus className="h-3.5 w-3.5" />} onClick={() => setAsk("receive")}>Receive goods</Button>}
        </>}>
        {id && po.isLoading ? <Skeleton className="h-40" /> : po.error ? <p className="text-sm text-danger">{friendlyError(po.error)}</p> : (
          <>
            <FormGrid cols={4} className="mb-3">
              <Field label="Supplier" required className="sm:col-span-2">
                <LookupPicker value={head.supplier_id} onChange={(v) => setHead((s) => ({ ...s, supplier_id: v }))} disabled={!editable} clearable={false} placeholder="Supplier…"
                  spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} />
              </Field>
              <Field label="Order date"><Input type="date" disabled={!editable} value={head.order_date} onChange={(e) => setHead((s) => ({ ...s, order_date: e.target.value }))} /></Field>
              <Field label="Expected"><Input type="date" disabled={!editable} value={head.expected_date} onChange={(e) => setHead((s) => ({ ...s, expected_date: e.target.value }))} /></Field>
              <Field label="Deliver to"><WarehousePicker value={head.warehouse_id} onChange={(v) => setHead((s) => ({ ...s, warehouse_id: v }))} disabled={!editable} /></Field>
              {c.costs && <Field label="Currency"><CurrencyInput currency={head.currency} rate={head.fx_rate} disabled={!editable} onCurrency={(v) => setHead((s) => ({ ...s, currency: v }))} onRate={(v) => setHead((s) => ({ ...s, fx_rate: v }))} /></Field>}
              <Field label="Supplier's ref. / PI no."><Input disabled={!editable} value={head.supplier_reference} onChange={(e) => setHead((s) => ({ ...s, supplier_reference: e.target.value }))} /></Field>
              {c.costs && <Field label="Order value"><div className="flex h-control items-center font-semibold tabular-nums">{head.currency} {money(total)}{head.currency !== "PKR" && <span className="ml-2 text-xs font-normal text-ink-muted">≈ PKR {money(total * (num(head.fx_rate) || 0))}</span>}</div></Field>}
            </FormGrid>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.filter((l) => l.product_id).length})` },
              ...(id ? [{ key: "receipts", label: `Receipts (${po.data?.receipts.length ?? 0})` }, { key: "files", label: filesLabel(files.data?.length) }, { key: "history", label: "History" }] : [])]} />
            {tab === "lines" && (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-subtle"><tr><th className={cn(th, "w-8")}>#</th><th className={th}>Item</th><th className={cn(th, "w-48")}>Variant</th><th className={cn(th, "w-28 text-right")}>Qty</th>
                    {c.costs && <th className={cn(th, "w-32 text-right")}>Price ({head.currency})</th>}{c.costs && <th className={cn(th, "w-32 text-right")}>Amount</th>}
                    {id && st !== "DRAFT" && <th className={cn(th, "w-28 text-right")}>Received</th>}<th className={cn(th, "w-10")} /></tr></thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const it = info.data?.products.get(l.product_id ?? "");
                      return (
                        <tr key={l.id ?? `n${i}`} className="align-top">
                          <td className={cn(td, "pt-3 text-ink-muted")}>{i + 1}</td>
                          <td className={td}>{editable ? <ProductPicker value={l.product_id} onChange={(v) => setLine(i, { product_id: v, variant_id: null })} showStock={false} />
                            : <div className="pt-1"><div className="font-medium">{it?.name}</div><div className="text-2xs text-ink-muted">{it?.sku}</div></div>}</td>
                          <td className={td}>{editable ? <VariantPicker productId={l.product_id} value={l.variant_id} onChange={(v) => setLine(i, { variant_id: v })} showStock={false} />
                            : <div className="pt-1 text-ink-2">{l.variant_id ? info.data?.variants.get(l.variant_id) : ""}</div>}</td>
                          <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                          {c.costs && <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} placeholder="later" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>}
                          {c.costs && <td className={cn(td, "pt-3 text-right tabular-nums")}>{l.unit_price.trim() ? money((num(l.quantity) || 0) * num(l.unit_price)) : <span className="text-xs text-warning">price later</span>}</td>}
                          {id && st !== "DRAFT" && <td className={cn(td, "pt-3 text-right tabular-nums", l.received_qty >= num(l.quantity) ? "text-success" : l.received_qty > 0 && "text-warning")}>{qtyFmt(l.received_qty)} <span className="text-2xs text-ink-muted">{it?.uom}</span></td>}
                          <td className={td}>{editable && lines.length > 1 && <Button size="icon-sm" variant="destructive-ghost" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {editable && <div className="border-t border-line px-2 py-2"><Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((s) => [...s, { product_id: null, variant_id: null, quantity: "", unit_price: "", received_qty: 0, notes: "" }])}>Add item</Button>
                  {c.costs && missing > 0 && <span className="ml-3 text-xs text-ink-muted">{missing} item(s) without a price — fine; the cost is entered when the goods arrive or on the bill.</span>}</div>}
              </div>
            )}
            {tab === "lines" && <Field label="Notes" className="mt-3"><Textarea rows={2} disabled={!editable} value={head.notes} onChange={(e) => setHead((s) => ({ ...s, notes: e.target.value }))} /></Field>}
            {tab === "receipts" && (
              <div className="space-y-1.5">
                {(po.data?.receipts ?? []).length === 0 ? <p className="text-sm text-ink-muted">Nothing received yet.</p> : (po.data?.receipts ?? []).map((g) => (
                  <button key={g.id} className="flex w-full items-center gap-3 rounded-card border border-line px-3 py-2 text-left text-sm hover:bg-subtle" onClick={() => navigate(`/goods-receipts?view=${g.id}`)}>
                    <span className="font-mono text-xs font-medium">{String(g.doc_no)}</span><span>{formatDate(g.doc_date as string)}</span>
                    <span className="font-mono text-xs text-ink-muted">{(g.warehouse as { code: string } | null)?.code}</span>
                    <span className="ml-auto flex gap-1.5"><Badge tone={g.status === "POSTED" ? "success" : g.status === "DRAFT" ? "warning" : "neutral"}>{g.status === "POSTED" ? "Received" : String(g.status).toLowerCase()}</Badge>
                      {c.costs && g.status === "POSTED" && <Badge tone={g.cost_status === "APPROVED" ? "success" : "warning"}>{g.cost_status === "APPROVED" ? "Costed" : "Cost pending"}</Badge>}</span>
                  </button>
                ))}
              </div>
            )}
            {tab === "files" && id && <AttachmentsPanel entityType="purchase_orders" entityId={id} />}
            {tab === "history" && id && <AuditTimeline table="purchase_orders" id={id} />}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask === "cancel"} title="Cancel this purchase order?" tone="destructive" confirmLabel="Cancel order" loading={status.isPending} onCancel={() => setAsk(null)} onConfirm={() => status.mutate("CANCEL")}
        message="Nothing has been received on it yet.">
        <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={ask === "close"} title="Close this order?" confirmLabel="Close order" loading={status.isPending} onCancel={() => setAsk(null)} onConfirm={() => status.mutate("CLOSE")}
        message="Use this when the rest will not come. It can be reopened later.">
        <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. supplier short-shipped" /></Field>
      </ConfirmDialog>
      {ask === "receive" && po.data && <ReceiveDialog po={po.data.h} lines={po.data.lines} info={info.data} onClose={() => setAsk(null)} />}
    </>
  );
}

function ReceiveDialog({ po, lines, info, onClose }: { po: Row; lines: (Row & { quantity: number; received_qty: number })[]; info?: { products: Map<string, { name: string; uom: string }>; variants: Map<string, string> }; onClose: () => void }) {
  const navigate = useNavigate();
  const open = lines.filter((l) => Number(l.quantity) > Number(l.received_qty));
  const [wh, setWh] = React.useState<string | null>((po.warehouse_id as string) ?? null);
  const [date, setDate] = React.useState(today());
  const [ref, setRef] = React.useState("");
  const [qty, setQty] = React.useState<Record<string, string>>(Object.fromEntries(open.map((l) => [l.id, String(Number(l.quantity) - Number(l.received_qty))])));
  const go = useAction(() => rpc<string>("receive_purchase_order", { p_po_id: po.id, p_warehouse_id: wh, p_date: date, p_reference: ref || null,
    p_lines: open.map((l) => ({ po_line_id: l.id, quantity: num(qty[l.id] ?? "0") || 0 })) }), "Goods receipt made — check it and post it to add the stock");
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<PackagePlus className="h-4 w-4" />} title={`Receive goods — ${po.doc_no}`}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!wh} loading={go.isPending} onClick={() => go.mutate(undefined, { onSuccess: (gid) => navigate(`/goods-receipts?view=${gid}`) })}>Make goods receipt</Button></>}>
      <FormGrid cols={3} className="mb-3">
        <Field label="Into warehouse" required><WarehousePicker value={wh} onChange={setWh} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Delivery / bilty no."><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </FormGrid>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Item</th><th className={cn(th, "text-right")}>Ordered</th><th className={cn(th, "text-right")}>Already in</th><th className={cn(th, "w-32 text-right")}>Arrived now</th></tr></thead>
        <tbody>{open.map((l) => (
          <tr key={l.id}><td className={td}>{info?.products.get(l.product_id as string)?.name}{l.variant_id ? <span className="text-ink-muted"> · {info?.variants.get(l.variant_id as string)}</span> : null}</td>
            <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.quantity)}</td><td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.received_qty)}</td>
            <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))} /></td></tr>
        ))}</tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">A draft goods receipt is made with these quantities. Staff can tick the arrival on their phones, then post it to add the stock. The rest of the order stays open.</p>
    </ErpDialog>
  );
}
