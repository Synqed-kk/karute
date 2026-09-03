/**
 * 受信トレイ — the transplanted room's pins.
 *
 * THE ONE THING THIS SUITE IS FOR: this room restates almost nothing. Its
 * deadlines are 予約一覧's, its statuses are 今日の運営's 次に決めること cards,
 * its booking lines are the appointments every other room paints, its 履歴 is
 * those bookings' own 操作履歴, and its 連絡同意 is the 顧客台帳's — in the 顧客
 * screen's own words. Every one of those is asserted as an EQUALITY BETWEEN
 * SURFACES rather than a spot-check, because a message desk that disagrees with
 * the booking desk about a deadline is worse than no message desk at all.
 *
 * Second job: SENDING IS A WRITE and this room does not have one. Both canon
 * actions ship refused, the refusals change nothing, and the reasons are on
 * screen before anyone reaches for the control.
 *
 * Third job: the boundaries — the store isolation law on the thread list in
 * BOTH directions, the ⚖ page-scroll ruling on every wrapper, the sibling-sheet
 * fence derived from the neighbours' own sheets, and the room at 60+ threads.
 *
 * NOTE ON RENDER SMOKES: react-dom is deliberately OFF territory's import
 * allowlist (business-isolation.test.ts), so a section is smoke-tested by
 * asserting the props the screen is handed for it — the technique every other
 * business suite uses. The pixels are proven by the deployed real-browser pass
 * in the room's evidence folder.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { jstDayKey, jstMinuteOfDay } from '@/business/lib/clock'
import { appointments, customers, menus, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { threads as threadPlane, type FixtureThread } from '@/business/lib/fixtures-inbox'
import { auditTrail, reservations } from '@/business/lib/fixtures-reservations'
import { boardNow, decisions, operatingHours, type FixtureDecision } from '@/business/lib/fixtures-today'
import {
  buildThreads,
  channelStates,
  COUNTER_FILTER,
  DELIVERY_WORD,
  FILTERS,
  isFailedDelivery,
  isUsable,
  matchesFilter,
  recommendedChannel,
  STATUS_LABEL,
  summarize,
  SUMMARY_STATS,
  threadStore,
  type InboxSummary,
  type ThreadInput,
  type ThreadModel,
} from '@/business/lib/inbox'
import { customerStoreAffiliation, hhmm } from '@/business/lib/today-board'
import { deadlineOf, lifecycleOf } from '@/business/lib/reservations'
import { consentLabel } from '@/app/[locale]/(business)/business/customers/CustomersScreen'
import InboxPage from '@/app/[locale]/(business)/business/inbox/page'
import { InboxScreen, type InboxProps } from '@/app/[locale]/(business)/business/inbox/InboxScreen'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

function serviceStub(fallback: unknown, byTable: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({
    select: () => chain(r),
    eq: () => chain(r),
    maybeSingle: async () => r,
  })
  return { from: (table: string) => chain(table in byTable ? byTable[table] : fallback) }
}

/** The props a page hands its screen — the page returns an element tree and no
 *  renderer is available in territory (see the header). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function propsOf<T>(node: any, screen: unknown): T | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === screen) return node.props as T
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = propsOf<T>(kid, screen)
    if (hit) return hit
  }
  return null
}

const room = async (q: { store?: string } = {}) =>
  propsOf<InboxProps>(
    await InboxPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve(q) }),
    InboxScreen,
  )!

/** Pin the render clock. Only the zero-argument construction is faked; the
 *  calendar arithmetic needs real `new Date(iso)` AND the statics. */
const RealDate = Date
function pin(iso: string): () => void {
  const at = new RealDate(iso)
  const stub = function (this: unknown, ...args: unknown[]) {
    return args.length === 0 ? new RealDate(at) : new RealDate(...(args as [string]))
  } as unknown as DateConstructor
  stub.UTC = RealDate.UTC
  stub.parse = RealDate.parse
  stub.now = () => at.getTime()
  globalThis.Date = stub
  return () => {
    globalThis.Date = RealDate
  }
}

const ROOM_DIR = 'src/app/[locale]/(business)/business/inbox'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/InboxScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/inbox.css`), 'utf8')
const PAGE_SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/page.tsx`), 'utf8')
/** The prop assembly, extracted out of the page so the evidence harness renders
 *  the SAME assembly the route does (the replica-drift fix). Pins that used to
 *  read the page's body read this file now. */
