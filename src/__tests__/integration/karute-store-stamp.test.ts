/**
 * Coverage for store_id resolution on karute-record writes.
 *
 * synqed-core PR #18 added store_id to karute_records and store-filtered list
 * reads (src/lib/karute/synqed-records.ts — "Core honors store_id"), but every
 * karuteRecords.create() call site sent none — every new record was
 * store-less in a multi-store business. Resolution order:
 *   1. appointmentId present → the BOOKING's store (the truth of where the
 *      session happened) — read via readAppointmentForSave; a booking that
 *      cannot be used (404 / out of scope / unreadable after one retry) saves
 *      into the caller's lens instead, never refused, never NULL-store
 *   2. no appointmentId → resolveStoreScope().storeId (the RBAC-clamped store:
 *      active-store cookie for cross-store viewers, but a branch-restricted staff
 *      is clamped to their assigned store; never mint a NULL-store record for a
 *      viewer who just hasn't touched the switcher)
 */
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'
import { UNASSIGNED_STORE_DENIAL } from '@/lib/auth/store-gate'

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
// The save path's best-effort memory ingest reaches getCustomerMemory, which
// makes a REAL postgrest fetch to the dummy Supabase URL — unmocked outbound
// I/O in a unit suite. It fails fast on a dev box (swallowed, tests pass) but
// its timing is environment-dependent, and on a 2-core CI runner it blew this
// suite's assertions past the default timeout (run 31320631423). Nothing here
// asserts on memory, so stub it: no network, no flake.
jest.mock('@/lib/karute/memory-ingest', () => ({
  ingestSessionMemory: jest.fn(async () => {}),
  backfillMemoryFromTranscripts: jest.fn(async () => {}),
}))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))

jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'me-staff'),
}))

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

const resolveStoreScopeMock = jest.fn()
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: (...args: unknown[]) => resolveStoreScopeMock(...args),
}))
// Helper: wrap a storeId in the StoreScope shape resolveStoreScope returns.
const scope = (storeId: string | null) => ({ storeId, viewAll: false, allowedStoreIds: null })

const karuteRecords = { create: jest.fn() }
const appointments = { get: jest.fn() }
// Save-gate consent check (src/actions/karute.ts) — current-version consent by
// default so this suite's store_id assertions reach create() untouched.
const customers = {
  getConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords, appointments, customers })),
}))

import { saveKaruteRecordInline, saveKaruteRecord, createManualKaruteRecord } from '@/actions/karute'

const baseInput = { customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [] }

beforeEach(() => {
  jest.clearAllMocks()
  karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
  // Default: an unrestricted (viewAll / floating) scope so the appointment-store
  // authz clamp is satisfied. Per-test overrides set a restricted scope.
  resolveStoreScopeMock.mockResolvedValue(scope('store-default'))
})

