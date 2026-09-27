/** @jest-environment jsdom */
/**
 * ⚖ S46 OPTION C on the カルテ tab (Liam: 「So I guess C solved it, didn't
 * it?」). What this pins:
 *   1. the month CHIP's label — the month alone inside the list's current
 *      year, the year too for any other year; "current year" is currentMonth's,
 *      never the clock; the chip's spoken name is always the full year + month;
 *      the PANEL's rows keep their year always;
 *   2. the trim engine (trim-steps.ts) — an ORDERED step list, each step only
 *      when the steps before it still leave < 6px spare; insertable (the 新規
 *      chip's count slots in between the badge step and the own-row step);
 *   3. the staff control's badge-only look keeps the FULL name as its
 *      accessible name, and the view walks the steps on real (stubbed) widths.
 * Widths are stubbed — jsdom has no layout; the real px are the fit proof's
 * (scripts/fit-harness/staff-control-c.mjs).
 */
let mockLocale = 'ja'
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => mockLocale,
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
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: () => null,
}))
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
  loadKaruteWindow: jest.fn(),
}))

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import {
  KaruteMonthSelector,
  formatMonthChip,
} from '@/components/karute/spike-lifted/list/KaruteMonthSelector'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import {
  TRIM_SPARE_MIN,
  useTrimSteps,
  type TrimMeasure,
} from '@/components/karute/spike-lifted/list/trim-steps'
import { StaffScopeSegment } from '@/components/staff/StaffScopeSegment'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'

beforeEach(() => {
  mockLocale = 'ja'
  searchParams = new URLSearchParams()
  mockReplace.mockClear()
  window.localStorage.clear()
})

