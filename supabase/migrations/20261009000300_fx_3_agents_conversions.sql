-- =====================================================================
-- JS Traders ERP — Stage 9 part 3: payment agents, currency conversions, FX reports (spec §12, §13)
-- Payment agents: Company bank → Agent (advance, per currency sub-account) → foreign supplier.
--   AGT- transactions: FUND (bank → agent), REFUND (agent → bank), CHARGE (agent fee),
--   OPENING (agent balance at go-live; negative = we owe the agent).
--   Settlements are foreign payments (FXP-) paid from an agent sub-account.
--   Agent balance > 0 = advance with the agent; < 0 = agent is owed (payable).
-- Currency conversions (CCV-): a supplier balance, an agent's money or a bank's money
--   moved from one currency to another. Old transactions stay unchanged; any PKR
--   difference between the two sides is realized FX gain / loss.
-- =====================================================================

-- ---------------------------------------------------------------- agent transactions
create table if not exists public.payment_agent_transactions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  doc_no           text not null,
  txn_date         date not null,
  agent_id         uuid not null references public.payment_agents(id),
  kind             text not null check (kind in ('FUND','REFUND','CHARGE','OPENING')),
  currency         text not null references public.currencies(code),   -- agent sub-account
  amount           numeric(18,2) not null check (amount <> 0),           -- in that currency (OPENING may be negative = payable)
  fx_rate          numeric(18,6) not null check (fx_rate > 0),
  amount_pkr       numeric(18,2) not null,
  bank_account_id  uuid references public.bank_accounts(id),
  bank_amount      numeric(18,2),
  expense_account_id uuid references public.chart_of_accounts(id),
  reference        text,
  notes            text,
  journal_entry_id uuid references public.journal_entries(id),
  status           text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key  uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no),
  check (kind = 'OPENING' or amount > 0),
  check (kind not in ('FUND','REFUND') or bank_account_id is not null)
);
create index if not exists pat_agent_idx on public.payment_agent_transactions(agent_id, txn_date);
create trigger stamp before insert or update on public.payment_agent_transactions for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.payment_agent_transactions for each row execute function public.tg_audit_row();
alter table public.payment_agent_transactions enable row level security;
revoke insert, update, delete on public.payment_agent_transactions from authenticated, anon;
create policy pat_select on public.payment_agent_transactions for select to authenticated
  using (public.has_permission(company_id, 'payment_agents.view') or public.has_permission(company_id, 'journals.view'));

