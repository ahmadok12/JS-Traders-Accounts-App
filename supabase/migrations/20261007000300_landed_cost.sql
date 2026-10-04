-- Stage 8 (part 3) — landed cost: freight, insurance, customs, clearing, port and bank charges added to the cost of received goods

-- ───────── landed cost ─────────
create table if not exists public.landed_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  doc_date date not null default current_date,
  shipment_id uuid references public.shipments(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','POSTED','REVERSED','CANCELLED')),
  notes text,
  journal_entry_id uuid references public.journal_entries(id),
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists lc_company on public.landed_costs(company_id, status, doc_date desc);
create index if not exists lc_shipment on public.landed_costs(shipment_id);
alter table public.landed_costs enable row level security;
create policy lc_select on public.landed_costs for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));
create trigger audit after insert or update on public.landed_costs for each row execute function public.tg_audit_row();

create table if not exists public.landed_cost_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  landed_cost_id uuid not null references public.landed_costs(id),
  receipt_line_id uuid not null references public.goods_receipt_lines(id),
  is_active boolean not null default true,
  unique (landed_cost_id, receipt_line_id)
);
alter table public.landed_cost_targets enable row level security;
create policy lct_select on public.landed_cost_targets for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));

create table if not exists public.landed_cost_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  landed_cost_id uuid not null references public.landed_costs(id),
  line_no int not null,
  component text not null check (component in ('FREIGHT','INSURANCE','CUSTOMS','CLEARING','PORT','BANK','OTHER')),
  description text,
  payee_type text not null check (payee_type in ('SUPPLIER','BANK','BILLED','ESTIMATE')),
  supplier_id uuid references public.suppliers(id),
  bank_account_id uuid references public.bank_accounts(id),
  reference text,
  currency text not null default 'PKR',
  fx_rate numeric not null default 1 check (fx_rate > 0),
  amount numeric not null check (amount >= 0),
  amount_pkr numeric not null,
  treatment text not null default 'CAPITALIZE' check (treatment in ('CAPITALIZE','EXPENSE')),
  expense_account_id uuid references public.chart_of_accounts(id),
  method text not null default 'VALUE' check (method in ('VALUE','WEIGHT','QUANTITY','VOLUME','PERCENT','MANUAL')),
  manual jsonb not null default '{}'::jsonb,       -- {receipt_line_id: percent or amount}
  settles_charge_id uuid references public.landed_cost_charges(id),   -- the estimate this actual charge replaces
  settled_by uuid references public.landed_cost_charges(id),
  bill_id uuid references public.supplier_bills(id),
  is_active boolean not null default true
);
create index if not exists lcc_lc on public.landed_cost_charges(landed_cost_id);
alter table public.landed_cost_charges enable row level security;
create policy lcc_select on public.landed_cost_charges for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));

create table if not exists public.landed_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  landed_cost_id uuid not null references public.landed_costs(id),
  charge_id uuid not null references public.landed_cost_charges(id),
  receipt_line_id uuid not null references public.goods_receipt_lines(id),
  amount_pkr numeric not null,
  to_inventory numeric,
  reversed boolean not null default false
);
create index if not exists lca_lc on public.landed_cost_allocations(landed_cost_id);
create index if not exists lca_line on public.landed_cost_allocations(receipt_line_id);
alter table public.landed_cost_allocations enable row level security;
create policy lca_select on public.landed_cost_allocations for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));

