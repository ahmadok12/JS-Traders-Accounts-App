-- =====================================================================
-- JS Traders ERP — Stage 11: reports, dashboard, saved reports, report shortcuts (spec §20, §20.1)
-- Every report is a read-only function over the authoritative tables (security invoker:
-- the caller's row-level security applies, so a report never shows more than the screens).
-- Money columns that need extra rights (cost / value / margin) come back NULL without them.
-- =====================================================================

-- ---------------------------------------------------------------- inventory
create or replace function public.rpt_stock_summary(p_company uuid, p_as_of date default null, p_warehouse uuid default null)
returns table(product_id uuid, variant_id uuid, sku text, item text, variant text, category text, warehouse_id uuid, warehouse text, uom text,
              qty numeric, reserved numeric, available numeric, reorder_level numeric, item_total numeric, below_reorder boolean, avg_cost numeric, value numeric)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select b.product_id, b.variant_id, b.warehouse_id, sum(b.on_hand) qty
    from public.stock_balances b
    where p_as_of is null and b.company_id = p_company and (p_warehouse is null or b.warehouse_id = p_warehouse)
    group by 1, 2, 3
    union all
    select m.product_id, m.variant_id, m.warehouse_id, sum(m.quantity)
    from public.stock_movements m
    where p_as_of is not null and m.company_id = p_company and m.movement_date <= p_as_of and (p_warehouse is null or m.warehouse_id = p_warehouse)
    group by 1, 2, 3
  ),
  r as (
    select x.product_id, x.variant_id, x.warehouse_id, sum(x.quantity) res from public.reservations x
    where x.company_id = p_company and x.status = 'ACTIVE' and (p_as_of is null or p_as_of >= current_date) group by 1, 2, 3
  ),
  v as (select public.has_permission(p_company, 'inventory.valuation') as ok)
  select q.product_id, q.variant_id, coalesce(pv.sku, p.sku), p.name, pv.name, c.name, q.warehouse_id, w.name, u.code,
    q.qty, coalesce(r.res, 0), q.qty - coalesce(r.res, 0), p.reorder_level,
    sum(q.qty - coalesce(r.res, 0)) over (partition by q.product_id),
    p.reorder_level is not null and sum(q.qty - coalesce(r.res, 0)) over (partition by q.product_id) <= p.reorder_level,
    case when (select ok from v) then case when ic.qty > 0 then round(ic.value / ic.qty, 4) else ic.last_cost end end,
    case when (select ok from v) then round(q.qty * case when ic.qty > 0 then ic.value / ic.qty else coalesce(ic.last_cost, 0) end, 2) end
  from q
  join public.products p on p.id = q.product_id
  left join public.product_variants pv on pv.id = q.variant_id
  left join public.product_categories c on c.id = p.category_id
  left join public.units_of_measure u on u.id = p.base_uom_id
  join public.warehouses w on w.id = q.warehouse_id
  left join r on r.product_id = q.product_id and r.variant_id is not distinct from q.variant_id and r.warehouse_id = q.warehouse_id
  left join public.item_costs ic on ic.product_id = q.product_id and ic.variant_id is not distinct from q.variant_id
  where q.qty <> 0 or coalesce(r.res, 0) <> 0
  order by p.name, pv.name, w.name;
$$;
grant execute on function public.rpt_stock_summary(uuid, date, uuid) to authenticated;

create or replace function public.rpt_stock_movement_summary(p_company uuid, p_from date, p_to date, p_warehouse uuid default null)
returns table(product_id uuid, variant_id uuid, sku text, item text, variant text, warehouse text, opening numeric, purchases numeric, transfers_in numeric,
              transfers_out numeric, sales numeric, assembly numeric, adjustments numeric, closing numeric)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select m.product_id, m.variant_id, m.warehouse_id, m.movement_type t, m.quantity q, m.movement_date d
    from public.stock_movements m
    where m.company_id = p_company and (p_to is null or m.movement_date <= p_to) and (p_warehouse is null or m.warehouse_id = p_warehouse)
  ),
  g as (
    select product_id, variant_id, warehouse_id,
      coalesce(sum(q) filter (where p_from is not null and d < p_from), 0) opening,
      coalesce(sum(q) filter (where (p_from is null or d >= p_from) and t = 'PURCHASE_RECEIPT'), 0) purchases,
      coalesce(sum(q) filter (where (p_from is null or d >= p_from) and t = 'TRANSFER_IN'), 0) tin,
      coalesce(sum(q) filter (where (p_from is null or d >= p_from) and t = 'TRANSFER_OUT'), 0) tout,
      coalesce(sum(q) filter (where (p_from is null or d >= p_from) and t = 'SALES_GDN'), 0) sales,
      coalesce(sum(q) filter (where (p_from is null or d >= p_from) and t like '%ASSEMBLY%'), 0) asm,
      coalesce(sum(q) filter (where (p_from is null or d >= p_from) and t not in ('PURCHASE_RECEIPT','TRANSFER_IN','TRANSFER_OUT','SALES_GDN') and t not like '%ASSEMBLY%'), 0) adj,
      sum(q) closing
    from m group by 1, 2, 3
  )
  select g.product_id, g.variant_id, coalesce(pv.sku, p.sku), p.name, pv.name, w.name, g.opening, g.purchases, g.tin, g.tout, g.sales, g.asm, g.adj, g.closing
  from g join public.products p on p.id = g.product_id left join public.product_variants pv on pv.id = g.variant_id join public.warehouses w on w.id = g.warehouse_id
  where g.opening <> 0 or g.closing <> 0 or g.purchases <> 0 or g.sales <> 0 or g.tin <> 0 or g.tout <> 0 or g.adj <> 0 or g.asm <> 0
  order by p.name, pv.name, w.name;
$$;
grant execute on function public.rpt_stock_movement_summary(uuid, date, date, uuid) to authenticated;

