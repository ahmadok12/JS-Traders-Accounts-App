-- =====================================================================
-- JS Traders ERP — Stage 1: Platform foundation
-- Spec refs: §2.1 invariants, §6 security, §7.1 access/core, §22, §23
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------

-- Stamps created_*/updated_* columns server-side; never trusts client values.
create or replace function public.tg_stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Companies / branches
-- ---------------------------------------------------------------------
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name          text not null check (length(trim(name)) > 0),
  legal_name    text,
  base_currency text not null default 'PKR',
  ntn           text,
  strn          text,
  phone         text,
  email         text,
  address       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  code        text not null,
  name        text not null check (length(trim(name)) > 0),
  address     text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, code)
);
create index branches_company_idx on public.branches(company_id);

-- ---------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  full_name           text,
  phone               text,
  default_company_id  uuid references public.companies(id),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------
create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z_]{2,40}$'),
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.permissions (
  code         text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module       text not null,
  description  text not null,
  is_sensitive boolean not null default false
);

create table public.role_permissions (
  role_id          uuid not null references public.roles(id) on delete cascade,
  permission_code  text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);
create index role_permissions_perm_idx on public.role_permissions(permission_code);

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     uuid not null references public.roles(id),
  company_id  uuid not null references public.companies(id),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (user_id, role_id, company_id)
);
create index user_roles_user_company_idx on public.user_roles(user_id, company_id);

-- ---------------------------------------------------------------------
-- Audit log (append-only; written only by triggers / definer functions)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  company_id      uuid,
  user_id         uuid,
  action          text not null,
  entity_type     text not null,
  entity_id       text,
  old_value       jsonb,
  new_value       jsonb,
  changed_fields  text[],
  request_id      text,
  created_at      timestamptz not null default now()
);
create index audit_logs_entity_idx  on public.audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_company_idx on public.audit_logs(company_id, created_at desc);
create index audit_logs_user_idx    on public.audit_logs(user_id, created_at desc);

-- Generic row audit trigger. Records INSERT/UPDATE/DELETE with diff.
create or replace function public.tg_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_req text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(k) into v_changed
    from jsonb_object_keys(v_new) k
    where k not in ('updated_at','updated_by')
      and (v_new -> k) is distinct from (v_old -> k);
    if v_changed is null then
      return new; -- no material change
    end if;
  end if;

  begin
    v_req := current_setting('request.headers', true)::jsonb ->> 'x-request-id';
  exception when others then v_req := null;
  end;

  insert into public.audit_logs(company_id, user_id, action, entity_type, entity_id,
                                old_value, new_value, changed_fields, request_id)
  values (
    case when tg_table_name = 'companies' then (v_row->>'id')::uuid
         else nullif(v_row->>'company_id','')::uuid end,
    auth.uid(),
    tg_op,
    tg_table_name,
    v_row->>'id',
    v_old, v_new, v_changed, v_req
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Authorization helpers (STABLE, SECURITY DEFINER, used by RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.has_permission(p_company_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.profiles p on p.id = ur.user_id and p.is_active
    where ur.user_id = auth.uid()
      and ur.company_id = p_company_id
      and rp.permission_code = p_permission
  );
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id and p.is_active
    where ur.user_id = auth.uid() and ur.company_id = p_company_id
  );
$$;

-- Permissions snapshot for the UI (UI hiding is convenience only; RLS enforces).
create or replace function public.my_access()
returns table (company_id uuid, company_name text, role_codes text[], permissions text[])
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.name,
         array_agg(distinct r.code order by r.code),
         coalesce(array_agg(distinct rp.permission_code) filter (where rp.permission_code is not null), '{}')
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id and p.is_active
  join public.companies c on c.id = ur.company_id and c.is_active
  join public.roles r on r.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = ur.role_id
  where ur.user_id = auth.uid()
  group by c.id, c.name
  order by c.name;
$$;

-- ---------------------------------------------------------------------
-- Numbering sequences (row-locked, gap-tolerant, per company + doc type)
-- ---------------------------------------------------------------------
create table public.numbering_sequences (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  doc_type     text not null check (doc_type ~ '^[A-Z_]{2,40}$'),
  prefix       text not null default '',
  next_number  bigint not null default 1 check (next_number > 0),
  padding      int not null default 5 check (padding between 1 and 12),
  reset_yearly boolean not null default false,
  current_year int,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (company_id, doc_type)
);

create or replace function public.next_document_number(p_company_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.numbering_sequences%rowtype;
  v_year int := extract(year from now())::int;
  v_num bigint;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not authorized for company' using errcode = '42501';
  end if;

  select * into s from public.numbering_sequences
  where company_id = p_company_id and doc_type = p_doc_type
  for update;

  if not found then
    insert into public.numbering_sequences(company_id, doc_type, prefix, next_number, current_year)
    values (p_company_id, p_doc_type, p_doc_type || '-', 1, v_year)
    returning * into s;
  end if;

  if s.reset_yearly and coalesce(s.current_year, v_year) <> v_year then
    s.next_number := 1;
  end if;

  v_num := s.next_number;
  update public.numbering_sequences
     set next_number = v_num + 1, current_year = v_year
   where id = s.id;

  return s.prefix
         || case when s.reset_yearly then v_year::text || '-' else '' end
         || lpad(v_num::text, s.padding, '0');
end $$;

-- ---------------------------------------------------------------------
-- System settings (typed values stay relational elsewhere; this is config)
-- ---------------------------------------------------------------------
create table public.system_settings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  key         text not null,
  value       jsonb not null,
  description text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (company_id, key)
);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger stamp before insert or update on public.companies          for each row execute function public.tg_stamp_row();
create trigger stamp before insert or update on public.branches           for each row execute function public.tg_stamp_row();
create trigger stamp before insert or update on public.numbering_sequences for each row execute function public.tg_stamp_row();
create trigger stamp before insert or update on public.system_settings    for each row execute function public.tg_stamp_row();

create trigger audit after insert or update or delete on public.companies           for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.branches            for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.profiles            for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.user_roles          for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.role_permissions    for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.numbering_sequences for each row execute function public.tg_audit_row();
create trigger audit after insert or update or delete on public.system_settings     for each row execute function public.tg_audit_row();

create or replace function public.tg_profiles_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  -- only security admins (via RPC) may change is_active; block self-escalation
  if new.is_active is distinct from old.is_active
     and coalesce(current_setting('app.allow_profile_status', true), '') <> 'on' then
    raise exception 'is_active can only be changed through set_user_active()' using errcode = '42501';
  end if;
  new.id := old.id;
  new.email := old.email;
  return new;
end $$;
create trigger touch before update on public.profiles for each row execute function public.tg_profiles_touch();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.companies           enable row level security;
alter table public.branches            enable row level security;
alter table public.profiles            enable row level security;
alter table public.roles               enable row level security;
alter table public.permissions         enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.user_roles          enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.numbering_sequences enable row level security;
alter table public.system_settings     enable row level security;

create policy companies_select on public.companies for select to authenticated
  using (public.is_company_member(id));
create policy companies_update on public.companies for update to authenticated
  using (public.has_permission(id, 'settings.manage'))
  with check (public.has_permission(id, 'settings.manage'));

create policy branches_select on public.branches for select to authenticated
  using (public.is_company_member(company_id));
create policy branches_insert on public.branches for insert to authenticated
  with check (public.has_permission(company_id, 'settings.manage'));
create policy branches_update on public.branches for update to authenticated
  using (public.has_permission(company_id, 'settings.manage'))
  with check (public.has_permission(company_id, 'settings.manage'));

-- A user sees their own profile, plus profiles of people in companies where
-- they hold users.view.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = profiles.id
        and public.has_permission(ur.company_id, 'users.view')
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy roles_select on public.roles for select to authenticated using (true);
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission(company_id, 'users.view'));

