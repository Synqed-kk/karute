// setRecordingSharedWithClient (src/lib/recording/share.ts) — the recorder's
// own 共有 toggle body (⚖ Liam 2026-09-13 sharing law; 2026-09-14 design
// D6/D7). Same harness shape as recording-playback-url.test.ts: the real
// audit() sink runs, captured via the shared console-line spy helper.
//
// What this file owns is THE LAW's own claims:
//   1. only the record's OWN staffer may toggle — no viewAll leg, no
//      owner-hand leg, and an ownerless karute has no one who could consent;
//   2. idempotent: already in the requested state → no write, no audit;
//   3. core's own lock is the SECOND lock, and its refusal surfaces honestly
//      (forbidden + one warn line, ids only) rather than being hidden;
//   4. one recording.share/recording.unshare row per successful write,
//      never on a refusal and never on a no-op.
import { setRecordingSharedWithClient, type ShareActor } from '@/lib/recording/share'
import { auditLines } from './helpers/audit-lines'

const cardLookup = { current: null as string | null }
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupProfileIdForSynqedStaffIdForBusiness: jest.fn(async () => cardLookup.current),
}))

const KARUTE_ID = 'karute-1'
const SESSION_ID = 'session-1'
const ROW_ID = 'row-1'

function actor(overrides: Partial<ShareActor> = {}): ShareActor {
  return {
    actorId: 'auth-user-1',
    staffId: 'staff-1',
    businessId: 'business-1',
    source: 'web',
    ...overrides,
  }
}

function httpError(status: number): Error {
  return Object.assign(new Error(`http ${status}`), { status })
}

function makeClient(opts: {
  karute?: Partial<{
    staff_id: string | null
    store_id: string | null
    recording_session_id: string | null
    customer_id: string | null
  }> | 'missing'
  row?: Partial<{ id: string; store_id: string | null; shared_at: string | null }> | 'missing'
  updateThrows?: { status: number }
} = {}) {
  const karuteGet = jest.fn(async () => {
    if (opts.karute === 'missing') throw httpError(404)
    return {
      staff_id: 'staff-1',
      store_id: null,
      recording_session_id: SESSION_ID,
      customer_id: null,
      ...(opts.karute ?? {}),
    }
  })
  const recordingsGet = jest.fn(async () => {
    if (opts.row === 'missing') throw httpError(404)
    return { id: ROW_ID, store_id: null, shared_at: null, ...(opts.row ?? {}) }
  })
  const update = jest.fn(async (_id: string, _input: unknown) => {
    if (opts.updateThrows) throw httpError(opts.updateThrows.status)
    return {}
  })
  const synqed = {
    karuteRecords: { get: karuteGet },
    recordings: { get: recordingsGet, update },
  } as unknown as Parameters<typeof setRecordingSharedWithClient>[0]
  return { synqed, karuteGet, recordingsGet, update }
}

