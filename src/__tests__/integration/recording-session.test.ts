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
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: () => getCurrentUserStaffId() }))

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

import { startRecordingSession } from '@/actions/recordings'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
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
