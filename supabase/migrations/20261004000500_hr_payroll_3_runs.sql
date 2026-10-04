-- Stage 6.5 part 3 — payroll runs: build → review → approve → post (accounting) → pay; reverse with full release

alter table public.payroll_lines add column if not exists is_active boolean not null default true;

create or replace function public.payroll_totals(p_run uuid) returns void
language sql security definer set search_path = '' as $$
  update public.payroll_runs r set
    employees_count = coalesce(t.n, 0), gross_total = coalesce(t.g, 0), deduction_total = coalesce(t.d, 0),
    recovery_total = coalesce(t.rc, 0), net_total = coalesce(t.nt, 0), paid_total = coalesce(t.p, 0), updated_at = now()
  from (select count(*)::int n, sum(gross) g, sum(other_deductions) d, sum(advance_recovery) rc, sum(net_pay) nt, sum(paid_amount) p
        from public.payroll_lines where run_id = p_run and is_active) t
  where r.id = p_run;
$$;

-- (re)calculate every employee line of a draft run from salaries, approved items, approved leave and open advances
create or replace function public.payroll_build(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; e record; m_start date; m_end date; dim int; v_sal numeric; v_from date; v_to date; v_days numeric;
  v_basic numeric; v_unpaid numeric; v_leave numeric; v_asm numeric; v_bonus numeric; v_other numeric; v_ded numeric; v_gross numeric;
  v_out numeric; v_plan numeric; v_rec numeric; v_prev record; v_items jsonb; v_leaves jsonb; v_keep uuid[] := '{}';
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.status <> 'DRAFT' then raise exception 'Only a draft payroll can be recalculated' using errcode = '22023'; end if;
  m_start := r.period_month; m_end := (r.period_month + interval '1 month - 1 day')::date; dim := extract(day from m_end)::int;

  -- release what this run had reserved; it is picked up again below if still valid
  update public.employee_pay_items set payroll_run_id = null where payroll_run_id = p_run;
  update public.employee_leave_requests set payroll_run_id = null where payroll_run_id = p_run and status = 'APPROVED';

  for e in
    select * from public.employees
    where company_id = r.company_id and payroll_eligible
      and (joining_date is null or joining_date <= m_end)
      and (status in ('ACTIVE','ON_LEAVE') or (status = 'LEFT' and left_date is not null and left_date >= m_start))
    order by full_name
  loop
    v_from := greatest(m_start, coalesce(e.joining_date, m_start));
    v_to := least(m_end, coalesce(e.left_date, m_end));
    v_days := greatest(v_to - v_from + 1, 0);
    v_sal := coalesce(public.hr_salary_on(e.id, v_to), 0);
    v_basic := round(v_sal * v_days / dim, 2);

    select coalesce(sum(least(l.days, (least(l.to_date, m_end) - greatest(l.from_date, m_start) + 1))) filter (where not t.is_paid), 0),
           coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'type', t.name, 'paid', t.is_paid, 'from', l.from_date, 'to', l.to_date,
             'days', least(l.days, (least(l.to_date, m_end) - greatest(l.from_date, m_start) + 1)))), '[]'::jsonb)
      into v_unpaid, v_leaves
      from public.employee_leave_requests l join public.leave_types t on t.id = l.leave_type_id
     where l.employee_id = e.id and l.status = 'APPROVED' and l.payroll_run_id is null and l.from_date <= m_end and l.to_date >= m_start;
    v_leave := least(round(v_sal / dim * v_unpaid, 2), v_basic);

    select coalesce(sum(amount) filter (where item_type = 'ASSEMBLY_LABOUR'), 0),
           coalesce(sum(amount) filter (where item_type = 'BONUS'), 0),
           coalesce(sum(amount) filter (where direction = 'EARNING' and item_type not in ('ASSEMBLY_LABOUR','BONUS')), 0),
           coalesce(sum(amount) filter (where direction = 'DEDUCTION'), 0),
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', item_type, 'direction', direction, 'amount', amount, 'qty', quantity, 'rate', rate,
             'date', item_date, 'description', description) order by item_date), '[]'::jsonb)
      into v_asm, v_bonus, v_other, v_ded, v_items
      from public.employee_pay_items
     where employee_id = e.id and status = 'APPROVED' and payroll_run_id is null and period_month <= r.period_month;

    select coalesce(sum(amount - recovered_amount - written_off_amount), 0), coalesce(sum(recovery_per_month), 0)
      into v_out, v_plan from public.employee_advances where employee_id = e.id and status = 'OPEN';

    v_gross := v_basic - v_leave + v_asm + v_bonus + v_other;
    if v_sal = 0 and v_gross = 0 and v_ded = 0 and v_out = 0 then continue; end if;

    select * into v_prev from public.payroll_lines where run_id = p_run and employee_id = e.id;
    if v_prev.id is not null and coalesce((v_prev.components->>'recovery_manual')::boolean, false) then
      v_rec := v_prev.advance_recovery;
    else
      v_rec := v_plan;
    end if;
    v_rec := greatest(least(v_rec, v_out, greatest(v_gross - v_ded, 0)), 0);

    insert into public.payroll_lines(company_id, run_id, employee_id, monthly_salary, days_in_month, days_worked, basic_salary, unpaid_leave_days, leave_deduction,
      assembly_labour, bonus, other_earnings, gross, other_deductions, advance_outstanding, advance_recovery, net_pay, components, is_active)
    values (r.company_id, p_run, e.id, v_sal, dim, v_days, v_basic, v_unpaid, v_leave, v_asm, v_bonus, v_other, v_gross, v_ded, v_out, v_rec,
      v_gross - v_ded - v_rec,
      jsonb_build_object('items', v_items, 'leaves', v_leaves, 'recovery_manual', coalesce((v_prev.components->>'recovery_manual')::boolean, false),
        'worked_from', v_from, 'worked_to', v_to), true)
    on conflict (run_id, employee_id) do update set monthly_salary = excluded.monthly_salary, days_in_month = excluded.days_in_month,
      days_worked = excluded.days_worked, basic_salary = excluded.basic_salary, unpaid_leave_days = excluded.unpaid_leave_days,
      leave_deduction = excluded.leave_deduction, assembly_labour = excluded.assembly_labour, bonus = excluded.bonus,
      other_earnings = excluded.other_earnings, gross = excluded.gross, other_deductions = excluded.other_deductions,
      advance_outstanding = excluded.advance_outstanding, advance_recovery = excluded.advance_recovery, net_pay = excluded.net_pay,
      components = excluded.components, is_active = true;
    v_keep := v_keep || e.id;

    update public.employee_pay_items set payroll_run_id = p_run
     where employee_id = e.id and status = 'APPROVED' and payroll_run_id is null and period_month <= r.period_month;
    update public.employee_leave_requests set payroll_run_id = p_run
     where employee_id = e.id and status = 'APPROVED' and payroll_run_id is null and from_date <= m_end and to_date >= m_start;
  end loop;

  update public.payroll_lines set is_active = false where run_id = p_run and not (employee_id = any(v_keep));
  update public.payroll_runs set calculated_at = now() where id = p_run;
  perform public.payroll_totals(p_run);
