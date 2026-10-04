-- Stage 8 (part 1) — stock valuation at moving average cost, and cost of goods sold
--
-- One average cost per item (and variant) for the whole company. Every stock movement gets a value:
--   * goods out (GDN, damage, count shortage, used in assembly) leave at the current average cost;
--   * goods received wait for their purchase cost ("pending") — the cost task / bill gives them a value later;
--   * other goods in (count surplus, found stock) come in at the average cost; opening stock at the cost entered;
--   * transfers between warehouses do not change value.
-- Each posted document's value change is put in the ledger once, when the transaction commits:
--   GDN → Dr Cost of Goods Sold / Cr Inventory; adjustments / counts → Inventory Adjustments; opening → Opening Balance Equity.
-- When a cost arrives after part of the goods were already sold, the sold part goes straight to Cost of Goods Sold.

insert into public.permissions(code, module, description, is_sensitive) values
  ('inventory.valuation', 'inventory', 'See stock values, average costs and cost of goods sold; set opening stock costs', true)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, 'inventory.valuation' from public.roles r where r.code in ('ADMINISTRATOR','OWNER','ACCOUNTANT')
on conflict do nothing;

-- import-cost accounts (used by landed cost)
insert into public.chart_of_accounts(company_id, code, name, account_type, parent_id, is_group, system_key, description)
select c.company_id, '1360', 'Landed Cost Clearing', 'ASSET', c.parent_id, false, 'LANDED_COST_CLEARING', 'Import charges billed, waiting to be added to stock cost'
from public.chart_of_accounts c
where c.system_key = 'GRNI'
  and not exists (select 1 from public.chart_of_accounts x where x.company_id = c.company_id and x.system_key = 'LANDED_COST_CLEARING')
  and not exists (select 1 from public.chart_of_accounts x where x.company_id = c.company_id and x.code = '1360');
insert into public.chart_of_accounts(company_id, code, name, account_type, parent_id, is_group, system_key, description)
select c.company_id, '2160', 'Accrued Import Costs', 'LIABILITY', c.parent_id, false, 'LANDED_COST_ACCRUAL', 'Estimated import charges added to stock cost, not yet billed'
from public.chart_of_accounts c
where c.system_key = 'PDC_PAYABLE'
  and not exists (select 1 from public.chart_of_accounts x where x.company_id = c.company_id and x.system_key = 'LANDED_COST_ACCRUAL')
  and not exists (select 1 from public.chart_of_accounts x where x.company_id = c.company_id and x.code = '2160');

-- ───────── average cost per item ─────────
create table if not exists public.item_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  qty numeric not null default 0,           -- on hand, all warehouses
  pending_qty numeric not null default 0,   -- received, purchase cost not known yet (not in the average)
  value numeric not null default 0,         -- PKR value of the costed part
  last_cost numeric,                        -- last known unit cost (PKR)
  updated_at timestamptz not null default now(),
  constraint item_costs_identity unique nulls not distinct (company_id, product_id, variant_id)
);
alter table public.item_costs enable row level security;
create policy item_costs_select on public.item_costs for select to authenticated using (public.has_permission(company_id, 'inventory.valuation'));

-- value of each stock movement (stock_movements itself is append-only)
create table if not exists public.stock_valuations (
  movement_id uuid primary key references public.stock_movements(id),
  company_id uuid not null,
  seq bigint generated always as identity,
  done boolean not null default false,
  unit_cost numeric,
  value numeric,                 -- signed PKR: + into stock, − out of stock
  counter_key text,              -- ledger account the value change goes against (COGS, INVENTORY_ADJUSTMENT, OPENING_BALANCE) — null: none
  gl_entry_id uuid references public.journal_entries(id),
  valued_at timestamptz
);
create index if not exists sv_waiting on public.stock_valuations(seq) where not done;
alter table public.stock_valuations enable row level security;
create policy sv_select on public.stock_valuations for select to authenticated using (public.has_permission(company_id, 'inventory.valuation'));

-- cost arriving later / landed cost / opening cost — the history of value changes that are not stock movements
create table if not exists public.item_cost_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  event_date date not null default current_date,
  product_id uuid not null,
  variant_id uuid,
  kind text not null check (kind in ('PENDING','UNCOST','REVALUE','OPENING')),
  qty numeric not null,
  amount numeric not null,          -- total PKR
  to_inventory numeric not null,    -- part that stays in stock value
  to_cogs numeric not null,         -- part for goods already sold
  source_type text, source_id uuid, note text,
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index if not exists ice_item on public.item_cost_events(company_id, product_id, variant_id, created_at);
alter table public.item_cost_events enable row level security;
create policy ice_select on public.item_cost_events for select to authenticated using (public.has_permission(company_id, 'inventory.valuation'));

