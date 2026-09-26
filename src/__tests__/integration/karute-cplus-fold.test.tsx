/** @jest-environment jsdom */
/**
 * 案C+ 「三段に畳む」 on the カルテ tab (⚖ Liam 9/26 「案C+ Looks good.」):
 * search (＋ at its end) → state pills → ONE chip row [month · 担当 ▾] → list.
 * The status line and the 自分/全スタッフ row fold away. What this pins:
 *   - no status line renders in ANY state (the i18n keys are gone too);
 *   - its numbers live on the controls — 今月 on the month chip, 全件 on
 *     すべて — under the SAME honesty rules the line had (Greptile PR #775
 *     round 2: a failed count is never shown as a number, a failed main read
 *     shows no numbers at all);
 *   - the 担当 dropdown chip carries today's CustomersStaffFilter keys
 *     ('all' | 'self' | staffId) with no new meaning, names the current pick,
 *     and wears the R13 wash only while it narrows;
 *   - the ＋ opens the same manual-entry dialog the words CTA did.
 *
 * next-intl echoes the key + params (same idiom as the sibling suites), so
 * these pin WHICH key and WHAT number, never the wording.
 * (Replaces karute-statusline-render.test.tsx, whose subject no longer exists.)
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'ja',
}))
const mockReplace = jest.fn()
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: jest.fn() }),
  usePathname: () => '/ja/karute',
  Link: ({ children, ...rest }: { children?: React.ReactNode; href?: string }) => (
    <a {...rest}>{children}</a>
  ),
}))
let searchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => searchParams,
}))
const dialogProps: Array<{ open: boolean; preselectedCustomerId?: string | null }> = []
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: (props: { open: boolean; preselectedCustomerId?: string | null }) => {
    dialogProps.push(props)
    return null
  },
}))
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
  loadKaruteWindow: jest.fn(),
}))

import { fireEvent, render, screen, within } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

function row(id: string, over: Partial<KaruteListItem> = {}): KaruteListItem {
  return {
    id,
    customerId: `c-${id}`,
    customerName: `顧客 ${id}`,
    customerInitials: '顧',
    customerKaruteNumber: '#00001',
    date: '2026-09-10',
    weekday: '木',
    service: 'カット',
    duration: 60,
    staffId: 'staff-1',
    staffColorKey: null,
    staffName: '田中 太郎',
    summary: 'まとめ',
    aiStatus: 'summarized',
    conversionStatus: 'active',
    href: `/karute/${id}`,
    ...over,
  }
}

const STAFF = [
  { id: 'staff-1', name: '田中 太郎', initials: '田中' },
  { id: 'staff-2', name: '鈴木 花子', initials: '鈴木' },
]

const renderList = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) =>
  render(
    <KaruteRecordListView
      items={[row('a1'), row('a2', { staffId: 'staff-2', customerName: '他人 二郎' })]}
      monthCount={26}
      total={312}
      staffList={[]}
      currentStaffId={null}
      customerOptions={[]}
      {...props}
    />,
  )

/** The month chip — its accessible name is 「YYYY年M月」 plus, when shown, the
 *  count (dom-accessibility-api joins the two spans with a space). */
const monthChip = () => screen.getByRole('button', { name: /^\d{4}年\d{1,2}月( \d+)?$/ })
const allPill = () => screen.getByRole('button', { name: /^filters\.all/ })
/** The 担当 dropdown chip — names the current pick ('all' / 'self' echo, or a
 *  staff name). */
const staffChip = (name: RegExp | string = /^(all|self)$/) =>
  screen.getByRole('button', { name })

beforeEach(() => {
  searchParams = new URLSearchParams()
  dialogProps.length = 0
  mockReplace.mockClear()
})

