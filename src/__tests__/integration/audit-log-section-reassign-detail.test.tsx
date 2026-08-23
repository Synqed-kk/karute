/** @jest-environment jsdom */
// R7-1 (Liam's phone review, 8/23 — "extremely important"): karute.
// customer_reassign rows render a from→to detail line under the action
// label. The server (src/actions/audit-log.ts, listAuditLogWithClient)
// builds the resolved line ONCE and ships it as event.reassign_customer_line
// (additive field, packet PACKET-F4-FIXROUND7-2026-09-02.md); this suite
// pins that the COMPONENT actually renders it (pin 1) and that other rows
// are unaffected (pin 5). Server-side resolution/fallback pins (2, 3) live
// in audit-log-action.test.ts. Same harness as
// audit-log-section-menu-autostart-detail.test.tsx: renders the REAL
// component with only the server-action boundary mocked.
import { render, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign((k: string, vals?: Record<string, unknown>) => (vals ? `${k}:${JSON.stringify(vals)}` : k), {
      has: () => false,
    }),
  useLocale: () => 'ja',
}))

const listAuditLog = jest.fn()
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
}))
jest.mock('@/actions/karute', () => ({
  listEntryEditHistory: jest.fn(),
}))

import { AuditLogSection } from '@/components/settings/redesign/sections/AuditLogSection'

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    at: '2026-08-23T00:00:00.000Z',
    actor_id: 'staff-1',
    actor_type: 'staff',
    category: 'karute',
    action: 'karute.customer_reassign',
    target_type: 'karute',
    target_id: 'kar-1',
    target_label: null,
    detail: { from_customer_id: 'cus-from', to_customer_id: 'cus-to', same_day_burn_count: 0, photo_count: 0 },
    break_glass: false,
    severity: 'info',
    ...overrides,
  }
}

async function renderWithEvents(events: Array<Record<string, unknown>>, targetLabels: Record<string, string> = {}) {
  listAuditLog.mockResolvedValue({
    ok: true,
    events,
    total: events.length,
    page: 1,
    hasMore: false,
    breakGlassTotal: 0,
    warningsTotal: 0,
    changesTotal: events.length,
    targetLabels,
  })
  const { container } = render(<AuditLogSection staffList={[]} />)
  await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
  return container
}

beforeEach(() => {
  listAuditLog.mockReset()
})

describe('AuditLogSection — karute.customer_reassign detail line (R7-1, pin 1)', () => {
  it('renders the server-resolved "A → B" line under the action label', async () => {
    const container = await renderWithEvents([
      coreEvent({ reassign_customer_line: '田中 美咲 → 佐藤 花子' }),
    ])
    expect(container.textContent).toContain('田中 美咲 → 佐藤 花子')
  })

  // Red-run target for pin 1: drop the eventSub() branch that reads this
  // field — this exact test goes red (the field never reaches the DOM).
  it('a row missing the field entirely (old cached shape) does not crash — degrades to no detail line', async () => {
    const container = await renderWithEvents([coreEvent({ reassign_customer_line: undefined })])
    // Row still renders (no throw); nothing arrow-shaped appears since the
    // field was never resolved server-side for this cached shape.
    expect(container.querySelector('ul')).not.toBeNull()
    expect(container.textContent).not.toContain('→')
  })
})

describe('AuditLogSection — non-reassign rows unaffected (R7-1, pin 5)', () => {
  it('a customer.edit row never shows an arrow line, even if the field were somehow truthy (component-side action gate)', async () => {
    const container = await renderWithEvents(
      [
        coreEvent({
          action: 'customer.edit',
          category: 'customer',
          target_type: 'customer',
          target_id: 'cus-1',
          detail: null,
          // Deliberately truthy — proves the component's own action gate,
          // not just that this fixture's field happens to be falsy.
          reassign_customer_line: '田中 美咲 → 佐藤 花子',
        }),
      ],
      { 'cus-1': '鈴木 一郎' },
    )
    expect(container.textContent).toContain('鈴木 一郎')
    expect(container.textContent).not.toContain('→')
  })
})
