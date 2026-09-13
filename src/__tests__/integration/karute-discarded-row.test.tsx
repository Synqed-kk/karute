/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

jest.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode
    href?: unknown
    className?: string
  }) => (
    <a href={typeof href === 'string' ? href : undefined} className={className}>
      {children}
    </a>
  ),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { KaruteListRow } from '@/components/karute/spike-lifted/list/KaruteListRow'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'

const item: KaruteListItem = {
  id: 'karute-1',
  customerId: 'customer-1',
  customerName: '山田 花子',
  customerInitials: '山',
  customerKaruteNumber: '#00001',
  date: '2026-09-11',
  weekday: '金',
  service: 'カット',
  duration: 60,
  staffId: 'staff-1',
  staffColorKey: null,
  staffName: '佐藤 美咲',
  summary: 'discarded content must not appear',
  aiStatus: 'summarized',
  conversionStatus: 'active',
  href: '/karute/karute-1',
}

describe('discarded Karute row', () => {
  it('stays visible, gray, and non-actionable without leaking its summary', () => {
    const { container } = render(<KaruteListRow item={{ ...item, isDiscarded: true }} />)

    expect(screen.getByText('山田 花子')).toBeInTheDocument()
    expect(screen.getAllByText('filters.discarded').length).toBeGreaterThan(0)
    expect(screen.queryByText(item.summary)).not.toBeInTheDocument()
    expect(container.querySelector('a')).toBeNull()
    expect(container.firstElementChild).toHaveClass('opacity-70')
  })

  it('carries no aria-disabled — a non-interactive div takes no disabled state (R6 repair, 2026-09-13, F6)', () => {
    const { container } = render(<KaruteListRow item={{ ...item, isDiscarded: true }} />)
    expect(container.firstElementChild).not.toHaveAttribute('aria-disabled')
    expect(container.querySelector('[aria-disabled]')).toBeNull()
  })

  it('keeps an ordinary record navigable', () => {
    const { container } = render(<KaruteListRow item={item} />)
    expect(container.querySelector('a')).toHaveAttribute('href', item.href)
  })

  // R8 discarded-record door (⚖ Liam 2026-09-13, A8) — canOpen threading.
  it('canOpen=true on a discarded row becomes a Link, keeping the grey/「破棄済み」 look (opacity-70 stays; hover class added)', () => {
    const { container } = render(<KaruteListRow item={{ ...item, isDiscarded: true }} canOpen={true} />)
    const link = container.querySelector('a')
    expect(link).toHaveAttribute('href', item.href)
    expect(screen.getAllByText('filters.discarded').length).toBeGreaterThan(0)
    expect(screen.queryByText(item.summary)).not.toBeInTheDocument()
    expect(link).toHaveClass('opacity-70')
    expect(link).toHaveClass('hover:bg-muted/30')
  })

  it('canOpen=false on a discarded row stays the inert div (identical to the default)', () => {
    const { container } = render(<KaruteListRow item={{ ...item, isDiscarded: true }} canOpen={false} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.firstElementChild).toHaveClass('opacity-70')
  })

  it('an explicit canOpen always wins over `active` — the real caller only ever passes true for a live row (`!item.isDiscarded || …`), so this only matters for the discarded branch above', () => {
    const { container } = render(<KaruteListRow item={item} canOpen={false} />)
    expect(container.querySelector('a')).toBeNull()
  })
})
