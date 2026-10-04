-- Stage 7 part 2 — delayed purchase cost: receipt → COST_PENDING → assign → enter → submit → accountant approves → Inventory / GRNI

-- supplier bills (posting logic in part 3)
create table if not exists public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  bill_date date not null,
  due_date date,
  supplier_id uuid not null references public.suppliers(id),
  supplier_invoice_no text,
  currency text not null default 'PKR',
  fx_rate numeric not null default 1 check (fx_rate > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  lines_draft jsonb not null default '[]'::jsonb,
  total_amount numeric not null default 0,
  total_pkr numeric not null default 0,
  journal_entry_id uuid references public.journal_entries(id),
  notes text,
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists sb_company on public.supplier_bills(company_id, status, bill_date desc);
create index if not exists sb_supplier on public.supplier_bills(supplier_id);
alter table public.supplier_bills enable row level security;
create policy sb_select on public.supplier_bills for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));

create table if not exists public.supplier_bill_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  bill_id uuid not null references public.supplier_bills(id),
  line_no int not null,
  kind text not null check (kind in ('ITEM','EXPENSE')),
  receipt_line_id uuid references public.goods_receipt_lines(id),
  product_id uuid references public.products(id),
  variant_id uuid references public.product_variants(id),
  account_id uuid references public.chart_of_accounts(id),
  description text,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  amount numeric not null,
  amount_pkr numeric not null,
  receipt_value_pkr numeric
);
create index if not exists sbl_bill on public.supplier_bill_lines(bill_id);
create index if not exists sbl_receipt_line on public.supplier_bill_lines(receipt_line_id);
alter table public.supplier_bill_lines enable row level security;
create policy sbl_select on public.supplier_bill_lines for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));

create table if not exists public.supplier_bill_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  payment_entry_id uuid not null references public.journal_entries(id),
  bill_id uuid not null references public.supplier_bills(id),
  amount numeric not null check (amount > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REMOVED')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  removed_at timestamptz, removed_by uuid
);
create index if not exists sba_bill on public.supplier_bill_allocations(bill_id) where status = 'ACTIVE';
create index if not exists sba_payment on public.supplier_bill_allocations(payment_entry_id) where status = 'ACTIVE';
alter table public.supplier_bill_allocations enable row level security;
create policy sba_select on public.supplier_bill_allocations for select to authenticated using (public.has_permission(company_id, 'purchasing.costs'));

create table if not exists public.purchase_cost_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  receipt_id uuid not null references public.goods_receipts(id),
  supplier_id uuid references public.suppliers(id),
  assigned_to uuid not null references auth.users(id),
  status text not null default 'OPEN' check (status in ('OPEN','SUBMITTED','RETURNED','APPROVED','CANCELLED')),
  currency text not null default 'PKR',
  fx_rate numeric not null default 1 check (fx_rate > 0),
  due_date date, notes text, return_reason text,
  revision int not null default 0,
  submitted_at timestamptz, submitted_by uuid, submit_note text,
  approved_at timestamptz, approved_by uuid,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists pct_company on public.purchase_cost_tasks(company_id, status);
create index if not exists pct_receipt on public.purchase_cost_tasks(receipt_id);
alter table public.purchase_cost_tasks enable row level security;
create policy pct_select on public.purchase_cost_tasks for select to authenticated
  using (assigned_to = auth.uid() or public.has_permission(company_id, 'purchasing.costs'));
alter table public.purchase_cost_tasks replica identity full;
alter publication supabase_realtime add table public.purchase_cost_tasks;

create table if not exists public.purchase_cost_task_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null references public.purchase_cost_tasks(id),
  line_no int not null,
  receipt_line_id uuid not null references public.goods_receipt_lines(id),
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  quantity numeric not null,
  last_cost numeric, last_cost_currency text, last_cost_date date, last_cost_doc text,
  entered_cost numeric check (entered_cost is null or entered_cost >= 0),
  approved_cost numeric check (approved_cost is null or approved_cost >= 0),
  note text
);
create index if not exists pctl_task on public.purchase_cost_task_lines(task_id);
alter table public.purchase_cost_task_lines enable row level security;
create policy pctl_select on public.purchase_cost_task_lines for select to authenticated using (exists (select 1 from public.purchase_cost_tasks t where t.id = task_id));

