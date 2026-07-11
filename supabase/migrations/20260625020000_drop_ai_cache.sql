-- Drop ai_cache — the global AI-response cache now lives in synqed-core
-- (model + SDK 1.8.0). Already applied to prod after the repoint (#338) deployed.
-- DROP IF EXISTS → idempotent.
drop table if exists public.ai_cache;