-- what each receipt line looks like for allocation: quantity, value, weight, volume
create or replace function public.lc_target_bases(p_landed_cost_id uuid)
returns table(receipt_line_id uuid, receipt_no text, product_id uuid, variant_id uuid, quantity numeric, unit_cost_pkr numeric, value_pkr numeric, weight_kg numeric, cbm numeric, landed_pkr numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, g.doc_no, l.product_id, l.variant_id, l.quantity, l.unit_cost_pkr, round(l.quantity * coalesce(l.unit_cost_pkr, 0), 2),
    coalesce((select sum(sl.weight_kg * k.quantity / sl.quantity) from public.goods_receipt_shipment_links k join public.shipment_lines sl on sl.id = k.shipment_line_id
              where k.receipt_line_id = l.id and not k.reversed and sl.weight_kg is not null),
             l.quantity * (select coalesce(v.weight_kg, p.weight_kg) from public.products p left join public.product_variants v on v.id = l.variant_id where p.id = l.product_id), 0),
    coalesce((select sum(sl.cbm * k.quantity / sl.quantity) from public.goods_receipt_shipment_links k join public.shipment_lines sl on sl.id = k.shipment_line_id
              where k.receipt_line_id = l.id and not k.reversed and sl.cbm is not null), 0),
    l.landed_cost_pkr
  from public.landed_cost_targets t join public.goods_receipt_lines l on l.id = t.receipt_line_id join public.goods_receipts g on g.id = l.receipt_id
  where t.landed_cost_id = p_landed_cost_id and t.is_active;
$$;

-- the split of every charge over the goods (not saved; post_landed_cost saves it)
create or replace function public.lc_allocate(p_landed_cost_id uuid)
returns table(charge_id uuid, receipt_line_id uuid, amount_pkr numeric)
language plpgsql stable security definer set search_path = '' as $$
declare ch record; t record; v_sum numeric; v_left numeric; v_n int; i int; v_amt numeric; v_alloc numeric; v_est record; v_lbl text;
begin
  for ch in select c.* from public.landed_cost_charges c where c.landed_cost_id = p_landed_cost_id and c.is_active order by c.line_no loop
    v_lbl := coalesce(ch.description, initcap(lower(ch.component)));
    if ch.settles_charge_id is not null then
      -- actual replacing an estimate: only the difference moves, spread like the estimate was
      select * into v_est from public.landed_cost_charges where id = ch.settles_charge_id;
      if v_est.treatment <> 'CAPITALIZE' then continue; end if;
      v_alloc := ch.amount_pkr - v_est.amount_pkr;
      if v_alloc = 0 then continue; end if;
      select count(*), coalesce(sum(a.amount_pkr), 0) into v_n, v_sum from public.landed_cost_allocations a where a.charge_id = v_est.id and not a.reversed;
      v_left := v_alloc; i := 0;
      for t in select a.receipt_line_id rl, a.amount_pkr amt from public.landed_cost_allocations a where a.charge_id = v_est.id and not a.reversed order by a.receipt_line_id loop
        i := i + 1;
        v_amt := case when i = v_n then v_left else round(v_alloc * t.amt / nullif(v_sum, 0), 2) end;
        v_left := v_left - v_amt;
        charge_id := ch.id; receipt_line_id := t.rl; amount_pkr := v_amt; return next;
      end loop;
      continue;
    end if;
    if ch.treatment <> 'CAPITALIZE' or ch.amount_pkr = 0 then continue; end if;
    select count(*),
      coalesce(sum(case ch.method when 'VALUE' then b.value_pkr when 'WEIGHT' then b.weight_kg when 'QUANTITY' then b.quantity when 'VOLUME' then b.cbm
        else coalesce(nullif(ch.manual->>(b.receipt_line_id::text),'')::numeric, 0) end), 0)
      into v_n, v_sum from public.lc_target_bases(p_landed_cost_id) b;
    if v_n = 0 then raise exception '%: choose the received goods it is for', v_lbl using errcode = '23502'; end if;
    if ch.method = 'VALUE' and exists (select 1 from public.lc_target_bases(p_landed_cost_id) b where b.unit_cost_pkr is null) then
      raise exception '%: some goods have no purchase cost yet — approve their cost first, or split by weight / quantity', v_lbl using errcode = '22023';
    end if;
    if v_sum <= 0 then
      raise exception '%: nothing to split by (% is zero for these goods) — choose another way to split', v_lbl,
        case ch.method when 'WEIGHT' then 'weight' when 'VOLUME' then 'volume (CBM)' when 'VALUE' then 'value' else 'the split' end using errcode = '22023';
    end if;
    if ch.method = 'PERCENT' and abs(v_sum - 100) > 0.01 then raise exception '%: the percentages add up to % — they must make 100', v_lbl, round(v_sum, 2) using errcode = '23514'; end if;
    if ch.method = 'MANUAL' and abs(v_sum - ch.amount_pkr) > 0.01 then raise exception '%: the amounts add up to % — they must make %', v_lbl, round(v_sum, 2), ch.amount_pkr using errcode = '23514'; end if;
    v_left := ch.amount_pkr; i := 0;
    for t in select b.*, case ch.method when 'VALUE' then b.value_pkr when 'WEIGHT' then b.weight_kg when 'QUANTITY' then b.quantity when 'VOLUME' then b.cbm
                 else coalesce(nullif(ch.manual->>(b.receipt_line_id::text),'')::numeric, 0) end as base
             from public.lc_target_bases(p_landed_cost_id) b order by b.receipt_no, b.receipt_line_id loop
      i := i + 1;
      v_amt := case when i = v_n then v_left when ch.method = 'MANUAL' then round(t.base, 2) else round(ch.amount_pkr * t.base / v_sum, 2) end;
      v_left := v_left - v_amt;
      charge_id := ch.id; receipt_line_id := t.receipt_line_id; amount_pkr := v_amt; return next;
    end loop;
  end loop;
end $$;

-- p_header: {company_id, doc_date, shipment_id, notes}; p_targets: receipt line ids (empty + shipment: all its received goods)
-- p_charges: [{component, description, payee_type, supplier_id, bank_account_id, reference, currency, fx_rate, amount, treatment, expense_account_id, method, manual, settles_charge_id}]
create or replace function public.save_landed_cost(p_id uuid, p_header jsonb, p_targets uuid[], p_charges jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_id uuid; h record; v_ship uuid := nullif(p_header->>'shipment_id','')::uuid; x jsonb; n int := 0;
  v_targets uuid[] := coalesce(p_targets, '{}'); v_cur text; v_fx numeric; v_amt numeric; v_payee text; v_treat text; v_acc record;
  e_id uuid; e_company uuid; e_status text; e_payee text; e_settled uuid; e_treat text; e_acc uuid;
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
      currency, fx_rate, amount, amount_pkr, treatment, expense_account_id, method, manual, settles_charge_id)
    values (v_company, v_id, n, coalesce(nullif(x->>'component',''), 'OTHER'), nullif(trim(x->>'description'),''), v_payee,
      case when v_payee = 'SUPPLIER' then (x->>'supplier_id')::uuid end, case when v_payee = 'BANK' then (x->>'bank_account_id')::uuid end,
      nullif(trim(x->>'reference'),''), v_cur, v_fx, v_amt, round(v_amt * v_fx, 2), v_treat,
      case when v_treat = 'EXPENSE' then coalesce(nullif(x->>'expense_account_id','')::uuid, e_acc) end,
      coalesce(nullif(x->>'method',''), 'VALUE'), coalesce(x->'manual', '{}'::jsonb), nullif(x->>'settles_charge_id','')::uuid);
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
      if ch.treatment = 'EXPENSE' and e_id is null then continue; end if;   -- the bill already put it on the expense account
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_clear, 'amount', -ch.amount_pkr, 'description', v_lbl));
    elsif ch.payee_type = 'BILLED' then
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

