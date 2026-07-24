/**
 * @jest-environment jsdom
 *
 * brief-cache.ts (perf packet 33) — client cache of resolved pre-session
 * briefs, mirroring ScreenBoundary's dtoCache idioms (generation fence,
 * signed-out wipe, in-flight dedupe) for the AI brief specifically. Pins:
 * the exact URL shape both the warm and RecordScreen route through · a
 * pending fetch is in-flight-deduped (concurrent callers share ONE apiFetch)
 * · a failed/no-signal response IS cached as an instantly-stale fulfilled
 *   null (silent-revalidate recovery — never a per-render refetch loop; the
 *   old delete-on-null contract was Liam field bug 7/25 #2) · an honest
 *   200 {brief:null} is cached fresh (the next call reuses it,
 * naturally) · a straggler that settles after a generation bump never
 * populates the cache · signed-out wipes it (shared-iPad leak guard) while
 * emitRefresh only STALE-MARKS it (post-mutation freshness re-checks ride
 * the silent revalidate path — a hard clear re-suspended painted cards,
 * Liam field bug 7/25 #2).
 *
 * React-mount consumption (useBrief via RecordScreen, plus the foreground
 * staleness gate) is pinned separately in
 * thin-record-screen-brief-cache.test.tsx.
 */
import type { Session } from '@supabase/supabase-js'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import type { PreSessionBriefResult } from '@/lib/karute/ai-brief'
import {
  briefUrl,
  cacheHas,
  fetchBrief,
  fetchedAtByUrl,
  revalidateBrief,
} from '../../../thin/data/brief-cache'
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

  it('a failed fetch IS cached as an instantly-stale fulfilled null — later calls reuse it, no render-loop refetch (Liam field bug 7/25 #2)', async () => {
    // The old delete-on-null contract turned every null settle into a
    // re-shimmer machine: fetchBrief runs during render, so a deleted entry
    // meant every later re-render minted a fresh pending promise and
    // re-suspended the painted card. The fix keeps the settle and marks
    // recovery via staleness instead: fetchedAt=0 (instantly stale) so the
    // SILENT revalidate path retries — never a visible re-suspend.
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue({ ok: false, json: async () => ({ brief: makeBrief('unreachable') }) } as unknown as Response)
    mockApiFetch(apiFetch)
    const url = briefUrl('fail-c', 'fail-a', 'ja')

    const p1 = fetchBrief(url)
    const brief = await p1
    expect(brief).toBeNull()
    expect(cacheHas(url)).toBe(true) // kept — the card settles once, no loop
    expect(p1.status).toBe('fulfilled')
    expect(fetchedAtByUrl.get(url)).toBe(0) // failure marker: instantly stale

    const p2 = fetchBrief(url)
    expect(p2).toBe(p1) // same entry, NO second network call from a re-render
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('an honest 200 {brief:null} is cached FRESH — the plan-gate/no-data answer never re-fetches per render', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(jsonResponse({ brief: null }))
    mockApiFetch(apiFetch)
    const url = briefUrl('null-c', 'null-a', 'ja')

    const p1 = fetchBrief(url)
    expect(await p1).toBeNull()
    expect(cacheHas(url)).toBe(true)
    expect(fetchedAtByUrl.get(url)).toBeGreaterThan(0) // fresh, not failure-marked

    expect(fetchBrief(url)).toBe(p1)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('a failure-marked entry upgrades SILENTLY via revalidateBrief — swap in place, no cache miss window', async () => {
    let calls = 0
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(async () => {
      calls++
      if (calls === 1) return { ok: false, json: async () => null } as unknown as Response
      return jsonResponse({ brief: makeBrief('recovered') })
    })
    mockApiFetch(apiFetch)
    const url = briefUrl('rec-c', 'rec-a', 'ja')

    const p1 = fetchBrief(url)
    await p1 // settles as failure-marked null, kept in cache

    const changed = await revalidateBrief(url)
    expect(changed).toBe(true) // upgraded
    const entry = fetchBrief(url) // cache hit on the swapped-in entry
    expect(entry.status).toBe('fulfilled')
    expect(entry.value?.concerns).toEqual(['recovered'])
    expect(fetchedAtByUrl.get(url)).toBeGreaterThan(0) // no longer failure-marked
    expect(cacheHas(url)).toBe(true)
  })

  it('same-user settle echo mid-flight does NOT drop the brief (Liam field bug 7/25: boot double-settle flashed the card twice)', async () => {
    let resolve: (r: Response) => void = () => {}
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    mockApiFetch(apiFetch)
    const url = briefUrl('echo-c', 'echo-a', 'ja')

    const promise = fetchBrief(url)
    expect(cacheHas(url)).toBe(true) // pending entry present, at fetch START

    // A same-user signed-in settle — the cold-boot recover + INITIAL_SESSION
    // echo both land exactly this write, and it DOES bump currentGeneration()
    // (screen-prefetch's `armed` comment documents the same trap). The old
    // generation fence treated this routine echo as "different user" and
    // discarded + deleted the in-flight brief, so a record page painted
    // before boot churn finished flashed to fallback and re-shimmered per
    // settle. The fence's real job is SIGN-OUT stragglers only.
    setSessionState({
      status: 'signed-in',
      session: { access_token: 't', user: { id: 'u1' } } as Session,
    })

    resolve(jsonResponse({ brief: makeBrief('survives-echo') }))
    const result = await promise
    expect(result).not.toBeNull() // brief survives the echo
    expect(result?.concerns).toEqual(['survives-echo'])
    expect(cacheHas(url)).toBe(true) // still cached — no re-shimmer on next render
  })

  it('sign-out straggler: a fetch in flight across a sign-out is dropped, not cached (shared-iPad leak guard)', async () => {
    let resolve: (r: Response) => void = () => {}
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    mockApiFetch(apiFetch)
    const url = briefUrl('strag-c', 'strag-a', 'ja')

    const promise = fetchBrief(url)
    setSessionState({ status: 'signed-out' }) // wipes cache AND bumps the epoch

    resolve(jsonResponse({ brief: makeBrief('post-signout') }))
    const result = await promise
    expect(result).toBeNull() // never handed to the next user's session
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

  it('emitRefresh (post-mutation) KEEPS entries and marks them stale — painted content never re-suspends, freshness re-checks silently', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(jsonResponse({ brief: makeBrief('pre-refresh') }))
    mockApiFetch(apiFetch)
    const url = briefUrl('refresh-c', 'refresh-a', 'ja')

    const p1 = fetchBrief(url)
    await p1
    expect(cacheHas(url)).toBe(true)
    expect(fetchedAtByUrl.get(url)).toBeGreaterThan(0)

    emitRefresh()
    // Entry survives (a mounted card keeps painting it, a re-render reuses
    // it — the hard clear here was half of Liam's 7/25 double-flash); only
    // the freshness stamp is gone, so the silent revalidate path re-checks.
    expect(cacheHas(url)).toBe(true)
    expect(fetchedAtByUrl.get(url)).toBeUndefined()
    expect(fetchBrief(url)).toBe(p1) // no render-loop refetch
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('refresh-epoch fence: a fetch that STARTED pre-refresh settles KEPT but instantly stale — pre-mutation content never stamps itself fresh', async () => {
    let resolve: (r: Response) => void = () => {}
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    mockApiFetch(apiFetch)
    const url = briefUrl('stamp-c', 'stamp-a', 'ja')

    const promise = fetchBrief(url)
    emitRefresh() // lands while the fetch is in flight

    // The straggler settles with a VALID brief — possibly pre-mutation. It
    // stays painted (never blank a card) but must be instantly stale so the
    // next revalidate signal re-checks it against post-mutation truth.
    resolve(jsonResponse({ brief: makeBrief('late-valid') }))
    await promise

    expect(cacheHas(url)).toBe(true)
    expect(fetchedAtByUrl.get(url)).toBe(0)
  })

  it('failure-delete fence (Greptile #603 P1 class): a stale failure from user A never deletes user B\'s newer entry', async () => {
    // The wipe-then-refetch replacement is now only reachable across a
    // SIGN-OUT (emitRefresh keeps entries). Sequence: fetch A held pending →
    // sign-out (clears + bumps the epoch) → user B signs in and fetches the
    // same url (entry B) → A settles. A's sign-out branch must delete only
    // its OWN entry — an unconditional cache.delete(url) would evict B.
    const resolvers: Array<(r: Response) => void> = []
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(
      () =>
        new Promise<Response>((r) => {
          resolvers.push(r)
        }),
    )
    mockApiFetch(apiFetch)
    const url = briefUrl('replace-c', 'replace-a', 'ja')

    const pA = fetchBrief(url)
    setSessionState({ status: 'signed-out' }) // clears cache, bumps epoch
    setSessionState({
      status: 'signed-in',
      session: { access_token: 't2', user: { id: 'u2' } } as Session,
    })
    const pB = fetchBrief(url) // user B's fresh entry for the same url
    expect(apiFetch).toHaveBeenCalledTimes(2)

    resolvers[0](jsonResponse({ brief: makeBrief('a-stale') })) // A settles late
    const briefA = await pA
    expect(briefA).toBeNull() // cross-sign-out straggler never hands over data
    expect(cacheHas(url)).toBe(true) // B's entry survives A's settle

    resolvers[1](jsonResponse({ brief: makeBrief('b-wins') }))
    const briefB = await pB
    expect(briefB?.concerns[0]).toBe('b-wins')
    expect(cacheHas(url)).toBe(true)
    expect(fetchedAtByUrl.get(url)).toBeGreaterThan(0) // B stamps normally
  })

  it('FIFO cap: the 51st distinct url evicts the oldest key from both maps', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(jsonResponse({ brief: makeBrief('x') }))
    mockApiFetch(apiFetch)

    const urls = Array.from({ length: 51 }, (_, i) => briefUrl('cap-c', `cap-a-${i}`, 'ja'))
    for (const url of urls) await fetchBrief(url)

    expect(cacheHas(urls[0])).toBe(false)
    expect(fetchedAtByUrl.has(urls[0])).toBe(false)
    expect(cacheHas(urls[1])).toBe(true)
    expect(cacheHas(urls[50])).toBe(true)
  })
})

describe('revalidateBrief', () => {
  it('a revalidate straggling across an emitRefresh keeps the painted entry but must NOT stamp it fresh', async () => {
    const url = briefUrl('straggler-c', 'straggler-a', 'ja')
    mockApiFetch(
      jest
        .fn<Promise<Response>, unknown[]>()
        .mockResolvedValue(jsonResponse({ brief: makeBrief('A') })),
    )
    await fetchBrief(url)
    expect(cacheHas(url)).toBe(true)

    let resolveRevalidate: (r: Response) => void = () => {}
    mockApiFetch(
      jest.fn<Promise<Response>, unknown[]>(
        () =>
          new Promise<Response>((r) => {
            resolveRevalidate = r
          }),
      ),
    )
    const revalidatePromise = revalidateBrief(url)

    // A mutation elsewhere lands WHILE the revalidate is in flight — its
    // body may be pre-mutation. Entries survive (stale-marked, no clear).
    emitRefresh()
    expect(cacheHas(url)).toBe(true)
    expect(fetchedAtByUrl.get(url)).toBeUndefined()

    // The straggler settles with DIFFERENT content — the entry must stay
    // painted-but-STALE: no swap claim, no freshness stamp; the next signal
    // re-checks against post-mutation truth.
    resolveRevalidate(jsonResponse({ brief: makeBrief('B') }))
    const changed = await revalidatePromise
    expect(changed).toBe(false)
    expect(cacheHas(url)).toBe(true)
    expect(fetchedAtByUrl.get(url)).toBeUndefined()
  })
})