const PROPS_SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/inbox-props.ts`), 'utf8')
const LIB = readFileSync(join(process.cwd(), 'src/business/lib/inbox.ts'), 'utf8')
const PLANE_SRC = readFileSync(join(process.cwd(), 'src/business/lib/fixtures-inbox.ts'), 'utf8')
const CUSTOMERS_SRC = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(business)/business/customers/CustomersScreen.tsx'),
  'utf8',
)

/** Source pins read CODE, not prose. Every one of these files documents the
 *  rule it obeys in a comment that names the very thing the pin forbids
 *  ("no max-height", "no toast"), so a pin that greps the raw file is true for
 *  the wrong reason — and would go green on a file that only TALKS about the
 *  rule. Comments come off first. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const SRC_CODE = codeOf(SRC)
const CSS_CODE = codeOf(CSS)
const PLANE_CODE = codeOf(PLANE_SRC)
const PAGE_CODE = codeOf(PAGE_SRC)
const PROPS_CODE = codeOf(PROPS_SRC)

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })

/** The page's own input, rebuilt so the derivation can be driven directly at
 *  any lens and any roster size without a render. */
function inputFor(store: string | null, override: Partial<ThreadInput> = {}): ThreadInput {
  const rows = appointments().filter((a) => store === null || a.store_id === store)
  return {
    threads: threadPlane,
    customers,
    appointments: rows,
    menus: menus.filter((m) => store === null || m.store_id === null || m.store_id === store),
    reservations,
    decisions: decisions.filter((d) => store === null || d.store_id === store),
    auditTrail,
    nowMinute: boardNow,
    closeMinute: operatingHours.close,
    dayLabel: (iso) => fmtDay.format(new Date(iso)),
    minuteOf: (iso) => jstMinuteOfDay(iso),
    ...override,
  }
}

const build = (store: string | null, override: Partial<ThreadInput> = {}) =>
  buildThreads(inputFor(store, override))
const byId = (rows: ThreadModel[], id: string) => rows.find((t) => t.id === id)!

beforeEach(() => {
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
  service.mockReturnValue(
    serviceStub(
      { data: null, error: null },
      {
        business_workspace_grants: { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null },
        profiles: { data: { customer_id: 'biz-1', is_management: false }, error: null },
      },
    ),
  )
})

// ── 1. the plane law: it states nothing the world already states ────────────

describe('the message plane borrows and never restates', () => {
  const hasDecision = (t: FixtureThread) =>
    t.appointment_id !== null && decisions.some((d) => d.appointment_id === t.appointment_id)
  const hasRecord = (t: FixtureThread) =>
    t.appointment_id !== null && reservations.some((r) => r.appointment_id === t.appointment_id)

  it('a thread whose booking has a 次に決めること card states NO delivery verdict of its own', () => {
    for (const t of threadPlane) {
      if (hasDecision(t)) {
        expect({ id: t.id, state: t.delivery_state, detail: t.delivery_detail }).toEqual({
          id: t.id,
          state: null,
          detail: null,
        })
      } else {
        // …and the ones with no card DO carry one, so the pin is not just
        // "everything is null".
        expect(t.delivery_state).not.toBeNull()
      }
    }
    expect(threadPlane.filter(hasDecision).length).toBeGreaterThan(0)
    expect(threadPlane.filter((t) => !hasDecision(t)).length).toBeGreaterThan(0)
  })

  it('a thread with a decision or a 予約一覧 row states NO 証跡 of its own', () => {
    for (const t of threadPlane) {
      if (hasDecision(t) || hasRecord(t)) expect(t.source_proof).toBeNull()
      else expect(t.source_proof).not.toBeNull()
    }
    expect(threadPlane.filter((t) => t.source_proof !== null)).toHaveLength(1)
  })

  it('a booking-backed thread states NO deadline of its own', () => {
    for (const t of threadPlane) {
      if (t.appointment_id) expect(t.due).toBeNull()
      else expect(t.due).not.toBeNull()
    }
  })

  it('the plane stores no consent, no customer name and no store', () => {
    expect(PLANE_CODE).not.toMatch(/consent\s*:/)
    expect(PLANE_CODE).not.toMatch(/store_id/)
    for (const c of customers) expect(PLANE_CODE).not.toContain(`name: '${c.name}'`)
  })

  it('the plane stores no calendar date — ⚖ L-6, every day comes from the booking', () => {
    expect(PLANE_CODE).not.toMatch(/20\d\d-\d\d-\d\d/)
  })

  it('every thread points at a customer that exists, and at a booking that exists when it names one', () => {
    for (const t of threadPlane) {
      expect(customers.some((c) => c.id === t.customer_id)).toBe(true)
      if (t.appointment_id) expect(appointments().some((a) => a.id === t.appointment_id)).toBe(true)
    }
  })
})

// ── 2. the joins ────────────────────────────────────────────────────────────

describe('every fact this room shows belongs to the desk that owns it', () => {
  it('a thread 期限 IS 予約一覧の deadlineOf on the same booking', () => {
    const rows = build(STORE_A)
    for (const t of rows) {
      const plane = threadPlane.find((p) => p.id === t.id)!
      if (!plane.appointment_id) continue
      const booking = appointments().find((a) => a.id === plane.appointment_id)!
      const record = reservations.find((r) => r.appointment_id === plane.appointment_id) ?? null
      expect(t.dueMinute).toBe(deadlineOf(lifecycleOf(booking, record), record, operatingHours.close))
    }
    // and the one that has to be there: the world's own 期限超過 row.
    expect(byId(rows, 'inb-change').dueMinute).toBe(12 * 60 + 30)
    expect(byId(rows, 'inb-change').overdue).toBe(true)
    expect(byId(rows, 'inb-change').statusLabel).toBe('期限超過')
  })

  it('期限超過 is DERIVED from the pinned board clock, not stored', () => {
    const early = build(STORE_A, { nowMinute: 9 * 60 })
    expect(byId(early, 'inb-change').overdue).toBe(false)
    expect(byId(early, 'inb-change').statusLabel).toBe('未対応')
    const late = build(STORE_A, { nowMinute: 18 * 60 })
    expect(byId(late, 'inb-recovery').overdue).toBe(true)
  })

  it('a resolved thread never paints a red （超過） deadline — 超過 is display-only, gated on status (S-2)', () => {
    // Constructed, not the demo world: apt-31's own deadline (12:30) already
    // sits behind the pinned clock (13:24), so a resolved card on the SAME
    // booking is the latent case — no fixture in the demo world pairs a
    // resolved decision with a booking whose own deadline has passed.
    const synDecision: FixtureDecision = {
      id: 'dec-syn', store_id: STORE_A, kind: '担当変更',
      appointment_id: 'apt-31', sell_slot_id: null,
      deadline: '完了', deadline_tone: '', urgent: false, state: 'resolved',
      owner_staff_id: 'p-04',
      status: '完了', status_tone: 'done',
      detail: '合成',
      proof_title: '合成', proofs: [],
      notification: 'sent',
    }
    const rows = build(STORE_A, {
      threads: [
        {
          id: 'syn-resolved-overdue',
          category: 'change',
          mark: '合',
          mark_tone: 'indigo',
          customer_id: 'cus-04',
          appointment_id: 'apt-31',
          received: 9 * 60,
          due: null,
          source: '合成',
          source_proof: null,
          subject: '合成',
          preview: '合成',
          next: '合成',
          reply: '',
          delivery_state: null,
          delivery_detail: null,
          events: [],
        },
      ],
      decisions: [...decisions, synDecision],
    })
    const t = rows[0]
    expect(t.status).toBe('resolved')
    expect(t.dueMinute).toBe(12 * 60 + 30)
    expect(t.overdue).toBe(false)
    expect(t.dueLabel).toBe('12:30まで')
    expect(t.dueLabel).not.toContain('超過')
  })

  it('a thread STATUS is its 次に決めること card own state — one verdict, two desks', () => {
    const rows = build(STORE_A)
    const map = { open: 'attention', waiting: 'waiting', resolved: 'resolved' } as const
    for (const t of rows) {
      const plane = threadPlane.find((p) => p.id === t.id)!
      const d = decisions.find((x) => x.appointment_id === plane.appointment_id)
      if (d) expect({ id: t.id, s: t.status }).toEqual({ id: t.id, s: map[d.state] })
    }
    expect(byId(rows, 'inb-delivery').status).toBe('waiting')
    expect(byId(rows, 'inb-noshow').status).toBe('resolved')
    expect(byId(rows, 'inb-recovery').status).toBe('attention')
  })

  it('配信状態 is the card own notification, and 証跡 its own proof rows', () => {
    const rows = build(STORE_A)
    for (const t of rows) {
      const plane = threadPlane.find((p) => p.id === t.id)!
      const d = decisions.find((x) => x.appointment_id === plane.appointment_id)
      if (!d) continue
      expect(t.deliveryState).toBe(d.notification)
      expect(t.proofTitle).toBe(d.proof_title)
      expect(t.proofLines).toEqual(d.proofs)
    }
  })

  it('配信状態 states the bare delivery word only — a decision-backed thread carries no delivery detail of its own (FIX-1)', () => {
    const rows = build(STORE_A)
    // Live-proven cases: inb-delivery used to print 「配信失敗 / … / 2回目
    // 送信済み」 and inb-noshow 「送信済み / … 電話1回 / 応答なし」 — the
    // decision's own proof rows wearing 配信状態, a second home for 証跡's rows.
    const delivery = byId(rows, 'inb-delivery')
    const noshow = byId(rows, 'inb-noshow')
    expect(delivery.deliveryLabel).toBe(DELIVERY_WORD.undelivered)
    expect(noshow.deliveryLabel).toBe(DELIVERY_WORD.sent)
    expect(delivery.deliveryLabel).not.toContain('/')
    expect(noshow.deliveryLabel).not.toContain('/')
    // The proofs are not gone — they stay in 証跡, the SAME array, unchanged.
    expect(delivery.proofLines).toEqual(decisions.find((d) => d.id === 'dec-sms')!.proofs)
    expect(noshow.proofLines).toEqual(decisions.find((d) => d.id === 'dec-noshow')!.proofs)
    // Every decision-backed thread agrees: bare word, never a join.
    for (const t of rows) {
      const plane = threadPlane.find((p) => p.id === t.id)!
      const d = decisions.find((x) => x.appointment_id === plane.appointment_id)
      if (!d) continue
      expect(t.deliveryLabel).toBe(DELIVERY_WORD[d.notification])
    }
  })

  it('a thread with no card takes 予約一覧 own 根拠 sentence', () => {
    const t = byId(build(STORE_A), 'inb-change')
    expect(t.proofLines).toEqual([reservations.find((r) => r.appointment_id === 'apt-31')!.proof])
  })

  it('the booking line IS the appointment every other room paints', () => {
    const t = byId(build(STORE_A), 'inb-change')
    const booking = appointments().find((a) => a.id === 'apt-31')!
    expect(t.bookingNo).toBe(booking.display_no)
    expect(t.bookingLabel).toContain(hhmm(jstMinuteOfDay(booking.starts_at)))
    expect(t.bookingLabel).toContain(menus.find((m) => m.id === booking.menu_id)!.name)
    expect(t.bookingLabel).toContain('¥6,600')
    expect(t.bookingLabel).toContain(fmtDay.format(new Date(booking.starts_at)))
  })

  it('a thread with no booking says so rather than inventing one', () => {
    const t = byId(build(STORE_B), 'inb-wait')
    expect(t.bookingNo).toBeNull()
    expect(t.bookingLabel).toBe('候補の枠はまだ確保していません')
  })

  it('the 履歴 IS the booking own 操作履歴, merged with the message events, newest first', () => {
    const rows = build(STORE_A)
    const change = byId(rows, 'inb-change')
    expect(change.history.map((h) => [h.time, h.what, h.detail])).toEqual(auditTrail['apt-31'])
    // The delivery thread's booking has no audit rows at all, so the plane's own
    // message events are the whole history — and they are not restating any.
    const delivery = byId(rows, 'inb-delivery')
    expect(auditTrail['apt-28']).toBeUndefined()
    expect(delivery.history).toHaveLength(2)
    expect(delivery.history[0].time).toBe('09:06')
    expect(delivery.history.map((h) => h.time)).toEqual(['09:06', '09:05'])
  })

  it('the affiliation rule has ONE home, and 売上分析 reads the same one', () => {
    const analytics = readFileSync(join(process.cwd(), 'src/business/lib/analytics.ts'), 'utf8')
    expect(analytics).toContain('customerStoreAffiliation(appointments)')
    expect(analytics).not.toMatch(/affiliation\.set\(/)
    expect(LIB).toContain('customerStoreAffiliation(input.appointments)')
    const board = readFileSync(join(process.cwd(), 'src/business/lib/today-board.ts'), 'utf8')
    expect(board).toContain('export function customerStoreAffiliation')
  })
})

// ── 3. store isolation, both directions ─────────────────────────────────────

describe('the thread list hides, it never shows-and-refuses', () => {
  it('銀座 sees its own five threads and never the 代官山 one', () => {
    const ids = build(STORE_A).map((t) => t.id)
    expect(ids).toEqual(['inb-change', 'inb-recovery', 'inb-absence', 'inb-delivery', 'inb-noshow'])
    expect(ids).not.toContain('inb-wait')
  })

  it('代官山 sees only its own, and none of 銀座 five', () => {
    const rows = build(STORE_B)
    expect(rows.map((t) => t.id)).toEqual(['inb-wait'])
    for (const id of ['inb-change', 'inb-recovery', 'inb-absence', 'inb-delivery', 'inb-noshow']) {
      expect(rows.some((t) => t.id === id)).toBe(false)
    }
  })

  it('a hidden thread leaves NOTHING behind — no subject, no name, no preview', () => {
    const serialized = JSON.stringify(build(STORE_B))
    for (const id of ['inb-change', 'inb-recovery', 'inb-absence', 'inb-delivery', 'inb-noshow']) {
      const t = threadPlane.find((p) => p.id === id)!
      expect(serialized).not.toContain(t.subject)
      expect(serialized).not.toContain(t.preview)
      expect(serialized).not.toContain(customers.find((c) => c.id === t.customer_id)!.name)
    }
  })

  it('a thread about a booking follows the BOOKING store, so the work lands where it can be done', () => {
    // 見本 きり books at 代官山 more recently than at 銀座, but apt-27 is a 銀座
    // booking — its message task is 銀座's, and clamping by the customer would
    // post it to a store that cannot act on it.
    const affiliation = customerStoreAffiliation(appointments())
    expect(affiliation.get('cus-07')).toBe(STORE_B)
    expect(byId(build(STORE_A), 'inb-absence').storeId).toBe(STORE_A)
    expect(build(STORE_B).some((t) => t.id === 'inb-absence')).toBe(false)
  })

  it('a thread with NO booking takes its customer affiliation, and only that', () => {
    const rows = appointments()
    expect(
      threadStore(
        { appointment_id: null, customer_id: 'cus-03' },
        new Map(rows.map((a) => [a.id, a])),
        customerStoreAffiliation(rows.filter((a) => a.store_id === STORE_B)),
      ),
    ).toBe(STORE_B)
    // cus-10 has never booked anywhere (the CM-9 row), so a thread of hers
    // would belong to no store and appear in none.
    expect(
      threadStore(
        { appointment_id: null, customer_id: 'cus-10' },
        new Map(),
        customerStoreAffiliation(rows),
      ),
    ).toBeNull()
  })

  it('the summary strip counts the LENS threads, never the business', () => {
    expect(summarize(build(STORE_A))).toEqual({
      open: 4,
      attention: 3,
      waiting: 1,
      resolved: 1,
      failures: 1,
    })
    expect(summarize(build(STORE_B))).toEqual({
      open: 1,
      attention: 0,
      waiting: 0,
      resolved: 0,
      failures: 0,
    })
  })

  it('配信失敗 counts a FAILED delivery, not a category chip', () => {
    const rows = build(STORE_A)
    expect(rows.filter((t) => t.deliveryState === 'undelivered').map((t) => t.id)).toEqual(['inb-delivery'])
    // The failing thread is 返信待ち, not 要対応 — so canon's own
    // 「delivery かつ attention」 reading would print 0 over a message that
    // demonstrably did not arrive.
    expect(byId(rows, 'inb-delivery').status).toBe('waiting')
    expect(summarize(rows).failures).toBe(1)
  })
})

// ── 4. consent honesty, reconciled with 顧客 ────────────────────────────────

describe('連絡同意 is the customer ledger, in the 顧客 screen own words', () => {
  it('三つの状態 — 同意あり / 同意なし / 未記録 — and 未記録 is never painted as a refusal', () => {
    const none = channelStates(customers.find((c) => c.id === 'cus-09')!)
    expect(none.map((c) => c.verdict)).toEqual(['unrecorded', 'unrecorded', 'unrecorded'])
    expect(none.map((c) => c.label)).toEqual(['—', '—', '—'])
    const refused = channelStates(customers.find((c) => c.id === 'cus-03')!)
    expect(refused.map((c) => c.verdict)).toEqual(['refused', 'refused', 'refused'])
    expect(refused.map((c) => c.label)).toEqual(['同意なし', '同意なし', '同意なし'])
  })

  it('agrees with the 顧客 screen own consentLabel on EVERY customer in the ledger', () => {
    for (const c of customers) {
      const allowed = channelStates(c).filter((s) => s.verdict === 'allowed').map((s) => s.key)
      const mine = c.consent == null ? '—' : allowed.length ? allowed.join('・') : '同意なし'
      expect({ id: c.id, label: mine }).toEqual({ id: c.id, label: consentLabel(c.consent) })
    }
  })

  it('uses the 顧客 screen own three phrases, so a change there breaks this room loudly', () => {
    for (const phrase of ['同意あり / 連携確認済み', '同意あり / 連携未確認', '同意なし']) {
      expect(CUSTOMERS_SRC).toContain(phrase)
      expect(LIB).toContain(phrase)
    }
  })

  it('consent without a resolvable destination is a TASK, not a channel', () => {
    // cus-04 consented to LINE and the link has never been confirmed, so there
    // is nowhere to send — and the room names the one step rather than
    // recommending a channel it cannot use.
    const states = channelStates(customers.find((c) => c.id === 'cus-04')!)
    expect(states[0].verdict).toBe('allowed')
    expect(states[0].destination).toBeNull()
    expect(states.some(isUsable)).toBe(false)
    expect(recommendedChannel(states)).toEqual({
      channel: null,
      reason: 'LINEの同意はありますが、送信先が確認できていません',
    })
  })

  it('names a channel when there IS one, with the destination it would use', () => {
    const linked = channelStates(customers.find((c) => c.id === 'cus-11')!)
    expect(recommendedChannel(linked)).toEqual({
      channel: 'LINE',
      reason: 'LINE（LINE連携済み）へ送信できます',
    })
    const mail = channelStates(customers.find((c) => c.id === 'cus-07')!)
    expect(recommendedChannel(mail).channel).toBe('メール')
    expect(recommendedChannel(mail).reason).toContain('kiri@sample.invalid')
  })

  it('the four no-channel reasons are four DIFFERENT reasons', () => {
    const reason = (id: string) => recommendedChannel(channelStates(customers.find((c) => c.id === id)!)).reason
    expect(reason('cus-09')).toBe('連絡同意が未記録のため、送信先を選べません')
    expect(reason('cus-03')).toBe('同意のある連絡方法がありません')
    expect(new Set([reason('cus-09'), reason('cus-03'), reason('cus-04'), reason('cus-11')]).size).toBe(4)
  })

  it('the demo world holds no reply-evidence on a channel the consent forbids', () => {
    // The one failed delivery in this world is Reserve's own 予約確認通知 on a
    // customer with NO consent record — deliberate, commented in the plane, and
    // it is exactly the surface the consent warning exists for. No thread
    // carries evidence of the STORE having sent on a REFUSED channel.
    for (const t of build(STORE_A)) {
      if (t.deliveryState !== 'sent' && t.deliveryState !== 'undelivered') continue
      const refusedAll = t.channels.every((c) => c.verdict === 'refused')
      expect(refusedAll).toBe(false)
    }
    expect(PLANE_SRC).toContain('⚖ DELIBERATE')
  })
})

// ── 5. the writes ship refused ──────────────────────────────────────────────

describe('reading and triage are buildable; sending is a write', () => {
  it('every thread ships BOTH actions refused, with a reason on the control', async () => {
    const props = await room({ store: STORE_A })
    expect(props.threads.length).toBeGreaterThan(0)
    for (const t of props.threads) {
      expect(t.primaryRefusal).toContain('見本データのため')
      expect(t.resolveRefusal).toContain('見本データのため')
      expect(t.primaryRefusal.length).toBeGreaterThan(20)
      expect(t.resolveRefusal.length).toBeGreaterThan(20)
    }
  })

  it('the refusals are aria-disabled controls, not disabled ones — a refusal a keyboard cannot reach does not explain itself', () => {
    expect(SRC).toContain('aria-disabled="true"')
    // ONE standing footnote on screen (the restructure's shape), and the
    // SPECIFIC reason on each control's own accessible name — an
    // aria-describedby makes a screen reader drop `title`, so the two reasons
    // would otherwise collapse into one sentence for exactly the reader who
    // cannot see the buttons.
    expect(SRC).toContain('aria-describedby={footnoteId}')
    expect(SRC).toContain('aria-label={`${current.primaryLabel} — ${current.primaryRefusal}`}')
    expect(SRC).toContain('aria-label={`${current.resolveLabel} — ${current.resolveRefusal}`}')
    expect(SRC).toContain('aria-label={`最新状態を確認 — ${props.refreshRefusal}`}')
    // NO REFUSED CONTROL IS `disabled` — the rule is about refusals, which have
    // a reason a keyboard has to be able to reach. Pinned as an exact census
    // rather than an absence, because there IS exactly one hard `disabled` in
    // this room now (⚖ Liam 8/23) and it is the tour card's 前へ on the first
    // step: not an action being refused, just the first item of a list with
    // nothing before it, and no reason to announce because there is none. A
    // hard `disabled` appearing on any refusal fails this line.
    expect(SRC.match(/(?<!aria-)\bdisabled=/g) ?? []).toHaveLength(1)
    expect(SRC).toContain('className="ib-spot-prev" disabled={tourStep?.idx === 0}')
  })

  it('⚖ F4 — ALL FOUR refused controls carry their reason in the accessible name, not title alone', () => {
    // The storeless 予約一覧 button was title-only: with `aria-disabled` it
    // stays focusable, so a screen-reader user reaches a dead control and is
    // told nothing about why. It gets its three siblings' treatment.
    const labels = [...SRC_CODE.matchAll(/aria-label=\{`([^`]*)`\}/g)].map((m) => m[1])
    expect(labels).toEqual([
      '最新状態を確認 — ${props.refreshRefusal}',
      '${current.primaryLabel} — ${current.primaryRefusal}',
      '${current.resolveLabel} — ${current.resolveRefusal}',
      '${BOOKING_LABEL} — ${NO_BOOKING_REFUSAL}',
    ])
    // FOUR aria-disabled controls, FOUR reasons — the census the room claims.
    expect((SRC_CODE.match(/aria-disabled="true"/g) ?? [])).toHaveLength(4)
    // ONE home for the label and one for the reason, read by the link shape and
    // the refused shape alike, so the two cannot describe the same lever two
    // ways (A8).
    expect(SRC_CODE).toContain("const BOOKING_LABEL = '予約一覧で事実を確認'")
    expect(SRC_CODE).toContain(
      "const NO_BOOKING_REFUSAL = 'この空き待ちにはまだ予約がないため、予約一覧では確認できません。'",
    )
    expect((SRC_CODE.match(/予約一覧で事実を確認/g) ?? [])).toHaveLength(1)
  })

  it('a refusal changes NOTHING — the room holds no state a refusal could touch', () => {
    // EIGHT useState calls and no more, in two groups. BROWSING: the filter, the
    // open thread, the ≤743 list-or-thread view flag. THE TOUR (⚖ Liam 8/23):
    // the step it is on, a tick that forces a re-measure when the page moves
    // under the spotlight, and the three MEASURED values it paints from — the
    // step's copy, the hole's placement, the hovered region. Every one of them
    // is a view value: none is written by any action, and there is no setter for
    // a sent reply or a completed thread because there is nothing to send or
    // complete. The refs beside them hold no state either — DOM handles and two
    // bookkeeping values for moving focus, none of them ever rendered.
    expect(SRC.match(/useState/g) ?? []).toHaveLength(9) // 1 import + 8 calls
    expect(SRC).not.toMatch(/setSent|setResolved|setThreads/)
    expect(SRC).not.toMatch(/onClick=\{\(\) => set(Sent|Resolved)/)
  })

  it('there is NO dialog — an action that cannot happen does not get a form', () => {
    expect(SRC_CODE).not.toContain('<dialog')
    expect(SRC_CODE).not.toContain('showModal')
    expect(CSS_CODE).not.toMatch(/(^|\s)dialog\s*\{/m)
    // …and no toast either: canon's 最新状態を確認 fires one saying nothing
    // changed, which is the dead-lever class one level down.
    expect(SRC_CODE).not.toContain('toast')
  })

  it('the refusal text is on screen, not in a title attribute alone (⚖ 47)', () => {
    // ONE standing line where the room used to carry two paragraphs (the
    // approved restructure) — still permanent, still there before anyone
    // reaches for a control, still nothing to outrun.
    expect(SRC).toContain('className="ib-footnote"')
    expect(SRC).toContain('{props.actionFootnote}')
    expect(CSS).toContain('.ib-footnote')
    expect(SRC_CODE).not.toContain('setTimeout')
  })

  it('the standing footnote says what the two refused levers say', async () => {
    const props = await room({ store: STORE_A })
    expect(props.actionFootnote).toContain('見本データのため')
    expect(props.actionFootnote).toContain('実データ接続後')
    expect(props.actionFootnote.length).toBeGreaterThan(20)
  })

  it('the reply the room WOULD send is shown before it is refused', async () => {
    const props = await room({ store: STORE_A })
    const change = props.threads.find((t) => t.id === 'inb-change')!
    expect(change.reply.length).toBeGreaterThan(10)
    expect(SRC).toContain('{current.customerName}様、{current.reply}')
  })

  it('予約一覧で事実を確認 is a real link where there IS a booking, and refuses where there is not', async () => {
    const a = await room({ store: STORE_A })
    expect(a.threads.find((t) => t.id === 'inb-change')!.bookingHref).toBe(
      `/ja/business/reservations?store=${encodeURIComponent(STORE_A)}`,
    )
    const b = await room({ store: STORE_B })
    expect(b.threads.find((t) => t.id === 'inb-wait')!.bookingHref).toBeNull()
    expect(SRC).toContain('この空き待ちにはまだ予約がないため')
  })

  it('最新状態を確認 refuses rather than toasting that nothing happened', async () => {
    const props = await room({ store: STORE_A })
    expect(props.refreshRefusal).toContain('見本データのため')
    expect(SRC).toContain('title={props.refreshRefusal}')
    // The reason is in the control's own accessible name, so a keyboard user
    // reaches it — aria-disabled keeps it focusable, unlike `disabled`.
    expect(SRC).toContain('aria-label={`最新状態を確認 — ${props.refreshRefusal}`}')
  })

  it('a resolved thread hides the WORK levers only — 予約一覧で事実を確認 stays, resolved or not (FIX-3, adjudicated)', async () => {
    // Source-level: TWO gates, not one. 返信する/解決として記録 (the WORK
    // levers) and the standing footnote that explains them are each their own
    // branch; the booking-fact link sits BETWEEN them, ungated — it names no
    // work, only navigation, so a resolved thread keeps it exactly like every
    // other.
    const actionsAt = SRC_CODE.indexOf('<div className="ib-act-row">')
    const gates = [...SRC_CODE.matchAll(/status !== 'resolved' &&/g)].map((m) => m.index!)
    expect(gates).toHaveLength(2)
    const [workGateAt, footnoteGateAt] = gates
    const bookingHrefAt = SRC_CODE.indexOf('current.bookingHref ?')
    const actionsCloseAt = SRC_CODE.indexOf('</div>', bookingHrefAt)
    expect(actionsAt).toBeGreaterThan(-1)
    expect(workGateAt).toBeGreaterThan(actionsAt)
    expect(bookingHrefAt).toBeGreaterThan(workGateAt)
    expect(actionsCloseAt).toBeGreaterThan(bookingHrefAt)
    expect(footnoteGateAt).toBeGreaterThan(actionsCloseAt)

    // Data-level: a resolved, booking-backed thread is real (inb-noshow /
    // apt-23) — a POSITIVE pin that the link stays, not just that the work
    // buttons go.
    const rows = await room({ store: STORE_A })
    const resolved = rows.threads.find((t) => t.status === 'resolved')!
    expect(resolved.id).toBe('inb-noshow')
    expect(resolved.bookingHref).not.toBeNull()
    expect(rows.threads.some((t) => t.status !== 'resolved')).toBe(true)
  })
})

