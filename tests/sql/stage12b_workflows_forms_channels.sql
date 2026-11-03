-- Stage 12 part 2: workflows, document custom fields, new field types, forms per role, e-mail / WhatsApp outbox.
-- Uses the first Administrator / Owner / Salesperson users; everything rolls back.
-- Expected: every row starts with "ok".
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
create temp table t_ids(admin uuid, owner uuid, sales uuid) on commit drop;
grant all on t_ids to authenticated;
insert into t_ids select
  (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'ADMINISTRATOR' order by ur.created_at limit 1),
  (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'OWNER' order by ur.created_at limit 1),
  (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'SALESPERSON' order by ur.created_at limit 1);
select set_config('request.jwt.claims', json_build_object('sub', (select admin from t_ids), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  c uuid; pcs uuid; wa uuid; cu uuid; prod uuid; so uuid; so2 uuid; so3 uuid; r jsonb; n int; t text; ids record;
  f_site uuid; f_len uuid; f_rate uuid; f_total uuid; f_ref uuid; f_when uuid; f_file uuid; wf uuid; act uuid; back uuid;
  cust2 uuid;
begin
  select * into ids from t_ids;
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code = 'PCS' and company_id = c;
  select id into wa from public.warehouses where company_id = c order by code limit 1;
  select id into cu from public.customers where company_id = c and is_active order by created_at limit 1;
  insert into public.products(company_id, name, base_uom_id) values (c, 'S12B Test Feeder', pcs) returning id into prod;
  perform public.post_stock_document('STOCK_ADJUSTMENT', public.save_stock_adjustment(null,
    jsonb_build_object('company_id', c, 'warehouse_id', wa, 'reason', 'OPENING_BALANCE', 'entry_mode', 'CHANGE'), jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 100))));

  -- ---------------------------------------------------------- 0. owner may approve
  insert into t_out values (1, case when exists (select 1 from public.role_permissions rp join public.roles ro on ro.id = rp.role_id where ro.code = 'OWNER' and rp.permission_code = 'sales.approve')
    and exists (select 1 from public.role_permissions rp join public.roles ro on ro.id = rp.role_id where ro.code = 'OWNER' and rp.permission_code = 'journals.post')
    then 'ok' else 'BAD' end || ' Owner holds sales.approve + journals.post');

  -- ---------------------------------------------------------- 1. new field types
  f_len := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Shed length m', 'field_type', 'decimal'));
  f_rate := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Birds per m', 'field_type', 'number'));
  f_total := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Capacity', 'field_type', 'formula',
    'formula', '{shed_length_m} * {birds_per_m}', 'decimals', 0));
  perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(f_len, 120.5, f_rate, 40));
  select value_number::text into t from public.custom_field_values where field_id = f_total and record_id = cu;
  insert into t_out values (2, case when t = '4820' then 'ok' else 'BAD' end || ' formula computed on save: ' || coalesce(t, 'null') || ' (expect 4820)');
  perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(f_rate, 50));
  select value_number::text into t from public.custom_field_values where field_id = f_total and record_id = cu;
  insert into t_out values (3, case when t = '6025' then 'ok' else 'BAD' end || ' formula recalculated: ' || coalesce(t, 'null') || ' (expect 6025)');
  perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(f_rate, null));
  select count(*) into n from public.custom_field_values where field_id = f_total and record_id = cu;
  insert into t_out values (4, case when n = 0 then 'ok' else 'BAD' end || ' formula empty when an input is empty');
  begin perform public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Bad', 'field_type', 'formula', 'formula', '{nope} * 2'));
    insert into t_out values (5, 'BAD: unknown code accepted');
  exception when others then insert into t_out values (5, 'ok unknown code rejected: ' || sqlerrm); end;
  begin perform public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Bad2', 'field_type', 'formula', 'formula', '{shed_length_m}; select 1'));
    insert into t_out values (6, 'BAD: unsafe formula accepted');
  exception when others then insert into t_out values (6, 'ok unsafe formula rejected: ' || sqlerrm); end;

  f_ref := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Referred by', 'field_type', 'reference', 'ref_entity', 'customers'));
  select id into cust2 from public.customers where company_id = c and id <> cu order by created_at limit 1;
  perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(f_ref, cust2));
  select value_text into t from public.custom_field_values where field_id = f_ref and record_id = cu;
  insert into t_out values (7, case when t = (select name from public.customers where id = cust2) then 'ok' else 'BAD' end || ' reference stores the record + its name: ' || coalesce(t, 'null'));
  begin perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(f_ref, gen_random_uuid())); insert into t_out values (8, 'BAD: unknown reference accepted');
  exception when others then insert into t_out values (8, 'ok unknown reference rejected: ' || sqlerrm); end;
  f_when := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Last visit', 'field_type', 'datetime'));
  perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(f_when, '2026-11-02T22:30:00+05:00'));
  select value_date::text into t from public.custom_field_values where field_id = f_when and record_id = cu;
  insert into t_out values (9, case when t = '2026-11-02' then 'ok' else 'BAD' end || ' date & time stored (local date ' || coalesce(t, 'null') || ')');
  begin perform public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'warehouses', 'label', 'Photo', 'field_type', 'image'));
    insert into t_out values (10, 'BAD: image field on an entity without files');
  exception when others then insert into t_out values (10, 'ok image field needs files support: ' || sqlerrm); end;
  f_file := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'NTN certificate', 'field_type', 'file'));
  begin perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(f_file, gen_random_uuid())); insert into t_out values (11, 'BAD: file not attached accepted');
  exception when others then insert into t_out values (11, 'ok file must be attached to this record: ' || sqlerrm); end;

  -- ---------------------------------------------------------- 2. custom fields on documents
  f_site := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'sales_orders', 'label', 'Site contact', 'field_type', 'text', 'required', true));
  so := public.save_sales_order(null, jsonb_build_object('company_id', c, 'customer_id', cu),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 100, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 5)))));
  perform public.save_custom_field_values(c, 'sales_orders', so, '{}'::jsonb);
  insert into t_out values (12, 'ok document saves while a required field is empty (checked at approval)');
  -- made + approved in this same transaction counts as one step: use the state function to check the gate list instead
  r := public.workflow_state(c, 'SALES_ORDER', so);
  insert into t_out values (13, case when r->'cf_missing' ? 'Site contact' then 'ok' else 'BAD' end || ' document shows the missing required field: ' || (r->>'cf_missing'));

  -- ---------------------------------------------------------- 3. workflow
  begin perform public.save_workflow(c, 'SALES_ORDER', jsonb_build_object('is_active', true, 'steps', '[]'::jsonb)); insert into t_out values (14, 'BAD: active workflow without steps');
  exception when others then insert into t_out values (14, 'ok needs a step: ' || sqlerrm); end;
  wf := public.save_workflow(c, 'SALES_ORDER', jsonb_build_object('name', 'Order check', 'is_active', true, 'include_one_step', true,
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'a', 'name', 'Manager check', 'roles', jsonb_build_array('ADMINISTRATOR', 'WAREHOUSE_MANAGER'), 'required_fields', jsonb_build_array('core:customer_reference')),
      jsonb_build_object('key', 'b', 'name', 'Owner OK', 'roles', jsonb_build_array('OWNER')))));
  select count(*) into n from public.workflow_transitions where definition_id = wf;
  insert into t_out values (15, case when n = 3 then 'ok' else 'BAD' end || ' default transitions made: ' || n || ' (pass, ready, send back)');
  so2 := public.save_sales_order(null, jsonb_build_object('company_id', c, 'customer_id', cu),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 100, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 5)))));
  perform public.save_custom_field_values(c, 'sales_orders', so2, jsonb_build_object(f_site, 'Akram 0300'));
  begin perform public.approve_sales_order(so2); insert into t_out values (16, 'BAD: approved before the steps');
  exception when others then insert into t_out values (16, 'ok approval held by the workflow: ' || sqlerrm); end;
  r := public.workflow_state(c, 'SALES_ORDER', so2);
  insert into t_out values (17, case when r->'current'->>'name' = 'Manager check' and (r->>'applies')::boolean then 'ok' else 'BAD' end || ' state: at ' || (r->'current'->>'name') || ', missing ' || (r->'current'->>'missing'));
  select (a->>'id')::uuid into act from jsonb_array_elements(r->'actions') a where a->>'kind' = 'forward';
  begin perform public.workflow_move(c, 'SALES_ORDER', so2, act, null); insert into t_out values (18, 'BAD: passed with an empty required field');
  exception when others then insert into t_out values (18, 'ok step needs its field: ' || sqlerrm); end;
  perform public.save_sales_order(so2, jsonb_build_object('company_id', c, 'customer_id', cu, 'customer_reference', 'PO-778'),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 100, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 5)))));
  r := public.workflow_move(c, 'SALES_ORDER', so2, act, null);
  insert into t_out values (19, case when r->'current'->>'name' = 'Owner OK' then 'ok' else 'BAD' end || ' moved to ' || (r->'current'->>'name'));
  select (a->>'id')::uuid into act from jsonb_array_elements(r->'actions') a where a->>'kind' = 'finish';
  select (a->>'id')::uuid into back from jsonb_array_elements(r->'actions') a where a->>'kind' = 'back';
  begin perform public.workflow_move(c, 'SALES_ORDER', so2, act, null); insert into t_out values (20, 'BAD: admin passed the owner step');
  exception when others then insert into t_out values (20, 'ok only the step role can act: ' || sqlerrm); end;

  -- owner sees it in the bell, sends it back once, then marks it ready
  perform set_config('request.jwt.claims', json_build_object('sub', ids.owner, 'role', 'authenticated')::text, true);
  perform public.refresh_my_notifications(c);
  select count(*) into n from public.notifications where user_id = ids.owner and rule_code = 'WORKFLOW_STEP' and resolved_at is null and link like '%' || so2;
  insert into t_out values (21, case when n = 1 then 'ok' else 'BAD' end || ' owner notified of the waiting step: ' || n);
  begin perform public.workflow_move(c, 'SALES_ORDER', so2, back, ''); insert into t_out values (22, 'BAD: send back without a comment');
  exception when others then insert into t_out values (22, 'ok send back needs a comment: ' || sqlerrm); end;
  r := public.workflow_move(c, 'SALES_ORDER', so2, back, 'Check the quantity');
  insert into t_out values (23, case when r->'current'->>'name' = 'Manager check' then 'ok' else 'BAD' end || ' sent back to ' || (r->'current'->>'name'));
  perform set_config('request.jwt.claims', json_build_object('sub', ids.admin, 'role', 'authenticated')::text, true);
  select (a->>'id')::uuid into act from jsonb_array_elements(r->'actions') a where a->>'kind' = 'forward';
  r := public.workflow_move(c, 'SALES_ORDER', so2, act, 'Checked');
  perform set_config('request.jwt.claims', json_build_object('sub', ids.owner, 'role', 'authenticated')::text, true);
  select (a->>'id')::uuid into act from jsonb_array_elements(r->'actions') a where a->>'kind' = 'finish';
  r := public.workflow_move(c, 'SALES_ORDER', so2, act, null);
  insert into t_out values (24, case when (r->>'done')::boolean then 'ok' else 'BAD' end || ' steps finished; history rows: ' || jsonb_array_length(r->'events'));
  perform public.refresh_my_notifications(c);
  select count(*) into n from public.notifications where user_id = ids.owner and rule_code = 'WORKFLOW_STEP' and resolved_at is null and link like '%' || so2;
  insert into t_out values (25, case when n = 0 then 'ok' else 'BAD' end || ' notification cleared itself: ' || n);
  perform set_config('request.jwt.claims', json_build_object('sub', ids.admin, 'role', 'authenticated')::text, true);
  perform public.approve_sales_order(so2);
  select status into t from public.sales_orders where id = so2;
  insert into t_out values (26, case when t = 'APPROVED' then 'ok' else 'BAD' end || ' approved after the steps: ' || t);

  -- one-step entries are not held unless the workflow says so
  perform public.save_workflow(c, 'SALES_ORDER', jsonb_build_object('name', 'Order check', 'is_active', true, 'include_one_step', false,
    'steps', jsonb_build_array(jsonb_build_object('name', 'Manager check', 'roles', jsonb_build_array('WAREHOUSE_MANAGER')))));
  so3 := public.save_sales_order(null, jsonb_build_object('company_id', c, 'customer_id', cu),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 100, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 5)))));
  perform public.save_custom_field_values(c, 'sales_orders', so3, jsonb_build_object(f_site, 'x'));
  perform public.approve_sales_order(so3);
  insert into t_out values (27, 'ok made-and-approved in one step is not held (include_one_step off)');
  -- salesperson cannot change workflows
  perform set_config('request.jwt.claims', json_build_object('sub', ids.sales, 'role', 'authenticated')::text, true);
  begin perform public.save_workflow(c, 'PURCHASE_ORDER', jsonb_build_object('is_active', false)); insert into t_out values (28, 'BAD: salesperson saved a workflow');
  exception when others then insert into t_out values (28, 'ok only settings.manage saves workflows: ' || sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', ids.admin, 'role', 'authenticated')::text, true);
  begin insert into public.document_workflows(company_id, doc_type, doc_id, definition_id, completed_at) values (c, 'SALES_ORDER', so, wf, now()); insert into t_out values (29, 'BAD: direct state write');
  exception when others then insert into t_out values (29, 'ok workflow state written only by the engine: ' || sqlerrm); end;

  -- ---------------------------------------------------------- 4. forms per role
  begin perform public.save_form_layout(c, 'customers', 'ADMINISTRATOR', jsonb_build_object('hidden_fields', jsonb_build_array('phone'), 'required_fields', jsonb_build_array('phone')));
    insert into t_out values (30, 'BAD: hidden + required accepted');
  exception when others then insert into t_out values (30, 'ok hidden and required clash rejected: ' || sqlerrm); end;
  begin perform public.save_form_layout(c, 'customers', 'ADMINISTRATOR', jsonb_build_object('required_fields', jsonb_build_array('shoe_size')));
    insert into t_out values (31, 'BAD: unknown field accepted');
  exception when others then insert into t_out values (31, 'ok unknown field rejected: ' || sqlerrm); end;
  perform public.save_form_layout(c, 'customers', 'ADMINISTRATOR', jsonb_build_object('required_fields', jsonb_build_array('phone'), 'hidden_sections', jsonb_build_array('credit')));
  begin insert into public.customers(company_id, name) values (c, 'S12B No Phone'); insert into t_out values (32, 'BAD: required-for-role field skipped');
  exception when others then insert into t_out values (32, 'ok required for the role (database): ' || sqlerrm); end;
  insert into public.customers(company_id, name, phone) values (c, 'S12B With Phone', '0300-1112223');
  insert into t_out values (33, 'ok saved when the field is filled');
  perform set_config('request.jwt.claims', json_build_object('sub', ids.owner, 'role', 'authenticated')::text, true);
  select count(*) into n from public.form_layouts where company_id = c;
  insert into t_out values (34, case when n = 1 then 'ok' else 'BAD' end || ' layouts readable by members: ' || n);
  perform set_config('request.jwt.claims', json_build_object('sub', ids.admin, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------- 5. e-mail / WhatsApp outbox
  perform public.save_notification_channels(c, jsonb_build_object('email_on', true, 'whatsapp_on', true));
  perform public.save_notification_rule(c, 'SO_APPROVAL', true, array['ADMINISTRATOR','WAREHOUSE_MANAGER'], jsonb_build_object('email', true, 'whatsapp', true));
  begin perform public.save_notification_pref(c, ids.admin, jsonb_build_object('whatsapp_on', true, 'whatsapp_phone', '12')); insert into t_out values (35, 'BAD: short phone accepted');
  exception when others then insert into t_out values (35, 'ok phone validated: ' || sqlerrm); end;
  perform public.save_notification_pref(c, ids.admin, jsonb_build_object('email_on', true, 'whatsapp_on', true, 'whatsapp_phone', '0300 1234567'));
  select whatsapp_phone into t from public.user_notification_prefs where user_id = ids.admin and company_id = c;
  insert into t_out values (36, case when t = '923001234567' then 'ok' else 'BAD' end || ' 03xx number stored as ' || t);
  so3 := public.save_sales_order(null, jsonb_build_object('company_id', c, 'customer_id', cu),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 100, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 1)))));
  perform public.refresh_my_notifications(c);
  select count(*) into n from public.notification_outbox o join public.notifications x on x.id = o.notification_id
   where o.user_id = ids.admin and x.link like '%' || so3;
  insert into t_out values (37, case when n = 2 then 'ok' else 'BAD' end || ' new alert queued for e-mail + WhatsApp: ' || n);
  r := to_jsonb(public.notify_test(c, 'WHATSAPP'));
  select count(*) into n from public.notification_outbox where user_id = ids.admin and subject like 'Test message%';
  insert into t_out values (38, case when n = 1 then 'ok' else 'BAD' end || ' test message queued');
  perform set_config('request.jwt.claims', json_build_object('sub', ids.sales, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notification_outbox where user_id = ids.admin;
  insert into t_out values (39, case when n = 0 then 'ok' else 'BAD' end || ' others cannot read your outbox: ' || n);
  begin perform public.notify_outbox_claim(10); insert into t_out values (40, 'BAD: user claimed the outbox');
  exception when others then insert into t_out values (40, 'ok only the server sends: ' || sqlerrm); end;
end $$;
-- the background sweep runs as each person who gets e-mail / WhatsApp (no user session)
reset role;
select set_config('request.jwt.claims', '', true);
do $$ declare n int; begin
  n := public.notifications_sweep();
  insert into t_out values (41, case when n >= 1 then 'ok' else 'BAD' end || ' sweep evaluated ' || n || ' person(s)');
  select count(*) into n from public.notify_outbox_claim(100);
  insert into t_out values (42, case when n >= 3 then 'ok' else 'BAD' end || ' edge function can claim the queue: ' || n);
end $$;
select step, result from t_out order by step;
rollback;
