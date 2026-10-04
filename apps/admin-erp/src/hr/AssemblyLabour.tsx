import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { Button, ConfirmDialog, Field, Input, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDateTime } from "@jst/utilities";
import { num } from "../accounting/common";
import { qtyFmt } from "../sales/common";
import { EmployeePicker, StatusPill, rpc, useEmployeeNames, useHrAction } from "./common";

interface Asg { id: string; employee_id: string; assigned_qty: number; completed_qty: number; rejected_qty: number; approved_qty: number | null; status: string; approved_at: string | null; exception_note: string | null }
interface Edit { employee_id: string | null; assigned: string; completed: string; rejected: string }

/**
 * Labour on an assembly order: who built how many. A supervisor approves the payable quantity after posting;
 * the approved quantity × the item's labour rate becomes that employee's earning in payroll. No money is shown here.
 */
export function AssemblyLabourPanel({ orderId, status, quantity }: { orderId: string; status: string; quantity: number }) {
  const { can } = useAccess();
  const names = useEmployeeNames();
  const q = useQuery({
    queryKey: ["hr", "asm-labour", orderId],
    queryFn: async () => {
      const { data, error } = await sb().from("employee_assembly_assignments").select("id, employee_id, assigned_qty, completed_qty, rejected_qty, approved_qty, status, approved_at, exception_note")
        .eq("assembly_order_id", orderId).neq("status", "CANCELLED").order("created_at");
      if (error) throw error;
      return (data ?? []) as Asg[];
    },
  });
  const rows = q.data ?? [];
  const approved = rows.filter((r) => r.status === "APPROVED");
  const open = rows.filter((r) => r.status === "ASSIGNED");
  const editable = can(P.labourSupervise) && !["CANCELLED", "REVERSED"].includes(status);
  const [edit, setEdit] = React.useState<Edit[]>([]);
  const [appr, setAppr] = React.useState<Record<string, string>>({});
  const [ask, setAsk] = React.useState(false);
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    setEdit(open.map((r) => ({ employee_id: r.employee_id, assigned: String(Number(r.assigned_qty)), completed: String(Number(r.completed_qty)), rejected: String(Number(r.rejected_qty)) })));
    setAppr(Object.fromEntries(open.map((r) => [r.id, String(Math.max(Number(r.completed_qty) - Number(r.rejected_qty), 0))])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const save = useHrAction(() => rpc("save_assembly_labour", { p_order_id: orderId,
    p_rows: edit.filter((e) => e.employee_id).map((e) => ({ employee_id: e.employee_id, assigned_qty: num(e.assigned) || 0, completed_qty: num(e.completed) || 0, rejected_qty: num(e.rejected) || 0 })) }), "Labour saved");
  const approve = useHrAction(() => rpc("approve_assembly_labour", { p_order_id: orderId, p_rows: open.map((r) => ({ id: r.id, approved_qty: appr[r.id] })), p_exception_note: note || null }),
    "Approved — added to their pay for the month", () => { setAsk(false); setNote(""); });
  const reopen = useHrAction((id: string) => rpc("reopen_assembly_labour", { p_assignment_id: id }), "Reopened");
  const approvedTotal = approved.reduce((s, r) => s + Number(r.approved_qty ?? 0), 0);
  const pendingTotal = open.reduce((s, r) => s + (num(appr[r.id] ?? "0") || 0), 0);
  const over = approvedTotal + pendingTotal > quantity;
  const dirty = JSON.stringify(edit) !== JSON.stringify(open.map((r) => ({ employee_id: r.employee_id, assigned: String(Number(r.assigned_qty)), completed: String(Number(r.completed_qty)), rejected: String(Number(r.rejected_qty)) })));
  const th = "h-8 px-3 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted";
  const td = "border-t border-line/70 px-3 py-1.5";

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">Who assembled these {qtyFmt(quantity)} item(s)? Their fixed salary is unchanged — approved quantities are paid on top at the item's labour rate.
        {status !== "POSTED" && " Approval is possible once the order is posted."}</p>
      {approved.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-subtle"><tr><th className={th}>Employee</th><th className={cn(th, "text-right")}>Completed</th><th className={cn(th, "text-right")}>Rejected</th><th className={cn(th, "text-right")}>Approved</th><th className={th}>Approved on</th><th className={th} /></tr></thead>
            <tbody>{approved.map((r) => (
              <tr key={r.id}><td className={cn(td, "font-medium")}>{names.data?.get(r.employee_id)}</td><td className={cn(td, "text-right tabular-nums")}>{qtyFmt(r.completed_qty)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{qtyFmt(r.rejected_qty)}</td><td className={cn(td, "text-right font-semibold tabular-nums")}>{qtyFmt(r.approved_qty)}</td>
                <td className={cn(td, "text-xs text-ink-muted")}>{r.approved_at ? formatDateTime(r.approved_at) : ""}{r.exception_note && <div className="text-warning">Exception: {r.exception_note}</div>}</td>
                <td className={cn(td, "text-right")}><StatusPill s="APPROVED" />{editable && <Button size="icon-sm" variant="ghost" title="Reopen" onClick={() => reopen.mutate(r.id)}><Undo2 className="h-3.5 w-3.5" /></Button>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {(editable || open.length > 0) && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-subtle"><tr><th className={th}>Employee</th><th className={cn(th, "w-28 text-right")}>Assigned</th><th className={cn(th, "w-28 text-right")}>Completed</th><th className={cn(th, "w-28 text-right")}>Rejected</th>
              {status === "POSTED" && open.length > 0 && <th className={cn(th, "w-32 text-right")}>Approve qty</th>}<th className={cn(th, "w-10")} /></tr></thead>
            <tbody>
              {edit.map((e, i) => {
                const row = open.find((r) => r.employee_id === e.employee_id);
                return (
                  <tr key={i}>
                    <td className={td}>{editable ? <EmployeePicker value={e.employee_id} onChange={(v) => setEdit((s) => s.map((x, j) => (j === i ? { ...x, employee_id: v } : x)))} /> : names.data?.get(e.employee_id ?? "")}</td>
                    {(["assigned", "completed", "rejected"] as const).map((k) => (
                      <td key={k} className={td}><Input className="h-control-sm text-right tabular-nums" inputMode="decimal" disabled={!editable} value={e[k]} onChange={(ev) => setEdit((s) => s.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)))} /></td>
                    ))}
                    {status === "POSTED" && open.length > 0 && <td className={td}>{row && <Input className="h-control-sm text-right font-semibold tabular-nums" inputMode="decimal" disabled={!editable} value={appr[row.id] ?? ""} onChange={(ev) => setAppr((s) => ({ ...s, [row.id]: ev.target.value }))} />}</td>}
                    <td className={td}>{editable && <Button size="icon-sm" variant="destructive-ghost" onClick={() => setEdit((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
                  </tr>
                );
              })}
              {edit.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-sm text-ink-muted">No one assigned yet.</td></tr>}
            </tbody>
          </table>
          {editable && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEdit((s) => [...s, { employee_id: null, assigned: "", completed: "", rejected: "0" }])}>Add employee</Button>
              <div className="flex-1" />
              {over && status === "POSTED" && open.length > 0 && <span className="text-xs text-warning">Approving {qtyFmt(approvedTotal + pendingTotal)} — more than the {qtyFmt(quantity)} made</span>}
              <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
              {status === "POSTED" && open.length > 0 && <Button size="sm" variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={dirty} title={dirty ? "Save first" : undefined} onClick={() => setAsk(true)}>Approve quantities</Button>}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={ask} title="Approve assembly labour?" confirmLabel="Approve" loading={approve.isPending} onCancel={() => setAsk(false)} onConfirm={() => approve.mutate(undefined)}
        message="Each employee's approved quantity is paid at the item's labour rate with this month's payroll. The same work cannot be paid twice.">
        {over && <Field label="Exception note (more approved than made)" required className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. rework of last month's units" /></Field>}
      </ConfirmDialog>
    </div>
  );
}
