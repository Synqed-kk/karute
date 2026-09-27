/** @jest-environment jsdom */
/**
 * 案C+ 「三段に畳む」 on the カルテ tab (⚖ Liam 9/26 「案C+ Looks good.」), row
 * order since ⚖ カルテ TAB LOCKED 9/27 01:56: search (＋ at its end) → ONE
 * chip row [month · 担当 ▾] → the words row → list (the S44 block at the end).
 * The status line and the 自分/全スタッフ row fold away. What this pins:
 *   - no status line renders in ANY state (the i18n keys are gone too);
 *   - its numbers live on the controls — 全件 on すべて (the month chip's 今月
 *     was retired by ⚖ 月の件数 = オフ, S44) — under the SAME honesty rules the line had (Greptile PR #775
 *     round 2: a failed count is never shown as a number, a failed main read
 *     shows no numbers at all);
 *   - the staff control (⚖ S46 option C: the 自分 | 全スタッフ ⌄ control 顧客
 *     and 予約 use, replacing the 担当 chip) carries the same keys
 *     ('all' | 'self' | staffId) with no new meaning and names the current
 *     pick;
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

/** The month chip — its accessible name is 「YYYY年M月」 (no count since S44). */
const monthChip = () => screen.getByRole('button', { name: /^\d{4}年\d{1,2}月( \d+)?$/ })
const allPill = () => screen.getByRole('button', { name: /^filters\.all/ })
/** The 自分 | 全スタッフ ⌄ control (⚖ S46 option C — StaffScopeSegment, the
 *  same control 顧客 and 予約 use): 自分 is its own segment ('self' echo);
 *  segment 2's label names the state ('all' echo, or a picked staffer, spoken
 *  by their FULL name); the chevron ('title' echo) opens the list. Its look
 *  (on/off segments) is pinned in staff-scope-segment.test.tsx. */
const selfSegment = () => screen.getByRole('button', { name: 'self' })
const stateLabel = (name: RegExp | string = 'all') => screen.getByRole('button', { name })
const chevron = () => screen.getByRole('button', { name: 'title' })

