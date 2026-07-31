/**
 * @jest-environment jsdom
 *
 * Render coverage for the design-parity P-B-1 'use client' flip
 * (DashboardPageView / AttentionCards / ActionCards / TomorrowStrip — leaf
 * presentational components moved off next-intl/server's getTranslations
 * onto next-intl's useTranslations). Real ja.json strings, same mock pattern
 * as reconcile-strip.test.tsx / PR #558's bottom-nav.test.tsx (CI's node 20
 * jest can't parse next-intl's production ESM react-client entry
 * untransformed).
 */
import { render, screen } from '@testing-library/react'

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
jest.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))
// DashboardPageView's other children are heavier (hooks, actions, their own
// data shapes) and unrelated to the flip being pinned here — stub them out
// so this stays a smoke test of DashboardPageView's own composition/chip
// logic, not a full page test.
jest.mock('@/components/dashboard/redesign/OnboardingBanner', () => ({
  OnboardingBanner: () => null,
}))
jest.mock('@/components/dashboard/redesign/NextCustomerHero', () => ({
  NextCustomerHero: () => null,
}))
jest.mock('@/components/dashboard/redesign/TodoCard', () => ({
  TodoCard: () => null,
}))
jest.mock('@/components/dashboard/redesign/OwnerBand', () => ({
  OwnerBand: () => null,
}))

import { DashboardPageView } from '@/components/dashboard/redesign/DashboardPageView'
import { AttentionCards, type AttentionCardView } from '@/components/dashboard/redesign/AttentionCards'
import { ActionCards } from '@/components/dashboard/redesign/ActionCards'
import { TomorrowStrip } from '@/components/dashboard/redesign/TomorrowStrip'

describe('DashboardPageView (client flip)', () => {
  const baseProps = {
    dateLabel: '7/3(金)',
    onboardingComplete: true,
    heroSlides: [],
    heroTomorrow: null,
    doneCount: 0,
    karuteTodos: [],
    redeemTodos: [],
    attentionItems: [],
    totalToday: 0,
    renewals: [],
    rebooks: [],
    winbacks: [],
    tomorrow: null,
    packAlerts: {
      contact: [],
      low: [],
      inProgress: [],
      totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
      monthly: { contacted: 0, rebooked: 0 },
    },
    reconcile: { entries: [], truncated: 0 },
    canDismissAlerts: false,
    pulse: { redemptions: 0, karute: 0 },
  }

  it('shows the owner chip when isOwner is true', () => {
    render(<DashboardPageView {...baseProps} isOwner />)
    expect(screen.getByText('オーナー')).toBeInTheDocument()
  })

  it('hides the owner chip when isOwner is false', () => {
    render(<DashboardPageView {...baseProps} isOwner={false} />)
    expect(screen.queryByText('オーナー')).not.toBeInTheDocument()
  })
})

describe('AttentionCards (client flip)', () => {
  const item = (over: Partial<AttentionCardView> = {}): AttentionCardView => ({
    clientId: 'c1',
    timeHm: '10:00',
    name: '田中',
    badge: 'first',
    line: '初回のご案内を',
    ...over,
  })

  it('renders NOTHING when empty', () => {
    const { container } = render(<AttentionCards items={[]} totalToday={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a card with the badge label and count', () => {
    render(<AttentionCards items={[item()]} totalToday={4} />)
    expect(screen.getByText('本日の要注目')).toBeInTheDocument()
    expect(screen.getByText('1名 / 4件')).toBeInTheDocument()
    expect(screen.getByText('初回')).toBeInTheDocument()
    expect(screen.getByText('初回のご案内を')).toBeInTheDocument()
  })

  it('comeback badge interpolates the day count', () => {
    render(<AttentionCards items={[item({ badge: 'comeback', badgeDays: 45 })]} totalToday={1} />)
    expect(screen.getByText('45日ぶり')).toBeInTheDocument()
  })
})

describe('ActionCards (client flip)', () => {
  it('renders NOTHING when all three lists are empty', () => {
    const { container } = render(<ActionCards renewals={[]} rebooks={[]} winbacks={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a renewal card with the cycle line', () => {
    render(
      <ActionCards
        renewals={[{ clientId: 'c1', name: '田中', timeHm: '10:00', cycle: 30 }]}
        rebooks={[]}
        winbacks={[]}
      />,
    )
    expect(screen.getByText('田中様 — 残り1回')).toBeInTheDocument()
    expect(screen.getByText(/平均30日サイクル/)).toBeInTheDocument()
  })

  it('renders rebook + winback rows', () => {
    render(
      <ActionCards
        renewals={[]}
        rebooks={[{ clientId: 'c1', name: '田中', remaining: 2, dueLabel: '7/1' }]}
        winbacks={[{ clientId: 'c2', name: '佐藤', remaining: 1, days: 90 }]}
      />,
    )
    expect(screen.getByText('リブック提案 — 次回予約のない1名')).toBeInTheDocument()
    expect(screen.getByText('田中様(残2) → 7/1頃')).toBeInTheDocument()
    expect(screen.getByText('お久しぶりのお客様 — 声かけ候補1名')).toBeInTheDocument()
    expect(screen.getByText('佐藤様(残1・90日)')).toBeInTheDocument()
  })
})

describe('TomorrowStrip (client flip)', () => {
  it('renders NOTHING when there is no data', () => {
    const { container } = render(<TomorrowStrip data={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders NOTHING when count is 0', () => {
    const { container } = render(
      <TomorrowStrip
        data={{ dateLabel: '7/3(金)', ymd: '2026-07-03', count: 0, firstTimers: 0, firstTimeHm: '09:00', firstName: '' }}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the summary line', () => {
    render(
      <TomorrowStrip
        data={{ dateLabel: '7/3(金)', ymd: '2026-07-03', count: 5, firstTimers: 2, firstTimeHm: '09:00', firstName: '田中' }}
      />,
    )
    expect(screen.getByText('明日 7/3(金)')).toBeInTheDocument()
    expect(screen.getByText('5名 · 初回2名 · 最初は 09:00 田中様')).toBeInTheDocument()
  })
})
