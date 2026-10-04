import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Banknote, BookOpen, CheckCircle2, ExternalLink, FileText, Link2, Lock, Pencil, Plus, Printer, RotateCcw, Save, ShieldAlert, X, Zap } from "lucide-react";
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, SearchableSelect, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { CustomerPicker, ProductPicker, VariantPicker, useProductMeta } from "../inventory/pickers";
import { FEATURES, useFeature } from "../lib/settings";
import { BankPicker, money, num, today } from "../accounting/common";
import { fetchGdnLinePrices, n, qtyFmt, useItemAvailability, useLastPrice, useWarehouses, type Wh } from "./common";
import { autoFill, useOpenReceipts } from "./allocations";
import { printDocument } from "./print";

type Row = Record<string, unknown> & { id: string };
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { DRAFT: "warning", POSTED: "info", CANCELLED: "neutral", REVERSED: "danger" };
const PAY_TONE: Record<string, "success" | "warning" | "danger" | "info"> = { PAID: "success", PART_PAID: "info", UNPAID: "warning" };
const payLabel = (s: string) => (s === "PART_PAID" ? "Part paid" : s === "PAID" ? "Paid" : "Unpaid");
const FILTERS = [
  { label: "Unpaid", status: "POSTED", unpaid: true },
  { label: "Drafts", status: "DRAFT" },
  { label: "Paid", status: "POSTED", paid: true },
  { label: "All posted", status: "POSTED" },
  { label: "Reversed / cancelled", statuses: ["REVERSED", "CANCELLED"] },
  { label: "All" },
] as { label: string; status?: string; statuses?: string[]; unpaid?: boolean; paid?: boolean }[];
const icon = <FileText className="h-4 w-4" />;
const isOverdue = (r: Record<string, unknown>) => !!r.due_date && String(r.due_date) < today() && Number(r.outstanding) > 0;

export function InvoicesPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";
  const gdnParam = params.get("gdn");
  const quickOpen = params.get("quick") === "1";
  const quickFeature = useFeature(FEATURES.quickInvoice);
  const canQuick = quickFeature.enabled && can(P.salesInvoice) && can(P.salesManage) && can(P.salesApprove) && can(P.salesDispatch);
  const allowed = (can(P.salesView) && can(P.salesViewPrices)) || can(P.journalsView);
  const flt = FILTERS[f];

  const list = useEntityList<Row>({
    table: "sales_invoices_v",
    select: "id, doc_no, invoice_date, due_date, customer_name, customer_code, customer_reference, status, total_amount, paid_amount, outstanding, payment_status",
    companyId, search: q, searchColumns: ["doc_no", "customer_name", "customer_reference"],
    filters: { status: flt.status },
    orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: allowed,
  });
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const rows = (list.data?.rows ?? []).filter((r) =>
    (!flt.statuses || flt.statuses.includes(String(r.status))) && (!flt.unpaid || r.payment_status !== "PAID") && (!flt.paid || r.payment_status === "PAID"));
  const outstanding = rows.reduce((a, r) => a + Number(r.outstanding ?? 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Sales Invoices" icon={icon}
        description="Invoices are made from dispatched GDNs — one line per item. Posting puts the amount on the customer's account; receipts are then allocated to invoices."
        actions={can(P.salesInvoice) && (
          <div className="flex gap-2">
            {canQuick && <Button icon={<Zap className="h-4 w-4" />} onClick={() => update({ quick: "1", view: null, new: null })}>Quick invoice</Button>}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New Invoice</Button>
          </div>
        )} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search invoice no. / customer…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
          {(flt.unpaid || flt.status === "POSTED") && rows.length > 0 && <span className="ml-auto text-xs text-ink-muted">Outstanding on this page <b className="tabular-nums text-ink">{money(outstanding)}</b></span>}
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable
            loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null, gdn: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "Invoice", width: "130px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "d", header: "Date", width: "105px", cell: (r) => formatDate(r.invoice_date as string) },
              { key: "c", header: "Customer", cell: (r) => <span>{String(r.customer_name)} <span className="text-2xs text-ink-faint">{String(r.customer_code)}</span></span> },
              { key: "due", header: "Due", width: "105px", hideBelow: "lg", cell: (r) => r.due_date ? <span className={cn(isOverdue(r) && "font-medium text-danger")}>{formatDate(r.due_date as string)}</span> : null },
              { key: "t", header: "Total", align: "right", width: "125px", cell: (r) => <span className="tabular-nums">{money(r.total_amount as number)}</span> },
              { key: "o", header: "Outstanding", align: "right", width: "125px", hideBelow: "md", cell: (r) => r.status === "POSTED" ? <span className={cn("tabular-nums", Number(r.outstanding) > 0 && "font-medium")}>{money(r.outstanding as number)}</span> : null },
              {
                key: "s", header: "Status", width: "130px", cell: (r) => r.status === "POSTED"
                  ? <Badge tone={isOverdue(r) ? "danger" : PAY_TONE[String(r.payment_status)]}>{isOverdue(r) ? "Overdue" : payLabel(String(r.payment_status))}</Badge>
                  : <Badge tone={STATUS_TONE[String(r.status)]}>{String(r.status) === "DRAFT" ? "Draft" : String(r.status).charAt(0) + String(r.status).slice(1).toLowerCase()}</Badge>,
              },
            ]}
            empty={<EmptyState icon={icon} title="No invoices" description="Dispatch goods with a GDN first, then press “New Invoice” (or “Create invoice” on the GDN)." />}
          />
        )}
      </Card>
      {creating && !viewId && <CreateInvoiceDialog presetGdn={gdnParam} onClose={() => update({ new: null, gdn: null })} onCreated={(id) => update({ view: id, new: null, gdn: null })} />}
      {viewId && <InvoiceDialog id={viewId} onClose={() => update({ view: null })} />}
      {quickOpen && !viewId && canQuick && <QuickInvoiceDialog onClose={() => update({ quick: null })} onPosted={(id) => update({ view: id, quick: null })} />}
    </div>
  );
}

