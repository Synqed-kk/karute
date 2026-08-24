/**
 * Server-side RBAC enforcement (security audit gap #4).
 *
 * The UI hides privileged buttons per capability, but before this the record /
 * booking / export server actions enforced NOTHING — a crafted request (or a
 * role whose UI was stale) could reach them directly. These tests pin the gate:
 * every mutating action now calls requireCapability()/can() with the SAME
 * capability the UI uses, and denies cleanly in that action's own error
 * contract (never a raw crash).
 *
 * The capability layer itself (@/lib/auth/require-permission) is mocked so each
 * test drives "granted" vs "denied" directly; resolution from presets/overrides
 * is covered by the permissions unit tests. What matters here is that the ACTION
 * consults the gate for the RIGHT capability and handles the denial correctly.
 *
 * CAPABILITY ↔ ACTION (must match src/lib/auth/permissions.ts presets):
 *   records.write   → saveKaruteRecord(Inline), createManualKaruteRecord,
 *                     regenerateKaruteEntries,
 *                     updateKaruteSummary   (owner/manager/senior/practitioner)
 *   records.delete  → deleteKaruteRecord    (owner/manager/senior)
 *                     deleteCustomerPhoto   (Liam ruling 8/9 — photo delete is
 *                                            the same destructive tier)
 *                     + cross-staff assign on createManualKaruteRecord
 *   bookings.manage → createAppointment, updateAppointment, deleteAppointment
 *                     (every preset except empty custom)
 */

import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}))
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined })),
}))

// getOrgSettings feeds createAppointment's hours validation — permissive so the
// only thing that can block a booking here is the capability gate.
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: null })),
}))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  getDefaultStoreId: jest.fn(async () => null),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
}))

// Signed-in user's own staff id — the "self" for the createManualKaruteRecord
// spoof check.
const SELF_STAFF_ID = 'staff-self'
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => SELF_STAFF_ID),
  // loadKaruteWindow's fan-out (round 4): without these the action died on an
  // undefined import before ever reaching the read, which made the leap-date
  // test below pass VACUOUSLY.
  getStaffList: jest.fn(async () => []),
}))

// Same fan-out. Mutations in this suite never touch the customer list, so a
// bare [] is enough for the row projection to run.
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomersCached: jest.fn(async () => []),
}))

// Best-effort side-effects of saveKaruteRecord — no-op so the test focuses on
// the gate, never on outcome/memory writes.
jest.mock('@/lib/karute/outcome', () => ({ setKaruteOutcome: jest.fn(async () => {}) }))
jest.mock('@/lib/karute/memory-ingest', () => ({ ingestSessionMemory: jest.fn(async () => {}) }))

// Define every spy INSIDE its jest.mock factory (const decls aren't hoisted, so
// an outer variable would hit the TDZ "cannot access before initialization").
// References are pulled back out via the mocked modules after the imports.

// @synqed-kk/client ships ESM jest can't parse; appointments.ts imports
// SynqedError from it. Stub it (only SynqedError is referenced at module load).
jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  return { SynqedError }
})

// --- The gate under test: driven per-test via grant()/deny(). ---
// Karute store default now resolves via resolveStoreScope (RBAC clamp). These
// suites don't exercise store scoping, so stub it to the all-stores lens.
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: null, viewAll: true, allowedStoreIds: null })),
  storeStaffIdSet: jest.fn(async () => null),
}))

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

