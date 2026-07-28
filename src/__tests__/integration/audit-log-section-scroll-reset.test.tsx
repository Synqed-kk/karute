/** @jest-environment jsdom */
// Filter-change scroll reset (field report 7/28, same class as Greptile
// #595): a filter tap (actor-name tap, category/range/staff select, 閲覧を
// 含む, 特権アクセス, 警告 lens) can collapse a long feed to ~1 row while the
// user is scrolled deep — the viewport then sits past the new content, which
// reads as a white screen. AuditLogSection resets scroll to 0 on any state
// that REPLACES the feed, but never on a load-more append (same filters,
// next page). Same harness as audit-log-section-stats.test.tsx: renders the
// REAL component with only the server-action boundary mocked.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => false }),
  useLocale: () => 'ja',
}))

const listAuditLog = jest.fn()
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
}))

jest.mock('@/actions/karute', () => ({
  listEntryEditHistory: jest.fn(async () => ({ edits: [], truncated: false })),
}))

import { AuditLogSection } from '@/components/settings/redesign/sections/AuditLogSection'

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    at: '2026-07-21T00:00:00.000Z',
    actor_id: 'staff-1',
    actor_type: 'staff',
    category: 'customer',
    action: 'customer.edit',
    target_type: null,
    target_id: null,
    target_label: null,
    detail: null,
    break_glass: false,
    severity: 'info',
    ...overrides,
  }
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    events: [coreEvent()],
    total: 1,
    page: 1,
    hasMore: false,
    breakGlassTotal: 0,
    warningsTotal: 0,
    changesTotal: 1,
    targetLabels: {},
    ...overrides,
  }
}

beforeEach(() => {
  listAuditLog.mockReset()
})

describe('AuditLogSection — filter-change scroll reset (#595 mechanism)', () => {
  it('a filter change (range preset) resets scroll to the top', async () => {
    listAuditLog.mockResolvedValue(page())
    const { container } = render(<AuditLogSection staffList={[]} />)
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())

    container.scrollTop = 250
    expect(container.scrollTop).toBe(250)

    // '30d' is the default range — click a DIFFERENT preset so `range`
    // actually changes (same value would bail out of the state update).
    // The reset itself is synchronous (useLayoutEffect, same render pass as
    // the click) — awaiting the reload it also triggers just settles the
    // dangling promise before the test ends (no act() warning).
    listAuditLog.mockResolvedValue(page())
    fireEvent.click(screen.getByText('range.7d'))
    expect(container.scrollTop).toBe(0)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
  })

  it('load-more (same filters, next page) does NOT reset scroll', async () => {
    listAuditLog.mockResolvedValue(page({ hasMore: true }))
    const { container } = render(<AuditLogSection staffList={[]} />)
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())

    container.scrollTop = 250

    // Distinct id from page 1's event (same 'e1' default would render two
    // list items with the same React key — harmless to this test's
    // assertion, but a needless dev-mode warning).
    listAuditLog.mockResolvedValue(page({ events: [coreEvent({ id: 'e2' })], page: 2, hasMore: false }))
    fireEvent.click(screen.getByText('loadMore'))
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))

    expect(container.scrollTop).toBe(250)
  })

  it('the 警告 lens (client-side, never calls load()) also resets scroll', async () => {
    listAuditLog.mockResolvedValue(
      page({ events: [coreEvent({ severity: 'warn' })], warningsTotal: 1, changesTotal: 0 }),
    )
    const { container } = render(<AuditLogSection staffList={[]} />)
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())

    container.scrollTop = 250
    fireEvent.click(screen.getByText('statsWarnings'))

    expect(container.scrollTop).toBe(0)
    // Confirms warnOnly never went through a reload (the mechanism this test
    // is pinning is the client-side lens, not a network refetch).
    expect(listAuditLog).toHaveBeenCalledTimes(1)
  })
})
