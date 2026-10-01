import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SelectOption } from "@jst/ui";
import { sb } from "./client";

export const MAX_PAGE_SIZE = 100;

export interface ListParams {
  table: string;
  select: string;
  companyId: string | null;
  search?: string;
  searchColumns?: string[];
  filters?: Record<string, string | boolean | null | undefined>;
  orderBy?: { column: string; ascending?: boolean };
  page: number;
  pageSize: number;
  enabled?: boolean;
}

/** Escape a user search term for a PostgREST or=() ilike filter. */
function ilikeTerm(s: string) {
  return `%${s.replace(/[%_,()*\\]/g, " ").trim()}%`;
}

/** Paginated, company-scoped, column-limited list query (spec §5.2). */
export function useEntityList<T = Record<string, unknown>>(p: ListParams) {
  const pageSize = Math.min(p.pageSize, MAX_PAGE_SIZE);
  return useQuery({
    queryKey: ["list", p.table, p.companyId, p.select, p.search, p.filters, p.orderBy, p.page, pageSize],
    enabled: !!p.companyId && p.enabled !== false,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async () => {
      let q = sb().from(p.table).select(p.select, { count: "exact" }).eq("company_id", p.companyId!);
      for (const [k, v] of Object.entries(p.filters ?? {})) {
        if (v === undefined || v === "") continue;
        q = v === null ? q.is(k, null) : q.eq(k, v);
      }
      if (p.search && p.search.trim() && p.searchColumns?.length) {
        const t = ilikeTerm(p.search);
        q = q.or(p.searchColumns.map((c) => `${c}.ilike.${t}`).join(","));
      }
      if (p.orderBy) q = q.order(p.orderBy.column, { ascending: p.orderBy.ascending ?? true });
      const from = (p.page - 1) * pageSize;
      const { data, error, count } = await q.range(from, from + pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as T[], total: count ?? 0 };
    },
  });
}

export function useEntityRecord<T = Record<string, unknown>>(table: string, id: string | null, select: string) {
  return useQuery({
    queryKey: ["record", table, id, select],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await sb().from(table).select(select).eq("id", id!).single();
      if (error) throw error;
      return data as T;
    },
  });
}

/**
 * Insert or update one row. Updates send only changed fields. Returns the id.
 * `select` is required because some columns are privilege-restricted and
 * `returning *` would fail for those roles.
 */
export function useEntitySave(table: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string | null; values: Record<string, unknown> }) => {
      if (id) {
        if (Object.keys(values).length === 0) return id;
        const { error } = await sb().from(table).update(values).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await sb().from(table).insert(values).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      // invalidate only affected queries (spec §5.3)
      qc.invalidateQueries({ queryKey: ["list", table] });
      qc.invalidateQueries({ queryKey: ["record", table, id] });
      qc.invalidateQueries({ queryKey: ["lookup", table] });
      qc.invalidateQueries({ queryKey: ["audit", table, id] });
    },
  });
}

export interface LookupSpec {
  table: string;
  label: string;
  secondary?: string;
  /** extra equality filters, e.g. { is_active: true } */
  filters?: Record<string, string | boolean>;
  companyScoped?: boolean;
  valueColumn?: string;
  limit?: number;
}

/** Server-side search for the shared dropdown — never loads full tables. */
export function makeLookupLoader(spec: LookupSpec, companyId: string | null) {
  const valueCol = spec.valueColumn ?? "id";
  const cols = [valueCol, spec.label, spec.secondary].filter(Boolean).join(",");
  const toOption = (r: Record<string, unknown>): SelectOption => ({
    value: String(r[valueCol]),
    label: String(r[spec.label] ?? ""),
    secondary: spec.secondary ? String(r[spec.secondary] ?? "") : undefined,
  });
  const base = () => {
    let q = sb().from(spec.table).select(cols);
    if (spec.companyScoped !== false && companyId) q = q.eq("company_id", companyId);
    return q;
  };
  return {
    load: async (search: string) => {
      let q = base();
      for (const [k, v] of Object.entries(spec.filters ?? {})) q = q.eq(k, v);
      if (search.trim()) {
        const t = ilikeTerm(search);
        q = q.or([spec.label, spec.secondary].filter(Boolean).map((c) => `${c}.ilike.${t}`).join(","));
      }
      const { data, error } = await q.order(spec.label).limit(spec.limit ?? 30);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(toOption);
    },
    resolve: async (value: string) => {
      const { data } = await base().eq(valueCol, value).maybeSingle();
      return data ? toOption(data as unknown as Record<string, unknown>) : null;
    },
  };
}

export function useAuditHistory(table: string, id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["audit", table, id],
    enabled: !!id && enabled,
    queryFn: async () => {
      const { data, error } = await sb()
        .from("audit_logs")
        .select("id, action, user_id, changed_fields, old_value, new_value, created_at")
        .eq("entity_type", table)
        .eq("entity_id", id!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Resolve user display names for a set of ids (bounded, cached). */
export function useProfileNames(ids: (string | null | undefined)[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean))) as string[];
  return useQuery({
    queryKey: ["profile-names", uniq.sort().join(",")],
    enabled: uniq.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await sb().from("profiles").select("id, full_name, email").in("id", uniq);
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.id] = p.full_name || p.email || p.id;
      return map;
    },
  });
}
