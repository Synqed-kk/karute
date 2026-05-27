// ─────────────────────────────────────────────────────────────
// /[locale]/coaching/patterns — top-performer pattern library
// ─────────────────────────────────────────────────────────────
// Spike source: src/app/[locale]/(app)/coaching/patterns/page.tsx
//
// Visible to both roles, but with different anonymization:
//   - Owner: sees `sourceStaffName` attached to each pattern
//     (a Layer-2 named surface)
//   - Staff: sees the same patterns without source attribution
//     (anonymized Layer 2 — backend MUST strip the name server-
//     side; do not rely on the client toggle alone)
//
// ANTHONY contract:
//   useTopPerformerPatternsData() → TopPerformerPattern[]
//   weekly claude-sonnet batch (AI_PROMPTS.md §11)
//   RLS: staff see anonymized rows; owners see named.
//
// Until the data hook lands, the view renders the full library
// chrome (5 category sections with headings + descriptions) and
// each section's empty state surfaces a ScaffoldHint so the page
// shows the SHAPE of the library, not a blank canvas.

import { PatternLibrary } from '@/components/coaching/redesign/PatternLibrary'
import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'

export default async function CoachingPatternsPage() {
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

  return <PatternLibrary viewerRealRole={realRole} patterns={null} />
}