create or replace function public.rpt_count_variance(p_company uuid, p_from date, p_to date, p_warehouse uuid default null)
returns table(count_id uuid, doc_no text, count_date date, warehouse text, sku text, item text, variant text, system_qty numeric, counted_qty numeric,
              variance numeric, variance_value numeric, counted_by text, note text)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.doc_no, coalesce(l.posted_at::date, c.doc_date), w.name, coalesce(pv.sku, p.sku), p.name, pv.name, l.system_qty_before, l.counted_qty, l.adjustment_qty,
    case when public.has_permission(p_company, 'inventory.valuation') then round(l.adjustment_qty * case when ic.qty > 0 then ic.value / ic.qty else coalesce(ic.last_cost, 0) end, 2) end,
    pr.full_name, l.variance_note
  from public.stock_count_lines l
  join public.stock_counts c on c.id = l.count_id
  join public.products p on p.id = l.product_id
  left join public.product_variants pv on pv.id = l.variant_id
  join public.warehouses w on w.id = c.warehouse_id
  left join public.item_costs ic on ic.product_id = l.product_id and ic.variant_id is not distinct from l.variant_id
  left join public.profiles pr on pr.id = l.counted_by
  where l.company_id = p_company and l.posted_at is not null and coalesce(l.adjustment_qty, 0) <> 0
    and (p_from is null or l.posted_at::date >= p_from) and (p_to is null or l.posted_at::date <= p_to) and (p_warehouse is null or c.warehouse_id = p_warehouse)
  order by l.posted_at desc;