// --- synqed client: every mutation is a spy so we can assert "never reached". ---
jest.mock('@/lib/synqed/client', () => {
  const karuteRecords = {
    create: jest.fn(async () => ({ id: 'karute-1' })),
    delete: jest.fn(async () => ({})),
    addEntry: jest.fn(async () => ({ id: 'entry-1' })),
    deleteEntry: jest.fn(async () => ({})),
    get: jest.fn(async () => ({ entries: [] })),
    update: jest.fn(async () => ({})),
    list: jest.fn(async () => ({ karute_records: [], total: 0 })),
  }
  const appointments = {
    create: jest.fn(async () => ({ id: 'appt-1' })),
    // Realistic { customer_id, store_id } return (FIX 7e): prevents a future
    // undefined-target trap if this file ever exercises a granted update.
    update: jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-1' })),
    delete: jest.fn(async () => ({})),
    get: jest.fn(async () => null),
  }
  const staffStores = { get: jest.fn(async () => ({ store_ids: [] })) }
  // loadKaruteWindow's row projection translates synqed staff ids (round 4).
  const staff = { list: jest.fn(async () => ({ staff: [] })) }
  const stores = { list: jest.fn(async () => ({ stores: [] })) }
  // deleteAppointmentCore's burn-dedup guard (FIX 8) reads this before every
  // delete — this suite never exercises a burned booking, so [] every time.
  const packs = { listRecentRedemptions: jest.fn(async () => []) }
  // Save-gate consent check (src/actions/karute.ts) — current-version consent
  // by default so this suite's RBAC assertions reach create() untouched.
  const customers = {
    getConsent: jest.fn(async () => ({
      consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
    })),
    // records.delete gate on deleteCustomerPhoto — spied so denial can assert
    // the core was never reached.
    deletePhoto: jest.fn(async () => undefined),
    // The action now runs the facade's proofs before the delete (tenancy →
    // proveCustomerInBusiness reads customers.get; ownership →
    // provePhotoForCustomer reads customers.listPhotos). Oracles: cust-1 is
    // this business's, photo-1 is cust-1's — anything else fails the proof.
    get: jest.fn(async (id: string) => {
      if (id !== 'cust-1') throw new Error('cross-tenant')
      return { id, name: '山田' }
    }),
    listPhotos: jest.fn(async () => ({ photos: [{ id: 'photo-1' }] })),
  }
  const client = { karuteRecords, appointments, staffStores, stores, customers, packs, staff }
  return { getSynqedClient: jest.fn(async () => client) }
})

import {
  saveKaruteRecord,
  saveKaruteRecordInline,
  deleteKaruteRecord,
  createManualKaruteRecord,
  loadKaruteWindow,
} from '@/actions/karute'
import {
  regenerateKaruteEntries,
  updateKaruteSummary,
} from '@/actions/regenerate-karute'
import {
  createAppointment,
  updateAppointment,
  deleteAppointment,
} from '@/actions/appointments'
import { deleteCustomerPhoto } from '@/actions/customers'

// Pull the spies back out of the mocked modules (defined inside their
// factories above) for readable, typed access in the test bodies.
import { requireCapability as requireCapabilityImport, can as canImport } from '@/lib/auth/require-permission'
import { getSynqedClient } from '@/lib/synqed/client'

const requireCapability = requireCapabilityImport as jest.Mock
const can = canImport as jest.Mock
// Resolve the client once — the factory returns the same object every call.
let karuteRecords: {
  create: jest.Mock; delete: jest.Mock; addEntry: jest.Mock; deleteEntry: jest.Mock;
  get: jest.Mock; update: jest.Mock; list: jest.Mock
}
let appointments: { create: jest.Mock; update: jest.Mock; delete: jest.Mock; get: jest.Mock }
let customers: { getConsent: jest.Mock; deletePhoto: jest.Mock }
beforeAll(async () => {
  const client = await getSynqedClient()
  karuteRecords = client.karuteRecords as unknown as typeof karuteRecords
  appointments = client.appointments as unknown as typeof appointments
  customers = client.customers as unknown as typeof customers
})

const DENIAL = 'You do not have permission to perform this action.'

/** Make requireCapability throw and can() return false for a given capability. */
function deny(capability: string) {
  requireCapability.mockImplementation(async (cap: string) => {
    if (cap === capability) throw new Error(DENIAL)
  })
  can.mockImplementation(async (cap: string) => cap !== capability)
}

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  can.mockImplementation(async () => true)
})

const baseSave = {
  customerId: 'cust-1',
  transcript: 't',
  summary: 's',
  entries: [] as [],
}

