-- =====================================================================
-- JS Traders ERP — Stage 10 part 1: post-dated cheques (spec §14)
-- RECEIVED (customer) / ISSUED (supplier) → HELD → (due) → DEPOSITED → CLEARED
--                                     DEPOSITED → BOUNCED → RE-PRESENTED → … → CLEARED
-- Accounting (normal engine, source_type 'PDC'):
--   received:  Dr 1250 PDC Receivable (cheques in hand) / Cr Accounts Receivable (customer)  [RECEIPT — can pay invoices]
--     clear:   Dr Bank (deposited into) / Cr PDC Receivable
--   issued:    Dr Accounts Payable (supplier) / Cr 2150 PDC Payable                           [PAYMENT — can pay bills]
--     clear:   Dr PDC Payable / Cr Bank (drawn on)
--   bounce:    the cheque's receipt / payment entry is reversed (party owes / is owed again),
--              its invoice / bill allocations are released; optional bank charges.
--   re-present: a new receipt / payment entry; return / cancel: entry reversed.
-- Every state change writes a pdc_events row (and the audit log).
-- =====================================================================

insert into public.permissions(code, module, description, is_sensitive) values
  ('pdc.manage','accounting','Record post-dated cheques and change their status (deposit, clear, bounce, re-present)',true),
  ('bank.reconcile','accounting','Import bank statements, match and reconcile bank accounts',true),
  ('bank.reconcile_exception','accounting','Finalize a bank reconciliation that still has an unexplained difference',true)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values
  ('ADMINISTRATOR','pdc.manage'),('ADMINISTRATOR','bank.reconcile'),('ADMINISTRATOR','bank.reconcile_exception'),
  ('ACCOUNTANT','pdc.manage'),('ACCOUNTANT','bank.reconcile')
) as x(role_code, p) on x.role_code = r.code
on conflict do nothing;

insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, x.t, x.p, 5, true from public.companies c
cross join (values ('PDC','PDC-'),('BANK_IMPORT','BSI-'),('BANK_REC','BRC-')) as x(t, p)
on conflict do nothing;

create table if not exists public.pdc_records (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  doc_no           text not null,
  direction        text not null check (direction in ('RECEIVED','ISSUED')),
  party_type       text not null check (party_type in ('CUSTOMER','SUPPLIER')),
  party_id         uuid not null,
  cheque_no        text not null,
  cheque_date      date not null,               -- the date written on the cheque (due date)
  received_date    date not null,               -- received from / handed to the party
  amount           numeric(18,2) not null check (amount > 0),
  currency         text not null default 'PKR' references public.currencies(code),
  drawer_bank      text,                        -- received: the party's bank
  drawer_branch    text,
  drawer_account   text,
  bank_account_id  uuid references public.bank_accounts(id),   -- issued: our bank it is drawn on; received: deposited into
  status           text not null default 'HELD' check (status in ('HELD','DEPOSITED','CLEARED','BOUNCED','RETURNED','CANCELLED')),
  deposit_date     date,
  cleared_date     date,
  bounced_date     date,
  bounce_reason    text,
  bounce_count     int not null default 0,
  present_count    int not null default 1,
  current_entry_id uuid references public.journal_entries(id),  -- the receipt / payment entry now in force
  clear_entry_id   uuid references public.journal_entries(id),
  reference        text,
  notes            text,
  idempotency_key  uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no),
  check ((direction = 'RECEIVED') = (party_type = 'CUSTOMER')),
  check (currency = 'PKR')
);
create index if not exists pdc_status_idx on public.pdc_records(company_id, status, cheque_date);
create index if not exists pdc_party_idx on public.pdc_records(party_type, party_id);
create trigger stamp before insert or update on public.pdc_records for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.pdc_records for each row execute function public.tg_audit_row();
alter table public.pdc_records enable row level security;
revoke insert, update, delete on public.pdc_records from authenticated, anon;
create policy pdc_select on public.pdc_records for select to authenticated
  using (public.has_permission(company_id, 'journals.view') or public.has_permission(company_id, 'pdc.manage'));

