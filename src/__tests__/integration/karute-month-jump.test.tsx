/** @jest-environment jsdom */
/**
 * KaruteRecordListView's 月ジャンプ (PR-2b). Verifies:
 *   - the month chip fetches with {month} ALONE — no olderThan, no loadedCount:
 *     a month is read whole, it is not a resumed backward walk
 *   - the picked month SWAPS the list (rows replaced, not appended) and resets
 *     scroll to the top — the AuditLogSection content-swap idiom
 *   - the chip's label names what the list is showing
 *   - while a month is picked the filter pills show LABELS ONLY and さらに表示
 *     is gone
 *   - ANY pill tap leaves month view, carrying that filter into the default
 *     window (the decisive interaction — mutation-proofed)
 *   - picking the CURRENT month is the way back (⛔ no 「今月に戻る」 button)
 *   - the overlay closes on Escape (focus returns to the chip) and on focus
 *     leaving it
 *   - the offered range floors at the session-date epoch month and extends
 *     backward only as far as rows actually loaded
 *
 * next-intl is mocked to echo the key + its params, so the assertions name the
 * KEY that fired; the mock's verbatim wording is pinned in
 * karute-statusline-copy.test.ts. The month LABELS are real Intl output — the
 * chip renders a formatted date, not a message key.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'ja',
}))
const replace = jest.fn()
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, refresh: jest.fn() }),
  usePathname: () => '/ja/karute',
  Link: ({ children, ...rest }: { children?: React.ReactNode; href?: string }) => (
    <a {...rest}>{children}</a>
  ),
}))
let searchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => searchParams,
}))
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: () => null,
}))
const loadKaruteWindow = jest.fn()
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
  loadKaruteWindow: (...a: unknown[]) => loadKaruteWindow(...a),
}))

import { useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'

const item = (id: string, date: string, name = '山田 花子'): KaruteListItem => ({
  id,
  customerId: `c-${id}`,
  customerName: name,
  customerInitials: '山田',
  customerKaruteNumber: '#00001',
  date,
  weekday: '月',
  service: 'フェイシャル',
  duration: 60,
  staffId: 'staff-1',
  staffColorKey: null,
  staffName: '田中 太郎',
  summary: 'まとめ',
  aiStatus: 'summarized',
  conversionStatus: 'active',
  href: `/karute/${id}`,
})

/**
 * The JST month the component itself will call "current" — derived here with an
 * INDEPENDENT formatter rather than hardcoded, so these tests keep telling the
 * truth after the calendar moves past 2026-08. Everything asserted against a
 * FIXED month uses 2026-01 instead, reached through the data-driven floor.
 */
const CURRENT_MONTH = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
}).format(new Date())
const jaMonth = (month: string) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
  }).format(new Date(`${month}-01T00:00:00+09:00`))
const CURRENT_MONTH_LABEL = jaMonth(CURRENT_MONTH)
/** The row directly under the current month in the panel. */
const PREV_MONTH_LABEL = jaMonth(
  (() => {
    const y = Number(CURRENT_MONTH.slice(0, 4))
    const m = Number(CURRENT_MONTH.slice(5, 7))
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  })(),
)

/** An already-loaded row from 2026-01 drags the picker's floor back to that
 *  month (the walk has PROVEN karute exist there), so 「2026年1月」 is on the
 *  list whatever today's date is. */
const OLD_ROW = item('k-old', '2026-01-15', '古川 いにしえ')

const listEl = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) => (
  <KaruteRecordListView
    items={[item('k1', '2026-08-20'), item('k2', '2026-08-19'), OLD_ROW]}
    monthCount={2}
    total={9}
    initialWindowStart="2026-08-12"
    initialHasMore
    staffList={[]}
    currentStaffId={null}
    customerOptions={[]}
    {...props}
  />
)

const renderList = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) =>
  render(listEl(props))

/** The chip: the only <button> whose accessible name is a bare 「YYYY年M月」
 *  (the month rows inside the panel are role="option", not "button"). */
