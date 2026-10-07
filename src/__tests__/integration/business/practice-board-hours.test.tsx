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
import { act, cloneElement, type ReactElement } from 'react'
import type { TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { createRoot } from 'react-dom/client'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { BusinessSessionEdits, useSessionEdits } from '@/app/[locale]/(business)/BusinessSessionEdits'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { heldCommittedFor } from '@/app/[locale]/(business)/business/today/held-committed'
import { fallbackCellsFor } from '@/app/[locale]/(business)/business/today/fallback-cells'
import { reservedMaskFor } from '@/app/[locale]/(business)/business/today/reserved-mask'
import { DRAG_EDGE_STEP_PX, guardRailsFor, guardVerdictAt, nearestFreeStarts, seedSpanIn, sellLayerFor, slotStartAt, windowsOn } from '@/app/[locale]/(business)/business/today/today-interactions'
import { GYM, LOGIN, POLICIES, recordedReads, STORE, TENANT, type RecordedOptions } from './practice-door-recorded'
import { familyNameOf, minPxPer30 } from '@/business/lib/today-board'

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
    // ⚖ Q-25 — no fixed-30 lattice remains on the board; every rail/click lattice reads the store's booking step.
    expect(src).not.toMatch(/\/ 30\) \* 30/)
    expect(src).not.toMatch(/close - 30\b/)
    expect(src).not.toMatch(/aria-label="30分/)
    // exact count at this head; a removed read fails it, an added read updates it
    expect(src.split('props.guard.bookingStepMin').length - 1).toBe(15)
    // TodayScreen.tsx:3030-3031 — guardRailsFor (the 60分配置 strip).
    expect(closes(argsOf(guardRailsFor), ([, o]) => `${(o as { open: number }).open}-${(o as { close: number }).close}`)).toEqual([true, ['420-1320']])
    // TodayScreen.tsx:3403-3404 — guardVerdictAt (one landing's verdict): asked by an empty-slot click on a staff track.
    act(() => { host.querySelector('.lane[data-group="staff"] .track')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(closes(argsOf(guardVerdictAt), ([, , , o]) => `${(o as { open: number }).open}-${(o as { close: number }).close}`)).toEqual([true, ['420-1320']])
    // B4 — the helpers that seed a start read the pixel on the axis but bound it by the store's hours.
    // TodayScreen.tsx slotStartAt(e.currentTarget, e.clientX, hours, business, props.guard.bookingStepMin) — the empty-slot click above:
    expect(closes(argsOf(slotStartAt), ([, , axis, b, step]) => `${(axis as { close: number }).close}|${(b as { open: number }).open}-${(b as { close: number }).close}|${step}`)).toEqual([true, ['1440|420-1320|30']])
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
    expect([timeline.style.getPropertyValue('--board-cells'), timeline.style.getPropertyValue('--floor-slots'), timeline.style.getPropertyValue('--cell-floor')]).toEqual(['30', '30', `${minPxPer30}px`]) // S25-15 (2): the floor is per 30 minutes (--floor-slots), the strip per step
    const css = readFileSync('src/app/[locale]/(business)/business/today/today.css', 'utf8')
    expect(css).toContain('.biz .timeline-scroll { overflow-x: auto;')
    expect(css).toContain('.biz .timeline-scroll > .timeline { min-width: calc(var(--label) + var(--floor-slots, 0) * var(--cell-floor, 0px)); }')
    const held = Array.from(host.querySelectorAll('.cell-held'))
    expect(held.length).toBeGreaterThan(0) // the gym's recorded day draws 確保 boxes, else the next line tests nothing
    expect(held.filter((h) => !h.getAttribute('title')).length).toBe(0)
    expect(writes.length).toBe(1) // today, overflowing, on mount: once
    const other = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.yokohama }) })
    await act(async () => root.render(<BusinessSessionEdits>{other}</BusinessSessionEdits>))
    expect(host.querySelector('.time-head .hours span:last-child')!.textContent).not.toBe('22') // the switch landed
    // S25-15 (5) flips this pin: the same instance re-rendered for another store applies the now-line rule to the new board.
    expect(writes.length).toBe(2)
  } finally {
    act(() => root.unmount())
    host.remove()
    for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft']) delete proto[k]
  }
})

