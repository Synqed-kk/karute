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
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'

export default async function CoachingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [staffList, activeStaffId] = await Promise.all([
    getStaffList(),
    getCurrentUserStaffId(),
  ])

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
