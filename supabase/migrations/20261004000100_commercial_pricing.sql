-- Stage 6 — Commercial pricing
-- * customer price history (customer + product + variant + currency), fed by posted invoices and approved price tasks
-- * last_sale_price now reads the history
-- * delayed selling price: orders / GDNs dispatched without a price get a price task:
--   assign (owner / salesperson) → enter → submit → accountant reviews → return or approve
--   approval writes the prices onto the order, its GDN lines and any draft invoice lines that are still unpriced
-- * price authority: a price that came approved from the order / GDN is locked on the invoice
--   (only pricing.approve can change it, and the change is recorded)

-- ───────── permissions ─────────
insert into public.permissions(code, module, description, is_sensitive) values
  ('pricing.enter',   'sales', 'Enter selling prices on price tasks assigned to you', true),
  ('pricing.approve', 'sales', 'Review and approve selling prices; change locked invoice prices', true)
on conflict (code) do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values ('ADMINISTRATOR','pricing.enter'), ('OWNER','pricing.enter'), ('SALESPERSON','pricing.enter'),
             ('ADMINISTRATOR','pricing.approve'), ('ACCOUNTANT','pricing.approve'), ('OWNER','pricing.approve')) x(role, p)
  on x.role = r.code
on conflict do nothing;

-- ───────── customer price history ─────────
create table if not exists public.customer_product_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id),
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  currency text not null default 'PKR',
  unit_price numeric not null check (unit_price >= 0),
  quantity numeric,
  effective_date date not null,
  source_type text not null check (source_type in ('INVOICE','PRICE_TASK')),
  source_id uuid not null,
  source_line_id uuid,
  source_doc_no text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid default auth.uid()
);
create index if not exists cpp_lookup on public.customer_product_prices(customer_id, product_id, variant_id, currency, effective_date desc, recorded_at desc);
create index if not exists cpp_product on public.customer_product_prices(company_id, product_id);
create unique index if not exists cpp_source_line on public.customer_product_prices(source_type, source_line_id) where source_line_id is not null;
alter table public.customer_product_prices enable row level security;
create policy cpp_select on public.customer_product_prices for select to authenticated
  using (public.has_permission(company_id, 'sales.view_prices') and public.can_access_customer(customer_id));

create or replace function public.cpp_from_invoice_line() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i record;
begin
  select si.customer_id, si.invoice_date, si.doc_no, coalesce(c.default_currency, 'PKR') as cur into i
    from public.sales_invoices si join public.customers c on c.id = si.customer_id where si.id = new.invoice_id;
  insert into public.customer_product_prices(company_id, customer_id, product_id, variant_id, currency, unit_price, quantity,
    effective_date, source_type, source_id, source_line_id, source_doc_no)
  values (new.company_id, i.customer_id, new.product_id, new.variant_id, i.cur, new.unit_price, new.quantity,
    i.invoice_date, 'INVOICE', new.invoice_id, new.id, i.doc_no)
  on conflict do nothing;
  return new;
end $$;
create trigger cpp_record after insert on public.sales_invoice_lines for each row execute function public.cpp_from_invoice_line();

-- history of everything already invoiced
insert into public.customer_product_prices(company_id, customer_id, product_id, variant_id, currency, unit_price, quantity,
  effective_date, source_type, source_id, source_line_id, source_doc_no, recorded_at, recorded_by)
select l.company_id, si.customer_id, l.product_id, l.variant_id, coalesce(c.default_currency,'PKR'), l.unit_price, l.quantity,
       si.invoice_date, 'INVOICE', si.id, l.id, si.doc_no, coalesce(si.posted_at, si.created_at), si.posted_by
from public.sales_invoice_lines l join public.sales_invoices si on si.id = l.invoice_id join public.customers c on c.id = si.customer_id
on conflict do nothing;

-- last price charged (or approved) for this customer — same signature as before
create or replace function public.last_sale_price(p_customer_id uuid, p_product_id uuid, p_variant_id uuid)
returns table(unit_price numeric, invoice_date date, doc_no text)
language sql stable set search_path = '' as $$
  select h.unit_price, h.effective_date, h.source_doc_no
  from public.customer_product_prices h
  where h.customer_id = p_customer_id and h.product_id = p_product_id and h.variant_id is not distinct from p_variant_id
    and h.currency = coalesce((select c.default_currency from public.customers c where c.id = p_customer_id), 'PKR')
    and (h.source_type <> 'INVOICE' or exists (select 1 from public.sales_invoices i where i.id = h.source_id and i.status = 'POSTED'))
  order by h.effective_date desc, h.recorded_at desc limit 1;
