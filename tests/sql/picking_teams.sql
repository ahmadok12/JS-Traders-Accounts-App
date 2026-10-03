-- Picking v2 end-to-end test (runs as the real users, then rolls everything back).
-- Uses SO-2026-00008 (Nipple Drinker: 500 in WH-01, 100 in WH-02) and SO-2026-00001 (20 exhaust fans in WH-01),
-- admin Ahmad, staff "ali" (WH-01) and "bilal" (WH-02).
-- Run in the SQL editor: the final "TEST RESULT" exception prints the outcome and undoes all changes.
do $$
declare
  v_company uuid := '8feeae98-4708-489b-a0a5-243282840d5d';
  v_admin uuid := '88a1e648-f53c-4a1e-84ad-7f733d49833e';
  v_ali uuid := (select id from public.profiles where email = 'ali@staff.jstradersokr.shop');
  v_bilal uuid := (select id from public.profiles where email = 'bilal@staff.jstradersokr.shop');
  v_wh1 uuid := (select id from public.warehouses where code = 'WH-01');
  v_wh2 uuid := (select id from public.warehouses where code = 'WH-02');
  v_so uuid := (select id from public.sales_orders where doc_no = 'SO-2026-00008');
  v_so7 uuid := (select id from public.sales_orders where doc_no = 'SO-2026-00001');
  v_line uuid; v_line7 uuid; v_ids uuid[]; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_pl uuid; v_rep uuid; v_n int; v_q numeric; v_err text;
  out jsonb := '{}'::jsonb; out_alloc jsonb;
begin
  select id into v_line from public.sales_order_lines where sales_order_id = v_so and is_active;
  select id into v_line7 from public.sales_order_lines where sales_order_id = v_so7 and is_active;

  -- ---- manager splits what is left (200): 50 from WH-01 (Ali), 150 from WH-02 (Bilal — 50 more than the order put there)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ids := public.create_picking_tasks(v_company, v_so, jsonb_build_array(
    jsonb_build_object('warehouse_id', v_wh1, 'assignees', jsonb_build_array(v_ali), 'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', v_line, 'quantity', 50))),
    jsonb_build_object('warehouse_id', v_wh2, 'assignees', jsonb_build_array(v_bilal), 'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', v_line, 'quantity', 150)))),
    'test run', null);
  v_t1 := v_ids[1]; v_t2 := v_ids[2];
  out := out || jsonb_build_object('tasks_created', array_length(v_ids, 1));

  -- wrong warehouse picker is refused
  begin
    perform public.set_picking_assignees(v_t1, array[v_bilal], null);
    out := out || '{"bilal_into_wh1_refused": false}';
  exception when others then out := out || jsonb_build_object('bilal_into_wh1_refused', true, 'msg', sqlerrm); end;

  -- ---- Ali (WH-01): buzzer notification, sees only his task, picks short
  perform set_config('request.jwt.claims', json_build_object('sub', v_ali, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.staff_notifications where urgent and kind = 'TASK_ASSIGNED' and read_at is null;
  out := out || jsonb_build_object('ali_buzz', v_n);
  select count(*) into v_n from public.picking_tasks where id in (v_t1, v_t2);
  out := out || jsonb_build_object('ali_sees_tasks', v_n);
  perform public.ack_staff_notifications(null);
  select id into v_pl from public.picking_task_lines where task_id = v_t1;
  perform public.record_pick(v_pl, 30, 'only 30 on the shelf');
  begin
    perform public.record_pick((select id from public.picking_task_lines where task_id = v_t2), 150, null);
    out := out || '{"ali_blocked_on_bilal_task": false}';
  exception when others then out := out || '{"ali_blocked_on_bilal_task": true}'; end;
  perform public.complete_picking_task(v_t1, null);

  -- ---- manager: shortage + done alerts; sends the missing 20 to Bilal in WH-02
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.staff_notifications where kind in ('SHORTAGE','TASK_DONE');
  out := out || jsonb_build_object('admin_alerts', v_n);
  out := out || jsonb_build_object('ali_seen', (select acknowledged_at is not null from public.picking_task_assignees where task_id = v_t1 and user_id = v_ali));
  v_rep := public.resolve_pick_shortage(v_pl, 'REPICK', v_wh2, array[v_bilal], null);
  out := out || jsonb_build_object('repick_task', (select doc_no from public.picking_tasks where id = v_rep));

  -- ---- Bilal (WH-02): two tasks, picks everything
  perform set_config('request.jwt.claims', json_build_object('sub', v_bilal, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.picking_tasks where status in ('OPEN','IN_PROGRESS');
  out := out || jsonb_build_object('bilal_open_tasks', v_n);
  select count(*) into v_n from public.staff_notifications where urgent and read_at is null;
  out := out || jsonb_build_object('bilal_buzz', v_n);
  perform public.record_pick(l.id, l.qty_requested, null) from public.picking_task_lines l where l.task_id in (v_t2, v_rep);
  perform public.complete_picking_task(v_t2, null);
  perform public.complete_picking_task(v_rep, null);

  -- ---- reduce-order path on SO-2026-00001 (20 fans): Ali finds 15, manager reduces the order by 5
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_ids := public.create_picking_tasks(v_company, v_so7, jsonb_build_array(
    jsonb_build_object('warehouse_id', v_wh1, 'assignees', jsonb_build_array(v_ali), 'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', v_line7, 'quantity', 20)))), null, null);
  v_t3 := v_ids[1];
  perform set_config('request.jwt.claims', json_build_object('sub', v_ali, 'role', 'authenticated')::text, true);
  perform public.record_pick((select id from public.picking_task_lines where task_id = v_t3), 15, 'five damaged');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.resolve_pick_shortage((select id from public.picking_task_lines where task_id = v_t3), 'REDUCE_ORDER', null, null, null);

  execute 'reset role';
  select jsonb_object_agg(w.code, jsonb_build_object('qty', a.quantity, 'status', a.status, 'reserved', a.reserved_quantity, 'free', public.pick_free_qty(a.id)))
    into out_alloc from public.sales_order_line_warehouse_allocations a join public.warehouses w on w.id = a.warehouse_id where a.sales_order_line_id = v_line;
  out := out || jsonb_build_object('so8_allocations', out_alloc,
    'so8_reserved_active', (select json_agg(json_build_object(w.code, r.quantity)) from public.reservations r join public.warehouses w on w.id = r.warehouse_id where r.sales_order_line_id = v_line and r.status = 'ACTIVE'),
    'so1_line_qty', (select quantity from public.sales_order_lines where id = v_line7),
    'so1_reserved_active', (select coalesce(sum(quantity),0) from public.reservations where sales_order_line_id = v_line7 and status = 'ACTIVE'),
    'drift', (select count(*) from public.stock_balance_drift(v_company)));
  raise exception 'TEST RESULT %', out;
end $$;
