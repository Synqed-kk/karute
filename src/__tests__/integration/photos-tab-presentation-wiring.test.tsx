/**
 * @jest-environment jsdom
 *
 * PhotosTabContent — presentation-mode wiring (8/1 fresh-eyes round).
 *
 * Contracts under test:
 *  - INTERLOCK: opening お客様に見せる closes compare — compare renders
 *    staff-internal captions and must never sit in the DOM (or the
 *    accessibility tree) behind the customer-safe overlay.
 *  - PERSISTENCE: if a refresh empties `photos` while the overlay is open
 *    (external deletion), the overlay stays mounted showing its own empty
 *    state — it must never be silently swapped for staff UI in a
 *    customer's hands.
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

const pair: CustomerPhoto[] = [
  { id: 'a', signedUrl: 'https://example.com/a.jpg', category: 'before', caption: 'staff caption A' },
  { id: 'b', signedUrl: 'https://example.com/b.jpg', category: 'after', caption: 'staff caption B' },
]

describe('PhotosTabContent presentation wiring', () => {
  it('opening presentation closes compare and inert-isolates the staff DOM behind it', () => {
    const { container } = render(<PhotosTabContent customerId="c-1" photos={pair} />)
    fireEvent.click(screen.getByRole('button', { name: '比較' }))
    expect(screen.getByText('写真をタップすると選び直せます')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'お客様に見せる' }))
    // Interlock: the compare picker is unmounted, not just covered.
    expect(screen.queryByText('写真をタップすると選び直せます')).toBeNull()
    // The overlay is up (portal to document.body). The ✕ is press-and-hold
    // now (redesign), so its aria-label carries the hint.
    expect(screen.getByLabelText('閉じる（長押し）')).toBeInTheDocument()
    // Base UI modal marks everything outside the portal inert — the staff
    // DOM (grid captions, tab chrome) is out of the accessibility tree and
    // unreachable by focus while the customer holds the device.
    expect(container).toHaveAttribute('data-base-ui-inert')
    // No caption text inside the overlay's own subtree.
    const popup = document.querySelector('[data-slot], .fixed.inset-0')
    expect(popup?.textContent).not.toContain('staff caption')
  })

  it('overlay survives the photos prop emptying while open', () => {
    const { rerender } = render(<PhotosTabContent customerId="c-1" photos={pair} />)
    fireEvent.click(screen.getByRole('button', { name: 'お客様に見せる' }))
    expect(screen.getByLabelText('閉じる（長押し）')).toBeInTheDocument()

    rerender(<PhotosTabContent customerId="c-1" photos={[]} />)
    // Still fullscreen in the customer's hands — its own empty state (the
    // staff empty-state card may also render the same copy behind it, so
    // assert presence via getAllByText, and the overlay via its X).
    expect(screen.getByLabelText('閉じる（長押し）')).toBeInTheDocument()
    expect(screen.getAllByText('写真はまだありません').length).toBeGreaterThan(0)

    // The ✕ is press-and-hold (redesign) — closing here via its keyboard
    // escape hatch (Enter closes instantly, no hold) rather than re-testing
    // the hold timing, which photo-presentation-overlay.test.tsx already
    // covers.
    fireEvent.keyDown(screen.getByLabelText('閉じる（長押し）'), { key: 'Enter' })
    expect(screen.queryByLabelText('閉じる（長押し）')).toBeNull()
  })
})
