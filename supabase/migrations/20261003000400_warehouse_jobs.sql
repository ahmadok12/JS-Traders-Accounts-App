-- =====================================================================================
-- Stage 5 part 2b — warehouse jobs on the phone + warehouse desk
--  * Stock counts and receiving checks can be given to warehouse staff (one or many).
--    Their phones buzz (same notifications / Android alarm as picking).
--  * Staff count blind (they never see system stock) and submit; the manager posts the
--    differences with the existing count approval.
--  * Receiving check: staff tick what actually arrived against a draft goods receipt, note
--    short / damaged; the manager applies the checked quantities to the receipt and posts it.
--  * warehouse_desk(): one call for the manager's dashboard queues and who is on duty.
-- =====================================================================================

create table if not exists public.warehouse_job_assignees (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  job_type        text not null check (job_type in ('COUNT','RECEIPT')),
  job_id          uuid not null,
  user_id         uuid not null references public.profiles(id),
  assigned_at     timestamptz not null default now(),
  assigned_by     uuid default auth.uid(),
  acknowledged_at timestamptz,
  removed_at      timestamptz,
  removed_by      uuid
);
create unique index if not exists wja_active_uq on public.warehouse_job_assignees(job_type, job_id, user_id) where removed_at is null;
create index if not exists wja_user_idx on public.warehouse_job_assignees(user_id) where removed_at is null;
alter table public.warehouse_job_assignees enable row level security;
revoke all on public.warehouse_job_assignees from anon;

alter table public.stock_counts
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid,
  add column if not exists submit_note text;
alter table public.goods_receipts
  add column if not exists check_status text check (check_status in ('ASSIGNED','SUBMITTED','APPLIED')),
  add column if not exists check_submitted_at timestamptz,
  add column if not exists check_submitted_by uuid,
  add column if not exists check_note text;
alter table public.staff_notifications
  add column if not exists job_type text,
  add column if not exists job_id uuid;

-- what staff ticked on arrival (a copy of the receipt lines taken when the check was assigned)
create table if not exists public.receipt_check_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  receipt_id   uuid not null references public.goods_receipts(id),
  line_no      int not null,
  product_id   uuid not null references public.products(id),
  variant_id   uuid references public.product_variants(id),
  location_id  uuid,
  expected_qty numeric(18,4) not null default 0,
  checked_qty  numeric(18,4) check (checked_qty >= 0),
  note         text,
  checked_by   uuid,
  checked_at   timestamptz
);
create index if not exists rcl_receipt_idx on public.receipt_check_lines(receipt_id, line_no);
alter table public.receipt_check_lines enable row level security;
revoke all on public.receipt_check_lines from anon;

create or replace function public.wh_job_is_assignee(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.warehouse_job_assignees where job_type = p_type and job_id = p_id and user_id = auth.uid() and removed_at is null);
$$;
revoke execute on function public.wh_job_is_assignee(text, uuid) from public, anon;
grant execute on function public.wh_job_is_assignee(text, uuid) to authenticated;

create policy wja_select on public.warehouse_job_assignees for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'picking.manage'));
-- staff see the counts / receipts they were given (their lines follow through the existing line policies)
create policy sc_staff_select on public.stock_counts for select to authenticated
  using (public.has_permission(company_id, 'picking.perform') and public.wh_job_is_assignee('COUNT', id));
create policy gr_staff_select on public.goods_receipts for select to authenticated
  using (public.has_permission(company_id, 'picking.perform') and public.wh_job_is_assignee('RECEIPT', id));
create policy rcl_select on public.receipt_check_lines for select to authenticated
  using (exists (select 1 from public.goods_receipts h where h.id = receipt_id));

