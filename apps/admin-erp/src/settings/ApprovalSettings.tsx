import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErpDialog, Field, FormGrid, Input, SectionTitle, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { ROLE_LABELS } from "@jst/permissions";
import { formatNumber } from "@jst/utilities";

interface Rule { id: string; doc_type: string; min_amount: number; approver_roles: string[]; is_active: boolean; notes: string | null }

export const APPROVAL_DOCS: { key: string; label: string; what: string; pct?: boolean }[] = [
  { key: "SALES_ORDER", label: "Sales orders", what: "approve a sales order worth" },
  { key: "PURCHASE_ORDER", label: "Purchase orders", what: "approve a purchase order worth (PKR at the order's rate)" },
  { key: "SUPPLIER_BILL", label: "Supplier bills", what: "post a supplier bill of (PKR)" },
  { key: "PAYMENT_VOUCHER", label: "Payment vouchers", what: "post a payment voucher (Accounting → Vouchers & Journals) of" },
  { key: "SALES_DISCOUNT", label: "Invoice discounts", what: "post a sales invoice with a discount of", pct: true },
];
// warehouse staff never approve money
export const APPROVER_ROLES = ["ADMINISTRATOR", "OWNER", "ACCOUNTANT", "WAREHOUSE_MANAGER", "SALESPERSON"];

export function ApprovalSettings() {
  const { companyId, can } = useAccess();
  const [edit, setEdit] = React.useState<{ doc: string; rule: Rule | null } | null>(null);
  const q = useQuery({
    queryKey: ["approval-rules", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("approval_rules").select("id, doc_type, min_amount, approver_roles, is_active, notes").eq("company_id", companyId!).order("min_amount");
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });
  const canEdit = can("settings.manage");
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Card className="p-4 text-sm text-danger">{friendlyError(q.error)}</Card>;
  return (
    <div className="max-w-4xl space-y-3">
      <Card className="flex gap-3 p-3 text-sm text-ink-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <div>
          Approval limits add a second check on top of permissions: when a document reaches a limit, only the roles you choose can approve or post it.
          The database enforces this — nobody can get round it from any screen. Below every limit, the normal permissions apply.
          The people who can approve are told through the bell (<b>Above approval limit</b> notification).
        </div>
      </Card>
      {APPROVAL_DOCS.map((d) => {
        const rules = (q.data ?? []).filter((r) => r.doc_type === d.key);
        return (
          <Card key={d.key} className="p-4">
            <SectionTitle action={canEdit && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEdit({ doc: d.key, rule: null })}>Add limit</Button>}>{d.label}</SectionTitle>
            {rules.length === 0 ? <p className="text-xs text-ink-muted">No limit — anyone with the normal permission can {d.what.split(" ").slice(0, 1).join(" ")} it.</p> : (
              <div className="space-y-1.5">
                {rules.map((r) => (
                  <button key={r.id} disabled={!canEdit} onClick={() => setEdit({ doc: d.key, rule: r })}
                    className={cn("flex w-full flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2 text-left text-sm", canEdit && "hover:border-line-strong", !r.is_active && "opacity-60")}>
                    <span className="text-ink-muted">From</span>
                    <b className="tabular-nums">{d.pct ? `${formatNumber(r.min_amount, 1)}%` : `PKR ${formatNumber(r.min_amount, 0)}`}</b>
                    <span className="text-ink-muted">only</span>
                    {r.approver_roles.map((x) => <Badge key={x} tone="info">{ROLE_LABELS[x] ?? x}</Badge>)}
                    {!r.is_active && <Badge>Off</Badge>}
                    {r.notes && <span className="truncate text-xs text-ink-faint">· {r.notes}</span>}
                  </button>
                ))}
              </div>
            )}
          </Card>
        );
      })}
      {edit && <RuleDialog doc={edit.doc} rule={edit.rule} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RuleDialog({ doc, rule, onClose }: { doc: string; rule: Rule | null; onClose: () => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const d = APPROVAL_DOCS.find((x) => x.key === doc)!;
  const [amt, setAmt] = React.useState(rule ? String(rule.min_amount) : "");
  const [roles, setRoles] = React.useState<string[]>(rule?.approver_roles ?? ["ADMINISTRATOR", "OWNER"]);
  const [active, setActive] = React.useState(rule?.is_active ?? true);
  const [notes, setNotes] = React.useState(rule?.notes ?? "");
  const [askDel, setAskDel] = React.useState(false);
  const done = () => { qc.invalidateQueries({ queryKey: ["approval-rules", companyId] }); qc.invalidateQueries({ queryKey: ["approval-status"] }); onClose(); };
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(amt);
      if (!Number.isFinite(n) || n <= 0) throw new Error(d.pct ? "Enter a percentage above 0" : "Enter an amount above 0");
      if (d.pct && n > 100) throw new Error("A percentage can't be above 100");
      if (!roles.length) throw new Error("Choose at least one role");
      const row = { company_id: companyId, doc_type: doc, min_amount: n, approver_roles: roles, is_active: active, notes: notes.trim() || null };
      const { error } = rule ? await sb().from("approval_rules").update(row).eq("id", rule.id) : await sb().from("approval_rules").insert(row);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Approval limit saved"); done(); },
    onError: (e) => toast.error(e instanceof Error && !("code" in e) ? e.message : friendlyError(e)),
  });
  const del = useMutation({
    mutationFn: async () => { const { error } = await sb().from("approval_rules").delete().eq("id", rule!.id); if (error) throw error; },
    onSuccess: () => { toast.success("Limit removed"); done(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<ShieldCheck className="h-4 w-4" />} title={`${d.label} — approval limit`}
      footer={<>{rule && <Button variant="destructive-ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setAskDel(true)}>Remove</Button>}
        <div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <p className="mb-3 text-sm text-ink-2">To {d.what} <b>{amt ? (d.pct ? `${amt}%` : `PKR ${formatNumber(Number(amt) || 0, 0)}`) : "…"}</b> or more, the user must have one of these roles:</p>
      <FormGrid cols={2}>
        <Field label={d.pct ? "From discount (%)" : "From amount (PKR)"} required><Input type="number" min={0} step="any" autoFocus value={amt} onChange={(e) => setAmt(e.target.value)} className="tabular-nums" /></Field>
        <Field label="Status"><select className="h-control w-full rounded-control border border-transparent bg-field px-2 text-sm" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}><option value="1">On</option><option value="0">Off</option></select></Field>
      </FormGrid>
      <Field label="Roles that may approve" required>
        <div className="flex flex-wrap gap-1.5">
          {APPROVER_ROLES.map((r) => (
            <button key={r} type="button" onClick={() => setRoles((o) => (o.includes(r) ? o.filter((x) => x !== r) : [...o, r]))}
              className={cn("h-7 rounded-full border px-3 text-xs", roles.includes(r) ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-line-strong")}>{ROLE_LABELS[r] ?? r}</button>
          ))}
        </div>
      </Field>
      <Field label="Note"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this limit (optional)" /></Field>
      <p className="text-xs text-ink-muted">With several limits, the highest one the document reaches applies — e.g. from PKR 500,000 Owner or Administrator, from PKR 2,000,000 Owner only.</p>
      <ConfirmDialog open={askDel} title="Remove this limit?" message="Documents of this size will only need the normal permission." tone="destructive" confirmLabel="Remove"
        loading={del.isPending} onCancel={() => setAskDel(false)} onConfirm={() => del.mutate()} />
    </ErpDialog>
  );
}
