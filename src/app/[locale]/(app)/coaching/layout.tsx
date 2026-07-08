// ─────────────────────────────────────────────────────────────
// /coaching/* shared layout — mounts the dev-preview toggle
// ─────────────────────────────────────────────────────────────
// Resolves the session-derived role server-side once, passes
// it to the DevPreviewToggle client component. The toggle
// itself self-gates on the env check; in production builds the
// component tree-shakes to null and adds no DOM.
//
// Every coaching sub-route inherits the toggle via this layout
// so a developer can flip between owner / staff renderings
// from anywhere under /coaching/* without re-mounting.

import { DevPreviewToggle } from '@/components/coaching/redesign/DevPreviewToggle'
import { CoachingLocked } from '@/components/coaching/redesign/CoachingLocked'
import { getBusinessId, getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { loadEntitlement } from '@/lib/entitlements'
import { coachingEntitledForTier } from '@/lib/karute/coaching/access'

export default async function CoachingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [staffList, activeStaffId, businessId] = await Promise.all([
    getStaffList(),
    getCurrentUserStaffId(),
    getBusinessId(),
  ])

  // Per-account paywall for the whole coaching section. Entitled =
  // the plan tier includes coaching OR the business is on the
  // unlimited override (Liam's account — the same isUnlimited flag
  // that already powers the multi-store gate). Non-entitled
  // businesses get the upsell in place of every coaching surface.
  // The owner's org on/off toggle (access.ts's `canUse`) is Anthony's
  // org-settings wiring; this gate is the paywall axis (`entitled`).
  const entitlement = await loadEntitlement(businessId)
  const entitled =
    entitlement.isUnlimited || coachingEntitledForTier(entitlement.tier)
  if (!entitled) {
    return <CoachingLocked />
  }

  const activeStaff = activeStaffId
    ? (staffList.find((s) => s.id === activeStaffId) ?? null)
    : null
  const realRole: 'owner' | 'staff' =
    (activeStaff?.display_role ?? '').toLowerCase() === 'owner'
      ? 'owner'
      : 'staff'

  return (
    <>
      {children}
      <DevPreviewToggle realRole={realRole} />
    </>
  )
}
