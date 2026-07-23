'use client'

// DataPort wiring — the seam every `/api/*` call routes through.
//
// TWO accessors, one source of truth:
//   - useDataPort()  for components (React context; DEFAULT = same-origin, so
//     web needs NO provider and behaves byte-identically to today).
//   - getDataPort()  for non-component libs (e.g. ai-pipeline.ts) that cannot
//     call hooks. Module singleton, same default.
//
// The thin ENTRY (thin/main.tsx) calls setDataPort(vitePort) before render —
// same pattern as the recording port — and AppRoot wraps the tree in
// <DataPortProvider value={vitePort}> so both accessors resolve to the facade
// impl inside the bundle. Nothing else sets it — single source of truth.

import { createContext, useContext, type ReactNode } from 'react'
import type { DataPort } from './types'

/** Web default: same-origin passthrough. Identical to a bare `fetch(path,init)`. */
export const sameOriginDataPort: DataPort = {
  apiFetch: (path, init) => fetch(path, init),
  // Packet 23 (/data-export port): the anchor-click block moved out of
  // DataExportView's handleExport — web UX unchanged. One honest delta: the
  // view keeps its own object URL for the persistent link, so an export now
  // creates TWO unrevoked object URLs instead of one (same never-revoked
  // lifecycle as before the move, doubled; page navigation reclaims them).
  async deliverFile(blob, fileName) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    return 'downloaded'
  },
  supportsAutoDeliver: true,
}

// Module singleton for non-hook callers. AppRoot overrides it in the shell.
let current: DataPort = sameOriginDataPort
export function getDataPort(): DataPort {
  return current
}
export function setDataPort(port: DataPort): void {
  current = port
}

const DataPortContext = createContext<DataPort>(sameOriginDataPort)

export function DataPortProvider({
  value,
  children,
}: {
  value: DataPort
  children: ReactNode
}) {
  return <DataPortContext.Provider value={value}>{children}</DataPortContext.Provider>
}

/** Components: the active DataPort. Defaults to same-origin with no provider. */
export function useDataPort(): DataPort {
  return useContext(DataPortContext)
}
