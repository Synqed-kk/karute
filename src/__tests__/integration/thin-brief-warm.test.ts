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
 * hygiene, mirrors chrome-store.ts / ScreenBoundary's dtoCache).
 */
import type { Session } from '@supabase/supabase-js'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { warmBriefsForToday, type BriefWarmTarget } from '../../../thin/data/brief-warm'

function mockApiFetch(apiFetch: jest.Mock) {
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
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
  await Promise.resolve()
  await Promise.resolve()

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
  await Promise.resolve()
  await Promise.resolve()

  warmBriefsForToday([target('c1', 'a1')]) // released on !ok — retries
  jest.advanceTimersByTime(3_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('gives up after 2 failed attempts — a third call schedules nothing', async () => {
  const apiFetch = jest.fn<Promise<Response>, unknown[]>().mockResolvedValue({ ok: false } as Response)
  mockApiFetch(apiFetch)

  warmBriefsForToday([target('c1', 'a1')]) // attempt 1
  jest.advanceTimersByTime(3_000)
  await Promise.resolve()
  await Promise.resolve()

  warmBriefsForToday([target('c1', 'a1')]) // attempt 2 (ceiling)
  jest.advanceTimersByTime(3_000)
  await Promise.resolve()
  await Promise.resolve()
  expect(apiFetch).toHaveBeenCalledTimes(2)

  warmBriefsForToday([target('c1', 'a1')]) // ceiling hit — no third schedule
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
