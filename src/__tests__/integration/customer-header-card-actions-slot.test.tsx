/** @jest-environment jsdom */
// R8-1 (fix round 8, micro): the actions slot moved from a dedicated
// full-width row under the contact line to trailing-inline in the TITLE
// row — a lone small icon rendered in its own row read as dead vertical
// space (Liam's screenshots, 8/23 ~16:43). Pins: the card never grows an
// extra <section> row whether the slot is present or absent, and when
// present its content lives INSIDE the title row (same row as the
// customer name), not as a sibling row after it.
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

describe('CustomerHeaderCard — actions slot placement (fix round 8, R8-1)', () => {
  it('actions absent: the card is a single row, no empty second row', () => {
    const { container } = render(<CustomerHeaderCard {...BASE_PROPS} />)
    const section = container.querySelector('section')
    expect(section?.children).toHaveLength(1)
  })

  // Red-run target: reverting to the round-4/7 shape (actions rendered as a
  // second <section> child) makes section.children length 2 here.
  it('actions present: STILL a single row — the icon lives inside the title row, not a dedicated row below it', () => {
    const { container } = render(
      <CustomerHeaderCard {...BASE_PROPS} actions={<button data-testid="action-marker">⇆</button>} />,
    )
    const section = container.querySelector('section')
    expect(section?.children).toHaveLength(1)

    const marker = screen.getByTestId('action-marker')
    const titleRow = screen.getByText('田中 美咲').closest('h2')?.parentElement
    expect(titleRow).not.toBeNull()
    expect(titleRow?.contains(marker)).toBe(true)
  })
})
