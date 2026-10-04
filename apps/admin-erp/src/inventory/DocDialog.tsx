import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, Minus, Pencil, Plus, Save, Trash2, Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  ConditionalSection,
  ConfirmDialog,
  ErpDialog,
  Field,
  FormGrid,
  Input,
  KeyValue,
  SearchableSelect,
  SectionTitle,
  Skeleton,
  Textarea,
  cn,
} from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { formatDate, formatDateTime, formatNumber, humanize } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { ADJUSTMENT_REASONS, STATUS_TONE, type InvDocConfig } from "./docConfigs";
import { useStorageLocations } from "../lib/settings";
import { Availability, LocationPicker, ProductPicker, SupplierPicker, VariantPicker, WarehousePicker, useProductMeta, useStockFigures } from "./pickers";
import { MovementsTable } from "./MovementsTable";
import { P } from "@jst/permissions";
import { ReceiptCheckPanel } from "../picking/WarehouseJobs";
import { RollCutsEditor, RollLengthsEditor, newRoll, sumCuts, sumRolls, type CutMode, type Cuts, type RollEntry } from "./rolls";
import { AttachmentsPanel, filesLabel, useAttachments, type AttachmentEntity } from "../attachments/Attachments";

type Row = Record<string, unknown>;
interface Line {
  key: string;
  product_id: string | null;
  variant_id: string | null;
  location_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  quantity: string;
  /** adjustments, "Add / remove" mode */
  direction: "in" | "out";
  /** adjustments, "Set new quantity" mode: quantity now physically in stock */
  target: string;
  /** roll items, inbound: lengths of the rolls arriving (empty = one roll for the whole quantity) */
  rolls: RollEntry[];
  /** roll items, outbound: cut automatically or from chosen rolls */
  cutMode: CutMode;
  cuts: Cuts;
  notes: string;
}
/** SET = enter the new quantity in stock (system works out the change); CHANGE = enter the increase / decrease */
type EntryMode = "SET" | "CHANGE";
type Header = Record<string, string | null>;

const newLine = (): Line => ({
  key: crypto.randomUUID(),
  product_id: null,
  variant_id: null,
  location_id: null,
  from_location_id: null,
  to_location_id: null,
  quantity: "",
  direction: "in",
  target: "",
  rolls: [],
  cutMode: "auto",
  cuts: {},
  notes: "",
});

const ROLL_DOCS = ["GOODS_RECEIPT", "STOCK_TRANSFER", "STOCK_ADJUSTMENT"];
/** Does this line take stock out (cut from rolls) or bring it in (new rolls)? */
function lineFlow(cfg: InvDocConfig, l: Line, entryMode: string | null): "in" | "out" | "set" {
  if (cfg.kind === "transfer") return "out";
  if (cfg.kind === "receipt") return "in";
  if (entryMode === "SET") return "set";
  return l.direction === "out" ? "out" : "in";
}

