-- Archive the pre-spec prototype schema (sprints 1-4) into legacy_v1.
-- Non-destructive: every object is moved, not dropped. legacy_v1 is not
-- exposed through the Data API. Drop it once no longer needed.

create schema if not exists legacy_v1;
revoke all on schema legacy_v1 from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;

do $$
declare r record;
begin
  -- views first (they depend on tables)
  for r in select viewname from pg_views where schemaname = 'public' loop
    execute format('alter view public.%I set schema legacy_v1', r.viewname);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I set schema legacy_v1', r.tablename);
  end loop;
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f','p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter routine %s set schema legacy_v1', r.sig);
  end loop;
  for r in
    select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e','d')
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('alter type public.%I set schema legacy_v1', r.typname);
  end loop;
end $$;
