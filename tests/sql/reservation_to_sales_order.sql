-- Reserved order → Sales order regression test (uses sample data; rolls back).
-- Expected: available stock drops on reserve, stays the same after convert,
-- returns after SO cancel; direct release of SO-held lines is blocked.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; w1 uuid; w2 uuid; fan uuid; f50 uuid; nip uuid; cust uuid; ro uuid; so uuid; lid uuid; av numeric; av2 numeric;
begin
  select id into c from public.companies limit 1;
  select id into w1 from public.warehouses where code='WH-01'; select id into w2 from public.warehouses where code='WH-02';
  select id into fan from public.products where name='Exhaust Fan'; select id into f50 from public.product_variants where product_id=fan and name='50 inch';
  select id into nip from public.products where name='Nipple Drinker 360°';
  select id into cust from public.customers where name='Green Valley Farm A';
  select available into av from public.stock_on_hand where warehouse_id=w1 and variant_id=f50;
  insert into t_out values (0, 'fan50 WH-01 available before = '||av);
  ro := public.save_reservation_order(null, jsonb_build_object('company_id',c,'customer_id',cust,'expires_on',(current_date+7)::text,'customer_reference','PO-778'),
     jsonb_build_array(jsonb_build_object('warehouse_id',w1,'product_id',fan,'variant_id',f50,'quantity',5),
                       jsonb_build_object('warehouse_id',w2,'product_id',fan,'variant_id',f50,'quantity',3),
                       jsonb_build_object('warehouse_id',w1,'product_id',nip,'quantity',500),
                       jsonb_build_object('warehouse_id',w2,'product_id',nip,'quantity',100)));
  select available into av2 from public.stock_on_hand where warehouse_id=w1 and variant_id=f50;
  insert into t_out values (1, 'after reserve: '||av2||' (expect before − 5)');
  select id into lid from public.reservations where reservation_order_id=ro and warehouse_id=w2 and product_id=nip;
  perform public.release_reservation(lid, 'customer reduced qty');
  perform public.save_reservation_order(ro, jsonb_build_object('company_id',c,'customer_id',cust,'customer_reference','PO-778'),
     jsonb_build_array(jsonb_build_object('warehouse_id',w1,'product_id',nip,'quantity',50)));
  so := public.convert_reservation_to_sales_order(ro, null, null, null);
  insert into t_out select 2, 'SO '||doc_no||' status='||status from public.sales_orders where id=so;
  insert into t_out select 3, 'SO line '||l.line_no||' qty='||l.quantity||' alloc='||(select string_agg(w.code||':'||a.quantity, ' ' order by w.code) from public.sales_order_line_warehouse_allocations a join public.warehouses w on w.id=a.warehouse_id where a.sales_order_line_id=l.id) from public.sales_order_lines l where l.sales_order_id=so and l.line_no=1;
  select available into av2 from public.stock_on_hand where warehouse_id=w1 and variant_id=f50;
  insert into t_out values (4, 'after convert: '||av2||' (unchanged — still held)');
  insert into t_out values (5, 'convert again returns same SO: '||(public.convert_reservation_to_sales_order(ro) = so));
  begin
    perform public.release_reservation((select id from public.reservations where sales_order_id=so limit 1), 'x');
    insert into t_out values (6, 'BAD: released SO-held line directly');
  exception when others then insert into t_out values (6, 'direct release blocked: '||sqlerrm); end;
  perform public.approve_sales_order(so);
  perform public.cancel_sales_order(so, 'customer cancelled');
  select available into av2 from public.stock_on_hand where warehouse_id=w1 and variant_id=f50;
  insert into t_out values (7, 'after SO cancel: '||av2||' (back to before)');
end $$;
reset role;
select * from t_out order by step;
rollback;
