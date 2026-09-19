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

import { createStaffCore } from '@/actions/staff'
import { setStaffStoresAtCreationCore } from '@/actions/stores'
import { STAFF_CARD_LEFT_BEHIND } from '@/lib/staff/new-card'
import {
  STAFF_STORE_REQUIRED,
} from '@/lib/auth/store-gate'
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

const DEPS = { actorId: 'owner-1', source: 'web' as const, requestId: 'req-1' }
const CARD = { name: '田中', position: '', email: '', phone: '' }

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

describe('a new card must name its store', () => {
  it('REFUSES a create with no store in a multi-store business — and mints nothing', async () => {
    const c = client({ stores: ['store-ginza', 'store-daikanyama'] })
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, CARD)
    expect(res).toEqual({ error: STAFF_STORE_REQUIRED })
    expect(c.staffCreate).not.toHaveBeenCalled()
  })

  it('a ONE-store salon is untouched — no picker, no store, no refusal', async () => {
    const c = client({ stores: ['store-ginza'] })
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, CARD)
    expect(res).toEqual({ id: 'staff-new' })
    expect(c.staffStoresSet).not.toHaveBeenCalled()
  })

  it('an unreadable store list never blocks hiring — the gate is the backstop', async () => {
    const c = client({})
    c.api.stores.list = (async () => {
      throw new Error('core down')
    }) as never
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, CARD)
    // ⚖ I2: still not blocked — and the answer now SAYS the store count could
    // not be read, instead of looking like an ordinary placement.
    expect(res).toEqual({ id: 'staff-new', storeUnknown: true })
  })

  // ⚖ I2 — AN UNPLACED CARD IS NEVER SILENT. Unknown still never blocks
  // hiring, but the card is created with nobody knowing whether it needs a
  // store, so the door says so — one row, and a line on the screen.
  it('an UNREADABLE store list answers storeUnknown and leaves a notice — the 追加 door (I2)', async () => {
    const c = client({})
    c.api.stores.list = (async () => {
      throw new Error('core down')
    }) as never
    ;(audit as jest.Mock).mockClear()
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, CARD)
    expect(res).toEqual({ id: 'staff-new', storeUnknown: true })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.add',
        severity: 'notice',
        targetId: 'staff-new',
        detail: expect.objectContaining({ reason: 'store_count_unknown_unplaced' }),
      }),
    )
  })

  it('a KNOWN one-store business stays silent — the honest case (I2)', async () => {
    const c = client({ stores: ['store-ginza'] })
    ;(audit as jest.Mock).mockClear()
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, CARD)
    expect(res).toEqual({ id: 'staff-new' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'staff.add', severity: 'info' }),
    )
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ reason: 'store_count_unknown_unplaced' }),
      }),
    )
  })

  it('places the card in the SAME action when a store is named', async () => {
    const c = client({})
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, {
      ...CARD,
      storeIds: ['store-ginza'],
    })
    expect(res).toEqual({ id: 'staff-new' })
    expect(c.staffStoresSet).toHaveBeenCalledWith('staff-new', ['store-ginza'])
  })

  it('a FAILED placement rolls the card back — never a floating card', async () => {
    const c = client({ setFails: true })
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, {
      ...CARD,
      storeIds: ['store-ginza'],
    })
    expect('error' in res).toBe(true)
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
  })
})

