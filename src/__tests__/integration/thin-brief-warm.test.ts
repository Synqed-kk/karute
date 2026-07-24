/**
 * @jest-environment jsdom
 *
 * Pre-session-brief cache warmer (perf packet 28) — fire-and-forget staggered
 * warm of GET /api/app/v1/customers/:id/ai/pre-session-brief?locale=ja&
 * appointmentId=:id (the EXACT shape RecordScreen.tsx requests — locale and
 * appointmentId are part of the cache key, so anything less warms a key the
 * real read never hits) for today's active bookings. Pins: dedupe keyed on
 * appointmentId, across calls (repeat triggers are free; two bookings for
 * the same customer warm independently) · stagger timing (nothing before
 * 3s, then one every 4s within a batch) · a rejected fetch OR a resolved
 * non-OK response (500/503, an auth-blip 401) both release the booking so a
 * later trigger can retry, and never throw/reject unhandled · a 2-attempt
 * ceiling — a booking that fails twice gives up for the session (the real
 * page-open takes over) · signed-out wipes everything so no warmed booking
 * from the outgoing staff member's scope ever fetches afterward (shared-iPad
 * hygiene, mirrors chrome-store.ts / ScreenBoundary's dtoCache) · a STALE
 * in-flight fetch from a signed-out session cannot corrupt the replacement
 * session's warmed set on late resolution (epoch guard, mirrors
 * chrome-store.ts's epoch idiom — Greptile round 1 on #594).
 */
import type { Session } from '@supabase/supabase-js'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { warmBriefsForToday, type BriefWarmTarget } from '../../../thin/data/brief-warm'

function mockApiFetch(apiFetch: jest.Mock) {
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
}

// The warm now routes through brief-cache's fetchBrief (perf packet 33),
// which chains a few more .then()/.catch() hops than the inline apiFetch
// call this file was originally written against — 2 flushed ticks is no
// longer enough to let a settle's release() run before the next assertion.
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

const target = (customerId: string, appointmentId: string): BriefWarmTarget => ({
  customerId,
  appointmentId,
})

beforeEach(() => {
  jest.useFakeTimers()
  setSessionState({
    status: 'signed-in',
    session: { access_token: 'tok', user: { id: 'u1' } } as Session,
  })
})

afterEach(() => {
  // Real sign-out is the module's only reset path (no test-only escape
  // hatch) — same two-step settle-back as thin-store-heal.test.ts.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
  jest.useRealTimers()
})

it('dedupes on appointmentId across calls, and requests the exact RecordScreen shape', () => {
  const apiFetch = jest.fn().mockResolvedValue({ ok: true })
  mockApiFetch(apiFetch)
  warmBriefsForToday([target('c1', 'a1')])
  warmBriefsForToday([target('c1', 'a1')])
  jest.advanceTimersByTime(20_000)
  expect(apiFetch).toHaveBeenCalledTimes(1)
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/app/v1/customers/c1/ai/pre-session-brief?locale=ja&appointmentId=a1',
  )
})

