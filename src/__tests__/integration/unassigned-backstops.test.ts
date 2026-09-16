/**
 * LAYER 4 — the fail-closed BACKSTOPS for "a staff member with no store
 * assigned sees nothing and does nothing" (⚖ Liam 2026-09-16, PKT-P2).
 *
 * The change is layered on purpose: the GATE (empty capability set + the honest
 * empty screen + the resolvers' `unassigned` verdict) lands separately. These
 * tests exercise the layer UNDERNEATH it — every consumer the census
 * (CENSUS-UNASSIGNED-FLIP.md) proved would fall OPEN, driven directly with the
 * shape an unassigned actor resolves to (`allowedStoreIds: []`, `storeId:
 * null`). So every assertion here is a GATE-OFF assertion by construction: no
 * capability is emptied, no front gate runs, nothing is redirected — the
 * backstop is the only thing standing.
 *
 * The bug class in one line: `storeId ?? undefined` means "every store" to
 * core, so a null store lens turns "sees nothing" into "sees everything"
 * exactly on the busiest surfaces (dashboard, day agenda, カルテ list, bulk
 * PII export).
 */

import { reachesNoStore, UNASSIGNED_STORE_DENIAL } from '@/lib/auth/store-gate'
import { resolveExportStoreId } from '@/lib/app-api/store-clamp'
import { loadKaruteWindowRows, loadKaruteWindowWithMonthProbe } from '@/lib/karute/karute-window'
import { emptyDashboardData } from '@/lib/dashboard/cached'
import type { Capability } from '@/lib/auth/permissions'

// @synqed-kk/client is ESM-only; lib/dashboard/cached's graph reaches it at
// module load. Nothing in this suite calls through it — stub it out, same as
// the sibling store-scope suites.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {}, SynqedError: class extends Error {} }))

jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))

const caps = (...c: Capability[]) => new Set<Capability>(c)

