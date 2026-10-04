import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, Hammer, Pencil, Plus, RotateCcw, Save, ShieldAlert, Trash2, Undo2, Unplug, Wrench } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, SectionTitle, Skeleton, Textarea, cn,
} from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime, formatNumber, humanize } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "./DocPage";
import { STATUS_TONE } from "./docConfigs";
import { MovementsTable } from "./MovementsTable";
import { ProductPicker, VariantPicker, WarehousePicker, useProductMeta, useStockFigures } from "./pickers";
import { AssemblyLabourPanel } from "../hr/AssemblyLabour";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";

type Row = Record<string, unknown> & { id: string };
type Kind = "ASSEMBLY" | "DISASSEMBLY";
interface Comp { key: string; product_id: string | null; variant_id: string | null; quantity: string }
interface FormState {
  kind: Kind; warehouse_id: string | null; doc_date: string; product_id: string | null; variant_id: string | null;
  quantity: string; reference: string; notes: string; comps: Comp[];
  /** true once the component list was edited by hand (stops following item x quantity) */
  custom: boolean;
}

const PAGE = 25;
const FILTERS = [
  { label: "All", status: undefined },
  { label: "Drafts", status: "DRAFT" },
  { label: "Posted", status: "POSTED" },
  { label: "Reversed", status: "REVERSED" },
  { label: "Cancelled", status: "CANCELLED" },
];
const KIND_LABEL: Record<Kind, string> = { ASSEMBLY: "Assemble", DISASSEMBLY: "Disassemble" };
const num = (s: string) => Number(s.replace(/,/g, ""));
const fmt = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 2);
const LIST_SELECT =
  "id, doc_no, doc_date, kind, status, quantity, reference, warehouse:warehouses(code, name), product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)";

/* ================================================================== LIST */
export function AssemblyPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const f = Number(params.get("f") ?? "0") || 0;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";

  const list = useEntityList<Row>({
    table: "assembly_orders",
    select: LIST_SELECT,
    companyId,
    search: q,
    searchColumns: ["doc_no", "reference"],
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false },
    page,
    pageSize: PAGE,
    enabled: can(P.inventoryView),
  });

  if (!can(P.inventoryView)) {
    return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="You don't have permission to view inventory." /></Card>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Assembly"
        description="Build finished items (coolers, fans…) from components, or take them apart. Components and finished stock move together in one step."
        icon={<Wrench className="h-4 w-4" />}
        actions={can(P.inventoryAssemble) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New Assembly</Button>}
      />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search document no. / reference…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? (
          <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p>
        ) : (
          <DataTable
            loading={list.isLoading}
            rows={list.data?.rows ?? []}
            onView={(r) => update({ view: r.id, new: null })}
            page={page}
            pageSize={PAGE}
            total={list.data?.total ?? null}
            onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc_no", header: "Document", width: "150px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "date", header: "Date", width: "110px", cell: (r) => <span className="whitespace-nowrap">{formatDate(r.doc_date as string)}</span> },
              { key: "kind", header: "Type", width: "110px", cell: (r) => <Badge tone={r.kind === "ASSEMBLY" ? "info" : "neutral"}>{KIND_LABEL[r.kind as Kind]}</Badge> },
              {
                key: "item", header: "Item", cell: (r) => {
                  const p = r.product as { name: string; sku: string }; const v = r.variant as { name: string } | null;
                  return <div className="min-w-0"><div className="truncate font-medium">{p?.name}{v ? <span className="font-normal text-ink-muted"> · {v.name}</span> : null}</div><div className="text-2xs text-ink-muted">{p?.sku}</div></div>;
                },
              },
              { key: "qty", header: "Qty", align: "right", width: "90px", cell: (r) => <span className="tabular-nums">{fmt(Number(r.quantity))} <span className="text-2xs text-ink-faint">{(r.product as { uom: { code: string } })?.uom?.code}</span></span> },
              { key: "wh", header: "Warehouse", hideBelow: "md", cell: (r) => { const w = r.warehouse as { code: string; name: string } | null; return w ? <span><span className="font-mono text-xs text-ink-muted">{w.code}</span> {w.name}</span> : null; } },
              { key: "ref", header: "Reference", hideBelow: "lg", cell: (r) => (r.reference as string) || "" },
              { key: "status", header: "Status", width: "100px", cell: (r) => <Badge tone={STATUS_TONE[String(r.status)]}>{humanize(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={<Wrench className="h-6 w-6" />} title="No assembly orders yet" description="Set up an item's components on the product (Components tab), then create an assembly order here." />}
          />
        )}
      </Card>
      {(viewId || creating) && (
        <AssemblyDialog id={viewId} onClose={() => update({ view: null, new: null })} onSaved={(id) => update({ view: id, new: null })} />
      )}
    </div>
  );
}

