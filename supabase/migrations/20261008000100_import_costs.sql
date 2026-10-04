-- Import costs recorded as they happen (forwarder bills, bank payments), tagged with a shipment, picked into landed cost later

alter table public.supplier_bills add column if not exists shipment_id uuid references public.shipments(id);

create table if not exists public.import_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  shipment_id uuid references public.shipments(id),
  component text not null default 'OTHER' check (component in ('FREIGHT','INSURANCE','CUSTOMS','CLEARING','PORT','BANK','OTHER')),
  description text,
  source_type text not null check (source_type in ('BILL','PAYMENT')),
  bill_id uuid references public.supplier_bills(id),
  bill_line_id uuid references public.supplier_bill_lines(id),
  journal_entry_id uuid references public.journal_entries(id),
  supplier_id uuid references public.suppliers(id),
  bank_account_id uuid references public.bank_accounts(id),
  reference text,
  cost_date date not null,
  currency text not null default 'PKR',
  amount numeric not null,
  amount_pkr numeric not null,
  status text not null default 'OPEN' check (status in ('OPEN','USED','CANCELLED')),
  used_charge_id uuid references public.landed_cost_charges(id),
  cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index if not exists ic_company on public.import_costs(company_id, status, shipment_id);
create index if not exists ic_bill on public.import_costs(bill_id);
alter table public.import_costs enable row level security;
create policy ic_select on public.import_costs for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));
create trigger audit after insert or update on public.import_costs for each row execute function public.tg_audit_row();

alter table public.landed_cost_charges add column if not exists import_cost_id uuid references public.import_costs(id);

-- a posted supplier bill with lines on "Landed Cost Clearing" = recorded import costs; reversed bill = cancelled
create or replace function public.tg_bill_import_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_clear uuid; l record; u record;
begin
  select id into v_clear from public.chart_of_accounts where company_id = new.company_id and system_key = 'LANDED_COST_CLEARING' and is_active limit 1;
  if v_clear is null then return null; end if;
  if new.status = 'POSTED' and old.status = 'DRAFT' then
    for l in select * from public.supplier_bill_lines where bill_id = new.id and kind = 'EXPENSE' and account_id = v_clear order by line_no loop
      insert into public.import_costs(company_id, shipment_id, component, description, source_type, bill_id, bill_line_id, supplier_id, reference, cost_date, currency, amount, amount_pkr)
      values (new.company_id, new.shipment_id, 'OTHER', l.description, 'BILL', new.id, l.id, new.supplier_id, new.supplier_invoice_no, new.bill_date, new.currency,
        round(l.amount_pkr / new.fx_rate, 2), l.amount_pkr);
    end loop;
  elsif new.status = 'REVERSED' and old.status = 'POSTED' then
    select ic.id, lc.doc_no into u from public.import_costs ic join public.landed_cost_charges ch on ch.id = ic.used_charge_id join public.landed_costs lc on lc.id = ch.landed_cost_id
     where ic.bill_id = new.id and ic.status = 'USED' limit 1;
    if u.id is not null then raise exception 'This bill''s import cost is on landed cost % — reverse that first', u.doc_no using errcode = '22023'; end if;
    update public.import_costs set status = 'CANCELLED', cancel_reason = 'Bill reversed' where bill_id = new.id and status = 'OPEN';
  end if;
  return null;
end $$;
create trigger bill_import_costs after update of status on public.supplier_bills for each row execute function public.tg_bill_import_costs();