-- managers of a warehouse (picking.manage + access), except whoever caused it
create or replace function public.wh_notify_managers(p_company uuid, p_wh uuid, p_kind text, p_title text, p_body text, p_job_type text, p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare u record;
begin
  for u in select distinct ur.user_id from public.user_roles ur
           join public.role_permissions rp on rp.role_id = ur.role_id and rp.permission_code = 'picking.manage'
           join public.profiles p on p.id = ur.user_id and p.is_active
           where ur.company_id = p_company and ur.user_id is distinct from auth.uid()
             and (public.user_has_permission(ur.user_id, p_company, 'warehouses.all')
                  or exists (select 1 from public.user_warehouse_access a where a.user_id = ur.user_id and a.warehouse_id = p_wh)) loop
    insert into public.staff_notifications(company_id, user_id, kind, urgent, title, body, job_type, job_id)
    values (p_company, u.user_id, p_kind, false, p_title, p_body, p_job_type, p_job_id);
  end loop;
end $$;
revoke execute on function public.wh_notify_managers(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- give a count / receiving check to one or more staff of its warehouse (replaces the list)
create or replace function public.assign_warehouse_job(p_type text, p_id uuid, p_users uuid[], p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_wh uuid; v_doc text; v_status text; v_users uuid[]; u uuid; x record; v_items int; v_label text;
begin
  if p_type = 'COUNT' then
    select company_id, warehouse_id, doc_no, status into v_company, v_wh, v_doc, v_status from public.stock_counts where id = p_id for update;
    if v_company is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
    if v_status <> 'OPEN' then raise exception 'This count is %', lower(v_status) using errcode = '22023'; end if;
    select count(*) into v_items from public.stock_count_lines where count_id = p_id;
    v_label := 'Stock count';
  elsif p_type = 'RECEIPT' then
    select company_id, warehouse_id, doc_no, status into v_company, v_wh, v_doc, v_status from public.goods_receipts where id = p_id for update;
    if v_company is null then raise exception 'Goods receipt not found' using errcode = 'P0002'; end if;
    if v_status <> 'DRAFT' then raise exception 'Only a draft receipt can be checked (this one is %)', lower(v_status) using errcode = '22023'; end if;
    v_label := 'Receiving check';
  else
    raise exception 'Unknown job %', p_type using errcode = '22023';
  end if;
  perform public.inv_require(v_company, 'picking.manage');
  if not public.can_access_warehouse(v_wh) then raise exception 'You do not have access to this warehouse' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct y), '{}') into v_users from unnest(coalesce(p_users, '{}')) y where y is not null;
  foreach u in array v_users loop perform public.pick_check_picker(v_company, u, v_wh); end loop;

  if p_type = 'RECEIPT' then
    if not exists (select 1 from public.receipt_check_lines where receipt_id = p_id) then
      insert into public.receipt_check_lines(company_id, receipt_id, line_no, product_id, variant_id, location_id, expected_qty)
      select company_id, receipt_id, line_no, product_id, variant_id, location_id, quantity from public.goods_receipt_lines where receipt_id = p_id;
    end if;
    select count(*) into v_items from public.receipt_check_lines where receipt_id = p_id;
    update public.goods_receipts set check_status = coalesce(check_status, 'ASSIGNED') where id = p_id;
  end if;

  for x in select * from public.warehouse_job_assignees where job_type = p_type and job_id = p_id and removed_at is null and not (user_id = any(v_users)) loop
    update public.warehouse_job_assignees set removed_at = now(), removed_by = auth.uid() where id = x.id;
    insert into public.staff_notifications(company_id, user_id, kind, urgent, title, body, job_type, job_id)
    values (v_company, x.user_id, p_type || '_REMOVED', false, v_doc || ' was given to someone else', nullif(trim(p_note),''), p_type, p_id);
  end loop;
  foreach u in array v_users loop
    if not exists (select 1 from public.warehouse_job_assignees where job_type = p_type and job_id = p_id and user_id = u and removed_at is null) then
      insert into public.warehouse_job_assignees(company_id, job_type, job_id, user_id) values (v_company, p_type, p_id, u);
      insert into public.staff_notifications(company_id, user_id, kind, urgent, title, body, job_type, job_id)
      values (v_company, u, p_type || '_ASSIGNED', true, v_label || ' ' || v_doc,
              v_items || ' item' || case when v_items = 1 then '' else 's' end || ' · ' || (select code from public.warehouses where id = v_wh)
              || coalesce(' · ' || nullif(trim(p_note),''), ''), p_type, p_id);
    end if;
  end loop;
end $$;
revoke execute on function public.assign_warehouse_job(text, uuid, uuid[], text) from public, anon;
grant execute on function public.assign_warehouse_job(text, uuid, uuid[], text) to authenticated;

-- staff (or manager): counted quantity for one line; null = not counted yet
create or replace function public.staff_save_count(p_line_id uuid, p_qty numeric, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l record; h record;
begin
  select * into l from public.stock_count_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  select * into h from public.stock_counts where id = l.count_id;
  if not (public.has_permission(h.company_id, 'inventory.count') or public.wh_job_is_assignee('COUNT', h.id)) then
    raise exception 'This count is not assigned to you' using errcode = '42501';
  end if;
  if h.status <> 'OPEN' then raise exception 'This count is %', lower(h.status) using errcode = '22023'; end if;
  if l.status = 'POSTED' then raise exception 'This item was already approved' using errcode = '22023'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'Quantity cannot be negative' using errcode = '23514'; end if;
  update public.stock_count_lines set counted_qty = p_qty,
    status = case when p_qty is null then 'PENDING' else 'COUNTED' end,
    counted_by = case when p_qty is null then null else auth.uid() end,
    counted_at = case when p_qty is null then null else now() end,
    variance_note = nullif(trim(p_note),'')
  where id = l.id;
end $$;
revoke execute on function public.staff_save_count(uuid, numeric, text) from public, anon;
grant execute on function public.staff_save_count(uuid, numeric, text) to authenticated;

-- staff found an item that is not on the list
create or replace function public.staff_add_count_item(p_count_id uuid, p_product_id uuid, p_variant_id uuid, p_qty numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_line uuid; p record;
begin
  select * into h from public.stock_counts where id = p_count_id;
  if h.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(h.company_id, 'inventory.count') or public.wh_job_is_assignee('COUNT', h.id)) then
    raise exception 'This count is not assigned to you' using errcode = '42501';
  end if;
  if h.status <> 'OPEN' then raise exception 'This count is %', lower(h.status) using errcode = '22023'; end if;
  select id, has_variants, is_active, name into p from public.products where id = p_product_id and company_id = h.company_id;
  if p.id is null or not p.is_active then raise exception 'Choose an active item' using errcode = '23502'; end if;
  if p.has_variants and p_variant_id is null then raise exception 'Choose the variant of "%"', p.name using errcode = '23502'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Enter the quantity counted' using errcode = '23502'; end if;
  select id into v_line from public.stock_count_lines where count_id = h.id and product_id = p_product_id
     and variant_id is not distinct from p_variant_id and location_id is null;
  if v_line is null then
    insert into public.stock_count_lines(company_id, count_id, product_id, variant_id)
    values (h.company_id, h.id, p_product_id, p_variant_id) returning id into v_line;
  end if;
  perform public.staff_save_count(v_line, p_qty, p_note);
  return v_line;
end $$;
revoke execute on function public.staff_add_count_item(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.staff_add_count_item(uuid, uuid, uuid, numeric, text) to authenticated;

-- staff (or manager): what actually arrived on one receipt line
create or replace function public.staff_check_receipt_line(p_line_id uuid, p_qty numeric, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l record; h record;
begin
  select * into l from public.receipt_check_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  select * into h from public.goods_receipts where id = l.receipt_id;
  if not (public.has_permission(h.company_id, 'inventory.receive') or public.wh_job_is_assignee('RECEIPT', h.id)) then
    raise exception 'This receipt is not assigned to you' using errcode = '42501';
  end if;
  if h.status <> 'DRAFT' or h.check_status = 'APPLIED' then raise exception 'This receipt was already finalised' using errcode = '22023'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'Quantity cannot be negative' using errcode = '23514'; end if;
  if p_qty is not null and p_qty < l.expected_qty and coalesce(trim(p_note),'') = '' then
    raise exception 'Say what is wrong (short / damaged…)' using errcode = '23502';
  end if;
  update public.receipt_check_lines set checked_qty = p_qty, note = nullif(trim(p_note),''),
    checked_by = case when p_qty is null then null else auth.uid() end, checked_at = case when p_qty is null then null else now() end
  where id = l.id;
end $$;
revoke execute on function public.staff_check_receipt_line(uuid, numeric, text) from public, anon;
grant execute on function public.staff_check_receipt_line(uuid, numeric, text) to authenticated;

-- staff hand the job back to the manager
create or replace function public.submit_warehouse_job(p_type text, p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; v_left int; v_diff int; v_who text;
begin
  select coalesce(nullif(full_name,''), email) into v_who from public.profiles where id = auth.uid();
  if p_type = 'COUNT' then
    select * into h from public.stock_counts where id = p_id for update;
    if h.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
    if not (public.has_permission(h.company_id, 'inventory.count') or public.wh_job_is_assignee('COUNT', h.id)) then raise exception 'This count is not assigned to you' using errcode = '42501'; end if;
    if h.status <> 'OPEN' then raise exception 'This count is %', lower(h.status) using errcode = '22023'; end if;
    select count(*) filter (where status = 'PENDING') into v_left from public.stock_count_lines where count_id = p_id;
    if v_left > 0 then raise exception '% item(s) not counted yet', v_left using errcode = '23502'; end if;
    update public.stock_counts set submitted_at = now(), submitted_by = auth.uid(), submit_note = nullif(trim(p_note),'') where id = p_id;
    perform public.wh_notify_managers(h.company_id, h.warehouse_id, 'COUNT_SUBMITTED', 'Count ' || h.doc_no || ' finished — approve',
      concat_ws(' · ', 'By ' || coalesce(v_who, 'staff'), nullif(trim(p_note),'')), 'COUNT', p_id);
  elsif p_type = 'RECEIPT' then
    select * into h from public.goods_receipts where id = p_id for update;
    if h.id is null then raise exception 'Goods receipt not found' using errcode = 'P0002'; end if;
    if not (public.has_permission(h.company_id, 'inventory.receive') or public.wh_job_is_assignee('RECEIPT', h.id)) then raise exception 'This receipt is not assigned to you' using errcode = '42501'; end if;
    if h.status <> 'DRAFT' or h.check_status = 'APPLIED' then raise exception 'This receipt was already finalised' using errcode = '22023'; end if;
    select count(*) filter (where checked_qty is null), count(*) filter (where checked_qty is distinct from expected_qty)
      into v_left, v_diff from public.receipt_check_lines where receipt_id = p_id;
    if v_left > 0 then raise exception '% item(s) not checked yet', v_left using errcode = '23502'; end if;
    update public.goods_receipts set check_status = 'SUBMITTED', check_submitted_at = now(), check_submitted_by = auth.uid(), check_note = nullif(trim(p_note),'') where id = p_id;
    perform public.wh_notify_managers(h.company_id, h.warehouse_id, 'RECEIPT_SUBMITTED',
      'Receiving ' || h.doc_no || ' checked' || case when v_diff > 0 then ' — ' || v_diff || ' different' else ' — all OK' end,
      concat_ws(' · ', 'By ' || coalesce(v_who, 'staff'), nullif(trim(p_note),'')), 'RECEIPT', p_id);
  else
    raise exception 'Unknown job %', p_type using errcode = '22023';
  end if;
end $$;
revoke execute on function public.submit_warehouse_job(text, uuid, text) from public, anon;
grant execute on function public.submit_warehouse_job(text, uuid, text) to authenticated;

-- after the manager saved the receipt with the checked quantities
create or replace function public.mark_receipt_check_applied(p_receipt_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.goods_receipts where id = p_receipt_id for update;
  if h.id is null then raise exception 'Goods receipt not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.receive');
  update public.goods_receipts set check_status = 'APPLIED' where id = p_receipt_id;
end $$;
revoke execute on function public.mark_receipt_check_applied(uuid) from public, anon;
grant execute on function public.mark_receipt_check_applied(uuid) to authenticated;

-- acknowledging a job notification marks the assignee as "seen" (phone app and Android app)
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
    elsif r.kind in ('COUNT_ASSIGNED','RECEIPT_ASSIGNED') and r.job_id is not null then
      update public.warehouse_job_assignees set acknowledged_at = coalesce(acknowledged_at, now())
       where job_type = r.job_type and job_id = r.job_id and user_id = auth.uid() and removed_at is null and acknowledged_at is null;
    end if;
  end loop;
end $$;

create or replace function public.device_ack(p_token text, p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d record; r record;
begin
  select * into d from public.staff_devices where token_hash = public.staff_device_hash(p_token) and revoked_at is null;
  if d.id is null then raise exception 'Device not registered' using errcode = '42501'; end if;
  for r in update public.staff_notifications set read_at = now()
           where user_id = d.user_id and read_at is null and (p_ids is null or staff_notifications.id = any(p_ids))
           returning * loop
    if r.kind = 'TASK_ASSIGNED' and r.task_id is not null then
      update public.picking_task_assignees set acknowledged_at = coalesce(acknowledged_at, now())
       where task_id = r.task_id and user_id = d.user_id and removed_at is null and acknowledged_at is null;
    elsif r.kind in ('COUNT_ASSIGNED','RECEIPT_ASSIGNED') and r.job_id is not null then
      update public.warehouse_job_assignees set acknowledged_at = coalesce(acknowledged_at, now())
       where job_type = r.job_type and job_id = r.job_id and user_id = d.user_id and removed_at is null and acknowledged_at is null;
    end if;
  end loop;
end $$;

-- the warehouse manager's desk: queues + staff on duty, for the warehouses the caller manages
create or replace function public.warehouse_desk(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_wh uuid[];
begin
  perform public.inv_require(p_company_id, 'picking.manage');
  select coalesce(array_agg(id), '{}') into v_wh from public.warehouses where company_id = p_company_id and is_active and public.can_access_warehouse(id);
  select jsonb_build_object(
    'so_to_approve', (select count(*) from public.sales_orders where company_id = p_company_id and status = 'DRAFT'),
    'so_to_pick', (select count(distinct l.sales_order_id) from public.sales_order_line_warehouse_allocations a
                     join public.sales_order_lines l on l.id = a.sales_order_line_id and l.is_active
                     join public.sales_orders s on s.id = l.sales_order_id and s.status in ('APPROVED','PARTIALLY_DELIVERED')
                    where s.company_id = p_company_id and a.status = 'OPEN' and a.warehouse_id = any(v_wh) and coalesce(public.pick_free_qty(a.id), 0) > 0),
    'picking_open', (select count(*) from public.picking_tasks where company_id = p_company_id and status in ('OPEN','IN_PROGRESS') and warehouse_id = any(v_wh)),
    'picking_unassigned', (select count(*) from public.picking_tasks t where t.company_id = p_company_id and t.status in ('OPEN','IN_PROGRESS') and t.warehouse_id = any(v_wh)
                             and not exists (select 1 from public.picking_task_assignees x where x.task_id = t.id and x.removed_at is null)),
    'picking_unseen', (select count(distinct t.id) from public.picking_tasks t join public.picking_task_assignees x on x.task_id = t.id and x.removed_at is null and x.acknowledged_at is null
                        where t.company_id = p_company_id and t.status = 'OPEN' and t.warehouse_id = any(v_wh)),
    'shortages', (select count(*) from public.picking_task_lines l join public.picking_tasks t on t.id = l.task_id
                   where t.company_id = p_company_id and l.shortage_status = 'PENDING' and t.warehouse_id = any(v_wh)),
    'gdn_due', (select count(*) from public.picking_tasks t left join public.gdns g on g.id = t.gdn_id
                 where t.company_id = p_company_id and t.status = 'DONE' and t.warehouse_id = any(v_wh) and (g.id is null or g.status = 'CANCELLED')),
    'gdn_drafts', (select count(*) from public.gdns where company_id = p_company_id and status = 'DRAFT'),
    'counts_open', (select count(*) from public.stock_counts where company_id = p_company_id and status = 'OPEN' and warehouse_id = any(v_wh) and submitted_at is null),
    'counts_to_approve', (select count(*) from public.stock_counts c where c.company_id = p_company_id and c.status = 'OPEN' and c.warehouse_id = any(v_wh)
                            and (c.submitted_at is not null) and exists (select 1 from public.stock_count_lines l where l.count_id = c.id and l.status = 'COUNTED')),
    'receipts_draft', (select count(*) from public.goods_receipts where company_id = p_company_id and status = 'DRAFT' and warehouse_id = any(v_wh) and check_status is distinct from 'SUBMITTED'),
    'receipts_checked', (select count(*) from public.goods_receipts where company_id = p_company_id and status = 'DRAFT' and warehouse_id = any(v_wh) and check_status = 'SUBMITTED'),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', s.user_id, 'name', s.full_name, 'warehouse_ids', s.warehouse_ids, 'open_tasks', s.open_tasks,
        'open_jobs', (select count(*) from public.warehouse_job_assignees j where j.user_id = s.user_id and j.removed_at is null
                        and ((j.job_type = 'COUNT' and exists (select 1 from public.stock_counts c where c.id = j.job_id and c.status = 'OPEN' and c.submitted_at is null))
                          or (j.job_type = 'RECEIPT' and exists (select 1 from public.goods_receipts r where r.id = j.job_id and r.status = 'DRAFT' and r.check_status = 'ASSIGNED')))),
        'last_seen', (select max(d.last_seen_at) from public.staff_devices d where d.user_id = s.user_id and d.revoked_at is null),
        'on_duty', exists (select 1 from public.staff_devices d where d.user_id = s.user_id and d.revoked_at is null and d.last_seen_at > now() - interval '2 minutes')
      ) order by s.full_name) from public.picking_staff(p_company_id) s where s.is_staff and s.is_active), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke execute on function public.warehouse_desk(uuid) from public, anon;
grant execute on function public.warehouse_desk(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'warehouse_job_assignees') then
    execute 'alter publication supabase_realtime add table public.warehouse_job_assignees';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_count_lines') then
    execute 'alter publication supabase_realtime add table public.stock_count_lines';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'receipt_check_lines') then
    execute 'alter publication supabase_realtime add table public.receipt_check_lines';
  end if;
end $$;
