/**
 * @jest-environment jsdom
 *
 * 顧客 list entrance cascade — plays ONCE per app session (TABCALM, 2026-09-01).
 *
 * Liam, 2026-09-01: "Every time I click on the 顧客 tab the list of customers
 * scrolls in from the top, every time … it just looks broken." Root cause,
 * measured in a real browser against a real App Router navigation
 * (.build-evidence/repro/before/report.json): the shared layout's mount count
 * stays at 1 while the page segment's climbs on every visit, so the rows are
 * brand-new DOM each time and their `animate-in` cascade replays from zero.
 *
 * These lock the fix at the two seams that matter:
 *   1. the module-scope gate (useEntranceOnce) — true on the first mount of
 *      the session, false forever after;
 *   2. the rows — entrance classes AND the inline animationDelay both present
 *      when the list hands them a cascade index, both ABSENT when it hands
 *      them null.
 * Plus the SSR contract: the flag is never flipped during render, so a hard
 * load's server pass and its first client render emit the SAME classes (no
 * hydration mismatch) — proven here by hydrating server markup with a
 * console.error spy.
 */
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import type { CustomerListRow } from '@/components/customers/redesign/types'

// react-dom/server resolves to its BROWSER build under @jest-environment jsdom,
// and that build reaches for MessageChannel + TextEncoder at IMPORT time —
// neither of which jsdom ships. Load it in beforeAll, after the stubs are in
// place. The channel stub is inert on purpose: renderToString is synchronous
// and never posts on it, while node's real MessageChannel holds an open handle
// that stops jest exiting.
let renderToString: (el: React.ReactElement) => string
beforeAll(async () => {
  const g = globalThis as unknown as {
    MessageChannel?: unknown
    TextEncoder?: unknown
    TextDecoder?: unknown
  }
  g.MessageChannel ??= class {
    port1 = { onmessage: null, close() {} }
    port2 = { postMessage() {}, close() {} }
  }
  const util = await import('node:util')
  g.TextEncoder ??= util.TextEncoder
  g.TextDecoder ??= util.TextDecoder
  ;({ renderToString } = await import('react-dom/server'))
})

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/customers',
  // className AND style pass through — the entrance lives in both.
  Link: ({
    children,
    className,
    style,
  }: {
    children?: React.ReactNode
    className?: string
    style?: React.CSSProperties
  }) => (
    <a className={className} style={style}>
      {children}
    </a>
  ),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
// Heavy leaves the entrance has nothing to do with.
jest.mock('@/components/customers/redesign/list/CustomersListHeader', () => ({
  CustomersListHeader: () => <div data-testid="header" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerSearchInput', () => ({
  CustomerSearchInput: () => <div data-testid="search" />,
}))

import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import { CustomerCardMobile } from '@/components/customers/redesign/list/CustomerCardMobile'
import { CustomerRowDesktop } from '@/components/customers/redesign/list/CustomerRowDesktop'
import {
  useEntranceOnce,
  __resetEntranceOnceForTests,
} from '@/components/customers/redesign/list/entrance-once'

const ENTRANCE_CLASS = 'motion-safe:animate-in'

function row(over: Partial<CustomerListRow> = {}): CustomerListRow {
  return {
    id: 'c1',
    name: 'Customer',
    initials: 'CU',
    karuteNumber: '#00001',
    age: null,
    gender: null,
    joinDate: '',
    joinDateIso: null,
    lastVisitDate: '—',
    lastVisitAgo: '',
    aiPredict: { label: '', when: '' },
    status: 'on-track',
    preferredStaffId: null,
    preferredStaffName: null,
    totalKarute: 0,
    phone: null,
    ...over,
  }
}

const list = (rows: CustomerListRow[]) => (
  <CustomersListView
    rows={rows}
    totalRegistered={rows.length}
    query=""
    selfStaffId={null}
    staffList={[]}
    assignableStaff={[]}
  />
)

/** Every rendered row anchor (desktop grid + mobile card both render). */
const rowAnchors = (c: HTMLElement) =>
  [...c.querySelectorAll('a')].filter((a) => a.className.includes('border-b'))

beforeEach(() => {
  __resetEntranceOnceForTests()
})

describe('useEntranceOnce — the module-scope session gate', () => {
  function Probe() {
    return <span data-testid="play">{String(useEntranceOnce())}</span>
  }

  it('is true on the first mount of the session and false on every later one', () => {
    const first = render(<Probe />)
    expect(screen.getByTestId('play')).toHaveTextContent('true')
    first.unmount()

    // A tab hop remounts the page component — same module instance.
    render(<Probe />)
    expect(screen.getByTestId('play')).toHaveTextContent('false')
  })

  it('resets on a hard reload (a fresh module instance)', () => {
    render(<Probe />).unmount()
    __resetEntranceOnceForTests() // stands in for a fresh page load
    render(<Probe />)
    expect(screen.getByTestId('play')).toHaveTextContent('true')
  })

  it('the reset seam refuses to run outside tests', () => {
    // An accidental production import must not be able to silently re-arm the
    // cascade — the seam throws rather than quietly defeating the contract.
    const env = process.env as { NODE_ENV?: string }
    const prev = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      expect(() => __resetEntranceOnceForTests()).toThrow(/test-only/)
    } finally {
      env.NODE_ENV = prev
    }
  })
})

