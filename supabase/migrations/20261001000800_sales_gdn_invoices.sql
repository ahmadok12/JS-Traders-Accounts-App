-- =====================================================================
-- JS Traders ERP — Stage 5 part 1: sales chain (spec §9, §10, §11, §24)
-- Sales order (manual, per-warehouse quantities, prices; approval reserves stock)
-- → GDN (stock leaves the ACTUAL warehouse; partial deliveries; rolls / bundles)
-- → Sales invoice (one qty per product+variant+price; GDN lines kept as sources;
--   no over-invoicing; Dr receivable / Cr sales posted atomically)
-- → Receipts allocated to invoices ("Receive payment now" on the invoice).
-- Drafts keep their lines as jsonb; posting writes the permanent lines.
-- COGS posting waits for purchase costs (Stages 7–8).
-- =====================================================================
-- ---------------------------------------------------------------- permissions + numbering
insert into public.permissions(code, module, description, is_sensitive) values
  ('sales.dispatch','sales','Create and post GDNs (dispatch stock to customers)',false),
  ('sales.invoice','sales','Create and post sales invoices, receive and allocate payments',true)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values ('ADMINISTRATOR','sales.dispatch'),('ADMINISTRATOR','sales.invoice'),
             ('WAREHOUSE_MANAGER','sales.dispatch'),('ACCOUNTANT','sales.invoice')) as x(role_code, p) on x.role_code = r.code
on conflict do nothing;
insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, x.t, x.p, 5, true from public.companies c
cross join (values ('GDN','GDN-'),('SALES_INVOICE','INV-')) as x(t, p)
on conflict do nothing;

-- ---------------------------------------------------------------- sales orders: manual entry, prices, delivery tracking
alter table public.sales_order_lines
  add column unit_price numeric(18,2) check (unit_price is null or unit_price >= 0),   -- null = price pending (≠ 0)
  add column is_active  boolean not null default true;                                  -- edited drafts retire old lines
alter table public.sales_order_lines drop constraint sales_order_lines_sales_order_id_line_no_key;
create unique index sol_active_line_uq on public.sales_order_lines(sales_order_id, line_no) where is_active;
alter table public.sales_order_line_warehouse_allocations
  add column delivered_quantity numeric(18,4) not null default 0 check (delivered_quantity >= 0);
alter table public.sales_orders
  add column closed_at timestamptz, add column closed_by uuid, add column close_reason text;

-- ---------------------------------------------------------------- GDN (goods dispatch note)
create table public.gdns (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  doc_no            text not null,
  gdn_date          date not null default current_date,
  customer_id       uuid not null references public.customers(id),
  sales_order_id    uuid not null references public.sales_orders(id),
  status            text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  transport_details text,
  notes             text,
  lines_draft       jsonb not null default '[]'::jsonb,     -- [{allocation_id, quantity}] until posted
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key   uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index gdns_list_idx on public.gdns(company_id, gdn_date desc, created_at desc);
create index gdns_so_idx on public.gdns(sales_order_id);
create index gdns_customer_idx on public.gdns(customer_id);

create table public.gdn_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  gdn_id              uuid not null references public.gdns(id),
  line_no             int not null,
  sales_order_line_id uuid not null references public.sales_order_lines(id),
  allocation_id       uuid not null references public.sales_order_line_warehouse_allocations(id),
  warehouse_id        uuid not null references public.warehouses(id),     -- the warehouse it physically left (§9.2)
  product_id          uuid not null references public.products(id),
  variant_id          uuid references public.product_variants(id),
  quantity            numeric(18,4) not null check (quantity > 0),
  unit_price          numeric(18,2),                                       -- carried from the SO (null = pending)
  invoiced_qty        numeric(18,4) not null default 0 check (invoiced_qty >= 0),
  check (invoiced_qty <= quantity),
  unique (gdn_id, line_no)
);
create index gdn_lines_gdn_idx on public.gdn_lines(gdn_id);
create index gdn_lines_sol_idx on public.gdn_lines(sales_order_line_id);
create index gdn_lines_uninvoiced_idx on public.gdn_lines(company_id) where invoiced_qty < quantity;

-- ---------------------------------------------------------------- sales invoices
create table public.sales_invoices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  invoice_date       date not null default current_date,
  due_date           date,
  customer_id        uuid not null references public.customers(id),
  customer_reference text,
  status             text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  notes              text,
  lines_draft        jsonb not null default '[]'::jsonb,
  subtotal           numeric(18,2) not null default 0,
  discount_amount    numeric(18,2) not null default 0 check (discount_amount >= 0),
  total_amount       numeric(18,2) not null default 0,
  journal_entry_id   uuid references public.journal_entries(id),
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index sinv_list_idx on public.sales_invoices(company_id, invoice_date desc, created_at desc);
create index sinv_customer_idx on public.sales_invoices(customer_id, status);

create table public.sales_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  invoice_id  uuid not null references public.sales_invoices(id),
  line_no     int not null,
  product_id  uuid not null references public.products(id),
  variant_id  uuid references public.product_variants(id),
  description text,
  quantity    numeric(18,4) not null check (quantity > 0),
  unit_price  numeric(18,2) not null check (unit_price >= 0),
  amount      numeric(18,2) not null,
  sources     jsonb not null default '[]'::jsonb,    -- [{gdn_line_id, qty}] — hidden source links (§9.2)
  unique (invoice_id, line_no)
);
create index sil_invoice_idx on public.sales_invoice_lines(invoice_id);
create index sil_price_idx on public.sales_invoice_lines(product_id, variant_id);

-- receipts allocated to invoices (removing an allocation marks it REMOVED; history kept)
create table public.receipt_allocations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  receipt_entry_id  uuid not null references public.journal_entries(id),
  invoice_id        uuid not null references public.sales_invoices(id),
  amount            numeric(18,2) not null check (amount > 0),
  status            text not null default 'ACTIVE' check (status in ('ACTIVE','REMOVED')),
  created_at timestamptz not null default now(), created_by uuid,
  removed_at timestamptz, removed_by uuid
);
create index ra_receipt_idx on public.receipt_allocations(receipt_entry_id) where status = 'ACTIVE';
create index ra_invoice_idx on public.receipt_allocations(invoice_id) where status = 'ACTIVE';

