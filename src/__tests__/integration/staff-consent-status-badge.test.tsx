/**
 * @jest-environment jsdom
 *
 * Render coverage for StaffConsentStatusBadge (PR 24, replay/24,
 * components/coaching/redesign/StaffConsentStatusBadge.tsx). Prop-driven atom
 * with two visual states (granted vs not-yet) and a conditional tooltip.
 * next-intl is mocked so each branch is identified by the translation KEY it
 * renders; the mocked t() interpolates {date} so the tooltip text is asserted.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

import { StaffConsentStatusBadge } from '@/components/coaching/redesign/StaffConsentStatusBadge'

describe('StaffConsentStatusBadge', () => {
  it('renders the granted state', () => {
    render(<StaffConsentStatusBadge granted />)
    expect(screen.getByText('granted')).toBeInTheDocument()
    expect(screen.queryByText('notYet')).not.toBeInTheDocument()
  })

  it('renders the not-yet state when consent is not granted', () => {
    render(<StaffConsentStatusBadge granted={false} />)
    expect(screen.getByText('notYet')).toBeInTheDocument()
    expect(screen.queryByText('granted')).not.toBeInTheDocument()
  })

  it('surfaces the grant date as a tooltip when granted with a givenAt', () => {
    render(<StaffConsentStatusBadge granted givenAt="2026-05-01" />)
    const badge = screen.getByText('granted')
    expect(badge).toHaveAttribute(
      'title',
      'grantedTooltip:{"date":"2026-05-01"}',
    )
  })

  it('omits the tooltip when granted but givenAt is null', () => {
    render(<StaffConsentStatusBadge granted givenAt={null} />)
    expect(screen.getByText('granted')).not.toHaveAttribute('title')
  })

  it('omits the tooltip by default (givenAt unspecified)', () => {
    render(<StaffConsentStatusBadge granted />)
    expect(screen.getByText('granted')).not.toHaveAttribute('title')
  })
})
