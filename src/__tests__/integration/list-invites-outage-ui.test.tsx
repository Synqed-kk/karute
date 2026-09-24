/** @jest-environment jsdom */
/**
 * The invite dialog shows an honest line when the pending list could not load
 * (listInvites → null), never an empty block that reads like "no pending
 * invites" (Round 3 leg 3). The action half: list-invites-outage.test.ts.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
const listInvites = jest.fn()
jest.mock('@/actions/invites', () => ({
  createInvite: jest.fn(async () => ({ token: 'tok-1' })),
  listInvites: () => listInvites(),
  revokeInvite: jest.fn(async () => ({ ok: true })),
}))

import { InviteStaffDialog } from '@/components/settings/redesign/sections/staff/InviteStaffDialog'

async function openDialog() {
  render(<InviteStaffDialog staff={[]} stores={[]} />)
  fireEvent.click(screen.getByText('inviteStaff'))
  await screen.findByLabelText(/inviteEmailLabel/)
  await waitFor(() => expect(listInvites).toHaveBeenCalled())
  await act(async () => {})
}

beforeEach(() => listInvites.mockReset())

describe('InviteStaffDialog — pending list states', () => {
  it('U1 could not load (null) → the unavailable line, no pending header', async () => {
    listInvites.mockResolvedValue(null)
    await openDialog()
    expect(await screen.findByText('pendingInvitesUnavailable')).toBeInTheDocument()
    expect(screen.queryByText('pendingInvites')).toBeNull()
  })

  it('U2 no pending invites ([]) → neither the line nor the header', async () => {
    listInvites.mockResolvedValue([])
    await openDialog()
    expect(screen.queryByText('pendingInvitesUnavailable')).toBeNull()
    expect(screen.queryByText('pendingInvites')).toBeNull()
  })

  it('U3 rows → the header and the row, no unavailable line', async () => {
    listInvites.mockResolvedValue([
      {
        id: 'inv-1',
        email: 'a@test.com',
        role: 'STYLIST',
        status: 'pending',
        created_at: '2026-01-01',
        expires_at: '2026-01-08',
        linked: false,
      },
    ])
    await openDialog()
    expect(await screen.findByText('pendingInvites')).toBeInTheDocument()
    expect(screen.getByText('a@test.com')).toBeInTheDocument()
    expect(screen.queryByText('pendingInvitesUnavailable')).toBeNull()
  })
})