alter table public.stock_adjustment_lines add column if not exists unit_cost numeric check (unit_cost is null or unit_cost >= 0);

-- ───────── starting point: what is on hand now, valued from the costed receipts ─────────
insert into public.stock_valuations(movement_id, company_id, done, valued_at)
select m.id, m.company_id, true, now() from public.stock_movements m
where not exists (select 1 from public.stock_valuations v where v.movement_id = m.id);

insert into public.item_costs(company_id, product_id, variant_id, qty, pending_qty, value, last_cost)
select b.company_id, b.product_id, b.variant_id, b.q,
  greatest(b.q - least(b.q, coalesce(c.cq, 0)), 0),
  case when c.cq > 0 then round(least(b.q, c.cq) * c.cv / c.cq, 2) else 0 end,
  c.last_unit
from (select company_id, product_id, variant_id, sum(on_hand) q from public.stock_balances group by 1, 2, 3) b
left join lateral (
  select sum(l.quantity) cq, sum(l.quantity * l.unit_cost_pkr) cv,
    (array_agg(l.unit_cost_pkr order by g.doc_date desc, g.created_at desc))[1] last_unit
  from public.goods_receipt_lines l join public.goods_receipts g on g.id = l.receipt_id
  where g.company_id = b.company_id and g.status = 'POSTED' and l.product_id = b.product_id and l.variant_id is not distinct from b.variant_id and l.unit_cost_pkr is not null
) c on true
where b.q <> 0
on conflict on constraint item_costs_identity do nothing;
update public.item_costs set value = 0 where qty <= 0;

-- ───────── helpers ─────────
create or replace function public.inv_cost_row(p_company uuid, p_product uuid, p_variant uuid)
returns public.item_costs language plpgsql security definer set search_path = '' as $$
declare r public.item_costs;
begin
  select * into r from public.item_costs where company_id = p_company and product_id = p_product and variant_id is not distinct from p_variant for update;
  if r.id is null then
    insert into public.item_costs(company_id, product_id, variant_id) values (p_company, p_product, p_variant)
    on conflict on constraint item_costs_identity do nothing;
    select * into r from public.item_costs where company_id = p_company and product_id = p_product and variant_id is not distinct from p_variant for update;
  end if;
  return r;
end $$;

