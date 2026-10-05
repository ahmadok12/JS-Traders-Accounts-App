-- =====================================================================
-- JS Traders ERP — Stage 9 part 2: foreign-currency supplier payments (spec §12)
-- * A foreign bill credits the supplier in its currency (amount + bill rate).
-- * Foreign payment (FXP-): supplier currency amount × the actual rate of THIS
--   payment. Paid from a PKR bank, a bank in the same currency, or a payment
--   agent sub-account (agent settlement — spec §13). Posted to Supplier
--   Advances in that currency until it is applied to bills.
-- * Applying a payment to a bill (any time, part or full) posts the settlement:
--     Dr Accounts Payable  (bill currency amount at the BILL rate)
--     Cr Supplier Advances (same amount at the PAYMENT rate)
--     difference → Realized FX Gain/Loss
--   Individual rates are kept per payment; never averaged.
-- * Removing an application / reversing a payment reverses its settlement entry.
-- =====================================================================

-- ---------------------------------------------------------------- foreign payments
create table if not exists public.fx_payments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  pay_date           date not null,
  supplier_id        uuid not null references public.suppliers(id),
  currency           text not null references public.currencies(code),
  fx_amount          numeric(18,2) not null check (fx_amount > 0),
  fx_rate            numeric(18,6) not null check (fx_rate > 0),
  amount_pkr         numeric(18,2) not null check (amount_pkr > 0),
  source_kind        text not null check (source_kind in ('BANK','AGENT')),
  bank_account_id    uuid references public.bank_accounts(id),
  agent_id           uuid references public.payment_agents(id),
  source_currency    text not null references public.currencies(code),
  source_amount      numeric(18,2) not null check (source_amount > 0),
  reference          text,
  exchange_reference text,                -- agent / exchange slip no.
  supplier_bank_reference text,           -- supplier's bank / TT reference
  shipment_id        uuid references public.shipments(id),
  notes              text,
  journal_entry_id   uuid references public.journal_entries(id),
  status             text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no),
  check ((source_kind = 'BANK') = (bank_account_id is not null)),
  check ((source_kind = 'AGENT') = (agent_id is not null)),
  check (currency <> 'PKR')
);
create index if not exists fxp_supplier_idx on public.fx_payments(supplier_id, pay_date);
create index if not exists fxp_agent_idx on public.fx_payments(agent_id, pay_date) where agent_id is not null;
create index if not exists fxp_entry_idx on public.fx_payments(journal_entry_id);
create trigger stamp before insert or update on public.fx_payments for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.fx_payments for each row execute function public.tg_audit_row();
alter table public.fx_payments enable row level security;
revoke insert, update, delete on public.fx_payments from authenticated, anon;
create policy fxp_select on public.fx_payments for select to authenticated
  using (public.has_permission(company_id, 'purchasing.costs') or public.has_permission(company_id, 'journals.view'));

insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, x.t, x.p, 5, true from public.companies c
cross join (values ('FX_PAYMENT','FXP-'),('AGENT_TXN','AGT-'),('CURRENCY_CONVERSION','CCV-')) as x(t, p)
on conflict do nothing;

-- ---------------------------------------------------------------- allocations carry the FX settlement
alter table public.supplier_bill_allocations
  add column if not exists fx_payment_id  uuid references public.fx_payments(id),
  add column if not exists fx_amount      numeric(18,2),     -- bill-currency amount settled
  add column if not exists bill_rate      numeric(18,6),
  add column if not exists pay_rate       numeric(18,6),
  add column if not exists pkr_at_payment numeric(18,2),     -- what this part actually cost in PKR
  add column if not exists fx_diff        numeric(18,2) not null default 0,   -- + loss / − gain
  add column if not exists settle_date    date,
  add column if not exists fx_entry_id    uuid references public.journal_entries(id);
create index if not exists sba_fxp on public.supplier_bill_allocations(fx_payment_id) where fx_payment_id is not null;

