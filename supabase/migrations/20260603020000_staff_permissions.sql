-- =====================================================
-- Staff permissions (RBAC)
-- =====================================================
-- Adds the per-staff permission model that powers role presets + owner-toggled
-- overrides (src/lib/auth/permissions.ts). Roles seed a default capability set;
-- `permissions` (when non-null) is the explicit, customized set that overrides
-- the preset. The capability strings are validated in app code, not by a CHECK,
-- so adding a capability never needs a migration.
--
-- Backfilled from the existing display_role so applying this changes NO ONE's
-- effective access (the resolver already falls back to display_role when these
-- columns are absent — see require-permission.ts).
--
-- These columns are written only by the service-role client (acceptInvite,
-- staff actions); the tenant-isolation migration (20260603000000) already
-- prevents authenticated users from writing profiles.
-- =====================================================

alter table profiles add column if not exists permission_role text;   -- 'owner' | 'manager' | 'senior' | 'practitioner' | 'frontdesk' | 'custom'
alter table profiles add column if not exists permissions jsonb;      -- explicit capability array; null = use the role preset

-- Seed permission_role from the current display_role so behavior is unchanged.
update profiles
set permission_role = case lower(coalesce(display_role, ''))
    when 'owner'     then 'owner'
    when 'admin'     then 'manager'
    when 'assistant' then 'frontdesk'
    else 'practitioner'
  end
where permission_role is null;
