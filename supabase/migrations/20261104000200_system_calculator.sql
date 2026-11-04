-- System stock calculator (Branch Feeding Line first, then Drinking Line / Main Feeding Line).
-- A calculator template = input variables (farm length, number of lines, feed room …) + item rules (formula per item).
-- The calculator fills a sales order with one PACKAGE ("Branch Feeding Line × 4 lines") and the item lines behind it.
-- The items are ordinary order lines (reserve / pick / rolls / GDN / stock unchanged); the package only groups them,
-- carries a package discount, and lets customer documents (invoice) print "lines × price per line" instead of items.

-- ---------------------------------------------------------------- templates
create table if not exists public.calc_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  code        text not null,
  name        text not null,                         -- printed as the package name, e.g. "Branch Feeding Line"
  description text,
  unit_label  text not null default 'line',          -- what the customer buys: 4 "lines"
  qty_var     text not null default 'N',             -- the variable that holds the number of units
  variables   jsonb not null default '[]'::jsonb,    -- [{key,label,type:number|choice,default,options[],step,formula,hint}]
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, code)
);

create table if not exists public.calc_template_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  template_id   uuid not null references public.calc_templates(id) on delete cascade,
  line_no       int not null,
  product_id    uuid not null references public.products(id),
  variant_id    uuid references public.product_variants(id),
  formula       text not null,                       -- e.g. "ceil(L/8)*N", "ROOM=='Centre' ? N : 0"
  note          text,                                -- the rule in words, shown next to the quantity
  default_price numeric(18,2) check (default_price is null or default_price >= 0),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (template_id, line_no)
);
create index if not exists calc_template_items_tpl_idx on public.calc_template_items(template_id);

alter table public.calc_templates enable row level security;
alter table public.calc_template_items enable row level security;
drop policy if exists ct_select on public.calc_templates;
drop policy if exists cti_select on public.calc_template_items;
create policy ct_select on public.calc_templates for select using (public.is_company_member(company_id));
create policy cti_select on public.calc_template_items for select using (public.is_company_member(company_id));
-- default prices are selling prices: only through calc_template_prices() for users who may see prices
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'calc_template_items' and column_name <> 'default_price';
  execute 'revoke select on public.calc_template_items from authenticated, anon';
  execute format('grant select (%s) on public.calc_template_items to authenticated', v_cols);
end $$;
grant select on public.calc_templates to authenticated;

drop trigger if exists audit on public.calc_templates;
drop trigger if exists audit on public.calc_template_items;
create trigger audit after insert or update or delete on public.calc_templates for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.calc_template_items for each row execute function public.tg_audit_row();

create or replace function public.calc_template_prices(p_template_id uuid)
returns table (item_id uuid, default_price numeric)
language sql stable security definer set search_path = '' as $$
  select i.id, i.default_price from public.calc_template_items i
   where i.template_id = p_template_id
     and public.has_permission(i.company_id, 'sales.view_prices');
$$;
revoke execute on function public.calc_template_prices(uuid) from public, anon;
grant execute on function public.calc_template_prices(uuid) to authenticated;

-- "Remember these prices": p_prices = [{product_id, variant_id, price}] → default price of matching template items
create or replace function public.set_calc_template_prices(p_template_id uuid, p_prices jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare t record; x jsonb; n int := 0; c int;
begin
  select * into t from public.calc_templates where id = p_template_id;
  if t.id is null then raise exception 'Calculator not found' using errcode = 'P0002'; end if;
  perform public.inv_require(t.company_id, 'sales.manage');
  perform public.inv_require(t.company_id, 'sales.view_prices');
  for x in select * from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) loop
    if nullif(x->>'price','') is not null and (x->>'price')::numeric < 0 then raise exception 'Prices cannot be negative' using errcode = '23514'; end if;
    update public.calc_template_items
       set default_price = round(nullif(x->>'price','')::numeric, 2), updated_at = now(), updated_by = auth.uid()
     where template_id = p_template_id and product_id = (x->>'product_id')::uuid
       and variant_id is not distinct from nullif(x->>'variant_id','')::uuid
       and default_price is distinct from round(nullif(x->>'price','')::numeric, 2);
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke execute on function public.set_calc_template_prices(uuid, jsonb) from public, anon;
grant execute on function public.set_calc_template_prices(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- packages on sales orders
create table if not exists public.sales_order_packages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  sales_order_id  uuid not null references public.sales_orders(id) on delete cascade,
  pkg_no          int not null,
  template_id     uuid references public.calc_templates(id),
  name            text not null,
  unit_label      text not null default 'line',
  quantity        numeric(18,4) not null check (quantity > 0),          -- number of lines sold
  inputs          jsonb not null default '{}'::jsonb,                   -- calculator inputs {L:430, N:4, ROOM:"Centre"}
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (sales_order_id, pkg_no)
);
create index if not exists sop_so_idx on public.sales_order_packages(sales_order_id);
alter table public.sales_order_packages enable row level security;
drop policy if exists sop_select on public.sales_order_packages;
create policy sop_select on public.sales_order_packages for select to authenticated
  using (exists (select 1 from public.sales_orders h where h.id = sales_order_id));
