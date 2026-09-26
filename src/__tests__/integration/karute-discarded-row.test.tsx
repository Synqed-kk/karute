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
  companyFirstVisit: null,
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

// D10 (PR-C, WHO-SEES): the 共有 chip — both slots (mobile + desktop both
// render in jsdom, CSS-hidden only), gated by viewerHoldsViewShared OR the
// row's own recorder.
describe('the 共有 row chip (D10, WHO-SEES)', () => {
  const sharedItem: KaruteListItem = { ...item, isShared: true }

  it('is absent when the row is not shared at all, regardless of viewer', () => {
    render(<KaruteListRow item={item} viewerHoldsViewShared currentStaffId="staff-1" />)
    expect(screen.queryAllByText('filters.shared')).toHaveLength(0)
  })

  it('shows in BOTH chip slots for a viewShared holder, on a colleague\'s shared row', () => {
    render(<KaruteListRow item={sharedItem} viewerHoldsViewShared currentStaffId="someone-else" />)
    // One in the mobile slot, one in the desktop slot — both render in jsdom.
    expect(screen.getAllByText('filters.shared')).toHaveLength(2)
  })

  it('shows for the recorder on her OWN shared row, even without viewShared', () => {
    render(
      <KaruteListRow item={sharedItem} viewerHoldsViewShared={false} currentStaffId="staff-1" />,
    )
    expect(screen.getAllByText('filters.shared')).toHaveLength(2)
  })

  it('is HIDDEN for a practitioner on a COLLEAGUE\'s shared row (no viewShared, not her own) — the WHO-SEES gate (M6)', () => {
    render(
      <KaruteListRow
        item={sharedItem}
        viewerHoldsViewShared={false}
        currentStaffId="someone-else"
      />,
    )
    expect(screen.queryAllByText('filters.shared')).toHaveLength(0)
  })

  it('is hidden with no viewer props at all (the defaults: viewerHoldsViewShared=false, currentStaffId=null)', () => {
    render(<KaruteListRow item={sharedItem} />)
    expect(screen.queryAllByText('filters.shared')).toHaveLength(0)
  })

  it('soft wash tier — no black/solid fill (⚖ no-black-interactive)', () => {
    const { container } = render(
      <KaruteListRow item={sharedItem} viewerHoldsViewShared currentStaffId="staff-1" />,
    )
    // The text sits in its own inner <span>; the chip's classes live on its
    // parent (the outer <span> SharedChip returns).
    const chip = screen.getAllByText('filters.shared')[0].parentElement!
    expect(chip.className).toContain('bg-sky-50')
    expect(chip.className).not.toMatch(/(^|\s)bg-(black|foreground)(\s|$)/)
  })
})
