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

const listEl = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) => (
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
  />
)

const renderList = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) =>
  render(listEl(props))

/** The degraded signal page.tsx sends when the SERVER window read failed. */
const DEGRADED_PROPS: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {
  items: [],
  monthCount: null,
  total: null,
  initialWindowStart: null,
  initialHasMore: false,
}

const loadMoreButton = () =>
  screen.getByRole('button', { name: /loadMore/ })

beforeEach(() => {
  jest.clearAllMocks()
  // mockReset, not just clear: a pending-promise implementation set by one test
  // must not leak into the next one's default.
  loadKaruteWindow.mockReset()
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

  it('sends the RAW loaded count and the current boundary, and keeps focus on the button THROUGHOUT the fetch', async () => {
    // A PENDING promise, so the assertions below land mid-flight. Asserting
    // focus only after completion was false confidence: the pre-fix button
    // carried `disabled={loadingMore}`, and a browser BLURS a focused element
    // the instant it is disabled — focus was lost during the fetch and only
    // happened to look right once the attribute came back off.
    let resolveFetch: (v: unknown) => void = () => {}
    loadKaruteWindow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    renderList()
    const button = loadMoreButton()
    button.focus()
    fireEvent.click(button)

    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalled())
    expect(loadKaruteWindow).toHaveBeenCalledWith({
      olderThan: '2026-08-12',
      loadedCount: 2,
    })
    // MID-FLIGHT: busy is announced through aria-busy, never through the
    // native attribute, so there is nothing for the browser to blur.
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    expect(button).not.toBeDisabled()
    expect(document.activeElement).toBe(button)

    await act(async () => {
      resolveFetch({
        items: [item('k3', '2026-08-05')],
        windowStart: '2026-07-29',
        freshStoreTotal: 9,
        hasMore: true,
      })
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
    // role="alert" (fix round 2): a SILENT restore failure used to be visible
    // but never spoken — the announcement only ever fired on a manual tap.
    expect(screen.getByText('loadMoreFailed')).toHaveAttribute('role', 'alert')
    // A pre-fix loop would keep re-firing fetchOlder as loadingMore flips
    // true→false on every failed attempt; the fix clears restoreTarget so
    // the restore effect never re-triggers past this first failure.
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)
  })

  it('a manual tap failure shows ONE alert line; the next successful tap clears it', async () => {
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
    // EXACTLY ONE (fix round 2): the aria-live region carries loaded counts
    // only now, so a failed tap is no longer both shown inline AND echoed
    // through the live region — one failure, announced once.
    await waitFor(() => expect(screen.getByText('loadMoreFailed')).toBeInTheDocument())
    expect(screen.getAllByText('loadMoreFailed')).toHaveLength(1)
    // Button stays enabled for retry.
    expect(loadMoreButton()).not.toBeDisabled()

    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(loadMoreButton().textContent).toContain('7月29日'))
    expect(screen.queryAllByText('loadMoreFailed')).toHaveLength(0)
  })
})

