/**
 * Coverage for getKaruteRecord (src/lib/supabase/karute.ts).
 *
 * synqed-core is now the SOLE read source — the Supabase `karute_records` table
 * is empty and being dropped. This verifies the fetch + adapt contract:
 *   - threads the requested id through synqed.karuteRecords.get(id)
 *   - returns null when the record doesn't exist (→ notFound())
 *   - adapts the synqed shape to the Supabase read shape callers consume
 *     (business_id → customer_id, customer_id → client_id, ai_summary → summary,
 *      UPPERCASE entry category → lowercase, original_quote → source_quote, …)
 *   - degrades to null (never throws) on a synqed error
 */
let capturedGetId: string | null = null
const mockSynqedGet = jest.fn(async (id: string) => {
  capturedGetId = id
  return null as unknown
})
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords: { get: mockSynqedGet } })),
}))
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => [{ id: 'syn-c1', name: 'Synqed Hanako' }]),
}))

import { getKaruteRecord } from '@/lib/supabase/karute'

beforeEach(() => {
  capturedGetId = null
  mockSynqedGet.mockReset()
  mockSynqedGet.mockImplementation(async (id: string) => {
    capturedGetId = id
    return null
  })
})

describe('getKaruteRecord', () => {
  it('returns null when the record does not exist', async () => {
    const result = await getKaruteRecord('missing')
    expect(result).toBeNull()
  })

  it('threads the requested id through synqed.karuteRecords.get', async () => {
    await getKaruteRecord('k9')
    expect(capturedGetId).toBe('k9')
  })

  it('fetches from synqed-core and adapts the shape', async () => {
    mockSynqedGet.mockResolvedValueOnce({
      id: 'syn-k1',
      business_id: 'biz-1',
      customer_id: 'syn-c1',
      staff_id: 'syn-staff-1',
      status: 'DRAFT',
      ai_summary: 'from synqed',
      transcript: null,
      created_at: '2026-05-29T00:00:00Z',
      entries: [
        {
          id: 'e1',
          category: 'SYMPTOM',
          content: 'dry scalp',
          original_quote: 'q',
          confidence: 0.9,
          is_manual: false,
          created_at: '2026-05-29T00:00:00Z',
        },
      ],
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await getKaruteRecord('syn-k1')) as any

    expect(result).not.toBeNull()
    expect(result.client_id).toBe('syn-c1') // synqed customer_id → Supabase client_id
    expect(result.customer_id).toBe('biz-1') // synqed business_id → tenant customer_id
    expect(result.summary).toBe('from synqed') // ai_summary → summary
    expect(result.session_date).toBeNull() // not persisted on synqed-core
    expect(result.customers).toEqual({ id: 'syn-c1', name: 'Synqed Hanako' })
    expect(result.entries[0].category).toBe('symptom') // UPPERCASE → lowercase
    expect(result.entries[0].source_quote).toBe('q') // original_quote → source_quote
    expect(result.entries[0].confidence_score).toBe(0.9) // confidence → confidence_score
  })

  it('degrades to null (does not throw) on a synqed error', async () => {
    mockSynqedGet.mockImplementationOnce(async () => {
      throw new Error('synqed down')
    })
    await expect(getKaruteRecord('k1')).resolves.toBeNull()
  })
})

export {}
