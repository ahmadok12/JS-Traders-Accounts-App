-- Stage 6.5 — Employees, HR, payroll, advances, leave and assembly labour (part 1: tables)

insert into public.permissions(code, module, description, is_sensitive) values
  ('payroll.view',     'hr', 'See salaries, payroll, advances, bonuses and employee payables', true),
  ('payroll.manage',   'hr', 'Prepare payroll, earnings/deductions, advances and leave', true),
  ('payroll.approve',  'hr', 'Approve salaries, labour rates, bonuses, advances and payroll', true),
  ('labour.supervise', 'hr', 'Assign assembly work and approve completed quantities (no amounts)', false)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, x.p from public.roles r
join (values ('ADMINISTRATOR','payroll.view'), ('ADMINISTRATOR','payroll.manage'), ('ADMINISTRATOR','payroll.approve'), ('ADMINISTRATOR','labour.supervise'),
             ('OWNER','payroll.view'), ('OWNER','payroll.approve'),
             ('ACCOUNTANT','payroll.view'), ('ACCOUNTANT','payroll.manage'),
             ('WAREHOUSE_MANAGER','labour.supervise')) x(role, p) on x.role = r.code
on conflict do nothing;

alter table public.employees add column if not exists payroll_eligible boolean not null default true;
alter table public.employees add column if not exists left_date date;

-- restricted: how the employee is paid
create table if not exists public.employee_payment_details (
  employee_id uuid primary key references public.employees(id),
  company_id uuid not null references public.companies(id),
  payment_method text not null default 'CASH' check (payment_method in ('CASH','BANK')),
  bank_name text, account_title text, account_number text, iban text,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
alter table public.employee_payment_details enable row level security;
create policy epd_select on public.employee_payment_details for select to authenticated
  using (public.has_permission(company_id, 'employees.view_restricted') or public.has_permission(company_id, 'payroll.manage'));

-- effective-dated monthly salary
create table if not exists public.employee_salary_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  monthly_salary numeric not null check (monthly_salary >= 0),
  currency text not null default 'PKR',
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists esa_emp on public.employee_salary_assignments(employee_id, effective_from desc);
alter table public.employee_salary_assignments enable row level security;
create policy esa_select on public.employee_salary_assignments for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

-- earnings and deductions (bonus, overtime, other, assembly labour, fines …)
create table if not exists public.employee_pay_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  direction text not null check (direction in ('EARNING','DEDUCTION')),
  item_type text not null check (item_type in ('BONUS','OVERTIME','ALLOWANCE','OTHER_EARNING','ASSEMBLY_LABOUR','FINE','OTHER_DEDUCTION')),
  amount numeric not null check (amount > 0),
  quantity numeric, rate numeric,
  item_date date not null,
  period_month date not null check (extract(day from period_month) = 1),
  description text,
  source_type text, source_id uuid,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  payroll_run_id uuid,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index if not exists epi_emp on public.employee_pay_items(employee_id, period_month);
create index if not exists epi_run on public.employee_pay_items(payroll_run_id);
create unique index if not exists epi_source on public.employee_pay_items(source_type, source_id) where source_id is not null and status in ('PENDING','APPROVED');
alter table public.employee_pay_items enable row level security;
create policy epi_select on public.employee_pay_items for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

-- advances (an employee receivable, not an expense)
create table if not exists public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  employee_id uuid not null references public.employees(id),
  advance_date date not null,
  amount numeric not null check (amount > 0),
  currency text not null default 'PKR',
  reason text,
  recovery_per_month numeric check (recovery_per_month is null or recovery_per_month > 0),
  bank_account_id uuid references public.bank_accounts(id),
  status text not null default 'REQUESTED' check (status in ('REQUESTED','OPEN','RECOVERED','WRITTEN_OFF','REJECTED')),
  recovered_amount numeric not null default 0,
  written_off_amount numeric not null default 0,
  journal_entry_id uuid references public.journal_entries(id),
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  check (recovered_amount + written_off_amount <= amount)
);
create index if not exists eadv_emp on public.employee_advances(employee_id, status);
alter table public.employee_advances enable row level security;
create policy eadv_select on public.employee_advances for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

create table if not exists public.employee_advance_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  advance_id uuid not null references public.employee_advances(id),
  kind text not null check (kind in ('GRANT','PAYROLL_RECOVERY','REPAYMENT','WRITE_OFF')),
  amount numeric not null check (amount > 0),
  txn_date date not null,
  payroll_run_id uuid,
  journal_entry_id uuid references public.journal_entries(id),
  reversed boolean not null default false,
  note text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index if not exists eat_adv on public.employee_advance_transactions(advance_id);
alter table public.employee_advance_transactions enable row level security;
create policy eat_select on public.employee_advance_transactions for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

-- leave
create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  is_paid boolean not null default true,
  annual_days numeric not null default 0 check (annual_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (company_id, code)
);
alter table public.leave_types enable row level security;
create policy lt_select on public.leave_types for select to authenticated
  using (public.has_permission(company_id, 'payroll.view') or public.has_permission(company_id, 'employees.view'));

