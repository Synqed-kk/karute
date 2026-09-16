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
import { createInviteCore } from '@/actions/invites'
import { setStaffStoresAtCreationCore, createStoreCore } from '@/actions/stores'
import {
  INVITE_NAME_REQUIRED,
  STAFF_STORE_REQUIRED,
  STAFF_STORES_OUTSIDE_CREATOR,
} from '@/lib/auth/store-gate'

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
}) {
  const stores = (opts.stores ?? ['store-ginza', 'store-daikanyama']).map((s) =>
    typeof s === 'string' ? { id: s } : s,
  )
  const assignments = opts.assignments ?? {}
  const staffCreate = jest.fn(async () => ({ id: 'staff-new' }))
  const staffDelete = jest.fn(async () => ({}))
  const staffStoresSet = jest.fn(async (id: string, ids: string[]) => {
    if (opts.setFails) throw new Error('core down')
    assignments[id] = ids
    return {}
  })
  return {
    api: {
      staff: {
        create: staffCreate,
        delete: staffDelete,
        list: async () => ({ staff: (opts.roster ?? []).map((id) => ({ id })) }),
      },
      staffStores: {
        get: async (id: string) => ({ store_ids: assignments[id] ?? [] }),
        set: staffStoresSet,
      },
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
    expect(res).toEqual({ id: 'staff-new' })
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

describe('1 → 2 stores: nobody blanks mid-shift', () => {
  const ownerDeps = {
    staffList: [{ id: 'owner-1', display_role: 'owner' }],
    selfUserId: 'owner-1',
    source: 'web' as const,
  }
  const input = { name: '銀座', address: '', phone: '', business_type: 'hair_salon' }

  it('backfills every unassigned card to the EXISTING store', async () => {
    // Two stores AFTER the create (the transition), three staff, two of whom
    // have no assignment at all — exactly the salon this rule exists for.
    const c = client({
      stores: ['store-daikanyama', 'store-new'],
      roster: ['owner-1', 'staff-a', 'staff-b'],
      assignments: { 'staff-b': ['store-daikanyama'] },
    })
    const res = await createStoreCore(c.api as never, 'business-1', ownerDeps, input)
    expect(res).toEqual({ id: 'store-new' })
    expect(c.assignments['owner-1']).toEqual(['store-daikanyama'])
    expect(c.assignments['staff-a']).toEqual(['store-daikanyama'])
    // Already placed — left exactly as it was.
    expect(c.assignments['staff-b']).toEqual(['store-daikanyama'])
  })

  it('does NOT fire on a 2→3 store opening — only the transition blanks people', async () => {
    const c = client({
      stores: ['store-daikanyama', 'store-ginza', 'store-new'],
      roster: ['staff-a'],
    })
    await createStoreCore(c.api as never, 'business-1', ownerDeps, input)
    expect(c.staffStoresSet).not.toHaveBeenCalled()
  })

  // ⚖ FOLD ROUND 3 (fresh-eyes F2) — ONE SPELLING OF THE STORE COUNT. The
  // backfill used to count raw store ROWS while the gate counts
  // storeCountForGate (active stores, or all rows when none is active). An
  // ARCHIVED store made the two disagree in both directions.
  it('an ARCHIVED store + the first real second store: the backfill still runs (F2a)', async () => {
    // The gate goes 1 → 2 here (one active store becomes two), so every
    // floating card is about to become UNASSIGNED — the exact blanking this
    // backfill exists to prevent. Raw rows = 3, which used to return early.
    const c = client({
      stores: ['store-daikanyama', { id: 'store-old', active: false }, 'store-new'],
      roster: ['staff-a'],
    })
    const res = await createStoreCore(c.api as never, 'business-1', ownerDeps, input)
    expect(res).toEqual({ id: 'store-new' })
    expect(c.assignments['staff-a']).toEqual(['store-daikanyama'])
  })

  it('never backfills into an ARCHIVED store (F2b)', async () => {
    // A business that archived its only store and opened a new one: the gate
    // counts ONE active store, so the single-store carve-out still holds and
    // nobody blanks. Raw rows = 2, which used to fire the backfill and clamp
    // everyone into the CLOSED store, hiding the live one from them.
    const c = client({
      stores: [{ id: 'store-old', active: false }, 'store-new'],
      roster: ['staff-a'],
    })
    await createStoreCore(c.api as never, 'business-1', ownerDeps, input)
    expect(c.staffStoresSet).not.toHaveBeenCalled()
    expect(c.assignments['staff-a']).toBeUndefined()
  })

  it('a failed backfill never undoes the store the owner just created', async () => {
    const c = client({
      stores: ['store-daikanyama', 'store-new'],
      roster: ['staff-a'],
      setFails: true,
    })
    const res = await createStoreCore(c.api as never, 'business-1', ownerDeps, input)
    expect(res).toEqual({ id: 'store-new' })
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// A FRESH INVITE MAKES THE CARD (⚖ Liam 2026-09-16 16:1x)
//
// Before this, an email-only invite carried no staff row: the card was minted on
// ACCEPT, with no store. Now the card is made up front — named by a person,
// placed in a store — and the invite carries its id as `invited_staff_id`, so
// accept attaches the login through the EXISTING re-invite path
// (chooseStaffToLink → staff.update) with no change to acceptInvite at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('a fresh invite makes the card', () => {
  const INV_DEPS = { actorId: 'mgr-1', source: 'web' as const, requestId: 'req-1' }

  function inviteClient(opts: Parameters<typeof client>[0] = {}) {
    const c = client(opts)
    const invitesCreate = jest.fn(async () => ({ id: 'inv-1' }))
    return {
      ...c,
      invitesCreate,
      api: { ...c.api, invites: { create: invitesCreate } },
    }
  }

  it('REFUSES a fresh invite with no store in a multi-store business', async () => {
    const c = inviteClient({ stores: ['store-ginza', 'store-daikanyama'] })
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ error: STAFF_STORE_REQUIRED })
    expect(c.staffCreate).not.toHaveBeenCalled()
    expect(c.invitesCreate).not.toHaveBeenCalled()
  })

  it('REFUSES a fresh invite with no NAME — never an email-named card', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
    })
    expect(res).toEqual({ error: INVITE_NAME_REQUIRED })
    expect(c.staffCreate).not.toHaveBeenCalled()
    expect(c.invitesCreate).not.toHaveBeenCalled()
  })

  it('REFUSES a creator placing the hire outside their OWN stores', async () => {
    const c = inviteClient({})
    const res = await createInviteCore(
      c.api as never,
      'business-1',
      { ...INV_DEPS, creatorAllowedStoreIds: ['store-ginza'] },
      null,
      { email: 'new@test.com', role: 'STYLIST', name: '新人', storeIds: ['store-daikanyama'] },
    )
    expect(res).toEqual({ error: STAFF_STORES_OUTSIDE_CREATOR })
    // The card was rolled back, and no invite exists for it.
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
    expect(c.invitesCreate).not.toHaveBeenCalled()
  })

  it('a SINGLE-store business needs no store — the carve-out holds here too', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ token: expect.any(String) })
    expect(c.staffCreate).toHaveBeenCalled()
    expect(c.staffStoresSet).not.toHaveBeenCalled()
  })

  it('the invite carries invited_staff_id = the new card, so ACCEPT attaches the login to it', async () => {
    const c = inviteClient({})
    const res = await createInviteCore(
      c.api as never,
      'business-1',
      { ...INV_DEPS, creatorAllowedStoreIds: ['store-ginza'] },
      'mgr-1',
      { email: 'new@test.com', role: 'STYLIST', name: '新人', storeIds: ['store-ginza'] },
    )
    expect(res).toEqual({ token: expect.any(String) })
    expect(c.assignments['staff-new']).toEqual(['store-ginza'])
    expect(c.invitesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ invited_staff_id: 'staff-new' }),
    )
    // acceptInvite's existing re-invite arm keys on exactly that field:
    // chooseStaffToLink(invite.invited_staff_id, …) → staff.update(user_id).
    // Pinned as the seam, so a change to either half shows up here.
    const { chooseStaffToLink } = await import('@/lib/invites/link')
    expect(
      chooseStaffToLink('staff-new', 'new@test.com', [{ id: 'staff-new' } as never]),
    ).toBe('staff-new')
  })

  it('a failed INVITE write rolls the card back — no card without its invite', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    c.invitesCreate.mockRejectedValue(new Error('core down'))
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect('error' in res).toBe(true)
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
  })

  it('a RE-invite is untouched — no card is made, the existing one is named', async () => {
    const c = inviteClient({})
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'known@test.com',
      role: 'STYLIST',
      staffId: '11111111-1111-4111-8111-111111111111',
    })
    expect(res).toEqual({ token: expect.any(String) })
    expect(c.staffCreate).not.toHaveBeenCalled()
    expect(c.invitesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ invited_staff_id: '11111111-1111-4111-8111-111111111111' }),
    )
  })
})

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
