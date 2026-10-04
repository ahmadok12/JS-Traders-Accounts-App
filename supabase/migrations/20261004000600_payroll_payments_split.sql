-- Salary payments: one voucher per employee (individual bank transfers) or one voucher for a group (bank / cash),
-- partial amounts, a reference per transfer, and reversing a payment releases it again.

alter table public.payroll_payments add column if not exists employee_id uuid references public.employees(id);
alter table public.payroll_payments add column if not exists reference text;
alter table public.payroll_payments add column if not exists status text not null default 'POSTED' check (status in ('POSTED','REVERSED'));
alter table public.payroll_payments add column if not exists reversed_at timestamptz;
alter table public.payroll_payments add column if not exists reversed_by uuid;
alter table public.payroll_payments add column if not exists reversal_reason text;

-- p_lines: [{line_id, amount?, reference?}] (empty = everyone still unpaid, full amount)
-- p_separate = true  → one payment voucher per employee (party = employee; its own reference)
-- p_separate = false → one voucher for all of them (lines per employee inside)
create or replace function public.pay_payroll_salaries(p_run_id uuid, p_bank_account_id uuid, p_date date default null,
  p_lines jsonb default null, p_separate boolean default false, p_reference text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; b record; l record; x jsonb; v_amt numeric; v_ref text; v_date date := coalesce(p_date, current_date);
  v_pay_acc uuid; v_month text; v_total numeric := 0; v_jl jsonb := '[]'::jsonb; v_done jsonb := '[]'::jsonb; v_je uuid; n int := 0;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if r.id is null then raise exception 'Payroll not found' using errcode = 'P0002'; end if;
  perform public.inv_require(r.company_id, 'payroll.manage');
  if r.status <> 'POSTED' then raise exception 'Post the payroll before paying it' using errcode = '22023'; end if;
  select * into b from public.bank_accounts where id = p_bank_account_id and company_id = r.company_id and is_active;
  if b.id is null then raise exception 'Choose the bank / cash account the salaries are paid from' using errcode = '23502'; end if;
  v_pay_acc := public.hr_account(r.company_id, 'EMPLOYEE_PAYABLE');
  v_month := to_char(r.period_month, 'Mon YYYY');

  for l in select pl.*, e.full_name from public.payroll_lines pl join public.employees e on e.id = pl.employee_id
           where pl.run_id = p_run_id and pl.is_active and pl.net_pay > pl.paid_amount order by e.full_name for update of pl loop
    x := null;
    if p_lines is not null and jsonb_array_length(p_lines) > 0 then
      select y into x from jsonb_array_elements(p_lines) y where (y->>'line_id')::uuid = l.id;
      if x is null then continue; end if;
    end if;
    v_amt := round(coalesce(nullif(x->>'amount','')::numeric, l.net_pay - l.paid_amount), 2);
    if v_amt <= 0 then continue; end if;
    if v_amt > l.net_pay - l.paid_amount then raise exception '% is owed only % on this payroll', l.full_name, l.net_pay - l.paid_amount using errcode = '23514'; end if;
    v_ref := coalesce(nullif(trim(x->>'reference'), ''), nullif(trim(p_reference), ''));
    update public.payroll_lines set paid_amount = paid_amount + v_amt where id = l.id;

    if p_separate then
      v_je := public.acc_post_document_entry(r.company_id, 'PAYMENT', v_date, 'Salary ' || v_month || ' — ' || l.full_name || ' (' || r.doc_no || ')',
        coalesce(v_ref, r.doc_no), 'EMPLOYEE', l.employee_id, b.id, v_amt,
        jsonb_build_array(
          jsonb_build_object('account_id', v_pay_acc, 'debit', v_amt, 'party_type', 'EMPLOYEE', 'party_id', l.employee_id, 'description', 'Salary ' || v_month),
          jsonb_build_object('account_id', b.gl_account_id, 'credit', v_amt, 'bank_account_id', b.id, 'description', 'Salary ' || v_month || ' — ' || l.full_name || coalesce(' · ' || v_ref, ''))),
        'PAYROLL_PAYMENT', r.id);
      insert into public.payroll_payments(company_id, run_id, payment_date, bank_account_id, amount, lines, journal_entry_id, employee_id, reference)
      values (r.company_id, r.id, v_date, b.id, v_amt, jsonb_build_array(jsonb_build_object('line_id', l.id, 'employee_id', l.employee_id, 'amount', v_amt)), v_je, l.employee_id, v_ref);
      n := n + 1;
    else
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', v_pay_acc, 'debit', v_amt, 'party_type', 'EMPLOYEE', 'party_id', l.employee_id,
        'description', 'Salary ' || v_month || coalesce(' · ' || nullif(trim(x->>'reference'), ''), '')));
      v_done := v_done || jsonb_build_array(jsonb_build_object('line_id', l.id, 'employee_id', l.employee_id, 'amount', v_amt));
      v_total := v_total + v_amt;
    end if;
  end loop;

  if not p_separate then
    if v_total <= 0 then raise exception 'Nothing left to pay for the chosen employees' using errcode = '22023'; end if;
    v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', b.gl_account_id, 'credit', v_total, 'bank_account_id', b.id,
      'description', 'Salaries ' || v_month || ' (' || jsonb_array_length(v_done) || ' employees)'));
    v_je := public.acc_post_document_entry(r.company_id, 'PAYMENT', v_date, 'Salaries ' || v_month || ' (' || r.doc_no || ')',
      coalesce(nullif(trim(p_reference), ''), r.doc_no), null, null, b.id, v_total, v_jl, 'PAYROLL_PAYMENT', r.id);
    insert into public.payroll_payments(company_id, run_id, payment_date, bank_account_id, amount, lines, journal_entry_id, reference)
    values (r.company_id, r.id, v_date, b.id, v_total, v_done, v_je, nullif(trim(p_reference), ''));
    n := 1;
  elsif n = 0 then
    raise exception 'Nothing left to pay for the chosen employees' using errcode = '22023';
  end if;
  perform public.payroll_totals(p_run_id);
  return n;
end $$;

-- undo a salary payment (wrong amount / bounced transfer): reverses its voucher and makes the salary due again
create or replace function public.reverse_salary_payment(p_payment_id uuid, p_reason text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.payroll_payments; x jsonb;
begin
  select * into p from public.payroll_payments where id = p_payment_id for update;
  if p.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  perform public.inv_require(p.company_id, 'payroll.manage');
  if p.status <> 'POSTED' then raise exception 'This payment is already reversed' using errcode = '22023'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give the reason' using errcode = '23502'; end if;
  perform public.acc_reverse_document_entry(p.journal_entry_id, trim(p_reason), coalesce(p_date, current_date));
  for x in select * from jsonb_array_elements(p.lines) loop
    update public.payroll_lines set paid_amount = greatest(paid_amount - (x->>'amount')::numeric, 0) where id = (x->>'line_id')::uuid;
  end loop;
  update public.payroll_payments set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason) where id = p_payment_id;
  perform public.payroll_totals(p.run_id);
end $$;

-- the older single-voucher function stays callable only through the new one
revoke execute on function public.pay_payroll_run(uuid,uuid,date,jsonb) from public, anon, authenticated;
revoke all on function public.pay_payroll_salaries(uuid,uuid,date,jsonb,boolean,text), public.reverse_salary_payment(uuid,text,date) from anon;
