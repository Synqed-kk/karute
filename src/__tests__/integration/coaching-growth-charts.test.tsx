/**
 * @jest-environment jsdom
 *
 * Render coverage for the two coaching SVG line charts (PR 26,
 * replay/26): GrowthProgressChart (staff Layer-1) and
 * GrowthTrajectoryChart (staff drill-down Layer-2). Both compute
 * point geometry from a score series and fall back to a
 * ScaffoldHint when no points are supplied. We assert the
 * data/empty branch and that every point's score label renders.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'en',
}))

import { GrowthProgressChart } from '@/components/coaching/redesign/GrowthProgressChart'
import { GrowthTrajectoryChart } from '@/components/coaching/redesign/GrowthTrajectoryChart'

describe('GrowthProgressChart', () => {
  it('renders the empty scaffold hint when no points are supplied', () => {
    render(<GrowthProgressChart points={null} />)
    // No chart SVG (role="img"); just the scaffold hint copy. (A
    // PrivacyLockBadge lucide icon is always present, so query the
    // chart by its role rather than any <svg>.)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('chartEmptyHint')).toBeInTheDocument()
  })

  it('renders the empty scaffold hint for an empty array', () => {
    render(<GrowthProgressChart points={[]} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('chartEmptyHint')).toBeInTheDocument()
  })

  it('renders an SVG with one score label per point when data is present', () => {
    render(
      <GrowthProgressChart
        points={[
          { month: '2026-01', score: 60 },
          { month: '2026-02', score: 72 },
          { month: '2026-03', score: 81 },
        ]}
      />,
    )
    expect(screen.getByText('60')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('81')).toBeInTheDocument()
  })

  it('plots one circle marker per data point', () => {
    const { container } = render(
      <GrowthProgressChart
        points={[
          { month: '2026-01', score: 50 },
          { month: '2026-02', score: 55 },
        ]}
      />,
    )
    expect(container.querySelectorAll('circle')).toHaveLength(2)
  })
})

describe('GrowthTrajectoryChart', () => {
  it('renders the pre-localized title and empty hint with no data', () => {
    render(<GrowthTrajectoryChart title="花子さんの成長推移" points={null} />)
    expect(screen.getByText('花子さんの成長推移')).toBeInTheDocument()
    expect(screen.getByText('chartEmptyHint')).toBeInTheDocument()
  })

  it('renders score labels and a marker per point when data is present', () => {
    const { container } = render(
      <GrowthTrajectoryChart
        title="花子さんの成長推移"
        points={[
          { month: '2026-04', score: 40 },
          { month: '2026-05', score: 90 },
        ]}
      />,
    )
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
    expect(container.querySelectorAll('circle')).toHaveLength(2)
    // The chart's accessible label is the passed-in title.
    expect(screen.getByRole('img', { name: '花子さんの成長推移' })).toBeInTheDocument()
  })
})
