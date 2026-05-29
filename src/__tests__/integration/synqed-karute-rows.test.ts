/**
 * Coverage for the synqed-core karute read helpers (src/lib/karute/synqed-records.ts)
 * that back the karute list + customer session-history read-migration. Verifies:
 *   - synqed KaruteRecord → Supabase read-shape field mapping
 *   - customerId filter is forwarded to the synqed list call
 *   - graceful [] on synqed-core error
 *   - merge dedupes by id (Supabase wins), sorts date-desc, caps at limit
 */
import { listSynqedKaruteRows, mergeKaruteRows } from '@/lib/karute/synqed-records'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (list: (...a: unknown[]) => unknown) => ({ karuteRecords: { list } }) as any

describe('listSynqedKaruteRows', () => {
  it('maps a synqed KaruteRecord to the Supabase read shape', async () => {
    const rows = await listSynqedKaruteRows(
      asClient(async () => ({
        karute_records: [
          {
            id: 'k1',
            business_id: 'biz',
            customer_id: 'cli1',
            staff_id: 'st1',
            ai_summary: 'sum',
            transcript: 't',
            created_at: '2026-05-29T00:00:00Z',
            entry_count: 3,
          },
        ],
      })),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'k1',
      session_date: null, // synqed-core has no session_date
      created_at: '2026-05-29T00:00:00Z',
      summary: 'sum', // ai_summary → summary
      transcript: 't',
      staff_profile_id: 'st1', // staff_id → staff_profile_id
      customer_id: 'biz', // business_id → tenant customer_id
      client_id: 'cli1', // synqed customer_id → client_id
    })
    expect(rows[0].entries).toEqual([{ count: 3 }])
  })

  it('forwards the customerId filter to the synqed list call', async () => {
    const list = jest.fn(async () => ({ karute_records: [] }))
    await listSynqedKaruteRows(asClient(list), { customerId: 'cust-9' })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-9', page_size: 200 }),
    )
  })

  it('degrades to [] when synqed-core throws', async () => {
    const rows = await listSynqedKaruteRows(
      asClient(async () => {
        throw new Error('boom')
      }),
    )
    expect(rows).toEqual([])
  })
})

describe('mergeKaruteRows', () => {
  const row = (id: string, date: string) => ({
    id,
    session_date: date,
    created_at: date,
  })

  it('dedupes by id (Supabase wins) and sorts by date descending', () => {
    const supa = [row('a', '2026-05-01')]
    const syn = [row('a', '2026-04-01'), row('b', '2026-06-01')]
    const merged = mergeKaruteRows(supa, syn)
    // 'b' (June) first, then 'a'; 'a' is the Supabase copy (May), not synqed's April.
    expect(merged.map((r) => r.id)).toEqual(['b', 'a'])
    expect(merged.find((r) => r.id === 'a')?.created_at).toBe('2026-05-01')
  })

  it('caps the result at the limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(`r${i}`, `2026-05-0${i + 1}`),
    )
    expect(mergeKaruteRows([], rows, 2)).toHaveLength(2)
  })
})

export {}
