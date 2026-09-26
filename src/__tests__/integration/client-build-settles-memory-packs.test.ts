/**
 * The bare client build SETTLES at the three memory mutations and the packs
 * lifecycle switch (Round 3 leg 7d, 2026-09-26, D-S30-1/2).
 *
 * updateMemoryItemAction / toggleMemoryPinAction / deleteMemoryItemAction
 * (memory.ts) and setLifecycleAction (packs.ts) awaited getSynqedClient() BARE.
 * Beneath it, getBusinessId() throws a typed AppApiError — upstream_unavailable
 * (502 class, a failed membership lookup) · internal (500 class) ·
 * membership_inactive (403, a removed staffer) — and getCurrentAccessToken()
 * throws a plain Error('Not authenticated') when there is no session. Any of the
 * four REJECTED the server action, and the consumers (CustomerMemoryCard,
 * TicketPackCard's LifecycleRow) await it with no catch: busy stuck true, no
 * toast, an unhandled rejection in the browser.
 *
 * D-S30-1: all four throw classes now settle to the action's own { ok: false }
 * — the answer the guarded siblings already give (memory: add / relearn /
 * passport; packs: the five .catch sites), so the card prints its own existing
 * toast. No new string, coreFailureLine NOT used (no consumer for a line).
 * D-S30-2: the log is the BOUNDED describeUnknownThrow shape (name + status +
 * masked first line), never the whole error — an AppApiError's cause can carry
 * raw DB text. Every thrown value here carries a cause with RAW_DB_MARKER, and
 * no logged argument may contain it.
 *
 * The REAL getSynqedClient body runs (src/lib/synqed/client.ts): only its two
 * reads are armed, through a pass-through jest.fn around the real @/lib/staff
 * exports (lesson 104), and the ESM-only SDK is a stub that records what it was
 * built with. The two cores, next/cache and auditWeb are observable spies.
 *
 * RED on main: the four actions REJECT on every throw row (16 rows red); the
 * success and denial rows are green.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
}))
jest.mock('next-intl/server', () => ({ getLocale: jest.fn(async () => 'ja') }))
// The ESM-only SDK: jest cannot load it, so a stub stands in for the base class
// ActorSynqedClient extends — it records every construction so a success row
// can prove the REAL client build ran with the business the read returned.
const mockSdk = { built: [] as Array<{ config: { businessId?: string }; instance: object }> }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    constructor(config: { businessId?: string }) {
      mockSdk.built.push({ config, instance: this })
    }
  },
}))
// Pass-through jest.fns around the REAL exports (lesson 104): observable, and
// armed per row below. client.ts reads these two through the module registry.
jest.mock('@/lib/staff', () => {
  const actual = jest.requireActual<typeof import('@/lib/staff')>('@/lib/staff')
  return {
    ...actual,
    getBusinessId: jest.fn(() => actual.getBusinessId()),
    getCurrentAccessToken: jest.fn(() => actual.getCurrentAccessToken()),
    getCurrentUserStaffId: jest.fn(() => actual.getCurrentUserStaffId()),
  }
})
jest.mock('@/lib/customers/memory.core', () => ({
  addMemoryItemWithClient: jest.fn(async () => ({ ok: true })),
  updateMemoryItemWithClient: jest.fn(async () => ({ ok: true })),
  toggleMemoryPinWithClient: jest.fn(async () => ({ ok: true })),
  deleteMemoryItemWithClient: jest.fn(async () => ({ ok: true })),
  relearnCustomerMemoryWithClient: jest.fn(async () => ({ ok: true, items: 0 })),
  upsertPassportFieldWithClient: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/lib/packs/packs.core', () => ({
  createPackActionWithClient: jest.fn(async () => ({ ok: true })),
  redeemSessionActionWithClient: jest.fn(async () => ({ ok: true })),
  dismissVisitReconcileActionWithClient: jest.fn(async () => ({ ok: true })),
  logCustomerContactActionWithClient: jest.fn(async () => ({ ok: true })),
  dismissPackAlertActionWithClient: jest.fn(async () => ({ ok: true })),
  setLifecycleActionWithClient: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/lib/packs/store', () => ({ removeRedemption: jest.fn(), updatePackStatus: jest.fn() }))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => {}) }))

import { inspect } from 'node:util'
import { revalidatePath } from 'next/cache'
import { AppApiError } from '@/lib/app-api/errors'
import { getBusinessId, getCurrentAccessToken, getCurrentUserStaffId } from '@/lib/staff'
import * as memoryCore from '@/lib/customers/memory.core'
import * as packsCore from '@/lib/packs/packs.core'
import { auditWeb } from '@/lib/audit-web'
import { updateMemoryItemAction, toggleMemoryPinAction, deleteMemoryItemAction } from '@/actions/memory'
import { setLifecycleAction } from '@/actions/packs'

const RAW_DB_MARKER = 'RAW-DB-TEXT-MARKER'
const rawCause = () => new Error(`${RAW_DB_MARKER}: relation "profiles" row 42 violates …`)

const businessRead = getBusinessId as unknown as jest.Mock
const tokenRead = getCurrentAccessToken as unknown as jest.Mock
const staffRead = getCurrentUserStaffId as unknown as jest.Mock
const revalidate = revalidatePath as unknown as jest.Mock
const audit = auditWeb as unknown as jest.Mock

/** The four throw classes of getSynqedClient(); `log` = the bounded shape, typed as a literal. */
const THROW_ROWS = [
  {
    cls: 'upstream_unavailable (502) on getBusinessId',
    arm: () =>
      businessRead.mockRejectedValue(
        new AppApiError('upstream_unavailable', 'Business membership lookup failed', undefined, rawCause()),
      ),
    log: { errName: 'AppApiError', errStatus: 502, errMessage: 'Business membership lookup failed' },
  },
  {
    cls: 'internal (500) on getBusinessId',
    arm: () =>
      businessRead.mockRejectedValue(
        new AppApiError('internal', 'synqed-core client unavailable', undefined, rawCause()),
      ),
    log: { errName: 'AppApiError', errStatus: 500, errMessage: 'synqed-core client unavailable' },
  },
  {
    cls: 'membership_inactive (403) on getBusinessId',
    arm: () =>
      businessRead.mockRejectedValue(
        new AppApiError('membership_inactive', 'No active business membership for this user', undefined, rawCause()),
      ),
    log: { errName: 'AppApiError', errStatus: 403, errMessage: 'No active business membership for this user' },
  },
  {
    cls: "plain Error('Not authenticated') on getCurrentAccessToken",
    arm: () => tokenRead.mockRejectedValue(new Error('Not authenticated', { cause: rawCause() })),
    log: { errName: 'Error', errMessage: 'Not authenticated' },
  },
] as const

