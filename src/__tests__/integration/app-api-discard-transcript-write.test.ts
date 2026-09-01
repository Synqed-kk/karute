// Facade: PHONEWIRE-2C — the WRITE half of 破棄の記録's transcript, the phone
// arm of the two A2-2 persist actions. Pins, in the order they matter:
//
//   · the gate is 'records.write' (the RECORDER's capability, NOT the GET's
//     manager 'staff.manage'), checked BEFORE any core read — plus the ROSTER
//     membership half a capability set cannot carry (#566 parity), which stops
//     the create-on-miss resolver minting a phantom staff record;
//   · every tenant decision traces to ctx.identity.businessId: the body cannot
//     even carry a tenant field (`.strict()` on both union members), the client
//     is built from the token, and a staged key prefixed for ANOTHER business
//     is a 403 that never touches storage;
//   · ⛔ the mutation proof this whole build hangs on: the phone door creates
//     NO recordingJobs row and NO karute record. The fake core client records
//     every namespace at PROPERTY-ACCESS time and declares only the six the
//     mechanism uses, so even a swallowed fire-and-forget to an undeclared
//     namespace lands in the ledger rather than surfacing a discarded take as a
//     real カルテ (doctrine R2);
//   · the staged path's runTranscription call is pinned as a WHOLE object —
//     voice reference, speaker mode, diarization and business type included;
//   · alreadyLanded makes a second call a no-op that writes nothing — the
//     server-derived dedupe that stands in for an Idempotency-Key;
//   · both relay shapes run the SAME shared bodies the web actions run, and the
//     answer comes back verbatim so the phone and the web page read one
//     contract;
//   · no audit row from either shape (the FACADE_AUDIT_MAP 'skip').
import { createHmac } from 'node:crypto'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
// @synqed-kk/client is ESM; audit()'s durable sink lazy-imports it — mock at the
// seam, same as the sibling discards suite.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

const mockCapabilities = jest.fn(async () => new Set(['records.write']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})
/** The ROSTER, steerable: `resolveSelfStaffId` is the Bearer twin of
 *  getCurrentUserStaffId, so an identity absent from this list is exactly the
 *  non-roster caller the #566 gate exists to stop before the create-on-miss
 *  resolver can mint a phantom staff record for it. */
let roster: { id: string }[] = [{ id: 'auth-user-1' }]
const staffListByBusinessOrThrow = jest.fn(async () => roster)
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...(a as [])),
}))
const resolveSynqedStaffIdForBusiness = jest.fn(async (id: string) => `card-${id}`)
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: (...a: unknown[]) =>
    resolveSynqedStaffIdForBusiness(...(a as [string])),
}))

/** THE spend counter, same idiom as the web suite: a gate that transcribed
 *  first and refused afterwards would pass a return-value-only test while
 *  burning the money the ⚖ consent/floor gates exist to protect. */
const mockRunTranscription = jest.fn(async () => ({ transcript: '本日はありがとうございます' }))
const mockLoadReference = jest.fn(async (): Promise<unknown> => null)
/** Steerable, because 'off' short-circuits the voice reference to null and a
 *  suite pinned only at 'off' can never see the reference leg at all. */
let speakerMode = 'off'
jest.mock('@/lib/ai/transcribe', () => ({
  runTranscription: (...a: unknown[]) => mockRunTranscription(...(a as [])),
  speakerIdMode: () => speakerMode,
  loadStaffReferenceForStaff: (...a: unknown[]) => mockLoadReference(...(a as [])),
}))

const createSignedUrl = jest.fn(async () => ({
  data: { signedUrl: 'https://storage/signed' },
  error: null,
}))
const removeObject = jest.fn(async () => ({ data: null, error: null }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: (...a: unknown[]) => createSignedUrl(...(a as [])),
        remove: (...a: unknown[]) => removeObject(...(a as [])),
      }),
    },
  }),
}))

// ── the core client, as a FULL-SURFACE LEDGER ───────────────────────────────
/**
 * TWO ledgers, and the outer one is the load-bearing half.
 *
 * `namespaceTouches` records at PROPERTY-ACCESS time, on the client itself —
 * `synqed.recordingJobs` registers the moment it is read, before any call is
 * made, awaited or swallowed. That is what makes the ⛔ proof immune to a
 * fire-and-forget: `void synqed.recordingJobs?.enqueue(x).catch(() => {})`
 * leaves a line here even though nothing in the request path ever sees it fail.
 * An earlier version of this fake declared recordingJobs/karuteRecords as empty
 * namespaces and only watched METHOD calls, which guarded exactly the two
 * namespaces someone had thought of — an undeclared third shipped invisible.
 * Now NOTHING is declared but the six the mechanism genuinely uses, and every
 * other access is both recorded and fatal.
 *
 * `touched` keeps the method-level detail, so the assertions can pin the exact
 * mechanism (`recordings.upsertSegments`, never a queue) and not merely its
 * neighbourhood.
 */
