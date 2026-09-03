/**
 * The finalize choke point (src/lib/recording/finalize-take.ts) — the ONE body
 * both doors run. What only this file can prove:
 *   1. the tenant fence: a key is COMPOSED server-side from the caller's own
 *      business, so no client input reaches storage or core unfenced;
 *   2. the object must actually exist, at the claimed size, before any core
 *      write — a finalize can never point a row at audio that is not there;
 *   3. ownership: own session yes, colleague's no, owner (recordings.viewAll)
 *      yes, another tenant's never;
 *   4. it never regresses a terminal status, and a repeat writes nothing and
 *      files no second audit row.
 */
const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

const info = jest.fn(
  async (
    _key: string,
  ): Promise<{ data: { size?: number } | null; error: { message: string } | null }> => ({
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
// A second, DIFFERENT take of the same tenant — the row's pointer before a
// re-finalize replaces it.
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
const row = (over: Partial<Row> = {}): Row => ({
  id: SESSION,
  business_id: BIZ,
  staff_id: 'staff-1',
  status: 'RECORDING',
  audio_storage_path: null,
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
  storeId: 'store-1',
  canViewAll: false,
  source: 'web',
  ...over,
})
const input = { takeId: TAKE, mimeType: 'audio/webm', durationSeconds: 42.7, byteLength: 1024 }
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
  it('writes the pointer, the floored duration and UPLOADING on the existing row', async () => {
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
    expect(info).toHaveBeenCalledWith(KEY)
    expect(update).toHaveBeenCalledWith(SESSION, {
      audio_storage_path: KEY,
      duration_seconds: 42,
      status: 'UPLOADING',
    })
    // PROCESSING belongs to enqueue, never to finalize.
    expect(create).not.toHaveBeenCalled()
  })

  it('mints the row with the actor’s staff + store when the take carries no session', async () => {
    const res = await finalizeTakeWithClient(synqed, actor(), input)
    expect(res).toEqual({ ok: true, recordingSessionId: 'sess-new' })
    expect(create).toHaveBeenCalledWith({
      staff_id: 'staff-1',
      store_id: 'store-1',
      customer_id: null,
      audio_storage_path: KEY,
      duration_seconds: 42,
      status: 'UPLOADING',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('files ONE audit row of ids, numbers and flags — no key, no path, no PII', async () => {
    await finalizeTakeWithClient(synqed, actor(), { ...input, recordingSessionId: SESSION })
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
      minted_row: false,
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
    await finalizeTakeWithClient(synqed, actor(), { ...input, recordingSessionId: SESSION })
    const [event] = auditFn.mock.calls[0] as [{ detail: Record<string, unknown> }]
    expect(event.detail.size_verified).toBe(false)
    expect(update).toHaveBeenCalled()
  })
})

describe('finalizeTakeWithClient — the object must be there, at the size claimed', () => {
  it('refuses when storage has no such object — zero core writes, zero audit rows', async () => {
    info.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ error: 'object_missing' })
    expect(get).not.toHaveBeenCalled()
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

  it('refuses with no staff identity — nothing is attributable', async () => {
    const res = await finalizeTakeWithClient(synqed, actor({ staffId: null }), input)
    expect(res).toEqual({ error: 'forbidden' })
    expect(info).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('refuses a session row belonging to another business', async () => {
    get.mockResolvedValue(row({ business_id: 'biz-2' }))
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ error: 'forbidden' })
    expectNoWrites()
  })

  it('refuses another staffer’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ error: 'forbidden' })
    expectNoWrites()
  })

  it('allows an owner (recordings.viewAll) to finalize a colleague’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    const res = await finalizeTakeWithClient(synqed, actor({ canViewAll: true }), {
      ...input,
      recordingSessionId: SESSION,
    })
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
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ error: 'failed' })
    expectNoWrites()
  })
})

