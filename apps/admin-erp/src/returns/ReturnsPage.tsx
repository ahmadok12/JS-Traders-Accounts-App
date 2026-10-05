import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, PackageX, Plus, Printer, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, Input, KeyValue, PageHeader, SearchableSelect, Skeleton, Textarea, cn, type SelectOption } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { MovementsTable } from "../inventory/MovementsTable";
import { money, today } from "../accounting/common";
import { n, qtyFmt, useWarehouses } from "../sales/common";
import { printDocument } from "../sales/print";

/**
 * Sales returns (goods back from a customer, against a GDN) and purchase returns (goods back to a supplier, against a goods receipt).
 * One screen design for both; the database decides credit notes / debit notes and stock value.
 */
type Kind = "sales" | "purchase";
type Row = Record<string, unknown> & { id: string };
interface Cfg {
  kind: Kind; title: string; route: string; table: string; lineTable: string; listSelect: string;
  sourceLabel: string; sourceParam: string; partyLabel: string; perm: string; viewPerms: string[];
  reasons: string[]; description: string; emptyText: string;
}
const CFG: Record<Kind, Cfg> = {
  sales: {
    kind: "sales", title: "Sales returns", route: "/sales-returns", table: "sales_returns", lineTable: "sales_return_lines",
    listSelect: "id, doc_no, return_date, status, reason, customer:customers(name, code), src:gdns(doc_no), lines:sales_return_lines(quantity)",
    sourceLabel: "GDN", sourceParam: "gdn", partyLabel: "Customer", perm: P.salesReturn, viewPerms: [P.salesReturn, P.salesView, P.inventoryView],
    reasons: ["Damaged", "Wrong item sent", "Excess quantity", "Quality issue", "Customer changed mind"],
    description: "Goods a customer sends back. Choose the GDN they left on — the stock comes back into the warehouse. If they were already invoiced, a credit note is made automatically.",
    emptyText: "No customer returns yet. Open a dispatched GDN and press “Return goods”, or use “New return”.",
  },
  purchase: {
    kind: "purchase", title: "Purchase returns", route: "/purchase-returns", table: "purchase_returns", lineTable: "purchase_return_lines",
    listSelect: "id, doc_no, return_date, status, reason, supplier:suppliers(name, code), src:goods_receipts(doc_no), warehouse:warehouses(code), lines:purchase_return_lines(quantity)",
    sourceLabel: "Goods receipt", sourceParam: "grn", partyLabel: "Supplier", perm: P.purchasingReturn, viewPerms: [P.purchasingReturn, P.purchasingView, P.inventoryView],
    reasons: ["Damaged / faulty", "Wrong item", "Excess quantity", "Quality rejected"],
    description: "Goods sent back to the supplier. Choose the goods receipt (GRN) they came in on — the stock leaves the warehouse. If the supplier already billed them, a debit note is made automatically.",
    emptyText: "No returns to suppliers yet. Open a goods receipt and press “Return to supplier”, or use “New return”.",
  },
};
const TONE: Record<string, "success" | "danger"> = { POSTED: "success", REVERSED: "danger" };
const statusLabel = (s: string) => (s === "POSTED" ? "Returned" : "Reversed");
const FILTERS = [{ label: "Returned", status: "POSTED" }, { label: "Reversed", status: "REVERSED" }, { label: "All" }] as { label: string; status?: string }[];
const icon = <Undo2 className="h-4 w-4" />;

export function SalesReturnsPage() { return <ReturnsPage cfg={CFG.sales} />; }
export function PurchaseReturnsPage() { return <ReturnsPage cfg={CFG.purchase} />; }

