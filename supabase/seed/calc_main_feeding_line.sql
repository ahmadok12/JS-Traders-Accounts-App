-- Main Feeding Line calculator (live data, 4 Nov 2026). Run as an administrator (set request.jwt.claims first).
-- Inputs: farm length / width (for the record), lines (usually 1), floor Single / Double, main line size 65 / 78 ft.
do $$
declare c uuid := '8feeae98-4708-489b-a0a5-243282840d5d'; v_tpl uuid; r record; v_prod uuid; v_var uuid;
begin
  insert into public.calc_templates(company_id, code, name, description, unit_label, qty_var, sort_order, variables)
  values (c, 'MAIN_FEEDING', 'Main Feeding Line', 'Main feed line from the silo / hopper: floor and line size', 'line', 'N', 3,
  '[{"key":"L","label":"Farm length (ft)","short":"Length","unit":"ft","type":"number","default":430,"step":10,"hint":"for the record"},
    {"key":"W","label":"Farm width (ft)","short":"Width","unit":"ft","type":"number","default":50,"step":5,"hint":"usually 50 ft"},
    {"key":"N","label":"No. of main feeding lines","short":"Lines","type":"number","default":1,"step":1},
    {"key":"FLOOR","label":"Floor","short":"Floor","type":"choice","options":["Single","Double"],"default":"Single"},
    {"key":"SIZE","label":"Main line size (ft)","short":"Size","unit":"ft","type":"choice","options":["65","78"],"default":"65"}]'::jsonb)
  on conflict (company_id, code) do update set variables = excluded.variables, name = excluded.name, description = excluded.description
  returning id into v_tpl;

  delete from public.calc_template_items where template_id = v_tpl;
  for r in select * from (values
    (1,  'Hopper 800kg',                  'N',                                '1 per line'),
    (2,  'Feed Boot 90mm Single',         'FLOOR==''Single'' ? N : 0',        'Single floor: 1 per line'),
    (3,  'Feed Boot 90mm Double',         'FLOOR==''Double'' ? N : 0',        'Double floor: 1 per line'),
    (4,  'Motor Box 90mm',                'N',                                '1 per line'),
    (5,  'Feed Motor Taiwixin 1.1 kwh',   'N',                                '1 per line'),
    (6,  'Augar 90mm',                    'SIZE*N',                           'Line size × lines'),
    (7,  'Feed Pulley 90mm',              '2*N',                              '2 per line'),
    (8,  'Shaft 90mm',                    'N',                                '1 per line'),
    (9,  'PVC Pipe 13ft 90mm',            '(FLOOR==''Double'' ? 5 : 4)*N',    'Single floor 4, double 5 — per line'),
    (10, 'PVC Pipe Bend 13ft 90mm',       'N',                                '1 per line'),
    (11, 'Socket 90mm',                   '(FLOOR==''Double'' ? 4 : 3)*N',    'Single floor 3, double 4 — per line'),
    (12, 'Goat Axel 90mm',                'N',                                '1 per feed motor'),
    (13, 'Dropper 90mm',                  'N',                                '1 per line'),
    (14, 'C Clump 90mm',                  '6*N',                              '6 per line'),
    (15, 'Flexible Pipe 75mm',            'N',                                '1 per dropper'),
    (16, 'Jubilee Clump',                 '2*N',                              '2 per flexible pipe')) t(no, pname, formula, note) order by no loop
    select id into v_prod from public.products where company_id = c and name = r.pname;
    if v_prod is null then raise exception 'Product % not found', r.pname; end if;
    select id into v_var from public.product_variants where product_id = v_prod and is_active order by sku limit 1;
    insert into public.calc_template_items(company_id, template_id, line_no, product_id, variant_id, formula, note)
    values (c, v_tpl, r.no, v_prod, v_var, r.formula, r.note);
  end loop;
end $$;