// ── 6. triage state: argued N/A, pinned ─────────────────────────────────────

describe('nothing in this room needs to survive a real navigation', () => {
  it('the only client state is the filter, the open thread and the ≤743 view flag', () => {
    expect(SRC).toMatch(/const \[filter, setFilter\] = useState/)
    expect(SRC).toMatch(/const \[selected, setSelected\] = useState/)
    // VIEW state, not staged work: which of the two phone screens is showing.
    // It writes nothing and is meant to survive nothing.
    expect(SRC).toMatch(/const \[detailOpen, setDetailOpen\] = useState/)
    expect(SRC_CODE).not.toMatch(/localStorage|sessionStorage/)
  })

  it('no session provider is mounted for this room, because there is nothing to stage', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/layout.tsx'), 'utf8')
    expect(layout).not.toContain('InboxSessionEdits')
    expect(SRC).not.toContain('SessionEdits')
    // Canon's two state changes are the reply and the completion — both writes,
    // both refused. If either is ever connected, its staged result belongs
    // above this component (flag 30's class), and this pin is where that starts.
    expect(SRC).toContain('there is no staged state for')
  })

  it('the open thread follows the filter rather than describing a hidden row', () => {
    const rows = build(STORE_A)
    const resolvedOnly = rows.filter((t) => matchesFilter(t, 'resolved'))
    expect(resolvedOnly.map((t) => t.id)).toEqual(['inb-noshow'])
    expect(SRC).toContain('visible.find((t) => t.id === selected) ?? visible[0] ?? null')
  })

  it('the filter row is canon own six plus the two the strip needs, in the mock own order', async () => {
    const props = await room({ store: STORE_A })
    expect(props.filters.map((f) => f.key)).toEqual([
      'open',
      'attention',
      'waiting',
      'change',
      'noshow',
      'waitlist',
      'delivery',
      'resolved',
    ])
    expect(props.filters.map((f) => f.label)).toEqual([
      '未完了',
      '要対応',
      '返信待ち',
      '予約変更',
      '来店なし',
      '空き待ち',
      '配信失敗',
      '解決済み',
    ])
    // The two new labels are the STATUS vocabulary's own words, not a second
    // spelling invented for the filter row (A8).
    expect(props.filters[1].label).toBe(STATUS_LABEL.attention)
    expect(props.filters[2].label).toBe(STATUS_LABEL.waiting)
  })

  it('the screen has ONE filter home — matchesFilter, not an inline copy (FIX-2)', () => {
    // The inline ternary is gone. A pin that only checked for the import would
    // pass even with a live inline copy still running underneath it (the M10
    // discipline), so this checks the CALL exists too, and the ternary does not.
    expect(SRC_CODE).not.toMatch(/filter === 'open'\s*\?\s*t\.status/)
    expect(SRC_CODE).toMatch(/import\s*\{[^}]*\bmatchesFilter\b[^}]*\}\s*from\s*'@\/business\/lib\/inbox'/)
    expect(SRC_CODE).toContain('props.threads.filter((t) => matchesFilter(t, filter))')
    // The tested function and the running one are the SAME module, so a test
    // that mutates `matchesFilter` also proves the screen, not just the pin.
    expect(LIB).toContain('export function matchesFilter(')
  })
})

