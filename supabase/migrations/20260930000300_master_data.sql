-- =====================================================================
-- JS Traders ERP — Stage 2: Master data
-- Spec refs: §7.1 master/inventory/banking/agents, §7.2, §27.2 stage 2,
--            Customer Groups & Farms section, §12, §13, §16.5.1
-- Rules: UUID PKs, company_id tenancy, FK constraints, numeric money,
--        deactivate (is_active) instead of delete, audit on every table.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- Currencies (global reference data)
create table public.currencies (
  code      text primary key check (code ~ '^[A-Z]{3}$'),
  name      text not null,
  symbol    text,
  decimals  smallint not null default 2 check (decimals between 0 and 6),
  is_active boolean not null default true
);

-- Units of measure
create table public.units_of_measure (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  code          text not null,
  name          text not null,
  allow_decimal boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (company_id, code)
);

create table public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  parent_id   uuid references public.product_categories(id),
  code        text,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, name),
  check (parent_id is distinct from id)
);
create index product_categories_parent_idx on public.product_categories(parent_id);

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, name)
);

-- Products
create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  sku                  text not null,
  name                 text not null check (length(trim(name)) > 0),
  alias                text,
  category_id          uuid references public.product_categories(id),
  brand_id             uuid references public.brands(id),
  base_uom_id          uuid not null references public.units_of_measure(id),
  has_variants         boolean not null default false,
  tracking_type        text not null default 'NONE'
                         check (tracking_type in ('NONE','PHYSICAL_UNIT','BATCH','SERIAL')),
  is_bundle            boolean not null default false,
  is_assembled         boolean not null default false,
  allow_negative_stock boolean not null default false,
  origin_country       text,
  weight_kg            numeric(14,4) check (weight_kg is null or weight_kg >= 0),
  dimensions           text,
  hs_code              text,
  reorder_level        numeric(18,4) check (reorder_level is null or reorder_level >= 0),
  description          text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  unique (company_id, sku)
);
create index products_company_active_idx on public.products(company_id, is_active);
create index products_category_idx on public.products(category_id);
create index products_name_trgm_idx on public.products using gin (lower(name) extensions.gin_trgm_ops);

create table public.product_variants (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  product_id           uuid not null references public.products(id),
  sku                  text not null,
  name                 text not null,
  attributes           jsonb not null default '{}'::jsonb, -- descriptive only, never stock/accounting truth
  weight_kg            numeric(14,4) check (weight_kg is null or weight_kg >= 0),
  allow_negative_stock boolean,       -- null = inherit product policy
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  unique (company_id, sku),
  unique (product_id, name)
);
create index product_variants_product_idx on public.product_variants(product_id);

create table public.product_uom_conversions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  product_id  uuid not null references public.products(id),
  uom_id      uuid not null references public.units_of_measure(id),
  factor      numeric(18,6) not null check (factor > 0), -- 1 uom = factor × base uom
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (product_id, uom_id)
);

-- Warehouses & locations
create table public.warehouses (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  branch_id            uuid references public.branches(id),
  code                 text not null,
  name                 text not null,
  address              text,
  phone                text,
  manager_user_id      uuid references public.profiles(id),
  allow_negative_stock boolean not null default false,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  unique (company_id, code)
);

create table public.warehouse_locations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  warehouse_id  uuid not null references public.warehouses(id),
  code          text not null,
  name          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (warehouse_id, code)
);
create index warehouse_locations_wh_idx on public.warehouse_locations(warehouse_id);

create table public.user_warehouse_access (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  warehouse_id  uuid not null references public.warehouses(id),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  unique (user_id, warehouse_id)
);

-- Customers (groups / farms)
create table public.customer_groups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  code        text not null,
  name        text not null,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, code)
);

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  code                text not null,
  name                text not null check (length(trim(name)) > 0),
  group_id            uuid references public.customer_groups(id),
  contact_person      text,
  phone               text,
  whatsapp            text,
  email               text,
  address             text,
  city                text,
  ntn                 text,
  strn                text,
  cnic                text,
  default_currency    text not null default 'PKR' references public.currencies(code),
  payment_terms_days  int check (payment_terms_days is null or payment_terms_days >= 0),
  credit_limit        numeric(18,2) check (credit_limit is null or credit_limit >= 0),
  notes               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (company_id, code)
);
create index customers_company_active_idx on public.customers(company_id, is_active);
create index customers_group_idx on public.customers(group_id);
create index customers_name_trgm_idx on public.customers using gin (lower(name) extensions.gin_trgm_ops);

