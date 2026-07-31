/**
 * @jest-environment jsdom
 *
 * Nav-port object-href regression (packet-09 F-7 cause 2): Next's Link/router
 * accept `{pathname, query}` objects — CustomerIdentityCard's mic button
 * passes one. The port used to push the object raw, which the History API
 * stringified to "[object Object]"; the profile route regex then ate it as a
 * customer id and the screen dead-ended on a lookup error with no way back.
 * Pins: toHref normalization, Link's rendered href, and the pushed URL.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { Link, toHref, useRouter } from '../../../thin/ports/nav.vite'

describe('thin nav port — object hrefs (F-7 cause 2)', () => {
  afterEach(() => {
    history.replaceState({}, '', '/')
  })

  it('toHref passes strings through and serializes {pathname, query}', () => {
    expect(toHref('/karute/abc')).toBe('/karute/abc')
    expect(toHref({ pathname: '/sessions' })).toBe('/sessions')
    expect(toHref({ pathname: '/sessions', query: { customerId: 'c-1' } })).toBe(
      '/sessions?customerId=c-1',
    )
    // nullish query values are dropped, like Next's own serializer
    expect(
      toHref({ pathname: '/sessions', query: { a: 'x', b: undefined, c: null } }),
    ).toBe('/sessions?a=x')
  })

  it('Link with an object href renders a real URL and pushes it on click', () => {
    render(
      <Link href={{ pathname: '/sessions', query: { customerId: 'c-1' } }}>
        録音
      </Link>,
    )
    const a = screen.getByRole('link', { name: '録音' })
    expect(a.getAttribute('href')).toBe('/sessions?customerId=c-1')

    fireEvent.click(a)
    expect(location.pathname).toBe('/sessions')
    expect(location.search).toBe('?customerId=c-1')
    // the F-7 failure mode, pinned dead
    expect(location.pathname).not.toContain('object')
  })
})

describe('thin nav port — locale-prefix strip (F4, single-locale shell)', () => {
  afterEach(() => {
    history.replaceState({}, '', '/')
  })

  it('toHref strips a leading /ja or /en segment', () => {
    expect(toHref('/ja/login')).toBe('/login')
    expect(toHref('/en/karute/abc')).toBe('/karute/abc')
    expect(toHref('/ja')).toBe('/') // bare locale root → home, not ''
  })

  it('unprefixed paths pass through untouched', () => {
    expect(toHref('/karute/abc')).toBe('/karute/abc')
    expect(toHref('/')).toBe('/')
  })

  it('does NOT strip a path that merely starts with "ja"/"en" (segment boundary)', () => {
    expect(toHref('/jazz')).toBe('/jazz')
    expect(toHref('/english-menu')).toBe('/english-menu')
  })

  it('strips the prefix on {pathname, query} object hrefs too', () => {
    expect(toHref({ pathname: '/ja/karute/abc', query: { x: '1' } })).toBe(
      '/karute/abc?x=1',
    )
  })

  it('push("/ja/login") lands on the unprefixed pathname (dead-route regression)', () => {
    useRouter().push('/ja/login')
    expect(location.pathname).toBe('/login')
  })
})
