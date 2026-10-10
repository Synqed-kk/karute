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

describe('F7 — a shared pack: the holder card and the visitor card both subtract a pending use (§ 6a H8/N6)', () => {
  const SHARED = { id: 'p-shared', remaining: 5, eligible_customer_ids: ['holder', 'visitor'] }
  it.each([['visitor', 'holder'], ['holder', 'visitor'], ['visitor', 'visitor']])('a pending use by the %s → the %s card reads one fewer', async (user, viewer) => {
    const store = memLedgerStore()
    await insertP3Intent(store, { businessId: BIZ, ownerUserId: null, source: 'no_show', customerId: user, appointmentId: `appt-${user}`, bookingDay: YESTERDAY, packId: 'p-shared', createdBy: null })
    expect(await applyLedgerToPacks([SHARED], viewer, { store, businessId: BIZ })).toEqual({ packs: [{ ...SHARED, remaining: 4 }], ledgerUnreadable: false })
  })
  it('a pack with no eligible list folds the viewer only (unchanged)', async () => {
    const store = memLedgerStore()
    await insertP3Intent(store, { businessId: BIZ, ownerUserId: null, source: 'no_show', customerId: 'other', appointmentId: 'appt-o', bookingDay: YESTERDAY, packId: 'p-own', createdBy: null })
    expect((await applyLedgerToPacks([{ id: 'p-own', remaining: 5 }], 'holder', { store, businessId: BIZ })).packs[0].remaining).toBe(5)
  })
})

describe('Greptile #1163 F1 — one card, one balance: the fold moves remaining, redeemedCount and unconsumedValue together', () => {
  // withUsage's shape for a 10-session pack with 7 used at core, ¥5000 a session
  const PACK = { id: 'p1', pack_size: 10, redeemedCount: 7, remaining: 3, unit_price: 5000, unconsumedValue: 15000 }
  const rowsStore = (rows: Partial<IntentRow>[]): LedgerStore => ({ ...memLedgerStore(), listForCustomers: async () => rows as IntentRow[] })
  const use = { kind: 'use', customer_id: 'c1', pack_id: 'p1', appointment_id: 'a1', redeemed_on: YESTERDAY } as Partial<IntentRow>

  it('one pending use → {remaining 2, redeemedCount 8, unconsumedValue 10000}', async () => {
    const store = mockLedger.current as LedgerStore
    await pendingUse(store)
    const { packs } = await applyLedgerToPacks([PACK], 'c1', { store, businessId: BIZ })
    expect(packs[0]).toMatchObject({ remaining: 2, redeemedCount: 8, unconsumedValue: 10000 })
  })

  it('one held use → the same shape', async () => {
    const { packs } = await applyLedgerToPacks([PACK], 'c1', { store: rowsStore([{ ...use, id: 'h', state: 'held' }]), businessId: BIZ })
    expect(packs[0]).toMatchObject({ remaining: 2, redeemedCount: 8, unconsumedValue: 10000 })
  })

  it('a pending undo (取消待ち) adds back → {4, 6, 20000}', async () => {
    const { packs } = await applyLedgerToPacks([PACK], 'c1', { store: rowsStore([{ ...use, id: 'u', kind: 'undo', state: 'pending' }]), businessId: BIZ })
    expect(packs[0]).toMatchObject({ remaining: 4, redeemedCount: 6, unconsumedValue: 20000 })
  })

  it('unit_price null keeps unconsumedValue as it was; a pack without the fields gets none invented', async () => {
    const store = mockLedger.current as LedgerStore
    await pendingUse(store)
    const noPrice = { ...PACK, unit_price: null as number | null, unconsumedValue: 15000 }
    const [a] = (await applyLedgerToPacks([noPrice], 'c1', { store, businessId: BIZ })).packs
    expect(a).toMatchObject({ remaining: 2, redeemedCount: 8, unconsumedValue: 15000 })
    const [b] = (await applyLedgerToPacks([{ id: 'p1', remaining: 3 }], 'c1', { store, businessId: BIZ })).packs
    expect(b).toEqual({ id: 'p1', remaining: 2 })
  })

  it('the fold happens once: the same pack read twice through the reader gives the same numbers', async () => {
    const store = mockLedger.current as LedgerStore
    await pendingUse(store)
    const first = (await applyLedgerToPacks([PACK], 'c1', { store, businessId: BIZ })).packs[0]
    const second = (await applyLedgerToPacks([PACK], 'c1', { store, businessId: BIZ })).packs[0]
    expect(second).toEqual(first)
    expect(PACK).toMatchObject({ remaining: 3, redeemedCount: 7, unconsumedValue: 15000 }) // input untouched
  })

  it('an empty ledger leaves every field at core\'s value (no recompute when nothing is open)', async () => {
    const over = { ...PACK, redeemedCount: 11, remaining: 0, unconsumedValue: 0 } // over-redeemed at core
    const { packs } = await applyLedgerToPacks([over], 'c1', { store: memLedgerStore(), businessId: BIZ })
    expect(packs[0]).toEqual(over)
  })
})
