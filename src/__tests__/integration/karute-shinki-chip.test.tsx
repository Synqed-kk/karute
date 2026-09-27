/** @jest-environment jsdom */
/**
 * The 新規 chip on the カルテ tab's chip row (案C+), behind
 * KARUTE_SWITCHES.shinkiChip. The COMMITTED value is false; the ON cases flip
 * a test-only mock of the registry (never the source).
 *   OFF → no chip at all; the field rides on the items but nothing reads it.
 *   ON  → chip present; count = rows its own tap reveals (⚖ 8/25) where
 *         companyFirstVisit === true — null / false never count; the toggle
 *         filters; it ANDs with the staff scope and a state pill; inside a
 *         month the count is that month's tally; 0 still renders.
 */
const mockSwitches = { shinkiChip: false }
// A getter, so the (hoisted) factory reads the object at RENDER time.
jest.mock('@/lib/karute/karute-switches', () => ({
  get KARUTE_SWITCHES() {
    return mockSwitches
  },
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/karute',
  Link: ({ children, ...rest }: { children?: React.ReactNode; href?: string }) => (
    <a {...rest}>{children}</a>
  ),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: () => null,
}))
const loadKaruteWindow = jest.fn()
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
  loadKaruteWindow: (...a: unknown[]) => loadKaruteWindow(...a),
}))

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'
import { StaffSelector } from '@/components/staff/StaffSelector'

const jstYmd = (daysAgo: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - daysAgo * 86_400_000),
  )

function row(id: string, cfv: boolean | null, over: Partial<KaruteListItem> = {}): KaruteListItem {
  return {
    id,
    customerId: `c-${id}`,
    customerName: `顧客 ${id}`,
    customerInitials: '顧',
    customerKaruteNumber: '#00001',
    date: jstYmd(0),
    weekday: '土',
    service: 'カット',
    duration: 60,
    staffId: 'staff-1',
    staffColorKey: null,
    staffName: '田中 太郎',
    summary: 'まとめ',
    aiStatus: 'summarized',
    conversionStatus: 'active',
    href: `/karute/${id}`,
    companyFirstVisit: cfv,
    ...over,
  }
}

const STAFF = [
  { id: 'staff-1', name: '田中 太郎', initials: '田中' },
  { id: 'staff-2', name: '鈴木 花子', initials: '鈴木' },
]

// Mine: n1 (新規), n2 (新規, 下書き), f1 (false), u1 (null).
// Theirs (staff-2): n3 (新規). A January row keeps 2026年1月 in the picker.
const ITEMS: KaruteListItem[] = [
  row('n1', true),
  row('n2', true, { aiStatus: 'draft', summary: '' }),
  row('f1', false),
  row('u1', null),
  row('n3', true, { staffId: 'staff-2', staffName: '鈴木 花子' }),
  row('old', null, { date: '2026-01-15' }),
]

const renderList = (props: Partial<React.ComponentProps<typeof KaruteRecordListView>> = {}) =>
  render(
    <KaruteRecordListView
      items={ITEMS}
      monthCount={5}
      total={ITEMS.length}
      initialWindowStart="2026-01-01"
      initialHasMore={false}
      staffList={STAFF}
      currentStaffId="staff-1"
      customerOptions={[]}
      {...props}
    />,
  )

const shinkiChip = () => screen.getByRole('button', { name: /^shinki/ })
const shinkiCount = () => Number(shinkiChip().textContent!.replace('shinki', ''))
const visibleNames = () =>
  ITEMS.map((i) => i.customerName).filter((n) => screen.queryByText(n) !== null)

beforeEach(() => {
  mockSwitches.shinkiChip = false
  loadKaruteWindow.mockReset()
  // Main's remembered 担当 pick (staff-scope.ts, karute:staffScope:records:*)
  // lives in localStorage: a test that picks 自分 must not start the next
  // one in 自分 (S44 F4 added the same line to the sibling suites).
  window.localStorage.clear()
})

