import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Anchor, Ban, Calculator, CheckCircle2, Container, FileText, MapPin, PackagePlus, Plus, Printer, Save, ShieldAlert, Ship, StickyNote, Trash2 } from "lucide-react";
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
import { CurrencyInput, rpc, useAction, useCan, useItemInfo } from "./common";

type Row = Record<string, unknown> & { id: string };
const icon = <Ship className="h-4 w-4" />;
const th = "h-9 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "border-t border-line/70 px-2 py-1.5 align-top";

export const SHIP_STEPS = ["BOOKED", "LOADED", "DEPARTED", "TRANSSHIPMENT", "ARRIVED_PORT", "CUSTOMS", "RELEASED", "DELIVERED"] as const;
export const SHIP_LABEL: Record<string, string> = {
  BOOKED: "Booked", LOADED: "Loaded", DEPARTED: "Departed", TRANSSHIPMENT: "Transshipment", ARRIVED_PORT: "Arrived at port",
  CUSTOMS: "In customs", RELEASED: "Released", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};
export const SHIP_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  BOOKED: "neutral", LOADED: "info", DEPARTED: "info", TRANSSHIPMENT: "info", ARRIVED_PORT: "warning", CUSTOMS: "warning", RELEASED: "warning", DELIVERED: "success", CANCELLED: "neutral",
};
const MODES = [["SEA", "Sea"], ["AIR", "Air"], ["ROAD", "Road"], ["RAIL", "Rail"], ["COURIER", "Courier"]] as const;
const SIZES = ["20GP", "40GP", "40HQ", "45HQ", "LCL", "Other"];
const FILTERS = [
  { label: "On the way", statuses: ["BOOKED", "LOADED", "DEPARTED", "TRANSSHIPMENT"] },
  { label: "At port / customs", statuses: ["ARRIVED_PORT", "CUSTOMS", "RELEASED"] },
  { label: "Delivered", statuses: ["DELIVERED"] },
  { label: "All" },
] as { label: string; statuses?: string[] }[];
const sel = "h-control w-full rounded-control border border-line bg-surface px-2 text-sm disabled:opacity-60";

export function ShipmentsPage() {
  const { companyId } = useAccess();
  const c = useCan();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const view = params.get("view");
  const creating = params.get("new") === "1";
  const list = useEntityList<Row>({
    table: "shipments",
    select: "id, doc_no, status, mode, bl_no, etd, eta, ata, invoice_no, supplier:suppliers!shipments_supplier_id_fkey(name), containers:shipment_containers(container_no, is_active), lines:shipment_lines(quantity, received_qty, is_active)",
    companyId, search: q, searchColumns: ["doc_no", "bl_no", "invoice_no"], orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: c.view,
  });
  if (!c.view) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const flt = FILTERS[f] ?? FILTERS[0];
  const rows = (list.data?.rows ?? []).filter((r) => !flt.statuses || flt.statuses.includes(String(r.status)));
  const t = today();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Shipments" icon={icon}
        description="Imports on the way: containers, B/L, departure and arrival, documents. Receive the goods from here when they reach the warehouse, then add freight, customs and clearing as landed cost."
        actions={c.manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New shipment</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search shipment / B/L / invoice…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "d", header: "Shipment", width: "120px", cell: (r) => <span className="font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "s", header: "Supplier", cell: (r) => <span>{(r.supplier as { name: string } | null)?.name}{r.bl_no ? <span className="text-xs text-ink-muted"> · B/L {String(r.bl_no)}</span> : null}</span> },
              { key: "c", header: "Containers", width: "150px", hideBelow: "lg", cell: (r) => {
                const cs = ((r.containers as { container_no: string; is_active: boolean }[]) ?? []).filter((x) => x.is_active);
                return cs.length ? <span className="font-mono text-2xs">{cs.map((x) => x.container_no).join(", ")}</span> : <span className="text-xs text-ink-faint">—</span>;
              } },
              { key: "etd", header: "ETD", width: "95px", hideBelow: "md", cell: (r) => (r.etd ? formatDate(r.etd as string) : null) },
              { key: "eta", header: "ETA", width: "105px", cell: (r) => {
                if (!r.eta) return null;
                const late = !r.ata && String(r.eta) < t && !["ARRIVED_PORT", "CUSTOMS", "RELEASED", "DELIVERED", "CANCELLED"].includes(String(r.status));
                return <span className={cn(late && "font-medium text-danger")}>{formatDate(r.eta as string)}{late && " · late"}</span>;
              } },
              { key: "r", header: "Received", width: "120px", hideBelow: "md", cell: (r) => {
                const ls = ((r.lines as { quantity: number; received_qty: number; is_active: boolean }[]) ?? []).filter((l) => l.is_active);
                const all = ls.reduce((s, l) => s + Number(l.quantity), 0), got = ls.reduce((s, l) => s + Math.min(Number(l.received_qty), Number(l.quantity)), 0);
                return <div className="flex items-center gap-2"><div className="h-1.5 w-14 rounded-full bg-field"><div className="h-full rounded-full bg-success" style={{ width: `${all ? (got / all) * 100 : 0}%` }} /></div><span className="text-xs tabular-nums">{qtyFmt(got)}/{qtyFmt(all)}</span></div>;
              } },
              { key: "st", header: "Status", width: "140px", cell: (r) => <Badge tone={SHIP_TONE[String(r.status)]}>{SHIP_LABEL[String(r.status)]}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No shipments" description="Create one when a supplier ships goods — pull the items from the purchase orders." />} />
        )}
      </Card>
      {(creating || view) && <ShipmentDialog id={view} onClose={() => update({ view: null, new: null })} onSaved={(id) => update({ view: id, new: null })} />}
    </div>
  );
}