create or replace function public.save_agent_transaction(p_header jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_kind text := upper(coalesce(p_header->>'kind','')); v_agent public.payment_agents; v_cur text;
  v_amt numeric; v_rate numeric; v_pkr numeric; v_bank public.bank_accounts; v_bank_amt numeric; v_exp uuid; v_date date; v_id uuid; v_no text; v_lines jsonb; v_je uuid;
  v_agent_line jsonb; v_other jsonb; v_memo text;
begin
  perform public.inv_require(v_company, 'payment_agents.manage');
  perform public.inv_require(v_company, 'journals.create');
  if p_idempotency_key is not null then
    select id into v_id from public.payment_agent_transactions where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  if v_kind not in ('FUND','REFUND','CHARGE','OPENING') then raise exception 'Choose what this is (fund / refund / charge / opening)' using errcode = '23502'; end if;
  select * into v_agent from public.payment_agents where id = nullif(p_header->>'agent_id','')::uuid and company_id = v_company;
  if v_agent.id is null then raise exception 'Choose the payment agent' using errcode = '23502'; end if;
  v_cur := upper(coalesce(nullif(p_header->>'currency',''), 'PKR'));
  if not exists (select 1 from public.currencies where code = v_cur and is_active) then raise exception 'Unknown currency %', v_cur using errcode = '22023'; end if;
  v_amt := round(coalesce(nullif(p_header->>'amount','')::numeric, 0), 2);
  if v_amt = 0 or (v_kind <> 'OPENING' and v_amt < 0) then raise exception 'Enter the amount' using errcode = '23502'; end if;
  v_rate := case when v_cur = 'PKR' then 1 else nullif(p_header->>'fx_rate','')::numeric end;
  if coalesce(v_rate, 0) <= 0 then raise exception 'Enter the exchange rate (PKR per 1 %)', v_cur using errcode = '23502'; end if;
  v_pkr := round(v_amt * v_rate, 2);
  v_date := coalesce(nullif(p_header->>'txn_date','')::date, current_date);

  if v_kind in ('FUND','REFUND') then
    select * into v_bank from public.bank_accounts where id = nullif(p_header->>'bank_account_id','')::uuid and company_id = v_company and is_active;
    if v_bank.id is null then raise exception 'Choose the bank / cash account' using errcode = '23502'; end if;
    if v_bank.currency <> 'PKR' and v_bank.currency <> v_cur then
      raise exception '% is a % account — fund the agent''s % or PKR sub-account from it', v_bank.name, v_bank.currency, v_bank.currency using errcode = '22023';
    end if;
    v_bank_amt := case when v_bank.currency = 'PKR' then v_pkr else abs(v_amt) end;
  elsif v_kind = 'CHARGE' then
    v_exp := coalesce(nullif(p_header->>'expense_account_id','')::uuid, public.hr_account(v_company, 'BANK_CHARGES'));
  end if;

  v_no := public.next_document_number(v_company, 'AGENT_TXN');
  insert into public.payment_agent_transactions(company_id, doc_no, txn_date, agent_id, kind, currency, amount, fx_rate, amount_pkr, bank_account_id, bank_amount,
    expense_account_id, reference, notes, idempotency_key)
  values (v_company, v_no, v_date, v_agent.id, v_kind, v_cur, v_amt, v_rate, v_pkr, v_bank.id, v_bank_amt, v_exp,
    nullif(trim(p_header->>'reference'),''), nullif(trim(p_header->>'notes'),''), p_idempotency_key)
  returning id into v_id;

  v_memo := case v_kind when 'FUND' then 'Funds sent to ' when 'REFUND' then 'Refund from ' when 'CHARGE' then 'Charges of ' else 'Opening balance — ' end
            || v_agent.name || ' (' || v_cur || ' ' || abs(v_amt) || case when v_cur <> 'PKR' then ' @ ' || v_rate else '' end || ')';
  -- agent side: debit = money with the agent goes up
  v_agent_line := jsonb_build_object('account_id', public.hr_account(v_company, 'AGENT_ADVANCE'), 'party_type', 'AGENT', 'party_id', v_agent.id,
    'currency', v_cur, 'fx_amount', abs(v_amt), 'fx_rate', v_rate, 'description', v_no || ' ' || lower(v_kind));
  if v_kind = 'FUND' or (v_kind = 'OPENING' and v_amt > 0) then
    v_agent_line := v_agent_line || jsonb_build_object('debit', abs(v_pkr));
  else
    v_agent_line := v_agent_line || jsonb_build_object('credit', abs(v_pkr));
  end if;
  v_other := case v_kind
    when 'FUND' then jsonb_build_object('account_id', v_bank.gl_account_id, 'credit', v_pkr, 'bank_account_id', v_bank.id)
    when 'REFUND' then jsonb_build_object('account_id', v_bank.gl_account_id, 'debit', v_pkr, 'bank_account_id', v_bank.id)
    when 'CHARGE' then jsonb_build_object('account_id', v_exp, 'debit', v_pkr)
    else jsonb_build_object('account_id', public.hr_account(v_company, 'OPENING_BALANCE'), case when v_amt > 0 then 'credit' else 'debit' end, abs(v_pkr))
  end;
  if v_kind in ('FUND','REFUND') and v_bank.currency <> 'PKR' then
    v_other := v_other || jsonb_build_object('currency', v_bank.currency, 'fx_amount', v_bank_amt, 'fx_rate', v_rate);
  end if;
  v_other := v_other || jsonb_build_object('description', v_memo);
  v_lines := jsonb_build_array(v_agent_line, v_other);
  v_je := public.acc_post_document_entry(v_company, case v_kind when 'FUND' then 'PAYMENT' when 'REFUND' then 'RECEIPT' when 'OPENING' then 'OPENING' else 'JOURNAL' end,
    v_date, v_memo, nullif(trim(p_header->>'reference'),''), 'AGENT', v_agent.id, v_bank.id, abs(v_pkr), v_lines, 'AGENT_TXN', v_id);
  update public.payment_agent_transactions set journal_entry_id = v_je where id = v_id;
  return v_id;
end $$;
revoke execute on function public.save_agent_transaction(jsonb, uuid) from public, anon;
grant execute on function public.save_agent_transaction(jsonb, uuid) to authenticated;

create or replace function public.reverse_agent_transaction(p_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.payment_agent_transactions;
begin
  select * into t from public.payment_agent_transactions where id = p_id for update;
  if t.id is null then raise exception 'Agent transaction not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'payment_agents.manage');
  perform public.inv_require(t.company_id, 'journals.post');
  if t.status <> 'POSTED' then raise exception 'Already reversed' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  perform public.acc_reverse_document_entry(t.journal_entry_id, trim(p_reason), coalesce(p_date, greatest(t.txn_date, current_date)));
  update public.payment_agent_transactions set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason) where id = p_id;
end $$;
revoke execute on function public.reverse_agent_transaction(uuid, text, date) from public, anon;
grant execute on function public.reverse_agent_transaction(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------- currency conversions
create table if not exists public.currency_conversions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  doc_no           text not null,
  conv_date        date not null,
  holder_kind      text not null check (holder_kind in ('SUPPLIER','AGENT','BANK')),
  supplier_id      uuid references public.suppliers(id),
  agent_id         uuid references public.payment_agents(id),
  from_bank_id     uuid references public.bank_accounts(id),
  to_bank_id       uuid references public.bank_accounts(id),
  from_currency    text not null references public.currencies(code),
  from_amount      numeric(18,2) not null check (from_amount > 0),
  from_rate        numeric(18,6) not null check (from_rate > 0),
  from_pkr         numeric(18,2) not null,
  to_currency      text not null references public.currencies(code),
  to_amount        numeric(18,2) not null check (to_amount > 0),
  to_rate          numeric(18,6) not null check (to_rate > 0),
  to_pkr           numeric(18,2) not null,
  fx_diff          numeric(18,2) not null default 0,     -- + loss / − gain
  reference        text,
  notes            text,
  journal_entry_id uuid references public.journal_entries(id),
  status           text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key  uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no),
  check (from_currency <> to_currency)
);
create trigger stamp before insert or update on public.currency_conversions for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.currency_conversions for each row execute function public.tg_audit_row();
alter table public.currency_conversions enable row level security;
revoke insert, update, delete on public.currency_conversions from authenticated, anon;
create policy ccv_select on public.currency_conversions for select to authenticated using (public.has_permission(company_id, 'journals.view'));

