-- =====================================================================
-- JS Traders ERP — Stage 3: Inventory engine (schema)
-- Spec refs: §8 inventory engine, §10 warehouse ops, §22 transaction rules
-- stock_movements is the authoritative, append-only ledger.
-- stock_balances is a derived read model maintained ONLY by the posting engine.
-- All document writes go through SECURITY DEFINER RPCs (next migration).
-- =====================================================================

-- ---------------------------------------------------------------- permissions
insert into public.permissions(code, module, description, is_sensitive) values
  ('inventory.view','inventory','View stock, movements and inventory documents',false),
  ('inventory.receive','inventory','Create and post goods receipts (quantity only)',false),
  ('inventory.transfer','inventory','Create and post stock transfers',false),
  ('inventory.adjust','inventory','Prepare stock adjustments / opening stock',false),
  ('inventory.count','inventory','Enter physical stock counts',false),
  ('inventory.post','inventory','Approve/post adjustments & counts, reverse documents',true),
  ('inventory.reserve','inventory','Create and release stock reservations',false)
on conflict (code) do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values
  ('ADMINISTRATOR','inventory.view'),('ADMINISTRATOR','inventory.receive'),('ADMINISTRATOR','inventory.transfer'),
  ('ADMINISTRATOR','inventory.adjust'),('ADMINISTRATOR','inventory.count'),('ADMINISTRATOR','inventory.post'),
  ('ADMINISTRATOR','inventory.reserve'),
  ('OWNER','inventory.view'),
  ('ACCOUNTANT','inventory.view'),
  ('WAREHOUSE_MANAGER','inventory.view'),('WAREHOUSE_MANAGER','inventory.receive'),('WAREHOUSE_MANAGER','inventory.transfer'),
  ('WAREHOUSE_MANAGER','inventory.adjust'),('WAREHOUSE_MANAGER','inventory.count'),('WAREHOUSE_MANAGER','inventory.post'),
  ('WAREHOUSE_MANAGER','inventory.reserve'),
  ('WAREHOUSE_STAFF','inventory.view'),('WAREHOUSE_STAFF','inventory.receive'),('WAREHOUSE_STAFF','inventory.count')
) as x(role_code, p) on x.role_code = r.code
on conflict do nothing;

-- numbering for inventory documents (yearly reset: GRN-2026-00001)
insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, x.t, x.p, 5, true from public.companies c
cross join (values ('GOODS_RECEIPT','GRN-'),('STOCK_TRANSFER','TRF-'),('STOCK_ADJUSTMENT','ADJ-'),
                   ('STOCK_COUNT','CNT-'),('RESERVATION','RSV-')) as x(t, p)
on conflict do nothing;

-- ---------------------------------------------------------------- ledger
create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  movement_date   date not null default current_date,
  movement_type   text not null check (movement_type in (
                    'OPENING','PURCHASE_RECEIPT','SALES_GDN','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT',
                    'RETURN','DAMAGE','ASSEMBLY_IN','ASSEMBLY_OUT','DISASSEMBLY_IN','DISASSEMBLY_OUT')),
  warehouse_id    uuid not null references public.warehouses(id),
  location_id     uuid references public.warehouse_locations(id),
  product_id      uuid not null references public.products(id),
  variant_id      uuid references public.product_variants(id),
  quantity        numeric(18,4) not null check (quantity <> 0),   -- signed: + in, - out
  source_type     text not null,        -- GOODS_RECEIPT, STOCK_TRANSFER, STOCK_ADJUSTMENT, STOCK_COUNT, ...
  source_id       uuid not null,
  source_line_id  uuid,
  source_doc_no   text,
  reason          text,
  reversal_of     uuid references public.stock_movements(id),
  created_at      timestamptz not null default now(),
  created_by      uuid
);
create index stock_movements_item_idx   on public.stock_movements(company_id, warehouse_id, product_id, variant_id, created_at);
create index stock_movements_source_idx on public.stock_movements(source_type, source_id);
create index stock_movements_product_idx on public.stock_movements(product_id, variant_id);
create index stock_movements_date_idx   on public.stock_movements(company_id, movement_date desc);
create index stock_movements_loc_idx    on public.stock_movements(location_id);
create index stock_movements_rev_idx    on public.stock_movements(reversal_of);