interface SLine { id?: string; po_line_id: string | null; po_no?: string; product_id: string | null; variant_id: string | null; quantity: string; container: string; packages: string; weight_kg: string; cbm: string; unit_price: string; received_qty: number; notes: string }
interface SCont { id?: string; key: string; container_no: string; size_type: string; seal_no: string; packages: string; gross_weight_kg: string; cbm: string }
interface SHead { supplier_id: string | null; forwarder_id: string | null; mode: string; bl_no: string; vessel: string; voyage: string; port_loading: string; port_discharge: string;
  origin_country: string; destination: string; incoterm: string; etd: string; eta: string; invoice_no: string; invoice_date: string; currency: string; fx_rate: string; gd_no: string; notes: string }
const blankHead: SHead = { supplier_id: null, forwarder_id: null, mode: "SEA", bl_no: "", vessel: "", voyage: "", port_loading: "", port_discharge: "Karachi", origin_country: "China", destination: "",
  incoterm: "", etd: "", eta: "", invoice_no: "", invoice_date: "", currency: "PKR", fx_rate: "1", gd_no: "", notes: "" };
const s = (v: unknown) => (v == null ? "" : String(v));
const newLine = (): SLine => ({ po_line_id: null, product_id: null, variant_id: null, quantity: "", container: "", packages: "", weight_kg: "", cbm: "", unit_price: "", received_qty: 0, notes: "" });

