/**
 * Shown on a document (sales order, invoice, bill, voucher …):
 *   - its review workflow (Settings → Workflows): steps, who acts now, missing fields, the actions you may take, history
 *   - its custom fields (Settings → Custom fields → documents), viewable and editable in place
 * The database enforces everything (approve / post is refused until the steps are done); this only shows and calls it.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleDot, ListChecks, Pencil, Save, TriangleAlert } from "lucide-react";
import { Button, ErpDialog, Field, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { formatDateTime } from "@jst/utilities";
import { CfFormSection, CfViewSection, saveCfValues, useCfDefs, useCfForm, useCfValues, type CfDef } from "../lib/customFields";

export type WorkflowDocType =
  | "SALES_ORDER" | "QUOTATION" | "GDN" | "SALES_INVOICE" | "PURCHASE_ORDER" | "GOODS_RECEIPT" | "SUPPLIER_BILL"
  | "RECEIPT_VOUCHER" | "PAYMENT_VOUCHER" | "TRANSFER_VOUCHER" | "JOURNAL_VOUCHER" | "STOCK_ADJUSTMENT" | "STOCK_TRANSFER";

/** the permission needed to change a document's custom fields (same as the database's cf_entity_perm) */
const CF_EDIT_PERM: Record<string, string> = {
  sales_orders: "sales.manage", quotations: "sales.manage", gdns: "sales.dispatch", sales_invoices: "sales.invoice",
  purchase_orders: "purchasing.manage", goods_receipts: "inventory.receive", supplier_bills: "purchasing.costs",
  journal_entries: "journals.create", stock_adjustments: "inventory.adjust", stock_transfers: "inventory.transfer", shipments: "purchasing.manage",
};

export const voucherDocType = (entryType: string | null | undefined): WorkflowDocType | null =>
  entryType === "RECEIPT" ? "RECEIPT_VOUCHER" : entryType === "PAYMENT" ? "PAYMENT_VOUCHER" : entryType === "TRANSFER" ? "TRANSFER_VOUCHER" : entryType === "JOURNAL" ? "JOURNAL_VOUCHER" : null;
export const stockDocType = (table: string): WorkflowDocType | null =>
  table === "goods_receipts" ? "GOODS_RECEIPT" : table === "stock_adjustments" ? "STOCK_ADJUSTMENT" : table === "stock_transfers" ? "STOCK_TRANSFER" : null;

interface WfAction { id: string; label: string; to: string; kind: "forward" | "back" | "finish"; requires_comment: boolean; allowed: boolean }
interface WfState {
  active: boolean; applies?: boolean; name?: string; done?: boolean; gate: string; status?: string; cf_missing: string[];
  current?: { id: string; name: string; role_names: string; missing: string[] } | null;
  steps?: { id: string; name: string; role_names: string; state: "done" | "current" | "todo" }[];
  actions?: WfAction[];
  events?: { at: string; by: string | null; label: string; from: string | null; to: string | null; comment: string | null }[];
}

export function useWorkflowState(docType: WorkflowDocType | null, id: string | null | undefined) {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["wf-state", docType, id],
    enabled: !!companyId && !!docType && !!id,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("workflow_state", { p_company: companyId, p_doc_type: docType, p_id: id });
      if (error) return null; // older database without workflows
      return data as WfState | null;
    },
  });
}

export function DocExtras({ docType, entity, id, className }: { docType: WorkflowDocType | null; entity: string; id: string | null | undefined; className?: string }) {
  if (!id) return null;
  return (
    <div className={cn("mb-3 space-y-2", className)}>
      {docType && <WorkflowBar docType={docType} id={id} />}
      <DocFields entity={entity} id={id} />
    </div>
  );
}

