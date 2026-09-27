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
import { GYM, LOGIN, recordedReads, STORE, TENANT, type RecordedOptions } from './practice-door-recorded'

let mockOptions: RecordedOptions = {}
const mockReads = () => recordedReads(mockOptions)

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

// ⚖ §v11 V11-15 (the board fix, PR-C) — the same gym with ONE opt-in row wholly after its close (22:30–23:15 on りな,
// practice-door-recorded.ts `outOfHours`). The board used to place it at x 103.33% / w 0% — drawn nowhere.
async function mountGymOutOfHours() {
  mockOptions = { outOfHours: true }
  const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
  mockOptions = {}
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
  return { host, done: () => { act(() => root.unmount()); host.remove() } }
}
const pct = (el: Element, v: '--x' | '--w') => parseFloat((el as HTMLElement).style.getPropertyValue(v))
const AFTER_CLOSE = ((1320 - 420) / (1440 - 420)) * 100 // 22:00 on the drawn 07:00–24:00 axis

it('§v11 V11-15 P13 — MOUNTED: a booking wholly after the gym\'s close is drawn on its person\'s track; the axis grows to 24:00 and every track carries ONE 営業時間外 band over 22:00–24:00 (P3 · P5 on the same mount)', async () => {
  const { host, done } = await mountGymOutOfHours()
  try {
    const card = host.querySelector(`.lane[data-lane="${GYM.rina}"] .track .event[data-book="00000000-0000-4000-8000-00000000c399"]`)!
    expect([pct(card, '--w') > 0, pct(card, '--x') + pct(card, '--w') <= 100 + 1e-9]).toEqual([true, true])
    const ruler = Array.from(host.querySelectorAll('.time-head .hours span'))
    expect([ruler[0].textContent, ruler.at(-1)!.textContent, ruler.length]).toEqual(['7', '23', 17]) // 07:00–24:00: ceil60 of 23:15
    expect(ruler.filter((r) => r.classList.contains('off')).map((r) => r.textContent)).toEqual(['22', '23'])
    const tracks = Array.from(host.querySelectorAll('.lane .track'))
    const bands = tracks.map((t) => Array.from(t.querySelectorAll(':scope > .offhours')).map((b) => [Math.abs(pct(b, '--x') - AFTER_CLOSE) < 1e-9, Math.abs(pct(b, '--x') + pct(b, '--w') - 100) < 1e-9, b.getAttribute('aria-label'), b.textContent]))
    expect(new Set(bands.map((b) => JSON.stringify(b)))).toEqual(new Set([JSON.stringify([[true, true, '22:00閉店のため、それより後は営業時間外', '営業時間外22:00閉店']])]))
    expect(tracks.length).toBeGreaterThanOrEqual(5)
    // P3 on this mount: every card on its track; no card names an unknown customer.
    const cards = Array.from(host.querySelectorAll('.lane .track .event[data-book]:not(.cleanup)'))
    expect(cards.filter((c) => !(pct(c, '--x') >= 0 && pct(c, '--x') + pct(c, '--w') <= 100 + 1e-9 && pct(c, '--w') > 0)).length).toBe(0)
    expect(cards.filter((c) => (c.textContent ?? '').includes('顧客未登録')).length).toBe(0)
    // P5 on this mount: no hatch over a card in its own lane — the band is not a hatch; 14 = the gym's 13 + this row.
    let staffCards = 0
    const clashes = Array.from(host.querySelectorAll('.lane[data-group="staff"]')).flatMap((lane) => {
      const span = (el: Element) => ({ x: pct(el, '--x'), end: pct(el, '--x') + pct(el, '--w'), label: el.getAttribute('aria-label') })
      const booked = Array.from(lane.querySelectorAll('.track .event[data-book]')).map(span)
      staffCards += booked.length
      return Array.from(lane.querySelectorAll('.track .event.absence, .track .event[data-block*="-break-"]')).map(span)
        .flatMap((h) => booked.filter((b) => b.x < h.end - 1e-9 && h.x < b.end - 1e-9).map((b) => `${h.label} × ${b.label}`))
    })
    expect({ clashes, staffCards }).toEqual({ clashes: [], staffCards: 14 })
    // A 終業 wash still ends at the store's close (22:00), never at the axis's 24:00 — the band covers the rest.
    const washEnds = Array.from(host.querySelectorAll('.track .event.absence')).filter((e) => (e.getAttribute('aria-label') ?? '').includes('終業')).map((e) => pct(e, '--x') + pct(e, '--w'))
    expect(washEnds.length).toBeGreaterThan(0)
    expect(washEnds.filter((end) => Math.abs(end - AFTER_CLOSE) > 1e-9)).toEqual([])
    // The board's own sentences tell the truth (§v11 V11-15(g)).
    expect(host.querySelector('.timeline-scroll')!.getAttribute('aria-label')).toBe('営業時間07:00から22:00の予約ボード（営業時間外を含め07:00から24:00を表示）')
    act(() => host.querySelector<HTMLButtonElement>('button.help-toggle')!.click())
    expect(host.querySelector('.help-pop')!.textContent).toContain('営業時間 07:00–22:00・営業時間外の予約も表示')
  } finally {
    done()
  }
})

it('§v11 V11-15 P14 — the RULES keep the store\'s own close (22:00) while the axis runs to 24:00: the new-booking dialog stops at 22:00 and no sell cell stands past it', async () => {
  const { host, done } = await mountGymOutOfHours()
  try {
    expect(host.querySelector('.time-head .hours span:last-child')!.textContent).toBe('23') // the axis DID grow (the precondition)
    // TodayScreen CreateDialog: the ›30分遅く stepper clamps at business.close − duration, the 営業時間 check reads business.close.
    const dialog = host.querySelector('dialog[aria-labelledby="createTitle"]')!
    for (let i = 0; i < 40; i += 1) act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="30分遅く"]')!.click())
    expect(dialog.querySelector('.stepper b')!.textContent).toMatch(/–22:00$/)
    expect([dialog.textContent!.includes('営業時間内'), dialog.textContent!.includes('営業時間を超えます')]).toEqual([true, false])
    // The sell layer / ledger frame (TodayScreen `sellLayerFor(committedLanes, business, …)`, `ledgerFrame.closeMin`): nothing sold past 22:00.
    const cells = Array.from(host.querySelectorAll('.lane .track > *:not(.event):not(.offhours)')).filter((c) => (c as HTMLElement).style.getPropertyValue('--x'))
    expect(cells.length).toBeGreaterThan(0) // never a vacuous pass
    expect(cells.filter((c) => pct(c, '--x') + pct(c, '--w') > AFTER_CLOSE + 1e-9).map((c) => c.className)).toEqual([])
  } finally {
    done()
  }
})
