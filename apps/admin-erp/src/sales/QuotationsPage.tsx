import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, ExternalLink, FileSignature, Pencil, Plus, Printer, Save, Send, ShieldAlert, ShoppingCart, Trash2, Undo2, XCircle } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { CustomerPicker, ProductPicker, VariantPicker, useProductMeta } from "../inventory/pickers";
import { money, today } from "../accounting/common";
import { DiscountField, n, qtyFmt, useLastPrice } from "./common";
import { SalesOrderForm, type SoInitial } from "./SalesOrderForm";
import { printDocument } from "./print";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import { ReportShortcuts } from "../reports/Shortcuts";

type Row = Record<string, unknown> & { id: string };
const Q_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "warning", SENT: "info", ACCEPTED: "success", REJECTED: "danger", CANCELLED: "neutral", CONVERTED: "success",
};
const qLabel = (s: string) => (s === "CONVERTED" ? "Ordered" : s.charAt(0) + s.slice(1).toLowerCase());
const isExpired = (r: Record<string, unknown>) => !!r.valid_until && String(r.valid_until) < today() && ["DRAFT", "SENT"].includes(String(r.status));
const FILTERS = [
  { label: "Open", statuses: ["DRAFT", "SENT", "ACCEPTED"] },
  { label: "Drafts", status: "DRAFT" },
  { label: "Sent", status: "SENT" },
  { label: "Accepted", status: "ACCEPTED" },
  { label: "Ordered", status: "CONVERTED" },
  { label: "Rejected / cancelled", statuses: ["REJECTED", "CANCELLED"] },
  { label: "All" },
] as { label: string; status?: string; statuses?: string[] }[];
const icon = <FileSignature className="h-4 w-4" />;
const DEFAULT_TERMS = "Prices are in PKR. Delivery from our Okara warehouse. Payment as agreed.";

export function QuotationsPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";
  const allowed = can(P.salesView) && can(P.salesViewPrices);
  const list = useEntityList<Row>({
    table: "quotations",
    select: "id, doc_no, quote_date, valid_until, status, total_amount, customer_reference, customer:customers(name, code)",
    companyId, search: q, searchColumns: ["doc_no", "customer_reference"],
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: allowed,
  });
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) => !FILTERS[f].statuses || FILTERS[f].statuses!.includes(String(r.status)));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Quotations" icon={icon} description="Offer prices to a customer, print or send it, then turn an accepted quotation into a sales order."
        actions={can(P.salesManage) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New Quotation</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search quotation no. / customer ref…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "Quotation", width: "130px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "d", header: "Date", width: "105px", cell: (r) => formatDate(r.quote_date as string) },
              { key: "c", header: "Customer", cell: (r) => { const c = r.customer as { name: string; code: string }; return <span>{c.name} <span className="text-2xs text-ink-faint">{c.code}</span></span>; } },
              { key: "v", header: "Valid until", width: "110px", hideBelow: "md", cell: (r) => r.valid_until ? <span className={cn(isExpired(r) && "text-danger")}>{formatDate(r.valid_until as string)}</span> : null },
              { key: "t", header: "Total", align: "right", width: "130px", cell: (r) => <span className="tabular-nums">{money(r.total_amount as number)}</span> },
              { key: "s", header: "Status", width: "120px", cell: (r) => <Badge tone={isExpired(r) ? "danger" : Q_TONE[String(r.status)]}>{isExpired(r) ? "Expired" : qLabel(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={icon} title="No quotations" description="Create one with “New Quotation”." />} />
        )}
      </Card>
      {(viewId || creating) && <QuotationDialog id={viewId} onClose={() => update({ view: null, new: null })} onSaved={(id) => update({ view: id, new: null })} />}
    </div>
  );
}

interface QLine { id: string; line_no: number; product_id: string; variant_id: string | null; quantity: number; unit_price: number; description: string | null;
  product: { name: string; sku: string; uom: { code: string } | null }; variant: { name: string } | null }
