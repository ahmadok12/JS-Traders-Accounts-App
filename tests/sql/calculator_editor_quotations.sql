-- Calculator editor + quotation packages (rolls back). Expected: every row starts with "ok". Live 4 Nov 2026: 6/6.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; t uuid; t2 uuid; it jsonb; q uuid; cu uuid; aug uuid; wh_h uuid; x jsonb;
begin
  select id into c from public.companies where code='JST';
  select id into t from public.calc_templates where code='BRANCH_FEEDING';
  select jsonb_agg(jsonb_build_object('product_id',i.product_id,'variant_id',i.variant_id,'formula',i.formula,'note',i.note,
     'default_price', case when i.line_no=10 then 200 else null end) order by i.line_no) into it from public.calc_template_items i where i.template_id=t;
  perform public.save_calc_template(t, (select jsonb_build_object('company_id',company_id,'code',code,'name',name,'description',description,'unit_label',unit_label,
      'qty_var',qty_var,'sort_order',sort_order,'is_active',is_active,'variables',variables) from public.calc_templates where id=t), it);
  insert into t_out values (1, case when (select count(*) from public.calc_template_items where template_id=t)=25
    and (select count(*) from public.calc_template_prices(t) where default_price=200)=1 then 'ok re-save keeps 25 items, price saved' else 'BAD re-save' end);
  begin
    perform public.save_calc_template(null, jsonb_build_object('company_id',c,'name','X','qty_var','N','variables','[{"key":"1bad","label":"x"}]'::jsonb), it);
    insert into t_out values (2,'BAD bad code accepted');
  exception when others then insert into t_out values (2,'ok bad input code refused: '||sqlerrm); end;
  t2 := public.save_calc_template(null, jsonb_build_object('company_id',c,'name','Test Calc','qty_var','N','variables','[{"key":"N","label":"Lines","type":"number","default":1}]'::jsonb),
     jsonb_build_array(jsonb_build_object('product_id',(select id from public.products where name='Chain'),'formula','N')));
  insert into t_out values (3, case when (select code from public.calc_templates where id=t2)='TEST_CALC' then 'ok new calculator TEST_CALC' else 'BAD new' end);
  insert into public.customers(company_id,name) values (c,'T Quote Farm') returning id into cu;
  select id into aug from public.products where name='Augar 45mm';
  select id into wh_h from public.products where name='Winch Handle';
  q := public.save_quotation(null, jsonb_build_object('company_id',c,'customer_id',cu,'discount_amount',4000), jsonb_build_array(
    jsonb_build_object('product_id',aug,'quantity',1720,'unit_price',200), jsonb_build_object('product_id',wh_h,'quantity',1,'unit_price',4000),
    jsonb_build_object('product_id',wh_h,'quantity',2,'unit_price',4000)));
  x := public.set_quotation_packages(q, jsonb_build_array(jsonb_build_object('template_id',t,'name','Branch Feeding Line','quantity',4,'discount_amount',4000,
    'inputs',jsonb_build_object('L',430,'N',4),'lines',jsonb_build_array(jsonb_build_object('line_no',1,'calc_qty',1720),jsonb_build_object('line_no',2,'calc_qty',1)))));
  insert into t_out select 4, case when count(*) filter (where package_id is not null)=2 and count(*) filter (where package_id is null)=1
    then 'ok quotation package on 2 lines, 1 loose' else 'BAD quotation package' end from public.quotation_lines where quotation_id=q and is_active;
  begin
    perform public.set_quotation_packages(q, jsonb_build_array(jsonb_build_object('name','P','quantity',4,'discount_amount',5000,'lines',jsonb_build_array(jsonb_build_object('line_no',1)))));
    insert into t_out values (5,'BAD discount over quotation discount accepted');
  exception when others then insert into t_out values (5,'ok package discount > quotation discount refused'); end;
  perform public.save_quotation(q, jsonb_build_object('company_id',c,'customer_id',cu,'discount_amount',4000), jsonb_build_array(
    jsonb_build_object('product_id',aug,'quantity',1720,'unit_price',200), jsonb_build_object('product_id',wh_h,'quantity',1,'unit_price',4000)));
  perform public.set_quotation_packages(q, jsonb_build_array(jsonb_build_object('name','Branch Feeding Line','quantity',4,'discount_amount',4000,
    'lines',jsonb_build_array(jsonb_build_object('line_no',1,'calc_qty',1720),jsonb_build_object('line_no',2,'calc_qty',1)))));
  insert into t_out values (6, case when (select count(*) from public.quotation_packages where quotation_id=q)=1
    and (select count(*) from public.quotation_lines where quotation_id=q and is_active and package_id is not null)=2 then 'ok edit + re-save keeps one package' else 'BAD after edit' end);
end $$;
reset role;
select * from t_out order by step;
rollback;
