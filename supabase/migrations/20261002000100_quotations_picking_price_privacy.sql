-- =====================================================================
-- JS Traders ERP — Stage 5 part 2a: price privacy for warehouse roles, quotations, picking tasks
-- (applied in three parts: stage5b_prices_permissions, stage5b_quotations, stage5b_picking)
-- =====================================================================
-- ---------------------------------------------------------------- permissions + numbering
insert into public.permissions(code, module, description, is_sensitive) values
  ('sales.view_prices','sales','See selling prices, order values, quotations and sales invoices',true),
  ('picking.manage','warehouse','Create, assign and reassign picking tasks; make GDNs from picked goods',false),
  ('picking.perform','warehouse','Pick assigned tasks (phone): picked quantity, shortages, complete',false)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values ('ADMINISTRATOR','sales.view_prices'),('ADMINISTRATOR','picking.manage'),('ADMINISTRATOR','picking.perform'),
             ('OWNER','sales.view_prices'),('ACCOUNTANT','sales.view_prices'),('SALESPERSON','sales.view_prices'),
             ('WAREHOUSE_MANAGER','picking.manage'),('WAREHOUSE_MANAGER','picking.perform'),
             ('WAREHOUSE_STAFF','picking.perform')) as x(role_code, p) on x.role_code = r.code
on conflict do nothing;
insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, x.t, x.p, 5, true from public.companies c
cross join (values ('QUOTATION','QT-'),('PICKING','PICK-')) as x(t, p)
on conflict do nothing;

-- ---------------------------------------------------------------- selling prices hidden from warehouse roles (§3.3)
-- Column privileges: nobody reads unit_price of SO / GDN lines directly; the price RPCs below
-- return it only to users with sales.view_prices.
do $$
declare r record; v_cols text;
begin
  for r in select * from (values ('sales_order_lines', array['unit_price']), ('gdn_lines', array['unit_price'])) as v(tbl, hidden) loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name <> all (r.hidden);
    execute format('revoke select on public.%I from authenticated, anon', r.tbl);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, r.tbl);
  end loop;
end $$;

create or replace function public.so_line_prices(p_so_ids uuid[])
returns table (sales_order_id uuid, line_id uuid, unit_price numeric)
language sql stable security definer set search_path = '' as $$
  select l.sales_order_id, l.id, l.unit_price
  from public.sales_order_lines l join public.sales_orders s on s.id = l.sales_order_id
  where l.sales_order_id = any(p_so_ids)
    and public.has_permission(s.company_id, 'sales.view') and public.has_permission(s.company_id, 'sales.view_prices')
    and public.can_access_customer(s.customer_id);
$$;
revoke execute on function public.so_line_prices(uuid[]) from public, anon;
grant execute on function public.so_line_prices(uuid[]) to authenticated;

create or replace function public.gdn_line_prices(p_gdn_ids uuid[])
returns table (gdn_id uuid, line_id uuid, unit_price numeric)
language sql stable security definer set search_path = '' as $$
  select l.gdn_id, l.id, l.unit_price
  from public.gdn_lines l join public.gdns g on g.id = l.gdn_id
  where l.gdn_id = any(p_gdn_ids)
    and public.has_permission(g.company_id, 'sales.view') and public.has_permission(g.company_id, 'sales.view_prices')
    and public.can_access_customer(g.customer_id);
$$;
revoke execute on function public.gdn_line_prices(uuid[]) from public, anon;
grant execute on function public.gdn_line_prices(uuid[]) to authenticated;

-- invoices (and their payments) only for price viewers or accounting
alter policy sinv_select on public.sales_invoices
  using ((public.has_permission(company_id, 'sales.view') and public.has_permission(company_id, 'sales.view_prices') and public.can_access_customer(customer_id))
         or public.has_permission(company_id, 'journals.view'));

-- users who cannot see prices keep the existing price when they edit an order
do $$
declare d text;
  o text := $o$v_price := nullif(l->>'unit_price','')::numeric;$o$;