// ── 7. data states ──────────────────────────────────────────────────────────

describe('empty · one · many · the longest strings', () => {
  it('a store with no threads renders the honest empty state, not a blank panel', () => {
    const rows = build('store-nobody')
    expect(rows).toHaveLength(0)
    expect(summarize(rows)).toEqual({ open: 0, attention: 0, waiting: 0, resolved: 0, failures: 0 })
    expect(SRC).toContain('この条件の対応はありません')
  })

  it('a filter that matches nothing shows the empty state rather than a stale inspector', () => {
    const rows = build(STORE_B)
    expect(rows.filter((t) => matchesFilter(t, 'delivery'))).toHaveLength(0)
    expect(SRC).toContain('visible.length === 0 ? (')
    // The aside is rendered only when there IS a current thread.
    expect(SRC).toContain('{current && (')
  })

  it('a store with exactly one thread still gets a summary and an inspector', () => {
    const rows = build(STORE_B)
    expect(rows).toHaveLength(1)
    expect(summarize(rows).open).toBe(1)
    expect(rows[0].channels).toHaveLength(3)
  })

  it('the longest fixture strings are carried whole — no truncation in the data', async () => {
    const props = await room({ store: STORE_A })
    const longest = props.threads
      .flatMap((t) => [t.subject, t.preview, t.bookingLabel, t.deliveryLabel, t.recommendedReason])
      .sort((a, b) => b.length - a.length)[0]
    expect(longest.length).toBeGreaterThan(30)
    expect(longest).not.toContain('…')
    // THREE elements ellipsise, and all three are the Gmail-density queue row's
    // own one-line fields (name · subject · preview) — the row is three fixed
    // lines by design, so a long value shortens rather than pushing the next
    // row down the column. Nothing in the workspace truncates: everything the
    // operator has to READ wraps.
    expect((CSS.match(/text-overflow: ellipsis/g) ?? [])).toHaveLength(3)
    expect(CSS).toMatch(/\.ib-preview \{[^}]*text-overflow: ellipsis/)
    expect(CSS).toMatch(/\.ib-subject \{[^}]*text-overflow: ellipsis/)
    expect(CSS).toMatch(/\.ib-line1 strong \{[^}]*text-overflow: ellipsis/)
    expect(CSS).toMatch(/\.ib-fact b \{[^}]*word-break: break-word/)
    expect(CSS).toMatch(/\.ib-channel b \{[^}]*word-break: break-word/)
    // …and the full value is still in the DOM, so nothing is lost — only the
    // painting is short.
    const row = props.threads.find((t) => t.id === 'inb-change')!
    expect(row.preview).toBe('同じ担当のまま、もう少し遅い時間に変更したい')
  })

  it('a duplicate name is never two rows the reader cannot tell apart', async () => {
    // 見本 あかり is in this ledger twice (cus-01 / cus-09, the merge pair).
    const props = await room({ store: STORE_A })
    const row = props.threads.find((t) => t.id === 'inb-delivery')!
    expect(row.customerName).toBe('見本 あかり')
    expect(row.memberNumber).toBe('C-3009')
    expect(customers.filter((c) => c.name === row.customerName)).toHaveLength(2)
  })

  it('holds on any real date — the world is relative (⚖ L-6)', () => {
    for (const iso of ['2026-08-23T04:00:00Z', '2026-12-31T15:30:00Z', '2028-02-29T02:00:00Z']) {
      const undo = pin(iso)
      try {
        const rows = build(STORE_A)
        expect(rows).toHaveLength(5)
        expect(rows.every((t) => t.bookingLabel.length > 0)).toBe(true)
        expect(byId(rows, 'inb-change').dueMinute).toBe(12 * 60 + 30)
      } finally {
        undo()
      }
    }
  })
})

// ── 8. ⚖ ANY-ROSTER-SIZE — the room at 60+ threads ──────────────────────────

