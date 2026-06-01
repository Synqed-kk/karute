/**
 * @jest-environment jsdom
 *
 * Render coverage for MonthlyGrowthCard (PR 26, replay/26): the
 * staff hero card. Logic worth asserting — em-dash placeholders +
 * scaffold footer when growth is null; real values, the signed
 * delta indicator, and the disappearance of the scaffold footer
 * once data is wired.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'en',
}))

import {
  MonthlyGrowthCard,
  type MonthlyGrowthData,
} from '@/components/coaching/redesign/MonthlyGrowthCard'

const wired: MonthlyGrowthData = {
  score: 78,
  delta: 5,
  sessionsAnalyzed: 12,
  patternsMastered: 4,
  patternsInProgress: 3,
}

describe('MonthlyGrowthCard — no data (scaffold)', () => {
  it('renders em-dash placeholders for the score and all three stats', () => {
    render(<MonthlyGrowthCard growth={null} />)
    // Score em-dash + three stat em-dashes = four placeholders.
    expect(screen.getAllByText('—')).toHaveLength(4)
  })

  it('shows the scaffold empty-state hint when growth is null', () => {
    render(<MonthlyGrowthCard growth={null} />)
    expect(screen.getByText('emptyHint')).toBeInTheDocument()
  })

  it('omits the delta indicator when there is no data', () => {
    render(<MonthlyGrowthCard growth={null} />)
    expect(screen.queryByText('vsLastMonth')).not.toBeInTheDocument()
  })
})

describe('MonthlyGrowthCard — wired data', () => {
  it('renders the score and the three stat values', () => {
    render(<MonthlyGrowthCard growth={wired} />)
    expect(screen.getByText('78')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('prefixes a positive delta with a + sign', () => {
    render(<MonthlyGrowthCard growth={wired} />)
    expect(screen.getByText('+5')).toBeInTheDocument()
  })

  it('renders a negative delta without a + sign', () => {
    render(<MonthlyGrowthCard growth={{ ...wired, delta: -2 }} />)
    expect(screen.getByText('-2')).toBeInTheDocument()
  })

  it('renders a zero delta as +0 (delta >= 0 branch)', () => {
    render(<MonthlyGrowthCard growth={{ ...wired, delta: 0 }} />)
    expect(screen.getByText('+0')).toBeInTheDocument()
  })

  it('hides the scaffold footer once growth is wired', () => {
    render(<MonthlyGrowthCard growth={wired} />)
    expect(screen.queryByText('emptyHint')).not.toBeInTheDocument()
    // No em-dash placeholders when every value is present.
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})
