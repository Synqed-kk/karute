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

const MIN = 60_000
// Fixed "now" so the live countdown (Date.now-based) is deterministic.
const FIXED = new Date('2026-05-31T06:00:00.000Z').getTime()

// upcoming booking that starts `mins` from FIXED (60-min duration).
function upcoming(mins: number, over: Partial<NextCustomerInfo> = {}): NextCustomerInfo {
  return {
    customerId: 'c1',
    customerName: '田中',
    startTime: new Date(FIXED + mins * MIN).toISOString(),
    endTime: new Date(FIXED + (mins + 60) * MIN).toISOString(),
    reason: 'upcoming',
    minutesFromNow: mins,
    ...over,
  }
}

// in-session booking with `remaining` minutes left (started 60-remaining ago).
function inSession(remaining: number, over: Partial<NextCustomerInfo> = {}): NextCustomerInfo {
  const elapsed = 60 - remaining
  return {
    customerId: 'c1',
    customerName: '田中',
    startTime: new Date(FIXED - elapsed * MIN).toISOString(),
    endTime: new Date(FIXED + remaining * MIN).toISOString(),
    reason: 'in-session',
    minutesFromNow: -elapsed,
    ...over,
  }
}

beforeEach(() => {
  mockPathname = '/dashboard'
  jest.spyOn(Date, 'now').mockReturnValue(FIXED)
})
afterEach(() => {
  jest.restoreAllMocks()
})

describe('BottomNav center button', () => {
  it('shows the scaffold "pick booking" label when there is no next customer', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    expect(screen.getByText('pickBooking')).toBeInTheDocument()
  })

  it('shows the customer name with the JA honorific 様', () => {
    render(<BottomNav nextCustomer={upcoming(30, { customerName: '田中' })} locale="ja" />)
    expect(screen.getByText('田中様')).toBeInTheDocument()
  })

  it('omits the honorific in English', () => {
    render(<BottomNav nextCustomer={upcoming(30, { customerName: 'Tanaka' })} locale="en" />)
    expect(screen.getByText('Tanaka')).toBeInTheDocument()
  })

  it('renders a live upcoming countdown (JA)', () => {
    render(<BottomNav nextCustomer={upcoming(30)} locale="ja" />)
    expect(screen.getByText('あと30分')).toBeInTheDocument()
  })

  it('renders a live upcoming countdown (EN)', () => {
    render(<BottomNav nextCustomer={upcoming(15)} locale="en" />)
    expect(screen.getByText('in 15 min')).toBeInTheDocument()
  })

  it('shows remaining time for an in-session customer (JA) — not an "あと" arrival hint', () => {
    render(<BottomNav nextCustomer={inSession(5)} locale="ja" />)
    expect(screen.getByText('残り5分')).toBeInTheDocument()
    // The confusing "arriving in 5 min" framing must NOT be used mid-session.
    expect(screen.queryByText('あと5分')).not.toBeInTheDocument()
  })

  it('shows remaining time for an in-session customer (EN)', () => {
    render(<BottomNav nextCustomer={inSession(20)} locale="en" />)
    expect(screen.getByText('20 min left')).toBeInTheDocument()
  })

  it('shows a "wrapping up" hint in the last minute of a session', () => {
    render(<BottomNav nextCustomer={inSession(1)} locale="ja" />)
    expect(screen.getByText('まもなく終了')).toBeInTheDocument()
  })

  it('shows no time hint once the booking has ended', () => {
    // started 90m ago, 60m booking → ended 30m ago.
    const ended = inSession(-30)
    render(<BottomNav nextCustomer={ended} locale="ja" />)
    expect(screen.getByText('田中様')).toBeInTheDocument()
    expect(screen.queryByText(/分|終了|left|min/)).not.toBeInTheDocument()
  })
})
