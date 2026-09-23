/** @jest-environment jsdom */
// StoresSection — native add-store branch (design-parity packet 12 §B-3 S2).
// AddStoreSubscriptionDialog is a purchase surface, aliased to a null render
// in the thin bundle (thin/ports/purchase-excluded.tsx) — the add-store
// button used to open ONLY that dialog, a dead tap in the shell. Pins the
// fix: inside the native shell, the button opens StoreFormDialog directly
// (skips the mock billing-confirm step); the web path is unchanged.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  // Values ride into the rendered string so a dropped interpolation is visible
  // (5/5 fold R1, MUT-F); a key with no values still renders as the bare key.
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
  useLocale: () => 'ja',
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }))
jest.mock('@/actions/stores', () => ({
  listStoresWithHours: jest.fn(async () => []),
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
  // The save button is what PIN T4 needs: handleFormSave is only reachable
  // through onSave, and the real dialog is a form this suite does not drive.
  StoreFormDialog: ({ mode, onSave }: { mode: unknown; onSave: (v: unknown) => void }) =>
    mode ? (
      <div data-testid="store-form-dialog">
        <button type="button" onClick={() => onSave({ name: '渋谷店', address: '', phone: '', businessType: 'hair_salon' })}>
          save-store
        </button>
      </div>
    ) : null,
}))
jest.mock('@/components/settings/redesign/sections/stores/PlanComparisonDialog', () => ({
  PlanComparisonDialog: () => null,
}))

import { toast } from 'sonner'
import { createStore } from '@/actions/stores'
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

  // ── PIN T4 — the screen SAYS the backfill could not be checked. Without the
  // branch, ⚖ H2's honest answer dies one layer short of the person.
  it('shows the backfillUnknown line when the store create answers it (T4)', async () => {
    ;(createStore as jest.Mock).mockResolvedValueOnce({ id: 'store-new', backfillUnknown: true })
    // The native shell opens StoreFormDialog directly, which is the shortest
    // route to handleFormSave (the web path adds a billing-confirm step first).
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    render(<StoresSection {...baseProps} />)
    await waitFor(() => {})

    fireEvent.click(screen.getByText('addStore'))
    fireEvent.click(screen.getByText('save-store'))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('backfillUnknown'))
  })

  // 5/5 fold R1 (stress MUT-F): the count is the whole point of this line —
  // "N staff could not be placed". Dropping `{ n }` left only the bare key.
  it('the backfillIncomplete line carries the count (MUT-F)', async () => {
    ;(createStore as jest.Mock).mockResolvedValueOnce({ id: 'store-new', backfillIncomplete: 2 })
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    render(<StoresSection {...baseProps} />)
    await waitFor(() => {})

    fireEvent.click(screen.getByText('addStore'))
    fireEvent.click(screen.getByText('save-store'))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('backfillIncomplete {"n":2}'))
  })

  it('a plain store create says nothing extra (T4)', async () => {
    // The sonner mock is module-level and accumulates across this file.
    ;(toast.warning as jest.Mock).mockClear()
    ;(createStore as jest.Mock).mockResolvedValueOnce({ id: 'store-new' })
    // The native shell opens StoreFormDialog directly, which is the shortest
    // route to handleFormSave (the web path adds a billing-confirm step first).
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    render(<StoresSection {...baseProps} />)
    await waitFor(() => {})

    fireEvent.click(screen.getByText('addStore'))
    fireEvent.click(screen.getByText('save-store'))

    await waitFor(() => expect(createStore).toHaveBeenCalled())
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('on the open web, the add button still opens the subscription step first (unchanged)', async () => {
    render(<StoresSection {...baseProps} />)
    await waitFor(() => {})

    fireEvent.click(screen.getByText('addStore'))
    expect(screen.getByTestId('subscription-dialog')).toBeTruthy()
    expect(screen.queryByTestId('store-form-dialog')).toBeNull()
  })
})
