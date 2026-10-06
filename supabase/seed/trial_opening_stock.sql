-- =====================================================================
-- TRIAL DATA — opening stock (both warehouses) with cost, plus opening
-- cash & bank balances, so transactions can be tested.
-- Runs through the real posting engine as the first Administrator.
-- Safe to re-run: stops if any stock already exists.
-- Settings → Trial data (RESET JST) clears all of this again.
-- =====================================================================
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id
                            where r.code = 'ADMINISTRATOR' order by ur.created_at limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  c uuid; wh1 uuid; wh2 uuid; a1 uuid; a2 uuid; b1 uuid; doc uuid; je uuid;
  d date := date '2026-10-01';
  -- name, variant, location, qty, unit cost (PKR)
  wh1_items text[][] := array[
    ['Nipple Drinker 360°','', 'S-A1','5000','85'],
    ['Drinker Line Pipe 22mm','', 'S-B1','1500','320'],
    ['Exhaust Fan','50 inch','S-B1','40','38000'],
    ['Exhaust Fan','36 inch','S-B1','25','27500'],
    ['Cooling Pad 7090','1.5m height','S-B1','300','2400'],
    ['Cooling Pad 7090','1.8m height','S-B1','200','2850'],
    ['Feed Pipe 45mm','', 'S-B1','900','650'],
    ['Pipe Clamp 45mm','', 'S-A2','1500','45'],
    ['Water Pressure Regulator','', 'S-A2','60','3200'],
    ['Layer Cage A-Type','3-tier 96 birds','S-B1','12','95000'],
    ['Layer Cage A-Type','4-tier 128 birds','S-B1','8','125000'],
    ['Feeder Line Motor 0.75kW','', 'S-A2','18','24000'],
    ['Winch Cable 4mm','', 'S-A2','30','4500'],
    ['Feed Pan','China','S-A1','2000','210'],
    ['Feed Pan','Local','S-A1','1500','140'],
    ['Auger 45mm','', 'S-B1','3000','95'],
    ['Gas Brooder Heater','', 'S-A2','20','14500'],
    ['Cooler Body','', 'S-B1','25','18000'],
    ['Cooler LCD','', 'S-A2','40','2200'],
    ['Cooler Pad 5090','', 'S-B1','150','1900'],
    ['Cooler Panel','', 'S-A2','40','1500'],
    ['Cooler Float Valve','', 'S-A2','60','450'],
    ['Cooler Water Pump','', 'S-A2','40','2800'],
    ['Cooler Drain Pump','', 'S-A2','30','1800'],
    ['White Cooler Top China 1.5kw','', 'S-B1','25','6500'],
    ['Coolmax Air Cooler 1.5 Kw Top Discharge','', 'S-B1','10','85000'],
    ['Feeding Line Complete','', 'S-B1','4','380000']];
  wh2_items text[][] := array[
    ['Nipple Drinker 360°','', '','800','85'],
    ['Gas Brooder Heater','', '','10','14500'],
    ['Pipe Clamp 45mm','', '','200','45'],
    ['Exhaust Fan','50 inch','','5','38000'],
    ['Feed Pan','China','','300','210']];
  i int; lines jsonb; costs jsonb := '[]'; p uuid; v uuid; loc uuid;
begin
  select id into c from public.companies where code = 'JST';
  if exists (select 1 from public.stock_balances where company_id = c and on_hand <> 0) then
    raise notice 'Stock already exists — nothing loaded'; return;
  end if;
  select id into wh1 from public.warehouses where company_id = c and code = 'WH-01';
  select id into wh2 from public.warehouses where company_id = c and code = 'WH-02';

  -- WH-01
  lines := '[]';
  for i in 1 .. array_length(wh1_items, 1) loop
    select id into p from public.products where company_id = c and name = wh1_items[i][1];
    select id into v from public.product_variants where product_id = p and name = wh1_items[i][2];
    select id into loc from public.warehouse_locations where warehouse_id = wh1 and code = wh1_items[i][3];
    if p is null then raise exception 'Product not found: %', wh1_items[i][1]; end if;
    lines := lines || jsonb_build_object('product_id', p, 'variant_id', v, 'location_id', loc, 'quantity', wh1_items[i][4]::numeric);
    costs := costs || jsonb_build_object('product_id', p, 'variant_id', v, 'unit_cost', wh1_items[i][5]::numeric);
  end loop;
  doc := public.save_stock_adjustment(null, jsonb_build_object('company_id', c, 'warehouse_id', wh1, 'reason', 'OPENING_BALANCE',
           'doc_date', d, 'reference', 'Opening stock — trial', 'notes', 'Trial opening stock'), lines);
  perform public.post_stock_document('STOCK_ADJUSTMENT', doc);

  -- WH-02
  lines := '[]';
  for i in 1 .. array_length(wh2_items, 1) loop
    select id into p from public.products where company_id = c and name = wh2_items[i][1];
    select id into v from public.product_variants where product_id = p and name = wh2_items[i][2];
    lines := lines || jsonb_build_object('product_id', p, 'variant_id', v, 'quantity', wh2_items[i][4]::numeric);
  end loop;
  doc := public.save_stock_adjustment(null, jsonb_build_object('company_id', c, 'warehouse_id', wh2, 'reason', 'OPENING_BALANCE',
           'doc_date', d, 'reference', 'Opening stock — trial', 'notes', 'Trial opening stock'), lines);
  perform public.post_stock_document('STOCK_ADJUSTMENT', doc);

  -- opening cost must run in a separate statement (item cost rows are
  -- updated after this statement finishes) — saved for the block below
  perform set_config('jst.opening_costs', costs::text, true);

  -- opening cash & bank (Dr Cash/Bank / Cr Opening Balance Equity)
  je := public.save_journal_entry(null, jsonb_build_object('company_id', c, 'entry_type', 'OPENING', 'entry_date', d,
          'memo', 'Opening cash & bank balances — trial'),
        jsonb_build_array(
          jsonb_build_object('account_id', (select id from public.chart_of_accounts where company_id = c and code = '1110'), 'debit', 500000, 'description', 'Cash in hand'),
          jsonb_build_object('account_id', (select id from public.chart_of_accounts where company_id = c and code = '1120'), 'debit', 2500000, 'description', 'Meezan current'),
          jsonb_build_object('account_id', (select id from public.chart_of_accounts where company_id = c and code = '3300'), 'credit', 3000000, 'description', 'Opening balances')));
  perform public.post_journal_entry(je);
end $$;

-- opening cost (Dr Inventory / Cr Opening Balance Equity)
do $$
declare c uuid;
begin
  select id into c from public.companies where code = 'JST';
  if nullif(current_setting('jst.opening_costs', true), '') is not null then
    perform public.set_opening_stock_cost(c, date '2026-10-01', current_setting('jst.opening_costs')::jsonb, 'Opening stock value — trial');
  end if;
end $$;
commit;
