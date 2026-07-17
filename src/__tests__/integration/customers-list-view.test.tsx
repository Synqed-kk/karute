/**
 * @jest-environment jsdom
 *
 * Render coverage for CustomersListView (PR 17, replay/17): the client-side
 * filter composition (status AND staff), status-filter counts, 12-per-page
 * slicing, the page-reset-on-filter-change effect, and the empty / no-match
 * states.
 *
 * Heavy leaf components (header sheet, search input, row cards) are stubbed so
 * the test exercises ONLY the view's own list logic. The status-filter and
 * pagination children render for real (they're prop-driven and the behavior we
 * assert flows through them).
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { CustomerListRow, CustomerStatusKey } from '@/components/customers/redesign/types'

// Overridable per test (legacy-URL restore cases); reset in afterEach.
let mockSearch = ''
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}))
afterEach(() => {
  mockSearch = ''
})
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/customers',
  Link: ({ children }: { children: unknown }) => children,
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

// Stub the non-under-test leaves so we don't drag in CustomerSheet/forms,
// next/navigation search params, or the AI chip plumbing.
jest.mock('@/components/customers/redesign/list/CustomersListHeader', () => ({
  CustomersListHeader: ({ total, showing }: { total: number; showing: number }) => (
    <div data-testid="header">
      total={total} showing={showing}
    </div>
  ),
}))
jest.mock('@/components/customers/redesign/list/CustomerSearchInput', () => ({
  CustomerSearchInput: () => <div data-testid="search" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerRowDesktop', () => ({
  CustomerRowDesktop: ({ c }: { c: CustomerListRow }) => (
    <div data-testid="row-desktop">{c.name}</div>
  ),
}))
jest.mock('@/components/customers/redesign/list/CustomerCardMobile', () => ({
  CustomerCardMobile: ({ c }: { c: CustomerListRow }) => (
    <div data-testid="row-mobile">{c.name}</div>
  ),
}))

import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'

const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()

function row(over: Partial<CustomerListRow> = {}): CustomerListRow {
  const status: CustomerStatusKey = over.status ?? 'on-track'
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Customer',
    initials: 'CU',
    karuteNumber: '#00001',
    age: null,
    gender: null,
    joinDate: '',
    joinDateIso: iso(200),
    lastVisitDate: '',
    lastVisitAgo: '',
    aiPredict: { label: '', when: '' },
    status,
    preferredStaffId: null,
    preferredStaffName: null,
    totalKarute: 0,
    phone: null,
    ...over,
  }
}

// Each customer renders once per breakpoint layout (desktop + mobile), so the
// visible count of a name is 2× the paged rows.
const desktopRows = () => screen.queryAllByTestId('row-desktop')

describe('CustomersListView', () => {
  it('renders all rows (capped at the page size) and the registered total', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `c${i}`, name: `Name${i}` }))
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={42}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    expect(desktopRows()).toHaveLength(5)
    expect(screen.getByTestId('header')).toHaveTextContent('total=42 showing=5')
  })

  it('slices to 12 rows per page and exposes pagination for overflow', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: `c${i}`, name: `Name${i}` }))
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={20}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    expect(desktopRows()).toHaveLength(12)
    // Pagination footer present (more than one page).
    expect(screen.getByRole('button', { name: 'nextPage' })).toBeInTheDocument()
  })

  it('advances to the next page and shows the remaining rows', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: `c${i}`, name: `Name${i}` }))
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={20}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'nextPage' }))
    // Page 2 has the remaining 8 rows.
    expect(desktopRows()).toHaveLength(8)
  })

  it('computes the status-filter counts from the full row set', () => {
    const rows = [
      row({ status: 'needs-followup' }),
      row({ status: 'needs-followup' }),
      row({ status: 'dormant' }),
      row({ status: 'on-track' }),
      row({ status: 'new', joinDateIso: iso(5) }),
    ]
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={5}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    // The "all" filter pill shows the full count.
    expect(screen.getByText('filters.all').parentElement).toHaveTextContent('5')
    // followup pill → 2, dormant pill → 1.
    expect(screen.getByText('filters.followup').parentElement).toHaveTextContent('2')
    expect(screen.getByText('filters.dormant').parentElement).toHaveTextContent('1')
  })

  it('filters the list by status when a status pill is clicked', () => {
    const rows = [
      row({ id: 'a', name: 'Followup', status: 'needs-followup' }),
      row({ id: 'b', name: 'Healthy', status: 'on-track' }),
    ]
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={2}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    fireEvent.click(screen.getByText('filters.followup'))
    const visible = desktopRows()
    expect(visible).toHaveLength(1)
    expect(visible[0]).toHaveTextContent('Followup')
  })

  it('filters by staff and composes with the status filter (AND)', () => {
    const rows = [
      row({ id: 'a', name: 'MineFollowup', status: 'needs-followup', preferredStaffId: 's-1' }),
      row({ id: 'b', name: 'MineHealthy', status: 'on-track', preferredStaffId: 's-1' }),
      row({ id: 'c', name: 'TheirsFollowup', status: 'needs-followup', preferredStaffId: 's-2' }),
    ]
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={3}
        query=""
        selfStaffId="s-1"
        staffList={[
          { id: 's-1', name: 'Me', initials: 'ME' },
          { id: 's-2', name: 'Them', initials: 'TH' },
        ]}
      />,
    )
    // Open the 担当 trigger, pick staff s-1 in the sheet, then followup.
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.click(screen.getByText('Me'))
    fireEvent.click(screen.getByText('filters.followup'))
    const visible = desktopRows()
    expect(visible).toHaveLength(1)
    expect(visible[0]).toHaveTextContent('MineFollowup')
  })

  it('resets to page 1 when the filter changes (no stranded empty page)', () => {
    // 13 rows on-track + ... actually: 20 on-track so page 2 exists, then
    // switching to a filter with few matches must snap back to page 1.
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row({ id: `t${i}`, name: `Track${i}`, status: 'on-track' })),
      row({ id: 'd', name: 'Dorm', status: 'dormant' }),
    ]
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={21}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    // Go to page 2 of the on-track-heavy list.
    fireEvent.click(screen.getByRole('button', { name: 'nextPage' }))
    expect(desktopRows()).toHaveLength(9) // 21 - 12
    // Switch to the dormant filter (1 match) — must show it, not an empty page.
    fireEvent.click(screen.getByText('filters.dormant'))
    const visible = desktopRows()
    expect(visible).toHaveLength(1)
    expect(visible[0]).toHaveTextContent('Dorm')
  })

  it('shows the generic empty state when there are no rows and no query', () => {
    render(
      <CustomersListView
        rows={[]}
        totalRegistered={0}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    expect(screen.getByText('empty.title')).toBeInTheDocument()
    expect(desktopRows()).toHaveLength(0)
  })

  it('shows the no-match state (with the query interpolated) when a search yields nothing', () => {
    render(
      <CustomersListView
        rows={[]}
        totalRegistered={10}
        query="zzz"
        selfStaffId={null}
        staffList={[]}
      />,
    )
    expect(screen.getByText('noMatch:{"query":"zzz"}')).toBeInTheDocument()
    expect(screen.getByText('noMatchHint')).toBeInTheDocument()
  })

  it('does NOT render the 指名あり pill (removed by design — the 自分 staff pill covers it)', () => {
    const rows = [row({ preferredStaffId: 's-1' }), row({ preferredStaffId: 's-2' })]
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={2}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    expect(screen.queryByText('filters.preferredStaff')).toBeNull()
  })

  it('hides 要フォロー/休眠 pills while their count is 0 (no-data state)', () => {
    const rows = [row({ status: 'on-track' }), row({ status: 'on-track' })]
    render(
      <CustomersListView
        rows={rows}
        totalRegistered={2}
        query=""
        selfStaffId={null}
        staffList={[]}
      />,
    )
    expect(screen.queryByText('filters.followup')).toBeNull()
    expect(screen.queryByText('filters.dormant')).toBeNull()
  })
})

describe('案D stats strip', () => {
  it('honesty gate: bookingDataAvailable=false hides 予約なし (no confident 100% lie)', () => {
    const rows = [row({ id: 'a', nextBookingDate: null }), row({ id: 'b', nextBookingDate: null })]
    render(
      <CustomersListView rows={rows} totalRegistered={2} query="" selfStaffId={null} staffList={[]} bookingDataAvailable={false} />,
    )
    expect(screen.queryByText(/noBooking:/)).toBeNull()
  })

  it('予約なし counts in-play customers only (卒業/離客 excluded) and taps to filter', () => {
    const rows = [
      row({ id: 'a', name: 'NoBook', nextBookingDate: null }),
      row({ id: 'b', name: 'Booked', nextBookingDate: '6/15' }),
      row({ id: 'c', name: 'Grad', status: 'graduated', nextBookingDate: null }),
    ]
    render(
      <CustomersListView rows={rows} totalRegistered={3} query="" selfStaffId={null} staffList={[]} />,
    )
    // counts a but not c (graduated) → 1
    const stat = screen.getByText('noBooking:{"n":1}')
    fireEvent.click(stat)
    expect(screen.getByTestId('header')).toHaveTextContent('showing=1')
    // tap again clears back to all
    fireEvent.click(screen.getByText('noBooking:{"n":1}'))
    expect(screen.getByTestId('header')).toHaveTextContent('showing=3')
  })

  it('pack stats hide pre-import (no pack data) — 予約なし stays', () => {
    const rows = [row({ id: 'a', nextBookingDate: null }), row({ id: 'b', nextBookingDate: '6/20' })]
    render(
      <CustomersListView rows={rows} totalRegistered={2} query="" selfStaffId={null} staffList={[]} />,
    )
    expect(screen.getByText('noBooking:{"n":1}')).toBeInTheDocument()
    expect(screen.queryByText(/packRemaining/)).toBeNull()
    expect(screen.queryByText(/unconsumed:/)).toBeNull()
  })

  it('with pack data: 残１/残２/残３ bits + 未消化 total render', () => {
    const rows = [
      row({ id: 'a', pack: { remaining: 1, size: 6, unconsumed: 9900 }, packAlert: 'low', nextBookingDate: '6/15' }),
      row({ id: 'b', pack: { remaining: 4, size: 10, unconsumed: 39600 }, nextBookingDate: '6/16' }),
    ]
    render(
      <CustomersListView rows={rows} totalRegistered={2} query="" selfStaffId={null} staffList={[]} />,
    )
    expect(screen.getByText('packRemaining1:{"n":1}')).toBeInTheDocument()
    expect(screen.getByText('packRemaining2:{"n":0}')).toBeInTheDocument()
    expect(screen.getByText('packRemaining3:{"n":0}')).toBeInTheDocument()
    expect(screen.getByText('unconsumed:{"amount":"49,500"}')).toBeInTheDocument()
  })
})

describe('残数 quick filters (strip bits 残１/残２/残３)', () => {
  // 6/30 Kitano meeting → Liam-approved mock 7/17: the strip's old 残り1回
  // stat is three smaller tappable bits, exact remaining-count filters,
  // multi-select union, composable with 予約なし — the combo the sheet
  // couldn't do. Labels carry their own count: packRemainingN:{"n":count}.
  const packRows = () => [
    row({ id: 'r1', name: 'One', pack: { remaining: 1, size: 6, unconsumed: 9900 }, nextBookingDate: null }),
    row({ id: 'r1b', name: 'OneBooked', pack: { remaining: 1, size: 10, unconsumed: 9900 }, nextBookingDate: '6/20' }),
    row({ id: 'r2', name: 'Two', pack: { remaining: 2, size: 6, unconsumed: 19800 }, nextBookingDate: null }),
    row({ id: 'r4', name: 'Four', pack: { remaining: 4, size: 10, unconsumed: 39600 }, nextBookingDate: null }),
    row({ id: 'r0', name: 'NoPack', nextBookingDate: null }),
  ]
  const bit = (z: number, count: number) =>
    screen.getByText(`packRemaining${z}:{"n":${count}}`)

  it('hides the bits while no row has pack data', () => {
    render(
      <CustomersListView rows={[row({ id: 'a' })]} totalRegistered={1} query="" selfStaffId={null} staffList={[]} />,
    )
    expect(screen.queryByText(/packRemaining/)).toBeNull()
  })

  it('renders 残１/残２/残３ with exact-count numbers (残３ stays visible at 0)', () => {
    render(
      <CustomersListView rows={packRows()} totalRegistered={5} query="" selfStaffId={null} staffList={[]} />,
    )
    expect(bit(1, 2)).toBeInTheDocument()
    expect(bit(2, 1)).toBeInTheDocument()
    expect(bit(3, 0)).toBeInTheDocument()
  })

  it('tapping 残１ narrows to remaining===1; tapping again clears', () => {
    render(
      <CustomersListView rows={packRows()} totalRegistered={5} query="" selfStaffId={null} staffList={[]} />,
    )
    fireEvent.click(bit(1, 2))
    expect(bit(1, 2).closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('header')).toHaveTextContent('showing=2')
    expect(desktopRows().map((r) => r.textContent)).toEqual(['One', 'OneBooked'])
    fireEvent.click(bit(1, 2))
    expect(bit(1, 2).closest('button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('header')).toHaveTextContent('showing=5')
  })

  it('multi-select unions 残１+残２ (Kitano\'s「3回未満」population)', () => {
    render(
      <CustomersListView rows={packRows()} totalRegistered={5} query="" selfStaffId={null} staffList={[]} />,
    )
    fireEvent.click(bit(1, 2))
    fireEvent.click(bit(2, 1))
    expect(screen.getByTestId('header')).toHaveTextContent('showing=3')
    expect(desktopRows().map((r) => r.textContent)).toEqual(['One', 'OneBooked', 'Two'])
  })

  it('composes with 予約なし — 残１ × no booking (the sheet-impossible combo)', () => {
    render(
      <CustomersListView rows={packRows()} totalRegistered={5} query="" selfStaffId={null} staffList={[]} />,
    )
    fireEvent.click(bit(1, 2))
    fireEvent.click(screen.getByText('noBooking:{"n":4}'))
    expect(screen.getByTestId('header')).toHaveTextContent('showing=1')
    expect(desktopRows().map((r) => r.textContent)).toEqual(['One'])
  })

  it('the segmented status bar and the 残数 bits are independent controls', () => {
    render(
      <CustomersListView rows={packRows()} totalRegistered={5} query="" selfStaffId={null} staffList={[]} />,
    )
    // Activating a status segment must not clear the 残数 selection.
    fireEvent.click(bit(1, 2))
    fireEvent.click(screen.getByText('filters.all'))
    expect(bit(1, 2).closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('header')).toHaveTextContent('showing=2')
  })
})

describe('UltraCode fix round (7/17)', () => {
  const packRows = () => [
    row({ id: 'r1', name: 'One', pack: { remaining: 1, size: 6, unconsumed: 9900 }, packAlert: 'low', nextBookingDate: null }),
    row({ id: 'r2', name: 'Two', pack: { remaining: 2, size: 6, unconsumed: 19800 }, nextBookingDate: '6/20' }),
    row({ id: 'r0', name: 'NoPack', nextBookingDate: null }),
  ]

  it('legacy ?f=packLow migrates to the 残１ bit (visible + clearable, list narrowed)', () => {
    mockSearch = 'f=packLow'
    render(
      <CustomersListView rows={packRows()} totalRegistered={3} query="" selfStaffId={null} staffList={[]} />,
    )
    // Migrated: the 残１ bit is pressed and the list shows only remaining===1.
    const bit1 = screen.getByText('packRemaining1:{"n":1}').closest('button')
    expect(bit1).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('header')).toHaveTextContent('showing=1')
    expect(desktopRows().map((r) => r.textContent)).toEqual(['One'])
    // No segment falsely active-less: すべて stays the pressed status segment.
    expect(screen.getByText('filters.all').closest('button')).toHaveAttribute('aria-pressed', 'true')
    // Tap-to-clear works — the invariant the legacy key violated.
    fireEvent.click(bit1!)
    expect(screen.getByTestId('header')).toHaveTextContent('showing=3')
  })

  it('a 0-count 残n bit shows the filter-no-match state, never the onboarding empty state', () => {
    render(
      <CustomersListView rows={packRows()} totalRegistered={3} query="" selfStaffId={null} staffList={[]} />,
    )
    fireEvent.click(screen.getByText('packRemaining3:{"n":0}'))
    expect(screen.getByText('filterNoMatch')).toBeInTheDocument()
    expect(screen.getByText('noMatchHint')).toBeInTheDocument()
    expect(screen.queryByText('empty.title')).toBeNull()
  })

  it('the true first-run empty state (zero rows) is unchanged', () => {
    render(
      <CustomersListView rows={[]} totalRegistered={0} query="" selfStaffId={null} staffList={[]} />,
    )
    expect(screen.getByText('empty.title')).toBeInTheDocument()
    expect(screen.queryByText('filterNoMatch')).toBeNull()
  })

  it('予約なし stat announces aria-pressed like the bits beside it', () => {
    render(
      <CustomersListView rows={packRows()} totalRegistered={3} query="" selfStaffId={null} staffList={[]} />,
    )
    const noBooking = screen.getByText('noBooking:{"n":2}').closest('button')
    expect(noBooking).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(noBooking!)
    expect(noBooking).toHaveAttribute('aria-pressed', 'true')
  })
})
