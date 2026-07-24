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

import { useEffect, useReducer } from 'react'
import { getDataPort } from '@/lib/ports/data-port'
import {
  currentGeneration,
  getSessionState,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
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

// Foreground staleness gate — mirrors ScreenBoundary's STALE_MS.
const STALE_MS = 30_000

// Pre-stamped resolved null — stable identity, never suspends. Served when
// there's no customer to fetch a brief for (walk-in / no target).
const NULL_BRIEF: StampedPromise = Promise.resolve(null)
NULL_BRIEF.status = 'fulfilled'
NULL_BRIEF.value = null

type BriefBody = { brief?: PreSessionBriefResult | null } | null

async function readBrief(res: Response): Promise<PreSessionBriefResult | null> {
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as BriefBody
  return body?.brief ?? null
}

/** Returns the cached entry (pending or fulfilled) or starts ONE fetch —
 *  concurrent callers for the same url (warm + mount) share it (in-flight
 *  dedupe). Goes into the map at fetch START (pending), not on resolve. */
export function fetchBrief(url: string): StampedPromise {
  const existing = cache.get(url)
  if (existing) return existing

  const gen = currentGeneration()
  const promise: StampedPromise = getDataPort()
    .apiFetch(url)
    .then(readBrief)
    .catch(() => null)
    .then((brief) => {
      // Straggler fence: a fetch that started before a sign-out (or any
      // authoritative transition) must never populate the NEXT user's
      // cache — same fence ScreenBoundary:167 uses for dtoCache.
      if (currentGeneration() !== gen) {
        if (cache.get(url) === promise) cache.delete(url)
        return null
      }
      // Failures (and no-signal responses) are NOT cached — the next
      // mount retries naturally, today's exact semantics.
      if (brief === null) {
        cache.delete(url)
        return null
      }
      promise.status = 'fulfilled'
      promise.value = brief
      fetchedAtByUrl.set(url, Date.now())
      return brief
    })
  cache.set(url, promise)
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
  try {
    const gen = currentGeneration()
    const brief = await getDataPort()
      .apiFetch(url)
      .then(readBrief)
      .catch(() => null)
    if (currentGeneration() !== gen || brief === null) return false
    const prevValue = cache.get(url)?.value
    if (JSON.stringify(brief) === JSON.stringify(prevValue)) {
      fetchedAtByUrl.set(url, Date.now())
      return false
    }
    const fresh: StampedPromise = Promise.resolve(brief)
    fresh.status = 'fulfilled'
    fresh.value = brief
    cache.set(url, fresh)
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
    const maybeRevalidate = () => {
      revalidateBrief(url).then((changed) => {
        if (changed && alive) force()
      })
    }
    // Pending entry on mount = fresh in-flight fetch → no revalidate.
    if (cache.get(url)?.status === 'fulfilled') maybeRevalidate()
    const unsubscribe = subscribeRevalidate(() => {
      if (Date.now() - (fetchedAtByUrl.get(url) ?? 0) > STALE_MS) maybeRevalidate()
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [url])

  return promise
}

// SHARED-IPAD LEAK GUARD (mirrors ScreenBoundary:73 / brief-warm.ts): a
// signed-out transition wipes every cached brief so the next user never
// reads the outgoing user's cache on first paint.
subscribeSessionState(() => {
  if (getSessionState().status === 'signed-out') {
    cache.clear()
    fetchedAtByUrl.clear()
  }
})

// Post-mutation refresh (nav.vite emitRefresh): the brief may derive from
// changed records — mirrors ScreenBoundary's dtoCache.clear() on refresh.
// Mounted screens re-fetch via their own machinery; revisits re-fetch on
// next mount.
subscribeRefresh(() => {
  cache.clear()
  fetchedAtByUrl.clear()
})
