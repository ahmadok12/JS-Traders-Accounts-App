-- Roll selection on sales orders: for roll-tracked items (tracking_type = PHYSICAL_UNIT) the order can say
-- which rolls to cut, per warehouse: [{unit_id, qty}]. Empty / null = Auto (best fit, as before).
-- The GDN uses the chosen rolls first (what is still left of the plan for that warehouse line), any rest is cut automatically.
-- Pickers see the chosen rolls on their task.

alter table public.sales_order_line_warehouse_allocations add column if not exists roll_cuts jsonb;

-- replace the roll plan of a sales order: p_plan = [{ line_id, warehouse_id, cuts: [{unit_id, qty}] }]
create or replace function public.set_so_roll_plan(p_so_id uuid, p_plan jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare so record; e jsonb; c jsonb; a record; u record; v_sum numeric; v_q numeric; n int := 0; v_cuts jsonb;
begin
  select * into so from public.sales_orders where id = p_so_id;
  if so.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(so.company_id, 'sales.manage');
  if so.status in ('CANCELLED','CLOSED','DELIVERED') then return; end if;

  update public.sales_order_line_warehouse_allocations al set roll_cuts = null
    from public.sales_order_lines sl where sl.id = al.sales_order_line_id and sl.sales_order_id = p_so_id and al.roll_cuts is not null;

  for e in select * from jsonb_array_elements(coalesce(p_plan, '[]'::jsonb)) loop
    n := n + 1;
    select al.*, sl.product_id, sl.variant_id, p.name as product_name, w.code as wh_code into a
      from public.sales_order_line_warehouse_allocations al
      join public.sales_order_lines sl on sl.id = al.sales_order_line_id
      join public.products p on p.id = sl.product_id
      join public.warehouses w on w.id = al.warehouse_id
     where sl.sales_order_id = p_so_id and sl.id = (e->>'line_id')::uuid and al.warehouse_id = (e->>'warehouse_id')::uuid
       and al.status <> 'CANCELLED'
     for update of al;
    if a.id is null then raise exception 'Roll choice %: order line / warehouse not found', n using errcode = 'P0002'; end if;
    if not public.inv_is_unit_tracked(a.product_id) then continue; end if;
    v_sum := 0; v_cuts := '[]'::jsonb;
    for c in select * from jsonb_array_elements(coalesce(e->'cuts', '[]'::jsonb)) loop
      v_q := nullif(c->>'qty','')::numeric;
      if v_q is null or v_q <= 0 then continue; end if;
      select * into u from public.physical_units where id = (c->>'unit_id')::uuid;
      if u.id is null or u.product_id <> a.product_id or u.variant_id is distinct from a.variant_id then
        raise exception '%: roll not found for this item', a.product_name using errcode = 'P0002';
      end if;
      if u.warehouse_id <> a.warehouse_id then
        raise exception '%: roll % is not in %', a.product_name, u.unit_no, a.wh_code using errcode = '22023';
      end if;
      v_sum := v_sum + v_q;
      v_cuts := v_cuts || jsonb_build_array(jsonb_build_object('unit_id', u.id, 'qty', v_q));
    end loop;
    -- the plan is for the whole line quantity of this warehouse (rolls already dispatched on GDNs count towards it)
    if v_sum > a.quantity then
      raise exception '%: rolls chosen add up to % but the order has % from %', a.product_name, v_sum::numeric(18,2),
        a.quantity::numeric(18,2), a.wh_code using errcode = '23514';
    end if;
    update public.sales_order_line_warehouse_allocations set roll_cuts = case when jsonb_array_length(v_cuts) > 0 then v_cuts end where id = a.id;
    for c in select to_jsonb(x) from public.so_alloc_roll_left(a.id) x where x.left_qty > x.roll_remaining loop
      raise exception '%: roll % has only % left', a.product_name, c->>'unit_no', (c->>'roll_remaining')::numeric(18,2) using errcode = '23514';
    end loop;
  end loop;
end $$;
revoke execute on function public.set_so_roll_plan(uuid, jsonb) from public, anon;
grant execute on function public.set_so_roll_plan(uuid, jsonb) to authenticated;

-- what is still to be cut from each chosen roll of one allocation (plan minus what earlier GDNs already took from it)
create or replace function public.so_alloc_roll_left(p_alloc_id uuid)
returns table (unit_id uuid, unit_no text, planned numeric, used numeric, left_qty numeric, roll_remaining numeric)
language sql stable security definer set search_path = '' as $$
  with plan as (
    select (x->>'unit_id')::uuid as unit_id, sum((x->>'qty')::numeric) as planned, min(ord) as ord
    from public.sales_order_line_warehouse_allocations al,
         jsonb_array_elements(coalesce(al.roll_cuts, '[]'::jsonb)) with ordinality as t(x, ord)
    where al.id = p_alloc_id group by 1
  ), mv as (
    select m.id, m.physical_unit_id, m.quantity from public.stock_movements m
    where m.source_type = 'GDN' and m.source_line_id in (select id from public.gdn_lines where allocation_id = p_alloc_id)
  ), used as (
    select x.physical_unit_id as unit_id, -sum(x.quantity) as used from (
      select physical_unit_id, quantity from mv
      union all
      select r.physical_unit_id, r.quantity from public.stock_movements r where r.reversal_of in (select id from mv)
    ) x group by 1
  )
  select p.unit_id, u.unit_no, p.planned, coalesce(us.used, 0), greatest(p.planned - coalesce(us.used, 0), 0), u.remaining_qty
  from plan p join public.physical_units u on u.id = p.unit_id
  left join used us on us.unit_id = p.unit_id
  order by p.ord;
$$;
revoke execute on function public.so_alloc_roll_left(uuid) from public, anon;
grant execute on function public.so_alloc_roll_left(uuid) to authenticated;

-- GDN posting: chosen rolls first, rest automatic
create or replace function public.post_gdn(p_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare h record; so record; l jsonb; a record; v_q numeric; n int := 0; v_line uuid; r record; v_left numeric; b record; v_bundle boolean;
  rc record; v_cuts jsonb; v_cut_sum numeric; v_take numeric;
begin
  select * into h from public.gdns where id = p_id for update;
  if h.id is null then raise exception 'GDN not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.dispatch');
  if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % GDN', h.status using errcode = '22023'; end if;
  select * into so from public.sales_orders where id = h.sales_order_id for update;
  if so.status not in ('APPROVED','PARTIALLY_DELIVERED') then
    raise exception 'Sales order % is % — it can no longer be dispatched', so.doc_no, lower(so.status) using errcode = '22023';
  end if;

  for l in select * from jsonb_array_elements(h.lines_draft) loop
    v_q := (l->>'quantity')::numeric;
    select al.*, sl.product_id, sl.variant_id, sl.unit_price, sl.id as line_id into a
      from public.sales_order_line_warehouse_allocations al join public.sales_order_lines sl on sl.id = al.sales_order_line_id
     where al.id = (l->>'allocation_id')::uuid for update of al;
    n := n + 1;
    if a.id is null or a.status <> 'OPEN' then raise exception 'Line %: this order line is no longer open', n using errcode = '22023'; end if;
    if v_q > a.quantity - a.delivered_quantity then
      raise exception 'Line %: only % left to dispatch from this warehouse', n, (a.quantity - a.delivered_quantity)::numeric(18,2) using errcode = '23514';
    end if;
    perform public.inv_check_warehouse(h.company_id, a.warehouse_id);
    insert into public.gdn_lines(company_id, gdn_id, line_no, sales_order_line_id, allocation_id, warehouse_id, product_id, variant_id, quantity, unit_price)
    values (h.company_id, h.id, n, a.line_id, a.id, a.warehouse_id, a.product_id, a.variant_id, v_q, a.unit_price)
    returning id into v_line;

    v_left := v_q;
    for r in select * from public.reservations where sales_order_line_id = a.line_id and warehouse_id = a.warehouse_id and status = 'ACTIVE'
             order by created_at for update loop
      exit when v_left <= 0;
      if r.quantity <= v_left then
        update public.reservations set status = 'CONSUMED', released_at = now(), released_by = auth.uid(), release_reason = 'Dispatched on ' || h.doc_no where id = r.id;
        v_left := v_left - r.quantity;
      else
        update public.reservations set quantity = quantity - v_left where id = r.id;
        v_left := 0;
      end if;
    end loop;
    update public.sales_order_line_warehouse_allocations
       set reserved_quantity = greatest(reserved_quantity - v_q, 0), delivered_quantity = delivered_quantity + v_q where id = a.id;
    update public.sales_order_lines set delivered_qty = delivered_qty + v_q where id = a.line_id;

    select is_bundle into v_bundle from public.products where id = a.product_id;
    if v_bundle then
      for b in select * from public.product_bom(a.product_id, a.variant_id) loop
        perform public.inv_issue_stock(h.company_id, h.gdn_date, 'SALES_GDN', a.warehouse_id, null,
          b.component_product_id, b.component_variant_id, b.quantity * v_q, 'GDN', h.id, v_line, h.doc_no, 'Bundle component');
      end loop;
      if not found then raise exception 'Line %: bundle has no components set up', n using errcode = '22023'; end if;
    elsif a.roll_cuts is not null and public.inv_is_unit_tracked(a.product_id) then
      -- the rolls chosen on the order first
      v_cuts := '[]'::jsonb; v_cut_sum := 0;
      for rc in select * from public.so_alloc_roll_left(a.id) loop
        exit when v_cut_sum >= v_q;
        v_take := least(rc.left_qty, rc.roll_remaining, v_q - v_cut_sum);
        if v_take > 0 then
          v_cuts := v_cuts || jsonb_build_array(jsonb_build_object('unit_id', rc.unit_id, 'qty', v_take));
          v_cut_sum := v_cut_sum + v_take;
        end if;
      end loop;
      if v_cut_sum > 0 then
        perform public.inv_issue_units(h.company_id, h.gdn_date, 'SALES_GDN', a.warehouse_id, a.product_id, a.variant_id, v_cut_sum,
          'GDN', h.id, v_line, h.doc_no, 'Rolls chosen on ' || so.doc_no, v_cuts, n);
      end if;
      if v_q - v_cut_sum > 0 then
        perform public.inv_issue_units(h.company_id, h.gdn_date, 'SALES_GDN', a.warehouse_id, a.product_id, a.variant_id, v_q - v_cut_sum,
          'GDN', h.id, v_line, h.doc_no, null, null, n);
      end if;
    else
      perform public.inv_issue_stock(h.company_id, h.gdn_date, 'SALES_GDN', a.warehouse_id, null,
        a.product_id, a.variant_id, v_q, 'GDN', h.id, v_line, h.doc_no, null);
    end if;
  end loop;

  update public.gdns set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;
  perform public.so_refresh_status(h.sales_order_id);
  return jsonb_build_object('status','POSTED','lines', n);
end $function$;

-- rolls to pick, for the picker's screen and the GDN form: allocation ids → [{unit_no, qty}]
create or replace function public.alloc_roll_picks(p_alloc_ids uuid[])
returns table (allocation_id uuid, unit_id uuid, unit_no text, qty numeric, roll_remaining numeric, label text)
language sql stable security definer set search_path = '' as $$
  select al.id, r.unit_id, r.unit_no, r.left_qty, r.roll_remaining, u.label
  from public.sales_order_line_warehouse_allocations al
  cross join lateral public.so_alloc_roll_left(al.id) r
  join public.physical_units u on u.id = r.unit_id
  where al.id = any(p_alloc_ids) and al.roll_cuts is not null and r.left_qty > 0
    and exists (select 1 from public.sales_order_lines sl where sl.id = al.sales_order_line_id
                and (public.has_permission(al.company_id, 'sales.view') or public.has_permission(al.company_id, 'picking.perform')
                     or public.has_permission(al.company_id, 'inventory.view')));
$$;
revoke execute on function public.alloc_roll_picks(uuid[]) from public, anon;
grant execute on function public.alloc_roll_picks(uuid[]) to authenticated;
