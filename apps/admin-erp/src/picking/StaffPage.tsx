import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, KeyRound, Plus, ShieldAlert, Smartphone, UserPlus, Users } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErpDialog, Field, FormGrid, Input, PageHeader, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDateTime } from "@jst/utilities";
import { useWarehouses, type Wh } from "../sales/common";
import { loginLabel, usePickingStaff, type StaffRow } from "./common";
import { usePickingRealtime } from "./realtime";

const icon = <Users className="h-4 w-4" />;

async function callStaffFn(body: Record<string, unknown>) {
  const { data, error } = await sb().functions.invoke("warehouse-staff", { body });
  if (error) {
    // the function returns { error } with a readable message
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as Record<string, unknown>;
}

/** Warehouse staff: who works where. Add staff, move them between warehouses, reset passwords. */
export function StaffPage() {
  const { can } = useAccess();
  const staff = usePickingStaff();
  const whs = useWarehouses();
  usePickingRealtime(can(P.pickingManage));
  const [adding, setAdding] = React.useState(false);
  const [moving, setMoving] = React.useState<StaffRow | null>(null);
  const [pwd, setPwd] = React.useState<StaffRow | null>(null);
  if (!can(P.pickingManage)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const wmap = new Map((whs.data ?? []).map((w) => [w.id, w]));
  const rows = (staff.data ?? []).filter((s) => s.is_staff);
  const byWh = (whs.data ?? []).map((w) => ({ w, people: rows.filter((r) => r.warehouse_ids.includes(w.id)) }));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Warehouse Staff" icon={icon}
        description="Pickers belong to one or more warehouses. Only staff of a warehouse can be given its picking work. Moving someone takes their open tasks in the old warehouse off them."
        actions={<Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add staff</Button>} />
      {staff.isLoading ? <Skeleton className="h-40" /> : staff.error ? <p className="text-sm text-danger">{friendlyError(staff.error)}</p> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {byWh.map(({ w, people }) => (
            <Card key={w.id} className="p-3">
              <div className="mb-2 flex items-center gap-2"><span className="font-mono text-sm font-semibold">{w.code}</span><span className="text-sm text-ink-muted">{w.name}</span><Badge>{people.length} staff</Badge></div>
              {people.length === 0 ? <p className="text-xs text-ink-faint">Nobody works here yet.</p> : (
                <ul className="divide-y divide-line">
                  {people.map((p) => (
                    <li key={p.user_id} className="flex flex-wrap items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-sm font-medium", !p.is_active && "text-ink-faint line-through")}>{p.full_name}</div>
                        <div className="text-2xs text-ink-muted">login: <span className="font-mono">{loginLabel(p.email)}</span>{p.phone && <> · {p.phone}</>}
                          {p.warehouse_ids.length > 1 && <> · also {p.warehouse_ids.filter((x) => x !== w.id).map((x) => wmap.get(x)?.code).join(", ")}</>}
                          {p.last_ack_at && <> · last seen a task {formatDateTime(p.last_ack_at)}</>}</div>
                      </div>
                      {p.open_tasks > 0 && <Badge tone="info">{p.open_tasks} open</Badge>}
                      <Button size="sm" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setMoving(p)}>Warehouses</Button>
                      <Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setPwd(p)}>Password</Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          {rows.filter((r) => r.warehouse_ids.length === 0).length > 0 && (
            <Card className="p-3">
              <div className="mb-2 text-sm font-semibold text-warning">Not in any warehouse</div>
              {rows.filter((r) => r.warehouse_ids.length === 0).map((p) => (
                <div key={p.user_id} className="flex items-center gap-2 py-1.5"><span className="flex-1 text-sm">{p.full_name}</span><Button size="sm" onClick={() => setMoving(p)}>Assign warehouse</Button></div>
              ))}
            </Card>
          )}
        </div>
      )}
      <Card className="mt-3 flex items-start gap-3 p-3 text-sm text-ink-muted">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Staff open <b className="font-mono text-ink">{window.location.origin}/m</b> on their phone, sign in with their login name and password, tap <b>Start duty</b>, and add it to the home screen. Keep volume up and the app open while working.</span>
      </Card>
      {adding && <AddStaffDialog whs={whs.data ?? []} onClose={() => setAdding(false)} />}
      {moving && <MoveDialog person={moving} whs={whs.data ?? []} onClose={() => setMoving(null)} />}
      {pwd && <PasswordDialog person={pwd} onClose={() => setPwd(null)} />}
    </div>
  );
}

function WhPicker({ whs, value, onChange }: { whs: Wh[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {whs.map((w) => {
        const on = value.includes(w.id);
        return (
          <button key={w.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== w.id) : [...value, w.id])}
            className={cn("rounded-control border px-3 py-1.5 text-sm", on ? "border-primary bg-primary text-primary-fg" : "border-line hover:border-ink-faint")}>
            <span className="font-mono">{w.code}</span> · {w.name}
          </button>
        );
      })}
    </div>
  );
}

function AddStaffDialog({ whs, onClose }: { whs: Wh[]; onClose: () => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [login, setLogin] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [wh, setWh] = React.useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => callStaffFn({ action: "create", company_id: companyId, full_name: name, login, phone, password, warehouse_ids: wh }),
    onSuccess: (d) => { toast.success(`${name} added — login: ${loginLabel(String(d.login))}`); qc.invalidateQueries({ queryKey: ["picking-staff"] }); onClose(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<Plus className="h-4 w-4" />} title="Add warehouse staff"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !login.trim() || password.length < 6 || !wh.length} onClick={() => save.mutate()}>Add staff</Button></>}>
      <FormGrid cols={2}>
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ali Raza" autoFocus /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" /></Field>
        <Field label="Login name" required hint="Letters/numbers, e.g. ali — or an email address"><Input value={login} onChange={(e) => setLogin(e.target.value.replace(/\s/g, ""))} autoCapitalize="none" /></Field>
        <Field label="Password" required hint="At least 6 characters"><Input value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </FormGrid>
      <Field label="Works in" required className="mt-1"><WhPicker whs={whs} value={wh} onChange={setWh} /></Field>
    </ErpDialog>
  );
}

function MoveDialog({ person, whs, onClose }: { person: StaffRow; whs: Wh[]; onClose: () => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [wh, setWh] = React.useState<string[]>(person.warehouse_ids);
  const [note, setNote] = React.useState("");
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("set_staff_warehouses", { p_company_id: companyId, p_user: person.user_id, p_warehouse_ids: wh, p_note: note || null });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (released) => {
      toast.success(released ? `Saved — ${released} open task(s) in the old warehouse were taken off ${person.full_name}; reassign them in Picking` : "Saved");
      qc.invalidateQueries(); onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const leaving = person.warehouse_ids.filter((x) => !wh.includes(x));
  return (
    <ErpDialog open onRequestClose={onClose} size="sm" icon={<ArrowRightLeft className="h-4 w-4" />} title={`${person.full_name} works in…`}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!wh.length} onClick={() => save.mutate()}>Save</Button></>}>
      <p className="mb-3 text-sm text-ink-muted">Tap to add or remove warehouses. To shift someone, select the new warehouse and unselect the old one.</p>
      <WhPicker whs={whs} value={wh} onChange={setWh} />
      {leaving.length > 0 && person.open_tasks > 0 && <p className="mt-3 text-xs text-warning">Open tasks in the warehouse(s) they leave will be taken off them.</p>}
      <Field label="Note" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. shifted for the week" /></Field>
    </ErpDialog>
  );
}

function PasswordDialog({ person, onClose }: { person: StaffRow; onClose: () => void }) {
  const { companyId } = useAccess();
  const [password, setPassword] = React.useState("");
  const save = useMutation({
    mutationFn: () => callStaffFn({ action: "reset_password", company_id: companyId, user_id: person.user_id, password }),
    onSuccess: () => { toast.success("Password changed"); onClose(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog open onRequestClose={onClose} size="sm" icon={<KeyRound className="h-4 w-4" />} title={`New password for ${person.full_name}`}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={password.length < 6} onClick={() => save.mutate()}>Save</Button></>}>
      <Field label="Password" hint="At least 6 characters"><Input value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
    </ErpDialog>
  );
}
