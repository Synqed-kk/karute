/**
 * @jest-environment jsdom
 *
 * Render coverage for two staff-dashboard cards (PR 26,
 * replay/26): NextFocusCard (empty vs item list) and
 * LearnFromTopCard (slice-to-3 cap + showSource gating of the
 * source staff name).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'en',
}))

import {
  NextFocusCard,
  type FocusRecommendation,
} from '@/components/coaching/redesign/NextFocusCard'
import {
  LearnFromTopCard,
  type TopPerformerPattern,
} from '@/components/coaching/redesign/LearnFromTopCard'

function focus(label: string): FocusRecommendation {
  return { label, description: `${label}の詳細` }
}

function pattern(over: Partial<TopPerformerPattern> = {}): TopPerformerPattern {
  return {
    id: 'p1',
    categoryLabel: 'クロージング',
    title: 'パターン',
    description: '説明',
    ...over,
  }
}

describe('NextFocusCard', () => {
  it('renders the scaffold hint when there are no recommendations', () => {
    render(<NextFocusCard focus={null} />)
    expect(screen.getByText('emptyHint')).toBeInTheDocument()
  })

  it('renders each recommendation label and description', () => {
    render(<NextFocusCard focus={[focus('深掘り質問'), focus('提案力')]} />)
    expect(screen.getByText('深掘り質問')).toBeInTheDocument()
    expect(screen.getByText('深掘り質問の詳細')).toBeInTheDocument()
    expect(screen.getByText('提案力')).toBeInTheDocument()
    expect(screen.queryByText('emptyHint')).not.toBeInTheDocument()
  })
})

describe('LearnFromTopCard', () => {
  it('renders the scaffold hint when there are no patterns', () => {
    render(<LearnFromTopCard patterns={null} />)
    expect(screen.getByText('emptyHint')).toBeInTheDocument()
  })

  it('caps the list at the first three patterns', () => {
    render(
      <LearnFromTopCard
        patterns={[
          pattern({ id: '1', title: '一番目' }),
          pattern({ id: '2', title: '二番目' }),
          pattern({ id: '3', title: '三番目' }),
          pattern({ id: '4', title: '四番目' }),
        ]}
      />,
    )
    expect(screen.getByText('一番目')).toBeInTheDocument()
    expect(screen.getByText('三番目')).toBeInTheDocument()
    // Fourth pattern is sliced off.
    expect(screen.queryByText('四番目')).not.toBeInTheDocument()
  })

  it('hides the source staff name by default (showSource defaults to false)', () => {
    render(
      <LearnFromTopCard
        patterns={[pattern({ id: 's', title: 'X', sourceStaffName: '山田' })]}
      />,
    )
    expect(screen.queryByText(/山田/)).not.toBeInTheDocument()
  })

  it('shows the source staff name when showSource is true', () => {
    render(
      <LearnFromTopCard
        showSource
        patterns={[pattern({ id: 's', title: 'X', sourceStaffName: '山田' })]}
      />,
    )
    expect(screen.getByText(/山田/)).toBeInTheDocument()
  })
})
