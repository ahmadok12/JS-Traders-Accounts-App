-- fix: table aliases that clashed with PL/pgSQL variables (create_invoice_from_gdns, create_bill_from_receipts)

create or replace function public.create_invoice_from_gdns(p_company_id uuid, p_gdn_ids uuid[], p_invoice_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cust uuid; v_id uuid; g record; v_lines jsonb := '[]'::jsonb; v_n int;
begin
  perform public.inv_require(p_company_id, 'sales.invoice');
  select count(distinct customer_id), min(customer_id::text)::uuid into v_n, v_cust from public.gdns
   where id = any(p_gdn_ids) and company_id = p_company_id and status = 'POSTED';
  if v_n = 0 then raise exception 'Choose at least one posted GDN' using errcode = '23502'; end if;
  if v_n > 1 then raise exception 'All GDNs on one invoice must be for the same customer' using errcode = '22023'; end if;
  for g in select gl.product_id, gl.variant_id, gl.unit_price, sum(gl.quantity - gl.invoiced_qty) as qty,
                  jsonb_agg(jsonb_build_object('gdn_line_id', gl.id, 'qty', gl.quantity - gl.invoiced_qty) order by gl.id) as src,
                  min(p.name) as pname
           from public.gdn_lines gl join public.gdns h on h.id = gl.gdn_id join public.products p on p.id = gl.product_id
           where gl.gdn_id = any(p_gdn_ids) and h.status = 'POSTED' and gl.quantity > gl.invoiced_qty
           group by gl.product_id, gl.variant_id, gl.unit_price
           order by min(p.name) loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', g.product_id, 'variant_id', g.variant_id,
      'quantity', g.qty, 'unit_price', g.unit_price, 'approved_price', g.unit_price, 'description', null, 'sources', g.src));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'These GDNs are already fully invoiced' using errcode = '22023'; end if;
  insert into public.sales_invoices(company_id, doc_no, invoice_date, customer_id, lines_draft)
  values (p_company_id, public.next_document_number(p_company_id, 'SALES_INVOICE'), coalesce(p_invoice_date, current_date), v_cust, v_lines)
  returning id into v_id;
  -- the orders' discount, in proportion to the part of each order billed now
  update public.sales_invoices set discount_amount = coalesce((
    select round(sum(so.discount_amount * part.v / nullif(full_v.v, 0)), 2)
    from (select gd.sales_order_id so_id, sum(round(x.q * gl.unit_price, 2)) v
          from (select (s->>'gdn_line_id')::uuid gl_id, (s->>'qty')::numeric q from jsonb_array_elements(v_lines) e, jsonb_array_elements(e->'sources') s) x
          join public.gdn_lines gl on gl.id = x.gl_id join public.gdns gd on gd.id = gl.gdn_id
          where gl.unit_price is not null group by gd.sales_order_id) part
    join public.sales_orders so on so.id = part.so_id and so.discount_amount > 0
    join lateral (select sum(round(l.quantity * l.unit_price, 2)) v from public.sales_order_lines l where l.sales_order_id = so.id and l.is_active and l.unit_price is not null) full_v on true
  ), 0) where id = v_id;
  perform public.inv_recalc_invoice(v_id);
  return v_id;
end $$;


create or replace function public.create_bill_from_receipts(p_company_id uuid, p_receipt_ids uuid[], p_bill_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_n int; v_sup uuid; v_lines jsonb := '[]'::jsonb; l record; v_cur text; v_fx numeric; v_disc numeric;
begin
  perform public.inv_require(p_company_id, 'purchasing.manage');
  select count(distinct supplier_id), min(supplier_id::text)::uuid into v_n, v_sup from public.goods_receipts
   where id = any(p_receipt_ids) and company_id = p_company_id and status = 'POSTED';
  if v_n = 0 or v_sup is null then raise exception 'Choose posted receipts that have a supplier' using errcode = '23502'; end if;
  if v_n > 1 then raise exception 'All receipts on one bill must be from the same supplier' using errcode = '22023'; end if;
  select coalesce(max(g.cost_currency), max(po.currency), max(s.default_currency), 'PKR'), coalesce(max(g.cost_fx_rate), max(po.fx_rate), 1)
    into v_cur, v_fx
    from public.goods_receipts g join public.suppliers s on s.id = g.supplier_id left join public.purchase_orders po on po.id = g.purchase_order_id
   where g.id = any(p_receipt_ids);
  if v_cur = 'PKR' then v_fx := 1; end if;
  -- price: the approved receipt cost, else the PO price (same currency), else left empty to fill in
  for l in select gl.*, g.doc_no, g.cost_currency,
             (select pl.unit_price from public.goods_receipt_po_links k join public.purchase_order_lines pl on pl.id = k.po_line_id
               join public.purchase_orders po on po.id = pl.purchase_order_id where k.receipt_line_id = gl.id and not k.reversed and po.currency = v_cur limit 1) as po_price
           from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
           where gl.receipt_id = any(p_receipt_ids) and gl.quantity > gl.billed_qty order by g.doc_date, g.doc_no, gl.line_no loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('kind', 'ITEM', 'receipt_line_id', l.id, 'quantity', l.quantity - l.billed_qty,
      'unit_price', case when l.unit_cost is not null and coalesce(l.cost_currency, 'PKR') = v_cur then l.unit_cost else l.po_price end));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'These receipts are already fully billed' using errcode = '22023'; end if;
  -- the purchase orders' discount, in proportion to what is billed now (same currency only)
  select coalesce(round(sum(po.discount_amount * part.v / nullif(full_v.v, 0)), 2), 0) into v_disc
    from (select pl.purchase_order_id po_id, sum(round(k.quantity * pl.unit_price, 2)) v
          from public.goods_receipt_po_links k join public.goods_receipt_lines gl on gl.id = k.receipt_line_id join public.purchase_order_lines pl on pl.id = k.po_line_id
          where gl.receipt_id = any(p_receipt_ids) and not k.reversed and gl.billed_qty = 0 and pl.unit_price is not null group by pl.purchase_order_id) part
    join public.purchase_orders po on po.id = part.po_id and po.discount_amount > 0 and po.currency = v_cur
    join lateral (select sum(round(pol.quantity * pol.unit_price, 2)) v from public.purchase_order_lines pol where pol.purchase_order_id = po.id and pol.is_active and pol.unit_price is not null) full_v on true;
  return public.save_supplier_bill(null, jsonb_build_object('company_id', p_company_id, 'supplier_id', v_sup, 'bill_date', coalesce(p_bill_date, current_date),
    'currency', v_cur, 'fx_rate', v_fx, 'discount_amount', v_disc), v_lines, null);
end $$;

