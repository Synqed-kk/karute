/**
 * S125 PR-A2 (design v4.2 § 6a / § 6b): the ONE ledger-aware usage read.
 * Core is faked at the SDK boundary; the ledger is the real module over an
 * in-memory store whose rows the tests insert through the real insertP3Intent.
 *  (16 — the reconcile loader — is held back with its wiring; see the S126 builder-2 report.)
 *  18 — the yen line + resolveOutcomeMode read server − pending (3 → 2 → 'repurchase').
 *  19 — a ledger read failure → ledgerUnreadable (the 残数確認中 flag), server numbers stand.
 */
import type { SynqedClient } from '@synqed-kk/client'
import { memLedgerStore } from './helpers/ledger-fake'
import type { LedgerStore } from '@/lib/packs/use-ledger'

const mockLedger: { current: LedgerStore | null } = { current: null }
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {}, SynqedError: class extends Error {} }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))
jest.mock('@/lib/packs/use-ledger', () => ({
  ...jest.requireActual('@/lib/packs/use-ledger'),
  defaultLedgerStore: jest.fn(async () => mockLedger.current),
  // the cookie session's ledger (R-S126-3 a: an omitted ledger argument resolves it)
  defaultLedgerContext: jest.fn(async () => ({ store: mockLedger.current, businessId: 'biz-a2', ownerUserId: null })),
}))
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => [{ id: 'c1', name: 'A' }]),
  getCachedCustomerListFor: jest.fn(async () => [{ id: 'c1', name: 'A' }]),
}))

import { insertP3Intent, recoveryDayPrecheck, type IntentRow } from '@/lib/packs/use-ledger'
import { loadUnprocessedVisitsWithClient } from '@/lib/packs/reconcile'
import { applyLedgerToPacks, listAllPackUsageWithClient } from '@/lib/packs/store'
import { pickRedemptionTarget, resolveOutcomeMode } from '@/lib/packs/resolve'
import { ymdInJst } from '@/lib/date/jst'

const BIZ = 'biz-a2'
const YESTERDAY = ymdInJst(new Date(Date.now() - 86_400_000))

function fakeCore(): SynqedClient {
  return {
    packs: {
      // pack_size 10, 7 settled at core → server remaining 3
      listActivePacks: async () => [{ id: 'p1', kind: 'pack', customer_id: 'c1', pack_size: 10, unit_price: 1000 }],
      listAllRedemptionPackIds: async () => Array(7).fill('p1'),
      listLifecycles: async () => [],
      listVisitDismissals: async () => [],
      listRecentRedemptions: async () => [],
    },
    appointments: {
      list: async () => ({ appointments: [{ id: 'a1', customer_id: 'c1', starts_at: `${YESTERDAY}T01:00:00.000Z`, staff_id: null, status: 'SCHEDULED', notes: '' }] }),
    },
    karuteRecords: { list: async () => ({ karute_records: [{ appointment_id: 'a1' }] }) },
  } as unknown as SynqedClient
}

async function pendingUse(store: LedgerStore) {
  return insertP3Intent(store, {
    businessId: BIZ, ownerUserId: null, source: 'no_show', customerId: 'c1',
    appointmentId: 'a1', bookingDay: YESTERDAY, packId: 'p1', createdBy: null,
  })
}

function brokenStore(): LedgerStore {
  return { ...memLedgerStore(), listForCustomers: async () => { throw new Error('ledger down') } }
}

beforeEach(() => { mockLedger.current = memLedgerStore() })

