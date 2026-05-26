'use client'

// ─────────────────────────────────────────────────────────────
// ImportPageView — /data-import client orchestrator
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/import/ImportPage.tsx
// Owner-only page that assembles the 4 sub-components into the
// full import flow. Replaces the prior 51-line hand-rolled stub.
//
// Layout (top to bottom):
//   1. ImportStepper          (4-step progress)
//   2. ImportScopePicker      (customers / reservations / karute)
//   3. ImportDropzone         (drag-drop + file picker + format ref)
//   4. RecentImportsTable     (past jobs with status + download)

import { useState } from 'react'

import { ImportDropzone } from './ImportDropzone'
import { ImportScopePicker } from './ImportScopePicker'
import { ImportStepper } from './ImportStepper'
import { RecentImportsTable } from './RecentImportsTable'
import type { ImportRecord, ImportScope } from './types'

interface ImportPageViewProps {
  recentImports: ImportRecord[]
}

export function ImportPageView({ recentImports }: ImportPageViewProps) {
  const [scope, setScope] = useState<ImportScope>('customers')

  return (
    <>
      <ImportStepper activeStep={0} />
      <ImportScopePicker value={scope} onChange={setScope} />
      <div className="mb-6">
        <ImportDropzone scope={scope} />
      </div>
      <RecentImportsTable records={recentImports} />
    </>
  )
}