const monthChip = () => screen.getByRole('button', { name: /^\d{4}年\d{1,2}月$/ })
const openPanel = () => {
  fireEvent.click(monthChip())
  return screen.getByRole('listbox')
}
const pill = (key: string) => screen.getByRole('button', { name: new RegExp(`^filters\\.${key}`) })
const loadMoreQuery = () => screen.queryByRole('button', { name: /loadMore/ })

/**
 * Answer each created-month window separately. A month pick reads THREE — the
 * picked month's created-window plus its two neighbours — because the fetch
 * axis (created_at) and the display axis (session_date ?? created_at) are
 * different columns.
 */
const windowsByMonth = (byMonth: Record<string, KaruteListItem[]>) => {
  loadKaruteWindow.mockImplementation(async ({ month }: { month: string }) => ({
    items: byMonth[month] ?? [],
    windowStart: `${month}-01`,
    freshStoreTotal: 9,
    hasMore: false,
  }))
}

/** Pick 2026年1月 and let its rows land. */
const jumpToJanuary = async (rows: KaruteListItem[] = [item('j1', '2026-01-20', '一月 太郎')]) => {
  windowsByMonth({ '2026-01': rows })
  openPanel()
  await act(async () => {
    fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  loadKaruteWindow.mockReset()
  searchParams = new URLSearchParams()
})

describe('the month chip', () => {
  it('labels itself with the CURRENT month while nothing is picked', () => {
    renderList()
    expect(monthChip().textContent).toBe(CURRENT_MONTH_LABEL)
  })

  it('offers back to the session-date epoch month when no older row is loaded', () => {
    // No 2026-01 row here: the floor is the epoch (2026-07-01), so 2026年7月 is
    // the oldest month offered and 2026年6月 — which the app cannot reason
    // about as a session date — is not offered at all.
    renderList({ items: [item('k1', '2026-08-20')] })
    openPanel()
    expect(screen.getByRole('option', { name: '2026年7月' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '2026年6月' })).not.toBeInTheDocument()
  })

  it('extends the range back to the oldest row actually loaded', () => {
    renderList()
    openPanel()
    // The 2026-01 row proves karute exist that far back, so the range runs to
    // it — contiguously, with no dead 「…」 row standing in for the gap.
    expect(screen.getByRole('option', { name: '2026年1月' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2026年6月' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '2025年12月' })).not.toBeInTheDocument()
  })

  it('marks the month the list is showing as the selected option', () => {
    renderList()
    openPanel()
    expect(screen.getByRole('option', { name: CURRENT_MONTH_LABEL })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('paints the selected month with the R13 accent TOKENS, not literal blues', () => {
    // CLAUDE.md design law + accent-tier-contract's selected-row recipe
    // (Greptile PR #784 P2): a selected option is bg-primary/8 + text-primary,
    // so it follows the configured theme in both modes. Literal bg-blue-50
    // drifts — StaffSelector still carries it only because it predates the
    // retint.
    renderList()
    openPanel()
    const selected = screen.getByRole('option', { name: CURRENT_MONTH_LABEL })
    expect(selected.className).toContain('bg-primary/8')
    expect(selected.className).toContain('text-primary')
    expect(selected.className).not.toContain('bg-blue-50')
    // Never a solid accent fill on a selected STATE — that is reserved for the
    // commit action.
    expect(selected.className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
  })
})

describe('picking a month', () => {
  it('fetches the picked month WIDENED by ±1, each with {month} ALONE', async () => {
    renderList()
    await jumpToJanuary()
    // ±1 month because the fetch filters created_at while the list displays
    // session_date — a backdated karute sits in a neighbouring created-window.
    expect(loadKaruteWindow.mock.calls.map(([a]: [{ month: string }]) => a.month).sort()).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ])
    // Never an olderThan and never a loadedCount: a month is read whole, it is
    // not a resumed backward walk.
    for (const [arg] of loadKaruteWindow.mock.calls) {
      expect(Object.keys(arg)).toEqual(['month'])
    }
  })

  it('SWAPS the list instead of appending to it', async () => {
    renderList()
    await jumpToJanuary()
    await waitFor(() => expect(screen.getByText('一月 太郎')).toBeInTheDocument())
    // The default window's rows are GONE from the screen (not merged in) —
    // and still in state, which the return-to-current-month test proves.
    expect(screen.queryByText('山田 花子')).not.toBeInTheDocument()
    expect(screen.queryByText('古川 いにしえ')).not.toBeInTheDocument()
  })

  it('resets scroll to the top (content swap, unlike an append)', async () => {
    const { container } = renderList()
    const scroller = container.parentElement!
    scroller.scrollTop = 420
    await jumpToJanuary()
    expect(scroller.scrollTop).toBe(0)
  })

  it('renames the chip to the picked month', async () => {
    renderList()
    await jumpToJanuary()
    expect(monthChip().textContent).toBe('2026年1月')
  })

  it('says the rows are LOADING rather than calling the month empty', async () => {
    // ONE shared pending promise for all three window reads — a per-call
    // promise would leave two of them unresolved and hang the Promise.all.
    let resolveFetch: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => { resolveFetch = resolve })
    loadKaruteWindow.mockImplementation(() => pending)
    renderList()
    openPanel()
    fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    // MID-FLIGHT: 「カルテはまだありません」 would report a load as a fact.
    await waitFor(() => expect(screen.getByText('loading')).toBeInTheDocument())
    expect(screen.queryByText('empty')).not.toBeInTheDocument()
    await act(async () => {
      resolveFetch({ items: [], windowStart: '2026-01-01', freshStoreTotal: 9, hasMore: false })
    })
    // A month that genuinely has none now says so.
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('surfaces a failed month read instead of an empty month', async () => {
    loadKaruteWindow.mockResolvedValue({ error: 'upstream' })
    renderList()
    openPanel()
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('loadMoreFailed')
    expect(screen.queryByText('empty')).not.toBeInTheDocument()
  })
})

describe('while a month is picked', () => {
  it('shows filter pills as LABELS ONLY', async () => {
    renderList()
    // Default view: label + count. すべて is the store total (PR-2c); the rest
    // count rows. Asserted as "carries A number" rather than a literal one —
    // the seeded rows have fixed dates, so pinning 今週 here would rot the day
    // this file's fixtures age out of the week. Its exact value is pinned
    // against the tap in karute-chunk-load.test.tsx, which is that count's home.
    expect(pill('all').textContent).toBe('filters.all9')
    expect(pill('thisWeek').textContent).toMatch(/^filters\.thisWeek\d+$/)
    await jumpToJanuary()
    // Inside a month EVERY count drops: the row-counting pills would count that
    // month alone (今週 reads 0 in any past month), and すべて names the whole
    // store, which is not the month on screen either.
    expect(pill('all').textContent).toBe('filters.all')
    expect(pill('thisWeek').textContent).toBe('filters.thisWeek')
    expect(pill('draft').textContent).toBe('filters.draft')
  })

  it('hides さらに表示 — a month is fetched whole', async () => {
    renderList()
    expect(loadMoreQuery()).toBeInTheDocument()
    await jumpToJanuary()
    expect(loadMoreQuery()).not.toBeInTheDocument()
  })

  it('keeps the search box filtering INSIDE the month', async () => {
    renderList()
    await jumpToJanuary([
      item('j1', '2026-01-20', '一月 太郎'),
      item('j2', '2026-01-18', '二月 花子'),
    ])
    fireEvent.change(screen.getByPlaceholderText('searchPlaceholder'), {
      target: { value: '二月' },
    })
    expect(screen.getByText('二月 花子')).toBeInTheDocument()
    expect(screen.queryByText('一月 太郎')).not.toBeInTheDocument()
  })
})

describe('leaving month view', () => {
  it('ANY pill tap returns to the default window WITH that filter applied', async () => {
    renderList()
    await jumpToJanuary()
    expect(monthChip().textContent).toBe('2026年1月')

    fireEvent.click(pill('draft'))

    // Back in the default window: the accumulated rows are on screen again,
    // straight out of state — no refetch.
    expect(loadKaruteWindow).toHaveBeenCalledTimes(3)
    expect(monthChip().textContent).toBe(CURRENT_MONTH_LABEL)
    expect(screen.queryByText('一月 太郎')).not.toBeInTheDocument()
    // …and the tapped filter is the one now in force: every seeded row is
    // aiStatus 'summarized', so 下書き shows none of them while the pills
    // carry their counts again.
    expect(pill('draft')).toHaveAttribute('aria-pressed', 'true')
    expect(pill('all').textContent).toBe('filters.all9')
    expect(screen.queryByText('山田 花子')).not.toBeInTheDocument()

    fireEvent.click(pill('all'))
    expect(screen.getAllByText('山田 花子')).toHaveLength(2)
    expect(loadMoreQuery()).toBeInTheDocument()
  })

  it('picking the CURRENT month is the way back — no fetch, no 「今月に戻る」', async () => {
    renderList()
    await jumpToJanuary()
    openPanel()
    fireEvent.click(screen.getByRole('option', { name: CURRENT_MONTH_LABEL }))

    // The default window is restored from state — the current month is NEVER
    // fetched as a month (that would strip the counts and the button off a
    // screen the user thinks they just came back to).
    expect(loadKaruteWindow).toHaveBeenCalledTimes(3)
    expect(monthChip().textContent).toBe(CURRENT_MONTH_LABEL)
    expect(screen.getAllByText('山田 花子')).toHaveLength(2)
    expect(pill('all').textContent).toBe('filters.all9')
    expect(loadMoreQuery()).toBeInTheDocument()
  })

  it('drops a month response that lands after the user already left', async () => {
    // ONE shared pending promise for all three window reads — a per-call
    // promise would leave two of them unresolved and hang the Promise.all.
    let resolveFetch: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => { resolveFetch = resolve })
    loadKaruteWindow.mockImplementation(() => pending)
    renderList()
    openPanel()
    fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    // Leave before the rows land.
    fireEvent.click(pill('all'))
    await act(async () => {
      resolveFetch({
        items: [item('j1', '2026-01-20', '一月 太郎')],
        windowStart: '2026-01-01',
        freshStoreTotal: 9,
        hasMore: false,
      })
    })
    // The superseded chunk describes a state that no longer exists.
    expect(screen.queryByText('一月 太郎')).not.toBeInTheDocument()
    expect(screen.getAllByText('山田 花子')).toHaveLength(2)
  })
})

describe('fetch axis vs display axis (Greptile PR #784)', () => {
  // The engine filters created_at; the list displays session_date ?? created_at.
  // The month view has to be true about the month the user PICKED, which is the
  // display axis — so it reads the neighbouring created-windows too and then
  // filters on what it will actually show.

  it('SHOWS a karute created in the next month but dated INTO the picked one', async () => {
    // Written Feb 2, session Jan 28: the January created-window never sees it.
    const backdated = item('backdated', '2026-01-28', '遡り 記子')
    windowsByMonth({
      '2026-01': [item('j1', '2026-01-20', '一月 太郎')],
      '2026-02': [backdated],
    })
    renderList()
    openPanel()
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    })
    expect(screen.getByText('遡り 記子')).toBeInTheDocument()
    expect(screen.getByText('一月 太郎')).toBeInTheDocument()
  })

  it('HIDES a karute created in the picked month but dated OUT of it', async () => {
    // Written Jan 30, session Feb 2: the January created-window returns it, but
    // it is displayed in February and has no business in the January view.
    windowsByMonth({
      '2026-01': [item('j1', '2026-01-20', '一月 太郎'), item('stray', '2026-02-02', '越境 迷子')],
    })
    renderList()
    openPanel()
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    })
    expect(screen.queryByText('越境 迷子')).not.toBeInTheDocument()
    expect(screen.getByText('一月 太郎')).toBeInTheDocument()
    // 表示中 counts what SURVIVED the display filter, so the header cannot
    // promise a row the list does not show.
    expect(screen.getByText(/statusLine/).textContent).toContain('"showingCount":1')
  })

  it('DEDUPES a row two created-windows both return', async () => {
    const shared = item('j1', '2026-01-20', '一月 太郎')
    windowsByMonth({ '2026-01': [shared], '2026-02': [shared], '2025-12': [shared] })
    renderList()
    openPanel()
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    })
    expect(screen.getAllByText('一月 太郎')).toHaveLength(1)
  })

  it('reports a FAILED neighbour window as a failed month, not a short one', async () => {
    loadKaruteWindow.mockImplementation(async ({ month }: { month: string }) =>
      month === '2026-02'
        ? { error: 'upstream' }
        : { items: [item('j1', '2026-01-20', '一月 太郎')], windowStart: `${month}-01`, freshStoreTotal: 9, hasMore: false },
    )
    renderList()
    openPanel()
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    })
    // An incomplete month served as a list would read as the truth.
    expect(screen.getByRole('alert').textContent).toBe('loadMoreFailed')
    expect(screen.queryByText('一月 太郎')).not.toBeInTheDocument()
  })
})