describe('KARUTE_SWITCHES.shinkiChip — the committed value', () => {
  it('is false in source (this suite only ever flips a mock)', () => {
    const real = jest.requireActual('@/lib/karute/karute-switches') as {
      KARUTE_SWITCHES: { shinkiChip: boolean }
    }
    expect(real.KARUTE_SWITCHES.shinkiChip).toBe(false)
  })
})

describe('switch OFF — the screen renders exactly as PR-1', () => {
  it('no chip, and every row shows whatever its companyFirstVisit says', () => {
    renderList()
    expect(screen.queryByRole('button', { name: /^shinki/ })).not.toBeInTheDocument()
    // The field IS on the items (mapped) — nothing narrows by it.
    expect(ITEMS.every((i) => 'companyFirstVisit' in i)).toBe(true)
    expect(visibleNames()).toEqual(ITEMS.map((i) => i.customerName))
  })

  // S45 (rebased onto main's S44 layout), S46 (rebased onto option C): OFF =
  // option C's chip row, element for element — no chip, no extra wrapper, no
  // trim, nothing pressable-and-pressed in it outside the staff control's own
  // segments.
  it('the chip row is exactly [month, staff control] — the same two children option C renders', () => {
    renderList()
    const row = document.querySelector('[data-chip-row]')!
    const kids = Array.from(row.children) as HTMLElement[]
    expect(kids).toHaveLength(2)
    expect(within(kids[0]).getByRole('button', { name: /^\d{4}年\d{1,2}月$/ })).toBeInTheDocument()
    expect(kids[1].querySelector('[data-staff-scope]')).not.toBeNull()
    expect(within(kids[1]).getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true')
    expect(row).not.toHaveAttribute('data-trim')
    expect(row.className).toBe('flex flex-nowrap items-center gap-2')
    expect(row.querySelector('[data-row-break]')).toBeNull()
    const pressedOutsideControl = Array.from(row.querySelectorAll('[aria-pressed]')).filter(
      (el) => !el.closest('[data-staff-scope]'),
    )
    expect(pressedOutsideControl).toEqual([])
  })
})

describe('the chip adds no call (OFF or ON)', () => {
  it('OFF and ON mount with the same calls, and toggling the chip makes none', () => {
    const actions = jest.requireMock('@/actions/karute') as {
      revealNoKaruteCustomer: jest.Mock
    }
    const calls = () => [
      loadKaruteWindow.mock.calls.length,
      actions.revealNoKaruteCustomer.mock.calls.length,
    ]
    actions.revealNoKaruteCustomer.mockClear()
    const off = renderList()
    const offCalls = calls()
    off.unmount()
    loadKaruteWindow.mockClear()
    actions.revealNoKaruteCustomer.mockClear()
    mockSwitches.shinkiChip = true
    renderList()
    expect(calls()).toEqual(offCalls)
    fireEvent.click(shinkiChip())
    fireEvent.click(shinkiChip())
    expect(calls()).toEqual(offCalls)
  })
})

describe('switch ON (test-only mock)', () => {
  beforeEach(() => {
    mockSwitches.shinkiChip = true
  })

  it('renders the chip between the month chip and the staff control, OFF by default, outline', () => {
    renderList()
    const chip = shinkiChip()
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(chip.className).not.toContain('bg-primary/8')
    expect(chip.parentElement).toHaveAttribute('data-chip-row')
    const before = chip.previousElementSibling as HTMLElement
    const after = chip.nextElementSibling as HTMLElement
    expect(within(before).getByRole('button', { name: /^\d{4}年\d{1,2}月$/ })).toBeInTheDocument()
    expect(after.querySelector('[data-staff-scope]')).not.toBeNull()
  })

  it('counts ONLY === true rows — null and false never count', () => {
    renderList()
    // n1, n2, n3 are true; f1 (false), u1 / old (null) are not.
    expect(shinkiCount()).toBe(3)
  })

  it('the toggle filters to === true rows, washes the chip, and toggles back', () => {
    renderList()
    fireEvent.click(shinkiChip())
    expect(shinkiChip()).toHaveAttribute('aria-pressed', 'true')
    expect(shinkiChip().className).toContain('bg-primary/8')
    expect(visibleNames()).toEqual(['顧客 n1', '顧客 n2', '顧客 n3'])
    // The count still names what is on screen.
    expect(shinkiCount()).toBe(3)
    fireEvent.click(shinkiChip())
    expect(visibleNames()).toEqual(ITEMS.map((i) => i.customerName))
  })

  it('composes with the staff scope (AND) — the count moves with it', () => {
    renderList()
    // Option C's control: 自分 is one tap.
    fireEvent.click(screen.getByRole('button', { name: 'self' }))
    expect(shinkiCount()).toBe(2) // n3 is another staff's
    fireEvent.click(shinkiChip())
    expect(visibleNames()).toEqual(['顧客 n1', '顧客 n2'])
  })

  it('composes with a state pill (AND) — the count is what ITS tap reveals', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /^filters\.draft/ }))
    expect(shinkiCount()).toBe(1) // only n2 is 下書き
    fireEvent.click(shinkiChip())
    expect(visibleNames()).toEqual(['顧客 n2'])
  })

  it('a tally of 0 still renders the chip, with 0', () => {
    renderList({ items: ITEMS.map((i) => ({ ...i, companyFirstVisit: null })) })
    expect(shinkiCount()).toBe(0)
  })

  it('inside a month the count is THAT month’s tally, and the toggle keeps the month', async () => {
    const jan = [
      row('j1', true, { date: '2026-01-10', customerName: '一月 新規' }),
      row('j2', false, { date: '2026-01-12', customerName: '一月 再来' }),
      row('j3', null, { date: '2026-01-20', customerName: '一月 不明' }),
    ]
    loadKaruteWindow.mockImplementation(async ({ month }: { month?: string }) => ({
      items: month === '2026-01' ? jan : [],
      windowStart: `${month}-01`,
      freshStoreTotal: ITEMS.length,
      hasMore: false,
    }))
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /^\d{4}年\d{1,2}月/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '2026年1月' }))
    })
    expect(screen.getByText('一月 新規')).toBeInTheDocument()
    expect(shinkiCount()).toBe(1)
    fireEvent.click(shinkiChip())
    expect(screen.getByText('一月 新規')).toBeInTheDocument()
    expect(screen.queryByText('一月 再来')).not.toBeInTheDocument()
    expect(screen.queryByText('一月 不明')).not.toBeInTheDocument()
    // Still in the month (the chip names it) — 新規 is an AND, not an exit.
    expect(screen.getByRole('button', { name: /^2026年1月$/ })).toBeInTheDocument()
  })
})