-- amount = bill carrying value in PKR (bill rate); fx_* columns for foreign bills
create or replace view public.supplier_bills_v with (security_invoker = true) as
select b.id, b.company_id, b.doc_no, b.bill_date, b.due_date, b.supplier_id, s.name as supplier_name, s.code as supplier_code,
    b.supplier_invoice_no, b.currency, b.fx_rate, b.status, b.total_amount, b.total_pkr, b.journal_entry_id, b.posted_at, b.created_at,
    coalesce(p.paid, 0) as paid_pkr,
    case when b.status = 'POSTED' then b.total_pkr - coalesce(p.paid, 0) else 0 end as outstanding_pkr,
    case when b.status <> 'POSTED' then null
         when b.currency <> 'PKR' and coalesce(p.paid_fx, 0) <= 0 then 'UNPAID'
         when b.currency <> 'PKR' and coalesce(p.paid_fx, 0) >= b.total_amount then 'PAID'
         when b.currency <> 'PKR' then 'PART_PAID'
         when coalesce(p.paid, 0) <= 0 then 'UNPAID'
         when coalesce(p.paid, 0) >= b.total_pkr then 'PAID'
         else 'PART_PAID' end as payment_status,
    b.discount_amount, b.is_quick,
    case when b.currency = 'PKR' then coalesce(p.paid, 0) else coalesce(p.paid_fx, 0) end as paid_fx,
    case when b.status <> 'POSTED' then 0 when b.currency = 'PKR' then b.total_pkr - coalesce(p.paid, 0) else b.total_amount - coalesce(p.paid_fx, 0) end as outstanding_fx,
    coalesce(p.fx_diff, 0) as fx_diff,
    coalesce(p.paid_actual, 0) as paid_actual_pkr
from public.supplier_bills b
join public.suppliers s on s.id = b.supplier_id
left join (select bill_id, sum(amount) paid, sum(fx_amount) paid_fx, sum(fx_diff) fx_diff, sum(coalesce(pkr_at_payment, amount)) paid_actual
           from public.supplier_bill_allocations where status = 'ACTIVE' group by bill_id) p on p.bill_id = b.id;
grant select on public.supplier_bills_v to authenticated;

-- ---------------------------------------------------------------- apply a foreign payment to a bill (internal)
create or replace function public.fx_allocate(p_fx_payment_id uuid, p_bill_id uuid, p_fx numeric, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.fx_payments; b public.supplier_bills; v_out numeric; v_free numeric; v_carry numeric; v_pay numeric; v_diff numeric;
  v_used_pkr numeric; v_alloc uuid; v_je uuid; v_date date; v_lines jsonb;
begin
  select * into p from public.fx_payments where id = p_fx_payment_id for update;
  select * into b from public.supplier_bills where id = p_bill_id for update;
  if p.id is null or p.status <> 'POSTED' then raise exception 'Foreign payment not found' using errcode = 'P0002'; end if;
  if b.id is null or b.status <> 'POSTED' then raise exception 'Bill not found or not posted' using errcode = 'P0002'; end if;
  if b.supplier_id <> p.supplier_id then raise exception 'Payment % is for a different supplier', p.doc_no using errcode = '22023'; end if;
  if b.currency <> p.currency then raise exception 'Bill % is in % but payment % is in % — use a currency conversion first', b.doc_no, b.currency, p.doc_no, p.currency using errcode = '22023'; end if;
  p_fx := round(coalesce(p_fx, 0), 2);
  if p_fx <= 0 then raise exception 'Enter the % amount to apply', b.currency using errcode = '23502'; end if;

  select b.total_amount - coalesce(sum(fx_amount), 0), b.total_pkr - coalesce(sum(amount), 0) into v_out, v_carry
    from public.supplier_bill_allocations where bill_id = b.id and status = 'ACTIVE';
  if p_fx > v_out then raise exception 'Bill % has only % % outstanding', b.doc_no, b.currency, v_out using errcode = '23514'; end if;
  select p.fx_amount - coalesce(sum(fx_amount), 0), coalesce(sum(pkr_at_payment), 0) into v_free, v_used_pkr
    from public.supplier_bill_allocations where fx_payment_id = p.id and status = 'ACTIVE';
  if p_fx > v_free then raise exception 'Payment % has only % % not yet applied', p.doc_no, p.currency, v_free using errcode = '23514'; end if;

  -- carrying value at the bill rate (the last part takes what is left, so the bill clears to the paisa)
  if p_fx = v_out then null; else v_carry := round(p_fx * b.fx_rate, 2); end if;
  -- actual cost at this payment's own rate (the last part of the payment takes what is left)
  if p_fx = v_free then v_pay := p.amount_pkr - v_used_pkr; else v_pay := round(p_fx * p.fx_rate, 2); end if;
  v_diff := v_pay - v_carry;
  v_date := coalesce(p_date, greatest(b.bill_date, p.pay_date));

  insert into public.supplier_bill_allocations(company_id, payment_entry_id, bill_id, amount, fx_payment_id, fx_amount, bill_rate, pay_rate, pkr_at_payment, fx_diff, settle_date)
  values (b.company_id, p.journal_entry_id, b.id, v_carry, p.id, p_fx, b.fx_rate, p.fx_rate, v_pay, v_diff, v_date)
  returning id into v_alloc;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', public.hr_account(b.company_id, 'AP_CONTROL'), 'debit', v_carry, 'party_type', 'SUPPLIER', 'party_id', b.supplier_id,
      'currency', b.currency, 'fx_amount', p_fx, 'fx_rate', b.fx_rate, 'description', 'Bill ' || b.doc_no || ' settled by ' || p.doc_no),
    jsonb_build_object('account_id', public.hr_account(b.company_id, 'SUPPLIER_ADVANCE'), 'credit', v_pay, 'party_type', 'SUPPLIER', 'party_id', b.supplier_id,
      'currency', b.currency, 'fx_amount', p_fx, 'fx_rate', p.fx_rate, 'description', p.doc_no || ' applied to ' || b.doc_no));
  if v_diff > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(b.company_id, 'FX_GAIN_LOSS'), 'debit', v_diff,
      'description', format('Exchange loss: %s %s paid @ %s, billed @ %s', b.currency, p_fx, p.fx_rate, b.fx_rate)));
  elsif v_diff < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(b.company_id, 'FX_GAIN_LOSS'), 'credit', -v_diff,
      'description', format('Exchange gain: %s %s paid @ %s, billed @ %s', b.currency, p_fx, p.fx_rate, b.fx_rate)));
  end if;
  v_je := public.acc_post_document_entry(b.company_id, 'SYSTEM', v_date,
    format('FX settlement: %s %s of %s by %s', b.currency, p_fx, b.doc_no, p.doc_no), p.reference, 'SUPPLIER', b.supplier_id, null, v_carry, v_lines, 'FX_SETTLEMENT', v_alloc);
  update public.supplier_bill_allocations set fx_entry_id = v_je where id = v_alloc;
  return v_alloc;
