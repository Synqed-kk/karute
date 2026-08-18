/**
 * The staff-ADJACENT write actions are WIRED to the actor store-scope clamp
 * (web transport): PIN, permissions, re-invite. Companion pins:
 *   - the RULE itself (viewAll / floating / degraded / self / overlap)
 *     → store-scope.test.ts, `staffWriteInScope`
 *   - the staff CRUD writes of the same clamp (#715)
 *     → staff-actions-store-scope.test.ts
 *   - voice, whose result shape is { ok } rather than { error }
 *     → authz-gap-voice.test.ts, "voice actions are clamped to the actor stores"
 *   - the FACADE transport of each → app-api-staff-pin.test.ts /
 *     app-api-staff-authority.test.ts / app-api-invites.test.ts
 *
 * What only this file can prove: each action consults the clamp with the right
 * (target, actor) pair, refuses BEFORE touching core/Supabase, and surfaces the
 * refusal itself — plus the two shapes that are NOT plain clamps: a PIN aimed
 * at SELF stays gate-free (no capability, no clamp), and a FRESH invite (no
 * staffId) is never clamped at all.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// Echo the i18n key so assertions read 'staffStoreScopeDenied' / 'noPermission'.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))

const can = jest.fn<Promise<boolean>, [string]>(async () => true)
jest.mock('@/lib/auth/require-permission', () => ({
  can: (c: string) => can(c),
  requireCapability: jest.fn(async () => {}),
  getMyCapabilities: jest.fn(async () => new Set(['staff.manage'])),
}))

// The clamp's own module — stubbed to a switch so this file pins the WIRING
// (call shape, ordering, message) and store-scope.test.ts pins the rule.
jest.mock('@/lib/auth/store-scope', () => ({
  staffWriteInScope: jest.fn(async () => true),
  // revokeInvite reads ONLY .viewAll off this, to decide whether the invite
  // lookup that feeds the clamp is worth paying for at all.
  resolveStoreScope: jest.fn(async () => ({ viewAll: false })),
}))

let selfStaffId: string | null = 'actor-1'
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'actor-1'),
  getCurrentUserStaffId: jest.fn(async () => selfStaffId),
}))

// Records every profiles query — a refused write must not reach Supabase
// either, not just synqed-core. (setStaffPermissionsCore reads the target row
// through this before it writes.)
let profileQueries = 0
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    profileQueries += 1
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: null })
    ;(builder as { update: unknown }).update = () => {
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: null })
      return chain
    }
    return { from: () => builder }
  },
}))

jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowed: jest.fn(async () => ({ allowed: true })),
}))

const setPin = jest.fn(async () => undefined)
const removePin = jest.fn(async () => undefined)
const invitesCreate = jest.fn(async () => ({ id: 'inv-new' }))
const invitesList = jest.fn(async () => ({ invites: [] as Record<string, unknown>[] }))
const invitesUpdateStatus = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    staff: { setPin, removePin },
    invites: { create: invitesCreate, list: invitesList, updateStatus: invitesUpdateStatus },
  })),
  newSynqedClient: jest.fn(() => ({})),
}))

import { setStaffPin, removeStaffPin } from '@/actions/staff-pin'
import { setStaffPermissions } from '@/actions/permissions'
import { createInvite, listInvites, revokeInvite } from '@/actions/invites'
import {
  resolveStoreScope as resolveStoreScopeImport,
  staffWriteInScope as staffWriteInScopeImport,
} from '@/lib/auth/store-scope'
import { auditLines } from './helpers/audit-lines'

const staffWriteInScope = staffWriteInScopeImport as jest.Mock
const resolveStoreScope = resolveStoreScopeImport as unknown as jest.Mock

// A UUID: inviteSchema validates staffId as one, and the same id rides every
// other seam so the shared pins below stay byte-identical across transports.
const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACTOR = 'actor-1'
const INVITE = { email: 'new@test.com', role: 'STYLIST' as const }

// Every clamped transport, so a clamp that lands on three of four is red.
// Third element = the SDK write this seam would make, or null when the seam
// writes through Supabase only (setStaffPermissions) — there `profileQueries`
// is the proof.
const writes: Array<[string, () => Promise<unknown>, jest.Mock | null]> = [
  ['setStaffPin', () => setStaffPin(TARGET, '1234'), setPin],
  ['removeStaffPin', () => removeStaffPin(TARGET), removePin],
  ['setStaffPermissions', () => setStaffPermissions(TARGET, 'practitioner', []), null],
  ['createInvite (re-invite)', () => createInvite({ ...INVITE, staffId: TARGET }), invitesCreate],
]

beforeEach(() => {
  jest.clearAllMocks()
  staffWriteInScope.mockResolvedValue(true)
  can.mockResolvedValue(true)
  selfStaffId = ACTOR
  profileQueries = 0
  invitesList.mockResolvedValue({ invites: [] })
  invitesUpdateStatus.mockResolvedValue({})
  resolveStoreScope.mockResolvedValue({ viewAll: false })
})

describe.each(writes)('%s — actor store-scope clamp', (name, run, coreWrite) => {
  it('out of scope → the store-scope refusal, core and Supabase untouched, no audit row', async () => {
    staffWriteInScope.mockResolvedValue(false)
    // A refused write must leave NOTHING behind — including the audit trail
    // (a refusal row would read as an attempted-and-logged act). Same
    // assertion the facade suites make through this helper.
    const lines = await auditLines(async () => {
      const res = (await run()) as { error?: string }
      // invites carries a MACHINE code (its module is in /join's import graph,
      // so it must not reach the settings namespace — see createInvite); the
      // rest carry the translated key directly.
      expect(res.error).toBe(
        name.startsWith('createInvite') ? 'STORE_SCOPE_DENIED' : 'staffStoreScopeDenied',
      )
    })
    if (coreWrite) expect(coreWrite).not.toHaveBeenCalled()
    expect(profileQueries).toBe(0)
    expect(lines).toHaveLength(0)
  })

  it('in scope → passes through to core unchanged', async () => {
    await run()
    if (coreWrite) expect(coreWrite).toHaveBeenCalled()
    else expect(profileQueries).toBeGreaterThan(0)
  })

  it('the clamp is asked about the TARGET, with the resolved actor', async () => {
    await run()
    expect(staffWriteInScope).toHaveBeenCalledWith({ targetStaffId: TARGET, actorId: ACTOR })
  })
})

describe('setStaffPin / removeStaffPin — the SELF path is untouched', () => {
  beforeEach(() => can.mockResolvedValue(false)) // a plain practitioner

  it('setStaffPin: self WITHOUT staff.manage still works, clamp never consulted', async () => {
    await expect(setStaffPin(ACTOR, '1234')).resolves.toEqual({})
    expect(setPin).toHaveBeenCalledWith(ACTOR, '1234', ACTOR)
    expect(staffWriteInScope).not.toHaveBeenCalled()
  })

  it('removeStaffPin: self WITHOUT staff.manage still works, clamp never consulted', async () => {
    await expect(removeStaffPin(ACTOR)).resolves.toEqual({})
    expect(removePin).toHaveBeenCalledWith(ACTOR, ACTOR)
    expect(staffWriteInScope).not.toHaveBeenCalled()
  })

  it.each([
    ['setStaffPin', () => setStaffPin(TARGET, '1234'), setPin],
    ['removeStaffPin', () => removeStaffPin(TARGET), removePin],
  ] as Array<[string, () => Promise<{ error?: string }>, jest.Mock]>)(
    '%s: a NON-self target without staff.manage → noPermission, core untouched',
    async (_n, run, coreWrite) => {
      await expect(run()).resolves.toEqual({ error: 'noPermission' })
      expect(coreWrite).not.toHaveBeenCalled()
      // The capability is judged first, so an out-of-store lookup is never paid.
      expect(staffWriteInScope).not.toHaveBeenCalled()
    },
  )

  it('an actor the roster cannot place is left to the cores own refusal (SDK untouched)', async () => {
    // Deliberate: nonSelfPinDenial skips a null acting id rather than restate a
    // refusal the core already makes — this pins that it still fails closed.
    selfStaffId = null
    await expect(setStaffPin(TARGET, '1234')).resolves.toEqual({
      error: 'Not authorized to set a PIN',
    })
    expect(setPin).not.toHaveBeenCalled()
  })
})

describe('createInvite — a FRESH invite is never clamped', () => {
  it('no staffId → the clamp is not consulted and the invite is created', async () => {
    staffWriteInScope.mockResolvedValue(false) // would refuse a re-invite
    const res = await createInvite(INVITE)
    expect(res).toHaveProperty('token')
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(invitesCreate).toHaveBeenCalled()
  })
})

// The other half of the same surface (the create side is pinned above): a
// clamped staff.invite holder could still SEE and CANCEL another branch's
// pending re-invite. The list HIDES the row, the revoke refuses the write.
describe('pending re-invites — list hides, revoke refuses', () => {
  const row = (id: string, extra?: Record<string, unknown>) => ({
    id,
    email: `${id}@test.com`,
    role: 'STYLIST',
    status: 'pending',
    created_at: '2026-01-01',
    expires_at: '2026-01-08',
    ...extra,
  })
  const FRESH = row('inv-fresh')
  const REINVITE = row('inv-reinvite', { invited_staff_id: TARGET })

  it('listInvites: an out-of-scope re-invite row is dropped, the FRESH row stays', async () => {
    invitesList.mockResolvedValue({ invites: [FRESH, REINVITE] })
    staffWriteInScope.mockImplementation(async ({ targetStaffId }: { targetStaffId: string }) =>
      targetStaffId !== TARGET,
    )
    expect((await listInvites()).map((i) => i.id)).toEqual(['inv-fresh'])
    // A fresh invite has no store dimension, so the clamp is asked ONLY about
    // the re-invite's target card.
    expect(staffWriteInScope).toHaveBeenCalledTimes(1)
    expect(staffWriteInScope).toHaveBeenCalledWith({ targetStaffId: TARGET, actorId: ACTOR })
  })

  it('listInvites: an in-scope viewer keeps both rows', async () => {
    invitesList.mockResolvedValue({ invites: [FRESH, REINVITE] })
    expect((await listInvites()).map((i) => i.id)).toEqual(['inv-fresh', 'inv-reinvite'])
  })

  it('revokeInvite: out of scope → the store-scope code, core untouched, no audit row', async () => {
    invitesList.mockResolvedValue({ invites: [REINVITE] })
    staffWriteInScope.mockResolvedValue(false)
    const lines = await auditLines(async () => {
      await expect(revokeInvite(REINVITE.id)).resolves.toEqual({ error: 'STORE_SCOPE_DENIED' })
    })
    expect(invitesUpdateStatus).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('revokeInvite: in scope → passes through to core', async () => {
    invitesList.mockResolvedValue({ invites: [REINVITE] })
    await expect(revokeInvite(REINVITE.id)).resolves.toEqual({ ok: true })
    expect(invitesUpdateStatus).toHaveBeenCalledWith(REINVITE.id, 'revoked')
  })

  it('revokeInvite: a FRESH invite is never clamped', async () => {
    invitesList.mockResolvedValue({ invites: [FRESH] })
    staffWriteInScope.mockResolvedValue(false)
    await expect(revokeInvite(FRESH.id)).resolves.toEqual({ ok: true })
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(invitesUpdateStatus).toHaveBeenCalledWith(FRESH.id, 'revoked')
  })

  it('revokeInvite: an unreadable invite lookup fails closed, core untouched', async () => {
    invitesList.mockRejectedValue(new Error('core down'))
    const res = await revokeInvite(REINVITE.id)
    expect(res).toHaveProperty('error')
    expect(invitesUpdateStatus).not.toHaveBeenCalled()
  })

  it('revokeInvite: a viewAll actor never pays the lookup — and a broken lookup cannot block them', async () => {
    // The clamp free-passes viewAll, so the read that feeds it is pure cost
    // AND a pure new failure mode for an owner. Neither may exist.
    resolveStoreScope.mockResolvedValue({ viewAll: true })
    invitesList.mockRejectedValue(new Error('core down'))
    await expect(revokeInvite(REINVITE.id)).resolves.toEqual({ ok: true })
    expect(invitesList).not.toHaveBeenCalled()
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(invitesUpdateStatus).toHaveBeenCalledWith(REINVITE.id, 'revoked')
  })
})
