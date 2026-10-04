-- Stage 6.5 part 2 — salaries, payment details, earnings/deductions, advances, leave, labour rates, assembly labour

create or replace function public.hr_account(p_company uuid, p_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.chart_of_accounts where company_id = p_company and system_key = p_key and is_active and not is_group limit 1;
  if v is null then raise exception 'System account % is missing in the chart of accounts', p_key using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.hr_employee(p_employee uuid) returns public.employees
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  return e;
end $$;

create or replace function public.hr_month(p_date date) returns date
language sql immutable set search_path = '' as $$ select date_trunc('month', p_date)::date; $$;

-- ───── salary (effective-dated; history is never rewritten) ─────
create or replace function public.set_employee_salary(p_employee_id uuid, p_monthly_salary numeric, p_effective_from date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_id uuid; v_prev record;
begin
  e := public.hr_employee(p_employee_id);
  perform public.inv_require(e.company_id, 'payroll.approve');
  if p_monthly_salary is null or p_monthly_salary < 0 then raise exception 'Enter the monthly salary' using errcode = '23502'; end if;
  if p_effective_from is null then raise exception 'Choose the date the salary starts' using errcode = '23502'; end if;
  if exists (select 1 from public.payroll_lines pl join public.payroll_runs r on r.id = pl.run_id
             where pl.employee_id = p_employee_id and r.status = 'POSTED' and r.period_month >= public.hr_month(p_effective_from)) then
    raise exception 'Payroll from % onwards is already posted for this employee — choose a later start date', to_char(p_effective_from, 'Mon YYYY') using errcode = '22023';
  end if;
  if exists (select 1 from public.employee_salary_assignments where employee_id = p_employee_id and effective_from >= p_effective_from) then
    raise exception 'A salary starting on or after this date already exists — choose a later date' using errcode = '22023';
  end if;
  update public.employee_salary_assignments set effective_to = p_effective_from - 1
   where employee_id = p_employee_id and (effective_to is null or effective_to >= p_effective_from);
  insert into public.employee_salary_assignments(company_id, employee_id, monthly_salary, effective_from, note)
  values (e.company_id, p_employee_id, round(p_monthly_salary, 2), p_effective_from, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.hr_salary_on(p_employee uuid, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select monthly_salary from public.employee_salary_assignments
  where employee_id = p_employee and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
  order by effective_from desc limit 1;
$$;

-- list for the HR screen: employees with current salary and balances
create or replace function public.hr_overview(p_company_id uuid)
returns table(employee_id uuid, code text, full_name text, department text, "position" text, status text, payroll_eligible boolean,
              current_salary numeric, salary_from date, advance_outstanding numeric, payable_balance numeric, payment_method text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.code, e.full_name, e.department, e.position, e.status, e.payroll_eligible,
    s.monthly_salary, s.effective_from,
    coalesce((select sum(a.amount - a.recovered_amount - a.written_off_amount) from public.employee_advances a where a.employee_id = e.id and a.status = 'OPEN'), 0),
    coalesce((select sum(jl.credit - jl.debit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
              where jl.party_type = 'EMPLOYEE' and jl.party_id = e.id and je.status in ('POSTED','REVERSED')
                and jl.account_id = (select id from public.chart_of_accounts c where c.company_id = e.company_id and c.system_key = 'EMPLOYEE_PAYABLE' limit 1)), 0),
    d.payment_method
  from public.employees e
  left join lateral (select x.monthly_salary, x.effective_from from public.employee_salary_assignments x
                     where x.employee_id = e.id and x.effective_from <= current_date order by x.effective_from desc limit 1) s on true
  left join public.employee_payment_details d on d.employee_id = e.id
  where e.company_id = p_company_id and public.has_permission(p_company_id, 'payroll.view')
  order by e.full_name;
$$;

create or replace function public.set_employee_payment_details(p_employee_id uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.employees;
begin
  e := public.hr_employee(p_employee_id);
  if not (public.has_permission(e.company_id, 'payroll.manage') or public.has_permission(e.company_id, 'employees.view_restricted')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.employee_payment_details(employee_id, company_id, payment_method, bank_name, account_title, account_number, iban)
  values (p_employee_id, e.company_id, coalesce(nullif(p_details->>'payment_method',''), 'CASH'), nullif(trim(p_details->>'bank_name'),''),
    nullif(trim(p_details->>'account_title'),''), nullif(trim(p_details->>'account_number'),''), nullif(trim(p_details->>'iban'),''))
  on conflict (employee_id) do update set payment_method = excluded.payment_method, bank_name = excluded.bank_name,
    account_title = excluded.account_title, account_number = excluded.account_number, iban = excluded.iban, updated_at = now(), updated_by = auth.uid();
  if p_details ? 'payroll_eligible' then
    update public.employees set payroll_eligible = coalesce((p_details->>'payroll_eligible')::boolean, true) where id = p_employee_id;
  end if;
end $$;

-- ───── earnings / deductions ─────
create or replace function public.add_pay_item(p_employee_id uuid, p_direction text, p_type text, p_amount numeric, p_date date,
  p_month date default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_id uuid;
begin
  e := public.hr_employee(p_employee_id);
  perform public.inv_require(e.company_id, 'payroll.manage');
  if p_type = 'ASSEMBLY_LABOUR' then raise exception 'Assembly labour comes from approved assembly work' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount' using errcode = '23502'; end if;
  insert into public.employee_pay_items(company_id, employee_id, direction, item_type, amount, item_date, period_month, description)
  values (e.company_id, p_employee_id, p_direction, p_type, round(p_amount, 2), coalesce(p_date, current_date),
    public.hr_month(coalesce(p_month, p_date, current_date)), nullif(trim(p_description), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.decide_pay_items(p_ids uuid[], p_approve boolean, p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select * from public.employee_pay_items where id = any(p_ids) for update loop
    perform public.inv_require(r.company_id, 'payroll.approve');
    if r.status <> 'PENDING' then continue; end if;
    update public.employee_pay_items set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.cancel_pay_item(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.employee_pay_items;
begin
  select * into r from public.employee_pay_items where id = p_id for update;
  if r.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'payroll.manage');
  if r.payroll_run_id is not null and exists (select 1 from public.payroll_runs where id = r.payroll_run_id and status in ('APPROVED','POSTED')) then
    raise exception 'This item is already in an approved / posted payroll' using errcode = '22023';
  end if;
  if r.source_type = 'ASSEMBLY' then raise exception 'Reopen the assembly labour on the assembly order instead' using errcode = '22023'; end if;
  update public.employee_pay_items set status = 'CANCELLED', payroll_run_id = null, decision_note = coalesce(nullif(trim(p_note),''), decision_note),
    decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

-- ───── advances ─────
create or replace function public.request_employee_advance(p_employee_id uuid, p_amount numeric, p_date date, p_reason text,
  p_recovery_per_month numeric default null, p_bank_account_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_id uuid;
begin
  e := public.hr_employee(p_employee_id);
  perform public.inv_require(e.company_id, 'payroll.manage');
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the advance amount' using errcode = '23502'; end if;
  insert into public.employee_advances(company_id, doc_no, employee_id, advance_date, amount, reason, recovery_per_month, bank_account_id)
  values (e.company_id, public.next_document_number(e.company_id, 'EMP_ADVANCE'), p_employee_id, coalesce(p_date, current_date), round(p_amount, 2),
    nullif(trim(p_reason), ''), nullif(p_recovery_per_month, 0), p_bank_account_id)
  returning id into v_id;
  return v_id;
end $$;

-- approval pays the advance out of the chosen bank / cash account: Dr Employee Advances / Cr Bank
create or replace function public.approve_employee_advance(p_id uuid, p_bank_account_id uuid default null, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.employee_advances; b record; v_je uuid; v_date date;
begin
  select * into a from public.employee_advances where id = p_id for update;
  if a.id is null then raise exception 'Advance not found' using errcode = 'P0002'; end if;
  perform public.inv_require(a.company_id, 'payroll.approve');
  if a.status <> 'REQUESTED' then raise exception 'This advance is already %', lower(a.status) using errcode = '22023'; end if;
  select * into b from public.bank_accounts where id = coalesce(p_bank_account_id, a.bank_account_id) and company_id = a.company_id and is_active;
  if b.id is null then raise exception 'Choose the bank / cash account the advance is paid from' using errcode = '23502'; end if;
  v_date := coalesce(p_date, a.advance_date);
  v_je := public.acc_post_document_entry(a.company_id, 'PAYMENT', v_date, 'Employee advance ' || a.doc_no, a.doc_no, 'EMPLOYEE', a.employee_id, b.id, a.amount,
    jsonb_build_array(
      jsonb_build_object('account_id', public.hr_account(a.company_id, 'EMPLOYEE_ADVANCE'), 'debit', a.amount, 'party_type', 'EMPLOYEE', 'party_id', a.employee_id, 'description', coalesce(a.reason, 'Advance')),
      jsonb_build_object('account_id', b.gl_account_id, 'credit', a.amount, 'bank_account_id', b.id, 'description', 'Advance paid')),
    'EMP_ADVANCE', a.id);
  update public.employee_advances set status = 'OPEN', bank_account_id = b.id, advance_date = v_date, journal_entry_id = v_je,
    approved_by = auth.uid(), approved_at = now() where id = p_id;
  insert into public.employee_advance_transactions(company_id, advance_id, kind, amount, txn_date, journal_entry_id)
  values (a.company_id, a.id, 'GRANT', a.amount, v_date, v_je);
  return v_je;
end $$;

create or replace function public.reject_employee_advance(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.employee_advances;
begin
  select * into a from public.employee_advances where id = p_id for update;
  perform public.inv_require(a.company_id, 'payroll.approve');
  if a.status <> 'REQUESTED' then raise exception 'Only requested advances can be rejected' using errcode = '22023'; end if;
  update public.employee_advances set status = 'REJECTED', reason = coalesce(reason || ' · ', '') || coalesce('rejected: ' || nullif(trim(p_note),''), 'rejected') where id = p_id;
end $$;

-- employee pays back in cash / bank: Dr Bank / Cr Employee Advances
create or replace function public.repay_employee_advance(p_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.employee_advances; b record; v_je uuid; v_left numeric;
begin
  select * into a from public.employee_advances where id = p_id for update;
  if a.id is null then raise exception 'Advance not found' using errcode = 'P0002'; end if;
  perform public.inv_require(a.company_id, 'payroll.manage');
  if a.status <> 'OPEN' then raise exception 'This advance is not open' using errcode = '22023'; end if;
  v_left := a.amount - a.recovered_amount - a.written_off_amount;
  if coalesce(p_amount, 0) <= 0 or p_amount > v_left then raise exception 'Enter an amount up to the outstanding %', v_left using errcode = '23514'; end if;
  select * into b from public.bank_accounts where id = p_bank_account_id and company_id = a.company_id and is_active;
  if b.id is null then raise exception 'Choose the bank / cash account' using errcode = '23502'; end if;
  v_je := public.acc_post_document_entry(a.company_id, 'RECEIPT', coalesce(p_date, current_date), 'Advance repayment ' || a.doc_no, a.doc_no, 'EMPLOYEE', a.employee_id, b.id, p_amount,
    jsonb_build_array(
      jsonb_build_object('account_id', b.gl_account_id, 'debit', p_amount, 'bank_account_id', b.id, 'description', 'Advance repaid'),
      jsonb_build_object('account_id', public.hr_account(a.company_id, 'EMPLOYEE_ADVANCE'), 'credit', p_amount, 'party_type', 'EMPLOYEE', 'party_id', a.employee_id, 'description', coalesce(nullif(trim(p_note),''), 'Repayment'))),
    'EMP_ADVANCE', a.id);
  insert into public.employee_advance_transactions(company_id, advance_id, kind, amount, txn_date, journal_entry_id, note)
  values (a.company_id, a.id, 'REPAYMENT', p_amount, coalesce(p_date, current_date), v_je, nullif(trim(p_note),''));
  update public.employee_advances set recovered_amount = recovered_amount + p_amount,
    status = case when recovered_amount + p_amount + written_off_amount >= amount then 'RECOVERED' else status end where id = p_id;
  return v_je;
end $$;

-- authorized write-off: Dr Salaries & Wages / Cr Employee Advances
create or replace function public.write_off_employee_advance(p_id uuid, p_amount numeric, p_reason text, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.employee_advances; v_je uuid; v_left numeric;
begin
  select * into a from public.employee_advances where id = p_id for update;
  if a.id is null then raise exception 'Advance not found' using errcode = 'P0002'; end if;
  perform public.inv_require(a.company_id, 'payroll.approve');
  if a.status <> 'OPEN' then raise exception 'This advance is not open' using errcode = '22023'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give the reason for the write-off' using errcode = '23502'; end if;
  v_left := a.amount - a.recovered_amount - a.written_off_amount;
  if coalesce(p_amount, 0) <= 0 or p_amount > v_left then raise exception 'Enter an amount up to the outstanding %', v_left using errcode = '23514'; end if;
  v_je := public.acc_post_document_entry(a.company_id, 'JOURNAL', coalesce(p_date, current_date), 'Advance write-off ' || a.doc_no || ': ' || trim(p_reason), a.doc_no, 'EMPLOYEE', a.employee_id, null, p_amount,
    jsonb_build_array(
      jsonb_build_object('account_id', public.hr_account(a.company_id, 'PAYROLL_EXPENSE'), 'debit', p_amount, 'description', 'Advance written off'),
      jsonb_build_object('account_id', public.hr_account(a.company_id, 'EMPLOYEE_ADVANCE'), 'credit', p_amount, 'party_type', 'EMPLOYEE', 'party_id', a.employee_id, 'description', trim(p_reason))),
    'EMP_ADVANCE', a.id);
  insert into public.employee_advance_transactions(company_id, advance_id, kind, amount, txn_date, journal_entry_id, note)
  values (a.company_id, a.id, 'WRITE_OFF', p_amount, coalesce(p_date, current_date), v_je, trim(p_reason));
  update public.employee_advances set written_off_amount = written_off_amount + p_amount,
    status = case when recovered_amount + written_off_amount + p_amount >= amount then 'WRITTEN_OFF' else status end where id = p_id;
  return v_je;
end $$;

-- ───── leave ─────
create or replace function public.save_leave_type(p_company_id uuid, p_id uuid, p_code text, p_name text, p_is_paid boolean, p_annual_days numeric, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.inv_require(p_company_id, 'payroll.manage');
  if p_id is null then
    insert into public.leave_types(company_id, code, name, is_paid, annual_days, is_active)
    values (p_company_id, upper(trim(p_code)), trim(p_name), coalesce(p_is_paid, true), coalesce(p_annual_days, 0), coalesce(p_active, true)) returning id into v_id;
  else
    update public.leave_types set code = upper(trim(p_code)), name = trim(p_name), is_paid = coalesce(p_is_paid, true),
      annual_days = coalesce(p_annual_days, 0), is_active = coalesce(p_active, true) where id = p_id and company_id = p_company_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.request_leave(p_employee_id uuid, p_leave_type_id uuid, p_from date, p_to date, p_days numeric default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_id uuid; v_days numeric;
begin
  e := public.hr_employee(p_employee_id);
  perform public.inv_require(e.company_id, 'payroll.manage');
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the leave dates' using errcode = '23502'; end if;
  if not exists (select 1 from public.leave_types where id = p_leave_type_id and company_id = e.company_id and is_active) then
    raise exception 'Choose a leave type' using errcode = '23502';
  end if;
  if exists (select 1 from public.employee_leave_requests where employee_id = p_employee_id and status in ('REQUESTED','APPROVED','APPLIED')
             and from_date <= p_to and to_date >= p_from) then
    raise exception 'These dates overlap another leave of this employee' using errcode = '23505';
  end if;
  v_days := coalesce(nullif(p_days, 0), (p_to - p_from + 1)::numeric);
  if v_days > (p_to - p_from + 1) then raise exception 'Days cannot be more than the dates cover' using errcode = '23514'; end if;
  insert into public.employee_leave_requests(company_id, employee_id, leave_type_id, from_date, to_date, days, reason)
  values (e.company_id, p_employee_id, p_leave_type_id, p_from, p_to, v_days, nullif(trim(p_reason), '')) returning id into v_id;
  return v_id;
end $$;

create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.employee_leave_requests;
begin
  select * into r from public.employee_leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Leave request not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(r.company_id, 'payroll.approve') or public.has_permission(r.company_id, 'payroll.manage')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_approve is null then  -- cancel
    if r.status = 'APPLIED' then raise exception 'This leave is already in a posted payroll' using errcode = '22023'; end if;
    update public.employee_leave_requests set status = 'CANCELLED', payroll_run_id = null, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note),'') where id = p_id;
    return;
  end if;
  if r.status <> 'REQUESTED' then raise exception 'This request is already %', lower(r.status) using errcode = '22023'; end if;
  update public.employee_leave_requests set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
end $$;

create or replace function public.leave_balances(p_company_id uuid, p_year int)
returns table(employee_id uuid, employee_name text, leave_type_id uuid, leave_type text, is_paid boolean, entitled numeric, taken numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select e.id, e.full_name, t.id, t.name, t.is_paid, t.annual_days,
    coalesce(sum(r.days) filter (where r.status in ('APPROVED','APPLIED')), 0),
    coalesce(sum(r.days) filter (where r.status = 'REQUESTED'), 0),
    t.annual_days - coalesce(sum(r.days) filter (where r.status in ('APPROVED','APPLIED')), 0)
  from public.employees e cross join public.leave_types t
  left join public.employee_leave_requests r on r.employee_id = e.id and r.leave_type_id = t.id and extract(year from r.from_date) = p_year
  where e.company_id = p_company_id and t.company_id = p_company_id and t.is_active and e.status <> 'LEFT'
    and (public.has_permission(p_company_id, 'payroll.view') or public.has_permission(p_company_id, 'employees.view'))
  group by e.id, e.full_name, t.id, t.name, t.is_paid, t.annual_days
  order by e.full_name, t.name;
$$;

-- ───── assembly labour rates ─────
create or replace function public.set_labour_rate(p_company_id uuid, p_product_id uuid, p_variant_id uuid, p_employee_id uuid, p_rate numeric, p_effective_from date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.inv_require(p_company_id, 'payroll.approve');
  if p_rate is null or p_rate < 0 then raise exception 'Enter the rate per item' using errcode = '23502'; end if;
  if p_effective_from is null then raise exception 'Choose the date the rate starts' using errcode = '23502'; end if;
  if not exists (select 1 from public.products where id = p_product_id and company_id = p_company_id) then raise exception 'Choose a product' using errcode = '23502'; end if;
  if exists (select 1 from public.assembly_labour_rates where company_id = p_company_id and product_id = p_product_id
             and variant_id is not distinct from p_variant_id and employee_id is not distinct from p_employee_id and effective_from >= p_effective_from) then
    raise exception 'A rate starting on or after this date already exists — choose a later date' using errcode = '22023';
  end if;
  update public.assembly_labour_rates set effective_to = p_effective_from - 1
   where company_id = p_company_id and product_id = p_product_id and variant_id is not distinct from p_variant_id
     and employee_id is not distinct from p_employee_id and (effective_to is null or effective_to >= p_effective_from);
  insert into public.assembly_labour_rates(company_id, product_id, variant_id, employee_id, rate, effective_from, note)
  values (p_company_id, p_product_id, p_variant_id, p_employee_id, round(p_rate, 2), p_effective_from, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

-- most specific rate wins: employee+variant, employee+product, variant, product
create or replace function public.labour_rate_for(p_product uuid, p_variant uuid, p_employee uuid, p_date date)
returns numeric language sql stable security definer set search_path = '' as $$
  select r.rate from public.assembly_labour_rates r
  where r.product_id = p_product and (r.variant_id is null or r.variant_id = p_variant) and (r.employee_id is null or r.employee_id = p_employee)
    and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)
  order by (r.employee_id is not null) desc, (r.variant_id is not null) desc, r.effective_from desc limit 1;
$$;

-- ───── assembly labour on an assembly order (quantities only — supervisors never see money) ─────
-- p_rows: [{employee_id, assigned_qty, completed_qty, rejected_qty}]
create or replace function public.save_assembly_labour(p_order_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.assembly_orders; x jsonb; v_emp uuid; v_keep uuid[] := '{}';
begin
  select * into o from public.assembly_orders where id = p_order_id;
  if o.id is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(o.company_id, 'labour.supervise');
  if o.status in ('CANCELLED','REVERSED') then raise exception 'This assembly order is %', lower(o.status) using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_emp := (x->>'employee_id')::uuid;
    if not exists (select 1 from public.employees where id = v_emp and company_id = o.company_id and status <> 'LEFT') then
      raise exception 'Choose an active employee' using errcode = '23502';
    end if;
    v_keep := v_keep || v_emp;
    insert into public.employee_assembly_assignments(company_id, assembly_order_id, employee_id, assigned_qty, completed_qty, rejected_qty)
    values (o.company_id, o.id, v_emp, coalesce(nullif(x->>'assigned_qty','')::numeric, 0), coalesce(nullif(x->>'completed_qty','')::numeric, 0), coalesce(nullif(x->>'rejected_qty','')::numeric, 0))
    on conflict (assembly_order_id, employee_id) do update set
      assigned_qty = excluded.assigned_qty, completed_qty = excluded.completed_qty, rejected_qty = excluded.rejected_qty,
      status = case when public.employee_assembly_assignments.status = 'CANCELLED' then 'ASSIGNED' else public.employee_assembly_assignments.status end
      where public.employee_assembly_assignments.status <> 'APPROVED';
  end loop;
  update public.employee_assembly_assignments set status = 'CANCELLED'
   where assembly_order_id = o.id and status = 'ASSIGNED' and not (employee_id = any(v_keep));
end $$;

-- supervisor approval: approved quantity × the labour rate in force on the assembly date → approved earning
-- p_rows: [{id, approved_qty}] ; total may exceed the order quantity only with an exception note
create or replace function public.approve_assembly_labour(p_order_id uuid, p_rows jsonb, p_exception_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare o public.assembly_orders; x jsonb; a public.employee_assembly_assignments; v_total numeric; v_rate numeric; v_item uuid; n int := 0; v_q numeric;
  pname text;
begin
  select * into o from public.assembly_orders where id = p_order_id for update;
  if o.id is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(o.company_id, 'labour.supervise');
  if o.status <> 'POSTED' then raise exception 'Post the assembly order first — labour is approved on finished work' using errcode = '22023'; end if;
  select name into pname from public.products where id = o.product_id;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into a from public.employee_assembly_assignments where id = (x->>'id')::uuid and assembly_order_id = o.id for update;
    if a.id is null or a.status <> 'ASSIGNED' then continue; end if;
    v_q := coalesce(nullif(x->>'approved_qty','')::numeric, a.completed_qty - a.rejected_qty);
    if v_q < 0 then raise exception 'Approved quantity cannot be negative' using errcode = '23514'; end if;
    update public.employee_assembly_assignments set approved_qty = v_q where id = a.id;
  end loop;
  select coalesce(sum(approved_qty), 0) into v_total from public.employee_assembly_assignments
   where assembly_order_id = o.id and (status = 'APPROVED' or (status = 'ASSIGNED' and approved_qty is not null));
  if v_total > o.quantity and nullif(trim(p_exception_note), '') is null then
    raise exception 'Approved total (%) is more than the % made on this order — reduce it or give an exception note', v_total, o.quantity using errcode = '23514';
  end if;
  for a in select * from public.employee_assembly_assignments where assembly_order_id = o.id and status = 'ASSIGNED' and approved_qty is not null for update loop
    if a.approved_qty > 0 then
      v_rate := public.labour_rate_for(o.product_id, o.variant_id, a.employee_id, o.doc_date);
      if v_rate is null then raise exception 'No labour rate for % on % — ask the owner to set one (HR → Labour rates)', pname, to_char(o.doc_date, 'DD Mon YYYY') using errcode = '22023'; end if;
      if v_rate > 0 then
        insert into public.employee_pay_items(company_id, employee_id, direction, item_type, amount, quantity, rate, item_date, period_month, description,
          source_type, source_id, status, decided_by, decided_at)
        values (o.company_id, a.employee_id, 'EARNING', 'ASSEMBLY_LABOUR', round(a.approved_qty * v_rate, 2), a.approved_qty, v_rate, o.doc_date, public.hr_month(o.doc_date),
          o.doc_no || ' · ' || pname, 'ASSEMBLY', a.id, 'APPROVED', auth.uid(), now())
        returning id into v_item;
      else v_item := null;
      end if;
    else v_item := null;
    end if;
    update public.employee_assembly_assignments set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), pay_item_id = v_item,
      exception_note = case when v_total > o.quantity then trim(p_exception_note) else exception_note end where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- undo an approval while its earning is not in an approved / posted payroll
create or replace function public.reopen_assembly_labour(p_assignment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.employee_assembly_assignments; it public.employee_pay_items;
begin
  select * into a from public.employee_assembly_assignments where id = p_assignment_id for update;
  if a.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform public.inv_require(a.company_id, 'labour.supervise');
  if a.status <> 'APPROVED' then return; end if;
  if a.pay_item_id is not null then
    select * into it from public.employee_pay_items where id = a.pay_item_id for update;
    if it.payroll_run_id is not null and exists (select 1 from public.payroll_runs where id = it.payroll_run_id and status in ('APPROVED','POSTED')) then
      raise exception 'This labour is already in an approved / posted payroll' using errcode = '22023';
    end if;
    update public.employee_pay_items set status = 'CANCELLED', payroll_run_id = null, decided_by = auth.uid(), decided_at = now(), decision_note = 'Assembly labour reopened' where id = it.id;
  end if;
  update public.employee_assembly_assignments set status = 'ASSIGNED', approved_qty = null, approved_by = null, approved_at = null, pay_item_id = null where id = a.id;
end $$;
