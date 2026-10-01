-- =====================================================================
-- JS Traders ERP — Reference data, roles/permissions, auto-codes
-- =====================================================================

insert into public.currencies(code, name, symbol, decimals) values
  ('PKR','Pakistani Rupee','Rs',2),
  ('USD','US Dollar','$',2),
  ('CNY','Chinese Yuan (RMB)','¥',2),
  ('AED','UAE Dirham','AED',2),
  ('SAR','Saudi Riyal','SAR',2),
  ('EUR','Euro','€',2)
on conflict do nothing;

insert into public.companies(code, name, legal_name, base_currency, address)
values ('JST','JS Traders','JS Traders','PKR','Okara, Punjab, Pakistan')
on conflict (code) do nothing;

insert into public.branches(company_id, code, name, address)
select id, 'HQ', 'Okara Head Office', 'Okara, Punjab' from public.companies where code = 'JST'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions(code, module, description, is_sensitive) values
  ('settings.manage','settings','Manage company settings, branches, numbering',true),
  ('security.manage','security','Manage users, roles and access scopes',true),
  ('users.view','security','View users and their roles',false),
  ('audit.view','audit','View audit history',true),
  ('customers.view','customers','View all customers',false),
  ('customers.view_assigned','customers','View only assigned customers',false),
  ('customers.manage','customers','Create/edit customers and groups',false),
  ('customers.view_financial','customers','View customer credit limits and ID numbers',true),
  ('suppliers.view','suppliers','View suppliers',false),
  ('suppliers.manage','suppliers','Create/edit suppliers',false),
  ('suppliers.view_financial','suppliers','View supplier bank details',true),
  ('products.view','products','View products, variants, units, categories',false),
  ('products.manage','products','Create/edit products and variants',false),
  ('warehouses.view','warehouses','View warehouses (scoped)',false),
  ('warehouses.all','warehouses','Access every warehouse in the company',false),
  ('warehouses.manage','warehouses','Create/edit warehouses and locations',false),
  ('accounts.view','accounting','View chart of accounts',true),
  ('accounts.manage','accounting','Manage chart of accounts',true),
  ('banks.view','banking','View bank/cash accounts',true),
  ('banks.manage','banking','Manage bank/cash accounts',true),
  ('payment_agents.view','payment_agents','View payment agents',true),
  ('payment_agents.manage','payment_agents','Manage payment agents',true),
  ('employees.view','employees','View employees',false),
  ('employees.manage','employees','Create/edit employees',false),
  ('employees.view_restricted','employees','View employee ID/restricted HR data',true),
  ('attachments.view','attachments','View attachments of permitted records',false),
  ('attachments.manage','attachments','Upload/archive attachments',false)
on conflict (code) do update set description = excluded.description, module = excluded.module,
  is_sensitive = excluded.is_sensitive;

insert into public.roles(code, name, description, is_system) values
  ('ADMINISTRATOR','Administrator','Full system access including security configuration',true),
  ('OWNER','Owner','Management read access across the business',true),
  ('ACCOUNTANT','Accountant','Customers, suppliers, accounting, banking and payments',true),
  ('WAREHOUSE_MANAGER','Warehouse Manager','Operational inventory — no financial data',true),
  ('WAREHOUSE_STAFF','Warehouse Staff','Assigned warehouse tasks only',true),
  ('SALESPERSON','Salesperson','Assigned customers only',true)
on conflict (code) do nothing;

