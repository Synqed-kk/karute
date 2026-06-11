-- =====================================================
-- Stores (locations) — multi-store foundation, P1
-- =====================================================
-- A business (profiles.customer_id) can have many stores/locations. This is the
-- LOCATION layer; business_id remains the tenant + the coaching/training-data
-- isolation boundary (all stores of a business pool; coaching never crosses
-- business_id). store_id (added to profiles/customers/karute later) is only a
-- location filter.
--
-- Service-role-only RLS (no authenticated policy), matching the `invites`
-- pattern: all access goes through server actions (src/actions/stores.ts) using
-- the service-role client + an explicit business_id scope. Keeps this migration
-- independent of the tenant-isolation helper (auth_business_id()).
--
-- Schema matches the shape already sketched in
-- src/components/settings/redesign/sections/stores/types.ts.
-- =====================================================

create table if not exists stores (
  id          uuid default gen_random_uuid() primary key,
  business_id uuid not null,                 -- the tenant (profiles.customer_id)
  name        text not null,
  address     text,
  phone       text,
  is_primary  boolean not null default false, -- the 本店; exactly one per business
  active      boolean not null default true,  -- owner can disable a location
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

create index if not exists stores_business_id_idx on stores (business_id);
-- At most one primary store per business.
create unique index if not exists stores_one_primary_per_business
  on stores (business_id) where is_primary;

drop trigger if exists update_stores_updated_at on stores;
create trigger update_stores_updated_at before update on stores
  for each row execute procedure update_updated_at_column();

alter table stores enable row level security;
-- No policies on purpose: authenticated/anon get zero rows; the service-role
-- client (server actions) bypasses RLS. See header.
