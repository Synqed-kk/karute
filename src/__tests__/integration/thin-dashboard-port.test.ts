/**
 * @jest-environment jsdom
 *
 * Dashboard pack-mutation entries of the thin actions port (design-parity
 * Gap B-1 PR 2): dismissVisitReconcileAction / dismissPackAlertAction /
 * logCustomerContactAction. Pins: RPC-style passthrough (a 2xx { ok, error? }
 * body rides through verbatim) · a non-2xx business/auth failure normalizes
 * to { ok: false, error } · a transport reject maps to { ok: false, error }
 * (mirrors thin-appointments-port.test.ts's statusCall contract — these
 * components await without a try/catch, so a bare rejection would strand the
 * busy spinner) · no Idempotency-Key header is sent (none of these three are
 * redeem-class).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import {
  dismissVisitReconcileAction,
  dismissPackAlertAction,
  logCustomerContactAction,
} from '../../../thin/ports/actions.vite'

// jsdom has no global Response — a plain object with the .ok/.json() shape
// the port actually reads is enough (same approach thin-nav-port.test.tsx /
// thin-store-heal.test.ts use for their fetch mocks).
type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

function mockFetch(impl: (path: string, init?: RequestInit) => Promise<FakeResponse> | FakeResponse) {
  const apiFetch = jest.fn(impl)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

const jsonRes = (body: unknown, status = 200): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

describe('thin actions port — dashboard pack mutations', () => {
  it('dismissVisitReconcileAction: 2xx { ok:true } rides through verbatim, no Idempotency-Key sent', async () => {
    const apiFetch = mockFetch(async () => jsonRes({ ok: true }))
    const res = await dismissVisitReconcileAction({
      customerId: 'c1',
      appointmentId: 'a1',
      visitDay: '2026-07-20',
    })
    expect(res).toEqual({ ok: true })
    const [path, init] = apiFetch.mock.calls[0]
    expect(path).toBe('/api/app/v1/customers/c1/packs/reconcile/dismiss')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).not.toHaveProperty('Idempotency-Key')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      appointmentId: 'a1',
      visitDay: '2026-07-20',
    })
  })

  it('dismissVisitReconcileAction: transport reject → { ok:false, error }', async () => {
    mockFetch(async () => {
      throw new TypeError('Load failed')
    })
    await expect(
      dismissVisitReconcileAction({ customerId: 'c1', visitDay: '2026-07-20' }),
    ).resolves.toEqual({ ok: false, error: 'Load failed' })
  })

  it('dismissPackAlertAction: 2xx { ok:false, error } business result rides through verbatim', async () => {
    mockFetch(async () => jsonRes({ ok: false, error: 'no staff identity' }))
    const res = await dismissPackAlertAction({ customerId: 'c1' })
    expect(res).toEqual({ ok: false, error: 'no staff identity' })
  })

  it('dismissPackAlertAction: 403 forbidden → { ok:false, error:"forbidden" } (web-contract mapping)', async () => {
    mockFetch(async () => jsonRes({ error: { code: 'forbidden', message: 'missing capability' } }, 403))
    const res = await dismissPackAlertAction({ customerId: 'c1' })
    // PackAlertsCard branches on the LITERAL string 'forbidden', matching the
    // web action's own tolerant contract — not the raw envelope message.
    expect(res).toEqual({ ok: false, error: 'forbidden' })
  })

  it('dismissPackAlertAction: a non-forbidden failure keeps its own message', async () => {
    mockFetch(async () => jsonRes({ error: { code: 'upstream_unavailable', message: 'core down' } }, 502))
    const res = await dismissPackAlertAction({ customerId: 'c1' })
    expect(res).toEqual({ ok: false, error: 'core down' })
  })

  it('logCustomerContactAction: happy path forwards channel/note, encodes the path id', async () => {
    const apiFetch = mockFetch(async () => jsonRes({ ok: true }))
    const res = await logCustomerContactAction({
      customerId: 'c/1',
      channel: 'line',
      note: 'called back',
    })
    expect(res).toEqual({ ok: true })
    const [path, init] = apiFetch.mock.calls[0]
    expect(path).toBe(`/api/app/v1/customers/${encodeURIComponent('c/1')}/packs/contact`)
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      channel: 'line',
      note: 'called back',
    })
  })
})
