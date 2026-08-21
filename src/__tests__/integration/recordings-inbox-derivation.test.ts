/**
 * 録音履歴 — the state table (Build F1).
 *
 * This is the honesty contract of the whole feature: every row's chip is a
 * CLAIM about a customer's recording, so each of the five states, the
 * precedence between them, and every "we don't actually know" case is pinned
 * here. If a row can lie, it lies in this function.
 */
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import {
  deriveInboxRows,
  countNeedsAttention,
  needsAttention,
  INBOX_WINDOW_MS,
  SESSION_UNSETTLED_GRACE_MS,
  type InboxServerSession,
  type InboxLocalTake,
} from '@/lib/recordings/inbox'

const NOW = Date.parse('2026-08-25T04:00:00.000Z') // 13:00 JST
const MIN = 60_000

function session(over: Partial<InboxServerSession> & { recordingSessionId: string }): InboxServerSession {
  return {
    customerId: 'cust-1',
    createdAt: new Date(NOW - 30 * MIN).toISOString(),
    durationSeconds: 1380,
    karuteRecordId: null,
    jobStatus: null,
    jobLastError: null,
    ...over,
  }
}

function take(over: Partial<InboxLocalTake> & { takeId: string }): InboxLocalTake {
  return {
    recordingSessionId: null,
    customerId: 'cust-1',
    customerName: '佐藤 美咲',
    startedAt: NOW - 30 * MIN,
    updatedAt: NOW - 7 * MIN,
    ...over,
  }
}

const fold = (sessions: InboxServerSession[], takes: InboxLocalTake[] = []) =>
  deriveInboxRows({ sessions, takes, now: NOW })

describe('録音履歴 — the five states', () => {
  it('保存済み: a karute record exists and nothing local is outstanding', () => {
    const [row] = fold([session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' })])
    expect(row.state).toBe('saved')
    expect(row.reason).toBeNull()
    expect(row.karuteRecordId).toBe('rec-1')
    expect(needsAttention(row)).toBe(false)
  })

  it('確認待ち: the record exists but THIS device never settled its take', () => {
    const [row] = fold(
      [session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' })],
      [take({ takeId: 't1', recordingSessionId: 's1' })],
    )
    expect(row.state).toBe('awaiting-check')
    // Generic on purpose: the app CANNOT reliably attribute why the client
    // never saw the save (supersession / closed app / crash-cron), so the row
    // claims only that it was saved automatically and nobody confirmed it.
    expect(row.reason).toBe('autoSaved')
    expect(row.takeId).toBe('t1')
    expect(needsAttention(row)).toBe(true)
  })

  it.each(['QUEUED', 'RUNNING'] as const)('処理中: a live job (%s)', (jobStatus) => {
    const [row] = fold([session({ recordingSessionId: 's1', jobStatus })])
    expect(row.state).toBe('processing')
    expect(row.reason).toBe('transcribing')
    expect(needsAttention(row)).toBe(false)
  })

  it('失敗: a FAILED job maps EMPTY_TRANSCRIPT to its own honest reason', () => {
    const [row] = fold([
      session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'EMPTY_TRANSCRIPT' }),
    ])
    expect(row.state).toBe('failed')
    expect(row.reason).toBe('emptyTranscript')
  })

  it('失敗: any other lastError stays GENERIC — no invented cause', () => {
    const [row] = fold([
      session({
        recordingSessionId: 's1',
        jobStatus: 'FAILED',
        jobLastError: 'ECONNRESET while calling whisper',
      }),
    ])
    expect(row.state).toBe('failed')
    expect(row.reason).toBe('genericFailure')
  })

  it('失敗: DONE with no karute record is the core anomaly — generic reason', () => {
    const [row] = fold([session({ recordingSessionId: 's1', jobStatus: 'DONE' })])
    expect(row.state).toBe('failed')
    expect(row.reason).toBe('genericFailure')
  })

  it('復元可能: a take with no record and no job at all', () => {
    const [row] = fold(
      [session({ recordingSessionId: 's1' })],
      [take({ takeId: 't1', recordingSessionId: 's1' })],
    )
    expect(row.state).toBe('recoverable')
    expect(row.reason).toBe('localAudio')
    expect(row.takeId).toBe('t1')
    expect(needsAttention(row)).toBe(true)
  })
})

describe('録音履歴 — precedence: record beats job beats take', () => {
  it('a record wins over a FAILED job (a retry that landed)', () => {
    const [row] = fold([
      session({
        recordingSessionId: 's1',
        karuteRecordId: 'rec-1',
        jobStatus: 'FAILED',
        jobLastError: 'EMPTY_TRANSCRIPT',
      }),
    ])
    expect(row.state).toBe('saved')
  })

  it('a live job wins over a take still sitting on the device', () => {
    const [row] = fold(
      [session({ recordingSessionId: 's1', jobStatus: 'RUNNING' })],
      [take({ takeId: 't1', recordingSessionId: 's1' })],
    )
    expect(row.state).toBe('processing')
  })

  it('one session is one row even with several takes; the newest take is the one offered', () => {
    const rows = fold(
      [session({ recordingSessionId: 's1' })],
      [
        take({ takeId: 'old', recordingSessionId: 's1', startedAt: NOW - 90 * MIN }),
        take({ takeId: 'new', recordingSessionId: 's1', startedAt: NOW - 40 * MIN }),
      ],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].takeId).toBe('new')
  })
})

