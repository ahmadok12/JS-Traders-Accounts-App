-- Warehouse Staff = mobile picking only. They must not create receipts, counts,
-- or browse stock. Picking-task permissions are added in Stage 5.
delete from public.role_permissions rp using public.roles r
where rp.role_id = r.id and r.code = 'WAREHOUSE_STAFF'
  and rp.permission_code in ('inventory.view','inventory.receive','inventory.count');

update public.roles set description = 'Mobile only: picks assigned stock, ticks items off, uploads photos. No office screens, no financial data.'
where code = 'WAREHOUSE_STAFF';
update public.roles set description = 'Runs the warehouse: creates and approves GRN, opening stock, adjustments, counts, transfers (and SO/GDN from Stage 5). No prices, costs or financial data.'
where code = 'WAREHOUSE_MANAGER';
