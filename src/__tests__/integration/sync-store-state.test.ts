// S53 PR-C: the all-stores list's five states come from ONE pure function.
import { syncFailureReason, syncStoreState } from '@/lib/sync/sync-store-state'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60000).toISOString()
const row = (over: Partial<Parameters<typeof syncStoreState>[0]>) => ({
  configured: true, enabled: true, lastRunStatus: 'OK' as 'OK' | 'ERROR' | 'RUNNING' | null, lastRunAt: ago(5) as string | null, ...over,
})

describe('syncStoreState — the five states', () => {
  it('未設定: no config row', () => {
    expect(syncStoreState(row({ configured: false, enabled: false, lastRunStatus: null, lastRunAt: null }), NOW)).toBe('notSet')
  })
  it('初回の同期待ち: configured, enabled, never run', () => {
    expect(syncStoreState(row({ lastRunStatus: null, lastRunAt: null }), NOW)).toBe('waiting')
  })
  it('正常に同期中: last run under 30 minutes ago (OK, or RUNNING read by time)', () => {
    expect(syncStoreState(row({ lastRunAt: ago(29) }), NOW)).toBe('healthy')
    expect(syncStoreState(row({ lastRunStatus: 'RUNNING', lastRunAt: ago(1) }), NOW)).toBe('healthy')
  })
  it('同期が遅れています: 30 to 60 minutes', () => {
    expect(syncStoreState(row({ lastRunAt: ago(30) }), NOW)).toBe('delayed')
    expect(syncStoreState(row({ lastRunAt: ago(60) }), NOW)).toBe('delayed')
  })
  it('同期が停止しています: ERROR (even fresh), over 60 minutes, or auto-sync off', () => {
    expect(syncStoreState(row({ lastRunStatus: 'ERROR', lastRunAt: ago(1) }), NOW)).toBe('stopped')
    expect(syncStoreState(row({ lastRunAt: ago(61) }), NOW)).toBe('stopped')
    expect(syncStoreState(row({ enabled: false }), NOW)).toBe('stopped')
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
