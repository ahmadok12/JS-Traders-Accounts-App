-- Components (BOM), assembly / disassembly, bundle availability (rolls back).
-- Expected: 10 rows, none starting with "BAD", drift rows = 0.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; pcs uuid; wa uuid; fan uuid; v50 uuid; v36 uuid; mot uuid; clamp uuid; bun uuid; adj uuid; ao uuid; x jsonb;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'Test Asm') returning id into wa;
  insert into public.products(company_id,name,base_uom_id,has_variants,is_assembled) values (c,'T Fan',pcs,true,true) returning id into fan;
  insert into public.product_variants(company_id,product_id,sku,name) values (c,fan,'','50 inch') returning id into v50;
  insert into public.product_variants(company_id,product_id,sku,name) values (c,fan,'','36 inch') returning id into v36;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Motor',pcs) returning id into mot;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Clamp',pcs) returning id into clamp;
  insert into public.product_components(company_id,parent_product_id,component_product_id,quantity) values (c,fan,mot,1),(c,fan,clamp,4);
  insert into public.product_components(company_id,parent_product_id,parent_variant_id,component_product_id,quantity) values (c,fan,v36,mot,1),(c,fan,v36,clamp,2);
  insert into t_out select 1, 'BOM 50": '||string_agg(quantity::numeric(10,0)||'x', ' + ')||' | BOM 36": '||(select string_agg(quantity::numeric(10,0)||'x',' + ') from public.product_bom(fan,v36)) from public.product_bom(fan,v50);
  begin insert into public.product_components(company_id,parent_product_id,component_product_id,quantity) values (c,mot,fan,1);
        insert into t_out values (2,'BAD: non-assembled parent allowed');
  exception when others then insert into t_out values (2,'component on non-assembled item blocked'); end;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',mot,'quantity',10), jsonb_build_object('product_id',clamp,'quantity',30)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  insert into t_out select 3, 'can build 50": '||buildable||' (expect 7)' from public.product_buildable(fan, v50) where warehouse_id=wa;
  ao := public.save_assembly_order(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'product_id',fan,'variant_id',v50,'quantity',5,'kind','ASSEMBLY'));
  x := public.post_assembly_order(ao);
  insert into t_out select 4, 'after assembling 5: '||public.inv_item_on_hand(wa,null,fan,v50)||'/'||public.inv_item_on_hand(wa,null,mot,null)||'/'||public.inv_item_on_hand(wa,null,clamp,null)||' (expect 5/5/10)';
  begin
    ao := public.save_assembly_order(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'product_id',fan,'variant_id',v50,'quantity',3,'kind','ASSEMBLY'));
    perform public.post_assembly_order(ao);
    insert into t_out values (5,'BAD: assembled without enough clamps');
  exception when others then insert into t_out values (5,'short components blocked'); end;
  ao := public.save_assembly_order(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'product_id',fan,'variant_id',v50,'quantity',2,'kind','DISASSEMBLY'));
  x := public.post_assembly_order(ao);
  insert into t_out select 6, 'after disassembling 2: '||public.inv_item_on_hand(wa,null,fan,v50)||'/'||public.inv_item_on_hand(wa,null,mot,null)||'/'||public.inv_item_on_hand(wa,null,clamp,null)||' (expect 3/7/18)';
  x := public.reverse_assembly_order(ao, 'test');
  insert into t_out select 7, 'disassembly reversed: '||public.inv_item_on_hand(wa,null,fan,v50)||'/'||public.inv_item_on_hand(wa,null,mot,null)||'/'||public.inv_item_on_hand(wa,null,clamp,null)||' (expect 5/5/10)';
  insert into public.products(company_id,name,base_uom_id,is_bundle) values (c,'T Kit',pcs,true) returning id into bun;
  insert into public.product_components(company_id,parent_product_id,component_product_id,quantity) values (c,bun,mot,2),(c,bun,clamp,1);
  insert into t_out select 8, 'bundle available: '||buildable||' (expect 2)' from public.product_buildable(bun, null) where warehouse_id=wa;
  begin
    perform public.save_assembly_order(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'product_id',bun,'quantity',1));
    insert into t_out values (9,'BAD: bundle assembled');
  exception when others then insert into t_out values (9,'bundle cannot be assembled'); end;
  insert into t_out select 10, 'drift rows = '||count(*)||' (expect 0)' from public.stock_balance_drift(c);
end $$;
reset role;
select * from t_out order by step;
rollback;
