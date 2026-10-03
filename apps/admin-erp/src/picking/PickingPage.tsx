import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, Ban, CheckCircle2, ClipboardList, ExternalLink, Plus, Radio, ShieldAlert, Smartphone, TriangleAlert, Truck, UserRoundCog, Users } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, SearchableSelect, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime } from "@jst/utilities";
import { Tabs } from "../entity/EntityDialog";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { n, qtyFmt, useWarehouses, type Wh } from "../sales/common";
import { EVENT_LABEL, PICK_TONE, PickLineCard, PickProgress, PickerChips, SeenBadge, pickLabel, staffOf, usePickingStaff, usePickingTask, type PickLine, type StaffRow } from "./common";
import { usePickingRealtime } from "./realtime";

type Row = Record<string, unknown> & { id: string };
const FILTERS = [
  { label: "Open", statuses: ["OPEN", "IN_PROGRESS"] },
  { label: "Shortage — decide", shortage: true },
  { label: "Picked — make GDN", status: "DONE", needsGdn: true },
  { label: "Picked", status: "DONE" },
  { label: "Cancelled", status: "CANCELLED" },
  { label: "All" },
] as { label: string; status?: string; statuses?: string[]; needsGdn?: boolean; shortage?: boolean }[];
const icon = <ClipboardList className="h-4 w-4" />;

function usePendingShortages() {
  const { companyId, can } = useAccess();
  return useQuery({
    queryKey: ["pending-shortages", companyId],
    enabled: !!companyId && can(P.pickingManage),
    queryFn: async () => {
      const { data, error } = await sb().from("picking_task_lines").select("task_id").eq("company_id", companyId!).eq("shortage_status", "PENDING").limit(500);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.task_id as string));
    },
  });
}

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
  const navigate = useNavigate();
  const live = usePickingRealtime(allowed);
  const staff = usePickingStaff();
  const names = React.useMemo(() => new Map((staff.data ?? []).map((p) => [p.user_id, p.full_name])), [staff.data]);
  const shortages = usePendingShortages();
  const flt = FILTERS[f];
  const list = useEntityList<Row>({
    table: "picking_tasks",
    select: "id, doc_no, so_doc_no, status, assigned_to, due_date, created_at, gdn_id, warehouse:warehouses(code), lines:picking_task_lines!picking_task_lines_task_id_fkey(qty_picked), team:picking_task_assignees(user_id, acknowledged_at, removed_at)",
    companyId, search: q, searchColumns: ["doc_no", "so_doc_no"],
    filters: { status: flt.status },
    orderBy: { column: "created_at", ascending: false }, page, pageSize: 50, enabled: allowed,
  });
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const pend = shortages.data ?? new Set<string>();
  const rows = (list.data?.rows ?? []).filter((r) => (!flt.statuses || flt.statuses.includes(String(r.status))) && (!flt.needsGdn || !r.gdn_id) && (!flt.shortage || pend.has(r.id)));
  const items = FILTERS.map((x) => (x.shortage && pend.size ? { ...x, label: `${x.label} (${pend.size})` } : x));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Picking" icon={icon}
        description="Split an approved order across warehouses and pickers. Pickers' phones buzz; they tick items or report shortages, and you decide what happens to anything short."
        actions={<div className="flex items-center gap-2">
          <span className={cn("hidden items-center gap-1 text-2xs sm:flex", live ? "text-success" : "text-ink-faint")}><Radio className="h-3 w-3" />{live ? "Live" : "Connecting…"}</span>
          <Button icon={<Users className="h-4 w-4" />} onClick={() => navigate("/warehouse-staff")}>Staff</Button>
          {can(P.pickingPerform) && <Button icon={<Smartphone className="h-4 w-4" />} onClick={() => window.open("/m", "_blank")}>Phone app</Button>}
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New picking</Button>
        </div>} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search task / SO no…" />
          <StatusFilter items={items} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable loading={list.isLoading} rows={rows} onView={(r) => update({ view: r.id, new: null, so: null })}
            page={page} pageSize={50} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc", header: "Task", width: "130px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "so", header: "Sales order", width: "130px", cell: (r) => <span className="font-mono text-xs">{String(r.so_doc_no)}</span> },
              { key: "w", header: "From", width: "80px", cell: (r) => <span className="font-mono text-xs">{(r.warehouse as { code: string } | null)?.code}</span> },
              { key: "a", header: "Pickers", cell: (r) => {
                const team = ((r.team as { user_id: string; acknowledged_at: string | null; removed_at: string | null }[]) ?? []).filter((t) => !t.removed_at);
                if (!team.length) return <span className="text-warning">Not assigned</span>;
                return <span className="text-xs">{team.map((t, i) => <span key={t.user_id}>{i > 0 && ", "}<span className={cn(!t.acknowledged_at && ["OPEN", "IN_PROGRESS"].includes(String(r.status)) && "text-warning")}>{names.get(t.user_id) ?? "…"}</span></span>)}</span>;
              } },
              { key: "p", header: "Progress", width: "140px", hideBelow: "md", cell: (r) => <PickProgress lines={r.lines as { qty_picked: number | null }[]} /> },
              { key: "d", header: "Due", width: "100px", hideBelow: "lg", cell: (r) => r.due_date ? formatDate(r.due_date as string) : null },
              { key: "s", header: "Status", width: "180px", cell: (r) => <span className="flex flex-wrap items-center gap-1"><Badge tone={PICK_TONE[String(r.status)]}>{pickLabel(String(r.status))}</Badge>
                {pend.has(r.id) && <Badge tone="danger">Short — decide</Badge>}
                {r.status === "DONE" && !r.gdn_id && <Badge tone="warning">GDN due</Badge>}</span> },
            ]}
            empty={<EmptyState icon={icon} title="No picking tasks" description="Open an approved sales order and press “Picking task”, or use “New picking”." />} />
        )}
      </Card>
      {creating && !viewId && <NewPickingDialog presetSo={soParam} onClose={() => update({ new: null, so: null })} onCreated={(id) => update({ view: id, new: null, so: null })} />}
      {viewId && <TaskDialog id={viewId} staff={staff.data ?? []} names={names} onClose={() => update({ view: null })} onOpen={(id) => update({ view: id })} />}
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

