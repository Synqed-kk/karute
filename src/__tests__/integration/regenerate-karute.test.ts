// PR-1 (edit-layer-01) — the I1 author-filter in the shared regenerate core.
// Regen replaces a record's AI entries but must NEVER delete a human-authored
// (is_manual) row. Drives regenerateKaruteEntriesWithClient DIRECTLY on a fake
// synqed client (the core takes an EXPLICIT client — no Bearer/cookie machinery
// here). The co-located orchestration's heavy deps (LLM, supabase, auth) are
// stubbed purely so the module loads; only karuteRecords get/addEntry/deleteEntry
// is exercised.
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn(async () => null), getBusinessId: jest.fn(async () => 'business-1') }))
jest.mock('@/lib/auth/require-permission', () => ({ requireCapability: jest.fn(async () => {}), can: jest.fn(async () => true) }))
jest.mock('@/lib/ai/karute-extract', () => ({ runKaruteExtraction: jest.fn() }))
jest.mock('@/lib/ai/karute-summarize', () => ({ runKaruteSummary: jest.fn() }))
jest.mock('@/actions/org-settings', () => ({ orgSettingsWithClient: jest.fn() }))

type BeforeEntry = { id?: string | null; is_manual?: boolean | null }
const snapshot = { current: [] as BeforeEntry[] }
const failDeleteIds = { current: new Set<string>() }
let addSeq = 0

const recGet = jest.fn(async () => ({ entries: snapshot.current }))
const addEntry = jest.fn(async () => ({ id: `new-${++addSeq}` }))
const deleteEntry = jest.fn(async (_recordId: string, entryId: string) => {
  if (failDeleteIds.current.has(entryId)) throw new Error('delete outage')
})
const fakeClient = { karuteRecords: { get: recGet, addEntry, deleteEntry } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { regenerateKaruteEntriesWithClient } from '@/actions/regenerate-karute'
import type { Entry } from '@/types/ai'

const REC_ID = 'rec-1'
const NEW: Entry[] = [
  { category: 'symptom', title: '肩こり', source_quote: 'q1', confidence_score: 0.9 },
  { category: 'treatment', title: '施術', source_quote: 'q2', confidence_score: 0.8 },
]
const run = (entries: Entry[] = NEW) =>
  regenerateKaruteEntriesWithClient(
    fakeClient as unknown as Parameters<typeof regenerateKaruteEntriesWithClient>[0],
    REC_ID,
    entries,
  )

beforeEach(() => {
  jest.clearAllMocks()
  snapshot.current = []
  failDeleteIds.current = new Set()
  addSeq = 0
})

describe('regenerateKaruteEntriesWithClient — I1 author filter', () => {
  it('mixed provenance: deletes ONLY the AI rows, keeps the human row, adds the new AI rows', async () => {
    snapshot.current = [
      { id: 'ai-1', is_manual: false },
      { id: 'ai-2', is_manual: false },
      { id: 'hum-1', is_manual: true },
    ]
    const res = await run()
    expect(res).toEqual({ added: 2, removed: 2 })
    expect(addEntry).toHaveBeenCalledTimes(2)
    expect(deleteEntry).toHaveBeenCalledWith(REC_ID, 'ai-1')
    expect(deleteEntry).toHaveBeenCalledWith(REC_ID, 'ai-2')
    expect(deleteEntry).not.toHaveBeenCalledWith(REC_ID, 'hum-1')
  })

  it('all-human record: deletes NOTHING, adds the new AI rows alongside', async () => {
    snapshot.current = [
      { id: 'hum-1', is_manual: true },
      { id: 'hum-2', is_manual: true },
    ]
    const res = await run()
    expect(res).toEqual({ added: 2, removed: 0 })
    expect(addEntry).toHaveBeenCalledTimes(2)
    expect(deleteEntry).not.toHaveBeenCalled()
  })

  it('legacy rows without the flag: still deleted (backward behavior unchanged)', async () => {
    snapshot.current = [{ id: 'legacy-1' }, { id: 'legacy-2' }]
    const res = await run()
    expect(res).toEqual({ added: 2, removed: 2 })
    expect(deleteEntry).toHaveBeenCalledWith(REC_ID, 'legacy-1')
    expect(deleteEntry).toHaveBeenCalledWith(REC_ID, 'legacy-2')
  })

  it('rows with missing/null ids: skipped, no crash (only the real id is deleted)', async () => {
    snapshot.current = [
      { id: 'ai-1', is_manual: false },
      { is_manual: false }, // no id
      { id: null, is_manual: false }, // null id
    ]
    const res = await run()
    expect(res).toEqual({ added: 2, removed: 1 })
    expect(deleteEntry).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith(REC_ID, 'ai-1')
  })

  it('total AI-delete outage: adds rolled back, hard error, no partial state', async () => {
    snapshot.current = [
      { id: 'ai-1', is_manual: false },
      { id: 'ai-2', is_manual: false },
    ]
    failDeleteIds.current = new Set(['ai-1', 'ai-2']) // every old-row delete fails
    const res = await run()
    expect(res.error).toMatch(/Could not remove the old entries/)
    expect(res.added).toBeUndefined()
    // rollback undid both adds (only ai-* were set to fail → new-* delete fine).
    expect(deleteEntry).toHaveBeenCalledWith(REC_ID, 'new-1')
    expect(deleteEntry).toHaveBeenCalledWith(REC_ID, 'new-2')
  })

  it('partial delete failure: change applied, soft warning preserved (no rollback)', async () => {
    snapshot.current = [
      { id: 'ai-1', is_manual: false },
      { id: 'ai-2', is_manual: false },
    ]
    failDeleteIds.current = new Set(['ai-2']) // one old row lingers
    const res = await run()
    expect(res.added).toBe(2)
    expect(res.removed).toBe(1)
    expect(res.warning).toMatch(/could not be removed/)
    expect(res.error).toBeUndefined()
    // adds NOT rolled back — the new rows stay (deleteEntry never hit new-*).
    expect(deleteEntry).not.toHaveBeenCalledWith(REC_ID, 'new-1')
    expect(deleteEntry).not.toHaveBeenCalledWith(REC_ID, 'new-2')
  })
})
