-- =====================================================================
-- JS Traders ERP — delete a custom field (Settings → Custom fields)
--   Allowed only while no record / document has a value in it — otherwise make it inactive
--   (values are kept, the field is hidden). A field used by a formula cannot be deleted.
--   Workflow steps that required the field stop requiring it.
-- =====================================================================
create or replace function public.delete_custom_field_definition(p_company uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.custom_field_definitions%rowtype; n int;
begin
  perform public.inv_require(p_company, 'settings.manage');
  select * into d from public.custom_field_definitions where id = p_id and company_id = p_company for update;
  if d.id is null then raise exception 'Field not found' using errcode = 'P0002'; end if;
  select count(*) into n from public.custom_field_values where field_id = d.id and not (d.field_type = 'formula');
  if n > 0 then
    raise exception '"%" already has values on % record(s) — make it inactive instead (the values are kept and the field is hidden)', d.label, n using errcode = '22023';
  end if;
  if exists (select 1 from public.custom_field_definitions x where x.company_id = p_company and x.entity = d.entity and x.id <> d.id
             and x.field_type = 'formula' and x.formula like '%{' || d.code || '}%') then
    raise exception '"%" is used in a formula field — change or delete that formula first', d.label using errcode = '22023';
  end if;
  update public.workflow_steps set required_fields = array_remove(required_fields, 'cf:' || d.id::text)
   where company_id = p_company and 'cf:' || d.id::text = any(required_fields);
  delete from public.custom_field_values where field_id = d.id;   -- only calculated formula results can be here
  delete from public.custom_field_definitions where id = d.id;
end $$;
revoke execute on function public.delete_custom_field_definition(uuid, uuid) from public, anon;
grant execute on function public.delete_custom_field_definition(uuid, uuid) to authenticated;