describe('saveKaruteRecordInline — store_id resolution', () => {
  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: degraded scope + appointment refuses before create', async (save) => {
    resolveStoreScopeMock.mockResolvedValue({
      storeId: null, viewAll: false, allowedStoreIds: null, degraded: true,
    })
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'me-staff', store_id: 'store-A' })

    expect(await save({ ...baseInput, appointmentId: 'ap-1' })).toEqual({ error: STORE_SCOPE_UNVERIFIED, code: 'store_forbidden' })
    expect(karuteRecords.create).not.toHaveBeenCalled()
    expect(appointments.get).not.toHaveBeenCalled()
    expect(resolveStoreScopeMock).toHaveBeenCalledTimes(1)
  })

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: unassigned scope + NULL-store appointment refuses before create', async (save) => {
    resolveStoreScopeMock.mockResolvedValue({
      storeId: null, viewAll: false, allowedStoreIds: [], degraded: false,
    })
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'me-staff', store_id: null })

    expect(await save({ ...baseInput, appointmentId: 'ap-1' })).toEqual({ error: UNASSIGNED_STORE_DENIAL })
    expect(karuteRecords.create).not.toHaveBeenCalled()
    expect(appointments.get).not.toHaveBeenCalled()
    expect(resolveStoreScopeMock).toHaveBeenCalledTimes(1)
  })

  it("(a) with appointmentId: stamps the BOOKING's store_id (authz-checked, in scope)", async () => {
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'other-staff', store_id: 'store-A' })
    // In-scope caller (assigned to store-A) → the clamp passes and the record
    // is stamped with the booking's store.
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-A',
      viewAll: false,
      allowedStoreIds: ['store-A'],
    })

    await saveKaruteRecordInline({ ...baseInput, appointmentId: 'ap-1' })

    expect(appointments.get).toHaveBeenCalledWith('ap-1')
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: 'ap-1', store_id: 'store-A' }),
    )
  })

  it('(e) OUT-OF-SCOPE appointmentId: saves into the caller\'s own store, with no booking link', async () => {
    // A branch-restricted staff (銀座-only) handed a 代官山 booking id: the record
    // is kept (⚖ never lose a karute) but lands in 銀座 — never stamped into
    // 代官山 — and carries neither the link nor the booking's menu.
    appointments.get.mockResolvedValue({ id: 'ap-x', staff_id: 'other-staff', store_id: 'store-daikanyama', title: '代官山の施術' })
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })

    const res = await saveKaruteRecordInline({ ...baseInput, appointmentId: 'ap-x' })

    expect(res).not.toHaveProperty('error')
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza', appointment_id: null, service: null }),
    )
  })

  it('(f) in-scope appointmentId for a restricted staff: still saves with the booking store', async () => {
    appointments.get.mockResolvedValue({ id: 'ap-g', staff_id: 'other-staff', store_id: 'store-ginza' })
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })

    await saveKaruteRecordInline({ ...baseInput, appointmentId: 'ap-g' })

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: 'ap-g', store_id: 'store-ginza' }),
    )
  })

  it('(b) without appointmentId: stamps the resolved store scope (clamped, cookie, else primary)', async () => {
    resolveStoreScopeMock.mockResolvedValue(scope('store-B'))

    await saveKaruteRecordInline({ ...baseInput })

    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: null, store_id: 'store-B' }),
    )
  })

  it('(b2) branch-restricted staff, unset cookie: stamps their ASSIGNED store, not the primary', async () => {
    // resolveStoreScope clamps a restricted staff with no cookie to their first
    // assigned store (store-ginza) — the write-side twin of the dashboard leak,
    // where getDefaultStoreId would have stamped the business primary (代官山).
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })

    await saveKaruteRecordInline({ ...baseInput })

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: null, store_id: 'store-ginza' }),
    )
  })

  it('(c) without appointmentId and no resolved store (business has no stores): null', async () => {
    resolveStoreScopeMock.mockResolvedValue(scope(null))

    await saveKaruteRecordInline({ ...baseInput })

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: null }),
    )
  })

  it('(d) appointment not found: saved into the viewer\'s store with no link, never a NULL-store record', async () => {
    appointments.get.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    resolveStoreScopeMock.mockResolvedValue(scope('store-B'))

    await saveKaruteRecordInline({ ...baseInput, appointmentId: 'missing' })

    // A dangling id is dropped; the record lands in the viewer's verified lens
    // so it shows in their store's カルテ list instead of vanishing.
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: null, store_id: 'store-B', service: null }),
    )
    expect(appointments.get).toHaveBeenCalledTimes(1)
  })
})

describe('a booking that cannot be used never loses the karute (both web doors)', () => {
  // ⚖ 9/12 matrix: the three degraded arms are mutually exclusive outcomes of ONE read, so the matrix = each arm alone + the all-OK pins ((a)/(f)) unchanged.
  const notFound = () => Object.assign(new Error('not found'), { status: 404 })
  const blip = () => Object.assign(new Error('upstream'), { status: 503 })
  const ginza = () =>
    resolveStoreScopeMock.mockResolvedValue({ storeId: 'store-ginza', viewAll: false, allowedStoreIds: ['store-ginza'] })

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: booking not found → saved in the caller\'s store, link dropped, one read', async (save) => {
    ginza()
    appointments.get.mockRejectedValue(notFound())

    await save({ ...baseInput, appointmentId: 'ap-gone' }).catch(() => {})

    expect(appointments.get).toHaveBeenCalledTimes(1)
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza', appointment_id: null, service: null }),
    )
  })

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: booking in another store → saved in the caller\'s store, link and menu dropped', async (save) => {
    ginza()
    appointments.get.mockResolvedValue({ id: 'ap-x', staff_id: 'other', store_id: 'store-daikanyama', title: '代官山の施術' })

    await save({ ...baseInput, appointmentId: 'ap-x' }).catch(() => {})

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza', appointment_id: null, service: null }),
    )
  })

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: a blip then a good read → a normal save with the booking\'s store, link and menu', async (save) => {
    ginza()
    appointments.get
      .mockRejectedValueOnce(blip())
      .mockResolvedValueOnce({ id: 'ap-g', staff_id: 'other', store_id: 'store-ginza', title: 'VIP施術' })

    await save({ ...baseInput, appointmentId: 'ap-g' }).catch(() => {})

    expect(appointments.get).toHaveBeenCalledTimes(2)
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza', appointment_id: 'ap-g', service: 'VIP施術' }),
    )
  })

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: booking unreadable twice → saved in the caller\'s store, link KEPT, no menu', async (save) => {
    ginza()
    appointments.get.mockRejectedValue(blip())

    await save({ ...baseInput, appointmentId: 'ap-g' }).catch(() => {})

    expect(appointments.get).toHaveBeenCalledTimes(2)
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza', appointment_id: 'ap-g', service: null }),
    )
  })
  it('saveKaruteRecord: a booking with no store keeps today\'s behaviour (link and menu kept, store null)', async () => {
    // Pins the `apptStore &&` guard: a clamped caller + a booking that reads OK
    // with store_id null is NOT out of scope — pre-existing behaviour, unchanged.
    ginza()
    appointments.get.mockResolvedValue({ id: 'ap-n', staff_id: 'other', store_id: null, title: 'ストア無し施術' })

    await saveKaruteRecord({ ...baseInput, appointmentId: 'ap-n' }).catch(() => {})

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: null, appointment_id: 'ap-n', service: 'ストア無し施術' }),
    )
  })
})