// page.tsx signals a FAILED server window read as items=[] + total=null +
// initialWindowStart=null. Merging that empty `items` with the persisted
// `appended` chunks silently VANISHED the newest rows while older chunks stayed
// on screen — a failed background refresh reading as "those karute were
// deleted". The view latches the last NON-degraded `items` instead.
describe('degraded server window keeps what is already on screen (fix round 2)', () => {
  it('a failed refresh keeps every row that was showing, and says the refresh failed', async () => {
    loadKaruteWindow.mockResolvedValue({
      items: [item('k3', '2026-08-05', '鈴木 一郎')],
      windowStart: '2026-07-29',
      freshStoreTotal: 9,
      hasMore: true,
    })
    const view = renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())

    view.rerender(listEl(DEGRADED_PROPS))

    // Server-rendered first window AND the appended chunk both survive.
    expect(screen.getAllByText('山田 花子')).toHaveLength(2)
    expect(screen.getByText('鈴木 一郎')).toBeInTheDocument()
    // …and the header zone says so instead of showing stale numbers —
    // role="alert" so it is SPOKEN too: nothing on screen moved to signal the
    // freeze, so a screen-reader user would otherwise never learn of it.
    expect(screen.getByText('loadMoreFailed')).toBeInTheDocument()
    expect(screen.getByText('loadMoreFailed')).toHaveAttribute('role', 'alert')
    expect(screen.queryByText(/statusLine/)).not.toBeInTheDocument()
  })

  it('a healthy prop set takes over again — rows update, the failure line goes', async () => {
    const view = renderList()
    view.rerender(listEl(DEGRADED_PROPS))
    expect(screen.getByText('loadMoreFailed')).toBeInTheDocument()

    view.rerender(
      listEl({ items: [item('k1', '2026-08-20'), item('k9', '2026-08-21', '佐藤 次郎')] }),
    )
    expect(screen.getByText('佐藤 次郎')).toBeInTheDocument()
    expect(screen.queryByText('loadMoreFailed')).not.toBeInTheDocument()
    expect(screen.getByText(/statusLine/)).toBeInTheDocument()
  })

  it('a genuinely EMPTY store is NOT degraded — normal empty state, no failure line', () => {
    renderList({
      items: [],
      monthCount: 0,
      total: 0,
      initialWindowStart: '2026-08-12',
      initialHasMore: false,
    })
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByText('loadMoreFailed')).not.toBeInTheDocument()
    expect(screen.getByText(/statusLine/)).toBeInTheDocument()
  })
})

// Greptile PR #779 P1. `appended` is a client-held cache of the older chunks;
// a healthy refresh only ever replaces `items` (the newest window), so a record
// DELETED server-side lingered as a ghost row AND kept inflating loadedCount —
// which can flip hasMore false and hide さらに表示 while real history is still
// unloaded. A `total` lower than the one we hold is the purge signal.
describe('deleted rows reconcile on a healthy refresh (fix round 3)', () => {
  /** Tap さらに表示 once so `appended` holds a row the server later deletes. */
  const appendGhost = async (overrides = {}) => {
    loadKaruteWindow.mockResolvedValueOnce({
      items: [item('k3', '2026-08-05', '幽霊 太郎')],
      windowStart: '2026-07-29',
      freshStoreTotal: 9,
      hasMore: true,
      ...overrides,
    })
    const view = renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('幽霊 太郎')).toBeInTheDocument())
    return view
  }

  it('a LOWER total purges the cache and re-walks ?since with fresh data', async () => {
    const view = await appendGhost()
    // The re-walk's fresh read — the ghost is gone from the store, a real
    // older row takes its place.
    loadKaruteWindow.mockResolvedValueOnce({
      items: [item('k4', '2026-08-04', '鈴木 一郎')],
      windowStart: '2026-07-29',
      freshStoreTotal: 8,
      hasMore: true,
    })

    // QuietRefresh lands with one fewer record than we hold: 9 → 8.
    await act(async () => {
      view.rerender(listEl({ total: 8 }))
    })

    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(2))
    // The re-walk resumed from the server's FRESH first window, not from the
    // deep boundary — rewinding windowStart is what makes the restore effect
    // fetch at all instead of seeing itself as already done.
    expect(loadKaruteWindow).toHaveBeenNthCalledWith(2, {
      olderThan: '2026-08-12',
      loadedCount: 2,
    })
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    expect(screen.queryByText('幽霊 太郎')).not.toBeInTheDocument()
  })

  it('an UNCHANGED total leaves the cache alone — no purge, no refetch', async () => {
    const view = await appendGhost()
    await act(async () => {
      view.rerender(listEl({ total: 9 }))
    })
    // Still exactly the one append call: a refresh that changed nothing must
    // not cost a re-walk, or chunk loading pays for itself every few seconds.
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)
    expect(screen.getByText('幽霊 太郎')).toBeInTheDocument()
  })

  it('さらに表示 comes BACK after the purge when history really does remain', async () => {
    // Store of 4. Two rows on screen, one appended (the ghost) → 3 of 4.
    loadKaruteWindow.mockResolvedValueOnce({
      items: [item('k3', '2026-08-05', '幽霊 太郎')],
      windowStart: '2026-07-29',
      freshStoreTotal: 4,
      hasMore: true,
    })
    const view = renderList({ total: 4 })
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('幽霊 太郎')).toBeInTheDocument())

    loadKaruteWindow.mockResolvedValueOnce({
      items: [item('k4', '2026-08-04', '鈴木 一郎')],
      windowStart: '2026-07-29',
      freshStoreTotal: 4,
      hasMore: true,
    })
    // The ghost is deleted: 4 → 3. WITHOUT the purge, loadedCount would still
    // count it (3) against a store total of 3 — hasMore false, button gone,
    // and the genuinely unloaded older record unreachable.
    await act(async () => {
      view.rerender(listEl({ total: 3 }))
    })

    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    expect(loadMoreButton()).toBeInTheDocument()
  })
})

