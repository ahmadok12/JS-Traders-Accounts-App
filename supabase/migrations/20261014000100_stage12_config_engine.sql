-- =====================================================================
-- JS Traders ERP — Stage 12: configuration and document engine (spec §19, §21, Stage 12)
--   1. Document numbering: edited only through set_numbering_sequence (never lowered)
--   2. Custom fields for master records (typed values, filterable)
--   3. Document templates (print / PDF layout per document type)
--   4. Approval limits (enforced by triggers on approve / post — UI cannot bypass)
--   5. Notification rules + in-app notifications
-- Configuration never bypasses RLS, permission checks, inventory or accounting controls.
-- =====================================================================

-- ---------------------------------------------------------------- helpers
create or replace function public.my_role_codes(p_company uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct r.code), '{}')
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.profiles p on p.id = ur.user_id and p.is_active
  where ur.user_id = auth.uid() and ur.company_id = p_company;
$$;
revoke execute on function public.my_role_codes(uuid) from public, anon;
grant execute on function public.my_role_codes(uuid) to authenticated;

-- =====================================================================
-- 1. NUMBERING
-- =====================================================================
-- numbering is changed only through set_numbering_sequence below: the old direct-update policy now allows nothing
alter policy numbering_update on public.numbering_sequences using (false) with check (false);

create or replace function public.set_numbering_sequence(p_company uuid, p_doc_type text, p_prefix text, p_next_number bigint, p_padding int, p_reset_yearly boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.numbering_sequences%rowtype; v_year int := extract(year from now())::int; v_cur bigint;
begin
  perform public.inv_require(p_company, 'settings.manage');
  if p_prefix is null or length(p_prefix) > 12 or p_prefix !~ '^[A-Za-z0-9/_-]*$' then
    raise exception 'Prefix can use letters, digits, - / _ and up to 12 characters' using errcode = '22023';
  end if;
  if p_padding is null or p_padding not between 1 and 12 then raise exception 'Digits must be between 1 and 12' using errcode = '22023'; end if;
  if p_next_number is null or p_next_number < 1 then raise exception 'Next number must be 1 or more' using errcode = '22023'; end if;

  select * into s from public.numbering_sequences where company_id = p_company and doc_type = p_doc_type for update;
  if not found then raise exception 'Unknown document type %', p_doc_type using errcode = 'P0002'; end if;

  -- the number the next document would really get today
  v_cur := case when s.reset_yearly and coalesce(s.current_year, v_year) <> v_year then 1 else s.next_number end;
  -- lowering could re-issue a number already used (duplicates) — allowed only when the code format changes
  if p_next_number < v_cur and p_prefix = s.prefix and p_reset_yearly = s.reset_yearly then
    raise exception 'Next number cannot go below % — lower numbers may already be used. Change the prefix if you want to start again.', v_cur using errcode = '22023';
  end if;

  update public.numbering_sequences
     set prefix = p_prefix, next_number = p_next_number, padding = p_padding, reset_yearly = p_reset_yearly,
         current_year = case when p_reset_yearly then v_year else current_year end
   where id = s.id;
  return jsonb_build_object('doc_type', p_doc_type, 'next_code',
    p_prefix || case when p_reset_yearly then v_year::text || '-' else '' end || lpad(p_next_number::text, p_padding, '0'));
end $$;
revoke execute on function public.set_numbering_sequence(uuid, text, text, bigint, int, boolean) from public, anon;
grant execute on function public.set_numbering_sequence(uuid, text, text, bigint, int, boolean) to authenticated;

-- =====================================================================
-- 2. CUSTOM FIELDS
-- =====================================================================
create table if not exists public.custom_field_definitions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  entity       text not null check (entity in ('customers','customer_groups','suppliers','products','warehouses','employees','bank_accounts','payment_agents')),
  code         text not null check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (length(trim(label)) between 1 and 60),
  field_type   text not null check (field_type in ('text','long_text','number','decimal','currency','percentage','date','checkbox','dropdown','multi_select')),
  options      text[] not null default '{}',
  required     boolean not null default false,
  help_text    text,
  show_in_list boolean not null default false,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (company_id, entity, code)
);
create index if not exists cfd_entity_idx on public.custom_field_definitions(company_id, entity, is_active, sort_order);

create table if not exists public.custom_field_values (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  field_id      uuid not null references public.custom_field_definitions(id) on delete cascade,
  entity        text not null,
  record_id     uuid not null,
  value_text    text,
  value_number  numeric,
  value_date    date,
  value_bool    boolean,
  value_options text[],
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (field_id, record_id)
);
create index if not exists cfv_record_idx on public.custom_field_values(entity, record_id);
create index if not exists cfv_text_idx on public.custom_field_values(field_id, value_text);
create index if not exists cfv_num_idx on public.custom_field_values(field_id, value_number);
create index if not exists cfv_date_idx on public.custom_field_values(field_id, value_date);
create index if not exists cfv_opts_idx on public.custom_field_values using gin (value_options);

create or replace function public.cf_entity_perm(p_entity text, p_manage boolean)
returns text language sql immutable set search_path = '' as $$
  select case p_entity
    when 'customers'       then case when p_manage then 'customers.manage' else 'customers.view' end
    when 'customer_groups' then case when p_manage then 'customers.manage' else 'customers.view' end
    when 'suppliers'       then case when p_manage then 'suppliers.manage' else 'suppliers.view' end
    when 'products'        then case when p_manage then 'products.manage' else 'products.view' end
    when 'warehouses'      then case when p_manage then 'warehouses.manage' else 'warehouses.view' end
    when 'employees'       then case when p_manage then 'employees.manage' else 'employees.view' end
    when 'bank_accounts'   then case when p_manage then 'banks.manage' else 'banks.view' end
    when 'payment_agents'  then case when p_manage then 'payment_agents.manage' else 'payment_agents.view' end
  end;