$$;
grant execute on function public.rpt_count_variance(uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------- sales
create or replace function public.rpt_pending_orders(p_company uuid, p_customer uuid default null)
returns table(sales_order_id uuid, doc_no text, order_date date, age_days int, customer_id uuid, customer text, status text, sku text, item text, variant text,
              ordered numeric, delivered numeric, open_qty numeric, warehouses text, unit_price numeric, open_value numeric)
language sql stable security definer set search_path = '' as $$  -- definer: order-line prices are column-protected; access checked below
  select so.id, so.doc_no, so.order_date, (current_date - so.order_date)::int, so.customer_id, cu.name, so.status, coalesce(pv.sku, p.sku), p.name, pv.name,
    l.quantity, l.delivered_qty, l.quantity - l.delivered_qty,
    (select string_agg(w.name || ' ' || trim(to_char(a.quantity - a.delivered_quantity, 'FM999999990.###')), ', ' order by w.name)
       from public.sales_order_line_warehouse_allocations a join public.warehouses w on w.id = a.warehouse_id
      where a.sales_order_line_id = l.id and a.quantity > a.delivered_quantity),
    case when public.has_permission(p_company, 'sales.view_prices') then l.unit_price end,
    case when public.has_permission(p_company, 'sales.view_prices') then round((l.quantity - l.delivered_qty) * l.unit_price, 2) end
  from public.sales_order_lines l
  join public.sales_orders so on so.id = l.sales_order_id
  join public.customers cu on cu.id = so.customer_id
  join public.products p on p.id = l.product_id
  left join public.product_variants pv on pv.id = l.variant_id
  where l.company_id = p_company and public.has_permission(p_company, 'sales.view') and public.can_access_customer(so.customer_id) and l.is_active and so.status in ('APPROVED','PARTIALLY_DELIVERED','DRAFT') and l.quantity > l.delivered_qty
    and (p_customer is null or so.customer_id = p_customer)
  order by so.order_date, so.doc_no, l.line_no;
$$;
grant execute on function public.rpt_pending_orders(uuid, uuid) to authenticated;

create or replace function public.rpt_sales_register(p_company uuid, p_from date, p_to date, p_customer uuid default null)
returns table(invoice_id uuid, doc_no text, invoice_date date, due_date date, customer_id uuid, customer text, subtotal numeric, discount numeric, total numeric,
              paid numeric, outstanding numeric, payment_status text, cogs numeric, margin numeric, margin_pct numeric)
language sql stable security invoker set search_path = '' as $$
  with i as (
    select v.* from public.sales_invoices_v v
    where v.company_id = p_company and v.status = 'POSTED' and (p_from is null or v.invoice_date >= p_from) and (p_to is null or v.invoice_date <= p_to)
      and (p_customer is null or v.customer_id = p_customer)
  ),
  c as (select i.id, (select sum(x.cogs) from public.invoice_cogs(i.id) x) cogs from i where public.has_permission(p_company, 'inventory.valuation'))
  select i.id, i.doc_no, i.invoice_date, i.due_date, i.customer_id, i.customer_name, i.subtotal, i.discount_amount, i.total_amount, i.paid_amount, i.outstanding, i.payment_status,
    c.cogs, case when c.cogs is not null then i.total_amount - c.cogs end,
    case when c.cogs is not null and i.total_amount <> 0 then round((i.total_amount - c.cogs) / i.total_amount * 100, 1) end
  from i left join c on c.id = i.id
  order by i.invoice_date, i.doc_no;
$$;
grant execute on function public.rpt_sales_register(uuid, date, date, uuid) to authenticated;

create or replace function public.rpt_sales_by_item(p_company uuid, p_from date, p_to date, p_customer uuid default null)
returns table(product_id uuid, variant_id uuid, sku text, item text, variant text, category text, qty numeric, amount numeric, avg_price numeric, invoices int, customers int, last_sold date)
language sql stable security invoker set search_path = '' as $$
  select l.product_id, l.variant_id, coalesce(pv.sku, p.sku), p.name, pv.name, c.name, sum(l.quantity), sum(l.amount),
    case when sum(l.quantity) <> 0 then round(sum(l.amount) / sum(l.quantity), 2) end, count(distinct i.id)::int, count(distinct i.customer_id)::int, max(i.invoice_date)
  from public.sales_invoice_lines l
  join public.sales_invoices i on i.id = l.invoice_id
  join public.products p on p.id = l.product_id
  left join public.product_variants pv on pv.id = l.variant_id
  left join public.product_categories c on c.id = p.category_id
  where l.company_id = p_company and i.status = 'POSTED' and (p_from is null or i.invoice_date >= p_from) and (p_to is null or i.invoice_date <= p_to)
    and (p_customer is null or i.customer_id = p_customer)
  group by l.product_id, l.variant_id, pv.sku, p.sku, p.name, pv.name, c.name
  order by sum(l.amount) desc;
$$;
grant execute on function public.rpt_sales_by_item(uuid, date, date, uuid) to authenticated;

create or replace function public.rpt_dispatch_register(p_company uuid, p_from date, p_to date, p_warehouse uuid default null, p_customer uuid default null)
returns table(gdn_id uuid, doc_no text, gdn_date date, status text, sales_order text, customer_id uuid, customer text, warehouse text, sku text, item text, variant text,
              quantity numeric, invoiced_qty numeric, not_invoiced numeric)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.doc_no, g.gdn_date, g.status, so.doc_no, g.customer_id, cu.name, w.name, coalesce(pv.sku, p.sku), p.name, pv.name, l.quantity, l.invoiced_qty, l.quantity - l.invoiced_qty
  from public.gdn_lines l
  join public.gdns g on g.id = l.gdn_id
  join public.customers cu on cu.id = g.customer_id
  left join public.sales_orders so on so.id = g.sales_order_id
  join public.warehouses w on w.id = l.warehouse_id
  join public.products p on p.id = l.product_id
  left join public.product_variants pv on pv.id = l.variant_id
  where l.company_id = p_company and g.status = 'POSTED' and (p_from is null or g.gdn_date >= p_from) and (p_to is null or g.gdn_date <= p_to)
    and (p_warehouse is null or l.warehouse_id = p_warehouse) and (p_customer is null or g.customer_id = p_customer)
  order by g.gdn_date, g.doc_no, l.line_no;
$$;
grant execute on function public.rpt_dispatch_register(uuid, date, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- purchasing / imports
create or replace function public.rpt_purchase_register(p_company uuid, p_from date, p_to date, p_supplier uuid default null)
returns table(bill_id uuid, doc_no text, bill_date date, due_date date, supplier_id uuid, supplier text, supplier_invoice_no text, currency text, fx_rate numeric,
              total_fx numeric, total_pkr numeric, paid_pkr numeric, outstanding_fx numeric, outstanding_pkr numeric, fx_diff numeric, payment_status text, is_quick boolean)
language sql stable security invoker set search_path = '' as $$
  select b.id, b.doc_no, b.bill_date, b.due_date, b.supplier_id, b.supplier_name, b.supplier_invoice_no, b.currency, b.fx_rate, b.total_amount, b.total_pkr,
    b.paid_actual_pkr, b.outstanding_fx, b.outstanding_pkr, b.fx_diff, b.payment_status, b.is_quick
  from public.supplier_bills_v b
  where b.company_id = p_company and b.status = 'POSTED' and (p_from is null or b.bill_date >= p_from) and (p_to is null or b.bill_date <= p_to)
    and (p_supplier is null or b.supplier_id = p_supplier)
  order by b.bill_date, b.doc_no;
$$;
grant execute on function public.rpt_purchase_register(uuid, date, date, uuid) to authenticated;

create or replace function public.rpt_purchases_by_item(p_company uuid, p_from date, p_to date, p_supplier uuid default null)
returns table(product_id uuid, variant_id uuid, sku text, item text, variant text, qty_received numeric, cost_pkr numeric, landed_pkr numeric, avg_unit_cost numeric,
              uncosted_qty numeric, receipts int, suppliers int, last_received date)
language sql stable security invoker set search_path = '' as $$
  select l.product_id, l.variant_id, coalesce(pv.sku, p.sku), p.name, pv.name, sum(l.quantity),
    case when public.has_permission(p_company, 'purchasing.costs') then sum(l.quantity * l.unit_cost_pkr) end,
    case when public.has_permission(p_company, 'purchasing.costs') then sum(coalesce(l.landed_cost_pkr, 0)) end,
    case when public.has_permission(p_company, 'purchasing.costs') and sum(l.quantity) filter (where l.unit_cost_pkr is not null) > 0
      then round((sum(l.quantity * l.unit_cost_pkr) + sum(coalesce(l.landed_cost_pkr, 0))) / sum(l.quantity) filter (where l.unit_cost_pkr is not null), 4) end,
    coalesce(sum(l.quantity) filter (where l.unit_cost_pkr is null), 0), count(distinct g.id)::int, count(distinct g.supplier_id)::int, max(g.doc_date)
  from public.goods_receipt_lines l
  join public.goods_receipts g on g.id = l.receipt_id
  join public.products p on p.id = l.product_id
  left join public.product_variants pv on pv.id = l.variant_id
  where l.company_id = p_company and g.status = 'POSTED' and (p_from is null or g.doc_date >= p_from) and (p_to is null or g.doc_date <= p_to)
    and (p_supplier is null or g.supplier_id = p_supplier)
  group by l.product_id, l.variant_id, pv.sku, p.sku, p.name, pv.name
  order by p.name, pv.name;
$$;
grant execute on function public.rpt_purchases_by_item(uuid, date, date, uuid) to authenticated;

create or replace function public.rpt_shipments(p_company uuid, p_from date, p_to date)
returns table(shipment_id uuid, doc_no text, supplier text, mode text, status text, bl_no text, etd date, eta date, ata date, late boolean, days_late int,
              currency text, goods_value_fx numeric, goods_value_pkr numeric, qty numeric, received_qty numeric, landed_cost_pkr numeric, landed_pct numeric)
language sql stable security definer set search_path = '' as $$  -- definer: shipment line prices are column-protected; access checked below
  with l as (select shipment_id, sum(quantity) q, sum(received_qty) rq, sum(quantity * coalesce(unit_price, 0)) v from public.shipment_lines where is_active group by 1),
  lc as (select x.shipment_id, sum(ch.amount_pkr) a from public.landed_costs x join public.landed_cost_charges ch on ch.landed_cost_id = x.id and ch.is_active and ch.settled_by is null
         where x.status = 'POSTED' group by 1)
  select s.id, s.doc_no, su.name, s.mode, s.status, s.bl_no, s.etd, s.eta, s.ata,
    s.ata is null and s.eta < current_date and s.status not in ('DELIVERED','CANCELLED'),
    case when s.ata is null and s.eta < current_date and s.status not in ('DELIVERED','CANCELLED') then (current_date - s.eta)::int end,
    s.currency, case when public.has_permission(p_company, 'purchasing.costs') then l.v end, case when public.has_permission(p_company, 'purchasing.costs') then round(l.v * coalesce(s.fx_rate, 1), 2) end, l.q, l.rq,
    case when public.has_permission(p_company, 'purchasing.costs') then lc.a end,
    case when public.has_permission(p_company, 'purchasing.costs') and coalesce(l.v * coalesce(s.fx_rate, 1), 0) > 0 then round(lc.a / (l.v * coalesce(s.fx_rate, 1)) * 100, 1) end
  from public.shipments s
  left join public.suppliers su on su.id = s.supplier_id
  left join l on l.shipment_id = s.id
  left join lc on lc.shipment_id = s.id
  where s.company_id = p_company and public.has_permission(p_company, 'purchasing.view') and (p_from is null or coalesce(s.etd, s.created_at::date) >= p_from) and (p_to is null or coalesce(s.etd, s.created_at::date) <= p_to)
  order by coalesce(s.eta, s.etd) desc nulls last;
$$;
grant execute on function public.rpt_shipments(uuid, date, date) to authenticated;

create or replace function public.rpt_landed_costs(p_company uuid, p_from date, p_to date)
returns table(landed_cost_id uuid, doc_no text, doc_date date, status text, shipment text, component text, description text, payee text, currency text,
              amount numeric, amount_pkr numeric, treatment text, method text)
language sql stable security invoker set search_path = '' as $$
  select x.id, x.doc_no, x.doc_date, x.status, s.doc_no, ch.component, ch.description, coalesce(su.name, b.name), ch.currency, ch.amount, ch.amount_pkr, ch.treatment, ch.method
  from public.landed_cost_charges ch
  join public.landed_costs x on x.id = ch.landed_cost_id
  left join public.shipments s on s.id = x.shipment_id
  left join public.suppliers su on su.id = ch.supplier_id
  left join public.bank_accounts b on b.id = ch.bank_account_id
  where ch.company_id = p_company and ch.is_active and x.status in ('POSTED','REVERSED')
    and (p_from is null or x.doc_date >= p_from) and (p_to is null or x.doc_date <= p_to)
  order by x.doc_date, x.doc_no, ch.line_no;
$$;
grant execute on function public.rpt_landed_costs(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------- receivables / payables ageing
-- Buckets from open invoices / bills by due date; "other" = balance − open documents (opening balances,
-- unapplied receipts / payments, journals) so the total always equals the party ledger balance.
create or replace function public.rpt_aging(p_company uuid, p_party_type text, p_as_of date default null)
returns table(party_id uuid, code text, name text, city text, balance numeric, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric,
              other numeric, oldest_due date, open_docs int)
language sql stable security invoker set search_path = '' as $$
  with a as (select coalesce(p_as_of, current_date) d),
  docs as (
    select v.customer_id pid, coalesce(v.due_date, v.invoice_date) due, v.outstanding amt
    from public.sales_invoices_v v where p_party_type = 'CUSTOMER' and v.company_id = p_company and v.status = 'POSTED' and v.outstanding > 0 and v.invoice_date <= (select d from a)
    union all
    select v.supplier_id, coalesce(v.due_date, v.bill_date), v.outstanding_pkr
    from public.supplier_bills_v v where p_party_type = 'SUPPLIER' and v.company_id = p_company and v.status = 'POSTED' and v.outstanding_pkr > 0 and v.bill_date <= (select d from a)
  ),
  b as (
    select pid,
      sum(amt) filter (where due >= (select d from a)) nd,
      sum(amt) filter (where (select d from a) - due between 1 and 30) b1,
      sum(amt) filter (where (select d from a) - due between 31 and 60) b2,
      sum(amt) filter (where (select d from a) - due between 61 and 90) b3,
      sum(amt) filter (where (select d from a) - due > 90) b4,
      sum(amt) total, min(due) oldest, count(*)::int n
    from docs group by pid
  )
  select pb.party_id, pb.code, pb.name, pb.city, pb.balance, coalesce(b.nd, 0), coalesce(b.b1, 0), coalesce(b.b2, 0), coalesce(b.b3, 0), coalesce(b.b4, 0),
    pb.balance - coalesce(b.total, 0), b.oldest, coalesce(b.n, 0)
  from public.party_balances(p_company, p_party_type, p_as_of) pb
  left join b on b.pid = pb.party_id
  where pb.balance <> 0 or b.total is not null
  order by pb.balance desc;
$$;
grant execute on function public.rpt_aging(uuid, text, date) to authenticated;

create or replace function public.rpt_aging_detail(p_company uuid, p_party_type text, p_as_of date default null, p_party uuid default null)
returns table(doc_id uuid, doc_kind text, doc_no text, party_id uuid, party text, doc_date date, due_date date, days_overdue int, bucket text, total numeric, outstanding numeric)
language sql stable security invoker set search_path = '' as $$
  with a as (select coalesce(p_as_of, current_date) d),
  docs as (
    select v.id, 'INVOICE' k, v.doc_no, v.customer_id pid, v.customer_name pn, v.invoice_date dd, coalesce(v.due_date, v.invoice_date) due, v.total_amount t, v.outstanding o
    from public.sales_invoices_v v where p_party_type = 'CUSTOMER' and v.company_id = p_company and v.status = 'POSTED' and v.outstanding > 0 and v.invoice_date <= (select d from a)
      and (p_party is null or v.customer_id = p_party)
    union all
    select v.id, 'BILL', v.doc_no, v.supplier_id, v.supplier_name, v.bill_date, coalesce(v.due_date, v.bill_date), v.total_pkr, v.outstanding_pkr
    from public.supplier_bills_v v where p_party_type = 'SUPPLIER' and v.company_id = p_company and v.status = 'POSTED' and v.outstanding_pkr > 0 and v.bill_date <= (select d from a)
      and (p_party is null or v.supplier_id = p_party)
  )
  select id, k, doc_no, pid, pn, dd, due, greatest((select d from a) - due, 0)::int,
    case when (select d from a) <= due then 'Not due' when (select d from a) - due <= 30 then '1-30' when (select d from a) - due <= 60 then '31-60'
         when (select d from a) - due <= 90 then '61-90' else '90+' end, t, o
  from docs order by pn, due;
$$;
grant execute on function public.rpt_aging_detail(uuid, text, date, uuid) to authenticated;

-- ---------------------------------------------------------------- ledger / statements
create or replace function public.rpt_general_ledger(p_company uuid, p_account uuid, p_from date, p_to date)
returns table(row_kind text, entry_id uuid, entry_no text, entry_date date, entry_type text, party text, memo text, description text, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = '' as $$
  with l as (
    select jl.* from public.journal_lines jl where jl.company_id = p_company and jl.account_id = p_account and (p_to is null or jl.entry_date <= p_to)
  ),
  ob as (select coalesce(sum(debit - credit), 0) v from l where p_from is not null and entry_date < p_from),
  t as (select l.*, e.entry_no, e.entry_type, e.memo, e.party_name, e.created_at ec from l join public.journal_entries_v e on e.id = l.entry_id where p_from is null or l.entry_date >= p_from)
  select 'OPENING', null::uuid, null::text, p_from, null::text, null::text, 'Opening balance', null::text, null::numeric, null::numeric, (select v from ob)
  union all
  (select 'TXN', t.entry_id, t.entry_no, t.entry_date, t.entry_type, t.party_name, t.memo, t.description, t.debit, t.credit,
     (select v from ob) + sum(t.debit - t.credit) over (order by t.entry_date, t.ec, t.entry_no, t.line_no rows unbounded preceding)
   from t order by t.entry_date, t.ec, t.entry_no, t.line_no);
$$;
grant execute on function public.rpt_general_ledger(uuid, uuid, date, date) to authenticated;

-- P&L: income = credit − debit, expense = debit − credit; optional comparison period
create or replace function public.rpt_profit_loss(p_company uuid, p_from date, p_to date, p_cmp_from date default null, p_cmp_to date default null)
returns table(section text, account_id uuid, code text, name text, parent text, amount numeric, compare_amount numeric)
language sql stable security invoker set search_path = '' as $$
  select case when a.account_type = 'INCOME' then 'INCOME' when a.system_key in ('COGS') then 'COGS' else 'EXPENSE' end,
    a.id, a.code, a.name, pa.name,
    coalesce(sum(case when a.account_type = 'INCOME' then jl.credit - jl.debit else jl.debit - jl.credit end)
      filter (where (p_from is null or jl.entry_date >= p_from) and (p_to is null or jl.entry_date <= p_to)), 0),
    case when p_cmp_from is not null or p_cmp_to is not null then
      coalesce(sum(case when a.account_type = 'INCOME' then jl.credit - jl.debit else jl.debit - jl.credit end)
        filter (where (p_cmp_from is null or jl.entry_date >= p_cmp_from) and (p_cmp_to is null or jl.entry_date <= p_cmp_to)), 0) end
  from public.journal_lines jl
  join public.chart_of_accounts a on a.id = jl.account_id and a.account_type in ('INCOME','EXPENSE')
  left join public.chart_of_accounts pa on pa.id = a.parent_id
  where jl.company_id = p_company
  group by a.id, a.code, a.name, a.account_type, a.system_key, pa.name
  having coalesce(sum(jl.debit - jl.credit) filter (where (p_from is null or jl.entry_date >= p_from) and (p_to is null or jl.entry_date <= p_to)), 0) <> 0
      or ((p_cmp_from is not null or p_cmp_to is not null)
          and coalesce(sum(jl.debit - jl.credit) filter (where (p_cmp_from is null or jl.entry_date >= p_cmp_from) and (p_cmp_to is null or jl.entry_date <= p_cmp_to)), 0) <> 0)
  order by 1 desc, a.code;
$$;
grant execute on function public.rpt_profit_loss(uuid, date, date, date, date) to authenticated;

-- Balance sheet as of a date. Profit not yet closed to retained earnings shows as "Profit / loss to date".
create or replace function public.rpt_balance_sheet(p_company uuid, p_as_of date default null)
returns table(section text, account_id uuid, code text, name text, parent text, amount numeric)
language sql stable security invoker set search_path = '' as $$
  with l as (
    select a.id, a.code, a.name, a.account_type, pa.name parent, sum(jl.debit - jl.credit) dc
    from public.journal_lines jl join public.chart_of_accounts a on a.id = jl.account_id left join public.chart_of_accounts pa on pa.id = a.parent_id
    where jl.company_id = p_company and (p_as_of is null or jl.entry_date <= p_as_of)
    group by a.id, a.code, a.name, a.account_type, pa.name
  )
  select account_type, id, code, name, parent, case when account_type = 'ASSET' then dc else -dc end
  from l where account_type in ('ASSET','LIABILITY','EQUITY') and dc <> 0
  union all
  select 'EQUITY', null, '3999', 'Profit / loss to date (not yet closed)', null, coalesce(-sum(dc) filter (where account_type in ('INCOME','EXPENSE')), 0)
  from l having coalesce(sum(dc) filter (where account_type in ('INCOME','EXPENSE')), 0) <> 0
  order by 1, 3;
$$;
grant execute on function public.rpt_balance_sheet(uuid, date) to authenticated;

create or replace function public.rpt_cash_bank_summary(p_company uuid, p_from date, p_to date)
returns table(bank_account_id uuid, code text, name text, kind text, currency text, opening numeric, money_in numeric, money_out numeric, closing numeric,
              reconciled_until date, unmatched_items int)
language sql stable security invoker set search_path = '' as $$
  select b.id, b.code, b.name, b.account_kind, b.currency,
    coalesce(sum(jl.debit - jl.credit) filter (where p_from is not null and jl.entry_date < p_from), 0),
    coalesce(sum(jl.debit) filter (where (p_from is null or jl.entry_date >= p_from)), 0),
    coalesce(sum(jl.credit) filter (where (p_from is null or jl.entry_date >= p_from)), 0),
    coalesce(sum(jl.debit - jl.credit), 0),
    b.reconciled_until,
    (select count(*) from public.journal_lines x where x.bank_account_id = b.id and (p_to is null or x.entry_date <= p_to)
       and not exists (select 1 from public.bank_matches m where m.journal_line_id = x.id and m.status = 'ACTIVE'))::int
  from public.bank_accounts b
  left join public.journal_lines jl on jl.bank_account_id = b.id and (p_to is null or jl.entry_date <= p_to)
  where b.company_id = p_company and b.is_active
  group by b.id order by b.account_kind, b.name;
$$;
grant execute on function public.rpt_cash_bank_summary(uuid, date, date) to authenticated;

create or replace function public.rpt_uncleared_items(p_company uuid, p_bank uuid, p_as_of date default null)
returns table(entry_id uuid, entry_no text, entry_date date, entry_type text, party text, memo text, reference text, amount numeric, age_days int)
language sql stable security invoker set search_path = '' as $$
  select v.entry_id, v.entry_no, v.entry_date, v.entry_type, v.party_name, v.memo, v.reference, v.amount, (coalesce(p_as_of, current_date) - v.entry_date)::int
  from public.bank_ledger_lines_v v
  where v.company_id = p_company and v.bank_account_id = p_bank and v.match_group is null and (p_as_of is null or v.entry_date <= p_as_of)
  order by v.entry_date;
$$;
grant execute on function public.rpt_uncleared_items(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------- people
create or replace function public.rpt_payroll_register(p_company uuid, p_from date, p_to date)
returns table(run_id uuid, run_no text, period_month date, run_status text, employee_id uuid, employee text, department text, basic_salary numeric, assembly_labour numeric,
              bonus numeric, other_earnings numeric, gross numeric, leave_deduction numeric, other_deductions numeric, advance_recovery numeric, net_pay numeric, paid numeric, unpaid numeric)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.doc_no, r.period_month, r.status, e.id, e.full_name, e.department, l.basic_salary, l.assembly_labour, l.bonus, l.other_earnings, l.gross, l.leave_deduction,
    l.other_deductions, l.advance_recovery, l.net_pay, l.paid_amount, l.net_pay - l.paid_amount
  from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id join public.employees e on e.id = l.employee_id
  where l.company_id = p_company and l.is_active and r.status in ('APPROVED','POSTED')
    and (p_from is null or r.period_month >= date_trunc('month', p_from)::date) and (p_to is null or r.period_month <= p_to)
  order by r.period_month, e.full_name;
$$;
grant execute on function public.rpt_payroll_register(uuid, date, date) to authenticated;

create or replace function public.rpt_employee_advances(p_company uuid)
returns table(advance_id uuid, doc_no text, advance_date date, employee text, amount numeric, recovered numeric, written_off numeric, outstanding numeric, per_month numeric, status text, reason text)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.doc_no, a.advance_date, e.full_name, a.amount, a.recovered_amount, a.written_off_amount, a.amount - a.recovered_amount - a.written_off_amount,
    a.recovery_per_month, a.status, a.reason
  from public.employee_advances a join public.employees e on e.id = a.employee_id
  where a.company_id = p_company and a.status not in ('REJECTED','REQUESTED')
  order by (a.amount - a.recovered_amount - a.written_off_amount) desc, a.advance_date;
$$;
grant execute on function public.rpt_employee_advances(uuid) to authenticated;

create or replace function public.rpt_pay_items(p_company uuid, p_from date, p_to date, p_type text default null)
returns table(item_id uuid, item_date date, period_month date, employee text, item_type text, direction text, quantity numeric, rate numeric, amount numeric, status text,
              description text, product text)
language sql stable security invoker set search_path = '' as $$
  select i.id, i.item_date, i.period_month, e.full_name, i.item_type, i.direction, i.quantity, i.rate, i.amount, i.status, i.description,
    (select p.name || coalesce(' · ' || pv.name, '') from public.assembly_orders ao join public.products p on p.id = ao.product_id
       left join public.product_variants pv on pv.id = ao.variant_id
      where i.source_type ilike '%assembly%' and ao.id = (select x.assembly_order_id from public.employee_assembly_assignments x where x.id = i.source_id or x.pay_item_id = i.id limit 1))
  from public.employee_pay_items i join public.employees e on e.id = i.employee_id
  where i.company_id = p_company and i.status in ('APPROVED','PENDING') and (p_type is null or i.item_type = p_type)
    and (p_from is null or i.item_date >= p_from) and (p_to is null or i.item_date <= p_to)
  order by i.item_date, e.full_name;
$$;
grant execute on function public.rpt_pay_items(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------- audit / activity
create or replace function public.rpt_activity(p_company uuid, p_from date, p_to date, p_entity text default null, p_user uuid default null)
returns table(id bigint, created_at timestamptz, user_name text, action text, entity_type text, entity_id text, changed_fields text)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.created_at, coalesce(p.full_name, p.email, 'system'), a.action, a.entity_type, a.entity_id, array_to_string(a.changed_fields, ', ')
  from public.audit_logs a left join public.profiles p on p.id = a.user_id
  where a.company_id = p_company and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to + 1)
    and (p_entity is null or a.entity_type = p_entity) and (p_user is null or a.user_id = p_user)
  order by a.created_at desc limit 5000;
$$;
grant execute on function public.rpt_activity(uuid, date, date, text, uuid) to authenticated;

-- ---------------------------------------------------------------- dashboard
create or replace function public.rpt_dashboard(p_company uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare r jsonb := '{}'::jsonb; m0 date := date_trunc('month', current_date)::date; v jsonb;
begin
  if public.has_permission(p_company, 'sales.view_prices') then
    select jsonb_build_object(
      'sales_month', coalesce(sum(total_amount) filter (where invoice_date >= m0), 0),
      'sales_prev_month', coalesce(sum(total_amount) filter (where invoice_date >= (m0 - interval '1 month')::date and invoice_date < m0), 0),
      'invoices_month', count(*) filter (where invoice_date >= m0),
      'overdue_receivable', coalesce(sum(outstanding) filter (where coalesce(due_date, invoice_date) < current_date), 0),
      'overdue_invoices', count(*) filter (where outstanding > 0 and coalesce(due_date, invoice_date) < current_date))
    into v from public.sales_invoices_v where company_id = p_company and status = 'POSTED';
    r := r || v;
    select jsonb_agg(jsonb_build_object('month', to_char(mm, 'YYYY-MM'), 'amount', coalesce(s.amt, 0)) order by mm) into v
    from generate_series((m0 - interval '11 months')::date, m0, interval '1 month') mm
    left join (select date_trunc('month', invoice_date) mo, sum(total_amount) amt from public.sales_invoices
               where company_id = p_company and status = 'POSTED' and invoice_date >= (m0 - interval '11 months')::date group by 1) s on s.mo = mm;
    r := r || jsonb_build_object('sales_by_month', v);
    select jsonb_agg(x) into v from (select customer_name as name, sum(total_amount) as amount from public.sales_invoices_v
      where company_id = p_company and status = 'POSTED' and invoice_date >= m0 group by customer_name order by 2 desc limit 5) x;
    r := r || jsonb_build_object('top_customers', coalesce(v, '[]'::jsonb));
  end if;
  if public.has_permission(p_company, 'journals.view') then
    r := r || jsonb_build_object(
      'receivables', (select coalesce(sum(balance) filter (where balance > 0), 0) from public.party_balances(p_company, 'CUSTOMER', null)),
      'payables', (select coalesce(sum(balance) filter (where balance > 0), 0) from public.party_balances(p_company, 'SUPPLIER', null)),
      'cash_bank', (select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.bank_accounts b on b.id = jl.bank_account_id where b.company_id = p_company),
      'pdc_due_count', (select count(*) from public.pdc_records where company_id = p_company and status = 'HELD' and cheque_date <= current_date),
      'pdc_due_amount', (select coalesce(sum(amount), 0) from public.pdc_records where company_id = p_company and status = 'HELD' and cheque_date <= current_date and direction = 'RECEIVED'),
      'pdc_week_amount', (select coalesce(sum(amount), 0) from public.pdc_records where company_id = p_company and status in ('HELD','DEPOSITED') and direction = 'RECEIVED'
                            and cheque_date > current_date and cheque_date <= current_date + 7),
      'pdc_bounced', (select count(*) from public.pdc_records where company_id = p_company and status = 'BOUNCED'),
      'bank_unmatched', (select count(*) from public.bank_statement_lines where company_id = p_company and status = 'UNMATCHED'),
      'profit_month', (select coalesce(sum(case when a.account_type = 'INCOME' then jl.credit - jl.debit else jl.debit - jl.credit end * case when a.account_type = 'INCOME' then 1 else -1 end), 0)
                       from public.journal_lines jl join public.chart_of_accounts a on a.id = jl.account_id and a.account_type in ('INCOME','EXPENSE')
                       where jl.company_id = p_company and jl.entry_date >= m0));
  end if;
  if public.has_permission(p_company, 'inventory.view') then
    r := r || jsonb_build_object(
      'low_stock', (select count(distinct product_id) from public.rpt_stock_summary(p_company, null, null) where below_reorder),
      'pending_picking', (select count(*) from public.picking_tasks where company_id = p_company and status in ('OPEN','IN_PROGRESS')));
  end if;
  if public.has_permission(p_company, 'inventory.valuation') then
    r := r || jsonb_build_object('stock_value', (select coalesce(sum(value), 0) from public.item_costs where company_id = p_company));
  end if;
  if public.has_permission(p_company, 'sales.view') then
    r := r || jsonb_build_object('open_orders', (select count(*) from public.sales_orders where company_id = p_company and status in ('APPROVED','PARTIALLY_DELIVERED')),
      'orders_to_approve', (select count(*) from public.sales_orders where company_id = p_company and status = 'DRAFT'));
  end if;
  if public.has_permission(p_company, 'purchasing.view') then
    r := r || jsonb_build_object('late_shipments', (select count(*) from public.shipments where company_id = p_company and ata is null and eta < current_date and status not in ('DELIVERED','CANCELLED')),
      'shipments_in_transit', (select count(*) from public.shipments where company_id = p_company and status not in ('DELIVERED','CANCELLED','BOOKED')));
  end if;
  return r;
end $$;
grant execute on function public.rpt_dashboard(uuid) to authenticated;

-- ---------------------------------------------------------------- saved reports (report builder views)
create table if not exists public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  report_code text not null check (report_code ~ '^[a-z0-9_]{2,60}$'),
  name        text not null,
  params      jsonb not null default '{}'::jsonb,
  layout      jsonb not null default '{}'::jsonb,     -- columns, group_by, sort, filters
  is_shared   boolean not null default false,
  owner_id    uuid not null default auth.uid(),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists saved_reports_idx on public.saved_reports(company_id, report_code);
create trigger stamp before insert or update on public.saved_reports for each row execute function public.tg_stamp_row();
alter table public.saved_reports enable row level security;
create policy sr_select on public.saved_reports for select to authenticated
  using (public.is_company_member(company_id) and (owner_id = auth.uid() or is_shared));
create policy sr_insert on public.saved_reports for insert to authenticated
  with check (public.is_company_member(company_id) and owner_id = auth.uid() and (not is_shared or public.has_permission(company_id, 'settings.manage')));
create policy sr_update on public.saved_reports for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and (not is_shared or public.has_permission(company_id, 'settings.manage')));
create policy sr_delete on public.saved_reports for delete to authenticated using (owner_id = auth.uid());
grant select, insert, update, delete on public.saved_reports to authenticated;

-- ---------------------------------------------------------------- contextual report shortcuts (§20.1)
-- Controlled registries: voucher types, contexts, view modes and placements are fixed lists; a shortcut
-- only names a report code from the app's report registry and maps context keys to that report's
-- declared parameters — never SQL.
create table if not exists public.report_shortcuts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  report_code         text not null check (report_code ~ '^[a-z0-9_]{2,60}$'),
  voucher_type        text not null check (voucher_type in ('SALES_INVOICE','SALES_ORDER','QUOTATION','GDN','SUPPLIER_BILL','PURCHASE_ORDER','GOODS_RECEIPT',
                                                             'BANK_RECEIPT','BANK_PAYMENT','JOURNAL','PDC','CUSTOMER','SUPPLIER','PRODUCT')),
  context_type        text not null check (context_type in ('CUSTOMER','SUPPLIER','PRODUCT','BANK_ACCOUNT','PARTY','VOUCHER')),
  label               text not null,
  view_mode           text not null default 'QUICK_VIEW' check (view_mode in ('QUICK_VIEW','FULL_REPORT')),
  parameter_mapping   jsonb not null default '{}'::jsonb,
  placement           text not null default 'HEADER' check (placement in ('HEADER','CUSTOMER','PRODUCT','LINE','ACTIONS','MORE')),
  sort_order          int not null default 0,
  enabled             boolean not null default true,
  required_permission text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists rs_lookup_idx on public.report_shortcuts(company_id, voucher_type, enabled, sort_order);
create trigger stamp before insert or update on public.report_shortcuts for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.report_shortcuts for each row execute function public.tg_audit_row();
alter table public.report_shortcuts enable row level security;
create policy rs_select on public.report_shortcuts for select to authenticated using (public.is_company_member(company_id));
create policy rs_write on public.report_shortcuts for all to authenticated
  using (public.has_permission(company_id, 'settings.manage')) with check (public.has_permission(company_id, 'settings.manage'));
grant select, insert, update, delete on public.report_shortcuts to authenticated;

insert into public.report_shortcuts(company_id, report_code, voucher_type, context_type, label, view_mode, parameter_mapping, sort_order, required_permission)
select c.id, x.code, x.vt, x.ct, x.label, x.vm, x.pm::jsonb, x.so, x.perm
from public.companies c cross join (values
  ('customer_ledger','SALES_INVOICE','CUSTOMER','Customer ledger','QUICK_VIEW','{"party":"CUSTOMER"}',1,'journals.view'),
  ('customer_open_invoices','SALES_INVOICE','CUSTOMER','Open invoices','QUICK_VIEW','{"party":"CUSTOMER"}',2,'sales.view_prices'),
  ('sales_register','SALES_INVOICE','CUSTOMER','Recent invoices','QUICK_VIEW','{"customer":"CUSTOMER"}',3,'sales.view_prices'),
  ('sales_by_item','SALES_INVOICE','CUSTOMER','What they buy','FULL_REPORT','{"customer":"CUSTOMER"}',4,'sales.view_prices'),
  ('customer_ledger','SALES_ORDER','CUSTOMER','Customer ledger','QUICK_VIEW','{"party":"CUSTOMER"}',1,'journals.view'),
  ('customer_open_invoices','SALES_ORDER','CUSTOMER','Open invoices','QUICK_VIEW','{"party":"CUSTOMER"}',2,'sales.view_prices'),
  ('pending_orders','SALES_ORDER','CUSTOMER','Other open orders','QUICK_VIEW','{"customer":"CUSTOMER"}',3,'sales.view'),
  ('customer_ledger','QUOTATION','CUSTOMER','Customer ledger','QUICK_VIEW','{"party":"CUSTOMER"}',1,'journals.view'),
  ('sales_by_item','QUOTATION','CUSTOMER','What they buy','QUICK_VIEW','{"customer":"CUSTOMER"}',2,'sales.view_prices'),
  ('supplier_ledger','SUPPLIER_BILL','SUPPLIER','Supplier ledger','QUICK_VIEW','{"party":"SUPPLIER"}',1,'journals.view'),
  ('supplier_open_bills','SUPPLIER_BILL','SUPPLIER','Open bills','QUICK_VIEW','{"party":"SUPPLIER"}',2,'purchasing.costs'),
  ('purchase_register','SUPPLIER_BILL','SUPPLIER','Recent bills','QUICK_VIEW','{"supplier":"SUPPLIER"}',3,'purchasing.costs'),
  ('purchases_by_item','SUPPLIER_BILL','SUPPLIER','Items bought','FULL_REPORT','{"supplier":"SUPPLIER"}',4,'purchasing.costs'),
  ('supplier_ledger','PURCHASE_ORDER','SUPPLIER','Supplier ledger','QUICK_VIEW','{"party":"SUPPLIER"}',1,'journals.view'),
  ('purchases_by_item','PURCHASE_ORDER','SUPPLIER','Items bought','QUICK_VIEW','{"supplier":"SUPPLIER"}',2,'purchasing.costs'),
  ('bank_book','BANK_RECEIPT','BANK_ACCOUNT','Bank ledger','QUICK_VIEW','{"bank":"BANK_ACCOUNT"}',1,'journals.view'),
  ('uncleared_items','BANK_RECEIPT','BANK_ACCOUNT','Unreconciled items','QUICK_VIEW','{"bank":"BANK_ACCOUNT"}',2,'journals.view'),
  ('party_ledger','BANK_RECEIPT','PARTY','Party ledger','QUICK_VIEW','{"party":"PARTY"}',3,'journals.view'),
  ('bank_book','BANK_PAYMENT','BANK_ACCOUNT','Bank ledger','QUICK_VIEW','{"bank":"BANK_ACCOUNT"}',1,'journals.view'),
  ('uncleared_items','BANK_PAYMENT','BANK_ACCOUNT','Unreconciled items','QUICK_VIEW','{"bank":"BANK_ACCOUNT"}',2,'journals.view'),
  ('party_ledger','BANK_PAYMENT','PARTY','Party ledger','QUICK_VIEW','{"party":"PARTY"}',3,'journals.view'),
  ('party_ledger','PDC','PARTY','Party ledger','QUICK_VIEW','{"party":"PARTY"}',1,'journals.view'),
  ('pdc_register','PDC','PARTY','Previous cheques','QUICK_VIEW','{"party":"PARTY"}',2,'journals.view')
) as x(code, vt, ct, label, vm, pm, so, perm)
where not exists (select 1 from public.report_shortcuts r where r.company_id = c.id);
