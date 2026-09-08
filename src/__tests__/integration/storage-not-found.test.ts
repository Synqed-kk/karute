/**
 * isStorageNotFound (src/lib/recording/take-binding.ts) — pins the exact
 * shape storage-js hands back for a MISSING OBJECT, and the chain that
 * depends on reading it right.
 *
 * 2026-09-05 production incident: the predicate read `status === 404` alone.
 * storage-api v1.71.0 (acceptance spec rest-extended.test.ts:169-174)
 * answers a missing object on `/object/info/…` with HTTP **400** and body
 * `statusCode: '404'`, `message: 'Object not found'` (codes.ts NoSuchKey) —
 * a shape that predicate never matched, so `objectSize`/`objectExists`
 * returned `'unknown'` for every real miss and every mint/finalize since
 * slice two shipped failed upstream. Cases 1–5 pin the predicate itself
 * (literal objects shaped like storage-js's StorageApiError: `name`,
 * `status`, `statusCode`, `message`); case 6 pins the chain the incident
 * actually broke.
 */
import { isStorageNotFound } from '@/lib/recording/take-binding'

describe('isStorageNotFound', () => {
  it('is true for the production shape — HTTP 400, body statusCode "404" (storage-api rest-extended.test.ts:169-174)', () => {
    expect(
      isStorageNotFound({
        name: 'StorageApiError',
        status: 400,
        statusCode: '404',
        message: 'Object not found',
      }),
    ).toBe(true)
  })

  it('is true for the alternate shape — a plain HTTP 404 carrying the same NoSuchKey message', () => {
    expect(
      isStorageNotFound({
        name: 'StorageApiError',
        status: 404,
        statusCode: '404',
        message: 'Object not found',
      }),
    ).toBe(true)
  })

  it('is true when statusCode arrives as a NUMBER, not a string — the numeric branch stays pinned, message gate keeps it safe', () => {
    expect(
      isStorageNotFound({
        name: 'StorageApiError',
        status: 400,
        statusCode: 404,
        message: 'Object not found',
      }),
    ).toBe(true)
  })

  it('is false for "Bucket not found" — a config problem, not a missing object, must stay unknown', () => {
    expect(
      isStorageNotFound({
        name: 'StorageApiError',
        status: 400,
        statusCode: '404',
        message: 'Bucket not found',
      }),
    ).toBe(false)
  })

  it('is false for a missing ROUTE — 404-shaped but not the object question', () => {
    expect(
      isStorageNotFound({
        name: 'StorageApiError',
        status: 404,
        statusCode: '404',
        message: 'Route GET:/object/info/x not found',
      }),
    ).toBe(false)
  })

  it.each([
    ['an unrelated server error', { name: 'StorageApiError', status: 500, statusCode: '500', message: 'Internal' }],
    ['undefined', undefined],
    ['null', null],
    ['a bare string', 'x'],
  ])('is false for %s', (_label, input) => {
    expect(isStorageNotFound(input)).toBe(false)
  })
})

// ── THE CHAIN THE INCIDENT ACTUALLY BROKE ───────────────────────────────────
// Mirrors recording-session.test.ts's mocking pattern, with the PRODUCTION
// error shape (400 / '404' / 'Object not found') in place of the old bare
// { status: 404 } — before the fix this shape read as 'unknown', never
// false, and the chain below returned `{ error: 'upstream' }` instead of
// creating the reserved row.
const info = jest.fn(async (_key: string) => ({
  data: null as { size?: number } | null,
  error: { status: 400, statusCode: '404', message: 'Object not found' } as
    | { status?: unknown; statusCode?: unknown; message?: unknown }
    | null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_bucket: string) => ({ info }) } }),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

import { objectExists } from '@/lib/recording/mint-take-url'
import { startRecordingSessionWithClient } from '@/lib/recording/session-mint'

describe('the production error shape, through the chain it broke', () => {
  const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
  const KEY = `app_biz-1_${TAKE}.webm`

  beforeEach(() => {
    info.mockClear()
    info.mockResolvedValue({
      data: null,
      error: { status: 400, statusCode: '404', message: 'Object not found' },
    })
  })

  it('objectExists resolves false (was "unknown")', async () => {
    expect(await objectExists(KEY)).toBe(false)
  })

  it('startRecordingSessionWithClient creates the row WITH the reservation (was { error: "upstream" })', async () => {
    const recordingsCreate = jest.fn(async (_input: unknown) => ({ id: 'session-1' }))
    const res = await startRecordingSessionWithClient(
      { recordings: { create: recordingsCreate }, appointments: { get: jest.fn() } } as never,
      {
        customerId: 'cust-1',
        appointmentId: null,
        selfStaffId: 'staff-1',
        businessId: 'biz-1',
        takeId: TAKE,
        mimeType: 'audio/webm',
        storeId: null,
      },
    )
    expect(res).toEqual({ id: 'session-1' })
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ audio_storage_path: KEY, status: 'UPLOADING' }),
    )
  })
})

// ── THE ALARM A PROVEN-NEITHER ANSWER LACKED (fix round 1) ──────────────────
describe('warnStorageUnknown — the 502 that used to log nothing', () => {
  const TAKE2 = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
  const KEY2 = `app_biz-1_${TAKE2}.webm`
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('logs storage_probe_unknown for objectSize/objectExists when storage answers neither hit nor miss', async () => {
    info.mockResolvedValueOnce({
      data: null,
      error: { status: 500, statusCode: '500', message: 'Internal' },
    })
    expect(await objectExists(KEY2)).toBe('unknown')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [line] = warnSpy.mock.calls[0] as [string]
    expect(line).toContain('"evt":"storage_probe_unknown"')
    expect(line).toContain('"where":"objectSize"')
    // Greptile fix round 2: the raw message never rides in the log — only
    // the normalized messageKind.
    expect(line).not.toContain('Internal')
    expect(line).toContain('"messageKind":"other"')
  })

  it('logs messageKind "bucket_not_found" for a bucket-config problem — never the raw message', async () => {
    info.mockResolvedValueOnce({
      data: null,
      error: { status: 400, statusCode: '404', message: 'Bucket not found' },
    })
    expect(await objectExists(KEY2)).toBe('unknown')
    const [line] = warnSpy.mock.calls[0] as [string]
    expect(line).toContain('"messageKind":"bucket_not_found"')
  })

  it('never logs for the ordinary miss', async () => {
    info.mockResolvedValueOnce({
      data: null,
      error: { status: 400, statusCode: '404', message: 'Object not found' },
    })
    expect(await objectExists(KEY2)).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('a missing-ROUTE message never puts the key (business + take id) in the log', async () => {
    info.mockResolvedValueOnce({
      data: null,
      error: {
        status: 404,
        statusCode: '404',
        message: `Route GET:/object/info/recordings/${KEY2} not found`,
      },
    })
    expect(await objectExists(KEY2)).toBe('unknown')
    const [line] = warnSpy.mock.calls[0] as [string]
    expect(line).toContain('"messageKind":"other"')
    expect(line).not.toContain('app_biz-1')
    expect(line).not.toContain('/object/info')
  })
})
