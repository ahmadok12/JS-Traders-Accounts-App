-- Quick invoice (rolls back): setting off blocks; one call → approved SO, posted GDN, posted invoice (+ payment now);
-- idempotent; short stock blocked; quick invoice can be corrected. Expected: no "BAD" rows; drift 0; TB equal.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; pcs uuid; wa uuid; wb uuid; fan uuid; bolt uuid; cu uuid; adj uuid; inv uuid; inv2 uuid; k uuid := gen_random_uuid(); bank uuid; s text; ln jsonb;
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
  select id into bank from public.bank_accounts where company_id=c and code='CASH';
  ln := jsonb_build_array(
    jsonb_build_object('product_id',fan,'warehouse_id',wa,'quantity',10,'unit_price',1000,'description','red'),
    jsonb_build_object('product_id',fan,'warehouse_id',wb,'quantity',5,'unit_price',1000),
    jsonb_build_object('product_id',bolt,'warehouse_id',wa,'quantity',50,'unit_price',20));
  begin
    perform public.quick_sales_invoice(jsonb_build_object('company_id',c,'customer_id',cu), ln, null, null);
    insert into t_out values (1,'BAD: allowed while off');
  exception when others then insert into t_out values (1,'off blocks: '||sqlerrm); end;
  insert into public.system_settings(company_id,key,value) values (c,'sales.quick_invoice','true'::jsonb)
    on conflict (company_id,key) do update set value = excluded.value;
  inv := public.quick_sales_invoice(jsonb_build_object('company_id',c,'customer_id',cu,'discount_amount',100,'invoice_date','2026-10-01'), ln,
    jsonb_build_object('bank_account_id',bank,'amount',3000), k);
  insert into t_out select 2, 'quick: '||i.status||' total='||i.total_amount||' (15900) lines='||(select count(*) from public.sales_invoice_lines where invoice_id=inv)||' (2) desc='||
    coalesce((select string_agg(coalesce(description,'-'),',' order by line_no) from public.sales_invoice_lines where invoice_id=inv),'')||' '||v.payment_status||' out='||v.outstanding
    from public.sales_invoices i join public.sales_invoices_v v on v.id=i.id where i.id=inv;
  insert into t_out select 3, 'stock fan A='||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0)||' (90) B='||public.inv_item_on_hand(wb,null,fan,null)::numeric(8,0)||' (55) bolt='||public.inv_item_on_hand(wa,null,bolt,null)::numeric(8,0)||' (450)';
  insert into t_out select 4, 'SO status='||so.status||' reservations active='||(select count(*) from public.reservations where sales_order_id=so.id and status='ACTIVE')
    from public.sales_orders so where so.customer_id=cu;
  inv2 := public.quick_sales_invoice(jsonb_build_object('company_id',c,'customer_id',cu), ln, null, k);
  insert into t_out values (5, 'idempotent repeat same id='||(inv=inv2));
  begin
    perform public.quick_sales_invoice(jsonb_build_object('company_id',c,'customer_id',cu), jsonb_build_array(jsonb_build_object('product_id',fan,'warehouse_id',wb,'quantity',500,'unit_price',1)), null, null);
    insert into t_out values (6,'BAD: oversold');
  exception when others then insert into t_out values (6,'short stock blocked: '||sqlerrm); end;
  inv2 := public.correct_sales_invoice(inv, 'fix');
  insert into t_out select 7, 'quick invoice corrected → draft total='||total_amount||' carry='||jsonb_array_length(carry_receipts) from public.sales_invoices where id=inv2;
  insert into t_out select 8, 'drift rows = '||count(*) from public.stock_balance_drift(c);
  select sum(debit)||' = '||sum(credit) into s from public.trial_balance(c);
  insert into t_out values (9, 'trial balance '||s);
end $$;
reset role;
select * from t_out order by step;
rollback;
