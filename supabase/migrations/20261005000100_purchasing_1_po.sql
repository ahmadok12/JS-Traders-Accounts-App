-- Stage 7 — Purchasing (part 1): permissions, purchase orders, receiving against a PO, receipt costing columns

insert into public.permissions(code, module, description, is_sensitive) values
  ('purchasing.view',    'purchasing', 'See purchase orders, receipts against them and supplier bills (no prices unless purchasing.costs)', false),
  ('purchasing.manage',  'purchasing', 'Create and edit purchase orders and supplier bills', false),
  ('purchasing.approve', 'purchasing', 'Approve purchase orders, approve purchase costs, post supplier bills', true),
  ('purchasing.costs',   'purchasing', 'See and enter purchase prices / costs', true)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values ('ADMINISTRATOR','purchasing.view'), ('ADMINISTRATOR','purchasing.manage'), ('ADMINISTRATOR','purchasing.approve'), ('ADMINISTRATOR','purchasing.costs'),
             ('OWNER','purchasing.view'), ('OWNER','purchasing.manage'), ('OWNER','purchasing.approve'), ('OWNER','purchasing.costs'),
             ('ACCOUNTANT','purchasing.view'), ('ACCOUNTANT','purchasing.manage'), ('ACCOUNTANT','purchasing.approve'), ('ACCOUNTANT','purchasing.costs'),
             ('WAREHOUSE_MANAGER','purchasing.view')) x(role, p) on x.role = r.code
on conflict do nothing;

insert into public.numbering_sequences(company_id, doc_type, prefix)
select c.id, x.t, x.p from public.companies c cross join (values ('PURCHASE_ORDER','PO-'), ('SUPPLIER_BILL','BILL-'), ('COST_TASK','CT-')) x(t, p)
where not exists (select 1 from public.numbering_sequences s where s.company_id = c.id and s.doc_type = x.t);

-- ───────── purchase orders ─────────
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  order_date date not null,
  expected_date date,
  supplier_id uuid not null references public.suppliers(id),
  supplier_reference text,
  warehouse_id uuid references public.warehouses(id),
  currency text not null default 'PKR',
  fx_rate numeric not null default 1 check (fx_rate > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  notes text,
  approved_by uuid, approved_at timestamptz,
  closed_by uuid, closed_at timestamptz, close_reason text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists po_company on public.purchase_orders(company_id, status, order_date desc);
alter table public.purchase_orders enable row level security;
create policy po_select on public.purchase_orders for select to authenticated using (public.has_permission(company_id, 'purchasing.view'));

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  purchase_order_id uuid not null references public.purchase_orders(id),
  line_no int not null,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  quantity numeric not null check (quantity > 0),
  received_qty numeric not null default 0 check (received_qty >= 0),
  unit_price numeric check (unit_price is null or unit_price >= 0),
  notes text,
  is_active boolean not null default true
);
create index if not exists pol_po on public.purchase_order_lines(purchase_order_id);
alter table public.purchase_order_lines enable row level security;
create policy pol_select on public.purchase_order_lines for select to authenticated using (public.has_permission(company_id, 'purchasing.view'));
-- prices are only for purchasing.costs (read through po_line_prices)
revoke select on public.purchase_order_lines from authenticated, anon;
grant select (id, company_id, purchase_order_id, line_no, product_id, variant_id, quantity, received_qty, notes, is_active) on public.purchase_order_lines to authenticated;

-- ───────── receipt ↔ PO, receipt costing ─────────
alter table public.goods_receipts add column if not exists purchase_order_id uuid references public.purchase_orders(id);
alter table public.goods_receipts add column if not exists cost_currency text;
alter table public.goods_receipts add column if not exists cost_fx_rate numeric;
alter table public.goods_receipt_lines add column if not exists unit_cost numeric check (unit_cost is null or unit_cost >= 0);
alter table public.goods_receipt_lines add column if not exists unit_cost_pkr numeric check (unit_cost_pkr is null or unit_cost_pkr >= 0);
alter table public.goods_receipt_lines add column if not exists cost_source text check (cost_source in ('COST_TASK','BILL'));
alter table public.goods_receipt_lines add column if not exists cost_entry_id uuid references public.journal_entries(id);
alter table public.goods_receipt_lines add column if not exists billed_qty numeric not null default 0 check (billed_qty >= 0);
grant select (billed_qty) on public.goods_receipt_lines to authenticated;   -- costs stay hidden (read through receipt_line_costs)

create table if not exists public.goods_receipt_po_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  receipt_id uuid not null references public.goods_receipts(id),
  receipt_line_id uuid not null references public.goods_receipt_lines(id),
  po_line_id uuid not null references public.purchase_order_lines(id),
  quantity numeric not null check (quantity > 0),
  reversed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists grpl_po on public.goods_receipt_po_links(po_line_id);
alter table public.goods_receipt_po_links enable row level security;
create policy grpl_select on public.goods_receipt_po_links for select to authenticated using (public.has_permission(company_id, 'purchasing.view') or public.has_permission(company_id, 'inventory.view'));

