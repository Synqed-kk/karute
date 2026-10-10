/**
 * S125 PR-A — the use ledger (design v4.2). Core is faked at the SDK boundary
 * (packs.addRedemption / listRecentRedemptions, appointments.list); the ledger
 * table is an in-memory store that honours the CAS semantics of the real
 * conditional UPDATE … WHERE state = <prior> … RETURNING.
 * Numbers in the test names = the packet's § A7 list.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://placeholder.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service'

jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import {
  attemptIntent, classifyCoreFailure, displayRemaining, preReadMatch, readLedgerUsage, recordUse,
  settlePending, usageFromRows, cutoverDay, MAX_HOLD_MS, CLOCK_SKEW_MS, REPLAY_LEASE_MS,
  type IntentRow, type LedgerStore, type Where,
} from '@/lib/packs/use-ledger'

const B = '11111111-1111-4111-8111-111111111111'
const B2 = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-10-20T03:00:00.000Z') // 12:00 JST, after CUTOVER_DAY
const TODAY = '2026-10-20'
const CUT = '2026-10-11' // jest.config.ts sets KARUTE_LEDGER_CUTOVER_DAY to this day

function memStore(): LedgerStore & { rows: IntentRow[]; failNext?: boolean; failReads?: boolean } {
  const rows: IntentRow[] = []
  const st: LedgerStore & { rows: IntentRow[]; failNext?: boolean; failReads?: boolean } = {
    rows,
    async insertIgnore(row: IntentRow) {
      if (st.failNext) throw new Error('db down')
      if (!rows.some((r) => r.business_id === row.business_id && r.id === row.id)) {
        rows.push({ ...row, created_at: row.created_at ?? NOW.toISOString() })
      }
    },
    async getAllById(id: string) { if (st.failReads) throw new Error('db down'); return rows.filter((r) => r.id === id).map((r) => ({ ...r })) },
    async update(b: string, id: string, w: Where, patch: Partial<IntentRow>) {
      const r = rows.find((x) => x.business_id === b && x.id === id)
      if (!r || r.state !== w.state) return null
      if (w.attempts !== undefined && r.attempts !== w.attempts) return null
      if (w.leaseFreeAt && r.leased_until && !(r.leased_until < w.leaseFreeAt)) return null
      if (patch.settled_core_id && rows.some((x) => x !== r && x.business_id === b && x.settled_core_id === patch.settled_core_id)) {
        throw new Error('duplicate key value violates unique constraint "pack_use_intents_settled_core_unique"')
      }
      Object.assign(r, patch)
      return { ...r }
    },
    async listForCustomers(b: string, ids: string[]) {
      if (st.failReads) throw new Error('db down')
      return rows.filter((r) => r.business_id === b && ids.includes(r.customer_id) &&
        ['held', 'pending', 'parked', 'refused'].includes(r.state) && !r.staff_resolution).map((r) => ({ ...r }))
    },
    async listOpen(b: string, states: IntentRow['state'][], limit: number) {
      return rows.filter((r) => r.business_id === b && states.includes(r.state)).slice(0, limit).map((r) => ({ ...r }))
    },
    async listOpenBusinessIds(states: IntentRow['state'][]) { return [...new Set(rows.filter((r) => states.includes(r.state)).map((r) => r.business_id))] },
    async claimedCoreIds(b: string, ids: string[]) { return new Set(rows.filter((r) => r.business_id === b && r.settled_core_id && ids.includes(r.settled_core_id)).map((r) => r.settled_core_id as string)) },
  }
  return st
}

const coreErr = (status: number, message: string, extra: { code?: string; body?: Record<string, unknown> } = {}) =>
  Object.assign(new Error(message), { status, ...extra })

function fakeCore(opts: { recent?: unknown[]; appts?: unknown[] | Error } = {}) {
  return {
    packs: {
      addRedemption: jest.fn().mockResolvedValue({ id: 'core-1' }),
      listRecentRedemptions: jest.fn().mockResolvedValue(opts.recent ?? []),
    },
    appointments: {
      list: opts.appts instanceof Error ? jest.fn().mockRejectedValue(opts.appts) : jest.fn().mockResolvedValue({ appointments: opts.appts ?? [] }),
    },
  }
}

const walkIn = (over: Partial<Parameters<typeof recordUse>[1]> = {}) => ({
  businessId: B, ownerUserId: null, staffId: 'staff-1', customerId: 'cust-1', packId: 'pack-A', appointmentId: null, ...over,
})
const deps = (store: LedgerStore, synqed: ReturnType<typeof fakeCore>, extra = {}) =>
  ({ store, synqed: synqed as never, now: () => NOW, ...extra })

describe('S125 use ledger — the numbered list', () => {
  test('1 · 503 database schema mismatch → pending, alarm, never refused', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValue(coreErr(503, 'database schema mismatch'))
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    const r = await recordUse(deps(store, core), walkIn())
    expect(r).toMatchObject({ ok: true, state: 'pending' })
    expect(store.rows[0]).toMatchObject({ state: 'pending', attempts: 1, last_error_status: 503, last_error_code: 'http_503' })
    expect(err.mock.calls.some((c) => String(c[1]).includes('ledger.attempt_unproven'))).toBe(true)
    err.mockRestore()
  })

  test('2 · 409 no units: staff-picked → refused:no_units; system-picked → re-pick, only no-pack-with-units refuses', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValue(coreErr(409, 'Pack has no remaining units'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const r = await recordUse(deps(store, core), walkIn())
    expect(r).toMatchObject({ ok: false, state: 'refused', error: 'below_zero' })
    expect(store.rows[0]).toMatchObject({ state: 'refused', refused_code: 'no_units' })

    const s2 = memStore(); const c2 = fakeCore()
    c2.packs.addRedemption.mockRejectedValueOnce(coreErr(409, 'Pack has no remaining units')).mockResolvedValueOnce({ id: 'core-B' })
    const row = sysRow({ id: 'aaaaaaaa-0000-4000-8000-000000000002' }); await s2.insertIgnore(row)
    const out = await attemptIntent({ store: s2, synqed: c2 as never, now: () => NOW, repick: async (_r, tried) => (tried.has('pack-B') ? null : 'pack-B') }, row)
    expect(out).toMatchObject({ state: 'settled', settled_core_id: 'core-B', pack_id: 'pack-B' })
    expect(s2.rows[0]).toMatchObject({ repicked_from: 'pack-A', frozen_payload: { pack_id: 'pack-A' }, repick_payload: { pack_id: 'pack-B' } })
    expect(c2.packs.addRedemption.mock.calls[1][0].pack_id).toBe('pack-B')
    expect(c2.packs.addRedemption.mock.calls[1][1]).toEqual({ idempotencyKey: row.id })

    const s3 = memStore(); const c3 = fakeCore()
    c3.packs.addRedemption.mockRejectedValue(coreErr(409, 'Pack has no remaining units'))
    const row3 = sysRow({ id: 'aaaaaaaa-0000-4000-8000-000000000003' }); await s3.insertIgnore(row3)
    const out3 = await attemptIntent({ store: s3, synqed: c3 as never, now: () => NOW, repick: async () => null }, row3)
    expect(out3).toMatchObject({ state: 'refused', refused_code: 'no_units' })
    jest.restoreAllMocks()
  })

  test('3 · 503 IDEMPOTENT_IN_FLIGHT → pending, Retry-After honoured as the lease', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValue(coreErr(503, 'in flight', { code: 'IDEMPOTENT_IN_FLIGHT', body: { retry_after: 7 } }))
    const r = await recordUse(deps(store, core), walkIn())
    expect(r.state).toBe('pending')
    expect(store.rows[0].leased_until).toBe(new Date(NOW.getTime() + 7000).toISOString())
    expect(classifyCoreFailure({ ok: false, error: 'x', status: 503, message: 'x', body: { code: 'IDEMPOTENT_IN_FLIGHT' } }, false))
      .toMatchObject({ kind: 'pending', code: 'idempotent_in_flight', alarm: false })
  })

  test('4 · index violation on a BOOKED replay → R4 read → settled to the row', async () => {
    const store = memStore()
    const core = fakeCore({ recent: [{ id: 'core-x', customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: TODAY, source: 'manual' }] })
    core.packs.addRedemption.mockRejectedValue(coreErr(500, 'Unique constraint failed P2002 pack_redemptions_active_appointment_unique'))
    const r = await recordUse(deps(store, core), walkIn({ appointmentId: 'appt-1' }))
    expect(r).toMatchObject({ ok: true, state: 'settled', redemptionId: 'core-x' })
    expect(store.rows[0].resolved_by).toBe('matched:core-x')
  })

  test('5 · 200 replay with id → settled; a settled row answers from the row without core', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockResolvedValue({ id: 'core-replayed' })
    const id = 'aaaaaaaa-0000-4000-8000-000000000005'
    const r1 = await recordUse(deps(store, core), walkIn({ intentId: id }))
    expect(r1).toMatchObject({ ok: true, state: 'settled', redemptionId: 'core-replayed', intentId: id })
    const r2 = await recordUse(deps(store, core), walkIn({ intentId: id, packId: 'pack-OTHER' }))
    expect(r2).toMatchObject({ state: 'settled', redemptionId: 'core-replayed' })
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(1)
    expect(core.packs.addRedemption.mock.calls[0][1]).toEqual({ idempotencyKey: id })
  })

  test('6 · R4 pre-read inside min(redeemed_on, gesture day): booked + walk-in + CUTOVER_DAY + pre-cutover backfill (fix 2)', () => {
    const base = sysRow({ gesture_at: NOW.toISOString(), redeemed_on: '2026-10-18', appointment_id: null })
    const rows = [
      { id: 'r-cut', customer_id: 'cust-1', appointment_id: null, redeemed_on: CUT, source: 'manual' },
      { id: 'r-old', customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-10-17', source: 'manual' },
      { id: 'r-in', customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-10-18', source: 'backfill' },
      { id: 'r-qr', customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-10-19', source: 'qr' },
    ]
    expect(preReadMatch(base, rows, new Set(), TODAY, CUT)).toBe('r-in')           // backfill dated before the gesture day
    expect(preReadMatch(base, rows, new Set(['r-in']), TODAY, CUT)).toBeNull()     // claimed rows excluded; qr never
    const booked = { ...base, appointment_id: 'appt-9' }
    expect(preReadMatch(booked, [{ id: 'b', customer_id: 'cust-1', appointment_id: 'appt-9', redeemed_on: '2026-10-18', source: 'auto' }], new Set(), TODAY, CUT)).toBe('b')
    expect(preReadMatch(booked, [rows[0]], new Set(), TODAY, CUT)).toBeNull()      // the deploy day itself excluded
    const pre = { ...base, redeemed_on: '2026-10-05' }                       // pre-cutover backfill of an old visit
    expect(preReadMatch(pre, [{ id: 'orphan', customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-10-05', source: 'backfill' }], new Set(), TODAY, CUT)).toBe('orphan')
    expect(preReadMatch(pre, [{ id: 'other', customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-10-06', source: 'backfill' }], new Set(), TODAY, CUT)).toBeNull()
  })

  test('7 · ledger insert failure (P1): no core call, the device-held shape', async () => {
    const store = memStore(); store.failNext = true; const core = fakeCore()
    const r = await recordUse(deps(store, core), walkIn())
    expect(r).toMatchObject({ ok: false, error: 'ledger_unavailable' })
    expect(r.intentId).toBeTruthy()
    expect(core.packs.addRedemption).not.toHaveBeenCalled()
  })

  test('8 · monotonic states + lease race: two senders, one core call', async () => {
    const store = memStore(); const core = fakeCore()
    let release!: (v: { id: string }) => void
    core.packs.addRedemption.mockImplementation(() => new Promise((res) => { release = res }))
    const row = sysRow({ id: 'aaaaaaaa-0000-4000-8000-000000000008', pack_picked_by: 'staff' }); await store.insertIgnore(row)
    const a = attemptIntent({ store, synqed: core as never, now: () => NOW }, row)
    const b = await attemptIntent({ store, synqed: core as never, now: () => NOW }, row)
    expect(b.state).toBe('pending') // no lease → ack from the row
    await new Promise((r) => setImmediate(r)); release({ id: 'core-8' })
    expect((await a).state).toBe('settled')
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(1)
    expect(await store.update(B, row.id, { state: 'pending' }, { state: 'refused' })).toBeNull() // settled never goes back
    // a later sender inside REPLAY_LEASE_MS of an UNANSWERED attempt does not send either
    const s2 = memStore(); const c2 = fakeCore(); c2.packs.addRedemption.mockRejectedValue(new TypeError('fetch failed'))
    const r2 = sysRow({ id: 'aaaaaaaa-0000-4000-8000-000000000018', pack_picked_by: 'staff' }); await s2.insertIgnore(r2)
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const first = await attemptIntent({ store: s2, synqed: c2 as never, now: () => NOW }, r2)
    expect(first.leased_until).toBe(new Date(NOW.getTime() + REPLAY_LEASE_MS).toISOString())
    await attemptIntent({ store: s2, synqed: c2 as never, now: () => new Date(NOW.getTime() + 1000) }, first)
    expect(c2.packs.addRedemption).toHaveBeenCalledTimes(1)
    jest.restoreAllMocks()
  })

  test('9 · held: a second same-day walk-in gets state held as a 2xx-shaped ack; a BOOKED second use is NOT held (⚖ 8/21)', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValueOnce(coreErr(502, 'bad gateway'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const first = await recordUse(deps(store, core), walkIn())
    expect(first.state).toBe('pending')
    const second = await recordUse(deps(store, core), walkIn())
    expect(second).toMatchObject({ ok: true, state: 'held', heldAgainst: first.intentId })
    expect(core.packs.addRedemption).toHaveBeenCalledTimes(1)
    const booked = await recordUse(deps(store, core), walkIn({ appointmentId: 'appt-2' }))
    expect(booked.state).toBe('settled')
    const recovery = await recordUse(deps(store, core), walkIn({ recovery: true }))
    expect(recovery.state).toBe('held') // the gate covers every staff-initiated source
    jest.restoreAllMocks()
  })

  test('10 · another_session promotes held → pending and is sent at once', async () => {
    const store = memStore(); const core = fakeCore()
    core.packs.addRedemption.mockRejectedValueOnce(coreErr(502, 'bad gateway'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await recordUse(deps(store, core), walkIn())
    const held = await recordUse(deps(store, core), walkIn())
    const promoted = await recordUse(deps(store, core), walkIn({ intentId: held.intentId, anotherSession: true }))
    expect(promoted).toMatchObject({ ok: true, state: 'settled' })
    expect(store.rows.find((r) => r.id === held.intentId)).toMatchObject({ another_session: true, state: 'settled' })
    jest.restoreAllMocks()
  })

  test('11 · a refused-unresolved row never gates', async () => {
    const store = memStore(); const core = fakeCore()
    await store.insertIgnore(sysRow({ id: 'aaaaaaaa-0000-4000-8000-000000000011', state: 'refused', refused_code: 'no_units', redeemed_on: TODAY, appointment_id: null }))
    const r = await recordUse(deps(store, core), walkIn())
    expect(r.state).toBe('settled')
  })

  test('12 · booking lookup error → unknown → pending, never walk-in shaped', async () => {
    const store = memStore(); const core = fakeCore({ appts: new Error('appointments down') })
    const r = await recordUse(deps(store, core), walkIn({ appointmentId: undefined }))
    expect(r.state).toBe('pending')
    expect(store.rows[0]).toMatchObject({ appointment_resolved: false, last_error_code: 'booking_lookup_unknown' })
    expect(core.packs.addRedemption).not.toHaveBeenCalled()
    // the next attempt resolves the booking (gesture_at as "now") and freezes it
    core.appointments.list.mockResolvedValue({ appointments: [{ id: 'appt-7', status: 'BOOKED', starts_at: '2026-10-20T05:00:00.000Z' }] })
    const out = await attemptIntent({ store, synqed: core as never, now: () => NOW }, store.rows[0])
    expect(out).toMatchObject({ state: 'settled', appointment_id: 'appt-7' })
    expect(core.packs.addRedemption.mock.calls[0][0].appointment_id).toBe('appt-7')
  })

  test('13 · gesture_at outside [now − MAX_HOLD_MS, now + CLOCK_SKEW_MS] → server time + clock_suspect + alarm', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    for (const g of [new Date(NOW.getTime() - MAX_HOLD_MS - 1), new Date(NOW.getTime() + CLOCK_SKEW_MS + 1)]) {
      const store = memStore()
      await recordUse(deps(store, fakeCore()), walkIn({ gestureAt: g.toISOString() }))
      expect(store.rows[0]).toMatchObject({ gesture_at: NOW.toISOString(), clock_suspect: true, gesture_at_client: g.toISOString() })
    }
    const ok = memStore(); const inside = new Date(NOW.getTime() - 60_000).toISOString()
    await recordUse(deps(ok, fakeCore()), walkIn({ gestureAt: inside }))
    expect(ok.rows[0]).toMatchObject({ gesture_at: inside, clock_suspect: false })
    expect(err.mock.calls.filter((c) => String(c[1]).includes('ledger.clock_suspect'))).toHaveLength(2)
    err.mockRestore()
  })

  test('14 · a pending undo adds back in the count; pending + held subtract per pack_id', () => {
    const u = usageFromRows([
      sysRow({ id: 'u1', state: 'pending', pack_id: 'pack-A' }),
      sysRow({ id: 'u2', state: 'held', pack_id: 'pack-A' }),
      sysRow({ id: 'u3', state: 'pending', kind: 'undo', pack_id: 'pack-A' }),
      sysRow({ id: 'u4', state: 'pending', pack_id: null }),
    ]).get('cust-1')
    expect(displayRemaining(6, u, 'pack-A')).toBe(5)
    expect(displayRemaining(6, u, 'pack-B')).toBe(6)
    expect(u?.noPackPending).toBe(1)
  })

  test('15 · another business’s key is refused', async () => {
    const store = memStore(); const core = fakeCore()
    const id = 'aaaaaaaa-0000-4000-8000-000000000015'
    await store.insertIgnore(sysRow({ id, business_id: B2 }))
    const r = await recordUse(deps(store, core), walkIn({ intentId: id }))
    expect(r).toMatchObject({ ok: false, error: 'foreign_key' })
    expect(core.packs.addRedemption).not.toHaveBeenCalled()
  })

  test('F1 · a withdrawn row answers withdrawn (its own ack state)', async () => {
    const store = memStore()
    const id = 'aaaaaaaa-0000-4000-8000-0000000000f1'
    await store.insertIgnore(sysRow({ id, state: 'withdrawn' }))
    expect(await recordUse(deps(store, fakeCore()), walkIn({ intentId: id }))).toEqual({ ok: false, state: 'withdrawn', intentId: id })
  })

  test('19 · ledger read failure → usage read is ok:false (the card shows 残数確認中) and the gate still runs', async () => {
    const store = memStore(); store.failReads = true
    expect(await readLedgerUsage(store, B, ['cust-1'])).toEqual({ ok: false })
    const r = await recordUse(deps(store, fakeCore()), walkIn())
    expect(r).toMatchObject({ ok: false, error: 'ledger_unavailable' }) // never an ungated send
  })

  test('settle pass: pending rows of every business with open rows; parked resumes on the daily pass', async () => {
    const store = memStore(); const core = fakeCore()
    await store.insertIgnore(sysRow({ id: 's1', pack_picked_by: 'staff' }))
    await store.insertIgnore(sysRow({ id: 's2', business_id: B2, pack_picked_by: 'staff', state: 'parked' }))
    const hourly = await settlePending({ store, clientFor: () => core as never, rotate: (ids) => [...ids], dailyPass: false, now: () => NOW })
    expect(hourly).toMatchObject({ settled: 1, attempted: 1 })
    const daily = await settlePending({ store, clientFor: () => core as never, rotate: (ids) => [...ids], dailyPass: true, now: () => NOW })
    expect(daily.settled).toBe(1)
    expect(store.rows.find((r) => r.id === 's2')).toMatchObject({ state: 'settled', resumed_at: NOW.toISOString() })
  })

  test('B · cutover day: unset or malformed → the pre-read keeps the row pending + ledger.cutover_unset, nothing read or sent; set → today’s match', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    const saved = process.env.KARUTE_LEDGER_CUTOVER_DAY
    const recent = [{ id: 'old', customer_id: 'cust-1', appointment_id: null, redeemed_on: TODAY, source: 'manual' }]
    const replay = () => sysRow({ id: 'aaaaaaaa-0000-4000-8000-0000000000b1', appointment_id: null, attempts: 1, pack_picked_by: 'staff' })
    try {
      for (const bad of [undefined, '', '2026-13-45', '2026-02-30', 'tomorrow']) {
        if (bad === undefined) delete process.env.KARUTE_LEDGER_CUTOVER_DAY
        else process.env.KARUTE_LEDGER_CUTOVER_DAY = bad
        expect(cutoverDay()).toBeNull()
        const store = memStore(); const core = fakeCore({ recent }); const row = replay(); await store.insertIgnore(row)
        expect(await attemptIntent(deps(store, core), row)).toMatchObject({ state: 'pending', last_error_code: 'cutover_unset', leased_until: null })
        expect(core.packs.listRecentRedemptions).not.toHaveBeenCalled()
        expect(core.packs.addRedemption).not.toHaveBeenCalled()
      }
      expect(err.mock.calls.filter((c) => String(c[1]).includes('ledger.cutover_unset'))).toHaveLength(5)
      process.env.KARUTE_LEDGER_CUTOVER_DAY = CUT
      expect(cutoverDay()).toBe(CUT)
      const store = memStore(); const core = fakeCore({ recent }); const row = replay(); await store.insertIgnore(row)
      expect(await attemptIntent(deps(store, core), row)).toMatchObject({ state: 'settled', settled_core_id: 'old', resolved_by: 'matched:old' })
    } finally {
      if (saved === undefined) delete process.env.KARUTE_LEDGER_CUTOVER_DAY
      else process.env.KARUTE_LEDGER_CUTOVER_DAY = saved
      err.mockRestore()
    }
  })
})

function sysRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001', business_id: B, owner_user_id: null, kind: 'use',
    ledger_source: 'no_show', core_source: 'manual', customer_id: 'cust-1', pack_id: 'pack-A',
    pack_picked_by: 'system', appointment_id: 'appt-1', appointment_resolved: true,
    gesture_at: NOW.toISOString(), gesture_at_client: null, clock_suspect: false, redeemed_on: TODAY,
    counts_as_visit: false, another_session: false, audit_payload: null, state: 'pending', attempts: 0,
    frozen_payload: { pack_id: over.pack_id ?? 'pack-A', customer_id: 'cust-1', redeemed_on: over.redeemed_on ?? TODAY, appointment_id: over.appointment_id === undefined ? 'appt-1' : over.appointment_id, karute_record_id: null, source: 'manual', created_by: 'staff-1', counts_as_visit: false },
    ...over,
  }
}
