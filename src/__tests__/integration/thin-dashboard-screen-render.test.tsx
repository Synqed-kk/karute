/**
 * @jest-environment jsdom
 *
 * DashboardScreenInner real-render prop-mapping smoke (fleet P3 finding):
 * the 20-field passthrough from DTO to DashboardPageView's props has zero
 * real-render coverage — TypeScript can't catch a swapped/typo'd prop slot
 * (e.g. dto.renewals landing in the rebooks prop), only a render can. Reuses
 * dashboard-cards-client-flip.test.tsx's mock pattern (next-intl + i18n
 * navigation real; OwnerBand/TodoCard stubbed — both drag in '@/actions/packs',
 * a 'use server' file that pulls next/cache internals TextEncoder-crashes in
 * this jest config, same reason PR 1's own client-flip suite stubs them).
 * NextCustomerHero + AttentionCards + ActionCards + TomorrowStrip all render
 * for REAL: a hero-slide name, the attentionItems/totalToday pair, and one
 * DISTINCT customer per renewals/rebooks/winbacks (each formats through its
 * own i18n key, so any pairwise swap among the three fails) all prove their
 * own DTO slot landed correctly.
 *
 * heroTomorrow vs tomorrow: NOT made distinguishable — NextCustomerHero only
 * renders its tomorrow-first branch when heroSlides is EMPTY, mutually
 * exclusive with this file's hero-slide-name check. A raw swap between the
 * two is also TS-caught anyway (TomorrowFirstView and TomorrowStripData are
 * structurally different shapes), so the risk this file exists to catch
 * (a same-shaped pair silently swapped) doesn't apply to that pair.
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
jest.mock('@/components/dashboard/redesign/OnboardingBanner', () => ({
  OnboardingBanner: () => null,
}))
jest.mock('@/components/dashboard/redesign/TodoCard', () => ({ TodoCard: () => null }))
jest.mock('@/components/dashboard/redesign/OwnerBand', () => ({ OwnerBand: () => null }))

import { DashboardScreenInner } from '../../../thin/screens/DashboardScreen'
import { DashboardScreenDTO } from '@/lib/app-api/dashboard-screen-dto'

const dto = DashboardScreenDTO.parse({
  dateLabel: '7/20(月)',
  isOwner: true,
  onboardingComplete: true,
  heroSlides: [
    {
      appointmentId: 'appt-1',
      clientId: 'c1',
      customerName: 'ホシノ サキ',
      startIso: '2026-07-20T02:00:00.000Z',
      timeHm: '11:00',
      durationMinutes: 60,
      inProgress: false,
      round: { kind: 'nth', n: 3 },
      course: 'カット',
      staffName: 'Mika Tanaka',
      ticket: { remaining: 2, size: 10 },
      requestNote: null,
      lastVisit: null,
    },
  ],
  heroTomorrow: null,
  doneCount: 0,
  karuteTodos: [],
  redeemTodos: [],
  attentionItems: [
    { clientId: 'c1', timeHm: '11:00', name: 'ホシノ サキ', badge: 'first', line: '初回のご案内を' },
  ],
  totalToday: 4,
  renewals: [{ clientId: 'r1', name: 'レナ', timeHm: '09:00', cycle: 21 }],
  rebooks: [{ clientId: 'r2', name: 'リブ', remaining: 5, dueLabel: '8/1' }],
  winbacks: [{ clientId: 'r3', name: 'ウィン', remaining: 1, days: 60 }],
  tomorrow: {
    dateLabel: '7/21(火)',
    ymd: '2026-07-21',
    count: 3,
    firstTimers: 1,
    firstTimeHm: '10:00',
    firstName: 'アシタ',
  },
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
  ticketsEnabled: true,
})

describe('DashboardScreenInner (real-render prop-mapping smoke)', () => {
  it('threads dateLabel + the owner chip through to DashboardPageView', () => {
    render(<DashboardScreenInner dto={dto} />)
    expect(screen.getByText('7/20(月)')).toBeInTheDocument()
    expect(screen.getByText('オーナー')).toBeInTheDocument()
  })

  it('threads heroSlides through to NextCustomerHero (a real slide name lands)', () => {
    render(<DashboardScreenInner dto={dto} />)
    expect(screen.getByText('ホシノ サキ')).toBeInTheDocument()
  })

  it('threads attentionItems + totalToday through to AttentionCards (not swapped for each other)', () => {
    render(<DashboardScreenInner dto={dto} />)
    // 1名 (attentionItems.length) / 4件 (totalToday) — a swap of the two
    // props would flip this string.
    expect(screen.getByText('1名 / 4件')).toBeInTheDocument()
  })

  it('threads renewals/rebooks/winbacks through to ActionCards without cross-swapping', () => {
    render(<DashboardScreenInner dto={dto} />)
    // Each list formats through its OWN i18n key with its OWN distinct
    // customer — a renewals↔rebooks↔winbacks swap (any pairing) fails one
    // of these three, since a swapped list would render the wrong name in
    // the wrong format string.
    expect(screen.getByText('レナ様 — 残り1回')).toBeInTheDocument()
    expect(screen.getByText(/リブ様\(残5\) → 8\/1頃/)).toBeInTheDocument()
    expect(screen.getByText(/ウィン様\(残1・60日\)/)).toBeInTheDocument()
  })

  it('threads tomorrow through to TomorrowStrip', () => {
    render(<DashboardScreenInner dto={dto} />)
    expect(screen.getByText('明日 7/21(火)')).toBeInTheDocument()
    expect(screen.getByText('3名 · 初回1名 · 最初は 10:00 アシタ様')).toBeInTheDocument()
  })
})
