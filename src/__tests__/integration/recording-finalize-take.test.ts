/**
 * The finalize choke point (src/lib/recording/finalize-take.ts) — the ONE body
 * both doors run. What only this file can prove:
 *   1. the tenant fence: a key is COMPOSED server-side from the caller's own
 *      business, so no client input reaches storage or core unfenced;
 *   2. THE RESERVATION (fix round 4): finalize accepts a key only from the row
 *      the MINT bound it to — a colleague's audio can never be attached to a
 *      row of the caller's own, and no row is ever minted here;
 *   3. the object must actually exist, at the claimed size, before any core
 *      write — a finalize can never claim audio that is not there;
 *   4. ownership: own session yes, colleague's no, owner (recordings.viewAll)
 *      yes, another tenant's never;
 *   5. it never regresses a terminal status, and a repeat writes nothing and
 *      files no second audit row.
 */
const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

const info = jest.fn(
  async (
    _key: string,
    // `status` matters: storage saying "no such object" and storage failing to
    // ANSWER are different facts, and only the first settles a take.
  ): Promise<{ data: { size?: number } | null; error: { message: string; status?: number } | null }> => ({
    data: { size: 1024 },
    error: null,
  }),
)
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ info }) } }),
}))

import { finalizeTakeWithClient, type FinalizeTakeActor } from '@/lib/recording/finalize-take'
import { TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const KEY = `app_${BIZ}_${TAKE}.webm`
// The session row's id. A real uuid because the schema now demands one — it
// rides into a core URL path unencoded, so a free string there is a forgery
// surface (fix round 2, B2).
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
/** A well-formed session id core does not know. */
const GHOST = '00000000-0000-4000-8000-000000000000'
// A second, DIFFERENT take of the same tenant — what a row that moved on holds.
const OLD_TAKE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const OLD_KEY = `app_${BIZ}_${OLD_TAKE}.webm`

type Row = {
  id: string
  business_id: string
  staff_id: string
  status: string
  audio_storage_path: string | null
  duration_seconds: number | null
}
/** The state the MINT leaves behind: this take's key reserved, UPLOADING, and
 *  no duration yet — the one thing finalize is here to add. */
const row = (over: Partial<Row> = {}): Row => ({
  id: SESSION,
  business_id: BIZ,
  staff_id: 'staff-1',
  status: 'UPLOADING',
  audio_storage_path: KEY,
  duration_seconds: null,
  ...over,
})

const get = jest.fn(async (_id: string): Promise<Row> => row())
const create = jest.fn(async (_input: unknown): Promise<Row> => row({ id: 'sess-new' }))
const update = jest.fn(async (id: string, _input: unknown): Promise<Row> => row({ id }))
const synqed = { recordings: { get, create, update } } as never

const actor = (over: Partial<FinalizeTakeActor> = {}): FinalizeTakeActor => ({
  staffId: 'staff-1',
  businessId: BIZ,
  canViewAll: false,
  source: 'web',
  ...over,
})
const input = {
  takeId: TAKE,
  mimeType: 'audio/webm',
  durationSeconds: 42.7,
  byteLength: 1024,
  recordingSessionId: SESSION,
}
const notFound = Object.assign(new Error('nope'), { status: 404 })

/** Nothing was written and nothing was claimed — the assertion every refusal owes. */
function expectNoWrites(): void {
  expect(create).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  expect(auditFn).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  info.mockResolvedValue({ data: { size: 1024 }, error: null })
  get.mockResolvedValue(row())
  create.mockResolvedValue(row({ id: 'sess-new' }))
  update.mockImplementation(async (id: string) => row({ id }))
})

