-- =====================================================================
-- JS Traders ERP — tell the manager when a picker has not accepted a task
--   A picker who has not pressed ACCEPT (phone alarm / staff app) within N minutes of being sent a
--   picking task → the person who sent it gets an alert with the picker's phone number, so they can
--   call. If the picker accepts afterwards, the sender is told that too.
--   N = Settings → Features → Picking (system_settings 'picking.accept_alert_minutes', default 2, 0 = off).
--   Checked every 30 seconds by pg_cron (job 'jst-picking-unaccepted').
-- =====================================================================
alter table public.picking_task_assignees add column if not exists unack_alerted_at timestamptz;
-- tasks already waiting when this goes live are not alerted (no burst of old alerts)
update public.picking_task_assignees set unack_alerted_at = now()
 where acknowledged_at is null and removed_at is null and unack_alerted_at is null;

create or replace function public.picking_alert_recipient(p_task uuid, p_sender uuid, p_picker uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select * into t from public.picking_tasks where id = p_task;
  if p_sender is not null and p_sender <> p_picker and exists (select 1 from public.profiles where id = p_sender and is_active) then
    perform public.pick_notify(t.company_id, p_sender, p_kind, false, p_title, p_body, p_task);
  else
    perform public.pick_notify_managers(p_task, p_kind, p_title, p_body);   -- nobody to tell directly: the warehouse's picking managers
  end if;
end $$;
revoke execute on function public.picking_alert_recipient(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.picking_unaccepted_sweep()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_mins int;
begin
  for r in
    select a.id aid, a.user_id, a.assigned_at, a.assigned_by, t.id task_id, t.company_id, t.doc_no, t.so_doc_no, w.code wh,
           coalesce(nullif(p.full_name, ''), p.email) picker, p.phone,
           coalesce((select (s.value #>> '{}')::numeric from public.system_settings s
                      where s.company_id = t.company_id and s.key = 'picking.accept_alert_minutes'), 2) mins
      from public.picking_task_assignees a
      join public.picking_tasks t on t.id = a.task_id
      join public.profiles p on p.id = a.user_id
      left join public.warehouses w on w.id = t.warehouse_id
     where a.removed_at is null and a.acknowledged_at is null and a.unack_alerted_at is null
       and t.status in ('OPEN','IN_PROGRESS') and a.assigned_at > now() - interval '1 day'
  loop
    continue when r.mins <= 0 or r.assigned_at > now() - make_interval(secs => (r.mins * 60)::double precision);
    v_mins := greatest(1, round(extract(epoch from now() - r.assigned_at) / 60)::int);
    perform public.picking_alert_recipient(r.task_id, r.assigned_by, r.user_id, 'NOT_ACCEPTED',
      r.picker || ' has not accepted ' || r.doc_no,
      'Sent ' || v_mins || ' min ago · ' || coalesce(r.so_doc_no, '') || coalesce(' · ' || r.wh, '') ||
        coalesce(' · call ' || nullif(trim(r.phone), ''), ' · no phone number saved'));
    update public.picking_task_assignees set unack_alerted_at = now() where id = r.aid;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.picking_unaccepted_sweep() from public, anon, authenticated;

-- picker accepted after the alert went out → tell the same person
create or replace function public.tg_pick_accepted_late()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t record; v_name text;
begin
  if old.acknowledged_at is null and new.acknowledged_at is not null and new.unack_alerted_at is not null then
    select * into t from public.picking_tasks where id = new.task_id;
    select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = new.user_id;
    perform public.picking_alert_recipient(new.task_id, new.assigned_by, new.user_id, 'ACCEPTED_LATE',
      v_name || ' has now accepted ' || t.doc_no, 'Accepted ' || to_char(new.acknowledged_at at time zone 'Asia/Karachi', 'HH24:MI'));
  end if;
  return new;
end $$;
revoke execute on function public.tg_pick_accepted_late() from public, anon, authenticated;
drop trigger if exists accepted_late on public.picking_task_assignees;
create trigger accepted_late after update of acknowledged_at on public.picking_task_assignees for each row execute function public.tg_pick_accepted_late();

-- the minutes setting (managers with settings.manage or picking.manage may change it)
create or replace function public.set_picking_accept_alert(p_company uuid, p_minutes int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_permission(p_company, 'settings.manage') or public.has_permission(p_company, 'picking.manage')) then
    raise exception 'You do not have permission to change this' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 0 and 60 then raise exception 'Enter 0 to 60 minutes (0 = off)' using errcode = '22023'; end if;
  insert into public.system_settings(company_id, key, value, description)
  values (p_company, 'picking.accept_alert_minutes', to_jsonb(p_minutes), 'Alert the sender when a picker has not accepted a task within this many minutes (0 = off)')
  on conflict (company_id, key) do update set value = excluded.value;
end $$;
revoke execute on function public.set_picking_accept_alert(uuid, int) from public, anon;
grant execute on function public.set_picking_accept_alert(uuid, int) to authenticated;

select cron.schedule('jst-picking-unaccepted', '30 seconds', 'select public.picking_unaccepted_sweep()');
