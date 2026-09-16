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
import { createInviteCore, listInvitesWithClient, revokeInviteCore } from '@/actions/invites'
import { setStaffStoresAtCreationCore, createStoreCore } from '@/actions/stores'
import { STAFF_CARD_LEFT_BEHIND } from '@/lib/staff/new-card'
import { INVITE_NAME_REQUIRED, STAFF_STORE_REQUIRED } from '@/lib/auth/store-gate'

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

  it('pages the whole roster — a 250-staff salon leaves nobody behind (F3)', async () => {
    // ⚖ ANY-ROSTER-SIZE on the store dimension. One `page_size: 200` read left
    // the overflow unassigned on the very day the gate started refusing them.
    const roster = Array.from({ length: 250 }, (_, i) => `staff-${i}`)
    const c = client({ stores: ['store-daikanyama', 'store-new'], roster })
    await createStoreCore(c.api as never, 'business-1', ownerDeps, input)
    expect(Object.keys(c.assignments)).toHaveLength(250)
    expect(c.assignments['staff-249']).toEqual(['store-daikanyama'])
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

  it('a failed invite whose ROLLBACK also fails is SURFACED, not swallowed (F8)', async () => {
    const c = inviteClient({ stores: ['store-ginza'], deleteFails: true })
    c.invitesCreate.mockRejectedValue(new Error('core down'))
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ error: STAFF_CARD_LEFT_BEHIND })
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

// A REVOKED FRESH INVITE LEAVES NO ORPHAN (⚖ fold round 3, fresh-eyes F4)
//
// A fresh invite now MINTS a staff card. Revoking the invite used to flip only
// the invite's status, leaving a named, store-placed card on the roster with no
// login — eating a plan seat nobody could explain. It goes INACTIVE (soft, the
// existing staff update path), never deleted (⚖ nothing deleted, soft only).
// ─────────────────────────────────────────────────────────────────────────────
describe('a revoked fresh invite leaves no orphan card (F4)', () => {
  const INV_DEPS = { actorId: 'mgr-1', source: 'web' as const, requestId: 'req-1' }

  function revokeClient(
    invites: { id: string; email: string; status: string; invited_staff_id: string | null }[],
    cards: Record<string, { id: string; email: string | null; user_id: string | null }>,
  ) {
    const staffUpdate = jest.fn(async () => ({}))
    const updateStatus = jest.fn(async () => ({}))
    return {
      staffUpdate,
      updateStatus,
      api: {
        invites: { list: async () => ({ invites }), updateStatus },
        staff: {
          get: async (id: string) => {
            if (!cards[id]) throw new Error('no such staff')
            return cards[id]
          },
          update: staffUpdate,
        },
      },
    }
  }

  it('the card a FRESH invite minted goes INACTIVE — never deleted', async () => {
    const c = revokeClient(
      [{ id: 'inv-1', email: 'new@test.com', status: 'pending', invited_staff_id: 'staff-new' }],
      { 'staff-new': { id: 'staff-new', email: 'new@test.com', user_id: null } },
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-1')
    expect(res).toEqual({ ok: true })
    expect(c.updateStatus).toHaveBeenCalledWith('inv-1', 'revoked')
    expect(c.staffUpdate).toHaveBeenCalledWith('staff-new', { is_active: false })
  })

  it('a RE-invite’s pre-existing card is left alone — the invite never made it', async () => {
    // 田中 has worked here for a year with no login. Re-inviting them at a new
    // address and then cancelling must not switch them off.
    const c = revokeClient(
      [
        {
          id: 'inv-2',
          email: 'new-address@test.com',
          status: 'pending',
          invited_staff_id: 'staff-tanaka',
        },
      ],
      { 'staff-tanaka': { id: 'staff-tanaka', email: 'tanaka@test.com', user_id: null } },
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-2')
    expect(res).toEqual({ ok: true })
    expect(c.staffUpdate).not.toHaveBeenCalled()
  })

  it('an ALREADY WIRED card is left alone — that person has a login', async () => {
    const c = revokeClient(
      [{ id: 'inv-3', email: 'new@test.com', status: 'pending', invited_staff_id: 'staff-new' }],
      { 'staff-new': { id: 'staff-new', email: 'new@test.com', user_id: 'auth-9' } },
    )
    await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-3')
    expect(c.staffUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ONE PENDING FRESH INVITE PER EMAIL (⚖ fold round 3, fresh-eyes F4)
//
// Inviting the same new hire twice minted two cards; accept wires one and the
// other is permanent. The duplicate check that existed only looked at people
// who ALREADY have a login.
// ─────────────────────────────────────────────────────────────────────────────
describe('a creator never loses sight of the invite they just sent (F5)', () => {
  // A fresh invite now carries invited_staff_id, so it goes through the same
  // store lens as a re-invite. A card minted during a core blip can have NO
  // store (the "an unreadable store list never blocks hiring" arm), and the
  // lens refuses a storeless target — which used to hide the row from the very
  // manager who had just created it, with no way to cancel it.
  const rows = [
    { id: 'inv-mine', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '', expires_at: null, invited_by: 'mgr-1', invited_staff_id: 'card-a' },
    { id: 'inv-theirs', email: 'b@test.com', role: 'STYLIST', status: 'pending', created_at: '', expires_at: null, invited_by: 'mgr-2', invited_staff_id: 'card-b' },
  ]
  const api = { invites: { list: async () => ({ invites: rows }) } }

  it('keeps the creator’s own row and still hides somebody else’s', async () => {
    const list = await listInvitesWithClient(
      api as never,
      undefined,
      async () => false, // every card is out of this clamped viewer's stores
      'mgr-1',
    )
    expect(list.map((i) => i.id)).toEqual(['inv-mine'])
  })
})

describe('one pending fresh invite per email (F4)', () => {
  const INV_DEPS = { actorId: 'mgr-1', source: 'web' as const, requestId: 'req-1' }

  function pendingClient(pending: { email: string; status: string }[]) {
    const c = client({ stores: ['store-ginza'] })
    const invitesCreate = jest.fn(async () => ({ id: 'inv-1' }))
    return {
      ...c,
      invitesCreate,
      api: {
        ...c.api,
        invites: { create: invitesCreate, list: async () => ({ invites: pending }) },
      },
    }
  }

  it('REFUSES a second pending invite to the same email — two cards, one hire', async () => {
    const c = pendingClient([{ email: 'New@Test.com', status: 'pending' }])
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ error: 'INVITE_ALREADY_PENDING' })
    expect(c.staffCreate).not.toHaveBeenCalled()
    expect(c.invitesCreate).not.toHaveBeenCalled()
  })

  it('a REVOKED invite to that email is no obstacle — only PENDING ones are', async () => {
    const c = pendingClient([{ email: 'new@test.com', status: 'revoked' }])
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ token: expect.any(String) })
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
