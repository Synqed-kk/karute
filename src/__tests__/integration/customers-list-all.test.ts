/**
 * listAllCustomers pages synqed-core's customer list to completion (the server
 * clamps page_size at 500, so a single call drops everyone past #500 off the
 * 顧客 + カルテ surfaces). Two traps the council flagged and these lock down:
 *  1. paginateDedupe returns by-id INSERTION order, not the server sort — so the
 *     helper MUST re-sort in memory or the list silently reorders.
 *  2. The SAME search must go into every page closure; applying it only on page 1
 *     would page the unfiltered set against a filtered total.
 */
import { listAllCustomers } from '@/lib/customers/list-all'

const mk = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `name-${id}`,
  created_at: `2026-01-0${id}T00:00:00Z`,
  updated_at: `2026-02-0${id}T00:00:00Z`,
  ...over,
})

type ListArg = { page: number; search?: string; page_size?: number }
const client = (pages: ReturnType<typeof mk>[][], total: number) => ({
  customers: {
    list: jest.fn(async ({ page }: ListArg) => ({
      customers: pages[page - 1] ?? [],
      total,
    })),
  },
})

describe('listAllCustomers', () => {
  it('assembles every page and re-sorts updated_at DESC (server order discarded by dedupe)', async () => {
    // pages arrive 1,3 then 2 → dedupe insertion order is [1,3,2]; the helper
    // must re-sort to updated_at DESC = [3,2,1].
    const c = client([[mk('1'), mk('3')], [mk('2')]], 3)
    const { customers, total } = await listAllCustomers(c as never, {
      sort_by: 'updated_at',
      sort_order: 'desc',
    })
    expect(customers.map((x) => x.id)).toEqual(['3', '2', '1'])
    expect(total).toBe(3)
  })

  it('re-sorts created_at ASC for the karute/profile surfaces', async () => {
    const c = client([[mk('3'), mk('1')], [mk('2')]], 3)
    const { customers } = await listAllCustomers(c as never, {
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    expect(customers.map((x) => x.id)).toEqual(['1', '2', '3'])
  })

  it('passes the SAME search + page_size:500 into EVERY page call', async () => {
    const c = client([[mk('1')], [mk('2')]], 2)
    await listAllCustomers(c as never, { search: 'tan', sort_by: 'name', sort_order: 'asc' })
    const calls = c.customers.list.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const [arg] of calls) {
      expect(arg.search).toBe('tan')
      expect(arg.page_size).toBe(500)
    }
  })

  it('returns the real total for a single under-cap page', async () => {
    const c = client([[mk('1'), mk('2')]], 2)
    const { customers, total } = await listAllCustomers(c as never)
    expect(customers.map((x) => x.id)).toEqual(['1', '2'])
    expect(total).toBe(2)
  })
})
