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
    visitsDone: 0,
    visitsTotal: 0,
    lastVisitDate: '',
    lastVisitAgo: '',
    aiPredict: { label: '', when: '' },
    status,
    preferredStaffId: null,
    preferredStaffName: null,
    totalKarute: 0,
    phone: null,
    email: null,
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
    // Pick staff s-1 pill, then the followup status filter.
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
