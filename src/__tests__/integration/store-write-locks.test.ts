// THE BY-ID WRITE STORE LOCKS (⚖ Liam 2026-09-16 — "a staff member of one
// store must never be able to change another store's records, even by direct
// call, even if the screen hides them").
//
// One suite for the whole rule, because the rule has ONE home:
// ensureRecordStoreInScope (src/lib/auth/store-lock.ts). Every by-id booking
// and karute write core runs it, so this file proves (a) the predicate itself,
// and (b) that each core actually calls it — the second half is what a
// mutation run kills: delete the lock line in a core and the matching row below
// goes red while the predicate tests stay green.
//
// The refusal MESSAGE is load-bearing, not cosmetic: an out-of-store refusal
// must be byte-identical to that door's answer for an id that does not exist,
// or a clamped actor can enumerate the business by error shape alone (the
// existence-oracle class the karute reassign door closed as R9-2).

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))

// The cores under test are reached through src/actions/karute.ts and
// src/lib/appointments/mutations.ts, whose module graphs value-import the
// ESM-only SDK. Same stub convention as app-api-karute-entry-edit.test.ts —
// every client this suite uses is a hand-built fake passed in explicitly.
jest.mock('@synqed-kk/client', () => ({
  SynqedError: class SynqedError extends Error {
    status?: number
  },
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(),
  newSynqedClient: jest.fn(),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
  getStaffList: jest.fn(async () => []),
  staffListByBusinessOrThrow: jest.fn(async () => []),
}))

const auditSpy = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => auditSpy(...(a as [])),
}))

import { ensureRecordStoreInScope, sourceStoreOutOfScope } from '@/lib/auth/store-lock'
import { AppApiError } from '@/lib/app-api/errors'
import { KARUTE_NOT_FOUND } from '@/lib/app-api/karute-facade'
import { resolveWriteStoreScope } from '@/lib/app-api/store-clamp'
import {
  cancelAppointmentCore,
  restoreAppointmentCore,
  markNoShowAppointmentCore,
  updateAppointmentCore,
  deleteAppointmentCore,
} from '@/lib/appointments/mutations'
import {
  createOrUpdateKaruteRecord,
  updateKaruteDetailEntryWithClient,
  updateKaruteDetailSummaryWithClient,
} from '@/actions/karute'

// The five scopes every door must answer the same way.
const VIEW_ALL = { viewAll: true, allowedStoreIds: null }
const FLOATING = { viewAll: false, allowedStoreIds: null } // empty staff_stores = every store (until P2)
const CLAMPED_OWN = { viewAll: false, allowedStoreIds: ['store-ginza'] }
const CLAMPED_FOREIGN = { viewAll: false, allowedStoreIds: ['store-daikanyama'] }
const DEGRADED = { viewAll: false, allowedStoreIds: ['store-ginza'], degraded: true }

const RECORD = { store_id: 'store-ginza' }

/** Every `*.store_write_refused` row the audit spy saw — the refusal trace
 *  (FRESH-EYES-P1 §5a). A door that PASSES the lock must file none: the row is
 *  the refusal's receipt, not the write's. */
const refusalRows = () =>
  auditSpy.mock.calls.filter((c) =>
    String((c[0] as { action?: unknown } | undefined)?.action ?? '').endsWith('.store_write_refused'),
  )

