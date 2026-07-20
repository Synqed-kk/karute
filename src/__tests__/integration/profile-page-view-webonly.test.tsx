/** @jest-environment jsdom */
// Language switcher shell-visibility (design-parity packet 12 §B-2, spec
// item 4): PRE-RULED — the language toggle is meaningless in the
// single-locale thin shell (no second path segment to swap into), so it
// hides there via the SAME WebOnly gate the plan-change CTA already uses
// (src/components/settings/redesign/sections/StoresSection.tsx) — never a
// new mechanism. Web behavior is UNCHANGED: WebOnly renders its children on
// the open web exactly as always (after hydration, per WebOnly's own
// contract — see thin-webonly-gate.test.tsx for the generic gate proof).
import { render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ja',
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/profile',
}))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: jest.fn() } }),
}))

import { ProfilePageView, type ProfilePageProfile } from '@/components/profile/redesign/ProfilePageView'

const profile: ProfilePageProfile = {
  name: 'Mika Tanaka',
  initials: 'MT',
  email: 'mika@example.com',
  role: 'staff',
  roleLabel: { ja: 'スタッフ', en: 'Stylist' },
  storeName: { ja: 'テストサロン', en: 'テストサロン' },
}

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('ProfilePageView — language switcher shell visibility', () => {
  it('NEVER renders the switcher inside the native shell', async () => {
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    render(<ProfilePageView profile={profile} />)
    // Give the effect a chance to (not) flip the gate open.
    await waitFor(() => {})
    expect(screen.queryByText('languageJa')).toBeNull()
    expect(screen.queryByText('preferencesSection')).toBeNull()
  })

  it('still renders the switcher on the open web (unchanged)', async () => {
    render(<ProfilePageView profile={profile} />)
    expect(await screen.findByText('languageJa')).toBeTruthy()
    expect(screen.getByText('languageEn')).toBeTruthy()
    expect(screen.getByText('preferencesSection')).toBeTruthy()
  })
})
