// Facade: POST /api/app/v1/recordings/share (⚖ Liam 2026-09-13 sharing law;
// 2026-09-14 design D6). Harness mirrors recording-playback-url.test.ts's
// facade section: all network mocked, the Bearer verifier runs for real.
// What only THIS level can prove: the envelope (capability, body validation,
// revocation registration, the roster-failed → upstream_unavailable rule) and
// the refusal mapping — the shared body's own rules are pinned in
// recording-share.test.ts, so `setRecordingSharedWithClient` is mocked here.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

const getUser = {
  fn: jest.fn(async () => ({ data: { user: { id: 'auth-user-1' } }, error: null as { message: string } | null })),
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view', 'records.write']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] }
const rosterThrows = { current: false }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => {
    if (rosterThrows.current) throw new Error('roster read failed')
    return roster.current
  }),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: jest.fn(() => ({})) }))

type ShareResult =
  | { ok: true; shared: boolean; sharedAt: string | null; changed: boolean }
  | { error: 'not_found' | 'no_recording' | 'forbidden' | 'upstream' }
const shareResult = {
  current: { ok: true, shared: true, sharedAt: '2026-09-14T00:00:00.000Z', changed: true } as ShareResult,
}
const setRecordingSharedWithClient = jest.fn(async () => shareResult.current)
jest.mock('@/lib/recording/share', () => ({
  setRecordingSharedWithClient: (...a: unknown[]) => setRecordingSharedWithClient(...(a as [])),
}))

import { POST } from '@/app/api/app/v1/recordings/share/route'
import { requiresRevocationCheck } from '@/lib/auth/revocation'

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
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }
const noRoute = { params: Promise.resolve({}) }
const post = (body: unknown, headers: Record<string, string> = auth) =>
  POST(
    new Request('https://s/api/app/v1/recordings/share', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    noRoute,
  )

beforeEach(() => {
  capabilities.current = new Set(['customers.view', 'records.write'])
  rosterThrows.current = false
  shareResult.current = { ok: true, shared: true, sharedAt: '2026-09-14T00:00:00.000Z', changed: true }
  setRecordingSharedWithClient.mockClear()
})

describe('POST /api/app/v1/recordings/share', () => {
  it("revocation registered — a just-removed staffer must not reach this write on the local fast-path", () => {
    expect(requiresRevocationCheck('recordings.share')).toBe(true)
  })

  it('401 without a bearer', async () => {
    const res = await post({ karuteId: 'k-1', shared: true }, { 'content-type': 'application/json' })
    expect(res.status).toBe(401)
    expect(setRecordingSharedWithClient).not.toHaveBeenCalled()
  })

  it('403 without records.write', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await post({ karuteId: 'k-1', shared: true })
    expect(res.status).toBe(403)
    expect(setRecordingSharedWithClient).not.toHaveBeenCalled()
  })

  it('validation: missing karuteId', async () => {
    const res = await post({ shared: true })
    expect(res.status).toBe(400)
  })

  it('validation: shared not a boolean', async () => {
    const res = await post({ karuteId: 'k-1', shared: 'yes' })
    expect(res.status).toBe(400)
  })

  it('validation: non-JSON body', async () => {
    const res = await POST(
      new Request('https://s/api/app/v1/recordings/share', { method: 'POST', headers: auth, body: 'not json' }),
      noRoute,
    )
    expect(res.status).toBe(400)
  })

  it('a 200 reports the response shape { shared }', async () => {
    const res = await post({ karuteId: 'k-1', shared: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ shared: true })
    expect(setRecordingSharedWithClient).toHaveBeenCalledTimes(1)
  })

  it('maps forbidden → 403', async () => {
    shareResult.current = { error: 'forbidden' }
    const res = await post({ karuteId: 'k-1', shared: true })
    expect(res.status).toBe(403)
  })

  it('maps not_found → 404, with NO `reason` on the body (the karute itself is missing — genuinely distinct from no_recording)', async () => {
    shareResult.current = { error: 'not_found' }
    const res = await post({ karuteId: 'k-1', shared: true })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.reason).toBeUndefined()
  })

  // ⚠ G3 (Greptile round 4, P2). AppApiErrorCode stays a closed union (still
  // `not_found`), but the body now carries `reason: 'no_recording'` — a
  // sibling of `code`/`message` (errors.ts's errorBody spreads
  // AppApiError.detail directly into the JSON `error` object; see
  // handler.ts:169 → errors.ts:97-99) — so the phone can tell a genuinely
  // missing karute apart from an existing one with nothing to share.
  it('maps no_recording → 404 with a distinguishing message AND body.error.reason === "no_recording" (no AppApiErrorCode of its own)', async () => {
    shareResult.current = { error: 'no_recording' }
    const res = await post({ karuteId: 'k-1', shared: true })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.message).toMatch(/no recording/i)
    expect(body.error.reason).toBe('no_recording')
  })

  it('maps upstream → 502', async () => {
    shareResult.current = { error: 'upstream' }
    const res = await post({ karuteId: 'k-1', shared: true })
    expect(res.status).toBe(502)
  })

  it('a roster read failure → 502, never a guessed forbidden (a recorder must not lose her own toggle to a blip)', async () => {
    rosterThrows.current = true
    const res = await post({ karuteId: 'k-1', shared: true })
    expect(res.status).toBe(502)
    expect(setRecordingSharedWithClient).not.toHaveBeenCalled()
  })
})
