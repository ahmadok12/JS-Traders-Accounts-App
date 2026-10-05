-- Sales returns (customer → warehouse) and purchase returns (warehouse → supplier)
--
-- SALES RETURN (SR-) — against one posted GDN. Goods come back into a warehouse (default: the one they left).
--   * Each returned quantity first uses up the part of the GDN line that is NOT invoiced yet (gdn_lines.returned_open_qty):
--     that part simply will not be invoiced any more.
--   * Anything beyond that was invoiced (returned_credit_qty): a credit note is posted automatically
--     Dr Sales Returns / Cr Accounts Receivable at the invoiced price (after the invoice discount) and set against that invoice.
--   * Stock value: returned goods come back at the cost they left with on the GDN (Dr Inventory / Cr Cost of Goods Sold).
-- PURCHASE RETURN (PR-) — against one posted goods receipt (GRN), goods leave the receipt's warehouse.
--   * Not-yet-billed part first (goods_receipt_lines.returned_unbilled_qty): it will not be billed or costed any more.
--     If the receipt already has its cost, the value leaves Inventory against GRNI.
--   * Billed part (returned_billed_qty): value leaves at the billed cost and a supplier debit note is posted
--     Dr Accounts Payable (in the bill's currency) / Cr GRNI, set against that bill.
-- Both can be undone (reverse) with a reason. A GDN / GRN that has returns cannot itself be reversed.

-- ───────── permissions, numbering ─────────
insert into public.permissions(code, module, description, is_sensitive) values
  ('sales.return', 'sales', 'Record goods returned by customers (sales returns)', false),
  ('purchasing.return', 'purchasing', 'Return received goods to the supplier (purchase returns)', false)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values
  ('ADMINISTRATOR','sales.return'),('ADMINISTRATOR','purchasing.return'),
  ('OWNER','sales.return'),('OWNER','purchasing.return'),
  ('ACCOUNTANT','sales.return'),('ACCOUNTANT','purchasing.return'),
  ('WAREHOUSE_MANAGER','sales.return'),('WAREHOUSE_MANAGER','purchasing.return'),
  ('WAREHOUSE_MANAGER','purchasing.manage')   -- warehouse manager raises purchase orders (no prices without purchasing.costs)
) as x(role_code, p) on x.role_code = r.code
on conflict do nothing;

insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, x.t, x.p, 5, true from public.companies c
cross join (values ('SALES_RETURN','SR-'),('PURCHASE_RETURN','PR-')) as x(t, p)
on conflict do nothing;

-- ───────── returned quantities on the source lines ─────────
alter table public.gdn_lines add column if not exists returned_open_qty numeric(18,4) not null default 0 check (returned_open_qty >= 0);
alter table public.gdn_lines add column if not exists returned_credit_qty numeric(18,4) not null default 0 check (returned_credit_qty >= 0);
alter table public.goods_receipt_lines add column if not exists returned_unbilled_qty numeric(18,4) not null default 0 check (returned_unbilled_qty >= 0);
alter table public.goods_receipt_lines add column if not exists returned_billed_qty numeric(18,4) not null default 0 check (returned_billed_qty >= 0);
grant select (returned_open_qty, returned_credit_qty) on public.gdn_lines to authenticated;
grant select (returned_unbilled_qty, returned_billed_qty) on public.goods_receipt_lines to authenticated;

create or replace function public.tg_gdn_line_return_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.returned_credit_qty > new.invoiced_qty then
    raise exception 'Some of these goods were returned against the invoice — reverse the sales return first' using errcode = '22023';
  end if;
  if new.invoiced_qty + new.returned_open_qty > new.quantity then
    raise exception 'Some of these dispatched goods were returned — only % can still be invoiced', (new.quantity - new.returned_open_qty - old.invoiced_qty)::numeric(18,2) using errcode = '23514';
  end if;
  return new;
end $$;
create or replace trigger gdn_line_return_guard before update on public.gdn_lines for each row execute function public.tg_gdn_line_return_guard();

create or replace function public.tg_receipt_line_return_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.returned_billed_qty > new.billed_qty then
    raise exception 'Some of these goods were returned to the supplier after billing — reverse the purchase return first' using errcode = '22023';
  end if;
  if new.billed_qty + new.returned_unbilled_qty > new.quantity then
    raise exception 'Some of these received goods were returned to the supplier — only % can still be billed', (new.quantity - new.returned_unbilled_qty - old.billed_qty)::numeric(18,2) using errcode = '23514';
  end if;
  return new;
end $$;
create or replace trigger receipt_line_return_guard before update on public.goods_receipt_lines for each row execute function public.tg_receipt_line_return_guard();

-- a GDN / receipt with returns cannot be reversed as a whole
create or replace function public.tg_doc_return_block() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'REVERSED' and old.status = 'POSTED' then
    if tg_table_name = 'gdns' and exists (select 1 from public.sales_returns where gdn_id = new.id and status = 'POSTED') then
      raise exception 'GDN % has sales returns — reverse those first', new.doc_no using errcode = '22023';
    end if;
    if tg_table_name = 'goods_receipts' and exists (select 1 from public.purchase_returns where receipt_id = new.id and status = 'POSTED') then
      raise exception 'Receipt % has purchase returns — reverse those first', new.doc_no using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- ───────── sales returns ─────────
create table if not exists public.sales_returns (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  doc_no           text not null,
  return_date      date not null default current_date,
  customer_id      uuid not null references public.customers(id),
  gdn_id           uuid not null references public.gdns(id),
  sales_order_id   uuid references public.sales_orders(id),
  status           text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  reason           text not null,
  notes            text,
  credit_entry_id  uuid references public.journal_entries(id),
  credit_amount    numeric(18,2) not null default 0,
  idempotency_key  uuid,
  posted_at        timestamptz not null default now(),
  posted_by        uuid default auth.uid(),
  reversed_at      timestamptz, reversed_by uuid, reversal_reason text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  unique (company_id, doc_no),
  unique (company_id, idempotency_key)
);
create index if not exists sales_returns_gdn_idx on public.sales_returns(gdn_id);
create index if not exists sales_returns_customer_idx on public.sales_returns(company_id, customer_id, return_date);