begin
  d := pg_get_functiondef('public.save_sales_order(uuid,jsonb,jsonb,uuid)'::regprocedure);
  if position('sales.view_prices' in d) = 0 then
    if position(o in d) = 0 then raise exception 'save_sales_order: anchor not found'; end if;
    d := replace(d, o, o || $n$
    if not public.has_permission(v_company, 'sales.view_prices') then
      v_price := (select s.unit_price from public.sales_order_lines s where s.id = nullif(l->>'id','')::uuid and s.sales_order_id = v_id);
    end if;$n$);
    execute d;
  end if;
  d := pg_get_functiondef('public.revise_sales_order(uuid,jsonb,jsonb)'::regprocedure);
  if position('sales.view_prices' in d) = 0 then
    if position(o in d) = 0 then raise exception 'revise_sales_order: anchor not found'; end if;
    d := replace(d, o, o || $n$
    if not public.has_permission(h.company_id, 'sales.view_prices') then
      v_price := (select s.unit_price from public.sales_order_lines s where s.id = nullif(l->>'id','')::uuid and s.sales_order_id = p_id);
    end if;$n$);
    execute d;
  end if;
end $$;
-- ---------------------------------------------------------------- quotations
create table public.quotations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  quote_date         date not null default current_date,
  valid_until        date,
  customer_id        uuid not null references public.customers(id),
  customer_reference text,
  status             text not null default 'DRAFT' check (status in ('DRAFT','SENT','ACCEPTED','REJECTED','CANCELLED','CONVERTED')),
  status_reason      text,
  terms              text,
  notes              text,
  subtotal           numeric(18,2) not null default 0,
  discount_amount    numeric(18,2) not null default 0 check (discount_amount >= 0),
  total_amount       numeric(18,2) not null default 0,
  sales_order_id     uuid references public.sales_orders(id),
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index quotations_list_idx on public.quotations(company_id, quote_date desc, created_at desc);
create index quotations_customer_idx on public.quotations(customer_id);

create table public.quotation_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  quotation_id uuid not null references public.quotations(id),
  line_no      int not null,
  product_id   uuid not null references public.products(id),
  variant_id   uuid references public.product_variants(id),
  quantity     numeric(18,4) not null check (quantity > 0),
  unit_price   numeric(18,2) not null check (unit_price >= 0),
  description  text,
  is_active    boolean not null default true
);
create unique index ql_active_line_uq on public.quotation_lines(quotation_id, line_no) where is_active;
create index ql_quotation_idx on public.quotation_lines(quotation_id);

alter table public.sales_orders add column if not exists source_quotation_id uuid references public.quotations(id);

create trigger stamp before insert or update on public.quotations for each row execute function public.tg_stamp_row();
do $$
declare t text;
begin
  foreach t in array array['quotations','quotation_lines'] loop
    execute format('create trigger audit after insert or update on public.%I for each row execute function public.tg_audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;
create policy quotation_select on public.quotations for select to authenticated
  using (public.has_permission(company_id, 'sales.view') and public.has_permission(company_id, 'sales.view_prices') and public.can_access_customer(customer_id));
create policy quotation_line_select on public.quotation_lines for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));

-- p_header: {company_id, customer_id, quote_date, valid_until, customer_reference, terms, notes, discount_amount}
-- p_lines:  [{product_id, variant_id, quantity, unit_price, description}]
create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_cust uuid := nullif(p_header->>'customer_id','')::uuid;
  v_id uuid; h record; l jsonb; n int := 0; p record; v_q numeric; v_p numeric; v_vid uuid; v_sub numeric := 0; v_disc numeric;
