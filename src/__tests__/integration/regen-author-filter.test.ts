/**
 * Regen author filter (I1 — packet wave1-recut-2026-07-25, PR-1).
 *
 * regenerateKaruteEntriesWithClient's step-1 snapshot must only collect
 * AI-authored entry ids for step-3 deletion — a human-authored row (edited or
 * hand-added) must never be deleted by a regen run. Primary signal is the
 * author enum; legacy rows written before the migration backfill (no author
 * field) fall back to is_manual.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: unknown) => fn }))
// @synqed-kk/client ships ESM jest can't parse — standard stub (same pattern
// as regen-list-owner-gate.test.ts; regenerate-karute.ts's org-settings import
// pulls SynqedClient in at module load).
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))
jest.mock('@/lib/auth/require-permission', () => ({ requireCapability: jest.fn(), can: jest.fn() }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))

import { regenerateKaruteEntriesWithClient } from '@/actions/regenerate-karute'
import type { Entry } from '@/types/ai'

const NEW_ENTRY: Entry = {
  category: 'symptom',
  title: '肩こり',
  source_quote: 'q',
  confidence_score: 0.9,
}

describe('regenerateKaruteEntriesWithClient — author filter (I1)', () => {
  it('mixed provenance: AI entries deleted, HUMAN_CREATED and HUMAN_EDITED entries survive', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({
          entries: [
            { id: 'ai-1', author: 'AI' },
            { id: 'human-edited-1', author: 'HUMAN_EDITED' },
            { id: 'human-created-1', author: 'HUMAN_CREATED' },
          ],
        })),
        addEntry: jest.fn(async () => ({ id: 'new-1' })),
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result).toEqual({ added: 1, removed: 1 })
    expect(deleteEntry).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'ai-1')
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'human-edited-1')
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'human-created-1')
  })

  it('legacy rows with no author field: is_manual=true survives, is_manual=false deleted', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({
          entries: [
            { id: 'legacy-manual', is_manual: true },
            { id: 'legacy-ai', is_manual: false },
          ],
        })),
        addEntry: jest.fn(async () => ({ id: 'new-1' })),
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result).toEqual({ added: 1, removed: 1 })
    expect(deleteEntry).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'legacy-ai')
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'legacy-manual')
  })

  it('all-human record: regen adds new AI rows, deletes nothing', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({
          entries: [
            { id: 'human-created-1', author: 'HUMAN_CREATED' },
            { id: 'human-edited-1', author: 'HUMAN_EDITED' },
          ],
        })),
        addEntry: jest.fn(async () => ({ id: 'new-1' })),
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result).toEqual({ added: 1, removed: 0 })
    expect(deleteEntry).not.toHaveBeenCalled()
  })

  it('delete-phase re-filter (T8, edit-layer W2 PR-B fleet fix): a snapshot id whose FRESH author is HUMAN_EDITED survives', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const get = jest
      .fn()
      // pre-loop snapshot: both entries are AI
      .mockResolvedValueOnce({
        entries: [
          { id: 'ai-1', author: 'AI' },
          { id: 'ai-2', author: 'AI' },
        ],
      })
      // fresh read after the adds: a mid-regen pencil edit flipped ai-1 to
      // HUMAN_EDITED — the delete phase must not kill it off the stale snapshot.
      .mockResolvedValueOnce({
        entries: [
          { id: 'ai-1', author: 'HUMAN_EDITED' },
          { id: 'ai-2', author: 'AI' },
        ],
      })
    const synqed = {
      karuteRecords: {
        get,
        addEntry: jest.fn(async () => ({ id: 'new-1' })),
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result).toEqual({ added: 1, removed: 1 })
    expect(deleteEntry).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'ai-2')
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'ai-1')
  })

  it('rollback path still intact when addEntry throws: rolls back the partial adds, never touches old rows', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const addEntry = jest
      .fn()
      .mockResolvedValueOnce({ id: 'new-1' })
      .mockRejectedValueOnce(new Error('add failed'))
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI' }] })),
        addEntry,
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [
      NEW_ENTRY,
      NEW_ENTRY,
    ])

    expect(result.error).toContain('No changes applied')
    expect(result.added).toBeUndefined()
    expect(result.removed).toBeUndefined()
    // Rollback undoes the one successful add ...
    expect(deleteEntry).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'new-1')
    // ... and the old (pre-existing) entry is never touched.
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'ai-1')
  })

  it('fresh pre-delete read fails: rolls back the adds, deletes nothing old (record exactly as it was)', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const get = jest
      .fn()
      // Step-1 snapshot succeeds ...
      .mockResolvedValueOnce({ entries: [{ id: 'ai-1', author: 'AI' }] })
      // ... the post-add fresh read (the mid-regen-edit guard) does not.
      .mockRejectedValueOnce(new Error('network'))
    const synqed = {
      karuteRecords: {
        get,
        addEntry: jest.fn(async () => ({ id: 'new-1' })),
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result.error).toContain('No changes applied')
    // Rollback removes the added row; the old AI row is never deleted blind
    // off the stale snapshot.
    expect(deleteEntry).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'new-1')
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'ai-1')
  })

  it('fresh read AND rollback both fail: the error admits cleanup failed instead of claiming no changes (Greptile #616)', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce({ entries: [{ id: 'ai-1', author: 'AI' }] })
      .mockRejectedValueOnce(new Error('network'))
    const synqed = {
      karuteRecords: {
        get,
        addEntry: jest.fn(async () => ({ id: 'new-1' })),
        // rollback's delete also fails — total network outage
        deleteEntry: jest.fn(async () => {
          throw new Error('network')
        }),
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result.error).toContain('re-run to finish cleanup')
    expect(result.error).not.toContain('No changes applied')
  })

  it('add fails AND rollback fails: same honesty on the add-failure branch (Greptile #616 r2)', async () => {
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI' }] })),
        addEntry: jest
          .fn()
          .mockResolvedValueOnce({ id: 'new-1' })
          .mockRejectedValueOnce(new Error('add died')),
        deleteEntry: jest.fn(async () => {
          throw new Error('network')
        }),
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [
      NEW_ENTRY,
      NEW_ENTRY,
    ])

    expect(result.error).toContain('re-run to finish cleanup')
    expect(result.error).not.toContain('No changes applied')
  })
})