-- append-only: history is never edited or removed (corrections = reversal movements)
create or replace function public.tg_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only; post a reversal instead', tg_table_name using errcode = '42501';
end $$;
create trigger immutable before update or delete on public.stock_movements
  for each row execute function public.tg_immutable();

create table public.stock_balances (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  warehouse_id  uuid not null references public.warehouses(id),
  location_id   uuid references public.warehouse_locations(id),
  product_id    uuid not null references public.products(id),
  variant_id    uuid references public.product_variants(id),
  on_hand       numeric(18,4) not null default 0,
  last_movement_at timestamptz,
  updated_at    timestamptz not null default now(),
  constraint stock_balances_identity unique nulls not distinct (warehouse_id, location_id, product_id, variant_id)
);
create index stock_balances_company_idx on public.stock_balances(company_id, warehouse_id, product_id, variant_id);
create index stock_balances_product_idx on public.stock_balances(product_id, variant_id);
create index stock_balances_negative_idx on public.stock_balances(company_id) where on_hand < 0;

-- ---------------------------------------------------------------- documents
-- Common status model: DRAFT → POSTED → (REVERSED) ; DRAFT → CANCELLED

create table public.goods_receipts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  doc_date           date not null default current_date,
  warehouse_id       uuid not null references public.warehouses(id),
  supplier_id        uuid references public.suppliers(id),
  supplier_reference text,
  status             text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  cost_status        text not null default 'PENDING' check (cost_status in ('PENDING','ENTERED','APPROVED')),
  notes              text,
  posted_at          timestamptz, posted_by uuid,
  reversed_at        timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index goods_receipts_list_idx on public.goods_receipts(company_id, status, doc_date desc);
create index goods_receipts_wh_idx on public.goods_receipts(warehouse_id);
create index goods_receipts_supplier_idx on public.goods_receipts(supplier_id);

create table public.goods_receipt_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  receipt_id   uuid not null references public.goods_receipts(id) on delete cascade,
  line_no      int not null,
  product_id   uuid not null references public.products(id),
  variant_id   uuid references public.product_variants(id),
  location_id  uuid references public.warehouse_locations(id),
  quantity     numeric(18,4) not null check (quantity > 0),
  notes        text,
  unique (receipt_id, line_no)
);
create index grl_receipt_idx on public.goods_receipt_lines(receipt_id);
create index grl_product_idx on public.goods_receipt_lines(product_id, variant_id);

create table public.stock_transfers (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  doc_date           date not null default current_date,
  from_warehouse_id  uuid not null references public.warehouses(id),
  to_warehouse_id    uuid not null references public.warehouses(id),
  status             text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  reference          text,
  transport_details  text,
  notes              text,
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index stock_transfers_list_idx on public.stock_transfers(company_id, status, doc_date desc);
create index stock_transfers_from_idx on public.stock_transfers(from_warehouse_id);
create index stock_transfers_to_idx on public.stock_transfers(to_warehouse_id);

create table public.stock_transfer_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  transfer_id       uuid not null references public.stock_transfers(id) on delete cascade,
  line_no           int not null,
  product_id        uuid not null references public.products(id),
  variant_id        uuid references public.product_variants(id),
  from_location_id  uuid references public.warehouse_locations(id),
  to_location_id    uuid references public.warehouse_locations(id),
  quantity          numeric(18,4) not null check (quantity > 0),
  notes             text,
  unique (transfer_id, line_no)
);
create index stl_transfer_idx on public.stock_transfer_lines(transfer_id);
create index stl_product_idx on public.stock_transfer_lines(product_id, variant_id);

create table public.stock_adjustments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  doc_no          text not null,
  doc_date        date not null default current_date,
  warehouse_id    uuid not null references public.warehouses(id),
  reason          text not null default 'WAREHOUSE_CORRECTION' check (reason in (
                    'INITIAL_COUNT','DAMAGE','LOSS','FOUND_STOCK','COUNT_CORRECTION','OPENING_BALANCE',
                    'WAREHOUSE_CORRECTION','OTHER')),
  status          text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  reference       text,
  notes           text,
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index stock_adjustments_list_idx on public.stock_adjustments(company_id, status, doc_date desc);
create index stock_adjustments_wh_idx on public.stock_adjustments(warehouse_id);

