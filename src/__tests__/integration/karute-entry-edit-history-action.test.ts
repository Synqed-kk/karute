// Edit-layer W2 history-sheet packet: the per-entry edit-history CORE (name
// resolution off the roster, roster-failure degrade, defensive newest-first
// sort) + the cookie web wrapper (customers.view gate, error collapse).
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
const staffListByBusinessOrThrow = jest.fn(async () => [{ id: 'staff-1', full_name: '田中' }])
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  staffListByBusinessOrThrow: (...args: unknown[]) => staffListByBusinessOrThrow(...(args as [])),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

const listEntryEdits = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords: { listEntryEdits } })),
}))

import {
  listEntryEditHistory,
  listEntryEditHistoryWithClient,
  type EntryEditHistoryRow,
} from '@/actions/karute'
import { requireCapability } from '@/lib/auth/require-permission'

beforeEach(() => {
  jest.clearAllMocks()
  staffListByBusinessOrThrow.mockResolvedValue([{ id: 'staff-1', full_name: '田中' }])
})

// Test-only partial client cast — the mock only needs to satisfy
// listEntryEdits's call shape at runtime, not the full SynqedClient surface.
const fakeClient = { karuteRecords: { listEntryEdits } } as unknown as Parameters<
  typeof listEntryEditHistoryWithClient
>[0]

// A full core row, overridable per test — mirrors KaruteEntryEdit's shape
// (node_modules/@synqed-kk/client/dist/types.d.ts:650).
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ed-1',
    business_id: 'biz-1',
    customer_id: 'cust-1',
    karute_record_id: 'kar-1',
    entry_id_old: null,
    entry_id_new: 'e1',
    actor_staff_id: 'staff-1',
    action: 'EDIT',
    category: 'SYMPTOM',
    content_before: 'before',
    content_after: 'after',
    author_before: 'AI',
    author_after: 'HUMAN_EDITED',
    batch_id: null,
    prompt_version: null,
    model: null,
    created_at: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('listEntryEditHistoryWithClient — core', () => {
  it('resolves actor names off the roster; a roster miss degrades to null', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [
        row({ id: 'ed-1', actor_staff_id: 'staff-1' }),
        row({ id: 'ed-2', actor_staff_id: 'staff-unknown' }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    })
    const { edits } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(edits.find((e) => e.id === 'ed-1')?.actorName).toBe('田中')
    expect(edits.find((e) => e.id === 'ed-2')?.actorName).toBeNull()
  })

  it('a null actor_staff_id (system-originated row) resolves to null, never a lookup crash', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ actor_staff_id: null })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const { edits } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(edits[0].actorName).toBeNull()
  })

  it('a roster failure degrades EVERY actorName to null — never throws', async () => {
    staffListByBusinessOrThrow.mockRejectedValueOnce(new Error('roster down'))
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ actor_staff_id: 'staff-1' })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    await expect(listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')).resolves.toEqual({
      edits: [expect.objectContaining({ actorName: null })],
    })
  })

  it('sorts newest first regardless of the order the core returned', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [
        row({ id: 'older', created_at: '2026-07-01T00:00:00.000Z' }),
        row({ id: 'newest', created_at: '2026-07-20T00:00:00.000Z' }),
        row({ id: 'middle', created_at: '2026-07-10T00:00:00.000Z' }),
      ],
      total: 3,
      page: 1,
      page_size: 100,
    })
    const { edits } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(edits.map((e) => e.id)).toEqual(['newest', 'middle', 'older'])
  })

  it('page_size 100, filtered to the record — no pagination param sent', async () => {
    listEntryEdits.mockResolvedValueOnce({ entry_edits: [], total: 0, page: 1, page_size: 100 })
    await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(listEntryEdits).toHaveBeenCalledWith({ karute_record_id: 'kar-1', page_size: 100 })
  })

  it('maps every field to the camelCase row shape (id/entryIdOld/entryIdNew/action/contentBefore/contentAfter/createdAt)', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ entry_id_old: 'e-old', entry_id_new: 'e-new' })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const { edits } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    const expected: EntryEditHistoryRow = {
      id: 'ed-1',
      entryIdOld: 'e-old',
      entryIdNew: 'e-new',
      action: 'EDIT',
      actorName: '田中',
      contentBefore: 'before',
      contentAfter: 'after',
      createdAt: '2026-07-20T00:00:00.000Z',
    }
    expect(edits).toEqual([expected])
  })
})

describe('listEntryEditHistory — web wrapper', () => {
  it('gates on customers.view before reading', async () => {
    listEntryEdits.mockResolvedValueOnce({ entry_edits: [], total: 0, page: 1, page_size: 100 })
    await listEntryEditHistory('kar-1')
    expect(requireCapability).toHaveBeenCalledWith('customers.view')
  })

  it('delegates to the core with the resolved businessId', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ actor_staff_id: 'staff-1' })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const result = await listEntryEditHistory('kar-1')
    expect(result).toEqual({ edits: [expect.objectContaining({ actorName: '田中' })] })
  })

  it('a failed gate collapses to {error}, never throws across the action boundary', async () => {
    ;(requireCapability as jest.Mock).mockRejectedValueOnce(new Error('forbidden'))
    const result = await listEntryEditHistory('kar-1')
    expect(result).toEqual({ error: 'forbidden' })
    expect(listEntryEdits).not.toHaveBeenCalled()
  })
})
