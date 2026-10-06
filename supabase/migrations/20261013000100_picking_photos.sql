-- Picking photos: pickers attach photos (camera or gallery) to their picking task before finishing it;
-- the warehouse manager sees them live in the sales order window (Picking photos tab) and on the task.
-- Setting 'picking.photos_required' (default ON): a task cannot be finished without at least one photo.
-- Also: private Supabase Storage bucket 'attachments' — used by the attachments edge function while the
-- Cloudflare R2 keys are not set (files then live in Supabase Storage; R2 takes over once keys are added).

-- ---------------------------------------------------------------- storage fallback bucket (private)
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- picking tasks can carry files
create or replace function public.attachment_entity_ok(p_entity_type text) returns boolean
language sql immutable set search_path = '' as $$
  select p_entity_type in ('journal_entries','sales_invoices','quotations','sales_orders','gdns','goods_receipts','stock_adjustments',
                           'stock_transfers','stock_counts','assembly_orders','reservation_orders','price_tasks','customers','suppliers','products',
                           'purchase_orders','supplier_bills','purchase_cost_tasks','shipments','landed_costs',
                           'fx_payments','payment_agent_transactions','currency_conversions','pdc_records','bank_statement_imports',
                           'picking_tasks');
$$;

create or replace function public.attachment_can_view(p_company uuid, p_entity_type text, p_entity_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_entity_type in ('goods_receipts','stock_counts')
     and public.wh_job_is_assignee(case p_entity_type when 'goods_receipts' then 'RECEIPT' else 'COUNT' end, p_entity_id) then
    return true;
  end if;
  -- pickers on the task (current or earlier) always see its photos
  if p_entity_type = 'picking_tasks'
     and exists (select 1 from public.picking_task_assignees a where a.task_id = p_entity_id and a.user_id = auth.uid()) then
    return true;
  end if;
  if not public.has_permission(p_company, 'attachments.view') then return false; end if;
  return case p_entity_type
    when 'journal_entries'     then public.has_permission(p_company, 'journals.view')
    when 'sales_invoices'      then public.has_permission(p_company, 'sales.view_prices')
    when 'quotations'          then public.has_permission(p_company, 'sales.view_prices')
    when 'price_tasks'         then public.has_permission(p_company, 'sales.view_prices') or exists (select 1 from public.price_tasks t where t.id = p_entity_id and t.assigned_to = auth.uid())
    when 'sales_orders'        then public.has_permission(p_company, 'sales.view')
    when 'picking_tasks'       then public.has_permission(p_company, 'picking.manage') or public.has_permission(p_company, 'sales.view')
    when 'gdns'                then public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'inventory.view')
    when 'reservation_orders'  then public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'inventory.view')
    when 'customers'           then public.can_access_customer(p_entity_id)
    when 'suppliers'           then public.has_permission(p_company, 'suppliers.view')
    when 'products'            then true
    when 'purchase_orders'     then public.has_permission(p_company, 'purchasing.view')
    when 'supplier_bills'      then public.has_permission(p_company, 'purchasing.costs')
    when 'purchase_cost_tasks' then public.has_permission(p_company, 'purchasing.costs') or exists (select 1 from public.purchase_cost_tasks t where t.id = p_entity_id and t.assigned_to = auth.uid())
    when 'shipments'           then public.has_permission(p_company, 'purchasing.view')
    when 'landed_costs'        then public.has_permission(p_company, 'purchasing.costs')
    when 'fx_payments'         then public.has_permission(p_company, 'purchasing.costs') or public.has_permission(p_company, 'journals.view')
    when 'payment_agent_transactions' then public.has_permission(p_company, 'payment_agents.view') or public.has_permission(p_company, 'journals.view')
    when 'currency_conversions' then public.has_permission(p_company, 'journals.view')
    when 'pdc_records'         then public.has_permission(p_company, 'journals.view') or public.has_permission(p_company, 'pdc.manage')
    when 'bank_statement_imports' then public.has_permission(p_company, 'journals.view')
    else public.has_permission(p_company, 'inventory.view')
  end;
end $$;

-- pickers add photos only while their task is open; managers any time
create or replace function public.attachment_can_add(p_company uuid, p_entity_type text, p_entity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_entity_type in ('goods_receipts','stock_counts')
          and public.wh_job_is_assignee(case p_entity_type when 'goods_receipts' then 'RECEIPT' else 'COUNT' end, p_entity_id))
      or (p_entity_type = 'picking_tasks' and public.has_permission(p_company, 'picking.perform') and public.pick_is_assignee(p_entity_id)
          and exists (select 1 from public.picking_tasks t where t.id = p_entity_id and t.status in ('OPEN','IN_PROGRESS')))
      or (public.has_permission(p_company, 'attachments.manage') and public.attachment_can_view(p_company, p_entity_type, p_entity_id));
