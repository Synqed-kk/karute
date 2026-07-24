// Client cache of resolved pre-session briefs (perf packet 33), mirroring
// ScreenBoundary's dtoCache idioms (generation fence, signed-out wipe,
// STALE_MS foreground revalidate) for the AI brief specifically. Before this,
// RecordScreen.tsx's useMemo built a brand-NEW fetch promise every mount, so
// a revisit seconds later paid a full facade RTT and re-shimmered
// BriefLoadingCard even though nothing changed. This module is the single
// URL builder + cache BOTH the warm (brief-warm.ts) and the screen
// (RecordScreen.tsx) route through — a cache hit lets use() read
// synchronously (zero shimmer), and a warm-populated entry paints the AI
// card instantly on the FIRST 録音 open too.
//
// MEMORY ONLY — never persisted (customer data at rest ruling, 7/24).

import { useEffect, useReducer, useRef } from 'react'
import { getDataPort } from '@/lib/ports/data-port'
import { getSessionState, subscribeSessionState } from '@/lib/auth/mobile/session-store'
import { subscribeRefresh, subscribeRevalidate } from '../ports/nav.vite'
// type-only: erased at compile time, same rationale as RecordScreen.tsx's
// import of this type — never triggers ai-brief.ts's server-only guard.
import type { PreSessionBriefResult } from '@/lib/karute/ai-brief'

const enc = encodeURIComponent

/** THE single pre-session-brief URL builder — the cache key contract both
 *  the warm and the screen route through. Byte-identical to the two
 *  literals it replaces (RecordScreen.tsx / brief-warm.ts). */
export function briefUrl(
  customerId: string,
  appointmentId: string | null,
  locale: string,
): string {
  const appt = appointmentId ? `&appointmentId=${enc(appointmentId)}` : ''
  return `/api/app/v1/customers/${enc(customerId)}/ai/pre-session-brief?locale=${locale}${appt}`
}

/** React's use()-thenable-with-status contract: a fulfilled entry lets a
 *  revisit's use() read synchronously instead of suspending. */
export type StampedPromise = Promise<PreSessionBriefResult | null> & {
  status?: 'fulfilled'
  value?: PreSessionBriefResult | null
}

const cache = new Map<string, StampedPromise>()
// Exported for the packet's staleness tests, same rationale ScreenBoundary's
// fetchedAtByPath gives — probing it directly instead of waiting out 30s.
export const fetchedAtByUrl = new Map<string, number>()
const revalidating = new Set<string>()

// Straggler fence for in-flight fetches — bumped ONLY on sign-out (brief-
// warm.ts's epoch idiom), NOT currentGeneration(). The generation bumps on
// EVERY authoritative session-store write, including the cold-boot recover +
// INITIAL_SESSION echo for the SAME user (screen-prefetch's `armed` comment
// documents the same trap) — a generation fence here discarded + deleted a
// brief fetch straddling routine boot churn, so a record page painted before
// the churn finished (the packet-35 1s prefetch made this the normal case)
// flashed to fallback and re-shimmered once per settle (Liam field bug
// 7/25, force-quit reproducible). The fence's real job is narrower: a fetch
// started under user A must never populate user B's cache — and only a
// SIGN-OUT can sit between those two.
let sessionEpoch = 0
// Bumped on every emitRefresh (see the subscriber at the bottom): a settle
// whose fetch STARTED before a post-mutation refresh stamps fetchedAt=0
// (content kept, instantly stale) instead of fresh — pre-mutation content
// may paint for one silent-revalidate round trip, never longer.
let refreshEpoch = 0

// FIFO cap mirroring ScreenBoundary's dtoCache — only a NEW key can evict;
// replacing an existing url's entry (revalidate) never grows the map.
const CACHE_CAP = 50
function cacheBrief(url: string, promise: StampedPromise): void {
  if (cache.size >= CACHE_CAP && !cache.has(url)) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest !== undefined) {
      cache.delete(oldest)
      fetchedAtByUrl.delete(oldest)
    }
  }
  cache.set(url, promise)
}

// Foreground staleness gate — mirrors ScreenBoundary's STALE_MS.
const STALE_MS = 30_000

// Pre-stamped resolved null — stable identity, never suspends. Served when
// there's no customer to fetch a brief for (walk-in / no target).
const NULL_BRIEF: StampedPromise = Promise.resolve(null)
NULL_BRIEF.status = 'fulfilled'
NULL_BRIEF.value = null

type BriefBody = { brief?: PreSessionBriefResult | null } | null

// Failure is distinguished from the server's honest "no brief" (200 with
// brief:null — plan gate, no generatable data, generator fallback): both
// settle the card on the mechanical fallback, but a FAILURE is retried
// silently on the next revalidate signal (fetchedAt=0 → instantly stale)
// while a real null is fresh for STALE_MS like any other answer.
type BriefSettle = { brief: PreSessionBriefResult | null; failed: boolean }

