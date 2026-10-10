/**
 * S126 A2 W4 — tests 7-P3 and 17 END TO END through mutations.ts
 * (markNoShowAppointmentCore / cancelAppointmentCore). Core faked at the SDK
 * boundary with a STATEFUL booking (the status write is what the R2 re-check
 * reads back); the ledger is the in-memory fake store, inspectable.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://placeholder.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service'

jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }
  return { SynqedError }
})
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))
const mockAudit = jest.fn()
jest.mock('@/lib/audit', () => ({ ...jest.requireActual('@/lib/audit'), audit: (...a: unknown[]) => mockAudit(...a) }))
// eslint-disable-next-line no-var
var mockLedger: { store: import('@/lib/packs/use-ledger').LedgerStore }
jest.mock('@/lib/packs/use-ledger', () => ({
  ...jest.requireActual('@/lib/packs/use-ledger'),
  defaultLedgerStore: async () => mockLedger.store,
}))
jest.mock('@/lib/packs/store', () => ({
  ...jest.requireActual('@/lib/packs/store'),
  listCustomerPacksWithClient: () => mockListPacks(),
}))
const PACKS = [{ id: 'pack-1', kind: 'pack', status: 'active', remaining: 3, purchased_at: '2026-01-01' }]
const mockListPacks = jest.fn(async (): Promise<unknown[]> => PACKS)

import { cancelAppointmentCore, markNoShowAppointmentCore, P3_LEDGER_SAVE_ERROR } from '@/lib/appointments/mutations'
import { settlePending, type IntentRow } from '@/lib/packs/use-ledger'
import { memLedgerStore } from './helpers/ledger-fake'
import { UUID_RE } from '@/lib/uuid-shape'

const B = '00000000-0000-4000-8000-0000000000b2'
const ACTOR = { actorId: 'user-1', businessId: B, source: 'web' as const, requestId: 'req-1' }
const SCOPE = { viewAll: true, allowedStoreIds: null }

function fakeCore() {
  const booking: Record<string, unknown> = {
    id: 'appt-1', customer_id: 'cust-1', store_id: null, status: 'SCHEDULED', status_reason: null,
    starts_at: '2026-10-09T03:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z',
  }
  const addRedemption = jest.fn(async (): Promise<unknown> => ({ id: 'core-1' }))
  const update = jest.fn(async (_id: string, patch: Record<string, unknown>) => { Object.assign(booking, patch); return { ...booking } })
  const get = jest.fn(async (): Promise<unknown> => ({ ...booking }))
  const synqed = {
    appointments: { get, update },
    packs: { addRedemption, listRecentRedemptions: jest.fn(async () => []), listPacks: jest.fn(async () => []), listRedemptions: jest.fn(async () => []) },
  }
  return { booking, addRedemption, update, get, synqed: synqed as never }
}
type Store = ReturnType<typeof memLedgerStore>
const rowsOf = async (store: Store, id: string) => (await store.getAllById(id))[0] as IntentRow
const lastDetail = () => (mockAudit.mock.calls.at(-1)?.[0] as { detail: Record<string, unknown> }).detail
const LATER = () => new Date(Date.now() + 10 * 60_000) // past the unanswered attempt's lease (R5)
const settle = (store: Store, synqed: never) => settlePending({ store, clientFor: () => synqed, rotate: (ids) => [...ids], dailyPass: false, now: LATER })
const genericFailure = () => { throw Object.assign(new Error('socket hang up'), { name: 'TypeError' }) }

beforeEach(() => { mockAudit.mockClear(); mockListPacks.mockReset().mockImplementation(async () => PACKS); mockLedger = { store: memLedgerStore() } })

describe('7 (P3) — the ledger insert fails → the loud error, NO status write', () => {
  it('no-show: insert throws → 保存できませんでした…, appointments.update never called', async () => {
    mockLedger.store = { ...memLedgerStore(), insertIgnore: async () => { throw new Error('db down') } }
    const c = fakeCore()
    const res = await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ error: P3_LEDGER_SAVE_ERROR })
    expect(c.update).not.toHaveBeenCalled(); expect(c.addRedemption).not.toHaveBeenCalled(); expect(mockAudit).not.toHaveBeenCalled()
  })
  it('same-day cancel + burn: insert throws → the loud error, appointments.update never called', async () => {
    mockLedger.store = { ...memLedgerStore(), insertIgnore: async () => { throw new Error('db down') } }
    const c = fakeCore()
    const res = await cancelAppointmentCore(c.synqed, 'appt-1', { reason: 'cancel-same-day-contact', burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ error: P3_LEDGER_SAVE_ERROR })
    expect(c.update).not.toHaveBeenCalled()
  })
})

describe('17 — R2: every P3 attempt re-checks the booking (driven through mutations.ts)', () => {
  it('no-show, then restored before the replay → withdrawn (system, status_changed), never re-sent', async () => {
    const c = fakeCore(); c.addRedemption.mockImplementationOnce(genericFailure)
    const res = await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ success: true })
    const id = lastDetail().intent_id as string
    expect(lastDetail()).toMatchObject({ burn_error: null, ledger_state: 'pending' })
    c.booking.status = 'SCHEDULED' // restore
    await settle(mockLedger.store as Store, c.synqed)
    expect(await rowsOf(mockLedger.store as Store, id)).toMatchObject({ state: 'withdrawn', withdrawn_by: 'system', last_error_code: 'status_changed' })
    expect(c.addRedemption).toHaveBeenCalledTimes(1) // the first attempt only
  })
  it('CANCELLED same-day-contact + burnPack → sent under the intent id and settled', async () => {
    const c = fakeCore()
    const res = await cancelAppointmentCore(c.synqed, 'appt-1', { reason: 'cancel-same-day-contact', burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ success: true })
    const d = lastDetail()
    expect(d).toMatchObject({ burn_pack: true, burn_error: null, ledger_state: 'settled' })
    expect(c.addRedemption).toHaveBeenCalledTimes(1)
    expect(c.update.mock.invocationCallOrder[0]).toBeLessThan(c.addRedemption.mock.invocationCallOrder[0]) // status FIRST
    expect(await rowsOf(mockLedger.store as Store, d.intent_id as string)).toMatchObject({ ledger_source: 'cancel', redeemed_on: '2026-10-09', counts_as_visit: false, pack_picked_by: 'system' })
  })
  it("CANCELLED 'cancel-advance-contact' at the replay → withdrawn, never re-sent", async () => {
    const c = fakeCore(); c.addRedemption.mockImplementationOnce(genericFailure)
    await cancelAppointmentCore(c.synqed, 'appt-1', { reason: 'cancel-same-day-contact', burnPack: true }, null, ACTOR, SCOPE)
    const id = lastDetail().intent_id as string
    c.booking.status_reason = 'cancel-advance-contact'
    await settle(mockLedger.store as Store, c.synqed)
    expect(await rowsOf(mockLedger.store as Store, id)).toMatchObject({ state: 'withdrawn', last_error_code: 'status_changed' })
    expect(c.addRedemption).toHaveBeenCalledTimes(1)
  })
  it('unreadable booking inside the attempt → pending, burnError null, nothing sent', async () => {
    const c = fakeCore()
    c.get.mockImplementationOnce(async () => ({ ...c.booking })).mockImplementationOnce(async () => { throw new Error('core down') })
    const res = await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ success: true })
    expect(lastDetail()).toMatchObject({ burn_error: null, ledger_state: 'pending' })
    expect(c.addRedemption).not.toHaveBeenCalled()
  })
})

describe('A26 — a generic core failure on the first P3 attempt', () => {
  it('→ pending, burnError null (no amber line), the audit row carries intent id + state', async () => {
    const c = fakeCore(); c.addRedemption.mockImplementationOnce(genericFailure)
    const res = await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ success: true }) // no burnError → no 「…消化されていません」 line
    const d = lastDetail()
    expect(d).toMatchObject({ burn_pack: true, burn_error: null, ledger_state: 'pending', intent_id: expect.any(String) })
    expect(await rowsOf(mockLedger.store as Store, d.intent_id as string)).toMatchObject({ state: 'pending', ledger_source: 'no_show', attempts: 1 })
  })
})

describe('§ 6a (R-S126-1 f) — a pack-read ERROR = pending, never 「no burnable pack」', () => {
  it('no-show: the pack read throws → status written, use pending with pack_id null, no amber line, nothing sent; a later settle picks and settles', async () => {
    const c = fakeCore()
    mockListPacks.mockImplementation(async () => { throw new Error('core down') })
    const res = await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ success: true }) // no code:'no_burnable_pack', no burnError
    expect(c.update).toHaveBeenCalledTimes(1)
    expect(c.booking.status).toBe('NO_SHOW')
    expect(c.addRedemption).not.toHaveBeenCalled()
    const d = lastDetail()
    expect(d).toMatchObject({ burn_pack: true, burn_error: null, ledger_state: 'pending' })
    const id = d.intent_id as string
    expect(await rowsOf(mockLedger.store as Store, id)).toMatchObject({ state: 'pending', pack_id: null, frozen_payload: null, last_error_code: 'precheck_error' })
    mockListPacks.mockImplementation(async () => PACKS) // the read works again
    await settle(mockLedger.store as Store, c.synqed)
    expect(await rowsOf(mockLedger.store as Store, id)).toMatchObject({ state: 'settled', pack_id: 'pack-1', settled_core_id: 'core-1' })
    expect(c.addRedemption).toHaveBeenCalledTimes(1)
    expect((c.addRedemption.mock.calls as unknown[][])[0][0]).toMatchObject({ pack_id: 'pack-1', customer_id: 'cust-1', redeemed_on: '2026-10-09', appointment_id: 'appt-1', counts_as_visit: false })
    expect(JSON.stringify(c.addRedemption.mock.calls[0])).toContain(id) // sent under the intent id
  })
  it('a SUCCESSFUL read with no burnable pack keeps today\'s answer: no_burnable_pack, no row, no write', async () => {
    const c = fakeCore()
    mockListPacks.mockImplementation(async () => [])
    const res = await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, ACTOR, SCOPE)
    expect(res).toEqual({ error: expect.any(String), code: 'no_burnable_pack' })
    expect(c.update).not.toHaveBeenCalled(); expect(c.addRedemption).not.toHaveBeenCalled()
  })
})

describe('A (hole 1) — created_by sent to core is a uuid or null, never an empty string', () => {
  const STAFF_UUID = '0b6f2c1e-3c1d-4a2b-9c8d-7e6f5a4b3c2d'
  // core validations/pack.ts:29 — created_by: uuid | null; anything else is a 400
  const coreCreatedBy = (args: unknown[]): unknown => {
    const body = args.find((a) => a && typeof a === 'object' && ('created_by' in a || 'createdBy' in a)) as Record<string, unknown> | undefined
    const v = body ? (body.created_by ?? body.createdBy ?? null) : null
    if (v !== null && !(typeof v === 'string' && UUID_RE.test(v))) throw Object.assign(new Error('Invalid body'), { status: 400 })
    return v
  }
  it.each([['a non-uuid actor id', 'user-1', null], ['a staff uuid', STAFF_UUID, STAFF_UUID]])('%s → frozen and sent as %p', async (_label, actorId, want) => {
    const c = fakeCore()
    const sent: unknown[] = []
    c.addRedemption.mockImplementation(async (...args: unknown[]) => { sent.push(coreCreatedBy(args)); return { id: 'core-1' } })
    const res = await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, { ...ACTOR, actorId }, SCOPE)
    expect(res).toEqual({ success: true })
    const row = await rowsOf(mockLedger.store as Store, lastDetail().intent_id as string)
    expect(row.frozen_payload?.created_by).toBe(want)
    expect(row.state).toBe('settled')
    expect(sent).toEqual([want])
  })
})

describe('B (hole 2, alarm part) — a SYSTEM withdrawal of a P3 row is never silent', () => {
  it('no-show, restored, the settle pass withdraws it → withdrawn + ONE ledger.p3_withdrawn alarm with the reason', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const c = fakeCore(); c.addRedemption.mockImplementationOnce(genericFailure)
      await markNoShowAppointmentCore(c.synqed, 'appt-1', { burnPack: true }, null, ACTOR, SCOPE)
      const id = lastDetail().intent_id as string
      c.booking.status = 'SCHEDULED' // restore
      await settle(mockLedger.store as Store, c.synqed)
      expect(await rowsOf(mockLedger.store as Store, id)).toMatchObject({ state: 'withdrawn', withdrawn_by: 'system', last_error_code: 'status_changed' })
      const alarms = spy.mock.calls.filter((a) => a[0] === '[alarm]').map((a) => JSON.parse(String(a[1])) as { kind: string })
      expect(alarms.filter((a) => a.kind === 'ledger.p3_withdrawn')).toEqual([
        expect.objectContaining({ kind: 'ledger.p3_withdrawn', business_id: B, ref: id, facts: { reason: 'status_changed' } }),
      ])
    } finally { spy.mockRestore() }
  })
})
