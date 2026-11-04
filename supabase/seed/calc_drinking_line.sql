-- Drinking Line calculator (live data, 4 Nov 2026). Run as an administrator (set request.jwt.claims first).
-- Also makes Water Regulator Pipe a roll item in feet (it had no stock or orders yet).
-- Glue: 1.25 per 400 ft line, scaled to the farm length, rounded up on the total.
-- Water Rope 3mm: 300 ft rolls → farm length × lines ÷ 300, rounded up on the total.
do $$
declare c uuid := '8feeae98-4708-489b-a0a5-243282840d5d'; v_tpl uuid; r record; v_prod uuid; v_var uuid;
begin
  update public.products set tracking_type = 'PHYSICAL_UNIT', base_uom_id = (select id from public.units_of_measure where code = 'FT')
   where company_id = c and name = 'Water Regulator Pipe' and tracking_type <> 'PHYSICAL_UNIT';

  insert into public.calc_templates(company_id, code, name, description, unit_label, qty_var, sort_order, variables)
  values (c, 'DRINKING', 'Drinking Line', 'Drinking lines for one shed: length and number of lines', 'line', 'N', 2,
  '[{"key":"L","label":"Farm length (ft)","short":"Length","unit":"ft","type":"number","default":430,"step":10,"hint":"usually 400–450 ft"},
    {"key":"W","label":"Farm width (ft)","short":"Width","unit":"ft","type":"number","default":50,"step":5,"hint":"usually 50 ft"},
    {"key":"N","label":"No. of drinking lines","short":"Lines","type":"number","default":5,"step":1},
    {"key":"PIPES","label":"Water lines (15 nipples, 10 ft) per line","formula":"ceil(L/10)"},
    {"key":"P8","label":"Hanging points per line (every 8 ft)","formula":"ceil(L/8)"}]'::jsonb)
  on conflict (company_id, code) do update set variables = excluded.variables, name = excluded.name, description = excluded.description
  returning id into v_tpl;

  delete from public.calc_template_items where template_id = v_tpl;
  for r in select * from (values
    (1,  'Water Line 15 Nipples',        'PIPES*N',             'Each pipe is 10 ft: length ÷ 10 × lines'),
    (2,  'Water Line Support Pipe 27mm', 'PIPES*N',             'Each pipe is 10 ft: length ÷ 10 × lines'),
    (3,  'Water Regulator',              'N',                   '1 per line'),
    (4,  'Drip Cup',                     'PIPES*N*15',          '15 per water line (15 nipples)'),
    (5,  'Water Line Hanger',            'PIPES*N*4',           '4 per water line (15 nipples)'),
    (6,  'Glue',                         'ceil(1.25*L/400*N)',  '1.25 per 400 ft line, rounded up'),
    (7,  'Winch Drinking Line',          'N',                   '1 per line'),
    (8,  'Water Line End Valve',         '2*N',                 '2 per line'),
    (9,  'Water Level Pipe',             '2*N',                 '2 per line'),
    (10, 'Water Line Joint',             'ceil(PIPES*N*0.5)',   'Half the water lines (15 nipples)'),
    (11, 'Water Line Male/Female Joint', 'ceil(PIPES*N*0.5)',   'Half the water lines (15 nipples)'),
    (12, 'Water Line Pulley 24mm',       'P8*N',                'Every 8 ft: length ÷ 8 × lines'),
    (13, 'Water Line Thimmel',           'P8*N',                'Every 8 ft: length ÷ 8 × lines'),
    (14, 'Water Line Adjust',            'P8*N',                'Every 8 ft: length ÷ 8 × lines'),
    (15, 'Water Rope 3mm',               'ceil(L*N/300)',       '300 ft rolls: length × lines ÷ 300, rounded up'),
    (16, 'Water Line End Spring',        '4*N',                 '4 per line'),
    (17, 'Water Line End Patri',         '4*N',                 '4 per line'),
    (18, 'Water Regulator Pipe',         '8*N',                 '8 ft per line'),
    (19, 'Galvanised Steel Wire 3mm',    'L*N+50',              'Length × lines + 50 ft'),
    (20, '1.2mm Shocker Wire',           'L*N+50',              'Length × lines + 50 ft'),
    (21, 'U Clump 6mm',                  'P8*N',                'Every 8 ft: length ÷ 8 × lines'),
    (22, 'Winch Handle',                 '1',                   '1 for all lines')) t(no, pname, formula, note) order by no loop
    select id into v_prod from public.products where company_id = c and name = r.pname;
    if v_prod is null then raise exception 'Product % not found', r.pname; end if;
    select id into v_var from public.product_variants where product_id = v_prod and is_active order by sku limit 1;
    insert into public.calc_template_items(company_id, template_id, line_no, product_id, variant_id, formula, note)
    values (c, v_tpl, r.no, v_prod, v_var, r.formula, r.note);
  end loop;
end $$;
