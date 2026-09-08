/**
 * Server-side dev-tool gate on the bulk-regen list (listCustomerKaruteForRegen).
 *
 * This is the one action that RETURNS raw transcripts (a customer's whole
 * history at once), and raw recordings are recorder-private. 'use server'
 * functions are directly POST-invocable, so hiding the 全カルテ再生成 button is
 * not enforcement — a call WITHOUT the dev-tool key pair (business.manage &&
 * recordings.viewAll — the owner, or a person the owner gave both) must come
 * back empty BEFORE any record read fires.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: unknown) => fn }))
// @synqed-kk/client ships ESM jest can't parse — standard stub (same pattern
// as appointments-store-scope.test.ts); 04c's regenerate orchestration widened
// this test's import graph to modules that import SynqedError at load.
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
jest.mock('@/lib/auth/require-permission', () => ({ requireCapability: jest.fn() }))
jest.mock('@/actions/dev-tools', () => ({ canUseDevRegen: jest.fn().mockResolvedValue(false) }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))

import { listCustomerKaruteForRegen } from '@/actions/regenerate-karute'

const devTools = jest.requireMock('@/actions/dev-tools') as { canUseDevRegen: jest.Mock }
const synqed = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }

describe('bulk-regen list dev-tool key-pair gate (server-side)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('without the key pair: empty list, no record read at all', async () => {
    devTools.canUseDevRegen.mockResolvedValue(false)
    const res = await listCustomerKaruteForRegen('c1')
    expect(res).toEqual([])
    expect(synqed.getSynqedClient).not.toHaveBeenCalled()
  })

  it('with the key pair: proceeds past the gate and returns transcript-bearing records', async () => {
    devTools.canUseDevRegen.mockResolvedValue(true)
    synqed.getSynqedClient.mockResolvedValue({
      karuteRecords: {
        list: jest.fn().mockResolvedValue({
          karute_records: [
            { id: 'k1', transcript: 'こんにちは' },
            { id: 'k2', transcript: '   ' }, // blank transcript → filtered out
          ],
        }),
      },
    })
    const res = await listCustomerKaruteForRegen('c1')
    expect(res).toEqual([{ id: 'k1', transcript: 'こんにちは' }])
  })
})
