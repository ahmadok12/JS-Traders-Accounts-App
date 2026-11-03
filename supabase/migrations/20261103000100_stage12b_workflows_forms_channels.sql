-- =====================================================================
-- JS Traders ERP — Stage 12 (part 2): finishing the configuration engine (spec §19, §21, Stage 12)
--   0. Owner may be named as approver (sales.approve, sales.invoice, journals.post)
--   1. Custom fields: date & time, reference (to another record), file, image and formula types;
--      custom fields on documents (sales orders, quotations, GDNs, invoices, POs, receipts, bills,
--      vouchers, adjustments, transfers, shipments). Required document fields are checked when the
--      document is approved / posted.
--   2. Workflow engine: review steps, who acts at each step, fields needed before passing a step,
--      transitions (forward / send back), history. The approve / post action is blocked by the
--      database until the steps are done.
--   3. Configurable forms per role for master records: hide fields, make fields required,
--      hide or open sections. Required-for-role is checked by the database too.
--   4. Notification delivery by e-mail and WhatsApp: per-rule channels, per-user contacts,
--      outbox, background sweep every 5 minutes (pg_cron) and the notify-send edge function.
-- Configuration never bypasses RLS, permission checks, inventory or accounting controls.
-- =====================================================================

-- =====================================================================
-- 0. OWNER CAN APPROVE (approval-limit tiers need the role to hold the permission)
-- =====================================================================
insert into public.role_permissions(role_id, permission_code)
select r.id, x from public.roles r cross join unnest(array['sales.approve','sales.invoice','journals.post']) x
where r.code = 'OWNER'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_code = x);

-- =====================================================================
-- 1. CUSTOM FIELDS — new types and document entities
-- =====================================================================
alter table public.custom_field_definitions drop constraint if exists custom_field_definitions_entity_check;
alter table public.custom_field_definitions add constraint custom_field_definitions_entity_check check (entity in (
  'customers','customer_groups','suppliers','products','warehouses','employees','bank_accounts','payment_agents',
  'sales_orders','quotations','gdns','sales_invoices','purchase_orders','goods_receipts','supplier_bills',
  'journal_entries','stock_adjustments','stock_transfers','shipments'));
alter table public.custom_field_definitions drop constraint if exists custom_field_definitions_field_type_check;
alter table public.custom_field_definitions add constraint custom_field_definitions_field_type_check check (field_type in (
  'text','long_text','number','decimal','currency','percentage','date','datetime','checkbox','dropdown','multi_select',
  'reference','file','image','formula'));
alter table public.custom_field_definitions add column if not exists ref_entity text
  check (ref_entity is null or ref_entity in ('customers','suppliers','products','warehouses','employees'));
alter table public.custom_field_definitions add column if not exists formula text check (formula is null or length(formula) <= 300);
alter table public.custom_field_definitions add column if not exists decimals int check (decimals is null or decimals between 0 and 6);

alter table public.custom_field_values add column if not exists value_ts timestamptz;
alter table public.custom_field_values add column if not exists value_ref uuid;
create index if not exists cfv_ts_idx on public.custom_field_values(field_id, value_ts);
create index if not exists cfv_ref_idx on public.custom_field_values(field_id, value_ref);

create or replace function public.cf_is_doc(p_entity text) returns boolean language sql immutable set search_path = '' as $$
  select p_entity in ('sales_orders','quotations','gdns','sales_invoices','purchase_orders','goods_receipts','supplier_bills',
                      'journal_entries','stock_adjustments','stock_transfers','shipments');
$$;
grant execute on function public.cf_is_doc(text) to authenticated;

create or replace function public.cf_entity_perm(p_entity text, p_manage boolean)
returns text language sql immutable set search_path = '' as $$
  select case p_entity
    when 'customers'         then case when p_manage then 'customers.manage' else 'customers.view' end
    when 'customer_groups'   then case when p_manage then 'customers.manage' else 'customers.view' end
    when 'suppliers'         then case when p_manage then 'suppliers.manage' else 'suppliers.view' end
    when 'products'          then case when p_manage then 'products.manage' else 'products.view' end
    when 'warehouses'        then case when p_manage then 'warehouses.manage' else 'warehouses.view' end
    when 'employees'         then case when p_manage then 'employees.manage' else 'employees.view' end
    when 'bank_accounts'     then case when p_manage then 'banks.manage' else 'banks.view' end
    when 'payment_agents'    then case when p_manage then 'payment_agents.manage' else 'payment_agents.view' end
    when 'sales_orders'      then case when p_manage then 'sales.manage' else 'sales.view' end
    when 'quotations'        then case when p_manage then 'sales.manage' else 'sales.view_prices' end
    when 'gdns'              then case when p_manage then 'sales.dispatch' else 'sales.view' end
    when 'sales_invoices'    then case when p_manage then 'sales.invoice' else 'sales.view_prices' end
    when 'purchase_orders'   then case when p_manage then 'purchasing.manage' else 'purchasing.view' end
    when 'goods_receipts'    then case when p_manage then 'inventory.receive' else 'inventory.view' end
    when 'supplier_bills'    then 'purchasing.costs'
    when 'journal_entries'   then case when p_manage then 'journals.create' else 'journals.view' end
    when 'stock_adjustments' then case when p_manage then 'inventory.adjust' else 'inventory.view' end
    when 'stock_transfers'   then case when p_manage then 'inventory.transfer' else 'inventory.view' end
    when 'shipments'         then case when p_manage then 'purchasing.manage' else 'purchasing.view' end
  end;
$$;

-- may the caller see this record (and so its custom values)?
create or replace function public.cf_record_visible(p_company uuid, p_entity text, p_record uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_cust uuid; v_wh uuid; v_wh2 uuid;
begin
  if p_entity = 'customers' then return public.can_access_customer(p_record); end if;
  if p_entity = 'gdns' then
    if not (public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'inventory.view')) then return false; end if;
  elsif not public.has_permission(p_company, public.cf_entity_perm(p_entity, false)) then
    return false;
  end if;
  if p_entity in ('sales_orders','quotations','gdns','sales_invoices') then
    execute format('select customer_id from public.%I where id = $1', p_entity) into v_cust using p_record;
    return v_cust is null or public.can_access_customer(v_cust);
  end if;
  if p_entity in ('goods_receipts','stock_adjustments') then
    execute format('select warehouse_id from public.%I where id = $1', p_entity) into v_wh using p_record;
    return v_wh is null or public.can_access_warehouse(v_wh);
  end if;
  if p_entity = 'stock_transfers' then
    select from_warehouse_id, to_warehouse_id into v_wh, v_wh2 from public.stock_transfers where id = p_record;
    return v_wh is null or public.can_access_warehouse(v_wh) or public.can_access_warehouse(v_wh2);
  end if;
  return true;
end $$;
revoke execute on function public.cf_record_visible(uuid, text, uuid) from public, anon;
grant execute on function public.cf_record_visible(uuid, text, uuid) to authenticated;

