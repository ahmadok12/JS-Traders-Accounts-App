-- =====================================================================
-- JS Traders ERP — pickers may add more photos after finishing a picking task
--   Before: photos only while the task is OPEN / IN_PROGRESS.
--   Now: the task's pickers can also add photos to a DONE task (not a cancelled one).
--   Removing a photo after the task is finished stays manager-only (attachment_remove unchanged).
-- =====================================================================
create or replace function public.attachment_can_add(p_company uuid, p_entity_type text, p_entity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_entity_type in ('goods_receipts','stock_counts')
          and public.wh_job_is_assignee(case p_entity_type when 'goods_receipts' then 'RECEIPT' else 'COUNT' end, p_entity_id))
      or (p_entity_type = 'picking_tasks' and public.has_permission(p_company, 'picking.perform') and public.pick_is_assignee(p_entity_id)
          and exists (select 1 from public.picking_tasks t where t.id = p_entity_id and t.status in ('OPEN','IN_PROGRESS','DONE')))
      or (public.has_permission(p_company, 'attachments.manage') and public.attachment_can_view(p_company, p_entity_type, p_entity_id));
$$;
