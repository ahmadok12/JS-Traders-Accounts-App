-- Stage 5 corrections (rolls back): revise approved / part-delivered SO, correct GDN, correct / reverse invoice.
-- Expected: no row starts with "BAD"; drift 0; trial balance equal.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; pcs uuid; wa uuid; wb uuid; fan uuid; bolt uuid; cu uuid; adj uuid; so uuid; g1 uuid; g2 uuid; inv uuid; inv2 uuid; res jsonb;
  a_fa uuid; a_fb uuid; l1 uuid; s text; bank uuid; v numeric;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'S-A') returning id into wa;
  insert into public.warehouses(company_id,name) values (c,'S-B') returning id into wb;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Fan',pcs) returning id into fan;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Bolt',pcs) returning id into bolt;
  insert into public.customers(company_id,name) values (c,'T Buyer') returning id into cu;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',100), jsonb_build_object('product_id',bolt,'quantity',500)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wb,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',60)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  so := public.save_sales_order(null, jsonb_build_object('company_id',c,'customer_id',cu), jsonb_build_array(
    jsonb_build_object('product_id',fan,'unit_price',1000,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',50),jsonb_build_object('warehouse_id',wb,'quantity',30)))));
  perform public.approve_sales_order(so);
  select id into l1 from public.sales_order_lines where sales_order_id=so and is_active;
  select id into a_fa from public.sales_order_line_warehouse_allocations where sales_order_line_id=l1 and warehouse_id=wa;
  select id into a_fb from public.sales_order_line_warehouse_allocations where sales_order_line_id=l1 and warehouse_id=wb;
  g1 := public.save_gdn(null, jsonb_build_object('company_id',c,'sales_order_id',so), jsonb_build_array(jsonb_build_object('allocation_id',a_fa,'quantity',20)));
  res := public.post_gdn(g1);

  -- 1. revise: A 50→25, B 30→40, price 1100, add bolts 100 from A
  perform public.revise_sales_order(so, jsonb_build_object('customer_id',cu), jsonb_build_array(
    jsonb_build_object('id',l1,'product_id',fan,'unit_price',1100,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',25),jsonb_build_object('warehouse_id',wb,'quantity',40))),
    jsonb_build_object('product_id',bolt,'unit_price',10,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',100)))));
  insert into t_out select 1, 'revised: fan qty='||(select quantity from public.sales_order_lines where id=l1)::numeric(8,0)||' (65) held A='||
    (select sum(quantity) from public.reservations where sales_order_id=so and product_id=fan and warehouse_id=wa and status='ACTIVE')::numeric(8,0)||' (5) B='||
    (select sum(quantity) from public.reservations where sales_order_id=so and product_id=fan and warehouse_id=wb and status='ACTIVE')::numeric(8,0)||' (40) bolts='||
    (select sum(quantity) from public.reservations where sales_order_id=so and product_id=bolt and status='ACTIVE')::numeric(8,0)||' (100) status='||(select status from public.sales_orders where id=so);
  insert into t_out select 2, 'stock reserved total fan A='||reserved::numeric(8,0)||' (5)' from public.stock_on_hand where product_id=fan and warehouse_id=wa;
  -- 2. below sent → blocked
  begin
    perform public.revise_sales_order(so, jsonb_build_object('customer_id',cu), jsonb_build_array(
      jsonb_build_object('id',l1,'product_id',fan,'unit_price',1100,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',10)))));
    insert into t_out values (3,'BAD: reduced below sent');
  exception when others then insert into t_out values (3,'below-sent blocked: '||sqlerrm); end;
  -- 3. remove dispatched line → blocked
  begin
    perform public.revise_sales_order(so, jsonb_build_object('customer_id',cu), jsonb_build_array(
      jsonb_build_object('product_id',bolt,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',100)))));
    insert into t_out values (4,'BAD: removed dispatched line');
  exception when others then insert into t_out values (4,'remove dispatched blocked: '||sqlerrm); end;
  -- 4. remove B from fan (nothing sent there) → allocation cancelled, reservation released
  perform public.revise_sales_order(so, jsonb_build_object('customer_id',cu), jsonb_build_array(
    jsonb_build_object('id',l1,'product_id',fan,'unit_price',1100,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',25))),
    jsonb_build_object('product_id',bolt,'unit_price',10,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',100)))));
  insert into t_out select 5, 'B dropped: alloc='||(select status from public.sales_order_line_warehouse_allocations where id=a_fb)||' held B='||
    coalesce((select sum(quantity) from public.reservations where sales_order_id=so and warehouse_id=wb and status='ACTIVE'),0)||' bolt line kept='||
    (select count(*) from public.sales_order_lines where sales_order_id=so and is_active and product_id=bolt);

  -- 5. correct GDN1: reversed + new draft with the same 20
  g2 := public.correct_gdn(g1, 'wrong qty');
  insert into t_out select 6, 'correct GDN: old='||(select status from public.gdns where id=g1)||' new='||status||' lines='||lines_draft::text from public.gdns where id=g2;
  insert into t_out select 7, 'after GDN reversal held A='||(select sum(quantity) from public.reservations where sales_order_id=so and product_id=fan and warehouse_id=wa and status='ACTIVE')::numeric(8,0)||' (25) SO='||(select status from public.sales_orders where id=so);
  perform public.save_gdn(g2, jsonb_build_object('company_id',c,'sales_order_id',so), jsonb_build_array(jsonb_build_object('allocation_id',a_fa,'quantity',15)));
  res := public.post_gdn(g2);
  insert into t_out select 8, 'new GDN posted fan A on hand='||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0)||' (85)';

  -- 6. invoice, pay part, correct it
  inv := public.create_invoice_from_gdns(c, array[g2]);
  perform public.save_sales_invoice(inv, jsonb_build_object('discount_amount',500,'notes','n1'), '[{"unit_price":1200,"description":"blue"}]');
  select id into bank from public.bank_accounts where company_id=c and code='CASH';
  res := public.post_sales_invoice(inv, jsonb_build_object('bank_account_id',bank,'amount',5000));
  begin
    perform public.reverse_sales_invoice_full(inv, 'x', null, false);
    insert into t_out values (9,'BAD: reversed with payments without release');
  exception when others then insert into t_out values (9,'reverse w/o release blocked'); end;
  inv2 := public.correct_sales_invoice(inv, 'price fix');
  insert into t_out select 10, 'corrected: old='||(select status from public.sales_invoices where id=inv)||' new='||status||' price='||(lines_draft->0->>'unit_price')||
    ' desc='||coalesce(lines_draft->0->>'description','-')||' total='||total_amount||' (17500) carry='||jsonb_array_length(carry_receipts) from public.sales_invoices where id=inv2;
  insert into t_out select 11, 'old allocations active='||count(*) filter (where status='ACTIVE') from public.receipt_allocations where invoice_id=inv;
  perform public.save_sales_invoice(inv2, jsonb_build_object('discount_amount',500), '[{"unit_price":1100}]');
  res := public.post_sales_invoice(inv2);
  perform public.allocate_receipt((select (carry_receipts->0->>'receipt_entry_id')::uuid from public.sales_invoices where id=inv2),
    jsonb_build_array(jsonb_build_object('invoice_id',inv2,'amount',5000)));
  insert into t_out select 12, 'new invoice total='||total_amount||' (16000) outstanding='||outstanding||' (11000) '||payment_status from public.sales_invoices_v where id=inv2;
  select balance into v from public.party_statement('CUSTOMER', cu) where row_kind='TXN' order by entry_date desc, entry_no desc limit 1;
  insert into t_out values (13, 'statement balance='||v||' (11000)');
  -- 7. reverse with release
  res := public.reverse_sales_invoice_full(inv2, 'cancelled deal', null, true);
  insert into t_out select 14, 'reversed with release: '||status||' released='||jsonb_array_length(res->'released')||' gdn invoiced='||(select sum(invoiced_qty) from public.gdn_lines where gdn_id=g2) from public.sales_invoices where id=inv2;
  select balance into v from public.party_statement('CUSTOMER', cu) where row_kind='TXN' order by entry_date desc, entry_no desc limit 1;
  insert into t_out values (15, 'statement balance='||v||' (-5000 advance)');
  insert into t_out select 16, 'drift rows = '||count(*)||' (0)' from public.stock_balance_drift(c);
  select sum(debit)||' = '||sum(credit) into s from public.trial_balance(c);
  insert into t_out values (17, 'trial balance '||s);
end $$;
reset role;
select * from t_out order by step;
rollback;