function useShipment(id: string | null) {
  const c = useCan();
  return useQuery({
    queryKey: ["record", "shipments", id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l, k, e, g, lc, p] = await Promise.all([
        sb().from("shipments").select("*, supplier:suppliers!shipments_supplier_id_fkey(name, code), forwarder:suppliers!shipments_forwarder_id_fkey(name)").eq("id", id!).single(),
        sb().from("shipment_lines").select("id, line_no, po_line_id, product_id, variant_id, quantity, received_qty, container_id, packages, weight_kg, cbm, notes, po_line:purchase_order_lines(purchase_order:purchase_orders(doc_no))").eq("shipment_id", id!).eq("is_active", true).order("line_no"),
        sb().from("shipment_containers").select("*").eq("shipment_id", id!).eq("is_active", true).order("container_no"),
        sb().from("shipment_events").select("*").eq("shipment_id", id!).order("event_date").order("created_at"),
        sb().from("goods_receipts").select("id, doc_no, doc_date, status, cost_status, warehouse:warehouses(code)").eq("shipment_id", id!).order("doc_date"),
        c.costs ? sb().from("landed_costs").select("id, doc_no, doc_date, status, charges:landed_cost_charges(amount_pkr, is_active, payee_type, settled_by)").eq("shipment_id", id!).order("doc_date") : Promise.resolve({ data: [] }),
        c.costs ? sb().rpc("shipment_line_prices", { p_shipment_id: id }) : Promise.resolve({ data: [] }),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      const prices = new Map(((p.data ?? []) as { line_id: string; unit_price: number | null }[]).map((x) => [x.line_id, x.unit_price]));
      return { h: h.data as Row, lines: (l.data ?? []).map((x) => ({ ...x, unit_price: prices.get(x.id as string) ?? null })) as Row[], containers: (k.data ?? []) as Row[],
        events: (e.data ?? []) as Row[], receipts: (g.data ?? []) as Row[], landed: (lc.data ?? []) as Row[] };
    },
  });
}

function ShipmentDialog({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { companyId, company } = useAccess();
  const c = useCan();
  const navigate = useNavigate();
  const doc = useShipment(id);
  const files = useAttachments("shipments", id);
  const h = doc.data?.h;
  const st = String(h?.status ?? "BOOKED");
  const editable = c.manage && st !== "CANCELLED";
  const idem = React.useRef(crypto.randomUUID());
  const [head, setHead] = React.useState<SHead>(blankHead);
  const [lines, setLines] = React.useState<SLine[]>([newLine()]);
  const [conts, setConts] = React.useState<SCont[]>([]);
  const [tab, setTab] = React.useState("lines");
  const [ask, setAsk] = React.useState<null | "status" | "note" | "receive" | "cancel" | "pos">(null);
  React.useEffect(() => {
    if (!doc.data) return;
    const x = doc.data.h;
    setHead({ supplier_id: x.supplier_id as string, forwarder_id: (x.forwarder_id as string) ?? null, mode: s(x.mode), bl_no: s(x.bl_no), vessel: s(x.vessel), voyage: s(x.voyage),
      port_loading: s(x.port_loading), port_discharge: s(x.port_discharge), origin_country: s(x.origin_country), destination: s(x.destination), incoterm: s(x.incoterm),
      etd: s(x.etd), eta: s(x.eta), invoice_no: s(x.invoice_no), invoice_date: s(x.invoice_date), currency: s(x.currency) || "PKR", fx_rate: s(x.fx_rate) || "1", gd_no: s(x.gd_no), notes: s(x.notes) });
    setConts(doc.data.containers.map((k) => ({ id: k.id, key: k.id, container_no: s(k.container_no), size_type: s(k.size_type), seal_no: s(k.seal_no), packages: s(k.packages), gross_weight_kg: s(k.gross_weight_kg), cbm: s(k.cbm) })));
    setLines(doc.data.lines.map((l) => ({ id: l.id, po_line_id: (l.po_line_id as string) ?? null,
      po_no: ((l.po_line as { purchase_order: { doc_no: string } | null } | null)?.purchase_order?.doc_no) ?? undefined,
      product_id: l.product_id as string, variant_id: (l.variant_id as string) ?? null, quantity: s(Number(l.quantity)), container: s(l.container_id), packages: s(l.packages),
      weight_kg: l.weight_kg == null ? "" : s(Number(l.weight_kg)), cbm: l.cbm == null ? "" : s(Number(l.cbm)), unit_price: l.unit_price == null ? "" : s(Number(l.unit_price)),
      received_qty: Number(l.received_qty), notes: s(l.notes) })));
  }, [doc.data]);
  const info = useItemInfo(lines.map((l) => l.product_id), lines.map((l) => l.variant_id));
  const setLine = (i: number, p: Partial<SLine>) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const setCont = (i: number, p: Partial<SCont>) => setConts((x) => x.map((k, j) => (j === i ? { ...k, ...p } : k)));
  const used = lines.filter((l) => l.product_id);
  const totQty = used.reduce((a, l) => a + (num(l.quantity) || 0), 0);
  const totW = used.reduce((a, l) => a + (num(l.weight_kg) || 0), 0);
  const totCbm = used.reduce((a, l) => a + (num(l.cbm) || 0), 0);
  const value = used.reduce((a, l) => a + (num(l.quantity) || 0) * (num(l.unit_price) || 0), 0);

  const save = useAction(async () => {
    const nid = await rpc<string>("save_shipment", {
      p_id: id, p_header: { company_id: companyId, ...head, fx_rate: num(head.fx_rate) || 1 },
      p_lines: used.map((l) => ({ id: l.id ?? null, po_line_id: l.po_line_id, product_id: l.product_id, variant_id: l.variant_id, quantity: num(l.quantity), container: l.container || null,
        packages: l.packages || null, weight_kg: l.weight_kg.trim() ? num(l.weight_kg) : null, cbm: l.cbm.trim() ? num(l.cbm) : null, unit_price: l.unit_price.trim() ? num(l.unit_price) : null, notes: l.notes || null })),
      p_containers: conts.filter((k) => k.container_no.trim()).map((k) => ({ id: k.id ?? null, key: k.key, container_no: k.container_no, size_type: k.size_type, seal_no: k.seal_no,
        packages: k.packages || null, gross_weight_kg: k.gross_weight_kg || null, cbm: k.cbm || null })),
      p_idempotency_key: id ? null : idem.current,
    });
    return nid;
  }, "Shipment saved");
  const doSave = () => save.mutate(undefined, { onSuccess: (nid) => { idem.current = crypto.randomUUID(); onSaved(nid as string); } });

  const print = () => {
    if (!h) return;
    printDocument({
      company: company?.company_name ?? "", title: "Shipment / Packing list", docNo: String(h.doc_no),
      meta: [["Supplier", (h.supplier as { name: string }).name], ["B/L / AWB", s(h.bl_no)], ["Vessel / voyage", [h.vessel, h.voyage].filter(Boolean).join(" / ")],
        ["From", s(h.port_loading)], ["To", s(h.port_discharge)], ["ETD / ETA", `${h.etd ? formatDate(h.etd as string) : "—"} → ${h.eta ? formatDate(h.eta as string) : "—"}`],
        ["Containers", conts.map((k) => `${k.container_no}${k.size_type ? ` (${k.size_type})` : ""}`).join(", ")], ["Commercial invoice", s(h.invoice_no)], ["GD no.", s(h.gd_no)]],
      columns: [{ label: "#" }, { label: "Item" }, { label: "Container" }, { label: "Qty", align: "right" }, { label: "Pkgs", align: "right" }, { label: "Weight kg", align: "right" }, { label: "CBM", align: "right" }],
      rows: used.map((l, i) => [String(i + 1), `${info.data?.products.get(l.product_id ?? "")?.name ?? ""}${l.variant_id ? ` · ${info.data?.variants.get(l.variant_id) ?? ""}` : ""}`,
        conts.find((k) => k.key === l.container || k.id === l.container)?.container_no ?? "", `${l.quantity} ${info.data?.products.get(l.product_id ?? "")?.uom ?? ""}`, l.packages, l.weight_kg, l.cbm]),
      totals: [["Total weight kg", qtyFmt(totW)], ["Total CBM", qtyFmt(totCbm)]], notes: h.notes as string | null,
    });
  };

  const stepIdx = SHIP_STEPS.indexOf(st as (typeof SHIP_STEPS)[number]);
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="purchase" icon={icon} title={h ? String(h.doc_no) : "New shipment"}
        subtitle={(h?.supplier as { name: string } | undefined)?.name} status={h ? <Badge tone={SHIP_TONE[st]}>{SHIP_LABEL[st]}</Badge> : null}
        footer={<>
          {id && editable && st !== "DELIVERED" && !doc.data?.lines.some((l) => Number(l.received_qty) > 0) && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("cancel")}>Cancel shipment</Button>}
          <div className="flex-1" />
          {id && <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>}
          <Button onClick={onClose}>Close</Button>
          {editable && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={doSave}>{id ? "Save changes" : "Save shipment"}</Button>}
          {id && editable && <Button icon={<StickyNote className="h-3.5 w-3.5" />} onClick={() => setAsk("note")}>Add note / new ETA</Button>}
          {id && editable && st !== "DELIVERED" && <Button icon={<MapPin className="h-3.5 w-3.5" />} onClick={() => setAsk("status")}>Update status</Button>}
          {id && c.costs && st !== "CANCELLED" && (doc.data?.receipts ?? []).some((g) => g.status === "POSTED") && <Button icon={<Calculator className="h-3.5 w-3.5" />} onClick={() => navigate(`/landed-costs?new=1&shipment=${id}`)}>Add landed cost</Button>}
          {id && c.receive && st !== "CANCELLED" && st !== "DELIVERED" && <Button variant="primary" icon={<PackagePlus className="h-3.5 w-3.5" />} onClick={() => setAsk("receive")}>Receive goods</Button>}
        </>}>
        {id && doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : (
          <>
            {id && st !== "CANCELLED" && (
              <div className="mb-3 flex items-center gap-1 overflow-x-auto rounded-card border border-line bg-subtle/40 px-3 py-2">
                {SHIP_STEPS.filter((x) => x !== "TRANSSHIPMENT" || st === "TRANSSHIPMENT").map((x, i, arr) => {
                  const idx = SHIP_STEPS.indexOf(x);
                  const done = idx <= stepIdx;
                  return (
                    <React.Fragment key={x}>
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-medium", done ? "bg-teal-600 text-white" : "bg-white text-ink-muted ring-1 ring-line", x === st && "ring-2 ring-teal-300")}>{SHIP_LABEL[x]}</span>
                      {i < arr.length - 1 && <span className={cn("h-px w-4 shrink-0", done ? "bg-teal-500" : "bg-line")} />}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            {st === "CANCELLED" && <p className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">Cancelled{h?.cancel_reason ? `: ${String(h.cancel_reason)}` : ""}</p>}
            <FormGrid cols={4} className="mb-3">
              <Field label="Supplier" required className="sm:col-span-2">
                <LookupPicker value={head.supplier_id} onChange={(v) => setHead((x) => ({ ...x, supplier_id: v }))} disabled={!editable || !!doc.data?.lines.some((l) => l.po_line_id)} clearable={false} placeholder="Supplier…"
                  spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} />
              </Field>
              <Field label="Forwarder / shipping line">
                <LookupPicker value={head.forwarder_id} onChange={(v) => setHead((x) => ({ ...x, forwarder_id: v }))} disabled={!editable} placeholder="(optional)"
                  spec={{ table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } }} />
              </Field>
              <Field label="Mode"><select className={sel} disabled={!editable} value={head.mode} onChange={(e) => setHead((x) => ({ ...x, mode: e.target.value }))}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label={head.mode === "AIR" ? "AWB no." : "B/L no."}><Input disabled={!editable} value={head.bl_no} onChange={(e) => setHead((x) => ({ ...x, bl_no: e.target.value }))} /></Field>
              <Field label="Vessel / flight"><Input disabled={!editable} value={head.vessel} onChange={(e) => setHead((x) => ({ ...x, vessel: e.target.value }))} /></Field>
              <Field label="Voyage"><Input disabled={!editable} value={head.voyage} onChange={(e) => setHead((x) => ({ ...x, voyage: e.target.value }))} /></Field>
              <Field label="Incoterm"><Input disabled={!editable} placeholder="FOB / CIF / EXW…" value={head.incoterm} onChange={(e) => setHead((x) => ({ ...x, incoterm: e.target.value }))} /></Field>
              <Field label="Port of loading"><Input disabled={!editable} placeholder="e.g. Ningbo" value={head.port_loading} onChange={(e) => setHead((x) => ({ ...x, port_loading: e.target.value }))} /></Field>
              <Field label="Port of discharge"><Input disabled={!editable} value={head.port_discharge} onChange={(e) => setHead((x) => ({ ...x, port_discharge: e.target.value }))} /></Field>
              <Field label="ETD"><Input type="date" disabled={!editable} value={head.etd} onChange={(e) => setHead((x) => ({ ...x, etd: e.target.value }))} /></Field>
              <Field label="ETA" hint={h?.ata ? `Arrived ${formatDate(h.ata as string)}` : h?.atd ? `Departed ${formatDate(h.atd as string)}` : undefined}><Input type="date" disabled={!editable} value={head.eta} onChange={(e) => setHead((x) => ({ ...x, eta: e.target.value }))} /></Field>
              <Field label="Commercial invoice no."><Input disabled={!editable} value={head.invoice_no} onChange={(e) => setHead((x) => ({ ...x, invoice_no: e.target.value }))} /></Field>
              <Field label="Invoice date"><Input type="date" disabled={!editable} value={head.invoice_date} onChange={(e) => setHead((x) => ({ ...x, invoice_date: e.target.value }))} /></Field>
              {c.costs && <Field label="Invoice currency"><CurrencyInput currency={head.currency} rate={head.fx_rate} disabled={!editable} onCurrency={(v) => setHead((x) => ({ ...x, currency: v }))} onRate={(v) => setHead((x) => ({ ...x, fx_rate: v }))} /></Field>}
              <Field label="GD no. (customs)"><Input disabled={!editable} value={head.gd_no} onChange={(e) => setHead((x) => ({ ...x, gd_no: e.target.value }))} /></Field>
            </FormGrid>
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: "lines", label: `Items (${used.length})` }, { key: "containers", label: `Containers (${conts.length})` },
              ...(id ? [{ key: "tracking", label: "Tracking" }, { key: "receipts", label: `Receipts (${doc.data?.receipts.length ?? 0})` },
                ...(c.costs ? [{ key: "landed", label: `Landed cost (${doc.data?.landed.length ?? 0})` }] : []),
                { key: "files", label: filesLabel(files.data?.length) }, { key: "history", label: "History" }] : [])]} />
            {tab === "lines" && (
              <>
                <div className="overflow-x-auto rounded-card border border-line">
                  <table className="w-full min-w-[1000px] text-sm">
                    <thead className="bg-subtle"><tr>
                      <th className={cn(th, "w-8")}>#</th><th className={th}>Item</th><th className={cn(th, "w-44")}>Variant</th><th className={cn(th, "w-28 text-right")}>Qty</th>
                      <th className={cn(th, "w-36")}>Container</th><th className={cn(th, "w-20 text-right")}>Pkgs</th><th className={cn(th, "w-24 text-right")}>Weight kg</th><th className={cn(th, "w-20 text-right")}>CBM</th>
                      {c.costs && <th className={cn(th, "w-28 text-right")}>Price ({head.currency})</th>}
                      {id && <th className={cn(th, "w-24 text-right")}>Received</th>}<th className={cn(th, "w-10")} />
                    </tr></thead>
                    <tbody>{lines.map((l, i) => {
                      const it = info.data?.products.get(l.product_id ?? "");
                      const locked = l.received_qty > 0;
                      return (
                        <tr key={l.id ?? `n${i}`}>
                          <td className={cn(td, "pt-3 text-ink-muted")}>{i + 1}</td>
                          <td className={td}>{editable && !locked && !l.po_line_id ? <ProductPicker value={l.product_id} onChange={(v) => setLine(i, { product_id: v, variant_id: null })} showStock={false} />
                            : <div className="pt-1"><div className="font-medium">{it?.name}</div><div className="text-2xs text-ink-muted">{it?.sku}{l.po_no ? ` · ${l.po_no}` : ""}</div></div>}</td>
                          <td className={td}>{editable && !locked && !l.po_line_id ? <VariantPicker productId={l.product_id} value={l.variant_id} onChange={(v) => setLine(i, { variant_id: v })} showStock={false} />
                            : <div className="pt-1 text-ink-2">{l.variant_id ? info.data?.variants.get(l.variant_id) : ""}</div>}</td>
                          <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                            <div className="mt-0.5 text-right text-2xs text-ink-muted">{it?.uom}</div></td>
                          <td className={td}><select className={sel} disabled={!editable} value={l.container} onChange={(e) => setLine(i, { container: e.target.value })}>
                            <option value="">—</option>{conts.filter((k) => k.container_no.trim()).map((k) => <option key={k.key} value={k.id ?? k.key}>{k.container_no}</option>)}</select></td>
                          <td className={td}><Input className="text-right tabular-nums" inputMode="numeric" disabled={!editable} value={l.packages} onChange={(e) => setLine(i, { packages: e.target.value })} /></td>
                          <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} value={l.weight_kg} onChange={(e) => setLine(i, { weight_kg: e.target.value })} /></td>
                          <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} value={l.cbm} onChange={(e) => setLine(i, { cbm: e.target.value })} /></td>
                          {c.costs && <td className={td}><Input className="text-right tabular-nums" inputMode="decimal" disabled={!editable} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>}
                          {id && <td className={cn(td, "pt-3 text-right tabular-nums", l.received_qty >= num(l.quantity) ? "text-success" : l.received_qty > 0 && "text-warning")}>{qtyFmt(l.received_qty)}</td>}
                          <td className={td}>{editable && !locked && lines.length > 1 && <Button size="icon-sm" variant="destructive-ghost" aria-label="Remove line" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
                        </tr>
                      );
                    })}</tbody>
                    <tfoot><tr className="bg-subtle/60 text-xs font-semibold"><td className={td} colSpan={3}>Total</td><td className={cn(td, "text-right tabular-nums")}>{qtyFmt(totQty)}</td><td className={td} /><td className={td} />
                      <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(totW)}</td><td className={cn(td, "text-right tabular-nums")}>{qtyFmt(totCbm)}</td>
                      {c.costs && <td className={cn(td, "text-right tabular-nums")}>{value ? `${head.currency} ${money(value)}` : ""}</td>}{id && <td className={td} />}<td className={td} /></tr></tfoot>
                  </table>
                  {editable && <div className="flex flex-wrap items-center gap-2 border-t border-line px-2 py-2">
                    <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} disabled={!head.supplier_id} title={head.supplier_id ? undefined : "Choose the supplier first"} onClick={() => setAsk("pos")}>Add from purchase orders</Button>
                    <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((x) => [...x, newLine()])}>Add item</Button>
                    <span className="text-xs text-ink-muted">Weight and CBM are used to split freight when adding landed cost.</span></div>}
                </div>
                <Field label="Notes" className="mt-3"><Textarea rows={2} disabled={!editable} value={head.notes} onChange={(e) => setHead((x) => ({ ...x, notes: e.target.value }))} /></Field>
              </>
            )}
            {tab === "containers" && (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-subtle"><tr><th className={th}>Container no.</th><th className={cn(th, "w-32")}>Size</th><th className={cn(th, "w-36")}>Seal no.</th><th className={cn(th, "w-24 text-right")}>Pkgs</th>
                    <th className={cn(th, "w-28 text-right")}>Gross kg</th><th className={cn(th, "w-24 text-right")}>CBM</th><th className={cn(th, "w-10")} /></tr></thead>
                  <tbody>{conts.length === 0 ? <tr><td className={cn(td, "py-4 text-center text-ink-muted")} colSpan={7}>No containers yet{head.mode === "AIR" ? " (air shipments usually have none)" : ""}.</td></tr> : conts.map((k, i) => (
                    <tr key={k.key}>
                      <td className={td}><Input className="font-mono uppercase" disabled={!editable} placeholder="MSKU1234567" value={k.container_no} onChange={(e) => setCont(i, { container_no: e.target.value })} /></td>
                      <td className={td}><select className={sel} disabled={!editable} value={k.size_type} onChange={(e) => setCont(i, { size_type: e.target.value })}><option value="">—</option>{SIZES.map((z) => <option key={z}>{z}</option>)}</select></td>
                      <td className={td}><Input disabled={!editable} value={k.seal_no} onChange={(e) => setCont(i, { seal_no: e.target.value })} /></td>
                      <td className={td}><Input className="text-right" inputMode="numeric" disabled={!editable} value={k.packages} onChange={(e) => setCont(i, { packages: e.target.value })} /></td>
                      <td className={td}><Input className="text-right" inputMode="decimal" disabled={!editable} value={k.gross_weight_kg} onChange={(e) => setCont(i, { gross_weight_kg: e.target.value })} /></td>
                      <td className={td}><Input className="text-right" inputMode="decimal" disabled={!editable} value={k.cbm} onChange={(e) => setCont(i, { cbm: e.target.value })} /></td>
                      <td className={td}>{editable && !lines.some((l) => l.container === (k.id ?? k.key) && l.received_qty > 0) &&
                        <Button size="icon-sm" variant="destructive-ghost" aria-label="Remove container" onClick={() => { setConts((x) => x.filter((_, j) => j !== i)); setLines((x) => x.map((l) => (l.container === (k.id ?? k.key) ? { ...l, container: "" } : l))); }}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {editable && <div className="border-t border-line px-2 py-2"><Button size="sm" variant="ghost" icon={<Container className="h-3.5 w-3.5" />}
                  onClick={() => setConts((x) => [...x, { key: crypto.randomUUID(), container_no: "", size_type: "40HQ", seal_no: "", packages: "", gross_weight_kg: "", cbm: "" }])}>Add container</Button></div>}
              </div>
            )}
            {tab === "tracking" && (
              <ol className="relative ml-2 border-l border-line pl-5">
                {(doc.data?.events ?? []).map((e) => (
                  <li key={String(e.id)} className="mb-4">
                    <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-teal-500" />
                    <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={SHIP_TONE[String(e.status)]}>{SHIP_LABEL[String(e.status)] ?? String(e.status)}</Badge>
                      <span className="font-medium">{formatDate(e.event_date as string)}</span>{e.location ? <span className="flex items-center gap-1 text-ink-muted"><Anchor className="h-3 w-3" />{String(e.location)}</span> : null}</div>
                    {e.note ? <p className="mt-0.5 text-sm text-ink-2">{String(e.note)}</p> : null}
                  </li>
                ))}
              </ol>
            )}
            {tab === "receipts" && (
              <div className="space-y-1.5">
                {(doc.data?.receipts ?? []).length === 0 ? <p className="text-sm text-ink-muted">Nothing received yet. Use “Receive goods” when the container reaches the warehouse.</p> : (doc.data?.receipts ?? []).map((g) => (
                  <button key={g.id} className="flex w-full items-center gap-3 rounded-card border border-line px-3 py-2 text-left text-sm hover:bg-subtle" onClick={() => navigate(`/goods-receipts?view=${g.id}`)}>
                    <span className="font-mono text-xs font-medium">{String(g.doc_no)}</span><span>{formatDate(g.doc_date as string)}</span>
                    <span className="font-mono text-xs text-ink-muted">{(g.warehouse as { code: string } | null)?.code}</span>
                    <span className="ml-auto flex gap-1.5"><Badge tone={g.status === "POSTED" ? "success" : g.status === "DRAFT" ? "warning" : "neutral"}>{g.status === "POSTED" ? "Received" : String(g.status).toLowerCase()}</Badge>
                      {c.costs && g.status === "POSTED" && <Badge tone={g.cost_status === "APPROVED" ? "success" : "warning"}>{g.cost_status === "APPROVED" ? "Costed" : "Cost pending"}</Badge>}</span>
                  </button>
                ))}
              </div>
            )}
            {tab === "landed" && (
              <div className="space-y-1.5">
                {(doc.data?.landed ?? []).length === 0 ? <p className="text-sm text-ink-muted">No landed cost yet. Add freight, customs, clearing and port charges once the goods are received.</p> : (doc.data?.landed ?? []).map((x) => {
                  const ch = ((x.charges as { amount_pkr: number; is_active: boolean; payee_type: string; settled_by: string | null }[]) ?? []).filter((k) => k.is_active);
                  const open = ch.filter((k) => k.payee_type === "ESTIMATE" && !k.settled_by).length;
                  return (
                    <button key={x.id} className="flex w-full items-center gap-3 rounded-card border border-line px-3 py-2 text-left text-sm hover:bg-subtle" onClick={() => navigate(`/landed-costs?view=${x.id}`)}>
                      <span className="font-mono text-xs font-medium">{String(x.doc_no)}</span><span>{formatDate(x.doc_date as string)}</span>
                      <span className="tabular-nums">PKR {money(ch.reduce((a, k) => a + Number(k.amount_pkr), 0))}</span>
                      {open > 0 && x.status === "POSTED" && <Badge tone="warning">{open} estimate{open > 1 ? "s" : ""} open</Badge>}
                      <Badge tone={x.status === "POSTED" ? "success" : x.status === "DRAFT" ? "warning" : "neutral"} className="ml-auto">{String(x.status).toLowerCase()}</Badge>
                    </button>
                  );
                })}
              </div>
            )}
            {tab === "files" && id && <AttachmentsPanel entityType="shipments" entityId={id} />}
            {tab === "history" && id && <AuditTimeline table="shipments" id={id} />}
          </>
        )}
      </ErpDialog>
      {ask === "pos" && head.supplier_id && <PoLinesDialog supplierId={head.supplier_id} shipmentId={id} onClose={() => setAsk(null)}
        onAdd={(rows) => { setLines((x) => [...x.filter((l) => l.product_id), ...rows]); setAsk(null); }} existing={lines.map((l) => l.po_line_id).filter(Boolean) as string[]} />}
      {ask === "status" && id && <StatusDialog id={id} current={st} onClose={() => setAsk(null)} />}
      {ask === "note" && id && <NoteDialog id={id} eta={head.eta} onClose={() => setAsk(null)} />}
      {ask === "cancel" && id && <CancelDialog id={id} onClose={() => setAsk(null)} />}
      {ask === "receive" && id && doc.data && <ReceiveShipmentDialog id={id} lines={doc.data.lines} info={info.data} onClose={() => setAsk(null)} />}
    </>
  );
}

function PoLinesDialog({ supplierId, shipmentId, existing, onClose, onAdd }: { supplierId: string; shipmentId: string | null; existing: string[]; onClose: () => void; onAdd: (l: SLine[]) => void }) {
  const { companyId } = useAccess();
  const pos = useQuery({ queryKey: ["open-pos", supplierId], queryFn: async () => {
    const { data, error } = await sb().from("purchase_orders").select("id, doc_no, order_date, status").eq("company_id", companyId!).eq("supplier_id", supplierId).in("status", ["APPROVED", "PARTIALLY_RECEIVED"]).order("order_date");
    if (error) throw error;
    return (data ?? []) as Row[];
  } });
  const [picked, setPicked] = React.useState<string[]>([]);
  const lines = useQuery({ queryKey: ["shipment-po-lines", picked.join(), shipmentId], enabled: picked.length > 0, queryFn: async () =>
    (await rpc<{ po_line_id: string; po_no: string; product_id: string; variant_id: string | null; product_name: string; variant_name: string | null; open_qty: number; unit_price: number | null; weight_kg: number | null }[]>(
      "shipment_po_lines", { p_company: companyId, p_po_ids: picked, p_exclude_shipment: shipmentId })) ?? [] });
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const avail = (lines.data ?? []).filter((l) => !existing.includes(l.po_line_id));
  const add = () => onAdd(avail.filter((l) => num(qty[l.po_line_id] ?? String(Math.max(Number(l.open_qty), 0))) > 0).map((l) => {
    const q = num(qty[l.po_line_id] ?? String(Number(l.open_qty)));
    return { ...newLine(), po_line_id: l.po_line_id, po_no: l.po_no, product_id: l.product_id, variant_id: l.variant_id, quantity: String(q),
      weight_kg: l.weight_kg ? String(Math.round(Number(l.weight_kg) * q * 100) / 100) : "", unit_price: l.unit_price == null ? "" : String(Number(l.unit_price)) };
  }));
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<FileText className="h-4 w-4" />} title="Add items from purchase orders"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!avail.length} onClick={add}>Add to shipment</Button></>}>
      <div className="mb-3 flex flex-wrap gap-2">
        {(pos.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">No approved, open purchase orders for this supplier.</p> : (pos.data ?? []).map((p) => (
          <label key={p.id} className={cn("flex cursor-pointer items-center gap-2 rounded-control border px-2.5 py-1.5 text-sm", picked.includes(p.id) ? "border-teal-400 bg-teal-50" : "border-line")}>
            <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
            <span className="font-mono text-xs">{String(p.doc_no)}</span><span className="text-xs text-ink-muted">{formatDate(p.order_date as string)}</span>
          </label>
        ))}
      </div>
      {picked.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr><th className={th}>PO</th><th className={th}>Item</th><th className={cn(th, "text-right")}>Still to ship</th><th className={cn(th, "w-32 text-right")}>On this shipment</th></tr></thead>
          <tbody>{avail.map((l) => (
            <tr key={l.po_line_id}><td className={cn(td, "font-mono text-xs")}>{l.po_no}</td><td className={td}>{l.product_name}{l.variant_name ? <span className="text-ink-muted"> · {l.variant_name}</span> : null}</td>
              <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.open_qty)}</td>
              <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={qty[l.po_line_id] ?? String(Math.max(Number(l.open_qty), 0))} onChange={(e) => setQty((x) => ({ ...x, [l.po_line_id]: e.target.value }))} /></td></tr>
          ))}</tbody>
        </table>
      )}
    </ErpDialog>
  );
}

