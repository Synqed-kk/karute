/** @jest-environment jsdom */
// 案D two-band contract (2026-09-03, PACKET-CARD-D): CustomerHeaderCard
// renders exactly two bands — identity (band 1) and labeled session facts
// (band 2). Band 2 is column-collapsing: each fact renders ONLY when its
// value exists, in a fixed ruled order, and the whole band disappears when
// nothing has a value (no dash, no orphan label — see CustomerHeaderCard.tsx
// / mocks/mock-header-d.html).
import { render, screen } from '@testing-library/react'

const useLocaleMock = jest.fn(() => 'ja')
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => useLocaleMock(),
}))
jest.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { CustomerHeaderCard } from '@/components/karute/redesign/detail/CustomerHeaderCard'

beforeEach(() => {
  useLocaleMock.mockReturnValue('ja')
})

// Asymmetric fixture (lane law): every same-typed prop pair gets a distinct
// value, so a swapped field or a wrong-field read shows up in the assertions.
const FULL_PROPS = {
  customerName: 'CHIANG CHIEH',
  initials: 'CC',
  karuteNumber: '#00042',
  service: 'カット',
  sessionDateLong: 'August 22, 2026',
  staffName: '佐藤',
  phone: '080-1111-2222',
  email: 'x@y.jp',
  age: 32,
  gender: '男性',
  visitNumber: 4,
  lastVisitDate: 'July 10, 2026',
  lastVisitAgo: '(45日前)',
  customerHref: '/customers/c1',
}

describe('CustomerHeaderCard — two-band contract (案D)', () => {
  it('full props: section has exactly two children — identity row + facts row', () => {
    const { container } = render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(container.querySelector('section')?.children).toHaveLength(2)
  })

  it('facts render label+value pairs in the ruled order, each label paired with its own value', () => {
    const { container } = render(<CustomerHeaderCard {...FULL_PROPS} />)
    const factsRow = container.querySelector('section')!.children[1]
    const cols = Array.from(factsRow.children)
    const labels = cols.map((col) => col.firstElementChild?.textContent)
    expect(labels).toEqual([
      'header.sessionDate',
      'header.visitCount',
      'header.lastVisit',
      'header.menu',
      'header.staff',
      'header.phone',
      'header.email',
    ])
    const values = cols.map((col) => col.children[1]?.textContent)
    expect(values[0]).toBe('August 22, 2026')
    expect(values[1]).toBe('4回目')
    expect(values[2]).toContain('July 10, 2026')
    expect(values[2]).toContain('(45日前)')
    expect(values[3]).toBe('カット')
    expect(values[4]).toBe('佐藤')
    expect(values[5]).toBe('080-1111-2222')
    expect(values[6]).toBe('x@y.jp')
  })

  it('email value is the lighter weight (500); other fact values stay semibold (600)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const emailValue = screen.getByText('x@y.jp')
    expect(emailValue.className).toMatch(/(^|\s)font-medium(\s|$)/)
    expect(emailValue.className).not.toMatch(/(^|\s)font-semibold(\s|$)/)
    const phoneValue = screen.getByText('080-1111-2222')
    expect(phoneValue.className).toMatch(/(^|\s)font-semibold(\s|$)/)
  })

  it('chip shows the karuteNumber verbatim', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(screen.getByText('#00042')).toBeInTheDocument()
  })

  it('h2 + Link + aria-label survive with customerHref', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const heading = screen.getByRole('heading', { level: 2 })
    const link = screen.getByRole('link', { name: 'CHIANG CHIEH — header.openCustomer' })
    expect(heading.contains(link)).toBe(true)
    expect(link).toHaveAttribute('href', '/customers/c1')
  })

  it('age+gender join renders the 歳・ shape in ja', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(screen.getByText('32歳・男性')).toBeInTheDocument()
  })

  it('age alone (no gender) renders bare, no dangling separator', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} gender={null} />)
    expect(screen.getByText('32歳')).toBeInTheDocument()
    expect(screen.queryByText(/・/)).toBeNull()
  })

  it('en locale: visitCount value is the bare count, no ordinal/visit suffix', () => {
    useLocaleMock.mockReturnValue('en')
    render(<CustomerHeaderCard {...FULL_PROPS} visitNumber={21} />)
    const label = screen.getByText('header.visitCount')
    expect(label.nextElementSibling?.textContent).toBe('21')
  })

  it('each nullable column collapses entirely when its value is null — no orphan label, no dash', () => {
    const { container } = render(
      <CustomerHeaderCard
        {...FULL_PROPS}
        service={null}
        staffName={null}
        phone={null}
        email={null}
        visitNumber={null}
        lastVisitDate={null}
        lastVisitAgo={null}
      />,
    )
    for (const label of [
      'header.menu',
      'header.staff',
      'header.phone',
      'header.email',
      'header.visitCount',
      'header.lastVisit',
    ]) {
      expect(screen.queryByText(label)).toBeNull()
    }
    // Only sessionDate is left standing.
    const factsRow = container.querySelector('section')!.children[1]
    expect(factsRow.children).toHaveLength(1)
    expect(container.textContent).not.toMatch(/—/)
  })

  // Fix round 1 pins (blind-verify coverage gaps V-M1/V-M2/V-M3/V-M6/V-M9 —
  // each behavior already existed in the code; only the pin was missing).
  it('border-t is present on the facts band when facts exist (kills V-M2)', () => {
    const { container } = render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(container.querySelector('.border-t')).not.toBeNull()
  })

  it('email Fact wrapper carries flex-[1_1_160px] + max-sm:flex-[1_1_100%] (kills V-M9)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const emailWrapper = screen.getByText('x@y.jp').parentElement
    expect(emailWrapper?.className).toMatch(/flex-\[1_1_160px\]/)
    expect(emailWrapper?.className).toMatch(/max-sm:flex-\[1_1_100%\]/)
  })

  it('section carries tabular-nums (kills V-M1)', () => {
    const { container } = render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(container.querySelector('section')?.className).toMatch(/(^|\s)tabular-nums(\s|$)/)
  })

  it('avatar carries the three dark: variant classes (kills V-M6)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const avatar = screen.getByText('CC')
    expect(avatar.className).toMatch(/dark:border-blue-500\/25/)
    expect(avatar.className).toMatch(/dark:bg-blue-500\/15/)
    expect(avatar.className).toMatch(/dark:text-blue-300/)
  })

  it('h2 carries min-w-0 for the truncation chain (kills V-M3)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.className).toMatch(/(^|\s)min-w-0(\s|$)/)
  })

  it('all-null facts cell: section collapses to a single child, no stray border row', () => {
    const { container } = render(
      <CustomerHeaderCard
        {...FULL_PROPS}
        sessionDateLong=""
        service={null}
        staffName={null}
        phone={null}
        email={null}
        visitNumber={null}
        lastVisitDate={null}
        lastVisitAgo={null}
      />,
    )
    const section = container.querySelector('section')!
    expect(section.children).toHaveLength(1)
    expect(container.querySelector('.border-t')).toBeNull()
  })
})
