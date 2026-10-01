import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, ClipboardList, ExternalLink, Plus, ShieldAlert, Smartphone, Truck, UserRoundCog } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, SearchableSelect, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { n, qtyFmt, useWarehouses } from "../sales/common";
import { EVENT_LABEL, PICK_TONE, PickLineCard, PickProgress, pickLabel, useAssignees, usePickingTask } from "./common";

type Row = Record<string, unknown> & { id: string };
const FILTERS = [
  { label: "Open", statuses: ["OPEN", "IN_PROGRESS"] },
  { label: "Picked — make GDN", status: "DONE", needsGdn: true },
  { label: "Picked", status: "DONE" },
  { label: "Cancelled", status: "CANCELLED" },
  { label: "All" },
] as { label: string; status?: string; statuses?: string[]; needsGdn?: boolean }[];
const icon = <ClipboardList className="h-4 w-4" />;

export function PickingPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const f = Number(params.get("f") ?? "0") || 0;
  const page = Number(params.get("page") ?? "1") || 1;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";
  const soParam = params.get("so");
  const allowed = can(P.pickingManage);
  const people = useAssignees();
  const names = new Map((people.data ?? []).map((p) => [p.user_id, p.full_name]));
  const list = useEntityList<Row>({
    table: "picking_tasks",
    select: "id, doc_no, so_doc_no, status, assigned_to, due_date, created_at, gdn_id, warehouse:warehouses(code), lines:picking_task_lines(qty_picked)",
    companyId, search: q, searchColumns: ["doc_no", "so_doc_no"],
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: allowed,
  });
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const flt = FILTERS[f];
  const rows = (list.data?.rows ?? []).filter((r) => (!flt.statuses || flt.statuses.includes(String(r.status))) && (!flt.needsGdn || !r.gdn_id));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Picking" icon={icon}
        description="Give pickers the items of an approved order, per warehouse. They tick items on their phone (shortages need a reason); you then make the GDN from what was picked."
        actions={<div className="flex gap-2">
          {can(P.pickingPerform) && <Button icon={<Smartphone className="h-4 w-4" />} onClick={() => window.open("/m", "_blank")}>Phone app</Button>}
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New picking task</Button>
        </div>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search task / SO no…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null, so: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "Task", width: "130px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "so", header: "Sales order", width: "130px", cell: (r) => <span className="font-mono text-xs">{String(r.so_doc_no)}</span> },
              { key: "w", header: "From", width: "80px", cell: (r) => <span className="font-mono text-xs">{(r.warehouse as { code: string } | null)?.code}</span> },
              { key: "a", header: "Picker", cell: (r) => r.assigned_to ? names.get(String(r.assigned_to)) ?? "…" : <span className="text-ink-faint">Not assigned</span> },
              { key: "p", header: "Progress", width: "140px", hideBelow: "md", cell: (r) => <PickProgress lines={r.lines as { qty_picked: number | null }[]} /> },
              { key: "d", header: "Due", width: "100px", hideBelow: "lg", cell: (r) => r.due_date ? formatDate(r.due_date as string) : null },
              { key: "s", header: "Status", width: "150px", cell: (r) => <span className="flex items-center gap-1"><Badge tone={PICK_TONE[String(r.status)]}>{pickLabel(String(r.status))}</Badge>{r.status === "DONE" && !r.gdn_id && <Badge tone="warning">GDN due</Badge>}</span> },
            ]}
            empty={<EmptyState icon={icon} title="No picking tasks" description="Open an approved sales order and press “Picking task”, or use “New picking task”." />} />
        )}
      </Card>
      {creating && !viewId && <NewTaskDialog presetSo={soParam} onClose={() => update({ new: null, so: null })} onCreated={(id) => update({ view: id, new: null, so: null })} />}
      {viewId && <TaskDialog id={viewId} names={names} onClose={() => update({ view: null })} />}
    </div>
  );
}

function useOpenOrdersForPicking() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["open-sales-orders-picking", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("sales_orders").select("id, doc_no, order_date, status, customer:customers(name)")
        .eq("company_id", companyId!).in("status", ["APPROVED", "PARTIALLY_DELIVERED"]).order("order_date", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []).map((r) => ({ value: r.id as string, label: `${r.doc_no} · ${(r.customer as unknown as { name: string } | null)?.name ?? ""}`, secondary: formatDate(r.order_date as string) }));
    },
  });
}

