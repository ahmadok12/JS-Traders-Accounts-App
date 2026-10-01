-- Fix: outbound stock with no location specified was taken from the
-- "no location" balance only, so stock held in racks (S-A1, S-B1…) looked
-- unavailable. Now an unspecified location draws from the warehouse as a
-- whole: unassigned stock first, then locations with the most stock, splitting
-- the movement across locations. Negative-stock policy is checked at
-- warehouse level. A specified location still issues from that location only.

create or replace function public.inv_issue_stock(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,      -- p_qty > 0 = quantity to take out
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_left numeric := p_qty; b record; v_take numeric; v_total numeric; v_name text;
begin
  if p_qty <= 0 then raise exception 'issue quantity must be positive'; end if;

  if p_location_id is not null then
    perform public.inv_apply_movement(p_company_id, p_date, p_type, p_warehouse_id, p_location_id,
      p_product_id, p_variant_id, -p_qty, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
    perform public.inv_check_reserved(p_warehouse_id, p_product_id, p_variant_id);
    return;
  end if;

  -- lock every balance row of this item in this warehouse, then check the warehouse total
  perform 1 from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
   for update;
  select coalesce(sum(on_hand), 0) into v_total from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  if v_total < p_qty and not public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
    select p.name || coalesce(' / ' || v.name, '') || ' @ ' || w.code into v_name
    from public.products p cross join public.warehouses w left join public.product_variants v on v.id = p_variant_id
    where p.id = p_product_id and w.id = p_warehouse_id;
    raise exception 'Insufficient stock for "%": only % available in this warehouse, % requested',
      v_name, v_total::numeric(18,2), p_qty::numeric(18,2) using errcode = '23514';
  end if;

  for b in select location_id, on_hand from public.stock_balances
           where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
             and on_hand > 0
           order by (location_id is not null), on_hand desc loop
    exit when v_left <= 0;
    v_take := least(v_left, b.on_hand);
    perform public.inv_apply_movement(p_company_id, p_date, p_type, p_warehouse_id, b.location_id,
      p_product_id, p_variant_id, -v_take, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then   -- only reachable when negative stock is allowed
    perform public.inv_apply_movement(p_company_id, p_date, p_type, p_warehouse_id, null,
      p_product_id, p_variant_id, -v_left, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason);
  end if;
  perform public.inv_check_reserved(p_warehouse_id, p_product_id, p_variant_id);
end $$;

create or replace function public.post_stock_document(p_doc_type text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; l record; v_type text; v_count int := 0;
begin
  if p_doc_type = 'GOODS_RECEIPT' then
    select * into h from public.goods_receipts where id = p_id for update;
    if h.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
    perform public.inv_require(h.company_id, 'inventory.receive');
    if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
    if h.status <> 'DRAFT' then raise exception 'Cannot post a % receipt', h.status using errcode = '22023'; end if;
    perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
    for l in select * from public.goods_receipt_lines where receipt_id = p_id order by product_id, variant_id, location_id loop
      perform public.inv_validate_line(h.company_id, h.warehouse_id, l.product_id, l.variant_id, l.location_id, l.quantity, l.line_no);
      perform public.inv_apply_movement(h.company_id, h.doc_date, 'PURCHASE_RECEIPT', h.warehouse_id, l.location_id,
        l.product_id, l.variant_id, l.quantity, 'GOODS_RECEIPT', h.id, l.id, h.doc_no, null);
      v_count := v_count + 1;
    end loop;
    update public.goods_receipts set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;

  elsif p_doc_type = 'STOCK_TRANSFER' then
    select * into h from public.stock_transfers where id = p_id for update;
    if h.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
    perform public.inv_require(h.company_id, 'inventory.transfer');
    if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
    if h.status <> 'DRAFT' then raise exception 'Cannot post a % transfer', h.status using errcode = '22023'; end if;
    perform public.inv_check_warehouse(h.company_id, h.from_warehouse_id);
    perform public.inv_check_warehouse(h.company_id, h.to_warehouse_id);
    for l in select * from public.stock_transfer_lines where transfer_id = p_id order by product_id, variant_id loop
      perform public.inv_issue_stock(h.company_id, h.doc_date, 'TRANSFER_OUT', h.from_warehouse_id, l.from_location_id,
        l.product_id, l.variant_id, l.quantity, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null);
      perform public.inv_apply_movement(h.company_id, h.doc_date, 'TRANSFER_IN', h.to_warehouse_id, l.to_location_id,
        l.product_id, l.variant_id, l.quantity, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null);
      v_count := v_count + 1;
    end loop;
    update public.stock_transfers set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;

  elsif p_doc_type = 'STOCK_ADJUSTMENT' then
    select * into h from public.stock_adjustments where id = p_id for update;
    if h.id is null then raise exception 'Adjustment not found' using errcode = 'P0002'; end if;
    perform public.inv_require(h.company_id, 'inventory.post');
    if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
    if h.status <> 'DRAFT' then raise exception 'Cannot post a % adjustment', h.status using errcode = '22023'; end if;
    perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
    v_type := case h.reason when 'OPENING_BALANCE' then 'OPENING' when 'DAMAGE' then 'DAMAGE' else 'ADJUSTMENT' end;
    for l in select * from public.stock_adjustment_lines where adjustment_id = p_id order by product_id, variant_id, location_id loop
      perform public.inv_validate_line(h.company_id, h.warehouse_id, l.product_id, l.variant_id, l.location_id, l.quantity, l.line_no);
      if l.quantity < 0 then
        perform public.inv_issue_stock(h.company_id, h.doc_date, v_type, h.warehouse_id, l.location_id,
          l.product_id, l.variant_id, -l.quantity, 'STOCK_ADJUSTMENT', h.id, l.id, h.doc_no, h.reason);
      else
        perform public.inv_apply_movement(h.company_id, h.doc_date, v_type, h.warehouse_id, l.location_id,
          l.product_id, l.variant_id, l.quantity, 'STOCK_ADJUSTMENT', h.id, l.id, h.doc_no, h.reason);
      end if;
      v_count := v_count + 1;
    end loop;
    update public.stock_adjustments set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;
  else
    raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end if;

  return jsonb_build_object('status','POSTED','lines', v_count);
end $$;

revoke execute on function public.inv_issue_stock(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text) from public, anon, authenticated;

-- Reserved stock is protected: an outbound issue (transfer, write-off) may not
-- dip the warehouse below what is reserved for customer / sales orders.
create or replace function public.inv_check_reserved(p_warehouse_id uuid, p_product_id uuid, p_variant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_on_hand numeric; v_reserved numeric; v_name text;
begin
  select coalesce(sum(quantity),0) into v_reserved from public.reservations
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
     and status = 'ACTIVE';
  if v_reserved = 0 then return; end if;
  select coalesce(sum(on_hand),0) into v_on_hand from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  if v_on_hand < v_reserved and not public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
    select p.name || coalesce(' / ' || v.name, '') || ' @ ' || w.code into v_name
    from public.products p cross join public.warehouses w left join public.product_variants v on v.id = p_variant_id
    where p.id = p_product_id and w.id = p_warehouse_id;
    raise exception 'Cannot take reserved stock of "%": % is reserved for customer orders, only % would remain. Release or reduce the reservation first.',
      v_name, v_reserved::numeric(18,2), v_on_hand::numeric(18,2) using errcode = '23514';
  end if;
end $$;
revoke execute on function public.inv_check_reserved(uuid, uuid, uuid) from public, anon, authenticated;
