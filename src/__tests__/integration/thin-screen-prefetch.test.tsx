/**
 * @jest-environment jsdom
 *
 * Background screen-DTO prefetch on app open (perf packet 34, PR-H) —
 * thin/data/screen-prefetch.ts. While staff look at the first screen after
 * sign-in, the OTHER screens' DTOs silently pre-load in the background
 * (mirrors brief-warm.ts's stagger/one-shot idioms and ScreenBoundary's
 * generation fence), so every first tap this session paints instantly
 * instead of shimmering for a full facade round trip.
 *
 * Pins:
 *  T1. one-shot is keyed to a CONTIGUOUS signed-in period, NOT the auth
 *      generation (fleet round 2 P1 fix): a resume/echo settle for the SAME
 *      user (which DOES bump the generation) schedules nothing — only a
 *      sign-out clears the arm.
 *  T2. schedule-time skip: a pre-cached target never gets a timer AT ALL —
 *      checked via timer count immediately, before any fire (distinct from
 *      the fire-time skip below, which the old test-1 alone couldn't tell
 *      apart from this one).
 *  2.  byte-pin: every cache-key path matches the owning screen's own
 *      literal exactly.
 *  3.  a path visited mid-stagger (before its timer fires) is skipped at
 *      fire time too — no fetch at all for it.
 *  4.  generation-fence straggler: an in-flight fetch that settles after
 *      sign-out never writes the cache.
 *  5.  clobber guard: a path the user visits WHILE its prefetch fetch is
 *      in flight keeps the fresher visit data — the stale settle never wins.
 *  6.  signed-out cancels every pending timer; the next sign-in re-arms a
 *      full batch.
 *  7.  a non-OK response and a schema parse failure both cache nothing,
 *      throw nothing, and are never retried (T3: the non-OK mock is
 *      "honest" — it HAS a working json() a buggy ok-guard would read).
 *  T4. the terminal `.catch(() => {})` swallows a rejected apiFetch with no
 *      unhandled promise rejection.
 *  8.  discriminating end-to-end (mutation-proved): a prefetch settle
 *      populates the cache before a screen ever mounts — the first mount of
 *      that screen (CustomersScreen, cheap to render) paints synchronously,
 *      no loading frame.
 *  T5. cross-pin: each of the other 4 screens' OWN first mount-effect fetch
 *      requests the exact path screen-prefetch.ts prefetches for it — the
 *      byte-pin test (2) alone only compares the module to a hand-copy of
 *      itself, so a screen-side path drift would silently kill that
 *      screen's prefetch with zero red test.
 */

