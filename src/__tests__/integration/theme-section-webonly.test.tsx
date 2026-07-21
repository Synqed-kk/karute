/** @jest-environment jsdom */
// Language switcher shell-visibility on ThemeSection (design-parity packet
// 12 §S1, pre-ruled the SAME way as ProfilePageView's switcher — see
// profile-page-view-webonly.test.tsx): hidden in the native shell (WebOnly,
// the same gate the plan-change CTA / profile switcher already use), still
// renders on the open web exactly as before. The displayMode picker beside
// it is UNGATED — proves the WebOnly wrap is scoped to the language block
// only, not the whole grid row.
import { render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/ja/settings',
}))
jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: jest.fn() }),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/actions/org-settings', () => ({ upsertOrgSettings: jest.fn(async () => ({ success: true })) }))

import { ThemeSection } from '@/components/settings/redesign/sections/ThemeSection'

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('ThemeSection — language switcher shell visibility', () => {
  it('NEVER renders the switcher inside the native shell', async () => {
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    render(<ThemeSection orgSettings={null} locale="ja" />)
    await waitFor(() => {})
    expect(screen.queryByText('displayLanguage')).toBeNull()
    expect(screen.queryByText('English')).toBeNull()
    // The display-mode picker (ungated) is unaffected.
    expect(screen.getByText('displayMode')).toBeTruthy()
  })

  it('still renders the switcher on the open web (unchanged)', async () => {
    render(<ThemeSection orgSettings={null} locale="ja" />)
    expect(await screen.findByText('displayLanguage')).toBeTruthy()
    expect(screen.getByText('English')).toBeTruthy()
    expect(screen.getByText('displayMode')).toBeTruthy()
  })
})
