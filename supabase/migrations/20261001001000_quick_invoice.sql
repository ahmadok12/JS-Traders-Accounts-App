-- Stage 5 — Quick invoice (counter sale): one screen, one transaction.
-- Setting 'sales.quick_invoice' (missing = OFF). When ON, Sales Invoices → "Quick invoice":
-- customer + items (warehouse, qty, price) → a sales order (approved), a GDN (posted from the chosen
-- warehouses) and the invoice (posted, optional payment now) are created together. All documents
-- stay linked and can be reversed / corrected the normal way.

alter table public.sales_invoices add column if not exists is_quick boolean not null default false;

create or replace function public.quick_invoice_enabled(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.system_settings s
                    where s.company_id = p_company_id and s.key = 'sales.quick_invoice'), false);
$$;
revoke execute on function public.quick_invoice_enabled(uuid) from public, anon;
grant execute on function public.quick_invoice_enabled(uuid) to authenticated;

-- p_header: {company_id, customer_id, invoice_date, due_date, customer_reference, notes, discount_amount}
-- p_lines:  [{product_id, variant_id, warehouse_id, quantity, unit_price, description}]
-- p_receive: {bank_account_id, amount, reference} or null
create or replace function public.quick_sales_invoice(p_header jsonb, p_lines jsonb, p_receive jsonb default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_date date := coalesce(nullif(p_header->>'invoice_date','')::date, current_date);
  l jsonb; n int := 0; v_so uuid; v_gdn uuid; v_inv uuid; v_so_lines jsonb := '[]'::jsonb; v_gdn_lines jsonb; g record; x jsonb;
  v_lines jsonb := '[]'::jsonb; v_desc text; v_prev uuid;
begin
  perform public.inv_require(v_company, 'sales.invoice');
  if not public.quick_invoice_enabled(v_company) then
    raise exception 'Quick invoice is turned off — switch it on in Settings → Features' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select id into v_prev from public.sales_invoices where idempotency_key = p_idempotency_key;
    if v_prev is not null then return v_prev; end if;
  end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;

  -- one sales order line per item line (its own warehouse and price)
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if nullif(l->>'product_id','') is null then raise exception 'Line %: choose the item', n using errcode = '23502'; end if;
    if nullif(l->>'warehouse_id','') is null then raise exception 'Line %: choose the warehouse it leaves from', n using errcode = '23502'; end if;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then raise exception 'Line %: enter the quantity', n using errcode = '23502'; end if;
    if nullif(l->>'unit_price','') is null then raise exception 'Line %: enter the price', n using errcode = '23502'; end if;
    v_so_lines := v_so_lines || jsonb_build_array(jsonb_build_object('product_id', l->'product_id', 'variant_id', l->'variant_id',
      'unit_price', l->'unit_price', 'notes', nullif(trim(l->>'description'),''),
      'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', l->'warehouse_id', 'quantity', l->'quantity'))));
  end loop;

  v_so := public.save_sales_order(null, jsonb_build_object('company_id', v_company, 'customer_id', p_header->'customer_id', 'order_date', v_date,
    'customer_reference', p_header->'customer_reference', 'notes', 'Quick invoice'), v_so_lines, null);
  perform public.approve_sales_order(v_so);

  select jsonb_agg(jsonb_build_object('allocation_id', al.id, 'quantity', al.quantity) order by sl.line_no) into v_gdn_lines
    from public.sales_order_lines sl join public.sales_order_line_warehouse_allocations al on al.sales_order_line_id = sl.id
   where sl.sales_order_id = v_so and sl.is_active and al.status = 'OPEN';
  v_gdn := public.save_gdn(null, jsonb_build_object('company_id', v_company, 'sales_order_id', v_so, 'gdn_date', v_date, 'notes', 'Quick invoice'), v_gdn_lines, null);
  perform public.post_gdn(v_gdn);

  v_inv := public.create_invoice_from_gdns(v_company, array[v_gdn], v_date);
  -- carry each line's description (from the order line notes)
  for x in select * from jsonb_array_elements((select lines_draft from public.sales_invoices where id = v_inv)) loop
    select string_agg(distinct sl.notes, '; ') into v_desc from public.gdn_lines gl join public.sales_order_lines sl on sl.id = gl.sales_order_line_id
     where gl.id in (select (e->>'gdn_line_id')::uuid from jsonb_array_elements(x->'sources') e);
    v_lines := v_lines || jsonb_build_array(x || jsonb_build_object('description', v_desc));
  end loop;
  update public.sales_invoices set lines_draft = v_lines, is_quick = true, idempotency_key = p_idempotency_key,
    discount_amount = coalesce(nullif(p_header->>'discount_amount','')::numeric, 0),
    due_date = nullif(p_header->>'due_date','')::date, customer_reference = nullif(trim(p_header->>'customer_reference'),''),
    notes = nullif(trim(p_header->>'notes'),'')
  where id = v_inv;
  perform public.inv_recalc_invoice(v_inv);
  perform public.post_sales_invoice(v_inv, p_receive);
  return v_inv;
end $$;
revoke execute on function public.quick_sales_invoice(jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.quick_sales_invoice(jsonb, jsonb, jsonb, uuid) to authenticated;