describe('finalizeTakeWithClient — the happy path', () => {
  it('writes the floored duration and UPLOADING on the row that reserved the key', async () => {
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
    expect(info).toHaveBeenCalledWith(KEY)
    // The POINTER is NOT rewritten: the mint wrote it, and this call proved it
    // is this exact key. Finalize adds only what the mint could not know.
    expect(update).toHaveBeenCalledWith(SESSION, {
      duration_seconds: 42,
      status: 'UPLOADING',
    })
    // PROCESSING belongs to enqueue, never to finalize.
    expect(create).not.toHaveBeenCalled()
  })

  it('NEVER mints a row — one place binds takes, and it is the mint', async () => {
    await finalizeTakeWithClient(synqed, actor(), input)
    expect(create).not.toHaveBeenCalled()
  })

  it('files ONE audit row of ids, numbers and flags — no key, no path, no PII', async () => {
    await finalizeTakeWithClient(synqed, actor(), input)
    expect(auditFn).toHaveBeenCalledTimes(1)
    const [event] = auditFn.mock.calls[0] as [Record<string, unknown>]
    expect(event).toMatchObject({
      category: 'recording',
      action: 'recording.capture_finalized',
      actorId: 'staff-1',
      businessId: BIZ,
      targetType: 'recording',
      targetId: SESSION,
      severity: 'notice',
      source: 'web',
    })
    expect(event.detail).toEqual({
      recording_session_id: SESSION,
      take_id: TAKE,
      bytes: 1024,
      duration_seconds: 42,
      ext: 'webm',
      size_verified: true,
    })
    // ⚖ 8/17: the detail carries no free text at all.
    expect(JSON.stringify(event.detail)).not.toContain(KEY)
  })

  it('records that the size was NOT verified when the listing carried none', async () => {
    info.mockResolvedValue({ data: {}, error: null })
    await finalizeTakeWithClient(synqed, actor(), input)
    const [event] = auditFn.mock.calls[0] as [{ detail: Record<string, unknown> }]
    expect(event.detail.size_verified).toBe(false)
    expect(update).toHaveBeenCalled()
  })
})

// FIX ROUND 4 — THE RESERVATION IS THE FENCE. The mint binds a take's key to
// one row before any byte exists; finalize accepts that key from that row and
// from nowhere else. Without this, a same-tenant staffer who learned a take
// uuid and its byte length could attach a colleague's audio to a row of their
// own — the P2 this round closes.
describe('finalizeTakeWithClient — only the row that RESERVED the key may finalize it', () => {
  it('refuses a row whose pointer is still null — not_reserved, zero writes', async () => {
    get.mockResolvedValue(row({ audio_storage_path: null, status: 'RECORDING' }))
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'not_reserved' })
    expectNoWrites()
  })

  it('refuses a row reserved for a DIFFERENT take — not_reserved, zero writes', async () => {
    get.mockResolvedValue(row({ audio_storage_path: OLD_KEY }))
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'not_reserved' })
    expectNoWrites()
  })

  it('refuses BEFORE it asks storage anything — an unbound caller learns nothing', async () => {
    get.mockResolvedValue(row({ audio_storage_path: null }))
    await finalizeTakeWithClient(synqed, actor(), input)
    expect(info).not.toHaveBeenCalled()
  })

  it.each(['PROCESSING', 'COMPLETED', 'FAILED'])(
    'a %s row that moved on to other audio is superseded — never a silent ok',
    async (status) => {
      get.mockResolvedValue(row({ status, audio_storage_path: OLD_KEY, duration_seconds: 30 }))
      const res = await finalizeTakeWithClient(synqed, actor(), input)
      expect(res).toEqual({ error: 'superseded' })
      expect(update).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      // …and the object we were handed is now unreferenced, so the row that
      // says so is the ONLY thread back to it. Fix round 6 (I2): its OWN
      // action — nothing was saved here, so it must never file under
      // capture_finalized ("audio saved").
      expect(auditFn).toHaveBeenCalledTimes(1)
      const [event] = auditFn.mock.calls[0] as [Record<string, unknown>]
      expect(event).toMatchObject({
        action: 'recording.capture_unlinked',
        severity: 'notice',
      })
      expect(event.detail).toEqual({
        recording_session_id: SESSION,
        take_id: TAKE,
        row_take_id: OLD_TAKE,
        bytes: 1024,
        ext: 'webm',
      })
    },
  )

  // FIX ROUND 7 (J4). capture_unlinked used to be filed BEFORE the object was
  // ever looked up, and its detail is the CLIENT's take id and byte count — so
  // any caller who guessed a superseded row's id could write an audit row about
  // audio that does not exist. The byte check comes first now: a superseded row
  // answers object_missing / size_mismatch like any other take, and files
  // nothing.
  it('a superseded row whose object is NOT THERE — object_missing, and no unlinked row', async () => {
    get.mockResolvedValue(row({ status: 'PROCESSING', audio_storage_path: OLD_KEY, duration_seconds: 30 }))
    info.mockResolvedValue({ data: null, error: { message: 'Object not found', status: 404 } })
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'object_missing' })
    expectNoWrites()
  })

  it('a superseded row whose object is the WRONG SIZE — size_mismatch, and no unlinked row', async () => {
    get.mockResolvedValue(row({ status: 'PROCESSING', audio_storage_path: OLD_KEY, duration_seconds: 30 }))
    info.mockResolvedValue({ data: { size: 999 }, error: null })
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'size_mismatch' })
    expectNoWrites()
  })

  it('a superseded row storage cannot answer for — failed, and no unlinked row', async () => {
    get.mockResolvedValue(row({ status: 'PROCESSING', audio_storage_path: OLD_KEY, duration_seconds: 30 }))
    info.mockResolvedValue({ data: null, error: { message: 'boom', status: 500 } })
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'failed' })
    expectNoWrites()
  })
})

