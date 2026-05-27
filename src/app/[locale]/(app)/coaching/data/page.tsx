// ─────────────────────────────────────────────────────────────
// /[locale]/coaching/data — staff transparency page
// ─────────────────────────────────────────────────────────────
// Spike source: src/app/[locale]/(app)/coaching/data/page.tsx
//
// PURPOSE
//
// Plain-language privacy disclosure: what gets recorded, what's
// staff-private (Layer 1), what's owner-visible (Layer 2), plus
// affordances to re-review the consent dialog and request
// deletion of staff-private coaching data.
//
// ROLE
//
// Both roles can view this page — it's reference material.
//   - Staff: first-person framing ("ここはあなたのデータです")
//   - Owner: informational framing ("scope of staff data")
// Subtitle text branches on the effective role (driven through
// PersonalGrowthDataView → useEffectiveCoachingRole so the dev
// preview pill works live).
//
// ANTHONY: DataDeletionRequestButton's submit handler is a UX
// demo today. Real wiring spec is in that file's header
// comment — INSERT into coaching_deletion_requests + realtime
// notify the owner + background job performs the actual purge.

import { PersonalDataView } from '@/components/coaching/redesign/PersonalDataView'
import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'

export default async function CoachingDataPage() {
  const [staffList, activeStaffId] = await Promise.all([
    getStaffList(),
    getActiveStaffId(),
  ])

  const activeStaff = activeStaffId
    ? (staffList.find((s) => s.id === activeStaffId) ?? null)
    : null
  const realRole: 'owner' | 'staff' =
    (activeStaff?.display_role ?? '').toLowerCase() === 'owner'
      ? 'owner'
      : 'staff'

  return <PersonalDataView viewerRealRole={realRole} />
}
