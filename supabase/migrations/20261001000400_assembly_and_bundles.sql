-- =====================================================================
-- JS Traders ERP — Stage 3b: components (BOM), assembly / disassembly, bundles
-- Spec refs: §8.6 assembly/disassembly, §8.7 bundles, §7.1 inventory tables
-- * product_components: what an assembled item or a bundle is made of.
--   A row with parent_variant_id = NULL applies to every variant; rows for a
--   specific variant replace the generic list for that variant.
-- * assembly_orders: ASSEMBLY consumes components (ASSEMBLY_OUT) and creates
--   the finished item (ASSEMBLY_IN) in one transaction; DISASSEMBLY is the
--   controlled reverse (DISASSEMBLY_OUT / DISASSEMBLY_IN).
--   Draft components live in assembly_orders.components (jsonb); posting
--   writes the immutable assembly_order_lines + stock movements.
-- * Bundles are commercial groupings: their availability is calculated from
--   component stock (product_buildable), never double-counted.
-- * Assembly labour (piece-rate) is Stage 6.5.
-- =====================================================================

-- ---------------------------------------------------------------- permission + numbering
insert into public.permissions(code, module, description, is_sensitive) values
  ('inventory.assemble','inventory','Create and post assembly / disassembly orders',false)
on conflict (code) do nothing;
insert into public.role_permissions(role_id, permission_code)
select r.id, 'inventory.assemble' from public.roles r where r.code in ('ADMINISTRATOR','WAREHOUSE_MANAGER')
on conflict do nothing;

insert into public.numbering_sequences(company_id, doc_type, prefix, padding, reset_yearly)
select c.id, 'ASSEMBLY_ORDER', 'ASM-', 5, true from public.companies c
on conflict do nothing;

-- ---------------------------------------------------------------- components (BOM)
create table public.product_components (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  parent_product_id     uuid not null references public.products(id),
  parent_variant_id     uuid references public.product_variants(id),
  component_product_id  uuid not null references public.products(id),
  component_variant_id  uuid references public.product_variants(id),
  quantity              numeric(18,4) not null check (quantity > 0),
  sort_order            int not null default 0,
  notes                 text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (parent_product_id <> component_product_id),
  constraint product_components_identity unique nulls not distinct
    (parent_product_id, parent_variant_id, component_product_id, component_variant_id)
);
create index product_components_parent_idx on public.product_components(parent_product_id, parent_variant_id);
create index product_components_component_idx on public.product_components(component_product_id);

create or replace function public.tg_product_component_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare par record; com record;
begin
  select id, company_id, name, is_assembled, is_bundle into par from public.products where id = new.parent_product_id;
  select id, company_id, name, has_variants, is_bundle into com from public.products where id = new.component_product_id;
  if par.company_id <> new.company_id or com.company_id <> new.company_id then
    raise exception 'Products belong to another company' using errcode = '42501';
  end if;
  if not (par.is_assembled or par.is_bundle) then
    raise exception '"%" is not marked as Assembled or Bundle, so it cannot have components', par.name using errcode = '22023';
  end if;
  if com.is_bundle then
    raise exception '"%" is a bundle and cannot be used as a component', com.name using errcode = '22023';
  end if;
  if new.parent_variant_id is not null and not exists
     (select 1 from public.product_variants v where v.id = new.parent_variant_id and v.product_id = new.parent_product_id) then
    raise exception 'Variant does not belong to "%"', par.name using errcode = '22023';
  end if;
  if com.has_variants and new.component_variant_id is null then
    raise exception '"%" has variants — choose the variant used', com.name using errcode = '23502';
  end if;
  if new.component_variant_id is not null and not exists
     (select 1 from public.product_variants v where v.id = new.component_variant_id and v.product_id = new.component_product_id) then
    raise exception 'Variant does not belong to "%"', com.name using errcode = '22023';
  end if;
  -- no loops: the component may not (directly or indirectly) contain the parent
  if exists (
    with recursive tree(pid) as (
      select new.component_product_id
      union
      select pc.component_product_id from public.product_components pc join tree t on pc.parent_product_id = t.pid
    ) select 1 from tree where pid = new.parent_product_id) then
    raise exception '"%" already contains "%" — components cannot loop', com.name, par.name using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.tg_product_component_check() from public, anon, authenticated;
create trigger component_check before insert or update on public.product_components
  for each row execute function public.tg_product_component_check();
create trigger stamp before insert or update on public.product_components for each row execute function public.tg_stamp_row();
create trigger audit after insert or update or delete on public.product_components for each row execute function public.tg_audit_row();

