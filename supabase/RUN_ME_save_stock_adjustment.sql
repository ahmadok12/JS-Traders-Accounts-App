-- RUN THIS ONCE in Supabase → SQL Editor (project rjdjaujoilcunwtynaze), then click Run.
-- It updates the function that saves stock adjustment drafts so the new
-- "Enter new quantity" mode works. Safe to run more than once.
-- (Everything else from 20261001000300_adjustment_set_quantity.sql is already applied.)

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