-- ---------------------------------------------------------------- triggers / RLS
do $$
declare t text;
begin
  foreach t in array array['gdns','sales_invoices'] loop
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp_row()', t);
  end loop;
  foreach t in array array['gdns','gdn_lines','sales_invoices','sales_invoice_lines','receipt_allocations'] loop
    execute format('create trigger audit after insert or update on public.%I for each row execute function public.tg_audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

create policy gdn_select on public.gdns for select to authenticated
  using ((public.has_permission(company_id, 'sales.view') and public.can_access_customer(customer_id))
         or public.has_permission(company_id, 'inventory.view'));
create policy gdnl_select on public.gdn_lines for select to authenticated
  using (exists (select 1 from public.gdns h where h.id = gdn_id));
create policy sinv_select on public.sales_invoices for select to authenticated
  using ((public.has_permission(company_id, 'sales.view') and public.can_access_customer(customer_id))
         or public.has_permission(company_id, 'journals.view'));
create policy sil_select on public.sales_invoice_lines for select to authenticated
  using (exists (select 1 from public.sales_invoices h where h.id = invoice_id));
create policy ra_select on public.receipt_allocations for select to authenticated
  using (exists (select 1 from public.sales_invoices h where h.id = invoice_id));
-- ---------------------------------------------------------------- sales orders
-- retire a draft line (edited away): its reservations are released, allocations cancelled
create or replace function public.so_retire_line(p_line_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = p_reason
   where sales_order_line_id = p_line_id and status = 'ACTIVE';
  update public.sales_order_line_warehouse_allocations set status = 'CANCELLED', reserved_quantity = 0
   where sales_order_line_id = p_line_id and status = 'OPEN';
  update public.sales_order_lines set is_active = false where id = p_line_id;
end $$;
revoke execute on function public.so_retire_line(uuid, text) from public, anon, authenticated;

-- Create / edit a draft sales order.
-- lines: [{id?, product_id, variant_id, unit_price, notes, allocations: [{warehouse_id, quantity}]}]
-- A line whose warehouse split is unchanged keeps its id (and any stock already reserved for it);
-- a changed split replaces the line (its reservations are released and re-made on approval).
create or replace function public.save_sales_order(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_cust uuid := nullif(p_header->>'customer_id','')::uuid;
  v_id uuid; h record; l jsonb; a jsonb; n int := 0; v_line uuid; v_total numeric; v_keep uuid[] := '{}';
  v_old text; v_new text; v_price numeric; v_wh uuid; v_q numeric; v_bundle boolean;
begin
  perform public.inv_require(v_company, 'sales.manage');
  if v_cust is null or not exists (select 1 from public.customers where id = v_cust and company_id = v_company and is_active) then
    raise exception 'Choose an active customer' using errcode = '23502';
  end if;
  if not public.can_access_customer(v_cust) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;

  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.sales_orders where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.sales_orders(company_id, doc_no, order_date, customer_id, customer_reference, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'SALES_ORDER'), coalesce(nullif(p_header->>'order_date','')::date, current_date),
            v_cust, nullif(trim(p_header->>'customer_reference'),''), nullif(trim(p_header->>'notes'),''), p_idempotency_key)
    returning id into v_id;
  else
    select * into h from public.sales_orders where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
    if h.status <> 'DRAFT' then raise exception 'Only orders awaiting approval can be edited (this one is %)', h.status using errcode = '22023'; end if;
    update public.sales_orders set order_date = coalesce(nullif(p_header->>'order_date','')::date, order_date), customer_id = v_cust,
      customer_reference = nullif(trim(p_header->>'customer_reference'),''), notes = nullif(trim(p_header->>'notes'),'')
    where id = p_id;
    v_id := p_id;
    -- move current line numbers out of the way while lines are renumbered
    update public.sales_order_lines set line_no = -line_no where sales_order_id = v_id and is_active;
  end if;

  -- lines that are kept unchanged
  for l in select * from jsonb_array_elements(p_lines) loop
    if nullif(l->>'id','') is null then continue; end if;
    select string_agg(warehouse_id::text || ':' || quantity::numeric(18,4)::text, ',' order by warehouse_id) into v_old
      from public.sales_order_line_warehouse_allocations
     where sales_order_line_id = (l->>'id')::uuid and status = 'OPEN';
    select string_agg((x->>'warehouse_id') || ':' || ((x->>'quantity')::numeric)::numeric(18,4)::text, ',' order by (x->>'warehouse_id')::uuid) into v_new
      from jsonb_array_elements(l->'allocations') x where coalesce((x->>'quantity')::numeric, 0) > 0;
    if exists (select 1 from public.sales_order_lines s where s.id = (l->>'id')::uuid and s.sales_order_id = v_id and s.is_active
               and s.product_id = (l->>'product_id')::uuid and s.variant_id is not distinct from nullif(l->>'variant_id','')::uuid)
       and v_old is not distinct from v_new then
      v_keep := v_keep || (l->>'id')::uuid;
    end if;
  end loop;
  -- retire everything else
  for v_line in select id from public.sales_order_lines where sales_order_id = v_id and is_active and not (id = any(v_keep)) loop
    perform public.so_retire_line(v_line, 'Sales order edited');
  end loop;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_price := nullif(l->>'unit_price','')::numeric;
    if v_price is not null and v_price < 0 then raise exception 'Line %: price cannot be negative', n using errcode = '23514'; end if;
    select is_bundle into v_bundle from public.products where id = (l->>'product_id')::uuid and company_id = v_company;
    v_total := 0;
    for a in select * from jsonb_array_elements(coalesce(l->'allocations','[]'::jsonb)) loop
      v_q := coalesce(nullif(a->>'quantity','')::numeric, 0);
      if v_q < 0 then raise exception 'Line %: quantities cannot be negative', n using errcode = '23514'; end if;
      if v_q = 0 then continue; end if;
      v_wh := (a->>'warehouse_id')::uuid;
      perform public.inv_check_warehouse(v_company, v_wh);
      perform public.inv_validate_line(v_company, v_wh, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, null, v_q, n);
      v_total := v_total + v_q;
    end loop;
    if v_total <= 0 then raise exception 'Line %: enter a quantity for at least one warehouse', n using errcode = '23502'; end if;

    if nullif(l->>'id','')::uuid = any(v_keep) then
      update public.sales_order_lines set line_no = n, unit_price = v_price, notes = nullif(trim(l->>'notes'),'')
       where id = (l->>'id')::uuid;
    else
      insert into public.sales_order_lines(company_id, sales_order_id, line_no, product_id, variant_id, quantity, unit_price, notes)
      values (v_company, v_id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, v_total, v_price, nullif(trim(l->>'notes'),''))
      returning id into v_line;
      for a in select * from jsonb_array_elements(l->'allocations') loop
        if coalesce(nullif(a->>'quantity','')::numeric, 0) <= 0 then continue; end if;
        insert into public.sales_order_line_warehouse_allocations(company_id, sales_order_line_id, warehouse_id, quantity)
        values (v_company, v_line, (a->>'warehouse_id')::uuid, (a->>'quantity')::numeric);
      end loop;
    end if;
  end loop;
  return v_id;
end $$;
revoke execute on function public.save_sales_order(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_sales_order(uuid, jsonb, jsonb, uuid) to authenticated;

-- Approve: release to the warehouse and reserve stock per warehouse allocation (bundles are
-- checked against their components when dispatched).
create or replace function public.approve_sales_order(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; a record; v_need numeric; n int;
begin
  select * into h from public.sales_orders where id = p_id for update;
  if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.approve');
  if h.status = 'APPROVED' then return; end if;
  if h.status <> 'DRAFT' then raise exception 'Only draft sales orders can be approved (this one is %)', h.status using errcode = '22023'; end if;
  if not exists (select 1 from public.sales_order_lines where sales_order_id = p_id and is_active) then
    raise exception 'The order has no items' using errcode = '23502';
  end if;
  select count(*) into n from public.reservations where sales_order_id = p_id;
  for a in select al.*, l.product_id, l.variant_id, l.line_no, p.is_bundle
           from public.sales_order_line_warehouse_allocations al
           join public.sales_order_lines l on l.id = al.sales_order_line_id
           join public.products p on p.id = l.product_id
           where l.sales_order_id = p_id and l.is_active and al.status = 'OPEN'
           order by l.line_no, al.warehouse_id
           for update of al loop
    v_need := a.quantity - a.reserved_quantity - a.delivered_quantity;
    if v_need <= 0 or a.is_bundle then continue; end if;
    perform public.inv_reserve_line(h.company_id, a.warehouse_id, a.product_id, a.variant_id, v_need, a.line_no);
    n := n + 1;
    insert into public.reservations(company_id, doc_no, warehouse_id, product_id, variant_id, quantity,
      source_type, source_id, sales_order_id, sales_order_line_id, customer_id)
    values (h.company_id, h.doc_no || '-R' || n, a.warehouse_id, a.product_id, a.variant_id, v_need,
      'SALES_ORDER', p_id, p_id, a.sales_order_line_id, h.customer_id);
    update public.sales_order_line_warehouse_allocations set reserved_quantity = reserved_quantity + v_need where id = a.id;
  end loop;
  update public.sales_orders set status = 'APPROVED', approved_at = now(), approved_by = auth.uid() where id = p_id;
end $$;

-- Close an order that will not be delivered in full: remaining reservations are released.
create or replace function public.close_sales_order(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to close a sales order' using errcode = '23502'; end if;
  select * into h from public.sales_orders where id = p_id for update;
  if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  if h.status not in ('APPROVED','PARTIALLY_DELIVERED') then raise exception 'Only approved or part-delivered orders can be closed' using errcode = '22023'; end if;
  if exists (select 1 from public.gdns where sales_order_id = p_id and status = 'DRAFT') then
    raise exception 'Post or cancel the draft GDNs of this order first' using errcode = '22023';
  end if;
  update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = 'Sales order closed: ' || p_reason
   where sales_order_id = p_id and status = 'ACTIVE';
  update public.sales_order_line_warehouse_allocations a set status = 'CLOSED', reserved_quantity = 0
    from public.sales_order_lines l where l.id = a.sales_order_line_id and l.sales_order_id = p_id and a.status = 'OPEN';
  update public.sales_orders set status = 'CLOSED', closed_at = now(), closed_by = auth.uid(), close_reason = p_reason where id = p_id;
end $$;
revoke execute on function public.close_sales_order(uuid, text) from public, anon;
grant execute on function public.close_sales_order(uuid, text) to authenticated;

-- Last approved/posted price charged to this customer for this item (suggestion only, §9.5)
create or replace function public.last_sale_price(p_customer_id uuid, p_product_id uuid, p_variant_id uuid)
returns table (unit_price numeric, invoice_date date, doc_no text)
language sql stable security invoker set search_path = '' as $$
  select l.unit_price, i.invoice_date, i.doc_no
  from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
  where i.customer_id = p_customer_id and i.status = 'POSTED' and l.product_id = p_product_id
    and l.variant_id is not distinct from p_variant_id
  order by i.invoice_date desc, i.posted_at desc limit 1;
$$;
grant execute on function public.last_sale_price(uuid, uuid, uuid) to authenticated;
-- ---------------------------------------------------------------- GDN
-- Save a draft GDN. lines: [{allocation_id, quantity}] — each SO warehouse allocation is one dispatch line.
create or replace function public.save_gdn(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_so uuid := nullif(p_header->>'sales_order_id','')::uuid;
  so record; h record; l jsonb; a record; v_out jsonb := '[]'::jsonb; v_q numeric; v_id uuid; n int := 0;
begin
  perform public.inv_require(v_company, 'sales.dispatch');
  select * into so from public.sales_orders where id = v_so and company_id = v_company;
  if so.id is null then raise exception 'Choose the sales order' using errcode = '23502'; end if;
  if so.status not in ('APPROVED','PARTIALLY_DELIVERED') then
    raise exception 'Sales order % is % — only approved orders can be dispatched', so.doc_no, lower(so.status) using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    v_q := coalesce(nullif(l->>'quantity','')::numeric, 0);
    if v_q = 0 then continue; end if;
    n := n + 1;
    if v_q < 0 then raise exception 'Line %: quantity cannot be negative', n using errcode = '23514'; end if;
    select al.*, sl.sales_order_id into a from public.sales_order_line_warehouse_allocations al
      join public.sales_order_lines sl on sl.id = al.sales_order_line_id
     where al.id = (l->>'allocation_id')::uuid;
    if a.id is null or a.sales_order_id <> v_so then raise exception 'Line %: not part of this sales order', n using errcode = '22023'; end if;
    if v_q > a.quantity - a.delivered_quantity then
      raise exception 'Line %: only % left to dispatch from this warehouse', n, (a.quantity - a.delivered_quantity)::numeric(18,2) using errcode = '23514';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('allocation_id', a.id, 'quantity', v_q));
  end loop;
  if n = 0 then raise exception 'Enter the quantity dispatched for at least one item' using errcode = '23502'; end if;

  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.gdns where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.gdns(company_id, doc_no, gdn_date, customer_id, sales_order_id, transport_details, notes, lines_draft, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'GDN'), coalesce(nullif(p_header->>'gdn_date','')::date, current_date),
      so.customer_id, v_so, nullif(trim(p_header->>'transport_details'),''), nullif(trim(p_header->>'notes'),''), v_out, p_idempotency_key)
    returning id into v_id;
  else
    select * into h from public.gdns where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'GDN not found' using errcode = 'P0002'; end if;
    if h.status <> 'DRAFT' then raise exception 'Only draft GDNs can be edited (this one is %)', h.status using errcode = '22023'; end if;
    update public.gdns set gdn_date = coalesce(nullif(p_header->>'gdn_date','')::date, gdn_date), sales_order_id = v_so, customer_id = so.customer_id,
      transport_details = nullif(trim(p_header->>'transport_details'),''), notes = nullif(trim(p_header->>'notes'),''), lines_draft = v_out
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.save_gdn(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_gdn(uuid, jsonb, jsonb, uuid) to authenticated;

create or replace function public.so_refresh_status(p_so uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ord numeric; v_del numeric; v_status text;
begin
  select status into v_status from public.sales_orders where id = p_so;
  if v_status not in ('APPROVED','PARTIALLY_DELIVERED','DELIVERED') then return; end if;
  select coalesce(sum(al.quantity),0), coalesce(sum(al.delivered_quantity),0) into v_ord, v_del
    from public.sales_order_line_warehouse_allocations al join public.sales_order_lines l on l.id = al.sales_order_line_id
   where l.sales_order_id = p_so and l.is_active and al.status <> 'CANCELLED';
  update public.sales_orders set status = case when v_del <= 0 then 'APPROVED' when v_del >= v_ord then 'DELIVERED' else 'PARTIALLY_DELIVERED' end
   where id = p_so;
end $$;
revoke execute on function public.so_refresh_status(uuid) from public, anon, authenticated;

-- Post: stock leaves the actual warehouse (rolls cut automatically, bundles take their components),
-- the order's reservation for that warehouse is consumed, delivered quantities update. One transaction.
create or replace function public.post_gdn(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; so record; l jsonb; a record; v_q numeric; n int := 0; v_line uuid; r record; v_left numeric; b record; v_bundle boolean;
begin
  select * into h from public.gdns where id = p_id for update;
  if h.id is null then raise exception 'GDN not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.dispatch');
  if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % GDN', h.status using errcode = '22023'; end if;
  select * into so from public.sales_orders where id = h.sales_order_id for update;
  if so.status not in ('APPROVED','PARTIALLY_DELIVERED') then
    raise exception 'Sales order % is % — it can no longer be dispatched', so.doc_no, lower(so.status) using errcode = '22023';
  end if;

  for l in select * from jsonb_array_elements(h.lines_draft) loop
    v_q := (l->>'quantity')::numeric;
    select al.*, sl.product_id, sl.variant_id, sl.unit_price, sl.id as line_id into a
      from public.sales_order_line_warehouse_allocations al join public.sales_order_lines sl on sl.id = al.sales_order_line_id
     where al.id = (l->>'allocation_id')::uuid for update of al;
    n := n + 1;
    if a.id is null or a.status <> 'OPEN' then raise exception 'Line %: this order line is no longer open', n using errcode = '22023'; end if;
    if v_q > a.quantity - a.delivered_quantity then
      raise exception 'Line %: only % left to dispatch from this warehouse', n, (a.quantity - a.delivered_quantity)::numeric(18,2) using errcode = '23514';
    end if;
    perform public.inv_check_warehouse(h.company_id, a.warehouse_id);
    insert into public.gdn_lines(company_id, gdn_id, line_no, sales_order_line_id, allocation_id, warehouse_id, product_id, variant_id, quantity, unit_price)
    values (h.company_id, h.id, n, a.line_id, a.id, a.warehouse_id, a.product_id, a.variant_id, v_q, a.unit_price)
    returning id into v_line;

    -- hand the reserved stock over to the dispatch first (so the reserved-stock guard does not block it)
    v_left := v_q;
    for r in select * from public.reservations where sales_order_line_id = a.line_id and warehouse_id = a.warehouse_id and status = 'ACTIVE'
             order by created_at for update loop
      exit when v_left <= 0;
      if r.quantity <= v_left then
        update public.reservations set status = 'CONSUMED', released_at = now(), released_by = auth.uid(), release_reason = 'Dispatched on ' || h.doc_no where id = r.id;
        v_left := v_left - r.quantity;
      else
        update public.reservations set quantity = quantity - v_left where id = r.id;
        v_left := 0;
      end if;
    end loop;
    update public.sales_order_line_warehouse_allocations
       set reserved_quantity = greatest(reserved_quantity - v_q, 0), delivered_quantity = delivered_quantity + v_q where id = a.id;
    update public.sales_order_lines set delivered_qty = delivered_qty + v_q where id = a.line_id;

    select is_bundle into v_bundle from public.products where id = a.product_id;
    if v_bundle then
      for b in select * from public.product_bom(a.product_id, a.variant_id) loop
        perform public.inv_issue_stock(h.company_id, h.gdn_date, 'SALES_GDN', a.warehouse_id, null,
          b.component_product_id, b.component_variant_id, b.quantity * v_q, 'GDN', h.id, v_line, h.doc_no, 'Bundle component');
      end loop;
      if not found then raise exception 'Line %: bundle has no components set up', n using errcode = '22023'; end if;
    else
      perform public.inv_issue_stock(h.company_id, h.gdn_date, 'SALES_GDN', a.warehouse_id, null,
        a.product_id, a.variant_id, v_q, 'GDN', h.id, v_line, h.doc_no, null);
    end if;
  end loop;

  update public.gdns set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;
  perform public.so_refresh_status(h.sales_order_id);
  return jsonb_build_object('status','POSTED','lines', n);
end $$;
revoke execute on function public.post_gdn(uuid) from public, anon;
grant execute on function public.post_gdn(uuid) to authenticated;

create or replace function public.cancel_gdn(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.gdns where id = p_id for update;
  if h.id is null then raise exception 'GDN not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.dispatch');
  if h.status <> 'DRAFT' then raise exception 'Only drafts can be cancelled. Posted GDNs must be reversed.' using errcode = '22023'; end if;
  update public.gdns set status = 'CANCELLED' where id = p_id;
end $$;
revoke execute on function public.cancel_gdn(uuid) from public, anon;
grant execute on function public.cancel_gdn(uuid) to authenticated;

-- Reverse a posted GDN (goods came back / posted by mistake). Not allowed once invoiced.
create or replace function public.reverse_gdn(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; so record; m record; gl record; v_count int := 0; n int;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to reverse a GDN' using errcode = '23502'; end if;
  select * into h from public.gdns where id = p_id for update;
  if h.id is null then raise exception 'GDN not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.dispatch');
  if h.status = 'REVERSED' then return jsonb_build_object('status','REVERSED','already',true); end if;
  if h.status <> 'POSTED' then raise exception 'Only posted GDNs can be reversed' using errcode = '22023'; end if;
  if exists (select 1 from public.gdn_lines where gdn_id = p_id and invoiced_qty > 0) then
    raise exception 'This GDN is already invoiced — reverse the invoice first' using errcode = '22023';
  end if;
  select * into so from public.sales_orders where id = h.sales_order_id for update;

  for m in select * from public.stock_movements where source_type = 'GDN' and source_id = p_id and reversal_of is null
           order by (quantity < 0), product_id, variant_id, created_at loop
    perform public.inv_move(m.company_id, current_date, m.movement_type, m.warehouse_id, m.location_id,
      m.product_id, m.variant_id, -m.quantity, 'GDN', p_id, m.source_line_id, h.doc_no, 'REVERSAL: ' || p_reason, m.id, m.physical_unit_id);
    v_count := v_count + 1;
  end loop;

  select count(*) into n from public.reservations where sales_order_id = so.id;
  for gl in select g.*, p.is_bundle from public.gdn_lines g join public.products p on p.id = g.product_id where g.gdn_id = p_id loop
    update public.sales_order_line_warehouse_allocations set delivered_quantity = delivered_quantity - gl.quantity where id = gl.allocation_id;
    update public.sales_order_lines set delivered_qty = delivered_qty - gl.quantity where id = gl.sales_order_line_id;
    -- the order still wants these goods: hold them again (unless the order is closed)
    if so.status in ('APPROVED','PARTIALLY_DELIVERED','DELIVERED') and not gl.is_bundle then
      n := n + 1;
      insert into public.reservations(company_id, doc_no, warehouse_id, product_id, variant_id, quantity,
        source_type, source_id, sales_order_id, sales_order_line_id, customer_id)
      values (h.company_id, so.doc_no || '-R' || n, gl.warehouse_id, gl.product_id, gl.variant_id, gl.quantity,
        'SALES_ORDER', so.id, so.id, gl.sales_order_line_id, so.customer_id);
      update public.sales_order_line_warehouse_allocations set reserved_quantity = reserved_quantity + gl.quantity where id = gl.allocation_id;
    end if;
  end loop;
  update public.gdns set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason where id = p_id;
  perform public.so_refresh_status(so.id);
  return jsonb_build_object('status','REVERSED','movements', v_count);
end $$;
revoke execute on function public.reverse_gdn(uuid, text) from public, anon;
grant execute on function public.reverse_gdn(uuid, text) to authenticated;
-- ---------------------------------------------------------------- accounting: entries created by documents
-- Posts a complete entry in one step (used by invoices, payments received on invoices …).
create or replace function public.acc_post_document_entry(p_company_id uuid, p_type text, p_date date, p_memo text, p_reference text,
  p_party_type text, p_party_id uuid, p_bank uuid, p_amount numeric, p_lines jsonb, p_source_type text, p_source_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_lines jsonb; v_id uuid; l jsonb; n int := 0; v_dr numeric := 0; v_cr numeric := 0;
begin
  perform public.acc_check_period(p_company_id, p_date);
  v_lines := public.acc_normalize_lines(p_company_id, p_lines, true);
  select sum((x->>'debit')::numeric), sum((x->>'credit')::numeric) into v_dr, v_cr from jsonb_array_elements(v_lines) x;
  insert into public.journal_entries(company_id, entry_no, entry_date, entry_type, status, memo, reference, party_type, party_id,
    bank_account_id, amount, lines_draft, total_debit, total_credit, source_type, source_id, posted_at, posted_by)
  values (p_company_id, public.next_document_number(p_company_id, 'JE_' || p_type), p_date, p_type, 'POSTED', p_memo, p_reference,
    p_party_type, p_party_id, p_bank, p_amount, v_lines, v_dr, v_cr, p_source_type, p_source_id, now(), auth.uid())
  returning id into v_id;
  for l in select * from jsonb_array_elements(v_lines) loop
    n := n + 1;
    insert into public.journal_lines(company_id, entry_id, line_no, entry_date, account_id, debit, credit, party_type, party_id, bank_account_id, description)
    values (p_company_id, v_id, n, p_date, (l->>'account_id')::uuid, (l->>'debit')::numeric, (l->>'credit')::numeric,
      nullif(l->>'party_type',''), nullif(l->>'party_id','')::uuid, nullif(l->>'bank_account_id','')::uuid, l->>'description');
  end loop;
  return v_id;
end $$;
revoke execute on function public.acc_post_document_entry(uuid, text, date, text, text, text, uuid, uuid, numeric, jsonb, text, uuid) from public, anon, authenticated;

create or replace function public.acc_reverse_document_entry(p_entry_id uuid, p_reason text, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_new uuid; n int := 0; l record;
begin
  select * into h from public.journal_entries where id = p_entry_id for update;
  if h.status <> 'POSTED' then raise exception 'Accounting entry % is not posted', h.entry_no using errcode = '22023'; end if;
  perform public.acc_check_period(h.company_id, p_date);
  insert into public.journal_entries(company_id, entry_no, entry_date, entry_type, status, memo, reference, party_type, party_id,
    bank_account_id, amount, lines_draft, total_debit, total_credit, source_type, source_id, reversal_of, posted_at, posted_by)
  values (h.company_id, public.next_document_number(h.company_id, 'JE_' || h.entry_type), p_date, h.entry_type, 'POSTED',
    'Reversal of ' || h.entry_no || ': ' || p_reason, h.reference, h.party_type, h.party_id, h.bank_account_id, h.amount, h.lines_draft,
    h.total_credit, h.total_debit, h.source_type, h.source_id, h.id, now(), auth.uid())
  returning id into v_new;
  for l in select * from public.journal_lines where entry_id = h.id order by line_no loop
    n := n + 1;
    insert into public.journal_lines(company_id, entry_id, line_no, entry_date, account_id, debit, credit, party_type, party_id, bank_account_id, description)
    values (h.company_id, v_new, n, p_date, l.account_id, l.credit, l.debit, l.party_type, l.party_id, l.bank_account_id, coalesce('Reversal: ' || l.description, 'Reversal'));
  end loop;
  update public.journal_entries set status = 'REVERSED', reversed_by_entry = v_new, reversal_reason = p_reason, reversed_at = now(), reversed_by = auth.uid()
   where id = h.id;
  return v_new;
end $$;
revoke execute on function public.acc_reverse_document_entry(uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- invoices
-- Draft invoice from dispatched, not-yet-invoiced GDN lines: ONE line per product + variant + price (§9.2),
-- with the GDN lines kept as hidden sources. Different prices are never averaged (§9.4).
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
      'quantity', g.qty, 'unit_price', g.unit_price, 'description', null, 'sources', g.src));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'These GDNs are already fully invoiced' using errcode = '22023'; end if;
  insert into public.sales_invoices(company_id, doc_no, invoice_date, customer_id, lines_draft)
  values (p_company_id, public.next_document_number(p_company_id, 'SALES_INVOICE'), coalesce(p_invoice_date, current_date), v_cust, v_lines)
  returning id into v_id;
  perform public.inv_recalc_invoice(v_id);
  return v_id;
end $$;

create or replace function public.inv_recalc_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sub numeric;
begin
  select coalesce(sum(round(((x->>'quantity')::numeric) * coalesce(nullif(x->>'unit_price','')::numeric, 0), 2)), 0) into v_sub
    from public.sales_invoices i, jsonb_array_elements(i.lines_draft) x where i.id = p_id;
  update public.sales_invoices set subtotal = v_sub, total_amount = v_sub - discount_amount where id = p_id;
end $$;
revoke execute on function public.inv_recalc_invoice(uuid) from public, anon, authenticated;
revoke execute on function public.create_invoice_from_gdns(uuid, uuid[], date) from public, anon;
grant execute on function public.create_invoice_from_gdns(uuid, uuid[], date) to authenticated;

-- Edit a draft invoice: header + per-line price / description (quantities come from the GDNs).
-- p_lines: [{unit_price, description}] in the same order as the invoice lines.
create or replace function public.save_sales_invoice(p_id uuid, p_header jsonb, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; v_lines jsonb := '[]'::jsonb; x jsonb; i int := 0; v_p numeric; v_disc numeric;
begin
  select * into h from public.sales_invoices where id = p_id for update;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.invoice');
  if h.status <> 'DRAFT' then raise exception 'Only draft invoices can be edited (this one is %)', h.status using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(h.lines_draft) loop
    v_p := nullif(p_lines->i->>'unit_price','')::numeric;
    if v_p is not null and v_p < 0 then raise exception 'Line %: price cannot be negative', i + 1 using errcode = '23514'; end if;
    v_lines := v_lines || jsonb_build_array(x || jsonb_build_object('unit_price', v_p, 'description', nullif(trim(p_lines->i->>'description'),'')));
    i := i + 1;
  end loop;
  v_disc := coalesce(nullif(p_header->>'discount_amount','')::numeric, 0);
  if v_disc < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;
  update public.sales_invoices set lines_draft = v_lines, discount_amount = v_disc,
    invoice_date = coalesce(nullif(p_header->>'invoice_date','')::date, invoice_date), due_date = nullif(p_header->>'due_date','')::date,
    customer_reference = nullif(trim(p_header->>'customer_reference'),''), notes = nullif(trim(p_header->>'notes'),'')
  where id = p_id;
  perform public.inv_recalc_invoice(p_id);
end $$;
revoke execute on function public.save_sales_invoice(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_sales_invoice(uuid, jsonb, jsonb) to authenticated;

-- Allocate (part of) a posted receipt to posted invoices of the same customer.
create or replace function public.inv_allocate(p_receipt_id uuid, p_invoice_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; i record; v_avail numeric; v_out numeric;
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  select * into r from public.journal_entries where id = p_receipt_id for update;
  select * into i from public.sales_invoices where id = p_invoice_id for update;
  if r.id is null or r.status <> 'POSTED' then raise exception 'The receipt must be posted' using errcode = '22023'; end if;
  if i.id is null or i.status <> 'POSTED' then raise exception 'The invoice must be posted' using errcode = '22023'; end if;
  if r.company_id <> i.company_id then raise exception 'Different company' using errcode = '42501'; end if;
  -- money this entry credited to the customer's receivable, less what is already allocated
  select coalesce(sum(credit - debit), 0) into v_avail from public.journal_lines
   where entry_id = r.id and party_type = 'CUSTOMER' and party_id = i.customer_id;
  v_avail := v_avail - coalesce((select sum(amount) from public.receipt_allocations where receipt_entry_id = r.id and status = 'ACTIVE'), 0);
  if v_avail <= 0 then raise exception 'Receipt % has nothing left to allocate to this customer', r.entry_no using errcode = '23514'; end if;
  v_out := i.total_amount - coalesce((select sum(amount) from public.receipt_allocations where invoice_id = i.id and status = 'ACTIVE'), 0);
  if p_amount > v_avail then raise exception 'Only % of receipt % is unallocated', v_avail::numeric(18,2), r.entry_no using errcode = '23514'; end if;
  if p_amount > v_out then raise exception 'Invoice % has only % outstanding', i.doc_no, v_out::numeric(18,2) using errcode = '23514'; end if;
  insert into public.receipt_allocations(company_id, receipt_entry_id, invoice_id, amount, created_by)
  values (i.company_id, r.id, i.id, p_amount, auth.uid());
end $$;
revoke execute on function public.inv_allocate(uuid, uuid, numeric) from public, anon, authenticated;

-- Post: price check, GDN quantities marked invoiced, receivable posted (Dr customer / Cr sales) — one transaction.
-- p_receive (optional): {bank_account_id, amount, reference} = "Receive payment now" → receipt + allocation.
create or replace function public.post_sales_invoice(p_id uuid, p_receive jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; x jsonb; s jsonb; gl record; n int := 0; v_amt numeric; v_ar uuid; v_sales uuid; v_je uuid; v_pname text;
  v_bank record; v_rcv numeric; v_rje uuid; v_cname text;
begin
  select * into h from public.sales_invoices where id = p_id for update;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.invoice');
  if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % invoice', h.status using errcode = '22023'; end if;
  perform public.inv_recalc_invoice(p_id);
  select * into h from public.sales_invoices where id = p_id;
  if h.total_amount <= 0 then raise exception 'The invoice total must be more than 0' using errcode = '23514'; end if;

  for x in select * from jsonb_array_elements(h.lines_draft) loop
    n := n + 1;
    if nullif(x->>'unit_price','') is null then
      select name into v_pname from public.products where id = (x->>'product_id')::uuid;
      raise exception 'Line %: the selling price of "%" is still pending — enter it before posting', n, v_pname using errcode = '23502';
    end if;
    for s in select * from jsonb_array_elements(x->'sources') loop
      select * into gl from public.gdn_lines where id = (s->>'gdn_line_id')::uuid for update;
      if gl.invoiced_qty + (s->>'qty')::numeric > gl.quantity then
        raise exception 'Line %: some of these goods were already invoiced on another invoice — create the invoice again', n using errcode = '23514';
      end if;
      update public.gdn_lines set invoiced_qty = invoiced_qty + (s->>'qty')::numeric where id = gl.id;
    end loop;
    v_amt := round((x->>'quantity')::numeric * (x->>'unit_price')::numeric, 2);
    insert into public.sales_invoice_lines(company_id, invoice_id, line_no, product_id, variant_id, description, quantity, unit_price, amount, sources)
    values (h.company_id, h.id, n, (x->>'product_id')::uuid, nullif(x->>'variant_id','')::uuid, x->>'description',
      (x->>'quantity')::numeric, (x->>'unit_price')::numeric, v_amt, x->'sources');
  end loop;

  select id into v_ar from public.chart_of_accounts where company_id = h.company_id and system_key = 'AR_CONTROL';
  select id into v_sales from public.chart_of_accounts where company_id = h.company_id and system_key = 'SALES';
  select name into v_cname from public.customers where id = h.customer_id;
  v_je := public.acc_post_document_entry(h.company_id, 'SYSTEM', h.invoice_date, 'Sales invoice ' || h.doc_no || ' — ' || v_cname,
    h.customer_reference, 'CUSTOMER', h.customer_id, null, h.total_amount,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', h.total_amount, 'party_type', 'CUSTOMER', 'party_id', h.customer_id, 'description', 'Invoice ' || h.doc_no),
      jsonb_build_object('account_id', v_sales, 'credit', h.total_amount, 'description', 'Invoice ' || h.doc_no)),
    'SALES_INVOICE', h.id);
  update public.sales_invoices set status = 'POSTED', posted_at = now(), posted_by = auth.uid(), journal_entry_id = v_je where id = p_id;

  -- Receive payment now
  v_rcv := coalesce(nullif(p_receive->>'amount','')::numeric, 0);
  if v_rcv > 0 then
    if v_rcv > h.total_amount then raise exception 'Payment received cannot be more than the invoice total' using errcode = '23514'; end if;
    select * into v_bank from public.bank_accounts where id = nullif(p_receive->>'bank_account_id','')::uuid and company_id = h.company_id;
    if v_bank.id is null then raise exception 'Choose the bank / cash account the payment went into' using errcode = '23502'; end if;
    v_rje := public.acc_post_document_entry(h.company_id, 'RECEIPT', h.invoice_date, 'Payment received with invoice ' || h.doc_no,
      nullif(trim(p_receive->>'reference'),''), 'CUSTOMER', h.customer_id, v_bank.id, v_rcv,
      jsonb_build_array(
        jsonb_build_object('account_id', v_bank.gl_account_id, 'debit', v_rcv, 'bank_account_id', v_bank.id),
        jsonb_build_object('account_id', v_ar, 'credit', v_rcv, 'party_type', 'CUSTOMER', 'party_id', h.customer_id)),
      null, null);
    perform public.inv_allocate(v_rje, h.id, v_rcv);
  end if;
  return jsonb_build_object('status','POSTED','journal_entry_id', v_je, 'receipt_entry_id', v_rje);
end $$;
revoke execute on function public.post_sales_invoice(uuid, jsonb) from public, anon;
grant execute on function public.post_sales_invoice(uuid, jsonb) to authenticated;

create or replace function public.cancel_sales_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.sales_invoices where id = p_id for update;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.invoice');
  if h.status <> 'DRAFT' then raise exception 'Only drafts can be cancelled. Posted invoices must be reversed.' using errcode = '22023'; end if;
  update public.sales_invoices set status = 'CANCELLED' where id = p_id;
end $$;
revoke execute on function public.cancel_sales_invoice(uuid) from public, anon;
grant execute on function public.cancel_sales_invoice(uuid) to authenticated;

create or replace function public.reverse_sales_invoice(p_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; l record; s jsonb;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to reverse an invoice' using errcode = '23502'; end if;
  select * into h from public.sales_invoices where id = p_id for update;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.invoice');
  if h.status <> 'POSTED' then raise exception 'Only posted invoices can be reversed' using errcode = '22023'; end if;
  if exists (select 1 from public.receipt_allocations where invoice_id = p_id and status = 'ACTIVE') then
    raise exception 'Payments are allocated to this invoice — remove the allocations first' using errcode = '22023';
  end if;
  for l in select * from public.sales_invoice_lines where invoice_id = p_id loop
    for s in select * from jsonb_array_elements(l.sources) loop
      update public.gdn_lines set invoiced_qty = invoiced_qty - (s->>'qty')::numeric where id = (s->>'gdn_line_id')::uuid;
    end loop;
  end loop;
  perform public.acc_reverse_document_entry(h.journal_entry_id, 'Invoice reversed: ' || p_reason, coalesce(p_date, h.invoice_date));
  update public.sales_invoices set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason where id = p_id;
end $$;
revoke execute on function public.reverse_sales_invoice(uuid, text, date) from public, anon;
grant execute on function public.reverse_sales_invoice(uuid, text, date) to authenticated;

-- Allocate a posted receipt to invoices: [{invoice_id, amount}]
create or replace function public.allocate_receipt(p_receipt_id uuid, p_allocations jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; a jsonb; n int := 0;
begin
  select * into r from public.journal_entries where id = p_receipt_id;
  if r.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(r.company_id, 'sales.invoice') or public.has_permission(r.company_id, 'journals.create')) then
    raise exception 'You do not have permission to allocate receipts' using errcode = '42501';
  end if;
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if coalesce(nullif(a->>'amount','')::numeric, 0) <= 0 then continue; end if;
    perform public.inv_allocate(p_receipt_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.allocate_receipt(uuid, jsonb) from public, anon;
grant execute on function public.allocate_receipt(uuid, jsonb) to authenticated;

create or replace function public.remove_allocation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.receipt_allocations where id = p_id for update;
  if a.id is null then raise exception 'Allocation not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(a.company_id, 'sales.invoice') or public.has_permission(a.company_id, 'journals.create')) then
    raise exception 'You do not have permission to change allocations' using errcode = '42501';
  end if;
  update public.receipt_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid() where id = p_id and status = 'ACTIVE';
end $$;
revoke execute on function public.remove_allocation(uuid) from public, anon;
grant execute on function public.remove_allocation(uuid) to authenticated;

-- A posted receipt voucher may not be reversed while it is allocated to invoices
create or replace function public.tg_je_reverse_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'REVERSED' and old.status = 'POSTED' and exists
     (select 1 from public.receipt_allocations where receipt_entry_id = new.id and status = 'ACTIVE') then
    raise exception 'This receipt is allocated to invoices — remove the allocations first' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.tg_je_reverse_guard() from public, anon, authenticated;
create trigger reverse_guard before update of status on public.journal_entries
  for each row execute function public.tg_je_reverse_guard();

-- ---------------------------------------------------------------- read models
create or replace view public.sales_invoices_v with (security_invoker = true) as
select i.id, i.company_id, i.doc_no, i.invoice_date, i.due_date, i.customer_id, c.name as customer_name, c.code as customer_code,
       i.customer_reference, i.status, i.subtotal, i.discount_amount, i.total_amount, i.journal_entry_id, i.posted_at, i.created_at,
       coalesce(p.paid, 0) as paid_amount,
       case when i.status = 'POSTED' then i.total_amount - coalesce(p.paid, 0) else 0 end as outstanding,
       case when i.status <> 'POSTED' then null
            when coalesce(p.paid, 0) <= 0 then 'UNPAID'
            when coalesce(p.paid, 0) >= i.total_amount then 'PAID' else 'PART_PAID' end as payment_status
from public.sales_invoices i
join public.customers c on c.id = i.customer_id
left join (select invoice_id, sum(amount) as paid from public.receipt_allocations where status = 'ACTIVE' group by invoice_id) p on p.invoice_id = i.id;
grant select on public.sales_invoices_v to authenticated;

-- Receipts of a customer that still have money not allocated to invoices
create or replace function public.customer_open_receipts(p_customer_id uuid)
returns table (entry_id uuid, entry_no text, entry_date date, amount numeric, allocated numeric, unallocated numeric)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.entry_no, e.entry_date, x.cr, coalesce(a.al, 0), x.cr - coalesce(a.al, 0)
  from public.journal_entries e
  join (select entry_id, sum(credit - debit) as cr from public.journal_lines
         where party_type = 'CUSTOMER' and party_id = p_customer_id group by entry_id) x on x.entry_id = e.id
  left join (select receipt_entry_id, sum(amount) as al from public.receipt_allocations where status = 'ACTIVE' group by receipt_entry_id) a
         on a.receipt_entry_id = e.id
  where e.status = 'POSTED' and e.entry_type in ('RECEIPT','JOURNAL','OPENING') and x.cr - coalesce(a.al, 0) > 0
  order by e.entry_date, e.entry_no;
$$;
grant execute on function public.customer_open_receipts(uuid) to authenticated;

-- Receive a payment against a posted invoice: posts a receipt voucher and allocates it (one transaction)
create or replace function public.receive_invoice_payment(p_invoice_id uuid, p_bank_account_id uuid, p_amount numeric,
  p_date date default null, p_reference text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i record; v_bank record; v_ar uuid; v_rje uuid; v_out numeric;
begin
  select * into i from public.sales_invoices_v where id = p_invoice_id;
  if i.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(i.company_id, 'sales.invoice');
  if i.status <> 'POSTED' then raise exception 'Only posted invoices can receive payments' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount received' using errcode = '23502'; end if;
  if p_amount > i.outstanding then raise exception 'Only % is outstanding on this invoice', i.outstanding::numeric(18,2) using errcode = '23514'; end if;
  select * into v_bank from public.bank_accounts where id = p_bank_account_id and company_id = i.company_id;
  if v_bank.id is null then raise exception 'Choose the bank / cash account the payment went into' using errcode = '23502'; end if;
  select id into v_ar from public.chart_of_accounts where company_id = i.company_id and system_key = 'AR_CONTROL';
  v_rje := public.acc_post_document_entry(i.company_id, 'RECEIPT', coalesce(p_date, current_date), 'Payment received for invoice ' || i.doc_no,
    nullif(trim(p_reference),''), 'CUSTOMER', i.customer_id, v_bank.id, p_amount,
    jsonb_build_array(
      jsonb_build_object('account_id', v_bank.gl_account_id, 'debit', p_amount, 'bank_account_id', v_bank.id),
      jsonb_build_object('account_id', v_ar, 'credit', p_amount, 'party_type', 'CUSTOMER', 'party_id', i.customer_id)),
    null, null);
  perform public.inv_allocate(v_rje, i.id, p_amount);
  return v_rje;
end $$;
revoke execute on function public.receive_invoice_payment(uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.receive_invoice_payment(uuid, uuid, numeric, date, text) to authenticated;