create table if not exists public.sales_return_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  return_id      uuid not null references public.sales_returns(id),
  line_no        int not null,
  gdn_line_id    uuid not null references public.gdn_lines(id),
  product_id     uuid not null references public.products(id),
  variant_id     uuid references public.product_variants(id),
  warehouse_id   uuid not null references public.warehouses(id),
  quantity       numeric(18,4) not null check (quantity > 0),
  condition      text not null default 'GOOD' check (condition in ('GOOD','DAMAGED')),
  open_qty       numeric(18,4) not null default 0,   -- not yet invoiced part
  credit_qty     numeric(18,4) not null default 0,   -- invoiced part (credit note)
  invoice_id     uuid references public.sales_invoices(id),
  unit_price     numeric(18,4),                      -- price-protected
  credit_amount  numeric(18,2) not null default 0,   -- price-protected
  notes          text
);
create index if not exists sales_return_lines_ret_idx on public.sales_return_lines(return_id);
create index if not exists sales_return_lines_gdnl_idx on public.sales_return_lines(gdn_line_id);

alter table public.sales_returns enable row level security;
alter table public.sales_return_lines enable row level security;
revoke all on public.sales_returns, public.sales_return_lines from anon, authenticated;
grant select (id, company_id, doc_no, return_date, customer_id, gdn_id, sales_order_id, status, reason, notes, credit_entry_id, posted_at, posted_by,
  reversed_at, reversed_by, reversal_reason, created_at, created_by) on public.sales_returns to authenticated;
grant select (id, company_id, return_id, line_no, gdn_line_id, product_id, variant_id, warehouse_id, quantity, condition, open_qty, credit_qty, invoice_id, notes)
  on public.sales_return_lines to authenticated;
create policy sr_select on public.sales_returns for select to authenticated
  using ((public.has_permission(company_id, 'sales.view') or public.has_permission(company_id, 'sales.return') or public.has_permission(company_id, 'inventory.view'))
         and public.can_access_customer(customer_id));
create policy srl_select on public.sales_return_lines for select to authenticated
  using (exists (select 1 from public.sales_returns h where h.id = return_id));
create trigger audit after insert or update on public.sales_returns for each row execute function public.tg_audit_row();

-- ───────── purchase returns ─────────
create table if not exists public.purchase_returns (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  doc_no            text not null,
  return_date       date not null default current_date,
  supplier_id       uuid not null references public.suppliers(id),
  receipt_id        uuid not null references public.goods_receipts(id),
  warehouse_id      uuid not null references public.warehouses(id),
  status            text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  reason            text not null,
  notes             text,
  debit_entry_ids   uuid[] not null default '{}',
  value_pkr         numeric(18,2) not null default 0,   -- cost-protected
  idempotency_key   uuid,
  posted_at         timestamptz not null default now(),
  posted_by         uuid default auth.uid(),
  reversed_at       timestamptz, reversed_by uuid, reversal_reason text,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  unique (company_id, doc_no),
  unique (company_id, idempotency_key)
);
create index if not exists purchase_returns_receipt_idx on public.purchase_returns(receipt_id);
create index if not exists purchase_returns_supplier_idx on public.purchase_returns(company_id, supplier_id, return_date);

create table if not exists public.purchase_return_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  return_id       uuid not null references public.purchase_returns(id),
  line_no         int not null,
  receipt_line_id uuid not null references public.goods_receipt_lines(id),
  product_id      uuid not null references public.products(id),
  variant_id      uuid references public.product_variants(id),
  quantity        numeric(18,4) not null check (quantity > 0),
  unbilled_qty    numeric(18,4) not null default 0,
  billed_qty      numeric(18,4) not null default 0,
  bill_id         uuid references public.supplier_bills(id),
  unit_value_pkr  numeric(18,6),     -- cost-protected; null = cost not known yet
  value_pkr       numeric(18,2),     -- cost-protected
  billed_pkr      numeric(18,2) not null default 0,
  billed_fx       numeric(18,4),
  notes           text
);
create index if not exists purchase_return_lines_ret_idx on public.purchase_return_lines(return_id);
create index if not exists purchase_return_lines_rl_idx on public.purchase_return_lines(receipt_line_id);

alter table public.purchase_returns enable row level security;
alter table public.purchase_return_lines enable row level security;
revoke all on public.purchase_returns, public.purchase_return_lines from anon, authenticated;
grant select (id, company_id, doc_no, return_date, supplier_id, receipt_id, warehouse_id, status, reason, notes, debit_entry_ids, posted_at, posted_by,
  reversed_at, reversed_by, reversal_reason, created_at, created_by) on public.purchase_returns to authenticated;
grant select (id, company_id, return_id, line_no, receipt_line_id, product_id, variant_id, quantity, unbilled_qty, billed_qty, bill_id, notes)
  on public.purchase_return_lines to authenticated;
create policy pr_select on public.purchase_returns for select to authenticated
  using (public.has_permission(company_id, 'purchasing.view') or public.has_permission(company_id, 'purchasing.return') or public.has_permission(company_id, 'inventory.view'));
create policy prl_select on public.purchase_return_lines for select to authenticated
  using (exists (select 1 from public.purchase_returns h where h.id = return_id));
create trigger audit after insert or update on public.purchase_returns for each row execute function public.tg_audit_row();

create or replace trigger doc_return_block before update of status on public.gdns for each row execute function public.tg_doc_return_block();
create or replace trigger doc_return_block before update of status on public.goods_receipts for each row execute function public.tg_doc_return_block();

