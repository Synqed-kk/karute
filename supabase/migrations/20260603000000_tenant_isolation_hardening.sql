-- =====================================================
-- Tenant isolation hardening
-- =====================================================
-- BACKGROUND
-- 20260313202738_staff_rls_policies.sql ("Phase 5") opened `profiles` to
-- `using (true)` for SELECT/INSERT/UPDATE/DELETE, on the stated assumption that
-- "all staff share one Supabase login, so any authenticated user IS the business
-- account." That is no longer true — the app now issues one auth user per staff
-- member (getCurrentUserStaffId, src/lib/staff.ts). Under per-user auth,
-- `using (true)` lets ANY authenticated user:
--   1. SELECT every profile in the DB  → enumerate all tenants + staff PII.
--   2. UPDATE their own profiles.customer_id to another business → since
--      getBusinessId() (src/lib/staff.ts) trusts profiles.customer_id, and
--      customers / karute_records / entries RLS scope by that same column, this
--      pivots the attacker into another salon's customer + clinical karute data.
--
-- Fix: re-scope `profiles` SELECT to the caller's own business, and remove the
-- client's ability to write `profiles` at all. Every legitimate profile write
-- already goes through the SERVICE-ROLE client (verified: src/actions/bootstrap.ts,
-- src/actions/staff.ts, src/lib/synqed/staff-map.ts), which bypasses RLS. The
-- Phase 1 staff-invite "join" flow likewise attaches staff to a business
-- SERVER-SIDE via service-role.
--
-- NOTE (legacy, intentionally NOT touched here): the Supabase `appointments`
-- table is also `using (true)` but is UNUSED — appointments live in synqed-core
-- (src/actions/appointments.ts), and the table has no customer_id column (tenancy
-- would be indirect via staff_profile_id). Left out to keep this security change
-- focused + auditable. Recommend dropping the legacy table, or hardening it in a
-- separate migration.
--
-- APPLY/VERIFY (Anthony, on prod — author cannot reach the live DB):
--   * Pre-check: confirm prod profiles RLS really is `using(true)` (select * from
--     pg_policies where tablename='profiles'); adjust if prod was already changed.
--   * Post-apply smoke: a normal user can still see their own roster/customers/
--     karute; `update profiles set customer_id=<other> where id=auth.uid()` via the
--     anon REST API is now REJECTED; signup still creates a fresh business.
-- =====================================================

-- Recursion-safe "my business id" lookup. SECURITY DEFINER so the inner read of
-- `profiles` bypasses RLS — without this, a `profiles` policy that queries
-- `profiles` recurses. STABLE + pinned search_path per Supabase guidance.
-- auth.uid() still returns the caller's id inside a DEFINER function (it reads the
-- request JWT GUC, not the execution role).
create or replace function public.auth_business_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select customer_id from public.profiles where id = (select auth.uid())
$$;

revoke all on function public.auth_business_id() from public;
grant execute on function public.auth_business_id() to authenticated, service_role;

-- Drop the over-broad Phase 5 policies.
drop policy if exists "Authenticated users can read all profiles" on profiles;
drop policy if exists "Authenticated users can insert profiles"  on profiles;
drop policy if exists "Authenticated users can update profiles"  on profiles;
drop policy if exists "Authenticated users can delete profiles"  on profiles;

-- SELECT: a user sees only profiles in their own business (roster + attribution).
-- Fails closed: a user with no profile → auth_business_id() = NULL → 0 rows.
create policy "profiles_select_same_business"
  on profiles for select to authenticated
  using (customer_id = public.auth_business_id());

-- Deliberately NO insert/update/delete policy for `authenticated`. With RLS
-- enabled and no permissive policy, those ops are denied for that role — which is
-- what blocks the tenant-pivot (a user can no longer rewrite its own
-- profiles.customer_id). Service-role bypasses RLS and remains the only writer.
-- (If a client-side "edit my own profile" flow is added later, add a scoped
-- UPDATE policy `using (id = (select auth.uid()))` PLUS column grants that
-- EXCLUDE customer_id / id / role so the tenant column can't be moved.)

-- Harden the signup trigger: stop honoring a client-supplied customer_id from
-- raw_user_meta_data. A public-anon-key signUp could pass any business id and the
-- old trigger would attach the new profile to it. Now every new user always gets
-- a fresh business; the Phase 1 invite/join flow attaches staff to an existing
-- business SERVER-SIDE (service-role), never via client metadata. full_name from
-- metadata is harmless and kept.
-- `set search_path = public` is load-bearing, not cosmetic: this SECURITY
-- DEFINER function writes profiles.customer_id (the tenant-linkage column).
-- Without a pinned path a role able to create objects in a schema sorting before
-- public could shadow `profiles` and redirect the INSERT. Pinned + schema-
-- qualified, matching auth_business_id() above. (Greptile flag, #157.)
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, customer_id, full_name)
  values (
    new.id,
    gen_random_uuid(),
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
-- Trigger on_auth_user_created (001) is bound to handle_new_user(); CREATE OR
-- REPLACE swaps the body in place — no trigger change needed.
