-- =====================================================================
-- DEV ONLY — Sample data loader for JS Traders ERP (test environment)
-- Every record is tagged "[sample]" so reset_sample_data.sql can remove
-- ONLY sample data and leave anything you typed in yourself.
-- Runs as the first Administrator so numbering, audit and RPC checks apply.
-- Safe to re-run: it stops if sample data already exists.
-- =====================================================================
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id
                            where r.code = 'ADMINISTRATOR' order by ur.created_at limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  c uuid; wh1 uuid; wh2 uuid; pcs uuid; mtr uuid; kg uuid; setu uuid; roll uuid;
  cat_feed uuid; cat_drink uuid; cat_vent uuid; cat_heat uuid; cat_cage uuid; cat_spare uuid;
  g1 uuid; g2 uuid;
  p_nip uuid; p_line uuid; p_fan uuid; p_pad uuid; p_heat uuid; p_pipe uuid; p_clamp uuid; p_reg uuid; p_cage uuid; p_motor uuid; p_cable uuid;
  v_fan50 uuid; v_fan36 uuid; v_cage3 uuid; v_cage4 uuid; v_pad6 uuid; v_pad8 uuid;
  loc_a1 uuid; loc_a2 uuid; loc_b1 uuid;
  s_cn1 uuid; s_cn2 uuid; s_local uuid;
  ag1 uuid; ag2 uuid; gl_bank uuid;
  doc uuid; cnt uuid;
