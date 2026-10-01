-- Stock adjustment entry modes (rolls back).
-- Expected: 1) +40  2) -15 / after 125  3) target recalculated at post  4) opening below stock blocked  5) drift 0
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; pcs uuid; wa uuid; cl uuid; adj uuid; adj2 uuid;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'Test A') returning id into wa;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Clamp',pcs) returning id into cl;
  -- opening 100 via "add / remove"
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',cl,'quantity',100)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  -- "enter new quantity": counted 140 -> +40
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','COUNT_CORRECTION','entry_mode','SET'),
    jsonb_build_array(jsonb_build_object('product_id',cl,'target_qty',140)));
  insert into t_out select 1, 'set 140 from 100 -> change '||quantity||' (expect 40)' from public.stock_adjustment_lines where adjustment_id=adj;
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  -- "add / remove": remove 15
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','DAMAGE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',cl,'quantity',-15)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  insert into t_out select 2, 'after damage -15: '||public.inv_item_on_hand(wa,null,cl,null)||' (expect 125)';
  -- draft "set to 100" saved now (change -25), then stock changes before posting
  adj2 := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','COUNT_CORRECTION','entry_mode','SET'),
    jsonb_build_array(jsonb_build_object('product_id',cl,'target_qty',100)));
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','FOUND_STOCK','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',cl,'quantity',5)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj2);
  insert into t_out select 3, 'posted set-100 after +5: before='||system_qty||' change='||quantity||' now='||public.inv_item_on_hand(wa,null,cl,null)||' (expect 130 / -30 / 100)'
    from public.stock_adjustment_lines where adjustment_id=adj2;
  begin
    perform public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','SET'),
      jsonb_build_array(jsonb_build_object('product_id',cl,'target_qty',50)));
    insert into t_out values (4,'BAD: opening below stock allowed');
  exception when others then insert into t_out values (4,'opening below stock blocked: '||sqlerrm); end;
  insert into t_out select 5, 'drift rows = '||count(*)||' (expect 0)' from public.stock_balance_drift(c);
end $$;
reset role;
select * from t_out order by step;
rollback;
