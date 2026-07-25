/** @jest-environment jsdom */
// karute.entry_edit rows expand in place to show what changed (Liam ruling
// 2026-07-26, AUDIT-LOG-DESIGN.md §11 — list rows stay ids-only, content is
// pulled live from the entry-edits trail on tap). Same harness as
// audit-log-section-stats.test.tsx: renders the REAL component with only the
// server-action boundary mocked (@/actions/audit-log, @/actions/karute).
import { act, fireEvent, render, waitFor } from '@testing-library/react'

// has()/t() are identity for every key EXCEPT actions.karute.entry_edit —
// same simulate-the-real-json-addition idiom as audit-log-section-stats.test.tsx.
// A call WITH params (entryEditTrailTitle's {count}) echoes `key:{...json}` —
// same convention as agenda-noshow-chip.test.tsx — so the count is assertable.
jest.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (k: string, vals?: Record<string, unknown>) =>
        k === 'actions.karute.entry_edit' ? 'カルテ項目を編集' : vals ? `${k}:${JSON.stringify(vals)}` : k,
      { has: (k: string) => k === 'actions.karute.entry_edit' },
    ),
  useLocale: () => 'ja',
}))

const listAuditLog = jest.fn()
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
}))

const listEntryEditHistory = jest.fn()
jest.mock('@/actions/karute', () => ({
  listEntryEditHistory: (recordId: string) => listEntryEditHistory(recordId),
}))

import { AuditLogSection } from '@/components/settings/redesign/sections/AuditLogSection'

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    at: '2026-07-21T00:00:00.000Z',
    actor_id: 'staff-1',
    actor_type: 'staff',
    category: 'karute',
    action: 'karute.entry_edit',
    target_type: 'karute',
    target_id: 'kar-1',
    target_label: null,
    detail: { entry_id: 'entry-1', category: 'SYMPTOM', customer_id: 'cus-1' },
    break_glass: false,
    severity: 'info',
    ...overrides,
  }
}

function editRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ed-1',
    entryIdOld: null,
    entryIdNew: 'entry-1',
    action: 'EDIT',
    actorName: '田中',
    contentBefore: 'before text',
    contentAfter: 'after text',
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

async function renderWithEvent(overrides: Record<string, unknown> = {}) {
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
  const { container } = render(<AuditLogSection staffList={[]} />)
  await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
  return container
}

beforeEach(() => {
  listAuditLog.mockReset()
  listEntryEditHistory.mockReset()
})

describe('AuditLogSection — karute.entry_edit row expansion (§11)', () => {
  it('expand fetches the record trail and renders it filtered to the row entry_id', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        editRow({ id: 'ed-1', entryIdNew: 'entry-1', contentAfter: 'the right entry' }),
        editRow({ id: 'ed-2', entryIdNew: 'other-entry', contentAfter: 'a different entry' }),
      ],
      truncated: false,
    })
    const container = await renderWithEvent()

    fireEvent.click(container.querySelector('button[aria-label="entryEditToggle"]') as Element)
    await waitFor(() => expect(listEntryEditHistory).toHaveBeenCalledWith('kar-1'))

    await waitFor(() => {
      expect(container.textContent).toContain('the right entry')
    })
    expect(container.textContent).not.toContain('a different entry')
    // Header count is the FILTERED count (1), not the raw fetch (2 edits).
    expect(container.textContent).toContain('entryEditTrailTitle:{"count":1}')
  })

  it('second expand reuses the cache — the action is called exactly once', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [editRow()], truncated: false })
    const container = await renderWithEvent()
    const toggle = () =>
      fireEvent.click(container.querySelector('button[aria-label="entryEditToggle"]') as Element)

    toggle() // expand
    await waitFor(() => expect(container.textContent).toContain('after text'))
    toggle() // collapse
    await waitFor(() => expect(container.textContent).not.toContain('after text'))
    toggle() // re-expand
    await waitFor(() => expect(container.textContent).toContain('after text'))

    expect(listEntryEditHistory).toHaveBeenCalledTimes(1)
  })

  it('an empty, non-truncated trail renders the non-committal "no history found" line', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    const container = await renderWithEvent()

    fireEvent.click(container.querySelector('button[aria-label="entryEditToggle"]') as Element)
    await waitFor(() => expect(container.textContent).toContain('entryEditDeleted'))
  })

  it('a server error renders the generic error string, never raw server text', async () => {
    listEntryEditHistory.mockResolvedValue({ error: 'RAW UPSTREAM TEXT' })
    const container = await renderWithEvent()

    fireEvent.click(container.querySelector('button[aria-label="entryEditToggle"]') as Element)
    await waitFor(() => expect(container.textContent).toContain('entryEditError'))
    expect(container.textContent).not.toContain('RAW UPSTREAM TEXT')
  })

  it('non-edit rows render no expand control', async () => {
    const container = await renderWithEvent({
      category: 'karute',
      action: 'karute.save',
      detail: { customer_id: 'cus-1' },
    })
    expect(container.querySelector('button[aria-label="entryEditToggle"]')).toBeNull()
    expect(listEntryEditHistory).not.toHaveBeenCalled()
  })

  it('a truncated empty trail renders the partial note, NOT the deleted line', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: true })
    const container = await renderWithEvent()

    fireEvent.click(container.querySelector('button[aria-label="entryEditToggle"]') as Element)
    await waitFor(() => expect(container.textContent).toContain('entryEditPartial'))
    expect(container.textContent).not.toContain('entryEditDeleted')
  })

  it('a truncated non-empty trail renders the rows AND the partial footer note', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [editRow()], truncated: true })
    const container = await renderWithEvent()

    fireEvent.click(container.querySelector('button[aria-label="entryEditToggle"]') as Element)
    await waitFor(() => expect(container.textContent).toContain('after text'))
    expect(container.textContent).toContain('entryEditPartial')
  })

  it('two taps in the same commit fetch only once (stale-closure guard)', async () => {
    // A plain two-`fireEvent.click()` sequence doesn't reproduce the race:
    // RTL's fireEvent wraps EACH call in its own act(), so React commits
    // (and the second click sees the row already open, closure fixed by
    // React's own re-render) between them — the bug needs both onClick
    // invocations to run before either commit lands. Wrapping both dispatches
    // in ONE outer act() defers the flush past both, the same interleaving
    // two real overlapping taps produce. Both handler runs then read the
    // SAME stale editTrails/expandedEditId; only the ref (mutated
    // synchronously, unlike state) can tell click 2 a fetch is already going.
    listEntryEditHistory.mockResolvedValue({ edits: [editRow()], truncated: false })
    const container = await renderWithEvent()
    const button = container.querySelector('button[aria-label="entryEditToggle"]') as Element

    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })

    await waitFor(() => expect(container.textContent).toContain('after text'))
    expect(listEntryEditHistory).toHaveBeenCalledTimes(1)
  })
})
