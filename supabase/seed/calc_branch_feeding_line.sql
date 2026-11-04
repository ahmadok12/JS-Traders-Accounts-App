-- Branch Feeding Line calculator (live data, 4 Nov 2026). Run once as an administrator (set request.jwt.claims first):
-- creates the Feed Pan product (China / Local) and the calculator template with Ahmad's rules.
-- Items are looked up by product name, variants default to the first one (China) — changeable in the calculator.
do $$
declare c uuid := '8feeae98-4708-489b-a0a5-243282840d5d'; v_pid uuid; v_tpl uuid; r record; v_prod uuid; v_var uuid;
begin
  if not exists (select 1 from public.products where company_id = c and name = 'Feed Pan') then
    insert into public.products(company_id, name, category_id, base_uom_id, has_variants, tracking_type, allow_negative_stock, is_active)
    values (c, 'Feed Pan', (select id from public.product_categories where company_id = c and name = 'Feeding Systems'),
            (select id from public.units_of_measure where code = 'PCS'), true, 'NONE', true, true)
    returning id into v_pid;
    insert into public.product_variants(company_id, product_id, name, attributes, allow_negative_stock, is_active)
    values (c, v_pid, 'China', '{}'::jsonb, true, true), (c, v_pid, 'Local', '{}'::jsonb, true, true);
  end if;

  insert into public.calc_templates(company_id, code, name, description, unit_label, qty_var, sort_order, variables)
  values (c, 'BRANCH_FEEDING', 'Branch Feeding Line', 'Branch feed lines for one shed: length, number of lines, feed room position', 'line', 'N', 1,
  '[{"key":"L","label":"Farm length (ft)","type":"number","default":430,"step":10,"hint":"usually 400–450 ft"},
    {"key":"N","label":"No. of branch feed lines","type":"number","default":4,"step":1},
    {"key":"ROOM","label":"Feed room","type":"choice","options":["Side","Centre"],"default":"Side"},
    {"key":"PIPES","label":"Feed pipes per line (10 ft each)","formula":"ceil(L/10)"},
    {"key":"MOTORS","label":"Feed motors per line","formula":"ROOM==''Centre'' ? 2 : 1"},
    {"key":"P8","label":"Hanging points per line (every 8 ft)","formula":"ceil(L/8)"}]'::jsonb)
  on conflict (company_id, code) do update set variables = excluded.variables, name = excluded.name, description = excluded.description
  returning id into v_tpl;

  delete from public.calc_template_items where template_id = v_tpl;
  for r in select * from (values
    (1,  'Feed Pipe Collar',              'PIPES*N',        'Each pipe is 10 ft: length ÷ 10 × lines'),
    (2,  'Feed Pan',                      'PIPES*4*N',      '4 per feed pipe'),
    (3,  'Feed Motor Taiwixin 0.75 kwh',  'MOTORS*N',       'Centre feed room 2, side 1 — per line'),
    (4,  'Feed Line Winch',               'N',              '1 per line'),
    (5,  'Hopper 60 x 60',                'N',              '1 per line'),
    (6,  'Feed Boot 45mm Single',         'ROOM==''Side'' ? N : 0',   'Side feed room: 1 per line'),
    (7,  'Feed Boot 45mm Double',         'ROOM==''Centre'' ? N : 0', 'Centre feed room: 1 per line'),
    (8,  'Motor Box 45mm',                'N',              '1 per line'),
    (9,  'Shaft 45mm',                    'MOTORS*N',       '1 per feed motor'),
    (10, 'Augar 45mm',                    'L*N',            'Farm length × lines'),
    (11, 'Sensor Black',                  'MOTORS*N',       '1 per feed motor'),
    (12, 'Feed Line Adjust',              'P8*N',           'Every 8 ft: length ÷ 8 × lines'),
    (13, 'Feed Line Hanger',              'P8*N',           'Every 8 ft: length ÷ 8 × lines'),
    (14, 'Feed Pulley 45mm',              'P8*N',           'Every 8 ft: length ÷ 8 × lines'),
    (15, 'C Clump 45mm',                  'PIPES*N',        '1 per feed pipe'),
    (16, 'U Clump 8mm',                   'P8*N',           'Every 8 ft: length ÷ 8 × lines'),
    (17, 'U Clump 10mm',                  '15*N',           '15 per line'),
    (18, '3mm Steel Wire',                'L*N+50',         'Length × lines + 50 ft'),
    (19, '5mm Steel Wire',                'L*N+100',        'Length × lines + 100 ft'),
    (20, '1.2mm Steel Wire',              'L*N+50',         'Length × lines + 50 ft'),
    (21, 'End Patri',                     '2*N',            '2 per line'),
    (22, 'End Spring',                    '2*N',            '2 per line'),
    (23, '105mm Pulley',                  'N',              '1 per line'),
    (24, 'Chain',                         'N',              '1 per line'),
    (25, 'Winch Handle',                  '1',              '1 for all branch lines')) t(no, pname, formula, note) order by no loop
    select id into v_prod from public.products where company_id = c and name = r.pname;
    if v_prod is null then raise exception 'Product % not found', r.pname; end if;
    select id into v_var from public.product_variants where product_id = v_prod and is_active order by sku limit 1;
    insert into public.calc_template_items(company_id, template_id, line_no, product_id, variant_id, formula, note)
    values (c, v_tpl, r.no, v_prod, v_var, r.formula, r.note);
  end loop;
end $$;
