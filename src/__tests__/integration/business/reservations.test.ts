/**
 * 予約一覧 (WO-3) — display-tier proofs for the transplanted screen.
 *
 * WHAT THIS SUITE IS FOR, in one line each:
 *
 *  1. the fixture world stays POSSIBLE once three more bookings live in it —
 *     across every day now, not just today (WO-2's invariants stop at the board)
 *  2. the lifecycle word is DERIVED from the fields the board paints from, so a
 *     row cannot read 確定 on this screen and 来店なし on that one
 *  3. the tiles, the queue and the 状態 filter are ONE derivation — canon's
 *     「数字はどこにも直書きしない」, asserted rather than reviewed
 *  4. every countdown is measured against the ONE pinned world clock (13:24)
 *  5. the screen is still populated 30 and 400 days from now (⚖ L-6)
 *
 * No renderer is available in territory (react-dom is off the import
 * allowlist), so the screen is asserted through the PROPS its server page
 * produces and through the pure derivations both passes share — the same shape
 * the Today board's suite uses.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: jest.fn(),
}))
// Pass-through mock with ONE seam: the real data door, plus a switch the M-87
// test can flip to make a single read throw. Every other test in this file runs
// the genuine implementations.
let mockFailRead = false
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return {
    ...actual,
    readReservationPlanes: (...args: unknown[]) =>
      mockFailRead ? Promise.reject(new Error('read failed')) : actual.readReservationPlanes(...args),
  }
})

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { appointments, staff, staffAssignments, staffCards, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { reservations } from '@/business/lib/fixtures-reservations'
import { decisions, operatingHours, boardNow, shifts, sellSlots, register } from '@/business/lib/fixtures-today'
import { jstDayKey, jstMinuteOfDay } from '@/business/lib/clock'
import { dayTotals } from '@/business/lib/today-board'
import {
  LIFECYCLE,
  deadlineOf,
  decisionKindOf,
  eligibilityOf,
  flagsOf,
  isQueued,
  lifecycleOf,
  matchesFilters,
  safeSlotsFor,
  shiftWarningOf,
  sourceOf,
  spanText,
  type ReservationFilters,
} from '@/business/lib/reservations'
import ReservationsPage from '@/app/[locale]/(business)/business/reservations/page'
import { reservationsPropsFor } from '@/app/[locale]/(business)/business/reservations/reservations-props'
import { listStoreOptions } from '@/business/lib/data'
import {
  ReservationsScreen,
  decorate,
  type ReservationRow,
  type ReservationsProps,
} from '@/app/[locale]/(business)/business/reservations/ReservationsScreen'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

function serviceStub(byTable: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({ select: () => chain(r), eq: () => chain(r), maybeSingle: async () => r })
  return { from: (table: string) => chain(byTable[table] ?? { data: null, error: null }) }
}

/** An admitted 経営メンバー of a granted tenant — the play-phase persona. Only
 *  the session and the two admission reads are stubbed; every value the screen
 *  shows still comes from the real fixtures through the real data door. */
beforeEach(() => {
  service.mockReturnValue(
    serviceStub({
      business_workspace_grants: { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null },
      profiles: { data: { customer_id: 'biz-1', is_management: true }, error: null },
    }),
  )
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
})

/** The props the screen is handed — the page returns an element, and there is
 *  no renderer in territory. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function screenProps(node: any): ReservationsProps | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === ReservationsScreen) return node.props
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = screenProps(kid)
    if (hit) return hit
  }
  return null
}

const load = async (store?: string) =>
  screenProps(
    await ReservationsPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve(store ? { store } : {}),
    }),
  )!

/** The MERGED payload. Since ⚖ Liam 2026-08-20 すべての店舗 left the sidebar
 *  switcher and every screen opens on the operator's own store, no URL reaches
 *  the cross-store view any more — so it is asked for directly, with the lens
 *  the page can no longer be handed. The depth behind it is kept rather than
 *  deleted: reconnect restores the lens for a viewAll-capable actor, and until
 *  then this is what proves the cross-store payload still holds. */
