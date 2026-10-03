-- RUN ONCE in Supabase → SQL Editor if "Move staff" says the function is missing.
-- (Part of migration 20261003000100_picking_teams_realtime.sql — the connector needed manual approval for it.)
create or replace function public.set_staff_warehouses(p_company_id uuid, p_user uuid, p_warehouse_ids uuid[], p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_old uuid[]; v_new uuid[]; w uuid; x record; v_released int := 0;
begin
  perform public.inv_require(p_company_id, 'picking.manage');
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
             where ur.user_id = p_user and r.code <> 'WAREHOUSE_STAFF') then
    raise exception 'Only warehouse staff can be moved here — use Users & Access for other roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = p_user and ur.company_id = p_company_id and r.code = 'WAREHOUSE_STAFF') then
    raise exception 'This person is not warehouse staff' using errcode = '22023';
  end if;
  if coalesce(array_length(p_warehouse_ids, 1), 0) = 0 then raise exception 'Choose at least one warehouse' using errcode = '23502'; end if;
  select coalesce(array_agg(warehouse_id), '{}') into v_old from public.user_warehouse_access where user_id = p_user and company_id = p_company_id;
  select coalesce(array_agg(distinct y), '{}') into v_new from unnest(p_warehouse_ids) y where y is not null;
  foreach w in array (select coalesce(array_agg(distinct z), '{}') from unnest(v_old || v_new) z) loop
    if (w = any(v_old)) <> (w = any(v_new)) then
      perform public.inv_check_warehouse(p_company_id, w);
      if not public.can_access_warehouse(w) then raise exception 'You do not manage one of these warehouses' using errcode = '42501'; end if;
    end if;
  end loop;
  if v_old @> v_new and v_new @> v_old then return 0; end if;

  delete from public.user_warehouse_access where user_id = p_user and company_id = p_company_id and not (warehouse_id = any(v_new));
  insert into public.user_warehouse_access(company_id, user_id, warehouse_id, created_by)
  select p_company_id, p_user, y, auth.uid() from unnest(v_new) y
  where not exists (select 1 from public.user_warehouse_access a where a.user_id = p_user and a.warehouse_id = y);
  insert into public.staff_warehouse_moves(company_id, user_id, from_warehouses, to_warehouses, note)
  values (p_company_id, p_user, v_old, v_new, nullif(trim(p_note),''));

  for x in select pa.id, t.id as task_id, t.doc_no from public.picking_task_assignees pa join public.picking_tasks t on t.id = pa.task_id
           where pa.user_id = p_user and pa.removed_at is null and t.status in ('OPEN','IN_PROGRESS') and not (t.warehouse_id = any(v_new)) loop
    update public.picking_task_assignees set removed_at = now(), removed_by = auth.uid() where id = x.id;
    insert into public.picking_task_events(company_id, task_id, event, from_user, note) values (p_company_id, x.task_id, 'UNASSIGNED', p_user, 'Moved to another warehouse');
    perform public.pick_sync_primary(x.task_id);
    perform public.pick_notify(p_company_id, p_user, 'TASK_REMOVED', false, x.doc_no || ' taken off you', 'You were moved to another warehouse', x.task_id);
    v_released := v_released + 1;
  end loop;
  return v_released;
end $$;
revoke execute on function public.set_staff_warehouses(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.set_staff_warehouses(uuid, uuid, uuid[], text) to authenticated;