alter table public.product_components enable row level security;
create policy pc_select on public.product_components for select to authenticated
  using (public.has_permission(company_id, 'products.view') or public.has_permission(company_id, 'inventory.view'));
create policy pc_insert on public.product_components for insert to authenticated
  with check (public.has_permission(company_id, 'products.manage'));
create policy pc_update on public.product_components for update to authenticated
  using (public.has_permission(company_id, 'products.manage'))
  with check (public.has_permission(company_id, 'products.manage'));
create policy pc_delete on public.product_components for delete to authenticated
  using (public.has_permission(company_id, 'products.manage'));

-- Components for one product/variant: variant-specific list if defined, else the generic list
create or replace function public.product_bom(p_product_id uuid, p_variant_id uuid)
returns table (component_product_id uuid, component_variant_id uuid, quantity numeric, sort_order int)
language sql stable security invoker set search_path = '' as $$
  select pc.component_product_id, pc.component_variant_id, pc.quantity, pc.sort_order
  from public.product_components pc
  where pc.parent_product_id = p_product_id
    and pc.parent_variant_id is not distinct from (
      case when p_variant_id is not null and exists
             (select 1 from public.product_components x where x.parent_product_id = p_product_id and x.parent_variant_id = p_variant_id)
           then p_variant_id else null end)
  order by pc.sort_order, pc.created_at;
$$;
grant execute on function public.product_bom(uuid, uuid) to authenticated;

-- How many units can be made / sold from component stock, per warehouse (bundles + assembled items)
create or replace function public.product_buildable(p_product_id uuid, p_variant_id uuid)
returns table (warehouse_id uuid, buildable numeric)
language sql stable security invoker set search_path = '' as $$
  with bom as (select * from public.product_bom(p_product_id, p_variant_id)),
  wh as (select w.id from public.warehouses w
          where w.company_id = (select company_id from public.products where id = p_product_id) and w.is_active),
  per as (
    select wh.id as warehouse_id, b.component_product_id, b.component_variant_id,
           floor(greatest(coalesce(s.available, 0), 0) / b.quantity) as can_make
    from wh cross join bom b
    left join public.stock_on_hand s on s.warehouse_id = wh.id and s.product_id = b.component_product_id
                                    and s.variant_id is not distinct from b.component_variant_id
  )
  select warehouse_id, min(can_make) from per group by warehouse_id;
$$;
grant execute on function public.product_buildable(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- assembly orders
create table public.assembly_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  doc_no             text not null,
  doc_date           date not null default current_date,
  kind               text not null default 'ASSEMBLY' check (kind in ('ASSEMBLY','DISASSEMBLY')),
  warehouse_id       uuid not null references public.warehouses(id),
  product_id         uuid not null references public.products(id),
  variant_id         uuid references public.product_variants(id),
  quantity           numeric(18,4) not null check (quantity > 0),
  components         jsonb not null default '[]'::jsonb,   -- draft list [{product_id, variant_id, quantity}]
  status             text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED','REVERSED')),
  reference          text,
  notes              text,
  posted_at timestamptz, posted_by uuid,
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  idempotency_key    uuid unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (company_id, doc_no)
);
create index assembly_orders_list_idx on public.assembly_orders(company_id, status, doc_date desc);
create index assembly_orders_product_idx on public.assembly_orders(product_id, variant_id);

create table public.assembly_order_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  order_id      uuid not null references public.assembly_orders(id),
  line_no       int not null,
  product_id    uuid not null references public.products(id),
  variant_id    uuid references public.product_variants(id),
  quantity      numeric(18,4) not null check (quantity > 0),
  unique (order_id, line_no)
);
create index aol_order_idx on public.assembly_order_lines(order_id);

create trigger stamp before insert or update on public.assembly_orders for each row execute function public.tg_stamp_row();
create trigger audit after insert or update on public.assembly_orders for each row execute function public.tg_audit_row();
create trigger audit after insert on public.assembly_order_lines for each row execute function public.tg_audit_row();
alter table public.assembly_orders enable row level security;
alter table public.assembly_order_lines enable row level security;
revoke insert, update, delete on public.assembly_orders from authenticated, anon;
revoke insert, update, delete on public.assembly_order_lines from authenticated, anon;
create policy ao_select on public.assembly_orders for select to authenticated
  using (public.can_view_inventory(company_id, warehouse_id));
