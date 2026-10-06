// S53 PR-C: the all-stores list's five states come from ONE pure function.
// Fix round 1: every threshold is the store's own interval and 稼働時間帯, read
// in the config row's timezone; time outside the window does not count.
import { syncFailureReason, syncStoreState, type SyncSchedule } from '@/lib/sync/sync-store-state'

// Times are written in JST (the schedule's timezone); jest runs in UTC.
const jst = (ymdHm: string) => Date.parse(`${ymdHm}:00+09:00`)
const NOON = jst('2026-10-06T12:00')
const SCHEDULE: SyncSchedule = { intervalMinutes: 15, hoursStart: 8, hoursEnd: 22, timezone: 'Asia/Tokyo' }
const at = (ms: number) => new Date(ms).toISOString()
const ago = (min: number, from = NOON) => at(from - min * 60000)
const row = (over: Partial<Parameters<typeof syncStoreState>[0]>) => ({
  configured: true,
  enabled: true,
  lastRunStatus: 'OK' as 'OK' | 'ERROR' | 'RUNNING' | null,
  lastRunAt: ago(5) as string | null,
  schedule: SCHEDULE as SyncSchedule | null,
  ...over,
})
const state = (over: Partial<Parameters<typeof syncStoreState>[0]>, now = NOON) => syncStoreState(row(over), now)

describe('syncStoreState — the five states', () => {
  it('未設定: no config row', () => {
    expect(state({ configured: false, enabled: false, lastRunStatus: null, lastRunAt: null, schedule: null })).toBe('notSet')
  })
  it('初回の同期待ち: configured, ON, never run', () => {
    expect(state({ lastRunStatus: null, lastRunAt: null })).toBe('waiting')
  })
  it('同期が停止しています: auto-sync OFF, whether it never ran or has run (lead ruling 10/6)', () => {
    expect(state({ enabled: false, lastRunStatus: null, lastRunAt: null })).toBe('stopped')
    expect(state({ enabled: false, lastRunAt: ago(5) })).toBe('stopped')
  })
  it('同期が停止しています: the last run failed, even a fresh one', () => {
    expect(state({ lastRunStatus: 'ERROR', lastRunAt: ago(1) })).toBe('stopped')
  })
  it('inside the window, thresholds are 2× and 4× the store interval (15 min)', () => {
    expect(state({ lastRunAt: ago(30) })).toBe('healthy')
    expect(state({ lastRunStatus: 'RUNNING', lastRunAt: ago(1) })).toBe('healthy')
    expect(state({ lastRunAt: ago(31) })).toBe('delayed')
    expect(state({ lastRunAt: ago(60) })).toBe('delayed')
    expect(state({ lastRunAt: ago(61) })).toBe('stopped')
  })
  it('a 60-minute interval scales the thresholds: 70 min is healthy, 121 delayed, 241 stopped', () => {
    const hourly = { ...SCHEDULE, intervalMinutes: 60 }
    const four = jst('2026-10-06T16:00')
    expect(state({ schedule: hourly, lastRunAt: ago(70, four) }, four)).toBe('healthy')
    expect(state({ schedule: hourly, lastRunAt: ago(121, four) }, four)).toBe('delayed')
    expect(state({ schedule: hourly, lastRunAt: ago(240, four) }, four)).toBe('delayed')
    expect(state({ schedule: hourly, lastRunAt: ago(241, four) }, four)).toBe('stopped')
  })
  it('overnight a store keeps the state it had at window end (22時)', () => {
    const last = jst('2026-10-05T21:50')
    expect(state({ lastRunAt: at(last) }, jst('2026-10-06T07:30'))).toBe('healthy')
    expect(state({ lastRunAt: at(jst('2026-10-05T21:29')) }, jst('2026-10-05T22:00'))).toBe('delayed')
    expect(state({ lastRunAt: at(jst('2026-10-05T21:29')) }, jst('2026-10-06T03:00'))).toBe('delayed')
    expect(state({ lastRunAt: at(jst('2026-10-05T20:00')) }, jst('2026-10-05T23:30'))).toBe('stopped')
  })
  it('the morning resumes from window end: 10 min before close + 20 after open = 30 healthy, 31 delayed', () => {
    const last = at(jst('2026-10-05T21:50'))
    expect(state({ lastRunAt: last }, jst('2026-10-06T08:20'))).toBe('healthy')
    expect(state({ lastRunAt: last }, jst('2026-10-06T08:21'))).toBe('delayed')
  })
  it('a window spanning midnight (20時〜2時) counts only its own hours', () => {
    const late = { ...SCHEDULE, hoursStart: 20, hoursEnd: 2 }
    const last = at(jst('2026-10-06T01:50'))
    expect(state({ schedule: late, lastRunAt: last }, jst('2026-10-06T10:00'))).toBe('healthy')
    expect(state({ schedule: late, lastRunAt: last }, jst('2026-10-06T20:25'))).toBe('delayed')
    // across midnight inside the window: 23:40 → 00:15 is 35 minutes
    expect(state({ schedule: late, lastRunAt: at(jst('2026-10-06T23:40')) }, jst('2026-10-07T00:15'))).toBe('delayed')
  })
  it('start === end is read as all day: three hours without a run is stopped at 03:00', () => {
    const allDay = { ...SCHEDULE, hoursStart: 0, hoursEnd: 0 }
    expect(state({ schedule: allDay, lastRunAt: at(jst('2026-10-06T00:00')) }, jst('2026-10-06T03:00'))).toBe('stopped')
  })
  it('an unreadable timestamp is stopped, never healthy', () => {
    expect(state({ lastRunAt: 'not a date' })).toBe('stopped')
  })
})

describe('syncFailureReason', () => {
  it("maps core's existing messages to the mock's fix lines", () => {
    expect(syncFailureReason('Error (502): QR login failed: 401')).toBe('login')
    expect(syncFailureReason('Store slug / id missing from QR config')).toBe('store')
    expect(syncFailureReason('Error (502): boom')).toBe('other')
    expect(syncFailureReason(null)).toBe('other')
  })
})