-- ───────── what can still be returned ─────────
create or replace function public.returnable_gdn_lines(p_gdn_id uuid)
returns table(gdn_line_id uuid, line_no int, product_id uuid, variant_id uuid, sku text, product_name text, variant_name text, uom text,
  warehouse_id uuid, warehouse_name text, dispatched numeric, invoiced numeric, returned numeric, returnable numeric)
language plpgsql stable security definer set search_path = '' as $$
declare g record;
begin
  select * into g from public.gdns where id = p_gdn_id;
  if g.id is null then raise exception 'GDN not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(g.company_id, 'sales.return') or public.has_permission(g.company_id, 'sales.view')) or not public.can_access_customer(g.customer_id) then
    raise exception 'You do not have access to this GDN' using errcode = '42501';
  end if;
  return query
  select l.id, l.line_no, l.product_id, l.variant_id, coalesce(v.sku, p.sku)::text, p.name::text, v.name::text, u.code::text, l.warehouse_id, w.name::text,
         l.quantity, l.invoiced_qty, l.returned_open_qty + l.returned_credit_qty, l.quantity - l.returned_open_qty - l.returned_credit_qty
  from public.gdn_lines l join public.products p on p.id = l.product_id left join public.product_variants v on v.id = l.variant_id
  left join public.units_of_measure u on u.id = p.base_uom_id join public.warehouses w on w.id = l.warehouse_id
  where l.gdn_id = p_gdn_id order by l.line_no;
end $$;
revoke execute on function public.returnable_gdn_lines(uuid) from public, anon;
grant execute on function public.returnable_gdn_lines(uuid) to authenticated;

create or replace function public.returnable_receipt_lines(p_receipt_id uuid)
returns table(receipt_line_id uuid, line_no int, product_id uuid, variant_id uuid, sku text, product_name text, variant_name text, uom text,
  received numeric, billed numeric, returned numeric, returnable numeric, on_hand numeric)
language plpgsql stable security definer set search_path = '' as $$
declare g record;
begin
  select * into g from public.goods_receipts where id = p_receipt_id;
  if g.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(g.company_id, 'purchasing.return') or public.has_permission(g.company_id, 'inventory.view')) then
    raise exception 'You do not have access to this receipt' using errcode = '42501';
  end if;
  return query
  select l.id, l.line_no, l.product_id, l.variant_id, coalesce(v.sku, p.sku)::text, p.name::text, v.name::text, u.code::text,
         l.quantity, l.billed_qty, l.returned_unbilled_qty + l.returned_billed_qty, l.quantity - l.returned_unbilled_qty - l.returned_billed_qty,
         coalesce((select sum(b.on_hand) from public.stock_balances b where b.warehouse_id = g.warehouse_id and b.product_id = l.product_id
                    and b.variant_id is not distinct from l.variant_id), 0)
  from public.goods_receipt_lines l join public.products p on p.id = l.product_id left join public.product_variants v on v.id = l.variant_id
  left join public.units_of_measure u on u.id = p.base_uom_id
  where l.receipt_id = p_receipt_id order by l.line_no;
end $$;
revoke execute on function public.returnable_receipt_lines(uuid) from public, anon;
grant execute on function public.returnable_receipt_lines(uuid) to authenticated;