beforeEach(() => {
  searchParams = new URLSearchParams()
  dialogProps.length = 0
  mockReplace.mockClear()
  // The カルテ list remembers the staff pick (karute:staffScope:records:*):
  // clear it so a pick from one test never leaks into the next (randomized order).
  window.localStorage.clear()
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
  it('全件 → すべて; the month chip names the month only (⚖ 月の件数 = オフ, S44)', () => {
    renderList()
    expect(monthChip()).toHaveAccessibleName(/月$/)
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

  it('a real 0 still prints no month count — the chip never carries one', () => {
    renderList({ monthCount: 0 })
    expect(monthChip()).toHaveAccessibleName(/月$/)
  })

  it('a failed MAIN read prints no numbers at all, even with a healthy 今月 probe', () => {
    renderList({ total: null })
    expect(monthChip()).toHaveAccessibleName(/月$/)
    expect(allPill().textContent).toBe('filters.all')
  })
})

describe('the 自分 | 全スタッフ ⌄ control (⚖ S46 option C — replaces the 担当 chip)', () => {
  it('is absent when there is no roster — the same gate the 担当 chip had', () => {
    const { container } = renderList({ staffList: [], currentStaffId: 'staff-1' })
    expect(container.querySelector('[data-staff-scope]')).toBeNull()
    expect(screen.queryByRole('button', { name: /^(all|self)$/ })).not.toBeInTheDocument()
  })

  it('reads 全スタッフ while nothing narrows — segment 2 is the pressed one', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    expect(stateLabel()).toHaveAttribute('aria-pressed', 'true')
    expect(selfSegment()).toHaveAttribute('aria-pressed', 'false')
  })

  it('the chevron offers 自分 · 全スタッフ · the roster — same keys, 全スタッフ marked current', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    fireEvent.click(chevron())
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

  it('offers no 自分 — segment or row — when the viewer has no staff profile', () => {
    renderList({ staffList: STAFF, currentStaffId: null })
    expect(screen.queryByRole('button', { name: 'self' })).not.toBeInTheDocument()
    fireEvent.click(chevron())
    expect(screen.queryByRole('option', { name: 'self' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'all' })).toBeInTheDocument()
  })

  it('自分 narrows the list to the viewer’s rows in ONE tap', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    fireEvent.click(selfSegment())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(selfSegment()).toHaveAttribute('aria-pressed', 'true')
    expect(stateLabel()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('顧客 a1')).toBeInTheDocument()
    expect(screen.queryByText('他人 二郎')).not.toBeInTheDocument()
  })

  it('a roster pick narrows to that staff — family name shown, FULL name spoken; 全スタッフ returns', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    fireEvent.click(chevron())
    fireEvent.click(screen.getByRole('option', { name: '鈴木 花子' }))
    const label = stateLabel('鈴木 花子')
    expect(label).toHaveAttribute('aria-pressed', 'true')
    expect(label.querySelector('.truncate')?.textContent).toBe('鈴木')
    expect(screen.getByText('他人 二郎')).toBeInTheDocument()
    expect(screen.queryByText('顧客 a1')).not.toBeInTheDocument()

    fireEvent.click(chevron())
    fireEvent.click(screen.getByRole('option', { name: 'all' }))
    expect(stateLabel()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('顧客 a1')).toBeInTheDocument()
    expect(screen.getByText('他人 二郎')).toBeInTheDocument()
  })

  it('restores ?s=self from the URL (byte-identical initial params)', () => {
    searchParams = new URLSearchParams('s=self')
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    expect(selfSegment()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('他人 二郎')).not.toBeInTheDocument()
  })

  // S42: 'self' with no staff profile is ONE lens everywhere — the list view
  // collapses it to 'all' before the list, the control and the URL read it.
  describe('?s=self for a viewer with NO staff profile', () => {
    /** Every URL the writer replaced to — its `s` param, per call. */
    const writtenS = () =>
      mockReplace.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams.get('s'))

    it('the control reads 全スタッフ, every row shows, and the URL carries no `s`', () => {
      searchParams = new URLSearchParams('s=self')
      renderList({ staffList: STAFF, currentStaffId: null })
      expect(stateLabel()).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('button', { name: 'self' })).not.toBeInTheDocument()
      expect(screen.getByText('顧客 a1')).toBeInTheDocument()
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      // The dropdown agrees: 全スタッフ is the current pick, 自分 is not offered.
      fireEvent.click(chevron())
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

    it('the control reads 全スタッフ, 全スタッフ is selected, every row shows, no `s`', () => {
      searchParams = new URLSearchParams('s=staff-9')
      renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
      expect(stateLabel()).toHaveAttribute('aria-pressed', 'true')
      expect(selfSegment()).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByText('顧客 a1')).toBeInTheDocument()
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      fireEvent.click(chevron())
      expect(screen.getByRole('option', { name: 'all' })).toHaveAttribute('aria-selected', 'true')
      expect(
        screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true'),
      ).toHaveLength(1)
      const written = writtenS()
      expect(written.length).toBeGreaterThan(0)
      expect(written.every((v) => v === null)).toBe(true)
    })

    it('control: a roster id narrows, the control names them, the URL keeps `s`', () => {
      searchParams = new URLSearchParams('s=staff-2')
      renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
      expect(stateLabel('鈴木 花子')).toHaveAttribute('aria-pressed', 'true')
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
      expect(stateLabel('鈴木 花子')).toBeInTheDocument()
      expect(screen.getByText('他人 二郎')).toBeInTheDocument()
      expect(screen.queryByText('顧客 a1')).not.toBeInTheDocument()
      expect(writtenS().at(-1)).toBe('staff-2')
    })
  })

  it('the pills count AFTER the control’s scope — 自分 moves 今週 with it', () => {
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
    fireEvent.click(selfSegment())
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

// ── ⚖ カルテ TAB LOCKED (Liam 9/27 01:56) — S44 ────────────────────────────
// 行の順 = チップが上: search → the chip row [month · 自分 | 全スタッフ ⌄] → the words row →
// list. 選択 = 太字＋青＋うすい下地, no ✓. 月の件数 = オフ. The remembered pick
// (⚖ STAFF CONTROL 04:5x): URL > remembered > 全スタッフ, per person per tab.
describe('カルテ TAB LOCKED — row order, the words row, the remembered pick', () => {
  beforeEach(() => window.localStorage.clear())

  it('the chip row sits ABOVE the words row, and the list follows the words', () => {
    const { container } = renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    const chips = container.querySelector('[data-chip-row]')!
    const words = container.querySelector('[data-words-row]')!
    expect(chips).toBeTruthy()
    expect(words).toBeTruthy()
    // DOCUMENT_POSITION_FOLLOWING: the words row comes after the chip row.
    expect(chips.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The chip row holds the month chip and the staff control — nothing else.
    expect(chips.children).toHaveLength(2)
    expect(within(chips as HTMLElement).getByRole('button', { name: /^\d{4}年\d{1,2}月$/ })).toBeTruthy()
    expect(chips.querySelector('[data-staff-scope]')).toBeTruthy()
    expect(within(chips as HTMLElement).getByRole('button', { name: 'all' })).toBeTruthy()
    expect(words.getAttribute('data-words-row')).toBe('words')
  })

  it('the chosen word = bold + blue + a light blue wash, and no ✓ anywhere on the row', () => {
    const { container } = renderList()
    const chosen = allPill()
    expect(chosen).toHaveAttribute('aria-pressed', 'true')
    expect(chosen.className).toContain('font-semibold')
    expect(chosen.className).toContain('text-primary')
    expect(chosen.className).toContain('bg-primary/8')
    expect(container.querySelector('[data-words-row] svg')).toBeNull()
  })

  it('step B keeps counts on the urgent words only (AI補完待ち / 下書き)', () => {
    const { container } = renderList({
      items: [row('p1', { aiStatus: 'pending' }), row('d1', { aiStatus: 'draft' }), row('s1')],
    })
    const urgent = [...container.querySelectorAll('[data-words-row] [data-count="urgent"]')]
    const plain = [...container.querySelectorAll('[data-words-row] [data-count="plain"]')]
    expect(urgent.map((e) => e.closest('button')!.textContent)).toEqual([
      'filters.aiPending1',
      'filters.draft1',
    ])
    // Non-urgent counts carry the step-B class (hidden below the breakpoint).
    expect(plain.length).toBeGreaterThan(0)
    for (const e of plain) expect(e.className).toMatch(/max-\[\d+px\]:hidden/)
    for (const e of urgent) expect(e.className).not.toMatch(/:hidden/)
  })

  it('no URL param: the remembered pick applies (karute:staffScope:records:<viewer>)', () => {
    window.localStorage.setItem('karute:staffScope:records:staff-1', 'staff-2')
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    expect(stateLabel('鈴木 花子')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('顧客 a1')).not.toBeInTheDocument()
    expect(screen.getByText('他人 二郎')).toBeInTheDocument()
  })

  it('an explicit URL param wins over the remembered pick', () => {
    window.localStorage.setItem('karute:staffScope:records:staff-1', 'staff-2')
    searchParams = new URLSearchParams('s=self')
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    expect(selfSegment()).toHaveAttribute('aria-pressed', 'true')
  })

  it('a remembered staffer who left the roster reads 全スタッフ — label and list together', () => {
    window.localStorage.setItem('karute:staffScope:records:staff-1', 'staff-9')
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    expect(stateLabel()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('顧客 a1')).toBeInTheDocument()
    expect(screen.getByText('他人 二郎')).toBeInTheDocument()
  })

  it('a pick is remembered for this viewer, on this tab only', () => {
    renderList({ staffList: STAFF, currentStaffId: 'staff-1' })
    fireEvent.click(selfSegment())
    expect(window.localStorage.getItem('karute:staffScope:records:staff-1')).toBe('self')
    expect(window.localStorage.getItem('karute:staffScope:customers:staff-1')).toBeNull()
  })

  it('a viewer with no staff profile: nothing remembered, nothing written', () => {
    window.localStorage.setItem('karute:staffScope:records:null', 'staff-2')
    renderList({ staffList: STAFF, currentStaffId: null })
    expect(stateLabel()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chevron())
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '鈴木 花子' }))
    expect(Object.keys(window.localStorage).filter((k) => k !== 'karute:staffScope:records:null')).toEqual([])
  })
})
