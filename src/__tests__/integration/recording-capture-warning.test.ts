/**
 * The warning fact (recording hole PR-7) — what only this file proves:
 *   1. the choke point (src/lib/recording/capture-warning.ts) files ONE
 *      recording.capture_warned row, of exactly the capture_unlinked shape,
 *      and only for the recorder's OWN session in her OWN tenant;
 *   2. a body the schema refuses reaches neither core nor the audit sink;
 *   3. the inbox fold names the warned side at every genericFailure site and
 *      nowhere else — and without the field it is exactly today's fold;
 *   4. the inbox read asks for the fact ONLY for sessions a server-only fold
 *      calls genericFailure, and a failed ask costs the row nothing but the
 *      explanation;
 *   5. the bell maps both new reasons to labelled keys, in ja and en.
 * The cron's end-to-end naming (t10) lives in audit-watch-run.test.ts.
 */
const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerListFor: async () => [] }))

import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import {
  recordCaptureWarningWithClient,
  type CaptureWarningActor,
  type CaptureWarningInput,
} from '@/lib/recording/capture-warning'
import {
  deriveInboxRows,
  SESSION_UNSETTLED_GRACE_MS,
  type InboxServerSession,
  type InboxLocalTake,
} from '@/lib/recordings/inbox'
import { readRecordingsInbox } from '@/lib/recordings/inbox-read'
import { karuteMissingReasonKey } from '@/lib/audit-labels'
import { TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const WARNED_AT = '2026-09-24T05:12:30.000Z'

const row = (over: Record<string, unknown> = {}) => ({
  id: SESSION,
  business_id: BIZ,
  staff_id: 'staff-1',
  customer_id: 'cust-1',
  status: 'UPLOADING',
  audio_storage_path: null,
  duration_seconds: null,
  store_id: null,
  ...over,
})
const get = jest.fn(async (_id: string) => row())
const synqed = { recordings: { get } } as never
const actor = (over: Partial<CaptureWarningActor> = {}): CaptureWarningActor => ({
  staffId: 'staff-1',
  businessId: BIZ,
  source: 'facade',
  requestId: 'req-1',
  ...over,
})
const input = (over: Partial<CaptureWarningInput> = {}): CaptureWarningInput => ({
  recordingSessionId: SESSION,
  takeId: TAKE,
  reason: 'device',
  warnedAt: WARNED_AT,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  get.mockResolvedValue(row())
})

describe('recordCaptureWarningWithClient — the owner check', () => {
  it("t1: another staff's session → forbidden, no audit row", async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    await expect(recordCaptureWarningWithClient(synqed, actor(), input())).resolves.toEqual({ error: 'forbidden' })
    expect(auditFn).not.toHaveBeenCalled()
  })

  it("t2: another tenant's session (her own staff id on it) → forbidden, no audit row", async () => {
    get.mockResolvedValue(row({ business_id: 'biz-2' }))
    await expect(recordCaptureWarningWithClient(synqed, actor(), input())).resolves.toEqual({ error: 'forbidden' })
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('no acting staff identity → forbidden before core is asked', async () => {
    await expect(
      recordCaptureWarningWithClient(synqed, actor({ staffId: null }), input()),
    ).resolves.toEqual({ error: 'forbidden' })
    expect(get).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it("a session core does not know → the sibling's not_found, no row; any other core failure → failed", async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }))
    await expect(recordCaptureWarningWithClient(synqed, actor(), input())).resolves.toEqual({ error: 'not_found' })
    get.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }))
    await expect(recordCaptureWarningWithClient(synqed, actor(), input())).resolves.toEqual({ error: 'failed' })
    expect(auditFn).not.toHaveBeenCalled()
  })
})

