import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCircle2, ChevronRight, ClipboardCheck, PackageCheck, Plus, TriangleAlert, Undo2, Warehouse } from "lucide-react";
import { Badge, Button, ConfirmDialog, Input, cn } from "@jst/ui";
import { friendlyError, sb } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { n, qtyFmt } from "../sales/common";
import { ProductPicker, VariantPicker, useProductMeta } from "../inventory/pickers";
import { useReceiptCheck } from "./WarehouseJobs";
import { AttachmentsPanel } from "../attachments/Attachments";

export interface MyJob { type: "COUNT" | "RECEIPT"; id: string; doc_no: string; warehouse: string; date: string; done: number; total: number; submitted: boolean; note: string | null }

/** Counts and receiving checks given to me that are still open */
export function useMyJobs(userId: string) {
  return useQuery({
    queryKey: ["my-jobs", userId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const a = await sb().from("warehouse_job_assignees").select("job_type, job_id").eq("user_id", userId).is("removed_at", null);
      if (a.error) throw a.error;
      const countIds = (a.data ?? []).filter((x) => x.job_type === "COUNT").map((x) => x.job_id as string);
      const recIds = (a.data ?? []).filter((x) => x.job_type === "RECEIPT").map((x) => x.job_id as string);
      const [c, r] = await Promise.all([
        countIds.length ? sb().from("stock_counts").select("id, doc_no, doc_date, status, notes, submitted_at, warehouse:warehouses(name), lines:stock_count_lines(status)").in("id", countIds).eq("status", "OPEN") : Promise.resolve({ data: [], error: null }),
        recIds.length ? sb().from("goods_receipts").select("id, doc_no, doc_date, status, notes, check_status, warehouse:warehouses(name), lines:receipt_check_lines(checked_qty)").in("id", recIds).eq("status", "DRAFT") : Promise.resolve({ data: [], error: null }),
      ]);
      if (c.error) throw c.error;
      if (r.error) throw r.error;
      const out: MyJob[] = [];
      for (const x of (c.data ?? []) as unknown as { id: string; doc_no: string; doc_date: string; notes: string | null; submitted_at: string | null; warehouse: { name: string }; lines: { status: string }[] }[]) {
        out.push({ type: "COUNT", id: x.id, doc_no: x.doc_no, warehouse: x.warehouse?.name, date: x.doc_date, done: x.lines.filter((l) => l.status !== "PENDING").length, total: x.lines.length, submitted: !!x.submitted_at, note: x.notes });
      }
      for (const x of (r.data ?? []) as unknown as { id: string; doc_no: string; doc_date: string; notes: string | null; check_status: string | null; warehouse: { name: string }; lines: { checked_qty: number | null }[] }[]) {
        if (x.check_status === "APPLIED") continue;
        out.push({ type: "RECEIPT", id: x.id, doc_no: x.doc_no, warehouse: x.warehouse?.name, date: x.doc_date, done: x.lines.filter((l) => l.checked_qty != null).length, total: x.lines.length, submitted: x.check_status === "SUBMITTED", note: x.notes });
      }
      return out;
    },
  });
}

export function JobCard({ j, onOpen }: { j: MyJob; onOpen: () => void }) {
  const pct = j.total ? (j.done / j.total) * 100 : 0;
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-card active:bg-subtle">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-white", j.type === "COUNT" ? "bg-amber-500" : "bg-emerald-600")}>
        {j.type === "COUNT" ? <ClipboardCheck className="h-5 w-5" /> : <PackageCheck className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold">{j.doc_no}</span>
          <Badge tone={j.submitted ? "success" : "warning"}>{j.submitted ? "Handed in" : j.type === "COUNT" ? "Count" : "Receiving"}</Badge></div>
        <div className="flex items-center gap-1 text-xs text-ink-muted"><Warehouse className="h-3.5 w-3.5" /> {j.warehouse} · {formatDate(j.date)}</div>
        <div className="text-2xs tabular-nums text-ink-muted">{j.done} / {j.total} done</div>
        <div className="h-1.5 rounded-full bg-subtle"><div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} /></div>
      </div>
      <ChevronRight className="h-5 w-5 text-ink-faint" />
    </button>
  );
}