/** average unit cost now (costed stock), else the last known cost */
create or replace function public.inv_avg_cost(p_company uuid, p_product uuid, p_variant uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when qty - pending_qty > 0 then value / (qty - pending_qty) else last_cost end
  from public.item_costs where company_id = p_company and product_id = p_product and variant_id is not distinct from p_variant;
$$;

/** move an amount between Inventory and Cost of Goods Sold (positive: Inventory → COGS) */
create or replace function public.inv_cogs_reclass(p_company uuid, p_date date, p_amount numeric, p_memo text, p_source_type text, p_source_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv uuid := public.hr_account(p_company, 'INVENTORY'); v_cogs uuid := public.hr_account(p_company, 'COGS'); a numeric := round(coalesce(p_amount, 0), 2);
begin
  if a = 0 then return null; end if;
  return public.acc_post_document_entry(p_company, 'SYSTEM', coalesce(p_date, current_date), p_memo, null, null, null, null, abs(a),
    case when a > 0 then jsonb_build_array(
        jsonb_build_object('account_id', v_cogs, 'debit', a, 'description', p_memo),
        jsonb_build_object('account_id', v_inv, 'credit', a, 'description', 'Cost of goods already sold'))
      else jsonb_build_array(
        jsonb_build_object('account_id', v_inv, 'debit', -a, 'description', p_memo),
        jsonb_build_object('account_id', v_cogs, 'credit', -a, 'description', 'Cost of goods already sold')) end,
    p_source_type, p_source_id);
end $$;

/**
 * A value change that is not a stock movement. The source has already put p_amount on the Inventory account.
 *   PENDING — goods that were waiting for a cost now have one (receipt cost approved / bill posted)
 *   UNCOST  — the opposite (a bill that gave the cost is reversed); p_amount is negative
 *   REVALUE — more / less cost on goods that already had one (landed cost, bill price difference)
 * The part for goods no longer in stock goes to Cost of Goods Sold. Returns that part.
 */
create or replace function public.inv_value_in(p_company uuid, p_product uuid, p_variant uuid, p_kind text, p_qty numeric, p_amount numeric,
  p_date date, p_source_type text, p_source_id uuid, p_note text, p_post boolean default true)
returns numeric language plpgsql security definer set search_path = '' as $$
declare r public.item_costs; c numeric; k numeric; v_inv numeric; v_cogs numeric; v_je uuid; a numeric := round(coalesce(p_amount, 0), 2); q numeric := coalesce(p_qty, 0);
begin
  -- stock moved earlier in this same transaction is valued first
  if exists (select 1 from public.stock_valuations where not done) then perform public.inv_value_flush(); end if;
  r := public.inv_cost_row(p_company, p_product, p_variant);
  c := greatest(r.qty - r.pending_qty, 0);
  if p_kind in ('PENDING','OPENING') then
    k := least(greatest(q, 0), greatest(r.pending_qty, 0));
    v_inv := case when q > 0 then round(a * k / q, 2) else a end;
    update public.item_costs set pending_qty = pending_qty - k, value = value + v_inv,
      last_cost = case when q > 0 and a >= 0 then a / q else last_cost end, updated_at = now() where id = r.id;
  elsif p_kind = 'UNCOST' then
    k := least(greatest(q, 0), c);
    v_inv := case when q > 0 then round(a * k / q, 2) else a end;
    update public.item_costs set pending_qty = pending_qty + k, value = value + v_inv, updated_at = now() where id = r.id;
  else
    v_inv := case when c <= 0 then 0 when q <= 0 or c >= q then a else round(a * c / q, 2) end;
    update public.item_costs set value = value + v_inv, updated_at = now() where id = r.id;
  end if;
  -- costed stock all gone: nothing can stay in its value
  select * into r from public.item_costs where id = r.id;
  if r.qty - r.pending_qty <= 0 and r.value <> 0 then
    v_inv := v_inv - r.value;
    update public.item_costs set value = 0 where id = r.id;
  end if;
  v_cogs := a - v_inv;
  if p_post and v_cogs <> 0 then
    v_je := public.inv_cogs_reclass(p_company, p_date, v_cogs, coalesce(p_note, 'Cost of goods already sold'), 'STOCK_VALUE', p_source_id);
  end if;
  insert into public.item_cost_events(company_id, event_date, product_id, variant_id, kind, qty, amount, to_inventory, to_cogs, source_type, source_id, note, journal_entry_id)
  values (p_company, coalesce(p_date, current_date), p_product, p_variant, p_kind, q, a, v_inv, v_cogs, p_source_type, p_source_id, p_note, v_je);
  return v_cogs;
end $$;

-- ───────── valuing stock movements ─────────
create or replace function public.tg_stock_value_queue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stock_valuations(movement_id, company_id) values (new.id, new.company_id);
  return null;
end $$;
create trigger stock_value_queue after insert on public.stock_movements for each row execute function public.tg_stock_value_queue();

create or replace function public.inv_value_flush() returns void
language plpgsql security definer set search_path = '' as $$
declare q record; m record; r public.item_costs; c numeric; x numeric; tc numeric; tp numeric; val numeric; unit numeric; v_key text;
  v_batch timestamptz := clock_timestamp(); g record; v_je uuid; v_total numeric; v_w numeric; v_wsum numeric; v_assigned numeric; v_last boolean;
  gl record; v_memo text;
begin
  for q in select * from public.stock_valuations where not done order by seq for update loop
    select * into m from public.stock_movements where id = q.movement_id;
    val := 0; unit := null; v_key := null;

    if m.source_type in ('STOCK_TRANSFER','LOCATION_SETTING') then
      -- moving between warehouses / shelves: company value unchanged
      unit := public.inv_avg_cost(m.company_id, m.product_id, m.variant_id);
      update public.stock_valuations set done = true, unit_cost = unit, value = 0, valued_at = v_batch where movement_id = m.id;
      continue;
    end if;

    r := public.inv_cost_row(m.company_id, m.product_id, m.variant_id);
    c := greatest(r.qty - r.pending_qty, 0);

    if m.quantity < 0 then
      x := -m.quantity;
      if m.source_type = 'GOODS_RECEIPT' then
        -- receipt reversed: its own cost leaves (the cost entry is reversed with the receipt)
        select l.unit_cost_pkr into unit from public.goods_receipt_lines l where l.id = m.source_line_id;
        if unit is null then
          update public.item_costs set qty = qty - x, pending_qty = greatest(pending_qty - x, 0), updated_at = now() where id = r.id;
          val := 0;
        else
          val := round(x * unit, 2);
          update public.item_costs set qty = qty - x, value = value - val, updated_at = now() where id = r.id;
        end if;
      else
        tc := least(x, c); tp := x - tc;
        val := case when tc <= 0 then 0 when tc >= c then r.value else round(r.value * tc / c, 2) end;
        update public.item_costs set qty = qty - x, pending_qty = greatest(pending_qty - tp, 0), value = value - val, updated_at = now() where id = r.id;
        unit := case when x > 0 then val / x end;
      end if;
      val := -val;
    else
      x := m.quantity;
      if m.reversal_of is not null and exists (select 1 from public.stock_valuations v where v.movement_id = m.reversal_of and v.value is not null) then
        -- undoing an issue: back at the cost it left with
        select -v.value into val from public.stock_valuations v where v.movement_id = m.reversal_of;
        update public.item_costs set qty = qty + x, value = value + val, updated_at = now() where id = r.id;
      elsif m.source_type = 'GOODS_RECEIPT' then
        update public.item_costs set qty = qty + x, pending_qty = pending_qty + x, updated_at = now() where id = r.id;
        val := 0;
      elsif m.movement_type in ('ASSEMBLY_IN','DISASSEMBLY_IN') then
        select -coalesce(sum(v.value), 0) into v_total from public.stock_valuations v join public.stock_movements o on o.id = v.movement_id
         where o.source_type = m.source_type and o.source_id = m.source_id and o.quantity < 0 and o.reversal_of is null and v.done
           and o.movement_type = case m.movement_type when 'ASSEMBLY_IN' then 'ASSEMBLY_OUT' else 'DISASSEMBLY_OUT' end;
        if v_total <= 0 then
          update public.item_costs set qty = qty + x, pending_qty = pending_qty + x, updated_at = now() where id = r.id;
          val := 0;
        else
          -- share by quantity × reference cost (assembly has one product: share by quantity)
          v_w := x * case when m.movement_type = 'DISASSEMBLY_IN' then coalesce(nullif(public.inv_avg_cost(m.company_id, m.product_id, m.variant_id), 0), 1) else 1 end;
          select coalesce(sum(o.quantity * case when m.movement_type = 'DISASSEMBLY_IN' then coalesce(nullif(public.inv_avg_cost(o.company_id, o.product_id, o.variant_id), 0), 1) else 1 end), 0),
                 coalesce(sum(v.value) filter (where v.done), 0),
                 count(*) filter (where not v.done and o.id <> m.id) = 0
            into v_wsum, v_assigned, v_last
            from public.stock_movements o join public.stock_valuations v on v.movement_id = o.id
           where o.source_type = m.source_type and o.source_id = m.source_id and o.movement_type = m.movement_type and o.quantity > 0 and o.reversal_of is null;
          val := case when v_last then v_total - v_assigned when v_wsum > 0 then round(v_total * v_w / v_wsum, 2) else 0 end;
          update public.item_costs set qty = qty + x, value = value + val, updated_at = now() where id = r.id;
        end if;
        v_key := 'INVENTORY_ADJUSTMENT';
      else
        -- other stock found / opening stock
        if m.source_type = 'STOCK_ADJUSTMENT' then
          select l.unit_cost into unit from public.stock_adjustment_lines l where l.id = m.source_line_id;
        end if;
        if unit is null and m.movement_type <> 'OPENING' then
          unit := case when c > 0 then r.value / c else r.last_cost end;
        end if;
        if unit is null then
          update public.item_costs set qty = qty + x, pending_qty = pending_qty + x, updated_at = now() where id = r.id;
          val := 0;
        else
          val := round(x * unit, 2);
          update public.item_costs set qty = qty + x, value = value + val, last_cost = case when m.movement_type = 'OPENING' then unit else last_cost end, updated_at = now() where id = r.id;
        end if;
      end if;
      unit := case when x > 0 and val <> 0 then val / x else unit end;
    end if;

    if v_key is null then
      v_key := case
        when m.source_type = 'GOODS_RECEIPT' then null
        when m.source_type = 'GDN' then 'COGS'
        when m.movement_type = 'OPENING' then 'OPENING_BALANCE'
        else 'INVENTORY_ADJUSTMENT' end;
    end if;
    update public.stock_valuations set done = true, unit_cost = unit, value = val, counter_key = v_key, valued_at = v_batch where movement_id = m.id;
  end loop;

  -- one ledger entry per document and account
  for g in select o.company_id, o.source_type, o.source_id, min(o.source_doc_no) doc_no, o.movement_date, v.counter_key, sum(v.value) total, array_agg(o.id) ids
             from public.stock_valuations v join public.stock_movements o on o.id = v.movement_id
            where v.valued_at = v_batch and v.counter_key is not null and v.value <> 0
            group by o.company_id, o.source_type, o.source_id, o.movement_date, v.counter_key loop
    v_total := round(g.total, 2);
    if v_total = 0 then continue; end if;
    v_memo := case g.counter_key when 'COGS' then 'Cost of goods sold ' when 'OPENING_BALANCE' then 'Opening stock value ' else 'Stock value change ' end || coalesce(g.doc_no, '');
    v_je := public.acc_post_document_entry(g.company_id, 'SYSTEM', g.movement_date, v_memo, g.doc_no, null, null, null, abs(v_total),
      case when v_total < 0 then jsonb_build_array(
          jsonb_build_object('account_id', public.hr_account(g.company_id, g.counter_key), 'debit', -v_total, 'description', v_memo),
          jsonb_build_object('account_id', public.hr_account(g.company_id, 'INVENTORY'), 'credit', -v_total, 'description', 'Stock out ' || coalesce(g.doc_no, '')))
        else jsonb_build_array(
          jsonb_build_object('account_id', public.hr_account(g.company_id, 'INVENTORY'), 'debit', v_total, 'description', 'Stock in ' || coalesce(g.doc_no, '')),
          jsonb_build_object('account_id', public.hr_account(g.company_id, g.counter_key), 'credit', v_total, 'description', v_memo)) end,
      'STOCK_VALUE', g.source_id);
    update public.stock_valuations set gl_entry_id = v_je where movement_id = any(g.ids);
  end loop;
end $$;

create or replace function public.tg_stock_value_flush() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.stock_valuations where not done) then perform public.inv_value_flush(); end if;
  return null;
end $$;
create constraint trigger stock_value_flush after insert on public.stock_valuations deferrable initially deferred
  for each row execute function public.tg_stock_value_flush();

-- ───────── costs that arrive later ─────────
-- receipt cost approved (cost task): the waiting goods get their value
create or replace function public.tg_receipt_line_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g public.goods_receipts;
begin
  if old.unit_cost is null and new.unit_cost is not null and new.cost_source = 'COST_TASK' then
    select * into g from public.goods_receipts where id = new.receipt_id;
    perform public.inv_value_in(new.company_id, new.product_id, new.variant_id, 'PENDING', new.quantity, round(new.quantity * coalesce(new.unit_cost_pkr, 0), 2),
      current_date, 'GOODS_RECEIPT', g.id, 'Purchase cost ' || g.doc_no || ' — part already sold');
  end if;
  return null;
end $$;
create trigger receipt_line_cost after update of unit_cost on public.goods_receipt_lines for each row execute function public.tg_receipt_line_cost();

-- supplier bill posted / reversed
create or replace function public.tg_bill_value() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  if new.status = 'POSTED' and old.status = 'DRAFT' then
    for l in select * from public.supplier_bill_lines where bill_id = new.id and kind = 'ITEM' loop
      if l.receipt_value_pkr is not null then
        perform public.inv_value_in(new.company_id, l.product_id, l.variant_id, 'REVALUE', l.quantity, l.amount_pkr - l.receipt_value_pkr,
          new.bill_date, 'SUPPLIER_BILL', new.id, 'Bill ' || new.doc_no || ' price difference — part already sold');
      else
        perform public.inv_value_in(new.company_id, l.product_id, l.variant_id, 'PENDING', l.quantity, l.amount_pkr,
          new.bill_date, 'SUPPLIER_BILL', new.id, 'Bill ' || new.doc_no || ' cost — part already sold');
      end if;
    end loop;
  elsif new.status = 'REVERSED' and old.status = 'POSTED' then
    for l in select * from public.supplier_bill_lines where bill_id = new.id and kind = 'ITEM' loop
      if l.receipt_value_pkr is not null then
        perform public.inv_value_in(new.company_id, l.product_id, l.variant_id, 'REVALUE', l.quantity, -(l.amount_pkr - l.receipt_value_pkr),
          current_date, 'SUPPLIER_BILL', new.id, 'Bill ' || new.doc_no || ' reversed');
      else
        perform public.inv_value_in(new.company_id, l.product_id, l.variant_id, 'UNCOST', l.quantity, -l.amount_pkr,
          current_date, 'SUPPLIER_BILL', new.id, 'Bill ' || new.doc_no || ' reversed');
      end if;
    end loop;
  end if;
  return null;
end $$;
create trigger bill_value after update of status on public.supplier_bills for each row execute function public.tg_bill_value();

-- supplier_bill_lines need product / variant for ITEM lines (post_supplier_bill stores them from the receipt line when missing)
create or replace function public.tg_bill_line_item() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'ITEM' and new.product_id is null and new.receipt_line_id is not null then
    select product_id, variant_id into new.product_id, new.variant_id from public.goods_receipt_lines where id = new.receipt_line_id;
  end if;
  return new;
end $$;
create trigger bill_line_item before insert on public.supplier_bill_lines for each row execute function public.tg_bill_line_item();

-- ───────── opening stock cost / stock waiting for a cost that no receipt will give ─────────
create or replace function public.inv_receipt_pending_qty(p_company uuid, p_product uuid, p_variant uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.quantity - l.billed_qty), 0) from public.goods_receipt_lines l join public.goods_receipts g on g.id = l.receipt_id
  where g.company_id = p_company and g.status = 'POSTED' and l.product_id = p_product and l.variant_id is not distinct from p_variant and l.unit_cost is null;
