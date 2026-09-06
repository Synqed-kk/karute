/**
 * SAVE FROM WHAT THE SERVER HAS — the shared body (build 23 slice ③).
 *
 * The one claim that makes this door safe: `audio_path` is DERIVED from the
 * recording row and can never come from a caller. Everything else is the
 * ownership rule the take doors already keep, said once more where a colleague's
 * audio could otherwise be queued into this caller's karute.
 */
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))

const objectExists = jest.fn(async (_key: string): Promise<boolean | 'unknown'> => true)
jest.mock('@/lib/recording/mint-take-url', () => ({
  objectExists: (key: string) => objectExists(key),
}))

import {
  enqueueFromSessionWithClient,
  type EnqueueFromSessionInput,
} from '@/lib/recording/enqueue-from-session'
import { conformingKey, segmentKey, TAKE_UUID_FIXTURE } from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const OWN_KEY = conformingKey(BIZ)

type Row = {
  id: string
  business_id: string
  staff_id: string
  audio_storage_path: string | null
  duration_seconds: number | null
  status: string
}
/** The PRODUCTION shape of a row this door is meant to act on: born reserved,
 *  finalized (duration + a status the recorder left behind), no job yet. */
const row = (over: Partial<Row> = {}): Row => ({
  id: 'sess-1',
  business_id: BIZ,
  staff_id: 'staff-A',
  audio_storage_path: OWN_KEY,
  duration_seconds: 1380,
  status: 'UPLOADING',
  ...over,
})

const current = { row: row() as Row | null, getError: null as unknown }
const recordingsGet = jest.fn(async (_id: string) => {
  if (current.getError) throw current.getError
  return current.row
})
const enqueue = jest.fn(async (_a: unknown) => ({ id: 'job-1', status: 'QUEUED' }))
const customerGet = jest.fn(async () => ({
  is_existing_customer: false,
  visit_count: 0,
  has_ticket_pack: false,
}))
const listPacks = jest.fn(async (): Promise<Array<{ status: string; kind: string }>> => [])
const listKaruteRecords = jest.fn(async () => ({ karute_records: [] as Array<{ id: string }> }))

const synqed = {
  recordings: { get: recordingsGet },
  recordingJobs: { enqueue },
  customers: { get: customerGet },
  packs: { listPacks },
  karuteRecords: { list: listKaruteRecords },
} as unknown as Parameters<typeof enqueueFromSessionWithClient>[0]

const actor = (over: Partial<Parameters<typeof enqueueFromSessionWithClient>[1]> = {}) => ({
  staffId: 'staff-A',
  businessId: BIZ,
  holdsOwnerKeys: false,
  source: 'web' as const,
  jobStaffId: 'synqed-staff-A',
  storeId: 'store-1',
  ...over,
})

const input: EnqueueFromSessionInput = { recordingSessionId: 'sess-1', customerId: 'cust-1' }
const run = (a = actor(), i = input) => enqueueFromSessionWithClient(synqed, a, i)

beforeEach(() => {
  jest.clearAllMocks()
  current.row = row()
  current.getError = null
  objectExists.mockResolvedValue(true)
  enqueue.mockResolvedValue({ id: 'job-1', status: 'QUEUED' })
  customerGet.mockResolvedValue({ is_existing_customer: false, visit_count: 0, has_ticket_pack: false })
  listPacks.mockResolvedValue([])
  listKaruteRecords.mockResolvedValue({ karute_records: [] })
})

describe('the payload — the same job, with the path from the ROW', () => {
  it('queues the worker job and answers {ok, jobId, status}', async () => {
    await expect(run()).resolves.toEqual({ ok: true, jobId: 'job-1', status: 'QUEUED' })
    const [call] = enqueue.mock.calls[0] as [{ recording_session_id: string; payload: Record<string, unknown> }]
    expect(call.recording_session_id).toBe('sess-1')
    // Field for field the shape the two existing doors build.
    expect(call.payload).toEqual({
      customer_id: 'cust-1',
      staff_id: 'synqed-staff-A',
      appointment_id: null,
      store_id: 'store-1',
      audio_path: OWN_KEY,
      locale: 'ja',
      duration_seconds: 1380,
      outcome: undefined,
    })
  })

  it('THE PATH IS NEVER THE CALLER’S — an audioPath in the input is not read', async () => {
    const smuggled = { ...input, audioPath: `app_other-biz_${TAKE_UUID_FIXTURE}.webm` }
    await run(actor(), smuggled as typeof input)
    const [call] = enqueue.mock.calls[0] as [{ payload: { audio_path: string } }]
    expect(call.payload.audio_path).toBe(OWN_KEY)
    // …and the object that was PROVED is the row's, not the smuggled one.
    expect(objectExists).toHaveBeenCalledWith(OWN_KEY)
  })

  it('carries the appointment, locale and the row’s own duration when given', async () => {
    current.row = row({ duration_seconds: 42 })
    await run(actor(), { ...input, appointmentId: 'appt-9', locale: 'en' })
    const [call] = enqueue.mock.calls[0] as [{ payload: Record<string, unknown> }]
    expect(call.payload).toMatchObject({
      appointment_id: 'appt-9',
      locale: 'en',
      duration_seconds: 42,
    })
  })

  it('a null duration ships as undefined, never as null', async () => {
    // Only reachable with a job-owned status, which serverHoldsTakeRow accepts
    // without a duration — the legacy worker path's shape.
    current.row = row({ duration_seconds: null, status: 'PROCESSING' })
    await run()
    const [call] = enqueue.mock.calls[0] as [{ payload: Record<string, unknown> }]
    expect(call.payload.duration_seconds).toBeUndefined()
  })
})

