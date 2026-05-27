/**
 * @jest-environment jsdom
 *
 * Unit coverage for the notifications state layer added in PR #82
 * (replay/07). Exercises the localStorage-backed useSyncExternalStore hooks
 * and their mutations (markRead / markAllRead / clearAll) end-to-end.
 */
import { renderHook, act } from '@testing-library/react'
import {
  useNotifications,
  useUnreadCount,
  useNotificationMutations,
} from '@/lib/notifications/hooks'
import type { NotificationItem } from '@/lib/notifications/types'

const STORAGE_KEY = 'synqed-karute-notifications'

function item(id: string, readAt: string | null = null): NotificationItem {
  return {
    id,
    category: 'system',
    titleJa: `件名${id}`,
    titleEn: `Title ${id}`,
    bodyJa: '',
    bodyEn: '',
    createdAt: '2024-01-01T00:00:00Z',
    readAt,
    href: null,
  }
}

function seed(items: NotificationItem[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

function setup() {
  return renderHook(() => ({
    items: useNotifications(),
    unread: useUnreadCount(),
    ...useNotificationMutations(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('useNotifications / useUnreadCount', () => {
  it('starts empty with zero unread', () => {
    const { result } = setup()
    expect(result.current.items).toEqual([])
    expect(result.current.unread).toBe(0)
  })

  it('reflects seeded items and counts only unread (readAt === null)', () => {
    seed([item('1'), item('2', '2024-02-01T00:00:00Z'), item('3')])
    const { result } = setup()
    expect(result.current.items).toHaveLength(3)
    expect(result.current.unread).toBe(2)
  })

  it('ignores malformed localStorage payloads (renders empty)', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    const { result } = setup()
    expect(result.current.items).toEqual([])
  })
})

describe('useNotificationMutations', () => {
  it('markRead marks a single item read and drops the unread count', () => {
    seed([item('1'), item('2')])
    const { result } = setup()
    act(() => result.current.markRead('1'))
    expect(result.current.unread).toBe(1)
    expect(result.current.items.find((n) => n.id === '1')?.readAt).not.toBeNull()
    expect(result.current.items.find((n) => n.id === '2')?.readAt).toBeNull()
  })

  it('markRead is a no-op for an already-read item', () => {
    seed([item('1', '2024-02-01T00:00:00Z')])
    const { result } = setup()
    const before = window.localStorage.getItem(STORAGE_KEY)
    act(() => result.current.markRead('1'))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('markAllRead clears the unread count', () => {
    seed([item('1'), item('2'), item('3', '2024-02-01T00:00:00Z')])
    const { result } = setup()
    act(() => result.current.markAllRead())
    expect(result.current.unread).toBe(0)
    expect(result.current.items).toHaveLength(3)
  })

  it('clearAll removes read items but keeps unread ones', () => {
    seed([item('1'), item('2', '2024-02-01T00:00:00Z'), item('3', '2024-02-02T00:00:00Z')])
    const { result } = setup()
    act(() => result.current.clearAll())
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].id).toBe('1')
  })

  it('clearAll is a no-op when nothing is read', () => {
    seed([item('1'), item('2')])
    const { result } = setup()
    act(() => result.current.clearAll())
    expect(result.current.items).toHaveLength(2)
  })
})
