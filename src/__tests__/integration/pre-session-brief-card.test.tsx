/**
 * @jest-environment jsdom
 *
 * Display contract for the 30-second brief redesign (2026-07-03):
 *  - opener / cautions / today-actions lead the card; classic recap sections
 *    fold behind the 詳しい経過 toggle
 *  - pre-v7 briefs (no new fields) render the classic layout unchanged
 *  - rhythm badge only when today's gap clearly deviates from the usual
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}))

import {
  PreSessionBriefCard,
  type PreSessionBrief,
} from '@/components/karute/redesign/record/PreSessionBriefCard'

const base: PreSessionBrief = {
  isFirstTimeVisit: false,
  lastVisitDate: '2026年6月30日',
  lastVisitAgo: '3日前',
  hooks: [{ title: '愛犬パグ', body: '最近飼い始めた' }],
  concerns: ['姿勢由来の首・肩・腰の張り'],
  lastProduct: null,
  recommendedFocus: '姿勢改善を重点的に。',
  reservationMemo: null,
}

describe('PreSessionBriefCard (30-second layer)', () => {
  it('leads with opener/cautions/actions and folds the classic recap', () => {
    render(
      <PreSessionBriefCard
        customerName="ぴあそん りえむ"
        brief={{
          ...base,
          opener: 'パグちゃん、その後どうですか？',
          lastWords: '『人生で一番効いてる』',
          cautions: ['右手首：プレート・釘あり（抜去不可）'],
          todayActions: ['宿題のハムストレッチの実施状況を確認', '姿勢のアライメント調整'],
        }}
      />,
    )
    expect(screen.getByText('パグちゃん、その後どうですか？')).toBeInTheDocument()
    expect(screen.getByText(/『人生で一番効いてる』/)).toBeInTheDocument()
    expect(screen.getByText('右手首：プレート・釘あり（抜去不可）')).toBeInTheDocument()
    expect(screen.getByText('宿題のハムストレッチの実施状況を確認')).toBeInTheDocument()
    // Classic recap folded: the concerns section is not rendered until toggled.
    expect(screen.queryByText('姿勢由来の首・肩・腰の張り')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('detailShow'))
    expect(screen.getByText('姿勢由来の首・肩・腰の張り')).toBeInTheDocument()
  })

  it('renders the classic layout unchanged when the new fields are absent', () => {
    render(<PreSessionBriefCard customerName="test" brief={base} />)
    expect(screen.getByText('姿勢由来の首・肩・腰の張り')).toBeVisible()
    expect(screen.queryByText('detailShow')).not.toBeInTheDocument()
    expect(screen.queryByText('opener')).not.toBeInTheDocument()
  })

  it('drops a hook that restates the opener (layer-contract seat belt)', () => {
    render(
      <PreSessionBriefCard
        customerName="test"
        brief={{
          ...base,
          opener: '筋トレ再開したそうですね。調子はいかがですか？',
          todayActions: ['宿題のハムストレッチの実施状況を確認'],
          hooks: [
            {
              title: '筋トレ再開',
              body: '数ヶ月ぶりに筋トレを再開したそうですね。調子はいかがですか？',
            },
            { title: '愛犬パグ', body: '最近飼い始めた' },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByText('detailShow'))
    // The opener consumed 筋トレ再開 — only the unconsumed topic survives.
    expect(screen.queryByText('筋トレ再開')).not.toBeInTheDocument()
    expect(screen.getByText('愛犬パグ')).toBeInTheDocument()
  })

  it('orders the expanded detail history-first when the 30-second layer exists', () => {
    render(
      <PreSessionBriefCard
        customerName="test"
        brief={{
          ...base,
          opener: '最近いかがですか？',
          todayActions: ['姿勢のアライメント調整'],
        }}
      />,
    )
    fireEvent.click(screen.getByText('detailShow'))
    const concern = screen.getByText('姿勢由来の首・肩・腰の張り')
    const hook = screen.getByText('愛犬パグ')
    expect(concern.compareDocumentPosition(hook) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the rhythm badge only on a clear deviation', () => {
    const { rerender } = render(
      <PreSessionBriefCard
        customerName="test"
        brief={{ ...base, rhythm: { daysSince: 3, usualGapDays: 7 } }}
      />,
    )
    expect(screen.getByText('rhythmEarly:3')).toBeInTheDocument()

    rerender(
      <PreSessionBriefCard
        customerName="test"
        brief={{ ...base, rhythm: { daysSince: 7, usualGapDays: 7 } }}
      />,
    )
    expect(screen.queryByText(/rhythm/)).not.toBeInTheDocument()
  })
})