end $$;

create or replace function public.create_payroll_run(p_company_id uuid, p_month date, p_posting_date date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_m date := public.hr_month(p_month); v_doc text;
begin
  perform public.inv_require(p_company_id, 'payroll.manage');
  if exists (select 1 from public.payroll_runs where company_id = p_company_id and period_month = v_m and status in ('DRAFT','APPROVED','POSTED')) then
    select doc_no into v_doc from public.payroll_runs where company_id = p_company_id and period_month = v_m and status in ('DRAFT','APPROVED','POSTED') limit 1;
    raise exception 'Payroll for % already exists (%)', to_char(v_m, 'Mon YYYY'), v_doc using errcode = '23505';
  end if;
  insert into public.payroll_runs(company_id, doc_no, period_month, posting_date, notes)
  values (p_company_id, public.next_document_number(p_company_id, 'PAYROLL'), v_m,
    coalesce(p_posting_date, (v_m + interval '1 month - 1 day')::date), nullif(trim(p_notes), ''))
  returning id into v_id;
  perform public.payroll_build(v_id);
  return v_id;
end $$;

create or replace function public.recalc_payroll_run(p_run_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run_id;
  if r.id is null then raise exception 'Payroll not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'payroll.manage');
  perform public.payroll_build(p_run_id);
end $$;

-- review edits on a draft: advance recovery amount and a note
create or replace function public.set_payroll_line(p_line_id uuid, p_advance_recovery numeric, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.payroll_lines; r public.payroll_runs; v numeric;
begin
  select * into l from public.payroll_lines where id = p_line_id for update;
  select * into r from public.payroll_runs where id = l.run_id;
  perform public.inv_require(r.company_id, 'payroll.manage');
  if r.status <> 'DRAFT' then raise exception 'Only a draft payroll can be changed' using errcode = '22023'; end if;
  v := round(coalesce(p_advance_recovery, 0), 2);
  if v < 0 then raise exception 'Recovery cannot be negative' using errcode = '23514'; end if;
  if v > l.advance_outstanding then raise exception 'Recovery cannot be more than the outstanding advance (%)', l.advance_outstanding using errcode = '23514'; end if;
  if v > greatest(l.gross - l.other_deductions, 0) then raise exception 'Recovery cannot be more than the pay (%)', greatest(l.gross - l.other_deductions, 0) using errcode = '23514'; end if;
  update public.payroll_lines set advance_recovery = v, net_pay = gross - other_deductions - v, note = nullif(trim(p_note), ''),
    components = components || jsonb_build_object('recovery_manual', true) where id = p_line_id;
  perform public.payroll_totals(l.run_id);
end $$;

create or replace function public.approve_payroll_run(p_run_id uuid, p_approve boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; v_bad text;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if r.id is null then raise exception 'Payroll not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'payroll.approve');
  if p_approve then
    if r.status <> 'DRAFT' then raise exception 'Only a draft payroll can be approved' using errcode = '22023'; end if;
    select string_agg(e.full_name, ', ') into v_bad from public.payroll_lines l join public.employees e on e.id = l.employee_id
     where l.run_id = p_run_id and l.is_active and l.net_pay < 0;
    if v_bad is not null then raise exception 'Net pay is below zero for %: reduce their deductions first', v_bad using errcode = '23514'; end if;
    if r.employees_count = 0 then raise exception 'This payroll has no employees' using errcode = '22023'; end if;
    update public.payroll_runs set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_run_id;
  else
    if r.status <> 'APPROVED' then raise exception 'Only an approved payroll can be sent back to draft' using errcode = '22023'; end if;
    update public.payroll_runs set status = 'DRAFT', approved_by = null, approved_at = null, updated_at = now() where id = p_run_id;
  end if;
end $$;

-- Dr Salaries & Wages / Dr Assembly Labour  ·  Cr Salaries (deductions) / Cr Employee Payable (net, per employee) / Cr Employee Advances (recovery, per employee)
create or replace function public.post_payroll_run(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; l record; v_lines jsonb := '[]'::jsonb; v_sal numeric; v_asm numeric; v_ded numeric; v_je uuid;
  a record; v_left numeric; v_take numeric; v_label text;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if r.id is null then raise exception 'Payroll not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(r.company_id, 'payroll.manage') or public.has_permission(r.company_id, 'payroll.approve')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if r.status <> 'APPROVED' then raise exception 'Approve the payroll before posting' using errcode = '22023'; end if;
  v_label := 'Payroll ' || to_char(r.period_month, 'Mon YYYY');

  -- advances may have changed since the run was built
  for l in select pl.*, e.full_name from public.payroll_lines pl join public.employees e on e.id = pl.employee_id
           where pl.run_id = p_run_id and pl.is_active and pl.advance_recovery > 0 loop
    if l.advance_recovery > (select coalesce(sum(amount - recovered_amount - written_off_amount), 0) from public.employee_advances where employee_id = l.employee_id and status = 'OPEN') then
      raise exception '%''s advance balance changed — send the payroll back to draft and recalculate', l.full_name using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(basic_salary - leave_deduction + bonus + other_earnings), 0), coalesce(sum(assembly_labour), 0), coalesce(sum(other_deductions), 0)
    into v_sal, v_asm, v_ded from public.payroll_lines where run_id = p_run_id and is_active;
  if v_sal > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(r.company_id, 'PAYROLL_EXPENSE'), 'debit', v_sal, 'description', v_label || ' — salaries, bonuses & allowances')); end if;
  if v_asm > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(r.company_id, 'ASSEMBLY_LABOUR'), 'debit', v_asm, 'description', v_label || ' — assembly labour')); end if;
  if v_ded > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(r.company_id, 'PAYROLL_EXPENSE'), 'credit', v_ded, 'description', v_label || ' — deductions')); end if;
  for l in select pl.*, e.full_name from public.payroll_lines pl join public.employees e on e.id = pl.employee_id where pl.run_id = p_run_id and pl.is_active order by e.full_name loop
    if l.net_pay > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(r.company_id, 'EMPLOYEE_PAYABLE'), 'credit', l.net_pay,
        'party_type', 'EMPLOYEE', 'party_id', l.employee_id, 'description', v_label || ' — net pay'));
    end if;
    if l.advance_recovery > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(r.company_id, 'EMPLOYEE_ADVANCE'), 'credit', l.advance_recovery,
        'party_type', 'EMPLOYEE', 'party_id', l.employee_id, 'description', v_label || ' — advance recovered'));
    end if;
  end loop;

  v_je := public.acc_post_document_entry(r.company_id, 'SYSTEM', r.posting_date, v_label || ' (' || r.doc_no || ')', r.doc_no, null, null, null, r.gross_total,
    v_lines, 'PAYROLL', r.id);

  -- advance recoveries, oldest advance first
  for l in select * from public.payroll_lines where run_id = p_run_id and is_active and advance_recovery > 0 loop
    v_left := l.advance_recovery;
    for a in select * from public.employee_advances where employee_id = l.employee_id and status = 'OPEN' order by advance_date, created_at for update loop
      exit when v_left <= 0;
      v_take := least(v_left, a.amount - a.recovered_amount - a.written_off_amount);
      if v_take <= 0 then continue; end if;
      insert into public.employee_advance_transactions(company_id, advance_id, kind, amount, txn_date, payroll_run_id, journal_entry_id, note)
      values (r.company_id, a.id, 'PAYROLL_RECOVERY', v_take, r.posting_date, r.id, v_je, r.doc_no);
      update public.employee_advances set recovered_amount = recovered_amount + v_take,
        status = case when recovered_amount + v_take + written_off_amount >= amount then 'RECOVERED' else status end where id = a.id;
      v_left := v_left - v_take;
    end loop;
  end loop;

  update public.employee_leave_requests set status = 'APPLIED' where payroll_run_id = p_run_id and status = 'APPROVED';
  update public.payroll_runs set status = 'POSTED', journal_entry_id = v_je, posted_by = auth.uid(), posted_at = now(), updated_at = now() where id = p_run_id;
  return v_je;
