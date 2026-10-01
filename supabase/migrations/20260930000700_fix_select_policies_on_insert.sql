-- Fix: INSERT ... RETURNING checks the SELECT policy against the NEW row.
-- The old policies called can_access_customer(id) / can_access_warehouse(id),
-- which look the row up by id — the row isn't visible to that lookup yet, so
-- every create failed with 42501. Evaluate the new row's own columns instead.

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (
    public.has_permission(company_id, 'customers.view')
    or (
      public.has_permission(company_id, 'customers.view_assigned')
      and (
        exists (select 1 from public.customer_salesperson_assignments s
                where s.customer_id = customers.id and s.user_id = (select auth.uid())
                  and s.valid_from <= current_date
                  and (s.valid_to is null or s.valid_to >= current_date))
        or exists (select 1 from public.user_customer_access a
                   where a.customer_id = customers.id and a.user_id = (select auth.uid()))
      )
    )
  );

drop policy if exists warehouses_select on public.warehouses;
create policy warehouses_select on public.warehouses for select to authenticated
  using (
    public.has_permission(company_id, 'warehouses.view')
    and (
      public.has_permission(company_id, 'warehouses.all')
      or created_by = (select auth.uid())
      or exists (select 1 from public.user_warehouse_access a
                 where a.warehouse_id = warehouses.id and a.user_id = (select auth.uid()))
    )
  );
