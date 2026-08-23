/** @jest-environment jsdom */
// R8-1 (fix round 8, micro): the actions slot moved from a dedicated
// full-width row under the contact line to trailing-inline in the TITLE
// row — a lone small icon rendered in its own row read as dead vertical
// space (Liam's screenshots, 8/23 ~16:43).
// 案D (2026-09-03): the card became two bands (identity row + labeled facts
// row). Pins updated to the new shape, SAME intent: the actions slot still
// lives inside the identity row (never a dedicated row of its own), and the
// empty-band rule (no facts → the facts row doesn't render at all) is now
// pinned here too, since it changes what "no extra row" even means.
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
// Not exercised (customerHref/onEdit both omitted below) but imported at
// module scope regardless — same stub idiom as accent-tier-contract.test.tsx.
jest.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { CustomerHeaderCard } from '@/components/karute/redesign/detail/CustomerHeaderCard'

// sessionDateLong alone is already ≥1 fact value, so this base fixture
// always produces a two-band card (identity + facts).
const BASE_PROPS = {
  customerName: '田中 美咲',
  initials: 'TM',
  karuteNumber: '#00001',
  service: null,
  sessionDateLong: 'August 23, 2026',
  staffName: null,
  phone: null,
  email: null,
}

// No fact value has anything to show, including sessionDateLong itself —
// the true empty-band case.
const NO_FACTS_PROPS = { ...BASE_PROPS, sessionDateLong: '' }

describe('CustomerHeaderCard — actions slot placement (fix round 8, R8-1; reshaped for 案D)', () => {
  it('actions present: the marker lives inside the identity row (same row as the h2), not a dedicated row below it', () => {
    render(
      <CustomerHeaderCard
        {...BASE_PROPS}
        actions={<button data-testid="action-marker">⇆</button>}
      />,
    )
    const marker = screen.getByTestId('action-marker')
    const titleRow = screen.getByText('田中 美咲').closest('h2')?.parentElement
    expect(titleRow).not.toBeNull()
    expect(titleRow?.contains(marker)).toBe(true)
  })

  it('section has exactly two children (identity + facts) with actions present, given ≥1 fact value', () => {
    const { container } = render(
      <CustomerHeaderCard
        {...BASE_PROPS}
        actions={<button data-testid="action-marker">⇆</button>}
      />,
    )
    expect(container.querySelector('section')?.children).toHaveLength(2)
  })

  // Direct translation of the original length-1 pin: actions absent used to
  // mean "the card is a single row." In the two-band shape that becomes
  // "still exactly two children" whenever a fact value exists (sessionDateLong
  // does, in BASE_PROPS) — the facts band is not something `actions` controls.
  it('section has exactly two children (identity + facts) with actions absent, given ≥1 fact value', () => {
    const { container } = render(<CustomerHeaderCard {...BASE_PROPS} />)
    expect(container.querySelector('section')?.children).toHaveLength(2)
  })

  it('empty-band rule: actions absent and every fact value absent → section has exactly one child', () => {
    const { container } = render(<CustomerHeaderCard {...NO_FACTS_PROPS} />)
    expect(container.querySelector('section')?.children).toHaveLength(1)
  })
})
