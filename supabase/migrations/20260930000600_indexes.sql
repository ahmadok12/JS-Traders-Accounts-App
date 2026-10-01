-- Search: PostgREST ilike runs on the raw column, so trigram indexes must be on
-- the column itself (not lower(col)) to be usable.
drop index if exists public.products_name_trgm_idx;
drop index if exists public.customers_name_trgm_idx;
drop index if exists public.suppliers_name_trgm_idx;
create index products_name_trgm_idx  on public.products  using gin (name extensions.gin_trgm_ops);
create index customers_name_trgm_idx on public.customers using gin (name extensions.gin_trgm_ops);
create index suppliers_name_trgm_idx on public.suppliers using gin (name extensions.gin_trgm_ops);

-- Frequently joined / filtered foreign keys (advisor: unindexed_foreign_keys)
create index if not exists products_base_uom_idx        on public.products(base_uom_id);
create index if not exists products_brand_idx           on public.products(brand_id);
create index if not exists user_roles_role_idx          on public.user_roles(role_id);
create index if not exists user_roles_company_idx       on public.user_roles(company_id);
create index if not exists uwa_warehouse_idx            on public.user_warehouse_access(warehouse_id);
create index if not exists uca_customer_idx             on public.user_customer_access(customer_id);
create index if not exists warehouses_branch_idx        on public.warehouses(branch_id);
create index if not exists employees_user_idx           on public.employees(user_id);
create index if not exists employees_manager_idx        on public.employees(reporting_manager_id);
create index if not exists bank_accounts_gl_idx         on public.bank_accounts(gl_account_id);
create index if not exists agent_accounts_gl_idx        on public.payment_agent_accounts(gl_account_id);
create index if not exists attachments_category_idx     on public.attachments(category_id);
