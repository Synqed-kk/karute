/**
 * @jest-environment jsdom
 *
 * Render coverage for VisitHistoryChain (PR 19, replay/19): the attended/missed
 * dot rendering (one span per chain entry, filled style for attended), the
 * filledCount / chain.length summary, and the sr-only aria interpolation
 * (window = chain length, attended = filled, total = lifetime visitCount).
 *
 * next-intl is mocked so the aria translation key + vars render verbatim.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

import { VisitHistoryChain } from '@/components/customers/redesign/VisitHistoryChain'

function dots(container: HTMLElement) {
  return Array.from(container.querySelectorAll('span[aria-hidden]'))
}

describe('VisitHistoryChain', () => {
  it('renders one dot per chain entry', () => {
    const { container } = render(
      <VisitHistoryChain chain={[true, false, true, true]} visitCount={12} />,
    )
    expect(dots(container)).toHaveLength(4)
  })

  it('styles attended dots green and missed dots as empty', () => {
    const { container } = render(
      <VisitHistoryChain chain={[true, false]} visitCount={2} />,
    )
    const [attended, missed] = dots(container)
    expect(attended.className).toContain('bg-green-500')
    expect(missed.className).not.toContain('bg-green-500')
    expect(missed.className).toContain('bg-neutral-200')
  })

  it('shows the filled/total summary (attended over window length)', () => {
    render(
      <VisitHistoryChain chain={[true, true, false, true]} visitCount={9} />,
    )
    expect(screen.getByText('3/4')).toBeInTheDocument()
  })

  it('reports 0/N when no visits were attended', () => {
    render(<VisitHistoryChain chain={[false, false, false]} visitCount={0} />)
    expect(screen.getByText('0/3')).toBeInTheDocument()
  })

  it('interpolates the aria label with window, attended and lifetime total', () => {
    render(
      <VisitHistoryChain chain={[true, false, true]} visitCount={42} />,
    )
    expect(
      screen.getByText('aria:{"window":3,"attended":2,"total":42}'),
    ).toBeInTheDocument()
  })

  it('renders no dots for an empty chain but still shows 0/0', () => {
    const { container } = render(
      <VisitHistoryChain chain={[]} visitCount={0} />,
    )
    expect(dots(container)).toHaveLength(0)
    expect(screen.getByText('0/0')).toBeInTheDocument()
  })
})
