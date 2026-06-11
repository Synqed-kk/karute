/**
 * @jest-environment jsdom
 *
 * 案A "rails" card — MOCK-FIDELITY lock (Liam-approved design, PR #240).
 * Renders the REAL CustomerCardMobile with the REAL ja.json strings (a missing
 * i18n key throws, so key drift fails the suite) using the exact four
 * customers from the approved mock. Locks:
 *   - the structural no-wrap guarantee (zero flex-wrap anywhere in the card)
 *   - every token's presence + the designated truncators
 *   - exceptions-only chip, amber action states, the right-edge rails
 *   - the three L2 states (dated / count-without-date / zero history)
 */
import { render, within } from '@testing-library/react'
import type { CustomerListRow, CustomerStatusKey } from '@/components/customers/redesign/types'

jest.mock('next-intl', () => {
  const ja = require('../../../messages/ja.json')
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

jest.mock('@/i18n/navigation', () => {
  const React = require('react')
  return {
    Link: ({ href, children, className }: { href: unknown; children: React.ReactNode; className?: string }) =>
      React.createElement('a', { href: String(href), className }, children),
  }
})

import { CustomerCardMobile } from '@/components/customers/redesign/list/CustomerCardMobile'

function row(over: Partial<CustomerListRow> = {}): CustomerListRow {
  const status: CustomerStatusKey = over.status ?? 'on-track'
  return {
    id: 'c-1',
    name: 'Customer',
    initials: 'CU',
    karuteNumber: '#00001',
    age: null,
    gender: null,
    joinDate: '2026年6月1日',
    joinDateIso: '2026-06-01T00:00:00Z',
    lastVisitDate: '—',
    lastVisitAgo: '来店履歴なし',
    aiPredict: { label: '', when: '—' },
    status,
    preferredStaffId: null,
    preferredStaffName: null,
    totalKarute: 0,
    phone: null,
    ...over,
  }
}

const renderCard = (c: CustomerListRow) =>
  render(<CustomerCardMobile c={c} staffColorKey={null} />)

describe('案A rails card — mock fidelity', () => {
  it('NO flex-wrap anywhere — the structural no-orphan guarantee', () => {
    const { container } = renderCard(
      row({
        name: '久保田 ゆき',
        lastVisitDate: '2026年6月8日',
        lastVisitAgo: '2日前',
        lastVisitService: '10回券',
        totalKarute: 19,
        pack: { remaining: 3, size: 10, unconsumed: 29700 },
        nextBookingDate: '6/15',
        preferredStaffName: '原田 かなみ',
        preferredStaffId: 's-1',
        phone: '09012345678',
      }),
    )
    expect(container.querySelector('[class*="flex-wrap"]')).toBeNull()
  })

  it('久保田 (on-track pack regular): every token, no chip, rails pinned right', () => {
    const { container } = renderCard(
      row({
        name: '久保田 ゆき',
        karuteNumber: '#00111',
        lastVisitDate: '2026年6月8日',
        lastVisitAgo: '2日前',
        lastVisitService: '10回券',
        totalKarute: 19,
        pack: { remaining: 3, size: 10, unconsumed: 29700 },
        nextBookingDate: '6/15',
        preferredStaffName: '原田 かなみ',
        preferredStaffId: 's-1',
        phone: '09012345678',
      }),
    )
    const card = within(container)
    // L1 — exceptions-only: 継続中 (on-track) renders NO chip.
    expect(card.queryByText('継続中')).toBeNull()
    expect(card.getByText('久保田 ゆき')).toBeInTheDocument()
    expect(card.getByText('#00111')).toBeInTheDocument()
    // L2 (案1) — DAYS ONLY: bare 前回 prefix, no calendar date, course as the
    // sole truncator, bare ago token on the recency rail (no parens).
    expect(card.getByText('前回')).toBeInTheDocument()
    expect(card.queryByText(/6\/8/)).toBeNull()
    const course = card.getByText('10回券')
    expect(course.className).toContain('truncate')
    const ago = card.getByText('2日前')
    expect(ago.className).toContain('ml-auto')
    expect(ago.className).toContain('font-medium')
    expect(ago.className).not.toContain('amber')
    // L3 — pack rail with the REAL booking date (not a boolean).
    expect(card.getByText('残3/10')).toBeInTheDocument()
    expect(card.getByText('¥29,700')).toBeInTheDocument()
    const booking = card.getByText('予約 6/15')
    expect(booking.className).toContain('ml-auto')
    expect(booking.className).not.toContain('amber')
    // L4 — relationship line: 担当 truncator, count. ☎ digits CUT (案B —
    // the staff sheet never tracked phone; the 要連絡 button + profile keep it).
    expect(card.getByText('担当：原田 かなみ').className).toContain('truncate')
    expect(card.getByText('来店19回').className).toContain('shrink-0')
    expect(card.queryByText(/090-1234-5678/)).toBeNull()
    // 登録日 is 新規-only — absent on a regular.
    expect(card.queryByText(/登録/)).toBeNull()
    // No ・ separator strings anywhere (the orphan factory).
    expect(container.textContent).not.toContain(' · ')
  })

  it("松本 (the original wrap-case): course truncates, 来店1回 physically un-orphanable", () => {
    const { container } = renderCard(
      row({
        name: '松本日向',
        karuteNumber: '#00021',
        lastVisitDate: '2026年6月2日',
        lastVisitAgo: '8日前',
        lastVisitService: '新規コース ¥1,980',
        totalKarute: 1,
        preferredStaffName: '鈴木来留実',
        preferredStaffId: 's-2',
        phone: '09015514218',
      }),
    )
    const card = within(container)
    const course = card.getByText('新規コース ¥1,980')
    expect(course.className).toContain('truncate')
    expect(course.className).toContain('min-w-0')
    const count = card.getByText('来店1回')
    expect(count.className).toContain('shrink-0')
    expect(count.className).toContain('whitespace-nowrap')
    // No pack → pack tokens absent, but the booking rail renders for ALL
    // rows (案B): 予約なし amber — the sheet's #1 stat universalized.
    expect(card.queryByText(/残/)).toBeNull()
    expect(card.getByText('予約なし').className).toContain('amber')
  })

  it('籠嶋 (新規, zero history): blue chip, 来店履歴なし + compact 登録, no count line noise', () => {
    const { container } = renderCard(
      row({
        name: '籠嶋 知美',
        karuteNumber: '#00193',
        status: 'new',
        joinAgo: '2日前',
        totalKarute: 0,
        preferredStaffName: '原田 かなみ',
        preferredStaffId: 's-1',
      }),
    )
    const card = within(container)
    expect(card.getByText('新規')).toBeInTheDocument()
    expect(card.getByText('来店履歴なし')).toBeInTheDocument()
    expect(card.getByText('登録 2日前')).toBeInTheDocument()
    expect(card.queryByText(/来店0回/)).toBeNull()
    expect(card.queryByText(/前回/)).toBeNull()
  })

  it('橋 (要フォロー + 要連絡): amber recency, red pill, amber 予約なし, 44px call button', () => {
    const { container } = renderCard(
      row({
        name: '橋 加奈絵',
        karuteNumber: '#00112',
        status: 'needs-followup',
        lastVisitDate: '2026年3月17日',
        lastVisitAgo: '85日前',
        lastVisitService: '6回券',
        totalKarute: 7,
        pack: { remaining: 3, size: 6, unconsumed: 26400 },
        nextBookingDate: null,
        packAlert: 'contact',
        phone: '09026647278',
      }),
    )
    const card = within(container)
    expect(card.getByText('要フォロー')).toBeInTheDocument()
    expect(card.getByText('85日前').className).toContain('amber')
    expect(card.getByText('要連絡')).toBeInTheDocument()
    expect(card.getByText('予約なし').className).toContain('amber')
    const callBtn = container.querySelector('button[aria-label*="橋 加奈絵"]')
    expect(callBtn).not.toBeNull()
    expect(callBtn!.className).toContain('size-11')
  })

  it('卒業 renders a slate chip and NEVER fake-red dormant styling', () => {
    const { container } = renderCard(
      row({
        name: '小川拓也',
        status: 'graduated',
        lastVisitDate: '2025年11月3日',
        lastVisitAgo: '219日前',
        totalKarute: 4,
      }),
    )
    const card = within(container)
    const chip = card.getByText('卒業')
    expect(chip.className).toContain('slate')
    expect(chip.className).not.toContain('red')
    // recency token NOT amber for lifecycle states (not followup/dormant)
    expect(card.getByText('219日前').className).not.toContain('amber')
  })

  it('卒業 with no booking: 予約なし stays NEUTRAL (closed case, no action color)', () => {
    const { container } = renderCard(
      row({
        name: '小川拓也',
        status: 'graduated',
        lastVisitDate: '2025年11月3日',
        lastVisitAgo: '219日前',
        totalKarute: 4,
        nextBookingDate: null,
      }),
    )
    const rail = within(container).getByText('予約なし')
    expect(rail.className).not.toContain('amber')
    expect(rail.className).toContain('text-muted-foreground')
  })

  it('state b (count without date): 「最終来店日の記録なし」 — never the 来店履歴なし contradiction', () => {
    const { container } = renderCard(
      row({
        name: '矢島里美',
        lastVisitDate: '—',
        totalKarute: 4,
      }),
    )
    const card = within(container)
    expect(card.getByText('最終来店日の記録なし')).toBeInTheDocument()
    expect(card.queryByText('来店履歴なし')).toBeNull()
    // count still reachable on L4
    expect(card.getByText('来店4回')).toBeInTheDocument()
  })
})