// Fix round 2, B1: the shared body parses FIRST, so the WEB door — a server
// action whose argument is caller-supplied JSON however it is typed — gets the
// same refusals the facade's zod gives. Nothing reaches storage or core.
describe('finalizeTakeWithClient — the schema is the web door’s parse', () => {
  it.each([
    ['a negative duration', { durationSeconds: -1 }],
    ['a NaN duration', { durationSeconds: Number.NaN }],
    ['an absurd duration', { durationSeconds: 1e12 }],
    ['a zero-byte take', { byteLength: 0 }],
    ['a fractional byte length', { byteLength: 10.5 }],
    ['a non-uuid session id', { recordingSessionId: 'sess-1' }],
    // Fix round 4: the session id is REQUIRED — a take this server never bound
    // has no row to finalize against.
    ['a MISSING session id', { recordingSessionId: undefined }],
    ['a null session id', { recordingSessionId: null }],
    ['a storage path smuggled in (strict)', { audioPath: `app_${BIZ}_x.webm` }],
  ])('refuses %s — bad_input, zero core calls', async (_label, over) => {
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      ...over,
    } as never)
    expect(res).toEqual({ error: 'bad_input' })
    expect(info).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expectNoWrites()
  })
})

describe('finalizeTakeWithClient — the object must be there, at the size claimed', () => {
  it('refuses when storage has no such object — zero core writes, zero audit rows', async () => {
    info.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'object_missing' })
    expectNoWrites()
  })

  it('refuses on an exact byte mismatch', async () => {
    info.mockResolvedValue({ data: { size: 999 }, error: null })
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'size_mismatch' })
    expectNoWrites()
  })

  // Fix round 2, B5: storage answering "no" and storage not answering at all
  // are different facts. Only the first may settle the take.
  it.each([
    ['a 404 status', { message: 'nope', status: 404 }],
    ['a not-found message', { message: 'Object not found' }],
  ])('%s is a genuine miss — object_missing, the drain retries', async (_label, error) => {
    info.mockResolvedValue({ data: null, error })
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'object_missing' })
    expectNoWrites()
  })

  it.each([
    ['a storage 500', { message: 'internal error', status: 500 }],
    ['an unrecognizable failure', { message: 'boom' }],
  ])('%s is UNKNOWN, never a miss — failed, and nothing is written', async (_label, error) => {
    info.mockResolvedValue({ data: null, error })
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'failed' })
    expectNoWrites()
  })
})