function StatusDialog({ id, current, onClose }: { id: string; current: string; onClose: () => void }) {
  const next = SHIP_STEPS[Math.min(SHIP_STEPS.indexOf(current as (typeof SHIP_STEPS)[number]) + 1, SHIP_STEPS.length - 1)];
  const [status, setStatus] = React.useState<string>(next === "TRANSSHIPMENT" ? "ARRIVED_PORT" : next);
  const [date, setDate] = React.useState(today());
  const [loc, setLoc] = React.useState("");
  const [note, setNote] = React.useState("");
  const go = useAction(() => rpc("set_shipment_status", { p_id: id, p_status: status, p_date: date, p_location: loc || null, p_note: note || null }), "Status updated", onClose);
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<MapPin className="h-4 w-4" />} title="Update shipment status"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={go.isPending} onClick={() => go.mutate(undefined)}>Update</Button></>}>
      <FormGrid cols={2}>
        <Field label="New status" className="sm:col-span-2"><select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>{SHIP_STEPS.filter((x) => x !== "DELIVERED").map((x) => <option key={x} value={x}>{SHIP_LABEL[x]}</option>)}</select></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Where"><Input placeholder="e.g. Port Qasim" value={loc} onChange={(e) => setLoc(e.target.value)} /></Field>
        <Field label="Note" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </FormGrid>
      <p className="mt-2 text-xs text-ink-muted">“Delivered” is set by itself when everything on the shipment has been received into a warehouse.</p>
    </ErpDialog>
  );
}

