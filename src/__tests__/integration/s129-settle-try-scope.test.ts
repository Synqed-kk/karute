/**
 * S129 — settlePending's per-row try now covers the parked→pending resume
 * update, the attempt and the park update (daily pass). A DB error on the
 * resume or the park write is alarmed ledger.attempt_threw (facts.stage) and the
 * row is skipped; the pass continues, the end-of-pass read runs and the
 * ledger.open_at_pass alarm still fires. Core faked at the SDK boundary; the
 * ledger is the in-memory fake store with a wrapped update that throws.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://placeholder.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service'

jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import { settlePending, PARK_AFTER_MS, type IntentRow, type LedgerStore } from '@/lib/packs/use-ledger'
import { memLedgerStore } from './helpers/ledger-fake'

const B = '00000000-0000-4000-8000-0000000001b9'
const NOW = new Date('2026-10-20T03:00:00.000Z') // after the jest cutover day
const TODAY = '2026-10-20'
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const OLD = ago(PARK_AFTER_MS + 1_000)
const A_ID = 'a1290000-0000-4000-8000-00000000000a'
const B_ID = 'a1290000-0000-4000-8000-00000000000b'

function intentRow(over: Partial<IntentRow> & { customer_id: string; appointment_id: string }): IntentRow {
  return {
    id: A_ID, business_id: B, owner_user_id: null, kind: 'use',
    ledger_source: 'manual', core_source: 'manual', pack_id: 'pack-A', pack_picked_by: 'staff',
    appointment_resolved: true, gesture_at: OLD, gesture_at_client: null, clock_suspect: false,
    redeemed_on: TODAY, counts_as_visit: null, another_session: false, audit_payload: null, state: 'pending', attempts: 0,
    frozen_payload: { pack_id: 'pack-A', customer_id: over.customer_id, redeemed_on: TODAY, appointment_id: over.appointment_id, karute_record_id: null, source: 'manual', created_by: null },
    created_at: OLD,
    ...over,
  }
}

/** appt-a: no status (socket hang up) → UNANSWERED, the row stays pending; anything else is sent and settles. */
function fakeCore() {
  let n = 0
  const addRedemption = jest.fn().mockImplementation(async (p: { appointment_id?: string }) => {
    if (p.appointment_id === 'appt-a') throw new Error('socket hang up')
    return { id: `core-${++n}` }
  })
  return {
    addRedemption,
    synqed: {
      packs: { addRedemption, listRecentRedemptions: jest.fn().mockResolvedValue([]) },
      appointments: { list: jest.fn().mockResolvedValue({ appointments: [] }) },
    },
  }
}

const alarmsOf = (spy: jest.SpyInstance, kind: string) =>
  spy.mock.calls.filter((c) => c[0] === '[alarm]').map((c) => JSON.parse(String(c[1]))).filter((a) => a.kind === kind)

type Throws = (id: string, w: Parameters<LedgerStore['update']>[2], patch: Partial<IntentRow>) => boolean
function throwingStore(throws: Throws): LedgerStore {
  const base = memLedgerStore()
  return {
    ...base,
    async update(b, id, w, patch) {
      if (throws(id, w, patch)) throw new Error('db write failed')
      return base.update(b, id, w, patch)
    },
  }
}

const resumeThrows: Throws = (id, w, patch) => id === A_ID && w.state === 'parked' && patch.state === 'pending'

async function runResumeThrows() {
  const store = throwingStore(resumeThrows)
  await store.insertIgnore(intentRow({ id: A_ID, customer_id: 'cust-a', appointment_id: 'appt-p', state: 'parked', attempts: 3, last_attempt_at: OLD, parked_at: OLD, parked_reason: 'http_500' }))
  await store.insertIgnore(intentRow({ id: B_ID, customer_id: 'cust-b', appointment_id: 'appt-b' }))
  const core = fakeCore()
  const pass = settlePending({ store, clientFor: () => core.synqed as never, rotate: (ids) => [...ids], dailyPass: true, now: () => NOW })
  return { store, core, pass }
}

describe('S129 — settlePending per-row try covers resume, attempt and park', () => {
  let err: jest.SpyInstance
  beforeEach(() => { err = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { err.mockRestore() })

  test('1 · RESUME THROWS: the parked row is alarmed (stage resume) and left parked; the other customer settles; open_at_pass fires', async () => {
    const { store, core, pass } = await runResumeThrows()
    await expect(pass).resolves.toMatchObject({ businesses: 1, attempted: 1, settled: 1, parked: 0 })
    const threw = alarmsOf(err, 'ledger.attempt_threw')
    expect(threw).toHaveLength(1)
    expect(threw[0]).toMatchObject({ business_id: B, ref: A_ID, facts: { error: 'db write failed', stage: 'resume' } })
    const [a] = await store.getAllById(A_ID); const [b] = await store.getAllById(B_ID)
    expect(a).toMatchObject({ state: 'parked', attempts: 3 })
    expect(b).toMatchObject({ state: 'settled', settled_core_id: 'core-1' })
    expect(core.addRedemption).toHaveBeenCalledTimes(1)
    const open = alarmsOf(err, 'ledger.open_at_pass')
    expect(open).toHaveLength(1)
    expect(open[0].facts).toMatchObject({ count: 1, top: [{ b: B, n: 1 }] })
  })

  test('2 · PARK THROWS: the unanswered old row is attempted then alarmed (stage park) and stays pending; the other customer settles; open_at_pass fires', async () => {
    const store = throwingStore((_id, _w, patch) => patch.state === 'parked')
    await store.insertIgnore(intentRow({ id: A_ID, customer_id: 'cust-a', appointment_id: 'appt-a', attempts: 1, last_attempt_at: OLD }))
    await store.insertIgnore(intentRow({ id: B_ID, customer_id: 'cust-b', appointment_id: 'appt-b' }))
    const core = fakeCore()
    const pass = settlePending({ store, clientFor: () => core.synqed as never, rotate: (ids) => [...ids], dailyPass: true, now: () => NOW })
    await expect(pass).resolves.toMatchObject({ businesses: 1, attempted: 2, settled: 1, parked: 0 })
    const threw = alarmsOf(err, 'ledger.attempt_threw')
    expect(threw).toHaveLength(1)
    expect(threw[0]).toMatchObject({ business_id: B, ref: A_ID, facts: { error: 'db write failed', stage: 'park' } })
    expect(alarmsOf(err, 'ledger.parked')).toHaveLength(0)
    const [a] = await store.getAllById(A_ID); const [b] = await store.getAllById(B_ID)
    expect(a).toMatchObject({ state: 'pending', attempts: 2 })
    expect(b).toMatchObject({ state: 'settled', settled_core_id: 'core-1' })
    expect(core.addRedemption).toHaveBeenCalledTimes(2)
    const open = alarmsOf(err, 'ledger.open_at_pass')
    expect(open).toHaveLength(1)
    expect(open[0].facts).toMatchObject({ count: 1, top: [{ b: B, n: 1 }] })
  })

  test('3 · GUARD (pre-S129 shape rejected the pass on a resume-update throw): the pass resolves, alarms, and the other customer still settles', async () => {
    const { store, pass } = await runResumeThrows()
    const sum = await pass // the old code rejected here (the throw sat outside the per-row try)
    expect(sum).toMatchObject({ attempted: 1, settled: 1 })
    expect(alarmsOf(err, 'ledger.attempt_threw').map((a) => a.facts.stage)).toEqual(['resume'])
    const [b] = await store.getAllById(B_ID)
    expect(b).toMatchObject({ state: 'settled' })
  })
})
