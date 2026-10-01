-- =====================================================================
-- JS Traders ERP — Stage 3: Inventory posting engine
-- Every mutation: validate → authorize → scope → lock/revalidate →
-- atomic write (movement + balance) → audit (triggers) → canonical result.
-- =====================================================================

-- ---------------------------------------------------------------- helpers
create or replace function public.inv_require(p_company_id uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_company_id is null or not public.has_permission(p_company_id, p_permission) then
    raise exception 'You do not have permission (%) for this action', p_permission using errcode = '42501';
  end if;
end $$;

create or replace function public.inv_check_warehouse(p_company_id uuid, p_warehouse_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare w record;
begin
  select id, company_id, is_active, name into w from public.warehouses where id = p_warehouse_id;
  if w.id is null or w.company_id <> p_company_id then
    raise exception 'Warehouse not found' using errcode = 'P0002';
  end if;
  if not w.is_active then
    raise exception 'Warehouse % is inactive', w.name using errcode = '22023';
  end if;
  if not public.can_access_warehouse(p_warehouse_id) then
    raise exception 'You do not have access to warehouse %', w.name using errcode = '42501';
  end if;
end $$;

-- Validates a stock line's identity (§8.2): variant mandatory when the product has variants.
create or replace function public.inv_validate_line(
  p_company_id uuid, p_warehouse_id uuid, p_product_id uuid, p_variant_id uuid,
  p_location_id uuid, p_quantity numeric, p_line_no int)
returns void language plpgsql stable security definer set search_path = '' as $$
declare p record; v_allow_dec boolean;
begin
  select pr.id, pr.company_id, pr.name, pr.has_variants, pr.is_active, u.allow_decimal
    into p
  from public.products pr join public.units_of_measure u on u.id = pr.base_uom_id
  where pr.id = p_product_id;
  if p.id is null or p.company_id <> p_company_id then
    raise exception 'Line %: product not found', p_line_no using errcode = 'P0002';
  end if;
  if not p.is_active then
    raise exception 'Line %: product "%" is inactive', p_line_no, p.name using errcode = '22023';
  end if;
  if p.has_variants and p_variant_id is null then
    raise exception 'Line %: "%" has variants — select the variant', p_line_no, p.name using errcode = '23502';
  end if;
  if not p.has_variants and p_variant_id is not null then
    raise exception 'Line %: "%" does not use variants', p_line_no, p.name using errcode = '22023';
  end if;
  if p_variant_id is not null and not exists (
      select 1 from public.product_variants v where v.id = p_variant_id and v.product_id = p_product_id and v.is_active) then
    raise exception 'Line %: variant does not belong to "%" or is inactive', p_line_no, p.name using errcode = '22023';
  end if;
  if p_location_id is not null and not exists (
      select 1 from public.warehouse_locations l where l.id = p_location_id and l.warehouse_id = p_warehouse_id and l.is_active) then
    raise exception 'Line %: location does not belong to the selected warehouse', p_line_no using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Line %: quantity is required', p_line_no using errcode = '23502';
  end if;
  v_allow_dec := p.allow_decimal;
  if not v_allow_dec and p_quantity <> trunc(p_quantity) then
    raise exception 'Line %: "%" is counted in whole units', p_line_no, p.name using errcode = '22023';
  end if;
end $$;

create or replace function public.inv_negative_allowed(p_warehouse_id uuid, p_product_id uuid, p_variant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select allow_negative_stock from public.warehouses where id = p_warehouse_id), false)
      or coalesce((select v.allow_negative_stock from public.product_variants v where v.id = p_variant_id),
                  (select allow_negative_stock from public.products where id = p_product_id), false);
$$;

-- The ONLY place stock changes. Inserts the movement and updates the balance
-- row under a row lock; enforces the negative-stock policy.
create or replace function public.inv_apply_movement(
  p_company_id uuid, p_date date, p_type text, p_warehouse_id uuid, p_location_id uuid,
  p_product_id uuid, p_variant_id uuid, p_qty numeric,
  p_source_type text, p_source_id uuid, p_source_line_id uuid, p_doc_no text,
  p_reason text, p_reversal_of uuid default null)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_after numeric; v_name text;
begin
  insert into public.stock_movements(company_id, movement_date, movement_type, warehouse_id, location_id,
    product_id, variant_id, quantity, source_type, source_id, source_line_id, source_doc_no, reason,
    reversal_of, created_by)
  values (p_company_id, coalesce(p_date, current_date), p_type, p_warehouse_id, p_location_id,
    p_product_id, p_variant_id, p_qty, p_source_type, p_source_id, p_source_line_id, p_doc_no, p_reason,
    p_reversal_of, auth.uid());

  insert into public.stock_balances as b (company_id, warehouse_id, location_id, product_id, variant_id, on_hand, last_movement_at)
  values (p_company_id, p_warehouse_id, p_location_id, p_product_id, p_variant_id, p_qty, now())
  on conflict on constraint stock_balances_identity
  do update set on_hand = b.on_hand + excluded.on_hand, last_movement_at = now(), updated_at = now()
  returning on_hand into v_after;

  if p_qty < 0 and v_after < 0 and not public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
    select p.name || coalesce(' / ' || v.name, '') into v_name
    from public.products p left join public.product_variants v on v.id = p_variant_id
    where p.id = p_product_id;
    raise exception 'Insufficient stock for "%": only % available here (negative stock is not allowed)',
      v_name, (v_after - p_qty)::numeric(18,4) using errcode = '23514';
  end if;
  return v_after;
end $$;

-- ---------------------------------------------------------------- save drafts
create or replace function public.save_goods_receipt(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_wh uuid := (p_header->>'warehouse_id')::uuid;
  v_id uuid; v_status text; l jsonb; n int := 0;
begin
  perform public.inv_require(v_company, 'inventory.receive');
  perform public.inv_check_warehouse(v_company, v_wh);
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.goods_receipts where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.goods_receipts(company_id, doc_no, doc_date, warehouse_id, supplier_id, supplier_reference, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'GOODS_RECEIPT'),
            coalesce((p_header->>'doc_date')::date, current_date), v_wh,
            nullif(p_header->>'supplier_id','')::uuid, p_header->>'supplier_reference', p_header->>'notes', p_idempotency_key)
    returning id into v_id;
  else
    select status into v_status from public.goods_receipts where id = p_id and company_id = v_company for update;
    if v_status is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
    if v_status <> 'DRAFT' then raise exception 'Only draft receipts can be edited (this one is %)', v_status using errcode = '22023'; end if;
    update public.goods_receipts set doc_date = coalesce((p_header->>'doc_date')::date, doc_date), warehouse_id = v_wh,
      supplier_id = nullif(p_header->>'supplier_id','')::uuid, supplier_reference = p_header->>'supplier_reference',
      notes = p_header->>'notes'
    where id = p_id;
    delete from public.goods_receipt_lines where receipt_id = p_id;
    v_id := p_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    n := n + 1;
    perform public.inv_validate_line(v_company, v_wh, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
      nullif(l->>'location_id','')::uuid, (l->>'quantity')::numeric, n);
    if (l->>'quantity')::numeric < 0 then raise exception 'Line %: quantity must be positive', n using errcode = '23514'; end if;
    insert into public.goods_receipt_lines(company_id, receipt_id, line_no, product_id, variant_id, location_id, quantity, notes)
    values (v_company, v_id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
            nullif(l->>'location_id','')::uuid, (l->>'quantity')::numeric, l->>'notes');
  end loop;
  if n = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;
  return v_id;
end $$;

create or replace function public.save_stock_transfer(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_from uuid := (p_header->>'from_warehouse_id')::uuid;
  v_to uuid := (p_header->>'to_warehouse_id')::uuid;
  v_id uuid; v_status text; l jsonb; n int := 0; v_fl uuid; v_tl uuid;
begin
  perform public.inv_require(v_company, 'inventory.transfer');
  perform public.inv_check_warehouse(v_company, v_from);
  perform public.inv_check_warehouse(v_company, v_to);
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.stock_transfers where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.stock_transfers(company_id, doc_no, doc_date, from_warehouse_id, to_warehouse_id, reference, transport_details, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'STOCK_TRANSFER'),
            coalesce((p_header->>'doc_date')::date, current_date), v_from, v_to,
            p_header->>'reference', p_header->>'transport_details', p_header->>'notes', p_idempotency_key)
    returning id into v_id;
  else
    select status into v_status from public.stock_transfers where id = p_id and company_id = v_company for update;
    if v_status is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
    if v_status <> 'DRAFT' then raise exception 'Only draft transfers can be edited (this one is %)', v_status using errcode = '22023'; end if;
    update public.stock_transfers set doc_date = coalesce((p_header->>'doc_date')::date, doc_date),
      from_warehouse_id = v_from, to_warehouse_id = v_to, reference = p_header->>'reference',
      transport_details = p_header->>'transport_details', notes = p_header->>'notes'
    where id = p_id;
    delete from public.stock_transfer_lines where transfer_id = p_id;
    v_id := p_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    n := n + 1;
    v_fl := nullif(l->>'from_location_id','')::uuid;
    v_tl := nullif(l->>'to_location_id','')::uuid;
    perform public.inv_validate_line(v_company, v_from, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, v_fl, (l->>'quantity')::numeric, n);
    perform public.inv_validate_line(v_company, v_to, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, v_tl, (l->>'quantity')::numeric, n);
    if (l->>'quantity')::numeric < 0 then raise exception 'Line %: quantity must be positive', n using errcode = '23514'; end if;
    if v_from = v_to and v_fl is not distinct from v_tl then
      raise exception 'Line %: source and destination are the same', n using errcode = '22023';
    end if;
    insert into public.stock_transfer_lines(company_id, transfer_id, line_no, product_id, variant_id, from_location_id, to_location_id, quantity, notes)
    values (v_company, v_id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, v_fl, v_tl, (l->>'quantity')::numeric, l->>'notes');
  end loop;
  if n = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;
  return v_id;
end $$;

create or replace function public.save_stock_adjustment(p_id uuid, p_header jsonb, p_lines jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_wh uuid := (p_header->>'warehouse_id')::uuid;
  v_reason text := coalesce(nullif(p_header->>'reason',''), 'WAREHOUSE_CORRECTION');
  v_id uuid; v_status text; l jsonb; n int := 0;
begin
  perform public.inv_require(v_company, 'inventory.adjust');
  perform public.inv_check_warehouse(v_company, v_wh);
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.stock_adjustments where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.stock_adjustments(company_id, doc_no, doc_date, warehouse_id, reason, reference, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'STOCK_ADJUSTMENT'),
            coalesce((p_header->>'doc_date')::date, current_date), v_wh, v_reason,
            p_header->>'reference', p_header->>'notes', p_idempotency_key)
    returning id into v_id;
  else
    select status into v_status from public.stock_adjustments where id = p_id and company_id = v_company for update;
    if v_status is null then raise exception 'Adjustment not found' using errcode = 'P0002'; end if;
    if v_status <> 'DRAFT' then raise exception 'Only draft adjustments can be edited (this one is %)', v_status using errcode = '22023'; end if;
    update public.stock_adjustments set doc_date = coalesce((p_header->>'doc_date')::date, doc_date),
      warehouse_id = v_wh, reason = v_reason, reference = p_header->>'reference', notes = p_header->>'notes'
    where id = p_id;
    delete from public.stock_adjustment_lines where adjustment_id = p_id;
    v_id := p_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    n := n + 1;
    perform public.inv_validate_line(v_company, v_wh, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
      nullif(l->>'location_id','')::uuid, (l->>'quantity')::numeric, n);
    if v_reason = 'OPENING_BALANCE' and (l->>'quantity')::numeric < 0 then
      raise exception 'Line %: opening stock must be positive', n using errcode = '23514';
    end if;
    insert into public.stock_adjustment_lines(company_id, adjustment_id, line_no, product_id, variant_id, location_id, quantity, notes)
    values (v_company, v_id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
            nullif(l->>'location_id','')::uuid, (l->>'quantity')::numeric, l->>'notes');
  end loop;
  if n = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- post / cancel / reverse
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
      perform public.inv_apply_movement(h.company_id, h.doc_date, 'TRANSFER_OUT', h.from_warehouse_id, l.from_location_id,
        l.product_id, l.variant_id, -l.quantity, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null);
      perform public.inv_apply_movement(h.company_id, h.doc_date, 'TRANSFER_IN', h.to_warehouse_id, l.to_location_id,
        l.product_id, l.variant_id, l.quantity, 'STOCK_TRANSFER', h.id, l.id, h.doc_no, null);
      v_count := v_count + 1;
    end loop;
    update public.stock_transfers set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;

  elsif p_doc_type = 'STOCK_ADJUSTMENT' then
    select * into h from public.stock_adjustments where id = p_id for update;
    if h.id is null then raise exception 'Adjustment not found' using errcode = 'P0002'; end if;
    perform public.inv_require(h.company_id, 'inventory.post');   -- approval authority
    if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
    if h.status <> 'DRAFT' then raise exception 'Cannot post a % adjustment', h.status using errcode = '22023'; end if;
    perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
    v_type := case h.reason when 'OPENING_BALANCE' then 'OPENING' when 'DAMAGE' then 'DAMAGE' else 'ADJUSTMENT' end;
    for l in select * from public.stock_adjustment_lines where adjustment_id = p_id order by product_id, variant_id, location_id loop
      perform public.inv_validate_line(h.company_id, h.warehouse_id, l.product_id, l.variant_id, l.location_id, l.quantity, l.line_no);
      perform public.inv_apply_movement(h.company_id, h.doc_date, v_type, h.warehouse_id, l.location_id,
        l.product_id, l.variant_id, l.quantity, 'STOCK_ADJUSTMENT', h.id, l.id, h.doc_no, h.reason);
      v_count := v_count + 1;
    end loop;
    update public.stock_adjustments set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;
  else
    raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end if;

  return jsonb_build_object('status','POSTED','lines', v_count);
end $$;

create or replace function public.cancel_stock_document(p_doc_type text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_status text; v_perm text; v_table text;
begin
  case p_doc_type
    when 'GOODS_RECEIPT' then v_table := 'goods_receipts'; v_perm := 'inventory.receive';
    when 'STOCK_TRANSFER' then v_table := 'stock_transfers'; v_perm := 'inventory.transfer';
    when 'STOCK_ADJUSTMENT' then v_table := 'stock_adjustments'; v_perm := 'inventory.adjust';
    else raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end case;
  execute format('select company_id, status from public.%I where id = $1 for update', v_table)
    into v_company, v_status using p_id;
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform public.inv_require(v_company, v_perm);
  if v_status <> 'DRAFT' then
    raise exception 'Only drafts can be cancelled. Posted documents must be reversed.' using errcode = '22023';
  end if;
  execute format('update public.%I set status = ''CANCELLED'' where id = $1', v_table) using p_id;
end $$;

-- Reversal: posts equal-and-opposite movements linked to the originals.
create or replace function public.reverse_stock_document(p_doc_type text, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_status text; v_table text; v_doc text; m record; v_count int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reverse a posted document' using errcode = '23502';
  end if;
  case p_doc_type
    when 'GOODS_RECEIPT' then v_table := 'goods_receipts';
    when 'STOCK_TRANSFER' then v_table := 'stock_transfers';
    when 'STOCK_ADJUSTMENT' then v_table := 'stock_adjustments';
    else raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end case;
  execute format('select company_id, status, doc_no from public.%I where id = $1 for update', v_table)
    into v_company, v_status, v_doc using p_id;
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform public.inv_require(v_company, 'inventory.post');
  if v_status = 'REVERSED' then return jsonb_build_object('status','REVERSED','already',true); end if;
  if v_status <> 'POSTED' then raise exception 'Only posted documents can be reversed' using errcode = '22023'; end if;

  -- inbound legs first so a transfer reversal never dips the source negative
  for m in select * from public.stock_movements
           where source_type = p_doc_type and source_id = p_id and reversal_of is null
           order by (quantity < 0), product_id, variant_id loop
    perform public.inv_apply_movement(m.company_id, current_date, m.movement_type, m.warehouse_id, m.location_id,
      m.product_id, m.variant_id, -m.quantity, p_doc_type, p_id, m.source_line_id, v_doc,
      'REVERSAL: ' || p_reason, m.id);
    v_count := v_count + 1;
  end loop;

  execute format('update public.%I set status = ''REVERSED'', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = $2 where id = $1', v_table)
    using p_id, p_reason;
  return jsonb_build_object('status','REVERSED','movements', v_count);
end $$;

-- ---------------------------------------------------------------- progressive counts
create or replace function public.create_stock_count(p_company_id uuid, p_warehouse_id uuid, p_count_type text,
  p_notes text, p_load_stocked_items boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.inv_require(p_company_id, 'inventory.count');
  perform public.inv_check_warehouse(p_company_id, p_warehouse_id);
  insert into public.stock_counts(company_id, doc_no, warehouse_id, count_type, notes)
  values (p_company_id, public.next_document_number(p_company_id, 'STOCK_COUNT'), p_warehouse_id,
          coalesce(nullif(p_count_type,''), 'INITIAL_COUNT'), p_notes)
  returning id into v_id;
  if p_load_stocked_items then
    insert into public.stock_count_lines(company_id, count_id, product_id, variant_id, location_id)
    select p_company_id, v_id, b.product_id, b.variant_id, b.location_id
    from public.stock_balances b join public.products p on p.id = b.product_id and p.is_active
    where b.warehouse_id = p_warehouse_id and b.on_hand <> 0
    on conflict do nothing;
  end if;
  return v_id;
end $$;

-- Upsert count lines. counted_qty null = not yet counted. {"remove":true} deletes an unposted line.
create or replace function public.save_stock_count_lines(p_count_id uuid, p_lines jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare h record; l jsonb; v_line record; n int := 0; v_qty numeric;
begin
  select * into h from public.stock_counts where id = p_count_id for update;
  if h.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.count');
  perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
  if h.status <> 'OPEN' then raise exception 'This count is %', h.status using errcode = '22023'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    n := n + 1;
    v_qty := nullif(l->>'counted_qty','')::numeric;
    if nullif(l->>'id','') is not null then
      select * into v_line from public.stock_count_lines where id = (l->>'id')::uuid and count_id = p_count_id;
      if v_line.id is null then raise exception 'Count line not found' using errcode = 'P0002'; end if;
      if v_line.status = 'POSTED' then continue; end if;   -- posted lines are frozen
      if coalesce((l->>'remove')::boolean, false) then
        delete from public.stock_count_lines where id = v_line.id;
        continue;
      end if;
      if v_qty is not null then
        perform public.inv_validate_line(h.company_id, h.warehouse_id, v_line.product_id, v_line.variant_id, v_line.location_id,
          case when v_qty = 0 then 1 else v_qty end, n);
      end if;
      update public.stock_count_lines set counted_qty = v_qty,
        status = case when v_qty is null then 'PENDING' else 'COUNTED' end,
        counted_by = case when v_qty is null then null else auth.uid() end,
        counted_at = case when v_qty is null then null else now() end,
        variance_note = l->>'variance_note'
      where id = v_line.id;
    else
      perform public.inv_validate_line(h.company_id, h.warehouse_id, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
        nullif(l->>'location_id','')::uuid, case when coalesce(v_qty,0) = 0 then 1 else v_qty end, n);
      insert into public.stock_count_lines(company_id, count_id, product_id, variant_id, location_id, counted_qty, status,
        counted_by, counted_at, variance_note)
      values (h.company_id, p_count_id, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, nullif(l->>'location_id','')::uuid,
        v_qty, case when v_qty is null then 'PENDING' else 'COUNTED' end,
        case when v_qty is null then null else auth.uid() end, case when v_qty is null then null else now() end, l->>'variance_note')
      on conflict on constraint stock_count_lines_identity do nothing;
    end if;
  end loop;
  return n;
end $$;

-- Approve & post counted lines: adjustment = counted − current system qty (captured under lock).
create or replace function public.post_stock_count(p_count_id uuid, p_line_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; l record; v_before numeric; v_adj numeric; v_posted int := 0; v_changed int := 0;
begin
  select * into h from public.stock_counts where id = p_count_id for update;
  if h.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.post');
  perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
  if h.status <> 'OPEN' then raise exception 'This count is %', h.status using errcode = '22023'; end if;

  for l in select * from public.stock_count_lines
           where count_id = p_count_id and status = 'COUNTED'
             and (p_line_ids is null or id = any(p_line_ids))
           order by product_id, variant_id, location_id
           for update loop
    select on_hand into v_before from public.stock_balances
     where warehouse_id = h.warehouse_id and location_id is not distinct from l.location_id
       and product_id = l.product_id and variant_id is not distinct from l.variant_id
     for update;
    v_before := coalesce(v_before, 0);
    v_adj := l.counted_qty - v_before;
    if v_adj <> 0 then
      perform public.inv_apply_movement(h.company_id, current_date, 'ADJUSTMENT', h.warehouse_id, l.location_id,
        l.product_id, l.variant_id, v_adj, 'STOCK_COUNT', h.id, l.id, h.doc_no, h.count_type);
      v_changed := v_changed + 1;
    end if;
    update public.stock_count_lines set status = 'POSTED', system_qty_before = v_before, adjustment_qty = v_adj,
      system_qty_after = l.counted_qty, posted_by = auth.uid(), posted_at = now()
    where id = l.id;
    v_posted := v_posted + 1;
  end loop;
  return jsonb_build_object('posted_lines', v_posted, 'adjusted_lines', v_changed);
end $$;

create or replace function public.close_stock_count(p_count_id uuid, p_cancel boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.stock_counts where id = p_count_id for update;
  if h.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.post');
  if h.status <> 'OPEN' then raise exception 'This count is already %', h.status using errcode = '22023'; end if;
  if p_cancel and exists (select 1 from public.stock_count_lines where count_id = p_count_id and status = 'POSTED') then
    raise exception 'Cannot cancel: some lines are already posted. Close the count instead.' using errcode = '22023';
  end if;
  update public.stock_counts set status = case when p_cancel then 'CANCELLED' else 'CLOSED' end,
    closed_at = now(), closed_by = auth.uid()
  where id = p_count_id;
end $$;

-- ---------------------------------------------------------------- reservations
create or replace function public.create_reservation(p_company_id uuid, p_warehouse_id uuid, p_product_id uuid,
  p_variant_id uuid, p_quantity numeric, p_customer_id uuid default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_on_hand numeric; v_reserved numeric; v_id uuid;
begin
  perform public.inv_require(p_company_id, 'inventory.reserve');
  perform public.inv_check_warehouse(p_company_id, p_warehouse_id);
  perform public.inv_validate_line(p_company_id, p_warehouse_id, p_product_id, p_variant_id, null, p_quantity, 1);
  if p_quantity <= 0 then raise exception 'Quantity must be positive' using errcode = '23514'; end if;

  -- lock the item's balance rows so concurrent reservations can't over-allocate
  perform 1 from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
   for update;
  select coalesce(sum(on_hand),0) into v_on_hand from public.stock_balances
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  select coalesce(sum(quantity),0) into v_reserved from public.reservations
   where warehouse_id = p_warehouse_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
     and status = 'ACTIVE';
  if p_quantity > v_on_hand - v_reserved and not public.inv_negative_allowed(p_warehouse_id, p_product_id, p_variant_id) then
    raise exception 'Only % available to reserve (on hand %, already reserved %)',
      (v_on_hand - v_reserved), v_on_hand, v_reserved using errcode = '23514';
  end if;

  insert into public.reservations(company_id, doc_no, warehouse_id, product_id, variant_id, quantity, customer_id, notes)
  values (p_company_id, public.next_document_number(p_company_id, 'RESERVATION'), p_warehouse_id, p_product_id,
          p_variant_id, p_quantity, p_customer_id, p_notes)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.release_reservation(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.reservations where id = p_id for update;
  if h.id is null then raise exception 'Reservation not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.reserve');
  if h.status <> 'ACTIVE' then raise exception 'Reservation is already %', h.status using errcode = '22023'; end if;
  update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = p_reason
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- reconciliation
-- Balances must always equal the sum of movements (spec Gate A #10).
create or replace function public.stock_balance_drift(p_company_id uuid)
returns table (warehouse_id uuid, location_id uuid, product_id uuid, variant_id uuid, balance numeric, ledger numeric)
language sql stable security definer set search_path = '' as $$
  with l as (
    select m.warehouse_id, m.location_id, m.product_id, m.variant_id, sum(m.quantity) as q
    from public.stock_movements m where m.company_id = p_company_id
    group by 1,2,3,4
  )
  select coalesce(b.warehouse_id, l.warehouse_id), coalesce(b.location_id, l.location_id),
         coalesce(b.product_id, l.product_id), coalesce(b.variant_id, l.variant_id),
         coalesce(b.on_hand, 0), coalesce(l.q, 0)
  from (select * from public.stock_balances where company_id = p_company_id) b
  full join l on l.warehouse_id = b.warehouse_id and l.location_id is not distinct from b.location_id
             and l.product_id = b.product_id and l.variant_id is not distinct from b.variant_id
  where coalesce(b.on_hand, 0) <> coalesce(l.q, 0)
    and public.has_permission(p_company_id, 'inventory.view');
$$;

-- ---------------------------------------------------------------- privileges
revoke execute on all functions in schema public from public, anon;
revoke execute on function
  public.inv_require(uuid, text), public.inv_check_warehouse(uuid, uuid),
  public.inv_validate_line(uuid, uuid, uuid, uuid, uuid, numeric, int),
  public.inv_negative_allowed(uuid, uuid, uuid),
  public.inv_apply_movement(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, uuid),
  public.tg_immutable()
from authenticated;
grant execute on function
  public.save_goods_receipt(uuid, jsonb, jsonb, uuid),
  public.save_stock_transfer(uuid, jsonb, jsonb, uuid),
  public.save_stock_adjustment(uuid, jsonb, jsonb, uuid),
  public.post_stock_document(text, uuid),
  public.cancel_stock_document(text, uuid),
  public.reverse_stock_document(text, uuid, text),
  public.create_stock_count(uuid, uuid, text, text, boolean),
  public.save_stock_count_lines(uuid, jsonb),
  public.post_stock_count(uuid, uuid[]),
  public.close_stock_count(uuid, boolean),
  public.create_reservation(uuid, uuid, uuid, uuid, numeric, uuid, text),
  public.release_reservation(uuid, text),
  public.stock_balance_drift(uuid)
to authenticated;
