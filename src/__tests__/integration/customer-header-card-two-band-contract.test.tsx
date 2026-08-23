/** @jest-environment jsdom */
// ⚖ 2026-09-03 (PACKET-CARD-CLONE, v2 adjudicated): CustomerHeaderCard is
// now an exact structural clone of the customer page's real header
// (CustomerIdentityCard.tsx, e1a3f326) — flat chrome (bg-card + border-b
// only), one flex row (avatar + body + trailing action slot), per-item
// collapse-when-null throughout. The old two-band (identity row + labeled
// facts row) shape this file used to pin is gone; filename kept to avoid
// an unrequested rename (the packet never asked for one).
import { render, screen } from '@testing-library/react'

const useLocaleMock = jest.fn(() => 'ja')
// VERIFIER FIX: the repo's established real-message mock idiom
// (reassign-customer-action-copy / photos-tab-upload-guard / … — the sibling
// component in this same directory uses it). Resolves against the REAL
// messages, THROWS on a missing key, and leaves `{var}` literal when the
// interpolation arg is missing — so a deleted or re-parameterised key fails
// the suite instead of sailing past a raw-key assertion.
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  const en = jest.requireActual('../../../messages/en.json')
  return {
    useLocale: () => useLocaleMock(),
    // useLocaleMock() is called here (in useTranslations itself, not in the
    // returned callback) so eslint's react-hooks/rules-of-hooks sees it
    // inside a hook-named function, matching real next-intl: the locale is
    // resolved once per useTranslations() call, same as every render.
    useTranslations: (ns: string) => {
      const loc = useLocaleMock()
      return (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = loc === 'en' ? en : ja
        for (const part of `${ns}.${key}`.split('.'))
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        if (typeof cur !== 'string') throw new Error(`missing ${loc}.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars?.[v] ?? `{${v}}`))
      }
    },
  }
})
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

describe('CustomerHeaderCard — 顧客ページ clone contract (案D確定)', () => {
  // ---- B-2 flat chrome pin ----------------------------------------------
  it('section is FLAT: bg-card + border-b only, never rounded/shadow/a full border box', () => {
    const { container } = render(<CustomerHeaderCard {...FULL_PROPS} />)
    const section = container.querySelector('section')!
    expect(section.className).toMatch(/(^|\s)bg-card(\s|$)/)
    expect(section.className).toMatch(/(^|\s)border-b(\s|$)/)
    expect(section.className).not.toMatch(/rounded-/)
    expect(section.className).not.toMatch(/shadow-/)
    // "border " (a full-box border utility) — border-b / border-black-5 etc.
    // never match this because the token right after "border" isn't a
    // space or string end.
    expect(section.className).not.toMatch(/(^|\s)border(\s|$)/)
  })

  // ---- chip / heading survive --------------------------------------------
  it('chip shows the karuteNumber verbatim', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(screen.getByText('#00042')).toBeInTheDocument()
  })

  it('h2 + Link + aria-label survive with customerHref', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const heading = screen.getByRole('heading', { level: 2 })
    const link = screen.getByRole('link', { name: 'CHIANG CHIEH — 顧客カルテを開く' })
    expect(heading.contains(link)).toBe(true)
    expect(link).toHaveAttribute('href', '/customers/c1')
  })

  it('h2 carries min-w-0 for the truncation chain (kills V-M3)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.className).toMatch(/(^|\s)min-w-0(\s|$)/)
  })

  // ---- B-6 truncation: h2 itself never truncates a linked name ----------
  it('h2 carries NO truncate class — only the linked span ellipsizes; Link/span/chevron chain intact', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.className).not.toMatch(/(^|\s)truncate(\s|$)/)
    const link = screen.getByRole('link', { name: 'CHIANG CHIEH — 顧客カルテを開く' })
    expect(link.className).toMatch(/(^|\s)min-w-0(\s|$)/)
    expect(link.className).toMatch(/max-w-full/)
    const nameSpan = link.querySelector('span')!
    expect(nameSpan.className).toMatch(/(^|\s)min-w-0(\s|$)/)
    expect(nameSpan.className).toMatch(/(^|\s)truncate(\s|$)/)
    const chevron = link.querySelector('svg')!
    expect(chevron.getAttribute('class')).toMatch(/shrink-0/)
  })

  // ---- avatar: neutral, no accent, no dark: variants (clone fidelity) ---
  it('avatar is neutral (bg-muted ring) — no blue, no dark: variant classes', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const avatar = screen.getByText('CC')
    expect(avatar.className).toMatch(/(^|\s)bg-muted(\s|$)/)
    expect(avatar.className).not.toMatch(/dark:/)
    expect(avatar.className).not.toMatch(/blue/)
  })

  // ---- B-4 age/gender: real cross-namespace key, age THEN gender --------
  it('age uses the real customers.profile.ageValue key (age THEN gender, ja separator)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    // Mock echoes the key verbatim (no interpolation) — this proves the
    // RIGHT key fires, in the right order, with the branch's own ・ join.
    expect(screen.getByText('32歳・男性')).toBeInTheDocument()
  })

  it('age alone (no gender) renders bare via the same key, no dangling separator', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} gender={null} />)
    expect(screen.getByText('32歳')).toBeInTheDocument()
    expect(screen.queryByText(/・/)).toBeNull()
  })

  it('en locale: age/gender separator switches to " · "', () => {
    useLocaleMock.mockReturnValue('en')
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(screen.getByText('32 y/o · 男性')).toBeInTheDocument()
  })

  // ---- B-4 visit count: bare item, no 来店 prefix, real suffix key ------
  it('visit count is a bare item — no header.visitCount label, no 来店 prefix, real visitCountSuffix key', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(screen.queryByText(/来店/)).toBeNull()
    const countEl = screen.getByText('4')
    expect(countEl.nextElementSibling?.textContent).toBe(' 回')
  })

  it('en locale: visit count keeps the real suffix key (not a bare-count assumption)', () => {
    useLocaleMock.mockReturnValue('en')
    render(<CustomerHeaderCard {...FULL_PROPS} visitNumber={21} />)
    const countEl = screen.getByText('21')
    expect(countEl.nextElementSibling?.textContent).toBe(' visits')
  })

  // ---- lastVisit / sessionDate meta items --------------------------------
  it('lastVisit renders label + value + muted ago suffix', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(screen.getByText('前回')).toBeInTheDocument()
    expect(screen.getByText('July 10, 2026')).toBeInTheDocument()
    expect(screen.getByText('(45日前)')).toBeInTheDocument()
  })

  it('施術日 (sessionDate) rides the SAME meta row as age/gender/visit/lastVisit (density rule — never its own row)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const sessionLabel = screen.getByText(/施術日/)
    const ageEl = screen.getByText('32歳・男性')
    expect(sessionLabel.closest('div')).toBe(ageEl.closest('div'))
  })

  // ---- B-4/B-3 contact: real tel:/mailto: links, no `—` fallback --------
  it('phone renders as a tel: link, email as a mailto: link (clone behavior)', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    const phoneLink = screen.getByRole('link', { name: '080-1111-2222' })
    expect(phoneLink).toHaveAttribute('href', 'tel:080-1111-2222')
    const emailLink = screen.getByRole('link', { name: 'x@y.jp' })
    expect(emailLink).toHaveAttribute('href', 'mailto:x@y.jp')
  })

  // ---- B-5 tabular-nums moved off the section, onto the phone value -----
  it('tabular-nums lives on the phone value/tel link, not blanket on the section', () => {
    const { container } = render(<CustomerHeaderCard {...FULL_PROPS} />)
    const section = container.querySelector('section')!
    expect(section.className).not.toMatch(/(^|\s)tabular-nums(\s|$)/)
    const phoneLink = screen.getByRole('link', { name: '080-1111-2222' })
    expect(phoneLink.className).toMatch(/(^|\s)tabular-nums(\s|$)/)
  })

  // ---- staff / service ----------------------------------------------------
  it('担当 renders the real staffName; service rides as a plain unlabeled item', () => {
    render(<CustomerHeaderCard {...FULL_PROPS} />)
    expect(screen.getByText(/担当/)).toBeInTheDocument()
    expect(screen.getByText('佐藤')).toBeInTheDocument()
    expect(screen.getByText('カット')).toBeInTheDocument()
  })

  // ---- collapse-when-null: no orphan rows, no dashes ---------------------
  it('each nullable item collapses entirely when its value is null — no orphan label, no dash', () => {
    render(
      <CustomerHeaderCard
        {...FULL_PROPS}
        service={null}
        staffName={null}
        phone={null}
        email={null}
        visitNumber={null}
        lastVisitDate={null}
        lastVisitAgo={null}
        age={null}
        gender={null}
      />,
    )
    for (const text of [/担当/, /前回/, /歳/, / 回/]) {
      expect(screen.queryByText(text)).toBeNull()
    }
    expect(screen.queryByText(/—/)).toBeNull()
  })

  it('collapse-when-null reaches the ROW level too: absent contact/staff data renders no empty wrapper rows', () => {
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
        age={null}
        gender={null}
        sessionDateLong=""
      />,
    )
    // Only the name row (avatar+body's first child) is left standing —
    // the meta / contact / staff rows never mount at all (not just empty).
    const section = container.querySelector('section')!
    const body = section.querySelector('h2')!.closest('div')!.parentElement!
    expect(body.children).toHaveLength(1)
  })

  it('all-optional-data-present: no stray empty rows — body has exactly the four populated rows', () => {
    const { container } = render(<CustomerHeaderCard {...FULL_PROPS} />)
    const section = container.querySelector('section')!
    const body = section.querySelector('h2')!.closest('div')!.parentElement!
    // name row, meta row, contact row, staff row
    expect(body.children).toHaveLength(4)
  })
})
