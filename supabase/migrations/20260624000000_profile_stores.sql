-- =====================================================
-- profile_stores — many-to-many staff ↔ store (multi-store)
-- =====================================================
-- Replaces the single profiles.store_id column. A staff member can now be
-- attached to ANY number of stores within their business (e.g. a stylist who
-- works at both 代官山 and 銀座).
--
-- ZERO rows for a staff = "works across ALL stores" (owner / floating / SV) —
-- the same "visible everywhere" semantic the old NULL store_id carried.
--
-- LOCATION layer only. business_id (= profiles.customer_id = stores.business_id)
-- remains the tenant + coaching/training-data boundary, and is denormalised onto
-- every row so each read is explicitly business-scoped (the one hard isolation
-- rule), never reliant on a join for the boundary. Service-role-only RLS, matching
-- `stores`: all access goes through the service-role client + an explicit
-- business_id scope (see src/actions/stores.ts).
-- =====================================================

create table if not exists profile_stores (
  business_id uuid not null,                                      -- tenant scope (every read filters on this)
  profile_id  uuid not null references profiles (id) on delete cascade,
  store_id    uuid not null references stores (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, store_id)
);

-- Hot path: "staff assigned to store X within business B" (the staff-tab filter)
-- and the per-store staff count.
create index if not exists profile_stores_business_store_idx
  on profile_stores (business_id, store_id);

alter table profile_stores enable row level security;

-- Port existing single-store assignments into the link table (idempotent), then
-- retire the single column so profile_stores is the ONE source of truth — no
-- fallback read, no two-places-to-update (the single-source rule).
insert into profile_stores (business_id, profile_id, store_id)
  select customer_id, id, store_id
  from profiles
  where store_id is not null
  on conflict do nothing;

drop index if exists profiles_store_id_idx;
alter table profiles drop column if exists store_id;
