/**
 * The warning fact (recording hole PR-7) — what only this file proves:
 *   1. the choke point (src/lib/recording/capture-warning.ts) files ONE
 *      recording.capture_warned row, of exactly the capture_unlinked shape,
 *      and only for the recorder's OWN session in her OWN tenant;
 *   2. a body the schema refuses reaches neither core nor the audit sink;
 *   3. the inbox fold names the warned side at the two genericFailure sites
 *      and nowhere else — and without the map it is exactly today's fold;
 *   4. the bell maps both new reasons to labelled keys, in ja and en.
 */
const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

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
const EVERY_ID = FIXTURE_SESSIONS.map((s) => s.recordingSessionId)

const foldWith = (captureWarnings?: ReadonlyMap<string, 'device' | 'server'>) =>
  deriveInboxRows({ sessions: FIXTURE_SESSIONS, takes: FIXTURE_TAKES, now: NOW, captureWarnings })
const reasonOf = (rows: ReturnType<typeof foldWith>, id: string) =>
  rows.find((r) => r.recordingSessionId === id)?.reason

describe('deriveInboxRows — the warned reasons', () => {
  it('t9: all-off — no map is exactly the fold before PR-7 (states + reasons pinned from origin/main)', () => {
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
    // …and an empty map is the same rows, field for field.
    expect(foldWith(new Map())).toEqual(foldWith())
  })

  it.each([
    ['device', 'warnedDevice'],
    ['server', 'warnedServer'],
  ] as const)('t6: a %s fact names the failure at BOTH genericFailure sites', (side, expected) => {
    const rows = foldWith(new Map([['done-anomaly', side], ['past-grace', side]]))
    expect(reasonOf(rows, 'done-anomaly')).toBe(expected)
    expect(reasonOf(rows, 'past-grace')).toBe(expected)
    // Only the reason moves: state, retry and every other field are today's.
    const before = foldWith()
    for (const id of ['done-anomaly', 'past-grace']) {
      const { reason: _a, ...rest } = rows.find((r) => r.recordingSessionId === id)!
      const { reason: _b, ...restBefore } = before.find((r) => r.recordingSessionId === id)!
      expect(rest).toEqual(restBefore)
    }
  })

  it('t6: without a fact for that session the row stays genericFailure', () => {
    const rows = foldWith(new Map([['done-anomaly', 'device']]))
    expect(reasonOf(rows, 'past-grace')).toBe('genericFailure')
  })

  it('a fact on EVERY session renames only those two sites — every other row is unchanged', () => {
    const rows = foldWith(new Map(EVERY_ID.map((id) => [id, 'device'] as const)))
    const before = foldWith()
    for (const id of EVERY_ID) {
      if (id === 'done-anomaly' || id === 'past-grace') continue
      expect(rows.find((r) => r.recordingSessionId === id)).toEqual(
        before.find((r) => r.recordingSessionId === id),
      )
    }
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
