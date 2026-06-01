/**
 * @jest-environment jsdom
 *
 * Render coverage for StatStrip / StatTile (PR #90/replay/16): value display,
 * the trend pill (sign + icon), and the null-value / unit handling.
 */
import { render, screen } from '@testing-library/react'

// Mirror the project-standard next-intl mock used by other client-component
// tests (bottom-nav, mobile-header) — returns the key as the label so the
// trend / value assertions below stay independent of translation copy.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { StatStrip, type StatStripData } from '@/components/dashboard/redesign/StatStrip'

function data(over: Partial<StatStripData> = {}): StatStripData {
  return {
    weeklyRecordings: { value: 12 },
    todaysCustomers: { value: 5 },
    monthlyKarute: { value: 40 },
    rebookingRate: { value: 60 },
    ...over,
  }
}

describe('StatStrip', () => {
  it('renders the core stat values', () => {
    render(<StatStrip stats={data()} />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
  })

  it('shows a positive trend pill with a + sign', () => {
    render(<StatStrip stats={data({ weeklyRecordings: { value: 12, trend: 8 } })} />)
    expect(screen.getByText(/\+8%/)).toBeInTheDocument()
  })

  it('shows a negative trend pill without a + sign', () => {
    render(<StatStrip stats={data({ weeklyRecordings: { value: 12, trend: -3 } })} />)
    expect(screen.getByText(/-3%/)).toBeInTheDocument()
  })

  it('omits the trend pill when no trend is provided', () => {
    render(<StatStrip stats={data()} />)
    // A trend pill renders a signed delta like "+8%" / "-3%"; the bare "%"
    // unit on the rebooking tile is a separate span and must not count.
    expect(screen.queryByText(/[+-]\d+/)).not.toBeInTheDocument()
  })

  it('renders an em dash for a null rebooking rate (no unit)', () => {
    render(<StatStrip stats={data({ rebookingRate: { value: null } })} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('respects a custom trendLabel', () => {
    render(
      <StatStrip
        stats={data({ rebookingRate: { value: 60, trend: 2, trendLabel: 'pp' } })}
      />,
    )
    expect(screen.getByText(/\+2pp/)).toBeInTheDocument()
  })
})
