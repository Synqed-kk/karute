/**
 * 監査ログ round 2, PR C — find-karute-missing (packet subject 1/8).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ASSEMBLER_CRON_UTC, findKaruteMissing, lastAssemblerPassAt } from '@/lib/audit-watch/find-karute-missing'
import type { InboxRow } from '@/lib/recordings/inbox'

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
  const old = floor - 60_000 // one minute before the floor
  const recent = floor + 60_000 // one minute after the floor

  it('picks up recoverable and failed rows older than the assembler floor', () => {
    const rows = [
      row({ key: 'a', state: 'recoverable', startedAt: old }),
      row({ key: 'b', state: 'failed', startedAt: old }),
    ]
    expect(findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor }).map((r) => r.recordingSessionId))
      .toEqual(['sess-1', 'sess-1'])
    expect(findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor })).toHaveLength(2)
  })

  it('excludes discarded, saved, awaiting-check and processing rows — even when old', () => {
    const rows = [
      row({ key: 'a', state: 'discarded', startedAt: old }),
      row({ key: 'b', state: 'saved', startedAt: old }),
      row({ key: 'c', state: 'awaiting-check', startedAt: old }),
      row({ key: 'd', state: 'processing', startedAt: old }),
    ]
    expect(findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor })).toHaveLength(0)
  })

  it('excludes a recoverable/failed row newer than the assembler floor — it may still get rescued tonight', () => {
    const rows = [
      row({ key: 'a', state: 'recoverable', startedAt: recent }),
      row({ key: 'b', state: 'failed', startedAt: recent }),
    ]
    expect(findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor })).toHaveLength(0)
  })

  it('excludes a row created EXACTLY at the assembler floor — the boundary is strict-less-than', () => {
    const rows = [row({ key: 'a', state: 'recoverable', startedAt: floor })]
    expect(findKaruteMissing({ rows, now: NOW, lastAssemblerPassAt: floor })).toHaveLength(0)
  })
})