describe('the queue holds any number of threads', () => {
  /** A synthetic message world, built INSIDE the suite — the demo world stays
   *  six. Every synthetic thread hangs off a real booking so the join is doing
   *  real work at scale rather than being skipped. */
  function synthetic(count: number): FixtureThread[] {
    const pool = appointments().filter((a) => a.store_id === STORE_A)
    return Array.from({ length: count }, (_, i) => {
      const booking = pool[i % pool.length]
      return {
        id: `syn-${i}`,
        category: (['change', 'noshow', 'waitlist', 'delivery'] as const)[i % 4],
        mark: '合',
        mark_tone: 'indigo',
        customer_id: booking.customer_id,
        appointment_id: booking.id,
        received: 9 * 60 + (i % 300),
        due: null,
        source: '合成',
        source_proof: null,
        subject: `合成スレッド ${i}`,
        preview: `合成プレビュー ${i}`,
        next: '合成',
        reply: '',
        delivery_state: decisions.some((d) => d.appointment_id === booking.id) ? null : 'unsent',
        delivery_detail: decisions.some((d) => d.appointment_id === booking.id) ? null : '合成',
        events: [],
      } satisfies FixtureThread
    })
  }

  it('renders 64 threads with the counts exact and every join still made', () => {
    const rows = build(STORE_A, { threads: synthetic(64) })
    expect(rows).toHaveLength(64)
    expect(rows.every((t) => t.bookingNo !== null)).toBe(true)
    expect(rows.every((t) => t.channels.length === 3)).toBe(true)
    const s = summarize(rows)
    expect(s.open + s.resolved).toBe(64)
    // Counted the other way round: the arithmetic has to agree with itself.
    expect(s.open).toBe(rows.filter((t) => t.status !== 'resolved').length)
    expect(s.attention + s.waiting + s.resolved + rows.filter((t) => t.status === 'new').length).toBe(64)
  })

  it('the queue stays sorted by 期限 at scale, with resolved rows behind the work', () => {
    const rows = build(STORE_A, { threads: synthetic(64) })
    const rank = (t: ThreadModel) => (t.status === 'resolved' ? 2 : 0)
    for (let i = 1; i < rows.length; i += 1) {
      expect(rank(rows[i - 1])).toBeLessThanOrEqual(rank(rows[i]))
      if (rank(rows[i - 1]) !== rank(rows[i])) continue
      const due = (t: ThreadModel) => t.dueMinute ?? Number.MAX_SAFE_INTEGER
      expect(due(rows[i - 1])).toBeLessThanOrEqual(due(rows[i]))
    }
  })

  it('the work is LINEAR in the thread count — counted, not timed', () => {
    // A timing ratio passes a quadratic whose constant is small (room 2's own
    // catch), so the work is COUNTED instead. The ledgers are read into Maps
    // ONCE per build, whatever the thread count: a per-thread `customers.find`
    // would scan the ledger 64 times for 64 threads and 8 for 8, and this pin
    // tells those two shapes apart by construction rather than by stopwatch.
    const scans = { customers: 0, appointments: 0 }
    const counting = <T,>(rows: T[], key: keyof typeof scans) =>
      new Proxy(rows, {
        get(target, prop, recv) {
          if (prop === 'find' || prop === 'filter' || prop === 'map' || prop === 'forEach') scans[key] += 1
          return Reflect.get(target, prop, recv)
        },
      })
    const rows = appointments().filter((a) => a.store_id === STORE_A)
    const at = (n: number) => {
      scans.customers = 0
      scans.appointments = 0
      build(STORE_A, {
        threads: synthetic(n),
        appointments: counting(rows, 'appointments'),
        customers: counting(customers, 'customers'),
      })
      return { ...scans }
    }
    const eight = at(8)
    const sixtyFour = at(64)
    expect(sixtyFour).toEqual(eight)
    expect(sixtyFour).toEqual({ customers: 1, appointments: 1 })
    expect(LIB).toContain('const byId = new Map(')
    expect(LIB).toContain('const customerById = new Map(')
  })

  it('⚖ THE PAGE OWNS VERTICAL SCROLLING — no wrapper in this room caps a height', () => {
    // Liam 8/22, ruled twice. A nested vertical scroller traps the wheel, and
    // canon's own sticky+capped inspector is exactly that, so it is not carried.
    expect(CSS_CODE).not.toMatch(/max-height/)
    expect(CSS_CODE).not.toMatch(/overflow-y/)
    expect(CSS_CODE).not.toMatch(/overscroll-behavior/)
    expect(CSS_CODE).not.toMatch(/position:\s*sticky/)
    // After the restructure NO container in this room owns an axis at all: the
    // filter row WRAPS instead of panning, so the last scroller the room had is
    // gone. `overflow: hidden` on the panels is a CLIP for the rounded corners,
    // not a scroller — it creates no scroll container the wheel can fall into.
    expect(CSS_CODE).not.toMatch(/overflow-x/)
    expect(CSS_CODE).not.toMatch(/overflow:\s*auto/)
    expect(CSS_CODE).not.toMatch(/overflow:\s*scroll/)
    expect(CSS_CODE).toMatch(/\.ib-filters \{[^}]*flex-wrap:\s*wrap/)
  })

  it('a sticky header row that would need an inner scroller is not shipped', () => {
    // `top:` as its OWN property, not the tail of `margin-top` — a pin that
    // matches a margin is true for the wrong reason.
    expect(CSS_CODE).not.toMatch(/(?<![a-z-])top:\s*0/)
    expect(SRC_CODE).not.toContain('sticky')
  })
})

// ── 9. the sheet: outgoing scoping AND the incoming sibling fence ───────────

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const selectorsOf = (src: string) =>
  stripComments(src)
    .split('}')
    .flatMap((block) => {
      const i = block.indexOf('{')
      return i < 0 ? [] : block.slice(0, i).split(',').map((s) => s.trim()).filter(Boolean)
    })
    .filter((s) => !s.startsWith('@'))
const classesIn = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'biz')