-- ───────── helpers ─────────
create or replace function public.po_refresh_status(p_po uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_all numeric; v_got numeric; s text;
begin
  select status into s from public.purchase_orders where id = p_po;
  if s not in ('APPROVED','PARTIALLY_RECEIVED','RECEIVED') then return; end if;
  select coalesce(sum(quantity), 0), coalesce(sum(least(received_qty, quantity)), 0) into v_all, v_got
    from public.purchase_order_lines where purchase_order_id = p_po and is_active;
  update public.purchase_orders set status = case when v_got <= 0 then 'APPROVED' when v_got >= v_all then 'RECEIVED' else 'PARTIALLY_RECEIVED' end,
    updated_at = now() where id = p_po;
end $$;

-- p_lines: [{id?, product_id, variant_id, quantity, unit_price, notes}]
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
    insert into public.purchase_orders(company_id, doc_no, order_date, expected_date, supplier_id, supplier_reference, warehouse_id, currency, fx_rate, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'PURCHASE_ORDER'), coalesce(nullif(p_header->>'order_date','')::date, current_date),
      nullif(p_header->>'expected_date','')::date, v_sup, nullif(trim(p_header->>'supplier_reference'),''), nullif(p_header->>'warehouse_id','')::uuid,
      coalesce(nullif(upper(trim(p_header->>'currency')),''), 'PKR'), coalesce(nullif(p_header->>'fx_rate','')::numeric, 1), nullif(trim(p_header->>'notes'),''), p_idempotency_key)
    returning id into v_id;
  else
    select * into h from public.purchase_orders where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
    if h.status <> 'DRAFT' then raise exception 'Only draft orders can be edited (this one is %)', lower(h.status) using errcode = '22023'; end if;
    update public.purchase_orders set order_date = coalesce(nullif(p_header->>'order_date','')::date, order_date), expected_date = nullif(p_header->>'expected_date','')::date,
      supplier_id = v_sup, supplier_reference = nullif(trim(p_header->>'supplier_reference'),''), warehouse_id = nullif(p_header->>'warehouse_id','')::uuid,
      currency = coalesce(nullif(upper(trim(p_header->>'currency')),''), 'PKR'), fx_rate = coalesce(nullif(p_header->>'fx_rate','')::numeric, 1),
      notes = nullif(trim(p_header->>'notes'),''), updated_at = now(), updated_by = auth.uid()
    where id = p_id;
    v_id := p_id;
  end if;
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

create or replace function public.set_purchase_order_status(p_id uuid, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.purchase_orders;
begin
  select * into h from public.purchase_orders where id = p_id for update;
  if h.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  if p_action = 'APPROVE' then
    perform public.inv_require(h.company_id, 'purchasing.approve');
    if h.status <> 'DRAFT' then raise exception 'Only a draft order can be approved' using errcode = '22023'; end if;
    update public.purchase_orders set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'CANCEL' then
    perform public.inv_require(h.company_id, 'purchasing.manage');
    if h.status not in ('DRAFT','APPROVED') then raise exception 'Goods were already received — close the order instead' using errcode = '22023'; end if;
    update public.purchase_orders set status = 'CANCELLED', close_reason = nullif(trim(p_reason),''), closed_by = auth.uid(), closed_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'CLOSE' then
    perform public.inv_require(h.company_id, 'purchasing.manage');
    if h.status not in ('APPROVED','PARTIALLY_RECEIVED') then raise exception 'Only an open order can be closed' using errcode = '22023'; end if;
    update public.purchase_orders set status = 'CLOSED', close_reason = nullif(trim(p_reason),''), closed_by = auth.uid(), closed_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'REOPEN' then
    perform public.inv_require(h.company_id, 'purchasing.manage');
    if h.status <> 'CLOSED' then raise exception 'Only a closed order can be reopened' using errcode = '22023'; end if;
    update public.purchase_orders set status = 'APPROVED', close_reason = null, closed_by = null, closed_at = null, updated_at = now() where id = p_id;
    perform public.po_refresh_status(p_id);
  else raise exception 'Unknown action' using errcode = '22023';
  end if;
end $$;

-- PO line prices (for people allowed to see purchase prices)
create or replace function public.po_line_prices(p_po_id uuid)
returns table(line_id uuid, unit_price numeric) language sql stable security definer set search_path = '' as $$
  select l.id, l.unit_price from public.purchase_order_lines l join public.purchase_orders h on h.id = l.purchase_order_id
  where l.purchase_order_id = p_po_id and public.has_permission(h.company_id, 'purchasing.costs');
$$;

-- receive against an approved PO: makes a draft goods receipt with the remaining quantities (or those given)
-- p_lines: [{po_line_id, quantity, location_id?}]
create or replace function public.receive_purchase_order(p_po_id uuid, p_warehouse_id uuid, p_date date default null, p_lines jsonb default null, p_reference text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h public.purchase_orders; v_lines jsonb := '[]'::jsonb; l record; x jsonb; q numeric; v_id uuid;
begin
  select * into h from public.purchase_orders where id = p_po_id;
  if h.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.receive');
  if h.status not in ('APPROVED','PARTIALLY_RECEIVED') then raise exception 'Only an approved, open order can be received (this one is %)', lower(h.status) using errcode = '22023'; end if;
  for l in select * from public.purchase_order_lines where purchase_order_id = p_po_id and is_active order by line_no loop
    if p_lines is not null and jsonb_array_length(p_lines) > 0 then
      select y into x from jsonb_array_elements(p_lines) y where (y->>'po_line_id')::uuid = l.id;
      if x is null then continue; end if;
      q := coalesce(nullif(x->>'quantity','')::numeric, 0);
    else
      x := null; q := l.quantity - l.received_qty;
    end if;
    if q <= 0 then continue; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', l.product_id, 'variant_id', l.variant_id,
      'location_id', nullif(x->>'location_id',''), 'quantity', q, 'notes', null));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Nothing left to receive on this order' using errcode = '22023'; end if;
  v_id := public.save_goods_receipt(null, jsonb_build_object('company_id', h.company_id, 'warehouse_id', coalesce(p_warehouse_id, h.warehouse_id),
    'doc_date', coalesce(p_date, current_date), 'supplier_id', h.supplier_id, 'supplier_reference', coalesce(nullif(trim(p_reference),''), h.supplier_reference),
    'notes', 'Against ' || h.doc_no), v_lines, null);
  update public.goods_receipts set purchase_order_id = h.id where id = v_id;
  return v_id;
