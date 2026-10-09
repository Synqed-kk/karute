// S53 PR-C: the all-stores list's five states come from ONE pure function.
// Fix round 1: every threshold is the store's own interval and 稼働時間帯, read
// in the config row's timezone; time outside the window does not count.
import { inWindow, syncFailureReason, syncStoreState, type SyncSchedule } from '@/lib/sync/sync-store-state'

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
const status = (over: Partial<Parameters<typeof syncStoreState>[0]>, now = NOON) => syncStoreState(row(over), now)
const state = (over: Partial<Parameters<typeof syncStoreState>[0]>, now = NOON) => status(over, now).state
// The clock walk is the only Intl formatting the state does: its call count is the walk's step count.
const walkSteps = () => jest.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
afterEach(() => jest.restoreAllMocks())

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
  it('0〜24 is all day: three hours without a run is stopped at 03:00', () => {
    const allDay = { ...SCHEDULE, hoursStart: 0, hoursEnd: 24 }
    expect(state({ schedule: allDay, lastRunAt: at(jst('2026-10-06T00:00')) }, jst('2026-10-06T03:00'))).toBe('stopped')
  })
  it('start === end (9〜9) is an empty window core never dispatches: ON → 停止 for window_empty, before any clock walk', () => {
    const empty = { ...SCHEDULE, hoursStart: 9, hoursEnd: 9 }
    const steps = walkSteps()
    expect(status({ schedule: empty, lastRunStatus: 'OK', lastRunAt: at(jst('2026-10-06T00:00')) }, jst('2026-10-06T03:00')))
      .toEqual({ state: 'stopped', reason: 'window_empty' })
    expect(status({ schedule: empty, lastRunAt: at(jst('2025-09-01T00:00')) })).toEqual({ state: 'stopped', reason: 'window_empty' })
    expect(status({ schedule: empty, lastRunStatus: null, lastRunAt: null })).toEqual({ state: 'stopped', reason: 'window_empty' })
    expect(steps).not.toHaveBeenCalled()
  })
  it('OFF still wins over an empty window: 停止 for off', () => {
    const empty = { ...SCHEDULE, hoursStart: 9, hoursEnd: 9 }
    expect(status({ schedule: empty, enabled: false })).toEqual({ state: 'stopped', reason: 'off' })
  })
  it('the walk stops at the 停止 threshold: a run 400 days old costs the same steps as one 2 days old', () => {
    // 08:05, just after open: the walk crosses the whole night before it can pass 4 × 15 min.
    const morning = jst('2026-10-06T08:05')
    const steps = walkSteps()
    expect(status({ lastRunAt: at(morning - 2 * 86_400_000) }, morning)).toEqual({ state: 'stopped', reason: 'overdue' })
    const twoDays = steps.mock.calls.length
    steps.mockClear()
    expect(status({ lastRunAt: at(morning - 400 * 86_400_000) }, morning)).toEqual({ state: 'stopped', reason: 'overdue' })
    const fourHundredDays = steps.mock.calls.length
    expect(twoDays).toBeGreaterThan(0) // the counter sees the walk
    expect(fourHundredDays).toBe(twoDays)
    // 5 min + the night (10 h) + 1 h of the evening, at one step per quarter-hour: under one day's steps
    expect(fourHundredDays).toBeLessThan((24 * 60) / 15)
  })
  it('an unreadable timestamp is stopped, never healthy', () => {
    expect(state({ lastRunAt: 'not a date' })).toBe('stopped')
  })
})

// inWindow mirrors core's isWithinBusinessHours (synqed-core src/services/sync.service.ts).
describe('inWindow — the same reading as core', () => {
  const w = (hoursStart: number, hoursEnd: number) => ({ ...SCHEDULE, hoursStart, hoursEnd })
  it.each([0, 8, 9, 10, 23])('start === end (9〜9) is empty: hour %i is outside', (h) => {
    expect(inWindow(h, w(9, 9))).toBe(false)
  })
  it.each([
    [23, true], [3, true], [5, true], [6, false], [10, false],
  ])('wrap-around 22〜6: hour %i → %s', (h, expected) => {
    expect(inWindow(h, w(22, 6))).toBe(expected)
  })
  it.each([
    [8, true], [21, true], [22, false], [7, false],
  ])('normal 8〜22: hour %i → %s', (h, expected) => {
    expect(inWindow(h, w(8, 22))).toBe(expected)
  })
  it.each([0, 23])('all day 0〜24: hour %i is inside', (h) => {
    expect(inWindow(h, w(0, 24))).toBe(true)
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
