-- =====================================================
-- Staff Profiles RLS Policies
-- Phase 5: Staff Profiles
-- =====================================================
--
-- The profiles table uses a single shared business auth account.
-- All staff share one Supabase login, so any authenticated user
-- IS the business account. RLS policies use `using (true)` —
-- fine for v1 single-tenant. Per-staff permissions are a v2 concern.
--
-- Existing Phase 1 policies are too restrictive for staff management:
--   - "Users view profiles in same business" uses customer_id check
--   - "Users update own profile" only allows self-update
--
-- Replace them with the correct v1 policies:
--   - Any authenticated user can read ALL profiles (staff switcher needs this)
--   - Any authenticated user can INSERT profiles (admin creates staff)
--   - Any authenticated user can UPDATE any profile (admin edits staff names)
--   - Any authenticated user can DELETE profiles (admin deletes staff)
--

-- Drop existing Phase 1 policies that are too restrictive
drop policy if exists "Users view profiles in same business" on profiles;
drop policy if exists "Users update own profile" on profiles;

-- Enable RLS (idempotent — safe to run even if already enabled)
alter table profiles enable row level security;

-- SELECT: Any authenticated user can read all staff profiles
-- Needed by: header staff switcher, settings page staff list, karute attribution
create policy "Authenticated users can read all profiles"
  on profiles for select
  to authenticated
  using (true);

-- INSERT: Any authenticated user can create staff profiles
-- Needed by: Settings page "Add Staff" action
create policy "Authenticated users can insert profiles"
  on profiles for insert
  to authenticated
  with check (true);

-- UPDATE: Any authenticated user can update any profile
-- Needed by: Settings page "Edit Staff" action
-- Note: Per-staff permissions (only admins can edit) are a v2 requirement (MOD-01)
create policy "Authenticated users can update profiles"
  on profiles for update
  to authenticated
  using (true)
  with check (true);

-- DELETE: Any authenticated user can delete a profile
-- Needed by: Settings page "Delete Staff" action (with app-level guards in deleteStaff)
create policy "Authenticated users can delete profiles"
  on profiles for delete
  to authenticated
  using (true);