describe('the sheet cannot reach another room, and no other room can reach it', () => {
  it('every rule is scoped to this room', () => {
    for (const sel of selectorsOf(CSS)) {
      expect({ sel, scoped: sel.includes('.pg-inbox') }).toEqual({ sel, scoped: true })
    }
    expect(SRC).toContain("const ROOT = 'page pg-inbox'")
    // ONE node carries it.
    expect((SRC_CODE.match(/pg-inbox/g) ?? [])).toHaveLength(1)
  })

  it('every class the markup renders is either ib-prefixed or a name this sheet fences', () => {
    const styled = new Set<string>()
    for (const sel of selectorsOf(CSS)) {
      if (!sel.includes('pg-inbox')) continue
      for (const c of classesIn(sel)) if (c !== 'pg-inbox') styled.add(c)
    }
    // Shell-owned names the room renders and does not restyle.
    for (const c of ['pill', 'indigo', 'alert', 'warn', 'good']) styled.add(c)
    const rendered = new Set<string>()
    for (const m of SRC.matchAll(/className="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) rendered.add(c)
    for (const m of SRC.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const c of m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (c) rendered.add(c)
    }
    for (const m of SRC.matchAll(/'(pill [a-z]+)'/g)) for (const c of m[1].split(/\s+/)) rendered.add(c)
    rendered.delete('pg-inbox')
    for (const c of rendered) {
      expect({ c, known: c.startsWith('ib-') || styled.has(c) }).toEqual({ c, known: true })
    }
  })

  it('⚖ THE SIBLING-SHEET FENCE — derived from the neighbours own sheets, never guessed', () => {
    // App Router leaves every sibling sheet in the document after a client-side
    // navigation, so a bare `.biz .<name>` rule next door keeps styling this
    // room. The list below is DERIVED: every selector in every sibling route
    // sheet whose class names are ALL names this room renders. It comes out at
    // three shapes (down from five — the route-CSS collision sweep, main
    // bc074069, scoped every sibling's own `.page`/`.page h1` under its own
    // `.page-<room>` compound class, so those two stopped colliding; `btn`'s
    // shapes are untouched) because every element this room owns carries an
    // `ib-` name that exists nowhere else in the family — a fence that cannot
    // rot as the neighbours change shape underneath it.
    const styled = new Set<string>(['pill', 'indigo', 'alert', 'warn', 'good'])
    for (const sel of selectorsOf(CSS)) {
      if (!sel.includes('pg-inbox')) continue
      for (const c of classesIn(sel)) if (c !== 'pg-inbox') styled.add(c)
    }
    const base = join(process.cwd(), 'src/app/[locale]/(business)/business')
    const reachable = new Set<string>()
    for (const dir of readdirSync(base).filter((d) => d !== 'inbox')) {
      let sheet: string
      try {
        sheet = readFileSync(join(base, dir, `${dir}.css`), 'utf8')
      } catch {
        continue
      }
      for (const sel of selectorsOf(sheet)) {
        if (!sel.startsWith('.biz') || sel.includes('.pg-')) continue
        const names = classesIn(sel)
        if (names.length && names.every((n) => styled.has(n))) reachable.add(sel)
      }
    }
    // 顧客 RETIRED its bare `.biz .page .btn` in its V2 redesign (its buttons are
    // `cu-btn-*` now, and its dialog states its weights at four levels), so this
    // DERIVED list loses that entry — re-derived here in the same pass by the
    // room whose sheet changed, which is what this pin asks for.
    expect([...reachable].sort()).toEqual(['.biz .btn', '.biz .btn.primary'])
    // …and every one of them is answered at FOUR levels, which beats a
    // sibling's three and removes the insertion-order coin flip.
    //
    // ⚖ THE M10 DISCIPLINE, APPLIED HERE. The first spelling of this pin read
    // the WHOLE sheet, and the responsive bands restate `.biz .page.pg-inbox {`
    // three more times — so dropping the BASE rule to three levels left the pin
    // green on the copies inside the media queries. It reads the base sheet
    // (everything before the first @media) instead, and separately forbids the
    // three-level spelling anywhere.
    const BASE_CSS = CSS.slice(0, CSS.indexOf('@media'))
    expect(BASE_CSS.length).toBeGreaterThan(1000)
    for (const fence of [
      '.biz .page.pg-inbox {',
      '.biz .page.pg-inbox h1 {',
      '.biz .page.pg-inbox .btn {',
      '.biz .page.pg-inbox .btn.primary {',
    ]) {
      expect({ fence, inBaseSheet: BASE_CSS.includes(fence) }).toEqual({ fence, inBaseSheet: true })
    }
    // The room's own root rule is NEVER stated at three levels — that is the
    // tie a sibling's three-level rule wins on insertion order.
    expect(CSS_CODE).not.toMatch(/\.biz \.pg-inbox \{/)
    expect(CSS_CODE).not.toMatch(/\.biz \.pg-inbox h1 \{/)
  })

  it('the fence states this room own value for every property the neighbours declare', () => {
    const base = join(process.cwd(), 'src/app/[locale]/(business)/business')
    const declared = new Map<string, Set<string>>()
    for (const dir of readdirSync(base).filter((d) => d !== 'inbox')) {
      let sheet: string
      try {
        sheet = readFileSync(join(base, dir, `${dir}.css`), 'utf8')
      } catch {
        continue
      }
      const clean = stripComments(sheet)
      for (const block of clean.split('}')) {
        const i = block.indexOf('{')
        if (i < 0) continue
        const sels = block.slice(0, i).split(',').map((s) => s.trim())
        const body = block.slice(i + 1)
        for (const sel of sels) {
          if (!sel.startsWith('.biz') || sel.includes('.pg-')) continue
          const key = sel.replace('.biz ', '')
          for (const m of body.matchAll(/([a-z-]+)\s*:/g)) {
            if (!declared.has(key)) declared.set(key, new Set())
            declared.get(key)!.add(m[1])
          }
        }
      }
    }
    const mine = (fence: string) => {
      const at = CSS.indexOf(fence)
      expect(at).toBeGreaterThan(-1)
      const body = CSS.slice(at + fence.length, CSS.indexOf('}', at))
      return new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))
    }
    // `.page` / `.page h1` dropped out (main bc074069's route-CSS collision
    // sweep scoped every sibling's own bare rule under its own `.page-<room>`
    // compound class) — a pair with nothing declared would be vacuous, and
    // the assertion below insists every pair here has something real to
    // fence. `.page.pg-inbox`/`.page.pg-inbox h1` stay in inbox.css as this
    // room's own styling; they just answer no sibling collision any more.
    const pairs: Array<[string, string]> = [
      // `.page .btn` left the list with 顧客's V2 redesign; this room's own
      // `.biz .page.pg-inbox .btn` fence is unchanged and still answers the two
      // `reservations` rules below.
      ['.btn', '.biz .page.pg-inbox .btn {'],
      ['.btn.primary', '.biz .page.pg-inbox .btn.primary {'],
    ]
    for (const [sibling, fence] of pairs) {
      const props = declared.get(sibling) ?? new Set<string>()
      expect({ sibling, props: [...props].sort() }).not.toEqual({ sibling, props: [] })
      for (const p of props) {
        expect({ sibling, p, fenced: mine(fence).has(p) }).toEqual({ sibling, p, fenced: true })
      }
    }
  })

  it('R13 — every selected state is a wash or a mark, never a fill', () => {
    // The filter is QUIET TEXT: selected is an accent label plus a 2px accent
    // underline, and it deliberately does NOT take the indigo wash — the
    // selected queue row 40px below already owns that wash, and two indigo
    // washes in one narrow column blunt the one signal that matters.
    expect(CSS).toMatch(
      /\.ib-filter\[aria-pressed="true"\] \{[^}]*color: var\(--select-ink\)[^}]*text-decoration-color: var\(--select-line\)/,
    )
    expect(CSS).not.toMatch(/\.ib-filter\[aria-pressed="true"\] \{[^}]*background/)
    expect(CSS).toMatch(/\.ib-summary button\[aria-pressed="true"\] \{[^}]*background: var\(--indigo-soft\)/)
    expect(CSS).toMatch(/\.ib-row\.selected \{[^}]*background: var\(--indigo-soft\)/)
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|black|var\(--ink\))/)
    // The only solid accent in the room would be a commit button, and this room
    // has none — every action is refused.
    expect(SRC_CODE).not.toContain('btn primary')
  })

  it('focus stays the SHELL own one rule — this room states no outline of its own', () => {
    // The mock replaces the UA ring because a static mock has no shell. The
    // deployed shell already ships the accent, offset, :focus-visible-only ring
    // for every pressable in the family, so restating it here would be a second
    // home for one verdict and would make this room's focus differ from every
    // other room's.
    expect(CSS_CODE).not.toMatch(/outline/)
    const shell = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'),
      'utf8',
    )
    expect(shell).toMatch(/:focus-visible[\s\S]{0,200}outline:\s*3px solid var\(--indigo\)/)
    expect(shell).toContain('outline-offset: 2px')
  })

  it('⚖ F2 — no container this room owns CLIPS the ring off its own pressables', () => {
    // The shell paints 3px OUTSIDE the control at 2px offset, so a container
    // that clips at its border-radius erases the ring on every pressable
    // against its edge — which is what `overflow: hidden` on the strip and on
    // the panels was doing to the five counters (top/bottom gone) and the queue
    // rows (left/right gone). Borrowing a ring and then cutting it off is worse
    // than not having one, because the room reads as if it were fixed.
    const rule = (sel: string) => {
      const at = CSS.indexOf(`${sel} {`)
      expect({ sel, found: at }).not.toEqual({ sel, found: -1 })
      return CSS.slice(at, CSS.indexOf('}', at))
    }
    expect(rule('.biz .pg-inbox .ib-summary')).not.toContain('overflow')
    expect(rule('.biz .pg-inbox .ib-panel')).not.toContain('overflow')
    // …and the look is unchanged, because the corners moved to the children
    // that reach them rather than being dropped: a pressed counter and a
    // hovered last row still end at the radius.
    expect(rule('.biz .pg-inbox .ib-summary-main')).toContain('border-radius: 10px 0 0 10px')
    expect(rule('.biz .pg-inbox .ib-stat:last-child')).toContain('border-radius: 0 10px 10px 0')
    expect(rule('.biz .pg-inbox .ib-panel-head')).toContain('border-radius: 10px 10px 0 0')
    expect(rule('.biz .pg-inbox .ib-band')).toContain('border-radius: 10px 10px 0 0')
    expect(rule('.biz .pg-inbox .ib-row:last-child')).toContain('border-radius: 0 0 10px 10px')
    // the 2×2 band moves the strip's corners to a different four children.
    const tablet = CSS.slice(CSS.indexOf('@media (max-width: 1023px)'))
    expect(tablet).toMatch(/\.ib-summary-main \{ grid-column: 1 \/ -1; border-radius: 10px 10px 0 0/)
    expect(tablet).toMatch(/\.ib-stat:nth-last-child\(2\) \{ border-radius: 0 0 0 10px/)
    expect(tablet).toMatch(/\.ib-stat:last-child \{ border-radius: 0 0 10px 0/)
    // D-17 stands: the ring itself is still the shell's one rule, not restated.
    expect(CSS_CODE).not.toMatch(/outline/)
  })

  it('⚖ F6 — the DEAD border declarations are gone, and the reason is written down', () => {
    // `.ib-summary button { border: 0 }` is (0,3,1) and beats every
    // `.ib-summary-main` / `.ib-stat` rule in this sheet at (0,3,0), so the
    // indigo rail and the counter dividers those rules declared never painted a
    // pixel — in the approved mock either. Keeping them invites a later
    // "specificity fix" that would change the look Liam signed off.
    expect(CSS_CODE).toMatch(/\.ib-summary button \{\s*border: 0;/)
    // Neither counter states a border longhand anywhere in the sheet — base
    // band or responsive. `border-radius` is not one: it is the corner the
    // container stopped clipping (F2), and it paints.
    const longhand = /border(-(top|right|bottom|left))?(-(width|style|color))?\s*:/
    for (const sel of ['.biz .pg-inbox .ib-summary-main', '.biz .pg-inbox .ib-stat']) {
      for (const at of [...CSS_CODE.matchAll(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'g'))]) {
        const body = CSS_CODE.slice(at.index!, CSS_CODE.indexOf('}', at.index!))
        expect({ sel, body, states: longhand.test(body) }).toEqual({ sel, body, states: false })
      }
    }
    // …and the dead ≤1023 restatement is gone with them.
    expect(CSS).not.toContain('.ib-stat:nth-child(odd)')
    expect(CSS).not.toContain('#e5e9f7')
    // …and the comment that says WHY, so the next reader does not "fix" it.
    expect(CSS).toContain('never painted a pixel')
  })
})

// ── 10. the room under the shell ────────────────────────────────────────────

describe('the shell knows this room is live', () => {
  it('the rail entry is live and points at the route', () => {
    const sidebar = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/BusinessSidebar.tsx'),
      'utf8',
    )
    expect(sidebar).toContain("{ key: 'inbox', segment: 'inbox', label: '受信トレイ', mini: '受信', live: true }")
  })

  it('the topbar crumb names it', () => {
    const topbar = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/BusinessTopbar.tsx'),
      'utf8',
    )
    expect(topbar).toContain("inbox: '受信トレイ'")
  })

  it('the page resolves on the server and hands the client strings only', async () => {
    const props = await room({ store: STORE_A })
    for (const t of props.threads) {
      expect(typeof t.dueLabel).toBe('string')
      expect(typeof t.receivedLabel).toBe('string')
      expect(typeof t.bookingLabel).toBe('string')
    }
    expect(SRC).toContain("'use client'")
    expect(SRC).not.toContain('@/business/lib/data')
    expect(SRC).not.toContain('Intl.')
    expect(SRC).not.toContain('new Date')
    expect(PAGE_SRC).toContain('requireBusinessAdmission')
  })

  it('an unknown ?store= opens on the operator own store, never a business-wide merge', async () => {
    const fallback = await room({ store: 'store-does-not-exist' })
    const ginza = await room({ store: STORE_A })
    expect(fallback.threads.map((t) => t.id)).toEqual(ginza.threads.map((t) => t.id))
  })

  it('ONE clock read per render — the day, the deadlines and 期限超過 share an instant', () => {
    // The assembly moved out of the page; the law did not. Both files are
    // checked, so neither can grow a second clock read.
    expect(PROPS_SRC).toContain('const now = renderNow()')
    expect((PROPS_SRC.match(/new Date\(\)/g) ?? [])).toHaveLength(0)
    expect((PROPS_SRC.match(/renderNow\(\)/g) ?? [])).toHaveLength(1)
    expect((PAGE_SRC.match(/new Date\(\)/g) ?? [])).toHaveLength(0)
    expect((PAGE_SRC.match(/renderNow\(\)/g) ?? [])).toHaveLength(0)
  })

  it('the page is the ROUTE ENTRY and the assembly is one shared function (the replica-drift fix)', () => {
    // The isolated evidence used to be rendered from a hand-written copy of the
    // markup, and the copy drifted from the product without any gate noticing.
    // The harness imports `inboxProps` now, so page and probe cannot disagree
    // about what the room shows — which means the page must not keep an
    // assembly of its own for it to disagree WITH.
    expect(PAGE_CODE).toContain("import { inboxProps } from './inbox-props'")
    expect(PAGE_CODE).toContain('await inboxProps({ locale, store: query.store })')
    expect(PAGE_CODE).toContain('requireBusinessAdmission')
    // Nothing but the gate, the params and the render is left in the route.
    expect(PAGE_CODE).not.toContain('buildThreads')
    expect(PAGE_CODE).not.toContain('summarize')
    expect(PAGE_CODE).not.toContain('listCustomers')
    expect(PAGE_CODE).not.toContain('Intl.')
    // …and the assembly holds no admission gate, so importing it can never
    // become a way around one.
    expect(PROPS_CODE).not.toContain('requireBusinessAdmission')
  })

  it('⚖ F7 — view state is STORE-SCOPED: a lens switch resets the screen', async () => {
    // `?store=` navigation keeps the same component instance, so the filter,
    // the selection and the ≤743 detail flag used to survive into a queue that
    // no longer contains them. The screen is keyed by the RESOLVED lens.
    expect(PAGE_CODE).toContain('<InboxScreen key={storeKey} {...props} />')
    // The key is the resolved store, not the raw query — the clamp has one
    // home, and an unknown ?store= lands on the same key the reads used.
    expect(PROPS_CODE).toContain("return { props, storeKey: clamped ? storeId! : 'all-stores' }")
    const ginza = await room({ store: STORE_A })
    const bogus = await room({ store: 'store-does-not-exist' })
    expect(bogus.threads.map((t) => t.id)).toEqual(ginza.threads.map((t) => t.id))
  })

  it('the two standing explainer paragraphs live on as the tour’s first step', async () => {
    const props = await room({ store: STORE_A })
    expect(props.subtitle).toBe(
      '予約変更、来店なし、空き待ち、配信失敗を、期限と連絡許可の事実から処理します。',
    )
    // ⚖ Liam 8/23 — canon's head note AND the 対応状況 strip's own sentence were
    // removed from the page, then carried behind the ? as a disclosure; both
    // now open the tour's FIRST STEP instead, declared on the page head. The
    // facts they carried — this queue is 対応, not messages; カルテ content is
    // not shown here; four things are checked before anything is sent — are all
    // in that one declaration, and the room states them exactly once, which is
    // why `helpText` is gone from the props rather than left as a second home.
    expect(props).not.toHaveProperty('helpText')
    expect(PROPS_CODE).not.toContain('helpText')
    const head = SRC_CODE.slice(SRC_CODE.indexOf('className="ib-head"'))
    const intro = head.slice(0, head.indexOf('</header>'))
    expect(intro).toContain('data-guide-title="受信トレイ"')
    for (const fact of [
      'メッセージの数ではなく、店舗が次に行う対応を並べる画面です',
      '顧客カルテの施術内容はここには表示しません',
      '期限、予約への影響、同意済みの連絡先、配信の証跡を確認してから送信します',
    ]) {
      expect(intro).toContain(fact)
    }
    // …and none of it is printed as page furniture — the head still renders an
    // eyebrow, a title, the ? and a subtitle, and nothing else.
    expect(SRC_CODE).not.toContain('ib-note')
    expect(CSS_CODE).not.toContain('ib-note')
    expect(SRC_CODE).not.toContain('ib-help-block')
    expect(CSS_CODE).not.toContain('ib-help-block')
    expect(CSS).toMatch(/\.ib-help \{[^}]*border: 1px solid/)
    expect(CSS).not.toMatch(/\.ib-help \{[^}]*background: var\(--indigo\)/)
  })

  it('⚖ Liam 8/23 — the ? OPENS THE GUIDED TOUR, and is still a real target', () => {
    // It began as a hover-only tooltip (a lever only a sighted mouse user could
    // pull), became a two-paragraph disclosure, and is now the trigger for the
    // 今日の運営-style walk of the whole screen. The walk itself is pinned in
    // inbox-screen-interactions.test.ts; what is pinned here is the trigger.
    expect(SRC_CODE).toContain('onClick={() => setTourIdx(0)}')
    expect(SRC_CODE).toContain('aria-haspopup="dialog"')
    expect(SRC_CODE).toContain('aria-expanded={tourOpen}')
    expect(SRC_CODE).toContain('aria-controls="ibTour"')
    expect(SRC_CODE).toContain('id="ibTour"')
    expect(SRC_CODE).toContain('aria-label="画面の説明"')
    // The disclosure is GONE, state and all — no second way to read the same
    // copy, and no dead branch left behind.
    expect(SRC_CODE).not.toContain('helpOpen')
    expect(SRC_CODE).not.toContain('ibHelp"')
    // No <dialog> element (D-2) — the card is a positioned div with a role, so
    // it cannot take the top layer away from the page it is explaining.
    expect(SRC_CODE).not.toContain('<dialog')
    // ≥44px on a thumb WITHOUT growing the 21px mark: the hit box is extended
    // past the paint in the phone band.
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 743px)'))
    expect(phone).toMatch(/\.ib-help::after \{[^}]*width: 44px; height: 44px/)
    expect(CSS).toMatch(/\.ib-help \{[^}]*width: 21px; height: 21px/)
  })

  it('the queue is ordered as the strip claims — 期限と影響順', async () => {
    const props = await room({ store: STORE_A })
    expect(props.threads.map((t) => t.id)).toEqual([
      'inb-change',
      'inb-recovery',
      'inb-absence',
      'inb-delivery',
      'inb-noshow',
    ])
    expect(props.threads[0].statusLabel).toBe('期限超過')
    expect(props.summary.open).toBe(4)
  })
})

