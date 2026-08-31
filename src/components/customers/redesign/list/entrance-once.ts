'use client'

import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────
// Entrance cascade — a FIRST-LOAD moment, not a per-visit one
// ─────────────────────────────────────────────────────────────
// The customer rows carry a staggered `animate-in` entrance (animation lab,
// 2026-08-25). The App Router unmounts the page segment on every tab hop and
// re-creates it on the way back — measured 2026-09-01, .build-evidence/repro:
// the shared layout's mount count stays at 1 while the page's climbs on every
// visit — so the rows are brand-new DOM each time and the CSS animation
// replays from zero. At ~59 visible rows x 40ms that is a 2.4s cascade on
// EVERY tap of the 顧客 tab: "it just looks broken" (Liam, 2026-09-01).
//
// Module scope, deliberately NOT sessionStorage: it survives the route
// remounts inside one running app session and resets on a hard reload, which
// is exactly the wanted envelope — the design moment still plays when the app
// is actually opened, and never again while the staffer works. No storage
// API, no quota path, no try/catch.
//
// SSR contract (why this cannot mismatch hydration or leak between requests):
// the flag is READ during render but WRITTEN only from an effect, and effects
// never run on the server. So the server-process copy stays `false` for the
// life of the process — every server render emits the entrance classes, and
// the first client render reads the same `false` and agrees with it. A soft
// tab re-visit renders only on the client, where the flag is already `true`.
let entrancePlayed = false

/**
 * True only for the first list mount in this app session — the one that
 * should play the entrance cascade. Read ONCE per mount (useState
 * initializer) so the answer is stable for that mount's whole life, and
 * flipped only after the play, from an effect.
 */
export function useEntranceOnce(): boolean {
  const [play] = useState(() => !entrancePlayed)
  useEffect(() => {
    entrancePlayed = true
  }, [])
  return play
}

/** Test-only seam — a module-scope flag has no other way back to `false`.
 *  Guarded: an accidental production import would silently defeat the
 *  once-per-session contract, and NODE_ENV is inlined at build time so the
 *  throw costs the app bundle nothing. */
export function __resetEntranceOnceForTests() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__resetEntranceOnceForTests is test-only')
  }
  entrancePlayed = false
}
