/**
 * Coverage for the synqed-core karute read helpers (src/lib/karute/synqed-records.ts)
 * that back the karute list + customer session-history read-migration. Verifies:
 *   - synqed KaruteRecord → Supabase read-shape field mapping
 *   - customerId filter is forwarded to the synqed list call
 *   - graceful [] on synqed-core error
 *   - merge dedupes by id (Supabase wins), sorts date-desc, caps at limit
 */
import {
  listSynqedKaruteRows,
  listSynqedKaruteRowsWithTotal,
  listSynqedKaruteRowsWithTotalOrThrow,
  listSynqedKaruteRowsWithMonthProbe,
  mergeKaruteRows,
} from '@/lib/karute/synqed-records'

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

  it('forwards the storeId filter to the synqed list call', async () => {
    const list = jest.fn(async () => ({ karute_records: [] }))
    await listSynqedKaruteRows(asClient(list), { storeId: 'store-1' })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-1', page_size: 200 }),
    )
  })

  it('omits store_id when storeId is null (all-stores view)', async () => {
    const list = jest.fn(async () => ({ karute_records: [] }))
    await listSynqedKaruteRows(asClient(list), { storeId: null })
    expect(list).toHaveBeenCalledWith(
      expect.not.objectContaining({ store_id: expect.anything() }),
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

// PR-1b (正直ヘッダー + 検索リビール): the sibling that also reads `total` —
// used both for the main row read (store-wide total) and the 今月 probe
// (from/to bounds, page_size 1). Existing listSynqedKaruteRows(OrThrow) pair
// above is untouched; this is coverage for the ADDITION only.
describe('listSynqedKaruteRowsWithTotalOrThrow', () => {
  it('maps rows the same way as listSynqedKaruteRows AND returns total', async () => {
    const { rows, total } = await listSynqedKaruteRowsWithTotalOrThrow(
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
        total: 42,
      })),
    )
    expect(total).toBe(42)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'k1',
      summary: 'sum',
      staff_profile_id: 'st1',
      customer_id: 'biz',
      client_id: 'cli1',
    })
  })

  it('forwards customerId/storeId/from/to/page_size to the synqed list call', async () => {
    const list = jest.fn(async () => ({ karute_records: [], total: 0 }))
    await listSynqedKaruteRowsWithTotalOrThrow(asClient(list), {
      customerId: 'cust-9',
      storeId: 'store-1',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-24T00:00:00.000Z',
      page_size: 1,
    })
    expect(list).toHaveBeenCalledWith({
      customer_id: 'cust-9',
      store_id: 'store-1',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-24T00:00:00.000Z',
      page_size: 1,
    })
  })

  it('defaults page_size to 200 and omits from/to when not given (main row-read shape)', async () => {
    const list = jest.fn(async (_opts: unknown) => ({ karute_records: [], total: 0 }))
    await listSynqedKaruteRowsWithTotalOrThrow(asClient(list), { storeId: 'store-1' })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-1', page_size: 200 }),
    )
    expect(list.mock.calls[0][0]).not.toHaveProperty('from')
    expect(list.mock.calls[0][0]).not.toHaveProperty('to')
  })

  it('throws through a synqed-core failure (no swallow)', async () => {
    await expect(
      listSynqedKaruteRowsWithTotalOrThrow(
        asClient(async () => {
          throw new Error('boom')
        }),
      ),
    ).rejects.toThrow('boom')
  })
})

describe('listSynqedKaruteRowsWithTotal', () => {
  it('degrades to {rows: [], total: 0} when synqed-core throws', async () => {
    const result = await listSynqedKaruteRowsWithTotal(
      asClient(async () => {
        throw new Error('boom')
      }),
    )
    expect(result).toEqual({ rows: [], total: 0 })
  })

  it('passes through a real result unchanged on success', async () => {
    const result = await listSynqedKaruteRowsWithTotal(
      asClient(async () => ({ karute_records: [], total: 7 })),
    )
    expect(result).toEqual({ rows: [], total: 7 })
  })
})

// Greptile PR #775 fix: the main row read and the 今月 probe used to be two
// INDEPENDENT degrade-wrapped calls — one transiently failing while the
// other succeeded could make the header contradict the visible list
// (positive list + 今月 0件, or the reverse). These pin the shared fate.
describe('listSynqedKaruteRowsWithMonthProbe', () => {
  const opts = {
    storeId: 'store-1',
    monthFrom: '2026-08-01T00:00:00.000Z',
    monthTo: '2026-08-24T00:00:00.000Z',
  }

  it('both calls succeed: returns the main read and the probe independently', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce({ karute_records: [], total: 10 }) // main
      .mockResolvedValueOnce({ karute_records: [], total: 3 }) // probe
    const result = await listSynqedKaruteRowsWithMonthProbe(asClient(list), opts)
    expect(result.data.total).toBe(10)
    expect(result.monthProbe.total).toBe(3)
  })

  it('the month probe throwing zeroes the MAIN rows too — shared fate, not an independent degrade', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce({
        karute_records: [{ id: 'k1', business_id: 'biz', customer_id: 'cli1', created_at: '2026-08-01T00:00:00Z', entry_count: 0 }],
        total: 10,
      }) // main succeeds
      .mockRejectedValueOnce(new Error('boom')) // probe fails
    const result = await listSynqedKaruteRowsWithMonthProbe(asClient(list), opts)
    expect(result).toEqual({
      data: { rows: [], total: 0 },
      monthProbe: { rows: [], total: 0 },
    })
  })

  it('the main read throwing zeroes the MONTH PROBE too — shared fate, not an independent degrade (vice versa)', async () => {
    const list = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom')) // main fails
      .mockResolvedValueOnce({ karute_records: [], total: 3 }) // probe succeeds
    const result = await listSynqedKaruteRowsWithMonthProbe(asClient(list), opts)
    expect(result).toEqual({
      data: { rows: [], total: 0 },
      monthProbe: { rows: [], total: 0 },
    })
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