describe('recordCaptureWarningWithClient — the fact', () => {
  it.each(['device', 'server'] as const)('t3: a %s warning files ONE row of the capture_unlinked shape', async (reason) => {
    await expect(
      recordCaptureWarningWithClient(synqed, actor(), input({ reason })),
    ).resolves.toEqual({ ok: true })
    expect(get).toHaveBeenCalledWith(SESSION)
    expect(auditFn).toHaveBeenCalledTimes(1)
    expect(auditFn).toHaveBeenCalledWith({
      category: 'recording',
      action: 'recording.capture_warned',
      actorId: 'staff-1',
      actorType: 'staff',
      businessId: BIZ,
      targetType: 'recording',
      targetId: SESSION,
      severity: 'notice',
      detail: { reason, warned_at: WARNED_AT, take_id: TAKE },
      requestId: 'req-1',
      source: 'facade',
    })
  })

  it('every raise is its own fact — two calls, two rows (no dedupe)', async () => {
    await recordCaptureWarningWithClient(synqed, actor(), input())
    await recordCaptureWarningWithClient(synqed, actor(), input())
    expect(auditFn).toHaveBeenCalledTimes(2)
  })

  const { warnedAt: _omit, ...noWarnedAt } = input()
  it.each([
    ['an unknown reason', input({ reason: 'network' as never })],
    ['a missing warnedAt', noWarnedAt as CaptureWarningInput],
    ['a warnedAt that is not an ISO datetime', input({ warnedAt: '2026-09-24' })],
    ['an unknown key', { ...input(), staffId: 'staff-9' } as CaptureWarningInput],
    ['a session id that is not a uuid', input({ recordingSessionId: '../recordings' })],
    ['a take id that is not a uuid', input({ takeId: 'take-1' })],
  ])('t4: %s → bad_input, core never asked, no row', async (_label, body) => {
    await expect(recordCaptureWarningWithClient(synqed, actor(), body)).resolves.toEqual({ error: 'bad_input' })
    expect(get).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })
})

// ── The inbox fold ──────────────────────────────────────────────────────────
const NOW = Date.parse('2026-08-25T04:00:00.000Z')
const MIN = 60_000
const session = (over: Partial<InboxServerSession> & { recordingSessionId: string }): InboxServerSession => ({
  customerId: 'cust-1',
  createdAt: new Date(NOW - 30 * MIN).toISOString(),
  durationSeconds: 1380,
  karuteRecordId: null,
  jobStatus: null,
  jobProbeFailed: false,
  jobLastError: null,
  ...over,
})
const take = (over: Partial<InboxLocalTake> & { takeId: string }): InboxLocalTake => ({
  recordingSessionId: null,
  customerId: 'cust-1',
  customerName: '佐藤 美咲',
  startedAt: NOW - 30 * MIN,
  updatedAt: NOW - 7 * MIN,
  ...over,
})
const PAST_GRACE = new Date(NOW - SESSION_UNSETTLED_GRACE_MS - MIN).toISOString()

/** One session per branch of the sessions loop, plus a take on one of them. */
const FIXTURE_SESSIONS: InboxServerSession[] = [
  session({ recordingSessionId: 'saved', karuteRecordId: 'rec-1' }),
  session({ recordingSessionId: 'discarded', discardedByStaff: true }),
  session({ recordingSessionId: 'unknown-job', jobProbeFailed: true }),
  session({ recordingSessionId: 'running', jobStatus: 'RUNNING' }),
  session({ recordingSessionId: 'failed-job', jobStatus: 'FAILED', jobLastError: 'ECONNRESET' }),
  session({ recordingSessionId: 'done-anomaly', jobStatus: 'DONE' }),
  session({ recordingSessionId: 'with-take' }),
  session({ recordingSessionId: 'server-object', createdAt: PAST_GRACE, serverAudio: 'object' }),
  session({ recordingSessionId: 'in-grace' }),
  session({ recordingSessionId: 'past-grace', createdAt: PAST_GRACE }),
]
const FIXTURE_TAKES = [take({ takeId: 't1', recordingSessionId: 'with-take' })]
/** The three sites that fall to genericFailure today. */
const GENERIC_SITES = ['failed-job', 'done-anomaly', 'past-grace']

const foldWith = (captureWarning?: InboxServerSession['captureWarning']) =>
  deriveInboxRows({
    sessions:
      captureWarning === undefined ? FIXTURE_SESSIONS : FIXTURE_SESSIONS.map((s) => ({ ...s, captureWarning })),
    takes: FIXTURE_TAKES,
    now: NOW,
  })
const rowOf = (rows: ReturnType<typeof foldWith>, id: string) => rows.find((r) => r.recordingSessionId === id)!