create policy audit_select on public.audit_logs for select to authenticated
  using (company_id is not null and public.has_permission(company_id, 'audit.view'));

create policy numbering_select on public.numbering_sequences for select to authenticated
  using (public.is_company_member(company_id));
create policy numbering_update on public.numbering_sequences for update to authenticated
  using (public.has_permission(company_id, 'settings.manage'))
  with check (public.has_permission(company_id, 'settings.manage'));
create policy numbering_insert on public.numbering_sequences for insert to authenticated
  with check (public.has_permission(company_id, 'settings.manage'));

create policy settings_select on public.system_settings for select to authenticated
  using (public.is_company_member(company_id));
create policy settings_write on public.system_settings for insert to authenticated
  with check (public.has_permission(company_id, 'settings.manage'));
create policy settings_update on public.system_settings for update to authenticated
  using (public.has_permission(company_id, 'settings.manage'))
  with check (public.has_permission(company_id, 'settings.manage'));

-- ---------------------------------------------------------------------
-- Security RPCs (all role changes go through these; audited by trigger)
-- ---------------------------------------------------------------------
create or replace function public.assign_role(p_user_id uuid, p_role_code text, p_company_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_role uuid;
begin
  if not public.has_permission(p_company_id, 'security.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select id into v_role from public.roles where code = p_role_code;
  if v_role is null then raise exception 'unknown role %', p_role_code; end if;
  insert into public.user_roles(user_id, role_id, company_id, created_by)
  values (p_user_id, v_role, p_company_id, auth.uid())
  on conflict (user_id, role_id, company_id) do nothing;
end $$;

create or replace function public.revoke_role(p_user_id uuid, p_role_code text, p_company_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_admins int;
begin
  if not public.has_permission(p_company_id, 'security.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_role_code = 'ADMINISTRATOR' then
    select count(*) into v_admins from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where r.code = 'ADMINISTRATOR' and ur.company_id = p_company_id;
    if v_admins <= 1 then
      raise exception 'cannot remove the last administrator';
    end if;
  end if;
  delete from public.user_roles ur using public.roles r
   where r.id = ur.role_id and r.code = p_role_code
     and ur.user_id = p_user_id and ur.company_id = p_company_id;
end $$;

create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own active status';
  end if;
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user_id and public.has_permission(ur.company_id, 'security.manage')
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform set_config('app.allow_profile_status', 'on', true);
  update public.profiles set is_active = p_active where id = p_user_id;
end $$;

-- Lists auth users without any role so an admin can onboard them.
create or replace function public.list_unassigned_users()
returns table (id uuid, email text, full_name text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.created_at
  from public.profiles p
  where not exists (select 1 from public.user_roles ur where ur.user_id = p.id)
    and exists (
      select 1 from public.user_roles me
      where me.user_id = auth.uid() and public.has_permission(me.company_id, 'security.manage')
    )
  order by p.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- New auth user -> profile. The very first user becomes Administrator.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_company uuid; v_role uuid;
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  if not exists (select 1 from public.user_roles) then
    select id into v_company from public.companies order by created_at limit 1;
    select id into v_role from public.roles where code = 'ADMINISTRATOR';
    if v_company is not null and v_role is not null then
      insert into public.user_roles(user_id, role_id, company_id) values (new.id, v_role, v_company);
      update public.profiles set default_company_id = v_company where id = new.id;
    end if;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lock down function execution
revoke execute on function public.tg_audit_row() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on all functions in schema public from anon;
