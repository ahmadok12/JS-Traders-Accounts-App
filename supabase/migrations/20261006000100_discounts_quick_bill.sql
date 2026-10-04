-- Discounts on every sales and purchase document, and a quick supplier bill (receive + bill [+ pay] in one step)

alter table public.sales_orders add column if not exists discount_amount numeric not null default 0 check (discount_amount >= 0);
alter table public.purchase_orders add column if not exists discount_amount numeric not null default 0 check (discount_amount >= 0);
alter table public.supplier_bills add column if not exists discount_amount numeric not null default 0 check (discount_amount >= 0);
alter table public.supplier_bills add column if not exists is_quick boolean not null default false;
alter table public.supplier_bill_lines add column if not exists discount_pkr numeric not null default 0;

create or replace view public.supplier_bills_v with (security_invoker = true) as
  select b.id, b.company_id, b.doc_no, b.bill_date, b.due_date, b.supplier_id, s.name as supplier_name, s.code as supplier_code, b.supplier_invoice_no,
    b.currency, b.fx_rate, b.status, b.total_amount, b.total_pkr, b.journal_entry_id, b.posted_at, b.created_at,
    coalesce(p.paid, 0) as paid_pkr,
    case when b.status = 'POSTED' then b.total_pkr - coalesce(p.paid, 0) else 0 end as outstanding_pkr,
    case when b.status <> 'POSTED' then null when coalesce(p.paid, 0) <= 0 then 'UNPAID' when coalesce(p.paid, 0) >= b.total_pkr then 'PAID' else 'PART_PAID' end as payment_status,
    b.discount_amount, b.is_quick
  from public.supplier_bills b join public.suppliers s on s.id = b.supplier_id
  left join (select bill_id, sum(amount) paid from public.supplier_bill_allocations where status = 'ACTIVE' group by bill_id) p on p.bill_id = b.id;