interface Pickable { allocation_id: string; warehouse_id: string; product_id: string; variant_id: string | null; line_no: number; ordered: number; delivered: number; in_picking: number; pickable: number }
function NewTaskDialog({ presetSo, onClose, onCreated }: { presetSo: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const orders = useOpenOrdersForPicking();
  const whs = useWarehouses();
  const people = useAssignees();
  const [so, setSo] = React.useState<string | null>(presetSo);
  const [wh, setWh] = React.useState<string | null>(null);
  const [who, setWho] = React.useState<string | null>(null);
  const [due, setDue] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const rows = useQuery({
    queryKey: ["so-pickable", so],
    enabled: !!so,
    queryFn: async () => {
      const { data, error } = await sb().rpc("so_pickable", { p_so_id: so });
      if (error) throw error;
      const list = (data ?? []) as Pickable[];
      const pids = Array.from(new Set(list.map((r) => r.product_id)));
      const vids = Array.from(new Set(list.map((r) => r.variant_id).filter(Boolean))) as string[];
      const [p, v] = await Promise.all([
        pids.length ? sb().from("products").select("id, name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)").in("id", pids) : Promise.resolve({ data: [] }),
        vids.length ? sb().from("product_variants").select("id, name").in("id", vids) : Promise.resolve({ data: [] }),
      ]);
      const pm = new Map(((p.data ?? []) as unknown as { id: string; name: string; sku: string; uom: { code: string } | null }[]).map((x) => [x.id, x]));
      const vm = new Map(((v.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
      return list.map((r) => ({ ...r, ordered: Number(r.ordered), delivered: Number(r.delivered), in_picking: Number(r.in_picking), pickable: Number(r.pickable),
        name: pm.get(r.product_id)?.name ?? "…", sku: pm.get(r.product_id)?.sku ?? "", uom: pm.get(r.product_id)?.uom?.code ?? "", variant: r.variant_id ? vm.get(r.variant_id) ?? null : null }));
    },
  });
  const byWh = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows.data ?? []) if (r.pickable > 0) m.set(r.warehouse_id, (m.get(r.warehouse_id) ?? 0) + 1);
    return m;
  }, [rows.data]);
  React.useEffect(() => {
    if (!rows.data) return;
    const first = Array.from(byWh.keys())[0] ?? null;
    setWh((w) => (w && byWh.has(w) ? w : first));
  }, [rows.data, byWh]);
  React.useEffect(() => {
    setQty(Object.fromEntries((rows.data ?? []).filter((r) => r.warehouse_id === wh && r.pickable > 0).map((r) => [r.allocation_id, String(r.pickable)])));
  }, [wh, rows.data]);
  const shown = (rows.data ?? []).filter((r) => r.warehouse_id === wh);
  const bad = shown.some((r) => n(qty[r.allocation_id] ?? "0") > r.pickable || n(qty[r.allocation_id] ?? "0") < 0);
  const chosen = shown.filter((r) => n(qty[r.allocation_id] ?? "0") > 0);
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("create_picking_task", {
        p_header: { company_id: companyId, sales_order_id: so, warehouse_id: wh, assigned_to: who, due_date: due || null, notes },
        p_lines: chosen.map((r) => ({ allocation_id: r.allocation_id, quantity: qty[r.allocation_id].replace(/,/g, "") })),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { toast.success(who ? "Picking task created — it is on the picker's phone now" : "Picking task created"); qc.invalidateQueries(); onCreated(id); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title="New picking task"
      footer={<>
        <div className="flex-1 text-sm text-ink-muted">{chosen.length} item{chosen.length === 1 ? "" : "s"}</div>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!so || !wh || !chosen.length || bad} loading={create.isPending} onClick={() => create.mutate()}>Create task</Button>
      </>}>
      <FormGrid cols={2}>
        <Field label="Sales order" required className="sm:col-span-2">
          <SearchableSelect value={so} options={orders.data ?? []} placeholder={orders.isLoading ? "Loading…" : "Approved sales order…"} onChange={(v) => { setSo(v); setWh(null); }} emptyText="No approved orders" />
        </Field>
        <Field label="Picker">
          <SearchableSelect value={who} options={(people.data ?? []).map((p) => ({ value: p.user_id, label: p.full_name, secondary: p.email }))} placeholder="Assign later…" onChange={setWho} emptyText="Nobody has the picking permission yet" />
        </Field>
        <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </FormGrid>
      {so && (rows.isLoading ? <Skeleton className="h-24" /> : rows.error ? <p className="text-sm text-danger">{friendlyError(rows.error)}</p> : byWh.size === 0 ? (
        <p className="rounded-card border border-dashed border-line p-4 text-center text-sm text-ink-muted">Everything on this order is already picked, in picking or dispatched.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-muted">Pick from</span>
            {Array.from(byWh.keys()).map((w) => (
              <button key={w} onClick={() => setWh(w)} className={cn("rounded-control border px-2.5 py-1 text-xs", wh === w ? "border-primary bg-primary/5 font-medium" : "border-line hover:border-ink-faint")}>
                <span className="font-mono">{whs.data?.find((x) => x.id === w)?.code ?? "…"}</span> · {byWh.get(w)} item{byWh.get(w) === 1 ? "" : "s"}
              </button>
            ))}
          </div>
          <div className="overflow-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <th className="h-8 px-3">Item</th><th className="px-3 text-right">Ordered</th><th className="px-3 text-right">Sent</th><th className="px-3 text-right">In picking</th><th className="w-[120px] px-3 text-right">Pick now</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.allocation_id} className={cn("border-b border-line/70", r.pickable <= 0 && "text-ink-faint")}>
                    <td className="px-3 py-1.5"><div className="font-medium">{r.name}{r.variant && <span className="font-normal text-ink-muted"> · {r.variant}</span>}</div><div className="text-2xs text-ink-muted">{r.sku}</div></td>
                    <td className="px-3 text-right tabular-nums">{qtyFmt(r.ordered)}</td>
                    <td className="px-3 text-right tabular-nums">{qtyFmt(r.delivered)}</td>
                    <td className="px-3 text-right tabular-nums">{qtyFmt(r.in_picking)}</td>
                    <td className="px-3 py-1.5 text-right">{r.pickable > 0
                      ? <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" value={qty[r.allocation_id] ?? ""} invalid={n(qty[r.allocation_id] ?? "0") > r.pickable}
                          onChange={(e) => setQty((s) => ({ ...s, [r.allocation_id]: e.target.value }))} />
                      : <span className="text-2xs">done</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
      <Field label="Note for the picker" className="mt-3"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. load on the Daewoo truck at 4 pm" /></Field>
    </ErpDialog>
  );
}

function TaskDialog({ id, names, onClose }: { id: string; names: Map<string, string>; onClose: () => void }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const doc = usePickingTask(id, 15_000);
  const people = useAssignees();
  const [tab, setTab] = React.useState("lines");
  const [dlg, setDlg] = React.useState<null | "assign" | "cancel" | "complete">(null);
  const [who, setWho] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const h = doc.data?.header;
  const status = String(h?.status ?? "");
  const lines = doc.data?.lines ?? [];
  const open = ["OPEN", "IN_PROGRESS"].includes(status);
  const nameOf = (u: unknown) => (u ? names.get(String(u)) ?? "someone" : "nobody");
  const act = useMutation({
    mutationFn: async (kind: "assign" | "cancel" | "complete" | "gdn") => {
      const r = kind === "assign" ? await sb().rpc("assign_picking_task", { p_id: id, p_user: who, p_note: note || null })
        : kind === "cancel" ? await sb().rpc("cancel_picking_task", { p_id: id, p_reason: note })
        : kind === "complete" ? await sb().rpc("complete_picking_task", { p_id: id, p_note: note || null })
        : await sb().rpc("gdn_from_picking", { p_task_id: id });
      if (r.error) throw r.error;
      return { kind, data: r.data as unknown };
    },
    onSuccess: ({ kind, data }) => {
      toast.success(kind === "assign" ? "Task reassigned — the new picker sees only what is left" : kind === "cancel" ? "Task cancelled" : kind === "complete" ? "Picking finished" : "Draft GDN made from the picked goods — check and dispatch it");
      setDlg(null); setNote(""); qc.invalidateQueries();
      if (kind === "gdn") navigate(`/gdn?view=${data as string}`);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const left = lines.filter((l) => l.qty_picked == null).length;
  return (
    <>
      <ErpDialog open onRequestClose={onClose} size="lg" icon={icon} title={h ? String(h.doc_no) : "Picking task"}
        subtitle={h ? `${String(h.so_doc_no)} · ${(h.warehouse as { code: string } | null)?.code ?? ""}` : undefined}
        status={h ? <Badge tone={PICK_TONE[status]}>{pickLabel(status)}</Badge> : null}
        footer={<>
          {open && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setDlg("cancel")}>Cancel task</Button>}
          <div className="flex-1" />
          {h && <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate(`/sales-orders?view=${h.sales_order_id}`)}>{String(h.so_doc_no)}</Button>}
          {!!h?.gdn_id && <Button icon={<Truck className="h-3.5 w-3.5" />} onClick={() => navigate(`/gdn?view=${h.gdn_id}`)}>GDN</Button>}
          <Button onClick={onClose}>Close</Button>
          {open && <Button icon={<UserRoundCog className="h-3.5 w-3.5" />} onClick={() => { setWho((h?.assigned_to as string | null) ?? null); setDlg("assign"); }}>{h?.assigned_to ? "Reassign" : "Assign"}</Button>}
          {open && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={left > 0} onClick={() => setDlg("complete")}>Finish picking</Button>}
          {status === "DONE" && !h?.gdn_id && can(P.salesDispatch) && <Button variant="primary" icon={<Truck className="h-3.5 w-3.5" />} loading={act.isPending} onClick={() => act.mutate("gdn")}>Make GDN</Button>}
        </>}>
        {doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : h && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <KeyValue label="Picker">{h.assigned_to ? nameOf(h.assigned_to) : <span className="text-warning">Not assigned</span>}</KeyValue>
              <KeyValue label="Warehouse">{(h.warehouse as { name: string } | null)?.name ?? null}</KeyValue>
              <KeyValue label="Due">{h.due_date ? formatDate(h.due_date as string) : null}</KeyValue>
              <KeyValue label="Progress"><PickProgress lines={lines} /></KeyValue>
              {h.notes ? <KeyValue label="Note" className="col-span-2 md:col-span-4">{String(h.notes)}</KeyValue> : null}
              {h.cancel_reason ? <KeyValue label="Cancel reason" className="col-span-2">{String(h.cancel_reason)}</KeyValue> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.length})` }, { key: "history", label: "History" }]} />
            {tab === "lines" && (
              <div className="space-y-2">
                {open && <p className="text-xs text-ink-muted">You can tick items here on the picker's behalf.</p>}
                {lines.map((l) => <PickLineCard key={l.id} line={l} editable={open} />)}
              </div>
            )}
            {tab === "history" && (
              <ol className="space-y-2">
                {(doc.data?.events ?? []).map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="w-36 shrink-0 text-xs text-ink-muted">{formatDateTime(e.created_at)}</span>
                    <span>
                      <b className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</b>
                      {e.event === "REASSIGNED" && <> from {nameOf(e.from_user)} to {nameOf(e.to_user)}</>}
                      {["CREATED", "ASSIGNED"].includes(e.event) && e.to_user && <> to {nameOf(e.to_user)}</>}
                      {["STARTED", "COMPLETED"].includes(e.event) && e.to_user && <> by {nameOf(e.to_user)}</>}
                      {e.note && <span className="text-ink-muted"> — {e.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={dlg === "assign"} title={h?.assigned_to ? "Reassign task" : "Assign task"} confirmLabel="Save" loading={act.isPending}
        message="What was already picked stays ticked. The new picker sees only the items still to pick."
        onCancel={() => { setDlg(null); setNote(""); }} onConfirm={() => (who ? act.mutate("assign") : toast.error("Choose the picker"))}>
        <Field label="Picker" required className="mt-3"><SearchableSelect value={who} options={(people.data ?? []).map((p) => ({ value: p.user_id, label: p.full_name, secondary: p.email }))} onChange={setWho} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ali is on leave" /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dlg === "cancel"} title={`Cancel ${String(h?.doc_no ?? "")}?`} tone="destructive" confirmLabel="Cancel task" cancelLabel="Keep" loading={act.isPending}
        message="The items go back to “to pick” on the order. Nothing has left the warehouse."
        onCancel={() => { setDlg(null); setNote(""); }} onConfirm={() => (note.trim() ? act.mutate("cancel") : toast.error("Enter a reason"))}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dlg === "complete"} title="Finish picking?" confirmLabel="Finish" loading={act.isPending}
        message={`All items are ticked${lines.some((l) => l.qty_picked != null && Number(l.qty_picked) < Number(l.qty_requested)) ? " (some are short)" : ""}. Next, make the GDN from what was picked.`}
        onCancel={() => setDlg(null)} onConfirm={() => act.mutate("complete")} />
    </>
  );
}
