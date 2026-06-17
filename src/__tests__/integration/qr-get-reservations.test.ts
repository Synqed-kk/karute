/**
 * The cancel-sweep treats an empty day as "no live reservations → cancel the
 * day's QR rows." That is only safe if an EMPTY array means a genuinely empty
 * day — never a silent upstream failure. qrGetReservations used to `return []`
 * on a 200 with a non-array body, which would make a degraded QR response look
 * like an empty day and let the sweep wipe real bookings. It must now THROW so
 * the caller skips the day instead.
 */
import { qrGetReservations } from '@/lib/quickreserve'

const session = { token: 't', cookies: 'c' } as unknown as Parameters<typeof qrGetReservations>[0]
const origFetch = global.fetch

function mockFetch(...bodies: unknown[]) {
  let i = 0
  global.fetch = jest.fn(async () => {
    const body = bodies[Math.min(i++, bodies.length - 1)]
    return { ok: true, status: 200, json: async () => body, text: async () => '' } as unknown as Response
  }) as unknown as typeof fetch
}

afterEach(() => {
  global.fetch = origFetch
})

describe('qrGetReservations — non-array 200 safety', () => {
  it('returns the array on a healthy 200', async () => {
    mockFetch([{ id: 1 }, { id: 2 }])
    await expect(qrGetReservations(session, 'la-estro', 222, '2026-06-17')).resolves.toHaveLength(2)
  })

  it('THROWS on a 200 whose body is not an array (silent upstream failure)', async () => {
    // Both the date-string attempt AND the timestamp retry return a non-array.
    mockFetch({ error: 'session expired' }, { error: 'session expired' })
    await expect(qrGetReservations(session, 'la-estro', 222, '2026-06-17')).rejects.toThrow(/non-array/)
  })

  it('falls through to the timestamp retry when only the first form is non-array', async () => {
    // First attempt 200-but-non-array → retry with timestamp form returns the array.
    mockFetch({ error: 'bad date format' }, [{ id: 9 }])
    await expect(qrGetReservations(session, 'la-estro', 222, '2026-06-17')).resolves.toEqual([{ id: 9 }])
  })

  it('a genuinely empty day still returns []', async () => {
    mockFetch([])
    await expect(qrGetReservations(session, 'la-estro', 222, '2026-06-17')).resolves.toEqual([])
  })
})
