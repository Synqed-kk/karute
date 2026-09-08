/**
 * カルテ — the transplanted room's pins.
 *
 * THE ONE THING THIS SUITE IS FOR: A RECORD IS THE PHONE APP'S RECORD, AND THIS
 * ROOM ONLY READS IT BACK. Not one fact about a person, a day, a store, a staff
 * member or a menu is written down in this room's own plane — every one of them
 * is READ through the booking a record joins, so the computer door and the phone
 * cannot disagree about what happened in a session. That is asserted as
 * EQUALITIES AGAINST THE WORLD rather than as spot checks, and as a SOURCE SCAN
 * against the plane, because the W7 candidate's breach was exactly this: a plane
 * that restated the world, and deleted two of the world's own assertions to make
 * itself fit.
 *
 * Second job: TWO REDACTIONS, BOTH ABOVE THE SERIALIZER. Another store's records
 * never enter the props, and a 破棄済み record's content never enters them for a
 * reader who may not read it — so neither can be in the browser's payload for a
 * screen to "hide". Both are proven by scanning the SERIALIZED props for strings
 * that must not be anywhere in them.
 *
 * Third job: EVERY EDIT IS A WRITE and this room has none. Every control canon
 * carries — 記入内容の編集, AIで再生成, 詳細記録を編集, メッセージの編集・送信,
 * 結果を変更, 顧客変更 — ships refused with its OWN reason, and there is no
 * delete lever anywhere (⚖ #547).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jstDayKey, jstSlot, jstYmd } from '@/business/lib/clock'
import { appointments, customers, menus, operator, staff, STORE_A, STORE_B, type FixtureAppointment } from '@/business/lib/fixtures'
import { records as recordPlane, type FixtureKaruteRecord } from '@/business/lib/fixtures-karute'
import {
  accessFor,
  buildRecords,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  FILTERS,
  matchesFilter,
  matchesReveal,
  matchesSearch,
  monthCensus,
  normalizeForSearch,
  permissionNotice,
  revealCandidates,
  searchHay,
  OUTCOME_PILL,
  STATE_PILL,
  stateOf,
  weekWindow,
  WINDOW_DAYS,
  windowRows,
  type KaruteRecordModel,
} from '@/business/lib/karute'
import { karuteProps } from '@/app/[locale]/(business)/business/karute/karute-props'

const ROOM_DIR = 'src/app/[locale]/(business)/business/karute'
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PLANE_SRC = read('src/business/lib/fixtures-karute.ts')
const LIB_SRC = read('src/business/lib/karute.ts')
const SCREEN_SRC = read(`${ROOM_DIR}/KaruteScreen.tsx`)
const PROPS_SRC = read(`${ROOM_DIR}/karute-props.ts`)
const PAGE_SRC = read(`${ROOM_DIR}/page.tsx`)
const CSS_SRC = read(`${ROOM_DIR}/karute.css`)
const WORLD_SRC = read('src/business/lib/fixtures.ts')

/** Source pins read CODE, not prose: this room documents its own rules in
 *  comments that quote the very strings the pins look for. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PLANE_CODE = stripComments(PLANE_SRC)
const SCREEN_CODE = stripComments(SCREEN_SRC)
const PROPS_CODE = stripComments(PROPS_SRC)
const CSS_CODE = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '')

/** THE ONE PARSER (F-K11) — see the fence describe below for why splitting on
 *  '}' alone is blind to the first rule of every @media block. */
