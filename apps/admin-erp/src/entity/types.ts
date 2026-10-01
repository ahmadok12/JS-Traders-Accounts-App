import type * as React from "react";
import type { Column, SelectOption } from "@jst/ui";
import type { LookupSpec } from "@jst/data-access";

export type FieldKind = "text" | "email" | "phone" | "textarea" | "number" | "money" | "date" | "checkbox" | "select" | "lookup";

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** section code; omitted = basic (always visible) */
  section?: string;
  options?: SelectOption[];
  lookup?: LookupSpec;
  placeholder?: string;
  hint?: string;
  span?: 1 | 2 | 3;
  min?: number;
  /** cannot change after creation (e.g. product base unit once stock exists) */
  lockOnEdit?: boolean;
  /** blank → server assigns the next number */
  autoCode?: boolean;
  /** privilege-restricted column: read via RPC, shown only with permission */
  restricted?: { permission: string; rpc: string; param: string };
  /** how to render in View (defaults to plain value / looked-up label) */
  display?: (row: Record<string, unknown>) => React.ReactNode;
  defaultValue?: unknown;
  /** optional feature key (Settings → Features); field hidden while the feature is off */
  feature?: string;
}

export interface SectionDef {
  code: string;
  label: string;
  description?: string;
  /** requires permission to see at all (security; UI-level only — DB enforces) */
  permission?: string;
}

export interface ExtraPanelProps {
  record: Record<string, unknown>;
  canManage: boolean;
}

export interface EntityConfig {
  key: string;
  table: string;
  title: string;
  singular: string;
  description?: string;
  icon: React.ReactNode;
  perms: { view: string | string[]; manage: string };
  listSelect: string;
  recordSelect: string;
  searchColumns: string[];
  orderBy: { column: string; ascending?: boolean };
  columns: Column<Record<string, unknown> & { id: string }>[];
  fields: FieldDef[];
  sections?: SectionDef[];
  /** column used for Active/Inactive; null = no deactivate action */
  activeField?: string | null;
  titleField: string;
  subtitle?: (row: Record<string, unknown>) => React.ReactNode;
  status?: (row: Record<string, unknown>) => React.ReactNode;
  extraPanels?: { key: string; label: string; component: React.ComponentType<ExtraPanelProps>; visible?: (record: Record<string, unknown>) => boolean }[];
  dialogSize?: "md" | "lg" | "xl";
  /** columns / panels shown only when storage locations are turned on (Settings → Inventory) */
  storageLocationParts?: { columns?: string[]; panels?: string[] };
  /** optional feature key; the page shows a "turned off" notice while the feature is off */
  feature?: string;
  /** list quick filters */
  quickFilters?: { label: string; filters: Record<string, string | boolean | null> }[];
}
