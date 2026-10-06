import { useQuery } from "@tanstack/react-query";
import { sb, useAccess } from "@jst/data-access";

/**
 * Optional features, stored per company in `system_settings` (value = true/false).
 * A missing row means OFF. Turned on/off in Settings → Features.
 */
export const FEATURES = {
  /** racks / shelves inside warehouses — switched via RPC (moves stock when turned off) */
  storageLocations: "inventory.storage_locations",
  /** brand master list + Brand field on products */
  brands: "products.brands",
  /** Quick invoice: invoice + automatic dispatch from the chosen warehouse in one step */
  quickInvoice: "sales.quick_invoice",
  /** pickers must add at least one photo before finishing a picking task (default on) */
  pickingPhotosRequired: "picking.photos_required",
} as const;
export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export const featureQueryKey = (companyId: string | null) => ["features", companyId];

export function useFeatures() {
  const { companyId } = useAccess();
  const q = useQuery({
    queryKey: featureQueryKey(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb()
        .from("system_settings")
        .select("key, value")
        .eq("company_id", companyId!)
        .in("key", Object.values(FEATURES));
      if (error) throw error;
      const m: Record<string, boolean> = {};
      for (const r of data ?? []) m[r.key as string] = r.value === true;
      return m;
    },
  });
  return {
    loading: q.isLoading,
    isOn: (key: FeatureKey | string | undefined) => (key ? q.data?.[key] === true : true),
  };
}

export function useFeature(key: FeatureKey) {
  const f = useFeatures();
  return { enabled: f.isOn(key), loading: f.loading };
}

/** Storage locations (racks / shelves). While off, location pickers/columns are hidden and the DB posts at warehouse level. */
export function useStorageLocations() {
  return useFeature(FEATURES.storageLocations);
}
