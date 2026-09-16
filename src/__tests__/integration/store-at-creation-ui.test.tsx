/** @jest-environment jsdom */
/**
 * STORE AT CREATION — THE UI HALF (⚖ Liam 2026-09-16, P2b fold round).
 *
 * The server refuses a new card with no store whenever the BUSINESS has two or
 * more stores. The two creation forms decide whether the person is ever asked.
 * They used to ask the wrong question — "do I have two or more stores to offer?"
 * — so a 銀座-only branch manager in a two-store business saw no picker, sent no
 * store, and met a refusal pointing at a control that was not on the screen.
 * They could never hire again.
 *
 * The rule here: a creator with EXACTLY ONE assignable store has nothing to
 * choose, so the submission simply carries it. The picker appears at two or
 * more, where the choice is real.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
jest.mock('@/actions/permissions', () => ({
  getStaffPermissions: jest.fn(async () => ({ error: 'x' })),
  setStaffPermissions: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/stores', () => ({
  getStaffStores: jest.fn(async () => []),
  setStaffStores: jest.fn(async () => ({ ok: true })),
}))
const createStaff = jest.fn(async (_input: Record<string, unknown>) => ({
  error: 'STORE_REQUIRED_AT_CREATION',
}))
jest.mock('@/actions/staff', () => ({
  createStaff: (...a: unknown[]) => createStaff(...(a as [Record<string, unknown>])),
  updateStaff: jest.fn(async () => undefined),
}))
const createInvite = jest.fn(async (_input: Record<string, unknown>) => ({ token: 'tok-1' }))
jest.mock('@/actions/invites', () => ({
  createInvite: (...a: unknown[]) => createInvite(...(a as [Record<string, unknown>])),
  listInvites: jest.fn(async () => []),
  revokeInvite: jest.fn(async () => ({ ok: true })),
}))

import { StaffForm } from '@/components/staff/StaffForm'
import { InviteStaffDialog } from '@/components/settings/redesign/sections/staff/InviteStaffDialog'
import type { StoreRow } from '@/actions/stores'

const store = (id: string, name: string): StoreRow => ({
  id,
  name,
  address: null,
  phone: null,
  isPrimary: id === 'store-ginza',
  active: true,
  staffCount: 0,
  customerCount: 0,
  businessType: null,
})
const GINZA = store('store-ginza', '銀座店')
const DAIKANYAMA = store('store-daikanyama', '代官山店')

beforeEach(() => {
  jest.clearAllMocks()
  createStaff.mockResolvedValue({ error: 'STORE_REQUIRED_AT_CREATION' })
  createInvite.mockResolvedValue({ token: 'tok-1' })
})

describe('追加 — a creator with ONE assignable store (F1)', () => {
  it('sends that store with the create, and shows no picker to choose it with', async () => {
    render(
      <StaffForm
        mode="create"
        onClose={() => {}}
        featureMultiStore
        // The business has 銀座 + 代官山; this actor may use 銀座 only.
        stores={[GINZA]}
        activeStoreId="store-ginza"
      />,
    )
    // Nothing to choose → no picker (its only row would carry the store name).
    expect(screen.queryByText('銀座店')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('fullName'), { target: { value: '新人' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createStaff).toHaveBeenCalled())
    expect(createStaff.mock.calls[0][0]).toMatchObject({
      name: '新人',
      storeIds: ['store-ginza'],
    })
  })

  it('shows the picker at TWO assignable stores — that is where the choice is real', async () => {
    render(
      <StaffForm
        mode="create"
        onClose={() => {}}
        featureMultiStore
        stores={[GINZA, DAIKANYAMA]}
        activeStoreId="store-ginza"
      />,
    )
    expect(screen.getByText('銀座店')).toBeInTheDocument()
    expect(screen.getByText('代官山店')).toBeInTheDocument()
  })
})

describe('招待 — the same rule on the invite door (F1b)', () => {
  async function openDialog() {
    render(<InviteStaffDialog staff={[]} stores={[GINZA]} activeStoreId={null} />)
    fireEvent.click(screen.getByText('inviteStaff'))
    await screen.findByLabelText(/inviteEmailLabel/)
  }

  it('a stale or empty active store never strands the invite: one assignable store is sent', async () => {
    await openDialog()
    fireEvent.change(screen.getByLabelText(/inviteNameLabel/), { target: { value: '新人' } })
    fireEvent.change(screen.getByLabelText(/inviteEmailLabel/), {
      target: { value: 'new@test.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'inviteCreate' }))

    await waitFor(() => expect(createInvite).toHaveBeenCalled())
    expect(createInvite.mock.calls[0][0]).toMatchObject({
      email: 'new@test.com',
      name: '新人',
      storeIds: ['store-ginza'],
    })
  })
})
