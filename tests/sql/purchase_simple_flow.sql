-- Simple import flow: shipment (no PO, priced in CNY) → GRN → supplier bill takes the shipment's currency, rate and prices and links the shipment.
-- Expected: every row starts with "ok"; everything rolls back.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'ADMINISTRATOR' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table t_out(step int, result text);
do $$
declare c uuid := (select id from public.companies limit 1); sup uuid; wh uuid; p1 uuid; p2 uuid; sh uuid; grn uuid; bill uuid; b record; n int; pr text;
begin
  select id into sup from public.suppliers where company_id = c order by created_at limit 1;
  select id into wh from public.warehouses where company_id = c order by code limit 1;
  select id into p1 from public.products where company_id = c and not is_bundle and tracking_type <> 'ROLL' order by created_at limit 1;
  select id into p2 from public.products where company_id = c and not is_bundle and tracking_type <> 'ROLL' and id <> p1 order by created_at limit 1;
  sh := public.save_shipment(null, jsonb_build_object('company_id', c, 'supplier_id', sup, 'currency', 'CNY', 'fx_rate', 40, 'mode', 'SEA'),
    jsonb_build_array(jsonb_build_object('product_id', p1, 'quantity', 100, 'unit_price', 12.5), jsonb_build_object('product_id', p2, 'quantity', 50, 'unit_price', 30)));
  grn := public.receive_shipment(sh, wh, current_date, null, 'BL-TEST');
  perform public.post_stock_document('GOODS_RECEIPT', grn);
  bill := public.create_bill_from_receipts(c, array[grn]);
  select * into b from public.supplier_bills where id = bill;
  insert into t_out values (1, case when b.currency = 'CNY' and b.fx_rate = 40 then 'ok' else 'BAD' end || ' bill currency from shipment: ' || b.currency || ' @' || b.fx_rate);
  perform public.post_supplier_bill(bill);
  select string_agg(round(quantity)::text || '@' || round(unit_price, 2)::text, ', ' order by line_no) into pr from public.supplier_bill_lines where bill_id = bill;
  insert into t_out values (2, case when pr = '100@12.50, 50@30.00' then 'ok' else 'BAD' end || ' prices from shipment: ' || coalesce(pr, 'none'));
  insert into t_out values (3, case when b.shipment_id = sh then 'ok' else 'BAD' end || ' bill linked to the shipment');
  select count(*) into n from public.goods_receipt_lines where receipt_id = grn and unit_cost is not null;
  insert into t_out values (4, case when n = 2 then 'ok' else 'BAD' end || ' posting the bill costs the receipt lines: ' || n);
end $$;
select * from t_out order by step;
rollback;
