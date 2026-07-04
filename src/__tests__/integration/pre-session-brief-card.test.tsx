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

describe('PreSessionBriefCard — reservation memo rendering', () => {
  it('renders a ▶-structured memo as labeled rows, omitting empty-value keys', () => {
    render(
      <PreSessionBriefCard
        customerName="test"
        brief={{
          ...base,
          reservationMemo: 'QR #328091 | ▶症状:肩こり▶ゴール:楽になりたい▶quick:',
        }}
      />,
    )
    // Mapped labels + values are shown as skimmable rows…
    expect(screen.getByText('症状・お悩み')).toBeInTheDocument()
    expect(screen.getByText('肩こり')).toBeInTheDocument()
    expect(screen.getByText('ゴール')).toBeInTheDocument()
    expect(screen.getByText('楽になりたい')).toBeInTheDocument()
    // …and the empty-value key ("quick:" with nothing after it) is omitted here.
    expect(screen.queryByText('quick')).not.toBeInTheDocument()
    // The raw memo blob is NOT rendered verbatim.
    expect(screen.queryByText(/▶症状:肩こり▶ゴール/)).not.toBeInTheDocument()
  })

  it('clamps the long 備考(参考) row behind a すべて表示 / 閉じる toggle', () => {
    const longNote = 'とても長い自由記述の備考テキストがここに入ります。'.repeat(4)
    render(
      <PreSessionBriefCard
        customerName="test"
        brief={{ ...base, reservationMemo: `▶症状:肩こり▶参考:${longNote}` }}
      />,
    )
    // The free-text value is present but clamped (line-clamp-2) until expanded.
    const value = screen.getByText(longNote)
    expect(value).toHaveClass('line-clamp-2')
    // Toggling removes the clamp; label flips show → collapse.
    fireEvent.click(screen.getByText('memoShowAll'))
    expect(screen.getByText(longNote)).not.toHaveClass('line-clamp-2')
    fireEvent.click(screen.getByText('memoCollapse'))
    expect(screen.getByText(longNote)).toHaveClass('line-clamp-2')
  })

  it('falls back to the verbatim single-paragraph render when there is no ▶ structure', () => {
    render(
      <PreSessionBriefCard
        customerName="test"
        brief={{ ...base, reservationMemo: '腰が痛いので優しめでお願いします' }}
      />,
    )
    // No labeled rows — the raw text renders exactly as the customer wrote it.
    expect(screen.getByText('腰が痛いので優しめでお願いします')).toBeInTheDocument()
    expect(screen.queryByText('memoShowAll')).not.toBeInTheDocument()
  })

  it('strips a stray leading colon from AI memo-analysis bullets', () => {
    render(
      <PreSessionBriefCard
        customerName="test"
        brief={{
          ...base,
          reservationMemo: '腰が痛い',
          memoAnalysis: ['：猫背改善中→反り腰に注意', '通常トーン'],
        }}
      />,
    )
    // The leading full-width colon is removed at render time…
    expect(screen.getByText('猫背改善中→反り腰に注意')).toBeInTheDocument()
    expect(screen.queryByText('：猫背改善中→反り腰に注意')).not.toBeInTheDocument()
    // …and a colon-free bullet is untouched.
    expect(screen.getByText('通常トーン')).toBeInTheDocument()
  })
})
