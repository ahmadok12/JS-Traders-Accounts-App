import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, CheckCircle2, ClipboardCheck, TriangleAlert, UserRoundCog } from "lucide-react";
import { Badge, Button, ConfirmDialog, Field, Input, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDateTime } from "@jst/utilities";
import { qtyFmt } from "../sales/common";
import { PickerChips, SeenBadge, staffOf, usePickingStaff, type PickAssignee } from "./common";
import { usePickingRealtime } from "./realtime";

export type JobType = "COUNT" | "RECEIPT";

export function useJobTeam(jobType: JobType, jobId: string | null) {
  return useQuery({
    queryKey: ["job", "team", jobType, jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await sb().from("warehouse_job_assignees").select("id, user_id, assigned_at, acknowledged_at, removed_at")
        .eq("job_type", jobType).eq("job_id", jobId!).is("removed_at", null).order("assigned_at");
      if (error) throw error;
      return (data ?? []) as PickAssignee[];
    },
  });
}

/** Who is doing this count / receiving check, whether they have seen it, and "Send to staff". */
export function JobTeamPanel({ jobType, jobId, warehouseId, editable, submitted }: {
  jobType: JobType; jobId: string; warehouseId: string; editable: boolean;
  submitted?: { at: string | null; by: string | null; note: string | null } | null;
}) {
  const { can } = useAccess();
  const qc = useQueryClient();
  usePickingRealtime(true);
  const staff = usePickingStaff();
  const team = useJobTeam(jobType, jobId);
  const names = new Map((staff.data ?? []).map((s) => [s.user_id, s.full_name]));
  const [open, setOpen] = React.useState(false);
  const [who, setWho] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("assign_warehouse_job", { p_type: jobType, p_id: jobId, p_users: who, p_note: note || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(who.length ? "Sent — their phones are buzzing" : "Staff removed"); setOpen(false); setNote(""); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  if (!can(P.pickingManage)) return null;
  const members = team.data ?? [];
  return (
    <div className="mb-4 rounded-card border border-sky-200 bg-sky-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"><BellRing className="h-3.5 w-3.5 text-sky-600" /> Warehouse staff</span>
        {members.map((m) => <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-0.5 text-sm">{names.get(m.user_id) ?? "…"} <SeenBadge a={m} /></span>)}
        {members.length === 0 && <span className="text-sm text-ink-muted">Not sent to anyone — {jobType === "COUNT" ? "you can count here yourself, or send it to staff's phones" : "send it to staff to tick what arrived"}.</span>}
        <div className="flex-1" />
        {submitted?.at && <Badge tone="success">Finished by {names.get(submitted.by ?? "") ?? "staff"} · {formatDateTime(submitted.at)}</Badge>}
        {editable && <Button size="sm" icon={<UserRoundCog className="h-3.5 w-3.5" />} onClick={() => { setWho(members.map((m) => m.user_id)); setOpen(true); }}>{members.length ? "Change staff" : "Send to staff"}</Button>}
      </div>
      {submitted?.note && <p className="mt-1 text-xs text-ink-muted">Note: {submitted.note}</p>}
      <ConfirmDialog open={open} title={jobType === "COUNT" ? "Send this count to staff" : "Send this receiving check to staff"} confirmLabel="Send & buzz" loading={save.isPending}
        message="Choose one, several or all staff of this warehouse. Their phones buzz; they work on it together."
        onCancel={() => setOpen(false)} onConfirm={() => save.mutate()}>
        <div className="mt-3"><PickerChips people={staffOf(staff.data, warehouseId)} value={who} onChange={setWho} /></div>
        <Field label="Note" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={jobType === "COUNT" ? "e.g. count rack A and B only" : "e.g. Daewoo container, gate 2"} /></Field>
      </ConfirmDialog>
    </div>
  );
}

interface CheckLine {
  id: string; line_no: number; product_id: string; variant_id: string | null; location_id: string | null; expected_qty: number; checked_qty: number | null; note: string | null;
  checked_by: string | null; checked_at: string | null; product: { name: string; sku: string; uom: { code: string } | null } | null; variant: { name: string } | null;
}
export function useReceiptCheck(receiptId: string | null) {
  return useQuery({
    queryKey: ["job", "receipt", receiptId],
    enabled: !!receiptId,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from("goods_receipts").select("id, company_id, doc_no, doc_date, status, warehouse_id, supplier_id, supplier_reference, notes, check_status, check_submitted_at, check_submitted_by, check_note, warehouse:warehouses(code, name), supplier:suppliers(name)").eq("id", receiptId!).single(),
        sb().from("receipt_check_lines").select("id, line_no, product_id, variant_id, location_id, expected_qty, checked_qty, note, checked_by, checked_at, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name)").eq("receipt_id", receiptId!).order("line_no"),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      return { header: h.data as unknown as Record<string, unknown> & { id: string; status: string; check_status: string | null; warehouse_id: string; doc_no: string }, lines: (l.data ?? []) as unknown as CheckLine[] };
    },
  });
}

/** Goods receipt: send the receiving check to staff, see what they ticked, apply it to the receipt. */
export function ReceiptCheckPanel({ receiptId }: { receiptId: string }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const chk = useReceiptCheck(receiptId);
  const staff = usePickingStaff();
  const names = new Map((staff.data ?? []).map((s) => [s.user_id, s.full_name]));
  const [confirm, setConfirm] = React.useState(false);
  const apply = useMutation({
    mutationFn: async () => {
      const h = chk.data!.header;
      const lines = chk.data!.lines.filter((l) => Number(l.checked_qty) > 0).map((l) => ({
        product_id: l.product_id, variant_id: l.variant_id, location_id: l.location_id, quantity: String(l.checked_qty), notes: l.note,
      }));
      if (!lines.length) throw new Error("Nothing arrived — cancel the receipt instead");
      const { error } = await sb().rpc("save_goods_receipt", {
        p_id: h.id,
        p_header: { company_id: h.company_id, warehouse_id: h.warehouse_id, doc_date: h.doc_date, supplier_id: h.supplier_id, supplier_reference: h.supplier_reference, notes: h.notes },
        p_lines: lines, p_idempotency_key: null,
      });
      if (error) throw error;
      const m = await sb().rpc("mark_receipt_check_applied", { p_receipt_id: h.id });
      if (m.error) throw m.error;
    },
    onSuccess: () => { toast.success("Receipt updated to what actually arrived — check and post it"); setConfirm(false); qc.invalidateQueries(); },
    onError: (e) => { setConfirm(false); toast.error(friendlyError(e)); },
  });
  if (chk.isLoading || !chk.data) return null;
  const h = chk.data.header;
  const lines = chk.data.lines;
  const draft = h.status === "DRAFT";
  if (!draft && !h.check_status) return null;
  const diffs = lines.filter((l) => l.checked_qty != null && Number(l.checked_qty) !== Number(l.expected_qty));
  const ticked = lines.filter((l) => l.checked_qty != null).length;
  return (
    <>
      <JobTeamPanel jobType="RECEIPT" jobId={receiptId} warehouseId={h.warehouse_id} editable={draft && h.check_status !== "APPLIED"}
        submitted={h.check_submitted_at ? { at: h.check_submitted_at as string, by: h.check_submitted_by as string | null, note: h.check_note as string | null } : null} />
      {lines.length > 0 && (
        <div className="mb-4 rounded-card border border-line">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-3 py-2">
            <ClipboardCheck className="h-4 w-4 text-ink-muted" /><span className="text-sm font-medium">Receiving check</span>
            <span className="text-xs text-ink-muted">{ticked} / {lines.length} ticked</span>
            {diffs.length > 0 && <Badge tone="warning">{diffs.length} different</Badge>}
            {h.check_status === "APPLIED" && <Badge tone="success">Applied to the receipt</Badge>}
            <div className="flex-1" />
            {draft && h.check_status !== "APPLIED" && ticked === lines.length && can(P.inventoryReceive) && (
              <Button size="sm" variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setConfirm(true)}>Use checked quantities</Button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-8 px-3">Item</th><th className="px-3 text-right">Expected</th><th className="px-3 text-right">Arrived</th><th className="px-3">Note</th><th className="hidden px-3 md:table-cell">Checked by</th>
            </tr></thead>
            <tbody>
              {lines.map((l) => {
                const diff = l.checked_qty != null && Number(l.checked_qty) !== Number(l.expected_qty);
                return (
                  <tr key={l.id} className={cn("border-t border-line/70", diff && "bg-warning-soft/40")}>
                    <td className="px-3 py-1.5"><div className="font-medium">{l.product?.name}{l.variant && <span className="font-normal text-ink-muted"> · {l.variant.name}</span>}</div><div className="text-2xs text-ink-muted">{l.product?.sku}</div></td>
                    <td className="px-3 text-right tabular-nums">{qtyFmt(l.expected_qty)}</td>
                    <td className={cn("px-3 text-right font-medium tabular-nums", diff && "text-warning")}>{l.checked_qty == null ? <span className="text-ink-faint">—</span> : qtyFmt(l.checked_qty)}</td>
                    <td className="px-3 text-xs">{l.note && <span className="inline-flex items-center gap-1 text-warning"><TriangleAlert className="h-3 w-3" />{l.note}</span>}</td>
                    <td className="hidden px-3 text-xs text-ink-muted md:table-cell">{l.checked_by ? `${names.get(l.checked_by) ?? "staff"} · ${formatDateTime(l.checked_at!)}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog open={confirm} title="Use the checked quantities?" confirmLabel="Update receipt" loading={apply.isPending}
        message={`The receipt's quantities are replaced with what staff counted on arrival${diffs.length ? ` (${diffs.length} item${diffs.length > 1 ? "s" : ""} different)` : ""}; items that did not arrive are removed. Then post the receipt to add the stock.`}
        onCancel={() => setConfirm(false)} onConfirm={() => apply.mutate()} />
    </>
  );
}
