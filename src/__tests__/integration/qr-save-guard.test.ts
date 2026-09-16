/**
 * PKT-P0 — Quick Reserve save guard (2026-09-16).
 *
 * Core keeps ONE QuickReserve config per business, and the route used to
 * stamp every save with La Estro's hardcoded store_slug/store_id. A 銀座
 * manager (or a brand-new company's owner) saving here would silently
 * rebind — or misfile — 代官山's live crawl. This pins the refusal:
 *   (a) an existing config already labeled for the actor's store → save ok
 *   (b) the same config, a DIFFERENT store's actor → 409
 *   (c) no config yet, a multi-store business → 409 (no safe store to bind)
 *   (d) no config yet, a single-store business → save ok, no store ids
 *   (e) an existing config with no store label at all (legacy) → 409 for
 *       every actor, fail closed — see PKT-P0-QR-SAVE-GUARD-2026-09-16.md.
 */

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn().mockResolvedValue('biz-A'),
  resolveUserId: jest.fn().mockResolvedValue('user-1'),
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => new Set(['sync.view'])),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const actorStore = { current: 'daikanyama' as string | null }
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({
    storeId: actorStore.current,
    viewAll: false,
    allowedStoreIds: actorStore.current ? [actorStore.current] : null,
    degraded: false,
  })),
}))

import { POST } from '@/app/api/sync/quickreserve/config/route'

const client = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }

function mockClient(opts: {
  existing: Record<string, unknown> | null
  storeCount?: number
}) {
  const upsertConfig = jest.fn(async () => ({}))
  client.getSynqedClient.mockResolvedValue({
    sync: { getConfig: jest.fn().mockResolvedValue(opts.existing), upsertConfig },
    stores: {
      list: jest.fn().mockResolvedValue({
        stores: Array.from({ length: opts.storeCount ?? 1 }, (_, i) => ({ id: `store-${i}` })),
      }),
    },
  })
  return upsertConfig
}

function req() {
  return new Request('https://app.test/api/sync/quickreserve/config', {
    method: 'POST',
    body: JSON.stringify({ username: 'velune', enabled: true }),
  })
}

describe('POST /api/sync/quickreserve/config — save guard (PKT-P0)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    actorStore.current = 'daikanyama'
  })

  it('(a) La Estro-shaped existing config + actor on 代官山 → save ok, slug/id untouched', async () => {
    const upsertConfig = mockClient({
      existing: { karute_store_id: 'daikanyama', store_slug: 'la-estro', store_id: 222 },
    })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(upsertConfig).toHaveBeenCalledWith(
      'QUICKRESERVE',
      expect.objectContaining({ store_slug: 'la-estro', store_id: 222 }),
    )
  })

  it('(b) same config + actor on 銀座 → 409', async () => {
    mockClient({ existing: { karute_store_id: 'daikanyama', store_slug: 'la-estro', store_id: 222 } })
    actorStore.current = 'ginza'
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'qr_store_not_ready' })
  })

  it('(c) no config + 2 stores → 409', async () => {
    mockClient({ existing: null, storeCount: 2 })
    const res = await POST(req())
    expect(res.status).toBe(409)
  })

  it('(d) no config + 1 store → save ok WITHOUT slug/id', async () => {
    const upsertConfig = mockClient({ existing: null, storeCount: 1 })
    const res = await POST(req())
    expect(res.status).toBe(200)
    const [, input] = upsertConfig.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(input).not.toHaveProperty('store_slug')
    expect(input).not.toHaveProperty('store_id')
  })

  it('(e) existing config with no karute_store_id (legacy null) + actor on any store → 409 (fail closed)', async () => {
    mockClient({ existing: { karute_store_id: null, store_slug: 'la-estro', store_id: 222 } })
    const res = await POST(req())
    expect(res.status).toBe(409)
  })
})
