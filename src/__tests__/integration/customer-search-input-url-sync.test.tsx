/**
 * @jest-environment jsdom
 *
 * CustomerSearchInput URL-sync contract (Greptile r1 fix B): the box must
 * tell apart its OWN debounced router.replace echoing back through
 * initialQuery from an EXTERNAL navigation (back/forward, deep link) that
 * changed the URL out from under it. The mount test
 * (thin-customers-screen-mount.test.tsx) mocks this component out entirely,
 * so it can't exercise the real echo-vs-external distinction — this file
 * renders the real component with next/navigation mocked directly and
 * use-debounce left real (fake timers drive the 250ms debounce).
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_, v: string) => String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`))
    },
  }
})

const replace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/customers',
  useSearchParams: () => new URLSearchParams(''),
}))

import { CustomerSearchInput } from '@/components/customers/redesign/list/CustomerSearchInput'

describe('CustomerSearchInput — URL-sync (echo vs external navigation)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    replace.mockClear()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('T-echo: own debounced replace echoing back through initialQuery keeps local value and focus', () => {
    const { rerender } = render(<CustomerSearchInput initialQuery="" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    input.focus()

    fireEvent.change(input, { target: { value: 'ab' } })
    jest.advanceTimersByTime(300)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain('query=ab')

    rerender(<CustomerSearchInput initialQuery="ab" />)

    expect(input.value).toBe('ab')
    expect(document.activeElement).toBe(input)
  })

  it('T-external: initialQuery changing without local typing re-seeds the box', () => {
    const { rerender } = render(<CustomerSearchInput initialQuery="abc" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('abc')

    rerender(<CustomerSearchInput initialQuery="xyz" />)

    expect(input.value).toBe('xyz')
  })

  it('T-clear: clearing the box deletes query= from the URL and settles on empty', () => {
    const { rerender } = render(<CustomerSearchInput initialQuery="" />)
    const input = screen.getByRole('textbox') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'ab' } })
    jest.advanceTimersByTime(300)
    rerender(<CustomerSearchInput initialQuery="ab" />)

    fireEvent.change(input, { target: { value: '' } })
    jest.advanceTimersByTime(300)

    expect(replace).toHaveBeenCalledTimes(2)
    expect(replace.mock.calls[1][0]).not.toContain('query=')

    rerender(<CustomerSearchInput initialQuery="" />)

    expect(input.value).toBe('')
  })

  it('T-race: a pending debounced write must not fire after external navigation restores a different URL', () => {
    const { rerender } = render(<CustomerSearchInput initialQuery="" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    input.focus()

    fireEvent.change(input, { target: { value: 'ab' } })
    jest.advanceTimersByTime(100)

    rerender(<CustomerSearchInput initialQuery="xyz" />)
    jest.advanceTimersByTime(300)

    expect(replace).not.toHaveBeenCalled()
    expect(input.value).toBe('xyz')
  })

  it('T-race2: popstate back-nav to a URL equal to lastWritten while a newer write is pending must cancel the pending write (prop-keyed effect alone cannot see this — same value never re-runs it)', () => {
    const { rerender } = render(<CustomerSearchInput initialQuery="" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    input.focus()

    fireEvent.change(input, { target: { value: 'ab' } })
    jest.advanceTimersByTime(300)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain('query=ab')

    rerender(<CustomerSearchInput initialQuery="ab" />)
    expect(input.value).toBe('ab')
    expect(replace).toHaveBeenCalledTimes(1)

    fireEvent.change(input, { target: { value: 'abc' } })
    jest.advanceTimersByTime(100)

    // Real back/forward: the browser fires popstate at the same moment the
    // URL lands back on ?query=ab — initialQuery ("ab") equals lastWritten
    // ("ab"), so the prop-keyed effect above never re-runs and can't see
    // this. The popstate effect is the only thing that cancels the pending
    // "abc" write here.
    window.history.pushState({}, '', '/customers?query=ab')
    window.dispatchEvent(new PopStateEvent('popstate'))
    rerender(<CustomerSearchInput initialQuery="ab" />)
    jest.advanceTimersByTime(300)

    expect(replace).toHaveBeenCalledTimes(1)
    // Box text staying "abc" here (list/URL show "ab") is accepted cosmetic
    // residue of this fix — out of scope; only the write race is closed.
  })
})
