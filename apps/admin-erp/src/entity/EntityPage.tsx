import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, PowerOff, Search, ShieldAlert } from "lucide-react";
import { Button, Card, DataTable, EmptyState, Input, PageHeader, cn } from "@jst/ui";
import { friendlyError, useAccess, useEntityList } from "@jst/data-access";
import { EntityDialog } from "./EntityDialog";
import type { EntityConfig } from "./types";
import { useFeatures, useStorageLocations } from "../lib/settings";

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
    enabled: canView,
  });

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
          {list.isFetching && !list.isLoading && <span className="text-2xs text-ink-faint">Refreshing…</span>}
        </div>
        {list.error ? (
          <div className="p-4 text-sm text-danger">{friendlyError(list.error)}</div>
        ) : (
          <DataTable
            columns={columns}
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
                title={q ? "No matches" : `No ${config.title.toLowerCase()} yet`}
                description={q ? "Try a different search term." : canManage ? `Create the first ${config.singular.toLowerCase()} to get started.` : undefined}
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