-- sales order discount (amount, in the order's money) — carried into invoices in proportion to what is invoiced
create or replace function public.set_sales_order_discount(p_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.sales_orders; v_val numeric;
begin
  select * into h from public.sales_orders where id = p_id for update;
  if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  perform public.inv_require(h.company_id, 'sales.view_prices');
  if h.status not in ('DRAFT','APPROVED','PARTIALLY_DELIVERED') then raise exception 'This order is % — its discount can no longer change', lower(h.status) using errcode = '22023'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;
  select coalesce(sum(round(quantity * unit_price, 2)), 0) into v_val from public.sales_order_lines where sales_order_id = p_id and is_active and unit_price is not null;
  if coalesce(p_amount, 0) > v_val and coalesce(p_amount, 0) > 0 then raise exception 'Discount (%) is more than the order value (%)', p_amount, v_val using errcode = '23514'; end if;
  update public.sales_orders set discount_amount = round(coalesce(p_amount, 0), 2) where id = p_id;
end $$;

create or replace function public.create_invoice_from_gdns(p_company_id uuid, p_gdn_ids uuid[], p_invoice_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cust uuid; v_id uuid; g record; v_lines jsonb := '[]'::jsonb; v_n int;
begin
  perform public.inv_require(p_company_id, 'sales.invoice');
  select count(distinct customer_id), min(customer_id::text)::uuid into v_n, v_cust from public.gdns
   where id = any(p_gdn_ids) and company_id = p_company_id and status = 'POSTED';
  if v_n = 0 then raise exception 'Choose at least one posted GDN' using errcode = '23502'; end if;
  if v_n > 1 then raise exception 'All GDNs on one invoice must be for the same customer' using errcode = '22023'; end if;
  for g in select gl.product_id, gl.variant_id, gl.unit_price, sum(gl.quantity - gl.invoiced_qty) as qty,
                  jsonb_agg(jsonb_build_object('gdn_line_id', gl.id, 'qty', gl.quantity - gl.invoiced_qty) order by gl.id) as src,
                  min(p.name) as pname
           from public.gdn_lines gl join public.gdns h on h.id = gl.gdn_id join public.products p on p.id = gl.product_id
           where gl.gdn_id = any(p_gdn_ids) and h.status = 'POSTED' and gl.quantity > gl.invoiced_qty
           group by gl.product_id, gl.variant_id, gl.unit_price
           order by min(p.name) loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', g.product_id, 'variant_id', g.variant_id,
      'quantity', g.qty, 'unit_price', g.unit_price, 'approved_price', g.unit_price, 'description', null, 'sources', g.src));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'These GDNs are already fully invoiced' using errcode = '22023'; end if;
  insert into public.sales_invoices(company_id, doc_no, invoice_date, customer_id, lines_draft)
  values (p_company_id, public.next_document_number(p_company_id, 'SALES_INVOICE'), coalesce(p_invoice_date, current_date), v_cust, v_lines)
  returning id into v_id;
  -- the orders' discount, in proportion to the part of each order billed now
  update public.sales_invoices set discount_amount = coalesce((
    select round(sum(so.discount_amount * part.v / nullif(full_v.v, 0)), 2)
    from (select g.sales_order_id so_id, sum(round(x.q * gl.unit_price, 2)) v
          from (select (s->>'gdn_line_id')::uuid gl_id, (s->>'qty')::numeric q from jsonb_array_elements(v_lines) e, jsonb_array_elements(e->'sources') s) x
          join public.gdn_lines gl on gl.id = x.gl_id join public.gdns g on g.id = gl.gdn_id
          where gl.unit_price is not null group by g.sales_order_id) part
    join public.sales_orders so on so.id = part.so_id and so.discount_amount > 0
    join lateral (select sum(round(l.quantity * l.unit_price, 2)) v from public.sales_order_lines l where l.sales_order_id = so.id and l.is_active and l.unit_price is not null) full_v on true
  ), 0) where id = v_id;
  perform public.inv_recalc_invoice(v_id);
  return v_id;
end $$;

create or replace function public.save_purchase_order(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_id uuid; v_sup uuid := nullif(p_header->>'supplier_id','')::uuid; h record;
  l jsonb; n int := 0; v_keep uuid[] := '{}'; v_line uuid; v_price numeric; v_costs boolean;
begin
  perform public.inv_require(v_company, 'purchasing.manage');
  v_costs := public.has_permission(v_company, 'purchasing.costs');
  if v_sup is null or not exists (select 1 from public.suppliers where id = v_sup and company_id = v_company and is_active) then
    raise exception 'Choose an active supplier' using errcode = '23502';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.purchase_orders where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.purchase_orders(company_id, doc_no, order_date, expected_date, supplier_id, supplier_reference, warehouse_id, currency, fx_rate, notes, idempotency_key, discount_amount)
    values (v_company, public.next_document_number(v_company, 'PURCHASE_ORDER'), coalesce(nullif(p_header->>'order_date','')::date, current_date),
      nullif(p_header->>'expected_date','')::date, v_sup, nullif(trim(p_header->>'supplier_reference'),''), nullif(p_header->>'warehouse_id','')::uuid,
      coalesce(nullif(upper(trim(p_header->>'currency')),''), 'PKR'), coalesce(nullif(p_header->>'fx_rate','')::numeric, 1), nullif(trim(p_header->>'notes'),''), p_idempotency_key,
      case when v_costs then coalesce(nullif(p_header->>'discount_amount','')::numeric, 0) else 0 end)
    returning id into v_id;
  else
    select * into h from public.purchase_orders where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
    if h.status <> 'DRAFT' then raise exception 'Only draft orders can be edited (this one is %)', lower(h.status) using errcode = '22023'; end if;
    update public.purchase_orders set order_date = coalesce(nullif(p_header->>'order_date','')::date, order_date), expected_date = nullif(p_header->>'expected_date','')::date,
      supplier_id = v_sup, supplier_reference = nullif(trim(p_header->>'supplier_reference'),''), warehouse_id = nullif(p_header->>'warehouse_id','')::uuid,
      currency = coalesce(nullif(upper(trim(p_header->>'currency')),''), 'PKR'), fx_rate = coalesce(nullif(p_header->>'fx_rate','')::numeric, 1),
      notes = nullif(trim(p_header->>'notes'),''), updated_at = now(), updated_by = auth.uid(),
      discount_amount = case when v_costs then coalesce(nullif(p_header->>'discount_amount','')::numeric, 0) else discount_amount end
    where id = p_id;
    v_id := p_id;
  end if;
  if (select discount_amount from public.purchase_orders where id = v_id) < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;
  if (select fx_rate from public.purchase_orders where id = v_id) <= 0 then raise exception 'Exchange rate must be above zero' using errcode = '23514'; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then raise exception 'Line %: enter a quantity', n using errcode = '23502'; end if;
    if not exists (select 1 from public.products where id = (l->>'product_id')::uuid and company_id = v_company) then raise exception 'Line %: choose a product', n using errcode = '23502'; end if;
    v_line := nullif(l->>'id','')::uuid;
    v_price := nullif(l->>'unit_price','')::numeric;
    if v_price is not null and v_price < 0 then raise exception 'Line %: price cannot be negative', n using errcode = '23514'; end if;
    if v_line is not null and exists (select 1 from public.purchase_order_lines where id = v_line and purchase_order_id = v_id and is_active) then
      if not v_costs then v_price := (select unit_price from public.purchase_order_lines where id = v_line); end if;
      update public.purchase_order_lines set line_no = n, product_id = (l->>'product_id')::uuid, variant_id = nullif(l->>'variant_id','')::uuid,
        quantity = (l->>'quantity')::numeric, unit_price = v_price, notes = nullif(trim(l->>'notes'),'') where id = v_line;
    else
      if not v_costs then v_price := null; end if;
      insert into public.purchase_order_lines(company_id, purchase_order_id, line_no, product_id, variant_id, quantity, unit_price, notes)
      values (v_company, v_id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric, v_price, nullif(trim(l->>'notes'),''))
      returning id into v_line;
    end if;
    v_keep := v_keep || v_line;
  end loop;
  update public.purchase_order_lines set is_active = false where purchase_order_id = v_id and is_active and not (id = any(v_keep));
  return v_id;
end $$;

create or replace function public.save_supplier_bill(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_sup uuid := nullif(p_header->>'supplier_id','')::uuid; v_id uuid; h record;
  v_cur text := coalesce(nullif(upper(trim(p_header->>'currency')),''), 'PKR'); v_fx numeric := coalesce(nullif(p_header->>'fx_rate','')::numeric, 1); v_lines jsonb; t record; v_disc numeric := coalesce(nullif(p_header->>'discount_amount','')::numeric, 0);
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
  if v_disc < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;
  if v_disc > t.total then raise exception 'Discount (%) is more than the bill (%)', v_disc, t.total using errcode = '23514'; end if;
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.supplier_bills where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.supplier_bills(company_id, doc_no, bill_date, due_date, supplier_id, supplier_invoice_no, currency, fx_rate, lines_draft, total_amount, total_pkr, notes, idempotency_key, discount_amount)
    values (v_company, public.next_document_number(v_company, 'SUPPLIER_BILL'), coalesce(nullif(p_header->>'bill_date','')::date, current_date),
      nullif(p_header->>'due_date','')::date, v_sup, nullif(trim(p_header->>'supplier_invoice_no'),''), v_cur, v_fx, v_lines, t.total - v_disc, round(t.total_pkr - v_disc * v_fx, 2),
      nullif(trim(p_header->>'notes'),''), p_idempotency_key, v_disc)
    returning id into v_id;
  else
    update public.supplier_bills set bill_date = coalesce(nullif(p_header->>'bill_date','')::date, bill_date), due_date = nullif(p_header->>'due_date','')::date,
      supplier_id = v_sup, supplier_invoice_no = nullif(trim(p_header->>'supplier_invoice_no'),''), currency = v_cur, fx_rate = v_fx,
      lines_draft = v_lines, total_amount = t.total - v_disc, total_pkr = round(t.total_pkr - v_disc * v_fx, 2), discount_amount = v_disc, notes = nullif(trim(p_header->>'notes'),''), updated_at = now()
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

create or replace function public.post_supplier_bill(p_id uuid, p_pay jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
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
  v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(h.company_id, 'AP_CONTROL'), 'credit', v_gross_pkr - v_disc_pkr, 'party_type', 'SUPPLIER', 'party_id', h.supplier_id,
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
    if h.currency <> 'PKR' then raise exception 'Pay Supplier Now is for PKR bills — foreign-currency payments come with multi-currency settlement' using errcode = '22023'; end if;
    v_pay := (p_pay->>'amount')::numeric;
    perform public.inv_require(h.company_id, 'journals.create');
    perform public.supplier_pay(h.company_id, h.supplier_id, nullif(p_pay->>'bank_account_id','')::uuid, v_pay, coalesce(nullif(p_pay->>'date','')::date, h.bill_date),
      coalesce(nullif(p_pay->>'reference',''), h.supplier_invoice_no), jsonb_build_array(jsonb_build_object('bill_id', h.id, 'amount', least(v_pay, v_gross_pkr - v_disc_pkr))),
      'Payment for ' || h.doc_no);
  end if;
  return v_je;
end $$;

create or replace function public.create_bill_from_receipts(p_company_id uuid, p_receipt_ids uuid[], p_bill_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_n int; v_sup uuid; v_lines jsonb := '[]'::jsonb; l record; v_cur text; v_fx numeric; v_disc numeric;
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
  -- the purchase orders' discount, in proportion to what is billed now (same currency only)
  select coalesce(round(sum(po.discount_amount * part.v / nullif(full_v.v, 0)), 2), 0) into v_disc
    from (select pl.purchase_order_id po_id, sum(round(k.quantity * pl.unit_price, 2)) v
          from public.goods_receipt_po_links k join public.goods_receipt_lines gl on gl.id = k.receipt_line_id join public.purchase_order_lines pl on pl.id = k.po_line_id
          where gl.receipt_id = any(p_receipt_ids) and not k.reversed and gl.billed_qty = 0 and pl.unit_price is not null group by pl.purchase_order_id) part
    join public.purchase_orders po on po.id = part.po_id and po.discount_amount > 0 and po.currency = v_cur
    join lateral (select sum(round(l.quantity * l.unit_price, 2)) v from public.purchase_order_lines l where l.purchase_order_id = po.id and l.is_active and l.unit_price is not null) full_v on true;
  return public.save_supplier_bill(null, jsonb_build_object('company_id', p_company_id, 'supplier_id', v_sup, 'bill_date', coalesce(p_bill_date, current_date),
    'currency', v_cur, 'fx_rate', v_fx, 'discount_amount', v_disc), v_lines, null);
end $$;

-- Quick supplier bill: goods arrive with the supplier's invoice — receive them (one goods receipt per warehouse),
-- bill them (the bill sets the cost) and optionally pay, all at once.
-- p_header: {company_id, supplier_id, bill_date, due_date, supplier_invoice_no, currency, fx_rate, discount_amount, notes}
-- p_lines:  [{kind: ITEM|EXPENSE, product_id, variant_id, warehouse_id, location_id, quantity, unit_price, account_id, description}]
create or replace function public.quick_supplier_bill(p_header jsonb, p_lines jsonb, p_pay jsonb default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_date date := coalesce(nullif(p_header->>'bill_date','')::date, current_date);
  v_prev uuid; l jsonb; n int := 0; w uuid; v_gl jsonb; v_idx int[]; v_g uuid; i int; k int; v_map jsonb := '{}'::jsonb; v_bill_lines jsonb := '[]'::jsonb; v_bill uuid;
begin
  perform public.inv_require(v_company, 'purchasing.approve');
  perform public.inv_require(v_company, 'purchasing.costs');
  perform public.inv_require(v_company, 'inventory.receive');
  if p_idempotency_key is not null then
    select id into v_prev from public.supplier_bills where idempotency_key = p_idempotency_key;
    if v_prev is not null then return v_prev; end if;
  end if;
  if nullif(p_header->>'supplier_id','') is null then raise exception 'Choose the supplier' using errcode = '23502'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one line' using errcode = '23502'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then raise exception 'Line %: enter the quantity', n using errcode = '23502'; end if;
    if nullif(l->>'unit_price','') is null then raise exception 'Line %: enter the price', n using errcode = '23502'; end if;
    if coalesce(l->>'kind', 'ITEM') = 'ITEM' then
      if nullif(l->>'product_id','') is null then raise exception 'Line %: choose the item', n using errcode = '23502'; end if;
      if nullif(l->>'warehouse_id','') is null then raise exception 'Line %: choose the warehouse it goes into', n using errcode = '23502'; end if;
    end if;
  end loop;

  -- one goods receipt per warehouse, posted at once
  for w in select distinct (e->>'warehouse_id')::uuid from jsonb_array_elements(p_lines) e where coalesce(e->>'kind', 'ITEM') = 'ITEM' loop
    v_gl := '[]'::jsonb; v_idx := '{}';
    i := 0;
    for l in select * from jsonb_array_elements(p_lines) loop
      i := i + 1;
      if coalesce(l->>'kind', 'ITEM') = 'ITEM' and (l->>'warehouse_id')::uuid = w then
        v_gl := v_gl || jsonb_build_array(jsonb_build_object('product_id', l->>'product_id', 'variant_id', nullif(l->>'variant_id',''),
          'location_id', nullif(l->>'location_id',''), 'quantity', l->>'quantity', 'notes', nullif(trim(l->>'description'),'')));
        v_idx := v_idx || i;
      end if;
    end loop;
    v_g := public.save_goods_receipt(null, jsonb_build_object('company_id', v_company, 'warehouse_id', w, 'doc_date', v_date,
      'supplier_id', p_header->>'supplier_id', 'supplier_reference', nullif(trim(p_header->>'supplier_invoice_no'),''), 'notes', 'Quick bill'), v_gl, null);
    perform public.post_stock_document('GOODS_RECEIPT', v_g);
    for k in 1 .. array_length(v_idx, 1) loop
      v_map := v_map || jsonb_build_object(v_idx[k]::text, (select id from public.goods_receipt_lines where receipt_id = v_g and line_no = k));
    end loop;
  end loop;

  i := 0;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if coalesce(l->>'kind', 'ITEM') = 'ITEM' then
      v_bill_lines := v_bill_lines || jsonb_build_array(jsonb_build_object('kind', 'ITEM', 'receipt_line_id', v_map->>(i::text),
        'quantity', l->>'quantity', 'unit_price', l->>'unit_price', 'description', nullif(trim(l->>'description'),'')));
    else
      v_bill_lines := v_bill_lines || jsonb_build_array(jsonb_build_object('kind', 'EXPENSE', 'account_id', l->>'account_id',
        'quantity', l->>'quantity', 'unit_price', l->>'unit_price', 'description', nullif(trim(l->>'description'),'')));
    end if;
  end loop;
  v_bill := public.save_supplier_bill(null, p_header, v_bill_lines, p_idempotency_key);
  update public.supplier_bills set is_quick = true where id = v_bill;
  perform public.post_supplier_bill(v_bill, p_pay);
  return v_bill;
end $$;

revoke all on function public.quick_supplier_bill(jsonb,jsonb,jsonb,uuid), public.set_sales_order_discount(uuid,numeric) from anon;
