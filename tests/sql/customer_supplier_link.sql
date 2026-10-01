-- Customer <-> supplier party link regression test (rolls back).
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; cu uuid; su uuid; su2 uuid; cu2 uuid; n int;
begin
  select id into c from public.companies limit 1;
  -- 1. new customer (default flag) -> supplier auto-created and linked
  insert into public.customers(company_id, name, phone, city) values (c, 'ZZ Test Party', '0300-1', 'Okara') returning id into cu;
  select linked_supplier_id into su from public.customers where id = cu;
  insert into t_out select 1, 'customer->supplier: '||coalesce(s.code,'NONE')||' '||s.name||' back-link ok='||(s.linked_customer_id = cu)||' flag='||s.is_also_customer from public.suppliers s where s.id = su;
  -- 2. edit name/phone on customer -> synced to supplier
  update public.customers set name = 'ZZ Test Party Renamed', phone = '0300-2' where id = cu;
  insert into t_out select 2, 'sync c->s: '||name||' / '||phone from public.suppliers where id = su;
  -- 3. edit on supplier -> synced to customer
  update public.suppliers set city = 'Lahore' where id = su;
  insert into t_out select 3, 'sync s->c: city='||city from public.customers where id = cu;
  -- 4. untick -> unlinked, both kept
  update public.customers set is_also_supplier = false where id = cu;
  insert into t_out select 4, 'unlink: cust link='||coalesce(c2.linked_supplier_id::text,'null')||' sup link='||coalesce(s.linked_customer_id::text,'null')||' sup flag='||s.is_also_customer||' sup active='||s.is_active
    from public.customers c2, public.suppliers s where c2.id = cu and s.id = su;
  -- 5. re-tick -> relinks to the same-named supplier instead of duplicating
  update public.customers set is_also_supplier = true where id = cu;
  select count(*) into n from public.suppliers where name = 'ZZ Test Party Renamed';
  insert into t_out select 5, 're-link same supplier='||(linked_supplier_id = su)||' supplier count='||n from public.customers where id = cu;
  -- 6. new supplier (default flag) -> customer auto-created
  insert into public.suppliers(company_id, name, country, default_currency) values (c, 'ZZ Foreign Vendor', 'China', 'CNY') returning id into su2;
  select linked_customer_id into cu2 from public.suppliers where id = su2;
  insert into t_out select 6, 'supplier->customer: '||code||' '||name||' cur='||default_currency||' back-link ok='||(linked_supplier_id = su2) from public.customers where id = cu2;
  -- 7. opt out on create
  insert into public.suppliers(company_id, name, is_also_customer) values (c, 'ZZ Supplier Only', false) returning id into su2;
  insert into t_out select 7, 'opt-out: linked='||coalesce(linked_customer_id::text,'null')||' customers created='||(select count(*) from public.customers where name='ZZ Supplier Only') from public.suppliers where id = su2;
end $$;
select * from t_out order by step;
rollback;
