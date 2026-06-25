-- Drop karute_outcomes — the per-session coaching outcome now lives in
-- synqed-core (all rows migrated; the app reads/writes it via the SDK). Part of
-- the "no karute DB" consolidation. Applied to prod after the repoint deployed.
-- DROP IF EXISTS → idempotent.
drop table if exists public.karute_outcomes;