-- ───────── post a sales return ─────────
-- p_header: {gdn_id, return_date, reason, notes}; p_lines: [{gdn_line_id, quantity, warehouse_id?, condition?, notes?}]
create or replace function public.post_sales_return(p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g record; v_id uuid; v_doc text; l jsonb; gl record; n int := 0; q numeric; v_open numeric; v_take numeric; v_credit numeric;
  v_wh uuid; v_line uuid; v_bundle boolean; b record; v_inv uuid; v_price numeric; v_sub numeric; v_itot numeric; v_factor numeric; v_amt numeric; v_total numeric := 0; v_je uuid;
  v_date date := coalesce(nullif(p_header->>'return_date','')::date, current_date); v_reason text := nullif(trim(p_header->>'reason'),'');
  v_cname text; inv record; v_out numeric;
begin
  select * into g from public.gdns where id = nullif(p_header->>'gdn_id','')::uuid for update;
  if g.id is null then raise exception 'Choose the GDN the goods were dispatched on' using errcode = '23502'; end if;
  perform public.inv_require(g.company_id, 'sales.return');
  if not public.can_access_customer(g.customer_id) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;
  if p_idempotency_key is not null then
    select id into v_id from public.sales_returns where company_id = g.company_id and idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  if g.status <> 'POSTED' then raise exception 'GDN % is not dispatched (it is %)', g.doc_no, lower(g.status) using errcode = '22023'; end if;
  if v_reason is null then raise exception 'Enter the reason for the return' using errcode = '23502'; end if;
  if v_date < g.gdn_date then raise exception 'The return date cannot be before the GDN date (%)', g.gdn_date using errcode = '22023'; end if;
  if v_date > current_date then raise exception 'The return date cannot be in the future' using errcode = '22023'; end if;

  v_doc := public.next_document_number(g.company_id, 'SALES_RETURN');
  insert into public.sales_returns(company_id, doc_no, return_date, customer_id, gdn_id, sales_order_id, reason, notes, idempotency_key)
  values (g.company_id, v_doc, v_date, g.customer_id, g.id, g.sales_order_id, v_reason, nullif(trim(p_header->>'notes'),''), p_idempotency_key)
  returning id into v_id;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce(nullif(l->>'quantity','')::numeric, 0);
    if q = 0 then continue; end if;
    n := n + 1;
    if q < 0 then raise exception 'Line %: quantity cannot be negative', n using errcode = '23514'; end if;
    select * into gl from public.gdn_lines where id = (l->>'gdn_line_id')::uuid and gdn_id = g.id for update;
    if gl.id is null then raise exception 'Line %: this item is not on GDN %', n, g.doc_no using errcode = '22023'; end if;
    if q > gl.quantity - gl.returned_open_qty - gl.returned_credit_qty then
      raise exception 'Line %: only % can still be returned (dispatched %, already returned %)', n,
        (gl.quantity - gl.returned_open_qty - gl.returned_credit_qty)::numeric(18,2), gl.quantity::numeric(18,2), (gl.returned_open_qty + gl.returned_credit_qty)::numeric(18,2)
        using errcode = '23514';
    end if;
    v_wh := coalesce(nullif(l->>'warehouse_id','')::uuid, gl.warehouse_id);
    perform public.inv_check_warehouse(g.company_id, v_wh);
    v_open := greatest(gl.quantity - gl.invoiced_qty - gl.returned_open_qty, 0);
    v_take := least(q, v_open);
    v_credit := q - v_take;
    v_inv := null; v_price := null; v_amt := 0;
    if v_credit > 0 then
      select sl.unit_price, sl.invoice_id, i.subtotal, i.total_amount into v_price, v_inv, v_sub, v_itot
        from public.sales_invoice_lines sl join public.sales_invoices i on i.id = sl.invoice_id
       where i.status = 'POSTED' and sl.sources @> jsonb_build_array(jsonb_build_object('gdn_line_id', gl.id::text))
       order by i.invoice_date desc, i.created_at desc limit 1;
      if v_inv is null then raise exception 'Line %: the invoice for these goods was not found', n using errcode = 'P0002'; end if;
      v_factor := case when coalesce(v_sub, 0) > 0 then v_itot / v_sub else 1 end;
      v_amt := round(v_credit * v_price * v_factor, 2);
      v_total := v_total + v_amt;
    end if;
    update public.gdn_lines set returned_open_qty = returned_open_qty + v_take, returned_credit_qty = returned_credit_qty + v_credit where id = gl.id;
    insert into public.sales_return_lines(company_id, return_id, line_no, gdn_line_id, product_id, variant_id, warehouse_id, quantity, condition,
      open_qty, credit_qty, invoice_id, unit_price, credit_amount, notes)
    values (g.company_id, v_id, n, gl.id, gl.product_id, gl.variant_id, v_wh, q, coalesce(nullif(l->>'condition',''), 'GOOD'),
      v_take, v_credit, v_inv, case when v_credit > 0 then round(v_price * v_factor, 4) end, v_amt, nullif(trim(l->>'notes'),''))
    returning id into v_line;

    select is_bundle into v_bundle from public.products where id = gl.product_id;
    if v_bundle then
      for b in select * from public.product_bom(gl.product_id, gl.variant_id) loop
        perform public.inv_apply_movement(g.company_id, v_date, 'RETURN', v_wh, null, b.component_product_id, b.component_variant_id,
          b.quantity * q, 'SALES_RETURN', v_id, v_line, v_doc, v_reason);
      end loop;
    else
      perform public.inv_apply_movement(g.company_id, v_date, 'RETURN', v_wh, null, gl.product_id, gl.variant_id, q, 'SALES_RETURN', v_id, v_line, v_doc, v_reason);
    end if;
  end loop;
  if n = 0 then raise exception 'Enter the quantity returned for at least one item' using errcode = '23502'; end if;

  if v_total > 0 then
    select name into v_cname from public.customers where id = g.customer_id;
    v_je := public.acc_post_document_entry(g.company_id, 'SYSTEM', v_date, 'Sales return ' || v_doc || ' — ' || v_cname || ' (credit note)', g.doc_no,
      'CUSTOMER', g.customer_id, null, v_total,
      jsonb_build_array(
        jsonb_build_object('account_id', public.hr_account(g.company_id, 'SALES_RETURNS'), 'debit', v_total, 'description', 'Goods returned ' || v_doc),
        jsonb_build_object('account_id', public.hr_account(g.company_id, 'AR_CONTROL'), 'credit', v_total, 'party_type', 'CUSTOMER', 'party_id', g.customer_id,
          'description', 'Credit for return ' || v_doc)),
      'SALES_RETURN', v_id);
    update public.sales_returns set credit_entry_id = v_je, credit_amount = v_total where id = v_id;
    -- set the credit against the invoices the goods were billed on (as much as they still owe)
    for inv in select invoice_id, sum(credit_amount) amt from public.sales_return_lines where return_id = v_id and credit_amount > 0 group by invoice_id loop
      select outstanding into v_out from public.sales_invoices_v where id = inv.invoice_id;
      if coalesce(v_out, 0) > 0 then perform public.inv_allocate(v_je, inv.invoice_id, least(inv.amt, v_out)); end if;
    end loop;
  end if;
  return v_id;
end $$;
revoke execute on function public.post_sales_return(jsonb, jsonb, uuid) from public, anon;
grant execute on function public.post_sales_return(jsonb, jsonb, uuid) to authenticated;

create or replace function public.reverse_sales_return(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; m record; l record; v_count int := 0;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to reverse a return' using errcode = '23502'; end if;
  select * into h from public.sales_returns where id = p_id for update;
  if h.id is null then raise exception 'Sales return not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.return');
  if h.status = 'REVERSED' then return jsonb_build_object('status','REVERSED','already',true); end if;
  for m in select * from public.stock_movements where source_type = 'SALES_RETURN' and source_id = p_id and reversal_of is null order by created_at loop
    perform public.inv_check_warehouse(h.company_id, m.warehouse_id);
    perform public.inv_move(m.company_id, current_date, m.movement_type, m.warehouse_id, m.location_id, m.product_id, m.variant_id, -m.quantity,
      'SALES_RETURN', p_id, m.source_line_id, h.doc_no, 'REVERSAL: ' || p_reason, m.id, m.physical_unit_id);
    v_count := v_count + 1;
  end loop;
  for l in select * from public.sales_return_lines where return_id = p_id loop
    update public.gdn_lines set returned_open_qty = returned_open_qty - l.open_qty, returned_credit_qty = returned_credit_qty - l.credit_qty where id = l.gdn_line_id;
  end loop;
  if h.credit_entry_id is not null then
    update public.receipt_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid() where receipt_entry_id = h.credit_entry_id and status = 'ACTIVE';
    perform public.acc_reverse_document_entry(h.credit_entry_id, 'Sales return ' || h.doc_no || ' reversed: ' || p_reason, current_date);
  end if;
  update public.sales_returns set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason where id = p_id;
  return jsonb_build_object('status','REVERSED','movements', v_count);
end $$;
revoke execute on function public.reverse_sales_return(uuid, text) from public, anon;
grant execute on function public.reverse_sales_return(uuid, text) to authenticated;

-- ───────── post a purchase return ─────────
-- p_header: {receipt_id, return_date, reason, notes}; p_lines: [{receipt_line_id, quantity, notes?}]
create or replace function public.post_purchase_return(p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g record; v_id uuid; v_doc text; l jsonb; rl record; n int := 0; q numeric; v_unb numeric; v_take numeric; v_billed numeric;
  v_bid uuid; v_bpkr numeric; v_bqty numeric; v_bfx numeric; v_bcur text; v_unit_b numeric; v_val numeric; v_line uuid; v_total numeric := 0; d record; v_je uuid; v_jes uuid[] := '{}'; v_bill record;
  v_amt numeric; v_fx numeric; v_sname text;
  v_date date := coalesce(nullif(p_header->>'return_date','')::date, current_date); v_reason text := nullif(trim(p_header->>'reason'),'');
begin
  select * into g from public.goods_receipts where id = nullif(p_header->>'receipt_id','')::uuid for update;
  if g.id is null then raise exception 'Choose the goods receipt (GRN) the goods came in on' using errcode = '23502'; end if;
  perform public.inv_require(g.company_id, 'purchasing.return');
  if p_idempotency_key is not null then
    select id into v_id from public.purchase_returns where company_id = g.company_id and idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  if g.status <> 'POSTED' then raise exception 'Receipt % is not posted (it is %)', g.doc_no, lower(g.status) using errcode = '22023'; end if;
  if g.supplier_id is null then raise exception 'Receipt % has no supplier — goods can only be returned to a supplier', g.doc_no using errcode = '22023'; end if;
  perform public.inv_check_warehouse(g.company_id, g.warehouse_id);
  if v_reason is null then raise exception 'Enter the reason for the return' using errcode = '23502'; end if;
  if v_date < g.doc_date then raise exception 'The return date cannot be before the receipt date (%)', g.doc_date using errcode = '22023'; end if;
  if v_date > current_date then raise exception 'The return date cannot be in the future' using errcode = '22023'; end if;

  v_doc := public.next_document_number(g.company_id, 'PURCHASE_RETURN');
  insert into public.purchase_returns(company_id, doc_no, return_date, supplier_id, receipt_id, warehouse_id, reason, notes, idempotency_key)
  values (g.company_id, v_doc, v_date, g.supplier_id, g.id, g.warehouse_id, v_reason, nullif(trim(p_header->>'notes'),''), p_idempotency_key)
  returning id into v_id;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce(nullif(l->>'quantity','')::numeric, 0);
    if q = 0 then continue; end if;
    n := n + 1;
    if q < 0 then raise exception 'Line %: quantity cannot be negative', n using errcode = '23514'; end if;
    select * into rl from public.goods_receipt_lines where id = (l->>'receipt_line_id')::uuid and receipt_id = g.id for update;
    if rl.id is null then raise exception 'Line %: this item is not on receipt %', n, g.doc_no using errcode = '22023'; end if;
    if q > rl.quantity - rl.returned_unbilled_qty - rl.returned_billed_qty then
      raise exception 'Line %: only % can still be returned (received %, already returned %)', n,
        (rl.quantity - rl.returned_unbilled_qty - rl.returned_billed_qty)::numeric(18,2), rl.quantity::numeric(18,2), (rl.returned_unbilled_qty + rl.returned_billed_qty)::numeric(18,2)
        using errcode = '23514';
    end if;
    v_unb := greatest(rl.quantity - rl.billed_qty - rl.returned_unbilled_qty, 0);
    v_take := least(q, v_unb);
    v_billed := q - v_take;
    v_bid := null; v_unit_b := null; v_bcur := null; v_bfx := null;
    if v_billed > 0 then
      select sl.amount_pkr, sl.quantity, b.id, b.fx_rate, b.currency into v_bpkr, v_bqty, v_bid, v_bfx, v_bcur
        from public.supplier_bill_lines sl join public.supplier_bills b on b.id = sl.bill_id
       where sl.receipt_line_id = rl.id and b.status = 'POSTED' order by b.bill_date desc, b.created_at desc limit 1;
      if v_bid is null then raise exception 'Line %: the supplier bill for these goods was not found', n using errcode = 'P0002'; end if;
      v_unit_b := v_bpkr / v_bqty;
    end if;
    -- value leaving: unbilled part at the receipt cost (unknown → none), billed part at the billed cost
    if v_take > 0 and rl.unit_cost_pkr is null and v_billed = 0 then
      v_val := null;
    else
      v_val := round(v_take * coalesce(rl.unit_cost_pkr, 0) + v_billed * coalesce(v_unit_b, 0), 2);
      v_total := v_total + v_val;
    end if;
    update public.goods_receipt_lines set returned_unbilled_qty = returned_unbilled_qty + v_take, returned_billed_qty = returned_billed_qty + v_billed where id = rl.id;
    insert into public.purchase_return_lines(company_id, return_id, line_no, receipt_line_id, product_id, variant_id, quantity, unbilled_qty, billed_qty,
      bill_id, unit_value_pkr, value_pkr, billed_pkr, billed_fx, notes)
    values (g.company_id, v_id, n, rl.id, rl.product_id, rl.variant_id, q, v_take, v_billed, v_bid,
      case when v_val is not null then v_val / q end, v_val,
      case when v_billed > 0 then round(v_billed * v_unit_b, 2) else 0 end,
      case when v_billed > 0 and v_bcur <> 'PKR' then round(v_billed * v_unit_b / v_bfx, 4) end,
      nullif(trim(l->>'notes'),''))
    returning id into v_line;
    perform public.inv_issue_stock(g.company_id, v_date, 'RETURN', g.warehouse_id, null, rl.product_id, rl.variant_id, q,
      'PURCHASE_RETURN', v_id, v_line, v_doc, v_reason);
  end loop;
  if n = 0 then raise exception 'Enter the quantity to return for at least one item' using errcode = '23502'; end if;
  update public.purchase_returns set value_pkr = v_total where id = v_id;

  -- billed goods: supplier debit note per bill, set against that bill
  select name into v_sname from public.suppliers where id = g.supplier_id;
  for d in select bill_id, sum(billed_pkr) pkr, sum(billed_fx) fx from public.purchase_return_lines where return_id = v_id and billed_qty > 0 group by bill_id loop
    select * into v_bill from public.supplier_bills_v where id = d.bill_id;
    v_je := public.acc_post_document_entry(g.company_id, 'SYSTEM', v_date, 'Purchase return ' || v_doc || ' — ' || v_sname || ' (debit note on ' || v_bill.doc_no || ')',
      v_bill.doc_no, 'SUPPLIER', g.supplier_id, null, d.pkr,
      jsonb_build_array(
        jsonb_build_object('account_id', public.hr_account(g.company_id, 'AP_CONTROL'), 'debit', d.pkr, 'party_type', 'SUPPLIER', 'party_id', g.supplier_id,
          'currency', case when v_bill.currency <> 'PKR' then v_bill.currency end, 'fx_amount', case when v_bill.currency <> 'PKR' then d.fx end,
          'fx_rate', case when v_bill.currency <> 'PKR' then v_bill.fx_rate end, 'description', 'Goods returned ' || v_doc),
        jsonb_build_object('account_id', public.hr_account(g.company_id, 'GRNI'), 'credit', d.pkr, 'description', 'Returned to supplier ' || v_doc)),
      'PURCHASE_RETURN', v_id);
    v_jes := v_jes || v_je;
    if v_bill.currency = 'PKR' then
      v_amt := least(d.pkr, v_bill.outstanding_pkr); v_fx := null;
    else
      v_fx := least(d.fx, v_bill.outstanding_fx); v_amt := round(v_fx * v_bill.fx_rate, 2);
    end if;
    if coalesce(v_amt, 0) > 0 then
      insert into public.supplier_bill_allocations(company_id, payment_entry_id, bill_id, amount, fx_amount, bill_rate, pay_rate, pkr_at_payment, fx_diff, settle_date)
      values (g.company_id, v_je, d.bill_id, v_amt, v_fx, case when v_fx is not null then v_bill.fx_rate end, case when v_fx is not null then v_bill.fx_rate end,
        v_amt, 0, v_date);
    end if;
  end loop;
  update public.purchase_returns set debit_entry_ids = v_jes where id = v_id;
  return v_id;
end $$;
revoke execute on function public.post_purchase_return(jsonb, jsonb, uuid) from public, anon;
grant execute on function public.post_purchase_return(jsonb, jsonb, uuid) to authenticated;

create or replace function public.reverse_purchase_return(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; m record; l record; v_count int := 0; e uuid;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to reverse a return' using errcode = '23502'; end if;
  select * into h from public.purchase_returns where id = p_id for update;
  if h.id is null then raise exception 'Purchase return not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.return');
  if h.status = 'REVERSED' then return jsonb_build_object('status','REVERSED','already',true); end if;
  perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
  for m in select * from public.stock_movements where source_type = 'PURCHASE_RETURN' and source_id = p_id and reversal_of is null order by created_at loop
    perform public.inv_move(m.company_id, current_date, m.movement_type, m.warehouse_id, m.location_id, m.product_id, m.variant_id, -m.quantity,
      'PURCHASE_RETURN', p_id, m.source_line_id, h.doc_no, 'REVERSAL: ' || p_reason, m.id, m.physical_unit_id);
    v_count := v_count + 1;
  end loop;
  for l in select * from public.purchase_return_lines where return_id = p_id loop
    update public.goods_receipt_lines set returned_unbilled_qty = returned_unbilled_qty - l.unbilled_qty, returned_billed_qty = returned_billed_qty - l.billed_qty where id = l.receipt_line_id;
  end loop;
  foreach e in array h.debit_entry_ids loop
    update public.supplier_bill_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid() where payment_entry_id = e and status = 'ACTIVE';
    perform public.acc_reverse_document_entry(e, 'Purchase return ' || h.doc_no || ' reversed: ' || p_reason, current_date);
  end loop;
  update public.purchase_returns set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason where id = p_id;
  return jsonb_build_object('status','REVERSED','movements', v_count);
end $$;
revoke execute on function public.reverse_purchase_return(uuid, text) from public, anon;
grant execute on function public.reverse_purchase_return(uuid, text) to authenticated;

-- amounts for people allowed to see them
create or replace function public.return_amounts(p_kind text, p_id uuid)
returns table(line_id uuid, unit_amount numeric, amount numeric, total numeric)
language plpgsql stable security definer set search_path = '' as $$
declare c uuid;
begin
  if p_kind = 'SALES' then
    select company_id into c from public.sales_returns where id = p_id;
    if c is null or not public.has_permission(c, 'sales.view_prices') then return; end if;
    return query select l.id, l.unit_price, l.credit_amount, h.credit_amount from public.sales_return_lines l join public.sales_returns h on h.id = l.return_id where l.return_id = p_id;
  else
    select company_id into c from public.purchase_returns where id = p_id;
    if c is null or not public.has_permission(c, 'purchasing.costs') then return; end if;
    return query select l.id, l.unit_value_pkr, l.value_pkr, h.value_pkr from public.purchase_return_lines l join public.purchase_returns h on h.id = l.return_id where l.return_id = p_id;
  end if;
end $$;
revoke execute on function public.return_amounts(text, uuid) from public, anon;
grant execute on function public.return_amounts(text, uuid) to authenticated;

-- ───────── existing functions learn about returns ─────────
do $do$
declare d text; o text;
begin
  -- stock valuation
  d := pg_get_functiondef('public.inv_value_flush()'::regprocedure); o := d;
  d := regexp_replace(d, $re$x := -m\.quantity;\s+if m\.source_type = 'GOODS_RECEIPT' then$re$, $rp$x := -m.quantity;
      if m.source_type in ('SALES_RETURN','PURCHASE_RETURN') then
        if m.reversal_of is not null then
          -- a customer return undone: out at the value it came in with
          select v.value, v.unit_cost into val, unit from public.stock_valuations v where v.movement_id = m.reversal_of;
          if unit is null and coalesce(val, 0) = 0 then
            update public.item_costs set qty = qty - x, pending_qty = greatest(pending_qty - x, 0), updated_at = now() where id = r.id;
            val := 0;
          else
            val := coalesce(val, 0);
            update public.item_costs set qty = qty - x, value = value - val, updated_at = now() where id = r.id;
          end if;
        else
          -- back to the supplier: at the receipt / billed cost (unknown → the goods were still waiting for a cost)
          select l.unit_value_pkr into unit from public.purchase_return_lines l where l.id = m.source_line_id;
          if unit is null then
            update public.item_costs set qty = qty - x, pending_qty = greatest(pending_qty - x, 0), updated_at = now() where id = r.id;
            val := 0;
          else
            val := round(x * unit, 2);
            update public.item_costs set qty = qty - x, value = value - val, updated_at = now() where id = r.id;
          end if;
        end if;
      elsif m.source_type = 'GOODS_RECEIPT' then$rp$);
  if d = o then raise exception 'inv_value_flush: out-branch not found'; end if; o := d;
  d := replace(d, $s$if m.reversal_of is not null and exists (select 1 from public.stock_valuations v where v.movement_id = m.reversal_of and v.value is not null) then$s$,
    $s$if m.source_type = 'PURCHASE_RETURN' then
        -- a return to the supplier undone: back at the value it left with (or waiting for a cost again)
        select v.value, v.unit_cost into val, unit from public.stock_valuations v where v.movement_id = m.reversal_of;
        if unit is null and coalesce(val, 0) = 0 then
          update public.item_costs set qty = qty + x, pending_qty = pending_qty + x, updated_at = now() where id = r.id;
          val := 0;
        else
          val := -coalesce(val, 0);
          update public.item_costs set qty = qty + x, value = value + val, updated_at = now() where id = r.id;
        end if;
      elsif m.source_type = 'SALES_RETURN' then
        -- customer return: back at the cost it left with on the GDN
        select -sum(v.value) / nullif(sum(-o.quantity), 0) into unit
          from public.sales_return_lines rl join public.stock_movements o on o.source_type = 'GDN' and o.source_line_id = rl.gdn_line_id
          join public.stock_valuations v on v.movement_id = o.id and v.done
         where rl.id = m.source_line_id and o.product_id = m.product_id and o.variant_id is not distinct from m.variant_id and o.quantity < 0 and o.reversal_of is null;
        if unit is null then unit := case when c > 0 then r.value / c else r.last_cost end; end if;
        if unit is null then
          update public.item_costs set qty = qty + x, pending_qty = pending_qty + x, updated_at = now() where id = r.id;
          val := 0;
        else
          val := round(x * unit, 2);
          update public.item_costs set qty = qty + x, value = value + val, updated_at = now() where id = r.id;
        end if;
      elsif m.reversal_of is not null and exists (select 1 from public.stock_valuations v where v.movement_id = m.reversal_of and v.value is not null) then$s$);
  if d = o then raise exception 'inv_value_flush: in-branch not found'; end if; o := d;
  d := replace(d, $s$when m.source_type = 'GDN' then 'COGS'$s$, $s$when m.source_type = 'SALES_RETURN' then 'COGS'
        when m.source_type = 'PURCHASE_RETURN' then 'GRNI'
        when m.source_type = 'GDN' then 'COGS'$s$);
  if d = o then raise exception 'inv_value_flush: key case not found'; end if;
  execute d;

  -- invoices: returned (not invoiced) goods are no longer to invoice
  d := pg_get_functiondef('public.create_invoice_from_gdns(uuid, uuid[], date)'::regprocedure); o := d;
  d := replace(d, 'gl.quantity - gl.invoiced_qty', 'gl.quantity - gl.returned_open_qty - gl.invoiced_qty');
  d := replace(d, 'gl.quantity > gl.invoiced_qty', 'gl.quantity - gl.returned_open_qty > gl.invoiced_qty');
  if d = o then raise exception 'create_invoice_from_gdns not patched'; end if;
  execute d;

  -- bills / receipt costs: goods returned before billing are not billed or costed
  d := pg_get_functiondef('public.create_bill_from_receipts(uuid, uuid[], date)'::regprocedure); o := d;
  d := replace(d, 'gl.quantity > gl.billed_qty', 'gl.quantity - gl.returned_unbilled_qty > gl.billed_qty');
  d := replace(d, $s$'quantity', l.quantity - l.billed_qty$s$, $s$'quantity', l.quantity - l.returned_unbilled_qty - l.billed_qty$s$);
  if d = o then raise exception 'create_bill_from_receipts not patched'; end if;
  execute d;

  d := pg_get_functiondef('public.bill_check_lines(uuid, uuid, uuid, jsonb, boolean)'::regprocedure); o := d;
  d := replace(d, 'q > r.quantity - r.billed_qty', 'q > r.quantity - r.returned_unbilled_qty - r.billed_qty');
  d := replace(d, '(r.quantity - r.billed_qty), r.doc_no', '(r.quantity - r.returned_unbilled_qty - r.billed_qty), r.doc_no');
  if d = o then raise exception 'bill_check_lines not patched'; end if;
  execute d;

  d := pg_get_functiondef('public.receipt_apply_costs(uuid, text, numeric, jsonb, text)'::regprocedure); o := d;
  d := replace(d, 'round(v_pkr * l.quantity, 2)', 'round(v_pkr * (l.quantity - l.returned_unbilled_qty), 2)');
  if d = o then raise exception 'receipt_apply_costs not patched'; end if;
  execute d;

  d := pg_get_functiondef('public.tg_receipt_line_cost()'::regprocedure); o := d;
  d := replace(d, $s$'PENDING', new.quantity, round(new.quantity * coalesce(new.unit_cost_pkr, 0), 2)$s$,
    $s$'PENDING', new.quantity - new.returned_unbilled_qty, round((new.quantity - new.returned_unbilled_qty) * coalesce(new.unit_cost_pkr, 0), 2)$s$);
  if d = o then raise exception 'tg_receipt_line_cost not patched'; end if;
  execute d;
end $do$;

-- ───────── reports ─────────
create or replace function public.rpt_dispatch_register(p_company uuid, p_from date, p_to date, p_warehouse uuid default null, p_customer uuid default null)
returns table(gdn_id uuid, doc_no text, gdn_date date, status text, sales_order text, customer_id uuid, customer text, warehouse text, sku text, item text, variant text,
              quantity numeric, invoiced_qty numeric, not_invoiced numeric)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.doc_no, g.gdn_date, g.status, so.doc_no, g.customer_id, cu.name, w.name, coalesce(pv.sku, p.sku), p.name, pv.name, l.quantity, l.invoiced_qty,
         l.quantity - l.invoiced_qty - l.returned_open_qty
  from public.gdn_lines l
  join public.gdns g on g.id = l.gdn_id
  join public.customers cu on cu.id = g.customer_id
  left join public.sales_orders so on so.id = g.sales_order_id
  join public.warehouses w on w.id = l.warehouse_id
  join public.products p on p.id = l.product_id
  left join public.product_variants pv on pv.id = l.variant_id
  where l.company_id = p_company and g.status = 'POSTED' and (p_from is null or g.gdn_date >= p_from) and (p_to is null or g.gdn_date <= p_to)
    and (p_warehouse is null or l.warehouse_id = p_warehouse) and (p_customer is null or g.customer_id = p_customer)
  order by g.gdn_date, g.doc_no, l.line_no;
$$;

create or replace function public.rpt_sales_returns(p_company uuid, p_from date, p_to date, p_warehouse uuid default null, p_customer uuid default null)
returns table(return_id uuid, doc_no text, return_date date, status text, gdn_no text, customer_id uuid, customer text, warehouse text, sku text, item text, variant text,
              quantity numeric, condition text, not_invoiced_qty numeric, credited_qty numeric, credit_amount numeric, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_prices boolean;
begin
  if not (public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'sales.return') or public.has_permission(p_company, 'inventory.view')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_prices := public.has_permission(p_company, 'sales.view_prices');
  return query
  select h.id, h.doc_no, h.return_date, h.status, g.doc_no, h.customer_id, cu.name::text, w.name::text, coalesce(pv.sku, p.sku)::text, p.name::text, pv.name::text,
         l.quantity, l.condition, l.open_qty, l.credit_qty, case when v_prices then l.credit_amount end, h.reason
  from public.sales_return_lines l join public.sales_returns h on h.id = l.return_id join public.gdns g on g.id = h.gdn_id
  join public.customers cu on cu.id = h.customer_id join public.warehouses w on w.id = l.warehouse_id
  join public.products p on p.id = l.product_id left join public.product_variants pv on pv.id = l.variant_id
  where h.company_id = p_company and (p_from is null or h.return_date >= p_from) and (p_to is null or h.return_date <= p_to)
    and (p_warehouse is null or l.warehouse_id = p_warehouse) and (p_customer is null or h.customer_id = p_customer)
    and public.can_access_customer(h.customer_id)
  order by h.return_date, h.doc_no, l.line_no;
end $$;
revoke execute on function public.rpt_sales_returns(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.rpt_sales_returns(uuid, date, date, uuid, uuid) to authenticated;

create or replace function public.rpt_purchase_returns(p_company uuid, p_from date, p_to date, p_warehouse uuid default null, p_supplier uuid default null)
returns table(return_id uuid, doc_no text, return_date date, status text, receipt_no text, supplier_id uuid, supplier text, warehouse text, sku text, item text, variant text,
              quantity numeric, before_billing_qty numeric, after_billing_qty numeric, value_pkr numeric, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_costs boolean;
begin
  if not (public.has_permission(p_company, 'purchasing.view') or public.has_permission(p_company, 'purchasing.return') or public.has_permission(p_company, 'inventory.view')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_costs := public.has_permission(p_company, 'purchasing.costs');
  return query
  select h.id, h.doc_no, h.return_date, h.status, g.doc_no, h.supplier_id, s.name::text, w.name::text, coalesce(pv.sku, p.sku)::text, p.name::text, pv.name::text,
         l.quantity, l.unbilled_qty, l.billed_qty, case when v_costs then l.value_pkr end, h.reason
  from public.purchase_return_lines l join public.purchase_returns h on h.id = l.return_id join public.goods_receipts g on g.id = h.receipt_id
  join public.suppliers s on s.id = h.supplier_id join public.warehouses w on w.id = h.warehouse_id
  join public.products p on p.id = l.product_id left join public.product_variants pv on pv.id = l.variant_id
  where h.company_id = p_company and (p_from is null or h.return_date >= p_from) and (p_to is null or h.return_date <= p_to)
    and (p_warehouse is null or h.warehouse_id = p_warehouse) and (p_supplier is null or h.supplier_id = p_supplier)
  order by h.return_date, h.doc_no, l.line_no;
end $$;
revoke execute on function public.rpt_purchase_returns(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.rpt_purchase_returns(uuid, date, date, uuid, uuid) to authenticated;