create or replace function public.save_currency_conversion(p_header jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_kind text := upper(coalesce(p_header->>'holder_kind',''));
  v_fc text := upper(coalesce(p_header->>'from_currency','')); v_tc text := upper(coalesce(p_header->>'to_currency',''));
  v_fa numeric := round(coalesce(nullif(p_header->>'from_amount','')::numeric, 0), 2); v_ta numeric := round(coalesce(nullif(p_header->>'to_amount','')::numeric, 0), 2);
  v_fr numeric; v_tr numeric; v_fp numeric; v_tp numeric; v_diff numeric; v_date date; v_id uuid; v_no text; v_je uuid; v_lines jsonb;
  v_sup uuid; v_ag uuid; v_fb public.bank_accounts; v_tb public.bank_accounts; v_acc uuid; v_name text; v_memo text; v_from jsonb; v_to jsonb;
begin
  perform public.inv_require(v_company, 'journals.create');
  perform public.inv_require(v_company, 'journals.post');
  if p_idempotency_key is not null then
    select id into v_id from public.currency_conversions where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  if v_kind not in ('SUPPLIER','AGENT','BANK') then raise exception 'Choose what is converted (supplier balance / agent money / bank money)' using errcode = '23502'; end if;
  if v_fc = '' or v_tc = '' or v_fc = v_tc then raise exception 'Choose two different currencies' using errcode = '23502'; end if;
  if v_fa <= 0 or v_ta <= 0 then raise exception 'Enter both amounts' using errcode = '23502'; end if;
  v_fr := case when v_fc = 'PKR' then 1 else nullif(p_header->>'from_rate','')::numeric end;
  if coalesce(v_fr, 0) <= 0 then raise exception 'Enter the rate the % amount is carried at (PKR per 1 %)', v_fc, v_fc using errcode = '23502'; end if;
  v_fp := round(v_fa * v_fr, 2);
  -- the new currency is valued at the given rate, or (left blank) at the same PKR value → no gain / loss
  v_tr := case when v_tc = 'PKR' then 1 else coalesce(nullif(p_header->>'to_rate','')::numeric, round(v_fp / v_ta, 6)) end;
  v_tp := case when v_tc = 'PKR' then v_ta when nullif(p_header->>'to_rate','') is null then v_fp else round(v_ta * v_tr, 2) end;
  v_date := coalesce(nullif(p_header->>'conv_date','')::date, current_date);

  if v_kind = 'SUPPLIER' then
    select id, name into v_sup, v_name from public.suppliers where id = nullif(p_header->>'supplier_id','')::uuid and company_id = v_company;
    if v_sup is null then raise exception 'Choose the supplier' using errcode = '23502'; end if;
    v_acc := public.hr_account(v_company, 'AP_CONTROL');
    -- liability: the old currency goes down (debit), the new one goes up (credit)
    v_from := jsonb_build_object('account_id', v_acc, 'debit', v_fp, 'party_type', 'SUPPLIER', 'party_id', v_sup);
    v_to   := jsonb_build_object('account_id', v_acc, 'credit', v_tp, 'party_type', 'SUPPLIER', 'party_id', v_sup);
    v_diff := v_tp - v_fp;                                   -- owing more PKR after = loss
  elsif v_kind = 'AGENT' then
    select id, name into v_ag, v_name from public.payment_agents where id = nullif(p_header->>'agent_id','')::uuid and company_id = v_company;
    if v_ag is null then raise exception 'Choose the payment agent' using errcode = '23502'; end if;
    v_acc := public.hr_account(v_company, 'AGENT_ADVANCE');
    v_from := jsonb_build_object('account_id', v_acc, 'credit', v_fp, 'party_type', 'AGENT', 'party_id', v_ag);
    v_to   := jsonb_build_object('account_id', v_acc, 'debit', v_tp, 'party_type', 'AGENT', 'party_id', v_ag);
    v_diff := v_fp - v_tp;                                   -- holding less PKR value after = loss
  else
    select * into v_fb from public.bank_accounts where id = nullif(p_header->>'from_bank_id','')::uuid and company_id = v_company;
    select * into v_tb from public.bank_accounts where id = nullif(p_header->>'to_bank_id','')::uuid and company_id = v_company;
    if v_fb.id is null or v_tb.id is null then raise exception 'Choose both bank / cash accounts' using errcode = '23502'; end if;
    if v_fb.currency <> v_fc or v_tb.currency <> v_tc then raise exception 'The accounts must be in % and %', v_fc, v_tc using errcode = '22023'; end if;
    v_name := v_fb.name || ' → ' || v_tb.name;
    v_from := jsonb_build_object('account_id', v_fb.gl_account_id, 'credit', v_fp, 'bank_account_id', v_fb.id);
    v_to   := jsonb_build_object('account_id', v_tb.gl_account_id, 'debit', v_tp, 'bank_account_id', v_tb.id);
    v_diff := v_fp - v_tp;
  end if;
  -- currency columns (PKR bank lines stay plain)
  if not (v_kind = 'BANK' and v_fc = 'PKR') then v_from := v_from || jsonb_build_object('currency', v_fc, 'fx_amount', v_fa, 'fx_rate', v_fr); end if;
  if not (v_kind = 'BANK' and v_tc = 'PKR') then v_to := v_to || jsonb_build_object('currency', v_tc, 'fx_amount', v_ta, 'fx_rate', v_tr); end if;

  v_no := public.next_document_number(v_company, 'CURRENCY_CONVERSION');
  insert into public.currency_conversions(company_id, doc_no, conv_date, holder_kind, supplier_id, agent_id, from_bank_id, to_bank_id, from_currency, from_amount, from_rate, from_pkr,
    to_currency, to_amount, to_rate, to_pkr, fx_diff, reference, notes, idempotency_key)
  values (v_company, v_no, v_date, v_kind, v_sup, v_ag, v_fb.id, v_tb.id, v_fc, v_fa, v_fr, v_fp, v_tc, v_ta, v_tr, v_tp, v_diff,
    nullif(trim(p_header->>'reference'),''), nullif(trim(p_header->>'notes'),''), p_idempotency_key)
  returning id into v_id;
  v_memo := format('%s: %s %s → %s %s (%s)', v_no, v_fc, v_fa, v_tc, v_ta, v_name);
  v_lines := jsonb_build_array(v_from || jsonb_build_object('description', v_memo), v_to || jsonb_build_object('description', v_memo));
  if v_diff > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(v_company, 'FX_GAIN_LOSS'), 'debit', v_diff, 'description', 'Exchange loss on ' || v_no));
  elsif v_diff < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(v_company, 'FX_GAIN_LOSS'), 'credit', -v_diff, 'description', 'Exchange gain on ' || v_no));
  end if;
  v_je := public.acc_post_document_entry(v_company, 'JOURNAL', v_date, 'Currency conversion ' || v_memo, nullif(trim(p_header->>'reference'),''),
    case v_kind when 'SUPPLIER' then 'SUPPLIER' when 'AGENT' then 'AGENT' end, coalesce(v_sup, v_ag), null, v_fp, v_lines, 'CURRENCY_CONVERSION', v_id);
  update public.currency_conversions set journal_entry_id = v_je where id = v_id;
  return v_id;
