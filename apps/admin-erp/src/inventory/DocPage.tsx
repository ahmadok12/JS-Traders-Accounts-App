import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, DataTable, EmptyState, Input, PageHeader, cn } from "@jst/ui";
import { friendlyError, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, humanize } from "@jst/utilities";
import { ADJUSTMENT_REASONS, STATUS_TONE, type InvDocConfig } from "./docConfigs";
import { DocDialog } from "./DocDialog";

type Row = Record<string, unknown> & { id: string };
const PAGE = 25;
const FILTERS = [
  { label: "All", status: undefined },
  { label: "Drafts", status: "DRAFT" },
  { label: "Posted", status: "POSTED" },
  { label: "Reversed", status: "REVERSED" },
  { label: "Cancelled", status: "CANCELLED" },
];

export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const update = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v === null ? p.delete(k) : p.set(k, v);
    setParams(p, { replace: true });
  };
  return { params, update };
}

export function StatusFilter({ items, value, onChange }: { items: { label: string }[]; value: number; onChange: (i: number) => void }) {
  return (
    <div className="flex rounded-control border border-line bg-subtle p-0.5">
      {items.map((f, i) => (
        <button
          key={f.label}
          onClick={() => onChange(i)}
          className={cn("h-[26px] rounded-[6px] px-2.5 text-xs font-medium", i === value ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => v !== value && onChange(v), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="pl-8" aria-label="Search" />
    </div>
  );
}

export function DocPage({ cfg }: { cfg: InvDocConfig }) {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const f = Number(params.get("f") ?? "0") || 0;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";

  const list = useEntityList<Row>({
    table: cfg.table,
    select: cfg.listSelect,
    companyId,
    search: q,
    searchColumns: cfg.searchColumns,
    filters: { status: FILTERS[f].status },
    orderBy: { column: "created_at", ascending: false },
    page,
    pageSize: PAGE,
    enabled: can(P.inventoryView),
  });

  if (!can(P.inventoryView)) {
    return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="You don't have permission to view inventory." /></Card>;
  }

  const whCell = (r: Row, k: string) => { const w = r[k] as { code: string; name: string } | null; return w ? <span><span className="font-mono text-xs text-ink-muted">{w.code}</span> {w.name}</span> : null; };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        icon={cfg.icon}
        actions={can(cfg.perms.create) && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>New {cfg.singular}</Button>}
      />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search document no. / reference…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? (
          <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p>
        ) : (
          <DataTable
            loading={list.isLoading}
            rows={list.data?.rows ?? []}
            onView={(r) => update({ view: r.id, new: null })}
            page={page}
            pageSize={PAGE}
            total={list.data?.total ?? null}
            onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "doc_no", header: "Document", width: "150px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.doc_no)}</span> },
              { key: "date", header: "Date", width: "110px", cell: (r) => <span className="whitespace-nowrap">{formatDate(r.doc_date as string)}</span> },
              ...(cfg.kind === "transfer"
                ? [
                    { key: "from", header: "From", cell: (r: Row) => whCell(r, "from") },
                    { key: "to", header: "To", cell: (r: Row) => whCell(r, "to") },
                  ]
                : [{ key: "wh", header: "Warehouse", cell: (r: Row) => whCell(r, "warehouse") }]),
              ...(cfg.kind === "receipt"
                ? [
                    { key: "sup", header: "Supplier", hideBelow: "md" as const, cell: (r: Row) => (r.supplier as { name: string } | null)?.name ?? <span className="text-ink-faint">—</span> },
                    { key: "ref", header: "Supplier ref.", hideBelow: "lg" as const, cell: (r: Row) => (r.supplier_reference as string) || "" },
                  ]
                : []),
              ...(cfg.kind === "adjustment"
                ? [{ key: "reason", header: "Reason", cell: (r: Row) => ADJUSTMENT_REASONS.find((x) => x.value === r.reason)?.label ?? String(r.reason) }]
                : []),
              ...(cfg.kind !== "receipt" ? [{ key: "ref", header: "Reference", hideBelow: "lg" as const, cell: (r: Row) => (r.reference as string) || "" }] : []),
              { key: "lines", header: "Items", align: "right", width: "70px", cell: (r) => (r.lines as { count: number }[])?.[0]?.count ?? 0 },
              { key: "status", header: "Status", width: "100px", cell: (r) => <Badge tone={STATUS_TONE[String(r.status)]}>{humanize(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={cfg.icon} title={`No ${cfg.title.toLowerCase()} yet`} />}
          />
        )}
      </Card>
      {(viewId || creating) && (
        <DocDialog cfg={cfg} id={viewId} onClose={() => update({ view: null, new: null })} onSaved={(id) => update({ view: id, new: null })} />
      )}
    </div>
  );
}
