// PACKET HOTFIX 2 (2026-09-05) — pins the actor-bearer forwarding contract at
// the door: newSynqedClient(businessId, accessToken) forwards the caller's own
// verified bearer to core on recording writes (core docs/actor-auth-contract.md
// "G1", core #81 — PUT /v1/recordings/:id now 401s without it).
//
// `src/lib/synqed/client.ts` (the seam this packet changes) runs FOR REAL here
// — only the SDK's transport (`@synqed-kk/client`, an ESM-only package jest
// cannot load unmocked) is doubled, at its `fetch` method, the one place every
// SDK call funnels through. That means ActorSynqedClient's actual header
// injection runs for real on every assertion below; the double only stands in
// for the network hop core itself would answer.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-api-key'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))

const capabilities = { current: new Set<string>(['records.write']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] }
/** The cookie session's own token (web arm) — distinct from any facade bearer
 *  used in this file, so a mixed-up wire request would fail the assertion. */
const WEB_TOKEN = 'web-cookie-access-token-xyz'
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
  getCurrentAccessToken: jest.fn(async () => WEB_TOKEN),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
  can: jest.fn(async (c: string) => capabilities.current.has(c)),
  getMyCapabilities: jest.fn(async () => capabilities.current),
  requireCapability: jest.fn(async (c: string) => {
    if (!capabilities.current.has(c)) throw new Error('You do not have permission to perform this action.')
  }),
}))

const createSignedUploadUrl = jest.fn(async (p: string) => ({
  data: { path: p, signedUrl: `https://proj.supabase.co/upload/${p}`, token: 'tok-1' },
  error: null as { message: string } | null,
}))
const info = jest.fn(async (_key: string) => ({
  data: { size: 1024 } as { size?: number } | null,
  error: null as { message: string; status?: number; statusCode?: string } | null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ createSignedUploadUrl, info }) } }),
}))

