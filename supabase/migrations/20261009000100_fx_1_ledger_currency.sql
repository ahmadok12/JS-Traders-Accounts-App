-- =====================================================================
-- JS Traders ERP — Stage 9 part 1: currency on the general ledger (spec §12, §13)
-- * journal_lines carry the transaction currency, the foreign amount and the
--   actual rate of THAT transaction (never averaged). PKR stays the base:
--   debit / credit are always PKR.
-- * New party type AGENT (payment agents / money exchanges) — agent lines use
--   the AGENT_ADVANCE / AGENT_PAYABLE accounts and always carry a currency, so
--   every agent sub-account (PKR / CNY / USD …) is a ledger, not a stored balance.
-- * Posting and reversal engines copy the currency columns.
-- =====================================================================

alter table public.journal_lines
  add column if not exists currency  text references public.currencies(code),
  add column if not exists fx_amount numeric(18,2),
  add column if not exists fx_rate   numeric(18,6);
alter table public.journal_lines drop constraint if exists jl_fx_pair;
alter table public.journal_lines add constraint jl_fx_pair check ((currency is null) = (fx_amount is null) and (fx_amount is null or fx_amount >= 0));
create index if not exists jl_currency_idx on public.journal_lines(party_type, party_id, currency) where currency is not null;

-- party type AGENT on entries and lines
do $$
declare r record;
begin
  for r in select conrelid::regclass::text as t, conname from pg_constraint
           where conrelid in ('public.journal_lines'::regclass, 'public.journal_entries'::regclass)
             and contype = 'c' and pg_get_constraintdef(oid) ilike '%party_type%EMPLOYEE%' and pg_get_constraintdef(oid) not ilike '%is null%'
  loop
    execute format('alter table %s drop constraint %I', r.t, r.conname);
  end loop;
end $$;
alter table public.journal_entries add constraint journal_entries_party_type_check check (party_type in ('CUSTOMER','SUPPLIER','EMPLOYEE','AGENT'));
alter table public.journal_lines   add constraint journal_lines_party_type_check   check (party_type in ('CUSTOMER','SUPPLIER','EMPLOYEE','AGENT'));