create table if not exists public.purchase_cost_task_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null references public.purchase_cost_tasks(id),
  event text not null check (event in ('CREATED','SUBMITTED','RETURNED','APPROVED','REASSIGNED','CANCELLED')),
  actor uuid default auth.uid(), at timestamptz not null default now(), note text, costs jsonb
);
create index if not exists pcte_task on public.purchase_cost_task_events(task_id, at);
alter table public.purchase_cost_task_events enable row level security;
create policy pcte_select on public.purchase_cost_task_events for select to authenticated using (exists (select 1 from public.purchase_cost_tasks t where t.id = task_id));

create trigger receipt_po after update of status on public.goods_receipts for each row execute function public.tg_receipt_po();

-- ───── history & suggestions (supplier price history = approved receipt costs + posted bill prices) ─────
create or replace function public.purchase_price_history(p_company_id uuid, p_supplier_id uuid default null, p_product_id uuid default null, p_limit int default 300)
returns table(price_date date, supplier_id uuid, supplier_name text, product_id uuid, variant_id uuid, product_name text, variant_name text,
              quantity numeric, currency text, unit_price numeric, unit_price_pkr numeric, source text, source_id uuid, source_doc text)
language sql stable security definer set search_path = '' as $$
  select * from (
    select g.doc_date, g.supplier_id, s.name, l.product_id, l.variant_id, p.name, v.name, l.quantity, coalesce(g.cost_currency, 'PKR'), l.unit_cost, l.unit_cost_pkr,
           'RECEIPT_COST'::text, g.id, g.doc_no
    from public.goods_receipt_lines l join public.goods_receipts g on g.id = l.receipt_id join public.products p on p.id = l.product_id
    left join public.product_variants v on v.id = l.variant_id left join public.suppliers s on s.id = g.supplier_id
    where g.company_id = p_company_id and g.status = 'POSTED' and l.cost_source = 'COST_TASK' and l.unit_cost is not null
    union all
    select b.bill_date, b.supplier_id, s.name, bl.product_id, bl.variant_id, p.name, v.name, bl.quantity, b.currency, bl.unit_price, round(bl.unit_price * b.fx_rate, 4),
           'BILL'::text, b.id, b.doc_no
    from public.supplier_bill_lines bl join public.supplier_bills b on b.id = bl.bill_id join public.products p on p.id = bl.product_id
    left join public.product_variants v on v.id = bl.variant_id join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company_id and b.status = 'POSTED' and bl.product_id is not null
  ) h(price_date, supplier_id, supplier_name, product_id, variant_id, product_name, variant_name, quantity, currency, unit_price, unit_price_pkr, source, source_id, source_doc)
  where public.has_permission(p_company_id, 'purchasing.costs')
    and (p_supplier_id is null or h.supplier_id = p_supplier_id) and (p_product_id is null or h.product_id = p_product_id)
  order by h.price_date desc, h.source_doc desc
  limit p_limit;
$$;

-- average purchase cost (PKR) per item over approved / billed receipts
create or replace function public.item_purchase_costs(p_company_id uuid)
returns table(product_id uuid, variant_id uuid, product_name text, variant_name text, costed_qty numeric, avg_cost_pkr numeric, last_cost_pkr numeric, last_cost_date date)
language sql stable security definer set search_path = '' as $$
  select l.product_id, l.variant_id, min(p.name), min(v.name), sum(l.quantity), round(sum(l.quantity * l.unit_cost_pkr) / nullif(sum(l.quantity), 0), 4),
    (array_agg(l.unit_cost_pkr order by g.doc_date desc, g.created_at desc))[1], max(g.doc_date)
  from public.goods_receipt_lines l join public.goods_receipts g on g.id = l.receipt_id join public.products p on p.id = l.product_id
  left join public.product_variants v on v.id = l.variant_id
  where g.company_id = p_company_id and g.status = 'POSTED' and l.unit_cost_pkr is not null and public.has_permission(p_company_id, 'purchasing.costs')
  group by l.product_id, l.variant_id order by min(p.name);
