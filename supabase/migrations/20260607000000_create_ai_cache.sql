-- ai_cache — the AI response cache src/lib/ai-cache.ts has been writing to
-- "best-effort" since it shipped. NO create-table for it ever existed in the
-- repo (the cache has been silently OFF in any environment where nobody made
-- the table by hand). This codifies it.
--
-- Columns verified against src/lib/ai-cache.ts (getCachedAI/setCachedAI) and
-- /api/cleanup (prunes by expires_at).
--
-- ORDERING: must apply BEFORE 20260608000000_lock_sync_config_ai_cache.sql —
-- that migration ALTERs this table and errors if it's absent. create-if-not-
-- exists keeps this a no-op on any environment that already has it.

create table if not exists public.ai_cache (
  cache_key  text primary key,
  result     jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- /api/cleanup deletes expired rows on a schedule.
create index if not exists ai_cache_expires_idx
  on public.ai_cache (expires_at);
