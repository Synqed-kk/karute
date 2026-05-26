// ─────────────────────────────────────────────────────────────
// /[locale]/coaching/growth — staff personal growth detail
// ─────────────────────────────────────────────────────────────
// Spike source: src/app/[locale]/(app)/coaching/growth/page.tsx
//
// STAFF-ONLY surface. All data is Layer 1 (staff-private).
// Server-side role gate redirects non-staff to /coaching — except
// when the dev-preview env flag is on, in which case the request
// is allowed through and PersonalGrowthView renders the staff-
// only notice for whoever previewed as owner.
//
// ANTHONY contracts (when data lands):
//   usePersonalGrowthData()            → growth (chart + stats + strengths + focus)
//   usePersonalCoachingInsightsData()  → insights (past suggestions + outcomes)
//   useSessionTranscriptsData()        → excerpts (transcript chunks + AI notes)
//   useLearningModulesData({ assignedTo: viewerStaffId })
//
// Backend RLS MUST enforce SELECT only where staff_id = auth.uid()
// for ALL four data sources. Owners NEVER read these tables.

import { redirect } from 'next/navigation'

import { PersonalGrowthView } from '@/components/coaching/redesign/PersonalGrowthView'
import { isDevPreviewEnabled } from '@/lib/coaching-dev-preview/hooks'
import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function CoachingGrowthPage({ params }: PageProps) {
  const { locale } = await params

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

  // Frontend gate. Non-staff bounce back to /coaching unless the
  // dev-preview env flag is on (in which case the client view
  // renders the staff-only notice mirroring what a real owner
  // would see if they bypassed this redirect).
  if (realRole !== 'staff' && !isDevPreviewEnabled()) {
    redirect(`/${locale}/coaching`)
  }

  return (
    <PersonalGrowthView
      viewerRealRole={realRole}
      growth={null}
      insights={null}
      excerpts={null}
      modules={null}
    />
  )
}
