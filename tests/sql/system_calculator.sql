-- System calculator packages (rolls back): SO with a Branch Feeding Line package + a loose item, no stock (negative allowed,
-- roll item included) → approve → GDN → invoice. The invoice discount carries the package discount; invoice_packages()
-- tells the printout which part of each line is the package. Expected: no row starts with "BAD".
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; wh uuid; cu uuid; so uuid; g uuid; inv uuid; res jsonb; aug uuid; pan uuid; pan_cn uuid; wh_h uuid; pk uuid;
  l_aug uuid; l_pan uuid; l_wh uuid; l_loose uuid; v numeric; x jsonb; galv uuid;
begin
  select id into c from public.companies where code = 'JST';
  insert into public.warehouses(company_id,name) values (c,'T-CALC') returning id into wh;
  insert into public.customers(company_id,name) values (c,'T Calc Farm') returning id into cu;
  select id into aug from public.products where company_id=c and name='Augar 45mm';
  select id into pan from public.products where company_id=c and name='Feed Pan';
  select id into pan_cn from public.product_variants where product_id=pan and name='China';
  select id into wh_h from public.products where company_id=c and name='Winch Handle';
  select id into galv from public.products where company_id=c and name='Galvanised Steel Wire 3mm';

  -- 430 ft × 4 lines: augar 1720 ft @200, pans 688 (+12 extra) @140, winch handle 1 @3640 = 443,960 + loose wire 100 ft @50
  so := public.save_sales_order(null, jsonb_build_object('company_id',c,'customer_id',cu), jsonb_build_array(
    jsonb_build_object('product_id',aug,'unit_price',200,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wh,'quantity',1720))),
    jsonb_build_object('product_id',pan,'variant_id',pan_cn,'unit_price',140,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wh,'quantity',700))),
    jsonb_build_object('product_id',wh_h,'unit_price',3640,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wh,'quantity',1))),
    jsonb_build_object('product_id',galv,'unit_price',50,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wh,'quantity',100)))));
  select id into l_aug from public.sales_order_lines where sales_order_id=so and line_no=1;
  select id into l_pan from public.sales_order_lines where sales_order_id=so and line_no=2;
  select id into l_wh from public.sales_order_lines where sales_order_id=so and line_no=3;
  select id into l_loose from public.sales_order_lines where sales_order_id=so and line_no=4;

  -- discount more than the items is refused
  begin
    perform public.set_so_packages(so, jsonb_build_array(jsonb_build_object('name','Branch Feeding Line','quantity',4,'discount_amount',999999,
      'lines', jsonb_build_array(jsonb_build_object('line_id',l_aug,'calc_qty',1720)))));
    insert into t_out values (1, 'BAD too-big discount accepted');
  exception when others then insert into t_out values (1, 'ok too-big discount refused: ' || sqlerrm);
  end;

  res := public.set_so_packages(so, jsonb_build_array(jsonb_build_object('name','Branch Feeding Line','unit_label','line','quantity',4,
    'inputs', jsonb_build_object('L',430,'N',4,'ROOM','Centre'), 'discount_amount', 5640,
    'lines', jsonb_build_array(jsonb_build_object('line_id',l_aug,'calc_qty',1720), jsonb_build_object('line_id',l_pan,'calc_qty',688), jsonb_build_object('line_id',l_wh,'calc_qty',1)))));
  select id into pk from public.sales_order_packages where sales_order_id=so;
  insert into t_out values (2, case when pk is not null and (select count(*) from public.sales_order_lines where package_id=pk)=3
    and (select package_id from public.sales_order_lines where id=l_loose) is null then 'ok package saved, loose line outside' else 'BAD package lines' end);
  -- items 344,000 + 98,000 + 3,640 = 445,640 − 5,640 = 440,000 = 4 × 110,000

  -- saving again with the same id keeps one package
  perform public.set_so_packages(so, jsonb_build_array(jsonb_build_object('id',pk,'name','Branch Feeding Line','quantity',4,'discount_amount',5640,
    'lines', jsonb_build_array(jsonb_build_object('line_id',l_aug,'calc_qty',1720), jsonb_build_object('line_id',l_pan,'calc_qty',688), jsonb_build_object('line_id',l_wh,'calc_qty',1)))));
  insert into t_out values (3, case when (select count(*) from public.sales_order_packages where sales_order_id=so)=1 then 'ok re-save keeps one package' else 'BAD duplicate package' end);

  perform public.approve_sales_order(so);
  g := public.save_gdn(null, jsonb_build_object('company_id',c,'sales_order_id',so), (
    select jsonb_agg(jsonb_build_object('allocation_id', a.id, 'quantity', a.quantity)) from public.sales_order_line_warehouse_allocations a
      join public.sales_order_lines l on l.id = a.sales_order_line_id where l.sales_order_id = so and l.is_active));
  res := public.post_gdn(g);
  select sum(on_hand) into v from public.stock_balances where warehouse_id=wh and product_id=aug;
  insert into t_out values (4, case when v = -1720 then 'ok GDN posted with no stock: augar ' || v else 'BAD augar balance ' || coalesce(v::text,'null') end);

  inv := public.create_invoice_from_gdns(c, array[g]);
  select discount_amount into v from public.sales_invoices where id=inv;
  insert into t_out values (5, case when v = 5640 then 'ok invoice discount = package discount 5,640' else 'BAD invoice discount ' || v end);
  x := public.invoice_packages(inv);
  insert into t_out values (6, case when (x->'packages'->0->>'billed')::numeric = 445640 and (x->'packages'->0->>'full')::numeric = 445640
    and jsonb_array_length(x->'parts') = 3 then 'ok invoice_packages: ' || (x->'packages'->0)::text else 'BAD invoice_packages ' || x::text end);
  res := public.post_sales_invoice(inv);
  select total_amount into v from public.sales_invoices where id=inv;
  insert into t_out values (7, case when v = 445640 + 5000 - 5640 then 'ok posted total ' || v else 'BAD total ' || v end);
  x := public.invoice_packages(inv);
  insert into t_out values (8, case when jsonb_array_length(x->'parts') = 3 then 'ok posted invoice still maps to the package' else 'BAD after post ' || x::text end);
end $$;
reset role;
select * from t_out order by step;
rollback;