function NoteDialog({ id, eta, onClose }: { id: string; eta: string; onClose: () => void }) {
  const [date, setDate] = React.useState(today());
  const [note, setNote] = React.useState("");
  const [newEta, setNewEta] = React.useState("");
  const go = useAction(() => rpc("add_shipment_note", { p_id: id, p_date: date, p_location: null, p_note: note, p_new_eta: newEta || null }), "Added to the tracking", onClose);
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<StickyNote className="h-4 w-4" />} title="Tracking note"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} onClick={() => go.mutate(undefined)}>Add</Button></>}>
      <FormGrid cols={2}>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="New ETA" hint={eta ? `Now ${formatDate(eta)}` : undefined}><Input type="date" value={newEta} onChange={(e) => setNewEta(e.target.value)} /></Field>
        <Field label="Note" className="sm:col-span-2"><Textarea rows={2} placeholder="e.g. vessel delayed at Colombo" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </FormGrid>
    </ErpDialog>
  );
}

function CancelDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const go = useAction(() => rpc("set_shipment_status", { p_id: id, p_status: "CANCELLED", p_date: today(), p_location: null, p_note: reason }), "Shipment cancelled", onClose);
  return (
    <ConfirmDialog open title="Cancel this shipment?" tone="destructive" confirmLabel="Cancel shipment" loading={go.isPending} onCancel={onClose} onConfirm={() => go.mutate(undefined)}
      message="Nothing from it has been received. The purchase orders stay open.">
      <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </ConfirmDialog>
  );
}

