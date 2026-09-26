/** @jest-environment jsdom */
/**
 * KaruteRecordListView's status-line rendering contract (Greptile PR #775
 * round 2): the LIST is primary, the count is auxiliary — a failed count
 * must never render as a fake number.
 *   - total !== null, monthCount !== null → the full statusLine key.
 *   - total !== null, monthCount === null → statusLineNoMonth (今月 probe
 *     failed alone; never render a fake 「今月 0件」).
 *   - total === null → NO status line at all (the main read itself failed;
 *     the empty/degraded list below already tells the honest story).
 *
 * next-intl is mocked to echo the KEY + its params (never the interpolated
 * copy) — these pin WHICH key fires and WHAT it was told, never the exact
 * wording (that's karute-statusline-copy.test.ts's job). Extended 2026-09-13
 * (R1/F1 repair) to echo params too — the discarded-repair tests below need
 * to see the actual numbers a mutant could get wrong (e.g. `total` silently
 * staying active-only), which a bare-key echo can't catch.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/karute',
  // Added for the discarded-repair tests below, which (unlike the four
  // original tests) render real rows via KaruteListRow — an active row is a
  // Link, same stub idiom as karute-chunk-load.test.tsx.
  Link: ({ children, ...rest }: { children?: React.ReactNode; href?: string }) => (
    <a {...rest}>{children}</a>
  ),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => new URLSearchParams(),
}))
// Heavy dialog, irrelevant to the status line — same narrow-stub convention
// management-flag-wiring.test.tsx already uses for this exact component.
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: () => null,
}))
// KaruteRecordListView imports revealNoKaruteCustomer directly — the real
// 'use server' module pulls in next/cache's unstable_cache, which needs a
// DOM API (TextEncoder) this jsdom suite doesn't polyfill.
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
}))

import { render, screen } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'

describe('KaruteRecordListView status line (Greptile PR #775 round 2)', () => {
  it('data OK + probe OK: renders the full statusLine key, never statusLineNoMonth', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={26}
        total={312}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.getByText(/^statusLine:/)).toBeInTheDocument()
    expect(screen.queryByText(/^statusLineNoMonth/)).not.toBeInTheDocument()
  })

  it('data OK + probe null: omits 今月 — renders statusLineNoMonth, never statusLine', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={null}
        total={312}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.getByText(/^statusLineNoMonth:/)).toBeInTheDocument()
    expect(screen.queryByText(/^statusLine:/)).not.toBeInTheDocument()
  })

  it('data null (main read failed): renders NO status line at all, regardless of monthCount', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={26}
        total={null}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.queryByText('statusLine')).not.toBeInTheDocument()
    expect(screen.queryByText('statusLineNoMonth')).not.toBeInTheDocument()
  })

  it('total omitted (prop default) behaves the same as data null — no status line', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={26}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.queryByText('statusLine')).not.toBeInTheDocument()
    expect(screen.queryByText('statusLineNoMonth')).not.toBeInTheDocument()
  })
})

// R1 repair (2026-09-13, F1): 全件 must name active+discarded once any
// discarded row exists, so 表示中 (which counts both under すべて — see
// KaruteRecordListView.tsx's `filtered` block) can never read larger than 全.
// next-intl still echoes the bare key here — WHICH key fires is this file's
// job; the exact interpolated wording is karute-statusline-copy.test.ts's.
function discardedItem(id: string): import('@/components/karute/spike-lifted/list/types').KaruteListItem {
  return {
    id,
    customerId: `c-${id}`,
    customerName: '破棄 太郎',
    customerInitials: '破',
    customerKaruteNumber: '#00009',
    date: '2026-09-10',
    weekday: '木',
    service: 'カット',
    duration: 0,
    staffId: null,
    staffColorKey: null,
    staffName: '—',
    summary: '',
    aiStatus: 'draft',
    conversionStatus: 'provisional',
    isDiscarded: true,
    href: `/karute/${id}`,
  }
}
function activeItem(id: string): import('@/components/karute/spike-lifted/list/types').KaruteListItem {
  return {
    ...discardedItem(id),
    customerName: '有効 花子',
    summary: 'まとめ',
    isDiscarded: undefined,
  }
}

describe('KaruteRecordListView status line — discarded repair (F1, 2026-09-13)', () => {
  it('discarded > 0: renders statusLineDiscarded (never the plain statusLine), 全 = active+discarded, 表示中 counts both', () => {
    render(
      <KaruteRecordListView
        items={[activeItem('a1'), activeItem('a2'), discardedItem('d1'), discardedItem('d2'), discardedItem('d3')]}
        monthCount={4}
        total={2}
        discardedCount={3}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    // total(2) + discarded(3) + monthCount(4) + showingCount(5, all 5 loaded
    // rows under the default すべて filter) — the mutant this proves: reverting
    // `total` back to the active-only storeTotal (2 instead of 5) goes RED.
    expect(
      screen.getByText(
        'statusLineDiscarded:{"total":5,"discarded":3,"monthCount":4,"showingCount":5}',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^statusLine:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^statusLineNoMonth/)).not.toBeInTheDocument()
  })

  it('discarded > 0, month probe failed: statusLineNoMonthDiscarded, never statusLineNoMonth', () => {
    render(
      <KaruteRecordListView
        items={[activeItem('a1'), discardedItem('d1')]}
        monthCount={null}
        total={1}
        discardedCount={1}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(
      screen.getByText('statusLineNoMonthDiscarded:{"total":2,"discarded":1,"showingCount":2}'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^statusLineNoMonth:/)).not.toBeInTheDocument()
  })

  it('discarded === 0: byte-for-byte the old statusLine key, never the discarded variant', () => {
    render(
      <KaruteRecordListView
        items={[activeItem('a1'), activeItem('a2')]}
        monthCount={4}
        total={2}
        discardedCount={0}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(
      screen.getByText('statusLine:{"total":2,"monthCount":4,"showingCount":2}'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Discarded/)).not.toBeInTheDocument()
  })
})