describe('the status line is folded away (案C+)', () => {
  it('renders in NO state — data OK, discarded > 0, probe failed, main read failed', () => {
    const states: Array<Partial<React.ComponentProps<typeof KaruteRecordListView>>> = [
      {},
      { total: 2, discardedCount: 3 },
      { monthCount: null },
      { total: null },
    ]
    for (const props of states) {
      const { unmount } = renderList(props)
      expect(screen.queryByText(/statusLine/)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('its strings are gone from both locales (no orphaned copy left behind)', () => {
    for (const locale of [ja, en]) {
      const keys = Object.keys(locale.karute.recordList)
      expect(keys.filter((k) => k.startsWith('statusLine'))).toEqual([])
    }
  })
})

describe('the folded numbers live on the controls, with the line’s honesty rules', () => {
  it('今月 → the month chip; 全件 → すべて', () => {
    renderList()
    expect(monthChip()).toHaveAccessibleName(/ 26$/)
    expect(allPill().textContent).toBe('filters.all312')
  })

  it('全件 on すべて is the STORE UNIVERSE (active + discarded), the number the line printed', () => {
    renderList({ total: 2, discardedCount: 3, items: [row('a1')] })
    expect(allPill().textContent).toBe('filters.all5')
  })

  it('a failed 今月 probe prints NO number on the chip — never a fake 0', () => {
    renderList({ monthCount: null })
    expect(monthChip()).toHaveAccessibleName(/月$/)
    expect(allPill().textContent).toBe('filters.all312')
  })

  it('a real 0 IS printed', () => {
    renderList({ monthCount: 0 })
    expect(monthChip()).toHaveAccessibleName(/ 0$/)
  })

  it('a failed MAIN read prints no numbers at all, even with a healthy 今月 probe', () => {
    renderList({ total: null })
    expect(monthChip()).toHaveAccessibleName(/月$/)
    expect(allPill().textContent).toBe('filters.all')
  })
})

describe('the 担当 dropdown chip (replaces the 自分/全スタッフ row)', () => {
  it('is absent when there is no roster — the same gate the old row had', () => {
    renderList({ staffList: [], currentStaffId: 'staff-1' })
    expect(screen.queryByRole('button', { name: /^(all|self)$/ })).not.toBeInTheDocument()
  })

  it('names 全スタッフ while nothing narrows, in the outline (non-wash) state', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    expect(staffChip()).toHaveTextContent(/^all$/)
    expect(staffChip().className).not.toContain('bg-primary/8')
  })

  it('offers 自分 · 全スタッフ · the roster — same keys, 全スタッフ marked current', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    fireEvent.click(staffChip())
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    // In this order, by accessible name (the avatar initials are aria-hidden).
    const order = ['self', 'all', '田中 太郎', '鈴木 花子'].map((name) =>
      options.indexOf(within(listbox).getByRole('option', { name })),
    )
    expect(order).toEqual([0, 1, 2, 3])
    expect(options).toHaveLength(4)
    expect(within(listbox).getByRole('option', { name: 'all' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(listbox).getByRole('option', { name: 'self' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('offers no 自分 row when the viewer has no staff profile', () => {
    renderList({ staffList: STAFF, currentStaffId: null })
    fireEvent.click(staffChip())
    expect(screen.queryByRole('option', { name: 'self' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'all' })).toBeInTheDocument()
  })

  it('自分 narrows the list to the viewer’s rows, renames the chip and washes it', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    fireEvent.click(staffChip())
    fireEvent.click(screen.getByRole('option', { name: 'self' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(staffChip()).toHaveTextContent(/^self$/)
    expect(staffChip().className).toContain('bg-primary/8')
    expect(staffChip().className).toContain('text-primary')
    expect(screen.getByText('顧客 a1')).toBeInTheDocument()
    expect(screen.queryByText('他人 二郎')).not.toBeInTheDocument()
  })

  it('a roster pick narrows to that staff and the chip names them; 全スタッフ returns', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    fireEvent.click(staffChip())
    fireEvent.click(screen.getByRole('option', { name: '鈴木 花子' }))
    expect(staffChip(/鈴木 花子/)).toBeInTheDocument()
    expect(screen.getByText('他人 二郎')).toBeInTheDocument()
    expect(screen.queryByText('顧客 a1')).not.toBeInTheDocument()

    fireEvent.click(staffChip(/鈴木 花子/))
    fireEvent.click(screen.getByRole('option', { name: 'all' }))
    expect(staffChip()).toHaveTextContent(/^all$/)
    expect(screen.getByText('顧客 a1')).toBeInTheDocument()
    expect(screen.getByText('他人 二郎')).toBeInTheDocument()
  })

  it('restores ?s=self from the URL (byte-identical initial params)', () => {
    searchParams = new URLSearchParams('s=self')
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    expect(staffChip()).toHaveTextContent(/^self$/)
    expect(screen.queryByText('他人 二郎')).not.toBeInTheDocument()
  })

  // S42: 'self' with no staff profile is ONE lens everywhere — the list view
  // collapses it to 'all' before the list, the chip and the URL read it.
  describe('?s=self for a viewer with NO staff profile', () => {
    /** Every URL the writer replaced to — its `s` param, per call. */
    const writtenS = () =>
      mockReplace.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams.get('s'))

    it('the chip reads 全スタッフ with no wash, every row shows, and the URL carries no `s`', () => {
      searchParams = new URLSearchParams('s=self')
      renderList({ staffList: STAFF, currentStaffId: null })
      expect(staffChip()).toHaveTextContent(/^all$/)
      expect(staffChip().className).not.toContain('bg-primary/8')
      expect(staffChip().className).not.toContain('text-primary')
      expect(screen.getByText('顧客 a1')).toBeInTheDocument()
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      // The dropdown agrees: 全スタッフ is the current pick, 自分 is not offered.
      fireEvent.click(staffChip())
      expect(screen.getByRole('option', { name: 'all' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('option', { name: 'self' })).not.toBeInTheDocument()
      const written = writtenS()
      expect(written.length).toBeGreaterThan(0)
      expect(written.every((v) => v === null)).toBe(true)
    })

    it('the pills count the same unnarrowed universe the list shows', () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
      searchParams = new URLSearchParams('s=self')
      renderList({
        staffList: STAFF,
        currentStaffId: null,
        total: 2,
        items: [
          row('a1', { date: today }),
          row('a2', { date: today, staffId: 'staff-2', customerName: '他人 二郎' }),
        ],
      })
      expect(screen.getByRole('button', { name: /^filters\.thisWeek/ }).textContent).toBe(
        'filters.thisWeek2',
      )
    })

    it('control: WITH a profile the same URL keeps s=self (the probe above can fail)', () => {
      searchParams = new URLSearchParams('s=self')
      renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
      expect(writtenS().at(-1)).toBe('self')
    })
  })

  // S42 F6 (Greptile on #1059): the sibling of the case above — a saved
  // `?s=<staffId>` for someone NOT on the current roster is the same one lens.
  describe('?s=<staffId> for someone not on the current roster', () => {
    const writtenS = () =>
      mockReplace.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams.get('s'))

    it('the chip reads 全スタッフ with no wash, 全スタッフ is selected, every row shows, no `s`', () => {
      searchParams = new URLSearchParams('s=staff-9')
      renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
      expect(staffChip()).toHaveTextContent(/^all$/)
      expect(staffChip().className).not.toContain('bg-primary/8')
      expect(staffChip().className).not.toContain('text-primary')
      expect(screen.getByText('顧客 a1')).toBeInTheDocument()
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      fireEvent.click(staffChip())
      expect(screen.getByRole('option', { name: 'all' })).toHaveAttribute('aria-selected', 'true')
      expect(
        screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true'),
      ).toHaveLength(1)
      const written = writtenS()
      expect(written.length).toBeGreaterThan(0)
      expect(written.every((v) => v === null)).toBe(true)
    })

    it('control: a roster id narrows, the chip names them in the wash, the URL keeps `s`', () => {
      searchParams = new URLSearchParams('s=staff-2')
      renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
      expect(staffChip(/鈴木 花子/).className).toContain('bg-primary/8')
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      expect(screen.queryByText('顧客 a1')).not.toBeInTheDocument()
      expect(writtenS().at(-1)).toBe('staff-2')
    })

    it('the roster arriving later narrows again — the raw pick survived', () => {
      searchParams = new URLSearchParams('s=staff-2')
      const props = {
        items: [row('a1'), row('a2', { staffId: 'staff-2', customerName: '他人 二郎' })],
        monthCount: 26,
        total: 312,
        currentStaffId: 'staff-1',
        customerOptions: [],
      }
      const { rerender } = render(<KaruteRecordListView {...props} staffList={[]} />)
      // No roster yet: nobody to narrow to — every row, no `s`.
      expect(screen.getByText('顧客 a1')).toBeInTheDocument()
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      expect(writtenS().at(-1)).toBeNull()
      rerender(<KaruteRecordListView {...props} staffList={STAFF} />)
      expect(staffChip(/鈴木 花子/)).toBeInTheDocument()
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      expect(screen.queryByText('顧客 a1')).not.toBeInTheDocument()
      expect(writtenS().at(-1)).toBe('staff-2')
    })
  })

  it('the pills count AFTER the chip’s scope — 自分 moves 今週 with it', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
    renderList({
      staffList: STAFF,
      currentStaffId: 'staff-1',
      total: 2,
      items: [
        row('a1', { date: today }),
        row('a2', { date: today, staffId: 'staff-2', customerName: '他人 二郎' }),
      ],
    })
    const weekPill = () => screen.getByRole('button', { name: /^filters\.thisWeek/ })
    expect(weekPill().textContent).toBe('filters.thisWeek2')
    fireEvent.click(staffChip())
    fireEvent.click(screen.getByRole('option', { name: 'self' }))
    expect(weekPill().textContent).toBe('filters.thisWeek1')
  })
})

describe('the ＋ (manual entry) at the end of the search row', () => {
  it('carries the 「+ 新規カルテ」 name and opens the manual-entry dialog with no preselect', () => {
    renderList()
    const plus = screen.getByRole('button', { name: 'newKarute' })
    // Same row as the search field.
    const searchRow = screen.getByPlaceholderText('searchPlaceholder').closest('label')!
      .parentElement!
    expect(searchRow).toContainElement(plus)
    // Solid primary (the Button default), full-round — never a black fill.
    expect(plus.className).toContain('bg-primary')
    expect(plus.className).toContain('rounded-full')
    expect(plus.className).not.toMatch(/bg-(foreground|black)/)
    fireEvent.click(plus)
    const last = dialogProps[dialogProps.length - 1]
    expect(last.open).toBe(true)
    expect(last.preselectedCustomerId).toBeNull()
  })
})
