/**
 * @jest-environment jsdom
 *
 * One-way accent law contract (Liam ruling 2026-08-06, CLAUDE.md design law):
 * saturated accent is reserved for pressables. Pins the two sites the
 * accent-tier sweep re-tiered — the landing hero badge (decorative label:
 * wash stays, text goes neutral) and the ProcessingModal step spinner
 * (non-pressable status indicator) — and the nearest pressable in each file,
 * which must KEEP accent (the law is one-way, not anti-blue).
 */
import { render, screen } from '@testing-library/react'
import LandingPage from '@/app/[locale]/page'
import { ProcessingModal } from '@/components/review/ProcessingModal'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getMessages: async () => ({}),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key
    return t
  },
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: () => {} }),
}))
jest.mock('@/i18n/client-messages', () => ({
  PAGE_PICKS: { landing: [] },
  pickMessages: () => ({}),
}))
jest.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/layout/locale-toggle', () => ({ LocaleToggle: () => null }))

// Whole-class matcher: 'bg-primary' must not silently pass via
// 'bg-primary/8' or 'hover:bg-primary-hover'.
const cls = (name: string) => new RegExp(`(^|\\s)${name.replace('/', '\\/')}(\\s|$)`)

describe('landing hero badge (decoration)', () => {
  it('badge text is neutral, wash stays, CTA keeps solid accent', async () => {
    render(
      await LandingPage({ params: Promise.resolve({ locale: 'ja' }) }),
    )

    const badge = screen.getByText('hero.badge')
    expect(badge.className).toMatch(cls('bg-primary/8'))
    expect(badge.className).toMatch(cls('text-foreground'))
    expect(badge.className).not.toMatch(cls('text-primary'))

    // One-way: the pressable signup CTA keeps the solid accent fill.
    const cta = screen.getByText('hero.ctaPrimary')
    expect(cta.className).toMatch(cls('bg-primary'))
  })
})

describe('phase 2 — literal blues (non-pressable decoration)', () => {
  it('import stepper current step is wash+border, never solid blue-600', () => {
    const { ImportStepper } = require('@/components/data-import/ImportStepper')
    const { container } = render(<ImportStepper activeStep={1} />)
    expect(container.querySelector('[class*="bg-blue-600"]')).toBeNull()
    const chips = container.querySelectorAll('.size-7')
    const active = chips[1]?.className ?? ''
    expect(active).toMatch(cls('bg-blue-100'))
    expect(active).toMatch(cls('border-blue-300'))
    expect(chips[0]?.className ?? '').toMatch(cls('bg-blue-50'))
  })

  it('export page eyebrow and heading icon are muted, never accent blue', () => {
    const { PageHeader } = require('@/components/export/redesign/sections/PageHeader')
    const { container } = render(<PageHeader />)
    const eyebrow = screen.getByText('eyebrow')
    expect(eyebrow.className).toMatch(cls('text-muted-foreground'))
    expect(eyebrow.className).not.toMatch(cls('text-blue-500'))
    const icon = container.querySelector('h1 svg')
    const iconClass = icon?.getAttribute('class') ?? ''
    expect(iconClass).toMatch(cls('text-muted-foreground'))
    expect(iconClass).not.toMatch(cls('text-blue-500'))
  })
})

describe('ProcessingModal step spinner (status indicator)', () => {
  it('spinner is neutral like its sibling labels', () => {
    const { container } = render(
      <ProcessingModal currentStep="transcribing" onRetry={() => {}} />,
    )
    const spinner = container.querySelector('svg.animate-spin')
    expect(spinner).not.toBeNull()
    const spinnerClass = spinner?.getAttribute('class') ?? ''
    expect(spinnerClass).toMatch(cls('text-foreground'))
    expect(spinnerClass).not.toMatch(cls('text-primary'))
  })

  it('retry commit button keeps solid accent', () => {
    render(<ProcessingModal currentStep="transcribing" error="x" onRetry={() => {}} />)
    expect(screen.getByText('retry').className).toMatch(cls('bg-primary'))
  })
})
