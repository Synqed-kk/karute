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

import { deleteRecordingSessionWithClient } from '@/lib/recording/session-cleanup'

const ME = 'auth-user-1'
const actor = { staffId: ME, businessId: 'business-1', source: 'web' as const }

type Row = {
  id: string
  staff_id: string
  customer_id: string | null
  audio_storage_path: string | null
}
const MY_ROW: Row = {
  id: 'sess-1',
  staff_id: ME,
  customer_id: 'cust-1',
  audio_storage_path: 'app_business-1_take-1.webm',
}

const get = jest.fn(async (_id: string): Promise<Row> => MY_ROW)
const del = jest.fn(async (_id: string): Promise<void> => {})
const client = { recordings: { get, delete: del } } as never

beforeEach(() => {
  jest.clearAllMocks()
  get.mockImplementation(async () => MY_ROW)
  del.mockImplementation(async () => {})
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
    expect(detail).toEqual({ customer_id: 'cust-1', had_audio_path: true })
    expect(JSON.stringify(detail)).not.toContain('app_business-1_take-1.webm')
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
