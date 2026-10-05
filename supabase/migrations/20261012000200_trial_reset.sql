-- Trial reset: wipe every transaction of one company (stock, orders, dispatches, receipts, returns, invoices, bills, payments,
-- cheques, payroll runs, ledger) while keeping all master data (products, warehouses, customers, suppliers, chart of accounts,
-- banks, agents, employees, users, roles, settings, saved reports). Document numbers restart at 1.
-- Administrators only, and only when the exact confirmation text "RESET <company code>" is typed. The audit log is kept.

-- append-only tables may be emptied only by this reset (flag is transaction-local and only honoured for the function owner)
create or replace function public.tg_immutable() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if left(tg_op, 1) = 'D' and current_user = 'postgres' and current_setting('app.trial_reset', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only; post a reversal instead', tg_table_name using errcode = '42501';
end $fn$;

create or replace function public.reset_trial_transactions(p_company uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_code text; t text; v_n bigint; v_out jsonb := '{}'::jsonb; v_left text[]; v_pass int := 0; v_err text;
  v_tables text[] := array[
    'pdc_events','pdc_records','bank_matches','bank_statement_lines','bank_statement_imports','bank_reconciliations',
    'supplier_bill_allocations','receipt_allocations',
    'sales_return_lines','sales_returns','purchase_return_lines','purchase_returns',
    'import_costs','landed_cost_line_uses','landed_cost_allocations','landed_cost_targets','landed_cost_charges','landed_costs',
    'shipment_events','shipment_lines','shipment_containers','shipments',
    'fx_payments','currency_conversions','payment_agent_transactions',
    'supplier_bill_lines','supplier_bills','purchase_cost_task_events','purchase_cost_task_lines','purchase_cost_tasks',
    'goods_receipt_po_links','goods_receipt_shipment_links','receipt_check_lines',
    'price_task_events','price_task_lines','price_tasks',
    'sales_invoice_lines','sales_invoices',
    'picking_task_events','picking_task_assignees','picking_task_lines','picking_tasks','warehouse_job_assignees','staff_notifications',
    'gdn_lines','gdns','reservations','reservation_orders',
    'sales_order_line_warehouse_allocations','sales_order_lines','sales_orders','quotation_lines','quotations',
    'purchase_order_lines','purchase_orders','assembly_order_lines','assembly_orders',
    'stock_count_lines','stock_counts','stock_transfer_lines','stock_transfers','stock_adjustment_lines','stock_adjustments',
    'goods_receipt_lines','goods_receipts','doc_unit_plans',
    'stock_valuations','item_cost_events','item_costs','stock_movements','stock_balances','physical_units',
    'payroll_payments','payroll_lines','payroll_runs','employee_advance_transactions','employee_advances','employee_pay_items','employee_leave_requests',
    'audit_log_price_overrides','journal_lines','journal_entries'];
  v_masters text[] := array['CUSTOMER','CUSTOMER_GROUP','EMPLOYEE','PAYMENT_AGENT','PRODUCT','SUPPLIER','WAREHOUSE','BANK_ACCOUNT'];
begin
  select code into v_code from public.companies where id = p_company;
  if v_code is null then raise exception 'Company not found' using errcode = 'P0002'; end if;
  if not public.has_permission(p_company, 'security.manage') or not exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
        where ur.user_id = auth.uid() and ur.company_id = p_company and r.code = 'ADMINISTRATOR') then
    raise exception 'Only an administrator can reset trial data' using errcode = '42501';
  end if;
  if coalesce(trim(p_confirm), '') <> 'RESET ' || v_code then
    raise exception 'Type RESET % exactly to confirm', v_code using errcode = '22023';
  end if;

  perform set_config('app.trial_reset', 'on', true);
  -- documents that point at each other both ways
  update public.sales_orders set source_quotation_id = null, source_reservation_order_id = null where company_id = p_company;
  update public.quotations set sales_order_id = null where company_id = p_company;
  update public.reservation_orders set converted_sales_order_id = null where company_id = p_company;
  -- the rest point one way: delete in passes until everything is gone
  v_left := v_tables;
  while array_length(v_left, 1) > 0 and v_pass < 12 loop
    v_pass := v_pass + 1;
    foreach t in array v_left loop
      begin
        execute format('delete from public.%I where company_id = $1', t) using p_company;
        get diagnostics v_n = row_count;
        v_out := v_out || jsonb_build_object(t, coalesce((v_out->>t)::bigint, 0) + v_n);
        v_left := array_remove(v_left, t);
      exception when foreign_key_violation then
        v_err := sqlerrm;   -- something still points at it; next pass
      end;
    end loop;
  end loop;
  if array_length(v_left, 1) > 0 then
    raise exception 'Could not clear: % (%)', array_to_string(v_left, ', '), v_err;
  end if;

  delete from public.customer_product_prices where company_id = p_company and source_type = 'INVOICE';
  delete from public.attachments where company_id = p_company and entity_type = any(v_tables);
  update public.numbering_sequences set next_number = 1 where company_id = p_company and doc_type <> all(v_masters);
  perform set_config('app.trial_reset', 'off', true);

  insert into public.audit_logs(company_id, user_id, action, entity_type, entity_id, new_value)
  values (p_company, auth.uid(), 'TRIAL_RESET', 'companies', p_company::text, jsonb_build_object('deleted', v_out));
  return jsonb_build_object('deleted', v_out, 'passes', v_pass);
end $fn$;
revoke execute on function public.reset_trial_transactions(uuid, text) from public, anon;
grant execute on function public.reset_trial_transactions(uuid, text) to authenticated;