it('two bookings for the same customer warm independently (keyed on appointmentId)', () => {
  const apiFetch = jest.fn().mockResolvedValue({ ok: true })
  mockApiFetch(apiFetch)
  warmBriefsForToday([target('c1', 'a1'), target('c1', 'a2')])
  jest.advanceTimersByTime(20_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('staggers a batch: nothing before 3s, then one every 4s', () => {
  const apiFetch = jest.fn().mockResolvedValue({ ok: true })
  mockApiFetch(apiFetch)
  warmBriefsForToday([target('c1', 'a1'), target('c2', 'a2'), target('c3', 'a3')])

  jest.advanceTimersByTime(2_999)
  expect(apiFetch).not.toHaveBeenCalled()

  jest.advanceTimersByTime(1) // t=3000
  expect(apiFetch).toHaveBeenCalledTimes(1)

  jest.advanceTimersByTime(3_999)
  expect(apiFetch).toHaveBeenCalledTimes(1)

  jest.advanceTimersByTime(1) // t=7000
  expect(apiFetch).toHaveBeenCalledTimes(2)

  jest.advanceTimersByTime(4_000) // t=11000
  expect(apiFetch).toHaveBeenCalledTimes(3)
})

it('a failed warm releases the booking so a later trigger retries, and never throws', async () => {
  const apiFetch = jest
    .fn<Promise<Response>, unknown[]>()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ ok: true } as Response)
  mockApiFetch(apiFetch)

  expect(() => warmBriefsForToday([target('c1', 'a1')])).not.toThrow()
  jest.advanceTimersByTime(3_000)
  // Let the rejected promise's .catch handler run before asserting.
  await flushMicrotasks()

  warmBriefsForToday([target('c1', 'a1')]) // released on failure — retries
  jest.advanceTimersByTime(3_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('a resolved non-OK response releases the booking so a later trigger retries', async () => {
  const apiFetch = jest
    .fn<Promise<Response>, unknown[]>()
    .mockResolvedValueOnce({ ok: false } as Response)
    .mockResolvedValue({ ok: true } as Response)
  mockApiFetch(apiFetch)

  warmBriefsForToday([target('c1', 'a1')])
  jest.advanceTimersByTime(3_000)
  await flushMicrotasks()

  warmBriefsForToday([target('c1', 'a1')]) // released on !ok — retries
  jest.advanceTimersByTime(3_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('gives up after 2 failed attempts — a third call schedules nothing', async () => {
  const apiFetch = jest.fn<Promise<Response>, unknown[]>().mockResolvedValue({ ok: false } as Response)
  mockApiFetch(apiFetch)

  warmBriefsForToday([target('c1', 'a1')]) // attempt 1
  jest.advanceTimersByTime(3_000)
  await flushMicrotasks()

  warmBriefsForToday([target('c1', 'a1')]) // attempt 2 (ceiling)
  jest.advanceTimersByTime(3_000)
  await flushMicrotasks()
  expect(apiFetch).toHaveBeenCalledTimes(2)

  warmBriefsForToday([target('c1', 'a1')]) // ceiling hit — no third schedule
  jest.advanceTimersByTime(10_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('a stale in-flight release from a signed-out session cannot corrupt the new session (epoch guard)', async () => {
  let resolveFirst: (r: Response) => void = () => {}
  const brief = {
    isFirstTimeVisit: false,
    lastVisitDate: 'x',
    lastVisitAgo: 'x',
    hooks: [],
    concerns: [],
    lastProduct: null,
    recommendedFocus: null,
    reservationMemo: null,
    memoAnalysis: [],
  }
  const apiFetch = jest
    .fn<Promise<Response>, unknown[]>()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolveFirst = r
        }),
    )
    // u2's warm must land as a genuine SUCCESS (brief-cache now reads the
    // body) so the epoch guard under test — u1's stale release() being a
    // no-op — is isolated from an unrelated "warmed but uncached" retry.
    .mockResolvedValue({ ok: true, json: async () => ({ brief }) } as unknown as Response)
  mockApiFetch(apiFetch)

  // u1, epoch 0: fire the warm — fetch #1 in flight, held.
  warmBriefsForToday([target('c1', 'a1')])
  jest.advanceTimersByTime(3_000)
  expect(apiFetch).toHaveBeenCalledTimes(1)

  // Sign-out resets warmed/attempts and bumps the epoch; u2 signs in and
  // re-warms the SAME appointmentId — its own fresh timer fires fetch #2.
  setSessionState({ status: 'signed-out' })
  setSessionState({
    status: 'signed-in',
    session: { access_token: 'tok2', user: { id: 'u2' } } as Session,
  })
  warmBriefsForToday([target('c1', 'a1')])
  jest.advanceTimersByTime(3_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)

  // NOW u1's stale fetch resolves non-OK. Its release() must be a no-op
  // against u2's warmed set — the whole point of the epoch guard.
  resolveFirst({ ok: false } as Response)
  await flushMicrotasks()

  // A later trigger for the same booking must NOT re-schedule a redundant
  // paid warm — u2's entry was never deleted.
  warmBriefsForToday([target('c1', 'a1')])
  jest.advanceTimersByTime(10_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('signed-out clears everything and cancels pending timers — no fetch survives it', () => {
  const apiFetch = jest.fn().mockResolvedValue({ ok: true })
  mockApiFetch(apiFetch)
  warmBriefsForToday([target('c1', 'a1')])

  setSessionState({ status: 'signed-out' })
  jest.advanceTimersByTime(10_000)
  expect(apiFetch).not.toHaveBeenCalled()
})
