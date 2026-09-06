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
/** The web door's TWO identities, deliberately different by default so a test
 *  that confuses them cannot pass: `resolveUserId()` is WHO is asking (the
 *  audit row's actor), `getCurrentUserStaffId()` is the roster-proven id the
 *  ACL compares. See N2 below. */
const webAuthUserId = { current: 'auth-user-1' }
const webStaffId = { current: 'auth-user-1' as string | null }
/** Makes `can()` THROW rather than answer — a transient auth/DB blip, which is
 *  not a permission answer (D-8). See N3 below. */
const canThrows = { current: false }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => webStaffId.current),
  resolveUserId: jest.fn(async () => webAuthUserId.current),
  staffListByBusinessOrThrow: jest.fn(async () => {
    if (rosterThrows.current) throw new Error('roster read failed')
    return roster.current
  }),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
  can: jest.fn(async (cap: string) => {
    if (canThrows.current) throw new Error('capability read failed')
    return webCaps.current.has(cap)
  }),
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
/** The object probe (fix round 2) — the shared `objectExists` spelling reads
 *  `storage.from(...).info(key)`. Default: the take is really there. */
const info = jest.fn(async (_key: string) => ({
  data: { size: 1024 } as { size?: number } | null,
  error: null as { message: string; status?: number; statusCode?: string } | null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ createSignedUrl, info }) } }),
}))

const KARUTE_ID = '00000000-0000-4000-8000-000000000008'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const TAKE = '11111111-1111-4111-8111-111111111111'
const TAKE_KEY = `app_business-1_${TAKE}.mp4`

