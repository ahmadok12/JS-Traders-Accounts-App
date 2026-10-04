-- Stage 7 part 3 — supplier bills: from receipts (or expenses), Pay Supplier Now, payment allocation, reversal

create or replace view public.supplier_bills_v with (security_invoker = true) as
  select b.id, b.company_id, b.doc_no, b.bill_date, b.due_date, b.supplier_id, s.name as supplier_name, s.code as supplier_code, b.supplier_invoice_no,
    b.currency, b.fx_rate, b.status, b.total_amount, b.total_pkr, b.journal_entry_id, b.posted_at, b.created_at,
    coalesce(p.paid, 0) as paid_pkr,
    case when b.status = 'POSTED' then b.total_pkr - coalesce(p.paid, 0) else 0 end as outstanding_pkr,
    case when b.status <> 'POSTED' then null when coalesce(p.paid, 0) <= 0 then 'UNPAID' when coalesce(p.paid, 0) >= b.total_pkr then 'PAID' else 'PART_PAID' end as payment_status
  from public.supplier_bills b join public.suppliers s on s.id = b.supplier_id
  left join (select bill_id, sum(amount) paid from public.supplier_bill_allocations where status = 'ACTIVE' group by bill_id) p on p.bill_id = b.id;
grant select on public.supplier_bills_v to authenticated;

-- lines of a draft bill are kept in lines_draft (like sales invoices); posting writes supplier_bill_lines
-- line: {kind: ITEM|EXPENSE, receipt_line_id?, product_id?, variant_id?, account_id?, description, quantity, unit_price}
create or replace function public.bill_check_lines(p_company uuid, p_supplier uuid, p_bill uuid, p_lines jsonb, p_strict boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l jsonb; n int := 0; r record; a record; v_out jsonb := '[]'::jsonb; q numeric; p numeric; v_other numeric;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    n := n + 1;
    q := nullif(l->>'quantity','')::numeric;
    p := nullif(l->>'unit_price','')::numeric;
    if q is null or q <= 0 then raise exception 'Line %: enter a quantity', n using errcode = '23502'; end if;
    if p is not null and p < 0 then raise exception 'Line %: price cannot be negative', n using errcode = '23514'; end if;
    if p_strict and p is null then raise exception 'Line %: enter the price — a missing price is not zero', n using errcode = '23502'; end if;
    if coalesce(l->>'kind', 'ITEM') = 'ITEM' then
      select gl.*, g.supplier_id, g.status as g_status, g.doc_no into r from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
       where gl.id = nullif(l->>'receipt_line_id','')::uuid and gl.company_id = p_company;
      if r.id is null then raise exception 'Line %: items on a bill must come from a goods receipt', n using errcode = '23502'; end if;
      if r.g_status <> 'POSTED' then raise exception 'Line %: receipt % is not posted', n, r.doc_no using errcode = '22023'; end if;
      if r.supplier_id is distinct from p_supplier then raise exception 'Line %: receipt % is from another supplier', n, r.doc_no using errcode = '22023'; end if;
      select coalesce(sum((x->>'quantity')::numeric), 0) into v_other from public.supplier_bills b, jsonb_array_elements(b.lines_draft) x
       where b.status = 'DRAFT' and b.id is distinct from p_bill and (x->>'receipt_line_id') = r.id::text;
      if p_strict and q > r.quantity - r.billed_qty then
        raise exception 'Line %: only % left to bill on receipt %', n, (r.quantity - r.billed_qty), r.doc_no using errcode = '23514';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'ITEM', 'receipt_line_id', r.id, 'receipt_id', r.receipt_id, 'receipt_no', r.doc_no,
        'product_id', r.product_id, 'variant_id', r.variant_id, 'description', nullif(trim(l->>'description'),''), 'quantity', q, 'unit_price', p,
        'other_drafts', v_other));
    else
      select * into a from public.chart_of_accounts where id = nullif(l->>'account_id','')::uuid and company_id = p_company;
      if a.id is null and not p_strict then   -- a draft may still be missing its account
        v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'EXPENSE', 'account_id', null, 'description', nullif(trim(l->>'description'),''), 'quantity', q, 'unit_price', p));
        continue;
      end if;
      if a.id is null or a.is_group or not a.is_active then raise exception 'Line %: choose an expense / asset account', n using errcode = '23502'; end if;
      if public.acc_party_kind(a.system_key) is not null or a.system_key in ('INVENTORY','GRNI') then
        raise exception 'Line %: account % cannot be used on a bill line', n, a.name using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'EXPENSE', 'account_id', a.id, 'description', coalesce(nullif(trim(l->>'description'),''), a.name),
        'quantity', q, 'unit_price', p));
    end if;
  end loop;
  if n = 0 then raise exception 'Add at least one line' using errcode = '23502'; end if;
  return v_out;