describe('setRecordingSharedWithClient', () => {
  it('the recorder shares her own recording: writes shared_at + shared_by_staff_id, ONE recording.share row', async () => {
    const { synqed, update } = makeClient()
    const lines = await auditLines(() =>
      setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true }),
    )
    expect(update).toHaveBeenCalledTimes(1)
    const [id, write] = update.mock.calls[0] as [string, { shared_at: unknown; shared_by_staff_id: unknown }]
    expect(id).toBe(ROW_ID)
    expect(typeof write.shared_at).toBe('string')
    expect(write.shared_by_staff_id).toBe('staff-1')

    const shares = lines.filter((l) => l.action === 'recording.share')
    expect(shares).toHaveLength(1)
    expect(shares[0].break_glass).toBe(false)
    expect(shares[0].severity).toBe('notice')
    expect(shares[0].detail).toEqual({ karute_id: KARUTE_ID, staff_id: 'staff-1' })
    expect(lines.filter((l) => l.action === 'recording.unshare')).toHaveLength(0)
  })

  it('the recorder unshares: writes both fields null, ONE recording.unshare row', async () => {
    const { synqed, update } = makeClient({ row: { shared_at: '2026-09-14T00:00:00.000Z' } })
    const lines = await auditLines(() =>
      setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: false }),
    )
    expect(update).toHaveBeenCalledWith(ROW_ID, { shared_at: null, shared_by_staff_id: null })
    expect(lines.filter((l) => l.action === 'recording.unshare')).toHaveLength(1)
    expect(lines.filter((l) => l.action === 'recording.share')).toHaveLength(0)
  })

  it('already shared + share again: changed:false, NO write, NO audit', async () => {
    const { synqed, update } = makeClient({ row: { shared_at: '2026-09-14T00:00:00.000Z' } })
    let result: Awaited<ReturnType<typeof setRecordingSharedWithClient>> | undefined
    const lines = await auditLines(async () => {
      result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    })
    expect(result).toEqual({ ok: true, shared: true, sharedAt: '2026-09-14T00:00:00.000Z', changed: false })
    expect(update).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('already unshared + unshare again: changed:false, no write, no audit', async () => {
    const { synqed, update } = makeClient()
    let result: Awaited<ReturnType<typeof setRecordingSharedWithClient>> | undefined
    const lines = await auditLines(async () => {
      result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: false })
    })
    expect(result).toEqual({ ok: true, shared: false, sharedAt: null, changed: false })
    expect(update).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('a colleague (not the owner, even with viewAll — this door has no viewAll leg, D2) → forbidden, no write', async () => {
    const { synqed, update } = makeClient()
    const result = await setRecordingSharedWithClient(synqed, actor({ staffId: 'someone-else' }), {
      karuteId: KARUTE_ID,
      shared: true,
    })
    expect(result).toEqual({ error: 'forbidden' })
    expect(update).not.toHaveBeenCalled()
  })

  it('an owner-hand holder (not on this roster, staffId null) → forbidden — nobody consents on her behalf (D2)', async () => {
    const { synqed, update } = makeClient()
    const result = await setRecordingSharedWithClient(synqed, actor({ staffId: null }), {
      karuteId: KARUTE_ID,
      shared: true,
    })
    expect(result).toEqual({ error: 'forbidden' })
    expect(update).not.toHaveBeenCalled()
  })

  it('an ownerless karute → forbidden (no one to consent) — the read side\'s "no owner = shared" branch does NOT apply here', async () => {
    const { synqed, update } = makeClient({ karute: { staff_id: null } })
    const result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    expect(result).toEqual({ error: 'forbidden' })
    expect(update).not.toHaveBeenCalled()
  })

  it('core 403 on the write (the two locks disagree, D7) → forbidden, and ONE warn line naming ids only', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { synqed } = makeClient({ updateThrows: { status: 403 } })
    const result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    expect(result).toEqual({ error: 'forbidden' })
    const refusals = warn.mock.calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0]))
        } catch {
          return null
        }
      })
      .filter((j): j is Record<string, unknown> => !!j && j.evt === 'recording_share_core_refused')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toEqual({
      evt: 'recording_share_core_refused',
      business_id: 'business-1',
      karute_id: KARUTE_ID,
      recording_session_id: ROW_ID,
    })
    warn.mockRestore()
  })

  it('404 karute → not_found', async () => {
    const { synqed } = makeClient({ karute: 'missing' })
    const result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    expect(result).toEqual({ error: 'not_found' })
  })

  it('no recording_session_id → no_recording', async () => {
    const { synqed } = makeClient({ karute: { recording_session_id: null } })
    const result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    expect(result).toEqual({ error: 'no_recording' })
  })

  it('row 404 → no_recording', async () => {
    const { synqed } = makeClient({ row: 'missing' })
    const result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    expect(result).toEqual({ error: 'no_recording' })
  })

  it('a non-404 throw on the karute read → upstream', async () => {
    const synqed = {
      karuteRecords: {
        get: jest.fn(async () => {
          throw new Error('blip')
        }),
      },
      recordings: { get: jest.fn(), update: jest.fn() },
    } as unknown as Parameters<typeof setRecordingSharedWithClient>[0]
    const result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    expect(result).toEqual({ error: 'upstream' })
  })

  it('a non-404 throw on the write → upstream, never forbidden', async () => {
    const { synqed, update } = makeClient({ updateThrows: { status: 500 } })
    const result = await setRecordingSharedWithClient(synqed, actor(), { karuteId: KARUTE_ID, shared: true })
    expect(result).toEqual({ error: 'upstream' })
    expect(update).toHaveBeenCalledTimes(1)
  })
})
