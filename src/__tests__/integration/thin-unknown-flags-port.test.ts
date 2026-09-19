/**
 * PIN T3 — the "we could not check" flags survive the facade hop.
 *
 * Three doors answer with a field that is neither success detail nor an error:
 *   - createStore  → `backfillUnknown` (⚖ H2: the 1→2 backfill never started)
 *   - createStaff  → `storeUnknown`    (⚖ I2: the store list was unreadable)
 *   - createInvite → `storeUnknown`    (⚖ I2, the same on the invite door)
 *
 * On web the action returns them directly. On the phone they ride the facade's
 * 2xx body and the thin port has to carry them through — a port that drops the
 * field turns "we could not check" back into a plain success, which is the
 * exact silence H2 and I2 were ruled against. Nothing else here: the URL,
 * method and error contracts of these ports are pinned in their own files.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { createStaff, createInvite } from '../../../thin/ports/actions.vite'

function respond(body: unknown, status = 201) {
  const apiFetch = jest.fn(async () => new Response(JSON.stringify(body), { status }))
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

const STAFF = { name: '新人', position: '', email: '', phone: '' }
const INVITE = { email: 'new@test.com', role: 'STYLIST' as const, name: '新人' }

describe('thin port — the unknown flags reach the caller (T3)', () => {

  it('createStaff carries storeUnknown', async () => {
    respond({ id: 'staff-new', storeUnknown: true })
    await expect(createStaff(STAFF)).resolves.toEqual({ storeUnknown: true })
  })

  it('createStaff without the flag answers void, as it always has', async () => {
    respond({ id: 'staff-new' })
    await expect(createStaff(STAFF)).resolves.toBeUndefined()
  })

  it('createInvite carries storeUnknown alongside the token', async () => {
    respond({ token: 'tok-1', storeUnknown: true })
    await expect(createInvite(INVITE)).resolves.toEqual({ token: 'tok-1', storeUnknown: true })
  })

  it('createInvite without the flag is the plain token answer', async () => {
    respond({ token: 'tok-1' })
    await expect(createInvite(INVITE)).resolves.toEqual({ token: 'tok-1' })
  })
})