const namespaceTouches: string[] = []
const touched: string[] = []
type Impl = Record<string, (...args: never[]) => unknown>
function ledger(namespace: string, impl: Impl): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        // `then`/symbol probes (jest, await) must not register as core calls.
        if (typeof prop !== 'string' || prop === 'then') return undefined
        return (...args: never[]) => {
          touched.push(`${namespace}.${prop}`)
          const fn = impl[prop]
          if (!fn) throw new Error(`unexpected core call: ${namespace}.${prop}`)
          return fn(...args)
        }
      },
    },
  )
}
/** Wrap the whole client so an UNDECLARED namespace is recorded and then
 *  refused — the get trap runs before `?.`, `void` or a `.catch()` can hide it. */
function fullSurface(declared: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(declared, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined
      namespaceTouches.push(prop)
      if (!(prop in target)) throw new Error(`undeclared core namespace: ${prop}`)
      return target[prop]
    },
  })
}

let segments: { segment_index: number; text: string }[] = []
let discardRows: { recording_session_id: string; reason: string }[] = []
/** The org row the transcription options are derived from — steerable so the
 *  diarize/businessType legs of the call are pinned against real values, not
 *  only against the empty-settings defaults. */
let orgSettings: { settings: Record<string, unknown> } = { settings: {} }
let consentByCustomer: Record<string, { policy_version: string } | null> = {}
let recordingRow: { customer_id: string | null } | null = { customer_id: 'cust-1' }
type SegmentRow = { segment_index: number; text: string; start_time: number; end_time: number }
const upsertSegments = jest.fn(async (id: string, rows: SegmentRow[], opts: { replace: boolean }) => {
  void id
  void opts
  segments = rows
})

const fakeClient = fullSurface({
  recordings: ledger('recordings', {
    get: async () => recordingRow,
    listSegments: async () => ({ segments }),
    upsertSegments: (id: string, rows: SegmentRow[], opts: { replace: boolean }) =>
      upsertSegments(id, rows, opts),
  }),
  recordingDiscards: ledger('recordingDiscards', {
    list: async () => ({ events: discardRows }),
  }),
  customers: ledger('customers', {
    getConsent: async (id: string) => ({ consent: consentByCustomer[id] ?? null }),
  }),
  orgSettings: ledger('orgSettings', { get: async () => orgSettings }),
  // recordingJobs / karuteRecords are DELIBERATELY ABSENT — undeclared, so an
  // access to either is recorded by the outer trap and then throws.
})
const newSynqedClient = jest.fn((businessId: string) => {
  void businessId
  return fakeClient
})
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { POST } from '@/app/api/app/v1/recordings/discards/transcript/route'
import { auditLines } from './helpers/audit-lines'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: 'auth-user-1',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
  })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }
const noParams = { params: Promise.resolve({}) }

const OWN_PATH = 'app_business-1_11111111-2222-3333-4444-555555555555.webm'
const FOREIGN_PATH = 'app_business-2_11111111-2222-3333-4444-555555555555.webm'
const REVIEW_BODY = { recordingSessionId: 'rs-1', transcript: '在庫の話をしました', durationSeconds: 62 }
const STAGED_BODY = {
  recordingSessionId: 'rs-1',
  audioPath: OWN_PATH,
  durationSeconds: 62,
  locale: 'ja',
}