create table if not exists public.pdc_events (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  pdc_id           uuid not null references public.pdc_records(id),
  event            text not null,
  from_status      text,
  to_status        text,
  event_date       date not null,
  bank_account_id  uuid references public.bank_accounts(id),
  journal_entry_id uuid references public.journal_entries(id),
  amount           numeric(18,2),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid()
);
create index if not exists pdce_pdc_idx on public.pdc_events(pdc_id, created_at);
create trigger immutable before update or delete on public.pdc_events for each row execute function public.tg_immutable();
alter table public.pdc_events enable row level security;
revoke insert, update, delete on public.pdc_events from authenticated, anon;
create policy pdce_select on public.pdc_events for select to authenticated
  using (public.has_permission(company_id, 'journals.view') or public.has_permission(company_id, 'pdc.manage'));

-- the receipt / payment entry of a cheque (also used for re-presenting)
create or replace function public.pdc_post_main(p public.pdc_records, p_date date, p_memo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_lines jsonb; v_name text;
begin
  if p.direction = 'RECEIVED' then
    select name into v_name from public.customers where id = p.party_id;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', public.hr_account(p.company_id, 'PDC_RECEIVABLE'), 'debit', p.amount, 'description', 'Cheque ' || p.cheque_no || coalesce(' / ' || p.drawer_bank, '') || ' dated ' || to_char(p.cheque_date, 'DD-Mon-YYYY')),
      jsonb_build_object('account_id', public.hr_account(p.company_id, 'AR_CONTROL'), 'credit', p.amount, 'party_type', 'CUSTOMER', 'party_id', p.party_id, 'description', 'PDC ' || p.doc_no || ' cheque ' || p.cheque_no));
    return public.acc_post_document_entry(p.company_id, 'RECEIPT', p_date, coalesce(p_memo, 'Post-dated cheque ' || p.cheque_no || ' from ' || v_name),
      p.cheque_no, 'CUSTOMER', p.party_id, null, p.amount, v_lines, 'PDC', p.id);
  else
    select name into v_name from public.suppliers where id = p.party_id;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', public.hr_account(p.company_id, 'AP_CONTROL'), 'debit', p.amount, 'party_type', 'SUPPLIER', 'party_id', p.party_id, 'description', 'PDC ' || p.doc_no || ' cheque ' || p.cheque_no),
      jsonb_build_object('account_id', public.hr_account(p.company_id, 'PDC_PAYABLE'), 'credit', p.amount, 'description', 'Cheque ' || p.cheque_no || ' dated ' || to_char(p.cheque_date, 'DD-Mon-YYYY')));
    return public.acc_post_document_entry(p.company_id, 'PAYMENT', p_date, coalesce(p_memo, 'Post-dated cheque ' || p.cheque_no || ' to ' || v_name),
      p.cheque_no, 'SUPPLIER', p.party_id, null, p.amount, v_lines, 'PDC', p.id);
  end if;
end $$;
revoke execute on function public.pdc_post_main(public.pdc_records, date, text) from public, anon, authenticated;

-- free the cheque's invoice / bill allocations (bounce / return)
create or replace function public.pdc_release_allocations(p public.pdc_records)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v numeric := 0;
begin
  if p.current_entry_id is null then return 0; end if;
  if p.direction = 'RECEIVED' then
    select coalesce(sum(amount), 0) into v from public.receipt_allocations where receipt_entry_id = p.current_entry_id and status = 'ACTIVE';
    update public.receipt_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid() where receipt_entry_id = p.current_entry_id and status = 'ACTIVE';
  else
    select coalesce(sum(amount), 0) into v from public.supplier_bill_allocations where payment_entry_id = p.current_entry_id and status = 'ACTIVE';
    update public.supplier_bill_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid() where payment_entry_id = p.current_entry_id and status = 'ACTIVE';
  end if;
  return v;
end $$;
revoke execute on function public.pdc_release_allocations(public.pdc_records) from public, anon, authenticated;

