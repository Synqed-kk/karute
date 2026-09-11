/**
 * 監査ログ round 2, PR C — find-karute-missing (packet subject 1/8).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ASSEMBLER_CRON_UTC, findKaruteMissing, lastAssemblerPassAt } from '@/lib/audit-watch/find-karute-missing'
import { deriveInboxRows, type InboxRow, type InboxServerSession } from '@/lib/recordings/inbox'

const NOW = Date.parse('2026-09-11T05:00:00.000Z') // 14:00 JST

const row = (over: Partial<InboxRow> & { key: string; startedAt: number }): InboxRow => ({
  state: 'recoverable',
  reason: 'localAudio',
  recordingSessionId: 'sess-1',
  takeId: null,
  karuteRecordId: null,
  customerId: 'cust-1',
  customerName: null,
  durationSeconds: 300,
  canRetry: false,
  ...over,
})

describe('lastAssemblerPassAt', () => {
  it('is the prior day’s 18:07 UTC when now is before today’s', () => {
    // 2026-09-11T05:00Z is before today's 18:07Z, so the last pass was
    // yesterday's.
    expect(lastAssemblerPassAt(NOW)).toBe(Date.parse('2026-09-10T18:07:00.000Z'))
  })

  it('is today’s own 18:07 UTC once now has passed it', () => {
    const afterCron = Date.parse('2026-09-11T19:00:00.000Z')
    expect(lastAssemblerPassAt(afterCron)).toBe(Date.parse('2026-09-11T18:07:00.000Z'))
  })

  it('matches vercel.json exactly, so the two can never drift', () => {
    const vercelJson = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))
    const assembleCron = (vercelJson.crons as Array<{ path: string; schedule: string }>).find(
      (c) => c.path === '/api/assemble',
    )
    expect(assembleCron).toBeDefined()
    const [minute, hour] = assembleCron!.schedule.split(' ').map(Number)
    expect({ hour, minute }).toEqual(ASSEMBLER_CRON_UTC)
  })
})

describe('findKaruteMissing', () => {
  const floor = lastAssemblerPassAt(NOW)
  const ASSEMBLE_AFTER_MS = 48 * 60 * 60 * 1000
  const DEFAULT_DURATION_MS = 300 * 1000 // row()'s default durationSeconds: 300
  // A row whose session (default 5-minute duration) ends `beforeFloorMs` before the floor.
  const startedAtEndingBeforeFloorBy = (beforeFloorMs: number) => floor - beforeFloorMs - DEFAULT_DURATION_MS
  const old = startedAtEndingBeforeFloorBy(ASSEMBLE_AFTER_MS + 60_000) // session ends 48h + 1min before the floor
  const recent = floor + 60_000 // started one minute after the floor — nowhere near old enough

  it('picks up recoverable and failed rows whose session ended at least assembleAfterMs before the floor', () => {
    const rows = [
      row({ key: 'a', state: 'recoverable', startedAt: old }),
      row({ key: 'b', state: 'failed', startedAt: old }),
    ]
    expect(
      findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }).map(
        (r) => r.recordingSessionId,
      ),
    ).toEqual(['sess-1', 'sess-1'])
    expect(findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS })).toHaveLength(2)
  })

  it('excludes discarded, saved, awaiting-check and processing rows — even when old', () => {
    const rows = [
      row({ key: 'a', state: 'discarded', startedAt: old }),
      row({ key: 'b', state: 'saved', startedAt: old }),
      row({ key: 'c', state: 'awaiting-check', startedAt: old }),
      row({ key: 'd', state: 'processing', startedAt: old }),
    ]
    expect(
      findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }),
    ).toHaveLength(0)
  })

  it('excludes a recoverable/failed row started after the assembler floor — it may still get rescued tonight', () => {
    const rows = [
      row({ key: 'a', state: 'recoverable', startedAt: recent }),
      row({ key: 'b', state: 'failed', startedAt: recent }),
    ]
    expect(
      findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }),
    ).toHaveLength(0)
  })

  it('excludes a row started EXACTLY at the assembler floor — its session has not even ended yet, let alone assembleAfterMs before the floor', () => {
    const rows = [row({ key: 'a', state: 'recoverable', startedAt: floor })]
    expect(
      findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }),
    ).toHaveLength(0)
  })

  // Fix round 2 (PACKET-PR-C1-FIX-ROUND2-GREPTILE-2026-09-11.md fix (a)): the
  // rescue floor was too early — "started before the last pass" isn't enough,
  // the assembler only rescues once the session ENDED assembleAfterMs ago.
  it('a session ended 47h before the floor is NOT a candidate — the assembler has not had its rescue shot yet (old code judged only startedAt and called this a candidate)', () => {
    const startedAt = floor - 47 * 60 * 60 * 1000 - 600 * 1000
    const rows = [row({ key: 'a', state: 'recoverable', durationSeconds: 600, startedAt })]
    expect(
      findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }),
    ).toHaveLength(0)
  })

  it('the same session ended exactly 48h before the floor → a candidate (the boundary is inclusive)', () => {
    const startedAt = floor - 48 * 60 * 60 * 1000 - 600 * 1000
    const rows = [row({ key: 'a', state: 'recoverable', durationSeconds: 600, startedAt })]
    expect(
      findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }),
    ).toHaveLength(1)
  })

  it('with no duration, the inbox grace stands in for the session end — 48h+3h before the floor is a candidate, one ms later is not', () => {
    const base = floor - 48 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000
    const candidateRows = [row({ key: 'a', state: 'recoverable', durationSeconds: null, startedAt: base })]
    const notCandidateRows = [row({ key: 'a', state: 'recoverable', durationSeconds: null, startedAt: base + 1 })]
    expect(
      findKaruteMissing({ rows: candidateRows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }),
    ).toHaveLength(1)
    expect(
      findKaruteMissing({ rows: notCandidateRows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: ASSEMBLE_AFTER_MS }),
    ).toHaveLength(0)
  })

  it('honours a shorter assembleAfterMs input (the env floor) instead of a hardcoded 48h', () => {
    const startedAt = floor - 10 * 60 * 1000 - DEFAULT_DURATION_MS // session ends 10 min before the floor
    const rows = [row({ key: 'a', state: 'recoverable', startedAt })]
    expect(
      findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor, assembleAfterMs: 5 * 60 * 1000 }),
    ).toHaveLength(1)
  })
})

// Fix round 3 (PACKET-PR-C1-FIX-ROUND3-PIN-2026-09-11.md): pin WHY the
// classifier already answers the rescue question upstream, through the SAME
// deriveInboxRows fold 録音履歴 renders — not by hand-building InboxRows.
describe('through deriveInboxRows (takes: [])', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  const ASSEMBLE_AFTER_MS = 48 * 60 * 60 * 1000
  const assemblerFloor = lastAssemblerPassAt(NOW)
  // 4 days back: inside deriveInboxRows' own 7-day INBOX_WINDOW_MS (so the
  // session reaches the classifier at all) and past ASSEMBLE_AFTER_MS + the
  // session's own 5-minute duration before assemblerFloor (so a recoverable/
  // failed row from it is old enough to be a candidate).
  const fourDaysAgo = new Date(NOW - 4 * DAY_MS).toISOString()
  const twentyHoursAgo = new Date(NOW - 20 * 60 * 60 * 1000).toISOString()

  const session = (
    over: Partial<InboxServerSession> & { recordingSessionId: string; createdAt: string },
  ): InboxServerSession => ({
    customerId: 'cust-1',
    customerName: null,
    durationSeconds: 300,
    karuteRecordId: null,
    jobStatus: null,
    jobProbeFailed: false,
    jobLastError: null,
    discardedByStaff: false,
    ...over,
  })

  const missingFor = (sessions: InboxServerSession[]) => {
    const rows = deriveInboxRows({ sessions, takes: [], now: NOW })
    return findKaruteMissing({
      rows,
      now: NOW,
      lastAssemblerPassAt: assemblerFloor,
      assembleAfterMs: ASSEMBLE_AFTER_MS,
    })
  }

  it('loose segments on the server → processing/partialOnServer, never a candidate — THE PIN', () => {
    const sessions = [session({ recordingSessionId: 'sess-segments', createdAt: fourDaysAgo, serverAudio: 'segments' })]
    // Sanity first: the row exists and really is `processing`, not silently
    // dropped by deriveInboxRows' own window.
    const rows = deriveInboxRows({ sessions, takes: [], now: NOW })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'processing', reason: 'partialOnServer' })
    expect(missingFor(sessions)).toHaveLength(0)
  })

  it('a whole object on the server → recoverable/serverAudio, a candidate', () => {
    const sessions = [session({ recordingSessionId: 'sess-object', createdAt: fourDaysAgo, serverAudio: 'object' })]
    const rows = deriveInboxRows({ sessions, takes: [], now: NOW })
    expect(rows[0]).toMatchObject({ state: 'recoverable', reason: 'serverAudio' })
    expect(missingFor(sessions).map((r) => r.recordingSessionId)).toEqual(['sess-object'])
  })

  it('nothing on the server, past the device-silence wait → failed/genericFailure, a candidate', () => {
    const sessions = [session({ recordingSessionId: 'sess-none', createdAt: fourDaysAgo, serverAudio: null })]
    const rows = deriveInboxRows({ sessions, takes: [], now: NOW })
    expect(rows[0]).toMatchObject({ state: 'failed', reason: 'genericFailure' })
    expect(missingFor(sessions).map((r) => r.recordingSessionId)).toEqual(['sess-none'])
  })

  it('nothing on the server, only 20h old → still inside the device-silence wait, not a candidate', () => {
    const sessions = [session({ recordingSessionId: 'sess-recent', createdAt: twentyHoursAgo, serverAudio: null })]
    expect(missingFor(sessions)).toHaveLength(0)
  })
})
