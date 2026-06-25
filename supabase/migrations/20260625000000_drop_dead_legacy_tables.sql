-- Drop the dead legacy domain tables. The karute domain (customers, karute
-- records, entries, appointments) now lives entirely in synqed-core; these
-- Supabase tables are empty (verified 0 rows in prod) and no longer read or
-- written by the app. Part of the "no karute DB" consolidation.
--
-- Dependency order (drop children before parents, no CASCADE needed — the only
-- FKs referencing these tables are among the four themselves):
--   entries        -> karute_records
--   appointments   -> customers, karute_records
--   karute_records -> customers
--   customers      -> profiles (external; stays)

drop table if exists public.entries;
drop table if exists public.appointments;
drop table if exists public.karute_records;
drop table if exists public.customers;
