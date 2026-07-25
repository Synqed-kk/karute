/** @jest-environment jsdom */
// karute.entry_edit rows expand in place to show what changed (Liam ruling
// 2026-07-26, AUDIT-LOG-DESIGN.md §11 — list rows stay ids-only, content is
// pulled live from the entry-edits trail on tap). Same harness as
// audit-log-section-stats.test.tsx: renders the REAL component with only the
// server-action boundary mocked (@/actions/audit-log, @/actions/karute).
import { fireEvent, render, waitFor } from '@testing-library/react'

// has()/t() are identity for every key EXCEPT actions.karute.entry_edit —
// same simulate-the-real-json-addition idiom as audit-log-section-stats.test.tsx.
jest.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign((k: string) => (k === 'actions.karute.entry_edit' ? 'カルテ項目を編集' : k), {
      has: (k: string) => k === 'actions.karute.entry_edit',
    }),
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

  it('empty trail renders the deleted-record line, not a generic empty state', async () => {
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
})
