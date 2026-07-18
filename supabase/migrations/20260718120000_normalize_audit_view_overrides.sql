-- One-time normalization required by the 監査ログ grant-honoring flow
-- (AUDIT-FIX-PLAN.md P1-D). The resolve-time strip of audit.view is removed in
-- the same change: from now on a stored override carrying 'audit.view' IS a
-- live grant. Any pre-#528 stored override for a non-owner snapshotted the
-- then-manager-preset (which still included audit.view) — this strips it once,
-- so the only rows carrying it after deploy are deliberate owner grants made
-- through the (owner-gated) toggle.
--
-- Idempotent; a no-op when the stale population is empty.
UPDATE profiles
SET permissions = (
  SELECT COALESCE(jsonb_agg(cap), '[]'::jsonb)
  FROM jsonb_array_elements_text(permissions) AS cap
  WHERE cap <> 'audit.view'
)
WHERE permissions IS NOT NULL
  AND permissions ? 'audit.view'
  AND COALESCE(lower(display_role), '') <> 'owner'
  AND COALESCE(permission_role, '') <> 'owner';
