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

import { startRecordingSession, startRecordingSessionWithClient } from '@/actions/recordings'

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
})

describe('startRecordingSession', () => {
  it('requires records.write, resolves staff from the signed-in user, and returns the minted id', async () => {
    const res = await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(requireCapability).toHaveBeenCalledWith('records.write')
    expect(recordingsCreate).toHaveBeenCalledWith({
      staff_id: 'staff-1',
      customer_id: 'cust-1',
      appointment_id: 'appt-1',
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

  it('sends no store_id — mirrors saveKaruteRecord, which never sends one either', async () => {
    await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    const [payload] = recordingsCreate.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(payload).sort()).toEqual(['appointment_id', 'customer_id', 'staff_id'])
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
    { customerId: 'cust-1', appointmentId: null, selfStaffId: 'staff-1', businessId: 'biz-1', ...over },
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

  it('an absent take is byte-identical to before: three keys, and the tenant is never even asked', async () => {
    await startRecordingSession({ customerId: 'cust-1', appointmentId: 'appt-1' })
    const [payload] = recordingsCreate.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(payload).sort()).toEqual(['appointment_id', 'customer_id', 'staff_id'])
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
})