describe('deriveInboxRows — the warned reasons', () => {
  it('t9: all-off — no field is exactly the fold before PR-7 (states + reasons pinned from origin/main)', () => {
    expect(foldWith().map((r) => [r.recordingSessionId, r.state, r.reason])).toEqual([
      ['saved', 'saved', null],
      ['discarded', 'discarded', null],
      ['unknown-job', 'processing', 'unsettled'],
      ['running', 'processing', 'transcribing'],
      ['failed-job', 'failed', 'genericFailure'],
      ['done-anomaly', 'failed', 'genericFailure'],
      ['with-take', 'recoverable', 'localAudio'],
      ['in-grace', 'processing', 'unsettled'],
      ['server-object', 'recoverable', 'serverAudio'],
      ['past-grace', 'failed', 'genericFailure'],
    ])
    // …and an explicit null is the same rows, field for field.
    expect(foldWith(null)).toEqual(foldWith())
  })

  it.each([
    ['device', 'warnedDevice'],
    ['server', 'warnedServer'],
  ] as const)('t6: a %s fact names the failure at ALL THREE genericFailure sites, and only there', (side, expected) => {
    const rows = foldWith(side)
    const before = foldWith()
    for (const id of FIXTURE_SESSIONS.map((s) => s.recordingSessionId)) {
      if (GENERIC_SITES.includes(id)) {
        expect(rowOf(rows, id).reason).toBe(expected)
        // Only the reason moves: state, retry and every other field are today's.
        expect({ ...rowOf(rows, id), reason: null }).toEqual({ ...rowOf(before, id), reason: null })
      } else {
        expect(rowOf(rows, id)).toEqual(rowOf(before, id))
      }
    }
  })

  it('t6: a NAMED stage failure keeps its own name — the fact explains only the generic line', () => {
    const [row] = deriveInboxRows({
      sessions: [
        session({
          recordingSessionId: 's1',
          jobStatus: 'FAILED',
          jobLastError: 'transcription_failed: provider timeout',
          captureWarning: 'device',
        }),
      ],
      takes: [],
      now: NOW,
    })
    expect(row.reason).toBe('transcriptionFailed')
  })

  it('t6: a value this build does not know is read as absent (the plain-string DTO idiom)', () => {
    expect(rowOf(foldWith('network' as never), 'past-grace').reason).toBe('genericFailure')
  })
})

// ── The inbox READ: which sessions are asked, and what a blip does ──────────
const READ_NOW = new Date('2026-09-11T04:00:00.000Z')
const iso = (msAgo: number) => new Date(READ_NOW.getTime() - msAgo).toISOString()
/** Two takes of ONE session: A was recorded (and warned about) first, then a
 *  retake B moved the row's pointer to itself. */
const TAKE_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TAKE_B = TAKE
const keyOf = (takeId: string) => `app_${BIZ}_${takeId}.webm`
const rec = (id: string, msAgo: number, audio_storage_path: string | null = keyOf(TAKE_B)) => ({
  id,
  customer_id: 'cust-1',
  staff_id: 'staff-1',
  duration_seconds: 300,
  audio_storage_path,
  created_at: iso(msAgo),
})
const warned = (takeId: string, reason: string) => ({
  action: 'recording.capture_warned',
  detail: { reason, warned_at: WARNED_AT, take_id: takeId },
})
const OLD_MS = SESSION_UNSETTLED_GRACE_MS + 60 * MIN
const auditList = jest.fn(async (_opts: unknown): Promise<{ events: unknown[]; total: number }> => ({
  events: [],
  total: 0,
}))
const readClient = {
  recordings: {
    list: jest.fn(async () => ({
      recordings: [rec('sess-saved', OLD_MS), rec('sess-running', OLD_MS), rec('sess-failed', OLD_MS)],
      total: 3,
    })),
  },
  karuteRecords: {
    list: jest.fn(async () => ({
      karute_records: [{ id: 'rec-1', recording_session_id: 'sess-saved' }],
      total: 1,
    })),
  },
  recordingJobs: {
    getByRecordingSession: jest.fn(async (id: string) => {
      if (id === 'sess-running') return { status: 'RUNNING', last_error: null }
      throw Object.assign(new Error('no job'), { status: 404 })
    }),
  },
  recordingDiscards: { list: jest.fn(async () => ({ events: [], total: 0, page: 1, page_size: 200 })) },
  audit: { list: auditList },
} as unknown as Parameters<typeof readRecordingsInbox>[0]['synqed']
// Storage answers "nothing there": the failed row stays failed, never 復元可能.
const read = () =>
  readRecordingsInbox({
    synqed: readClient,
    staffId: 'staff-1',
    businessId: BIZ,
    now: READ_NOW,
    takeAudioProbe: async () => 'absent',
    segmentsProbe: async () => false,
  })
const byId = (sessions: InboxServerSession[]) => Object.fromEntries(sessions.map((s) => [s.recordingSessionId, s]))