describe('web saves — no staff identity is refused; the booking\'s staff is never stamped (web = facade, #990)', () => {
  // The record carries the signed-in staff's id only. An account the roster
  // cannot place is refused before any booking is read — whatever the booking
  // would have said (readable, out of scope, 404, unreadable).
  const notFound = () => Object.assign(new Error('not found'), { status: 404 })
  const blip = () => Object.assign(new Error('upstream'), { status: 503 })
  const noIdentity = async () => {
    const { getCurrentUserStaffId } = await import('@/lib/staff')
    ;(getCurrentUserStaffId as jest.Mock).mockResolvedValueOnce(null)
  }
  const refused = { error: 'No staff identity for the signed-in user.' }

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: no staff identity + a readable in-scope booking → refused, the booking is never read', async (save) => {
    await noIdentity()
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'appt-staff', store_id: 'store-C', title: 'VIP施術' })

    expect(await save({ ...baseInput, appointmentId: 'ap-1' })).toEqual(refused)
    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  // S14 blind read (evidence/S14/blind/PROOF-out-of-scope-staff-leak.diff):
  // the old fallback took the booking's staff_id BEFORE the store clamp ran,
  // so an out-of-scope booking id stamped a foreign store's staff.
  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: no staff identity + an OUT-OF-SCOPE booking → refused, the foreign staff is never stamped', async (save) => {
    await noIdentity()
    resolveStoreScopeMock.mockResolvedValue({ storeId: 'store-ginza', viewAll: false, allowedStoreIds: ['store-ginza'] })
    appointments.get.mockResolvedValue({ id: 'ap-x', staff_id: 'daikanyama-staff', store_id: 'store-daikanyama', title: '代官山の施術' })

    expect(await save({ ...baseInput, appointmentId: 'ap-x' })).toEqual(refused)
    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: no staff identity + booking 404 → refused, no read', async (save) => {
    await noIdentity()
    appointments.get.mockRejectedValue(notFound())

    expect(await save({ ...baseInput, appointmentId: 'ap-1' })).toEqual(refused)
    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it.each([saveKaruteRecord, saveKaruteRecordInline])('%p: no staff identity + booking unreadable → refused, no read', async (save) => {
    await noIdentity()
    appointments.get.mockRejectedValue(blip())

    expect(await save({ ...baseInput, appointmentId: 'ap-1' })).toEqual(refused)
    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })
})

describe('recorded saves copy the booked menu + recording minutes (7/29 field report)', () => {
  // Field case: every recorded karute rendered 「— · 51分」 in the カルテ list —
  // the service column was only ever written by the manual 新規カルテ dialog,
  // and the web save threw the recording duration away.
  const inScopeBooking = () => {
    appointments.get.mockResolvedValue({
      id: 'ap-1',
      staff_id: 'other-staff',
      store_id: 'store-A',
      title: 'VIP施術',
    })
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-A',
      viewAll: false,
      allowedStoreIds: ['store-A'],
    })
  }

  it('saveKaruteRecord: service = the booked menu, duration_minutes from the take seconds', async () => {
    inScopeBooking()
    await saveKaruteRecord({ ...baseInput, appointmentId: 'ap-1', duration: 3070 }).catch(() => {})
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'VIP施術', duration_minutes: 51 }),
    )
  })

  it('saveKaruteRecordInline (autosave): same fill', async () => {
    inScopeBooking()
    await saveKaruteRecordInline({ ...baseInput, appointmentId: 'ap-1', duration: 3070 })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'VIP施術', duration_minutes: 51 }),
    )
  })

  it('walk-in (no booking): service stays null, minutes still recorded', async () => {
    await saveKaruteRecordInline({ ...baseInput, duration: 125 })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ service: null, duration_minutes: 2 }),
    )
  })

  it('no duration on the input: duration_minutes null, never 0', async () => {
    await saveKaruteRecordInline({ ...baseInput })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ service: null, duration_minutes: null }),
    )
  })

  it('negative duration never persists as negative minutes (trust boundary)', async () => {
    await saveKaruteRecordInline({ ...baseInput, duration: -300 })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ duration_minutes: null }),
    )
  })

  it('a sub-30s take persists 1分, never a 0 the renderers hide (Greptile r2 on #646)', async () => {
    await saveKaruteRecordInline({ ...baseInput, duration: 20 })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ duration_minutes: 1 }),
    )
  })
})

describe('createManualKaruteRecord — store_id resolution', () => {
  it('has no appointment concept: always falls back to the resolved store scope', async () => {
    resolveStoreScopeMock.mockResolvedValue(scope('store-D'))

    await createManualKaruteRecord({
      customerId: 'cust-1',
      staffId: 'me-staff',
      sessionDate: '2026-07-01',
      durationMinutes: 60,
      service: 'cut',
    }).catch(() => {})

    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-D' }),
    )
  })
})
