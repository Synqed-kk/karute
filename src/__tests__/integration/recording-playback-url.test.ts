// The play button's mint (build 23 slice ①) — the shared body, both doors and
// both port arms. Same harness as app-api-recording-finalize.test.ts: all
// network mocked, the Bearer verifier runs for real.
//
// What this file owns is the THREE claims the body's own header makes:
//   1. the fence is isOwnRecordingKey (take-only) — a null path, a discard's
//      stg/ copy and another tenant's key are one answer;
//   2. the ACL is canViewTranscript with the owner floor OR'd in — the words
//      and the sound are one rule;
//   3. one recording.play row per successful mint, and ZERO on every refusal.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] }
const rosterThrows = { current: false }
const webCaps = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
  staffListByBusinessOrThrow: jest.fn(async () => {
    if (rosterThrows.current) throw new Error('roster read failed')
    return roster.current
  }),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
  can: jest.fn(async (cap: string) => webCaps.current.has(cap)),
}))
// The card→profile translation. Default null: the fixtures stamp profile ids,
// which the `?? original` fallback keeps unchanged.
const cardLookup = { current: null as string | null }
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupProfileIdForSynqedStaffIdForBusiness: jest.fn(async () => cardLookup.current),
}))

const createSignedUrl = jest.fn(async (path: string, _ttl: number) => ({
  data: { signedUrl: `https://proj.supabase.co/read/${path}?token=t` } as { signedUrl: string } | null,
  error: null as { message: string } | null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ createSignedUrl }) } }),
}))

const KARUTE_ID = '00000000-0000-4000-8000-000000000008'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const TAKE = '11111111-1111-4111-8111-111111111111'
const TAKE_KEY = `app_business-1_${TAKE}.mp4`

const KAR = {
  current: { id: KARUTE_ID, staff_id: 'auth-user-1', recording_session_id: SESSION } as Record<string, unknown>,
}
const ROW = {
  current: {
    id: SESSION,
    store_id: 'store-9',
    audio_storage_path: TAKE_KEY as string | null,
    duration_seconds: 742 as number | null,
    status: 'COMPLETED',
  },
}
const karuteGet = jest.fn(async (id: string) => {
  if (id !== KARUTE_ID) throw Object.assign(new Error('nope'), { status: 404 })
  return KAR.current
})
const recordingsGet = jest.fn(async (id: string) => {
  if (id !== SESSION) throw Object.assign(new Error('nope'), { status: 404 })
  return ROW.current
})
const fakeClient = {
  karuteRecords: { get: (id: string) => karuteGet(id) },
  recordings: { get: (id: string) => recordingsGet(id) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { GET, OPTIONS } from '@/app/api/app/v1/recordings/playback-url/route'
import { mintRecordingPlaybackUrl } from '@/actions/recording-playback'
import { mintPlaybackUrlWithClient, PLAYBACK_URL_TTL_S } from '@/lib/recording/playback-url'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import { AUDIT_ACTIONS, AUDITED_CORES } from '@/lib/audit-policy'
import { auditLines } from './helpers/audit-lines'

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
const auth = { authorization: `Bearer ${bearer()}` }
const route = { params: Promise.resolve({}) }
const req = (karuteId?: string) =>
  new Request(
    `https://s/api/app/v1/recordings/playback-url${karuteId === undefined ? '' : `?karuteId=${encodeURIComponent(karuteId)}`}`,
    { headers: auth },
  )

/** The body, called directly with an actor — the ACL matrix's harness. */
const mint = (actor: Partial<Parameters<typeof mintPlaybackUrlWithClient>[1]> = {}) =>
  mintPlaybackUrlWithClient(
    fakeClient as unknown as Parameters<typeof mintPlaybackUrlWithClient>[0],
    { staffId: 'auth-user-1', businessId: 'business-1', canHearAll: false, source: 'web', ...actor },
    { karuteId: KARUTE_ID },
  )

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  webCaps.current = new Set(['customers.view'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  rosterThrows.current = false
  cardLookup.current = null
  KAR.current = { id: KARUTE_ID, staff_id: 'auth-user-1', recording_session_id: SESSION }
  ROW.current = { id: SESSION, store_id: 'store-9', audio_storage_path: TAKE_KEY, duration_seconds: 742, status: 'COMPLETED' }
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: `https://proj.supabase.co/read/${TAKE_KEY}?token=t` },
    error: null,
  })
  // clearAllMocks wipes CALLS, not implementations — a mockRejectedValue from
  // an earlier case would otherwise leak into every test after it.
  karuteGet.mockImplementation(async (id: string) => {
    if (id !== KARUTE_ID) throw Object.assign(new Error('nope'), { status: 404 })
    return KAR.current
  })
  recordingsGet.mockImplementation(async (id: string) => {
    if (id !== SESSION) throw Object.assign(new Error('nope'), { status: 404 })
    return ROW.current
  })
})

