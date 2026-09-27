/** @jest-environment jsdom */
/**
 * S46 LEG 1a — BEHAVIOUR PARITY for the カルテ tab's staff control swap (the
 * single 担当 chip → the shared 自分 | 全スタッフ ⌄ control, option C). With
 * 「全スタッフ」 picked, everything the list QUERIES and SHOWS must be exactly
 * what origin/main 1d75bed96 produced for the same fixture: the rows on screen
 * (and the empty state when there are none), the words row's counts, every
 * loadKaruteWindow call's arguments (さらに表示, a month pick, 共有), every URL
 * the writer replaced to, and the remembered-pick storage.
 *
 * EXPECTED values were captured by running this same capture against
 * origin/main's KaruteRecordListView (before any S46 edit) — they are that
 * build's output, pasted literally, not hand-derived. The month chip's LABEL is
 * deliberately not captured (option C changes it by design; its own tests pin
 * it).
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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'

const item = (id: string, date: string, staffId: string, over: Partial<KaruteListItem> = {}): KaruteListItem => ({
  id,
  customerId: `c-${id}`,
  customerName: `顧客 ${id}`,
  customerInitials: '顧',
  customerKaruteNumber: '#00001',
  date,
  weekday: '月',
  service: 'カット',
  duration: 60,
  staffId,
  staffColorKey: null,
  staffName: staffId,
  summary: 'まとめ',
  aiStatus: 'summarized',
  conversionStatus: 'active',
  href: `/karute/${id}`,
  ...over,
})

const STAFF = [
  { id: 'staff-1', name: '田中 太郎', initials: '田中' },
  { id: 'staff-2', name: '鈴木 友梨佳', initials: '鈴木' },
  { id: 'staff-3', name: '勘解由小路美和子', initials: '勘解' },
]

const ITEMS = [
  item('k1', '2026-08-20', 'staff-1'),
  item('k2', '2026-08-20', 'staff-2', { aiStatus: 'pending' }),
  item('k3', '2026-08-19', 'staff-3', { aiStatus: 'draft' }),
  item('k4', '2026-08-18', 'staff-2', { isDiscarded: true }),
  item('k5', '2026-08-17', 'staff-9'),
  item('k6', '2026-08-16', 'staff-1', { isShared: true }),
]

const renderList = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) =>
  render(
    <KaruteRecordListView
      items={ITEMS}
      monthCount={6}
      total={20}
      discardedCount={1}
      initialWindowStart="2026-08-12"
      initialHasMore
      staffList={STAFF}
      currentStaffId="staff-1"
      customerOptions={[]}
      sharedCount={3}
      viewerHoldsViewShared
      {...props}
    />,
  )

function capture(container: HTMLElement) {
  const list = container.querySelector('main > div.mt-4')!
  const rows = [...list.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
  return {
    rows,
    listText: rows.length ? null : list.textContent,
    words: [...container.querySelectorAll('[data-words-row] button')].map((b) => b.textContent),
    urls: replace.mock.calls.map(([u]) => String(u)),
    loads: loadKaruteWindow.mock.calls.map((c) => c[0]),
    storage: Object.keys(window.localStorage)
      .sort()
      .map((k) => [k, window.localStorage.getItem(k)]),
  }
}

beforeEach(() => {
  searchParams = new URLSearchParams()
  replace.mockClear()
  loadKaruteWindow.mockReset()
  window.localStorage.clear()
})

it('mount with 全スタッフ (no URL param, nothing remembered)', () => {
  const { container } = renderList()
  expect(capture(container)).toEqual(EXPECTED.mount)
})

it('mount with 全スタッフ and NO roster', () => {
  const { container } = renderList({ staffList: [], currentStaffId: null })
  expect(capture(container)).toEqual(EXPECTED.noRoster)
})

it('さらに表示 under 全スタッフ', async () => {
  loadKaruteWindow.mockResolvedValue({
    items: [item('k7', '2026-08-05', 'staff-2'), item('k8', '2026-08-04', 'staff-9')],
    windowStart: '2026-07-29',
    freshStoreTotal: 20,
    hasMore: true,
  })
  const { container } = renderList()
  fireEvent.click(screen.getByRole('button', { name: /loadMore/ }))
  await waitFor(() => expect(container.querySelector('a[href="/karute/k8"]')).not.toBeNull())
  expect(capture(container)).toEqual(EXPECTED.loadMore)
})

it('a month pick under 全スタッフ', async () => {
  loadKaruteWindow.mockImplementation(async ({ month }: { month: string }) => ({
    items: month === '2026-08' ? [item('m1', '2026-08-03', 'staff-3'), item('m2', '2026-08-02', 'staff-9')] : [],
    windowStart: null,
    freshStoreTotal: 20,
    hasMore: false,
  }))
  const { container } = renderList()
  fireEvent.click(container.querySelector('[data-chip-row] button')!)
  fireEvent.click(screen.getByRole('option', { name: '2026年8月' }))
  await waitFor(() => expect(container.querySelector('a[href="/karute/m1"]')).not.toBeNull())
  expect(capture(container)).toEqual(EXPECTED.month)
})

it('共有 under 全スタッフ', async () => {
  loadKaruteWindow.mockResolvedValue({
    items: [item('s1', '2026-08-10', 'staff-3', { isShared: true })],
    windowStart: '2026-08-01',
    freshStoreTotal: 20,
    sharedCount: 3,
    hasMore: false,
  })
  const { container } = renderList()
  fireEvent.click(screen.getByRole('button', { name: /^filters\.shared/ }))
  await waitFor(() => expect(container.querySelector('a[href="/karute/s1"]')).not.toBeNull())
  expect(capture(container)).toEqual(EXPECTED.shared)
})

it('破棄済み under 全スタッフ', () => {
  const { container } = renderList()
  fireEvent.click(screen.getByRole('button', { name: /^filters\.discarded/ }))
  expect(capture(container)).toEqual(EXPECTED.discarded)
})

it('the empty states under 全スタッフ — an empty store, and a word with no rows', () => {
  const empty = renderList({ items: [], total: 0, discardedCount: 0 })
  expect(capture(empty.container)).toEqual(EXPECTED.emptyStore)
  empty.unmount()
  replace.mockClear()
  const { container } = renderList({ items: [item('k1', '2026-08-20', 'staff-1')], total: 1, discardedCount: 0 })
  fireEvent.click(screen.getByRole('button', { name: /^filters\.draft/ }))
  expect(capture(container)).toEqual(EXPECTED.emptyWord)
})

it('an explicit ?s=all link and a remembered 全スタッフ read the same', () => {
  searchParams = new URLSearchParams('s=all')
  const a = renderList()
  expect(capture(a.container)).toEqual(EXPECTED.urlAll)
  a.unmount()
  replace.mockClear()
  searchParams = new URLSearchParams()
  window.localStorage.setItem('karute:staffScope:records:staff-1', 'all')
  const b = renderList()
  expect(capture(b.container)).toEqual(EXPECTED.rememberedAll)
})

// ── origin/main 1d75bed96's output (captured, pasted) ───────────────────────
const EXPECTED: Record<string, unknown> = {
  "mount": {
    "rows": [
      "/karute/k1",
      "/karute/k2",
      "/karute/k3",
      "/karute/k5",
      "/karute/k6"
    ],
    "listText": null,
    "words": [
      "filters.all21",
      "filters.thisWeek0",
      "filters.aiPending1",
      "filters.draft1",
      "filters.discarded1",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute"
    ],
    "loads": [],
    "storage": []
  },
  "noRoster": {
    "rows": [
      "/karute/k1",
      "/karute/k2",
      "/karute/k3",
      "/karute/k5",
      "/karute/k6"
    ],
    "listText": null,
    "words": [
      "filters.all21",
      "filters.thisWeek0",
      "filters.aiPending1",
      "filters.draft1",
      "filters.discarded1",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute"
    ],
    "loads": [],
    "storage": []
  },
  "loadMore": {
    "rows": [
      "/karute/k1",
      "/karute/k2",
      "/karute/k3",
      "/karute/k5",
      "/karute/k6",
      "/karute/k7",
      "/karute/k8"
    ],
    "listText": null,
    "words": [
      "filters.all20",
      "filters.thisWeek0",
      "filters.aiPending1",
      "filters.draft1",
      "filters.discarded1",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute",
      "/ja/karute",
      "/ja/karute?since=2026-07-29"
    ],
    "loads": [
      {
        "olderThan": "2026-08-12",
        "loadedCount": 6
      }
    ],
    "storage": []
  },
  "month": {
    "rows": [
      "/karute/m1",
      "/karute/m2"
    ],
    "listText": null,
    "words": [
      "filters.all",
      "filters.thisWeek",
      "filters.aiPending",
      "filters.draft",
      "filters.discarded",
      "filters.shared"
    ],
    "urls": [
      "/ja/karute",
      "/ja/karute",
      "/ja/karute"
    ],
    "loads": [
      {
        "month": "2026-07"
      },
      {
        "month": "2026-08"
      },
      {
        "month": "2026-09"
      }
    ],
    "storage": []
  },
  "shared": {
    "rows": [
      "/karute/s1"
    ],
    "listText": null,
    "words": [
      "filters.all21",
      "filters.thisWeek0",
      "filters.aiPending1",
      "filters.draft1",
      "filters.discarded1",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute",
      "/ja/karute",
      "/ja/karute"
    ],
    "loads": [
      {
        "sharedOnly": true
      }
    ],
    "storage": []
  },
  "discarded": {
    "rows": [],
    "listText": "2026年8月18日(火) · dateGroup.suffix:{\"n\":1}08/18月顧顧客 k4様#00001filters.discardedカット·60minutesSuffixstaff-2カット60minutesSuffixstaff-2",
    "words": [
      "filters.all21",
      "filters.thisWeek0",
      "filters.aiPending1",
      "filters.draft1",
      "filters.discarded1",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute",
      "/ja/karute?f=discarded"
    ],
    "loads": [],
    "storage": []
  },
  "emptyStore": {
    "rows": [],
    "listText": "empty",
    "words": [
      "filters.all0",
      "filters.thisWeek0",
      "filters.aiPending0",
      "filters.draft0",
      "filters.discarded0",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute"
    ],
    "loads": [],
    "storage": []
  },
  "emptyWord": {
    "rows": [],
    "listText": "empty",
    "words": [
      "filters.all1",
      "filters.thisWeek0",
      "filters.aiPending0",
      "filters.draft0",
      "filters.discarded0",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute",
      "/ja/karute?f=draft"
    ],
    "loads": [],
    "storage": []
  },
  "urlAll": {
    "rows": [
      "/karute/k1",
      "/karute/k2",
      "/karute/k3",
      "/karute/k5",
      "/karute/k6"
    ],
    "listText": null,
    "words": [
      "filters.all21",
      "filters.thisWeek0",
      "filters.aiPending1",
      "filters.draft1",
      "filters.discarded1",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute"
    ],
    "loads": [],
    "storage": []
  },
  "rememberedAll": {
    "rows": [
      "/karute/k1",
      "/karute/k2",
      "/karute/k3",
      "/karute/k5",
      "/karute/k6"
    ],
    "listText": null,
    "words": [
      "filters.all21",
      "filters.thisWeek0",
      "filters.aiPending1",
      "filters.draft1",
      "filters.discarded1",
      "filters.shared3"
    ],
    "urls": [
      "/ja/karute"
    ],
    "loads": [],
    "storage": [
      [
        "karute:staffScope:records:staff-1",
        "all"
      ]
    ]
  }
}