/* ---------------------------------------------------------------- create from GDNs */
interface OpenGdn { id: string; doc_no: string; gdn_date: string; so: { doc_no: string } | null; left: number; pending: number }
function CreateInvoiceDialog({ presetGdn, onClose, onCreated }: { presetGdn: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [customer, setCustomer] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [date, setDate] = React.useState(today());
  const preset = useQuery({
    queryKey: ["gdn-customer", presetGdn],
    enabled: !!presetGdn,
    queryFn: async () => {
      const { data, error } = await sb().from("gdns").select("customer_id").eq("id", presetGdn!).single();
      if (error) throw error;
      return data.customer_id as string;
    },
  });
  React.useEffect(() => { if (preset.data) { setCustomer(preset.data); setPicked(new Set([presetGdn!])); } }, [preset.data, presetGdn]);
  const gdns = useQuery({
    queryKey: ["uninvoiced-gdns", customer],
    enabled: !!customer,
    queryFn: async () => {
      const { data, error } = await sb().from("gdns").select("id, doc_no, gdn_date, so:sales_orders(doc_no), lines:gdn_lines(id, quantity, invoiced_qty)")
        .eq("customer_id", customer!).eq("status", "POSTED").order("gdn_date");
      if (error) throw error;
      const pm = await fetchGdnLinePrices((data ?? []).map((g) => g.id as string));
      return ((data ?? []) as unknown as (OpenGdn & { lines: { id: string; quantity: number; invoiced_qty: number }[] })[])
        .map((g) => {
          const open = g.lines.filter((l) => Number(l.quantity) > Number(l.invoiced_qty));
          return { ...g, left: open.reduce((a, l) => a + Number(l.quantity) - Number(l.invoiced_qty), 0), pending: open.filter((l) => (pm.get(l.id) ?? null) == null).length };
        })
        .filter((g) => g.left > 0);
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("create_invoice_from_gdns", { p_company_id: companyId, p_gdn_ids: Array.from(picked), p_invoice_date: date });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { toast.success("Draft invoice created — check prices, then post"); qc.invalidateQueries(); onCreated(id); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <ErpDialog open onRequestClose={onClose} size="lg" accent="invoice" icon={icon} title="New Invoice" subtitle="Choose the customer and the dispatched GDNs to bill"
      footer={
        <>
          <div className="flex-1 text-sm text-ink-muted">{picked.size} GDN{picked.size === 1 ? "" : "s"} selected</div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<FileText className="h-3.5 w-3.5" />} disabled={!picked.size} loading={create.isPending} onClick={() => create.mutate()}>Create draft invoice</Button>
        </>
      }>
      <FormGrid cols={3}>
        <Field label="Customer" required className="sm:col-span-2"><CustomerPicker value={customer} onChange={(v) => { setCustomer(v); setPicked(new Set()); }} /></Field>
        <Field label="Invoice date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </FormGrid>
      {customer && (gdns.isLoading ? <Skeleton className="h-24" /> : gdns.error ? <p className="text-sm text-danger">{friendlyError(gdns.error)}</p> : (
        (gdns.data ?? []).length === 0 ? <p className="rounded-card border border-dashed border-line p-4 text-center text-sm text-ink-muted">Nothing to invoice — this customer has no dispatched goods waiting for an invoice.</p> : (
          <>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-ink-muted">Goods not yet invoiced. Items from several GDNs are combined into one line per item and price.</span>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(gdns.data!.map((g) => g.id)))}>Select all</Button>
            </div>
            <div className="divide-y divide-line rounded-card border border-line">
              {gdns.data!.map((g) => (
                <div key={g.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox checked={picked.has(g.id)} onChange={(v) => toggle(g.id, v)} label={<span className="font-mono text-xs font-medium">{g.doc_no}</span>}
                    description={`${formatDate(g.gdn_date)} · ${g.so?.doc_no ?? ""}`} />
                  <div className="flex-1" />
                  <span className="text-xs tabular-nums text-ink-muted">{qtyFmt(g.left)} to bill</span>
                  {g.pending > 0 && <Badge tone="warning">{g.pending} price pending</Badge>}
                </div>
              ))}
            </div>
          </>
        )
      ))}
    </ErpDialog>
  );
}

/* ---------------------------------------------------------------- invoice */
interface InvLine {
  key: string; line_no: number; product_id: string; variant_id: string | null; name: string; sku: string; uom: string; variant: string | null;
  quantity: number; unit_price: number | null; description: string | null; gdnLineIds: string[]; approved_price?: number | null;
}
interface DraftLine { product_id: string; variant_id: string | null; quantity: number; unit_price: number | null; approved_price?: number | string | null; description: string | null; sources: { gdn_line_id: string; qty: number }[] }

function useInvoice(id: string) {
  return useQuery({
    queryKey: ["record", "sales_invoices", id],
    queryFn: async () => {
      const [h, v, l] = await Promise.all([
        sb().from("sales_invoices").select("id, doc_no, invoice_date, due_date, customer_id, customer_reference, status, notes, lines_draft, subtotal, discount_amount, total_amount, journal_entry_id, posted_at, reversed_at, reversal_reason, carry_receipts, is_quick, corrects_invoice_id, customer:customers(name, code, city)").eq("id", id).single(),
        sb().from("sales_invoices_v").select("paid_amount, outstanding, payment_status").eq("id", id).maybeSingle(),
        sb().from("sales_invoice_lines").select("id, line_no, product_id, variant_id, description, quantity, unit_price, sources, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)").eq("invoice_id", id).order("line_no"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      const header = h.data as unknown as Row;
      if (header.corrects_invoice_id) {
        const c = await sb().from("sales_invoices").select("id, doc_no").eq("id", header.corrects_invoice_id as string).maybeSingle();
        header.corrects = c.data ?? null;
      }
      let lines: InvLine[];
      type PL = { id: string; line_no: number; product_id: string; variant_id: string | null; description: string | null; quantity: number; unit_price: number; sources: DraftLine["sources"]; product: { name: string; sku: string; uom: { code: string } | null }; variant: { name: string } | null };
      if (header.status === "DRAFT" || !(l.data ?? []).length) {
        const draft = (header.lines_draft ?? []) as DraftLine[];
        const pids = Array.from(new Set(draft.map((d) => d.product_id)));
        const vids = Array.from(new Set(draft.map((d) => d.variant_id).filter(Boolean))) as string[];
        const [pr, vr] = await Promise.all([
          pids.length ? sb().from("products").select("id, name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)").in("id", pids) : Promise.resolve({ data: [], error: null }),
          vids.length ? sb().from("product_variants").select("id, name").in("id", vids) : Promise.resolve({ data: [], error: null }),
        ]);
        const pm = new Map(((pr.data ?? []) as unknown as { id: string; name: string; sku: string; uom: { code: string } | null }[]).map((p) => [p.id, p]));
        const vm = new Map(((vr.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
        lines = draft.map((d, i) => ({
          key: String(i), line_no: i + 1, product_id: d.product_id, variant_id: d.variant_id, name: pm.get(d.product_id)?.name ?? "…", sku: pm.get(d.product_id)?.sku ?? "",
          uom: pm.get(d.product_id)?.uom?.code ?? "", variant: d.variant_id ? vm.get(d.variant_id) ?? null : null,
          quantity: Number(d.quantity), unit_price: d.unit_price == null ? null : Number(d.unit_price), description: d.description, gdnLineIds: (d.sources ?? []).map((s) => s.gdn_line_id),
          approved_price: d.approved_price == null ? null : Number(d.approved_price),
        }));
      } else {
        lines = (l.data as unknown as PL[]).map((x) => ({
          key: x.id, line_no: x.line_no, product_id: x.product_id, variant_id: x.variant_id, name: x.product.name, sku: x.product.sku, uom: x.product.uom?.code ?? "", variant: x.variant?.name ?? null,
          quantity: Number(x.quantity), unit_price: Number(x.unit_price), description: x.description, gdnLineIds: (x.sources ?? []).map((s) => s.gdn_line_id),
        }));
      }
      // the GDNs behind the lines (hidden source links)
      const glIds = Array.from(new Set(lines.flatMap((x) => x.gdnLineIds)));
      let gdns: { id: string; doc_no: string }[] = [];
      if (glIds.length) {
        const g = await sb().from("gdn_lines").select("id, gdn:gdns(id, doc_no)").in("id", glIds);
        const m = new Map<string, string>();
        for (const r of (g.data ?? []) as unknown as { gdn: { id: string; doc_no: string } | null }[]) if (r.gdn) m.set(r.gdn.id, r.gdn.doc_no);
        gdns = Array.from(m, ([gid, doc_no]) => ({ id: gid, doc_no })).sort((a, b) => a.doc_no.localeCompare(b.doc_no));
      }
      const pay = (v.data ?? { paid_amount: 0, outstanding: 0, payment_status: null }) as { paid_amount: number; outstanding: number; payment_status: string | null };
      return { header, lines, gdns, pay };
    },
  });
}

function InvoiceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const doc = useInvoice(id);
  if (doc.isLoading || doc.error || !doc.data) {
    return (
      <ErpDialog open onRequestClose={onClose} size="full" accent="invoice" icon={icon} title="Invoice" footer={<Button onClick={onClose}>Close</Button>}>
        {doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : <Skeleton className="h-40" />}
      </ErpDialog>
    );
  }
  return doc.data.header.status === "DRAFT" ? <InvoiceDraft data={doc.data} onClose={onClose} /> : <InvoiceView data={doc.data} onClose={onClose} />;
}
type InvData = NonNullable<ReturnType<typeof useInvoice>["data"]>;

function GdnChips({ gdns }: { gdns: InvData["gdns"] }) {
  const navigate = useNavigate();
  if (!gdns.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-ink-muted">From</span>
      {gdns.map((g) => <button key={g.id} className="rounded-control border border-line px-2 py-0.5 font-mono hover:border-primary" onClick={() => navigate(`/gdn?view=${g.id}`)}>{g.doc_no}</button>)}
    </div>
  );
}

function InvoiceDraft({ data, onClose }: { data: InvData; onClose: () => void }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const h = data.header;
  const cust = h.customer as { name: string; code: string; city: string | null };
  const init = React.useMemo(() => ({
    invoice_date: String(h.invoice_date), due_date: (h.due_date as string | null) ?? "", customer_reference: (h.customer_reference as string | null) ?? "",
    notes: (h.notes as string | null) ?? "", discount: Number(h.discount_amount) ? String(Number(h.discount_amount)) : "",
    prices: data.lines.map((l) => (l.unit_price == null ? "" : String(l.unit_price))), descs: data.lines.map((l) => l.description ?? ""),
  }), [data, h]);
  const [f, setF] = React.useState(init);
  const snapshot = React.useRef(JSON.stringify(init));
  const dirty = JSON.stringify(f) !== snapshot.current;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const [rcv, setRcv] = React.useState({ on: false, bank: null as string | null, amount: "", reference: "" });
  const [confirm, setConfirm] = React.useState<null | "post" | "cancel">(null);
  const carry = ((h.carry_receipts ?? []) as { receipt_entry_id: string; amount: number }[]);
  const carryTotal = carry.reduce((a, c) => a + Number(c.amount), 0);
  const corrects = h.corrects as { id: string; doc_no: string } | null;

  const amounts = data.lines.map((l, i) => (f.prices[i].trim() === "" ? null : Math.round(l.quantity * num(f.prices[i]) * 100) / 100));
  const subtotal = amounts.reduce<number>((a, v) => a + (v ?? 0), 0);
  const total = subtotal - (num(f.discount) || 0);
  const pending = amounts.filter((a) => a == null).length;
  const setPrice = (i: number, v: string) => setF((s) => ({ ...s, prices: s.prices.map((p, j) => (j === i ? v : p)) }));
  const setDesc = (i: number, v: string) => setF((s) => ({ ...s, descs: s.descs.map((p, j) => (j === i ? v : p)) }));

  const persist = async () => {
    const { error } = await sb().rpc("save_sales_invoice", {
      p_id: h.id,
      p_header: { invoice_date: f.invoice_date, due_date: f.due_date || null, customer_reference: f.customer_reference, notes: f.notes, discount_amount: f.discount.replace(/,/g, "") || "0" },
      p_lines: data.lines.map((_, i) => ({ unit_price: f.prices[i].replace(/,/g, "") || null, description: f.descs[i] || null })),
    });
    if (error) throw error;
  };
  const save = useMutation({
    mutationFn: async (post: boolean) => {
      await persist();
      if (post) {
        const r = await sb().rpc("post_sales_invoice", { p_id: h.id, p_receive: rcv.on ? { bank_account_id: rcv.bank, amount: rcv.amount.replace(/,/g, ""), reference: rcv.reference || null } : null });
        if (r.error) throw Object.assign(r.error, { saved: true });
        // payments released from the invoice this one corrects: apply them again (oldest first)
        let left = total - (rcv.on ? num(rcv.amount) : 0);
        for (const c of carry) {
          const amt = Math.min(Number(c.amount), Math.round(left * 100) / 100);
          if (amt <= 0) break;
          const a = await sb().rpc("allocate_receipt", { p_receipt_id: c.receipt_entry_id, p_allocations: [{ invoice_id: h.id, amount: amt }] });
          if (!a.error) left -= amt;
        }
      }
      return post;
    },
    onSuccess: (post) => {
      snapshot.current = JSON.stringify(f); setConfirm(null);
      toast.success(post ? (rcv.on ? "Invoice posted and payment received" : "Invoice posted to the customer's account") : "Invoice saved");
      qc.invalidateQueries();
    },
    onError: (e: Error & { saved?: boolean }) => {
      setConfirm(null);
      if (e.saved) { snapshot.current = JSON.stringify(f); qc.invalidateQueries(); toast.error(`Saved, but not posted: ${friendlyError(e)}`); }
      else toast.error(friendlyError(e));
    },
  });
  const cancel = useMutation({
    mutationFn: async () => { const { error } = await sb().rpc("cancel_sales_invoice", { p_id: h.id }); if (error) throw error; },
    onSuccess: () => { toast.success("Draft invoice cancelled — the GDNs can be invoiced again"); setConfirm(null); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const tryPost = () => {
    if (pending) { toast.error(`Enter the price for ${pending} item${pending > 1 ? "s" : ""} before posting`); return; }
    if (total <= 0) { toast.error("The invoice total must be more than 0"); return; }
    if (rcv.on && (!rcv.bank || !(num(rcv.amount) > 0))) { toast.error("Choose the bank / cash account and the amount received"); return; }
    if (rcv.on && num(rcv.amount) > total + 0.001) { toast.error("Payment received cannot be more than the invoice total"); return; }
    setConfirm("post");
  };
  const editable = can(P.salesInvoice);

  return (
    <>
      <ErpDialog open onRequestClose={() => guard(onClose)} size="full" accent="invoice" icon={icon} title={String(h.doc_no)} subtitle={`${cust.name}${cust.city ? ` · ${cust.city}` : ""}`}
        status={<Badge tone="warning">Draft</Badge>}
        footer={
          <>
            {editable && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm("cancel")}>Cancel invoice</Button>}
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1" />
            <Button onClick={() => guard(onClose)}>Close</Button>
            {editable && <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => save.mutate(false)}>Save</Button>}
            {editable && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={save.isPending} onClick={tryPost}>Post invoice</Button>}
          </>
        }>
        {corrects && (
          <p className="mb-3 rounded-control bg-info/10 px-2 py-1.5 text-xs text-info">
            Correction of <b>{corrects.doc_no}</b> (reversed).{carryTotal > 0 && <> {money(carryTotal)} already paid on it will be applied to this invoice when you post.</>}
          </p>
        )}
        <GdnChips gdns={data.gdns} />
        <FormGrid cols={4}>
          <Field label="Invoice date" required><Input type="date" value={f.invoice_date} disabled={!editable} onChange={(e) => setF((s) => ({ ...s, invoice_date: e.target.value }))} /></Field>
          <Field label="Due date"><Input type="date" value={f.due_date} disabled={!editable} onChange={(e) => setF((s) => ({ ...s, due_date: e.target.value }))} /></Field>
          <Field label="Customer's reference" className="sm:col-span-2"><Input value={f.customer_reference} disabled={!editable} onChange={(e) => setF((s) => ({ ...s, customer_reference: e.target.value }))} /></Field>
        </FormGrid>
        <div className="overflow-auto rounded-card border border-line">
          <table className="w-full text-sm">
            <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-8 px-3">#</th><th className="px-3">Item</th><th className="px-3 text-right">Qty</th><th className="w-[170px] px-3 text-right">Price</th><th className="px-3 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {data.lines.map((l, i) => (
                <DraftRow key={l.key} line={l} customerId={String(h.customer_id)} price={f.prices[i]} desc={f.descs[i]} amount={amounts[i]} disabled={!editable}
                  onPrice={(v) => setPrice(i, v)} onDesc={(v) => setDesc(i, v)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <Field label="Notes (printed on the invoice)"><Textarea rows={3} value={f.notes} disabled={!editable} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></Field>
            {editable && (
              <div className={cn("mt-3 rounded-card border p-3", rcv.on ? "border-primary" : "border-line")}>
                <Checkbox checked={rcv.on} onChange={(v) => setRcv((s) => ({ ...s, on: v, amount: v && !s.amount ? String(total > 0 ? total : "") : s.amount }))}
                  label="Receive payment now" description="Posts a receipt with the invoice and marks it paid (fully or partly)." />
                {rcv.on && (
                  <FormGrid cols={2} className="mt-2">
                    <Field label="Into account" required className="sm:col-span-2"><BankPicker value={rcv.bank} onChange={(v) => setRcv((s) => ({ ...s, bank: v }))} /></Field>
                    <Field label="Amount received" required><Input inputMode="decimal" className="text-right tabular-nums" value={rcv.amount} onChange={(e) => setRcv((s) => ({ ...s, amount: e.target.value }))} /></Field>
                    <Field label="Reference / cheque no."><Input value={rcv.reference} onChange={(e) => setRcv((s) => ({ ...s, reference: e.target.value }))} /></Field>
                  </FormGrid>
                )}
              </div>
            )}
          </div>
          <dl className="space-y-1.5 self-start rounded-card bg-subtle p-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Discount</dt>
              <dd><Input inputMode="decimal" className="h-control-sm w-[140px] text-right tabular-nums" placeholder="0" value={f.discount} disabled={!editable} onChange={(e) => setF((s) => ({ ...s, discount: e.target.value }))} /></dd></div>
            <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
            {pending > 0 && <p className="text-xs text-warning">{pending} item{pending > 1 ? "s" : ""} still have a pending price.</p>}
            {rcv.on && num(rcv.amount) > 0 && <div className="flex justify-between text-ink-muted"><dt>Balance after payment</dt><dd className="tabular-nums">{money(total - num(rcv.amount))}</dd></div>}
          </dl>
        </div>
      </ErpDialog>
      {dialog}
      <ConfirmDialog open={confirm === "post"} title={`Post ${String(h.doc_no)}?`}
        message={`${money(total)} goes on ${cust.name}'s account (receivable) and sales income is recorded.${rcv.on ? ` ${money(num(rcv.amount))} is received now.` : ""} Posted invoices cannot be edited — only reversed.`}
        confirmLabel="Post invoice" loading={save.isPending} onCancel={() => setConfirm(null)} onConfirm={() => save.mutate(true)} />
      <ConfirmDialog open={confirm === "cancel"} title={`Cancel ${String(h.doc_no)}?`} tone="destructive" message="The draft is kept for history and its GDNs become available to invoice again."
        confirmLabel="Cancel invoice" cancelLabel="Keep" loading={cancel.isPending} onCancel={() => setConfirm(null)} onConfirm={() => cancel.mutate()} />
    </>
  );
}

function DraftRow({ line, customerId, price, desc, amount, disabled, onPrice, onDesc }: {
  line: InvLine; customerId: string; price: string; desc: string; amount: number | null; disabled: boolean; onPrice: (v: string) => void; onDesc: (v: string) => void;
}) {
  const last = useLastPrice(customerId, line.product_id, line.variant_id);
  const { can } = useAccess();
  const locked = line.approved_price != null;
  const mayOverride = can(P.pricingApprove);
  const overridden = locked && price.trim() !== "" && Number(price.replace(/,/g, "")) !== line.approved_price;
  const td = "border-b border-line/70 px-3 py-2 align-top";
  return (
    <tr>
      <td className={cn(td, "w-8 text-ink-faint")}>{line.line_no}</td>
      <td className={td}>
        <div className="font-medium">{line.name}{line.variant && <span className="font-normal text-ink-muted"> · {line.variant}</span>}</div>
        <input className="mt-0.5 w-full bg-transparent text-xs text-ink-muted outline-none placeholder:text-ink-faint focus:text-ink" placeholder="Add a description (optional)" value={desc} disabled={disabled} onChange={(e) => onDesc(e.target.value)} />
      </td>
      <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(line.quantity)} <span className="text-2xs text-ink-faint">{line.uom}</span></td>
      <td className={cn(td, "text-right")}>
        <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="Pending" aria-label={`Price of ${line.name}`} value={price} invalid={price.trim() === ""} disabled={disabled || (locked && !mayOverride)}
          onChange={(e) => onPrice(e.target.value)} />
        {locked && !overridden && <div className="mt-0.5 inline-flex items-center gap-1 text-2xs text-success" title="Price agreed on the order / approved on a price task"><Lock className="h-3 w-3" />Approved price</div>}
        {overridden && <div className="mt-0.5 text-2xs text-warning">Approved {money(line.approved_price)} — change is recorded</div>}
        {last.data && !locked && Number(last.data.unit_price) !== Number(price || NaN) && !disabled && (
          <button type="button" className="mt-0.5 text-2xs text-info hover:underline" onClick={() => onPrice(String(Number(last.data!.unit_price)))}>Last {money(last.data.unit_price)} ({last.data.doc_no})</button>
        )}
      </td>
      <td className={cn(td, "text-right tabular-nums")}>{amount == null ? <Badge tone="warning">Pending</Badge> : money(amount)}</td>
    </tr>
  );
}

function InvoiceView({ data, onClose }: { data: InvData; onClose: () => void }) {
  const { can, company } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const h = data.header;
  const id = String(h.id);
  const status = String(h.status);
  const cust = h.customer as { name: string; code: string; city: string | null };
  const [tab, setTab] = React.useState("lines");
  const [dlg, setDlg] = React.useState<null | "pay" | "alloc" | "reverse" | "correct">(null);
  const [reason, setReason] = React.useState("");
  const [release, setRelease] = React.useState(false);
  const allocs = useQuery({
    queryKey: ["invoice-allocations", id],
    queryFn: async () => {
      const { data: d, error } = await sb().from("receipt_allocations").select("id, amount, status, created_at, removed_at, receipt:journal_entries(id, entry_no, entry_date, reference)").eq("invoice_id", id).order("created_at");
      if (error) throw error;
      return (d ?? []) as unknown as { id: string; amount: number; status: string; created_at: string; removed_at: string | null; receipt: { id: string; entry_no: string; entry_date: string; reference: string | null } | null }[];
    },
  });
  const active = (allocs.data ?? []).filter((a) => a.status === "ACTIVE");
  const reverse = useMutation({
    mutationFn: async () => { const { error } = await sb().rpc("reverse_sales_invoice_full", { p_id: id, p_reason: reason.trim(), p_date: null, p_release_payments: release }); if (error) throw error; },
    onSuccess: () => { toast.success(release ? "Invoice reversed — payments stay on the customer's account as an advance" : "Invoice reversed — the GDNs can be invoiced again"); setDlg(null); setReason(""); setRelease(false); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const correct = useMutation({
    mutationFn: async () => {
      const { data: nid, error } = await sb().rpc("correct_sales_invoice", { p_id: id, p_reason: reason.trim() || "Corrected" });
      if (error) throw error;
      return nid as string;
    },
    onSuccess: (nid) => { toast.success("Original reversed — correct the new draft and post it"); setDlg(null); setReason(""); qc.invalidateQueries(); navigate(`/invoices?view=${nid}`); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const remove = useMutation({
    mutationFn: async (aid: string) => { const { error } = await sb().rpc("remove_allocation", { p_id: aid }); if (error) throw error; },
    onSuccess: () => { toast.success("Allocation removed — the receipt stays on the customer's account"); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const outstanding = Number(data.pay.outstanding);
  const canInv = can(P.salesInvoice);
  const overdue = isOverdue({ due_date: h.due_date, outstanding });

  const print = () => {
    const ok = printDocument({
      company: company?.company_name ?? "", title: "Sales Invoice", docNo: String(h.doc_no),
      meta: [["Customer", `${cust.name}${cust.city ? `, ${cust.city}` : ""}`], ["Invoice date", formatDate(h.invoice_date as string)], ["Due date", h.due_date ? formatDate(h.due_date as string) : ""],
        ["Customer ref.", (h.customer_reference as string) ?? ""], ["Delivery notes", data.gdns.map((g) => g.doc_no).join(", ")]],
      columns: [{ label: "#" }, { label: "Item" }, { label: "Qty", align: "right" }, { label: "Price", align: "right" }, { label: "Amount", align: "right" }],
      rows: data.lines.map((l) => [String(l.line_no), `${l.name}${l.variant ? ` · ${l.variant}` : ""}${l.description ? ` — ${l.description}` : ""}`, `${qtyFmt(l.quantity)} ${l.uom}`, money(l.unit_price), money(l.quantity * Number(l.unit_price))]),
      totals: [["Subtotal", money(h.subtotal as number)], ...(Number(h.discount_amount) ? [["Discount", `-${money(h.discount_amount as number)}`] as [string, string]] : []),
        ...(Number(data.pay.paid_amount) ? [["Total", money(h.total_amount as number)], ["Paid", money(data.pay.paid_amount)]] as [string, string][] : []),
        [Number(data.pay.paid_amount) ? "Balance due" : "Total", money(Number(data.pay.paid_amount) ? outstanding : (h.total_amount as number))]],
      notes: h.notes as string | null, signatures: ["Prepared by", "Customer signature"],
    });
    if (!ok) toast.error("Allow pop-ups to print");
  };

  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="full" accent="invoice" icon={icon} title={String(h.doc_no)} subtitle={`${cust.name}${cust.city ? ` · ${cust.city}` : ""}`}
        status={<>{h.is_quick ? <Badge tone="neutral" className="mr-1">Quick</Badge> : null}{status === "POSTED" ? <Badge tone={overdue ? "danger" : PAY_TONE[String(data.pay.payment_status)]}>{overdue ? "Overdue" : payLabel(String(data.pay.payment_status))}</Badge> : <Badge tone={STATUS_TONE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>}</>}
        footer={
          <>
            {status === "POSTED" && canInv && <Button variant="destructive-ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setDlg("reverse")}>Reverse</Button>}
            <div className="flex-1" />
            {!!h.journal_entry_id && can(P.journalsView) && <Button icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => navigate(`/vouchers?view=${h.journal_entry_id}`)}>Journal entry</Button>}
            {status !== "CANCELLED" && <Button icon={<Printer className="h-3.5 w-3.5" />} onClick={print}>Print</Button>}
            <Button onClick={onClose}>Close</Button>
            {status === "POSTED" && canInv && <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setDlg("correct")}>Edit</Button>}
            {status === "POSTED" && outstanding > 0 && canInv && <Button icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setDlg("alloc")}>Use earlier receipt</Button>}
            {status === "POSTED" && outstanding > 0 && canInv && <Button variant="primary" icon={<Banknote className="h-3.5 w-3.5" />} onClick={() => setDlg("pay")}>Receive payment</Button>}
          </>
        }>
        <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-6">
          <KeyValue label="Invoice date">{formatDate(h.invoice_date as string)}</KeyValue>
          <KeyValue label="Due date">{h.due_date ? <span className={cn(overdue && "font-medium text-danger")}>{formatDate(h.due_date as string)}</span> : null}</KeyValue>
          <KeyValue label="Total"><span className="font-semibold tabular-nums">{money(h.total_amount as number)}</span></KeyValue>
          <KeyValue label="Paid"><span className="tabular-nums">{money(data.pay.paid_amount)}</span></KeyValue>
          <KeyValue label="Outstanding"><span className={cn("font-semibold tabular-nums", outstanding > 0 && "text-warning")}>{money(outstanding)}</span></KeyValue>
          {h.posted_at ? <KeyValue label="Posted">{formatDateTime(h.posted_at as string)}</KeyValue> : <KeyValue label="Customer ref.">{(h.customer_reference as string) || null}</KeyValue>}
          {h.reversal_reason ? <KeyValue label="Reversal reason" className="col-span-2 md:col-span-3">{String(h.reversal_reason)}</KeyValue> : null}
          {h.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-3">{String(h.notes)}</KeyValue> : null}
        </dl>
        <GdnChips gdns={data.gdns} />
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "lines", label: `Items (${data.lines.length})` },
          { key: "pay", label: `Payments (${active.length})` },
          ...(can("audit.view") ? [{ key: "history", label: "History" }] : []),
        ]} />
        {tab === "history" && <AuditTimeline table="sales_invoices" id={id} />}
        {tab === "lines" && (
          <div className="overflow-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <th className="h-8 px-3">#</th><th className="px-3">Item</th><th className="px-3 text-right">Qty</th><th className="px-3 text-right">Price</th><th className="px-3 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {data.lines.map((l) => {
                  const td = "border-b border-line/70 px-3 py-2 align-top";
                  return (
                    <tr key={l.key}>
                      <td className={cn(td, "w-8 text-ink-faint")}>{l.line_no}</td>
                      <td className={td}><div className="font-medium">{l.name}{l.variant && <span className="font-normal text-ink-muted"> · {l.variant}</span>}</div><div className="text-2xs text-ink-muted">{l.description || l.sku}</div></td>
                      <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(l.quantity)} <span className="text-2xs text-ink-faint">{l.uom}</span></td>
                      <td className={cn(td, "text-right tabular-nums")}>{money(l.unit_price)}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{money(l.quantity * Number(l.unit_price))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="text-sm">
                <tr><td colSpan={4} className="px-3 pt-2 text-right text-ink-muted">Subtotal</td><td className="px-3 pt-2 text-right tabular-nums">{money(h.subtotal as number)}</td></tr>
                {Number(h.discount_amount) > 0 && <tr><td colSpan={4} className="px-3 text-right text-ink-muted">Discount</td><td className="px-3 text-right tabular-nums">-{money(h.discount_amount as number)}</td></tr>}
                <tr><td colSpan={4} className="px-3 pb-2 text-right font-semibold">Total</td><td className="px-3 pb-2 text-right font-semibold tabular-nums">{money(h.total_amount as number)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
        {tab === "pay" && (
          allocs.isLoading ? <Skeleton className="h-16" /> : (allocs.data ?? []).length === 0 ? <p className="text-xs text-ink-muted">No payments allocated yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-2xs uppercase text-ink-muted"><th className="py-1">Receipt</th><th>Date</th><th>Reference</th><th className="text-right">Amount</th><th className="w-10" /></tr></thead>
              <tbody>
                {allocs.data!.map((a) => (
                  <tr key={a.id} className={cn("border-t border-line/60", a.status !== "ACTIVE" && "text-ink-faint line-through")}>
                    <td className="py-1.5 font-mono text-xs">
                      {a.receipt ? <button className="hover:underline" onClick={() => navigate(`/vouchers?view=${a.receipt!.id}`)}>{a.receipt.entry_no} <ExternalLink className="inline h-3 w-3" /></button> : "receipt"}
                    </td>
                    <td className="text-xs">{a.receipt ? formatDate(a.receipt.entry_date) : ""}</td>
                    <td className="text-xs text-ink-muted">{a.receipt?.reference ?? ""}</td>
                    <td className="text-right tabular-nums">{money(a.amount)}</td>
                    <td className="text-right">{a.status === "ACTIVE" && canInv && <Button size="icon-sm" variant="ghost" aria-label="Remove allocation" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}><X className="h-3.5 w-3.5" /></Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </ErpDialog>
      {dlg === "pay" && <ReceivePaymentDialog invoiceId={id} docNo={String(h.doc_no)} outstanding={outstanding} onClose={() => setDlg(null)} />}
      {dlg === "alloc" && <AllocateExistingDialog invoiceId={id} docNo={String(h.doc_no)} customerId={String(h.customer_id)} outstanding={outstanding} onClose={() => setDlg(null)} />}
      <ConfirmDialog open={dlg === "reverse"} title={`Reverse ${String(h.doc_no)}?`} tone="destructive"
        message="A reversing entry takes the amount off the customer's account. The GDNs become available to invoice again. To only fix prices or details, use Edit instead."
        confirmLabel="Reverse" cancelLabel="Keep" loading={reverse.isPending}
        onCancel={() => { setDlg(null); setReason(""); setRelease(false); }}
        onConfirm={() => (!reason.trim() ? toast.error("Enter a reason") : active.length && !release ? toast.error("Tick “release payments” first") : reverse.mutate())}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {active.length > 0 && (
          <div className="mt-2 rounded-control border border-warning/50 p-2">
            <Checkbox checked={release} onChange={setRelease} label={`Release payments (${money(Number(data.pay.paid_amount))})`}
              description="The receipts are not cancelled — the money stays on the customer's account as an advance and can be used on another invoice." />
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={dlg === "correct"} title={`Edit ${String(h.doc_no)}?`}
        message={`A posted invoice cannot be changed in place. It will be reversed and a new draft with the same items and prices opens for you to correct and post.${active.length ? ` The ${money(Number(data.pay.paid_amount))} already paid moves to the new invoice when you post it.` : ""}`}
        confirmLabel="Reverse & edit copy" cancelLabel="Keep" loading={correct.isPending}
        onCancel={() => { setDlg(null); setReason(""); }} onConfirm={() => correct.mutate()}>
        <Field label="What is being corrected?" className="mt-3"><Textarea rows={2} value={reason} placeholder="e.g. price of fans" onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}

function ReceivePaymentDialog({ invoiceId, docNo, outstanding, onClose }: { invoiceId: string; docNo: string; outstanding: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [bank, setBank] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState(String(outstanding));
  const [date, setDate] = React.useState(today());
  const [ref, setRef] = React.useState("");
  const go = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("receive_invoice_payment", { p_invoice_id: invoiceId, p_bank_account_id: bank, p_amount: amount.replace(/,/g, ""), p_date: date, p_reference: ref || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Payment received and allocated"); qc.invalidateQueries(); onClose(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const bad = !bank || !(num(amount) > 0) || num(amount) > outstanding + 0.001;
  return (
    <ErpDialog open onRequestClose={onClose} size="sm" icon={<Banknote className="h-4 w-4" />} title="Receive payment" subtitle={`${docNo} · outstanding ${money(outstanding)}`}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={bad} loading={go.isPending} onClick={() => go.mutate()}>Receive</Button></>}>
      <FormGrid cols={2}>
        <Field label="Into account" required className="sm:col-span-2"><BankPicker value={bank} onChange={setBank} /></Field>
        <Field label="Amount" required error={num(amount) > outstanding + 0.001 ? "More than outstanding" : undefined}><Input inputMode="decimal" className="text-right tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reference / cheque no." className="sm:col-span-2"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </FormGrid>
      <p className="mt-2 text-xs text-ink-muted">A receipt voucher is posted (bank Dr, customer Cr) and allocated to this invoice in one step.</p>
    </ErpDialog>
  );
}

function AllocateExistingDialog({ invoiceId, docNo, customerId, outstanding, onClose }: { invoiceId: string; docNo: string; customerId: string; outstanding: number; onClose: () => void }) {
  const qc = useQueryClient();
  const receipts = useOpenReceipts(customerId);
  const [amt, setAmt] = React.useState<Record<string, string>>({});
  React.useEffect(() => { if (receipts.data) setAmt(autoFill(receipts.data.map((r) => ({ id: r.entry_id, due: r.unallocated })), outstanding)); }, [receipts.data, outstanding]);
  const chosen = Object.entries(amt).filter(([, v]) => num(v) > 0);
  const sum = chosen.reduce((a, [, v]) => a + num(v), 0);
  const go = useMutation({
    mutationFn: async () => {
      for (const [rid, v] of chosen) {
        const { error } = await sb().rpc("allocate_receipt", { p_receipt_id: rid, p_allocations: [{ invoice_id: invoiceId, amount: v.replace(/,/g, "") }] });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Receipts allocated"); qc.invalidateQueries(); onClose(); },
    onError: (e) => { toast.error(friendlyError(e)); qc.invalidateQueries(); },
  });
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<Link2 className="h-4 w-4" />} title="Use an earlier receipt" subtitle={`${docNo} · outstanding ${money(outstanding)}`}
      footer={<><span className={cn("flex-1 text-xs", sum > outstanding + 0.001 ? "text-danger" : "text-ink-muted")}>Allocating {money(sum)}</span><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!chosen.length || sum > outstanding + 0.001} loading={go.isPending} onClick={() => go.mutate()}>Allocate</Button></>}>
      {receipts.isLoading ? <Skeleton className="h-20" /> : (receipts.data ?? []).length === 0 ? <p className="text-sm text-ink-muted">This customer has no receipts with money left to allocate. Use “Receive payment” instead.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-2xs uppercase text-ink-muted"><th className="py-1">Receipt</th><th>Date</th><th className="text-right">Not allocated</th><th className="w-[140px] text-right">Use</th></tr></thead>
          <tbody>
            {receipts.data!.map((r) => (
              <tr key={r.entry_id} className="border-t border-line/60">
                <td className="py-1 font-mono text-xs">{r.entry_no}</td>
                <td className="text-xs">{formatDate(r.entry_date)}</td>
                <td className="text-right tabular-nums">{money(r.unallocated)}</td>
                <td className="py-1 text-right"><Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0" value={amt[r.entry_id] ?? ""} invalid={num(amt[r.entry_id] ?? "") > r.unallocated}
                  onChange={(e) => setAmt((s) => ({ ...s, [r.entry_id]: e.target.value }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ErpDialog>
  );
}

/* ---------------------------------------------------------------- quick invoice (counter sale) */
interface QLine { key: string; product_id: string | null; variant_id: string | null; warehouse_id: string | null; qty: string; price: string; desc: string }
const newQLine = (): QLine => ({ key: crypto.randomUUID(), product_id: null, variant_id: null, warehouse_id: null, qty: "", price: "", desc: "" });

function QuickInvoiceDialog({ onClose, onPosted }: { onClose: () => void; onPosted: (id: string) => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const whs = useWarehouses();
  const idem = React.useRef(crypto.randomUUID());
  const [customer, setCustomer] = React.useState<string | null>(null);
  const [date, setDate] = React.useState(today());
  const [due, setDue] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [discount, setDiscount] = React.useState("");
  const [lines, setLines] = React.useState<QLine[]>([newQLine()]);
  const [rcv, setRcv] = React.useState({ on: false, bank: null as string | null, amount: "", reference: "" });
  const [showErrors, setShowErrors] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const dirty = !!customer || lines.some((l) => l.product_id);
  const { guard, dialog } = useUnsavedGuard(dirty);
  const setLine = (key: string, p: Partial<QLine>) => setLines((s) => s.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const used = lines.filter((l) => l.product_id || n(l.qty) > 0);
  const subtotal = used.reduce((a, l) => a + Math.round(n(l.qty) * n(l.price) * 100) / 100, 0);
  const total = subtotal - (n(discount) || 0);
  const errors: Record<string, string> = {};
  if (!customer) errors.customer = "Choose the customer";
  if (!used.length) errors.lines = "Add at least one item";
  for (const l of used) {
    if (!l.product_id) errors[`${l.key}.p`] = "Choose the item";
    if (!l.warehouse_id) errors[`${l.key}.w`] = "Choose the warehouse";
    if (!(n(l.qty) > 0)) errors[`${l.key}.q`] = "Enter the quantity";
    if (l.price.trim() === "" || !(n(l.price) >= 0)) errors[`${l.key}.price`] = "Enter the price";
  }
  if (total <= 0 && used.length) errors.total = "The total must be more than 0";
  if (rcv.on && (!rcv.bank || !(n(rcv.amount) > 0))) errors.rcv = "Choose the account and the amount received";
  if (rcv.on && n(rcv.amount) > total + 0.001) errors.rcv = "Payment cannot be more than the invoice total";
  const err = (k: string) => (showErrors ? errors[k] : undefined);

  const post = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("quick_sales_invoice", {
        p_header: { company_id: companyId, customer_id: customer, invoice_date: date, due_date: due || null, customer_reference: ref, notes, discount_amount: discount.replace(/,/g, "") || "0" },
        p_lines: used.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, warehouse_id: l.warehouse_id, quantity: l.qty.replace(/,/g, ""), unit_price: l.price.replace(/,/g, ""), description: l.desc || null })),
        p_receive: rcv.on ? { bank_account_id: rcv.bank, amount: rcv.amount.replace(/,/g, ""), reference: rcv.reference || null } : null,
        p_idempotency_key: idem.current,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { toast.success("Invoice posted and goods dispatched"); qc.invalidateQueries(); onPosted(id); },
    onError: (e) => { setConfirm(false); idem.current = crypto.randomUUID(); toast.error(friendlyError(e)); },
  });
  const tryPost = () => {
    setShowErrors(true);
    const k = Object.keys(errors);
    if (k.length) { toast.error(errors[k.find((x) => !x.includes(".")) ?? k[0]] ?? "Please fix the highlighted fields"); return; }
    setConfirm(true);
  };

  return (
    <>
      <ErpDialog open onRequestClose={() => guard(onClose)} size="full" accent="invoice" icon={<Zap className="h-4 w-4" />} title="Quick invoice" subtitle="Invoice and dispatch in one step"
        footer={
          <>
            <div className="flex-1 text-right text-sm">Total <b className="tabular-nums">{money(total)}</b></div>
            <Button onClick={() => guard(onClose)}>Cancel</Button>
            <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={post.isPending} onClick={tryPost}>Post invoice</Button>
          </>
        }>
        <FormGrid cols={4}>
          <Field label="Customer" required error={err("customer")} className="sm:col-span-2"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
          <Field label="Invoice date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </FormGrid>
        {err("lines") && <p className="mb-2 text-xs text-danger">{err("lines")}</p>}
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 z-[1]"><tr className="bg-emerald-50/70 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-9 w-10 px-2 text-center">#</th><th className="px-2">Item</th><th className="w-[200px] px-2">From warehouse</th><th className="w-[120px] px-2 text-right">Qty</th>
              <th className="w-[150px] px-2 text-right">Unit price</th><th className="w-[140px] px-2 text-right">Amount</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <QuickLine key={l.key} idx={i} line={l} customerId={customer} warehouses={whs.data ?? []} err={err} onChange={(p) => setLine(l.key, p)}
                  onRemove={lines.length > 1 ? () => setLines((s) => s.filter((x) => x.key !== l.key)) : undefined} />
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((s) => [...s, newQLine()])}>Add item</Button>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <FormGrid cols={2}>
              <Field label="Customer's reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
              <Field label="Notes (printed)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </FormGrid>
            <div className={cn("mt-2 rounded-card border p-3", rcv.on ? "border-primary" : "border-line")}>
              <Checkbox checked={rcv.on} onChange={(v) => setRcv((s) => ({ ...s, on: v, amount: v && !s.amount && total > 0 ? String(total) : s.amount }))}
                label="Receive payment now" description="Cash or bank received at the counter — the invoice is marked paid (fully or partly)." />
              {rcv.on && (
                <FormGrid cols={2} className="mt-2">
                  <Field label="Into account" required className="sm:col-span-2"><BankPicker value={rcv.bank} onChange={(v) => setRcv((s) => ({ ...s, bank: v }))} /></Field>
                  <Field label="Amount received" required><Input inputMode="decimal" className="text-right tabular-nums" value={rcv.amount} onChange={(e) => setRcv((s) => ({ ...s, amount: e.target.value }))} /></Field>
                  <Field label="Reference / cheque no."><Input value={rcv.reference} onChange={(e) => setRcv((s) => ({ ...s, reference: e.target.value }))} /></Field>
                </FormGrid>
              )}
              {err("rcv") && <p className="mt-1 text-xs text-danger">{err("rcv")}</p>}
            </div>
          </div>
          <dl className="space-y-1.5 self-start rounded-card bg-subtle p-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Discount</dt>
              <dd><Input inputMode="decimal" className="h-control-sm w-[140px] text-right tabular-nums" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></dd></div>
            <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
            {rcv.on && n(rcv.amount) > 0 && <div className="flex justify-between text-ink-muted"><dt>Balance after payment</dt><dd className="tabular-nums">{money(total - n(rcv.amount))}</dd></div>}
            {err("total") && <p className="text-xs text-danger">{err("total")}</p>}
          </dl>
        </div>
      </ErpDialog>
      {dialog}
      <ConfirmDialog open={confirm} title="Post quick invoice?" loading={post.isPending}
        message={`${money(total)} goes on the customer's account and the goods leave the chosen warehouses now.${rcv.on ? ` ${money(n(rcv.amount))} is received.` : ""} A sales order and a GDN are created and linked automatically — use Edit / Reverse on the invoice to correct it later.`}
        confirmLabel="Post & dispatch" onCancel={() => setConfirm(false)} onConfirm={() => post.mutate()} />
    </>
  );
}

function QuickLine({ idx, line, customerId, warehouses, err, onChange, onRemove }: {
  idx: number; line: QLine; customerId: string | null; warehouses: Wh[]; err: (k: string) => string | undefined; onChange: (p: Partial<QLine>) => void; onRemove?: () => void;
}) {
  const meta = useProductMeta(line.product_id);
  const needsVariant = !!meta.data?.has_variants;
  const avail = useItemAvailability(line.product_id, line.variant_id, { isBundle: meta.data?.is_bundle, needsVariant });
  const last = useLastPrice(customerId, line.product_id, line.variant_id);
  // default the warehouse to the one with the most stock
  React.useEffect(() => {
    if (line.warehouse_id || !avail.data || !warehouses.length) return;
    const best = [...warehouses].sort((a, b) => (avail.data!.get(b.id)?.available ?? 0) - (avail.data!.get(a.id)?.available ?? 0))[0];
    if (best && (avail.data.get(best.id)?.available ?? 0) > 0) onChange({ warehouse_id: best.id });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail.data, line.warehouse_id, warehouses]);
  React.useEffect(() => {
    if (last.data && line.price === "") onChange({ price: String(Number(last.data.unit_price)) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last.data]);
  const a = line.warehouse_id ? avail.data?.get(line.warehouse_id) : undefined;
  const short = !!line.warehouse_id && !!avail.data && n(line.qty) > (a?.available ?? 0);
  const options = warehouses.map((w) => ({ value: w.id, label: w.code, secondary: avail.data ? `${qtyFmt(avail.data.get(w.id)?.available ?? 0)} available` : w.name }));
  const td = "border-b border-line/70 px-2 py-1.5 align-top";
  return (
    <tr className="group bg-white hover:bg-emerald-50/30">
      <td className={cn(td, "pt-3 text-center text-2xs text-ink-faint")}>{idx + 1}</td>
      <td className={td}>
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1"><ProductPicker value={line.product_id} onChange={(v) => onChange({ product_id: v, variant_id: null, warehouse_id: null, price: "" })} invalid={!!err(`${line.key}.p`)} /></div>
          {needsVariant && <div className="w-[42%] shrink-0"><VariantPicker productId={line.product_id} value={line.variant_id} onChange={(v) => onChange({ variant_id: v, warehouse_id: null })} /></div>}
        </div>
        <input className="mt-1 w-full bg-transparent text-xs text-ink-muted outline-none placeholder:text-ink-faint" placeholder="Description (optional)" value={line.desc} onChange={(e) => onChange({ desc: e.target.value })} />
      </td>
      <td className={td}>
        <SearchableSelect value={line.warehouse_id} options={options} placeholder="From warehouse…" invalid={!!err(`${line.key}.w`)} clearable={false} onChange={(v) => onChange({ warehouse_id: v })} />
        {line.warehouse_id && a && <div className="mt-0.5 text-2xs text-ink-muted">{qtyFmt(a.available)} available here</div>}
      </td>
      <td className={td}>
        <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0" aria-label="Quantity" value={line.qty} invalid={!!err(`${line.key}.q`) || short} onChange={(e) => onChange({ qty: e.target.value })} />
        {short && <div className="mt-0.5 text-right text-2xs text-danger">more than available</div>}
      </td>
      <td className={td}>
        <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" placeholder="0.00" aria-label="Unit price" value={line.price} invalid={!!err(`${line.key}.price`)} onChange={(e) => onChange({ price: e.target.value })} />
        {last.data && <div className="mt-0.5 text-right text-2xs text-ink-muted">last {money(last.data.unit_price)}</div>}
      </td>
      <td className={cn(td, "pt-2.5 text-right tabular-nums")}>{n(line.qty) > 0 && line.price.trim() !== "" ? money(n(line.qty) * n(line.price)) : <span className="text-ink-faint">—</span>}</td>
      <td className={cn(td, "pt-1.5 text-center")}>{onRemove && <Button size="icon-sm" variant="ghost" aria-label="Remove item" className="opacity-50 group-hover:opacity-100" onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>}</td>
    </tr>
  );
}

