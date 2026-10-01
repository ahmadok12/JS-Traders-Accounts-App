-- Variant SKU is optional: blank → <product SKU>-01, -02, … (first free number).
create or replace function public.tg_variant_auto_sku()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_base text; n int := 0; v_try text;
begin
  if new.sku is null or length(trim(new.sku)) = 0 then
    select sku into v_base from public.products where id = new.product_id;
    select count(*) into n from public.product_variants where product_id = new.product_id;
    loop
      n := n + 1;
      v_try := v_base || '-' || lpad(n::text, 2, '0');
      exit when not exists (select 1 from public.product_variants where company_id = new.company_id and sku = v_try);
    end loop;
    new.sku := v_try;
  end if;
  return new;
end $$;
revoke execute on function public.tg_variant_auto_sku() from public, anon, authenticated;

-- runs after company_from_product (alphabetical: "company…" < "variant…")
create trigger variant_auto_sku before insert on public.product_variants
  for each row execute function public.tg_variant_auto_sku();