describe('finalizeTakeWithClient — idempotency and the terminal statuses', () => {
  it('a second finalize with the same key writes nothing and files no second row', async () => {
    get.mockResolvedValue(row({ audio_storage_path: KEY, status: 'UPLOADING' }))
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION, already: true })
    expectNoWrites()
  })

  it.each(['COMPLETED', 'FAILED'])(
    '%s with a pointer already on it is left completely alone',
    async (status) => {
      get.mockResolvedValue(row({ status, audio_storage_path: 'app_biz-1_older.webm' }))
      const res = await finalizeTakeWithClient(synqed, actor(), {
        ...input,
        recordingSessionId: SESSION,
      })
      expect(res).toEqual({ ok: true, recordingSessionId: SESSION, already: true })
      expectNoWrites()
    },
  )

  it.each(['COMPLETED', 'FAILED'])(
    '%s with a NULL pointer gets the pointer only — status and duration untouched',
    async (status) => {
      get.mockResolvedValue(row({ status }))
      const res = await finalizeTakeWithClient(synqed, actor(), {
        ...input,
        recordingSessionId: SESSION,
      })
      expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
      expect(update).toHaveBeenCalledWith(SESSION, { audio_storage_path: KEY })
      expect(auditFn).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['RECORDING', 'UPLOADING'])(
    '%s takes the full write — the take is still ours to state',
    async (status) => {
      get.mockResolvedValue(row({ status }))
      await finalizeTakeWithClient(synqed, actor(), { ...input, recordingSessionId: SESSION })
      expect(update).toHaveBeenCalledWith(SESSION, {
        audio_storage_path: KEY,
        duration_seconds: 42,
        status: 'UPLOADING',
      })
    },
  )
})

// Fix round 2, B3. Three PROCESSING cases, one per pointer state — the middle
// one used to fall into the full write and put a live take back into 要対応.
describe('finalizeTakeWithClient — a job is PROCESSING the row', () => {
  it('a differing pointer is busy — retryable, zero writes, zero audit rows', async () => {
    get.mockResolvedValue(row({ status: 'PROCESSING', audio_storage_path: OLD_KEY }))
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ error: 'busy' })
    expectNoWrites()
  })

  it('a NULL pointer gets the POINTER ONLY — the running job keeps status and duration', async () => {
    get.mockResolvedValue(row({ status: 'PROCESSING' }))
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
    expect(update).toHaveBeenCalledWith(SESSION, { audio_storage_path: KEY })
    // UPLOADING over PROCESSING is the regression this branch exists to stop.
    expect(update).not.toHaveBeenCalledWith(SESSION, expect.objectContaining({ status: 'UPLOADING' }))
    expect(auditFn).toHaveBeenCalledTimes(1)
    const [event] = auditFn.mock.calls[0] as [{ detail: Record<string, unknown> }]
    expect(event.detail).toMatchObject({ minted_row: false, take_id: TAKE })
  })

  it('the same pointer is just already:true — unchanged', async () => {
    get.mockResolvedValue(row({ status: 'PROCESSING', audio_storage_path: KEY }))
    const res = await finalizeTakeWithClient(synqed, actor(), {
      ...input,
      recordingSessionId: SESSION,
    })
    expect(res).toEqual({ ok: true, recordingSessionId: SESSION, already: true })
    expectNoWrites()
  })
})

describe('finalizeTakeWithClient — the evidence chain survives a pointer replacement', () => {
  it('a re-finalize with a different take on a non-terminal row carries both ids', async () => {
    get.mockResolvedValue(row({ status: 'UPLOADING', audio_storage_path: OLD_KEY }))
    await finalizeTakeWithClient(synqed, actor(), { ...input, recordingSessionId: SESSION })
    const [event] = auditFn.mock.calls[0] as [{ detail: Record<string, unknown> }]
    expect(event.detail).toMatchObject({ take_id: TAKE, replaced_take_id: OLD_TAKE })
  })
})
