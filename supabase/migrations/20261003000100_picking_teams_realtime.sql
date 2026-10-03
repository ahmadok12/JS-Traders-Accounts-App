-- =====================================================================================
-- Picking v2 — warehouse staff teams, multi-picker tasks, shortage decisions,
-- buzzer notifications and realtime.
--
--  * Staff belong to one or more warehouses (user_warehouse_access) and can be moved;
--    every change is logged in staff_warehouse_moves.
--  * A picking task can be given to several pickers at once (picking_task_assignees).
--    Every picker on it can tick lines; the manager can add/remove pickers at any time.
--  * One "picking" action on a sales order creates a task per warehouse; a warehouse can be
--    asked for more than the order put there (allocation + reservation are moved).
--  * A short tick raises a PENDING shortage. The manager decides: reduce the order,
--    re-pick (same or another warehouse, any picker of that warehouse) or keep it on the order.
--  * staff_notifications drives the phone buzzer and manager alerts (Supabase Realtime).
-- =====================================================================================

-- ---------------------------------------------------------------- generic helpers
create or replace function public.user_has_permission(p_user uuid, p_company_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur
                 join public.role_permissions rp on rp.role_id = ur.role_id
                 join public.profiles p on p.id = ur.user_id and p.is_active
                 where ur.user_id = p_user and ur.company_id = p_company_id and rp.permission_code = p_permission);
$$;
revoke execute on function public.user_has_permission(uuid, uuid, text) from public, anon, authenticated;

-- can this user be sent to pick in this warehouse? (picker + member of the warehouse, or sees all warehouses)
create or replace function public.user_in_warehouse(p_user uuid, p_company_id uuid, p_warehouse_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.user_has_permission(p_user, p_company_id, 'picking.perform')
     and (exists (select 1 from public.user_warehouse_access a where a.user_id = p_user and a.warehouse_id = p_warehouse_id)
          or public.user_has_permission(p_user, p_company_id, 'warehouses.all'));
$$;
revoke execute on function public.user_in_warehouse(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- staff ↔ warehouse history
create table public.staff_warehouse_moves (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  user_id         uuid not null references public.profiles(id),
  from_warehouses uuid[] not null default '{}',
  to_warehouses   uuid[] not null default '{}',
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid()
);
create index swm_user_idx on public.staff_warehouse_moves(user_id, created_at desc);
alter table public.staff_warehouse_moves enable row level security;
revoke insert, update, delete on public.staff_warehouse_moves from authenticated, anon;
create policy swm_select on public.staff_warehouse_moves for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'picking.manage') or public.has_permission(company_id, 'security.manage'));
create trigger immutable before update or delete on public.staff_warehouse_moves for each row execute function public.tg_immutable();

-- ---------------------------------------------------------------- pickers per task
create table public.picking_task_assignees (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  task_id         uuid not null references public.picking_tasks(id),
  user_id         uuid not null references public.profiles(id),
  assigned_at     timestamptz not null default now(),
  assigned_by     uuid default auth.uid(),
  acknowledged_at timestamptz,
  removed_at      timestamptz,
  removed_by      uuid
);
create unique index pta_active_uq on public.picking_task_assignees(task_id, user_id) where removed_at is null;
create index pta_user_idx on public.picking_task_assignees(user_id, task_id) where removed_at is null;
create index pta_task_idx on public.picking_task_assignees(task_id);
alter table public.picking_task_assignees enable row level security;
revoke insert, update, delete on public.picking_task_assignees from authenticated, anon;

insert into public.picking_task_assignees(company_id, task_id, user_id, assigned_at, assigned_by, acknowledged_at)
select company_id, id, assigned_to, created_at, created_by, coalesce(started_at, created_at) from public.picking_tasks where assigned_to is not null;

create or replace function public.pick_is_assignee(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.picking_task_assignees where task_id = p_task_id and user_id = auth.uid() and removed_at is null);
$$;
revoke execute on function public.pick_is_assignee(uuid) from public, anon;
grant execute on function public.pick_is_assignee(uuid) to authenticated;

alter policy pick_select on public.picking_tasks
  using ((public.has_permission(company_id, 'picking.manage') and public.can_access_warehouse(warehouse_id))
         or (public.has_permission(company_id, 'picking.perform') and public.pick_is_assignee(id)));
create policy pta_select on public.picking_task_assignees for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.picking_tasks t where t.id = task_id));

