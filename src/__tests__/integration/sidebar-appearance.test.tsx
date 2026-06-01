/**
 * @jest-environment jsdom
 *
 * Render coverage for Sidebar (PR #88/#104, replay/13): the sidebar-style
 * preference is actually applied to the <aside> (the bug this PR fixed was
 * the picker writing the value but no surface reading it).
 */
import { render, screen } from '@testing-library/react'

let mockStyle: 'light' | 'dark' = 'light'

jest.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
jest.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: jest.fn() } }),
}))
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({
    orgName: 'Salon',
    activeStaff: { name: 'Tanaka', displayRole: 'owner', avatarUrl: null },
  }),
}))
jest.mock('@/lib/sidebar-style/hooks', () => ({
  useSidebarStyle: () => mockStyle,
}))

import { Sidebar } from '@/components/layout/sidebar'

afterEach(() => {
  mockStyle = 'light'
})

describe('Sidebar appearance', () => {
  it('applies the dark token cascade when the preference is dark', () => {
    mockStyle = 'dark'
    render(<Sidebar />)
    const aside = screen.getByLabelText('Main navigation')
    expect(aside.className).toContain('dark')
    expect(aside.className).toContain('bg-neutral-900')
  })

  it('uses the default card background when the preference is light', () => {
    mockStyle = 'light'
    render(<Sidebar />)
    const aside = screen.getByLabelText('Main navigation')
    expect(aside.className).not.toContain('bg-neutral-900')
    expect(aside.className).toContain('bg-[var(--color-bg-card)]')
  })

  it('renders the always-on nav destinations', () => {
    render(<Sidebar />)
    // labelKeys render verbatim via the mocked useTranslations.
    expect(screen.getByText('dashboard')).toBeInTheDocument()
    expect(screen.getByText('customers')).toBeInTheDocument()
    expect(screen.getByText('settings')).toBeInTheDocument()
  })
})
