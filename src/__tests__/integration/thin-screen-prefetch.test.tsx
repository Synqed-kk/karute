/**
 * @jest-environment jsdom
 *
 * Background screen-DTO prefetch on app open (perf packet 34, PR-H) —
 * thin/data/screen-prefetch.ts. While staff look at the first screen after
 * sign-in, the OTHER screens' DTOs silently pre-load in the background
 * (mirrors brief-warm.ts's stagger/one-shot idioms and ScreenBoundary's
 * sign-out epoch fence), so every first tap this session paints instantly
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
 *  4.  sign-out epoch fence straggler: an in-flight fetch that settles after
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
 *
 * Record-warm (perf packet 35, PR-H2), T6-T10 below.
 *
 * Blind-round fix (perf packet 35 fix round), T11-T18 below:
 *  T11. in-flight dedupe: recordWarmScheduled must stay populated until the
 *      fetch SETTLES, not until the timer merely fires — the old fire-time
 *      delete left the in-flight RTT unguarded.
 *  T12. recorder guard, schedule time: an active recording skips the whole
 *      warmRecordForBookings call.
 *  T13. recorder guard, fire time: a recording that starts inside the
 *      stagger window is caught at fire time too.
 *  T14. schedule-time cached skip (own test, split from the fire-time one).
 *  T15. fire-time cached skip, with the delete-on-skip retry pin.
 *  T16. failure path (non-OK and rejected) both allow a later retry.
 *  T17. slice contract: the cap slice never backfills past the first 2.
 *  T18. sign-out hygiene: a scheduled-but-not-fired warm is fully cancelled;
 *      the next sign-in's warm for the same id is unpolluted.
 *
 * Foreground re-warm (perf packet 36, PR-H3), R1-R6 below: on the #596
 * foreground event (subscribeRevalidate), re-run schedule() for MISSING
 * dtoCache entries only, so a tab a post-mutation emitRefresh wiped (or that
 * fell out of the FIFO cap) comes back warm during all-day usage instead of
 * staying cold until sign-out.
 *  R1. recorder guard, THE load-bearing pin: state='recording'/'paused' both
 *      skip the whole re-warm — zero timers, zero fetches. Calls
 *      emitRevalidate() directly (bypassing the emitter's own guard) so this
 *      is provably THIS subscriber's guard, not the emitter's.
 *  R2. signed-out: emitRevalidate is a no-op.
 *  R3. warm-cache no-op: nothing missing → schedule() finds nothing to do.
 *  R4. post-wipe missing-only: a wipe followed by 2 re-visited paths
 *      re-warms exactly the 3 still-missing ones.
 *  R5. min-interval: two foregrounds inside 30s only re-warm once; 30s later
 *      a foreground fires again; sign-out resets the rate-limit stamp so a
 *      fresh sign-in isn't throttled by the outgoing session's clock.
 *  R6. dup-timer guard (mutation-proved): a foreground mid-stagger, while
 *      the sign-in batch's own timers are still pending/unsettled, must not
 *      double-schedule any target — each path fetches exactly once.
 *  R7. fire-time recorder guard (mutation-proved, blind-round P1): a
 *      recording that starts INSIDE the stagger window skips every pending
 *      timer at fire time (zero fetches during the take) and releases the
 *      paths so the next post-take foreground re-warms them.
 *  R8. fire-time cached-skip release: a path cached by a real mid-stagger
 *      visit is deleted from tabWarmScheduled at fire time — a later wipe +
 *      foreground re-warms it instead of finding it falsely still-pending.
 *  R9. failure release: a rejected warm fetch frees the path via .finally()
 *      — the next foreground retries it instead of stranding it cold.
 *  R10. unconditional stamp: a fully-warm foreground still resets the 30s
 *      clock — a wipe right after stays rate-limited until the interval.
 *
 * Sign-out epoch fence hardening (perf packet 37): the straggler fence both
 * timer bodies capture (myGen→mySessionEpoch) used to key on
 * currentGeneration(), which session-store bumps on EVERY authoritative
 * write — including a routine same-user cold-boot double-settle (boot
 * recover + GoTrue INITIAL_SESSION, same user). That silently discarded a
 * warm settle straddling routine boot churn, same root cause test 4 already
 * pins for sign-out (unaffected — a sign-out still bumps the new
 * dtoSessionEpoch() fence too, see ScreenBoundary.tsx).
 *  E1. tab-warm batch settle straddling a same-user boot double-settle:
 *      cacheDto lands (was silently dropped under the old fence).
 *  E2. warmRecordForBookings settle straddling a same-user boot
 *      double-settle: cacheDto lands, same rationale as E1.
 *  E3. warmRecordForBookings settle straddling a SIGN-OUT: still discarded —
 *      the fence's real job, unaffected by the rename.
 *  E4. warmRecordForBookings settle straddling a sign-out THEN a sign-in as
 *      a DIFFERENT user: still discarded (the hook-level sibling of this is
 *      R3 in thin-screen-refresh.test.tsx; cheap timer-side variant of E3).
 *  E5. recorder lens P2 (Fable audit fix round): a warm fetch dispatched
 *      pre-take that settles mid-take still lands in dtoCache (the network
 *      round trip already happened — nothing re-checks the recorder at
 *      settle, only at schedule/fire time) — mutation-proved via the E1/E2
 *      same-user-resettle idiom. It also never disturbs an ALREADY-MOUNTED
 *      screen at that same cache key: dtoCache is a plain, non-reactive Map,
 *      so a write to it cannot re-render an existing consumer. That second
 *      half is a forward-guard only, not mutation-proved — it only goes red
 *      if a future change makes dtoCache reactive without also reconciling
 *      an active take's frozen UI.
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

// screen-prefetch.ts now statically imports global-recorder.ts (blind-round
// fix, recorder guard) — same two 'use server'/take-store seam stubs
// thin-foreground-revalidate.test.tsx mocks, this file only ever touches
// globalRecorder.state directly, never start()/discard().
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
}))

import type { Session } from '@supabase/supabase-js'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { globalRecorder } from '@/lib/global-recorder'
import { dtoCache, useScreenDto } from '../../../thin/screens/ScreenBoundary'
import { emitRefresh, emitRevalidate } from '../../../thin/ports/nav.vite'
import {
  PREFETCH_PATHS,
  recordWarmPath,
  warmRecordForBookings,
} from '../../../thin/data/screen-prefetch'
import { CustomersScreen } from '../../../thin/screens/CustomersScreen'
import { RecordScreen } from '../../../thin/screens/RecordScreen'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'
import { SessionsScreen } from '../../../thin/screens/SessionsScreen'
import { DashboardScreen } from '../../../thin/screens/DashboardScreen'

const RECORD_PATH = '/api/app/v1/screens/record?locale=ja'
const APPOINTMENTS_PATH = '/api/app/v1/screens/appointments?locale=ja'
const CUSTOMERS_PATH = '/api/app/v1/screens/customers?locale=ja'
// ?window=1 (PR-2a 日付チャンク読み込み): the path IS the cache key, so the
// prefetch and SessionsScreen's own fetch must name the SAME url — a bare
// prefetch would warm a cache the screen never reads.
const SESSIONS_PATH = '/api/app/v1/screens/sessions?window=1'
const DASHBOARD_PATH = '/api/app/v1/screens/dashboard?locale=ja'

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
    staffCanDeletePhotos: true,
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
    assignableStaff: [],
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

// Shared by the T5 cross-pin block and T6 below: parks a screen on its
// loading frame forever so only the FIRST call's path argument is under test.
function heldForeverApiFetch() {
  return jest.fn<Promise<Response>, unknown[]>(() => new Promise<Response>(() => {}))
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
  // Global restore for T12/T13's direct state assignment on the singleton —
  // a leaked non-idle state would poison every later test's recorder guard.
  globalRecorder.state = 'idle'
})

describe('screen-prefetch — byte-pin (test 2)', () => {
  it('pins every cache-key path against the owning screen literal', () => {
    expect(PREFETCH_PATHS).toEqual([
      '/api/app/v1/screens/record?locale=ja',
      '/api/app/v1/screens/appointments?locale=ja',
      '/api/app/v1/screens/customers?locale=ja',
      '/api/app/v1/screens/sessions?window=1',
      '/api/app/v1/screens/dashboard?locale=ja',
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
    // customers is scheduled 3rd (1000 + 2*1500 = 4000ms) — visit it (a
    // real screen mount populating dtoCache) one tick before its timer fires.
    jest.advanceTimersByTime(3_999)
    dtoCache.set(CUSTOMERS_PATH, { fromRealMount: true })
    jest.advanceTimersByTime(1) // t=4000 — customers' timer fires
    await flushMicrotasks()

    expect(apiFetch).not.toHaveBeenCalledWith(CUSTOMERS_PATH)
    expect(dtoCache.get(CUSTOMERS_PATH)).toEqual({ fromRealMount: true }) // untouched
  })
})

describe('screen-prefetch — sign-out epoch fence straggler (test 4)', () => {
  it('an in-flight fetch that settles after sign-out never writes the cache', async () => {
    jest.useFakeTimers()
    let resolveRecord: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === RECORD_PATH) return new Promise<Response>((r) => (resolveRecord = r))
      return new Promise<Response>(() => {}) // hold every other target forever — isolate record
    })
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(1_000) // record is scheduled 1st — its fetch starts
    expect(apiFetch).toHaveBeenCalledWith(RECORD_PATH)

    setSessionState({ status: 'signed-out' }) // bumps dtoSessionEpoch
    resolveRecord(jsonResponse(recordDto())) // the stale settle, now after sign-out
    await flushMicrotasks()

    expect(dtoCache.has(RECORD_PATH)).toBe(false)
  })
})

describe('screen-prefetch — sign-out epoch fence hardening (E1-E5, perf packet 37 + Fable audit fix round)', () => {
  it('E1: tab-warm batch settle straddling a same-user boot double-settle lands in the cache', async () => {
    jest.useFakeTimers()
    let resolveRecord: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === RECORD_PATH) return new Promise<Response>((r) => (resolveRecord = r))
      return new Promise<Response>(() => {}) // hold every other target forever — isolate record
    })
    mockApiFetch(apiFetch)

    signIn('u1', 'tok1')
    jest.advanceTimersByTime(1_000) // record is scheduled 1st — its fetch starts
    expect(apiFetch).toHaveBeenCalledWith(RECORD_PATH)

    // A routine same-user cold-boot double-settle (boot recover + GoTrue
    // INITIAL_SESSION, same user) lands while the warm fetch is still in
    // flight — NOT a sign-out, so the epoch fence must not discard the
    // eventual cache write (this is exactly test 4's sibling case).
    signIn('u1', 'tok2')
    resolveRecord(jsonResponse(recordDto()))
    await flushMicrotasks()

    expect(dtoCache.has(RECORD_PATH)).toBe(true)
  })

  it('E2: warmRecordForBookings settle straddling a same-user boot double-settle lands in the cache', async () => {
    jest.useFakeTimers()
    let resolveWarm: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === recordWarmPath('a'))
        return new Promise<Response>((r) => {
          resolveWarm = r
        })
      return new Promise<Response>(() => {})
    })
    mockApiFetch(apiFetch)

    warmRecordForBookings(['a'])
    jest.advanceTimersByTime(1_000) // FIRST_DELAY_MS, k=0 — the warm fetch starts
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('a'))

    signIn('u1', 'tok1')
    signIn('u1', 'tok2') // same-user double-settle mid-flight
    resolveWarm(jsonResponse(recordDto()))
    await flushMicrotasks()

    expect(dtoCache.has(recordWarmPath('a'))).toBe(true)
  })

  it('E3: warmRecordForBookings settle straddling a SIGN-OUT is still discarded', async () => {
    jest.useFakeTimers()
    let resolveWarm: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === recordWarmPath('a'))
        return new Promise<Response>((r) => {
          resolveWarm = r
        })
      return new Promise<Response>(() => {})
    })
    mockApiFetch(apiFetch)

    warmRecordForBookings(['a'])
    jest.advanceTimersByTime(1_000)
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('a'))

    setSessionState({ status: 'signed-out' }) // bumps dtoSessionEpoch
    resolveWarm(jsonResponse(recordDto())) // the stale settle, now after sign-out
    await flushMicrotasks()

    expect(dtoCache.has(recordWarmPath('a'))).toBe(false)
  })

  it('E4: warmRecordForBookings settle straddling sign-out THEN sign-in as a DIFFERENT user is still discarded', async () => {
    jest.useFakeTimers()
    let resolveWarm: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === recordWarmPath('a'))
        return new Promise<Response>((r) => {
          resolveWarm = r
        })
      return new Promise<Response>(() => {})
    })
    mockApiFetch(apiFetch)

    warmRecordForBookings(['a'])
    jest.advanceTimersByTime(1_000)
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('a'))

    setSessionState({ status: 'signed-out' }) // bumps dtoSessionEpoch
    signIn('u2', 'tok-b') // a DIFFERENT user signs in before the stale settle lands
    resolveWarm(jsonResponse(recordDto())) // outgoing user A's stale settle
    await flushMicrotasks()

    // Outgoing user A's warm must never land in user B's cache — a sign-out
    // sat between fetch-start and settle, so the epoch fence drops it
    // regardless of how many signed-in writes followed the sign-out (the
    // timer-side sibling of R3 in thin-screen-refresh.test.tsx).
    expect(dtoCache.has(recordWarmPath('a'))).toBe(false)
  })

  it('E5 (recorder lens P2, Fable audit fix round): a warm fetch dispatched pre-take, straddling a same-user resettle, still lands mid-take — but never disturbs an already-mounted screen', async () => {
    jest.useFakeTimers()
    const path = recordWarmPath('a')
    let mountFetchCalls = 0
    let resolveWarmFetch: (r: Response) => void = () => {}
    const apiFetch = jest.fn((p: string) => {
      if (p !== path) return new Promise<Response>(() => {})
      mountFetchCalls++
      // First call is the already-mounted screen's OWN mount fetch — held
      // pending FOREVER (never resolved) so its rendered state stays fixed
      // at `loading` for the whole test; the second is the background
      // warm's fetch, under test.
      if (mountFetchCalls === 1) return new Promise<Response>(() => {})
      return new Promise<Response>((r) => (resolveWarmFetch = r))
    })
    mockApiFetch(apiFetch)

    const parseLocale = (raw: unknown): { locale: string } => raw as { locale: string }
    function RecordProbe() {
      const { state } = useScreenDto(path, parseLocale)
      return (
        <div data-testid="mounted-content">
          {state.status === 'ready' ? state.dto.locale : state.status}
        </div>
      )
    }
    // An already-mounted screen instance at the SAME cache key the warm
    // will write to — its own mount fetch never settles in this test, so
    // it stays on `loading` throughout.
    render(<RecordProbe />)
    expect(screen.getByTestId('mounted-content').textContent).toBe('loading')

    warmRecordForBookings(['a'])
    jest.advanceTimersByTime(1_000) // fire-time recorder-idle check passes (idle) — the warm fetch dispatches
    expect(apiFetch).toHaveBeenCalledTimes(2) // the mount fetch + the warm fetch

    // A routine same-user cold-boot double-settle lands while the warm
    // fetch is in flight — not a sign-out, so the epoch fence must not
    // discard the eventual write (same idiom as E1/E2).
    signIn('u1', 'tok1')
    signIn('u1', 'tok2')

    // A take starts too, AFTER the warm fetch already dispatched — the
    // fire-time recorder guard already let it through; nothing re-checks
    // the recorder at settle, only at schedule/fire time.
    globalRecorder.state = 'recording'
    resolveWarmFetch(jsonResponse(recordDto()))
    await flushMicrotasks()

    // (a) mutation-proved (revert the epoch fence to currentGeneration-
    // style: the same-user resettle above then discards this write too,
    // going red): the write lands despite both the resettle and the
    // mid-take settle — the network round trip already happened, so
    // discarding it here would waste it for nothing.
    expect(dtoCache.has(path)).toBe(true)

    // (b) forward-guard only, NOT mutation-proved: dtoCache is a plain,
    // non-reactive Map — a write to it cannot by construction re-render an
    // already-mounted consumer (useScreenDto only reads the cache in its
    // initial useState() and on its OWN fetch's settle). This assertion
    // only goes red if a future change makes dtoCache reactive without also
    // reconciling an active take's frozen UI.
    expect(screen.getByTestId('mounted-content').textContent).toBe('loading')
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
    jest.advanceTimersByTime(1_000) // record's fetch starts, held pending
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

describe('screen-prefetch — wipe fence (Greptile #604 P1)', () => {
  it('a prefetch that STARTED before an emitRefresh wipe never writes its pre-mutation body', async () => {
    jest.useFakeTimers()
    let resolveRecord: (r: Response) => void = () => {}
    const apiFetch = jest.fn(async (path: string) => {
      if (path === RECORD_PATH)
        return new Promise<Response>((r) => {
          resolveRecord = r
        })
      return new Promise<Response>(() => {}) // hold every other target
    })
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(1_000) // record's timer fires — fetch now in flight
    expect(apiFetch).toHaveBeenCalledWith(RECORD_PATH)
    jest.useRealTimers()

    // A post-mutation refresh lands while the fetch is in flight. It does
    // NOT advance the auth generation — the generation fence alone would
    // let the stale settle through; only the wipeEpoch fence stops it.
    emitRefresh()

    resolveRecord(jsonResponse(recordDto())) // pre-mutation body settles late
    await flushMicrotasks()

    expect(dtoCache.has(RECORD_PATH)).toBe(false) // stale settle discarded
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
    // customers is scheduled 3rd: 1000 + 2*1500 = 4000ms.
    jest.advanceTimersByTime(4_000)
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

describe('screen-prefetch — record-warm cross-pin WITH search params (T6, perf packet 35, the load-bearing pin)', () => {
  it('RecordScreen at ?appointmentId=A%201 — first fetch matches recordWarmPath, the encodeURIComponent leg included', async () => {
    // The id needs encoding (a space) so a param-order or missing-enc mutation
    // in either RecordScreen.tsx or recordWarmPath goes red here — the plain
    // byte-pin tests above never exercise an id that needs escaping.
    window.history.pushState({}, '', '/sessions?appointmentId=A%201')
    try {
      const apiFetch = heldForeverApiFetch()
      mockApiFetch(apiFetch)
      render(<RecordScreen />)
      await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
      expect(apiFetch.mock.calls[0][0]).toBe(recordWarmPath('A 1'))
    } finally {
      // Restore so sibling tests (which assume a bare '/') aren't polluted.
      window.history.pushState({}, '', '/')
    }
  })
})

describe('screen-prefetch — record-warm cap pin (T7, perf packet 35)', () => {
  it('warmRecordForBookings caps at the first 2 ids of the call — the rest never fetch', async () => {
    jest.useFakeTimers()
    // warmRecordForBookings runs independently of the signed-in batch above
    // (AppointmentsScreen calls it directly on its own DTO settle) — no
    // signIn() needed, which keeps this apiFetch count to exactly the
    // record-warm calls under test.
    const apiFetch = jest.fn(async () => jsonResponse(recordDto()))
    mockApiFetch(apiFetch)

    warmRecordForBookings(['a', 'b', 'c', 'd', 'e'])
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('a'))
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('b'))
  })
})

describe('screen-prefetch — AppointmentsScreen settle-effect record-warm (T8, perf packet 35)', () => {
  // Minimal valid ReservationViewDTO fixture, local to this block (packet
  // note) — same shape/convention as thin-appointments-brief-warm.test.tsx's
  // `reservation` helper.
  function reservationView(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      staffId: 's1',
      staffName: 'staff',
      startTimeHm: '10:00',
      durationMin: 60,
      customerName: 'customer',
      customerInitials: 'C',
      karuteNumber: null,
      service: 'cut',
      displayStatus: 'booked',
      isCancelled: false,
      isNoShow: false,
      statusReason: null,
      statusSetByName: null,
      statusSetAt: null,
      staffColorKey: 'blue',
      clientId: `c-${id}`,
      karuteRecordId: null,
      isFirstTimeVisit: false,
      pack: null,
      needsRenewal: false,
      noShowCount: 0,
      ...overrides,
    }
  }

  // Real server shape (appointments route.ts): selectedDate.toISOString(),
  // JST midnight of `ymd` — same helper thin-appointments-brief-warm.test.tsx uses.
  const jstMidnightIso = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`).toISOString()

  beforeEach(() => {
    // Pins "now" for the screen's ymdInJst(new Date()) side of the compare.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-23T12:00:00+09:00'))
    window.history.replaceState({}, '', '/appointments')
  })

  afterEach(() => {
    // T6's pushState is restored in its own finally; this block's
    // replaceState above was leaking '/appointments' to every later
    // describe block (blind-round hygiene fix).
    window.history.replaceState({}, '', '/')
  })

  it('warms the earliest 2 active UNRECORDED bookings out of time order, excluding cancelled/no-show/completed/already-recorded', async () => {
    const dto = {
      ...appointmentsDto(),
      selectedDateIso: jstMidnightIso('2026-07-23'),
      reservationViews: [
        reservationView('cancelled', { startTimeHm: '08:00', isCancelled: true }),
        reservationView('noshow', { startTimeHm: '08:15', isNoShow: true }),
        reservationView('completed', { startTimeHm: '07:00', displayStatus: 'completed' }),
        // Earliest ACTIVE row of all — but its karute already exists, so its
        // near-certain tap is カルテを見る (/karute/<id>), not 録音. It must
        // not consume one of the 2 warm slots (Greptile #605 P1).
        reservationView('recorded', { startTimeHm: '08:30', karuteRecordId: 'k1' }),
        reservationView('third', { startTimeHm: '13:00' }),
        reservationView('earliest', { startTimeHm: '09:00', displayStatus: 'in_session' }),
        reservationView('second', { startTimeHm: '11:00', displayStatus: 'new' }),
      ],
    }
    const apiFetch = jest.fn(async (path: string) => {
      if (path === APPOINTMENTS_PATH) return jsonResponse(dto)
      return jsonResponse(recordDto()) // any other target/brief-warm fetch
    })
    mockApiFetch(apiFetch)
    // Pre-populate dtoCache (same idiom as this file's test 8 end-to-end):
    // useScreenDto's initial useState reads a cache hit synchronously, so
    // AppointmentsScreenInner mounts and its settle effect runs INSIDE
    // render()'s own act() — no separate flush needed for the settle itself.
    dtoCache.set(APPOINTMENTS_PATH, dto)

    render(<AppointmentsScreen />)
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('earliest'))
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('second'))
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('third'))
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('cancelled'))
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('noshow'))
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('completed'))
    // Discriminating both ways: 'recorded' is the earliest active row, so if
    // the karuteRecordId clause were dropped it would take slot 1 and push
    // 'second' out of the cap — BOTH this line and the 'second' positive
    // assertion above would go red.
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('recorded'))
  })

  it('a non-today settle warms zero record-warm fetches', async () => {
    const dto = {
      ...appointmentsDto(),
      selectedDateIso: jstMidnightIso('2026-07-24'), // "now" pinned to 7/23 JST above
      reservationViews: [
        reservationView('earliest', { startTimeHm: '09:00', displayStatus: 'in_session' }),
        reservationView('second', { startTimeHm: '11:00', displayStatus: 'new' }),
      ],
    }
    const apiFetch = jest.fn(async (path: string) => {
      if (path === APPOINTMENTS_PATH) return jsonResponse(dto)
      return jsonResponse(recordDto())
    })
    mockApiFetch(apiFetch)
    dtoCache.set(APPOINTMENTS_PATH, dto) // see the sibling test's comment

    render(<AppointmentsScreen />)
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('earliest'))
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('second'))
  })
})

describe('screen-prefetch — record-warm fences on the new write (T9, perf packet 35)', () => {
  it('(a) wipe straggler: a warm fetch that started before an emitRefresh wipe never writes its pre-mutation body', async () => {
    jest.useFakeTimers()
    let resolveWarm: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === recordWarmPath('a'))
        return new Promise<Response>((r) => {
          resolveWarm = r
        })
      return new Promise<Response>(() => {})
    })
    mockApiFetch(apiFetch)

    warmRecordForBookings(['a'])
    jest.advanceTimersByTime(1_000) // FIRST_DELAY_MS, k=0 — the warm fetch starts
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('a'))
    jest.useRealTimers()

    // A post-mutation refresh lands while the warm fetch is in flight. It
    // does NOT advance the auth generation — the generation fence alone
    // would let the stale settle through; only the wipeEpoch fence stops it.
    emitRefresh()

    resolveWarm(jsonResponse(recordDto())) // pre-mutation body settles late
    await flushMicrotasks()

    expect(dtoCache.has(recordWarmPath('a'))).toBe(false) // stale settle discarded
  })

  it('(b) never-clobber: a fresher dtoCache entry written while the warm is in flight is never overwritten by the stale settle', async () => {
    jest.useFakeTimers()
    let resolveWarm: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === recordWarmPath('a'))
        return new Promise<Response>((r) => {
          resolveWarm = r
        })
      return new Promise<Response>(() => {})
    })
    mockApiFetch(apiFetch)

    warmRecordForBookings(['a'])
    jest.advanceTimersByTime(1_000)
    expect(dtoCache.has(recordWarmPath('a'))).toBe(false)

    // The real 録音 screen mounts mid-flight and caches ITS OWN fresher fetch.
    dtoCache.set(recordWarmPath('a'), { fromRealMount: true })

    resolveWarm(jsonResponse(recordDto())) // the warm settle, now stale
    await flushMicrotasks()

    expect(dtoCache.get(recordWarmPath('a'))).toEqual({ fromRealMount: true }) // never clobbered
  })
})

describe('screen-prefetch — record-warm dedupe (T10, perf packet 35)', () => {
  it('calling warmRecordForBookings twice for the same id before its timer fires schedules one timer, fetches once', async () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    warmRecordForBookings(['x'])
    expect(jest.getTimerCount()).toBe(1)
    warmRecordForBookings(['x']) // a second settle before the first timer fires
    expect(jest.getTimerCount()).toBe(1) // unchanged — deduped

    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('x'))
  })
})

describe('screen-prefetch — in-flight dedupe (T11, blind-round fix) ⚑', () => {
  it('a second warm call for the same id while its fetch is in flight is deduped; a later settle allows a fresh warm', async () => {
    jest.useFakeTimers()
    let resolveWarm: (r: Response) => void = () => {}
    const apiFetch = jest.fn((path: string) => {
      if (path === recordWarmPath('x'))
        return new Promise<Response>((r) => {
          resolveWarm = r
        })
      return new Promise<Response>(() => {})
    })
    mockApiFetch(apiFetch)

    warmRecordForBookings(['x'])
    jest.advanceTimersByTime(1_000) // fires — fetch now in flight, held pending
    expect(apiFetch).toHaveBeenCalledTimes(1)

    // A second settle mid-flight (routine: a booking mutation's emitRefresh
    // → appointments refetch → the same still-top-2 id re-warmed before the
    // first fetch has landed) must be a no-op, not a duplicate fetch — the
    // bug this fix round closes.
    warmRecordForBookings(['x'])
    expect(jest.getTimerCount()).toBe(0) // no new timer scheduled — deduped
    expect(apiFetch).toHaveBeenCalledTimes(1) // still just the one fetch

    resolveWarm(jsonResponse(recordDto()))
    await flushMicrotasks()
    emitRefresh() // a post-mutation wipe, same as T9(a)'s straggler scenario
    // dtoCache.clear() isolates the assertion below from the cache write the
    // settle above just made: without it, the schedule-time dtoCache.has()
    // skip would ALSO block a re-schedule, masking whether
    // recordWarmScheduled's delete-on-settle actually ran.
    dtoCache.clear()

    warmRecordForBookings(['x']) // the id's outcome is known — free to retry
    expect(jest.getTimerCount()).toBe(1) // schedules fresh — id was not stuck
  })
})

describe('screen-prefetch — recorder guard, schedule time (T12, blind-round fix) ⚑', () => {
  it('an active recording skips the whole warmRecordForBookings call — recording and paused both', () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    globalRecorder.state = 'recording'
    warmRecordForBookings(['x'])
    expect(jest.getTimerCount()).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()

    globalRecorder.state = 'paused'
    warmRecordForBookings(['x'])
    expect(jest.getTimerCount()).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()
    // Restored to 'idle' by this file's global afterEach — a leaked state
    // here would poison every later test's recorder guard.
  })
})

describe('screen-prefetch — recorder guard, fire time (T13, blind-round fix)', () => {
  it('a recording that starts inside the stagger window is caught at fire time too; the id is not stuck once the take ends', async () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    warmRecordForBookings(['x']) // scheduled while idle
    globalRecorder.state = 'recording' // a take starts inside the 1s stagger window
    jest.advanceTimersByTime(1_000) // fire — schedule-time check above already missed this
    expect(apiFetch).not.toHaveBeenCalled()

    globalRecorder.state = 'idle' // the take resolves
    warmRecordForBookings(['x']) // same id — must not be stuck skipped
    expect(jest.getTimerCount()).toBe(1)
  })
})

describe('screen-prefetch — record-warm schedule-time cached skip (T14, blind-round fix)', () => {
  it('a pre-cached id gets zero timers scheduled', () => {
    jest.useFakeTimers()
    dtoCache.set(recordWarmPath('x'), { cached: true })
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    warmRecordForBookings(['x'])
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('screen-prefetch — record-warm fire-time cached skip (T15, blind-round fix)', () => {
  it('an id cached mid-stagger before its timer fires is skipped at fire time; a later warm after a wipe schedules again', () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    warmRecordForBookings(['x']) // uncached at schedule time
    dtoCache.set(recordWarmPath('x'), { fromRealMount: true }) // real visit lands mid-stagger
    jest.advanceTimersByTime(1_000) // fire
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('x'))

    dtoCache.clear() // an emitRefresh-style wipe
    warmRecordForBookings(['x']) // must not be stuck skipped by the stale add()
    expect(jest.getTimerCount()).toBe(1)
  })
})

describe('screen-prefetch — record-warm failure path allows retry (T16, blind-round fix)', () => {
  it('(a) a rejected apiFetch caches nothing, throws nothing, and allows a later retry', async () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => Promise.reject(new Error('network')))
    mockApiFetch(apiFetch)

    const onUnhandled = jest.fn()
    process.on('unhandledRejection', onUnhandled)
    try {
      warmRecordForBookings(['x'])
      jest.advanceTimersByTime(1_000)
      await flushMicrotasks()
      expect(onUnhandled).not.toHaveBeenCalled()
      expect(dtoCache.has(recordWarmPath('x'))).toBe(false)

      warmRecordForBookings(['x']) // retry allowed — not stuck
      expect(jest.getTimerCount()).toBe(1)
    } finally {
      // Always deregister, even on assertion failure — a leaked listener
      // would corrupt every later test file's unhandledRejection reporting.
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('(b) a non-OK response with a working json() caches nothing and allows a later retry', async () => {
    jest.useFakeTimers()
    // Honest mock (T3's idiom): .json() resolves to a VALID record dto, so a
    // missing res.ok guard would actually succeed the parse and cache it —
    // a discriminating red, not a mock that passes either way.
    const apiFetch = jest.fn(
      async () => ({ ok: false, json: async () => recordDto() }) as unknown as Response,
    )
    mockApiFetch(apiFetch)

    warmRecordForBookings(['x'])
    jest.advanceTimersByTime(1_000)
    await flushMicrotasks()
    expect(dtoCache.has(recordWarmPath('x'))).toBe(false)

    warmRecordForBookings(['x']) // retry allowed — not stuck
    expect(jest.getTimerCount()).toBe(1)
  })
})

describe('screen-prefetch — record-warm slice contract (T17, blind-round fix)', () => {
  it('a pre-cached first-slot id is skipped; the cap slice never backfills past the first 2', async () => {
    jest.useFakeTimers()
    dtoCache.set(recordWarmPath('a'), { cached: true })
    const apiFetch = jest.fn(async () => jsonResponse(recordDto()))
    mockApiFetch(apiFetch)

    warmRecordForBookings(['a', 'b', 'c'])
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('b'))
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('c'))
  })
})

describe('screen-prefetch — record-warm sign-out hygiene (T18, blind-round fix)', () => {
  it('a scheduled-but-not-fired warm is fully cancelled on sign-out; the next sign-in warms the same id unpolluted', async () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(async (path: string) => {
      if (path === recordWarmPath('x')) return jsonResponse(recordDto())
      return new Promise<Response>(() => {}) // hold any batch-5 target forever — irrelevant here
    })
    mockApiFetch(apiFetch)

    warmRecordForBookings(['x'])
    setSessionState({ status: 'signed-out' }) // cancels every pending timer
    jest.advanceTimersByTime(20_000)
    expect(apiFetch).not.toHaveBeenCalledWith(recordWarmPath('x'))

    signIn('u2') // a fresh signed-in period — also re-arms the unrelated batch-5 prefetch
    warmRecordForBookings(['x']) // must schedule cleanly, unpolluted by the cancelled warm
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(apiFetch).toHaveBeenCalledWith(recordWarmPath('x'))
  })
})

describe('screen-prefetch — foreground re-warm: recorder guard (R1, THE load-bearing pin) ⚑', () => {
  it('an active recording (or paused) skips the whole foreground re-warm — zero timers, zero fetches, for paths that ARE missing', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(dtoCache.size).toBe(5) // sign-in batch fully settled — nothing left scheduled/pending

    // Post-mutation wipe — every path is MISSING again, a genuine re-warm
    // target. emitRefresh() alone only bumps this module's wipeEpoch fence
    // here: the actual dtoCache.clear() is wired inside useScreenDto's OWN
    // subscribeRefresh listener (ScreenBoundary.tsx), which only exists
    // while a screen is mounted — none is in this harness. dtoCache.clear()
    // replicates the other half of what a real emitRefresh() does whenever
    // at least one screen is mounted (always true in production, since a
    // mutation is user-triggered from a visible screen).
    emitRefresh()
    dtoCache.clear()
    apiFetch.mockClear()

    globalRecorder.state = 'recording'
    // Direct emitRevalidate() call — bypasses the EMITTER's own recorder
    // guard (foreground-revalidate.ts), isolating THIS subscriber's guard;
    // deleting it would let schedule() run and create 5 fresh timers here.
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()

    globalRecorder.state = 'paused'
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()

    // 'recorded' (unsaved take) is the third non-idle state the module's own
    // guard comment names — a narrowed check (recording/paused only) must go
    // red here, not slip through green.
    globalRecorder.state = 'recorded'
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('screen-prefetch — foreground re-warm: fire-time recorder guard (R7, mutation-proved) ⚑', () => {
  it('a recording that starts mid-stagger skips every pending tab warm at fire time — and releases the paths for a later re-warm', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn()
    expect(jest.getTimerCount()).toBe(5)

    jest.advanceTimersByTime(1_000) // record's timer fires first — its fetch settles pre-take
    await flushMicrotasks()
    expect(dtoCache.size).toBe(1)

    // Take starts INSIDE the stagger window — the subscriber's schedule-time
    // check has already passed and can't see this. The 4 pending timers must
    // skip at fire time (the sibling warmRecordForBookings contract).
    globalRecorder.state = 'recording'
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(apiFetch).toHaveBeenCalledTimes(1) // only the pre-take fetch — zero fetches during the take
    expect(dtoCache.size).toBe(1)

    // The fire-time skip deleted each path from tabWarmScheduled — after the
    // take resolves, the next foreground re-warms the 4 still-missing ones
    // (a stranded pending-flag here would leave them cold until sign-out).
    globalRecorder.state = 'idle'
    jest.advanceTimersByTime(30_000)
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(4)
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(dtoCache.size).toBe(5)
  })
})

describe('screen-prefetch — foreground re-warm: fire-time cached-skip releases the path (R8)', () => {
  it('a path visited mid-stagger (cached at fire time) can be re-warmed after a later wipe', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn()
    expect(jest.getTimerCount()).toBe(5)
    // Staff visits 録音 mid-stagger — the real mount's own fetch caches the
    // path before this module's 1s timer fires, so that timer takes the
    // fire-time cached-skip branch (never fetches).
    dtoCache.set(RECORD_PATH, { fromRealMount: true })
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(apiFetch.mock.calls.filter((c) => c[0] === RECORD_PATH)).toHaveLength(0)

    // Post-mutation wipe → the next foreground must be able to re-warm
    // RECORD_PATH: the fire-time skip deleted it from tabWarmScheduled.
    // Without that delete it would sit falsely-pending for the rest of the
    // session — wiped, cold, and never re-warmed (the exact "stays cold
    // until sign-out" bug this packet exists to fix).
    emitRefresh() // wipe (wipeEpoch bump) — see R1's comment
    dtoCache.clear() // no screen mounted here to run the real dtoCache clear
    apiFetch.mockClear()
    jest.advanceTimersByTime(30_000)
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(5)
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(apiFetch).toHaveBeenCalledWith(RECORD_PATH)
    expect(dtoCache.size).toBe(5)
  })
})

describe('screen-prefetch — foreground re-warm: failed warm releases the path for retry (R9)', () => {
  it('a rejected warm fetch does not strand the path — the next foreground re-warms it', async () => {
    jest.useFakeTimers()
    let failRecord = true
    const apiFetch = allTargetsOkApiFetch({
      [RECORD_PATH]: () =>
        failRecord ? Promise.reject(new Error('net down')) : Promise.resolve(jsonResponse(recordDto())),
    })
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    // Record's warm failed (fail-open contract); the other 4 settled.
    expect(dtoCache.size).toBe(4)

    // The .finally() release means the failure doesn't strand the path: the
    // next foreground re-warms exactly the missing one. A success-only
    // delete (release moved out of .finally) would leave it pending-flagged
    // and cold for the rest of the session.
    failRecord = false
    apiFetch.mockClear()
    jest.advanceTimersByTime(30_000)
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith(RECORD_PATH)
    expect(dtoCache.size).toBe(5)
  })
})

describe('screen-prefetch — foreground re-warm: warm-cache foreground still stamps the clock (R10)', () => {
  it('a no-op foreground resets the rate limit — a wipe right after is not re-warmed until the interval passes', () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)
    for (const path of PREFETCH_PATHS) dtoCache.set(path, { cached: true })

    signIn()
    expect(jest.getTimerCount()).toBe(0)

    emitRevalidate() // fully-warm cache: schedules nothing, but MUST stamp
    expect(jest.getTimerCount()).toBe(0)

    emitRefresh() // wipe (wipeEpoch bump) — see R1's comment
    dtoCache.clear()
    jest.advanceTimersByTime(10_000) // still inside the 30s window
    emitRevalidate()
    // Rate-limited by the warm-cache foreground's stamp above — a
    // conditional stamp ("only when something was scheduled") goes red here.
    expect(jest.getTimerCount()).toBe(0)

    jest.advanceTimersByTime(20_001) // crosses the 30s interval
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(5)
  })
})

describe('screen-prefetch — foreground re-warm: signed-out (R2)', () => {
  it('signed-out → emitRevalidate is a no-op — zero timers, zero fetches', () => {
    jest.useFakeTimers()
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)
    setSessionState({ status: 'signed-out' })

    emitRevalidate()
    expect(jest.getTimerCount()).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('screen-prefetch — foreground re-warm: warm-cache no-op (R3)', () => {
  it('all 5 paths already cached → emitRevalidate schedules nothing', () => {
    jest.useFakeTimers()
    for (const path of PREFETCH_PATHS) dtoCache.set(path, { cached: true })
    const apiFetch = jest.fn(() => new Promise<Response>(() => {}))
    mockApiFetch(apiFetch)

    signIn()
    expect(jest.getTimerCount()).toBe(0) // sign-in batch itself: nothing missing

    emitRevalidate()
    expect(jest.getTimerCount()).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('screen-prefetch — foreground re-warm: post-wipe missing-only (R4)', () => {
  it('a post-mutation wipe re-warms only the paths NOT re-visited before the next foreground', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(dtoCache.size).toBe(5) // sign-in batch fully warmed

    emitRefresh() // post-mutation wipe (wipeEpoch bump) — see R1's comment
    dtoCache.clear() // no screen mounted here to run the real dtoCache clear
    // Simulates staff visiting 2 screens before the next foreground — their
    // OWN mount fetches populate dtoCache directly, bypassing this module.
    dtoCache.set(RECORD_PATH, { fromRealMount: true })
    dtoCache.set(CUSTOMERS_PATH, { fromRealMount: true })
    apiFetch.mockClear()

    jest.advanceTimersByTime(30_000) // clears the (already-satisfied) min-interval gate with margin
    emitRevalidate()
    // Exactly the 3 still-missing paths get a fresh timer; the 2 re-visited
    // ones are skipped at schedule time (dtoCache.has).
    expect(jest.getTimerCount()).toBe(3)

    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    expect(apiFetch).toHaveBeenCalledTimes(3)
    expect(apiFetch).toHaveBeenCalledWith(APPOINTMENTS_PATH)
    expect(apiFetch).toHaveBeenCalledWith(SESSIONS_PATH)
    expect(apiFetch).toHaveBeenCalledWith(DASHBOARD_PATH)
    expect(apiFetch).not.toHaveBeenCalledWith(RECORD_PATH)
    expect(apiFetch).not.toHaveBeenCalledWith(CUSTOMERS_PATH)
  })
})

describe('screen-prefetch — foreground re-warm: min-interval (R5)', () => {
  it('two foregrounds inside 30s only re-warm once; 30s later a foreground fires again; sign-out resets the stamp', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn()
    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()
    expect(dtoCache.size).toBe(5) // sign-in batch fully settled

    emitRefresh() // wipe (wipeEpoch bump) — see R1's comment
    dtoCache.clear() // no screen mounted here to run the real dtoCache clear
    apiFetch.mockClear()
    emitRevalidate() // first foreground since the wipe — stamp starts at 0, fires
    expect(jest.getTimerCount()).toBe(5)

    jest.advanceTimersByTime(20_000) // settle this batch (20s since the stamp)
    await flushMicrotasks()
    expect(apiFetch).toHaveBeenCalledTimes(5)
    expect(dtoCache.size).toBe(5)

    emitRefresh() // wipe again
    dtoCache.clear()
    apiFetch.mockClear()
    emitRevalidate() // second foreground — only 20s since the last stamp
    expect(jest.getTimerCount()).toBe(0) // rate-limited — nothing scheduled
    expect(apiFetch).not.toHaveBeenCalled()

    jest.advanceTimersByTime(10_001) // crosses 30s total since the last stamp
    emitRevalidate() // now past the interval — fires again
    expect(jest.getTimerCount()).toBe(5)

    // Sign-out → sign-in resets the stamp, tested at low elapsed time from
    // the stamp just above: without the reset, a foreground shortly after a
    // fresh sign-in would still be rate-limited by the OUTGOING session's
    // stamp.
    setSessionState({ status: 'signed-out' })
    signIn('u2') // the arm's own one-shot batch fires immediately (unrelated
    // to this stamp — see the arm/subscriber split in the module)
    jest.advanceTimersByTime(20_000) // settle u2's own sign-in batch
    await flushMicrotasks()
    expect(dtoCache.size).toBe(5)

    emitRefresh() // wipe u2's cache too
    dtoCache.clear()
    apiFetch.mockClear()
    emitRevalidate() // 20s since the pre-sign-out stamp — would still be
    // blocked if the reset hadn't happened; fires because sign-out zeroed it.
    expect(jest.getTimerCount()).toBe(5)
  })
})

describe('screen-prefetch — foreground re-warm: dup-timer guard (R6, mutation-proved) ⚑', () => {
  it('a foreground mid-stagger does not double-schedule any target; each path fetched exactly once', async () => {
    jest.useFakeTimers()
    const apiFetch = allTargetsOkApiFetch()
    mockApiFetch(apiFetch)

    signIn()
    expect(jest.getTimerCount()).toBe(5) // sign-in batch: all 5 targets uncached

    jest.advanceTimersByTime(1_000) // record's timer fires (1st in stagger order) — its fetch is in flight, unsettled
    expect(jest.getTimerCount()).toBe(4) // the other 4 still pending, unfired

    // A foreground revalidate lands mid-batch. Stamp starts at 0, so the
    // interval gate passes trivially — isolates the dup-timer guard, not the
    // interval gate. Without tabWarmScheduled, this would schedule a SECOND
    // batch of up-to-5 timers (dtoCache.has() alone can't see an in-flight,
    // not-yet-cached path) — a real double-fetch hole.
    emitRevalidate()
    expect(jest.getTimerCount()).toBe(4) // UNCHANGED — every path already pending is deduped

    jest.advanceTimersByTime(20_000)
    await flushMicrotasks()

    for (const path of PREFETCH_PATHS) {
      expect(apiFetch.mock.calls.filter((c) => c[0] === path)).toHaveLength(1)
    }
  })
})