create table public.customer_salesperson_assignments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  customer_id  uuid not null references public.customers(id),
  user_id      uuid not null references public.profiles(id),
  valid_from   date not null default current_date,
  valid_to     date,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  check (valid_to is null or valid_to >= valid_from)
);
create index csa_user_idx on public.customer_salesperson_assignments(user_id, customer_id);
create index csa_customer_idx on public.customer_salesperson_assignments(customer_id);

create table public.user_customer_access (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  customer_id  uuid not null references public.customers(id),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  unique (user_id, customer_id)
);

-- Suppliers
create table public.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  code                text not null,
  name                text not null check (length(trim(name)) > 0),
  category            text,
  contact_person      text,
  phone               text,
  whatsapp            text,
  email               text,
  country             text,
  city                text,
  address             text,
  ntn                 text,
  default_currency    text not null default 'PKR' references public.currencies(code),
  payment_terms_days  int check (payment_terms_days is null or payment_terms_days >= 0),
  bank_name           text,
  bank_account_title  text,
  bank_account_number text,
  bank_swift          text,
  notes               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (company_id, code)
);
create index suppliers_company_active_idx on public.suppliers(company_id, is_active);
create index suppliers_name_trgm_idx on public.suppliers using gin (lower(name) extensions.gin_trgm_ops);

-- Chart of accounts
create table public.chart_of_accounts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  code          text not null,
  name          text not null,
  account_type  text not null check (account_type in ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  parent_id     uuid references public.chart_of_accounts(id),
  is_group      boolean not null default false,  -- group accounts cannot receive postings
  system_key    text,                             -- e.g. AR_CONTROL, AP_CONTROL; engine lookups
  currency      text references public.currencies(code),
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (company_id, code),
  check (parent_id is distinct from id)
);
create unique index coa_system_key_uq on public.chart_of_accounts(company_id, system_key) where system_key is not null;
create index coa_parent_idx on public.chart_of_accounts(parent_id);

-- Bank / cash accounts
create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  code            text not null,
  name            text not null,
  account_kind    text not null default 'BANK' check (account_kind in ('BANK','CASH','WALLET')),
  bank_name       text,
  branch_name     text,
  account_title   text,
  account_number  text,
  iban            text,
  currency        text not null default 'PKR' references public.currencies(code),
  gl_account_id   uuid references public.chart_of_accounts(id),
  reconciled_until date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  unique (company_id, code)
);

-- Payment agents / money exchanges
create table public.payment_agents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  code            text not null,
  name            text not null,
  contact_person  text,
  phone           text,
  city            text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  unique (company_id, code)
);

create table public.payment_agent_accounts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  payment_agent_id uuid not null references public.payment_agents(id),
  currency         text not null references public.currencies(code),
  gl_account_id    uuid references public.chart_of_accounts(id),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique (payment_agent_id, currency)
);

-- Employees (master only; payroll arrives in stage 6.5)
create table public.employees (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  code            text not null,
  full_name       text not null,
  user_id         uuid references public.profiles(id),
  department      text,
  position        text,
  phone           text,
  cnic            text,
  joining_date    date,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','ON_LEAVE','SUSPENDED','LEFT')),
  reporting_manager_id uuid references public.employees(id),
  address         text,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  unique (company_id, code)
);
create index employees_company_status_idx on public.employees(company_id, status);

-- Attachments metadata (files live in private R2; see §18)
create table public.attachment_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  name        text not null,
  entity_type text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, name)
);

create table public.attachments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  entity_type        text not null,
  entity_id          uuid not null,
  file_name          text not null,
  original_file_name text not null,
  mime_type          text not null,
  file_size          bigint not null check (file_size >= 0),
  checksum_sha256    text,
  r2_bucket          text not null,
  r2_object_key      text not null unique,
  category_id        uuid references public.attachment_categories(id),
  description        text,
  upload_status      text not null default 'PENDING' check (upload_status in ('PENDING','UPLOADED','FAILED','QUARANTINED')),
  optimization_status text not null default 'NOT_APPLICABLE',
  uploaded_by        uuid,
  uploaded_at        timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid
);
create index attachments_entity_idx on public.attachments(entity_type, entity_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Triggers: stamp + audit on all master tables
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'units_of_measure','product_categories','brands','products','product_variants',
    'product_uom_conversions','warehouses','warehouse_locations','customer_groups','customers',
    'customer_salesperson_assignments','suppliers','chart_of_accounts','bank_accounts',
    'payment_agents','payment_agent_accounts','employees','attachment_categories'
  ] loop
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp_row()', t);
  end loop;

  foreach t in array array[
    'units_of_measure','product_categories','brands','products','product_variants',
    'product_uom_conversions','warehouses','warehouse_locations','user_warehouse_access',
    'customer_groups','customers','customer_salesperson_assignments','user_customer_access',
    'suppliers','chart_of_accounts','bank_accounts','payment_agents','payment_agent_accounts',
    'employees','attachment_categories','attachments'
  ] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

