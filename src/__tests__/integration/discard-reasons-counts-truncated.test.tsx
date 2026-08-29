/**
 * @jest-environment jsdom
 *
 * 破棄の記録 — the count tiles under truncation (P5-A polish round).
 *
 * The read caps at MAX_PAGES × PAGE_SIZE. Past that cap 今月の破棄 / 全件 and
 * the per-staff block are FLOORS, not totals — the action already says so with
 * `truncated`, but the number itself used to render as if it were complete,
 * with the qualifier sitting only under the LIST far below. ⚖ 8/25: a number
 * says what it counts, and a number that cannot say it is complete must say it
 * is not. Asserted against the real ja.json copy, so a missing key fails here.
 */
import { render, screen, waitFor } from '@testing-library/react'

function tFor(ns: string) {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  return (key: string, vals?: Record<string, unknown>) => {
    let cur: unknown = ja
    for (const part of `${ns}.${key}`.split('.'))
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
    return cur.replace(/\{(\w+)\}/g, (_m, name: string) => String(vals?.[name] ?? `{${name}}`))
  }
}

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => tFor(ns),
  useLocale: () => 'ja',
}))

const listDiscardReasons = jest.fn()
jest.mock('@/actions/recording-discards', () => ({
  listDiscardReasons: () => listDiscardReasons(),
}))

import { DiscardReasonsSection } from '@/components/settings/redesign/sections/DiscardReasonsSection'

const QUALIFIER = tFor('settings.discardReasons')('countsTruncated')

async function renderWith(truncated: boolean) {
  listDiscardReasons.mockResolvedValue({
    ok: true,
    truncated,
    rows: [
      {
        id: 'd1',
        recordingSessionId: 'rs-1',
        createdAt: '2026-08-20T02:00:00.000Z',
        staffId: 'staff-A',
        staffName: '原 奏恵',
        reason: 'お客様を間違えて録音を開始してしまいました',
      },
    ],
    counts: {
      thisMonth: 4000,
      total: 4000,
      byStaff: [{ staffId: 'staff-A', staffName: '原 奏恵', thisMonth: 4000 }],
    },
  })
  render(<DiscardReasonsSection />)
  // 今月の破棄 labels both the tile and the per-staff row — wait for the tile.
  await waitFor(() => expect(screen.getAllByText(/今月の破棄/).length).toBeGreaterThan(0))
}

describe('破棄の記録 — count tiles past the read cap', () => {
  it('says the counts exclude the older records, on the tiles themselves', async () => {
    await renderWith(true)

    // Both count surfaces carry it: the 今月/全件 tiles and the per-staff block.
    expect(screen.getAllByText(QUALIFIER)).toHaveLength(2)
    // …and it is NOT the list-level line standing in for it.
    expect(QUALIFIER).not.toBe(tFor('settings.discardReasons')('truncated'))
  })

  it('a complete read carries no qualifier (control)', async () => {
    await renderWith(false)

    expect(screen.queryByText(QUALIFIER)).toBeNull()
  })
})
