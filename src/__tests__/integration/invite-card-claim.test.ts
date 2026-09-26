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
import { ROLE_PRESETS } from '@/lib/auth/permissions'

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
// Spies on the two account writes, so "refused BEFORE the account exists"
// (⚖ Greptile #978 R1 F1) is a real assertion, not an inference.
const mockCreateUser = jest.fn(async () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: { user: { id: (global as any).__newUserId } },
  error: null,
}))
const mockProfileEq = jest.fn<Promise<object>, [string, string]>(async () => ({ error: null }))
const mockProfileUpdate = jest.fn<{ eq: (col: string, val: string) => Promise<object> }, [Record<string, unknown>?]>(() => ({
  eq: (col: string, val: string) => mockProfileEq(col, val),
}))
// Spy on the rollback (⚖ Greptile #978 R2): a join whose card was claimed
// concurrently deletes the auth user it just created.
const mockDeleteUser = jest.fn<Promise<object>, [string]>(async () => ({}))
// The R3 ban barrier (a failed rollback bans the stranded account).
const mockUpdateUserById = jest.fn<Promise<object>, [string, Record<string, unknown>]>(async () => ({}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    chain.eq = () => chain
    chain.ilike = () => chain
    chain.maybeSingle = async () => ({ data: null })
    return {
      auth: {
        admin: {
          createUser: () => mockCreateUser(),
          deleteUser: (id: string) => mockDeleteUser(id),
          updateUserById: (id: string, attrs: Record<string, unknown>) => mockUpdateUserById(id, attrs),
        },
      },
      from: () => ({ select: () => chain, update: (patch: Record<string, unknown>) => mockProfileUpdate(patch) }),
    }
  },
}))

import { audit } from '@/lib/audit'
import { auditWeb } from '@/lib/audit-web'

