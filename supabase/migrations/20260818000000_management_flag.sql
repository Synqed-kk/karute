-- =====================================================
-- 経営メンバー (management member) flag
-- =====================================================
-- Owners/managers who hold a staff row but never take bookings. The flag is a
-- VISIBILITY concern only — it grants and removes NOTHING (rights stay in
-- permission_role / permissions, added by 20260603020000). Flagged staff drop
-- out of the assignment pickers' default list and out of the day-view lanes on
-- days they have no booking; they stay fully assignable via search and stay
-- listed in every view-filter dropdown.
--
-- Default false = today's behavior for every existing row, so applying this
-- changes NOTHING until someone flips a toggle. Reads fail OPEN (`?? false` in
-- app code): an absent/stale value means visible.
--
-- Written only by the service-role client (updateStaffCore); the
-- tenant-isolation migration (20260603000000) already prevents authenticated
-- users from writing profiles.
-- =====================================================

alter table profiles add column if not exists is_management boolean not null default false;