it('⚖ S25 round 3 (D5) + round 4 — MOUNTED: the 07:00 card\'s name line per tier — WIDE the full name + the room tag · MID the family name + the time line (no given name, no tag) · NARROW the family name only (familyNameOf) · SLIVER the bar', async () => {
  // jsdom runs no container queries, so the tiers are read from today.css as written (content-box px, today-board.ts
  // LABEL_TIER_PX − CARD_PAD_PX) and applied to the rendered name line: what each tier hides is removed, the rest is the line.
  const css = readFileSync('src/app/[locale]/(business)/business/today/today.css', 'utf8')
  expect(css).toContain('@container (width < 77px) {\n  .biz .page-today .event > .e-tkt, .biz .page-today .event > strong > .e-given, .biz .page-today .event > strong > .tg { display: none; }')
  expect(css).toContain('@container (width < 35px) { .biz .page-today .event > .e-time { display: none; } }')
  expect(css).toContain('@container (width < 2px) { .biz .page-today .event > strong, .biz .page-today .event > small { visibility: hidden; } }')
  const HIDDEN = { wide: [], mid: ['.e-tkt', '.e-given', '.tg'], narrow: ['.e-tkt', '.e-given', '.tg', '.e-time'] } as const
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    const card = Array.from(host.querySelectorAll<HTMLElement>('.lane .track .event[data-book]:not(.cleanup)')).find((el) => el.querySelector('.e-time')?.textContent?.startsWith('07:00') && el.querySelector('.tg')?.textContent)!
    expect(card).toBeTruthy()
    const strong = card.querySelector<HTMLElement>(':scope > strong')!
    // a tier's face = [the name line, the time line] as printed (null = hidden)
    const face = (hide: ReadonlyArray<string>) => {
      const copy = card.cloneNode(true) as HTMLElement
      for (const sel of hide) copy.querySelectorAll(sel).forEach((n) => n.remove())
      return [copy.querySelector(':scope > strong')!.textContent, copy.querySelector(':scope > .e-time')?.textContent ?? null]
    }
    expect([face(HIDDEN.wide)[0], face(HIDDEN.mid), face(HIDDEN.narrow)]).toEqual(['松田 亜希子【未定】', ['松田', '07:00〜'], ['松田', null]])
    expect(face(HIDDEN.mid)[0]).toBe(familyNameOf(face(HIDDEN.wide)[0]!.replace(strong.querySelector('.tg')!.textContent!, '')))
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

// ⚖ S25-15 — Round B's mounted pins. jsdom lays nothing out: the scroll box is made to overflow and to keep its scrollLeft.
function overflowingBox() {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const isBox = (el: Element) => el.classList.contains('timeline-scroll')
  const box = { at: 0, writes: [] as number[] }
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get(this: Element) { return isBox(this) ? 1102 : 0 } })
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: Element) { return isBox(this) ? 952 : 0 } })
  Object.defineProperty(proto, 'scrollLeft', { configurable: true, get(this: Element) { return isBox(this) ? box.at : 0 }, set(this: Element, v: number) { if (isBox(this)) { box.writes.push(v); box.at = v } } })
  return { box, restore: () => { for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft']) delete proto[k] } }
}
const todayCss = () => readFileSync('src/app/[locale]/(business)/business/today/today.css', 'utf8')

it('⚖ S25-15 (1) + (7) + (10) — MOUNTED 07–24 (テスト恵比寿ジム + one row after close): the strip walks the ruler\'s day on the grid step (--board-cells cells per lane, 07:00 first, 23:30 last, 13:00 at the ruler\'s 13 slot); block cards carry the tier classes and no title', async () => {
  const { host, done } = await mountGymOutOfHours()
  try {
    const STEP = 30 // the gym's bookingStepMin (its 07–22 day is 30 --board-cells above)
    const cells = Number(host.querySelector<HTMLElement>('.timeline-scroll > .timeline')!.style.getPropertyValue('--board-cells'))
    const lanes = Array.from(host.querySelectorAll('.guard-rail-track')).map((t) => Array.from(t.querySelectorAll('.guard-rail-cell')).map((c) => Number(c.getAttribute('data-start'))))
    expect([cells, lanes.length > 0, [...new Set(lanes.map((l) => `${l.length} ${l[0]} ${l.at(-1)}`))]]).toEqual([34, true, ['34 420 1410']])
    // the 13:00 x match in jsdom's terms: the strip's 13:00 cell and the ruler's 13 label sit at the same slot of the day
    const ruler = Array.from(host.querySelectorAll('.time-head .hours span')).map((s) => s.textContent)
    expect([ruler[0], ruler.indexOf('13') * (60 / STEP), lanes[0].indexOf(780)]).toEqual(['7', (780 - 420) / STEP, (780 - 420) / STEP])
    // (10) flag 8: no card on the board carries a title (the base's block title went; 確保's is a .cell-held, not an .event)
    expect(host.querySelectorAll('.event[title]').length).toBe(0)
    // (7) a block card is the booking card's name line + .e-time; the CSS hides a block's .e-time below WIDE (Round C measures)
    const blocks = Array.from(host.querySelectorAll('.lane .track .event:not([data-book]):not(.micro)'))
    expect([blocks.length > 0, blocks.filter((b) => !(b.querySelector(':scope > strong') && b.querySelector(':scope > small.e-time'))).length]).toEqual([true, 0])
    const css = todayCss()
    expect(css).toContain('@container (width < 77px) { .biz .page-today .event:is(.block, .absence, .cleanup) > .e-time { display: none; } }') // S26 E2: positive
    expect(css).toContain('.biz .page-today :is(.cell-price, .cell-packed, .cell-gapfill) { overflow: hidden; }')
    // (9) the give-back skips micro blocks, so they keep the base's 3 px inset
    expect(css).toContain('  .biz .page-today .event:not(.micro) > strong, .biz .page-today .event:not(.micro) > small { margin-left: -6px; margin-right: -5px; }')
  } finally {
    done()
  }
})

it('⚖ S25-15 (5) — MOUNTED: the now-line scroll keys on the shown day and the store — 明日 on mount writes nothing · the same instance on 今日 writes once · a store switch writes again', async () => {
  const { box, restore } = overflowingBox()
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const page = (store: string, day?: string) => TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve(day ? { store, day } : { store }) })
  try {
    const tomorrow = await page(STORE.gym, '1')
    await act(async () => root.render(<BusinessSessionEdits>{tomorrow}</BusinessSessionEdits>))
    expect(box.writes).toEqual([])
    const today = await page(STORE.gym)
    await act(async () => root.render(<BusinessSessionEdits>{today}</BusinessSessionEdits>))
    expect(box.writes.length).toBe(1)
    const other = await page(STORE.yokohama)
    await act(async () => root.render(<BusinessSessionEdits>{other}</BusinessSessionEdits>))
    expect(box.writes.length).toBe(2)
  } finally {
    act(() => root.unmount())
    host.remove()
    restore()
  }
})

