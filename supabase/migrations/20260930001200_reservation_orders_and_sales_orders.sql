-- =====================================================================
-- Reserved orders (multi-line, per customer) + Sales Order foundation
-- + "Convert reserved order → Sales Order" (reserved stock is handed over
--   to the SO without ever being released).
-- Spec refs: §9.1 flow, §9.2 warehouse allocations, §10, §22.
-- Manual SO entry, pricing, picking and GDN arrive in Stage 5/6.
-- =====================================================================

-- ---------------------------------------------------------------- permissions
insert into public.permissions(code, module, description, is_sensitive) values
  ('sales.view','sales','View sales orders (scoped to accessible customers)',false),
  ('sales.manage','sales','Create sales orders / convert reserved orders, cancel drafts',false),
  ('sales.approve','sales','Approve sales orders for warehouse processing',false)
on conflict (code) do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values
  ('ADMINISTRATOR','sales.view'),('ADMINISTRATOR','sales.manage'),('ADMINISTRATOR','sales.approve'),
  ('OWNER','sales.view'),
  ('ACCOUNTANT','sales.view'),('ACCOUNTANT','sales.manage'),
  ('WAREHOUSE_MANAGER','sales.view'),('WAREHOUSE_MANAGER','sales.manage'),('WAREHOUSE_MANAGER','sales.approve'),
  ('SALESPERSON','sales.view'),('SALESPERSON','sales.manage')
) as x(role_code, p) on x.role_code = r.code
on conflict do nothing;

insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select id, 'SALES_ORDER', 'SO-', 5, true from public.companies
on conflict do nothing;

-- ---------------------------------------------------------------- reserved orders
create table public.reservation_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  customer_id        uuid references public.customers(id),
  reserved_on        date not null default current_date,
  expires_on         date,
  customer_reference text,
  status             text not null default 'ACTIVE' check (status in ('ACTIVE','CONVERTED','RELEASED')),
  notes              text,
  converted_sales_order_id uuid,
  converted_at timestamptz, converted_by uuid,
  released_at timestamptz, released_by uuid, release_reason text,
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no),
  check (expires_on is null or expires_on >= reserved_on)
);
create index reservation_orders_list_idx on public.reservation_orders(company_id, status, created_at desc);
create index reservation_orders_customer_idx on public.reservation_orders(customer_id);

-- ---------------------------------------------------------------- sales orders
create table public.sales_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  order_date         date not null default current_date,
  customer_id        uuid not null references public.customers(id),
  customer_reference text,
  status             text not null default 'DRAFT' check (status in (
                       'DRAFT','APPROVED','PARTIALLY_DELIVERED','DELIVERED','CLOSED','CANCELLED')),
  source_reservation_order_id uuid references public.reservation_orders(id),
  notes              text,
  approved_at timestamptz, approved_by uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index sales_orders_list_idx on public.sales_orders(company_id, status, order_date desc);
create index sales_orders_customer_idx on public.sales_orders(customer_id, order_date desc);
create index sales_orders_source_idx on public.sales_orders(source_reservation_order_id);

alter table public.reservation_orders
  add constraint reservation_orders_so_fk foreign key (converted_sales_order_id) references public.sales_orders(id);
create index reservation_orders_so_idx on public.reservation_orders(converted_sales_order_id);

create table public.sales_order_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  sales_order_id  uuid not null references public.sales_orders(id) on delete cascade,
  line_no         int not null,
  product_id      uuid not null references public.products(id),
  variant_id      uuid references public.product_variants(id),
  quantity        numeric(18,4) not null check (quantity > 0),     -- = sum of warehouse allocations
  delivered_qty   numeric(18,4) not null default 0 check (delivered_qty >= 0),
  notes           text,
  unique (sales_order_id, line_no)
);
create index sol_order_idx on public.sales_order_lines(sales_order_id);
create index sol_product_idx on public.sales_order_lines(product_id, variant_id);

-- Warehouse-level quantities per line (§9.2) — never fixed warehouse columns.
create table public.sales_order_line_warehouse_allocations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  sales_order_line_id uuid not null references public.sales_order_lines(id) on delete cascade,
  warehouse_id        uuid not null references public.warehouses(id),
  quantity            numeric(18,4) not null check (quantity > 0),
  reserved_quantity   numeric(18,4) not null default 0 check (reserved_quantity >= 0),
  status              text not null default 'OPEN' check (status in ('OPEN','CLOSED','CANCELLED')),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (sales_order_line_id, warehouse_id)
);
create index sola_warehouse_idx on public.sales_order_line_warehouse_allocations(warehouse_id);

