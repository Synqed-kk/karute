/**
 * bootstrapBusinessForNewUser must name the OWNER staff after the person
 * (email local-part), NOT the salon name. The salon name is the business
 * identity (profiles.full_name); the staff row is a human.
 */
process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const staffList = jest.fn()
const staffCreate = jest.fn()
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({
    staff: { list: staffList, create: staffCreate },
  })),
}))

const getUserById = jest.fn()
const fromMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({
    auth: { admin: { getUserById } },
    from: fromMock,
  })),
}))

import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

beforeEach(() => {
  jest.clearAllMocks()
  getUserById.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'jane@salon.jp' } },
    error: null,
  })
  fromMock.mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: { customer_id: 'biz-1', full_name: 'jane@salon.jp' },
      error: null,
    }),
    update: jest.fn().mockReturnThis(),
  }))
  staffList.mockResolvedValue({ staff: [] })
  staffCreate.mockResolvedValue({ id: 'staff-1' })
})

describe('bootstrapBusinessForNewUser — owner staff name', () => {
  it('names the OWNER staff after the email local-part, not the salon name', async () => {
    const result = await bootstrapBusinessForNewUser('Jane Salon', 'user-1')

    expect(result).toEqual({ ok: true, businessId: 'biz-1' })
    expect(staffCreate).toHaveBeenCalledTimes(1)
    expect(staffCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'jane',
        user_id: 'user-1',
        role: 'OWNER',
      }),
    )
  })

  it('falls back to "owner" when the user has no email', async () => {
    getUserById.mockResolvedValue({
      data: { user: { id: 'user-2', email: null } },
      error: null,
    })
    await bootstrapBusinessForNewUser('Jane Salon', 'user-2')
    expect(staffCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'owner', role: 'OWNER' }),
    )
  })
})