end $$;

create or replace function public.bill_totals(p_lines jsonb, p_fx numeric, out total numeric, out total_pkr numeric)
language sql immutable set search_path = '' as $$
  select coalesce(sum(round((x->>'quantity')::numeric * coalesce(nullif(x->>'unit_price','')::numeric, 0), 2)), 0),
         coalesce(sum(round(round((x->>'quantity')::numeric * coalesce(nullif(x->>'unit_price','')::numeric, 0), 2) * p_fx, 2)), 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x;
$$;

create or replace function public.save_supplier_bill(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_sup uuid := nullif(p_header->>'supplier_id','')::uuid; v_id uuid; h record;
  v_cur text := coalesce(nullif(upper(trim(p_header->>'currency')),''), 'PKR'); v_fx numeric := coalesce(nullif(p_header->>'fx_rate','')::numeric, 1); v_lines jsonb; t record;
begin
  perform public.inv_require(v_company, 'purchasing.manage');
  perform public.inv_require(v_company, 'purchasing.costs');
  if v_sup is null or not exists (select 1 from public.suppliers where id = v_sup and company_id = v_company) then raise exception 'Choose the supplier' using errcode = '23502'; end if;
  if v_fx <= 0 then raise exception 'Exchange rate must be above zero' using errcode = '23514'; end if;
  if v_cur = 'PKR' and v_fx <> 1 then raise exception 'PKR bills use exchange rate 1' using errcode = '23514'; end if;
  if p_id is not null then
    select * into h from public.supplier_bills where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
    if h.status <> 'DRAFT' then raise exception 'Only draft bills can be edited' using errcode = '22023'; end if;
  end if;
  v_lines := public.bill_check_lines(v_company, v_sup, p_id, p_lines, false);
  select * into t from public.bill_totals(v_lines, v_fx);
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.supplier_bills where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.supplier_bills(company_id, doc_no, bill_date, due_date, supplier_id, supplier_invoice_no, currency, fx_rate, lines_draft, total_amount, total_pkr, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'SUPPLIER_BILL'), coalesce(nullif(p_header->>'bill_date','')::date, current_date),
      nullif(p_header->>'due_date','')::date, v_sup, nullif(trim(p_header->>'supplier_invoice_no'),''), v_cur, v_fx, v_lines, t.total, t.total_pkr,
      nullif(trim(p_header->>'notes'),''), p_idempotency_key)
    returning id into v_id;
  else
    update public.supplier_bills set bill_date = coalesce(nullif(p_header->>'bill_date','')::date, bill_date), due_date = nullif(p_header->>'due_date','')::date,
      supplier_id = v_sup, supplier_invoice_no = nullif(trim(p_header->>'supplier_invoice_no'),''), currency = v_cur, fx_rate = v_fx,
      lines_draft = v_lines, total_amount = t.total, total_pkr = t.total_pkr, notes = nullif(trim(p_header->>'notes'),''), updated_at = now()
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

-- a draft bill with every not-yet-billed item of the chosen receipts (same supplier); known costs are filled in
create or replace function public.create_bill_from_receipts(p_company_id uuid, p_receipt_ids uuid[], p_bill_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_n int; v_sup uuid; v_lines jsonb := '[]'::jsonb; l record; v_cur text; v_fx numeric;
begin
  perform public.inv_require(p_company_id, 'purchasing.manage');
  select count(distinct supplier_id), min(supplier_id::text)::uuid into v_n, v_sup from public.goods_receipts
   where id = any(p_receipt_ids) and company_id = p_company_id and status = 'POSTED';
  if v_n = 0 or v_sup is null then raise exception 'Choose posted receipts that have a supplier' using errcode = '23502'; end if;
  if v_n > 1 then raise exception 'All receipts on one bill must be from the same supplier' using errcode = '22023'; end if;
  select coalesce(max(g.cost_currency), max(po.currency), max(s.default_currency), 'PKR'), coalesce(max(g.cost_fx_rate), max(po.fx_rate), 1)
    into v_cur, v_fx
    from public.goods_receipts g join public.suppliers s on s.id = g.supplier_id left join public.purchase_orders po on po.id = g.purchase_order_id
   where g.id = any(p_receipt_ids);
  if v_cur = 'PKR' then v_fx := 1; end if;
  -- price: the approved receipt cost, else the PO price (same currency), else left empty to fill in
  for l in select gl.*, g.doc_no, g.cost_currency,
             (select pl.unit_price from public.goods_receipt_po_links k join public.purchase_order_lines pl on pl.id = k.po_line_id
               join public.purchase_orders po on po.id = pl.purchase_order_id where k.receipt_line_id = gl.id and not k.reversed and po.currency = v_cur limit 1) as po_price
           from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
           where gl.receipt_id = any(p_receipt_ids) and gl.quantity > gl.billed_qty order by g.doc_date, g.doc_no, gl.line_no loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('kind', 'ITEM', 'receipt_line_id', l.id, 'quantity', l.quantity - l.billed_qty,
      'unit_price', case when l.unit_cost is not null and coalesce(l.cost_currency, 'PKR') = v_cur then l.unit_cost else l.po_price end));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'These receipts are already fully billed' using errcode = '22023'; end if;
  return public.save_supplier_bill(null, jsonb_build_object('company_id', p_company_id, 'supplier_id', v_sup, 'bill_date', coalesce(p_bill_date, current_date),
    'currency', v_cur, 'fx_rate', v_fx), v_lines, null);
end $$;

-- pay a supplier from a bank / cash account (PKR): Dr Accounts Payable (allocated to bills) [+ Dr Supplier Advances for any excess] / Cr Bank
create or replace function public.supplier_pay(p_company uuid, p_supplier uuid, p_bank uuid, p_amount numeric, p_date date, p_reference text, p_bills jsonb, p_memo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b record; v_alloc numeric := 0; x jsonb; v_lines jsonb; v_je uuid; v_out numeric; v_amt numeric; v_bill record;
begin
  select * into b from public.bank_accounts where id = p_bank and company_id = p_company and is_active;
  if b.id is null then raise exception 'Choose the bank / cash account' using errcode = '23502'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid' using errcode = '23502'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_bills, '[]'::jsonb)) loop
    v_alloc := v_alloc + coalesce(nullif(x->>'amount','')::numeric, 0);
  end loop;
  if v_alloc > p_amount then raise exception 'Allocated more than paid' using errcode = '23514'; end if;
  v_lines := jsonb_build_array(jsonb_build_object('account_id', public.hr_account(p_company, 'AP_CONTROL'), 'debit', v_alloc, 'party_type', 'SUPPLIER', 'party_id', p_supplier, 'description', coalesce(p_memo, 'Supplier payment')));
  if p_amount > v_alloc then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(p_company, 'SUPPLIER_ADVANCE'), 'debit', p_amount - v_alloc,
      'party_type', 'SUPPLIER', 'party_id', p_supplier, 'description', 'Advance / not yet allocated'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', b.gl_account_id, 'credit', p_amount, 'bank_account_id', b.id, 'description', coalesce(p_memo, 'Supplier payment')));
  v_je := public.acc_post_document_entry(p_company, 'PAYMENT', coalesce(p_date, current_date), coalesce(p_memo, 'Supplier payment'), nullif(trim(p_reference),''),
    'SUPPLIER', p_supplier, b.id, p_amount, v_lines, 'SUPPLIER_PAYMENT', null);
  for x in select * from jsonb_array_elements(coalesce(p_bills, '[]'::jsonb)) loop
    v_amt := coalesce(nullif(x->>'amount','')::numeric, 0);
    if v_amt <= 0 then continue; end if;
    select * into v_bill from public.supplier_bills_v where id = (x->>'bill_id')::uuid;
    if v_bill.id is null or v_bill.supplier_id <> p_supplier or v_bill.status <> 'POSTED' then raise exception 'Bill not found for this supplier' using errcode = 'P0002'; end if;
    if v_bill.currency <> 'PKR' then raise exception 'Bill % is in % — foreign-currency settlement comes with multi-currency payments', v_bill.doc_no, v_bill.currency using errcode = '22023'; end if;
    if v_amt > v_bill.outstanding_pkr then raise exception 'Bill % has only % outstanding', v_bill.doc_no, v_bill.outstanding_pkr using errcode = '23514'; end if;
    insert into public.supplier_bill_allocations(company_id, payment_entry_id, bill_id, amount) values (p_company, v_je, v_bill.id, v_amt);
  end loop;
  return v_je;
end $$;

-- post: Dr GRNI (receipt value) ± Inventory (price difference / receipts without cost) + Dr expense lines / Cr Accounts Payable
-- p_pay (optional, PKR bills): {bank_account_id, amount, date, reference} — Pay Supplier Now
create or replace function public.post_supplier_bill(p_id uuid, p_pay jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h public.supplier_bills; v_lines jsonb; x jsonb; n int := 0; r record; v_amt numeric; v_pkr numeric; v_rv numeric;
  v_grni numeric := 0; v_inv numeric := 0; v_jl jsonb := '[]'::jsonb; v_je uuid; t record; v_exp record; v_recs uuid[] := '{}'; g uuid; v_task record; v_pay numeric;
begin
  select * into h from public.supplier_bills where id = p_id for update;
  if h.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.approve');
  if h.status = 'POSTED' then return h.journal_entry_id; end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % bill', lower(h.status) using errcode = '22023'; end if;
  v_lines := public.bill_check_lines(h.company_id, h.supplier_id, h.id, h.lines_draft, true);
  select * into t from public.bill_totals(v_lines, h.fx_rate);
  if t.total_pkr <= 0 then raise exception 'The bill total must be above zero' using errcode = '23514'; end if;

  for x in select * from jsonb_array_elements(v_lines) loop
    n := n + 1;
    v_amt := round((x->>'quantity')::numeric * (x->>'unit_price')::numeric, 2);
    v_pkr := round(v_amt * h.fx_rate, 2);
    v_rv := null;
    if x->>'kind' = 'ITEM' then
      select * into r from public.goods_receipt_lines where id = (x->>'receipt_line_id')::uuid for update;
      if r.cost_source = 'COST_TASK' and r.cost_entry_id is not null then
        v_rv := round((x->>'quantity')::numeric * r.unit_cost_pkr, 2);   -- clears what the receipt put into GRNI
        v_grni := v_grni + v_rv;
        v_inv := v_inv + (v_pkr - v_rv);
      else
        v_inv := v_inv + v_pkr;                                           -- receipt had no cost: the bill is the cost
        if r.unit_cost is null then
          update public.goods_receipt_lines set unit_cost = (x->>'unit_price')::numeric, unit_cost_pkr = round((x->>'unit_price')::numeric * h.fx_rate, 4), cost_source = 'BILL' where id = r.id;
        end if;
      end if;
      update public.goods_receipt_lines set billed_qty = billed_qty + (x->>'quantity')::numeric where id = r.id;
      v_recs := v_recs || r.receipt_id;
    end if;
    insert into public.supplier_bill_lines(company_id, bill_id, line_no, kind, receipt_line_id, product_id, variant_id, account_id, description, quantity, unit_price, amount, amount_pkr, receipt_value_pkr)
    values (h.company_id, h.id, n, x->>'kind', nullif(x->>'receipt_line_id','')::uuid, nullif(x->>'product_id','')::uuid, nullif(x->>'variant_id','')::uuid,
      nullif(x->>'account_id','')::uuid, x->>'description', (x->>'quantity')::numeric, (x->>'unit_price')::numeric, v_amt, v_pkr, v_rv);
  end loop;

  if v_grni > 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'GRNI'), 'debit', v_grni, 'description', 'Received goods billed ' || h.doc_no)); end if;
  if v_inv > 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'INVENTORY'), 'debit', v_inv, 'description', 'Stock cost per bill ' || h.doc_no));
  elsif v_inv < 0 then v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'INVENTORY'), 'credit', -v_inv, 'description', 'Bill below receipt cost ' || h.doc_no)); end if;
  for v_exp in select account_id, sum(amount_pkr) amt, string_agg(description, '; ') d from public.supplier_bill_lines where bill_id = h.id and kind = 'EXPENSE' group by account_id loop
    v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_exp.account_id, 'debit', v_exp.amt, 'description', left(v_exp.d, 200)));
  end loop;
  v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'AP_CONTROL'), 'credit', t.total_pkr, 'party_type', 'SUPPLIER', 'party_id', h.supplier_id,
    'description', 'Bill ' || h.doc_no || coalesce(' / ' || h.supplier_invoice_no, '')));
  v_je := public.acc_post_document_entry(h.company_id, 'SYSTEM', h.bill_date, 'Supplier bill ' || h.doc_no || coalesce(' (' || h.supplier_invoice_no || ')', ''),
    coalesce(h.supplier_invoice_no, h.doc_no), 'SUPPLIER', h.supplier_id, null, t.total_pkr, v_jl, 'SUPPLIER_BILL', h.id);

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

  update public.supplier_bills set status = 'POSTED', journal_entry_id = v_je, total_amount = t.total, total_pkr = t.total_pkr, posted_at = now(), posted_by = auth.uid(), updated_at = now() where id = h.id;

  if p_pay is not null and coalesce(nullif(p_pay->>'amount','')::numeric, 0) > 0 then
    if h.currency <> 'PKR' then raise exception 'Pay Supplier Now is for PKR bills — foreign-currency payments come with multi-currency settlement' using errcode = '22023'; end if;
    v_pay := (p_pay->>'amount')::numeric;
    perform public.inv_require(h.company_id, 'journals.create');
    perform public.supplier_pay(h.company_id, h.supplier_id, nullif(p_pay->>'bank_account_id','')::uuid, v_pay, coalesce(nullif(p_pay->>'date','')::date, h.bill_date),
      coalesce(nullif(p_pay->>'reference',''), h.supplier_invoice_no), jsonb_build_array(jsonb_build_object('bill_id', h.id, 'amount', least(v_pay, t.total_pkr))),
      'Payment for ' || h.doc_no);
  end if;
  return v_je;