describe('mintPlaybackUrlWithClient — the ACL matrix (claim 2)', () => {
  it('the RECORDER hears her own take', async () => {
    const r = await mint()
    expect(r).toEqual({
      url: expect.stringContaining(TAKE_KEY),
      expiresAt: expect.any(String),
      durationSeconds: 742,
    })
  })

  it('another staffer without canHearAll is FORBIDDEN', async () => {
    const r = await mint({ staffId: 'someone-else' })
    expect(r).toEqual({ error: 'forbidden' })
  })

  it('canHearAll hears a colleague’s take (viewAll and the owner floor reach the same input)', async () => {
    const r = await mint({ staffId: 'someone-else', canHearAll: true })
    expect('url' in r).toBe(true)
  })

  // D-14: an ownerless (legacy/manual) record keeps canViewTranscript's shared
  // answer for the sound as well as the words — one predicate, no second truth.
  it('an OWNERLESS karute is shared, for audio too', async () => {
    KAR.current = { ...KAR.current, staff_id: null }
    const r = await mint({ staffId: 'someone-else' })
    expect('url' in r).toBe(true)
  })

  // Recorder-lock fix (⚖ 8/22): a card-id-stamped row must not lock the
  // recorder out of her own audio.
  it('a card-id-stamped owner row resolves via staff-map — the recorder hears her own take', async () => {
    KAR.current = { ...KAR.current, staff_id: 'card-101' }
    cardLookup.current = 'auth-user-1'
    const r = await mint()
    expect('url' in r).toBe(true)
  })
})