-- keep picking_tasks.assigned_to = first active picker (lists, older screens)
create or replace function public.pick_sync_primary(p_task_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.picking_tasks t set assigned_to = (select user_id from public.picking_task_assignees
     where task_id = p_task_id and removed_at is null order by assigned_at, id limit 1)
  where t.id = p_task_id;
$$;
revoke execute on function public.pick_sync_primary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- shortage decision on lines
alter table public.picking_task_lines
  add column shortage_status   text check (shortage_status in ('PENDING','RESOLVED')),
  add column shortage_action   text check (shortage_action in ('REDUCE_ORDER','REPICK','BACKORDER')),
  add column shortage_note     text,
  add column resolved_at       timestamptz,
  add column resolved_by       uuid,
  add column follow_up_task_id uuid references public.picking_tasks(id),
  add column source_line_id    uuid references public.picking_task_lines(id);
create index ptl_short_idx on public.picking_task_lines(company_id) where shortage_status = 'PENDING';
update public.picking_task_lines set shortage_status = 'RESOLVED', shortage_action = 'BACKORDER', resolved_at = now()
 where qty_picked is not null and qty_picked < qty_requested;

-- ---------------------------------------------------------------- notifications (buzzer + manager alerts)
create table public.staff_notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id    uuid not null references public.profiles(id),
  kind       text not null,                    -- TASK_ASSIGNED, TASK_REMOVED, TASK_CANCELLED, SHORTAGE, TASK_DONE
  urgent     boolean not null default false,   -- true = phone buzzer until acknowledged
  title      text not null,
  body       text,
  task_id    uuid references public.picking_tasks(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  read_at    timestamptz
);
create index sn_user_idx on public.staff_notifications(user_id, created_at desc);
create index sn_unread_idx on public.staff_notifications(user_id) where read_at is null;
alter table public.staff_notifications enable row level security;
revoke insert, update, delete on public.staff_notifications from authenticated, anon;
create policy sn_select on public.staff_notifications for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.pick_notify(p_company uuid, p_user uuid, p_kind text, p_urgent boolean, p_title text, p_body text, p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  insert into public.staff_notifications(company_id, user_id, kind, urgent, title, body, task_id)
  values (p_company, p_user, p_kind, p_urgent, p_title, p_body, p_task);
end $$;
revoke execute on function public.pick_notify(uuid, uuid, text, boolean, text, text, uuid) from public, anon, authenticated;

-- tell every picking manager of the task's warehouse (except whoever caused it)
create or replace function public.pick_notify_managers(p_task_id uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; u record;
begin
  select * into t from public.picking_tasks where id = p_task_id;
  for u in select distinct ur.user_id from public.user_roles ur
           join public.role_permissions rp on rp.role_id = ur.role_id and rp.permission_code = 'picking.manage'
           join public.profiles p on p.id = ur.user_id and p.is_active
           where ur.company_id = t.company_id and ur.user_id is distinct from auth.uid()
             and (public.user_has_permission(ur.user_id, t.company_id, 'warehouses.all')
                  or exists (select 1 from public.user_warehouse_access a where a.user_id = ur.user_id and a.warehouse_id = t.warehouse_id)) loop
    perform public.pick_notify(t.company_id, u.user_id, p_kind, false, p_title, p_body, p_task_id);
  end loop;
end $$;
revoke execute on function public.pick_notify_managers(uuid, text, text, text) from public, anon, authenticated;

-- mark my notifications read (null = all); acknowledging an assignment shows the manager "seen"
create or replace function public.ack_staff_notifications(p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in update public.staff_notifications set read_at = now()
           where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
           returning * loop
    if r.kind = 'TASK_ASSIGNED' and r.task_id is not null then
      update public.picking_task_assignees set acknowledged_at = coalesce(acknowledged_at, now())
       where task_id = r.task_id and user_id = auth.uid() and removed_at is null and acknowledged_at is null;
    end if;
  end loop;
end $$;
revoke execute on function public.ack_staff_notifications(uuid[]) from public, anon;
grant execute on function public.ack_staff_notifications(uuid[]) to authenticated;

-- ---------------------------------------------------------------- warehouse staff management
create or replace function public.picking_staff(p_company_id uuid)
returns table (user_id uuid, full_name text, email text, phone text, is_active boolean, is_staff boolean,
               warehouse_ids uuid[], open_tasks int, last_ack_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, coalesce(nullif(p.full_name,''), p.email), p.email, p.phone, p.is_active,
         exists (select 1 from public.user_roles ur2 join public.roles r on r.id = ur2.role_id
                 where ur2.user_id = p.id and ur2.company_id = p_company_id and r.code = 'WAREHOUSE_STAFF'),
         coalesce((select array_agg(a.warehouse_id order by a.created_at) from public.user_warehouse_access a
                   where a.user_id = p.id and a.company_id = p_company_id), '{}'),
         (select count(*)::int from public.picking_task_assignees x join public.picking_tasks t on t.id = x.task_id
           where x.user_id = p.id and x.removed_at is null and t.status in ('OPEN','IN_PROGRESS')),
         (select max(x.acknowledged_at) from public.picking_task_assignees x where x.user_id = p.id)
  from public.profiles p
  where public.has_permission(p_company_id, 'picking.manage')
    and exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                where ur.user_id = p.id and ur.company_id = p_company_id and rp.permission_code = 'picking.perform')
  order by 2;
$$;
revoke execute on function public.picking_staff(uuid) from public, anon;
grant execute on function public.picking_staff(uuid) to authenticated;

-- replace the warehouses of a warehouse-staff member; open tasks in warehouses they leave are taken off them.
-- returns how many tasks were taken off.
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

-- used by the warehouse-staff edge function (service role only)
create or replace function public.pick_staff_editable(p_actor uuid, p_company_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.user_has_permission(p_actor, p_company_id, 'picking.manage')
     and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user and ur.company_id = p_company_id and r.code = 'WAREHOUSE_STAFF')
     and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user and r.code <> 'WAREHOUSE_STAFF');
$$;
revoke execute on function public.pick_staff_editable(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pick_staff_editable(uuid, uuid, uuid) to service_role;

create or replace function public.pick_can_manage(p_actor uuid, p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.user_has_permission(p_actor, p_company_id, 'picking.manage');
$$;
revoke execute on function public.pick_can_manage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pick_can_manage(uuid, uuid) to service_role;

create or replace function public.pick_setup_new_staff(p_actor uuid, p_company_id uuid, p_user uuid, p_full_name text, p_phone text, p_warehouse_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_role uuid;
begin
  if not public.user_has_permission(p_actor, p_company_id, 'picking.manage') then
    raise exception 'You do not have permission (picking.manage) for this action' using errcode = '42501';
  end if;
  if coalesce(array_length(p_warehouse_ids, 1), 0) = 0 then raise exception 'Choose at least one warehouse' using errcode = '23502'; end if;
  if exists (select 1 from unnest(p_warehouse_ids) w where not exists (select 1 from public.warehouses x where x.id = w and x.company_id = p_company_id and x.is_active)) then
    raise exception 'Unknown warehouse' using errcode = '22023';
  end if;
  select id into v_role from public.roles where code = 'WAREHOUSE_STAFF';
  update public.profiles set full_name = coalesce(nullif(trim(p_full_name),''), full_name), phone = nullif(trim(p_phone),''),
         default_company_id = p_company_id where id = p_user;
  insert into public.user_roles(user_id, role_id, company_id, created_by) values (p_user, v_role, p_company_id, p_actor)
  on conflict do nothing;
  insert into public.user_warehouse_access(company_id, user_id, warehouse_id, created_by)
  select p_company_id, p_user, w, p_actor from unnest(p_warehouse_ids) w on conflict do nothing;
  insert into public.staff_warehouse_moves(company_id, user_id, from_warehouses, to_warehouses, note, created_by)
  values (p_company_id, p_user, '{}', p_warehouse_ids, 'Staff added', p_actor);
end $$;
revoke execute on function public.pick_setup_new_staff(uuid, uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.pick_setup_new_staff(uuid, uuid, uuid, text, text, uuid[]) to service_role;

-- ---------------------------------------------------------------- quantities
-- in picking = open tasks (asked, or what was found once ticked) + picked but not yet dispatched.
-- A short tick frees the missing quantity straight away so it can be re-picked or removed.
create or replace function public.pick_committed_qty(p_allocation_id uuid, p_exclude_task uuid default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when l.qty_picked is not null then l.qty_picked
                           when t.status in ('OPEN','IN_PROGRESS') then l.qty_requested else 0 end), 0)
  from public.picking_task_lines l join public.picking_tasks t on t.id = l.task_id
  left join public.gdns g on g.id = t.gdn_id
  where l.allocation_id = p_allocation_id and t.id is distinct from p_exclude_task
    and (t.status in ('OPEN','IN_PROGRESS') or (t.status = 'DONE' and (g.id is null or g.status in ('DRAFT','CANCELLED','REVERSED'))));
$$;
revoke execute on function public.pick_committed_qty(uuid, uuid) from public, anon, authenticated;

create or replace function public.pick_free_qty(p_allocation_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(a.quantity - a.delivered_quantity - public.pick_committed_qty(a.id), 0)
  from public.sales_order_line_warehouse_allocations a where a.id = p_allocation_id and a.status = 'OPEN';
$$;
revoke execute on function public.pick_free_qty(uuid) from public, anon, authenticated;

-- release up to p_qty of the active reservations behind an allocation (newest first)
create or replace function public.pick_release_reserved(p_allocation_id uuid, p_qty numeric, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; r record; v_left numeric := p_qty; v_done numeric := 0;
begin
  select * into a from public.sales_order_line_warehouse_allocations where id = p_allocation_id;
  for r in select * from public.reservations where sales_order_line_id = a.sales_order_line_id and warehouse_id = a.warehouse_id and status = 'ACTIVE'
           order by created_at desc for update loop
    exit when v_left <= 0;
    if r.quantity <= v_left then
      update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = p_reason where id = r.id;
      v_left := v_left - r.quantity; v_done := v_done + r.quantity;
    else
      update public.reservations set quantity = quantity - v_left where id = r.id;
      v_done := v_done + v_left; v_left := 0;
    end if;
  end loop;
  update public.sales_order_line_warehouse_allocations set reserved_quantity = greatest(reserved_quantity - v_done, 0) where id = p_allocation_id;
end $$;
revoke execute on function public.pick_release_reserved(uuid, numeric, text) from public, anon, authenticated;

-- move p_qty of an order line from one warehouse to another (allocation + reservation). Returns the target allocation.
create or replace function public.pick_shift_allocation(p_allocation_id uuid, p_to_warehouse uuid, p_qty numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a record; so record; v_free numeric; v_target uuid; tgt record; n int; v_doc text;
begin
  select al.*, sl.product_id, sl.variant_id, sl.line_no, sl.sales_order_id, p.is_bundle, p.name as pname into a
    from public.sales_order_line_warehouse_allocations al
    join public.sales_order_lines sl on sl.id = al.sales_order_line_id
    join public.products p on p.id = sl.product_id
   where al.id = p_allocation_id for update of al;
  if a.id is null then raise exception 'Order line not found' using errcode = 'P0002'; end if;
  if a.warehouse_id = p_to_warehouse or p_qty <= 0 then return a.id; end if;
  v_free := coalesce(public.pick_free_qty(a.id), 0);
  if p_qty > v_free then
    raise exception 'Line %: only % of "%" can still be moved', a.line_no, v_free::numeric(18,2), a.pname using errcode = '23514';
  end if;
  perform public.inv_check_warehouse(a.company_id, p_to_warehouse);
  select * into so from public.sales_orders where id = a.sales_order_id;

  perform public.pick_release_reserved(a.id, p_qty, 'Moved to another warehouse for picking');
  update public.sales_order_line_warehouse_allocations
     set quantity = case when quantity - p_qty <= 0 then quantity else quantity - p_qty end,  -- emptied → cancelled (quantity must stay > 0)
         status = case when quantity - p_qty <= 0 then 'CANCELLED' else status end
   where id = a.id;

  select * into tgt from public.sales_order_line_warehouse_allocations where sales_order_line_id = a.sales_order_line_id and warehouse_id = p_to_warehouse for update;
  if tgt.id is null then
    insert into public.sales_order_line_warehouse_allocations(company_id, sales_order_line_id, warehouse_id, quantity)
    values (a.company_id, a.sales_order_line_id, p_to_warehouse, p_qty) returning id into v_target;
  elsif tgt.status = 'CANCELLED' then
    update public.sales_order_line_warehouse_allocations set quantity = delivered_quantity + p_qty, reserved_quantity = 0, status = 'OPEN' where id = tgt.id;
    v_target := tgt.id;
  else
    update public.sales_order_line_warehouse_allocations set quantity = quantity + p_qty where id = tgt.id;
    v_target := tgt.id;
  end if;

  if not a.is_bundle then
    perform public.inv_reserve_line(a.company_id, p_to_warehouse, a.product_id, a.variant_id, p_qty, a.line_no);
    select count(*) into n from public.reservations where sales_order_id = so.id;
    loop
      n := n + 1; v_doc := so.doc_no || '-R' || n;
      exit when not exists (select 1 from public.reservations where company_id = so.company_id and doc_no = v_doc);
    end loop;
    insert into public.reservations(company_id, doc_no, warehouse_id, product_id, variant_id, quantity,
      source_type, source_id, sales_order_id, sales_order_line_id, customer_id)
    values (so.company_id, v_doc, p_to_warehouse, a.product_id, a.variant_id, p_qty, 'SALES_ORDER', so.id, so.id, a.sales_order_line_id, so.customer_id);
    update public.sales_order_line_warehouse_allocations set reserved_quantity = reserved_quantity + p_qty where id = v_target;
  end if;
  return v_target;
end $$;
revoke execute on function public.pick_shift_allocation(uuid, uuid, numeric) from public, anon, authenticated;

-- take p_qty off the order (goods the customer will not get)
create or replace function public.pick_reduce_allocation(p_allocation_id uuid, p_qty numeric, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; v_free numeric; v_lineq numeric;
begin
  select al.*, sl.quantity as line_qty, sl.sales_order_id, sl.line_no into a
    from public.sales_order_line_warehouse_allocations al join public.sales_order_lines sl on sl.id = al.sales_order_line_id
   where al.id = p_allocation_id for update of al;
  v_free := coalesce(public.pick_free_qty(a.id), 0);
  if p_qty > v_free then raise exception 'Line %: only % can still be removed from the order', a.line_no, v_free::numeric(18,2) using errcode = '23514'; end if;
  perform public.pick_release_reserved(a.id, p_qty, p_reason);
  update public.sales_order_line_warehouse_allocations
     set quantity = case when quantity - p_qty <= 0 then quantity else quantity - p_qty end,  -- emptied → cancelled (quantity must stay > 0)
         status = case when quantity - p_qty <= 0 then 'CANCELLED' else status end
   where id = a.id;
  v_lineq := a.line_qty - p_qty;
  if v_lineq <= 0 then
    perform public.so_retire_line(a.sales_order_line_id, p_reason);
  else
    update public.sales_order_lines set quantity = v_lineq where id = a.sales_order_line_id;
  end if;
  perform public.so_refresh_status(a.sales_order_id);
end $$;
revoke execute on function public.pick_reduce_allocation(uuid, numeric, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- what can be picked (per order line, all warehouses)
create or replace function public.so_pick_lines(p_so_id uuid)
returns table (sales_order_line_id uuid, line_no int, product_id uuid, variant_id uuid, ordered numeric, delivered numeric,
               in_picking numeric, pickable numeric, allocations jsonb)
language sql stable security definer set search_path = '' as $$
  select l.id, l.line_no, l.product_id, l.variant_id, l.quantity, l.delivered_qty,
         coalesce(sum(public.pick_committed_qty(a.id)) filter (where a.status = 'OPEN'), 0),
         coalesce(sum(greatest(a.quantity - a.delivered_quantity - public.pick_committed_qty(a.id), 0)) filter (where a.status = 'OPEN'), 0),
         coalesce(jsonb_agg(jsonb_build_object('allocation_id', a.id, 'warehouse_id', a.warehouse_id, 'quantity', a.quantity,
                  'free', greatest(a.quantity - a.delivered_quantity - public.pick_committed_qty(a.id), 0)))
                  filter (where a.status = 'OPEN'), '[]'::jsonb)
  from public.sales_order_lines l
  join public.sales_orders s on s.id = l.sales_order_id
  left join public.sales_order_line_warehouse_allocations a on a.sales_order_line_id = l.id
  where s.id = p_so_id and l.is_active
    and (public.has_permission(s.company_id, 'picking.manage') or public.has_permission(s.company_id, 'sales.view'))
  group by l.id
  order by l.line_no;
$$;
revoke execute on function public.so_pick_lines(uuid) from public, anon;
grant execute on function public.so_pick_lines(uuid) to authenticated;

-- ---------------------------------------------------------------- task creation
create or replace function public.pick_check_picker(p_company_id uuid, p_user uuid, p_warehouse_id uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_name text;
begin
  if p_user is null then return; end if;
  select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = p_user and is_active;
  if v_name is null or not public.user_has_permission(p_user, p_company_id, 'picking.perform') then
    raise exception 'This person cannot be given picking work' using errcode = '22023';
  end if;
  if p_warehouse_id is not null and not public.user_in_warehouse(p_user, p_company_id, p_warehouse_id) then
    raise exception '% does not work in % — move them there first (Warehouse Staff)', v_name,
      (select code from public.warehouses where id = p_warehouse_id) using errcode = '22023';
  end if;
end $$;
revoke execute on function public.pick_check_picker(uuid, uuid, uuid) from public, anon, authenticated;

-- one task in one warehouse. p_lines: [{allocation_id, quantity}] (allocations of this warehouse)
create or replace function public.pick_create_task(p_company uuid, p_so uuid, p_wh uuid, p_users uuid[], p_notes text, p_due date,
                                                   p_lines jsonb, p_source_line uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare so record; v_id uuid; v_doc text; e jsonb; a record; v_q numeric; n int := 0; u uuid; v_wcode text; v_users uuid[];
begin
  select * into so from public.sales_orders where id = p_so;
  perform public.inv_check_warehouse(p_company, p_wh);
  if not public.can_access_warehouse(p_wh) then raise exception 'You do not have access to this warehouse' using errcode = '42501'; end if;
  select code into v_wcode from public.warehouses where id = p_wh;
  select coalesce(array_agg(distinct y), '{}') into v_users from unnest(coalesce(p_users, '{}')) y where y is not null;
  foreach u in array v_users loop perform public.pick_check_picker(p_company, u, p_wh); end loop;

  v_doc := public.next_document_number(p_company, 'PICKING');
  insert into public.picking_tasks(company_id, doc_no, warehouse_id, sales_order_id, so_doc_no, notes, due_date)
  values (p_company, v_doc, p_wh, p_so, so.doc_no, nullif(trim(p_notes),''), p_due) returning id into v_id;

  for e in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_q := coalesce(nullif(e->>'quantity','')::numeric, 0);
    if v_q <= 0 then continue; end if;
    select al.*, sl.product_id, sl.variant_id, sl.line_no, sl.sales_order_id into a
      from public.sales_order_line_warehouse_allocations al join public.sales_order_lines sl on sl.id = al.sales_order_line_id
     where al.id = (e->>'allocation_id')::uuid for update of al;
    if a.id is null or a.sales_order_id <> p_so or a.warehouse_id <> p_wh then raise exception 'Order line does not match this warehouse' using errcode = '22023'; end if;
    if v_q > coalesce(public.pick_free_qty(a.id), 0) then
      raise exception 'Line %: only % can still be picked from %', a.line_no, coalesce(public.pick_free_qty(a.id), 0)::numeric(18,2), v_wcode using errcode = '23514';
    end if;
    n := n + 1;
    insert into public.picking_task_lines(company_id, task_id, line_no, allocation_id, product_id, variant_id, qty_requested, source_line_id)
    values (p_company, v_id, n, a.id, a.product_id, a.variant_id, v_q, p_source_line);
  end loop;
  if n = 0 then raise exception 'Nothing to pick from % on %', v_wcode, so.doc_no using errcode = '22023'; end if;

  insert into public.picking_task_events(company_id, task_id, event, note) values (p_company, v_id, 'CREATED', nullif(trim(p_notes),''));
  foreach u in array v_users loop
    insert into public.picking_task_assignees(company_id, task_id, user_id) values (p_company, v_id, u);
    insert into public.picking_task_events(company_id, task_id, event, to_user) values (p_company, v_id, 'ASSIGNED', u);
    perform public.pick_notify(p_company, u, 'TASK_ASSIGNED', true, 'New picking task ' || v_doc,
      n || ' item' || case when n > 1 then 's' else '' end || ' · ' || v_wcode || ' · ' || so.doc_no
        || coalesce(' · ' || nullif(trim(p_notes),''), ''), v_id);
  end loop;
  perform public.pick_sync_primary(v_id);
  return v_id;
end $$;
revoke execute on function public.pick_create_task(uuid, uuid, uuid, uuid[], text, date, jsonb, uuid) from public, anon, authenticated;

-- The picking dialog: one call, one task per warehouse.
-- p_tasks: [{warehouse_id, assignees:[uuid], lines:[{sales_order_line_id, quantity}]}]
-- If a warehouse is asked for more of a line than the order put there, the rest is moved from the line's other warehouses.
create or replace function public.create_picking_tasks(p_company_id uuid, p_so_id uuid, p_tasks jsonb, p_notes text default null, p_due date default null)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare so record; t jsonb; e jsonb; v_wh uuid; v_q numeric; v_need numeric; v_alloc uuid; v_free numeric; o record;
        v_lines jsonb; v_users uuid[]; v_ids uuid[] := '{}'; v_line record;
begin
  perform public.inv_require(p_company_id, 'picking.manage');
  select * into so from public.sales_orders where id = p_so_id and company_id = p_company_id for update;
  if so.id is null then raise exception 'Choose the sales order' using errcode = '23502'; end if;
  if so.status not in ('APPROVED','PARTIALLY_DELIVERED') then raise exception 'Sales order % is % — only approved orders can be picked', so.doc_no, lower(so.status) using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_tasks, '[]'::jsonb)) = 0 then raise exception 'Enter quantities to pick' using errcode = '23502'; end if;

  for t in select * from jsonb_array_elements(p_tasks) loop
    v_wh := nullif(t->>'warehouse_id','')::uuid;
    if v_wh is null then raise exception 'Choose the warehouse' using errcode = '23502'; end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into v_users from jsonb_array_elements_text(coalesce(t->'assignees','[]'::jsonb)) x;
    v_lines := '[]'::jsonb;
    for e in select * from jsonb_array_elements(coalesce(t->'lines','[]'::jsonb)) loop
      v_q := coalesce(nullif(e->>'quantity','')::numeric, 0);
      if v_q < 0 then raise exception 'Quantities cannot be negative' using errcode = '23514'; end if;
      if v_q = 0 then continue; end if;
      select * into v_line from public.sales_order_lines where id = (e->>'sales_order_line_id')::uuid and sales_order_id = so.id and is_active;
      if v_line.id is null then raise exception 'Order line not found' using errcode = 'P0002'; end if;
      v_alloc := null;
      select id into v_alloc from public.sales_order_line_warehouse_allocations where sales_order_line_id = v_line.id and warehouse_id = v_wh and status = 'OPEN';
      v_free := coalesce(public.pick_free_qty(v_alloc), 0);
      v_need := v_q - v_free;
      -- borrow the missing quantity from the line's other warehouses (most free first)
      for o in select a.id, coalesce(public.pick_free_qty(a.id), 0) as free from public.sales_order_line_warehouse_allocations a
               where a.sales_order_line_id = v_line.id and a.warehouse_id <> v_wh and a.status = 'OPEN' order by 2 desc loop
        exit when v_need <= 0;
        if o.free <= 0 then continue; end if;
        v_alloc := public.pick_shift_allocation(o.id, v_wh, least(o.free, v_need));
        v_need := v_need - least(o.free, v_need);
      end loop;
      if v_need > 0 then
        raise exception 'Line %: only % more can be picked on this order', v_line.line_no, (v_q - v_need)::numeric(18,2) using errcode = '23514';
      end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('allocation_id', v_alloc, 'quantity', v_q));
    end loop;
    if jsonb_array_length(v_lines) = 0 then continue; end if;
    v_ids := v_ids || public.pick_create_task(p_company_id, so.id, v_wh, v_users, coalesce(nullif(trim(t->>'notes'),''), p_notes),
                                              coalesce(nullif(t->>'due_date','')::date, p_due), v_lines);
  end loop;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Enter quantities to pick' using errcode = '23502'; end if;
  return v_ids;
end $$;
revoke execute on function public.create_picking_tasks(uuid, uuid, jsonb, text, date) from public, anon;
grant execute on function public.create_picking_tasks(uuid, uuid, jsonb, text, date) to authenticated;

-- older single-warehouse entry point, kept for compatibility
create or replace function public.create_picking_task(p_header jsonb, p_lines jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_so uuid := nullif(p_header->>'sales_order_id','')::uuid;
  v_wh uuid := nullif(p_header->>'warehouse_id','')::uuid;
  v_user uuid := nullif(p_header->>'assigned_to','')::uuid;
  so record;
begin
  perform public.inv_require(v_company, 'picking.manage');
  select * into so from public.sales_orders where id = v_so and company_id = v_company for update;
  if so.id is null then raise exception 'Choose the sales order' using errcode = '23502'; end if;
  if so.status not in ('APPROVED','PARTIALLY_DELIVERED') then raise exception 'Sales order % is % — only approved orders can be picked', so.doc_no, lower(so.status) using errcode = '22023'; end if;
  return public.pick_create_task(v_company, v_so, v_wh, case when v_user is null then '{}'::uuid[] else array[v_user] end,
    p_header->>'notes', nullif(p_header->>'due_date','')::date,
    coalesce(p_lines, (select jsonb_agg(jsonb_build_object('allocation_id', x.allocation_id, 'quantity', x.pickable))
                       from public.so_pickable(v_so) x where x.warehouse_id = v_wh and x.pickable > 0)));
end $$;

-- ---------------------------------------------------------------- pickers on a task
create or replace function public.set_picking_assignees(p_id uuid, p_users uuid[], p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; u uuid; x record; v_users uuid[]; v_left int;
begin
  select * into t from public.picking_tasks where id = p_id for update;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'picking.manage');
  if not public.can_access_warehouse(t.warehouse_id) then raise exception 'You do not have access to this warehouse' using errcode = '42501'; end if;
  if t.status not in ('OPEN','IN_PROGRESS') then raise exception 'Only open tasks can be reassigned' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct y), '{}') into v_users from unnest(coalesce(p_users, '{}')) y where y is not null;
  foreach u in array v_users loop perform public.pick_check_picker(t.company_id, u, t.warehouse_id); end loop;
  select count(*) into v_left from public.picking_task_lines where task_id = p_id and qty_picked is null;

  for x in select * from public.picking_task_assignees where task_id = p_id and removed_at is null and not (user_id = any(v_users)) loop
    update public.picking_task_assignees set removed_at = now(), removed_by = auth.uid() where id = x.id;
    insert into public.picking_task_events(company_id, task_id, event, from_user, note) values (t.company_id, p_id, 'UNASSIGNED', x.user_id, nullif(trim(p_note),''));
    perform public.pick_notify(t.company_id, x.user_id, 'TASK_REMOVED', false, t.doc_no || ' was given to someone else', nullif(trim(p_note),''), p_id);
  end loop;
  foreach u in array v_users loop
    if not exists (select 1 from public.picking_task_assignees where task_id = p_id and user_id = u and removed_at is null) then
      insert into public.picking_task_assignees(company_id, task_id, user_id) values (t.company_id, p_id, u);
      insert into public.picking_task_events(company_id, task_id, event, to_user, note) values (t.company_id, p_id, 'ASSIGNED', u, nullif(trim(p_note),''));
      perform public.pick_notify(t.company_id, u, 'TASK_ASSIGNED', true, 'Picking task ' || t.doc_no,
        v_left || ' item' || case when v_left = 1 then '' else 's' end || ' left · ' || (select code from public.warehouses where id = t.warehouse_id)
        || ' · ' || t.so_doc_no || coalesce(' · ' || nullif(trim(p_note),''), ''), p_id);
    end if;
  end loop;
  perform public.pick_sync_primary(p_id);
end $$;
revoke execute on function public.set_picking_assignees(uuid, uuid[], text) from public, anon;
grant execute on function public.set_picking_assignees(uuid, uuid[], text) to authenticated;

create or replace function public.assign_picking_task(p_id uuid, p_user uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_picking_assignees(p_id, case when p_user is null then '{}'::uuid[] else array[p_user] end, p_note);
end $$;

-- buzz the pickers of a task again (nobody answered)
create or replace function public.rebuzz_picking_task(p_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare t record; x record; n int := 0;
begin
  select * into t from public.picking_tasks where id = p_id;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'picking.manage');
  if t.status not in ('OPEN','IN_PROGRESS') then raise exception 'This task is %', lower(t.status) using errcode = '22023'; end if;
  for x in select * from public.picking_task_assignees where task_id = p_id and removed_at is null loop
    perform public.pick_notify(t.company_id, x.user_id, 'TASK_ASSIGNED', true, 'Reminder: ' || t.doc_no, 'The manager is waiting for this picking · ' || t.so_doc_no, p_id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nobody is on this task — assign pickers first' using errcode = '22023'; end if;
  return n;
end $$;
revoke execute on function public.rebuzz_picking_task(uuid) from public, anon;
grant execute on function public.rebuzz_picking_task(uuid) to authenticated;

-- ---------------------------------------------------------------- ticking
create or replace function public.record_pick(p_line_id uuid, p_qty numeric, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l record; t record; v_who text; v_free numeric; v_pname text;
begin
  select * into l from public.picking_task_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  select * into t from public.picking_tasks where id = l.task_id for update;
  if not (public.has_permission(t.company_id, 'picking.manage')
          or (public.has_permission(t.company_id, 'picking.perform') and public.pick_is_assignee(t.id))) then
    raise exception 'This task is not assigned to you' using errcode = '42501';
  end if;
  if t.status not in ('OPEN','IN_PROGRESS') then raise exception 'This task is %', lower(t.status) using errcode = '22023'; end if;
  select name into v_pname from public.products where id = l.product_id;

  if p_qty is null then  -- undo
    if l.qty_picked is null then return; end if;
    if l.shortage_status = 'RESOLVED' then
      raise exception 'The manager already decided about this shortage — it cannot be undone' using errcode = '22023';
    end if;
    if l.qty_picked < l.qty_requested then
      v_free := coalesce(public.pick_free_qty(l.allocation_id), 0);
      if v_free < l.qty_requested - l.qty_picked then
        raise exception 'The missing quantity was already given to another task — it cannot be undone' using errcode = '22023';
      end if;
    end if;
    update public.picking_task_lines set qty_picked = null, shortage_reason = null, shortage_status = null, picked_at = null, picked_by = null where id = l.id;
    return;
  end if;

  if l.qty_picked is not null then
    select coalesce(nullif(full_name,''), email) into v_who from public.profiles where id = l.picked_by;
    raise exception 'Already ticked by % — undo it first', coalesce(v_who, 'someone') using errcode = '22023';
  end if;
  if p_qty < 0 or p_qty > l.qty_requested then
    raise exception 'Picked quantity must be between 0 and %', l.qty_requested::numeric(18,2) using errcode = '23514';
  end if;
  if p_qty < l.qty_requested and coalesce(trim(p_reason),'') = '' then raise exception 'Say why it is short' using errcode = '23502'; end if;
  update public.picking_task_lines set qty_picked = p_qty,
    shortage_reason = case when p_qty < qty_requested then trim(p_reason) end,
    shortage_status = case when p_qty < qty_requested then 'PENDING' end,
    picked_at = now(), picked_by = auth.uid() where id = l.id;
  if t.status = 'OPEN' then
    update public.picking_tasks set status = 'IN_PROGRESS', started_at = now() where id = t.id;
    insert into public.picking_task_events(company_id, task_id, event, to_user) values (t.company_id, t.id, 'STARTED', auth.uid());
  end if;
  if p_qty < l.qty_requested then
    select coalesce(nullif(full_name,''), email) into v_who from public.profiles where id = auth.uid();
    insert into public.picking_task_events(company_id, task_id, event, to_user, note)
    values (t.company_id, t.id, 'SHORT', auth.uid(), v_pname || ': found ' || trim(to_char(p_qty, 'FM999999990.##')) || ' of ' || trim(to_char(l.qty_requested, 'FM999999990.##')) || ' — ' || trim(p_reason));
    perform public.pick_notify_managers(t.id, 'SHORTAGE', 'Short on ' || t.doc_no || ' — decide',
      v_pname || ': found ' || trim(to_char(p_qty, 'FM999999990.##')) || ' of ' || trim(to_char(l.qty_requested, 'FM999999990.##'))
      || ' (' || coalesce(v_who, 'picker') || ') — ' || trim(p_reason));
  end if;
end $$;

-- the manager decides what happens to a short quantity
-- p_action: REDUCE_ORDER | REPICK (p_warehouse_id: same or another warehouse, p_users: pickers there) | BACKORDER
create or replace function public.resolve_pick_shortage(p_line_id uuid, p_action text, p_warehouse_id uuid default null,
                                                        p_users uuid[] default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l record; t record; v_short numeric; v_wh uuid; v_alloc uuid; v_task uuid; v_pname text;
begin
  select * into l from public.picking_task_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  select * into t from public.picking_tasks where id = l.task_id for update;
  perform public.inv_require(t.company_id, 'picking.manage');
  if not public.can_access_warehouse(t.warehouse_id) then raise exception 'You do not have access to this warehouse' using errcode = '42501'; end if;
  if l.shortage_status is distinct from 'PENDING' then raise exception 'There is no open shortage on this line' using errcode = '22023'; end if;
  if t.status = 'CANCELLED' then raise exception 'This task is cancelled' using errcode = '22023'; end if;
  v_short := l.qty_requested - l.qty_picked;
  select name into v_pname from public.products where id = l.product_id;
  perform 1 from public.sales_orders where id = t.sales_order_id for update;

  if p_action = 'REDUCE_ORDER' then
    perform public.inv_require(t.company_id, 'sales.manage');
    perform public.pick_reduce_allocation(l.allocation_id, v_short, 'Short in picking ' || t.doc_no);
  elsif p_action = 'REPICK' then
    v_wh := coalesce(p_warehouse_id, t.warehouse_id);
    if coalesce(array_length(p_users, 1), 0) = 0 then raise exception 'Choose who should pick it' using errcode = '23502'; end if;
    v_alloc := public.pick_shift_allocation(l.allocation_id, v_wh, v_short);
    v_task := public.pick_create_task(t.company_id, t.sales_order_id, v_wh, p_users,
      coalesce(nullif(trim(p_note),''), 'Shortage from ' || t.doc_no), t.due_date,
      jsonb_build_array(jsonb_build_object('allocation_id', v_alloc, 'quantity', v_short)), l.id);
  elsif p_action = 'BACKORDER' then
    null; -- stays open on the sales order, can be picked later
  else
    raise exception 'Unknown decision %', p_action using errcode = '22023';
  end if;

  update public.picking_task_lines set shortage_status = 'RESOLVED', shortage_action = p_action, shortage_note = nullif(trim(p_note),''),
    resolved_at = now(), resolved_by = auth.uid(), follow_up_task_id = v_task where id = l.id;
  insert into public.picking_task_events(company_id, task_id, event, note)
  values (t.company_id, t.id, 'SHORTAGE_RESOLVED', v_pname || ' (' || trim(to_char(v_short, 'FM999999990.##')) || '): '
    || case p_action when 'REDUCE_ORDER' then 'removed from the order'
                     when 'REPICK' then 'sent to ' || (select doc_no from public.picking_tasks where id = v_task) || ' (' || (select code from public.warehouses where id = v_wh) || ')'
                     else 'kept on the order for later' end
    || coalesce(' — ' || nullif(trim(p_note),''), ''));
  return v_task;
end $$;
revoke execute on function public.resolve_pick_shortage(uuid, text, uuid, uuid[], text) from public, anon;
grant execute on function public.resolve_pick_shortage(uuid, text, uuid, uuid[], text) to authenticated;

create or replace function public.complete_picking_task(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; v_left int; v_short int; v_who text;
begin
  select * into t from public.picking_tasks where id = p_id for update;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(t.company_id, 'picking.manage')
          or (public.has_permission(t.company_id, 'picking.perform') and public.pick_is_assignee(t.id))) then
    raise exception 'This task is not assigned to you' using errcode = '42501';
  end if;
  if t.status not in ('OPEN','IN_PROGRESS') then raise exception 'This task is already %', lower(t.status) using errcode = '22023'; end if;
  select count(*) filter (where qty_picked is null), count(*) filter (where qty_picked < qty_requested) into v_left, v_short
    from public.picking_task_lines where task_id = p_id;
  if v_left > 0 then raise exception '% item(s) not ticked yet', v_left using errcode = '23502'; end if;
  update public.picking_tasks set status = 'DONE', completed_at = now(), completed_by = auth.uid() where id = p_id;
  insert into public.picking_task_events(company_id, task_id, event, to_user, note)
  values (t.company_id, p_id, 'COMPLETED', auth.uid(), concat_ws(' · ', case when v_short > 0 then v_short || ' item(s) short' end, nullif(trim(p_note),'')));
  select coalesce(nullif(full_name,''), email) into v_who from public.profiles where id = auth.uid();
  perform public.pick_notify_managers(p_id, 'TASK_DONE', t.doc_no || ' picked' || case when v_short > 0 then ' — ' || v_short || ' short' else '' end,
    concat_ws(' · ', 'By ' || coalesce(v_who, 'picker'), t.so_doc_no, nullif(trim(p_note),'')));
end $$;

create or replace function public.cancel_picking_task(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; x record;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'Enter a reason' using errcode = '23502'; end if;
  select * into t from public.picking_tasks where id = p_id for update;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'picking.manage');
  if t.status = 'CANCELLED' then return; end if;
  if t.gdn_id is not null and exists (select 1 from public.gdns where id = t.gdn_id and status in ('DRAFT','POSTED')) then
    raise exception 'A GDN was made from this task — cancel or reverse the GDN first' using errcode = '22023';
  end if;
  update public.picking_tasks set status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason) where id = p_id;
  update public.picking_task_lines set shortage_status = null where task_id = p_id and shortage_status = 'PENDING';
  insert into public.picking_task_events(company_id, task_id, event, note) values (t.company_id, p_id, 'CANCELLED', trim(p_reason));
  for x in select user_id from public.picking_task_assignees where task_id = p_id and removed_at is null loop
    perform public.pick_notify(t.company_id, x.user_id, 'TASK_CANCELLED', false, t.doc_no || ' cancelled', trim(p_reason), p_id);
  end loop;
end $$;

-- pickers list for older screens
create or replace function public.picking_assignees(p_company_id uuid)
returns table (user_id uuid, full_name text, email text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.full_name, s.email from public.picking_staff(p_company_id) s where s.is_active;
$$;

-- ---------------------------------------------------------------- realtime
alter table public.picking_tasks replica identity full;
alter table public.picking_task_lines replica identity full;
alter table public.picking_task_assignees replica identity full;
do $$
declare t text;
begin
  foreach t in array array['picking_tasks','picking_task_lines','picking_task_assignees','staff_notifications'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

create trigger audit after insert or update on public.picking_task_assignees for each row execute function public.tg_audit_row();
