/**
 * Deliberate-discard session cleanup (Build F1 fix round 3) — the shared choke
 * point and its two doors.
 *
 * The thing this feature gets wrong if nobody pins it: core's
 * `DELETE /recordings/:id` is BUSINESS-scoped, so without the app-side owner
 * check a staffer's discard could delete a COLLEAGUE'S session row — which the
 * colleague's inbox would then silently lose. That check, and the fact that a
 * refusal deletes nothing, is the security contract here.
 */
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
const auditSpy = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditSpy(e) }))
/** Storage's own answer about the reserved key. The cleanup asks it because the
 *  POINTER stopped being an answer: since PR2 fix round 10 a session is BORN
 *  RESERVED, so every recorder-made row carries a key before a byte exists. */
const mockObjectExists = jest.fn(async (_key: string): Promise<boolean | 'unknown'> => false)
jest.mock('@/lib/recording/mint-take-url', () => ({
  objectExists: (key: string) => mockObjectExists(key),
}))

import { deleteRecordingSessionWithClient } from '@/lib/recording/session-cleanup'

const ME = 'auth-user-1'
const actor = { staffId: ME, businessId: 'business-1', source: 'web' as const }

type Row = {
  id: string
  staff_id: string
  customer_id: string | null
  audio_storage_path: string | null
  duration_seconds: number | null
  /** Optional so the "a row with no status at all" case below is expressible —
   *  it is the same unknown as a status past RECORDING, and kept for it. */
  status?: string
}
/** ⚖ capture pipeline PR4: the ONLY removable row is one that points at no
 *  audio. `audio_storage_path` is the single way back to a take's finalized
 *  object — core has no lookup by key — so removing a row that carries one
 *  would leave the recording in the bucket with nothing naming it. */
const MY_ROW: Row = {
  id: 'sess-1',
  staff_id: ME,
  customer_id: 'cust-1',
  audio_storage_path: null,
  duration_seconds: 137,
  status: 'RECORDING',
}
/** BORN RESERVED (PR2 fix round 10): the ordinary shape of a row a recorder
 *  made — a key on it, still RECORDING, and no bytes anywhere. */
const ROW_WITH_AUDIO: Row = { ...MY_ROW, audio_storage_path: 'app_business-1_take-1.webm' }

const get = jest.fn(async (_id: string): Promise<Row> => MY_ROW)
const del = jest.fn(async (_id: string): Promise<void> => {})
/** The provenance probe. Default = a definitive 404: no karute for this
 *  session, so the row really is an orphan. */
const notFound = () => Object.assign(new Error('no record'), { status: 404 })
const getByRecordingSession = jest.fn(async (_id: string): Promise<unknown> => {
  throw notFound()
})
const client = {
  recordings: { get, delete: del },
  karuteRecords: { getByRecordingSession },
} as never

beforeEach(() => {
  jest.clearAllMocks()
  get.mockImplementation(async () => MY_ROW)
  del.mockImplementation(async () => {})
  getByRecordingSession.mockImplementation(async () => {
    throw notFound()
  })
  mockObjectExists.mockImplementation(async () => false)
})