end $$;
revoke execute on function public.fx_allocate(uuid, uuid, numeric, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- record a foreign payment (internal, no permission check)
-- p_source: {kind:'BANK', bank_account_id} | {kind:'AGENT', agent_id, source_currency, source_amount}
create or replace function public.fx_pay_core(p_company uuid, p_supplier uuid, p_currency text, p_fx numeric, p_rate numeric, p_date date,
  p_source jsonb, p_bills jsonb, p_extra jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_kind text := upper(coalesce(nullif(p_source->>'kind',''), 'BANK')); v_pkr numeric; v_bank public.bank_accounts; v_agent public.payment_agents;
  v_src_cur text; v_src_amt numeric; v_id uuid; v_no text; v_lines jsonb; v_je uuid; x jsonb; v_sum numeric := 0; v_sup text; v_memo text;
begin
  if p_idempotency_key is not null then
    select id into v_id from public.fx_payments where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  p_currency := upper(trim(coalesce(p_currency, '')));
  if p_currency = '' or p_currency = 'PKR' then raise exception 'Choose the foreign currency paid (PKR payments use the normal supplier payment)' using errcode = '23502'; end if;
  if not exists (select 1 from public.currencies where code = p_currency and is_active) then raise exception 'Unknown currency %', p_currency using errcode = '22023'; end if;
  select name into v_sup from public.suppliers where id = p_supplier and company_id = p_company;
  if v_sup is null then raise exception 'Choose the supplier' using errcode = '23502'; end if;
  p_fx := round(coalesce(p_fx, 0), 2);
  if p_fx <= 0 then raise exception 'Enter the % amount paid', p_currency using errcode = '23502'; end if;
  if coalesce(p_rate, 0) <= 0 then raise exception 'Enter the exchange rate of this payment (PKR per 1 %)', p_currency using errcode = '23502'; end if;
  v_pkr := round(p_fx * p_rate, 2);

  if v_kind = 'BANK' then
    select * into v_bank from public.bank_accounts where id = nullif(p_source->>'bank_account_id','')::uuid and company_id = p_company and is_active;
    if v_bank.id is null then raise exception 'Choose the bank / cash account paid from' using errcode = '23502'; end if;
    if v_bank.currency = 'PKR' then v_src_cur := 'PKR'; v_src_amt := v_pkr;
    elsif v_bank.currency = p_currency then v_src_cur := p_currency; v_src_amt := p_fx;
    else raise exception '% is a % account — pay % from a PKR or % account, or convert first', v_bank.name, v_bank.currency, p_currency, p_currency using errcode = '22023';
    end if;
  elsif v_kind = 'AGENT' then
    select * into v_agent from public.payment_agents where id = nullif(p_source->>'agent_id','')::uuid and company_id = p_company;
    if v_agent.id is null then raise exception 'Choose the payment agent' using errcode = '23502'; end if;
    v_src_cur := upper(coalesce(nullif(p_source->>'source_currency',''), 'PKR'));
    v_src_amt := case when v_src_cur = 'PKR' then v_pkr when v_src_cur = p_currency then p_fx else round(nullif(p_source->>'source_amount','')::numeric, 2) end;
    if coalesce(v_src_amt, 0) <= 0 then raise exception 'Enter the % amount taken from the agent''s % account', v_src_cur, v_src_cur using errcode = '23502'; end if;
  else
    raise exception 'Choose how it was paid (bank or payment agent)' using errcode = '23502';
  end if;

  v_no := public.next_document_number(p_company, 'FX_PAYMENT');
  insert into public.fx_payments(company_id, doc_no, pay_date, supplier_id, currency, fx_amount, fx_rate, amount_pkr, source_kind, bank_account_id, agent_id,
    source_currency, source_amount, reference, exchange_reference, supplier_bank_reference, shipment_id, notes, idempotency_key)
  values (p_company, v_no, coalesce(p_date, current_date), p_supplier, p_currency, p_fx, p_rate, v_pkr, v_kind, v_bank.id, v_agent.id,
    v_src_cur, v_src_amt, nullif(trim(p_extra->>'reference'),''), nullif(trim(p_extra->>'exchange_reference'),''), nullif(trim(p_extra->>'supplier_bank_reference'),''),
    nullif(p_extra->>'shipment_id','')::uuid, nullif(trim(p_extra->>'notes'),''), p_idempotency_key)
  returning id into v_id;

  v_memo := format('%s %s paid to %s @ %s%s', p_currency, p_fx, v_sup, p_rate, case when v_kind = 'AGENT' then ' via ' || v_agent.name else '' end);
  v_lines := jsonb_build_array(jsonb_build_object('account_id', public.hr_account(p_company, 'SUPPLIER_ADVANCE'), 'debit', v_pkr, 'party_type', 'SUPPLIER', 'party_id', p_supplier,
    'currency', p_currency, 'fx_amount', p_fx, 'fx_rate', p_rate, 'description', v_no || ' — ' || p_currency || ' payment'));
  if v_kind = 'BANK' then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_bank.gl_account_id, 'credit', v_pkr, 'bank_account_id', v_bank.id,
      'currency', case when v_src_cur <> 'PKR' then v_src_cur end, 'fx_amount', case when v_src_cur <> 'PKR' then v_src_amt end,
      'fx_rate', case when v_src_cur <> 'PKR' then p_rate end, 'description', v_memo));
  else
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(p_company, 'AGENT_ADVANCE'), 'credit', v_pkr, 'party_type', 'AGENT', 'party_id', v_agent.id,
      'currency', v_src_cur, 'fx_amount', v_src_amt, 'fx_rate', round(v_pkr / v_src_amt, 6), 'description', 'Settled for ' || v_sup || ' — ' || v_no));
  end if;
  v_je := public.acc_post_document_entry(p_company, 'PAYMENT', coalesce(p_date, current_date), v_memo, coalesce(nullif(trim(p_extra->>'reference'),''), nullif(trim(p_extra->>'exchange_reference'),'')),
    'SUPPLIER', p_supplier, v_bank.id, v_pkr, v_lines, 'FX_PAYMENT', v_id);
  update public.fx_payments set journal_entry_id = v_je where id = v_id;

  for x in select * from jsonb_array_elements(coalesce(p_bills, '[]'::jsonb)) loop
    if coalesce(nullif(x->>'amount','')::numeric, 0) <= 0 then continue; end if;
    v_sum := v_sum + (x->>'amount')::numeric;
    if v_sum > p_fx then raise exception 'Applied to bills more than was paid' using errcode = '23514'; end if;
    perform public.fx_allocate(v_id, (x->>'bill_id')::uuid, (x->>'amount')::numeric, null);
  end loop;
  return v_id;