$$;

-- a picker may take back a photo they added while the task is still open
create or replace function public.attachment_remove(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.attachments;
begin
  select * into a from public.attachments where id = p_id for update;
  if a.id is null or a.deleted_at is not null then raise exception 'File not found' using errcode = 'P0002'; end if;
  if a.entity_type = 'picking_tasks' and a.uploaded_by = auth.uid()
     and not public.has_permission(a.company_id, 'attachments.manage')
     and not exists (select 1 from public.picking_tasks t where t.id = a.entity_id and t.status in ('OPEN','IN_PROGRESS')) then
    raise exception 'This picking task is finished — ask the manager to remove the photo' using errcode = '42501';
  end if;
  if not (a.uploaded_by = auth.uid() and public.attachment_can_view(a.company_id, a.entity_type, a.entity_id))
     and not (public.has_permission(a.company_id, 'attachments.manage') and public.attachment_can_view(a.company_id, a.entity_type, a.entity_id)) then
    raise exception 'You cannot remove this file' using errcode = '42501';
  end if;
  update public.attachments set deleted_at = now(), deleted_by = auth.uid(),
    description = coalesce(description || ' · ', '') || coalesce('removed: ' || nullif(trim(p_reason), ''), 'removed')
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- setting (default ON)
insert into public.system_settings(company_id, key, value, description)
select c.id, 'picking.photos_required', 'true'::jsonb, 'Pickers must add at least one photo before finishing a picking task'
from public.companies c
on conflict (company_id, key) do nothing;

create or replace function public.picking_photos_required(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value = 'true'::jsonb from public.system_settings s
                   where s.company_id = p_company and s.key = 'picking.photos_required'), false);
$$;
revoke execute on function public.picking_photos_required(uuid) from public, anon;
grant execute on function public.picking_photos_required(uuid) to authenticated;

-- ---------------------------------------------------------------- finishing needs a photo
create or replace function public.complete_picking_task(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; v_left int; v_short int; v_who text; v_photos int;
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
  select count(*) into v_photos from public.attachments
   where entity_type = 'picking_tasks' and entity_id = p_id and deleted_at is null and upload_status = 'UPLOADED';
  if v_photos = 0 and public.picking_photos_required(t.company_id)
     and not public.has_permission(t.company_id, 'picking.manage') then
    raise exception 'Add at least one photo of the picked goods before finishing' using errcode = '23502';
  end if;
  update public.picking_tasks set status = 'DONE', completed_at = now(), completed_by = auth.uid() where id = p_id;
  insert into public.picking_task_events(company_id, task_id, event, to_user, note)
  values (t.company_id, p_id, 'COMPLETED', auth.uid(), concat_ws(' · ', case when v_short > 0 then v_short || ' item(s) short' end,
          case when v_photos > 0 then v_photos || ' photo' || case when v_photos > 1 then 's' else '' end end, nullif(trim(p_note),'')));
  select coalesce(nullif(full_name,''), email) into v_who from public.profiles where id = auth.uid();
  perform public.pick_notify_managers(p_id, 'TASK_DONE', t.doc_no || ' picked' || case when v_short > 0 then ' — ' || v_short || ' short' else '' end,
    concat_ws(' · ', 'By ' || coalesce(v_who, 'picker'), t.so_doc_no, case when v_photos > 0 then v_photos || ' photo(s)' end, nullif(trim(p_note),'')));
end $$;
revoke execute on function public.complete_picking_task(uuid, text) from public, anon;
grant execute on function public.complete_picking_task(uuid, text) to authenticated;

-- ---------------------------------------------------------------- photos of all picking tasks of a sales order
create or replace function public.so_picking_photos(p_so_id uuid)
returns table (id uuid, task_id uuid, task_doc_no text, warehouse_code text, original_file_name text, mime_type text,
               file_size bigint, description text, uploaded_by uuid, uploaded_by_name text, uploaded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, t.id, t.doc_no, w.code, a.original_file_name, a.mime_type, a.file_size, a.description, a.uploaded_by,
         coalesce(nullif(p.full_name,''), p.email), a.uploaded_at
  from public.picking_tasks t
  join public.attachments a on a.entity_type = 'picking_tasks' and a.entity_id = t.id and a.deleted_at is null and a.upload_status = 'UPLOADED'
  left join public.warehouses w on w.id = t.warehouse_id
  left join public.profiles p on p.id = a.uploaded_by
  where t.sales_order_id = p_so_id
    and public.attachment_can_view(t.company_id, 'picking_tasks', t.id)
  order by a.uploaded_at;
$$;
revoke execute on function public.so_picking_photos(uuid) from public, anon;
grant execute on function public.so_picking_photos(uuid) to authenticated;