describe('CustomersListView — cascade on first mount, never on a re-visit', () => {
  it('first mount: rows carry the entrance classes AND their stagger delay', () => {
    const { container } = render(list([row({ id: 'a' }), row({ id: 'b' })]))
    const anchors = rowAnchors(container)
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) expect(a.className).toContain(ENTRANCE_CLASS)
    // Desktop row 0 and mobile row 0 both sit at index 0; index 1 staggers 40ms.
    const delays = anchors.map((a) => a.style.animationDelay)
    expect(delays).toContain('0ms')
    expect(delays).toContain('40ms')
  })

  it('re-visit (unmount + remount in the same session): NO entrance, NO delay', () => {
    render(list([row({ id: 'a' }), row({ id: 'b' })])).unmount()

    const { container } = render(list([row({ id: 'a' }), row({ id: 'b' })]))
    const anchors = rowAnchors(container)
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      expect(a.className).not.toContain(ENTRANCE_CLASS)
      // The inline delay is omitted too — not merely zeroed.
      expect(a.style.animationDelay).toBe('')
    }
  })

  it('the resting row visuals are otherwise byte-identical across the two', () => {
    // Only the entrance classes and the delay may differ; nothing else about
    // the row is allowed to move (Liam: resting design stays pixel-identical).
    const first = render(list([row({ id: 'a' })]))
    const before = rowAnchors(first.container)[0].className
    first.unmount()

    const second = render(list([row({ id: 'a' })]))
    const after = rowAnchors(second.container)[0].className

    const strip = (s: string) =>
      s
        .split(/\s+/)
        .filter((c) => c && !c.startsWith('motion-safe:'))
        .join(' ')
    expect(strip(after)).toBe(strip(before))
  })
})

describe('row components — the entranceIndex contract', () => {
  it.each([
    ['CustomerCardMobile', CustomerCardMobile],
    ['CustomerRowDesktop', CustomerRowDesktop],
  ])('%s: a numeric index animates and staggers', (_name, Row) => {
    const { container } = render(
      <Row c={row()} staffColorKey={null} entranceIndex={3} />,
    )
    const a = container.querySelector('a')!
    expect(a.className).toContain(ENTRANCE_CLASS)
    expect(a.style.animationDelay).toBe('120ms')
  })

  it.each([
    ['CustomerCardMobile', CustomerCardMobile],
    ['CustomerRowDesktop', CustomerRowDesktop],
  ])('%s: null means no animation and no delay at all', (_name, Row) => {
    const { container } = render(
      <Row c={row()} staffColorKey={null} entranceIndex={null} />,
    )
    const a = container.querySelector('a')!
    expect(a.className).not.toContain(ENTRANCE_CLASS)
    expect(a.style.animationDelay).toBe('')
  })

  it('karute-context cards obey the same gate (the karuteContext render path)', () => {
    const { container: off } = render(
      <CustomerCardMobile
        c={row()}
        staffColorKey={null}
        karuteContext
        entranceIndex={null}
      />,
    )
    const { container: on } = render(
      <CustomerCardMobile
        c={row()}
        staffColorKey={null}
        karuteContext
        entranceIndex={0}
      />,
    )
    expect(off.querySelector('a')!.className).not.toContain(ENTRANCE_CLASS)
    expect(on.querySelector('a')!.className).toContain(ENTRANCE_CLASS)
    // The karute density class survives on both — the gate touches motion only.
    expect(off.querySelector('a')!.className).toContain('py-2.5')
    expect(on.querySelector('a')!.className).toContain('py-2.5')
  })
})

describe('SSR contract — a hard load agrees with its own hydration', () => {
  it('server pass emits the entrance classes (the flag never flips on the server)', () => {
    const html = renderToString(
      <CustomerCardMobile c={row()} staffColorKey={null} entranceIndex={2} />,
    )
    expect(html).toContain(ENTRANCE_CLASS)
    expect(html).toContain('80ms')
  })

  it('hydrating that server markup logs no hydration mismatch', () => {
    function Page() {
      const play = useEntranceOnce()
      return (
        <CustomerCardMobile
          c={row()}
          staffColorKey={null}
          entranceIndex={play ? 0 : null}
        />
      )
    }
    // Server pass: effects never run, so the flag stays false and `play` is true.
    const html = renderToString(<Page />)
    expect(html).toContain(ENTRANCE_CLASS)

    const errors: unknown[][] = []
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args) => void errors.push(args))
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    act(() => {
      hydrateRoot(host, <Page />)
    })
    spy.mockRestore()

    const mismatches = errors
      .map((a) => String(a[0]))
      .filter((m) => /hydrat|did not match|server (?:HTML|rendered)/i.test(m))
    expect(mismatches).toEqual([])
    // And the hydrated DOM still carries the first-load cascade.
    expect(host.querySelector('a')!.className).toContain(ENTRANCE_CLASS)
  })

  it('the SECOND mount of the session renders without the cascade — client only', () => {
    function Page() {
      const play = useEntranceOnce()
      return (
        <CustomerCardMobile
          c={row()}
          staffColorKey={null}
          entranceIndex={play ? 0 : null}
        />
      )
    }
    const host1 = document.createElement('div')
    document.body.appendChild(host1)
    const r1 = createRoot(host1)
    act(() => r1.render(<Page />))
    expect(host1.querySelector('a')!.className).toContain(ENTRANCE_CLASS)
    act(() => r1.unmount())

    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const r2 = createRoot(host2)
    act(() => r2.render(<Page />))
    expect(host2.querySelector('a')!.className).not.toContain(ENTRANCE_CLASS)
    act(() => r2.unmount())
  })
})