describe('RBAC — records.write actions', () => {
  it('saveKaruteRecord requires records.write; denial returns { error } and never writes', async () => {
    deny('records.write')
    const result = await saveKaruteRecord({ ...baseSave })
    expect(requireCapability).toHaveBeenCalledWith('records.write')
    expect(result).toEqual({ error: DENIAL })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('saveKaruteRecord with records.write reaches the synqed create', async () => {
    // redirect() throws NEXT_REDIRECT on success — swallow it; the create call
    // is the observable "went through" signal.
    await saveKaruteRecord({ ...baseSave }).catch(() => {})
    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
  })

  it('saveKaruteRecordInline requires records.write; denial returns { error }', async () => {
    deny('records.write')
    const result = await saveKaruteRecordInline({ ...baseSave })
    expect(result).toEqual({ error: DENIAL })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('saveKaruteRecordInline with records.write returns the new id', async () => {
    const result = await saveKaruteRecordInline({ ...baseSave })
    expect(result).toEqual({ id: 'karute-1' })
  })

  it('regenerateKaruteEntries requires records.write; denial returns { error } and does not mutate', async () => {
    deny('records.write')
    const result = await regenerateKaruteEntries('k-1', [
      { category: 'symptom', title: 'x', confidence_score: 0.9, source_quote: '' },
    ])
    expect(result).toEqual({ error: DENIAL })
    expect(karuteRecords.addEntry).not.toHaveBeenCalled()
    expect(karuteRecords.deleteEntry).not.toHaveBeenCalled()
  })

  it('updateKaruteSummary requires records.write; denial returns { error }', async () => {
    deny('records.write')
    const result = await updateKaruteSummary('k-1', 'new summary')
    expect(result).toEqual({ error: DENIAL })
    expect(karuteRecords.update).not.toHaveBeenCalled()
  })
})

describe('RBAC — records.delete', () => {
  it('deleteKaruteRecord requires records.delete; denial returns { error } and never deletes', async () => {
    deny('records.delete')
    const result = await deleteKaruteRecord('k-1')
    expect(requireCapability).toHaveBeenCalledWith('records.delete')
    expect(result).toEqual({ error: DENIAL })
    expect(karuteRecords.delete).not.toHaveBeenCalled()
  })

  it('deleteKaruteRecord with records.delete deletes', async () => {
    const result = await deleteKaruteRecord('k-1')
    expect(result).toEqual({ success: true })
    expect(karuteRecords.delete).toHaveBeenCalledWith('k-1')
  })

  it('deleteCustomerPhoto requires records.delete; denial returns { success: false } and never deletes', async () => {
    deny('records.delete')
    const result = await deleteCustomerPhoto('cust-1', 'photo-1')
    expect(requireCapability).toHaveBeenCalledWith('records.delete')
    expect(result).toEqual({ success: false, error: DENIAL })
    expect(customers.deletePhoto).not.toHaveBeenCalled()
  })

  it('deleteCustomerPhoto with records.delete deletes', async () => {
    const result = await deleteCustomerPhoto('cust-1', 'photo-1')
    expect(result).toEqual({ success: true })
    expect(customers.deletePhoto).toHaveBeenCalledWith('cust-1', 'photo-1')
  })

  // The capability is not the whole gate: the action carries the facade
  // route's tenancy + ownership proofs too, so a GRANTED caller still can't
  // reach another business's customer or another customer's photo. Mutation
  // anchor — dropping either prove* call turns one of these red.
  it('cross-tenant customer id → never deletes, even with records.delete (tenancy proof)', async () => {
    const result = await deleteCustomerPhoto('cust-other', 'photo-1')
    expect(result.success).toBe(false)
    expect(customers.deletePhoto).not.toHaveBeenCalled()
  })

  it("another customer's photoId → never deletes, even with records.delete (ownership proof)", async () => {
    const result = await deleteCustomerPhoto('cust-1', 'someone-elses-photo')
    expect(result.success).toBe(false)
    expect(customers.deletePhoto).not.toHaveBeenCalled()
  })
})

describe('RBAC — createManualKaruteRecord (records.write + staffId spoof guard)', () => {
  const base = {
    customerId: 'cust-1',
    sessionDate: '2026-07-01',
    durationMinutes: 60,
    service: 'cut',
  }

  it('requires records.write; denial returns { error } and never creates', async () => {
    deny('records.write')
    const result = await createManualKaruteRecord({ ...base, staffId: SELF_STAFF_ID })
    expect(result).toEqual({ error: DENIAL })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('assigning a record to YOURSELF needs only records.write', async () => {
    await createManualKaruteRecord({ ...base, staffId: SELF_STAFF_ID }).catch(() => {})
    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: SELF_STAFF_ID }),
    )
  })

  it('assigning to ANOTHER staff is rejected without records.delete (spoof guard)', async () => {
    // Has records.write, lacks records.delete → cross-staff assignment blocked.
    can.mockImplementation(async (cap: string) => cap !== 'records.delete')
    const result = await createManualKaruteRecord({ ...base, staffId: 'someone-else' })
    expect(result).toEqual({
      error: 'You do not have permission to record a session for another staff member.',
    })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('a supervisor (records.delete) MAY backdate a record for another staff', async () => {
    // requireCapability passes (has records.write) and can('records.delete')=true.
    await createManualKaruteRecord({ ...base, staffId: 'someone-else' }).catch(() => {})
    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'someone-else' }),
    )
  })
})

describe('RBAC — bookings.manage actions', () => {
  const bookingInput = {
    staffProfileId: 'staff-self',
    clientId: 'cust-1',
    startTime: new Date('2026-07-01T02:00:00.000Z').toISOString(),
    durationMinutes: 60,
    tzOffsetMinutes: -540,
  }

  it('createAppointment requires bookings.manage; denial returns { error } and never books', async () => {
    can.mockImplementation(async (cap: string) => cap !== 'bookings.manage')
    const result = await createAppointment(bookingInput)
    expect(can).toHaveBeenCalledWith('bookings.manage')
    expect(result).toEqual({ error: 'You do not have permission to manage bookings.' })
    expect(appointments.create).not.toHaveBeenCalled()
  })

  it('createAppointment with bookings.manage books', async () => {
    const result = await createAppointment(bookingInput)
    expect(result).toEqual({ id: 'appt-1' })
    expect(appointments.create).toHaveBeenCalledTimes(1)
  })

  it('updateAppointment requires bookings.manage; denial returns { error }', async () => {
    deny('bookings.manage')
    const result = await updateAppointment('appt-1', { durationMinutes: 45 })
    expect(result).toEqual({ error: DENIAL })
    expect(appointments.update).not.toHaveBeenCalled()
  })

  it('deleteAppointment requires bookings.manage; denial returns { error }', async () => {
    deny('bookings.manage')
    const result = await deleteAppointment('appt-1')
    expect(result).toEqual({ error: DENIAL })
    expect(appointments.delete).not.toHaveBeenCalled()
  })

  it('deleteAppointment with bookings.manage deletes', async () => {
    // deleteAppointmentCore reads the row first (the module default above
    // returns null, matching the "booking not found" shape most of this
    // suite doesn't care about) — give it a real row so the delete is reached.
    // starts_at/created_at feed the burn-dedup guard's window (FIX 8).
    appointments.get.mockResolvedValueOnce({
      customer_id: 'cust-1',
      store_id: 'store-1',
      starts_at: '2026-07-06T03:00:00.000Z',
      created_at: '2026-07-06T03:00:00.000Z',
    })
    const result = await deleteAppointment('appt-1')
    expect(result).toEqual({ success: true })
    expect(appointments.delete).toHaveBeenCalledWith('appt-1')
  })
})

// Not an RBAC gate — parked in THIS suite because it is the one harness that
// already boots the real @/actions/karute module (a second 60-line mock header
// duplicating it would be worse than the topical stretch). The capability gate
// stays granted throughout, so the ONLY thing that can refuse here is the
// calendar check itself.
describe('loadKaruteWindow refuses calendar-impossible input (Greptile PR #779 P1)', () => {
  it('a rolled-over day returns { error }, never a window nobody asked for', async () => {
    // 2026-02-30 does NOT throw in JS — `new Date` slides it to 2026-03-02, so
    // an unvalidated walk would happily read the wrong window and report that
    // boundary back as if the caller had asked for it.
    const result = await loadKaruteWindow({ olderThan: '2026-02-30' })
    expect(result).toEqual({ error: 'olderThan must be a real calendar date (YYYY-MM-DD)' })
    expect(requireCapability).toHaveBeenCalledWith('customers.view')
  })

  it('an impossible month returns { error }, never an Invalid Date thrown out of the walk', async () => {
    const result = await loadKaruteWindow({ month: '2026-13' })
    expect(result).toEqual({ error: 'month must be a real calendar month (YYYY-MM)' })
  })

  it('a REAL leap date passes the gate and reaches the read', async () => {
    const result = await loadKaruteWindow({ olderThan: '2028-02-29' })
    expect(result).not.toEqual(
      expect.objectContaining({ error: expect.stringContaining('real calendar') }),
    )
    // The half that earns the title: the gate not only stayed quiet, the walk
    // actually ran. Without this the test would still pass if the action bailed
    // out somewhere else before ever reading.
    expect(karuteRecords.list).toHaveBeenCalled()
  })
})
