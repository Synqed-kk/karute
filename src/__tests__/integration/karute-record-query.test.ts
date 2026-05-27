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
