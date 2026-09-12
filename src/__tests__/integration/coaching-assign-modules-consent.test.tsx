/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { LearningModulesView } from '@/components/coaching/redesign/LearningModulesView'
import { AssignModulesCard } from '@/components/coaching/redesign/AssignModulesCard'
import type { StaffPerformance } from '@/components/coaching/redesign/owner-types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => new URLSearchParams() }))
jest.mock('@/lib/coaching-dev-preview/hooks', () => ({ useEffectiveCoachingRole: (role: string) => role }))

function staff(name: string, consentGiven: boolean): StaffPerformance {
  return {
    staffId: name, name, initials: name[0], role: 'practitioner',
    closingRate: 0, rebookingRate: 0, avgRevenueJpy: 0,
    customerSatisfaction: 0, sessionsThisMonth: 0, growthTrend: 'flat',
    trendDeltaPct: 0, focusAreas: [], isTopPerformer: false, consentGiven,
  }
}

it.each(['dashboard', 'library'] as const)('offers modules independently of AI consent in the %s', (surface) => {
  const Component = surface === 'dashboard' ? AssignModulesCard : LearningModulesView
  render(<Component role="owner"
    modules={[{ id: 'module', title: 'Listening skills', category: 'communication', durationMin: 10 }]}
    staff={[staff('Declined', false), staff('Accepted', true)]}
  />)
  const declined = screen.getByRole('button', { name: 'Declined' })
  expect(declined).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Accepted' })).toBeEnabled()
  fireEvent.click(declined)
  expect(declined).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(declined)
  expect(declined).toHaveAttribute('aria-pressed', 'false')
})

it('keeps the library read-only for staff even when recipients declined AI coaching', () => {
  render(<LearningModulesView role="staff"
    modules={[{ id: 'module', title: 'Listening skills', category: 'communication', durationMin: 10 }]}
    staff={[staff('Declined', false)]}
  />)
  const button = screen.getByRole('button', { name: 'Declined' })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(button).toHaveAttribute('aria-pressed', 'false')
})