describe('readRecordingsInbox — the warning fact', () => {
  it('t5: three sessions, one failed → exactly ONE audit.list, for that session, and only it carries the fact', async () => {
    auditList.mockResolvedValueOnce({
      events: [
        { action: 'recording.karute_missing', detail: {} },
        warned(TAKE_B, 'server'),
        warned(TAKE_B, 'device'),
      ],
      total: 3,
    })
    const sessions = byId(await read())
    expect(auditList).toHaveBeenCalledTimes(1)
    expect(auditList).toHaveBeenCalledWith({
      target_type: 'recording',
      target_id: 'sess-failed',
      category: 'recording',
      page_size: 50,
    })
    // Newest first: the first capture_warned row is the latest raise.
    expect(sessions['sess-failed'].captureWarning).toBe('server')
    expect('captureWarning' in sessions['sess-saved']).toBe(false)
    expect('captureWarning' in sessions['sess-running']).toBe(false)
  })

  it('t5: no failed candidate → zero audit.list calls', async () => {
    ;(readClient.recordings.list as jest.Mock).mockResolvedValueOnce({
      recordings: [rec('sess-saved', OLD_MS), rec('sess-running', OLD_MS)],
      total: 2,
    })
    await read()
    expect(auditList).not.toHaveBeenCalled()
  })

  it('t5: a detail reason this build does not know attaches nothing', async () => {
    auditList.mockResolvedValueOnce({
      events: [warned(TAKE_B, 'network')],
      total: 1,
    })
    expect('captureWarning' in byId(await read())['sess-failed']).toBe(false)
  })

  it('t11: take A was warned, the RETAKE B failed with no fact of its own → generic; a fact for B → warned', async () => {
    auditList.mockResolvedValueOnce({ events: [warned(TAKE_A, 'server'), warned(TAKE_A, 'device')], total: 2 })
    expect('captureWarning' in byId(await read())['sess-failed']).toBe(false)

    auditList.mockResolvedValueOnce({
      events: [warned(TAKE_A, 'server'), warned(TAKE_B, 'device'), warned(TAKE_A, 'device')],
      total: 3,
    })
    expect(byId(await read())['sess-failed'].captureWarning).toBe('device')
  })

  it('t11: a failed row whose pointer names no take is never asked — nothing to match a fact to', async () => {
    ;(readClient.recordings.list as jest.Mock).mockResolvedValueOnce({
      recordings: [rec('sess-failed', OLD_MS, null)],
      total: 1,
    })
    await read()
    expect(auditList).not.toHaveBeenCalled()
  })

  it('t12: a list call that never answers cannot hold the read — it returns by the deadline, row generic, one log line', async () => {
    auditList.mockImplementationOnce(() => new Promise(() => {}))
    const started = Date.now()
    const sessions = await readRecordingsInbox({
      synqed: readClient,
      staffId: 'staff-1',
      businessId: BIZ,
      now: READ_NOW,
      takeAudioProbe: async () => 'absent',
      segmentsProbe: async () => false,
      warningDeadlineMs: 50,
    })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(sessions).toHaveLength(3)
    expect('captureWarning' in byId(sessions)['sess-failed']).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(
      '[recordings-inbox] warning-fact lookup past 50 ms — 1 failed sessions left generic',
    )
  }, 2_000)

  it('t7: the list call throws → no field, logged, the read still returns every session (row stays genericFailure)', async () => {
    auditList.mockRejectedValueOnce(Object.assign(new Error('core down'), { status: 503 }))
    const sessions = await read()
    expect(sessions).toHaveLength(3)
    const failed = byId(sessions)['sess-failed']
    expect('captureWarning' in failed).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('warning-fact read failed for sess-failed'),
      expect.anything(),
    )
    const rows = deriveInboxRows({ sessions, takes: [], now: READ_NOW.getTime() })
    expect(rows.find((r) => r.recordingSessionId === 'sess-failed')?.reason).toBe('genericFailure')
  })
})

describe('the bell — karuteMissingReasonKey', () => {
  it.each([
    ['warnedDevice', 'reason.warned_device'],
    ['warnedServer', 'reason.warned_server'],
  ])('t8: %s → %s, labelled in ja AND en', (reason, key) => {
    expect(karuteMissingReasonKey(reason)).toBe(key)
    const code = key.slice('reason.'.length) as 'warned_device' | 'warned_server'
    expect(ja.settings.auditLog.reason[code]).toEqual(expect.any(String))
    expect(en.settings.auditLog.reason[code]).toEqual(expect.any(String))
    expect(ja.settings.auditLog.reason[code].length).toBeGreaterThan(0)
    expect(en.settings.auditLog.reason[code].length).toBeGreaterThan(0)
  })
})
