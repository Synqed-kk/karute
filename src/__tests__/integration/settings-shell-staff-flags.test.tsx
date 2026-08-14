/** @jest-environment jsdom */
// SettingsShell → StaffSection prop threading (design-parity packet 12
// §S4a, T3). Pins: orgSettings.business_type and initialStores (already
// existing SettingsShell props — no new DTO field needed for either) reach
// StaffSection as businessType/stores; featureStaffInvites/featureMultiStore
// forward through unchanged, including staying undefined when the caller
// (web) omits them — StaffSection's own `prop ?? env` fallback is pinned
// separately in staff-section-invite-flag.test.tsx.
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/components/settings/redesign/sections/OrganizationSection', () => ({
  OrganizationSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/StoresSection', () => ({
  StoresSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/ThemeSection', () => ({
  ThemeSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/AISection', () => ({
  AISection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/CoachingSection', () => ({
  CoachingSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/RecordingSection', () => ({
  RecordingSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/SyncSection', () => ({
  SyncSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/PacksSection', () => ({
  PacksSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/MenusSection', () => ({
  MenusSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/AuditLogSection', () => ({
  AuditLogSection: () => null,
}))

const captured: Record<string, unknown>[] = []
jest.mock('@/components/settings/redesign/sections/StaffSection', () => ({
  StaffSection: (props: Record<string, unknown>) => {
    captured.push(props)
    return <div data-testid="section-staff" />
  },
}))

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import type { StoreRow } from '@/actions/stores'

const storeRow: StoreRow = {
  id: 'store-a',
  name: '渋谷店',
  address: null,
  phone: null,
  isPrimary: true,
  active: true,
  staffCount: 0,
  customerCount: 0,
  businessType: null,
}

beforeEach(() => {
  captured.length = 0
})

describe('SettingsShell — staff prop threading (T3)', () => {
  it('threads orgSettings.business_type, initialStores, and both feature flags through to StaffSection', () => {
    render(
      <SettingsShell
        orgSettings={{ business_type: 'hair_salon' } as never}
        staffList={[]}
        activeStaffId={null}
        locale="ja"
        isOwner
        canViewAllStores
        canManageStaff
        canInviteStaff
        canViewAudit
        canViewSync
        canManageMenus
        initialTab={'staff' as SettingsTabId}
        initialStores={[storeRow]}
        initialActiveStoreId={null}
        initialMenus={[]}
        initialEntitlement={null}
        featureStaffInvites={true}
        featureMultiStore={false}
      />,
    )
    expect(screen.getAllByTestId('section-staff').length).toBeGreaterThan(0)
    expect(captured[0]).toMatchObject({
      businessType: 'hair_salon',
      stores: [storeRow],
      featureStaffInvites: true,
      featureMultiStore: false,
    })
  })

  it('web (flags omitted): StaffSection receives undefined for both — its own env fallback applies, web unchanged', () => {
    render(
      <SettingsShell
        orgSettings={null}
        staffList={[]}
        activeStaffId={null}
        locale="ja"
        isOwner
        canViewAllStores
        canManageStaff
        canInviteStaff
        canViewAudit
        canViewSync
        canManageMenus
        initialTab={'staff' as SettingsTabId}
        initialStores={[]}
        initialActiveStoreId={null}
        initialMenus={[]}
        initialEntitlement={null}
      />,
    )
    expect(captured[0]).toMatchObject({
      businessType: undefined,
      stores: [],
      featureStaffInvites: undefined,
      featureMultiStore: undefined,
    })
  })
})
