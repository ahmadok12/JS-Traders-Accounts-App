import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, ClipboardCheck, Lock, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input,
  KeyValue, PageHeader, SearchableSelect, SectionTitle, Skeleton, Textarea, cn,
} from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatNumber, humanize } from "@jst/utilities";
import { JobTeamPanel } from "../picking/WarehouseJobs";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "./DocPage";
import { STATUS_TONE } from "./docConfigs";
import { useStorageLocations } from "../lib/settings";
import { LocationPicker, ProductPicker, VariantPicker, WarehousePicker } from "./pickers";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";

type Row = Record<string, unknown> & { id: string };
const FILTERS = [
  { label: "Open", status: "OPEN" },
  { label: "Closed", status: "CLOSED" },
  { label: "All", status: undefined },
];
const COUNT_TYPES = [
  { value: "INITIAL_COUNT", label: "Initial count (onboarding)" },
  { value: "COUNT_CORRECTION", label: "Cycle / correction count" },
];
const icon = <ClipboardCheck className="h-4 w-4" />;
const qty = (v: unknown) => (v === null || v === undefined || v === "" ? "" : formatNumber(Number(v), Number.isInteger(Number(v)) ? 0 : 2));

export function CountsPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";

  const list = useEntityList<Row>({
    table: "stock_counts",
    select: "id, doc_no, doc_date, status, count_type, notes, submitted_at, warehouse:warehouses(code, name), lines:stock_count_lines(count)",
    companyId,
    search: q,
    searchColumns: ["doc_no", "notes"],
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false },
    page,
    pageSize: 25,
    enabled: can(P.inventoryView),
  });
  if (!can(P.inventoryView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Stock Counts"
        icon={icon}
        description="Progressive physical counting: count some items today, more tomorrow. Each approved line adjusts stock to what was counted."
        actions={can(P.inventoryCount) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1" })}>New Count</Button>}
      />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search count no. / notes…" />
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
              { key: "doc", header: "Count", width: "150px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "d", header: "Started", width: "110px", cell: (r) => formatDate(r.doc_date as string) },
              { key: "w", header: "Warehouse", cell: (r) => { const w = r.warehouse as { code: string; name: string }; return <span><span className="font-mono text-xs text-ink-muted">{w.code}</span> {w.name}</span>; } },
              { key: "t", header: "Type", hideBelow: "md", cell: (r) => COUNT_TYPES.find((c) => c.value === r.count_type)?.label ?? String(r.count_type) },
              { key: "n", header: "Notes", hideBelow: "lg", cell: (r) => <span className="text-xs text-ink-muted">{(r.notes as string) || ""}</span> },
              { key: "l", header: "Items", align: "right", width: "70px", cell: (r) => (r.lines as { count: number }[])?.[0]?.count ?? 0 },
              { key: "s", header: "Status", width: "170px", cell: (r) => <span className="flex flex-wrap gap-1"><Badge tone={STATUS_TONE[String(r.status)]}>{humanize(String(r.status))}</Badge>{r.status === "OPEN" && !!r.submitted_at && <Badge tone="info">Counted — approve</Badge>}</span> },
            ]}
            empty={<EmptyState icon={icon} title="No counts" description="Start a count to establish or verify physical stock." />}
          />
        )}
      </Card>
      {creating && <NewCountDialog onClose={() => update({ new: null })} onCreated={(id) => update({ new: null, view: id })} />}
      {viewId && <CountDialog id={viewId} onClose={() => update({ view: null })} />}
    </div>
  );
}

function NewCountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [wh, setWh] = React.useState<string | null>(null);
  const [type, setType] = React.useState<string | null>("INITIAL_COUNT");
  const [load, setLoad] = React.useState(true);
  const [notes, setNotes] = React.useState("");
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("create_stock_count", { p_company_id: companyId, p_warehouse_id: wh, p_count_type: type, p_notes: notes || null, p_load_stocked_items: load });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { toast.success("Count started"); qc.invalidateQueries({ queryKey: ["list", "stock_counts"] }); onCreated(id); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog
      open
      onRequestClose={onClose}
      title="New Stock Count"
      icon={icon}
      size="md"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!wh} loading={create.isPending} onClick={() => create.mutate()}>Start count</Button></>}
    >
      <FormGrid cols={2}>
        <Field label="Warehouse" required><WarehousePicker value={wh} onChange={setWh} /></Field>
        <Field label="Count type" required><SearchableSelect value={type} onChange={setType} options={COUNT_TYPES} clearable={false} /></Field>
        <div className="sm:col-span-2 pb-3">
          <Checkbox checked={load} onChange={setLoad} label="Pre-fill items that currently have stock in this warehouse" description="You can add any other item while counting." />
        </div>
        <Field label="Notes / scope" className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Rack A only" /></Field>
      </FormGrid>
    </ErpDialog>
  );
}

