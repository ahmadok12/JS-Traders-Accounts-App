-- Stage 11: reports must reconcile to the authoritative data. Read-only; run any time.
-- Expected: every row starts with "ok".
begin;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
with c as (select id from public.companies limit 1)
select * from (values
 ((select case when sum(qty) = (select sum(on_hand) from public.stock_balances where company_id=(select id from c)) then 'ok' else 'BAD' end || ' stock summary = stock balances'
   from public.rpt_stock_summary((select id from c), null, null))),
 ((select case when coalesce(sum(qty),0) = (select coalesce(sum(qty),0) from public.rpt_stock_summary((select id from c), null, null)) then 'ok' else 'BAD' end || ' stock as of today = current'
   from public.rpt_stock_summary((select id from c), current_date, null))),
 ((select case when count(*) = 0 then 'ok' else 'BAD' end || ' movement summary: opening + movements = closing'
   from public.rpt_stock_movement_summary((select id from c), date_trunc('month', current_date)::date, current_date, null)
   where opening+purchases+transfers_in+transfers_out+sales+assembly+adjustments <> closing)),
 ((select case when coalesce(sum(subtotal),0) = (select coalesce(sum(amount),0) from public.rpt_sales_by_item((select id from c), null, null, null)) then 'ok' else 'BAD' end
      || ' sales register subtotal = sales by item' from public.rpt_sales_register((select id from c), null, null, null))),
 ((select case when coalesce(sum(balance),0) = coalesce(sum(not_due+d1_30+d31_60+d61_90+d90_plus+other),0) then 'ok' else 'BAD' end || ' receivables ageing buckets = balances'
   from public.rpt_aging((select id from c),'CUSTOMER',null))),
 ((select case when coalesce(sum(balance),0) = coalesce(sum(not_due+d1_30+d31_60+d61_90+d90_plus+other),0) then 'ok' else 'BAD' end || ' payables ageing buckets = balances'
   from public.rpt_aging((select id from c),'SUPPLIER',null))),
 ((select case when coalesce(sum(amount) filter (where section='ASSET'),0) = coalesce(sum(amount) filter (where section<>'ASSET'),0) then 'ok' else 'BAD' end || ' balance sheet: assets = liabilities + equity'
   from public.rpt_balance_sheet((select id from c), null))),
 ((select case when coalesce(sum(case when section='INCOME' then amount else -amount end),0)
          = coalesce((select amount from public.rpt_balance_sheet((select id from c), null) where code='3999'),0) then 'ok' else 'BAD' end || ' P&L to date = profit in balance sheet'
   from public.rpt_profit_loss((select id from c), null, null))),
 ((select case when sum(debit) = sum(credit) then 'ok' else 'BAD' end || ' trial balance Dr = Cr' from public.trial_balance((select id from c), null))),
 ((select case when coalesce(sum(closing),0) = coalesce((select sum(jl.debit-jl.credit) from public.journal_lines jl join public.bank_accounts b on b.id=jl.bank_account_id
        where b.company_id=(select id from c) and b.is_active),0) then 'ok' else 'BAD' end || ' cash & bank summary = bank ledgers' from public.rpt_cash_bank_summary((select id from c), null, null)))
) t(result);
rollback;
