// Edit-layer W2 history-sheet packet: the per-entry edit-history CORE (name
// resolution off the roster, roster-failure degrade, defensive newest-first
// sort, pagination-until-cap, truncated flag) + the cookie web wrapper
// (customers.view gate, error collapse). No tenancy proof-read added here —
// fix-round finding refuted with core-source evidence: core's
// listEntryEdits carries an unconditional `where = { businessId }`, so a
// cross-tenant read is already impossible at the core layer.
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

// A page of `n` rows for the pagination tests below, newest-first by
// created_at, distinct ids so a call count / total can be checked precisely.
function page(n: number, startIndex: number) {
  return Array.from({ length: n }, (_, i) => {
    const idx = startIndex + i
    return row({ id: `ed-${idx}`, created_at: `2026-01-01T00:${String(idx % 60).padStart(2, '0')}:00.000Z` })
  })
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
      truncated: false,
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

  it('page_size 100, page 1, filtered to the record on the first call', async () => {
    listEntryEdits.mockResolvedValueOnce({ entry_edits: [], total: 0, page: 1, page_size: 100 })
    await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(listEntryEdits).toHaveBeenCalledWith({ karute_record_id: 'kar-1', page: 1, page_size: 100 })
  })

  it('maps every field to the camelCase row shape + truncated:false when the whole trail fit', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ entry_id_old: 'e-old', entry_id_new: 'e-new' })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const { edits, truncated } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
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
    expect(truncated).toBe(false)
  })

  it('a null entry_id_old/entry_id_new (undefined on the wire) coalesces to null, never undefined', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ entry_id_old: undefined, entry_id_new: undefined })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const { edits } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(edits[0].entryIdOld).toBeNull()
    expect(edits[0].entryIdNew).toBeNull()
  })

  it('a null action (legacy-null enum row) maps through, never dropped or defaulted', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ action: null })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const { edits } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(edits[0].action).toBeNull()
  })

  it('pagination: total 150 → page 1 then page 2, all 150 rows returned, truncated:false', async () => {
    listEntryEdits
      .mockResolvedValueOnce({ entry_edits: page(100, 0), total: 150, page: 1, page_size: 100 })
      .mockResolvedValueOnce({ entry_edits: page(50, 100), total: 150, page: 2, page_size: 100 })
    const { edits, truncated } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(listEntryEdits).toHaveBeenCalledTimes(2)
    expect(listEntryEdits).toHaveBeenNthCalledWith(1, { karute_record_id: 'kar-1', page: 1, page_size: 100 })
    expect(listEntryEdits).toHaveBeenNthCalledWith(2, { karute_record_id: 'kar-1', page: 2, page_size: 100 })
    expect(edits).toHaveLength(150)
    expect(truncated).toBe(false)
  })

  it('pagination: total 1200 stops at the 1000-row hard cap, truncated:true', async () => {
    for (let p = 1; p <= 10; p++) {
      listEntryEdits.mockResolvedValueOnce({
        entry_edits: page(100, (p - 1) * 100),
        total: 1200,
        page: p,
        page_size: 100,
      })
    }
    const { edits, truncated } = await listEntryEditHistoryWithClient(fakeClient, 'biz-1', 'kar-1')
    expect(listEntryEdits).toHaveBeenCalledTimes(10)
    expect(edits).toHaveLength(1000)
    expect(truncated).toBe(true)
  })
})

describe('listEntryEditHistory — web wrapper', () => {
  it('gates on customers.view before reading', async () => {
    listEntryEdits.mockResolvedValueOnce({ entry_edits: [], total: 0, page: 1, page_size: 100 })
    await listEntryEditHistory('kar-1')
    expect(requireCapability).toHaveBeenCalledWith('customers.view')
  })

  it('delegates to the core with the resolved businessId, truncated threaded through', async () => {
    listEntryEdits.mockResolvedValueOnce({
      entry_edits: [row({ actor_staff_id: 'staff-1' })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const result = await listEntryEditHistory('kar-1')
    expect(result).toEqual({
      edits: [expect.objectContaining({ actorName: '田中' })],
      truncated: false,
    })
  })

  it('a failed gate collapses to {error}, never throws across the action boundary', async () => {
    ;(requireCapability as jest.Mock).mockRejectedValueOnce(new Error('forbidden'))
    const result = await listEntryEditHistory('kar-1')
    expect(result).toEqual({ error: 'forbidden' })
    expect(listEntryEdits).not.toHaveBeenCalled()
  })
})