async function readBrief(res: Response): Promise<BriefSettle> {
  if (!res.ok) return { brief: null, failed: true }
  const body = (await res.json().catch(() => null)) as BriefBody
  if (body === null) return { brief: null, failed: true }
  return { brief: body.brief ?? null, failed: false }
}

/** Returns the cached entry (pending or fulfilled) or starts ONE fetch —
 *  concurrent callers for the same url (warm + mount) share it (in-flight
 *  dedupe). Goes into the map at fetch START (pending), not on resolve. */
export function fetchBrief(url: string): StampedPromise {
  const existing = cache.get(url)
  if (existing) return existing

  const epoch = sessionEpoch
  const rEpoch = refreshEpoch
  const promise: StampedPromise = getDataPort()
    .apiFetch(url)
    .then(readBrief)
    .catch((): BriefSettle => ({ brief: null, failed: true }))
    .then(({ brief, failed }) => {
      // Straggler fence: a fetch that started before a SIGN-OUT must never
      // populate the next user's cache. Sign-out epoch, deliberately not
      // currentGeneration() — see the sessionEpoch note above.
      if (sessionEpoch !== epoch) {
        if (cache.get(url) === promise) cache.delete(url)
        return null
      }
      // EVERY same-session settle is kept — null included (Liam field bug
      // 7/25 #2, the double force-reload): the old delete-on-null turned any
      // null settle (boot-window 401, timeout, plan gate, no-data — the
      // facade legitimately returns 200 {brief:null}) into a re-shimmer
      // machine. fetchBrief runs during RENDER, so with the entry deleted,
      // EVERY later re-render of the mounted screen (mount revalidate settle,
      // post-refresh settle — deterministically two per boot) minted a fresh
      // pending promise and re-suspended the already-painted card through
      // BriefLoadingCard. Keeping the fulfilled-null settles the card ONCE on
      // the mechanical fallback; recovery is the SILENT path instead:
      // maybeRevalidate → revalidateBrief → swap + force, which never
      // suspends. A FAILURE stamps fetchedAt=0 (instantly stale → the very
      // next revalidate signal retries); an honest server null stamps
      // fresh and re-asks only after STALE_MS like any other answer.
      // Stamping status/value on the promise itself is unconditional — any
      // in-flight consumer (use()) already holds THIS promise and needs the
      // value regardless of what the cache map currently points at. The
      // fetchedAtByUrl STAMP is identity-checked (Greptile #603 P1 class): a
      // straggler superseded by a newer fetch for the same url must not
      // leave a stamp that doesn't describe the cached entry.
      promise.status = 'fulfilled'
      promise.value = brief
      if (cache.get(url) === promise)
        fetchedAtByUrl.set(
          url,
          failed || refreshEpoch !== rEpoch ? 0 : Date.now(),
        )
      return brief
    })
  cacheBrief(url, promise)
  return promise
}

/** True if `url` has a live cache entry (pending or fulfilled) — lets a
 *  caller tell "already warmed" apart from "warmed, but the cache no longer
 *  holds it" (a post-mutation wipe). */
export function cacheHas(url: string): boolean {
  return cache.has(url)
}

/** Background freshness re-check (SWR posture). Single-flight per url. A
 *  failed/null/cross-generation revalidate never blanks content — same
 *  same-path rule ScreenBoundary applies to dtoCache. */
export async function revalidateBrief(url: string): Promise<boolean> {
  if (revalidating.has(url)) return false
  revalidating.add(url)
  // Identity snapshot at entry — the fence a settle checks against, same
  // spirit as the generation fence but for the CACHE ENTRY itself: a wipe
  // (emitRefresh/signed-out) or a replacement (another revalidate, a fresh
  // fetchBrief after a delete) mid-flight must not have this straggler
  // re-populate a cache slot it no longer recognizes.
  const before = cache.get(url)
  try {
    const epoch = sessionEpoch
    const rEpoch = refreshEpoch
    const { brief, failed } = await getDataPort()
      .apiFetch(url)
      .then(readBrief)
      .catch((): BriefSettle => ({ brief: null, failed: true }))
    // Sign-out epoch, not currentGeneration() — see the sessionEpoch note.
    if (sessionEpoch !== epoch || failed) return false
    // A refresh landed mid-flight: this body may be pre-mutation. Keep the
    // painted entry, leave it stale (no stamp) — the next signal re-checks.
    if (refreshEpoch !== rEpoch) return false
    if (cache.get(url) !== before) return false
    // An honest server null never BLANKS painted content (same-path rule),
    // but it does re-stamp freshness — without the stamp, a fulfilled-null
    // entry (plan gate / no data) would sit permanently stale and re-ask on
    // every revalidate signal.
    if (brief === null || JSON.stringify(brief) === JSON.stringify(before?.value)) {
      fetchedAtByUrl.set(url, Date.now())
      return false
    }
    const fresh: StampedPromise = Promise.resolve(brief)
    fresh.status = 'fulfilled'
    fresh.value = brief
    cacheBrief(url, fresh)
    fetchedAtByUrl.set(url, Date.now())
    return true
  } finally {
    revalidating.delete(url)
  }
}

