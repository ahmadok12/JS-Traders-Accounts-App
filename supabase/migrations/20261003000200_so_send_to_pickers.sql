-- One-step picking from the sales order: approve (if still a draft) and create a picking task per warehouse
-- for everything still to pick there, given to the chosen staff.  p_plan: {"<warehouse_id>": ["<user_id>", ...], ...}
alter table public.sales_orders add column if not exists picking_plan jsonb;

create or replace function public.start_so_picking(p_so_id uuid, p_plan jsonb, p_notes text default null)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare so record; k text; v_wh uuid; v_users uuid[]; v_lines jsonb; v_ids uuid[] := '{}';
begin
  select * into so from public.sales_orders where id = p_so_id for update;
  if so.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(so.company_id, 'picking.manage');
  if so.status = 'DRAFT' then perform public.approve_sales_order(so.id); end if;
  select * into so from public.sales_orders where id = p_so_id;
  if so.status not in ('APPROVED','PARTIALLY_DELIVERED') then
    raise exception 'Sales order % is % — only approved orders can be picked', so.doc_no, lower(so.status) using errcode = '22023';
  end if;
  update public.sales_orders set picking_plan = p_plan where id = so.id;
  for k in select jsonb_object_keys(coalesce(p_plan, '{}'::jsonb)) loop
    v_wh := k::uuid;
    select coalesce(array_agg(distinct x::uuid), '{}') into v_users from jsonb_array_elements_text(p_plan->k) x;
    if coalesce(array_length(v_users, 1), 0) = 0 then continue; end if;
    select jsonb_agg(jsonb_build_object('allocation_id', a.id, 'quantity', public.pick_free_qty(a.id)) order by l.line_no) into v_lines
      from public.sales_order_line_warehouse_allocations a join public.sales_order_lines l on l.id = a.sales_order_line_id
     where l.sales_order_id = so.id and l.is_active and a.warehouse_id = v_wh and a.status = 'OPEN' and coalesce(public.pick_free_qty(a.id), 0) > 0;
    if v_lines is null then continue; end if;
    v_ids := v_ids || public.pick_create_task(so.company_id, so.id, v_wh, v_users, p_notes, null, v_lines);
  end loop;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Nothing left to pick for the chosen warehouses on %', so.doc_no using errcode = '22023';
  end if;
  return v_ids;
end $$;
revoke execute on function public.start_so_picking(uuid, jsonb, text) from public, anon;
grant execute on function public.start_so_picking(uuid, jsonb, text) to authenticated;