// ⚠ THE PRODUCTION SHAPE (fix round 4, restated at slice three ③). The KARUTE
// always carries the store (resolveKaruteStoreId, actions/karute.ts, stamps it
// on every save). The RECORDING ROW carries one only since ③ — the mint stamps
// the actor's active store (session-mint.ts:199) and `UpdateRecordingInput`
// still has no such field, so every row minted BEFORE ③ is null for ever. Both
// shapes are production now, and the pins below cover both: the karute's store
// leads either way.
const KAR = {
  current: {
    id: KARUTE_ID,
    staff_id: 'auth-user-1',
    store_id: 'store-9' as string | null,
    recording_session_id: SESSION,
  } as Record<string, unknown>,
}
const ROW = {
  current: {
    id: SESSION,
    store_id: null as string | null,
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
/** The FACADE's store-assignment read (resolveStoreForRequest → staffStores.get).
 *  Default [] = floating staff, which resolves to "unrestricted within the
 *  tenant" — so every pre-existing case is untouched. */
const staffStoresGet = jest.fn(async (_id: string) => ({ store_ids: [] as string[] }))
const fakeClient = {
  karuteRecords: { get: (id: string) => karuteGet(id) },
  recordings: { get: (id: string) => recordingsGet(id) },
  staffStores: { get: (id: string) => staffStoresGet(id) },
  stores: { get: jest.fn(async () => ({ id: 'store-9' })) },
}
/** The WEB door's store primitive. Default: unrestricted, not degraded. */
const webScope = {
  current: {
    storeId: null as string | null,
    viewAll: true,
    allowedStoreIds: null as string[] | null,
    degraded: false,
  },
}
const webScopeThrows = { current: false }
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => {
    if (webScopeThrows.current) throw new Error('store scope read failed')
    return webScope.current
  }),
}))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { GET, OPTIONS } from '@/app/api/app/v1/recordings/playback-url/route'
import { mintRecordingPlaybackUrl } from '@/actions/recording-playback'
import { mintPlaybackUrlWithClient, PLAYBACK_URL_TTL_S } from '@/lib/recording/playback-url'
import { serverHoldsTakeRow } from '@/lib/recording/take-binding'
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
    { actorId: 'auth-user-1', staffId: 'auth-user-1', businessId: 'business-1', canViewAll: false, allowedStoreIds: null, source: 'web', ...actor },
    { karuteId: KARUTE_ID },
  )

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  webCaps.current = new Set(['customers.view'])
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  webScope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
  webScopeThrows.current = false
  webAuthUserId.current = 'auth-user-1'
  webStaffId.current = 'auth-user-1'
  canThrows.current = false
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  rosterThrows.current = false
  cardLookup.current = null
  KAR.current = { id: KARUTE_ID, staff_id: 'auth-user-1', store_id: 'store-9', recording_session_id: SESSION }
  ROW.current = { id: SESSION, store_id: null, audio_storage_path: TAKE_KEY, duration_seconds: 742, status: 'COMPLETED' }
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: `https://proj.supabase.co/read/${TAKE_KEY}?token=t` },
    error: null,
  })
  info.mockResolvedValue({ data: { size: 1024 }, error: null })
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

  it('another staffer without recordings.viewAll is FORBIDDEN', async () => {
    const r = await mint({ staffId: 'someone-else' })
    expect(r).toEqual({ error: 'forbidden' })
  })

  it('recordings.viewAll — the whole owner floor — hears a colleague’s take', async () => {
    const r = await mint({ staffId: 'someone-else', canViewAll: true })
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

  // ⚠ RE-WORDED (fix round 2): this pins THE FENCE — a staged key is refused —
  // and makes no claim about where discarded audio lives. The ORDINARY discard
  // keeps the row on its TAKE key (recording-discard-transcript.ts says so
  // plainly); the stg/ shape is the unsecurable-take exception. What is true
  // either way is that a staged key never reaches the signer.
  it('a stg/ staged key is refused by the fence → no_audio', async () => {
    ROW.current = { ...ROW.current, audio_storage_path: `stg/business-1_${SESSION}_${TAKE}.mp4` }
    expect(await mint()).toEqual({ error: 'no_audio' })
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('another tenant’s app_ key is refused by the fence → no_audio, nothing signed', async () => {
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

  // ⚠ FIX ROUND 2 — THE CEILING THE PROBE CLOSES. `discard.ts` stamps the
  // CLIENT-REPORTED duration on a reasoned discard with no object proof, and
  // the ordinary discard leaves the row on its TAKE key. Such a row passes
  // serverHoldsTakeRow — so the row is a heuristic and storage is the only
  // honest fact about whether the bytes exist.
  it('a discard-stamped row whose object is GONE → no_audio, nothing signed, no audit row', async () => {
    ROW.current = { ...ROW.current, status: 'UPLOADING', duration_seconds: 47 }
    // The helper still says yes — that is the point of the probe.
    expect(serverHoldsTakeRow(ROW.current, 'business-1')).toBe(true)
    info.mockResolvedValue({ data: null, error: { message: 'Object not found', status: 404 } })
    const lines = await auditLines(async () => {
      expect(await mint()).toEqual({ error: 'no_audio' })
    })
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(lines.filter((l) => l.action === 'recording.play')).toHaveLength(0)
  })

  // ⚠ TITLE = WHAT THIS BODY CHECKS (fix round 5, delta lens NEW-3). It used to
  // say "after the ACL" too, which its assertions cannot fail on — it passes
  // unchanged against the pre-round-3 file where the probe ran first. The ACL
  // half is carried by its sibling below ('a caller the ACL refuses never
  // probes storage at all'), which DOES red when the order is wrong.
  it('the probe runs on the row’s OWN key, before anything is signed', async () => {
    await mint()
    expect(info).toHaveBeenCalledWith(TAKE_KEY)
    expect(info.mock.invocationCallOrder[0]).toBeLessThan(
      createSignedUrl.mock.invocationCallOrder[0],
    )
  })

  // ⚠ FIX ROUND 3 — the probe used to run BEFORE the ACL. That made the bucket
  // pay for every refused attempt, and let a same-tenant staffer who may NOT
  // hear a colleague's take still tell "the bytes are there" (forbidden) from
  // "they are gone" (no_audio): new information about someone else's audio,
  // handed out before the permission question was asked.
  it('a caller the ACL refuses never probes storage at all', async () => {
    const r = await mint({ staffId: 'someone-else' })
    expect(r).toEqual({ error: 'forbidden' })
    expect(info).not.toHaveBeenCalled()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('an authorized listen probes exactly ONCE', async () => {
    await mint()
    expect(info).toHaveBeenCalledTimes(1)
  })

  // Wrapped like session-cleanup.ts's twin of this probe: a THROW is this
  // door's own 502, never an escape to the handler's 500.
  it('a THROWN probe → upstream, never a 500 and never a false no_audio', async () => {
    info.mockRejectedValue(new Error('storage exploded'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await mint()).toEqual({ error: 'upstream' })
    expect(createSignedUrl).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // A probe that could not ANSWER is not a miss. Saying "no audio" when storage
  // merely blipped is the one wrong thing to say here.
  it('a storage probe that cannot answer → upstream, never no_audio', async () => {
    info.mockResolvedValue({ data: null, error: { message: 'Internal error', status: 500 } })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await mint()).toEqual({ error: 'upstream' })
    expect(createSignedUrl).not.toHaveBeenCalled()
    warn.mockRestore()
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

describe('mintPlaybackUrlWithClient — ONE row per mint (claim 4)', () => {
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
      // The KARUTE's store, under the production shape (karute store-9, row
      // null) — fix round 4b. Keyed on the row's empty column this line carried
      // no store at all, and the audit viewer filters by store.
      store_id: 'store-9',
      severity: 'notice',
      break_glass: false,
      source: 'web',
      detail: { karute_id: KARUTE_ID, ttl_s: 3600 },
    })
  })

  it('breakGlass is true only for a NON-recorder', async () => {
    const lines = await auditLines(() => mint({ staffId: 'the-owner', canViewAll: true }))
    expect(plays(lines)[0].break_glass).toBe(true)
  })

  it('an ownerless record is not break-glass — there is nobody to cross', async () => {
    KAR.current = { ...KAR.current, staff_id: null }
    const lines = await auditLines(() => mint({ staffId: 'anyone' }))
    expect(plays(lines)[0].break_glass).toBe(false)
  })

  // FIX ROUND 2 — a caller who is not on this roster has a null staffId, and an
  // OWNERLESS karute (D-14) says yes to them. The row used to be
  // actorType:'staff' with actorId:null — an unattributable listen.
  it('a roster-less caller on an ownerless karute still files an ATTRIBUTED row', async () => {
    KAR.current = { ...KAR.current, staff_id: null }
    const lines = await auditLines(() => mint({ actorId: 'auth-user-9', staffId: null }))
    expect(plays(lines)[0].actor_id).toBe('auth-user-9')
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

  // ⚠ N2 — the round-2 actorId/staffId split lives in the CALLERS, and neither
  // was pinned: both doors could be reverted to `actorId: staffId ?? 'unknown'`
  // with 9,742 tests green. An audit row naming a placeholder for a listen is a
  // legal-hygiene failure that fails silently, which is the worst kind.
  //
  // A caller who is NOT on this roster has staffId null, and an OWNERLESS
  // karute (D-14) says yes to them — so this is the case where the two ids
  // genuinely differ and the row can only be right one way.
  it('the row names the AUTH USER, not the roster id — facade door', async () => {
    roster.current = []
    KAR.current = { ...KAR.current, staff_id: null }
    const lines = await auditLines(async () => {
      expect((await GET(req(KARUTE_ID), route)).status).toBe(200)
    })
    const play = lines.filter((l) => l.action === 'recording.play')
    expect(play).toHaveLength(1)
    // `bearer()`'s sub. Reverting to staffId would make this null.
    expect(play[0].actor_id).toBe('auth-user-1')
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

  // ⚠ N2, web half. `resolveUserId()` is the actor; `getCurrentUserStaffId()` is
  // the ACL id. Given DIFFERENT values here, only one wiring can pass.
  it('the row names resolveUserId’s value, not the roster id — web door', async () => {
    webAuthUserId.current = 'auth-user-77'
    webStaffId.current = 'roster-staff-9'
    KAR.current = { ...KAR.current, staff_id: null } // ownerless → the ACL says yes
    const lines = await auditLines(async () => {
      expect((await mintRecordingPlaybackUrl(KARUTE_ID)).ok).toBe(true)
    })
    const play = lines.filter((l) => l.action === 'recording.play')
    expect(play).toHaveLength(1)
    expect(play[0].actor_id).toBe('auth-user-77')
  })

  // ⚠ N3 — a capability read that THREW is not a permission answer (D-8). The
  // existing 'unexpected throw' case drives the OUTER catch; this one drives the
  // gate's own. The file's comment states the rule; nothing checked it.
  it('a capability read that THREW is upstream, never forbidden', async () => {
    canThrows.current = true
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await mintRecordingPlaybackUrl(KARUTE_ID)).toEqual({ ok: false, error: 'upstream' })
    warn.mockRestore()
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

// ── ⚖ STORE REACH — the grant widens WHOSE recordings, never WHICH stores ────
// Liam's store-isolation law 8/17; Greptile #848 point 2. `KAR.current.store_id`
// is 'store-9' — the karute's own store, the ONLY store either door can read —
// and the karute belongs to a colleague ('other-staff'), so every case below
// rides the viewAll branch, the only branch this narrows.
describe('the named grant hears only inside the viewer’s own stores', () => {
  beforeEach(() => {
    KAR.current = { ...KAR.current, staff_id: 'other-staff' }
  })

  // ── the body, one door, the whole matrix ──────────────────────────────────
  it('unrestricted scope (stores.viewAll / floating) hears a colleague’s take in any store', async () => {
    const r = await mint({ staffId: 'someone-else', canViewAll: true, allowedStoreIds: null })
    expect('url' in r).toBe(true)
  })

  it('a grantee assigned to the record’s own store hears it', async () => {
    const r = await mint({ staffId: 'someone-else', canViewAll: true, allowedStoreIds: ['store-9'] })
    expect('url' in r).toBe(true)
  })

  it('…and a grantee assigned ELSEWHERE gets `forbidden` — the same withholding as no grant', async () => {
    const r = await mint({ staffId: 'someone-else', canViewAll: true, allowedStoreIds: ['store-a'] })
    expect(r).toEqual({ error: 'forbidden' })
  })

  it('a record with NO store — karute AND row both null — is heard by a clamped grantee (全店舗 / legacy)', async () => {
    KAR.current = { ...KAR.current, store_id: null }
    ROW.current = { ...ROW.current, store_id: null }
    const r = await mint({ staffId: 'someone-else', canViewAll: true, allowedStoreIds: ['store-a'] })
    expect('url' in r).toBe(true)
  })

  // ⚠ THE PIN THAT DIES IF THE CLAMP GOES BACK TO THE ROW (fix round 4, F1).
  // This is every take minted BEFORE slice three ③: the karute names the store,
  // the recording row's column is empty, and it can never be filled. Clamping
  // on the row read that empty column as 全店舗 and handed a store-a grantee a
  // store-9 colleague's audio — the words door was shut on the same karute the
  // whole time. The pin stands unchanged: the karute's store decides.
  it('a PRE-③ row carries no store_id; the clamp reads the KARUTE’s store: grantee in store-a, karute store-9, row null → forbidden', async () => {
    KAR.current = { ...KAR.current, store_id: 'store-9' }
    ROW.current = { ...ROW.current, store_id: null }
    const r = await mint({ staffId: 'someone-else', canViewAll: true, allowedStoreIds: ['store-a'] })
    expect(r).toEqual({ error: 'forbidden' })
  })

  it('…and the row’s own store is honoured when the karute has none — LIVE since ③, not a hypothetical (karute null, row store-9)', async () => {
    KAR.current = { ...KAR.current, store_id: null }
    ROW.current = { ...ROW.current, store_id: 'store-9' }
    const r = await mint({ staffId: 'someone-else', canViewAll: true, allowedStoreIds: ['store-a'] })
    expect(r).toEqual({ error: 'forbidden' })
  })

  it('a DEGRADED scope ([]) fails closed', async () => {
    const r = await mint({ staffId: 'someone-else', canViewAll: true, allowedStoreIds: [] })
    expect(r).toEqual({ error: 'forbidden' })
  })

  it('the RECORDER is untouched by any of it — her own take, a foreign scope', async () => {
    KAR.current = { ...KAR.current, staff_id: 'auth-user-1' }
    const r = await mint({ staffId: 'auth-user-1', canViewAll: false, allowedStoreIds: [] })
    expect('url' in r).toBe(true)
  })

  // ── the FACADE transport resolves that scope for itself ───────────────────
  it('facade: a grantee assigned to store-a is refused a store-9 take → 403', async () => {
    capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(403)
  })

  it('facade: the same grantee assigned to store-9 hears it → 200', async () => {
    capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
    staffStoresGet.mockResolvedValue({ store_ids: ['store-9'] })
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(200)
  })

  it('facade: stores.viewAll never consults an assignment at all', async () => {
    capabilities.current = new Set(['customers.view', 'recordings.viewAll', 'stores.viewAll'])
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(200)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  // ⚖ AN UNPLACEABLE CALLER IS NOT FLOATING STAFF (fix round 4, blind round 2
  // F3). Core answers `{ store_ids: [] }` for an id it holds no rows for, which
  // the floating branch reads as "works in every store" — so before the
  // selfStaffId guard the phone door heard every store for a caller the roster
  // could not place, while the web door already failed closed on it.
  it('facade: a caller the ROSTER CANNOT PLACE fails the grant closed → 403', async () => {
    capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
    roster.current = []
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(403)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it('facade: an UNREADABLE assignment fails the grant closed → 403, never widened', async () => {
    capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
    staffStoresGet.mockRejectedValue(new Error('core down'))
    const res = await GET(req(KARUTE_ID), route)
    expect(res.status).toBe(403)
  })

  // ── the WEB transport resolves it through resolveStoreScope ───────────────
  it('web: a grantee assigned to store-a is refused a store-9 take', async () => {
    webCaps.current = new Set(['customers.view', 'recordings.viewAll'])
    webStaffId.current = 'someone-else'
    webScope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    await expect(mintRecordingPlaybackUrl(KARUTE_ID)).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it('web: the same grantee assigned to store-9 hears it', async () => {
    webCaps.current = new Set(['customers.view', 'recordings.viewAll'])
    webStaffId.current = 'someone-else'
    webScope.current = { storeId: 'store-9', viewAll: false, allowedStoreIds: ['store-9'], degraded: false }
    const r = await mintRecordingPlaybackUrl(KARUTE_ID)
    expect(r.ok).toBe(true)
  })

  it('web: a DEGRADED scope fails the grant closed', async () => {
    webCaps.current = new Set(['customers.view', 'recordings.viewAll'])
    webStaffId.current = 'someone-else'
    webScope.current = { storeId: null, viewAll: false, allowedStoreIds: null, degraded: true }
    await expect(mintRecordingPlaybackUrl(KARUTE_ID)).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it('web: a THROWN scope read fails the grant closed too', async () => {
    webCaps.current = new Set(['customers.view', 'recordings.viewAll'])
    webStaffId.current = 'someone-else'
    webScopeThrows.current = true
    await expect(mintRecordingPlaybackUrl(KARUTE_ID)).resolves.toEqual({ ok: false, error: 'forbidden' })
  })
})

// ── ⚖ THE PLAY AUDIT ROW CARRIES THE KARUTE'S STORE (fix round 4b) ──────────
// Same column the ACL reads, same order. A play row keyed on the RECORDING row
// alone was invisible to every store-scoped audit search, because before slice
// three ③ that column was empty for every take in the field. The `??` chain
// puts the karute's store first and falls back to the row's — null on a pre-③
// row, the minted store since ③ — and a karute with no store and a row with
// none still carries nothing, because there is nothing to stamp.
describe('recording.play — the audit row’s store', () => {
  it('a karute with NO store and a row with none → the line carries no store', async () => {
    KAR.current = { ...KAR.current, store_id: null }
    ROW.current = { ...ROW.current, store_id: null }
    const lines = await auditLines(() => mint())
    const play = lines.find((l) => l.action === 'recording.play')
    expect(play).toBeDefined()
    expect(play?.store_id ?? null).toBeNull()
  })

  it('…and the row’s own store is used when the karute has none — LIVE since ③', async () => {
    KAR.current = { ...KAR.current, store_id: null }
    ROW.current = { ...ROW.current, store_id: 'store-row' }
    const lines = await auditLines(() => mint())
    expect(lines.find((l) => l.action === 'recording.play')?.store_id).toBe('store-row')
  })
})
