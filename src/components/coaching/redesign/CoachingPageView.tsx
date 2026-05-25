'use client'

import { CoachingHeader } from './CoachingHeader'
import { StaffDashboardScaffold } from './StaffDashboardScaffold'
import { OwnerDashboardScaffold } from './OwnerDashboardScaffold'

// ─────────────────────────────────────────────────────────────
// Coaching root view — role-aware dashboard router
// ─────────────────────────────────────────────────────────────
// Spike source: synqed-karute-design-spike/src/app/[locale]/(app)/
// coaching/page.tsx (lines 12-21).
//
// Role is derived from the session's activeStaff.displayRole on
// the server-side page.tsx and passed in here as a prop — the
// spike's demo role-toggle is intentionally omitted (per the
// spike's own ANTHONY comment, the toggle was scaffolding for
// the spike preview and should not survive into karute prod).
//
// ROLE CHECK CONTRACT (spike comment, preserved verbatim):
//   "This page renders differently for スタッフ vs オーナー.
//    Frontend role check for UI rendering only.
//    Backend MUST enforce the same distinction via RLS +
//    API-layer checks."
export function CoachingPageView({ role }: { role: 'owner' | 'staff' }) {
  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 md:p-6 md:gap-6">
      <CoachingHeader role={role} />
      {role === 'owner' ? <OwnerDashboardScaffold /> : <StaffDashboardScaffold />}
    </main>
  )
}
