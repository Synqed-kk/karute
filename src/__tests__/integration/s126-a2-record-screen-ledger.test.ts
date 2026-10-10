/**
 * S126 A2 builder 5 (R-S126-4 d / R-S126-6 e, W3b): buildRecordScreen end to end
 * over a pending ledger use, on both deps paths — the web page's
 * (sessions/page.tsx: listCustomerPacks → applyLedgerToPacks(p, id), the cookie
 * ledger) and the facade's (screens/record/route.ts: listCustomerPacksWithClient →
 * applyLedgerToPacks(p, id, await usageLedgerFor(businessId))). The listPacks
 * closures below are those two lines as written; core is faked at the SDK
 * boundary, the ledger is the real module over the in-memory store.
 * Server 3 + one pending → the screen's targetPack carries 2, and
 * resolveOutcomeMode turns 'repurchase' where it ran 'auto' on 3.
 */
import type { SynqedClient } from '@synqed-kk/client'
import { memLedgerStore } from './helpers/ledger-fake'
import type { LedgerStore } from '@/lib/packs/use-ledger'

const BIZ = 'biz-a2'
const mockLedger: { current: LedgerStore | null } = { current: null }
const mockCore: { current: SynqedClient | null } = { current: null }
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {}, SynqedError: class extends Error {} }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => mockCore.current),
  newSynqedClient: jest.fn(() => mockCore.current),
}))
jest.mock('@/lib/packs/use-ledger', () => ({
  ...jest.requireActual('@/lib/packs/use-ledger'),
  defaultLedgerStore: jest.fn(async () => mockLedger.current),
  defaultLedgerContext: jest.fn(async () => ({ store: mockLedger.current, businessId: 'biz-a2', ownerUserId: null })),
}))

import { buildRecordScreen, type RecordScreenDeps } from '@/lib/karute/record-screen'
import { applyLedgerToPacks, listCustomerPacks, listCustomerPacksWithClient, usageLedgerFor } from '@/lib/packs/store'
import { resolveOutcomeMode } from '@/lib/packs/resolve'
import { insertP3Intent } from '@/lib/packs/use-ledger'
import type { CustomerWithStaff } from '@/lib/customers/queries'
import type { AppointmentRow } from '@/actions/appointments'

const CUSTOMER_ID = 'cust-1'
const walkInCustomer = { id: CUSTOMER_ID, name: 'テスト客' } as unknown as CustomerWithStaff
const booking = {
  id: 'appt-1', client_id: CUSTOMER_ID, staff_profile_id: 's1', start_time: '2026-09-12T02:00:00.000Z',
  duration_minutes: 60, title: null, notes: null, karute_record_id: null, customers: { name: 'テスト客' },
} as unknown as AppointmentRow

/** One counted pack p1: 10 sessions, 7 settled at core → server 残3. */
function fakeCore(): SynqedClient {
  return {
    packs: {
      listPacks: async () => [{
        id: 'p1', customer_id: CUSTOMER_ID, kind: 'pack', pack_size: 10, unit_price: 9900, total_price: 99000,
        purchase_round: 1, purchased_at: '2026-01-01', source: 'manual', status: 'active', notes: null,
      }],
      listRedemptions: async () => Array.from({ length: 7 }, () => ({ pack_id: 'p1', redeemed_on: '2026-08-01' })),
    },
  } as unknown as SynqedClient
}

const WEB_LIST_PACKS: RecordScreenDeps['listPacks'] = (id) =>
  listCustomerPacks(id).then(async (p) => (await applyLedgerToPacks(p, id)).packs)
const FACADE_LIST_PACKS = (synqed: SynqedClient, businessId: string): RecordScreenDeps['listPacks'] => (id) =>
  listCustomerPacksWithClient(synqed, id)
    .then(async (p) => (await applyLedgerToPacks(p, id, await usageLedgerFor(businessId))).packs).catch(() => [])

async function screenWith(listPacks: RecordScreenDeps['listPacks']) {
  return buildRecordScreen({
    locale: 'ja',
    now: new Date('2026-09-12T03:00:00.000Z'),
    activeStaffId: 's1',
    staffList: [{ id: 's1', full_name: 'Staff' }],
    customers: [],
    todayAppts: [booking],
    orgSettings: null,
    statusLabel: () => '',
    deps: {
      resolveExplicitAppointment: async () => null,
      resolveWalkInCustomer: async () => walkInCustomer,
      getTargetCustomer: async () => null,
      getConsent: async () => null,
      getKaruteRecords: async () => [],
      listPacks,
      getLifecycle: async () => ({ ok: true as const, lifecycle: null }),
    },
  })
}

async function pendingUse(store: LedgerStore) {
  return insertP3Intent(store, {
    businessId: BIZ, ownerUserId: null, source: 'no_show', customerId: CUSTOMER_ID,
    appointmentId: 'appt-0', bookingDay: '2026-09-11', packId: 'p1', createdBy: null,
  })
}

beforeEach(() => {
  mockLedger.current = memLedgerStore()
  mockCore.current = fakeCore()
})

describe.each([
  ['web (sessions/page.tsx)', () => WEB_LIST_PACKS],
  ['facade (screens/record/route.ts)', () => FACADE_LIST_PACKS(mockCore.current as SynqedClient, BIZ)],
])('buildRecordScreen — %s — reads the ledger-aware pack total', (_path, listPacksFor) => {
  it('server 3 → targetPack 3, mode auto; one pending use → targetPack 2, mode repurchase', async () => {
    const before = await screenWith(listPacksFor())
    expect(before.targetPack).toEqual({ id: 'p1', remaining: 3, size: 10, otherRemaining: 0 })
    expect(resolveOutcomeMode(before.targetPack)).toBe('auto')

    const row = await pendingUse(mockLedger.current as LedgerStore)
    expect(row.state).toBe('pending')
    const after = await screenWith(listPacksFor())
    expect(after.targetPack).toEqual({ id: 'p1', remaining: 2, size: 10, otherRemaining: 0 })
    expect(resolveOutcomeMode(after.targetPack)).toBe('repurchase')
  })
})