describe('deleteRecordingSessionWithClient — ownership', () => {
  it('deletes the row and writes ONE audit event for the owner', async () => {
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      ok: true,
    })
    expect(del).toHaveBeenCalledWith('sess-1')
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy.mock.calls[0][0]).toMatchObject({
      action: 'recording.session_cleanup',
      actorId: ME,
      businessId: 'business-1',
      targetType: 'recording',
      targetId: 'sess-1',
      source: 'web',
    })
  })

  it('the audit detail is IDS AND FLAGS ONLY — no path, no content', async () => {
    await deleteRecordingSessionWithClient(client, actor, 'sess-1')
    const detail = (auditSpy.mock.calls[0][0] as { detail: Record<string, unknown> }).detail
    // Deliberately widened (recording-labels fix): duration_seconds rides
    // along ids-and-flags-safe — it feeds the 監査ログ subtitle since the
    // session row itself is hard-deleted at cleanup time.
    expect(detail).toEqual({ customer_id: 'cust-1', had_audio_path: false, duration_seconds: 137 })
    expect(JSON.stringify(detail)).not.toContain('app_business-1')
  })

  it('⚖ a row whose reserved object HOLDS BYTES is refused — the pointer is the only way back', async () => {
    get.mockResolvedValue(ROW_WITH_AUDIO)
    mockObjectExists.mockResolvedValue(true)
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'has_audio',
    })
    expect(mockObjectExists).toHaveBeenCalledWith('app_business-1_take-1.webm')
    expect(del).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  // ⚖ THE POINTER ALONE IS NOT AN ANSWER (PR4 fix round 1). Every row a
  // current recorder makes is BORN with its key, before one byte exists —
  // refusing on the pointer refused every row and made this whole cleanup a
  // silent no-op for the SYSTEM/abandoned paths it exists to serve.
  it('a BORN-RESERVED row with no bytes on storage is still removable', async () => {
    get.mockResolvedValue(ROW_WITH_AUDIO)
    mockObjectExists.mockResolvedValue(false)
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      ok: true,
    })
    expect(del).toHaveBeenCalledWith('sess-1')
  })

  it('a status past RECORDING is refused without even asking storage', async () => {
    get.mockResolvedValue({ ...ROW_WITH_AUDIO, status: 'UPLOADING' })
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'has_audio',
    })
    expect(mockObjectExists).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  // ⚖ THE RESCUED ROW IS SAFE HERE, AND THIS IS WHY IT MATTERS (ADDENDUM 9.2
  // M4, Liam 2026-09-06 "b"). A `rsc/` object is findable ONLY through a live
  // row — nothing else on the server names it, and the capture_resumed audit
  // row carries the ids to reach it by hand. So this refusal is what keeps a
  // rescued take reachable at all. It is refused by the STATUS leg, before any
  // probe: a rescued row is UPLOADING, which is already past RECORDING. No code
  // changed for this; the pin is here so nothing can quietly change it.
  it('a RESCUED-shaped row is refused before any probe — the rescue stays reachable', async () => {
    get.mockResolvedValue({
      ...ROW_WITH_AUDIO,
      // UPLOADING, no duration, the pointer set — and, on storage, nothing at
      // the pointer and a rebuilt object at `rsc/` beside it.
      status: 'UPLOADING',
      duration_seconds: null,
    })
    mockObjectExists.mockImplementation(async (key: string) => key.startsWith('rsc/'))
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'has_audio',
    })
    expect(mockObjectExists).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('a row with NO status is the same unknown — kept', async () => {
    get.mockResolvedValue({ ...MY_ROW, status: undefined })
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'has_audio',
    })
    expect(del).not.toHaveBeenCalled()
  })

  it('a storage probe that cannot answer keeps the row — never a delete on an unknown', async () => {
    get.mockResolvedValue(ROW_WITH_AUDIO)
    mockObjectExists.mockResolvedValue('unknown')
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'read_failed',
    })
    expect(del).not.toHaveBeenCalled()

    mockObjectExists.mockRejectedValue(new Error('storage down'))
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'read_failed',
    })
    expect(del).not.toHaveBeenCalled()
  })

  it('the audio gate runs BEFORE the delete and after the record probe — one refusal, nothing touched', async () => {
    get.mockResolvedValue(ROW_WITH_AUDIO)
    mockObjectExists.mockResolvedValue(true)
    await deleteRecordingSessionWithClient(client, actor, 'sess-1')
    expect(getByRecordingSession).toHaveBeenCalledWith('sess-1')
    expect(del).not.toHaveBeenCalled()
  })

  it('a row with no duration on record stamps duration_seconds: null, never undefined', async () => {
    get.mockResolvedValue({ ...MY_ROW, duration_seconds: null })
    await deleteRecordingSessionWithClient(client, actor, 'sess-1')
    const detail = (auditSpy.mock.calls[0][0] as { detail: Record<string, unknown> }).detail
    expect(detail.duration_seconds).toBeNull()
  })

  it('ANOTHER staffer’s session is left untouched — no delete, no audit', async () => {
    get.mockResolvedValue({ ...MY_ROW, staff_id: 'auth-user-2' })
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'not_owned',
    })
    expect(del).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('an unresolvable actor refuses before reading anything', async () => {
    await expect(
      deleteRecordingSessionWithClient(client, { ...actor, staffId: null }, 'sess-1'),
    ).resolves.toEqual({ error: 'forbidden' })
    expect(get).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })
})

describe('deleteRecordingSessionWithClient — failure tolerance', () => {
  it('a 404 read is "already gone", not an error to act on', async () => {
    get.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }))
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'not_found',
    })
    expect(del).not.toHaveBeenCalled()
  })

  it('an unreadable row never guesses its way into a delete', async () => {
    get.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'read_failed',
    })
    expect(del).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('a failed delete RESOLVES (never throws into the discard) and logs nothing false', async () => {
    del.mockRejectedValue(new Error('core down'))
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'delete_failed',
    })
    // No audit row for a deletion that did not happen.
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('an empty id is refused, not sent to core', async () => {
    await expect(deleteRecordingSessionWithClient(client, actor, '')).resolves.toEqual({
      error: 'validation',
    })
    expect(get).not.toHaveBeenCalled()
  })
})

describe('deleteRecordingSessionWithClient — the provenance gate (fix round 4)', () => {
  it('a session that ALREADY HAS a karute record is refused — no delete, no audit', async () => {
    // The web-live seam: saveKaruteRecordInline commits the record and can
    // still error afterwards → failAutosaveToReview → ReviewScreen with the
    // SAME session id → 破棄. Deleting here nulls the record's
    // recording_session_id (Prisma SetNull): the karute survives but loses its
    // provenance and vanishes from 録音履歴.
    getByRecordingSession.mockResolvedValue({ id: 'rec-1', recording_session_id: 'sess-1' })
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'has_record',
    })
    expect(del).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('the probe asks about THIS session, on the cheapest single-record surface', async () => {
    await deleteRecordingSessionWithClient(client, actor, 'sess-1')
    expect(getByRecordingSession).toHaveBeenCalledWith('sess-1')
  })

  it.each([500, 503, 429, undefined])(
    'a probe failure (%s) is an UNKNOWN — read_failed, never a delete',
    async (status) => {
      getByRecordingSession.mockRejectedValue(
        status === undefined ? new Error('network dark') : Object.assign(new Error('boom'), { status }),
      )
      await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
        error: 'read_failed',
      })
      expect(del).not.toHaveBeenCalled()
      expect(auditSpy).not.toHaveBeenCalled()
    },
  )

  it('ONLY a 404 proves "no record" — the happy path is unchanged', async () => {
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      ok: true,
    })
    expect(del).toHaveBeenCalledWith('sess-1')
    expect(auditSpy).toHaveBeenCalledTimes(1)
  })

  it('the ownership gate still runs FIRST — a foreign session is never probed', async () => {
    get.mockResolvedValue({ ...MY_ROW, staff_id: 'auth-user-2' })
    await expect(deleteRecordingSessionWithClient(client, actor, 'sess-1')).resolves.toEqual({
      error: 'not_owned',
    })
    expect(getByRecordingSession).not.toHaveBeenCalled()
  })
})
