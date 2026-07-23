/**
 * @jest-environment jsdom
 *
 * Pre-session-brief cache warmer (perf packet 28) — fire-and-forget staggered
 * warm of GET /api/app/v1/customers/:id/ai/pre-session-brief for today's
 * active bookings. Pins: Set-dedupe across calls (repeat triggers are free) ·
 * stagger timing (nothing before 3s, then one every 4s) · a rejected fetch
 * removes the id so a later trigger can retry, and never throws/rejects
 * unhandled · a RESOLVED non-OK response (500/503, an auth-blip 401) is
 * treated the same as a failure — no silent stuck-warmed id · signed-out
 * wipes the Set AND cancels pending timers so no
 * warmed id from the outgoing staff member's scope ever fetches afterward
 * (shared-iPad hygiene, mirrors chrome-store.ts / ScreenBoundary's dtoCache).
 */
import type { Session } from '@supabase/supabase-js'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { warmBriefsForToday } from '../../../thin/data/brief-warm'

function mockApiFetch(apiFetch: jest.Mock) {
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
}

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

it('dedupes: the same id warmed across two calls only fetches once', () => {
  const apiFetch = jest.fn().mockResolvedValue({ ok: true })
  mockApiFetch(apiFetch)
  warmBriefsForToday(['c1'])
  warmBriefsForToday(['c1'])
  jest.advanceTimersByTime(20_000)
  expect(apiFetch).toHaveBeenCalledTimes(1)
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/app/v1/customers/c1/ai/pre-session-brief',
  )
})

it('staggers a batch: nothing before 3s, then one every 4s', () => {
  const apiFetch = jest.fn().mockResolvedValue({ ok: true })
  mockApiFetch(apiFetch)
  warmBriefsForToday(['c1', 'c2', 'c3'])

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

it('a failed warm removes the id so a later trigger retries, and never throws', async () => {
  const apiFetch = jest
    .fn<Promise<Response>, unknown[]>()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ ok: true } as Response)
  mockApiFetch(apiFetch)

  expect(() => warmBriefsForToday(['c1'])).not.toThrow()
  jest.advanceTimersByTime(3_000)
  // Let the rejected promise's .catch handler run before asserting.
  await Promise.resolve()
  await Promise.resolve()

  warmBriefsForToday(['c1']) // removed from the Set on failure — retries
  jest.advanceTimersByTime(3_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('a resolved non-OK response removes the id so a later trigger retries', async () => {
  const apiFetch = jest
    .fn<Promise<Response>, unknown[]>()
    .mockResolvedValueOnce({ ok: false } as Response)
    .mockResolvedValue({ ok: true } as Response)
  mockApiFetch(apiFetch)

  warmBriefsForToday(['c1'])
  jest.advanceTimersByTime(3_000)
  await Promise.resolve()
  await Promise.resolve()

  warmBriefsForToday(['c1']) // removed from the Set on !ok — retries
  jest.advanceTimersByTime(3_000)
  expect(apiFetch).toHaveBeenCalledTimes(2)
})

it('signed-out clears the Set and cancels pending timers — no fetch survives it', () => {
  const apiFetch = jest.fn().mockResolvedValue({ ok: true })
  mockApiFetch(apiFetch)
  warmBriefsForToday(['c1'])

  setSessionState({ status: 'signed-out' })
  jest.advanceTimersByTime(10_000)
  expect(apiFetch).not.toHaveBeenCalled()
})