function ReceiveShipmentDialog({ id, lines, info, onClose }: { id: string; lines: Row[]; info?: { products: Map<string, { name: string; uom: string }>; variants: Map<string, string> }; onClose: () => void }) {
  const navigate = useNavigate();
  const open = lines.filter((l) => Number(l.quantity) > Number(l.received_qty));
  const [wh, setWh] = React.useState<string | null>(null);
  const [date, setDate] = React.useState(today());
  const [ref, setRef] = React.useState("");
  const [qty, setQty] = React.useState<Record<string, string>>(Object.fromEntries(open.map((l) => [l.id, String(Number(l.quantity) - Number(l.received_qty))])));
  const go = useAction(() => rpc<string>("receive_shipment", { p_id: id, p_warehouse_id: wh, p_date: date, p_reference: ref || null,
    p_lines: open.map((l) => ({ shipment_line_id: l.id, quantity: num(qty[l.id] ?? "0") || 0 })) }), "Goods receipt made — check it and post it to add the stock");
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={<PackagePlus className="h-4 w-4" />} title="Receive goods from the shipment"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!wh} loading={go.isPending} onClick={() => go.mutate(undefined, { onSuccess: (gid) => navigate(`/goods-receipts?view=${gid}`) })}>Make goods receipt</Button></>}>
      <FormGrid cols={3} className="mb-3">
        <Field label="Into warehouse" required><WarehousePicker value={wh} onChange={setWh} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Bilty / delivery no."><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </FormGrid>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Item</th><th className={cn(th, "text-right")}>Shipped</th><th className={cn(th, "text-right")}>Already in</th><th className={cn(th, "w-32 text-right")}>Arrived now</th></tr></thead>
        <tbody>{open.map((l) => (
          <tr key={l.id}><td className={td}>{info?.products.get(l.product_id as string)?.name}{l.variant_id ? <span className="text-ink-muted"> · {info?.variants.get(l.variant_id as string)}</span> : null}</td>
            <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.quantity)}</td><td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.received_qty)}</td>
            <td className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty((x) => ({ ...x, [l.id]: e.target.value }))} /></td></tr>
        ))}</tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">A draft goods receipt is made with these quantities. If the goods go to two warehouses, receive twice. Posting the receipt adds the stock and updates the purchase orders.</p>
    </ErpDialog>
  );
}