begin
  perform public.inv_require(v_company, 'sales.manage');
  perform public.inv_require(v_company, 'sales.view_prices');
  if v_cust is null or not exists (select 1 from public.customers where id = v_cust and company_id = v_company and is_active) then
    raise exception 'Choose an active customer' using errcode = '23502';
  end if;
  if not public.can_access_customer(v_cust) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;
  v_disc := coalesce(nullif(p_header->>'discount_amount','')::numeric, 0);
  if v_disc < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;

  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.quotations where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.quotations(company_id, doc_no, customer_id, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'QUOTATION'), v_cust, p_idempotency_key) returning id into v_id;
  else
    select * into h from public.quotations where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Quotation not found' using errcode = 'P0002'; end if;
    if h.status not in ('DRAFT','SENT') then raise exception 'Only draft or sent quotations can be edited (this one is %)', lower(h.status) using errcode = '22023'; end if;
    v_id := p_id;
    update public.quotation_lines set is_active = false, line_no = -abs(line_no) - 100000 where quotation_id = v_id and is_active;
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select id, has_variants, is_active, name into p from public.products where id = nullif(l->>'product_id','')::uuid and company_id = v_company;
    if p.id is null then raise exception 'Line %: choose the item', n using errcode = '23502'; end if;
    if not p.is_active then raise exception 'Line %: "%" is inactive', n, p.name using errcode = '22023'; end if;
    v_vid := nullif(l->>'variant_id','')::uuid;
    if p.has_variants and v_vid is null then raise exception 'Line %: choose the variant of "%"', n, p.name using errcode = '23502'; end if;
    if v_vid is not null and not exists (select 1 from public.product_variants where id = v_vid and product_id = p.id) then
      raise exception 'Line %: variant does not belong to "%"', n, p.name using errcode = '22023';
    end if;
    v_q := nullif(l->>'quantity','')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'Line %: enter the quantity', n using errcode = '23502'; end if;
    v_p := nullif(l->>'unit_price','')::numeric;
    if v_p is null then raise exception 'Line %: enter the price', n using errcode = '23502'; end if;
    if v_p < 0 then raise exception 'Line %: price cannot be negative', n using errcode = '23514'; end if;
    insert into public.quotation_lines(company_id, quotation_id, line_no, product_id, variant_id, quantity, unit_price, description)
    values (v_company, v_id, n, p.id, v_vid, v_q, v_p, nullif(trim(l->>'description'),''));
    v_sub := v_sub + round(v_q * v_p, 2);
  end loop;

  update public.quotations set customer_id = v_cust,
    quote_date = coalesce(nullif(p_header->>'quote_date','')::date, quote_date),
    valid_until = nullif(p_header->>'valid_until','')::date,
    customer_reference = nullif(trim(p_header->>'customer_reference'),''),
    terms = nullif(trim(p_header->>'terms'),''), notes = nullif(trim(p_header->>'notes'),''),
    subtotal = v_sub, discount_amount = v_disc, total_amount = v_sub - v_disc
  where id = v_id;
  return v_id;
