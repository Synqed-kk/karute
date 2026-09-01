// Facade: PHONEWIRE-2C — the WRITE half of 破棄の記録's transcript, the phone
// arm of the two A2-2 persist actions. Pins, in the order they matter:
//
//   · the gate is 'records.write' (the RECORDER's capability, NOT the GET's
//     manager 'staff.manage'), checked BEFORE any core read;
//   · the client is scoped to the Bearer identity's businessId, and a staged
//     key belonging to ANOTHER business is a 403 that never touches storage;
//   · ⛔ the mutation proof this whole build hangs on: the phone door creates
//     NO recordingJobs row and NO karute record. The fake core client records
//     EVERY namespace.method it is asked for, so a future edit that reached for
//     the job queue fails here rather than surfacing a discarded take as a real
//     カルテ (doctrine R2);
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
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: jest.fn(async (id: string) => `card-${id}`),
}))

/** THE spend counter, same idiom as the web suite: a gate that transcribed
 *  first and refused afterwards would pass a return-value-only test while
 *  burning the money the ⚖ consent/floor gates exist to protect. */
const mockRunTranscription = jest.fn(async () => ({ transcript: '本日はありがとうございます' }))
const mockLoadReference = jest.fn(async () => null)
jest.mock('@/lib/ai/transcribe', () => ({
  runTranscription: (...a: unknown[]) => mockRunTranscription(...(a as [])),
  speakerIdMode: () => 'off',
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

// ── the core client, as a LEDGER ────────────────────────────────────────────
/** Every namespace.method the shared bodies ask this client for, in order. An
 *  unimplemented one THROWS (so an accidental new core call cannot pass
 *  silently) after recording itself (so the assertion below names it). This is
 *  what makes "no recordingJobs row, no karute draft" a proof rather than a
 *  claim: the two namespaces exist on the fake and are simply never reachable
 *  without leaving a line here. */
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

let segments: { segment_index: number; text: string }[] = []
let discardRows: { recording_session_id: string; reason: string }[] = []
let consentByCustomer: Record<string, { policy_version: string } | null> = {}
let recordingRow: { customer_id: string | null } | null = { customer_id: 'cust-1' }
type SegmentRow = { segment_index: number; text: string; start_time: number; end_time: number }
const upsertSegments = jest.fn(async (id: string, rows: SegmentRow[], opts: { replace: boolean }) => {
  void id
  void opts
  segments = rows
})

const fakeClient = {
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
  orgSettings: ledger('orgSettings', { get: async () => ({ settings: {} }) }),
  // Present and deliberately EMPTY — reaching either is both recorded and fatal.
  recordingJobs: ledger('recordingJobs', {}),
  karuteRecords: ledger('karuteRecords', {}),
}
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

/** Every core call that is NOT part of this family's documented mechanism. The
 *  ⛔ doctrine line, machine-checked. */
const forbiddenTouches = () =>
  touched.filter((t) => t.startsWith('recordingJobs.') || t.startsWith('karuteRecords.'))

beforeEach(() => {
  jest.clearAllMocks()
  touched.length = 0
  segments = []
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
    expect(forbiddenTouches()).toEqual([])
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
    expect(mockRunTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ audio: { url: 'https://storage/signed' }, locale: 'ja' }),
    )
    expect(upsertSegments).toHaveBeenCalledWith(
      'rs-1',
      [{ segment_index: 0, text: '本日はありがとうございます', start_time: 0, end_time: 62 }],
      { replace: true },
    )
    // Read-then-delete, the worker's posture.
    expect(removeObject).toHaveBeenCalledWith([OWN_PATH])
    expect(forbiddenTouches()).toEqual([])
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

  it('⛔ NEITHER shape creates a recordingJobs row or a karute record', async () => {
    await post(REVIEW_BODY)
    segments = []
    await post(STAGED_BODY)
    expect(forbiddenTouches()).toEqual([])
    // The whole ledger, spelled out: the mechanism is upsertSegments and
    // nothing else. A future edit that reached for the queue — the one thing
    // that would surface a discarded take as a real カルテ — changes this list.
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
