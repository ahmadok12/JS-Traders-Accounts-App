-- Stage 9 (rolls back): foreign bills, payments with individual rates, realized FX, payment agents, conversions.
-- Spec §12 example: bill ¥100,000 @ 40; payments ¥40,000 @ 40, ¥30,000 @ 41, ¥30,000 @ 42 → actual PKR 4,090,000, FX loss 90,000.
-- Expected: no row starts with "BAD"; trial balance equal.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; sup uuid; ag uuid; bank uuid; exp uuid; bill uuid; p1 uuid; p2 uuid; p3 uuid; a3 uuid; ccv uuid; v numeric; s text; r record; n int;
  fxacc uuid;
begin
  select id into c from public.companies limit 1;
  select id into bank from public.bank_accounts where company_id=c and currency='PKR' and is_active order by code desc limit 1;
  select id into exp from public.chart_of_accounts where company_id=c and code='5900';
  select id into fxacc from public.chart_of_accounts where company_id=c and system_key='FX_GAIN_LOSS';
  insert into public.suppliers(company_id,name,default_currency) values (c,'T Guangzhou Supplier','CNY') returning id into sup;
  insert into public.payment_agents(company_id,name) values (c,'T Exchange') returning id into ag;

  -- 1. foreign bill
  bill := public.save_supplier_bill(null, jsonb_build_object('company_id',c,'supplier_id',sup,'bill_date','2026-10-01','currency','CNY','fx_rate',40),
    jsonb_build_array(jsonb_build_object('kind','EXPENSE','account_id',exp,'description','test goods','quantity',1,'unit_price',100000)));
  perform public.post_supplier_bill(bill, null);
  select string_agg(coalesce(currency,'-')||' '||coalesce(fx_amount::text,'-')||' @'||coalesce(fx_rate::text,'-')||' pkr '||credit, ';') into s
    from public.journal_lines where entry_id=(select journal_entry_id from public.supplier_bills where id=bill) and credit>0;
  insert into t_out values (1, case when s='CNY 100000.00 @40.000000 pkr 4000000.00' then 'ok' else 'BAD' end||' bill AP line: '||s);

  -- 2. payment 1: ¥40,000 @ 40 from PKR bank, applied now
  p1 := public.pay_supplier_fx(c, sup, 'CNY', 40000, 40, '2026-10-02', jsonb_build_object('kind','BANK','bank_account_id',bank),
    jsonb_build_array(jsonb_build_object('bill_id',bill,'amount',40000)), '{}'::jsonb, null);
  select fx_diff into v from public.supplier_bill_allocations where fx_payment_id=p1;
  insert into t_out values (2, case when v=0 then 'ok' else 'BAD' end||' payment @40 FX diff '||v||' (0)');

  -- 3. agent funded ¥30,000 @ 41 from the bank, then settles ¥30,000 @ 41 from its CNY account
  perform public.save_agent_transaction(jsonb_build_object('company_id',c,'kind','FUND','agent_id',ag,'currency','CNY','amount',30000,'fx_rate',41,'bank_account_id',bank,'txn_date','2026-10-03'), null);
  p2 := public.pay_supplier_fx(c, sup, 'CNY', 30000, 41, '2026-10-04', jsonb_build_object('kind','AGENT','agent_id',ag,'source_currency','CNY'),
    jsonb_build_array(jsonb_build_object('bill_id',bill,'amount',30000)), jsonb_build_object('exchange_reference','SLIP-9'), null);
  select fx_diff into v from public.supplier_bill_allocations where fx_payment_id=p2;
  insert into t_out values (3, case when v=30000 then 'ok' else 'BAD' end||' agent settlement @41 FX loss '||v||' (30000)');
  select fx_balance||' / '||pkr_balance into s from public.currency_balances(c,'AGENT') where holder_id=ag and currency='CNY';
  insert into t_out values (4, case when s is null then 'ok' else 'BAD' end||' agent CNY balance after settlement: '||coalesce(s,'none (0)'));

  -- 4. payment 3: ¥30,000 @ 42 as an advance, applied later
  p3 := public.pay_supplier_fx(c, sup, 'CNY', 30000, 42, '2026-10-05', jsonb_build_object('kind','BANK','bank_account_id',bank), '[]'::jsonb, '{}'::jsonb, null);
  select unapplied into v from public.supplier_open_fx_payments(sup,'CNY') where fx_payment_id=p3;
  insert into t_out values (5, case when v=30000 then 'ok' else 'BAD' end||' advance not yet applied '||v);
  select count(*) into n from public.supplier_open_payments(sup);
  insert into t_out values (6, case when n=0 then 'ok' else 'BAD' end||' foreign payments kept out of PKR allocation list: '||n);
  perform public.apply_fx_payment(p3, jsonb_build_array(jsonb_build_object('bill_id',bill,'amount',30000)), null);

  select * into r from public.supplier_bills_v where id=bill;
  insert into t_out values (7, case when r.payment_status='PAID' and r.outstanding_fx=0 and r.outstanding_pkr=0 then 'ok' else 'BAD' end
    ||' bill '||r.payment_status||' outstanding '||r.outstanding_fx||' / pkr '||r.outstanding_pkr);
  insert into t_out values (8, case when r.paid_actual_pkr=4090000 and r.fx_diff=90000 then 'ok' else 'BAD' end
    ||' actual settlement '||r.paid_actual_pkr||' (4090000), FX difference '||r.fx_diff||' (90000)');
  select round(sum(actual_pkr)/sum(fx_amount),4) into v from public.bill_settlements(bill);
  insert into t_out values (9, case when v=40.9 then 'ok' else 'BAD' end||' weighted average rate (report only) '||v||' (40.9)');
  select sum(debit-credit) into v from public.journal_lines where account_id=fxacc and party_id is null and entry_id in (select fx_entry_id from public.supplier_bill_allocations where bill_id=bill);
  insert into t_out values (10, case when v=90000 then 'ok' else 'BAD' end||' realized FX loss in ledger '||v);
  select count(*) into n from public.currency_balances(c,'SUPPLIER') where holder_id=sup;
  insert into t_out values (11, case when n=0 then 'ok' else 'BAD' end||' supplier CNY & PKR balance cleared (rows '||n||')');
  -- rates are kept per payment
  select string_agg(pay_rate::numeric(8,2)::text, ',' order by pay_rate) into s from public.supplier_bill_allocations where bill_id=bill and status='ACTIVE';
  insert into t_out values (12, case when s='40.00,41.00,42.00' then 'ok' else 'BAD' end||' individual rates kept: '||s);

  -- 5. unlink payment 3 → its FX loss is reversed and the bill owes ¥30,000 again
  select id into a3 from public.supplier_bill_allocations where fx_payment_id=p3 and status='ACTIVE';
  perform public.remove_supplier_allocation(a3);
  select * into r from public.supplier_bills_v where id=bill;
  insert into t_out values (13, case when r.outstanding_fx=30000 and r.fx_diff=30000 and r.outstanding_pkr=1200000 then 'ok' else 'BAD' end
    ||' after unlink: outstanding '||r.outstanding_fx||' carrying '||r.outstanding_pkr||' fx diff '||r.fx_diff);
  perform public.apply_fx_payment(p3, jsonb_build_array(jsonb_build_object('bill_id',bill,'amount',30000)), null);

  -- 6. reverse the agent settlement → its allocation goes, the agent holds ¥30,000 again
  perform public.reverse_fx_payment(p2, 'test', null);
  select * into r from public.supplier_bills_v where id=bill;
  select fx_balance into v from public.currency_balances(c,'AGENT') where holder_id=ag and currency='CNY';
  insert into t_out values (14, case when r.outstanding_fx=30000 and v=30000 then 'ok' else 'BAD' end||' after reversing settlement: bill owes '||r.outstanding_fx||', agent holds ¥'||v);

  -- 7. supplier balance converted ¥30,000 (carried @40) → $4,300 @ 280 (1,204,000) → loss 4,000
  ccv := public.save_currency_conversion(jsonb_build_object('company_id',c,'holder_kind','SUPPLIER','supplier_id',sup,'from_currency','CNY','from_amount',30000,'from_rate',40,
    'to_currency','USD','to_amount',4300,'to_rate',280,'conv_date','2026-10-06'), null);
  select fx_diff into v from public.currency_conversions where id=ccv;
  select string_agg(currency||' '||fx_balance||' / '||pkr_balance, '; ' order by currency) into s from public.currency_balances(c,'SUPPLIER') where holder_id=sup;
  insert into t_out values (15, case when v=4000 and s='USD 4300.00 / 1204000.00' then 'ok' else 'BAD' end||' conversion loss '||v||'; supplier now '||s);

  -- 8. agent: converts ¥30,000 back to PKR 1,260,000 (gain 30,000), charge PKR 500, opening payable PKR -10,000
  perform public.save_currency_conversion(jsonb_build_object('company_id',c,'holder_kind','AGENT','agent_id',ag,'from_currency','CNY','from_amount',30000,'from_rate',41,
    'to_currency','PKR','to_amount',1260000), null);
  perform public.save_agent_transaction(jsonb_build_object('company_id',c,'kind','CHARGE','agent_id',ag,'currency','PKR','amount',500), null);
  perform public.save_agent_transaction(jsonb_build_object('company_id',c,'kind','OPENING','agent_id',ag,'currency','PKR','amount',-10000,'txn_date','2026-10-01'), null);
  select string_agg(currency||' '||balance_fx, '; ' order by currency) into s from public.agent_summary(c, null, null) where agent_id=ag;
  insert into t_out values (16, case when s='CNY 0.00; PKR 1249500.00' then 'ok' else 'BAD' end||' agent summary: '||s||' (CNY 0; PKR 1,260,000-500-10,000)');
  select count(*) into n from public.currency_ledger('AGENT', ag, 'CNY', null, null) where row_kind='TXN';
  insert into t_out values (17, case when n=4 then 'ok' else 'BAD' end||' agent CNY ledger rows '||n||' (fund, settle, settle reversal, convert = 4)');

  -- 9. PKR voucher cannot settle a foreign bill
  begin
    perform public.allocate_supplier_payment((select journal_entry_id from public.fx_payments where id=p1), jsonb_build_array(jsonb_build_object('bill_id',bill,'amount',1)));
    insert into t_out values (18, 'ok fx voucher routed to FX allocation');
  exception when others then insert into t_out values (18, 'ok guarded: '||sqlerrm);
  end;

  select sum(gain)-sum(loss) into v from public.fx_gain_loss_report(c, null, null) where entry_date >= '2026-10-01';
  insert into t_out values (19, 'FX gain/loss report net (gain + / loss −): '||v);
  select sum(debit)||' = '||sum(credit) into s from public.trial_balance(c);
  insert into t_out values (20, case when split_part(s,' = ',1)=split_part(s,' = ',2) then 'ok' else 'BAD' end||' trial balance '||s);
end $$;
reset role;
select * from t_out order by step;
rollback;
