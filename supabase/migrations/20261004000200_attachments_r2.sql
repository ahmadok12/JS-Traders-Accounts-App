-- Stage 5 — attachments on documents and vouchers (Cloudflare R2, private bucket, short-lived signed URLs)
-- The browser never sees R2 keys: the `attachments` edge function asks these functions (as the signed-in user)
-- whether the user may upload / open a file, then signs a 10-minute URL for that one object.

insert into public.role_permissions(role_id, permission_code)
select r.id, 'attachments.manage' from public.roles r where r.code in ('OWNER','SALESPERSON')
on conflict do nothing;

-- which documents can carry files, and the permission needed to see that document
create or replace function public.attachment_entity_ok(p_entity_type text) returns boolean
language sql immutable set search_path = '' as $$
  select p_entity_type in ('journal_entries','sales_invoices','quotations','sales_orders','gdns','goods_receipts','stock_adjustments',
                           'stock_transfers','stock_counts','assembly_orders','reservation_orders','price_tasks','customers','suppliers','products');
$$;

create or replace function public.attachment_entity_company(p_entity_type text, p_entity_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if not public.attachment_entity_ok(p_entity_type) then return null; end if;
  execute format('select company_id from public.%I where id = $1', p_entity_type) into v using p_entity_id;
  return v;
end $$;

create or replace function public.attachment_can_view(p_company uuid, p_entity_type text, p_entity_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_entity_type in ('goods_receipts','stock_counts')
     and public.wh_job_is_assignee(case p_entity_type when 'goods_receipts' then 'RECEIPT' else 'COUNT' end, p_entity_id) then
    return true;
  end if;
  if not public.has_permission(p_company, 'attachments.view') then return false; end if;
  return case p_entity_type
    when 'journal_entries'    then public.has_permission(p_company, 'journals.view')
    when 'sales_invoices'     then public.has_permission(p_company, 'sales.view_prices')
    when 'quotations'         then public.has_permission(p_company, 'sales.view_prices')
    when 'price_tasks'        then public.has_permission(p_company, 'sales.view_prices') or exists (select 1 from public.price_tasks t where t.id = p_entity_id and t.assigned_to = auth.uid())
    when 'sales_orders'       then public.has_permission(p_company, 'sales.view')
    when 'gdns'               then public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'inventory.view')
    when 'reservation_orders' then public.has_permission(p_company, 'sales.view') or public.has_permission(p_company, 'inventory.view')
    when 'customers'          then public.can_access_customer(p_entity_id)
    when 'suppliers'          then public.has_permission(p_company, 'suppliers.view')
    when 'products'           then true
    else public.has_permission(p_company, 'inventory.view')   -- receipts, adjustments, transfers, counts, assembly
  end;
end $$;

create or replace function public.attachment_can_add(p_company uuid, p_entity_type text, p_entity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_entity_type in ('goods_receipts','stock_counts')
          and public.wh_job_is_assignee(case p_entity_type when 'goods_receipts' then 'RECEIPT' else 'COUNT' end, p_entity_id))
      or (public.has_permission(p_company, 'attachments.manage') and public.attachment_can_view(p_company, p_entity_type, p_entity_id));
$$;

alter policy attachments_select on public.attachments
  using (deleted_at is null and upload_status = 'UPLOADED' and public.attachment_can_view(company_id, entity_type, entity_id));

create index if not exists attachments_entity on public.attachments(entity_type, entity_id) where deleted_at is null;

-- step 1 (edge function, as the user): reserve the object key
create or replace function public.attachment_begin(p_entity_type text, p_entity_id uuid, p_file_name text, p_mime text, p_size bigint,
  p_bucket text, p_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_id uuid := gen_random_uuid(); v_name text; v_key text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v_company := public.attachment_entity_company(p_entity_type, p_entity_id);
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if not public.attachment_can_add(v_company, p_entity_type, p_entity_id) then
    raise exception 'You cannot add files to this document' using errcode = '42501';
  end if;
  if coalesce(p_size, 0) <= 0 then raise exception 'The file is empty' using errcode = '22023'; end if;
  if p_size > 25 * 1024 * 1024 then raise exception 'Files can be up to 25 MB' using errcode = '22023'; end if;
  if not (p_mime like 'image/%' or p_mime in ('application/pdf', 'text/plain', 'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/zip')) then
    raise exception 'This file type is not allowed (photos, PDF, Excel, Word, CSV, ZIP only)' using errcode = '22023';
  end if;
  if (select count(*) from public.attachments where entity_type = p_entity_type and entity_id = p_entity_id and deleted_at is null and upload_status <> 'FAILED') >= 50 then
    raise exception 'A document can carry up to 50 files' using errcode = '22023';
  end if;
  v_name := left(regexp_replace(coalesce(nullif(trim(p_file_name), ''), 'file'), '[^A-Za-z0-9._-]+', '_', 'g'), 120);
  v_key := v_company || '/' || p_entity_type || '/' || p_entity_id || '/' || v_id || '-' || v_name;
  insert into public.attachments(id, company_id, entity_type, entity_id, file_name, original_file_name, mime_type, file_size,
    r2_bucket, r2_object_key, description, upload_status, optimization_status, uploaded_by, uploaded_at)
  values (v_id, v_company, p_entity_type, p_entity_id, v_name, left(coalesce(nullif(trim(p_file_name), ''), 'file'), 250), p_mime, p_size,
    p_bucket, v_key, nullif(trim(p_description), ''), 'PENDING', 'NOT_APPLICABLE', auth.uid(), now());
  return jsonb_build_object('id', v_id, 'key', v_key);
end $$;

-- step 2 (edge function, after checking the object really is in R2)
create or replace function public.attachment_confirm(p_id uuid, p_size bigint, p_ok boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.attachments;
begin
  select * into a from public.attachments where id = p_id for update;
  if a.id is null or a.uploaded_by is distinct from auth.uid() then raise exception 'Upload not found' using errcode = 'P0002'; end if;
  if a.upload_status <> 'PENDING' then return; end if;
  update public.attachments set upload_status = case when p_ok then 'UPLOADED' else 'FAILED' end,
    file_size = coalesce(p_size, file_size), uploaded_at = now() where id = p_id;
end $$;

-- where the uploader's own pending file should be (to check it arrived)
create or replace function public.attachment_pending_key(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('bucket', a.r2_bucket, 'key', a.r2_object_key) from public.attachments a
  where a.id = p_id and a.uploaded_by = auth.uid() and a.upload_status = 'PENDING';
$$;
revoke all on function public.attachment_pending_key(uuid) from anon;

-- opening a file: returns where it is if the user may see it
create or replace function public.attachment_locate(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.attachments;
begin
  select * into a from public.attachments where id = p_id and upload_status = 'UPLOADED' and deleted_at is null;
  if a.id is null or not public.attachment_can_view(a.company_id, a.entity_type, a.entity_id) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('bucket', a.r2_bucket, 'key', a.r2_object_key, 'name', a.original_file_name, 'mime', a.mime_type);
end $$;

-- removing a file hides it (the object stays in R2 for audit)
create or replace function public.attachment_remove(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.attachments;
begin
  select * into a from public.attachments where id = p_id for update;
  if a.id is null or a.deleted_at is not null then raise exception 'File not found' using errcode = 'P0002'; end if;
  if not (a.uploaded_by = auth.uid() and public.attachment_can_view(a.company_id, a.entity_type, a.entity_id))
     and not (public.has_permission(a.company_id, 'attachments.manage') and public.attachment_can_view(a.company_id, a.entity_type, a.entity_id)) then
    raise exception 'You cannot remove this file' using errcode = '42501';
  end if;
  update public.attachments set deleted_at = now(), deleted_by = auth.uid(),
    description = coalesce(description || ' · ', '') || coalesce('removed: ' || nullif(trim(p_reason), ''), 'removed')
  where id = p_id;
end $$;

-- how many files each document has (list badges)
create or replace function public.attachment_counts(p_entity_type text, p_ids uuid[])
returns table(entity_id uuid, n int) language sql stable set search_path = '' as $$
  select a.entity_id, count(*)::int from public.attachments a
  where a.entity_type = p_entity_type and a.entity_id = any(p_ids) and a.deleted_at is null and a.upload_status = 'UPLOADED'
  group by a.entity_id;
$$;

revoke all on function public.attachment_begin(text,uuid,text,text,bigint,text,text), public.attachment_confirm(uuid,bigint,boolean),
  public.attachment_locate(uuid), public.attachment_remove(uuid,text), public.attachment_counts(text,uuid[]),
  public.attachment_entity_company(text,uuid), public.attachment_can_view(uuid,text,uuid), public.attachment_can_add(uuid,text,uuid) from anon;

alter table public.attachments replica identity full;
alter publication supabase_realtime add table public.attachments;
