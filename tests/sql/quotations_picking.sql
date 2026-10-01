-- Stage 5 part 2a (rolls back): quotation → SO link; picking task (create / staff pick with shortage / complete /
-- reassign history / GDN from picked); price privacy for warehouse roles. Creates two temporary users.
-- Expected: no row starts with "BAD"; drift 0.
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
create temp table t_ids(k text primary key, v uuid) on commit drop;
grant all on t_ids to authenticated;
-- temporary users: a warehouse manager and a picker
insert into auth.users(id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t.manager@example.test'),
  ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t.picker@example.test');
insert into public.user_roles(user_id, role_id, company_id)
select '00000000-0000-0000-0000-00000000a001', r.id, (select id from public.companies limit 1) from public.roles r where r.code = 'WAREHOUSE_MANAGER';
insert into public.user_roles(user_id, role_id, company_id)
select '00000000-0000-0000-0000-00000000a002', r.id, (select id from public.companies limit 1) from public.roles r where r.code = 'WAREHOUSE_STAFF';
insert into t_ids values ('mgr','00000000-0000-0000-0000-00000000a001'), ('pick','00000000-0000-0000-0000-00000000a002'),
  ('admin', (select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code='ADMINISTRATOR' limit 1));

-- ===== as administrator
select set_config('request.jwt.claims', json_build_object('sub',(select v from t_ids where k='admin'),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid; pcs uuid; wa uuid; wb uuid; fan uuid; bolt uuid; cu uuid; adj uuid; q uuid; so uuid; t1 uuid; t2 uuid; g uuid; l1 uuid; x jsonb; n int;
begin
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code='PCS' and company_id=c;
  insert into public.warehouses(company_id,name) values (c,'S-A') returning id into wa;
  insert into public.warehouses(company_id,name) values (c,'S-B') returning id into wb;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Fan',pcs) returning id into fan;
  insert into public.products(company_id,name,base_uom_id) values (c,'T Bolt',pcs) returning id into bolt;
  insert into public.customers(company_id,name) values (c,'T Buyer') returning id into cu;
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wa,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',100), jsonb_build_object('product_id',bolt,'quantity',500)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);
  adj := public.save_stock_adjustment(null, jsonb_build_object('company_id',c,'warehouse_id',wb,'reason','OPENING_BALANCE','entry_mode','CHANGE'),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',60)));
  perform public.post_stock_document('STOCK_ADJUSTMENT', adj);

  -- quotation
  q := public.save_quotation(null, jsonb_build_object('company_id',c,'customer_id',cu,'valid_until','2026-10-31','discount_amount',500),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',80,'unit_price',1000), jsonb_build_object('product_id',bolt,'quantity',100,'unit_price',10,'description','M10')));
  insert into t_out select 1, 'quotation '||status||' total='||total_amount||' (80500) lines='||(select count(*) from public.quotation_lines where quotation_id=q and is_active) from public.quotations where id=q;
  perform public.save_quotation(q, jsonb_build_object('company_id',c,'customer_id',cu,'discount_amount',0),
    jsonb_build_array(jsonb_build_object('product_id',fan,'quantity',80,'unit_price',950)));
  perform public.set_quotation_status(q, 'SENT');
  insert into t_out select 2, 'edited+sent: '||status||' total='||total_amount||' (76000) active lines='||(select count(*) from public.quotation_lines where quotation_id=q and is_active) from public.quotations where id=q;
  begin perform public.set_quotation_status(q, 'REJECTED'); insert into t_out values (3,'BAD: rejected without reason');
  exception when others then insert into t_out values (3,'reject needs reason'); end;
  so := public.save_sales_order(null, jsonb_build_object('company_id',c,'customer_id',cu), jsonb_build_array(
    jsonb_build_object('product_id',fan,'unit_price',950,'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',wa,'quantity',50),jsonb_build_object('warehouse_id',wb,'quantity',30)))));
  perform public.link_quotation_order(q, so);
  perform public.approve_sales_order(so);
  insert into t_out select 4, 'converted: '||q2.status||' so linked='||(s.source_quotation_id = q2.id) from public.quotations q2 join public.sales_orders s on s.id=q2.sales_order_id where q2.id=q;
  insert into t_ids values ('so', so), ('wa', wa), ('wb', wb), ('c', c);

  -- picking task A for the picker, task B unassigned
  t1 := public.create_picking_task(jsonb_build_object('company_id',c,'sales_order_id',so,'warehouse_id',wa,'assigned_to',(select v from t_ids where k='pick')));
  t2 := public.create_picking_task(jsonb_build_object('company_id',c,'sales_order_id',so,'warehouse_id',wb));
  insert into t_out select 5, 'tasks: A lines='||(select count(*)||' qty='||sum(qty_requested)::numeric(8,0) from public.picking_task_lines where task_id=t1)||
    ' pickable A now='||(select pickable::numeric(8,0) from public.so_pickable(so) where warehouse_id=wa);
  begin perform public.create_picking_task(jsonb_build_object('company_id',c,'sales_order_id',so,'warehouse_id',wa));
    insert into t_out values (6,'BAD: double picking allowed');
  exception when others then insert into t_out values (6,'double picking blocked: '||sqlerrm); end;
  perform public.assign_picking_task(t2, (select v from t_ids where k='mgr'), 'first');
  perform public.assign_picking_task(t2, (select v from t_ids where k='pick'), 'mgr busy');
  insert into t_out select 7, 'reassign history: '||string_agg(event, '>' order by created_at) from public.picking_task_events where task_id=t2;
  insert into t_ids values ('t1', t1), ('t2', t2);
end $$;
-- the manager works in both test warehouses
reset role;
insert into public.user_warehouse_access(company_id, user_id, warehouse_id)
select (select v from t_ids where k='c'), (select v from t_ids where k='mgr'), v from t_ids where k in ('wa','wb');
set local role authenticated;

-- ===== as picker (warehouse staff)
select set_config('request.jwt.claims', json_build_object('sub',(select v from t_ids where k='pick'),'role','authenticated')::text, true);
do $$
declare l record; n int;
begin
  select count(*) into n from public.picking_tasks;
  insert into t_out values (8, 'picker sees tasks='||n||' (2)');
  select count(*) into n from public.sales_orders;
  insert into t_out values (9, 'picker sees sales orders='||n||' (0)');
  select * into l from public.picking_task_lines where task_id=(select v from t_ids where k='t1') limit 1;
  begin perform public.record_pick(l.id, 45, null); insert into t_out values (10,'BAD: short without reason');
  exception when others then insert into t_out values (10,'short needs reason'); end;
  perform public.record_pick(l.id, 45, '5 damaged');
  perform public.complete_picking_task((select v from t_ids where k='t1'));
  insert into t_out select 11, 'task A '||status||' picked='||(select qty_picked::numeric(8,0) from public.picking_task_lines l2 where l2.task_id=picking_tasks.id) from public.picking_tasks where id=(select v from t_ids where k='t1');
  begin perform public.gdn_from_picking((select v from t_ids where k='t1')); insert into t_out values (12,'BAD: picker made GDN');
  exception when others then insert into t_out values (12,'picker cannot make GDN'); end;
end $$;

-- ===== as warehouse manager
select set_config('request.jwt.claims', json_build_object('sub',(select v from t_ids where k='mgr'),'role','authenticated')::text, true);
do $$
declare g uuid; n int; so uuid := (select v from t_ids where k='so'); lid uuid;
begin
  begin execute 'select unit_price from public.sales_order_lines limit 1'; insert into t_out values (13,'BAD: manager read prices');
  exception when others then insert into t_out values (13,'manager cannot read SO prices: '||sqlerrm); end;
  select count(*) into n from public.so_line_prices(array[so]);
  insert into t_out values (14, 'price RPC rows for manager='||n||' (0)');
  select count(*) into n from public.quotations;
  insert into t_out values (15, 'manager sees quotations='||n||' (0)');
  g := public.gdn_from_picking((select v from t_ids where k='t1'));
  perform public.post_gdn(g);
  insert into t_out select 16, 'GDN from picking qty='||sum(quantity)::numeric(8,0)||' (45) pickable A='||(select pickable::numeric(8,0) from public.so_pickable(so) where warehouse_id=(select v from t_ids where k='wa'))||' (5)' from public.gdn_lines where gdn_id=g;
  select id into lid from public.sales_order_lines where sales_order_id=so and is_active;
  perform public.revise_sales_order(so, '{}'::jsonb, jsonb_build_array(jsonb_build_object('id',lid,'product_id',(select product_id from public.sales_order_lines where id=lid),
    'allocations',jsonb_build_array(jsonb_build_object('warehouse_id',(select v from t_ids where k='wa'),'quantity',50),jsonb_build_object('warehouse_id',(select v from t_ids where k='wb'),'quantity',35)))));
  insert into t_out values (17, 'manager edited qty');
end $$;
reset role;
insert into t_out select 18, 'price kept after manager edit='||unit_price||' (950) qty='||quantity::numeric(8,0)||' (85)' from public.sales_order_lines where sales_order_id=(select v from t_ids where k='so') and is_active;
insert into t_out select 19, 'drift rows = '||count(*)||' (0)' from public.stock_balance_drift((select v from t_ids where k='c'));
select * from t_out order by step;
rollback;
