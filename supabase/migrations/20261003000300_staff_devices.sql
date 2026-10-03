-- Android picking app: each phone registers a random device key while its user is signed in.
-- The app's background "on duty" service uses that key (not the user's login session) to poll for new
-- notifications every few seconds and to acknowledge them, so the alarm rings even when the app is closed.
create table if not exists public.staff_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id),
  token_hash   text not null unique,
  device_name  text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists sd_user_idx on public.staff_devices(user_id) where revoked_at is null;
alter table public.staff_devices enable row level security;
revoke all on public.staff_devices from anon;  -- writes only through the functions below (RLS has no write policies)
create policy sd_select on public.staff_devices for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.staff_device_hash(p_token text)
returns text language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(coalesce(p_token,''), 'UTF8')), 'hex') $$;
revoke execute on function public.staff_device_hash(text) from public, anon, authenticated;

-- signed-in user registers this phone (key made by the phone, at least 32 chars)
create or replace function public.register_staff_device(p_token text, p_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if length(coalesce(p_token,'')) < 32 then raise exception 'Bad device key' using errcode = '22023'; end if;
  insert into public.staff_devices(user_id, token_hash, device_name, last_seen_at)
  values (auth.uid(), public.staff_device_hash(p_token), left(p_name, 120), now())
  on conflict (token_hash) do update set user_id = excluded.user_id, revoked_at = null, last_seen_at = now(), device_name = excluded.device_name;
end $$;
revoke execute on function public.register_staff_device(text, text) from public, anon;
grant execute on function public.register_staff_device(text, text) to authenticated;

-- the phone's background service: unread notifications of the device's user (last 2 days)
create or replace function public.device_poll(p_token text)
returns table (id uuid, kind text, urgent boolean, title text, body text, task_id uuid, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  select * into d from public.staff_devices where token_hash = public.staff_device_hash(p_token) and revoked_at is null;
  if d.id is null then raise exception 'Device not registered' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where profiles.id = d.user_id and is_active) then raise exception 'Account disabled' using errcode = '42501'; end if;
  update public.staff_devices set last_seen_at = now() where staff_devices.id = d.id;
  return query select n.id, n.kind, n.urgent, n.title, n.body, n.task_id, n.created_at from public.staff_notifications n
    where n.user_id = d.user_id and n.read_at is null and n.created_at > now() - interval '2 days'
    order by n.created_at limit 30;
end $$;
revoke execute on function public.device_poll(text) from public;
grant execute on function public.device_poll(text) to anon, authenticated;

-- the phone acknowledges (ACCEPT on the alarm screen)
create or replace function public.device_ack(p_token text, p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d record; r record;
begin
  select * into d from public.staff_devices where token_hash = public.staff_device_hash(p_token) and revoked_at is null;
  if d.id is null then raise exception 'Device not registered' using errcode = '42501'; end if;
  for r in update public.staff_notifications set read_at = now()
           where user_id = d.user_id and read_at is null and (p_ids is null or staff_notifications.id = any(p_ids))
           returning * loop
    if r.kind = 'TASK_ASSIGNED' and r.task_id is not null then
      update public.picking_task_assignees set acknowledged_at = coalesce(acknowledged_at, now())
       where task_id = r.task_id and user_id = d.user_id and removed_at is null and acknowledged_at is null;
    end if;
  end loop;
end $$;
revoke execute on function public.device_ack(text, uuid[]) from public;
grant execute on function public.device_ack(text, uuid[]) to anon, authenticated;

-- sign-out / off duty
create or replace function public.unregister_staff_device(p_token text)
returns void language sql security definer set search_path = '' as $$
  update public.staff_devices set revoked_at = now() where token_hash = public.staff_device_hash(p_token) and revoked_at is null;
$$;
revoke execute on function public.unregister_staff_device(text) from public;
grant execute on function public.unregister_staff_device(text) to anon, authenticated;
