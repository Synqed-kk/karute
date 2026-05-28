/**
 * Coverage for saveKaruteRecord's staff attribution (PR #84/#89, finalised by
 * #92). The server NEVER trusts a client-supplied staff id: it derives staff
 * from the signed-in user via getCurrentUserStaffId(), and when the record is
 * linked to an appointment it attributes to that appointment's staff instead.
 * No staff identity → the save is rejected before reaching synqed-core.
 */
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
// karute.ts now imports getLocale to prefix the post-create redirect.
jest.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))

let currentStaffId: string | null = null
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => currentStaffId),
}))

const karuteRecords = { create: jest.fn() }
const appointments = { get: jest.fn() }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords, appointments })),
}))

import { saveKaruteRecord } from '@/actions/karute'

const baseInput = { customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [] }

beforeEach(() => {
  jest.clearAllMocks()
  currentStaffId = null
})

describe('saveKaruteRecord — staff attribution', () => {
  it('derives staff_id from the signed-in user', async () => {
    currentStaffId = 'me-staff'
    karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
    await saveKaruteRecord({ ...baseInput })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'me-staff' }),
    )
  })

  it('errors (and never calls synqed) when the user has no staff identity', async () => {
    currentStaffId = null
    const result = await saveKaruteRecord({ ...baseInput })
    expect(result).toEqual({ error: expect.stringMatching(/no staff identity/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it("attributes to the linked appointment's staff when present (override)", async () => {
    currentStaffId = 'me-staff'
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'appt-staff' })
    karuteRecords.create.mockResolvedValue({ id: 'kr-2' })
    await saveKaruteRecord({ ...baseInput, appointmentId: 'ap-1' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'appt-staff', appointment_id: 'ap-1' }),
    )
  })

  it('falls back to the signed-in staff when the appointment lookup fails', async () => {
    currentStaffId = 'me-staff'
    appointments.get.mockRejectedValue(new Error('not found'))
    karuteRecords.create.mockResolvedValue({ id: 'kr-3' })
    await saveKaruteRecord({ ...baseInput, appointmentId: 'missing' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'me-staff' }),
    )
  })
})