describe('who may save it — the take doors’ own rule, restated here', () => {
  it('the recorder’s own session: allowed', async () => {
    await expect(run()).resolves.toMatchObject({ ok: true })
  })

  it('a colleague’s session with the OWNER’S HAND: allowed', async () => {
    current.row = row({ staff_id: 'staff-B' })
    await expect(run(actor({ holdsOwnerKeys: true }))).resolves.toMatchObject({ ok: true })
  })

  it('a colleague’s session WITHOUT it: forbidden, nothing queued', async () => {
    current.row = row({ staff_id: 'staff-B' })
    await expect(run()).resolves.toEqual({ error: 'forbidden' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('another tenant’s row: forbidden even with the owner’s hand', async () => {
    current.row = row({ business_id: 'biz-2' })
    await expect(run(actor({ holdsOwnerKeys: true }))).resolves.toEqual({ error: 'forbidden' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('no acting staff identity at all: forbidden, before the row is even read', async () => {
    await expect(run(actor({ staffId: null }))).resolves.toEqual({ error: 'forbidden' })
    expect(recordingsGet).not.toHaveBeenCalled()
  })
})

describe('is the audio actually there', () => {
  it('a 404 on the session is not_found', async () => {
    current.getError = Object.assign(new Error('gone'), { status: 404 })
    await expect(run()).resolves.toEqual({ error: 'not_found' })
  })

  it('any other read failure is a moment in time, not a verdict', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    current.getError = Object.assign(new Error('boom'), { status: 503 })
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    warn.mockRestore()
  })

  it('a row with NO pointer is no_audio — and storage is never asked', async () => {
    current.row = row({ audio_storage_path: null })
    await expect(run()).resolves.toEqual({ error: 'no_audio' })
    expect(objectExists).not.toHaveBeenCalled()
  })

  it('a row that never finalized is no_audio (the pointer alone is not an answer)', async () => {
    current.row = row({ duration_seconds: null, status: 'UPLOADING' })
    await expect(run()).resolves.toEqual({ error: 'no_audio' })
    expect(objectExists).not.toHaveBeenCalled()
  })

  it.each([
    ['a SEGMENT of this take', segmentKey(BIZ)],
    ['another tenant’s take', `app_other-biz_${TAKE_UUID_FIXTURE}.webm`],
    ['a staged copy', `stg/${BIZ}_${TAKE_UUID_FIXTURE}_${TAKE_UUID_FIXTURE}.webm`],
  ])('a pointer at %s is no_audio — the take fence, not merely "parses"', async (_l, path) => {
    current.row = row({ audio_storage_path: path })
    await expect(run()).resolves.toEqual({ error: 'no_audio' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('the bucket says the object is NOT there: no_audio, nothing queued', async () => {
    objectExists.mockResolvedValue(false)
    await expect(run()).resolves.toEqual({ error: 'no_audio' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("storage answers 'unknown': upstream — a blip must not read as lost audio", async () => {
    objectExists.mockResolvedValue('unknown')
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a failed enqueue is upstream, not a lie about the audio', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    enqueue.mockRejectedValue(new Error('core down'))
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    err.mockRestore()
  })
})

describe('the revisit label cannot be smuggled past its guard', () => {
  const revisit: EnqueueFromSessionInput = { ...input, outcome: { status: 'revisit' } }

  it('a brand-new customer is refused BEFORE anything is queued', async () => {
    await expect(run(actor(), revisit)).resolves.toEqual({ error: 'not_returning' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a returning customer goes through, outcome and all', async () => {
    customerGet.mockResolvedValue({ is_existing_customer: true, visit_count: 3, has_ticket_pack: false })
    await expect(run(actor(), revisit)).resolves.toMatchObject({ ok: true })
    const [call] = enqueue.mock.calls[0] as [{ payload: { outcome?: { status: string } } }]
    expect(call.payload.outcome).toEqual({ status: 'revisit' })
  })

  it('an unreadable eligibility is upstream, never a guess', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    customerGet.mockRejectedValue(new Error('core down'))
    listPacks.mockRejectedValue(new Error('core down'))
    listKaruteRecords.mockRejectedValue(new Error('core down'))
    await expect(run(actor(), revisit)).resolves.toEqual({ error: 'upstream' })
    expect(enqueue).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('every other outcome skips the guard entirely', async () => {
    const success: EnqueueFromSessionInput = { ...input, outcome: { status: 'success' } }
    await expect(run(actor(), success)).resolves.toMatchObject({ ok: true })
    expect(customerGet).not.toHaveBeenCalled()
  })
})