it('⚖ S25-15 (5) — MOUNTED: today → another day on the same instance puts the scrolled board back to the day\'s start (scrollLeft 0); back to today brings the now-line in again', async () => {
  // A box wide enough that today's now-line scroll is a real, positive offset; the setter clamps like a browser does.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const isBox = (el: Element) => el.classList.contains('timeline-scroll')
  const box = { at: 0, writes: [] as number[] }
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get(this: Element) { return isBox(this) ? 2400 : 0 } })
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: Element) { return isBox(this) ? 952 : 0 } })
  Object.defineProperty(proto, 'scrollLeft', { configurable: true, get(this: Element) { return isBox(this) ? box.at : 0 }, set(this: Element, v: number) { if (isBox(this)) { box.writes.push(v); box.at = Math.max(0, Math.min(v, 2400 - 952)) } } })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const page = (day?: string) => TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve(day ? { store: STORE.gym, day } : { store: STORE.gym }) })
  try {
    await act(async () => root.render(<BusinessSessionEdits>{await page()}</BusinessSessionEdits>))
    const todayAt = box.at
    expect([box.writes.length, todayAt > 0]).toEqual([1, true]) // today, overflowing: the now-line is brought in
    await act(async () => root.render(<BusinessSessionEdits>{await page('1')}</BusinessSessionEdits>)) // 明日: dayOffset 1, sell.nowMinute null, nowFraction null
    expect([box.writes.length, box.writes.at(-1), box.at]).toEqual([2, 0, 0]) // the reset write, nothing else
    await act(async () => root.render(<BusinessSessionEdits>{await page()}</BusinessSessionEdits>))
    expect([box.writes.length, box.at]).toEqual([3, todayAt]) // back on today: the now-line write happens again
  } finally {
    act(() => root.unmount())
    host.remove()
    for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft']) delete proto[k]
  }
})

it('⚖ S25-15 (4) — MOUNTED: a card held in the right edge zone of an overflowing board scrolls it DRAG_EDGE_STEP_PX a frame; the middle does not; the release stops the loop', async () => {
  const { box, restore } = overflowingBox()
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.classList.contains('timeline-scroll') ? ({ left: 0, right: 952, top: 0, bottom: 600, width: 952, height: 600, x: 0, y: 0 } as DOMRect) : rect.call(this)
  }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const ev = (type: string, clientX: number, buttons: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 10, button: 0, buttons })
    Object.defineProperty(e, 'pointerId', { value: 1 })
    return e
  }
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    box.at = 0
    const card = host.querySelector<HTMLElement>('.lane[data-group="staff"] .track .event[data-book]:not(.cleanup)')!
    act(() => { card.dispatchEvent(ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(ev('pointermove', 940, 1)) }) // inside the right zone (952 − 40 < 940 ≤ 952)
    act(() => { jest.advanceTimersByTime(16) })
    expect(box.at).toBe(DRAG_EDGE_STEP_PX)
    act(() => { window.dispatchEvent(ev('pointermove', 500, 1)) }) // the middle: the loop stops on its next frame
    act(() => { jest.advanceTimersByTime(64) })
    expect(box.at).toBe(DRAG_EDGE_STEP_PX)
    act(() => { window.dispatchEvent(ev('pointermove', 940, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
    expect(box.at).toBe(2 * DRAG_EDGE_STEP_PX)
    act(() => { window.dispatchEvent(ev('pointerup', 940, 0)) })
    const up = box.at
    act(() => { jest.advanceTimersByTime(64) })
    expect(box.at).toBe(up)
  } finally {
    act(() => root.unmount())
    host.remove()
    Element.prototype.getBoundingClientRect = rect
    restore()
  }
})

it('⚖ Liam S25-17 (2) — MOUNTED: a BLOCK (button.event, onBlockPointerDown) held in the right edge zone of an overflowing board scrolls it DRAG_EDGE_STEP_PX a frame; the release stops the loop', async () => {
  const { box, restore } = overflowingBox()
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.classList.contains('timeline-scroll') ? ({ left: 0, right: 952, top: 0, bottom: 600, width: 952, height: 600, x: 0, y: 0 } as DOMRect) : rect.call(this)
  }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const ev = (type: string, clientX: number, buttons: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 10, button: 0, buttons })
    Object.defineProperty(e, 'pointerId', { value: 1 })
    return e
  }
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    box.at = 0
    // the draggable block: a <button> (the washes are <span role="note">), pressed in its middle — a MOVE, not a resize
    const block = host.querySelector<HTMLElement>('.lane .track button.event[data-block]')!
    expect(block).not.toBeNull()
    act(() => { block.dispatchEvent(ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(ev('pointermove', 940, 1)) }) // inside the right zone (952 − 40 < 940 ≤ 952)
    act(() => { jest.advanceTimersByTime(16) })
    expect(box.at).toBe(DRAG_EDGE_STEP_PX)
    act(() => { window.dispatchEvent(ev('pointerup', 940, 0)) })
    const up = box.at
    act(() => { jest.advanceTimersByTime(64) })
    expect(box.at).toBe(up)
  } finally {
    act(() => root.unmount())
    host.remove()
    Element.prototype.getBoundingClientRect = rect
    restore()
  }
})