create or replace function public.pdc_event(p public.pdc_records, p_event text, p_from text, p_to text, p_date date, p_bank uuid, p_entry uuid, p_amount numeric, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.pdc_events(company_id, pdc_id, event, from_status, to_status, event_date, bank_account_id, journal_entry_id, amount, note)
  values (p.company_id, p.id, p_event, p_from, p_to, p_date, p_bank, p_entry, p_amount, nullif(trim(p_note), ''));
$$;
revoke execute on function public.pdc_event(public.pdc_records, text, text, text, date, uuid, uuid, numeric, text) from public, anon, authenticated;

-- record a cheque (received from a customer / issued to a supplier); optional allocations [{invoice_id|bill_id, amount}]
create or replace function public.save_pdc(p_header jsonb, p_allocations jsonb default '[]'::jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_dir text := upper(coalesce(p_header->>'direction','RECEIVED'));
  v_party uuid := nullif(p_header->>'party_id','')::uuid; v_no text; v_id uuid; p public.pdc_records; v_je uuid; v_bank public.bank_accounts; x jsonb;
  v_cheque text := nullif(trim(p_header->>'cheque_no'),''); v_amt numeric := round(coalesce(nullif(p_header->>'amount','')::numeric, 0), 2);
begin
  perform public.inv_require(v_company, 'pdc.manage');
  if p_idempotency_key is not null then
    select id into v_id from public.pdc_records where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  if v_dir not in ('RECEIVED','ISSUED') then raise exception 'Received or issued?' using errcode = '23502'; end if;
  if v_party is null then raise exception 'Choose the %', case v_dir when 'RECEIVED' then 'customer' else 'supplier' end using errcode = '23502'; end if;
  if v_dir = 'RECEIVED' and not exists (select 1 from public.customers where id = v_party and company_id = v_company) then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if v_dir = 'ISSUED' and not exists (select 1 from public.suppliers where id = v_party and company_id = v_company) then raise exception 'Supplier not found' using errcode = 'P0002'; end if;
  if v_cheque is null then raise exception 'Enter the cheque number' using errcode = '23502'; end if;
  if v_amt <= 0 then raise exception 'Enter the cheque amount' using errcode = '23502'; end if;
  if nullif(p_header->>'cheque_date','') is null then raise exception 'Enter the date on the cheque' using errcode = '23502'; end if;
  if v_dir = 'ISSUED' then
    select * into v_bank from public.bank_accounts where id = nullif(p_header->>'bank_account_id','')::uuid and company_id = v_company and is_active;
    if v_bank.id is null then raise exception 'Choose our bank account the cheque is drawn on' using errcode = '23502'; end if;
    if v_bank.currency <> 'PKR' then raise exception 'Cheques are in PKR — choose a PKR bank account' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.pdc_records where company_id = v_company and direction = v_dir and party_id = v_party and cheque_no = v_cheque
               and coalesce(drawer_bank, '') = coalesce(nullif(trim(p_header->>'drawer_bank'),''), '') and status not in ('RETURNED','CANCELLED')) then
    raise exception 'Cheque % is already recorded for this party', v_cheque using errcode = '23505';
  end if;

  v_no := public.next_document_number(v_company, 'PDC');
  insert into public.pdc_records(company_id, doc_no, direction, party_type, party_id, cheque_no, cheque_date, received_date, amount, drawer_bank, drawer_branch, drawer_account,
    bank_account_id, reference, notes, idempotency_key)
  values (v_company, v_no, v_dir, case v_dir when 'RECEIVED' then 'CUSTOMER' else 'SUPPLIER' end, v_party, v_cheque, (p_header->>'cheque_date')::date,
    coalesce(nullif(p_header->>'received_date','')::date, current_date), v_amt, nullif(trim(p_header->>'drawer_bank'),''), nullif(trim(p_header->>'drawer_branch'),''),
    nullif(trim(p_header->>'drawer_account'),''), v_bank.id, nullif(trim(p_header->>'reference'),''), nullif(trim(p_header->>'notes'),''), p_idempotency_key)
  returning * into p;
  v_je := public.pdc_post_main(p, p.received_date, null);
  update public.pdc_records set current_entry_id = v_je where id = p.id;
  perform public.pdc_event(p, v_dir, null, 'HELD', p.received_date, v_bank.id, v_je, v_amt, p_header->>'notes');

  for x in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if coalesce(nullif(x->>'amount','')::numeric, 0) <= 0 then continue; end if;
    if v_dir = 'RECEIVED' then perform public.inv_allocate(v_je, (x->>'invoice_id')::uuid, (x->>'amount')::numeric);
    else perform public.allocate_supplier_payment(v_je, jsonb_build_array(jsonb_build_object('bill_id', x->>'bill_id', 'amount', x->>'amount')));
    end if;
  end loop;
  return p.id;
end $$;
revoke execute on function public.save_pdc(jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_pdc(jsonb, jsonb, uuid) to authenticated;

-- one RPC for every state change: DEPOSIT, CLEAR, BOUNCE, REPRESENT, RETURN, CANCEL, UNDO_CLEAR, UNDO_DEPOSIT, NOTE
create or replace function public.pdc_action(p_id uuid, p_action text, p_data jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.pdc_records; v_act text := upper(coalesce(p_action,'')); v_date date := coalesce(nullif(p_data->>'date','')::date, current_date);
  v_bank public.bank_accounts; v_je uuid; v_from text; v_to text; v_note text := nullif(trim(p_data->>'note'),''); v_chg numeric; v_rel numeric;
begin
  select * into p from public.pdc_records where id = p_id for update;
  if p.id is null then raise exception 'Cheque not found' using errcode = 'P0002'; end if;
  perform public.inv_require(p.company_id, 'pdc.manage');
  v_from := p.status;

  if v_act = 'DEPOSIT' then
    if p.direction <> 'RECEIVED' then raise exception 'Only received cheques are deposited' using errcode = '22023'; end if;
    if p.status <> 'HELD' then raise exception 'Only a cheque in hand can be deposited (this one is %)', lower(p.status) using errcode = '22023'; end if;
    select * into v_bank from public.bank_accounts where id = nullif(p_data->>'bank_account_id','')::uuid and company_id = p.company_id and is_active;
    if v_bank.id is null then raise exception 'Choose the bank account it is deposited into' using errcode = '23502'; end if;
    if v_bank.currency <> 'PKR' then raise exception 'Choose a PKR bank account' using errcode = '22023'; end if;
    update public.pdc_records set status = 'DEPOSITED', bank_account_id = v_bank.id, deposit_date = v_date where id = p.id;
    v_to := 'DEPOSITED';
    perform public.pdc_event(p, 'DEPOSITED', v_from, v_to, v_date, v_bank.id, null, p.amount, v_note);

  elsif v_act = 'UNDO_DEPOSIT' then
    if p.status <> 'DEPOSITED' or p.direction <> 'RECEIVED' then raise exception 'Only a deposited cheque can be taken back' using errcode = '22023'; end if;
    update public.pdc_records set status = 'HELD', deposit_date = null where id = p.id;
    v_to := 'HELD';
    perform public.pdc_event(p, 'UNDO_DEPOSIT', v_from, v_to, v_date, p.bank_account_id, null, null, v_note);

  elsif v_act = 'CLEAR' then
    if (p.direction = 'RECEIVED' and p.status <> 'DEPOSITED') or (p.direction = 'ISSUED' and p.status not in ('HELD','DEPOSITED')) then
      raise exception 'This cheque cannot be cleared now (it is %)', lower(p.status) using errcode = '22023';
    end if;
    if v_date < p.cheque_date then raise exception 'The cheque is dated % — it cannot clear before that', to_char(p.cheque_date, 'DD-Mon-YYYY') using errcode = '22023'; end if;
    select * into v_bank from public.bank_accounts where id = p.bank_account_id;
    if p.direction = 'RECEIVED' then
      v_je := public.acc_post_document_entry(p.company_id, 'TRANSFER', v_date, 'Cheque ' || p.cheque_no || ' cleared (' || p.doc_no || ')', p.cheque_no, null, null, v_bank.id, p.amount,
        jsonb_build_array(jsonb_build_object('account_id', v_bank.gl_account_id, 'debit', p.amount, 'bank_account_id', v_bank.id, 'description', 'Cheque ' || p.cheque_no || ' cleared'),
                          jsonb_build_object('account_id', public.hr_account(p.company_id, 'PDC_RECEIVABLE'), 'credit', p.amount, 'description', p.doc_no)), 'PDC', p.id);
    else
      v_je := public.acc_post_document_entry(p.company_id, 'TRANSFER', v_date, 'Our cheque ' || p.cheque_no || ' cleared (' || p.doc_no || ')', p.cheque_no, null, null, v_bank.id, p.amount,
        jsonb_build_array(jsonb_build_object('account_id', public.hr_account(p.company_id, 'PDC_PAYABLE'), 'debit', p.amount, 'description', p.doc_no),
                          jsonb_build_object('account_id', v_bank.gl_account_id, 'credit', p.amount, 'bank_account_id', v_bank.id, 'description', 'Cheque ' || p.cheque_no || ' cleared')), 'PDC', p.id);
    end if;
    update public.pdc_records set status = 'CLEARED', cleared_date = v_date, clear_entry_id = v_je where id = p.id;
    v_to := 'CLEARED';
    perform public.pdc_event(p, 'CLEARED', v_from, v_to, v_date, v_bank.id, v_je, p.amount, v_note);

  elsif v_act = 'UNDO_CLEAR' then
    if p.status <> 'CLEARED' then raise exception 'Only a cleared cheque can be un-cleared' using errcode = '22023'; end if;
    if nullif(trim(p_data->>'note'),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
    perform public.acc_reverse_document_entry(p.clear_entry_id, 'Clearing undone: ' || v_note, greatest(v_date, p.cleared_date));
    v_to := case when p.deposit_date is not null then 'DEPOSITED' else 'HELD' end;
    update public.pdc_records set status = v_to, cleared_date = null, clear_entry_id = null where id = p.id;
    perform public.pdc_event(p, 'UNDO_CLEAR', v_from, v_to, v_date, p.bank_account_id, p.clear_entry_id, p.amount, v_note);

  elsif v_act = 'BOUNCE' then
    if (p.direction = 'RECEIVED' and p.status <> 'DEPOSITED') or (p.direction = 'ISSUED' and p.status not in ('HELD','DEPOSITED')) then
      raise exception 'Only a presented cheque can bounce (this one is %)', lower(p.status) using errcode = '22023';
    end if;
    v_rel := public.pdc_release_allocations(p);
    v_je := public.acc_reverse_document_entry(p.current_entry_id, 'Cheque ' || p.cheque_no || ' bounced' || coalesce(': ' || nullif(trim(p_data->>'reason'),''), ''), greatest(v_date, p.received_date));
    v_chg := round(coalesce(nullif(p_data->>'bank_charges','')::numeric, 0), 2);
    update public.pdc_records set status = 'BOUNCED', bounced_date = v_date, bounce_reason = nullif(trim(p_data->>'reason'),''), bounce_count = bounce_count + 1, current_entry_id = null where id = p.id;
    v_to := 'BOUNCED';
    perform public.pdc_event(p, 'BOUNCED', v_from, v_to, v_date, p.bank_account_id, v_je, p.amount,
      concat_ws(' · ', nullif(trim(p_data->>'reason'),''), case when v_rel > 0 then 'released ' || v_rel || ' from invoices / bills' end, v_note));
    if v_chg > 0 and p.bank_account_id is not null then
      select * into v_bank from public.bank_accounts where id = p.bank_account_id;
      v_je := public.acc_post_document_entry(p.company_id, 'PAYMENT', v_date, 'Bank charges on bounced cheque ' || p.cheque_no, p.cheque_no, null, null, v_bank.id, v_chg,
        jsonb_build_array(jsonb_build_object('account_id', public.hr_account(p.company_id, 'BANK_CHARGES'), 'debit', v_chg, 'description', 'Bounce charges ' || p.doc_no),
                          jsonb_build_object('account_id', v_bank.gl_account_id, 'credit', v_chg, 'bank_account_id', v_bank.id, 'description', 'Bounce charges ' || p.doc_no)), 'PDC', p.id);
      perform public.pdc_event(p, 'BANK_CHARGES', v_to, v_to, v_date, v_bank.id, v_je, v_chg, null);
    end if;

  elsif v_act = 'REPRESENT' then
    if p.status <> 'BOUNCED' then raise exception 'Only a bounced cheque can be re-presented' using errcode = '22023'; end if;
    v_je := public.pdc_post_main(p, v_date, 'Cheque ' || p.cheque_no || ' re-presented (' || p.doc_no || ')');
    v_to := 'HELD';
    if p.direction = 'RECEIVED' and nullif(p_data->>'bank_account_id','') is not null then
      select * into v_bank from public.bank_accounts where id = (p_data->>'bank_account_id')::uuid and company_id = p.company_id and is_active and currency = 'PKR';
      if v_bank.id is null then raise exception 'Choose a PKR bank account' using errcode = '23502'; end if;
      v_to := 'DEPOSITED';
    end if;
    update public.pdc_records set status = v_to, current_entry_id = v_je, present_count = present_count + 1, cleared_date = null,
      deposit_date = case when v_to = 'DEPOSITED' then v_date when p.direction = 'RECEIVED' then null else deposit_date end,
      bank_account_id = coalesce(v_bank.id, bank_account_id) where id = p.id;
    perform public.pdc_event(p, 'RE_PRESENTED', v_from, v_to, v_date, coalesce(v_bank.id, p.bank_account_id), v_je, p.amount, v_note);

  elsif v_act in ('RETURN','CANCEL') then
    if p.status not in ('HELD','BOUNCED') then raise exception 'Only a cheque in hand (or a bounced one) can be % ', case v_act when 'RETURN' then 'returned' else 'cancelled' end using errcode = '22023'; end if;
    if p.status = 'HELD' then
      v_rel := public.pdc_release_allocations(p);
      v_je := public.acc_reverse_document_entry(p.current_entry_id, case v_act when 'RETURN' then 'Cheque returned' else 'Cheque cancelled' end || coalesce(': ' || v_note, ''), greatest(v_date, p.received_date));
    end if;
    v_to := case v_act when 'RETURN' then 'RETURNED' else 'CANCELLED' end;
    update public.pdc_records set status = v_to, current_entry_id = null where id = p.id;
    perform public.pdc_event(p, v_to, v_from, v_to, v_date, null, v_je, p.amount, v_note);

  elsif v_act = 'NOTE' then
    if v_note is null then raise exception 'Write the note' using errcode = '23502'; end if;
    v_to := p.status;
    perform public.pdc_event(p, 'NOTE', v_from, v_to, v_date, null, null, null, v_note);
  else
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
  return v_to;
end $$;
revoke execute on function public.pdc_action(uuid, text, jsonb) from public, anon;
grant execute on function public.pdc_action(uuid, text, jsonb) to authenticated;

create or replace view public.pdc_records_v with (security_invoker = true) as
select p.*, coalesce(c.name, s.name) as party_name, b.name as bank_name,
  case when p.status = 'HELD' and p.cheque_date <= current_date then true else false end as is_due,
  case when p.status in ('HELD','DEPOSITED') then p.cheque_date - current_date end as days_to_due,
  coalesce(ra.al, sa.al, 0) as allocated
from public.pdc_records p
left join public.customers c on p.party_type = 'CUSTOMER' and c.id = p.party_id
left join public.suppliers s on p.party_type = 'SUPPLIER' and s.id = p.party_id
left join public.bank_accounts b on b.id = p.bank_account_id
left join lateral (select sum(amount) al from public.receipt_allocations where receipt_entry_id = p.current_entry_id and status = 'ACTIVE') ra on p.direction = 'RECEIVED'
left join lateral (select sum(amount) al from public.supplier_bill_allocations where payment_entry_id = p.current_entry_id and status = 'ACTIVE') sa on p.direction = 'ISSUED';
grant select on public.pdc_records_v to authenticated;

-- cheque ↔ invoice / bill links (spec table pdc_allocations)
create or replace view public.pdc_allocations_v with (security_invoker = true) as
select p.id as pdc_id, 'INVOICE' as doc_kind, ra.id as allocation_id, ra.invoice_id as doc_id, i.doc_no, ra.amount, ra.status, ra.created_at
from public.pdc_records p join public.receipt_allocations ra on ra.receipt_entry_id in (select journal_entry_id from public.pdc_events e where e.pdc_id = p.id and e.event in ('RECEIVED','RE_PRESENTED'))
join public.sales_invoices i on i.id = ra.invoice_id
where p.direction = 'RECEIVED'
union all
select p.id, 'BILL', sa.id, sa.bill_id, b.doc_no, sa.amount, sa.status, sa.created_at
from public.pdc_records p join public.supplier_bill_allocations sa on sa.payment_entry_id in (select journal_entry_id from public.pdc_events e where e.pdc_id = p.id and e.event in ('ISSUED','RE_PRESENTED'))
join public.supplier_bills b on b.id = sa.bill_id
where p.direction = 'ISSUED';
grant select on public.pdc_allocations_v to authenticated;

-- attachments on cheques
create or replace function public.attachment_entity_ok(p_entity_type text) returns boolean
language sql immutable set search_path = '' as $$
  select p_entity_type in ('journal_entries','sales_invoices','quotations','sales_orders','gdns','goods_receipts','stock_adjustments',
                           'stock_transfers','stock_counts','assembly_orders','reservation_orders','price_tasks','customers','suppliers','products',
                           'purchase_orders','supplier_bills','purchase_cost_tasks','shipments','landed_costs',
                           'fx_payments','payment_agent_transactions','currency_conversions','pdc_records','bank_statement_imports');
$$;
