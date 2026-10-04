-- Stage 8 (part 2) — import shipments (containers, B/L, tracking, documents) and receiving them

insert into public.numbering_sequences(company_id, doc_type, prefix)
select c.id, x.t, x.p from public.companies c cross join (values ('SHIPMENT','SHP-'), ('LANDED_COST','LC-')) x(t, p)
where not exists (select 1 from public.numbering_sequences s where s.company_id = c.id and s.doc_type = x.t);

-- ───────── shipments ─────────
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  supplier_id uuid not null references public.suppliers(id),
  forwarder_id uuid references public.suppliers(id),
  mode text not null default 'SEA' check (mode in ('SEA','AIR','ROAD','RAIL','COURIER')),
  bl_no text, vessel text, voyage text,
  port_loading text, port_discharge text, origin_country text, destination text, incoterm text,
  etd date, eta date, atd date, ata date,
  status text not null default 'BOOKED' check (status in ('BOOKED','LOADED','DEPARTED','TRANSSHIPMENT','ARRIVED_PORT','CUSTOMS','RELEASED','DELIVERED','CANCELLED')),
  invoice_no text, invoice_date date,
  currency text not null default 'PKR', fx_rate numeric not null default 1 check (fx_rate > 0),
  gd_no text,                             -- goods declaration (customs) number
  notes text,
  cancel_reason text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists shp_company on public.shipments(company_id, status, eta);
alter table public.shipments enable row level security;
create policy shp_select on public.shipments for select to authenticated using (public.has_permission(company_id, 'purchasing.view'));

create table if not exists public.shipment_containers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  shipment_id uuid not null references public.shipments(id),
  container_no text not null,
  size_type text,                         -- 20GP / 40GP / 40HQ / LCL …
  seal_no text,
  packages int,
  gross_weight_kg numeric,
  cbm numeric,
  notes text,
  is_active boolean not null default true
);
create index if not exists shpc_shipment on public.shipment_containers(shipment_id);
alter table public.shipment_containers enable row level security;
create policy shpc_select on public.shipment_containers for select to authenticated using (public.has_permission(company_id, 'purchasing.view'));

create table if not exists public.shipment_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  shipment_id uuid not null references public.shipments(id),
  line_no int not null,
  po_line_id uuid references public.purchase_order_lines(id),
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  quantity numeric not null check (quantity > 0),
  received_qty numeric not null default 0,
  container_id uuid references public.shipment_containers(id),
  packages int,
  weight_kg numeric,                      -- whole line
  cbm numeric,                            -- whole line
  unit_price numeric check (unit_price is null or unit_price >= 0),   -- commercial invoice price (shipment currency)
  notes text,
  is_active boolean not null default true
);
create index if not exists shpl_shipment on public.shipment_lines(shipment_id);
create index if not exists shpl_po_line on public.shipment_lines(po_line_id);
alter table public.shipment_lines enable row level security;
create policy shpl_select on public.shipment_lines for select to authenticated using (public.has_permission(company_id, 'purchasing.view'));
revoke select on public.shipment_lines from authenticated, anon;
grant select (id, company_id, shipment_id, line_no, po_line_id, product_id, variant_id, quantity, received_qty, container_id, packages, weight_kg, cbm, notes, is_active)
  on public.shipment_lines to authenticated;

create table if not exists public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  shipment_id uuid not null references public.shipments(id),
  status text not null,
  event_date date not null default current_date,
  location text,
  note text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index if not exists shpe_shipment on public.shipment_events(shipment_id, event_date);
alter table public.shipment_events enable row level security;
create policy shpe_select on public.shipment_events for select to authenticated using (public.has_permission(company_id, 'purchasing.view'));

alter table public.goods_receipts add column if not exists shipment_id uuid references public.shipments(id);
alter table public.goods_receipt_lines add column if not exists landed_cost_pkr numeric not null default 0;
grant select (landed_cost_pkr) on public.goods_receipt_lines to authenticated;

