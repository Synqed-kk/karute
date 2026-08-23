/**
 * @jest-environment jsdom
 *
 * CustomerProfileView — Test #9 (thin fallback pin, F2): with no
 * reengagementSlot prop (thin's DTO carries no ReactNode — profile-screen.ts
 * is never routed through), the mount renders CustomerReengagementPreview
 * (still the amber 対応予定 placeholder). Passing a slot renders it instead.
 * Every OTHER child on the page is stubbed — this file only pins the one
 * line under test (`{reengagementSlot ?? <CustomerReengagementPreview />}`).
 */
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
  }
})
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ back: jest.fn() }) }))
jest.mock('@/components/customers/redesign/profile/CustomerIdentityCard', () => ({ CustomerIdentityCard: () => null }))
jest.mock('@/components/visits/VisitPaceCard', () => ({ VisitPaceCard: () => null }))
jest.mock('@/components/customers/redesign/profile/RegenerateAllForCustomerButton', () => ({
  RegenerateAllForCustomerButton: () => null,
}))
jest.mock('@/components/customers/redesign/profile/CustomerTabBar', () => ({
  CustomerTabBar: () => null,
}))
jest.mock('@/components/karute/spike-lifted/memory/CustomerMemoryCard', () => ({ CustomerMemoryCard: () => null }))
jest.mock('@/components/customers/redesign/profile/BookingMemoCard', () => ({ BookingMemoCard: () => null }))
jest.mock('@/components/customers/redesign/profile/SessionsTabContent', () => ({ SessionsTabContent: () => null }))
jest.mock('@/components/customers/redesign/profile/PhotosTabContent', () => ({ PhotosTabContent: () => null }))
jest.mock('@/components/customers/redesign/profile/PrivacyTabContent', () => ({ PrivacyTabContent: () => null }))
jest.mock('@/components/customers/redesign/CustomerDeletionBanner', () => ({ CustomerDeletionBanner: () => null }))
jest.mock('@/components/customers/redesign/profile/TicketPackCard', () => ({ TicketPackCard: () => null }))

import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import type { CustomerProfileData } from '@/components/customers/redesign/types'

const CUSTOMER: CustomerProfileData = {
  id: 'cust-1',
  name: '田中 花子',
  initials: 'TH',
  karuteNumber: '#00001',
  deletedAt: null,
  age: null,
  gender: null,
  joinDate: '',
  totalKarute: 0,
  phone: null,
  email: null,
  preferredStaffName: null,
  status: 'on-track',
  memoryCount: 0,
  sessionCount: 0,
  photoCount: 0,
}

describe('CustomerProfileView — reengagementSlot fallback (Test #9)', () => {
  it('no reengagementSlot prop → renders CustomerReengagementPreview (対応予定 pill)', () => {
    render(<CustomerProfileView customer={CUSTOMER} sessions={[]} photos={[]} />)
    expect(screen.getByText('対応予定')).toBeInTheDocument()
    expect(screen.getByText('AI再エンゲージメント')).toBeInTheDocument()
  })

  it('a real reengagementSlot → renders it instead of the placeholder', () => {
    render(
      <CustomerProfileView
        customer={CUSTOMER}
        sessions={[]}
        photos={[]}
        reengagementSlot={<div data-testid="real-slot">REAL-SLOT-MARKER</div>}
      />,
    )
    expect(screen.getByTestId('real-slot')).toBeInTheDocument()
    expect(screen.queryByText('対応予定')).not.toBeInTheDocument()
  })
})