// The inviter holds the full owner preset — the role cap is pinned in invite-role-cap.test.ts.
const INV_DEPS = { actorId: 'mgr-1', source: 'web' as const, requestId: 'req-1', creatorAllowedStoreIds: null, callerCapabilities: new Set(ROLE_PRESETS.owner) }

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
  const invitesList = jest.fn(async () => ({ invites }))
  const api = {
    audit: { list: jest.fn() },
    invites: {
      list: invitesList,
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
  return { api, invites, cards, updateStatus, staffUpdate, staffCreate, staffGet, invitesCreate, invitesList }
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

  // ⚖ Greptile #978 R1 F5 — THE NEWER INVITE WINS. Two concurrent re-invites
  // for one card used to revoke EACH OTHER. Only a strictly OLDER pending row
  // is cancelled; a newer one and an exact tie are left alone.
  it('revokes only the STRICTLY OLDER pending row — never a newer one, never a tie (F5)', async () => {
    const at = (id: string, created_at: string): InviteFixture => ({
      id, email: `${id}@test.com`, status: 'pending', invited_staff_id: 'card-aoi', created_at,
    })
    const c = core({
      invites: [
        at('inv-older-A', '2026-09-19T09:00:00Z'),
        at('inv-newer-B', '2026-09-19T11:00:00Z'),
        at('inv-tie-T', '2026-09-19T10:00:00Z'), // same instant as inv-new
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: null }],
    })
    const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, 'mgr-1', {
      email: 'aoi-new@test.com',
      role: 'STYLIST',
      staffId: 'card-aoi',
    })
    expect(res).toEqual({ token: expect.any(String) })
    expect(c.updateStatus.mock.calls).toEqual([['inv-older-A', 'revoked']])
    expect(c.invites.find((i) => i.id === 'inv-newer-B')?.status).toBe('pending')
    expect(c.invites.find((i) => i.id === 'inv-tie-T')?.status).toBe('pending')
    expect(c.invites.find((i) => i.id === 'inv-new')?.status).toBe('pending')
  })

  it('an UNPARSEABLE created_at on the new invite skips the supersede, loudly (F5)', async () => {
    const c = core({
      invites: [
        { id: 'inv-A', email: 'aoi@test.com', status: 'pending',
          invited_staff_id: 'card-aoi', created_at: '2026-09-01T09:00:00Z' },
      ],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: null }],
    })
    c.invitesCreate.mockImplementation((async () =>
      ({ id: 'inv-new', created_at: 'not-a-date' })) as unknown as typeof c.invitesCreate)
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await createInviteCore(c.api as never, 'business-1', INV_DEPS, 'mgr-1', {
        email: 'aoi-new@test.com',
        role: 'STYLIST',
        staffId: 'card-aoi',
      })
      expect(res).toEqual({ token: expect.any(String) })
      expect(c.updateStatus).not.toHaveBeenCalled()
      expect(c.invites.find((i) => i.id === 'inv-A')?.status).toBe('pending')
      expect(err).toHaveBeenCalledWith(expect.stringContaining('skipping the supersede'))
    } finally {
      err.mockRestore()
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// ⚖ Greptile #978 R1 F1 + F2 — a stale or unverifiable invite is REFUSED BEFORE
// the account exists. Refusing after step 3 left a signed-in member with NO
// card — a floating, unclamped profile — and an unreadable invite list used to
// answer "yes, newest" and let the stale token overwrite a wired card.
// ─────────────────────────────────────────────────────────────────────────────
describe('a stale or unverifiable invite is refused BEFORE the account (F1 / F2)', () => {
  const pendingA = {
    id: 'inv-A', token: 'token-A', email: 'aoi@test.com', role: 'STYLIST', status: 'pending',
    invited_staff_id: 'card-aoi', created_at: '2026-09-01T09:00:00Z',
    business_id: 'business-1', expires_at: null, invited_by: 'owner-user-1',
  }
  const newerB = {
    id: 'inv-B', token: 'token-B', email: 'aoi-new@test.com', role: 'STYLIST', status: 'accepted',
    invited_staff_id: 'card-aoi', created_at: '2026-09-10T09:00:00Z',
    business_id: 'business-1', expires_at: null,
  }

  it('STALE accept → the "replaced" error, no account, no profile, invite still pending, one warning row (F1)', async () => {
    const c = core({
      invites: [{ ...pendingA }, { ...newerB }],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-b' }],
    })
    install(c.api, 'user-a')

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toEqual({
      error: 'This invite link has been replaced by a newer invite. Ask the owner for the latest link.',
    })
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockProfileUpdate).not.toHaveBeenCalled()
    expect(c.updateStatus).not.toHaveBeenCalled()
    expect(c.invites.find((i) => i.id === 'inv-A')?.status).toBe('pending')
    expect(c.cards[0].user_id).toBe('user-b')
    const rows = (auditWeb as jest.Mock).mock.calls.map(([row]) => row)
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'staff.link_failed',
        severity: 'warning',
        actorId: 'owner-user-1', // the inviter — no joiner account exists
        targetType: 'staff',
        targetId: 'card-aoi',
        detail: { via: 'invite', invite_id: 'inv-A', role: 'STYLIST', reason: 'card_wired_by_another_invite' },
      }),
    ])
  })

  // F2 — the reversal: an UNREADABLE invite list no longer lets a stale token
  // through onto a WIRED card. (No earlier test pinned the old "yes" — this is
  // its first pin, written reversed.)
  it('UNREADABLE invite list + wired card → "try again", no account, one notice row (F2)', async () => {
    const c = core({
      invites: [{ ...pendingA }],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-b' }],
    })
    c.invitesList.mockRejectedValue(new Error('core down'))
    install(c.api, 'user-a')

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toEqual({ error: 'Could not verify this invite right now. Please try again in a moment.' })
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockProfileUpdate).not.toHaveBeenCalled()
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(c.cards[0].user_id).toBe('user-b')
    expect(c.invites[0].status).toBe('pending')
    const rows = (auditWeb as jest.Mock).mock.calls.map(([row]) => row)
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'staff.link_failed',
        severity: 'notice',
        actorId: 'owner-user-1',
        targetId: 'card-aoi',
        detail: expect.objectContaining({ reason: 'invite_list_unreadable', invite_id: 'inv-A' }),
      }),
    ])
  })

  it('wired card + THIS invite is the newest → the account is created and the card re-linked (F1)', async () => {
    const c = core({
      invites: [{ ...pendingA, created_at: '2026-09-20T09:00:00Z' }, { ...newerB }],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-old' }],
    })
    install(c.api, 'user-a')

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toBeUndefined()
    expect(mockCreateUser).toHaveBeenCalledTimes(1)
    expect(c.staffUpdate).toHaveBeenCalledWith('card-aoi', expect.objectContaining({ user_id: 'user-a' }))
    expect(c.cards[0].user_id).toBe('user-a')
  })

  it('an UNWIRED card never reads the invite list at all — and links (F1)', async () => {
    const c = core({
      invites: [{ ...pendingA }],
      cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: null }],
    })
    install(c.api, 'user-a')

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toBeUndefined()
    expect(c.invitesList).not.toHaveBeenCalled()
    expect(mockCreateUser).toHaveBeenCalledTimes(1)
    expect(c.staffUpdate).toHaveBeenCalledWith('card-aoi', expect.objectContaining({ user_id: 'user-a' }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ⚖ Greptile #978 R2 — the card is RE-READ at the write boundary. Two accepts
// aimed at the same UNWIRED card both pass step 1b and both create accounts;
// without the re-read the last write wins and one fresh account floats with
// no card. The claim test is "owner CHANGED since 1b and is not this account"
// — a card wired to an older login is the deliberate re-invite and still links.
// ─────────────────────────────────────────────────────────────────────────────
describe('the card is re-checked right before the link is written (R2)', () => {
  const pendingA = {
    id: 'inv-A', token: 'token-A', email: 'aoi@test.com', role: 'STYLIST', status: 'pending',
    invited_staff_id: 'card-aoi', created_at: '2026-09-01T09:00:00Z',
    business_id: 'business-1', expires_at: null, invited_by: 'owner-user-1',
  }
  const REPLACED = 'This invite link has been replaced by a newer invite. Ask the owner for the latest link.'

  /** 1b reads `first`, the write boundary reads `second` (a value, a throw, or null). */
  function raced(second: CardFixture | Error | null, first: CardFixture = { id: 'card-aoi', email: 'aoi@test.com', user_id: null }) {
    const c = core({ invites: [{ ...pendingA }], cards: [{ ...first }] })
    c.staffGet
      .mockImplementationOnce(async () => ({ ...first }))
      .mockImplementationOnce(async () => {
        if (second instanceof Error) throw second
        return second as CardFixture
      })
    install(c.api, 'user-a')
    return c
  }

  it('a card claimed by someone else between the pre-check and the write → this join is rolled back, invite stays pending', async () => {
    const c = raced({ id: 'card-aoi', email: 'aoi@test.com', user_id: 'someone-else' })

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toEqual({ error: REPLACED })
    expect(mockCreateUser).toHaveBeenCalledTimes(1)
    expect(mockDeleteUser).toHaveBeenCalledWith('user-a')
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(c.updateStatus).not.toHaveBeenCalled()
    expect(c.invites[0].status).toBe('pending')
    const rows = (auditWeb as jest.Mock).mock.calls.map(([row]) => row)
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'staff.link_failed',
        severity: 'warning',
        actorId: 'owner-user-1',
        targetType: 'staff',
        targetId: 'card-aoi',
        detail: { via: 'invite', invite_id: 'inv-A', role: 'STYLIST', reason: 'card_claimed_concurrently' },
        requestId: expect.any(String),
      }),
    ])
  })

  it.each([
    ['throws', new Error('core down')],
    ['answers nothing', null],
  ])('a write-boundary read that %s never writes blindly — the join continues, link_failed, no rollback', async (_label, second) => {
    const c = raced(second)

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toBeUndefined()
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(mockDeleteUser).not.toHaveBeenCalled()
    expect(c.updateStatus).toHaveBeenCalledWith('inv-A', 'accepted')
    const rows = (auditWeb as jest.Mock).mock.calls.map(([row]) => row)
    expect(rows).toContainEqual(
      expect.objectContaining({
        action: 'staff.link_failed',
        severity: 'warning',
        actorId: 'user-a',
        targetId: 'user-a',
        detail: { via: 'invite', invite_id: 'inv-A', role: 'STYLIST' },
      }),
    )
  })

  it('a card still unwired at the write boundary links and the invite is marked accepted (the ordinary path)', async () => {
    const c = raced({ id: 'card-aoi', email: 'aoi@test.com', user_id: null })

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toBeUndefined()
    expect(c.staffGet).toHaveBeenCalledTimes(2)
    expect(c.staffUpdate).toHaveBeenCalledWith('card-aoi', expect.objectContaining({ user_id: 'user-a' }))
    expect(c.updateStatus).toHaveBeenCalledWith('inv-A', 'accepted')
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it('the deliberate re-invite (card wired to an OLDER login, owner unchanged since 1b) passes the write-boundary check and re-links', async () => {
    const old = { id: 'card-aoi', email: 'aoi@test.com', user_id: 'user-old' }
    const c = raced({ ...old }, { ...old })

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toBeUndefined()
    expect(c.staffGet).toHaveBeenCalledTimes(2)
    expect(mockDeleteUser).not.toHaveBeenCalled()
    expect(c.staffUpdate).toHaveBeenCalledWith('card-aoi', expect.objectContaining({ user_id: 'user-a' }))
    expect(c.updateStatus).toHaveBeenCalledWith('inv-A', 'accepted')
  })
})