describe('18 — the yen lines and resolveOutcomeMode read the ledger-aware number', () => {
  it('server 3 with one pending reads 2; 未消化 ¥ follows; the mode turns repurchase', async () => {
    const store = mockLedger.current as LedgerStore
    const before = (await listAllPackUsageWithClient(fakeCore(), { store, businessId: BIZ })).get('c1')
    expect(before).toMatchObject({ remaining: 3, unconsumed: 3000 })
    expect(before!.ledgerUses).toBeUndefined() // no open use: today's object shape
    expect(resolveOutcomeMode({ remaining: before!.remaining })).toBe('auto')

    await pendingUse(store)
    const after = (await listAllPackUsageWithClient(fakeCore(), { store, businessId: BIZ })).get('c1')
    expect(after).toMatchObject({ remaining: 2, unconsumed: 2000, ledgerUses: 1 })
    expect(after!.ledgerOpenUses).toEqual([{ appointmentId: 'a1', redeemedOn: YESTERDAY }])
    expect(after!.ledgerUnreadable).toBeUndefined()
    expect(resolveOutcomeMode({ remaining: after!.remaining })).toBe('repurchase')
  })

  it('an empty ledger = today\'s server numbers and today\'s object shape', async () => {
    const u = (await listAllPackUsageWithClient(fakeCore(), { store: memLedgerStore(), businessId: BIZ })).get('c1')
    expect(u).toMatchObject({ remaining: 3, unconsumed: 3000 })
    expect(u).not.toHaveProperty('ledgerUses')
    expect(u).not.toHaveProperty('ledgerUnreadable')
  })

  it('no ledger argument = the cookie session\'s ledger is folded (no caller opts out)', async () => {
    await pendingUse(mockLedger.current as LedgerStore)
    expect((await listAllPackUsageWithClient(fakeCore())).get('c1')).toMatchObject({ remaining: 2, unconsumed: 2000, ledgerUses: 1 })
    expect((await applyLedgerToPacks([{ id: 'p1', remaining: 3 }], 'c1')).packs).toEqual([{ id: 'p1', remaining: 2 }])
  })

  it('an unavailable ledger (null) = server numbers + ledgerUnreadable, never a throw', async () => {
    expect((await listAllPackUsageWithClient(fakeCore(), null)).get('c1')).toMatchObject({ remaining: 3, ledgerUnreadable: true })
  })

  it('the burnable pre-check: a pack whose last unit is pending is not offered', async () => {
    const store = mockLedger.current as LedgerStore
    await pendingUse(store)
    const packs = [{ id: 'p1', kind: 'pack', status: 'active', remaining: 1, purchased_at: '2026-01-01' }]
    const { packs: folded, ledgerUnreadable } = await applyLedgerToPacks(packs, 'c1', { store, businessId: BIZ })
    expect(ledgerUnreadable).toBe(false)
    expect(folded[0].remaining).toBe(0)
    expect(pickRedemptionTarget(folded as never)).toBeNull()
  })
})

describe('19 — a ledger read failure', () => {
  it('flags ledgerUnreadable (残数確認中) and keeps the server number', async () => {
    const u = (await listAllPackUsageWithClient(fakeCore(), { store: brokenStore(), businessId: BIZ })).get('c1')
    expect(u).toMatchObject({ remaining: 3, ledgerUnreadable: true })
    const r = await applyLedgerToPacks([{ id: 'p1', remaining: 3 }], 'c1', { store: brokenStore(), businessId: BIZ })
    expect(r).toEqual({ packs: [{ id: 'p1', remaining: 3 }], ledgerUnreadable: true })
  })
})

describe('16 — the reconcile loader counts a pending use as a burn (H2)', () => {
  it('the visit is unprocessed with no use, and is NOT once a pending use exists', async () => {
    const before = await loadUnprocessedVisitsWithClient(fakeCore(), BIZ)
    expect(before.entries).toHaveLength(1)
    await pendingUse(mockLedger.current as LedgerStore)
    const after = await loadUnprocessedVisitsWithClient(fakeCore(), BIZ)
    expect(after.entries).toHaveLength(0)
  })
})

describe('W4.1 — D5 (recoveryDayPrecheck) counts an open ledger use on the customer-day', () => {
  it('an earlier pending use that day refuses a walk-in recovery use; without it the core check alone passes', async () => {
    const store = mockLedger.current as LedgerStore
    const p3 = await pendingUse(store)
    const later = new Date(Date.parse(p3.created_at ?? new Date().toISOString()) + 1000).toISOString()
    const recovery: IntentRow = { ...p3, id: 'r-2', kind: 'use', ledger_source: 'recovery', appointment_id: null, another_session: false, created_at: later }
    const core = fakeCore()
    expect(await recoveryDayPrecheck(core)(recovery)).toEqual({ ok: true })
    expect(await recoveryDayPrecheck(core, store)(recovery)).toEqual({ refuse: 'already_redeemed' })
    expect(await recoveryDayPrecheck(core, store)({ ...recovery, another_session: true })).toEqual({ ok: true })
    expect(await recoveryDayPrecheck(core, store)({ ...recovery, redeemed_on: ymdInJst(new Date()) })).toEqual({ ok: true })
  })
})
