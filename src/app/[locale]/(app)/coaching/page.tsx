// ─────────────────────────────────────────────────────────────
// /ja/coaching — role-aware coaching dashboard
// ─────────────────────────────────────────────────────────────
// Spike-lifted: src/app/[locale]/(app)/coaching/page.tsx (spike)
//
// Reads the signed-in user's display_role from the staff list and
// renders the owner OR staff variant of the coaching dashboard.
// Both variants are SCAFFOLD ONLY in this PR — each card slot
// renders a 対応予定 placeholder with a description of what'll
// appear there once the data layer + per-card components are
// ported in follow-up PRs (see MERGE_NOTES_FOR_ANTHONY.md's
// coaching punchlist).
//
// ANTHONY: the role check here is UI-only. Backend MUST enforce
// the same staff-vs-owner distinction at the RLS + API layer
// before the real data hooks come online. The spike's privacy
// posture (Layer 1 / 2 / 3) is preserved in each scaffold card's
// `privacyLayer` prop so you don't have to re-derive it.

import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'
import { CoachingPageView } from '@/components/coaching/redesign/CoachingPageView'

export default async function CoachingPage() {
  const [staffList, activeStaffId] = await Promise.all([
    getStaffList(),
    getActiveStaffId(),
  ])

  // Default to 'staff' if we can't pin down the user's role.
  // Owner-only surfaces stay hidden — safest fallback.
  const activeStaff = activeStaffId
    ? staffList.find((s) => s.id === activeStaffId) ?? null
    : null
  const role: 'owner' | 'staff' =
    (activeStaff?.display_role ?? '').toLowerCase() === 'owner'
      ? 'owner'
      : 'staff'

  return <CoachingPageView role={role} />
}
