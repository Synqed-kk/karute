/**
 * @jest-environment jsdom
 *
 * 案A tone contract (Liam ruling 2026-08-06): on the dashboard hero card,
 * blue (text-primary) is reserved for PRESSABLE elements — the カルテを開く
 * link. State and decoration (card border, section label, countdown, carousel
 * dot) are achromatic. Guards against the R13 regression class where the
 * primary-token retint silently recolors decoration.
 */
import { render, screen } from '@testing-library/react'
import {
  NextCustomerHero,
  type HeroSlideView,
} from '@/components/dashboard/redesign/NextCustomerHero'

jest.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key
    return t
  },
}))
jest.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

function slide(id: string): HeroSlideView {
  return {
    appointmentId: id,
    clientId: `c-${id}`,
    customerName: '石田 朋代',
    startIso: new Date(Date.now() + 60 * 60_000).toISOString(),
    timeHm: '19:00',
    durationMinutes: 60,
    inProgress: false,
    round: { kind: 'nth', n: 20 },
    course: '6回券',
    staffName: '原 奏恵',
    ticket: { remaining: 1, size: 6 },
    requestNote: null,
    lastVisit: null,
  }
}

describe('NextCustomerHero 案A tone contract', () => {
  it('keeps blue on the open-karute link only', () => {
    const { container } = render(
      <NextCustomerHero slides={[slide('a'), slide('b')]} tomorrow={null} doneCount={0} />,
    )

    // Pressable: the カルテを開く link stays accent.
    const open = screen.getAllByText('openKarute')[0]
    expect(open.className).toContain('text-primary')

    // Section label is muted, never accent.
    const label = screen.getAllByText('nextCustomer')[0]
    expect(label.className).toContain('text-muted-foreground')
    expect(label.className).not.toContain('text-primary')

    // Card frame is the neutral border token.
    const card = container.querySelector('.rounded-2xl.border-2')
    expect(card?.className).toContain('border-border')
    expect(card?.className).not.toContain('border-primary')

    // Active carousel dot is achromatic (two slides → dots row renders).
    const activeDot = container.querySelector('.w-4.rounded-full')
    expect(activeDot?.className).toContain('bg-foreground/50')
    expect(activeDot?.className).not.toContain('bg-primary')
  })

  it('empty-state card labels are muted too', () => {
    render(
      <NextCustomerHero
        slides={[]}
        tomorrow={{ dateLabel: '8/7', timeHm: '10:00', customerName: '田中', count: 3 }}
        doneCount={0}
      />,
    )
    const label = screen.getByText('tomorrowFirst')
    expect(label.className).toContain('text-muted-foreground')
    expect(label.className).not.toContain('text-primary')
  })
})
