/**
 * @jest-environment jsdom
 *
 * RecordScreen × the client brief cache (perf packet 33). Before this,
 * RecordScreen.tsx's useMemo built a brand-new AI-brief fetch promise on
 * EVERY mount, so a revisit seconds later re-shimmered BriefLoadingCard for
 * a full facade round trip even though nothing had changed. useBrief
 * (thin/data/brief-cache.ts) now routes both the warm and the screen
 * through one module-level cache: a cache hit lets React's use() read the
 * brief SYNCHRONOUSLY on the very first render pass — the Suspense fallback
 * (BriefLoadingCard, an aria-busy section) never mounts at all.
 *
 * Pins:
 *  1. a revisit (same target, remount) paints the AI brief immediately —
 *     BriefLoadingCard never appears. THE discriminating test; mutation-
 *     proved (see the packet-33 report for the red-run evidence).
 *  2. warmBriefsForToday populating the cache ahead of time means the
 *     FIRST-ever screen mount for that appointment also paints instantly —
 *     the paint never waits on a fresh network round trip.
 *  7. a fulfilled cache entry whose content changed server-side (the mount-
 *     time revalidate, useBrief bullet 4) silently swaps in the new text —
 *     no re-suspend, BriefLoadingCard never renders during the swap.
 *  8. the foreground staleness gate (mirrors ScreenBoundary's STALE_MS): a
 *     fresh (<30s) foreground event is a no-op; a stale (>30s) one refetches.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
// @/i18n/navigation is next-intl's real router; RecordPageView only reads
// useRouter().replace for the booking-switcher, never exercised here (same
// stub shape as thin-customers-screen-mount.test.tsx).
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
// 'use server' modules RecordPageView (transitively, via global-recorder.ts)
// or RecordPageView itself pulls in — unsafe to load for real under jsdom
// (same rationale review-screen-discard.test.tsx documents for
// @/actions/customers: they pull in next/cache + the synqed client).
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))
// RecordPageView renders ReviewScreen (post-recording), which imports
// @/actions/karute — a 'use server' module that pulls in next/cache and
// (transitively) Next's server render-stream helpers, which reference
// TextEncoder in a way jsdom's environment doesn't provide. Same mock
// review-screen-discard.test.tsx uses to load ReviewScreen at all.
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))
jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(),
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
}))
// @synqed-kk/ui ships ESM-only (no CJS build) and isn't transformable in
// this suite (same wall review-screen-discard.test.tsx hit and stubbed
// around for RecordingConsentDialog) — RecordPageView and several of its
// leaves import it for Button/ConsentCheckCard/Select/etc. A Proxy
// passthrough covers every named export generically (div-with-children)
// without enumerating the package's surface; none of our assertions touch
// these primitives' own behavior.
jest.mock('@synqed-kk/ui', () => {
  // jest.mock factories run before the module's own ES imports are wired up
  // — requiring react here (rather than importing) is the standard idiom.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  return new Proxy(
    {},
    { get: () => passthrough },
  )
})
// take-store persists to Supabase in production; RecordPageView only reads
// "is there a recoverable take" at mount — none, here.
jest.mock('@/lib/karute/take-store', () => ({
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))

// thin/locale mocked (mutable var, defaults 'ja' — every OTHER test in this
// file uses a hardcoded 'ja' literal directly, never getThinLocale() itself,
// so this is a no-op for them): 2026-08-11 packet §3 D.1 armor fix needs an
// en-seeded mount-fetch-URL variant. An isolateModulesAsync fresh-registry
// reload of RecordScreen (a REACT COMPONENT, tried first) duplicates React
// itself — the freshly-loaded component's hooks then dispatch against a
// DIFFERENT react instance than @testing-library/react's renderer holds
// ("Cannot read properties of null (reading 'useState')"). Flipping this
// mock is the safe way to change what getThinLocale() returns without
// reloading the component tree.
let mockLocale: 'ja' | 'en' = 'ja'
jest.mock('../../../thin/locale', () => ({
  getThinLocale: () => mockLocale,
  setThinLocale: jest.fn(),
}))

import { Suspense, use } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import type { PreSessionBriefResult } from '@/lib/karute/ai-brief'
import { RecordScreen } from '../../../thin/screens/RecordScreen'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { warmBriefsForToday } from '../../../thin/data/brief-warm'
import { briefUrl, cacheHas, fetchBrief, fetchedAtByUrl, useBrief } from '../../../thin/data/brief-cache'
import { emitRefresh, emitRevalidate } from '../../../thin/ports/nav.vite'

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

const RECORD_SCREEN_PATH = '/api/app/v1/screens/record?locale=ja'

function recordDto(customerId: string, appointmentId: string) {
  return {
    locale: 'ja',
    customers: [],
    nextAppointment: {
      id: appointmentId,
      customerName: 'テスト 花子',
      customerId,
      karuteNumber: null,
      startTime: '2026-07-24T02:00:00.000Z',
      durationMinutes: 60,
      title: null,
      notes: null,
    },
    nearbyBookings: [],
    brief: null,
    recentRecordings: [],
    consentDate: null,
    visitSegment: null,
    visitRhythm: null,
    targetHasTicketPack: false,
    targetPack: null,
    previousPack: null,
    packPresets: [],
    staffCanCustomizePacks: true,
    staffCanDeletePhotos: true,
    ticketsEnabled: true,
    noiseSuppression: true,
    currentStaffName: null,
    viewerRole: 'practitioner',
  }
}

function setApiFetch(apiFetch: jest.Mock): void {
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
}

beforeEach(() => {
  dtoCache.clear()
  mockLocale = 'ja'
})

afterEach(() => {
  cleanup()
  jest.useRealTimers()
  // Two-step reset (established codebase idiom): also wipes ScreenBoundary's
  // dtoCache and brief-cache's own cache/fetchedAtByUrl via their shared
  // signed-out subscribers — full isolation between tests.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('RecordScreen — mount-fetch URL carries the runtime locale, not a re-hardcoded ja (armor fix, 2026-08-11 packet §3 D.1 — RECORD_SCREEN_PATH above evaluates ja on BOTH sides by default, so it would still pass a hardcoded ja literal in RecordScreen.tsx)', () => {
  it('en-seeded: the mount fetch requests locale=en', async () => {
    mockLocale = 'en'
    // Held forever (same idiom as thin-screen-prefetch.test.tsx's T5
    // cross-pin block) — only the first call's URL argument is under test.
    const apiFetch = jest.fn<Promise<Response>, unknown[]>(() => new Promise<Response>(() => {}))
    setApiFetch(apiFetch)

    render(<RecordScreen />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe('/api/app/v1/screens/record?locale=en')
  })
})

describe('RecordScreen — no-shimmer revisit (perf packet 33, THE discriminating test)', () => {
  it('a revisit (same target, remount) paints the AI brief immediately — BriefLoadingCard never appears', async () => {
    const customerId = 'revisit-c'
    const appointmentId = 'revisit-a'
    const dto = recordDto(customerId, appointmentId)
    const briefPath = briefUrl(customerId, appointmentId, 'ja')
    const apiFetch = jest.fn(async (path: string) => {
      if (path === RECORD_SCREEN_PATH) return jsonResponse(dto)
      if (path === briefPath) return jsonResponse({ brief: makeBrief('AI-BRIEF-REVISIT') })
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setApiFetch(apiFetch)

    const first = render(<RecordScreen />)
    await screen.findByText('AI-BRIEF-REVISIT')
    // RecordScreen's OWN mount-fetch URL builder (thin/screens/RecordScreen.tsx
    // — distinct from screen-prefetch.ts, covered separately) carries the
    // runtime locale, not a re-hardcoded literal (FOLLOW-UP §2 Ruling A).
    expect(apiFetch.mock.calls[0][0]).toBe(RECORD_SCREEN_PATH)
    first.unmount()

    // Revisit: remount the SAME target. Both the screen DTO (dtoCache,
    // packet 24) and the AI brief (brief-cache, this packet) are cache-hot —
    // the whole tree paints on the FIRST synchronous render pass, no
    // `waitFor` needed. That is the behavior under test.
    const { container } = render(<RecordScreen />)
    expect(screen.getByText('AI-BRIEF-REVISIT')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })
})

describe('RecordScreen — first mount performs exactly ONE brief fetch (perf packet 33, F1 fix)', () => {
  it('a brand-new target never double-fetches — the mount effect only revalidates a STALE fulfilled entry', async () => {
    const customerId = 'first-mount-c'
    const appointmentId = 'first-mount-a'
    const dto = recordDto(customerId, appointmentId)
    const briefPath = briefUrl(customerId, appointmentId, 'ja')
    let briefCalls = 0
    const apiFetch = jest.fn(async (path: string) => {
      if (path === RECORD_SCREEN_PATH) return jsonResponse(dto)
      if (path === briefPath) {
        briefCalls++
        return jsonResponse({ brief: makeBrief('AI-BRIEF-FIRST') })
      }
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setApiFetch(apiFetch)

    render(<RecordScreen />)
    await screen.findByText('AI-BRIEF-FIRST')
    // Give a (buggy) unconditional mount-revalidate every chance to have
    // already fired its second fetch before the final assertion — without
    // F1's staleness gate, the mount effect sees the entry it JUST fetched
    // as "fulfilled" and revalidates it immediately regardless of freshness.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(briefCalls).toBe(1)
  })
})

describe('RecordScreen — warm populates the cache (perf packet 33)', () => {
  it('warmBriefsForToday populating the cache ahead of time means the FIRST screen mount also paints instantly', async () => {
    jest.useFakeTimers()
    const customerId = 'warm-c'
    const appointmentId = 'warm-a'
    const dto = recordDto(customerId, appointmentId)
    const briefPath = briefUrl(customerId, appointmentId, 'ja')
    let briefCalls = 0
    const apiFetch = jest.fn(async (path: string) => {
      if (path === RECORD_SCREEN_PATH) return jsonResponse(dto)
      if (path === briefPath) {
        briefCalls++
        if (briefCalls === 1) return jsonResponse({ brief: makeBrief('AI-BRIEF-WARM') })
        // Any FURTHER call (e.g. useBrief's own mount-time background
        // revalidate, bullet 4 of the design) hangs forever — proves the
        // paint below never depended on / waited for it.
        return new Promise<Response>(() => {})
      }
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setApiFetch(apiFetch)

    warmBriefsForToday([{ customerId, appointmentId }])
    await act(async () => {
      jest.advanceTimersByTime(20_000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    jest.useRealTimers()
    expect(briefCalls).toBe(1) // warmed before any screen mount existed
    expect(cacheHas(briefPath)).toBe(true)

    const { container } = render(<RecordScreen />)
    await screen.findByText('AI-BRIEF-WARM')
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })
})

describe('RecordScreen — silent swap on changed content (perf packet 33)', () => {
  it('a mount-time revalidate that finds different content swaps it in without ever showing BriefLoadingCard', async () => {
    const customerId = 'swap-c'
    const appointmentId = 'swap-a'
    const briefPath = briefUrl(customerId, appointmentId, 'ja')

    // Precondition: a fulfilled cache entry already holds the OLD brief,
    // stamped STALE (past STALE_MS) — the mount revalidate is now gated on
    // exactly that (F1), so a fresh entry would legitimately stay put.
    setApiFetch(jest.fn().mockResolvedValue(jsonResponse({ brief: makeBrief('AI-BRIEF-OLD') })))
    await fetchBrief(briefPath)
    expect(cacheHas(briefPath)).toBe(true)
    fetchedAtByUrl.set(briefPath, Date.now() - 31_000)

    // The server now returns something DIFFERENT — both the screen's own
    // fetch and the mount-triggered revalidate hit this new mock.
    const dto = recordDto(customerId, appointmentId)
    const apiFetch = jest.fn(async (path: string) => {
      if (path === RECORD_SCREEN_PATH) return jsonResponse(dto)
      if (path === briefPath) return jsonResponse({ brief: makeBrief('AI-BRIEF-NEW') })
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setApiFetch(apiFetch)

    const { container } = render(<RecordScreen />)
    // First paint: the cache-hit OLD content, once the screen DTO settles —
    // never the loading skeleton.
    await screen.findByText('AI-BRIEF-OLD')
    expect(container.querySelector('[aria-busy]')).toBeNull()

    // useBrief's mount effect (entry already fulfilled) fires a background
    // revalidate; it differs from the cached value, so it silently swaps in.
    await waitFor(() => expect(screen.getByText('AI-BRIEF-NEW')).toBeInTheDocument())
    expect(screen.queryByText('AI-BRIEF-OLD')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })
})

describe('useBrief — foreground staleness gate (perf packet 33, mirrors ScreenBoundary STALE_MS)', () => {
  function Probe({ customerId, appointmentId }: { customerId: string; appointmentId: string }) {
    // Narrowed to the plain Promise type — same as how RecordPageViewProps
    // (`aiBriefPromise: Promise<PreSessionBriefResult | null>`) consumes it;
    // use()'s type overloads can't reconcile StampedPromise's optional
    // `status?: 'fulfilled'` literal directly.
    const promise: Promise<PreSessionBriefResult | null> = useBrief(customerId, appointmentId, 'ja')
    const brief = use(promise)
    return <div data-testid="probe">{brief?.concerns[0] ?? 'none'}</div>
  }

  function renderProbe(customerId: string, appointmentId: string) {
    return render(
      <Suspense fallback={<div data-testid="probe-loading" />}>
        <Probe customerId={customerId} appointmentId={appointmentId} />
      </Suspense>,
    )
  }

  it('a fresh (<30s) foreground event is a no-op; a stale (>30s) one refetches', async () => {
    const customerId = 'stale-c'
    const appointmentId = 'stale-a'
    const url = briefUrl(customerId, appointmentId, 'ja')
    // Call 1: the Probe's own initial fetchBrief. The mount effect's OWN
    // revalidate check (F1) shares the SAME staleness gate as the
    // foreground handler — a just-fulfilled entry is fresh by definition,
    // so mounting right after that fetch settles fires NO second call.
    // Call 2 is the deliberate stale-triggered refetch under test.
    const apiFetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ brief: makeBrief('v1') }))
      .mockResolvedValueOnce(jsonResponse({ brief: makeBrief('v2') }))
    setApiFetch(apiFetch)

    // The Probe suspends on its very FIRST render (a brand-new pending
    // fetchBrief promise) — React's Suspense retry only commits inside an
    // explicit act() (a bare `waitFor` after an unwrapped `render()` can
    // leave "a suspended resource finished loading... not wrapped in act"
    // permanently un-flushed). An async act around the initial mount drives
    // the retry properly.
    await act(async () => {
      renderProbe(customerId, appointmentId)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('probe').textContent).toBe('v1')
    expect(apiFetch).toHaveBeenCalledTimes(1) // baseline: exactly ONE fetch, F1's fix

    // Freshly stamped — well inside STALE_MS, a foreground event is a no-op.
    act(() => emitRevalidate())
    expect(apiFetch).toHaveBeenCalledTimes(1)

    // Push the stamp past STALE_MS (30s).
    fetchedAtByUrl.set(url, Date.now() - 31_000)
    act(() => emitRevalidate())
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('v2'))
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})

describe('RecordScreen — a failed brief settle never re-suspends the card; recovery is silent (Liam field bug 7/25 #2, THE symptom pin)', () => {
  it('brief fails once → card settles on the fallback WITHOUT a re-shimmer loop, then upgrades silently to the AI brief', async () => {
    const customerId = 'flash-c'
    const appointmentId = 'flash-a'
    const dto = recordDto(customerId, appointmentId)
    const briefPath = briefUrl(customerId, appointmentId, 'ja')
    let briefCalls = 0
    let failFirstBrief: (() => void) | null = null
    const apiFetch = jest.fn((path: string) => {
      if (path === RECORD_SCREEN_PATH) return Promise.resolve(jsonResponse(dto))
      if (path === briefPath) {
        briefCalls++
        // DEVICE-FAITHFUL ordering (the jsdom trap that made round 1 of this
        // pin theater): on a phone the brief's failure settles SECONDS after
        // mount — long after the [url] effect's initial maybeRevalidate ran
        // and skipped the then-PENDING entry. An instant-failing mock settles
        // BEFORE effects flush, so the mount path retried and masked the
        // no-dep retry effect entirely. Hold call 1 open across the mount.
        if (briefCalls === 1)
          return new Promise<Response>((resolve) => {
            failFirstBrief = () =>
              resolve({ ok: false, json: async () => null } as unknown as Response)
          })
        return Promise.resolve(jsonResponse({ brief: makeBrief('AI-RECOVERED') }))
      }
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setApiFetch(apiFetch)

    // Mount: dto settles, Inner mounts, brief fetch 1 goes PENDING and the
    // mount-side maybeRevalidate correctly skips it. Card = loading frame.
    await act(async () => {
      render(<RecordScreen />)
    })
    expect(briefCalls).toBe(1)

    // The boot failure lands (churn 401 / timeout / 5xx — readBrief
    // collapses them all): failure-marked null, KEPT in cache, card settles
    // on the mechanical fallback. No render has happened since, so nothing
    // has retried yet.
    await act(async () => {
      failFirstBrief?.()
    })
    expect(briefCalls).toBe(1)
    expect(cacheHas(briefPath)).toBe(true)
    expect(fetchedAtByUrl.get(briefPath)).toBe(0)

    // The boot's own next event — armSettleRefresh's emitRefresh → mounted
    // dto refetch → Inner re-render — is EXACTLY when the old contract
    // re-suspended into BriefLoadingCard (Liam's double force-reload). Now
    // it must instead trip the failed-retry effect: ONE silent revalidate,
    // content swaps in, never a loading frame.
    await act(async () => {
      emitRefresh()
    })
    await waitFor(() => expect(screen.getByText('AI-RECOVERED')).toBeInTheDocument())
    expect(briefCalls).toBe(2)
    expect(document.querySelector('[aria-busy]')).toBeNull()

    // Extra settles/renders after recovery stay quiet: fresh stamp, cache hit.
    act(() => emitRevalidate())
    await act(async () => {
      await Promise.resolve()
    })
    expect(briefCalls).toBe(2)
  })

  it('a permanently-null brief (plan gate / no data — the sim tenant shape) settles ONCE on the fallback: exactly one fetch, no loop', async () => {
    const customerId = 'null-c'
    const appointmentId = 'null-a'
    const dto = recordDto(customerId, appointmentId)
    const briefPath = briefUrl(customerId, appointmentId, 'ja')
    const apiFetch = jest.fn(async (path: string) => {
      if (path === RECORD_SCREEN_PATH) return jsonResponse(dto)
      if (path === briefPath) return jsonResponse({ brief: null }) // honest server null
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setApiFetch(apiFetch)

    await act(async () => {
      render(<RecordScreen />)
    })
    // The card settles on the mechanical fallback and STAYS there — the old
    // contract deleted the null entry, so every later render re-fetched and
    // re-shimmered (the sim showed this as a permanently cycling/empty card).
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter(([p]) => p === briefPath)).toHaveLength(1),
    )
    expect(cacheHas(briefPath)).toBe(true)

    // A fresh honest-null is NOT failure-marked: a foreground event inside
    // STALE_MS re-fetches nothing.
    act(() => emitRevalidate())
    await act(async () => {
      await Promise.resolve()
    })
    expect(apiFetch.mock.calls.filter(([p]) => p === briefPath)).toHaveLength(1)
    expect(document.querySelector('[aria-busy]')).toBeNull()
  })
})

describe('RecordScreen — refresh with a FAILED same-path dto refetch still silently refreshes the brief (Greptile #607 P1)', () => {
  it('the mounted brief re-checks on emitRefresh directly — no dependency on the dto refetch producing a re-render', async () => {
    const customerId = 'strand-c'
    const appointmentId = 'strand-a'
    const dto = recordDto(customerId, appointmentId)
    const briefPath = briefUrl(customerId, appointmentId, 'ja')
    let dtoCalls = 0
    let briefCalls = 0
    const apiFetch = jest.fn(async (path: string) => {
      if (path === RECORD_SCREEN_PATH) {
        dtoCalls++
        // Mount fetch succeeds; the POST-REFRESH refetch fails — the exact
        // ScreenBoundary same-path bail (setState returns identical prev, no
        // re-render) that used to strand the stale-marked brief.
        if (dtoCalls === 1) return jsonResponse(dto)
        return { ok: false, json: async () => null } as unknown as Response
      }
      if (path === briefPath) {
        briefCalls++
        if (briefCalls === 1) return jsonResponse({ brief: makeBrief('PRE-MUTATION') })
        return jsonResponse({ brief: makeBrief('POST-MUTATION') })
      }
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setApiFetch(apiFetch)

    await act(async () => {
      render(<RecordScreen />)
    })
    await waitFor(() => expect(screen.getByText('PRE-MUTATION')).toBeInTheDocument())

    // A mutation elsewhere refreshes; the dto refetch fails silently. The
    // brief's own refresh subscription must still revalidate and swap the
    // post-mutation content in — no loading frame, no foreground needed.
    await act(async () => {
      emitRefresh()
    })
    await waitFor(() => expect(screen.getByText('POST-MUTATION')).toBeInTheDocument())
    expect(document.querySelector('[aria-busy]')).toBeNull()
    expect(briefCalls).toBe(2)
  })
})
