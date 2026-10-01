-- Stage 4 test gate: debit = credit, atomic posting, statements / bank book / trial balance reconcile,
-- reversal, immutable ledger, closed periods, unauthorised users blocked. Rolls back.
-- Expected: 14 rows, none starting with "BAD".
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; ar uuid; ap uuid; ob uuid; sales uuid; exp uuid; cash uuid; cashgl uuid; bank uuid; bankgl uuid; cu uuid; su uuid;
  e uuid; e2 uuid; r uuid; x jsonb; v numeric; s text; per uuid;
begin
  select id into c from public.companies limit 1;
  select id into ar from public.chart_of_accounts where company_id=c and system_key='AR_CONTROL';
  select id into ap from public.chart_of_accounts where company_id=c and system_key='AP_CONTROL';
  select id into ob from public.chart_of_accounts where company_id=c and system_key='OPENING_BALANCE';
  select id into sales from public.chart_of_accounts where company_id=c and system_key='SALES';
  select id into exp from public.chart_of_accounts where company_id=c and code='5900';
  select id, gl_account_id into cash, cashgl from public.bank_accounts where company_id=c and code='CASH';
  insert into public.bank_accounts(company_id, code, name) values (c, 'T-BANK', 'Test Bank') returning id, gl_account_id into bank, bankgl;
  insert into t_out select 1, 'new bank account got its own GL: '||code||' '||name from public.chart_of_accounts where id=bankgl;
  insert into public.customers(company_id, name) values (c, 'T Farm (both)') returning id into cu;
  select linked_supplier_id into su from public.customers where id=cu;
  e := public.save_journal_entry(null, jsonb_build_object('company_id',c,'entry_type','OPENING','entry_date','2026-09-30'),
    jsonb_build_array(jsonb_build_object('account_id',ar,'debit',50000,'party_type','CUSTOMER','party_id',cu),
                      jsonb_build_object('account_id',bankgl,'debit',200000),
                      jsonb_build_object('account_id',ob,'credit',250000)));
  x := public.post_journal_entry(e);
  e := public.save_journal_entry(null, jsonb_build_object('company_id',c,'entry_type','RECEIPT','entry_date','2026-10-01','party_type','CUSTOMER','party_id',cu,'bank_account_id',bank,'amount',20000),
    jsonb_build_array(jsonb_build_object('account_id',bankgl,'debit',20000), jsonb_build_object('account_id',ar,'credit',20000,'party_id',cu)));
  x := public.post_journal_entry(e);
  e := public.save_journal_entry(null, jsonb_build_object('company_id',c,'entry_type','JOURNAL','entry_date','2026-10-02','memo','Purchase from farm'),
    jsonb_build_array(jsonb_build_object('account_id',exp,'debit',15000), jsonb_build_object('account_id',ap,'credit',15000,'party_id',su)));
  x := public.post_journal_entry(e);
  select balance into v from public.party_statement('CUSTOMER', cu) order by row_kind desc, entry_date desc limit 1;
  insert into t_out values (2, 'customer statement closing = '||v||' (expect 30000)');
  select balance into v from public.party_statement('CUSTOMER', cu, null, null, true) where row_kind='TXN' order by entry_date desc limit 1;
  insert into t_out values (3, 'combined with linked supplier (net they owe us) = '||v||' (expect 15000)');
  select balance||' / linked '||linked_balance into s from public.party_balances(c, 'CUSTOMER') where party_id=cu;
  insert into t_out values (4, 'receivables list: '||s||' (expect 30000 / linked -15000)');
  select balance into v from public.bank_book(bank) where row_kind='TXN' order by entry_date desc limit 1;
  insert into t_out values (5, 'bank book = '||v||' (expect 220000)');
  e2 := public.save_journal_entry(null, jsonb_build_object('company_id',c,'entry_type','JOURNAL'),
    jsonb_build_array(jsonb_build_object('account_id',exp,'debit',100), jsonb_build_object('account_id',cashgl,'credit',90)));
  begin x := public.post_journal_entry(e2); insert into t_out values (6,'BAD: unbalanced posted');
  exception when others then insert into t_out values (6,'unbalanced blocked'); end;
  insert into t_out select 7, 'nothing half-written: lines for that entry = '||count(*) from public.journal_lines where entry_id=e2;
  e2 := public.save_journal_entry(null, jsonb_build_object('company_id',c,'entry_type','JOURNAL'),
    jsonb_build_array(jsonb_build_object('account_id',ar,'debit',100), jsonb_build_object('account_id',sales,'credit',100)));
  begin x := public.post_journal_entry(e2); insert into t_out values (8,'BAD: AR without customer');
  exception when others then insert into t_out values (8,'receivable without customer blocked'); end;
  r := public.reverse_journal_entry(e, 'test');
  select balance into v from public.party_statement('SUPPLIER', su) where row_kind='TXN' order by entry_date desc, entry_no desc limit 1;
  insert into t_out values (9, 'after reversing the purchase: supplier balance = '||v||' (expect 0)');
  begin update public.journal_lines set debit = 1 where entry_id = e; insert into t_out values (10,'BAD: posted line edited');
  exception when others then insert into t_out values (10,'posted ledger lines cannot be edited'); end;
  perform public.create_accounting_periods(c, 2026);
  select id into per from public.accounting_periods where company_id=c and start_date='2026-09-01';
  perform public.set_period_status(per, 'CLOSED');
  e2 := public.save_journal_entry(null, jsonb_build_object('company_id',c,'entry_type','JOURNAL','entry_date','2026-09-15'),
    jsonb_build_array(jsonb_build_object('account_id',exp,'debit',10), jsonb_build_object('account_id',cashgl,'credit',10)));
  begin x := public.post_journal_entry(e2); insert into t_out values (11,'BAD: posted into closed period');
  exception when others then insert into t_out values (11,'closed period blocks posting'); end;
  select sum(debit)||' = '||sum(credit) into s from public.trial_balance(c);
  insert into t_out values (12, 'trial balance Dr = Cr: '||s);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(),'role','authenticated')::text, true);
do $$ begin
  begin
    perform public.save_journal_entry(null, jsonb_build_object('company_id',(select id from public.companies limit 1),'entry_type','JOURNAL'), '[]');
    insert into t_out values (13,'BAD: unauthorised save');
  exception when others then insert into t_out values (13,'unauthorised user blocked'); end;
  insert into t_out select 14, 'unauthorised user sees ledger lines: '||count(*)||' (expect 0)' from public.journal_lines;
end $$;
reset role;
select * from t_out order by step;
rollback;
