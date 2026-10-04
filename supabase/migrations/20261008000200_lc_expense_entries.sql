-- Landed cost can also take expenses already booked (land freight, labour, loading …) from any expense account:
-- the chosen entries are moved from the expense into the goods' cost, and each entry can be used once

alter table public.landed_cost_charges add column if not exists journal_line_id uuid references public.journal_lines(id);
alter table public.landed_cost_charges add column if not exists source_account_id uuid references public.chart_of_accounts(id);

create table if not exists public.landed_cost_line_uses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  journal_line_id uuid not null references public.journal_lines(id),
  charge_id uuid not null references public.landed_cost_charges(id),
  released boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists lclu_once on public.landed_cost_line_uses(journal_line_id) where not released;
alter table public.landed_cost_line_uses enable row level security;
create policy lclu_select on public.landed_cost_line_uses for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));

-- unused expense entries on an account (bills, payment / journal vouchers), newest first
create or replace function public.lc_expense_entries(p_company uuid, p_account_id uuid default null, p_from date default null, p_to date default null)
returns table(journal_line_id uuid, entry_id uuid, entry_no text, entry_date date, entry_type text, source_type text, reference text, description text,
  account_id uuid, account_name text, party_name text, paid_from text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company, 'purchasing.costs');
  return query
  select l.id, e.id, e.entry_no, e.entry_date, e.entry_type, e.source_type, e.reference, coalesce(l.description, e.memo), a.id, a.name,
    coalesce(
      (select s.name from public.suppliers s where s.id = coalesce(l.party_id, e.party_id) and coalesce(l.party_type, e.party_type) = 'SUPPLIER'),
      (select c.name from public.customers c where c.id = coalesce(l.party_id, e.party_id) and coalesce(l.party_type, e.party_type) = 'CUSTOMER'),
      (select sb.name from public.supplier_bills b join public.suppliers sb on sb.id = b.supplier_id where e.source_type = 'SUPPLIER_BILL' and b.id = e.source_id)),
    (select ba.name from public.bank_accounts ba where ba.id = e.bank_account_id),
    l.debit - l.credit
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.chart_of_accounts a on a.id = l.account_id
  where l.company_id = p_company and e.status = 'POSTED' and e.reversal_of is null and a.account_type = 'EXPENSE'
    and a.system_key is distinct from 'COGS' and coalesce(e.source_type, '') not in ('STOCK_VALUE','LANDED_COST')
    and (p_account_id is null or l.account_id = p_account_id)
    and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
    and l.debit - l.credit > 0
    and not exists (select 1 from public.landed_cost_line_uses u where u.journal_line_id = l.id and not u.released)
  order by e.entry_date desc, e.entry_no desc
  limit 300;
end $$;

create or replace function public.save_landed_cost(p_id uuid, p_header jsonb, p_targets uuid[], p_charges jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_id uuid; h record; v_ship uuid := nullif(p_header->>'shipment_id','')::uuid; x jsonb; n int := 0;
  v_targets uuid[] := coalesce(p_targets, '{}'); v_cur text; v_fx numeric; v_amt numeric; v_payee text; v_treat text; v_acc record;
  e_id uuid; e_company uuid; e_status text; e_payee text; e_settled uuid; e_treat text; e_acc uuid; ic public.import_costs; jl record; v_src_acc uuid; v_jl_id uuid;
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
    ic := null; v_src_acc := null; v_jl_id := null;
    if nullif(x->>'journal_line_id','') is not null then
      select l.id, l.account_id, l.debit - l.credit amt, e.status, e.reversal_of, a.account_type into jl
        from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.chart_of_accounts a on a.id = l.account_id
       where l.id = (x->>'journal_line_id')::uuid and l.company_id = v_company;
      if jl.id is null or jl.status <> 'POSTED' or jl.reversal_of is not null or jl.amt <= 0 or jl.account_type <> 'EXPENSE' then
        raise exception 'Charge %: that expense entry cannot be used', n using errcode = '22023';
      end if;
      if exists (select 1 from public.landed_cost_line_uses u where u.journal_line_id = jl.id and not u.released) then
        raise exception 'Charge %: that expense entry is already on a posted landed cost', n using errcode = '22023';
      end if;
      v_payee := 'BILLED'; v_cur := 'PKR'; v_fx := 1; v_amt := jl.amt; v_src_acc := jl.account_id; v_jl_id := jl.id;
    end if;
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
      currency, fx_rate, amount, amount_pkr, treatment, expense_account_id, method, manual, settles_charge_id, import_cost_id, journal_line_id, source_account_id)
    values (v_company, v_id, n, coalesce(nullif(x->>'component',''), 'OTHER'), nullif(trim(x->>'description'),''), v_payee,
      case when v_payee = 'SUPPLIER' then (x->>'supplier_id')::uuid end, case when v_payee = 'BANK' then (x->>'bank_account_id')::uuid end,
      nullif(trim(x->>'reference'),''), v_cur, v_fx, v_amt, round(v_amt * v_fx, 2), v_treat,
      case when v_treat = 'EXPENSE' then coalesce(nullif(x->>'expense_account_id','')::uuid, e_acc) end,
      coalesce(nullif(x->>'method',''), 'VALUE'), coalesce(x->'manual', '{}'::jsonb), nullif(x->>'settles_charge_id','')::uuid, ic.id, v_jl_id, v_src_acc);
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
    elsif ch.payee_type = 'BILLED' and ch.journal_line_id is not null then
      -- an expense already booked (land freight, labour …): moved from that expense account into the goods' cost
      begin
        insert into public.landed_cost_line_uses(company_id, journal_line_id, charge_id) values (h.company_id, ch.journal_line_id, ch.id);
      exception when unique_violation then
        raise exception '% — that expense entry is already on another landed cost', v_lbl using errcode = '22023';
      end;
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', ch.source_account_id, 'amount', -ch.amount_pkr, 'description', 'Moved to stock cost: ' || v_lbl));
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
  update public.landed_cost_line_uses set released = true where charge_id in (select id from public.landed_cost_charges where landed_cost_id = p_id) and not released;
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

revoke all on function public.lc_expense_entries(uuid,uuid,date,date) from anon;
