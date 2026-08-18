-- =====================================================
-- business_workspace_grants — the Business release lever
-- =====================================================
-- One row = one workspace opened for one business. NO rows ship with this
-- migration, so every workspace is OFF for every tenant until a deliberate
-- insert; deleting the row is the kill switch. No deploy, no env flag.
--
-- SERVER-SIDE ONLY. The authority-snapshot builder feeds grantedWorkspaceIds
-- (src/lib/workspaces/resolve.ts) from this table through the service-role
-- client. RLS is enabled with NO policy — anon/authenticated therefore get
-- zero rows and zero writes (same shape as profile_stores / stores); the
-- service role bypasses RLS and is the only reader and writer.
--
-- workspace_id mirrors WORKSPACE_IDS (src/lib/workspaces/types.ts); the
-- resolver re-parses fail-closed, so the CHECK is a hygiene floor, not the
-- authorization boundary. No FK on business_id — there is no local businesses
-- table (ids are core-owned: profiles.customer_id / stores.business_id).
--
-- Unrelated to the core SDK's BusinessGrantClient (staff-level HQ_ADMIN
-- grants): same word, different system. This table grants a WORKSPACE to a
-- BUSINESS; that one grants a capability to a staff member.
-- =====================================================

create table if not exists business_workspace_grants (
  business_id  uuid not null,
  workspace_id text not null check (
    workspace_id in ('karute_work', 'front_desk', 'reserve_operations', 'business_admin')
  ),
  granted_at   timestamptz not null default now(),
  granted_by   uuid,
  primary key (business_id, workspace_id)
);

alter table business_workspace_grants enable row level security;
