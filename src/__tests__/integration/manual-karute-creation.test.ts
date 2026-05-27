/**
 * createManualKaruteRecord — the action behind the + 新規カルテ dialog.
 * Verifies the contract documented in src/actions/karute.ts:
 *   - calls synqed.karuteRecords.create with status='DRAFT'
 *   - passes customer_id + staff_id
 *   - drops service / duration / session_date silently (schema gap)
 *   - redirects to /karute/[new-id] on success
 *   - returns { error } string on failure
 *
 * Guards against:
 *   - Dialog regression where someone wires service/duration to a column
 *     that doesn't exist yet (would 500 silently).
 *   - Status drift — DRAFT is the contract; flipping to OPEN/REVIEW changes
 *     the karute list's conversionStatus derivation.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn() }))

// Match the mock pattern in migrated-staff.test.ts — head off the ESM
// import of @synqed-kk/client before the real module loads.
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

// Jest hoists jest.mock above all top-level code — define the spy
// inside the factory and re-export it via the mock so tests can read
// the call history.
jest.mock('next/navigation', () => ({
  redirect: jest.fn((path: string) => {
    throw Object.assign(new Error('REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path};307;` })
  }),
}))
import { redirect } from 'next/navigation'
const redirectMock = redirect as unknown as jest.Mock

const karuteRecords = {
  create: jest.fn(),
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords })),
}))

jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-self'),
}))

import { createManualKaruteRecord } from '@/actions/karute'

describe('createManualKaruteRecord', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes customer_id + staff_id with status=DRAFT and empty transcript/entries', async () => {
    karuteRecords.create.mockResolvedValue({ id: 'karute-new-1' })

    await expect(
      createManualKaruteRecord({
        customerId: 'cust-1',
        staffId: 'staff-2',
        sessionDate: '2026-05-27',
        durationMinutes: 60,
        service: 'フェイシャル',
      }),
    ).rejects.toThrow('REDIRECT')

    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
    expect(karuteRecords.create).toHaveBeenCalledWith({
      customer_id: 'cust-1',
      staff_id: 'staff-2',
      status: 'DRAFT',
      transcript: null,
      ai_summary: null,
      entries: [],
    })
  })

  it('drops service / duration / session_date silently (schema-gap contract)', async () => {
    karuteRecords.create.mockResolvedValue({ id: 'karute-new-2' })

    try {
      await createManualKaruteRecord({
        customerId: 'cust-1',
        staffId: 'staff-2',
        sessionDate: '2026-04-01', // backdated — would land here if column existed
        durationMinutes: 90,
        service: 'カット・カラー',
      })
    } catch {
      /* redirect throw */
    }

    const payload = karuteRecords.create.mock.calls[0][0]
    expect(payload).not.toHaveProperty('service')
    expect(payload).not.toHaveProperty('duration_minutes')
    expect(payload).not.toHaveProperty('session_date')
  })

  it('redirects to /karute/[new-id] on success', async () => {
    karuteRecords.create.mockResolvedValue({ id: 'karute-new-3' })

    try {
      await createManualKaruteRecord({
        customerId: 'cust-1',
        staffId: 'staff-2',
        sessionDate: '2026-05-27',
        durationMinutes: 60,
        service: '',
      })
    } catch {
      /* redirect throw */
    }

    expect(redirectMock).toHaveBeenCalledWith('/karute/karute-new-3')
  })

  it('returns { error } string when synqed client throws', async () => {
    karuteRecords.create.mockRejectedValue(new Error('synqed-core: customer not found'))

    const result = await createManualKaruteRecord({
      customerId: 'cust-missing',
      staffId: 'staff-2',
      sessionDate: '2026-05-27',
      durationMinutes: 60,
      service: '',
    })

    expect(result).toEqual({ error: 'synqed-core: customer not found' })
    expect(redirectMock).not.toHaveBeenCalled()
  })
})
