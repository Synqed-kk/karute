/**
 * Post-migration appointment actions. Mocks @synqed-kk/client and verifies:
 *   - createAppointment maps UI camelCase → API snake_case and computes ends_at
 *   - Overlap (SynqedError 409) surfaces as a friendly user message
 *   - getAppointmentsByDate merges customer names + matches karute_record_id
 *   - deleteAppointment / updateAppointment thin pass-through
 */

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn(() => undefined),
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getTenantId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getActiveStaffId: jest.fn(async () => '28318e68-6b73-46ed-a1a2-c21299deee3f'),
}))

// Stub getOrgSettings so validateAppointmentTime treats operating hours as permissive
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({
    operating_hours: {
      monday: { open: '00:00', close: '24:00', enabled: true },
      tuesday: { open: '00:00', close: '24:00', enabled: true },
      wednesday: { open: '00:00', close: '24:00', enabled: true },
      thursday: { open: '00:00', close: '24:00', enabled: true },
      friday: { open: '00:00', close: '24:00', enabled: true },
      saturday: { open: '00:00', close: '24:00', enabled: true },
      sunday: { open: '00:00', close: '24:00', enabled: true },
    },
  })),
}))

// Mock @synqed-kk/client's SynqedError so instanceof checks work
jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  return { SynqedError }
})

const customers = {
  get: jest.fn(),
}
const appointments = {
  create: jest.fn(),
  list: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
}
const karuteRecords = {
  list: jest.fn(),
}

jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ customers, appointments, karuteRecords })),
}))

import {
  createAppointment,
  getAppointmentsByDate,
  updateAppointment,
  deleteAppointment,
} from '@/actions/appointments'
import { SynqedError } from '@synqed-kk/client'

describe('Migrated appointment actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createAppointment', () => {
    it('maps input and computes ends_at', async () => {
      appointments.create.mockResolvedValue({ id: 'appt-1' })

      const result = await createAppointment({
        staffProfileId: 'staff-1',
        clientId: 'cust-1',
        startTime: '2026-05-10T10:00:00.000Z',
        durationMinutes: 60,
        title: 'Cut',
        notes: 'return client',
      })

      expect(result).toEqual({ id: 'appt-1' })
      expect(appointments.create).toHaveBeenCalledWith({
        customer_id: 'cust-1',
        staff_id: 'staff-1',
        starts_at: '2026-05-10T10:00:00.000Z',
        ends_at: '2026-05-10T11:00:00.000Z',
        duration_minutes: 60,
        title: 'Cut',
        notes: 'return client',
      })
    })

    it('returns overlap message on SynqedError 409', async () => {
      appointments.create.mockRejectedValue(new SynqedError(409, 'overlap'))

      const result = await createAppointment({
        staffProfileId: 'staff-1',
        clientId: 'cust-1',
        startTime: '2026-05-10T10:00:00.000Z',
        durationMinutes: 60,
      })

      expect(result).toEqual({
        error: 'This time slot overlaps with an existing booking.',
      })
    })
  })

  describe('getAppointmentsByDate', () => {
    it('returns AppointmentRow[] with customer names and karute_record_id', async () => {
      appointments.list.mockResolvedValue({
        appointments: [
          {
            id: 'appt-1',
            staff_id: 'staff-1',
            customer_id: 'cust-1',
            starts_at: '2026-05-10T10:00:00.000Z',
            duration_minutes: 60,
            title: null,
            notes: null,
            created_at: '2026-05-10T00:00:00.000Z',
          },
          {
            id: 'appt-2',
            staff_id: 'staff-1',
            customer_id: 'cust-2',
            starts_at: '2026-05-10T12:00:00.000Z',
            duration_minutes: 60,
            title: null,
            notes: null,
            created_at: '2026-05-10T00:00:00.000Z',
          },
        ],
      })
      customers.get.mockImplementation((id: string) =>
        Promise.resolve({ id, name: id === 'cust-1' ? '山田' : '佐藤' }),
      )
      karuteRecords.list.mockResolvedValue({
        karute_records: [{ id: 'k-1', appointment_id: 'appt-1' }, { id: 'k-2', appointment_id: null }],
      })

      const rows = await getAppointmentsByDate('2026-05-10', 0)

      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        id: 'appt-1',
        staff_profile_id: 'staff-1',
        client_id: 'cust-1',
        karute_record_id: 'k-1',
        customers: { name: '山田' },
      })
      expect(rows[1]).toMatchObject({
        id: 'appt-2',
        karute_record_id: null,
        customers: { name: '佐藤' },
      })
    })

    it('returns [] on client error (swallowed)', async () => {
      appointments.list.mockRejectedValue(new Error('boom'))
      const rows = await getAppointmentsByDate('2026-05-10', 0)
      expect(rows).toEqual([])
    })
  })

  describe('updateAppointment', () => {
    it('computes ends_at when both startTime and durationMinutes change', async () => {
      appointments.update.mockResolvedValue(undefined)

      await updateAppointment('appt-1', {
        startTime: '2026-05-10T14:00:00.000Z',
        durationMinutes: 90,
      })

      expect(appointments.update).toHaveBeenCalledWith('appt-1', {
        starts_at: '2026-05-10T14:00:00.000Z',
        duration_minutes: 90,
        ends_at: '2026-05-10T15:30:00.000Z',
      })
    })

    it('partial update omits ends_at if only duration changes', async () => {
      appointments.update.mockResolvedValue(undefined)

      await updateAppointment('appt-1', { durationMinutes: 45 })

      expect(appointments.update).toHaveBeenCalledWith('appt-1', {
        duration_minutes: 45,
      })
    })
  })

  describe('deleteAppointment', () => {
    it('forwards to client', async () => {
      appointments.delete.mockResolvedValue(undefined)

      const result = await deleteAppointment('appt-1')

      expect(result).toEqual({ success: true })
      expect(appointments.delete).toHaveBeenCalledWith('appt-1')
    })
  })
})
