/**
 * S128 — the A1 Greptile fix batch on the use ledger (PR #1162 review 5479895129).
 * F1 booking before pre-read · F2 the ONE hold check before a walk-in's first send
 * (incl. X1 simultaneous taps) · F3 the daily pass parks only lease-free rows ·
 * F5 the settle read rotates (last_attempt_at NULLS FIRST) + the capped count is a
 * floor · F4 a malformed gestureAt never reaches the timestamptz column.
 * Core is faked at the SDK boundary; the store honours the CAS semantics, the
 * listOpen orders, and (F4) the timestamptz shape of gesture_at_client.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://placeholder.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service'

jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import {
  attemptIntent, preReadMatch, recordUse, settlePending, supabaseLedgerStore,
  PARK_AFTER_MS, SETTLE_ROWS_PER_BUSINESS, MAX_CALLER_DURATION_MS,
  type IntentRow, type LedgerStore, type Where,
} from '@/lib/packs/use-ledger'

const B = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-20T03:00:00.000Z') // 12:00 JST, after the jest cutover day
const TODAY = '2026-10-20'
const CUT = '2026-10-11'
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

type Mem = LedgerStore & { rows: IntentRow[] }
function memStore(): Mem {
  const rows: IntentRow[] = []
  const nullsFirst = (a?: string | null, b?: string | null) => (a ?? '') < (b ?? '') ? -1 : (a ?? '') > (b ?? '') ? 1 : 0
  return {
    rows,
    async insertIgnore(row) {
      // timestamptz: Postgres rejects a non-parseable gesture_at_client (S128 F4)
      if (row.gesture_at_client != null && !Number.isFinite(Date.parse(row.gesture_at_client))) {
        throw new Error(`invalid input syntax for type timestamp with time zone: "${row.gesture_at_client}"`)
      }
      // S128 G2: the extended ISO year form ("+010000-…") is refused too
      if (row.gesture_at_client != null && /^[+-]/.test(row.gesture_at_client)) {
        throw new Error(`timestamp out of range: "${row.gesture_at_client}"`)
      }
      if (!rows.some((r) => r.business_id === row.business_id && r.id === row.id)) rows.push({ ...row, created_at: row.created_at ?? NOW.toISOString() })
    },
    async getAllById(id) { return rows.filter((r) => r.id === id).map((r) => ({ ...r })) },
    async update(b: string, id: string, w: Where, patch: Partial<IntentRow>) {
      const r = rows.find((x) => x.business_id === b && x.id === id)
      if (!r || r.state !== w.state) return null
      if (w.attempts !== undefined && r.attempts !== w.attempts) return null
      if (w.settledCoreId !== undefined && r.settled_core_id !== w.settledCoreId) return null
      if (w.leaseFreeAt && r.leased_until && !(r.leased_until < w.leaseFreeAt)) return null
      if (w.leasedUntilEq !== undefined && (r.leased_until ?? null) !== w.leasedUntilEq) return null
      Object.assign(r, patch)
      return { ...r }
    },
    async listForCustomers(b, ids) {
      return rows.filter((r) => r.business_id === b && ids.includes(r.customer_id) &&
        ['held', 'pending', 'parked', 'refused'].includes(r.state) && !r.staff_resolution).map((r) => ({ ...r }))
    },
    async listOpen(b, states, limit, order) {
      return rows.filter((r) => r.business_id === b && states.includes(r.state))
        .sort((x, y) => (order === 'retry' ? nullsFirst(x.last_attempt_at, y.last_attempt_at) : 0) ||
          nullsFirst(x.created_at, y.created_at) || nullsFirst(x.id, y.id))
        .slice(0, limit).map((r) => ({ ...r }))
    },
    async listOpenBusinessIds(states) { return [...new Set(rows.filter((r) => states.includes(r.state)).map((r) => r.business_id))] },
    async claimedCoreIds(b, ids) { return new Map(rows.filter((r) => r.business_id === b && r.settled_core_id && ids.includes(r.settled_core_id)).map((r) => [r.settled_core_id as string, r.id])) },
  }
}

const coreErr = (status: number, message: string) => Object.assign(new Error(message), { status })
function fakeCore(opts: { recent?: unknown[]; appts?: unknown[] | Error } = {}) {
  let n = 0
  return {
    packs: {
      addRedemption: jest.fn().mockImplementation(async () => ({ id: `core-${++n}` })),
      listRecentRedemptions: jest.fn().mockResolvedValue(opts.recent ?? []),
    },
    appointments: {
      list: opts.appts instanceof Error ? jest.fn().mockRejectedValue(opts.appts) : jest.fn().mockResolvedValue({ appointments: opts.appts ?? [] }),
    },
  }
}
const deps = (store: LedgerStore, core: ReturnType<typeof fakeCore>, now: () => Date = () => NOW) => ({ store, synqed: core as never, now })

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  const appt = over.appointment_id === undefined ? null : over.appointment_id
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001', business_id: B, owner_user_id: null, kind: 'use',
    ledger_source: 'manual', core_source: 'manual', customer_id: 'cust-1', pack_id: 'pack-A', pack_picked_by: 'staff',
    appointment_id: appt, appointment_resolved: true, gesture_at: NOW.toISOString(), gesture_at_client: null, clock_suspect: false,
    redeemed_on: TODAY, counts_as_visit: null, another_session: false, audit_payload: null, state: 'pending', attempts: 0,
    frozen_payload: { pack_id: 'pack-A', customer_id: 'cust-1', redeemed_on: TODAY, appointment_id: appt, karute_record_id: null, source: 'manual', created_by: null },
    ...over,
  }
}
const alarms = (spy: jest.SpyInstance, kind: string) =>
  spy.mock.calls.filter((c) => String(c[1]).includes(`"kind":"${kind}"`)).map((c) => JSON.parse(String(c[1])))

describe('S128 A1 Greptile fixes', () => {
  let err: jest.SpyInstance
  beforeEach(() => { err = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { err.mockRestore() })

  test('F2 (a) · booking lookup throws at write → null at a later attempt, an EARLIER open same-day walk-in exists → held, core never called', async () => {
    const store = memStore(); const core = fakeCore({ appts: new Error('appointments down') })
    // the earlier use: open (pending, mid-lease of its own), same customer, same JST day
    const earlier = intentRow({ id: 'eeeeeeee-0000-4000-8000-000000000001', created_at: ago(60_000), attempts: 1, leased_until: new Date(NOW.getTime() + 60_000).toISOString() })
    await store.insertIgnore(earlier)
    const r = await recordUse(deps(store, core), { businessId: B, ownerUserId: null, staffId: null, customerId: 'cust-1', packId: 'pack-A', appointmentId: undefined })
    expect(r).toMatchObject({ ok: true, state: 'pending' }) // the write-time check could not run (booking unknown)
    const mine = store.rows.find((x) => x.id === r.intentId) as IntentRow
    expect(mine).toMatchObject({ appointment_resolved: false, last_error_code: 'booking_lookup_unknown' })
    core.appointments.list.mockResolvedValue({ appointments: [] }) // the booking lookup now answers: no booking → walk-in
    const out = await attemptIntent(deps(store, core), mine)
    expect(out).toMatchObject({ state: 'held', held_against: earlier.id, appointment_id: null, appointment_resolved: true, leased_until: null })
    expect(core.packs.addRedemption).not.toHaveBeenCalled()
  })

  test('F2 (b) · X1: two walk-in rows inserted in the same ms → the earlier (created_at, then id) sends, the later holds', async () => {
    const store = memStore(); const core = fakeCore()
    const a = intentRow({ id: 'bbbbbbbb-0000-4000-8000-000000000001', created_at: NOW.toISOString() })
    const b = intentRow({ id: 'bbbbbbbb-0000-4000-8000-000000000002', created_at: NOW.toISOString() })
    await store.insertIgnore(a); await store.insertIgnore(b)
    // both taps' attempts run at once: each reads the other as open
    const [outB, outA] = await Promise.all([attemptIntent(deps(store, core), b), attemptIntent(deps(store, core), a)])
    expect(outA).toMatchObject({ state: 'settled', settled_core_id: 'core-1' })
    expect(outB).toMatchObject({ state: 'held', held_against: a.id })
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(1)
    expect(core.packs.addRedemption.mock.calls[0][1]).toEqual({ idempotencyKey: a.id })
  })

  test('F2 (c) · a row carrying the another_session answer still sends past an earlier open same-day walk-in', async () => {
    const store = memStore(); const core = fakeCore()
    const earlier = intentRow({ id: 'cccccccc-0000-4000-8000-000000000001', created_at: ago(60_000), attempts: 1, leased_until: new Date(NOW.getTime() + 60_000).toISOString() })
    const answered = intentRow({ id: 'cccccccc-0000-4000-8000-000000000002', another_session: true })
    await store.insertIgnore(earlier); await store.insertIgnore(answered)
    expect(await attemptIntent(deps(store, core), answered)).toMatchObject({ state: 'settled', settled_core_id: 'core-1' })
    const r = await recordUse(deps(store, core), { businessId: B, ownerUserId: null, staffId: null, customerId: 'cust-1', packId: 'pack-A', appointmentId: null, anotherSession: true })
    expect(r).toMatchObject({ ok: true, state: 'settled', redemptionId: 'core-2' })
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(2)
  })

  test('F1 · an unresolved replay + an unclaimed null-appointment core row → stays pending: no pre-read, no match, no send', async () => {
    const store = memStore()
    const core = fakeCore({ appts: new Error('appointments down'), recent: [{ id: 'core-W', customer_id: 'cust-1', appointment_id: null, redeemed_on: TODAY, source: 'manual' }] })
    const row = intentRow({ id: 'dddddddd-0000-4000-8000-000000000001', appointment_resolved: false, frozen_payload: null, attempts: 1,
      audit_payload: { draft_payload: intentRow().frozen_payload } })
    await store.insertIgnore(row)
    const out = await attemptIntent(deps(store, core), row)
    expect(out).toMatchObject({ state: 'pending', last_error_code: 'booking_lookup_unknown', leased_until: null, appointment_resolved: false })
    expect(out.settled_core_id ?? null).toBeNull()
    expect(core.packs.listRecentRedemptions).not.toHaveBeenCalled()
    expect(core.packs.addRedemption).not.toHaveBeenCalled()
    // the guard itself: the same core row matches a RESOLVED walk-in, never an unresolved one
    const recent = [{ id: 'core-W', customer_id: 'cust-1', appointment_id: null, redeemed_on: TODAY, source: 'manual' }]
    expect(preReadMatch(row, recent, new Set(), TODAY, CUT)).toBeNull()
    expect(preReadMatch({ ...row, appointment_resolved: true }, recent, new Set(), TODAY, CUT)).toBe('core-W')
  })

  test('F3 · the daily pass never parks a row whose lease is live (another sender mid-flight); a lease-free one is parked', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValue(coreErr(500, 'boom')) // answered → the attempt frees its own lease
    const old = ago(PARK_AFTER_MS + 1_000)
    const leased = intentRow({ id: 'ffffffff-0000-4000-8000-000000000001', appointment_id: 'appt-1', created_at: old, attempts: 1,
      last_attempt_at: ago(1_000), leased_until: new Date(NOW.getTime() + 60_000).toISOString() })
    const free = intentRow({ id: 'ffffffff-0000-4000-8000-000000000002', appointment_id: 'appt-2', created_at: old, attempts: 1, last_attempt_at: ago(PARK_AFTER_MS) })
    await store.insertIgnore(leased); await store.insertIgnore(free)
    const s = await settlePending({ store, clientFor: () => core as never, rotate: (ids) => [...ids], dailyPass: true, now: () => NOW })
    expect(store.rows.find((r) => r.id === leased.id)).toMatchObject({ state: 'pending', attempts: 1, leased_until: leased.leased_until })
    expect(store.rows.find((r) => r.id === free.id)).toMatchObject({ state: 'parked', parked_reason: 'http_500' })
    expect(s.parked).toBe(1)
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(1)
  })

  test('F5 · 201 open rows: the 201st is reached on the second pass; the capped open count is reported as a floor', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValue(coreErr(500, 'boom'))
    const N = SETTLE_ROWS_PER_BUSINESS + 1
    for (let i = 0; i < N; i += 1) {
      // oldest first; the 201st is the newest, still older than any caller
      await store.insertIgnore(intentRow({ id: `55555555-0000-4000-8000-${String(i).padStart(12, '0')}`, appointment_id: `appt-${i}`,
        created_at: ago(MAX_CALLER_DURATION_MS + (N - i) * 1_000) }))
    }
    const last = store.rows[N - 1].id
    const pass = (at: Date) => settlePending({ store, clientFor: () => core as never, rotate: (ids) => [...ids], dailyPass: false, now: () => at })
    const s1 = await pass(NOW)
    expect(s1.attempted).toBe(SETTLE_ROWS_PER_BUSINESS)
    expect(store.rows.find((r) => r.id === last)?.attempts).toBe(0)
    const open1 = alarms(err, 'ledger.open_at_pass')[0]
    expect(open1.facts).toMatchObject({ count: SETTLE_ROWS_PER_BUSINESS, count_is_floor: true, top: [{ b: B, n: SETTLE_ROWS_PER_BUSINESS, at_least: true }] })
    expect(open1.facts.worst).toBe(store.rows[0].created_at) // the oldest read keeps created_at order
    await pass(new Date(NOW.getTime() + 3_600_000))
    expect(store.rows.find((r) => r.id === last)?.attempts).toBe(1)

    // the adapter's two orders, as sent to PostgREST
    const calls: unknown[][] = []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'limit']) q[m] = () => q
    q.order = (...a: unknown[]) => { calls.push(a); return q }
    Object.defineProperty(q, 'then', { value: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res) })
    const adapter = supabaseLedgerStore({ from: () => q } as never)
    await adapter.listOpen(B, ['pending'], 200, 'retry')
    expect(calls).toEqual([['last_attempt_at', { ascending: true, nullsFirst: true }], ['created_at', { ascending: true }], ['id', { ascending: true }]])
    calls.length = 0
    await adapter.listOpen(B, ['pending'], 200, 'oldest')
    expect(calls).toEqual([['created_at', { ascending: true }], ['id', { ascending: true }]])
  })

  test('F4 · a malformed gestureAt → row written, gesture_at_client null, raw text in audit_payload, clock_suspect alarm, the send proceeds', async () => {
    const store = memStore(); const core = fakeCore()
    await expect(store.insertIgnore(intentRow({ id: 'probe', gesture_at_client: 'not-a-date' }))).rejects.toThrow(/timestamp with time zone/)
    const r = await recordUse(deps(store, core), { businessId: B, ownerUserId: null, staffId: null, customerId: 'cust-2', packId: 'pack-A', appointmentId: null, gestureAt: 'not-a-date' })
    expect(r).toMatchObject({ ok: true, state: 'settled', redemptionId: 'core-1' })
    expect(store.rows.find((x) => x.id === r.intentId)).toMatchObject({
      gesture_at: NOW.toISOString(), gesture_at_client: null, clock_suspect: true, audit_payload: { gesture_at_client: 'not-a-date' },
    })
    expect(alarms(err, 'ledger.clock_suspect')[0]).toMatchObject({ ref: r.intentId, facts: { gesture_at_client: 'not-a-date' } })
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(1)
  })

  test('G1 · daily pass: an UNANSWERED row (its own live lease from this pass) IS parked; another sender\'s lease is NOT; a free-lease old row IS', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockImplementation(async (p: { appointment_id?: string }) => {
      if (p.appointment_id === 'appt-u') throw new Error('socket hang up') // no status → UNANSWERED: the attempt keeps its lease
      throw coreErr(500, 'boom') // answered → the attempt frees its lease
    })
    const old = ago(PARK_AFTER_MS + 1_000)
    const unanswered = intentRow({ id: 'eeeeeeee-0000-4000-8000-000000000001', appointment_id: 'appt-u', created_at: old, attempts: 1, last_attempt_at: ago(PARK_AFTER_MS) })
    const held = intentRow({ id: 'eeeeeeee-0000-4000-8000-000000000002', appointment_id: 'appt-h', created_at: old, attempts: 1,
      last_attempt_at: ago(1_000), leased_until: new Date(NOW.getTime() + 60_000).toISOString() })
    const free = intentRow({ id: 'eeeeeeee-0000-4000-8000-000000000003', appointment_id: 'appt-f', created_at: old, attempts: 1, last_attempt_at: ago(PARK_AFTER_MS) })
    for (const r of [unanswered, held, free]) await store.insertIgnore(r)
    const s = await settlePending({ store, clientFor: () => core as never, rotate: (ids) => [...ids], dailyPass: true, now: () => NOW })
    expect(store.rows.find((r) => r.id === unanswered.id)).toMatchObject({ state: 'parked', attempts: 2 })
    expect(store.rows.find((r) => r.id === held.id)).toMatchObject({ state: 'pending', attempts: 1, leased_until: held.leased_until })
    expect(store.rows.find((r) => r.id === free.id)).toMatchObject({ state: 'parked', parked_reason: 'http_500' })
    expect(s.parked).toBe(2)
    expect(alarms(err, 'ledger.parked').map((a) => a.ref).sort()).toEqual([unanswered.id, free.id].sort())
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(2)
  })

  test('G1 (b) · this pass leased + UNANSWERED, then another sender takes a different lease before the park → NOT parked', async () => {
    const base = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValue(new Error('socket hang up'))
    const other = new Date(NOW.getTime() + 999_000).toISOString()
    const store: Mem = { ...base, rows: base.rows, async update(b, id, w, patch) {
      if (patch.state === 'parked') { const r = base.rows.find((x) => x.id === id); if (r) r.leased_until = other } // the other sender wins in between
      return base.update(b, id, w, patch)
    } }
    const row = intentRow({ id: 'eeeeeeee-0000-4000-8000-000000000004', appointment_id: 'appt-u', created_at: ago(PARK_AFTER_MS + 1_000), attempts: 1, last_attempt_at: ago(PARK_AFTER_MS) })
    await store.insertIgnore(row)
    const s = await settlePending({ store, clientFor: () => core as never, rotate: (ids) => [...ids], dailyPass: true, now: () => NOW })
    expect(store.rows.find((r) => r.id === row.id)).toMatchObject({ state: 'pending', attempts: 2, leased_until: other })
    expect(s.parked).toBe(0)
    expect(alarms(err, 'ledger.parked')).toHaveLength(0)
  })

  test('G2 · gestureAt at the max JS date (+275760) → gesture_at_client null, row written, raw text in audit_payload, clock_suspect', async () => {
    const store = memStore(); const core = fakeCore()
    const far = '+275760-09-13T00:00:00.000Z'
    const r = await recordUse(deps(store, core), { businessId: B, ownerUserId: null, staffId: null, customerId: 'cust-3', packId: 'pack-A', appointmentId: null, gestureAt: far })
    expect(r).toMatchObject({ ok: true, state: 'settled' })
    expect(store.rows.find((x) => x.id === r.intentId)).toMatchObject({
      gesture_at: NOW.toISOString(), gesture_at_client: null, clock_suspect: true, audit_payload: { gesture_at_client: far },
    })
  })
})
