-- Functions are EXECUTE-able by PUBLIC by default. Remove that; only signed-in
-- users may call helper/RPC functions (each one checks permissions itself).
revoke execute on all functions in schema public from public, anon;

grant execute on function
  public.is_active_user(),
  public.has_permission(uuid, text),
  public.is_company_member(uuid),
  public.my_access(),
  public.next_document_number(uuid, text),
  public.assign_role(uuid, text, uuid),
  public.revoke_role(uuid, text, uuid),
  public.set_user_active(uuid, boolean),
  public.list_unassigned_users(),
  public.can_access_warehouse(uuid),
  public.can_access_customer(uuid),
  public.customer_financial_details(uuid),
  public.supplier_bank_details(uuid),
  public.employee_restricted_details(uuid)
to authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;
