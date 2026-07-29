'use client'

// Fetch-on-mount hook for the thin AI cards (suggested message / body
// prediction). Lives in src (not thin/screens) so the branchy part —
// cache seed, swap, authoritative-null clear, failure-keeps-value — is
// jest-reachable; the thin screen only composes it.
//
// Semantics (blind-round P1 fix, 2026-07-29):
//   · cached value renders synchronously; the mount fetch always still runs;
//   · a SUCCESSFUL response replaces the value — including replacing it with
//     NOTHING when the server says the card no longer exists (summary
//     cleared → draft gone): cache entry deleted, preview returns. Without
//     this, a staff member could send outreach text grounded in a summary
//     they deliberately deleted;
//   · a FAILED fetch (non-2xx, network error) changes nothing — the card
//     "can never look worse" doctrine only ever applies to failures, never
//     to an authoritative empty answer.
import { useEffect, useState } from 'react'
import { getDataPort } from '@/lib/ports/data-port'
import { getAiSlot, setAiSlot, deleteAiSlot, aiSlotEpoch } from '@/lib/karute/ai-slot-cache'

export function useAiSlot<T>(path: string | null, pick: (body: unknown) => T | null): T | null {
  const [value, setValue] = useState<T | null>(() =>
    path ? ((getAiSlot(path) as T | undefined) ?? null) : null,
  )
  useEffect(() => {
    if (!path) return
    let alive = true
    // Captured at request start: if a sign-out wipe bumps the epoch while
    // this fetch is in flight, its response may touch NOTHING — not the
    // cache (Greptile #649 r1: a late write re-filled the wiped cache) and
    // not React state either (r2: setValue during the wipe→unmount gap
    // could momentarily paint the outgoing session's content). The cache
    // module enforces the fence for writes; `fresh` enforces it for state.
    const startedEpoch = aiSlotEpoch()
    const fresh = () => startedEpoch === aiSlotEpoch()
    getDataPort()
      .apiFetch(path)
      .then(async (res) => {
        if (!res.ok) return
        const v = pick(await res.json().catch(() => null))
        if (v) {
          setAiSlot(path, v, startedEpoch)
          if (alive && fresh()) setValue(v)
        } else {
          deleteAiSlot(path, startedEpoch)
          if (alive && fresh()) setValue(null)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick is a stable module fn; path drives the fetch
  }, [path])
  return value
}
