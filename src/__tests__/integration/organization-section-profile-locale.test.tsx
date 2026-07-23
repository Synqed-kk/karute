/**
 * @jest-environment jsdom
 *
 * Ja-sweep pin (lead-audit P1 follow-up): OrganizationSection's AI-tuning
 * profile hint calls getBusinessProfile(business_type) with no locale arg,
 * silently defaulting to English even when the settings page itself is ja
 * (the component already receives `locale` — used for the business-type
 * select's labelJa a few lines below). Fixed call site: pass the locale
 * through.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
// 'use server' action — never invoked in this render-only suite.
jest.mock('@/actions/org-settings', () => ({ upsertOrgSettings: jest.fn() }))

import { OrganizationSection } from '@/components/settings/redesign/sections/OrganizationSection'

describe('OrganizationSection — AI-tuning profile locale', () => {
  it('ja: profile hint shows labelJa (美容整体), not the English label', () => {
    render(
      <OrganizationSection
        orgSettings={{ business_type: 'beauty_chiropractic' } as never}
        locale="ja"
      />,
    )
    // 美容整体 renders twice — the business-type select option AND the
    // profile hint (both keyed off the same beauty_chiropractic value).
    expect(screen.getAllByText(/美容整体/).length).toBe(2)
    expect(screen.queryByText(/Beauty Chiropractic/)).toBeNull()
  })

  it('en: profile hint shows the English label', () => {
    render(
      <OrganizationSection
        orgSettings={{ business_type: 'beauty_chiropractic' } as never}
        locale="en"
      />,
    )
    expect(screen.getAllByText(/Beauty Chiropractic/).length).toBe(2)
    // (Not asserting the absence of 美容整体 here: the English tagline itself
    // names the Japanese business-type term as a proper noun — "...unique to
    // 美容整体." — by existing editorial design, unrelated to this fix.)
  })
})
