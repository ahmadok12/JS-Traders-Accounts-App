-- =====================================================================
-- JS Traders ERP — Stage 3b part 2: rolls / physical units (spec §8.5)
-- * Products with Tracking = "Physical units / rolls" (tracking_type PHYSICAL_UNIT)
--   are held as individual rolls: roll no., original and remaining length,
--   parent roll (for cut pieces), warehouse, source document.
-- * Every stock movement can name the roll it touched (stock_movements.physical_unit_id),
--   so a roll's history is the movement ledger.
-- * Inbound: each roll's length (default: one roll for the line).
-- * Outbound: the user picks rolls, or the system cuts automatically
--   (stock not yet in rolls first, then the roll that leaves the smallest off-cut).
-- * Transfer: a whole roll keeps its roll no.; a cut piece becomes a new child roll.
-- * Existing stock is split into rolls with register_units (no stock change).
-- =====================================================================
-- ---------------------------------------------------------------- rolls / physical units
-- ---------------------------------------------------------------- rolls / physical units
insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, 'PHYSICAL_UNIT', 'R-', 5, false from public.companies c
on conflict do nothing;

create table public.physical_units (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  unit_no          text not null,
  product_id       uuid not null references public.products(id),
  variant_id       uuid references public.product_variants(id),
  warehouse_id     uuid not null references public.warehouses(id),
  location_id      uuid references public.warehouse_locations(id),
  original_qty     numeric(18,4) not null check (original_qty > 0),
  remaining_qty    numeric(18,4) not null default 0 check (remaining_qty >= 0),
  parent_unit_id   uuid references public.physical_units(id),
  label            text,
  notes            text,
  source_type      text,           -- GOODS_RECEIPT, STOCK_TRANSFER (cut piece), STOCK_ADJUSTMENT, REGISTERED, ...
  source_id        uuid,
  source_doc_no    text,
  last_movement_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, unit_no)
);
create index physical_units_stock_idx on public.physical_units(warehouse_id, product_id, variant_id) where remaining_qty > 0;
create index physical_units_product_idx on public.physical_units(product_id, variant_id);
create index physical_units_parent_idx on public.physical_units(parent_unit_id);
create trigger stamp before insert or update on public.physical_units for each row execute function public.tg_stamp_row();
alter table public.physical_units enable row level security;
revoke insert, update, delete on public.physical_units from authenticated, anon;
create policy pu_select on public.physical_units for select to authenticated
  using (public.can_view_inventory(company_id, warehouse_id));

alter table public.stock_movements add column physical_unit_id uuid references public.physical_units(id);
create index stock_movements_unit_idx on public.stock_movements(physical_unit_id) where physical_unit_id is not null;

create or replace view public.stock_ledger with (security_invoker = true) as
select m.id, m.company_id, m.movement_date, m.created_at, m.movement_type,
       m.warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
       m.location_id, l.code as location_code,
       m.product_id, p.sku, p.name as product_name, m.variant_id, v.name as variant_name,
       m.quantity, m.source_type, m.source_id, m.source_doc_no, m.reason, m.reversal_of, m.created_by,
       sum(m.quantity) over (partition by m.warehouse_id, m.product_id, m.variant_id
                             order by m.created_at, m.id rows unbounded preceding) as balance_after,
       m.physical_unit_id, u.unit_no
from public.stock_movements m
join public.warehouses w on w.id = m.warehouse_id
join public.products p on p.id = m.product_id
left join public.product_variants v on v.id = m.variant_id
left join public.warehouse_locations l on l.id = m.location_id
left join public.physical_units u on u.id = m.physical_unit_id;

-- Roll details for draft documents: { "<line_no>": [ {qty, label} | {unit_id, qty} ] }
create table public.doc_unit_plans (
  doc_type    text not null check (doc_type in ('GOODS_RECEIPT','STOCK_TRANSFER','STOCK_ADJUSTMENT')),
  doc_id      uuid not null,
  company_id  uuid not null references public.companies(id),
  plan        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (doc_type, doc_id)
);
alter table public.doc_unit_plans enable row level security;
revoke insert, update, delete on public.doc_unit_plans from authenticated, anon;
create policy dup_select on public.doc_unit_plans for select to authenticated
  using (public.has_permission(company_id, 'inventory.view'));

create or replace function public.inv_is_unit_tracked(p_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select tracking_type = 'PHYSICAL_UNIT' from public.products where id = p_product_id), false);
$$;
revoke execute on function public.inv_is_unit_tracked(uuid) from public, anon;
grant execute on function public.inv_is_unit_tracked(uuid) to authenticated;

-- The movement engine with an optional roll. inv_apply_movement keeps its signature
-- (every existing caller) and forwards here.
create or replace function public.inv_move(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text,
  p_reason text, p_reversal_of uuid default null, p_unit_id uuid default null)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_after numeric; v_name text; u record; v_units numeric; v_total numeric;
