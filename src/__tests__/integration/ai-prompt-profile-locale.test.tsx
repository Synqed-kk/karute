/**
 * @jest-environment jsdom
 *
 * Ja-sweep pins (packet 27): PromptTemplateCard renders whichever locale's
 * ConsultationQuestion it's handed (title/preview are ALREADY the resolved
 * shape — business-types.ts's resolveQuestion/resolveProfile strip the
 * titleJa/previewJa/labelJa fields down to one locale before these
 * components ever see them), and BusinessProfileHint renders profile.label
 * the same way. next-intl mocked key-echo style (matches the suite's
 * convention).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

import { PromptTemplateCard } from '@/components/ai/redesign/PromptTemplateCard'
import { BusinessProfileHint } from '@/components/ai/redesign/BusinessProfileHint'
import { getBusinessProfile, getConsultationQuestions } from '@/lib/welcome/business-types'

describe('PromptTemplateCard — locale', () => {
  it('ja: renders titleJa/previewJa, not the English title/preview', () => {
    const [template] = getConsultationQuestions('beauty_chiropractic', 'ja')
    render(<PromptTemplateCard template={template} onPick={() => {}} />)
    expect(screen.getByText('ブライダル目標のお客様')).toBeTruthy()
    expect(screen.queryByText('Bridal-goal customers')).toBeNull()
  })

  it('en: renders the English title/preview', () => {
    const [template] = getConsultationQuestions('beauty_chiropractic', 'en')
    render(<PromptTemplateCard template={template} onPick={() => {}} />)
    expect(screen.getByText('Bridal-goal customers')).toBeTruthy()
    expect(screen.queryByText('ブライダル目標のお客様')).toBeNull()
  })
})

describe('BusinessProfileHint — locale', () => {
  it('ja: renders labelJa (美容整体 for beauty_chiropractic)', () => {
    const profile = getBusinessProfile('beauty_chiropractic', 'ja')
    render(<BusinessProfileHint profile={profile} />)
    expect(screen.getByText('美容整体')).toBeTruthy()
  })

  it('en: renders the English label', () => {
    const profile = getBusinessProfile('beauty_chiropractic', 'en')
    render(<BusinessProfileHint profile={profile} />)
    expect(screen.getByText('Beauty Chiropractic')).toBeTruthy()
  })
})