// The purge rewinds the walk, but fetchOlder's setters used to apply
// unconditionally — so a request already in flight when the purge fired landed
// afterwards and re-applied its stale boundary and rows over the rewound state,
// dropping the middle chunks until remount. A generation counter closes it.
describe('a purge invalidates an in-flight fetch (fix round 4)', () => {
  it('DISCARDS the superseded response instead of applying it over the rewound state', async () => {
    let resolveStale: (v: unknown) => void = () => {}
    loadKaruteWindow
      // Tap 1 lands normally — this is what puts a boundary in ?since, which
      // is what the purge re-seeds the restore walk with. Without a committed
      // boundary there is nothing to re-walk TO and the race can't be shown.
      .mockResolvedValueOnce({
        items: [item('k3', '2026-08-05', '幽霊 太郎')],
        windowStart: '2026-07-29',
        freshStoreTotal: 9,
        hasMore: true,
      })
      // Tap 2 hangs — this is the request the purge will supersede.
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve
          }),
      )
      // What the purge's re-walk gets: the store's real older row.
      .mockResolvedValue({
        items: [item('k4', '2026-08-04', '鈴木 一郎')],
        windowStart: '2026-07-29',
        freshStoreTotal: 8,
        hasMore: true,
      })

    const view = renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('幽霊 太郎')).toBeInTheDocument())
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(2))

    // A refresh with one fewer record purges + rewinds WHILE tap 2 is still
    // in flight.
    await act(async () => {
      view.rerender(listEl({ total: 8 }))
    })

    // Now the superseded response finally lands, carrying a boundary and a row
    // that no longer describe anything real.
    await act(async () => {
      resolveStale({
        items: [item('k99', '2026-06-01', '亡霊 花子')],
        windowStart: '2026-06-01',
        freshStoreTotal: 99,
        hasMore: true,
      })
    })

    // Not one setter from it took effect — and the purged ghost stayed purged.
    expect(screen.queryByText('亡霊 花子')).not.toBeInTheDocument()
    expect(screen.queryByText('幽霊 太郎')).not.toBeInTheDocument()
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(3))
    // THE decisive assertion: the re-walk resumed from the REWOUND boundary
    // with the purged count. Had the superseded response been applied,
    // windowStart would be 2026-06-01 and loadedCount 3 — the walk would
    // resume from the wrong place with a ghost still counted.
    expect(loadKaruteWindow).toHaveBeenNthCalledWith(3, {
      olderThan: '2026-08-12',
      loadedCount: 2,
    })
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    await waitFor(() => expect(loadMoreButton().textContent).toContain('7月29日'))
  })
})

