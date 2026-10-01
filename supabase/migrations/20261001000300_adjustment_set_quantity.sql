-- =====================================================================
-- JS Traders ERP — Stock adjustments: two ways to enter quantities
-- ---------------------------------------------------------------------
-- entry_mode = 'SET'    (default in the app): user enters the quantity now
--                       physically in stock; the system calculates the
--                       increase / decrease. Recalculated from live stock at
--                       posting, so sales/transfers in between are respected.
-- entry_mode = 'CHANGE' : user enters the increase (+) or decrease (−).
-- Lines keep target_qty (new quantity) and system_qty (stock before) for audit.
-- =====================================================================

alter table public.stock_adjustments
  add column entry_mode text not null default 'CHANGE' check (entry_mode in ('SET','CHANGE'));

alter table public.stock_adjustment_lines
  add column target_qty numeric(18,4) check (target_qty is null or target_qty >= 0),
  add column system_qty numeric(18,4);
alter table public.stock_adjustment_lines drop constraint stock_adjustment_lines_quantity_check;
alter table public.stock_adjustment_lines
  add constraint stock_adjustment_lines_quantity_check check (quantity <> 0 or target_qty is not null);

-- On hand for one item: a specific location, or the whole warehouse when no location
create or replace function public.inv_item_on_hand(p_warehouse_id uuid, p_location_id uuid, p_product_id uuid, p_variant_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(b.on_hand), 0) from public.stock_balances b
   where b.warehouse_id = p_warehouse_id and b.product_id = p_product_id
     and b.variant_id is not distinct from p_variant_id
     and (p_location_id is null or b.location_id = p_location_id);
$$;
revoke execute on function public.inv_item_on_hand(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.inv_item_on_hand(uuid, uuid, uuid, uuid) to authenticated;

-- Recalculate "set new quantity" lines against live stock (called inside posting)
create or replace function public.inv_refresh_set_lines(p_adjustment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; l record; v_cur numeric;
begin
  select * into h from public.stock_adjustments where id = p_adjustment_id;
  for l in select * from public.stock_adjustment_lines
           where adjustment_id = p_adjustment_id and target_qty is not null
           order by product_id, variant_id, location_id loop
    perform 1 from public.stock_balances
     where warehouse_id = h.warehouse_id and product_id = l.product_id and variant_id is not distinct from l.variant_id
     for update;
    v_cur := public.inv_item_on_hand(h.warehouse_id, l.location_id, l.product_id, l.variant_id);
    if h.reason = 'OPENING_BALANCE' and l.target_qty < v_cur then
      raise exception 'Line %: opening stock can only add stock — % already in stock. Use reason "Count correction" to reduce it.',
        l.line_no, v_cur::numeric(18,2) using errcode = '23514';
    end if;
    update public.stock_adjustment_lines set system_qty = v_cur, quantity = l.target_qty - v_cur where id = l.id;
  end loop;
end $$;
revoke execute on function public.inv_refresh_set_lines(uuid) from public, anon, authenticated;

create or replace function public.save_stock_adjustment(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_wh uuid := (p_header->>'warehouse_id')::uuid;
  v_reason text := coalesce(nullif(p_header->>'reason',''), 'WAREHOUSE_CORRECTION');
  v_mode text := case when p_header->>'entry_mode' = 'SET' then 'SET' else 'CHANGE' end;
  v_id uuid; v_status text; l jsonb; n int := 0;
  v_target numeric; v_cur numeric; v_qty numeric; v_loc uuid; v_seen text[] := '{}'; v_keyx text;
begin
  perform public.inv_require(v_company, 'inventory.adjust');
  perform public.inv_check_warehouse(v_company, v_wh);
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.stock_adjustments where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.stock_adjustments(company_id, doc_no, doc_date, warehouse_id, reason, reference, notes, idempotency_key, entry_mode)
    values (v_company, public.next_document_number(v_company, 'STOCK_ADJUSTMENT'),
            coalesce((p_header->>'doc_date')::date, current_date), v_wh, v_reason,
            p_header->>'reference', p_header->>'notes', p_idempotency_key, v_mode)
    returning id into v_id;
  else
    select status into v_status from public.stock_adjustments where id = p_id and company_id = v_company for update;
    if v_status is null then raise exception 'Adjustment not found' using errcode = 'P0002'; end if;
    if v_status <> 'DRAFT' then raise exception 'Only draft adjustments can be edited (this one is %)', v_status using errcode = '22023'; end if;
    update public.stock_adjustments set doc_date = coalesce((p_header->>'doc_date')::date, doc_date),
      warehouse_id = v_wh, reason = v_reason, reference = p_header->>'reference', notes = p_header->>'notes', entry_mode = v_mode
    where id = p_id;
    delete from public.stock_adjustment_lines where adjustment_id = p_id;
    v_id := p_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    n := n + 1;
    v_loc := nullif(l->>'location_id','')::uuid;
    if v_mode = 'SET' then
      v_target := nullif(l->>'target_qty','')::numeric;
      if v_target is null or v_target < 0 then
        raise exception 'Line %: enter the new quantity in stock (0 or more)', n using errcode = '23502';
      end if;
      v_keyx := (l->>'product_id') || '|' || coalesce(l->>'variant_id','') || '|' || coalesce(v_loc::text,'');
      if v_keyx = any(v_seen) then
        raise exception 'Line %: this item is already listed. Enter its new quantity once', n using errcode = '23505';
      end if;
      v_seen := v_seen || v_keyx;
      perform public.inv_validate_line(v_company, v_wh, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
        v_loc, case when v_target = 0 then 1 else v_target end, n);
      v_cur := public.inv_item_on_hand(v_wh, v_loc, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid);
      v_qty := v_target - v_cur;
      if v_reason = 'OPENING_BALANCE' and v_qty < 0 then
        raise exception 'Line %: opening stock can only add stock (% already in stock). Use reason Count correction to reduce it.',
          n, v_cur::numeric(18,2) using errcode = '23514';
      end if;
    else
      v_target := null; v_cur := null;
      v_qty := (l->>'quantity')::numeric;
      perform public.inv_validate_line(v_company, v_wh, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
        v_loc, v_qty, n);
      if v_reason = 'OPENING_BALANCE' and v_qty < 0 then
        raise exception 'Line %: opening stock must be positive', n using errcode = '23514';
      end if;
    end if;
    insert into public.stock_adjustment_lines(company_id, adjustment_id, line_no, product_id, variant_id, location_id,
                                              quantity, target_qty, system_qty, notes)
    values (v_company, v_id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
            v_loc, v_qty, v_target, v_cur, l->>'notes');
  end loop;
  if n = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;
  return v_id;
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
    if h.entry_mode = 'SET' then perform public.inv_refresh_set_lines(p_id); end if;
    for l in select * from public.stock_adjustment_lines where adjustment_id = p_id and quantity <> 0 order by product_id, variant_id, location_id loop
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
