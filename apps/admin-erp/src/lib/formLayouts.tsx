/**
 * Configurable forms per role (Settings → Forms): hide fields, make fields required, hide or open sections
 * on master-record forms. The database also checks "required for the role" (new records, and values
 * cannot be cleared). Hiding is a convenience only — it never grants or removes access.
 */
import { useQuery } from "@tanstack/react-query";
import { sb, useAccess } from "@jst/data-access";

export interface FormLayoutRow {
  entity: string; role_code: string; hidden_fields: string[]; required_fields: string[]; hidden_sections: string[]; open_sections: string[];
}

export const FORM_ENTITIES: { key: string; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "products", label: "Products" },
  { key: "warehouses", label: "Warehouses" },
  { key: "employees", label: "Employees" },
  { key: "customer_groups", label: "Customer groups" },
  { key: "bank_accounts", label: "Bank & cash accounts" },
  { key: "payment_agents", label: "Payment agents" },
];
export const isFormEntity = (t: string) => FORM_ENTITIES.some((e) => e.key === t);

export function useFormLayouts(entity: string | null) {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["form-layouts", companyId, entity],
    enabled: !!companyId && !!entity && isFormEntity(entity),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("form_layouts").select("entity, role_code, hidden_fields, required_fields, hidden_sections, open_sections")
        .eq("company_id", companyId!).eq("entity", entity!);
      if (error) return [] as FormLayoutRow[]; // older database — no layouts
      return (data ?? []) as FormLayoutRow[];
    },
  });
}

export interface EffectiveLayout { hidden: Set<string>; required: Set<string>; hiddenSections: Set<string>; openSections: Set<string> }
const EMPTY: EffectiveLayout = { hidden: new Set(), required: new Set(), hiddenSections: new Set(), openSections: new Set() };

/**
 * A person with several roles gets the most open form: something is hidden only when every one of their
 * roles hides it (a role without a layout shows everything); required when any role requires it.
 */
export function mergeLayouts(rows: FormLayoutRow[], roles: string[]): EffectiveLayout {
  if (!rows.length || !roles.length) return EMPTY;
  const mine = roles.map((r) => rows.find((x) => x.role_code === r) ?? null);
  const all = <K extends keyof FormLayoutRow>(k: K) => {
    if (mine.some((m) => m === null)) return new Set<string>();
    const lists = mine.map((m) => new Set(m![k] as string[]));
    return new Set([...lists[0]].filter((x) => lists.every((l) => l.has(x))));
  };
  const any = <K extends keyof FormLayoutRow>(k: K) => new Set(mine.flatMap((m) => (m ? (m[k] as string[]) : [])));
  const required = any("required_fields");
  const hidden = all("hidden_fields");
  for (const r of required) hidden.delete(r);
  return { hidden, required, hiddenSections: all("hidden_sections"), openSections: any("open_sections") };
}

export function useMyFormLayout(entity: string): EffectiveLayout {
  const { roles } = useAccess();
  const q = useFormLayouts(entity);
  return q.data ? mergeLayouts(q.data, roles) : EMPTY;
}