// The ✓ and its glide (FLIP) were DROPPED in the S45 rebase onto main: main's
// chip row and words row draw no ✓ (⚖ 01:56, BUILD-S44), so the chip's on
// state is the 担当 chip's own narrowed look and a toggle changes colours only
// — nothing beside it moves, so there is nothing to glide. This block REPLACES
// the two glide tests ('applies the inverse translateX…' and 'reduced motion:
// the chip still toggles…'): the chip still toggles, no ✓ is drawn, its
// contents keep their shape, and no inline transform/transition/will-change is
// written anywhere in the chip row.
describe('the on-state = the narrowed-chip look (StaffSelector’s chip) — no ✓, nothing moves (switch ON)', () => {
  beforeEach(() => {
    mockSwitches.shinkiChip = true
  })

  it('toggles without a ✓, keeps its two parts, and writes no inline style in the chip row', () => {
    renderList()
    const chip = shinkiChip()
    const row = chip.closest('[data-chip-row]')!
    const parts = () => Array.from(chip.children).map((c) => c.tagName)
    expect(parts()).toEqual(['SPAN', 'SPAN'])
    expect(chip.querySelector('svg')).toBeNull()
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(parts()).toEqual(['SPAN', 'SPAN'])
    expect(chip.querySelector('svg')).toBeNull()
    const styled = [row, ...Array.from(row.querySelectorAll('*'))].filter((el) =>
      el.hasAttribute('style'),
    )
    expect(styled).toEqual([])
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  // S46: option C replaced the カルテ tab's 担当 chip with the two-part
  // control, so the look the 新規 chip was matched to is read off its source —
  // StaffSelector's own chip trigger (the 担当 chip's code, unchanged), rendered
  // on its own at rest (全スタッフ) and narrowed (自分).
  it('at rest and on, it wears exactly StaffSelector’s chip classes (resting · narrowed)', () => {
    // The class sets, both directions, less shrink-0 (the month chip's wrapper
    // carries it; the 新規 chip is a bare child of the row).
    const set = (el: Element) => Array.from(el.classList).filter((c) => c !== 'shrink-0').sort()
    const selectorChip = (selected: string) => {
      const r = render(
        <StaffSelector
          staffList={STAFF}
          selected={selected}
          onChange={() => {}}
          scope={{ selfStaffId: 'staff-1', selfLabel: 'self', allLabel: 'all' }}
        />,
      )
      const classes = set(r.container.querySelector('button')!)
      r.unmount()
      return classes
    }
    const resting = selectorChip('all')
    const narrowed = selectorChip('self')
    expect(narrowed).toContain('bg-primary/8')
    renderList()
    expect(set(shinkiChip())).toEqual(resting)
    fireEvent.click(shinkiChip())
    expect(set(shinkiChip())).toEqual(narrowed)
    expect(shinkiChip().classList).toContain('bg-primary/8')
  })
})

// S42 fix round — three compositions the first round left untested. Each pins
// "the count names the 新規 rows actually on screen" in a state the earlier
// tests never reached.
describe('switch ON — a discarded 新規 row · a degraded read · 共有 mode (S42)', () => {
  beforeEach(() => {
    mockSwitches.shinkiChip = true
  })

  /** The 新規 rows of `items` that are rendered right now. */
  const renderedShinki = (items: KaruteListItem[]) =>
    items.filter((i) => i.companyFirstVisit === true && screen.queryByText(i.customerName) !== null)
      .length

  // The contract (PKT-S41-SHINKI-BUILD.md) is silent on discarded rows: STAGE
  // 2 item 3 says the chip "composes with the state tab, staff scope, search
  // and month mode (AND)", and THE CONTRACT says "Nothing else in the app
  // interprets the field". So the STATE PILL decides discarded visibility —
  // the register its chip-row siblings (month · 担当) already follow: すべて
  // shows discarded rows (its number is active + discarded), the active-only
  // pills drop them, 破棄済み keeps only them. The chip adds no rule of its own.
  it('a DISCARDED 新規 row counts and shows under すべて; the state pill, not the chip, decides', () => {
    const d1 = row('d1', true, { isDiscarded: true, customerName: '破棄 新規' })
    const items = [...ITEMS, d1]
    renderList({ items, total: ITEMS.length, discardedCount: 1 })
    expect(shinkiCount()).toBe(4) // n1 · n2 · n3 · d1
    expect(shinkiCount()).toBe(renderedShinki(items))
    fireEvent.click(shinkiChip())
    expect(visibleNames()).toEqual(['顧客 n1', '顧客 n2', '顧客 n3'])
    expect(screen.getByText('破棄 新規')).toBeInTheDocument()
    expect(shinkiCount()).toBe(renderedShinki(items))
    // 今週 is active-only (every ITEMS row but `old` is today): d1 drops out.
    fireEvent.click(screen.getByRole('button', { name: /^filters\.thisWeek/ }))
    expect(shinkiCount()).toBe(3)
    expect(screen.queryByText('破棄 新規')).not.toBeInTheDocument()
    expect(shinkiCount()).toBe(renderedShinki(items))
    // 破棄済み keeps only discarded rows: d1 is the one 新規 row left.
    fireEvent.click(screen.getByRole('button', { name: /^filters\.discarded/ }))
    expect(shinkiCount()).toBe(1)
    expect(screen.getByText('破棄 新規')).toBeInTheDocument()
    expect(shinkiCount()).toBe(renderedShinki(items))
  })

  it('a DEGRADED read (the latched rows stay on screen): the count equals the rendered 新規 rows', () => {
    const { rerender } = renderList()
    rerender(
      <KaruteRecordListView
        items={[]}
        monthCount={5}
        total={null}
        initialWindowStart={null}
        initialHasMore={false}
        staffList={STAFF}
        currentStaffId="staff-1"
        customerOptions={[]}
      />,
    )
    // Degraded for real: the failure line is up, the last good rows stay.
    expect(screen.getByRole('alert')).toHaveTextContent('loadMoreFailed')
    expect(visibleNames()).toEqual(ITEMS.map((i) => i.customerName))
    expect(shinkiCount()).toBe(3)
    expect(shinkiCount()).toBe(renderedShinki(ITEMS))
    fireEvent.click(shinkiChip())
    expect(visibleNames()).toEqual(['顧客 n1', '顧客 n2', '顧客 n3'])
    expect(shinkiCount()).toBe(renderedShinki(ITEMS))
  })

  it('a first mount that is ALREADY degraded: the count equals the rendered 新規 rows', () => {
    renderList({ total: null, initialWindowStart: null })
    expect(shinkiCount()).toBe(renderedShinki(ITEMS))
    fireEvent.click(shinkiChip())
    expect(shinkiCount()).toBe(renderedShinki(ITEMS))
    expect(visibleNames()).toEqual(['顧客 n1', '顧客 n2', '顧客 n3'])
  })

  it('共有 mode: the count equals the rendered 新規 rows in that mode, and ANDs with the staff scope', async () => {
    const shared = [
      row('s1', true, { customerName: '共有 新規' }),
      row('s2', false, { customerName: '共有 再来' }),
      row('s3', null, { customerName: '共有 不明' }),
      row('s4', true, { customerName: '共有 他店員', staffId: 'staff-2', staffName: '鈴木 花子' }),
    ]
    loadKaruteWindow.mockImplementation(async ({ sharedOnly }: { sharedOnly?: boolean }) =>
      sharedOnly
        ? { items: shared, windowStart: '2026-01-01', freshSharedCount: shared.length, hasMore: false }
        : { items: [], windowStart: '2026-01-01', hasMore: false },
    )
    renderList({ sharedCount: shared.length, viewerHoldsViewShared: true })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^filters\.shared/ }))
    })
    // The mode swapped the rows: shared ones in, the default window out.
    expect(screen.getByText('共有 新規')).toBeInTheDocument()
    expect(screen.queryByText('顧客 n1')).not.toBeInTheDocument()
    expect(shinkiCount()).toBe(2) // s1 · s4 — false and null never count
    expect(shinkiCount()).toBe(renderedShinki(shared))
    fireEvent.click(shinkiChip())
    expect(screen.getByText('共有 新規')).toBeInTheDocument()
    expect(screen.getByText('共有 他店員')).toBeInTheDocument()
    expect(screen.queryByText('共有 再来')).not.toBeInTheDocument()
    expect(screen.queryByText('共有 不明')).not.toBeInTheDocument()
    expect(shinkiCount()).toBe(renderedShinki(shared))
    // Still in 共有 mode — 新規 is an AND, not an exit.
    expect(screen.getByRole('button', { name: /^filters\.shared/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // AND with the staff scope inside the mode: 自分 (one tap) leaves s1 only.
    fireEvent.click(screen.getByRole('button', { name: 'self' }))
    expect(shinkiCount()).toBe(1)
    expect(shinkiCount()).toBe(renderedShinki(shared))
  })
})

