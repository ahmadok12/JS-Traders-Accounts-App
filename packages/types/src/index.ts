/**
 * Shared domain types. Regenerate full DB types with:
 *   npx supabase gen types typescript --project-id rjdjaujoilcunwtynaze > packages/types/src/database.ts
 */
export type UUID = string;

export interface AccessCompany {
  company_id: UUID;
  company_name: string;
  role_codes: string[];
  permissions: string[];
}

export interface AuditLog {
  id: number;
  company_id: UUID | null;
  user_id: UUID | null;
  action: "INSERT" | "UPDATE" | "DELETE" | string;
  entity_type: string;
  entity_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
}

export interface Profile {
  id: UUID;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  default_company_id: UUID | null;
  created_at: string;
}
