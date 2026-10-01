-- Stage 5 sales chain (rolls back): SO (2 warehouses, edit, approve → reservations) → GDN (fans A+B, pipe rolls,
-- bundle components) → invoice (pending price blocks, discount, payment now) → statement → receipt allocation →
-- guards (over-dispatch, double invoicing, reversing allocated receipt / invoiced GDN) → GDN reversal re-reserves.
-- Expected: 18 rows, none starting with "BAD"; drift 0; trial balance equal.
-- (Body identical to the verification run of 1 Oct 2026 — see sprint notes.)
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; pcs uuid; mtr uuid; wa uuid; wb uuid; fan uuid; pipe uuid; kit uuid; cu uuid; adj uuid; so uuid; g1 uuid; g2 uuid; inv uuid; res jsonb;
  a_fan_a uuid; a_fan_b uuid; a_pipe uuid; a_kit uuid; v numeric; s text; bank uuid; rcpt uuid; arid uuid; bankgl uuid; l1 uuid;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  select id into mtr from public.units_of_measure where code='MTR' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'S-A') returning id into wa;
  insert into public.warehouses(company_id,name) values (c,'S-B') returning id into wb;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Fan',pcs) returning id into fan;
  insert into public.products(company_id,name,base_uom_id,tracking_type) values (c,'T Pipe',mtr,'PHYSICAL_UNIT') returning id into pipe;
  insert into public.products(company_id,name,base_uom_id,is_bundle) values (c,'T Kit',pcs,true) returning id into kit;
  insert into public.product_components(company_id,parent_product_id,component_product_id,quantity) values (c,kit,fan,2);
  insert into public.customers(company_id,name) values (c,'T Buyer') returning id into cu;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',100), jsonb_build_object('product_id',pipe,'quantity',300)));
  perform public.save_unit_plan('STOCK_ADJUSTMENT', adj, '{"2":[{"qty":100},{"qty":100},{"qty":100}]}');
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wb,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',40)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  so := public.save_sales_order(null, jsonb_build_object('company_id',c,'customer_id',cu),
    jsonb_build_array(
      jsonb_build_object('product_id',fan,'unit_price',12000,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',50),jsonb_build_object('warehouse_id',wb,'quantity',30))),
      jsonb_build_object('product_id',pipe,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',150))),
      jsonb_build_object('product_id',kit,'unit_price',25000,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',5)))));
  insert into t_out select 1, 'SO lines='||count(*)||' fan qty='||max(quantity) filter (where product_id=fan) from public.sales_order_lines where sales_order_id=so and is_active;
  select id into l1 from public.sales_order_lines where sales_order_id=so and product_id=fan and is_active;
  perform public.save_sales_order(so, jsonb_build_object('company_id',c,'customer_id',cu),
    jsonb_build_array(
      jsonb_build_object('id',l1,'product_id',fan,'unit_price',12500,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',50),jsonb_build_object('warehouse_id',wb,'quantity',30))),
      jsonb_build_object('product_id',pipe,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',150))),
      jsonb_build_object('product_id',kit,'unit_price',25000,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',5)))));
  insert into t_out select 2, 'edited: fan line kept='||(exists(select 1 from public.sales_order_lines where id=l1 and is_active and unit_price=12500));
  perform public.approve_sales_order(so);
  insert into t_out select 3, 'approved: reserved fan A='||(select sum(quantity) from public.reservations where sales_order_id=so and warehouse_id=wa and product_id=fan and status='ACTIVE')||' B='||(select sum(quantity) from public.reservations where sales_order_id=so and warehouse_id=wb and status='ACTIVE');
  select al.id into a_fan_a from public.sales_order_line_warehouse_allocations al join public.sales_order_lines l on l.id=al.sales_order_line_id where l.sales_order_id=so and l.product_id=fan and al.warehouse_id=wa;
  select al.id into a_fan_b from public.sales_order_line_warehouse_allocations al join public.sales_order_lines l on l.id=al.sales_order_line_id where l.sales_order_id=so and l.product_id=fan and al.warehouse_id=wb;
  select al.id into a_pipe from public.sales_order_line_warehouse_allocations al join public.sales_order_lines l on l.id=al.sales_order_line_id where l.sales_order_id=so and l.product_id=pipe and l.is_active;
  select al.id into a_kit from public.sales_order_line_warehouse_allocations al join public.sales_order_lines l on l.id=al.sales_order_line_id where l.sales_order_id=so and l.product_id=kit and l.is_active;
  g1 := public.save_gdn(null, jsonb_build_object('company_id',c,'sales_order_id',so), jsonb_build_array(
    jsonb_build_object('allocation_id',a_fan_a,'quantity',40), jsonb_build_object('allocation_id',a_fan_b,'quantity',20),
    jsonb_build_object('allocation_id',a_pipe,'quantity',150), jsonb_build_object('allocation_id',a_kit,'quantity',5)));
  res := public.post_gdn(g1);
  insert into t_out select 4, 'GDN1: fan A='||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0)||' (50) B='||public.inv_item_on_hand(wb,null,fan,null)::numeric(8,0)||' (20) pipe rolls='||(select string_agg(remaining_qty::numeric(8,0)::text,'/' order by remaining_qty) from public.physical_units where product_id=pipe)||' SO='||(select status from public.sales_orders where id=so);
  insert into t_out select 5, 'reservations left A='||coalesce((select sum(quantity) from public.reservations where sales_order_id=so and warehouse_id=wa and product_id=fan and status='ACTIVE'),0)||' B='||coalesce((select sum(quantity) from public.reservations where sales_order_id=so and warehouse_id=wb and status='ACTIVE'),0)||' (10/10)';
  begin
    perform public.save_gdn(null, jsonb_build_object('company_id',c,'sales_order_id',so), jsonb_build_array(jsonb_build_object('allocation_id',a_fan_a,'quantity',11)));
    insert into t_out values (6,'BAD: over-dispatch allowed');
  exception when others then insert into t_out values (6,'over-dispatch blocked'); end;
  inv := public.create_invoice_from_gdns(c, array[g1]);
  insert into t_out select 7, 'invoice draft lines='||jsonb_array_length(lines_draft) from public.sales_invoices where id=inv;
  begin res := public.post_sales_invoice(inv); insert into t_out values (8,'BAD: posted with pending price');
  exception when others then insert into t_out values (8,'pending price blocks posting'); end;
  select string_agg(case when (j->>'product_id')::uuid=pipe then '{"unit_price":300}' else jsonb_build_object('unit_price',j->'unit_price')::text end, ',' order by ord) into s
    from public.sales_invoices i, jsonb_array_elements(i.lines_draft) with ordinality as t(j, ord) where i.id=inv;
  perform public.save_sales_invoice(inv, jsonb_build_object('discount_amount',5000), ('['||s||']')::jsonb);
  select id into bank from public.bank_accounts where company_id=c and code='CASH';
  res := public.post_sales_invoice(inv, jsonb_build_object('bank_account_id',bank,'amount',300000,'reference','cash'));
  insert into t_out select 9, 'invoice total='||total_amount||' (915000) outstanding='||outstanding||' '||payment_status from public.sales_invoices_v where id=inv;
  select balance into v from public.party_statement('CUSTOMER', cu) where row_kind='TXN' order by entry_date desc, entry_no desc limit 1;
  insert into t_out values (10, 'customer statement balance='||v||' (615000)');
  begin perform public.create_invoice_from_gdns(c, array[g1]); insert into t_out values (11,'BAD: double invoicing');
  exception when others then insert into t_out values (11,'double invoicing blocked'); end;
  g2 := public.save_gdn(null, jsonb_build_object('company_id',c,'sales_order_id',so), jsonb_build_array(
    jsonb_build_object('allocation_id',a_fan_a,'quantity',10), jsonb_build_object('allocation_id',a_fan_b,'quantity',10)));
  res := public.post_gdn(g2);
  insert into t_out select 12, 'after GDN2 SO status='||status||' (DELIVERED)' from public.sales_orders where id=so;
  rcpt := public.receive_invoice_payment(inv, bank, 615000, null, 'bank transfer');
  insert into t_out select 13, 'after payment: '||payment_status||' outstanding='||outstanding from public.sales_invoices_v where id=inv;
  begin perform public.reverse_journal_entry(rcpt, 'test'); insert into t_out values (14,'BAD: allocated receipt reversed');
  exception when others then insert into t_out values (14,'allocated receipt cannot be reversed'); end;
  begin perform public.reverse_gdn(g1, 'test'); insert into t_out values (15,'BAD: invoiced GDN reversed');
  exception when others then insert into t_out values (15,'invoiced GDN reversal blocked'); end;
  res := public.reverse_gdn(g2, 'returned');
  insert into t_out select 16, 'GDN2 reversed: re-reserved A='||(select sum(quantity) from public.reservations where sales_order_id=so and warehouse_id=wa and product_id=fan and status='ACTIVE')||' SO='||(select status from public.sales_orders where id=so);
  insert into t_out select 17, 'drift rows = '||count(*)||' (0)' from public.stock_balance_drift(c);
  select sum(debit)||' = '||sum(credit) into s from public.trial_balance(c);
  insert into t_out values (18, 'trial balance '||s);
end $$;
reset role;
select * from t_out order by step;
rollback;
