// Facade PATCH /karute/[id]/entries/[entryId] (edit-layer W2 PR-B, fleet
// round). Pins: expectedVersion round-trips to the shared CAS core; a core
// 409 maps to HTTP 409 with the 'conflict' code (no retry); the proof-read
// 404s a foreign/missing record BEFORE any write (T6); missing capability is
// 403 before any read/write (T3); trim-empty content is a 400, not a 502
// (T4); the choke-point audit fires exactly once with source:'facade' and
// customer_id from the proof-read (T1 facade side) — 'karute.entry.update'
// is a deliberate `skip` row in FACADE_AUDIT_MAP (see src/lib/audit.ts's
// doctrine comment: it logs at the shared choke point instead, to avoid
// double-logging), so this is the ONLY place the facade's emit is pinned.
import { createHmac } from 'node:crypto'

// The facade route imports updateKaruteDetailEntryWithClient from the SAME
// src/actions/karute.ts the web action lives in (packet convention — see
// app-api-karute-mutations.test.ts, which mocks regenerate-karute.ts's
// equally broad import graph the same way).
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
// resolveSelfStaffId's chain (customer-facade → customers/queries) has a
// top-level value import of the real ESM client — mock it so jest never
// tries to parse the package's ESM re-export.
jest.mock('@synqed-kk/client', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '田中' }]),
}))
const capabilities = { current: new Set<string>(['records.write']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const auditSpy = jest.fn()
// Spread the REAL module so FACADE_AUDIT_MAP stays live inside logFacadeAudit
// — an empty stub makes the map lookup miss ('karute.entry.update' reads as
// UNMAPPED, not skip), tripping CP6's loud floor in test mode (contract §8:
// dev/test throws on a genuinely unmapped key). Only the emitter is stubbed.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => auditSpy(...(a as [])),
}))

const get = jest.fn(async (id: string) => {
  if (id !== 'kar-1') throw Object.assign(new Error('not found'), { status: 404 })
  return { id: 'kar-1', customer_id: 'cust-1' }
})
// P3 (2026-08-19): core #69 / SDK 1.25 returns entry_edit_id from updateEntry;
// the facade receipt must carry it too (same shared choke point as the web
// path). Optional on the MOCK so the degraded case below can omit it.
const updateEntry = jest.fn(
  async (): Promise<{ id: string; entry_edit_id?: string }> => ({
    id: 'e1',
    entry_edit_id: 'edit-row-1',
  }),
)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({ karuteRecords: { get: (id: string) => get(id), updateEntry } }),
}))

import { PATCH } from '@/app/api/app/v1/karute/[id]/entries/[entryId]/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const routeFor = (id: string, entryId: string) => ({ params: Promise.resolve({ id, entryId }) })
const patchReq = (body: unknown) =>
  new Request('https://s/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${bearer()}` },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.write'])
})

describe('PATCH /karute/[id]/entries/[entryId] (edit-layer W2 PR-B)', () => {
  it('round-trips expectedVersion to the shared CAS core → 200, emits the choke-point audit once (T1 facade side)', async () => {
    const res = await PATCH(patchReq({ content: 'edited', expectedVersion: 4 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(200)
    expect(updateEntry).toHaveBeenCalledWith('kar-1', 'e1', {
      content: 'edited',
      category: undefined,
      expected_version: 4,
      actor_staff_id: 'auth-user-1',
      action: 'EDIT',
    })
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'karute.entry_edit',
        actorId: 'auth-user-1',
        businessId: 'business-1',
        source: 'facade',
        targetId: 'kar-1',
        detail: {
          entry_id: 'e1',
          category: null,
          customer_id: 'cust-1',
          entry_edit_id: 'edit-row-1',
        },
      }),
    )
  })

  it('the facade receipt carries the entry_edit_id core returned (P3)', async () => {
    updateEntry.mockResolvedValueOnce({ id: 'e1', entry_edit_id: 'edit-row-FACADE' })
    const res = await PATCH(patchReq({ content: 'edited', expectedVersion: 4 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(200)
    const { detail } = auditSpy.mock.calls[0][0] as { detail: Record<string, unknown> }
    expect(detail.entry_edit_id).toBe('edit-row-FACADE')
  })

  it('a degraded core response without the id writes null on the facade path too (P3)', async () => {
    updateEntry.mockResolvedValueOnce({ id: 'e1' })
    const res = await PATCH(patchReq({ content: 'edited', expectedVersion: 4 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(200)
    const { detail } = auditSpy.mock.calls[0][0] as { detail: Record<string, unknown> }
    expect(detail.entry_edit_id).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(detail, 'entry_edit_id')).toBe(true)
  })

  it('a core 409 maps to HTTP 409 with the conflict code, no audit', async () => {
    updateEntry.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }))
    const res = await PATCH(patchReq({ expectedVersion: 1 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('conflict')
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('trim-empty content → 400, not a generic 502 (T4 facade side)', async () => {
    const res = await PATCH(patchReq({ content: '   ', expectedVersion: 1 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(400)
    expect(updateEntry).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('foreign/missing record id → 404 before any write (T6)', async () => {
    const res = await PATCH(patchReq({ expectedVersion: 1 }), routeFor('kar-OTHER', 'e1'))
    expect(res.status).toBe(404)
    expect(updateEntry).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no read, no write (T3)', async () => {
    capabilities.current = new Set()
    const res = await PATCH(patchReq({ expectedVersion: 1 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(403)
    expect(get).not.toHaveBeenCalled()
    expect(updateEntry).not.toHaveBeenCalled()
  })
})
