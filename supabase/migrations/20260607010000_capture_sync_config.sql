-- sync_config — QuickReserve sync credentials + run status. The live table was
-- created BY HAND (no migration ever existed in the repo); this captures it so
-- fresh environments don't silently break the sync. create-if-not-exists =
-- no-op on the live DB.
--
-- Columns verified against every reader/writer:
--   src/app/api/sync/quickreserve/config/route.ts (select/insert/update)
--   src/app/api/sync/quickreserve/route.ts        (creds read + status write)
--   src/app/api/sync/quickreserve-deep/route.ts   (select *)
--
-- ANTHONY: before applying, eyeball `\d public.sync_config` on live — if the
-- hand-made table has extra columns, add them here so the file matches reality.

create table if not exists public.sync_config (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null unique,        -- 'quickreserve'
  base_url           text,                        -- QR tenant slug (e.g. 'la-estro')
  username           text,
  password_encrypted text,                        -- SENSITIVE — RLS-locked by 20260608
  enabled            boolean not null default false,
  last_sync_at       timestamptz,
  last_sync_status   text,                        -- 'success' | 'error'
  last_sync_error    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