end $$;
revoke execute on function public.save_currency_conversion(jsonb, uuid) from public, anon;
grant execute on function public.save_currency_conversion(jsonb, uuid) to authenticated;

create or replace function public.reverse_currency_conversion(p_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.currency_conversions;
begin
  select * into t from public.currency_conversions where id = p_id for update;
  if t.id is null then raise exception 'Conversion not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'journals.post');
  if t.status <> 'POSTED' then raise exception 'Already reversed' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  perform public.acc_reverse_document_entry(t.journal_entry_id, trim(p_reason), coalesce(p_date, greatest(t.conv_date, current_date)));
  update public.currency_conversions set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason) where id = p_id;
end $$;
revoke execute on function public.reverse_currency_conversion(uuid, text, date) from public, anon;
grant execute on function public.reverse_currency_conversion(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------- read models
-- Balance per party (or bank) per currency. Lines without a currency count as PKR.
-- Sign: SUPPLIER + = we owe them; AGENT + = money with the agent (advance), − = we owe the agent; BANK + = money in the account.
create or replace function public.currency_balances(p_company_id uuid, p_kind text, p_as_of date default null)
returns table(holder_id uuid, code text, name text, currency text, fx_balance numeric, pkr_balance numeric, carrying_rate numeric, last_date date)
language sql stable security invoker set search_path = '' as $$
  with l as (
    select case when p_kind = 'BANK' then jl.bank_account_id else jl.party_id end as hid,
           coalesce(jl.currency, 'PKR') as cur,
           case when jl.debit > 0 then 1 else -1 end * coalesce(jl.fx_amount, jl.debit + jl.credit) as fx,
           jl.debit - jl.credit as pkr, jl.entry_date
    from public.journal_lines jl
    where jl.company_id = p_company_id and (p_as_of is null or jl.entry_date <= p_as_of)
      and ((p_kind = 'BANK' and jl.bank_account_id is not null) or (p_kind <> 'BANK' and jl.party_type = p_kind))
  ),
  agg as (
    select hid, cur, sum(fx) fx, sum(pkr) pkr, max(entry_date) last_date from l group by hid, cur
  ),
  holders as (
    select id, code, name from public.suppliers where p_kind = 'SUPPLIER' and company_id = p_company_id
    union all select id, code, name from public.payment_agents where p_kind = 'AGENT' and company_id = p_company_id
    union all select id, code, name from public.bank_accounts where p_kind = 'BANK' and company_id = p_company_id
  )
  select h.id, h.code, h.name, a.cur,
         a.fx * case when p_kind = 'SUPPLIER' then -1 else 1 end,
         a.pkr * case when p_kind = 'SUPPLIER' then -1 else 1 end,
         case when a.cur = 'PKR' then 1 when a.fx <> 0 then round(a.pkr / a.fx, 4) end,
         a.last_date
  from agg a join holders h on h.id = a.hid
  where a.fx <> 0 or a.pkr <> 0
  order by h.name, a.cur;
$$;
grant execute on function public.currency_balances(uuid, text, date) to authenticated;

-- One party's (or bank's) ledger in one currency: foreign amount, the rate of each line, PKR, running balances
create or replace function public.currency_ledger(p_kind text, p_holder_id uuid, p_currency text, p_from date default null, p_to date default null)
returns table(row_kind text, entry_id uuid, entry_no text, entry_date date, source_type text, source_id uuid, memo text, reference text, description text,
              fx_in numeric, fx_out numeric, rate numeric, pkr_in numeric, pkr_out numeric, fx_balance numeric, pkr_balance numeric)