grant select on public.sales_order_packages to authenticated;
drop trigger if exists audit on public.sales_order_packages;
create trigger audit after insert or update or delete on public.sales_order_packages for each row execute function public.tg_audit_row();

alter table public.sales_order_lines add column if not exists package_id uuid references public.sales_order_packages(id) on delete set null;
alter table public.sales_order_lines add column if not exists calc_qty numeric(18,4);   -- quantity from the rule; extra = quantity − calc_qty
create index if not exists sol_package_idx on public.sales_order_lines(package_id);
grant select (package_id, calc_qty) on public.sales_order_lines to authenticated;      -- the table uses column grants (prices hidden)

-- Save the packages of an order after the order itself is saved (lines must exist).
-- p_packages: [{id?, template_id, name, unit_label, quantity, inputs, discount_amount, lines:[{line_id, calc_qty}]}]
-- Active lines not listed lose their package; packages no line points at any more are removed.
create or replace function public.set_so_packages(p_so_id uuid, p_packages jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; p jsonb; x jsonb; v_id uuid; v_keep uuid[] := '{}'; v_no int; v_disc numeric; v_gross numeric; v_n int; v_prices boolean;
begin
  select * into h from public.sales_orders where id = p_so_id for update;
  if h.id is null then raise exception 'Sales order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  if not public.can_access_customer(h.customer_id) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;
  if h.status not in ('DRAFT','APPROVED','PARTIALLY_DELIVERED') then
    raise exception 'This order is % — its packages can no longer change', lower(h.status) using errcode = '22023';
  end if;
  v_prices := public.has_permission(h.company_id, 'sales.view_prices');

  update public.sales_order_lines set package_id = null, calc_qty = null
   where sales_order_id = p_so_id and is_active and (package_id is not null or calc_qty is not null);

  for p in select * from jsonb_array_elements(coalesce(p_packages, '[]'::jsonb)) loop
    if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then continue; end if;
    if coalesce(nullif(p->>'quantity','')::numeric, 0) <= 0 then raise exception 'Package "%": enter the number of %s', p->>'name', coalesce(p->>'unit_label','line') using errcode = '23514'; end if;
    v_id := nullif(p->>'id','')::uuid;
    if v_id is not null and not exists (select 1 from public.sales_order_packages where id = v_id and sales_order_id = p_so_id) then v_id := null; end if;
    if v_id is null then
      select coalesce(max(pkg_no), 0) + 1 into v_no from public.sales_order_packages where sales_order_id = p_so_id;
      insert into public.sales_order_packages(company_id, sales_order_id, pkg_no, template_id, name, unit_label, quantity, inputs, discount_amount)
      values (h.company_id, p_so_id, v_no, nullif(p->>'template_id','')::uuid, coalesce(nullif(trim(p->>'name'),''), 'Package'),
              coalesce(nullif(trim(p->>'unit_label'),''), 'line'), (p->>'quantity')::numeric, coalesce(p->'inputs', '{}'::jsonb), 0)
      returning id into v_id;
    else
      update public.sales_order_packages set template_id = nullif(p->>'template_id','')::uuid, name = coalesce(nullif(trim(p->>'name'),''), name),
        unit_label = coalesce(nullif(trim(p->>'unit_label'),''), unit_label), quantity = (p->>'quantity')::numeric,
        inputs = coalesce(p->'inputs', inputs), updated_at = now(), updated_by = auth.uid()
      where id = v_id;
    end if;
    v_keep := v_keep || v_id;
    for x in select * from jsonb_array_elements(p->'lines') loop
      update public.sales_order_lines set package_id = v_id, calc_qty = nullif(x->>'calc_qty','')::numeric
       where id = (x->>'line_id')::uuid and sales_order_id = p_so_id and is_active;
    end loop;
    select count(*) into v_n from public.sales_order_lines where package_id = v_id and is_active;
    if v_n = 0 then raise exception 'Package "%": its items were not found on the order', p->>'name' using errcode = 'P0002'; end if;
    -- the discount is a price: only users who see prices change it
    if v_prices then
      v_disc := round(coalesce(nullif(p->>'discount_amount','')::numeric, 0), 2);
      if v_disc < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;
      select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) into v_gross from public.sales_order_lines l
       where l.package_id = v_id and l.is_active and l.unit_price is not null;
      if v_disc > v_gross then raise exception 'Package "%": discount % is more than its items (%)', p->>'name', v_disc, v_gross using errcode = '23514'; end if;
      update public.sales_order_packages set discount_amount = v_disc where id = v_id;
    end if;
  end loop;

  -- packages nothing points at any more (lines retired by an edit keep theirs, for printing old invoices)
  delete from public.sales_order_packages s where s.sales_order_id = p_so_id and not (s.id = any(v_keep))
     and not exists (select 1 from public.sales_order_lines l where l.package_id = s.id);
  return jsonb_build_object('packages', coalesce(array_length(v_keep, 1), 0));
