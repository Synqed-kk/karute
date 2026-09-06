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
import {
  conformingKey,
  rescueKey,
  segmentKey,
  TAKE_UUID_FIXTURE,
} from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const OWN_KEY = conformingKey(BIZ)
/** Where the nightly job puts a rescued take since amendment 9 — never the
 *  phone's own key. `resolveTakeAudio` is NOT mocked here: the real
 *  precedence runs over the one storage seam above, so these tests prove the
 *  door reads the phone's copy first and the rescue only on a proven miss. */
const RESCUE_KEY = rescueKey(BIZ)

type Row = {
  id: string
  business_id: string
  staff_id: string
  /** PR-B's stamp: where the DEVICE was when it recorded. Null on every row
   *  minted before slice ③, which D7 reads as open. */
  store_id: string | null
  audio_storage_path: string | null
  duration_seconds: number | null
  status: string
}
/** The PRODUCTION shape of a row this door is meant to act on: born reserved,
 *  finalized (duration + a status the recorder left behind), no job yet.
 *  `UPLOADING` WITH a duration is production, not a phantom: finalize re-writes
 *  UPLOADING when it stamps (D1). Since fix round 1's R1 the duration is not
 *  read by the derivation at all, so no case here turns on it. */
const row = (over: Partial<Row> = {}): Row => ({
  id: 'sess-1',
  business_id: BIZ,
  staff_id: 'staff-A',
  store_id: null,
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
const recordingsUpdate = jest.fn(async (_id: string, _patch: unknown) => ({}))
const customerGet = jest.fn(async () => ({
  is_existing_customer: false,
  visit_count: 0,
  has_ticket_pack: false,
}))
const listPacks = jest.fn(async (): Promise<Array<{ status: string; kind: string }>> => [])
const listKaruteRecords = jest.fn(async () => ({ karute_records: [] as Array<{ id: string }> }))
/** A ledger row as core really answers it — the two fields the fence RE-READS
 *  (fix round 2, R1) are on it, so a fixture can hand the door a discard for
 *  ANOTHER session and see whether it is actually looked at. */
type DiscardEvent = { id: string; recording_session_id: string; source: 'STAFF' | 'SYSTEM' }
const discardEvent = (over: Partial<DiscardEvent> = {}): DiscardEvent => ({
  id: 'disc-1',
  recording_session_id: 'sess-1',
  source: 'STAFF',
  ...over,
})
/** The discard ledger, asked per session by the door's own fence (R9a). */
const listDiscards = jest.fn(
  async (_opts: unknown): Promise<{ events: DiscardEvent[] }> => ({ events: [] }),
)

const synqed = {
  recordings: { get: recordingsGet, update: recordingsUpdate },
  recordingJobs: { enqueue },
  customers: { get: customerGet },
  packs: { listPacks },
  karuteRecords: { list: listKaruteRecords },
  recordingDiscards: { list: listDiscards },
} as unknown as Parameters<typeof enqueueFromSessionWithClient>[0]

const actor = (over: Partial<Parameters<typeof enqueueFromSessionWithClient>[1]> = {}) => ({
  staffId: 'staff-A',
  businessId: BIZ,
  holdsOwnerKeys: false,
  // PR-B makes the reach REQUIRED on the take doors' actor: null = the caller
  // is unrestricted, which is what a plain recorder acting on her own session
  // is. The owner's-hand cases below pass a concrete list.
  allowedStoreIds: null,
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
  objectExists.mockImplementation(async (key: string) => key === OWN_KEY)
  enqueue.mockResolvedValue({ id: 'job-1', status: 'QUEUED' })
  recordingsUpdate.mockResolvedValue({})
  customerGet.mockResolvedValue({ is_existing_customer: false, visit_count: 0, has_ticket_pack: false })
  listPacks.mockResolvedValue([])
  listKaruteRecords.mockResolvedValue({ karute_records: [] })
  listDiscards.mockResolvedValue({ events: [] })
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
    expect(objectExists).toHaveBeenNthCalledWith(1, OWN_KEY)
    expect(objectExists).not.toHaveBeenCalledWith(`app_other-biz_${TAKE_UUID_FIXTURE}.webm`)
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

  it('a rescued row’s null duration ships as undefined, never as null', async () => {
    current.row = row({ duration_seconds: null })
    await run()
    const [call] = enqueue.mock.calls[0] as [{ payload: Record<string, unknown> }]
    expect(call.payload.duration_seconds).toBeUndefined()
  })

  it('⚖ H3: THE RESCUE’S PATH is what the worker gets — the row’s pointer is not', async () => {
    // The row keeps pointing at the phone's key for ever (the job never writes
    // core), so the only place the rescue's key exists is the resolver's
    // answer. Sending the pointer instead would hand the worker an object that
    // is not there.
    current.row = row({ duration_seconds: null })
    objectExists.mockImplementation(async (key: string) => key === RESCUE_KEY)
    await expect(run()).resolves.toMatchObject({ ok: true })
    const [call] = enqueue.mock.calls[0] as [{ payload: { audio_path: string } }]
    expect(call.payload.audio_path).toBe(RESCUE_KEY)
    // The phone's own key was asked FIRST, and only its proven absence bought
    // the second question.
    expect(objectExists).toHaveBeenNthCalledWith(1, OWN_KEY)
    expect(objectExists).toHaveBeenNthCalledWith(2, RESCUE_KEY)
  })

  it('when BOTH exist the phone’s whole take wins, and the rescue is not asked about', async () => {
    objectExists.mockResolvedValue(true)
    await expect(run()).resolves.toMatchObject({ ok: true })
    const [call] = enqueue.mock.calls[0] as [{ payload: { audio_path: string } }]
    expect(call.payload.audio_path).toBe(OWN_KEY)
    expect(objectExists).toHaveBeenCalledTimes(1)
  })
})

/**
 * ⚖ R10 (fix round 4) — THE KARUTE IS BORN IN THE RECORDING'S STORE.
 *
 * The saver's active scope is not where the recording happened. On an owner's-
 * hand save the row knows better than the actor does: since PR-B it carries the
 * store the device was in. Stamping the caller's store instead files a store-9
 * recording's karute in store-1, where the staff who made it can never see it —
 * the exact outcome the store-isolation law exists to prevent.
 */
describe('the karute carries the RECORDING’s store, not the saver’s', () => {
  it('a row stamped store-9, rescued by an unrestricted owner sitting in store-1', async () => {
    current.row = row({ staff_id: 'staff-B', store_id: 'store-9' })
    await expect(run(actor({ holdsOwnerKeys: true }))).resolves.toMatchObject({ ok: true })
    const [call] = enqueue.mock.calls[0] as [{ payload: { store_id: string | null } }]
    expect(call.payload.store_id).toBe('store-9')
  })

  it('a pre-③ row with NO store falls back to the caller’s own scope', async () => {
    current.row = row({ store_id: null })
    await run()
    const [call] = enqueue.mock.calls[0] as [{ payload: { store_id: string | null } }]
    expect(call.payload.store_id).toBe('store-1')
  })

  it('the STAFF id is still the saver’s — attribution happens at enqueue', async () => {
    current.row = row({ staff_id: 'staff-B', store_id: 'store-9' })
    await run(actor({ holdsOwnerKeys: true }))
    const [call] = enqueue.mock.calls[0] as [{ payload: { staff_id: string } }]
    expect(call.payload.staff_id).toBe('synqed-staff-A')
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

  it('a colleague’s session WITHOUT it: forbidden, and storage is NEVER touched', async () => {
    // ⚖ R4 — the ORDER is the pin. Move assertRecorderOwnsRow below the probe
    // and a caller learns, from a 404 vs a 403, whether a colleague's take
    // object is in the bucket. An existence oracle over someone else's takes.
    current.row = row({ staff_id: 'staff-B' })
    await expect(run()).resolves.toEqual({ error: 'forbidden' })
    expect(objectExists).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('another tenant’s row: forbidden even with the owner’s hand, storage untouched', async () => {
    current.row = row({ business_id: 'biz-2' })
    await expect(run(actor({ holdsOwnerKeys: true }))).resolves.toEqual({ error: 'forbidden' })
    expect(objectExists).not.toHaveBeenCalled()
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

  it("⚖ D8': a row with NO duration is still saveable when the audio is there", async () => {
    // The rescued take: the nightly assembler wrote the audio and could not
    // write a length. `serverHoldsTakeRow` would refuse this exact row, which
    // is why the gate is the storage proof instead.
    current.row = row({ duration_seconds: null, status: 'UPLOADING' })
    await expect(run()).resolves.toMatchObject({ ok: true })
    expect(objectExists).toHaveBeenNthCalledWith(1, OWN_KEY)
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

  it('NEITHER key holds it: no_audio, nothing queued', async () => {
    objectExists.mockResolvedValue(false)
    await expect(run()).resolves.toEqual({ error: 'no_audio' })
    expect(objectExists).toHaveBeenCalledTimes(2)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("storage answers 'unknown': upstream — a blip must not read as lost audio", async () => {
    objectExists.mockResolvedValue('unknown')
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("…and an 'unknown' at the PHONE's key never falls through to the rescue", async () => {
    // Falling through would hand the staffer a PARTIAL take while the whole
    // one sat there unread — a silent downgrade of somebody's recording.
    objectExists.mockImplementation(async (key: string) =>
      key === OWN_KEY ? 'unknown' : true,
    )
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    expect(objectExists).toHaveBeenCalledTimes(1)
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

/**
 * ⚖ THE DURATION STAMP (D8' amendment). Core fences `recordings.update` behind
 * a HUMAN actor, so the nightly assembler rebuilds a take's object and can
 * never write its length. This door is the first moment after that rescue with
 * a real staffer's bearer in hand — so it computes the flush-window estimate
 * from the segments the recorder actually flushed and writes it ONCE, and the
 * save never depends on that write landing.
 */
/**
 * ⚖ THE DOOR STAMPS NO DURATION — EVER (ADDENDUM 9.2 H3, 2026-09-07).
 *
 * The D8' amendment had this door write the flush-window estimate, because the
 * nightly job has no actor and core fences the write behind a human one. The
 * side key made that wrong: the phone can still come back, and any duration on
 * the row makes `finalizedBefore` true, which sends the returning device's
 * finalize down the `already` exit — a 15-second length on a 45-minute
 * recording, a scrubber that lies, and no capture_finalized row for the real
 * arrival. So the length stays null until the phone itself writes the true one.
 */
describe('the duration is the row’s, and this door never writes one', () => {
  it('a rescued row: saved, queued, and NOTHING is written to core', async () => {
    current.row = row({ duration_seconds: null })
    objectExists.mockImplementation(async (key: string) => key === RESCUE_KEY)
    await expect(run()).resolves.toMatchObject({ ok: true })
    expect(recordingsUpdate).not.toHaveBeenCalled()
    const [call] = enqueue.mock.calls[0] as [{ payload: { duration_seconds?: number } }]
    expect(call.payload.duration_seconds).toBeUndefined()
  })

  it('a row that HAS a length still carries it, untouched', async () => {
    current.row = row({ duration_seconds: 1380 })
    await run()
    expect(recordingsUpdate).not.toHaveBeenCalled()
    const [call] = enqueue.mock.calls[0] as [{ payload: { duration_seconds?: number } }]
    expect(call.payload.duration_seconds).toBe(1380)
  })

  it('no segment folder is listed for a length either — the door reads no seq at all', async () => {
    // The listing that fed the estimate is gone with it. The only storage this
    // door touches is the existence question, at most twice.
    current.row = row({ duration_seconds: null })
    await run()
    expect(objectExists.mock.calls.every(([k]) => k === OWN_KEY || k === RESCUE_KEY)).toBe(true)
  })
})

/**
 * ⚖ THE DISCARD FENCE (fix round 1, R9a).
 *
 * A discard leaves the audio exactly where it was — nothing deletes recording
 * audio, and an ordinary discard keeps the take's own key — so nothing about
 * STORAGE can tell this door that a staff member threw the recording away. The
 * display row's `discardedByStaff` cannot be trusted for it either: that flag
 * comes from a ledger read documented to fail OPEN. So the door asks, itself,
 * on the one session, before it looks at the bucket.
 */
describe('a deliberate discard outranks everything', () => {
  it('a STAFF-discarded session is refused, and storage is never asked', async () => {
    listDiscards.mockResolvedValue({ events: [discardEvent()] })
    await expect(run()).resolves.toEqual({ error: 'discarded' })
    expect(objectExists).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('⚖ R1: the fence CHECKS the rows — a discard for ANOTHER session lets the save through', async () => {
    // The regression this pin exists for is a DROPPED filter, not a wrong
    // answer: if core ever stopped honouring `recording_session_id`, a count
    // would see the tenant's whole ledger and refuse every server save in the
    // salon. A fake that implements the filter can never show that, so the
    // fake here deliberately does not — it hands back a foreign row.
    listDiscards.mockResolvedValue({
      events: [discardEvent({ id: 'disc-9', recording_session_id: 'sess-OTHER' })],
    })
    await expect(run()).resolves.toEqual({ ok: true, jobId: 'job-1', status: 'QUEUED' })
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('⚖ R1: a SYSTEM row in the answer is not a staff discard', async () => {
    listDiscards.mockResolvedValue({ events: [discardEvent({ source: 'SYSTEM' })] })
    await expect(run()).resolves.toEqual({ ok: true, jobId: 'job-1', status: 'QUEUED' })
  })

  it('the fence asks for THIS session, STAFF rows only, one page', async () => {
    await run()
    expect(listDiscards).toHaveBeenCalledWith({
      recording_session_id: 'sess-1',
      source: 'STAFF',
      page_size: 1,
    })
  })

  it('an unreadable ledger REFUSES — "could not check" is never "not discarded"', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    listDiscards.mockRejectedValue(new Error('core down'))
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    expect(objectExists).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('⚖ R1: a row it cannot READ refuses too — "unreadable" is never "not discarded"', async () => {
    // This check's polarity is the OPPOSITE of hasStaffDiscard's next door: that
    // one needs a discard to EXIST before it writes, so a field core stopped
    // sending makes it refuse. This one needs the ledger EMPTY before it saves,
    // so the same missing field would let the save through, over a recording
    // somebody threw away with a written reason. The fixtures drop the fields
    // the way a proxy or an SDK rename would — one each.
    listDiscards.mockResolvedValue({
      events: [{ id: 'disc-1', source: 'STAFF' } as unknown as DiscardEvent],
    })
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    expect(objectExists).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()

    listDiscards.mockResolvedValue({
      events: [{ id: 'disc-1', recording_session_id: 'sess-1' } as unknown as DiscardEvent],
    })
    await expect(run()).resolves.toEqual({ error: 'upstream' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('the fence runs AFTER ownership — a colleague learns nothing from it', async () => {
    current.row = row({ staff_id: 'staff-B' })
    await expect(run()).resolves.toEqual({ error: 'forbidden' })
    expect(listDiscards).not.toHaveBeenCalled()
  })
})
