import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, UserX, UserCheck } from "lucide-react";
import {
  ActiveBadge,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  ErpDialog,
  KeyValue,
  PageHeader,
  SectionTitle,
  Skeleton,
} from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P, ROLE_LABELS } from "@jst/permissions";

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  roles: string[];
}

function useCompanyUsers(companyId: string | null) {
  return useQuery({
    queryKey: ["company-users", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb()
        .from("user_roles")
        .select("user_id, role:roles(code), profile:profiles(id, email, full_name, is_active)")
        .eq("company_id", companyId!)
        .limit(500);
      if (error) throw error;
      const map = new Map<string, UserRow>();
      for (const r of (data ?? []) as unknown as { user_id: string; role: { code: string }; profile: Omit<UserRow, "roles"> }[]) {
        const u = map.get(r.user_id) ?? { ...r.profile, roles: [] };
        u.roles.push(r.role.code);
        map.set(r.user_id, u);
      }
      return Array.from(map.values()).sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
    },
  });
}

export function UsersPage() {
  const { companyId, can } = useAccess();
  const users = useCompanyUsers(companyId);
  const canManage = can(P.securityManage);
  const pending = useQuery({
    queryKey: ["unassigned-users"],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await sb().rpc("list_unassigned_users");
      if (error) throw error;
      return (data ?? []) as { id: string; email: string; full_name: string | null; created_at: string }[];
    },
  });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const all: UserRow[] = [
    ...(users.data ?? []),
    ...(pending.data ?? []).map((p) => ({ id: p.id, email: p.email, full_name: p.full_name, is_active: true, roles: [] })),
  ];
  const selected = all.find((u) => u.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Users & Access"
        icon={<ShieldCheck className="h-4 w-4" />}
        description="Roles grant permissions; warehouse scope limits which stock a user sees. Enforced by database row-level security."
      />
      {canManage && (pending.data?.length ?? 0) > 0 && (
        <Card className="mb-3 border-warning-line bg-warning-soft/40 p-3">
          <div className="flex items-center gap-2 text-sm text-ink">
            <UserPlus className="h-4 w-4 text-warning" />
            <span className="font-medium">{pending.data!.length} user(s) waiting for a role.</span>
            <span className="text-ink-muted">Open them below and assign access.</span>
          </div>
        </Card>
      )}
      <Card className="overflow-hidden">
        <DataTable
          loading={users.isLoading}
          rows={all}
          onView={(u) => setOpenId(u.id)}
          columns={[
            { key: "name", header: "User", cell: (u) => <div><div className="font-medium">{u.full_name || "—"}</div><div className="text-2xs text-ink-muted">{u.email}</div></div> },
            { key: "roles", header: "Roles", cell: (u) => u.roles.length ? <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{ROLE_LABELS[r] ?? r}</Badge>)}</div> : <Badge tone="warning">No role</Badge> },
            { key: "st", header: "Status", width: "90px", cell: (u) => <ActiveBadge active={u.is_active} /> },
          ]}
        />
      </Card>
      <p className="mt-2 text-2xs text-ink-faint">
        New logins are created in Supabase Auth (Dashboard → Authentication → Add user / Invite). They appear here to receive roles.
      </p>
      {selected && <UserDialog user={selected} onClose={() => setOpenId(null)} canManage={canManage} />}
    </div>
  );
}

