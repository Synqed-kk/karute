/**
 * @jest-environment jsdom
 *
 * ⚖ Liam flag 70 rider (i) — the EN/JA tap keeps where the operator was going.
 *
 * The wall carries `?next=` to the login page (#754, pinned in
 * login-return-to.test.ts). Tapping the language toggle there used to throw it
 * straight back away: `usePathname()` is next-intl's path-only wrapper, so the
 * replace rebuilt the URL without any search at all. The operator switched to
 * English, signed in, and landed on the dashboard instead of the Business link
 * they had opened — the one visible edge left by the two-lens blind round.
 *
 * ⚠ THIS IS THE **WEB** TOGGLE — src/components/layout/locale-toggle.tsx, which
 * navigates through router.replace. It is NOT the iOS thin shell's toggle
 * (thin/screens/LoginScreen.tsx, which calls setThinLocale and has no router).
 * That one is pinned by thin-login-locale-toggle.test.tsx and MUST stay
 * query-blind — do not move these assertions there. This file exists because
 * the web component had no test home: the only two suites that touch it
 * (login-form.test.tsx, accent-tier-contract.test.tsx) both mock it to a stub.
 */
import { fireEvent, render, screen } from '@testing-library/react'

const replace = jest.fn()
let mockPathname = '/login'

jest.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace }),
}))
jest.mock('next-intl', () => ({
  useLocale: () => 'ja',
  useTranslations: () => (key: string) => key,
}))

import { LocaleToggle } from '@/components/layout/locale-toggle'

/** jsdom's URL is the component's only source for the search string (it reads
 *  window.location.search at click time), so each case primes it directly. */
const onUrl = (url: string) => window.history.replaceState(null, '', url)

beforeEach(() => {
  replace.mockReset()
  mockPathname = '/login'
  onUrl('/ja/login')
})

describe('the login language toggle carries the destination', () => {
  it('carries `?next=` through the replace, with `_rsc` dropped', () => {
    onUrl('/ja/login?next=%2Fja%2Fbusiness%2Ftoday&_rsc=x')
    render(<LocaleToggle />)
    fireEvent.click(screen.getByRole('button'))

    expect(replace).toHaveBeenCalledTimes(1)
    const [target] = replace.mock.calls[0]
    // Re-encoding by toString() is fine — it decodes identically downstream.
    expect(new URLSearchParams(target.split('?')[1]).get('next')).toBe(
      '/ja/business/today'
    )
    // Next's internal cache-buster is not a destination and never rides along.
    expect(target).not.toContain('_rsc')
    expect(target.split('?')[0]).toBe('/login')
  })

  it('replaces path-only when there is no query — no orphaned `?`', () => {
    onUrl('/ja/login')
    render(<LocaleToggle />)
    fireEvent.click(screen.getByRole('button'))

    expect(replace).toHaveBeenCalledWith('/login', { locale: 'en' })
  })

  it('a search whose ONLY param was `_rsc` also replaces path-only', () => {
    onUrl('/ja/login?_rsc=x')
    render(<LocaleToggle />)
    fireEvent.click(screen.getByRole('button'))

    expect(replace).toHaveBeenCalledWith('/login', { locale: 'en' })
  })

  it('still TOGGLES — the locale option survives the carry (ja -> en)', () => {
    onUrl('/ja/login?next=%2Fja%2Fkarute')
    render(<LocaleToggle />)
    fireEvent.click(screen.getByRole('button'))

    expect(replace.mock.calls[0][1]).toEqual({ locale: 'en' })
  })

  /** GREPTILE #754 P1 lives downstream in safe-next.ts: a repeated key reaches
   *  the page as an array and the GATE refuses it. The toggle's job is only to
   *  hand the shape over unchanged — collapsing it here would hide the very
   *  case the gate is built to catch. */
  it('passes a repeated `?next=` through intact — the gate downstream owns that shape', () => {
    onUrl('/ja/login?next=%2Fja%2Fa&next=%2Fja%2Fb')
    render(<LocaleToggle />)
    fireEvent.click(screen.getByRole('button'))

    const [target] = replace.mock.calls[0]
    expect(new URLSearchParams(target.split('?')[1]).getAll('next')).toEqual([
      '/ja/a',
      '/ja/b',
    ])
  })
})
