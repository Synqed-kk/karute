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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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
  // A2-4: read only when a row is OPENED, which nothing here does.
  getDiscardTranscript: jest.fn(async () => ({ ok: true, segments: [], durationSeconds: null })),
}))

import { DiscardReasonsSection } from '@/components/settings/redesign/sections/DiscardReasonsSection'

const QUALIFIER = tFor('settings.discardReasons')('countsTruncated')
const LOAD_FAILED = tFor('settings.discardReasons')('loadFailed')
const LOADING = tFor('settings.discardReasons')('loading')
/** The shared 再試行, the same word ScreenStates' own error card uses — the
 *  phone already taught this label; the section reuses it rather than minting
 *  a second one for the same act. */
const RETRY = tFor('common')('retry')
const REASON = 'お客様を間違えて録音を開始してしまいました'

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

    // ONE count surface since the 8/31 redesign: the 今月/累計 line and the
    // per-staff line share a single summary band, so the qualifier belongs to
    // that band once. What is pinned is unchanged — a capped number never
    // stands on this screen without saying it is capped.
    expect(screen.getAllByText(QUALIFIER)).toHaveLength(1)
    // …and it is NOT the list-level line standing in for it.
    expect(QUALIFIER).not.toBe(tFor('settings.discardReasons')('truncated'))
  })

  it('a complete read carries no qualifier (control)', async () => {
    await renderWith(false)

    expect(screen.queryByText(QUALIFIER)).toBeNull()
  })
})

// The load effect used to be fulfillment-only. A server action can fail at the
// TRANSPORT layer — offline, a 500 from the action endpoint, a deploy landing
// mid-flight — and that REJECTS rather than resolving { ok: false }, so the
// screen sat on its spinner forever with the failure swallowed as an unhandled
// rejection. A failure is a failure: it gets the same honest state.
describe('破棄の記録 — the read failing at the transport layer', () => {
  it('a rejection renders the load-failed state, not an eternal spinner', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    try {
      listDiscardReasons.mockRejectedValue(new Error('network'))
      render(<DiscardReasonsSection />)

      await screen.findByText(LOAD_FAILED)
      expect(screen.queryByText(LOADING)).toBeNull()
      // …and the rejection was actually CONSUMED. Without this, the spinner
      // assertion alone could pass off a lucky render as handling. One
      // macrotask turn is what node needs to report an unhandled rejection.
      await new Promise((r) => setTimeout(r, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  // On the COMPUTER a failed load has the browser's reload behind it. On the
  // PHONE this section is a tab inside a shell that never reloads, so the only
  // recovery was leaving the tab and coming back — undiscoverable. Liam ruled
  // the affordance in (8/31): the error state says how to try again.
  it('the error state offers a retry, and taking it re-reads the ledger', async () => {
    listDiscardReasons.mockClear()
    listDiscardReasons.mockRejectedValueOnce(new Error('network'))
    render(<DiscardReasonsSection />)
    await screen.findByText(LOAD_FAILED)

    listDiscardReasons.mockResolvedValue({
      ok: true,
      truncated: false,
      rows: [
        {
          id: 'd1',
          recordingSessionId: 'rs-1',
          createdAt: '2026-08-20T02:00:00.000Z',
          staffId: 'staff-A',
          staffName: '原 奏恵',
          reason: REASON,
        },
      ],
      counts: { thisMonth: 1, total: 1, byStaff: [] },
    })
    await act(async () => {
      fireEvent.click(screen.getByText(RETRY))
    })

    // The SAME read the mount runs, once more — and the error state is gone,
    // not sitting under a list that loaded behind it.
    expect(listDiscardReasons).toHaveBeenCalledTimes(2)
    expect(screen.getByText(REASON)).toBeInTheDocument()
    expect(screen.queryByText(LOAD_FAILED)).toBeNull()
  })
})