-- Administrator: everything
insert into public.role_permissions(role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.code = 'ADMINISTRATOR'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, x.perm
from public.roles r
join (values
  ('OWNER','users.view'),('OWNER','audit.view'),
  ('OWNER','customers.view'),('OWNER','customers.view_financial'),
  ('OWNER','suppliers.view'),('OWNER','suppliers.view_financial'),
  ('OWNER','products.view'),('OWNER','warehouses.view'),('OWNER','warehouses.all'),
  ('OWNER','accounts.view'),('OWNER','banks.view'),('OWNER','payment_agents.view'),
  ('OWNER','employees.view'),('OWNER','attachments.view'),

  ('ACCOUNTANT','customers.view'),('ACCOUNTANT','customers.manage'),('ACCOUNTANT','customers.view_financial'),
  ('ACCOUNTANT','suppliers.view'),('ACCOUNTANT','suppliers.manage'),('ACCOUNTANT','suppliers.view_financial'),
  ('ACCOUNTANT','products.view'),('ACCOUNTANT','warehouses.view'),('ACCOUNTANT','warehouses.all'),
  ('ACCOUNTANT','accounts.view'),('ACCOUNTANT','accounts.manage'),
  ('ACCOUNTANT','banks.view'),('ACCOUNTANT','banks.manage'),
  ('ACCOUNTANT','payment_agents.view'),('ACCOUNTANT','payment_agents.manage'),
  ('ACCOUNTANT','attachments.view'),('ACCOUNTANT','attachments.manage'),

  ('WAREHOUSE_MANAGER','products.view'),('WAREHOUSE_MANAGER','products.manage'),
  ('WAREHOUSE_MANAGER','warehouses.view'),('WAREHOUSE_MANAGER','warehouses.manage'),
  ('WAREHOUSE_MANAGER','customers.view'),('WAREHOUSE_MANAGER','suppliers.view'),
  ('WAREHOUSE_MANAGER','employees.view'),
  ('WAREHOUSE_MANAGER','attachments.view'),('WAREHOUSE_MANAGER','attachments.manage'),

  ('WAREHOUSE_STAFF','products.view'),('WAREHOUSE_STAFF','warehouses.view'),
  ('WAREHOUSE_STAFF','attachments.view'),

  ('SALESPERSON','customers.view_assigned'),('SALESPERSON','products.view'),
  ('SALESPERSON','attachments.view')
) as x(role_code, perm) on x.role_code = r.code
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Units of measure, categories, COA for JST
-- ---------------------------------------------------------------------
insert into public.units_of_measure(company_id, code, name, allow_decimal)
select c.id, u.code, u.name, u.dec from public.companies c
cross join (values
  ('PCS','Pieces',false),('SET','Set',false),('BOX','Box',false),('CTN','Carton',false),
  ('KG','Kilogram',true),('MTR','Metre',true),('FT','Feet',true),('ROLL','Roll',false),
  ('LTR','Litre',true),('PAIR','Pair',false)
) as u(code, name, dec)
where c.code = 'JST'
on conflict do nothing;

insert into public.product_categories(company_id, name, code)
select c.id, x.name, x.code from public.companies c
cross join (values
  ('Feeding Systems','FEED'),('Drinking Systems','DRINK'),('Ventilation & Cooling','VENT'),
  ('Heating','HEAT'),('Cages & Housing','CAGE'),('Spare Parts','SPARE')
) as x(name, code)
where c.code = 'JST'
on conflict do nothing;

-- Chart of accounts (groups + posting accounts with system keys for engines)
do $$
declare v_company uuid;
begin
  select id into v_company from public.companies where code = 'JST';

  insert into public.chart_of_accounts(company_id, code, name, account_type, is_group, system_key) values
    (v_company,'1000','Assets','ASSET',true,null),
    (v_company,'2000','Liabilities','LIABILITY',true,null),
    (v_company,'3000','Equity','EQUITY',true,null),
    (v_company,'4000','Income','INCOME',true,null),
    (v_company,'5000','Expenses','EXPENSE',true,null)
  on conflict do nothing;

  insert into public.chart_of_accounts(company_id, code, name, account_type, is_group, system_key, parent_id)
  select v_company, x.code, x.name, x.t, x.g, x.k,
         (select id from public.chart_of_accounts p where p.company_id = v_company and p.code = x.parent)
  from (values
    ('1100','Cash & Bank','ASSET',true,null,'1000'),
    ('1200','Accounts Receivable','ASSET',false,'AR_CONTROL','1000'),
    ('1250','PDC Receivable (Cheques in Hand)','ASSET',false,'PDC_RECEIVABLE','1000'),
    ('1300','Inventory','ASSET',false,'INVENTORY','1000'),
    ('1350','Goods Received Not Billed / In Transit','ASSET',false,'GRNI','1000'),
    ('1400','Payment Agent Advances','ASSET',false,'AGENT_ADVANCE','1000'),
    ('1450','Supplier Advances','ASSET',false,'SUPPLIER_ADVANCE','1000'),
    ('1500','Employee Advances','ASSET',false,'EMPLOYEE_ADVANCE','1000'),
    ('2100','Accounts Payable','LIABILITY',false,'AP_CONTROL','2000'),
    ('2150','PDC Payable (Cheques Issued)','LIABILITY',false,'PDC_PAYABLE','2000'),
    ('2200','Employee Payable','LIABILITY',false,'EMPLOYEE_PAYABLE','2000'),
    ('2300','Payment Agent Payable','LIABILITY',false,'AGENT_PAYABLE','2000'),
    ('2400','Customer Advances','LIABILITY',false,'CUSTOMER_ADVANCE','2000'),
    ('2500','Sales Tax Payable','LIABILITY',false,'SALES_TAX_PAYABLE','2000'),
    ('3100','Owner Capital','EQUITY',false,'CAPITAL','3000'),
    ('3200','Retained Earnings','EQUITY',false,'RETAINED_EARNINGS','3000'),
    ('3300','Opening Balance Equity','EQUITY',false,'OPENING_BALANCE','3000'),
    ('4100','Sales Revenue','INCOME',false,'SALES','4000'),
    ('4200','Sales Returns','INCOME',false,'SALES_RETURNS','4000'),
    ('4900','Realized FX Gain/Loss','INCOME',false,'FX_GAIN_LOSS','4000'),
    ('5100','Cost of Goods Sold','EXPENSE',false,'COGS','5000'),
    ('5200','Salaries & Wages','EXPENSE',false,'PAYROLL_EXPENSE','5000'),
    ('5250','Assembly Labour','EXPENSE',false,'ASSEMBLY_LABOUR','5000'),
    ('5300','Freight & Clearing','EXPENSE',false,'FREIGHT','5000'),
    ('5400','Bank Charges','EXPENSE',false,'BANK_CHARGES','5000'),
    ('5500','Inventory Adjustments','EXPENSE',false,'INVENTORY_ADJUSTMENT','5000'),
    ('5900','General Expenses','EXPENSE',false,null,'5000')
  ) as x(code, name, t, g, k, parent)
  on conflict do nothing;

  insert into public.chart_of_accounts(company_id, code, name, account_type, is_group, system_key, parent_id)
  select v_company, '1110', 'Cash in Hand', 'ASSET', false, 'CASH_DEFAULT',
         (select id from public.chart_of_accounts where company_id = v_company and code = '1100')
  on conflict do nothing;

  insert into public.bank_accounts(company_id, code, name, account_kind, currency, gl_account_id)
  select v_company, 'CASH', 'Cash in Hand', 'CASH', 'PKR',
         (select id from public.chart_of_accounts where company_id = v_company and code = '1110')
  on conflict do nothing;

  insert into public.numbering_sequences(company_id, doc_type, prefix, padding) values
    (v_company,'CUSTOMER','C-',4),
    (v_company,'CUSTOMER_GROUP','G-',3),
    (v_company,'SUPPLIER','S-',4),
    (v_company,'PRODUCT','P-',5),
    (v_company,'EMPLOYEE','E-',4),
    (v_company,'WAREHOUSE','WH-',2),
    (v_company,'PAYMENT_AGENT','AG-',3),
    (v_company,'BANK_ACCOUNT','BA-',3)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Auto-codes: blank code -> next number from numbering_sequences
-- ---------------------------------------------------------------------
create or replace function public.tg_auto_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_col text := tg_argv[1]; v_doc text := tg_argv[0]; v_val text;
begin
  v_val := to_jsonb(new) ->> v_col;
  if v_val is null or length(trim(v_val)) = 0 then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, public.next_document_number(new.company_id, v_doc)));
  end if;
  return new;
