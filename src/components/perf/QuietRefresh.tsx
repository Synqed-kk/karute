'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * SWR delivery for the WEB screens — "show the remembered screen instantly,
 * refresh quietly behind it".
 *
 * Two halves, and neither works without the other:
 *
 *  1. `experimental.staleTimes.dynamic` (next.config.ts) lets the client router
 *     reuse a screen it already holds, so a revisit paints with zero server
 *     wait instead of re-paying the 1.0–2.6s server fan-out measured on prod
 *     (2026-07-30 speed pass).
 *  2. THIS component is what makes a LONG reuse window honest: when the copy
 *     the router just served is older than FRESH_MS, it fires exactly one
 *     `router.refresh()`. A refresh is not a navigation — the screen stays on
 *     screen and `loading.tsx` never re-appears — so the stale copy is
 *     corrected in place, behind the user's back.
 *
 * `renderedAt` is stamped by the SERVER page, so it rides inside that page
 * segment's RSC payload: a router-cache-served copy carries the OLD stamp
 * (stale → refresh), a freshly-fetched one carries a new stamp (fresh → no
 * refresh). No client clock is trusted for anything but the delta.
 *
 * Uncorrected-staleness ceiling: FRESH_MS (25s), which is TIGHTER than the 30s
 * window shipped in round 1 — past 25s a served copy always repaints AND
 * self-corrects. In-app writes stay exact regardless: a Server Action
 * invalidates the router cache, so the next read is live.
 *
 * ponytail: Next 16's refresh bumps a GLOBAL segment-cache version (see
 * refreshReducer → invalidateSegmentCacheEntries) and then re-prefetches
 * visible links, so a quiet refresh also costs the sibling screens their
 * cached copies plus the prefetch traffic to refill them. That is the known
 * ceiling of this approach and the reason FRESH_MS is generous rather than
 * aggressive. Upgrade path if the background traffic ever bites: per-screen
 * one-packet endpoints (the facade pattern ported to web), which make the
 * refetch itself cheap instead of trying to avoid it.
 *
 * WEB-ONLY by construction: the native shell renders the Vite thin bundle and
 * never mounts these page components, and the facade screen routes return JSON
 * without React. Nothing here is reachable from the app.
 */
const FRESH_MS = 25_000

export function QuietRefresh({ renderedAt }: { renderedAt: number }) {
  const router = useRouter()
  // Hard stop against a refresh loop: if a refresh ever came back with an
  // unchanged `renderedAt` (a server that stopped re-rendering), the effect
  // would otherwise re-fire forever and hammer the function. One per mount.
  const refreshed = useRef(false)

  useEffect(() => {
    if (refreshed.current) return
    if (Date.now() - renderedAt < FRESH_MS) return
    // A backgrounded tab refreshing serves nobody and still costs a render.
    if (document.visibilityState === 'hidden') return
    refreshed.current = true
    router.refresh()
  }, [renderedAt, router])

  return null
}
