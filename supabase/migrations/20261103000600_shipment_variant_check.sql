-- =====================================================================
-- JS Traders ERP — shipments ask for the variant up front
--   An item that has variants (e.g. Feed Pan) must have its variant chosen when the shipment is
--   saved, not only when the goods are received. The variant must belong to the item.
--   (save_shipment is patched in place: one check added after "choose the item".)
-- =====================================================================
do $patch$
declare d text; v_anchor text := $x$raise exception 'Line %: choose the item', n using errcode = '23502'; end if;$x$;
begin
  d := pg_get_functiondef('public.save_shipment(uuid, jsonb, jsonb, jsonb, uuid)'::regprocedure);
  if position('has variants — select the variant' in d) > 0 then return; end if;
  if position(v_anchor in d) = 0 then raise exception 'save_shipment changed — patch not applied'; end if;
  d := replace(d, v_anchor, v_anchor || $x$
    if nullif(x->>'variant_id','') is null
       and exists (select 1 from public.product_variants pv where pv.product_id = (x->>'product_id')::uuid and pv.is_active) then
      raise exception 'Line %: "%" has variants — select the variant', n, (select name from public.products where id = (x->>'product_id')::uuid) using errcode = '23502';
    end if;
    if nullif(x->>'variant_id','') is not null
       and not exists (select 1 from public.product_variants pv where pv.id = (x->>'variant_id')::uuid and pv.product_id = (x->>'product_id')::uuid) then
      raise exception 'Line %: that variant belongs to another item', n using errcode = '22023';
    end if;$x$);
  execute d;
end $patch$;
