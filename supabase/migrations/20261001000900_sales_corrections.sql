-- Stage 5 — corrections on posted / approved sales documents
--  * revise_sales_order: edit an approved / part-delivered / delivered order (never below what was sent);
--    reservations are re-made for what is still to be sent. One transaction.
--  * correct_gdn: reverse a posted GDN and open a new draft copy to edit.
--  * reverse_sales_invoice_full: reverse an invoice, optionally releasing its payment allocations
--    (the money stays on the customer's account as an advance).
--  * correct_sales_invoice: reverse + new draft from the same GDNs with the same prices; released
--    receipts are remembered (carry_receipts) so they can be re-allocated when the new invoice posts.

alter table public.sales_invoices add column if not exists carry_receipts jsonb not null default '[]'::jsonb;
alter table public.sales_invoices add column if not exists corrects_invoice_id uuid references public.sales_invoices(id);

-- ---------------------------------------------------------------- sales order revision
create or replace function public.revise_sales_order(p_id uuid, p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  h record; x record; al record; l jsonb; a jsonb;
  v_cust uuid; n int := 0; r int; v_line uuid; v_total numeric; v_price numeric; v_wh uuid; v_q numeric;
  v_pid uuid; v_vid uuid; v_need numeric; v_name text; v_ids uuid[];
begin
  select * into h from public.sales_orders where id = p_id for update;
  if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  perform public.inv_require(h.company_id, 'sales.approve');
  if h.status not in ('APPROVED','PARTIALLY_DELIVERED','DELIVERED') then
    raise exception 'Only approved or delivered orders are revised here (this one is %)', lower(h.status) using errcode = '22023';
  end if;
  select doc_no into v_name from public.gdns where sales_order_id = p_id and status = 'DRAFT' limit 1;
  if v_name is not null then raise exception 'GDN % is still a draft for this order — dispatch or cancel it first', v_name using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;

  v_cust := coalesce(nullif(p_header->>'customer_id','')::uuid, h.customer_id);
  if v_cust <> h.customer_id then
    if exists (select 1 from public.gdns where sales_order_id = p_id and status = 'POSTED') then
      raise exception 'The customer cannot be changed after goods were dispatched' using errcode = '22023';
    end if;
    if not exists (select 1 from public.customers where id = v_cust and company_id = h.company_id and is_active) then
      raise exception 'Choose an active customer' using errcode = '23502';
    end if;
    if not public.can_access_customer(v_cust) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;
  end if;
  update public.sales_orders set order_date = coalesce(nullif(p_header->>'order_date','')::date, order_date), customer_id = v_cust,
    customer_reference = nullif(trim(p_header->>'customer_reference'),''), notes = nullif(trim(p_header->>'notes'),'')
  where id = p_id;

  -- everything still held for the order is released and re-made at the end
  update public.reservations set status = 'RELEASED', released_at = now(), released_by = auth.uid(), release_reason = 'Sales order edited'
   where sales_order_id = p_id and status = 'ACTIVE';
  update public.sales_order_line_warehouse_allocations sa set reserved_quantity = 0
    from public.sales_order_lines sl where sl.id = sa.sales_order_line_id and sl.sales_order_id = p_id;
  update public.sales_order_lines set line_no = -abs(line_no) - 100000 where sales_order_id = p_id and is_active;

  -- lines removed from the form
  select coalesce(array_agg(nullif(e->>'id','')::uuid), '{}') into v_ids from jsonb_array_elements(p_lines) e where nullif(e->>'id','') is not null;
  for x in select sl.*, p.name as pname from public.sales_order_lines sl join public.products p on p.id = sl.product_id
           where sl.sales_order_id = p_id and sl.is_active and not (sl.id = any(v_ids)) loop
    if x.delivered_qty > 0 then
      raise exception '"%" was already dispatched — it cannot be removed (reduce it to the quantity sent instead)', x.pname using errcode = '22023';
    end if;
    perform public.so_retire_line(x.id, 'Sales order edited');
  end loop;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_price := nullif(l->>'unit_price','')::numeric;
    if v_price is not null and v_price < 0 then raise exception 'Line %: price cannot be negative', n using errcode = '23514'; end if;
    v_pid := (l->>'product_id')::uuid;
    v_vid := nullif(l->>'variant_id','')::uuid;
    v_line := nullif(l->>'id','')::uuid;
    if v_line is not null then
      select * into x from public.sales_order_lines where id = v_line and sales_order_id = p_id and is_active;
      if x.id is null then raise exception 'Line %: not part of this order', n using errcode = '22023'; end if;
      if x.product_id <> v_pid or x.variant_id is distinct from v_vid then
        if x.delivered_qty > 0 then raise exception 'Line %: the item cannot be changed after it was dispatched', n using errcode = '22023'; end if;
        perform public.so_retire_line(x.id, 'Sales order edited');
        v_line := null;
      end if;
    end if;

    v_total := 0;
    for a in select * from jsonb_array_elements(coalesce(l->'allocations','[]'::jsonb)) loop
      v_q := coalesce(nullif(a->>'quantity','')::numeric, 0);
      if v_q < 0 then raise exception 'Line %: quantities cannot be negative', n using errcode = '23514'; end if;
      if v_q = 0 then continue; end if;
      v_wh := (a->>'warehouse_id')::uuid;
      perform public.inv_check_warehouse(h.company_id, v_wh);
      perform public.inv_validate_line(h.company_id, v_wh, v_pid, v_vid, null, v_q, n);
      v_total := v_total + v_q;
    end loop;
    if v_total <= 0 then raise exception 'Line %: enter a quantity for at least one warehouse', n using errcode = '23502'; end if;

    if v_line is null then
      insert into public.sales_order_lines(company_id, sales_order_id, line_no, product_id, variant_id, quantity, unit_price, notes)
      values (h.company_id, p_id, n, v_pid, v_vid, v_total, v_price, nullif(trim(l->>'notes'),''))
      returning id into v_line;
      for a in select * from jsonb_array_elements(l->'allocations') loop
        if coalesce(nullif(a->>'quantity','')::numeric, 0) <= 0 then continue; end if;
        insert into public.sales_order_line_warehouse_allocations(company_id, sales_order_line_id, warehouse_id, quantity)
        values (h.company_id, v_line, (a->>'warehouse_id')::uuid, (a->>'quantity')::numeric);
      end loop;
    else
      -- existing warehouses of the line
      for al in select al2.*, w.code as wcode from public.sales_order_line_warehouse_allocations al2 join public.warehouses w on w.id = al2.warehouse_id
                where al2.sales_order_line_id = v_line for update of al2 loop
        select coalesce(sum(nullif(e->>'quantity','')::numeric), 0) into v_q from jsonb_array_elements(l->'allocations') e
         where (e->>'warehouse_id')::uuid = al.warehouse_id;
        if v_q < al.delivered_quantity then
          raise exception 'Line %: % already sent from % — the quantity cannot be less than that', n, al.delivered_quantity::numeric(18,2), al.wcode using errcode = '23514';
        end if;
        if v_q = 0 then
          update public.sales_order_line_warehouse_allocations set status = 'CANCELLED' where id = al.id;
        else
          update public.sales_order_line_warehouse_allocations set quantity = v_q, status = 'OPEN' where id = al.id;
        end if;
      end loop;
      -- warehouses added
      for a in select * from jsonb_array_elements(l->'allocations') loop
        v_q := coalesce(nullif(a->>'quantity','')::numeric, 0);
        if v_q <= 0 then continue; end if;
        if not exists (select 1 from public.sales_order_line_warehouse_allocations where sales_order_line_id = v_line and warehouse_id = (a->>'warehouse_id')::uuid) then
          insert into public.sales_order_line_warehouse_allocations(company_id, sales_order_line_id, warehouse_id, quantity)
          values (h.company_id, v_line, (a->>'warehouse_id')::uuid, v_q);
        end if;
      end loop;
      select coalesce(sum(quantity), 0) into v_total from public.sales_order_line_warehouse_allocations where sales_order_line_id = v_line and status <> 'CANCELLED';
      update public.sales_order_lines set line_no = n, unit_price = v_price, notes = nullif(trim(l->>'notes'),''), quantity = v_total where id = v_line;
    end if;
  end loop;

  -- hold stock again for what is still to be sent
  select count(*) into r from public.reservations where sales_order_id = p_id;
  for al in select al2.*, sl.product_id, sl.variant_id, sl.line_no, p.is_bundle
            from public.sales_order_line_warehouse_allocations al2
            join public.sales_order_lines sl on sl.id = al2.sales_order_line_id
            join public.products p on p.id = sl.product_id
            where sl.sales_order_id = p_id and sl.is_active and al2.status = 'OPEN'
            order by sl.line_no, al2.warehouse_id for update of al2 loop
    v_need := al.quantity - al.delivered_quantity;
    if v_need <= 0 or al.is_bundle then continue; end if;
    perform public.inv_reserve_line(h.company_id, al.warehouse_id, al.product_id, al.variant_id, v_need, al.line_no);
    r := r + 1;
    insert into public.reservations(company_id, doc_no, warehouse_id, product_id, variant_id, quantity,
      source_type, source_id, sales_order_id, sales_order_line_id, customer_id)
    values (h.company_id, h.doc_no || '-R' || r, al.warehouse_id, al.product_id, al.variant_id, v_need,
      'SALES_ORDER', p_id, p_id, al.sales_order_line_id, v_cust);
    update public.sales_order_line_warehouse_allocations set reserved_quantity = v_need where id = al.id;
  end loop;
  perform public.so_refresh_status(p_id);
  return p_id;
end $$;
revoke execute on function public.revise_sales_order(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.revise_sales_order(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- GDN correction
create or replace function public.correct_gdn(p_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_lines jsonb; v_new uuid;
begin
  select * into h from public.gdns where id = p_id;
  if h.id is null then raise exception 'GDN not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.dispatch');
  if h.status <> 'POSTED' then raise exception 'Only dispatched GDNs can be corrected — edit drafts directly' using errcode = '22023'; end if;
  select jsonb_agg(jsonb_build_object('allocation_id', allocation_id, 'quantity', q) order by mn) into v_lines
    from (select allocation_id, sum(quantity) as q, min(line_no) as mn from public.gdn_lines where gdn_id = p_id group by allocation_id) s;
  perform public.reverse_gdn(p_id, coalesce(nullif(trim(p_reason),''), 'Corrected'));
  v_new := public.save_gdn(null, jsonb_build_object('company_id', h.company_id, 'sales_order_id', h.sales_order_id, 'gdn_date', h.gdn_date,
    'transport_details', h.transport_details, 'notes', h.notes), v_lines, null);
  return v_new;
end $$;
revoke execute on function public.correct_gdn(uuid, text) from public, anon;
grant execute on function public.correct_gdn(uuid, text) to authenticated;

-- ---------------------------------------------------------------- invoice reversal / correction
create or replace function public.reverse_sales_invoice_full(p_id uuid, p_reason text, p_date date default null, p_release_payments boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; v_rel jsonb;
begin
  select * into h from public.sales_invoices where id = p_id for update;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.invoice');
  select coalesce(jsonb_agg(jsonb_build_object('receipt_entry_id', receipt_entry_id, 'amount', amount) order by created_at), '[]'::jsonb) into v_rel
    from public.receipt_allocations where invoice_id = p_id and status = 'ACTIVE';
  if jsonb_array_length(v_rel) > 0 then
    if not p_release_payments then
      raise exception 'Payments are allocated to this invoice — tick "release payments" to reverse it' using errcode = '22023';
    end if;
    update public.receipt_allocations set status = 'REMOVED', removed_at = now(), removed_by = auth.uid()
     where invoice_id = p_id and status = 'ACTIVE';
  end if;
  perform public.reverse_sales_invoice(p_id, p_reason, p_date);
  return jsonb_build_object('released', v_rel);
end $$;
revoke execute on function public.reverse_sales_invoice_full(uuid, text, date, boolean) from public, anon;
grant execute on function public.reverse_sales_invoice_full(uuid, text, date, boolean) to authenticated;

create or replace function public.correct_sales_invoice(p_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_gdns uuid[]; v_rel jsonb; v_new uuid; v_price jsonb := '{}'::jsonb; l record; s jsonb; x jsonb; v_lines jsonb := '[]'::jsonb; v_p jsonb;
begin
  select * into h from public.sales_invoices where id = p_id;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.invoice');
  if h.status <> 'POSTED' then raise exception 'Only posted invoices can be corrected — edit drafts directly' using errcode = '22023'; end if;
  -- price / description used for each GDN line on the old invoice
  for l in select * from public.sales_invoice_lines where invoice_id = p_id loop
    for s in select * from jsonb_array_elements(l.sources) loop
      v_price := v_price || jsonb_build_object(s->>'gdn_line_id', jsonb_build_object('p', l.unit_price, 'd', l.description));
    end loop;
  end loop;
  select array_agg(distinct gl.gdn_id) into v_gdns from public.gdn_lines gl where gl.id::text in (select jsonb_object_keys(v_price));
  v_rel := public.reverse_sales_invoice_full(p_id, coalesce(nullif(trim(p_reason),''), 'Corrected'), null, true)->'released';
  v_new := public.create_invoice_from_gdns(h.company_id, v_gdns, h.invoice_date);
  -- carry the old prices over
  for x in select * from jsonb_array_elements((select lines_draft from public.sales_invoices where id = v_new)) loop
    v_p := v_price->(x->'sources'->0->>'gdn_line_id');
    v_lines := v_lines || jsonb_build_array(x || jsonb_build_object('unit_price', coalesce(v_p->'p', x->'unit_price'), 'description', v_p->'d'));
  end loop;
  update public.sales_invoices set lines_draft = v_lines, discount_amount = h.discount_amount, due_date = h.due_date,
    customer_reference = h.customer_reference, notes = h.notes, carry_receipts = v_rel, corrects_invoice_id = p_id
  where id = v_new;
  perform public.inv_recalc_invoice(v_new);
  return v_new;
end $$;
revoke execute on function public.correct_sales_invoice(uuid, text) from public, anon;
grant execute on function public.correct_sales_invoice(uuid, text) to authenticated;
