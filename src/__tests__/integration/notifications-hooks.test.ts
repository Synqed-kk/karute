/**
 * @jest-environment jsdom
 *
 * Unit coverage for the v1 notifications state layer (feat/notifications-live).
 * The feed is now SERVER-DERIVED (buildNotificationFeed) and delivered via
 * NotificationsProvider; the unread badge is a single per-staff lastSeen cursor
 * over the booking-category items. These tests exercise:
 *   • useNotifications() reads the context feed (stable reference)
 *   • useUnreadCount() counts ONLY booking items created after lastSeen
 *   • lastSeen is keyed per staff id (shared device → independent baselines)
 *   • markAllRead / setLastSeen advance the cursor and clear the badge
 */
import { createElement } from 'react'
import { renderHook, act } from '@testing-library/react'
import { NotificationsProvider } from '@/lib/notifications/context'
import {
  useNotifications,
  useUnreadCount,
  useUnreadIds,
  useNotificationMutations,
} from '@/lib/notifications/hooks'
import type {
  NotificationCategory,
  NotificationItem,
} from '@/lib/notifications/types'

const LAST_SEEN_PREFIX = 'synqed-karute-notifications-last-seen'

function item(
  id: string,
  category: NotificationCategory,
  createdAt: string,
): NotificationItem {
  return {
    id,
    category,
    titleJa: `件名${id}`,
    titleEn: `Title ${id}`,
    bodyJa: '',
    bodyEn: '',
    createdAt,
    readAt: null,
    href: null,
  }
}

function setup(feed: NotificationItem[], staffId: string | null = 'staff-1') {
  return renderHook(
    () => ({
      items: useNotifications(),
      unread: useUnreadCount(),
      unreadIds: useUnreadIds(),
      ...useNotificationMutations(),
    }),
    {
      wrapper: ({ children }) =>
        createElement(NotificationsProvider, { feed, staffId }, children),
    },
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('useNotifications (server feed via context)', () => {
  it('returns the provided feed', () => {
    const feed = [
      item('a', 'booking', '2026-06-17T10:00:00+09:00'),
      item('b', 'system', '2026-06-17T00:00:00+09:00'),
    ]
    const { result } = setup(feed)
    expect(result.current.items).toHaveLength(2)
    expect(result.current.items).toBe(feed) // stable reference, not a copy
  })

  it('is empty (and zero unread) with no items', () => {
    const { result } = setup([])
    expect(result.current.items).toEqual([])
    expect(result.current.unread).toBe(0)
  })
})

describe('useUnreadCount — only NEW booking items since lastSeen', () => {
  it('counts every booking item when lastSeen is unset (all are new)', () => {
    const feed = [
      item('b1', 'booking', '2026-06-17T09:00:00+09:00'),
      item('b2', 'booking', '2026-06-17T11:00:00+09:00'),
    ]
    const { result } = setup(feed)
    expect(result.current.unread).toBe(2)
  })

  it('does NOT count non-booking categories (digest / roll-ups are info)', () => {
    const feed = [
      item('b1', 'booking', '2026-06-17T11:00:00+09:00'),
      item('d', 'system', '2026-06-17T00:00:00+09:00'), // 本日のご予約 digest
      item('f', 'customer_return', '2026-06-17T00:00:00+09:00'), // 要フォロー roll-up
      item('m', 'memory_review', '2026-06-17T00:00:00+09:00'), // 未保存カルテ
    ]
    const { result } = setup(feed)
    expect(result.current.unread).toBe(1) // only the booking item
  })

  it('counts only booking items NEWER than lastSeen', () => {
    const lastSeen = '2026-06-17T10:00:00+09:00'
    window.localStorage.setItem(`${LAST_SEEN_PREFIX}:staff-1`, lastSeen)
    const feed = [
      item('old', 'booking', '2026-06-17T09:00:00+09:00'), // before lastSeen
      item('new', 'booking', '2026-06-17T11:00:00+09:00'), // after lastSeen
    ]
    const { result } = setup(feed)
    expect(result.current.unread).toBe(1)
    expect(result.current.unreadIds.has('new')).toBe(true)
    expect(result.current.unreadIds.has('old')).toBe(false)
  })

  it('lastSeen is keyed per staff — another staff sees its own baseline', () => {
    // staff-1 has seen everything; staff-2 has not.
    window.localStorage.setItem(
      `${LAST_SEEN_PREFIX}:staff-1`,
      '2026-06-17T12:00:00+09:00',
    )
    const feed = [item('b1', 'booking', '2026-06-17T11:00:00+09:00')]
    const seen = setup(feed, 'staff-1')
    expect(seen.result.current.unread).toBe(0)

    const unseen = setup(feed, 'staff-2')
    expect(unseen.result.current.unread).toBe(1)
  })
})

describe('mutations advance the lastSeen cursor', () => {
  it('markAllRead clears the unread badge', () => {
    const feed = [
      item('b1', 'booking', '2026-06-17T09:00:00+09:00'),
      item('b2', 'booking', '2026-06-17T11:00:00+09:00'),
    ]
    const { result } = setup(feed)
    expect(result.current.unread).toBe(2)
    act(() => result.current.markAllRead())
    expect(result.current.unread).toBe(0)
    // Feed itself is untouched — only the cursor moved.
    expect(result.current.items).toHaveLength(2)
  })

  it('setLastSeen(now) clears the badge and persists per-staff', () => {
    const feed = [item('b1', 'booking', '2026-06-17T11:00:00+09:00')]
    const { result } = setup(feed)
    expect(result.current.unread).toBe(1)
    act(() => result.current.setLastSeen())
    expect(result.current.unread).toBe(0)
    expect(
      window.localStorage.getItem(`${LAST_SEEN_PREFIX}:staff-1`),
    ).not.toBeNull()
  })

  it('markRead / clearAll are no-op-safe on the derived feed', () => {
    const feed = [item('b1', 'booking', '2026-06-17T11:00:00+09:00')]
    const { result } = setup(feed)
    act(() => {
      result.current.markRead('b1')
      result.current.clearAll()
    })
    // Nothing changed: derived feed has no per-row read/dismiss state.
    expect(result.current.items).toHaveLength(1)
    expect(result.current.unread).toBe(1)
  })
})