end $$;
revoke execute on function public.save_quotation(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_quotation(uuid, jsonb, jsonb, uuid) to authenticated;

-- DRAFT → SENT → ACCEPTED / REJECTED; CANCELLED; back to DRAFT to rework. CONVERTED is set by link_quotation_order.
create or replace function public.set_quotation_status(p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.quotations where id = p_id for update;
  if h.id is null then raise exception 'Quotation not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  if not public.can_access_customer(h.customer_id) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;
  if p_status not in ('DRAFT','SENT','ACCEPTED','REJECTED','CANCELLED') then raise exception 'Unknown status %', p_status using errcode = '22023'; end if;
  if h.status in ('CONVERTED','CANCELLED') then raise exception 'This quotation is % — it cannot be changed', lower(h.status) using errcode = '22023'; end if;
  if p_status in ('REJECTED','CANCELLED') and coalesce(trim(p_reason),'') = '' then raise exception 'Enter a reason' using errcode = '23502'; end if;
  update public.quotations set status = p_status, status_reason = case when p_status in ('REJECTED','CANCELLED') then trim(p_reason) else null end where id = p_id;
end $$;
revoke execute on function public.set_quotation_status(uuid, text, text) from public, anon;
grant execute on function public.set_quotation_status(uuid, text, text) to authenticated;

create or replace function public.link_quotation_order(p_quotation_id uuid, p_so_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare q record; so record;
begin
  select * into q from public.quotations where id = p_quotation_id for update;
  select * into so from public.sales_orders where id = p_so_id for update;
  if q.id is null or so.id is null then raise exception 'Quotation or sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(q.company_id, 'sales.manage');
  if q.company_id <> so.company_id then raise exception 'Different company' using errcode = '42501'; end if;
  if q.status in ('CONVERTED','CANCELLED','REJECTED') then raise exception 'Quotation % is % — it cannot be converted', q.doc_no, lower(q.status) using errcode = '22023'; end if;
  if q.customer_id <> so.customer_id then raise exception 'The sales order is for a different customer' using errcode = '22023'; end if;
  update public.quotations set status = 'CONVERTED', sales_order_id = so.id where id = q.id;
  update public.sales_orders set source_quotation_id = q.id where id = so.id;
end $$;
revoke execute on function public.link_quotation_order(uuid, uuid) from public, anon;
grant execute on function public.link_quotation_order(uuid, uuid) to authenticated;
-- ---------------------------------------------------------------- picking tasks (§10)
create table public.picking_tasks (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  doc_no         text not null,
  warehouse_id   uuid not null references public.warehouses(id),
  sales_order_id uuid not null references public.sales_orders(id),
  so_doc_no      text not null,
  assigned_to    uuid references public.profiles(id),
  status         text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  notes          text,
  due_date       date,
  started_at timestamptz, completed_at timestamptz, completed_by uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  gdn_id         uuid references public.gdns(id),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index pick_list_idx on public.picking_tasks(company_id, status, created_at desc);
create index pick_assignee_idx on public.picking_tasks(assigned_to, status);
create index pick_so_idx on public.picking_tasks(sales_order_id);

create table public.picking_task_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  task_id         uuid not null references public.picking_tasks(id),
  line_no         int not null,
  allocation_id   uuid not null references public.sales_order_line_warehouse_allocations(id),
  product_id      uuid not null references public.products(id),
  variant_id      uuid references public.product_variants(id),
  qty_requested   numeric(18,4) not null check (qty_requested > 0),
  qty_picked      numeric(18,4) check (qty_picked >= 0),
  shortage_reason text,
  picked_at timestamptz, picked_by uuid,
  check (qty_picked is null or qty_picked <= qty_requested),
  unique (task_id, line_no)
);
create index ptl_task_idx on public.picking_task_lines(task_id);
create index ptl_alloc_idx on public.picking_task_lines(allocation_id);

create table public.picking_task_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id    uuid not null references public.picking_tasks(id),
  event      text not null,
  from_user  uuid,
  to_user    uuid,
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index pte_task_idx on public.picking_task_events(task_id, created_at);

create trigger stamp before insert or update on public.picking_tasks for each row execute function public.tg_stamp_row();
create trigger immutable before update or delete on public.picking_task_events for each row execute function public.tg_immutable();
do $$
declare t text;
begin
  foreach t in array array['picking_tasks','picking_task_lines'] loop
    execute format('create trigger audit after insert or update on public.%I for each row execute function public.tg_audit_row()', t);
  end loop;
  foreach t in array array['picking_tasks','picking_task_lines','picking_task_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;
create policy pick_select on public.picking_tasks for select to authenticated
  using ((public.has_permission(company_id, 'picking.manage') and public.can_access_warehouse(warehouse_id))
         or (assigned_to = auth.uid() and public.has_permission(company_id, 'picking.perform')));
create policy pickl_select on public.picking_task_lines for select to authenticated
  using (exists (select 1 from public.picking_tasks t where t.id = task_id));
create policy picke_select on public.picking_task_events for select to authenticated
  using (exists (select 1 from public.picking_tasks t where t.id = task_id));

-- quantity of an allocation already in picking (open tasks + picked but not yet dispatched)
create or replace function public.pick_committed_qty(p_allocation_id uuid, p_exclude_task uuid default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when t.status in ('OPEN','IN_PROGRESS') then l.qty_requested else coalesce(l.qty_picked, 0) end), 0)
  from public.picking_task_lines l join public.picking_tasks t on t.id = l.task_id
  left join public.gdns g on g.id = t.gdn_id
  where l.allocation_id = p_allocation_id and t.id is distinct from p_exclude_task
    and (t.status in ('OPEN','IN_PROGRESS') or (t.status = 'DONE' and (g.id is null or g.status in ('DRAFT','CANCELLED','REVERSED'))));
$$;
revoke execute on function public.pick_committed_qty(uuid, uuid) from public, anon, authenticated;

-- what can still be picked on an order, per item × warehouse
create or replace function public.so_pickable(p_so_id uuid)
returns table (allocation_id uuid, warehouse_id uuid, product_id uuid, variant_id uuid, line_no int, ordered numeric, delivered numeric, in_picking numeric, pickable numeric)
language sql stable security definer set search_path = '' as $$
  select a.id, a.warehouse_id, l.product_id, l.variant_id, l.line_no, a.quantity, a.delivered_quantity,
         public.pick_committed_qty(a.id),
         greatest(a.quantity - a.delivered_quantity - public.pick_committed_qty(a.id), 0)
  from public.sales_order_line_warehouse_allocations a
  join public.sales_order_lines l on l.id = a.sales_order_line_id
  join public.sales_orders s on s.id = l.sales_order_id
  where s.id = p_so_id and l.is_active and a.status = 'OPEN'
    and (public.has_permission(s.company_id, 'picking.manage') or public.has_permission(s.company_id, 'sales.view'))
  order by l.line_no, a.warehouse_id;
$$;
revoke execute on function public.so_pickable(uuid) from public, anon;
grant execute on function public.so_pickable(uuid) to authenticated;

-- people who can be given picking work
create or replace function public.picking_assignees(p_company_id uuid)
returns table (user_id uuid, full_name text, email text)
language sql stable security definer set search_path = '' as $$
  select distinct p.id, coalesce(nullif(p.full_name,''), p.email), p.email
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id and rp.permission_code = 'picking.perform'
  join public.profiles p on p.id = ur.user_id
  where ur.company_id = p_company_id and p.is_active and public.has_permission(p_company_id, 'picking.manage')
  order by 2;
$$;
revoke execute on function public.picking_assignees(uuid) from public, anon;
grant execute on function public.picking_assignees(uuid) to authenticated;

create or replace function public.pick_check_assignee(p_company_id uuid, p_user uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                 where ur.user_id = p_user and ur.company_id = p_company_id and rp.permission_code = 'picking.perform') then
    raise exception 'This person cannot be given picking work' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.pick_check_assignee(uuid, uuid) from public, anon, authenticated;

-- p_header: {company_id, sales_order_id, warehouse_id, assigned_to, notes, due_date}
-- p_lines: [{allocation_id, quantity}] — null = everything still pickable from that warehouse
create or replace function public.create_picking_task(p_header jsonb, p_lines jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_so uuid := nullif(p_header->>'sales_order_id','')::uuid;
  v_wh uuid := nullif(p_header->>'warehouse_id','')::uuid;
  v_user uuid := nullif(p_header->>'assigned_to','')::uuid;
  so record; r record; v_id uuid; v_q numeric; n int := 0;
begin
  perform public.inv_require(v_company, 'picking.manage');
  select * into so from public.sales_orders where id = v_so and company_id = v_company for update;
  if so.id is null then raise exception 'Choose the sales order' using errcode = '23502'; end if;
  if so.status not in ('APPROVED','PARTIALLY_DELIVERED') then raise exception 'Sales order % is % — only approved orders can be picked', so.doc_no, lower(so.status) using errcode = '22023'; end if;
  perform public.inv_check_warehouse(v_company, v_wh);
  if not public.can_access_warehouse(v_wh) then raise exception 'You do not have access to this warehouse' using errcode = '42501'; end if;
  perform public.pick_check_assignee(v_company, v_user);

  insert into public.picking_tasks(company_id, doc_no, warehouse_id, sales_order_id, so_doc_no, assigned_to, notes, due_date)
  values (v_company, public.next_document_number(v_company, 'PICKING'), v_wh, v_so, so.doc_no, v_user,
          nullif(trim(p_header->>'notes'),''), nullif(p_header->>'due_date','')::date)
  returning id into v_id;

  for r in select * from public.so_pickable(v_so) x where x.warehouse_id = v_wh loop
    if p_lines is null then
      v_q := r.pickable;
    else
      select coalesce(sum(nullif(e->>'quantity','')::numeric), 0) into v_q from jsonb_array_elements(p_lines) e where (e->>'allocation_id')::uuid = r.allocation_id;
      if v_q > r.pickable then
        raise exception 'Line %: only % can still be picked from this warehouse', r.line_no, r.pickable::numeric(18,2) using errcode = '23514';
      end if;
    end if;
    if v_q <= 0 then continue; end if;
    n := n + 1;
    insert into public.picking_task_lines(company_id, task_id, line_no, allocation_id, product_id, variant_id, qty_requested)
    values (v_company, v_id, n, r.allocation_id, r.product_id, r.variant_id, v_q);
  end loop;
  if n = 0 then raise exception 'Nothing left to pick from this warehouse on %', so.doc_no using errcode = '22023'; end if;
  insert into public.picking_task_events(company_id, task_id, event, to_user, note) values (v_company, v_id, 'CREATED', v_user, nullif(trim(p_header->>'notes'),''));
  return v_id;
end $$;
revoke execute on function public.create_picking_task(jsonb, jsonb) from public, anon;
grant execute on function public.create_picking_task(jsonb, jsonb) to authenticated;

create or replace function public.assign_picking_task(p_id uuid, p_user uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select * into t from public.picking_tasks where id = p_id for update;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'picking.manage');
  if t.status not in ('OPEN','IN_PROGRESS') then raise exception 'Only open tasks can be reassigned' using errcode = '22023'; end if;
  if t.assigned_to is not distinct from p_user then return; end if;
  perform public.pick_check_assignee(t.company_id, p_user);
  update public.picking_tasks set assigned_to = p_user where id = p_id;
  insert into public.picking_task_events(company_id, task_id, event, from_user, to_user, note)
  values (t.company_id, p_id, case when t.assigned_to is null then 'ASSIGNED' else 'REASSIGNED' end, t.assigned_to, p_user, nullif(trim(p_note),''));
end $$;
revoke execute on function public.assign_picking_task(uuid, uuid, text) from public, anon;
grant execute on function public.assign_picking_task(uuid, uuid, text) to authenticated;

-- the assignee (or a manager) records what was picked; less than asked needs a reason. p_qty null = undo.
create or replace function public.record_pick(p_line_id uuid, p_qty numeric, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l record; t record;
begin
  select * into l from public.picking_task_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  select * into t from public.picking_tasks where id = l.task_id for update;
  if not (public.has_permission(t.company_id, 'picking.manage')
          or (t.assigned_to = auth.uid() and public.has_permission(t.company_id, 'picking.perform'))) then
    raise exception 'This task is not assigned to you' using errcode = '42501';
  end if;
  if t.status not in ('OPEN','IN_PROGRESS') then raise exception 'This task is %', lower(t.status) using errcode = '22023'; end if;
  if p_qty is null then
    update public.picking_task_lines set qty_picked = null, shortage_reason = null, picked_at = null, picked_by = null where id = l.id;
    return;
  end if;
  if p_qty < 0 or p_qty > l.qty_requested then
    raise exception 'Picked quantity must be between 0 and %', l.qty_requested::numeric(18,2) using errcode = '23514';
  end if;
  if p_qty < l.qty_requested and coalesce(trim(p_reason),'') = '' then raise exception 'Say why it is short' using errcode = '23502'; end if;
  update public.picking_task_lines set qty_picked = p_qty, shortage_reason = case when p_qty < qty_requested then trim(p_reason) end,
    picked_at = now(), picked_by = auth.uid() where id = l.id;
  if t.status = 'OPEN' then
    update public.picking_tasks set status = 'IN_PROGRESS', started_at = now() where id = t.id;
    insert into public.picking_task_events(company_id, task_id, event, to_user) values (t.company_id, t.id, 'STARTED', auth.uid());
  end if;
end $$;
revoke execute on function public.record_pick(uuid, numeric, text) from public, anon;
grant execute on function public.record_pick(uuid, numeric, text) to authenticated;

create or replace function public.complete_picking_task(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; v_left int; v_short int;
begin
  select * into t from public.picking_tasks where id = p_id for update;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(t.company_id, 'picking.manage')
          or (t.assigned_to = auth.uid() and public.has_permission(t.company_id, 'picking.perform'))) then
    raise exception 'This task is not assigned to you' using errcode = '42501';
  end if;
  if t.status not in ('OPEN','IN_PROGRESS') then raise exception 'This task is already %', lower(t.status) using errcode = '22023'; end if;
  select count(*) filter (where qty_picked is null), count(*) filter (where qty_picked < qty_requested) into v_left, v_short
    from public.picking_task_lines where task_id = p_id;
  if v_left > 0 then raise exception '% item(s) not ticked yet', v_left using errcode = '23502'; end if;
  update public.picking_tasks set status = 'DONE', completed_at = now(), completed_by = auth.uid() where id = p_id;
  insert into public.picking_task_events(company_id, task_id, event, to_user, note)
  values (t.company_id, p_id, 'COMPLETED', auth.uid(), concat_ws(' · ', case when v_short > 0 then v_short || ' item(s) short' end, nullif(trim(p_note),'')));
end $$;
revoke execute on function public.complete_picking_task(uuid, text) from public, anon;
grant execute on function public.complete_picking_task(uuid, text) to authenticated;

create or replace function public.cancel_picking_task(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'Enter a reason' using errcode = '23502'; end if;
  select * into t from public.picking_tasks where id = p_id for update;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'picking.manage');
  if t.status = 'CANCELLED' then return; end if;
  if t.gdn_id is not null and exists (select 1 from public.gdns where id = t.gdn_id and status in ('DRAFT','POSTED')) then
    raise exception 'A GDN was made from this task — cancel or reverse the GDN first' using errcode = '22023';
  end if;
  update public.picking_tasks set status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason) where id = p_id;
  insert into public.picking_task_events(company_id, task_id, event, note) values (t.company_id, p_id, 'CANCELLED', trim(p_reason));
end $$;
revoke execute on function public.cancel_picking_task(uuid, text) from public, anon;
grant execute on function public.cancel_picking_task(uuid, text) to authenticated;

-- picked goods → draft GDN (the manager checks and dispatches it)
create or replace function public.gdn_from_picking(p_task_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t record; v_lines jsonb; v_gdn uuid;
begin
  select * into t from public.picking_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Picking task not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'picking.manage');
  perform public.inv_require(t.company_id, 'sales.dispatch');
  if t.status <> 'DONE' then raise exception 'Finish the picking first' using errcode = '22023'; end if;
  if t.gdn_id is not null and exists (select 1 from public.gdns where id = t.gdn_id and status in ('DRAFT','POSTED')) then
    return t.gdn_id;
  end if;
  select jsonb_agg(jsonb_build_object('allocation_id', allocation_id, 'quantity', qty_picked) order by line_no) into v_lines
    from public.picking_task_lines where task_id = p_task_id and qty_picked > 0;
  if v_lines is null then raise exception 'Nothing was picked on this task' using errcode = '22023'; end if;
  v_gdn := public.save_gdn(null, jsonb_build_object('company_id', t.company_id, 'sales_order_id', t.sales_order_id,
    'notes', 'Picked on ' || t.doc_no), v_lines, null);
  update public.picking_tasks set gdn_id = v_gdn where id = p_task_id;
  insert into public.picking_task_events(company_id, task_id, event, note)
  values (t.company_id, p_task_id, 'GDN', (select doc_no from public.gdns where id = v_gdn));
  return v_gdn;
end $$;
revoke execute on function public.gdn_from_picking(uuid) from public, anon;
grant execute on function public.gdn_from_picking(uuid) to authenticated;