function useQuotation(id: string | null) {
  return useQuery({
    queryKey: ["record", "quotations", id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from("quotations").select("*, customer:customers(name, code, city), so:sales_orders!quotations_sales_order_id_fkey(id, doc_no)").eq("id", id!).single(),
        sb().from("quotation_lines").select("id, line_no, product_id, variant_id, quantity, unit_price, description, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)")
          .eq("quotation_id", id!).eq("is_active", true).order("line_no"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      return { header: h.data as unknown as Row, lines: (l.data ?? []) as unknown as QLine[] };
    },
  });
}

function QuotationDialog({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const doc = useQuotation(id);
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<"view" | "edit" | "convert">(id ? "view" : "edit");
  if (mode === "edit" && (!id || doc.data)) {
    return <QuotationForm id={id} data={doc.data ?? null} onCancel={() => (id ? setMode("view") : onClose())} onClose={onClose} onSaved={(nid) => { setMode("view"); onSaved(nid); }} />;
  }
  if (mode === "convert" && doc.data) {
    const h = doc.data.header;
    const initial: SoInitial = {
      header: { customer_id: h.customer_id, order_date: today(), customer_reference: h.customer_reference, notes: h.notes },
      lines: doc.data.lines.map((l) => ({ id: null, want: Number(l.quantity), product_id: l.product_id, variant_id: l.variant_id, unit_price: Number(l.unit_price), notes: l.description, allocations: [] })),
    };
    return <SalesOrderForm id={null} initial={initial} quotationId={id!} onCancel={() => setMode("view")} onClose={onClose}
      onSaved={(soId) => { onClose(); navigate(`/sales-orders?view=${soId}`); }} />;
  }
  return <QuotationView id={id!} doc={doc} onEdit={() => setMode("edit")} onConvert={() => setMode("convert")} onClose={onClose} />;
}

interface FLine { key: string; product_id: string | null; variant_id: string | null; quantity: string; unit_price: string; description: string }
const newFLine = (): FLine => ({ key: crypto.randomUUID(), product_id: null, variant_id: null, quantity: "", unit_price: "", description: "" });

function QuotationForm({ id, data, onCancel, onClose, onSaved }: { id: string | null; data: ReturnType<typeof useQuotation>["data"] | null; onCancel: () => void; onClose: () => void; onSaved: (id: string) => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const idem = React.useRef(crypto.randomUUID());
  const h = data?.header;
  const init = React.useMemo(() => ({
    customer_id: ((h?.customer_id as string | undefined) ?? null) as string | null,
    quote_date: (h?.quote_date as string | undefined) ?? today(),
    valid_until: (h?.valid_until as string | undefined) ?? new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    customer_reference: (h?.customer_reference as string | undefined) ?? "",
    terms: (h?.terms as string | undefined) ?? (h ? "" : DEFAULT_TERMS),
    notes: (h?.notes as string | undefined) ?? "",
    discount: h && Number(h.discount_amount) ? String(Number(h.discount_amount)) : "",
    lines: data?.lines.length ? data.lines.map((l) => ({ key: l.id, product_id: l.product_id, variant_id: l.variant_id, quantity: String(Number(l.quantity)), unit_price: String(Number(l.unit_price)), description: l.description ?? "" })) : [newFLine()],
  }), [data, h]);
  const [f, setF] = React.useState(init);
  const snapshot = React.useRef(JSON.stringify(init));
  const dirty = JSON.stringify(f) !== snapshot.current;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const [showErrors, setShowErrors] = React.useState(false);
  const setLine = (key: string, p: Partial<FLine>) => setF((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }));
  const used = f.lines.filter((l) => l.product_id || l.quantity.trim() || l.unit_price.trim());
  const errors: Record<string, string> = {};
  if (!f.customer_id) errors.customer = "Choose the customer";
  if (!used.length) errors.lines = "Add at least one item";
  for (const l of used) {
    if (!l.product_id) errors[`${l.key}.p`] = "Choose the item";
    if (!(n(l.quantity) > 0)) errors[`${l.key}.q`] = "Quantity";
    if (l.unit_price.trim() === "" || !(n(l.unit_price) >= 0)) errors[`${l.key}.price`] = "Price";
  }
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const subtotal = used.reduce((a, l) => a + Math.round(n(l.quantity) * n(l.unit_price) * 100) / 100, 0);
  const total = subtotal - (n(f.discount) || 0);
  const save = useMutation({
    mutationFn: async () => {
      const { data: nid, error } = await sb().rpc("save_quotation", {
        p_id: id,
        p_header: { company_id: companyId, customer_id: f.customer_id, quote_date: f.quote_date, valid_until: f.valid_until || null, customer_reference: f.customer_reference, terms: f.terms, notes: f.notes, discount_amount: f.discount.replace(/,/g, "") || "0" },
        p_lines: used.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity.replace(/,/g, ""), unit_price: l.unit_price.replace(/,/g, ""), description: l.description || null })),
        p_idempotency_key: id ? null : idem.current,
      });
      if (error) throw error;
      return nid as string;
    },
    onSuccess: (nid) => { snapshot.current = JSON.stringify(f); idem.current = crypto.randomUUID(); toast.success("Quotation saved"); qc.invalidateQueries(); onSaved(nid); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const submit = () => {
    setShowErrors(true);
    if (Object.keys(errors).length) { toast.error("Please fix the highlighted fields"); return; }
    if (!save.isPending) save.mutate();
  };
  return (
    <>
      <ErpDialog open onRequestClose={() => guard(onClose)} size="full" accent="quote" icon={icon} title={id ? `Edit ${String(h?.doc_no ?? "")}` : "New Quotation"}
        headerActions={<ReportShortcuts voucher="QUOTATION" context={{ CUSTOMER: f.customer_id }} />}
        footer={
          <>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1 text-right text-sm text-ink-muted">Total <b className="ml-1 text-lg tabular-nums text-ink">{money(total)}</b></div>
            <Button onClick={() => guard(onCancel)}>Cancel</Button>
            <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={submit}>Save</Button>
          </>
        }>
        <FormGrid cols={4}>
          <Field label="Customer" required error={err("customer")} className="sm:col-span-2"><CustomerPicker value={f.customer_id} onChange={(v) => setF((s) => ({ ...s, customer_id: v }))} /></Field>
          <Field label="Date" required><Input type="date" value={f.quote_date} onChange={(e) => setF((s) => ({ ...s, quote_date: e.target.value }))} /></Field>
          <Field label="Valid until"><Input type="date" value={f.valid_until} onChange={(e) => setF((s) => ({ ...s, valid_until: e.target.value }))} /></Field>
        </FormGrid>
        {err("lines") && <p className="mb-2 text-xs text-danger">{err("lines")}</p>}
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="sticky top-0 z-[1]"><tr className="bg-violet-50/70 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-9 w-10 px-2 text-center">#</th><th className="px-2">Item</th><th className="w-[130px] px-2 text-right">Qty</th>
              <th className="w-[150px] px-2 text-right">Unit price</th><th className="w-[140px] px-2 text-right">Amount</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {f.lines.map((l, i) => (
                <QFormLine key={l.key} idx={i} line={l} customerId={f.customer_id} err={err} onChange={(p) => setLine(l.key, p)}
                  onRemove={f.lines.length > 1 ? () => setF((s) => ({ ...s, lines: s.lines.filter((x) => x.key !== l.key) })) : undefined} />
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setF((s) => ({ ...s, lines: [...s.lines, newFLine()] }))}>Add item</Button>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <Field label="Customer's reference / enquiry"><Input value={f.customer_reference} onChange={(e) => setF((s) => ({ ...s, customer_reference: e.target.value }))} /></Field>
            <Field label="Terms (printed)"><Textarea rows={2} value={f.terms} onChange={(e) => setF((s) => ({ ...s, terms: e.target.value }))} /></Field>
            <Field label="Notes (printed)"><Textarea rows={2} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></Field>
          </div>
          <dl className="space-y-1.5 self-start rounded-card bg-subtle p-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Discount</dt>
              <dd><DiscountField base={subtotal} value={f.discount} onChange={(v) => setF((s) => ({ ...s, discount: v }))} /></dd></div>
            <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
          </dl>
        </div>
      </ErpDialog>
      {dialog}
    </>
  );
}

function QFormLine({ idx, line, customerId, err, onChange, onRemove }: {
  idx: number; line: FLine; customerId: string | null; err: (k: string) => string | undefined; onChange: (p: Partial<FLine>) => void; onRemove?: () => void;
}) {
  const meta = useProductMeta(line.product_id);
  const last = useLastPrice(customerId, line.product_id, line.variant_id);
  // fill in the last price charged to this customer as soon as the item is chosen (only when the price is still empty)
  React.useEffect(() => {
    if (last.data && line.unit_price.trim() === "") onChange({ unit_price: String(Number(last.data.unit_price)) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last.data]);
  const td = "border-b border-line/70 px-2 py-1.5 align-top";
  return (
    <tr className="group bg-white hover:bg-violet-50/30">
      <td className={cn(td, "pt-3 text-center text-2xs text-ink-faint")}>{idx + 1}</td>
      <td className={td}>
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1"><ProductPicker value={line.product_id} onChange={(v) => onChange({ product_id: v, variant_id: null })} invalid={!!err(`${line.key}.p`)} /></div>
          {meta.data?.has_variants && <div className="w-[42%] shrink-0"><VariantPicker productId={line.product_id} value={line.variant_id} onChange={(v) => onChange({ variant_id: v })} /></div>}
        </div>
        <input className="mt-1 w-full bg-transparent text-xs text-ink-muted outline-none placeholder:text-ink-faint" placeholder="Description (optional)" value={line.description} onChange={(e) => onChange({ description: e.target.value })} />
      </td>
      <td className={td}>
        <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0" aria-label="Quantity" value={line.quantity} invalid={!!err(`${line.key}.q`)} onChange={(e) => onChange({ quantity: e.target.value })} />
        {meta.data?.uom && <div className="mt-0.5 text-right text-2xs text-ink-faint">{meta.data.uom}</div>}
      </td>
      <td className={td}>
        <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0.00" aria-label="Unit price" value={line.unit_price} invalid={!!err(`${line.key}.price`)} onChange={(e) => onChange({ unit_price: e.target.value })} />
        {last.data && <button type="button" className="mt-0.5 block w-full text-right text-2xs text-info hover:underline" onClick={() => onChange({ unit_price: String(Number(last.data!.unit_price)) })}>last {money(last.data.unit_price)}{last.data.doc_no ? ` · ${last.data.doc_no}` : ""}</button>}
      </td>
      <td className={cn(td, "pt-2.5 text-right tabular-nums")}>{n(line.quantity) > 0 && line.unit_price.trim() !== "" ? money(n(line.quantity) * n(line.unit_price)) : <span className="text-ink-faint">—</span>}</td>
      <td className={cn(td, "pt-1.5 text-center")}>{onRemove && <Button size="icon-sm" variant="ghost" aria-label="Remove item" className="opacity-50 group-hover:opacity-100" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
    </tr>
  );
}

function QuotationView({ id, doc, onEdit, onConvert, onClose }: { id: string; doc: ReturnType<typeof useQuotation>; onEdit: () => void; onConvert: () => void; onClose: () => void }) {
  const { can, company } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState("lines");
  const files = useAttachments("quotations", id);
  const [ask, setAsk] = React.useState<null | "REJECTED" | "CANCELLED">(null);
  const [reason, setReason] = React.useState("");
  const h = doc.data?.header;
  const status = String(h?.status ?? "");
  const cust = h?.customer as { name: string; code: string; city: string | null } | undefined;
  const so = h?.so as { id: string; doc_no: string } | null | undefined;
  const lines = doc.data?.lines ?? [];
  const canManage = can(P.salesManage);
  const setStatus = useMutation({
    mutationFn: async (s: string) => { const { error } = await sb().rpc("set_quotation_status", { p_id: id, p_status: s, p_reason: reason.trim() || null }); if (error) throw error; return s; },
    onSuccess: (s) => { toast.success(`Quotation marked ${qLabel(s).toLowerCase()}`); setAsk(null); setReason(""); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const print = () => {
    if (!h) return;
    const ok = printDocument({
      company: company?.company_name ?? "", title: "Quotation", docNo: String(h.doc_no),
      meta: [["Customer", `${cust?.name ?? ""}${cust?.city ? `, ${cust.city}` : ""}`], ["Date", formatDate(h.quote_date as string)], ["Valid until", h.valid_until ? formatDate(h.valid_until as string) : ""], ["Your reference", (h.customer_reference as string) ?? ""]],
      columns: [{ label: "#" }, { label: "Item" }, { label: "Qty", align: "right" }, { label: "Price", align: "right" }, { label: "Amount", align: "right" }],
      rows: lines.map((l) => [String(l.line_no), `${l.product.name}${l.variant ? ` · ${l.variant.name}` : ""}${l.description ? ` — ${l.description}` : ""}`, `${qtyFmt(l.quantity)} ${l.product.uom?.code ?? ""}`, money(l.unit_price), money(Number(l.quantity) * Number(l.unit_price))]),
      totals: [["Subtotal", money(h.subtotal as number)], ...(Number(h.discount_amount) ? [["Discount", `-${money(h.discount_amount as number)}`] as [string, string]] : []), ["Total", money(h.total_amount as number)]],
      notes: [h.terms, h.notes].filter(Boolean).join("\n") || null, signatures: ["Prepared by", "Accepted by (customer)"],
    });
    if (!ok) toast.error("Allow pop-ups to print");
  };
  const open = ["DRAFT", "SENT", "ACCEPTED", "REJECTED"].includes(status);
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="quote" icon={icon} title={h ? String(h.doc_no) : "Quotation"} subtitle={cust ? `${cust.name}${cust.city ? ` · ${cust.city}` : ""}` : undefined}
        headerActions={<ReportShortcuts voucher="QUOTATION" context={{ CUSTOMER: h?.customer_id as string | undefined }} />}
        status={h ? <Badge tone={isExpired(h) ? "danger" : Q_TONE[status]}>{isExpired(h) ? "Expired" : qLabel(status)}</Badge> : null}
        footer={
          <>
            {open && canManage && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setAsk("CANCELLED")}>Cancel</Button>}
            {["DRAFT", "SENT", "ACCEPTED"].includes(status) && canManage && <Button variant="destructive-ghost" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setAsk("REJECTED")}>Rejected</Button>}
            {status === "REJECTED" && canManage && <Button icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setStatus.mutate("DRAFT")}>Reopen</Button>}
            <div className="flex-1" />
            {so && <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/sales-orders?view=${so.id}`)}>{so.doc_no}</Button>}
            {h && status !== "CANCELLED" && <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>}
            <Button onClick={onClose}>Close</Button>
            {["DRAFT", "SENT"].includes(status) && canManage && <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
            {status === "DRAFT" && canManage && <Button icon={<Send className="h-3.5 w-3.5" />} onClick={() => setStatus.mutate("SENT")}>Mark sent</Button>}
            {status === "SENT" && canManage && <Button icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setStatus.mutate("ACCEPTED")}>Accepted</Button>}
            {["DRAFT", "SENT", "ACCEPTED"].includes(status) && canManage && <Button variant="primary" icon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={onConvert}>Make sales order</Button>}
          </>
        }>
        {doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : h && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <KeyValue label="Date">{formatDate(h.quote_date as string)}</KeyValue>
              <KeyValue label="Valid until">{h.valid_until ? formatDate(h.valid_until as string) : null}</KeyValue>
              <KeyValue label="Customer ref.">{(h.customer_reference as string) || null}</KeyValue>
              <KeyValue label="Total"><span className="font-semibold tabular-nums">{money(h.total_amount as number)}</span></KeyValue>
              <KeyValue label="Sales order">{so?.doc_no ?? null}</KeyValue>
              {h.status_reason ? <KeyValue label="Reason" className="col-span-2">{String(h.status_reason)}</KeyValue> : null}
              {h.terms ? <KeyValue label="Terms" className="col-span-2 md:col-span-5">{String(h.terms)}</KeyValue> : null}
              {h.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-5">{String(h.notes)}</KeyValue> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.length})` }, { key: "files", label: filesLabel(files.data?.length) }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : [])]} />
            {tab === "history" && <AuditTimeline table="quotations" id={id} />}
            {tab === "files" && <AttachmentsPanel entityType="quotations" entityId={id} />}
            {tab === "lines" && (
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">#</th><th className="px-3">Item</th><th className="px-3 text-right">Qty</th><th className="px-3 text-right">Price</th><th className="px-3 text-right">Amount</th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const td = "border-b border-line/70 px-3 py-2 align-top";
                      return (
                        <tr key={l.id}>
                          <td className={cn(td, "w-8 text-ink-faint")}>{l.line_no}</td>
                          <td className={td}><div className="font-medium">{l.product.name}{l.variant && <span className="font-normal text-ink-muted"> · {l.variant.name}</span>}</div><div className="text-2xs text-ink-muted">{l.description || l.product.sku}</div></td>
                          <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.quantity)} <span className="text-2xs text-ink-faint">{l.product.uom?.code}</span></td>
                          <td className={cn(td, "text-right tabular-nums")}>{money(l.unit_price)}</td>
                          <td className={cn(td, "text-right tabular-nums")}>{money(Number(l.quantity) * Number(l.unit_price))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4} className="px-3 pt-2 text-right text-ink-muted">Subtotal</td><td className="px-3 pt-2 text-right tabular-nums">{money(h.subtotal as number)}</td></tr>
                    {Number(h.discount_amount) > 0 && <tr><td colSpan={4} className="px-3 text-right text-ink-muted">Discount</td><td className="px-3 text-right tabular-nums">-{money(h.discount_amount as number)}</td></tr>}
                    <tr><td colSpan={4} className="px-3 pb-2 text-right font-semibold">Total</td><td className="px-3 pb-2 text-right font-semibold tabular-nums">{money(h.total_amount as number)}</td></tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={!!ask} title={ask === "REJECTED" ? "Customer rejected the quotation?" : `Cancel ${String(h?.doc_no ?? "")}?`} tone="destructive"
        message={ask === "REJECTED" ? "It is kept for history. You can reopen it later." : "It is kept for history and cannot be used again."}
        confirmLabel={ask === "REJECTED" ? "Mark rejected" : "Cancel quotation"} cancelLabel="Back" loading={setStatus.isPending}
        onCancel={() => { setAsk(null); setReason(""); }} onConfirm={() => (reason.trim() ? setStatus.mutate(ask!) : toast.error("Enter a reason"))}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}
