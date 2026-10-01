-- =====================================================================
-- JS Traders ERP — Parties that are both customer AND supplier
-- ---------------------------------------------------------------------
-- * customers.is_also_supplier / suppliers.is_also_customer (default ON
--   for new records). When ON, a matching record is created on the other
--   side (or an existing unlinked one with the same name is linked).
-- * customers.linked_supplier_id <-> suppliers.linked_customer_id (1:1).
-- * Shared identity/contact fields stay in sync both ways.
-- * Turning the flag OFF unlinks the two records (neither is deleted or
--   deactivated; ledgers stay separate).
-- * Creating the counterpart needs the other side's manage permission.
-- =====================================================================

alter table public.customers
  add column is_also_supplier   boolean not null default false,
  add column linked_supplier_id uuid unique references public.suppliers(id);
alter table public.customers alter column is_also_supplier set default true;

alter table public.suppliers
  add column is_also_customer   boolean not null default false,
  add column linked_customer_id uuid unique references public.customers(id);
alter table public.suppliers alter column is_also_customer set default true;

-- ---------------------------------------------------------------- customer side
create or replace function public.tg_customer_supplier_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sup uuid;
begin
  -- changes made by the counterpart trigger itself must not bounce back
  if pg_trigger_depth() > 1 then return new; end if;

  if new.is_also_supplier and new.linked_supplier_id is null then
    if not public.has_permission(new.company_id, 'suppliers.manage') then
      raise exception 'You do not have permission to create suppliers. Untick "Also a supplier" to save this customer only.'
        using errcode = '42501';
    end if;
    select s.id into v_sup from public.suppliers s
     where s.company_id = new.company_id and s.linked_customer_id is null
       and lower(trim(s.name)) = lower(trim(new.name))
     order by s.created_at limit 1;
    if v_sup is null then
      insert into public.suppliers (company_id, name, contact_person, phone, whatsapp, email, city, address, ntn,
                                    default_currency, payment_terms_days, is_also_customer, linked_customer_id)
      values (new.company_id, new.name, new.contact_person, new.phone, new.whatsapp, new.email, new.city, new.address, new.ntn,
              new.default_currency, new.payment_terms_days, true, new.id)
      returning id into v_sup;
    else
      update public.suppliers set is_also_customer = true, linked_customer_id = new.id where id = v_sup;
    end if;
    update public.customers set linked_supplier_id = v_sup where id = new.id;

  elsif not new.is_also_supplier and new.linked_supplier_id is not null then
    update public.suppliers set is_also_customer = false, linked_customer_id = null where id = new.linked_supplier_id;
    update public.customers set linked_supplier_id = null where id = new.id;

  elsif tg_op = 'UPDATE' and new.linked_supplier_id is not null and (
        new.name, new.contact_person, new.phone, new.whatsapp, new.email, new.city, new.address, new.ntn)
        is distinct from (
        old.name, old.contact_person, old.phone, old.whatsapp, old.email, old.city, old.address, old.ntn) then
    update public.suppliers set name = new.name, contact_person = new.contact_person, phone = new.phone,
           whatsapp = new.whatsapp, email = new.email, city = new.city, address = new.address, ntn = new.ntn
     where id = new.linked_supplier_id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_customer_supplier_link() from public, anon, authenticated;

create trigger party_link after insert or update on public.customers
  for each row execute function public.tg_customer_supplier_link();

-- ---------------------------------------------------------------- supplier side
create or replace function public.tg_supplier_customer_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cus uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  if new.is_also_customer and new.linked_customer_id is null then
    if not public.has_permission(new.company_id, 'customers.manage') then
      raise exception 'You do not have permission to create customers. Untick "Also a customer" to save this supplier only.'
        using errcode = '42501';
    end if;
    select c.id into v_cus from public.customers c
     where c.company_id = new.company_id and c.linked_supplier_id is null
       and lower(trim(c.name)) = lower(trim(new.name))
     order by c.created_at limit 1;
    if v_cus is null then
      insert into public.customers (company_id, name, contact_person, phone, whatsapp, email, city, address, ntn,
                                    default_currency, payment_terms_days, is_also_supplier, linked_supplier_id)
      values (new.company_id, new.name, new.contact_person, new.phone, new.whatsapp, new.email, new.city, new.address, new.ntn,
              'PKR', new.payment_terms_days, true, new.id)
      returning id into v_cus;
    else
      update public.customers set is_also_supplier = true, linked_supplier_id = new.id where id = v_cus;
    end if;
    update public.suppliers set linked_customer_id = v_cus where id = new.id;

  elsif not new.is_also_customer and new.linked_customer_id is not null then
    update public.customers set is_also_supplier = false, linked_supplier_id = null where id = new.linked_customer_id;
    update public.suppliers set linked_customer_id = null where id = new.id;

  elsif tg_op = 'UPDATE' and new.linked_customer_id is not null and (
        new.name, new.contact_person, new.phone, new.whatsapp, new.email, new.city, new.address, new.ntn)
        is distinct from (
        old.name, old.contact_person, old.phone, old.whatsapp, old.email, old.city, old.address, old.ntn) then
    update public.customers set name = new.name, contact_person = new.contact_person, phone = new.phone,
           whatsapp = new.whatsapp, email = new.email, city = new.city, address = new.address, ntn = new.ntn
     where id = new.linked_customer_id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_supplier_customer_link() from public, anon, authenticated;

create trigger party_link after insert or update on public.suppliers
  for each row execute function public.tg_supplier_customer_link();

-- Customers/suppliers use column-level SELECT grants (sensitive columns hidden),
-- so new columns must be granted explicitly.
grant select (is_also_supplier, linked_supplier_id) on public.customers to authenticated;
grant select (is_also_customer, linked_customer_id) on public.suppliers to authenticated;
