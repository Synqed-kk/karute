/**
 * @jest-environment jsdom
 *
 * Render coverage for MobileHeader (PR #86/#103, replay/11): title mapping,
 * back-arrow on sub-routes, and the recording-aware bell hiding + unread badge.
 */
import { render, screen } from '@testing-library/react'

let mockPathname = '/ja'
let mockUnread = 0
let mockRecState = 'idle'
const back = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ back, refresh: jest.fn() }),
}))
// StoreSwitcher (rendered by MobileHeader) imports the @/actions/stores server
// action, which pulls in the supabase client at module load — that references
// TextEncoder, absent from the jsdom global. Stub the server actions so the
// real module never loads (the standard server-dep mock pattern here).
jest.mock('@/actions/stores', () => ({
  setActiveStore: jest.fn(async () => ({ ok: true })),
  clearActiveStore: jest.fn(async () => ({ ok: true })),
}))
// useTranslations(ns) -> (key) => key, so titles/labels equal their key.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
// The bell badge + panel now live in the shared NotificationBell, which reads
// the full hooks surface. Mock all of it so MobileHeader renders the real bell
// (the badge assertions below flow through it) without the context provider.
jest.mock('@/lib/notifications/hooks', () => ({
  useUnreadCount: () => mockUnread,
  formatUnreadBadge: (n: number) => (n > 9 ? '9+' : String(n)),
  useNotificationMutations: () => ({
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    clearAll: jest.fn(),
    setLastSeen: jest.fn(),
  }),
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({ state: mockRecState }),
}))
jest.mock('@/components/notifications/NotificationsPanel', () => ({
  NotificationsPanel: () => null,
}))

import { MobileHeader } from '@/components/layout/MobileHeader'

beforeEach(() => {
  mockPathname = '/ja'
  mockUnread = 0
  mockRecState = 'idle'
  back.mockClear()
})

describe('MobileHeader', () => {
  it('shows the dashboard title and no back arrow on a root tab', () => {
    mockPathname = '/ja'
    render(<MobileHeader stores={[]} activeStoreId={null} />)
    expect(screen.getByText('dashboard')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'back' })).not.toBeInTheDocument()
  })

  it('shows a back arrow and the mapped title on a sub-route', () => {
    mockPathname = '/ja/settings'
    render(<MobileHeader stores={[]} activeStoreId={null} />)
    expect(screen.getByRole('button', { name: 'back' })).toBeInTheDocument()
    expect(screen.getByText('settings')).toBeInTheDocument()
  })

  it('maps locale-prefixed karute route to the karute title', () => {
    mockPathname = '/en/karute/abc123'
    render(<MobileHeader stores={[]} activeStoreId={null} />)
    expect(screen.getByText('karute')).toBeInTheDocument()
  })

  it('renders the bell with an unread badge when idle', () => {
    mockUnread = 3
    render(<MobileHeader stores={[]} activeStoreId={null} />)
    expect(screen.getByRole('button', { name: 'notifications' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('caps the unread badge at 9+', () => {
    mockUnread = 25
    render(<MobileHeader stores={[]} activeStoreId={null} />)
    expect(screen.getByText('9+')).toBeInTheDocument()
  })

  it('hides the bell while recording', () => {
    mockRecState = 'recording'
    mockUnread = 5
    render(<MobileHeader stores={[]} activeStoreId={null} />)
    expect(screen.queryByRole('button', { name: 'notifications' })).not.toBeInTheDocument()
  })

  it('hides the bell while paused', () => {
    mockRecState = 'paused'
    render(<MobileHeader stores={[]} activeStoreId={null} />)
    expect(screen.queryByRole('button', { name: 'notifications' })).not.toBeInTheDocument()
  })
})
