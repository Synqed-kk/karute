/**
 * Authorization on voice enrollment/revocation.
 *
 * enroll/revoke take a client-supplied staffId. A staff member may manage their
 * OWN voice; only staff.manage (owner/manager) may manage a colleague's. These
 * tests prove an unauthorized caller is rejected BEFORE any write, and the two
 * authorized paths (self, and manager-for-others) go through.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn().mockResolvedValue('biz'),
  getCurrentUserStaffId: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({ can: jest.fn() }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ remove: jest.fn().mockResolvedValue({}) }) },
  }),
}))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn() }))

jest.mock('@/lib/synqed/client', () => {
  const upsert = jest.fn().mockResolvedValue({})
  return {
    getSynqedClient: jest.fn().mockResolvedValue({
      orgSettings: { get: jest.fn().mockResolvedValue({ settings: {} }), upsert },
    }),
    __mockUpsert: upsert,
  }
})

import { revokeVoiceAction } from '@/actions/voice'

const { __mockUpsert: mockUpsert } = jest.requireMock('@/lib/synqed/client') as {
  __mockUpsert: jest.Mock
}

const staff = jest.requireMock('@/lib/staff') as { getCurrentUserStaffId: jest.Mock }
const perm = jest.requireMock('@/lib/auth/require-permission') as { can: jest.Mock }
const org = jest.requireMock('@/actions/org-settings') as { getOrgSettings: jest.Mock }

const enrolled = (id: string) => ({
  voice_enrollments: { [id]: { sample_path: 's', ref_path: undefined, status: 'saved', revoked_at: null } },
})

beforeEach(() => jest.clearAllMocks())

describe('voice revoke authorization', () => {
  it('rejects revoking a colleague without staff.manage — no write', async () => {
    staff.getCurrentUserStaffId.mockResolvedValue('me')
    perm.can.mockResolvedValue(false)
    org.getOrgSettings.mockResolvedValue(enrolled('colleague'))

    const res = await revokeVoiceAction('colleague')

    expect(res).toEqual({ ok: false })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('allows a staff member to revoke their OWN voice without staff.manage', async () => {
    staff.getCurrentUserStaffId.mockResolvedValue('me')
    perm.can.mockResolvedValue(false)
    org.getOrgSettings.mockResolvedValue(enrolled('me'))

    const res = await revokeVoiceAction('me')

    expect(res).toEqual({ ok: true })
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })

  it('allows a manager (staff.manage) to revoke a colleague', async () => {
    staff.getCurrentUserStaffId.mockResolvedValue('owner')
    perm.can.mockResolvedValue(true)
    org.getOrgSettings.mockResolvedValue(enrolled('colleague'))

    const res = await revokeVoiceAction('colleague')

    expect(res).toEqual({ ok: true })
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })
})