const UPDATE_INPUT = { id: 'mem-1', label: '来店時は窓側の席', detail: null }
const LIFECYCLE_INPUT = { customerId: 'cust-1', status: 'ACTIVE', referral: false } as const

const ACTIONS = [
  {
    name: 'updateMemoryItemAction',
    run: () => updateMemoryItemAction(UPDATE_INPUT),
    core: memoryCore.updateMemoryItemWithClient as unknown as jest.Mock,
    coreArgs: [UPDATE_INPUT],
    logSpy: 'error' as const,
    tag: '[memory] pre-core read failed:',
    lifecycle: false,
  },
  {
    name: 'toggleMemoryPinAction',
    run: () => toggleMemoryPinAction('mem-1', true),
    core: memoryCore.toggleMemoryPinWithClient as unknown as jest.Mock,
    coreArgs: ['mem-1', true],
    logSpy: 'error' as const,
    tag: '[memory] pre-core read failed:',
    lifecycle: false,
  },
  {
    name: 'deleteMemoryItemAction',
    run: () => deleteMemoryItemAction('mem-1'),
    core: memoryCore.deleteMemoryItemWithClient as unknown as jest.Mock,
    coreArgs: ['mem-1'],
    logSpy: 'error' as const,
    tag: '[memory] pre-core read failed:',
    lifecycle: false,
  },
  {
    name: 'setLifecycleAction',
    run: () => setLifecycleAction(LIFECYCLE_INPUT as never),
    core: packsCore.setLifecycleActionWithClient as unknown as jest.Mock,
    coreArgs: ['staff-1', LIFECYCLE_INPUT],
    logSpy: 'warn' as const,
    tag: '[packs] synqed client init failed:',
    lifecycle: true,
  },
]

