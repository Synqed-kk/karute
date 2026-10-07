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
// ⚖ §v11 V11-15 P14 (A8) — pass-through spies on the functions the eight sell/guard frames feed; behaviour unchanged.
jest.mock('@/app/[locale]/(business)/business/today/held-committed', () => {
  const a = jest.requireActual('@/app/[locale]/(business)/business/today/held-committed')
  return { ...a, heldCommittedFor: jest.fn(a.heldCommittedFor) }
})
jest.mock('@/app/[locale]/(business)/business/today/fallback-cells', () => {
  const a = jest.requireActual('@/app/[locale]/(business)/business/today/fallback-cells')
  return { ...a, fallbackCellsFor: jest.fn(a.fallbackCellsFor) }
})
jest.mock('@/app/[locale]/(business)/business/today/reserved-mask', () => {
  const a = jest.requireActual('@/app/[locale]/(business)/business/today/reserved-mask')
  return { ...a, reservedMaskFor: jest.fn(a.reservedMaskFor) }
})
jest.mock('@/app/[locale]/(business)/business/today/today-interactions', () => {
  const a = jest.requireActual('@/app/[locale]/(business)/business/today/today-interactions')
  return {
    ...a, windowsOn: jest.fn(a.windowsOn), guardRailsFor: jest.fn(a.guardRailsFor), guardVerdictAt: jest.fn(a.guardVerdictAt), sellLayerFor: jest.fn(a.sellLayerFor),
    slotStartAt: jest.fn(a.slotStartAt), seedSpanIn: jest.fn(a.seedSpanIn), nearestFreeStarts: jest.fn(a.nearestFreeStarts),
  }
})

import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { BusinessSessionEdits } from '@/app/[locale]/(business)/BusinessSessionEdits'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { heldCommittedFor } from '@/app/[locale]/(business)/business/today/held-committed'
import { fallbackCellsFor } from '@/app/[locale]/(business)/business/today/fallback-cells'
import { reservedMaskFor } from '@/app/[locale]/(business)/business/today/reserved-mask'
import { guardRailsFor, guardVerdictAt, nearestFreeStarts, seedSpanIn, sellLayerFor, slotStartAt, windowsOn } from '@/app/[locale]/(business)/business/today/today-interactions'
import { GYM, LOGIN, recordedReads, STORE, TENANT, type RecordedOptions } from './practice-door-recorded'
import { minPxPer30 } from '@/business/lib/today-board'

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
async function mountGymOutOfHours(store: string = STORE.gym) {
  mockOptions = { outOfHours: true }
  const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store }) })
  mockOptions = {}
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
  return { host, done: () => { act(() => root.unmount()); host.remove() } }
}
const pct = (el: Element, v: '--x' | '--w') => parseFloat((el as HTMLElement).style.getPropertyValue(v))
const AFTER_CLOSE = ((1320 - 420) / (1440 - 420)) * 100 // 22:00 on the drawn 07:00–24:00 axis