function useDoc(cfg: InvDocConfig, id: string | null) {
  return useQuery({
    queryKey: ["record", cfg.table, id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from(cfg.table).select(cfg.recordSelect).eq("id", id!).single(),
        sb().from(cfg.linesTable).select(cfg.linesSelect).eq(cfg.linesFk, id!).order("line_no"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      let plan: Record<string, { unit_id?: string; qty: number; label?: string }[]> = {};
      if (ROLL_DOCS.includes(cfg.type) && (h.data as unknown as Row).status === "DRAFT") {
        const p = await sb().from("doc_unit_plans").select("plan").eq("doc_type", cfg.type).eq("doc_id", id!).maybeSingle();
        plan = (p.data?.plan as typeof plan) ?? {};
      }
      return { header: h.data as unknown as Row, lines: (l.data ?? []) as unknown as Row[], plan };
    },
  });
}

export function DocDialog({ cfg, id, onClose, onSaved }: { cfg: InvDocConfig; id: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { can } = useAccess();
  const doc = useDoc(cfg, id);
  const [mode, setMode] = React.useState<"view" | "edit">(id ? "view" : "edit");
  const [tab, setTab] = React.useState("lines");
  React.useEffect(() => {
    setMode(id ? "view" : "edit");
    setTab("lines");
  }, [id]);

  const status = String(doc.data?.header.status ?? "DRAFT");
  const title = id ? String(doc.data?.header.doc_no ?? cfg.singular) : `New ${cfg.singular}`;

  if (mode === "edit" && (!id || doc.data)) {
    return <DocForm cfg={cfg} id={id} initial={doc.data ?? null} onCancel={() => (id ? setMode("view") : onClose())} onClose={onClose} onSaved={(nid) => { setMode("view"); onSaved(nid); }} />;
  }

  return (
    <ViewDoc
      cfg={cfg}
      id={id!}
      title={title}
      status={status}
      loading={doc.isLoading}
      error={doc.error}
      data={doc.data ?? null}
      tab={tab}
      setTab={setTab}
      canEdit={status === "DRAFT" && can(cfg.perms.create)}
      onEdit={() => setMode("edit")}
      onClose={onClose}
    />
  );
}

/* ================================================================== VIEW */
function ViewDoc({
  cfg, id, title, status, loading, error, data, tab, setTab, canEdit, onEdit, onClose,
}: {
  cfg: InvDocConfig; id: string; title: string; status: string; loading: boolean; error: unknown;
  data: { header: Row; lines: Row[] } | null; tab: string; setTab: (t: string) => void;
  canEdit: boolean; onEdit: () => void; onClose: () => void;
}) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const [confirm, setConfirm] = React.useState<null | "post" | "cancel" | "reverse">(null);
  const [reason, setReason] = React.useState("");
  const files = useAttachments(cfg.table as AttachmentEntity, id);

  const action = useMutation({
    mutationFn: async (kind: "post" | "cancel" | "reverse") => {
      const r =
        kind === "post"
          ? await sb().rpc("post_stock_document", { p_doc_type: cfg.type, p_id: id })
          : kind === "cancel"
            ? await sb().rpc("cancel_stock_document", { p_doc_type: cfg.type, p_id: id })
            : await sb().rpc("reverse_stock_document", { p_doc_type: cfg.type, p_id: id, p_reason: reason.trim() });
      if (r.error) throw r.error;
    },
    onSuccess: (_d, kind) => {
      toast.success(kind === "post" ? `${title} posted — stock updated` : kind === "cancel" ? `${title} cancelled` : `${title} reversed`);
      setConfirm(null);
      setReason("");
      qc.invalidateQueries(); // stock views, lists, availability all change
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const h = data?.header;
  const wh = (k: string) => { const w = h?.[k] as { code: string; name: string } | null; return w ? `${w.code} · ${w.name}` : null; };

  return (
    <>
      <ErpDialog
        open
        onRequestClose={onClose}
        title={title}
        subtitle={h ? `${cfg.singular} · ${formatDate(h.doc_date as string)}` : undefined}
        icon={cfg.icon}
        status={<Badge tone={STATUS_TONE[status]}>{humanize(status)}</Badge>}
        size="full"
        accent="dispatch"
        footer={
          <>
            {status === "DRAFT" && can(cfg.perms.create) && (
              <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm("cancel")}>Cancel draft</Button>
            )}
            {status === "POSTED" && can(cfg.perms.reverse) && (
              <Button variant="destructive-ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("reverse")}>Reverse</Button>
            )}
            <div className="flex-1" />
            <Button onClick={onClose}>Close</Button>
            {canEdit && <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
            {status === "DRAFT" && can(cfg.perms.post) && (
              <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("post")}>Post</Button>
            )}
          </>
        }
      >
        {loading ? (
          <Skeleton className="h-48" />
        ) : error ? (
          <p className="text-sm text-danger">{friendlyError(error)}</p>
        ) : h ? (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              {cfg.kind === "transfer" ? (
                <>
                  <KeyValue label="From">{wh("from")}</KeyValue>
                  <KeyValue label="To">{wh("to")}</KeyValue>
                </>
              ) : (
                <KeyValue label="Warehouse">{wh("warehouse")}</KeyValue>
              )}
              <KeyValue label="Date">{formatDate(h.doc_date as string)}</KeyValue>
              {cfg.kind === "receipt" && <KeyValue label="Supplier">{(h.supplier as { name: string } | null)?.name ?? null}</KeyValue>}
              {cfg.kind === "receipt" && <KeyValue label="Supplier ref.">{(h.supplier_reference as string) || null}</KeyValue>}
              {cfg.kind === "receipt" && <KeyValue label="Cost"><Badge tone={h.cost_status === "PENDING" ? "warning" : "success"}>{h.cost_status === "PENDING" ? "Pending" : humanize(String(h.cost_status))}</Badge></KeyValue>}
              {cfg.kind === "adjustment" && <KeyValue label="Reason">{ADJUSTMENT_REASONS.find((r) => r.value === h.reason)?.label ?? String(h.reason)}</KeyValue>}
              {cfg.kind !== "receipt" && <KeyValue label="Reference">{(h.reference as string) || null}</KeyValue>}
              {cfg.kind === "transfer" && <KeyValue label="Transport">{(h.transport_details as string) || null}</KeyValue>}
              {h.posted_at ? <KeyValue label="Posted">{formatDateTime(h.posted_at as string)}</KeyValue> : null}
              {h.reversal_reason ? <KeyValue label="Reversal reason" className="col-span-2">{String(h.reversal_reason)}</KeyValue> : null}
              {h.notes ? <KeyValue label="Notes" className="col-span-2 md:col-span-4">{String(h.notes)}</KeyValue> : null}
            </dl>
            {cfg.kind === "receipt" && can(P.pickingManage) && <ReceiptCheckPanel receiptId={id} />}
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "lines", label: `Items (${data!.lines.length})` },
                ...(status === "POSTED" || status === "REVERSED" ? [{ key: "moves", label: "Stock movements" }] : []),
                { key: "files", label: filesLabel(files.data?.length) }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : []),
              ]}
            />
            {tab === "lines" && <LinesTable cfg={cfg} lines={data!.lines} docId={id} posted={status === "POSTED" || status === "REVERSED"} />}
            {tab === "moves" && <MovementsTable sourceId={id} />}
            {tab === "history" && <AuditTimeline table={cfg.table} id={id} />}
            {tab === "files" && <AttachmentsPanel entityType={cfg.table as AttachmentEntity} entityId={id} />}
          </>
        ) : null}
      </ErpDialog>

      <ConfirmDialog
        open={confirm === "post"}
        title={`Post ${title}?`}
        message={cfg.kind === "adjustment" ? "Stock will change immediately. Posted adjustments can only be undone by a reversal." : "Stock will update immediately and the document becomes read-only. Mistakes are corrected by reversal."}
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

function LinesTable({ cfg, lines, docId, posted }: { cfg: InvDocConfig; lines: Row[]; docId?: string; posted?: boolean }) {
  // which rolls each posted line used / created
  const rollMoves = useQuery({
    queryKey: ["doc-rolls", docId],
    enabled: !!docId && !!posted,
    queryFn: async () => {
      const { data, error } = await sb().from("stock_ledger").select("source_line_id, unit_no, quantity, movement_type, reversal_of")
        .eq("source_id", docId!).not("physical_unit_id", "is", null).is("reversal_of", null).order("created_at").limit(500);
      if (error) throw error;
      const m = new Map<string, { unit_no: string; quantity: number; movement_type: string }[]>();
      for (const r of (data ?? []) as { source_line_id: string; unit_no: string; quantity: number; movement_type: string }[]) {
        if (!m.has(r.source_line_id)) m.set(r.source_line_id, []);
        m.get(r.source_line_id)!.push(r);
      }
      return m;
    },
  });
  const cellL = "h-row border-b border-line/70 px-3";
  const locOn = useStorageLocations().enabled;
  // show location columns if the feature is on, or if this (older) document used them
  const showLoc = locOn || lines.some((l) => l.location || l.from_location || l.to_location);
  const setMode = cfg.kind === "adjustment" && lines.some((l) => l.target_qty != null);
  return (
    <div className="overflow-auto rounded-card border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            <th className="h-8 px-3">#</th>
            <th className="px-3">Product</th>
            <th className="px-3">Variant</th>
            {showLoc && (cfg.kind === "transfer" ? (<><th className="px-3">From loc.</th><th className="px-3">To loc.</th></>) : <th className="px-3">Location</th>)}
            {setMode && <th className="px-3 text-right">In stock</th>}
            {setMode && <th className="px-3 text-right">New qty</th>}
            <th className="px-3 text-right">{cfg.kind === "adjustment" ? "Change" : "Quantity"}</th>
            <th className="hidden px-3 md:table-cell">Notes</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const p = l.product as { sku: string; name: string; uom: { code: string } };
            const v = l.variant as { name: string } | null;
            const loc = (k: string) => (l[k] as { code: string } | null)?.code ?? <span className="text-ink-faint">—</span>;
            const q = Number(l.quantity);
            return (
              <tr key={String(l.id)}>
                <td className={cn(cellL, "w-8 text-ink-faint")}>{String(l.line_no)}</td>
                <td className={cellL}>
                  <div className="font-medium">{p.name}</div><div className="text-2xs text-ink-muted">{p.sku}</div>
                  {rollMoves.data?.get(String(l.id)) && (
                    <div className="mt-0.5 flex flex-wrap gap-1 pb-1">
                      {rollMoves.data.get(String(l.id))!.map((r, i) => (
                        <span key={i} className={cn("rounded border px-1 font-mono text-2xs", Number(r.quantity) < 0 ? "border-danger-line text-danger" : "border-success-line text-success")}>
                          {r.unit_no} {Number(r.quantity) > 0 ? "+" : "−"}{formatNumber(Math.abs(Number(r.quantity)), Number.isInteger(Number(r.quantity)) ? 0 : 2)}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className={cellL}>{v?.name ?? <span className="text-ink-faint">—</span>}</td>
                {showLoc && (cfg.kind === "transfer" ? (<><td className={cellL}>{loc("from_location")}</td><td className={cellL}>{loc("to_location")}</td></>) : <td className={cellL}>{loc("location")}</td>)}
                {setMode && <td className={cn(cellL, "text-right tabular-nums text-ink-muted")}>{l.system_qty == null ? "—" : formatNumber(Number(l.system_qty), Number.isInteger(Number(l.system_qty)) ? 0 : 2)}</td>}
                {setMode && <td className={cn(cellL, "text-right tabular-nums")}>{l.target_qty == null ? "—" : formatNumber(Number(l.target_qty), Number.isInteger(Number(l.target_qty)) ? 0 : 2)}</td>}
                <td className={cn(cellL, "text-right tabular-nums", cfg.kind === "adjustment" && (q < 0 ? "text-danger" : q > 0 ? "text-success" : "text-ink-faint"))}>
                  {cfg.kind === "adjustment" && q === 0 ? "no change" : <>{cfg.kind === "adjustment" && q > 0 ? "+" : ""}{formatNumber(q, Number.isInteger(q) ? 0 : 2)}</>} <span className="text-2xs text-ink-faint">{p.uom?.code}</span>
                </td>
                <td className={cn(cellL, "hidden text-xs text-ink-muted md:table-cell")}>{(l.notes as string) || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================== FORM */
function DocForm({
  cfg, id, initial, onCancel, onClose, onSaved,
}: {
  cfg: InvDocConfig; id: string | null; initial: { header: Row; lines: Row[]; plan?: Record<string, { unit_id?: string; qty: number; label?: string }[]> } | null;
  onCancel: () => void; onClose: () => void; onSaved: (id: string) => void;
}) {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const idem = React.useRef(crypto.randomUUID());

  const init = React.useMemo(() => {
    const h = initial?.header ?? {};
    const header: Header = {
      doc_date: (h.doc_date as string) ?? new Date().toISOString().slice(0, 10),
      warehouse_id: (h.warehouse_id as string) ?? null,
      from_warehouse_id: (h.from_warehouse_id as string) ?? null,
      to_warehouse_id: (h.to_warehouse_id as string) ?? null,
      supplier_id: (h.supplier_id as string) ?? null,
      supplier_reference: (h.supplier_reference as string) ?? "",
      reason: (h.reason as string) ?? (cfg.kind === "adjustment" ? "OPENING_BALANCE" : null),
      reference: (h.reference as string) ?? "",
      transport_details: (h.transport_details as string) ?? "",
      notes: (h.notes as string) ?? "",
      entry_mode: cfg.kind === "adjustment" ? ((h.entry_mode as string) ?? (initial ? "CHANGE" : "SET")) : null,
    };
    const lines: Line[] = initial?.lines.length
      ? initial.lines.map((l, i) => {
          const pl = initial.plan?.[String(i + 1)] ?? [];
          const picked = pl.filter((e) => e.unit_id);
          return {
          key: String(l.id),
          product_id: (l.product_id as string) ?? null,
          variant_id: (l.variant_id as string) ?? null,
          location_id: (l.location_id as string) ?? null,
          from_location_id: (l.from_location_id as string) ?? null,
          to_location_id: (l.to_location_id as string) ?? null,
          quantity: cfg.kind === "adjustment" ? String(Math.abs(Number(l.quantity))) : String(Number(l.quantity)),
          direction: Number(l.quantity) < 0 ? ("out" as const) : ("in" as const),
          target: l.target_qty == null ? "" : String(Number(l.target_qty)),
          rolls: pl.filter((e) => !e.unit_id).map((e) => ({ ...newRoll(String(e.qty)), label: e.label ?? "" })),
          cutMode: (picked.length ? "pick" : "auto") as CutMode,
          cuts: Object.fromEntries(picked.map((e) => [e.unit_id!, String(e.qty)])),
          notes: (l.notes as string) ?? "",
        };
        })
      : [newLine()];
    return { header, lines };
  }, [initial, cfg.kind]);

  const [header, setHeader] = React.useState<Header>(init.header);
  const [lines, setLines] = React.useState<Line[]>(init.lines);
  const [showErrors, setShowErrors] = React.useState(false);
  const snapshot = React.useRef(JSON.stringify(init));
  const dirty = JSON.stringify({ header, lines }) !== snapshot.current;
  const { guard, dialog } = useUnsavedGuard(dirty);

  const setH = (k: string, v: string | null) => setHeader((h) => ({ ...h, [k]: v }));
  const setL = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const mainWh = cfg.kind === "transfer" ? header.from_warehouse_id : header.warehouse_id;
  const errors = validate(cfg, header, lines);
  const hasErrors = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const setMode = cfg.kind === "adjustment" && header.entry_mode === "SET";
      const payloadLines = lines
        .filter((l) => isUsed(l))
        .map((l) => ({
          product_id: l.product_id,
          variant_id: l.variant_id,
          location_id: l.location_id,
          from_location_id: l.from_location_id,
          to_location_id: l.to_location_id,
          quantity: cfg.kind !== "adjustment"
            ? l.quantity.replace(/,/g, "")
            : setMode ? null : `${l.direction === "out" ? "-" : ""}${l.quantity.replace(/,/g, "").replace(/^[-+]/, "")}`,
          target_qty: setMode ? l.target.replace(/,/g, "") : null,
          notes: l.notes || null,
        }));
      const { data, error } = await sb().rpc(cfg.saveRpc, {
        p_id: id,
        p_header: { ...header, company_id: companyId },
        p_lines: payloadLines,
        p_idempotency_key: id ? null : idem.current,
      });
      if (error) throw error;
      const newId = data as string;
      if (ROLL_DOCS.includes(cfg.type)) {
        const plan: Record<string, unknown[]> = {};
        lines.filter((l) => isUsed(l)).forEach((l, i) => {
          const flow = lineFlow(cfg, l, header.entry_mode);
          if (flow === "in" && l.rolls.length) {
            plan[String(i + 1)] = l.rolls.filter((r) => r.qty.trim() !== "").map((r) => ({ qty: r.qty.replace(/,/g, ""), label: r.label || null }));
          } else if (flow === "out" && l.cutMode === "pick") {
            plan[String(i + 1)] = Object.entries(l.cuts).filter(([, v]) => v.trim() !== "" && Number(v.replace(/,/g, "")) > 0).map(([unit_id, v]) => ({ unit_id, qty: v.replace(/,/g, "") }));
          }
        });
        const pr = await sb().rpc("save_unit_plan", { p_doc_type: cfg.type, p_doc_id: newId, p_plan: plan });
        if (pr.error) throw Object.assign(pr.error, { savedId: newId });
      }
      if (andPost) {
        const r = await sb().rpc("post_stock_document", { p_doc_type: cfg.type, p_id: newId });
        if (r.error) {
          // saved as draft but not posted — surface both facts
          throw Object.assign(r.error, { savedId: newId });
        }
      }
      return { id: newId, posted: andPost };
    },
    onSuccess: ({ id: nid, posted }) => {
      snapshot.current = JSON.stringify({ header, lines });
      idem.current = crypto.randomUUID();
      toast.success(posted ? `${cfg.singular} posted — stock updated` : "Draft saved");
      qc.invalidateQueries();
      onSaved(nid);
    },
    onError: (e: Error & { savedId?: string }) => {
      if (e.savedId) {
        snapshot.current = JSON.stringify({ header, lines });
        toast.error(`Saved as draft, but not posted: ${friendlyError(e)}`);
        qc.invalidateQueries();
        onSaved(e.savedId);
      } else toast.error(friendlyError(e));
    },
  });

  const submit = (andPost: boolean) => {
    setShowErrors(true);
    if (hasErrors) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    if (!save.isPending) save.mutate(andPost);
  };

  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const canPostNow = can(cfg.perms.post);

  return (
    <>
      <ErpDialog
        open
        onRequestClose={() => guard(onClose)}
        title={id ? `Edit ${String(initial?.header.doc_no ?? "")}` : `New ${cfg.singular}`}
        icon={cfg.icon}
        status={<Badge tone="warning">Draft</Badge>}
        size="xl"
        footer={
          <>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1" />
            <Button onClick={() => guard(onCancel)}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)}>
              Save draft
            </Button>
            {canPostNow && (
              <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={() => submit(true)}>
                Save & post
              </Button>
            )}
          </>
        }
      >
        <FormGrid cols={4}>
          {cfg.kind === "transfer" ? (
            <>
              <Field label="From warehouse" required error={err("from_warehouse_id")}>
                <WarehousePicker value={header.from_warehouse_id} onChange={(v) => { setH("from_warehouse_id", v); setLines((ls) => ls.map((l) => ({ ...l, from_location_id: null, cuts: {} }))); }} invalid={!!err("from_warehouse_id")} />
              </Field>
              <Field label="To warehouse" required error={err("to_warehouse_id")}>
                <WarehousePicker value={header.to_warehouse_id} onChange={(v) => { setH("to_warehouse_id", v); setLines((ls) => ls.map((l) => ({ ...l, to_location_id: null }))); }} invalid={!!err("to_warehouse_id")} />
              </Field>
            </>
          ) : (
            <Field label="Warehouse" required error={err("warehouse_id")}>
              <WarehousePicker value={header.warehouse_id} onChange={(v) => { setH("warehouse_id", v); setLines((ls) => ls.map((l) => ({ ...l, location_id: null, cuts: {} }))); }} invalid={!!err("warehouse_id")} />
            </Field>
          )}
          <Field label="Date" required>
            <Input type="date" value={header.doc_date ?? ""} onChange={(e) => setH("doc_date", e.target.value)} />
          </Field>
          {cfg.kind === "receipt" && (
            <>
              <Field label="Supplier"><SupplierPicker value={header.supplier_id} onChange={(v) => setH("supplier_id", v)} /></Field>
              <Field label="Supplier ref. / packing list"><Input value={header.supplier_reference ?? ""} onChange={(e) => setH("supplier_reference", e.target.value)} /></Field>
            </>
          )}
          {cfg.kind === "adjustment" && (
            <Field label="Reason" required error={err("reason")}>
              <SearchableSelect value={header.reason} onChange={(v) => setH("reason", v)} options={ADJUSTMENT_REASONS} clearable={false} />
            </Field>
          )}
          {cfg.kind !== "receipt" && (
            <Field label="Reference"><Input value={header.reference ?? ""} onChange={(e) => setH("reference", e.target.value)} /></Field>
          )}
        </FormGrid>

        <div className="mt-1">
          <SectionTitle
            action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((ls) => [...ls, newLine()])}>Add item</Button>}
          >
            Items
          </SectionTitle>
          {cfg.kind === "adjustment" && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="inline-flex rounded-control border border-line bg-subtle p-0.5" role="radiogroup" aria-label="How to enter quantities">
                {([["SET", "Enter new quantity"], ["CHANGE", "Add / remove"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={header.entry_mode === m}
                    onClick={() => setH("entry_mode", m)}
                    className={cn("h-[26px] rounded-[6px] px-2.5 text-xs font-medium", header.entry_mode === m ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-ink-muted">
                {header.entry_mode === "SET"
                  ? "Type the quantity physically in stock now — the system works out the increase or decrease."
                  : "Choose Add or Remove on each line, then type the quantity."}
              </span>
            </div>
          )}
          {showErrors && errors.lines && <p className="mb-2 text-xs text-danger">{errors.lines}</p>}
          <div className="space-y-2">
            {lines.map((l, i) => (
              <LineRow
                key={l.key}
                cfg={cfg}
                entryMode={(header.entry_mode as EntryMode) ?? "CHANGE"}
                idx={i}
                line={l}
                mainWh={mainWh}
                toWh={header.to_warehouse_id}
                showErrors={showErrors}
                errors={errors}
                onChange={(patch) => setL(l.key, patch)}
                onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((x) => x.key !== l.key)) : undefined}
              />
            ))}
          </div>
        </div>

        <ConditionalSection
          className="mt-4"
          label={cfg.kind === "transfer" ? "Show Transfer Details" : cfg.kind === "receipt" ? "Show Receiving Details" : "Show Adjustment Details"}
          description={cfg.kind === "transfer" ? "Transport / handler, notes" : "Notes"}
          populated={!!(header.notes || header.transport_details)}
        >
          <FormGrid cols={2}>
            {cfg.kind === "transfer" && (
              <Field label="Transport / handler"><Input value={header.transport_details ?? ""} onChange={(e) => setH("transport_details", e.target.value)} placeholder="Vehicle, driver…" /></Field>
            )}
            <Field label="Notes" className={cfg.kind === "transfer" ? "" : "sm:col-span-2"}>
              <Textarea rows={2} value={header.notes ?? ""} onChange={(e) => setH("notes", e.target.value)} />
            </Field>
          </FormGrid>
        </ConditionalSection>
        {cfg.kind === "receipt" && (
          <p className="mt-3 text-xs text-ink-muted">
            Purchase cost is not entered here — the receipt stays <Badge tone="warning">Cost pending</Badge> until the cost workflow (Purchasing stage).
          </p>
        )}
      </ErpDialog>
      {dialog}
    </>
  );
}

function LineRow({
  cfg, entryMode, idx, line, mainWh, toWh, showErrors, errors, onChange, onRemove,
}: {
  cfg: InvDocConfig; entryMode: EntryMode; idx: number; line: Line; mainWh: string | null; toWh: string | null;
  showErrors: boolean; errors: Record<string, string>; onChange: (p: Partial<Line>) => void; onRemove?: () => void;
}) {
  const meta = useProductMeta(line.product_id);
  const locOn = useStorageLocations().enabled;
  const e = (f: string) => (showErrors ? errors[`${line.key}.${f}`] : undefined);
  const outbound = cfg.kind === "transfer" || (cfg.kind === "adjustment" && line.direction === "out");
  const adj = cfg.kind === "adjustment";
  const rollsOn = !!meta.data?.rolls;
  const flow = lineFlow(cfg, line, entryMode);
  const qtyLocked = rollsOn && ((flow === "in" && line.rolls.length > 0) || (flow === "out" && line.cutMode === "pick"));
  const setRolls = (r: RollEntry[]) => onChange({ rolls: r, ...(r.length ? { quantity: String(+sumRolls(r).toFixed(4)) } : {}) });
  const setCuts = (c: Cuts) => onChange({ cuts: c, quantity: String(+sumCuts(c).toFixed(4)) });
  return (
    <div className="grid grid-cols-12 items-start gap-2 rounded-control border border-line bg-surface p-2">
      <div className={cn("col-span-12 flex items-center gap-2", locOn || adj ? "md:col-span-4" : "md:col-span-5")}>
        <span className="w-5 shrink-0 text-center text-2xs text-ink-faint">{idx + 1}</span>
        <div className="min-w-0 flex-1">
          <ProductPicker warehouseId={mainWh} value={line.product_id} onChange={(v) => onChange({ product_id: v, variant_id: null, rolls: [], cuts: {}, cutMode: "auto" })} invalid={!!e("product_id")} />
          {e("product_id") && <p className="mt-0.5 text-2xs text-danger">{e("product_id")}</p>}
        </div>
      </div>
      <div className={cn("col-span-6", locOn ? "md:col-span-2" : "md:col-span-3")}>
        <VariantPicker productId={line.product_id} warehouseId={mainWh} value={line.variant_id} onChange={(v) => onChange({ variant_id: v, cuts: {} })} invalid={!!e("variant_id")} />
        {e("variant_id") && <p className="mt-0.5 text-2xs text-danger">{e("variant_id")}</p>}
      </div>
      {!locOn ? null : cfg.kind === "transfer" ? (
        <>
          <div className="col-span-3 md:col-span-2"><LocationPicker warehouseId={mainWh} value={line.from_location_id} onChange={(v) => onChange({ from_location_id: v })} /></div>
          <div className="col-span-3 md:col-span-1"><LocationPicker warehouseId={toWh} value={line.to_location_id} onChange={(v) => onChange({ to_location_id: v })} /></div>
        </>
      ) : (
        <div className="col-span-6 md:col-span-2"><LocationPicker warehouseId={mainWh} value={line.location_id} onChange={(v) => onChange({ location_id: v })} /></div>
      )}
      {adj ? (
        <div className={cn("col-span-10", locOn ? "md:col-span-3" : "md:col-span-4")}>
          <AdjustmentQty entryMode={entryMode} line={line} mainWh={mainWh} uom={meta.data?.uom ?? ""} decimals={meta.data?.allow_decimal ? 2 : 0} error={e(entryMode === "SET" ? "target" : "quantity")} onChange={onChange} lockQty={qtyLocked} />
        </div>
      ) : (
      <div className={cn(locOn ? "col-span-10" : "col-span-4", !locOn || cfg.kind !== "transfer" ? "md:col-span-3" : "md:col-span-2")}>
        <div className="flex items-center gap-1.5">
          <Input
            inputMode="decimal"
            className="text-right tabular-nums"
            placeholder={cfg.kind === "adjustment" ? "+/− qty" : "Qty"}
            readOnly={qtyLocked}
            title={qtyLocked ? "Worked out from the rolls below" : undefined}
            value={line.quantity}
            invalid={!!e("quantity")}
            onChange={(ev) => onChange({ quantity: ev.target.value })}
          />
          <span className="w-9 shrink-0 text-2xs text-ink-faint">{meta.data?.uom ?? ""}</span>
        </div>
        {e("quantity") ? (
          <p className="mt-0.5 text-2xs text-danger">{e("quantity")}</p>
        ) : (
          <Availability warehouseId={mainWh} productId={line.product_id} variantId={line.variant_id} className={outbound ? "" : "text-ink-faint"} />
        )}
      </div>
      )}
      <div className="col-span-2 flex justify-end md:col-span-1">
        {onRemove && (
          <Button size="icon-sm" variant="ghost" aria-label="Remove line" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-ink-faint" />
          </Button>
        )}
      </div>
      {rollsOn && (
        <div className="col-span-12 border-t border-dashed border-line pt-2 md:pl-7">
          {flow === "in" ? (
            <RollLengthsEditor rolls={line.rolls} onChange={setRolls} uom={meta.data?.uom ?? ""} fallbackQty={line.quantity} />
          ) : flow === "out" ? (
            <RollCutsEditor mode={line.cutMode} cuts={line.cuts} uom={meta.data?.uom ?? ""}
              onMode={(m) => onChange({ cutMode: m, cuts: {} })} onCuts={setCuts}
              warehouseId={mainWh} productId={line.product_id} variantId={line.variant_id} />
          ) : (
            <p className="text-xs text-warning">This item is tracked by roll. Switch to <b>Add / remove</b> above to choose the roll, or correct a single roll on Inventory → Rolls.</p>
          )}
          {e("rolls") && <p className="mt-1 text-2xs text-danger">{e("rolls")}</p>}
        </div>
      )}
    </div>
  );
}

function validate(cfg: InvDocConfig, h: Header, lines: Line[]) {
  const e: Record<string, string> = {};
  if (cfg.kind === "transfer") {
    if (!h.from_warehouse_id) e.from_warehouse_id = "Required";
    if (!h.to_warehouse_id) e.to_warehouse_id = "Required";
  } else if (!h.warehouse_id) e.warehouse_id = "Required";
  if (cfg.kind === "adjustment" && !h.reason) e.reason = "Required";
  const used = lines.filter((l) => isUsed(l));
  if (!used.length) e.lines = "Add at least one item";
  if (cfg.kind === "adjustment") {
    const seen = new Set<string>();
    for (const l of used) {
      if (!l.product_id) e[`${l.key}.product_id`] = "Select a product";
      if (h.entry_mode === "SET") {
        const t = Number(l.target.replace(/,/g, ""));
        if (!l.target.trim() || Number.isNaN(t)) e[`${l.key}.target`] = "Enter the quantity in stock";
        else if (t < 0) e[`${l.key}.target`] = "Cannot be negative";
        const k = `${l.product_id}|${l.variant_id ?? ""}|${l.location_id ?? ""}`;
        if (l.product_id && seen.has(k)) e[`${l.key}.target`] = "Item already listed above";
        seen.add(k);
      } else {
        if (l.direction === "in" && l.rolls.some((r) => !(Number(r.qty.replace(/,/g, "")) > 0))) e[`${l.key}.rolls`] = "Each roll needs a length";
        if (l.direction === "out" && l.cutMode === "pick" && !(sumCuts(l.cuts) > 0)) e[`${l.key}.rolls`] = "Enter how much to cut from at least one roll";
        const q = Number(l.quantity.replace(/,/g, "").replace(/^[-+]/, ""));
        if (!l.quantity.trim() || Number.isNaN(q)) e[`${l.key}.quantity`] = "Enter a quantity";
        else if (q <= 0) e[`${l.key}.quantity`] = "Must be more than 0";
        else if (h.reason === "OPENING_BALANCE" && l.direction === "out") e[`${l.key}.quantity`] = "Opening stock can only add";
      }
    }
    return e;
  }
  for (const l of used) {
    if (!l.product_id) e[`${l.key}.product_id`] = "Select a product";
    if (cfg.kind === "receipt" && l.rolls.some((r) => !(Number(r.qty.replace(/,/g, "")) > 0))) e[`${l.key}.rolls`] = "Each roll needs a length";
    if (cfg.kind === "transfer" && l.cutMode === "pick" && !(sumCuts(l.cuts) > 0)) e[`${l.key}.rolls`] = "Enter how much to cut from at least one roll";
    const q = Number(l.quantity.replace(/,/g, ""));
    if (!l.quantity.trim() || Number.isNaN(q)) e[`${l.key}.quantity`] = "Enter a number";
    else if (q === 0) e[`${l.key}.quantity`] = "Cannot be 0";
    else if (q < 0) e[`${l.key}.quantity`] = "Must be positive";
  }
  return e;
}

// variant requirement is checked by the server (and shown inline via the error message);
// the client can't know has_variants synchronously for every line without extra queries.

const isUsed = (l: Line) => !!(l.product_id || l.quantity.trim() || l.target.trim());

/** Quantity cell for adjustments: "Enter new quantity" (default) or "Add / remove". */
function AdjustmentQty({
  entryMode, line, mainWh, uom, decimals, error, onChange, lockQty,
}: {
  entryMode: EntryMode; line: Line; mainWh: string | null; uom: string; decimals: number; error?: string;
  onChange: (p: Partial<Line>) => void; lockQty?: boolean;
}) {
  const stock = useStockFigures(mainWh, line.product_id, line.variant_id);
  const onHand = stock.data ? Number(stock.data.on_hand) : null;
  const fmt = (n: number) => formatNumber(n, decimals);

  if (entryMode === "SET") {
    const t = Number(line.target.replace(/,/g, ""));
    const valid = line.target.trim() !== "" && !Number.isNaN(t) && t >= 0;
    const diff = valid && onHand !== null ? t - onHand : null;
    return (
      <div>
        <div className="flex items-center gap-1.5">
          <Input
            inputMode="decimal"
            className="text-right tabular-nums"
            placeholder="New qty in stock"
            aria-label="New quantity in stock"
            value={line.target}
            invalid={!!error}
            onChange={(ev) => onChange({ target: ev.target.value })}
          />
          <span className="w-9 shrink-0 text-2xs text-ink-faint">{uom}</span>
        </div>
        {error ? (
          <p className="mt-0.5 text-2xs text-danger">{error}</p>
        ) : (
          <p className="mt-0.5 whitespace-nowrap text-2xs tabular-nums text-ink-muted">
            {onHand === null ? <>&nbsp;</> : (
              <>
                In stock {fmt(onHand)}
                {diff !== null && (
                  <> → <b className={cn(diff > 0 ? "text-success" : diff < 0 ? "text-danger" : "text-ink-faint")}>
                    {diff > 0 ? `+${fmt(diff)}` : diff < 0 ? `−${fmt(-diff)}` : "no change"}
                  </b></>
                )}
              </>
            )}
          </p>
        )}
      </div>
    );
  }

  const out = line.direction === "out";
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="inline-flex shrink-0 rounded-control border border-line bg-subtle p-0.5" role="radiogroup" aria-label="Add or remove">
          <button type="button" role="radio" aria-checked={!out} title="Add to stock" onClick={() => onChange({ direction: "in" })}
            className={cn("flex h-[26px] items-center gap-1 rounded-[6px] px-2 text-xs font-medium", !out ? "bg-success-soft text-success shadow-card" : "text-ink-muted")}>
            <Plus className="h-3 w-3" />Add
          </button>
          <button type="button" role="radio" aria-checked={out} title="Remove from stock" onClick={() => onChange({ direction: "out" })}
            className={cn("flex h-[26px] items-center gap-1 rounded-[6px] px-2 text-xs font-medium", out ? "bg-danger-soft text-danger shadow-card" : "text-ink-muted")}>
            <Minus className="h-3 w-3" />Remove
          </button>
        </div>
        <Input
          inputMode="decimal"
          className="min-w-0 text-right tabular-nums"
          placeholder="Qty"
          aria-label={out ? "Quantity to remove" : "Quantity to add"}
          readOnly={lockQty}
          title={lockQty ? "Worked out from the rolls below" : undefined}
          value={line.quantity}
          invalid={!!error}
          onChange={(ev) => {
            const v = ev.target.value;
            // typing a minus still works: it switches to Remove
            if (v.trim().startsWith("-")) onChange({ direction: "out", quantity: v.trim().slice(1) });
            else onChange({ quantity: v });
          }}
        />
        <span className="w-9 shrink-0 text-2xs text-ink-faint">{uom}</span>
      </div>
      {error ? (
        <p className="mt-0.5 text-2xs text-danger">{error}</p>
      ) : (
        <p className="mt-0.5 whitespace-nowrap text-2xs tabular-nums text-ink-muted">
          {onHand === null ? <>&nbsp;</> : (() => {
            const q = Number(line.quantity.replace(/,/g, ""));
            const ok = line.quantity.trim() !== "" && !Number.isNaN(q) && q > 0;
            return <>In stock {fmt(onHand)}{ok && <> → <b className={out ? "text-danger" : "text-success"}>{fmt(onHand + (out ? -q : q))}</b></>}</>;
          })()}
        </p>
      )}
    </div>
  );
}