const spies = {} as Record<'error' | 'warn' | 'log' | 'info', jest.SpyInstance>
beforeEach(() => {
  jest.clearAllMocks()
  mockSdk.built.length = 0
  for (const k of ['error', 'warn', 'log', 'info'] as const) {
    spies[k] = jest.spyOn(console, k).mockImplementation(() => {})
  }
  businessRead.mockResolvedValue('biz-1')
  tokenRead.mockResolvedValue('token-1')
  staffRead.mockResolvedValue('staff-1')
  for (const a of ACTIONS) a.core.mockResolvedValue({ ok: true })
})
afterEach(() => {
  for (const s of Object.values(spies)) s.mockRestore()
})

/** Every argument of every console call, inspected deep (Error cause + stack included). */
const everythingLogged = () =>
  Object.values(spies)
    .flatMap((s) => s.mock.calls.flat())
    .map((arg) => inspect(arg, { depth: 10 }))
    .join('\n')

describe('the literals', () => {
  it('the marker rides in the cause, where only a whole-error log would print it', () => {
    const e = new AppApiError('upstream_unavailable', 'Business membership lookup failed', undefined, rawCause())
    expect(e.message).not.toContain(RAW_DB_MARKER)
    expect(inspect(e, { depth: 10 })).toContain(RAW_DB_MARKER)
  })
})

describe.each(ACTIONS)('$name — the client build settles', (a) => {
  it.each(THROW_ROWS)('$cls → { ok: false }, no write, no revalidate, one bounded log line', async (row) => {
    row.arm()
    await expect(a.run()).resolves.toStrictEqual({ ok: false })
    expect(a.core).not.toHaveBeenCalled()
    expect(revalidate).not.toHaveBeenCalled()
    expect(mockSdk.built).toHaveLength(0)

    const lines = spies[a.logSpy].mock.calls
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(2)
    expect(lines[0][0]).toBe(a.tag)
    const logged = lines[0][1]
    expect(logged).not.toBeInstanceOf(Error)
    expect(logged).toStrictEqual(row.log)
    // No other channel spoke, and nothing anywhere carried the raw cause.
    const other = a.logSpy === 'error' ? 'warn' : 'error'
    expect(spies[other]).not.toHaveBeenCalled()
    expect(everythingLogged()).not.toContain(RAW_DB_MARKER)

    if (a.lifecycle) {
      expect(audit).not.toHaveBeenCalled()
      // The actor read runs BEFORE the client build: once, and first.
      expect(staffRead).toHaveBeenCalledTimes(1)
      expect(businessRead).toHaveBeenCalledTimes(1)
      expect(staffRead.mock.invocationCallOrder[0]).toBeLessThan(businessRead.mock.invocationCallOrder[0])
    }
  })

  it('success: both reads resolve → the real build runs, the core is called once with it, { ok: true }, revalidated once', async () => {
    await expect(a.run()).resolves.toStrictEqual({ ok: true })
    expect(mockSdk.built).toHaveLength(1)
    expect(mockSdk.built[0].config.businessId).toBe('biz-1')
    expect(a.core).toHaveBeenCalledTimes(1)
    expect(a.core).toHaveBeenCalledWith(expect.anything(), ...a.coreArgs)
    expect(a.core.mock.calls[0][0]).toBe(mockSdk.built[0].instance)
    expect(revalidate).toHaveBeenCalledTimes(1)
    expect(revalidate).toHaveBeenCalledWith('/[locale]/(app)/customers/[id]', 'page')
    expect(spies.error).not.toHaveBeenCalled()
    expect(spies.warn).not.toHaveBeenCalled()
    if (a.lifecycle) {
      expect(audit).toHaveBeenCalledTimes(1)
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'customer.lifecycle_set', targetId: 'cust-1' }),
      )
    }
  })

  it('denial: the core answers { ok: false } → { ok: false } byte-for-byte, the new catch never ran', async () => {
    a.core.mockResolvedValue({ ok: false })
    await expect(a.run()).resolves.toStrictEqual({ ok: false })
    expect(a.core).toHaveBeenCalledTimes(1)
    expect(mockSdk.built).toHaveLength(1)
    expect(revalidate).not.toHaveBeenCalled()
    expect(spies.error).not.toHaveBeenCalled()
    expect(spies.warn).not.toHaveBeenCalled()
    if (a.lifecycle) expect(audit).not.toHaveBeenCalled()
  })
})