/* ================================================================== shared */
function useOrder(id: string | null) {
  return useQuery({
    queryKey: ["record", "assembly_orders", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await sb().from("assembly_orders").select(`${LIST_SELECT}, company_id, warehouse_id, product_id, variant_id, components, notes, posted_at, reversed_at, reversal_reason, created_at`).eq("id", id!).single();
      if (error) throw error;
      return data as unknown as Row;
    },
  });
}

/** Names / units for a set of product + variant ids (component lists are stored as ids). */
function useItemNames(productIds: string[], variantIds: string[]) {
  return useQuery({
    queryKey: ["item-names", [...productIds].sort().join(), [...variantIds].sort().join()],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const [p, v] = await Promise.all([
        sb().from("products").select("id, name, sku, uom:units_of_measure!products_base_uom_id_fkey(code, allow_decimal)").in("id", productIds),
        variantIds.length ? sb().from("product_variants").select("id, name").in("id", variantIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (p.error) throw p.error;
      return {
        products: new Map((p.data ?? []).map((x) => [x.id as string, x as unknown as { name: string; sku: string; uom: { code: string } | null }])),
        variants: new Map(((v.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])),
      };
    },
  });
}

export function AssemblyDialog({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const doc = useOrder(id);
  const [mode, setMode] = React.useState<"view" | "edit">(id ? "view" : "edit");
  React.useEffect(() => setMode(id ? "view" : "edit"), [id]);
  if (mode === "edit" && (!id || doc.data)) {
    return <OrderForm id={id} initial={doc.data ?? null} onCancel={() => (id ? setMode("view") : onClose())} onClose={onClose} onSaved={(nid) => { setMode("view"); onSaved(nid); }} />;
  }
  return <OrderView id={id!} data={doc.data ?? null} loading={doc.isLoading} error={doc.error} onEdit={() => setMode("edit")} onClose={onClose} />;
}

/* ================================================================== VIEW */
function OrderView({ id, data, loading, error, onEdit, onClose }: { id: string; data: Row | null; loading: boolean; error: unknown; onEdit: () => void; onClose: () => void }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState("components");
  const files = useAttachments("assembly_orders", id);
  const [confirm, setConfirm] = React.useState<null | "post" | "cancel" | "reverse">(null);
  const [reason, setReason] = React.useState("");
  const status = String(data?.status ?? "DRAFT");
  const kind = (data?.kind as Kind) ?? "ASSEMBLY";
  const comps = (data?.components as { product_id: string; variant_id: string | null; quantity: number }[]) ?? [];
  const names = useItemNames(comps.map((c) => c.product_id), comps.map((c) => c.variant_id).filter(Boolean) as string[]);

  const action = useMutation({
    mutationFn: async (k: "post" | "cancel" | "reverse") => {
      const r = k === "post" ? await sb().rpc("post_assembly_order", { p_id: id })
        : k === "cancel" ? await sb().rpc("cancel_assembly_order", { p_id: id })
        : await sb().rpc("reverse_assembly_order", { p_id: id, p_reason: reason.trim() });
      if (r.error) throw r.error;
    },
    onSuccess: (_d, k) => {
      toast.success(k === "post" ? "Posted — stock updated" : k === "cancel" ? "Draft cancelled" : "Reversed");
      setConfirm(null); setReason("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const p = data?.product as { name: string; sku: string; uom: { code: string } } | undefined;
  const v = data?.variant as { name: string } | null | undefined;
  const w = data?.warehouse as { code: string; name: string } | undefined;
  const title = String(data?.doc_no ?? "Assembly order");

  return (
    <>
      <ErpDialog
        open
        onRequestClose={onClose}
        title={title}
        subtitle={data ? `${KIND_LABEL[kind]} · ${formatDate(data.doc_date as string)}` : undefined}
        icon={kind === "ASSEMBLY" ? <Hammer className="h-4 w-4" /> : <Unplug className="h-4 w-4" />}
        status={<Badge tone={STATUS_TONE[status]}>{humanize(status)}</Badge>}
        size="xl"
        footer={
          <>
            {status === "DRAFT" && can(P.inventoryAssemble) && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm("cancel")}>Cancel draft</Button>}
            {status === "POSTED" && can(P.inventoryPost) && <Button variant="destructive-ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("reverse")}>Reverse</Button>}
            <div className="flex-1" />
            <Button onClick={onClose}>Close</Button>
            {status === "DRAFT" && can(P.inventoryAssemble) && <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
            {status === "DRAFT" && can(P.inventoryAssemble) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("post")}>Post</Button>}
          </>
        }
      >
        {loading ? <Skeleton className="h-48" /> : error ? <p className="text-sm text-danger">{friendlyError(error)}</p> : data ? (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <KeyValue label={kind === "ASSEMBLY" ? "Item built" : "Item taken apart"}>
                <span className="font-medium">{p?.name}</span>{v ? <span className="text-ink-muted"> · {v.name}</span> : null}
              </KeyValue>
              <KeyValue label="Quantity"><span className="font-semibold tabular-nums">{fmt(Number(data.quantity))}</span> {p?.uom?.code}</KeyValue>
              <KeyValue label="Warehouse">{w ? `${w.code} · ${w.name}` : null}</KeyValue>
              <KeyValue label="Reference">{(data.reference as string) || null}</KeyValue>
              {data.posted_at ? <KeyValue label="Posted">{formatDateTime(data.posted_at as string)}</KeyValue> : null}
              {data.reversal_reason ? <KeyValue label="Reversal reason" className="col-span-2">{String(data.reversal_reason)}</KeyValue> : null}
              {data.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-4">{String(data.notes)}</KeyValue> : null}
            </dl>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "components", label: `Components (${comps.length})` },
                ...(can(P.labourSupervise) || can(P.payrollView) ? [{ key: "labour", label: "Labour" }] : []),
                ...(status === "POSTED" || status === "REVERSED" ? [{ key: "moves", label: "Stock movements" }] : []),
                { key: "files", label: filesLabel(files.data?.length) }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : []),
              ]}
            />
            {tab === "components" && (
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">Component</th><th className="px-3">Variant</th>
                    <th className="px-3 text-right">{kind === "ASSEMBLY" ? "Used" : "Returned to stock"}</th>
                  </tr></thead>
                  <tbody>
                    {comps.map((c, i) => {
                      const pr = names.data?.products.get(c.product_id);
                      return (
                        <tr key={i} className="border-b border-line/70 last:border-0">
                          <td className="h-row px-3"><div className="font-medium">{pr?.name ?? "…"}</div><div className="text-2xs text-ink-muted">{pr?.sku}</div></td>
                          <td className="px-3 text-xs">{c.variant_id ? names.data?.variants.get(c.variant_id) : <span className="text-ink-faint">—</span>}</td>
                          <td className={cn("px-3 text-right tabular-nums", kind === "ASSEMBLY" ? "text-danger" : "text-success")}>
                            {kind === "ASSEMBLY" ? "−" : "+"}{fmt(Number(c.quantity))} <span className="text-2xs text-ink-faint">{pr?.uom?.code}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {tab === "moves" && <MovementsTable sourceId={id} />}
            {tab === "history" && <AuditTimeline table="assembly_orders" id={id} />}
            {tab === "labour" && <AssemblyLabourPanel orderId={id} status={status} quantity={Number(data.quantity)} />}
            {tab === "files" && <AttachmentsPanel entityType="assembly_orders" entityId={id} />}
          </>
        ) : null}
      </ErpDialog>
      <ConfirmDialog
        open={confirm === "post"}
        title={`Post ${title}?`}
        message={kind === "ASSEMBLY"
          ? "Components will be taken out of stock and the finished items added, in one step. Mistakes are corrected by reversal."
          : "The finished items will be taken out of stock and the components added back, in one step. Mistakes are corrected by reversal."}
        confirmLabel="Post now"
        loading={action.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => action.mutate("post")}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        title="Cancel this draft?"
        message="The draft is kept for history but can no longer be posted."
        tone="destructive"
        confirmLabel="Cancel draft"
        cancelLabel="Keep draft"
        loading={action.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => action.mutate("cancel")}
      />
      <ConfirmDialog
        open={confirm === "reverse"}
        title={`Reverse ${title}?`}
        message="Equal and opposite stock movements will be posted. The original stays in history."
        tone="destructive"
        confirmLabel="Reverse"
        loading={action.isPending}
        onCancel={() => { setConfirm(null); setReason(""); }}
        onConfirm={() => (reason.trim() ? action.mutate("reverse") : toast.error("Enter a reason"))}
      >
        <Field label="Reason" required className="mt-3">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being reversed?" />
        </Field>
      </ConfirmDialog>
    </>
  );
}

/* ================================================================== FORM */
function OrderForm({ id, initial, onCancel, onClose, onSaved }: { id: string | null; initial: Row | null; onCancel: () => void; onClose: () => void; onSaved: (id: string) => void }) {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const idem = React.useRef(crypto.randomUUID());

  const init = React.useMemo<FormState>(() => ({
    kind: ((initial?.kind as Kind) ?? "ASSEMBLY") as Kind,
    warehouse_id: (initial?.warehouse_id as string) ?? null,
    doc_date: (initial?.doc_date as string) ?? new Date().toISOString().slice(0, 10),
    product_id: (initial?.product_id as string) ?? null,
    variant_id: (initial?.variant_id as string) ?? null,
    quantity: initial ? String(Number(initial.quantity)) : "1",
    reference: (initial?.reference as string) ?? "",
    notes: (initial?.notes as string) ?? "",
    comps: ((initial?.components as { product_id: string; variant_id: string | null; quantity: number }[]) ?? []).map((c) => ({
      key: crypto.randomUUID(), product_id: c.product_id, variant_id: c.variant_id, quantity: String(Number(c.quantity)),
    })) as Comp[],
    custom: !!initial, // an existing draft keeps its saved list until "Reset to standard"
  }), [initial]);

  const [h, setHState] = React.useState<FormState>(init);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setHState((s) => ({ ...s, [k]: v }));
  const [showErrors, setShowErrors] = React.useState(false);
  const snapshot = React.useRef(JSON.stringify(init));
  const dirty = JSON.stringify(h) !== snapshot.current;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const meta = useProductMeta(h.product_id);
  const qty = num(h.quantity);
  const qtyOk = h.quantity.trim() !== "" && !Number.isNaN(qty) && qty > 0;
  const variantReady = !!h.product_id && !!meta.data && (!meta.data.has_variants || !!h.variant_id);

  // standard component list (per one unit) for the chosen item
  const bom = useQuery({
    queryKey: ["bom", h.product_id, h.variant_id],
    enabled: variantReady,
    queryFn: async () => {
      const { data, error } = await sb().rpc("product_bom", { p_product_id: h.product_id, p_variant_id: h.variant_id });
      if (error) throw error;
      return (data ?? []) as { component_product_id: string; component_variant_id: string | null; quantity: number }[];
    },
  });
  // keep the list in step with item × quantity until the user edits it
  React.useEffect(() => {
    if (h.custom || !bom.data) return;
    setHState((s) => ({
      ...s,
      comps: bom.data!.map((b) => ({
        key: `${b.component_product_id}|${b.component_variant_id ?? ""}`,
        product_id: b.component_product_id,
        variant_id: b.component_variant_id,
        quantity: qtyOk ? String(+(Number(b.quantity) * qty).toFixed(4)) : "",
      })),
    }));
  }, [bom.data, h.custom, qty, qtyOk]);

  const setComp = (key: string, patch: Partial<Comp>) => setHState((s) => ({ ...s, custom: true, comps: s.comps.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const errors: Record<string, string> = {};
  if (!h.warehouse_id) errors.warehouse_id = "Required";
  if (!h.product_id) errors.product_id = "Select the item";
  if (!qtyOk) errors.quantity = "Enter a quantity";
  for (const c of h.comps) {
    if (!c.product_id) errors[`${c.key}.p`] = "Select a component";
    const q = num(c.quantity);
    if (c.quantity.trim() === "" || Number.isNaN(q) || q <= 0) errors[`${c.key}.q`] = "Must be more than 0";
  }
  if (variantReady && bom.data && h.comps.length === 0) errors.comps = "This item has no components yet. Add them on the product's Components tab, or add them below.";
  const err = (k: string) => (showErrors ? errors[k] : undefined);

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const { data, error } = await sb().rpc("save_assembly_order", {
        p_id: id,
        p_header: { company_id: companyId, kind: h.kind, warehouse_id: h.warehouse_id, doc_date: h.doc_date, product_id: h.product_id, variant_id: h.variant_id, quantity: h.quantity.replace(/,/g, ""), reference: h.reference || null, notes: h.notes || null },
        p_components: h.comps.map((c) => ({ product_id: c.product_id, variant_id: c.variant_id, quantity: c.quantity.replace(/,/g, "") })),
        p_idempotency_key: id ? null : idem.current,
      });
      if (error) throw error;
      const newId = data as string;
      if (andPost) {
        const r = await sb().rpc("post_assembly_order", { p_id: newId });
        if (r.error) throw Object.assign(r.error, { savedId: newId });
      }
      return { id: newId, posted: andPost };
    },
    onSuccess: ({ id: nid, posted }) => {
      snapshot.current = JSON.stringify(h);
      idem.current = crypto.randomUUID();
      toast.success(posted ? "Posted — stock updated" : "Draft saved");
      qc.invalidateQueries();
      onSaved(nid);
    },
    onError: (e: Error & { savedId?: string }) => {
      if (e.savedId) {
        snapshot.current = JSON.stringify(h);
        toast.error(`Saved as draft, but not posted: ${friendlyError(e)}`);
        qc.invalidateQueries();
        onSaved(e.savedId);
      } else toast.error(friendlyError(e));
    },
  });
  const submit = (andPost: boolean) => {
    setShowErrors(true);
    if (Object.keys(errors).length) { toast.error("Please fix the highlighted fields"); return; }
    if (!save.isPending) save.mutate(andPost);
  };

  const building = h.kind === "ASSEMBLY";
  return (
    <>
      <ErpDialog
        open
        onRequestClose={() => guard(onClose)}
        title={id ? `Edit ${String(initial?.doc_no ?? "")}` : "New Assembly Order"}
        icon={building ? <Hammer className="h-4 w-4" /> : <Unplug className="h-4 w-4" />}
        status={<Badge tone="warning">Draft</Badge>}
        size="xl"
        footer={
          <>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1" />
            <Button onClick={() => guard(onCancel)}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)}>Save draft</Button>
            {can(P.inventoryAssemble) && (
              <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={() => submit(true)}>Save & post</Button>
            )}
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-control border border-line bg-subtle p-0.5" role="radiogroup" aria-label="Type">
            {(["ASSEMBLY", "DISASSEMBLY"] as Kind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={h.kind === k} onClick={() => set("kind", k)}
                className={cn("flex h-[28px] items-center gap-1.5 rounded-[6px] px-3 text-xs font-medium", h.kind === k ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>
                {k === "ASSEMBLY" ? <Hammer className="h-3.5 w-3.5" /> : <Unplug className="h-3.5 w-3.5" />}{KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <span className="text-xs text-ink-muted">
            {building ? "Components are taken out of stock and the finished item is added." : "The finished item is taken out of stock and its components are added back."}
          </span>
        </div>

        <FormGrid cols={4}>
          <Field label="Warehouse" required error={err("warehouse_id")}><WarehousePicker value={h.warehouse_id} onChange={(v) => set("warehouse_id", v)} invalid={!!err("warehouse_id")} /></Field>
          <Field label="Date" required><Input type="date" value={h.doc_date} onChange={(e) => set("doc_date", e.target.value)} /></Field>
          <Field label="Reference"><Input value={h.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Job no., note…" /></Field>
          <div />
          <Field label={building ? "Item to build" : "Item to take apart"} required error={err("product_id")} className="sm:col-span-2">
            <ProductPicker warehouseId={h.warehouse_id} filters={{ is_assembled: true }} placeholder="Search assembled item…" value={h.product_id}
              onChange={(v) => setHState((s) => ({ ...s, product_id: v, variant_id: null, custom: false }))} invalid={!!err("product_id")} />
          </Field>
          <Field label="Variant">
            <VariantPicker productId={h.product_id} warehouseId={h.warehouse_id} value={h.variant_id} onChange={(v) => setHState((s) => ({ ...s, variant_id: v, custom: false }))} />
          </Field>
          <Field label="Quantity" required error={err("quantity")}>
            <div className="flex items-center gap-1.5">
              <Input inputMode="decimal" className="text-right tabular-nums" value={h.quantity} invalid={!!err("quantity")} onChange={(e) => set("quantity", e.target.value)} />
              <span className="w-9 shrink-0 text-2xs text-ink-faint">{meta.data?.uom ?? ""}</span>
            </div>
          </Field>
        </FormGrid>
        {!building && variantReady && <FinishedStock warehouseId={h.warehouse_id} productId={h.product_id} variantId={h.variant_id} need={qtyOk ? qty : 0} />}

        <div className="mt-2">
          <SectionTitle
            action={
              <div className="flex gap-1.5">
                {h.custom && variantReady && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => set("custom", false)}>Reset to standard</Button>}
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setHState((s) => ({ ...s, custom: true, comps: [...s.comps, { key: crypto.randomUUID(), product_id: null, variant_id: null, quantity: "" }] }))}>Add component</Button>
              </div>
            }
          >
            {building ? "Components used" : "Components returned to stock"}
          </SectionTitle>
          {!variantReady ? (
            <p className="text-xs text-ink-muted">Choose the item{meta.data?.has_variants ? " and variant" : ""} — its standard components fill in automatically.</p>
          ) : (
            <>
              {err("comps") && <p className="mb-2 text-xs text-danger">{err("comps")}</p>}
              {h.custom && <p className="mb-2 text-xs text-ink-muted">Quantities edited by hand — they no longer follow the item quantity.</p>}
              <div className="space-y-2">
                {h.comps.map((c) => (
                  <CompRow key={c.key} c={c} kind={h.kind} warehouseId={h.warehouse_id} error={err(`${c.key}.p`) ?? err(`${c.key}.q`)}
                    onChange={(patch) => setComp(c.key, patch)}
                    onRemove={() => setHState((s) => ({ ...s, custom: true, comps: s.comps.filter((x) => x.key !== c.key) }))} />
                ))}
              </div>
            </>
          )}
        </div>
        <Field label="Notes" className="mt-3"><Textarea rows={2} value={h.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <p className="mt-2 text-xs text-ink-muted">Assembly labour (piece-rate pay per item) will be added in the Payroll stage.</p>
      </ErpDialog>
      {dialog}
    </>
  );
}

function FinishedStock({ warehouseId, productId, variantId, need }: { warehouseId: string | null; productId: string | null; variantId: string | null; need: number }) {
  const s = useStockFigures(warehouseId, productId, variantId);
  if (!s.ready || !s.data) return null;
  const av = Number(s.data.available);
  return <p className={cn("mt-1 text-xs tabular-nums", av < need ? "text-danger" : "text-ink-muted")}>Available to take apart: {fmt(av)} {s.meta.data?.uom}</p>;
}

function CompRow({ c, kind, warehouseId, error, onChange, onRemove }: {
  c: Comp; kind: Kind; warehouseId: string | null; error?: string; onChange: (p: Partial<Comp>) => void; onRemove: () => void;
}) {
  const meta = useProductMeta(c.product_id);
  const s = useStockFigures(warehouseId, c.product_id, c.variant_id);
  const q = num(c.quantity);
  const av = s.data ? Number(s.data.available) : null;
  const short = kind === "ASSEMBLY" && av !== null && !Number.isNaN(q) && q > av;
  return (
    <div className="grid grid-cols-12 items-start gap-2 rounded-control border border-line bg-surface p-2">
      <div className="col-span-12 md:col-span-5">
        <ProductPicker warehouseId={warehouseId} filters={{ is_bundle: false }} placeholder="Component…" value={c.product_id} onChange={(v) => onChange({ product_id: v, variant_id: null })} invalid={!!error && !c.product_id} />
      </div>
      <div className="col-span-6 md:col-span-3">
        <VariantPicker productId={c.product_id} warehouseId={warehouseId} value={c.variant_id} onChange={(v) => onChange({ variant_id: v })} />
      </div>
      <div className="col-span-5 md:col-span-3">
        <div className="flex items-center gap-1.5">
          <Input inputMode="decimal" className="text-right tabular-nums" value={c.quantity} invalid={!!error && !!c.product_id} onChange={(e) => onChange({ quantity: e.target.value })} aria-label="Component quantity" />
          <span className="w-9 shrink-0 text-2xs text-ink-faint">{meta.data?.uom ?? ""}</span>
        </div>
        {error ? <p className="mt-0.5 text-2xs text-danger">{error}</p> : av !== null && (
          <p className={cn("mt-0.5 whitespace-nowrap text-2xs tabular-nums", short ? "text-danger" : "text-ink-muted")}>
            Avail {fmt(av)}{short ? " — not enough" : ""}
          </p>
        )}
      </div>
      <div className="col-span-1 flex justify-end">
        <Button size="icon-sm" variant="ghost" aria-label="Remove component" onClick={onRemove}><Trash2 className="h-3.5 w-3.5 text-ink-faint" /></Button>
      </div>
    </div>
  );
}