const allSelectors = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:keyframes|font-face|counter-style|property)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/@(?:media|supports|layer|container)[^{]*\{/g, '')
    .split('}')
    .flatMap((block) => {
      const i = block.indexOf('{')
      return i < 0 ? [] : block.slice(0, i).split(',').map((x) => x.trim()).filter(Boolean)
    })
    .filter((x) => !x.startsWith('@'))

const NOW = new Date()
const TODAY = jstDayKey(NOW)
const YMD = jstYmd(NOW)
const MANAGER = accessFor('店舗管理者')
const STAFF = accessFor('スタッフ')

const world = (over: Partial<Parameters<typeof buildRecords>[0]> = {}) =>
  buildRecords({
    records: recordPlane,
    appointments: appointments(NOW).filter((a) => a.store_id === STORE_A),
    customers,
    menus,
    staff,
    todayKey: TODAY,
    todayWeekday: YMD.wd,
    access: MANAGER,
    ...over,
  })

/** Pin the render clock. Only the zero-argument construction is faked; the
 *  calendar arithmetic needs real `new Date(iso)` AND the statics (`Date.UTC`
 *  builds every coordinate in clock.ts), so they are carried across — a stub
 *  without them fails inside the code under test rather than proving anything
 *  about it. Same idiom as shifts.test.ts / analytics.test.ts / register.test.ts
 *  / inbox.test.ts.
 *
 *  Only ONE test in this file needs it: 「the discarded row is COUNTED in the
 *  census…」 below reads K-0005 through `apt-10`, which fixtures.ts places at a
 *  RELATIVE `day: -2` from whoever is looking (⚖ L-6) — 2 JST-calendar-days
 *  before `karuteProps()`'s own `renderNow()`. That holds K-0005 inside 今月 on
 *  every date except the 1st and 2nd of a month, where `today - 2` lands in the
 *  PREVIOUS month and the census's `（うち破棄 N件）` parenthesis silently drops.
 *  Every other assertion in this file either compares two sides derived from
 *  the SAME real `NOW` (self-consistent on any date) or names a fixed relative
 *  offset far enough from a month edge to never cross it, so only this one test
 *  is pinned — anchored on the 22nd, the date every sibling suite already uses. */
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

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠ THE FIXTURE FENCE — the plane ADDS, and states nothing the world states', () => {
  // The W7 breach class, pinned from both sides.

  it('the plane names no customer, no store, no staff, no menu and no date', () => {
    const forbidden = [
      ...customers.map((c) => c.name),
      ...customers.map((c) => c.member_number),
      ...customers.flatMap((c) => (c.furigana ? [c.furigana] : [])),
      ...staff.map((s) => s.full_name),
      ...menus.map((m) => m.name),
      STORE_A,
      STORE_B,
      'テスト銀座店',
      'テスト代官山店',
    ]
    const hits = forbidden.filter((needle) => PLANE_CODE.includes(needle))
    expect({ hits }).toEqual({ hits: [] })
    // …and no absolute date either (⚖ L-6): the booking owns the calendar.
    expect(PLANE_CODE).not.toMatch(/\b20\d\d-\d\d-\d\d\b/)
  })

  it('the plane imports nothing at all — it cannot reach the world to restate it', () => {
    expect(PLANE_CODE).not.toMatch(/\bimport\b/)
  })

  it('the dependency is ONE WAY — the world knows nothing about karute', () => {
    // The breach was a plane that made the WORLD fit it. A world that cannot
    // name this room cannot have been edited to accommodate it.
    expect(WORLD_SRC.toLowerCase()).not.toContain('karute')
  })

  it('every record joins a booking the world ALREADY had, with a customer and a staff member', () => {
    const byId = new Map(appointments(NOW).map((a) => [a.id, a]))
    for (const r of recordPlane) {
      const booking = byId.get(r.appointment_id)
      expect({ record: r.id, booking: booking?.id }).toEqual({ record: r.id, booking: r.appointment_id })
      expect(customers.some((c) => c.id === booking!.customer_id)).toBe(true)
      expect(booking!.staff_id).not.toBeNull()
    }
  })

  it('no record describes a session that has not happened (⚖ 8/9 demo-data-product-truth)', () => {
    const byId = new Map(appointments(NOW).map((a) => [a.id, a]))
    for (const r of recordPlane) {
      expect({ record: r.id, status: byId.get(r.appointment_id)!.status }).toEqual({ record: r.id, status: 'done' })
    }
  })

  it('two records never share one booking, and no カルテ番号 repeats', () => {
    expect(new Set(recordPlane.map((r) => r.appointment_id)).size).toBe(recordPlane.length)
    expect(new Set(recordPlane.map((r) => r.id)).size).toBe(recordPlane.length)
  })

  it('the world census is exactly what it was — nothing was deleted to make a record fit', () => {
    // The W7 candidate deleted two canonical fixture assertions. Pinning the
    // world's own ids means removing or renaming one to accommodate this plane
    // fails HERE rather than silently.
    expect(customers.map((c) => c.id)).toEqual([
      'cus-01', 'cus-02', 'cus-03', 'cus-04', 'cus-05', 'cus-06', 'cus-07',
      'cus-08', 'cus-09', 'cus-10', 'cus-11', 'thin-01', 'thin-02',
    ])
    expect(staff.map((s) => s.id)).toEqual(['p-01', 'p-02', 'c-03', 'p-04', 'p-05', 'p-06', 'p-09'])
    expect(appointments(NOW).length).toBe(34)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the record model — read through the booking, never restated', () => {
  it('every fact on a row comes from the world, matching the booking it joins', () => {
    const rows = world()
    const byId = new Map(appointments(NOW).map((a) => [a.id, a]))
    for (const row of rows) {
      const plane = recordPlane.find((r) => r.id === row.id)!
      const booking = byId.get(plane.appointment_id)!
      const customer = customers.find((c) => c.id === booking.customer_id)!
      expect(row.customerName).toBe(customer.name)
      expect(row.memberNumber).toBe(customer.member_number)
      expect(row.furigana).toBe(customer.furigana)
      expect(row.staffName).toBe(staff.find((s) => s.id === booking.staff_id)!.full_name)
      expect(row.service).toBe(menus.find((m) => m.id === booking.menu_id)!.name)
      expect(row.bookingNo).toBe(booking.display_no)
      expect(row.dayKey).toBe(jstDayKey(booking.starts_at))
      expect(row.storeId).toBe(booking.store_id)
    }
  })

  it('rows come back newest first, and a tie is broken by カルテ番号 rather than by luck', () => {
    const rows = world()
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].dayKey).toBeGreaterThanOrEqual(rows[i].dayKey)
      if (rows[i - 1].dayKey === rows[i].dayKey) {
        expect(rows[i - 1].id < rows[i].id).toBe(true)
      }
    }
  })

  it('来店回数 counts the customer’s own completed visits up to this session', () => {
    const rows = world()
    const done = appointments(NOW)
      .filter((a) => a.store_id === STORE_A && a.status === 'done')
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    for (const row of rows) {
      const plane = recordPlane.find((r) => r.id === row.id)!
      const mine = done.filter((a) => a.customer_id === row.customerId)
      expect(row.visitNumber).toBe(mine.findIndex((a) => a.id === plane.appointment_id) + 1)
    }
    // 見本 いつき has exactly two completed 銀座 sessions: the 22-day-old one is
    // her first, today's is her second — a number the room DERIVES from the
    // world's bookings rather than a number anybody stored.
    expect(rows.find((r) => r.id === 'K-0010')!.visitNumber).toBe(1)
    expect(rows.find((r) => r.id === 'K-0001')!.visitNumber).toBe(2)
  })

  it('前回 is the session before this one, and a first visit has none', () => {
    const rows = world()
    expect(rows.find((r) => r.id === 'K-0010')!.previousDayKey).toBeNull()
    const first = rows.find((r) => r.id === 'K-0001')!
    expect(first.previousDayKey).toBe(jstDayKey(jstSlot(-22, 11, 0, NOW)))
  })

  it('the eight drawers render in the PHONE’s order, and carry the phone’s labels', () => {
    expect(CATEGORY_ORDER).toEqual(['concern', 'condition', 'lifestyle', 'treatment', 'preference', 'product', 'next', 'note'])
    // messages/ja.json karuteDetail.currentSession.categories.* — the labels a
    // staff member sees on the phone when they write the line.
    expect(CATEGORY_LABEL).toEqual({
      concern: '気になる点', condition: '部位', lifestyle: 'ライフスタイル', treatment: '施術',
      preference: '好み', product: '製品', next: '次回', note: 'メモ',
    })
    const rich = world().find((r) => r.id === 'K-0001')!
    expect(rich.entries.map((e) => e.label)).toEqual(CATEGORY_ORDER.map((c) => CATEGORY_LABEL[c]))
  })

  it('手書き marks the lines a person wrote, and only those', () => {
    const rich = world().find((r) => r.id === 'K-0001')!
    const plane = recordPlane.find((r) => r.id === 'K-0001')!
    for (const e of rich.entries) {
      const source = plane.entries.find((x) => CATEGORY_LABEL[x.category] === e.label)!
      expect(e.handwritten).toBe(source.author === 'staff')
    }
    expect(rich.entries.filter((e) => e.handwritten).length).toBeGreaterThan(0)
  })

  it('a rewritten summary is the one that shows, and the amber pencil says so', () => {
    const edited = world().find((r) => r.id === 'K-0008')!
    const plane = recordPlane.find((r) => r.id === 'K-0008')!
    expect(edited.summaryEdited).toBe(true)
    expect(edited.summaryBullets.join('\n')).toBe(plane.summary_edited)
    expect(edited.summaryBullets.join('\n')).not.toBe(plane.summary_ai)
    expect(world().find((r) => r.id === 'K-0001')!.summaryEdited).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the record’s state — one home, canon’s own precedence', () => {
  it('nothing written beats every other question (canon aiChipHtml)', () => {
    expect(stateOf({ entries: [], summary_ai: 'x', summary_state: 'confirmed', discarded: null })).toBe('provisional')
  })
  it('破棄 beats even that — a thrown-away record is not a 下書き to finish', () => {
    expect(stateOf({
      entries: [], summary_ai: null, summary_state: null,
      discarded: { minute: 1, by_staff_id: 'p-01', reason: '誤って別の予約に作成' },
    })).toBe('discarded')
  })
  it('no summary yet = AI補完待ち; unconfirmed = 下書き; confirmed = AI要約済', () => {
    const e = [{ category: 'note' as const, text: 'x', author: 'ai' as const }]
    expect(stateOf({ entries: e, summary_ai: null, summary_state: null, discarded: null })).toBe('pending')
    expect(stateOf({ entries: e, summary_ai: 'x', summary_state: 'draft', discarded: null })).toBe('draft')
    expect(stateOf({ entries: e, summary_ai: 'x', summary_state: 'confirmed', discarded: null })).toBe('summarized')
  })
  it('⚖ 記録の履歴 really is 新しい順 — proven on a record that has BOTH (F-K7)', () => {
    // The section printed 「新しい順」 and sorted nothing: the discard row was
    // rendered first unconditionally, then the edits in array order. Unreachable
    // in the shipped world (the discarded record has no edits), which is exactly
    // why it needs a crafted one — a claim its own rendering does not produce.
    const crafted = recordPlane.map((r) =>
      r.id === 'K-0005'
        ? {
            ...r,
            summary_edits: [
              { minute: 9 * 60, by_staff_id: 'p-01', note: '破棄より前の編集' },
              { minute: 23 * 60, by_staff_id: 'p-06', note: '破棄より後の編集' },
            ],
          }
        : r,
    )
    const row = world({ records: crafted }).find((r) => r.id === 'K-0005')!
    expect(row.history.map((h) => h.minute)).toEqual([23 * 60, 12 * 60 + 20, 9 * 60])
    expect(row.history.map((h) => h.kind)).toEqual(['edit', 'discard', 'edit'])
    // Strictly descending, whatever the world hands it.
    for (let i = 1; i < row.history.length; i += 1) {
      expect(row.history[i - 1].minute).toBeGreaterThanOrEqual(row.history[i].minute)
    }
  })

  it('⚖ 破棄済み IS NEVER A WARNING COLOUR (Liam 8/25 ruling B’s rendering law)', () => {
    // A staffer must never hesitate to throw away a genuinely bad take in order
    // to protect the colour of a row.
    expect(STATE_PILL.discarded).toBe('pill')
    expect(STATE_PILL.discarded).not.toMatch(/alert|warn|bad/)
    expect(CSS_CODE).not.toMatch(/is-discarded[^{]*\{[^}]*var\(--red/)
  })
  it('the demo world carries every state a records desk has to show', () => {
    const seen = new Set(world().map((r) => r.state))
    expect([...seen].sort()).toEqual(['discarded', 'draft', 'pending', 'provisional', 'summarized'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE DISCARD DOCTRINE (Liam 8/20 ①②③ + R2 + 8/25 ruling B)', () => {
  it('① the row EXISTS for everyone, including a staff member', () => {
    const asStaff = world({ access: STAFF })
    expect(asStaff.some((r) => r.id === 'K-0005')).toBe(true)
    expect(asStaff.find((r) => r.id === 'K-0005')!.state).toBe('discarded')
    // …and it keeps the census facts, which is what makes the list the store's
    // own truth: the person it was bound to at record time (⚖ R3 — facts, not
    // choice), the day, the staff member and the service.
    const row = asStaff.find((r) => r.id === 'K-0005')!
    expect(row.customerName).toBe('見本 そら')
    expect(row.staffName).toBe('見本 はなこ')
  })

  it('② the CONTENT is a 店舗管理者 read — and it is withheld, never hidden', () => {
    const asStaff = world({ access: STAFF }).find((r) => r.id === 'K-0005')!
    expect(asStaff.entries).toEqual([])
    expect(asStaff.summaryBullets).toEqual([])
    expect(asStaff.photos).toEqual([])
    expect(asStaff.aiMessage).toBeNull()
    expect(asStaff.preview).toBeNull()
    expect(asStaff.discarded).toEqual({ at: expect.any(Number), by: '見本 はなこ', reason: null, hadTicketBurn: false })
    // ⚖ 8/20 (b) — the ticket SIGNAL is a manager read like the reason, so it is
    // withheld above the serializer too, and its absence is measured (F-K6).
    expect(asStaff.contentWithheld).toBe(true)
    expect(asStaff.history.every((h) => h.note === null)).toBe(true)

    const asManager = world().find((r) => r.id === 'K-0005')!
    expect(asManager.discarded!.reason).toContain('別のお客様の予約')
    expect(asManager.entries.length).toBe(1)
    expect(asManager.contentWithheld).toBe(false)
    // The manager IS told a ticket was consumed — R2 keeps it out of every
    // number, it does not erase the fact the correction is owed (F-K6).
    expect(asManager.discarded!.hadTicketBurn).toBe(true)
  })

  it('③ the written reason is free text, attached to the row, and never a menu', () => {
    const reason = recordPlane.find((r) => r.id === 'K-0005')!.discarded!.reason
    expect(reason.length).toBeGreaterThan(20)
    // No category vocabulary survives anywhere in the plane (⚖ 8/17: per-category
    // discards were killed — every discard is a sentence somebody wrote).
    expect(PLANE_CODE).not.toMatch(/'(quality|duplicate|wrong_target|not_session)'/)
  })

  it('⚖ R2 — A DISCARDED RECORD FEEDS NOTHING, for EVERY reader, manager included', () => {
    // ⚠ THE FIXTURE HAS TO HOLD SOMETHING FOR THE GUARD TO STRIP, or this pin is
    // true because the data is empty rather than because the rule works — which
    // is exactly how it read until the battery's M12 survived. Asserted FIRST,
    // so emptying the fixture can never quietly re-create the blind spot.
    const plane = recordPlane.find((r) => r.id === 'K-0005')!
    expect(plane.outcome).not.toBeNull()
    expect(plane.ticket_redeemed).toBe(true)
    for (const access of [MANAGER, STAFF]) {
      const row = world({ access }).find((r) => r.id === 'K-0005')!
      expect(row.outcome).toBeNull()
      expect(row.ticketRedeemed).toBe(false)
    }
  })

  it('the discarded row is COUNTED in the census and NAMED apart from it', async () => {
    // K-0005 (apt-10) sits at a fixture `day: -2` from `renderNow()`, so it
    // falls out of 今月 on the 1st and 2nd of any month (see the file-header
    // comment on `pin`) — pinned to the 22nd so this assertion is true on every
    // calendar, not just the one CI happened to run on.
    const restore = pin('2026-08-22T03:00:00.000Z')
    try {
      const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
      // Existence is never hidden (①), so the month total includes it — and ⚖ R2
      // means a reader must be able to take it back out without arithmetic.
      expect(props.monthLabel).toMatch(/^カルテ 今月 \d+件（うち破棄 \d+件）$/)
      // …but ONLY when there is one. A parenthesis about zero discards would be
      // an editorial about nothing.
      const quiet = await karuteProps({
        locale: 'ja', store: STORE_A,
        world: { records: recordPlane.filter((r) => r.discarded === null) },
      })
      expect(quiet.props.monthLabel).toMatch(/^カルテ 今月 \d+件$/)
    } finally {
      restore()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ STORE ISOLATION, both directions, and LEAVES NOTHING BEHIND', () => {
  it('a 銀座 lens returns only 銀座 records; a 代官山 lens only 代官山 ones', async () => {
    const a = await karuteProps({ locale: 'ja', store: STORE_A })
    const b = await karuteProps({ locale: 'ja', store: STORE_B })
    expect(a.props.rows.map((r) => r.id).sort()).toEqual([
      'K-0001', 'K-0002', 'K-0003', 'K-0004', 'K-0005', 'K-0006', 'K-0007', 'K-0008', 'K-0009', 'K-0010',
      'K-0014',
    ])
    expect(b.props.rows.map((r) => r.id).sort()).toEqual(['K-0011', 'K-0012', 'K-0013'])
  })

  it('the OTHER store’s customer names, カルテ番号 and summaries are nowhere in the payload', async () => {
    const a = JSON.stringify((await karuteProps({ locale: 'ja', store: STORE_A })).props)
    const b = JSON.stringify((await karuteProps({ locale: 'ja', store: STORE_B })).props)
    // The 銀座 payload must not carry 代官山's records, in any field.
    for (const id of ['K-0011', 'K-0012', 'K-0013']) expect(a).not.toContain(id)
    for (const id of ['K-0001', 'K-0005', 'K-0010']) expect(b).not.toContain(id)
    // …nor the other store's own name, nor a summary only the other store has.
    expect(a).not.toContain('テスト代官山店')
    expect(a).not.toContain('目の疲れ')
    expect(b).not.toContain('テスト銀座店')
    expect(b).not.toContain('肩から背中の張り')
    // …nor a customer only the other store ever served.
    expect(b).not.toContain('見本 そら')
    // ⚖ THE DESIGN ROUND ADDED A CONTACT ROW, SO THE CLAMP HAS TO COVER IT.
    // A phone number is the one field on the new person header that is not
    // derivable from anything already in the payload, so the isolation proof is
    // asked about it directly — and the customers to ask about are DERIVED from
    // the two lenses rather than named, so a fixture change cannot quietly turn
    // this into a pin about nobody.
    const aRows = (await karuteProps({ locale: 'ja', store: STORE_A })).props.rows
    // A contact belongs in this payload ONLY for a person this desk has a record
    // of. Everybody else's — the other store's customers, and this store's own
    // record-less ones, who appear in the reveal by NAME and must not appear by
    // telephone — is a stranger, and a stranger's number must be nowhere in it.
    const named = new Set(aRows.map((r) => r.customerId))
    const strangers = customers.filter((c) => !named.has(c.id) && c.phone)
    expect(strangers.length).toBeGreaterThan(0)
    for (const c of strangers) expect({ id: c.id, leaked: a.includes(c.phone!) }).toEqual({ id: c.id, leaked: false })
    // …and the reader's OWN store's contacts really are there, or the pin above
    // would be true because nobody ships a phone number at all.
    expect(aRows.some((r) => r.phone !== null && a.includes(r.phone))).toBe(true)
  })

  it('a 破棄済み record’s reason and content are nowhere in a staff member’s payload', async () => {
    const staffView = JSON.stringify(
      (await karuteProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })).props,
    )
    expect(staffView).not.toContain('別のお客様の予約に紐づけて')
    expect(staffView).not.toContain('別のお客様の内容を書き始めて')
    // …and the row itself is still there, which is the whole point of ⚖ ①.
    expect(staffView).toContain('K-0005')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('search — six fields, canon’s normaliser, and nothing else', () => {
  it('canon’s normaliser: NFKC · case · hiragana→katakana · spaces · the dash family', () => {
    expect(normalizeForSearch('ミホン アカリ')).toBe(normalizeForSearch('みほんあかり'))
    expect(normalizeForSearch('Ｃ-3001')).toBe(normalizeForSearch('c3001'))
    expect(normalizeForSearch('K‐0001')).toBe(normalizeForSearch('k0001'))
    expect(normalizeForSearch('ﾃｽﾄ')).toBe(normalizeForSearch('テスト'))
    expect(normalizeForSearch(null)).toBe('')
  })

  it('all SIX promised fields find their record', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const rich = props.rows.find((r) => r.id === 'K-0001')!
    for (const q of [rich.customerName, rich.furigana!, rich.memberNumber, rich.id, rich.service, rich.staffName]) {
      expect(matchesSearch(rich, q)).toBe(true)
    }
    // …and the placeholder promises exactly those six, in that order.
    expect(SCREEN_CODE).toContain('顧客名・かな・顧客番号・カルテ番号・サービス・スタッフで検索')
  })

  it('THE SUMMARY IS NOT INDEXED — the box matches six fields, and says six', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const rich = props.rows.find((r) => r.id === 'K-0001')!
    expect(rich.preview).toContain('肩から背中の張り')
    // A staff member typing a phrase out of a record's content must not be able
    // to surface it through the search box — that is the ⚖ 8/20 ② read, taken
    // by the back door.
    expect(matchesSearch(rich, '肩から背中の張り')).toBe(false)
    expect(searchHay(rich)).not.toContain(normalizeForSearch(rich.preview!))
  })

  it('an empty query matches everything, and never narrows by accident', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(props.rows.every((r) => matchesSearch(r, '   '))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE PILL/COUNT LAW — a count is what its own tap reveals', () => {
  it('every filter’s count equals the rows that filter contains, under every scope', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    for (const scope of [null, props.selfStaffId]) {
      const scoped = scope === null ? props.rows : props.rows.filter((r) => r.staffId === scope)
      for (const f of FILTERS) {
        const revealed = scoped.filter((r) => matchesFilter(r, f.key))
        // The count the chip prints IS this number, computed by this predicate.
        expect(revealed.every((r) => matchesFilter(r, f.key))).toBe(true)
        expect(scoped.filter((r) => matchesFilter(r, f.key)).length).toBe(revealed.length)
      }
    }
  })

  it('⚖ the 担当 scope law is proven on a NON-EMPTY self set (F-K2 / B3-3)', async () => {
    // The count law's scope half used to reduce to `0 === 0 + 0`: the operator
    // staffed no completed session anywhere in the world, so 自分 was 0件 in
    // every lens and the guard could not bite. The world now gives her one
    // (apt-35), which is also what lets a reader SEE the filter work.
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const mine = props.rows.filter((r) => r.staffId === props.selfStaffId)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.staffName === operator.name)).toBe(true)
    // …and it is a STRICT subset, so the chip really narrows rather than
    // agreeing with 全スタッフ by accident.
    expect(mine.length).toBeLessThan(props.rows.length)
    for (const f of FILTERS) {
      const revealed = mine.filter((r) => matchesFilter(r, f.key))
      expect(revealed.every((r) => matchesFilter(r, f.key) && r.staffId === props.selfStaffId)).toBe(true)
    }
  })

  it('すべて really is all of them, and the three narrow strictly', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(props.rows.filter((r) => matchesFilter(r, 'all')).length).toBe(props.rows.length)
    for (const key of ['week', 'pending', 'draft'] as const) {
      expect(props.rows.filter((r) => matchesFilter(r, key)).length).toBeLessThan(props.rows.length)
    }
  })

  it('AI補完待ち and 下書き name the state they filter, and nothing near it', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(props.rows.filter((r) => matchesFilter(r, 'pending')).every((r) => r.state === 'pending')).toBe(true)
    expect(props.rows.filter((r) => matchesFilter(r, 'draft')).every((r) => r.state === 'draft')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('今週 — canon’s Monday-start week, on every weekday', () => {
  it('a Monday-start window, seven days long, on all seven weekdays', () => {
    // The naive `1 - getDay()` is six days wrong on a SUNDAY, which is the one
    // day a shop is most likely to be reading a week's records on.
    for (let wd = 0; wd < 7; wd += 1) {
      const { from, to } = weekWindow(1000, wd)
      expect(to - from).toBe(6)
      expect(from).toBeLessThanOrEqual(1000)
      expect(to).toBeGreaterThanOrEqual(1000)
    }
    expect(weekWindow(1000, 0)).toEqual({ from: 994, to: 1000 }) // Sunday closes its week
    expect(weekWindow(1000, 1)).toEqual({ from: 1000, to: 1006 }) // Monday opens it
  })

  it('今週 on a row is the window’s own answer, never a second opinion', () => {
    const rows = world()
    const { from, to } = weekWindow(TODAY, YMD.wd)
    for (const r of rows) expect(r.thisWeek).toBe(r.dayKey >= from && r.dayKey <= to)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('今月 — a JST CALENDAR month, not a 30-day window', () => {
  it('counts the rows whose session falls in the render’s own JST month', () => {
    const rows = world()
    const census = monthCensus(rows, YMD.y, YMD.m)
    const byHand = rows.filter((r) => {
      const d = new Date(r.dayKey * 86_400_000)
      return d.getUTCFullYear() === YMD.y && d.getUTCMonth() + 1 === YMD.m
    })
    expect(census.total).toBe(byHand.length)
    expect(census.discarded).toBe(byHand.filter((r) => r.discarded !== null).length)
  })

  it('the 60-day-old record is outside 今月 under every calendar', () => {
    const all = buildRecords({
      records: recordPlane, appointments: appointments(NOW), customers, menus, staff,
      todayKey: TODAY, todayWeekday: YMD.wd, access: MANAGER,
    })
    const old = all.find((r) => r.id === 'K-0013')!
    const d = new Date(old.dayKey * 86_400_000)
    expect(d.getUTCFullYear() === YMD.y && d.getUTCMonth() + 1 === YMD.m).toBe(false)
    expect(monthCensus([old], YMD.y, YMD.m).total).toBe(0)
  })

  it('the PAGE reads the JST calendar, never the server’s own month', () => {
    // `monthCensus` is proven below on its own; this is the other half — that the
    // room FEEDS it JST values. A render that took the month off `getUTCMonth()`
    // agrees with JST for most of the day and disagrees for the nine hours that
    // matter, which is why nothing behavioural caught it (battery M16 survived
    // its first run): the pin has to be on the read itself.
    expect(PROPS_CODE).toContain('const { y, m, wd } = jstYmd(now)')
    expect(PROPS_CODE).toContain('monthCensus(models, y, m)')
    expect(PROPS_CODE).not.toMatch(/getUTCMonth|getUTCFullYear|\.getMonth\(|\.getFullYear\(/)
  })

  it('the boundary is JST’s, so a record at 00:30 JST on the 1st belongs to the NEW month', () => {
    // 2026-08-31T15:30Z is already 00:30 JST on 9/1. Read in UTC that is still
    // August; read in JST it is September, and the census must say September.
    const dayKey = jstDayKey('2026-08-31T15:30:00Z')
    const row = { dayKey, discarded: null } as unknown as KaruteRecordModel
    expect(monthCensus([row], 2026, 9).total).toBe(1)
    expect(monthCensus([row], 2026, 8).total).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ CHUNK-LOADING + ANY-ROSTER-SIZE — the windowed backward walk at scale', () => {
  /** 200 records on 200 synthetic bookings, driven through the REAL derivations
   *  — one session per day walking backwards, so the window arithmetic has
   *  something honest to be exact about. */
  const synthetic = (count: number) => {
    const appts: FixtureAppointment[] = Array.from({ length: count }, (_, i) => ({
      id: `apt-syn-${i}`,
      store_id: STORE_A,
      customer_id: customers[i % customers.length].id,
      staff_id: staff[i % 5].id,
      menu_id: menus[i % 3].id,
      starts_at: jstSlot(-i, 10, 0, NOW),
      ends_at: jstSlot(-i, 11, 0, NOW),
      booked_price: 6600,
      status: 'done',
      display_no: `R-9${String(i).padStart(3, '0')}`,
      board_state: null,
      settlement: null,
      resource_id: null,
      source: '合成',
      reassigned_from: null,
      taken_days_ago: 1,
      updated_minute: null,
    }))
    const recs: FixtureKaruteRecord[] = appts.map((a, i) => ({
      id: `K-9${String(i).padStart(3, '0')}`,
      appointment_id: a.id,
      entries: [{ category: 'treatment', text: `合成記録 ${i}`, author: 'ai' }],
      summary_ai: `合成要約 ${i}`,
      summary_edited: null,
      summary_edits: [],
      summary_state: i % 3 === 0 ? 'confirmed' : i % 3 === 1 ? 'draft' : null,
      photos: [],
      ai_message: null,
      recording: { consent: true },
      outcome: { status: 'revisit', reason: null },
      ticket_redeemed: false,
      discarded: null,
    }))
    return { appts, recs }
  }

  it('200 records: every window step is exact, and the walk covers all of them', async () => {
    const { appts, recs } = synthetic(200)
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A, world: { records: recs, appointments: appts } })
    expect(props.rows.length).toBe(200)

    // One session per day, newest first: step N covers exactly N*14 days, which
    // is N*14 rows until the set runs out.
    let seen = 0
    for (let step = 1; step <= 15; step += 1) {
      const walk = windowRows(props.rows, step)
      const expected = Math.min(step * WINDOW_DAYS, 200)
      expect({ step, visible: walk.visible.length, hidden: walk.hidden }).toEqual({
        step, visible: expected, hidden: 200 - expected,
      })
      expect(walk.visible.length).toBeGreaterThanOrEqual(seen)
      seen = walk.visible.length
    }
    expect(windowRows(props.rows, 15).hidden).toBe(0)
  })

  it('the visible set is always a PREFIX of the list — the walk never skips a record', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ dayKey: 1000 - i }))
    for (let step = 1; step <= 15; step += 1) {
      const walk = windowRows(rows, step)
      expect(walk.visible).toEqual(rows.slice(0, walk.visible.length))
    }
  })

  it('a window that reveals nothing is not a step the reader has to press twice', () => {
    // A quiet six weeks between two records: one press must cross it.
    const rows = [{ dayKey: 1000 }, { dayKey: 940 }]
    expect(windowRows(rows, 1).visible.length).toBe(1)
    expect(windowRows(rows, 2).visible.length).toBe(2)
    expect(windowRows(rows, 2).hidden).toBe(0)
  })

  it('an empty list has no walk, and a walk past the oldest record simply ends', () => {
    expect(windowRows([], 1)).toEqual({ visible: [], hidden: 0, cutoff: null })
    const rows = [{ dayKey: 10 }, { dayKey: 9 }]
    expect(windowRows(rows, 99).hidden).toBe(0)
    expect(windowRows(rows, 0).visible.length).toBe(2)
  })

  it('⚖ A SEARCH IS A LOOKUP — its matches are never hidden behind the walk (F-K10)', async () => {
    // Canon's pager never hid a search result. Here the window was applied AFTER
    // the search, so looking a customer up showed their newest record and put
    // the rest behind さらに表示 (「見本 いつき」 matched 2, showed 1).
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const q = '見本 いつき'
    const matches = props.rows.filter((r) => matchesSearch(r, q))
    expect(matches.length).toBeGreaterThan(1)
    // …and they genuinely span more than one window, or the pin proves nothing.
    expect(matches[0].dayKey - matches[matches.length - 1].dayKey).toBeGreaterThan(WINDOW_DAYS)
    // The windowed walk WOULD hide them; the screen bypasses it while searching.
    expect(windowRows(matches, 1).hidden).toBeGreaterThan(0)
    expect(SCREEN_CODE).toContain("const searching = query.trim() !== ''")
    expect(SCREEN_CODE).toContain('searching ? { visible: matched, hidden: 0, cutoff: null } : windowRows(matched, steps)')
  })

  it('the demo world’s own walk shows the recent fortnight and names the rest', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const walk = windowRows(props.rows, 1)
    expect(walk.visible.length + walk.hidden).toBe(props.rows.length)
    expect(walk.hidden).toBeGreaterThan(0)
    expect(walk.visible.every((r) => r.dayKey >= props.rows[0].dayKey - WINDOW_DAYS + 1)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ §7a — a page for RECORDS shows records', () => {
  it('the fixture world HOLDS zero-record customers, so the absence is provable', () => {
    const withRecords = new Set(world().map((r) => r.customerId))
    const withoutInStoreA = customers.filter((c) => !withRecords.has(c.id))
    expect(withoutInStoreA.length).toBeGreaterThan(0)
    expect(withoutInStoreA.map((c) => c.id)).toContain('cus-11')
  })

  it('not one row in the list belongs to a customer with no record', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    // Every row IS a record, by construction: it carries a カルテ番号 the plane
    // holds. A zero-karute row could only exist if something invented one.
    for (const row of props.rows) {
      expect(recordPlane.some((r) => r.id === row.id)).toBe(true)
    }
    expect(props.rows.some((r) => r.customerId === 'cus-11')).toBe(false)
    expect(props.rows.some((r) => r.customerId === 'cus-10')).toBe(false)
  })

  it('the reveal is the ONLY place a record-less customer appears, and only on a search', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(props.reveals.some((c) => c.customerId === 'cus-11')).toBe(true)
    // …and it fires on a query, never on an empty box.
    const sakura = props.reveals.find((c) => c.customerId === 'cus-11')!
    expect(matchesReveal(sakura, '')).toBe(false)
    expect(matchesReveal(sakura, 'さくら')).toBe(true)
    expect(matchesReveal(sakura, 'サクラ')).toBe(true)
    expect(matchesReveal(sakura, 'C-3011')).toBe(true)
    expect(matchesReveal(sakura, 'かえる')).toBe(false)
  })

  it('the reveal is STORE-SCOPED — it never names another store’s customer', async () => {
    const a = await karuteProps({ locale: 'ja', store: STORE_A })
    const b = await karuteProps({ locale: 'ja', store: STORE_B })
    // 見本 うみ books only in 代官山, so 銀座 must not learn she exists.
    expect(a.props.reveals.some((c) => c.customerId === 'cus-03')).toBe(false)
    expect(JSON.stringify(a.props)).not.toContain('見本 うみ')
    expect(b.props.reveals.some((c) => c.customerId === 'cus-03')).toBe(true)
    // A customer with no booking ANYWHERE belongs to no store: hidden from both
    // clamped lenses, and visible only to a lens with no store to be outside of.
    expect(a.props.reveals.some((c) => c.customerId === 'cus-10')).toBe(false)
    expect(b.props.reveals.some((c) => c.customerId === 'cus-10')).toBe(false)
    const wide = revealCandidates({ appointments: appointments(NOW), customers, records: world(), clamped: false })
    expect(wide.some((c) => c.customerId === 'cus-10')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('permissions — fail-closed, and the notice says the TRUE rule', () => {
  it('an unknown role gets nothing, and a prototype key is not a role', () => {
    for (const key of ['', 'unknown', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(accessFor(key)).toEqual({ discardContent: false, reassign: false })
    }
  })

  it('店舗管理者 and オーナー read discards and may re-point a record; スタッフ does neither', () => {
    expect(accessFor('店舗管理者')).toEqual({ discardContent: true, reassign: true })
    expect(accessFor('オーナー')).toEqual({ discardContent: true, reassign: true })
    expect(accessFor('スタッフ')).toEqual({ discardContent: false, reassign: false })
  })

  it('⚖ D3 — the transcript line follows the STORE’S SETTING, and the room never hardcodes a rule', () => {
    for (const access of [MANAGER, STAFF]) {
      const lines = permissionNotice(access)
      expect(lines[0]).toContain('文字起こしの閲覧は店舗の設定に従います（未接続）')
    }
    // The forbidden claim, in any spelling this room could reach for.
    // CODE, not prose: the comment that FORBIDS the sentence quotes it.
    const everything = [stripComments(LIB_SRC), SCREEN_CODE, PROPS_CODE].join('\n')
    expect(everything).not.toContain('管理者も文字起こし')
    expect(everything).not.toContain('管理者は文字起こしを見られません')
    expect(everything).not.toContain('管理者は閲覧できません')
  })

  it('a staff member is told WHY the discard content is missing, in one sentence', () => {
    expect(permissionNotice(STAFF).some((l) => l.includes('店舗管理者のみが確認できます'))).toBe(true)
    expect(permissionNotice(MANAGER).some((l) => l.includes('店舗管理者のみが確認できます'))).toBe(false)
  })

  it('the person header carries the customer-profile identity header’s STRUCTURE', () => {
    // ⚖ Liam 8/23 final: one component spelling for the family. Business has no
    // customer-profile header yet, so this room builds the one the 顧客 room
    // adopts in the sweep (K-6) — and the skeleton it clones is the phone's
    // `CustomerHeaderCard`, which is itself the exact clone of
    // `CustomerIdentityCard`: avatar · name with the record number BESIDE it in
    // the same line · a wrapping meta row · the 担当 line · a top-right action
    // slot. The number sitting under the name instead of beside it is the shape
    // the clone rules out, so the pin is about CONTAINMENT, not mere presence.
    const nameline = /<div className="kr-id-nameline">([\s\S]*?)<\/div>/.exec(SCREEN_CODE)?.[1] ?? ''
    expect(nameline).toContain('<h2 id="krIdentityName">')
    expect(nameline).toContain('className="kr-id-no"')
    for (const slot of ['kr-avatar', 'kr-id-meta', 'kr-id-staff', 'kr-id-actions']) {
      expect(SCREEN_CODE).toContain(slot)
    }
    // …in the clone's own order: avatar, then the name block, then the actions.
    const at = (s: string) => SCREEN_CODE.indexOf(s)
    expect(at('kr-avatar')).toBeLessThan(at('kr-id-nameline'))
    expect(at('kr-id-nameline')).toBeLessThan(at('kr-id-meta'))
    expect(at('kr-id-meta')).toBeLessThan(at('kr-id-staff'))
    expect(at('kr-id-staff')).toBeLessThan(at('kr-id-actions'))
  })

  it('⇆ 顧客変更 is HIDDEN for a role without the right, never shown-and-refused', async () => {
    const asStaff = await karuteProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    const asManager = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(asStaff.props.canReassign).toBe(false)
    expect(asManager.props.canReassign).toBe(true)
    // …and the screen gates the whole control on that flag rather than dimming it.
    expect(SCREEN_CODE).toContain('{props.canReassign && (')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('every write is REFUSED, with its own reason, and there is no delete lever', () => {
  it('all nine refusals are distinct sentences that name what they would have done', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const reasons = Object.values(props.refusals)
    expect(reasons.length).toBe(9)
    expect(new Set(reasons).size).toBe(9)
    for (const r of reasons) {
      expect(r.length).toBeGreaterThan(30)
      expect(r).toMatch(/できません|開けません/)
      // Every one says what has to happen before it works — a refusal with no
      // path is a wall, not an explanation.
      expect(r).toMatch(/あとに有効になります|接続後に有効になります/)
    }
    expect(props.actionFootnote).toContain('実データ接続後に有効になります')
  })

  it('every refusal is WIRED to the control it names, not merely present', () => {
    // ⚠ A SWAPPED REASON SURVIVED EVERY PIN (F-K12). The suite proved the eight
    // sentences were distinct and that the helper puts one on `aria-label`; the
    // probe proved each label held an em-dash. Nothing tied a reason to ITS
    // control, so the photo tile could tell a reader that 記入内容 cannot be
    // edited and stay green. Each call site is now pinned to its own key.
    const wiring: Array<[string, string]> = [
      ['を編集`, props.refusals.entry', 'entry'],
      ["'詳細記録を編集', props.refusals.summary", 'summary'],
      ["'AIで再生成', props.refusals.regenerate", 'regenerate'],
      ["'編集', props.refusals.message", 'message'],
      ["'承認して送信', props.refusals.send", 'send'],
      ["'結果を変更', props.refusals.outcome", 'outcome'],
      ["'続ける', props.refusals.reassign", 'reassign'],
      ['${p.caption}`, props.refusals.photo', 'photo'],
      ["'＋ 新規カルテ', props.refusals.create", 'create'],
    ]
    for (const [call, key] of wiring) {
      expect({ key, wired: SCREEN_CODE.includes(call) }).toEqual({ key, wired: true })
    }
    // …and every refusal key the props expose is spent exactly once.
    const used = [...SCREEN_CODE.matchAll(/props\.refusals\.(\w+)/g)].map((m) => m[1]).sort()
    expect(used).toEqual(['create', 'entry', 'message', 'outcome', 'photo', 'reassign', 'regenerate', 'send', 'summary'])
  })

  it('⚠ NO CALL SITE WRITES className AFTER the refused() spread (F-K1)', () => {
    // The bug this pin exists for: `{...refused(…)} className="kr-pencil"` — the
    // later JSX prop wins, `.btn` never reaches the DOM, and the control loses
    // every refusal cue while still LOOKING pressable (cursor: pointer).
    expect(SCREEN_CODE).not.toMatch(/\{\.\.\.refused\([\s\S]{0,400}?\)\}\s*\n?\s*className=/)
    // The helper merges instead, and states the merge AFTER its own spread so an
    // `extra.className` cannot overwrite it either.
    expect(SCREEN_CODE).toContain("className: ['btn', className].filter(Boolean).join(' '),")
  })

  it('every refused control carries its reason on its ACCESSIBLE NAME, not on title alone', () => {
    // A title-only refusal is invisible to exactly the reader who cannot see
    // that the button is dead (the room-3 F4 lesson).
    expect(SCREEN_CODE).toContain("'aria-label': `${label} — ${reason}`")
    expect(SCREEN_CODE).toContain("'aria-disabled': 'true'")
    // aria-disabled, never `disabled`: the control stays focusable so the reason
    // is reachable.
    expect(SCREEN_CODE).not.toMatch(/\bdisabled=\{?true/)
  })

  it('⚖ #547 — NO DELETE LEVER ANYWHERE, in any spelling', () => {
    // CODE, not prose: page.tsx's own comment EXPLAINS why there is no 削除
    // control, and a pin that read the comment would fail on its own reasoning.
    const everything = [SCREEN_CODE, PROPS_CODE, stripComments(LIB_SRC), stripComments(PAGE_SRC)].join('\n')
    for (const word of ['削除', 'カルテを消', '完全に消']) {
      expect({ word, found: everything.includes(word) }).toEqual({ word, found: false })
    }
    // The verb this product HAS is 破棄, which keeps the record.
    expect(SCREEN_SRC).toContain('破棄')
  })

  it('⚖ Liam 8/31 — ＋新規カルテ IS a lever here, and it is REFUSED with its OWN reason', async () => {
    // K-5 overturned: staff on floors that ban phones work computer-primary, so
    // the computer is a first-class door and record creation belongs on it. What
    // the room may not do is WRITE — so the lever ships with the family's full
    // refusal grammar rather than half a dialog.
    expect(SCREEN_CODE).toContain("refused('＋ 新規カルテ', props.refusals.create, { className: 'kr-new' })")
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    // Its own sentence, not one borrowed from another control…
    expect(props.refusals.create).toContain('新規カルテ')
    for (const [key, other] of Object.entries(props.refusals)) {
      if (key !== 'create') expect(other).not.toBe(props.refusals.create)
    }
    // …and it says the creation is coming to THIS door, never that creation
    // belongs to the phone — that framing is the whole thing Liam overturned.
    expect(props.refusals.create).toContain('パソコン')
    expect(props.refusals.create).toMatch(/できるようになります|有効になります/)
  })

  it('⚖ D2 REACHES THE HEAD — the list’s furniture renders on the LIST ONLY (F5-1)', () => {
    // With a record open the head still printed the LIST's furniture above the
    // breadcrumb: a subtitle about 一覧・行・検索・絞り込み, a status line claiming
    // 表示中 8件 over a screen showing one record and zero rows, and — after the
    // button round — the list's primary ACTION. The room's own law is the one
    // that decides it: 「the head can never claim a number the list is not
    // showing」 (karute-props.ts, the monthLabel comment), which is ⚖ §7a's honest
    // statusLine and ⚖ 8/25's self-explaining numbers, broken on one of the two
    // screens. ONE guard, on the state the room already has.
    const headAt = SCREEN_CODE.indexOf('<header')
    const guardAt = SCREEN_CODE.indexOf('{!detailOpen && (')
    const headEnd = SCREEN_CODE.indexOf('</header>')
    expect(guardAt).toBeGreaterThan(headAt)
    expect(headEnd).toBeGreaterThan(guardAt)
    // One guard, and it is the head's LAST child — so everything from it to the
    // end of the head is exactly what the record screen does not get.
    expect(SCREEN_CODE.match(/\{!detailOpen && \(/g)?.length).toBe(1)
    const listOnly = SCREEN_CODE.slice(guardAt, headEnd)
    const bothScreens = SCREEN_CODE.slice(headAt, guardAt)
    // THE LIST SCREEN keeps all three, and each is stated exactly once in the
    // room, so none of them can be rendered a second time outside the guard.
    for (const part of ['className="kr-subtitle"', 'className="kr-status"', 'className="kr-toolbar"', "className: 'kr-new'"]) {
      expect({ part, onTheList: listOnly.includes(part) }).toEqual({ part, onTheList: true })
      expect({ part, stated: SCREEN_CODE.split(part).length - 1 }).toEqual({ part, stated: 1 })
    }
    // THE RECORD SCREEN keeps the page's identity — the eyebrow, the カルテ title
    // and the ? that opens the walk. The record's own context is its breadcrumb,
    // its person header and its sticky strip, which all live inside `.kr-detail`.
    for (const part of ['className="kr-eyebrow"', 'className="kr-titleline"', '<h1>カルテ</h1>', 'className="kr-help"']) {
      expect({ part, onBothScreens: bothScreens.includes(part) }).toEqual({ part, onBothScreens: true })
    }
  })

  it('the head’s own tour card is true on BOTH screens (F5-1)', () => {
    // The head is the ONE declaration this room renders on the table and inside a
    // record, so its sentence may not name a control only one of them has —
    // otherwise the walk itself repeats the defect the furniture was moved for.
    const head = /data-guide-title="カルテ"\s*\n\s*data-guide="([^"]*)"/.exec(SCREEN_CODE)
    expect(head).not.toBeNull()
    for (const word of ['検索', '絞り込み', '＋新規カルテ', '並ぶ画面']) {
      expect({ word, inHead: head![1].includes(word) }).toEqual({ word, inHead: false })
    }
    // …and the sentence about the create lever moved to the toolbar's own
    // declaration, which renders on the list and drops with it.
    const toolbar = /data-guide-title="件数と新規カルテ"\s*\n\s*data-guide="([^"]*)"/.exec(SCREEN_CODE)
    expect(toolbar).not.toBeNull()
    expect(toolbar![1]).toContain('＋新規カルテからは、このパソコンでも同じ手順でカルテを作れるようになります。')
    expect(SCREEN_CODE.slice(SCREEN_CODE.indexOf('{!detailOpen && ('))).toContain('data-guide-title="件数と新規カルテ"')
  })

  it('the page does not both OFFER the button and explain its absence', () => {
    // The head used to argue the lever away — in the subtitle's own comment and
    // in the tour's opening card ('この画面はそれを読み返すためのもの'). A page that
    // now carries the button must not also tell the reader it has none.
    expect(SCREEN_CODE).not.toContain('読み返すためのもの')
    expect(SCREEN_CODE).toContain('＋新規カルテからは、このパソコンでも同じ手順でカルテを作れるようになります。')
  })

  it('the reassign flow stops at the WARNING, in the phone app’s own words', () => {
    for (const line of [
      'このカルテ（施術記録）を、別のお客様に付け替えます。',
      '誤って別のお客様に保存してしまった場合の修正専用です。',
      'この操作は監査ログに記録されます。',
    ]) {
      expect(SCREEN_CODE).toContain(line)
    }
    // …and the step after the warning is refused rather than half-built: there
    // is no picker and no confirm in this room (registry ②).
    expect(SCREEN_CODE).not.toContain('pickerSearchPlaceholder')
    expect(SCREEN_CODE).toContain("refused('続ける', props.refusals.reassign)")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the props the screen is handed — strings, and no second clock', () => {
  it('the screen holds no clock, no formatter and no data access', () => {
    expect(SCREEN_CODE).not.toMatch(/new Date\(|Date\.now\(|Intl\./)
    expect(SCREEN_CODE).not.toContain('@/business/lib/data')
    expect(SCREEN_CODE).not.toContain('fixtures')
  })

  it('every date on a row is already a string, and the only number is the day axis', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    for (const r of props.rows) {
      expect(typeof r.dateLabel).toBe('string')
      expect(typeof r.dateLongLabel).toBe('string')
      expect(typeof r.timeLabel).toBe('string')
      expect(r.dateLabel).toMatch(/^\d+月\d+日$/)
      expect(r.timeLabel).toMatch(/^\d\d:\d\d$/)
      expect(Number.isInteger(r.dayKey)).toBe(true)
    }
  })

  it('formats in JST regardless of the server clock', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const today = props.rows.filter((r) => r.dayKey === TODAY)
    expect(today.length).toBe(3)
    // apt-12 starts 10:00 JST. A UTC formatter would print 01:00.
    expect(props.rows.find((r) => r.id === 'K-0001')!.timeLabel).toBe('10:00')
  })

  it('⚖ SILENT FAILURE IS A BUG — an empty preview says WHICH reason it is', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    for (const r of props.rows) {
      if (r.preview === null) expect(r.previewFallback.length).toBeGreaterThan(5)
    }
    expect(props.rows.find((r) => r.id === 'K-0007')!.previewFallback).toBe('まだ何も記入されていません')
    expect(props.rows.find((r) => r.id === 'K-0003')!.previewFallback).toBe('AIの要約はまだ作成されていません')
    // ⚖ A8 — the discard is said ONCE, where it belongs. A 店舗管理者 CAN read
    // this record, so their empty line has an ordinary cause; only a reader who
    // may NOT read it is told 破棄 here, because for them that IS the reason.
    // K-0005 HAS a written line but no AI summary, so a manager's honest cause
    // is the missing summary — not the discard, and not "nothing written".
    expect(props.rows.find((r) => r.id === 'K-0005')!.previewFallback).toBe('AIの要約はまだ作成されていません')
    const asStaff = await karuteProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    expect(asStaff.props.rows.find((r) => r.id === 'K-0005')!.previewFallback).toBe('破棄されたカルテです（内容は店舗管理者のみ）')
  })

  it('⚖ SELF-EXPLAINING NUMBERS — every count on the page says what it counts', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(props.monthLabel).toMatch(/^カルテ 今月 /)
    expect(props.rows.every((r) => r.photoCountLabel === null || r.photoCountLabel.startsWith('このセッションの写真 '))).toBe(true)
    // The chips print 「N件」, never a bare figure.
    expect(SCREEN_CODE).toMatch(/<b>\{scopeCounts\.all\}<\/b>件/)
    expect(SCREEN_CODE).toMatch(/<b>\{filterCounts\.get\(f\.key\) \?\? 0\}<\/b>件/)
    // ⚠ THREE LABELLED FACTS, NOT TWO. 「今月 30件・表示中 200件」 is what the
    // 200-record world printed on the first probe run: both true, and side by
    // side they read as a contradiction because 今月 is a MONTH and 表示中 is a
    // LIST. The middle number is what 表示中 is a fraction OF.
    expect(SCREEN_CODE).toContain('条件に一致 {matched.length}件・表示中 {visible.length}件')
  })

  it('録音 has three states and three sentences — 「なし」 is not 「同意なし」', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(props.rows.find((r) => r.id === 'K-0004')!.recordingLine).toBe('この記録に紐づく録音はありません。')
    expect(props.rows.find((r) => r.id === 'K-0001')!.recordingLine).toBe('録音の同意を確認済みです。')
    expect(props.rows.find((r) => r.id === 'K-0010')!.recordingLine).toBe('録音はありますが、同意の記録がありません。')
    expect(props.rows.find((r) => r.id === 'K-0004')!.consentLabel).toBeNull()
    expect(props.rows.find((r) => r.id === 'K-0010')!.consentLabel).toBeNull()
    expect(props.rows.find((r) => r.id === 'K-0001')!.consentLabel).toBe('同意確認済')
  })

  it('the outcome vocabulary is the PHONE’s, and 通常ご来店 never carries a reason', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    const labels = new Set(props.rows.map((r) => r.outcomeLabel))
    expect([...labels].sort()).toEqual(['不成約', '仮カルテ', '成約', '結果 未記録', '通常ご来店'])
    const revisit = props.rows.find((r) => r.outcomeLabel === '通常ご来店')!
    expect(revisit.outcomeNote).toContain('成約率の集計に含めません')
    const declined = props.rows.find((r) => r.outcomeLabel === '不成約')!
    expect(declined.outcomeNote).toBe('お断りの理由: 予算')
  })

  it('⚖ TYPE TIER 1 — the 回数券 line exists only where the record holds a burn', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    for (const r of props.rows) {
      const plane = recordPlane.find((x) => x.id === r.id)!
      expect(r.ticketLine !== null).toBe(plane.ticket_redeemed && plane.discarded === null)
    }
    expect(props.rows.some((r) => r.ticketLine !== null)).toBe(true)
    // No business-type branch anywhere: a shop that does not sell 回数券 has
    // records that never hold one, and the same code renders nothing.
    for (const src of [SCREEN_CODE, PROPS_CODE, stripComments(LIB_SRC)]) {
      expect(src).not.toMatch(/businessType|業種|storeType/)
    }
  })

  it('a store that has recorded nothing gets a DESIGNED screen, not an empty page', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A, world: { records: [] } })
    expect(props.rows).toEqual([])
    expect(props.monthLabel).toBe('カルテ 今月 0件')
    expect(SCREEN_CODE).toContain('この店舗のカルテはまだありません')
  })

  it('the page passes NO world override — the harness branch is the harness’s alone', () => {
    expect(PAGE_SRC).toContain('await karuteProps({ locale, store: query.store })')
    expect(PAGE_SRC).not.toContain('world')
    // …and the harness's booking set still goes through the lens's own rule.
    expect(PROPS_CODE).toContain('world.appointments.filter((a) => (clamped ? a.store_id === storeId : true))')
  })

  it('the screen is keyed by the resolved lens, so nothing survives a store switch', () => {
    expect(PAGE_SRC).toContain('<KaruteScreen key={storeKey}')
    expect(PROPS_CODE).toContain("storeKey: clamped ? storeId! : 'all-stores'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ PAGE-SCROLL + the ring — the sheet’s own structural pins', () => {
  it('no wrapper caps a height, owns overflow-y, or sets overscroll-behavior', () => {
    expect(CSS_CODE).not.toMatch(/overflow-y\s*:/)
    expect(CSS_CODE).not.toMatch(/overscroll-behavior/)
    expect(CSS_CODE).not.toMatch(/max-height\s*:/)
    // `overflow: <one value>` would set BOTH axes — the shorthand is the trap.
    expect(CSS_CODE).not.toMatch(/[^-]overflow\s*:\s*(auto|scroll)\s*;/)
  })

  it('NOT ONE container owns an axis — not even X (deviation K-9)', () => {
    // The packet asked for a table that pans sideways with a frozen 日付 column.
    // It was built, and then MEASURED: the shell collapses its rail to 76px
    // below 1024, so the narrowest reachable content box is 628px against a
    // five-column BOX minimum of 586px — 556px of grid tracks PLUS the row's own
    // 28px of horizontal padding and the table's 2px of border, which leaves 42px
    // of slack rather than the 72px a track-only figure implies. The columns fit
    // at every width, in both rail states, and below 744 the phone band turns the
    // table into cards. The probe's survey is the argument: nine widths × two
    // rail states = 18 combinations, OVERFLOW 0 IN EVERY ONE (verdict
    // `B · deviation K-9`, rows at `probes.scale.panSurvey`). A pan that never
    // engages cannot discriminate a correct sticky inset from a wrong one, so the
    // mechanism is gone rather than shipped as a lever nobody can operate.
    expect(CSS_CODE).not.toMatch(/overflow-x\s*:/)
    // ⚖ PIN MOVED IN THE DESIGN ROUND, AND NARROWED RATHER THAN DROPPED. It used
    // to read `not.toMatch(/position:\s*sticky/)`, which was the right pin while
    // the only sticky the room could have wanted was K-9's FROZEN COLUMN — a
    // mechanism that only means anything inside a scroller the room would have
    // had to own. The approved design round adds a sticky CONTEXT STRIP, which
    // owns no scroller at all: it pins to the PAGE's own scroll, the one the
    // ruling says the page keeps. So the property is allowed on exactly one
    // selector and the LIST is what is pinned — a second sticky, or a sticky on
    // anything inside the table, still fails here.
    const stickies = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*position:\s*sticky[^}]*\}/g)].map((m) => m[1].trim())
    expect(stickies).toEqual(['.biz .pg-karute .kr-strip'])
    // …and it parks under the SHELL's own topbar rather than at the viewport
    // top, which is the number that decides whether it covers the thing it is
    // supposed to sit beside (business-shell.css states 62px / z-index 5).
    const shellCss = read('src/app/[locale]/(business)/business-shell.css')
    expect(shellCss).toMatch(/\.biz \.topbar \{[\s\S]*?min-height: 62px/)
    // ⚠ PIN MOVED IN DESIGN ROUND 2, AND STRENGTHENED RATHER THAN LOOSENED. The
    // 62 used to be written on the strip's own rule and NOWHERE else — which is
    // exactly how the 目次's jump clearance drifted out of sync with it (DL-1:
    // a flat `scroll-margin-top: 124px` tuned to a one-row strip, against a
    // strip that wraps to two rows at every width from 1180 down to 744). The
    // number is now a token, and BOTH halves are pinned: the token states the
    // shell's own 62, and the strip spends the token instead of restating it.
    expect(CSS_CODE).toMatch(/--kr-strip-top: 62px;/)
    expect(CSS_CODE).toMatch(/\.kr-strip \{[\s\S]*?top: var\(--kr-strip-top\);[\s\S]*?z-index: 4;/)
    // …and the jump's clearance is DERIVED from the strip — its own offset plus
    // its MEASURED height — rather than tuned to one width band. The height is
    // measured because CSS cannot read one element's box from another's rule,
    // so the pin covers both ends: the sheet spends the two tokens, and the
    // screen really writes the measurement onto the room root.
    // ⚠ PIN MOVED AGAIN BY F5-4, AND ONTO THE SCROLLER. `scroll-margin-top` on
    // each landing CARD answers a 目次 jump and nothing else: the browser scrolls
    // the focused DESCENDANT, and a button inside a card carries no margin of its
    // own, so a focused control still parked under the strip. `scroll-padding` is
    // a property of the SCROLL CONTAINER — one declaration, every reason the
    // browser ever scrolls — and the room's container is the document, because
    // this page owns no axis of its own (⚖ page-scroll).
    expect(CSS_CODE).toMatch(/scroll-padding-top: calc\(var\(--kr-strip-top\) \+ var\(--kr-strip-h\) \+ 14px\);/)
    expect(CSS_CODE).toMatch(/html:has\(\.biz \.page\.pg-karute\) \{/)
    // …and the per-element margins are GONE rather than kept beside it: two homes
    // for one clearance is how the flat 124px drifted out of sync in the first
    // place.
    expect(CSS_CODE).not.toMatch(/scroll-margin-top/)
    expect(CSS_CODE).not.toMatch(/scroll-padding-top:\s*\d{3}px/)
    // The measurement has to reach the scroller, or the calc above spends the
    // JS-OFF fallback for ever.
    expect(SCREEN_CODE).toContain('const root = document.documentElement')
    expect(SCREEN_CODE).toContain("root.style.setProperty('--kr-strip-h'")
    expect(SCREEN_CODE).toContain('new ResizeObserver(measure)')
    // …and it is taken back when the record closes: this room writes one property
    // outside its own root and cleans it up itself.
    expect(SCREEN_CODE).toContain("root.style.removeProperty('--kr-strip-h')")
    // Declarations only — `@media (min-width: 1400px)` is a BAND, not a floor.
    // ⚠ ANY px COUNT, not just three digits (F-K12): `[1-9]\d\dpx` matched
    // 100–999 and walked straight past `min-width: 1200px`, which is the WORSE
    // version of the same defect (proven: a four-digit floor passed 120/120).
    const declarations = CSS_CODE.replace(/@media[^{]*\{/g, '{')
    expect(declarations).not.toMatch(/min-width\s*:\s*\d{3,}px/)
    expect(SCREEN_CODE).not.toContain('kr-table-wrap')
  })

  it('NO container holding a focusable clips — a ring the room clips is not a ring', () => {
    // `overflow: hidden` is legal on ONE selector and only there: the list
    // preview's single-line clamp, which is a SPAN INSIDE the row button. The
    // ring is painted on the button, outside the button's own box, so a clamp on
    // one of its children cannot reach it. Every other clip would.
    const clippers = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*overflow\s*:\s*hidden[^}]*\}/g)].map((m) => m[1].trim())
    expect(clippers).toEqual(['.biz .pg-karute .kr-preview'])
  })

  it('the phone band turns the five columns into one card per record', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toMatch(/\.kr-thead\s*\{\s*display:\s*none/)
    expect(phone).toMatch(/grid-template-areas:\s*"cust cust" "date state" "service staff"/)
  })

  it('the fence states this room’s value at FOUR levels for every shared name', () => {
    for (const rule of [
      '.biz .page.pg-karute {',
      '.biz .page.pg-karute h1 {',
      '.biz .page.pg-karute .btn {',
      '.biz .page.pg-karute .btn.primary {',
    ]) {
      expect(CSS_CODE).toContain(rule)
    }
  })

  it('every rule is scoped — nothing here can reach a neighbour', () => {
    // ⚠ USES THE FIXED PARSER (F-K11). The old inline splitter could not see the
    // first rule of a media block, so 「nothing here can reach a neighbour」 was
    // true either because it is, or because the unscoped rule happened to sit
    // first inside an @media — the room-2 BLOCKER's own shape.
    const unscoped = allSelectors(CSS_SRC).filter((s) => !s.includes('pg-karute'))
    expect({ unscoped }).toEqual({ unscoped: [] })
    // …and the parser really does see inside media blocks, or the pin above is
    // vacuous again: this room states rules in seven of them.
    expect(allSelectors(CSS_SRC).length).toBeGreaterThan(
      CSS_SRC.split('}').length - CSS_SRC.split('@media').length,
    )
  })

  it('⚖ R13 — no black-filled interactive element anywhere in the room', () => {
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|#111|#18181b|black)/)
    expect(CSS_CODE).not.toMatch(/background:\s*var\(--ink/)
  })

  it('the ALL-SCREEN ladder states every band the law names', () => {
    for (const band of [
      '@media (min-width: 1400px)',
      '@media (max-width: 1279px)',
      '@media (max-width: 1099px)',
      '@media (max-width: 1023px)',
      '@media (min-width: 800px) and (max-width: 1023px)',
      '@media (max-width: 743px)',
      '@media (prefers-reduced-motion: reduce)',
    ]) {
      expect(CSS_SRC).toContain(band)
    }
  })

  it('the room joins the shell’s 1180px floor opt-in list, and only the SHELL states it', () => {
    const shell = read('src/app/[locale]/(business)/business-shell.css')
    // RE-DERIVED as 録音 (2026-08-31, main) and AI相談 (probe build1–3 measured
    // its ladder) joined the list. ⚠ ONE ROOM PER LINE, ADDED THE ROUND ITS
    // PROOF LANDS — and the literal stays a LITERAL on purpose: a room joining
    // this shell-owned line has to trip every neighbour's pin, so no room can
    // slip onto the floor exemption without a round that looked at it. The
    // regex form the 録音 room reached for asserts only its own membership,
    // which this literal already contains. RE-DERIVED on the 2026-09-03 fold of
    // 売上分析 (#830): `.page.pg-analytics` joined the shell line, so the literal
    // moves with it — which is the pin working, not the pin failing. RE-DERIVED
    // AGAIN on the 2026-09-03 fold of 予約一覧 (#832): `.page.pg-reservations`
    // joined ahead of this room, in main's order, and the literal moved with it.
    // AND AGAIN on the 2026-09-05 fold of 顧客 (#834): `.page.page-customers`
    // joined ahead of it too — main's own name for that room, main's own order.
    // AND AGAIN on the 2026-09-05 fold of 設定 (S17, #812's 予約と確保 folded in
    // as one section): `.page.pg-settings` joined LAST, main's order kept ahead
    // of it, and the literal moved with it.
    expect(shell).toContain('.biz .app:has(.page.pg-inbox, .page.pg-register, .page.pg-karute, .page.pg-recording, .page.pg-analytics, .page.pg-reservations, .page.page-customers, .page.pg-ask-ai, .page.pg-settings) { min-width: 0; }')
    expect(CSS_CODE).not.toContain('.biz .app')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE SIBLING-SHEET FENCE, derived FRESH from today’s sheets', () => {
  const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
  const stripCss = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  /** ⚠ WALKS THE AT-RULES INSTEAD OF SPLITTING BLINDLY (F-K11). The first cut
   *  did `src.split('}')` then `slice(0, indexOf('{'))` — and for the FIRST rule
   *  inside any `@media` block the first `{` found is the media query's OWN
   *  brace, so the selector was never seen at all. Seven selectors per sheet
   *  were invisible, including a bare `.biz .guard-rail-cell` in today.css: the
   *  exact shape the fence exists to catch. A planted unscoped rule at the top
   *  of a media block passed every pin (proven red-run in the evidence).
   *  Conditional groups lose their PRELUDE and keep their rules; keyframes and
   *  font-face blocks go entirely, so `from`/`to` never read as selectors. */
  const selectorsOf = (src: string) =>
    stripCss(src)
      .replace(/@(?:keyframes|font-face|counter-style|property)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .replace(/@(?:media|supports|layer|container)[^{]*\{/g, '')
      .split('}')
      .flatMap((block) => {
        const i = block.indexOf('{')
        return i < 0 ? [] : block.slice(0, i).split(',').map((s) => s.trim()).filter(Boolean)
      })
      .filter((s) => !s.startsWith('@'))
  const classesIn = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'biz')

  const SIBLING_DIRS = readdirSync(join(BIZ, 'business')).filter((d) => {
    if (d === 'karute') return false
    try {
      readFileSync(join(BIZ, 'business', d, `${d}.css`))
      return true
    } catch {
      return false
    }
  })

  /** Every class name this room's own sheet uses, plus the shell's vocabulary
   *  this room deliberately reuses. */
  const mine = new Set<string>(['pill', 'good', 'warn', 'alert', 'indigo', 'btn', 'primary', 'danger', 'page'])
  for (const sel of selectorsOf(CSS_SRC)) {
    if (!sel.includes('pg-karute')) continue
    for (const c of classesIn(sel)) if (c !== 'pg-karute') mine.add(c)
  }

  it('the neighbours are all here — TEN sheets, read from disk, never restated', () => {
    // ⚠ RE-DERIVED, NOT EXTENDED BY HABIT: a new room shipping a sheet is a new
    // neighbour for THIS room, and the fence's whole point is that the list is
    // read from disk and pinned rather than remembered. `recording` joined the
    // family in room 6 (2026-08-31), `settings` in the 予約と確保 round (⚖ Liam
    // 9/1) and `ask-ai` in room 7. The list is READ from disk and this line is
    // the pin on what was read — a new neighbour is MEANT to fail here once, so
    // the room that added it re-derives the collision list below in the same
    // pass rather than discovering the bleed in a browser (the 売上・レジ room
    // states the rule in its own words). `settings` states every rule under
    // `.pg-settings` and `ask-ai` every rule under `.pg-ask-ai`, so neither adds
    // a collision below.
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'ask-ai', 'customers', 'inbox', 'recording', 'register', 'reservations', 'settings', 'shifts', 'today'])
  })

  it('every sibling rule that could reach this room is FENCED at four levels', () => {
    const collisions: string[] = []
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const sel of selectorsOf(src)) {
        if (!sel.startsWith('.biz') || sel.includes('.pg-')) continue
        const names = classesIn(sel)
        if (names.length && names.every((n) => mine.has(n))) collisions.push(`${dir}::${sel}`)
      }
    }
    // Derived, not copied: if a neighbour ever states a bare rule on a name this
    // room renders, it appears here and the fence has to grow in the same pass.
    expect(collisions.sort()).toEqual([
      // ⚠ THE DERIVED LIST IS NOW EMPTY, AND THAT IS THE MERGED TRUTH: both rooms
      // that used to state a bare rule on a name this one styles have retired it —
      // 顧客 in its V2 redesign (its buttons are `cu-btn-*`, its dialog states its
      // weights at four levels) and 予約一覧 in its own. Derived freshly on every
      // run, so the day a neighbour states one again this goes red and the fence
      // grows in the same pass.
    ])
    // …and this room states its own value for each of them, at FOUR levels, so a
    // sibling's three-level rule cannot win on insertion order.
    expect(CSS_CODE).toContain('.biz .page.pg-karute .btn { font-weight: 500; }')
    expect(CSS_CODE).toContain('.biz .page.pg-karute .btn.primary { font-weight: 600; }')
  })

  it('the room’s own PAGE rule is four levels — never three, which ties', () => {
    const base = CSS_CODE.slice(0, CSS_CODE.indexOf('@media'))
    expect(base).toContain('.biz .page.pg-karute { padding:')
    expect(base).not.toMatch(/\.biz \.pg-karute \{/)
    expect(base).toContain('.biz .page.pg-karute h1 {')
  })

  it('every class name the SCREEN renders is this room’s own, or one of the shell’s', () => {
    // The collision list above is derived from the SHEET, so a class name that
    // appears only in the MARKUP would be invisible to it while being exactly
    // the kind of shared name a neighbour states bare rules on (the room-4 M10
    // lesson, inherited).
    const rendered = new Set<string>()
    for (const m of SCREEN_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      // A template literal's `${…}` holes are EXPRESSIONS, not class names.
      for (const name of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (name && /^[a-z][\w-]*$/.test(name)) rendered.add(name)
      }
    }
    // `long` is the 顧客 room's own state class for a 3-character person mark,
    // carried verbatim rather than re-invented — it rides a kr- element and this
    // sheet states it only under `.pg-karute`, so nothing can collide on it.
    const SHELL = new Set(['page', 'pg-karute', 'btn', 'primary', 'danger', 'pill', 'good', 'warn', 'alert', 'indigo', 'long'])
    const strays = [...rendered].filter((n) => !n.startsWith('kr-') && !SHELL.has(n))
    expect(strays).toEqual([])
    expect([...rendered].filter((n) => n.startsWith('kr-')).length).toBeGreaterThan(30)
  })

  it('this room’s own names exist NOWHERE else in the family', () => {
    const own = [...mine].filter((n) => n.startsWith('kr-'))
    expect(own.length).toBeGreaterThan(30)
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const n of own) {
        expect({ dir, name: n, used: src.includes(`.${n}`) }).toEqual({ dir, name: n, used: false })
      }
    }
    // …nor in the shell, which is the one sheet every room shares.
    const shell = readFileSync(join(BIZ, 'business-shell.css'), 'utf8')
    for (const n of own) expect({ name: n, inShell: shell.includes(`.${n}`) }).toEqual({ name: n, inShell: false })
  })

  it('every SHELL class the room renders is either fenced or never restated here', () => {
    // The other direction of the same question, and the one that decides a
    // collision: a neighbour's bare rule can only reach a node this room paints
    // if this room ALSO states a property on that name — otherwise there is
    // nothing to fight over, whatever the neighbour says.
    const rendered = new Set<string>()
    for (const m of SCREEN_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const name of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (name && !name.startsWith('kr-') && /^[a-z][\w-]*$/.test(name)) rendered.add(name)
      }
    }
    // ⚖ PIN MOVED IN THE DESIGN ROUND, AND IT MOVED THE RIGHT WAY. It used to
    // read `['btn', 'good', 'indigo', 'pill']`: 手書き borrowed `.pill`, 同意確認済
    // borrowed `.pill.good` and the LINE tag borrowed `.pill.indigo`. The
    // approved mock spells all three to the PHONE's own values — a gray outline
    // chip, an emerald wash and a green word — so they are now `kr-hand` /
    // `kr-consent` / `kr-channel`, and the shared surface a neighbour could ever
    // reach SHRANK from four names to one. That is the fence getting smaller,
    // not a rule being relaxed.
    expect([...rendered].sort()).toEqual(['btn'])
    // …plus the two the screen does not spell as a literal: the ROUTE WRAPPER,
    // and the pill TONES, which arrive as props because the state that picks
    // them is decided once in `karute.ts` and rendered wherever it is needed.
    expect(SCREEN_CODE).toContain("const ROOT = 'page pg-karute'")
    for (const tone of [...Object.values(STATE_PILL), ...Object.values(OUTCOME_PILL)]) {
      expect({ tone, shell: /^pill( (good|warn|alert|indigo))?$/.test(tone) }).toEqual({ tone, shell: true })
    }
    // `long` never appears as a LITERAL class name — it arrives through a
    // conditional expression, which the scan above strips with the rest of the
    // `${…}` hole. Named here so it is still counted as something this room
    // renders and therefore fences.
    expect(SCREEN_CODE).toContain("r.mark.length > 2 ? ' long' : ''")
    const all = new Set([...rendered, 'page', 'pg-karute', 'warn', 'alert', 'long'])
    // The sheet restates a property on exactly three of them, and each is stated
    // at four levels above. `pill` and its four tones are rendered and NEVER
    // restated, so this room has nothing there for a sibling to collide with.
    const restated = [...all].filter((n) =>
      selectorsOf(CSS_SRC).some((sel) => sel.includes('pg-karute') && classesIn(sel).includes(n)),
    )
    expect(restated.sort()).toEqual(['btn', 'long', 'page', 'pg-karute'])
    // …and `long` is stated ONLY beside a kr- name, so no neighbour's bare rule
    // can reach it (顧客 states it beside `.person-mark`, which this room never
    // renders).
    for (const sel of selectorsOf(CSS_SRC)) {
      if (classesIn(sel).includes('long')) expect(sel).toMatch(/pg-karute .*\.kr-/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the room reaches into no phone runtime, and mirrors the contract with a cite', () => {
  it('no import of src/lib/karute/* anywhere in the room', () => {
    for (const src of [LIB_SRC, SCREEN_SRC, PROPS_SRC, PAGE_SRC, PLANE_SRC]) {
      expect(src).not.toMatch(/from '@\/lib\//)
      expect(src).not.toMatch(/from '@\/components\//)
    }
  })

  it('the mirrored shapes NAME the phone file they mirror', () => {
    expect(LIB_SRC).toContain('CurrentSessionCard.tsx')
    expect(LIB_SRC).toContain('outcome-types.ts')
    expect(LIB_SRC).toContain('detail-screen.ts')
  })

  it('react-dom is nowhere in the room’s runtime', () => {
    for (const src of [LIB_SRC, SCREEN_SRC, PROPS_SRC, PAGE_SRC, PLANE_SRC]) {
      expect(src).not.toContain('react-dom')
    }
  })

  it('the operator the 自分 scope means is the world’s own signed-in persona', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    expect(props.selfStaffId).toBe(operator.staff_id)
    expect(props.selfLabel).toBe(`自分（${operator.name}）`)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE DESIGN ROUND — the recognition floor, pinned to the phone', () => {
  it('every drawer the phone can emit has a tone HERE, and no tone exists for a drawer it cannot', () => {
    // ⚠ DERIVED FROM THE LIB, NOT LISTED. The eight drawers are `CATEGORY_ORDER`'s;
    // the sheet keys its tone off the SAME id the model carries, so a drawer the
    // phone adds later arrives with no rule and paints the neutral default —
    // never mis-coloured as somebody else's drawer. Both directions are asked:
    // every category has a rule, and every rule names a real category.
    const toned = [...CSS_CODE.matchAll(/\[data-cat="([^"]+)"\]/g)].map((m) => m[1])
    expect([...new Set(toned)].sort()).toEqual([...CATEGORY_ORDER].sort())
    expect(toned.length).toBe(CATEGORY_ORDER.length)
  })

  it('the chip and its bullets read ONE tone — a colour cannot disagree with itself', () => {
    // The mock's own central claim: 「行頭の点も同じ色」. It is true here because
    // BOTH read the same custom property off the drawer, rather than because two
    // literals happen to match today (⚖ A8).
    expect(CSS_CODE).toMatch(/\.kr-cat-chip \{[^}]*background: var\(--kr-tone-bg\)[^}]*color: var\(--kr-tone-ink\)/)
    expect(CSS_CODE).toMatch(/\.kr-dot \{[^}]*background: var\(--kr-tone-ink\)/)
    // …and every `[data-cat]` rule sets the PAIR, so a half-declared drawer
    // (chip coloured, bullet neutral) fails here.
    for (const m of CSS_CODE.matchAll(/\[data-cat="([^"]+)"\] \{([^}]*)\}/g)) {
      expect({ cat: m[1], bg: m[2].includes('--kr-tone-bg:'), ink: m[2].includes('--kr-tone-ink:') })
        .toEqual({ cat: m[1], bg: true, ink: true })
    }
  })

  it('the eight tones are the PHONE’s literal values, not a repaint of them', () => {
    // Spot-checked against `CurrentSessionCard.tsx`'s CATEGORY_TONE, read from
    // the phone file itself rather than restated — if the phone retints a drawer
    // this fails on the day it happens, which is the whole point of a floor.
    const phone = read('src/components/karute/redesign/detail/CurrentSessionCard.tsx')
    const tones = Object.fromEntries(
      [...phone.matchAll(/^\s*(\w+): \{ bg: '([^']+)', text: '([^']+)' \},$/gm)].map((m) => [m[1], { bg: m[2], text: m[3] }]),
    )
    expect(Object.keys(tones).sort()).toEqual([...CATEGORY_ORDER].sort())
    // Compared as COLOURS, not as characters: the phone writes `0.18` and CSS
    // convention writes `.18`, and a pin that failed on that would be a pin
    // about typography.
    const norm = (v: string) => v.replace(/\s+/g, '').replace(/(^|[^\d])0\./g, '$1.').toLowerCase()
    const rules = Object.fromEntries(
      [...CSS_CODE.matchAll(/\[data-cat="([^"]+)"\] \{([^}]*)\}/g)].map((m) => [m[1], m[2]]),
    )
    for (const cat of CATEGORY_ORDER) {
      expect({
        cat,
        bg: norm(rules[cat] ?? '').includes(`--kr-tone-bg:${norm(tones[cat].bg)};`),
        ink: norm(rules[cat] ?? '').includes(`--kr-tone-ink:${norm(tones[cat].text)};`),
      }).toEqual({ cat, bg: true, ink: true })
    }
  })

  it('the amber pencil still means “a person rewrote this”, now on the GLYPH', () => {
    // ⚖ PIN MOVED. The pencil used to keep the shell's bordered `.btn` square, so
    // the amber signal was a BORDER colour; the approved mock carries the phone's
    // own ghost glyph, so the signal is the glyph's colour
    // (CurrentSessionCard.tsx:233 text-amber-600 = #d97706). What must NOT move
    // is that the edited state is visibly different from the resting one and
    // that the control still LOOKS refused.
    expect(CSS_CODE).toMatch(/--kr-amber: #d97706;/)
    expect(CSS_CODE).toMatch(/\.kr-pencil \{[^}]*color: var\(--kr-ghost\)/)
    expect(CSS_CODE).toMatch(/\.kr-pencil\.is-edited \{ color: var\(--kr-amber\); \}/)
    // The refusal cue is the shell's dim + not-allowed, which the pencil keeps by
    // carrying `.btn` — and it cannot stop carrying it, because `refused()` is
    // what puts it there (F-K1's fix, pinned above).
    expect(SCREEN_CODE).toContain("className: 'kr-pencil',")
  })

  it('⚖ ONE BLUE, and it is R13’s own — never the shell’s indigo', () => {
    expect(CSS_CODE).toMatch(/--kr-accent: #2563eb;/)
    // The room used to spend `var(--indigo)` (#3f5be8, the shell's) on the ⇆, the
    // avatar and the pressed chip. Two blues on one page is the thing the mock
    // settled, so the room now spends exactly one.
    expect(CSS_CODE).not.toContain('var(--indigo)')
    expect(CSS_CODE).not.toContain('var(--commit-')
    expect(CSS_CODE).not.toContain('#3f5be8')
    // …and the accent is only ever on something a person can press, or on a wash
    // (⚖ the one-way accent law). Every saturated use, enumerated from the sheet.
    const accented = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*var\(--kr-accent\)[^}]*\}/g)].map((m) => m[1].trim())
    // ⚠ `kr-row:focus-visible` JOINED THE LIST IN DESIGN ROUND 2 (DL-2), and the
    // row is the most pressable thing on the screen — it is the `<button>` that
    // opens a record, and the ↑↓ walk's only visual state. The pin names the
    // STATE rather than the element, so a resting row that started painting the
    // accent would still fail here.
    // ⚠ `kr-new` JOINED ON 8/31 (K-5 overturned): ＋新規カルテ is the list's own
    // commit-weight action and gets R13's approved primary recipe, exactly as
    // 承認して送信 does. Refused is not un-pressable — every refusal in this room
    // stays focusable on purpose, so the accent is on a control, not on decor.
    const pressable = /kr-help|kr-chip|kr-filter|kr-jump|kr-contact a|kr-crumb a|kr-swap|kr-commit|kr-new|kr-row:focus-visible/
    expect(accented.filter((s) => !pressable.test(s))).toEqual([])
  })

  it('the 目次 is the RECORD’s own shape — it can only name a section that renders', () => {
    // The entries and the sections are decided by the SAME questions, written
    // once each. A 目次 line for a card the record does not have would be a
    // second opinion about what this record holds (⚖ A8), and the mock's own
    // sparse example is exactly this case.
    for (const [entry, section] of [
      ["if (current.discard) out.push({ id: 'krSecDiscard'", '{current.discard && ('],
      ["if (current.aiMessage) out.push({ id: 'krSecMessage'", '{current.aiMessage && ('],
      ["if (current.photos.length > 0) out.push({ id: 'krSecPhotos'", '{current.photos.length > 0 && ('],
    ] as const) {
      expect({ entry, has: SCREEN_CODE.includes(entry) }).toEqual({ entry, has: true })
      expect({ section, has: SCREEN_CODE.includes(section) }).toEqual({ section, has: true })
    }
    // …and every id the 目次 jumps to is an id the record really prints.
    const jumps = [...SCREEN_CODE.matchAll(/out\.push\(\{ id: '(krSec\w+)'/g)].map((m) => m[1])
    expect(jumps.length).toBe(7)
    for (const id of jumps) expect({ id, printed: SCREEN_CODE.includes(`id="${id}"`) }).toEqual({ id, printed: true })
  })

  it('EVERY scroll clears the strip — the jump AND the focus ring (F5-4)', () => {
    // A sticky header and a scroll disagree by default: the browser puts the
    // target's top at the viewport top, which is underneath the strip — the
    // classic sticky-header defect, where the anchor scrolls the heading under
    // the bar that was supposed to help you find it.
    //
    // ⚠ AND 「THE JUMP」 WAS ONLY HALF THE QUESTION (F5-4). The old fix stated the
    // clearance as `scroll-margin-top` on the CARDS, which is the landing target
    // of an anchor jump — but browser FOCUS-scrolling scrolls the focused
    // DESCENDANT, and a button inside a card carries no margin of its own. Tabbing
    // to 詳細記録を編集 at 1280 put it at y=114 under a strip stuck at 62…135:
    // 20 of its 28 pixels painted over, the focus ring effectively invisible.
    // `scroll-padding` belongs to the SCROLL CONTAINER and covers every reason the
    // browser scrolls, so there is exactly ONE clearance in this sheet now.
    const padded = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*scroll-padding-top:([^;]+);[^}]*\}/g)]
      .map((m) => ({ sel: m[1].trim().split('\n').pop()!.trim(), value: m[2].trim() }))
    // Two: the derived one, and the ≤743 band where the strip is in the flow.
    expect(padded.length).toBe(2)
    for (const p of padded) {
      expect({ sel: p.sel, onTheScroller: p.sel.startsWith('html:has(') }).toEqual({ sel: p.sel, onTheScroller: true })
    }
    // …and it is DERIVED from the strip rather than tuned to one band: the
    // topbar's own offset plus the strip's MEASURED height plus air.
    expect(padded[0].value).toBe('calc(var(--kr-strip-top) + var(--kr-strip-h) + 14px)')
    // The room states no second clearance anywhere — not on the cards it used to
    // ride on, and not on any descendant either.
    expect(CSS_CODE).not.toMatch(/scroll-margin/)
  })

  it('the 目次 highlight is THE JUMP, not a guess about scroll position', () => {
    // ⚠ THE FIRST CUT WAS A SCROLL-SPY, AND THE PROBE KILLED IT. The record is a
    // two-column grid, so 本日のセッション and 詳細記録 start at the SAME y —
    // jumping to the right column left both straddling the line and every jump
    // after the first read as 本日のセッション (measured, probe K). Geometry has
    // no answer when two cards are side by side; which entry was pressed has
    // exactly one. So there is no observer and no scroll listener here.
    expect(SCREEN_CODE).toContain('onClick={() => setHere(t.id)}')
    expect(SCREEN_CODE).toContain("aria-current={here === t.id ? 'location' : undefined}")
    expect(SCREEN_CODE).not.toContain('IntersectionObserver')
    // …and it belongs to the record it was taken on, like the warning beside it.
    expect(SCREEN_CODE).toMatch(/setReassignOpen\(false\)\s*\n\s*setHere\(null\)\s*\n\s*\}, \[selected\]\)/)
  })

  it('↑↓ is a VIEW gesture — it moves focus and writes nothing', () => {
    expect(SCREEN_CODE).toContain("if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return")
    expect(SCREEN_CODE).toContain('next.focus()')
    // No state, no selection model, no roving tabindex: every row keeps its
    // natural tab stop, so the arrows ADD a way to move rather than replacing
    // the one the room already proved (the ← focus handover still works because
    // the row that opened the record is still the row that was pressed).
    expect(SCREEN_CODE).not.toMatch(/tabIndex/)
    expect(SCREEN_CODE).toContain('<div className="kr-table" onKeyDown={walkRows}>')
  })

  it('the contact row links to the person, and NEVER to a page that does not exist', () => {
    // ⚖ DEVIATION K-22, pinned so it cannot drift back. The mock draws the middle
    // breadcrumb as a link to the customer's own page; Business has no
    // customer-profile page yet, so the crumb names the person as TEXT and the
    // one link in the row is 顧客, which really is the list — and it spends the
    // same href every other 顧客 pointer in this room spends (⚖ A8).
    expect(SCREEN_CODE).toContain('<span className="kr-crumb-who">')
    const crumb = /<nav\s+className="kr-crumb"[\s\S]*?<\/nav>/.exec(SCREEN_CODE)?.[0] ?? ''
    expect(crumb.length).toBeGreaterThan(200)
    expect([...crumb.matchAll(/<Link href=\{([^}]*)\}/g)].map((m) => m[1])).toEqual(['current.customersHref'])
    // tel:/mailto: are the phone's own two, and they are the only hrefs in the
    // room that are not the 顧客 list.
    const hrefs = [...SCREEN_CODE.matchAll(/href=\{`([^`]*)`\}/g)].map((m) => m[1])
    expect(hrefs.sort()).toEqual(['#${t.id}', 'mailto:${current.email}', 'tel:${current.phone}'])
  })

  it('a customer with no phone or mail gets NO link, never an empty one', async () => {
    const { props } = await karuteProps({ locale: 'ja', store: STORE_A })
    for (const r of props.rows) {
      const c = customers.find((x) => x.id === r.customerId)!
      expect({ id: r.id, phone: r.phone, email: r.email }).toEqual({ id: r.id, phone: c.phone, email: c.email })
    }
    expect(SCREEN_CODE).toContain('{current.phone && (')
    expect(SCREEN_CODE).toContain('{current.email && (')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the room survives real time passing (⚖ L-6)', () => {
  it('is still populated 30 days from now', () => {
    const later = new Date(NOW.getTime() + 30 * 86_400_000)
    const rows = buildRecords({
      records: recordPlane,
      appointments: appointments(later).filter((a) => a.store_id === STORE_A),
      customers, menus, staff,
      todayKey: jstDayKey(later), todayWeekday: jstYmd(later).wd, access: MANAGER,
    })
    expect(rows.length).toBe(11)
  })

  it('is still populated 400 days from now', () => {
    const later = new Date(NOW.getTime() + 400 * 86_400_000)
    const rows = buildRecords({
      records: recordPlane,
      appointments: appointments(later).filter((a) => a.store_id === STORE_A),
      customers, menus, staff,
      todayKey: jstDayKey(later), todayWeekday: jstYmd(later).wd, access: MANAGER,
    })
    expect(rows.length).toBe(11)
    // …and the newest one is still today's, not a date that expired in 2026.
    expect(rows[0].dayKey).toBe(jstDayKey(later))
  })
})
