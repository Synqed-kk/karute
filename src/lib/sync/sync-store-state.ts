// The 予約同期 all-stores list's five states (mock v1.3 Business tab). Same
// thresholds as SyncStatusCard's syncHealth: an ERROR beats a fresh timestamp,
// RUNNING reads by time like OK, < 30 min healthy, ≤ 60 min delayed, then
// stopped. A store with auto-sync OFF is stopped: core's cron will not run it.
export type SyncStoreState = 'notSet' | 'waiting' | 'healthy' | 'delayed' | 'stopped'

export function syncStoreState(
  row: {
    configured: boolean
    enabled: boolean
    lastRunStatus: 'OK' | 'ERROR' | 'RUNNING' | null
    lastRunAt: string | null
  },
  nowMs: number,
): SyncStoreState {
  if (!row.configured) return 'notSet'
  if (!row.enabled || row.lastRunStatus === 'ERROR') return 'stopped'
  if (!row.lastRunAt) return 'waiting'
  const minutes = (nowMs - new Date(row.lastRunAt).getTime()) / 60000
  if (minutes < 30) return 'healthy'
  if (minutes <= 60) return 'delayed'
  return 'stopped'
}

/** Which of the mock's fix lines a failure gets. Reads core's existing
 *  messages ("QR login failed: …", "Store slug / id missing from QR config");
 *  anything else is the plain 同期に失敗しました. */
export function syncFailureReason(message: string | null): 'login' | 'store' | 'other' {
  if (message && /login failed/i.test(message)) return 'login'
  if (message && /missing from QR config/i.test(message)) return 'store'
  return 'other'
}
