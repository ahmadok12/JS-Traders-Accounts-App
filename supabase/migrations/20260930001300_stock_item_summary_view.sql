-- One row per product+variant with per-warehouse figures in a JSON map,
-- so the UI can render one column per warehouse (spec §9.2 dynamic warehouse columns).
-- security_invoker: the viewer only sees warehouses they have access to.
create view public.stock_item_summary with (security_invoker = true) as
select
  md5(s.product_id::text || coalesce(s.variant_id::text, ''))::uuid as id,
  s.company_id, s.product_id, s.sku, s.product_name, s.product_alias,
  s.variant_id, s.variant_name, s.variant_sku, s.uom_code, s.reorder_level,
  sum(s.on_hand) as on_hand,
  sum(s.reserved) as reserved,
  sum(s.available) as available,
  bool_or(s.is_negative) as is_negative,
  (max(s.reorder_level) is not null and sum(s.on_hand) <= max(s.reorder_level)) as is_low,
  max(s.last_movement_at) as last_movement_at,
  jsonb_object_agg(s.warehouse_id::text, jsonb_build_object(
    'on_hand', s.on_hand, 'reserved', s.reserved, 'available', s.available, 'row_id', s.id)) as by_warehouse
from public.stock_on_hand s
group by s.company_id, s.product_id, s.sku, s.product_name, s.product_alias,
         s.variant_id, s.variant_name, s.variant_sku, s.uom_code, s.reorder_level;

grant select on public.stock_item_summary to authenticated;
revoke all on public.stock_item_summary from anon;
