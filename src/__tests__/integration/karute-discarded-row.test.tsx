/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

jest.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: unknown }) => (
    <a href={typeof href === 'string' ? href : undefined}>{children}</a>
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

  it('keeps an ordinary record navigable', () => {
    const { container } = render(<KaruteListRow item={item} />)
    expect(container.querySelector('a')).toHaveAttribute('href', item.href)
  })
})
