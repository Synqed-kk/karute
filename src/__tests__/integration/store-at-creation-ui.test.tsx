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

const mockTranslate = jest.fn((_namespace: string, key: string) => key)

jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => mockTranslate(namespace, key),
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
const createStaff = jest.fn(async (_input: Record<string, unknown>): Promise<
  { error: string } | { id: string; storeUnknown?: true }
> => ({ error: 'STORE_REQUIRED_AT_CREATION' }))
jest.mock('@/actions/staff', () => ({
  createStaff: (...a: unknown[]) => createStaff(...(a as [Record<string, unknown>])),
  updateStaff: jest.fn(async () => undefined),
}))
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}))

import { toast } from 'sonner'
import { StaffForm } from '@/components/staff/StaffForm'
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

  // ⚖ G7 — the create side does not ask NEXT_PUBLIC_FEATURE_MULTI_STORE. The
  // server refuses a storeless card whenever the BUSINESS has two or more
  // stores, so with the flag off a two-store salon had no picker, sent no
  // store, and could not add staff at all.
  it('with the multi-store flag OFF, two stores still get a picker and the choice is sent (G7)', async () => {
    render(
      <StaffForm
        mode="create"
        onClose={() => {}}
        featureMultiStore={false}
        stores={[GINZA, DAIKANYAMA]}
        activeStoreId="store-ginza"
      />,
    )
    expect(screen.getByText('銀座店')).toBeInTheDocument()
    expect(screen.getByText('代官山店')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('fullName'), { target: { value: '新人' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createStaff).toHaveBeenCalled())
    expect(createStaff.mock.calls[0][0]).toMatchObject({
      name: '新人',
      storeIds: ['store-ginza'], // the seeded active store, ticked by default
    })
  })
})

// ── PIN T7 — ONE assignable store and NO active-store seed. The F1 tests above
// always pass activeStoreId, so the auto-send was masked by the seeded tick:
// the submission carries the single store because there is nothing to choose,
// NOT because a cookie happened to point at it. A creator whose active-store
// cookie is empty or stale must still be able to hire.
describe('one assignable store, no active-store seed (T7)', () => {
  it('追加 still sends that store', async () => {
    render(<StaffForm mode="create" onClose={() => {}} stores={[GINZA]} />)
    fireEvent.change(screen.getByPlaceholderText('fullName'), { target: { value: '新人' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createStaff).toHaveBeenCalled())
    expect(createStaff.mock.calls[0][0]).toMatchObject({ storeIds: ['store-ginza'] })
  })
})


describe('an unknown store count is visible at both doors (U-V7 / U-V8)', () => {
  it('StaffForm requests the storeUnknown message key and shows its warning toast (U-V7)', async () => {
    createStaff.mockResolvedValue({ id: 'staff-new', storeUnknown: true })
    render(<StaffForm mode="create" onClose={() => {}} stores={[]} />)
    fireEvent.change(screen.getByPlaceholderText('fullName'), { target: { value: '新人' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('staffAddedStoreUnknown'))
    expect(mockTranslate).toHaveBeenCalledWith('settings', 'staffAddedStoreUnknown')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