interface CountLine {
  id: string;
  product_id: string;
  variant_id: string | null;
  location_id: string | null;
  counted_qty: number | null;
  status: "PENDING" | "COUNTED" | "POSTED";
  system_qty_before: number | null;
  adjustment_qty: number | null;
  variance_note: string | null;
  product: { sku: string; name: string; uom: { code: string } };
  variant: { name: string } | null;
  location: { code: string } | null;
}

function CountDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState("lines");
  const files = useAttachments("stock_counts", id);
  const [edits, setEdits] = React.useState<Record<string, { counted_qty?: string; variance_note?: string; remove?: boolean }>>({});
  const [confirm, setConfirm] = React.useState<null | "post" | "close" | "cancel">(null);
  const locOn = useStorageLocations().enabled;
  const [adding, setAdding] = React.useState<{ product_id: string | null; variant_id: string | null; location_id: string | null; counted_qty: string }>({ product_id: null, variant_id: null, location_id: null, counted_qty: "" });

  const doc = useQuery({
    queryKey: ["record", "stock_counts", id],
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from("stock_counts").select("id, doc_no, doc_date, status, count_type, notes, warehouse_id, closed_at, submitted_at, submitted_by, submit_note, warehouse:warehouses(code, name)").eq("id", id).single(),
        sb().from("stock_count_lines").select("id, product_id, variant_id, location_id, counted_qty, status, system_qty_before, adjustment_qty, variance_note, product:products(sku, name, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name), location:warehouse_locations(code)").eq("count_id", id).limit(1000),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      const lines = (l.data as unknown as CountLine[]).sort((a, b) => a.product.name.localeCompare(b.product.name) || (a.variant?.name ?? "").localeCompare(b.variant?.name ?? ""));
      return { header: h.data as unknown as Row, lines };
    },
  });

  // Approvers see live system qty; counters count blind (no bias from system figures).
  const showSystem = can(P.inventoryPost);
  const wh = doc.data?.header.warehouse_id as string | undefined;
  const balances = useQuery({
    queryKey: ["count-balances", id, doc.data?.lines.length],
    enabled: showSystem && !!wh && !!doc.data?.lines.length,
    queryFn: async () => {
      const ids = Array.from(new Set(doc.data!.lines.map((l) => l.product_id)));
      const { data, error } = await sb().from("stock_balances").select("product_id, variant_id, location_id, on_hand").eq("warehouse_id", wh!).in("product_id", ids);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const b of data ?? []) m.set(`${b.product_id}|${b.variant_id ?? ""}|${b.location_id ?? ""}`, Number(b.on_hand));
      return m;
    },
  });

  const status = String(doc.data?.header.status ?? "OPEN");
  const open = status === "OPEN";
  const canCount = open && can(P.inventoryCount);
  const dirty = Object.keys(edits).length > 0;
  const { guard, dialog } = useUnsavedGuard(dirty);

  const saveLines = useMutation({
    mutationFn: async () => {
      const payload = Object.entries(edits).map(([lid, e]) => {
        const line = doc.data!.lines.find((l) => l.id === lid)!;
        return {
          id: lid,
          remove: e.remove ?? false,
          counted_qty: e.counted_qty !== undefined ? e.counted_qty.replace(/,/g, "").trim() : line.counted_qty,
          variance_note: e.variance_note !== undefined ? e.variance_note : line.variance_note,
        };
      });
      const { error } = await sb().rpc("save_stock_count_lines", { p_count_id: id, p_lines: payload });
      if (error) throw error;
    },
    onSuccess: () => { setEdits({}); toast.success("Counts saved"); qc.invalidateQueries({ queryKey: ["record", "stock_counts", id] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const addLine = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("save_stock_count_lines", {
        p_count_id: id,
        p_lines: [{ product_id: adding.product_id, variant_id: adding.variant_id, location_id: adding.location_id, counted_qty: adding.counted_qty.trim() || null }],
      });
      if (error) throw error;
    },
    onSuccess: () => { setAdding({ product_id: null, variant_id: null, location_id: null, counted_qty: "" }); qc.invalidateQueries({ queryKey: ["record", "stock_counts", id] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const action = useMutation({
    mutationFn: async (kind: "post" | "close" | "cancel") => {
      const r = kind === "post"
        ? await sb().rpc("post_stock_count", { p_count_id: id })
        : await sb().rpc("close_stock_count", { p_count_id: id, p_cancel: kind === "cancel" });
      if (r.error) throw r.error;
      return r.data as { posted_lines?: number; adjusted_lines?: number } | null;
    },
    onSuccess: (d, kind) => {
      toast.success(kind === "post" ? `${d?.posted_lines ?? 0} line(s) approved, ${d?.adjusted_lines ?? 0} stock adjustment(s) posted` : kind === "close" ? "Count closed" : "Count cancelled");
      setConfirm(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const lines = doc.data?.lines ?? [];
  const showLoc = locOn || lines.some((l) => l.location_id);
  const counted = lines.filter((l) => l.status === "COUNTED").length;
  const posted = lines.filter((l) => l.status === "POSTED").length;
  const pending = lines.length - counted - posted;
  const h = doc.data?.header;
  const setEdit = (lid: string, patch: { counted_qty?: string; variance_note?: string; remove?: boolean }) =>
    setEdits((e) => ({ ...e, [lid]: { ...e[lid], ...patch } }));

  return (
    <>
      <ErpDialog
        open
        onRequestClose={() => guard(onClose)}
        size="full"
        accent="dispatch"
        icon={icon}
        title={h ? String(h.doc_no) : "Stock Count"}
        subtitle={h ? `${(h.warehouse as { name: string }).name} · ${COUNT_TYPES.find((c) => c.value === h.count_type)?.label}` : undefined}
        status={<Badge tone={STATUS_TONE[status]}>{humanize(status)}</Badge>}
        footer={
          <>
            {open && can(P.inventoryPost) && posted === 0 && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm("cancel")}>Cancel count</Button>}
            {dirty && <span className="text-xs text-warning">Unsaved counts</span>}
            <div className="flex-1" />
            <Button onClick={() => guard(onClose)}>Close</Button>
            {canCount && <Button icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} loading={saveLines.isPending} onClick={() => saveLines.mutate()}>Save counts</Button>}
            {open && can(P.inventoryPost) && posted > 0 && (
              <Button icon={<Lock className="h-3.5 w-3.5" />} onClick={() => setConfirm("close")}>Close count</Button>
            )}
            {open && can(P.inventoryPost) && (
              <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={counted === 0 || dirty} title={dirty ? "Save counts first" : undefined} onClick={() => setConfirm("post")}>
                Approve {counted || ""} counted
              </Button>
            )}
          </>
        }
      >
        {doc.isLoading ? <Skeleton className="h-48" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <KeyValue label="Started">{formatDate(h!.doc_date as string)}</KeyValue>
              <KeyValue label="Pending"><span className="tabular-nums">{pending}</span></KeyValue>
              <KeyValue label="Counted (awaiting approval)"><span className="tabular-nums">{counted}</span></KeyValue>
              <KeyValue label="Approved"><span className="tabular-nums">{posted}</span></KeyValue>
              {h!.notes ? <KeyValue label="Notes">{String(h!.notes)}</KeyValue> : null}
            </dl>
            <JobTeamPanel jobType="COUNT" jobId={id} warehouseId={String(h!.warehouse_id)} editable={open}
              submitted={h!.submitted_at ? { at: h!.submitted_at as string, by: h!.submitted_by as string | null, note: h!.submit_note as string | null } : null} />
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-field">
              <div className="h-full bg-success" style={{ width: `${lines.length ? (posted / lines.length) * 100 : 0}%` }} />
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.length})` }, { key: "files", label: filesLabel(files.data?.length) }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : [])]} />
            {tab === "files" ? <AttachmentsPanel entityType="stock_counts" entityId={id} /> : tab === "history" ? <AuditTimeline table="stock_counts" id={id} /> : (
              <>
                {!showSystem && open && <p className="mb-2 text-xs text-ink-muted">Blind count: system quantities are hidden so the count reflects what is physically there.</p>}
                <div className="overflow-auto rounded-card border border-line">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                        <th className="h-8 px-3">Item</th>
                        {showLoc && <th className="px-3">Loc.</th>}
                        {showSystem && <th className="px-3 text-right">System</th>}
                        <th className="w-32 px-3 text-right">Counted</th>
                        {showSystem && <th className="px-3 text-right">Variance</th>}
                        <th className="hidden px-3 md:table-cell">Note</th>
                        <th className="px-3">Status</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const e = edits[l.id];
                        if (e?.remove) return null;
                        const sys = l.status === "POSTED" ? Number(l.system_qty_before) : balances.data?.get(`${l.product_id}|${l.variant_id ?? ""}|${l.location_id ?? ""}`) ?? 0;
                        const cv = e?.counted_qty !== undefined ? e.counted_qty : l.counted_qty === null ? "" : String(Number(l.counted_qty));
                        const variance = cv.trim() === "" || Number.isNaN(Number(cv)) ? null : Number(cv) - sys;
                        const editable = canCount && l.status !== "POSTED";
                        const td = "h-row border-b border-line/70 px-3";
                        return (
                          <tr key={l.id} className={cn(e && "bg-warning-soft/30")}>
                            <td className={td}><div className="font-medium">{l.product.name}{l.variant ? <span className="font-normal text-ink-muted"> · {l.variant.name}</span> : null}</div><div className="text-2xs text-ink-muted">{l.product.sku}</div></td>
                            {showLoc && <td className={cn(td, "text-xs")}>{l.location?.code ?? <span className="text-ink-faint">—</span>}</td>}
                            {showSystem && <td className={cn(td, "text-right tabular-nums text-ink-muted")}>{qty(sys)}</td>}
                            <td className={cn(td, "text-right")}>
                              {editable ? (
                                <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" value={cv} placeholder="—" onChange={(ev) => setEdit(l.id, { counted_qty: ev.target.value })} aria-label={`Counted quantity for ${l.product.name}`} />
                              ) : <span className="tabular-nums">{qty(l.counted_qty)}</span>}
                            </td>
                            {showSystem && <td className={cn(td, "text-right tabular-nums", variance === null ? "" : variance < 0 ? "text-danger" : variance > 0 ? "text-success" : "text-ink-faint")}>{variance === null ? "" : `${variance > 0 ? "+" : ""}${qty(variance)}`}</td>}
                            <td className={cn(td, "hidden md:table-cell")}>
                              {editable ? <Input className="h-control-sm text-xs" value={e?.variance_note ?? l.variance_note ?? ""} onChange={(ev) => setEdit(l.id, { variance_note: ev.target.value })} placeholder="Note" /> : <span className="text-xs text-ink-muted">{l.variance_note}</span>}
                            </td>
                            <td className={td}><Badge tone={STATUS_TONE[l.status]}>{l.status === "POSTED" ? "Approved" : humanize(l.status)}</Badge></td>
                            <td className={td}>{editable && <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setEdit(l.id, { remove: true })}><Trash2 className="h-3.5 w-3.5 text-ink-faint" /></Button>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {lines.length === 0 && <p className="py-6 text-center text-xs text-ink-muted">No items yet — add the items you are counting below.</p>}
                </div>
                {canCount && (
                  <div className="mt-3 rounded-card border border-dashed border-line-strong p-2">
                    <SectionTitle>Add item to count</SectionTitle>
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-12 md:col-span-4"><ProductPicker showStock={false} value={adding.product_id} onChange={(v) => setAdding((a) => ({ ...a, product_id: v, variant_id: null }))} /></div>
                      <div className={cn("col-span-6", locOn ? "md:col-span-3" : "md:col-span-5")}><VariantPicker showStock={false} productId={adding.product_id} value={adding.variant_id} onChange={(v) => setAdding((a) => ({ ...a, variant_id: v }))} /></div>
                      {locOn && <div className="col-span-6 md:col-span-2"><LocationPicker warehouseId={wh ?? null} value={adding.location_id} onChange={(v) => setAdding((a) => ({ ...a, location_id: v }))} /></div>}
                      <div className="col-span-8 md:col-span-2"><Input inputMode="decimal" className="text-right" placeholder="Counted" value={adding.counted_qty} onChange={(e) => setAdding((a) => ({ ...a, counted_qty: e.target.value }))} /></div>
                      <div className="col-span-4 md:col-span-1"><Button className="w-full justify-center" icon={<Plus className="h-3.5 w-3.5" />} disabled={!adding.product_id} loading={addLine.isPending} onClick={() => addLine.mutate()}>Add</Button></div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </ErpDialog>
      {dialog}
      <ConfirmDialog
        open={confirm === "post"}
        title={`Approve ${counted} counted line(s)?`}
        message="For each line, stock is set to the counted quantity: the system posts an adjustment for the difference (captured at this moment). Approved lines are frozen."
        confirmLabel="Approve & post"
        loading={action.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => action.mutate("post")}
      />
      <ConfirmDialog open={confirm === "close"} title="Close this count?" message="No more lines can be added or approved." confirmLabel="Close count" loading={action.isPending} onCancel={() => setConfirm(null)} onConfirm={() => action.mutate("close")} />
      <ConfirmDialog open={confirm === "cancel"} title="Cancel this count?" message="Nothing has been approved yet, so stock is not affected." tone="destructive" confirmLabel="Cancel count" cancelLabel="Keep count" loading={action.isPending} onCancel={() => setConfirm(null)} onConfirm={() => action.mutate("cancel")} />
    </>
  );
}