// ── 11. the restructure's own laws ──────────────────────────────────────────

describe('the numbers ARE the filters', () => {
  it('every counter presses the filter that shows exactly the rows it counted', () => {
    const rows = build(STORE_A)
    const s = summarize(rows)
    // The law, on every one of the five: a number that names a slice of the
    // queue and then opens a DIFFERENT slice is a poster, not a tool. This is
    // the pin that forces 配信失敗's filter to answer the same question its
    // counter does (D-8's reading, one home).
    for (const key of Object.keys(s) as Array<keyof InboxSummary>) {
      const shown = rows.filter((t) => matchesFilter(t, COUNTER_FILTER[key]))
      expect({ key, n: s[key] }).toEqual({ key, n: shown.length })
    }
    expect(s.failures).toBe(1)
    expect(rows.filter((t) => matchesFilter(t, 'delivery')).map((t) => t.id)).toEqual(['inb-delivery'])
  })

  it('holds where the two readings of 配信失敗 COULD disagree — the category chip is not the count', () => {
    // A 予約変更 thread whose card says the notification failed: canon's
    // category chip would miss it and the count would find it. Constructed,
    // because the demo world's one failure happens to be a delivery-category
    // thread — a pin that only ever sees the easy case is not a pin.
    const synDecision: FixtureDecision = {
      id: 'dec-syn-fail', store_id: STORE_A, kind: '担当変更',
      appointment_id: 'apt-31', sell_slot_id: null,
      deadline: '13:45', deadline_tone: '', urgent: true, state: 'open',
      owner_staff_id: 'p-04',
      status: '対応中', status_tone: '',
      detail: '合成',
      proof_title: '合成', proofs: [],
      notification: 'undelivered',
    }
    const rows = build(STORE_A, { decisions: [...decisions, synDecision] })
    const t = byId(rows, 'inb-change')
    expect(t.category).toBe('change')
    expect(isFailedDelivery(t)).toBe(true)
    expect(summarize(rows).failures).toBe(2)
    expect(rows.filter((r) => matchesFilter(r, 'delivery')).map((r) => r.id)).toEqual([
      'inb-change',
      'inb-delivery',
    ])
    // …and the counter still shows exactly what it counted.
    expect(summarize(rows).failures).toBe(rows.filter((r) => matchesFilter(r, COUNTER_FILTER.failures)).length)
  })

  it('every counter has a filter to press, and every filter key is a real one', () => {
    const keys = new Set(FILTERS.map((f) => f.key))
    for (const target of Object.values(COUNTER_FILTER)) expect(keys.has(target)).toBe(true)
    // …and the reverse direction the screen renders: pressing a filter marks
    // its counter, because both read the SAME map rather than two lists.
    expect(SRC_CODE).toContain('aria-pressed={filter === COUNTER_FILTER[s.key]}')
    expect(SRC_CODE).toContain('aria-pressed={filter === COUNTER_FILTER.open}')
    expect(SRC_CODE).toContain('aria-pressed={filter === f.key}')
    // …and the press really moves the filter row, rather than only marking
    // itself: a counter that lights up and changes nothing is the dead-lever
    // class wearing a number.
    expect(SRC_CODE).toContain('onClick={() => choose(COUNTER_FILTER[s.key])}')
    expect(SRC_CODE).toContain('onClick={() => choose(COUNTER_FILTER.open)}')
    expect(SRC_CODE).toContain('onClick={() => choose(f.key)}')
    expect(SUMMARY_STATS.map((s) => s.key)).toEqual(['attention', 'waiting', 'resolved', 'failures'])
    // 本日解決 is the counter's word and 解決済み is the filter's — both point
    // at the same rows.
    expect(SUMMARY_STATS[2].label).toBe('本日解決')
    expect(COUNTER_FILTER.resolved).toBe('resolved')
    expect(FILTERS.find((f) => f.key === 'resolved')!.label).toBe('解決済み')
  })

  it('the counters are real pressables, and pressed reads accent while hover stays neutral', () => {
    expect(SRC_CODE).toContain('<button\n          className="ib-summary-main"')
    expect(SRC_CODE).toMatch(/className="ib-stat"\n            type="button"/)
    expect(CSS).toMatch(/\.ib-summary button:hover \{[^}]*background: #f1f2f8/)
    expect(CSS).toMatch(/\.ib-stat\[aria-pressed="true"\] \{[^}]*box-shadow: inset 0 -2px 0 var\(--select-line\)/)
  })
})

describe('全て対応済みの朝 is a designed screen, not an empty one', () => {
  /** 未完了 0 is not reachable in the demo world (every store has open work),
   *  so the state is driven from real data rather than a flag: a lens whose
   *  cards are all closed, plus a closing card for the one thread that has
   *  none (apt-31, whose status derives from its own deadline). Nothing about
   *  the room changes — only the world it is reading. */
  const closingCard: FixtureDecision = {
    id: 'dec-syn-close', store_id: STORE_A, kind: '担当変更',
    appointment_id: 'apt-31', sell_slot_id: null,
    deadline: '完了', deadline_tone: '', urgent: false, state: 'resolved',
    owner_staff_id: 'p-04',
    status: '完了', status_tone: 'done',
    detail: '合成',
    proof_title: '合成', proofs: [],
    notification: 'sent',
  }
  const allResolved = () =>
    build(STORE_A, {
      decisions: [...decisions.map((d) => ({ ...d, state: 'resolved' as const })), closingCard],
    })

  it('derives from the data — 未完了 0 with 本日解決 still counting', () => {
    const rows = allResolved()
    const s = summarize(rows)
    expect(rows.length).toBeGreaterThan(0)
    expect(s.open).toBe(0)
    expect(s.attention).toBe(0)
    expect(s.waiting).toBe(0)
    expect(s.resolved).toBe(rows.length)
    // No store in the demo world is actually zero — the normal morning still
    // has work, so the state cannot be reached by accident.
    expect(summarize(build(STORE_A)).open).toBe(4)
    expect(summarize(build(STORE_B)).open).toBe(1)
  })

  it('the zero card REPLACES the workspace — no hidden panel behind it', () => {
    // Conditional render, not `display: none`: an acceptance census that reads
    // the DOM must not find a second workspace parked behind the card, and a
    // reader must not be able to tab into a queue that is not on screen.
    expect(SRC_CODE).toContain('const allClear = props.summary.open === 0 && filter === COUNTER_FILTER.open')
    expect(SRC_CODE).toMatch(/\{allClear \? \(/)
    // …and the card never becomes a dead end: an all-clear store still has
    // 本日解決 rows, and pressing that counter has to LIST them. The card owns
    // the default view only; every other filter keeps the workspace, which is
    // what carries the filter row back.
    const rows = allResolved()
    expect(summarize(rows).open).toBe(0)
    expect(rows.filter((t) => matchesFilter(t, COUNTER_FILTER.resolved)).length).toBe(rows.length)
    expect(rows.filter((t) => matchesFilter(t, COUNTER_FILTER.open))).toHaveLength(0)
    // the phone swap needs a thread to swap TO — a filter matching nothing must
    // not hide the list behind a panel that was never rendered.
    expect(SRC_CODE).toContain('${detailOpen && current ? \' is-detail\' : \'\'}')
    expect(SRC_CODE).toContain('className="ib-zero-card"')
    expect(SRC_CODE).toContain('すべて対応済みです')
    expect(SRC_CODE).toContain('新しいメッセージが届くとここに並びます')
    expect(CSS_CODE).not.toMatch(/\.ib-zero[^{]*\{[^}]*display:\s*none/)
    expect(CSS_CODE).not.toMatch(/is-zero/)
  })

  it('a 0 is not an alarm — the red is applied at the source, above zero only', () => {
    // The suppression lives where the class is decided rather than in a
    // zero-state override, so it holds in EVERY state — including the one the
    // mock could not reach, a resolved thread whose message still failed. An
    // override would have grayed a real non-zero figure.
    expect(SRC_CODE).toContain("s.alarm && props.summary[s.key] > 0 ? 'attention' : undefined")
    expect(SUMMARY_STATS.filter((s) => s.alarm).map((s) => s.key)).toEqual(['attention', 'failures'])
    const s = summarize(allResolved())
    expect(s.attention).toBe(0)
    // …and the case the mock's own zero-state override could not see: 未完了 is
    // 0 while a message this world can prove did not arrive is STILL undelivered
    // on a closed thread. A blanket 「is-zero suppresses red」 rule would gray a
    // real 1. The source rule keeps it red, because it is real.
    expect(s.open).toBe(0)
    expect(s.failures).toBe(1)
  })
})

describe('⚖ ALL-SCREEN ADAPTIVITY — the ladder the page owns', () => {
  const bands = CSS.match(/@media[^{]+\{/g) ?? []

  it('ships every band the mock specifies, and only the page own rules', () => {
    const heads = bands.map((b) => b.replace(/\s+/g, ' ').trim())
    expect(heads).toEqual([
      '@media (min-width: 1400px) {',
      '@media (max-width: 1279px) {',
      '@media (max-width: 1099px) {',
      '@media (max-width: 1023px) {',
      '@media (min-width: 800px) and (max-width: 1023px) {',
      '@media (max-width: 743px) {',
      '@media (prefers-reduced-motion: reduce) {',
    ])
    // The mock's shell-level rules are MOCK FURNITURE: a route sheet reaching
    // `.biz .app` / `.rail` / `.topbar` would restyle the whole family from one
    // room. Every rule here is this page's own.
    for (const sel of selectorsOf(CSS)) {
      expect({ sel, scoped: sel.includes('.pg-inbox') }).toEqual({ sel, scoped: true })
    }
    expect(CSS_CODE).not.toMatch(/\.rail|\.topbar|\.app\s*\{|min-width:\s*1180/)
  })

  it('800–1023 RE-PAIRS the inner columns — the near-square foldable band', () => {
    const at = CSS.indexOf('@media (min-width: 800px) and (max-width: 1023px)')
    expect(at).toBeGreaterThan(-1)
    const body = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(body).toMatch(/\.ib-grid \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
    // …and it has to come AFTER the two bands that stack the pair, or the
    // cascade would hand the fold a single stretched column.
    expect(at).toBeGreaterThan(CSS.indexOf('@media (max-width: 1099px)'))
    expect(at).toBeGreaterThan(CSS.indexOf('@media (max-width: 1023px)'))
    // …and BEFORE ≤743, which stacks it again for the phone.
    expect(at).toBeLessThan(CSS.indexOf('@media (max-width: 743px)'))
  })

  it('≤743 is ONE SCREEN AT A TIME, with a way back that a thumb and a keyboard both have', () => {
    const at = CSS.indexOf('@media (max-width: 743px)')
    const body = CSS.slice(at)
    expect(body).toContain('.biz .pg-inbox .ib-detail { display: none; }')
    expect(body).toContain('.biz .pg-inbox.is-detail .ib-queue { display: none; }')
    expect(body).toContain('.biz .pg-inbox.is-detail .ib-detail { display: block; }')
    // The swap is scoped to the band: above 743 the list never leaves, so the
    // flag styles nothing and the ← control is not rendered visible.
    expect(CSS).toMatch(/\.ib-back \{ display: none; \}/)
    expect(CSS.indexOf('.ib-back { display: none; }')).toBeLessThan(at)
    // Touch targets: the phone band grows the hit boxes, and the filter mark
    // stays on the TEXT because it is text-decoration, not a border.
    expect(body).toMatch(/\.ib-filter \{ padding: 12px 0; \}/)
    expect(body).toMatch(/\.ib-back \{[^}]*min-height: 44px/)
    expect(body).toMatch(/\.ib-panel-head \.btn \{ min-height: 44px; \}/)
    expect(body).toMatch(/\.ib-act-row \.btn \{[^}]*min-height: 46px/)
    expect(CSS).toMatch(/\.ib-filter \{[^}]*text-decoration-line: underline/)
    expect(CSS_CODE).not.toMatch(/\.ib-filter(\[[^\]]*\])? \{[^}]*border-bottom/)
    // The screen's own half: a row tap opens the thread, ← and Escape close it.
    expect(SRC_CODE).toContain('setDetailOpen(true)')
    expect(SRC_CODE).toContain('← 一覧へ戻る')
    // ONE listener for both things that can be open, innermost first: while the
    // tour is up it owns Escape, and only once it is closed does Escape reach
    // the detail view (⚖ Liam 8/23). Two listeners would close both at once.
    expect(SRC_CODE).toContain('if (!detailOpen && !tourOpen) return')
    expect(SRC_CODE).toContain("if (e.key === 'Escape') setDetailOpen(false)")
    expect(SRC_CODE.indexOf("if (e.key === 'Escape') setTourIdx(-1)")).toBeLessThan(
      SRC_CODE.indexOf("if (e.key === 'Escape') setDetailOpen(false)"),
    )
    expect(SRC_CODE).toContain("document.addEventListener('keydown', onKey)")
    expect(SRC_CODE).toContain("document.removeEventListener('keydown', onKey)")
    // Narrowing the list is also a way back to it.
    expect(SRC_CODE).toMatch(/const choose = \(next: ThreadFilter\) => \{\s*setFilter\(next\)\s*setDetailOpen\(false\)/)
  })

  it('⚖ F5 — the one-screen swap HANDS OVER focus, in both directions', () => {
    // The swap hides whichever panel the reader was in, so the browser drops
    // focus to <body> and a keyboard reader restarts from the top of the
    // document — both on open (the focused ROW goes) and on back (the focused
    // ← goes). Focus is moved with the screen instead.
    expect(SRC_CODE).toContain('const backRef = useRef<HTMLButtonElement>(null)')
    expect(SRC_CODE).toContain('ref={backRef}')
    // On open: into the ← control.
    expect(SRC_CODE).toContain('if (phoneSwap.current) backRef.current!.focus()')
    // On close: back onto the row that opened the detail, which is why the row
    // carries an id at all — it is off screen by the time focus has to return.
    expect(SRC_CODE).toContain('id={`ibRow-${t.id}`}')
    expect(SRC_CODE).toContain('openedFrom.current = `ibRow-${t.id}`')
    expect(SRC_CODE).toContain('if (row) document.getElementById(row)?.focus()')
    // ⚖ THE BAND TEST IS THE DOM'S, NOT A RESTATED 743. The ← control is
    // rendered at every width and hidden by the sheet above the phone band, so
    // "is ← on screen" IS "is the swap in effect" — one home for the boundary
    // (the sheet), and above it this effect does nothing, which is why pressing
    // a filter on a desktop cannot yank focus out of the filter row.
    expect(SRC_CODE).toContain('backRef.current !== null && backRef.current.offsetParent !== null')
    expect(SRC_CODE).not.toMatch(/matchMedia|743/)
    expect(CSS).toMatch(/\.ib-back \{ display: none; \}/)
  })

  it('the restructure own geometry: 380px queue, actions in the band, 履歴 full width', () => {
    expect(CSS).toMatch(/\.ib-workspace \{ display: grid; grid-template-columns: 380px minmax\(0, 1fr\)/)
    expect(CSS).toMatch(/@media \(max-width: 1279px\)[\s\S]*?\.ib-workspace \{ grid-template-columns: 300px/)
    // The actions live in the panel HEADER band, not at the bottom of the body —
    // no scrolling to reach the three levers.
    const bandAt = SRC_CODE.indexOf('className="ib-band"')
    const bodyAt = SRC_CODE.indexOf('className="ib-body"')
    const actAt = SRC_CODE.indexOf('className="ib-act-row"')
    expect(bandAt).toBeGreaterThan(-1)
    expect(actAt).toBeGreaterThan(bandAt)
    expect(actAt).toBeLessThan(bodyAt)
    // 履歴 sits BELOW the two-column grid, at full width, with its direction
    // stated and two fixed columns so the connector has exactly one gap.
    const gridAt = SRC_CODE.indexOf('className="ib-grid"')
    const histAt = SRC_CODE.indexOf('className="ib-hist"')
    expect(histAt).toBeGreaterThan(gridAt)
    expect(SRC_CODE).toContain('新しい順')
    expect(CSS).toMatch(/\.ib-hist-rows \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    expect(CSS).toMatch(/\.ib-history-row:nth-child\(even\)::before/)
    // …and the connector dies when the rows stack, where there is no gap to
    // cross.
    expect(CSS.slice(CSS.indexOf('@media (max-width: 743px)'))).toContain(
      '.ib-history-row:nth-child(even)::before { display: none; }',
    )
  })

  it('both motions in the room are guarded', () => {
    // TWO transitions, each with its own reduced-motion removal: the queue row's
    // hover/selection fade, and the spotlight sliding from one section to the
    // next (⚖ Liam 8/23). Four occurrences, and a new one that arrives without
    // its guard makes this count odd — which is the point of counting.
    expect((CSS_CODE.match(/transition/g) ?? [])).toHaveLength(4)
    const quiet = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(quiet).toContain('.ib-row { transition: none; }')
    expect(quiet).toContain('.ib-spot-hole { transition: none; }')
    expect(CSS_CODE).not.toMatch(/animation|@keyframes/)
  })
})
