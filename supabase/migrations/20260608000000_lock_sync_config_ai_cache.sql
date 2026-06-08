-- Close the two public tables that were left without row-level security after
-- the tenant-isolation hardening (20260603000000). Both are reachable only
-- server-side via the service-role client, so enabling RLS with NO policies
-- locks out the anon/authenticated key entirely (service role bypasses RLS).
--
-- sync_config is the urgent one: it stores the QuickReserve login, including
-- password_encrypted. With RLS off, anyone holding the public anon key could
-- `select *` and read those credentials. The app's reads/writes were moved to
-- the service-role client (api/sync/quickreserve/config + ai-cache + cleanup)
-- so this lock doesn't break the Settings sync panel or AI caching.
--
-- ORDER: apply this only AFTER the code change that moves these tables to the
-- service-role client is deployed — otherwise the still-deployed app, which
-- reads them with the authenticated client, would suddenly get empty results.

alter table public.sync_config enable row level security;
alter table public.ai_cache enable row level security;
