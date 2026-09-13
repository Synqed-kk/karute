// R8 discarded-record door (⚖ Liam 2026-09-13) — read-door siblings + the ACL
// helper, unit-level. Neither getKaruteRecord nor readKaruteRaw are edited or
// exercised here (NEVER list); these are the NEW siblings only.

const karuteGet = jest.fn()
const rawFetch = jest.fn()
const fakeClient = {
  karuteRecords: { get: (id: string) => karuteGet(id) },
  fetch: (path: string) => rawFetch(path),
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: async () => fakeClient,
  newSynqedClient: () => fakeClient,
}))
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: async () => [{ id: 'cust-1', name: '山田 花子' }],
}))

import { getKaruteRecordIncludingDiscarded } from '@/lib/supabase/karute'
import { readKaruteRaw, readKaruteRawIncludingDiscarded } from '@/lib/app-api/karute-facade'
import { AppApiError } from '@/lib/app-api/errors'

const notFound = () => Object.assign(new Error('nope'), { status: 404 })
const upstream = () => Object.assign(new Error('boom'), { status: 500 })

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getKaruteRecordIncludingDiscarded (web sibling, R8 §2)', () => {
  it('an ordinary (live) record resolves via the plain get() — the retry never fires', async () => {
    karuteGet.mockResolvedValue({
      id: 'k1',
      created_at: '2026-01-01T00:00:00Z',
      customer_id: 'cust-1',
      status: 'APPROVED',
    })
    const rec = await getKaruteRecordIncludingDiscarded('k1')
    expect(rec?.status).toBe('APPROVED')
    expect(rawFetch).not.toHaveBeenCalled()
  })

  it('get() 404s → retries ONCE via a raw fetch carrying exactly include_discarded=true', async () => {
    karuteGet.mockRejectedValue(notFound())
    rawFetch.mockResolvedValue({
      id: 'k1',
      created_at: '2026-01-01T00:00:00Z',
      customer_id: 'cust-1',
      status: 'DISCARDED',
    })
    const rec = await getKaruteRecordIncludingDiscarded('k1')
    expect(rec?.status).toBe('DISCARDED')
    expect(rawFetch).toHaveBeenCalledTimes(1)
    expect(rawFetch).toHaveBeenCalledWith('/karute-records/k1?include_discarded=true')
  })

  it('the retry ALSO 404s → null (genuinely missing/cross-tenant, honest)', async () => {
    karuteGet.mockRejectedValue(notFound())
    rawFetch.mockRejectedValue(notFound())
    expect(await getKaruteRecordIncludingDiscarded('k1')).toBeNull()
  })

  it('a non-404 failure degrades to null WITHOUT retrying (cold-read SHOULD #3 — never a blind retry-on-any-failure)', async () => {
    karuteGet.mockRejectedValue(upstream())
    expect(await getKaruteRecordIncludingDiscarded('k1')).toBeNull()
    expect(rawFetch).not.toHaveBeenCalled()
  })

  it('a non-404 on the retry leg also degrades to null, never throws', async () => {
    karuteGet.mockRejectedValue(notFound())
    rawFetch.mockRejectedValue(upstream())
    expect(await getKaruteRecordIncludingDiscarded('k1')).toBeNull()
  })
})

describe('readKaruteRawIncludingDiscarded (facade sibling, R8 §2)', () => {
  it('an ordinary record resolves directly — no retry', async () => {
    karuteGet.mockResolvedValue({ id: 'k1', status: 'APPROVED' })
    const raw = await readKaruteRawIncludingDiscarded(fakeClient as never, 'k1')
    expect((raw as { status: string }).status).toBe('APPROVED')
    expect(rawFetch).not.toHaveBeenCalled()
  })

  it('404 retries once carrying exactly include_discarded=true and returns the discarded row on success', async () => {
    karuteGet.mockRejectedValue(notFound())
    rawFetch.mockResolvedValue({ id: 'k1', status: 'DISCARDED' })
    const raw = await readKaruteRawIncludingDiscarded(fakeClient as never, 'k1')
    expect((raw as { status: string }).status).toBe('DISCARDED')
    expect(rawFetch).toHaveBeenCalledTimes(1)
    expect(rawFetch).toHaveBeenCalledWith('/karute-records/k1?include_discarded=true')
  })

  it('a retry that ALSO 404s throws the SAME not_found body classifyGetError throws for an ordinary missing id — byte-identical', async () => {
    karuteGet.mockRejectedValueOnce(notFound())
    let baseline: AppApiError | undefined
    try {
      await readKaruteRaw(fakeClient as never, 'missing-id')
    } catch (e) {
      baseline = e as AppApiError
    }
    expect(baseline).toBeInstanceOf(AppApiError)

    karuteGet.mockRejectedValueOnce(notFound())
    rawFetch.mockRejectedValueOnce(notFound())
    let refused: AppApiError | undefined
    try {
      await readKaruteRawIncludingDiscarded(fakeClient as never, 'refused-id')
    } catch (e) {
      refused = e as AppApiError
    }
    expect(refused).toBeInstanceOf(AppApiError)
    expect(refused?.code).toBe('not_found')
    expect(refused?.status).toBe(404)
    // Byte-identical body shape: same code, same status, same message text —
    // the two ids are indistinguishable to a viewer who cannot tell "does not
    // exist" from "discarded, not yours" (A3's oracle-closing requirement).
    expect(JSON.stringify({ code: refused?.code, message: refused?.message })).toBe(
      JSON.stringify({ code: baseline?.code, message: baseline?.message }),
    )
  })

  it('a non-404 on the first leg is upstream_unavailable — no retry', async () => {
    karuteGet.mockRejectedValue(upstream())
    await expect(readKaruteRawIncludingDiscarded(fakeClient as never, 'k1')).rejects.toMatchObject({
      code: 'upstream_unavailable',
    })
    expect(rawFetch).not.toHaveBeenCalled()
  })

  it('a non-404 on the retry leg is upstream_unavailable too', async () => {
    karuteGet.mockRejectedValue(notFound())
    rawFetch.mockRejectedValue(upstream())
    await expect(readKaruteRawIncludingDiscarded(fakeClient as never, 'k1')).rejects.toMatchObject({
      code: 'upstream_unavailable',
    })
  })
})
