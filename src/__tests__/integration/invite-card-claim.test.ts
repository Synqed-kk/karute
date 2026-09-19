/**
 * ONE PENDING INVITE PER CARD, AND THE CARD READ ITSELF (⚖ G2 · G3).
 *
 * A fresh invite MINTS a staff card, so an invite now carries a card id. Two
 * live invites could therefore aim at the SAME card and each wire it to a
 * different login — last token opened wins, silently, taking that person's
 * permissions, recording attribution and history with it.
 *
 * Two layers, proved here:
 *   - creating an invite for a card CANCELS every other pending invite for it;
 *   - accepting a stale one never re-points a card that is already somebody's.
 *
 * Plus the read the guard stands on (G3): the card is fetched BY ID, so a
 * roster past one page can no longer hide it and mint a duplicate instead.
 */

import { acceptInvite } from '@/actions/invites'
import { createInviteCore } from '@/lib/invites/invites.core'

const CORE = { url: 'https://core.test', key: 'test-key' }

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (global as any).__fakeSynqedClient
    }
  },
  SynqedError: class extends Error {},
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@/lib/audit-web', () => ({
  auditWeb: jest.fn(async () => {}),
  resolveWebActorId: jest.fn(async () => null),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: null, businessId: null })),
}))
jest.mock('@/lib/business-name', () => ({ businessDisplayName: async () => 'Main store' }))
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signInWithPassword: async () => ({ error: null }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    chain.eq = () => chain
    chain.ilike = () => chain
    chain.maybeSingle = async () => ({ data: null })
    return {
      auth: {
        admin: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createUser: async () => ({ data: { user: { id: (global as any).__newUserId } }, error: null }),
          deleteUser: async () => ({}),
        },
      },
      from: () => ({ select: () => chain, update: () => ({ eq: async () => ({ error: null }) }) }),
    }
  },
}))

import { audit } from '@/lib/audit'
import { auditWeb } from '@/lib/audit-web'

const INV_DEPS = { actorId: 'mgr-1', source: 'web' as const, requestId: 'req-1', creatorAllowedStoreIds: null }

interface InviteFixture {
  id: string
  email: string
  role?: string
  status: string
  invited_staff_id: string | null
  created_at: string
  business_id?: string
  token?: string
  expires_at?: string | null
  invited_by?: string | null
}
interface CardFixture {
  id: string
  email: string | null
  user_id: string | null
}

/** One fake core: the invite rows and the staff roster both live here, so a
 *  write on one side is visible to the read on the other. */
function core(opts: { invites?: InviteFixture[]; cards?: CardFixture[] } = {}) {
  const invites = opts.invites ?? []
  const cards = opts.cards ?? []
  const updateStatus = jest.fn(async (id: string, status: string) => {
    const row = invites.find((i) => i.id === id)
    if (row) row.status = status
    return {}
  })
  const staffUpdate = jest.fn(async (id: string, patch: { user_id?: string | null }) => {
    const c = cards.find((s) => s.id === id)
    if (c && patch.user_id !== undefined) c.user_id = patch.user_id
    return {}
  })
  const staffCreate = jest.fn(async () => ({ id: 'staff-minted' }))
  const staffGet = jest.fn(async (id: string) => {
    const c = cards.find((s) => s.id === id)
    if (!c) throw new Error('no such staff')
    return c
  })
  const invitesCreate = jest.fn(async (input: { invited_staff_id?: string | null }) => {
    const row: InviteFixture = {
      id: `inv-new`,
      email: 'x@test.com',
      status: 'pending',
      invited_staff_id: input.invited_staff_id ?? null,
      created_at: '2026-09-19T10:00:00Z',
    }
    invites.push(row)
    return row
  })
  const api = {
    invites: {
      list: async () => ({ invites }),
      create: invitesCreate,
      updateStatus,
      getByToken: async (token: string) =>
        invites.find((i) => i.token === token) ?? null,
    },
    staff: {
      // Honours page/page_size like core does, so a roster past one page is a
      // real read here (⚖ G3 / ANY-ROSTER-SIZE).
      list: async (o?: { page?: number; page_size?: number }) => {
        const size = o?.page_size ?? cards.length
        const page = o?.page ?? 1
        return { staff: cards.slice((page - 1) * size, page * size), total: cards.length }
      },
      get: staffGet,
      create: staffCreate,
      update: staffUpdate,
      delete: jest.fn(async () => ({})),
    },
    staffStores: {
      get: async () => ({ store_ids: [] as string[] }),
      set: jest.fn(async () => ({})),
    },
    stores: { list: async () => ({ stores: [{ id: 'store-ginza' }] }) },
  }
  return { api, invites, cards, updateStatus, staffUpdate, staffCreate, staffGet, invitesCreate }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SYNQED_CORE_URL = CORE.url
  process.env.SYNQED_CORE_API_KEY = CORE.key
})

