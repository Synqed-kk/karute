/** @jest-environment jsdom */
// R8-1 (fix round 8, micro): the actions slot moved from a dedicated
// full-width row under the contact line to trailing-inline in the TITLE
// row — a lone small icon rendered in its own row read as dead vertical
// space (Liam's screenshots, 8/23 ~16:43).
// ⚖ 2026-09-03 (PACKET-CARD-CLONE, v2 adjudicated): the card is now an
// exact structural clone of the customer page's real header (one flex row:
// avatar + body + trailing action slot). The old two-band "section has
// exactly two children" pins (3 sites total across this file and
// customer-header-card-two-band-contract.test.tsx) are gone — that shape
// no longer exists. SAME intent carried forward: actions never becomes a
// dedicated row of its own, and stays trailing in the top identity row.
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

describe('CustomerHeaderCard — actions slot placement (fix round 8, R8-1; reshaped for the 顧客ページ clone)', () => {
  it('actions present: the marker sits trailing in the top identity row (sibling of avatar+body), never a dedicated row below it', () => {
    render(
      <CustomerHeaderCard
        {...BASE_PROPS}
        actions={<button data-testid="action-marker">⇆</button>}
      />,
    )
    const marker = screen.getByTestId('action-marker')
    const heading = screen.getByRole('heading', { level: 2 })
    const section = heading.closest('section')!
    const topRow = section.firstElementChild! // the flex row: avatar, body, actions
    expect(topRow.contains(marker)).toBe(true)
    expect(topRow.contains(heading)).toBe(true)
    // The marker's own wrapper is a direct child of the top row (a
    // trailing sibling of the avatar/body pair), not nested inside the
    // body stack that holds the meta/contact/staff rows.
    expect(Array.from(topRow.children)).toContain(marker.parentElement)
  })

  it('actions absent: no action wrapper renders at all', () => {
    const { container } = render(<CustomerHeaderCard {...BASE_PROPS} />)
    expect(container.querySelector('[class*="ml-auto"]')).toBeNull()
  })

  it('actions slot uses ml-auto self-start (clone position: top-right, pinned to the top of the row)', () => {
    render(
      <CustomerHeaderCard
        {...BASE_PROPS}
        actions={<button data-testid="action-marker">⇆</button>}
      />,
    )
    const marker = screen.getByTestId('action-marker')
    const wrapper = marker.parentElement!
    expect(wrapper.className).toMatch(/(^|\s)ml-auto(\s|$)/)
    expect(wrapper.className).toMatch(/(^|\s)self-start(\s|$)/)
  })

  it('collapse-when-null still holds with actions present: absent fact values render no empty rows', () => {
    const { container } = render(
      <CustomerHeaderCard
        {...BASE_PROPS}
        sessionDateLong=""
        actions={<button data-testid="action-marker">⇆</button>}
      />,
    )
    const section = container.querySelector('section')!
    const body = section.querySelector('h2')!.closest('div')!.parentElement!
    // Only the name row stands — meta/contact/staff never mount, actions
    // sits outside the body entirely (sibling in the top row).
    expect(body.children).toHaveLength(1)
  })
})
