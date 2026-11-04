-- Settings → Calculators (edit rules, inputs, default prices) and calculator packages on quotations.

-- ---------------------------------------------------------------- save a calculator
-- p_header: {company_id, code, name, description, unit_label, qty_var, sort_order, is_active, variables[]}
-- p_items:  [{product_id, variant_id, formula, note, default_price}] in order. Without sales.view_prices the stored
--           default prices are kept (matched by item + variant). Formulas are checked by the screen before saving.
create or replace function public.save_calc_template(p_id uuid, p_header jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p_header->>'company_id')::uuid; v_id uuid; x jsonb; n int := 0; v_prices boolean; v_old jsonb;
  v_code text; v_qv text; v_price numeric; p record; v_vid uuid; v jsonb; v_keys text[] := '{}'; k text;
begin
  perform public.inv_require(v_company, 'settings.manage');
  v_prices := public.has_permission(v_company, 'sales.view_prices');
  v_code := upper(regexp_replace(coalesce(nullif(trim(p_header->>'code'),''), trim(p_header->>'name')), '[^A-Za-z0-9]+', '_', 'g'));
  if coalesce(trim(p_header->>'name'),'') = '' then raise exception 'Enter the calculator name' using errcode = '23502'; end if;
  if jsonb_typeof(coalesce(p_header->'variables','[]'::jsonb)) <> 'array' then raise exception 'Inputs must be a list' using errcode = '22023'; end if;
  for v in select * from jsonb_array_elements(coalesce(p_header->'variables','[]'::jsonb)) loop
    k := v->>'key';
    if k is null or k !~ '^[A-Za-z_][A-Za-z0-9_]*$' then raise exception 'Input code "%" — use letters, digits and _ only (start with a letter)', coalesce(k,'') using errcode = '22023'; end if;
    if k = any(v_keys) then raise exception 'Input code % is used twice', k using errcode = '22023'; end if;
    v_keys := v_keys || k;
  end loop;
  v_qv := coalesce(nullif(trim(p_header->>'qty_var'),''), 'N');
  if not (v_qv = any(v_keys)) then raise exception 'The number of lines must be one of the inputs (%)', v_qv using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = '23502'; end if;

  if p_id is null then
    insert into public.calc_templates(company_id, code, name) values (v_company, v_code, trim(p_header->>'name')) returning id into v_id;
  else
    select id into v_id from public.calc_templates where id = p_id and company_id = v_company for update;
    if v_id is null then raise exception 'Calculator not found' using errcode = 'P0002'; end if;
  end if;
  update public.calc_templates set code = v_code, name = trim(p_header->>'name'), description = nullif(trim(p_header->>'description'),''),
    unit_label = coalesce(nullif(trim(p_header->>'unit_label'),''), 'line'), qty_var = v_qv,
    sort_order = coalesce(nullif(p_header->>'sort_order','')::int, sort_order), is_active = coalesce((p_header->>'is_active')::boolean, true),
    variables = coalesce(p_header->'variables','[]'::jsonb), updated_at = now(), updated_by = auth.uid()
  where id = v_id;

  select coalesce(jsonb_agg(jsonb_build_object('p', product_id, 'v', variant_id, 'price', default_price)), '[]'::jsonb) into v_old
    from public.calc_template_items where template_id = v_id;
  delete from public.calc_template_items where template_id = v_id;
  for x in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    select id, name, has_variants into p from public.products where id = nullif(x->>'product_id','')::uuid and company_id = v_company;
    if p.id is null then raise exception 'Item %: choose the product', n using errcode = '23502'; end if;
    v_vid := nullif(x->>'variant_id','')::uuid;
    if v_vid is not null and not exists (select 1 from public.product_variants where id = v_vid and product_id = p.id) then
      raise exception 'Item %: variant does not belong to "%"', n, p.name using errcode = '22023';
    end if;
    if coalesce(trim(x->>'formula'),'') = '' then raise exception 'Item % (%): enter the rule', n, p.name using errcode = '23502'; end if;
    if v_prices then
      v_price := round(nullif(x->>'default_price','')::numeric, 2);
      if v_price < 0 then raise exception 'Item %: price cannot be negative', n using errcode = '23514'; end if;
    else
      select (o->>'price')::numeric into v_price from jsonb_array_elements(v_old) o
       where (o->>'p')::uuid = p.id and (o->>'v')::uuid is not distinct from v_vid limit 1;
    end if;
    insert into public.calc_template_items(company_id, template_id, line_no, product_id, variant_id, formula, note, default_price)
    values (v_company, v_id, n, p.id, v_vid, trim(x->>'formula'), nullif(trim(x->>'note'),''), v_price);
  end loop;
  return v_id;