function ReturnsPage({ cfg }: { cfg: Cfg }) {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";
  const sourceId = params.get(cfg.sourceParam);
  const allowed = cfg.viewPerms.some((p) => can(p));
  const list = useEntityList<Row>({
    table: cfg.table, select: cfg.listSelect, companyId, search: q, searchColumns: ["doc_no", "reason"],
    filters: { status: FILTERS[f].status }, orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: allowed,
  });
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const party = (r: Row) => (cfg.kind === "sales" ? r.customer : r.supplier) as { name: string; code: string } | null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={cfg.title} icon={icon} description={cfg.description}
        actions={can(cfg.perm) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New return</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search return no. / reason…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={list.data?.rows ?? []} onView={(r) => update({ view: r.id, new: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "Return", width: "130px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "d", header: "Date", width: "105px", cell: (r) => formatDate(r.return_date as string) },
              { key: "p", header: cfg.partyLabel, cell: (r) => { const c = party(r); return c ? <span>{c.name} <span className="text-2xs text-ink-faint">{c.code}</span></span> : null; } },
              { key: "src", header: cfg.sourceLabel, width: "140px", hideBelow: "md", cell: (r) => <span className="font-mono text-xs">{(r.src as { doc_no: string } | null)?.doc_no}</span> },
              { key: "q", header: "Qty", width: "80px", cell: (r) => <span className="tabular-nums">{qtyFmt((r.lines as { quantity: number }[]).reduce((a, l) => a + Number(l.quantity), 0))}</span> },
              { key: "r", header: "Reason", hideBelow: "lg", cell: (r) => <span className="text-xs text-ink-muted">{String(r.reason ?? "")}</span> },
              { key: "s", header: "Status", width: "110px", cell: (r) => <Badge tone={TONE[String(r.status)]}>{statusLabel(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No returns" description={cfg.emptyText} />}
          />
        )}
      </Card>
      {creating && <NewReturnDialog cfg={cfg} initialSource={sourceId} onClose={() => update({ new: null, [cfg.sourceParam]: null })}
        onSaved={(id) => update({ new: null, [cfg.sourceParam]: null, view: id })} />}
      {viewId && !creating && <ReturnView key={viewId} cfg={cfg} id={viewId} onClose={() => update({ view: null })} />}
    </div>
  );
}

/* ---------------------------------------------------------------- new return */
interface SrcLine {
  id: string; line_no: number; product_name: string; variant_name: string | null; sku: string | null; uom: string | null;
  warehouse_id?: string; warehouse_name?: string; done: number; billedOrInvoiced: number; returned: number; returnable: number; on_hand?: number;
}
function useSourceLines(cfg: Cfg, sourceId: string | null) {
  return useQuery({
    queryKey: ["returnable", cfg.kind, sourceId],
    enabled: !!sourceId,
    queryFn: async (): Promise<SrcLine[]> => {
      if (cfg.kind === "sales") {
        const { data, error } = await sb().rpc("returnable_gdn_lines", { p_gdn_id: sourceId });
        if (error) throw error;
        return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: String(r.gdn_line_id), line_no: Number(r.line_no), product_name: String(r.product_name), variant_name: (r.variant_name as string) ?? null, sku: (r.sku as string) ?? null,
          uom: (r.uom as string) ?? null, warehouse_id: String(r.warehouse_id), warehouse_name: String(r.warehouse_name), done: Number(r.dispatched), billedOrInvoiced: Number(r.invoiced),
          returned: Number(r.returned), returnable: Number(r.returnable),
        }));
      }
      const { data, error } = await sb().rpc("returnable_receipt_lines", { p_receipt_id: sourceId });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.receipt_line_id), line_no: Number(r.line_no), product_name: String(r.product_name), variant_name: (r.variant_name as string) ?? null, sku: (r.sku as string) ?? null,
        uom: (r.uom as string) ?? null, done: Number(r.received), billedOrInvoiced: Number(r.billed), returned: Number(r.returned), returnable: Number(r.returnable), on_hand: Number(r.on_hand),
      }));
    },
  });
}

function useSourceOptions(cfg: Cfg) {
  const { companyId } = useAccess();
  const toOption = (r: Record<string, unknown>): SelectOption => {
    const party = (cfg.kind === "sales" ? r.customer : r.supplier) as { name: string } | null;
    return { value: String(r.id), label: `${r.doc_no} · ${party?.name ?? ""}`, secondary: formatDate((cfg.kind === "sales" ? r.gdn_date : r.doc_date) as string) };
  };
  const base = () => cfg.kind === "sales"
    ? sb().from("gdns").select("id, doc_no, gdn_date, customer:customers(name)").eq("company_id", companyId!).eq("status", "POSTED")
    : sb().from("goods_receipts").select("id, doc_no, doc_date, supplier:suppliers(name)").eq("company_id", companyId!).eq("status", "POSTED").not("supplier_id", "is", null);
  const loadOptions = async (s: string) => {
    let qq = base();
    if (s.trim()) qq = qq.ilike("doc_no", `%${s.trim()}%`);
    const { data, error } = await qq.order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toOption);
  };
  const resolveOption = async (id: string) => {
    const { data } = await base().eq("id", id).maybeSingle();
    return data ? toOption(data as Record<string, unknown>) : null;
  };
  return { loadOptions, resolveOption };
}

