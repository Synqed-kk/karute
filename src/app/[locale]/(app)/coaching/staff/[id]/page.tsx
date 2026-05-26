// ─────────────────────────────────────────────────────────────
// /[locale]/coaching/staff/[id] — owner drill-down
// ─────────────────────────────────────────────────────────────
// Spike source: src/app/[locale]/(app)/coaching/staff/[id]/page.tsx
//
// Owner-only Layer 2 view of a single staff's aggregated
// performance. The page does the role check and pulls the
// staff's display record (name / role) from Supabase so the
// header chrome paints with real values. The performance
// numbers + trajectory + gap insights are all 対応予定
// scaffolds until Anthony wires:
//
//   useStaffPerformanceData()    → metrics + trajectory
//   useCategoricalInsightsData(id) → categorical gap analysis
//
// ANTHONY: the role check + staff-not-found checks here are
// frontend-only. Backend MUST also enforce:
//   - this row is in the caller's business (RLS)
//   - Layer 1 columns (transcripts, session detail, customer
//     references, per-session AI suggestions) never join into
//     responses for this surface, even when the caller IS owner.

import { notFound, redirect } from 'next/navigation'

import { StaffDrillDownView } from '@/components/coaching/redesign/StaffDrillDownView'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

/** Derive 1–2 char initials from a full name. Handles JP single-
 *  glyph and EN multi-token names equally. Falls back to "?" so
 *  the avatar never renders blank. */
function deriveInitials(fullName: string | null | undefined): string {
  const name = (fullName ?? '').trim()
  if (!name) return '?'
  const tokens = name.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return '?'
  if (tokens.length === 1) return Array.from(tokens[0])[0] ?? '?'
  const first = Array.from(tokens[0])[0] ?? ''
  const last = Array.from(tokens[tokens.length - 1])[0] ?? ''
  return `${first}${last}` || '?'
}

export default async function CoachingStaffDrillDownPage({ params }: PageProps) {
  const { locale, id } = await params

  const [staffList, activeStaffId] = await Promise.all([
    getStaffList(),
    getCurrentUserStaffId(),
  ])

  const activeStaff = activeStaffId
    ? (staffList.find((s) => s.id === activeStaffId) ?? null)
    : null
  const role: 'owner' | 'staff' =
    (activeStaff?.display_role ?? '').toLowerCase() === 'owner'
      ? 'owner'
      : 'staff'

  // Frontend gate. Staff bouncing to their own /coaching root is
  // less jarring than a 403 — backend still enforces the API gate.
  if (role !== 'owner') {
    redirect(`/${locale}/coaching`)
  }

  const target = staffList.find((s) => s.id === id)
  if (!target) {
    notFound()
  }

  const initials = deriveInitials(target.full_name)
  const displayName = target.full_name ?? initials
  const displayRole = target.display_role ?? target.position ?? ''

  return (
    <StaffDrillDownView
      staffId={target.id}
      staffName={displayName}
      initials={initials}
      role={displayRole}
      performance={null}
      insights={null}
    />
  )
}
