/**
 * Coverage for getKaruteRecord (PR 24, replay/24, src/lib/supabase/karute.ts).
 * Verifies the single-record fetch + error handling contract:
 *   - returns the row on success
 *   - maps PGRST116 ("0 rows") to null for notFound() handling
 *   - rethrows any other Supabase error (propagated to the error boundary)
 *   - threads the requested id through the .eq('id', …) filter
 *
 * The supabase server client is mocked as a chainable builder terminating in
 * .single(), which async-resolves the staged { data, error }.
 */
let singleResponse: { data: unknown; error: unknown } = {
  data: null,
  error: null,
}
let capturedEqId: string | null = null

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.select = chain
    builder.order = chain
    builder.eq = (_col: string, val: string) => {
      capturedEqId = val
      return builder
    }
    builder.single = async () => singleResponse
    return { from: () => builder }
  }),
}))

// Synqed-core fallback deps (used only when Supabase returns PGRST116).
// Default get → null so the "0 rows in both stores → null" test holds; the
// positive test overrides with mockResolvedValueOnce.
const mockSynqedGet = jest.fn(async () => null as unknown)
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords: { get: mockSynqedGet } })),
}))
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => [{ id: 'syn-c1', name: 'Synqed Hanako' }]),
}))

import { getKaruteRecord } from '@/lib/supabase/karute'

beforeEach(() => {
  singleResponse = { data: null, error: null }
  capturedEqId = null
})

describe('getKaruteRecord', () => {
  it('returns the record on success', async () => {
    const row = {
      id: 'k1',
      summary: 'note',
      customers: { id: 'c1', name: 'Hanako' },
      entries: [{ id: 'e1', category: 'general', content: 'x' }],
    }
    singleResponse = { data: row, error: null }

    const result = await getKaruteRecord('k1')

    expect(result).toEqual(row)
  })

  it('returns null when no row is found (PGRST116)', async () => {
    singleResponse = {
      data: null,
      error: { code: 'PGRST116', message: 'The result contains 0 rows' },
    }

    const result = await getKaruteRecord('missing')

    expect(result).toBeNull()
  })

  it('falls back to synqed-core on PGRST116 and adapts the shape', async () => {
    singleResponse = {
      data: null,
      error: { code: 'PGRST116', message: 'The result contains 0 rows' },
    }
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
    expect(result.customers).toEqual({ id: 'syn-c1', name: 'Synqed Hanako' })
    expect(result.entries[0].category).toBe('symptom') // UPPERCASE → lowercase
    expect(result.entries[0].source_quote).toBe('q') // original_quote → source_quote
    expect(result.entries[0].confidence_score).toBe(0.9) // confidence → confidence_score
  })

  it('throws when Supabase returns a non-PGRST116 error', async () => {
    singleResponse = {
      data: null,
      error: { code: '42P01', message: 'relation does not exist' },
    }

    await expect(getKaruteRecord('k1')).rejects.toThrow(
      'relation does not exist',
    )
  })

  it('filters by the requested id', async () => {
    singleResponse = { data: { id: 'k9' }, error: null }

    await getKaruteRecord('k9')

    expect(capturedEqId).toBe('k9')
  })
})

export {}
