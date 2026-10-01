-- =====================================================================
-- JS Traders ERP — Stage 4: accounting engine (spec §11, §24, Stage 4)
-- * journal_entries (vouchers) + journal_lines (the general ledger, append-only)
-- * Debit = credit enforced at posting; posting is one transaction; posted
--   entries are never edited — corrections are reversal entries.
-- * Party sub-ledgers: receivable / payable / advance lines carry the customer,
--   supplier or employee → statements and balances are derived, never stored.
-- * Bank / cash lines carry the bank account → cash & bank books.
-- * Accounting periods: a CLOSED period blocks posting on its dates.
-- * Vouchers: RECEIPT, PAYMENT, TRANSFER (contra), JOURNAL, OPENING; SYSTEM is
--   reserved for invoices / bills / payroll in later stages.
-- =====================================================================
-- ---------------------------------------------------------------- permissions + numbering
insert into public.permissions(code, module, description, is_sensitive) values
  ('journals.view','accounting','View vouchers, journals, ledgers and statements',true),
  ('journals.create','accounting','Prepare receipts, payments, transfers and journals',true),
  ('journals.post','accounting','Post and reverse accounting entries',true),
  ('periods.manage','accounting','Open and close accounting periods',true)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values
  ('ADMINISTRATOR','journals.view'),('ADMINISTRATOR','journals.create'),('ADMINISTRATOR','journals.post'),('ADMINISTRATOR','periods.manage'),
  ('ACCOUNTANT','journals.view'),('ACCOUNTANT','journals.create'),('ACCOUNTANT','journals.post'),('ACCOUNTANT','periods.manage'),
  ('OWNER','journals.view')
) as x(role_code, p) on x.role_code = r.code
on conflict do nothing;

insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, x.t, x.p, 5, true from public.companies c
cross join (values ('JE_RECEIPT','RV-'),('JE_PAYMENT','PV-'),('JE_TRANSFER','CV-'),('JE_JOURNAL','JV-'),('JE_OPENING','OB-'),('JE_SYSTEM','SJ-')) as x(t, p)
on conflict do nothing;

-- ---------------------------------------------------------------- periods
create table public.accounting_periods (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  closed_at   timestamptz, closed_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (end_date >= start_date),
  unique (company_id, start_date)
);
create trigger stamp before insert or update on public.accounting_periods for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.accounting_periods for each row execute function public.tg_audit_row();
alter table public.accounting_periods enable row level security;
revoke insert, update, delete on public.accounting_periods from authenticated, anon;
create policy ap_select on public.accounting_periods for select to authenticated
  using (public.has_permission(company_id, 'journals.view') or public.has_permission(company_id, 'periods.manage'));

-- ---------------------------------------------------------------- journal entries
create table public.journal_entries (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  entry_no         text not null,
  entry_date       date not null default current_date,
  entry_type       text not null check (entry_type in ('RECEIPT','PAYMENT','TRANSFER','JOURNAL','OPENING','SYSTEM')),
  status           text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  memo             text,
  reference        text,
  -- voucher header (receipts / payments): who and which bank — for lists and statements
  party_type       text check (party_type in ('CUSTOMER','SUPPLIER','EMPLOYEE')),
  party_id         uuid,
  bank_account_id  uuid references public.bank_accounts(id),
  amount           numeric(18,2),
  lines_draft      jsonb not null default '[]'::jsonb,
  total_debit      numeric(18,2) not null default 0,
  total_credit     numeric(18,2) not null default 0,
  source_type      text,            -- later: SALES_INVOICE, PURCHASE_BILL, PAYROLL …
  source_id        uuid,
  reversal_of      uuid references public.journal_entries(id),
  reversed_by_entry uuid references public.journal_entries(id),
  reversal_reason  text,
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid,
  idempotency_key  uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, entry_no)
);
create index je_list_idx on public.journal_entries(company_id, entry_date desc, created_at desc);
create index je_party_idx on public.journal_entries(party_type, party_id);
create index je_source_idx on public.journal_entries(source_type, source_id);
create trigger stamp before insert or update on public.journal_entries for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.journal_entries for each row execute function public.tg_audit_row();
alter table public.journal_entries enable row level security;
revoke insert, update, delete on public.journal_entries from authenticated, anon;
create policy je_select on public.journal_entries for select to authenticated
  using (public.has_permission(company_id, 'journals.view'));

