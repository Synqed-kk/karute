/** @jest-environment jsdom */
/**
 * KaruteRecordListView's 日付チャンク読み込み behaviour (PR-2a). Verifies:
 *   - さらに表示 keys on loadedCount (RAW rows), NEVER on the filtered
 *     showingCount — a narrow filter must not look like the end of history
 *   - an append DEDUPES by id (offset paging over live data repeats rows)
 *   - the append announcement fires on aria-live, and focus STAYS on the button
 *   - an append does NOT reset scroll (the AuditLogSection content-swap reset
 *     is deliberately not wired to appends)
 *   - ?since restores the loaded boundary on mount, replaying through the SAME
 *     load path until the remembered day is reached
 *
 * next-intl is mocked to echo the key + its params so a test can assert both
 * WHICH key fired and WHAT it was told (the exact wording is pinned in
 * karute-statusline-copy.test.ts).
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

const renderList = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) =>
  render(
    <KaruteRecordListView
      items={[item('k1', '2026-08-20'), item('k2', '2026-08-19')]}
      monthCount={2}
      total={9}
      initialWindowStart="2026-08-12"
      initialHasMore
      staffList={[]}
      currentStaffId={null}
      customerOptions={[]}
      {...props}
    />,
  )

const loadMoreButton = () =>
  screen.getByRole('button', { name: /loadMore/ })

beforeEach(() => {
  jest.clearAllMocks()
  searchParams = new URLSearchParams()
})

describe('さらに表示 visibility keys on loadedCount, never showingCount', () => {
  it('shows while raw loaded rows are fewer than the store total', () => {
    renderList()
    expect(loadMoreButton()).toBeInTheDocument()
    // The label names the boundary the next chunk starts from.
    expect(loadMoreButton().textContent).toContain('8月12日')
  })

  it('STAYS visible when a filter narrows the visible rows to zero', () => {
    renderList()
    fireEvent.change(screen.getByPlaceholderText('searchPlaceholder'), {
      target: { value: 'この名前は存在しない' },
    })
    // 表示中 is 0, loadedCount is still 2 of 9 — history is not exhausted.
    expect(loadMoreButton()).toBeInTheDocument()
  })

  it('hides once every store row is loaded (loadedCount === total)', () => {
    renderList({ total: 2 })
    expect(screen.queryByRole('button', { name: /loadMore/ })).not.toBeInTheDocument()
  })

  it('STAYS hidden when everything is loaded AND a filter narrows the view', () => {
    // The observable difference between the two counts: keying on showingCount
    // resurrects the button after a filter, offering to fetch history that is
    // already fully loaded.
    renderList({ total: 2 })
    fireEvent.change(screen.getByPlaceholderText('searchPlaceholder'), {
      target: { value: 'この名前は存在しない' },
    })
    expect(screen.queryByRole('button', { name: /loadMore/ })).not.toBeInTheDocument()
  })

  it('hides when the window read failed (no boundary to walk from)', () => {
    renderList({ initialWindowStart: null })
    expect(screen.queryByRole('button', { name: /loadMore/ })).not.toBeInTheDocument()
  })
})

describe('append', () => {
  it('DEDUPES a row the server repeats across the page boundary', async () => {
    loadKaruteWindow.mockResolvedValue({
      // k2 is already on screen — offset paging over live data repeats it.
      items: [item('k2', '2026-08-19'), item('k3', '2026-08-05', '鈴木 一郎')],
      windowStart: '2026-07-29',
      freshStoreTotal: 9,
      hasMore: true,
    })
    renderList()
    fireEvent.click(loadMoreButton())

    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    // One 山田 row per id, not two: k2 collapsed instead of double-rendering.
    expect(screen.getAllByText('山田 花子')).toHaveLength(2)
    // …and the announcement counts only what was actually ADDED.
    expect(screen.getByText('addedCount:{"n":1}')).toBeInTheDocument()
  })

  it('sends the RAW loaded count and the current boundary, and keeps focus on the button', async () => {
    loadKaruteWindow.mockResolvedValue({
      items: [item('k3', '2026-08-05')],
      windowStart: '2026-07-29',
      freshStoreTotal: 9,
      hasMore: true,
    })
    renderList()
    const button = loadMoreButton()
    button.focus()
    fireEvent.click(button)

    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalled())
    expect(loadKaruteWindow).toHaveBeenCalledWith({
      olderThan: '2026-08-12',
      loadedCount: 2,
    })
    await waitFor(() => expect(loadMoreButton().textContent).toContain('7月29日'))
    expect(document.activeElement).toBe(loadMoreButton())
  })

  it('does NOT reset scroll — an append lands below the viewport', async () => {
    loadKaruteWindow.mockResolvedValue({
      items: [item('k3', '2026-08-05')],
      windowStart: '2026-07-29',
      freshStoreTotal: 9,
      hasMore: true,
    })
    const { container } = renderList()
    const scroller = container.parentElement!
    scroller.scrollTop = 420
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalled())
    expect(scroller.scrollTop).toBe(420)
  })

  it('an errored chunk leaves the list and the boundary untouched', async () => {
    loadKaruteWindow.mockResolvedValue({ error: 'upstream' })
    renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalled())
    expect(loadMoreButton().textContent).toContain('8月12日')
    expect(screen.queryByText(/addedCount/)).not.toBeInTheDocument()
  })

  it('adopts the FRESH store total from the response (hasMore never rides a snapshot)', async () => {
    loadKaruteWindow.mockResolvedValue({
      items: [item('k3', '2026-08-05')],
      windowStart: '2026-07-29',
      // Two more karute were saved elsewhere between taps.
      freshStoreTotal: 11,
      hasMore: true,
    })
    renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() =>
      expect(screen.getByText(/statusLine:/).textContent).toContain('"total":11'),
    )
  })
})

describe('?since boundary', () => {
  it('restores the loaded boundary on mount, replaying chunks until it is reached', async () => {
    searchParams = new URLSearchParams('since=2026-07-15')
    loadKaruteWindow
      .mockResolvedValueOnce({
        items: [item('k3', '2026-08-05')],
        windowStart: '2026-07-29',
        freshStoreTotal: 9,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [item('k4', '2026-07-20')],
        windowStart: '2026-07-15',
        freshStoreTotal: 9,
        hasMore: true,
      })
    await act(async () => {
      renderList()
    })
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(2))
    expect(loadKaruteWindow).toHaveBeenNthCalledWith(2, {
      olderThan: '2026-07-29',
      loadedCount: 3,
    })
    // Restore stops AT the remembered day — it never over-walks.
    await waitFor(() => expect(loadMoreButton().textContent).toContain('7月15日'))
    // A silent restore does not announce; only a deliberate tap does.
    expect(screen.queryByText(/addedCount/)).not.toBeInTheDocument()
  })

  it('does not fetch anything when ?since is absent', async () => {
    await act(async () => {
      renderList()
    })
    expect(loadKaruteWindow).not.toHaveBeenCalled()
  })

  it('writes the new boundary to ?since on tap (never debounced)', async () => {
    loadKaruteWindow.mockResolvedValue({
      items: [item('k3', '2026-08-05')],
      windowStart: '2026-07-29',
      freshStoreTotal: 9,
      hasMore: true,
    })
    renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() =>
      expect(replace.mock.calls.some(([url]) => String(url).includes('since=2026-07-29'))).toBe(
        true,
      ),
    )
  })

  it('the retired pager param `p` is actively dropped from the URL', () => {
    searchParams = new URLSearchParams('p=3')
    // window.location is what the URL effect reads from.
    window.history.replaceState({}, '', '/ja/karute?p=3')
    renderList()
    expect(replace.mock.calls.every(([url]) => !String(url).includes('p=3'))).toBe(true)
  })
})

describe('load-failure display (fix round 1)', () => {
  it('a failed ?since restore fetches ONCE and shows the failure line — the retry loop is broken', async () => {
    searchParams = new URLSearchParams('since=2026-07-15')
    loadKaruteWindow.mockResolvedValue({ error: 'upstream' })
    await act(async () => {
      renderList()
    })
    await waitFor(() => expect(screen.getByText('loadMoreFailed')).toBeInTheDocument())
    // A pre-fix loop would keep re-firing fetchOlder as loadingMore flips
    // true→false on every failed attempt; the fix clears restoreTarget so
    // the restore effect never re-triggers past this first failure.
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)
  })

  it('a manual tap failure shows the retry line; the next successful tap clears it', async () => {
    loadKaruteWindow
      .mockResolvedValueOnce({ error: 'upstream' })
      .mockResolvedValueOnce({
        items: [item('k3', '2026-08-05')],
        windowStart: '2026-07-29',
        freshStoreTotal: 9,
        hasMore: true,
      })
    renderList()
    fireEvent.click(loadMoreButton())
    // A manual tap announces too (announce=true), so the same string renders
    // BOTH as the visible inline line and the aria-live echo — getAllByText,
    // not getByText, on purpose.
    await waitFor(() => expect(screen.getAllByText('loadMoreFailed').length).toBeGreaterThan(0))
    // Button stays enabled for retry.
    expect(loadMoreButton()).not.toBeDisabled()

    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(loadMoreButton().textContent).toContain('7月29日'))
    expect(screen.queryAllByText('loadMoreFailed')).toHaveLength(0)
  })
})
