/** @jest-environment jsdom */
// AuditLogSection's summary-strip + actor-label rendering (packet 18 T1/T3).
// Renders the REAL component (not mocked away, unlike
// settings-shell-pending-tabs.test.tsx) with only the server-action boundary
// mocked — same seam audit-log-action.test.ts mocks.
import { render, waitFor } from '@testing-library/react'
import type { StaffMember } from '@/lib/staff'

jest.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => false }),
  useLocale: () => 'ja',
}))

const listAuditLog = jest.fn()
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
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

// The three strip tiles (changes/warnings/breakGlass) all share this class —
// DOM order matches source order, so index into it rather than matching by
// text (the count + approx '+' render as adjacent text nodes in one span).
function statSpans(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.tabular-nums')).map((n) => n.textContent)
}

beforeEach(() => {
  listAuditLog.mockReset()
})

describe('AuditLogSection — strip counts prefer server totals (T1)', () => {
  it('server totals non-null → exact counts, no + suffix even though hasMore is true', async () => {
    listAuditLog.mockResolvedValue({
      ok: true,
      events: [coreEvent({ severity: 'warn' }), coreEvent({ id: 'e2', severity: 'info' })],
      total: 2,
      page: 1,
      hasMore: true,
      breakGlassTotal: 0,
      warningsTotal: 5,
      changesTotal: 9,
      targetLabels: {},
    })
    const { container } = render(<AuditLogSection staffList={[]} />)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalled())

    const [changes, warnings] = await waitFor(() => {
      const spans = statSpans(container)
      expect(spans[0]).toBe('9')
      expect(spans[1]).toBe('5')
      return spans
    })
    expect(changes).toBe('9') // exact server total, no '+'
    expect(warnings).toBe('5')
  })

  it('probes failed (both totals null) → falls back to the client-side loaded-window count, with the + suffix (hasMore true)', async () => {
    listAuditLog.mockResolvedValue({
      ok: true,
      events: [coreEvent({ severity: 'warn' }), coreEvent({ id: 'e2', severity: 'info' })],
      total: 2,
      page: 1,
      hasMore: true,
      breakGlassTotal: 0,
      warningsTotal: null,
      changesTotal: null,
      targetLabels: {},
    })
    const { container } = render(<AuditLogSection staffList={[]} />)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalled())

    await waitFor(() => {
      const spans = statSpans(container)
      // 1 warn-severity event, 1 info/non-view event in the loaded window —
      // '+' marks "more pages exist" since probes degraded.
      expect(spans[0]).toBe('1+')
      expect(spans[1]).toBe('1+')
    })
  })
})

describe('AuditLogSection — actor name (T3: label wins, roster fallback, 不明 last)', () => {
  const staffList: StaffMember[] = [
    { id: 'staff-1', full_name: 'Roster Name', has_pin: true, created_at: '2026-01-01' },
  ]

  // Scoped to the event LIST, not the whole container — the toolbar's
  // person-filter dropdown always lists every roster name as an <option>,
  // which would false-positive a whole-container text check.
  async function renderEventRow(overrides: Record<string, unknown>) {
    listAuditLog.mockResolvedValue({
      ok: true,
      events: [coreEvent(overrides)],
      total: 1,
      page: 1,
      hasMore: false,
      breakGlassTotal: 0,
      warningsTotal: 0,
      changesTotal: 1,
      targetLabels: {},
    })
    const { container } = render(<AuditLogSection staffList={staffList} />)
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
    return container.querySelector('ul') as HTMLElement
  }

  it('a durable actor_label wins over the live roster name', async () => {
    const row = await renderEventRow({ actor_id: 'staff-1', actor_label: '田中 美香' })
    expect(row.textContent).toContain('田中 美香')
    expect(row.textContent).not.toContain('Roster Name')
  })

  it('no actor_label → falls back to the live roster name', async () => {
    const row = await renderEventRow({ actor_id: 'staff-1' })
    expect(row.textContent).toContain('Roster Name')
  })

  it('no actor_label and no roster match → unknownActor, never blank', async () => {
    const row = await renderEventRow({ actor_id: 'staff-9' })
    expect(row.textContent).toContain('unknownActor')
  })
})

describe('AuditLogSection — system rows are label-immune (fleet lens-3 gap)', () => {
  it('actor_type system renders systemActor even when a stray actor_label is attached', async () => {
    listAuditLog.mockResolvedValue({
      ok: true,
      events: [
        {
          id: 'e-sys',
          at: '2026-07-21T00:00:00.000Z',
          actor_id: null,
          actor_type: 'system',
          actor_label: 'Should Never Render',
          category: 'settings',
          action: 'settings.sync_config_update',
          target_type: null,
          target_id: null,
          target_label: null,
          detail: null,
          break_glass: false,
          severity: 'info',
        },
      ],
      total: 1,
      page: 1,
      hasMore: false,
      breakGlassTotal: 0,
      warningsTotal: 0,
      changesTotal: 1,
      targetLabels: {},
    })
    const { container } = render(<AuditLogSection staffList={[]} />)
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
    const row = container.querySelector('ul') as HTMLElement
    expect(row.textContent).toContain('systemActor')
    expect(row.textContent).not.toContain('Should Never Render')
  })
})

describe('AuditLogSection — Greptile #581 round-1 pins', () => {
  it('P1: an append whose probes fail keeps the page-1 exact total (no downgrade to approx)', async () => {
    const { fireEvent } = require('@testing-library/react')
    listAuditLog
      .mockResolvedValueOnce({
        ok: true,
        events: [coreEvent({ severity: 'warn' })],
        total: 300,
        page: 1,
        hasMore: true,
        breakGlassTotal: 0,
        warningsTotal: 5,
        changesTotal: null,
        targetLabels: {},
      })
      .mockResolvedValueOnce({
        ok: true,
        events: [coreEvent({ id: 'e2', severity: 'info' })],
        total: 300,
        page: 2,
        hasMore: true,
        breakGlassTotal: 0,
        warningsTotal: null, // transient probe failure on the append call
        changesTotal: null,
        targetLabels: {},
      })
    const { container, getByText } = render(<AuditLogSection staffList={[]} />)
    await waitFor(() => expect(statSpans(container)[1]).toBe('5'))
    fireEvent.click(getByText('loadMore'))
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
    // Exact total survives the failed-probe append; no '+' downgrade.
    await waitFor(() => expect(statSpans(container)[1]).toBe('5'))
  })

  it("P2: an empty-string actor_label falls through to the roster name, never a blank", async () => {
    listAuditLog.mockResolvedValue({
      ok: true,
      events: [coreEvent({ actor_id: 'staff-1', actor_label: '' })],
      total: 1,
      page: 1,
      hasMore: false,
      breakGlassTotal: 0,
      warningsTotal: 0,
      changesTotal: null,
      targetLabels: {},
    })
    const staffList = [
      { id: 'staff-1', full_name: 'Roster Name' },
    ] as unknown as StaffMember[]
    const { container } = render(<AuditLogSection staffList={staffList} />)
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
    expect((container.querySelector('ul') as HTMLElement).textContent).toContain('Roster Name')
  })
})