it('§v11 V11-15 P13 — MOUNTED: a booking wholly after the gym\'s close is drawn on its person\'s track; the axis grows to 24:00 and the board paints 営業時間外 over 22:00–24:00 (P3 · P5 on the same mount)', async () => {
  const { host, done } = await mountGymOutOfHours()
  try {
    const card = host.querySelector(`.lane[data-lane="${GYM.rina}"] .track .event[data-book="00000000-0000-4000-8000-00000000c399"]`)!
    expect([pct(card, '--w') > 0, pct(card, '--x') + pct(card, '--w') <= 100 + 1e-9]).toEqual([true, true])
    const ruler = Array.from(host.querySelectorAll('.time-head .hours span'))
    // ⚖ 10/7 S25-2: the closing edge is printed — 17 hour columns + the closing edge tick 「24」 (a 24:00 close reads 24), muted after close.
    expect([ruler[0].textContent, ruler.at(-1)!.textContent, ruler.length]).toEqual(['7', '24', 18]) // 07:00–24:00: ceil60 of 23:15
    expect(ruler.filter((r) => r.classList.contains('off')).map((r) => r.textContent)).toEqual(['22', '23', '24'])
    // The band is a LAYER of every track (A5): the timeline carries each side's share; the ruler says it once, after close only.
    const timeline = host.querySelector<HTMLElement>('.timeline.off-hours')!
    expect([timeline.style.getPropertyValue('--off-before'), Math.abs(parseFloat(timeline.style.getPropertyValue('--off-after')) - 120 / 1020) < 1e-12]).toEqual(['0', true])
    expect(Array.from(host.querySelectorAll('.time-head > .off-caption')).map((c) => `${c.className}:${c.textContent}`)).toEqual(['off-caption after:営業時間外'])
    expect(host.querySelectorAll('.track .offhours').length).toBe(0) // no per-lane element
    // P3 on this mount: every card on its track; no card names an unknown customer.
    const cards = Array.from(host.querySelectorAll('.lane .track .event[data-book]:not(.cleanup)'))
    expect(cards.filter((c) => !(pct(c, '--x') >= 0 && pct(c, '--x') + pct(c, '--w') <= 100 + 1e-9 && pct(c, '--w') > 0)).length).toBe(0)
    expect(cards.filter((c) => (c.textContent ?? '').includes('顧客未登録')).length).toBe(0)
    // P5 on this mount: no hatch over a card in its own lane; 14 = the gym's 13 + this row.
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
    // B5 — a lane that becomes a drop target keeps the layer: its timeline still carries the shares, and the stylesheet's
    // drop-target rule repaints the grid WITH both band layers (jsdom loads no stylesheet, so the rule is read as text).
    const track = host.querySelector('.lane[data-group="staff"] .track')!
    act(() => { track.classList.add('drop-target') })
    expect(parseFloat(track.closest<HTMLElement>('.timeline.off-hours')!.style.getPropertyValue('--off-after')) > 0).toBe(true)
    const css = readFileSync('src/app/[locale]/(business)/business/today/today.css', 'utf8')
    expect(css).toMatch(/\.biz \.timeline\.off-hours \.track\.drop-target \{ background-image: linear-gradient\(to right, rgba\(63, 91, 232, \.22\) 1px, transparent 1px\), repeating-linear-gradient\(135deg, #eeeeef 0 6px, #f7f7f8 6px 12px\), repeating-linear-gradient\(135deg, #eeeeef 0 6px, #f7f7f8 6px 12px\); \}/)
  } finally {
    done()
  }
  // B2 — on a store whose hours are the SAMPLE pair (テスト横浜店, none in core) the axis still grows for its 19:30 row,
  // but nothing says 営業時間外 over hours the store never set: no layer, no caption, no muted hour.
  const yokohama = await mountGymOutOfHours(STORE.yokohama)
  try {
    const { host } = yokohama
    const card = host.querySelector('.lane .track .event[data-book="00000000-0000-4000-8000-00000000c398"]')!
    expect([pct(card, '--w') > 0, pct(card, '--x') + pct(card, '--w') <= 100 + 1e-9]).toEqual([true, true])
    // ⚖ 10/7 S25-2: the closing edge is printed
    expect(host.querySelector('.time-head .hours span:last-child')!.textContent).toBe('21') // 10:00–21:00
    expect([host.querySelectorAll('.timeline.off-hours').length, host.querySelectorAll('.off-caption').length, host.querySelectorAll('.hours span.off').length]).toEqual([0, 0, 0])
  } finally {
    yokohama.done()
  }
})

it('§v11 V11-15 P14 (A8) — the RULES keep the store\'s own close (22:00) while the axis runs to 24:00: all eight sell/guard frames, the sell layer and the new-booking dialog', async () => {
  jest.clearAllMocks()
  const { host, done } = await mountGymOutOfHours()
  try {
    // ⚖ 10/7 S25-2: the closing edge is printed
    expect(host.querySelector('.time-head .hours span:last-child')!.textContent).toBe('24') // the axis DID grow (the precondition)
    type Call = unknown[]
    const argsOf = (fn: unknown) => (fn as jest.Mock).mock.calls as Call[]
    const closes = <C,>(calls: C[], read: (c: C) => unknown) => [calls.length > 0, [...new Set(calls.map(read))]]
    const held = argsOf(heldCommittedFor) as Array<[{ frame: { openMin: number; closeMin: number }; closeMin: number }]>
    // TodayScreen.tsx:2106-2107 — ledgerFrame (the ONE clock the book is built on).
    expect(closes(held, ([o]) => `${o.frame.openMin}-${o.frame.closeMin}`)).toEqual([true, ['420-1320']])
    // TodayScreen.tsx:2203 — heldCommittedFor's own closeMin.
    expect(closes(held, ([o]) => o.closeMin)).toEqual([true, [1320]])
    // TodayScreen.tsx:2458 — fallbackCellsFor (the sales door).
    expect(closes(argsOf(fallbackCellsFor), ([o]) => (o as { closeMin: number }).closeMin)).toEqual([true, [1320]])
    // TodayScreen.tsx:2751 — reservedMaskFor (the hand's held mask).
    expect(closes(argsOf(reservedMaskFor), ([o]) => (o as { closeMin: number }).closeMin)).toEqual([true, [1320]])
    // Two frames never run on a static board, so they are pinned as TEXT (their own lines read the store's hours):
    // TodayScreen.tsx:2838-2839 — inputOn, reached through windowsOn only with the selling law OFF or a day move staged
    // (dayCommitted's last arm / dayOrigin); TodayScreen.tsx:2943 — the STAGED day's heldCommittedFor.
    expect(argsOf(windowsOn).length).toBe(0) // the law is on: the text pin below is the honest one, never a vacuous pass
    const src = readFileSync('src/app/[locale]/(business)/business/today/TodayScreen.tsx', 'utf8')
    const block = (anchor: string) => src.slice(src.indexOf(anchor), src.indexOf(anchor) + 900)
    expect(block('const inputOn = useCallback(')).toMatch(/open: business\.open,\n\s+close: business\.close,/)
    expect(block('const originHeld = heldCommittedFor({')).toContain('closeMin: business.close,')
    // TodayScreen.tsx:3030-3031 — guardRailsFor (the 60分配置 strip).
    expect(closes(argsOf(guardRailsFor), ([, o]) => `${(o as { open: number }).open}-${(o as { close: number }).close}`)).toEqual([true, ['420-1320']])
    // TodayScreen.tsx:3403-3404 — guardVerdictAt (one landing's verdict): asked by an empty-slot click on a staff track.
    act(() => { host.querySelector('.lane[data-group="staff"] .track')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(closes(argsOf(guardVerdictAt), ([, , , o]) => `${(o as { open: number }).open}-${(o as { close: number }).close}`)).toEqual([true, ['420-1320']])
    // B4 — the helpers that seed a start read the pixel on the axis but bound it by the store's hours.
    // TodayScreen.tsx slotStartAt(e.currentTarget, e.clientX, hours, business) — the empty-slot click above:
    expect(closes(argsOf(slotStartAt), ([, , axis, b]) => `${(axis as { close: number }).close}|${(b as { open: number }).open}-${(b as { close: number }).close}`)).toEqual([true, ['1440|420-1320']])
    // TodayScreen.tsx seedSpanIn(lane, start, …, business, …) — the same click:
    expect(closes(argsOf(seedSpanIn), ([, , , b]) => `${(b as { open: number }).open}-${(b as { close: number }).close}`)).toEqual([true, ['420-1320']])
    // …and its 配置モード twin (placeNextVisit) plus nearestFreeStarts (a refusal's alternatives) never run on a static
    // board with a free 07:00: pinned as TEXT — both seedSpanIn calls and the nearestFreeStarts call pass `business`.
    expect([src.split('seedSpanIn(lane, start, props.guard.standardSessionMin, business, props.sell.nowMinute)').length - 1, /seedSpanIn\([^)]*\bhours\b/.test(src)]).toEqual([2, false])
    expect(src).toContain('return nearestFreeStarts(start, props.guard.bookingStepMin, business, dur, (s) =>')
    expect(argsOf(nearestFreeStarts).every(([, , b]) => (b as { close: number }).close === 1320)).toBe(true)
    // TodayScreen.tsx:2369 — the sell layer reads the same frame (beyond the census's thirty lines).
    expect(closes(argsOf(sellLayerFor), ([, h]) => `${(h as { open: number }).open}-${(h as { close: number }).close}`)).toEqual([true, ['420-1320']])
    // TodayScreen.tsx:10458-10589 — CreateDialog: the ›30分遅く stepper stops at business.close − duration; the check reads 22:00.
    const dialog = host.querySelector('dialog[aria-labelledby="createTitle"]')!
    for (let i = 0; i < 40; i += 1) act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="30分遅く"]')!.click())
    expect(dialog.querySelector('.stepper b')!.textContent).toMatch(/–22:00$/)
    expect([dialog.textContent!.includes('営業時間内'), dialog.textContent!.includes('営業時間を超えます')]).toEqual([true, false])
  } finally {
    done()
  }
})

it('⚖ S25 round 2 item 8 — MOUNTED 07–22 (テスト恵比寿ジム): the 22 edge label, 30 strip cells per lane, the track floor from the day model, and ONE now-line scroll that a store switch never repeats', async () => {
  // jsdom lays nothing out: the scroll box is made to overflow (the floor's 990 + the 112 label > 952) and its scrollLeft writes are counted.
  const writes: number[] = []
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const isBox = (el: Element) => el.classList.contains('timeline-scroll')
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get(this: Element) { return isBox(this) ? 1102 : 0 } })
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: Element) { return isBox(this) ? 952 : 0 } })
  Object.defineProperty(proto, 'scrollLeft', { configurable: true, get: () => 0, set(this: Element, v: number) { if (isBox(this)) writes.push(v) } })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    const ruler = Array.from(host.querySelectorAll('.time-head .hours span'))
    expect([ruler[0].textContent, ruler.at(-1)!.textContent, ruler.at(-1)!.classList.contains('edge'), ruler.length]).toEqual(['7', '22', true, 16])
    const strips = Array.from(host.querySelectorAll('.guard-rail-track')).map((t) => t.querySelectorAll('.guard-rail-cell').length)
    expect([strips.length > 0, [...new Set(strips)]]).toEqual([true, [30]])
    // The floor is CSS: the day model's cells × the floor ride the timeline's style; the rule turns them into its min-width
    // (here calc(112px + 30 × 33px) = 1102 px) and the scroll box, not the page, takes the overflow.
    const timeline = host.querySelector<HTMLElement>('.timeline-scroll > .timeline')!
    expect([timeline.style.getPropertyValue('--board-cells'), timeline.style.getPropertyValue('--cell-floor')]).toEqual(['30', `${minPxPer30}px`])
    const css = readFileSync('src/app/[locale]/(business)/business/today/today.css', 'utf8')
    expect(css).toContain('.biz .timeline-scroll { overflow-x: auto;')
    expect(css).toContain('.biz .timeline-scroll > .timeline { min-width: calc(var(--label) + var(--board-cells, 0) * var(--cell-floor, 0px)); }')
    expect(Array.from(host.querySelectorAll('.cell-held')).filter((h) => !h.getAttribute('title')).length).toBe(0)
    expect(writes.length).toBe(1) // today, overflowing, on mount: once
    const other = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.yokohama }) })
    await act(async () => root.render(<BusinessSessionEdits>{other}</BusinessSessionEdits>))
    expect(host.querySelector('.time-head .hours span:last-child')!.textContent).not.toBe('22') // the switch landed
    expect(writes.length).toBe(1) // the same instance re-rendered for another store: never again
  } finally {
    act(() => root.unmount())
    host.remove()
    for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft']) delete proto[k]
  }
})