// ── 1. the month chip's label ────────────────────────────────────────────────
describe('the month chip label (option C) — formatMonthChip', () => {
  it('current year → the month alone (ja 「9月」 · en "Sep")', () => {
    expect(formatMonthChip('2026-09', '2026-09', 'ja')).toBe('9月')
    expect(formatMonthChip('2026-10', '2026-12', 'ja')).toBe('10月')
    expect(formatMonthChip('2026-09', '2026-09', 'en')).toBe('Sep')
    expect(formatMonthChip('2026-01', '2026-09', 'en')).toBe('Jan')
  })

  it('another year → the year too (ja 「2025年12月」 · en "Dec 2025")', () => {
    expect(formatMonthChip('2025-12', '2026-01', 'ja')).toBe('2025年12月')
    expect(formatMonthChip('2025-10', '2026-09', 'ja')).toBe('2025年10月')
    expect(formatMonthChip('2025-12', '2026-01', 'en')).toBe('Dec 2025')
  })

  it('"current year" comes from currentMonth, never the clock', () => {
    jest.useFakeTimers({ now: new Date('2031-03-15T12:00:00+09:00') })
    try {
      // The clock says 2031; the list's own month says 2026.
      expect(formatMonthChip('2026-09', '2026-09', 'ja')).toBe('9月')
      expect(formatMonthChip('2031-03', '2026-09', 'ja')).toBe('2031年3月')
      mockLocale = 'ja'
      render(
        <KaruteMonthSelector currentMonth="2026-09" oldestMonth="2026-01" selected={null} onSelect={() => {}} />,
      )
      expect(screen.getByRole('button', { name: '2026年9月' }).textContent).toBe('9月')
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('the month chip (KaruteMonthSelector) — visible label vs spoken name vs the panel', () => {
  const chipEl = (sel: string | null, current = '2026-09') => (
    <KaruteMonthSelector currentMonth={current} oldestMonth="2025-01" selected={sel} onSelect={() => {}} />
  )

  it('ja: 「9月」 shown, 「2026年9月」 spoken; another year shows and speaks the year', () => {
    const { rerender } = render(chipEl(null))
    const chip = screen.getByRole('button', { name: '2026年9月' })
    expect(chip.textContent).toBe('9月')
    expect(chip).toHaveAttribute('aria-label', '2026年9月')
    rerender(chipEl('2025-12'))
    const other = screen.getByRole('button', { name: '2025年12月' })
    expect(other.textContent).toBe('2025年12月')
  })

  it('en: "Sep" shown, "Sep 2026" spoken; "Dec 2025" for another year', () => {
    mockLocale = 'en'
    const { rerender } = render(chipEl(null))
    expect(screen.getByRole('button', { name: 'Sep 2026' }).textContent).toBe('Sep')
    rerender(chipEl('2025-12'))
    expect(screen.getByRole('button', { name: 'Dec 2025' }).textContent).toBe('Dec 2025')
  })

  it('the PANEL keeps the year on every row — this year’s included', () => {
    render(chipEl(null))
    fireEvent.click(screen.getByRole('button', { name: '2026年9月' }))
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByRole('option', { name: '2026年9月' }).textContent).toBe('2026年9月')
    expect(within(listbox).getByRole('option', { name: '2026年1月' }).textContent).toBe('2026年1月')
    expect(within(listbox).getByRole('option', { name: '2025年12月' }).textContent).toBe('2025年12月')
    // No month-only row anywhere in the panel.
    for (const o of within(listbox).getAllByRole('option')) expect(o.textContent).toMatch(/^\d{4}年\d{1,2}月$/)
  })
})

// ── 2. the trim engine ──────────────────────────────────────────────────────
/** Stubbed widths: `available` px, and a one-line natural width of BASE minus
 *  what each APPLIED step saves (read off the row as it is rendered). */
let AVAIL = 343
let BASE = 0
let SAVE: Record<string, number> = {}
const stubMeasure = (row: HTMLElement): TrimMeasure => ({
  available: AVAIL,
  natural:
    BASE -
    (row.dataset.applied ? row.dataset.applied.split(' ') : []).reduce((a, s) => a + (SAVE[s] ?? 0), 0),
})

function Row({ steps, content = '' }: { steps: string[]; content?: string }) {
  const { ref, applied } = useTrimSteps<string, HTMLDivElement>(steps, content, stubMeasure)
  return <div ref={ref} data-testid="row" data-applied={applied.join(' ')} />
}
const applied = () => screen.getByTestId('row').dataset.applied

describe('the trim engine (trim-steps.ts) — widths stubbed', () => {
  beforeEach(() => {
    AVAIL = 343
    BASE = 0
    SAVE = { badgeOnly: 50, dummy: 20 }
  })

  it('the rule is ≥ 6px spare', () => {
    expect(TRIM_SPARE_MIN).toBe(6)
  })

  it('spare ≥ 6 → nothing trimmed (exactly 6 passes)', () => {
    BASE = 343 - 6
    render(<Row steps={['badgeOnly', 'ownRow']} />)
    expect(applied()).toBe('')
  })

  it('spare < 6 → step 1 only, when step 1 leaves ≥ 6', () => {
    BASE = 343 - 5.9
    render(<Row steps={['badgeOnly', 'ownRow']} />)
    expect(applied()).toBe('badgeOnly')
  })

  it('still < 6 after step 1 → step 3, with no step 2 registered', () => {
    BASE = 400 // after the badge: 350 → still −7
    render(<Row steps={['badgeOnly', 'ownRow']} />)
    expect(applied()).toBe('badgeOnly ownRow')
  })

  it('ORDERED and INSERTABLE: a middle step registered between 1 and 3 applies between them', () => {
    BASE = 400 // badge → 350 (−7) → dummy → 330 (+13): stop before ownRow
    const { unmount } = render(<Row steps={['badgeOnly', 'dummy', 'ownRow']} />)
    expect(applied()).toBe('badgeOnly dummy')
    unmount()
    SAVE.dummy = 5 // badge → 350 → dummy → 345 (−2): ownRow too, in order
    render(<Row steps={['badgeOnly', 'dummy', 'ownRow']} />)
    expect(applied()).toBe('badgeOnly dummy ownRow')
  })

  it('a change in what the row holds restarts from nothing trimmed', () => {
    BASE = 400
    const { rerender } = render(<Row steps={['badgeOnly', 'ownRow']} content="long name" />)
    expect(applied()).toBe('badgeOnly ownRow')
    BASE = 200
    rerender(<Row steps={['badgeOnly', 'ownRow']} content="全スタッフ" />)
    expect(applied()).toBe('')
  })

  it('a row that is not laid out (0px available) trims nothing', () => {
    AVAIL = 0
    BASE = 1000
    render(<Row steps={['badgeOnly', 'ownRow']} />)
    expect(applied()).toBe('')
  })

  describe('a WIDTH change re-walks (ResizeObserver); nothing else does', () => {
    let roCallback: (() => void) | null = null
    let width = 343
    const OriginalRO = globalThis.ResizeObserver
    beforeEach(() => {
      roCallback = null
      width = 343
      globalThis.ResizeObserver = class {
        constructor(cb: () => void) {
          roCallback = cb
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver
      jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    })
    afterEach(() => {
      globalThis.ResizeObserver = OriginalRO
      jest.restoreAllMocks()
    })

    it('rotating wider gives the trims back; narrower takes them again', () => {
      BASE = 400
      render(<Row steps={['badgeOnly', 'ownRow']} />)
      expect(applied()).toBe('badgeOnly ownRow')
      // Same width reported again (e.g. a height change from the trim itself): no re-walk.
      AVAIL = 1000
      act(() => roCallback!())
      expect(applied()).toBe('badgeOnly ownRow')
      // The width really changed: re-walk from nothing trimmed.
      width = 500
      AVAIL = 500
      act(() => roCallback!())
      expect(applied()).toBe('')
      width = 380
      AVAIL = 380 // 400 → −20 → badge 350 → +30: badge only
      act(() => roCallback!())
      expect(applied()).toBe('badgeOnly')
    })
  })
})

// ── 3. the staff control: badge only keeps the full name ────────────────────
describe('StaffScopeSegment — badge only keeps the FULL name as the accessible name', () => {
  const ROSTER = [
    { id: 's-self', name: '佐藤 美咲', initials: '佐藤' },
    { id: 's-3', name: '鈴木 友梨佳', initials: '鈴木' },
    { id: 's-8', name: '勘解由小路美和子', initials: '勘解' },
  ]
  const seg = (selected: string, badgeOnly?: boolean) => (
    <StaffScopeSegment staffList={ROSTER} selfStaffId="s-self" selected={selected} onChange={() => {}} badgeOnly={badgeOnly} />
  )

  it('full: the family name shows, the full name is spoken', () => {
    render(seg('s-3'))
    const label = screen.getByRole('button', { name: '鈴木 友梨佳' })
    expect(label.querySelector('.truncate')?.textContent).toBe('鈴木')
  })

  it('badge only: the name text is gone, the full name is still spoken', () => {
    const { rerender } = render(seg('s-3', true))
    const label = screen.getByRole('button', { name: '鈴木 友梨佳' })
    expect(label.querySelector('.truncate')).toBeNull()
    // The badge (aria-hidden initials) is all that shows.
    expect(label.textContent).toBe('鈴木')
    rerender(seg('s-8', true))
    expect(screen.getByRole('button', { name: '勘解由小路美和子' }).querySelector('.truncate')).toBeNull()
  })

  it('全スタッフ / 自分 are untouched by badge only (no name to trim)', () => {
    const { rerender } = render(seg('all', true))
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true')
    rerender(seg('self', true))
    expect(screen.getByRole('button', { name: 'self' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('the カルテ chip row walks its steps (widths stubbed) — accessible names stay full', () => {
  const STAFF = [
    { id: 'staff-1', name: '佐藤 美咲', initials: '佐藤' },
    { id: 'staff-8', name: '勘解由小路美和子', initials: '勘解' },
  ]
  const item = (id: string, staffId: string): KaruteListItem => ({
    id,
    customerId: `c-${id}`,
    customerName: `顧客 ${id}`,
    customerInitials: '顧',
    customerKaruteNumber: '#00001',
    date: '2026-08-20',
    weekday: '木',
    service: 'カット',
    duration: 60,
    staffId,
    staffColorKey: null,
    staffName: staffId,
    summary: 'まとめ',
    aiStatus: 'summarized',
    conversionStatus: 'active',
    href: `/karute/${id}`,
  })
  // The list's own current month, derived independently.
  const CURRENT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date())
  const MONTH_FULL = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long' }).format(
    new Date(`${CURRENT}-01T00:00:00+09:00`),
  )

  let rowWidth = 343
  /** One-line natural width: month chip 80 + gap 8 + the control — 150 with a
   *  name (badge + text), 90 as badge only / 全スタッフ. */
  const natural = (row: HTMLElement) => {
    const ctl = row.querySelector('[data-staff-scope]')
    if (!ctl) return 80
    return 88 + (ctl.querySelector('.truncate') ? 150 : 90) + 150 // + a fixed 150 to make the widths bite
  }
  beforeEach(() => {
    rowWidth = 343
    jest
      .spyOn(Element.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: Element) {
        return this.hasAttribute('data-chip-row') ? rowWidth : 0
      })
    const orig = Element.prototype.getBoundingClientRect
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      // (jsdom's style parser drops 'max-content', so the stub answers every
      // box read of the row with its one-line natural width.)
      if (this.hasAttribute('data-chip-row')) {
        const w = natural(this as HTMLElement)
        return { width: w, height: 36, top: 0, left: 0, right: w, bottom: 36, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
      }
      return orig.call(this)
    })
  })
  afterEach(() => jest.restoreAllMocks())

  const renderList = () =>
    render(
      <KaruteRecordListView
        items={[item('a1', 'staff-1'), item('a2', 'staff-8')]}
        monthCount={2}
        total={2}
        staffList={STAFF}
        currentStaffId="staff-1"
        customerOptions={[]}
      />,
    )
  const chipRow = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-chip-row]')!

  it('roomy: nothing trimmed — the row is main’s (no data-trim, main’s classes)', () => {
    rowWidth = 500 // natural 388 → +112
    searchParams = new URLSearchParams('s=staff-8')
    const { container } = renderList()
    expect(chipRow(container)).not.toHaveAttribute('data-trim')
    expect(chipRow(container).className).toBe('flex flex-nowrap items-center gap-2')
    expect(chipRow(container).querySelector('[data-row-break]')).toBeNull()
    const label = screen.getByRole('button', { name: '勘解由小路美和子' })
    expect(label.querySelector('.truncate')?.textContent).toBe('勘解由小路美和子')
    expect(screen.getByRole('button', { name: MONTH_FULL })).toBeInTheDocument()
  })

  it('tight: step 1 — badge only; the control and the month chip keep their full names', () => {
    rowWidth = 343 // 388 → −45 → badge 328 → +15
    searchParams = new URLSearchParams('s=staff-8')
    const { container } = renderList()
    expect(chipRow(container)).toHaveAttribute('data-trim', 'badgeOnly')
    expect(chipRow(container).className).toBe('flex flex-nowrap items-center gap-2')
    const label = screen.getByRole('button', { name: '勘解由小路美和子' })
    expect(label.querySelector('.truncate')).toBeNull()
    expect(screen.getByRole('button', { name: MONTH_FULL })).toBeInTheDocument()
  })

  it('tighter: step 3 — the control drops to its own row, still badge only, names still full', () => {
    rowWidth = 300 // 388 → −88 → badge 328 → −28 → own row
    searchParams = new URLSearchParams('s=staff-8')
    const { container } = renderList()
    const row = chipRow(container)
    expect(row).toHaveAttribute('data-trim', 'badgeOnly ownRow')
    // The row wraps; a full-width 8px break sits right before the control, so
    // everything before it keeps line 1 and the control gets a row of its own.
    expect(row.className).toBe('flex flex-wrap items-center gap-x-2')
    const kids = [...row.children]
    const brk = row.querySelector('[data-row-break]')!
    expect(brk.className).toBe('h-2 basis-full')
    expect(brk).toHaveAttribute('aria-hidden', 'true')
    expect(kids.indexOf(brk)).toBe(kids.length - 2)
    expect(kids[kids.length - 1].querySelector('[data-staff-scope]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '勘解由小路美和子' }).querySelector('.truncate')).toBeNull()
    expect(screen.getByRole('button', { name: MONTH_FULL })).toBeInTheDocument()
  })

  it('全スタッフ has no name to trim: the walk goes straight to the own row', () => {
    rowWidth = 300 // 全スタッフ: 328 → −28
    const { container } = renderList()
    expect(chipRow(container)).toHaveAttribute('data-trim', 'ownRow')
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a pick restarts the walk: 全スタッフ → a long name trims, back to 全スタッフ un-trims', () => {
    rowWidth = 343 // 全スタッフ 328 → +15: nothing
    const { container } = renderList()
    expect(chipRow(container)).not.toHaveAttribute('data-trim')
    fireEvent.click(screen.getByRole('button', { name: 'title' }))
    fireEvent.click(screen.getByRole('option', { name: '勘解由小路美和子' }))
    expect(chipRow(container)).toHaveAttribute('data-trim', 'badgeOnly')
    fireEvent.click(screen.getByRole('button', { name: 'title' }))
    fireEvent.click(screen.getByRole('option', { name: 'all' }))
    expect(chipRow(container)).not.toHaveAttribute('data-trim')
  })
})