end $$;

-- pay net salaries from a bank / cash account: Dr Employee Payable (per employee) / Cr Bank
-- p_lines: [{line_id, amount}] — leave empty to pay everyone what is still unpaid
create or replace function public.pay_payroll_run(p_run_id uuid, p_bank_account_id uuid, p_date date default null, p_lines jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; b record; l record; v_amt numeric; v_total numeric := 0; v_jl jsonb := '[]'::jsonb; v_done jsonb := '[]'::jsonb; v_je uuid; x jsonb;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if r.id is null then raise exception 'Payroll not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'payroll.manage');
  if r.status <> 'POSTED' then raise exception 'Post the payroll before paying it' using errcode = '22023'; end if;
  select * into b from public.bank_accounts where id = p_bank_account_id and company_id = r.company_id and is_active;
  if b.id is null then raise exception 'Choose the bank / cash account' using errcode = '23502'; end if;
  for l in select pl.*, e.full_name from public.payroll_lines pl join public.employees e on e.id = pl.employee_id
           where pl.run_id = p_run_id and pl.is_active and pl.net_pay > pl.paid_amount order by e.full_name for update of pl loop
    if p_lines is null or jsonb_array_length(p_lines) = 0 then
      v_amt := l.net_pay - l.paid_amount;
    else
      select x2 into x from jsonb_array_elements(p_lines) x2 where (x2->>'line_id')::uuid = l.id;
      if x is null then continue; end if;
      v_amt := round(coalesce(nullif(x->>'amount','')::numeric, l.net_pay - l.paid_amount), 2);
    end if;
    if v_amt <= 0 then continue; end if;
    if v_amt > l.net_pay - l.paid_amount then raise exception '% is owed only % on this payroll', l.full_name, l.net_pay - l.paid_amount using errcode = '23514'; end if;
    v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', public.hr_account(r.company_id, 'EMPLOYEE_PAYABLE'), 'debit', v_amt,
      'party_type', 'EMPLOYEE', 'party_id', l.employee_id, 'description', 'Salary ' || to_char(r.period_month, 'Mon YYYY')));
    v_done := v_done || jsonb_build_array(jsonb_build_object('line_id', l.id, 'employee_id', l.employee_id, 'amount', v_amt));
    v_total := v_total + v_amt;
    update public.payroll_lines set paid_amount = paid_amount + v_amt where id = l.id;
  end loop;
  if v_total <= 0 then raise exception 'Nothing left to pay on this payroll' using errcode = '22023'; end if;
  v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', b.gl_account_id, 'credit', v_total, 'bank_account_id', b.id, 'description', 'Salaries paid ' || r.doc_no));
  v_je := public.acc_post_document_entry(r.company_id, 'PAYMENT', coalesce(p_date, current_date), 'Salaries ' || to_char(r.period_month, 'Mon YYYY') || ' (' || r.doc_no || ')',
    r.doc_no, null, null, b.id, v_total, v_jl, 'PAYROLL_PAYMENT', r.id);
  insert into public.payroll_payments(company_id, run_id, payment_date, bank_account_id, amount, lines, journal_entry_id)
  values (r.company_id, r.id, coalesce(p_date, current_date), b.id, v_total, v_done, v_je);
  perform public.payroll_totals(p_run_id);
  return v_je;