begin
  if p_location_id is not null and p_source_type <> 'LOCATION_SETTING'
     and not public.storage_locations_enabled(p_company_id) then
    p_location_id := null;
  end if;

  if p_unit_id is not null then
    select * into u from public.physical_units where id = p_unit_id for update;
    if u.id is null or u.company_id <> p_company_id or u.product_id <> p_product_id
       or u.variant_id is distinct from p_variant_id then
      raise exception 'Roll does not match this item' using errcode = '22023';
    end if;
    if u.warehouse_id <> p_warehouse_id then
      if p_qty > 0 and u.remaining_qty = 0 then      -- a whole (now empty) roll arriving elsewhere
        update public.physical_units set warehouse_id = p_warehouse_id, location_id = p_location_id where id = u.id;
      else
        raise exception 'Roll % is in another warehouse', u.unit_no using errcode = '22023';
      end if;
    end if;
    if u.remaining_qty + p_qty < 0 then
      raise exception 'Roll % has only % left', u.unit_no, u.remaining_qty::numeric(18,2) using errcode = '23514';
    end if;
    update public.physical_units set remaining_qty = remaining_qty + p_qty, last_movement_at = now() where id = u.id;
  end if;

  insert into public.stock_movements(company_id, movement_date, movement_type, warehouse_id, location_id,
    product_id, variant_id, quantity, source_type, source_id, source_line_id, source_doc_no, reason,
    reversal_of, created_by, physical_unit_id)
  values (p_company_id, coalesce(p_date, current_date), p_type, p_warehouse_id, p_location_id,
    p_product_id, p_variant_id, p_qty, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason,
    p_reversal_of, auth.uid(), p_unit_id);

  insert into public.stock_balances as b (company_id, warehouse_id, location_id, product_id, variant_id, on_hand, last_movement_at)
  values (p_company_id, p_warehouse_id, p_location_id, p_product_id, p_variant_id, p_qty, now())
  on conflict on constraint stock_balances_identity
  do update set on_hand = b.on_hand + excluded.on_hand, last_movement_at = now(), updated_at = now()
  returning on_hand into v_after;

  if p_qty < 0 and v_after < 0 and not public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
    select p.name || coalesce(' / ' || v.name, '') into v_name
    from public.products p left join public.product_variants v on v.id = p_variant_id
    where p.id = p_product_id;
    raise exception 'Insufficient stock for "%": only % available here (negative stock is not allowed)',
      v_name, (v_after - p_qty)::numeric(18,4) using errcode = '23514';
  end if;

  -- roll items: stock taken without naming a roll may not eat into roll stock
  if p_qty < 0 and p_unit_id is null and public.inv_is_unit_tracked(p_product_id) then
    select coalesce(sum(remaining_qty), 0) into v_units from public.physical_units
     where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
    select coalesce(sum(on_hand), 0) into v_total from public.stock_balances
     where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
    if v_total < v_units then
      raise exception 'This item is tracked by roll — choose the roll(s) to cut from' using errcode = '23514';
    end if;
  end if;
  return v_after;
