/** @jest-environment jsdom */
// Language switcher shell-visibility regression for WelcomeWizard
// (design-parity packet 21, spec item 4): the app-language fieldset is
// wrapped in the SAME WebOnly gate ProfilePageView's language switcher uses
// (ruling ② precedent) — the native-hidden half of this contract is already
// pinned by the wired-mount test (thin-welcome-screen-mount.test.tsx); this
// file protects the OTHER half: web behavior must stay UNCHANGED (the
// fieldset still pops in at hydration, WebOnly's own documented tradeoff).
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
// The real src/actions/org-settings.ts ('use server') pulls next/cache
// internals that TextEncoder-crash under this jest config — this suite never
// submits the wizard, so a bare stub (unlike the wired-mount suite's real
// port reroute) is enough.
jest.mock('@/actions/org-settings', () => ({ completeOnboarding: jest.fn() }))

import { WelcomeWizard } from '@/components/welcome/WelcomeWizard'

describe('WelcomeWizard — language switcher shell visibility (web side)', () => {
  it('still renders the app-language fieldset on the open web (unchanged) — default platform is non-native', async () => {
    render(
      <WelcomeWizard
        initialBusinessName=""
        initialBusinessType=""
        initialDisclosureMode={null}
      />,
    )
    expect(await screen.findByText('日本語')).toBeTruthy()
    expect(screen.getByText('English')).toBeTruthy()
  })
})