/** The hook RecordScreen calls: returns a stamped promise for use(), and
 *  silently swaps in a fresh brief in the background (mount + foreground
 *  staleness) without ever re-suspending an already-painted card. */
export function useBrief(
  customerId: string | null,
  appointmentId: string | null,
  locale: string,
): StampedPromise {
  const url = customerId ? briefUrl(customerId, appointmentId, locale) : null
  const promise = url ? fetchBrief(url) : NULL_BRIEF
  const [, force] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!url) return
    let alive = true
    // ONE predicate for both triggers (mount + foreground): revalidate only
    // a FULFILLED entry that's past STALE_MS. A pending entry on mount is a
    // fresh in-flight fetch (no revalidate — it'll fulfill on its own), and
    // a just-fulfilled entry (mount right after a warm, or the previous
    // foreground revalidate) is fresh by definition — no double-fetch.
    const maybeRevalidate = () => {
      if (
        cache.get(url)?.status !== 'fulfilled' ||
        Date.now() - (fetchedAtByUrl.get(url) ?? 0) <= STALE_MS
      )
        return
      revalidateBrief(url).then((changed) => {
        if (changed && alive) force()
      })
    }
    maybeRevalidate()
    const unsubscribe = subscribeRevalidate(maybeRevalidate)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [url])

  // Failed-settle recovery (Liam field bug 7/25 #2): a FAILURE-stamped entry
  // (fetchedAt=0, see fetchBrief) retries on the very re-renders that used
  // to re-shimmer the card — a dto settle re-renders the screen anyway, and
  // this effect (no dep array = after every render) turns that moment into a
  // SILENT revalidate instead of a cache-miss re-suspend. Guards make it
  // near-free: only fires on a fulfilled entry explicitly marked failed, and
  // revalidateBrief's single-flight set dedupes bursts. The [url] effect's
  // mount/foreground path already covers failed entries too (age from 0 is
  // always past STALE_MS) — this one only closes the "failed after mount, no
  // further signal" window.
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )
  useEffect(() => {
    if (!url) return
    if (cache.get(url)?.status !== 'fulfilled') return
    // Retry when the entry carries NO fresh stamp: 0 = failure-marked at
    // settle; undefined = the stamp was cleared by a post-mutation refresh
    // (fetchedAtByUrl.clear() — the failure marker itself is erased by it,
    // which is why this checks "not fresh" rather than "=== 0"; the
    // device-faithful render pin went red on the narrower guard). Either
    // way the re-check is SILENT: revalidateBrief swaps content in place
    // and re-stamps, so this self-quiets after one round trip per entry.
    const stamp = fetchedAtByUrl.get(url)
    if (stamp !== undefined && stamp !== 0) return
    void revalidateBrief(url).then((changed) => {
      if (changed && mounted.current) force()
    })
  })

  return promise
}

// SHARED-IPAD LEAK GUARD (mirrors ScreenBoundary:73 / brief-warm.ts): a
// signed-out transition wipes every cached brief so the next user never
// reads the outgoing user's cache on first paint.
subscribeSessionState(() => {
  if (getSessionState().status === 'signed-out') {
    sessionEpoch++ // invalidate every in-flight fetch's settle (fence above)
    cache.clear()
    fetchedAtByUrl.clear()
  }
})

// Post-mutation refresh (nav.vite emitRefresh): the brief may derive from
// changed records — but a HARD clear here re-suspended the painted card
// through BriefLoadingCard on every mutation AND on every rotated-token boot
// (armSettleRefresh routes through emitRefresh), which is half of Liam's
// 7/25 double-flash. New posture = the dto layer's own: KEEP what's painted,
// mark every entry stale (fetchedAtByUrl cleared → age from 0 is always past
// STALE_MS), and let the silent revalidate machinery swap fresh content in
// without a loading frame — mounted screens via the failed/stale render
// effect + foreground signal, revisits via maybeRevalidate on mount. The
// refreshEpoch guard closes the in-flight straggler: a fetch that STARTED
// pre-mutation but settles post-mutation must not stamp itself fresh with
// pre-mutation content — it stamps 0 and the next signal re-checks it.
subscribeRefresh(() => {
  refreshEpoch++
  fetchedAtByUrl.clear()
})