/** stock on hand per warehouse × item, for the products given */
function useOnHand(productIds: string[]) {
  const key = Array.from(new Set(productIds)).sort();
  return useQuery({
    queryKey: ["on-hand-by-wh", key.join(",")],
    enabled: key.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await sb().from("stock_balances").select("warehouse_id, product_id, variant_id, on_hand").in("product_id", key);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of data ?? []) {
        const k = `${r.warehouse_id}|${r.product_id}|${r.variant_id ?? ""}`;
        m.set(k, (m.get(k) ?? 0) + Number(r.on_hand));
      }
      return m;
    },
  });
}

interface SoPickLine {
  sales_order_line_id: string; line_no: number; product_id: string; variant_id: string | null; ordered: number; delivered: number; in_picking: number; pickable: number;
  allocations: { allocation_id: string; warehouse_id: string; quantity: number; free: number }[];
  name: string; sku: string; uom: string; variant: string | null;
}
function useSoPickLines(so: string | null) {
  return useQuery({
    queryKey: ["so-pick-lines", so],
    enabled: !!so,
    queryFn: async () => {
      const { data, error } = await sb().rpc("so_pick_lines", { p_so_id: so });
      if (error) throw error;
      const list = (data ?? []) as Omit<SoPickLine, "name" | "sku" | "uom" | "variant">[];
      const pids = Array.from(new Set(list.map((r) => r.product_id)));
      const vids = Array.from(new Set(list.map((r) => r.variant_id).filter(Boolean))) as string[];
      const [p, v] = await Promise.all([
        pids.length ? sb().from("products").select("id, name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)").in("id", pids) : Promise.resolve({ data: [] }),
        vids.length ? sb().from("product_variants").select("id, name").in("id", vids) : Promise.resolve({ data: [] }),
      ]);
      const pm = new Map(((p.data ?? []) as unknown as { id: string; name: string; sku: string; uom: { code: string } | null }[]).map((x) => [x.id, x]));
      const vm = new Map(((v.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
      return list.map((r) => ({ ...r, ordered: Number(r.ordered), delivered: Number(r.delivered), in_picking: Number(r.in_picking), pickable: Number(r.pickable),
        allocations: (r.allocations ?? []).map((a) => ({ ...a, quantity: Number(a.quantity), free: Number(a.free) })),
        name: pm.get(r.product_id)?.name ?? "…", sku: pm.get(r.product_id)?.sku ?? "", uom: pm.get(r.product_id)?.uom?.code ?? "",
        variant: r.variant_id ? vm.get(r.variant_id) ?? null : null })) as SoPickLine[];
    },
  });
}

/**
 * The picking dialog: per item, how many to pick from each warehouse (defaults to what the order put there),
 * then who picks in each warehouse. One task is created per warehouse and every chosen picker's phone buzzes.
 */
function NewPickingDialog({ presetSo, onClose, onCreated }: { presetSo: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const orders = useOpenOrdersForPicking();
  const whs = useWarehouses();
  const staff = usePickingStaff();
  const [so, setSo] = React.useState<string | null>(presetSo);
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [who, setWho] = React.useState<Record<string, string[]>>({});
  const [due, setDue] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const lines = useSoPickLines(so);
  const stock = useOnHand((lines.data ?? []).map((l) => l.product_id));
  const key = (lineId: string, wh: string) => `${lineId}|${wh}`;

  React.useEffect(() => {
    const init: Record<string, string> = {};
    for (const l of lines.data ?? []) for (const a of l.allocations) if (a.free > 0) init[key(l.sales_order_line_id, a.warehouse_id)] = String(a.free);
    setQty(init);
  }, [lines.data]);

  const wlist: Wh[] = whs.data ?? [];
  const todo = (lines.data ?? []).filter((l) => l.pickable > 0);
  const lineTotal = (l: SoPickLine) => wlist.reduce((s, w) => s + (n(qty[key(l.sales_order_line_id, w.id)] ?? "0") || 0), 0);
  const bad = todo.some((l) => lineTotal(l) > l.pickable + 1e-9) || Object.values(qty).some((v) => n(v) < 0 || Number.isNaN(n(v)));
  const usedWh = wlist.filter((w) => todo.some((l) => n(qty[key(l.sales_order_line_id, w.id)] ?? "0") > 0));
  const pickerCount = new Set(usedWh.flatMap((w) => who[w.id] ?? [])).size;

  const create = useMutation({
    mutationFn: async () => {
      const tasks = usedWh.map((w) => ({
        warehouse_id: w.id, assignees: who[w.id] ?? [],
        lines: todo.map((l) => ({ sales_order_line_id: l.sales_order_line_id, quantity: String(n(qty[key(l.sales_order_line_id, w.id)] ?? "0") || 0) })).filter((x) => Number(x.quantity) > 0),
      }));
      const { data, error } = await sb().rpc("create_picking_tasks", { p_company_id: companyId, p_so_id: so, p_tasks: tasks, p_notes: notes || null, p_due: due || null });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    onSuccess: (ids) => {
      toast.success(`${ids.length} picking task${ids.length > 1 ? "s" : ""} created${pickerCount ? ` — ${pickerCount} phone${pickerCount > 1 ? "s" : ""} buzzing now` : ""}`);
      qc.invalidateQueries(); onCreated(ids[0]);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const onHand = (wh: string, l: SoPickLine) => stock.data?.get(`${wh}|${l.product_id}|${l.variant_id ?? ""}`) ?? 0;

  return (
    <ErpDialog open onRequestClose={onClose} size="xl" icon={icon} title="New picking"
      subtitle="Quantities default to what the order allocated to each warehouse — change them to pick from anywhere."
      footer={<>
        <div className="flex-1 text-sm text-ink-muted">{usedWh.length} warehouse{usedWh.length === 1 ? "" : "s"} · {pickerCount} picker{pickerCount === 1 ? "" : "s"}</div>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<BellRing className="h-4 w-4" />} disabled={!so || !usedWh.length || bad} loading={create.isPending} onClick={() => create.mutate()}>
          {pickerCount ? "Create & buzz pickers" : "Create (assign later)"}
        </Button>
      </>}>
      <FormGrid cols={3}>
        <Field label="Sales order" required className="sm:col-span-2">
          <SearchableSelect value={so} options={orders.data ?? []} placeholder={orders.isLoading ? "Loading…" : "Approved sales order…"} onChange={(v) => { setSo(v); setWho({}); }} emptyText="No approved orders" />
        </Field>
        <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </FormGrid>
      {so && (lines.isLoading ? <Skeleton className="h-24" /> : lines.error ? <p className="text-sm text-danger">{friendlyError(lines.error)}</p> : todo.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-4 text-center text-sm text-ink-muted">Everything on this order is already picked, in picking or dispatched.</p>
      ) : (
        <>
          <div className="overflow-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <th className="h-8 px-3">Item</th>
                <th className="px-3 text-right">Left to pick</th>
                {wlist.map((w) => <th key={w.id} className="w-[150px] px-3 text-right">{w.code}<div className="font-normal normal-case tracking-normal text-ink-faint">{w.name}</div></th>)}
              </tr></thead>
              <tbody>
                {todo.map((l) => {
                  const over = lineTotal(l) > l.pickable + 1e-9;
                  return (
                    <tr key={l.sales_order_line_id} className="border-b border-line/70 align-top">
                      <td className="px-3 py-2"><div className="font-medium">{l.name}{l.variant && <span className="font-normal text-ink-muted"> · {l.variant}</span>}</div>
                        <div className="text-2xs text-ink-muted">{l.sku} · ordered {qtyFmt(l.ordered)}{l.delivered > 0 && <> · sent {qtyFmt(l.delivered)}</>}{l.in_picking > 0 && <> · in picking {qtyFmt(l.in_picking)}</>}</div></td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", over && "text-danger")}>{qtyFmt(lineTotal(l))} / {qtyFmt(l.pickable)} <span className="text-2xs text-ink-faint">{l.uom}</span></td>
                      {wlist.map((w) => {
                        const k = key(l.sales_order_line_id, w.id);
                        const alloc = l.allocations.find((a) => a.warehouse_id === w.id);
                        const oh = onHand(w.id, l);
                        return (
                          <td key={w.id} className="px-3 py-1.5 text-right">
                            <Input inputMode="decimal" className="h-control-sm text-right tabular-nums" value={qty[k] ?? ""} placeholder="0" invalid={over}
                              onChange={(e) => setQty((s) => ({ ...s, [k]: e.target.value }))} />
                            <div className={cn("mt-0.5 text-2xs", n(qty[k] ?? "0") > oh ? "text-danger" : "text-ink-faint")}>stock {qtyFmt(oh)}{alloc && alloc.free > 0 ? ` · order ${qtyFmt(alloc.free)}` : ""}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {bad && <p className="mt-1 text-xs text-danger">A row adds up to more than is left to pick.</p>}
          <div className="mt-4 space-y-3">
            {usedWh.map((w) => (
              <div key={w.id} className="rounded-card border border-line p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium"><span className="font-mono">{w.code}</span> <span className="text-ink-muted">· who picks here?</span>
                  <span className="text-2xs font-normal text-ink-faint">{todo.filter((l) => n(qty[key(l.sales_order_line_id, w.id)] ?? "0") > 0).length} item(s)</span></div>
                <PickerChips people={staffOf(staff.data, w.id)} value={who[w.id] ?? []} onChange={(v) => setWho((s) => ({ ...s, [w.id]: v }))} />
              </div>
            ))}
          </div>
        </>
      ))}
      <Field label="Note for the pickers" className="mt-3"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. load on the Daewoo truck at 4 pm" /></Field>
    </ErpDialog>
  );
}

function TaskDialog({ id, staff, names, onClose, onOpen }: { id: string; staff: StaffRow[]; names: Map<string, string>; onClose: () => void; onOpen: (id: string) => void }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const doc = usePickingTask(id);
  const [tab, setTab] = React.useState("lines");
  const [dlg, setDlg] = React.useState<null | "team" | "cancel" | "complete">(null);
  const [team, setTeam] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [decide, setDecide] = React.useState<PickLine | null>(null);
  const h = doc.data?.header;
  const status = String(h?.status ?? "");
  const lines = doc.data?.lines ?? [];
  const members = doc.data?.team ?? [];
  const open = ["OPEN", "IN_PROGRESS"].includes(status);
  const nameOf = (u: unknown) => (u ? names.get(String(u)) ?? "someone" : "nobody");
  const act = useMutation({
    mutationFn: async (kind: "team" | "cancel" | "complete" | "gdn" | "buzz") => {
      const r = kind === "team" ? await sb().rpc("set_picking_assignees", { p_id: id, p_users: team, p_note: note || null })
        : kind === "cancel" ? await sb().rpc("cancel_picking_task", { p_id: id, p_reason: note })
        : kind === "complete" ? await sb().rpc("complete_picking_task", { p_id: id, p_note: note || null })
        : kind === "buzz" ? await sb().rpc("rebuzz_picking_task", { p_id: id })
        : await sb().rpc("gdn_from_picking", { p_task_id: id });
      if (r.error) throw r.error;
      return { kind, data: r.data as unknown };
    },
    onSuccess: ({ kind, data }) => {
      toast.success(kind === "team" ? "Pickers updated — new pickers' phones are buzzing" : kind === "cancel" ? "Task cancelled" : kind === "complete" ? "Picking finished"
        : kind === "buzz" ? `Buzzed ${data as number} phone(s) again` : "Draft GDN made from the picked goods — check and dispatch it");
      setDlg(null); setNote(""); qc.invalidateQueries();
      if (kind === "gdn") navigate(`/gdn?view=${data as string}`);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const left = lines.filter((l) => l.qty_picked == null).length;
  const pending = lines.filter((l) => l.shortage_status === "PENDING");
  const whStaff = staffOf(staff, h?.warehouse_id);
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
          {open && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={left > 0} onClick={() => setDlg("complete")}>Finish picking</Button>}
          {status === "DONE" && !h?.gdn_id && can(P.salesDispatch) && <Button variant="primary" icon={<Truck className="h-3.5 w-3.5" />} loading={act.isPending} disabled={pending.length > 0} title={pending.length ? "Decide the shortages first" : undefined} onClick={() => act.mutate("gdn")}>Make GDN</Button>}
        </>}>
        {doc.isLoading ? <Skeleton className="h-40" /> : doc.error ? <p className="text-sm text-danger">{friendlyError(doc.error)}</p> : h && (
          <>
            {pending.length > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-card border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
                <TriangleAlert className="h-4 w-4" /> {pending.length} item{pending.length > 1 ? "s are" : " is"} short — decide below: reduce the order, or send it to another picker / warehouse.
              </div>
            )}
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <KeyValue label="Warehouse">{(h.warehouse as { name: string } | null)?.name ?? null}</KeyValue>
              <KeyValue label="Due">{h.due_date ? formatDate(h.due_date as string) : null}</KeyValue>
              <KeyValue label="Progress" className="col-span-2"><PickProgress lines={lines} /></KeyValue>
              {h.notes ? <KeyValue label="Note" className="col-span-2 md:col-span-4">{String(h.notes)}</KeyValue> : null}
              {h.cancel_reason ? <KeyValue label="Cancel reason" className="col-span-2">{String(h.cancel_reason)}</KeyValue> : null}
            </dl>
            <div className="mb-4 rounded-card border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Pickers</span>
                <div className="flex-1" />
                {open && members.length > 0 && <Button size="sm" icon={<BellRing className="h-3.5 w-3.5" />} loading={act.isPending} onClick={() => act.mutate("buzz")}>Buzz again</Button>}
                {open && <Button size="sm" icon={<UserRoundCog className="h-3.5 w-3.5" />} onClick={() => { setTeam(members.map((m) => m.user_id)); setDlg("team"); }}>{members.length ? "Change pickers" : "Assign pickers"}</Button>}
              </div>
              {members.length === 0 ? <p className="text-sm text-warning">Nobody is on this task yet.</p> : (
                <div className="flex flex-wrap gap-2">
                  {members.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-2 rounded-full border border-line px-2.5 py-1 text-sm">{nameOf(m.user_id)} <SeenBadge a={m} /></span>
                  ))}
                </div>
              )}
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: `Items (${lines.length})` }, { key: "history", label: "History" }]} />
            {tab === "lines" && (
              <div className="space-y-2">
                {open && <p className="text-xs text-ink-muted">Updates from the pickers' phones appear here instantly. You can also tick items on their behalf.</p>}
                {lines.map((l) => (
                  <PickLineCard key={l.id} line={l} editable={open} names={names}
                    extra={<>
                      {l.shortage_status === "PENDING" && status !== "CANCELLED" && (
                        <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" icon={<TriangleAlert className="h-3.5 w-3.5" />} onClick={() => setDecide(l)}>Decide shortage ({qtyFmt(Number(l.qty_requested) - Number(l.qty_picked))})</Button></div>
                      )}
                      {l.follow_up_task_id && <div className="mt-1 text-right"><button className="text-2xs text-info underline" onClick={() => onOpen(l.follow_up_task_id!)}>Open the re-pick task</button></div>}
                    </>} />
                ))}
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
                      {e.event === "UNASSIGNED" && <>: {nameOf(e.from_user)}</>}
                      {["CREATED", "ASSIGNED"].includes(e.event) && e.to_user && <>: {nameOf(e.to_user)}</>}
                      {["STARTED", "COMPLETED", "SHORT"].includes(e.event) && e.to_user && <> by {nameOf(e.to_user)}</>}
                      {e.note && <span className="text-ink-muted"> — {e.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </ErpDialog>
      <ConfirmDialog open={dlg === "team"} title="Pickers for this task" confirmLabel="Save & buzz" loading={act.isPending}
        message="Pick one, several or all staff of this warehouse. Ticked items stay ticked; new pickers' phones buzz, removed pickers are told."
        onCancel={() => { setDlg(null); setNote(""); }} onConfirm={() => act.mutate("team")}>
        <div className="mt-3"><PickerChips people={whStaff} value={team} onChange={setTeam} /></div>
        <Field label="Note" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ali is not answering" /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dlg === "cancel"} title={`Cancel ${String(h?.doc_no ?? "")}?`} tone="destructive" confirmLabel="Cancel task" cancelLabel="Keep" loading={act.isPending}
        message="The items go back to “to pick” on the order. Pickers are told. Nothing has left the warehouse."
        onCancel={() => { setDlg(null); setNote(""); }} onConfirm={() => (note.trim() ? act.mutate("cancel") : toast.error("Enter a reason"))}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dlg === "complete"} title="Finish picking?" confirmLabel="Finish" loading={act.isPending}
        message={`All items are ticked${lines.some((l) => l.qty_picked != null && Number(l.qty_picked) < Number(l.qty_requested)) ? " (some are short)" : ""}. Next, make the GDN from what was picked.`}
        onCancel={() => setDlg(null)} onConfirm={() => act.mutate("complete")} />
      {decide && h && <ShortageDialog line={decide} task={h} staff={staff} onClose={() => setDecide(null)} onRepick={(tid) => { setDecide(null); if (tid) onOpen(tid); }} />}
    </>
  );
}

/** What happens to a short quantity: re-pick (any warehouse, any of its staff), reduce the order, or keep it open. */
function ShortageDialog({ line, task, staff, onClose, onRepick }: {
  line: PickLine; task: { id: string; warehouse_id: string; doc_no: string }; staff: StaffRow[]; onClose: () => void; onRepick: (taskId: string | null) => void;
}) {
  const qc = useQueryClient();
  const whs = useWarehouses();
  const short = Number(line.qty_requested) - Number(line.qty_picked);
  const [action, setAction] = React.useState<"REPICK" | "REDUCE_ORDER" | "BACKORDER">("REPICK");
  const [wh, setWh] = React.useState<string>(task.warehouse_id);
  const [who, setWho] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const productRow = { product_id: line.product_id, variant_id: line.variant_id };
  const stock = useOnHand([productRow.product_id]);
  const oh = (w: string) => stock.data?.get(`${w}|${productRow.product_id}|${productRow.variant_id ?? ""}`) ?? 0;
  React.useEffect(() => setWho([]), [wh]);
  const go = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("resolve_pick_shortage", { p_line_id: line.id, p_action: action, p_warehouse_id: action === "REPICK" ? wh : null, p_users: action === "REPICK" ? who : null, p_note: note || null });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: (tid) => {
      toast.success(action === "REPICK" ? "New picking task made — the pickers' phones are buzzing" : action === "REDUCE_ORDER" ? "Order reduced by the short quantity" : "Kept on the order for later picking");
      qc.invalidateQueries(); onRepick(action === "REPICK" ? tid : null);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const uom = line.product?.uom?.code ?? "";
  const opt = (k: typeof action, title: string, desc: React.ReactNode) => (
    <label className={cn("flex cursor-pointer gap-3 rounded-card border p-3", action === k ? "border-primary bg-primary/5" : "border-line hover:border-ink-faint")}>
      <input type="radio" className="mt-1 accent-[#111827]" checked={action === k} onChange={() => setAction(k)} />
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-ink-muted">{desc}</span></span>
    </label>
  );
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<TriangleAlert className="h-4 w-4" />} title="Shortage — your decision"
      subtitle={`${line.product?.name ?? "Item"} · ${qtyFmt(short)} ${uom} short on ${task.doc_no}`}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Later</Button>
        <Button variant="primary" loading={go.isPending} disabled={action === "REPICK" && !who.length} onClick={() => go.mutate()}>
          {action === "REPICK" ? "Create task & buzz" : action === "REDUCE_ORDER" ? "Reduce the order" : "Keep on order"}
        </Button></>}>
      <p className="mb-3 text-sm text-ink-muted">Picker found {qtyFmt(line.qty_picked)} of {qtyFmt(line.qty_requested)} {uom}{line.shortage_reason ? ` — “${line.shortage_reason}”` : ""}.</p>
      <div className="space-y-2">
        {opt("REPICK", `Pick the missing ${qtyFmt(short)} from another warehouse or picker`, "A new picking task is made for just this quantity; the order's reservation moves with it.")}
        {action === "REPICK" && (
          <div className="ml-7 space-y-3 rounded-card bg-subtle p-3">
            <div className="flex flex-wrap gap-1.5">
              {(whs.data ?? []).map((w) => (
                <button key={w.id} type="button" onClick={() => setWh(w.id)} className={cn("rounded-control border px-2.5 py-1 text-xs", wh === w.id ? "border-primary bg-surface font-medium" : "border-line bg-surface/60 hover:border-ink-faint")}>
                  <span className="font-mono">{w.code}</span> · stock {qtyFmt(oh(w.id))}{w.id === task.warehouse_id ? " (same)" : ""}
                </button>
              ))}
            </div>
            {oh(wh) < short && <p className="text-xs text-warning">Only {qtyFmt(oh(wh))} on hand here — the system will refuse if it cannot be reserved.</p>}
            <PickerChips people={staffOf(staff, wh)} value={who} onChange={setWho} />
          </div>
        )}
        {opt("REDUCE_ORDER", `Reduce the order by ${qtyFmt(short)} ${uom}`, "The customer gets what was found; the missing quantity is removed from the sales order and its reservation released.")}
        {opt("BACKORDER", "Keep it on the order", "Nothing changes now — the missing quantity stays “to pick” on the sales order for later.")}
      </div>
      <Field label="Note" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></Field>
    </ErpDialog>
  );
}