function SubmitBar({ left, label, type, id, onDone }: { left: number; label: string; type: "COUNT" | "RECEIPT"; id: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = React.useState(false);
  const [note, setNote] = React.useState("");
  const go = useMutation({
    mutationFn: async () => { const { error } = await sb().rpc("submit_warehouse_job", { p_type: type, p_id: id, p_note: note || null }); if (error) throw error; },
    onSuccess: () => { toast.success("Handed in — the manager has been told"); setConfirm(false); qc.invalidateQueries(); onDone(); },
    onError: (e) => { setConfirm(false); toast.error(friendlyError(e)); },
  });
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="primary" className="h-12 w-full text-base" icon={<CheckCircle2 className="h-5 w-5" />} disabled={left > 0} onClick={() => setConfirm(true)}>
          {left > 0 ? `${left} item${left > 1 ? "s" : ""} left` : label}
        </Button>
      </div>
      <ConfirmDialog open={confirm} title={`${label}?`} confirmLabel="Hand in" loading={go.isPending} message="The manager checks it and approves." onCancel={() => setConfirm(false)} onConfirm={() => go.mutate()}>
        <Input className="mt-3" placeholder="Note for the manager (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}

interface CLine { id: string; product_id: string; counted_qty: number | null; status: string; variance_note: string | null; product: { name: string; sku: string; uom: { code: string } | null } | null; variant: { name: string } | null; location: { code: string } | null }

/** Blind count on the phone: type what is on the shelf for each item. */
export function CountScreen({ id, onDone }: { id: string; onDone: () => void }) {
  const doc = useQuery({
    queryKey: ["job", "count", id],
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from("stock_counts").select("id, doc_no, status, notes, submitted_at, warehouse:warehouses(name)").eq("id", id).single(),
        sb().from("stock_count_lines").select("id, product_id, counted_qty, status, variance_note, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name), location:warehouse_locations(code)").eq("count_id", id).limit(2000),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      const lines = (l.data as unknown as CLine[]).sort((a, b) => (a.location?.code ?? "").localeCompare(b.location?.code ?? "") || (a.product?.name ?? "").localeCompare(b.product?.name ?? ""));
      return { header: h.data as unknown as { doc_no: string; status: string; notes: string | null; submitted_at: string | null; warehouse: { name: string } }, lines };
    },
  });
  const [filter, setFilter] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  if (doc.isLoading) return <p className="m-4 text-sm text-ink-muted">Loading…</p>;
  if (doc.error || !doc.data) return <p className="m-4 text-sm text-danger">{doc.error ? "This count is no longer yours." : "Not found."}</p>;
  const h = doc.data.header;
  const open = h.status === "OPEN";
  const left = doc.data.lines.filter((l) => l.status === "PENDING").length;
  const shown = doc.data.lines.filter((l) => !filter.trim() || `${l.product?.name} ${l.product?.sku} ${l.variant?.name ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <>
      <main className="flex-1 space-y-3 p-3 pb-28">
        <div className="rounded-card border border-line bg-surface p-3">
          <div className="flex items-center gap-2"><span className="font-mono text-base font-semibold">{h.doc_no}</span><Badge tone="warning">Stock count</Badge>{h.submitted_at && <Badge tone="success">Handed in</Badge>}</div>
          <div className="mt-1 text-sm text-ink-muted">{h.warehouse?.name} · {doc.data.lines.length - left} / {doc.data.lines.length} counted</div>
          {h.notes && <p className="mt-2 rounded-control bg-info/10 px-2 py-1.5 text-sm text-info">{h.notes}</p>}
          <p className="mt-2 text-xs text-ink-muted">Count what is physically there. You don't see the system stock — that is on purpose.</p>
        </div>
        {doc.data.lines.length > 8 && <Input className="h-11 text-base" placeholder="Find item…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        {shown.map((l) => <CountLineCard key={l.id} line={l} editable={open} />)}
        {open && (adding ? <AddCountItem countId={id} onClose={() => setAdding(false)} /> : (
          <Button className="h-11 w-full" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Found an item not on the list</Button>
        ))}
      </main>
      {open && <SubmitBar left={left} label="Hand in the count" type="COUNT" id={id} onDone={onDone} />}
    </>
  );
}

function CountLineCard({ line, editable }: { line: CLine; editable: boolean }) {
  const qc = useQueryClient();
  const [qty, setQty] = React.useState(line.counted_qty == null ? "" : String(Number(line.counted_qty)));
  const [note, setNote] = React.useState(line.variance_note ?? "");
  const [editing, setEditing] = React.useState(line.counted_qty == null);
  React.useEffect(() => { setQty(line.counted_qty == null ? "" : String(Number(line.counted_qty))); setEditing(line.counted_qty == null); }, [line.counted_qty]);
  const save = useMutation({
    mutationFn: async (v: string | null) => {
      const { error } = await sb().rpc("staff_save_count", { p_line_id: line.id, p_qty: v == null ? null : n(v), p_note: note || null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", "count"] }),
    onError: (e) => toast.error(friendlyError(e)),
  });
  const done = line.status !== "PENDING";
  return (
    <div className={cn("rounded-card border bg-surface p-3", done ? "border-success/50 bg-success/5" : "border-line")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium">{line.product?.name}{line.variant && <span className="font-normal text-ink-muted"> · {line.variant.name}</span>}</div>
          <div className="text-2xs text-ink-muted">{line.product?.sku}{line.location && <> · {line.location.code}</>}</div>
        </div>
        {done && !editing && <div className="text-right"><div className="text-xl font-semibold tabular-nums">{qtyFmt(line.counted_qty)}</div><div className="text-2xs text-ink-faint">{line.product?.uom?.code}</div></div>}
      </div>
      {editable && line.status !== "POSTED" && (editing ? (
        <div className="mt-2 flex gap-2">
          <Input inputMode="decimal" className="h-12 flex-1 text-right text-lg tabular-nums" placeholder="Counted" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Button variant="primary" className="h-12 px-5 text-base" icon={<Check className="h-4 w-4" />} loading={save.isPending}
            onClick={() => (qty.trim() === "" || !(n(qty) >= 0) ? toast.error("Enter the quantity (0 if none)") : save.mutate(qty))}>Save</Button>
        </div>
      ) : (
        <div className="mt-1 flex justify-end gap-3">
          <button className="text-xs text-ink-muted" onClick={() => setEditing(true)}>Change</button>
          <button className="inline-flex items-center gap-1 text-xs text-ink-muted" onClick={() => save.mutate(null)}><Undo2 className="h-3 w-3" /> Clear</button>
        </div>
      ))}
      {editable && editing && <Input className="mt-2 h-10" placeholder="Note (optional, e.g. 3 damaged)" value={note} onChange={(e) => setNote(e.target.value)} />}
      {!editing && line.variance_note && <p className="mt-1 text-xs text-ink-muted">{line.variance_note}</p>}
    </div>
  );
}

function AddCountItem({ countId, onClose }: { countId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [p, setP] = React.useState<string | null>(null);
  const [v, setV] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState("");
  const meta = useProductMeta(p);
  const add = useMutation({
    mutationFn: async () => { const { error } = await sb().rpc("staff_add_count_item", { p_count_id: countId, p_product_id: p, p_variant_id: v, p_qty: n(qty), p_note: null }); if (error) throw error; },
    onSuccess: () => { toast.success("Added"); qc.invalidateQueries({ queryKey: ["job", "count"] }); onClose(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <div className="space-y-2 rounded-card border border-dashed border-line-strong bg-surface p-3">
      <ProductPicker showStock={false} value={p} onChange={(x) => { setP(x); setV(null); }} />
      {meta.data?.has_variants && <VariantPicker showStock={false} productId={p} value={v} onChange={setV} />}
      <Input inputMode="decimal" className="h-12 text-right text-lg" placeholder="Counted" value={qty} onChange={(e) => setQty(e.target.value)} />
      <div className="flex gap-2"><Button className="flex-1" onClick={onClose}>Back</Button>
        <Button variant="primary" className="flex-1" disabled={!p || qty.trim() === ""} loading={add.isPending} onClick={() => add.mutate()}>Add item</Button></div>
    </div>
  );
}

/** Receiving check on the phone: tick what arrived, or enter the real quantity and what is wrong. */
export function ReceiptScreen({ id, onDone }: { id: string; onDone: () => void }) {
  const chk = useReceiptCheck(id);
  if (chk.isLoading) return <p className="m-4 text-sm text-ink-muted">Loading…</p>;
  if (chk.error || !chk.data) return <p className="m-4 text-sm text-danger">{chk.error ? "This receipt is no longer yours." : "Not found."}</p>;
  const h = chk.data.header as unknown as { doc_no: string; status: string; check_status: string | null; notes: string | null; supplier_reference: string | null; warehouse: { name: string } | null; supplier: { name: string } | null };
  const open = h.status === "DRAFT" && h.check_status !== "APPLIED";
  const left = chk.data.lines.filter((l) => l.checked_qty == null).length;
  return (
    <>
      <main className="flex-1 space-y-3 p-3 pb-28">
        <div className="rounded-card border border-line bg-surface p-3">
          <div className="flex items-center gap-2"><span className="font-mono text-base font-semibold">{h.doc_no}</span><Badge tone="success">Receiving</Badge>{h.check_status === "SUBMITTED" && <Badge tone="info">Handed in</Badge>}</div>
          <div className="mt-1 text-sm text-ink-muted">{h.warehouse?.name}{h.supplier && <> · from {h.supplier.name}</>}{h.supplier_reference && <> · {h.supplier_reference}</>}</div>
          {h.notes && <p className="mt-2 rounded-control bg-info/10 px-2 py-1.5 text-sm text-info">{h.notes}</p>}
          <p className="mt-2 text-xs text-ink-muted">Check each item as it is unloaded. If something is short or damaged, enter what arrived in good condition and say what is wrong.</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-3">
          <div className="mb-2 text-sm font-semibold">Photos — delivery slip, damaged items</div>
          <AttachmentsPanel entityType="goods_receipts" entityId={id} readOnly={!open} compact />
        </div>
        {chk.data.lines.map((l) => <ReceiveLineCard key={l.id} line={l} editable={open} />)}
      </main>
      {open && <SubmitBar left={left} label="Hand in the receiving check" type="RECEIPT" id={id} onDone={onDone} />}
    </>
  );
}

function ReceiveLineCard({ line, editable }: { line: NonNullable<ReturnType<typeof useReceiptCheck>["data"]>["lines"][number]; editable: boolean }) {
  const qc = useQueryClient();
  const [diff, setDiff] = React.useState(false);
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("");
  const save = useMutation({
    mutationFn: async (v: { qty: number | null; note?: string }) => {
      const { error } = await sb().rpc("staff_check_receipt_line", { p_line_id: line.id, p_qty: v.qty, p_note: v.note ?? null });
      if (error) throw error;
    },
    onSuccess: () => { setDiff(false); setQty(""); setNote(""); qc.invalidateQueries({ queryKey: ["job", "receipt"] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const done = line.checked_qty != null;
  const isDiff = done && Number(line.checked_qty) !== Number(line.expected_qty);
  const uom = line.product?.uom?.code ?? "";
  return (
    <div className={cn("rounded-card border bg-surface p-3", done ? (isDiff ? "border-warning/60 bg-warning-soft/40" : "border-success/50 bg-success/5") : "border-line")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium">{line.product?.name}{line.variant && <span className="font-normal text-ink-muted"> · {line.variant.name}</span>}</div>
          <div className="text-2xs text-ink-muted">{line.product?.sku}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums">{qtyFmt(line.expected_qty)} <span className="text-xs font-normal text-ink-faint">{uom}</span></div>
          {done && <div className={cn("text-xs tabular-nums", isDiff ? "text-warning" : "text-success")}>{isDiff ? `${qtyFmt(line.checked_qty)} arrived` : "all arrived"}</div>}
        </div>
      </div>
      {isDiff && line.note && <p className="mt-1 flex items-center gap-1 text-xs text-warning"><TriangleAlert className="h-3 w-3" /> {line.note}</p>}
      {editable && !done && !diff && (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" className="h-12 flex-1 text-base" icon={<Check className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate({ qty: Number(line.expected_qty) })}>All arrived</Button>
          <Button className="h-12 text-base" icon={<TriangleAlert className="h-4 w-4" />} onClick={() => setDiff(true)}>Different</Button>
        </div>
      )}
      {editable && !done && diff && (
        <div className="mt-2 space-y-2 rounded-control bg-subtle p-2">
          <div className="flex items-center gap-2"><span className="text-xs text-ink-muted">Arrived OK</span>
            <Input inputMode="decimal" autoFocus className="h-11 w-28 text-right text-base tabular-nums" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
            <span className="text-xs text-ink-muted">of {qtyFmt(line.expected_qty)} {uom}</span></div>
          <Input className="h-11 text-base" placeholder="What is wrong? (short, damaged, wrong size…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2"><Button className="flex-1" onClick={() => setDiff(false)}>Back</Button>
            <Button variant="primary" className="flex-1" loading={save.isPending}
              onClick={() => (qty.trim() === "" || !(n(qty) >= 0) ? toast.error("Enter how many arrived OK") : !note.trim() ? toast.error("Say what is wrong") : save.mutate({ qty: n(qty), note }))}>Save</Button></div>
        </div>
      )}
      {editable && done && <div className="mt-1 text-right"><button className="inline-flex items-center gap-1 text-xs text-ink-muted" onClick={() => save.mutate({ qty: null })}><Undo2 className="h-3 w-3" /> Undo</button></div>}
    </div>
  );
}