create policy aol_select on public.assembly_order_lines for select to authenticated
  using (exists (select 1 from public.assembly_orders h where h.id = order_id));

-- Save (create / edit draft). Empty p_components = use the product's component list x quantity.
create or replace function public.save_assembly_order(p_id uuid, p_header jsonb, p_components jsonb default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p_header->>'company_id')::uuid;
  v_wh uuid := (p_header->>'warehouse_id')::uuid;
  v_product uuid := (p_header->>'product_id')::uuid;
  v_variant uuid := nullif(p_header->>'variant_id','')::uuid;
  v_qty numeric := (p_header->>'quantity')::numeric;
  v_kind text := case when p_header->>'kind' = 'DISASSEMBLY' then 'DISASSEMBLY' else 'ASSEMBLY' end;
  v_id uuid; v_status text; v_comps jsonb := '[]'::jsonb; l jsonb; n int := 0; v_pname text; v_assembled boolean;
begin
  perform public.inv_require(v_company, 'inventory.assemble');
  perform public.inv_check_warehouse(v_company, v_wh);
  select name, is_assembled into v_pname, v_assembled from public.products where id = v_product and company_id = v_company;
  if v_pname is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if not v_assembled then
    raise exception '"%" is not marked as an Assembled item. Tick "Assembled item" on the product first.', v_pname using errcode = '22023';
  end if;
  perform public.inv_validate_line(v_company, v_wh, v_product, v_variant, null, v_qty, 0);

  if p_components is null or jsonb_array_length(p_components) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('product_id', b.component_product_id, 'variant_id', b.component_variant_id,
                                                 'quantity', b.quantity * v_qty) order by b.sort_order), '[]'::jsonb)
      into p_components from public.product_bom(v_product, v_variant) b;
  end if;
  for l in select * from jsonb_array_elements(p_components) loop
    n := n + 1;
    perform public.inv_validate_line(v_company, v_wh, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
      null, (l->>'quantity')::numeric, n);
    if (l->>'quantity')::numeric <= 0 then
      raise exception 'Component line %: quantity must be more than 0', n using errcode = '23514';
    end if;
    if (l->>'product_id')::uuid = v_product then
      raise exception 'Component line %: an item cannot be its own component', n using errcode = '22023';
    end if;
    v_comps := v_comps || jsonb_build_array(jsonb_build_object('product_id', l->>'product_id',
      'variant_id', nullif(l->>'variant_id',''), 'quantity', (l->>'quantity')::numeric));
  end loop;
  if n = 0 then
    raise exception '"%" has no components. Add them on the product (Components tab) or list them here.', v_pname using errcode = '23502';
  end if;

  if p_id is null then
    if p_idempotency_key is not null then
      select id into v_id from public.assembly_orders where idempotency_key = p_idempotency_key;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.assembly_orders(company_id, doc_no, doc_date, kind, warehouse_id, product_id, variant_id, quantity,
                                       components, reference, notes, idempotency_key)
    values (v_company, public.next_document_number(v_company, 'ASSEMBLY_ORDER'),
            coalesce((p_header->>'doc_date')::date, current_date), v_kind, v_wh, v_product, v_variant, v_qty,
            v_comps, p_header->>'reference', p_header->>'notes', p_idempotency_key)
    returning id into v_id;
  else
    select status into v_status from public.assembly_orders where id = p_id and company_id = v_company for update;
    if v_status is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
    if v_status <> 'DRAFT' then raise exception 'Only drafts can be edited (this one is %)', v_status using errcode = '22023'; end if;
    update public.assembly_orders set doc_date = coalesce((p_header->>'doc_date')::date, doc_date), kind = v_kind,
      warehouse_id = v_wh, product_id = v_product, variant_id = v_variant, quantity = v_qty, components = v_comps,
      reference = p_header->>'reference', notes = p_header->>'notes'
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.save_assembly_order(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_assembly_order(uuid, jsonb, jsonb, uuid) to authenticated;

-- Post: one atomic transaction
create or replace function public.post_assembly_order(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; l jsonb; n int := 0; v_line uuid; v_in text; v_out text;
begin
  select * into h from public.assembly_orders where id = p_id for update;
  if h.id is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.assemble');
  if h.status = 'POSTED' then return jsonb_build_object('status','POSTED','already',true); end if;
  if h.status <> 'DRAFT' then raise exception 'Cannot post a % order', h.status using errcode = '22023'; end if;
  perform public.inv_check_warehouse(h.company_id, h.warehouse_id);
  perform public.inv_validate_line(h.company_id, h.warehouse_id, h.product_id, h.variant_id, null, h.quantity, 0);

  if h.kind = 'ASSEMBLY' then v_out := 'ASSEMBLY_OUT'; v_in := 'ASSEMBLY_IN';
  else v_out := 'DISASSEMBLY_OUT'; v_in := 'DISASSEMBLY_IN'; end if;

  if h.kind = 'DISASSEMBLY' then   -- take the finished item apart first
    perform public.inv_issue_stock(h.company_id, h.doc_date, v_out, h.warehouse_id, null,
      h.product_id, h.variant_id, h.quantity, 'ASSEMBLY_ORDER', h.id, null, h.doc_no, 'Disassembly');
  end if;

  for l in select * from jsonb_array_elements(h.components) loop
    n := n + 1;
    insert into public.assembly_order_lines(company_id, order_id, line_no, product_id, variant_id, quantity)
    values (h.company_id, h.id, n, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric)
    returning id into v_line;
    perform public.inv_validate_line(h.company_id, h.warehouse_id, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
      null, (l->>'quantity')::numeric, n);
    if h.kind = 'ASSEMBLY' then
      perform public.inv_issue_stock(h.company_id, h.doc_date, v_out, h.warehouse_id, null,
        (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric,
        'ASSEMBLY_ORDER', h.id, v_line, h.doc_no, 'Used in assembly');
    else
      perform public.inv_apply_movement(h.company_id, h.doc_date, v_in, h.warehouse_id, null,
        (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid, (l->>'quantity')::numeric,
        'ASSEMBLY_ORDER', h.id, v_line, h.doc_no, 'Recovered from disassembly');
    end if;
  end loop;
  if n = 0 then raise exception 'No components on this order' using errcode = '23502'; end if;

  if h.kind = 'ASSEMBLY' then
    perform public.inv_apply_movement(h.company_id, h.doc_date, v_in, h.warehouse_id, null,
      h.product_id, h.variant_id, h.quantity, 'ASSEMBLY_ORDER', h.id, null, h.doc_no, 'Assembled');
  end if;

  update public.assembly_orders set status = 'POSTED', posted_at = now(), posted_by = auth.uid() where id = p_id;
  return jsonb_build_object('status','POSTED','components', n);
end $$;
revoke execute on function public.post_assembly_order(uuid) from public, anon;
grant execute on function public.post_assembly_order(uuid) to authenticated;

create or replace function public.cancel_assembly_order(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.assembly_orders where id = p_id for update;
  if h.id is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.assemble');
  if h.status <> 'DRAFT' then raise exception 'Only drafts can be cancelled. Posted orders must be reversed.' using errcode = '22023'; end if;
  update public.assembly_orders set status = 'CANCELLED' where id = p_id;
end $$;
revoke execute on function public.cancel_assembly_order(uuid) from public, anon;
grant execute on function public.cancel_assembly_order(uuid) to authenticated;

-- Reverse: equal and opposite movements (inbound legs first), original kept in history
create or replace function public.reverse_assembly_order(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h record; m record; v_count int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reverse a posted document' using errcode = '23502';
  end if;
  select * into h from public.assembly_orders where id = p_id for update;
  if h.id is null then raise exception 'Assembly order not found' using errcode = 'P0002'; end if;
  perform public.inv_require(h.company_id, 'inventory.post');
  if h.status = 'REVERSED' then return jsonb_build_object('status','REVERSED','already',true); end if;
  if h.status <> 'POSTED' then raise exception 'Only posted orders can be reversed' using errcode = '22023'; end if;
  -- inbound legs are undone first so a reversal never dips stock negative mid-way
  for m in select * from public.stock_movements
           where source_type = 'ASSEMBLY_ORDER' and source_id = p_id and reversal_of is null
           order by (quantity < 0), product_id, variant_id loop
    perform public.inv_apply_movement(m.company_id, current_date, m.movement_type, m.warehouse_id, m.location_id,
      m.product_id, m.variant_id, -m.quantity, 'ASSEMBLY_ORDER', p_id, m.source_line_id, h.doc_no,
      'REVERSAL: ' || p_reason, m.id);
    v_count := v_count + 1;
  end loop;
  update public.assembly_orders set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason
   where id = p_id;
  return jsonb_build_object('status','REVERSED','movements', v_count);
end $$;
revoke execute on function public.reverse_assembly_order(uuid, text) from public, anon;
grant execute on function public.reverse_assembly_order(uuid, text) to authenticated;
