-- Negative stock on roll items: once every roll is used up (or none are registered yet), a dispatch may take the item
-- below zero when negative stock is allowed. The "choose the roll" guard now only protects stock that really sits in rolls.
-- (Before, a roll item with no rolls always failed with "This item is tracked by roll — choose the roll(s) to cut from".)

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
    -- no rolls left (e.g. negative stock allowed and every roll used up): nothing to protect
    if v_units > 0 and v_total < v_units then
      raise exception 'This item is tracked by roll — choose the roll(s) to cut from' using errcode = '23514';
    end if;
  end if;
  return v_after;
end $$;
revoke execute on function public.inv_move(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
