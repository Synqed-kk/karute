/**
 * R8 fix round 1 (LENS §3, mutant M21) — the カルテ LIST page had NO test
 * harness at all: forcing `viewerCanOpenDiscarded={false}` at
 * `src/app/[locale]/(app)/karute/page.tsx:169` left the whole battery green.
 * Smallest harness, same idiom as reassign-flag-threading-web-page.test.ts:
 * mock every dependency, call the page directly (an async server component
 * — no renderer needed), and read the props it hands KaruteRecordListView
 * off the returned element tree.
 */
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getStaffList: jest.fn(async () => []),
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ staff: { list: jest.fn(async () => ({ data: [] })) } })),
}))
jest.mock('@/lib/karute/karute-window', () => ({
  loadKaruteWindowWithMonthProbe: jest.fn(async () => ({
    data: { rows: [], freshStoreTotal: 0, freshDiscardedCount: 0, windowStart: null, hasMore: false },
    monthProbe: { total: 0 },
  })),
}))
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomersCached: jest.fn(async () => []),
}))
const grantedCaps = { current: new Set<string>() }
jest.mock('@/lib/auth/require-permission', () => ({
  can: jest.fn(async (cap: string) => grantedCaps.current.has(cap)),
}))
const storeScope = {
  current: { storeId: null as string | null, viewAll: true, allowedStoreIds: null as string[] | null, degraded: false },
}
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => storeScope.current),
  storeStaffIdSet: jest.fn(async () => null),
}))
jest.mock('@/lib/karute/screen-rows', () => ({
  buildSessionsListScreen: jest.fn(() => ({
    items: [], staffList: [], currentStaffId: null, customerOptions: [],
  })),
}))
jest.mock('@/components/karute/spike-lifted/list/KaruteRecordListView', () => ({
  KaruteRecordListView: () => null,
}))

import KaruteRecordsListPage from '@/app/[locale]/(app)/karute/page'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'

/** Same technique as reassign-flag-threading-web-page.test.ts: the page is an
 *  async server component that RETURNS an element tree — no DOM/renderer
 *  needed, walk the returned objects for the target element's props. */
async function viewPropsFromListPage(): Promise<Record<string, unknown>> {
  const tree = await KaruteRecordsListPage()
  const found: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const el = node as { type?: unknown; props?: Record<string, unknown> }
    if (el.type === KaruteRecordListView && el.props) found.push(el.props)
    if (el.props) walk(el.props.children)
  }
  walk(tree)
  if (found.length !== 1) throw new Error(`expected ONE KaruteRecordListView, found ${found.length}`)
  return found[0]
}

beforeEach(() => {
  jest.clearAllMocks()
  grantedCaps.current = new Set()
  storeScope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
})

describe('KaruteRecordsListPage — viewerCanOpenDiscarded threading (R8 fix round 1, §3) [mutant M21]', () => {
  it('threads true when the caller holds records.discardView', async () => {
    grantedCaps.current = new Set(['records.discardView'])
    const props = await viewPropsFromListPage()
    expect(props.viewerCanOpenDiscarded).toBe(true)
  })

  it('threads false when the caller lacks records.discardView', async () => {
    grantedCaps.current = new Set()
    const props = await viewPropsFromListPage()
    expect(props.viewerCanOpenDiscarded).toBe(false)
  })
})
