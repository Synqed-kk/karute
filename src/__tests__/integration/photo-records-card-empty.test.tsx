/**
 * @jest-environment jsdom
 *
 * PhotoRecordsCard empty state (packet 2026-08-09 PR 9a §E). Karute-scoped
 * display means a real karute can legitimately have zero photos (its
 * session had none, or the linkage isn't stamped yet) — the section must not
 * silently vanish; it renders the card frame + a message pointing to the
 * customer profile for the aggregate view. next-intl mocked against the REAL
 * ja.json (repo convention, see photo-compare-view.test.tsx) so a missing
 * i18n key fails the suite instead of silently rendering the raw key.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur
      },
  }
})

import { PhotoRecordsCard } from '@/components/karute/redesign/detail/PhotoRecordsCard'

describe('PhotoRecordsCard — empty state', () => {
  it('zero photos → the empty message renders (card frame stays, section does not vanish)', () => {
    render(<PhotoRecordsCard photos={[]} />)
    expect(
      screen.getByText('このカルテに紐づく写真はまだありません。すべての写真は顧客プロフィールで確認できます。'),
    ).toBeInTheDocument()
    // The header (title/subtitle) still renders — this is the card frame, not nothing.
    expect(screen.getByText('写真記録')).toBeInTheDocument()
  })

  it('non-empty photos → the empty message does NOT render', () => {
    render(
      <PhotoRecordsCard
        photos={[{ id: 'p1', signedUrl: 'https://x/p1', category: 'before', caption: null }]}
      />,
    )
    expect(
      screen.queryByText('このカルテに紐づく写真はまだありません。すべての写真は顧客プロフィールで確認できます。'),
    ).toBeNull()
  })
})
