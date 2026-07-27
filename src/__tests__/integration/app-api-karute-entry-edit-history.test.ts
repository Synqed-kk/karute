// Facade GET /karute/[id]/entry-edits (edit-layer W2 history-sheet packet).
// Pins: missing capability → 403 before any read (T3 twin); a cross-tenant/
// missing record id → 404 via the readKaruteRaw proof-read, BEFORE the
// history read runs; happy path → 200 with the DTO shape, names resolved off
// the roster, newest first.
//
// The route imports listEntryEditHistoryWithClient from the SAME
// src/actions/karute.ts the web action lives in — same mock set as
// app-api-karute-entry-edit.test.ts (that file's sibling PATCH test) because
// importing the module pulls in its whole 'use server' import graph.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
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
  staffListByBusinessOrThrow: jest.fn(async () => [
    { id: 'auth-user-1', full_name: '田中' },
    { id: 'staff-2', full_name: '鈴木' },
  ]),
}))
const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// Spread the REAL module so FACADE_AUDIT_MAP stays live inside logFacadeAudit
// — an empty stub makes the map lookup miss ('karute.entryEdits.list' reads
// as UNMAPPED, not its real live view row — karute.entry_edits_view, Wave V),
// tripping CP6's loud floor in test mode (contract §8: dev/test throws on a
// genuinely unmapped key). Only the emitter is stubbed.
jest.mock('@/lib/audit', () => ({ ...jest.requireActual('@/lib/audit'), audit: jest.fn() }))

const get = jest.fn(async (id: string) => {
  if (id !== 'kar-1') throw Object.assign(new Error('not found'), { status: 404 })
  return { id: 'kar-1', customer_id: 'cust-1' }
})
// Shape of a raw synqed entry_edit row for mock data — mirrors
// KaruteEntryEdit (node_modules/@synqed-kk/client/dist/types.d.ts:650),
// loosened to allow `action`/`actor_staff_id`/`category`/`author_*: null`
// (legacy-null enum precedent, fix round) so mockResolvedValueOnce below can
// send a legacy-shaped row without fighting the inferred literal type.
interface MockEntryEditRow {
  id: string
  business_id: string
  customer_id: string | null
  karute_record_id: string
  entry_id_old: string | null
  entry_id_new: string | null
  actor_staff_id: string | null
  action: string | null
  category: string | null
  content_before: string | null
  content_after: string | null
  author_before: string | null
  author_after: string | null
  batch_id: string | null
  prompt_version: string | null
  model: string | null
  created_at: string
}
const listEntryEdits = jest.fn(async (): Promise<{
  entry_edits: MockEntryEditRow[]
  total: number
  page: number
  page_size: number
}> => ({
  entry_edits: [
    {
      id: 'ed-1',
      business_id: 'business-1',
      customer_id: 'cust-1',
      karute_record_id: 'kar-1',
      entry_id_old: null,
      entry_id_new: 'e1',
      actor_staff_id: 'auth-user-1',
      action: 'CREATE',
      category: 'SYMPTOM',
      content_before: null,
      content_after: 'first content',
      author_before: null,
      author_after: 'HUMAN_CREATED',
      batch_id: null,
      prompt_version: null,
      model: null,
      created_at: '2026-07-20T00:00:00.000Z',
    },
    {
      id: 'ed-2',
      business_id: 'business-1',
      customer_id: 'cust-1',
      karute_record_id: 'kar-1',
      entry_id_old: 'e1',
      entry_id_new: 'e1',
      actor_staff_id: 'staff-2',
      action: 'EDIT',
      category: 'SYMPTOM',
      content_before: 'first content',
      content_after: 'second content',
      author_before: 'HUMAN_CREATED',
      author_after: 'HUMAN_EDITED',
      batch_id: null,
      prompt_version: null,
      model: null,
      created_at: '2026-07-21T00:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  page_size: 100,
}))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({ karuteRecords: { get: (id: string) => get(id), listEntryEdits } }),
}))

import { GET } from '@/app/api/app/v1/karute/[id]/entry-edits/route'

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
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const getReq = () =>
  new Request('https://s/x', { headers: { authorization: `Bearer ${bearer()}` } })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
})

describe('GET /karute/[id]/entry-edits (edit-layer W2 history-sheet packet)', () => {
  it('missing capability → 403, no read at all (T3)', async () => {
    capabilities.current = new Set()
    const res = await GET(getReq(), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(get).not.toHaveBeenCalled()
    expect(listEntryEdits).not.toHaveBeenCalled()
  })

  it('cross-tenant/missing record id → 404 before the history read (T6)', async () => {
    const res = await GET(getReq(), routeFor('kar-OTHER'))
    expect(res.status).toBe(404)
    expect(listEntryEdits).not.toHaveBeenCalled()
  })

  it('happy path → 200, names resolved off the roster, newest first, truncated:false', async () => {
    const res = await GET(getReq(), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect(listEntryEdits).toHaveBeenCalledWith({ karute_record_id: 'kar-1', page: 1, page_size: 100 })
    const body = (await res.json()) as { edits: unknown[]; truncated: boolean }
    expect(body.truncated).toBe(false)
    expect(body.edits).toEqual([
      expect.objectContaining({
        id: 'ed-2',
        entryIdOld: 'e1',
        entryIdNew: 'e1',
        action: 'EDIT',
        actorName: '鈴木',
        contentBefore: 'first content',
        contentAfter: 'second content',
        createdAt: '2026-07-21T00:00:00.000Z',
      }),
      expect.objectContaining({
        id: 'ed-1',
        entryIdOld: null,
        entryIdNew: 'e1',
        action: 'CREATE',
        actorName: '田中',
        contentBefore: null,
        contentAfter: 'first content',
        createdAt: '2026-07-20T00:00:00.000Z',
      }),
    ])
  })

  it('happy path emits karute.entry_edits_view with the customer_id name-join detail (Wave V — real route, not the seam in isolation)', async () => {
    const res = await GET(getReq(), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const { audit } = jest.requireMock('@/lib/audit') as { audit: jest.Mock }
    const viewEmits = audit.mock.calls.filter(([e]) => e.action === 'karute.entry_edits_view')
    expect(viewEmits).toHaveLength(1)
    expect(viewEmits[0][0]).toMatchObject({
      category: 'karute',
      action: 'karute.entry_edits_view',
      targetType: 'karute',
      targetId: 'kar-1',
      source: 'facade',
      detail: { customer_id: 'cust-1' },
    })
  })

  it('a null action (legacy-null enum row) passes the DTO and renders in the body', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [
        {
          id: 'ed-legacy',
          business_id: 'business-1',
          customer_id: 'cust-1',
          karute_record_id: 'kar-1',
          entry_id_old: null,
          entry_id_new: 'e1',
          actor_staff_id: null,
          action: null,
          category: null,
          content_before: null,
          content_after: 'legacy content',
          author_before: null,
          author_after: null,
          batch_id: null,
          prompt_version: null,
          model: null,
          created_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const res = await GET(getReq(), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { edits: Array<{ action: string | null }> }
    expect(body.edits).toEqual([expect.objectContaining({ id: 'ed-legacy', action: null })])
  })
})
