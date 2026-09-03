/**
 * PHONEWIRE-2B — the 30-day deletion pair's THIN (phone) entry of the actions
 * port. Both were `notWired` stubs, so the privacy tab's 削除 CTA and the
 * banner's 元に戻す each threw into their own catch and toasted a bare 失敗.
 *
 * The `satisfies typeof import('@/actions/customers').…` pins in the port bind
 * the RETURN unions only — a function of fewer parameters stays assignable, so
 * a port that dropped its argument would still pass tsc. THIS FILE pins what
 * reaches the wire: the URL, the method, and — the part that actually decides
 * what the staffer sees — that the guard codes survive the round trip byte for
 * byte. PrivacyTabContent branches on 'already_scheduled'; the banner branches
 * on 'window_expired' and reads 'not_scheduled' as SUCCESS. A re-worded string
 * here silently collapses all three into the generic failure toast.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { scheduleCustomerDeletion, cancelCustomerDeletion } from '../../../thin/ports/actions.vite'

interface Seen {
  path: string
  init?: RequestInit
}

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const seen: Seen[] = []
  const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
    seen.push({ path, init })
    return res(path, init)
  })
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return seen
}

const okJson = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status })
/** The REAL wire shape of a facade failure: `error` is an OBJECT here, under
 *  the same key the 2xx body uses for a string guard code. */
const errorBody = (code: string, message = 'nope') => JSON.stringify({ error: { code, message } })

describe('thin actions port — scheduleCustomerDeletion', () => {
  it('POSTs the schedule door, URL-encoding the id, with no body', async () => {
    const seen = port(okJson({ success: true, id: 'cus/1' }))

    await scheduleCustomerDeletion('cus/1')

    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe('/api/app/v1/customers/cus%2F1/deletion/schedule')
    expect(seen[0].init?.method).toBe('POST')
    expect(seen[0].init?.body).toBeUndefined()
  })

  it('sends NO Idempotency-Key — the design ruling, not an oversight', async () => {
    const seen = port(okJson({ success: true, id: 'cus-1' }))
    await scheduleCustomerDeletion('cus-1')
    expect(seen[0].init?.headers).toBeUndefined()
  })

  it('2xx with an id → the web action’s success shape', async () => {
    port(okJson({ success: true, id: 'cus-1' }))
    await expect(scheduleCustomerDeletion('cus-1')).resolves.toEqual({ success: true, id: 'cus-1' })
  })

  it('the already_scheduled guard code survives the round trip verbatim', async () => {
    port(okJson({ success: false, error: 'already_scheduled' }))
    await expect(scheduleCustomerDeletion('cus-1')).resolves.toEqual({
      success: false,
      error: 'already_scheduled',
    })
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [502, 'upstream_unavailable'],
  ])('%d (%s) → the web union’s own catch-all, never the error OBJECT', async (status, code) => {
    port(async () => new Response(errorBody(code), { status }))
    await expect(scheduleCustomerDeletion('cus-1')).resolves.toEqual({ success: false, error: 'failed' })
  })

  it('a 2xx that proves nothing is not an outcome', async () => {
    port(okJson({}))
    await expect(scheduleCustomerDeletion('cus-1')).resolves.toEqual({ success: false, error: 'failed' })
  })

  it('an unparseable 2xx body is not an outcome either', async () => {
    port(async () => new Response('<html>gateway</html>', { status: 200 }))
    await expect(scheduleCustomerDeletion('cus-1')).resolves.toEqual({ success: false, error: 'failed' })
  })
})

describe('thin actions port — cancelCustomerDeletion', () => {
  it('POSTs the cancel door — a DIFFERENT path from schedule', async () => {
    const seen = port(okJson({ success: true, id: 'cus-1' }))

    await cancelCustomerDeletion('cus-1')

    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe('/api/app/v1/customers/cus-1/deletion/cancel')
    expect(seen[0].init?.method).toBe('POST')
  })

  it.each(['not_scheduled', 'window_expired'])(
    'the %s guard code survives verbatim (the banner branches on both)',
    async (code) => {
      port(okJson({ success: false, error: code }))
      await expect(cancelCustomerDeletion('cus-1')).resolves.toEqual({ success: false, error: code })
    },
  )

  it('2xx with an id → success', async () => {
    port(okJson({ success: true, id: 'cus-1' }))
    await expect(cancelCustomerDeletion('cus-1')).resolves.toEqual({ success: true, id: 'cus-1' })
  })

  it('a 502 → failed (the banner’s generic 元に戻せませんでした toast)', async () => {
    port(async () => new Response(errorBody('upstream_unavailable'), { status: 502 }))
    await expect(cancelCustomerDeletion('cus-1')).resolves.toEqual({ success: false, error: 'failed' })
  })
})

// Greptile #814. These ports SUBSTITUTE for web server actions that resolve
// { success: false, error: 'failed' } on any throw — so a native fetch
// rejection (offline, DNS, abort) must RESOLVE here too, never escape. Today's
// two callers happen to catch, which is exactly why this needs a test rather
// than a field report: the contract breaks silently for the next caller.
describe.each([
  ['scheduleCustomerDeletion', scheduleCustomerDeletion],
  ['cancelCustomerDeletion', cancelCustomerDeletion],
])('%s — transport rejection', (_name, action) => {
  it('resolves the web union’s failure, never rejects', async () => {
    port(async () => {
      throw new TypeError('Failed to fetch')
    })
    // .resolves is the assertion — a rejection fails the test here, and the
    // explicit toEqual pins that the transport MESSAGE never becomes a guard
    // code the UI would try to branch on.
    await expect(action('cus-1')).resolves.toEqual({ success: false, error: 'failed' })
  })
})
