/**
 * @jest-environment jsdom
 *
 * Display contract for the 本日のセッション card (2026-07-03 redesign):
 *  - treatment entries with a kind prefix (施術：/セルフケア指導：) render the kind
 *    ONCE as a sub-heading and the bullet WITHOUT the repeated prefix
 *  - body-part titles keep their 「◯◯：」 prefix (only the two kind prefixes strip)
 *  - preference entries get their own 好み chip (previously mis-shelved as 製品)
 *  - other/note entries render under a メモ chip
 * (next-intl is mocked to echo keys, per the repo's tsx-test convention — the
 * actual 好み/メモ labels live in messages/*.json.)
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import {
  CurrentSessionCard,
  type SessionEntry,
} from '@/components/karute/redesign/detail/CurrentSessionCard'

const e = (id: string, category: SessionEntry['category'], body: string): SessionEntry => ({
  id,
  category,
  time: '12:00',
  body,
})

function renderCard(entries: SessionEntry[]) {
  return render(<CurrentSessionCard sessionDate="June 30, 2026" entries={entries} />)
}

describe('CurrentSessionCard', () => {
  it('groups treatment entries by kind, stripping the repeated prefix', () => {
    renderCard([
      e('1', 'treatment', '施術：首の牽引'),
      e('2', 'treatment', 'セルフケア指導：ハムのストレッチは30〜40秒キープ'),
      e('3', 'treatment', 'セルフケア指導：先にローラーで筋肉を緩める'),
    ])
    expect(screen.getAllByText('セルフケア指導')).toHaveLength(1)
    expect(screen.getAllByText('施術')).toHaveLength(1)
    expect(screen.getByText('首の牽引')).toBeInTheDocument()
    expect(screen.getByText('ハムのストレッチは30〜40秒キープ')).toBeInTheDocument()
    expect(
      screen.queryByText('セルフケア指導：ハムのストレッチは30〜40秒キープ'),
    ).not.toBeInTheDocument()
  })

  it('keeps body-part prefixes intact (only kind prefixes strip)', () => {
    renderCard([e('1', 'concern', '左肩：3ヶ月前から挙上時に痛み')])
    expect(screen.getByText('左肩：3ヶ月前から挙上時に痛み')).toBeInTheDocument()
  })

  it('renders preference entries under their own chip, not 製品', () => {
    renderCard([e('1', 'preference', '圧は少し強めが好み')])
    expect(screen.getByText('currentSession.categories.preference')).toBeInTheDocument()
    expect(screen.queryByText('currentSession.categories.product')).not.toBeInTheDocument()
    expect(screen.getByText('圧は少し強めが好み')).toBeInTheDocument()
  })

  it('renders note entries under the note chip', () => {
    renderCard([e('1', 'note', '次回は同伴の妹さんも一緒に来店予定')])
    expect(screen.getByText('currentSession.categories.note')).toBeInTheDocument()
  })

  it('renders plain treatment entries without a kind sub-heading', () => {
    renderCard([e('1', 'treatment', '肩を回すと軽くなる')])
    expect(screen.getByText('肩を回すと軽くなる')).toBeInTheDocument()
    expect(screen.queryByText('施術')).not.toBeInTheDocument()
  })
})