create table public.stock_adjustment_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  adjustment_id  uuid not null references public.stock_adjustments(id) on delete cascade,
  line_no        int not null,
  product_id     uuid not null references public.products(id),
  variant_id     uuid references public.product_variants(id),
  location_id    uuid references public.warehouse_locations(id),
  quantity       numeric(18,4) not null check (quantity <> 0),  -- + increase, - decrease
  notes          text,
  unique (adjustment_id, line_no)
);
create index sal_adjustment_idx on public.stock_adjustment_lines(adjustment_id);
create index sal_product_idx on public.stock_adjustment_lines(product_id, variant_id);

-- Progressive physical count (§8.4): lines are counted and posted in batches
create table public.stock_counts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  doc_no        text not null,
  doc_date      date not null default current_date,
  warehouse_id  uuid not null references public.warehouses(id),
  count_type    text not null default 'INITIAL_COUNT' check (count_type in ('INITIAL_COUNT','COUNT_CORRECTION')),
  status        text not null default 'OPEN' check (status in ('OPEN','CLOSED','CANCELLED')),
  scope_notes   text,
  notes         text,
  closed_at timestamptz, closed_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index stock_counts_list_idx on public.stock_counts(company_id, status, doc_date desc);
create index stock_counts_wh_idx on public.stock_counts(warehouse_id);

create table public.stock_count_lines (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  count_id           uuid not null references public.stock_counts(id) on delete cascade,
  product_id         uuid not null references public.products(id),
  variant_id         uuid references public.product_variants(id),
  location_id        uuid references public.warehouse_locations(id),
  counted_qty        numeric(18,4) check (counted_qty is null or counted_qty >= 0),
  status             text not null default 'PENDING' check (status in ('PENDING','COUNTED','POSTED')),
  system_qty_before  numeric(18,4),
  adjustment_qty     numeric(18,4),
  system_qty_after   numeric(18,4),
  variance_note      text,
  counted_by uuid, counted_at timestamptz,
  posted_by uuid, posted_at timestamptz,
  constraint stock_count_lines_identity unique nulls not distinct (count_id, product_id, variant_id, location_id)
);
create index scl_count_idx on public.stock_count_lines(count_id, status);
create index scl_product_idx on public.stock_count_lines(product_id, variant_id);

-- Reservations (warehouse level). Source = MANUAL now; SALES_ORDER in Stage 5.
create table public.reservations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  doc_no        text not null,
  warehouse_id  uuid not null references public.warehouses(id),
  product_id    uuid not null references public.products(id),
  variant_id    uuid references public.product_variants(id),
  quantity      numeric(18,4) not null check (quantity > 0),
  source_type   text not null default 'MANUAL' check (source_type in ('MANUAL','SALES_ORDER')),
  source_id     uuid,
  customer_id   uuid references public.customers(id),
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','RELEASED','CONSUMED')),
  notes         text,
  released_at timestamptz, released_by uuid, release_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index reservations_item_idx on public.reservations(warehouse_id, product_id, variant_id) where status = 'ACTIVE';
create index reservations_list_idx on public.reservations(company_id, status, created_at desc);
create index reservations_customer_idx on public.reservations(customer_id);

