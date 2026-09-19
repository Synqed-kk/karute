/**
 * LAYER 2 — THE FRONT GATES (⚖ Liam 2026-09-16, PKT-P2).
 *
 * The facade half: `facadeHandler` refuses EVERY endpoint for an unassigned
 * caller, before the handler body runs, with a code of its own — `store_unassigned`
 * (403) rather than the generic `forbidden` an empty capability set would
 * already produce — so the phone shell can show the honest
 * 「担当店舗が未設定です」 screen instead of a wall of permission errors.
 *
 * The web half is the app shell replacing itself with UnassignedStoreScreen;
 * its copy is pinned below (the screen itself is a client component, rendered
 * by the layout — covered by the matrix suite's front-gate column).
 */

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import ja from '@/../messages/ja.json'
import en from '@/../messages/en.json'

const identity = {
  current: {
    authUserId: 'staff-1',
    businessId: 'business-1',
    capabilities: new Set<string>(['customers.view']),
    unassigned: false,
    via: 'bearer' as const,
    email: null,
  },
}
jest.mock('@/lib/app-api/identity', () => ({
  resolveBearerIdentity: jest.fn(async () => identity.current),
}))
jest.mock('@/lib/audit', () => ({
  audit: jest.fn(),
  FACADE_AUDIT_MAP: new Proxy({}, { get: () => ({ kind: 'skip' }) }),
}))

const route = { params: Promise.resolve({}) }
const request = () => new Request('https://s/api/app/v1/x', { headers: { authorization: 'Bearer t' } })

beforeEach(() => {
  identity.current = { ...identity.current, unassigned: false, capabilities: new Set(['customers.view']) }
})

describe('facade front gate', () => {
  it('an UNASSIGNED caller is refused with store_unassigned, and the handler never runs', async () => {
    identity.current = { ...identity.current, unassigned: true, capabilities: new Set() }
    const body = jest.fn(async (ctx: FacadeContext) => ok(ctx, { ok: true }))
    const res = await facadeHandler('customer.read', body)(request(), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_unassigned')
    expect(body).not.toHaveBeenCalled()
  })

  it('every endpoint, not an allowlist — a screen, a read and a write all refuse', async () => {
    identity.current = { ...identity.current, unassigned: true, capabilities: new Set() }
    for (const endpoint of ['screens.dashboard', 'karute.window', 'karute.save'] as const) {
      const res = await facadeHandler(endpoint, async (ctx) => ok(ctx, { ok: true }))(
        request(),
        route,
      )
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('store_unassigned')
    }
  })

  it('an ASSIGNED caller is untouched — the handler runs exactly as before', async () => {
    const res = await facadeHandler('customer.read', async (ctx) => ok(ctx, { ok: true }))(
      request(),
      route,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('the code is distinct from the generic forbidden, so the shell can branch on it', () => {
    expect(new AppApiError('store_unassigned', 'x').status).toBe(403)
    expect(new AppApiError('store_unassigned', 'x').code).not.toBe('forbidden')
  })
})

describe('web front gate — the honest screen', () => {
  it('carries Liam’s copy verbatim, with an English twin', () => {
    // ⚖ Liam 2026-09-16, exact words. The screen names the state and points at
    // the one person who can fix it; it never apologises or offers a retry.
    expect(ja.unassignedStore.title).toBe('担当店舗が未設定です')
    expect(ja.unassignedStore.body).toBe(
      'このアカウントにはまだ店舗が割り当てられていません。管理者に店舗の割り当てを依頼してください。',
    )
    expect(ja.unassignedStore.logout).toBe('ログアウト')
    expect(Object.keys(en.unassignedStore)).toEqual(Object.keys(ja.unassignedStore))
  })

  it('carries the G-1 recheck action verbatim (Greptile, 2026-09-16), same register as ログアウト', () => {
    expect(ja.unassignedStore.checkAgain).toBe('もう一度確認する')
    expect(ja.unassignedStore.checking).toBe('確認中…')
    expect(en.unassignedStore.checkAgain).toBe('Check again')
    expect(en.unassignedStore.checking).toBe('Checking…')
  })
})
