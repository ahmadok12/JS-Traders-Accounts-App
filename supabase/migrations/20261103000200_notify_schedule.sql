-- =====================================================================
-- JS Traders ERP — Stage 12 (part 2b): background delivery of e-mail / WhatsApp alerts
--   Every 5 minutes: evaluate the notification rules for people who get e-mail / WhatsApp,
--   then call the notify-send edge function when something is waiting in the outbox.
--   The edge function proves it is called by this job with a secret kept in Supabase Vault
--   (generated here, never in git); it checks the secret through notify_check_secret().
-- Supabase only (pg_cron, pg_net, Vault).
-- =====================================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'notify_cron_secret', 'Shared by the notification job and the notify-send edge function');
  end if;
end $$;

create or replace function public.notify_check_secret(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_secret) >= 32 and p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret'), false);
$$;
revoke execute on function public.notify_check_secret(text) from public, anon, authenticated;
grant execute on function public.notify_check_secret(text) to service_role;

create or replace function public.notify_kick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.notification_outbox where status = 'PENDING') then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_cron_secret';
  perform net.http_post(
    url := 'https://rjdjaujoilcunwtynaze.supabase.co/functions/v1/notify-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;
revoke execute on function public.notify_kick() from public, anon, authenticated;

select cron.schedule('jst-notifications', '*/5 * * * *', 'select public.notifications_sweep(); select public.notify_kick();');
