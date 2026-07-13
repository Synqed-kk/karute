// ─────────────────────────────────────────────────────────────
// /ja/coaching — role-aware coaching dashboard
// ─────────────────────────────────────────────────────────────
// Spike-lifted: src/app/[locale]/(app)/coaching/page.tsx (spike)
//
// Reads the signed-in user's display_role from the staff list and
// renders the owner OR staff variant of the coaching dashboard.
// The variants are the data-driven screens (DataDrivenStaffView /
// DataDrivenOwnerRoi). Until the data hooks exist they render the
// honest empty state; the unlimited/comped account renders the
// labeled sample dataset (sample-data.ts) so the finished design
// is visible in the app.
//
// ANTHONY: the role check here is UI-only. Backend MUST enforce
// the same staff-vs-owner distinction at the RLS + API layer
// before the real data hooks come online. The privacy posture
// (staff-self vs owner-aggregate) is encoded in contract.ts's
// scoped view types.

import { getBusinessId, getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { loadEntitlement } from '@/lib/entitlements'
import { CoachingPageView } from '@/components/coaching/redesign/CoachingPageView'

export default async function CoachingPage() {
  const [staffList, activeStaffId, businessId] = await Promise.all([
    getStaffList(),
    getCurrentUserStaffId(),
    getBusinessId(),
  ])
  // Unlimited/comped account → labeled sample data so the screens are
  // visible before the data layer exists; everyone else → honest empty state.
  const entitlement = await loadEntitlement(businessId)

  // Default to 'staff' if we can't pin down the user's role.
  // Owner-only surfaces stay hidden — safest fallback.
  const activeStaff = activeStaffId
    ? staffList.find((s) => s.id === activeStaffId) ?? null
    : null
  const role: 'owner' | 'staff' =
    (activeStaff?.display_role ?? '').toLowerCase() === 'owner'
      ? 'owner'
      : 'staff'

  return <CoachingPageView role={role} sampleData={entitlement.isUnlimited} />
}