function NewReturnDialog({ cfg, initialSource, onClose, onSaved }: { cfg: Cfg; initialSource: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const [source, setSource] = React.useState<string | null>(initialSource);
  const [date, setDate] = React.useState(today());
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [wh, setWh] = React.useState<Record<string, string>>({});
  const [cond, setCond] = React.useState<Record<string, "GOOD" | "DAMAGED">>({});
  const [ask, setAsk] = React.useState(false);
  const key = React.useRef(crypto.randomUUID());
  const lines = useSourceLines(cfg, source);
  const opts = useSourceOptions(cfg);
  const warehouses = useWarehouses();
  React.useEffect(() => { setQty({}); setWh({}); setCond({}); }, [source]);

  const rows = lines.data ?? [];
  const entered = rows.filter((l) => n(qty[l.id]) > 0);
  const total = entered.reduce((a, l) => a + n(qty[l.id]), 0);
  const errors = rows.filter((l) => n(qty[l.id]) > l.returnable + 1e-9 || n(qty[l.id]) < 0 || (cfg.kind === "purchase" && n(qty[l.id]) > (l.on_hand ?? 0) + 1e-9));

  const save = useMutation({
    mutationFn: async () => {
      const header = cfg.kind === "sales" ? { gdn_id: source, return_date: date, reason, notes } : { receipt_id: source, return_date: date, reason, notes };
      const payload = entered.map((l) => cfg.kind === "sales"
        ? { gdn_line_id: l.id, quantity: n(qty[l.id]), warehouse_id: wh[l.id] || l.warehouse_id, condition: cond[l.id] ?? "GOOD" }
        : { receipt_line_id: l.id, quantity: n(qty[l.id]) });
      const r = await sb().rpc(cfg.kind === "sales" ? "post_sales_return" : "post_purchase_return", { p_header: header, p_lines: payload, p_idempotency_key: key.current });
      if (r.error) throw r.error;
      return r.data as string;
    },
    onSuccess: (id) => {
      toast.success(cfg.kind === "sales" ? "Return recorded — stock is back in the warehouse" : "Return recorded — stock has left the warehouse");
      qc.invalidateQueries(); onSaved(id);
    },
    onError: (e) => { setAsk(false); toast.error(friendlyError(e)); },
  });
  const trySave = () => {
    if (!source) return toast.error(`Choose the ${cfg.sourceLabel}`);
    if (!entered.length) return toast.error("Enter the quantity returned for at least one item");
    if (errors.length) return toast.error("Some quantities are more than can be returned");
    if (!reason.trim()) return toast.error("Enter the reason for the return");
    setAsk(true);
  };
  const td = "border-b border-line/70 px-3 py-2 align-middle";
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="return" icon={icon}
        title={cfg.kind === "sales" ? "New customer return" : "New return to supplier"}
        subtitle={cfg.kind === "sales" ? "Goods coming back into the warehouse" : "Goods leaving the warehouse back to the supplier"}
        footer={<>
          <div className="flex-1 text-xs text-ink-muted">{entered.length ? `${entered.length} item(s), ${qtyFmt(total)} in total` : ""}</div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Undo2 className="h-3.5 w-3.5" />} loading={save.isPending} onClick={trySave}>Record return</Button>
        </>}>
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label={cfg.sourceLabel} required className="md:col-span-2">
            <SearchableSelect value={source} onChange={(v) => setSource(v)} loadOptions={opts.loadOptions} resolveOption={opts.resolveOption}
              placeholder={cfg.kind === "sales" ? "Search GDN no. …" : "Search GRN no. …"} />
          </Field>
          <Field label="Return date" required><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
          <div />
          <Field label="Reason" required className="md:col-span-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are the goods coming back?" />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {cfg.reasons.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className={cn("rounded-full border px-2 py-0.5 text-2xs", reason === r ? "border-primary bg-primary/10 text-primary" : "border-line text-ink-muted hover:text-ink")}>{r}</button>
              ))}
            </div>
          </Field>
          <Field label="Notes" className="md:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Vehicle, who brought it back, condition…" /></Field>
        </div>
        {!source ? <EmptyState icon={<PackageX className="h-6 w-6" />} title={`Choose the ${cfg.sourceLabel}`} description={cfg.kind === "sales" ? "The items dispatched on it are listed here." : "The items received on it are listed here."} />
          : lines.isLoading ? <Skeleton className="h-40" /> : lines.error ? <p className="text-sm text-danger">{friendlyError(lines.error)}</p> : (
          <div className="overflow-auto rounded-card border border-line">
            <div className="flex items-center justify-between border-b border-line bg-subtle px-3 py-1.5">
              <span className="text-xs text-ink-muted">Enter the quantity coming back for each item (leave blank if none).</span>
              <Button size="sm" variant="ghost" onClick={() => setQty(Object.fromEntries(rows.map((l) => [l.id, String(cfg.kind === "purchase" ? Math.min(l.returnable, l.on_hand ?? 0) : l.returnable)])))}>Return everything</Button>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <th className="h-8 px-3">#</th><th className="px-3">Item</th>
                <th className="px-3 text-right">{cfg.kind === "sales" ? "Dispatched" : "Received"}</th>
                <th className="px-3 text-right">{cfg.kind === "sales" ? "Invoiced" : "Billed"}</th>
                <th className="px-3 text-right">Already returned</th>
                {cfg.kind === "purchase" && <th className="px-3 text-right">In stock now</th>}
                <th className="px-3 text-right">Return qty</th>
                {cfg.kind === "sales" && <><th className="px-3">Back into</th><th className="px-3">Condition</th></>}
              </tr></thead>
              <tbody>
                {rows.map((l) => {
                  const bad = errors.includes(l);
                  return (
                    <tr key={l.id} className={cn(l.returnable <= 0 && "opacity-50")}>
                      <td className={cn(td, "w-8 text-ink-faint")}>{l.line_no}</td>
                      <td className={td}><div className="font-medium">{l.product_name}{l.variant_name && <span className="font-normal text-ink-muted"> · {l.variant_name}</span>}</div>
                        <div className="text-2xs text-ink-muted">{l.sku}{l.warehouse_name ? ` · from ${l.warehouse_name}` : ""}</div></td>
                      <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.done)} <span className="text-2xs text-ink-faint">{l.uom}</span></td>
                      <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{qtyFmt(l.billedOrInvoiced)}</td>
                      <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{qtyFmt(l.returned)}</td>
                      {cfg.kind === "purchase" && <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{qtyFmt(l.on_hand)}</td>}
                      <td className={cn(td, "w-32 text-right")}>
                        <Input inputMode="decimal" className={cn("h-control-sm text-right", bad && "border-danger")} disabled={l.returnable <= 0} value={qty[l.id] ?? ""}
                          placeholder={l.returnable > 0 ? `max ${qtyFmt(l.returnable)}` : "—"} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))} />
                      </td>
                      {cfg.kind === "sales" && <>
                        <td className={cn(td, "w-44")}>
                          <select className="h-control-sm w-full rounded-control border border-line bg-surface px-2 text-xs" value={wh[l.id] ?? l.warehouse_id}
                            onChange={(e) => setWh((s) => ({ ...s, [l.id]: e.target.value }))}>
                            {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                          </select>
                        </td>
                        <td className={cn(td, "w-32")}>
                          <select className="h-control-sm w-full rounded-control border border-line bg-surface px-2 text-xs" value={cond[l.id] ?? "GOOD"}
                            onChange={(e) => setCond((s) => ({ ...s, [l.id]: e.target.value as "GOOD" | "DAMAGED" }))}>
                            <option value="GOOD">Good</option><option value="DAMAGED">Damaged</option>
                          </select>
                        </td>
                      </>}
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-xs text-ink-muted">No items on this document.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {cfg.kind === "sales" && Object.values(cond).includes("DAMAGED") && (
          <p className="mt-2 text-xs text-warning-ink">Damaged goods still come back into stock (so the count stays right). If they cannot be sold, write them off with Inventory → Adjustments → reason “Damage”.</p>
        )}
      </ErpDialog>
      <ConfirmDialog open={ask} title="Record this return?" confirmLabel="Record return" loading={save.isPending} onCancel={() => setAsk(false)} onConfirm={() => save.mutate()}
        message={cfg.kind === "sales"
          ? `${qtyFmt(total)} unit(s) come back into stock now. Anything already invoiced gets a credit note to the customer automatically.`
          : `${qtyFmt(total)} unit(s) leave the warehouse now. Anything already billed by the supplier gets a debit note automatically.`} />
    </>
  );
}