describe('rollback failure is a recovery state, not a clean undo (R3)', () => {
  const pendingA = {
    id: 'inv-A', token: 'token-A', email: 'aoi@test.com', role: 'STYLIST', status: 'pending',
    invited_staff_id: 'card-aoi', created_at: '2026-09-01T09:00:00Z',
    business_id: 'business-1', expires_at: null, invited_by: 'owner-user-1',
  }
  const REPLACED = 'This invite link has been replaced by a newer invite. Ask the owner for the latest link.'
  const COULD_NOT = 'Could not complete this invite. Ask the owner to send a new invite.'
  const STRANDED_NAME = { full_name: '_system_rollback_failed' }

  /** The card is unwired at 1b and claimed by someone else at the write boundary. */
  function claimed() {
    const first = { id: 'card-aoi', email: 'aoi@test.com', user_id: null }
    const c = core({ invites: [{ ...pendingA }], cards: [{ ...first }] })
    c.staffGet
      .mockImplementationOnce(async () => ({ ...first }))
      .mockImplementationOnce(async () => ({ ...first, user_id: 'someone-else' }))
    install(c.api, 'user-a')
    return c
  }
  const rows = () => (auditWeb as jest.Mock).mock.calls.map(([row]) => row)
  const neutralised = () => mockProfileUpdate.mock.calls.filter(([patch]) => patch?.full_name === '_system_rollback_failed')

  it('delete fails once, succeeds on retry → the normal claimed path (no ban, no profile mark, no rollback_failed)', async () => {
    claimed()
    mockDeleteUser.mockRejectedValueOnce(new Error('auth blip'))

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toEqual({ error: REPLACED })
    expect(mockDeleteUser).toHaveBeenCalledTimes(2)
    expect(mockUpdateUserById).not.toHaveBeenCalled()
    expect(neutralised()).toHaveLength(0)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].detail).toEqual({ via: 'invite', invite_id: 'inv-A', role: 'STYLIST', reason: 'card_claimed_concurrently' })
  })

  it('a delete that answers { error } (not a throw) counts as a failure and is retried', async () => {
    claimed()
    mockDeleteUser.mockResolvedValueOnce({ error: { message: 'auth down' } })

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toEqual({ error: REPLACED })
    expect(mockDeleteUser).toHaveBeenCalledTimes(2)
    expect(mockUpdateUserById).not.toHaveBeenCalled()
  })

  it('delete fails twice → banned + profile marked + honest row + "could not complete"; invite NOT accepted, card NOT written', async () => {
    const c = claimed()
    mockDeleteUser.mockRejectedValueOnce(new Error('auth down')).mockResolvedValueOnce({ error: { message: 'auth down' } })

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')

    expect(res).toEqual({ error: COULD_NOT })
    expect(mockDeleteUser).toHaveBeenCalledTimes(2)
    expect(mockUpdateUserById).toHaveBeenCalledWith('user-a', { ban_duration: '876000h' })
    expect(mockProfileUpdate).toHaveBeenLastCalledWith(STRANDED_NAME)
    expect(mockProfileEq).toHaveBeenLastCalledWith('id', 'user-a')
    expect(c.updateStatus).not.toHaveBeenCalled()
    expect(c.invites[0].status).toBe('pending')
    expect(c.staffUpdate).not.toHaveBeenCalled()
    expect(rows()).toEqual([
      expect.objectContaining({
        action: 'staff.link_failed',
        severity: 'warning',
        actorId: 'owner-user-1',
        targetId: 'card-aoi',
        detail: {
          via: 'invite', invite_id: 'inv-A', role: 'STYLIST', reason: 'card_claimed_concurrently',
          rollback_failed: true, stranded_user_id: 'user-a', banned: true, profile_neutralised: true,
        },
      }),
    ])
    expect(JSON.stringify(rows()[0].detail)).not.toContain('aoi@test.com')
  })

  it('delete fails twice AND the ban throws → the profile mark is still attempted; banned: false', async () => {
    claimed()
    mockDeleteUser.mockRejectedValue(new Error('auth down'))
    mockUpdateUserById.mockRejectedValueOnce(new Error('ban failed'))

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')
    mockDeleteUser.mockReset().mockImplementation(async () => ({}))

    expect(res).toEqual({ error: COULD_NOT })
    expect(neutralised()).toHaveLength(1)
    expect(rows()[0].detail).toMatchObject({ rollback_failed: true, banned: false, profile_neutralised: true })
  })

  it('delete fails twice AND both barriers fail → both flags false, still "could not complete" (never "replaced")', async () => {
    claimed()
    mockDeleteUser.mockRejectedValue(new Error('auth down'))
    mockUpdateUserById.mockResolvedValueOnce({ error: { message: 'ban failed' } })
    mockProfileEq.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'db down' } }) // 1st = step-3 attach

    const res = await acceptInvite('token-A', 'password123', '葵', 'ja')
    mockDeleteUser.mockReset().mockImplementation(async () => ({}))

    expect(res).toEqual({ error: COULD_NOT })
    expect(res).not.toEqual({ error: REPLACED })
    expect(rows()[0].detail).toMatchObject({ rollback_failed: true, stranded_user_id: 'user-a', banned: false, profile_neutralised: false })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The third name writer: the invitee types their own name at /join. A