it('⚖ Liam S25-17 (2) — MOUNTED: a SHELF CHIP held in the right edge zone of an overflowing board rides the same loop (DRAG_EDGE_STEP_PX a frame); the release stops it', async () => {
  const { box, restore } = overflowingBox()
  const rect = Element.prototype.getBoundingClientRect
  // jsdom lays nothing out: every other rect is 0×0 at the origin, so clientY 0 is "over the shelf" for the card's
  // release (isOverShelf) and "over the first lane" for the chip (laneKeyAtY); a card rect makes the press a MOVE.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('timeline-scroll')) return { left: 0, right: 952, top: 0, bottom: 600, width: 952, height: 600, x: 0, y: 0 } as DOMRect
    if (this.hasAttribute('data-book')) return { left: 400, right: 600, top: 0, bottom: 0, width: 200, height: 0, x: 400, y: 0 } as DOMRect
    return rect.call(this)
  }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const ev = (type: string, clientX: number, buttons: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0, button: 0, buttons })
    Object.defineProperty(e, 'pointerId', { value: 1 })
    return e
  }
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    // park one card: carry it in the middle (no edge) and release it over the shelf
    const card = host.querySelector<HTMLElement>('.lane[data-group="staff"] .track .event[data-book]:not(.cleanup)')!
    act(() => { card.dispatchEvent(ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(ev('pointermove', 520, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
    act(() => { window.dispatchEvent(ev('pointerup', 520, 0)) })
    act(() => { jest.advanceTimersByTime(1000) })
    const chip = host.querySelector<HTMLElement>('.park-chip')!
    expect(chip).not.toBeNull()
    box.at = 0
    act(() => { chip.dispatchEvent(ev('pointerdown', 500, 1)) })
    act(() => { chip.dispatchEvent(ev('pointermove', 940, 1)) }) // over a lane, inside the right zone (952 − 40 < 940 ≤ 952)
    act(() => { jest.advanceTimersByTime(16) })
    expect(box.at).toBe(DRAG_EDGE_STEP_PX)
    act(() => { chip.dispatchEvent(ev('pointerup', 940, 0)) })
    const up = box.at
    act(() => { jest.advanceTimersByTime(64) })
    expect(box.at).toBe(up)
  } finally {
    act(() => root.unmount())
    host.remove()
    Element.prototype.getBoundingClientRect = rect
    restore()
  }
})

// ⚖ S26 Round E — the drag proxy's identity (E2) and the edge loop's pause at the scroll limit (E4).
function rig(limit: number | null) {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const isBox = (el: Element) => el.classList.contains('timeline-scroll')
  const box = { at: 0, writes: [] as number[] }
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get(this: Element) { return isBox(this) ? 1102 : 0 } })
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: Element) { return isBox(this) ? 952 : 0 } })
  Object.defineProperty(proto, 'scrollLeft', { configurable: true, get(this: Element) { return isBox(this) ? box.at : 0 }, set(this: Element, v: number) { if (isBox(this)) { box.writes.push(v); box.at = limit == null ? v : Math.max(0, Math.min(v, limit)) } } })
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('timeline-scroll')) return { left: 0, right: 952, top: 0, bottom: 600, width: 952, height: 600, x: 0, y: 0 } as DOMRect
    if (this.hasAttribute('data-book') || this.hasAttribute('data-block')) return { left: 400, right: 600, top: 0, bottom: 0, width: 200, height: 0, x: 400, y: 0 } as DOMRect
    return rect.call(this)
  }
  const ev = (type: string, clientX: number, buttons: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 10, button: 0, buttons })
    Object.defineProperty(e, 'pointerId', { value: 1 })
    return e
  }
  const restore = () => { for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft']) delete proto[k]; Element.prototype.getBoundingClientRect = rect }
  return { box, ev, restore }
}