end $$;
revoke execute on function public.inv_move(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.inv_apply_movement(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text,
  p_reason text, p_reversal_of uuid default null)
returns numeric language sql security definer set search_path = '' as $$
  select public.inv_move(p_company_id, p_date, p_type, p_warehouse_id, p_location_id, p_product_id, p_variant_id, p_qty,
    p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason, p_reversal_of, null);
$$;
revoke execute on function public.inv_apply_movement(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- New roll (empty until its inbound movement is applied)
create or replace function public.inv_new_unit(p_company_id uuid, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric, p_parent uuid, p_label text,
  p_source_type text, p_source_id uuid, p_doc_no text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Roll length must be more than 0' using errcode = '23514'; end if;
  insert into public.physical_units(company_id, unit_no, product_id, variant_id, warehouse_id, location_id,
    original_qty, remaining_qty, parent_unit_id, label, source_type, source_id, source_doc_no)
  values (p_company_id, public.next_document_number(p_company_id, 'PHYSICAL_UNIT'), p_product_id, p_variant_id,
    p_warehouse_id, case when public.storage_locations_enabled(p_company_id) then p_location_id end,
    p_qty, 0, p_parent, nullif(trim(p_label), ''), p_source_type, p_source_id, p_doc_no)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.inv_new_unit(uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid, text) from public, anon, authenticated;

-- Inbound: roll items arrive as rolls (default: one roll for the whole quantity)
-- p_rolls: [ {qty, label} (new roll) | {unit_id, qty} (add back to an existing roll) ]
create or replace function public.inv_receive(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text, p_reason text,
  p_rolls jsonb default null, p_line_no int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_sum numeric := 0; v_unit uuid; v_q numeric;
begin
  if not public.inv_is_unit_tracked(p_product_id) then
    perform public.inv_move(p_company_id, p_date, p_type, p_warehouse_id, p_location_id,
      p_product_id, p_variant_id, p_qty, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
    return;
  end if;
  if p_rolls is null or jsonb_typeof(p_rolls) <> 'array' or jsonb_array_length(p_rolls) = 0 then
    p_rolls := jsonb_build_array(jsonb_build_object('qty', p_qty));
  end if;
  select coalesce(sum((x->>'qty')::numeric), 0) into v_sum from jsonb_array_elements(p_rolls) x;
  if v_sum <> p_qty then
    raise exception 'Line %: rolls add up to % but the quantity is %', coalesce(p_line_no::text, ''), v_sum::numeric(18,2), p_qty::numeric(18,2)
      using errcode = '23514';
  end if;
  for r in select * from jsonb_array_elements(p_rolls) loop
    v_q := (r->>'qty')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'Line %: each roll needs a length more than 0', coalesce(p_line_no::text, '') using errcode = '23514'; end if;
    v_unit := nullif(r->>'unit_id', '')::uuid;
    if v_unit is null then
      v_unit := public.inv_new_unit(p_company_id, p_warehouse_id, p_location_id, p_product_id, p_variant_id, v_q,
        null, r->>'label', p_source_type, p_source_id, p_doc_no);
    end if;
    perform public.inv_move(p_company_id, p_date, p_type, p_warehouse_id, p_location_id,
      p_product_id, p_variant_id, v_q, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason, null, v_unit);
  end loop;
end $$;
revoke execute on function public.inv_receive(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, jsonb, int) from public, anon, authenticated;

-- Outbound for roll items. p_cuts: [ {unit_id, qty} ] chosen by the user, or null = automatic:
-- stock not yet registered as rolls first, then the roll that leaves the least off-cut.
-- Returns what was taken: [ {unit_id|null, qty, whole} ]
create or replace function public.inv_issue_units(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text, p_reason text,
  p_cuts jsonb default null, p_line_no int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_left numeric := p_qty; v_out jsonb := '[]'::jsonb; c jsonb; u record; v_q numeric;
  v_total numeric; v_units numeric; v_free numeric; v_name text; v_sum numeric;
begin
  if p_qty <= 0 then raise exception 'issue quantity must be positive'; end if;
  perform 1 from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id for update;
  perform 1 from public.physical_units
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id for update;

  if p_cuts is not null and jsonb_typeof(p_cuts) = 'array' and jsonb_array_length(p_cuts) > 0 then
    select coalesce(sum((x->>'qty')::numeric), 0) into v_sum from jsonb_array_elements(p_cuts) x;
    if v_sum <> p_qty then
      raise exception 'Line %: cuts add up to % but the quantity is %', coalesce(p_line_no::text, ''), v_sum::numeric(18,2), p_qty::numeric(18,2)
        using errcode = '23514';
    end if;
    for c in select * from jsonb_array_elements(p_cuts) loop
      v_q := (c->>'qty')::numeric;
      if v_q is null or v_q <= 0 then continue; end if;
      select * into u from public.physical_units where id = nullif(c->>'unit_id','')::uuid;
      if u.id is null then raise exception 'Line %: roll not found', coalesce(p_line_no::text, '') using errcode = 'P0002'; end if;
      if u.warehouse_id <> p_warehouse_id then
        raise exception 'Roll % is not in this warehouse', u.unit_no using errcode = '22023';
      end if;
      perform public.inv_move(p_company_id, p_date, p_type, p_warehouse_id, u.location_id,
        p_product_id, p_variant_id, -v_q, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason, null, u.id);
      v_out := v_out || jsonb_build_array(jsonb_build_object('unit_id', u.id, 'qty', v_q, 'whole', v_q = u.remaining_qty, 'label', u.label));
    end loop;
  else
    select coalesce(sum(on_hand), 0) into v_total from public.stock_balances
     where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
    select coalesce(sum(remaining_qty), 0) into v_units from public.physical_units
     where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
    v_free := greatest(v_total - v_units, 0);
    if v_free > 0 then
      v_q := least(v_free, v_left);
      perform public.inv_move(p_company_id, p_date, p_type, p_warehouse_id, null,
        p_product_id, p_variant_id, -v_q, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
      v_out := v_out || jsonb_build_array(jsonb_build_object('unit_id', null, 'qty', v_q, 'whole', false));
      v_left := v_left - v_q;
    end if;
    while v_left > 0 loop
      -- best fit: the smallest roll that covers what is left; otherwise use up the largest roll
      select * into u from public.physical_units
       where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
         and remaining_qty >= v_left
       order by remaining_qty, created_at limit 1;
      if u.id is null then
        select * into u from public.physical_units
         where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
           and remaining_qty > 0
         order by remaining_qty desc, created_at limit 1;
      end if;
      exit when u.id is null;
      v_q := least(u.remaining_qty, v_left);
      perform public.inv_move(p_company_id, p_date, p_type, p_warehouse_id, u.location_id,
        p_product_id, p_variant_id, -v_q, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason, null, u.id);
      v_out := v_out || jsonb_build_array(jsonb_build_object('unit_id', u.id, 'qty', v_q, 'whole', v_q = u.remaining_qty, 'label', u.label));
      v_left := v_left - v_q;
    end loop;
    if v_left > 0 then
      if public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
        perform public.inv_move(p_company_id, p_date, p_type, p_warehouse_id, null,
          p_product_id, p_variant_id, -v_left, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
        v_out := v_out || jsonb_build_array(jsonb_build_object('unit_id', null, 'qty', v_left, 'whole', false));
      else
        select p.name || coalesce(' / ' || v.name, '') || ' @ ' || w.code into v_name
        from public.products p cross join public.warehouses w left join public.product_variants v on v.id = p_variant_id
        where p.id = p_product_id and w.id = p_warehouse_id;
        raise exception 'Insufficient stock for "%": only % available in this warehouse, % requested',
          v_name, (p_qty - v_left)::numeric(18,2), p_qty::numeric(18,2) using errcode = '23514';
      end if;
    end if;
  end if;
  perform public.inv_check_reserved(p_warehouse_id, p_product_id, p_variant_id);
  return v_out;
end $$;
revoke execute on function public.inv_issue_units(uuid, date, text, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, jsonb, int) from public, anon, authenticated;

create or replace function public.inv_issue_stock(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,      -- p_qty > 0 = quantity to take out
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_left numeric := p_qty; b record; v_take numeric; v_total numeric; v_name text;
begin
  if p_qty <= 0 then raise exception 'issue quantity must be positive'; end if;

  if public.inv_is_unit_tracked(p_product_id) then
    perform public.inv_issue_units(p_company_id, p_date, p_type, p_warehouse_id, p_product_id, p_variant_id, p_qty,
      p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason, null, null);
    return;
  end if;

  if p_location_id is not null then
    perform public.inv_apply_movement(p_company_id, p_date, p_type, p_warehouse_id, p_location_id,
      p_product_id, p_variant_id, -p_qty, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
    perform public.inv_check_reserved(p_warehouse_id, p_product_id, p_variant_id);
    return;
  end if;

  -- lock every balance row of this item in this warehouse, then check the warehouse total
  perform 1 from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
   for update;
  select coalesce(sum(on_hand), 0) into v_total from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  if v_total < p_qty and not public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
    select p.name || coalesce(' / ' || v.name, '') || ' @ ' || w.code into v_name
    from public.products p cross join public.warehouses w left join public.product_variants v on v.id = p_variant_id
    where p.id = p_product_id and w.id = p_warehouse_id;
    raise exception 'Insufficient stock for "%": only % available in this warehouse, % requested',
      v_name, v_total::numeric(18,2), p_qty::numeric(18,2) using errcode = '23514';
  end if;

  for b in select location_id, on_hand from public.stock_balances
           where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
             and on_hand > 0
           order by (location_id is not null), on_hand desc loop
    exit when v_left <= 0;
    v_take := least(v_left, b.on_hand);
    perform public.inv_apply_movement(p_company_id, p_date, p_type, p_warehouse_id, b.location_id,
      p_product_id, p_variant_id, -v_take, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then   -- only reachable when negative stock is allowed
    perform public.inv_apply_movement(p_company_id, p_date, p_type, p_warehouse_id, null,
      p_product_id, p_variant_id, -v_left, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
  end if;
  perform public.inv_check_reserved(p_warehouse_id, p_product_id, p_variant_id);
end $$;

revoke execute on function public.inv_issue_stock(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.post_stock_document(p_doc_type text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; l record; v_type text; v_count int := 0; v_plan jsonb; v_cuts jsonb; c jsonb; v_unit uuid;
begin
  select plan into v_plan from public.doc_unit_plans where doc_type = p_doc_type and doc_id = p_id;
  v_plan := coalesce(v_plan, '{}'::jsonb);

  if p_doc_type = 'GOODS_RECEIPT' then
    select * into h from public.goods_receipts where id = p_id for update;
    if h.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
    perform public.inv_require(h.company_id, 'inventory.receive');
    if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
    if h.status <> 'DRAFT' then raise exception 'Cannot post a % receipt', h.status using errcode = '22023'; end if;
    perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
    for l in select * from public.goods_receipt_lines where receipt_id = p_id order by product_id, variant_id, location_id loop
      perform public.inv_validate_line(h.company_id, h.warehouse_id, l.product_id, l.variant_id, l.location_id, l.quantity, l.line_no);
      perform public.inv_receive(h.company_id, h.doc_date, 'PURCHASE_RECEIPT', h.warehouse_id, l.location_id,
        l.product_id, l.variant_id, l.quantity, 'GOODS_RECEIPT', h.id, l.id, h.doc_no, null, v_plan->(l.line_no::text), l.line_no);
      v_count := v_count + 1;
    end loop;
    update public.goods_receipts set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;

  elsif p_doc_type = 'STOCK_TRANSFER' then
    select * into h from public.stock_transfers where id = p_id for update;
    if h.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
    perform public.inv_require(h.company_id, 'inventory.transfer');
    if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
    if h.status <> 'DRAFT' then raise exception 'Cannot post a % transfer', h.status using errcode = '22023'; end if;
    perform public.inv_check_warehouse(h.company_id, h.from_warehouse_id);
    perform public.inv_check_warehouse(h.company_id, h.to_warehouse_id);
    for l in select * from public.stock_transfer_lines where transfer_id = p_id order by product_id, variant_id loop
      if public.inv_is_unit_tracked(l.product_id) then
        v_cuts := public.inv_issue_units(h.company_id, h.doc_date, 'TRANSFER_OUT', h.from_warehouse_id,
          l.product_id, l.variant_id, l.quantity, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null, v_plan->(l.line_no::text), l.line_no);
        for c in select * from jsonb_array_elements(v_cuts) loop
          v_unit := nullif(c->>'unit_id','')::uuid;
          if v_unit is not null and not (c->>'whole')::boolean then
            -- a cut piece becomes a new roll at the destination, linked to its parent roll
            v_unit := public.inv_new_unit(h.company_id, h.to_warehouse_id, l.to_location_id, l.product_id, l.variant_id,
              (c->>'qty')::numeric, v_unit, c->>'label', 'STOCK_TRANSFER', h.id, h.doc_no);
          end if;
          perform public.inv_move(h.company_id, h.doc_date, 'TRANSFER_IN', h.to_warehouse_id, l.to_location_id,
            l.product_id, l.variant_id, (c->>'qty')::numeric, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null, null, v_unit);
        end loop;
      else
        perform public.inv_issue_stock(h.company_id, h.doc_date, 'TRANSFER_OUT', h.from_warehouse_id, l.from_location_id,
          l.product_id, l.variant_id, l.quantity, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null);
        perform public.inv_move(h.company_id, h.doc_date, 'TRANSFER_IN', h.to_warehouse_id, l.to_location_id,
          l.product_id, l.variant_id, l.quantity, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null);
      end if;
      v_count := v_count + 1;
    end loop;
    update public.stock_transfers set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;

  elsif p_doc_type = 'STOCK_ADJUSTMENT' then
    select * into h from public.stock_adjustments where id = p_id for update;
    if h.id is null then raise exception 'Adjustment not found' using errcode = 'P0002'; end if;
    perform public.inv_require(h.company_id, 'inventory.post');
    if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
    if h.status <> 'DRAFT' then raise exception 'Cannot post a % adjustment', h.status using errcode = '22023'; end if;
    perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
    v_type := case h.reason when 'OPENING_BALANCE' then 'OPENING' when 'DAMAGE' then 'DAMAGE' else 'ADJUSTMENT' end;
    if h.entry_mode = 'SET' then perform public.inv_refresh_set_lines(p_id); end if;
    for l in select * from public.stock_adjustment_lines where adjustment_id = p_id and quantity <> 0 order by product_id, variant_id, location_id loop
      perform public.inv_validate_line(h.company_id, h.warehouse_id, l.product_id, l.variant_id, l.location_id, l.quantity, l.line_no);
      if l.quantity < 0 then
        if public.inv_is_unit_tracked(l.product_id) then
          perform public.inv_issue_units(h.company_id, h.doc_date, v_type, h.warehouse_id, l.product_id, l.variant_id,
            -l.quantity, 'STOCK_ADJUSTMENT', h.id, l.id, h.doc_no, h.reason, v_plan->(l.line_no::text), l.line_no);
        else
          perform public.inv_issue_stock(h.company_id, h.doc_date, v_type, h.warehouse_id, l.location_id,
            l.product_id, l.variant_id, -l.quantity, 'STOCK_ADJUSTMENT', h.id, l.id, h.doc_no, h.reason);
        end if;
      else
        perform public.inv_receive(h.company_id, h.doc_date, v_type, h.warehouse_id, l.location_id,
          l.product_id, l.variant_id, l.quantity, 'STOCK_ADJUSTMENT', h.id, l.id, h.doc_no, h.reason, v_plan->(l.line_no::text), l.line_no);
      end if;
      v_count := v_count + 1;
    end loop;
    update public.stock_adjustments set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;
  else
    raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end if;

  return jsonb_build_object('status','POSTED','lines', v_count);
end $$;

-- "Enter new quantity" can't say which roll changed: roll items use Add / remove (or Inventory → Rolls)
create or replace function public.inv_refresh_set_lines(p_adjustment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; l record; v_cur numeric; v_name text;
begin
  select * into h from public.stock_adjustments where id = p_adjustment_id;
  for l in select * from public.stock_adjustment_lines
           where adjustment_id = p_adjustment_id and target_qty is not null
           order by product_id, variant_id, location_id loop
    if public.inv_is_unit_tracked(l.product_id) then
      select name into v_name from public.products where id = l.product_id;
      raise exception 'Line %: "%" is tracked by roll. Use "Add / remove" and pick the roll, or correct the roll on Inventory → Rolls.',
        l.line_no, v_name using errcode = '22023';
    end if;
    perform 1 from public.stock_balances
     where warehouse_id = h.warehouse_id and product_id = l.product_id and variant_id is not distinct from l.variant_id
     for update;
    v_cur := public.inv_item_on_hand(h.warehouse_id, l.location_id, l.product_id, l.variant_id);
    if h.reason = 'OPENING_BALANCE' and l.target_qty < v_cur then
      raise exception 'Line %: opening stock can only add stock — % already in stock. Use reason "Count correction" to reduce it.',
        l.line_no, v_cur::numeric(18,2) using errcode = '23514';
    end if;
    update public.stock_adjustment_lines set system_qty = v_cur, quantity = l.target_qty - v_cur where id = l.id;
  end loop;
end $$;
revoke execute on function public.inv_refresh_set_lines(uuid) from public, anon, authenticated;

create or replace function public.post_stock_count(p_count_id uuid, p_line_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; l record; v_before numeric; v_adj numeric; v_posted int := 0; v_changed int := 0;
begin
  select * into h from public.stock_counts where id = p_count_id for update;
  if h.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.post');
  perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
  if h.status <> 'OPEN' then raise exception 'This count is %', h.status using errcode = '22023'; end if;

  for l in select * from public.stock_count_lines
           where count_id = p_count_id and status = 'COUNTED'
             and (p_line_ids is null or id = any(p_line_ids))
           order by product_id, variant_id, location_id
           for update loop
    select on_hand into v_before from public.stock_balances
     where warehouse_id = h.warehouse_id and location_id is not distinct from l.location_id
       and product_id = l.product_id and variant_id is not distinct from l.variant_id
     for update;
    v_before := coalesce(v_before, 0);
    v_adj := l.counted_qty - v_before;
    if v_adj < 0 and public.inv_is_unit_tracked(l.product_id) then
      -- shortage on a roll item: taken from the rolls automatically (correct single rolls on Inventory → Rolls)
      perform public.inv_issue_units(h.company_id, current_date, 'ADJUSTMENT', h.warehouse_id, l.product_id, l.variant_id,
        -v_adj, 'STOCK_COUNT', h.id, l.id, h.doc_no, h.count_type, null, null);
      v_changed := v_changed + 1;
    elsif v_adj <> 0 then
      perform public.inv_move(h.company_id, current_date, 'ADJUSTMENT', h.warehouse_id, l.location_id,
        l.product_id, l.variant_id, v_adj, 'STOCK_COUNT', h.id, l.id, h.doc_no, h.count_type);
      v_changed := v_changed + 1;
    end if;
    update public.stock_count_lines set status = 'POSTED', system_qty_before = v_before, adjustment_qty = v_adj,
      system_qty_after = l.counted_qty, posted_by = auth.uid(), posted_at = now()
    where id = l.id;
    v_posted := v_posted + 1;
  end loop;
  return jsonb_build_object('posted_lines', v_posted, 'adjusted_lines', v_changed);
end $$;

create or replace function public.reverse_stock_document(p_doc_type text, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_status text; v_table text; v_doc text; m record; v_count int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reverse a posted document' using errcode = '23502';
  end if;
  case p_doc_type
    when 'GOODS_RECEIPT' then v_table := 'goods_receipts';
    when 'STOCK_TRANSFER' then v_table := 'stock_transfers';
    when 'STOCK_ADJUSTMENT' then v_table := 'stock_adjustments';
    else raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end case;
  execute format('select company_id, status, doc_no from public.%I where id = $1 for update', v_table)
    into v_company, v_status, v_doc using p_id;
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform public.inv_require(v_company, 'inventory.post');
  if v_status = 'REVERSED' then return jsonb_build_object('status','REVERSED','already',true); end if;
  if v_status <> 'POSTED' then raise exception 'Only posted documents can be reversed' using errcode = '22023'; end if;

  -- inbound legs first so a transfer reversal never dips the source negative; rolls are restored too
  for m in select * from public.stock_movements
           where source_type = p_doc_type and source_id = p_id and reversal_of is null
           order by (quantity < 0), product_id, variant_id, created_at loop
    perform public.inv_move(m.company_id, current_date, m.movement_type, m.warehouse_id, m.location_id,
      m.product_id, m.variant_id, -m.quantity, p_doc_type, p_id, m.source_line_id, v_doc,
      'REVERSAL: ' || p_reason, m.id, m.physical_unit_id);
    v_count := v_count + 1;
  end loop;

  execute format('update public.%I set status = ''REVERSED'', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = $2 where id = $1', v_table)
    using p_id, p_reason;
  return jsonb_build_object('status','REVERSED','movements', v_count);
end $$;

create or replace function public.reverse_assembly_order(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; m record; v_count int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reverse a posted document' using errcode = '23502';
  end if;
  select * into h from public.assembly_orders where id = p_id for update;
  if h.id is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.post');
  if h.status = 'REVERSED' then return jsonb_build_object('status','REVERSED','already',true); end if;
  if h.status <> 'POSTED' then raise exception 'Only posted orders can be reversed' using errcode = '22023'; end if;
  for m in select * from public.stock_movements
           where source_type = 'ASSEMBLY_ORDER' and source_id = p_id and reversal_of is null
           order by (quantity < 0), product_id, variant_id, created_at loop
    perform public.inv_move(m.company_id, current_date, m.movement_type, m.warehouse_id, m.location_id,
      m.product_id, m.variant_id, -m.quantity, 'ASSEMBLY_ORDER', p_id, m.source_line_id, h.doc_no,
      'REVERSAL: ' || p_reason, m.id, m.physical_unit_id);
    v_count := v_count + 1;
  end loop;
  update public.assembly_orders set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason
   where id = p_id;
  return jsonb_build_object('status','REVERSED','movements', v_count);
end $$;

create or replace function public.post_assembly_order(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; l jsonb; n int := 0; v_line uuid; v_in text; v_out text;
begin
  select * into h from public.assembly_orders where id = p_id for update;
  if h.id is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.assemble');
  if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % order', h.status using errcode = '22023'; end if;
  perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
  perform public.inv_validate_line(h.company_id, h.warehouse_id, h.product_id, h.variant_id, null, h.quantity, 0);

  if h.kind = 'ASSEMBLY' then v_out := 'ASSEMBLY_OUT'; v_in := 'ASSEMBLY_IN';
  else v_out := 'DISASSEMBLY_OUT'; v_in := 'DISASSEMBLY_IN'; end if;

  if h.kind = 'DISASSEMBLY' then
    perform public.inv_issue_stock(h.company_id, h.doc_date, v_out, h.warehouse_id, null,
      h.product_id, h.variant_id, h.quantity, 'ASSEMBLY_ORDER', h.id, null, h.doc_no, 'Disassembly');
  end if;

  for l in select * from jsonb_array_elements(h.components) loop
    n := n + 1;
    insert into public.assembly_order_lines(company_id, order_id, line_no, product_id, variant_id, quantity)
    values (h.company_id, h.id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric)
    returning id into v_line;
    perform public.inv_validate_line(h.company_id, h.warehouse_id, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
      null, (l->>'quantity')::numeric, n);
    if h.kind = 'ASSEMBLY' then
      if public.inv_is_unit_tracked((l->>'product_id')::uuid) then
        perform public.inv_issue_units(h.company_id, h.doc_date, v_out, h.warehouse_id,
          (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric,
          'ASSEMBLY_ORDER', h.id, v_line, h.doc_no, 'Used in assembly', l->'units', n);
      else
        perform public.inv_issue_stock(h.company_id, h.doc_date, v_out, h.warehouse_id, null,
          (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric,
          'ASSEMBLY_ORDER', h.id, v_line, h.doc_no, 'Used in assembly');
      end if;
    else
      perform public.inv_receive(h.company_id, h.doc_date, v_in, h.warehouse_id, null,
        (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric,
        'ASSEMBLY_ORDER', h.id, v_line, h.doc_no, 'Recovered from disassembly', l->'units', n);
    end if;
  end loop;
  if n = 0 then raise exception 'No components on this order' using errcode = '23502'; end if;

  if h.kind = 'ASSEMBLY' then
    perform public.inv_receive(h.company_id, h.doc_date, v_in, h.warehouse_id, null,
      h.product_id, h.variant_id, h.quantity, 'ASSEMBLY_ORDER', h.id, null, h.doc_no, 'Assembled', null, null);
  end if;

  update public.assembly_orders set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;
  return jsonb_build_object('status','POSTED','components', n);
end $$;

-- Roll details for a draft receipt / transfer / adjustment (one row per document, replaced on save)
create or replace function public.save_unit_plan(p_doc_type text, p_doc_id uuid, p_plan jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_status text; v_table text; v_perm text;
begin
  case p_doc_type
    when 'GOODS_RECEIPT' then v_table := 'goods_receipts'; v_perm := 'inventory.receive';
    when 'STOCK_TRANSFER' then v_table := 'stock_transfers'; v_perm := 'inventory.transfer';
    when 'STOCK_ADJUSTMENT' then v_table := 'stock_adjustments'; v_perm := 'inventory.adjust';
    else raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end case;
  execute format('select company_id, status from public.%I where id = $1', v_table) into v_company, v_status using p_doc_id;
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform public.inv_require(v_company, v_perm);
  if v_status <> 'DRAFT' then raise exception 'Only drafts can be changed' using errcode = '22023'; end if;
  insert into public.doc_unit_plans(doc_type, doc_id, company_id, plan, updated_at, updated_by)
  values (p_doc_type, p_doc_id, v_company, coalesce(p_plan, '{}'::jsonb), now(), auth.uid())
  on conflict (doc_type, doc_id) do update set plan = excluded.plan, updated_at = now(), updated_by = auth.uid();
end $$;
revoke execute on function public.save_unit_plan(text, uuid, jsonb) from public, anon;
grant execute on function public.save_unit_plan(text, uuid, jsonb) to authenticated;

-- Register stock already on hand as rolls (no stock change: it splits existing stock into rolls)
create or replace function public.register_units(p_company_id uuid, p_warehouse_id uuid, p_product_id uuid,
  p_variant_id uuid, p_rolls jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_total numeric; v_units numeric; v_sum numeric; r jsonb; n int := 0; v_name text;
begin
  perform public.inv_require(p_company_id, 'inventory.adjust');
  perform public.inv_check_warehouse(p_company_id, p_warehouse_id);
  select name into v_name from public.products where id = p_product_id and company_id = p_company_id;
  if v_name is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if not public.inv_is_unit_tracked(p_product_id) then
    raise exception '"%" is not tracked by roll. Set Tracking to "Physical units / rolls" on the product first.', v_name using errcode = '22023';
  end if;
  perform public.inv_validate_line(p_company_id, p_warehouse_id, p_product_id, p_variant_id, null, 1, 0);
  perform 1 from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id for update;
  select coalesce(sum(on_hand), 0) into v_total from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  select coalesce(sum(remaining_qty), 0) into v_units from public.physical_units
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  select coalesce(sum((x->>'qty')::numeric), 0) into v_sum from jsonb_array_elements(coalesce(p_rolls, '[]'::jsonb)) x;
  if v_sum <= 0 then raise exception 'Enter at least one roll length' using errcode = '23502'; end if;
  if v_sum > v_total - v_units then
    raise exception 'Only % of "%" is not yet in rolls here, but the rolls add up to %',
      (v_total - v_units)::numeric(18,2), v_name, v_sum::numeric(18,2) using errcode = '23514';
  end if;
  for r in select * from jsonb_array_elements(p_rolls) loop
    if coalesce((r->>'qty')::numeric, 0) <= 0 then continue; end if;
    insert into public.physical_units(company_id, unit_no, product_id, variant_id, warehouse_id,
      original_qty, remaining_qty, label, source_type, last_movement_at)
    values (p_company_id, public.next_document_number(p_company_id, 'PHYSICAL_UNIT'), p_product_id, p_variant_id, p_warehouse_id,
      (r->>'qty')::numeric, (r->>'qty')::numeric, nullif(trim(r->>'label'), ''), 'REGISTERED', now());
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.register_units(uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.register_units(uuid, uuid, uuid, uuid, jsonb) to authenticated;

-- Correct one roll's remaining length (measured / damaged off-cut): posts a stock adjustment for that roll
create or replace function public.correct_unit_length(p_unit_id uuid, p_new_remaining numeric, p_reason text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u record; v_diff numeric; v_adj uuid;
begin
  select * into u from public.physical_units where id = p_unit_id;
  if u.id is null then raise exception 'Roll not found' using errcode = 'P0002'; end if;
  if p_new_remaining is null or p_new_remaining < 0 then raise exception 'Length cannot be negative' using errcode = '23514'; end if;
  v_diff := p_new_remaining - u.remaining_qty;
  if v_diff = 0 then raise exception 'The length is unchanged' using errcode = '22023'; end if;
  v_adj := public.save_stock_adjustment(null,
    jsonb_build_object('company_id', u.company_id, 'warehouse_id', u.warehouse_id,
      'reason', coalesce(nullif(p_reason,''), 'COUNT_CORRECTION'), 'entry_mode', 'CHANGE',
      'reference', u.unit_no, 'notes', coalesce(nullif(trim(p_note),''), 'Roll ' || u.unit_no || ' corrected to ' || p_new_remaining)),
    jsonb_build_array(jsonb_build_object('product_id', u.product_id, 'variant_id', u.variant_id, 'quantity', v_diff)));
  perform public.save_unit_plan('STOCK_ADJUSTMENT', v_adj,
    jsonb_build_object('1', jsonb_build_array(jsonb_build_object('unit_id', u.id, 'qty', abs(v_diff)))));
  perform public.post_stock_document('STOCK_ADJUSTMENT', v_adj);
  return v_adj;
end $$;
revoke execute on function public.correct_unit_length(uuid, numeric, text, text) from public, anon;
grant execute on function public.correct_unit_length(uuid, numeric, text, text) to authenticated;

-- stock_ledger also exposes the document line (to show which rolls each line used)
create or replace view public.stock_ledger with (security_invoker = true) as
select m.id, m.company_id, m.movement_date, m.created_at, m.movement_type,
       m.warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
       m.location_id, l.code as location_code,
       m.product_id, p.sku, p.name as product_name, m.variant_id, v.name as variant_name,
       m.quantity, m.source_type, m.source_id, m.source_doc_no, m.reason, m.reversal_of, m.created_by,
       sum(m.quantity) over (partition by m.warehouse_id, m.product_id, m.variant_id
                             order by m.created_at, m.id rows unbounded preceding) as balance_after,
       m.physical_unit_id, u.unit_no, m.source_line_id
from public.stock_movements m
join public.warehouses w on w.id = m.warehouse_id
join public.products p on p.id = m.product_id
left join public.product_variants v on v.id = m.variant_id
left join public.warehouse_locations l on l.id = m.location_id
left join public.physical_units u on u.id = m.physical_unit_id;

-- list filter: rolls in stock vs used up
alter table public.physical_units add column in_stock boolean generated always as (remaining_qty > 0) stored;
create index physical_units_list_idx on public.physical_units(company_id, in_stock, created_at desc);
