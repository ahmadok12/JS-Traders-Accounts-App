-- Inventory engine regression test (run in SQL editor; everything rolls back).
-- Expected: 13 rows, none starting with "BAD", drift rows = 0.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; pcs uuid; wa uuid; wb uuid; fp uuid; v16 uuid; v20 uuid; cl uuid; adj uuid; grn uuid; trf uuid; cnt uuid; r uuid; x jsonb; lid uuid; q numeric;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'Test A') returning id into wa;
  insert into public.warehouses(company_id,name) values (c,'Test B') returning id into wb;
  insert into public.products(company_id,name,base_uom_id,has_variants) values (c,'T Feed Pan',pcs,true) returning id into fp;
  insert into public.product_variants(company_id,product_id,sku,name) values (c,fp,'','16-hole') returning id into v16;
  insert into public.product_variants(company_id,product_id,sku,name) values (c,fp,'','20-hole') returning id into v20;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Clamp',pcs) returning id into cl;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE'),
    jsonb_build_array(jsonb_build_object('product_id',fp,'variant_id',v16,'quantity',100),
                      jsonb_build_object('product_id',fp,'variant_id',v20,'quantity',50),
                      jsonb_build_object('product_id',cl,'quantity',200)));
  x := public.post_stock_document('STOCK_ADJUSTMENT', adj); insert into t_out values (1,'opening posted '||x::text);
  x := public.post_stock_document('STOCK_ADJUSTMENT', adj); insert into t_out values (2,'double post → '||x::text);
  grn := public.save_goods_receipt(null, jsonb_build_object('company_id',c,'warehouse_id',wa), jsonb_build_array(jsonb_build_object('product_id',cl,'quantity',50)));
  perform public.post_stock_document('GOODS_RECEIPT', grn);
  select sum(on_hand) into q from public.stock_balances where warehouse_id=wa and product_id=cl; insert into t_out values (3,'clamp after receipt = '||q||' (expect 250)');
  trf := public.save_stock_transfer(null, jsonb_build_object('company_id',c,'from_warehouse_id',wa,'to_warehouse_id',wb), jsonb_build_array(jsonb_build_object('product_id',fp,'variant_id',v16,'quantity',30)));
  perform public.post_stock_document('STOCK_TRANSFER', trf);
  insert into t_out select 4, 'FP16 A='||(select on_hand from public.stock_balances where warehouse_id=wa and variant_id=v16)||' B='||(select on_hand from public.stock_balances where warehouse_id=wb and variant_id=v16)||' (expect 70/30)';
  begin
    trf := public.save_stock_transfer(null, jsonb_build_object('company_id',c,'from_warehouse_id',wa,'to_warehouse_id',wb), jsonb_build_array(jsonb_build_object('product_id',fp,'variant_id',v20,'quantity',60)));
    perform public.post_stock_document('STOCK_TRANSFER', trf);
    insert into t_out values (5,'BAD: over-transfer allowed');
  exception when others then insert into t_out values (5,'over-transfer blocked: '||sqlerrm); end;
  begin
    perform public.save_goods_receipt(null, jsonb_build_object('company_id',c,'warehouse_id',wa), jsonb_build_array(jsonb_build_object('product_id',fp,'quantity',5)));
    insert into t_out values (6,'BAD: missing variant allowed');
  exception when others then insert into t_out values (6,'missing variant blocked: '||sqlerrm); end;
  r := public.create_reservation(c, wa, fp, v16, 60);
  insert into t_out select 7, 'reserved 60; available now '||available||' (expect 10)' from public.stock_on_hand where warehouse_id=wa and variant_id=v16;
  begin
    perform public.create_reservation(c, wa, fp, v16, 20);
    insert into t_out values (8,'BAD: over-reservation allowed');
  exception when others then insert into t_out values (8,'over-reserve blocked: '||sqlerrm); end;
  cnt := public.create_stock_count(c, wb, 'INITIAL_COUNT', null, true);
  select id into lid from public.stock_count_lines where count_id=cnt;
  perform public.save_stock_count_lines(cnt, jsonb_build_array(jsonb_build_object('id',lid,'counted_qty',28)));
  x := public.post_stock_count(cnt);
  insert into t_out select 9, 'count: before='||system_qty_before||' adj='||adjustment_qty||' after='||system_qty_after||' (expect 30/-2/28)' from public.stock_count_lines where id=lid;
  x := public.reverse_stock_document('GOODS_RECEIPT', grn, 'test reversal');
  select sum(on_hand) into q from public.stock_balances where warehouse_id=wa and product_id=cl; insert into t_out values (10,'clamp after reversal = '||q||' (expect 200)');
  begin
    update public.stock_movements set quantity = 999 where source_id = adj;
    insert into t_out values (11,'BAD: movement editable');
  exception when others then insert into t_out values (11,'movement edit blocked: '||sqlerrm); end;
  insert into t_out select 12, 'drift rows = '||count(*)||' (expect 0)' from public.stock_balance_drift(c);
  insert into t_out select 13, 'variant auto-SKUs: '||string_agg(sku, ', ') from public.product_variants where product_id=fp;
end $$;
reset role;
select * from t_out order by step;
rollback;
