-- RLS / security smoke tests. Run in the SQL editor; every block rolls back.

-- 1. Admin can create a customer; code is auto-numbered; audit row written.
begin;
select set_config('request.jwt.claims', json_build_object('sub',(select user_id from public.user_roles limit 1),'role','authenticated')::text, true);
set local role authenticated;
-- RETURNING matters: the app always asks for the new id back (regression for the 30-Sep bug)
insert into public.customers(company_id, name) select id, 'RLS test farm' from public.companies where code = 'JST' returning id;
select code like 'C-%' as auto_code_ok,
       (select count(*) from public.audit_logs where entity_type = 'customers') > 0 as audit_ok
from public.customers where name = 'RLS test farm';
rollback;

-- 2. A signed-in user with no role sees nothing.
begin;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
set local role authenticated;
select (select count(*) from public.companies) = 0 as companies_hidden,
       (select count(*) from public.chart_of_accounts) = 0 as coa_hidden,
       (select count(*) from public.audit_logs) = 0 as audit_hidden;
rollback;

-- 3. Restricted column is not selectable directly (expect: permission denied).
-- begin; set local role authenticated; select credit_limit from public.customers; rollback;

-- 4. Non-member insert is rejected (expect: new row violates row-level security policy).
-- begin;
-- select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
-- set local role authenticated;
-- insert into public.customers(company_id, name, code) values ((select id from public.companies limit 1), 'x', 'X1');
-- rollback;