language sql stable security invoker set search_path = '' as $$
  with s as (select case when p_kind = 'SUPPLIER' then -1 else 1 end as sg),
  l as (
    select jl.entry_id, jl.entry_date, jl.line_no, jl.description, jl.fx_rate,
           (select sg from s) * case when jl.debit > 0 then 1 else -1 end * coalesce(jl.fx_amount, jl.debit + jl.credit) as fx,
           (select sg from s) * (jl.debit - jl.credit) as pkr
    from public.journal_lines jl
    where coalesce(jl.currency, 'PKR') = p_currency and (p_to is null or jl.entry_date <= p_to)
      and ((p_kind = 'BANK' and jl.bank_account_id = p_holder_id) or (p_kind <> 'BANK' and jl.party_type = p_kind and jl.party_id = p_holder_id))
  ),
  ob as (select coalesce(sum(fx), 0) fx, coalesce(sum(pkr), 0) pkr from l where p_from is not null and entry_date < p_from),
  t as (
    select l.*, e.entry_no, e.source_type, e.source_id, e.memo, e.reference, e.created_at from l join public.journal_entries e on e.id = l.entry_id
    where p_from is null or l.entry_date >= p_from
  )
  select 'OPENING', null::uuid, null::text, p_from, null::text, null::uuid, 'Opening balance', null::text, null::text,
         null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, (select fx from ob), (select pkr from ob)
  union all
  (select 'TXN', t.entry_id, t.entry_no, t.entry_date, t.source_type, t.source_id, t.memo, t.reference, t.description,
          case when t.fx > 0 then t.fx end, case when t.fx < 0 then -t.fx end,
          coalesce(t.fx_rate, case when p_currency = 'PKR' then 1 end),
          case when t.pkr > 0 then t.pkr end, case when t.pkr < 0 then -t.pkr end,
          (select fx from ob) + sum(t.fx) over w, (select pkr from ob) + sum(t.pkr) over w
   from t window w as (order by t.entry_date, t.created_at, t.entry_no, t.line_no rows unbounded preceding)
   order by t.entry_date, t.created_at, t.entry_no, t.line_no);