/* ---------------------------------------------------------------- view */
function ReturnView({ cfg, id, onClose }: { cfg: Cfg; id: string; onClose: () => void }) {
  const { can, company } = useAccess();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState("lines");
  const [ask, setAsk] = React.useState(false);
  const [why, setWhy] = React.useState("");
  const doc = useQuery({
    queryKey: ["record", cfg.table, id],
    queryFn: async () => {
      const head = cfg.kind === "sales"
        ? "id, doc_no, return_date, status, reason, notes, gdn_id, credit_entry_id, posted_at, reversed_at, reversal_reason, party:customers(name, code, city), src:gdns(doc_no)"
        : "id, doc_no, return_date, status, reason, notes, receipt_id, debit_entry_ids, posted_at, reversed_at, reversal_reason, party:suppliers(name, code, city), src:goods_receipts(doc_no), warehouse:warehouses(code, name)";
      const lineSel = cfg.kind === "sales"
        ? "id, line_no, quantity, condition, open_qty, credit_qty, notes, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name), warehouse:warehouses(code, name)"
        : "id, line_no, quantity, unbilled_qty, billed_qty, notes, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)";
      const [h, l, a] = await Promise.all([
        sb().from(cfg.table).select(head).eq("id", id).single(),
        sb().from(cfg.lineTable).select(lineSel).eq("return_id", id).order("line_no"),
        sb().rpc("return_amounts", { p_kind: cfg.kind === "sales" ? "SALES" : "PURCHASE", p_id: id }),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      const amounts = new Map(((a.data ?? []) as { line_id: string; unit_amount: number | null; amount: number | null; total: number }[]).map((x) => [x.line_id, x]));
      return { h: h.data as unknown as Record<string, unknown>, lines: (l.data ?? []) as unknown as Record<string, unknown>[], amounts,
        total: ((a.data ?? []) as { total: number }[])[0]?.total ?? null, seeAmounts: !a.error && (a.data ?? []).length > 0 };
    },
  });
  const rev = useMutation({
    mutationFn: async () => {
      const r = await sb().rpc(cfg.kind === "sales" ? "reverse_sales_return" : "reverse_purchase_return", { p_id: id, p_reason: why.trim() });
      if (r.error) throw r.error;
    },
    onSuccess: () => { toast.success("Return reversed"); setAsk(false); setWhy(""); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const h = doc.data?.h;
  const party = h?.party as { name: string; code: string; city: string | null } | null | undefined;
  const src = h?.src as { doc_no: string } | null | undefined;
  const status = String(h?.status ?? "");
  const lines = doc.data?.lines ?? [];
  const label = (l: Record<string, unknown>) => { const p = l.product as { name: string }; const v = l.variant as { name: string } | null; return `${p.name}${v ? ` · ${v.name}` : ""}`; };
  const print = () => {
    if (!h) return;
    const ok = printDocument({
      company: company?.company_name ?? "", title: cfg.kind === "sales" ? "Goods Return Note (from customer)" : "Goods Return Note (to supplier)", docNo: String(h.doc_no),
      meta: [[cfg.partyLabel, `${party?.name ?? ""}${party?.city ? `, ${party.city}` : ""}`], ["Date", formatDate(h.return_date as string)], [cfg.sourceLabel, src?.doc_no ?? ""], ["Reason", String(h.reason ?? "")]],
      columns: cfg.kind === "sales" ? [{ label: "#" }, { label: "Item" }, { label: "Into" }, { label: "Condition" }, { label: "Quantity", align: "right" }]
        : [{ label: "#" }, { label: "Item" }, { label: "Quantity", align: "right" }],
      rows: lines.map((l, i) => {
        const q = `${qtyFmt(l.quantity)} ${(l.product as { uom: { code: string } | null }).uom?.code ?? ""}`;
        return cfg.kind === "sales" ? [String(i + 1), label(l), (l.warehouse as { code: string }).code, l.condition === "DAMAGED" ? "Damaged" : "Good", q] : [String(i + 1), label(l), q];
      }),
      notes: (h.notes as string) ?? null,
      signatures: cfg.kind === "sales" ? ["Received by (warehouse)", "Returned by (customer / driver)", "Checked by"] : ["Dispatched by (warehouse)", "Received by (supplier / transporter)", "Approved by"],
    });
    if (!ok) toast.error("Allow pop-ups to print");
  };
  const td = "border-b border-line/70 px-3 py-2 align-top";
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="return" icon={icon} title={h ? String(h.doc_no) : cfg.title}
        subtitle={party ? `${party.name}${party.city ? ` · ${party.city}` : ""}` : undefined}
        status={h ? <Badge tone={TONE[status]}>{statusLabel(status)}</Badge> : null}
        footer={<>
          {status === "POSTED" && can(cfg.perm) && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAsk(true)}>Reverse</Button>}
          <div className="flex-1" />
          {h && src && <Button icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => navigate(cfg.kind === "sales" ? `/gdn?view=${h.gdn_id}` : `/goods-receipts?view=${h.receipt_id}`)}>{src.doc_no}</Button>}
          {h && <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>}
          <Button onClick={onClose}>Close</Button>
        </>}>
        {doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : h && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <KeyValue label={cfg.partyLabel}>{party?.name ?? null}</KeyValue>
              <KeyValue label="Date">{formatDate(h.return_date as string)}</KeyValue>
              <KeyValue label={cfg.sourceLabel}>{src?.doc_no ?? null}</KeyValue>
              <KeyValue label="Reason">{String(h.reason ?? "")}</KeyValue>
              <KeyValue label="Recorded">{formatDateTime(h.posted_at as string)}</KeyValue>
              {cfg.kind === "purchase" && <KeyValue label="From warehouse">{(h.warehouse as { name: string } | null)?.name ?? null}</KeyValue>}
              {doc.data?.seeAmounts && <KeyValue label={cfg.kind === "sales" ? "Credit note to customer" : "Stock value returned"}>{money(doc.data.total)}</KeyValue>}
              {h.reversal_reason ? <KeyValue label="Reversal reason" className="col-span-2">{String(h.reversal_reason)}</KeyValue> : null}
              {h.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-5">{String(h.notes)}</KeyValue> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: "lines", label: `Items (${lines.length})` }, { key: "moves", label: "Stock movements" }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : []),
            ]} />
            {tab === "history" && <AuditTimeline table={cfg.table} id={id} />}
            {tab === "moves" && <MovementsTable sourceId={id} />}
            {tab === "lines" && (
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">#</th><th className="px-3">Item</th>
                    {cfg.kind === "sales" && <><th className="px-3">Into</th><th className="px-3">Condition</th></>}
                    <th className="px-3 text-right">Quantity</th>
                    <th className="px-3 text-right">{cfg.kind === "sales" ? "Not yet invoiced" : "Before billing"}</th>
                    <th className="px-3 text-right">{cfg.kind === "sales" ? "Credited" : "After billing"}</th>
                    {doc.data?.seeAmounts && <th className="px-3 text-right">{cfg.kind === "sales" ? "Credit" : "Value"}</th>}
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const a = doc.data?.amounts.get(String(l.id));
                      const p = l.product as { sku: string; uom: { code: string } | null };
                      return (
                        <tr key={String(l.id)}>
                          <td className={cn(td, "w-8 text-ink-faint")}>{String(l.line_no)}</td>
                          <td className={td}><div className="font-medium">{label(l)}</div><div className="text-2xs text-ink-muted">{p.sku}</div></td>
                          {cfg.kind === "sales" && <>
                            <td className={cn(td, "text-xs")}>{(l.warehouse as { name: string }).name}</td>
                            <td className={td}>{l.condition === "DAMAGED" ? <Badge tone="warning">Damaged</Badge> : <Badge tone="neutral">Good</Badge>}</td>
                          </>}
                          <td className={cn(td, "text-right font-medium tabular-nums")}>{qtyFmt(l.quantity)} <span className="text-2xs font-normal text-ink-faint">{p.uom?.code}</span></td>
                          <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{qtyFmt(cfg.kind === "sales" ? l.open_qty : l.unbilled_qty)}</td>
                          <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{qtyFmt(cfg.kind === "sales" ? l.credit_qty : l.billed_qty)}</td>
                          {doc.data?.seeAmounts && <td className={cn(td, "text-right tabular-nums")}>{a?.amount == null ? <span className="text-ink-faint">cost pending</span> : money(a.amount)}</td>}
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
      <ConfirmDialog open={ask} tone="destructive" title={`Reverse ${h?.doc_no ?? ""}?`} confirmLabel="Reverse" cancelLabel="Keep" loading={rev.isPending}
        message={cfg.kind === "sales" ? "The goods leave stock again and any credit note is cancelled. Use this only if the return was entered by mistake."
          : "The goods come back into stock and any debit note is cancelled. Use this only if the return was entered by mistake."}
        onCancel={() => { setAsk(false); setWhy(""); }} onConfirm={() => (why.trim() ? rev.mutate() : toast.error("Enter a reason"))}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}
