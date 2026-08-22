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
import { boardNow, decisions, operatingHours } from '@/business/lib/fixtures-today'
import {
  buildThreads,
  channelStates,
  isUsable,
  matchesFilter,
  recommendedChannel,
  summarize,
  threadStore,
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
    expect(SRC).toContain('aria-describedby={`ibRefusal-${current.id}`}')
    expect(SRC).toContain('aria-describedby={`ibResolve-${current.id}`}')
    expect(SRC).toContain('aria-label={`最新状態を確認 — ${props.refreshRefusal}`}')
    expect(SRC).not.toMatch(/<button[^>]*\sdisabled\b/)
  })

  it('a refusal changes NOTHING — the room holds no state a refusal could touch', () => {
    // Two useState calls and no more: the filter and the open thread. Neither
    // is written by any action, and there is no setter for a sent reply or a
    // completed thread because there is nothing to send or complete.
    expect(SRC.match(/useState/g) ?? []).toHaveLength(3) // 1 import + 2 calls
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
    expect(SRC).toContain('className="ib-refusal"')
    expect(SRC).toContain('{current.primaryRefusal}')
    expect(SRC).toContain('{current.resolveRefusal}')
    expect(CSS).toContain('.ib-refusal')
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
})

// ── 6. triage state: argued N/A, pinned ─────────────────────────────────────

describe('nothing in this room needs to survive a real navigation', () => {
  it('the only client state is the filter and the open thread', () => {
    expect(SRC).toMatch(/const \[filter, setFilter\] = useState/)
    expect(SRC).toMatch(/const \[selected, setSelected\] = useState/)
  })

  it('no session provider is mounted for this room, because there is nothing to stage', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/layout.tsx'), 'utf8')
    expect(layout).not.toContain('InboxSessionEdits')
    expect(SRC).not.toContain('SessionEdits')
    // Canon's two state changes are the reply and the completion — both writes,
    // both refused. If either is ever connected, its staged result belongs
    // above this component (flag 30's class), and this pin is where that starts.
    expect(SRC).toContain('there is no staged state for a provider to hold above the screen')
  })

  it('the open thread follows the filter rather than describing a hidden row', () => {
    const rows = build(STORE_A)
    const resolvedOnly = rows.filter((t) => matchesFilter(t, 'resolved'))
    expect(resolvedOnly.map((t) => t.id)).toEqual(['inb-noshow'])
    expect(SRC).toContain('visible.find((t) => t.id === selected) ?? visible[0] ?? null')
  })

  it('every filter chip is canon own, in canon own order', async () => {
    const props = await room({ store: STORE_A })
    expect(props.filters.map((f) => f.key)).toEqual([
      'open',
      'change',
      'noshow',
      'waitlist',
      'delivery',
      'resolved',
    ])
    expect(props.filters.map((f) => f.label)).toEqual([
      '未完了',
      '予約変更',
      '来店なし',
      '空き待ち',
      '配信失敗',
      '解決済み',
    ])
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
    // Only ONE element in this room ellipsises, and it is canon's own preview
    // line; everything else wraps.
    expect((CSS.match(/text-overflow: ellipsis/g) ?? [])).toHaveLength(1)
    expect(CSS).toMatch(/\.ib-preview \{[^}]*text-overflow: ellipsis/)
    expect(CSS).toMatch(/\.ib-fact b \{[^}]*word-break: break-word/)
    expect(CSS).toMatch(/\.ib-channel b \{[^}]*word-break: break-word/)
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
    // The ONE axis a container owns here is X, on the filter strip — so the
    // chips pan and the page body never scrolls sideways.
    const overflowX = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*overflow-x:\s*auto/g)].map((m) => m[1].trim())
    expect(overflowX).toHaveLength(1)
    expect(overflowX[0]).toContain('.ib-filters')
    // `overflow: hidden` on the panels is a CLIP for the rounded corners, not a
    // scroller — it creates no scroll container the wheel can fall into.
    expect(CSS_CODE).not.toMatch(/overflow:\s*auto/)
    expect(CSS_CODE).not.toMatch(/overflow:\s*scroll/)
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
    // four shapes because every element this room owns carries an `ib-` name
    // that exists nowhere else in the family — a fence that cannot rot.
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
    expect([...reachable].sort()).toEqual([
      '.biz .btn',
      '.biz .btn.primary',
      '.biz .page',
      '.biz .page .btn',
      '.biz .page h1',
    ])
    // …and every one of them is answered at FOUR levels, which beats a
    // sibling's three and removes the insertion-order coin flip.
    for (const fence of [
      '.biz .page.pg-inbox {',
      '.biz .page.pg-inbox h1 {',
      '.biz .page.pg-inbox .btn {',
      '.biz .page.pg-inbox .btn.primary {',
    ]) {
      expect(CSS).toContain(fence)
    }
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
    const pairs: Array<[string, string]> = [
      ['.page', '.biz .page.pg-inbox {'],
      ['.page h1', '.biz .page.pg-inbox h1 {'],
      ['.page .btn', '.biz .page.pg-inbox .btn {'],
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

  it('R13 — the pressed chip and the selected row are washes, never fills', () => {
    expect(CSS).toMatch(/\.ib-filter\[aria-pressed="true"\] \{[^}]*background: var\(--select-bg\)/)
    expect(CSS).toMatch(/\.ib-row\.selected \{[^}]*background: var\(--indigo-soft\)/)
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|black|var\(--ink\))/)
    // The only solid accent in the room would be a commit button, and this room
    // has none — every action is refused.
    expect(SRC_CODE).not.toContain('btn primary')
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
    expect(PAGE_SRC).toContain('const now = renderNow()')
    expect((PAGE_SRC.match(/new Date\(\)/g) ?? [])).toHaveLength(0)
    expect((PAGE_SRC.match(/renderNow\(\)/g) ?? [])).toHaveLength(1)
  })

  it('canon subtitle and head note are carried word for word', async () => {
    const props = await room({ store: STORE_A })
    expect(props.subtitle).toBe(
      '予約変更、来店なし、空き待ち、配信失敗を、期限と連絡許可の事実から処理します。',
    )
    expect(props.headNote).toBe(
      'メッセージの数ではなく、店舗が次に行う対応を並べています。顧客カルテの施術内容はここには表示しません。',
    )
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
