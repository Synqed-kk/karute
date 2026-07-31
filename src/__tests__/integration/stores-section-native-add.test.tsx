/** @jest-environment jsdom */
// StoresSection — native add-store branch (design-parity packet 12 §B-3 S2).
// AddStoreSubscriptionDialog is a purchase surface, aliased to a null render
// in the thin bundle (thin/ports/purchase-excluded.tsx) — the add-store
// button used to open ONLY that dialog, a dead tap in the shell. Pins the
// fix: inside the native shell, the button opens StoreFormDialog directly
// (skips the mock billing-confirm step); the web path is unchanged.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ja',
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/actions/stores', () => ({
  listStores: jest.fn(async () => []),
  createStore: jest.fn(async () => ({ id: 'store-new' })),
  updateStore: jest.fn(async () => ({ ok: true })),
  setActiveStore: jest.fn(async () => ({ ok: true })),
  getActiveStoreId: jest.fn(async () => null),
}))
jest.mock('@/actions/entitlements', () => ({
  getEntitlement: jest.fn(async () => ({})),
}))
jest.mock('@/components/settings/redesign/sections/stores/AddStoreSubscriptionDialog', () => ({
  AddStoreSubscriptionDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="subscription-dialog" /> : null,
}))
jest.mock('@/components/settings/redesign/sections/stores/StoreFormDialog', () => ({
  StoreFormDialog: ({ mode }: { mode: unknown }) =>
    mode ? <div data-testid="store-form-dialog" /> : null,
}))
jest.mock('@/components/settings/redesign/sections/stores/PlanComparisonDialog', () => ({
  PlanComparisonDialog: () => null,
}))

import { StoresSection } from '@/components/settings/redesign/sections/StoresSection'
import type { Entitlement } from '@/lib/entitlements'
import { TIER_FEATURES } from '@/lib/subscription/types'

const unlimitedEntitlement: Entitlement = {
  tier: 'professional',
  storeLimit: 'unlimited',
  storeCount: 1,
  isUnlimited: true,
  features: TIER_FEATURES.professional,
  staffLimit: 'unlimited',
  canAddStore: true,
  enforced: false,
  degraded: false,
}

const baseProps = {
  orgSettings: null,
  isOwner: true,
  // Non-empty + a real initialEntitlement means the mount effect's
  // already-complete branch skips its client fetch entirely (StoresSection's
  // own effect: initialStores.length > 0 && initialEntitlement present → no
  // fetch) — the mocked getEntitlement() below (a bare {}) never overwrites
  // this test's entitlement, so multiStoreEnabled/canAdd stay stable.
  initialStores: [
    {
      id: 'store-1',
      name: '代官山',
      address: null,
      phone: null,
      isPrimary: true,
      active: true,
      staffCount: 0,
      customerCount: 0,
      businessType: null,
    },
  ],
  initialActiveStoreId: 'store-1',
  initialEntitlement: unlimitedEntitlement,
}

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('StoresSection — native add-store branch', () => {
  it('inside the native shell, the add button opens StoreFormDialog directly (skips the mock billing-confirm step)', async () => {
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    render(<StoresSection {...baseProps} />)
    // Give the effect a chance to flip the native-shell gate.
    await waitFor(() => {})

    fireEvent.click(screen.getByText('addStore'))
    expect(screen.queryByTestId('subscription-dialog')).toBeNull()
    expect(screen.getByTestId('store-form-dialog')).toBeTruthy()
  })

  it('on the open web, the add button still opens the subscription step first (unchanged)', async () => {
    render(<StoresSection {...baseProps} />)
    await waitFor(() => {})

    fireEvent.click(screen.getByText('addStore'))
    expect(screen.getByTestId('subscription-dialog')).toBeTruthy()
    expect(screen.queryByTestId('store-form-dialog')).toBeNull()
  })
})