$$;

-- may the caller see this record (and so its custom values)?
create or replace function public.cf_record_visible(p_company uuid, p_entity text, p_record uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_entity = 'customers' then public.can_access_customer(p_record)
    else public.has_permission(p_company, public.cf_entity_perm(p_entity, false))
  end;
$$;
revoke execute on function public.cf_record_visible(uuid, text, uuid) from public, anon;
grant execute on function public.cf_record_visible(uuid, text, uuid) to authenticated;

create trigger stamp before insert or update on public.custom_field_definitions for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.custom_field_definitions for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.custom_field_values for each row execute function public.tg_audit_row();

alter table public.custom_field_definitions enable row level security;
alter table public.custom_field_values enable row level security;
create policy cfd_select on public.custom_field_definitions for select using (public.is_company_member(company_id));
create policy cfv_select on public.custom_field_values for select using (public.cf_record_visible(company_id, entity, record_id));
-- all writes go through the functions below

create or replace function public.save_custom_field_definition(p_company uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.custom_field_definitions%rowtype; v_id uuid; v_type text := p_data->>'field_type';
  v_opts text[]; v_label text := trim(coalesce(p_data->>'label','')); v_code text;
begin
  perform public.inv_require(p_company, 'settings.manage');
  if v_label = '' then raise exception 'Enter a field name' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct trim(o)) filter (where trim(o) <> ''), '{}') into v_opts
    from jsonb_array_elements_text(coalesce(p_data->'options', '[]')) o;
  if v_type in ('dropdown','multi_select') and cardinality(v_opts) = 0 then
    raise exception 'Add at least one choice for a dropdown field' using errcode = '22023';
  end if;
  if v_type not in ('dropdown','multi_select') then v_opts := '{}'; end if;

  if p_id is null then
    v_code := left(regexp_replace(regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'), 40);
    if v_code !~ '^[a-z]' then v_code := 'f_' || v_code; end if;
    v_code := left(v_code, 40);
    while exists (select 1 from public.custom_field_definitions where company_id = p_company and entity = p_data->>'entity' and code = v_code) loop
      v_code := left(v_code, 36) || '_' || substr(md5(random()::text), 1, 3);
    end loop;
    insert into public.custom_field_definitions(company_id, entity, code, label, field_type, options, required, help_text, show_in_list, sort_order, is_active)
    values (p_company, p_data->>'entity', v_code, v_label, v_type, v_opts, coalesce((p_data->>'required')::boolean, false),
      nullif(trim(p_data->>'help_text'), ''), coalesce((p_data->>'show_in_list')::boolean, false),
      coalesce((p_data->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 10 from public.custom_field_definitions where company_id = p_company and entity = p_data->>'entity')),
      true)
    returning id into v_id;
    return v_id;
  end if;

  select * into d from public.custom_field_definitions where id = p_id and company_id = p_company for update;
  if not found then raise exception 'Field not found' using errcode = 'P0002'; end if;
  if v_type <> d.field_type and exists (select 1 from public.custom_field_values where field_id = d.id) then
    raise exception 'This field already has values — its type cannot be changed. Make a new field instead.' using errcode = '22023';
  end if;
  update public.custom_field_definitions set label = v_label, field_type = v_type, options = v_opts,
    required = coalesce((p_data->>'required')::boolean, required), help_text = nullif(trim(p_data->>'help_text'), ''),
    show_in_list = coalesce((p_data->>'show_in_list')::boolean, show_in_list),
    sort_order = coalesce((p_data->>'sort_order')::int, sort_order),
    is_active = coalesce((p_data->>'is_active')::boolean, is_active)
  where id = d.id;
  return d.id;
end $$;
revoke execute on function public.save_custom_field_definition(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_custom_field_definition(uuid, uuid, jsonb) to authenticated;

-- p_values: { "<field_id>": value }  (null / "" clears). Validates type, choices and required fields.
create or replace function public.save_custom_field_values(p_company uuid, p_entity text, p_record uuid, p_values jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare d record; v jsonb; n int := 0; v_txt text; v_num numeric; v_date date; v_bool boolean; v_opts text[]; v_exists boolean; v_has boolean;
begin
  perform public.inv_require(p_company, public.cf_entity_perm(p_entity, true));
  execute format('select exists (select 1 from public.%I where id = $1 and company_id = $2)', p_entity) into v_exists using p_record, p_company;
  if not v_exists then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if p_entity = 'customers' and not public.can_access_customer(p_record) then
    raise exception 'You do not have access to this customer' using errcode = '42501';
  end if;

  for d in select * from public.custom_field_definitions where company_id = p_company and entity = p_entity and is_active order by sort_order loop
    v_has := p_values ? d.id::text;
    v := p_values->(d.id::text);
    if not v_has then
      -- not sent: only check that a required field already has a value
      if d.required and not exists (select 1 from public.custom_field_values where field_id = d.id and record_id = p_record) then
        raise exception '"%" is required', d.label using errcode = '23502';
      end if;
      continue;
    end if;
    v_txt := null; v_num := null; v_date := null; v_bool := null; v_opts := null;
    if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      if d.required then raise exception '"%" is required', d.label using errcode = '23502'; end if;
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
        when 'checkbox' then v_bool := (v #>> '{}')::boolean;
        when 'dropdown' then
          v_txt := v #>> '{}';
          if not v_txt = any(d.options) then raise exception 'bad choice'; end if;
        when 'multi_select' then
          select array_agg(x) into v_opts from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else jsonb_build_array(v) end) x;
          if exists (select 1 from unnest(v_opts) x where not x = any(d.options)) then raise exception 'bad choice'; end if;
          v_txt := array_to_string(v_opts, ', ');
      end case;
    exception when others then
      raise exception '"%": the value is not valid for a % field', d.label, replace(d.field_type, '_', ' ') using errcode = '22023';
    end;
    if d.field_type = 'checkbox' and v_bool is false and not d.required then
      delete from public.custom_field_values where field_id = d.id and record_id = p_record;
    else
      insert into public.custom_field_values(company_id, field_id, entity, record_id, value_text, value_number, value_date, value_bool, value_options, updated_at, updated_by)
      values (p_company, d.id, p_entity, p_record, v_txt, v_num, v_date, v_bool, v_opts, now(), auth.uid())
      on conflict (field_id, record_id) do update set value_text = excluded.value_text, value_number = excluded.value_number,
        value_date = excluded.value_date, value_bool = excluded.value_bool, value_options = excluded.value_options,
        updated_at = now(), updated_by = auth.uid()
      where (custom_field_values.value_text, custom_field_values.value_number, custom_field_values.value_date, custom_field_values.value_bool, custom_field_values.value_options)
            is distinct from (excluded.value_text, excluded.value_number, excluded.value_date, excluded.value_bool, excluded.value_options);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.save_custom_field_values(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.save_custom_field_values(uuid, text, uuid, jsonb) to authenticated;

-- =====================================================================
-- 3. DOCUMENT TEMPLATES
-- =====================================================================
create table if not exists public.document_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  doc_type    text not null check (doc_type ~ '^[A-Z_]{2,40}$'),   -- DEFAULT = company-wide look
  settings    jsonb not null default '{}'::jsonb,
  logo        text check (logo is null or (logo like 'data:image/%' and length(logo) <= 400000)),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, doc_type)
);
create trigger stamp before insert or update on public.document_templates for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.document_templates for each row execute function public.tg_audit_row();
alter table public.document_templates enable row level security;
create policy dt_select on public.document_templates for select using (public.is_company_member(company_id));
create policy dt_insert on public.document_templates for insert with check (public.has_permission(company_id, 'settings.manage'));
create policy dt_update on public.document_templates for update using (public.has_permission(company_id, 'settings.manage')) with check (public.has_permission(company_id, 'settings.manage'));
create policy dt_delete on public.document_templates for delete using (public.has_permission(company_id, 'settings.manage'));

-- =====================================================================
-- 4. APPROVAL LIMITS
-- =====================================================================
create table if not exists public.approval_rules (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  doc_type       text not null check (doc_type in ('SALES_ORDER','PURCHASE_ORDER','SUPPLIER_BILL','PAYMENT_VOUCHER','SALES_DISCOUNT')),
  min_amount     numeric not null check (min_amount >= 0),     -- PKR, or % for SALES_DISCOUNT
  approver_roles text[] not null check (cardinality(approver_roles) > 0),
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (company_id, doc_type, min_amount)
);
create trigger stamp before insert or update on public.approval_rules for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.approval_rules for each row execute function public.tg_audit_row();
alter table public.approval_rules enable row level security;
create policy ar_select on public.approval_rules for select using (public.is_company_member(company_id));
create policy ar_insert on public.approval_rules for insert with check (public.has_permission(company_id, 'settings.manage'));
create policy ar_update on public.approval_rules for update using (public.has_permission(company_id, 'settings.manage')) with check (public.has_permission(company_id, 'settings.manage'));
create policy ar_delete on public.approval_rules for delete using (public.has_permission(company_id, 'settings.manage'));

-- the permission a role needs before it can be named as approver (a limit never grants rights)
create or replace function public.approval_base_permission(p_doc_type text) returns text language sql immutable set search_path = '' as $$
  select case p_doc_type when 'SALES_ORDER' then 'sales.approve' when 'PURCHASE_ORDER' then 'purchasing.approve'
    when 'SUPPLIER_BILL' then 'purchasing.approve' when 'PAYMENT_VOUCHER' then 'journals.post' when 'SALES_DISCOUNT' then 'sales.invoice' end;
$$;

create or replace function public.tg_approval_rule_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_bad text;
begin
  select string_agg(coalesce(r.name, x), ', ') into v_bad
  from unnest(new.approver_roles) x
  left join public.roles r on r.code = x
  where r.id is null or not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_code = public.approval_base_permission(new.doc_type));
  if v_bad is not null then
    raise exception '% cannot be an approver here — the role does not have the % permission. Give the role that permission in Users & Access first, or choose another role.',
      v_bad, public.approval_base_permission(new.doc_type) using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.tg_approval_rule_check() from public, anon, authenticated;
create trigger check_roles before insert or update on public.approval_rules for each row execute function public.tg_approval_rule_check();

-- highest active tier that the amount reaches
create or replace function public.approval_rule_for(p_company uuid, p_doc_type text, p_amount numeric)
returns public.approval_rules language sql stable security definer set search_path = '' as $$
  select r.* from public.approval_rules r
  where r.company_id = p_company and r.doc_type = p_doc_type and r.is_active and coalesce(p_amount, 0) >= r.min_amount and p_amount > 0
  order by r.min_amount desc limit 1;
$$;

create or replace function public.approval_label(p_doc_type text) returns text language sql immutable set search_path = '' as $$
  select case p_doc_type when 'SALES_ORDER' then 'Sales order' when 'PURCHASE_ORDER' then 'Purchase order'
    when 'SUPPLIER_BILL' then 'Supplier bill' when 'PAYMENT_VOUCHER' then 'Payment voucher' when 'SALES_DISCOUNT' then 'Invoice discount' else p_doc_type end;
$$;

create or replace function public.approval_role_names(p_roles text[]) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(r.name, ' or ' order by r.name), array_to_string(p_roles, ', ')) from public.roles r where r.code = any(p_roles);
$$;

-- raise when the amount needs a higher approver than the current user
create or replace function public.approval_check(p_company uuid, p_doc_type text, p_amount numeric, p_doc_no text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare r public.approval_rules;
begin
  if auth.uid() is null then return; end if;            -- system / maintenance work
  r := public.approval_rule_for(p_company, p_doc_type, p_amount);
  if r.id is null then return; end if;
  if public.my_role_codes(p_company) && r.approver_roles then return; end if;
  if p_doc_type = 'SALES_DISCOUNT' then
    raise exception '%', format('Invoice %s has a discount of %s%% — discounts of %s%% or more must be posted by %s.', p_doc_no,
      to_char(p_amount, 'FM999990.0'), to_char(r.min_amount, 'FM999990.##'), public.approval_role_names(r.approver_roles)) using errcode = '42501';
  end if;
  raise exception '%', format('%s %s is PKR %s — amounts of PKR %s or more must be approved by %s.', public.approval_label(p_doc_type), p_doc_no,
    to_char(p_amount, 'FM999,999,999,990'), to_char(r.min_amount, 'FM999,999,999,990'), public.approval_role_names(r.approver_roles)) using errcode = '42501';
end $$;

-- document amounts used by the rules (PKR)
create or replace function public.approval_doc_amount(p_doc_type text, p_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select case p_doc_type
    when 'SALES_ORDER' then (
      select greatest(coalesce(sum(l.quantity * coalesce(l.unit_price, 0)), 0) - coalesce(max(s.discount_amount), 0), 0)
      from public.sales_orders s left join public.sales_order_lines l on l.sales_order_id = s.id and l.is_active where s.id = p_id)
    when 'PURCHASE_ORDER' then (
      select round(greatest(coalesce(sum(l.quantity * coalesce(l.unit_price, 0)), 0) - coalesce(max(o.discount_amount), 0), 0) * coalesce(max(o.fx_rate), 1), 2)
      from public.purchase_orders o left join public.purchase_order_lines l on l.purchase_order_id = o.id and l.is_active where o.id = p_id)
    when 'SUPPLIER_BILL' then (
      select coalesce(b.total_pkr, round(coalesce(b.total_amount, 0) * coalesce(b.fx_rate, 1), 2)) from public.supplier_bills b where b.id = p_id)
    when 'PAYMENT_VOUCHER' then (
      select coalesce(nullif(j.total_debit, 0), j.amount) from public.journal_entries j where j.id = p_id)
    when 'SALES_DISCOUNT' then (
      select case when coalesce(i.discount_amount, 0) > 0 and coalesce(i.subtotal, i.total_amount + i.discount_amount, 0) > 0
        then round(i.discount_amount * 100 / coalesce(nullif(i.subtotal, 0), i.total_amount + i.discount_amount), 2) else 0 end
      from public.sales_invoices i where i.id = p_id)
  end;
$$;

create or replace function public.tg_approval_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_amt numeric; v_no text;
begin
  if tg_table_name = 'sales_orders' then
    if not (old.status = 'DRAFT' and new.status = 'APPROVED') then return new; end if;
    v_type := 'SALES_ORDER'; v_amt := public.approval_doc_amount(v_type, new.id); v_no := new.doc_no;
  elsif tg_table_name = 'purchase_orders' then
    if not (old.status = 'DRAFT' and new.status = 'APPROVED') then return new; end if;
    v_type := 'PURCHASE_ORDER'; v_amt := public.approval_doc_amount(v_type, new.id); v_no := new.doc_no;
  elsif tg_table_name = 'supplier_bills' then
    if not (old.status = 'DRAFT' and new.status = 'POSTED') then return new; end if;
    v_type := 'SUPPLIER_BILL'; v_amt := coalesce(new.total_pkr, round(coalesce(new.total_amount, 0) * coalesce(new.fx_rate, 1), 2)); v_no := new.doc_no;
  elsif tg_table_name = 'journal_entries' then
    if not (old.status = 'DRAFT' and new.status = 'POSTED' and new.entry_type = 'PAYMENT') then return new; end if;
    v_type := 'PAYMENT_VOUCHER'; v_amt := coalesce(nullif(new.total_debit, 0), new.amount); v_no := new.entry_no;
  elsif tg_table_name = 'sales_invoices' then
    if not (old.status = 'DRAFT' and new.status = 'POSTED') then return new; end if;
    v_type := 'SALES_DISCOUNT'; v_no := new.doc_no;
    v_amt := case when coalesce(new.discount_amount, 0) > 0 and coalesce(nullif(new.subtotal, 0), new.total_amount + new.discount_amount, 0) > 0
      then round(new.discount_amount * 100 / coalesce(nullif(new.subtotal, 0), new.total_amount + new.discount_amount), 2) else 0 end;
  else
    return new;
  end if;
  perform public.approval_check(new.company_id, v_type, v_amt, v_no);
  return new;
end $$;

create trigger approval_limit before update of status on public.sales_orders    for each row execute function public.tg_approval_limit();
create trigger approval_limit before update of status on public.purchase_orders for each row execute function public.tg_approval_limit();
create trigger approval_limit before update of status on public.supplier_bills  for each row execute function public.tg_approval_limit();
create trigger approval_limit before update of status on public.journal_entries for each row execute function public.tg_approval_limit();
create trigger approval_limit before update of status on public.sales_invoices  for each row execute function public.tg_approval_limit();

-- documents waiting for someone, with the tier they fall into (for lists and notifications)
create or replace function public.approval_pending(p_company uuid)
returns table(doc_type text, doc_id uuid, doc_no text, party text, amount numeric, min_amount numeric, approver_roles text[], link text)
language sql stable security definer set search_path = '' as $$
  with d as (
    select 'SALES_ORDER'::text t, s.id, s.doc_no, c.name party, '/sales-orders?view=' || s.id link from public.sales_orders s join public.customers c on c.id = s.customer_id where s.company_id = p_company and s.status = 'DRAFT'
    union all
    select 'PURCHASE_ORDER', o.id, o.doc_no, sp.name, '/purchase-orders?view=' || o.id from public.purchase_orders o join public.suppliers sp on sp.id = o.supplier_id where o.company_id = p_company and o.status = 'DRAFT'
    union all
    select 'SUPPLIER_BILL', b.id, b.doc_no, sp.name, '/supplier-bills?view=' || b.id from public.supplier_bills b join public.suppliers sp on sp.id = b.supplier_id where b.company_id = p_company and b.status = 'DRAFT'
    union all
    select 'PAYMENT_VOUCHER', j.id, j.entry_no, coalesce(j.memo, ''), '/vouchers?view=' || j.id from public.journal_entries j where j.company_id = p_company and j.status = 'DRAFT' and j.entry_type = 'PAYMENT'
    union all
    select 'SALES_DISCOUNT', i.id, i.doc_no, c.name, '/invoices?view=' || i.id from public.sales_invoices i join public.customers c on c.id = i.customer_id where i.company_id = p_company and i.status = 'DRAFT' and coalesce(i.discount_amount, 0) > 0
  )
  select d.t, d.id, d.doc_no, d.party, a.amt, r.min_amount, r.approver_roles, d.link
  from d
  cross join lateral (select public.approval_doc_amount(d.t, d.id) amt) a
  cross join lateral (select * from public.approval_rule_for(p_company, d.t, a.amt)) r
  where r.id is not null and exists (select 1 from public.approval_rules x where x.company_id = p_company and x.doc_type = d.t and x.is_active);
$$;
revoke execute on function public.approval_pending(uuid) from public, anon, authenticated;

-- one document's approval need (shown on the document)
create or replace function public.approval_status(p_company uuid, p_doc_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_amt numeric; r public.approval_rules;
begin
  if not public.has_permission(p_company, case p_doc_type when 'SALES_ORDER' then 'sales.view' when 'SALES_DISCOUNT' then 'sales.view'
       when 'PAYMENT_VOUCHER' then 'journals.view' else 'purchasing.view' end) then return null; end if;
  v_amt := public.approval_doc_amount(p_doc_type, p_id);
  r := public.approval_rule_for(p_company, p_doc_type, v_amt);
  if r.id is null then return jsonb_build_object('needed', false); end if;
  return jsonb_build_object('needed', true, 'amount', v_amt, 'limit', r.min_amount, 'roles', r.approver_roles,
    'role_names', public.approval_role_names(r.approver_roles), 'can_approve', public.my_role_codes(p_company) && r.approver_roles);
end $$;
revoke execute on function public.approval_status(uuid, text, uuid) from public, anon;
grant execute on function public.approval_status(uuid, text, uuid) to authenticated;
revoke execute on function public.approval_check(uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.approval_doc_amount(text, uuid) from public, anon, authenticated;
revoke execute on function public.approval_rule_for(uuid, text, numeric) from public, anon, authenticated;

-- =====================================================================
-- 5. NOTIFICATIONS
-- =====================================================================
create table if not exists public.notification_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  code        text not null,
  enabled     boolean not null default true,
  roles       text[] not null default '{}',
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, code)
);
create trigger stamp before insert or update on public.notification_rules for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.notification_rules for each row execute function public.tg_audit_row();
alter table public.notification_rules enable row level security;
create policy nr_select on public.notification_rules for select using (public.is_company_member(company_id));
create policy nr_insert on public.notification_rules for insert with check (public.has_permission(company_id, 'settings.manage'));
create policy nr_update on public.notification_rules for update using (public.has_permission(company_id, 'settings.manage')) with check (public.has_permission(company_id, 'settings.manage'));

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  rule_code   text not null,
  dedupe_key  text not null,
  title       text not null,
  body        text,
  link        text,
  severity    text not null default 'info' check (severity in ('info','warning','danger')),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  resolved_at timestamptz
);
create unique index if not exists ntf_open_uq on public.notifications(company_id, user_id, dedupe_key) where resolved_at is null;
create index if not exists ntf_user_idx on public.notifications(user_id, company_id, resolved_at, created_at desc);
alter table public.notifications enable row level security;
create policy ntf_select on public.notifications for select using (user_id = (select auth.uid()));
-- written only by the functions below

-- the catalogue of rules: code, label, description, permission needed to receive, default roles, default params
create or replace function public.notification_catalog()
returns table(code text, category text, label text, description text, permission text, default_roles text[], default_params jsonb, sort int)
language sql immutable set search_path = '' as $$
  values
  ('APPROVAL_LIMIT','Approvals','Above approval limit','Documents waiting that are above an approval limit — sent to the roles allowed to approve them (Settings → Approvals).', null, array['ADMINISTRATOR','OWNER'], '{}'::jsonb, 10),
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

create or replace function public.notification_rules_effective(p_company uuid)
returns table(code text, category text, label text, description text, permission text, enabled boolean, roles text[], params jsonb, default_roles text[], sort int)
language sql stable security definer set search_path = '' as $$
  select c.code, c.category, c.label, c.description, c.permission, coalesce(r.enabled, true),
    coalesce(r.roles, c.default_roles), c.default_params || coalesce(r.params, '{}'::jsonb), c.default_roles, c.sort
  from public.notification_catalog() c
  left join public.notification_rules r on r.company_id = p_company and r.code = c.code
  where public.is_company_member(p_company)
  order by c.sort;
$$;
revoke execute on function public.notification_rules_effective(uuid) from public, anon;
grant execute on function public.notification_rules_effective(uuid) to authenticated;

create or replace function public.save_notification_rule(p_company uuid, p_code text, p_enabled boolean, p_roles text[], p_params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company, 'settings.manage');
  if not exists (select 1 from public.notification_catalog() c where c.code = p_code) then raise exception 'Unknown rule' using errcode = 'P0002'; end if;
  insert into public.notification_rules(company_id, code, enabled, roles, params)
  values (p_company, p_code, coalesce(p_enabled, true), coalesce(p_roles, '{}'), coalesce(p_params, '{}'::jsonb))
  on conflict (company_id, code) do update set enabled = excluded.enabled, roles = excluded.roles, params = excluded.params;
end $$;
revoke execute on function public.save_notification_rule(uuid, text, boolean, text[], jsonb) from public, anon;
grant execute on function public.save_notification_rule(uuid, text, boolean, text[], jsonb) to authenticated;

-- Evaluate every rule for the calling user: add new notifications, clear the ones whose condition has gone.
create or replace function public.refresh_my_notifications(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_roles text[]; r record; v_items jsonb := '[]'::jsonb; v_add jsonb; v_days int; v_new int := 0;
begin
  if v_uid is null or not public.is_company_member(p_company) then return jsonb_build_object('unread', 0); end if;
  v_roles := public.my_role_codes(p_company);

  for r in select * from public.notification_rules_effective(p_company) loop
    continue when not r.enabled;
    if r.code <> 'APPROVAL_LIMIT' then
      continue when not (r.roles && v_roles);
      continue when r.permission is not null and not public.has_permission(p_company, r.permission);
    end if;
    v_add := null;
    v_days := coalesce((r.params->>'days')::int, 3);

    case r.code
    when 'APPROVAL_LIMIT' then
      select jsonb_agg(jsonb_build_object('k', 'APPROVAL_LIMIT:' || a.doc_id || ':' || a.min_amount, 'sev', 'warning',
        'title', public.approval_label(a.doc_type) || ' ' || a.doc_no || ' needs your approval',
        'body', a.party || case when a.doc_type = 'SALES_DISCOUNT' then ' · discount ' || to_char(a.amount, 'FM990.0') || '%'
                               else ' · PKR ' || to_char(a.amount, 'FM999,999,999,990') end || ' (limit ' ||
                 case when a.doc_type = 'SALES_DISCOUNT' then to_char(a.min_amount, 'FM990.##') || '%' else 'PKR ' || to_char(a.min_amount, 'FM999,999,999,990') end || ')',
        'link', a.link))
      into v_add from public.approval_pending(p_company) a
      where a.approver_roles && v_roles
        and public.has_permission(p_company, public.approval_base_permission(a.doc_type));
    when 'SO_APPROVAL' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'SO_APPROVAL:' || s.id, 'sev', 'info', 'title', 'Sales order ' || s.doc_no || ' awaiting approval',
          'body', c.name || ' · ' || to_char(s.order_date, 'DD Mon YYYY'), 'link', '/sales-orders?view=' || s.id) x
        from public.sales_orders s join public.customers c on c.id = s.customer_id
        where s.company_id = p_company and s.status = 'DRAFT' order by s.created_at desc limit 50) q;
    when 'PO_APPROVAL' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'PO_APPROVAL:' || o.id, 'sev', 'info', 'title', 'Purchase order ' || o.doc_no || ' awaiting approval',
          'body', s.name || ' · ' || to_char(o.order_date, 'DD Mon YYYY'), 'link', '/purchase-orders?view=' || o.id) x
        from public.purchase_orders o join public.suppliers s on s.id = o.supplier_id
        where o.company_id = p_company and o.status = 'DRAFT' order by o.created_at desc limit 50) q;
    when 'ADJUSTMENT_PENDING' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'ADJ:' || a.id, 'sev', 'info', 'title', 'Adjustment ' || a.doc_no || ' awaiting posting',
          'body', w.name || ' · ' || coalesce(a.reason, ''), 'link', '/stock-adjustments?view=' || a.id) x
        from public.stock_adjustments a join public.warehouses w on w.id = a.warehouse_id
        where a.company_id = p_company and a.status = 'DRAFT' and public.can_access_warehouse(a.warehouse_id) order by a.created_at desc limit 50) q;
    when 'TRANSFER_PENDING' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'TRF:' || t.id, 'sev', 'info', 'title', 'Transfer ' || t.doc_no || ' awaiting posting',
          'body', wf.name || ' → ' || wt.name, 'link', '/stock-transfers?view=' || t.id) x
        from public.stock_transfers t join public.warehouses wf on wf.id = t.from_warehouse_id join public.warehouses wt on wt.id = t.to_warehouse_id
        where t.company_id = p_company and t.status = 'DRAFT'
          and (public.can_access_warehouse(t.from_warehouse_id) or public.can_access_warehouse(t.to_warehouse_id)) order by t.created_at desc limit 50) q;
    when 'COUNT_REVIEW' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'CNT:' || c.id || ':' || extract(epoch from c.submitted_at)::bigint, 'sev', 'info', 'title', 'Stock count ' || c.doc_no || ' submitted',
          'body', w.name || coalesce(' · ' || c.submit_note, ''), 'link', '/stock-counts?view=' || c.id) x
        from public.stock_counts c join public.warehouses w on w.id = c.warehouse_id
        where c.company_id = p_company and c.status = 'OPEN' and c.submitted_at is not null and public.can_access_warehouse(c.warehouse_id) order by c.submitted_at desc limit 50) q;
    when 'LOW_STOCK' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'LOW:' || p.id, 'sev', 'warning', 'title', 'Low stock: ' || p.name,
          'body', 'On hand ' || to_char(coalesce(sum(b.on_hand), 0), 'FM999,999,990.###') || ' · reorder level ' || to_char(p.reorder_level, 'FM999,999,990.###'),
          'link', '/stock?q=' || p.sku) x
        from public.products p left join public.stock_balances b on b.product_id = p.id and b.company_id = p_company
        where p.company_id = p_company and p.is_active and p.reorder_level > 0 and not p.is_bundle
        group by p.id having coalesce(sum(b.on_hand), 0) <= p.reorder_level order by p.name limit 100) q;
    when 'PRICE_PENDING' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'PT:' || t.id || ':' || t.status || ':' || t.revision, 'sev', case when t.status = 'RETURNED' then 'warning' else 'info' end,
          'title', case when t.status = 'RETURNED' then 'Prices returned: ' else 'Price needed: ' end || t.doc_no,
          'body', c.name || coalesce(' · ' || t.return_reason, ''), 'link', '/pricing?view=' || t.id) x
        from public.price_tasks t join public.customers c on c.id = t.customer_id
        where t.company_id = p_company and t.status in ('OPEN','RETURNED') and (t.assigned_to is null or t.assigned_to = v_uid)
          and public.can_access_customer(t.customer_id) order by t.created_at desc limit 50) q;
    when 'PRICE_APPROVAL' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'PTA:' || t.id || ':' || t.revision, 'sev', 'info', 'title', 'Prices to approve: ' || t.doc_no,
          'body', c.name, 'link', '/pricing?view=' || t.id) x
        from public.price_tasks t join public.customers c on c.id = t.customer_id
        where t.company_id = p_company and t.status = 'SUBMITTED' order by t.submitted_at desc limit 50) q;
    when 'INVOICE_DRAFT' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'INV:' || i.id, 'sev', 'info', 'title', 'Invoice ' || i.doc_no || ' awaiting posting',
          'body', c.name, 'link', '/invoices?view=' || i.id) x
        from public.sales_invoices i join public.customers c on c.id = i.customer_id
        where i.company_id = p_company and i.status = 'DRAFT' order by i.created_at desc limit 50) q;
    when 'PAYMENT_RECEIVED' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'RCV:' || j.id, 'sev', 'info',
          'title', 'Payment received: PKR ' || to_char(coalesce(nullif(j.total_debit, 0), j.amount), 'FM999,999,999,990'),
          'body', coalesce(c.name, j.memo, '') || ' · ' || j.entry_no, 'link', '/vouchers?view=' || j.id) x
        from public.journal_entries j left join public.customers c on j.party_type = 'CUSTOMER' and c.id = j.party_id
        where j.company_id = p_company and j.entry_type = 'RECEIPT' and j.status = 'POSTED' and j.posted_at >= now() - make_interval(days => greatest(v_days, 1))
        order by j.posted_at desc limit 50) q;
    when 'COST_PENDING' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'CT:' || t.id || ':' || t.status || ':' || t.revision, 'sev', case when t.status = 'RETURNED' then 'warning' else 'info' end,
          'title', case when t.status = 'RETURNED' then 'Costs returned: ' else 'Cost needed: ' end || t.doc_no,
          'body', coalesce(s.name, '') || coalesce(' · ' || t.return_reason, ''), 'link', '/purchase-costs?view=' || t.id) x
        from public.purchase_cost_tasks t left join public.suppliers s on s.id = t.supplier_id
        where t.company_id = p_company and t.status in ('OPEN','RETURNED') and (t.assigned_to is null or t.assigned_to = v_uid) order by t.created_at desc limit 50) q;
    when 'COST_APPROVAL' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'CTA:' || t.id || ':' || t.revision, 'sev', 'info', 'title', 'Costs to approve: ' || t.doc_no,
          'body', coalesce(s.name, ''), 'link', '/purchase-costs?view=' || t.id) x
        from public.purchase_cost_tasks t left join public.suppliers s on s.id = t.supplier_id
        where t.company_id = p_company and t.status = 'SUBMITTED' order by t.submitted_at desc limit 50) q;
    when 'BILL_DRAFT' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'BILL:' || b.id, 'sev', 'info', 'title', 'Supplier bill ' || b.doc_no || ' awaiting posting',
          'body', s.name || coalesce(' · inv. ' || b.supplier_invoice_no, ''), 'link', '/supplier-bills?view=' || b.id) x
        from public.supplier_bills b join public.suppliers s on s.id = b.supplier_id
        where b.company_id = p_company and b.status = 'DRAFT' order by b.created_at desc limit 50) q;
    when 'SHIPMENT_ETA' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'SHP:' || s.id || ':' || s.eta, 'sev', case when s.eta < current_date then 'warning' else 'info' end,
          'title', 'Shipment ' || s.doc_no || case when s.eta < current_date then ' overdue (ETA ' else ' arriving ' end || to_char(s.eta, 'DD Mon') || case when s.eta < current_date then ')' else '' end,
          'body', coalesce(sp.name, '') || coalesce(' · BL ' || s.bl_no, '') || ' · ' || initcap(replace(s.status, '_', ' ')), 'link', '/shipments?view=' || s.id) x
        from public.shipments s left join public.suppliers sp on sp.id = s.supplier_id
        where s.company_id = p_company and s.ata is null and s.eta is not null and s.status not in ('ARRIVED_PORT','CUSTOMS','RELEASED','DELIVERED','CANCELLED')
          and s.eta <= current_date + v_days and s.eta >= current_date - 30 order by s.eta limit 50) q;
    when 'PDC_DUE' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'PDC:' || p.id || ':' || p.cheque_date || ':' || p.present_count, 'sev', case when p.cheque_date < current_date then 'warning' else 'info' end,
          'title', case when p.direction = 'ISSUED' then 'Issued cheque ' else 'Cheque ' end || coalesce(p.cheque_no, p.doc_no) ||
                   case when p.cheque_date < current_date then ' overdue since ' when p.cheque_date = current_date then ' due today ' else ' due ' end ||
                   case when p.cheque_date = current_date then '' else to_char(p.cheque_date, 'DD Mon') end,
          'body', coalesce(c.name, s.name, '') || ' · ' || p.currency || ' ' || to_char(p.amount, 'FM999,999,999,990'), 'link', '/pdc?view=' || p.id) x
        from public.pdc_records p
        left join public.customers c on p.party_type = 'CUSTOMER' and c.id = p.party_id
        left join public.suppliers s on p.party_type = 'SUPPLIER' and s.id = p.party_id
        where p.company_id = p_company and p.status = 'HELD' and p.cheque_date <= current_date + v_days order by p.cheque_date limit 50) q;
    when 'PDC_BOUNCED' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'PDCB:' || p.id || ':' || p.bounce_count, 'sev', 'danger',
          'title', 'Cheque ' || coalesce(p.cheque_no, p.doc_no) || ' bounced',
          'body', coalesce(c.name, s.name, '') || ' · ' || p.currency || ' ' || to_char(p.amount, 'FM999,999,999,990') || coalesce(' · ' || p.bounce_reason, ''),
          'link', '/pdc?view=' || p.id) x
        from public.pdc_records p
        left join public.customers c on p.party_type = 'CUSTOMER' and c.id = p.party_id
        left join public.suppliers s on p.party_type = 'SUPPLIER' and s.id = p.party_id
        where p.company_id = p_company and p.status = 'BOUNCED' order by p.bounced_date desc nulls last limit 50) q;
    when 'PAYROLL_PENDING' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'PAY:' || pr.id || ':' || pr.status, 'sev', 'info',
          'title', 'Payroll ' || pr.doc_no || case when pr.status = 'DRAFT' then ' awaiting approval' else ' awaiting posting' end,
          'body', to_char(pr.period_month, 'Mon YYYY') || ' · ' || pr.employees_count || ' employees', 'link', '/payroll?view=' || pr.id) x
        from public.payroll_runs pr
        where pr.company_id = p_company and pr.calculated_at is not null
          and ((pr.status = 'DRAFT' and public.has_permission(p_company, 'payroll.approve'))
            or (pr.status = 'APPROVED' and public.has_permission(p_company, 'payroll.manage')))
        order by pr.created_at desc limit 20) q;
    when 'ADVANCE_REQUEST' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'ADV:' || a.id, 'sev', 'info', 'title', 'Advance requested: ' || e.full_name,
          'body', 'PKR ' || to_char(a.amount, 'FM999,999,990') || coalesce(' · ' || a.reason, ''), 'link', '/hr') x
        from public.employee_advances a join public.employees e on e.id = a.employee_id
        where a.company_id = p_company and a.status = 'REQUESTED' order by a.created_at desc limit 50) q;
    when 'LEAVE_REQUEST' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'LV:' || l.id, 'sev', 'info', 'title', 'Leave requested: ' || e.full_name,
          'body', to_char(l.from_date, 'DD Mon') || ' – ' || to_char(l.to_date, 'DD Mon') || ' (' || to_char(l.days, 'FM990.#') || ' days)', 'link', '/hr') x
        from public.employee_leave_requests l join public.employees e on e.id = l.employee_id
        where l.company_id = p_company and l.status = 'REQUESTED' order by l.created_at desc limit 50) q;
    when 'LABOUR_APPROVAL' then
      select jsonb_agg(x) into v_add from (
        select jsonb_build_object('k', 'LAB:' || ea.id || ':' || ea.completed_qty, 'sev', 'info', 'title', 'Assembly labour to approve: ' || e.full_name,
          'body', o.doc_no || ' · ' || to_char(ea.completed_qty, 'FM999,990.##') || ' done', 'link', '/hr') x
        from public.employee_assembly_assignments ea join public.employees e on e.id = ea.employee_id join public.assembly_orders o on o.id = ea.assembly_order_id
        where ea.company_id = p_company and ea.status = 'ASSIGNED' and ea.completed_qty > 0 order by ea.created_at desc limit 50) q;
    else null;
    end case;

    if v_add is not null then
      v_items := v_items || (select jsonb_agg(e || jsonb_build_object('rule', r.code)) from jsonb_array_elements(v_add) e);
    end if;
  end loop;

  with ins as (
    insert into public.notifications(company_id, user_id, rule_code, dedupe_key, title, body, link, severity)
    select p_company, v_uid, x.rule, x.k, left(x.title, 200), left(x.body, 500), x.link, coalesce(x.sev, 'info')
    from jsonb_to_recordset(v_items) as x(rule text, k text, title text, body text, link text, sev text)
    on conflict (company_id, user_id, dedupe_key) where resolved_at is null do nothing
    returning 1)
  select count(*) into v_new from ins;

  -- conditions that no longer hold clear themselves
  update public.notifications n set resolved_at = now()
  where n.company_id = p_company and n.user_id = v_uid and n.resolved_at is null
    and not exists (select 1 from jsonb_array_elements(v_items) e where e->>'k' = n.dedupe_key);

  delete from public.notifications where user_id = v_uid and resolved_at < now() - interval '30 days';

  return jsonb_build_object('new', v_new,
    'unread', (select count(*) from public.notifications where company_id = p_company and user_id = v_uid and resolved_at is null and read_at is null));
end $$;
revoke execute on function public.refresh_my_notifications(uuid) from public, anon;
grant execute on function public.refresh_my_notifications(uuid) to authenticated;

create or replace function public.mark_notifications_read(p_company uuid, p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.notifications set read_at = now()
  where user_id = auth.uid() and company_id = p_company and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mark_notifications_read(uuid, uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid, uuid[]) to authenticated;

-- internal helpers are not callable directly
revoke execute on function public.tg_approval_limit() from public, anon, authenticated;
revoke execute on function public.cf_entity_perm(text, boolean) from public, anon;
grant execute on function public.cf_entity_perm(text, boolean) to authenticated;
revoke execute on function public.notification_catalog() from public, anon;
grant execute on function public.notification_catalog() to authenticated;
revoke execute on function public.approval_base_permission(text) from public, anon;
grant execute on function public.approval_base_permission(text) to authenticated;
revoke execute on function public.approval_label(text) from public, anon;
grant execute on function public.approval_label(text) to authenticated;
revoke execute on function public.approval_role_names(text[]) from public, anon;
grant execute on function public.approval_role_names(text[]) to authenticated;

