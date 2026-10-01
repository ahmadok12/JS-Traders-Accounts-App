-- Security advisor follow-up (1 Oct 2026)
revoke execute on function public.storage_locations_enabled(uuid) from public, anon;
grant execute on function public.storage_locations_enabled(uuid) to authenticated;
-- run with the caller's rights so warehouse access rules (RLS) apply when called directly;
-- inside posting functions it still runs with the engine's rights
alter function public.inv_item_on_hand(uuid, uuid, uuid, uuid) security invoker;