it('⚖ S26 Round E (E2) — MOUNTED: a booking\'s drag proxy carries data-book (empty: no card lookup finds it); a block\'s carries the resting block\'s class and an .e-time line', async () => {
  const { ev, restore } = rig(null)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    const card = host.querySelector<HTMLElement>('.lane[data-group="staff"] .track .event[data-book]:not(.cleanup)')!
    const id = card.getAttribute('data-book')!
    const drawn = host.querySelectorAll(`.event[data-book="${id}"]`).length
    act(() => { card.dispatchEvent(ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(ev('pointermove', 520, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
    const cardProxy = host.querySelector<HTMLElement>('.drag-proxy.event')!
    expect([cardProxy !== null, cardProxy?.getAttribute('data-book'), host.querySelectorAll(`.event[data-book="${id}"]`).length]).toEqual([true, '', drawn])
    act(() => { window.dispatchEvent(ev('pointerup', 520, 0)) })
    act(() => { jest.advanceTimersByTime(1000) })
    const block = host.querySelector<HTMLElement>('.lane .track button.event[data-block]:not(.micro)')!
    const cls = ['block', 'absence', 'cleanup'].filter((c) => block.classList.contains(c))
    act(() => { block.dispatchEvent(ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(ev('pointermove', 520, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
    const blockProxy = host.querySelector<HTMLElement>('.drag-proxy.event')!
    expect([cls.length, blockProxy !== null, cls.every((c) => blockProxy?.classList.contains(c)), blockProxy?.hasAttribute('data-book'), blockProxy?.querySelector(':scope > small.e-time') != null]).toEqual([1, true, true, false, true])
    act(() => { window.dispatchEvent(ev('pointerup', 520, 0)) })
  } finally {
    act(() => root.unmount())
    host.remove()
    restore()
  }
})

it('⚖ S26 Round E (E4) — MOUNTED: at the scroll limit one zero-move frame ends the edge loop (no further frame); a later move in the zone restarts it', async () => {
  const LIMIT = 1102 - 952
  const { box, ev, restore } = rig(LIMIT)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const raf = jest.spyOn(window, 'requestAnimationFrame')
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    box.at = LIMIT
    const card = host.querySelector<HTMLElement>('.lane[data-group="staff"] .track .event[data-book]:not(.cleanup)')!
    act(() => { card.dispatchEvent(ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(ev('pointermove', 940, 1)) }) // inside the right zone, the box already at its limit
    box.writes.length = 0
    act(() => { jest.advanceTimersByTime(16) }) // the one zero-move frame
    const after = box.writes.length
    raf.mockClear()
    act(() => { jest.advanceTimersByTime(160) }) // ten frames' time: nothing scheduled, nothing written
    expect([after, box.writes.length, box.at, raf.mock.calls.length]).toEqual([1, 1, LIMIT, 0])
    box.at = LIMIT - 2 * DRAG_EDGE_STEP_PX // room again (as if the box were scrolled back)
    act(() => { window.dispatchEvent(ev('pointermove', 941, 1)) }) // a later move in the zone restarts the loop
    act(() => { jest.advanceTimersByTime(16) })
    expect(box.at).toBe(LIMIT - DRAG_EDGE_STEP_PX)
    act(() => { window.dispatchEvent(ev('pointerup', 941, 0)) })
  } finally {
    raf.mockRestore()
    act(() => root.unmount())
    host.remove()
    restore()
  }
})

/** ⚖ S26 Round F — the track gets a width (jsdom's is 0, which `deltaPctIn` reads as "no travel") and the card's own
 *  lane a height (so the lane hunt answers at clientY 10 and the ghost draws); the drop ghost's --x is the span the
 *  drag frame computed. */
function trackWide(width: number, lane: Element) {
  const inner = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('track')) return { left: 0, right: width, top: 0, bottom: 0, width, height: 0, x: 0, y: 0 } as DOMRect
    if (this === lane) return { left: 0, right: 952, top: 0, bottom: 72, width: 952, height: 72, x: 0, y: 0 } as DOMRect
    return inner.call(this)
  }
}
async function mountRigged(limit: number | null) {
  const r = rig(limit)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
  await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
  r.box.at = 0
  const el = host.querySelector<HTMLElement>('.timeline-scroll')!
  const card = host.querySelector<HTMLElement>('.lane[data-group="staff"] .track .event[data-book]:not(.cleanup)')!
  trackWide(600, card.closest('.lane')!)
  const ghostX = () => { const g = host.querySelector<HTMLElement>('.drop-ghost'); return g ? parseFloat(g.style.getPropertyValue('--x')) : NaN }
  const scrollTo = (v: number) => { r.box.at = v; act(() => { el.dispatchEvent(new Event('scroll')) }) }
  const frame = () => act(() => { jest.advanceTimersByTime(16) })
  const done = () => { act(() => root.unmount()); host.remove(); r.restore() }
  return { ...r, host, card, ghostX, scrollTo, frame, done }
}

it("Q-25 — a 20-minute store: rail cells, the click grid, the form's clamp (Greptile #1150 P2)", async () => {
  const r = rig(0)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  try {
    // page.tsx returns <TodayScreen {...props} />; set the store's step and its pinned board clock before opening.
    const board: ReactElement<TodayProps> = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
    const step = 20
    const { hours } = board.props
    expect([hours.open, hours.close]).toEqual([420, 1320])
    // The real guard refuses Kenta's fixture 「終業」 at 21:30; extend only this case's shift to closing.
    const lanes = board.props.lanes.map((lane) => lane.group === 'staff' && lane.key === GYM.kenta
      ? { ...lane, window: { from: lane.window!.from, until: hours.close }, untilLabel: '22:00', items: lane.items.filter((item) => !(item.kind === 'absence' && item.title === '終業')) }
      : lane)
    // seedSpanIn reads standardSessionMin, not the menu duration; keep the 20-minute seed at 21:40.
    await act(async () => root.render(<BusinessSessionEdits>{cloneElement(board, { lanes, guard: { ...board.props.guard, bookingStepMin: step, standardSessionMin: step }, sell: { ...board.props.sell, nowMinute: 360 } })}</BusinessSessionEdits>))
    r.box.at = 0
    const rails = Array.from(host.querySelectorAll('.guard-placement-rail'))
    expect(rails.length).toBeGreaterThan(0)
    for (const rail of rails) {
      const starts = Array.from(rail.querySelectorAll<HTMLElement>('.guard-rail-cell[data-start]')).map((cell) => Number(cell.dataset.start))
      expect(starts).toEqual(Array.from({ length: 45 }, (_, k) => hours.open + k * step))
      expect([...starts.slice(0, 3), starts.at(-1)]).toEqual([420, 440, 460, 1300])
    }
    const card = host.querySelector<HTMLElement>('.lane[data-group="staff"] .track .event[data-book]:not(.cleanup)')!
    const lane = card.closest<HTMLElement>('.lane')!
    trackWide(900, lane) // one pixel per minute on the 07:00–22:00 axis
    const track = host.querySelector<HTMLElement>(`.lane[data-lane="${GYM.kenta}"] .track`)!
    const dialog = host.querySelector<HTMLDialogElement>('dialog[aria-labelledby="createTitle"]')!
    // jsdom has no native dialog methods; keep this shim on this mounted instance only.
    dialog.showModal = () => { dialog.open = true }
    dialog.close = () => { dialog.open = false }
    // Kenta now has a late shift; exercise the same off-hour grid inside his free 16:00 hour.
    const firstStart = 16 * 60 + 20
    act(() => { track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: firstStart - hours.open + 5 })) })
    // Keep the real guard: this off-hour-grid start asks for acknowledgment before opening the form.
    const placeHere = Array.from(host.querySelectorAll<HTMLButtonElement>('.guard-pop button')).find((button) => button.textContent?.trim() === 'この開始に配置')!
    expect(placeHere).toBeDefined()
    act(() => placeHere.click())
    expect({ open: dialog.open, advice: host.querySelector('.guard-pop')?.textContent }).toEqual({ open: true, advice: undefined })
    const duration = board.props.dialogs.create.menus[0]?.minutes ?? 60
    const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    expect(dialog.querySelector('.stepper b')!.textContent).toBe(`${time(firstStart)}–${time(firstStart + duration)}`)
    const later = () => act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="20分遅く"]')!.click())
    for (let i = 0; i < 40; i += 1) later()
    const afterForty = Math.min(hours.close - duration, firstStart + 40 * step)
    expect(dialog.querySelector('.stepper b')!.textContent).toBe(`${time(afterForty)}–${time(afterForty + duration)}`)
    // Finish any remaining distance, then click once past closing to retain the clamp assertion.
    for (let i = 0; i <= Math.ceil((hours.close - duration - afterForty) / step); i += 1) later()
    expect(dialog.querySelector('.stepper b')!.textContent).toBe(`${time(hours.close - duration)}–22:00`)
    expect([dialog.textContent!.includes('営業時間内'), dialog.textContent!.includes('営業時間を超えます')]).toEqual([true, false])
    act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="20分早く"]')!.click())
    expect(dialog.querySelector('.stepper b')!.textContent).toBe(`${time(hours.close - duration - step)}–21:40`)
    act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="作成をやめる"]')!.click())
    // 21:45 floors to 21:40 on the 20-minute grid; Kenta's last fixture booking ends at 21:30.
    act(() => { track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 885 })) })
    const placeNearClose = Array.from(host.querySelectorAll<HTMLButtonElement>('.guard-pop button')).find((button) => button.textContent?.trim() === 'この開始に配置')
    if (placeNearClose) act(() => placeNearClose.click())
    expect({ open: dialog.open, advice: host.querySelector('.guard-pop')?.textContent }).toEqual({ open: true, advice: undefined })
    // A fixed-30 form clamp would open at 21:30 instead: this assertion must catch it.
    expect(dialog.querySelector('.stepper b')!.textContent).toBe('21:40–22:00')
    act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="作成をやめる"]')!.click())
    // A real drag supplies the landing; the hold selector and aimed chip must resolve to that same drawn cell.
    act(() => { card.dispatchEvent(r.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(r.ev('pointermove', 520, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
    expect(host.querySelector('.drag-proxy.event')).not.toBeNull()
    const ghost = host.querySelector<HTMLElement>('.drop-ghost')!
    const landingMinute = hours.open + pct(ghost, '--x') / 100 * (hours.close - hours.open)
    expect(landingMinute).toBeCloseTo(440, 8)
    const start = Math.floor(landingMinute / step) * step
    const selector = `.guard-placement-rail[data-lane="${lane.dataset.lane}"] .guard-rail-cell[data-start="${start}"]`
    const cell = host.querySelector(selector)
    expect(cell).not.toBeNull()
    expect(host.querySelector('.guard-rail-cell.aimed')).toBe(cell)
    act(() => { window.dispatchEvent(r.ev('pointercancel', 520, 0)) })
  } finally {
    act(() => root.unmount())
    host.remove()
    r.restore()
  }
})

it('⚖ S26 Round F (Greptile P1) — MOUNTED: a MANUAL sideways scroll during a card drag (scrollLeft +60, one scroll event, one frame) moves the drag frame\'s span exactly as carrying the pointer 60 px further would', async () => {
  const m = await mountRigged(null)
  try {
    act(() => { m.card.dispatchEvent(m.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(m.ev('pointermove', 520, 1)) })
    m.frame()
    const before = m.ghostX()
    m.scrollTo(60) // trackpad / shift-wheel / scrollbar: no pointer move, no edge loop
    m.frame()
    const scrolled = m.ghostX()
    m.scrollTo(0) // the control, same gesture: no scroll, the pointer carried the same 60 px instead
    act(() => { window.dispatchEvent(m.ev('pointermove', 580, 1)) })
    m.frame()
    const carried = m.ghostX()
    expect([Number.isFinite(before), scrolled !== before, scrolled]).toEqual([true, true, carried])
    act(() => { window.dispatchEvent(m.ev('pointercancel', 580, 0)) })
  } finally {
    m.done()
  }
})

it('⚖ S26 Round F (Greptile P1) — MOUNTED: the RELEASE after a manual scroll lands where the frame showed (the drop span includes the +60)', async () => {
  const m = await mountRigged(null)
  try {
    const id = m.card.getAttribute('data-book')!
    const at = () => parseFloat(m.host.querySelector<HTMLElement>(`.lane .track .event[data-book="${id}"]:not(.drag-proxy)`)!.style.getPropertyValue('--x'))
    const home = at()
    act(() => { m.card.dispatchEvent(m.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(m.ev('pointermove', 520, 1)) })
    m.frame()
    const unscrolled = m.ghostX()
    m.scrollTo(60)
    m.frame()
    const shown = m.ghostX()
    act(() => { window.dispatchEvent(m.ev('pointerup', 520, 0)) })
    act(() => { jest.advanceTimersByTime(1000) })
    expect([shown !== unscrolled, at() !== home, at()]).toEqual([true, true, shown])
  } finally {
    m.done()
  }
})

it('⚖ S26 Round F (Greptile P1) — MOUNTED: the edge loop and the scroll listener do not double-count — after 3 edge frames (each followed by the browser\'s scroll event) the span equals a plain 3 × DRAG_EDGE_STEP_PX carry, not 2×', async () => {
  const m = await mountRigged(null)
  try {
    act(() => { m.card.dispatchEvent(m.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(m.ev('pointermove', 940, 1)) }) // the right edge zone
    for (let i = 0; i < 3; i++) {
      m.frame()
      act(() => { m.host.querySelector('.timeline-scroll')!.dispatchEvent(new Event('scroll')) }) // what the browser fires after each step
    }
    const edged = m.box.at
    act(() => { window.dispatchEvent(m.ev('pointermove', 500, 1)) }) // back where it started: dx is the scrolled distance alone
    m.frame()
    const viaEdge = m.ghostX()
    m.scrollTo(0)
    act(() => { window.dispatchEvent(m.ev('pointermove', 500 + 3 * DRAG_EDGE_STEP_PX, 1)) })
    m.frame()
    const once = m.ghostX()
    act(() => { window.dispatchEvent(m.ev('pointermove', 500 + 6 * DRAG_EDGE_STEP_PX, 1)) })
    m.frame()
    const twice = m.ghostX()
    expect([edged, viaEdge, viaEdge !== twice]).toEqual([3 * DRAG_EDGE_STEP_PX, once, true])
    act(() => { window.dispatchEvent(m.ev('pointercancel', 500, 0)) })
  } finally {
    m.done()
  }
})

it('⚖ S26 Round E3b — MOUNTED 10:00–21:30 (テスト自由が丘店, its recorded policy widened to 21:30 for this test only): ruler 「10」…「20」 + the edge 「21:30」, no 「21」 column, gridlines on the whole 11.5-hour span', async () => {
  const saved = POLICIES[STORE.jiyugaoka].weekly_hours
  const day = { open: '10:00', close: '21:30' }
  POLICIES[STORE.jiyugaoka].weekly_hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  try {
    const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.jiyugaoka }) })
    await act(async () => root.render(<BusinessSessionEdits>{board}</BusinessSessionEdits>))
    const ruler = Array.from(host.querySelectorAll<HTMLElement>('.time-head .hours span'))
    expect(ruler.map((s) => s.textContent)).toEqual(['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21:30'])
    expect(ruler.map((s) => s.className)).toEqual([...Array(11).fill(''), 'edge']) // nothing 'off' inside the day; the close is the edge tick
    const last = ruler.at(-2)!
    expect(parseFloat(last.style.left) + parseFloat(last.style.width)).toBeCloseTo((660 / 690) * 100, 3) // 「20」 ends at 21:00 (660 of the 690 minutes)
    const timeline = host.querySelector<HTMLElement>('[style*="--hours"]')!
    expect([timeline.style.getPropertyValue('--hours'), timeline.style.getPropertyValue('--hour-lead')]).toEqual(['11.5', '']) // gridlines unchanged
  } finally {
    act(() => root.unmount())
    host.remove()
    POLICIES[STORE.jiyugaoka].weekly_hours = saved
  }
})

/** ⚖ Q-23 (S27) — A CANCELLED DRAG LEAVES NOTHING BEHIND. The round-1 rig (`rig(null)`: the track is jsdom's 0 wide,
 *  so a stretch travels nothing) on the gym's first staff card, with a probe on the session-edit provider so the
 *  test reads the staged state itself, not only the label. `wide` gives the track 600 px so a carry really lands. */
async function mountProbed(wide: boolean) {
  const r = rig(null)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const seen: { edits: ReturnType<typeof useSessionEdits> | null } = { edits: null }
  function Probe() { seen.edits = useSessionEdits(); return null }
  const board = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.gym }) })
  await act(async () => root.render(<BusinessSessionEdits><Probe />{board}</BusinessSessionEdits>))
  const first = host.querySelector<HTMLElement>('.lane[data-group="staff"] .track .event[data-book]:not(.cleanup)')!
  const id = first.getAttribute('data-book')!
  if (wide) trackWide(600, first.closest('.lane')!)
  const card = () => host.querySelector<HTMLElement>(`.lane[data-group="staff"] .track .event[data-book="${id}"]:not(.drag-proxy)`)!
  const lines = () => Array.from(host.querySelectorAll(`.lane .track .event[data-book="${id}"]:not(.drag-proxy) .e-time`)).map((n) => n.textContent)
  const staged = () => ({ staff: seen.edits!.moves[id] ?? null, bed: seen.edits!.bedMoves[id] ?? null, pending: seen.edits!.pending?.id ?? null })
  const session = () => ({ moves: Object.keys(seen.edits!.moves), bedMoves: Object.keys(seen.edits!.bedMoves), pending: seen.edits!.pending, confirm: (host.textContent ?? '').includes('この内容で確定') })
  const stretch = () => {
    act(() => { card().dispatchEvent(r.ev('pointerdown', 595, 1)) }) // 5 px inside the right edge: a resize
    act(() => { window.dispatchEvent(r.ev('pointermove', 625, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
  }
  const done = () => { act(() => root.unmount()); host.remove(); r.restore() }
  const edits = () => seen.edits!
  return { ...r, host, id, card, lines, staged, session, stretch, edits, done }
}

it('⚖ Q-23 (S27) — MOUNTED: a stretch cancelled by window blur puts the label back (「07:00〜」) and leaves no staged entry for the card', async () => {
  const m = await mountProbed(false)
  try {
    const rest = m.lines()
    m.stretch()
    const mid = m.lines()
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect([rest, mid[0] !== rest[0], m.lines(), m.staged()]).toEqual([['07:00〜'], true, rest, { staff: null, bed: null, pending: null }])
  } finally {
    m.done()
  }
})

it('⚖ Q-23 (S27) — MOUNTED: a stretch released with no change (pointerup over the home span) puts the label back and leaves no staged entry', async () => {
  const m = await mountProbed(false)
  try {
    const rest = m.lines()
    m.stretch()
    act(() => { window.dispatchEvent(m.ev('pointerup', 625, 0)) })
    act(() => { jest.advanceTimersByTime(1000) })
    expect([rest, m.lines(), m.staged()]).toEqual([['07:00〜'], rest, { staff: null, bed: null, pending: null }])
  } finally {
    m.done()
  }
})

it('⚖ Q-23 (S27) — MOUNTED: an ALREADY-STAGED card dragged again and cancelled keeps the earlier staged span and its label', async () => {
  const m = await mountProbed(true)
  try {
    const rest = m.lines()
    act(() => { m.card().dispatchEvent(m.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(m.ev('pointermove', 780, 1)) }) // +280 px on the 600 px track = 14:00, a free start on this lane (07:30–13:30 refuse)
    act(() => { jest.advanceTimersByTime(16) })
    act(() => { window.dispatchEvent(m.ev('pointerup', 780, 0)) })
    act(() => { jest.advanceTimersByTime(1000) })
    const first = m.staged()
    const firstLines = m.lines()
    expect([first.staff !== null, first.pending, firstLines[0] !== rest[0]]).toEqual([true, m.id, true]) // a real stage, never a vacuous pass
    act(() => { m.card().dispatchEvent(m.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(m.ev('pointermove', 560, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect([m.staged(), m.lines()]).toEqual([first, firstLines])
  } finally {
    m.done()
  }
})

it('⚖ Q-23 (S27) step 4 — MOUNTED: after a blur-cancelled stretch AND a no-change release the session holds no edit at all (no moves key, no bed key, no pending, no 「この内容で確定」)', async () => {
  const m = await mountProbed(false)
  try {
    const before = m.session()
    m.stretch()
    act(() => { window.dispatchEvent(new Event('blur')) })
    act(() => { jest.advanceTimersByTime(1000) })
    const afterCancel = m.session()
    m.stretch()
    act(() => { window.dispatchEvent(m.ev('pointerup', 625, 0)) })
    act(() => { jest.advanceTimersByTime(1000) })
    const none = { moves: [], bedMoves: [], pending: null, confirm: false }
    expect([before, afterCancel, m.session()]).toEqual([none, none, none])
  } finally {
    m.done()
  }
})

// ⚖ Q-23 (S27) — THE RESTORE BRANCHES, made real. No reachable drag path writes `moves` / `bedMoves` mid-gesture, so
// these write them through the provider's own setters while a real gesture is held, then cancel through the real
// blur handler: `restoreSides` must put back the pointerdown entries whatever happened meanwhile. STAFF SIDE ONLY:
// the gym rig draws no bed lane (`.lane[data-group="beds"]` is absent), so a bed entry has no real lane to name here.
it('⚖ Q-23 (S27) — the restore branches: an UNSTAGED card staged mid-drag and cancelled has no key (the delete branch)', async () => {
  const m = await mountProbed(false)
  try {
    const lane = m.card().closest('.lane')!.getAttribute('data-lane')!
    m.stretch()
    act(() => { m.edits().setMoves((was) => ({ ...was, [m.id]: { laneKey: lane, x: 40, w: 5 } })) })
    const mid = m.staged()
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect([mid.staff, m.staged()]).toEqual([{ laneKey: lane, x: 40, w: 5 }, { staff: null, bed: null, pending: null }])
  } finally {
    m.done()
  }
})

it('⚖ Q-23 (S27) — the restore branches: a card STAGED at span A by a real landing, re-staged to span B mid-drag and cancelled, gets span A back (the write branch)', async () => {
  const m = await mountProbed(true)
  try {
    act(() => { m.card().dispatchEvent(m.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(m.ev('pointermove', 780, 1)) }) // +280 px = 14:00, the first free start (see above)
    act(() => { jest.advanceTimersByTime(16) })
    act(() => { window.dispatchEvent(m.ev('pointerup', 780, 0)) })
    act(() => { jest.advanceTimersByTime(1000) })
    const a = m.staged()
    act(() => { m.card().dispatchEvent(m.ev('pointerdown', 500, 1)) })
    act(() => { window.dispatchEvent(m.ev('pointermove', 520, 1)) })
    act(() => { jest.advanceTimersByTime(16) })
    act(() => { m.edits().setMoves((was) => ({ ...was, [m.id]: { ...was[m.id], x: 70 } })) })
    const b = m.staged()
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect([a.staff !== null && a.pending === m.id, a.staff?.x !== 70, b.staff?.x, m.staged()]).toEqual([true, true, 70, a])
  } finally {
    m.done()
  }
})
