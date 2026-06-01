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
  useRouter: () => ({ back }),
}))
// useTranslations(ns) -> (key) => key, so titles/labels equal their key.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/lib/notifications/hooks', () => ({
  useUnreadCount: () => mockUnread,
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
    render(<MobileHeader />)
    expect(screen.getByText('dashboard')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'back' })).not.toBeInTheDocument()
  })

  it('shows a back arrow and the mapped title on a sub-route', () => {
    mockPathname = '/ja/settings'
    render(<MobileHeader />)
    expect(screen.getByRole('button', { name: 'back' })).toBeInTheDocument()
    expect(screen.getByText('settings')).toBeInTheDocument()
  })

  it('maps locale-prefixed karute route to the karute title', () => {
    mockPathname = '/en/karute/abc123'
    render(<MobileHeader />)
    expect(screen.getByText('karute')).toBeInTheDocument()
  })

  it('renders the bell with an unread badge when idle', () => {
    mockUnread = 3
    render(<MobileHeader />)
    expect(screen.getByRole('button', { name: 'notifications' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('caps the unread badge at 9+', () => {
    mockUnread = 25
    render(<MobileHeader />)
    expect(screen.getByText('9+')).toBeInTheDocument()
  })

  it('hides the bell while recording', () => {
    mockRecState = 'recording'
    mockUnread = 5
    render(<MobileHeader />)
    expect(screen.queryByRole('button', { name: 'notifications' })).not.toBeInTheDocument()
  })

  it('hides the bell while paused', () => {
    mockRecState = 'paused'
    render(<MobileHeader />)
    expect(screen.queryByRole('button', { name: 'notifications' })).not.toBeInTheDocument()
  })
})