// S46 LEG 1b — the 新規 chip on top of option C: its count is trim step 2 of
// the chip row (CHIP_ROW_STEPS = badgeOnly → shinkiCount → ownRow). jsdom has
// no layout, so the row's widths are stubbed (the same seam option C's own
// suite uses); the real px are the fit proof's
// (scripts/fit-harness/shinki-on-c.mjs).
describe('trim step 2 — the 新規 count (widths stubbed)', () => {
  let rowWidth = 400
  /** One-line natural width of the row as rendered right now: month chip 80;
   *  the 新規 chip 60 + (its count while visible: 6 + 7 per digit); the staff
   *  control 150 with a name, 90 as badge only / 全スタッフ; gaps 8. */
  const natural = (row: Element) => {
    const chip = row.querySelector(':scope > button[aria-pressed]')
    const count = chip?.lastElementChild
    const chipW = chip
      ? 60 + (count && !count.classList.contains('sr-only') ? 6 + 7 * count.textContent!.length : 0)
      : 0
    const ctl = row.querySelector('[data-staff-scope]')
    const ctlW = ctl ? (ctl.querySelector('.truncate') ? 150 : 90) : 0
    return 80 + (chip ? 8 + chipW : 0) + (ctl ? 8 + ctlW : 0)
  }
  let spies: jest.SpyInstance[] = []
  beforeEach(() => {
    rowWidth = 400
    const origRect = Element.prototype.getBoundingClientRect
    spies = [
      jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
        return this.hasAttribute('data-chip-row') ? rowWidth : 0
      }),
      jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.hasAttribute('data-chip-row')) {
          const w = natural(this)
          return { width: w, height: 36, top: 0, left: 0, right: w, bottom: 36, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
        }
        return origRect.call(this)
      }),
    ]
  })
  afterEach(() => {
    spies.forEach((s) => s.mockRestore())
  })

  const chipRow = () => document.querySelector<HTMLElement>('[data-chip-row]')!
  const countSpan = () => shinkiChip().lastElementChild as HTMLElement
  const wordSpan = () => shinkiChip().firstElementChild as HTMLElement
  /** Mount at `width`, then pick 鈴木 花子 through the control's own list
   *  (a pick restarts the walk). Her 新規 count is 1 (n3). */
  const mountPicked = (width: number) => {
    rowWidth = width
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'title' }))
    fireEvent.click(screen.getByRole('option', { name: '鈴木 花子' }))
    expect(screen.getByRole('button', { name: '鈴木 花子' })).toHaveAttribute('aria-pressed', 'true')
  }

  it('switch OFF: no chip, and step 2 is never in the walk (badge → own row directly)', () => {
    // 鈴木 花子: 80 + 8 + 150 = 238; badge only 178. At 180: −58 → badge +2 → own row.
    mountPicked(180)
    expect(screen.queryByRole('button', { name: /^shinki/ })).not.toBeInTheDocument()
    expect(chipRow()).toHaveAttribute('data-trim', 'badgeOnly ownRow')
  })

  describe('switch ON', () => {
    beforeEach(() => {
      mockSwitches.shinkiChip = true
    })

    // 鈴木 花子 (count 1): full 80+8+73+8+150 = 319 · badge 259 · no count 246.
    it.each([
      [400, undefined], // +81
      [300, 'badgeOnly'], // −19 → badge +41
      [260, 'badgeOnly shinkiCount'], // badge +1 → no count +14
      [250, 'badgeOnly shinkiCount ownRow'], // no count +4 → own row
    ])('at %ipx the walk applies the prefix %s — order badgeOnly → shinkiCount → ownRow', (w, trim) => {
      mountPicked(w)
      if (trim === undefined) expect(chipRow()).not.toHaveAttribute('data-trim')
      else expect(chipRow()).toHaveAttribute('data-trim', trim)
      const dropped = (trim ?? '').includes('shinkiCount')
      expect(countSpan().classList.contains('sr-only')).toBe(dropped)
      // Own row keeps the 新規 chip on line 1 with the month: the break sits
      // after the chip, right before the control.
      if ((trim ?? '').includes('ownRow')) {
        expect(shinkiChip().nextElementSibling).toHaveAttribute('data-row-break')
      }
    })

    it('全スタッフ (no name to trim): step 2 applies first, before the own row', () => {
      // 全スタッフ (count 3): 80 + 8 + 73 + 8 + 90 = 259 → no count 246.
      rowWidth = 262 // +3 → no count +16
      renderList()
      expect(chipRow()).toHaveAttribute('data-trim', 'shinkiCount')
    })

    it('the count dropped: 新規 stays visible, the number leaves the screen but stays spoken', () => {
      // Untrimmed: the chip's accessible name = its word + its count.
      mountPicked(400)
      expect(chipRow()).not.toHaveAttribute('data-trim')
      expect(screen.getByRole('button', { name: 'shinki 1' })).toBe(shinkiChip())
      cleanup()
      window.localStorage.clear()
      // Step 2 applied: the same name — the count leaves the screen only.
      mountPicked(260)
      expect(chipRow()).toHaveAttribute('data-trim', 'badgeOnly shinkiCount')
      expect(wordSpan()).toHaveTextContent('shinki')
      expect(wordSpan().className).not.toContain('sr-only')
      expect(countSpan().className).toContain('sr-only')
      expect(countSpan()).toHaveTextContent('1')
      expect(screen.getByRole('button', { name: 'shinki 1' })).toBe(shinkiChip())
      // No aria-label: the name is the chip's own content (no new string).
      expect(shinkiChip()).not.toHaveAttribute('aria-label')
    })

    it('a toggle keeps the same steps (the chip is as wide on as off)', () => {
      mountPicked(260)
      expect(chipRow()).toHaveAttribute('data-trim', 'badgeOnly shinkiCount')
      fireEvent.click(shinkiChip())
      expect(shinkiChip()).toHaveAttribute('aria-pressed', 'true')
      expect(chipRow()).toHaveAttribute('data-trim', 'badgeOnly shinkiCount')
      expect(countSpan().className).toContain('sr-only')
    })

    it('the count alone changing its digits re-walks: 12 → (下書き) 1 gives the count back', () => {
      // 12 新規 rows, one of them 下書き. 全スタッフ: 80 + 8 + (60 + 6 + 14) + 8 + 90
      // = 266; with 1 digit 259; no count 246.
      const twelve = Array.from({ length: 12 }, (_, i) =>
        row(`t${i}`, true, i === 0 ? { aiStatus: 'draft', summary: '' } : {}),
      )
      rowWidth = 270 // 266 → +4 → no count +24
      renderList({ items: twelve, total: twelve.length })
      expect(shinkiCount()).toBe(12)
      expect(chipRow()).toHaveAttribute('data-trim', 'shinkiCount')
      // Only the count changes (a state pill is not a width input) — 1 digit:
      // 259 → +11, nothing to trim.
      fireEvent.click(screen.getByRole('button', { name: /^filters\.draft/ }))
      expect(shinkiCount()).toBe(1)
      expect(chipRow()).not.toHaveAttribute('data-trim')
      expect(countSpan().className).not.toContain('sr-only')
    })

    it('a count with more digits restarts the walk: back to 全スタッフ (3), the count is visible again', () => {
      // 全スタッフ at 300: 259 → +41, nothing trimmed; a pick at 260 drops the
      // count; 全スタッフ again re-walks from nothing trimmed.
      mountPicked(260)
      expect(chipRow()).toHaveAttribute('data-trim', 'badgeOnly shinkiCount')
      rowWidth = 300
      fireEvent.click(screen.getByRole('button', { name: 'title' }))
      fireEvent.click(screen.getByRole('option', { name: 'all' }))
      expect(chipRow()).not.toHaveAttribute('data-trim')
      expect(countSpan().className).not.toContain('sr-only')
      expect(shinkiCount()).toBe(3)
    })
  })
})
