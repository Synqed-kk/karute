/**
 * @jest-environment jsdom
 *
 * brief-cache.ts (perf packet 33) — client cache of resolved pre-session
 * briefs, mirroring ScreenBoundary's dtoCache idioms (generation fence,
 * signed-out wipe, in-flight dedupe) for the AI brief specifically. Pins:
 * the exact URL shape both the warm and RecordScreen route through · a
 * pending fetch is in-flight-deduped (concurrent callers share ONE apiFetch)
 * · a failed/no-signal response is NOT cached (the next call retries
 * naturally) · a straggler that settles after a generation bump never
 * populates the cache · signed-out AND emitRefresh both wipe it (shared-iPad
 * leak guard / post-mutation staleness).
 *
 * React-mount consumption (useBrief via RecordScreen, plus the foreground
 * staleness gate) is pinned separately in
 * thin-record-screen-brief-cache.test.tsx.
 */
import type { Session } from '@supabase/supabase-js'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import type { PreSessionBriefResult } from '@/lib/karute/ai-brief'
import { briefUrl, cacheHas, fetchBrief } from '../../../thin/data/brief-cache'
import { emitRefresh } from '../../../thin/ports/nav.vite'

function makeBrief(concern: string): PreSessionBriefResult {
  return {
    isFirstTimeVisit: false,
    lastVisitDate: '2026年7月1日',
    lastVisitAgo: '3日前',
    hooks: [],
    concerns: [concern],
    lastProduct: null,
    recommendedFocus: null,
    reservationMemo: null,
    memoAnalysis: [],
  }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

function mockApiFetch(apiFetch: jest.Mock): void {
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
}

afterEach(() => {
  // Two-step reset (established codebase idiom): the signed-out flip also
  // clears brief-cache's own cache/fetchedAtByUrl via its signed-out
  // subscriber (same fence ScreenBoundary's dtoCache uses) — isolates tests
  // even though the module-level maps aren't reset any other way.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('briefUrl — the cache-key contract', () => {
  it('pins the exact byte shape the warm/screen cache key depends on', () => {
    expect(briefUrl('c1', 'a1', 'ja')).toBe(
      '/api/app/v1/customers/c1/ai/pre-session-brief?locale=ja&appointmentId=a1',
    )
    expect(briefUrl('c1', null, 'ja')).toBe(
      '/api/app/v1/customers/c1/ai/pre-session-brief?locale=ja',
    )
  })
})

describe('fetchBrief', () => {
  it('in-flight dedupe: two calls for the same url while pending share ONE apiFetch', async () => {
    let resolve: (r: Response) => void = () => {}
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    mockApiFetch(apiFetch)
    const url = briefUrl('dedupe-c', 'dedupe-a', 'ja')

    const p1 = fetchBrief(url)
    const p2 = fetchBrief(url)
    expect(p1).toBe(p2)
    expect(apiFetch).toHaveBeenCalledTimes(1)

    resolve(jsonResponse({ brief: makeBrief('x') }))
    await p1
  })

  it('a failed fetch is NOT cached — a later call re-fetches', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue({ ok: false } as Response)
    mockApiFetch(apiFetch)
    const url = briefUrl('fail-c', 'fail-a', 'ja')

    const brief = await fetchBrief(url)
    expect(brief).toBeNull()
    expect(cacheHas(url)).toBe(false)

    await fetchBrief(url)
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('cross-generation straggler: a fetch that settles after a generation bump is dropped, not cached', async () => {
    let resolve: (r: Response) => void = () => {}
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    mockApiFetch(apiFetch)
    const url = briefUrl('gen-c', 'gen-a', 'ja')

    const promise = fetchBrief(url)
    expect(cacheHas(url)).toBe(true) // pending entry present, at fetch START

    // An authoritative transition bumps currentGeneration(). Deliberately
    // NOT 'signed-out' — isolates the generation fence from the separate
    // signed-out wipe listener pinned in its own test below.
    setSessionState({
      status: 'signed-in',
      session: { access_token: 't', user: { id: 'u1' } } as Session,
    })

    resolve(jsonResponse({ brief: makeBrief('late') }))
    const result = await promise
    expect(result).toBeNull()
    expect(cacheHas(url)).toBe(false)
  })

  it('signed-out wipes the cache — a later call re-fetches (shared-iPad leak guard)', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(jsonResponse({ brief: makeBrief('pre-wipe') }))
    mockApiFetch(apiFetch)
    const url = briefUrl('wipe-c', 'wipe-a', 'ja')

    await fetchBrief(url)
    expect(cacheHas(url)).toBe(true)

    setSessionState({ status: 'signed-out' })
    expect(cacheHas(url)).toBe(false)

    await fetchBrief(url)
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('emitRefresh (post-mutation) wipes the cache', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(jsonResponse({ brief: makeBrief('pre-refresh') }))
    mockApiFetch(apiFetch)
    const url = briefUrl('refresh-c', 'refresh-a', 'ja')

    await fetchBrief(url)
    expect(cacheHas(url)).toBe(true)

    emitRefresh()
    expect(cacheHas(url)).toBe(false)
  })
})