// Greptile PR #779 P1 (round 7). The generation guard correctly discards a
// response the purge superseded — but on the user's FIRST tap `sinceParam` is
// still null, so the purge seeds restoreTarget with null and the restore effect
// exits without replaying. The tap produced nothing and said nothing: a dead
// tap. The existing retry line is the honest answer.
describe('a superseded FIRST tap says so instead of dying silently (fix round 7)', () => {
  /** Hang the tap, then purge mid-flight, then land the superseded response. */
  const supersedeInFlight = async () => {
    let resolveStale: (v: unknown) => void = () => {}
    loadKaruteWindow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        }),
    )
    const view = renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalled())
    await act(async () => {
      view.rerender(listEl({ total: 8 }))
    })
    await act(async () => {
      resolveStale({
        items: [item('k99', '2026-06-01', '亡霊 花子')],
        windowStart: '2026-06-01',
        freshStoreTotal: 99,
        hasMore: true,
      })
    })
    return view
  }

  it('discards the response AND shows the retry line — the tap is never silently swallowed', async () => {
    await supersedeInFlight()

    // The superseded payload never landed…
    expect(screen.queryByText('亡霊 花子')).not.toBeInTheDocument()
    // …and nothing replaced it, so the viewer is told to try again rather than
    // left staring at a button that appeared to do nothing.
    await waitFor(() => expect(screen.getByText('loadMoreFailed')).toBeInTheDocument())
    expect(screen.getByText('loadMoreFailed')).toHaveAttribute('role', 'alert')
    // No re-walk fired (restoreTarget was seeded null) — exactly one call.
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)
  })

  it('the next tap works and clears the line', async () => {
    await supersedeInFlight()
    await waitFor(() => expect(screen.getByText('loadMoreFailed')).toBeInTheDocument())

    loadKaruteWindow.mockResolvedValue({
      items: [item('k4', '2026-08-04', '鈴木 一郎')],
      windowStart: '2026-07-29',
      freshStoreTotal: 8,
      hasMore: true,
    })
    fireEvent.click(loadMoreButton())

    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    expect(screen.queryByText('loadMoreFailed')).not.toBeInTheDocument()
  })

  it('a superseded DEEP tap stays quiet — the re-walk is already fixing it', async () => {
    // A tap that lands FIRST commits a boundary to ?since. The next tap
    // therefore has sinceParam non-null, so the purge seeds a real restore
    // target and rows visibly come back — a failure line here would read as
    // "broken" while the list is in fact busy repairing itself.
    let resolveStale: (v: unknown) => void = () => {}
    loadKaruteWindow
      .mockResolvedValueOnce({
        items: [item('k3', '2026-08-05', '幽霊 太郎')],
        windowStart: '2026-07-29',
        freshStoreTotal: 9,
        hasMore: true,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve
          }),
      )
      .mockResolvedValue({
        items: [item('k4', '2026-08-04', '鈴木 一郎')],
        windowStart: '2026-07-29',
        freshStoreTotal: 8,
        hasMore: true,
      })

    const view = renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('幽霊 太郎')).toBeInTheDocument())
    fireEvent.click(loadMoreButton()) // deep tap — hangs
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(2))

    await act(async () => {
      view.rerender(listEl({ total: 8 }))
    })
    await act(async () => {
      resolveStale({
        items: [item('k99', '2026-06-01', '亡霊 花子')],
        windowStart: '2026-06-01',
        freshStoreTotal: 99,
        hasMore: true,
      })
    })

    expect(screen.queryByText('loadMoreFailed')).not.toBeInTheDocument()
    // The re-walk fired — a third call the purge seeded, not a dead end.
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
  })
})