end $$;

-- allocate existing supplier payment vouchers (or advances) to bills
create or replace function public.supplier_open_payments(p_supplier_id uuid)
returns table(entry_id uuid, entry_no text, entry_date date, amount numeric, allocated numeric, unallocated numeric, reference text)
language sql stable security definer set search_path = '' as $$
  select je.id, je.entry_no, je.entry_date, d.amt, coalesce(a.al, 0), d.amt - coalesce(a.al, 0), je.reference
  from public.journal_entries je
  join lateral (select sum(jl.debit - jl.credit) amt from public.journal_lines jl join public.chart_of_accounts c on c.id = jl.account_id
                where jl.entry_id = je.id and jl.party_type = 'SUPPLIER' and jl.party_id = p_supplier_id and c.system_key in ('AP_CONTROL','SUPPLIER_ADVANCE')) d on true
  left join lateral (select sum(amount) al from public.supplier_bill_allocations where payment_entry_id = je.id and status = 'ACTIVE') a on true
  where je.status = 'POSTED' and je.entry_type = 'PAYMENT' and d.amt > 0 and d.amt - coalesce(a.al, 0) > 0
    and exists (select 1 from public.suppliers s where s.id = p_supplier_id and public.has_permission(s.company_id, 'purchasing.costs'))
  order by je.entry_date;