-- which shipment a bill's import costs are for (draft or posted)
create or replace function public.set_bill_shipment(p_bill_id uuid, p_shipment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.supplier_bills;
begin
  select * into b from public.supplier_bills where id = p_bill_id for update;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform public.inv_require(b.company_id, 'purchasing.manage');
  if p_shipment_id is not null and not exists (select 1 from public.shipments where id = p_shipment_id and company_id = b.company_id) then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  update public.supplier_bills set shipment_id = p_shipment_id, updated_at = now() where id = p_bill_id;
  update public.import_costs set shipment_id = p_shipment_id where bill_id = p_bill_id and status = 'OPEN';
end $$;

-- record a cost now: a forwarder / agent bill (payable) or a payment from bank / cash; both go to Landed Cost Clearing
-- p_data: {shipment_id, component, description, payee_type: SUPPLIER|BANK, supplier_id, bank_account_id, reference, currency, fx_rate, amount, cost_date}
create or replace function public.record_import_cost(p_company uuid, p_data jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_clear uuid := public.hr_account(p_company, 'LANDED_COST_CLEARING'); v_ship uuid := nullif(p_data->>'shipment_id','')::uuid;
  v_payee text := coalesce(nullif(p_data->>'payee_type',''), 'SUPPLIER'); v_cur text := coalesce(nullif(upper(trim(p_data->>'currency')),''), 'PKR');
  v_fx numeric; v_amt numeric := nullif(p_data->>'amount','')::numeric; v_date date := coalesce(nullif(p_data->>'cost_date','')::date, current_date);
  v_comp text := coalesce(nullif(p_data->>'component',''), 'OTHER'); v_desc text; v_bill uuid; v_je uuid; v_id uuid; b record; v_ship_no text;
begin
  perform public.inv_require(p_company, 'purchasing.costs');
  if v_comp not in ('FREIGHT','INSURANCE','CUSTOMS','CLEARING','PORT','BANK','OTHER') then raise exception 'Unknown cost type' using errcode = '22023'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Enter the amount' using errcode = '23502'; end if;
  if v_ship is not null then
    select doc_no into v_ship_no from public.shipments where id = v_ship and company_id = p_company;
    if v_ship_no is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  end if;
  v_desc := coalesce(nullif(trim(p_data->>'description'),''), initcap(lower(v_comp))) || coalesce(' — ' || v_ship_no, '');
  if v_payee = 'SUPPLIER' then
    perform public.inv_require(p_company, 'purchasing.approve');
    if nullif(p_data->>'supplier_id','') is null then raise exception 'Choose who billed it (forwarder / clearing agent)' using errcode = '23502'; end if;
    v_fx := case when v_cur = 'PKR' then 1 else coalesce(nullif(p_data->>'fx_rate','')::numeric, 0) end;
    if v_fx <= 0 then raise exception 'Enter the exchange rate' using errcode = '23502'; end if;
    v_bill := public.save_supplier_bill(null, jsonb_build_object('company_id', p_company, 'supplier_id', p_data->>'supplier_id', 'bill_date', v_date,
        'supplier_invoice_no', nullif(trim(p_data->>'reference'),''), 'currency', v_cur, 'fx_rate', v_fx, 'notes', 'Import cost' || coalesce(' — ' || v_ship_no, '')),
      jsonb_build_array(jsonb_build_object('kind', 'EXPENSE', 'account_id', v_clear, 'quantity', 1, 'unit_price', v_amt, 'description', v_desc)), p_idempotency_key);
    update public.supplier_bills set shipment_id = v_ship where id = v_bill;
    perform public.post_supplier_bill(v_bill, null);
    update public.import_costs set component = v_comp, description = v_desc where bill_id = v_bill returning id into v_id;
    return v_id;
  elsif v_payee = 'BANK' then
    perform public.inv_require(p_company, 'journals.create');
    if v_cur <> 'PKR' then raise exception 'A payment from bank / cash is entered in PKR' using errcode = '22023'; end if;
    select * into b from public.bank_accounts where id = nullif(p_data->>'bank_account_id','')::uuid and company_id = p_company and is_active;
    if b.id is null then raise exception 'Choose the bank / cash account it was paid from' using errcode = '23502'; end if;
    v_je := public.acc_post_document_entry(p_company, 'PAYMENT', v_date, v_desc, nullif(trim(p_data->>'reference'),''), null, null, b.id, v_amt,
      jsonb_build_array(
        jsonb_build_object('account_id', v_clear, 'debit', v_amt, 'description', v_desc),
        jsonb_build_object('account_id', b.gl_account_id, 'credit', v_amt, 'bank_account_id', b.id, 'description', v_desc)),
      'IMPORT_COST', v_ship);
    insert into public.import_costs(company_id, shipment_id, component, description, source_type, journal_entry_id, bank_account_id, reference, cost_date, currency, amount, amount_pkr)
    values (p_company, v_ship, v_comp, v_desc, 'PAYMENT', v_je, b.id, nullif(trim(p_data->>'reference'),''), v_date, 'PKR', v_amt, v_amt) returning id into v_id;
    return v_id;
  end if;
  raise exception 'Choose how it was paid' using errcode = '22023';
end $$;

-- change type / description / shipment of a recorded cost that is not used yet
create or replace function public.update_import_cost(p_id uuid, p_shipment_id uuid, p_component text, p_description text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.import_costs;
begin
  select * into r from public.import_costs where id = p_id for update;
  if r.id is null then raise exception 'Cost not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'purchasing.costs');
  if r.status <> 'OPEN' then raise exception 'Only an unused cost can be changed' using errcode = '22023'; end if;
  if p_component not in ('FREIGHT','INSURANCE','CUSTOMS','CLEARING','PORT','BANK','OTHER') then raise exception 'Unknown cost type' using errcode = '22023'; end if;
  update public.import_costs set shipment_id = p_shipment_id, component = p_component, description = nullif(trim(p_description),'') where id = p_id;
  if r.bill_id is not null then update public.supplier_bills set shipment_id = p_shipment_id where id = r.bill_id; end if;
end $$;

-- cancel a recorded cost that was not used: the bill / payment is reversed
create or replace function public.cancel_import_cost(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.import_costs;
begin
  select * into r from public.import_costs where id = p_id for update;
  if r.id is null then raise exception 'Cost not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'purchasing.approve');
  if r.status <> 'OPEN' then raise exception 'Only an unused cost can be cancelled' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  if r.bill_id is not null then
    perform public.reverse_supplier_bill(r.bill_id, trim(p_reason), current_date);   -- its trigger cancels the cost
  else
    perform public.acc_reverse_document_entry(r.journal_entry_id, trim(p_reason), current_date);
    update public.import_costs set status = 'CANCELLED', cancel_reason = trim(p_reason) where id = p_id;
  end if;
end $$;

create or replace function public.save_landed_cost(p_id uuid, p_header jsonb, p_targets uuid[], p_charges jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_id uuid; h record; v_ship uuid := nullif(p_header->>'shipment_id','')::uuid; x jsonb; n int := 0;
  v_targets uuid[] := coalesce(p_targets, '{}'); v_cur text; v_fx numeric; v_amt numeric; v_payee text; v_treat text; v_acc record;
  e_id uuid; e_company uuid; e_status text; e_payee text; e_settled uuid; e_treat text; e_acc uuid; ic public.import_costs;
begin
  perform public.inv_require(v_company, 'purchasing.manage');
  perform public.inv_require(v_company, 'purchasing.costs');
  if v_ship is not null and not exists (select 1 from public.shipments where id = v_ship and company_id = v_company) then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.landed_costs where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.landed_costs(company_id, doc_no, doc_date, shipment_id, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'LANDED_COST'), coalesce(nullif(p_header->>'doc_date','')::date, current_date), v_ship,
      nullif(trim(p_header->>'notes'),''), p_idempotency_key) returning id into v_id;
  else
    select * into h from public.landed_costs where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Landed cost not found' using errcode = 'P0002'; end if;
    if h.status <> 'DRAFT' then raise exception 'Only a draft can be edited' using errcode = '22023'; end if;
    update public.landed_costs set doc_date = coalesce(nullif(p_header->>'doc_date','')::date, doc_date), shipment_id = v_ship, notes = nullif(trim(p_header->>'notes'),''),
      updated_at = now(), updated_by = auth.uid() where id = p_id;
    v_id := p_id;
  end if;

  -- goods it is for
  if array_length(v_targets, 1) is null and v_ship is not null then
    select coalesce(array_agg(l.id), '{}') into v_targets from public.goods_receipt_lines l join public.goods_receipts g on g.id = l.receipt_id
     where g.shipment_id = v_ship and g.status = 'POSTED';
  end if;
  if exists (select 1 from unnest(v_targets) u left join public.goods_receipt_lines l on l.id = u left join public.goods_receipts g on g.id = l.receipt_id
             where g.id is null or g.company_id <> v_company or g.status <> 'POSTED') then
    raise exception 'Landed cost can only be added to posted goods receipts' using errcode = '22023';
  end if;
  update public.landed_cost_targets set is_active = (receipt_line_id = any(v_targets)) where landed_cost_id = v_id;
  insert into public.landed_cost_targets(company_id, landed_cost_id, receipt_line_id)
  select v_company, v_id, u from unnest(v_targets) u on conflict (landed_cost_id, receipt_line_id) do update set is_active = true;

  -- charges (replaced on every save of a draft)
  update public.landed_cost_charges set is_active = false where landed_cost_id = v_id;
  for x in select * from jsonb_array_elements(coalesce(p_charges, '[]'::jsonb)) loop
    n := n + 1;
    v_payee := coalesce(nullif(x->>'payee_type',''), 'SUPPLIER');
    v_treat := coalesce(nullif(x->>'treatment',''), 'CAPITALIZE');
    v_cur := coalesce(nullif(upper(trim(x->>'currency')),''), 'PKR');
    v_fx := case when v_cur = 'PKR' then 1 else coalesce(nullif(x->>'fx_rate','')::numeric, 0) end;
    v_amt := nullif(x->>'amount','')::numeric;
    ic := null;
    if nullif(x->>'import_cost_id','') is not null then
      select * into ic from public.import_costs where id = (x->>'import_cost_id')::uuid and company_id = v_company;
      if ic.id is null or ic.status = 'CANCELLED' then raise exception 'Charge %: the recorded cost is not available', n using errcode = '22023'; end if;
      if ic.status = 'USED' then raise exception 'Charge %: that recorded cost is already on another posted landed cost', n using errcode = '22023'; end if;
      v_payee := 'BILLED'; v_cur := 'PKR'; v_fx := 1; v_amt := ic.amount_pkr;
    end if;
    if v_amt is null or v_amt < 0 then raise exception 'Charge %: enter the amount', n using errcode = '23502'; end if;
    if v_fx <= 0 then raise exception 'Charge %: enter the exchange rate', n using errcode = '23502'; end if;
    if v_payee = 'SUPPLIER' and nullif(x->>'supplier_id','') is null then raise exception 'Charge %: choose who billed it (forwarder / clearing agent)', n using errcode = '23502'; end if;
    if v_payee = 'BANK' and nullif(x->>'bank_account_id','') is null then raise exception 'Charge %: choose the bank / cash account it was paid from', n using errcode = '23502'; end if;
    if v_payee = 'BANK' and v_cur <> 'PKR' then raise exception 'Charge %: paid from bank — enter it in PKR', n using errcode = '22023'; end if;
    e_id := null; e_acc := null;
    if nullif(x->>'settles_charge_id','') is not null then
      select c.id, c.company_id, l.status, c.payee_type, c.settled_by, c.treatment, c.expense_account_id into e_id, e_company, e_status, e_payee, e_settled, e_treat, e_acc
        from public.landed_cost_charges c join public.landed_costs l on l.id = c.landed_cost_id where c.id = (x->>'settles_charge_id')::uuid;
      if e_id is null or e_company <> v_company or e_status <> 'POSTED' or e_payee <> 'ESTIMATE' or e_settled is not null then
        raise exception 'Charge %: the estimate it replaces is not open', n using errcode = '22023';
      end if;
      if v_payee = 'ESTIMATE' then raise exception 'Charge %: an actual charge cannot be an estimate', n using errcode = '22023'; end if;
      v_treat := e_treat;
    end if;
    if v_treat = 'EXPENSE' then
      select * into v_acc from public.chart_of_accounts where id = coalesce(nullif(x->>'expense_account_id','')::uuid, e_acc) and company_id = v_company;
      if v_acc.id is null or v_acc.is_group then raise exception 'Charge %: choose the expense account', n using errcode = '23502'; end if;
    end if;
    insert into public.landed_cost_charges(company_id, landed_cost_id, line_no, component, description, payee_type, supplier_id, bank_account_id, reference,
      currency, fx_rate, amount, amount_pkr, treatment, expense_account_id, method, manual, settles_charge_id, import_cost_id)
    values (v_company, v_id, n, coalesce(nullif(x->>'component',''), 'OTHER'), nullif(trim(x->>'description'),''), v_payee,
      case when v_payee = 'SUPPLIER' then (x->>'supplier_id')::uuid end, case when v_payee = 'BANK' then (x->>'bank_account_id')::uuid end,
      nullif(trim(x->>'reference'),''), v_cur, v_fx, v_amt, round(v_amt * v_fx, 2), v_treat,
      case when v_treat = 'EXPENSE' then coalesce(nullif(x->>'expense_account_id','')::uuid, e_acc) end,
      coalesce(nullif(x->>'method',''), 'VALUE'), coalesce(x->'manual', '{}'::jsonb), nullif(x->>'settles_charge_id','')::uuid, ic.id);
  end loop;
  return v_id;
end $$;

create or replace function public.post_landed_cost(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h public.landed_costs; ch record; a record; v_bill uuid; v_clear uuid; v_inv_acc uuid; v_jl jsonb := '[]'::jsonb; v_je uuid; v_cogs numeric; v_cogs_total numeric := 0;
  v_inv_total numeric := 0; e_id uuid; e_amt numeric; e_treat text; e_acc uuid; e_settled uuid; v_bank record; v_lbl text; r jsonb; v_out jsonb := '[]'::jsonb; v_dr numeric; v_cr numeric;
begin
  select * into h from public.landed_costs where id = p_id for update;
  if h.id is null then raise exception 'Landed cost not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.approve');
  perform public.inv_require(h.company_id, 'purchasing.costs');
  if h.status = 'POSTED' then return h.journal_entry_id; end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % landed cost', lower(h.status) using errcode = '22023'; end if;
  if not exists (select 1 from public.landed_cost_charges where landed_cost_id = p_id and is_active) then raise exception 'Add at least one charge' using errcode = '23502'; end if;
  v_clear := public.hr_account(h.company_id, 'LANDED_COST_CLEARING');
  v_inv_acc := public.hr_account(h.company_id, 'INVENTORY');

  -- allocations
  insert into public.landed_cost_allocations(company_id, landed_cost_id, charge_id, receipt_line_id, amount_pkr)
  select h.company_id, p_id, x.charge_id, x.receipt_line_id, x.amount_pkr from public.lc_allocate(p_id) x where x.amount_pkr <> 0;

  for ch in select * from public.landed_cost_charges where landed_cost_id = p_id and is_active order by line_no loop
    v_lbl := coalesce(ch.description, initcap(lower(ch.component))) || coalesce(' / ' || ch.reference, '');
    e_id := null; e_amt := null; e_treat := null; e_acc := null; e_settled := null;
    if ch.settles_charge_id is not null then
      select id, amount_pkr, treatment, expense_account_id, settled_by into e_id, e_amt, e_treat, e_acc, e_settled from public.landed_cost_charges where id = ch.settles_charge_id for update;
      if e_settled is not null then raise exception '% — the estimate was already replaced', v_lbl using errcode = '22023'; end if;
    end if;

    -- who is owed / what paid it (credit side)
    if ch.payee_type = 'SUPPLIER' then
      v_bill := public.save_supplier_bill(null, jsonb_build_object('company_id', h.company_id, 'supplier_id', ch.supplier_id, 'bill_date', h.doc_date,
          'supplier_invoice_no', ch.reference, 'currency', ch.currency, 'fx_rate', ch.fx_rate, 'notes', 'Landed cost ' || h.doc_no),
        jsonb_build_array(jsonb_build_object('kind', 'EXPENSE',
          'account_id', case when ch.treatment = 'EXPENSE' and e_id is null then ch.expense_account_id else v_clear end,
          'quantity', 1, 'unit_price', ch.amount, 'description', v_lbl)), null);
      perform public.post_supplier_bill(v_bill, null);
      update public.landed_cost_charges set bill_id = v_bill where id = ch.id;
      update public.import_costs set status = 'USED', used_charge_id = ch.id, shipment_id = coalesce(shipment_id, h.shipment_id) where bill_id = v_bill;
      if ch.treatment = 'EXPENSE' and e_id is null then continue; end if;   -- the bill already put it on the expense account
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_clear, 'amount', -ch.amount_pkr, 'description', v_lbl));
    elsif ch.payee_type = 'BILLED' then
      if ch.import_cost_id is not null then
        update public.import_costs set status = 'USED', used_charge_id = ch.id, shipment_id = coalesce(shipment_id, h.shipment_id)
         where id = ch.import_cost_id and status = 'OPEN';
        if not found then raise exception '% — that recorded cost was already used or cancelled', v_lbl using errcode = '22023'; end if;
      end if;
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_clear, 'amount', -ch.amount_pkr, 'description', v_lbl));
    elsif ch.payee_type = 'BANK' then
      select * into v_bank from public.bank_accounts where id = ch.bank_account_id and company_id = h.company_id;
      if v_bank.id is null then raise exception '%: bank account not found', v_lbl using errcode = 'P0002'; end if;
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_bank.gl_account_id, 'amount', -ch.amount_pkr, 'bank_account_id', v_bank.id, 'description', v_lbl));
    else
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'LANDED_COST_ACCRUAL'), 'amount', -ch.amount_pkr, 'description', 'Estimate: ' || v_lbl));
    end if;

    -- where it goes (debit side)
    if e_id is not null then
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'LANDED_COST_ACCRUAL'), 'amount', e_amt, 'description', 'Estimate replaced: ' || v_lbl));
      if e_treat = 'EXPENSE' and ch.amount_pkr <> e_amt then
        v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', e_acc, 'amount', ch.amount_pkr - e_amt, 'description', 'Actual vs estimate: ' || v_lbl));
      end if;
      update public.landed_cost_charges set settled_by = ch.id where id = e_id;
    elsif ch.treatment = 'EXPENSE' then
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', ch.expense_account_id, 'amount', ch.amount_pkr, 'description', v_lbl));
    end if;
  end loop;

  -- capitalized: onto the goods (the part for goods already sold goes to cost of sales)
  for a in select al.*, l.product_id, l.variant_id, l.quantity from public.landed_cost_allocations al join public.goods_receipt_lines l on l.id = al.receipt_line_id
           where al.landed_cost_id = p_id order by al.receipt_line_id loop
    v_cogs := public.inv_value_in(h.company_id, a.product_id, a.variant_id, 'REVALUE', a.quantity, a.amount_pkr, h.doc_date, 'LANDED_COST', p_id, 'Landed cost ' || h.doc_no, false);
    update public.landed_cost_allocations set to_inventory = a.amount_pkr - v_cogs where id = a.id;
    update public.goods_receipt_lines set landed_cost_pkr = landed_cost_pkr + a.amount_pkr where id = a.receipt_line_id;
    v_cogs_total := v_cogs_total + v_cogs;
    v_inv_total := v_inv_total + (a.amount_pkr - v_cogs);
  end loop;
  if v_inv_total <> 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_inv_acc, 'amount', v_inv_total, 'description', 'Landed cost added to stock ' || h.doc_no)); end if;
  if v_cogs_total <> 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'COGS'), 'amount', v_cogs_total, 'description', 'Landed cost of goods already sold ' || h.doc_no)); end if;

  -- signed amounts → debit / credit, one line per account
  for r in select jsonb_build_object('account_id', x->>'account_id', 'bank_account_id', x->>'bank_account_id', 'description', min(x->>'description'), 'amount', round(sum((x->>'amount')::numeric), 2)) j
             from jsonb_array_elements(v_jl) x group by x->>'account_id', x->>'bank_account_id' loop
    if (r->>'amount')::numeric = 0 then continue; end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('account_id', r->>'account_id', 'bank_account_id', r->>'bank_account_id', 'description', r->>'description',
      'debit', case when (r->>'amount')::numeric > 0 then (r->>'amount')::numeric end, 'credit', case when (r->>'amount')::numeric < 0 then -(r->>'amount')::numeric end)));
  end loop;
  select coalesce(sum((x->>'debit')::numeric), 0), coalesce(sum((x->>'credit')::numeric), 0) into v_dr, v_cr from jsonb_array_elements(v_out) x;
  if round(v_dr - v_cr, 2) <> 0 then raise exception 'Landed cost does not balance (% / %)', v_dr, v_cr using errcode = '23514'; end if;
  if jsonb_array_length(v_out) > 0 then
    v_je := public.acc_post_document_entry(h.company_id, 'SYSTEM', h.doc_date, 'Landed cost ' || h.doc_no, h.doc_no, null, null, null, v_dr, v_out, 'LANDED_COST', h.id);
  end if;
  update public.landed_costs set status = 'POSTED', journal_entry_id = v_je, posted_at = now(), posted_by = auth.uid(), updated_at = now() where id = p_id;
  return v_je;