$$;
grant execute on function public.currency_ledger(text, uuid, text, date, date) to authenticated;

-- Realized FX gain / loss: every line on the FX account with where it came from
create or replace function public.fx_gain_loss_report(p_company_id uuid, p_from date default null, p_to date default null)
returns table(entry_id uuid, entry_no text, entry_date date, source_type text, source_id uuid, party_name text, memo text, description text, loss numeric, gain numeric)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.entry_no, e.entry_date, e.source_type, e.source_id, e.party_name, e.memo, jl.description, jl.debit, jl.credit
  from public.journal_lines jl
  join public.chart_of_accounts a on a.id = jl.account_id and a.system_key = 'FX_GAIN_LOSS'
  join public.journal_entries_v e on e.id = jl.entry_id
  where jl.company_id = p_company_id and (p_from is null or jl.entry_date >= p_from) and (p_to is null or jl.entry_date <= p_to)
  order by e.entry_date, e.entry_no;
$$;
grant execute on function public.fx_gain_loss_report(uuid, date, date) to authenticated;

-- Agent register: per agent, per currency: funded, settled for suppliers, charges, balance (advance / payable), unapplied settlements
create or replace function public.agent_summary(p_company_id uuid, p_from date default null, p_to date default null)
returns table(agent_id uuid, code text, name text, currency text, opening_fx numeric, funded_fx numeric, refunded_fx numeric, settled_fx numeric, charges_fx numeric,
              converted_fx numeric, balance_fx numeric, balance_pkr numeric, funded_pkr numeric, settled_pkr numeric, settlements int)