$$;

-- ───────── price tasks ─────────
create table if not exists public.price_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  source_type text not null check (source_type in ('SO','GDN')),
  sales_order_id uuid not null references public.sales_orders(id),
  gdn_id uuid references public.gdns(id),
  customer_id uuid not null references public.customers(id),
  assigned_to uuid not null references auth.users(id),
  status text not null default 'OPEN' check (status in ('OPEN','SUBMITTED','RETURNED','APPROVED','CANCELLED')),
  due_date date,
  notes text,
  return_reason text,
  revision int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  submitted_at timestamptz, submitted_by uuid, submit_note text,
  approved_at timestamptz, approved_by uuid,
  cancelled_at timestamptz, cancelled_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists pt_company on public.price_tasks(company_id, status);
create index if not exists pt_assignee on public.price_tasks(assigned_to, status);
create index if not exists pt_so on public.price_tasks(sales_order_id);

create table if not exists public.price_task_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.price_tasks(id),
  line_no int not null,
  sales_order_line_id uuid not null references public.sales_order_lines(id),
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  quantity numeric not null,
  last_price numeric, last_price_date date, last_price_doc text,
  entered_price numeric check (entered_price is null or entered_price >= 0),
  approved_price numeric check (approved_price is null or approved_price >= 0),
  note text
);
create index if not exists ptl_task on public.price_task_lines(task_id);
create index if not exists ptl_sol on public.price_task_lines(sales_order_line_id);

create table if not exists public.price_task_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null references public.price_tasks(id),
  event text not null check (event in ('CREATED','SAVED','SUBMITTED','RETURNED','APPROVED','REASSIGNED','CANCELLED','INVOICE_OVERRIDE')),
  actor uuid default auth.uid(),
  at timestamptz not null default now(),
  note text,
  prices jsonb
);
create index if not exists pte_task on public.price_task_events(task_id, at);

alter table public.price_tasks enable row level security;
alter table public.price_task_lines enable row level security;
alter table public.price_task_events enable row level security;
create policy pt_select on public.price_tasks for select to authenticated
  using (assigned_to = auth.uid() or (public.has_permission(company_id, 'sales.view_prices') and public.can_access_customer(customer_id)));
create policy ptl_select on public.price_task_lines for select to authenticated
  using (exists (select 1 from public.price_tasks t where t.id = task_id));
create policy pte_select on public.price_task_events for select to authenticated
  using (exists (select 1 from public.price_tasks t where t.id = task_id));

alter table public.price_tasks replica identity full;
alter publication supabase_realtime add table public.price_tasks;

insert into public.numbering_sequences(company_id, doc_type, prefix)
select c.id, 'PRICE_TASK', 'PT-' from public.companies c
where not exists (select 1 from public.numbering_sequences s where s.company_id = c.id and s.doc_type = 'PRICE_TASK');

-- ───────── helpers ─────────
create or replace function public.price_notify(p_company uuid, p_user uuid, p_kind text, p_title text, p_body text, p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.staff_notifications(company_id, user_id, kind, urgent, title, body, job_type, job_id, created_by)
  values (p_company, p_user, p_kind, false, p_title, p_body, 'PRICE', p_task, auth.uid());
end $$;

create or replace function public.price_notify_approvers(p_company uuid, p_kind text, p_title text, p_body text, p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  for u in select distinct ur.user_id from public.user_roles ur where ur.company_id = p_company loop
    if public.user_has_permission(u, p_company, 'pricing.approve') then
      perform public.price_notify(p_company, u, p_kind, p_title, p_body, p_task);
    end if;
  end loop;
end $$;

create or replace function public.price_task_snapshot(p_task uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'product_id', l.product_id, 'variant_id', l.variant_id,
           'entered', l.entered_price, 'approved', l.approved_price, 'note', l.note) order by l.line_no), '[]'::jsonb)
  from public.price_task_lines l where l.task_id = p_task;
