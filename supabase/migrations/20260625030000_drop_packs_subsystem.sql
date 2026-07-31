-- Drop the 回数券 (ticket-pack) subsystem — all 6 tables now live in synqed-core
-- (SDK 1.7.0; data migrated incl. the 4 Kitano-import orphans under business
-- 7bb76aac). Applied to prod after the repoint (#337) deployed. Idempotent.
drop table if exists public.pack_alert_dismissals;
drop table if exists public.customer_contacts;
drop table if exists public.visit_reconcile_dismissals;
drop table if exists public.pack_redemptions;
drop table if exists public.ticket_packs;
drop table if exists public.customer_lifecycle;