end $$;
revoke execute on function public.fx_pay_core(uuid, uuid, text, numeric, numeric, date, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;

-- public: record a foreign payment (optionally applied to bills right away)
create or replace function public.pay_supplier_fx(p_company_id uuid, p_supplier_id uuid, p_currency text, p_fx_amount numeric, p_fx_rate numeric, p_date date,
  p_source jsonb, p_bills jsonb default '[]'::jsonb, p_extra jsonb default '{}'::jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company_id, 'purchasing.approve');
  perform public.inv_require(p_company_id, 'journals.create');
  return public.fx_pay_core(p_company_id, p_supplier_id, p_currency, p_fx_amount, p_fx_rate, p_date, p_source, p_bills, coalesce(p_extra, '{}'::jsonb), p_idempotency_key);
end $$;
revoke execute on function public.pay_supplier_fx(uuid, uuid, text, numeric, numeric, date, jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.pay_supplier_fx(uuid, uuid, text, numeric, numeric, date, jsonb, jsonb, jsonb, uuid) to authenticated;

-- public: apply an earlier foreign payment to bills [{bill_id, amount (bill currency)}]
create or replace function public.apply_fx_payment(p_fx_payment_id uuid, p_bills jsonb, p_date date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare p public.fx_payments; x jsonb; n int := 0;
begin
  select * into p from public.fx_payments where id = p_fx_payment_id;
  if p.id is null then raise exception 'Foreign payment not found' using errcode = 'P0002'; end if;
  perform public.inv_require(p.company_id, 'purchasing.approve');
  perform public.inv_require(p.company_id, 'journals.create');
  for x in select * from jsonb_array_elements(coalesce(p_bills, '[]'::jsonb)) loop
    if coalesce(nullif(x->>'amount','')::numeric, 0) <= 0 then continue; end if;
    perform public.fx_allocate(p.id, (x->>'bill_id')::uuid, (x->>'amount')::numeric, p_date);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.apply_fx_payment(uuid, jsonb, date) from public, anon;
grant execute on function public.apply_fx_payment(uuid, jsonb, date) to authenticated;

-- unlink: a foreign settlement entry is reversed (FX gain / loss undone)
create or replace function public.remove_supplier_allocation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.supplier_bill_allocations; v_date date;
begin
  select * into a from public.supplier_bill_allocations where id = p_id for update;
  if a.id is null or a.status <> 'ACTIVE' then raise exception 'Allocation not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(a.company_id, 'purchasing.approve') or public.has_permission(a.company_id, 'journals.create')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if a.fx_entry_id is not null then
    select greatest(entry_date, current_date) into v_date from public.journal_entries where id = a.fx_entry_id;
    perform public.acc_reverse_document_entry(a.fx_entry_id, 'Payment unlinked from the bill', v_date);
  end if;
  update public.supplier_bill_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid() where id = p_id;
end $$;
revoke execute on function public.remove_supplier_allocation(uuid) from public, anon;
grant execute on function public.remove_supplier_allocation(uuid) to authenticated;

create or replace function public.reverse_fx_payment(p_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.fx_payments; a record;
begin
  select * into p from public.fx_payments where id = p_id for update;
  if p.id is null then raise exception 'Foreign payment not found' using errcode = 'P0002'; end if;
  perform public.inv_require(p.company_id, 'purchasing.approve');
  perform public.inv_require(p.company_id, 'journals.post');
  if p.status <> 'POSTED' then raise exception 'This payment is already reversed' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  for a in select id from public.supplier_bill_allocations where fx_payment_id = p.id and status = 'ACTIVE' loop
    perform public.remove_supplier_allocation(a.id);
  end loop;
  perform public.acc_reverse_document_entry(p.journal_entry_id, trim(p_reason), coalesce(p_date, greatest(p.pay_date, current_date)));
  update public.fx_payments set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason) where id = p.id;
end $$;
revoke execute on function public.reverse_fx_payment(uuid, text, date) from public, anon;
grant execute on function public.reverse_fx_payment(uuid, text, date) to authenticated;

-- PKR payment lists leave foreign payments out (they settle foreign bills only)
create or replace function public.supplier_open_payments(p_supplier_id uuid)
returns table(entry_id uuid, entry_no text, entry_date date, amount numeric, allocated numeric, unallocated numeric, reference text)
language sql stable security definer set search_path = '' as $$
  select je.id, je.entry_no, je.entry_date, d.amt, coalesce(a.al, 0), d.amt - coalesce(a.al, 0), je.reference
  from public.journal_entries je
  join lateral (select sum(jl.debit - jl.credit) amt from public.journal_lines jl join public.chart_of_accounts c on c.id = jl.account_id
                where jl.entry_id = je.id and jl.party_type = 'SUPPLIER' and jl.party_id = p_supplier_id and c.system_key in ('AP_CONTROL','SUPPLIER_ADVANCE')) d on true
  left join lateral (select sum(amount) al from public.supplier_bill_allocations where payment_entry_id = je.id and status = 'ACTIVE') a on true
  where je.status = 'POSTED' and je.entry_type = 'PAYMENT' and coalesce(je.source_type, '') <> 'FX_PAYMENT' and d.amt > 0 and d.amt - coalesce(a.al, 0) > 0
    and exists (select 1 from public.suppliers s where s.id = p_supplier_id and public.has_permission(s.company_id, 'purchasing.costs'))
  order by je.entry_date;
$$;

create or replace function public.supplier_open_fx_payments(p_supplier_id uuid, p_currency text default null)
returns table(fx_payment_id uuid, doc_no text, pay_date date, currency text, fx_amount numeric, fx_rate numeric, applied numeric, unapplied numeric, reference text, paid_via text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.doc_no, p.pay_date, p.currency, p.fx_amount, p.fx_rate, coalesce(a.al, 0), p.fx_amount - coalesce(a.al, 0),
         coalesce(p.reference, p.exchange_reference), coalesce(b.name, g.name)
  from public.fx_payments p
  left join public.bank_accounts b on b.id = p.bank_account_id
  left join public.payment_agents g on g.id = p.agent_id
  left join lateral (select sum(fx_amount) al from public.supplier_bill_allocations where fx_payment_id = p.id and status = 'ACTIVE') a on true
  where p.supplier_id = p_supplier_id and p.status = 'POSTED' and (p_currency is null or p.currency = p_currency)
    and p.fx_amount - coalesce(a.al, 0) > 0
    and public.has_permission(p.company_id, 'purchasing.costs')
  order by p.pay_date, p.doc_no;
$$;
revoke execute on function public.supplier_open_fx_payments(uuid, text) from public, anon;
grant execute on function public.supplier_open_fx_payments(uuid, text) to authenticated;

-- PKR-only guards: a PKR voucher cannot settle a foreign bill
create or replace function public.allocate_supplier_payment(p_entry_id uuid, p_allocations jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare je record; x jsonb; v_amt numeric; v_bill record; v_free numeric; n int := 0;
begin
  select * into je from public.journal_entries where id = p_entry_id;
  if je.id is null or je.status <> 'POSTED' or je.entry_type <> 'PAYMENT' then raise exception 'Choose a posted payment voucher' using errcode = '22023'; end if;
  if not (public.has_permission(je.company_id, 'purchasing.approve') or public.has_permission(je.company_id, 'journals.create')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if je.source_type = 'FX_PAYMENT' then
    return public.apply_fx_payment(je.source_id, p_allocations, null);
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amt := coalesce(nullif(x->>'amount','')::numeric, 0);
    if v_amt <= 0 then continue; end if;
    select * into v_bill from public.supplier_bills_v where id = (x->>'bill_id')::uuid;
    if v_bill.id is null or v_bill.status <> 'POSTED' then raise exception 'Bill not found' using errcode = 'P0002'; end if;
    if v_bill.currency <> 'PKR' then raise exception 'Bill % is in % — pay it with a foreign-currency payment (it keeps the rate of each payment)', v_bill.doc_no, v_bill.currency using errcode = '22023'; end if;
    select unallocated into v_free from public.supplier_open_payments(v_bill.supplier_id) where entry_id = p_entry_id;
    if coalesce(v_free, 0) < v_amt then raise exception 'This payment has only % not yet allocated for %', coalesce(v_free, 0), v_bill.supplier_name using errcode = '23514'; end if;
    if v_amt > v_bill.outstanding_pkr then raise exception 'Bill % has only % outstanding', v_bill.doc_no, v_bill.outstanding_pkr using errcode = '23514'; end if;
    insert into public.supplier_bill_allocations(company_id, payment_entry_id, bill_id, amount) values (je.company_id, p_entry_id, v_bill.id, v_amt);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- supplier bill posting: AP in the bill currency; Pay Supplier Now in foreign currency
CREATE OR REPLACE FUNCTION public.post_supplier_bill(p_id uuid, p_pay jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h public.supplier_bills; v_lines jsonb; x jsonb; n int := 0; r record; v_amt numeric; v_pkr numeric; v_rv numeric;
  v_grni numeric := 0; v_inv numeric := 0; v_jl jsonb := '[]'::jsonb; v_je uuid; t record; v_exp record; v_recs uuid[] := '{}'; g uuid; v_task record; v_pay numeric;
  v_disc_pkr numeric; v_gross_pkr numeric; v_share numeric; v_left numeric; v_net numeric; v_factor numeric; v_count int;
begin
  select * into h from public.supplier_bills where id = p_id for update;
  if h.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.approve');
  if h.status = 'POSTED' then return h.journal_entry_id; end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % bill', lower(h.status) using errcode = '22023'; end if;
  v_lines := public.bill_check_lines(h.company_id, h.supplier_id, h.id, h.lines_draft, true);
  select * into t from public.bill_totals(v_lines, h.fx_rate);
  if h.discount_amount > t.total then raise exception 'Discount is more than the bill' using errcode = '23514'; end if;
  v_gross_pkr := t.total_pkr;
  v_disc_pkr := round(coalesce(h.discount_amount, 0) * h.fx_rate, 2);
  v_left := v_disc_pkr;
  v_factor := case when t.total > 0 then (t.total - coalesce(h.discount_amount, 0)) / t.total else 1 end;   -- net price factor
  v_count := jsonb_array_length(v_lines);
  if v_gross_pkr - v_disc_pkr <= 0 then raise exception 'The bill total must be above zero' using errcode = '23514'; end if;

  for x in select * from jsonb_array_elements(v_lines) loop
    n := n + 1;
    v_amt := round((x->>'quantity')::numeric * (x->>'unit_price')::numeric, 2);
    v_pkr := round(v_amt * h.fx_rate, 2);
    -- this line's part of the discount (the last line takes the rounding)
    v_share := case when n = v_count then v_left when v_gross_pkr > 0 then round(v_disc_pkr * v_pkr / v_gross_pkr, 2) else 0 end;
    v_left := v_left - v_share;
    v_net := v_pkr - v_share;
    v_rv := null;
    if x->>'kind' = 'ITEM' then
      select * into r from public.goods_receipt_lines where id = (x->>'receipt_line_id')::uuid for update;
      if r.cost_source = 'COST_TASK' and r.cost_entry_id is not null then
        v_rv := round((x->>'quantity')::numeric * r.unit_cost_pkr, 2);   -- clears what the receipt put into GRNI
        v_grni := v_grni + v_rv;
        v_inv := v_inv + (v_net - v_rv);
      else
        v_inv := v_inv + v_net;                                           -- receipt had no cost: the bill (after discount) is the cost
        if r.unit_cost is null then
          update public.goods_receipt_lines set unit_cost = round((x->>'unit_price')::numeric * v_factor, 4),
            unit_cost_pkr = round((x->>'unit_price')::numeric * v_factor * h.fx_rate, 4), cost_source = 'BILL' where id = r.id;
        end if;
      end if;
      update public.goods_receipt_lines set billed_qty = billed_qty + (x->>'quantity')::numeric where id = r.id;
      v_recs := v_recs || r.receipt_id;
    end if;
    insert into public.supplier_bill_lines(company_id, bill_id, line_no, kind, receipt_line_id, product_id, variant_id, account_id, description, quantity, unit_price, amount, amount_pkr, receipt_value_pkr, discount_pkr)
    values (h.company_id, h.id, n, x->>'kind', nullif(x->>'receipt_line_id','')::uuid, nullif(x->>'product_id','')::uuid, nullif(x->>'variant_id','')::uuid,
      nullif(x->>'account_id','')::uuid, x->>'description', (x->>'quantity')::numeric, (x->>'unit_price')::numeric, v_amt, v_net, v_rv, v_share);
  end loop;

  if v_grni > 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'GRNI'), 'debit', v_grni, 'description', 'Received goods billed ' || h.doc_no)); end if;
  if v_inv > 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'INVENTORY'), 'debit', v_inv, 'description', 'Stock cost per bill ' || h.doc_no));
  elsif v_inv < 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'INVENTORY'), 'credit', -v_inv, 'description', 'Bill below receipt cost ' || h.doc_no)); end if;
  for v_exp in select account_id, sum(amount_pkr) amt, string_agg(description, '; ') d from public.supplier_bill_lines where bill_id = h.id and kind = 'EXPENSE' group by account_id loop
    v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_exp.account_id, 'debit', v_exp.amt, 'description', left(v_exp.d, 200)));
  end loop;
  -- the supplier is credited in the bill currency at the bill rate (Stage 9)
  v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'AP_CONTROL'), 'credit', v_gross_pkr - v_disc_pkr, 'party_type', 'SUPPLIER', 'party_id', h.supplier_id,
    'currency', case when h.currency <> 'PKR' then h.currency end, 'fx_amount', case when h.currency <> 'PKR' then t.total - coalesce(h.discount_amount, 0) end,
    'fx_rate', case when h.currency <> 'PKR' then h.fx_rate end,
    'description', 'Bill ' || h.doc_no || coalesce(' / ' || h.supplier_invoice_no, '')));
  v_je := public.acc_post_document_entry(h.company_id, 'SYSTEM', h.bill_date, 'Supplier bill ' || h.doc_no || coalesce(' (' || h.supplier_invoice_no || ')', ''),
    coalesce(h.supplier_invoice_no, h.doc_no), 'SUPPLIER', h.supplier_id, null, v_gross_pkr - v_disc_pkr, v_jl, 'SUPPLIER_BILL', h.id);

  -- receipts costed by this bill
  foreach g in array coalesce((select array_agg(distinct u) from unnest(v_recs) u), '{}'::uuid[]) loop
    if not exists (select 1 from public.goods_receipt_lines where receipt_id = g and unit_cost is null) then
      update public.goods_receipts set cost_status = 'APPROVED', cost_currency = coalesce(cost_currency, h.currency), cost_fx_rate = coalesce(cost_fx_rate, h.fx_rate) where id = g;
      for v_task in select * from public.purchase_cost_tasks where receipt_id = g and status in ('OPEN','SUBMITTED','RETURNED') loop
        update public.purchase_cost_tasks set status = 'CANCELLED', updated_at = now() where id = v_task.id;
        insert into public.purchase_cost_task_events(company_id, task_id, event, note) values (h.company_id, v_task.id, 'CANCELLED', 'Costed by supplier bill ' || h.doc_no);
      end loop;
    end if;
  end loop;

  update public.supplier_bills set status = 'POSTED', journal_entry_id = v_je, total_amount = t.total - coalesce(h.discount_amount, 0), total_pkr = v_gross_pkr - v_disc_pkr, posted_at = now(), posted_by = auth.uid(), updated_at = now() where id = h.id;

  if p_pay is not null and coalesce(nullif(p_pay->>'amount','')::numeric, 0) > 0 then
    v_pay := (p_pay->>'amount')::numeric;
    perform public.inv_require(h.company_id, 'journals.create');
    if h.currency <> 'PKR' then
      -- Pay Supplier Now in the bill currency at this payment's own rate (bank or payment agent)
      perform public.fx_pay_core(h.company_id, h.supplier_id, h.currency, v_pay, nullif(p_pay->>'fx_rate','')::numeric, coalesce(nullif(p_pay->>'date','')::date, h.bill_date),
        coalesce(p_pay->'source', jsonb_build_object('kind', 'BANK', 'bank_account_id', p_pay->>'bank_account_id')),
        jsonb_build_array(jsonb_build_object('bill_id', h.id, 'amount', least(v_pay, t.total - coalesce(h.discount_amount, 0)))),
        jsonb_build_object('reference', coalesce(nullif(p_pay->>'reference',''), h.supplier_invoice_no), 'exchange_reference', p_pay->>'exchange_reference', 'shipment_id', h.shipment_id), null);
    else
      perform public.supplier_pay(h.company_id, h.supplier_id, nullif(p_pay->>'bank_account_id','')::uuid, v_pay, coalesce(nullif(p_pay->>'date','')::date, h.bill_date),
        coalesce(nullif(p_pay->>'reference',''), h.supplier_invoice_no), jsonb_build_array(jsonb_build_object('bill_id', h.id, 'amount', least(v_pay, v_gross_pkr - v_disc_pkr))),
        'Payment for ' || h.doc_no);
    end if;
  end if;
  return v_je;