const loadAll = async () =>
  reservationsPropsFor('ja', { viewAll: true }, false, undefined, await listStoreOptions())

/** The decorated rows the screen itself works from. */
const decorated = (p: ReservationsProps) => p.rows.map((r) => decorate(r, p.boardNow, p.closeMinute))
const byId = (p: ReservationsProps, id: string) => decorated(p).find((r) => r.id === id)!

const FILTERS: ReservationFilters = { search: '', date: 'all', status: 'all', source: 'all' }

// ═══════════════════════════════════════════════════════════════════════════
// 1. The fixture world is still operationally possible — on EVERY day
// ═══════════════════════════════════════════════════════════════════════════

describe('the booking calendar stays possible with the 予約 rows in it (⚖ 8/9)', () => {
  const rows = () => appointments().filter((a) => a.status !== 'cancelled')
  const pending = new Set(reservations.filter((r) => r.pending).map((r) => r.appointment_id))
  const shiftOf = (id: string) => shifts.find((s) => s.staff_id === id) ?? null

  it('every booking sits inside the store opening hours', () => {
    for (const a of rows()) {
      expect(jstMinuteOfDay(a.starts_at)).toBeGreaterThanOrEqual(operatingHours.open)
      expect(jstMinuteOfDay(a.ends_at)).toBeLessThanOrEqual(operatingHours.close)
    }
  })

  it('no staff member holds two bookings at once, on any day', () => {
    const byStaff = new Map<string, Array<[number, number, number]>>()
    for (const a of rows()) {
      if (!a.staff_id) continue
      const span: [number, number, number] = [jstDayKey(a.starts_at), jstMinuteOfDay(a.starts_at), jstMinuteOfDay(a.ends_at)]
      byStaff.set(a.staff_id, [...(byStaff.get(a.staff_id) ?? []), span])
    }
    for (const [, spans] of byStaff) {
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const [d1, s1, e1] = spans[i]
          const [d2, s2, e2] = spans[j]
          if (d1 !== d2) continue
          expect(s1 >= e2 || s2 >= e1).toBe(true)
        }
      }
    }
  })

  it('no bed holds two bookings at once, on any day', () => {
    const byBed = new Map<string, Array<[number, number, number]>>()
    for (const a of rows()) {
      if (!a.resource_id) continue
      const span: [number, number, number] = [jstDayKey(a.starts_at), jstMinuteOfDay(a.starts_at), jstMinuteOfDay(a.ends_at)]
      byBed.set(a.resource_id, [...(byBed.get(a.resource_id) ?? []), span])
    }
    for (const [, spans] of byBed) {
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const [d1, s1, e1] = spans[i]
          const [d2, s2, e2] = spans[j]
          if (d1 !== d2) continue
          expect(s1 >= e2 || s2 >= e1).toBe(true)
        }
      }
    }
  })

  it('a staff member is only ever booked in a store they are assigned to', () => {
    const cards = new Set(staffCards.map((s) => s.id))
    const byUser = new Map(staffCards.filter((s) => s.user_id).map((s) => [s.user_id!, s.id]))
    const byEmail = new Map(staffCards.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s.id]))
    for (const a of rows()) {
      if (!a.staff_id || !a.store_id) continue
      const member = staff.find((m) => m.id === a.staff_id)!
      const card = cards.has(member.id)
        ? member.id
        : (byUser.get(member.id) ?? (member.email ? byEmail.get(member.email.toLowerCase()) : undefined))
      const stores = card ? staffAssignments[card] : undefined
      // No assignment rows = a floating card that works everywhere.
      if (stores && stores.length) expect(stores).toContain(a.store_id)
    }
  })

  it('an ACCEPTED booking never runs past its staff shift — only the pending request does, and it says so', () => {
    for (const a of rows()) {
      if (!a.staff_id) continue
      const shift = shiftOf(a.staff_id)
      expect(shift).not.toBeNull()
      const warning = shiftWarningOf('x', shift, jstMinuteOfDay(a.starts_at), jstMinuteOfDay(a.ends_at))
      if (pending.has(a.id)) {
        // The overrun IS the reason a human has to look at it (M-70's 勤務時間
        // fact). A pending request with nothing to warn about would make the
        // accept dialog's warning slot decorative.
        expect(warning).not.toBeNull()
      } else {
        expect(warning).toBeNull()
      }
    }
  })

  it('an unaccepted request paints no board card — it holds no floor', () => {
    for (const r of reservations.filter((x) => x.pending)) {
      expect(appointments().find((a) => a.id === r.appointment_id)!.board_state).toBeNull()
    }
  })

  it('予約番号 are human-shaped and unique (⚖ L-6, no UUID wreck)', () => {
    const numbers = appointments().map((a) => a.display_no)
    expect(new Set(numbers).size).toBe(numbers.length)
    for (const n of numbers) expect(n).toMatch(/^R-\d{4}$/)
  })

  it('every exception record points at a booking that exists', () => {
    const ids = new Set(appointments().map((a) => a.id))
    for (const r of reservations) expect(ids.has(r.appointment_id)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. The lifecycle word is derived, and it agrees with the board
// ═══════════════════════════════════════════════════════════════════════════

describe('lifecycle derivation', () => {
  const of = (id: string) => {
    const a = appointments().find((x) => x.id === id)!
    return lifecycleOf(a, reservations.find((r) => r.appointment_id === id) ?? null)
  }

  it.each([
    ['apt-21', 'cancelled'],
    ['apt-23', 'no_show'],
    ['apt-30', 'pending_accept'],
    ['apt-12', 'settled'],
    ['apt-25', 'awaiting_settlement'],
    ['apt-32', 'external'],
    ['apt-13', 'confirmed'],
  ])('%s reads %s', (id, word) => {
    expect(of(id)).toBe(word)
  })

  it('a terminal outcome beats provenance: an external booking nobody came to is 来店なし', () => {
    // apt-23's source IS 外部予約元, and the board paints it 来店なし. If
    // provenance won, the list would say 予約元で管理 over a card that says the
    // customer never arrived.
    expect(appointments().find((a) => a.id === 'apt-23')!.source).toMatch(/^外部予約元/)
    expect(of('apt-23')).toBe('no_show')
  })

  it('all seven canon words have a carrier in the fixture set', async () => {
    const words = new Set(decorated(await loadAll()).map((r) => r.lifecycle))
    expect([...words].sort()).toEqual(Object.keys(LIFECYCLE).sort())
  })

  it("the list's lifecycle never contradicts the board's card state", async () => {
    for (const r of decorated(await load()).filter((x) => x.isToday)) {
      const a = appointments().find((x) => x.id === r.id)!
      if (a.board_state === 'noshow') expect(r.lifecycle).toBe('no_show')
      if (r.lifecycle === 'cancelled' || r.lifecycle === 'pending_accept') expect(a.board_state).toBeNull()
      if (a.board_state === 'confirmed' || a.board_state === 'hold' || a.board_state === 'attention') {
        expect(['confirmed', 'awaiting_settlement', 'settled', 'external']).toContain(r.lifecycle)
      }
    }
  })

  it("本日 is the same number the board reports as 本日の予約件数", async () => {
    for (const store of [undefined, STORE_A, STORE_B]) {
      const p = store ? await load(store) : await loadAll()
      const rows = decorated(p)
      const todayTile = rows.filter((r) => r.isToday && r.lifecycle !== 'cancelled').length
      const boardCount = dayTotals(
        appointments().filter(
          (a) => jstDayKey(a.starts_at) === jstDayKey(new Date()) && (!store || a.store_id === store),
        ),
        register.refunds,
      ).count
      expect(todayTile).toBe(boardCount)
    }
  })

  it('担当変更あり is derived from the booking, never stored twice', () => {
    // apt-26 is the reassigned one; no fixture flag array carries the word.
    expect(appointments().find((a) => a.id === 'apt-26')!.reassigned_from).toBe('p-01')
    for (const r of reservations) expect(r.flags).not.toContain('担当変更あり')
    expect(flagsOf([], true, false)).toEqual(['担当変更あり'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Tiles ↔ queue ↔ rows ↔ filter are ONE derivation
// ═══════════════════════════════════════════════════════════════════════════

describe('要対応 is one predicate on four surfaces', () => {
  it('the queue is exactly the rows the predicate marks, in deadline order', async () => {
    const p = await load(STORE_A)
    const rows = decorated(p)
    const queue = rows.filter((r) => r.queued).sort((a, b) => a.deadlineMinute! - b.deadlineMinute!)
    expect(queue.length).toBe(5)
    expect(queue.map((r) => r.id)).toEqual(['apt-31', 'apt-26', 'apt-30', 'apt-27', 'apt-25'])
    for (const r of queue) expect(isQueued(r.lifecycle, r.deadlineMinute)).toBe(true)
  })

  it('the 状態=要対応 filter selects the queue and nothing else', async () => {
    const rows = decorated(await load(STORE_A))
    const filtered = rows.filter((r) => matchesFilters(r, { ...FILTERS, status: 'attention' }))
    expect(filtered.map((r) => r.id).sort()).toEqual(rows.filter((r) => r.queued).map((r) => r.id).sort())
  })

  it('最短期限 is the head of that same queue, overdue included', async () => {
    const rows = decorated(await load(STORE_A))
    const queue = rows.filter((r) => r.queued).sort((a, b) => a.deadlineMinute! - b.deadlineMinute!)
    expect(queue[0].deadlineMinute).toBe(12 * 60 + 30)
    expect(queue[0].overdue).toBe(true)
  })

  it('精算待ち counts the rows whose pill says 精算待ち', async () => {
    const rows = decorated(await load(STORE_A))
    expect(rows.filter((r) => r.lifecycle === 'awaiting_settlement').map((r) => r.id)).toEqual(['apt-25'])
  })

  it('a settled / cancelled / no-show / external row never reaches the queue, deadline or not', () => {
    for (const word of ['settled', 'cancelled', 'no_show', 'external'] as const) {
      expect(isQueued(word, 14 * 60)).toBe(false)
    }
    for (const word of ['pending_accept', 'confirmed', 'awaiting_settlement'] as const) {
      expect(isQueued(word, 14 * 60)).toBe(true)
      expect(isQueued(word, null)).toBe(false)
    }
  })

  it('each queue card asks for exactly one decision, and every kind has a carrier', async () => {
    const rows = decorated(await load(STORE_A)).filter((r) => r.queued)
    expect(rows.map((r) => r.kind).sort()).toEqual(['accept', 'change', 'escalate', 'open', 'settle'])
  })

  it('under the other store the queue is empty and says so rather than borrowing rows', async () => {
    const rows = decorated(await load(STORE_B))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((r) => r.queued)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. One world clock
// ═══════════════════════════════════════════════════════════════════════════

describe('every countdown is measured against the one pinned 13:24', () => {
  it('the screen is handed that clock, not a second one', async () => {
    const p = await load(STORE_A)
    expect(p.boardNow).toBe(boardNow)
    expect(p.boardNow).toBe(13 * 60 + 24)
  })

  it('a deadline behind the clock is 期限超過, and the span is the difference', async () => {
    const r = byId(await load(STORE_A), 'apt-31')
    expect(r.deadlineMinute).toBe(12 * 60 + 30)
    expect(r.overdue).toBe(true)
    expect(spanText(r.deadlineMinute! - boardNow)).toBe('54分')
    expect(r.allFlags[0]).toBe('期限超過')
  })

  it('a deadline ahead of it counts down, and carries no 期限超過', async () => {
    const r = byId(await load(STORE_A), 'apt-30')
    expect(r.deadlineMinute).toBe(14 * 60)
    expect(r.overdue).toBe(false)
    expect(spanText(r.deadlineMinute! - boardNow)).toBe('36分')
    expect(r.allFlags).not.toContain('期限超過')
  })

  it('精算期限 IS 閉店 — derived from the hours, stored nowhere', async () => {
    const p = await load(STORE_A)
    expect(reservations.find((r) => r.appointment_id === 'apt-25')!.deadline).toBeNull()
    expect(byId(p, 'apt-25').deadlineMinute).toBe(operatingHours.close)
    expect(deadlineOf('awaiting_settlement', { deadline: null }, 21 * 60)).toBe(21 * 60)
  })

  it('the two deadlines the board also carries agree with it to the minute', async () => {
    const p = await load(STORE_A)
    const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    for (const [id, decisionId] of [['apt-26', 'dec-recovery'], ['apt-27', 'dec-absence']] as const) {
      const shown = clock(byId(p, id).deadlineMinute!)
      expect(decisions.find((d) => d.id === decisionId)!.deadline).toBe(`${shown}まで`)
    }
  })

  it('hours swallow a zero-minute remainder', () => {
    expect(spanText(120)).toBe('2時間')
    expect(spanText(-95)).toBe('1時間35分')
    expect(spanText(9)).toBe('9分')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. The screen's own bands
// ═══════════════════════════════════════════════════════════════════════════

describe('the transplanted bands are populated from fixtures', () => {
  it('the window is today plus six days, and nothing behind it', async () => {
    const todayKey = jstDayKey(new Date())
    for (const r of decorated(await load())) {
      expect(r.dayKey).toBeGreaterThanOrEqual(todayKey)
      expect(r.dayKey).toBeLessThan(todayKey + 7)
    }
  })

  it('every list column has a value on every row — no blank cells', async () => {
    for (const r of decorated(await load())) {
      expect(r.dateLabel).not.toBe('')
      expect(r.timeLabel).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/)
      expect(r.customerName).not.toBe('')
      expect(r.menuName).not.toBe('')
      expect(r.staffName).not.toBe('')
      expect(r.resourceName).not.toBe('')
      expect(r.sourceLabel).not.toBe('')
      expect(r.priceLabel).not.toBe('')
      expect(LIFECYCLE[r.lifecycle]).toBeDefined()
    }
  })

  it('a booking with no agreed price states it rather than showing ¥0', async () => {
    // apt-09 lost its store AND its price in a pre-repair import — storeless,
    // so only the merged payload carries it.
    expect(byId(await loadAll(), 'apt-09').priceLabel).toBe('受付価格の記録なし')
  })

  it('a booking with no bed says 【未定】 rather than guessing one', async () => {
    expect(byId(await load(), 'apt-27').resourceName).toBe('【未定】')
  })

  it('the inspector has its 価格の証拠, 根拠 and 操作履歴 inputs', async () => {
    const r = byId(await load(STORE_A), 'apt-30')
    expect(r.priceLabel).toBe('¥6,600')
    expect(r.currentPriceLabel).toBe('¥6,600')
    expect(r.eligibility).not.toBe('')
    expect(r.proof.length).toBeGreaterThan(10)
    expect(r.history.length).toBeGreaterThan(0)
    // A booking nobody touched carries no history and the screen says so —
    // never an invented 「作成しました」 row.
    expect(byId(await load(STORE_A), 'apt-15').history).toEqual([])
  })

  it('本人関係 lists only the parties that DEVIATE (⚖ cut #7)', async () => {
    // apt-13 is 代官山's — the merged payload is the only one holding all three.
    const p = await loadAll()
    // cus-03 has a 保護者 and a 支払者, cus-06 a サービス対象; cus-01 is her own
    // everything and her row shows the 顧客 line alone.
    expect(byId(p, 'apt-13').party.map((x) => x.role)).toEqual(['保護者', '支払者'])
    expect(byId(p, 'apt-30').party.map((x) => x.role)).toEqual(['サービス対象'])
    expect(byId(p, 'apt-15').party).toEqual([])
  })

  it('the external row is the readonly one, and it is the only one', async () => {
    const rows = decorated(await load())
    expect(rows.filter((r) => r.lifecycle === 'external').map((r) => r.id)).toEqual(['apt-32'])
    expect(byId(await load(), 'apt-32').sourceLabel).toBe('外部予約元')
  })

  it('the 要対応 evidence comes from the planes the board already carries', async () => {
    const p = await load(STORE_A)
    // 勤務不可 — from the absence record.
    expect(byId(p, 'apt-27').staffUnavailable).toBe(true)
    expect(byId(p, 'apt-29').staffUnavailable).toBe(false)
    // レジ取引 — from the register plane, naming the booking the terminal holds.
    // RENEGOTIATED (cycle 8): `terminal_held` became a LIST when the Today stack
    // landed, so the row is looked up by the booking it names rather than read
    // off the plane as a single object — which is the same correction the page's
    // own `registerEvidence` needed, and pinning it by index would hide that.
    const heldOnApt25 = register.terminal_held.find((t) => t.appointment_id === 'apt-25')!
    expect(heldOnApt25).toBeDefined()
    expect(byId(p, 'apt-25').txDetail).toContain(heldOnApt25.idempotency_id)
    expect(byId(p, 'apt-12').txNote).toBe('レジで精算済み')
    // 勤務時間 — from the shift plane.
    expect(byId(p, 'apt-30').shiftWarning).toBe('見本 しろう 10:00–18:00・この予約は30分超過')
    // 空き枠候補 — from the 販売可能枠 plane.
    expect(p.slots.length).toBe(sellSlots.length)
  })

  it('the 変更 dialog only offers slots long enough to hold the treatment', () => {
    // Both fixture slots run 60 minutes.
    expect(safeSlotsFor(sellSlots, 60)).toHaveLength(2)
    expect(safeSlotsFor(sellSlots, 90)).toHaveLength(0)
  })

  it('a 空き枠候補 carries NO date — it is offered on the booking’s own day', async () => {
    // Caught in the visual gate: dated with "today", the screen proposed moving
    // a booking two days out to this afternoon, which is a different
    // appointment rather than a change. The slots are a daily shape.
    const p = await load(STORE_A)
    for (const s of p.slots) {
      expect(Object.keys(s).sort()).toEqual(['end', 'id', 'resourceName', 'staffName', 'start'])
    }
  })

  it('受付元 labels and their filter groups come from the booking source', () => {
    expect(sourceOf('Reserve #357552', true)).toMatchObject({ label: 'Reserveリクエスト', group: 'reserve' })
    expect(sourceOf('Reserve #357552', false)).toMatchObject({ label: 'Reserve', group: 'reserve' })
    expect(sourceOf('電話予約 #357540', false)).toMatchObject({ label: '電話予約', group: 'store' })
    expect(sourceOf('店頭受付 #357498', false)).toMatchObject({ label: '店頭受付', group: 'store' })
    expect(sourceOf('外部予約元 #357505', false)).toMatchObject({ label: '外部予約元', group: 'external' })
  })

  it('価格条件 reads strongest-first, the same order the board colours by', () => {
    expect(eligibilityOf({ vip: true, ticket_balance: 4 }, 'reserve')).toBe('VIP / 自動調整対象外')
    expect(eligibilityOf({ vip: false, ticket_balance: 4 }, 'reserve')).toBe('回数券 / 自動調整対象外')
    expect(eligibilityOf({ vip: false, ticket_balance: null }, 'reserve')).toBe('単発オンライン / 対象')
    expect(eligibilityOf({ vip: false, ticket_balance: null }, 'store')).toBe('店頭受付 / 対象')
    expect(eligibilityOf({ vip: true, ticket_balance: 4 }, 'external')).toBe('外部予約元 / 自動調整対象外')
  })

  it('the primary action is read from the state, never from a booking number', () => {
    expect(decisionKindOf('confirmed', ['担当変更が必要（安全な候補なし）'])).toBe('escalate')
    expect(decisionKindOf('confirmed', ['変更希望あり'])).toBe('change')
    expect(decisionKindOf('pending_accept', [])).toBe('accept')
    expect(decisionKindOf('awaiting_settlement', [])).toBe('settle')
    expect(decisionKindOf('confirmed', [])).toBe('open')
  })

  it('the search covers the four fields canon names', async () => {
    const rows = decorated(await load(STORE_A))
    const hits = (q: string) => rows.filter((r) => matchesFilters(r, { ...FILTERS, search: q })).length
    expect(hits('R-4830')).toBe(1)
    expect(hits('見本 かえる')).toBeGreaterThan(0)
    expect(hits('テスト整体')).toBeGreaterThan(0)
    expect(hits('見本 しろう')).toBeGreaterThan(0)
    expect(hits('__一致なし__')).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Store isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('the store lens', () => {
  it('drops the other store, and any storeless booking, under a clamp', async () => {
    // ⚖ 8/20 data-truth: the demo world no longer holds a storeless row. The
    // null-store clamp is asserted at the DOOR, where it lives and where a
    // synthetic row can exercise it (foundation.test.ts, 'a single-store lens
    // drops the other store AND any storeless booking'); what this test still
    // owns is the OTHER store, which the screen must never carry.
    const clamped = decorated(await load(STORE_A)).map((r) => r.id)
    const all = decorated(await loadAll()).map((r) => r.id)
    expect(clamped).not.toContain('apt-13') // 代官山
    expect(all).toContain('apt-13')
    expect(all.length).toBeGreaterThan(clamped.length)
  })

  it("keeps another store's NAME out of the payload under a clamp (isolation law)", async () => {
    const p = await load(STORE_A)
    expect(p.rows.every((r) => r.storeLabel === null)).toBe(true)
    expect(JSON.stringify(p.rows)).not.toContain('テスト代官山店')
    // Under viewAll the label IS the point: every row names its own store, and
    // none of them is left unlabelled. (The 「店舗未設定」 fallback is still in
    // the page for a null store_id; ⚖ 8/20 removed the demo-world row that
    // exercised it, because a booking no store owns is an impossible state.)
    const all = await loadAll()
    expect(all.rows.every((r) => r.storeLabel != null && r.storeLabel !== '店舗未設定')).toBe(true)
    expect(all.rows.find((r) => r.id === 'apt-12')!.storeLabel).toBe('テスト銀座店')
    expect(all.rows.find((r) => r.id === 'apt-13')!.storeLabel).toBe('テスト代官山店')
  })

  it('gates itself: a denied session 404s the page, not just the layout', async () => {
    supabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } })
    await expect(load()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. M-87 — a failed read leaves no numbers behind
// ═══════════════════════════════════════════════════════════════════════════

describe('読み込み失敗', () => {
  /** Shallow render: function components are invoked, text is collected. Enough
   *  for a static branch with no hooks, and it needs no react-dom. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (node == null || node === false) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join(' ')
    if (typeof node.type === 'function') return textOf(node.type(node.props))
    return textOf(node.props?.children)
  }

  it('replaces the panels with one strip and drops every figure to 「—」', () => {
    const text = textOf(ReservationsScreen({ failed: true, locale: 'ja' }))
    expect(text).toContain('データを読み込めませんでした')
    expect(text).toContain('この画面の数字は使わないでください')
    expect(text).toContain('—')
    // Not one derived figure survives the failure.
    expect(text).not.toMatch(/\d+件/)
    expect(text).not.toMatch(/¥[\d,]+/)
  })

  it('the page falls into that branch rather than throwing at the route', async () => {
    mockFailRead = true
    try {
      const node = await ReservationsPage({
        params: Promise.resolve({ locale: 'ja' }),
        searchParams: Promise.resolve({}),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((node as any).props).toMatchObject({ failed: true })
    } finally {
      mockFailRead = false
    }
  })

  it('the admission 404 is NOT swallowed by that branch', async () => {
    // notFound() throws too. If the catch-all ate it, a denied session would be
    // shown the screen chrome instead of a 404 — the show-and-refuse the
    // isolation law forbids.
    supabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } })
    await expect(
      ReservationsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. The L-6 promise
// ═══════════════════════════════════════════════════════════════════════════

describe('the screen survives real time passing (⚖ L-6)', () => {
  it.each([30, 400])('is still fully populated %i days from now', async (days) => {
    jest.setSystemTime(new Date(Date.now() + days * 86_400_000))
    const p = await load(STORE_A)
    const rows = decorated(p)
    expect(rows.length).toBeGreaterThan(8)
    expect(rows.filter((r) => r.queued).length).toBe(5)
    expect(rows.filter((r) => r.isToday).length).toBeGreaterThan(0)
    expect(new Set(rows.map((r) => r.lifecycle)).size).toBeGreaterThanOrEqual(5)
    jest.setSystemTime(new Date('2026-08-19T00:00:00Z'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. Client transitions (⚖ L-7) — the shapes the screen commits
// ═══════════════════════════════════════════════════════════════════════════

describe('the canon client transitions move the row, the queue and the tiles together', () => {
  const apply = (row: ReservationRow, patch: Partial<ReservationRow>, p: ReservationsProps) =>
    decorate({ ...row, ...patch }, p.boardNow, p.closeMinute)

  it('受付 → 確定 clears the deadline, so the row leaves the queue', async () => {
    const p = await load(STORE_A)
    const before = byId(p, 'apt-30')
    expect(before.queued).toBe(true)
    const after = apply(before, { lifecycle: 'confirmed', deadline: null }, p)
    expect(after.lifecycle).toBe('confirmed')
    expect(after.queued).toBe(false)
  })

  it('記録 → 来店済み moves it to 精算待ち, where the deadline becomes 閉店', async () => {
    const p = await load(STORE_A)
    const after = apply(byId(p, 'apt-29'), { lifecycle: 'awaiting_settlement', deadline: null }, p)
    expect(after.queued).toBe(true)
    expect(after.deadlineMinute).toBe(p.closeMinute)
    expect(after.kind).toBe('settle')
  })

  it('記録 → キャンセル / 無断キャンセル takes it out of the queue and off the 本日 count', async () => {
    const p = await load(STORE_A)
    for (const word of ['cancelled', 'no_show'] as const) {
      const after = apply(byId(p, 'apt-29'), { lifecycle: word, deadline: null }, p)
      expect(after.queued).toBe(false)
      expect(LIFECYCLE[after.lifecycle].tone).toBe('alert')
    }
  })

  it('変更 drops 変更希望あり and picks up 担当変更あり when the staff changed', async () => {
    const p = await load(STORE_A)
    const before = byId(p, 'apt-31')
    expect(before.allFlags).toContain('変更希望あり')
    const after = apply(
      before,
      { lifecycle: 'confirmed', deadline: null, flags: [], reassigned: true, staffName: '見本 しろう' },
      p,
    )
    expect(after.allFlags).toEqual(['担当変更あり'])
    expect(after.queued).toBe(false)
  })
})