language sql stable security invoker set search_path = '' as $$
  with l as (
    select jl.party_id, jl.currency cur, e.source_type, e.source_id, jl.entry_date,
           case when jl.debit > 0 then 1 else -1 end * jl.fx_amount as fx, jl.debit - jl.credit as pkr
    from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
    where jl.company_id = p_company_id and jl.party_type = 'AGENT' and (p_to is null or jl.entry_date <= p_to)
  ),
  k as (
    select l.*, coalesce(t.kind, case l.source_type when 'FX_PAYMENT' then 'SETTLE' when 'CURRENCY_CONVERSION' then 'CONVERT' else 'OTHER' end) as kind
    from l left join public.payment_agent_transactions t on l.source_type = 'AGENT_TXN' and t.id = l.source_id
  )
  select g.id, g.code, g.name, k.cur,
    coalesce(sum(k.fx) filter (where k.kind = 'OPENING' or (p_from is not null and k.entry_date < p_from)), 0),
    coalesce(sum(k.fx) filter (where k.kind = 'FUND' and (p_from is null or k.entry_date >= p_from)), 0),
    coalesce(-sum(k.fx) filter (where k.kind = 'REFUND' and (p_from is null or k.entry_date >= p_from)), 0),
    coalesce(-sum(k.fx) filter (where k.kind = 'SETTLE' and (p_from is null or k.entry_date >= p_from)), 0),
    coalesce(-sum(k.fx) filter (where k.kind = 'CHARGE' and (p_from is null or k.entry_date >= p_from)), 0),
    coalesce(sum(k.fx) filter (where k.kind in ('CONVERT','OTHER') and (p_from is null or k.entry_date >= p_from)), 0),
    sum(k.fx), sum(k.pkr),
    coalesce(sum(k.pkr) filter (where k.kind = 'FUND' and (p_from is null or k.entry_date >= p_from)), 0),
    coalesce(-sum(k.pkr) filter (where k.kind = 'SETTLE' and (p_from is null or k.entry_date >= p_from)), 0),
    (count(distinct k.source_id) filter (where k.kind = 'SETTLE' and (p_from is null or k.entry_date >= p_from)))::int
  from k join public.payment_agents g on g.id = k.party_id
  group by g.id, g.code, g.name, k.cur
  order by g.name, k.cur;
