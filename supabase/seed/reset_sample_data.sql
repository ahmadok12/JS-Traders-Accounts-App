-- =====================================================================
-- DEV ONLY — removes records tagged "[sample]" and everything that depends
-- on them (stock documents, movements, balances). Your own records are kept.
-- Run in Supabase → SQL Editor. NEVER run on the production project.
-- Stock movements are append-only, so this script temporarily disables that
-- guard for the sample rows only, inside one transaction.
-- =====================================================================
begin;

create temp table _sp on commit drop as
  select id from public.products where description like '[sample]%';
create temp table _sw on commit drop as
  select id from public.warehouses where name like '%[sample]%';

alter table public.stock_movements disable trigger immutable;

-- stock documents that touch sample products
delete from public.stock_movements where product_id in (select id from _sp) or warehouse_id in (select id from _sw);
delete from public.stock_balances  where product_id in (select id from _sp) or warehouse_id in (select id from _sw);
delete from public.reservations    where product_id in (select id from _sp) or warehouse_id in (select id from _sw);
delete from public.stock_count_lines where product_id in (select id from _sp);
delete from public.stock_counts sc where notes like '[sample]%' and not exists (select 1 from public.stock_count_lines l where l.count_id = sc.id);
delete from public.goods_receipt_lines where product_id in (select id from _sp);
delete from public.goods_receipts gr where not exists (select 1 from public.goods_receipt_lines l where l.receipt_id = gr.id);
delete from public.stock_transfer_lines where product_id in (select id from _sp);
delete from public.stock_transfers t where not exists (select 1 from public.stock_transfer_lines l where l.transfer_id = t.id);
delete from public.stock_adjustment_lines where product_id in (select id from _sp);
delete from public.stock_adjustments a where not exists (select 1 from public.stock_adjustment_lines l where l.adjustment_id = a.id);

alter table public.stock_movements enable trigger immutable;

-- master data
delete from public.product_variants where product_id in (select id from _sp);
delete from public.products where id in (select id from _sp);
delete from public.warehouse_locations where name like '%[sample]%';
delete from public.warehouses where id in (select id from _sw);
delete from public.customers where notes like '[sample]%';
delete from public.customer_groups where notes like '[sample]%';
delete from public.suppliers where notes like '[sample]%';
delete from public.payment_agent_accounts where payment_agent_id in (select id from public.payment_agents where notes like '[sample]%');
delete from public.payment_agents where notes like '[sample]%';
delete from public.bank_accounts where name like '%[sample]%';
delete from public.chart_of_accounts where description like '[sample]%';
delete from public.employees where notes like '[sample]%';

commit;
-- Reload afterwards with supabase/seed/sample_data.sql
