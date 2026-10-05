-- Sales returns and purchase returns. Runs as the administrator and rolls back.
-- Expected: every row starts with "ok".
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
set constraints all immediate;  -- value stock movements as they happen (normally at commit)
do $$
declare c uuid; pcs uuid; wa uuid; fan uuid; cu uuid; sup uuid; supx uuid; adj uuid; so uuid; al uuid; g uuid; gl uuid; inv uuid; res jsonb; s text; v numeric; v2 numeric;
  sr1 uuid; sr2 uuid; grn uuid; rl uuid; pr1 uuid; pr2 uuid; bill uuid; grn2 uuid; rl2 uuid; bill2 uuid; pr3 uuid; d0 numeric; d1 numeric; x jsonb;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  select coalesce(difference,0) into d0 from public.stock_valuation_totals(c);
  insert into public.warehouses(company_id,name) values (c,'R-Test WH') returning id into wa;
  insert into public.products(company_id,name,base_uom_id) values (c,'R Test Fan',pcs) returning id into fan;
  insert into public.customers(company_id,name) values (c,'R Test Buyer') returning id into cu;
  insert into public.suppliers(company_id,name) values (c,'R Test Supplier PKR') returning id into sup;
  insert into public.suppliers(company_id,name,default_currency) values (c,'R Test Supplier CNY','CNY') returning id into supx;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',100,'unit_cost',1000)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  perform public.set_opening_stock_cost(c, current_date, jsonb_build_array(jsonb_build_object('product_id',fan,'unit_cost',1000)));

  -- sale: 30 dispatched
  so := public.save_sales_order(null, jsonb_build_object('company_id',c,'customer_id',cu),
    jsonb_build_array(jsonb_build_object('product_id',fan,'unit_price',1500,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',30)))));
  perform public.approve_sales_order(so);
  select a.id into al from public.sales_order_line_warehouse_allocations a join public.sales_order_lines l on l.id=a.sales_order_line_id where l.sales_order_id=so;
  g := public.save_gdn(null, jsonb_build_object('company_id',c,'sales_order_id',so), jsonb_build_array(jsonb_build_object('allocation_id',al,'quantity',30)));
  res := public.post_gdn(g);
  select id into gl from public.gdn_lines where gdn_id=g;

  -- 1. return 5 before invoicing: no credit note, those 5 are no longer to invoice
  sr1 := public.post_sales_return(jsonb_build_object('gdn_id',g,'reason','wrong item'), jsonb_build_array(jsonb_build_object('gdn_line_id',gl,'quantity',5)));
  select 'stock '||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0)||' open '||returned_open_qty::numeric(8,0)||' credit '||(select max(total) from public.return_amounts('SALES', sr1))
    into s from public.gdn_lines where id=gl;
  insert into t_out values (1, case when s='stock 75 open 5 credit 0.00' then 'ok' else 'BAD' end||' return before invoice: '||s);
  inv := public.create_invoice_from_gdns(c, array[g]);
  select (lines_draft->0->>'quantity') into s from public.sales_invoices where id=inv;
  insert into t_out values (2, case when s::numeric=25 then 'ok' else 'BAD' end||' invoice from GDN after return qty='||s||' (25)');
  res := public.post_sales_invoice(inv);

  -- 2. return 10 after invoicing: credit note 15,000 set against the invoice
  sr2 := public.post_sales_return(jsonb_build_object('gdn_id',g,'reason','damaged in transit'), jsonb_build_array(jsonb_build_object('gdn_line_id',gl,'quantity',10,'condition','DAMAGED')));
  select 'credit '||(select max(total) from public.return_amounts('SALES', sr2))||' outstanding '||i.outstanding||' stock '||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0) into s
    from public.sales_invoices_v i where i.id=inv;
  insert into t_out values (3, case when s='credit 15000.00 outstanding 22500.00 stock 85' then 'ok' else 'BAD' end||' return after invoice: '||s);
  select sum(jl.debit-jl.credit) into v from public.journal_lines jl join public.journal_entries je on je.id=jl.entry_id
   where je.source_type='SALES_RETURN' and je.source_id=sr2 and jl.account_id=public.hr_account(c,'SALES_RETURNS');
  select sum(jl.credit-jl.debit) into v2 from public.journal_lines jl join public.journal_entries je on je.id=jl.entry_id
   where je.source_type='STOCK_VALUE' and je.source_id in (sr1, sr2) and jl.account_id=public.hr_account(c,'COGS');
  insert into t_out values (4, case when v=15000 and v2=15000 then 'ok' else 'BAD' end||' ledger: sales returns Dr '||v||', COGS back '||v2||' (15000 / 15000 = 15 x 1000)');

  -- 3. guards
  begin perform public.post_sales_return(jsonb_build_object('gdn_id',g,'reason','x'), jsonb_build_array(jsonb_build_object('gdn_line_id',gl,'quantity',16)));
    insert into t_out values (5,'BAD: over-return allowed');
  exception when others then insert into t_out values (5,'ok over-return blocked: '||sqlerrm); end;
  begin perform public.reverse_sales_invoice_full(inv, 'x', null, false); insert into t_out values (6,'BAD: invoice reversed under a return');
  exception when others then insert into t_out values (6,'ok invoice reversal blocked: '||sqlerrm); end;
  begin res := public.reverse_gdn(g, 'x'); insert into t_out values (7,'BAD: GDN reversed under returns');
  exception when others then insert into t_out values (7,'ok GDN reversal blocked: '||sqlerrm); end;

  -- 4. undo the credited return
  res := public.reverse_sales_return(sr2, 'entered twice');
  select 'outstanding '||i.outstanding||' stock '||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0)||' credit qty '||l.returned_credit_qty::numeric(8,0)
    into s from public.sales_invoices_v i, public.gdn_lines l where i.id=inv and l.id=gl;
  insert into t_out values (8, case when s='outstanding 37500.00 stock 75 credit qty 0' then 'ok' else 'BAD' end||' sales return reversed: '||s);

  -- 5. purchase: receipt 50, return 10 before any cost / bill
  grn := public.save_goods_receipt(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'supplier_id',sup), jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',50)));
  perform public.post_stock_document('GOODS_RECEIPT', grn);
  select id into rl from public.goods_receipt_lines where receipt_id=grn;
  pr1 := public.post_purchase_return(jsonb_build_object('receipt_id',grn,'reason','short shipped'), jsonb_build_array(jsonb_build_object('receipt_line_id',rl,'quantity',10)));
  select 'stock '||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0)||' unbilled-returned '||returned_unbilled_qty::numeric(8,0)||' value '||coalesce((select max(total) from public.return_amounts('PURCHASE', pr1)), -1)
    into s from public.goods_receipt_lines where id=rl;
  insert into t_out values (9, case when s='stock 115 unbilled-returned 10 value 0.00' then 'ok' else 'BAD' end||' return before bill: '||s);
  bill := public.create_bill_from_receipts(c, array[grn]);
  select (lines_draft->0->>'quantity') into s from public.supplier_bills where id=bill;
  insert into t_out values (10, case when s::numeric=40 then 'ok' else 'BAD' end||' bill from receipt after return qty='||s||' (40)');
  perform public.save_supplier_bill(bill, jsonb_build_object('company_id',c,'supplier_id',sup,'bill_date',current_date,'currency','PKR','fx_rate',1),
    jsonb_build_array(jsonb_build_object('kind','ITEM','receipt_line_id',rl,'quantity',40,'unit_price',1100)), null);
  perform public.post_supplier_bill(bill, null);

  -- 6. return 5 billed goods: debit note 5,500 set against the bill
  pr2 := public.post_purchase_return(jsonb_build_object('receipt_id',grn,'reason','faulty'), jsonb_build_array(jsonb_build_object('receipt_line_id',rl,'quantity',5)));
  select 'value '||(select max(total) from public.return_amounts('PURCHASE', pr2))||' outstanding '||b.outstanding_pkr||' stock '||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0) into s
    from public.supplier_bills_v b where b.id=bill;
  insert into t_out values (11, case when s='value 5500.00 outstanding 38500.00 stock 110' then 'ok' else 'BAD' end||' return after bill: '||s);
  select coalesce(sum(jl.debit-jl.credit),0) into v from public.journal_lines jl join public.journal_entries je on je.id=jl.entry_id
   where je.source_id in (pr1, pr2) and jl.account_id=public.hr_account(c,'GRNI');
  insert into t_out values (12, case when v=0 then 'ok' else 'BAD' end||' GRNI nets to zero on returns: '||v);

  select qty::numeric(10,0)||' / '||value||' / pending '||pending_qty::numeric(10,0) into s from public.item_costs where product_id=fan;
  insert into t_out values (18, case when s='110 / 113500.00 / pending 0' then 'ok' else 'BAD' end||' average cost book: '||s||' (75 x 1000 + 35 x 1100)');
  -- 7. foreign-currency bill: receipt 10, bill CNY 50 @ 40, return 2 → debit note ¥100 / Rs 4,000
  grn2 := public.save_goods_receipt(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'supplier_id',supx), jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',10)));
  perform public.post_stock_document('GOODS_RECEIPT', grn2);
  select id into rl2 from public.goods_receipt_lines where receipt_id=grn2;
  bill2 := public.save_supplier_bill(null, jsonb_build_object('company_id',c,'supplier_id',supx,'bill_date',current_date,'currency','CNY','fx_rate',40),
    jsonb_build_array(jsonb_build_object('kind','ITEM','receipt_line_id',rl2,'quantity',10,'unit_price',50)), null);
  perform public.post_supplier_bill(bill2, null);
  pr3 := public.post_purchase_return(jsonb_build_object('receipt_id',grn2,'reason','wrong colour'), jsonb_build_array(jsonb_build_object('receipt_line_id',rl2,'quantity',2)));
  select 'outstanding CNY '||b.outstanding_fx||' AP line '||(select string_agg(jl.currency||' '||jl.fx_amount||' pkr '||jl.debit, ';') from public.journal_lines jl
     where jl.entry_id = any(h.debit_entry_ids) and jl.debit > 0 and jl.party_type='SUPPLIER') into s
    from public.purchase_returns h, public.supplier_bills_v b where h.id=pr3 and b.id=bill2;
  insert into t_out values (13, case when s like 'outstanding CNY 400.00 AP line CNY 100.00% pkr 4000.00' then 'ok' else 'BAD' end||' foreign debit note: '||s);
  res := public.reverse_purchase_return(pr3, 'supplier refused');
  select 'outstanding CNY '||outstanding_fx||' stock '||public.inv_item_on_hand(wa,null,fan,null)::numeric(8,0) into s from public.supplier_bills_v where id=bill2;
  insert into t_out values (14, case when s='outstanding CNY 500.00 stock 120' then 'ok' else 'BAD' end||' purchase return reversed: '||s);
  begin perform public.reverse_stock_document('GOODS_RECEIPT', grn, 'x'); insert into t_out values (15,'BAD: receipt reversed under returns');
  exception when others then insert into t_out values (15,'ok receipt reversal blocked: '||sqlerrm); end;

  -- 8. stock value still equals the ledger; returns appear in the stock ledger
  select coalesce(difference,0) into d1 from public.stock_valuation_totals(c);
  insert into t_out values (16, case when abs(d1-d0) < 0.05 then 'ok' else 'BAD' end||' stock value vs ledger difference unchanged: before '||d0||' after '||d1);
  select count(*) into v from public.stock_movements where product_id=fan and movement_type='RETURN';
  insert into t_out values (17, case when v=7 then 'ok' else 'BAD' end||' RETURN movements in stock ledger: '||v||' (7: 2 SR + 1 SR reversal + 3 PR + 1 PR reversal)');
end $$;
select step, result from t_out order by step;
rollback;