// ---- CustomersScreen render harness (test 8) — same proven mock set as
// thin-customers-screen-mount.test.tsx, so the real CustomersScreen →
// CustomersListView chain mounts cleanly under jsdom.
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_, v: string) => String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`))
    },
  }
})
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/customers',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/components/customers/redesign/list/CustomersListHeader', () => ({
  CustomersListHeader: () => <div data-testid="header" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerSearchInput', () => ({
  CustomerSearchInput: () => <div data-testid="search" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerRowDesktop', () => ({
  CustomerRowDesktop: () => <div data-testid="row-desktop" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerCardMobile', () => ({
  CustomerCardMobile: () => <div data-testid="row-mobile" />,
}))

// ---- T5 cross-pin harness: the other 4 screens only need to reach their
// mount-effect fetch, never actual content — the heavy view each renders
// once 'ready' is shallow-mocked purely to keep their (transitively heavy,
// 'use server'-laden) real trees out of the module graph, same isolation
// precedent as thin-appointments-brief-warm.test.tsx's AppointmentsView mock.
jest.mock('@/components/karute/redesign/record/RecordPageView', () => ({
  RecordPageView: () => null,
}))
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: () => null,
}))
jest.mock('@/components/karute/spike-lifted/list/KaruteRecordListView', () => ({
  KaruteRecordListView: () => null,
}))
jest.mock('@/components/dashboard/redesign/DashboardPageView', () => ({
  DashboardPageView: () => null,
}))

import type { Session } from '@supabase/supabase-js'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { PREFETCH_PATHS } from '../../../thin/data/screen-prefetch'
import { CustomersScreen } from '../../../thin/screens/CustomersScreen'
import { RecordScreen } from '../../../thin/screens/RecordScreen'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'
import { SessionsScreen } from '../../../thin/screens/SessionsScreen'
import { DashboardScreen } from '../../../thin/screens/DashboardScreen'

const RECORD_PATH = '/api/app/v1/screens/record?locale=ja'
const APPOINTMENTS_PATH = '/api/app/v1/screens/appointments?locale=ja'
const CUSTOMERS_PATH = '/api/app/v1/screens/customers'
const SESSIONS_PATH = '/api/app/v1/screens/sessions'
const DASHBOARD_PATH = '/api/app/v1/screens/dashboard'

// Minimal valid fixtures (every required schema field present) — reused
// across tests that just need a successful parse, not specific content.
function recordDto() {
  return {
    locale: 'ja',
    customers: [],
    nextAppointment: null,
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
function appointmentsDto() {
  return {
    view: 'day',
    selectedDateIso: new Date().toISOString(),
    staffFilter: 'all',
    staff: [],
    activeStaffId: null,
    authProfileId: null,
    customers: [],
    reservationViews: [],
    reservationStaff: [],
    businessHours: { start: 9, end: 20 },
    weekData: null,
    weekStartIso: null,
    monthData: null,
  }
}
function customersDto() {
  return {
    rows: [],
    totalRegistered: 0,
    selfStaffId: null,
    bookingDataAvailable: true,
    staffList: [],
    burnByCustomer: {},
    burnUnpricedIds: [] as string[],
  }
}
function sessionsDto() {
  return {
    items: [],
    placeholders: [],
    monthCount: 0,
    staffList: [],
    currentStaffId: null,
    customerOptions: [],
  }
}
function dashboardDto() {
  return {
    dateLabel: '',
    isOwner: false,
    onboardingComplete: true,
    heroSlides: [],
    heroTomorrow: null,
    doneCount: 0,
    karuteTodos: [],
    redeemTodos: [],
    attentionItems: [],
    totalToday: 0,
    renewals: [],
    rebooks: [],
    winbacks: [],
    tomorrow: null,
    packAlerts: {
      contact: [],
      low: [],
      inProgress: [],
      totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
      monthly: { contacted: 0, rebooked: 0 },
    },
    reconcile: { entries: [], truncated: 0 },
    canDismissAlerts: false,
    pulse: { redemptions: 0, karute: 0 },
    ticketsEnabled: true,
  }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

function mockApiFetch(apiFetch: jest.Mock): void {
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
}

function signIn(uid = 'u1', token = 'tok'): void {
  setSessionState({
    status: 'signed-in',
    session: { access_token: token, user: { id: uid } } as Session,
  })
}

// The prefetch chains a couple .then() hops (json() then parse then the
// cache write) past the raw apiFetch call — several flushed ticks let a
// settle fully resolve before asserting (same rationale brief-warm.test.ts's
// flushMicrotasks documents).
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

// All 5 targets resolve successfully by default; individual tests override
// specific paths to exercise failure/hold-pending behavior.
function allTargetsOkApiFetch(overrides: Record<string, () => Promise<Response>> = {}) {
  return jest.fn(async (path: string) => {
    if (overrides[path]) return overrides[path]()
    if (path === RECORD_PATH) return jsonResponse(recordDto())
    if (path === APPOINTMENTS_PATH) return jsonResponse(appointmentsDto())
    if (path === CUSTOMERS_PATH) return jsonResponse(customersDto())
    if (path === SESSIONS_PATH) return jsonResponse(sessionsDto())
    if (path === DASHBOARD_PATH) return jsonResponse(dashboardDto())
    throw new Error(`unexpected apiFetch(${path})`)
  })
}

beforeEach(() => {
  dtoCache.clear()
})

afterEach(() => {
  cleanup()
  // Two-step reset (established codebase idiom, brief-warm.test.ts /
  // brief-cache.test.ts): the signed-out flip also clears screen-prefetch's
  // own pendingTimers/armed flag via its signed-out subscriber, and
  // ScreenBoundary's dtoCache via its own.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
  jest.useRealTimers()
})

describe('screen-prefetch — byte-pin (test 2)', () => {
  it('pins every cache-key path against the owning screen literal', () => {
    expect(PREFETCH_PATHS).toEqual([
      '/api/app/v1/screens/record?locale=ja',
      '/api/app/v1/screens/appointments?locale=ja',
      '/api/app/v1/screens/customers',
      '/api/app/v1/screens/sessions',
      '/api/app/v1/screens/dashboard',
    ])
  })
})

describe('screen-prefetch — one-shot per CONTIGUOUS signed-in period, not per generation (T1, fleet round 2 P1 fix)', () => {
  it('a resume/echo settle for the SAME user (which DOES bump the generation) schedules nothing — only sign-out re-arms', async () => {
    jest.useFakeTimers()
    // Held forever: isolates "how many timers got scheduled" from anything
    // ever settling (dtoCache never gets populated by a resolved fetch).
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    signIn('u1', 'tok1')
    expect(jest.getTimerCount()).toBe(5) // one batch, all 5 targets uncached

    // A routine resume/boot-echo: ANOTHER setSessionState settle for the
    // SAME user. session-store bumps the generation on every authoritative
    // transition, including this one — a generation-keyed one-shot would
    // re-arm here (this is exactly the bug the fleet caught).
    signIn('u1', 'tok2')
    expect(jest.getTimerCount()).toBe(5) // UNCHANGED — no second batch

    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(apiFetch).toHaveBeenCalledTimes(5) // the ORIGINAL batch only, never 10
  })
})

describe('screen-prefetch — schedule-time skip (T2, fleet round 2)', () => {
  it('a pre-cached target never gets a timer at all — checked immediately, before any fire', () => {
    jest.useFakeTimers()
    dtoCache.set(CUSTOMERS_PATH, { cached: true })
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    signIn()
    // 5 targets minus the pre-cached one — asserted BEFORE any timer fires,
    // so this is provably the schedule-time skip, not the fire-time one
    // (test 3 below), which the old combined test-1 couldn't tell apart.
    expect(jest.getTimerCount()).toBe(4)
  })
})

describe('screen-prefetch — cached-at-fire-time skip (test 3)', () => {
  it('a path visited mid-stagger before its timer fires is skipped at fire time — no fetch for it at all', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn()
    // customers is scheduled 3rd (3000 + 2*4000 = 11000ms) — visit it (a
    // real screen mount populating dtoCache) one tick before its timer fires.
    jest.advanceTimersByTime(10_999)
    dtoCache.set(CUSTOMERS_PATH, { fromRealMount: true })
    jest.advanceTimersByTime(1) // t=11000 — customers' timer fires
    await flushMicrotasks()

    expect(apiFetch).not.toHaveBeenCalledWith(CUSTOMERS_PATH)
    expect(dtoCache.get(CUSTOMERS_PATH)).toEqual({ fromRealMount: true }) // untouched
  })
})

describe('screen-prefetch — generation-fence straggler (test 4)', () => {
  it('an in-flight fetch that settles after sign-out never writes the cache', async () => {
    jest.useFakeTimers()
    let resolveRecord: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === RECORD_PATH) return new Promise<Response>((r) => (resolveRecord = r))
      return new Promise<Response>(() => {}) // hold every other target forever — isolate record
    })
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(3_000) // record is scheduled 1st — its fetch starts
    expect(apiFetch).toHaveBeenCalledWith(RECORD_PATH)

    setSessionState({ status: 'signed-out' }) // advances the generation
    resolveRecord(jsonResponse(recordDto())) // the stale settle, now after sign-out
    await flushMicrotasks()

    expect(dtoCache.has(RECORD_PATH)).toBe(false)
  })
})

describe('screen-prefetch — clobber guard (test 5)', () => {
  it('a path the user visits WHILE its prefetch fetch is in flight keeps the fresher visit data', async () => {
    jest.useFakeTimers()
    let resolveRecord: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === RECORD_PATH) return new Promise<Response>((r) => (resolveRecord = r))
      return new Promise<Response>(() => {})
    })
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(3_000) // record's fetch starts, held pending
    expect(dtoCache.has(RECORD_PATH)).toBe(false)

    // The real screen mounts mid-flight and caches ITS OWN fresher fetch.
    dtoCache.set(RECORD_PATH, { fromRealMount: true })

    resolveRecord(jsonResponse(recordDto())) // the prefetch settle, now stale
    await flushMicrotasks()

    expect(dtoCache.get(RECORD_PATH)).toEqual({ fromRealMount: true }) // never clobbered
  })
})

describe('screen-prefetch — signed-out cancels timers; re-arms on next sign-in (test 6)', () => {
  it('signed-out cancels every pending timer; the next sign-in schedules a fresh batch', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn('u1')
    setSessionState({ status: 'signed-out' }) // before any timer fires — cancels all 5
    jest.advanceTimersByTime(20_000)
    expect(apiFetch).not.toHaveBeenCalled()

    signIn('u2') // a fresh generation — re-arms
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(apiFetch).toHaveBeenCalledTimes(5)
  })
})

describe('screen-prefetch — fail-open, no retry (test 7, T3 honest mock)', () => {
  it('a non-OK response and a schema parse failure both cache nothing, throw nothing, and are never retried', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch({
      // T3 (fleet round 2): a bare `{ ok: false }` with no .json() passes
      // this test whether or not the `res.ok` guard is even there — a
      // missing guard would call the undefined json() and throw into the
      // SAME catch, masking the mutation. This mock is "honest": .json()
      // resolves to a VALID record dto, so a missing-guard mutation would
      // actually succeed the parse and cache it — a discriminating red.
      [RECORD_PATH]: async () => ({ ok: false, json: async () => recordDto() }) as unknown as Response,
      [APPOINTMENTS_PATH]: async () => jsonResponse({ garbage: true }), // fails zod parse
    })
    mockApiFetch(apiFetch)

    expect(() => signIn()).not.toThrow()
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    expect(dtoCache.has(RECORD_PATH)).toBe(false)
    expect(dtoCache.has(APPOINTMENTS_PATH)).toBe(false)
    expect(apiFetch).toHaveBeenCalledWith(RECORD_PATH)
    expect(apiFetch).toHaveBeenCalledWith(APPOINTMENTS_PATH)

    // No retry: further time passing must not re-fetch either failed path.
    apiFetch.mockClear()
    jest.advanceTimersByTime(60_000)
    expect(apiFetch).not.toHaveBeenCalledWith(RECORD_PATH)
    expect(apiFetch).not.toHaveBeenCalledWith(APPOINTMENTS_PATH)
  })
})

describe('screen-prefetch — end-to-end: prefetched CustomersScreen paints with no loading frame (test 8, mutation-proved)', () => {
  it('a prefetch settle populates dtoCache before the screen ever mounts — the first mount paints synchronously, no loading frame', async () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(async (path: string) => {
      if (path === CUSTOMERS_PATH) return jsonResponse(customersDto())
      return new Promise<Response>(() => {}) // hold every other target — isolate customers
    })
    mockApiFetch(apiFetch)

    signIn()
    // customers is scheduled 3rd: 3000 + 2*4000 = 11000ms.
    jest.advanceTimersByTime(11_000)
    await flushMicrotasks()
    jest.useRealTimers()

    expect(dtoCache.has(CUSTOMERS_PATH)).toBe(true) // prefetched before any mount existed

    const callsBeforeMount = apiFetch.mock.calls.length
    render(<CustomersScreen />)
    // Synchronous first render reads the cache-hot dto (ScreenBoundary's
    // initial useState) — no findBy/waitFor needed, same "no loading frame"
    // pin thin-record-screen-brief-cache.test.tsx uses for its revisit case.
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()

    // Cross-pin the 5th screen (its 4 siblings get this in the T5 block):
    // the mounted screen's OWN mount-effect fetch (the first call AFTER
    // render — the prefetch's earlier call can't satisfy this) must hit the
    // exact key the prefetch warmed. Screen-side path drift goes red here.
    expect(apiFetch.mock.calls[callsBeforeMount]?.[0]).toBe(CUSTOMERS_PATH)
    expect(PREFETCH_PATHS).toContain(CUSTOMERS_PATH)

    // CustomersScreen's OWN mount effect ALSO re-fetches in the background
    // (ScreenBoundary always does, cache-hit or not) — drain it here, inside
    // this test's own act() scope, so its later setState doesn't land
    // un-act()-wrapped after this test has already returned.
    await act(async () => {
      await flushMicrotasks()
    })
  })
})

describe('screen-prefetch — terminal catch swallows a rejection with no unhandled promise rejection (T4, fleet round 2)', () => {
  it('a rejecting apiFetch produces no unhandledRejection and caches nothing', async () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => Promise.reject(new Error('network')))
    mockApiFetch(apiFetch)

    const onUnhandled = jest.fn()
    process.on('unhandledRejection', onUnhandled)
    try {
      signIn()
      jest.advanceTimersByTime(20_000)
      await flushMicrotasks()
      expect(onUnhandled).not.toHaveBeenCalled()
      expect(dtoCache.size).toBe(0)
    } finally {
      // Always deregister, even on assertion failure — a leaked listener
      // would corrupt every later test file's unhandledRejection reporting.
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('screen-prefetch — cache keys cross-pinned against the owning screens (T5, fleet round 2)', () => {
  // The byte-pin test (2) only compares screen-prefetch.ts's PREFETCH_PATHS
  // against a hand-copy of the same 5 literals — a screen-side path change
  // (e.g. a new default query param) would silently zero out that screen's
  // prefetch benefit with no red test anywhere. These 4 tests close that:
  // each screen's OWN mount-effect fetch (ScreenBoundary's useScreenDto,
  // real, unmocked) must request the exact path screen-prefetch.ts uses.
  // apiFetch is held forever pending — every screen stays parked on its
  // loading frame, so only the FIRST call's path argument is under test.
  function heldForeverApiFetch() {
    return jest.fn<Promise<Response>, unknown[]>(() => new Promise<Response>(() => {}))
  }

  it('RecordScreen (no query params) — first fetch matches PREFETCH_PATHS[0]', async () => {
    const apiFetch = heldForeverApiFetch()
    mockApiFetch(apiFetch)
    render(<RecordScreen />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(PREFETCH_PATHS[0])
  })

  it('AppointmentsScreen (no query params) — first fetch matches PREFETCH_PATHS[1]', async () => {
    const apiFetch = heldForeverApiFetch()
    mockApiFetch(apiFetch)
    render(<AppointmentsScreen />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(PREFETCH_PATHS[1])
  })

  it('SessionsScreen — first fetch matches PREFETCH_PATHS[3]', async () => {
    const apiFetch = heldForeverApiFetch()
    mockApiFetch(apiFetch)
    render(<SessionsScreen />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(PREFETCH_PATHS[3])
  })

  it('DashboardScreen — first fetch matches PREFETCH_PATHS[4]', async () => {
    const apiFetch = heldForeverApiFetch()
    mockApiFetch(apiFetch)
    render(<DashboardScreen />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(PREFETCH_PATHS[4])
  })
})