create or replace function public.acc_party_kind(p_system_key text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_system_key in ('AR_CONTROL','CUSTOMER_ADVANCE') then 'CUSTOMER'
    when p_system_key in ('AP_CONTROL','SUPPLIER_ADVANCE') then 'SUPPLIER'
    when p_system_key in ('EMPLOYEE_ADVANCE','EMPLOYEE_PAYABLE') then 'EMPLOYEE'
    when p_system_key in ('AGENT_ADVANCE','AGENT_PAYABLE') then 'AGENT'
  end;
$$;

-- Validate + normalise draft lines:
-- [{account_id, debit, credit, party_type, party_id, bank_account_id, description, currency, fx_amount, fx_rate}]
create or replace function public.acc_normalize_lines(p_company_id uuid, p_lines jsonb, p_strict boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l jsonb; n int := 0; a record; v_dr numeric; v_cr numeric; v_pt text; v_pid uuid; v_bank uuid; v_need text;
  v_out jsonb := '[]'::jsonb; v_tdr numeric := 0; v_tcr numeric := 0; v_ok boolean;
  v_cur text; v_fx numeric; v_rate numeric; v_bank_cur text;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    n := n + 1;
    v_dr := round(coalesce(nullif(l->>'debit','')::numeric, 0), 2);
    v_cr := round(coalesce(nullif(l->>'credit','')::numeric, 0), 2);
    if v_dr < 0 or v_cr < 0 then raise exception 'Line %: amounts cannot be negative', n using errcode = '23514'; end if;
    if v_dr = 0 and v_cr = 0 then continue; end if;      -- empty line: ignored
    if v_dr > 0 and v_cr > 0 then raise exception 'Line %: enter either a debit or a credit, not both', n using errcode = '23514'; end if;
    select id, company_id, code, name, is_group, is_active, system_key into a
      from public.chart_of_accounts where id = nullif(l->>'account_id','')::uuid;
    if a.id is null or a.company_id <> p_company_id then raise exception 'Line %: choose an account', n using errcode = '23502'; end if;
    if a.is_group then raise exception 'Line %: "% %" is a group heading — choose an account under it', n, a.code, a.name using errcode = '22023'; end if;
    if not a.is_active then raise exception 'Line %: account % is inactive', n, a.code using errcode = '22023'; end if;

    v_pt := nullif(l->>'party_type',''); v_pid := nullif(l->>'party_id','')::uuid;
    v_need := public.acc_party_kind(a.system_key);
    if v_need is not null then
      if v_pid is null and p_strict then
        raise exception 'Line %: account % needs a % — choose one', n, a.name, case v_need when 'AGENT' then 'payment agent' else lower(v_need) end using errcode = '23502';
      end if;
      if v_pid is not null and coalesce(v_pt, v_need) <> v_need then
        raise exception 'Line %: account % is for a %, not a %', n, a.name, lower(v_need), lower(v_pt) using errcode = '22023';
      end if;
      v_pt := case when v_pid is null then null else v_need end;
    elsif v_pid is not null then
      raise exception 'Line %: a customer / supplier / agent can only be used with a receivable, payable or advance account', n using errcode = '22023';
    else
      v_pt := null;
    end if;
    if v_pid is not null then
      v_ok := case v_pt
        when 'CUSTOMER' then exists (select 1 from public.customers where id = v_pid and company_id = p_company_id)
        when 'SUPPLIER' then exists (select 1 from public.suppliers where id = v_pid and company_id = p_company_id)
        when 'EMPLOYEE' then exists (select 1 from public.employees where id = v_pid and company_id = p_company_id)
        when 'AGENT'    then exists (select 1 from public.payment_agents where id = v_pid and company_id = p_company_id)
      end;
      if not v_ok then raise exception 'Line %: % not found', n, lower(v_pt) using errcode = 'P0002'; end if;
    end if;

    -- bank / cash lines carry the bank account (bank book)
    v_bank := nullif(l->>'bank_account_id','')::uuid;
    if v_bank is not null then
      if not exists (select 1 from public.bank_accounts where id = v_bank and company_id = p_company_id and gl_account_id = a.id) then
        raise exception 'Line %: bank account does not match account %', n, a.code using errcode = '22023';
      end if;
    else
      select id into v_bank from public.bank_accounts where company_id = p_company_id and gl_account_id = a.id order by created_at limit 1;
    end if;

    -- transaction currency: foreign amount + the actual rate of this transaction
    v_cur := nullif(upper(trim(l->>'currency')), '');
    v_fx := round(nullif(l->>'fx_amount','')::numeric, 2);
    v_rate := nullif(l->>'fx_rate','')::numeric;
    if v_cur is null and v_bank is not null then
      select currency into v_bank_cur from public.bank_accounts where id = v_bank;
      if v_bank_cur <> 'PKR' then
        raise exception 'Line %: this bank account is in % — give the % amount and rate', n, v_bank_cur, v_bank_cur using errcode = '23502';
      end if;
    end if;
    if v_cur is null and v_pt = 'AGENT' then v_cur := 'PKR'; end if;              -- agent sub-ledgers always carry a currency
    if v_cur = 'PKR' then v_fx := v_dr + v_cr; v_rate := 1; end if;
    if v_cur is not null then
      if not exists (select 1 from public.currencies where code = v_cur) then raise exception 'Line %: unknown currency %', n, v_cur using errcode = '22023'; end if;
      if v_fx is null or v_fx < 0 then raise exception 'Line %: enter the % amount', n, v_cur using errcode = '23502'; end if;
      if v_rate is null and v_fx > 0 then v_rate := round((v_dr + v_cr) / v_fx, 6); end if;
    else
      v_fx := null; v_rate := null;
    end if;

    v_tdr := v_tdr + v_dr; v_tcr := v_tcr + v_cr;
    v_out := v_out || jsonb_build_array(jsonb_build_object('account_id', a.id, 'debit', v_dr, 'credit', v_cr,
      'party_type', v_pt, 'party_id', v_pid, 'bank_account_id', v_bank, 'description', nullif(trim(l->>'description'), ''),
      'currency', v_cur, 'fx_amount', v_fx, 'fx_rate', v_rate));
  end loop;
  if p_strict then
    if jsonb_array_length(v_out) < 2 then raise exception 'An entry needs at least two lines' using errcode = '23502'; end if;
    if v_tdr <> v_tcr then
      raise exception 'Debits (%) and credits (%) must be equal — difference %', v_tdr, v_tcr, (v_tdr - v_tcr) using errcode = '23514';
    end if;
  end if;
  return v_out;
end $$;
revoke execute on function public.acc_normalize_lines(uuid, jsonb, boolean) from public, anon, authenticated;

-- one insert for every engine
create or replace function public.acc_insert_lines(p_company_id uuid, p_entry_id uuid, p_date date, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare l jsonb; n int := 0;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into public.journal_lines(company_id, entry_id, line_no, entry_date, account_id, debit, credit,
      party_type, party_id, bank_account_id, description, currency, fx_amount, fx_rate)
    values (p_company_id, p_entry_id, n, p_date, (l->>'account_id')::uuid, (l->>'debit')::numeric, (l->>'credit')::numeric,
      nullif(l->>'party_type',''), nullif(l->>'party_id','')::uuid, nullif(l->>'bank_account_id','')::uuid, l->>'description',
      nullif(l->>'currency',''), nullif(l->>'fx_amount','')::numeric, nullif(l->>'fx_rate','')::numeric);
  end loop;
end $$;
revoke execute on function public.acc_insert_lines(uuid, uuid, date, jsonb) from public, anon, authenticated;

create or replace function public.post_journal_entry(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; v_lines jsonb; v_dr numeric := 0; v_cr numeric := 0;
begin
  select * into h from public.journal_entries where id = p_id for update;
  if h.id is null then raise exception 'Entry not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'journals.post');
  if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % entry', h.status using errcode = '22023'; end if;
  perform public.acc_check_period(h.company_id, h.entry_date);
  v_lines := public.acc_normalize_lines(h.company_id, h.lines_draft, true);
  perform public.acc_insert_lines(h.company_id, h.id, h.entry_date, v_lines);
  select sum((x->>'debit')::numeric), sum((x->>'credit')::numeric) into v_dr, v_cr from jsonb_array_elements(v_lines) x;
  update public.journal_entries set status = 'POSTED', posted_at = now(), posted_by = auth.uid(),
    lines_draft = v_lines, total_debit = v_dr, total_credit = v_cr where id = p_id;
  return jsonb_build_object('status','POSTED','lines', jsonb_array_length(v_lines));
end $$;
revoke execute on function public.post_journal_entry(uuid) from public, anon;
grant execute on function public.post_journal_entry(uuid) to authenticated;

create or replace function public.acc_post_document_entry(p_company_id uuid, p_type text, p_date date, p_memo text, p_reference text, p_party_type text, p_party_id uuid, p_bank uuid, p_amount numeric, p_lines jsonb, p_source_type text, p_source_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_lines jsonb; v_id uuid; v_dr numeric := 0; v_cr numeric := 0;
begin
  perform public.acc_check_period(p_company_id, p_date);
  v_lines := public.acc_normalize_lines(p_company_id, p_lines, true);
  select sum((x->>'debit')::numeric), sum((x->>'credit')::numeric) into v_dr, v_cr from jsonb_array_elements(v_lines) x;
  insert into public.journal_entries(company_id, entry_no, entry_date, entry_type, status, memo, reference, party_type, party_id,
    bank_account_id, amount, lines_draft, total_debit, total_credit, source_type, source_id, posted_at, posted_by)
  values (p_company_id, public.next_document_number(p_company_id, 'JE_' || p_type), p_date, p_type, 'POSTED', p_memo, p_reference,
    p_party_type, p_party_id, p_bank, p_amount, v_lines, v_dr, v_cr, p_source_type, p_source_id, now(), auth.uid())
  returning id into v_id;
  perform public.acc_insert_lines(p_company_id, v_id, p_date, v_lines);
  return v_id;
end $$;
revoke execute on function public.acc_post_document_entry(uuid, text, date, text, text, text, uuid, uuid, numeric, jsonb, text, uuid) from public, anon, authenticated;

-- swapped copy of the posted lines (currency columns kept)
create or replace function public.acc_copy_reversed_lines(p_from uuid, p_to uuid, p_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare l record; n int := 0;
begin
  for l in select * from public.journal_lines where entry_id = p_from order by line_no loop
    n := n + 1;
    insert into public.journal_lines(company_id, entry_id, line_no, entry_date, account_id, debit, credit, party_type, party_id, bank_account_id, description, currency, fx_amount, fx_rate)
    values (l.company_id, p_to, n, p_date, l.account_id, l.credit, l.debit, l.party_type, l.party_id, l.bank_account_id,
      coalesce('Reversal: ' || l.description, 'Reversal'), l.currency, l.fx_amount, l.fx_rate);
  end loop;
end $$;
revoke execute on function public.acc_copy_reversed_lines(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.reverse_journal_entry(p_id uuid, p_reason text, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_new uuid; v_date date;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to reverse an entry' using errcode = '23502'; end if;
  select * into h from public.journal_entries where id = p_id for update;
  if h.id is null then raise exception 'Entry not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'journals.post');
  if h.status = 'REVERSED' then return h.reversed_by_entry; end if;
  if h.status <> 'POSTED' then raise exception 'Only posted entries can be reversed' using errcode = '22023'; end if;
  if h.source_type is not null then
    raise exception 'This entry was created by a % — reverse that document instead', lower(replace(h.source_type, '_', ' ')) using errcode = '22023';
  end if;
  v_date := coalesce(p_date, h.entry_date);
  perform public.acc_check_period(h.company_id, v_date);
  insert into public.journal_entries(company_id, entry_no, entry_date, entry_type, status, memo, reference, party_type, party_id,
    bank_account_id, amount, total_debit, total_credit, reversal_of, posted_at, posted_by)
  values (h.company_id, public.next_document_number(h.company_id, 'JE_' || h.entry_type), v_date, h.entry_type, 'POSTED',
    'Reversal of ' || h.entry_no || ': ' || p_reason, h.reference, h.party_type, h.party_id, h.bank_account_id, h.amount,
    h.total_credit, h.total_debit, h.id, now(), auth.uid())
  returning id into v_new;
  perform public.acc_copy_reversed_lines(h.id, v_new, v_date);
  update public.journal_entries set lines_draft = h.lines_draft where id = v_new;
  update public.journal_entries set status = 'REVERSED', reversed_by_entry = v_new, reversal_reason = p_reason,
    reversed_at = now(), reversed_by = auth.uid() where id = h.id;
  return v_new;
end $$;
revoke execute on function public.reverse_journal_entry(uuid, text, date) from public, anon;
grant execute on function public.reverse_journal_entry(uuid, text, date) to authenticated;

create or replace function public.acc_reverse_document_entry(p_entry_id uuid, p_reason text, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_new uuid;
begin
  select * into h from public.journal_entries where id = p_entry_id for update;
  if h.status <> 'POSTED' then raise exception 'Accounting entry % is not posted', h.entry_no using errcode = '22023'; end if;
  perform public.acc_check_period(h.company_id, p_date);
  insert into public.journal_entries(company_id, entry_no, entry_date, entry_type, status, memo, reference, party_type, party_id,
    bank_account_id, amount, lines_draft, total_debit, total_credit, source_type, source_id, reversal_of, posted_at, posted_by)
  values (h.company_id, public.next_document_number(h.company_id, 'JE_' || h.entry_type), p_date, h.entry_type, 'POSTED',
    'Reversal of ' || h.entry_no || ': ' || p_reason, h.reference, h.party_type, h.party_id, h.bank_account_id, h.amount, h.lines_draft,
    h.total_credit, h.total_debit, h.source_type, h.source_id, h.id, now(), auth.uid())
  returning id into v_new;
  perform public.acc_copy_reversed_lines(h.id, v_new, p_date);
  update public.journal_entries set status = 'REVERSED', reversed_by_entry = v_new, reversal_reason = p_reason, reversed_at = now(), reversed_by = auth.uid()
   where id = h.id;
  return v_new;
end $$;
revoke execute on function public.acc_reverse_document_entry(uuid, text, date) from public, anon, authenticated;

-- journal_entries_v: agent names
create or replace view public.journal_entries_v with (security_invoker = true) as
select e.id, e.company_id, e.entry_no, e.entry_date, e.entry_type, e.status, e.memo, e.reference,
       e.party_type, e.party_id, e.bank_account_id, e.amount, e.total_debit, e.total_credit,
       e.reversal_of, e.reversed_by_entry, e.reversal_reason, e.source_type, e.source_id, e.posted_at, e.created_at,
       coalesce(c.name, s.name, em.full_name, ag.name) as party_name,
       b.name as bank_name
from public.journal_entries e
left join public.customers c on e.party_type = 'CUSTOMER' and c.id = e.party_id
left join public.suppliers s on e.party_type = 'SUPPLIER' and s.id = e.party_id
left join public.employees em on e.party_type = 'EMPLOYEE' and em.id = e.party_id
left join public.payment_agents ag on e.party_type = 'AGENT' and ag.id = e.party_id
left join public.bank_accounts b on b.id = e.bank_account_id;
grant select on public.journal_entries_v to authenticated;