end $$;
revoke execute on function public.tg_auto_code() from public, anon, authenticated;

create trigger auto_code before insert on public.customers       for each row execute function public.tg_auto_code('CUSTOMER','code');
create trigger auto_code before insert on public.customer_groups for each row execute function public.tg_auto_code('CUSTOMER_GROUP','code');
create trigger auto_code before insert on public.suppliers       for each row execute function public.tg_auto_code('SUPPLIER','code');
create trigger auto_code before insert on public.products        for each row execute function public.tg_auto_code('PRODUCT','sku');
create trigger auto_code before insert on public.employees       for each row execute function public.tg_auto_code('EMPLOYEE','code');
create trigger auto_code before insert on public.warehouses      for each row execute function public.tg_auto_code('WAREHOUSE','code');
create trigger auto_code before insert on public.payment_agents  for each row execute function public.tg_auto_code('PAYMENT_AGENT','code');
create trigger auto_code before insert on public.bank_accounts   for each row execute function public.tg_auto_code('BANK_ACCOUNT','code');

-- ---------------------------------------------------------------------
-- Bootstrap: existing auth users get profiles; earliest becomes Admin.
-- ---------------------------------------------------------------------
insert into public.profiles(id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1))
from auth.users u
on conflict (id) do nothing;

insert into public.user_roles(user_id, role_id, company_id)
select u.id, r.id, c.id
from (select id from auth.users order by created_at limit 1) u
cross join public.roles r cross join public.companies c
where r.code = 'ADMINISTRATOR' and c.code = 'JST'
  and not exists (select 1 from public.user_roles)
on conflict do nothing;

update public.profiles p set default_company_id = c.id
from public.companies c where c.code = 'JST' and p.default_company_id is null;
