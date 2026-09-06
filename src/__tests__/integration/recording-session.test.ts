/**
 * startRecordingSession (src/actions/recordings.ts) — mints the synqed-core
 * recording_sessions row that core's idempotent-save dedupe (PR #38) keys on.
 * Mirrors mark-no-show-appointment.test.ts's mocking pattern: pins the
 * app-side contract (right capability, right staff_id resolution, right
 * create() payload, null-on-any-failure) — not core's behavior.
 */

const requireCapability = jest.fn(async (_cap: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (cap: string) => requireCapability(cap),
  can: jest.fn(async () => true),
}))

const getCurrentUserStaffId = jest.fn(async (): Promise<string | null> => 'staff-1')
// A jest.fn, not a bare literal: "the absent-take path never asked who the
// tenant is" is the only evidence that a start with no take makes exactly the
// calls it made before the born-reserved round.
const getBusinessId = jest.fn(async () => 'biz-1')
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
  getBusinessId: () => getBusinessId(),
}))

const recordingsCreate = jest.fn(async (_input: unknown) => ({ id: 'session-1' }))
const apptGet = jest.fn(async (_id: string) => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  staff_id: 'staff-from-appt',
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    recordings: { create: recordingsCreate },
    appointments: { get: apptGet },
  })),
}))

// storage-js's single-object probe (fix round 11): the session-start
// reservation shares the mint's objectExists fence (mint-take-url.ts). Default:
// the key is FREE — the bucket has never held this take, every ordinary first
// mint. Mirrors recording-upload-actions.test.ts's own mock exactly, so the
// same fence answers the same way in both places it now runs.
const notFoundError = { message: 'Object not found', status: 404 }
const info = jest.fn(
  async (
    _key: string,
  ): Promise<{
    data: { size?: number } | null
    error: { message: string; status?: number } | null
  }> => ({ data: null, error: notFoundError }),
)
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_bucket: string) => ({ info }) } }),
}))
// objectExists's own module reaches for the audit emitter transitively
// (mint-take-url.ts's other exports) — never called from this door, but
// mocked anyway so importing the module never touches next/server's `after`.
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

// ③ THE STORE THE DEVICE IS IN. The web door reads the actor's active store
// (the same value enqueueRecordingJob stamps) and sends it on the create. A
// jest.fn so the payload pins below can prove the door forwards THIS value and
// never invents one.
const resolveStoreScope = jest.fn(async () => ({
  storeId: 'store-1' as string | null,
  viewAll: true,
  allowedStoreIds: null as string[] | null,
  degraded: false,
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScope(),
}))

import { startRecordingSession } from '@/actions/recordings'
import { startRecordingSessionWithClient } from '@/lib/recording/session-mint'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  getBusinessId.mockImplementation(async () => 'biz-1')
  recordingsCreate.mockImplementation(async () => ({ id: 'session-1' }))
  apptGet.mockImplementation(async () => ({
    id: 'appt-1',
    customer_id: 'cust-1',
    staff_id: 'staff-from-appt',
  }))
  // mockReset, not just mockResolvedValue: the oracle case below queues a
  // mockResolvedValueOnce it deliberately never consumes (it asserts `info` is
  // never called), and clearAllMocks does not drain a once-queue — the leftover
  // answered "this key already holds bytes" for the next test that probed.
  info.mockReset()
  info.mockResolvedValue({ data: null, error: notFoundError })
  resolveStoreScope.mockImplementation(async () => ({
    storeId: 'store-1',
    viewAll: true,
    allowedStoreIds: null,
    degraded: false,
  }))
})

describe('startRecordingSession', () => {
  it('requires records.write, resolves staff from the signed-in user, and returns the minted id', async () => {
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(requireCapability).toHaveBeenCalledWith('records.write')
    expect(recordingsCreate).toHaveBeenCalledWith({
      staff_id: 'staff-1',
      customer_id: 'cust-1',
      appointment_id: 'appt-1',
      store_id: 'store-1',
    })
    expect(res).toEqual({ id: 'session-1' })
  })

  it('falls back to the appointment staff_id when the signed-in user has no staff identity', async () => {
    getCurrentUserStaffId.mockResolvedValueOnce(null)
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(apptGet).toHaveBeenCalledWith('appt-1')
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'staff-from-appt' }),
    )
    expect(res).toEqual({ id: 'session-1' })
  })

  it('returns null when neither the signed-in user nor the appointment resolves a staff id', async () => {
    getCurrentUserStaffId.mockResolvedValueOnce(null)
    apptGet.mockResolvedValueOnce(null as never)
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(res).toBeNull()
  })

  it('returns null when there is no appointmentId and no staff identity — never guesses', async () => {
    getCurrentUserStaffId.mockResolvedValueOnce(null)
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: null })
    expect(apptGet).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(res).toBeNull()
  })

  it('returns null on a capability denial — never throws to the caller', async () => {
    requireCapability.mockRejectedValueOnce(new Error('nope'))
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(res).toBeNull()
  })

  it('returns null when the SDK create() throws — never surfaces the error to the caller', async () => {
    recordingsCreate.mockRejectedValueOnce(new Error('network blip'))
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(res).toBeNull()
  })

})

