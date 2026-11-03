-- =====================================================================
-- JS Traders ERP — simple purchase flows
--   Local:  PO → GRN → Supplier bill (→ landed cost)
--   Import: Shipment (acts as the PO) → GRN → Supplier bill → Landed cost
-- A supplier bill made from receipts now also takes the currency, rate and prices of the
-- shipment the goods came on (when there is no PO), and is linked to that shipment.
-- Price order: approved receipt cost → PO price → shipment price → left empty to fill in.
-- (Same as the returns version otherwise: goods returned before billing are not billed.)
-- =====================================================================
create or replace function public.create_bill_from_receipts(p_company_id uuid, p_receipt_ids uuid[], p_bill_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_n int; v_sup uuid; v_lines jsonb := '[]'::jsonb; l record; v_cur text; v_fx numeric; v_disc numeric; v_bill uuid; v_ships uuid[];
begin
  perform public.inv_require(p_company_id, 'purchasing.manage');
  select count(distinct supplier_id), min(supplier_id::text)::uuid into v_n, v_sup from public.goods_receipts
   where id = any(p_receipt_ids) and company_id = p_company_id and status = 'POSTED';
  if v_n = 0 or v_sup is null then raise exception 'Choose posted receipts that have a supplier' using errcode = '23502'; end if;
  if v_n > 1 then raise exception 'All receipts on one bill must be from the same supplier' using errcode = '22023'; end if;
  select coalesce(max(g.cost_currency), max(po.currency), max(sh.currency), max(s.default_currency), 'PKR'),
         coalesce(max(g.cost_fx_rate), max(po.fx_rate), max(sh.fx_rate), 1),
         array_remove(array_agg(distinct g.shipment_id), null)
    into v_cur, v_fx, v_ships
    from public.goods_receipts g join public.suppliers s on s.id = g.supplier_id
    left join public.purchase_orders po on po.id = g.purchase_order_id
    left join public.shipments sh on sh.id = g.shipment_id
   where g.id = any(p_receipt_ids);
  if v_cur = 'PKR' then v_fx := 1; end if;
  for l in select gl.*, g.doc_no, g.cost_currency,
             (select pl.unit_price from public.goods_receipt_po_links k join public.purchase_order_lines pl on pl.id = k.po_line_id
               join public.purchase_orders po on po.id = pl.purchase_order_id where k.receipt_line_id = gl.id and not k.reversed and po.currency = v_cur limit 1) as po_price,
             (select sl.unit_price from public.goods_receipt_shipment_links k join public.shipment_lines sl on sl.id = k.shipment_line_id
               join public.shipments sh on sh.id = sl.shipment_id where k.receipt_line_id = gl.id and not k.reversed and sl.unit_price is not null and sh.currency = v_cur limit 1) as ship_price
           from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
           where gl.receipt_id = any(p_receipt_ids) and gl.quantity - gl.returned_unbilled_qty > gl.billed_qty order by g.doc_date, g.doc_no, gl.line_no loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('kind', 'ITEM', 'receipt_line_id', l.id, 'quantity', l.quantity - l.returned_unbilled_qty - l.billed_qty,
      'unit_price', coalesce(case when l.unit_cost is not null and coalesce(l.cost_currency, 'PKR') = v_cur then l.unit_cost end, l.po_price, l.ship_price)));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'These receipts are already fully billed' using errcode = '22023'; end if;
  -- the purchase orders' discount, in proportion to what is billed now (same currency only)
  select coalesce(round(sum(po.discount_amount * part.v / nullif(full_v.v, 0)), 2), 0) into v_disc
    from (select pl.purchase_order_id po_id, sum(round(k.quantity * pl.unit_price, 2)) v
          from public.goods_receipt_po_links k join public.goods_receipt_lines gl on gl.id = k.receipt_line_id join public.purchase_order_lines pl on pl.id = k.po_line_id
          where gl.receipt_id = any(p_receipt_ids) and not k.reversed and gl.billed_qty = 0 and pl.unit_price is not null group by pl.purchase_order_id) part
    join public.purchase_orders po on po.id = part.po_id and po.discount_amount > 0 and po.currency = v_cur
    join lateral (select sum(round(pol.quantity * pol.unit_price, 2)) v from public.purchase_order_lines pol where pol.purchase_order_id = po.id and pol.is_active and pol.unit_price is not null) full_v on true;
  v_bill := public.save_supplier_bill(null, jsonb_build_object('company_id', p_company_id, 'supplier_id', v_sup, 'bill_date', coalesce(p_bill_date, current_date),
    'currency', v_cur, 'fx_rate', v_fx, 'discount_amount', v_disc), v_lines, null);
  -- goods from one shipment: the bill belongs to that shipment (its import costs and landed cost)
  if cardinality(v_ships) = 1 then update public.supplier_bills set shipment_id = v_ships[1] where id = v_bill; end if;
  return v_bill;
end $$;
