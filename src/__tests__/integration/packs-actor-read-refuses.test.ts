/**
 * Round 3 leg 2 (2026-09-25, D-S16-4, discussed, default): the six packs.ts
 * web actions read the acting staff id FIRST and refuse when that read
 * THROWS — an outage is never written as a null actor, and a refused read
 * never even builds a client. D-S20-1 (lead): createPack / redeem /
 * setLifecycle refuse a RESOLVED null too; the other three hand it to their
 * cores unchanged (logContact / dismissAlert cores refuse it; the reconcile
 * core stamps 'unknown' on purpose). Mocks modelled on
 * packs-dashboard-mutation-twins.test.ts; the cores are spies.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn(async () => 's1') }))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
const synqed = { sentinel: 'client' }
const getSynqedClient = jest.fn(async () => synqed as never)
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: () => getSynqedClient(),
}))
jest.mock('@/lib/packs/packs.core', () => ({
  createPackActionWithClient: jest.fn(),
  redeemSessionActionWithClient: jest.fn(),
  dismissVisitReconcileActionWithClient: jest.fn(),
  logCustomerContactActionWithClient: jest.fn(),
  dismissPackAlertActionWithClient: jest.fn(),
  setLifecycleActionWithClient: jest.fn(),
}))
jest.mock('@/lib/packs/store', () => ({
  removeRedemption: jest.fn(),
  updatePackStatus: jest.fn(),
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => {}) }))

import { revalidatePath } from 'next/cache'
import { getCurrentUserStaffId } from '@/lib/staff'
import * as core from '@/lib/packs/packs.core'
import {
  createPackAction,
  redeemSessionAction,
  dismissVisitReconcileAction,
  logCustomerContactAction,
  dismissPackAlertAction,
  setLifecycleAction,
} from '@/actions/packs'

const staffRead = getCurrentUserStaffId as jest.Mock

type Case = {
  name: string
  run: () => Promise<unknown>
  core: jest.Mock
  input: unknown
  refused: object
  /** D-S20-1: the wrapper refuses a resolved null itself (else: core decides). */
  nullRefused: boolean
  okResult: object
}

const cases: Case[] = [
  {
    name: 'createPackAction',
    input: { customerId: 'c1', kind: 'pack', packSize: 5, unitPrice: 1000 },
    run: () => createPackAction(cases[0].input as never),
    core: core.createPackActionWithClient as jest.Mock,
    refused: { ok: false, error: 'write failed' },
    nullRefused: true,
    okResult: { ok: true },
  },
  {
    name: 'redeemSessionAction',
    input: { packId: 'p1', customerId: 'c1' },
    run: () => redeemSessionAction(cases[1].input as never),
    core: core.redeemSessionActionWithClient as jest.Mock,
    refused: { ok: false, error: 'write failed' },
    nullRefused: true,
    okResult: { ok: true, redemptionId: 'r1' },
  },
  {
    name: 'dismissVisitReconcileAction',
    input: { customerId: 'c1', visitDay: '2026-09-25' },
    run: () => dismissVisitReconcileAction(cases[2].input as never),
    core: core.dismissVisitReconcileActionWithClient as jest.Mock,
    refused: { ok: false },
    nullRefused: false,
    okResult: { ok: true },
  },
  {
    name: 'logCustomerContactAction',
    input: { customerId: 'c1', channel: 'phone' },
    run: () => logCustomerContactAction(cases[3].input as never),
    core: core.logCustomerContactActionWithClient as jest.Mock,
    refused: { ok: false, error: 'write failed' },
    nullRefused: false,
    okResult: { ok: true },
  },
  {
    name: 'dismissPackAlertAction',
    input: { customerId: 'c1' },
    run: () => dismissPackAlertAction(cases[4].input as never),
    core: core.dismissPackAlertActionWithClient as jest.Mock,
    refused: { ok: false, error: 'write failed' },
    nullRefused: false,
    okResult: { ok: true },
  },
  {
    name: 'setLifecycleAction',
    input: { customerId: 'c1', status: 'ACTIVE', referral: false },
    run: () => setLifecycleAction(cases[5].input as never),
    core: core.setLifecycleActionWithClient as jest.Mock,
    refused: { ok: false },
    nullRefused: true,
    okResult: { ok: true },
  },
]

const nullRefusal: Record<string, object> = {
  createPackAction: { ok: false, error: 'no staff identity' },
  redeemSessionAction: { ok: false, error: 'no staff identity' },
  setLifecycleAction: { ok: false },
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const c of cases) c.core.mockResolvedValue(c.okResult)
})

for (const c of cases) {
  describe(c.name, () => {
    it(`P-thrown: identity read THROWS → ${JSON.stringify(c.refused)}, no client built, no write, no revalidate`, async () => {
      staffRead.mockRejectedValueOnce(new Error('roster read failed'))
      await expect(c.run()).resolves.toEqual(c.refused)
      expect(c.core).not.toHaveBeenCalled()
      expect(getSynqedClient).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    if (c.nullRefused) {
      it(`P-null: resolved null → ${JSON.stringify(nullRefusal[c.name])} (D-S20-1), no write`, async () => {
        staffRead.mockResolvedValueOnce(null)
        await expect(c.run()).resolves.toEqual(nullRefusal[c.name])
        expect(c.core).not.toHaveBeenCalled()
        expect(getSynqedClient).not.toHaveBeenCalled()
      })
    } else {
      it('P-null: resolved null → handed to the core unchanged (the core decides)', async () => {
        staffRead.mockResolvedValueOnce(null)
        await c.run()
        expect(c.core).toHaveBeenCalledTimes(1)
        expect(c.core).toHaveBeenCalledWith(synqed, null, c.input)
      })
    }

    it("P-ok: 's1' → core called once with 's1' as the actor, its result returned, revalidated", async () => {
      staffRead.mockResolvedValueOnce('s1')
      await expect(c.run()).resolves.toEqual(c.okResult)
      expect(c.core).toHaveBeenCalledTimes(1)
      expect(c.core).toHaveBeenCalledWith(synqed, 's1', c.input)
      expect(revalidatePath).toHaveBeenCalled()
    })
  })
}
