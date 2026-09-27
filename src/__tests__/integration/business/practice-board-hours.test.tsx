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
    // ⚖ §v11 V11-3 — the gym closes no weekday: its month legend's item is 「定休日なし」 alone.
    act(() => host.querySelector<HTMLButtonElement>('button.day-label')!.click())
    const legend = Array.from(host.querySelectorAll('.cal-legend span')).map((s) => s.textContent)
    expect([legend.includes('定休日なし'), legend.some((t) => t?.startsWith('定休＝'))]).toEqual([true, false])
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