describe('mintPlaybackUrlWithClient — the fence and the failures (claims 1 + honesty)', () => {
  it('no recording_session_id → no_audio, and the row is never read', async () => {
    KAR.current = { ...KAR.current, recording_session_id: null }
    expect(await mint()).toEqual({ error: 'no_audio' })
    expect(recordingsGet).not.toHaveBeenCalled()
  })

  it('a null audio path → no_audio', async () => {
    ROW.current = { ...ROW.current, audio_storage_path: null }
    expect(await mint()).toEqual({ error: 'no_audio' })
  })

  // A discarded take's audio sits at a stg/ key the row is deliberately NOT
  // re-pointed to (DESIGN-SLICE5 D10). The fence is take-only and must stay so.
  it('a stg/ staged discard copy → no_audio (the fence is TAKE-only)', async () => {
    ROW.current = { ...ROW.current, audio_storage_path: `stg/business-1_${SESSION}_${TAKE}.mp4` }
    expect(await mint()).toEqual({ error: 'no_audio' })
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('another tenant’s app_ key → no_audio (nothing is signed)', async () => {
    ROW.current = { ...ROW.current, audio_storage_path: `app_other-biz_${TAKE}.mp4` }
    expect(await mint()).toEqual({ error: 'no_audio' })
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  // FIX ROUND 1 — defence in depth. The card already refuses to show a player
  // for this row; the door must refuse to sign for it too, from the SAME
  // predicate, so the two can never disagree.
  it('a RESERVED-but-not-secured row (UPLOADING, no duration) → no_audio, nothing signed, no row', async () => {
    ROW.current = { ...ROW.current, status: 'UPLOADING', duration_seconds: null }
    const lines = await auditLines(async () => {
      expect(await mint()).toEqual({ error: 'no_audio' })
    })
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(lines.filter((l) => l.action === 'recording.play')).toHaveLength(0)
  })

  it('finalize’s own stamp (UPLOADING + a duration) mints', async () => {
    ROW.current = { ...ROW.current, status: 'UPLOADING', duration_seconds: 45 }
    expect('url' in (await mint())).toBe(true)
  })

  it('a job-owned COMPLETED row with no duration mints (the legacy worker path)', async () => {
    ROW.current = { ...ROW.current, status: 'COMPLETED', duration_seconds: null }
    expect('url' in (await mint())).toBe(true)
  })

  it('a RECORDING row → no_audio — a live recorder owns it', async () => {
    ROW.current = { ...ROW.current, status: 'RECORDING', duration_seconds: null }
    expect(await mint()).toEqual({ error: 'no_audio' })
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('a 404 recording row → no_audio (a swept session), never not_found', async () => {
    KAR.current = { ...KAR.current, recording_session_id: 'sess-gone' }
    expect(await mint()).toEqual({ error: 'no_audio' })
  })

  it('a 404 karute → not_found', async () => {
    karuteGet.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    expect(await mint()).toEqual({ error: 'not_found' })
  })

  // "We could not look" is never folded into "there is no audio".
  it('a non-404 karute failure → upstream', async () => {
    karuteGet.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    expect(await mint()).toEqual({ error: 'upstream' })
  })

  it('a non-404 recording failure → upstream', async () => {
    recordingsGet.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    expect(await mint()).toEqual({ error: 'upstream' })
  })

  it('a storage refusal → upstream', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await mint()).toEqual({ error: 'upstream' })
    warn.mockRestore()
  })

  it('signs the row’s OWN key for the ruled TTL', async () => {
    await mint()
    expect(createSignedUrl).toHaveBeenCalledWith(TAKE_KEY, PLAYBACK_URL_TTL_S)
    expect(PLAYBACK_URL_TTL_S).toBe(3600)
  })
})

describe('mintPlaybackUrlWithClient — ONE row per mint (claim 3)', () => {
  const plays = (lines: Record<string, unknown>[]) => lines.filter((l) => l.action === 'recording.play')

  it('a successful mint writes exactly ONE recording.play row, severity notice', async () => {
    const lines = await auditLines(async () => {
      expect('url' in (await mint())).toBe(true)
    })
    expect(plays(lines)).toHaveLength(1)
    expect(plays(lines)[0]).toMatchObject({
      category: 'recording',
      actor_id: 'auth-user-1',
      actor_type: 'staff',
      business_id: 'business-1',
      target_type: 'recording',
      target_id: SESSION,
      store_id: 'store-9',
      severity: 'notice',
      break_glass: false,
      source: 'web',
      detail: { karute_id: KARUTE_ID, ttl_s: 3600 },
    })
  })

  it('breakGlass is true only for a NON-recorder', async () => {
    const lines = await auditLines(() => mint({ staffId: 'the-owner', canHearAll: true }))
    expect(plays(lines)[0].break_glass).toBe(true)
  })

  it('an ownerless record is not break-glass — there is nobody to cross', async () => {
    KAR.current = { ...KAR.current, staff_id: null }
    const lines = await auditLines(() => mint({ staffId: 'anyone' }))
    expect(plays(lines)[0].break_glass).toBe(false)
  })

  it.each([
    ['forbidden', async () => { await mint({ staffId: 'someone-else' }) }],
    ['no_audio', async () => { ROW.current = { ...ROW.current, audio_storage_path: null }; await mint() }],
    ['not_found', async () => { karuteGet.mockRejectedValue(Object.assign(new Error('x'), { status: 404 })); await mint() }],
    ['upstream', async () => { recordingsGet.mockRejectedValue(new Error('x')); await mint() }],
  ])('a %s refusal writes ZERO audit rows', async (_name, run) => {
    const lines = await auditLines(run)
    expect(plays(lines)).toHaveLength(0)
  })

  it('is registered where the proof suite looks: taxonomy, facade map, audited cores', () => {
    expect(AUDIT_ACTIONS).toContain('recording.play')
    expect(FACADE_AUDIT_MAP['recordings.playbackUrl']).toEqual({
      kind: 'skip',
      category: 'recording',
      action: '',
      coveredBy: 'src/lib/recording/playback-url.ts#mintPlaybackUrlWithClient',
    })
    expect(AUDITED_CORES).toContainEqual({
      file: 'src/lib/recording/playback-url.ts',
      symbols: ['mintPlaybackUrlWithClient'],
    })
  })
})

describe('GET /api/app/v1/recordings/playback-url — the door', () => {
  it('mints and parses the DTO at the door', async () => {
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      url: expect.stringContaining(TAKE_KEY),
      expiresAt: expect.any(String),
      durationSeconds: 742,
    })
  })

  it('403 without customers.view — gated before any read', async () => {
    capabilities.current = new Set([])
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(403)
    expect(karuteGet).not.toHaveBeenCalled()
  })

  it('400 with no karuteId', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(400)
  })

  it('404 for a missing karute; 404 + reason no_audio when the sound is what is missing', async () => {
    expect((await GET(req('kar-nope'), route)).status).toBe(404)
    ROW.current = { ...ROW.current, audio_storage_path: null }
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatchObject({ reason: 'no_audio' })
  })

  it('403 when the take is someone else’s', async () => {
    KAR.current = { ...KAR.current, staff_id: 'someone-else' }
    expect((await GET(req(KARUTE_ID), route)).status).toBe(403)
  })

  it('502 on an upstream failure — never a false 404', async () => {
    recordingsGet.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    expect((await GET(req(KARUTE_ID), route)).status).toBe(502)
  })

  // A roster read that FAILED cannot answer "who is asking" — guessing null
  // would refuse a recorder her own take.
  it('502 when the roster read fails, not a silent refusal', async () => {
    rosterThrows.current = true
    expect((await GET(req(KARUTE_ID), route)).status).toBe(502)
  })

  it('a caller who is NOT on this roster compares as nobody → 403', async () => {
    roster.current = []
    expect((await GET(req(KARUTE_ID), route)).status).toBe(403)
  })

  it('OPTIONS preflight short-circuits before auth', async () => {
    const res = await OPTIONS(
      new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }),
      route,
    )
    expect(res.status).toBe(204)
    expect(karuteGet).not.toHaveBeenCalled()
  })
})

describe('mintRecordingPlaybackUrl — the web door', () => {
  it('returns the ok union with the url', async () => {
    expect(await mintRecordingPlaybackUrl(KARUTE_ID)).toEqual({
      ok: true,
      url: expect.stringContaining(TAKE_KEY),
      expiresAt: expect.any(String),
      durationSeconds: 742,
    })
  })

  it('forbidden without customers.view, and it never throws', async () => {
    webCaps.current = new Set([])
    expect(await mintRecordingPlaybackUrl(KARUTE_ID)).toEqual({ ok: false, error: 'forbidden' })
  })

  it('carries the body’s refusal verbatim', async () => {
    ROW.current = { ...ROW.current, audio_storage_path: null }
    expect(await mintRecordingPlaybackUrl(KARUTE_ID)).toEqual({ ok: false, error: 'no_audio' })
  })

  it('an unexpected throw becomes upstream, never an unhandled rejection', async () => {
    karuteGet.mockImplementation(() => {
      throw new Error('sync boom')
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await mintRecordingPlaybackUrl(KARUTE_ID)).toEqual({ ok: false, error: 'upstream' })
    warn.mockRestore()
  })
})