describe('ensureRecordStoreInScope — the one predicate', () => {
  const run = (record: { store_id: string | null }, scope: Parameters<typeof ensureRecordStoreInScope>[1]) => {
    try {
      ensureRecordStoreInScope(record, scope, 'X not found')
      return 'passed' as const
    } catch (err) {
      const e = err as AppApiError
      return { code: e.code, message: e.message }
    }
  }

  it('viewAll passes', () => expect(run(RECORD, VIEW_ALL)).toBe('passed'))
  it('floating (empty assignment) passes', () => expect(run(RECORD, FLOATING)).toBe('passed'))
  it('clamped to the record own store passes', () => expect(run(RECORD, CLAMPED_OWN)).toBe('passed'))

  it('clamped to ANOTHER store refuses as not_found, with the caller message', () => {
    expect(run(RECORD, CLAMPED_FOREIGN)).toEqual({ code: 'not_found', message: 'X not found' })
  })

  it.each(['store-ginza', null])('an unassigned scope refuses record store %p as not_found', (storeId) => {
    const unassigned = { viewAll: false, allowedStoreIds: [] }
    const record = { store_id: storeId }
    expect(run(record, unassigned)).toEqual({ code: 'not_found', message: 'X not found' })
    expect(sourceStoreOutOfScope(record, unassigned)).toBe(true)
  })

  it('a legacy store-less record refuses for a clamped actor (membership unprovable)', () => {
    expect(run({ store_id: null }, CLAMPED_OWN)).toEqual({ code: 'not_found', message: 'X not found' })
  })

  it('a legacy store-less record still passes for viewAll and floating', () => {
    expect(run({ store_id: null }, VIEW_ALL)).toBe('passed')
    expect(run({ store_id: null }, FLOATING)).toBe('passed')
  })

  it('a degraded assignment lookup fails CLOSED — never widened into every store', () => {
    expect(run(RECORD, DEGRADED)).toEqual({
      code: 'store_forbidden',
      message: 'could not verify your store assignment (fail-closed)',
    })
  })

  it('degraded is refused even when the record IS in the actor listed store', () => {
    expect(run({ store_id: 'store-ginza' }, DEGRADED)).toMatchObject({ code: 'store_forbidden' })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Booking write cores
// ───────────────────────────────────────────────────────────────────────────

// Core's own 404 text (synqed-core src/routes/appointments.ts) — the SDK
// rethrows it as SynqedError.message and each core's catch turns it into
// { error }. The lock must produce this exact string.
const APPOINTMENT_404 = 'Appointment not found'

function bookingClient(store: string | null) {
  const update = jest.fn(async () => ({ id: 'appt-1', customer_id: 'cust-1', store_id: store }))
  const del = jest.fn(async () => {})
  return {
    update,
    del,
    client: {
      appointments: {
        get: jest.fn(async (id: string) => {
          if (id !== 'appt-1') {
            throw Object.assign(new Error(APPOINTMENT_404), { status: 404 })
          }
          return {
            id: 'appt-1',
            customer_id: 'cust-1',
            store_id: store,
            status: 'CANCELLED',
            starts_at: '2026-09-16T01:00:00.000Z',
            created_at: '2026-09-15T01:00:00.000Z',
          }
        }),
        update,
        delete: del,
      },
      packs: {
        listCustomerPacks: jest.fn(async () => []),
        listRecentRedemptions: jest.fn(async () => []),
      },
      staffStores: { get: jest.fn(async () => ({ store_ids: [] })) },
      stores: { list: jest.fn(async () => ({ stores: [] })) },
    },
  }
}

const ACTOR = { actorId: 'auth-user-1', businessId: 'biz-1', source: 'web' as const, requestId: 'req-1' }

type Scope = Parameters<typeof cancelAppointmentCore>[5]

/** Every by-id booking door, driven through ONE shape. `restore` is the only
 *  one whose happy path needs a terminal row, which is why the fixture above
 *  ships CANCELLED and the other doors assert on the REFUSAL (the lock runs
 *  before their terminal guards, deliberately). */
const BOOKING_DOORS: Array<{
  name: string
  call: (c: ReturnType<typeof bookingClient>, scope: Scope) => Promise<{ error?: string } | unknown>
  writeOf: (c: ReturnType<typeof bookingClient>) => jest.Mock
}> = [
  {
    name: 'cancel',
    call: (c, scope) => cancelAppointmentCore(c.client as never, 'appt-1', undefined, 'staff-1', ACTOR, scope),
    writeOf: (c) => c.update,
  },
  {
    name: 'restore',
    call: (c, scope) => restoreAppointmentCore(c.client as never, 'appt-1', 'staff-1', ACTOR, scope),
    writeOf: (c) => c.update,
  },
  {
    name: 'no-show',
    call: (c, scope) =>
      markNoShowAppointmentCore(c.client as never, 'appt-1', { burnPack: false }, 'staff-1', ACTOR, scope),
    writeOf: (c) => c.update,
  },
  {
    name: 'update',
    call: (c, scope) =>
      updateAppointmentCore(c.client as never, 'appt-1', { startsAt: '2026-09-17T01:00:00.000Z' }, ACTOR, scope),
    writeOf: (c) => c.update,
  },
  {
    name: 'delete',
    call: (c, scope) => deleteAppointmentCore(c.client as never, 'appt-1', ACTOR, scope),
    writeOf: (c) => c.del,
  },
]

describe('booking by-id writes — every door is store-locked', () => {
  beforeEach(() => jest.clearAllMocks())

  for (const door of BOOKING_DOORS) {
    describe(door.name, () => {
      it('a clamped actor + another store booking → refused, nothing written, no audit row', async () => {
        const c = bookingClient('store-ginza')
        const result = await door.call(c, CLAMPED_FOREIGN)
        expect(result).toEqual({ error: APPOINTMENT_404 })
        expect(door.writeOf(c)).not.toHaveBeenCalled()
        expect(auditSpy).not.toHaveBeenCalled()
      })

      it('the refusal is BYTE-IDENTICAL to a genuinely missing id — no existence oracle', async () => {
        const c = bookingClient('store-ginza')
        const refused = await door.call(c, CLAMPED_FOREIGN)
        const missing = await (async () => {
          const c2 = bookingClient('store-ginza')
          // Same door, an id core does not hold.
          return door.name === 'cancel'
            ? cancelAppointmentCore(c2.client as never, 'nope', undefined, 'staff-1', ACTOR, VIEW_ALL)
            : door.name === 'restore'
              ? restoreAppointmentCore(c2.client as never, 'nope', 'staff-1', ACTOR, VIEW_ALL)
              : door.name === 'no-show'
                ? markNoShowAppointmentCore(c2.client as never, 'nope', { burnPack: false }, 'staff-1', ACTOR, VIEW_ALL)
                : door.name === 'update'
                  ? updateAppointmentCore(c2.client as never, 'nope', { startsAt: 'x' }, ACTOR, VIEW_ALL)
                  : deleteAppointmentCore(c2.client as never, 'nope', ACTOR, VIEW_ALL)
        })()
        expect(refused).toEqual(missing)
      })

      it('a legacy store-less booking is refused for a clamped actor', async () => {
        const c = bookingClient(null)
        expect(await door.call(c, CLAMPED_OWN)).toEqual({ error: APPOINTMENT_404 })
        expect(door.writeOf(c)).not.toHaveBeenCalled()
      })

      it('a degraded assignment lookup fails closed', async () => {
        const c = bookingClient('store-ginza')
        expect(await door.call(c, DEGRADED)).toEqual({
          error: 'could not verify your store assignment (fail-closed)',
        })
        expect(door.writeOf(c)).not.toHaveBeenCalled()
      })

      it('the lock lets viewAll, floating and own-store actors through to the door own rules', async () => {
        for (const scope of [VIEW_ALL, FLOATING, CLAMPED_OWN]) {
          const c = bookingClient('store-ginza')
          const result = (await door.call(c, scope)) as { error?: string }
          // Past the lock: whatever this door answers next, it is never the
          // lock refusal (restore is the one that also SUCCEEDS on this
          // fixture; the rest hit their own terminal/burn guards).
          expect(result.error).not.toBe(APPOINTMENT_404)
          expect(result.error).not.toBe('could not verify your store assignment (fail-closed)')
        }
      })
    })
  }

  it('restore actually completes for an in-scope clamped actor (the lock is not just refusing everything)', async () => {
    const c = bookingClient('store-ginza')
    expect(await restoreAppointmentCore(c.client as never, 'appt-1', 'staff-1', ACTOR, CLAMPED_OWN)).toEqual({
      success: true,
    })
    expect(c.update).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Karute detail-edit cores
// ───────────────────────────────────────────────────────────────────────────

function karuteClient() {
  const updateEntry = jest.fn(async () => ({ id: 'e1', entry_edit_id: 'edit-1' }))
  const update = jest.fn(async () => ({ id: 'kar-1' }))
  return { updateEntry, update, client: { karuteRecords: { updateEntry, update } } }
}

const KARUTE_ACTOR = { actorId: 'auth-user-1', businessId: 'biz-1', source: 'web' as const, requestId: 'req-1' }

describe('karute detail edits — the shared cores are store-locked', () => {
  beforeEach(() => jest.clearAllMocks())

  const entry = (c: ReturnType<typeof karuteClient>, lock: { recordStoreId: string | null; scope: Scope }) =>
    updateKaruteDetailEntryWithClient(
      c.client as never,
      'kar-1',
      'e1',
      { content: 'edited', expectedVersion: 1, actorStaffId: 'staff-1' },
      KARUTE_ACTOR,
      'cust-1',
      lock,
    )

  const summary = (c: ReturnType<typeof karuteClient>, lock: { recordStoreId: string | null; scope: Scope }) =>
    updateKaruteDetailSummaryWithClient(
      c.client as never,
      'kar-1',
      { content: 'edited', actorStaffId: 'staff-1' },
      KARUTE_ACTOR,
      'cust-1',
      null,
      lock,
    )

  for (const [name, call, writeName] of [
    ['entry edit', entry, 'updateEntry'],
    ['summary edit', summary, 'update'],
  ] as const) {
    describe(name, () => {
      it('a clamped actor + another store record → the SAME not_found a missing id gets, and ONE refusal row', async () => {
        const c = karuteClient()
        await expect(call(c, { recordStoreId: 'store-ginza', scope: CLAMPED_FOREIGN })).rejects.toMatchObject({
          code: 'not_found',
          message: KARUTE_NOT_FOUND,
        })
        expect(c[writeName]).not.toHaveBeenCalled()
        expect(auditSpy).toHaveBeenCalledTimes(1)
        expect(auditSpy.mock.calls[0][0]).toMatchObject({
          category: 'karute',
          action: 'karute.store_write_refused',
          severity: 'warning',
          targetType: 'karute',
          targetId: 'kar-1',
          detail: expect.objectContaining({
            door: name === 'entry edit' ? 'karute.entry_edit' : 'karute.summary_edit',
            record_store_id: 'store-ginza',
            code: 'not_found',
          }),
        })
      })

      it('a legacy store-less record is refused for a clamped actor', async () => {
        const c = karuteClient()
        await expect(call(c, { recordStoreId: null, scope: CLAMPED_OWN })).rejects.toMatchObject({
          code: 'not_found',
        })
        expect(c[writeName]).not.toHaveBeenCalled()
      })

      it('a degraded assignment lookup fails closed', async () => {
        const c = karuteClient()
        await expect(call(c, { recordStoreId: 'store-ginza', scope: DEGRADED })).rejects.toMatchObject({
          code: 'store_forbidden',
        })
        expect(c[writeName]).not.toHaveBeenCalled()
      })

      it('the lock refuses BEFORE the content bounds — an out-of-store actor learns nothing', async () => {
        const c = karuteClient()
        const blank =
          name === 'entry edit'
            ? updateKaruteDetailEntryWithClient(
                c.client as never,
                'kar-1',
                'e1',
                { content: '   ', expectedVersion: 1, actorStaffId: 'staff-1' },
                KARUTE_ACTOR,
                'cust-1',
                { recordStoreId: 'store-ginza', scope: CLAMPED_FOREIGN },
              )
            : updateKaruteDetailSummaryWithClient(
                c.client as never,
                'kar-1',
                { content: '   ', actorStaffId: 'staff-1' },
                KARUTE_ACTOR,
                'cust-1',
                null,
                { recordStoreId: 'store-ginza', scope: CLAMPED_FOREIGN },
              )
        await expect(blank).rejects.toMatchObject({ code: 'not_found' })
      })

      it('viewAll, floating and own-store actors write normally', async () => {
        for (const scope of [VIEW_ALL, FLOATING, CLAMPED_OWN]) {
          const c = karuteClient()
          await expect(call(c, { recordStoreId: 'store-ginza', scope })).resolves.toEqual({ ok: true })
          expect(c[writeName]).toHaveBeenCalledTimes(1)
          expect(refusalRows()).toHaveLength(0)
        }
      })
    })
  }
})

// ──────────────────────────────────────────────────────────────────────
// The karute SAVE converge branch (BUILD-REPORT-P1.md §9.5) — the last by-id
// write door. Keyed by recording_session_id, not by karute id, which is exactly
// why it was missed: the caller never names a record, so nothing looked like a
// by-id write. It is one — the update re-points customer / transcript /
// summary / appointment / entries on whatever record that session id resolves to.
// ──────────────────────────────────────────────────────────────────────

function convergeClient(existingStore: string | null) {
  const update = jest.fn(async () => ({ id: 'kar-1' }))
  const create = jest.fn(async () => ({ id: 'kar-new', store_id: 'store-daikanyama' }))
  const getByRecordingSession = jest.fn(async () => ({
    id: 'kar-1',
    store_id: existingStore,
    transcript: 'what the first save landed',
    entries: [],
  }))
  return {
    update,
    create,
    getByRecordingSession,
    client: { karuteRecords: { getByRecordingSession, update, create } },
  }
}

/** A 代官山 actor's payload — their own store, their own customer, aimed at a
 *  recording session whose record already sits in 銀座. */
const CONVERGE_PAYLOAD = {
  customer_id: 'cust-daikanyama',
  store_id: 'store-daikanyama',
  staff_id: 'staff-1',
  appointment_id: null,
  recording_session_id: 'rec-1',
  transcript: 'rewritten',
  ai_summary: 'rewritten',
  entries: [],
}

describe('karute save converge branch — the recording_session_id door is store-locked', () => {
  beforeEach(() => jest.clearAllMocks())

  const save = (c: ReturnType<typeof convergeClient>, scope: Scope) =>
    createOrUpdateKaruteRecord(c.client as never, CONVERGE_PAYLOAD as never, KARUTE_ACTOR, 'replace', scope)

  it('a clamped 代官山 actor + a 銀座 record under that session id → the SAME not_found a missing id gets', async () => {
    const c = convergeClient('store-ginza')
    await expect(save(c, CLAMPED_FOREIGN)).rejects.toMatchObject({
      code: 'not_found',
      message: KARUTE_NOT_FOUND,
    })
    expect(c.update).not.toHaveBeenCalled()
    expect(c.create).not.toHaveBeenCalled()
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy.mock.calls[0][0]).toMatchObject({
      category: 'karute',
      action: 'karute.store_write_refused',
      severity: 'warning',
      targetType: 'karute',
      targetId: 'kar-1',
      detail: expect.objectContaining({
        door: 'karute.save',
        recording_session_id: 'rec-1',
        record_store_id: 'store-ginza',
        code: 'not_found',
      }),
    })
  })

  it("an UNASSIGNED Bearer caller (real resolver, 2-store business) cannot converge-save onto any store's record", async () => {
    const c = convergeClient('store-ginza')
    const synqed = {
      ...c.client,
      staffStores: { get: jest.fn(async () => ({ store_ids: [] })) },
      stores: {
        list: jest.fn(async () => ({
          stores: [
            { id: 'store-ginza', active: true },
            { id: 'store-daikanyama', active: true },
          ],
        })),
      },
    }
    const scope = await resolveWriteStoreScope({
      synqed: synqed as never,
      authUserId: KARUTE_ACTOR.actorId,
      selfStaffId: KARUTE_ACTOR.actorId,
      capabilities: new Set(['records.write']),
    })
    expect(scope).toEqual({ storeId: null, allowedStoreIds: [] })
    expect(synqed.staffStores.get).toHaveBeenCalledWith(KARUTE_ACTOR.actorId)
    expect(synqed.stores.list).toHaveBeenCalledTimes(1)

    await expect(createOrUpdateKaruteRecord(
      synqed as never,
      CONVERGE_PAYLOAD as never,
      { ...KARUTE_ACTOR, source: 'facade' },
      'replace',
      scope,
    )).rejects.toMatchObject({ code: 'not_found', message: KARUTE_NOT_FOUND })
    expect(c.getByRecordingSession).toHaveBeenCalledWith('rec-1')
    expect(c.update).not.toHaveBeenCalled()
    expect(c.create).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('a legacy store-less record is refused for a clamped actor', async () => {
    const c = convergeClient(null)
    await expect(save(c, CLAMPED_OWN)).rejects.toMatchObject({ code: 'not_found' })
    expect(c.update).not.toHaveBeenCalled()
  })

  it('a degraded assignment lookup fails closed', async () => {
    const c = convergeClient('store-ginza')
    await expect(save(c, DEGRADED)).rejects.toMatchObject({ code: 'store_forbidden' })
    expect(c.update).not.toHaveBeenCalled()
    expect(c.create).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('viewAll, floating and same-store actors converge normally', async () => {
    for (const [label, scope, store] of [
      ['viewAll', VIEW_ALL, 'store-ginza'],
      ['floating', FLOATING, 'store-ginza'],
      ['same store', CLAMPED_OWN, 'store-ginza'],
    ] as const) {
      const c = convergeClient(store)
      await expect(save(c, scope)).resolves.toMatchObject({ id: 'kar-1', fresh: false })
      expect({ label, updates: c.update.mock.calls.length }).toEqual({ label, updates: 1 })
      expect(refusalRows()).toHaveLength(0)
    }
  })

  it('the CREATE arm is untouched — a session id with no record yet still creates', async () => {
    const c = convergeClient('store-ginza')
    c.getByRecordingSession.mockImplementationOnce(async () => {
      throw Object.assign(new Error('not found'), { status: 404 })
    })
    await expect(save(c, CLAMPED_OWN)).resolves.toMatchObject({ id: 'kar-new', fresh: true })
    expect(c.create).toHaveBeenCalledTimes(1)
  })
})
