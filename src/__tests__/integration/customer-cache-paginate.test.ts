/**
 * getCachedCustomerList feeds the agenda's customer name + karute number. It
 * capped at the first 500 by name, so a tenant past 500 customers rendered
 * "— 様" with no number for everyone sorting past #500 (the blank-name bug). The
 * fix paginates to completion. The subtle part: name is NON-unique, so offset
 * paging can repeat a row across a page boundary — and `accumulated >= total`
 * would then stop early while a real row was dropped. paginateDedupe counts
 * UNIQUE ids so a double-count can't mask a drop.
 */
import { paginateDedupe } from '@/lib/customers/paginate'

const c = (id: string) => ({ id, name: id })
const pager = (pages: { id: string; name: string }[][], total: number) =>
  async (page: number) => ({ items: pages[page - 1] ?? [], total })

describe('paginateDedupe', () => {
  it('returns a single page', async () => {
    const out = await paginateDedupe(pager([[c('a'), c('b')]], 2))
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('accumulates across pages', async () => {
    const out = await paginateDedupe(pager([[c('a'), c('b')], [c('c'), c('d')]], 4))
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a double-counted row does NOT early-stop and mask a dropped row', async () => {
    // page 2 repeats b; with naive `accumulated >= total` the count hits 3 at
    // page 2 and stops, silently missing c. Dedupe-by-id keeps paging to page 3.
    const out = await paginateDedupe(pager([[c('a'), c('b')], [c('b')], [c('c')]], 3))
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('stops at maxPages and warns instead of looping forever', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await paginateDedupe(async (page) => ({ items: [c('x' + page)], total: 100 }), 3)
    expect(out).toHaveLength(3)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('handles an empty list', async () => {
    expect(await paginateDedupe(pager([[]], 0))).toEqual([])
  })
})
