/**
 * Regen deleteEntry CAS (core #61 adoption — SDK 1.19.0).
 *
 * regenerateKaruteEntriesWithClient's delete phase must send expected_version
 * from the pre-delete FRESH read on every delete, and treat a 409 as "the row
 * was edited in the read-to-delete window → core kept it" — neither a removal
 * nor a failure, and NEVER a reason to roll back the adds (that outage check
 * is for real delete errors only). The rollback helper gets the same guard
 * using the version addEntry returned.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: unknown) => fn }))
// @synqed-kk/client ships ESM jest can't parse — standard stub (same pattern
// as regen-author-filter.test.ts).
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
import { SynqedError } from '@synqed-kk/client'
import type { Entry } from '@/types/ai'

const NEW_ENTRY: Entry = {
  category: 'symptom',
  title: '肩こり',
  source_quote: 'q',
  confidence_score: 0.9,
}

const conflict = () => new SynqedError(409, 'version conflict')

describe('regenerateKaruteEntriesWithClient — deleteEntry CAS (core #61)', () => {
  it('every delete sends expected_version from the FRESH read (not the snapshot)', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const get = jest
      .fn()
      // snapshot: version 3 — must NOT be what the delete sends
      .mockResolvedValueOnce({ entries: [{ id: 'ai-1', author: 'AI', version: 3 }] })
      // fresh read after the adds: version moved to 4
      .mockResolvedValueOnce({ entries: [{ id: 'ai-1', author: 'AI', version: 4 }] })
    const synqed = {
      karuteRecords: { get, addEntry: jest.fn(async () => ({ id: 'new-1' })), deleteEntry },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result).toEqual({ added: 1, removed: 1 })
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'ai-1', { expected_version: 4 })
  })

  it('fresh-read row without a numeric version deletes unguarded (legacy fallback, exact 2-arg call)', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI' }] })),
        addEntry: jest.fn(async () => ({ id: 'new-1' })),
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result).toEqual({ added: 1, removed: 1 })
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'ai-1')
  })

  it('a 409 mid-loop is a KEPT edited row: not removed, not a failure, no warning, adds stand', async () => {
    const deleteEntry = jest
      .fn()
      .mockRejectedValueOnce(conflict()) // ai-1 was edited after the fresh read
      .mockResolvedValueOnce(undefined) // ai-2 deletes normally
    const get = jest
      .fn()
      .mockResolvedValueOnce({
        entries: [
          { id: 'ai-1', author: 'AI', version: 2 },
          { id: 'ai-2', author: 'AI', version: 1 },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          { id: 'ai-1', author: 'AI', version: 2 },
          { id: 'ai-2', author: 'AI', version: 1 },
        ],
      })
    const synqed = {
      karuteRecords: { get, addEntry: jest.fn(async () => ({ id: 'new-1' })), deleteEntry },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    // No warning: the kept row is a correct outcome, not cleanup debt.
    expect(result).toEqual({ added: 1, removed: 1 })
    // The added row was never rolled back.
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'new-1')
  })

  it('ALL deletes 409 → CAS working, NOT an outage: adds stand, no rollback, no error', async () => {
    const deleteEntry = jest.fn(async () => {
      throw conflict()
    })
    const get = jest.fn(async () => ({
      entries: [
        { id: 'ai-1', author: 'AI', version: 2 },
        { id: 'ai-2', author: 'AI', version: 5 },
      ],
    }))
    const synqed = {
      karuteRecords: { get, addEntry: jest.fn(async () => ({ id: 'new-1' })), deleteEntry },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result).toEqual({ added: 1, removed: 0 })
    expect(deleteEntry).not.toHaveBeenCalledWith('kar-1', 'new-1')
    // Exactly the two old-row attempts — no rollback calls piled on.
    expect(deleteEntry).toHaveBeenCalledTimes(2)
  })

  it('ALL deletes fail with real errors → the outage rollback still fires', async () => {
    const deleteEntry = jest.fn(async (_rec: string, id: string) => {
      if (id !== 'new-1') throw new Error('network')
    })
    const get = jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI', version: 2 }] }))
    const synqed = {
      karuteRecords: { get, addEntry: jest.fn(async () => ({ id: 'new-1' })), deleteEntry },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result.error).toContain('Could not remove the old entries')
    // Rollback removed the added row (no version on this add → legacy 2-arg).
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'new-1')
  })

  it('rollback sends the version addEntry returned', async () => {
    const deleteEntry = jest.fn(async () => undefined)
    const addEntry = jest
      .fn()
      .mockResolvedValueOnce({ id: 'new-1', version: 1 })
      .mockRejectedValueOnce(new Error('add died'))
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI', version: 2 }] })),
        addEntry,
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [
      NEW_ENTRY,
      NEW_ENTRY,
    ])

    expect(result.error).toContain('No changes applied')
    expect(deleteEntry).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'new-1', { expected_version: 1 })
  })

  it('a 409 on an UNGUARDED legacy delete (no version sent) stays a plain failure — outage rollback fires', async () => {
    // No expected_version was sent, so a 409 compared nothing and cannot be a
    // CAS keep — it must count as a real failure.
    const deleteEntry = jest.fn(async (_rec: string, id: string) => {
      if (id !== 'new-1') throw conflict()
    })
    const get = jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI' }] }))
    const synqed = {
      karuteRecords: { get, addEntry: jest.fn(async () => ({ id: 'new-1' })), deleteEntry },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result.error).toContain('Could not remove the old entries')
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'new-1')
  })

  it('a 409 on an UNGUARDED rollback delete (no version from addEntry) stays a cleanup failure', async () => {
    const deleteEntry = jest.fn(async () => {
      throw conflict()
    })
    const addEntry = jest
      .fn()
      .mockResolvedValueOnce({ id: 'new-1' }) // versionless add
      .mockRejectedValueOnce(new Error('add died'))
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI', version: 2 }] })),
        addEntry,
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [
      NEW_ENTRY,
      NEW_ENTRY,
    ])

    expect(result.error).toContain('cleanup failed')
  })

  it('partial real failure keeps the soft warning: some rows removed, failed rows reported', async () => {
    const deleteEntry = jest.fn(async (_rec: string, id: string) => {
      if (id === 'ai-2') throw new Error('network')
    })
    const get = jest.fn(async () => ({
      entries: [
        { id: 'ai-1', author: 'AI', version: 1 },
        { id: 'ai-2', author: 'AI', version: 1 },
      ],
    }))
    const synqed = {
      karuteRecords: { get, addEntry: jest.fn(async () => ({ id: 'new-1' })), deleteEntry },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [NEW_ENTRY])

    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.warning).toContain('could not be removed')
    expect(result.error).toBeUndefined()
  })

  it('rollback 409 = the just-added row was edited and kept: honest "No changes applied", not "cleanup failed"', async () => {
    const deleteEntry = jest.fn(async () => {
      throw conflict()
    })
    const addEntry = jest
      .fn()
      .mockResolvedValueOnce({ id: 'new-1', version: 1 })
      .mockRejectedValueOnce(new Error('add died'))
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => ({ entries: [{ id: 'ai-1', author: 'AI', version: 2 }] })),
        addEntry,
        deleteEntry,
      },
    }

    const result = await regenerateKaruteEntriesWithClient(synqed as never, 'kar-1', [
      NEW_ENTRY,
      NEW_ENTRY,
    ])

    expect(result.error).toContain('No changes applied')
    expect(result.error).not.toContain('cleanup failed')
  })
})
