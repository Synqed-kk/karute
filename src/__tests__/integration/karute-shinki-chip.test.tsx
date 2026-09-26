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

import { act, fireEvent, render, screen } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'

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
})
afterEach(() => {
  jest.restoreAllMocks()
  delete (window as { matchMedia?: unknown }).matchMedia
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
})

describe('switch ON (test-only mock)', () => {
  beforeEach(() => {
    mockSwitches.shinkiChip = true
  })

  it('renders the chip between the month chip and 担当, OFF by default, outline', () => {
    renderList()
    const chip = shinkiChip()
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(chip.className).not.toContain('bg-primary/8')
    const row3 = chip.parentElement!
    const buttons = Array.from(row3.children).flatMap((el) =>
      el.tagName === 'BUTTON' ? [el] : Array.from(el.querySelectorAll(':scope > button')),
    )
    const idx = buttons.indexOf(chip)
    expect(buttons[idx - 1].textContent).toMatch(/^\d{4}年\d{1,2}月/)
    expect(buttons[idx + 1].textContent).toMatch(/^all$/)
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
    fireEvent.click(screen.getByRole('button', { name: /^(all|self)$/ }))
    fireEvent.click(screen.getByRole('option', { name: 'self' }))
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

// The ✓ GLIDE (FLIP). jsdom has no layout, so getBoundingClientRect is stubbed:
// the 担当 chip sits 20px further right once the ✓ is in the 新規 chip. What
// is pinned: the inverse translateX is applied and then cleared back to 0
// (transform only), will-change lives only while gliding (cleared on
// transitionend), and under reduced motion nothing is written at all.
describe('the ✓ glide (switch ON)', () => {
  beforeEach(() => {
    mockSwitches.shinkiChip = true
  })

  function armLayout() {
    const chip = shinkiChip()
    const staffWrap = screen.getByRole('button', { name: /^(all|self)$/ }).parentElement!
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const on = chip.getAttribute('aria-pressed') === 'true'
      const left = this === staffWrap ? (on ? 220 : 200) : 0
      return { left, top: 0, right: left, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect
    })
    // Record every transform written to the staff chip's wrapper.
    const writes: string[] = []
    const style = staffWrap.style
    let proto: object | null = Object.getPrototypeOf(style)
    while (proto && !Object.getOwnPropertyDescriptor(proto, 'transform')) {
      proto = Object.getPrototypeOf(proto)
    }
    const native = Object.getOwnPropertyDescriptor(proto!, 'transform')!
    Object.defineProperty(style, 'transform', {
      configurable: true,
      get: () => native.get!.call(style),
      set: (v: string) => {
        writes.push(v)
        native.set!.call(style, v)
      },
    })
    return { staffWrap, writes }
  }

  it('applies the inverse translateX, then glides it back to 0; will-change only while gliding', () => {
    renderList()
    const { staffWrap, writes } = armLayout()
    fireEvent.click(shinkiChip())
    // settle-in-flight '' → Invert (from 200 to 220 = −20px) → Play ''.
    expect(writes).toEqual(['', 'translateX(-20px)', ''])
    expect(staffWrap.style.transform).toBe('')
    expect(staffWrap.style.transition).toContain('transform 150ms cubic-bezier(0.23, 1, 0.32, 1)')
    expect(staffWrap.style.willChange).toBe('transform')
    // A bubbled transition from a child (the chevron) does NOT end the glide.
    const child = Object.assign(new Event('transitionend', { bubbles: true }), {
      propertyName: 'transform',
    })
    staffWrap.firstElementChild!.dispatchEvent(child)
    expect(staffWrap.style.willChange).toBe('transform')
    const own = Object.assign(new Event('transitionend'), { propertyName: 'transform' })
    staffWrap.dispatchEvent(own)
    expect(staffWrap.style.willChange).toBe('')
    expect(staffWrap.style.transition).toBe('')
  })

  it('reduced motion: the chip still toggles, and no transform is ever written', () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    renderList()
    const { staffWrap, writes } = armLayout()
    fireEvent.click(shinkiChip())
    expect(shinkiChip()).toHaveAttribute('aria-pressed', 'true')
    expect(writes).toEqual([])
    expect(staffWrap.style.willChange).toBe('')
  })
})
