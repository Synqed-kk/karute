/**
 * S125 PR-A2 — the no-show / cancel path (P3), the settle step, the P4 stall.
 * Core faked at the SDK boundary; the ledger is the in-memory fake store.
 * Numbers = the packet's § A7 list.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://placeholder.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service'

jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import {
  attemptIntent, insertP3Intent, isDailyPass, settlePending, systemDepsFor, usageFromRows,
  type IntentRow, type LedgerStore,
} from '@/lib/packs/use-ledger'
import { memLedgerStore } from './helpers/ledger-fake'

const B = '00000000-0000-4000-8000-0000000000b1'
const BOOKING = { id: 'appt-1', starts_at: '2026-10-09T10:00:00Z', created_at: '2026-10-01T00:00:00Z' }

function fakeCore(status: string, reason: string | null = null) {
  const addRedemption = jest.fn(async () => ({ id: 'core-1' }))
  return {
    addRedemption,
    synqed: {
      packs: { addRedemption, listRecentRedemptions: jest.fn(async () => []), listPacks: jest.fn(async () => []), listRedemptions: jest.fn(async () => []) },
      appointments: { get: jest.fn(async () => ({ ...BOOKING, status, status_reason: reason })) },
    } as unknown as Parameters<typeof attemptIntent>[0]['synqed'],
  }
}
const p3 = (store: LedgerStore, source: 'no_show' | 'cancel' = 'no_show') => insertP3Intent(store, {
  businessId: B, ownerUserId: null, source, customerId: 'cust-1', appointmentId: 'appt-1',
  bookingDay: '2026-10-09', packId: 'pack-1', createdBy: 'staff-1',
})

describe('7 (P3 half) — the intent is written before the status write', () => {
  it('a ledger insert failure THROWS (the caller aborts before its status write)', async () => {
    const store = { ...memLedgerStore(), insertIgnore: async () => { throw new Error('db down') } }
    await expect(p3(store)).rejects.toThrow('db down')
  })
  it('the row is frozen: booking day, booked, system-picked, counts_as_visit false', async () => {
    const row = await p3(memLedgerStore())
    expect(row).toMatchObject({ state: 'pending', redeemed_on: '2026-10-09', appointment_id: 'appt-1', pack_picked_by: 'system', ledger_source: 'no_show' })
    expect(row.frozen_payload).toMatchObject({ counts_as_visit: false, source: 'manual' })
  })
})

describe('17 — R2: a P3 attempt re-checks the booking status, every attempt', () => {
  it('still NO_SHOW → sent and settled', async () => {
    const store = memLedgerStore(); const row = await p3(store); const c = fakeCore('NO_SHOW')
    const out = await attemptIntent({ store, synqed: c.synqed, ...systemDepsFor(row, c.synqed) }, row)
    expect(out.state).toBe('settled'); expect(c.addRedemption).toHaveBeenCalledTimes(1)
  })
  it('restored (no longer NO_SHOW) → withdrawn (system, status_changed), never sent', async () => {
    const store = memLedgerStore(); const row = await p3(store); const c = fakeCore('CONFIRMED')
    const out = await attemptIntent({ store, synqed: c.synqed, ...systemDepsFor(row, c.synqed) }, row)
    expect(out).toMatchObject({ state: 'withdrawn', withdrawn_by: 'system', last_error_code: 'status_changed' })
    expect(c.addRedemption).not.toHaveBeenCalled()
  })
  it('CANCELLED same-day-contact → sent; CANCELLED with another reason → withdrawn', async () => {
    const s1 = memLedgerStore(); const r1 = await p3(s1, 'cancel'); const ok = fakeCore('CANCELLED', 'cancel-same-day-contact')
    expect((await attemptIntent({ store: s1, synqed: ok.synqed, ...systemDepsFor(r1, ok.synqed) }, r1)).state).toBe('settled')
    const s2 = memLedgerStore(); const r2 = await p3(s2, 'cancel'); const no = fakeCore('CANCELLED', 'cancel-advance-contact')
    expect((await attemptIntent({ store: s2, synqed: no.synqed, ...systemDepsFor(r2, no.synqed) }, r2)).state).toBe('withdrawn')
    expect(no.addRedemption).not.toHaveBeenCalled()
  })
  it('an unreadable booking = pending, never sent (R2: an erroring pre-check = pending)', async () => {
    const store = memLedgerStore(); const row = await p3(store); const c = fakeCore('NO_SHOW')
    ;(c.synqed.appointments.get as jest.Mock).mockRejectedValueOnce(new Error('core down'))
    const out = await attemptIntent({ store, synqed: c.synqed, ...systemDepsFor(row, c.synqed) }, row)
    expect(out.state).toBe('pending'); expect(c.addRedemption).not.toHaveBeenCalled()
  })
  it('the settle pass runs the same re-check: a restored booking ends withdrawn', async () => {
    const store = memLedgerStore(); await p3(store); const c = fakeCore('CONFIRMED')
    const sum = await settlePending({ store, clientFor: () => c.synqed, rotate: (ids) => [...ids], dailyPass: false })
    expect(sum.attempted).toBe(1); expect(c.addRedemption).not.toHaveBeenCalled()
  })
})

describe('C7 / R-S127-4 — a thrown store write inside attemptIntent never aborts the settle pass', () => {
  it('a withdrawBySystem write that throws leaves the row pending with the lease released, and the pass still reaches the NEXT business', async () => {
    const B2 = '00000000-0000-4000-8000-0000000000b2'
    const base = memLedgerStore()
    const store: LedgerStore = {
      ...base,
      async update(b, id, w, patch) {
        if (b === B && patch.state === 'withdrawn') throw new Error('store write failed')
        return base.update(b, id, w, patch)
      },
    }
    const r1 = await p3(store)                                   // B: booking restored → the system withdraws → the write throws
    const r2 = await insertP3Intent(store, {                     // B2: still NO_SHOW → sent and settled
      businessId: B2, ownerUserId: null, source: 'no_show', customerId: 'cust-2', appointmentId: 'appt-1',
      bookingDay: '2026-10-09', packId: 'pack-1', createdBy: 'staff-1',
    })
    const restored = fakeCore('CONFIRMED'); const noShow = fakeCore('NO_SHOW')
    const sum = await settlePending({ store, clientFor: (b) => (b === B ? restored.synqed : noShow.synqed), rotate: (ids) => [...ids], dailyPass: false })
    expect(sum.attempted).toBe(2)
    const [a] = await store.getAllById(r1.id); const [b] = await store.getAllById(r2.id)
    expect(a).toMatchObject({ state: 'pending', leased_until: null, last_error_code: 'precheck_error' })
    expect(restored.addRedemption).not.toHaveBeenCalled()
    expect(b).toMatchObject({ state: 'settled', settled_core_id: 'core-1' })
    expect(noShow.addRedemption).toHaveBeenCalledTimes(1)
  })
})

describe('A4 — the settle pass clock', () => {
  it('the 08:30 JST pass is the daily pass; the hourly passes are not', () => {
    expect(isDailyPass(new Date('2026-10-09T23:30:00Z'))).toBe(true)
    expect(isDailyPass(new Date('2026-10-10T01:00:00Z'))).toBe(false)
  })
})

describe('P4 stall read (H2) — open walk-in uses by day', () => {
  it('counts held/pending walk-ins per day; a booked or settled use never stalls', () => {
    const base = { kind: 'use', customer_id: 'c', pack_id: 'p', redeemed_on: '2026-10-10' } as Partial<IntentRow>
    const u = usageFromRows([
      { ...base, id: '1', state: 'pending', appointment_id: null },
      { ...base, id: '2', state: 'held', appointment_id: null },
      { ...base, id: '3', state: 'pending', appointment_id: 'appt-9' },
      { ...base, id: '4', state: 'settled', appointment_id: null },
    ] as IntentRow[]).get('c')!
    expect(u.openWalkInByDay.get('2026-10-10')).toBe(2)
    expect(u.pendingWalkInByDay.get('2026-10-10')).toBe(1) // R-S127-2: only the pending one stalls the marker
  })
})