-- Posted lines = the general ledger. Append-only; written only by the posting engine.
create table public.journal_lines (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  entry_id         uuid not null references public.journal_entries(id),
  line_no          int not null,
  entry_date       date not null,
  account_id       uuid not null references public.chart_of_accounts(id),
  debit            numeric(18,2) not null default 0 check (debit >= 0),
  credit           numeric(18,2) not null default 0 check (credit >= 0),
  party_type       text check (party_type in ('CUSTOMER','SUPPLIER','EMPLOYEE')),
  party_id         uuid,
  bank_account_id  uuid references public.bank_accounts(id),
  description      text,
  created_at       timestamptz not null default now(),
  check ((debit > 0) <> (credit > 0)),
  check ((party_type is null) = (party_id is null)),
  unique (entry_id, line_no)
);
create index jl_account_idx on public.journal_lines(account_id, entry_date);
create index jl_party_idx on public.journal_lines(party_type, party_id, entry_date) where party_id is not null;
create index jl_bank_idx on public.journal_lines(bank_account_id, entry_date) where bank_account_id is not null;
create index jl_entry_idx on public.journal_lines(entry_id);
create trigger immutable before update or delete on public.journal_lines for each row execute function public.tg_immutable();
alter table public.journal_lines enable row level security;
revoke insert, update, delete on public.journal_lines from authenticated, anon;
create policy jl_select on public.journal_lines for select to authenticated
  using (public.has_permission(company_id, 'journals.view'));

-- New bank / cash accounts get their own posting account under 1100 Cash & Bank automatically
create or replace function public.tg_bank_account_gl()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent uuid; v_code int; v_id uuid;
begin
  if new.gl_account_id is not null then return new; end if;
  select id into v_parent from public.chart_of_accounts where company_id = new.company_id and code = '1100';
  if v_parent is null then return new; end if;
  select coalesce(max(code::int), 1100) + 1 into v_code from public.chart_of_accounts
   where company_id = new.company_id and code ~ '^11[0-9]{2}$' and code <> '1100';
  insert into public.chart_of_accounts(company_id, code, name, account_type, is_group, parent_id, currency)
  values (new.company_id, v_code::text, new.name, 'ASSET', false, v_parent, new.currency)
  returning id into v_id;
  new.gl_account_id := v_id;
  return new;
end $$;
revoke execute on function public.tg_bank_account_gl() from public, anon, authenticated;
create trigger auto_gl before insert or update of gl_account_id on public.bank_accounts
  for each row execute function public.tg_bank_account_gl();

-- ---------------------------------------------------------------- engine
-- A closed period blocks posting on its dates. Dates without a period are open (onboarding friendly).
create or replace function public.acc_check_period(p_company_id uuid, p_date date)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_name text;
begin
  select name into v_name from public.accounting_periods
   where company_id = p_company_id and p_date between start_date and end_date and status = 'CLOSED' limit 1;
  if v_name is not null then
    raise exception 'Accounting period % is closed — choose a date in an open period', v_name using errcode = '22023';
  end if;
end $$;
revoke execute on function public.acc_check_period(uuid, date) from public, anon, authenticated;

