/**
 * @jest-environment jsdom
 *
 * Render coverage for PatternsMasteredList (PR 26, replay/26).
 * Real logic: bucketing modules into "mastered" (completionRate
 * >= 1) vs "in progress" (0 < rate < 1), the rounded percent +
 * progress-bar width, and per-subsection empty states.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'en',
}))

import { PatternsMasteredList } from '@/components/coaching/redesign/PatternsMasteredList'
import type { LearningModule } from '@/components/coaching/redesign/owner-types'

function mod(over: Partial<LearningModule> = {}): LearningModule {
  return {
    id: 'm1',
    title: 'モジュール',
    category: 'closing',
    durationMin: 10,
    ...over,
  }
}

describe('PatternsMasteredList', () => {
  it('renders the scaffold hint when no modules are supplied', () => {
    render(<PatternsMasteredList modules={null} />)
    expect(screen.getByText('masteredEmptyHint')).toBeInTheDocument()
  })

  it('buckets completed modules under mastered and partial ones under in-progress', () => {
    render(
      <PatternsMasteredList
        modules={[
          mod({ id: 'a', title: '完了モジュール', completionRate: 1 }),
          mod({ id: 'b', title: '進行中モジュール', completionRate: 0.5 }),
        ]}
      />,
    )
    expect(screen.getByText('完了モジュール')).toBeInTheDocument()
    expect(screen.getByText('進行中モジュール')).toBeInTheDocument()
    // 0.5 → 50% progress label/width.
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('rounds the in-progress percent and sets the bar width to match', () => {
    const { container } = render(
      <PatternsMasteredList
        modules={[mod({ id: 'c', title: '途中', completionRate: 0.337 })]}
      />,
    )
    // Math.round(0.337 * 100) = 34
    expect(screen.getByText('34%')).toBeInTheDocument()
    const bar = container.querySelector('div[style]') as HTMLElement | null
    expect(bar?.style.width).toBe('34%')
  })

  it('treats a 0 / undefined completionRate as neither mastered nor in-progress', () => {
    render(
      <PatternsMasteredList
        modules={[
          mod({ id: 'z', title: '未着手', completionRate: 0 }),
          mod({ id: 'u', title: '未定義' }),
        ]}
      />,
    )
    // Both subsection empty-state copies render (0 mastered, 0 in progress).
    expect(screen.getByText('masteredEmpty')).toBeInTheDocument()
    expect(screen.getByText('inProgressEmpty')).toBeInTheDocument()
    // The untracked modules are not listed.
    expect(screen.queryByText('未着手')).not.toBeInTheDocument()
    expect(screen.queryByText('未定義')).not.toBeInTheDocument()
  })
})
