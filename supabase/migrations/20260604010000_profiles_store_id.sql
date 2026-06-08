-- =====================================================
-- profiles.store_id — staff ↔ store (multi-store P2)
-- =====================================================
-- A staff member can be attached to one store (location) within their business.
-- NULL = not pinned to a location (e.g. the owner / SV who works across stores).
-- This is a LOCATION link; business_id (profiles.customer_id) remains the tenant
-- + coaching-data boundary.
--
-- Drives: per-store staff counts (count profiles by store_id) and, later, the
-- staff-limited-to-their-store view. ON DELETE SET NULL so removing a store
-- doesn't orphan staff.
-- =====================================================

alter table profiles
  add column if not exists store_id uuid references stores (id) on delete set null;

create index if not exists profiles_store_id_idx on profiles (store_id);