describe('store switch (Greptile PR #784)', () => {
  // The switcher runs setActiveStore() + router.refresh(), which RE-PROPS this
  // component instead of remounting it — so the store lens is what has to tell
  // it that everything it holds belongs to the previous store.

  it('drops month rows when the active store changes', async () => {
    const { rerender } = render(listEl({ storeId: 'store-a' }))
    await jumpToJanuary()
    expect(screen.getByText('一月 太郎')).toBeInTheDocument()

    await act(async () => {
      rerender(listEl({ storeId: 'store-b' }))
    })

    // Store A's month rows are gone, and the view is back on the default
    // window the new store's props carry.
    expect(screen.queryByText('一月 太郎')).not.toBeInTheDocument()
    expect(monthChip().textContent).toBe(CURRENT_MONTH_LABEL)
    // すべて is the STORE total since PR-2c, not a tally of the rows on screen
    // — so this now asserts something STRONGER than it did when it read 3: the
    // pill is showing the NEW store's total, which is precisely what this
    // block's `setStoreTotal(total)` exists to guarantee ("the header numbers
    // describe the STORE"). Store A's total lingering here would be the bug.
    expect(pill('all').textContent).toBe('filters.all9')
  })

  it('never COMMITS a frame carrying ANY of the old store state (frame-probed)', async () => {
    // The act-flushed assertions above pass either way — they only see the
    // SETTLED DOM. A layout effect runs after commit but BEFORE paint and
    // before passive effects, so a probe there observes exactly the frames the
    // browser would have shown. Anything reset a tick late shows up here.
    const seen: string[] = []
    function Probe() {
      useLayoutEffect(() => {
        seen.push(document.body.textContent ?? '')
      })
      return null
    }
    const tree = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>>) => (
      <>
        {listEl(props)}
        <Probe />
      </>
    )
    const { rerender } = render(tree({ storeId: 'store-a' }))
    await jumpToJanuary()
    expect(screen.getByText('一月 太郎')).toBeInTheDocument()
    // Also arm a さらに表示 failure, so the retry line is on screen at switch
    // time and any late clear of it would show up in a frame too.
    loadKaruteWindow.mockResolvedValue({ error: 'upstream' })
    fireEvent.click(pill('all'))
    await act(async () => {
      fireEvent.click(loadMoreQuery()!)
    })
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)

    seen.length = 0
    await act(async () => {
      rerender(
        tree({
          storeId: 'store-b',
          items: [item('b1', '2026-08-18', 'ビー 花子')],
          total: 3,
          monthCount: 1,
          initialWindowStart: '2026-08-01',
        }),
      )
    })

    expect(seen.length).toBeGreaterThan(0)
    for (const frame of seen) {
      // Store A's rows…
      expect(frame).not.toContain('一月 太郎')
      expect(frame).not.toContain('山田 花子')
      // …its 全件 (the status line echoes the params it was given)…
      expect(frame).not.toContain('"total":9')
      // …the すべて PILL, which reads that same store total since PR-2c and so
      // became a second surface this frame guarantee has to cover (the status
      // line's `"total":9` check above cannot see it — the pill renders a bare
      // 「filters.all9」)…
      expect(frame).not.toContain('filters.all9')
      // …and its retry line.
      expect(frame).not.toContain('loadMoreFailed')
    }
    // 今週 needs no frame check of its own, and no store-switch reset either:
    // it counts `allItems` through a cutoff that is pure date arithmetic (see
    // thisWeekCutoffYmd — no store input, recomputed every render). The store
    // dimension lives entirely in the ROWS, and every frame above is already
    // asserted free of store A's rows, so a stale 今週 is unreachable.
    // Store B's own truth is what landed.
    expect(screen.getByText(/statusLine/).textContent).toContain('"total":3')
  })

  it('resets the picker floor — store A\'s depth never stretches store B\'s months', async () => {
    // The floor only ever extends BACKWARD (so a purge can't yank months out
    // of an open picker), which is exactly why it has to be reset here: store
    // A's 2026-01 row is no evidence about store B, and offering that month
    // would break the invariant the floor exists to hold — every month listed
    // is either inside the reasoned range or provably has karute behind it.
    const openLabels = () => {
      fireEvent.click(monthChip())
      const labels = screen.getAllByRole('option').map((o) => o.textContent)
      fireEvent.keyDown(document, { key: 'Escape' })
      return labels
    }
    const { rerender } = render(
      // Store A has a January karute loaded, dragging its floor back.
      listEl({ storeId: 'store-a', items: [item('a1', '2026-08-20'), OLD_ROW] }),
    )
    expect(openLabels()).toContain('2026年1月')

    // Store B is shallow: its newest window only reaches August.
    await act(async () => {
      rerender(
        listEl({
          storeId: 'store-b',
          items: [item('b1', '2026-08-18', 'ビー 花子')],
          total: 3,
          monthCount: 1,
          initialWindowStart: '2026-08-01',
        }),
      )
    })

    const bLabels = openLabels()
    expect(bLabels).not.toContain('2026年1月')
    // Floored at the session-date epoch month, exactly as on a fresh mount.
    expect(bLabels).toContain('2026年7月')
    expect(bLabels).not.toContain('2026年6月')
  })

  it('does NOT walk the new store back to the old store\'s reading depth', async () => {
    // ?since remembers how deep the viewer had scrolled. That is a position in
    // store A; replaying it against store B would silently fetch months of
    // history nobody asked for, one window at a time. The same goal must
    // SURVIVE a purge though (same store re-reading itself) — that half is
    // pinned by karute-chunk-load's restore tests, which stay green precisely
    // because this reset lives in the switch block and not the shared rewind.
    searchParams = new URLSearchParams('since=2026-07-29')
    windowsByMonth({})
    loadKaruteWindow.mockResolvedValue({
      items: [item('k3', '2026-08-05')],
      windowStart: '2026-07-29',
      freshStoreTotal: 9,
      hasMore: true,
    })
    const { rerender } = render(listEl({ storeId: 'store-a' }))
    // Store A replays to the remembered boundary.
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalled())
    loadKaruteWindow.mockClear()
    replace.mockClear()

    await act(async () => {
      rerender(
        listEl({
          storeId: 'store-b',
          items: [item('b1', '2026-08-18', 'ビー 花子')],
          total: 3,
          monthCount: 1,
          initialWindowStart: '2026-08-01',
        }),
      )
    })

    // No auto-walk into store B's history…
    expect(loadKaruteWindow).not.toHaveBeenCalled()
    // …and the remembered boundary is dropped from the URL rather than left
    // pointing the next reload back down there.
    const lastUrl = String(replace.mock.calls.at(-1)?.[0] ?? '')
    expect(lastUrl).not.toContain('since')
  })

  it('clears a さらに表示 failure line across the switch', async () => {
    loadKaruteWindow.mockResolvedValue({ error: 'upstream' })
    const { rerender } = render(listEl({ storeId: 'store-a' }))
    await act(async () => {
      fireEvent.click(loadMoreQuery()!)
    })
    expect(screen.getAllByRole('alert').map((n) => n.textContent)).toContain('loadMoreFailed')

    await act(async () => {
      rerender(listEl({ storeId: 'store-b', items: [], total: 3, initialWindowStart: '2026-08-01' }))
    })
    // Store A's failure has nothing to say about store B.
    expect(screen.queryAllByRole('alert')).toEqual([])
  })

  it('resets the staff filter on a store switch but KEEPS it across a purge', async () => {
    // Two different resets with two different meanings. The roster is
    // per-store (#496), so a filter pinned to store A's stylist matches nobody
    // in store B — but a purge is only a data refresh under the SAME lens, and
    // silently dropping the viewer's chosen staff there would be a bug of its
    // own.
    const staffList = [{ id: 'staff-1', name: '田中 太郎', initials: '田中' }]
    const props = { staffList, currentStaffId: 'staff-1' }
    const selfToggle = () => screen.getByRole('button', { name: 'self' })
    const { rerender } = render(listEl({ storeId: 'store-a', ...props }))

    fireEvent.click(selfToggle())
    expect(selfToggle()).toHaveAttribute('aria-pressed', 'true')

    // PURGE — same store, a total that came back lower.
    await act(async () => {
      rerender(listEl({ storeId: 'store-a', ...props, total: 1 }))
    })
    expect(selfToggle()).toHaveAttribute('aria-pressed', 'true')

    // STORE SWITCH — different lens, different roster.
    await act(async () => {
      rerender(listEl({ storeId: 'store-b', ...props, total: 1 }))
    })
    expect(selfToggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('drops a month response still in flight across the switch', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => { resolveFetch = resolve })
    loadKaruteWindow.mockImplementation(() => pending)
    const { rerender } = render(listEl({ storeId: 'store-a' }))
    openPanel()
    fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))

    await act(async () => {
      rerender(listEl({ storeId: 'store-b' }))
    })
    await act(async () => {
      resolveFetch({
        items: [item('j1', '2026-01-20', '一月 太郎')],
        windowStart: '2026-01-01',
        freshStoreTotal: 9,
        hasMore: false,
      })
    })

    // Store A's rows must not paint over store B's list.
    expect(screen.queryByText('一月 太郎')).not.toBeInTheDocument()
    expect(screen.getAllByText('山田 花子')).toHaveLength(2)
  })
})

