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
import { createInviteCore, listInvitesWithClient, reinviteTargetStaffIdWithClient, revokeInviteCore } from '@/lib/invites/invites.core'
import { setStaffStoresAtCreationCore } from '@/actions/stores'
import { STAFF_CARD_LEFT_BEHIND } from '@/lib/staff/new-card'
import {
  INVITE_NAME_REQUIRED,
  STAFF_CREATE_FAILED,
  STAFF_STORE_REQUIRED,
} from '@/lib/auth/store-gate'
import { audit, auditDurable } from '@/lib/audit'

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
// ⚖ Greptile #978 R1 F3: the invite door's staff.add (the mint row) is now
// written DURABLY — it is the provenance the revoke reads back.
jest.mock('@/lib/audit', () => ({ audit: jest.fn(), auditDurable: jest.fn(async () => ({ ok: true })) }))
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

const DEPS = { actorId: 'owner-1', source: 'web' as const, requestId: 'req-1', creatorAllowedStoreIds: null }
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
// A FRESH INVITE MAKES THE CARD (⚖ Liam 2026-09-16 16:1x)
//
// Before this, an email-only invite carried no staff row: the card was minted on
// ACCEPT, with no store. Now the card is made up front — named by a person,
// placed in a store — and the invite carries its id as `invited_staff_id`, so
// accept attaches the login through the EXISTING re-invite path
// (chooseStaffToLink → staff.update) with no change to acceptInvite at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('a fresh invite makes the card', () => {
  const INV_DEPS = { actorId: 'mgr-1', source: 'web' as const, requestId: 'req-1', creatorAllowedStoreIds: null }

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

  // Pin moved (F3): the invite door's staff.add is now an auditDurable row.
  it('a KNOWN store count keeps the invite door staff.add at info (J3 / U-V4)', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    ;(auditDurable as jest.Mock).mockClear()
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com', role: 'STYLIST', name: '新人',
    })
    expect(res).toEqual({ token: expect.any(String) })
    expect(auditDurable).toHaveBeenCalledWith(expect.objectContaining({
      action: 'staff.add', severity: 'info', targetId: 'staff-new',
    }))
    expect(auditDurable).not.toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ reason: 'store_count_unknown_unplaced' }),
    }))
  })

  // ⚖ Greptile #978 R1 F3 — THE MINT ROW NAMES ITS INVITE, durably. This row is
  // the only proof the revoke will accept that the card was made by this invite.
  it('the mint row carries minted_by_invite_id, written through auditDurable (F3)', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    ;(auditDurable as jest.Mock).mockClear()
    ;(audit as jest.Mock).mockClear()
    await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com', role: 'STYLIST', name: '新人',
    })
    expect(auditDurable).toHaveBeenCalledTimes(1)
    expect(auditDurable).toHaveBeenCalledWith(expect.objectContaining({
      action: 'staff.add', targetType: 'staff', targetId: 'staff-new',
      detail: { minted_by_invite_id: 'inv-1' },
    }))
    expect((audit as jest.Mock).mock.calls.filter(([row]) => row.action === 'staff.add')).toHaveLength(0)
  })

  it('a mint row that does NOT land is said out loud, and the invite still stands (F3)', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    ;(auditDurable as jest.Mock).mockResolvedValueOnce({ ok: false })
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
        email: 'new@test.com', role: 'STYLIST', name: '新人',
      })
      expect(res).toEqual({ token: expect.any(String) })
      expect(err).toHaveBeenCalledWith(expect.stringContaining('provenance unproven'), 'staff-new')
    } finally {
      err.mockRestore()
    }
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

  it.each([false, true])(
    'staff.add waits for the invite and emits exactly once, unknown count = %s (J4)',
    async (storeUnknown) => {
      const c = inviteClient({ stores: ['store-ginza'] })
      if (storeUnknown) c.api.stores.list = async () => { throw new Error('core down') }
      ;(audit as jest.Mock).mockClear()
      ;(auditDurable as jest.Mock).mockClear()
      c.invitesCreate.mockImplementation(async () => {
        expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.add' }))
        expect(auditDurable).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.add' }))
        return { id: 'inv-j4' }
      })

      const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
        email: 'new@test.com', role: 'STYLIST', name: '新人',
      })

      expect(res).toEqual({ token: expect.any(String), ...(storeUnknown ? { storeUnknown: true } : {}) })
      expect(c.invitesCreate).toHaveBeenCalledTimes(1)
      // Pin moved (F3): the row is now auditDurable, and its detail always
      // names the invite — merged with the unplaced reason when that applies.
      expect((audit as jest.Mock).mock.calls.filter(([row]) => row.action === 'staff.add')).toHaveLength(0)
      const adds = (auditDurable as jest.Mock).mock.calls.filter(([row]) => row.action === 'staff.add')
      expect(adds).toEqual([[expect.objectContaining({
        severity: storeUnknown ? 'notice' : 'info',
        targetId: 'staff-new',
        detail: storeUnknown
          ? { reason: 'store_count_unknown_unplaced', minted_by_invite_id: 'inv-j4' }
          : { minted_by_invite_id: 'inv-j4' },
      })]])
    },
  )

  it('a failed INVITE write rolls the card back — no card without its invite', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    c.invitesCreate.mockRejectedValue(new Error('core down'))
    ;(audit as jest.Mock).mockClear()
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect('error' in res).toBe(true)
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
    expect((audit as jest.Mock).mock.calls.filter(([row]) => row.action === 'staff.add')).toHaveLength(0)
  })

  it('a failed invite whose ROLLBACK also fails is SURFACED, not swallowed (F8)', async () => {
    const c = inviteClient({ stores: ['store-ginza'], deleteFails: true })
    c.invitesCreate.mockRejectedValue(new Error('core down'))
    ;(audit as jest.Mock).mockClear()
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ error: STAFF_CARD_LEFT_BEHIND })
    expect(c.staffDelete).toHaveBeenCalledWith('staff-new')
    // ⚖ G8 — the invite-side twin of the same trace.
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.add',
        severity: 'warning',
        targetId: 'staff-new',
        detail: expect.objectContaining({ reason: 'rollback_failed' }),
      }),
    )
    expect((audit as jest.Mock).mock.calls.filter(([row]) => row.action === 'staff.add')).toHaveLength(1)
  })

  // ⚖ G6 — THE MINT STAYS INSIDE THE CONTRACT. A core rejection on
  // staff.create used to escape createInviteCore as an unhandled Server Action
  // error — message stripped in production, so the dialog showed nothing.
  it('a core rejection on the card mint comes back as a MACHINE CODE, not a throw (G6)', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    c.staffCreate.mockRejectedValue(new Error('core down'))
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ error: STAFF_CREATE_FAILED })
    expect(c.invitesCreate).not.toHaveBeenCalled()
  })

  it('a client with NO staff port answers with the same code (G6)', async () => {
    const c = inviteClient({ stores: ['store-ginza'] })
    const api = { ...c.api } as Record<string, unknown>
    delete api.staff
    const res = await createInviteCore(api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ error: STAFF_CREATE_FAILED })
  })

  // ⚖ I2 — the SAME answer on the invite door.
  it('an UNREADABLE store list answers storeUnknown and leaves a notice — the 招待 door (I2)', async () => {
    const c = inviteClient({})
    c.api.stores.list = (async () => {
      throw new Error('core down')
    }) as never
    ;(auditDurable as jest.Mock).mockClear()
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, null, {
      email: 'new@test.com',
      role: 'STYLIST',
      name: '新人',
    })
    expect(res).toEqual({ token: expect.any(String), storeUnknown: true })
    // Pin moved (F3): the invite door's staff.add is an auditDurable row now.
    expect(auditDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.add',
        severity: 'notice',
        targetId: 'staff-new',
        detail: expect.objectContaining({ reason: 'store_count_unknown_unplaced' }),
      }),
    )
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

  // ⚖ G5, re-grounded by Greptile #978 R1 F3 — PROVENANCE IS THE LEDGER. A
  // card counts as "minted by this invite" only when it is unwired AND the
  // append-only audit log holds a staff.add row for it naming THIS invite
  // (minted_by_invite_id). `ledger` is that log; `mintRow` builds the row.
  const SENT_AT = '2026-09-19T09:00:30.000Z'
  const MINTED_AT = '2026-09-19T09:00:29.000Z' // 1 s before the invite row
  const mintRow = (cardId: string, inviteId: string) => ({
    id: `ev-${cardId}`, action: 'staff.add', target_type: 'staff', target_id: cardId,
    at: MINTED_AT, detail: { minted_by_invite_id: inviteId },
  })
  function revokeClient(
    invites: {
      id: string
      email: string
      status: string
      invited_staff_id: string | null
      created_at: string
    }[],
    cards: Record<
      string,
      { id: string; email: string | null; user_id: string | null; created_at?: string }
    >,
    ledger: ReturnType<typeof mintRow>[] = [],
  ) {
    const staffUpdate = jest.fn(async () => ({}))
    const updateStatus = jest.fn(async () => ({}))
    const invitesList = jest.fn(async () => ({ invites }))
    const auditList = jest.fn(async () => ({ events: ledger, total: ledger.length, page: 1, page_size: 50 }))
    return {
      staffUpdate,
      updateStatus,
      invitesList,
      auditList,
      api: {
        audit: { list: auditList },
        invites: { list: invitesList, updateStatus },
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
      [
        {
          id: 'inv-1',
          email: 'new@test.com',
          status: 'pending',
          invited_staff_id: 'staff-new',
          created_at: SENT_AT,
        },
      ],
      {
        'staff-new': {
          id: 'staff-new',
          email: 'new@test.com',
          user_id: null,
          created_at: MINTED_AT,
        },
      },
      [mintRow('staff-new', 'inv-1')],
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-1')
    expect(res).toEqual({ ok: true })
    expect(c.updateStatus).toHaveBeenCalledWith('inv-1', 'revoked')
    expect(c.staffUpdate).toHaveBeenCalledWith('staff-new', { is_active: false })
    // F3 — the ledger was asked about THIS card, around ITS birth.
    expect(c.auditList).toHaveBeenCalledWith({
      category: 'staff',
      target_type: 'staff',
      target_id: 'staff-new',
      from: '2026-09-19T08:50:29.000Z',
      to: '2026-09-19T09:10:29.000Z',
      page_size: 50,
    })
    // F4 — re-read clean: the pre-flip read plus ONE re-read before the write.
    expect(c.invitesList).toHaveBeenCalledTimes(2)
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
          created_at: SENT_AT,
        },
      ],
      {
        'staff-tanaka': {
          id: 'staff-tanaka',
          email: 'tanaka@test.com',
          user_id: null,
          created_at: '2025-09-01T00:00:00.000Z',
        },
      },
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-2')
    expect(res).toEqual({ ok: true })
    expect(c.staffUpdate).not.toHaveBeenCalled()
  })

  it('an ALREADY WIRED card is left alone — that person has a login', async () => {
    const c = revokeClient(
      [
        {
          id: 'inv-3',
          email: 'new@test.com',
          status: 'pending',
          invited_staff_id: 'staff-new',
          created_at: SENT_AT,
        },
      ],
      {
        'staff-new': {
          id: 'staff-new',
          email: 'new@test.com',
          user_id: 'auth-9',
          created_at: MINTED_AT,
        },
      },
      // Even with a mint row naming THIS invite, a wired card is never touched.
      [mintRow('staff-new', 'inv-3')],
    )
    await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-3')
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ kept_because: 'provenance_not_proven' }),
      }),
    )
  })

  // ── PIN T1, REWRITTEN for Greptile #978 R1 F3. It used to pin the 30 s
  // CLOCK window (a card born 1 s after the invite row is not its). The clock
  // is gone: Greptile's probe was a card added by hand and re-invited within
  // 30 s at the same address, which the clock called "minted". Provenance is
  // now the ledger row, so the pin is: a card whose clock would PASS but whose
  // ledger names nothing — or ANOTHER invite — or cannot be read — is kept,
  // provenance_not_proven, and never switched off. (Renamed reason: the old
  // 'not_minted_by_invite' claimed a fact; 'provenance_not_proven' says what
  // is actually known.)
  it.each([
    ['names ANOTHER invite', [mintRow('staff-new', 'inv-other')], false],
    ['holds no mint row (hand-added card)', [], false],
    ['cannot be read', [], true],
  ] as const)('a card whose ledger %s is KEPT — provenance_not_proven (T1 / F3)', async (_case, ledger, listThrows) => {
    const c = revokeClient(
      [
        {
          id: 'inv-t1',
          email: 'new@test.com',
          status: 'pending',
          invited_staff_id: 'staff-new',
          created_at: SENT_AT,
        },
      ],
      {
        'staff-new': {
          id: 'staff-new',
          email: 'new@test.com', // same address, born 1 s before: the clock would have said yes
          user_id: null,
          created_at: MINTED_AT,
        },
      },
      [...ledger],
    )
    if (listThrows) c.auditList.mockRejectedValue(new Error('core down'))
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(audit as jest.Mock).mockClear()
    try {
      const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-t1')
      expect(res).toEqual({ ok: true })
    } finally {
      err.mockRestore()
    }
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'staff-new',
        detail: expect.objectContaining({ kept_because: 'provenance_not_proven' }),
      }),
    )
  })

  it('a card with no parseable created_at is never proven — no ledger read at all (F3)', async () => {
    const c = revokeClient(
      [{ id: 'inv-t2', email: 'new@test.com', status: 'pending', invited_staff_id: 'staff-new', created_at: SENT_AT }],
      { 'staff-new': { id: 'staff-new', email: 'new@test.com', user_id: null } },
      [mintRow('staff-new', 'inv-t2')],
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-t2')
    expect(res).toEqual({ ok: true })
    expect(c.auditList).not.toHaveBeenCalled()
    expect(c.staffUpdate).not.toHaveBeenCalled()
  })

  // ⚖ Greptile #978 R1 F4 — RE-READ BEFORE THE DEACTIVATION WRITE. The pre-flip
  // snapshot cannot see a re-invite created after it.
  it('a NEW live invite for the card appears after the snapshot → card KEPT, another_live_invite (F4)', async () => {
    const rowA = { id: 'inv-f4', email: 'new@test.com', status: 'pending', invited_staff_id: 'staff-new', created_at: SENT_AT }
    const c = revokeClient(
      [rowA],
      { 'staff-new': { id: 'staff-new', email: 'new@test.com', user_id: null, created_at: MINTED_AT } },
      [mintRow('staff-new', 'inv-f4')],
    )
    c.invitesList
      .mockResolvedValueOnce({ invites: [rowA] }) // the pre-flip snapshot
      .mockResolvedValueOnce({
        invites: [
          { ...rowA, status: 'revoked' },
          { id: 'inv-B', email: 'new@test.com', status: 'pending', invited_staff_id: 'staff-new',
            created_at: '2026-09-19T09:05:00.000Z' },
        ],
      })
    ;(audit as jest.Mock).mockClear()
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-f4')
    expect(res).toEqual({ ok: true })
    expect(c.invitesList).toHaveBeenCalledTimes(2)
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'staff-new',
        detail: expect.objectContaining({ kept_because: 'another_live_invite' }),
      }),
    )
  })

  it('an UNREADABLE re-read keeps the card — recheck_unreadable (F4)', async () => {
    const rowA = { id: 'inv-f4b', email: 'new@test.com', status: 'pending', invited_staff_id: 'staff-new', created_at: SENT_AT }
    const c = revokeClient(
      [rowA],
      { 'staff-new': { id: 'staff-new', email: 'new@test.com', user_id: null, created_at: MINTED_AT } },
      [mintRow('staff-new', 'inv-f4b')],
    )
    c.invitesList
      .mockResolvedValueOnce({ invites: [rowA] })
      .mockRejectedValueOnce(new Error('core down'))
    ;(audit as jest.Mock).mockClear()
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-f4b')
    expect(res).toEqual({ ok: true })
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ kept_because: 'recheck_unreadable' }),
      }),
    )
  })

  it.each(['null', 'undefined', 'throw'] as const)(
    'an unreadable card (%s) stays untouched with exactly one card_unreadable notice (J1)',
    async (read) => {
      const c = revokeClient(
        [{ id: 'inv-j1', email: 'new@test.com', status: 'pending',
          invited_staff_id: 'staff-new', created_at: SENT_AT }],
        {},
      )
      c.api.staff.get = (async () => {
        if (read === 'throw') throw new Error('core down')
        return read === 'null' ? null : undefined
      }) as never
      ;(audit as jest.Mock).mockClear()

      const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-j1')

      expect(res).toEqual({ ok: true })
      expect(c.updateStatus).toHaveBeenCalledWith('inv-j1', 'revoked')
      expect(c.staffUpdate).not.toHaveBeenCalled()
      expect(audit).toHaveBeenCalledTimes(2)
      const notices = (audit as jest.Mock).mock.calls.filter(([row]) => row.severity === 'notice')
      expect(notices).toEqual([[expect.objectContaining({
        action: 'staff.invite_revoke',
        targetType: 'staff',
        targetId: 'staff-new',
        detail: {
          invite_id: 'inv-j1',
          reason: 'invite_revoked_card_kept',
          kept_because: 'card_unreadable',
        },
      })]])
    },
  )

  // ⚖ I4 — A REVOKE THAT COULD NOT LOOK AT THE CARD SAYS SO. The pre-flip read
  // came back null, so the card block never ran and nothing was recorded.
  it('an UNREADABLE invite list leaves a notice, with no target (I4)', async () => {
    const c = revokeClient([], {})
    c.api.invites.list = (async () => {
      throw new Error('core down')
    }) as never
    ;(audit as jest.Mock).mockClear()
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-9')
    expect(res).toEqual({ ok: true })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.invite_revoke',
        severity: 'notice',
        detail: expect.objectContaining({ reason: 'invite_revoked_card_not_checked' }),
      }),
    )
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ targetType: 'staff' }))
  })

  it('a client with NO staff port names the card it could not check (I4)', async () => {
    const c = revokeClient(
      [
        {
          id: 'inv-6',
          email: 'new@test.com',
          status: 'pending',
          invited_staff_id: 'staff-new',
          created_at: SENT_AT,
        },
      ],
      {},
    )
    const api = { ...c.api } as Record<string, unknown>
    delete api.staff
    ;(audit as jest.Mock).mockClear()
    const res = await revokeInviteCore(api as never, 'business-1', INV_DEPS, 'inv-6')
    expect(res).toEqual({ ok: true })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'notice',
        targetType: 'staff',
        targetId: 'staff-new',
        detail: expect.objectContaining({ reason: 'invite_revoked_card_not_checked' }),
      }),
    )
  })

  it.each([true, false])(
    'an invite with no card writes no notice, staff port present = %s (J2 / U-V10)',
    async (hasStaffPort) => {
      const c = revokeClient(
        [{ id: 'inv-j2', email: 'new@test.com', status: 'pending',
          invited_staff_id: null, created_at: SENT_AT }],
        {},
      )
      const api = { ...c.api } as Record<string, unknown>
      if (!hasStaffPort) delete api.staff
      ;(audit as jest.Mock).mockClear()

      const res = await revokeInviteCore(api as never, 'business-1', INV_DEPS, 'inv-j2')

      expect(res).toEqual({ ok: true })
      expect(c.staffUpdate).not.toHaveBeenCalled()
      expect(audit).toHaveBeenCalledTimes(1)
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'staff.invite_revoke', detail: { invite_id: 'inv-j2' },
      }))
      expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'notice' }))
    },
  )

  // ⚖ I1 — A CARD A LIVE INVITE STILL NEEDS IS NEVER SWITCHED OFF. Revoking
  // an ALREADY-SUPERSEDED invite (a stale list, the phone's own copy) used to
  // reach the very card the new invite is about to wire.
  it('revoking an already-superseded invite leaves the card ACTIVE (I1, invite_not_pending)', async () => {
    const c = revokeClient(
      [
        {
          id: 'inv-A',
          email: 'new@test.com',
          status: 'revoked', // A was superseded when B was created
          invited_staff_id: 'staff-new',
          created_at: SENT_AT,
        },
        {
          id: 'inv-B',
          email: 'new@test.com',
          status: 'pending',
          invited_staff_id: 'staff-new',
          created_at: '2026-09-19T09:05:00.000Z',
        },
      ],
      {
        'staff-new': {
          id: 'staff-new',
          email: 'new@test.com',
          user_id: null,
          created_at: MINTED_AT,
        },
      },
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-A')
    expect(res).toEqual({ ok: true })
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.invite_revoke',
        severity: 'notice',
        targetId: 'staff-new',
        detail: expect.objectContaining({ kept_because: 'invite_not_pending' }),
      }),
    )
  })

  it('…and the same when A is still pending but B is live too (I1, another_live_invite)', async () => {
    // The create-side supersede never ran (unreadable list at the time), so
    // BOTH rows are live. Cancelling the old one must not touch the card.
    const c = revokeClient(
      [
        {
          id: 'inv-A',
          email: 'new@test.com',
          status: 'pending',
          invited_staff_id: 'staff-new',
          created_at: SENT_AT,
        },
        {
          id: 'inv-B',
          email: 'new@test.com',
          status: 'accepted',
          invited_staff_id: 'staff-new',
          created_at: '2026-09-19T09:05:00.000Z',
        },
      ],
      {
        'staff-new': {
          id: 'staff-new',
          email: 'new@test.com',
          user_id: null,
          created_at: MINTED_AT,
        },
      },
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-A')
    expect(res).toEqual({ ok: true })
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ kept_because: 'another_live_invite' }),
      }),
    )
  })

  // ⚖ G5 — THE REVIEWER'S FAILING PROBE, MADE A TEST. 山田 has worked here for
  // a year and has never logged in, so their card is unwired and carries the
  // address the owner re-invited them at. Under the old email-only rule,
  // cancelling that re-invite switched a working staff member OFF.
  it('an ESTABLISHED employee re-invited at their OWN address stays ACTIVE (G5)', async () => {
    const c = revokeClient(
      [
        {
          id: 'inv-4',
          email: 'yamada@test.com',
          status: 'pending',
          invited_staff_id: 'staff-yamada',
          created_at: SENT_AT,
        },
      ],
      {
        'staff-yamada': {
          id: 'staff-yamada',
          email: 'yamada@test.com', // the SAME address — the old rule's whole test
          user_id: null, // never logged in — still takes bookings every day
          created_at: '2025-06-01T00:00:00.000Z', // on the roster for a year
        },
      },
    )
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-4')
    expect(res).toEqual({ ok: true })
    expect(c.staffUpdate).not.toHaveBeenCalled()
    // …and never silently: the card that was LEFT standing is named.
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.invite_revoke',
        severity: 'notice',
        targetType: 'staff',
        targetId: 'staff-yamada',
        detail: expect.objectContaining({ reason: 'invite_revoked_card_kept' }),
      }),
    )
  })

  it('a cleanup that FAILS is said out loud too (G5)', async () => {
    const c = revokeClient(
      [
        {
          id: 'inv-5',
          email: 'new@test.com',
          status: 'pending',
          invited_staff_id: 'staff-new',
          created_at: SENT_AT,
        },
      ],
      {
        'staff-new': {
          id: 'staff-new',
          email: 'new@test.com',
          user_id: null,
          created_at: MINTED_AT,
        },
      },
      [mintRow('staff-new', 'inv-5')],
    )
    c.staffUpdate.mockRejectedValueOnce(new Error('core down'))
    const res = await revokeInviteCore(c.api as never, 'business-1', INV_DEPS, 'inv-5')
    expect(res).toEqual({ ok: true })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.invite_revoke',
        severity: 'notice',
        targetId: 'staff-new',
        detail: expect.objectContaining({ reason: 'invite_revoked_card_kept', kept_because: 'update_failed' }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ONE PENDING FRESH INVITE PER EMAIL (⚖ fold round 3, fresh-eyes F4)
//
// Inviting the same new hire twice minted two cards; accept wires one and the
// other is permanent. The duplicate check that existed only looked at people
// who ALREADY have a login.
// ─────────────────────────────────────────────────────────────────────────────
describe('a creator keeps their own invite only while its target is storeless (F5 / G1)', () => {
  // A fresh invite now carries invited_staff_id, so it goes through the same
  // store lens as a re-invite. A card minted during a core blip can have NO
  // store (the "an unreadable store list never blocks hiring" arm), and the
  // lens refuses a storeless target — which used to hide the row from the very
  // manager who had just created it, with no way to cancel it.
  const rows = [
    { id: 'inv-mine', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '', expires_at: null, invited_by: 'mgr-1', invited_staff_id: 'card-a' },
    { id: 'inv-theirs', email: 'b@test.com', role: 'STYLIST', status: 'pending', created_at: '', expires_at: null, invited_by: 'mgr-2', invited_staff_id: 'card-b' },
  ]
  const api = {
    invites: { list: async () => ({ invites: rows }) },
    staffStores: { get: async () => ({ store_ids: [] as string[] }) },
  }

  it('keeps the creator’s own row and still hides somebody else’s', async () => {
    const list = await listInvitesWithClient(
      api as never,
      undefined,
      async () => false, // every card is out of this clamped viewer's stores
      'mgr-1',
    )
    expect(list.map((i) => i.id)).toEqual(['inv-mine'])
  })

  it('lets the creator revoke their own storeless target, but still clamps somebody else’s', async () => {
    expect(await reinviteTargetStaffIdWithClient(api as never, 'inv-mine', 'mgr-1')).toBeNull()
    expect(await reinviteTargetStaffIdWithClient(api as never, 'inv-theirs', 'mgr-1')).toBe('card-b')
  })

  const noExemption = [
    ['placed outside the creator’s stores', { get: async () => ({ store_ids: ['store-daikanyama'] }) }],
    ['assignment read throws', { get: async () => { throw new Error('core down') } }],
    ['no staffStores port', undefined],
    ...[undefined, null, {}, { store_ids: null }, { store_ids: '' }, { store_ids: { length: 0 } }]
      .map((answer) => [`malformed assignment ${JSON.stringify(answer)}`, { get: async () => answer }] as const),
  ] as const

  it.each(noExemption)('list uses the normal lens when %s', async (_label, staffStores) => {
    const lens = jest.fn(async () => false)
    const c = { ...api, staffStores }
    expect(await listInvitesWithClient(c as never, undefined, lens, 'mgr-1')).toEqual([])
    expect(lens).toHaveBeenCalledTimes(2)
    expect(lens.mock.calls).toEqual(expect.arrayContaining([['card-a'], ['card-b']]))
    lens.mockResolvedValue(true)
    expect((await listInvitesWithClient(c as never, undefined, lens, 'mgr-1')).map((i) => i.id))
      .toEqual(['inv-mine', 'inv-theirs'])
  })

  it.each(noExemption)('revoke returns the clamp target when %s', async (_label, staffStores) => {
    expect(await reinviteTargetStaffIdWithClient({ ...api, staffStores } as never, 'inv-mine', 'mgr-1'))
      .toBe('card-a')
  })

  it('reads only the self-created target and never the creator’s or another invite’s assignments', async () => {
    const get = jest.fn(async (id: string) => ({ store_ids: id === 'card-a' ? [] : ['store-ginza'] }))
    const lens = jest.fn(async () => false)
    const c = { ...api, staffStores: { get } }
    expect((await listInvitesWithClient(c as never, undefined, lens, 'mgr-1')).map((i) => i.id))
      .toEqual(['inv-mine'])
    expect(get.mock.calls).toEqual([['card-a']])
    expect(lens.mock.calls).toEqual([['card-b']])
    get.mockClear()
    expect(await reinviteTargetStaffIdWithClient(c as never, 'inv-mine', 'mgr-1')).toBeNull()
    expect(await reinviteTargetStaffIdWithClient(c as never, 'inv-theirs', 'mgr-1')).toBe('card-b')
    expect(get.mock.calls).toEqual([['card-a']])
  })

  it('keeps email-only rows unchanged without an assignment read or a clamp', async () => {
    const get = jest.fn()
    const lens = jest.fn(async () => false)
    const c = {
      invites: { list: async () => ({ invites: [{ ...rows[0], invited_staff_id: null }] }) },
      staffStores: { get },
    }
    expect((await listInvitesWithClient(c as never, undefined, lens, 'mgr-1')).map((i) => i.id))
      .toEqual(['inv-mine'])
    expect(await reinviteTargetStaffIdWithClient(c as never, 'inv-mine', 'mgr-1')).toBeNull()
    expect(get).not.toHaveBeenCalled()
    expect(lens).not.toHaveBeenCalled()
  })
})

describe('one pending fresh invite per email (F4)', () => {
  const INV_DEPS = { actorId: 'mgr-1', source: 'web' as const, requestId: 'req-1', creatorAllowedStoreIds: null }

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
