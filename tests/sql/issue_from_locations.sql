-- Outbound stock with no location draws from the whole warehouse (unassigned
-- first, then fullest locations), splitting movements. Reserved stock protected.
-- Expected: split -60 (none) / -20 R1, totals as noted, drift 0.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
-- this test exercises racks/shelves: switch the optional feature on for the test (rolled back)
select public.set_storage_locations_enabled((select id from public.companies limit 1), true);
do $$
declare c uuid; pcs uuid; wa uuid; wb uuid; fp uuid; v16 uuid; v20 uuid; cl uuid; adj uuid; trf uuid; x jsonb; loc uuid;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'Test A') returning id into wa;
  insert into public.warehouses(company_id,name) values (c,'Test B') returning id into wb;
  insert into public.warehouse_locations(company_id,warehouse_id,code,name) values (c,wa,'R1','Rack 1') returning id into loc;
  insert into public.products(company_id,name,base_uom_id,has_variants) values (c,'T Feed Pan',pcs,true) returning id into fp;
  insert into public.product_variants(company_id,product_id,sku,name) values (c,fp,'','16-hole') returning id into v16;
  insert into public.product_variants(company_id,product_id,sku,name) values (c,fp,'','20-hole') returning id into v20;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Clamp',pcs) returning id into cl;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE'),
    jsonb_build_array(jsonb_build_object('product_id',fp,'variant_id',v16,'quantity',60),
                      jsonb_build_object('product_id',fp,'variant_id',v16,'location_id',loc,'quantity',40),
                      jsonb_build_object('product_id',fp,'variant_id',v20,'quantity',50),
                      jsonb_build_object('product_id',cl,'location_id',loc,'quantity',200)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  trf := public.save_stock_transfer(null, jsonb_build_object('company_id',c,'from_warehouse_id',wa,'to_warehouse_id',wb), jsonb_build_array(jsonb_build_object('product_id',fp,'variant_id',v16,'quantity',80)));
  perform public.post_stock_document('STOCK_TRANSFER', trf);
  insert into t_out select 1, 'split transfer: '||string_agg(coalesce(location_code,'(none)')||' '||quantity, '; ' order by quantity) from public.stock_ledger where source_id=trf and movement_type='TRANSFER_OUT';
  insert into t_out select 2, 'FP16 A total='||(select sum(on_hand) from public.stock_balances where warehouse_id=wa and variant_id=v16)||' (expect 20)';
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','DAMAGE'), jsonb_build_array(jsonb_build_object('product_id',cl,'quantity',-5)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  insert into t_out select 3, 'damage w/o location taken from R1: '||(select on_hand from public.stock_balances where warehouse_id=wa and product_id=cl and location_id=loc)||' (expect 195)';
  x := public.reverse_stock_document('STOCK_TRANSFER', trf, 'test');
  insert into t_out select 4, 'after reversal A='||(select sum(on_hand) from public.stock_balances where warehouse_id=wa and variant_id=v16)||' B='||(select sum(on_hand) from public.stock_balances where warehouse_id=wb and variant_id=v16)||' (expect 100/0)';
  insert into t_out select 5, 'drift rows = '||count(*)||' (expect 0)' from public.stock_balance_drift(c);
  -- turn locations OFF: R1 stock folds into the warehouse, totals unchanged
  x := public.set_storage_locations_enabled(c, false);
  insert into t_out select 6, 'off: moved='||(x->>'balances_moved')||' A FP16='||(select sum(on_hand) from public.stock_balances where warehouse_id=wa and variant_id=v16)||' in R1='||(select coalesce(sum(on_hand),0) from public.stock_balances where location_id=loc)||' (expect 100 / 0)';
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE'), jsonb_build_array(jsonb_build_object('product_id',cl,'location_id',loc,'quantity',5)));
  insert into t_out select 7, 'off: location stripped from new line='||((select location_id from public.stock_adjustment_lines where adjustment_id=adj) is null);
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  insert into t_out select 8, 'off: drift rows = '||count(*)||' clamp total='||(select sum(on_hand) from public.stock_balances where warehouse_id=wa and product_id=cl)||' (expect 0 / 200)' from public.stock_balance_drift(c);
end $$;
reset role;
select * from t_out order by step;
rollback;
