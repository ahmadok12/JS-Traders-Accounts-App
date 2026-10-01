import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Badge, Card, DataTable, ErpDialog, PageHeader, SearchableSelect } from "@jst/ui";
import { friendlyError, sb, useAccess, useProfileNames } from "@jst/data-access";
import { formatDateTime, humanize } from "@jst/utilities";

const PAGE = 50;
const ENTITY_OPTIONS = [
  "customers", "customer_groups", "suppliers", "products", "product_variants", "warehouses", "warehouse_locations",
  "chart_of_accounts", "bank_accounts", "payment_agents", "employees", "user_roles", "profiles", "companies", "branches",
  "numbering_sequences", "user_warehouse_access",
].map((v) => ({ value: v, label: humanize(v) }));

interface AuditRow {
  id: string;
  raw_id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  changed_fields: string[] | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

/** Company audit log — keyset-paginated (append-only, potentially very large). */
export function AuditPage() {
  const { companyId } = useAccess();
  const [entity, setEntity] = React.useState<string | null>(null);
  const [cursors, setCursors] = React.useState<number[]>([]); // stack of "before id" cursors
  const [open, setOpen] = React.useState<AuditRow | null>(null);
  const before = cursors[cursors.length - 1];

  const q = useQuery({
    queryKey: ["audit-log", companyId, entity, before],
    enabled: !!companyId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let qq = sb()
        .from("audit_logs")
        .select("id, action, entity_type, entity_id, user_id, changed_fields, old_value, new_value, created_at")
        .eq("company_id", companyId!)
        .order("id", { ascending: false })
        .limit(PAGE + 1);
      if (entity) qq = qq.eq("entity_type", entity);
      if (before) qq = qq.lt("id", before);
      const { data, error } = await qq;
      if (error) throw error;
      const rows = (data ?? []).map((r) => ({ ...r, raw_id: r.id as number, id: String(r.id) })) as AuditRow[];
      return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
    },
  });
  const names = useProfileNames((q.data?.rows ?? []).map((r) => r.user_id));

  return (
    <div>
      <PageHeader title="Audit Log" icon={<History className="h-4 w-4" />} description="Every change to master data, security and configuration. Read-only." />
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <div className="w-64">
            <SearchableSelect value={entity} onChange={(v) => { setEntity(v); setCursors([]); }} options={ENTITY_OPTIONS} placeholder="All record types" />
          </div>
        </div>
        {q.error ? (
          <p className="p-4 text-sm text-danger">{friendlyError(q.error)}</p>
        ) : (
          <DataTable
            loading={q.isLoading}
            rows={q.data?.rows ?? []}
            onView={setOpen}
            columns={[
              { key: "t", header: "When", width: "170px", cell: (r) => <span className="tabular-nums text-ink-2">{formatDateTime(r.created_at)}</span> },
              { key: "u", header: "User", cell: (r) => (r.user_id ? names.data?.[r.user_id] ?? "…" : <span className="text-ink-faint">System</span>) },
              { key: "a", header: "Action", width: "90px", cell: (r) => <Badge tone={r.action === "INSERT" ? "success" : r.action === "DELETE" ? "danger" : "info"}>{r.action === "INSERT" ? "Created" : r.action === "UPDATE" ? "Updated" : "Deleted"}</Badge> },
              { key: "e", header: "Record", cell: (r) => <span>{humanize(r.entity_type)} <span className="text-ink-faint">· {String((r.new_value ?? r.old_value)?.name ?? (r.new_value ?? r.old_value)?.code ?? "")}</span></span> },
              { key: "f", header: "Changed", hideBelow: "md", cell: (r) => <span className="text-xs text-ink-muted">{(r.changed_fields ?? []).filter((f) => !f.startsWith("updated")).map(humanize).join(", ")}</span> },
            ]}
          />
        )}
        <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
          <button className="text-xs text-ink-muted disabled:opacity-40" disabled={!cursors.length} onClick={() => setCursors((c) => c.slice(0, -1))}>
            ← Newer
          </button>
          <button
            className="text-xs text-ink-muted disabled:opacity-40"
            disabled={!q.data?.hasMore}
            onClick={() => setCursors((c) => [...c, q.data!.rows[q.data!.rows.length - 1].raw_id])}
          >
            Older →
          </button>
        </div>
      </Card>
      {open && (
        <ErpDialog open onRequestClose={() => setOpen(null)} title={`${humanize(open.entity_type)} · ${open.action}`} subtitle={formatDateTime(open.created_at)} size="lg">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-2xs font-semibold uppercase text-ink-faint">Before</div>
              <pre className="max-h-[50vh] overflow-auto rounded-control bg-subtle p-2 text-2xs">{JSON.stringify(open.old_value, null, 2) ?? "—"}</pre>
            </div>
            <div>
              <div className="mb-1 text-2xs font-semibold uppercase text-ink-faint">After</div>
              <pre className="max-h-[50vh] overflow-auto rounded-control bg-subtle p-2 text-2xs">{JSON.stringify(open.new_value, null, 2) ?? "—"}</pre>
            </div>
          </div>
        </ErpDialog>
      )}
    </div>
  );
}