// The SDK's transport double. Self-contained inside the factory (jest.mock
// hoists above this file's other consts, so nothing outside `mock*`-prefixed
// names may be referenced here) — exposes its recorded calls + row state as
// extra named exports the test file reads back via a plain import.
jest.mock('@synqed-kk/client', () => {
  const mockFetchCalls: { method: string; path: string; headers: Record<string, string> }[] = []
  let mockRow: unknown = null
  class FakeSynqedClient {
    baseUrl: string
    apiKey: string
    businessId: string
    recordings: { get: (id: string) => Promise<unknown>; update: (id: string, input: unknown) => Promise<unknown> }
    constructor(config: { baseUrl: string; apiKey: string; businessId: string }) {
      this.baseUrl = config.baseUrl
      this.apiKey = config.apiKey
      this.businessId = config.businessId
      this.recordings = {
        get: (id: string) => this.fetch(`/recordings/${id}`),
        update: (id: string, input: unknown) =>
          this.fetch(`/recordings/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
      }
    }
    // Real SynqedClient.fetch's own shape (dist/client.js): base headers,
    // then the caller's own headers spread LAST — the same order
    // ActorSynqedClient's Authorization override relies on.
    async fetch(path: string, init?: RequestInit): Promise<unknown> {
      const method = (init?.method ?? 'GET').toString().toUpperCase()
      const headers = {
        'x-api-key': this.apiKey,
        'x-business-id': this.businessId,
        'Content-Type': 'application/json',
        ...((init?.headers as Record<string, string>) ?? {}),
      }
      mockFetchCalls.push({ method, path, headers })
      if (method === 'PUT') {
        mockRow = { ...(mockRow as object), ...JSON.parse(String(init!.body)) }
      }
      return mockRow
    }
  }
  return {
    SynqedClient: FakeSynqedClient,
    SynqedError: class extends Error {},
    __fetchCalls: mockFetchCalls,
    __setRow: (row: unknown) => {
      mockRow = row
    },
  }
})

import { POST as finalizePOST } from '@/app/api/app/v1/recordings/finalize/route'
import { POST as mintPOST } from '@/app/api/app/v1/recordings/upload-url/route'
import { finalizeTake } from '@/actions/recordings'
import { newSynqedClient } from '@/lib/synqed/client'
import { TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const synqedKkMock = jest.requireMock('@synqed-kk/client') as any
type FetchCall = { method: string; path: string; headers: Record<string, string> }
const fetchCalls: FetchCall[] = synqedKkMock.__fetchCalls
const setRow: (row: unknown) => void = synqedKkMock.__setRow

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(sub = 'auth-user-1') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const noRoute = { params: Promise.resolve({}) }
const jreq = (headers: Record<string, string>, body?: unknown) =>
  new Request('https://s/x', { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })

const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const KEY = `app_business-1_${TAKE}.mp4`
type Row = {
  id: string
  business_id: string
  staff_id: string
  status: string
  audio_storage_path: string | null
  duration_seconds: number | null
}
const ROW: Row = {
  id: SESSION,
  business_id: 'business-1',
  staff_id: 'auth-user-1',
  status: 'UPLOADING',
  audio_storage_path: null,
  duration_seconds: null,
}

const finalizeBody = {
  takeId: TAKE,
  mimeType: 'audio/mp4',
  durationSeconds: 12.9,
  byteLength: 1024,
  recordingSessionId: SESSION,
}
const mintBody = { takeId: TAKE, mimeType: 'audio/mp4', recordingSessionId: SESSION }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  capabilities.current = new Set(['records.write'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  info.mockResolvedValue({ data: { size: 1024 }, error: null })
  setRow({ ...ROW, audio_storage_path: KEY })
  fetchCalls.length = 0
})

describe('actor-bearer forwarding — the door contract (packet hotfix 2)', () => {
  it("(a) facade finalize route: core PUT /v1/recordings/<id> carries the request's OWN bearer", async () => {
    const token = bearer()
    const res = await finalizePOST(
      jreq({ authorization: `Bearer ${token}`, 'content-type': 'application/json' }, finalizeBody),
      noRoute,
    )
    expect(res.status).toBe(200)
    const put = fetchCalls.find((c) => c.method === 'PUT' && c.path === `/recordings/${SESSION}`)
    expect(put).toBeDefined()
    expect(put!.headers.Authorization).toBe(`Bearer ${token}`)
  })

  it("(b) facade upload-url route: the reservation-commit PUT carries the request's OWN bearer", async () => {
    setRow({ ...ROW, audio_storage_path: null })
    info.mockResolvedValue({ data: null, error: { message: 'Object not found', status: 404 } })
    const token = bearer()
    const res = await mintPOST(
      jreq({ authorization: `Bearer ${token}`, 'content-type': 'application/json' }, mintBody),
      noRoute,
    )
    expect(res.status).toBe(200)
    const put = fetchCalls.find((c) => c.method === 'PUT' && c.path === `/recordings/${SESSION}`)
    expect(put).toBeDefined()
    expect(put!.headers.Authorization).toBe(`Bearer ${token}`)
  })

  it("(c) web finalizeTake action: the PUT carries getCurrentAccessToken()'s value", async () => {
    const result = await finalizeTake(finalizeBody)
    expect(result).toEqual({ ok: true, recordingSessionId: SESSION })
    const put = fetchCalls.find((c) => c.method === 'PUT' && c.path === `/recordings/${SESSION}`)
    expect(put).toBeDefined()
    expect(put!.headers.Authorization).toBe(`Bearer ${WEB_TOKEN}`)
  })

  it('(d) a facade READ (GET /v1/recordings/<id>) also carries it — the wrapper adds it to every call', async () => {
    const token = bearer()
    await finalizePOST(
      jreq({ authorization: `Bearer ${token}`, 'content-type': 'application/json' }, finalizeBody),
      noRoute,
    )
    const get = fetchCalls.find((c) => c.method === 'GET' && c.path === `/recordings/${SESSION}`)
    expect(get).toBeDefined()
    expect(get!.headers.Authorization).toBe(`Bearer ${token}`)
  })

  // RED PIN. If a route ever regresses to the token-less factory, this is the
  // shape it falls back to: no Authorization header at all, on the SAME PUT
  // core now 401s without one.
  it('(e) RED PIN — newSynqedClient(businessId) with NO token puts no Authorization header on the wire', async () => {
    const synqed = newSynqedClient('business-1')
    await synqed.recordings.update(SESSION, { duration_seconds: 12, status: 'UPLOADING' })
    const put = fetchCalls.find((c) => c.method === 'PUT' && c.path === `/recordings/${SESSION}`)
    expect(put).toBeDefined()
    expect(put!.headers.Authorization).toBeUndefined()
  })
})
