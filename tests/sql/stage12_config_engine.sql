-- Stage 12: numbering screen, custom fields, document templates, approval limits, notifications.
-- Uses the first Administrator / Accountant / Salesperson / Owner users; everything rolls back.
-- Expected: every row starts with "ok".
begin;
create temp table t_out(step int, result text) on commit drop;
grant all on t_out to authenticated;
create temp table t_ids(admin uuid, acct uuid, sales uuid, owner uuid) on commit drop;
grant all on t_ids to authenticated;
insert into t_ids select
  (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'ADMINISTRATOR' order by ur.created_at limit 1),
  (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'ACCOUNTANT' order by ur.created_at limit 1),
  (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'SALESPERSON' order by ur.created_at limit 1),
  (select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'OWNER' order by ur.created_at limit 1);
select set_config('request.jwt.claims', json_build_object('sub', (select admin from t_ids), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  c uuid; pcs uuid; wa uuid; cu uuid; sup uuid; prod uuid; fcap uuid; fshed uuid; fvip uuid; fdays uuid;
  so uuid; so2 uuid; po uuid; r jsonb; n int; t text; v_next bigint; v_code text; ok boolean; bank uuid; pv uuid; exp uuid;
  ids record;
begin
  select * into ids from t_ids;
  select id into c from public.companies limit 1;
  select id into pcs from public.units_of_measure where code = 'PCS' and company_id = c;
  select id into wa from public.warehouses where company_id = c order by code limit 1;
  select id into cu from public.customers where company_id = c and is_active order by created_at limit 1;
  select id into sup from public.suppliers where company_id = c and is_active order by created_at limit 1;
  insert into public.products(company_id, name, base_uom_id, reorder_level) values (c, 'S12 Test Drinker', pcs, 100) returning id into prod;
  -- 60 in stock: enough for the orders below, still under the reorder level of 100
  perform public.post_stock_document('STOCK_ADJUSTMENT', public.save_stock_adjustment(null,
    jsonb_build_object('company_id', c, 'warehouse_id', wa, 'reason', 'OPENING_BALANCE', 'entry_mode', 'CHANGE'), jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 60))));

  -- ---------------------------------------------------------- 1. numbering
  select next_number into v_next from public.numbering_sequences where company_id = c and doc_type = 'SALES_ORDER';
  begin
    perform public.set_numbering_sequence(c, 'SALES_ORDER', (select prefix from public.numbering_sequences where company_id = c and doc_type = 'SALES_ORDER'), greatest(v_next - 1, 0), 5, true);
    insert into t_out values (1, case when v_next <= 1 then 'ok (nothing to lower)' else 'BAD: next number lowered' end);
  exception when others then insert into t_out values (1, 'ok cannot lower the next number: ' || sqlerrm); end;
  r := public.set_numbering_sequence(c, 'SALES_ORDER', 'SO-', v_next + 100, 6, true);
  v_code := public.next_document_number(c, 'SALES_ORDER');
  insert into t_out values (2, case when v_code = 'SO-' || extract(year from now())::int || '-' || lpad((v_next + 100)::text, 6, '0') then 'ok' else 'BAD' end || ' raised + padding 6 → ' || v_code || ' (preview ' || (r->>'next_code') || ')');
  r := public.set_numbering_sequence(c, 'SALES_ORDER', 'SOX-', 1, 4, false);
  v_code := public.next_document_number(c, 'SALES_ORDER');
  insert into t_out values (3, case when v_code = 'SOX-0001' then 'ok' else 'BAD' end || ' new prefix may restart at 1 → ' || v_code);
  begin perform public.set_numbering_sequence(c, 'SALES_ORDER', 'S O<>', 5, 5, false); insert into t_out values (4, 'BAD: bad prefix accepted');
  exception when others then insert into t_out values (4, 'ok bad prefix rejected: ' || sqlerrm); end;
  begin update public.numbering_sequences set next_number = 1 where company_id = c and doc_type = 'GDN';
    get diagnostics n = row_count;
    insert into t_out values (5, case when n = 0 then 'ok direct table edit blocked (0 rows)' else 'BAD: direct edit changed ' || n || ' row(s)' end);
  exception when others then insert into t_out values (5, 'ok direct table edit blocked: ' || sqlerrm); end;

  -- ---------------------------------------------------------- 2. custom fields
  fcap := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Farm capacity (birds)', 'field_type', 'number', 'required', true, 'show_in_list', true));
  fshed := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Shed type', 'field_type', 'dropdown', 'options', jsonb_build_array('Open', 'Controlled', 'Cage')));
  fvip := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'VIP', 'field_type', 'checkbox'));
  fdays := public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'Delivery days', 'field_type', 'multi_select', 'options', jsonb_build_array('Mon', 'Wed', 'Fri')));
  select code into t from public.custom_field_definitions where id = fcap;
  insert into t_out values (6, case when t = 'farm_capacity_birds' then 'ok' else 'BAD' end || ' field code from label: ' || t);
  begin perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(fshed, 'Open')); insert into t_out values (7, 'BAD: required field skipped');
  exception when others then insert into t_out values (7, 'ok required field enforced: ' || sqlerrm); end;
  begin perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(fcap, 'lots')); insert into t_out values (8, 'BAD: text in number field');
  exception when others then insert into t_out values (8, 'ok number validated: ' || sqlerrm); end;
  begin perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(fcap, 20000, fshed, 'Tent')); insert into t_out values (9, 'BAD: unknown choice');
  exception when others then insert into t_out values (9, 'ok choice validated: ' || sqlerrm); end;
  n := public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(fcap, 20000.4, fshed, 'Controlled', fvip, true, fdays, jsonb_build_array('Mon', 'Fri')));
  select count(*) into n from public.custom_field_values v where v.record_id = cu
    and ((v.field_id = fcap and v.value_number = 20000) or (v.field_id = fshed and v.value_text = 'Controlled') or (v.field_id = fvip and v.value_bool)
      or (v.field_id = fdays and v.value_options = array['Mon', 'Fri']));
  insert into t_out values (10, case when n = 4 then 'ok' else 'BAD' end || ' typed values stored (number rounded, choices, yes/no, multi): ' || n || '/4');
  select count(*) into n from public.custom_field_values where field_id = fdays and value_options @> array['Fri'];
  insert into t_out values (11, case when n = 1 then 'ok' else 'BAD' end || ' multi-select is filterable: ' || n);
  perform public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(fvip, false, fshed, null));
  select count(*) into n from public.custom_field_values where record_id = cu;
  insert into t_out values (12, case when n = 2 then 'ok' else 'BAD' end || ' clearing values removes them (left ' || n || ')');
  begin perform public.save_custom_field_definition(c, fcap, jsonb_build_object('label', 'Capacity', 'field_type', 'text')); insert into t_out values (13, 'BAD: type changed with values');
  exception when others then insert into t_out values (13, 'ok type locked once used: ' || sqlerrm); end;
  begin insert into public.custom_field_values(company_id, field_id, entity, record_id, value_text) values (c, fshed, 'customers', cu, 'Hack'); insert into t_out values (14, 'BAD: direct value insert');
  exception when others then insert into t_out values (14, 'ok direct value insert blocked: ' || sqlerrm); end;

  -- ---------------------------------------------------------- 3. document templates
  insert into public.document_templates(company_id, doc_type, settings) values (c, 'SALES_INVOICE', '{"title":"Tax Invoice","terms":"No returns"}');
  select count(*) into n from public.document_templates where company_id = c;
  insert into t_out values (15, case when n = 1 then 'ok' else 'BAD' end || ' admin saved a template');
  begin insert into public.document_templates(company_id, doc_type, logo) values (c, 'DEFAULT', 'javascript:alert(1)'); insert into t_out values (16, 'BAD: non-image logo stored');
  exception when others then insert into t_out values (16, 'ok logo must be an image: ' || sqlerrm); end;

  -- ---------------------------------------------------------- 4. approval limits
  begin insert into public.approval_rules(company_id, doc_type, min_amount, approver_roles) values (c, 'PAYMENT_VOUCHER', 1, array['WAREHOUSE_STAFF']);
    insert into t_out values (39, 'BAD: role without the permission accepted as approver');
  exception when others then insert into t_out values (39, 'ok approver must already hold the permission: ' || sqlerrm); end;
  insert into public.approval_rules(company_id, doc_type, min_amount, approver_roles) values
    (c, 'PURCHASE_ORDER', 50000, array['ACCOUNTANT']), (c, 'PURCHASE_ORDER', 5000000, array['ADMINISTRATOR']),
    (c, 'SALES_ORDER', 100000, array['ADMINISTRATOR']), (c, 'PAYMENT_VOUCHER', 10000, array['ACCOUNTANT']);
  po := public.save_purchase_order(null, jsonb_build_object('company_id', c, 'supplier_id', sup), jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 100, 'unit_price', 600)));
  r := public.approval_status(c, 'PURCHASE_ORDER', po);
  insert into t_out values (17, case when (r->>'needed')::boolean and (r->>'amount')::numeric = 60000 and not (r->>'can_approve')::boolean then 'ok' else 'BAD' end || ' status: ' || r::text);
  begin perform public.set_purchase_order_status(po, 'APPROVE', null); insert into t_out values (18, 'BAD: admin approved above the accountant-only limit');
  exception when others then insert into t_out values (18, 'ok admin blocked above limit: ' || sqlerrm); end;
  so := public.save_sales_order(null, jsonb_build_object('company_id', c, 'customer_id', cu),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 3000, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 50)))));
  so2 := public.save_sales_order(null, jsonb_build_object('company_id', c, 'customer_id', cu),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 100, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 5)))));
  perform public.approve_sales_order(so2);
  select status into t from public.sales_orders where id = so2;
  insert into t_out values (19, case when t = 'APPROVED' then 'ok' else 'BAD' end || ' below the limit approves normally: ' || t);
  perform public.approve_sales_order(so);
  select status into t from public.sales_orders where id = so;
  insert into t_out values (20, case when t = 'APPROVED' then 'ok' else 'BAD' end || ' admin is the approver above PKR 100,000: ' || t);

  select id into bank from public.bank_accounts where company_id = c and is_active order by created_at limit 1;
  select id into exp from public.chart_of_accounts where company_id = c and account_type = 'EXPENSE' and not is_group order by code limit 1;
  pv := public.save_journal_entry(null, jsonb_build_object('company_id', c, 'entry_type', 'PAYMENT', 'entry_date', current_date, 'bank_account_id', bank, 'amount', 25000, 'memo', 'S12 rent'),
     jsonb_build_array(jsonb_build_object('account_id', exp, 'debit', 25000), jsonb_build_object('account_id', (select gl_account_id from public.bank_accounts where id = bank), 'credit', 25000)));
  so := public.save_sales_order(null, jsonb_build_object('company_id', c, 'customer_id', cu),
    jsonb_build_array(jsonb_build_object('product_id', prod, 'unit_price', 10, 'allocations', jsonb_build_array(jsonb_build_object('warehouse_id', wa, 'quantity', 1)))));

  -- ---------------------------------------------------------- 5. notifications (admin)
  r := public.refresh_my_notifications(c);
  select count(*) into n from public.notifications where user_id = ids.admin and resolved_at is null and rule_code = 'SO_APPROVAL' and dedupe_key = 'SO_APPROVAL:' || so;
  insert into t_out values (21, case when n = 1 then 'ok' else 'BAD' end || ' admin told about the SO awaiting approval (' || (r->>'new') || ' new)');
  select count(*) into n from public.notifications where user_id = ids.admin and resolved_at is null and rule_code = 'LOW_STOCK' and dedupe_key = 'LOW:' || prod;
  insert into t_out values (22, case when n = 1 then 'ok' else 'BAD' end || ' low stock notification for item below reorder level');
  select count(*) into n from public.notifications where user_id = ids.admin and rule_code = 'APPROVAL_LIMIT';
  insert into t_out values (23, case when n = 0 then 'ok' else 'BAD' end || ' admin NOT asked for accountant-only approvals: ' || n);
  r := public.refresh_my_notifications(c);
  insert into t_out values (24, case when (r->>'new')::int = 0 then 'ok' else 'BAD' end || ' refreshing again adds no duplicates (' || (r->>'new') || ')');
  perform public.mark_notifications_read(c, null);
  select count(*) into n from public.notifications where user_id = ids.admin and read_at is null;
  insert into t_out values (25, case when n = 0 then 'ok' else 'BAD' end || ' mark all read');
  perform public.save_notification_rule(c, 'LOW_STOCK', false, array['ADMINISTRATOR'], '{}');
  perform public.refresh_my_notifications(c);
  select count(*) into n from public.notifications where user_id = ids.admin and resolved_at is null and rule_code = 'LOW_STOCK';
  insert into t_out values (26, case when n = 0 then 'ok' else 'BAD' end || ' switching a rule off clears it');

  -- accountant: "needs your approval" for the PO above the limit, approves it; notification clears
  perform set_config('request.jwt.claims', json_build_object('sub', ids.acct, 'role', 'authenticated')::text, true);
  perform public.refresh_my_notifications(c);
  select count(*) into n from public.notifications where user_id = ids.acct and resolved_at is null and rule_code = 'APPROVAL_LIMIT' and dedupe_key like 'APPROVAL_LIMIT:' || po || ':%';
  insert into t_out values (27, case when n = 1 then 'ok' else 'BAD' end || ' accountant gets "needs your approval" for the PO above limit');
  select count(*) into n from public.notifications where user_id <> ids.acct;
  insert into t_out values (28, case when n = 0 then 'ok' else 'BAD' end || ' each user sees only their own notifications (others visible: ' || n || ')');
  perform public.set_purchase_order_status(po, 'APPROVE', null);
  select status into t from public.purchase_orders where id = po;
  insert into t_out values (29, case when t = 'APPROVED' then 'ok' else 'BAD' end || ' accountant approved above limit: ' || t);
  perform public.refresh_my_notifications(c);
  select count(*) into n from public.notifications where user_id = ids.acct and resolved_at is null and rule_code = 'APPROVAL_LIMIT' and dedupe_key like 'APPROVAL_LIMIT:' || po || ':%';
  insert into t_out values (30, case when n = 0 then 'ok' else 'BAD' end || ' approval notification cleared itself once approved');
  perform set_config('request.jwt.claims', json_build_object('sub', ids.admin, 'role', 'authenticated')::text, true);
  begin perform public.post_journal_entry(pv); insert into t_out values (31, 'BAD: admin posted payment above accountant-only limit');
  exception when others then insert into t_out values (31, 'ok payment voucher limit enforced: ' || sqlerrm); end;

  -- ---------------------------------------------------------- 6. other roles
  perform set_config('request.jwt.claims', json_build_object('sub', ids.acct, 'role', 'authenticated')::text, true);
  begin perform public.set_numbering_sequence(c, 'GDN', 'G-', 999, 5, false); insert into t_out values (32, 'BAD: accountant changed numbering');
  exception when others then insert into t_out values (32, 'ok accountant cannot change numbering: ' || sqlerrm); end;
  begin perform public.save_custom_field_definition(c, null, jsonb_build_object('entity', 'customers', 'label', 'X', 'field_type', 'text')); insert into t_out values (33, 'BAD: accountant added a field');
  exception when others then insert into t_out values (33, 'ok accountant cannot design fields: ' || sqlerrm); end;
  r := public.post_journal_entry(pv);
  insert into t_out values (40, case when r->>'status' = 'POSTED' then 'ok' else 'BAD' end || ' accountant posts the payment voucher above the limit');
  n := public.save_custom_field_values(c, 'customers', cu, jsonb_build_object(fcap, 30000));
  insert into t_out values (34, 'ok accountant (customers.manage) can fill custom fields');
  begin insert into public.approval_rules(company_id, doc_type, min_amount, approver_roles) values (c, 'SALES_ORDER', 1, array['ADMINISTRATOR']); insert into t_out values (35, 'BAD: accountant changed approval rules');
  exception when others then insert into t_out values (35, 'ok accountant cannot change approval rules: ' || sqlerrm); end;
  update public.document_templates set settings = '{}' where company_id = c;
  get diagnostics n = row_count;
  insert into t_out values (36, case when n = 0 then 'ok' else 'BAD' end || ' accountant cannot edit templates (' || n || ' rows)');
  if ids.sales is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', ids.sales, 'role', 'authenticated')::text, true);
    begin perform public.save_custom_field_values(c, 'suppliers', sup, '{}'); insert into t_out values (37, 'BAD: salesperson wrote supplier fields');
    exception when others then insert into t_out values (37, 'ok salesperson cannot write supplier fields: ' || sqlerrm); end;
    select count(*) into n from public.notifications;
    perform public.refresh_my_notifications(c);
    select count(*) into n from public.notifications where rule_code in ('BILL_DRAFT', 'PO_APPROVAL', 'PDC_DUE', 'PAYROLL_PENDING');
    insert into t_out values (38, case when n = 0 then 'ok' else 'BAD' end || ' salesperson gets no purchasing/finance notifications: ' || n);
  end if;
end $$;
select step, result from t_out order by step;
rollback;