-- ---------------------------------------------------------------- triggers
do $$
declare t text;
begin
  foreach t in array array['goods_receipts','stock_transfers','stock_adjustments','stock_counts','reservations'] loop
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp_row()', t);
  end loop;
  foreach t in array array['goods_receipts','goods_receipt_lines','stock_transfers','stock_transfer_lines',
                           'stock_adjustments','stock_adjustment_lines','stock_counts','stock_count_lines','reservations'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit_row()', t);
  end loop;
  foreach t in array array['stock_movements','stock_balances','goods_receipts','goods_receipt_lines','stock_transfers',
                           'stock_transfer_lines','stock_adjustments','stock_adjustment_lines','stock_counts',
                           'stock_count_lines','reservations'] loop
    execute format('alter table public.%I enable row level security', t);
    -- clients never write inventory tables directly; only the posting RPCs do
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS (read)
create or replace function public.can_view_inventory(p_company_id uuid, p_warehouse_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_company_id, 'inventory.view') and public.can_access_warehouse(p_warehouse_id);
$$;
revoke execute on function public.can_view_inventory(uuid, uuid) from public, anon;
grant execute on function public.can_view_inventory(uuid, uuid) to authenticated;

create policy sm_select  on public.stock_movements  for select to authenticated using (public.can_view_inventory(company_id, warehouse_id));
create policy sb_select  on public.stock_balances   for select to authenticated using (public.can_view_inventory(company_id, warehouse_id));
create policy gr_select  on public.goods_receipts   for select to authenticated using (public.can_view_inventory(company_id, warehouse_id));
create policy sa_select  on public.stock_adjustments for select to authenticated using (public.can_view_inventory(company_id, warehouse_id));
create policy sc_select  on public.stock_counts     for select to authenticated using (public.can_view_inventory(company_id, warehouse_id));
create policy rs_select  on public.reservations     for select to authenticated using (public.can_view_inventory(company_id, warehouse_id));
create policy st_select  on public.stock_transfers  for select to authenticated
  using (public.can_view_inventory(company_id, from_warehouse_id) or public.can_view_inventory(company_id, to_warehouse_id));

create policy grl_select on public.goods_receipt_lines for select to authenticated
  using (exists (select 1 from public.goods_receipts h where h.id = receipt_id));
create policy stl_select on public.stock_transfer_lines for select to authenticated
  using (exists (select 1 from public.stock_transfers h where h.id = transfer_id));
create policy sal_select on public.stock_adjustment_lines for select to authenticated
  using (exists (select 1 from public.stock_adjustments h where h.id = adjustment_id));
create policy scl_select on public.stock_count_lines for select to authenticated
  using (exists (select 1 from public.stock_counts h where h.id = count_id));

-- ---------------------------------------------------------------- read views
-- security_invoker: the caller's RLS applies to every underlying table.
create view public.stock_on_hand with (security_invoker = true) as
with bal as (
  select company_id, warehouse_id, product_id, variant_id,
         sum(on_hand) as on_hand, max(last_movement_at) as last_movement_at
  from public.stock_balances
  group by company_id, warehouse_id, product_id, variant_id
), res as (
  select warehouse_id, product_id, variant_id, sum(quantity) as reserved
  from public.reservations where status = 'ACTIVE'
  group by warehouse_id, product_id, variant_id
)
select
  md5(b.warehouse_id::text || b.product_id::text || coalesce(b.variant_id::text, ''))::uuid as id,
  b.company_id, b.warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
  b.product_id, p.sku, p.name as product_name, p.alias as product_alias,
  b.variant_id, v.sku as variant_sku, v.name as variant_name,
  u.code as uom_code, p.category_id, p.reorder_level,
  b.on_hand,
  coalesce(r.reserved, 0) as reserved,
  b.on_hand - coalesce(r.reserved, 0) as available,
  b.last_movement_at,
  (b.on_hand < 0) as is_negative,
  (p.reorder_level is not null and b.on_hand <= p.reorder_level) as is_low
from bal b
join public.warehouses w on w.id = b.warehouse_id
join public.products p on p.id = b.product_id
join public.units_of_measure u on u.id = p.base_uom_id
left join public.product_variants v on v.id = b.variant_id
left join res r on r.warehouse_id = b.warehouse_id and r.product_id = b.product_id
               and r.variant_id is not distinct from b.variant_id;

create view public.stock_ledger with (security_invoker = true) as
select m.id, m.company_id, m.movement_date, m.created_at, m.movement_type,
       m.warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
       m.location_id, l.code as location_code,
       m.product_id, p.sku, p.name as product_name, m.variant_id, v.name as variant_name,
       m.quantity, m.source_type, m.source_id, m.source_doc_no, m.reason, m.reversal_of, m.created_by,
       sum(m.quantity) over (partition by m.warehouse_id, m.product_id, m.variant_id
                             order by m.created_at, m.id rows unbounded preceding) as balance_after
from public.stock_movements m
join public.warehouses w on w.id = m.warehouse_id
join public.products p on p.id = m.product_id
left join public.product_variants v on v.id = m.variant_id
left join public.warehouse_locations l on l.id = m.location_id;

grant select on public.stock_on_hand, public.stock_ledger to authenticated;
revoke all on public.stock_on_hand, public.stock_ledger from anon;
