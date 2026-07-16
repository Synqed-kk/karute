/**
 * Server-side owner gate on the bulk-regen list (listCustomerKaruteForRegen).
 *
 * This is the one action that RETURNS raw transcripts (a customer's whole
 * history at once), and raw recordings are recorder-private. 'use server'
 * functions are directly POST-invocable, so hiding the 全カルテ再生成 button is
 * not enforcement — a non-owner call must come back empty BEFORE any record
 * read fires.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/auth/require-permission', () => ({ requireCapability: jest.fn() }))
jest.mock('@/actions/dev-tools', () => ({ canUseDevRegen: jest.fn().mockResolvedValue(false) }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))

import { listCustomerKaruteForRegen } from '@/actions/regenerate-karute'

const devTools = jest.requireMock('@/actions/dev-tools') as { canUseDevRegen: jest.Mock }
const synqed = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }

describe('bulk-regen list owner gate (server-side)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('non-owner: empty list, no record read at all', async () => {
    devTools.canUseDevRegen.mockResolvedValue(false)
    const res = await listCustomerKaruteForRegen('c1')
    expect(res).toEqual([])
    expect(synqed.getSynqedClient).not.toHaveBeenCalled()
  })

  it('owner: proceeds past the gate and returns transcript-bearing records', async () => {
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
