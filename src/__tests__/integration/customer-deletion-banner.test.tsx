/**
 * @jest-environment jsdom
 *
 * Render coverage for CustomerDeletionBanner (PR 19, replay/19): conditional
 * render gated on isScheduled, the days-remaining vs same-day title variants,
 * the amber→red urgency flip in the last 7 days, body/date interpolation, and
 * the undo button wiring through the real scheduled-deletions hooks
 * (localStorage-backed).
 *
 * next-intl is mocked so translation keys + vars are rendered verbatim; the
 * hooks themselves run for real against window.localStorage.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  useLocale: () => 'en',
}))

import { CustomerDeletionBanner } from '@/components/customers/redesign/CustomerDeletionBanner'

const STORAGE_KEY = 'synqed-karute-scheduled-deletions'
const DAY_MS = 24 * 60 * 60 * 1000

function schedule(customerId: string, scheduledAt: string) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      [customerId]: { customerId, scheduledAt, scheduledBy: 'staff-1' },
    }),
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('CustomerDeletionBanner', () => {
  it('renders nothing when the customer is not scheduled for deletion', () => {
    const { container } = render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the banner with the day-count title when scheduled', () => {
    // 20 days into the window → 10 days remaining.
    schedule('cust-1', new Date(Date.now() - 20 * DAY_MS).toISOString())
    render(<CustomerDeletionBanner customerId="cust-1" customerName="Aoi" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(
      screen.getByText('title:{"name":"Aoi","days":10}'),
    ).toBeInTheDocument()
  })

  it('uses the urgent (red) tone in the last 7 days of the window', () => {
    // 25 days in → 5 remaining → urgent.
    schedule('cust-1', new Date(Date.now() - 25 * DAY_MS).toISOString())
    render(<CustomerDeletionBanner customerId="cust-1" customerName="Aoi" />)
    expect(screen.getByRole('status').className).toContain('bg-red-50')
    expect(screen.getByRole('status').className).not.toContain('bg-amber-50')
  })

  it('uses the amber tone when more than 7 days remain', () => {
    schedule('cust-1', new Date(Date.now() - 5 * DAY_MS).toISOString())
    render(<CustomerDeletionBanner customerId="cust-1" customerName="Aoi" />)
    expect(screen.getByRole('status').className).toContain('bg-amber-50')
    expect(screen.getByRole('status').className).not.toContain('bg-red-50')
  })

  it('switches to the same-day title once the window has elapsed', () => {
    schedule('cust-1', new Date(Date.now() - 40 * DAY_MS).toISOString())
    render(<CustomerDeletionBanner customerId="cust-1" customerName="Aoi" />)
    expect(
      screen.getByText('titleToday:{"name":"Aoi"}'),
    ).toBeInTheDocument()
  })

  it('interpolates the hard-delete date and 30-day window into the body', () => {
    schedule('cust-1', '2026-01-01T00:00:00.000Z')
    render(<CustomerDeletionBanner customerId="cust-1" customerName="Aoi" />)
    // window=30 always; date is the +30d hard-delete date formatted via
    // toLocaleDateString('en-US'). The exact day depends on the runner's
    // timezone (Jan 30/31 UTC±), so assert the format, not a pinned day.
    const body = screen.getByText(/^body:/)
    expect(body.textContent).toContain('"window":30')
    expect(body.textContent).toMatch(/Jan 3[01], 2026/)
  })

  it('cancels the scheduled deletion when the undo button is clicked', () => {
    schedule('cust-1', new Date(Date.now() - 10 * DAY_MS).toISOString())
    render(<CustomerDeletionBanner customerId="cust-1" customerName="Aoi" />)
    fireEvent.click(screen.getByRole('button', { name: /undoButton/ }))
    // Storage cleared + banner unmounts itself (status now not-scheduled).
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{}')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
