/**
 * @jest-environment jsdom
 *
 * ⚖ §v11 V11-6 P3 (the board fix, PR-A) — the FIRST mounted geometry pin: 今日の運営 rendered for
 * テスト恵比寿ジム through the rendered-test door, every booking card's placement read off the DOM. The board
 * used to draw the shared 10–19 window over the gym's own 07–22 day, and its cards landed at x 0% / w 0%
 * and x 116.67% (DIAGNOSIS A1 · B1). The recorded world of practice-door-on.test.ts, read through a whole mock.
 */

jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
// A whole mock, never requireActual: the real module loads the SDK chain, which jsdom cannot host.
jest.mock('@/business/lib/practice-door/core-reach', () => ({ PracticeTenantMismatch: class extends Error {}, clientFor: () => mockReads() }))

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { BusinessSessionEdits } from '@/app/[locale]/(business)/BusinessSessionEdits'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { LOGIN, recordedReads, STORE, TENANT } from './practice-door-recorded'

const mockReads = () => recordedReads()

// 13:24 JST on 2026-09-14 — the recorded bookings' day (the ON suite's clock). Date only; timers stay real.
jest.useFakeTimers({
  now: new Date('2026-09-14T04:24:00Z'),
  doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
})

const saved = process.env.BUSINESS_PRACTICE_TENANT
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has no matchMedia; the board reads it for Reduce Motion only.
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  ;(requireBusinessAdmission as jest.Mock).mockResolvedValue({ userId: LOGIN.owner, email: null, businessId: TENANT })
})
afterAll(() => {
  if (saved === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
  else process.env.BUSINESS_PRACTICE_TENANT = saved
})

it('§v11 V11-6 P3 — MOUNTED: every booking card on テスト恵比寿ジム\'s board sits on its track (0 ≤ x, x + w ≤ 100, w > 0)', async () => {
  const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
  try {
    const cards = Array.from(host.querySelectorAll<HTMLElement>('.lane .track .event[data-book]:not(.cleanup)')).map((el) => ({
      book: el.getAttribute('data-book'),
      x: parseFloat(el.style.getPropertyValue('--x')),
      w: parseFloat(el.style.getPropertyValue('--w')),
    }))
    expect(cards.length).toBeGreaterThanOrEqual(2) // the 07:00 pair at least — never a vacuous pass
    expect(cards.filter((c) => !(c.x >= 0 && c.x + c.w <= 100 + 1e-9 && c.w > 0))).toEqual([])
    // Greptile P2 — every card names its customer: the recorded world knows who booked the gym.
    expect(Array.from(host.querySelectorAll('.lane .track .event[data-book]')).filter((el) => (el.textContent ?? '').includes('顧客未登録')).length).toBe(0)
    // ⚖ §v11 V11-3 — the gym closes no weekday: its month legend's item is 「定休日なし」 alone.
    act(() => host.querySelector<HTMLButtonElement>('button.day-label')!.click())
    const legend = Array.from(host.querySelectorAll('.cal-legend span')).map((s) => s.textContent)
    expect([legend.includes('定休日なし'), legend.some((t) => t?.startsWith('定休＝'))]).toEqual([true, false])
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('§v11 V11-14 P5 — MOUNTED: on テスト恵比寿ジム\'s board no hatch (休憩 · 勤務前 · 終業 · 本日勤務なし · 勤務不可) overlaps a booking card in its own lane', async () => {
  // DIAGNOSIS C1 — the sample break 13:00–14:00 seated on 見本 けんた was drawn over 清水 亮 13:00–14:15; C5 / E1 the rest.
  const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
  try {
    const span = (el: Element) => {
      const x = parseFloat((el as HTMLElement).style.getPropertyValue('--x'))
      return { x, end: x + parseFloat((el as HTMLElement).style.getPropertyValue('--w')), label: el.getAttribute('aria-label') }
    }
    let cards = 0
    const clashes = Array.from(host.querySelectorAll('.lane[data-group="staff"]')).flatMap((lane) => {
      const booked = Array.from(lane.querySelectorAll('.track .event[data-book]')).map(span)
      cards += booked.length
      const hatches = Array.from(lane.querySelectorAll('.track .event.absence, .track .event[data-block*="-break-"]')).map(span)
      return hatches.flatMap((h) => booked.filter((b) => b.x < h.end - 1e-9 && h.x < b.end - 1e-9).map((b) => `${h.label} × ${b.label}`))
    })
    expect({ clashes, cards }).toEqual({ clashes: [], cards: 13 }) // the gym's whole recorded day on its lanes — never a vacuous pass
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
