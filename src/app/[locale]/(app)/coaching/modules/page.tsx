// ─────────────────────────────────────────────────────────────
// /[locale]/coaching/modules — learning modules library
// ─────────────────────────────────────────────────────────────
// Spike source: src/app/[locale]/(app)/coaching/modules/page.tsx
//
// Catalog page reached from:
//   1. /coaching → AssignModulesCard "すべてのモジュールを見る"
//   2. /coaching/staff/[id] → "学習モジュールを割り当てる"
//      (carries ?staff=[id] → opens with that staff pre-selected)
//
// Role check is UI-only — backend MUST also enforce:
//   - Catalog read is Layer 2 (any auth'd staff in the org)
//   - learning_assignments INSERT/DELETE is Layer 3 (owner only)
//
// DATA POSTURE
//
// Both modules + staff are null until Anthony wires:
//   useLearningModulesData() → server-joined catalog with the
//       AI-generation marker + completionRate per assigned staff
//   useStaffPerformanceData() → consenting roster used as
//       eligible assignment targets
//
// Until then the view renders the full chrome (header, AI
// callout, search, tabs, category chips placeholder) with a
// 対応予定 scaffold pane in the grid slot.

import { Suspense } from 'react'

import { LearningModulesView } from '@/components/coaching/redesign/LearningModulesView'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import CoachingModulesLoading from './loading'

export default async function CoachingModulesPage() {
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

  // Suspense boundary required because LearningModulesView reads
  // useSearchParams() — Next bails static prerender otherwise.
  return (
    <Suspense fallback={<CoachingModulesLoading />}>
      <LearningModulesView role={role} modules={null} staff={null} />
    </Suspense>
  )
}