$$;
grant execute on function public.agent_summary(uuid, date, date) to authenticated;

create or replace view public.payment_agent_transactions_v with (security_invoker = true) as
select t.*, g.name as agent_name, b.name as bank_name, a.name as expense_account_name
from public.payment_agent_transactions t
join public.payment_agents g on g.id = t.agent_id
left join public.bank_accounts b on b.id = t.bank_account_id
left join public.chart_of_accounts a on a.id = t.expense_account_id;
grant select on public.payment_agent_transactions_v to authenticated;

create or replace view public.currency_conversions_v with (security_invoker = true) as
select c.*, coalesce(s.name, g.name, fb.name || ' → ' || tb.name) as holder_name
from public.currency_conversions c
left join public.suppliers s on s.id = c.supplier_id
left join public.payment_agents g on g.id = c.agent_id
left join public.bank_accounts fb on fb.id = c.from_bank_id
left join public.bank_accounts tb on tb.id = c.to_bank_id;
grant select on public.currency_conversions_v to authenticated;

-- attachments on the new documents
create or replace function public.attachment_entity_ok(p_entity_type text) returns boolean
language sql immutable set search_path = '' as $$
  select p_entity_type in ('journal_entries','sales_invoices','quotations','sales_orders','gdns','goods_receipts','stock_adjustments',
                           'stock_transfers','stock_counts','assembly_orders','reservation_orders','price_tasks','customers','suppliers','products',
                           'purchase_orders','supplier_bills','purchase_cost_tasks','shipments','landed_costs',
                           'fx_payments','payment_agent_transactions','currency_conversions');
$$;

create or replace function public.attachment_can_view(p_company uuid, p_entity_type text, p_entity_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_entity_type in ('goods_receipts','stock_counts')
     and public.wh_job_is_assignee(case p_entity_type when 'goods_receipts' then 'RECEIPT' else 'COUNT' end, p_entity_id) then
    return true;
  end if;
  if not public.has_permission(p_company, 'attachments.view') then return false; end if;
  return case p_entity_type
    when 'journal_entries'     then public.has_permission(p_company, 'journals.view')
    when 'sales_invoices'      then public.has_permission(p_company, 'sales.view_prices')
    when 'quotations'          then public.has_permission(p_company, 'sales.view_prices')
    when 'price_tasks'         then public.has_permission(p_company, 'sales.view_prices') or exists (select 1 from public.price_tasks t where t.id = p_entity_id and t.assigned_to = auth.uid())
    when 'sales_orders'        then public.has_permission(p_company, 'sales.view')
    when 'gdns'                then public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'inventory.view')
    when 'reservation_orders'  then public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'inventory.view')
    when 'customers'           then public.can_access_customer(p_entity_id)
    when 'suppliers'           then public.has_permission(p_company, 'suppliers.view')
    when 'products'            then true
    when 'purchase_orders'     then public.has_permission(p_company, 'purchasing.view')
    when 'supplier_bills'      then public.has_permission(p_company, 'purchasing.costs')
    when 'purchase_cost_tasks' then public.has_permission(p_company, 'purchasing.costs') or exists (select 1 from public.purchase_cost_tasks t where t.id = p_entity_id and t.assigned_to = auth.uid())
    when 'shipments'           then public.has_permission(p_company, 'purchasing.view')
    when 'landed_costs'        then public.has_permission(p_company, 'purchasing.costs')
    when 'fx_payments'         then public.has_permission(p_company, 'purchasing.costs') or public.has_permission(p_company, 'journals.view')
    when 'payment_agent_transactions' then public.has_permission(p_company, 'payment_agents.view') or public.has_permission(p_company, 'journals.view')
    when 'currency_conversions' then public.has_permission(p_company, 'journals.view')
    else public.has_permission(p_company, 'inventory.view')
  end;
end $$;
