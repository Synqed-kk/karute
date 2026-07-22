/** @jest-environment jsdom */
// StaffForm — featureMultiStore `prop ?? env`, businessType/stores as props
// (design-parity packet 12 §S4a, T3: kills the getOrgSettings()/listStores()
// client re-fetches). Pins:
//   - the store-assignment checkbox list renders from the `stores` PROP
//     (never a client fetch — listStores is no longer imported at all)
//   - featureMultiStore prop wins over env; omitted falls back to env
//   - the businessType prop drives the 役職 picker's options synchronously
//     (no getOrgSettings() fetch / loading flicker)
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/actions/permissions', () => ({
  getStaffPermissions: jest.fn(async () => ({ error: 'not reached in these tests' })),
  setStaffPermissions: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/stores', () => ({
  getStaffStores: jest.fn(async () => []),
  setStaffStores: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/staff', () => ({
  createStaff: jest.fn(async () => undefined),
  updateStaff: jest.fn(async () => undefined),
}))

import { StaffForm } from '@/components/staff/StaffForm'
import type { StoreRow } from '@/actions/stores'

const stores: StoreRow[] = [
  {
    id: 'store-a',
    name: '渋谷店',
    address: null,
    phone: null,
    isPrimary: true,
    active: true,
    staffCount: 0,
    customerCount: 0,
    businessType: null,
  },
]

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE
  else process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE = ORIGINAL_ENV
})

describe('StaffForm — featureMultiStore prop ?? env', () => {
  it('prop=true → store-assignment checkboxes render from the stores PROP (no fetch)', () => {
    delete process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE
    render(
      <StaffForm
        mode="edit"
        staff={{ id: 'staff-9', name: 'A' }}
        onClose={() => {}}
        featureMultiStore
        stores={stores}
      />,
    )
    expect(screen.getByText('渋谷店')).toBeTruthy()
  })

  it('prop=false wins over env=true → no store-assignment section', () => {
    process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE = 'true'
    render(
      <StaffForm
        mode="edit"
        staff={{ id: 'staff-9', name: 'A' }}
        onClose={() => {}}
        featureMultiStore={false}
        stores={stores}
      />,
    )
    expect(screen.queryByText('渋谷店')).toBeNull()
  })

  it('prop omitted, env=true → falls back to env, checkboxes render (web behavior, unchanged)', () => {
    process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE = 'true'
    render(
      <StaffForm mode="edit" staff={{ id: 'staff-9', name: 'A' }} onClose={() => {}} stores={stores} />,
    )
    expect(screen.getByText('渋谷店')).toBeTruthy()
  })

  it('prop omitted, env unset → falls back to env (false), no store-assignment section', () => {
    delete process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE
    render(
      <StaffForm mode="edit" staff={{ id: 'staff-9', name: 'A' }} onClose={() => {}} stores={stores} />,
    )
    expect(screen.queryByText('渋谷店')).toBeNull()
  })
})

describe('StaffForm — businessType prop drives 役職 options (no getOrgSettings() fetch)', () => {
  it('businessType="hair_salon" → the hair-salon title set is available immediately', () => {
    render(<StaffForm mode="create" onClose={() => {}} businessType="hair_salon" />)
    expect(screen.getByRole('option', { name: 'スタイリスト' })).toBeTruthy()
  })

  it('businessType omitted → falls back to the default title set', () => {
    render(<StaffForm mode="create" onClose={() => {}} />)
    expect(screen.getByRole('option', { name: 'スタッフ' })).toBeTruthy()
  })
})