function UserDialog({ user, onClose, canManage }: { user: UserRow; onClose: () => void; canManage: boolean }) {
  const { companyId, session } = useAccess();
  const qc = useQueryClient();
  const [confirmActive, setConfirmActive] = React.useState(false);
  const isSelf = session?.user.id === user.id;

  const roles = useQuery({
    queryKey: ["roles"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("roles").select("id, code, name, description").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const warehouses = useQuery({
    queryKey: ["user-wh", user.id, companyId],
    queryFn: async () => {
      const [wh, acc] = await Promise.all([
        sb().from("warehouses").select("id, code, name").eq("company_id", companyId!).eq("is_active", true).order("code").limit(200),
        sb().from("user_warehouse_access").select("id, warehouse_id").eq("user_id", user.id),
      ]);
      if (wh.error) throw wh.error;
      if (acc.error) throw acc.error;
      return { list: wh.data ?? [], granted: new Map((acc.data ?? []).map((a) => [a.warehouse_id, a.id])) };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["company-users"] });
    qc.invalidateQueries({ queryKey: ["unassigned-users"] });
    qc.invalidateQueries({ queryKey: ["user-wh", user.id] });
    qc.invalidateQueries({ queryKey: ["my_access"] });
  };

  const toggleRole = useMutation({
    mutationFn: async ({ code, on }: { code: string; on: boolean }) => {
      const { error } = await sb().rpc(on ? "assign_role" : "revoke_role", { p_user_id: user.id, p_role_code: code, p_company_id: companyId });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.on ? `${ROLE_LABELS[v.code]} granted` : `${ROLE_LABELS[v.code]} removed`);
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const toggleWh = useMutation({
    mutationFn: async ({ warehouseId, grantId }: { warehouseId: string; grantId?: string }) => {
      const r = grantId
        ? await sb().from("user_warehouse_access").delete().eq("id", grantId)
        : await sb().from("user_warehouse_access").insert({ user_id: user.id, warehouse_id: warehouseId, company_id: companyId });
      if (r.error) throw r.error;
    },
    onSuccess: refresh,
    onError: (e) => toast.error(friendlyError(e)),
  });

  const setActive = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("set_user_active", { p_user_id: user.id, p_active: !user.is_active });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(user.is_active ? "User deactivated" : "User reactivated");
      setConfirmActive(false);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const busy = toggleRole.isPending || toggleWh.isPending;

  return (
    <>
      <ErpDialog
        open
        onRequestClose={onClose}
        title={user.full_name || user.email || "User"}
        subtitle={user.email}
        icon={<ShieldCheck className="h-4 w-4" />}
        status={<ActiveBadge active={user.is_active} />}
        size="lg"
        footer={
          <>
            {canManage && !isSelf && (
              <Button
                variant={user.is_active ? "destructive-ghost" : "ghost"}
                icon={user.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                onClick={() => setConfirmActive(true)}
              >
                {user.is_active ? "Deactivate user" : "Reactivate user"}
              </Button>
            )}
            <div className="flex-1" />
            <Button onClick={onClose}>Close</Button>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <SectionTitle>Roles in this company</SectionTitle>
            {roles.isLoading ? (
              <Skeleton className="h-40" />
            ) : (
              <div className="space-y-2.5">
                {roles.data!.map((r) => (
                  <Checkbox
                    key={r.id}
                    checked={user.roles.includes(r.code)}
                    disabled={!canManage || busy}
                    onChange={(on) => toggleRole.mutate({ code: r.code, on })}
                    label={r.name}
                    description={r.description}
                  />
                ))}
              </div>
            )}
          </div>
          <div>
            <SectionTitle>Warehouse access</SectionTitle>
            <p className="mb-2 text-xs text-ink-muted">Needed for warehouse roles. Administrators, owners and accountants see all warehouses.</p>
            {warehouses.isLoading ? (
              <Skeleton className="h-24" />
            ) : warehouses.data!.list.length === 0 ? (
              <p className="text-xs text-ink-faint">No warehouses yet.</p>
            ) : (
              <div className="space-y-2">
                {warehouses.data!.list.map((w) => {
                  const grantId = warehouses.data!.granted.get(w.id);
                  return (
                    <Checkbox
                      key={w.id}
                      checked={!!grantId}
                      disabled={!canManage || busy}
                      onChange={() => toggleWh.mutate({ warehouseId: w.id, grantId })}
                      label={`${w.code} · ${w.name}`}
                    />
                  );
                })}
              </div>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <KeyValue label="User ID">
                <span className="font-mono text-2xs">{user.id.slice(0, 8)}…</span>
              </KeyValue>
            </dl>
          </div>
        </div>
      </ErpDialog>
      <ConfirmDialog
        open={confirmActive}
        title={user.is_active ? "Deactivate this user?" : "Reactivate this user?"}
        message={user.is_active ? "They will immediately lose access to all ERP data. Their history is kept." : "They will regain the access given by their roles."}
        tone={user.is_active ? "destructive" : "default"}
        confirmLabel={user.is_active ? "Deactivate" : "Reactivate"}
        loading={setActive.isPending}
        onCancel={() => setConfirmActive(false)}
        onConfirm={() => setActive.mutate()}
      />
    </>
  );
}
