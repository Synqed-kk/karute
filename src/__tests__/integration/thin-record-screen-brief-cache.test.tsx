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
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
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
import { emitRevalidate } from '../../../thin/ports/nav.vite'

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

    // Precondition: a fulfilled cache entry already holds the OLD brief.
    setApiFetch(jest.fn().mockResolvedValue(jsonResponse({ brief: makeBrief('AI-BRIEF-OLD') })))
    await fetchBrief(briefPath)
    expect(cacheHas(briefPath)).toBe(true)

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
    // Call 1: the Probe's own initial fetchBrief. Call 2: useBrief's mount
    // effect ALSO fires an unconditional revalidate the moment the entry it
    // just fetched is fulfilled (design bullet 4 — the mount effect only
    // actually runs once the Suspense retry commits, by which point the
    // entry is already fulfilled from that very fetch) — same content, so
    // it's a no-op swap. Call 3 is the deliberate stale-triggered refetch
    // under test, with genuinely different content.
    const apiFetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ brief: makeBrief('v1') }))
      .mockResolvedValueOnce(jsonResponse({ brief: makeBrief('v1') }))
      .mockResolvedValueOnce(jsonResponse({ brief: makeBrief('v2') }))
    setApiFetch(apiFetch)

    // The Probe suspends on its very FIRST render (a brand-new pending
    // fetchBrief promise) — React's Suspense retry only commits inside an
    // explicit act() (a bare `waitFor` after an unwrapped `render()` can
    // leave "a suspended resource finished loading... not wrapped in act"
    // permanently un-flushed). An async act around the initial mount drives
    // the retry (and the mount-effect's own revalidate settling) properly.
    await act(async () => {
      renderProbe(customerId, appointmentId)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('probe').textContent).toBe('v1')
    expect(apiFetch).toHaveBeenCalledTimes(2) // baseline: mount fetch + its own revalidate

    // Freshly stamped (the mount-effect revalidate above just re-stamped
    // fetchedAtByUrl) — well inside STALE_MS, a foreground event is a no-op.
    act(() => emitRevalidate())
    expect(apiFetch).toHaveBeenCalledTimes(2)

    // Push the stamp past STALE_MS (30s).
    fetchedAtByUrl.set(url, Date.now() - 31_000)
    act(() => emitRevalidate())
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('v2'))
    expect(apiFetch).toHaveBeenCalledTimes(3)
  })
})