end $$;

create or replace function public.reverse_payroll_run(p_run_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; t record;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if r.id is null then raise exception 'Payroll not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'payroll.approve');
  if r.status <> 'POSTED' then raise exception 'Only a posted payroll can be reversed' using errcode = '22023'; end if;
  if r.paid_total > 0 then raise exception 'Salaries were already paid from this payroll — reverse those payment vouchers first' using errcode = '22023'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  perform public.acc_reverse_document_entry(r.journal_entry_id, trim(p_reason), coalesce(p_date, current_date));
  for t in select * from public.employee_advance_transactions where payroll_run_id = p_run_id and kind = 'PAYROLL_RECOVERY' and not reversed for update loop
    update public.employee_advance_transactions set reversed = true where id = t.id;
    update public.employee_advances set recovered_amount = recovered_amount - t.amount, status = 'OPEN' where id = t.advance_id;
  end loop;
  update public.employee_pay_items set payroll_run_id = null where payroll_run_id = p_run_id;
  update public.employee_leave_requests set status = 'APPROVED', payroll_run_id = null where payroll_run_id = p_run_id and status = 'APPLIED';
  update public.payroll_runs set status = 'REVERSED', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = trim(p_reason), updated_at = now() where id = p_run_id;
end $$;

create or replace function public.cancel_payroll_run(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if r.id is null then raise exception 'Payroll not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'payroll.manage');
  if r.status not in ('DRAFT','APPROVED') then raise exception 'Only a draft or approved payroll can be cancelled' using errcode = '22023'; end if;
  update public.employee_pay_items set payroll_run_id = null where payroll_run_id = p_run_id;
  update public.employee_leave_requests set payroll_run_id = null where payroll_run_id = p_run_id and status = 'APPROVED';
  update public.payroll_runs set status = 'CANCELLED', updated_at = now() where id = p_run_id;
end $$;

revoke all on function public.payroll_build(uuid), public.payroll_totals(uuid) from public, anon, authenticated;
revoke all on function public.create_payroll_run(uuid,date,date,text), public.recalc_payroll_run(uuid), public.set_payroll_line(uuid,numeric,text),
  public.approve_payroll_run(uuid,boolean), public.post_payroll_run(uuid), public.pay_payroll_run(uuid,uuid,date,jsonb),
  public.reverse_payroll_run(uuid,text,date), public.cancel_payroll_run(uuid),
  public.set_employee_salary(uuid,numeric,date,text), public.hr_overview(uuid), public.set_employee_payment_details(uuid,jsonb),
  public.add_pay_item(uuid,text,text,numeric,date,date,text), public.decide_pay_items(uuid[],boolean,text), public.cancel_pay_item(uuid,text),
  public.request_employee_advance(uuid,numeric,date,text,numeric,uuid), public.approve_employee_advance(uuid,uuid,date),
  public.reject_employee_advance(uuid,text), public.repay_employee_advance(uuid,numeric,uuid,date,text), public.write_off_employee_advance(uuid,numeric,text,date),
  public.save_leave_type(uuid,uuid,text,text,boolean,numeric,boolean), public.request_leave(uuid,uuid,date,date,numeric,text), public.decide_leave(uuid,boolean,text),
  public.leave_balances(uuid,int), public.set_labour_rate(uuid,uuid,uuid,uuid,numeric,date,text), public.labour_rate_for(uuid,uuid,uuid,date),
  public.save_assembly_labour(uuid,jsonb), public.approve_assembly_labour(uuid,jsonb,text), public.reopen_assembly_labour(uuid),
  public.hr_salary_on(uuid,date), public.hr_account(uuid,text), public.hr_employee(uuid) from anon;
revoke all on function public.labour_rate_for(uuid,uuid,uuid,date), public.hr_salary_on(uuid,date) from public, authenticated;

-- part 4: new employee columns readable like the other non-restricted ones
grant select (left_date, payroll_eligible) on public.employees to authenticated;
