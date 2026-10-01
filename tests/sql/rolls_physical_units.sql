-- Rolls / physical units (rolls back). Expected: 10 rows, none starting with "BAD", drift 0.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; mtr uuid; wa uuid; wb uuid; pipe uuid; grn uuid; trf uuid; adj uuid; x jsonb; r1 uuid; r2 uuid; cnt int; s text;
begin
  select id into c from public.companies limit 1;
  select id into mtr from public.units_of_measure where code='MTR' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'Roll A') returning id into wa;
  insert into public.warehouses(company_id,name) values (c,'Roll B') returning id into wb;
  insert into public.products(company_id,name,base_uom_id,tracking_type) values (c,'T Pipe',mtr,'PHYSICAL_UNIT') returning id into pipe;
  grn := public.save_goods_receipt(null, jsonb_build_object('company_id',c,'warehouse_id',wa), jsonb_build_array(jsonb_build_object('product_id',pipe,'quantity',250)));
  perform public.save_unit_plan('GOODS_RECEIPT', grn, '{"1":[{"qty":100,"label":"Lot A"},{"qty":100},{"qty":50}]}');
  perform public.post_stock_document('GOODS_RECEIPT', grn);
  select string_agg(remaining_qty::numeric(10,0)::text, ', ' order by unit_no) into s from public.physical_units where product_id=pipe;
  insert into t_out values (1, 'received rolls: '||s||' (expect 100, 100, 50)');
  select id into r1 from public.physical_units where product_id=pipe and original_qty=50;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','DAMAGE','entry_mode','CHANGE'), jsonb_build_array(jsonb_build_object('product_id',pipe,'quantity',-30)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  insert into t_out select 2, 'auto cut 30: 50-roll now '||remaining_qty::numeric(10,0)||' (expect 20)' from public.physical_units where id=r1;
  select id into r2 from public.physical_units where product_id=pipe and label='Lot A';
  trf := public.save_stock_transfer(null, jsonb_build_object('company_id',c,'from_warehouse_id',wa,'to_warehouse_id',wb), jsonb_build_array(jsonb_build_object('product_id',pipe,'quantity',115)));
  perform public.save_unit_plan('STOCK_TRANSFER', trf, jsonb_build_object('1', jsonb_build_array(jsonb_build_object('unit_id',r2,'qty',100), jsonb_build_object('unit_id',r1,'qty',15))));
  perform public.post_stock_document('STOCK_TRANSFER', trf);
  select string_agg(w.name||'='||u.remaining_qty::numeric(10,0)||case when u.parent_unit_id is not null then '(child)' else '' end||case when u.id=r2 then '(same roll)' else '' end, ', ' order by w.name, u.remaining_qty) into s
    from public.physical_units u join public.warehouses w on w.id=u.warehouse_id where u.product_id=pipe and u.remaining_qty>0;
  insert into t_out values (3, 'after transfer: '||s||' (expect A=5, A=100, B=15(child), B=100(same roll))');
  insert into t_out select 4, 'totals A='||public.inv_item_on_hand(wa,null,pipe,null)::numeric(10,0)||' B='||public.inv_item_on_hand(wb,null,pipe,null)::numeric(10,0)||' (expect 105 / 115)';
  x := public.reverse_stock_document('STOCK_TRANSFER', trf, 'test');
  select string_agg(w.name||'='||u.remaining_qty::numeric(10,0), ', ' order by w.name, u.remaining_qty) into s
    from public.physical_units u join public.warehouses w on w.id=u.warehouse_id where u.product_id=pipe and u.remaining_qty>0;
  insert into t_out values (5, 'transfer reversed: '||s||' (expect A=20, A=100, A=100)');
  begin
    trf := public.save_stock_transfer(null, jsonb_build_object('company_id',c,'from_warehouse_id',wa,'to_warehouse_id',wb), jsonb_build_array(jsonb_build_object('product_id',pipe,'quantity',30)));
    perform public.save_unit_plan('STOCK_TRANSFER', trf, jsonb_build_object('1', jsonb_build_array(jsonb_build_object('unit_id',r1,'qty',30))));
    perform public.post_stock_document('STOCK_TRANSFER', trf);
    insert into t_out values (6,'BAD: over-cut allowed');
  exception when others then insert into t_out values (6,'over-cut blocked'); end;
  perform public.correct_unit_length(r1, 18, 'COUNT_CORRECTION');
  insert into t_out select 7, 'roll corrected: '||remaining_qty::numeric(10,0)||', total A='||public.inv_item_on_hand(wa,null,pipe,null)::numeric(10,0)||' (expect 18 / 218)' from public.physical_units where id=r1;
  update public.products set tracking_type='NONE' where id=pipe;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','FOUND_STOCK','entry_mode','CHANGE'), jsonb_build_array(jsonb_build_object('product_id',pipe,'quantity',40)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  update public.products set tracking_type='PHYSICAL_UNIT' where id=pipe;
  cnt := public.register_units(c, wa, pipe, null, '[{"qty":25},{"qty":15}]');
  insert into t_out select 8, 'registered '||cnt||' rolls; in rolls='||(select sum(remaining_qty) from public.physical_units where warehouse_id=wa and product_id=pipe)::numeric(10,0)||' total='||public.inv_item_on_hand(wa,null,pipe,null)::numeric(10,0)||' (expect 258 / 258)';
  begin
    perform public.register_units(c, wa, pipe, null, '[{"qty":5}]');
    insert into t_out values (9,'BAD: over-register allowed');
  exception when others then insert into t_out values (9,'over-register blocked'); end;
  insert into t_out select 10, 'drift rows = '||count(*)||' (expect 0)' from public.stock_balance_drift(c);
end $$;
reset role;
select * from t_out order by step;
rollback;
