/**
 * @jest-environment jsdom
 *
 * PR-B1 F-3/F-8 — the PHONE's redeem port maps the two guard outcomes.
 *
 * The route answers a provable refusal with 409 + reason 'already_redeemed'
 * and an unreadable guard with 502 + reason 'guard_unavailable'. The port has
 * to hand both back as the SAME discriminators the web action returns, or the
 * phone diverges from the browser on a money path: a generic 失敗 toast where
 * the browser says 消化済み, and — worse — no way for the recovery flow to
 * tell "provably refused" (certify the leg) from "could not check" (keep
 * owing the burn).
 *
 * Matching on `reason`, never on the message string (F-8): nothing pins that
 * copy on both sides, so an edit to it would silently regress the phone.
 */
// jsdom ships no crypto.randomUUID; the port's Idempotency-Key mints one.
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { ...globalThis.crypto, randomUUID: () => 'idem-test-uuid' },
})

const apiFetch = jest.fn()
jest.mock('@/lib/ports/data-port', () => ({ getDataPort: () => ({ apiFetch }) }))
jest.mock('../../../thin/ports/nav.vite', () => ({ redirect: jest.fn() }))

import { redeemSessionAction } from '../../../thin/ports/actions.vite'

function reply(status: number, body: unknown) {
  apiFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

const input = { packId: 'pack-1', customerId: 'cust-1', recovery: true }

beforeEach(() => jest.clearAllMocks())

describe('thin redeem port — guard discriminators', () => {
  it('409 + reason already_redeemed → already_redeemed', async () => {
    reply(409, { error: { code: 'conflict', reason: 'already_redeemed', message: 'x' } })
    expect(await redeemSessionAction(input)).toEqual({ ok: false, error: 'already_redeemed' })
  })

  it('502 + reason guard_unavailable → guard_unavailable (retryable, not a refusal)', async () => {
    reply(502, {
      error: { code: 'upstream_unavailable', reason: 'guard_unavailable', message: 'x' },
    })
    expect(await redeemSessionAction(input)).toEqual({ ok: false, error: 'guard_unavailable' })
  })

  it('reads the REASON, not the message — a copy edit cannot regress it', async () => {
    reply(409, {
      error: { code: 'conflict', reason: 'already_redeemed', message: 'totally rewritten copy' },
    })
    expect(await redeemSessionAction(input)).toEqual({ ok: false, error: 'already_redeemed' })
  })

  it('an unlabelled failure stays a generic failure', async () => {
    reply(502, { error: { code: 'upstream_unavailable', message: 'core down' } })
    expect(await redeemSessionAction(input)).toEqual({ ok: false, error: 'core down' })
  })

  it('a success still returns the redemption id', async () => {
    reply(201, { ok: true, redemptionId: 'red-1' })
    expect(await redeemSessionAction(input)).toEqual({ ok: true, redemptionId: 'red-1' })
  })

  it('forwards the recovery flag and keeps the customer OUT of the body (path id)', async () => {
    reply(201, { ok: true, redemptionId: 'red-1' })
    await redeemSessionAction({ ...input, redeemedOn: '2026-08-18' })
    const [path, init] = apiFetch.mock.calls[0] as [string, { body: string }]
    expect(path).toBe('/api/app/v1/customers/cust-1/packs/redeem')
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body).toMatchObject({ packId: 'pack-1', recovery: true, redeemedOn: '2026-08-18' })
    expect(body.customerId).toBeUndefined()
  })
})

export {}
