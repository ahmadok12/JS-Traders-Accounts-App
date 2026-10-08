import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Filter, Plus, PowerOff, Search, ShieldAlert, X } from "lucide-react";
import { Button, Card, DataTable, EmptyState, Input, PageHeader, cn } from "@jst/ui";
import { friendlyError, useAccess, useEntityList } from "@jst/data-access";
import { EntityDialog } from "./EntityDialog";
import type { EntityConfig } from "./types";
import { useFeatures, useStorageLocations } from "../lib/settings";
import { decodeCfFilter, encodeCfFilter, filterOps, formatCf, isCfEntity, useCfDefs, useCfFilterIds, useCfValues, type CfDef, type CfFilter } from "../lib/customFields";

const PAGE_SIZE = 25;

/**
 * Standard View-first list screen (spec §5.5.5):
 * [Search / Filters]  [Create]  →  rows with View  →  View dialog (Edit inside, destructive separated)
 * List state (search, filter, page, open record) lives in the URL so it is
 * preserved on refresh / back navigation.
 */
export function EntityPage({ config }: { config: EntityConfig }) {
  const { can, companyId } = useAccess();
  const locOn = useStorageLocations().enabled;
  const features = useFeatures();
  const hiddenCols = locOn ? [] : config.storageLocationParts?.columns ?? [];
  const columns = React.useMemo(() => config.columns.filter((c) => !hiddenCols.includes(c.key)), [config.columns, hiddenCols.join()]);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const filterIdx = Number(params.get("f") ?? "0") || 0;
  const viewId = params.get("view");
  const creating = params.get("new") === "1";

  const [searchInput, setSearchInput] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== q) update({ q: searchInput || null, page: null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v === null ? p.delete(k) : p.set(k, v);
    setParams(p, { replace: true });
  }

  const quick = config.quickFilters ?? (config.activeField
    ? [
        { label: "Active", filters: { [config.activeField]: true } },
        { label: "Inactive", filters: { [config.activeField]: false } },
        { label: "All", filters: {} },
      ]
    : []);

  const viewPerms = Array.isArray(config.perms.view) ? config.perms.view : [config.perms.view];
  const canView = viewPerms.some((p) => can(p));
  const canManage = can(config.perms.manage);

  // custom fields: list columns + one filter (kept in the URL as ?cf=field~op~value)
  const cfOn = isCfEntity(config.table);
  const cfDefs = useCfDefs(cfOn ? config.table : null).data ?? [];
  const cfFilter = decodeCfFilter(params.get("cf"));
  const cfFilterDef = cfDefs.find((d) => d.id === cfFilter?.field);
  const cfIds = useCfFilterIds(config.table, cfFilterDef ? cfFilter : null, cfFilterDef);

  const list = useEntityList<Record<string, unknown> & { id: string }>({
    table: config.table,
    select: config.listSelect,
    companyId,
    search: q,
    searchColumns: config.searchColumns,
    filters: quick[filterIdx]?.filters,
    orderBy: config.orderBy,
    page,
    pageSize: PAGE_SIZE,
    enabled: canView && (!cfFilterDef || cfIds.isSuccess),
    idIn: cfFilterDef ? cfIds.data?.ids ?? [] : null,
  });
  const listCfDefs = cfDefs.filter((d) => d.show_in_list);
  const pageIds = (list.data?.rows ?? []).map((r) => r.id);
  const cfVals = useCfValues(config.table, pageIds, listCfDefs.length > 0);
  const allColumns = React.useMemo(() => {
    if (!listCfDefs.length) return columns;
    const by = new Map((cfVals.data ?? []).map((v) => [`${v.field_id}:${v.record_id}`, v]));
    return [...columns, ...listCfDefs.map((d) => ({
      key: `cf_${d.id}`, header: d.label, hideBelow: "md" as const,
      align: ["number", "decimal", "currency", "percentage"].includes(d.field_type) ? ("right" as const) : undefined,
      cell: (r: Record<string, unknown> & { id: string }) => <span className="text-xs">{formatCf(d, by.get(`${d.id}:${r.id}`))}</span>,
    }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, listCfDefs.map((d) => d.id).join(), cfVals.data]);

  if (config.feature && !features.loading && !features.isOn(config.feature)) {
    return (
      <Card>
        <EmptyState icon={<PowerOff className="h-6 w-6" />} title={`${config.title} is turned off`} description="An administrator can turn it on in Settings → Features." />
      </Card>
    );
  }

  if (!canView) {
    return (
      <Card>
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description={`You don't have permission to view ${config.title.toLowerCase()}.`} />
      </Card>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={config.title}
        description={config.description}
        icon={config.icon}
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => update({ new: "1", view: null })}>
              New {config.singular}
            </Button>
          )
        }
      />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={`Search ${config.title.toLowerCase()}…`}
              className="pl-8"
              aria-label="Search"
            />
          </div>
          {quick.length > 0 && (
            <div className="flex rounded-control border border-line bg-subtle p-0.5">
              {quick.map((f, i) => (
                <button
                  key={f.label}
                  onClick={() => update({ f: i === 0 ? null : String(i), page: null })}
                  className={cn(
                    "h-[26px] rounded-[6px] px-2.5 text-xs font-medium",
                    i === filterIdx ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {cfDefs.length > 0 && (
            <CfFilterBar defs={cfDefs} value={cfFilter} onChange={(f) => update({ cf: f ? encodeCfFilter(f) : null, page: null })} capped={!!cfIds.data?.capped} />
          )}
          {list.isFetching && !list.isLoading && <span className="text-2xs text-ink-faint">Refreshing…</span>}
        </div>
        {list.error ? (
          <div className="p-4 text-sm text-danger">{friendlyError(list.error)}</div>
        ) : (
          <DataTable
            columns={allColumns}
            rows={list.data?.rows ?? []}
            loading={list.isLoading}
            onView={(r) => update({ view: r.id, new: null })}
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data?.total ?? null}
            onPageChange={(p) => update({ page: String(p) })}
            empty={
              <EmptyState
                icon={config.icon}
                title={q || cfFilterDef ? "No matches" : `No ${config.title.toLowerCase()} yet`}
                description={q || cfFilterDef ? "Try a different search or filter." : canManage ? `Create the first ${config.singular.toLowerCase()} to get started.` : undefined}
              />
            }
          />
        )}
      </Card>
      {(viewId || creating) && (
        <EntityDialog
          config={config}
          id={viewId}
          open
          onClose={() => update({ view: null, new: null })}
          onCreated={(id) => update({ view: id, new: null })}
        />
      )}
    </div>
  );
}

const selCls = "h-control rounded-control border border-line bg-surface px-2 text-xs";

/** One-condition filter on a custom field. */
function CfFilterBar({ defs, value, onChange, capped }: { defs: CfDef[]; value: CfFilter | null; onChange: (f: CfFilter | null) => void; capped: boolean }) {
  const [draft, setDraft] = React.useState<CfFilter | null>(value);
  React.useEffect(() => setDraft(value), [value?.field, value?.op, value?.value]);
  const def = defs.find((d) => d.id === draft?.field);
  if (!draft) {
    return (
      <button onClick={() => setDraft({ field: defs[0].id, op: filterOps(defs[0].field_type)[0].value, value: "" })}
        className="inline-flex h-control items-center gap-1.5 rounded-control border border-dashed border-line px-2.5 text-xs text-ink-muted hover:border-line-strong hover:text-ink">
        <Filter className="h-3.5 w-3.5" /> Filter by field
      </button>
    );
  }
  const ops = def ? filterOps(def.field_type) : [];
  const needsValue = !["empty", "yes", "no"].includes(draft.op);
  const apply = (f: CfFilter) => (needsValue && !f.value.trim() && !["empty", "yes", "no"].includes(f.op) ? undefined : onChange(f));
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-control border border-line bg-subtle p-0.5">
      <Filter className="ml-1.5 h-3.5 w-3.5 text-ink-faint" />
      <select className={selCls} value={draft.field} onChange={(e) => { const d = defs.find((x) => x.id === e.target.value)!; setDraft({ field: d.id, op: filterOps(d.field_type)[0].value, value: "" }); }}>
        {defs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      <select className={selCls} value={draft.op} onChange={(e) => { const n = { ...draft, op: e.target.value as CfFilter["op"] }; setDraft(n); if (["empty", "yes", "no"].includes(n.op)) onChange(n); }}>
        {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {needsValue && def && (def.field_type === "dropdown" || def.field_type === "multi_select" ? (
        <select className={selCls} value={draft.value} onChange={(e) => { const n = { ...draft, value: e.target.value }; setDraft(n); if (n.value) onChange(n); }}>
          <option value="">Choose…</option>{def.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className={cn(selCls, "w-32")} type={def.field_type === "date" ? "date" : ["number", "decimal", "currency", "percentage"].includes(def.field_type) ? "number" : "text"}
          value={draft.value} placeholder="value" onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") apply(draft); }} onBlur={() => apply(draft)} />
      ))}
      {capped && <span className="px-1 text-2xs text-warning">first 1,000 matches</span>}
      <button aria-label="Clear filter" className="flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-field hover:text-ink" onClick={() => { setDraft(null); onChange(null); }}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