const post = (body: unknown, headers: Record<string, string> = { ...auth }) =>
  POST(
    new Request('https://s/api/app/v1/recordings/discards/transcript', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    noParams,
  )

/** The SIX namespaces this family's mechanism is allowed to reach. Anything
 *  else — a job queue, a karute writer, something nobody has thought of yet —
 *  shows up as an extra member, recorded at access time. */
const ALLOWED_NAMESPACES = ['recordings', 'recordingDiscards', 'customers', 'orgSettings']
/** Namespaces reached that the mechanism has no business touching. The ⛔
 *  doctrine line, machine-checked, and blind to NOTHING: this reads the
 *  access-time ledger, so a swallowed fire-and-forget still lands here. */
const forbiddenNamespaces = () =>
  [...new Set(namespaceTouches)].filter((n) => !ALLOWED_NAMESPACES.includes(n))

beforeEach(() => {
  jest.clearAllMocks()
  touched.length = 0
  namespaceTouches.length = 0
  segments = []
  speakerMode = 'off'
  roster = [{ id: 'auth-user-1' }]
  orgSettings = { settings: {} }
  mockLoadReference.mockResolvedValue(null)
  mockRunTranscription.mockResolvedValue({ transcript: '本日はありがとうございます' })
  discardRows = [{ recording_session_id: 'rs-1', reason: 'テスト' }]
  consentByCustomer = { 'cust-1': { policy_version: RECORDING_CONSENT_POLICY_VERSION } }
  recordingRow = { customer_id: 'cust-1' }
  mockCapabilities.mockResolvedValue(new Set(['records.write']))
})

describe('POST /api/app/v1/recordings/discards/transcript — the gate', () => {
  it('missing Bearer → 401, zero core reads', async () => {
    const res = await POST(
      new Request('https://s/api/app/v1/recordings/discards/transcript', {
        method: 'POST',
        body: JSON.stringify(REVIEW_BODY),
      }),
      noParams,
    )
    expect(res.status).toBe(401)
    expect(touched).toEqual([])
  })

  it('no records.write → 403, zero core reads, zero audit lines', async () => {
    // staff.manage is the READ side's gate and must not open this door: a
    // manager who cannot record has no take of their own to write words for.
    mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
    const lines = await auditLines(async () => {
      expect((await post(REVIEW_BODY)).status).toBe(403)
    })
    expect(touched).toEqual([])
    expect(lines).toHaveLength(0)
  })

  it("constructs the synqed client scoped to the Bearer identity's businessId", async () => {
    expect((await post(REVIEW_BODY)).status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('another business’s staged key → 403; nothing is signed, read or deleted', async () => {
    const res = await post({ ...STAGED_BODY, audioPath: FOREIGN_PATH })
    expect(res.status).toBe(403)
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(removeObject).not.toHaveBeenCalled()
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  it('a body matching NEITHER strict shape → 400, nothing read', async () => {
    // Both discriminators at once: `.strict()` on both members means this
    // matches neither, so the door refuses rather than silently picking one.
    const res = await post({ ...REVIEW_BODY, audioPath: OWN_PATH, locale: 'ja' })
    expect(res.status).toBe(400)
    expect(touched).toEqual([])
  })

  it('a non-JSON body → 400, nothing read', async () => {
    const res = await POST(
      new Request('https://s/api/app/v1/recordings/discards/transcript', {
        method: 'POST',
        headers: { ...auth },
        body: 'not json',
      }),
      noParams,
    )
    expect(res.status).toBe(400)
    expect(touched).toEqual([])
  })
})

describe('POST … — the ROSTER gate (#566 parity)', () => {
  // A capability set is not roster membership. On web the acting id comes from
  // getCurrentUserStaffId, which IS a membership probe, and the action refuses
  // when it answers null; the Bearer identity carries no such proof.
  it('a records.write holder who is NOT on the roster is refused before the resolver', async () => {
    roster = [{ id: 'someone-else' }]
    const res = await post(STAGED_BODY)
    expect(res.status).toBe(502)
    // THE POINT: the create-on-miss resolver never runs, so no phantom synqed
    // staff record is minted for a profile that is not on this roster.
    expect(resolveSynqedStaffIdForBusiness).not.toHaveBeenCalled()
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  it('tags the facade_error log line so it is not read as a core outage', async () => {
    // The 502 is deliberate (below), but on the structured stream it then looked
    // exactly like synqed-core failing: logFacadeError writes code + status and
    // never the message. `reason` is the repo's existing label convention, and
    // it is what lets an alert tell a removed staffer from an upstream incident.
    roster = []
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect((await post(STAGED_BODY)).status).toBe(502)
      const lines = warn.mock.calls
        .map(([first]) => (typeof first === 'string' ? first : ''))
        .filter((l) => l.includes('"evt":"facade_error"'))
        .map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({
        evt: 'facade_error',
        endpoint: 'recordings.discards.transcript.write',
        code: 'upstream_unavailable',
        status: 502,
        reason: 'not_on_roster',
      })
    } finally {
      warn.mockRestore()
    }
  })

  it('an error carrying no reason logs no reason key at all', async () => {
    // The extension must be invisible to every other error: JSON.stringify drops
    // an undefined value, so an untagged failure's line is byte-identical to
    // what it was before. Proven on the capability refusal beside it.
    mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect((await post(REVIEW_BODY)).status).toBe(403)
      const line = warn.mock.calls
        .map(([first]) => (typeof first === 'string' ? first : ''))
        .find((l) => l.includes('"evt":"facade_error"'))
      expect(line).toBeDefined()
      expect(line).not.toContain('reason')
      expect(Object.keys(JSON.parse(line!) as object)).not.toContain('reason')
    } finally {
      warn.mockRestore()
    }
  })

  it('…and NOT as a 403, because the phone would delete the take on one', async () => {
    // staffListByBusinessOrThrow THROWS on a failed read, so a null here is the
    // web docstring's ambiguous case (a real removal, or a probe that could not
    // answer). The web sends that doubt to `failed`, never `forbidden`: wrong
    // forbidden deletes the take and the words are gone forever. 403 is the one
    // status the thin port reads as terminal — this must not be it.
    roster = []
    expect((await post(STAGED_BODY)).status).not.toBe(403)
  })

  it('the review shape is gated too — both doors agree on who may write', async () => {
    // Web parity: recordsWriteGate's null-identity refusal covers BOTH actions,
    // so gating only the resolver's caller would leave the doors disagreeing.
    roster = []
    expect((await post(REVIEW_BODY)).status).toBe(502)
    expect(upsertSegments).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  it('the roster is read for the Bearer identity’s OWN business', async () => {
    await post(REVIEW_BODY)
    expect(staffListByBusinessOrThrow).toHaveBeenCalledWith('business-1')
  })
})

describe('POST … — tenant scope comes from the token, never the body', () => {
  // The door's `.strict()` union is the first half of this: a body cannot even
  // CARRY a tenant field, let alone have one honoured.
  it('an unknown extra field on the review shape → 400, nothing read', async () => {
    const res = await post({ ...REVIEW_BODY, businessId: 'business-2' })
    expect(res.status).toBe(400)
    expect(touched).toEqual([])
    expect(newSynqedClient).not.toHaveBeenCalled()
  })

  it('an unknown extra field on the staged shape → 400, nothing read', async () => {
    const res = await post({ ...STAGED_BODY, businessId: 'business-2', storeId: 's-9' })
    expect(res.status).toBe(400)
    expect(touched).toEqual([])
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('the client and the staged-key fence are driven ONLY by ctx.identity.businessId', async () => {
    // Second half: even on the happy path, every tenant decision traces to the
    // verified token. The client is constructed once, with the identity's id;
    // the fence accepts a key prefixed for THAT business and 403s one prefixed
    // for any other — so a caller cannot reach another tenant's audio whatever
    // it sends.
    expect((await post(STAGED_BODY)).status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledTimes(1)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(newSynqedClient.mock.calls.map(([id]) => id)).toEqual(['business-1'])

    jest.clearAllMocks()
    segments = []
    expect((await post({ ...STAGED_BODY, audioPath: FOREIGN_PATH })).status).toBe(403)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})

describe('POST … — the review shape (words already in hand)', () => {
  it('writes ONE segment carrying the whole text, spends nothing', async () => {
    const res = await post(REVIEW_BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(upsertSegments).toHaveBeenCalledWith(
      'rs-1',
      [{ segment_index: 0, text: '在庫の話をしました', start_time: 0, end_time: 62 }],
      { replace: true },
    )
    // Nothing staged, nothing transcribed, nothing deleted: the review origin's
    // whole point is that the words are free.
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(forbiddenNamespaces()).toEqual([])
  })

  it('no reasoned discard on that session → not_discarded, nothing written', async () => {
    discardRows = []
    expect(await (await post(REVIEW_BODY)).json()).toEqual({ error: 'not_discarded' })
    expect(upsertSegments).not.toHaveBeenCalled()
  })

  it('a stale consent version → skipped, nothing written', async () => {
    consentByCustomer = { 'cust-1': { policy_version: 'v1-2026-01' } }
    expect(await (await post(REVIEW_BODY)).json()).toEqual({ skipped: 'consent' })
    expect(upsertSegments).not.toHaveBeenCalled()
  })

  it('a walk-in take (no customer on the session row) → skipped, fail closed', async () => {
    recordingRow = { customer_id: null }
    expect(await (await post(REVIEW_BODY)).json()).toEqual({ skipped: 'consent' })
    expect(upsertSegments).not.toHaveBeenCalled()
  })
})

describe('POST … — the staged shape (nothing transcribed yet)', () => {
  it('transcribes the staged object, writes the words, then drops the audio', async () => {
    const res = await post(STAGED_BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // The FULL argument object, never objectContaining: this call is the whole
    // reason the staged door costs money, and objectContaining cannot see a
    // LEG THAT VANISHED. Every field is a decision the worker also makes.
    expect(mockRunTranscription).toHaveBeenCalledWith({
      audio: { url: 'https://storage/signed' },
      locale: 'ja',
      diarize: true,
      reference: null,
      mode: 'off',
      businessType: null,
    })
    expect(upsertSegments).toHaveBeenCalledWith(
      'rs-1',
      [{ segment_index: 0, text: '本日はありがとうございます', start_time: 0, end_time: 62 }],
      { replace: true },
    )
    // Read-then-delete, the worker's posture.
    expect(removeObject).toHaveBeenCalledWith([OWN_PATH])
    expect(forbiddenNamespaces()).toEqual([])
  })

  it('carries the DISCARDING staffer’s own voice reference, resolved per tenant', async () => {
    // With speaker id ON the reference leg is live, and it is the leg an
    // objectContaining({audio, locale}) assertion could never have missed
    // vanishing. #401: the reference is the recorder's OWN enrollment clip.
    speakerMode = 'enforce'
    orgSettings = { settings: { speaker_diarization: false, business_type: 'salon' } }
    const reference = { staffId: 'card-auth-user-1', clipUrl: 'https://storage/ref' }
    mockLoadReference.mockResolvedValue(reference)

    expect((await post(STAGED_BODY)).status).toBe(200)

    // Resolved through the TENANT-EXPLICIT twin, with the Bearer identity's own
    // business — never a cookie, never a body field.
    expect(resolveSynqedStaffIdForBusiness).toHaveBeenCalledWith('auth-user-1', 'business-1')
    expect(mockLoadReference).toHaveBeenCalledWith(
      { speaker_diarization: false, business_type: 'salon' },
      'card-auth-user-1',
    )
    expect(mockRunTranscription).toHaveBeenCalledWith({
      audio: { url: 'https://storage/signed' },
      locale: 'ja',
      // org said false, so this is a real value carried through — not a default
      // that would look identical if the leg were dropped.
      diarize: false,
      reference,
      mode: 'enforce',
      businessType: 'salon',
    })
  })

  it('a refusal past the tenant fence still drops the staged object', async () => {
    consentByCustomer = {}
    expect(await (await post(STAGED_BODY)).json()).toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(removeObject).toHaveBeenCalledWith([OWN_PATH])
  })

  it('silence is answered honestly — nothing written for an empty transcript', async () => {
    mockRunTranscription.mockResolvedValueOnce({ transcript: '   ' })
    expect(await (await post(STAGED_BODY)).json()).toEqual({ skipped: 'empty' })
    expect(upsertSegments).not.toHaveBeenCalled()
  })
})

describe('POST … — write-once, and the ⛔ doctrine line', () => {
  it('a second call after the words landed is a no-op that spends nothing', async () => {
    expect(await (await post(STAGED_BODY)).json()).toEqual({ ok: true })
    expect(mockRunTranscription).toHaveBeenCalledTimes(1)
    upsertSegments.mockClear()
    mockRunTranscription.mockClear()

    // Same call again: alreadyLanded is the server-derived dedupe standing in
    // for an Idempotency-Key, and it sits AHEAD of the consent re-answer.
    expect(await (await post(STAGED_BODY)).json()).toEqual({ ok: true })
    expect(upsertSegments).not.toHaveBeenCalled()
    expect(mockRunTranscription).not.toHaveBeenCalled()
    // …and the staged object still goes: the janitor runs on every exit past
    // the fence, or the next sweep would orphan another copy.
    expect(removeObject).toHaveBeenCalledWith([OWN_PATH])
  })

  it('⛔ NEITHER shape reaches ANY namespace outside the mechanism', async () => {
    await post(REVIEW_BODY)
    segments = []
    await post(STAGED_BODY)
    // The access-time ledger, spelled out. Not a denylist of the two namespaces
    // someone thought of — an EXACT set, so a job queue, a karute writer, or
    // something nobody has named yet all show up the same way, and show up even
    // if the call that reached for them was fire-and-forget and swallowed.
    expect(new Set(namespaceTouches)).toEqual(new Set(ALLOWED_NAMESPACES))
    // …and the method-level ledger, so the mechanism itself is pinned and not
    // merely its neighbourhood: upsertSegments is the writer, nothing else is.
    expect(new Set(touched)).toEqual(
      new Set([
        'recordingDiscards.list',
        'recordings.listSegments',
        'recordings.get',
        'customers.getConsent',
        'recordings.upsertSegments',
        'orgSettings.get',
      ]),
    )
  })

  it('neither shape writes an audit row (the FACADE_AUDIT_MAP skip)', async () => {
    const lines = await auditLines(async () => {
      await post(REVIEW_BODY)
      segments = []
      await post(STAGED_BODY)
    })
    expect(lines).toHaveLength(0)
  })
})