alter table public.currencies enable row level security;
create policy currencies_select on public.currencies for select to authenticated using (true);

-- Variant company_id must match its product
create or replace function public.tg_variant_company()
returns trigger language plpgsql set search_path = '' as $$
begin
  select p.company_id into new.company_id from public.products p where p.id = new.product_id;
  if new.company_id is null then raise exception 'product not found'; end if;
  return new;
end $$;
create trigger company_from_product before insert or update of product_id on public.product_variants
  for each row execute function public.tg_variant_company();

create or replace function public.tg_location_company()
returns trigger language plpgsql set search_path = '' as $$
begin
  select w.company_id into new.company_id from public.warehouses w where w.id = new.warehouse_id;
  if new.company_id is null then raise exception 'warehouse not found'; end if;
  return new;
end $$;
create trigger company_from_warehouse before insert or update of warehouse_id on public.warehouse_locations
  for each row execute function public.tg_location_company();

-- Customer group must belong to same company
create or replace function public.tg_customer_group_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.group_id is not null and not exists (
    select 1 from public.customer_groups g where g.id = new.group_id and g.company_id = new.company_id
  ) then
    raise exception 'customer group belongs to another company';
  end if;
  return new;
end $$;
create trigger group_scope before insert or update of group_id, company_id on public.customers
  for each row execute function public.tg_customer_group_scope();

-- COA: posting (non-group) accounts cannot have children
create or replace function public.tg_coa_parent_is_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.chart_of_accounts a
    where a.id = new.parent_id and a.is_group and a.company_id = new.company_id
      and a.account_type = new.account_type
  ) then
    raise exception 'parent must be a group account of the same type and company';
  end if;
  return new;
end $$;
create trigger parent_is_group before insert or update of parent_id on public.chart_of_accounts
  for each row execute function public.tg_coa_parent_is_group();

-- ---------------------------------------------------------------------
-- Scope helpers
-- ---------------------------------------------------------------------
create or replace function public.can_access_warehouse(p_warehouse_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id
      and public.has_permission(w.company_id, 'warehouses.view')
      and (
        public.has_permission(w.company_id, 'warehouses.all')
        or exists (select 1 from public.user_warehouse_access a
                   where a.warehouse_id = w.id and a.user_id = auth.uid())
      )
  );
$$;

create or replace function public.can_access_customer(p_customer_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer_id
      and (
        public.has_permission(c.company_id, 'customers.view')
        or (
          public.has_permission(c.company_id, 'customers.view_assigned')
          and (
            exists (select 1 from public.customer_salesperson_assignments s
                    where s.customer_id = c.id and s.user_id = auth.uid()
                      and s.valid_from <= current_date
                      and (s.valid_to is null or s.valid_to >= current_date))
            or exists (select 1 from public.user_customer_access a
                       where a.customer_id = c.id and a.user_id = auth.uid())
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------
-- Standard RLS: select = <module>.view, insert/update = <module>.manage.
-- No DELETE policies: master data is deactivated, never hard-deleted.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
    ('units_of_measure','products'),
    ('product_categories','products'),
    ('brands','products'),
    ('products','products'),
    ('product_variants','products'),
    ('product_uom_conversions','products'),
    ('customer_groups','customers'),
    ('suppliers','suppliers'),
    ('chart_of_accounts','accounts'),
    ('bank_accounts','banks'),
    ('payment_agents','payment_agents'),
    ('payment_agent_accounts','payment_agents'),
    ('employees','employees'),
    ('attachment_categories','attachments')
  ) as v(tbl, module) loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
      using (public.has_permission(company_id, '%2$s.view'))$f$, r.tbl, r.module);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (public.has_permission(company_id, '%2$s.manage'))$f$, r.tbl, r.module);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated
      using (public.has_permission(company_id, '%2$s.manage'))
      with check (public.has_permission(company_id, '%2$s.manage'))$f$, r.tbl, r.module);
  end loop;