create or replace function public.cancel_landed_cost(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.landed_costs;
begin
  select * into h from public.landed_costs where id = p_id for update;
  if h.id is null then raise exception 'Landed cost not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.manage');
  if h.status <> 'DRAFT' then raise exception 'Only a draft can be cancelled' using errcode = '22023'; end if;
  update public.landed_costs set status = 'CANCELLED', updated_at = now() where id = p_id;
end $$;

-- open estimates that an actual charge can replace
create or replace function public.open_landed_cost_estimates(p_company uuid, p_shipment_id uuid default null)
returns table(charge_id uuid, landed_cost_id uuid, doc_no text, doc_date date, shipment_id uuid, shipment_no text, component text, description text, amount_pkr numeric, treatment text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company, 'purchasing.costs');
  return query
  select c.id, l.id, l.doc_no, l.doc_date, l.shipment_id, s.doc_no, c.component, c.description, c.amount_pkr, c.treatment
  from public.landed_cost_charges c join public.landed_costs l on l.id = c.landed_cost_id left join public.shipments s on s.id = l.shipment_id
  where c.company_id = p_company and c.is_active and c.payee_type = 'ESTIMATE' and c.settled_by is null and l.status = 'POSTED'
    and (p_shipment_id is null or l.shipment_id = p_shipment_id)
  order by l.doc_date, l.doc_no, c.line_no;
