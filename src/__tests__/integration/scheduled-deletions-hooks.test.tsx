/**
 * @jest-environment jsdom
 *
 * Unit coverage for the scheduled-deletions state layer added in PR 19
 * (replay/19). Exercises the localStorage-backed useSyncExternalStore read
 * hooks (useCustomerDeletionStatus, useScheduledDeletions), every mutation
 * (scheduleDeletion / cancelDeletion), the 30-day countdown math, and the
 * malformed-payload / empty edge cases — end-to-end through window.localStorage.
 */
import { renderHook, act } from '@testing-library/react'
import {
  useCustomerDeletionStatus,
  useScheduledDeletions,
  SCHEDULED_DELETION_WINDOW_DAYS,
} from '@/lib/scheduled-deletions/hooks'
import type { ScheduledDeletion } from '@/lib/scheduled-deletions/types'

const STORAGE_KEY = 'synqed-karute-scheduled-deletions'
const DAY_MS = 24 * 60 * 60 * 1000

function deletion(
  customerId: string,
  scheduledAt: string,
  scheduledBy = 'staff-1',
): ScheduledDeletion {
  return { customerId, scheduledAt, scheduledBy }
}

function seed(map: Record<string, ScheduledDeletion>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

function readStorage(): Record<string, ScheduledDeletion> {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : {}
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('useCustomerDeletionStatus', () => {
  it('reports not-scheduled (all null fields) when nothing is stored', () => {
    const { result } = renderHook(() => useCustomerDeletionStatus('cust-1'))
    expect(result.current).toEqual({
      isScheduled: false,
      scheduledAt: null,
      daysRemaining: null,
      hardDeleteAt: null,
    })
  })

  it('reports not-scheduled for a customer absent from a populated store', () => {
    seed({ other: deletion('other', new Date().toISOString()) })
    const { result } = renderHook(() => useCustomerDeletionStatus('cust-1'))
    expect(result.current.isScheduled).toBe(false)
    expect(result.current.daysRemaining).toBeNull()
  })

  it('reports the full 30-day window remaining when just scheduled', () => {
    const now = new Date().toISOString()
    seed({ 'cust-1': deletion('cust-1', now) })
    const { result } = renderHook(() => useCustomerDeletionStatus('cust-1'))
    expect(result.current.isScheduled).toBe(true)
    expect(result.current.scheduledAt).toBe(now)
    // Ceil of ~30 days of ms; allow the boundary day.
    expect(result.current.daysRemaining).toBe(SCHEDULED_DELETION_WINDOW_DAYS)
    expect(result.current.hardDeleteAt).not.toBeNull()
  })

  it('computes hardDeleteAt as scheduledAt + 30 days', () => {
    const scheduledAt = '2026-01-01T00:00:00.000Z'
    seed({ 'cust-1': deletion('cust-1', scheduledAt) })
    const { result } = renderHook(() => useCustomerDeletionStatus('cust-1'))
    const expected = new Date(
      new Date(scheduledAt).getTime() +
        SCHEDULED_DELETION_WINDOW_DAYS * DAY_MS,
    ).toISOString()
    expect(result.current.hardDeleteAt).toBe(expected)
    expect(result.current.hardDeleteAt).toBe('2026-01-31T00:00:00.000Z')
  })

  it('counts down as the window elapses (10 days in → 20 remaining)', () => {
    const scheduledAt = new Date(Date.now() - 10 * DAY_MS).toISOString()
    seed({ 'cust-1': deletion('cust-1', scheduledAt) })
    const { result } = renderHook(() => useCustomerDeletionStatus('cust-1'))
    expect(result.current.daysRemaining).toBe(20)
  })

  it('clamps daysRemaining at 0 once the window has fully elapsed', () => {
    const scheduledAt = new Date(Date.now() - 45 * DAY_MS).toISOString()
    seed({ 'cust-1': deletion('cust-1', scheduledAt) })
    const { result } = renderHook(() => useCustomerDeletionStatus('cust-1'))
    expect(result.current.isScheduled).toBe(true)
    expect(result.current.daysRemaining).toBe(0)
  })

  it('renders not-scheduled when the stored payload is malformed JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    const { result } = renderHook(() => useCustomerDeletionStatus('cust-1'))
    expect(result.current.isScheduled).toBe(false)
  })
})

describe('useScheduledDeletions — read map', () => {
  it('exposes an empty map when nothing is stored', () => {
    const { result } = renderHook(() => useScheduledDeletions())
    expect(result.current.all).toEqual({})
  })

  it('exposes the seeded map keyed by customerId', () => {
    seed({
      a: deletion('a', '2026-01-01T00:00:00.000Z'),
      b: deletion('b', '2026-02-01T00:00:00.000Z'),
    })
    const { result } = renderHook(() => useScheduledDeletions())
    expect(Object.keys(result.current.all)).toEqual(['a', 'b'])
    expect(result.current.all.a.scheduledBy).toBe('staff-1')
  })
})

describe('useScheduledDeletions — scheduleDeletion', () => {
  it('schedules a deletion and persists it to localStorage', () => {
    const { result } = renderHook(() => useScheduledDeletions())
    act(() => result.current.scheduleDeletion('cust-1'))
    const stored = readStorage()
    expect(stored['cust-1']).toBeDefined()
    expect(stored['cust-1'].customerId).toBe('cust-1')
    expect(stored['cust-1'].scheduledBy).toBe('current-staff')
    expect(typeof stored['cust-1'].scheduledAt).toBe('string')
  })

  it('reactively reflects a newly scheduled deletion in the read map', () => {
    const { result } = renderHook(() => useScheduledDeletions())
    act(() => result.current.scheduleDeletion('cust-1'))
    expect(result.current.all['cust-1']).toBeDefined()
  })

  it('records the supplied scheduledBy actor', () => {
    const { result } = renderHook(() => useScheduledDeletions())
    act(() => result.current.scheduleDeletion('cust-1', 'owner-42'))
    expect(readStorage()['cust-1'].scheduledBy).toBe('owner-42')
  })

  it('preserves other scheduled customers when adding a new one', () => {
    seed({ existing: deletion('existing', '2026-01-01T00:00:00.000Z') })
    const { result } = renderHook(() => useScheduledDeletions())
    act(() => result.current.scheduleDeletion('cust-1'))
    const stored = readStorage()
    expect(Object.keys(stored).sort()).toEqual(['cust-1', 'existing'])
  })

  it('drives useCustomerDeletionStatus reactively across the same render', () => {
    const { result } = renderHook(() => ({
      status: useCustomerDeletionStatus('cust-1'),
      ...useScheduledDeletions(),
    }))
    expect(result.current.status.isScheduled).toBe(false)
    act(() => result.current.scheduleDeletion('cust-1'))
    expect(result.current.status.isScheduled).toBe(true)
    expect(result.current.status.daysRemaining).toBe(
      SCHEDULED_DELETION_WINDOW_DAYS,
    )
  })
})

describe('useScheduledDeletions — cancelDeletion', () => {
  it('removes a scheduled deletion from storage', () => {
    seed({ 'cust-1': deletion('cust-1', new Date().toISOString()) })
    const { result } = renderHook(() => useScheduledDeletions())
    act(() => result.current.cancelDeletion('cust-1'))
    expect(readStorage()['cust-1']).toBeUndefined()
  })

  it('reactively flips status back to not-scheduled', () => {
    seed({ 'cust-1': deletion('cust-1', new Date().toISOString()) })
    const { result } = renderHook(() => ({
      status: useCustomerDeletionStatus('cust-1'),
      ...useScheduledDeletions(),
    }))
    expect(result.current.status.isScheduled).toBe(true)
    act(() => result.current.cancelDeletion('cust-1'))
    expect(result.current.status.isScheduled).toBe(false)
  })

  it('leaves other scheduled customers untouched', () => {
    seed({
      a: deletion('a', '2026-01-01T00:00:00.000Z'),
      b: deletion('b', '2026-02-01T00:00:00.000Z'),
    })
    const { result } = renderHook(() => useScheduledDeletions())
    act(() => result.current.cancelDeletion('a'))
    const stored = readStorage()
    expect(stored.a).toBeUndefined()
    expect(stored.b).toBeDefined()
  })

  it('is a safe no-op for an unscheduled customer', () => {
    seed({ b: deletion('b', '2026-02-01T00:00:00.000Z') })
    const { result } = renderHook(() => useScheduledDeletions())
    act(() => result.current.cancelDeletion('not-there'))
    expect(Object.keys(readStorage())).toEqual(['b'])
  })
})