end $$;

create or replace function public.reverse_landed_cost(p_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.landed_costs; ch record; a record; d date := coalesce(p_date, current_date);
begin
  select * into h from public.landed_costs where id = p_id for update;
  if h.id is null then raise exception 'Landed cost not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.approve');
  if h.status <> 'POSTED' then raise exception 'Only a posted landed cost can be reversed' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  if exists (select 1 from public.landed_cost_charges c join public.landed_cost_charges s on s.id = c.settled_by join public.landed_costs l on l.id = s.landed_cost_id
             where c.landed_cost_id = p_id and l.status = 'POSTED') then
    raise exception 'An estimate on this landed cost was already replaced by the actual charge — reverse that one first' using errcode = '22023';
  end if;
  if h.journal_entry_id is not null then perform public.acc_reverse_document_entry(h.journal_entry_id, trim(p_reason), d); end if;
  -- recorded costs it used become free again (the ones from its own bills are cancelled with the bills)
  update public.import_costs set status = 'OPEN', used_charge_id = null
   where used_charge_id in (select id from public.landed_cost_charges where landed_cost_id = p_id);
  for ch in select * from public.landed_cost_charges where landed_cost_id = p_id and is_active loop
    if ch.bill_id is not null then perform public.reverse_supplier_bill(ch.bill_id, 'Landed cost ' || h.doc_no || ' reversed: ' || trim(p_reason), d); end if;
    if ch.settles_charge_id is not null then update public.landed_cost_charges set settled_by = null where id = ch.settles_charge_id; end if;
  end loop;
  for a in select al.*, l.product_id, l.variant_id, l.quantity from public.landed_cost_allocations al join public.goods_receipt_lines l on l.id = al.receipt_line_id
           where al.landed_cost_id = p_id and not al.reversed loop
    perform public.inv_value_in(h.company_id, a.product_id, a.variant_id, 'REVALUE', a.quantity, -coalesce(a.to_inventory, a.amount_pkr), d, 'LANDED_COST', p_id, 'Landed cost ' || h.doc_no || ' reversed', true);
    update public.goods_receipt_lines set landed_cost_pkr = landed_cost_pkr - a.amount_pkr where id = a.receipt_line_id;
    update public.landed_cost_allocations set reversed = true where id = a.id;
  end loop;
  update public.landed_costs set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason), updated_at = now() where id = p_id;
end $$;

revoke all on function public.set_bill_shipment(uuid,uuid), public.record_import_cost(uuid,jsonb,uuid), public.update_import_cost(uuid,uuid,text,text),
  public.cancel_import_cost(uuid,text) from anon;
