-- =====================================================
-- Business entitlements — store-limit / plan layer, P3
-- =====================================================
-- The store cap (and, later, other plan limits) per business. The tenant is
-- profiles.customer_id (= business_id); this table carries that business's
-- current plan tier + a comp/dev "unlimited" override.
--
-- The actual numeric store limit is DERIVED from the tier via TIER_FEATURES in
-- src/lib/subscription/types.ts (the same model the pricing UI uses) — we store
-- the TIER, not the number, so the server gate and the client UI can never
-- disagree, and changing the pricing model never needs a migration.
--
-- Service-role-only RLS (no authenticated policy), matching the `stores` /
-- `invites` pattern: all access is through the server layer
-- (src/lib/entitlements.ts + src/actions/entitlements.ts) using the service-role
-- client with an explicit business_id scope.
--
-- No backfill: a business with no row is treated as 'free' by the loader, so
-- every existing tenant keeps working (free = 1 store). The dev/owner account is
-- uncapped via is_unlimited = true OR the KARUTE_UNLIMITED_BUSINESS_IDS env
-- allowlist — never store-capped.
-- =====================================================

create table if not exists business_entitlements (
  business_id  uuid primary key,               -- the tenant (profiles.customer_id)
  tier         text not null default 'free',   -- SubscriptionTier (subscription/types.ts)
  is_unlimited boolean not null default false,  -- comp/dev bypass — never capped
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null,
  constraint business_entitlements_tier_check
    check (tier in ('trial', 'free', 'standard', 'professional', 'enterprise'))
);

drop trigger if exists update_business_entitlements_updated_at on business_entitlements;
create trigger update_business_entitlements_updated_at before update on business_entitlements
  for each row execute procedure update_updated_at_column();

alter table business_entitlements enable row level security;
-- No policies on purpose: authenticated/anon get zero rows; the service-role
-- client (server layer) bypasses RLS. See header.
