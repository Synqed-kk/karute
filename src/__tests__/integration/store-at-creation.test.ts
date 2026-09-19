/**
 * STORE AT CREATION + SAFE GROWTH (⚖ Liam 2026-09-16, PKT-P2b).
 *
 * The gate makes an unplaced staff member see nothing. This is the other half:
 * nobody should BE unplaced in the first place.
 *
 *   - a new card in a multi-store business must name its store, or the create
 *     is refused;
 *   - the creator may only place the new hire inside their OWN stores;
 *   - a failed placement never leaves a floating card behind;
 *   - and the day a salon opens its second store, everyone who was "floating"
 *     is backfilled to the store they have been working in all along.
 */

import { setStaffStoresAtCreationCore } from '@/actions/stores'
import { audit } from '@/lib/audit'

/** One name for one code (⚖ fold round 3, N1): the refusal when a creator
 *  names a store they do not work in is the same STORE_SCOPE_DENIED every
 *  other door already spells. */
const STAFF_STORES_OUTSIDE_CREATOR = 'STORE_SCOPE_DENIED'

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {},
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('@/lib/supabase/service', () => ({
  // Two shapes ride this one stub: createStaffCore's email→profile link
  // (.eq.eq.maybeSingle) and createInviteCore's existing-member check
  // (.ilike.eq.maybeSingle). Both answer "nobody" — a brand-new hire.
  createServiceClient: () => {
    const none = { maybeSingle: async () => ({ data: null }) }
    const chain: Record<string, unknown> = {}
    chain.eq = () => chain
    chain.ilike = () => chain
    chain.maybeSingle = none.maybeSingle
    return { from: () => ({ select: () => chain }) }
  },
}))
jest.mock('@/lib/entitlements', () => ({
  loadEntitlementWithClient: async () => ({ canAddStore: true }),
}))
jest.mock('@/lib/business-name', () => ({ businessDisplayName: async () => 'Main store' }))


function client(opts: {
  /** A bare id is an ACTIVE store; `{ id, active: false }` is an archived one
   *  (⚖ fold round 3 / fresh-eyes F2 — the gate counts ACTIVE stores). */
  stores?: (string | { id: string; active: boolean })[]
  assignments?: Record<string, string[]>
  roster?: string[]
  setFails?: boolean
  /** ⚖ G4 — ONE member's placement throws, `failSetTimes` times (Infinity =
   *  core never recovers). Everyone else is placed normally, which is what
   *  makes "the rest are not stranded" a real assertion. */
  failSetFor?: string
  failSetTimes?: number
  /** The ROLLBACK itself fails — the double failure F8 is about. */
  deleteFails?: boolean
  /** A client with no staffStores port at all (a partial test double, or a
   *  caller wired without it): storeIds it cannot honour. */
  noStaffStoresPort?: boolean
}) {
  const stores = (opts.stores ?? ['store-ginza', 'store-daikanyama']).map((s) =>
    typeof s === 'string' ? { id: s } : s,
  )
  const assignments = opts.assignments ?? {}
  const staffCreate = jest.fn(async () => ({ id: 'staff-new' }))
  const staffDelete = jest.fn(async () => {
    if (opts.deleteFails) throw new Error('core down')
    return {}
  })
  const setAttempts: Record<string, number> = {}
  const staffStoresSet = jest.fn(async (id: string, ids: string[]) => {
    if (opts.setFails) throw new Error('core down')
    if (opts.failSetFor === id) {
      setAttempts[id] = (setAttempts[id] ?? 0) + 1
      if (setAttempts[id] <= (opts.failSetTimes ?? 1)) throw new Error('core down')
    }
    assignments[id] = ids
    return {}
  })
  return {
    api: {
      staff: {
        create: staffCreate,
        delete: staffDelete,
        // Honours page/page_size like core does (and reports `total`), so a
        // roster past one page is a real read here — ⚖ fold round 3 / F3.
        list: async (o?: { page?: number; page_size?: number }) => {
          const all = (opts.roster ?? []).map((id) => ({ id }))
          const size = o?.page_size ?? all.length
          const page = o?.page ?? 1
          return { staff: all.slice((page - 1) * size, page * size), total: all.length }
        },
      },
      ...(opts.noStaffStoresPort
        ? {}
        : {
            staffStores: {
              get: async (id: string) => ({ store_ids: assignments[id] ?? [] }),
              set: staffStoresSet,
            },
          }),
      stores: {
        list: async () => ({ stores: stores.map((s, i) => ({ ...s, is_primary: i === 0 })) }),
        create: jest.fn(async () => ({ id: 'store-new' })),
      },
    },
    staffCreate,
    staffDelete,
    staffStoresSet,
    assignments,
  }
}

describe('the creator may only place a hire inside their OWN stores', () => {
  const storeDeps = { staffList: [], selfUserId: 'mgr-1', source: 'web' as const }

  it('refuses a store outside the creator’s assignment', async () => {
    const c = client({})
    const res = await setStaffStoresAtCreationCore(
      c.api as never,
      'business-1',
      storeDeps,
      'staff-new',
      ['store-daikanyama'],
      ['store-ginza'],
    )
    expect(res).toEqual({ error: STAFF_STORES_OUTSIDE_CREATOR })
    expect(c.staffStoresSet).not.toHaveBeenCalled()
  })

  it('allows a store the creator works in', async () => {
    const c = client({})
    const res = await setStaffStoresAtCreationCore(
      c.api as never,
      'business-1',
      storeDeps,
      'staff-new',
      ['store-ginza'],
      ['store-ginza'],
    )
    expect(res).toEqual({ ok: true })
  })

  // ── PIN T5 — the placement WRITES ITS ROW. Without it a manager can move a
  // new hire into their store with nothing in 監査ログ saying who did it.
  it('the at-creation placement writes settings.staff_stores_change (T5)', async () => {
    const c = client({})
    ;(audit as jest.Mock).mockClear()
    const res = await setStaffStoresAtCreationCore(
      c.api as never,
      'business-1',
      storeDeps,
      'staff-new',
      ['store-ginza'],
      ['store-ginza'],
    )
    expect(res).toEqual({ ok: true })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'settings',
        action: 'settings.staff_stores_change',
        severity: 'notice',
        targetType: 'staff',
        targetId: 'staff-new',
        detail: expect.objectContaining({ at_creation: true, store_ids: 'store-ginza', count: 1 }),
      }),
    )
  })

  it('an UNCLAMPED creator (owner) may place anywhere', async () => {
    const c = client({})
    const res = await setStaffStoresAtCreationCore(
      c.api as never,
      'business-1',
      storeDeps,
      'staff-new',
      ['store-daikanyama'],
      null,
    )
    expect(res).toEqual({ ok: true })
  })

})