end $$;

-- Customers: full view OR assigned-only (salesperson)
create policy customers_select on public.customers for select to authenticated
  using (public.can_access_customer(id));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_permission(company_id, 'customers.manage'));
create policy customers_update on public.customers for update to authenticated
  using (public.has_permission(company_id, 'customers.manage'))
  with check (public.has_permission(company_id, 'customers.manage'));

create policy csa_select on public.customer_salesperson_assignments for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'customers.view'));
create policy csa_insert on public.customer_salesperson_assignments for insert to authenticated
  with check (public.has_permission(company_id, 'customers.manage'));
create policy csa_update on public.customer_salesperson_assignments for update to authenticated
  using (public.has_permission(company_id, 'customers.manage'))
  with check (public.has_permission(company_id, 'customers.manage'));

create policy uca_select on public.user_customer_access for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'security.manage'));
create policy uca_insert on public.user_customer_access for insert to authenticated
  with check (public.has_permission(company_id, 'security.manage'));
create policy uca_delete on public.user_customer_access for delete to authenticated
  using (public.has_permission(company_id, 'security.manage'));

-- Warehouses: scoped by warehouse access
create policy warehouses_select on public.warehouses for select to authenticated
  using (public.can_access_warehouse(id));
create policy warehouses_insert on public.warehouses for insert to authenticated
  with check (public.has_permission(company_id, 'warehouses.manage'));
create policy warehouses_update on public.warehouses for update to authenticated
  using (public.has_permission(company_id, 'warehouses.manage'))
  with check (public.has_permission(company_id, 'warehouses.manage'));

create policy locations_select on public.warehouse_locations for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
create policy locations_insert on public.warehouse_locations for insert to authenticated
  with check (public.has_permission(company_id, 'warehouses.manage'));
create policy locations_update on public.warehouse_locations for update to authenticated
  using (public.has_permission(company_id, 'warehouses.manage'))
  with check (public.has_permission(company_id, 'warehouses.manage'));

create policy uwa_select on public.user_warehouse_access for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'security.manage'));
create policy uwa_insert on public.user_warehouse_access for insert to authenticated
  with check (public.has_permission(company_id, 'security.manage'));
create policy uwa_delete on public.user_warehouse_access for delete to authenticated
  using (public.has_permission(company_id, 'security.manage'));

-- Attachments: metadata visible with attachments.view; writes go through the
-- attachment service (edge function, service role) — no client insert policy.
create policy attachments_select on public.attachments for select to authenticated
  using (deleted_at is null and public.has_permission(company_id, 'attachments.view'));

-- Sensitive columns: warehouse roles never receive customer credit / supplier
-- bank columns. Column privileges enforce it for the authenticated role; the
-- accounting/admin apps read them through definer RPCs below.
do $$
declare r record; v_cols text;
begin
  for r in select * from (values
    ('customers',  array['credit_limit','cnic']),
    ('suppliers',  array['bank_name','bank_account_title','bank_account_number','bank_swift']),
    ('employees',  array['cnic'])
  ) as v(tbl, hidden) loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = r.tbl and column_name <> all (r.hidden);
    execute format('revoke select on public.%I from authenticated, anon', r.tbl);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, r.tbl);
  end loop;
end $$;

create or replace function public.customer_financial_details(p_customer_id uuid)
returns table (credit_limit numeric, cnic text)
language sql stable security definer set search_path = ''
as $$
  select c.credit_limit, c.cnic from public.customers c
  where c.id = p_customer_id and public.has_permission(c.company_id, 'customers.view_financial');
$$;

create or replace function public.supplier_bank_details(p_supplier_id uuid)
returns table (bank_name text, bank_account_title text, bank_account_number text, bank_swift text)
language sql stable security definer set search_path = ''
as $$
  select s.bank_name, s.bank_account_title, s.bank_account_number, s.bank_swift
  from public.suppliers s
  where s.id = p_supplier_id and public.has_permission(s.company_id, 'suppliers.view_financial');
$$;

create or replace function public.employee_restricted_details(p_employee_id uuid)
returns table (cnic text)
language sql stable security definer set search_path = ''
as $$
  select e.cnic from public.employees e
  where e.id = p_employee_id and public.has_permission(e.company_id, 'employees.view_restricted');
$$;

revoke execute on all functions in schema public from anon;