-- label of a referenced record (stored with the value so lists and filters can show it)
create or replace function public.cf_ref_label(p_entity text, p_id uuid, p_company uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  case p_entity
    when 'customers'  then select name into v from public.customers where id = p_id and company_id = p_company;
    when 'suppliers'  then select name into v from public.suppliers where id = p_id and company_id = p_company;
    when 'products'   then select name into v from public.products where id = p_id and company_id = p_company;
    when 'warehouses' then select name into v from public.warehouses where id = p_id and company_id = p_company;
    when 'employees'  then select full_name into v from public.employees where id = p_id and company_id = p_company;
    else v := null;
  end case;
  return v;
end $$;
revoke execute on function public.cf_ref_label(text, uuid, uuid) from public, anon, authenticated;

-- Formula: other number fields of the same record as {code}, numbers, + - * / and brackets.
-- After the codes are replaced by numbers only digits and operators may remain, so the expression is safe to evaluate.
create or replace function public.cf_eval_formula(p_expr text, p_vals jsonb) returns numeric
language plpgsql stable set search_path = '' as $$
declare v_expr text := coalesce(p_expr, ''); m text[]; v_val text; r numeric;
begin
  for m in select regexp_matches(v_expr, '\{([a-z][a-z0-9_]{0,39})\}', 'g') loop
    v_val := p_vals->>m[1];
    if v_val is null then return null; end if;
    v_expr := replace(v_expr, '{' || m[1] || '}', '(' || v_val::numeric::text || ')');
  end loop;
  if v_expr !~ '^[0-9.\s()+*/-]+$' or v_expr ~ '\.\.' or length(v_expr) > 2000 then return null; end if;
  begin
    execute 'select (' || v_expr || ')::numeric' into r;
  exception when others then return null;
  end;
  return round(r, 6);
end $$;
revoke execute on function public.cf_eval_formula(text, jsonb) from public, anon, authenticated;

create or replace function public.save_custom_field_definition(p_company uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.custom_field_definitions%rowtype; v_id uuid; v_type text := p_data->>'field_type'; v_entity text;
  v_opts text[]; v_label text := trim(coalesce(p_data->>'label','')); v_code text; v_ref text; v_formula text; v_dec int; m text[];
begin
  perform public.inv_require(p_company, 'settings.manage');
  if v_label = '' then raise exception 'Enter a field name' using errcode = '22023'; end if;
  if p_id is not null then
    select * into d from public.custom_field_definitions where id = p_id and company_id = p_company for update;
    if not found then raise exception 'Field not found' using errcode = 'P0002'; end if;
    v_entity := d.entity;
  else
    v_entity := p_data->>'entity';
  end if;
  select coalesce(array_agg(distinct trim(o)) filter (where trim(o) <> ''), '{}') into v_opts
    from jsonb_array_elements_text(coalesce(p_data->'options', '[]')) o;
  if v_type in ('dropdown','multi_select') and cardinality(v_opts) = 0 then
    raise exception 'Add at least one choice for a dropdown field' using errcode = '22023';
  end if;
  if v_type not in ('dropdown','multi_select') then v_opts := '{}'; end if;

  v_ref := case when v_type = 'reference' then nullif(p_data->>'ref_entity', '') end;
  if v_type = 'reference' and v_ref is null then raise exception 'Choose what the field points to (customer, supplier, product …)' using errcode = '22023'; end if;
  if v_type in ('file','image') and not public.attachment_entity_ok(v_entity) then
    raise exception 'File and image fields are not available for this kind of record' using errcode = '22023';
  end if;
  v_formula := case when v_type = 'formula' then nullif(trim(p_data->>'formula'), '') end;
  if v_type = 'formula' then
    if v_formula is null then raise exception 'Enter the formula, e.g. {length_m} * {rate}' using errcode = '22023'; end if;
    if v_formula !~ '^[0-9a-z_{}.\s()+*/-]+$' then raise exception 'A formula can use {field codes}, numbers, + - * / and brackets only' using errcode = '22023'; end if;
    for m in select regexp_matches(v_formula, '\{([a-z0-9_]+)\}', 'g') loop
      if not exists (select 1 from public.custom_field_definitions x where x.company_id = p_company and x.entity = v_entity and x.code = m[1]
                     and x.field_type in ('number','decimal','currency','percentage') and (p_id is null or x.id <> p_id)) then
        raise exception 'The formula uses {%}, which is not a number field of this record', m[1] using errcode = '22023';
      end if;
    end loop;
    if public.cf_eval_formula(regexp_replace(v_formula, '\{[a-z0-9_]+\}', '1', 'g'), '{}'::jsonb) is null
       and public.cf_eval_formula(regexp_replace(v_formula, '\{[a-z0-9_]+\}', '2', 'g'), '{}'::jsonb) is null then
      raise exception 'The formula is not valid — check the brackets and operators' using errcode = '22023';
    end if;
  end if;
  v_dec := case when v_type = 'formula' then coalesce((p_data->>'decimals')::int, 2) end;

  if p_id is null then
    v_code := left(regexp_replace(regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'), 40);
    if v_code !~ '^[a-z]' then v_code := 'f_' || v_code; end if;
    v_code := left(v_code, 40);
    while exists (select 1 from public.custom_field_definitions where company_id = p_company and entity = v_entity and code = v_code) loop
      v_code := left(v_code, 36) || '_' || substr(md5(random()::text), 1, 3);
    end loop;
    insert into public.custom_field_definitions(company_id, entity, code, label, field_type, options, required, help_text, show_in_list, sort_order, is_active, ref_entity, formula, decimals)
    values (p_company, v_entity, v_code, v_label, v_type, v_opts,
      case when v_type = 'formula' then false else coalesce((p_data->>'required')::boolean, false) end,
      nullif(trim(p_data->>'help_text'), ''), coalesce((p_data->>'show_in_list')::boolean, false),
      coalesce((p_data->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 10 from public.custom_field_definitions where company_id = p_company and entity = v_entity)),
      true, v_ref, v_formula, v_dec)
    returning id into v_id;
    return v_id;
  end if;

  if v_type <> d.field_type and exists (select 1 from public.custom_field_values where field_id = d.id) then
    raise exception 'This field already has values — its type cannot be changed. Make a new field instead.' using errcode = '22023';
  end if;
  if v_type = 'reference' and v_ref is distinct from d.ref_entity and exists (select 1 from public.custom_field_values where field_id = d.id) then
    raise exception 'This field already has values — what it points to cannot be changed.' using errcode = '22023';
  end if;
  if d.field_type in ('number','decimal','currency','percentage') and v_type <> d.field_type
     and exists (select 1 from public.custom_field_definitions x where x.company_id = p_company and x.entity = d.entity and x.field_type = 'formula' and x.formula like '%{' || d.code || '}%') then
    raise exception 'A formula field uses this field — it must stay a number field' using errcode = '22023';
  end if;
  update public.custom_field_definitions set label = v_label, field_type = v_type, options = v_opts,
    required = case when v_type = 'formula' then false else coalesce((p_data->>'required')::boolean, required) end,
    help_text = nullif(trim(p_data->>'help_text'), ''),
    show_in_list = coalesce((p_data->>'show_in_list')::boolean, show_in_list),
    sort_order = coalesce((p_data->>'sort_order')::int, sort_order),
    is_active = coalesce((p_data->>'is_active')::boolean, is_active),
    ref_entity = v_ref, formula = v_formula, decimals = v_dec
  where id = d.id;
  if v_type = 'formula' then perform public.cf_recalc_formulas(p_company, d.entity, null); end if;
  return d.id;
end $$;
revoke execute on function public.save_custom_field_definition(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_custom_field_definition(uuid, uuid, jsonb) to authenticated;

-- recalculate formula fields for one record (or all records of the entity when p_record is null)
create or replace function public.cf_recalc_formulas(p_company uuid, p_entity text, p_record uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f record; rec record; v_vals jsonb; v_num numeric;
begin
  if not exists (select 1 from public.custom_field_definitions where company_id = p_company and entity = p_entity and field_type = 'formula' and is_active) then return; end if;
  for rec in
    select distinct v.record_id from public.custom_field_values v
    where v.company_id = p_company and v.entity = p_entity and (p_record is null or v.record_id = p_record)
    union select p_record where p_record is not null
  loop
    select coalesce(jsonb_object_agg(d.code, v.value_number), '{}'::jsonb) into v_vals
      from public.custom_field_values v join public.custom_field_definitions d on d.id = v.field_id
     where v.record_id = rec.record_id and v.entity = p_entity and d.field_type in ('number','decimal','currency','percentage') and v.value_number is not null;
    for f in select * from public.custom_field_definitions where company_id = p_company and entity = p_entity and field_type = 'formula' and is_active loop
      v_num := public.cf_eval_formula(f.formula, v_vals);
      if v_num is not null then v_num := round(v_num, coalesce(f.decimals, 2)); end if;
      if v_num is null then
        delete from public.custom_field_values where field_id = f.id and record_id = rec.record_id;
      else
        insert into public.custom_field_values(company_id, field_id, entity, record_id, value_number, updated_at, updated_by)
        values (p_company, f.id, p_entity, rec.record_id, v_num, now(), auth.uid())
        on conflict (field_id, record_id) do update set value_number = excluded.value_number, updated_at = now(), updated_by = auth.uid()
        where custom_field_values.value_number is distinct from excluded.value_number;
      end if;
    end loop;
  end loop;
end $$;
revoke execute on function public.cf_recalc_formulas(uuid, text, uuid) from public, anon, authenticated;

-- p_values: { "<field_id>": value }  (null / "" clears). Validates type, choices and required fields.
-- Documents: required fields are checked when the document is approved / posted, not on every save.
create or replace function public.save_custom_field_values(p_company uuid, p_entity text, p_record uuid, p_values jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare d record; v jsonb; n int := 0; v_txt text; v_num numeric; v_date date; v_bool boolean; v_opts text[]; v_ts timestamptz; v_ref uuid;
  v_exists boolean; v_has boolean; v_doc boolean := public.cf_is_doc(p_entity); a record;
begin
  perform public.inv_require(p_company, public.cf_entity_perm(p_entity, true));
  execute format('select exists (select 1 from public.%I where id = $1 and company_id = $2)', p_entity) into v_exists using p_record, p_company;
  if not v_exists then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if not public.cf_record_visible(p_company, p_entity, p_record) then
    raise exception 'You do not have access to this record' using errcode = '42501';
  end if;

  for d in select * from public.custom_field_definitions where company_id = p_company and entity = p_entity and is_active and field_type <> 'formula' order by sort_order loop
    v_has := p_values ? d.id::text;
    v := p_values->(d.id::text);
    if not v_has then
      -- not sent: only check that a required field already has a value
      if d.required and not v_doc and not exists (select 1 from public.custom_field_values where field_id = d.id and record_id = p_record) then
        raise exception '"%" is required', d.label using errcode = '23502';
      end if;
      continue;
    end if;
    v_txt := null; v_num := null; v_date := null; v_bool := null; v_opts := null; v_ts := null; v_ref := null;
    if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      if d.required and not v_doc then raise exception '"%" is required', d.label using errcode = '23502'; end if;
      delete from public.custom_field_values where field_id = d.id and record_id = p_record;
      n := n + 1;
      continue;
    end if;
    begin
      case d.field_type
        when 'text' then v_txt := left(trim(v #>> '{}'), 500);
        when 'long_text' then v_txt := left(v #>> '{}', 5000);
        when 'number' then v_num := round((v #>> '{}')::numeric);
        when 'decimal','currency','percentage' then v_num := (v #>> '{}')::numeric;
        when 'date' then v_date := (v #>> '{}')::date;
        when 'datetime' then v_ts := (v #>> '{}')::timestamptz; v_date := (v_ts at time zone 'Asia/Karachi')::date;
        when 'checkbox' then v_bool := (v #>> '{}')::boolean;
        when 'dropdown' then
          v_txt := v #>> '{}';
          if not v_txt = any(d.options) then raise exception 'bad choice'; end if;
        when 'multi_select' then
          select array_agg(x) into v_opts from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else jsonb_build_array(v) end) x;
          if exists (select 1 from unnest(v_opts) x where not x = any(d.options)) then raise exception 'bad choice'; end if;
          v_txt := array_to_string(v_opts, ', ');
        when 'reference' then
          v_ref := (v #>> '{}')::uuid;
          v_txt := public.cf_ref_label(d.ref_entity, v_ref, p_company);
          if v_txt is null then raise exception 'not found'; end if;
        when 'file','image' then
          v_ref := (v #>> '{}')::uuid;
          select * into a from public.attachments x where x.id = v_ref and x.entity_type = p_entity and x.entity_id = p_record and x.deleted_at is null;
          if a.id is null or (d.field_type = 'image' and a.mime_type not like 'image/%') then raise exception 'bad file'; end if;
          v_txt := a.original_file_name;
      end case;
    exception when others then
      raise exception '"%": the value is not valid for a % field', d.label, replace(d.field_type, '_', ' ') using errcode = '22023';
    end;
    if d.field_type = 'checkbox' and v_bool is false and not d.required then
      delete from public.custom_field_values where field_id = d.id and record_id = p_record;
    else
      insert into public.custom_field_values(company_id, field_id, entity, record_id, value_text, value_number, value_date, value_bool, value_options, value_ts, value_ref, updated_at, updated_by)
      values (p_company, d.id, p_entity, p_record, v_txt, v_num, v_date, v_bool, v_opts, v_ts, v_ref, now(), auth.uid())
      on conflict (field_id, record_id) do update set value_text = excluded.value_text, value_number = excluded.value_number,
        value_date = excluded.value_date, value_bool = excluded.value_bool, value_options = excluded.value_options,
        value_ts = excluded.value_ts, value_ref = excluded.value_ref, updated_at = now(), updated_by = auth.uid()
      where (custom_field_values.value_text, custom_field_values.value_number, custom_field_values.value_date, custom_field_values.value_bool,
             custom_field_values.value_options, custom_field_values.value_ts, custom_field_values.value_ref)
            is distinct from (excluded.value_text, excluded.value_number, excluded.value_date, excluded.value_bool, excluded.value_options, excluded.value_ts, excluded.value_ref);
    end if;
    n := n + 1;
  end loop;
  perform public.cf_recalc_formulas(p_company, p_entity, p_record);
  return n;
end $$;
revoke execute on function public.save_custom_field_values(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.save_custom_field_values(uuid, text, uuid, jsonb) to authenticated;

-- required document fields still empty (checked at approve / post)
create or replace function public.cf_missing_required(p_company uuid, p_entity text, p_record uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(d.label order by d.sort_order), '{}')
  from public.custom_field_definitions d
  where d.company_id = p_company and d.entity = p_entity and d.is_active and d.required and d.field_type not in ('formula','checkbox')
    and not exists (select 1 from public.custom_field_values v where v.field_id = d.id and v.record_id = p_record);
$$;
revoke execute on function public.cf_missing_required(uuid, text, uuid) from public, anon, authenticated;

-- =====================================================================
-- 2. WORKFLOW ENGINE
-- =====================================================================
-- the documents that can have review steps
create or replace function public.wf_doc_types()
returns table(doc_type text, entity text, entry_type text, label text, gate text, view_perm text, link text, sort int)
language sql immutable set search_path = '' as $$
  values
  ('SALES_ORDER','sales_orders',null,'Sales order','approve','sales.view','/sales-orders?view=',10),
  ('QUOTATION','quotations',null,'Quotation','send','sales.view_prices','/quotations?view=',20),
  ('GDN','gdns',null,'Dispatch note (GDN)','dispatch','sales.view','/gdn?view=',30),
  ('SALES_INVOICE','sales_invoices',null,'Sales invoice','post','sales.view_prices','/invoices?view=',40),
  ('PURCHASE_ORDER','purchase_orders',null,'Purchase order','approve','purchasing.view','/purchase-orders?view=',50),
  ('GOODS_RECEIPT','goods_receipts',null,'Goods receipt (GRN)','post','inventory.view','/goods-receipts?view=',60),
  ('SUPPLIER_BILL','supplier_bills',null,'Supplier bill','post','purchasing.costs','/supplier-bills?view=',70),
  ('RECEIPT_VOUCHER','journal_entries','RECEIPT','Receipt voucher','post','journals.view','/vouchers?view=',80),
  ('PAYMENT_VOUCHER','journal_entries','PAYMENT','Payment voucher','post','journals.view','/vouchers?view=',90),
  ('TRANSFER_VOUCHER','journal_entries','TRANSFER','Bank / cash transfer','post','journals.view','/vouchers?view=',100),
  ('JOURNAL_VOUCHER','journal_entries','JOURNAL','Journal voucher','post','journals.view','/vouchers?view=',110),
  ('STOCK_ADJUSTMENT','stock_adjustments',null,'Stock adjustment / opening','post','inventory.view','/stock-adjustments?view=',120),
  ('STOCK_TRANSFER','stock_transfers',null,'Stock transfer','post','inventory.view','/stock-transfers?view=',130)
$$;
grant execute on function public.wf_doc_types() to authenticated;

-- document header fields that a step can require (besides custom fields and files)
create or replace function public.wf_core_fields(p_entity text)
returns table(key text, label text) language sql immutable set search_path = '' as $$
  select 'core:' || x.col, x.lbl from (values
    ('sales_orders','customer_reference','Customer reference'), ('sales_orders','notes','Notes'),
    ('quotations','customer_reference','Customer reference'), ('quotations','valid_until','Valid until'), ('quotations','terms','Terms'), ('quotations','notes','Notes'),
    ('gdns','transport_details','Transport details'), ('gdns','notes','Notes'),
    ('sales_invoices','customer_reference','Customer reference'), ('sales_invoices','due_date','Due date'), ('sales_invoices','notes','Notes'),
    ('purchase_orders','supplier_reference','Supplier reference'), ('purchase_orders','expected_date','Expected date'), ('purchase_orders','notes','Notes'),
    ('goods_receipts','supplier_reference','Supplier reference'), ('goods_receipts','notes','Notes'),
    ('supplier_bills','supplier_invoice_no','Supplier invoice no.'), ('supplier_bills','due_date','Due date'), ('supplier_bills','notes','Notes'),
    ('journal_entries','reference','Reference'), ('journal_entries','memo','Memo'),
    ('stock_adjustments','reference','Reference'), ('stock_adjustments','notes','Notes'),
    ('stock_transfers','reference','Reference'), ('stock_transfers','transport_details','Transport details'), ('stock_transfers','notes','Notes')
  ) x(ent, col, lbl) where x.ent = p_entity
  union all select 'files', 'At least one file attached' where public.attachment_entity_ok(p_entity);
$$;
grant execute on function public.wf_core_fields(text) to authenticated;

create table if not exists public.workflow_definitions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  doc_type         text not null check (doc_type ~ '^[A-Z_]{2,40}$'),
  name             text not null check (length(trim(name)) between 1 and 80),
  description      text,
  is_active        boolean not null default false,
  activated_at     timestamptz,
  include_one_step boolean not null default false,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique (company_id, doc_type)
);
create table if not exists public.workflow_steps (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  definition_id   uuid not null references public.workflow_definitions(id) on delete cascade,
  seq             int not null,
  name            text not null check (length(trim(name)) between 1 and 60),
  roles           text[] not null check (cardinality(roles) > 0),
  required_fields text[] not null default '{}',
  notify          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
create index if not exists wfs_def_idx on public.workflow_steps(definition_id, seq);
create table if not exists public.workflow_transitions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  definition_id    uuid not null references public.workflow_definitions(id) on delete cascade,
  from_step        uuid not null references public.workflow_steps(id) on delete cascade,
  to_step          uuid references public.workflow_steps(id) on delete cascade,   -- null = steps finished, ready to approve / post
  label            text not null check (length(trim(label)) between 1 and 60),
  roles            text[] not null default '{}',                                -- empty = the roles of the step
  requires_comment boolean not null default false,
  sort             int not null default 0,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
create index if not exists wft_from_idx on public.workflow_transitions(from_step, sort);
create table if not exists public.document_workflows (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  doc_type      text not null,
  doc_id        uuid not null,
  definition_id uuid not null references public.workflow_definitions(id) on delete cascade,
  current_step  uuid references public.workflow_steps(id) on delete set null,   -- null and not completed = first step
  completed_at  timestamptz,
  completed_by  uuid,
  updated_at    timestamptz not null default now(),
  unique (doc_type, doc_id)
);
create table if not exists public.document_workflow_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_type   text not null,
  doc_id     uuid not null,
  from_step  text,
  to_step    text,
  label      text not null,
  comment    text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists dwe_doc_idx on public.document_workflow_events(doc_type, doc_id, created_at);

create trigger stamp before insert or update on public.workflow_definitions for each row execute function public.tg_stamp_row();
create trigger stamp before insert or update on public.workflow_steps for each row execute function public.tg_stamp_row();
create trigger stamp before insert or update on public.workflow_transitions for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.workflow_definitions for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.workflow_steps for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.workflow_transitions for each row execute function public.tg_audit_row();

alter table public.workflow_definitions enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_transitions enable row level security;
alter table public.document_workflows enable row level security;
alter table public.document_workflow_events enable row level security;
create policy wfd_select on public.workflow_definitions for select using (public.is_company_member(company_id));
create policy wfs_select on public.workflow_steps for select using (public.is_company_member(company_id));
create policy wft_select on public.workflow_transitions for select using (public.is_company_member(company_id));
create policy dw_select on public.document_workflows for select using (public.is_company_member(company_id));
create policy dwe_select on public.document_workflow_events for select using (public.is_company_member(company_id));
-- all writes go through the functions below

create or replace function public.wf_label(p_doc_type text) returns text language sql immutable set search_path = '' as $$
  select coalesce((select t.label from public.wf_doc_types() t where t.doc_type = p_doc_type), p_doc_type);
$$;

-- doc type of a row of one of the document tables
create or replace function public.wf_doc_type_for(p_entity text, p_entry_type text) returns text language sql immutable set search_path = '' as $$
  select t.doc_type from public.wf_doc_types() t where t.entity = p_entity and (t.entry_type is null or t.entry_type = p_entry_type) limit 1;
$$;

create or replace function public.wf_doc_row(p_doc_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t record; r jsonb;
begin
  select * into t from public.wf_doc_types() x where x.doc_type = p_doc_type;
  if t.entity is null then return null; end if;
  execute format('select to_jsonb(x) from public.%I x where x.id = $1', t.entity) into r using p_id;
  if r is not null and t.entry_type is not null and r->>'entry_type' is distinct from t.entry_type then return null; end if;
  return r;
end $$;
revoke execute on function public.wf_doc_row(text, uuid) from public, anon, authenticated;

-- fields of p_required that are still empty on the document → their labels
create or replace function public.wf_missing(p_company uuid, p_doc_type text, p_id uuid, p_required text[])
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare k text; v_row jsonb := public.wf_doc_row(p_doc_type, p_id); v_entity text; v_out text[] := '{}'; v_lbl text;
begin
  select entity into v_entity from public.wf_doc_types() where doc_type = p_doc_type;
  foreach k in array coalesce(p_required, '{}') loop
    if k like 'core:%' then
      if coalesce(trim(v_row->>substr(k, 6)), '') = '' then
        select label into v_lbl from public.wf_core_fields(v_entity) where key = k;
        v_out := v_out || coalesce(v_lbl, initcap(replace(substr(k, 6), '_', ' ')));
      end if;
    elsif k = 'files' then
      if not exists (select 1 from public.attachments a where a.entity_type = v_entity and a.entity_id = p_id and a.deleted_at is null and a.upload_status = 'UPLOADED') then
        v_out := v_out || 'a file attached'::text;
      end if;
    elsif k like 'cf:%' then
      select d.label into v_lbl from public.custom_field_definitions d where d.id = substr(k, 4)::uuid and d.is_active;
      if v_lbl is not null and not exists (select 1 from public.custom_field_values v where v.field_id = substr(k, 4)::uuid and v.record_id = p_id) then
        v_out := v_out || v_lbl;
      end if;
    end if;
  end loop;
  return v_out;
end $$;
revoke execute on function public.wf_missing(uuid, text, uuid, text[]) from public, anon, authenticated;

-- the step a document is at: (step row, done flag). Not started = first step.
create or replace function public.wf_position(p_def uuid, p_doc_type text, p_id uuid, out step_id uuid, out done boolean)
language plpgsql stable security definer set search_path = '' as $$
declare s public.document_workflows%rowtype;
begin
  select * into s from public.document_workflows where doc_type = p_doc_type and doc_id = p_id and definition_id = p_def;
  if s.completed_at is not null then step_id := null; done := true; return; end if;
  done := false;
  step_id := s.current_step;
  if step_id is null then
    select id into step_id from public.workflow_steps where definition_id = p_def order by seq limit 1;
    if step_id is null then done := true; end if;   -- a workflow without steps holds nothing
  end if;
end $$;
revoke execute on function public.wf_position(uuid, text, uuid) from public, anon, authenticated;

-- Save a whole workflow: { name, description, is_active, include_one_step,
--   steps: [{ id?, key, name, roles[], required_fields[], notify }],
--   transitions: [{ from_key, to_key | null, label, roles[], requires_comment }]  (omitted → forward + send back) }
create or replace function public.save_workflow(p_company uuid, p_doc_type text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.workflow_definitions%rowtype; v_entity text; s jsonb; t jsonb; i int := 0; v_id uuid; v_keep uuid[] := '{}';
  v_map jsonb := '{}'::jsonb; v_keys text[] := '{}'; v_names text[] := '{}'; v_roles text[]; v_req text[]; k text; v_bad text;
  v_active boolean := coalesce((p_data->>'is_active')::boolean, false); n int; v_from uuid; v_to uuid;
begin
  perform public.inv_require(p_company, 'settings.manage');
  select entity into v_entity from public.wf_doc_types() where doc_type = p_doc_type;
  if v_entity is null then raise exception 'Unknown document type %', p_doc_type using errcode = 'P0002'; end if;
  if jsonb_array_length(coalesce(p_data->'steps', '[]')) = 0 and v_active then
    raise exception 'Add at least one step before turning the workflow on' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_data->'steps', '[]')) > 10 then raise exception 'Up to 10 steps' using errcode = '22023'; end if;

  select * into d from public.workflow_definitions where company_id = p_company and doc_type = p_doc_type for update;
  if d.id is null then
    insert into public.workflow_definitions(company_id, doc_type, name, description, is_active, activated_at, include_one_step)
    values (p_company, p_doc_type, coalesce(nullif(trim(p_data->>'name'), ''), public.wf_label(p_doc_type) || ' review'),
      nullif(trim(p_data->>'description'), ''), v_active, case when v_active then now() end, coalesce((p_data->>'include_one_step')::boolean, false))
    returning * into d;
  else
    update public.workflow_definitions set name = coalesce(nullif(trim(p_data->>'name'), ''), name), description = nullif(trim(p_data->>'description'), ''),
      is_active = v_active, activated_at = case when v_active and not d.is_active then now() else activated_at end,
      include_one_step = coalesce((p_data->>'include_one_step')::boolean, include_one_step)
    where id = d.id returning * into d;
  end if;

  -- steps
  for s in select * from jsonb_array_elements(coalesce(p_data->'steps', '[]')) loop
    i := i + 1;
    select coalesce(array_agg(distinct x), '{}') into v_roles from jsonb_array_elements_text(coalesce(s->'roles', '[]')) x;
    if cardinality(v_roles) = 0 then raise exception 'Step "%": choose who acts at this step', coalesce(s->>'name', i::text) using errcode = '22023'; end if;
    select string_agg(x, ', ') into v_bad from unnest(v_roles) x where not exists (select 1 from public.roles r where r.code = x);
    if v_bad is not null then raise exception 'Unknown role %', v_bad using errcode = '22023'; end if;
    select coalesce(array_agg(distinct x), '{}') into v_req from jsonb_array_elements_text(coalesce(s->'required_fields', '[]')) x;
    foreach k in array v_req loop
      if not (exists (select 1 from public.wf_core_fields(v_entity) c where c.key = k)
              or (k like 'cf:%' and exists (select 1 from public.custom_field_definitions c where c.company_id = p_company and c.entity = v_entity
                                              and c.id::text = substr(k, 4) and c.field_type <> 'formula'))) then
        raise exception 'Step "%": unknown field %', s->>'name', k using errcode = '22023';
      end if;
    end loop;
    if trim(coalesce(s->>'name', '')) = '' then raise exception 'Every step needs a name' using errcode = '22023'; end if;
    if trim(s->>'name') = any(v_names) then raise exception 'Two steps are called "%"', trim(s->>'name') using errcode = '22023'; end if;
    v_names := v_names || trim(s->>'name');
    v_id := nullif(s->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.workflow_steps where id = v_id and definition_id = d.id) then
      update public.workflow_steps set seq = i * 10, name = trim(s->>'name'), roles = v_roles, required_fields = v_req,
        notify = coalesce((s->>'notify')::boolean, true) where id = v_id;
    else
      insert into public.workflow_steps(company_id, definition_id, seq, name, roles, required_fields, notify)
      values (p_company, d.id, i * 10, trim(s->>'name'), v_roles, v_req, coalesce((s->>'notify')::boolean, true)) returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
    k := coalesce(nullif(s->>'key', ''), v_id::text);
    v_keys := v_keys || k;
    v_map := v_map || jsonb_build_object(k, v_id);
  end loop;
  -- documents at a removed step go back to the first step (current_step → null by the FK)
  delete from public.workflow_steps where definition_id = d.id and not (id = any(v_keep));

  -- transitions
  delete from public.workflow_transitions where definition_id = d.id;
  n := cardinality(v_keep);
  if p_data ? 'transitions' and jsonb_array_length(p_data->'transitions') > 0 then
    i := 0;
    for t in select * from jsonb_array_elements(p_data->'transitions') loop
      i := i + 1;
      v_from := (v_map->>(t->>'from_key'))::uuid;
      v_to := case when nullif(t->>'to_key', '') is null then null else (v_map->>(t->>'to_key'))::uuid end;
      if v_from is null or (nullif(t->>'to_key', '') is not null and v_to is null) then
        raise exception 'A transition points to a step that does not exist' using errcode = '22023';
      end if;
      if v_from = v_to then raise exception 'A transition must go to another step' using errcode = '22023'; end if;
      select coalesce(array_agg(distinct x), '{}') into v_roles from jsonb_array_elements_text(coalesce(t->'roles', '[]')) x;
      insert into public.workflow_transitions(company_id, definition_id, from_step, to_step, label, roles, requires_comment, sort)
      values (p_company, d.id, v_from, v_to, coalesce(nullif(trim(t->>'label'), ''), 'Next'), v_roles, coalesce((t->>'requires_comment')::boolean, false), i);
    end loop;
  else
    for i in 1 .. n loop
      insert into public.workflow_transitions(company_id, definition_id, from_step, to_step, label, roles, requires_comment, sort)
      values (p_company, d.id, v_keep[i], case when i < n then v_keep[i + 1] end,
              case when i < n then 'Pass to ' || v_names[i + 1] else 'Mark ready' end, '{}', false, 1);
      if i > 1 then
        insert into public.workflow_transitions(company_id, definition_id, from_step, to_step, label, roles, requires_comment, sort)
        values (p_company, d.id, v_keep[i], v_keep[i - 1], 'Send back to ' || v_names[i - 1], '{}', true, 2);
      end if;
    end loop;
  end if;
  -- every step must have a way forward
  if v_active and exists (select 1 from public.workflow_steps s where s.definition_id = d.id
       and not exists (select 1 from public.workflow_transitions x where x.from_step = s.id
                       and (x.to_step is null or (select seq from public.workflow_steps where id = x.to_step) > s.seq))) then
    raise exception 'Every step needs a transition forward (to a later step or "ready")' using errcode = '22023';
  end if;
  return d.id;
end $$;
revoke execute on function public.save_workflow(uuid, text, jsonb) from public, anon;
grant execute on function public.save_workflow(uuid, text, jsonb) to authenticated;

-- Workflow state of one document, for the bar on the document.
create or replace function public.workflow_state(p_company uuid, p_doc_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t record; d public.workflow_definitions%rowtype; v_row jsonb; pos record; v_roles text[]; cur public.workflow_steps%rowtype;
  v_applies boolean; v_cf text[];
begin
  select * into t from public.wf_doc_types() x where x.doc_type = p_doc_type;
  if t.doc_type is null or not public.has_permission(p_company, t.view_perm) then return null; end if;
  v_row := public.wf_doc_row(p_doc_type, p_id);
  if v_row is null or (v_row->>'company_id')::uuid <> p_company then return null; end if;
  v_cf := case when v_row->>'status' = 'DRAFT' then public.cf_missing_required(p_company, t.entity, p_id) else '{}' end;
  select * into d from public.workflow_definitions where company_id = p_company and doc_type = p_doc_type;
  if d.id is null or (not d.is_active and not exists (select 1 from public.document_workflow_events e where e.doc_type = p_doc_type and e.doc_id = p_id)) then
    return jsonb_build_object('active', false, 'cf_missing', to_jsonb(v_cf), 'gate', t.gate);
  end if;
  v_applies := d.is_active and v_row->>'status' = 'DRAFT' and (v_row->>'created_at')::timestamptz >= d.activated_at;
  select * into pos from public.wf_position(d.id, p_doc_type, p_id);
  select * into cur from public.workflow_steps where id = pos.step_id;
  v_roles := public.my_role_codes(p_company);
  return jsonb_build_object(
    'active', d.is_active, 'applies', v_applies, 'name', d.name, 'done', pos.done, 'gate', t.gate, 'status', v_row->>'status',
    'cf_missing', to_jsonb(v_cf),
    'current', case when cur.id is null then null else jsonb_build_object('id', cur.id, 'name', cur.name, 'roles', cur.roles,
       'role_names', public.approval_role_names(cur.roles), 'missing', to_jsonb(public.wf_missing(p_company, p_doc_type, p_id, cur.required_fields))) end,
    'steps', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role_names', public.approval_role_names(s.roles),
                'state', case when pos.done then 'done' when s.id = cur.id then 'current' when s.seq < cur.seq then 'done' else 'todo' end) order by s.seq), '[]')
              from public.workflow_steps s where s.definition_id = d.id),
    'actions', case when not v_applies or cur.id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.label, 'requires_comment', x.requires_comment,
               'to', coalesce(ts.name, 'Ready'), 'kind', case when x.to_step is null then 'finish' when ts.seq > cur.seq then 'forward' else 'back' end,
               'allowed', (case when cardinality(x.roles) > 0 then x.roles else cur.roles end) && v_roles) order by x.sort), '[]')
      from public.workflow_transitions x left join public.workflow_steps ts on ts.id = x.to_step where x.from_step = cur.id) end,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'by', coalesce(p.full_name, p.email), 'label', e.label,
                 'from', e.from_step, 'to', e.to_step, 'comment', e.comment) order by e.created_at desc), '[]')
               from public.document_workflow_events e left join public.profiles p on p.id = e.created_by
               where e.doc_type = p_doc_type and e.doc_id = p_id));
end $$;
revoke execute on function public.workflow_state(uuid, text, uuid) from public, anon;
grant execute on function public.workflow_state(uuid, text, uuid) to authenticated;

-- Move a document along one transition.
create or replace function public.workflow_move(p_company uuid, p_doc_type text, p_id uuid, p_transition uuid, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t record; d public.workflow_definitions%rowtype; v_row jsonb; pos record; cur public.workflow_steps%rowtype; x public.workflow_transitions%rowtype;
  ts public.workflow_steps%rowtype; v_missing text[]; v_forward boolean;
begin
  select * into t from public.wf_doc_types() y where y.doc_type = p_doc_type;
  if t.doc_type is null then raise exception 'Unknown document type' using errcode = 'P0002'; end if;
  perform public.inv_require(p_company, t.view_perm);
  if not public.cf_record_visible(p_company, t.entity, p_id) then raise exception 'You do not have access to this document' using errcode = '42501'; end if;
  select * into d from public.workflow_definitions where company_id = p_company and doc_type = p_doc_type and is_active;
  if d.id is null then raise exception 'There is no active workflow for %', lower(t.label) using errcode = '22023'; end if;
  -- lock the document's workflow row (create it on the first move)
  insert into public.document_workflows(company_id, doc_type, doc_id, definition_id) values (p_company, p_doc_type, p_id, d.id)
  on conflict (doc_type, doc_id) do nothing;
  perform 1 from public.document_workflows where doc_type = p_doc_type and doc_id = p_id for update;
  update public.document_workflows set definition_id = d.id where doc_type = p_doc_type and doc_id = p_id and definition_id <> d.id;
  v_row := public.wf_doc_row(p_doc_type, p_id);
  if v_row is null or (v_row->>'company_id')::uuid <> p_company then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if v_row->>'status' <> 'DRAFT' then raise exception 'The document is no longer waiting (%)', lower(v_row->>'status') using errcode = '22023'; end if;
  if (v_row->>'created_at')::timestamptz < d.activated_at then raise exception 'This document was made before the workflow was turned on — it does not need the steps' using errcode = '22023'; end if;
  select * into pos from public.wf_position(d.id, p_doc_type, p_id);
  if pos.done then raise exception 'The review steps are already finished' using errcode = '22023'; end if;
  select * into cur from public.workflow_steps where id = pos.step_id;
  select * into x from public.workflow_transitions where id = p_transition and definition_id = d.id;
  if x.id is null or x.from_step <> cur.id then raise exception 'That action is not available at step "%" — refresh the document', cur.name using errcode = '22023'; end if;
  if not ((case when cardinality(x.roles) > 0 then x.roles else cur.roles end) && public.my_role_codes(p_company)) then
    raise exception 'Only % can do "%" at step "%"', public.approval_role_names(case when cardinality(x.roles) > 0 then x.roles else cur.roles end), x.label, cur.name using errcode = '42501';
  end if;
  if x.requires_comment and length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Write a comment for "%"', x.label using errcode = '22023'; end if;
  select * into ts from public.workflow_steps where id = x.to_step;
  v_forward := x.to_step is null or ts.seq > cur.seq;
  if v_forward then
    v_missing := public.wf_missing(p_company, p_doc_type, p_id, cur.required_fields);
    if cardinality(v_missing) > 0 then
      raise exception 'Fill in before "%": %', x.label, array_to_string(v_missing, ', ') using errcode = '23502';
    end if;
  end if;
  update public.document_workflows set current_step = x.to_step,
    completed_at = case when x.to_step is null then now() end, completed_by = case when x.to_step is null then auth.uid() end, updated_at = now()
  where doc_type = p_doc_type and doc_id = p_id;
  insert into public.document_workflow_events(company_id, doc_type, doc_id, from_step, to_step, label, comment)
  values (p_company, p_doc_type, p_id, cur.name, coalesce(ts.name, 'Ready to ' || t.gate), x.label, nullif(trim(coalesce(p_comment, '')), ''));
  return public.workflow_state(p_company, p_doc_type, p_id);
end $$;
revoke execute on function public.workflow_move(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.workflow_move(uuid, text, uuid, uuid, text) to authenticated;

-- Gate: approve / post / dispatch / send is refused while the steps are not finished or a required
-- document field is empty. Documents made and finished in one step (quick invoice, Pay now …) are
-- held only when the workflow says so. System work (no user) is never held.
create or replace function public.tg_doc_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_label text; v_gate text; d public.workflow_definitions%rowtype; pos record; cur public.workflow_steps%rowtype;
  v_one_step boolean; v_missing text[]; v_no text;
begin
  if auth.uid() is null then return new; end if;
  if not (old.status = 'DRAFT' and new.status not in ('DRAFT','CANCELLED','REJECTED')) then return new; end if;
  v_type := public.wf_doc_type_for(tg_table_name, case when tg_table_name = 'journal_entries' then to_jsonb(new)->>'entry_type' end);
  if v_type is null then return new; end if;
  select label, gate into v_label, v_gate from public.wf_doc_types() where doc_type = v_type;
  v_no := coalesce(to_jsonb(new)->>'doc_no', to_jsonb(new)->>'entry_no', '');
  v_one_step := old.created_at = now();   -- made in this same transaction

  if not v_one_step then
    v_missing := public.cf_missing_required(new.company_id, tg_table_name, new.id);
    if cardinality(v_missing) > 0 then
      raise exception '%', format('%s %s: fill in %s before you %s it.', v_label, v_no, array_to_string(v_missing, ', '), v_gate) using errcode = '23502';
    end if;
  end if;

  select * into d from public.workflow_definitions where company_id = new.company_id and doc_type = v_type and is_active;
  if d.id is null or old.created_at < d.activated_at or (v_one_step and not d.include_one_step) then return new; end if;
  select * into pos from public.wf_position(d.id, v_type, new.id);
  if pos.done then return new; end if;
  select * into cur from public.workflow_steps where id = pos.step_id;
  raise exception '%', format('%s %s is at review step "%s" (%s). Finish the steps before you %s it.',
    v_label, v_no, cur.name, public.approval_role_names(cur.roles), v_gate) using errcode = '42501';
end $$;
revoke execute on function public.tg_doc_gate() from public, anon, authenticated;

create trigger doc_gate before update of status on public.sales_orders      for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.quotations        for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.gdns              for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.sales_invoices    for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.purchase_orders   for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.goods_receipts    for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.supplier_bills    for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.journal_entries   for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.stock_adjustments for each row execute function public.tg_doc_gate();
create trigger doc_gate before update of status on public.stock_transfers   for each row execute function public.tg_doc_gate();

-- documents waiting at a step (for notifications and the dashboard)
create or replace function public.workflow_pending(p_company uuid)
returns table(doc_type text, doc_id uuid, doc_no text, step_id uuid, step_name text, roles text[], notify boolean, view_perm text, link text, label text)
language plpgsql stable security definer set search_path = '' as $$
declare d record; r record;
begin
  for d in select w.*, t.entity, t.entry_type, t.view_perm, t.link, t.label as tlabel
           from public.workflow_definitions w join public.wf_doc_types() t on t.doc_type = w.doc_type
           where w.company_id = p_company and w.is_active loop
    for r in execute format('select id, %s as no from public.%I where company_id = $1 and status = ''DRAFT'' and created_at >= $2 %s order by created_at desc limit 100',
                            case when d.entity = 'journal_entries' then 'entry_no' else 'doc_no' end, d.entity,
                            case when d.entry_type is not null then format('and entry_type = %L', d.entry_type) else '' end)
             using p_company, d.activated_at loop
      select s.id, s.name, s.roles, s.notify into step_id, step_name, roles, notify
        from public.workflow_steps s where s.id = (select p.step_id from public.wf_position(d.id, d.doc_type, r.id) p);
      continue when step_id is null;
      doc_type := d.doc_type; doc_id := r.id; doc_no := r.no; view_perm := d.view_perm; link := d.link || r.id; label := d.tlabel;
      return next;
    end loop;
  end loop;
end $$;
revoke execute on function public.workflow_pending(uuid) from public, anon, authenticated;

-- =====================================================================
-- 3. CONFIGURABLE FORMS PER ROLE (master records)
-- =====================================================================
create table if not exists public.form_layouts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  entity          text not null check (entity in ('customers','customer_groups','suppliers','products','warehouses','employees','bank_accounts','payment_agents')),
  role_code       text not null,
  hidden_fields   text[] not null default '{}',
  required_fields text[] not null default '{}',
  hidden_sections text[] not null default '{}',
  open_sections   text[] not null default '{}',
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  unique (company_id, entity, role_code)
);
create trigger stamp before insert or update on public.form_layouts for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.form_layouts for each row execute function public.tg_audit_row();
alter table public.form_layouts enable row level security;
create policy fl_select on public.form_layouts for select using (public.is_company_member(company_id));

create or replace function public.save_form_layout(p_company uuid, p_entity text, p_role text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hidden text[]; v_req text[]; v_hs text[]; v_os text[]; v_bad text;
begin
  perform public.inv_require(p_company, 'settings.manage');
  if not exists (select 1 from public.roles where code = p_role) then raise exception 'Unknown role' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_hidden from jsonb_array_elements_text(coalesce(p_data->'hidden_fields', '[]')) x;
  select coalesce(array_agg(distinct x), '{}') into v_req from jsonb_array_elements_text(coalesce(p_data->'required_fields', '[]')) x;
  select coalesce(array_agg(distinct x), '{}') into v_hs from jsonb_array_elements_text(coalesce(p_data->'hidden_sections', '[]')) x where x ~ '^[a-z0-9_]{1,40}$';
  select coalesce(array_agg(distinct x), '{}') into v_os from jsonb_array_elements_text(coalesce(p_data->'open_sections', '[]')) x where x ~ '^[a-z0-9_]{1,40}$';
  select string_agg(x, ', ') into v_bad from unnest(v_hidden || v_req) x
   where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = p_entity and c.column_name = x)
      or x in ('id','company_id','created_at','created_by','updated_at','updated_by');
  if v_bad is not null then raise exception 'Unknown field(s): %', v_bad using errcode = '22023'; end if;
  if v_hidden && v_req then raise exception 'A field cannot be hidden and required at the same time' using errcode = '22023'; end if;
  if cardinality(v_hidden) + cardinality(v_req) + cardinality(v_hs) + cardinality(v_os) = 0 then
    delete from public.form_layouts where company_id = p_company and entity = p_entity and role_code = p_role;
    return;
  end if;
  insert into public.form_layouts(company_id, entity, role_code, hidden_fields, required_fields, hidden_sections, open_sections)
  values (p_company, p_entity, p_role, v_hidden, v_req, v_hs, v_os)
  on conflict (company_id, entity, role_code) do update set hidden_fields = excluded.hidden_fields, required_fields = excluded.required_fields,
    hidden_sections = excluded.hidden_sections, open_sections = excluded.open_sections;
end $$;
revoke execute on function public.save_form_layout(uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_form_layout(uuid, text, text, jsonb) to authenticated;

-- fields required for the user's role: new records must have them, existing values cannot be cleared
create or replace function public.tg_form_required()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_req text[]; f text; v_new jsonb; v_old jsonb;
begin
  if auth.uid() is null then return new; end if;
  select coalesce(array_agg(distinct x), '{}') into v_req
    from public.form_layouts l cross join unnest(l.required_fields) x
   where l.company_id = new.company_id and l.entity = tg_table_name and l.role_code = any(public.my_role_codes(new.company_id));
  if cardinality(v_req) = 0 then return new; end if;
  v_new := to_jsonb(new);
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  foreach f in array v_req loop
    if coalesce(trim(v_new->>f), '') = '' and (tg_op = 'INSERT' or coalesce(trim(v_old->>f), '') <> '') then
      raise exception '"%" is required', initcap(replace(regexp_replace(f, '_id$', ''), '_', ' ')) using errcode = '23502';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.tg_form_required() from public, anon, authenticated;
create trigger form_required before insert or update on public.customers       for each row execute function public.tg_form_required();
create trigger form_required before insert or update on public.customer_groups for each row execute function public.tg_form_required();
create trigger form_required before insert or update on public.suppliers       for each row execute function public.tg_form_required();
create trigger form_required before insert or update on public.products        for each row execute function public.tg_form_required();
create trigger form_required before insert or update on public.warehouses      for each row execute function public.tg_form_required();
create trigger form_required before insert or update on public.employees       for each row execute function public.tg_form_required();
create trigger form_required before insert or update on public.bank_accounts   for each row execute function public.tg_form_required();
create trigger form_required before insert or update on public.payment_agents  for each row execute function public.tg_form_required();

-- =====================================================================
-- 4. NOTIFICATIONS: workflow rule + e-mail / WhatsApp delivery
-- =====================================================================
create or replace function public.notification_catalog()
returns table(code text, category text, label text, description text, permission text, default_roles text[], default_params jsonb, sort int)
language sql immutable set search_path = '' as $$
  values
  ('APPROVAL_LIMIT','Approvals','Above approval limit','Documents waiting that are above an approval limit — sent to the roles allowed to approve them (Settings → Approvals).', null, array['ADMINISTRATOR','OWNER'], '{}'::jsonb, 10),
  ('WORKFLOW_STEP','Approvals','Waiting at your review step','A document is at a workflow step you act on (Settings → Workflows) — sent to the roles of that step.', null, array['ADMINISTRATOR','OWNER'], '{}'::jsonb, 15),
  ('SO_APPROVAL','Approvals','Sales order awaiting approval','A sales order is saved and waiting to be approved.', 'sales.approve', array['ADMINISTRATOR','WAREHOUSE_MANAGER'], '{}'::jsonb, 20),
  ('PO_APPROVAL','Approvals','Purchase order awaiting approval','A purchase order is saved and waiting to be approved.', 'purchasing.approve', array['ADMINISTRATOR','OWNER'], '{}'::jsonb, 30),
  ('ADJUSTMENT_PENDING','Warehouse','Stock adjustment awaiting posting','An adjustment (or opening stock) is saved as draft and needs posting.', 'inventory.post', array['ADMINISTRATOR','WAREHOUSE_MANAGER'], '{}'::jsonb, 40),
  ('TRANSFER_PENDING','Warehouse','Transfer awaiting posting','A stock transfer is saved as draft and needs posting.', 'inventory.post', array['ADMINISTRATOR','WAREHOUSE_MANAGER'], '{}'::jsonb, 50),
  ('COUNT_REVIEW','Warehouse','Stock count submitted','A stock count has been submitted and needs review.', 'inventory.post', array['ADMINISTRATOR','WAREHOUSE_MANAGER'], '{}'::jsonb, 60),
  ('LOW_STOCK','Warehouse','Low stock','An item''s total stock is at or below its reorder level.', 'inventory.view', array['ADMINISTRATOR','WAREHOUSE_MANAGER','OWNER'], '{}'::jsonb, 70),
  ('PRICE_PENDING','Sales','GDN awaiting price','Goods were dispatched without a selling price — the price must be entered.', 'pricing.enter', array['ADMINISTRATOR','OWNER','SALESPERSON'], '{}'::jsonb, 80),
  ('PRICE_APPROVAL','Sales','Prices submitted for approval','Prices were entered and are waiting for approval.', 'pricing.approve', array['ADMINISTRATOR','OWNER'], '{}'::jsonb, 90),
  ('INVOICE_DRAFT','Sales','Invoice awaiting posting','A sales invoice is saved as draft and needs posting.', 'sales.invoice', array['ADMINISTRATOR','ACCOUNTANT'], '{}'::jsonb, 100),
  ('PAYMENT_RECEIVED','Sales','Payment received','A receipt voucher was posted.', 'journals.view', array['ADMINISTRATOR','OWNER'], '{"days":1}'::jsonb, 110),
  ('COST_PENDING','Purchasing','Purchase cost pending','Goods were received without a cost — the cost must be entered.', 'purchasing.costs', array['ADMINISTRATOR','ACCOUNTANT'], '{}'::jsonb, 120),
  ('COST_APPROVAL','Purchasing','Purchase costs submitted','Costs were entered and are waiting for approval.', 'purchasing.approve', array['ADMINISTRATOR','OWNER'], '{}'::jsonb, 130),
  ('BILL_DRAFT','Purchasing','Supplier bill awaiting posting','A supplier bill is saved as draft and needs posting.', 'purchasing.approve', array['ADMINISTRATOR','ACCOUNTANT'], '{}'::jsonb, 140),
  ('SHIPMENT_ETA','Purchasing','Shipment arriving','A shipment''s ETA is within the next days (or passed without arrival).', 'purchasing.view', array['ADMINISTRATOR','OWNER','ACCOUNTANT'], '{"days":7}'::jsonb, 150),
  ('PDC_DUE','Finance','Cheque due','A post-dated cheque held is due within the next days.', 'pdc.manage', array['ADMINISTRATOR','ACCOUNTANT'], '{"days":3}'::jsonb, 160),
  ('PDC_BOUNCED','Finance','Cheque bounced','A cheque has bounced.', 'journals.view', array['ADMINISTRATOR','ACCOUNTANT','OWNER'], '{}'::jsonb, 170),
  ('PAYROLL_PENDING','HR & payroll','Payroll awaiting approval / posting','A payroll run is calculated and waiting for approval, or approved and waiting to be posted.', 'payroll.view', array['ADMINISTRATOR','OWNER','ACCOUNTANT'], '{}'::jsonb, 180),
  ('ADVANCE_REQUEST','HR & payroll','Advance requested','An employee advance is requested and waiting for a decision.', 'payroll.manage', array['ADMINISTRATOR','ACCOUNTANT'], '{}'::jsonb, 190),
  ('LEAVE_REQUEST','HR & payroll','Leave requested','A leave request is waiting for a decision.', 'payroll.manage', array['ADMINISTRATOR','ACCOUNTANT'], '{}'::jsonb, 200),
  ('LABOUR_APPROVAL','HR & payroll','Assembly labour awaiting approval','Assembly work is completed and the labour quantities need approval.', 'labour.supervise', array['ADMINISTRATOR','WAREHOUSE_MANAGER'], '{}'::jsonb, 210)
$$;

-- ---------------------------------------------------------------- delivery settings
create table if not exists public.notification_channels (
  company_id        uuid primary key references public.companies(id),
  email_on          boolean not null default false,
  whatsapp_on       boolean not null default false,
  email_from_name   text not null default 'JS Traders ERP' check (length(email_from_name) between 1 and 60),
  whatsapp_template text not null default 'erp_alert' check (whatsapp_template ~ '^[a-z0-9_]{1,60}$'),
  whatsapp_lang     text not null default 'en' check (whatsapp_lang ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  app_url           text not null default 'https://js-traders-accounts-app-1fsw.vercel.app' check (app_url ~ '^https://'),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);
create trigger stamp before insert or update on public.notification_channels for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.notification_channels for each row execute function public.tg_audit_row();
alter table public.notification_channels enable row level security;
create policy nch_select on public.notification_channels for select using (public.is_company_member(company_id));

create table if not exists public.user_notification_prefs (
  company_id     uuid not null references public.companies(id),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  email_on       boolean not null default false,
  whatsapp_on    boolean not null default false,
  email          text check (email is null or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  whatsapp_phone text check (whatsapp_phone is null or whatsapp_phone ~ '^[1-9][0-9]{9,14}$'),   -- international, digits only: 923001234567
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  primary key (company_id, user_id)
);
create trigger stamp before insert or update on public.user_notification_prefs for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.user_notification_prefs for each row execute function public.tg_audit_row();
alter table public.user_notification_prefs enable row level security;
create policy unp_select on public.user_notification_prefs for select
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'settings.manage'));

create table if not exists public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  notification_id uuid references public.notifications(id) on delete set null,
  user_id         uuid references public.profiles(id) on delete cascade,
  channel         text not null check (channel in ('EMAIL','WHATSAPP')),
  recipient       text not null,
  subject         text not null,
  body            text,
  link            text,
  status          text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
  attempts        int not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists nob_pending_idx on public.notification_outbox(status, created_at) where status in ('PENDING','SENDING');
create index if not exists nob_company_idx on public.notification_outbox(company_id, created_at desc);
alter table public.notification_outbox enable row level security;
create policy nob_select on public.notification_outbox for select
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'settings.manage'));

create or replace function public.save_notification_channels(p_company uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company, 'settings.manage');
  insert into public.notification_channels(company_id, email_on, whatsapp_on, email_from_name, whatsapp_template, whatsapp_lang, app_url)
  values (p_company, coalesce((p_data->>'email_on')::boolean, false), coalesce((p_data->>'whatsapp_on')::boolean, false),
    coalesce(nullif(trim(p_data->>'email_from_name'), ''), 'JS Traders ERP'), coalesce(nullif(trim(p_data->>'whatsapp_template'), ''), 'erp_alert'),
    coalesce(nullif(trim(p_data->>'whatsapp_lang'), ''), 'en'), coalesce(nullif(trim(p_data->>'app_url'), ''), 'https://js-traders-accounts-app-1fsw.vercel.app'))
  on conflict (company_id) do update set email_on = excluded.email_on, whatsapp_on = excluded.whatsapp_on, email_from_name = excluded.email_from_name,
    whatsapp_template = excluded.whatsapp_template, whatsapp_lang = excluded.whatsapp_lang, app_url = excluded.app_url;
end $$;
revoke execute on function public.save_notification_channels(uuid, jsonb) from public, anon;
grant execute on function public.save_notification_channels(uuid, jsonb) to authenticated;

-- a person's own delivery settings, or anyone's for an administrator (settings.manage)
create or replace function public.save_notification_pref(p_company uuid, p_user uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text := nullif(regexp_replace(coalesce(p_data->>'whatsapp_phone', ''), '[^0-9]', '', 'g'), '');
begin
  if p_user is distinct from auth.uid() then perform public.inv_require(p_company, 'settings.manage'); end if;
  if not exists (select 1 from public.user_roles where user_id = p_user and company_id = p_company) then
    raise exception 'This person is not a user of the company' using errcode = '22023';
  end if;
  if v_phone like '03%' and length(v_phone) = 11 then v_phone := '92' || substr(v_phone, 2); end if;   -- Pakistani mobile 03xx → 923xx
  if v_phone is not null and v_phone !~ '^[1-9][0-9]{9,14}$' then
    raise exception 'Enter the WhatsApp number with country code, e.g. 923001234567' using errcode = '22023';
  end if;
  insert into public.user_notification_prefs(company_id, user_id, email_on, whatsapp_on, email, whatsapp_phone)
  values (p_company, p_user, coalesce((p_data->>'email_on')::boolean, false), coalesce((p_data->>'whatsapp_on')::boolean, false),
          nullif(trim(p_data->>'email'), ''), v_phone)
  on conflict (company_id, user_id) do update set email_on = excluded.email_on, whatsapp_on = excluded.whatsapp_on,
    email = excluded.email, whatsapp_phone = excluded.whatsapp_phone;
end $$;
revoke execute on function public.save_notification_pref(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_notification_pref(uuid, uuid, jsonb) to authenticated;

-- users of the company with their delivery settings (administrators)
create or replace function public.notification_delivery_users(p_company uuid)
returns table(user_id uuid, full_name text, login_email text, roles text, email_on boolean, whatsapp_on boolean, email text, whatsapp_phone text,
              sent_7d bigint, failed_7d bigint, last_error text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, (select string_agg(distinct r.name, ', ') from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id and ur.company_id = p_company),
    coalesce(u.email_on, false), coalesce(u.whatsapp_on, false), u.email, coalesce(u.whatsapp_phone, nullif(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), '')),
    (select count(*) from public.notification_outbox o where o.user_id = p.id and o.company_id = p_company and o.status = 'SENT' and o.created_at > now() - interval '7 days'),
    (select count(*) from public.notification_outbox o where o.user_id = p.id and o.company_id = p_company and o.status = 'FAILED' and o.created_at > now() - interval '7 days'),
    (select o.last_error from public.notification_outbox o where o.user_id = p.id and o.company_id = p_company and o.status in ('FAILED','SKIPPED') order by o.created_at desc limit 1)
  from public.profiles p
  left join public.user_notification_prefs u on u.user_id = p.id and u.company_id = p_company
  where public.has_permission(p_company, 'settings.manage') and p.is_active
    and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.company_id = p_company)
    and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                where ur.user_id = p.id and ur.company_id = p_company and r.code <> 'WAREHOUSE_STAFF')   -- staff get alarms in the picking app
  order by p.full_name;
$$;
revoke execute on function public.notification_delivery_users(uuid) from public, anon;
grant execute on function public.notification_delivery_users(uuid) to authenticated;

-- a new in-app notification also goes out by e-mail / WhatsApp when the company, the rule and the person say so
create or replace function public.tg_notification_outbox()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.notification_channels%rowtype; u public.user_notification_prefs%rowtype; v_params jsonb; v_email text; v_phone text; v_link text;
begin
  select * into c from public.notification_channels where company_id = new.company_id;
  if c.company_id is null or not (c.email_on or c.whatsapp_on) then return new; end if;
  select * into u from public.user_notification_prefs where company_id = new.company_id and user_id = new.user_id;
  if u.user_id is null or not (u.email_on or u.whatsapp_on) then return new; end if;
  select coalesce(params, '{}'::jsonb) into v_params from public.notification_rules where company_id = new.company_id and code = new.rule_code;
  v_params := coalesce(v_params, '{}'::jsonb);
  v_link := case when new.link is null then null else rtrim(c.app_url, '/') || new.link end;
  if c.email_on and u.email_on and coalesce((v_params->>'email')::boolean, false) then
    v_email := coalesce(u.email, (select email from public.profiles where id = new.user_id));
    if v_email is not null then
      insert into public.notification_outbox(company_id, notification_id, user_id, channel, recipient, subject, body, link)
      values (new.company_id, new.id, new.user_id, 'EMAIL', v_email, new.title, new.body, v_link);
    end if;
  end if;
  if c.whatsapp_on and u.whatsapp_on and coalesce((v_params->>'whatsapp')::boolean, false) then
    v_phone := coalesce(u.whatsapp_phone, nullif(regexp_replace(coalesce((select phone from public.profiles where id = new.user_id), ''), '[^0-9]', '', 'g'), ''));
    if v_phone is not null then
      insert into public.notification_outbox(company_id, notification_id, user_id, channel, recipient, subject, body, link)
      values (new.company_id, new.id, new.user_id, 'WHATSAPP', v_phone, new.title, new.body, v_link);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_notification_outbox() from public, anon, authenticated;
create trigger outbox after insert on public.notifications for each row execute function public.tg_notification_outbox();

-- test message to yourself
create or replace function public.notify_test(p_company uuid, p_channel text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u public.user_notification_prefs%rowtype; v_to text; v_id uuid; c public.notification_channels%rowtype;
begin
  perform public.inv_require(p_company, 'settings.manage');
  select * into c from public.notification_channels where company_id = p_company;
  select * into u from public.user_notification_prefs where company_id = p_company and user_id = auth.uid();
  if p_channel = 'EMAIL' then v_to := coalesce(u.email, (select email from public.profiles where id = auth.uid()));
  elsif p_channel = 'WHATSAPP' then v_to := coalesce(u.whatsapp_phone, nullif(regexp_replace(coalesce((select phone from public.profiles where id = auth.uid()), ''), '[^0-9]', '', 'g'), ''));
  else raise exception 'Unknown channel' using errcode = '22023'; end if;
  if v_to is null then raise exception 'Add your % in the list below first', case when p_channel = 'EMAIL' then 'e-mail' else 'WhatsApp number' end using errcode = '22023'; end if;
  insert into public.notification_outbox(company_id, user_id, channel, recipient, subject, body, link)
  values (p_company, auth.uid(), p_channel, v_to, 'Test message from JS Traders ERP', 'If you can read this, ' || case when p_channel = 'EMAIL' then 'e-mail' else 'WhatsApp' end || ' alerts are working.',
          coalesce(rtrim(c.app_url, '/'), 'https://js-traders-accounts-app-1fsw.vercel.app'))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.notify_test(uuid, text) from public, anon;
grant execute on function public.notify_test(uuid, text) to authenticated;

-- edge function (service role) takes a batch to send, then reports each result
create or replace function public.notify_outbox_claim(p_limit int default 25)
returns table(id uuid, company_id uuid, channel text, recipient text, subject text, body text, link text,
              email_from_name text, whatsapp_template text, whatsapp_lang text)
language sql security definer set search_path = '' as $$
  with picked as (
    select o.id from public.notification_outbox o
    where (o.status = 'PENDING' or (o.status = 'SENDING' and o.created_at < now() - interval '10 minutes')) and o.attempts < 3
      and o.created_at > now() - interval '2 days'
    order by o.created_at limit greatest(1, least(p_limit, 100))
    for update skip locked),
  upd as (update public.notification_outbox o set status = 'SENDING', attempts = o.attempts + 1 from picked where o.id = picked.id returning o.*)
  select u.id, u.company_id, u.channel, u.recipient, u.subject, u.body, u.link,
    coalesce(c.email_from_name, 'JS Traders ERP'), coalesce(c.whatsapp_template, 'erp_alert'), coalesce(c.whatsapp_lang, 'en')
  from upd u left join public.notification_channels c on c.company_id = u.company_id;
$$;
create or replace function public.notify_outbox_result(p_id uuid, p_status text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.notification_outbox set status = case when p_status in ('SENT','FAILED','SKIPPED','PENDING') then p_status else 'FAILED' end,
    last_error = left(p_error, 500), sent_at = case when p_status = 'SENT' then now() else sent_at end
  where id = p_id;
$$;
revoke execute on function public.notify_outbox_claim(int) from public, anon, authenticated;
revoke execute on function public.notify_outbox_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notify_outbox_claim(int) to service_role;
grant execute on function public.notify_outbox_result(uuid, text, text) to service_role;

-- Background sweep: evaluate the rules for everyone who gets e-mail / WhatsApp, so alerts go out
-- even when nobody has the app open. Runs as each person (their permissions and roles apply).
create or replace function public.notifications_sweep()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select u.company_id, u.user_id from public.user_notification_prefs u join public.profiles p on p.id = u.user_id and p.is_active
           join public.notification_channels c on c.company_id = u.company_id
           where (u.email_on and c.email_on) or (u.whatsapp_on and c.whatsapp_on) loop
    perform set_config('request.jwt.claim.sub', r.user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    begin
      perform public.refresh_my_notifications(r.company_id);
      n := n + 1;
    exception when others then null;   -- one person's problem never stops the others
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  delete from public.notification_outbox where created_at < now() - interval '60 days';
  return n;
end $$;
revoke execute on function public.notifications_sweep() from public, anon, authenticated;

-- refresh_my_notifications: add the WORKFLOW_STEP rule (goes to the roles of the step) to the Stage 12 function
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.refresh_my_notifications(uuid)'::regprocedure);
  if position('WORKFLOW_STEP' in d) > 0 then return; end if;
  d := replace(d, $x$if r.code <> 'APPROVAL_LIMIT' then$x$, $x$if r.code not in ('APPROVAL_LIMIT','WORKFLOW_STEP') then$x$);
  d := replace(d, $x$    when 'SO_APPROVAL' then$x$, $x$    when 'WORKFLOW_STEP' then
      select jsonb_agg(jsonb_build_object('k', 'WF:' || w.doc_id || ':' || w.step_id, 'sev', 'info',
        'title', w.label || ' ' || w.doc_no || ' — ' || w.step_name,
        'body', 'Waiting at review step "' || w.step_name || '"', 'link', w.link))
      into v_add from public.workflow_pending(p_company) w
      where w.notify and w.roles && v_roles and public.has_permission(p_company, w.view_perm);
    when 'SO_APPROVAL' then$x$);
  if position($x$'WORKFLOW_STEP')$x$ in d) = 0 or position($x$when 'WORKFLOW_STEP' then$x$ in d) = 0 then
    raise exception 'Could not add the workflow rule to refresh_my_notifications';
  end if;
  execute d;
end $patch$;
