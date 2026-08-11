/**
 * @jest-environment jsdom
 *
 * Customers-list thin screen wired mount (packet 26 + fix round): pins that
 * dto.burnByCustomer/burnUnpricedIds reach CustomerListStatsStrip through the
 * REAL CustomersScreen → CustomersListView chain (mocked apiFetch only), so a
 * future prop-wiring regression fails a render, not just a type check.
 * Real ja.json messages (throw-on-missing-key, same pattern as
 * thin-dashboard-screen-render.test.tsx) so the assertion is the actual
 * rendered 今月消化 string, not a raw i18n key.
 */
import { render, screen } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'

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
// Same stub as customers-list-view.test.tsx — CustomersListView reads
// useSearchParams from next/navigation and usePathname/useRouter from
// @/i18n/navigation; the shell's real nav port isn't needed for this smoke.
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/customers',
  Link: ({ children }: { children: unknown }) => children,
}))
// Isolate the strip: heavy leaves stubbed exactly like customers-list-view.test.tsx.
jest.mock('@/components/customers/redesign/list/CustomersListHeader', () => ({
  CustomersListHeader: () => <div data-testid="header" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerSearchInput', () => ({
  CustomerSearchInput: () => <div data-testid="search" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerRowDesktop', () => ({
  CustomerRowDesktop: () => <div data-testid="row-desktop" />,
}))
jest.mock('@/components/customers/redesign/list/CustomerCardMobile', () => ({
  CustomerCardMobile: () => <div data-testid="row-mobile" />,
}))

import { CustomersScreen } from '../../../thin/screens/CustomersScreen'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'

const dto = {
  rows: [
    {
      id: 'c1',
      name: 'テスト 花子',
      initials: 'TH',
      karuteNumber: '#00001',
      age: null,
      gender: null,
      joinDate: '2026-01-01',
      joinDateIso: '2026-01-01T00:00:00Z',
      lastVisitDate: '2026-07-01',
      lastVisitAgo: '3週間前',
      aiPredict: { label: '', when: '' },
      status: 'on-track',
      preferredStaffId: null,
      preferredStaffName: null,
      totalKarute: 3,
      phone: null,
      pack: { remaining: 5, size: 10, unconsumed: 20000 },
    },
  ],
  totalRegistered: 1,
  selfStaffId: null,
  bookingDataAvailable: true,
  staffList: [],
  burnByCustomer: { c1: { mtd: 15000, prev: 10000 } },
  burnUnpricedIds: [] as string[],
}

// Second row (c2) has an in-window redemption core couldn't price (orphaned
// pack) — c2's id rides in burnUnpricedIds. Both rows are in view (2 < the
// 12-per-page cap, no filters active), so the strip's burnUnpriceable gate
// must hide the stat exactly like CustomersListView:275/CustomerListStatsStrip
// do on web with the same inputs.
const dtoWithUnpriced = {
  ...dto,
  rows: [
    ...dto.rows,
    {
      ...dto.rows[0],
      id: 'c2',
      name: 'テスト 次郎',
      pack: null,
    },
  ],
  burnUnpricedIds: ['c2'],
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

describe('CustomersScreen — wired mount (packet 26)', () => {
  beforeEach(() => dtoCache.clear())

  it('threads dto.burnByCustomer through CustomersListView to the 今月消化 strip stat', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path === '/api/app/v1/screens/customers?locale=ja') return jsonResponse(dto)
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<CustomersScreen />)

    expect(await screen.findByText('今月消化')).toBeInTheDocument()
    expect(screen.getByText('¥15,000')).toBeInTheDocument()
  })

  it('hides 今月消化 when an unpriced customer is IN VIEW (honesty-gate parity, packet 26 fix)', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path === '/api/app/v1/screens/customers?locale=ja') return jsonResponse(dtoWithUnpriced)
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<CustomersScreen />)

    // Wait for the real content frame (header stub) before asserting absence,
    // so this isn't just catching the loading state.
    await screen.findByTestId('header')
    expect(screen.queryByText('今月消化')).not.toBeInTheDocument()
  })
})