// ───────────────────────────────────────────────────────────────────────────
// THE ONE GUARD
// ───────────────────────────────────────────────────────────────────────────
describe('reachesNoStore — the one guard every backstop spells', () => {
  it('is TRUE only for a clamped scope with an EMPTY allow-list', () => {
    expect(reachesNoStore({ allowedStoreIds: [] })).toBe(true)
  })

  it('is FALSE for every shape that exists today — unclamped and clamped alike', () => {
    // `null` = stores.viewAll / floating staff / a degraded lookup. All three
    // keep today's business-wide behaviour; the gate never widens a refusal.
    expect(reachesNoStore({ allowedStoreIds: null })).toBe(false)
    expect(reachesNoStore({ allowedStoreIds: ['store-ginza'] })).toBe(false)
    expect(reachesNoStore({ allowedStoreIds: ['store-ginza', 'store-daikanyama'] })).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// #1 IN THE CENSUS' BLAST-RADIUS RANKING — the facade bulk PII export
// ───────────────────────────────────────────────────────────────────────────
describe('facade bulk export lens (resolveExportStoreId)', () => {
  const synqedWith = (assignment: string[], stores: string[] = ['store-ginza']) =>
    ({
      stores: {
        get: async (id: string) => ({ id }),
        list: async () => ({ stores: stores.map((id) => ({ id, is_primary: id === stores[0] })) }),
      },
      staffStores: { get: async () => ({ store_ids: assignment }) },
    }) as never

  // ⚠ GATE-OFF LIMIT, stated rather than faked: resolveStoreForRequest still
  // answers `allowedStoreIds: null` for an empty assignment on this branch, so
  // the REFUSAL this lens now carries is not reachable end-to-end yet. Its
  // proof (and its mutation proof) rides the gate branch, where the resolver
  // mints `[]`. What these three pin is that the fix changed NOTHING for the
  // three shapes that exist today.
  it('a clamped actor still exports their OWN store', async () => {
    await expect(
      resolveExportStoreId({
        synqed: synqedWith(['store-ginza']),
        authUserId: 'staff-1',
        capabilities: caps(),
        requestedStoreId: null,
      } as never),
    ).resolves.toBe('store-ginza')
  })

  it('a floating actor still clamps to the primary store', async () => {
    await expect(
      resolveExportStoreId({
        synqed: synqedWith([], ['store-daikanyama', 'store-ginza']),
        authUserId: 'staff-1',
        capabilities: caps(),
        requestedStoreId: null,
      } as never),
    ).resolves.toBe('store-daikanyama')
  })

  it('stores.viewAll still exports business-wide', async () => {
    await expect(
      resolveExportStoreId({
        synqed: synqedWith([]),
        authUserId: 'owner-1',
        capabilities: caps('stores.viewAll'),
        requestedStoreId: null,
      } as never),
    ).resolves.toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// #2 — the カルテ list, the shared loader behind BOTH platforms' four doors
// ───────────────────────────────────────────────────────────────────────────
describe('カルテ window loader (enforceStore)', () => {
  // The walk reads through the client's own fetch() (the mixed
  // include_discarded read), so the spy sits there and the URL carries the
  // store filter — exactly what "did the business-wide read happen?" asks.
  const sdk = () => {
    const fetch = jest.fn(async (_path: string) => ({
      karute_records: [],
      total: 0,
      discarded_count: 0,
    }))
    const list = jest.fn(async () => ({ karute_records: [], total: 0 }))
    return { client: { fetch, karuteRecords: { list } } as never, fetch, list }
  }
  const NOW = new Date('2026-09-16T03:00:00Z')

  it('enforceStore + no store = an EMPTY window, and core is never asked', async () => {
    const { client, fetch, list } = sdk()
    const w = await loadKaruteWindowRows(client, {
      storeId: null,
      enforceStore: true,
      now: NOW,
    })
    expect(w.rows).toEqual([])
    expect(w.freshStoreTotal).toBe(0)
    expect(w.freshDiscardedCount).toBe(0)
    expect(w.hasMore).toBe(false)
    // Not merely "an empty answer" — the business-wide read never happens.
    expect(fetch).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it('the 今月 probe is refused on the same terms (both legs, one flag)', async () => {
    const { client, fetch, list } = sdk()
    const res = await loadKaruteWindowWithMonthProbe(client, {
      storeId: null,
      enforceStore: true,
      monthFrom: '2026-09-01T00:00:00Z',
      monthTo: '2026-09-16T03:00:00Z',
      now: NOW,
    })
    expect(res.data?.rows).toEqual([])
    expect(res.monthProbe).toEqual({ total: 0 })
    expect(fetch).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it('an UNCLAMPED reader is unchanged — the business-wide read still runs', async () => {
    const { client, fetch } = sdk()
    await loadKaruteWindowRows(client, { storeId: null, enforceStore: false, now: NOW })
    expect(fetch).toHaveBeenCalled()
    expect(String(fetch.mock.calls[0][0])).not.toContain('store_id')
  })

  it('a clamped reader WITH a store is unchanged — the store filter still rides', async () => {
    const { client, fetch } = sdk()
    await loadKaruteWindowRows(client, {
      storeId: 'store-ginza',
      enforceStore: true,
      now: NOW,
    })
    expect(fetch).toHaveBeenCalled()
    expect(String(fetch.mock.calls[0][0])).toContain('store_id=store-ginza')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// #3 — the dashboard's zeroed shape (the first screen after login)
// ───────────────────────────────────────────────────────────────────────────
describe('dashboard', () => {
  it('emptyDashboardData is zeroed, not partial', () => {
    expect(emptyDashboardData()).toEqual({
      weeklyKaruteCount: 0,
      monthlyKaruteCount: 0,
      weekKaruteCount: 0,
      todayAppointments: [],
      tomorrowAppointments: [],
      recentKarute: [],
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// WRITE INTEGRITY — refuse, never `store_id: null`
// ───────────────────────────────────────────────────────────────────────────
describe('write-side refusal copy', () => {
  it('is Japanese and tells the staff member what to do next', () => {
    // ⚖ Liam: "they'll say I can't see anything and get assigned" — the copy
    // must point at the manager, not at a retry.
    expect(UNASSIGNED_STORE_DENIAL).toContain('担当店舗が未設定')
    expect(UNASSIGNED_STORE_DENIAL).toContain('管理者')
  })
})


