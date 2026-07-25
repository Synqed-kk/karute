// Facade PATCH /karute/[id]/entries/[entryId] (edit-layer W2 PR-B). Pins:
// expectedVersion round-trips to the shared CAS core, a core 409 maps to an
// HTTP 409 with the stable 'conflict' code (no retry), and the endpoint is
// registered in FACADE_AUDIT_MAP (so thin's spine event fires via the
// facadeHandler success hook — src/lib/audit.ts).
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
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['records.write'])),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const updateEntry = jest.fn(async () => ({ id: 'e1' }))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => ({ karuteRecords: { updateEntry } }) }))

import { PATCH } from '@/app/api/app/v1/karute/[id]/entries/[entryId]/route'
import { FACADE_AUDIT_MAP } from '@/lib/audit'

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

beforeEach(() => jest.clearAllMocks())

describe('PATCH /karute/[id]/entries/[entryId] (edit-layer W2 PR-B)', () => {
  it('round-trips expectedVersion to the shared CAS core → 200', async () => {
    const res = await PATCH(patchReq({ content: 'edited', expectedVersion: 4 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(200)
    expect(updateEntry).toHaveBeenCalledWith('kar-1', 'e1', {
      content: 'edited',
      category: undefined,
      expected_version: 4,
      actor_staff_id: 'auth-user-1',
      action: 'EDIT',
    })
  })

  it('a core 409 maps to HTTP 409 with the conflict code', async () => {
    updateEntry.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }))
    const res = await PATCH(patchReq({ expectedVersion: 1 }), routeFor('kar-1', 'e1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('conflict')
  })

  it('is in FACADE_AUDIT_MAP so thin fires karute.entry_edit via the success hook', () => {
    expect(FACADE_AUDIT_MAP['karute.entry.update']).toMatchObject({
      kind: 'mutation',
      category: 'karute',
      action: 'karute.entry_edit',
      targetType: 'karute',
    })
  })
})