end $$;
revoke execute on function public.set_so_packages(uuid, jsonb) from public, anon;
grant execute on function public.set_so_packages(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- invoices: package discounts carried in proportion
create or replace function public.create_invoice_from_gdns(p_company_id uuid, p_gdn_ids uuid[], p_invoice_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cust uuid; v_id uuid; g record; v_lines jsonb := '[]'::jsonb; v_n int; v_pkg numeric;
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
  -- package discounts (calculator), in proportion to the part of each package billed now
  select coalesce(round(sum(pk.discount_amount * part.v / nullif(full_v.v, 0)), 2), 0) into v_pkg
    from (select sol.package_id, sum(round(x.q * gl.unit_price, 2)) v
          from (select (s->>'gdn_line_id')::uuid gl_id, (s->>'qty')::numeric q from jsonb_array_elements(v_lines) e, jsonb_array_elements(e->'sources') s) x
          join public.gdn_lines gl on gl.id = x.gl_id join public.sales_order_lines sol on sol.id = gl.sales_order_line_id
          where gl.unit_price is not null and sol.package_id is not null group by sol.package_id) part
    join public.sales_order_packages pk on pk.id = part.package_id and pk.discount_amount > 0
    join lateral (select sum(round(l.quantity * l.unit_price, 2)) v from public.sales_order_lines l
                   where l.package_id = pk.id and (l.is_active or l.delivered_qty > 0) and l.unit_price is not null) full_v on true;
  -- plus the orders' own discount, in proportion to the part of each order billed now
  update public.sales_invoices set discount_amount = v_pkg + coalesce((
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

-- ---------------------------------------------------------------- invoice printing: which part of each line belongs to a package
-- Returns {packages:[{id,name,unit_label,quantity,billed,full,discount}], parts:[{line_no, package_id, qty}]}
-- line_no = sales_invoice_lines.line_no (posted) or position in lines_draft (draft). Prices: sales.view_prices only.
create or replace function public.invoice_packages(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare h record; v_parts jsonb; v_pk jsonb;
begin
  select * into h from public.sales_invoices where id = p_invoice_id;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(h.company_id, 'sales.view') and public.has_permission(h.company_id, 'sales.view_prices') and public.can_access_customer(h.customer_id)) then
    return jsonb_build_object('packages', '[]'::jsonb, 'parts', '[]'::jsonb);
  end if;
  with lines as (
    select l.line_no, l.unit_price, l.sources from public.sales_invoice_lines l where l.invoice_id = h.id and h.status <> 'DRAFT'
    union all
    select e.ord::int, nullif(e.v->>'unit_price','')::numeric, e.v->'sources'
      from jsonb_array_elements(case when h.status = 'DRAFT' or not exists (select 1 from public.sales_invoice_lines where invoice_id = h.id)
                                     then coalesce(h.lines_draft, '[]'::jsonb) else '[]'::jsonb end) with ordinality e(v, ord)
  ), src as (
    select ln.line_no, ln.unit_price, sol.package_id, sum((s->>'qty')::numeric) qty
      from lines ln cross join lateral jsonb_array_elements(coalesce(ln.sources, '[]'::jsonb)) s
      join public.gdn_lines gl on gl.id = (s->>'gdn_line_id')::uuid
      join public.sales_order_lines sol on sol.id = gl.sales_order_line_id
     where sol.package_id is not null
     group by ln.line_no, ln.unit_price, sol.package_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('line_no', line_no, 'package_id', package_id, 'qty', qty) order by line_no), '[]'::jsonb),
         (select coalesce(jsonb_agg(jsonb_build_object('id', pk.id, 'name', pk.name, 'unit_label', pk.unit_label, 'quantity', pk.quantity,
                   'billed', b.v, 'full', f.v, 'discount', pk.discount_amount, 'inputs', pk.inputs) order by pk.name), '[]'::jsonb)
            from (select package_id, sum(round(qty * coalesce(unit_price, 0), 2)) v from src group by package_id) b
            join public.sales_order_packages pk on pk.id = b.package_id
            join lateral (select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) v from public.sales_order_lines l
                           where l.package_id = pk.id and (l.is_active or l.delivered_qty > 0) and l.unit_price is not null) f on true)
    into v_parts, v_pk
    from src;
  return jsonb_build_object('packages', coalesce(v_pk, '[]'::jsonb), 'parts', coalesce(v_parts, '[]'::jsonb));
end $$;
revoke execute on function public.invoice_packages(uuid) from public, anon;
grant execute on function public.invoice_packages(uuid) to authenticated;