$$;

-- p_lines: [{product_id, variant_id, unit_cost}] — values the waiting quantity that is not from an uncosted receipt
create or replace function public.set_opening_stock_cost(p_company uuid, p_date date, p_lines jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l jsonb; r public.item_costs; v_q numeric; v_amt numeric; v_total numeric := 0; v_je uuid; n int := 0;
begin
  perform public.inv_require(p_company, 'inventory.valuation');
  perform public.inv_require(p_company, 'journals.create');
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    n := n + 1;
    if nullif(l->>'unit_cost','') is null then continue; end if;
    if (l->>'unit_cost')::numeric < 0 then raise exception 'Line %: cost cannot be negative', n using errcode = '23514'; end if;
    r := public.inv_cost_row(p_company, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid);
    v_q := least(r.pending_qty, greatest(r.pending_qty - public.inv_receipt_pending_qty(p_company, r.product_id, r.variant_id), 0));
    if v_q <= 0 then continue; end if;
    v_amt := round(v_q * (l->>'unit_cost')::numeric, 2);
    perform public.inv_value_in(p_company, r.product_id, r.variant_id, 'OPENING', v_q, v_amt, coalesce(p_date, current_date), 'OPENING_COST', null, 'Opening stock cost', false);
    v_total := v_total + v_amt;
  end loop;
  if v_total > 0 then
    v_je := public.acc_post_document_entry(p_company, 'SYSTEM', coalesce(p_date, current_date), coalesce(nullif(trim(p_note),''), 'Opening stock value'), null, null, null, null, v_total,
      jsonb_build_array(
        jsonb_build_object('account_id', public.hr_account(p_company, 'INVENTORY'), 'debit', v_total, 'description', 'Opening stock value'),
        jsonb_build_object('account_id', public.hr_account(p_company, 'OPENING_BALANCE'), 'credit', v_total, 'description', 'Opening stock value')),
      'OPENING_COST', null);
    update public.item_cost_events set journal_entry_id = v_je where company_id = p_company and source_type = 'OPENING_COST' and journal_entry_id is null and created_at = now();
  end if;
  return v_je;
end $$;

-- ───────── reading ─────────
create or replace function public.stock_valuation(p_company uuid)
returns table(product_id uuid, variant_id uuid, sku text, product_name text, variant_name text, uom text, qty numeric, pending_qty numeric,
  receipt_pending_qty numeric, avg_cost numeric, value numeric, last_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.inv_require(p_company, 'inventory.valuation');
  return query
  select c.product_id, c.variant_id, p.sku, p.name, v.name, u.code, c.qty, c.pending_qty,
    public.inv_receipt_pending_qty(p_company, c.product_id, c.variant_id),
    case when c.qty - c.pending_qty > 0 then round(c.value / (c.qty - c.pending_qty), 4) else c.last_cost end,
    round(c.value, 2), c.last_cost
  from public.item_costs c join public.products p on p.id = c.product_id left join public.product_variants v on v.id = c.variant_id
  left join public.units_of_measure u on u.id = p.base_uom_id
  where c.company_id = p_company and (c.qty <> 0 or c.value <> 0)
  order by p.name, v.name;
end $$;

create or replace function public.stock_valuation_totals(p_company uuid)
returns table(stock_value numeric, ledger_value numeric, difference numeric, items_waiting int)
language plpgsql stable security definer set search_path = '' as $$
declare v_s numeric; v_l numeric; v_w int; v_acc uuid;
begin
  perform public.inv_require(p_company, 'inventory.valuation');
  select coalesce(round(sum(value), 2), 0), count(*) filter (where pending_qty > 0) into v_s, v_w from public.item_costs where company_id = p_company;
  v_acc := public.hr_account(p_company, 'INVENTORY');
  select coalesce(sum(jl.debit - jl.credit), 0) into v_l from public.journal_lines jl where jl.company_id = p_company and jl.account_id = v_acc;
  return query select v_s, v_l, v_l - v_s, v_w;
end $$;

-- one-off: make the Inventory account agree with the stock value (difference → Inventory Adjustments)
create or replace function public.align_inventory_ledger(p_company uuid, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t record; v_je uuid;
begin
  perform public.inv_require(p_company, 'inventory.valuation');
  perform public.inv_require(p_company, 'journals.create');
  select * into t from public.stock_valuation_totals(p_company);
  if round(t.difference, 2) = 0 then return null; end if;
  v_je := public.acc_post_document_entry(p_company, 'SYSTEM', coalesce(p_date, current_date), 'Inventory account brought in line with stock value', null, null, null, null, abs(t.difference),
    case when t.difference > 0 then jsonb_build_array(
        jsonb_build_object('account_id', public.hr_account(p_company, 'INVENTORY_ADJUSTMENT'), 'debit', t.difference, 'description', 'Stock value alignment'),
        jsonb_build_object('account_id', public.hr_account(p_company, 'INVENTORY'), 'credit', t.difference, 'description', 'Stock value alignment'))
      else jsonb_build_array(
        jsonb_build_object('account_id', public.hr_account(p_company, 'INVENTORY'), 'debit', -t.difference, 'description', 'Stock value alignment'),
        jsonb_build_object('account_id', public.hr_account(p_company, 'INVENTORY_ADJUSTMENT'), 'credit', -t.difference, 'description', 'Stock value alignment')) end,
    'STOCK_VALUE', null);
  return v_je;
end $$;

/** cost of goods sold per invoice line (from the GDN lines it was made from) */
create or replace function public.invoice_cogs(p_invoice_id uuid)
returns table(line_id uuid, product_id uuid, variant_id uuid, quantity numeric, cogs numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.sales_invoices where id = p_invoice_id;
  perform public.inv_require(v_company, 'inventory.valuation');
  return query
  select l.id, l.product_id, l.variant_id, l.quantity,
    round(sum((s->>'qty')::numeric * coalesce(u.unit, 0)), 2)
  from public.sales_invoice_lines l
  cross join lateral jsonb_array_elements(coalesce(l.sources, '[]'::jsonb)) s
  left join lateral (
    select -sum(v.value) / nullif(sum(-m.quantity), 0) unit
    from public.stock_movements m join public.stock_valuations v on v.movement_id = m.id
    where m.source_type = 'GDN' and m.source_line_id = (s->>'gdn_line_id')::uuid and m.reversal_of is null and m.quantity < 0 and v.value is not null
  ) u on true
  where l.invoice_id = p_invoice_id
  group by l.id, l.product_id, l.variant_id, l.quantity;
end $$;

revoke all on function public.inv_cost_row(uuid,uuid,uuid), public.inv_cogs_reclass(uuid,date,numeric,text,text,uuid),
  public.inv_value_in(uuid,uuid,uuid,text,numeric,numeric,date,text,uuid,text,boolean), public.inv_value_flush() from public, anon, authenticated;
revoke all on function public.set_opening_stock_cost(uuid,date,jsonb,text), public.stock_valuation(uuid), public.stock_valuation_totals(uuid),
  public.align_inventory_ledger(uuid,date), public.invoice_cogs(uuid) from anon;
