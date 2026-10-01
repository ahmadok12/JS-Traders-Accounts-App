-- =====================================================================
-- JS Traders ERP — Storage locations (racks / shelves) as an optional feature
-- ---------------------------------------------------------------------
-- Setting: system_settings key 'inventory.storage_locations' (jsonb bool).
-- Missing row = OFF. While OFF:
--   * every stock movement is posted at warehouse level (location forced null)
--   * document lines never store a location
-- Turning OFF moves any stock currently held in locations to the warehouse's
-- unassigned stock (logged as TRANSFER_OUT/IN movements, source
-- 'LOCATION_SETTING', so the ledger stays append-only and auditable).
-- Turning ON later just lets users pick locations again.
-- =====================================================================

create or replace function public.storage_locations_enabled(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.system_settings s
                    where s.company_id = p_company_id and s.key = 'inventory.storage_locations'), false);
$$;
grant execute on function public.storage_locations_enabled(uuid) to authenticated;

-- Movement engine: force warehouse-level posting while locations are OFF
create or replace function public.inv_apply_movement(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text,
  p_reason text, p_reversal_of uuid default null)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_after numeric; v_name text;
begin
  if p_location_id is not null and p_source_type <> 'LOCATION_SETTING'
     and not public.storage_locations_enabled(p_company_id) then
    p_location_id := null;
  end if;

  insert into public.stock_movements(company_id, movement_date, movement_type, warehouse_id, location_id,
    product_id, variant_id, quantity, source_type, source_id, source_line_id, source_doc_no, reason,
    reversal_of, created_by)
  values (p_company_id, coalesce(p_date, current_date), p_type, p_warehouse_id, p_location_id,
    p_product_id, p_variant_id, p_qty, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason,
    p_reversal_of, auth.uid());

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
  return v_after;
end $$;
revoke execute on function public.inv_apply_movement(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- Document lines: strip locations while OFF
create or replace function public.tg_strip_locations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.storage_locations_enabled(new.company_id) then return new; end if;
  if tg_table_name = 'stock_transfer_lines' then
    new.from_location_id := null; new.to_location_id := null;
  else
    new.location_id := null;
  end if;
  return new;
end $$;
revoke execute on function public.tg_strip_locations() from public, anon, authenticated;

create trigger strip_locations before insert or update on public.goods_receipt_lines     for each row execute function public.tg_strip_locations();
create trigger strip_locations before insert or update on public.stock_transfer_lines    for each row execute function public.tg_strip_locations();
create trigger strip_locations before insert or update on public.stock_adjustment_lines  for each row execute function public.tg_strip_locations();
create trigger strip_locations before insert or update on public.stock_count_lines       for each row execute function public.tg_strip_locations();

-- Turn the feature on / off (Settings → Inventory)
create or replace function public.set_storage_locations_enabled(p_company_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b record; v_moved int := 0; v_ref uuid := gen_random_uuid();
begin
  if not public.has_permission(p_company_id, 'settings.manage') then
    raise exception 'You do not have permission to change settings' using errcode = '42501';
  end if;

  insert into public.system_settings(company_id, key, value, description)
  values (p_company_id, 'inventory.storage_locations', to_jsonb(p_enabled),
          'Track stock by storage location (rack / shelf) inside warehouses')
  on conflict (company_id, key) do update set value = excluded.value;

  if not p_enabled then
    -- open stock counts: one item counted in two racks can't be merged automatically
    if exists (select 1 from public.stock_counts c join public.stock_count_lines l on l.count_id = c.id
               where c.company_id = p_company_id and c.status = 'OPEN'
               group by l.count_id, l.product_id, l.variant_id
               having count(*) > 1 and bool_or(l.location_id is not null and l.status <> 'POSTED')) then
      raise exception 'An open stock count has the same item counted in more than one location. Post or cancel that count before turning locations off'
        using errcode = '22023';
    end if;
    update public.stock_count_lines l set location_id = null from public.stock_counts c
     where c.id = l.count_id and c.company_id = p_company_id and c.status = 'OPEN'
       and l.status <> 'POSTED' and l.location_id is not null;
    -- consolidate location stock into unassigned warehouse stock
    for b in select * from public.stock_balances
             where company_id = p_company_id and location_id is not null and on_hand <> 0
             order by warehouse_id, product_id, variant_id
             for update loop
      perform public.inv_apply_movement(p_company_id, current_date, 'TRANSFER_OUT', b.warehouse_id, b.location_id,
        b.product_id, b.variant_id, -b.on_hand, 'LOCATION_SETTING', v_ref, null, null,
        'Storage locations turned off: moved to unassigned stock');
      perform public.inv_apply_movement(p_company_id, current_date, 'TRANSFER_IN', b.warehouse_id, null,
        b.product_id, b.variant_id, b.on_hand, 'LOCATION_SETTING', v_ref, null, null,
        'Storage locations turned off: moved to unassigned stock');
      v_moved := v_moved + 1;
    end loop;
    -- draft documents: clear locations (posted history is left as it was)
    update public.goods_receipt_lines l set location_id = null from public.goods_receipts h
     where h.id = l.receipt_id and h.status = 'DRAFT' and l.company_id = p_company_id and l.location_id is not null;
    update public.stock_adjustment_lines l set location_id = null from public.stock_adjustments h
     where h.id = l.adjustment_id and h.status = 'DRAFT' and l.company_id = p_company_id and l.location_id is not null;
    update public.stock_transfer_lines l set from_location_id = null, to_location_id = null from public.stock_transfers h
     where h.id = l.transfer_id and h.status = 'DRAFT' and l.company_id = p_company_id
       and (l.from_location_id is not null or l.to_location_id is not null);
  end if;
  return jsonb_build_object('enabled', p_enabled, 'balances_moved', v_moved);
end $$;
revoke execute on function public.set_storage_locations_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_storage_locations_enabled(uuid, boolean) to authenticated;