end $$;

-- link an existing draft receipt to a PO (same supplier)
create or replace function public.link_receipt_to_po(p_receipt_id uuid, p_po_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.goods_receipts; h public.purchase_orders;
begin
  select * into g from public.goods_receipts where id = p_receipt_id for update;
  perform public.inv_require(g.company_id, 'inventory.receive');
  if g.status <> 'DRAFT' then raise exception 'Only a draft receipt can be linked to an order' using errcode = '22023'; end if;
  if p_po_id is not null then
    select * into h from public.purchase_orders where id = p_po_id and company_id = g.company_id;
    if h.id is null or h.status not in ('APPROVED','PARTIALLY_RECEIVED') then raise exception 'Choose an approved, open purchase order' using errcode = '22023'; end if;
    if g.supplier_id is not null and g.supplier_id <> h.supplier_id then raise exception 'The order is for a different supplier' using errcode = '22023'; end if;
  end if;
  update public.goods_receipts set purchase_order_id = p_po_id, supplier_id = coalesce(supplier_id, h.supplier_id) where id = p_receipt_id;
end $$;

-- posting / reversing a receipt updates the PO it belongs to (matched by item, oldest PO line first)
create or replace function public.tg_receipt_po() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record; p record; v_left numeric; v_take numeric; k record; v_je uuid;
begin
  if new.status = 'POSTED' and old.status = 'DRAFT' and new.purchase_order_id is not null then
    for l in select * from public.goods_receipt_lines where receipt_id = new.id order by line_no loop
      v_left := l.quantity;
      for p in select * from public.purchase_order_lines where purchase_order_id = new.purchase_order_id and is_active
               and product_id = l.product_id and variant_id is not distinct from l.variant_id and received_qty < quantity order by line_no for update loop
        exit when v_left <= 0;
        v_take := least(v_left, p.quantity - p.received_qty);
        update public.purchase_order_lines set received_qty = received_qty + v_take where id = p.id;
        insert into public.goods_receipt_po_links(company_id, receipt_id, receipt_line_id, po_line_id, quantity) values (new.company_id, new.id, l.id, p.id, v_take);
        v_left := v_left - v_take;
      end loop;
    end loop;
    perform public.po_refresh_status(new.purchase_order_id);
  elsif new.status = 'REVERSED' and old.status = 'POSTED' then
    if exists (select 1 from public.goods_receipt_lines where receipt_id = new.id and billed_qty > 0) then
      raise exception 'This receipt is on a supplier bill — reverse the bill first' using errcode = '22023';
    end if;
    for v_je in select distinct cost_entry_id from public.goods_receipt_lines where receipt_id = new.id and cost_entry_id is not null loop
      perform public.acc_reverse_document_entry(v_je, 'Goods receipt ' || new.doc_no || ' reversed', current_date);
    end loop;
    for k in select * from public.goods_receipt_po_links where receipt_id = new.id and not reversed loop
      update public.purchase_order_lines set received_qty = greatest(received_qty - k.quantity, 0) where id = k.po_line_id;
      update public.goods_receipt_po_links set reversed = true where id = k.id;
    end loop;
    if new.purchase_order_id is not null then perform public.po_refresh_status(new.purchase_order_id); end if;
    update public.purchase_cost_tasks set status = 'CANCELLED', updated_at = now() where receipt_id = new.id and status in ('OPEN','SUBMITTED','RETURNED');
  end if;
  return new;
end $$;
