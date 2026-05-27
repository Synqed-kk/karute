/**
 * @jest-environment jsdom
 *
 * Render coverage for BottomNav (PR #87, replay/12): the center mic-button
 * label/hint that surfaces the staff member's next customer.
 */
import { render, screen } from '@testing-library/react'
import type { NextCustomerInfo } from '@/lib/appointments/next-customer'

let mockPathname = '/dashboard'

jest.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({ state: 'idle', startedAt: null, stopRecording: jest.fn() }),
}))

import { BottomNav } from '@/components/layout/bottom-nav'

function next(over: Partial<NextCustomerInfo> = {}): NextCustomerInfo {
  return {
    customerId: 'c1',
    customerName: '田中',
    startTime: new Date().toISOString(),
    reason: 'upcoming',
    minutesFromNow: 30,
    ...over,
  }
}

beforeEach(() => {
  mockPathname = '/dashboard'
})

describe('BottomNav center button', () => {
  it('shows the scaffold "pick booking" label when there is no next customer', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    expect(screen.getByText('pickBooking')).toBeInTheDocument()
  })

  it('shows the customer name with the JA honorific 様', () => {
    render(<BottomNav nextCustomer={next({ customerName: '田中' })} locale="ja" />)
    expect(screen.getByText('田中様')).toBeInTheDocument()
  })

  it('omits the honorific in English', () => {
    render(<BottomNav nextCustomer={next({ customerName: 'Tanaka' })} locale="en" />)
    expect(screen.getByText('Tanaka')).toBeInTheDocument()
  })

  it('renders the upcoming minutes hint (JA)', () => {
    render(<BottomNav nextCustomer={next({ reason: 'upcoming', minutesFromNow: 30 })} locale="ja" />)
    expect(screen.getByText('あと30分')).toBeInTheDocument()
  })

  it('renders the upcoming minutes hint (EN)', () => {
    render(<BottomNav nextCustomer={next({ reason: 'upcoming', minutesFromNow: 15 })} locale="en" />)
    expect(screen.getByText('in 15 min')).toBeInTheDocument()
  })

  it('shows no minutes hint for an in-session customer', () => {
    render(<BottomNav nextCustomer={next({ reason: 'in-session', minutesFromNow: -5 })} locale="ja" />)
    expect(screen.queryByText(/あと.*分/)).not.toBeInTheDocument()
  })
})
