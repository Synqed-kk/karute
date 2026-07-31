/** @jest-environment jsdom */
// Language-choice shell visibility for WelcomeWizard (design-parity packet
// 21, ruling ②): hidden via the hideLanguageChoice optional prop (the S5
// webOnlyTabIds precedent — web default unchanged), NOT a WebOnly wrap, so
// the open web keeps the fieldset in SSR/first paint with zero flash. The
// native-hidden half of the contract is also pinned by the wired-mount test
// (thin-welcome-screen-mount.test.tsx) through the real WelcomeScreen; this
// file pins BOTH prop states at the component seam.
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

describe('WelcomeWizard — app-language choice visibility', () => {
  it('renders the fieldset on the open web (no prop) SYNCHRONOUSLY — first paint, no effect-tick pop-in', () => {
    render(
      <WelcomeWizard
        initialBusinessName=""
        initialBusinessType=""
        initialDisclosureMode={null}
      />,
    )
    // getBy* immediately after render — an effect-gated reveal (the WebOnly
    // shape this deliberately is NOT) would fail here.
    expect(screen.getByText('日本語')).toBeTruthy()
    expect(screen.getByText('English')).toBeTruthy()
  })

  it('hideLanguageChoice hides the fieldset (thin shell, single-locale)', () => {
    render(
      <WelcomeWizard
        initialBusinessName=""
        initialBusinessType=""
        initialDisclosureMode={null}
        hideLanguageChoice
      />,
    )
    expect(screen.queryByText('日本語')).toBeNull()
    expect(screen.queryByText('English')).toBeNull()
  })

  // Ja sweep (packet 27): business-type select options + the AI-tuning
  // profile label render their labelJa twin at ja (useLocale mocked 'ja'
  // above) instead of the English BUSINESS_TYPES/business-types.ts default.
  it('ja sweep: business-type options + AI-tuning profile label render Ja', () => {
    render(
      <WelcomeWizard
        initialBusinessName="La Estro"
        initialBusinessType="beauty_chiropractic"
        initialDisclosureMode={null}
      />,
    )
    expect(screen.getByText('ヘアサロン')).toBeTruthy()
    expect(screen.queryByText('Hair Salon')).toBeNull()
    // 美容整体 renders twice — the select option AND the AI-tuning profile
    // label (both keyed off the same beauty_chiropractic labelJa).
    expect(screen.getAllByText('美容整体').length).toBe(2)
    expect(screen.queryByText('Beauty Chiropractic')).toBeNull()
  })
})