-- ---------------------------------------------------------------- reservations: link to orders
alter table public.reservations drop constraint reservations_source_type_check;
alter table public.reservations add constraint reservations_source_type_check
  check (source_type in ('MANUAL','RESERVATION_ORDER','SALES_ORDER'));
alter table public.reservations
  add column reservation_order_id uuid references public.reservation_orders(id),
  add column sales_order_id uuid references public.sales_orders(id),
  add column sales_order_line_id uuid references public.sales_order_lines(id);
create index reservations_order_idx on public.reservations(reservation_order_id);
create index reservations_so_idx on public.reservations(sales_order_id);
create index reservations_sol_idx on public.reservations(sales_order_line_id);

-- migrate existing single-line reservations into one-line reserved orders
do $$
declare r record; v_order uuid;
begin
  for r in select * from public.reservations where reservation_order_id is null and sales_order_id is null loop
    insert into public.reservation_orders(company_id, doc_no, customer_id, reserved_on, status, notes,
        released_at, released_by, release_reason, created_at, created_by)
    values (r.company_id, r.doc_no, r.customer_id, r.created_at::date,
        case when r.status = 'ACTIVE' then 'ACTIVE' else 'RELEASED' end, r.notes,
        r.released_at, r.released_by, r.release_reason, r.created_at, r.created_by)
    returning id into v_order;
    update public.reservations set reservation_order_id = v_order, source_type = 'RESERVATION_ORDER',
      source_id = v_order, doc_no = r.doc_no || '-1'
    where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------- triggers, RLS
