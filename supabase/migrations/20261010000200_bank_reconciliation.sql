-- =====================================================================
-- JS Traders ERP — Stage 10 part 2: bank statement import + reconciliation (spec §15)
-- * Statement lines keep the original row (raw) and a duplicate-safe key per bank account.
--   Re-importing the same file / an overlapping statement never duplicates lines; a line
--   that really repeats can be imported on purpose ("authorised duplicate").
-- * Bank ledger = journal_lines carrying the bank account (amount in the bank's currency).
-- * Matches (bank_matches) link statement lines ↔ ledger lines in a group: 1:1, 1:n, n:1, n:n
--   — the two sides must add up to the same amount. Suggestions are only suggestions.
--   Book-only groups (no statement line) are for entries the bank never shows (opening
--   balances, a voucher and its reversal) — a reason is required unless they net to zero.
-- * Missing entries are created from a statement line through the normal accounting engine
--   (receipt / payment / expense / journal / transfer, split over several lines) and matched.
-- * Finalize: statement closing balance = ledger balance − book items not yet on the
--   statement + statement items not yet in the books; a difference needs an approved exception.
--   Finalizing moves the account's reconciled-until date; undo restores it. History is kept
--   (removed matches keep who / when / why; reconciliations are never deleted).
-- * A voucher matched in a reconciliation cannot be reversed until it is unmatched.
-- =====================================================================

create table if not exists public.bank_statement_imports (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  doc_no           text not null,
  bank_account_id  uuid not null references public.bank_accounts(id),
  file_name        text,
  statement_from   date,
  statement_to     date,
  opening_balance  numeric(18,2),
  closing_balance  numeric(18,2),
  lines_total      int not null default 0,
  lines_imported   int not null default 0,
  lines_skipped    int not null default 0,
  notes            text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create trigger stamp before insert or update on public.bank_statement_imports for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.bank_statement_imports for each row execute function public.tg_audit_row();
alter table public.bank_statement_imports enable row level security;
revoke insert, update, delete on public.bank_statement_imports from authenticated, anon;
create policy bsi_select on public.bank_statement_imports for select to authenticated
  using (public.has_permission(company_id, 'journals.view') or public.has_permission(company_id, 'bank.reconcile'));

create table if not exists public.bank_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  doc_no            text not null,
  bank_account_id   uuid not null references public.bank_accounts(id),
  period_from       date,
  period_to         date not null,
  statement_balance numeric(18,2) not null,
  ledger_balance    numeric(18,2) not null,
  book_not_on_statement numeric(18,2) not null,
  statement_not_in_books numeric(18,2) not null,
  difference        numeric(18,2) not null,
  exception_note    text,
  previous_reconciled_until date,
  status            text not null default 'FINALIZED' check (status in ('FINALIZED','UNDONE')),
  finalized_at timestamptz not null default now(), finalized_by uuid default auth.uid(),
  undone_at timestamptz, undone_by uuid, undo_reason text,
  unique (company_id, doc_no)
);
create index if not exists brc_bank_idx on public.bank_reconciliations(bank_account_id, period_to desc);
create trigger audit after insert or update on public.bank_reconciliations for each row execute function public.tg_audit_row();
alter table public.bank_reconciliations enable row level security;
revoke insert, update, delete on public.bank_reconciliations from authenticated, anon;
create policy brc_select on public.bank_reconciliations for select to authenticated
  using (public.has_permission(company_id, 'journals.view') or public.has_permission(company_id, 'bank.reconcile'));

create table if not exists public.bank_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  import_id         uuid not null references public.bank_statement_imports(id),
  bank_account_id   uuid not null references public.bank_accounts(id),
  line_no           int not null,
  line_date         date not null,
  value_date        date,
  description       text,
  reference         text,
  cheque_no         text,
  amount            numeric(18,2) not null check (amount <> 0),   -- + money in, − money out (bank's currency)
  balance           numeric(18,2),
  dedupe_key        text not null,
  is_authorised_duplicate boolean not null default false,
  raw               jsonb,
  status            text not null default 'UNMATCHED' check (status in ('UNMATCHED','MATCHED','IGNORED')),
  ignore_reason     text, ignored_at timestamptz, ignored_by uuid,
  reconciliation_id uuid references public.bank_reconciliations(id),
  created_at        timestamptz not null default now(),
  unique (bank_account_id, dedupe_key)
);
create index if not exists bsl_bank_date_idx on public.bank_statement_lines(bank_account_id, line_date);
create index if not exists bsl_open_idx on public.bank_statement_lines(bank_account_id, status) where status = 'UNMATCHED';
alter table public.bank_statement_lines enable row level security;
revoke insert, update, delete on public.bank_statement_lines from authenticated, anon;
create policy bsl_select on public.bank_statement_lines for select to authenticated
  using (public.has_permission(company_id, 'journals.view') or public.has_permission(company_id, 'bank.reconcile'));

create table if not exists public.bank_matches (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  bank_account_id   uuid not null references public.bank_accounts(id),
  group_id          uuid not null,
  statement_line_id uuid references public.bank_statement_lines(id),
  journal_line_id   uuid references public.journal_lines(id),
  amount            numeric(18,2) not null,
  kind              text not null check (kind in ('SUGGESTED','MANUAL','CREATED','BOOK_ONLY')),
  score             int,
  note              text,
  status            text not null default 'ACTIVE' check (status in ('ACTIVE','REMOVED')),
  reconciliation_id uuid references public.bank_reconciliations(id),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  removed_at timestamptz, removed_by uuid, removed_reason text,
  check ((statement_line_id is null) <> (journal_line_id is null))
);
create unique index if not exists bm_stmt_active_uq on public.bank_matches(statement_line_id) where status = 'ACTIVE' and statement_line_id is not null;
create unique index if not exists bm_jl_active_uq on public.bank_matches(journal_line_id) where status = 'ACTIVE' and journal_line_id is not null;
create index if not exists bm_group_idx on public.bank_matches(group_id);
create index if not exists bm_bank_idx on public.bank_matches(bank_account_id, status);
create trigger audit after insert or update on public.bank_matches for each row execute function public.tg_audit_row();
alter table public.bank_matches enable row level security;
revoke insert, update, delete on public.bank_matches from authenticated, anon;
create policy bm_select on public.bank_matches for select to authenticated
  using (public.has_permission(company_id, 'journals.view') or public.has_permission(company_id, 'bank.reconcile'));

-- ---------------------------------------------------------------- read models
-- bank ledger: amount in the bank's own currency (+ in / − out)
create or replace view public.bank_ledger_lines_v with (security_invoker = true) as
select jl.id, jl.company_id, jl.bank_account_id, jl.entry_id, e.entry_no, jl.entry_date, e.entry_type, e.status as entry_status, e.memo, e.reference,
       e.party_name, jl.description, e.source_type, e.reversal_of, e.reversed_by_entry,
       case when b.currency <> 'PKR' and jl.fx_amount is not null then (case when jl.debit > 0 then 1 else -1 end) * jl.fx_amount else jl.debit - jl.credit end as amount,
       jl.debit - jl.credit as amount_pkr,
       m.group_id as match_group, m.kind as match_kind, m.reconciliation_id
from public.journal_lines jl
join public.journal_entries_v e on e.id = jl.entry_id
join public.bank_accounts b on b.id = jl.bank_account_id
left join public.bank_matches m on m.journal_line_id = jl.id and m.status = 'ACTIVE'
where jl.bank_account_id is not null;
grant select on public.bank_ledger_lines_v to authenticated;

create or replace view public.bank_statement_lines_v with (security_invoker = true) as
select l.*, i.doc_no as import_no, m.group_id as match_group, m.kind as match_kind
from public.bank_statement_lines l
join public.bank_statement_imports i on i.id = l.import_id
left join public.bank_matches m on m.statement_line_id = l.id and m.status = 'ACTIVE';
grant select on public.bank_statement_lines_v to authenticated;

-- ---------------------------------------------------------------- import
-- p_meta: {file_name, statement_from, statement_to, opening_balance, closing_balance, notes}
-- p_lines: [{date, value_date, description, reference, cheque_no, amount (+in/−out) | debit+credit, balance, key?, force?, raw?}]
create or replace function public.import_bank_statement(p_bank_account_id uuid, p_meta jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bank_accounts; v_imp uuid; x jsonb; n int := 0; v_ok int := 0; v_skip jsonb := '[]'::jsonb; v_amt numeric; v_date date;
  v_base text; v_key text; v_seen jsonb := '{}'::jsonb; v_occ int; v_desc text; v_ref text; v_bal numeric;
begin
  select * into b from public.bank_accounts where id = p_bank_account_id;
  if b.id is null then raise exception 'Bank account not found' using errcode = 'P0002'; end if;
  perform public.inv_require(b.company_id, 'bank.reconcile');
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'The statement has no lines' using errcode = '23502'; end if;
  insert into public.bank_statement_imports(company_id, doc_no, bank_account_id, file_name, statement_from, statement_to, opening_balance, closing_balance, notes)
  values (b.company_id, public.next_document_number(b.company_id, 'BANK_IMPORT'), b.id, nullif(p_meta->>'file_name',''),
    nullif(p_meta->>'statement_from','')::date, nullif(p_meta->>'statement_to','')::date,
    nullif(p_meta->>'opening_balance','')::numeric, nullif(p_meta->>'closing_balance','')::numeric, nullif(trim(p_meta->>'notes'),''))
  returning id into v_imp;
  for x in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_date := nullif(x->>'date','')::date;
    if v_date is null then raise exception 'Line %: no date', n using errcode = '23502'; end if;
    v_amt := round(coalesce(nullif(x->>'amount','')::numeric, coalesce(nullif(x->>'credit','')::numeric, 0) - coalesce(nullif(x->>'debit','')::numeric, 0)), 2);
    if v_amt = 0 then continue; end if;
    v_desc := nullif(regexp_replace(trim(coalesce(x->>'description','')), '\s+', ' ', 'g'), '');
    v_ref := nullif(trim(coalesce(x->>'reference','')), '');
    v_bal := round(nullif(x->>'balance','')::numeric, 2);
    -- identity: the bank's own unique key, else date | amount | reference | description | running balance
    v_base := coalesce(nullif(trim(x->>'key'), ''),
      md5(concat_ws('|', v_date::text, v_amt::text, upper(coalesce(v_ref, '')), upper(coalesce(v_desc, '')), coalesce(v_bal::text, ''))));
    -- identical rows inside one statement are different transactions: number them
    v_occ := coalesce((v_seen->>v_base)::int, 0) + 1;
    v_seen := v_seen || jsonb_build_object(v_base, v_occ);
    v_key := v_base || '#' || v_occ;
    if coalesce((x->>'force')::boolean, false) then v_key := v_base || '#forced:' || gen_random_uuid()::text; end if;
    if exists (select 1 from public.bank_statement_lines where bank_account_id = b.id and dedupe_key = v_key) then
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('index', n - 1, 'date', v_date, 'amount', v_amt, 'description', v_desc, 'reference', v_ref));
      continue;
    end if;
    insert into public.bank_statement_lines(company_id, import_id, bank_account_id, line_no, line_date, value_date, description, reference, cheque_no, amount, balance,
      dedupe_key, is_authorised_duplicate, raw)
    values (b.company_id, v_imp, b.id, n, v_date, nullif(x->>'value_date','')::date, v_desc, v_ref, nullif(trim(coalesce(x->>'cheque_no','')), ''), v_amt, v_bal,
      v_key, coalesce((x->>'force')::boolean, false), coalesce(x->'raw', x));
    v_ok := v_ok + 1;
  end loop;
  update public.bank_statement_imports set lines_total = n, lines_imported = v_ok, lines_skipped = jsonb_array_length(v_skip),
    statement_from = coalesce(statement_from, (select min(line_date) from public.bank_statement_lines where import_id = v_imp)),
    statement_to = coalesce(statement_to, (select max(line_date) from public.bank_statement_lines where import_id = v_imp))
  where id = v_imp;
  return jsonb_build_object('import_id', v_imp, 'imported', v_ok, 'skipped', v_skip);
end $$;
revoke execute on function public.import_bank_statement(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.import_bank_statement(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- matching
create or replace function public.bank_match(p_bank_account_id uuid, p_statement_line_ids uuid[], p_journal_line_ids uuid[], p_kind text default 'MANUAL', p_note text default null, p_score int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.bank_accounts; v_g uuid := gen_random_uuid(); v_s numeric := 0; v_l numeric := 0; r record; n_s int; n_l int; v_kind text := upper(coalesce(p_kind, 'MANUAL'));
begin
  select * into b from public.bank_accounts where id = p_bank_account_id;
  if b.id is null then raise exception 'Bank account not found' using errcode = 'P0002'; end if;
  perform public.inv_require(b.company_id, 'bank.reconcile');
  n_s := coalesce(array_length(p_statement_line_ids, 1), 0); n_l := coalesce(array_length(p_journal_line_ids, 1), 0);
  if n_l = 0 then raise exception 'Choose the book entries to match' using errcode = '23502'; end if;
  if n_s = 0 and v_kind <> 'BOOK_ONLY' then raise exception 'Choose the statement lines to match' using errcode = '23502'; end if;
  for r in select * from public.bank_statement_lines where id = any(p_statement_line_ids) for update loop
    if r.bank_account_id <> b.id then raise exception 'Statement line belongs to another account' using errcode = '22023'; end if;
    if r.status <> 'UNMATCHED' then raise exception 'Statement line of % (%) is already %', to_char(r.line_date, 'DD-Mon'), r.amount, lower(r.status) using errcode = '22023'; end if;
    v_s := v_s + r.amount;
  end loop;
  if (select count(*) from public.bank_statement_lines where id = any(p_statement_line_ids)) <> n_s then raise exception 'Statement line not found' using errcode = 'P0002'; end if;
  for r in select * from public.bank_ledger_lines_v where id = any(p_journal_line_ids) loop
    if r.bank_account_id <> b.id then raise exception 'Entry % is not on this bank account', r.entry_no using errcode = '22023'; end if;
    if r.match_group is not null then raise exception 'Entry % is already matched', r.entry_no using errcode = '22023'; end if;
    v_l := v_l + r.amount;
  end loop;
  if (select count(*) from public.journal_lines where id = any(p_journal_line_ids) and bank_account_id = b.id) <> n_l then raise exception 'Book entry not found' using errcode = 'P0002'; end if;
  if v_kind = 'BOOK_ONLY' then
    if v_l <> 0 and nullif(trim(p_note), '') is null then raise exception 'Say why these entries will never appear on the statement' using errcode = '23502'; end if;
  elsif v_s <> v_l then
    raise exception 'The two sides do not agree: statement % vs books % (difference %)', v_s, v_l, v_s - v_l using errcode = '23514';
  end if;
  insert into public.bank_matches(company_id, bank_account_id, group_id, statement_line_id, amount, kind, score, note)
  select b.company_id, b.id, v_g, l.id, l.amount, v_kind, p_score, nullif(trim(p_note), '') from public.bank_statement_lines l where l.id = any(p_statement_line_ids);
  insert into public.bank_matches(company_id, bank_account_id, group_id, journal_line_id, amount, kind, score, note)
  select b.company_id, b.id, v_g, v.id, v.amount, v_kind, p_score, nullif(trim(p_note), '') from public.bank_ledger_lines_v v where v.id = any(p_journal_line_ids);
  update public.bank_statement_lines set status = 'MATCHED' where id = any(p_statement_line_ids);
  return v_g;
end $$;
revoke execute on function public.bank_match(uuid, uuid[], uuid[], text, text, int) from public, anon;
grant execute on function public.bank_match(uuid, uuid[], uuid[], text, text, int) to authenticated;

create or replace function public.bank_unmatch(p_group_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select * into m from public.bank_matches where group_id = p_group_id and status = 'ACTIVE' limit 1;
  if m.id is null then raise exception 'Match not found' using errcode = 'P0002'; end if;
  perform public.inv_require(m.company_id, 'bank.reconcile');
  if exists (select 1 from public.bank_matches where group_id = p_group_id and status = 'ACTIVE' and reconciliation_id is not null) then
    raise exception 'This match is part of a finalized reconciliation — undo that reconciliation first' using errcode = '22023';
  end if;
  update public.bank_statement_lines set status = 'UNMATCHED'
   where id in (select statement_line_id from public.bank_matches where group_id = p_group_id and status = 'ACTIVE');
  update public.bank_matches set status = 'REMOVED', removed_at = now(), removed_by = auth.uid(), removed_reason = nullif(trim(p_reason), '')
   where group_id = p_group_id and status = 'ACTIVE';
end $$;
revoke execute on function public.bank_unmatch(uuid, text) from public, anon;
grant execute on function public.bank_unmatch(uuid, text) to authenticated;

create or replace function public.bank_line_ignore(p_line_id uuid, p_ignore boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines;
begin
  select * into l from public.bank_statement_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Statement line not found' using errcode = 'P0002'; end if;
  perform public.inv_require(l.company_id, 'bank.reconcile');
  if l.reconciliation_id is not null then raise exception 'This line is in a finalized reconciliation' using errcode = '22023'; end if;
  if p_ignore then
    if l.status <> 'UNMATCHED' then raise exception 'Only an unmatched line can be ignored' using errcode = '22023'; end if;
    if nullif(trim(p_reason), '') is null then raise exception 'Say why this line is ignored (e.g. duplicate shown by the bank)' using errcode = '23502'; end if;
    update public.bank_statement_lines set status = 'IGNORED', ignore_reason = trim(p_reason), ignored_at = now(), ignored_by = auth.uid() where id = l.id;
  else
    if l.status <> 'IGNORED' then return; end if;
    update public.bank_statement_lines set status = 'UNMATCHED', ignore_reason = null, ignored_at = null, ignored_by = null where id = l.id;
  end if;
end $$;
revoke execute on function public.bank_line_ignore(uuid, boolean, text) from public, anon;
grant execute on function public.bank_line_ignore(uuid, boolean, text) to authenticated;

-- suggestions: same amount, date within p_days; cheque no. / reference / party name raise the score.
-- Each statement line and each book line is suggested at most once (best score wins).
create or replace function public.bank_match_suggestions(p_bank_account_id uuid, p_from date default null, p_to date default null, p_days int default 7)
returns table(statement_line_id uuid, journal_line_id uuid, score int, reasons text, line_date date, entry_date date, amount numeric, description text, entry_no text, party_name text)
language sql stable security invoker set search_path = '' as $$
  with s as (
    select * from public.bank_statement_lines where bank_account_id = p_bank_account_id and status = 'UNMATCHED'
      and (p_from is null or line_date >= p_from) and (p_to is null or line_date <= p_to)
  ),
  l as (
    select * from public.bank_ledger_lines_v where bank_account_id = p_bank_account_id and match_group is null
  ),
  c as (
    select s.id sid, l.id lid, s.line_date, l.entry_date, s.amount, s.description, l.entry_no, l.party_name,
      (50
       + case when abs(s.line_date - l.entry_date) = 0 then 15 when abs(s.line_date - l.entry_date) <= 2 then 10 when abs(s.line_date - l.entry_date) <= 5 then 5 else 0 end
       + case when coalesce(s.cheque_no, '') <> '' and (l.reference ilike '%' || s.cheque_no || '%' or l.memo ilike '%' || s.cheque_no || '%') then 30
              when coalesce(l.reference, '') <> '' and length(l.reference) >= 4 and (s.description ilike '%' || l.reference || '%' or s.reference ilike '%' || l.reference || '%') then 25 else 0 end
       + case when coalesce(l.party_name, '') <> '' and s.description ilike '%' || split_part(l.party_name, ' ', 1) || '%' then 10 else 0 end)::int as score,
      concat_ws(', ', 'same amount',
        case when s.line_date = l.entry_date then 'same date' else abs(s.line_date - l.entry_date) || ' day(s) apart' end,
        case when coalesce(s.cheque_no, '') <> '' and (l.reference ilike '%' || s.cheque_no || '%' or l.memo ilike '%' || s.cheque_no || '%') then 'cheque no.' end,
        case when coalesce(l.reference, '') <> '' and length(l.reference) >= 4 and (s.description ilike '%' || l.reference || '%' or s.reference ilike '%' || l.reference || '%') then 'reference' end,
        case when coalesce(l.party_name, '') <> '' and s.description ilike '%' || split_part(l.party_name, ' ', 1) || '%' then 'party name' end) as reasons
    from s join l on l.amount = s.amount and abs(s.line_date - l.entry_date) <= p_days
  ),
  r1 as (select c.*, row_number() over (partition by sid order by score desc, abs(line_date - entry_date), entry_no) rs from c),
  r2 as (select r1.*, row_number() over (partition by lid order by score desc, abs(line_date - entry_date)) rl from r1 where rs = 1)
  select sid, lid, score, reasons, line_date, entry_date, amount, description, entry_no, party_name from r2 where rl = 1 order by line_date;
$$;
grant execute on function public.bank_match_suggestions(uuid, date, date, int) to authenticated;

-- accept several suggestions at once [{statement_line_id, journal_line_id, score}]
create or replace function public.bank_accept_suggestions(p_bank_account_id uuid, p_pairs jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare x jsonb; n int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    perform public.bank_match(p_bank_account_id, array[(x->>'statement_line_id')::uuid], array[(x->>'journal_line_id')::uuid], 'SUGGESTED', null, nullif(x->>'score','')::int);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.bank_accept_suggestions(uuid, jsonb) from public, anon;
grant execute on function public.bank_accept_suggestions(uuid, jsonb) to authenticated;

-- a voucher and its reversal on this bank, both unmatched → matched together (book-only, they cancel out)
create or replace function public.bank_match_reversal_pairs(p_bank_account_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select o.id oid, v.id vid from public.bank_ledger_lines_v o
    join public.bank_ledger_lines_v v on v.reversal_of = o.entry_id and v.bank_account_id = o.bank_account_id and v.amount = -o.amount and v.match_group is null
    where o.bank_account_id = p_bank_account_id and o.match_group is null
  loop
    if exists (select 1 from public.bank_matches where journal_line_id in (r.oid, r.vid) and status = 'ACTIVE') then continue; end if;
    perform public.bank_match(p_bank_account_id, '{}'::uuid[], array[r.oid, r.vid], 'BOOK_ONLY', 'Voucher and its reversal', null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.bank_match_reversal_pairs(uuid) from public, anon;
grant execute on function public.bank_match_reversal_pairs(uuid) to authenticated;

-- create the missing receipt / payment / expense / journal / transfer from a statement line, then match it
-- p_counter: [{account_id, party_type, party_id, amount, description}]  (split over several lines if needed; PKR)
-- p_extra: {memo, reference, fx_rate (foreign-currency bank), allocations: [{invoice_id|bill_id, amount}]}
create or replace function public.bank_line_create_entry(p_line_id uuid, p_kind text, p_counter jsonb, p_extra jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; b public.bank_accounts; v_kind text := upper(coalesce(p_kind, '')); v_type text; v_pkr numeric; v_rate numeric;
  v_lines jsonb; x jsonb; v_sum numeric := 0; v_je uuid; v_pt text; v_pid uuid; n int := 0; v_bank_line jsonb; v_memo text; v_jl uuid;
begin
  select * into l from public.bank_statement_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Statement line not found' using errcode = 'P0002'; end if;
  perform public.inv_require(l.company_id, 'bank.reconcile');
  perform public.inv_require(l.company_id, 'journals.create');
  if l.status <> 'UNMATCHED' then raise exception 'This statement line is already %', lower(l.status) using errcode = '22023'; end if;
  select * into b from public.bank_accounts where id = l.bank_account_id;
  v_type := case v_kind when 'RECEIPT' then 'RECEIPT' when 'PAYMENT' then 'PAYMENT' when 'EXPENSE' then 'PAYMENT' when 'TRANSFER' then 'TRANSFER' when 'JOURNAL' then 'JOURNAL' end;
  if v_type is null then raise exception 'Choose what to create' using errcode = '23502'; end if;
  if v_kind = 'RECEIPT' and l.amount < 0 then raise exception 'Money went out on this line — make a payment, not a receipt' using errcode = '22023'; end if;
  if v_kind in ('PAYMENT','EXPENSE') and l.amount > 0 then raise exception 'Money came in on this line — make a receipt, not a payment' using errcode = '22023'; end if;
  if b.currency = 'PKR' then v_rate := 1; v_pkr := abs(l.amount);
  else
    v_rate := nullif(p_extra->>'fx_rate','')::numeric;
    if coalesce(v_rate, 0) <= 0 then raise exception 'This account is in % — enter the rate', b.currency using errcode = '23502'; end if;
    v_pkr := round(abs(l.amount) * v_rate, 2);
  end if;
  v_memo := coalesce(nullif(trim(p_extra->>'memo'),''), l.description, 'From bank statement');
  v_bank_line := jsonb_build_object('account_id', b.gl_account_id, case when l.amount > 0 then 'debit' else 'credit' end, v_pkr, 'bank_account_id', b.id, 'description', left(v_memo, 200));
  if b.currency <> 'PKR' then v_bank_line := v_bank_line || jsonb_build_object('currency', b.currency, 'fx_amount', abs(l.amount), 'fx_rate', v_rate); end if;
  v_lines := jsonb_build_array(v_bank_line);
  for x in select * from jsonb_array_elements(coalesce(p_counter, '[]'::jsonb)) loop
    if coalesce(nullif(x->>'amount','')::numeric, 0) <= 0 then continue; end if;
    n := n + 1;
    v_sum := v_sum + round((x->>'amount')::numeric, 2);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', x->>'account_id', case when l.amount > 0 then 'credit' else 'debit' end, round((x->>'amount')::numeric, 2),
      'party_type', nullif(x->>'party_type',''), 'party_id', nullif(x->>'party_id',''), 'bank_account_id', nullif(x->>'bank_account_id',''),
      'description', coalesce(nullif(trim(x->>'description'),''), left(v_memo, 200))));
    if n = 1 then v_pt := nullif(x->>'party_type',''); v_pid := nullif(x->>'party_id','')::uuid; end if;
  end loop;
  if n = 0 then raise exception 'Add the other side of the entry' using errcode = '23502'; end if;
  if v_sum <> v_pkr then raise exception 'The lines add up to % but the bank line is %', v_sum, v_pkr using errcode = '23514'; end if;
  v_je := public.acc_post_document_entry(l.company_id, v_type, l.line_date, v_memo, coalesce(nullif(trim(p_extra->>'reference'),''), l.reference, l.cheque_no),
    case when n = 1 then v_pt end, case when n = 1 then v_pid end, b.id, v_pkr, v_lines, null, null);
  select id into v_jl from public.journal_lines where entry_id = v_je and bank_account_id = b.id and line_no = 1;
  perform public.bank_match(b.id, array[l.id], array[v_jl], 'CREATED', 'Created from the statement', null);
  for x in select * from jsonb_array_elements(coalesce(p_extra->'allocations', '[]'::jsonb)) loop
    if coalesce(nullif(x->>'amount','')::numeric, 0) <= 0 then continue; end if;
    if x ? 'invoice_id' then perform public.inv_allocate(v_je, (x->>'invoice_id')::uuid, (x->>'amount')::numeric);
    elsif x ? 'bill_id' then perform public.allocate_supplier_payment(v_je, jsonb_build_array(x));
    end if;
  end loop;
  return v_je;
end $$;
revoke execute on function public.bank_line_create_entry(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.bank_line_create_entry(uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- reconcile
-- ledger balance at p_to, book items not on the statement by p_to, statement items not in the books by p_to
create or replace function public.bank_rec_summary(p_bank_account_id uuid, p_to date, p_statement_balance numeric default null)
returns table(ledger_balance numeric, book_not_on_statement numeric, book_items int, statement_not_in_books numeric, statement_items int,
              adjusted_balance numeric, statement_balance numeric, difference numeric, last_statement_balance numeric, reconciled_until date)
language sql stable security invoker set search_path = '' as $$
  with g as (   -- per match group: latest date on each side
    select m.group_id,
      max(sl.line_date) as s_max, max(jl.entry_date) as l_max, bool_or(m.kind = 'BOOK_ONLY') as book_only
    from public.bank_matches m
    left join public.bank_statement_lines sl on sl.id = m.statement_line_id
    left join public.journal_lines jl on jl.id = m.journal_line_id
    where m.bank_account_id = p_bank_account_id and m.status = 'ACTIVE'
    group by m.group_id
  ),
  led as (
    select v.amount, v.entry_date, v.match_group, g.s_max, g.book_only from public.bank_ledger_lines_v v left join g on g.group_id = v.match_group
    where v.bank_account_id = p_bank_account_id and v.entry_date <= p_to
  ),
  st as (
    select l.amount, l.line_date, l.status, g.l_max from public.bank_statement_lines l
    left join public.bank_matches m on m.statement_line_id = l.id and m.status = 'ACTIVE' left join g on g.group_id = m.group_id
    where l.bank_account_id = p_bank_account_id and l.line_date <= p_to and l.status <> 'IGNORED'
  ),
  x as (
    select
      (select coalesce(sum(amount), 0) from led) as lb,
      (select coalesce(sum(amount), 0) from led where match_group is null or (not coalesce(book_only, false) and s_max > p_to)) as bn,
      (select count(*) from led where match_group is null or (not coalesce(book_only, false) and s_max > p_to))::int as bi,
      (select coalesce(sum(amount), 0) from st where status = 'UNMATCHED' or l_max > p_to) as sn,
      (select count(*) from st where status = 'UNMATCHED' or l_max > p_to)::int as si,
      (select balance from public.bank_statement_lines where bank_account_id = p_bank_account_id and line_date <= p_to and balance is not null
        order by line_date desc, import_id desc, line_no desc limit 1) as lsb,
      (select reconciled_until from public.bank_accounts where id = p_bank_account_id) as ru
  )
  select lb, bn, bi, sn, si, lb - bn + sn, coalesce(p_statement_balance, lsb), coalesce(p_statement_balance, lsb) - (lb - bn + sn), lsb, ru from x;
$$;
grant execute on function public.bank_rec_summary(uuid, date, numeric) to authenticated;

create or replace function public.finalize_bank_reconciliation(p_bank_account_id uuid, p_to date, p_statement_balance numeric, p_exception_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.bank_accounts; s record; v_id uuid;
begin
  select * into b from public.bank_accounts where id = p_bank_account_id for update;
  if b.id is null then raise exception 'Bank account not found' using errcode = 'P0002'; end if;
  perform public.inv_require(b.company_id, 'bank.reconcile');
  if p_statement_balance is null then raise exception 'Enter the statement closing balance' using errcode = '23502'; end if;
  if b.reconciled_until is not null and p_to <= b.reconciled_until then
    raise exception 'Already reconciled up to % — choose a later date', to_char(b.reconciled_until, 'DD-Mon-YYYY') using errcode = '22023';
  end if;
  select * into s from public.bank_rec_summary(b.id, p_to, p_statement_balance);
  if s.difference <> 0 then
    if nullif(trim(p_exception_note), '') is null then
      raise exception 'There is a difference of % — match or create the missing entries, or record an approved exception', s.difference using errcode = '23514';
    end if;
    perform public.inv_require(b.company_id, 'bank.reconcile_exception');
  end if;
  insert into public.bank_reconciliations(company_id, doc_no, bank_account_id, period_from, period_to, statement_balance, ledger_balance, book_not_on_statement,
    statement_not_in_books, difference, exception_note, previous_reconciled_until)
  values (b.company_id, public.next_document_number(b.company_id, 'BANK_REC'), b.id, coalesce(b.reconciled_until + 1, null), p_to, p_statement_balance, s.ledger_balance,
    s.book_not_on_statement, s.statement_not_in_books, s.difference, nullif(trim(p_exception_note), ''), b.reconciled_until)
  returning id into v_id;
  -- lock the groups that are complete by p_to, and the statement lines up to p_to
  update public.bank_matches m set reconciliation_id = v_id
   where m.bank_account_id = b.id and m.status = 'ACTIVE' and m.reconciliation_id is null
     and m.group_id in (
       select mm.group_id from public.bank_matches mm
       left join public.bank_statement_lines sl on sl.id = mm.statement_line_id
       left join public.journal_lines jl on jl.id = mm.journal_line_id
       where mm.bank_account_id = b.id and mm.status = 'ACTIVE'
       group by mm.group_id having coalesce(max(sl.line_date), p_to) <= p_to and coalesce(max(jl.entry_date), p_to) <= p_to);
  update public.bank_statement_lines l set reconciliation_id = v_id
   where l.bank_account_id = b.id and l.reconciliation_id is null and l.line_date <= p_to
     and (l.status = 'IGNORED' or exists (select 1 from public.bank_matches m where m.statement_line_id = l.id and m.status = 'ACTIVE' and m.reconciliation_id = v_id));
  update public.bank_accounts set reconciled_until = p_to where id = b.id;
  return v_id;
end $$;
revoke execute on function public.finalize_bank_reconciliation(uuid, date, numeric, text) from public, anon;
grant execute on function public.finalize_bank_reconciliation(uuid, date, numeric, text) to authenticated;

create or replace function public.undo_bank_reconciliation(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.bank_reconciliations;
begin
  select * into r from public.bank_reconciliations where id = p_id for update;
  if r.id is null then raise exception 'Reconciliation not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'bank.reconcile');
  if r.status <> 'FINALIZED' then raise exception 'Already undone' using errcode = '22023'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  if exists (select 1 from public.bank_reconciliations where bank_account_id = r.bank_account_id and status = 'FINALIZED' and period_to > r.period_to) then
    raise exception 'Undo the later reconciliations of this account first' using errcode = '22023';
  end if;
  update public.bank_matches set reconciliation_id = null where reconciliation_id = r.id;
  update public.bank_statement_lines set reconciliation_id = null where reconciliation_id = r.id;
  update public.bank_reconciliations set status = 'UNDONE', undone_at = now(), undone_by = auth.uid(), undo_reason = trim(p_reason) where id = r.id;
  update public.bank_accounts set reconciled_until = r.previous_reconciled_until where id = r.bank_account_id;
end $$;
revoke execute on function public.undo_bank_reconciliation(uuid, text) from public, anon;
grant execute on function public.undo_bank_reconciliation(uuid, text) to authenticated;

-- match groups with both sides, for the "Matched" list and history
create or replace view public.bank_match_groups_v with (security_invoker = true) as
select m.group_id, m.bank_account_id, m.company_id, min(m.kind) as kind, min(m.status) as status, max(m.note) as note, min(m.created_at) as created_at,
  (array_agg(m.created_by))[1] as created_by, max(m.removed_at) as removed_at, max(m.removed_reason) as removed_reason, max(m.reconciliation_id::text)::uuid as reconciliation_id,
  count(m.statement_line_id)::int as statement_lines, count(m.journal_line_id)::int as book_lines,
  coalesce(sum(m.amount) filter (where m.statement_line_id is not null), 0) as statement_amount,
  coalesce(sum(m.amount) filter (where m.journal_line_id is not null), 0) as book_amount,
  min(sl.line_date) as statement_date, string_agg(distinct sl.description, ' | ') as statement_text,
  min(jl.entry_date) as book_date, string_agg(distinct e.entry_no, ', ') as entries
from public.bank_matches m
left join public.bank_statement_lines sl on sl.id = m.statement_line_id
left join public.journal_lines jl on jl.id = m.journal_line_id
left join public.journal_entries e on e.id = jl.entry_id
group by m.group_id, m.bank_account_id, m.company_id;
grant select on public.bank_match_groups_v to authenticated;

-- ---------------------------------------------------------------- guards: a voucher matched in a reconciliation cannot be reversed
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
  if exists (select 1 from public.bank_matches m join public.journal_lines jl on jl.id = m.journal_line_id
             where jl.entry_id = h.id and m.status = 'ACTIVE') then
    raise exception 'Entry % is matched in a bank reconciliation — unmatch it there first', h.entry_no using errcode = '22023';
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
  if exists (select 1 from public.bank_matches m join public.journal_lines jl on jl.id = m.journal_line_id
             where jl.entry_id = h.id and m.status = 'ACTIVE') then
    raise exception 'Entry % is matched in a bank reconciliation — unmatch it there first', h.entry_no using errcode = '22023';
  end if;
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

-- ---------------------------------------------------------------- attachments on cheques / statements
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
    when 'pdc_records'         then public.has_permission(p_company, 'journals.view') or public.has_permission(p_company, 'pdc.manage')
    when 'bank_statement_imports' then public.has_permission(p_company, 'journals.view')
    else public.has_permission(p_company, 'inventory.view')
  end;
end $$;