/** acceptInvite builds its OWN SynqedClient from env — hand it this core. */
function install(api: unknown, newUserId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(global as any).__fakeSynqedClient = api
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(global as any).__newUserId = newUserId
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) creating an invite for a card cancels every OTHER pending invite for it
// ─────────────────────────────────────────────────────────────────────────────
describe('one pending invite per card — the create side (G2a)', () => {
  it('a re-invite of the card CANCELS the stale fresh invite that minted it', async () => {
    const c = core({
      invites: [
        {
          id: 'inv-A',
          email: 'aoi@test.com',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-01T09:00:00Z',
        },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: null }],
    })
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, 'mgr-1', {
      email: 'aoi-new@test.com',
      role: 'STYLIST',
      staffId: 'card-aoi',
    })
    expect(res).toEqual({ token: expect.any(String) })
    // row state
    expect(c.updateStatus).toHaveBeenCalledWith('inv-A', 'revoked')
    expect(c.invites.find((i) => i.id === 'inv-A')?.status).toBe('revoked')
    // …and the NEW invite is untouched
    expect(c.invites.find((i) => i.id === 'inv-new')?.status).toBe('pending')
    // audit — the same row a manual cancel writes, no new action
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.invite_revoke',
        targetId: 'card-aoi',
        detail: expect.objectContaining({
          invite_id: 'inv-A',
          reason: 'superseded_by_new_invite',
        }),
      }),
    )
  })

  // ⚖ I3 — the self-exclusion is `row.id === created.id`; with no id back from
  // core it can never fire, and the loop would cancel the invite it just wrote.
  it('no invite id back from core → the supersede is SKIPPED entirely (I3)', async () => {
    const c = core({
      invites: [
        {
          id: 'inv-A',
          email: 'aoi@test.com',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-01T09:00:00Z',
        },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: null }],
    })
    // Core answers without an id (the shape F3 is about). The cast is the
    // point: the fixture type promises an id, and core did not send one.
    c.invitesCreate.mockImplementation((async () => ({})) as unknown as typeof c.invitesCreate)
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, 'mgr-1', {
      email: 'aoi-new@test.com',
      role: 'STYLIST',
      staffId: 'card-aoi',
    })
    expect(res).toEqual({ token: expect.any(String) })
    expect(c.updateStatus).not.toHaveBeenCalled()
    expect(c.invites.find((i) => i.id === 'inv-A')?.status).toBe('pending')
  })

  it('leaves another CARD’s pending invite alone', async () => {
    const c = core({
      invites: [
        {
          id: 'inv-other',
          email: 'b@test.com',
          status: 'pending',
          invited_staff_id: 'card-b',
          created_at: '2026-09-01T09:00:00Z',
        },
      ],
      cards: [
        { id: 'card-aoi', email: 'aoi@test.com', user_id: null },
        { id: 'card-b', email: 'b@test.com', user_id: null },
      ],
    })
    await createInviteCore(c.api as never, 'business-1', INV_DEPS, 'mgr-1', {
      email: 'aoi@test.com',
      role: 'STYLIST',
      staffId: 'card-aoi',
    })
    expect(c.updateStatus).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (b) a stale invite never re-points a card that is already somebody's
// ─────────────────────────────────────────────────────────────────────────────
describe('a stale invite never takes a wired card — the accept side (G2b)', () => {
  it('the card keeps the NEWER invite’s user; nothing is overwritten, nothing minted', async () => {
    // B (newer) was accepted first and wired card-aoi to user-b. A (older) is
    // still pending — the create-side cancel never ran (core blip). Opening
    // A's link must leave the card with user-b.
    const c = core({
      invites: [
        {
          id: 'inv-A',
          token: 'token-A',
          email: 'aoi@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-01T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
        {
          id: 'inv-B',
          token: 'token-B',
          email: 'aoi-new@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-10T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-b' }],
    })
    install(c.api, 'user-a')

    await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(c.cards[0].user_id).toBe('user-b')
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(c.staffCreate).not.toHaveBeenCalled()
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.link_failed',
        severity: 'warning',
        targetId: 'card-aoi',
        detail: expect.objectContaining({ reason: 'card_wired_by_another_invite' }),
      }),
    )
  })

  // ⚖ H1 — AND THE NEWER ONE HAS USUALLY BEEN ACCEPTED BY THEN. acceptInvite
  // marks an invite 'accepted' at the very END, after the link step, so the
  // guard's first shape (pending rows only) stopped seeing B the moment B went
  // through — stale A then called itself the newest and took the card back.
  it('B ACCEPTED and no longer pending still outranks the stale pending A (H1)', async () => {
    const c = core({
      invites: [
        {
          id: 'inv-A',
          token: 'token-A',
          email: 'aoi@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-01T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
        {
          id: 'inv-B',
          token: 'token-B',
          email: 'aoi-new@test.com',
          role: 'STYLIST',
          status: 'accepted', // B has already been through
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-10T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-b' }],
    })
    install(c.api, 'user-a')

    await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(c.cards[0].user_id).toBe('user-b')
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(c.staffCreate).not.toHaveBeenCalled()
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.link_failed',
        severity: 'warning',
        targetId: 'card-aoi',
        detail: expect.objectContaining({ reason: 'card_wired_by_another_invite' }),
      }),
    )
  })

  it('the NEWEST re-invite of an already-linked person still re-links their card', async () => {
    // The shipped intent: a new email / a lost login. Only one pending invite
    // points at the card, and it is this one.
    const c = core({
      invites: [
        {
          id: 'inv-B',
          token: 'token-B',
          email: 'aoi-new@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-10T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-old' }],
    })
    install(c.api, 'user-new')

    await acceptInvite('token-B', 'password123', '葵', 'ja')

    expect(c.staffUpdate).toHaveBeenCalledWith(
      'card-aoi',
      expect.objectContaining({ user_id: 'user-new' }),
    )
    expect(c.cards[0].user_id).toBe('user-new')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G3 — accept reads the CARD, not the first page of the roster
// ─────────────────────────────────────────────────────────────────────────────
// ── PIN T2 — a REVOKED newer invite is not competition. Only a revoked row
// stops counting; if revoked rows counted, cancelling B would permanently lock
// A out of the card A itself is for.
describe('a REVOKED newer invite does not block the older one (T2)', () => {
  it('A still re-links the card although a NEWER B exists, revoked', async () => {
    const c = core({
      invites: [
        {
          id: 'inv-A',
          token: 'token-A',
          email: 'aoi@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-01T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
        {
          id: 'inv-B',
          token: 'token-B',
          email: 'aoi-new@test.com',
          role: 'STYLIST',
          status: 'revoked', // cancelled by hand
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-10T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-old' }],
    })
    install(c.api, 'user-a')

    await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(c.staffUpdate).toHaveBeenCalledWith(
      'card-aoi',
      expect.objectContaining({ user_id: 'user-a' }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// I5 — one spelling of "newer": instants, not strings
// ─────────────────────────────────────────────────────────────────────────────
describe('“newer” is an instant, not a string (I5)', () => {
  it.each([
    ['unparseable', 'not-a-date', '2026-09-19T10:00:00Z'],
    ['exact tie', '2026-09-19T10:00:00Z', '2026-09-19T10:00:00Z'],
  ])('%s never outranks a parseable live invite (U-V11 / U-V12)', async (_case, mineAt, otherAt) => {
    const c = core({
      invites: [
        { id: 'inv-A', token: 'token-A', email: 'aoi@test.com', role: 'STYLIST',
          status: 'pending', invited_staff_id: 'card-aoi', created_at: mineAt,
          business_id: 'business-1', expires_at: null },
        { id: 'inv-B', token: 'token-B', email: 'aoi-new@test.com', role: 'STYLIST',
          status: 'accepted', invited_staff_id: 'card-aoi', created_at: otherAt,
          business_id: 'business-1', expires_at: null },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-b' }],
    })
    install(c.api, 'user-a')

    await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(c.cards[0].user_id).toBe('user-b')
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(c.staffCreate).not.toHaveBeenCalled()
    expect(auditWeb).toHaveBeenCalledWith(expect.objectContaining({
      action: 'staff.link_failed',
      targetId: 'card-aoi',
      detail: expect.objectContaining({ reason: 'card_wired_by_another_invite' }),
    }))
  })

  it('a +09:00 stamp does not outrank a LATER Z stamp', async () => {
    // A renders 09:00Z as 18:00+09:00; B is 10:00Z, a real hour LATER. String
    // compare puts '…T18…' above '…T10…' and would call the stale A newest,
    // handing it the card B is already wired to.
    const c = core({
      invites: [
        {
          id: 'inv-A',
          token: 'token-A',
          email: 'aoi@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-19T18:00:00+09:00', // = 09:00Z
          business_id: 'business-1',
          expires_at: null,
        },
        {
          id: 'inv-B',
          token: 'token-B',
          email: 'aoi-new@test.com',
          role: 'STYLIST',
          status: 'accepted',
          invited_staff_id: 'card-aoi',
          created_at: '2026-09-19T10:00:00Z', // one hour later
          business_id: 'business-1',
          expires_at: null,
        },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-b' }],
    })
    install(c.api, 'user-a')

    await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(c.cards[0].user_id).toBe('user-b')
    expect(c.staffUpdate).not.toHaveBeenCalled()
  })
})

describe('accept finds the invited card at any roster size (G3)', () => {
  function bigRoster(target: CardFixture) {
    const filler = Array.from({ length: 249 }, (_, i) => ({
      id: `staff-${i}`,
      email: `s${i}@test.com`,
      user_id: `u-${i}`,
    }))
    return [...filler, target] // the target sits at row 250
  }

  it('links a pre-made card at row 250 — no duplicate is created', async () => {
    const c = core({
      invites: [
        {
          id: 'inv-late',
          token: 'token-late',
          email: 'late@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: 'card-late',
          created_at: '2026-09-10T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
      ],
      cards: bigRoster({ id: 'card-late', email: 'late@test.com', user_id: null }),
    })
    install(c.api, 'user-late')

    await acceptInvite('token-late', 'password123', '遅井', 'ja')

    expect(c.staffUpdate).toHaveBeenCalledWith(
      'card-late',
      expect.objectContaining({ user_id: 'user-late' }),
    )
    expect(c.staffCreate).not.toHaveBeenCalled()
  })

  it('the EMAIL fallback pages the whole roster too — a legacy invite still links', async () => {
    const c = core({
      invites: [
        {
          id: 'inv-legacy',
          token: 'token-legacy',
          email: 'late@test.com',
          role: 'STYLIST',
          status: 'pending',
          invited_staff_id: null,
          created_at: '2026-09-10T09:00:00Z',
          business_id: 'business-1',
          expires_at: null,
        },
      ],
      cards: bigRoster({ id: 'card-late', email: 'late@test.com', user_id: null }),
    })
    install(c.api, 'user-late')

    await acceptInvite('token-legacy', 'password123', '遅井', 'ja')

    expect(c.staffUpdate).toHaveBeenCalledWith(
      'card-late',
      expect.objectContaining({ user_id: 'user-late' }),
    )
    expect(c.staffCreate).not.toHaveBeenCalled()
  })
})