describe('a card that could not be placed is never left silently (F8)', () => {
  it('a FAILED rollback is SURFACED — the owner is told a card is floating', async () => {
    // Double failure: the placement failed AND the delete that undoes it
    // failed. The caller used to hear the PLACEMENT error while a card nobody
    // knows about sits on the roster. "The degraded outcome is honest, not
    // silent" — this is the one crack in it.
    const c = client({ setFails: true, deleteFails: true })
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, {
      ...CARD,
      storeIds: ['store-ginza'],
    })
    expect(res).toEqual({ error: STAFF_CARD_LEFT_BEHIND })
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
    // ⚖ G8 — and the card that stayed behind leaves a trace: the door's own
    // staff.add never fires for a rolled-back card, so without this row the
    // roster grew with nothing in 監査ログ and no id to find it by.
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'staff',
        action: 'staff.add',
        severity: 'warning',
        targetType: 'staff',
        targetId: 'staff-new',
        detail: expect.objectContaining({ reason: 'rollback_failed' }),
      }),
    )
  })

  // ── PIN T6 — a rollback that SUCCEEDS says nothing. The G8 row means "a card
  // is on the roster nobody announced"; firing it on the ordinary undo would
  // fill 監査ログ with cards that no longer exist.
  it('a SUCCESSFUL rollback writes no rollback_failed row (T6)', async () => {
    const c = client({ setFails: true })
    ;(audit as jest.Mock).mockClear()
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, {
      ...CARD,
      storeIds: ['store-ginza'],
    })
    expect('error' in res).toBe(true)
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ reason: 'rollback_failed' }),
      }),
    )
  })

  it('a client that cannot place staff REFUSES the storeIds — never a silent skip', async () => {
    // storeIds asked for, no staffStores port to honour them with: the card
    // used to be created and simply never placed, with no error at all.
    const c = client({ noStaffStoresPort: true })
    const res = await createStaffCore(c.api as never, 'business-1', DEPS, {
      ...CARD,
      storeIds: ['store-ginza'],
    })
    expect(res).toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
  })
})

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

  it('the SAME rule reaches the create door — a clamped creator cannot mint elsewhere', async () => {
    const c = client({})
    const res = await createStaffCore(
      c.api as never,
      'business-1',
      { ...DEPS, creatorAllowedStoreIds: ['store-ginza'] },
      { ...CARD, storeIds: ['store-daikanyama'] },
    )
    expect(res).toEqual({ error: STAFF_STORES_OUTSIDE_CREATOR })
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FOLD ROUND 2 — the creator's OWN clamp (fresh-eyes F6 + F7)
// ─────────────────────────────────────────────────────────────────────────────
describe('a store-clamped creator can obey the requirement (F6)', () => {
  it('places a hire in their OWN store — the picker now has that store to offer', async () => {
    const c = client({})
    const res = await createStaffCore(
      c.api as never,
      'business-1',
      { ...DEPS, creatorAllowedStoreIds: ['store-ginza'] },
      { ...CARD, storeIds: ['store-ginza'] },
    )
    expect(res).toEqual({ id: 'staff-new' })
    expect(c.assignments['staff-new']).toEqual(['store-ginza'])
  })

  it('…and still cannot place one OUTSIDE it', async () => {
    const c = client({})
    const res = await createStaffCore(
      c.api as never,
      'business-1',
      { ...DEPS, creatorAllowedStoreIds: ['store-ginza'] },
      { ...CARD, storeIds: ['store-daikanyama'] },
    )
    expect(res).toEqual({ error: STAFF_STORES_OUTSIDE_CREATOR })
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
  })
})

describe('a DEGRADED creator places nobody (F7)', () => {
  // `resolveStoreScope().allowedStoreIds` is null when the staff_stores lookup
  // FAILED, and null means UNCLAMPED to the subset check — so during a core
  // blip a 銀座-only creator would have become able to place a hire in 代官山.
  // Both web doors now pass `[]` for that shape. A WRITE fails closed on an
  // unknown; only the read plane keeps today's behaviour.
  it('an EMPTY creator allow-list refuses every store', async () => {
    const c = client({})
    const res = await createStaffCore(
      c.api as never,
      'business-1',
      { ...DEPS, creatorAllowedStoreIds: [] },
      { ...CARD, storeIds: ['store-ginza'] },
    )
    expect(res).toEqual({ error: STAFF_STORES_OUTSIDE_CREATOR })
    expect(c.staffStoresSet).not.toHaveBeenCalled()
  })

  it('MUTANT — pass the degraded null through and 代官山 becomes placeable', async () => {
    const c = client({})
    const res = await createStaffCore(
      c.api as never,
      'business-1',
      // The pre-fold value: `allowedStoreIds` straight through, null on a
      // degraded lookup.
      { ...DEPS, creatorAllowedStoreIds: null },
      { ...CARD, storeIds: ['store-daikanyama'] },
    )
    expect(res).toEqual({ id: 'staff-new' })
    expect(c.assignments['staff-new']).toEqual(['store-daikanyama'])
  })
})