create table if not exists public.employee_leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  leave_type_id uuid not null references public.leave_types(id),
  from_date date not null, to_date date not null,
  days numeric not null check (days > 0),
  reason text,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','REJECTED','APPLIED','CANCELLED')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  payroll_run_id uuid,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  check (to_date >= from_date)
);
create index if not exists elr_emp on public.employee_leave_requests(employee_id, from_date);
alter table public.employee_leave_requests enable row level security;
create policy elr_select on public.employee_leave_requests for select to authenticated
  using (public.has_permission(company_id, 'payroll.view') or public.has_permission(company_id, 'employees.view'));

-- assembly labour
create table if not exists public.assembly_labour_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  employee_id uuid references public.employees(id),
  rate numeric not null check (rate >= 0),
  currency text not null default 'PKR',
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists alr_product on public.assembly_labour_rates(product_id, variant_id, employee_id, effective_from desc);
alter table public.assembly_labour_rates enable row level security;
create policy alr_select on public.assembly_labour_rates for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

create table if not exists public.employee_assembly_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  assembly_order_id uuid not null references public.assembly_orders(id),
  employee_id uuid not null references public.employees(id),
  assigned_qty numeric not null default 0 check (assigned_qty >= 0),
  completed_qty numeric not null default 0 check (completed_qty >= 0),
  rejected_qty numeric not null default 0 check (rejected_qty >= 0),
  approved_qty numeric check (approved_qty is null or approved_qty >= 0),
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED','APPROVED','CANCELLED')),
  exception_note text,
  approved_by uuid, approved_at timestamptz,
  pay_item_id uuid references public.employee_pay_items(id),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (assembly_order_id, employee_id)
);
alter table public.employee_assembly_assignments enable row level security;
create policy eaa_select on public.employee_assembly_assignments for select to authenticated
  using (public.has_permission(company_id, 'labour.supervise') or public.has_permission(company_id, 'payroll.view') or public.has_permission(company_id, 'inventory.view'));

-- payroll
create table if not exists public.payroll_settings (
  company_id uuid primary key references public.companies(id),
  labour_treatment text not null default 'EXPENSE' check (labour_treatment in ('EXPENSE')),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
alter table public.payroll_settings enable row level security;
create policy ps_select on public.payroll_settings for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_no text not null,
  period_month date not null check (extract(day from period_month) = 1),
  posting_date date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','POSTED','REVERSED','CANCELLED')),
  employees_count int not null default 0,
  gross_total numeric not null default 0,
  deduction_total numeric not null default 0,
  recovery_total numeric not null default 0,
  net_total numeric not null default 0,
  paid_total numeric not null default 0,
  notes text,
  journal_entry_id uuid references public.journal_entries(id),
  calculated_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  posted_by uuid, posted_at timestamptz,
  reversed_by uuid, reversed_at timestamptz, reversal_reason text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pr_month on public.payroll_runs(company_id, period_month) where status in ('DRAFT','APPROVED','POSTED');
alter table public.payroll_runs enable row level security;
create policy pr_select on public.payroll_runs for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  run_id uuid not null references public.payroll_runs(id),
  employee_id uuid not null references public.employees(id),
  monthly_salary numeric not null default 0,
  days_in_month int not null,
  days_worked numeric not null,
  basic_salary numeric not null default 0,
  unpaid_leave_days numeric not null default 0,
  leave_deduction numeric not null default 0,
  assembly_labour numeric not null default 0,
  bonus numeric not null default 0,
  other_earnings numeric not null default 0,
  gross numeric not null default 0,
  other_deductions numeric not null default 0,
  advance_outstanding numeric not null default 0,
  advance_recovery numeric not null default 0,
  net_pay numeric not null default 0,
  paid_amount numeric not null default 0,
  components jsonb not null default '{}'::jsonb,
  note text,
  unique (run_id, employee_id)
);
alter table public.payroll_lines enable row level security;
create policy pl_select on public.payroll_lines for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  run_id uuid not null references public.payroll_runs(id),
  payment_date date not null,
  bank_account_id uuid not null references public.bank_accounts(id),
  amount numeric not null check (amount > 0),
  lines jsonb not null,
  journal_entry_id uuid not null references public.journal_entries(id),
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
alter table public.payroll_payments enable row level security;
create policy pp_select on public.payroll_payments for select to authenticated using (public.has_permission(company_id, 'payroll.view'));

insert into public.numbering_sequences(company_id, doc_type, prefix)
select c.id, x.t, x.p from public.companies c cross join (values ('PAYROLL','PAY-'), ('EMP_ADVANCE','ADV-')) x(t, p)
where not exists (select 1 from public.numbering_sequences s where s.company_id = c.id and s.doc_type = x.t);

insert into public.leave_types(company_id, code, name, is_paid, annual_days)
select c.id, x.code, x.name, x.paid, x.days from public.companies c
cross join (values ('ANNUAL','Annual leave', true, 14), ('CASUAL','Casual leave', true, 10), ('SICK','Sick leave', true, 8), ('UNPAID','Unpaid leave', false, 0)) x(code, name, paid, days)
on conflict (company_id, code) do nothing;

insert into public.payroll_settings(company_id) select id from public.companies on conflict do nothing;