end $$;

-- receipt lines of a shipment (or any posted receipts) that landed cost can go on, with their cost
create or replace function public.lc_candidate_lines(p_company uuid, p_shipment_id uuid default null, p_receipt_ids uuid[] default null)
returns table(receipt_line_id uuid, receipt_id uuid, receipt_no text, doc_date date, product_id uuid, variant_id uuid, product_name text, variant_name text, uom text,
  quantity numeric, unit_cost_pkr numeric, landed_pkr numeric, weight_kg numeric, cbm numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company, 'purchasing.costs');
  return query
  select l.id, g.id, g.doc_no, g.doc_date, l.product_id, l.variant_id, p.name, v.name, u.code, l.quantity, l.unit_cost_pkr, l.landed_cost_pkr,
    coalesce((select sum(sl.weight_kg * k.quantity / sl.quantity) from public.goods_receipt_shipment_links k join public.shipment_lines sl on sl.id = k.shipment_line_id
              where k.receipt_line_id = l.id and not k.reversed and sl.weight_kg is not null), l.quantity * coalesce(v.weight_kg, p.weight_kg), 0),
    coalesce((select sum(sl.cbm * k.quantity / sl.quantity) from public.goods_receipt_shipment_links k join public.shipment_lines sl on sl.id = k.shipment_line_id
              where k.receipt_line_id = l.id and not k.reversed and sl.cbm is not null), 0)
  from public.goods_receipt_lines l join public.goods_receipts g on g.id = l.receipt_id join public.products p on p.id = l.product_id
  left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = p.base_uom_id
  where g.company_id = p_company and g.status = 'POSTED'
    and ((p_shipment_id is not null and g.shipment_id = p_shipment_id) or (p_receipt_ids is not null and g.id = any(p_receipt_ids)))
  order by g.doc_date, g.doc_no, l.line_no;
end $$;

create or replace function public.lc_preview(p_id uuid)
returns table(charge_id uuid, receipt_line_id uuid, amount_pkr numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.landed_costs where id = p_id;
  perform public.inv_require(v_company, 'purchasing.costs');
  if (select status from public.landed_costs where id = p_id) = 'POSTED' or (select status from public.landed_costs where id = p_id) = 'REVERSED' then
    return query select a.charge_id, a.receipt_line_id, a.amount_pkr from public.landed_cost_allocations a where a.landed_cost_id = p_id;
  else
    return query select * from public.lc_allocate(p_id);
  end if;
end $$;

-- ───────── attachments ─────────
create or replace function public.attachment_entity_ok(p_entity_type text)
returns boolean language sql immutable set search_path = '' as $$
  select p_entity_type in ('journal_entries','sales_invoices','quotations','sales_orders','gdns','goods_receipts','stock_adjustments',
                           'stock_transfers','stock_counts','assembly_orders','reservation_orders','price_tasks','customers','suppliers','products',
                           'purchase_orders','supplier_bills','purchase_cost_tasks','shipments','landed_costs');
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
    else public.has_permission(p_company, 'inventory.view')
  end;
end $$;

revoke all on function public.save_landed_cost(uuid,jsonb,uuid[],jsonb,uuid), public.post_landed_cost(uuid), public.reverse_landed_cost(uuid,text,date), public.cancel_landed_cost(uuid),
  public.open_landed_cost_estimates(uuid,uuid), public.lc_candidate_lines(uuid,uuid,uuid[]), public.lc_preview(uuid) from anon;
revoke all on function public.lc_allocate(uuid), public.lc_target_bases(uuid) from public, anon, authenticated;