$$;

create or replace function public.allocate_supplier_payment(p_entry_id uuid, p_allocations jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare je record; x jsonb; v_amt numeric; v_bill record; v_free numeric; n int := 0;
begin
  select * into je from public.journal_entries where id = p_entry_id;
  if je.id is null or je.status <> 'POSTED' or je.entry_type <> 'PAYMENT' then raise exception 'Choose a posted payment voucher' using errcode = '22023'; end if;
  if not (public.has_permission(je.company_id, 'purchasing.approve') or public.has_permission(je.company_id, 'journals.create')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amt := coalesce(nullif(x->>'amount','')::numeric, 0);
    if v_amt <= 0 then continue; end if;
    select * into v_bill from public.supplier_bills_v where id = (x->>'bill_id')::uuid;
    if v_bill.id is null or v_bill.status <> 'POSTED' then raise exception 'Bill not found' using errcode = 'P0002'; end if;
    if v_bill.currency <> 'PKR' then raise exception 'Bill % is in % — foreign-currency settlement comes with multi-currency payments', v_bill.doc_no, v_bill.currency using errcode = '22023'; end if;
    select unallocated into v_free from public.supplier_open_payments(v_bill.supplier_id) where entry_id = p_entry_id;
    if coalesce(v_free, 0) < v_amt then raise exception 'This payment has only % not yet allocated for %', coalesce(v_free, 0), v_bill.supplier_name using errcode = '23514'; end if;
    if v_amt > v_bill.outstanding_pkr then raise exception 'Bill % has only % outstanding', v_bill.doc_no, v_bill.outstanding_pkr using errcode = '23514'; end if;
    insert into public.supplier_bill_allocations(company_id, payment_entry_id, bill_id, amount) values (je.company_id, p_entry_id, v_bill.id, v_amt);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.remove_supplier_allocation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.supplier_bill_allocations;
begin
  select * into a from public.supplier_bill_allocations where id = p_id for update;
  if a.id is null or a.status <> 'ACTIVE' then raise exception 'Allocation not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(a.company_id, 'purchasing.approve') or public.has_permission(a.company_id, 'journals.create')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.supplier_bill_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid() where id = p_id;
end $$;

-- pay one or more bills of a supplier from the bills screen
create or replace function public.pay_supplier_bills(p_company_id uuid, p_supplier_id uuid, p_bank_account_id uuid, p_amount numeric, p_date date, p_reference text, p_bills jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company_id, 'purchasing.approve');
  perform public.inv_require(p_company_id, 'journals.create');
  return public.supplier_pay(p_company_id, p_supplier_id, p_bank_account_id, p_amount, p_date, p_reference, p_bills, 'Supplier payment');
end $$;

create or replace function public.reverse_supplier_bill(p_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.supplier_bills; l record;
begin
  select * into h from public.supplier_bills where id = p_id for update;
  if h.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.approve');
  if h.status <> 'POSTED' then raise exception 'Only a posted bill can be reversed' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  if exists (select 1 from public.supplier_bill_allocations where bill_id = p_id and status = 'ACTIVE') then
    raise exception 'Payments are allocated to this bill — remove those allocations first' using errcode = '22023';
  end if;
  perform public.acc_reverse_document_entry(h.journal_entry_id, trim(p_reason), coalesce(p_date, current_date));
  for l in select * from public.supplier_bill_lines where bill_id = p_id and receipt_line_id is not null loop
    update public.goods_receipt_lines set billed_qty = greatest(billed_qty - l.quantity, 0) where id = l.receipt_line_id;
    update public.goods_receipt_lines set unit_cost = null, unit_cost_pkr = null, cost_source = null
     where id = l.receipt_line_id and cost_source = 'BILL' and billed_qty = 0;
    update public.goods_receipts g set cost_status = 'PENDING'
     where g.id = (select receipt_id from public.goods_receipt_lines where id = l.receipt_line_id)
       and exists (select 1 from public.goods_receipt_lines x where x.receipt_id = g.id and x.unit_cost is null);
  end loop;
  update public.supplier_bills set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason), updated_at = now() where id = p_id;
end $$;

create or replace function public.cancel_supplier_bill(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.supplier_bills;
begin
  select * into h from public.supplier_bills where id = p_id for update;
  perform public.inv_require(h.company_id, 'purchasing.manage');
  if h.status <> 'DRAFT' then raise exception 'Only a draft bill can be cancelled' using errcode = '22023'; end if;
  update public.supplier_bills set status = 'CANCELLED', updated_at = now() where id = p_id;
end $$;

-- posted receipts of a supplier that still have something to bill (for "New bill")
create or replace function public.unbilled_receipts(p_company_id uuid, p_supplier_id uuid default null)
returns table(receipt_id uuid, doc_no text, doc_date date, supplier_id uuid, supplier_name text, purchase_order_no text, lines_to_bill int, cost_status text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.doc_no, g.doc_date, g.supplier_id, s.name, po.doc_no, count(*) filter (where l.quantity > l.billed_qty)::int, g.cost_status
  from public.goods_receipts g join public.goods_receipt_lines l on l.receipt_id = g.id join public.suppliers s on s.id = g.supplier_id
  left join public.purchase_orders po on po.id = g.purchase_order_id
  where g.company_id = p_company_id and g.status = 'POSTED' and (p_supplier_id is null or g.supplier_id = p_supplier_id)
    and public.has_permission(p_company_id, 'purchasing.costs')
  group by g.id, g.doc_no, g.doc_date, g.supplier_id, s.name, po.doc_no, g.cost_status
  having count(*) filter (where l.quantity > l.billed_qty) > 0
  order by g.doc_date desc;
$$;

-- attachments on purchasing documents
create or replace function public.attachment_entity_ok(p_entity_type text) returns boolean
language sql immutable set search_path = '' as $$
  select p_entity_type in ('journal_entries','sales_invoices','quotations','sales_orders','gdns','goods_receipts','stock_adjustments',
                           'stock_transfers','stock_counts','assembly_orders','reservation_orders','price_tasks','customers','suppliers','products',
                           'purchase_orders','supplier_bills','purchase_cost_tasks');
$$;
create or replace function public.attachment_can_view(p_company uuid, p_entity_type text, p_entity_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
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
    else public.has_permission(p_company, 'inventory.view')
  end;
end $$;
insert into public.role_permissions(role_id, permission_code)
select r.id, 'attachments.manage' from public.roles r where r.code = 'OWNER' on conflict do nothing;

revoke all on function public.supplier_pay(uuid,uuid,uuid,numeric,date,text,jsonb,text), public.bill_check_lines(uuid,uuid,uuid,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.save_supplier_bill(uuid,jsonb,jsonb,uuid), public.create_bill_from_receipts(uuid,uuid[],date), public.post_supplier_bill(uuid,jsonb),
  public.supplier_open_payments(uuid), public.allocate_supplier_payment(uuid,jsonb), public.remove_supplier_allocation(uuid),
  public.pay_supplier_bills(uuid,uuid,uuid,numeric,date,text,jsonb), public.reverse_supplier_bill(uuid,text,date), public.cancel_supplier_bill(uuid),
  public.unbilled_receipts(uuid,uuid) from anon;

-- people who can be given a cost task
create or replace function public.cost_people(p_company_id uuid)
returns table(user_id uuid, full_name text, can_approve boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, public.user_has_permission(p.id, p_company_id, 'purchasing.approve')
  from public.profiles p
  where p.is_active and public.is_company_member(p_company_id)
    and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.company_id = p_company_id)
    and public.user_has_permission(p.id, p_company_id, 'purchasing.costs')
  order by p.full_name;
$$;
revoke all on function public.cost_people(uuid) from anon;