begin
  select id into c from public.companies where code = 'JST';
  if exists (select 1 from public.customers where company_id = c and notes like '[sample]%') then
    raise notice 'Sample data already loaded — nothing to do';
    return;
  end if;

  -- units & categories (seeded by migrations)
  select id into pcs  from public.units_of_measure where company_id = c and code = 'PCS';
  select id into mtr  from public.units_of_measure where company_id = c and code = 'MTR';
  select id into kg   from public.units_of_measure where company_id = c and code = 'KG';
  select id into setu from public.units_of_measure where company_id = c and code = 'SET';
  select id into roll from public.units_of_measure where company_id = c and code = 'ROLL';
  select id into cat_feed  from public.product_categories where company_id = c and code = 'FEED';
  select id into cat_drink from public.product_categories where company_id = c and code = 'DRINK';
  select id into cat_vent  from public.product_categories where company_id = c and code = 'VENT';
  select id into cat_heat  from public.product_categories where company_id = c and code = 'HEAT';
  select id into cat_cage  from public.product_categories where company_id = c and code = 'CAGE';
  select id into cat_spare from public.product_categories where company_id = c and code = 'SPARE';

  -- warehouses: use your existing two (WH-01, WH-02); create them if missing
  select id into wh1 from public.warehouses where company_id = c and code = 'WH-01';
  select id into wh2 from public.warehouses where company_id = c and code = 'WH-02';
  if wh1 is null then insert into public.warehouses(company_id, name, address) values (c, 'Okara Main Warehouse [sample]', 'Depalpur Road, Okara') returning id into wh1; end if;
  if wh2 is null then insert into public.warehouses(company_id, name, address) values (c, 'Sahiwal Store [sample]', 'Sahiwal') returning id into wh2; end if;
  insert into public.warehouse_locations(company_id, warehouse_id, code, name) values (c, wh1, 'S-A1', 'Rack A shelf 1 [sample]') returning id into loc_a1;
  insert into public.warehouse_locations(company_id, warehouse_id, code, name) values (c, wh1, 'S-A2', 'Rack A shelf 2 [sample]') returning id into loc_a2;
  insert into public.warehouse_locations(company_id, warehouse_id, code, name) values (c, wh1, 'S-B1', 'Yard / bulk area [sample]') returning id into loc_b1;

  -- customer groups & farms
  insert into public.customer_groups(company_id, name, notes) values (c, 'Al-Noor Poultry Group', '[sample]') returning id into g1;
  insert into public.customer_groups(company_id, name, notes) values (c, 'Green Valley Farms', '[sample]') returning id into g2;
  insert into public.customers(company_id, name, group_id, contact_person, phone, city, address, payment_terms_days, credit_limit, notes) values
    (c, 'Al-Noor Farm 1 (Broiler)', g1, 'Haji Rafiq', '0300-6801122', 'Okara', 'Chak 12/2L, Okara', 30, 1500000, '[sample]'),
    (c, 'Al-Noor Farm 2 (Layer)',   g1, 'Haji Rafiq', '0300-6801122', 'Okara', 'Chak 14/2L, Okara', 30, 1500000, '[sample]'),
    (c, 'Al-Noor Breeder Farm',     g1, 'Imran Rafiq', '0301-4412233', 'Renala Khurd', 'Renala Khurd bypass', 45, 2500000, '[sample]'),
    (c, 'Green Valley Farm A',      g2, 'Sajid Mehmood', '0333-7654321', 'Sahiwal', '5-L Sahiwal', 15, 800000, '[sample]'),
    (c, 'Green Valley Farm B',      g2, 'Sajid Mehmood', '0333-7654321', 'Pakpattan', 'Pakpattan Road', 15, 800000, '[sample]'),
    (c, 'Punjab Layers (Pvt) Ltd',  null, 'Asif Iqbal', '042-35761234', 'Lahore', 'Raiwind Road, Lahore', 30, 3000000, '[sample]'),
    (c, 'Khan Poultry Pattoki',     null, 'Nadeem Khan', '0345-1122334', 'Pattoki', 'Pattoki Mandi', 0, 300000, '[sample]'),
    (c, 'Chaudhry Broilers Depalpur', null, 'Ch. Akram', '0306-9988776', 'Depalpur', 'Haveli Lakha Road', 7, 500000, '[sample]');

  -- suppliers
  insert into public.suppliers(company_id, name, country, city, default_currency, category, contact_person, phone, payment_terms_days, notes)
    values (c, 'Qingdao Farm Equipment Co.', 'China', 'Qingdao', 'CNY', 'Drinking & feeding systems', 'Ms. Li', '+86 532 8888 1234', 0, '[sample]') returning id into s_cn1;
  insert into public.suppliers(company_id, name, country, city, default_currency, category, contact_person, phone, payment_terms_days, notes)
    values (c, 'Zhejiang Ventilation Tech Ltd', 'China', 'Hangzhou', 'CNY', 'Fans & cooling pads', 'Mr. Wang', '+86 571 6666 4321', 0, '[sample]') returning id into s_cn2;
  insert into public.suppliers(company_id, name, country, city, default_currency, category, contact_person, phone, payment_terms_days, notes)
    values (c, 'Lahore Steel Fabricators', 'Pakistan', 'Lahore', 'PKR', 'Cages & fabrication', 'Tariq Butt', '0321-4567890', 30, '[sample]') returning id into s_local;
  insert into public.suppliers(company_id, name, country, city, default_currency, category, notes)
    values (c, 'Dubai Agri Trading FZE', 'UAE', 'Dubai', 'USD', 'Heaters & controllers', '[sample]');

  -- products (+ variants)
  insert into public.products(company_id, name, alias, category_id, base_uom_id, reorder_level, description)
    values (c, 'Nipple Drinker 360°', 'Nipple', cat_drink, pcs, 2000, '[sample] Stainless steel nipple, 360° trigger') returning id into p_nip;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, reorder_level, description)
    values (c, 'Drinker Line Pipe 22mm', 'Nipple pipe', cat_drink, mtr, 300, '[sample] Square PVC drinker pipe, sold per metre') returning id into p_line;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, has_variants, is_assembled, description)
    values (c, 'Exhaust Fan', 'Fan', cat_vent, pcs, true, true, '[sample] Box fan, assembled in-house') returning id into p_fan;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, has_variants, description)
    values (c, 'Cooling Pad 7090', 'Cellulose pad', cat_vent, pcs, true, '[sample] Evaporative cooling pad, 600mm wide') returning id into p_pad;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, description)
    values (c, 'Gas Brooder Heater', 'Heater', cat_heat, pcs, '[sample] Infrared gas brooder') returning id into p_heat;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, reorder_level, description)
    values (c, 'Feed Pipe 45mm', 'Feed pipe', cat_feed, mtr, 200, '[sample] Galvanised feed line pipe, per metre') returning id into p_pipe;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, reorder_level, description)
    values (c, 'Pipe Clamp 45mm', 'Clamp', cat_spare, pcs, 500, '[sample]') returning id into p_clamp;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, description)
    values (c, 'Water Pressure Regulator', 'Regulator', cat_drink, pcs, '[sample]') returning id into p_reg;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, has_variants, description)
    values (c, 'Layer Cage A-Type', 'Cage', cat_cage, setu, true, '[sample] Galvanised A-type layer cage set') returning id into p_cage;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, description)
    values (c, 'Feeder Line Motor 0.75kW', 'Motor', cat_feed, pcs, '[sample]') returning id into p_motor;
  insert into public.products(company_id, name, alias, category_id, base_uom_id, description)
    values (c, 'Winch Cable 4mm', 'Cable', cat_spare, roll, '[sample]') returning id into p_cable;

  insert into public.product_variants(company_id, product_id, sku, name, weight_kg) values (c, p_fan, '', '50 inch', 68) returning id into v_fan50;
  insert into public.product_variants(company_id, product_id, sku, name, weight_kg) values (c, p_fan, '', '36 inch', 42) returning id into v_fan36;
  insert into public.product_variants(company_id, product_id, sku, name) values (c, p_pad, '', '1.5m height') returning id into v_pad6;
  insert into public.product_variants(company_id, product_id, sku, name) values (c, p_pad, '', '1.8m height') returning id into v_pad8;
  insert into public.product_variants(company_id, product_id, sku, name) values (c, p_cage, '', '3-tier 96 birds') returning id into v_cage3;
  insert into public.product_variants(company_id, product_id, sku, name) values (c, p_cage, '', '4-tier 128 birds') returning id into v_cage4;

  -- finance master
  insert into public.chart_of_accounts(company_id, code, name, account_type, parent_id, description)
    values (c, '1120', 'Meezan Bank Current A/c', 'ASSET', (select id from public.chart_of_accounts where company_id = c and code = '1100'), '[sample]')
    returning id into gl_bank;
  insert into public.bank_accounts(company_id, name, account_kind, bank_name, branch_name, account_title, account_number, currency, gl_account_id)
    values (c, 'Meezan Current [sample]', 'BANK', 'Meezan Bank', 'Okara Main', 'JS Traders', '0123-0101234567', 'PKR', gl_bank);
  insert into public.payment_agents(company_id, name, contact_person, phone, city, notes)
    values (c, 'Al-Madina Exchange', 'Bilal', '0300-1112233', 'Lahore', '[sample]') returning id into ag1;
  insert into public.payment_agents(company_id, name, contact_person, phone, city, notes)
    values (c, 'Guangzhou Pay Agent', 'Mr. Chen', '+86 20 1234 5678', 'Guangzhou', '[sample]') returning id into ag2;
  insert into public.payment_agent_accounts(company_id, payment_agent_id, currency) values
    (c, ag1, 'PKR'), (c, ag1, 'CNY'), (c, ag1, 'USD'), (c, ag2, 'CNY');

  insert into public.employees(company_id, full_name, position, department, phone, joining_date, notes) values
    (c, 'Muhammad Ali',   'Store Keeper',       'Warehouse', '0300-1234001', '2023-03-01', '[sample]'),
    (c, 'Hussain Ahmed',  'Picker / Loader',    'Warehouse', '0300-1234002', '2024-01-15', '[sample]'),
    (c, 'Kashif Nawaz',   'Fan Assembler',      'Assembly',  '0300-1234003', '2022-07-10', '[sample]'),
    (c, 'Usman Tariq',    'Sales Officer',      'Sales',     '0300-1234004', '2023-09-01', '[sample]'),
    (c, 'Sana Bibi',      'Accounts Assistant', 'Accounts',  '0300-1234005', '2024-05-20', '[sample]');

  -- ---------------- stock activity (through the real posting engine)
  doc := public.save_stock_adjustment(null, jsonb_build_object('company_id', c, 'warehouse_id', wh1, 'reason', 'OPENING_BALANCE',
      'reference', 'Opening stock [sample]', 'notes', '[sample]'),
    jsonb_build_array(
      jsonb_build_object('product_id', p_nip,   'location_id', loc_a1, 'quantity', 5000),
      jsonb_build_object('product_id', p_line,  'location_id', loc_b1, 'quantity', 1200),
      jsonb_build_object('product_id', p_fan,   'variant_id', v_fan50, 'location_id', loc_b1, 'quantity', 40),
      jsonb_build_object('product_id', p_fan,   'variant_id', v_fan36, 'location_id', loc_b1, 'quantity', 25),
      jsonb_build_object('product_id', p_pad,   'variant_id', v_pad6,  'location_id', loc_b1, 'quantity', 300),
      jsonb_build_object('product_id', p_pipe,  'location_id', loc_b1, 'quantity', 850.5),
      jsonb_build_object('product_id', p_clamp, 'location_id', loc_a2, 'quantity', 1500),
      jsonb_build_object('product_id', p_reg,   'location_id', loc_a2, 'quantity', 60),
      jsonb_build_object('product_id', p_cage,  'variant_id', v_cage3, 'location_id', loc_b1, 'quantity', 12),
      jsonb_build_object('product_id', p_motor, 'location_id', loc_a2, 'quantity', 18)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', doc);

  doc := public.save_stock_adjustment(null, jsonb_build_object('company_id', c, 'warehouse_id', wh2, 'reason', 'OPENING_BALANCE', 'notes', '[sample]'),
    jsonb_build_array(
      jsonb_build_object('product_id', p_nip,   'quantity', 800),
      jsonb_build_object('product_id', p_heat,  'quantity', 30),
      jsonb_build_object('product_id', p_clamp, 'quantity', 200)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', doc);

  doc := public.save_goods_receipt(null, jsonb_build_object('company_id', c, 'warehouse_id', wh1, 'supplier_id', s_cn1,
      'supplier_reference', 'QD-PL-2026-118', 'notes', '[sample] Container QDU-7781 — cost pending'),
    jsonb_build_array(
      jsonb_build_object('product_id', p_nip,  'location_id', loc_a1, 'quantity', 10000),
      jsonb_build_object('product_id', p_line, 'location_id', loc_b1, 'quantity', 2000),
      jsonb_build_object('product_id', p_reg,  'location_id', loc_a2, 'quantity', 100)));
  perform public.post_stock_document('GOODS_RECEIPT', doc);

  doc := public.save_goods_receipt(null, jsonb_build_object('company_id', c, 'warehouse_id', wh1, 'supplier_id', s_cn2,
      'supplier_reference', 'ZJ-INV-5520', 'notes', '[sample] Draft — waiting for truck'),
    jsonb_build_array(
      jsonb_build_object('product_id', p_fan, 'variant_id', v_fan50, 'quantity', 60),
      jsonb_build_object('product_id', p_pad, 'variant_id', v_pad8, 'quantity', 200)));

  doc := public.save_stock_transfer(null, jsonb_build_object('company_id', c, 'from_warehouse_id', wh1, 'to_warehouse_id', wh2,
      'reference', 'Sahiwal branch refill', 'transport_details', 'Mazda LES-1234, driver Akram', 'notes', '[sample]'),
    jsonb_build_array(
      jsonb_build_object('product_id', p_fan,  'variant_id', v_fan50, 'from_location_id', loc_b1, 'quantity', 10),
      jsonb_build_object('product_id', p_line, 'from_location_id', loc_b1, 'quantity', 400)));
  perform public.post_stock_document('STOCK_TRANSFER', doc);

  doc := public.save_stock_adjustment(null, jsonb_build_object('company_id', c, 'warehouse_id', wh1, 'reason', 'DAMAGE', 'notes', '[sample] Broken in unloading'),
    jsonb_build_array(jsonb_build_object('product_id', p_nip, 'location_id', loc_a1, 'quantity', -35)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', doc);

  perform public.create_reservation(c, wh1, p_fan, v_fan50, 20,
    (select id from public.customers where company_id = c and name = 'Al-Noor Farm 1 (Broiler)'), '[sample] Hold for new shed');

  cnt := public.create_stock_count(c, wh1, 'INITIAL_COUNT', '[sample] Rack A cycle count', false);
  perform public.save_stock_count_lines(cnt, jsonb_build_array(
    jsonb_build_object('product_id', p_clamp, 'location_id', loc_a2, 'counted_qty', 1488, 'variance_note', '12 missing'),
    jsonb_build_object('product_id', p_reg,   'location_id', loc_a2, 'counted_qty', 160),
    jsonb_build_object('product_id', p_motor, 'location_id', loc_a2)));
end $$;

commit;