// ── BORN RESERVED (fix round 10) ────────────────────────────────────────────
// A real lowercase uuid: a placeholder body would be refused by the uuid clause
// and silently mask every other clause under test.
const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const KEY = `app_biz-1_${TAKE}.webm`

/** The core, called the way both doors call it — the ONE place the field-pair
 *  rule and the key fence live (the web action runs no zod at all). */
const core = (over: Record<string, unknown> = {}) =>
  startRecordingSessionWithClient(
    { recordings: { create: recordingsCreate }, appointments: { get: apptGet } } as never,
    {
      customerId: 'cust-1',
      appointmentId: null,
      selfStaffId: 'staff-1',
      businessId: 'biz-1',
      storeId: null,
      ...over,
    },
  )

describe('startRecordingSession — the row is BORN carrying the take’s key', () => {
  it('creates the row WITH the composed key and UPLOADING when the recorder names its take', async () => {
    const res = await startRecordingSession({
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      takeId: TAKE,
      mimeType: 'audio/webm',
    })
    expect(recordingsCreate).toHaveBeenCalledWith({
      staff_id: 'staff-1',
      customer_id: 'cust-1',
      appointment_id: 'appt-1',
      store_id: 'store-1',
      audio_storage_path: KEY,
      status: 'UPLOADING',
    })
    expect(res).toEqual({ id: 'session-1' })
  })

  it('takes the tenant prefix from the COOKIE session, never from the argument', async () => {
    getBusinessId.mockResolvedValueOnce('biz-9')
    await startRecordingSession({ customerId: null, appointmentId: null, takeId: TAKE, mimeType: 'audio/mp4' })
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ audio_storage_path: `app_biz-9_${TAKE}.mp4` }),
    )
  })

  it('the container decides the extension — iOS mp4 is no longer named .webm', async () => {
    await core({ takeId: TAKE, mimeType: 'audio/mp4;codecs=mp4a.40.2' })
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ audio_storage_path: `app_biz-1_${TAKE}.mp4` }),
    )
  })

  it('an absent take reserves nothing, and the tenant is never even asked', async () => {
    await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    const [payload] = recordingsCreate.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(payload).sort()).toEqual([
      'appointment_id',
      'customer_id',
      'staff_id',
      'store_id',
    ])
    expect(getBusinessId).not.toHaveBeenCalled()
  })

  // Both fields or neither: a take id with no container has no extension to
  // compose, and a container with no take id names nothing.
  it.each([
    ['a take id with no container', { takeId: TAKE, mimeType: null }],
    ['a container with no take id', { takeId: null, mimeType: 'audio/webm' }],
  ])('refuses %s — bad_input, and nothing is created', async (_label, over) => {
    expect(await core(over)).toEqual({ error: 'bad_input' })
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  // The self-check fence, one clause wrong per row. The prototype rows are the
  // point: 'constructor' and '__proto__' survive toLowerCase and are the two
  // Object.prototype members that once composed a key from a function's source.
  const REFUSED: [string, { takeId: unknown; mimeType: unknown }][] = [
    ['an uppercase take id (the grammar is case-exact)', { takeId: TAKE.toUpperCase(), mimeType: 'audio/webm' }],
    ['a take id that is not a uuid', { takeId: 'not-a-uuid', mimeType: 'audio/webm' }],
    ['a take id carrying a separator', { takeId: `../${TAKE}`, mimeType: 'audio/webm' }],
    ['a non-string take id', { takeId: { toString: () => TAKE }, mimeType: 'audio/webm' }],
    ['a container we do not store', { takeId: TAKE, mimeType: 'audio/aiff' }],
    ['the prototype key "constructor"', { takeId: TAKE, mimeType: 'constructor' }],
    ['the prototype key "__proto__"', { takeId: TAKE, mimeType: '__proto__' }],
    ['the prototype key "toString"', { takeId: TAKE, mimeType: 'toString' }],
    ['a non-string container', { takeId: TAKE, mimeType: ['audio/webm'] }],
  ]
  it.each(REFUSED)('refuses %s — bad_input, and nothing is created', async (_label, over) => {
    expect(await core(over as never)).toEqual({ error: 'bad_input' })
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('refuses an empty tenant — `app__<uuid>` is a prefix no fence can attribute', async () => {
    expect(await core({ takeId: TAKE, mimeType: 'audio/webm', businessId: '' })).toEqual({
      error: 'bad_input',
    })
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('the web door stays fail-OPEN on a refusal — null, never a throw', async () => {
    const res = await startRecordingSession({ customerId: 'cust-1', takeId: TAKE, mimeType: 'audio/aiff' })
    expect(res).toBeNull()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('refuses BEFORE resolving staff — a refused key costs no appointment read', async () => {
    await core({ takeId: TAKE, mimeType: 'audio/aiff', selfStaffId: null, appointmentId: 'appt-1' })
    expect(apptGet).not.toHaveBeenCalled()
  })

  // ── THE EXISTS FENCE (fix round 11, fresh-eyes #7 P2) ─────────────────────
  // The mint has always refused a key whose object already exists; this door
  // never did. Drop the objectExists check from startRecordingSessionWithClient
  // and this test goes red: the row is created pointing at bytes this fresh
  // row never wrote.
  it('refuses a key whose object ALREADY EXISTS — exists, and nothing is created', async () => {
    info.mockResolvedValueOnce({ data: { size: 2048 }, error: null })
    expect(await core({ takeId: TAKE, mimeType: 'audio/webm' })).toEqual({ error: 'exists' })
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('fails CLOSED when storage cannot say whether the object exists — upstream, retryable', async () => {
    info.mockResolvedValueOnce({ data: null, error: { message: 'boom', status: 500 } })
    expect(await core({ takeId: TAKE, mimeType: 'audio/webm' })).toEqual({ error: 'upstream' })
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  // ── NEVER AN ORACLE, NEVER UNFINALIZABLE (fix round 12, fresh-eyes #8, P3) ─
  // A take-carrying start with no resolvable caller identity (selfStaffId)
  // used to fall straight through to the appointment-staff fallback — born
  // holding a reservation nobody but an owner could ever finalize — and the
  // exists probe ran BEFORE that fallback even had a chance to fail, so a
  // caller who could never end up with a row still learned whether a given
  // take id's key already held bytes. Both are refused outright now.
  it('refuses a take pair with no resolvable caller identity — bad_input, no appointment fallback', async () => {
    const res = await core({ takeId: TAKE, mimeType: 'audio/webm', selfStaffId: null, appointmentId: 'appt-1' })
    expect(res).toEqual({ error: 'bad_input' })
    expect(apptGet).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  // Drop the selfStaffId check ahead of the exists probe and this goes red:
  // `info` gets called and the caller learns 'exists' despite never being
  // able to get a row either way — the existence oracle this round closes.
  it('never probes storage for that same caller — no existence oracle, and no appointment fallback', async () => {
    info.mockResolvedValueOnce({ data: { size: 2048 }, error: null })
    const res = await core({ takeId: TAKE, mimeType: 'audio/webm', selfStaffId: null, appointmentId: null })
    expect(res).toEqual({ error: 'bad_input' })
    expect(info).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('the web door stays fail-OPEN on an exists refusal too — null, never a throw', async () => {
    info.mockResolvedValueOnce({ data: { size: 2048 }, error: null })
    const res = await startRecordingSession({ customerId: 'cust-1', takeId: TAKE, mimeType: 'audio/webm' })
    expect(res).toBeNull()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
})

// ── ⚖ THE STORE THE DEVICE WAS IN (slice three ③) ──────────────────────────
// The row now carries the store the actor was working in — the SAME value
// enqueueRecordingJob stamps on the job payload, so one recording never gives
// two answers to "which branch was this". Written at CREATE only: the SDK's
// update input has no store_id, so every row minted before ③ stays null for
// ever, and the take doors read that null as open.
describe('startRecordingSession — the store rides along', () => {
  it('sends the caller’s ACTIVE store, on the absent-take path', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })

  it('…and on the born-reserved path, beside the take’s key', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    await startRecordingSession({
      customerId: 'cust-1',
      appointmentId: null,
      takeId: TAKE,
      mimeType: 'audio/webm',
    })
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza', audio_storage_path: KEY }),
    )
  })

  it('sends null when the scope has no store — a business with none is a real answer', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: null,
      viewAll: true,
      allowedStoreIds: null,
      degraded: false,
    })
    await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(recordingsCreate).toHaveBeenCalledWith(expect.objectContaining({ store_id: null }))
  })

  // ⚖ G1 (Greptile #849). `degraded` means the assignment lookup FAILED, and on
  // that path the resolver still hands back a store — the active-store COOKIE,
  // unchecked. Stamping it would write an authorization fact we cannot vouch
  // for, and stamping null would write a row the take doors leave open for
  // ever. Refuse instead: the door's own fail-open null, capture unblocked, the
  // drain re-mints later through the same door.
  it('refuses to mint at all on a DEGRADED scope — no row is created, and the caller gets the fail-open null', async () => {
    resolveStoreScope.mockResolvedValue({
      // the shape store-scope.ts actually returns on a failed lookup: a real
      // storeId (the cookie / primary) beside degraded: true.
      storeId: 'store-from-cookie',
      viewAll: false,
      allowedStoreIds: null,
      degraded: true,
    })
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(res).toBeNull()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('…on the born-reserved path too — a degraded scope never reserves a key either', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: null,
      viewAll: false,
      allowedStoreIds: null,
      degraded: true,
    })
    const res = await startRecordingSession({
      customerId: 'cust-1',
      appointmentId: null,
      takeId: TAKE,
      mimeType: 'audio/webm',
    })
    expect(res).toBeNull()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('…while a HEALTHY scope stamps as before — the refusal is the degraded flag, not the store', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })

  it('never invents one — the value is the SCOPE’s, never the argument’s', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    await startRecordingSession({
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      // A caller-supplied store: this is a 'use server' export, so the argument
      // is caller JSON however it is typed. It must not reach the payload.
      ...({ storeId: 'store-elsewhere' } as object),
    })
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })
})