// Greptile PR #779 P1 (round 8). The purge seeds the restore goal from
// `sinceParam` — but every landed window WRITES sinceParam, so mid-re-walk it
// holds an INTERMEDIATE, shallower boundary. A second purge arriving then used
// to adopt that intermediate value as the new goal, truncating the restoration:
// the viewer's deeper windows stayed gone until they tapped again. The goal now
// only ever deepens.
describe('a second purge mid-restore keeps the DEEPEST goal (fix round 8)', () => {
  it('resumes to the ORIGINAL depth instead of stopping at the intermediate boundary', async () => {
    let resolveStale: (v: unknown) => void = () => {}
    const win1 = {
      items: [item('k3', '2026-08-05', '幽霊 太郎')],
      windowStart: '2026-08-05',
      hasMore: true,
    }
    const win2 = {
      items: [item('k4', '2026-07-30', '鈴木 一郎')],
      windowStart: '2026-07-29',
      hasMore: true,
    }
    loadKaruteWindow
      // Two manual taps take the viewer down to 2026-07-29 — THE depth the
      // restoration has to get back to.
      .mockResolvedValueOnce({ ...win1, freshStoreTotal: 9 })
      .mockResolvedValueOnce({ ...win2, freshStoreTotal: 9 })
      // Purge 1's re-walk: window 1 lands, so sinceParam is now the SHALLOW
      // 2026-08-05 while the goal is still the deep 2026-07-29.
      .mockResolvedValueOnce({ ...win1, freshStoreTotal: 8 })
      // Purge 1's re-walk, window 2 — hangs, so purge 2 fires mid-restore.
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve
          }),
      )
      // Purge 2's re-walk, from the rewound boundary.
      .mockResolvedValueOnce({ ...win1, freshStoreTotal: 7 })
      .mockResolvedValue({ ...win2, freshStoreTotal: 7 })

    const view = renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('幽霊 太郎')).toBeInTheDocument())
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())

    // Purge 1: one record left the store. Rewind + re-walk toward 2026-07-29.
    await act(async () => {
      view.rerender(listEl({ total: 8 }))
    })
    // Wait for the re-walk to be MID-flight on its second window: call 3 landed
    // (sinceParam is now the intermediate 2026-08-05) and call 4 is hanging.
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(4))

    // Purge 2 lands right there, seeded from that intermediate boundary.
    await act(async () => {
      view.rerender(listEl({ total: 7 }))
    })
    await act(async () => {
      resolveStale({ ...win2, freshStoreTotal: 99 })
    })

    // THE decisive assertion: the second re-walk went TWO windows deep, not
    // one. With the goal truncated to 2026-08-05 the walk stops after call 5
    // and 鈴木 一郎 never comes back.
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(6))
    expect(loadKaruteWindow).toHaveBeenNthCalledWith(5, {
      olderThan: '2026-08-12',
      loadedCount: 2,
    })
    expect(loadKaruteWindow).toHaveBeenNthCalledWith(6, {
      olderThan: '2026-08-05',
      loadedCount: 3,
    })
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    expect(screen.getByText('幽霊 太郎')).toBeInTheDocument()
    // The walk reached its goal and stopped — no runaway seventh call.
    expect(loadKaruteWindow).toHaveBeenCalledTimes(6)
  })

  it('a purge with NO restore in flight still seeds from the live boundary', async () => {
    // The min must not make the goal STICKY: once a restore has finished,
    // restoreTarget is null again and the next purge seeds exactly what round 7
    // shipped — the boundary the viewer is actually sitting on.
    loadKaruteWindow.mockResolvedValue({
      items: [item('k3', '2026-08-05', '幽霊 太郎')],
      windowStart: '2026-08-05',
      freshStoreTotal: 9,
      hasMore: true,
    })
    const view = renderList()
    fireEvent.click(loadMoreButton())
    await waitFor(() => expect(screen.getByText('幽霊 太郎')).toBeInTheDocument())
    expect(loadKaruteWindow).toHaveBeenCalledTimes(1)

    await act(async () => {
      view.rerender(listEl({ total: 8 }))
    })

    // Exactly one re-walk window, aimed at the live 2026-08-05 boundary.
    await waitFor(() => expect(loadKaruteWindow).toHaveBeenCalledTimes(2))
    expect(loadKaruteWindow).toHaveBeenNthCalledWith(2, {
      olderThan: '2026-08-12',
      loadedCount: 2,
    })
    expect(loadKaruteWindow).toHaveBeenCalledTimes(2)
  })
})