$$;

create or replace function public.price_can_create(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_company, 'sales.manage') or public.has_permission(p_company, 'sales.dispatch')
      or public.has_permission(p_company, 'pricing.approve') or public.has_permission(p_company, 'pricing.enter');
$$;


-- ───────── task lifecycle ─────────

create or replace function public.price_task_guard(p_task uuid, p_mode text) returns public.price_tasks
language plpgsql security definer set search_path = '' as $$
declare t public.price_tasks;
begin
  select * into t from public.price_tasks where id = p_task for update;
  if t.id is null then raise exception 'Price task not found' using errcode = 'P0002'; end if;
  if p_mode = 'enter' then
    if t.status not in ('OPEN','RETURNED') then raise exception 'This price task is % — it cannot be changed', lower(t.status) using errcode = '22023'; end if;
    if not (t.assigned_to = auth.uid() or public.has_permission(t.company_id, 'pricing.approve')) then
      raise exception 'Only % can enter these prices', coalesce((select full_name from public.profiles where id = t.assigned_to), 'the assigned person') using errcode = '42501';
    end if;
    if not public.has_permission(t.company_id, 'pricing.enter') and not public.has_permission(t.company_id, 'pricing.approve') then
      raise exception 'You are not allowed to enter prices' using errcode = '42501';
    end if;
  elsif p_mode = 'approve' then
    if not public.has_permission(t.company_id, 'pricing.approve') then raise exception 'Only an accountant can review prices' using errcode = '42501'; end if;
  elsif p_mode = 'manage' then
    if not (public.price_can_create(t.company_id) and public.has_permission(t.company_id, 'sales.view_prices')) then raise exception 'Not allowed' using errcode = '42501'; end if;
    if t.status in ('APPROVED','CANCELLED') then raise exception 'This price task is already %', lower(t.status) using errcode = '22023'; end if;
  end if;
  return t;
end $$;