// system-row name would hide an active staffer from the roster (the
// `ILIKE '_system_%'` filter), so it is refused like an empty one — before any
// account or profile write.
// ─────────────────────────────────────────────────────────────────────────────
describe('accept refuses a reserved (system-row) name', () => {
  const invite = {
    id: 'inv-A', token: 'token-A', email: 'aoi@test.com', role: 'STYLIST', status: 'pending',
    invited_staff_id: 'card-aoi', created_at: '2026-09-01T09:00:00Z',
    business_id: 'business-1', expires_at: null,
  }

  it.each(['_system_x', '_SYSTEM_x', '  _system_x', '1system2alice', 'xSYSTEMy'])('%j → the name-required error, no account, no profile write', async (name) => {
    const c = core({ invites: [{ ...invite }], cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: null }] })
    install(c.api, 'user-a')

    expect(await acceptInvite('token-A', 'password123', name, 'ja')).toEqual({ error: 'Your name is required.' })
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockProfileUpdate).not.toHaveBeenCalled()
    expect(c.staffUpdate).not.toHaveBeenCalled()
  })

  it('an ordinary name is still accepted and written', async () => {
    const c = core({ invites: [{ ...invite }], cards: [{ id: 'card-aoi', email: 'aoi@test.com', user_id: null }] })
    install(c.api, 'user-a')

    expect(await acceptInvite('token-A', 'password123', '葵', 'ja')).toBeUndefined()
    expect(mockProfileUpdate).toHaveBeenCalledWith(expect.objectContaining({ full_name: '葵' }))
  })
})
