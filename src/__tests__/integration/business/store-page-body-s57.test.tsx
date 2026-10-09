/**
 * @jest-environment jsdom
 */
// S57 P4b fix round — the お店ページ preview body as BEHAVIOUR: nothing in the picture takes keyboard focus while the
// わたしの記録 tabs stay clickable (R186), the open tab resets when the sample changes (R184, mock :2049-2052), the
// mock's block order under all 64 combinations (ATTACK-S57-P4B SF2), the rental lockers guard, the full-class rule
// `seats > 0` (mock :1813, N1), the badge guard (S3), zero care / posts, P4a's owed count gates (ATTACK-S57-P4A F2)
// and keys that cannot collide (N2 + P4a F4).
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'

afterEach(cleanup)

const LA = STORES.laestro
const FORCE = STORES.force
type Sample = typeof LA
// ONE sample that carries every block: LA's bookings + FORCE's classes + LA's products + FORCE's lockers, every count > 0
const ALL = {
  ...LA,
  counts: { packs: 3, classes: 12, care: 2, posts: 4, questions: 3, products: 3, resources: 24 },
  rv: { ...LA.rv, classes: FORCE.rv.classes, lockers: FORCE.rv.lockers },
} as unknown as Sample
const el = (on: readonly string[], sample: Sample) => (
  <ReserveCardPreview name="X" storeLine="" cardColor={null} view="store" on={new Set(on)} sample={sample} />
)
const withRv = (rv: Record<string, unknown>, base: Sample = ALL) => ({ ...base, rv: { ...base.rv, ...rv } } as unknown as Sample)
const withCount = (base: Sample, need: string, value: number | undefined, missing = false): Sample => {
  const counts: Record<string, unknown> = { ...base.counts }
  if (missing) delete counts[need]
  else counts[need] = value
  return { ...base, counts } as unknown as Sample
}
const tab = (c: ParentNode, name: string) => [...c.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!
const selected = (c: ParentNode) => c.querySelector('[role="tab"][aria-selected="true"]')!.textContent
const EVERY = ['intake', 'classes', 'posts', 'shop', 'rental', 'packs', 'homecare', 'checkin_qr', 'waitlist', 'read_points', 'reactions', 'photo_proof']

describe('R186: nothing inside the host-style wrapper takes keyboard focus; the tabs still switch on click', () => {
  it('every switch on: no element is in the Tab order, and focus() lands only on tabIndex -1 elements', () => {
    const { container } = render(<div className="cl-phone" aria-hidden="true" tabIndex={-1}>{el(EVERY, ALL)}</div>)
    const wrapper = container.firstElementChild as HTMLElement
    const inside = [...wrapper.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [tabindex]')]
    expect(inside.length).toBeGreaterThan(0)
    // the sequential-focus (Tab key) set: enabled controls, links with an href, anything with a tabindex other than -1
    const TABBABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const tabbable = [...wrapper.querySelectorAll<HTMLElement>(TABBABLE)].filter((n) => n.tabIndex >= 0)
    expect(tabbable.map((n) => `${n.tagName}:${n.textContent}`)).toEqual([])
    // focus each button / link and read document.activeElement: a script may focus a tabIndex -1 element, the keyboard cannot
    const tookFocus: string[] = []
    for (const n of inside) {
      n.focus()
      if (document.activeElement === n && n.tabIndex >= 0) tookFocus.push(`${n.tagName}:${n.textContent}`)
    }
    expect(tookFocus).toEqual([])
    expect(tab(wrapper, '来店履歴').tabIndex).toBe(-1)
    fireEvent.click(tab(wrapper, 'ホームケア'))
    expect(selected(wrapper)).toBe('ホームケア')
    fireEvent.click(tab(wrapper, '回数券'))
    expect(selected(wrapper)).toBe('回数券')
  })
})

describe('R184: the open わたしの記録 tab resets when the sample changes', () => {
  it('ホームケア open on La Estro, switch to STUDIO FORCE → 来店履歴', () => {
    const on = ['homecare']
    const { container, rerender } = render(el(on, LA))
    fireEvent.click(tab(container, 'ホームケア'))
    expect(selected(container)).toBe('ホームケア')
    rerender(el(on, FORCE as unknown as Sample))
    expect(selected(container)).toBe('来店履歴')
  })
})

// the mock's phoneMarkup order (MOCK-SWITCHBOARD-v2 :1795-1899)
const MOCK = ['intake', 'bookings', 'classes', 'posts', 'shop', 'rental', 'record', 'tabbar']
const SEL = '[data-cap="intake"], [data-cap="classes"], [data-cap="posts"], [data-cap="shop"], [data-cap="rental"], [data-record], .salon-tabbar, h2'
const order = (c: ParentNode) => [...c.querySelectorAll(SEL)].flatMap((n) => {
  if (n.tagName === 'H2') return n.textContent === 'ご予約' ? ['bookings'] : []
  if (n.hasAttribute('data-record')) return ['record']
  if (n.classList.contains('salon-tabbar')) return ['tabbar']
  return [n.getAttribute('data-cap')!]
})

describe('ORDER: every on/off combination of the five keyed blocks x bookings present/absent', () => {
  const KEYS = ['intake', 'classes', 'posts', 'shop', 'rental'] as const
  const combos: Array<[string, string[], boolean]> = []
  for (let m = 0; m < 32; m++) for (const bk of [true, false]) {
    const on = KEYS.filter((_, i) => m & (1 << i))
    combos.push([`${on.join('+') || 'none'}${bk ? ' +bookings' : ''}`, [...on], bk])
  }
  it.each(combos)('%s', (_n, on, bk) => {
    const s = bk ? ALL : withRv({ bookings: [] })
    const { container } = render(el(on, s))
    const want = MOCK.filter((k) => k === 'record' || k === 'tabbar' || (k === 'bookings' ? bk : on.includes(k)))
    expect(order(container)).toEqual(want)
  })
})

describe('guards and boundaries', () => {
  it('resources > 0 with lockers null draws no rental block', () => {
    const { container } = render(el(['rental'], withRv({ lockers: null })))
    expect(container.querySelector('[data-cap="rental"]')).toBeNull()
  })
  it('a full class (seats 0) carries data-full and the waitlist; a class with seats left carries neither', () => {
    const { container } = render(el(['classes', 'waitlist'], ALL))
    const rows = [...container.querySelectorAll('.salon-classes__row')]
    expect(rows.map((r) => r.hasAttribute('data-full'))).toEqual([false, true, false])
    expect(rows.map((r) => r.querySelector('[data-cap="waitlist"]') !== null)).toEqual([false, true, false])
  })
  it.each([[-1], [NaN]])('seats %p is full: 満席, data-full and the waitlist (the mock: c.seats > 0 ? … : full)', (seats) => {
    const { container } = render(el(['classes', 'waitlist'], withRv({ classes: [{ tm: '7:00', nm: 'A', sub: 's', seats }] })))
    const row = container.querySelector('.salon-classes__row')!
    expect(row.textContent).toContain('満席')
    expect(row.hasAttribute('data-full')).toBe(true)
    expect(row.querySelector('[data-cap="waitlist"]')).not.toBeNull()
  })
  it('a visit without a badge draws no .member-chip; a visit with one draws exactly one', () => {
    const none = render(el([], withRv({ visits: [{ t: 'A', money: '1', d: 'x' }, { t: 'B', d: 'y' }] }))).container
    expect(none.querySelectorAll('[data-record] .visit-row__t')).toHaveLength(2)
    expect(none.querySelectorAll('[data-record] .member-chip')).toHaveLength(0)
    cleanup()
    const one = render(el([], withRv({ visits: [{ t: 'A', badge: 'b', d: 'x' }, { t: 'B', d: 'y' }] }))).container
    expect(one.querySelectorAll('[data-record] .member-chip')).toHaveLength(1)
  })
  it('a zero care count hides the ホームケア tab; a zero posts count hides the posts block', () => {
    const c = render(el(['homecare', 'posts'], withCount(withCount(ALL, 'care', 0), 'posts', 0))).container
    expect(c.querySelector('[data-cap="homecare"]')).toBeNull()
    expect(c.querySelector('[data-cap="posts"]')).toBeNull()
    cleanup()
    const on = render(el(['homecare', 'posts'], ALL)).container
    expect(on.querySelector('[data-cap="homecare"]')).not.toBeNull()
    expect(on.querySelector('[data-cap="posts"]')).not.toBeNull()
  })
})

describe("P4a's owed count gates (packs with a next booking, intake, posts)", () => {
  const GATES: Array<[string, string, string]> = [
    ['packs', 'packs', '[data-cap="packs_chip"]'],
    ['intake', 'questions', '[data-cap="intake"]'],
    ['posts', 'posts', '[data-cap="posts"]'],
  ]
  const drawn = (on: readonly string[], s: Sample, sel: string) => {
    const hit = render(el(on, s)).container.querySelector(sel) !== null
    cleanup()
    return hit
  }
  it.each(GATES)('%s: count 0 hides, count MISSING hides, count > 0 with the switch OFF hides, count > 0 ON draws', (key, need, sel) => {
    expect(LA.rv.next.big).not.toBe('')
    expect(drawn([key], withCount(LA, need, 0), sel)).toBe(false)
    expect(drawn([key], withCount(LA, need, undefined, true), sel)).toBe(false)
    expect(drawn([], withCount(LA, need, 3), sel)).toBe(false)
    expect(drawn([key], withCount(LA, need, 3), sel)).toBe(true)
  })
})

describe('keys that cannot collide', () => {
  it('two rows with the same title / time / date in every keyed list render with no console.error', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    const s = withRv({
      posts: [{ t: 'A', d: '1' }, { t: 'A', d: '2' }],
      bookings: [{ t: 'A', s: '1' }, { t: 'A', s: '2' }],
      classes: [{ tm: '7:00', nm: 'A', sub: 's', seats: 1 }, { tm: '7:00', nm: 'B', sub: 's', seats: 2 }],
      products: [{ t: 'A', pr: '1', c: '#000' }, { t: 'A', pr: '2', c: '#000' }],
      visits: [{ t: 'A', d: 'x' }, { t: 'B', d: 'x' }],
    })
    const c = render(el(['posts', 'classes', 'shop'], s)).container
    const calls = err.mock.calls.map((a) => String(a[0]))
    err.mockRestore()
    expect(c.querySelectorAll('[data-cap="posts"] .member-row__t')).toHaveLength(2)
    expect(c.querySelectorAll('.salon-classes__row')).toHaveLength(2)
    expect(c.querySelectorAll('[data-cap="shop"] .member-row__t')).toHaveLength(2)
    expect(c.querySelectorAll('[data-record] .visit-row__t')).toHaveLength(2)
    expect(calls).toEqual([])
  })
})
