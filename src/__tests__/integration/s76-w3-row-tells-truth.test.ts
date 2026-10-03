/**
 * S76 commit W (W-3, R-S76-7, A4/M-S76-13) — the row's reading, pure.
 * `isDamagedTake` keeps c3286090f's truth table exactly (code-only); `damagedKind`
 * is that reading plus R-S76-7's one widening (door ON + tailIncomplete + a
 * TERMINAL code → 'partial'); neither reads the held-upload note.
 */
import { damagedKind, isDamagedTake, TERMINAL_SECURE_ERRORS } from '@/lib/karute/take-store'
import { AUDIO_PARTIAL, AUDIO_UNREADABLE, UNREADABLE_OBJECT } from '@/lib/recording/job-errors'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { deriveInboxRows, type InboxLocalTake } from '@/lib/recordings/inbox'

const CODES = [undefined, AUDIO_PARTIAL, AUDIO_UNREADABLE, UNREADABLE_OBJECT, 'size_mismatch', 'forbidden', 'exists', 'upstream', 'network', 'failed']
const NOTE = { bytes: 20_030, seconds: 600 }
/** c3286090f take-store.ts:162-168, verbatim in meaning. */
const base = (on: boolean, code?: string) =>
  on && code !== undefined && new Set([AUDIO_UNREADABLE, AUDIO_PARTIAL, UNREADABLE_OBJECT]).has(code)
const withSwitch = (on: boolean, fn: () => void) => {
  const r = jest.replaceProperty(RECORDING_SWITCHES as { stagedPartialDoor: boolean }, 'stagedPartialDoor', on)
  try {
    fn()
  } finally {
    r.restore()
  }
}

describe('isDamagedTake — truth table identical to c3286090f (every code × tailIncomplete × switch × note)', () => {
  it.each([true, false])('switch %s', (on) =>
    withSwitch(on, () => {
      for (const code of CODES)
        for (const tailIncomplete of [undefined, true])
          for (const heldUpload of [undefined, NOTE])
            expect([code, tailIncomplete, !!heldUpload, isDamagedTake({ secureError: code, tailIncomplete, heldUpload } as never)]).toEqual([
              code,
              tailIncomplete,
              !!heldUpload,
              base(on, code),
            ])
    }),
  )
})

describe('damagedKind — the code’s kind plus R-S76-7’s rows only; never the note', () => {
  const expected = (on: boolean, code: string | undefined, tail: boolean | undefined) => {
    if (base(on, code)) return code === AUDIO_PARTIAL ? 'partial' : 'unreadable'
    return on && tail === true && code !== undefined && TERMINAL_SECURE_ERRORS.has(code) ? 'partial' : undefined
  }
  it.each([true, false])('switch %s', (on) =>
    withSwitch(on, () => {
      for (const code of CODES)
        for (const tailIncomplete of [undefined, true])
          for (const heldUpload of [undefined, NOTE])
            expect([code, tailIncomplete, !!heldUpload, damagedKind({ secureError: code, tailIncomplete, heldUpload } as never)]).toEqual([
              code,
              tailIncomplete,
              !!heldUpload,
              expected(on, code, tailIncomplete),
            ])
    }),
  )
  it('S-2 cases 1–3 read damaged; case 4 (no session) is the same reading — its ROW keeps 保存する only via no secureError', () => {
    expect(damagedKind({ tailIncomplete: true, secureError: 'size_mismatch' })).toBe('partial') // case 1
    expect(damagedKind({ tailIncomplete: true, secureError: 'forbidden' })).toBe('partial') // case 2
    expect(damagedKind({ tailIncomplete: true, secureError: 'upstream' })).toBeUndefined() // passing: not final
  })
})

const NOW = Date.parse('2026-10-01T04:00:00.000Z')
const take = (over: Partial<InboxLocalTake> = {}): InboxLocalTake => ({
  takeId: 't1',
  recordingSessionId: 's1',
  customerId: null,
  customerName: null,
  startedAt: NOW - 30 * 60_000,
  updatedAt: NOW - 20 * 60_000,
  tailIncomplete: true,
  ...over,
})
const session = (over: Record<string, unknown> = {}) => ({
  recordingSessionId: 's1',
  customerId: null,
  customerName: null,
  createdAt: new Date(NOW - 30 * 60_000).toISOString(),
  durationSeconds: null,
  karuteRecordId: null,
  jobStatus: null,
  jobProbeFailed: false,
  jobLastError: null,
  serverAudio: null,
  ...over,
})
const fold = (t: InboxLocalTake, sessions: unknown[]) =>
  deriveInboxRows({ sessions: sessions as never, takes: [t], now: NOW }).map((r) => ({
    state: r.state,
    reason: r.reason,
    canRetry: r.canRetry,
  }))
const DAMAGED_ROW = { state: 'failed', reason: 'audioPartial', canRetry: false }

describe('deriveInboxRows — a phone-damaged take speaks in every branch (rev 2 §3)', () => {
  it('no job + take → damaged row, no 保存する; without `damaged` → recoverable as today', () => {
    expect(fold(take({ damaged: 'partial' }), [session()])).toEqual([DAMAGED_ROW])
    expect(fold(take(), [session()])).toEqual([{ state: 'recoverable', reason: 'tailIncomplete', canRetry: false }])
  })
  it('FAILED job + damaged take → the local damaged word, no 再試行', () => {
    expect(fold(take({ damaged: 'unreadable' }), [session({ jobStatus: 'FAILED', jobLastError: 'x' })])).toEqual([
      { state: 'failed', reason: 'audioUnreadable', canRetry: false },
    ])
  })
  it('DONE job + damaged take → no 再試行', () => {
    expect(fold(take({ damaged: 'partial' }), [session({ jobStatus: 'DONE' })])).toEqual([DAMAGED_ROW])
  })
  it('unlisted session: past the grace → damaged; inside the grace → unsettled (unchanged)', () => {
    const past = NOW - 2 * 24 * 3600_000
    expect(fold(take({ damaged: 'partial', startedAt: past, updatedAt: past }), [])).toEqual([DAMAGED_ROW])
    expect(fold(take({ damaged: 'partial', startedAt: NOW - 1_000 }), [])).toEqual([
      { state: 'processing', reason: 'unsettled', canRetry: false },
    ])
  })
  it('stranded and orphan → damaged row', () => {
    expect(fold(take({ damaged: 'partial', expiredUnsecured: true }), [])).toEqual([DAMAGED_ROW])
    expect(fold(take({ damaged: 'partial', recordingSessionId: null }), [])).toEqual([DAMAGED_ROW])
  })
  it('LIMIT 15 (case 4): a tailIncomplete take with no session and no damaged mark keeps 保存する', () => {
    expect(fold(take({ recordingSessionId: null }), [])).toEqual([{ state: 'recoverable', reason: 'tailIncomplete', canRetry: false }])
  })
})