describe('録音履歴 — the cases where we do NOT know', () => {
  it('a fresh session with no record, no job and no local take reads 処理中, not 失敗', () => {
    // A recording running RIGHT NOW on the staffer's phone looks exactly like
    // this from the desktop. Calling it 失敗 would be a lie on every live
    // cross-device session.
    const [row] = fold([
      session({ recordingSessionId: 's1', createdAt: new Date(NOW - 20 * MIN).toISOString() }),
    ])
    expect(row.state).toBe('processing')
    expect(row.reason).toBe('unsettled')
    expect(needsAttention(row)).toBe(false)
  })

  it('past the grace, the same session reads 失敗 — nothing is in flight any more', () => {
    const [row] = fold([
      session({
        recordingSessionId: 's1',
        createdAt: new Date(NOW - SESSION_UNSETTLED_GRACE_MS - MIN).toISOString(),
      }),
    ])
    expect(row.state).toBe('failed')
    expect(row.reason).toBe('genericFailure')
    expect(row.canRetry).toBe(false)
  })
})

describe('録音履歴 — 再試行 is offered only when the audio is here', () => {
  it('FAILED with a local take → retry is offered', () => {
    const [row] = fold(
      [session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'boom' })],
      [take({ takeId: 't1', recordingSessionId: 's1' })],
    )
    expect(row.canRetry).toBe(true)
    expect(row.takeId).toBe('t1')
  })

  it('FAILED with NO local take → no retry link (it would promise what we cannot do)', () => {
    const [row] = fold([
      session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'boom' }),
    ])
    expect(row.canRetry).toBe(false)
    expect(row.takeId).toBeNull()
  })

  it('DONE-with-no-record offers retry only with the audio', () => {
    const withAudio = fold(
      [session({ recordingSessionId: 's1', jobStatus: 'DONE' })],
      [take({ takeId: 't1', recordingSessionId: 's1' })],
    )[0]
    const without = fold([session({ recordingSessionId: 's2', jobStatus: 'DONE' })])[0]
    expect(withAudio.canRetry).toBe(true)
    expect(without.canRetry).toBe(false)
  })
})

describe('録音履歴 — walk-ins and orphan takes', () => {
  it('a session with no customer keeps its row (the 顧客未設定 walk-in)', () => {
    const [row] = fold([session({ recordingSessionId: 's1', customerId: null, karuteRecordId: 'rec-1' })])
    expect(row.customerId).toBeNull()
    expect(row.customerName).toBeNull()
    expect(row.state).toBe('saved')
  })

  it('a take with NO session id gets a row of its own (no server row can carry it)', () => {
    const rows = fold([], [take({ takeId: 't-orphan', recordingSessionId: null })])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('take:t-orphan')
    expect(rows[0].state).toBe('recoverable')
    expect(rows[0].recordingSessionId).toBeNull()
  })

  it('MULTI-TAKE: two independent takes are two rows — not just the newest', () => {
    // The pre-F1 banner offered only the newest recoverable take; every older
    // one sat un-offered until the TTL swept it. That is the loss this row set
    // ends.
    const rows = fold(
      [],
      [
        take({ takeId: 't1', startedAt: NOW - 3 * 60 * MIN, customerName: '佐藤 美咲' }),
        take({ takeId: 't2', startedAt: NOW - 5 * 60 * MIN, customerName: '田中 花子' }),
      ],
    )
    expect(rows.map((r) => r.takeId)).toEqual(['t1', 't2']) // newest first
    expect(rows.every((r) => r.state === 'recoverable')).toBe(true)
    expect(countNeedsAttention(rows)).toBe(2)
  })
})