$$;

-- receipt lines with their costs (costs are column-protected)
create or replace function public.receipt_line_costs(p_receipt_id uuid)
returns table(line_id uuid, unit_cost numeric, unit_cost_pkr numeric, cost_source text, billed_qty numeric, currency text, fx_rate numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, l.unit_cost, l.unit_cost_pkr, l.cost_source, l.billed_qty, g.cost_currency, g.cost_fx_rate
  from public.goods_receipt_lines l join public.goods_receipts g on g.id = l.receipt_id
  where l.receipt_id = p_receipt_id and public.has_permission(g.company_id, 'purchasing.costs');
$$;

-- posted receipts with items still waiting for a cost
create or replace function public.pending_purchase_costs(p_company_id uuid)
returns table(receipt_id uuid, doc_no text, doc_date date, supplier_id uuid, supplier_name text, warehouse_code text, purchase_order_no text,
              missing_lines int, total_lines int, task_id uuid, task_no text, task_status text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.doc_no, g.doc_date, g.supplier_id, s.name, w.code, po.doc_no,
    count(*) filter (where l.unit_cost is null)::int, count(*)::int, t.id, t.doc_no, t.status
  from public.goods_receipts g join public.goods_receipt_lines l on l.receipt_id = g.id
  left join public.suppliers s on s.id = g.supplier_id left join public.warehouses w on w.id = g.warehouse_id
  left join public.purchase_orders po on po.id = g.purchase_order_id
  left join lateral (select x.id, x.doc_no, x.status from public.purchase_cost_tasks x where x.receipt_id = g.id and x.status in ('OPEN','SUBMITTED','RETURNED') order by x.created_at desc limit 1) t on true
  where g.company_id = p_company_id and g.status = 'POSTED' and public.has_permission(p_company_id, 'purchasing.costs')
  group by g.id, g.doc_no, g.doc_date, g.supplier_id, s.name, w.code, po.doc_no, t.id, t.doc_no, t.status
  having count(*) filter (where l.unit_cost is null) > 0
  order by g.doc_date desc;
$$;

create or replace function public.cost_notify(p_company uuid, p_user uuid, p_kind text, p_title text, p_body text, p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.staff_notifications(company_id, user_id, kind, urgent, title, body, job_type, job_id, created_by)
  values (p_company, p_user, p_kind, false, p_title, p_body, 'COST', p_task, auth.uid());
end $$;
create or replace function public.cost_notify_approvers(p_company uuid, p_kind text, p_title text, p_body text, p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  for u in select distinct user_id from public.user_roles where company_id = p_company loop
    if public.user_has_permission(u, p_company, 'purchasing.approve') then perform public.cost_notify(p_company, u, p_kind, p_title, p_body, p_task); end if;
  end loop;
end $$;

create or replace function public.cost_task_snapshot(p_task uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'entered', entered_cost, 'approved', approved_cost, 'note', note) order by line_no), '[]'::jsonb)
  from public.purchase_cost_task_lines where task_id = p_task;
$$;

-- ───── applying costs to a receipt: Dr Inventory / Cr Goods Received Not Billed ─────
-- p_costs: [{receipt_line_id, unit_cost}] in p_currency; only lines without a cost are touched
create or replace function public.receipt_apply_costs(p_receipt_id uuid, p_currency text, p_fx numeric, p_costs jsonb, p_source_doc text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.goods_receipts; x jsonb; l public.goods_receipt_lines; v_pkr numeric; v_total numeric := 0; v_ids uuid[] := '{}'; v_je uuid;
begin
  select * into g from public.goods_receipts where id = p_receipt_id for update;
  if g.status <> 'POSTED' then raise exception 'Costs can be applied only to a posted receipt' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_costs) loop
    select * into l from public.goods_receipt_lines where id = (x->>'receipt_line_id')::uuid and receipt_id = p_receipt_id for update;
    if l.id is null or l.unit_cost is not null then continue; end if;
    v_pkr := round((x->>'unit_cost')::numeric * p_fx, 4);
    update public.goods_receipt_lines set unit_cost = (x->>'unit_cost')::numeric, unit_cost_pkr = v_pkr, cost_source = 'COST_TASK' where id = l.id;
    v_total := v_total + round(v_pkr * l.quantity, 2);
    v_ids := v_ids || l.id;
  end loop;
  if array_length(v_ids, 1) is null then return null; end if;
  if v_total > 0 then
    v_je := public.acc_post_document_entry(g.company_id, 'SYSTEM', g.doc_date, 'Purchase cost of ' || g.doc_no || coalesce(' (' || p_source_doc || ')', ''), g.doc_no,
      null, null, null, v_total,
      jsonb_build_array(
        jsonb_build_object('account_id', public.hr_account(g.company_id, 'INVENTORY'), 'debit', v_total, 'description', 'Stock received ' || g.doc_no),
        jsonb_build_object('account_id', public.hr_account(g.company_id, 'GRNI'), 'credit', v_total, 'description', 'Received, not yet billed ' || g.doc_no)),
      'GOODS_RECEIPT_COST', g.id);
    update public.goods_receipt_lines set cost_entry_id = v_je where id = any(v_ids);
  end if;
  update public.goods_receipts set cost_currency = coalesce(cost_currency, p_currency), cost_fx_rate = coalesce(cost_fx_rate, p_fx),
    cost_status = case when exists (select 1 from public.goods_receipt_lines where receipt_id = g.id and unit_cost is null) then cost_status else 'APPROVED' end
  where id = g.id;
  return v_je;
end $$;

-- ───── cost tasks ─────
create or replace function public.create_cost_task(p_receipt_id uuid, p_assignee uuid, p_due date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.goods_receipts; v_id uuid; l record; n int := 0; h record; v_cur text;
begin
  select * into g from public.goods_receipts where id = p_receipt_id;
  if g.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(g.company_id, 'purchasing.costs') or public.has_permission(g.company_id, 'purchasing.manage')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if g.status <> 'POSTED' then raise exception 'Post the receipt first' using errcode = '22023'; end if;
  if p_assignee is null or not public.user_has_permission(p_assignee, g.company_id, 'purchasing.costs') then
    raise exception 'Choose someone allowed to enter purchase costs (owner / accountant)' using errcode = '22023';
  end if;
  if exists (select 1 from public.purchase_cost_tasks where receipt_id = g.id and status in ('OPEN','SUBMITTED','RETURNED')) then
    raise exception 'This receipt already has an open cost task' using errcode = '23505';
  end if;
  select coalesce(po.currency, s.default_currency, 'PKR') into v_cur from public.suppliers s left join public.purchase_orders po on po.id = g.purchase_order_id where s.id = g.supplier_id;
  insert into public.purchase_cost_tasks(company_id, doc_no, receipt_id, supplier_id, assigned_to, due_date, notes, currency, fx_rate)
  values (g.company_id, public.next_document_number(g.company_id, 'COST_TASK'), g.id, g.supplier_id, p_assignee, p_due, nullif(trim(p_notes),''),
    coalesce(v_cur, 'PKR'), coalesce((select fx_rate from public.purchase_orders where id = g.purchase_order_id), 1))
  returning id into v_id;
  for l in select * from public.goods_receipt_lines where receipt_id = g.id and unit_cost is null order by line_no loop
    n := n + 1;
    select * into h from public.purchase_price_history(g.company_id, g.supplier_id, l.product_id, 50) x where x.variant_id is not distinct from l.variant_id limit 1;
    insert into public.purchase_cost_task_lines(company_id, task_id, line_no, receipt_line_id, product_id, variant_id, quantity, last_cost, last_cost_currency, last_cost_date, last_cost_doc, entered_cost)
    values (g.company_id, v_id, n, l.id, l.product_id, l.variant_id, l.quantity, h.unit_price, h.currency, h.price_date, h.source_doc,
      (select pl.unit_price from public.goods_receipt_po_links k join public.purchase_order_lines pl on pl.id = k.po_line_id where k.receipt_line_id = l.id and not k.reversed limit 1));
  end loop;
  if n = 0 then raise exception 'Every item on this receipt already has a cost' using errcode = '22023'; end if;
  insert into public.purchase_cost_task_events(company_id, task_id, event, note) values (g.company_id, v_id, 'CREATED', nullif(trim(p_notes),''));
  perform public.cost_notify(g.company_id, p_assignee, 'COST_ASSIGNED', 'Enter purchase cost for ' || g.doc_no, n || ' item(s)', v_id);
  return v_id;
end $$;

create or replace function public.cost_task_guard(p_task uuid, p_mode text) returns public.purchase_cost_tasks
language plpgsql security definer set search_path = '' as $$
declare t public.purchase_cost_tasks;
begin
  select * into t from public.purchase_cost_tasks where id = p_task for update;
  if t.id is null then raise exception 'Cost task not found' using errcode = 'P0002'; end if;
  if p_mode = 'enter' then
    if t.status not in ('OPEN','RETURNED') then raise exception 'This cost task is % — it cannot be changed', lower(t.status) using errcode = '22023'; end if;
    if not ((t.assigned_to = auth.uid() and public.has_permission(t.company_id, 'purchasing.costs')) or public.has_permission(t.company_id, 'purchasing.approve')) then
      raise exception 'Only the assigned person can enter these costs' using errcode = '42501';
    end if;
  elsif p_mode = 'approve' then
    perform public.inv_require(t.company_id, 'purchasing.approve');
  elsif p_mode = 'manage' then
    if not (public.has_permission(t.company_id, 'purchasing.costs') or public.has_permission(t.company_id, 'purchasing.manage')) then raise exception 'Not allowed' using errcode = '42501'; end if;
    if t.status in ('APPROVED','CANCELLED') then raise exception 'This cost task is already %', lower(t.status) using errcode = '22023'; end if;
  end if;
  return t;
end $$;

-- p_lines: [{id, cost, note}]
create or replace function public.save_cost_task(p_task_id uuid, p_currency text, p_fx numeric, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.purchase_cost_tasks; x jsonb; v numeric;
begin
  t := public.cost_task_guard(p_task_id, 'enter');
  if coalesce(p_fx, 0) <= 0 then raise exception 'Exchange rate must be above zero' using errcode = '23514'; end if;
  if upper(coalesce(p_currency, 'PKR')) = 'PKR' and p_fx <> 1 then raise exception 'PKR costs use exchange rate 1' using errcode = '23514'; end if;
  update public.purchase_cost_tasks set currency = upper(coalesce(nullif(trim(p_currency),''), 'PKR')), fx_rate = p_fx, updated_at = now() where id = p_task_id;
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v := nullif(x->>'cost','')::numeric;
    if v is not null and v < 0 then raise exception 'Costs cannot be negative' using errcode = '23514'; end if;
    update public.purchase_cost_task_lines set entered_cost = v, note = nullif(trim(x->>'note'),'') where id = (x->>'id')::uuid and task_id = p_task_id;
  end loop;
end $$;

create or replace function public.submit_cost_task(p_task_id uuid, p_currency text, p_fx numeric, p_lines jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.purchase_cost_tasks; v_missing int;
begin
  perform public.save_cost_task(p_task_id, p_currency, p_fx, p_lines);
  select * into t from public.purchase_cost_tasks where id = p_task_id;
  select count(*) into v_missing from public.purchase_cost_task_lines where task_id = p_task_id and entered_cost is null;
  if v_missing > 0 then raise exception 'Enter a cost for every item (% missing) — a missing cost is not zero', v_missing using errcode = '23502'; end if;
  update public.purchase_cost_tasks set status = 'SUBMITTED', submitted_at = now(), submitted_by = auth.uid(), submit_note = nullif(trim(p_note),''), revision = revision + 1, updated_at = now() where id = p_task_id;
  update public.goods_receipts set cost_status = 'ENTERED' where id = t.receipt_id and cost_status = 'PENDING';
  insert into public.purchase_cost_task_events(company_id, task_id, event, note, costs) values (t.company_id, p_task_id, 'SUBMITTED', nullif(trim(p_note),''), public.cost_task_snapshot(p_task_id));
  perform public.cost_notify_approvers(t.company_id, 'COST_SUBMITTED', 'Purchase costs to review — ' || t.doc_no, nullif(trim(p_note),''), p_task_id);
end $$;

create or replace function public.return_cost_task(p_task_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.purchase_cost_tasks;
begin
  t := public.cost_task_guard(p_task_id, 'approve');
  if t.status <> 'SUBMITTED' then raise exception 'Only submitted costs can be sent back' using errcode = '22023'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Say why the costs are sent back' using errcode = '23502'; end if;
  update public.purchase_cost_tasks set status = 'RETURNED', return_reason = trim(p_reason), updated_at = now() where id = p_task_id;
  update public.goods_receipts set cost_status = 'PENDING' where id = t.receipt_id and cost_status = 'ENTERED';
  insert into public.purchase_cost_task_events(company_id, task_id, event, note, costs) values (t.company_id, p_task_id, 'RETURNED', trim(p_reason), public.cost_task_snapshot(p_task_id));
  perform public.cost_notify(t.company_id, t.assigned_to, 'COST_RETURNED', 'Costs sent back — ' || t.doc_no, trim(p_reason), p_task_id);
end $$;

-- p_lines optional: [{id, cost}] accountant's corrections
create or replace function public.approve_cost_task(p_task_id uuid, p_lines jsonb default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.purchase_cost_tasks; x jsonb; v numeric; v_je uuid;
begin
  t := public.cost_task_guard(p_task_id, 'approve');
  if t.status <> 'SUBMITTED' then raise exception 'Costs must be submitted before they are approved' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v := nullif(x->>'cost','')::numeric;
    if v is not null and v < 0 then raise exception 'Costs cannot be negative' using errcode = '23514'; end if;
    update public.purchase_cost_task_lines set approved_cost = v where id = (x->>'id')::uuid and task_id = p_task_id;
  end loop;
  update public.purchase_cost_task_lines set approved_cost = coalesce(approved_cost, entered_cost) where task_id = p_task_id;
  v_je := public.receipt_apply_costs(t.receipt_id, t.currency, t.fx_rate,
    (select jsonb_agg(jsonb_build_object('receipt_line_id', receipt_line_id, 'unit_cost', approved_cost)) from public.purchase_cost_task_lines where task_id = p_task_id), t.doc_no);
  update public.purchase_cost_tasks set status = 'APPROVED', approved_at = now(), approved_by = auth.uid(), updated_at = now() where id = p_task_id;
  insert into public.purchase_cost_task_events(company_id, task_id, event, note, costs) values (t.company_id, p_task_id, 'APPROVED', nullif(trim(p_note),''), public.cost_task_snapshot(p_task_id));
  perform public.cost_notify(t.company_id, t.assigned_to, 'COST_APPROVED', 'Costs approved — ' || t.doc_no, nullif(trim(p_note),''), p_task_id);
  return v_je;
end $$;

create or replace function public.reassign_cost_task(p_task_id uuid, p_assignee uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.purchase_cost_tasks;
begin
  t := public.cost_task_guard(p_task_id, 'manage');
  if p_assignee is null or not public.user_has_permission(p_assignee, t.company_id, 'purchasing.costs') then raise exception 'Choose someone allowed to enter purchase costs' using errcode = '22023'; end if;
  update public.purchase_cost_tasks set assigned_to = p_assignee, status = case when status = 'SUBMITTED' then 'OPEN' else status end, updated_at = now() where id = p_task_id;
  insert into public.purchase_cost_task_events(company_id, task_id, event, note) values (t.company_id, p_task_id, 'REASSIGNED', nullif(trim(p_note),''));
  perform public.cost_notify(t.company_id, p_assignee, 'COST_ASSIGNED', 'Enter purchase cost — ' || t.doc_no, nullif(trim(p_note),''), p_task_id);
end $$;

create or replace function public.cancel_cost_task(p_task_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.purchase_cost_tasks;
begin
  t := public.cost_task_guard(p_task_id, 'manage');
  update public.purchase_cost_tasks set status = 'CANCELLED', updated_at = now() where id = p_task_id;
  update public.goods_receipts set cost_status = 'PENDING' where id = t.receipt_id and cost_status = 'ENTERED';
  insert into public.purchase_cost_task_events(company_id, task_id, event, note) values (t.company_id, p_task_id, 'CANCELLED', nullif(trim(p_reason),''));
end $$;

-- "Enter purchase cost now" on a receipt: a cost task for yourself, submitted at once — approved at once if you may approve
-- p_costs: [{receipt_line_id, unit_cost}]
create or replace function public.enter_receipt_cost(p_receipt_id uuid, p_currency text, p_fx numeric, p_costs jsonb, p_approve boolean default true, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.goods_receipts; v_task uuid; v_lines jsonb;
begin
  select * into g from public.goods_receipts where id = p_receipt_id;
  if g.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  perform public.inv_require(g.company_id, 'purchasing.costs');
  select id into v_task from public.purchase_cost_tasks where receipt_id = g.id and status in ('OPEN','SUBMITTED','RETURNED') limit 1;
  if v_task is null then
    v_task := public.create_cost_task(g.id, auth.uid(), null, p_note);
  else
    update public.purchase_cost_tasks set assigned_to = auth.uid(), status = case when status = 'SUBMITTED' then 'OPEN' else status end where id = v_task;
  end if;
  select jsonb_agg(jsonb_build_object('id', tl.id, 'cost', c->>'unit_cost')) into v_lines
    from public.purchase_cost_task_lines tl join jsonb_array_elements(p_costs) c on (c->>'receipt_line_id')::uuid = tl.receipt_line_id
   where tl.task_id = v_task;
  perform public.submit_cost_task(v_task, p_currency, p_fx, coalesce(v_lines, '[]'::jsonb), p_note);
  if p_approve and public.has_permission(g.company_id, 'purchasing.approve') then
    perform public.approve_cost_task(v_task, null, p_note);
  end if;
  return v_task;
end $$;

revoke all on function public.receipt_apply_costs(uuid,text,numeric,jsonb,text), public.cost_notify(uuid,uuid,text,text,text,uuid),
  public.cost_notify_approvers(uuid,text,text,text,uuid), public.tg_receipt_po() from public, anon, authenticated;
revoke all on function public.create_cost_task(uuid,uuid,date,text), public.save_cost_task(uuid,text,numeric,jsonb), public.submit_cost_task(uuid,text,numeric,jsonb,text),
  public.return_cost_task(uuid,text), public.approve_cost_task(uuid,jsonb,text), public.reassign_cost_task(uuid,uuid,text), public.cancel_cost_task(uuid,text),
  public.enter_receipt_cost(uuid,text,numeric,jsonb,boolean,text), public.pending_purchase_costs(uuid), public.receipt_line_costs(uuid),
  public.item_purchase_costs(uuid), public.purchase_price_history(uuid,uuid,uuid,int), public.save_purchase_order(uuid,jsonb,jsonb,uuid),
  public.set_purchase_order_status(uuid,text,text), public.po_line_prices(uuid), public.receive_purchase_order(uuid,uuid,date,jsonb,text),
  public.link_receipt_to_po(uuid,uuid), public.cost_task_guard(uuid,text) from anon;
