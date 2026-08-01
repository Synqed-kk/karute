/**
 * @jest-environment jsdom
 *
 * PhotosTabContent — compare-mode wiring (the parent no test rendered before).
 *
 * Contracts under test:
 *  - 比較 button is disabled until 2 photos are displayable, enabled at 2.
 *  - Opening compare swaps the grid for the picker; exiting restores it.
 *  - The exit path NEVER locks: if a refresh drops displayable photos below
 *    2 while compare is open, the button stays tappable and still exits.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
  }
})
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/customers', () => ({ uploadCustomerPhoto: jest.fn() }))

import '@testing-library/jest-dom'
import {
  PhotosTabContent,
  type CustomerPhoto,
} from '@/components/customers/redesign/profile/PhotosTabContent'

function photo(id: string, category: string, url = true): CustomerPhoto {
  return {
    id,
    signedUrl: url ? `https://example.com/${id}.jpg` : null,
    category,
    caption: null,
  }
}

describe('PhotosTabContent compare wiring', () => {
  it('比較 is disabled below 2 displayable photos, enabled at 2', () => {
    const { rerender } = render(
      <PhotosTabContent customerId="c-1" photos={[photo('a', 'before'), photo('b', 'after', false)]} />,
    )
    expect(screen.getByRole('button', { name: /比較/ })).toBeDisabled()

    rerender(
      <PhotosTabContent customerId="c-1" photos={[photo('a', 'before'), photo('b', 'after')]} />,
    )
    expect(screen.getByRole('button', { name: /比較/ })).toBeEnabled()
  })

  it('opening compare swaps the grid for the picker; exit restores it', () => {
    render(
      <PhotosTabContent customerId="c-1" photos={[photo('a', 'before'), photo('b', 'after')]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '比較' }))
    expect(screen.getByText('写真をタップすると選び直せます')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '比較を終了' }))
    expect(screen.queryByText('写真をタップすると選び直せます')).toBeNull()
  })

  it('exit stays tappable when a refresh drops displayable photos below 2', () => {
    const { rerender } = render(
      <PhotosTabContent customerId="c-1" photos={[photo('a', 'before'), photo('b', 'after')]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '比較' }))

    rerender(<PhotosTabContent customerId="c-1" photos={[photo('a', 'before')]} />)
    const exit = screen.getByRole('button', { name: '比較を終了' })
    expect(exit).toBeEnabled()
    fireEvent.click(exit)
    expect(screen.queryByRole('button', { name: '比較を終了' })).toBeNull()
  })
})