describe('録音履歴 — window, ordering and the count', () => {
  it('drops sessions and takes older than the 7-day window', () => {
    const rows = fold(
      [
        session({ recordingSessionId: 'in', createdAt: new Date(NOW - 6 * 24 * 3600_000).toISOString() }),
        session({
          recordingSessionId: 'out',
          createdAt: new Date(NOW - INBOX_WINDOW_MS - MIN).toISOString(),
        }),
      ],
      [take({ takeId: 't-out', startedAt: NOW - INBOX_WINDOW_MS - MIN })],
    )
    expect(rows.map((r) => r.recordingSessionId)).toEqual(['in'])
  })

  it('ignores a session whose createdAt is unparseable rather than dating it to 1970', () => {
    const rows = fold([session({ recordingSessionId: 's1', createdAt: 'not-a-date' })])
    expect(rows).toEqual([])
  })

  it('rows are newest-first', () => {
    const rows = fold([
      session({ recordingSessionId: 'a', createdAt: new Date(NOW - 5 * MIN).toISOString() }),
      session({ recordingSessionId: 'c', createdAt: new Date(NOW - 300 * MIN).toISOString() }),
      session({ recordingSessionId: 'b', createdAt: new Date(NOW - 60 * MIN).toISOString() }),
    ])
    expect(rows.map((r) => r.recordingSessionId)).toEqual(['a', 'b', 'c'])
  })

  it('要対応 counts 確認待ち + 失敗 + 復元可能 — never 処理中 or 保存済み', () => {
    const rows = fold(
      [
        session({ recordingSessionId: 'saved', karuteRecordId: 'r1' }),
        session({ recordingSessionId: 'running', jobStatus: 'RUNNING' }),
        session({ recordingSessionId: 'failed', jobStatus: 'FAILED', jobLastError: 'x' }),
        session({ recordingSessionId: 'check', karuteRecordId: 'r2' }),
        session({ recordingSessionId: 'recover' }),
      ],
      [
        take({ takeId: 'tc', recordingSessionId: 'check' }),
        take({ takeId: 'tr', recordingSessionId: 'recover' }),
      ],
    )
    expect(countNeedsAttention(rows)).toBe(3)
  })

  it('the count decays to zero once every row is settled (the badge disappears)', () => {
    const rows = fold([
      session({ recordingSessionId: 'a', karuteRecordId: 'r1' }),
      session({ recordingSessionId: 'b', jobStatus: 'RUNNING' }),
    ])
    expect(countNeedsAttention(rows)).toBe(0)
  })

  it('duration falls back to the take stamps when the server row has none', () => {
    const [row] = fold(
      [session({ recordingSessionId: 's1', durationSeconds: null })],
      [take({ takeId: 't1', recordingSessionId: 's1', startedAt: NOW - 20 * MIN, updatedAt: NOW - 5 * MIN })],
    )
    expect(row.durationSeconds).toBe(15 * 60)
  })
})

describe('録音履歴 — i18n parity for the new keys', () => {
  const paths = [
    'title',
    'caption',
    'needsAttention',
    'empty',
    'partial',
    'today',
    'yesterday',
    'unsetCustomer',
    'state.saved',
    'state.awaitingCheck',
    'state.processing',
    'state.failed',
    'state.recoverable',
    'reason.transcribing',
    'reason.unsettled',
    'reason.autoSaved',
    'reason.genericFailure',
    'reason.localAudio',
    'action.open',
    'action.check',
    'action.retry',
    'action.save',
  ]

  function read(root: unknown, path: string): unknown {
    return path
      .split('.')
      .reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], root)
  }

  const jaRecording = (ja as unknown as Record<string, Record<string, unknown>>).recording
  const enRecording = (en as unknown as Record<string, Record<string, unknown>>).recording

  it.each(paths)('recording.inbox.%s exists in ja and en', (p) => {
    expect(typeof read(jaRecording.inbox, p)).toBe('string')
    expect(typeof read(enRecording.inbox, p)).toBe('string')
  })

  it('every InboxReason the fold can emit has a message (or reuses an existing one)', () => {
    // 'emptyTranscript' deliberately reuses recording.pipelineErrorEmptyTranscript
    // so the one honest wording exists in ONE place.
    const emitted = [
      'transcribing',
      'unsettled',
      'autoSaved',
      'genericFailure',
      'localAudio',
    ] as const
    const jaInbox = jaRecording.inbox as { reason: Record<string, string> }
    for (const r of emitted) expect(typeof jaInbox.reason[r]).toBe('string')
    expect(typeof jaRecording.pipelineErrorEmptyTranscript).toBe('string')
    expect(typeof enRecording.pipelineErrorEmptyTranscript).toBe('string')
  })
})