describe('the overlay', () => {
  it('closes on Escape and hands focus back to the chip', () => {
    renderList()
    openPanel()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(monthChip())
  })

  it('ignores an Escape delivered mid-IME-conversion', () => {
    renderList()
    openPanel()
    // 変換-cancel belongs to the input method, not to this panel.
    fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('closes when focus leaves it', () => {
    renderList()
    const panel = openPanel()
    fireEvent.focusOut(panel, {
      relatedTarget: screen.getByPlaceholderText('searchPlaceholder'),
    })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('STAYS open when focus moves within it', () => {
    renderList()
    const panel = openPanel()
    fireEvent.focusOut(panel, {
      relatedTarget: screen.getByRole('option', { name: '2026年7月' }),
    })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('STAYS open on a focusout that goes nowhere focusable', () => {
    // A tap on the panel's own title, or the window losing focus — the
    // outside-pointerdown handler is what judges those, and closing here would
    // collapse the panel under a touch that never left it.
    renderList()
    const panel = openPanel()
    fireEvent.focusOut(panel, { relatedTarget: null })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('closes on an outside pointerdown', () => {
    renderList()
    openPanel()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens focused on the month the list is showing, and arrows walk the list', () => {
    renderList()
    openPanel()
    const current = screen.getByRole('option', { name: CURRENT_MONTH_LABEL })
    expect(document.activeElement).toBe(current)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('option', { name: PREV_MONTH_LABEL }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(current)
  })
})
