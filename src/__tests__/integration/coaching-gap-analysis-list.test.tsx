/**
 * @jest-environment jsdom
 *
 * Render coverage for GapAnalysisList (PR 26, replay/26): the
 * owner-side categorical gap list. Logic worth asserting — empty
 * scaffold vs populated, per-item category + summary rendering,
 * and the priority→label branch (high/medium/low→stable).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'en',
}))

import { GapAnalysisList } from '@/components/coaching/redesign/GapAnalysisList'
import type { CategoricalInsight } from '@/components/coaching/redesign/owner-types'

function insight(over: Partial<CategoricalInsight> = {}): CategoricalInsight {
  return {
    id: 'i1',
    staffId: 's1',
    category: '質問の深さ',
    summary: 'もう一歩踏み込んだ質問を。',
    gapFromTopPerformerPct: 18,
    priority: 'high',
    suggestedPatternIds: [],
    ...over,
  }
}

describe('GapAnalysisList', () => {
  it('renders the empty scaffold hint with no insights', () => {
    render(<GapAnalysisList insights={null} />)
    expect(screen.getByText('gapEmptyHint')).toBeInTheDocument()
  })

  it('renders the category and summary for each insight', () => {
    render(
      <GapAnalysisList
        insights={[
          insight({ id: 'a', category: '質問の深さ', summary: '深掘りを。' }),
          insight({ id: 'b', category: 'クロージング', summary: '提案を明確に。' }),
        ]}
      />,
    )
    expect(screen.getByText('質問の深さ')).toBeInTheDocument()
    expect(screen.getByText('深掘りを。')).toBeInTheDocument()
    expect(screen.getByText('クロージング')).toBeInTheDocument()
    expect(screen.getByText('提案を明確に。')).toBeInTheDocument()
  })

  it('maps each priority to its distinct label key', () => {
    render(
      <GapAnalysisList
        insights={[
          insight({ id: 'h', priority: 'high' }),
          insight({ id: 'm', priority: 'medium' }),
          insight({ id: 'l', priority: 'low' }),
        ]}
      />,
    )
    expect(screen.getByText('gapPriorityHigh')).toBeInTheDocument()
    expect(screen.getByText('gapPriorityMedium')).toBeInTheDocument()
    // 'low' falls through to the "stable" label.
    expect(screen.getByText('gapPriorityStable')).toBeInTheDocument()
  })
})