-- p_lines: [{id, price, note}]
create or replace function public.save_price_task(p_task_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.price_tasks; x jsonb; v_p numeric;
begin
  t := public.price_task_guard(p_task_id, 'enter');
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_p := nullif(x->>'price','')::numeric;
    if v_p is not null and v_p < 0 then raise exception 'Prices cannot be negative' using errcode = '23514'; end if;
    update public.price_task_lines set entered_price = v_p, note = nullif(trim(x->>'note'),'')
     where id = (x->>'id')::uuid and task_id = p_task_id;
  end loop;
  update public.price_tasks set updated_at = now() where id = p_task_id;
end $$;

create or replace function public.submit_price_task(p_task_id uuid, p_lines jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.price_tasks; v_missing int;
begin
  perform public.save_price_task(p_task_id, p_lines);
  select * into t from public.price_tasks where id = p_task_id;
  select count(*) into v_missing from public.price_task_lines where task_id = p_task_id and entered_price is null;
  if v_missing > 0 then raise exception 'Enter a price for every item (% missing) — a missing price is not zero', v_missing using errcode = '23502'; end if;
  update public.price_tasks set status = 'SUBMITTED', submitted_at = now(), submitted_by = auth.uid(), submit_note = nullif(trim(p_note),''),
    revision = revision + 1, updated_at = now() where id = p_task_id;
  insert into public.price_task_events(company_id, task_id, event, note, prices)
  values (t.company_id, p_task_id, 'SUBMITTED', nullif(trim(p_note),''), public.price_task_snapshot(p_task_id));
  perform public.price_notify_approvers(t.company_id, 'PRICE_SUBMITTED', 'Prices to review — ' || t.doc_no,
    (select name from public.customers where id = t.customer_id) || coalesce(' · ' || nullif(trim(p_note),''), ''), p_task_id);
end $$;

create or replace function public.return_price_task(p_task_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.price_tasks;
begin
  t := public.price_task_guard(p_task_id, 'approve');
  if t.status <> 'SUBMITTED' then raise exception 'Only submitted prices can be sent back' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Say why the prices are sent back' using errcode = '23502'; end if;
  update public.price_tasks set status = 'RETURNED', return_reason = trim(p_reason), updated_at = now() where id = p_task_id;
  insert into public.price_task_events(company_id, task_id, event, note, prices)
  values (t.company_id, p_task_id, 'RETURNED', trim(p_reason), public.price_task_snapshot(p_task_id));
  perform public.price_notify(t.company_id, t.assigned_to, 'PRICE_RETURNED', 'Prices sent back — ' || t.doc_no, trim(p_reason), p_task_id);
end $$;

-- writes approved prices into the order, its GDN lines and unpriced draft invoice lines

-- p_lines (optional): [{id, price}] — accountant's corrections before approving
create or replace function public.approve_price_task(p_task_id uuid, p_lines jsonb default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.price_tasks; x jsonb; l record; v_p numeric; v_cur text;
begin
  t := public.price_task_guard(p_task_id, 'approve');
  if t.status <> 'SUBMITTED' then raise exception 'Prices must be submitted before they are approved' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_p := nullif(x->>'price','')::numeric;
    if v_p is not null and v_p < 0 then raise exception 'Prices cannot be negative' using errcode = '23514'; end if;
    update public.price_task_lines set approved_price = v_p where id = (x->>'id')::uuid and task_id = p_task_id;
  end loop;
  update public.price_task_lines set approved_price = coalesce(approved_price, entered_price) where task_id = p_task_id;
  if exists (select 1 from public.price_task_lines where task_id = p_task_id and approved_price is null) then
    raise exception 'Every item needs a price before approval' using errcode = '23502';
  end if;
  select coalesce(default_currency, 'PKR') into v_cur from public.customers where id = t.customer_id;
  for l in select * from public.price_task_lines where task_id = p_task_id order by line_no loop
    perform public.price_apply_line(l.sales_order_line_id, l.approved_price);
    insert into public.customer_product_prices(company_id, customer_id, product_id, variant_id, currency, unit_price, quantity,
      effective_date, source_type, source_id, source_line_id, source_doc_no)
    values (t.company_id, t.customer_id, l.product_id, l.variant_id, v_cur, l.approved_price, l.quantity, current_date, 'PRICE_TASK', t.id, l.id, t.doc_no)
    on conflict do nothing;
  end loop;
  update public.price_tasks set status = 'APPROVED', approved_at = now(), approved_by = auth.uid(), updated_at = now() where id = p_task_id;
  insert into public.price_task_events(company_id, task_id, event, note, prices)
  values (t.company_id, p_task_id, 'APPROVED', nullif(trim(p_note),''), public.price_task_snapshot(p_task_id));
  perform public.price_notify(t.company_id, t.assigned_to, 'PRICE_APPROVED', 'Prices approved — ' || t.doc_no, nullif(trim(p_note),''), p_task_id);
end $$;

create or replace function public.reassign_price_task(p_task_id uuid, p_assignee uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.price_tasks;
begin
  t := public.price_task_guard(p_task_id, 'manage');
  if p_assignee is null or not public.user_has_permission(p_assignee, t.company_id, 'pricing.enter') then
    raise exception 'Choose someone who is allowed to enter prices' using errcode = '22023';
  end if;
  update public.price_tasks set assigned_to = p_assignee, status = case when status = 'SUBMITTED' then 'OPEN' else status end, updated_at = now() where id = p_task_id;
  insert into public.price_task_events(company_id, task_id, event, note) values (t.company_id, p_task_id, 'REASSIGNED',
    'To ' || coalesce((select full_name from public.profiles where id = p_assignee), '?') || coalesce(' — ' || nullif(trim(p_note),''), ''));
  perform public.price_notify(t.company_id, p_assignee, 'PRICE_ASSIGNED', 'Enter prices for ' || t.doc_no, nullif(trim(p_note),''), p_task_id);
end $$;

create or replace function public.cancel_price_task(p_task_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.price_tasks;
begin
  t := public.price_task_guard(p_task_id, 'manage');
  update public.price_tasks set status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), updated_at = now() where id = p_task_id;
  insert into public.price_task_events(company_id, task_id, event, note) values (t.company_id, p_task_id, 'CANCELLED', nullif(trim(p_reason),''));
end $$;

-- people who can be given price tasks
create or replace function public.pricing_people(p_company_id uuid)
returns table(user_id uuid, full_name text, can_approve boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, public.user_has_permission(p.id, p_company_id, 'pricing.approve')
  from public.profiles p
  where p.is_active and public.is_company_member(p_company_id)
    and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.company_id = p_company_id)
    and public.user_has_permission(p.id, p_company_id, 'pricing.enter')
  order by p.full_name;
$$;

-- ───────── invoice price authority ─────────
create table if not exists public.audit_log_price_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  invoice_id uuid not null references public.sales_invoices(id),
  invoice_doc_no text,
  changes jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);
create index if not exists alpo_company on public.audit_log_price_overrides(company_id, changed_at desc);
alter table public.audit_log_price_overrides enable row level security;
create policy alpo_select on public.audit_log_price_overrides for select to authenticated
  using (public.has_permission(company_id, 'sales.view_prices'));

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
  perform public.inv_recalc_invoice(v_id);
  return v_id;
end $$;

create or replace function public.save_sales_invoice(p_id uuid, p_header jsonb, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; v_lines jsonb := '[]'::jsonb; x jsonb; i int := 0; v_p numeric; v_disc numeric; v_ap numeric; v_over jsonb := '[]'::jsonb;
begin
  select * into h from public.sales_invoices where id = p_id for update;
  if h.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'sales.invoice');
  if h.status <> 'DRAFT' then raise exception 'Only draft invoices can be edited (this one is %)', h.status using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(h.lines_draft) loop
    v_p := nullif(p_lines->i->>'unit_price','')::numeric;
    v_ap := nullif(x->>'approved_price','')::numeric;
    if v_p is not null and v_p < 0 then raise exception 'Line %: price cannot be negative', i + 1 using errcode = '23514'; end if;
    if v_ap is not null and v_p is distinct from v_ap and v_p is distinct from nullif(x->>'unit_price','')::numeric then
      if not public.has_permission(h.company_id, 'pricing.approve') then
        raise exception 'Line %: the price % was approved on the order / GDN — only an accountant with price approval can change it', i + 1, v_ap using errcode = '42501';
      end if;
      v_over := v_over || jsonb_build_array(jsonb_build_object('line', i + 1, 'product_id', x->>'product_id', 'approved', v_ap, 'new', v_p));
      x := x || jsonb_build_object('price_override_by', auth.uid(), 'price_override_at', now());
    end if;
    v_lines := v_lines || jsonb_build_array(x || jsonb_build_object('unit_price', v_p, 'description', nullif(trim(p_lines->i->>'description'),'')));
    i := i + 1;
  end loop;
  v_disc := coalesce(nullif(p_header->>'discount_amount','')::numeric, 0);
  if v_disc < 0 then raise exception 'Discount cannot be negative' using errcode = '23514'; end if;
  update public.sales_invoices set lines_draft = v_lines, discount_amount = v_disc,
    invoice_date = coalesce(nullif(p_header->>'invoice_date','')::date, invoice_date), due_date = nullif(p_header->>'due_date','')::date,
    customer_reference = nullif(trim(p_header->>'customer_reference'),''), notes = nullif(trim(p_header->>'notes'),'')
  where id = p_id;
  if jsonb_array_length(v_over) > 0 then
    insert into public.audit_log_price_overrides(company_id, invoice_id, invoice_doc_no, changes) values (h.company_id, p_id, h.doc_no, v_over);
  end if;
  perform public.inv_recalc_invoice(p_id);
end $$;

-- ───────── open (unpriced, not yet invoiced) lines, pending list, task creation, applying prices ─────────
create or replace function public.price_line_open(p_sol uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sales_order_lines l where l.id = p_sol and l.is_active and l.unit_price is null
                   and l.quantity > l.delivered_qty and exists (select 1 from public.sales_orders s where s.id = l.sales_order_id and s.status in ('DRAFT','APPROVED','PARTIALLY_DELIVERED')))
      or exists (select 1 from public.gdn_lines gl join public.gdns g on g.id = gl.gdn_id
                 where gl.sales_order_line_id = p_sol and gl.unit_price is null and gl.invoiced_qty < gl.quantity and g.status = 'POSTED');
$$;

create or replace function public.pending_prices(p_company_id uuid)
returns table(source_type text, source_id uuid, sales_order_id uuid, doc_no text, doc_date date, status text,
              customer_id uuid, customer_name text, missing_lines int, missing_qty numeric, open_task_id uuid, open_task_no text, open_task_status text)
language sql stable security definer set search_path = '' as $$
  with so as (
    select 'SO'::text st, s.id sid, s.id soid, s.doc_no, s.order_date dd, s.status, s.customer_id,
           count(*)::int n, sum(l.quantity) q, array_agg(l.id) lines
    from public.sales_orders s join public.sales_order_lines l on l.sales_order_id = s.id and l.is_active and l.unit_price is null
    where s.company_id = p_company_id and public.price_line_open(l.id)
    group by s.id
  ), gd as (
    select 'GDN'::text st, g.id sid, g.sales_order_id soid, g.doc_no, g.gdn_date dd, g.status, g.customer_id,
           count(*)::int n, sum(l.quantity - l.invoiced_qty) q, array_agg(l.sales_order_line_id) lines
    from public.gdns g join public.gdn_lines l on l.gdn_id = g.id and l.unit_price is null and l.invoiced_qty < l.quantity
    where g.company_id = p_company_id and g.status = 'POSTED'
    group by g.id
  ), allx as (select * from so union all select * from gd)
  select a.st, a.sid, a.soid, a.doc_no, a.dd, a.status, a.customer_id, c.name, a.n, a.q, t.id, t.doc_no, t.status
  from allx a join public.customers c on c.id = a.customer_id
  left join lateral (
    select pt.id, pt.doc_no, pt.status from public.price_tasks pt join public.price_task_lines pl on pl.task_id = pt.id
    where pt.status in ('OPEN','SUBMITTED','RETURNED') and pl.sales_order_line_id = any(a.lines)
    order by pt.created_at desc limit 1) t on true
  where public.has_permission(p_company_id, 'sales.view_prices') and public.can_access_customer(a.customer_id)
  order by a.dd desc, a.doc_no desc;
$$;

create or replace function public.price_source_lines(p_source_type text, p_so uuid, p_gdn uuid)
returns table(sol uuid, product_id uuid, variant_id uuid, q numeric, line_no int)
language sql stable security definer set search_path = '' as $$
  select l.id, l.product_id, l.variant_id,
         case when p_source_type = 'SO' then l.quantity
              else (select sum(gl.quantity - gl.invoiced_qty) from public.gdn_lines gl where gl.gdn_id = p_gdn and gl.sales_order_line_id = l.id and gl.unit_price is null) end,
         l.line_no
  from public.sales_order_lines l
  where l.sales_order_id = p_so and l.is_active and (
    (p_source_type = 'SO' and l.unit_price is null and public.price_line_open(l.id))
    or (p_source_type = 'GDN' and exists (select 1 from public.gdn_lines gl where gl.gdn_id = p_gdn and gl.sales_order_line_id = l.id
                                          and gl.unit_price is null and gl.invoiced_qty < gl.quantity)))
  order by l.line_no;
$$;

create or replace function public.create_price_task(p_company_id uuid, p_source_type text, p_source_id uuid, p_assignee uuid,
  p_due date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_so uuid; v_gdn uuid; v_cust uuid; v_doc text; v_id uuid; r record; n int := 0; lp record; v_clash text;
begin
  if not public.price_can_create(p_company_id) then raise exception 'You cannot send items for pricing' using errcode = '42501'; end if;
  if p_assignee is null or not public.user_has_permission(p_assignee, p_company_id, 'pricing.enter') then
    raise exception 'Choose someone who is allowed to enter prices (owner or salesperson)' using errcode = '22023';
  end if;
  if p_source_type = 'SO' then
    select id, id, customer_id, doc_no into v_so, v_so, v_cust, v_doc from public.sales_orders where id = p_source_id and company_id = p_company_id;
  elsif p_source_type = 'GDN' then
    select sales_order_id, id, customer_id, doc_no into v_so, v_gdn, v_cust, v_doc from public.gdns where id = p_source_id and company_id = p_company_id and status = 'POSTED';
  else raise exception 'Unknown source' using errcode = '22023';
  end if;
  if v_so is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if not public.can_access_customer(v_cust) then raise exception 'You do not have access to this customer' using errcode = '42501'; end if;

  select string_agg(distinct pt.doc_no, ', ') into v_clash from public.price_tasks pt join public.price_task_lines pl on pl.task_id = pt.id
   where pt.status in ('OPEN','SUBMITTED','RETURNED') and pl.sales_order_line_id in (select s.sol from public.price_source_lines(p_source_type, v_so, v_gdn) s);
  if v_clash is not null then raise exception 'These items are already on price task %', v_clash using errcode = '23505'; end if;
  if not exists (select 1 from public.price_source_lines(p_source_type, v_so, v_gdn)) then
    raise exception '% has no items waiting for a price', v_doc using errcode = '22023';
  end if;

  insert into public.price_tasks(company_id, doc_no, source_type, sales_order_id, gdn_id, customer_id, assigned_to, due_date, notes)
  values (p_company_id, public.next_document_number(p_company_id, 'PRICE_TASK'), p_source_type, v_so, v_gdn, v_cust, p_assignee, p_due, nullif(trim(p_notes),''))
  returning id into v_id;

  for r in select * from public.price_source_lines(p_source_type, v_so, v_gdn) loop
    n := n + 1;
    select * into lp from public.last_sale_price(v_cust, r.product_id, r.variant_id);
    insert into public.price_task_lines(company_id, task_id, line_no, sales_order_line_id, product_id, variant_id, quantity, last_price, last_price_date, last_price_doc)
    values (p_company_id, v_id, n, r.sol, r.product_id, r.variant_id, r.q, lp.unit_price, lp.invoice_date, lp.doc_no);
  end loop;

  insert into public.price_task_events(company_id, task_id, event, note) values (p_company_id, v_id, 'CREATED', nullif(trim(p_notes),''));
  perform public.price_notify(p_company_id, p_assignee, 'PRICE_ASSIGNED', 'Enter prices for ' || v_doc,
    (select name from public.customers where id = v_cust) || ' · ' || n || ' item(s)', v_id);
  return v_id;
end $$;

-- writes approved prices into the order, its GDN lines and unpriced draft invoice lines
create or replace function public.price_apply_line(p_sol uuid, p_price numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare inv record; x jsonb; v_new jsonb; v_prices numeric[]; v_changed boolean;
begin
  update public.sales_order_lines set unit_price = p_price where id = p_sol and unit_price is null;
  update public.gdn_lines set unit_price = p_price where sales_order_line_id = p_sol and unit_price is null;
  for inv in
    select si.id, si.lines_draft from public.sales_invoices si
    where si.status = 'DRAFT' and exists (select 1 from public.gdn_lines gl where gl.sales_order_line_id = p_sol
      and si.lines_draft @> jsonb_build_array(jsonb_build_object('sources', jsonb_build_array(jsonb_build_object('gdn_line_id', gl.id)))))
    for update of si
  loop
    v_new := '[]'::jsonb; v_changed := false;
    for x in select * from jsonb_array_elements(inv.lines_draft) loop
      if (x->>'unit_price') is null then
        select array_agg(distinct gl.unit_price) into v_prices from jsonb_array_elements(x->'sources') s
          join public.gdn_lines gl on gl.id = (s->>'gdn_line_id')::uuid;
        if array_length(v_prices, 1) = 1 and v_prices[1] is not null then
          x := x || jsonb_build_object('unit_price', v_prices[1], 'approved_price', v_prices[1]);
          v_changed := true;
        end if;
      end if;
      v_new := v_new || jsonb_build_array(x);
    end loop;
    if v_changed then
      update public.sales_invoices set lines_draft = v_new where id = inv.id;
      perform public.inv_recalc_invoice(inv.id);
    end if;
  end loop;
end $$;

revoke all on function public.create_price_task(uuid,text,uuid,uuid,date,text), public.save_price_task(uuid,jsonb), public.submit_price_task(uuid,jsonb,text),
  public.return_price_task(uuid,text), public.approve_price_task(uuid,jsonb,text), public.reassign_price_task(uuid,uuid,text),
  public.cancel_price_task(uuid,text), public.pricing_people(uuid), public.pending_prices(uuid), public.price_task_guard(uuid,text) from anon;
revoke execute on function public.price_apply_line(uuid,numeric), public.price_notify(uuid,uuid,text,text,text,uuid),
  public.price_notify_approvers(uuid,text,text,text,uuid) from public, anon, authenticated;