exception when unique_violation then
  raise exception 'Another calculator already uses the code %', v_code using errcode = '23505';
end $$;
revoke execute on function public.save_calc_template(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_calc_template(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- packages on quotations
create table if not exists public.quotation_packages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  quotation_id    uuid not null references public.quotations(id) on delete cascade,
  pkg_no          int not null,
  template_id     uuid references public.calc_templates(id),
  name            text not null,
  unit_label      text not null default 'line',
  quantity        numeric(18,4) not null check (quantity > 0),
  inputs          jsonb not null default '{}'::jsonb,
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),   -- part of quotations.discount_amount
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (quotation_id, pkg_no)
);
create index if not exists qp_quotation_idx on public.quotation_packages(quotation_id);
alter table public.quotation_packages enable row level security;
drop policy if exists qp_select on public.quotation_packages;
create policy qp_select on public.quotation_packages for select to authenticated
  using (exists (select 1 from public.quotations h where h.id = quotation_id));
grant select on public.quotation_packages to authenticated;
drop trigger if exists audit on public.quotation_packages;
create trigger audit after insert or update or delete on public.quotation_packages for each row execute function public.tg_audit_row();

alter table public.quotation_lines add column if not exists package_id uuid references public.quotation_packages(id) on delete set null;
alter table public.quotation_lines add column if not exists calc_qty numeric(18,4);

-- After save_quotation (which renumbers the active lines 1..n in the order sent).
-- p_packages: [{template_id, name, unit_label, quantity, inputs, discount_amount, lines:[{line_no, calc_qty}]}]
-- The package discounts are part of the quotation's discount, so together they may not exceed it.
create or replace function public.set_quotation_packages(p_quotation_id uuid, p_packages jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; p jsonb; x jsonb; v_id uuid; v_no int := 0; v_disc numeric; v_sum numeric := 0; v_gross numeric;
begin
  select * into h from public.quotations where id = p_quotation_id for update;
  if h.id is null then raise exception 'Quotation not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.manage');
  perform public.inv_require(h.company_id, 'sales.view_prices');
  if not public.can_access_customer(h.customer_id) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;
  if h.status not in ('DRAFT','SENT') then raise exception 'Only draft or sent quotations can be edited (this one is %)', lower(h.status) using errcode = '22023'; end if;

  update public.quotation_lines set package_id = null, calc_qty = null where quotation_id = h.id;
  delete from public.quotation_packages where quotation_id = h.id;
  for p in select * from jsonb_array_elements(coalesce(p_packages, '[]'::jsonb)) loop
    if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then continue; end if;
    if coalesce(nullif(p->>'quantity','')::numeric, 0) <= 0 then raise exception 'Package "%": enter the number of lines', p->>'name' using errcode = '23514'; end if;
    v_no := v_no + 1;
    v_disc := round(coalesce(nullif(p->>'discount_amount','')::numeric, 0), 2);
    if v_disc < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;
    insert into public.quotation_packages(company_id, quotation_id, pkg_no, template_id, name, unit_label, quantity, inputs, discount_amount)
    values (h.company_id, h.id, v_no, nullif(p->>'template_id','')::uuid, coalesce(nullif(trim(p->>'name'),''), 'Package'),
            coalesce(nullif(trim(p->>'unit_label'),''), 'line'), (p->>'quantity')::numeric, coalesce(p->'inputs','{}'::jsonb), v_disc)
    returning id into v_id;
    for x in select * from jsonb_array_elements(p->'lines') loop
      update public.quotation_lines set package_id = v_id, calc_qty = nullif(x->>'calc_qty','')::numeric
       where quotation_id = h.id and is_active and line_no = (x->>'line_no')::int;
    end loop;
    select coalesce(sum(round(quantity * unit_price, 2)), 0) into v_gross from public.quotation_lines where package_id = v_id and is_active;
    if v_gross = 0 then raise exception 'Package "%": its items were not found on the quotation', p->>'name' using errcode = 'P0002'; end if;
    if v_disc > v_gross then raise exception 'Package "%": discount % is more than its items (%)', p->>'name', v_disc, v_gross using errcode = '23514'; end if;
    v_sum := v_sum + v_disc;
  end loop;
  if v_sum > h.discount_amount + 0.005 then
    raise exception 'Package discounts (%) are more than the quotation discount (%)', v_sum, h.discount_amount using errcode = '23514';
  end if;
  return jsonb_build_object('packages', v_no);
end $$;
revoke execute on function public.set_quotation_packages(uuid, jsonb) from public, anon;
grant execute on function public.set_quotation_packages(uuid, jsonb) to authenticated;