do $$
declare t text;
begin
  foreach t in array array['reservation_orders','sales_orders','sales_order_line_warehouse_allocations'] loop
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp_row()', t);
  end loop;
  foreach t in array array['reservation_orders','sales_orders','sales_order_lines','sales_order_line_warehouse_allocations'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

create policy ro_select on public.reservation_orders for select to authenticated
  using (public.has_permission(company_id, 'inventory.view')
         or (customer_id is not null and public.has_permission(company_id, 'sales.view') and public.can_access_customer(customer_id)));
create policy so_select on public.sales_orders for select to authenticated
  using (public.has_permission(company_id, 'sales.view') and public.can_access_customer(customer_id));
create policy sol_select on public.sales_order_lines for select to authenticated
  using (exists (select 1 from public.sales_orders h where h.id = sales_order_id));
create policy sola_select on public.sales_order_line_warehouse_allocations for select to authenticated
  using (exists (select 1 from public.sales_order_lines l where l.id = sales_order_line_id));

-- ---------------------------------------------------------------- RPCs
-- internal: reserve one line under lock (shared by reserved orders and, later, SOs)
create or replace function public.inv_reserve_line(p_company_id uuid, p_warehouse_id uuid, p_product_id uuid,
  p_variant_id uuid, p_quantity numeric, p_line_no int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_on_hand numeric; v_reserved numeric; v_name text;
begin
  perform public.inv_check_warehouse(p_company_id, p_warehouse_id);
  perform public.inv_validate_line(p_company_id, p_warehouse_id, p_product_id, p_variant_id, null, p_quantity, p_line_no);
  if p_quantity <= 0 then raise exception 'Line %: quantity must be positive', p_line_no using errcode = '23514'; end if;
  perform 1 from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
   for update;
  select coalesce(sum(on_hand),0) into v_on_hand from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  select coalesce(sum(quantity),0) into v_reserved from public.reservations
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
     and status = 'ACTIVE';
  if p_quantity > v_on_hand - v_reserved and not public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
    select p.name || coalesce(' / ' || v.name, '') || ' @ ' || w.code into v_name
    from public.products p cross join public.warehouses w left join public.product_variants v on v.id = p_variant_id
    where p.id = p_product_id and w.id = p_warehouse_id;
    raise exception 'Line %: only % of "%" available to reserve (on hand %, already reserved %)',
      p_line_no, (v_on_hand - v_reserved)::numeric(18,2), v_name, v_on_hand::numeric(18,2), v_reserved::numeric(18,2) using errcode = '23514';
  end if;
end $$;

-- Create a reserved order, or add lines / update header of an ACTIVE one.
-- lines: [{warehouse_id, product_id, variant_id, quantity, notes}]
create or replace function public.save_reservation_order(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_id uuid; h record; l jsonb; n int; v_cust uuid := nullif(p_header->>'customer_id','')::uuid;
begin
  perform public.inv_require(v_company, 'inventory.reserve');
  if v_cust is not null and not exists (select 1 from public.customers where id = v_cust and company_id = v_company and is_active) then
    raise exception 'Customer not found or inactive' using errcode = 'P0002';
  end if;

  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.reservation_orders where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then
      raise exception 'Add at least one item' using errcode = '23502';
    end if;
    insert into public.reservation_orders(company_id, doc_no, customer_id, expires_on, customer_reference, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'RESERVATION'), v_cust,
            nullif(p_header->>'expires_on','')::date, p_header->>'customer_reference', p_header->>'notes', p_idempotency_key)
    returning id into v_id;
  else
    select * into h from public.reservation_orders where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Reserved order not found' using errcode = 'P0002'; end if;
    if h.status <> 'ACTIVE' then raise exception 'This reserved order is % and can no longer change', h.status using errcode = '22023'; end if;
    update public.reservation_orders set customer_id = v_cust, expires_on = nullif(p_header->>'expires_on','')::date,
      customer_reference = p_header->>'customer_reference', notes = p_header->>'notes'
    where id = p_id;
    update public.reservations set customer_id = v_cust where reservation_order_id = p_id;
    v_id := p_id;
  end if;

  select coalesce(max(split_part(doc_no, '-', 4)::int), 0) into n
  from public.reservations where reservation_order_id = v_id and doc_no ~ '-\d+$';
  for l in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    n := n + 1;
    perform public.inv_reserve_line(v_company, (l->>'warehouse_id')::uuid, (l->>'product_id')::uuid,
      nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric, n);
    insert into public.reservations(company_id, doc_no, warehouse_id, product_id, variant_id, quantity,
      source_type, source_id, reservation_order_id, customer_id, notes)
    select v_company, o.doc_no || '-' || n, (l->>'warehouse_id')::uuid, (l->>'product_id')::uuid,
      nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric, 'RESERVATION_ORDER', v_id, v_id, v_cust, l->>'notes'
    from public.reservation_orders o where o.id = v_id;
  end loop;
  return v_id;
end $$;

-- Release one line. Stock held by a sales order must be changed from the SO.
create or replace function public.release_reservation(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.reservations where id = p_id for update;
  if h.id is null then raise exception 'Reservation not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.reserve');
  if h.status <> 'ACTIVE' then raise exception 'Reservation is already %', h.status using errcode = '22023'; end if;
  if h.sales_order_id is not null then
    raise exception 'This stock is held by a sales order — cancel or change the sales order instead' using errcode = '22023';
  end if;
  update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = p_reason
  where id = p_id;
  if h.reservation_order_id is not null and not exists (
      select 1 from public.reservations where reservation_order_id = h.reservation_order_id and status = 'ACTIVE') then
    update public.reservation_orders set status = 'RELEASED', released_at = now(), released_by = auth.uid(),
      release_reason = coalesce(p_reason, 'All lines released')
    where id = h.reservation_order_id and status = 'ACTIVE';
  end if;
end $$;

create or replace function public.release_reservation_order(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.reservation_orders where id = p_id for update;
  if h.id is null then raise exception 'Reserved order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.reserve');
  if h.status <> 'ACTIVE' then raise exception 'This reserved order is already %', h.status using errcode = '22023'; end if;
  update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = p_reason
  where reservation_order_id = p_id and status = 'ACTIVE';
  update public.reservation_orders set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = p_reason
  where id = p_id;
end $$;

-- Convert: create an SO (status DRAFT = awaiting approval) from the ACTIVE lines and
-- hand the SAME reservation rows over to it. Stock is never un-reserved in between.
create or replace function public.convert_reservation_to_sales_order(p_order_id uuid, p_customer_id uuid default null,
  p_customer_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_cust uuid; v_so uuid; g record; a record; v_line uuid; n int := 0;
begin
  select * into h from public.reservation_orders where id = p_order_id for update;
  if h.id is null then raise exception 'Reserved order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  if h.status = 'CONVERTED' then return h.converted_sales_order_id; end if;   -- idempotent
  if h.status <> 'ACTIVE' then raise exception 'Only active reserved orders can be converted (this one is %)', h.status using errcode = '22023'; end if;

  v_cust := coalesce(h.customer_id, p_customer_id);
  if v_cust is null then raise exception 'Choose the customer for this order first' using errcode = '23502'; end if;
  if not exists (select 1 from public.customers where id = v_cust and company_id = h.company_id and is_active) then
    raise exception 'Customer not found or inactive' using errcode = 'P0002';
  end if;
  if not public.can_access_customer(v_cust) then
    raise exception 'You do not have access to this customer' using errcode = '42501';
  end if;
  perform 1 from public.reservations where reservation_order_id = p_order_id and status = 'ACTIVE' for update;
  if not found then raise exception 'Nothing left to convert — all lines were released' using errcode = '22023'; end if;

  insert into public.sales_orders(company_id, doc_no, customer_id, customer_reference, source_reservation_order_id, notes)
  values (h.company_id, public.next_document_number(h.company_id, 'SALES_ORDER'), v_cust,
          coalesce(nullif(p_customer_reference,''), h.customer_reference), p_order_id,
          coalesce(nullif(p_notes,''), h.notes))
  returning id into v_so;

  -- one SO line per product+variant; warehouse split kept in allocations (§9.2)
  for g in select r.product_id, r.variant_id, sum(r.quantity) as qty
           from public.reservations r
           where r.reservation_order_id = p_order_id and r.status = 'ACTIVE'
           group by r.product_id, r.variant_id
           order by min(r.created_at) loop
    n := n + 1;
    insert into public.sales_order_lines(company_id, sales_order_id, line_no, product_id, variant_id, quantity)
    values (h.company_id, v_so, n, g.product_id, g.variant_id, g.qty)
    returning id into v_line;
    for a in select r.warehouse_id, sum(r.quantity) as qty from public.reservations r
             where r.reservation_order_id = p_order_id and r.status = 'ACTIVE'
               and r.product_id = g.product_id and r.variant_id is not distinct from g.variant_id
             group by r.warehouse_id loop
      insert into public.sales_order_line_warehouse_allocations(company_id, sales_order_line_id, warehouse_id, quantity, reserved_quantity)
      values (h.company_id, v_line, a.warehouse_id, a.qty, a.qty);
    end loop;
    update public.reservations set source_type = 'SALES_ORDER', source_id = v_so, sales_order_id = v_so,
      sales_order_line_id = v_line, customer_id = v_cust
    where reservation_order_id = p_order_id and status = 'ACTIVE'
      and product_id = g.product_id and variant_id is not distinct from g.variant_id;
  end loop;

  update public.reservation_orders set status = 'CONVERTED', customer_id = v_cust, converted_sales_order_id = v_so,
    converted_at = now(), converted_by = auth.uid()
  where id = p_order_id;
  return v_so;
end $$;

create or replace function public.approve_sales_order(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.sales_orders where id = p_id for update;
  if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.approve');
  if h.status = 'APPROVED' then return; end if;
  if h.status <> 'DRAFT' then raise exception 'Only draft sales orders can be approved (this one is %)', h.status using errcode = '22023'; end if;
  update public.sales_orders set status = 'APPROVED', approved_at = now(), approved_by = auth.uid() where id = p_id;
end $$;

create or replace function public.cancel_sales_order(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to cancel a sales order' using errcode = '23502'; end if;
  select * into h from public.sales_orders where id = p_id for update;
  if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  if h.status not in ('DRAFT','APPROVED') then
    raise exception 'A % sales order cannot be cancelled', h.status using errcode = '22023';
  end if;
  if exists (select 1 from public.sales_order_lines where sales_order_id = p_id and delivered_qty > 0) then
    raise exception 'Goods have already been dispatched on this order — close it instead' using errcode = '22023';
  end if;
  update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(),
    release_reason = 'Sales order cancelled: ' || p_reason
  where sales_order_id = p_id and status = 'ACTIVE';
  update public.sales_order_line_warehouse_allocations a set status = 'CANCELLED', reserved_quantity = 0
  from public.sales_order_lines l where l.id = a.sales_order_line_id and l.sales_order_id = p_id;
  update public.sales_orders set status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
  where id = p_id;
end $$;

-- the single-line reservation RPC is replaced by reserved orders
drop function if exists public.create_reservation(uuid, uuid, uuid, uuid, numeric, uuid, text);

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.inv_reserve_line(uuid, uuid, uuid, uuid, numeric, int) from authenticated;
grant execute on function
  public.save_reservation_order(uuid, jsonb, jsonb, uuid),
  public.release_reservation(uuid, text),
  public.release_reservation_order(uuid, text),
  public.convert_reservation_to_sales_order(uuid, uuid, text, text),
  public.approve_sales_order(uuid),
  public.cancel_sales_order(uuid, text)
to authenticated;
