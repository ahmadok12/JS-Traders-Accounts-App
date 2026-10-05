-- Warehouse manager can record returns and raise purchase orders, but sees no money and cannot reset trial data.
-- Temporarily gives the first warehouse-staff user the Warehouse Manager role; rolls back. Expected: every row starts with "ok".
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
insert into public.user_roles(user_id, role_id, company_id)
select ur.user_id, (select id from public.roles where code='WAREHOUSE_MANAGER'), ur.company_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='WAREHOUSE_STAFF' limit 1;
create temp table t_ids(admin uuid, wm uuid) on commit drop;
grant all on t_ids to authenticated;
insert into t_ids select (select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1), (select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='WAREHOUSE_MANAGER' limit 1);
select set_config('request.jwt.claims', json_build_object('sub',(select admin from t_ids),'role','authenticated')::text, true);
set local role authenticated;
set constraints all immediate;
do $$
declare c uuid; pcs uuid; wa uuid; fan uuid; cu uuid; sup uuid; adj uuid; so uuid; al uuid; g uuid; gl uuid; res jsonb; s text; v numeric; sr uuid; po uuid; n int;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  select id into wa from public.warehouses where company_id=c order by code limit 1;
  insert into public.products(company_id,name,base_uom_id) values (c,'WM Test Fan',pcs) returning id into fan;
  select id into cu from public.customers where company_id=c limit 1;
  select id into sup from public.suppliers where company_id=c limit 1;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','CHANGE'), jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',20)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  so := public.save_sales_order(null, jsonb_build_object('company_id',c,'customer_id',cu), jsonb_build_array(jsonb_build_object('product_id',fan,'unit_price',100,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',10)))));
  perform public.approve_sales_order(so);
  select a.id into al from public.sales_order_line_warehouse_allocations a join public.sales_order_lines l on l.id=a.sales_order_line_id where l.sales_order_id=so;
  g := public.save_gdn(null, jsonb_build_object('company_id',c,'sales_order_id',so), jsonb_build_array(jsonb_build_object('allocation_id',al,'quantity',10)));
  res := public.post_gdn(g);
  select id into gl from public.gdn_lines where gdn_id=g;
  perform set_config('request.jwt.claims', json_build_object('sub',(select wm from t_ids),'role','authenticated')::text, true);
  select count(*) into n from public.returnable_gdn_lines(g);
  insert into t_out values (1, case when n=1 then 'ok' else 'BAD' end||' WM sees returnable lines: '||n);
  sr := public.post_sales_return(jsonb_build_object('gdn_id',g,'reason','damaged'), jsonb_build_array(jsonb_build_object('gdn_line_id',gl,'quantity',2)));
  select count(*) into n from public.sales_returns where id=sr;
  insert into t_out values (2, case when n=1 then 'ok' else 'BAD' end||' WM recorded and can list the sales return');
  select count(*) into n from public.return_amounts('SALES', sr);
  insert into t_out values (3, case when n=0 then 'ok' else 'BAD' end||' WM sees no money on returns: rows '||n);
  select count(*), max(coalesce(credit_amount,-1)) into n, v from public.rpt_sales_returns(c, null, null);
  insert into t_out values (4, case when n=1 and v=-1 then 'ok' else 'BAD' end||' WM returns report rows '||n||', credit column hidden');
  po := public.save_purchase_order(null, jsonb_build_object('company_id',c,'supplier_id',sup), jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',50,'unit_price',999)));
  select count(*) into n from public.purchase_orders where id=po;
  insert into t_out values (5, case when n=1 then 'ok' else 'BAD' end||' WM created a purchase order');
  begin perform public.reset_trial_transactions(c, 'RESET JST'); insert into t_out values (6,'BAD: WM could reset');
  exception when others then insert into t_out values (6,'ok WM cannot reset: '||sqlerrm); end;
  begin perform 1 from public.sales_return_lines where unit_price is not null; insert into t_out values (7,'BAD: WM read return prices');
  exception when others then insert into t_out values (7,'ok WM blocked from return prices: '||sqlerrm); end;
end $$;
select step, result from t_out order by step;
rollback;
