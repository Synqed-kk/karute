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
import { Link, toHref } from '../../../thin/ports/nav.vite'

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
