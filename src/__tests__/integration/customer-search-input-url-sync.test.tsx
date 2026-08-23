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
})