create table if not exists public.goods_receipt_shipment_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  receipt_id uuid not null references public.goods_receipts(id),
  receipt_line_id uuid not null references public.goods_receipt_lines(id),
  shipment_line_id uuid not null references public.shipment_lines(id),
  quantity numeric not null check (quantity > 0),
  po_linked boolean not null default false,
  reversed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists grsl_shipment_line on public.goods_receipt_shipment_links(shipment_line_id);
alter table public.goods_receipt_shipment_links enable row level security;
create policy grsl_select on public.goods_receipt_shipment_links for select to authenticated using (public.has_permission(company_id, 'purchasing.view') or public.has_permission(company_id, 'inventory.view'));

create trigger audit after insert or update on public.shipments for each row execute function public.tg_audit_row();
create trigger stamp before insert or update on public.shipments for each row execute function public.tg_stamp_row();

alter publication supabase_realtime add table public.shipments;

-- ───────── shipment RPCs ─────────
create or replace function public.shipment_line_prices(p_shipment_id uuid)
returns table(line_id uuid, unit_price numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.shipments where id = p_shipment_id;
  if v_company is null or not public.has_permission(v_company, 'purchasing.costs') then return; end if;
  return query select l.id, l.unit_price from public.shipment_lines l where l.shipment_id = p_shipment_id and l.is_active;
end $$;

-- open purchase-order lines that can go on a shipment (ordered − received − already on other open shipments)
create or replace function public.shipment_po_lines(p_company uuid, p_po_ids uuid[], p_exclude_shipment uuid default null)
returns table(po_line_id uuid, purchase_order_id uuid, po_no text, product_id uuid, variant_id uuid, product_name text, variant_name text,
  open_qty numeric, unit_price numeric, currency text, weight_kg numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_costs boolean;
begin
  perform public.inv_require(p_company, 'purchasing.view');
  v_costs := public.has_permission(p_company, 'purchasing.costs');
  return query
  select pl.id, po.id, po.doc_no, pl.product_id, pl.variant_id, p.name, v.name,
    pl.quantity - pl.received_qty - coalesce((select sum(sl.quantity - sl.received_qty) from public.shipment_lines sl join public.shipments s on s.id = sl.shipment_id
        where sl.po_line_id = pl.id and sl.is_active and s.status not in ('DELIVERED','CANCELLED') and s.id is distinct from p_exclude_shipment), 0),
    case when v_costs then pl.unit_price end, po.currency,
    coalesce(v.weight_kg, p.weight_kg)
  from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
  join public.products p on p.id = pl.product_id left join public.product_variants v on v.id = pl.variant_id
  where po.company_id = p_company and po.id = any(p_po_ids) and pl.is_active and po.status in ('APPROVED','PARTIALLY_RECEIVED')
  order by po.doc_no, pl.line_no;
end $$;

-- p_header: {company_id, supplier_id, forwarder_id, mode, bl_no, vessel, voyage, port_loading, port_discharge, origin_country, destination, incoterm,
--            etd, eta, invoice_no, invoice_date, currency, fx_rate, gd_no, notes}
-- p_containers: [{id?, key, container_no, size_type, seal_no, packages, gross_weight_kg, cbm, notes}]
-- p_lines: [{id?, po_line_id?, product_id, variant_id, quantity, container (id or key), packages, weight_kg, cbm, unit_price, notes}]
create or replace function public.save_shipment(p_id uuid, p_header jsonb, p_lines jsonb, p_containers jsonb default '[]'::jsonb, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_id uuid; h record; v_sup uuid := nullif(p_header->>'supplier_id','')::uuid;
  x jsonb; n int := 0; v_line uuid; v_keep uuid[] := '{}'; v_ckeep uuid[] := '{}'; v_map jsonb := '{}'::jsonb; v_cid uuid; v_price numeric; v_costs boolean; v_old record;
  v_cur text := coalesce(nullif(upper(trim(p_header->>'currency')),''), 'PKR'); v_fx numeric := coalesce(nullif(p_header->>'fx_rate','')::numeric, 1);
begin
  perform public.inv_require(v_company, 'purchasing.manage');
  v_costs := public.has_permission(v_company, 'purchasing.costs');
  if v_sup is null or not exists (select 1 from public.suppliers where id = v_sup and company_id = v_company) then raise exception 'Choose the supplier' using errcode = '23502'; end if;
  if v_cur = 'PKR' then v_fx := 1; end if;
  if v_fx <= 0 then raise exception 'Exchange rate must be above zero' using errcode = '23514'; end if;
  if nullif(p_header->>'etd','') is not null and nullif(p_header->>'eta','') is not null and (p_header->>'eta')::date < (p_header->>'etd')::date then
    raise exception 'ETA cannot be before ETD' using errcode = '23514';
  end if;
  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.shipments where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.shipments(company_id, doc_no, supplier_id, idempotency_key, currency, fx_rate)
    values (v_company, public.next_document_number(v_company, 'SHIPMENT'), v_sup, p_idempotency_key, v_cur, v_fx) returning id into v_id;
    insert into public.shipment_events(company_id, shipment_id, status, event_date, note) values (v_company, v_id, 'BOOKED', current_date, 'Shipment created');
  else
    select * into h from public.shipments where id = p_id and company_id = v_company for update;
    if h.id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
    if h.status = 'CANCELLED' then raise exception 'This shipment is cancelled' using errcode = '22023'; end if;
    v_id := p_id;
  end if;
  update public.shipments set supplier_id = v_sup, forwarder_id = nullif(p_header->>'forwarder_id','')::uuid,
    mode = coalesce(nullif(p_header->>'mode',''), 'SEA'), bl_no = nullif(trim(p_header->>'bl_no'),''), vessel = nullif(trim(p_header->>'vessel'),''),
    voyage = nullif(trim(p_header->>'voyage'),''), port_loading = nullif(trim(p_header->>'port_loading'),''), port_discharge = nullif(trim(p_header->>'port_discharge'),''),
    origin_country = nullif(trim(p_header->>'origin_country'),''), destination = nullif(trim(p_header->>'destination'),''), incoterm = nullif(trim(p_header->>'incoterm'),''),
    etd = nullif(p_header->>'etd','')::date, eta = nullif(p_header->>'eta','')::date,
    invoice_no = nullif(trim(p_header->>'invoice_no'),''), invoice_date = nullif(p_header->>'invoice_date','')::date,
    currency = case when v_costs then v_cur else currency end, fx_rate = case when v_costs then v_fx else fx_rate end,
    gd_no = nullif(trim(p_header->>'gd_no'),''), notes = nullif(trim(p_header->>'notes'),''), updated_at = now(), updated_by = auth.uid()
  where id = v_id;

  -- containers
  for x in select * from jsonb_array_elements(coalesce(p_containers, '[]'::jsonb)) loop
    if nullif(trim(x->>'container_no'),'') is null then raise exception 'Every container needs its number' using errcode = '23502'; end if;
    v_cid := nullif(x->>'id','')::uuid;
    if v_cid is not null and exists (select 1 from public.shipment_containers where id = v_cid and shipment_id = v_id) then
      update public.shipment_containers set container_no = upper(trim(x->>'container_no')), size_type = nullif(trim(x->>'size_type'),''), seal_no = nullif(trim(x->>'seal_no'),''),
        packages = nullif(x->>'packages','')::int, gross_weight_kg = nullif(x->>'gross_weight_kg','')::numeric, cbm = nullif(x->>'cbm','')::numeric,
        notes = nullif(trim(x->>'notes'),''), is_active = true where id = v_cid;
    else
      insert into public.shipment_containers(company_id, shipment_id, container_no, size_type, seal_no, packages, gross_weight_kg, cbm, notes)
      values (v_company, v_id, upper(trim(x->>'container_no')), nullif(trim(x->>'size_type'),''), nullif(trim(x->>'seal_no'),''), nullif(x->>'packages','')::int,
        nullif(x->>'gross_weight_kg','')::numeric, nullif(x->>'cbm','')::numeric, nullif(trim(x->>'notes'),'')) returning id into v_cid;
    end if;
    v_ckeep := v_ckeep || v_cid;
    if nullif(x->>'key','') is not null then v_map := v_map || jsonb_build_object(x->>'key', v_cid); end if;
    v_map := v_map || jsonb_build_object(v_cid::text, v_cid);
  end loop;
  update public.shipment_containers set is_active = false where shipment_id = v_id and is_active and not (id = any(v_ckeep));

  -- items
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if coalesce(nullif(x->>'quantity','')::numeric, 0) <= 0 then raise exception 'Line %: enter the quantity', n using errcode = '23502'; end if;
    if not exists (select 1 from public.products where id = nullif(x->>'product_id','')::uuid and company_id = v_company) then raise exception 'Line %: choose the item', n using errcode = '23502'; end if;
    if nullif(x->>'po_line_id','') is not null and not exists (
      select 1 from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
      where pl.id = (x->>'po_line_id')::uuid and po.company_id = v_company and po.supplier_id = v_sup) then
      raise exception 'Line %: the purchase order line is for another supplier', n using errcode = '22023';
    end if;
    v_cid := nullif(v_map->>(x->>'container'), '')::uuid;
    v_line := nullif(x->>'id','')::uuid;
    v_price := nullif(x->>'unit_price','')::numeric;
    if v_line is not null and exists (select 1 from public.shipment_lines where id = v_line and shipment_id = v_id and is_active) then
      select * into v_old from public.shipment_lines where id = v_line;
      if (x->>'quantity')::numeric < v_old.received_qty then raise exception 'Line %: % already received — the quantity cannot be less', n, v_old.received_qty using errcode = '23514'; end if;
      if v_old.received_qty > 0 and ((x->>'product_id')::uuid <> v_old.product_id or nullif(x->>'variant_id','')::uuid is distinct from v_old.variant_id) then
        raise exception 'Line %: already received — the item cannot change', n using errcode = '22023';
      end if;
      update public.shipment_lines set line_no = n, po_line_id = nullif(x->>'po_line_id','')::uuid, product_id = (x->>'product_id')::uuid, variant_id = nullif(x->>'variant_id','')::uuid,
        quantity = (x->>'quantity')::numeric, container_id = v_cid, packages = nullif(x->>'packages','')::int, weight_kg = nullif(x->>'weight_kg','')::numeric,
        cbm = nullif(x->>'cbm','')::numeric, unit_price = case when v_costs then v_price else unit_price end, notes = nullif(trim(x->>'notes'),'')
      where id = v_line;
    else
      insert into public.shipment_lines(company_id, shipment_id, line_no, po_line_id, product_id, variant_id, quantity, container_id, packages, weight_kg, cbm, unit_price, notes)
      values (v_company, v_id, n, nullif(x->>'po_line_id','')::uuid, (x->>'product_id')::uuid, nullif(x->>'variant_id','')::uuid, (x->>'quantity')::numeric, v_cid,
        nullif(x->>'packages','')::int, nullif(x->>'weight_kg','')::numeric, nullif(x->>'cbm','')::numeric, case when v_costs then v_price end, nullif(trim(x->>'notes'),''))
      returning id into v_line;
    end if;
    v_keep := v_keep || v_line;
  end loop;
  if exists (select 1 from public.shipment_lines where shipment_id = v_id and is_active and not (id = any(v_keep)) and received_qty > 0) then
    raise exception 'An item that was already received cannot be removed' using errcode = '22023';
  end if;
  update public.shipment_lines set is_active = false where shipment_id = v_id and is_active and not (id = any(v_keep));
  return v_id;
end $$;

create or replace function public.set_shipment_status(p_id uuid, p_status text, p_date date default null, p_location text default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.shipments; d date := coalesce(p_date, current_date);
begin
  select * into h from public.shipments where id = p_id for update;
  if h.id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.manage');
  if p_status not in ('BOOKED','LOADED','DEPARTED','TRANSSHIPMENT','ARRIVED_PORT','CUSTOMS','RELEASED','DELIVERED','CANCELLED') then
    raise exception 'Unknown status %', p_status using errcode = '22023';
  end if;
  if h.status = 'CANCELLED' then raise exception 'This shipment is cancelled' using errcode = '22023'; end if;
  if p_status = 'CANCELLED' then
    if exists (select 1 from public.shipment_lines where shipment_id = p_id and is_active and received_qty > 0) then
      raise exception 'Goods from this shipment were already received — it cannot be cancelled' using errcode = '22023';
    end if;
    if nullif(trim(p_note),'') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  end if;
  update public.shipments set status = p_status,
    atd = case when p_status = 'DEPARTED' then coalesce(atd, d) else atd end,
    ata = case when p_status = 'ARRIVED_PORT' then coalesce(ata, d) else ata end,
    cancel_reason = case when p_status = 'CANCELLED' then trim(p_note) else cancel_reason end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  insert into public.shipment_events(company_id, shipment_id, status, event_date, location, note)
  values (h.company_id, p_id, p_status, d, nullif(trim(p_location),''), nullif(trim(p_note),''));
end $$;

-- a note on the tracking timeline without changing the status (e.g. "vessel delayed 3 days")
create or replace function public.add_shipment_note(p_id uuid, p_date date, p_location text, p_note text, p_new_eta date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.shipments;
begin
  select * into h from public.shipments where id = p_id for update;
  if h.id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'purchasing.manage');
  if nullif(trim(p_note),'') is null and p_new_eta is null then raise exception 'Write the note' using errcode = '23502'; end if;
  if p_new_eta is not null then update public.shipments set eta = p_new_eta, updated_at = now() where id = p_id; end if;
  insert into public.shipment_events(company_id, shipment_id, status, event_date, location, note)
  values (h.company_id, p_id, h.status, coalesce(p_date, current_date), nullif(trim(p_location),''),
    concat_ws(' · ', nullif(trim(p_note),''), case when p_new_eta is not null then 'ETA now ' || to_char(p_new_eta, 'DD Mon YYYY') end));
end $$;

-- make a draft goods receipt for what arrived. p_lines: [{shipment_line_id, quantity, location_id}] (empty: everything still to come)
create or replace function public.receive_shipment(p_id uuid, p_warehouse_id uuid, p_date date default null, p_lines jsonb default null, p_reference text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h public.shipments; l record; x jsonb; q numeric; v_lines jsonb := '[]'::jsonb; v_id uuid;
begin
  select * into h from public.shipments where id = p_id;
  if h.id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.receive');
  if h.status = 'CANCELLED' then raise exception 'This shipment is cancelled' using errcode = '22023'; end if;
  for l in select * from public.shipment_lines where shipment_id = p_id and is_active order by line_no loop
    if p_lines is not null and jsonb_array_length(p_lines) > 0 then
      select y into x from jsonb_array_elements(p_lines) y where (y->>'shipment_line_id')::uuid = l.id;
      if x is null then continue; end if;
      q := coalesce(nullif(x->>'quantity','')::numeric, 0);
    else
      x := null; q := l.quantity - l.received_qty;
    end if;
    if q <= 0 then continue; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', l.product_id, 'variant_id', l.variant_id, 'location_id', nullif(x->>'location_id',''), 'quantity', q, 'notes', null));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Nothing left to receive on this shipment' using errcode = '22023'; end if;
  v_id := public.save_goods_receipt(null, jsonb_build_object('company_id', h.company_id, 'warehouse_id', p_warehouse_id, 'doc_date', coalesce(p_date, current_date),
    'supplier_id', h.supplier_id, 'supplier_reference', coalesce(nullif(trim(p_reference),''), h.bl_no, h.invoice_no), 'notes', 'Shipment ' || h.doc_no), v_lines, null);
  update public.goods_receipts set shipment_id = h.id where id = v_id;
  return v_id;
end $$;

-- receipt posted / reversed: shipment received quantities, purchase-order links for shipment receipts
create or replace function public.tg_receipt_shipment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record; s record; v_left numeric; v_take numeric; k record; v_pos uuid[] := '{}'; p uuid; v_all boolean;
begin
  if new.status = 'REVERSED' and old.status = 'POSTED' then
    if exists (select 1 from public.goods_receipt_lines where receipt_id = new.id and landed_cost_pkr <> 0) then
      raise exception 'Landed cost was added to this receipt — reverse the landed cost first' using errcode = '22023';
    end if;
  end if;
  if new.shipment_id is null then return null; end if;
  if new.status = 'POSTED' and old.status = 'DRAFT' then
    for l in select * from public.goods_receipt_lines where receipt_id = new.id order by line_no loop
      v_left := l.quantity;
      for s in select * from public.shipment_lines where shipment_id = new.shipment_id and is_active and product_id = l.product_id
                 and variant_id is not distinct from l.variant_id and received_qty < quantity order by line_no for update loop
        exit when v_left <= 0;
        v_take := least(v_left, s.quantity - s.received_qty);
        update public.shipment_lines set received_qty = received_qty + v_take where id = s.id;
        insert into public.goods_receipt_shipment_links(company_id, receipt_id, receipt_line_id, shipment_line_id, quantity, po_linked)
        values (new.company_id, new.id, l.id, s.id, v_take, new.purchase_order_id is null and s.po_line_id is not null);
        if new.purchase_order_id is null and s.po_line_id is not null then
          update public.purchase_order_lines set received_qty = received_qty + v_take where id = s.po_line_id;
          insert into public.goods_receipt_po_links(company_id, receipt_id, receipt_line_id, po_line_id, quantity) values (new.company_id, new.id, l.id, s.po_line_id, v_take);
          v_pos := v_pos || (select purchase_order_id from public.purchase_order_lines where id = s.po_line_id);
        end if;
        v_left := v_left - v_take;
      end loop;
    end loop;
    foreach p in array coalesce((select array_agg(distinct u) from unnest(v_pos) u), '{}'::uuid[]) loop perform public.po_refresh_status(p); end loop;
    select bool_and(received_qty >= quantity) into v_all from public.shipment_lines where shipment_id = new.shipment_id and is_active;
    if v_all and (select status from public.shipments where id = new.shipment_id) <> 'DELIVERED' then
      update public.shipments set status = 'DELIVERED', updated_at = now() where id = new.shipment_id;
      insert into public.shipment_events(company_id, shipment_id, status, event_date, note) values (new.company_id, new.shipment_id, 'DELIVERED', new.doc_date, 'All goods received (' || new.doc_no || ')');
    end if;
  elsif new.status = 'REVERSED' and old.status = 'POSTED' then
    for k in select * from public.goods_receipt_shipment_links where receipt_id = new.id and not reversed loop
      update public.shipment_lines set received_qty = greatest(received_qty - k.quantity, 0) where id = k.shipment_line_id;
      update public.goods_receipt_shipment_links set reversed = true where id = k.id;
      if k.po_linked then
        v_pos := v_pos || (select pl.purchase_order_id from public.shipment_lines sl join public.purchase_order_lines pl on pl.id = sl.po_line_id where sl.id = k.shipment_line_id);
      end if;
    end loop;
    -- PO quantities were taken back by receipt_po (it undoes every PO link of the receipt); refresh the orders' status
    foreach p in array coalesce((select array_agg(distinct u) from unnest(v_pos) u), '{}'::uuid[]) loop perform public.po_refresh_status(p); end loop;
    update public.shipments set status = 'RELEASED', updated_at = now() where id = new.shipment_id and status = 'DELIVERED';
  end if;
  return null;
end $$;
create trigger receipt_shipment after update of status on public.goods_receipts for each row execute function public.tg_receipt_shipment();

revoke all on function public.save_shipment(uuid,jsonb,jsonb,jsonb,uuid), public.set_shipment_status(uuid,text,date,text,text), public.add_shipment_note(uuid,date,text,text,date),
  public.receive_shipment(uuid,uuid,date,jsonb,text), public.shipment_line_prices(uuid), public.shipment_po_lines(uuid,uuid[],uuid) from anon;