end $function$;

-- bill → its settlements (rates, PKR actually paid, FX difference; weighted average for reporting only)
create or replace function public.bill_settlements(p_bill_id uuid)
returns table(allocation_id uuid, settle_date date, payment_no text, payment_entry_id uuid, fx_payment_id uuid, paid_via text, fx_amount numeric,
              bill_rate numeric, pay_rate numeric, carrying_pkr numeric, actual_pkr numeric, fx_diff numeric, fx_entry_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.id, coalesce(a.settle_date, je.entry_date), coalesce(p.doc_no, je.entry_no), a.payment_entry_id, a.fx_payment_id,
         coalesce(bk.name, g.name, jb.name), coalesce(a.fx_amount, a.amount), coalesce(a.bill_rate, 1), coalesce(a.pay_rate, 1),
         a.amount, coalesce(a.pkr_at_payment, a.amount), a.fx_diff, a.fx_entry_id
  from public.supplier_bill_allocations a
  join public.journal_entries je on je.id = a.payment_entry_id
  left join public.fx_payments p on p.id = a.fx_payment_id
  left join public.bank_accounts bk on bk.id = p.bank_account_id
  left join public.payment_agents g on g.id = p.agent_id
  left join public.bank_accounts jb on jb.id = je.bank_account_id
  where a.bill_id = p_bill_id and a.status = 'ACTIVE'
    and public.has_permission(a.company_id, 'purchasing.costs')
  order by 2, a.created_at;
$$;
revoke execute on function public.bill_settlements(uuid) from public, anon;
grant execute on function public.bill_settlements(uuid) to authenticated;

-- list view of foreign payments
create or replace view public.fx_payments_v with (security_invoker = true) as
select p.id, p.company_id, p.doc_no, p.pay_date, p.supplier_id, s.name as supplier_name, p.currency, p.fx_amount, p.fx_rate, p.amount_pkr,
       p.source_kind, p.bank_account_id, b.name as bank_name, p.agent_id, g.name as agent_name, p.source_currency, p.source_amount,
       p.reference, p.exchange_reference, p.supplier_bank_reference, p.shipment_id, sh.doc_no as shipment_no, p.notes, p.journal_entry_id, p.status,
       p.reversal_reason, p.created_at,
       coalesce(a.applied, 0) as applied, p.fx_amount - coalesce(a.applied, 0) as unapplied, coalesce(a.fx_diff, 0) as fx_diff, a.bills
from public.fx_payments p
join public.suppliers s on s.id = p.supplier_id
left join public.bank_accounts b on b.id = p.bank_account_id
left join public.payment_agents g on g.id = p.agent_id
left join public.shipments sh on sh.id = p.shipment_id
left join lateral (select sum(x.fx_amount) applied, sum(x.fx_diff) fx_diff, string_agg(sb.doc_no, ', ' order by sb.doc_no) bills
                   from public.supplier_bill_allocations x join public.supplier_bills sb on sb.id = x.bill_id
                   where x.fx_payment_id = p.id and x.status = 'ACTIVE') a on true;
grant select on public.fx_payments_v to authenticated;
