// The 予約同期 all-stores list's five states (S53 PR-C), from ONE pure function.
// ⚖ No hardcoded durations (lead, fix round 1): every threshold comes from the
// store's own schedule — its interval and its 稼働時間帯, read in the config
// row's own timezone (the one core's cron dispatches by).
//   not configured                         → notSet
//   auto-sync OFF, or the last run failed  → stopped (lead ruling 10/6: 状態
//                                            answers "is it syncing now")
//   ON with an empty window (start === end) → stopped, reason window_empty:
//                                            core never dispatches it, so it
//                                            never syncs; no clock is walked
//   ON, never ran                          → waiting
//   otherwise, the age of the last run counted in window time only:
//     > 4 × interval → stopped · > 2 × interval → delayed · else healthy.
// The clock stops outside the window, so overnight a store reads the state it
// had at window end, and the morning resumes from there (no false 停止 before
// the day's first run). A window may span midnight (start > end); start === end
// is an EMPTY window and 0〜24 is all day — both exactly as core reads them
// (see inWindow).
export type SyncStoreState = 'notSet' | 'waiting' | 'healthy' | 'delayed' | 'stopped'
/** Why a store is 停止 (null for every other state). */
export type SyncStopReason = 'off' | 'failed' | 'window_empty' | 'overdue'
export type SyncStoreStatus = { state: SyncStoreState; reason: SyncStopReason | null }

export type SyncSchedule = {
  intervalMinutes: number
  hoursStart: number
  hoursEnd: number
  timezone: string
}

const MINUTE_MS = 60_000
// Every UTC offset is a whole quarter-hour, so a local hour boundary always
// falls on a UTC quarter-hour: stepping on those never straddles a window edge.
const STEP_MS = 15 * MINUTE_MS

/** Mirrors core's isWithinBusinessHours (synqed-core
 *  src/services/sync.service.ts) exactly — core is the source of truth for
 *  when a store's auto-sync is dispatched. start === end is an empty window;
 *  end may be 24 (validations/sync.ts: start 0..23, end 0..24). */
export function inWindow(hour: number, { hoursStart: start, hoursEnd: end }: SyncSchedule): boolean {
  if (start <= end) {
    return hour >= start && hour < end
  }
  // Wraps midnight (e.g. 22–6)
  return hour >= start || hour < end
}

/** Milliseconds of window time between `fromMs` and `toMs`, counted up to `capMs`. */
function windowTimeBetween(fromMs: number, toMs: number, schedule: SyncSchedule, capMs: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone, hour: 'numeric', hourCycle: 'h23' })
  const hourAt = (ms: number) => Number(fmt.formatToParts(ms).find((p) => p.type === 'hour')?.value)
  let age = 0
  let t = toMs
  while (t > fromMs && age <= capMs) {
    const from = Math.max(fromMs, Math.floor((t - 1) / STEP_MS) * STEP_MS)
    if (inWindow(hourAt(from), schedule)) age += t - from
    t = from
  }
  return age
}

export function syncStoreState(
  row: {
    configured: boolean
    enabled: boolean
    lastRunStatus: 'OK' | 'ERROR' | 'RUNNING' | null
    lastRunAt: string | null
    schedule: SyncSchedule | null
  },
  nowMs: number,
): SyncStoreStatus {
  const is = (state: SyncStoreState, reason: SyncStopReason | null = null) => ({ state, reason })
  if (!row.configured || !row.schedule) return is('notSet')
  if (!row.enabled) return is('stopped', 'off')
  // Before any clock walk: an empty window never syncs, whatever the last run.
  if (row.schedule.hoursStart === row.schedule.hoursEnd) return is('stopped', 'window_empty')
  if (row.lastRunStatus === 'ERROR') return is('stopped', 'failed')
  if (!row.lastRunAt) return is('waiting')
  const lastMs = Date.parse(row.lastRunAt)
  if (Number.isNaN(lastMs)) return is('stopped', 'overdue')
  const intervalMs = row.schedule.intervalMinutes * MINUTE_MS
  const age = windowTimeBetween(lastMs, nowMs, row.schedule, 4 * intervalMs)
  if (age > 4 * intervalMs) return is('stopped', 'overdue')
  if (age > 2 * intervalMs) return is('delayed')
  return is('healthy')
}

export type SyncFailureReason = 'login' | 'store' | 'other'

/** Which of the mock's fix lines a failure gets. Reads core's existing
 *  messages ("QR login failed: …", "Store slug / id missing from QR config");
 *  anything else is the plain 同期に失敗しました. */
export function syncFailureReason(message: string | null): SyncFailureReason {
  if (message && /login failed/i.test(message)) return 'login'
  if (message && /missing from QR config/i.test(message)) return 'store'
  return 'other'
}
