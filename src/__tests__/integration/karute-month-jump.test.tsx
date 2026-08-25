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

/** Pick 2026年1月 and let its rows land. */
const jumpToJanuary = async (rows: KaruteListItem[] = [item('j1', '2026-01-20', '一月 太郎')]) => {
  loadKaruteWindow.mockResolvedValue({
    items: rows,
    windowStart: '2026-01-01',
    freshStoreTotal: 9,
    hasMore: false,
  })
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
})

describe('picking a month', () => {
  it('fetches with {month} ALONE — no olderThan, no loadedCount', async () => {
    renderList()
    await jumpToJanuary()
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)
    expect(loadKaruteWindow).toHaveBeenCalledWith({ month: '2026-01' })
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
    let resolveFetch: (v: unknown) => void = () => {}
    loadKaruteWindow.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve }),
    )
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
    // Default view: label + count.
    expect(pill('all').textContent).toBe('filters.all3')
    await jumpToJanuary()
    expect(pill('all').textContent).toBe('filters.all')
    expect(pill('thisWeek').textContent).toBe('filters.thisWeek')
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
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)
    expect(monthChip().textContent).toBe(CURRENT_MONTH_LABEL)
    expect(screen.queryByText('一月 太郎')).not.toBeInTheDocument()
    // …and the tapped filter is the one now in force: every seeded row is
    // aiStatus 'summarized', so 下書き shows none of them while the pills
    // carry their counts again.
    expect(pill('draft')).toHaveAttribute('aria-pressed', 'true')
    expect(pill('all').textContent).toBe('filters.all3')
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
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)
    expect(monthChip().textContent).toBe(CURRENT_MONTH_LABEL)
    expect(screen.getAllByText('山田 花子')).toHaveLength(2)
    expect(pill('all').textContent).toBe('filters.all3')
    expect(loadMoreQuery()).toBeInTheDocument()
  })

  it('drops a month response that lands after the user already left', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    loadKaruteWindow.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve }),
    )
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
