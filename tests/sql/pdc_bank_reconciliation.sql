-- Stage 10 (rolls back): post-dated cheques + bank statement import / matching / reconciliation.
-- Expected: no row starts with "BAD".
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; cu uuid; su uuid; bank uuid; bankgl uuid; exp uuid; chg uuid; bill uuid; p1 uuid; p2 uuid; v numeric; s text; n int; r record; j jsonb;
  pdcr uuid; e uuid; x jsonb; imp jsonb; sms1 uuid; sms2 uuid; jl uuid; g uuid; rec uuid; lines jsonb;
begin
  select id into c from public.companies limit 1;
  select id into pdcr from public.chart_of_accounts where company_id=c and system_key='PDC_RECEIVABLE';
  select id into exp from public.chart_of_accounts where company_id=c and code='5900';
  select id into chg from public.chart_of_accounts where company_id=c and system_key='BANK_CHARGES';
  insert into public.bank_accounts(company_id, code, name) values (c, 'T-PDC', 'Test PDC Bank') returning id, gl_account_id into bank, bankgl;
  insert into public.customers(company_id, name, is_also_supplier) values (c, 'T Cheque Farm', false) returning id into cu;
  insert into public.suppliers(company_id, name, is_also_customer) values (c, 'T Cheque Supplier', false) returning id into su;

  -- 1. received PDC
  p1 := public.save_pdc(jsonb_build_object('company_id',c,'direction','RECEIVED','party_id',cu,'cheque_no','12345','cheque_date','2026-10-20','received_date','2026-10-05',
    'amount',100000,'drawer_bank','HBL'), '[]'::jsonb, null);
  select coalesce(sum(debit-credit),0) into v from public.journal_lines where party_type='CUSTOMER' and party_id=cu;
  insert into t_out values (1, case when v=-100000 then 'ok' else 'BAD' end||' customer credited on receipt of cheque: '||v);
  begin perform public.pdc_action(p1,'CLEAR','{"date":"2026-10-21"}'); insert into t_out values (2,'BAD cleared without deposit');
  exception when others then insert into t_out values (2,'ok '||sqlerrm); end;
  perform public.pdc_action(p1,'DEPOSIT',jsonb_build_object('bank_account_id',bank,'date','2026-10-06'));
  begin perform public.pdc_action(p1,'CLEAR','{"date":"2026-10-10"}'); insert into t_out values (3,'BAD cleared before cheque date');
  exception when others then insert into t_out values (3,'ok '||sqlerrm); end;
  -- 2. bounce with bank charges
  perform public.pdc_action(p1,'BOUNCE','{"date":"2026-10-21","reason":"Insufficient funds","bank_charges":500}');
  select coalesce(sum(debit-credit),0) into v from public.journal_lines where party_type='CUSTOMER' and party_id=cu;
  select status||' bounces='||bounce_count into s from public.pdc_records where id=p1;
  insert into t_out values (4, case when v=0 and s='BOUNCED bounces=1' then 'ok' else 'BAD' end||' after bounce: customer '||v||', '||s);
  -- 3. re-present (deposited again) and clear
  perform public.pdc_action(p1,'REPRESENT',jsonb_build_object('date','2026-10-25','bank_account_id',bank));
  perform public.pdc_action(p1,'CLEAR','{"date":"2026-10-26"}');
  select coalesce(sum(debit-credit),0) into v from public.journal_lines where bank_account_id=bank;
  insert into t_out values (5, case when v=99500 then 'ok' else 'BAD' end||' bank after clearing (100,000 - 500 charges): '||v);
  -- 4. undo clearing, clear again
  perform public.pdc_action(p1,'UNDO_CLEAR','{"date":"2026-10-26","note":"cleared by mistake"}');
  select status into s from public.pdc_records where id=p1;
  insert into t_out values (6, case when s='DEPOSITED' then 'ok' else 'BAD' end||' undo clear → '||s);
  perform public.pdc_action(p1,'CLEAR','{"date":"2026-10-26"}');
  select count(*) into n from public.pdc_events where pdc_id=p1;
  insert into t_out values (7, 'events recorded for the cheque: '||n||' (received, deposited, bounced, charges, re-presented, cleared, undo, cleared = 8)');
  select coalesce(sum(jl.debit-jl.credit),0) into v from public.journal_lines jl join public.journal_entries e on e.id=jl.entry_id
   where jl.account_id=pdcr and e.source_type='PDC' and e.source_id=p1;
  insert into t_out values (8, case when v=0 then 'ok' else 'BAD' end||' cheques-in-hand account back to 0: '||v);

  -- 5. issued PDC paying a bill; our cheque bounces; re-present; clear
  bill := public.save_supplier_bill(null, jsonb_build_object('company_id',c,'supplier_id',su,'bill_date','2026-10-05','currency','PKR','fx_rate',1),
    jsonb_build_array(jsonb_build_object('kind','EXPENSE','account_id',exp,'description','repairs','quantity',1,'unit_price',50000)));
  perform public.post_supplier_bill(bill, null);
  p2 := public.save_pdc(jsonb_build_object('company_id',c,'direction','ISSUED','party_id',su,'cheque_no','777','cheque_date','2026-10-15','received_date','2026-10-05',
    'amount',50000,'bank_account_id',bank), jsonb_build_array(jsonb_build_object('bill_id',bill,'amount',50000)), null);
  select payment_status into s from public.supplier_bills_v where id=bill;
  insert into t_out values (9, case when s='PAID' then 'ok' else 'BAD' end||' bill paid by issued cheque: '||s);
  begin perform public.save_pdc(jsonb_build_object('company_id',c,'direction','ISSUED','party_id',su,'cheque_no','777','cheque_date','2026-10-15','amount',1,'bank_account_id',bank), '[]', null);
    insert into t_out values (10,'BAD duplicate cheque accepted');
  exception when others then insert into t_out values (10,'ok '||sqlerrm); end;
  perform public.pdc_action(p2,'BOUNCE','{"date":"2026-10-16","reason":"signature"}');
  select payment_status into s from public.supplier_bills_v where id=bill;
  insert into t_out values (11, case when s='UNPAID' then 'ok' else 'BAD' end||' bounced → bill '||s);
  perform public.pdc_action(p2,'REPRESENT','{"date":"2026-10-27"}');
  perform public.allocate_supplier_payment((select current_entry_id from public.pdc_records where id=p2), jsonb_build_array(jsonb_build_object('bill_id',bill,'amount',50000)));
  perform public.pdc_action(p2,'CLEAR','{"date":"2026-10-28"}');
  select payment_status into s from public.supplier_bills_v where id=bill;
  select coalesce(sum(debit-credit),0) into v from public.journal_lines where bank_account_id=bank;
  insert into t_out values (12, case when s='PAID' and v=49500 then 'ok' else 'BAD' end||' re-presented + cleared: bill '||s||', bank '||v);

  -- 6. a bank-charges voucher of 600 in the books (the bank shows it as 2 × 300)
  e := public.save_journal_entry(null, jsonb_build_object('company_id',c,'entry_type','PAYMENT','entry_date','2026-10-29','bank_account_id',bank,'amount',600,'memo','SMS charges'),
    jsonb_build_array(jsonb_build_object('account_id',chg,'debit',600), jsonb_build_object('account_id',bankgl,'credit',600)));
  perform public.post_journal_entry(e);

  -- 7. import statement (two identical SMS rows are both kept); re-import = all skipped
  lines := jsonb_build_array(
    jsonb_build_object('date','2026-10-21','description','CHQ RETURN CHARGES','amount',-500,'balance',-500),
    jsonb_build_object('date','2026-10-26','description','CLEARING CHQ 12345 T Cheque Farm','cheque_no','12345','amount',100000,'balance',99500),
    jsonb_build_object('date','2026-10-28','description','CHQ 777 PAID','cheque_no','777','amount',-50000,'balance',49500),
    jsonb_build_object('date','2026-10-29','description','SMS CHARGES','amount',-300),
    jsonb_build_object('date','2026-10-29','description','SMS CHARGES','amount',-300),
    jsonb_build_object('date','2026-10-30','description','PROFIT CREDIT','amount',125,'balance',49025));
  imp := public.import_bank_statement(bank, jsonb_build_object('file_name','oct.csv','closing_balance',49025), lines);
  insert into t_out values (13, case when (imp->>'imported')::int=6 then 'ok' else 'BAD' end||' imported '||(imp->>'imported')||' lines (identical SMS rows kept as 2)');
  imp := public.import_bank_statement(bank, jsonb_build_object('file_name','oct-again.csv'), lines);
  insert into t_out values (14, case when (imp->>'imported')::int=0 and jsonb_array_length(imp->'skipped')=6 then 'ok' else 'BAD' end||' re-import: imported '||(imp->>'imported')||', skipped '||jsonb_array_length(imp->'skipped'));
  imp := public.import_bank_statement(bank, '{}'::jsonb, jsonb_build_array(lines->5 || '{"force":true}'::jsonb));
  insert into t_out values (15, case when (imp->>'imported')::int=1 then 'ok' else 'BAD' end||' authorised duplicate imported on purpose');
  select id into sms1 from public.bank_statement_lines where bank_account_id=bank and is_authorised_duplicate;
  perform public.bank_line_ignore(sms1, true, 'test duplicate');

  -- 8. reversal pairs + suggestions
  n := public.bank_match_reversal_pairs(bank);
  insert into t_out values (16, case when n=1 then 'ok' else 'BAD' end||' voucher+reversal pairs matched book-only: '||n);
  select count(*), string_agg(reasons, ' / ') into n, s from public.bank_match_suggestions(bank, null, null, 7);
  insert into t_out values (17, case when n=3 then 'ok' else 'BAD' end||' suggestions: '||n||' — '||s);
  select jsonb_agg(jsonb_build_object('statement_line_id',statement_line_id,'journal_line_id',journal_line_id,'score',score)) into j from public.bank_match_suggestions(bank, null, null, 7);
  perform public.bank_accept_suggestions(bank, j);
  -- 9. many-to-one: two SMS lines ↔ one 600 voucher
  select id into jl from public.journal_lines where entry_id=e and bank_account_id=bank;
  begin
    perform public.bank_match(bank, (select array_agg(id) from public.bank_statement_lines where bank_account_id=bank and description='SMS CHARGES' and status='UNMATCHED' limit 1), array[jl], 'MANUAL', null, null);
  exception when others then insert into t_out values (18,'BAD n:1 '||sqlerrm); end;
  select count(*) into n from public.bank_statement_lines where bank_account_id=bank and description='SMS CHARGES' and status='MATCHED';
  insert into t_out values (18, case when n=2 then 'ok' else 'BAD' end||' two statement lines matched to one voucher: '||n);
  -- 10. missing entry created from the profit line
  select id into sms2 from public.bank_statement_lines where bank_account_id=bank and description='PROFIT CREDIT' and not is_authorised_duplicate;
  e := public.bank_line_create_entry(sms2, 'RECEIPT', jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where company_id=c and code='4100'),'amount',125)), '{}'::jsonb);
  select * into r from public.bank_rec_summary(bank, '2026-10-31', 49025);
  insert into t_out values (19, case when r.difference=0 and r.statement_items=0 and r.book_items=0 then 'ok' else 'BAD' end
    ||' summary: books '||r.ledger_balance||', not on stmt '||r.book_not_on_statement||', not in books '||r.statement_not_in_books||', difference '||r.difference);
  -- 11. a wrong statement balance needs an exception
  begin perform public.finalize_bank_reconciliation(bank, '2026-10-31', 49000, null); insert into t_out values (20,'BAD finalized with a difference');
  exception when others then insert into t_out values (20,'ok '||sqlerrm); end;
  rec := public.finalize_bank_reconciliation(bank, '2026-10-31', 49025, null);
  select to_char(reconciled_until,'YYYY-MM-DD') into s from public.bank_accounts where id=bank;
  insert into t_out values (21, case when s='2026-10-31' then 'ok' else 'BAD' end||' reconciled until '||s);
  select group_id into g from public.bank_matches where journal_line_id=jl and status='ACTIVE';
  begin perform public.bank_unmatch(g, 'test'); insert into t_out values (22,'BAD unmatched inside finalized reconciliation');
  exception when others then insert into t_out values (22,'ok '||sqlerrm); end;
  begin perform public.reverse_journal_entry((select entry_id from public.journal_lines where id=jl), 'test'); insert into t_out values (23,'BAD reversed a reconciled voucher');
  exception when others then insert into t_out values (23,'ok '||sqlerrm); end;
  perform public.undo_bank_reconciliation(rec, 'test undo');
  perform public.bank_unmatch(g, 'wrong match');
  select count(*) into n from public.bank_matches where group_id=g and status='REMOVED' and removed_reason='wrong match';
  select reconciled_until::text into s from public.bank_accounts where id=bank;
  insert into t_out values (24, case when n=3 and s is null then 'ok' else 'BAD' end||' undo + unmatch kept history ('||n||' removed rows), reconciled_until '||coalesce(s,'cleared'));
  select sum(debit)||' = '||sum(credit) into s from public.trial_balance(c);
  insert into t_out values (25, case when split_part(s,' = ',1)=split_part(s,' = ',2) then 'ok' else 'BAD' end||' trial balance '||s);
end $$;
reset role;
select * from t_out order by step;
rollback;
