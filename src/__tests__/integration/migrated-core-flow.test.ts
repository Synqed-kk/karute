/**
 * Post-migration core flow: exercises the server actions that now delegate
 * to @synqed-kk/client. Mocks the client so the test runs without a live
 * synqed-core; contract testing lives in synqed-core/tests/*.
 *
 * Covers: createCustomer, saveKaruteRecord (atomic create + entries),
 * addManualEntry, deleteEntry, deleteKaruteRecord, deleteCustomer.
 */

import { TEST_STAFF_PROFILE_ID } from './helpers/server-action-mocks'

// --- Next.js context mocks (must be top-level so jest.mock is hoisted) ---
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn((name: string) => {
      if (name === 'active_staff_id') return { value: TEST_STAFF_PROFILE_ID }
      return undefined
    }),
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))

// --- getTenantId mock (avoids hitting supabase auth for the tenant lookup) ---
jest.mock('@/lib/staff', () => ({
  getTenantId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getActiveStaffId: jest.fn(async () => TEST_STAFF_PROFILE_ID),
}))

// --- @synqed-kk/client mock ---
// Track every call so we can assert shape + args.
const customers = {
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
  checkDuplicate: jest.fn(),
}
const appointments = {
  list: jest.fn(),
  delete: jest.fn(),
}
const karuteRecords = {
  create: jest.fn(),
  delete: jest.fn(),
  addEntry: jest.fn(),
  deleteEntry: jest.fn(),
  list: jest.fn(),
}

jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    customers,
    appointments,
    karuteRecords,
  })),
}))

import { createCustomer, deleteCustomer } from '@/actions/customers'
import { saveKaruteRecord, deleteKaruteRecord } from '@/actions/karute'
import { addManualEntry, deleteEntry } from '@/actions/entries'
import { redirect } from 'next/navigation'

describe('Migrated core flow — customers + karute + entries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    customers.checkDuplicate.mockResolvedValue({ exists: false })
  })

  it('createCustomer calls customers.create with the form payload', async () => {
    customers.create.mockResolvedValue({ id: 'cust-1', name: 'テスト太郎' })

    const result = await createCustomer({
      name: 'テスト太郎',
      furigana: 'テストタロウ',
      phone: '',
      email: '',
    })

    expect(result).toEqual({ success: true, id: 'cust-1' })
    expect(customers.create).toHaveBeenCalledWith({
      name: 'テスト太郎',
      furigana: 'テストタロウ',
      phone: null,
      email: null,
    })
  })

  it('saveKaruteRecord does a single atomic create with entries inlined', async () => {
    karuteRecords.create.mockResolvedValue({ id: 'karute-1' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 'session transcript',
      summary: 'session summary',
      entries: [
        { category: 'symptom', content: 'itchy scalp', sourceQuote: 'quote', confidenceScore: 0.9 },
        { category: 'treatment', content: 'shampoo', confidenceScore: 0.8 },
      ],
    })

    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
    const arg = karuteRecords.create.mock.calls[0][0]
    expect(arg.customer_id).toBe('cust-1')
    expect(arg.staff_id).toBe(TEST_STAFF_PROFILE_ID)
    expect(arg.ai_summary).toBe('session summary')
    expect(arg.transcript).toBe('session transcript')
    expect(arg.entries).toHaveLength(2)
    expect(arg.entries[0]).toMatchObject({
      category: 'SYMPTOM',
      content: 'itchy scalp',
      original_quote: 'quote',
      confidence: 0.9,
      is_manual: false,
    })
    expect(arg.entries[1]).toMatchObject({
      category: 'TREATMENT',
      content: 'shampoo',
      confidence: 0.8,
      is_manual: false,
    })
    expect(redirect).toHaveBeenCalledWith('/karute/karute-1')
  })

  it('addManualEntry calls addEntry with is_manual=true and confidence=null', async () => {
    karuteRecords.addEntry.mockResolvedValue({ id: 'entry-1' })

    const result = await addManualEntry({
      karuteRecordId: 'karute-1',
      category: 'next_visit',
      content: '2 weeks out',
    })

    expect(result).toEqual({})
    expect(karuteRecords.addEntry).toHaveBeenCalledWith('karute-1', {
      category: 'NEXT_VISIT',
      content: '2 weeks out',
      is_manual: true,
      confidence: null,
      original_quote: null,
    })
  })

  it('deleteEntry calls deleteEntry on the client', async () => {
    karuteRecords.deleteEntry.mockResolvedValue(undefined)

    const result = await deleteEntry('entry-1', 'karute-1')

    expect(result).toEqual({})
    expect(karuteRecords.deleteEntry).toHaveBeenCalledWith('karute-1', 'entry-1')
  })

  it('deleteKaruteRecord delegates to client.karuteRecords.delete (server cascades)', async () => {
    karuteRecords.delete.mockResolvedValue(undefined)

    const result = await deleteKaruteRecord('karute-1')

    expect(result).toEqual({ success: true })
    expect(karuteRecords.delete).toHaveBeenCalledWith('karute-1')
  })

  it('deleteCustomer blocks when karute records exist', async () => {
    karuteRecords.list.mockResolvedValue({ total: 2, karute_records: [] })

    const result = await deleteCustomer('cust-1')

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/2 karute records/)
    expect(customers.delete).not.toHaveBeenCalled()
  })

  it('deleteCustomer iterates appointments then deletes the customer', async () => {
    karuteRecords.list.mockResolvedValue({ total: 0, karute_records: [] })
    appointments.list.mockResolvedValue({
      appointments: [{ id: 'appt-1' }, { id: 'appt-2' }],
    })
    appointments.delete.mockResolvedValue(undefined)
    customers.delete.mockResolvedValue(undefined)

    const result = await deleteCustomer('cust-1')

    expect(result).toEqual({ success: true, id: 'cust-1' })
    expect(appointments.delete).toHaveBeenCalledTimes(2)
    expect(appointments.delete).toHaveBeenCalledWith('appt-1')
    expect(appointments.delete).toHaveBeenCalledWith('appt-2')
    expect(customers.delete).toHaveBeenCalledWith('cust-1')
  })

  it('saveKaruteRecord uses appointment.staff_id when appointmentId is provided', async () => {
    // Inject appointments.get on the mock client for this test only
    const apptClient = { get: jest.fn().mockResolvedValue({ staff_id: 'appt-staff-xyz' }) }
    const { getSynqedClient } = await import('@/lib/synqed/client')
    ;(getSynqedClient as jest.Mock).mockResolvedValueOnce({
      customers,
      appointments: apptClient,
      karuteRecords,
    })
    karuteRecords.create.mockResolvedValue({ id: 'karute-2' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 't',
      summary: 's',
      entries: [],
      appointmentId: 'appt-1',
    })

    expect(apptClient.get).toHaveBeenCalledWith('appt-1')
    const arg = karuteRecords.create.mock.calls[karuteRecords.create.mock.calls.length - 1][0]
    expect(arg.staff_id).toBe('appt-staff-xyz')
    expect(arg.appointment_id).toBe('appt-1')
  })
})