function WorkflowBar({ docType, id }: { docType: WorkflowDocType; id: string }) {
  const q = useWorkflowState(docType, id);
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [ask, setAsk] = React.useState<WfAction | null>(null);
  const [comment, setComment] = React.useState("");
  const [showHistory, setShowHistory] = React.useState(false);
  const move = useMutation({
    mutationFn: async ({ a, text }: { a: WfAction; text: string }) => {
      const { error } = await sb().rpc("workflow_move", { p_company: companyId, p_doc_type: docType, p_id: id, p_transition: a.id, p_comment: text || null });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.a.kind === "back" ? `Sent back to ${v.a.to}` : v.a.kind === "finish" ? `Steps finished — ready to ${q.data?.gate ?? "continue"}` : `Passed to ${v.a.to}`);
      setAsk(null); setComment("");
      qc.invalidateQueries({ queryKey: ["wf-state", docType, id] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const s = q.data;
  if (!s) return null;
  const cfMissing = s.cf_missing ?? [];
  const showWf = !!s.steps?.length && (s.applies || (s.events?.length ?? 0) > 0);
  if (!showWf && !cfMissing.length) return null;
  const doAct = (a: WfAction) => (a.requires_comment ? (setAsk(a), setComment("")) : move.mutate({ a, text: "" }));
  const missing = s.current?.missing ?? [];
  return (
    <div className="rounded-card border border-line">
      {showWf && (
        <div className="flex flex-col gap-2 p-2.5 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs">
            <ListChecks className="mr-0.5 h-4 w-4 shrink-0 text-ink-muted" />
            <span className="mr-1 font-medium text-ink-2">{s.name}</span>
            {s.steps!.map((st, i) => (
              <React.Fragment key={st.id}>
                {i > 0 && <span className="text-ink-faint">›</span>}
                <span title={st.role_names} className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2",
                  st.state === "done" ? "border-success-line bg-success-soft text-success" : st.state === "current" ? "border-ink bg-ink text-white" : "border-line text-ink-muted")}>
                  {st.state === "done" ? <Check className="h-3 w-3" /> : st.state === "current" ? <CircleDot className="h-3 w-3" /> : null}{st.name}
                </span>
              </React.Fragment>
            ))}
            {s.done && <span className="ml-1 inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" />Ready to {s.gate}</span>}
          </div>
          {s.applies && !s.done && (
            <div className="flex flex-wrap items-center gap-1.5">
              {s.actions!.filter((a) => a.allowed).map((a) => (
                <Button key={a.id} size="sm" variant={a.kind === "back" ? "ghost" : "primary"} loading={move.isPending && move.variables?.a.id === a.id}
                  icon={a.kind === "back" ? <ArrowLeft className="h-3.5 w-3.5" /> : a.kind === "finish" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  onClick={() => doAct(a)}>{a.label}</Button>
              ))}
              {!s.actions!.some((a) => a.allowed) && s.current && <span className="text-xs text-ink-muted">Waiting for {s.current.role_names}</span>}
            </div>
          )}
        </div>
      )}
      {showWf && s.applies && !s.done && missing.length > 0 && (
        <div className="flex items-start gap-1.5 border-t border-line px-2.5 py-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Before passing "{s.current?.name}" fill in: {missing.join(", ")}
        </div>
      )}
      {cfMissing.length > 0 && (
        <div className={cn("flex items-start gap-1.5 px-2.5 py-1.5 text-xs text-warning", showWf && "border-t border-line")}>
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Required before you {s.gate} it: {cfMissing.join(", ")}
        </div>
      )}
      {showWf && (s.events?.length ?? 0) > 0 && (
        <div className="border-t border-line px-2.5 py-1">
          <button type="button" className="inline-flex items-center gap-1 text-2xs text-ink-muted hover:text-ink" onClick={() => setShowHistory((v) => !v)}>
            <ChevronDown className={cn("h-3 w-3 transition-transform", showHistory && "rotate-180")} />Review history ({s.events!.length})
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-1 pb-1">
              {s.events!.map((e, i) => (
                <li key={i} className="text-xs text-ink-2">
                  <span className="text-ink-muted">{formatDateTime(e.at)}</span> · <b>{e.by ?? "—"}</b>: {e.label} <span className="text-ink-muted">({e.from} → {e.to})</span>
                  {e.comment && <div className="ml-3 italic text-ink-muted">“{e.comment}”</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {ask && (
        <ErpDialog open size="sm" onRequestClose={() => setAsk(null)} title={ask.label} icon={<ArrowLeft className="h-4 w-4" />}
          footer={<><div className="flex-1" /><Button onClick={() => setAsk(null)}>Cancel</Button>
            <Button variant="primary" loading={move.isPending} disabled={comment.trim().length < 3} onClick={() => move.mutate({ a: ask, text: comment.trim() })}>{ask.label}</Button></>}>
          <Field label="Comment" required hint="Say what needs to change — it is kept in the review history">
            <Textarea autoFocus rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </ErpDialog>
      )}
    </div>
  );
}

const NO_DEFS: CfDef[] = [];

function DocFields({ entity, id }: { entity: string; id: string }) {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const defs = useCfDefs(entity).data ?? NO_DEFS;
  const rows = useCfValues(entity, [id], defs.length > 0);
  const [edit, setEdit] = React.useState(false);
  const cf = useCfForm(defs, rows.data, `${id}:${edit}`);
  const save = useMutation({
    mutationFn: async () => {
      if (!cf.validate()) throw new Error("Check the fields");
      await saveCfValues(companyId!, entity, id, defs, cf.values);
    },
    onSuccess: () => {
      toast.success("Fields saved");
      setEdit(false);
      qc.invalidateQueries({ queryKey: ["cf-values", entity] });
      qc.invalidateQueries({ queryKey: ["wf-state"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  if (!defs.length) return null;
  const canEdit = can(CF_EDIT_PERM[entity] ?? "settings.manage");
  if (edit) {
    return (
      <div className="space-y-2">
        <CfFormSection title="Document fields" defs={defs} values={cf.values} errors={cf.errors} onChange={cf.set} recordId={id} rows={rows.data} />
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => setEdit(false)}>Cancel</Button>
          <Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>Save fields</Button>
        </div>
      </div>
    );
  }
  return (
    <CfViewSection title="Document fields" defs={defs} rows={rows.data ?? []}
      action={canEdit ? <Button size="sm" variant="ghost" icon={<Pencil className="h-3 w-3" />} onClick={() => setEdit(true)}>Edit</Button> : null} />
  );
}