describe('finalizeTakeWithClient — the fences', () => {
  it.each([
    ['a traversal take id', '../../x'],
    ['an uppercase uuid', TAKE.toUpperCase()],
    ['a nested key attempt', `${TAKE}/000000`],
    ['a non-uuid body', 'stolen'],
  ])('refuses %s before storage is touched', async (_label, takeId) => {
    const res = await finalizeTakeWithClient(synqed, actor(), { ...input, takeId })
    expect(res).toEqual({ error: 'bad_input' })
    expect(info).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('refuses a container outside the closed map', async () => {
    const res = await finalizeTakeWithClient(synqed, actor(), { ...input, mimeType: 'audio/aac' })
    expect(res).toEqual({ error: 'bad_input' })
    expect(info).not.toHaveBeenCalled()
    expectNoWrites()
  })

  // FIX ROUND 7 (J1). The closed MIME map used to be read with `in`, which
  // walks the prototype chain: each name below is an Object.prototype member,
  // so the map said "yes, a container we store" and composeTakeKey read a
  // FUNCTION as the key's extension. The composed key then failed its own
  // grammar and THREW — a 500 out of this door, from a request body. Null
  // prototype + Object.hasOwn, and the compose now sits inside the try, so
  // even a genuine drift is a settled answer.
  // `constructor` and `__proto__` are the two that BITE: normalizeAudioMime
  // lowercases before the lookup, so `toString`/`hasOwnProperty` miss the
  // prototype by their capitals and are refused by the closed set either way.
  // They are in the table anyway — the fence must not depend on casing luck.
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'refuses the prototype key %s as a container — bad_input, never a throw',
    async (mimeType) => {
      const res = await finalizeTakeWithClient(synqed, actor(), { ...input, mimeType })
      expect(res).toEqual({ error: 'bad_input' })
      expect(info).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
      expectNoWrites()
    },
  )

  it('refuses with no staff identity — nothing is attributable', async () => {
    const res = await finalizeTakeWithClient(synqed, actor({ staffId: null }), input)
    expect(res).toEqual({ error: 'forbidden' })
    expect(info).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('refuses a session row belonging to another business', async () => {
    get.mockResolvedValue(row({ business_id: 'biz-2' }))
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'forbidden' })
    expectNoWrites()
  })

  it('refuses another staffer’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'forbidden' })
    expectNoWrites()
  })

  it('allows an owner (recordings.viewAll) to finalize a colleague’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    const res = await finalizeTakeWithClient(synqed, actor({ canViewAll: true }), input)
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
    expect(update).toHaveBeenCalled()
  })

  it('refuses a session id core does not know — never mints a replacement', async () => {
    get.mockRejectedValue(notFound)
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: GHOST,
    })
    expect(res).toEqual({ error: 'not_found' })
    expectNoWrites()
  })

  it('an unreadable session row fails rather than minting a second one', async () => {
    get.mockRejectedValue(Object.assign(new Error('core down'), { status: 503 }))
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ error: 'failed' })
    expectNoWrites()
  })
})

describe('finalizeTakeWithClient — idempotency and the terminal statuses', () => {
  it('a second finalize of a finalized take writes nothing and files no second row', async () => {
    get.mockResolvedValue(row({ duration_seconds: 42, status: 'UPLOADING' }))
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION, already: true })
    expectNoWrites()
  })

  it.each(['COMPLETED', 'FAILED'])(
    'a %s take of this same key is left completely alone',
    async (status) => {
      get.mockResolvedValue(row({ status, duration_seconds: 55 }))
      const res = await finalizeTakeWithClient(synqed, actor(), input)
      expect(res).toEqual({ ok: true, recordingSessionId: SESSION, already: true })
      expectNoWrites()
    },
  )

  it.each(['PROCESSING', 'COMPLETED', 'FAILED'])(
    '%s with NO duration yet gets the duration only — status untouched',
    async (status) => {
      get.mockResolvedValue(row({ status }))
      const res = await finalizeTakeWithClient(synqed, actor(), input)
      expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
      expect(update).toHaveBeenCalledWith(SESSION, { duration_seconds: 42 })
      // UPLOADING over PROCESSING is the regression this branch exists to stop.
      expect(update).not.toHaveBeenCalledWith(SESSION, expect.objectContaining({ status: 'UPLOADING' }))
      expect(auditFn).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['RECORDING', 'UPLOADING'])(
    '%s takes the full write — the take is still ours to state',
    async (status) => {
      get.mockResolvedValue(row({ status }))
      await finalizeTakeWithClient(synqed, actor(), input)
      expect(update).toHaveBeenCalledWith(SESSION, {
        duration_seconds: 42,
        status: 'UPLOADING',
      })
    },
  )

  // A RECORDING row with a duration is NOT "finalized before": the recorder is
  // still running, and only a status it has left behind settles the take.
  it('a RECORDING row carrying a duration still takes the write', async () => {
    get.mockResolvedValue(row({ status: 'RECORDING', duration_seconds: 10 }))
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
    expect(update).toHaveBeenCalledWith(SESSION, { duration_seconds: 42, status: 'UPLOADING' })
  })
})