-- Which party a posting account requires (party sub-ledgers)
create or replace function public.acc_party_kind(p_system_key text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_system_key in ('AR_CONTROL','CUSTOMER_ADVANCE') then 'CUSTOMER'
    when p_system_key in ('AP_CONTROL','SUPPLIER_ADVANCE') then 'SUPPLIER'
    when p_system_key in ('EMPLOYEE_ADVANCE','EMPLOYEE_PAYABLE') then 'EMPLOYEE'
  end;
$$;

-- Validate + normalise draft lines: [{account_id, debit, credit, party_type, party_id, bank_account_id, description}]
create or replace function public.acc_normalize_lines(p_company_id uuid, p_lines jsonb, p_strict boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l jsonb; n int := 0; a record; v_dr numeric; v_cr numeric; v_pt text; v_pid uuid; v_bank uuid; v_need text;
  v_out jsonb := '[]'::jsonb; v_tdr numeric := 0; v_tcr numeric := 0; v_ok boolean;
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
        raise exception 'Line %: account % needs a % — choose one', n, a.name, lower(v_need) using errcode = '23502';
      end if;
      if v_pid is not null and coalesce(v_pt, v_need) <> v_need then
        raise exception 'Line %: account % is for a %, not a %', n, a.name, lower(v_need), lower(v_pt) using errcode = '22023';
      end if;
      v_pt := case when v_pid is null then null else v_need end;
    elsif v_pid is not null then
      raise exception 'Line %: a customer / supplier can only be used with a receivable, payable or advance account', n using errcode = '22023';
    else
      v_pt := null;
    end if;
    if v_pid is not null then
      v_ok := case v_pt
        when 'CUSTOMER' then exists (select 1 from public.customers where id = v_pid and company_id = p_company_id)
        when 'SUPPLIER' then exists (select 1 from public.suppliers where id = v_pid and company_id = p_company_id)
        when 'EMPLOYEE' then exists (select 1 from public.employees where id = v_pid and company_id = p_company_id)
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

    v_tdr := v_tdr + v_dr; v_tcr := v_tcr + v_cr;
    v_out := v_out || jsonb_build_array(jsonb_build_object('account_id', a.id, 'debit', v_dr, 'credit', v_cr,
      'party_type', v_pt, 'party_id', v_pid, 'bank_account_id', v_bank, 'description', nullif(trim(l->>'description'), '')));
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

create or replace function public.save_journal_entry(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_type text := coalesce(nullif(p_header->>'entry_type',''), 'JOURNAL');
  v_date date := coalesce(nullif(p_header->>'entry_date','')::date, current_date);
  v_lines jsonb; v_id uuid; v_status text; v_dr numeric; v_cr numeric;
begin
  perform public.inv_require(v_company, 'journals.create');
  if v_type not in ('RECEIPT','PAYMENT','TRANSFER','JOURNAL','OPENING') then
    raise exception 'Unknown entry type %', v_type using errcode = '22023';
  end if;
  v_lines := public.acc_normalize_lines(v_company, p_lines, false);
  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0) into v_dr, v_cr from jsonb_array_elements(v_lines) x;
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.journal_entries where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.journal_entries(company_id, entry_no, entry_date, entry_type, memo, reference, party_type, party_id,
      bank_account_id, amount, lines_draft, total_debit, total_credit, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'JE_' || v_type), v_date, v_type,
      nullif(trim(p_header->>'memo'),''), nullif(trim(p_header->>'reference'),''), nullif(p_header->>'party_type',''),
      nullif(p_header->>'party_id','')::uuid, nullif(p_header->>'bank_account_id','')::uuid, nullif(p_header->>'amount','')::numeric,
      v_lines, v_dr, v_cr, p_idempotency_key)
    returning id into v_id;
  else
    select status into v_status from public.journal_entries where id = p_id and company_id = v_company for update;
    if v_status is null then raise exception 'Entry not found' using errcode = 'P0002'; end if;
    if v_status <> 'DRAFT' then raise exception 'Only drafts can be edited (this entry is %). Posted entries are corrected by reversal.', v_status using errcode = '22023'; end if;
    update public.journal_entries set entry_date = v_date, memo = nullif(trim(p_header->>'memo'),''), reference = nullif(trim(p_header->>'reference'),''),
      party_type = nullif(p_header->>'party_type',''), party_id = nullif(p_header->>'party_id','')::uuid,
      bank_account_id = nullif(p_header->>'bank_account_id','')::uuid, amount = nullif(p_header->>'amount','')::numeric,
      lines_draft = v_lines, total_debit = v_dr, total_credit = v_cr
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.save_journal_entry(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_journal_entry(uuid, jsonb, jsonb, uuid) to authenticated;

-- Post: validate, write the ledger lines, lock the entry — one transaction
create or replace function public.post_journal_entry(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; v_lines jsonb; l jsonb; n int := 0; v_dr numeric := 0; v_cr numeric := 0;
begin
  select * into h from public.journal_entries where id = p_id for update;
  if h.id is null then raise exception 'Entry not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'journals.post');
  if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % entry', h.status using errcode = '22023'; end if;
  perform public.acc_check_period(h.company_id, h.entry_date);
  v_lines := public.acc_normalize_lines(h.company_id, h.lines_draft, true);
  for l in select * from jsonb_array_elements(v_lines) loop
    n := n + 1;
    insert into public.journal_lines(company_id, entry_id, line_no, entry_date, account_id, debit, credit,
      party_type, party_id, bank_account_id, description)
    values (h.company_id, h.id, n, h.entry_date, (l->>'account_id')::uuid, (l->>'debit')::numeric, (l->>'credit')::numeric,
      nullif(l->>'party_type',''), nullif(l->>'party_id','')::uuid, nullif(l->>'bank_account_id','')::uuid, l->>'description');
    v_dr := v_dr + (l->>'debit')::numeric; v_cr := v_cr + (l->>'credit')::numeric;
  end loop;
  update public.journal_entries set status = 'POSTED', posted_at = now(), posted_by = auth.uid(),
    lines_draft = v_lines, total_debit = v_dr, total_credit = v_cr where id = p_id;
  return jsonb_build_object('status','POSTED','lines', n);
end $$;
revoke execute on function public.post_journal_entry(uuid) from public, anon;
grant execute on function public.post_journal_entry(uuid) to authenticated;

create or replace function public.cancel_journal_entry(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.journal_entries where id = p_id for update;
  if h.id is null then raise exception 'Entry not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'journals.create');
  if h.status <> 'DRAFT' then raise exception 'Only drafts can be cancelled. Posted entries must be reversed.' using errcode = '22023'; end if;
  update public.journal_entries set status = 'CANCELLED' where id = p_id;
end $$;
revoke execute on function public.cancel_journal_entry(uuid) from public, anon;
grant execute on function public.cancel_journal_entry(uuid) to authenticated;

-- Reverse: a new posted entry with debits and credits swapped; the original stays in history
create or replace function public.reverse_journal_entry(p_id uuid, p_reason text, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_new uuid; v_date date; n int := 0; l record;
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
  for l in select * from public.journal_lines where entry_id = h.id order by line_no loop
    n := n + 1;
    insert into public.journal_lines(company_id, entry_id, line_no, entry_date, account_id, debit, credit, party_type, party_id, bank_account_id, description)
    values (h.company_id, v_new, n, v_date, l.account_id, l.credit, l.debit, l.party_type, l.party_id, l.bank_account_id,
      coalesce('Reversal: ' || l.description, 'Reversal'));
  end loop;
  update public.journal_entries set lines_draft = h.lines_draft where id = v_new;
  update public.journal_entries set status = 'REVERSED', reversed_by_entry = v_new, reversal_reason = p_reason,
    reversed_at = now(), reversed_by = auth.uid() where id = h.id;
  return v_new;
end $$;
revoke execute on function public.reverse_journal_entry(uuid, text, date) from public, anon;
grant execute on function public.reverse_journal_entry(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------- periods
create or replace function public.create_accounting_periods(p_company_id uuid, p_year int)
returns int language plpgsql security definer set search_path = '' as $$
declare m int; n int := 0; d date;
begin
  perform public.inv_require(p_company_id, 'periods.manage');
  for m in 1..12 loop
    d := make_date(p_year, m, 1);
    insert into public.accounting_periods(company_id, name, start_date, end_date)
    values (p_company_id, to_char(d, 'Mon YYYY'), d, (d + interval '1 month - 1 day')::date)
    on conflict (company_id, start_date) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.create_accounting_periods(uuid, int) from public, anon;
grant execute on function public.create_accounting_periods(uuid, int) to authenticated;

create or replace function public.set_period_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  select * into p from public.accounting_periods where id = p_id for update;
  if p.id is null then raise exception 'Period not found' using errcode = 'P0002'; end if;
  perform public.inv_require(p.company_id, 'periods.manage');
  if p_status not in ('OPEN','CLOSED') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if p_status = 'CLOSED' and exists (select 1 from public.journal_entries where company_id = p.company_id
       and status = 'DRAFT' and entry_date between p.start_date and p.end_date) then
    raise exception 'Post or cancel the draft entries dated in % before closing it', p.name using errcode = '22023';
  end if;
  update public.accounting_periods set status = p_status,
    closed_at = case when p_status = 'CLOSED' then now() end, closed_by = case when p_status = 'CLOSED' then auth.uid() end
  where id = p_id;
end $$;
revoke execute on function public.set_period_status(uuid, text) from public, anon;
grant execute on function public.set_period_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------- read models (caller's permissions apply)
-- Entries with the party / bank name, for lists
create or replace view public.journal_entries_v with (security_invoker = true) as
select e.id, e.company_id, e.entry_no, e.entry_date, e.entry_type, e.status, e.memo, e.reference,
       e.party_type, e.party_id, e.bank_account_id, e.amount, e.total_debit, e.total_credit,
       e.reversal_of, e.reversed_by_entry, e.reversal_reason, e.source_type, e.source_id, e.posted_at, e.created_at,
       coalesce(c.name, s.name, em.full_name) as party_name,
       b.name as bank_name
from public.journal_entries e
left join public.customers c on e.party_type = 'CUSTOMER' and c.id = e.party_id
left join public.suppliers s on e.party_type = 'SUPPLIER' and s.id = e.party_id
left join public.employees em on e.party_type = 'EMPLOYEE' and em.id = e.party_id
left join public.bank_accounts b on b.id = e.bank_account_id;
grant select on public.journal_entries_v to authenticated;

-- Customer / supplier statement. Balance orientation: customer = they owe us (+), supplier = we owe them (+).
-- p_include_linked: also include the linked supplier (or customer) account of the same party → net position.
create or replace function public.party_statement(p_party_type text, p_party_id uuid, p_from date default null,
  p_to date default null, p_include_linked boolean default false)
returns table (row_kind text, entry_id uuid, entry_no text, entry_date date, entry_type text, memo text, reference text,
               via text, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = '' as $$
  with parties as (
    select p_party_type as pt, p_party_id as pid
    union all
    select 'SUPPLIER', c.linked_supplier_id from public.customers c
     where p_include_linked and p_party_type = 'CUSTOMER' and c.id = p_party_id and c.linked_supplier_id is not null
    union all
    select 'CUSTOMER', s.linked_customer_id from public.suppliers s
     where p_include_linked and p_party_type = 'SUPPLIER' and s.id = p_party_id and s.linked_customer_id is not null
  ),
  sgn as (select case when p_party_type = 'SUPPLIER' then -1 else 1 end as s),
  per_entry as (
    select jl.entry_id, jl.entry_date, jl.party_type, sum(jl.debit) as d, sum(jl.credit) as c
    from public.journal_lines jl join parties p on p.pt = jl.party_type and p.pid = jl.party_id
    where p_to is null or jl.entry_date <= p_to
    group by jl.entry_id, jl.entry_date, jl.party_type
  ),
  opening as (
    select coalesce(sum((d - c) * (select s from sgn)), 0) as ob from per_entry where p_from is not null and entry_date < p_from
  ),
  txn as (
    select pe.*, e.entry_no, e.entry_type, e.memo, e.reference, e.created_at
    from per_entry pe join public.journal_entries e on e.id = pe.entry_id
    where p_from is null or pe.entry_date >= p_from
  )
  select 'OPENING', null::uuid, null::text, p_from, null::text, 'Opening balance', null::text, null::text,
         null::numeric, null::numeric, (select ob from opening)
  union all
  (select 'TXN', t.entry_id, t.entry_no, t.entry_date, t.entry_type, t.memo, t.reference,
          case when t.party_type <> p_party_type then t.party_type end,
          t.d, t.c,
          (select ob from opening) + sum((t.d - t.c) * (select s from sgn)) over (order by t.entry_date, t.created_at, t.entry_no rows unbounded preceding)
   from txn t order by t.entry_date, t.created_at, t.entry_no);
$$;
grant execute on function public.party_statement(text, uuid, date, date, boolean) to authenticated;

-- Balances of all customers or suppliers (receivables / payables). Linked party's balance shown alongside.
create or replace function public.party_balances(p_company_id uuid, p_party_type text, p_as_of date default null)
returns table (party_id uuid, code text, name text, city text, balance numeric, last_date date,
               linked_party_id uuid, linked_balance numeric)
language sql stable security invoker set search_path = '' as $$
  with bal as (
    select jl.party_type, jl.party_id, sum(jl.debit - jl.credit) as dc, max(jl.entry_date) as last_date
    from public.journal_lines jl
    where jl.company_id = p_company_id and jl.party_id is not null and (p_as_of is null or jl.entry_date <= p_as_of)
    group by jl.party_type, jl.party_id
  ),
  me as (
    select c.id, c.code, c.name, c.city, c.linked_supplier_id as linked from public.customers c
     where p_party_type = 'CUSTOMER' and c.company_id = p_company_id
    union all
    select s.id, s.code, s.name, s.city, s.linked_customer_id from public.suppliers s
     where p_party_type = 'SUPPLIER' and s.company_id = p_company_id
  )
  select me.id, me.code, me.name, me.city,
         coalesce(b.dc, 0) * case when p_party_type = 'SUPPLIER' then -1 else 1 end,
         b.last_date,
         me.linked,
         case when me.linked is null then null
              else coalesce(lb.dc, 0) * case when p_party_type = 'SUPPLIER' then -1 else 1 end end
  from me
  join bal b on b.party_type = p_party_type and b.party_id = me.id
  left join bal lb on lb.party_id = me.linked and lb.party_type <> p_party_type;
$$;
grant execute on function public.party_balances(uuid, text, date) to authenticated;

-- Cash / bank book with running balance
create or replace function public.bank_book(p_bank_account_id uuid, p_from date default null, p_to date default null)
returns table (row_kind text, entry_id uuid, entry_no text, entry_date date, entry_type text, memo text, reference text,
               party_name text, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = '' as $$
  with per_entry as (
    select jl.entry_id, jl.entry_date, sum(jl.debit) as d, sum(jl.credit) as c
    from public.journal_lines jl
    where jl.bank_account_id = p_bank_account_id and (p_to is null or jl.entry_date <= p_to)
    group by jl.entry_id, jl.entry_date
  ),
  opening as (select coalesce(sum(d - c), 0) as ob from per_entry where p_from is not null and entry_date < p_from),
  txn as (
    select pe.*, e.entry_no, e.entry_type, e.memo, e.reference, e.created_at, e.party_name
    from per_entry pe join public.journal_entries_v e on e.id = pe.entry_id
    where p_from is null or pe.entry_date >= p_from
  )
  select 'OPENING', null::uuid, null::text, p_from, null::text, 'Opening balance', null::text, null::text,
         null::numeric, null::numeric, (select ob from opening)
  union all
  (select 'TXN', t.entry_id, t.entry_no, t.entry_date, t.entry_type, t.memo, t.reference, t.party_name, t.d, t.c,
          (select ob from opening) + sum(t.d - t.c) over (order by t.entry_date, t.created_at, t.entry_no rows unbounded preceding)
   from txn t order by t.entry_date, t.created_at, t.entry_no);
$$;
grant execute on function public.bank_book(uuid, date, date) to authenticated;

-- Trial balance as of a date (posting accounts with activity)
create or replace function public.trial_balance(p_company_id uuid, p_as_of date default null)
returns table (account_id uuid, code text, name text, account_type text, parent_code text, debit numeric, credit numeric)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.code, a.name, a.account_type, p.code,
         greatest(sum(jl.debit - jl.credit), 0), greatest(sum(jl.credit - jl.debit), 0)
  from public.journal_lines jl
  join public.chart_of_accounts a on a.id = jl.account_id
  left join public.chart_of_accounts p on p.id = a.parent_id
  where jl.company_id = p_company_id and (p_as_of is null or jl.entry_date <= p_as_of)
  group by a.id, a.code, a.name, a.account_type, p.code
  having sum(jl.debit - jl.credit) <> 0
  order by a.code;
$$;
grant execute on function public.trial_balance(uuid, date) to authenticated;
