/**
 * AI相談 — the transplanted room's pins.
 *
 * THE ONE THING THIS SUITE IS FOR: THE ROOM STATES NOTHING THE WORLD ALREADY
 * STATES, AND SHOWS NOTHING THE LENS CANNOT SEE. Not one person's name, one
 * date, one store, one staff member or one menu is written down in this room's
 * own plane — every one is READ through the booking a suggestion, a signal or an
 * 出典 row joins. That is asserted as EQUALITIES AGAINST THE WORLD and as a
 * SOURCE SCAN against the plane, because the W7 candidate's breach was exactly
 * this: a plane that restated the world and deleted two of the world's own
 * assertions to make itself fit.
 *
 * Second job: TWO GATES, BOTH ABOVE THE SERIALIZER. Another store's suggestion
 * never enters the props, and a reader whose persona does not resolve to a
 * preset holding `customers.view` gets props with none of this room's data in
 * them at all — so neither can be in the browser's payload for a screen to
 * "hide". Both are proven by scanning the SERIALIZED props for strings that must
 * not be anywhere in them.
 *
 * Third job: ASKING IS A CALL AND THIS ROOM MAKES NONE. 送信 refuses with its own
 * reason naming registry ①, nothing here fetches anything, nothing renders the
 * phone's 「確認しています…」, and 却下 is honest about being demo-local.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jstDayKey } from '@/business/lib/clock'
import { renderNow } from '@/business/lib/data'
import { appointments, customers, menus, staff, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { threads as threadPlane } from '@/business/lib/fixtures-inbox'
import { records as recordPlane } from '@/business/lib/fixtures-karute'
import {
  conversation as conversationPlane,
  signals as signalPlane,
  suggestions as suggestionPlane,
  templates as templatePlane,
  type FixtureSuggestion,
} from '@/business/lib/fixtures-ask-ai'
import {
  accessFor,
  askAiIndex,
  buildConversation,
  buildFeed,
  buildSignals,
  CATEGORY_LABEL,
  DISMISS_TOAST,
  evidenceLineOf,
  feedOrder,
  keepCardOffHeading,
  LIVE_SEGMENTS,
  permissionNotice,
  REFUSAL,
  scopeCounts,
  todayRosterSize,
  urgencyOf,
  type AskAiWorld,
  type FeedCard,
} from '@/business/lib/ask-ai'
import { askAiProps } from '@/app/[locale]/(business)/business/ask-ai/ask-ai-props'

const ROOM_DIR = 'src/app/[locale]/(business)/business/ask-ai'
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PLANE_SRC = read('src/business/lib/fixtures-ask-ai.ts')
const LIB_SRC = read('src/business/lib/ask-ai.ts')
const SCREEN_SRC = read(`${ROOM_DIR}/AskAiScreen.tsx`)
const PROPS_SRC = read(`${ROOM_DIR}/ask-ai-props.ts`)
const PAGE_SRC = read(`${ROOM_DIR}/page.tsx`)
const CSS_SRC = read(`${ROOM_DIR}/ask-ai.css`)

/** Source pins read CODE, not prose: this room documents its own rules in
 *  comments that quote the very strings the pins look for. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PLANE_CODE = stripComments(PLANE_SRC)
const LIB_CODE = stripComments(LIB_SRC)
const SCREEN_CODE = stripComments(SCREEN_SRC)
const PROPS_CODE = stripComments(PROPS_SRC)
const PAGE_CODE = stripComments(PAGE_SRC)
const CSS_CODE = stripComments(CSS_SRC)

// ── the world, rebuilt HERE so the pins are equalities and not echoes ────────

const NOW = renderNow()
const ALL = appointments(NOW)
const inStore = (id: string) => ALL.filter((a) => a.store_id === id)

function worldFor(storeId: string): AskAiWorld {
  const appts = inStore(storeId)
  const todayKey = jstDayKey(NOW)
  return {
    appointments: appts,
    todayAppointments: appts.filter((a) => jstDayKey(new Date(a.starts_at)) === todayKey),
    upcomingAppointments: appts.filter((a) => a.starts_at > NOW.toISOString() && a.status !== 'cancelled'),
    customers,
    menus,
    staff,
    records: recordPlane,
    threads: threadPlane,
  }
}
const WORLD_A = worldFor(STORE_A)
const WORLD_B = worldFor(STORE_B)

/** cus-11 books ONLY in 銀座 and cus-03 ONLY in 代官山 — the two names that make
 *  the isolation pin an equality rather than a hope, in both directions. */
const A_ONLY_NAME = customers.find((c) => c.id === 'cus-11')!.name
const B_ONLY_NAME = customers.find((c) => c.id === 'cus-03')!.name

describe('⚖ THE PLANE LAW — this room ADDS, and restates nothing', () => {
  it('the plane imports NOTHING, so it cannot restate the world', () => {
    // The machine-readable half of this lives in foundation.test.ts's INVENTORY
    // (an empty list for this file). Here it is read directly, because a plane
    // that grew one import is the whole breach class in one line.
    expect(PLANE_CODE).not.toMatch(/^\s*import\s/m)
  })

  it('every suggestion joins the world by id and states none of its facts', () => {
    const apptIds = new Set(ALL.map((a) => a.id))
    const recIds = new Set(recordPlane.map((r) => r.id))
    const threadIds = new Set(threadPlane.map((t) => t.id))
    const custIds = new Set(customers.map((c) => c.id))
    for (const s of suggestionPlane) {
      const { collection, id } = s.sourceRef
      const known =
        collection === 'bookings' ? apptIds.has(id)
          : collection === 'karuteRecords' ? recIds.has(id)
            : collection === 'inbox' ? threadIds.has(id)
              : custIds.has(id)
      expect({ id: s.id, ref: `${collection}/${id}`, known }).toEqual({ id: s.id, ref: `${collection}/${id}`, known: true })
    }
  })

  it('no plane string carries a person, a staff member, a menu or a date', () => {
    // Whole file, comments included: a name in a comment is a name a later
    // editor can copy into a string, and the world is the only home for one.
    const names = [
      ...customers.map((c) => c.name),
      ...staff.map((s) => s.full_name),
      ...menus.map((m) => m.name),
    ]
    const found = names.filter((n) => PLANE_SRC.includes(n))
    expect(found).toEqual([])
    // …and no calendar date, in any spelling this world could produce.
    expect(PLANE_CODE).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(PLANE_CODE).not.toMatch(/\d+月\d+日/)
  })

  it('every deep link targets a room that is LIVE at this tip', () => {
    for (const s of suggestionPlane) {
      expect({ id: s.id, segment: s.deepLink, live: Boolean(LIVE_SEGMENTS[s.deepLink]) })
        .toEqual({ id: s.id, segment: s.deepLink, live: true })
    }
    // …and the 準備中 rooms are NOT on that list, which is what makes the pin
    // above a real gate rather than a spelling check.
    for (const dead of ['recording', 'coaching', 'settings']) {
      expect({ dead, live: Boolean(LIVE_SEGMENTS[dead]) }).toEqual({ dead, live: false })
    }
  })

  it('every category the plane uses has a label, and they are canon AI設定’s four', () => {
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual(['booking', 'customer_follow', 'staffing', 'vip'])
    expect(Object.values(CATEGORY_LABEL)).toEqual(
      expect.arrayContaining(['顧客フォロー', 'スタッフ配置・欠勤対応', '予約・空き待ち案内', 'VIP・ロイヤルティ']),
    )
    for (const s of suggestionPlane) expect(CATEGORY_LABEL[s.category]).toBeTruthy()
  })

  it('the room’s derivations hold no clock, no formatter and no data access', () => {
    // The family law: the props assembly owns the clock, so this module cannot
    // put a different day on a chip from the one the page counted.
    expect(LIB_CODE).not.toMatch(/new Date\(/)
    expect(LIB_CODE).not.toMatch(/Date\.now/)
    expect(LIB_CODE).not.toMatch(/Intl\./)
    // ⚠ THE "NO DATA DOOR, NO CLOCK MODULE" HALF IS NOT SPELLED HERE, AND THAT IS
    // DELIBERATE. It lives in foundation.test.ts's INVENTORY, which pins this
    // module's EXACT import list rather than forbidding two names — a stronger
    // pin, and the one the family already maintains. Writing the specifiers out
    // here would ALSO be read as real imports by the territory import-isolation
    // scanner (its own documented ceiling: a matching string in a literal
    // false-flags), which is exactly what it did on the first run of this suite.
  })
})

describe('the feed — canon’s rules, as pure functions', () => {
  const feedA = buildFeed(suggestionPlane, WORLD_A)
  const feedB = buildFeed(suggestionPlane, WORLD_B)

  it('a lens sees its OWN suggestions and no other store’s', () => {
    expect(feedA.map((c) => c.id).sort()).toEqual(
      ['sug-absence', 'sug-change', 'sug-draft', 'sug-hold', 'sug-revisit', 'sug-vip-settle'],
    )
    expect(feedB.map((c) => c.id).sort()).toEqual(['sug-ticket', 'sug-vip-next', 'sug-waitlist'])
    // …and the two sets are disjoint, which is the isolation law stated as an
    // arithmetic fact rather than as two spot checks.
    const a = new Set(feedA.map((c) => c.id))
    expect(feedB.filter((c) => a.has(c.id))).toEqual([])
  })

  it('a badge comes ONLY from a hard fact the referenced record carries', () => {
    const ixA = askAiIndex(WORLD_A)
    const ixB = askAiIndex(WORLD_B)
    // 仮押さえ — apt-26 is still waiting for the customer's yes (`board_state`).
    expect(urgencyOf({ collection: 'bookings', id: 'apt-26' }, ixA)).toBe('要対応')
    // …and a booking that is NOT on hold gets nothing, however important it looks.
    expect(urgencyOf({ collection: 'bookings', id: 'apt-25' }, ixA)).toBeNull()
    // 回答期限 — inb-wait is the one thread in the world carrying its own.
    const due = threadPlane.find((t) => t.id === 'inb-wait')!.due!
    const hh = `${String(Math.floor(due / 60)).padStart(2, '0')}:${String(due % 60).padStart(2, '0')}`
    expect(urgencyOf({ collection: 'inbox', id: 'inb-wait' }, ixB)).toBe(`回答期限 ${hh}`)
    // …and a thread whose deadline lives on its 予約一覧 row states none here.
    expect(urgencyOf({ collection: 'inbox', id: 'inb-change' }, ixA)).toBeNull()
    // A karute record can never carry urgency: nothing in a record is a deadline.
    expect(urgencyOf({ collection: 'karuteRecords', id: 'K-0001' }, ixA)).toBeNull()
    // Exactly ONE badged card per store in the demo world — the exception stays
    // an exception, which is the whole point of deriving it.
    expect(feedA.filter((c) => c.badge).map((c) => c.id)).toEqual(['sug-hold'])
    expect(feedB.filter((c) => c.badge).map((c) => c.id)).toEqual(['sug-waitlist'])
  })

  it('the order is exception-first and STABLE inside each tier', () => {
    expect(feedA[0].id).toBe('sug-hold')
    // the plane's own order, minus the badged row, is what follows
    const rest = suggestionPlane
      .map((s) => s.id)
      .filter((id) => feedA.some((c) => c.id === id) && id !== 'sug-hold')
    expect(feedA.slice(1).map((c) => c.id)).toEqual(rest)
    // …and the sort is a pure function of the badge, proven on a hand-built list
    // so the pin cannot be true for a second reason (the M10 lesson).
    const fake = (id: string, badge: string | null) => ({ id, badge }) as FeedCard
    expect(feedOrder([fake('a', null), fake('b', '要対応'), fake('c', null), fake('d', '期限')]).map((c) => c.id))
      .toEqual(['b', 'd', 'a', 'c'])
  })

  it('every evidence line is a HUMAN STORY, and no machine id is ever rendered', () => {
    const ixA = askAiIndex(WORLD_A)
    expect(evidenceLineOf({ collection: 'karuteRecords', id: 'K-0001' }, ixA))
      .toBe('カルテ K-0001・見本 いつき様（担当 見本 しろう / テスト整体 60分）')
    expect(evidenceLineOf({ collection: 'bookings', id: 'apt-26' }, ixA))
      .toBe(`予約 R-4826・${A_ONLY_NAME}様（担当 見本 しろう / テスト整体 60分）`)
    expect(evidenceLineOf({ collection: 'inbox', id: 'inb-change' }, ixA))
      .toBe('受信トレイ・テスト えいた様（予約日時の変更希望）')
    // ⚖ the audit-display law: not one machine id reaches a rendered string.
    for (const card of [...feedA, ...feedB]) {
      expect(card.evidence).not.toMatch(/apt-\d+/)
      expect(card.evidence).not.toMatch(/inb-[a-z]+/)
      expect(card.evidence).not.toMatch(/cus-\d+|thin-\d+/)
      expect(card.evidence).not.toMatch(/\bp-\d+|\bc-\d+/)
      expect(card.evidence).not.toMatch(/menu-\d+/)
    }
    // …and an UNRESOLVABLE reference is DROPPED rather than falling back to one.
    expect(evidenceLineOf({ collection: 'bookings', id: 'apt-9999' }, ixA)).toBeNull()
    expect(evidenceLineOf({ collection: 'karuteRecords', id: 'K-0011' }, ixA)).toBeNull()
  })

  it('a suggestion pointed at a room that is not live never becomes a card', () => {
    const bad: FixtureSuggestion[] = [
      { ...suggestionPlane[0], id: 'sug-dead', deepLink: 'coaching' },
    ]
    expect(buildFeed(bad, WORLD_A)).toEqual([])
  })

  it('⚖ ANY-ROSTER-SIZE on the feed dimension — 25+ suggestions, arithmetic exact', () => {
    const many: FixtureSuggestion[] = Array.from({ length: 30 }, (_, i) => ({
      id: `bulk-${i}`,
      category: 'customer_follow' as const,
      text: `見本の提案 ${i}`,
      sourceRef: { collection: 'karuteRecords' as const, id: 'K-0001' },
      deepLink: 'karute',
    }))
    const feed = buildFeed(many, WORLD_A)
    expect(feed).toHaveLength(30)
    // none of them badged (a karute record carries no hard fact), so the order
    // is the plane's own — a 30-row feed must not reshuffle itself.
    expect(feed.map((c) => c.id)).toEqual(many.map((s) => s.id))
    // …and the sheet gives the feed no scroller of its own to hide them in.
    expect(CSS_CODE).not.toMatch(/\.ak-feed[^{]*\{[^}]*overflow/)
    expect(CSS_CODE).not.toMatch(/max-height/)
    expect(CSS_CODE).not.toMatch(/overscroll-behavior/)
  })
})

describe('the consultation — the phone’s contract, mirrored', () => {
  it('the designed thread renders every SHAPE the desk has to draw', () => {
    const turns = buildConversation(conversationPlane, WORLD_A)
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'error'])
    // ⚖ D-3 — the failure is a designed turn, not a latent branch, and it says
    // WHICH failure rather than the phone's one 「エラーが発生しました。」.
    const err = turns.find((t) => t.role === 'error')!
    expect(err.text).not.toBe('エラーが発生しました。')
    expect(err.text).toContain('回答を受け取れませんでした')
  })

  it('出典 rows resolve through the world, and the count is DERIVED from them', () => {
    const turns = buildConversation(conversationPlane, WORLD_A)
    const answer = turns.find((t) => t.role === 'assistant')!
    expect(answer.sources.map((s) => s.line)).toEqual([
      '顧客 C-3002・見本 いつき様',
      '顧客 C-3008・テスト くらら様',
      'カルテ K-0001・見本 いつき様（担当 見本 しろう / テスト整体 60分）',
    ])
    // ⚖ 8/25 — the label says what it counts, and it counts what is printed.
    expect(answer.sourceCountLabel).toBe(`出典 ${answer.sources.length}件`)
    // …and a question carries none, never 「出典 0件」.
    expect(turns[0].sources).toEqual([])
    expect(turns[0].sourceCountLabel).toBeNull()
    // ⚖ AND NO SENTENCE COUNTS ITS OWN SOURCES. Under 代官山 one of the three
    // rows is out of lens; a text that said 「2名」 would then be false.
    const turnsB = buildConversation(conversationPlane, WORLD_B)
    const answerB = turnsB.find((t) => t.role === 'assistant')!
    expect(answerB.sources).toHaveLength(1)
    expect(answerB.text).toBe(answer.text)
    expect(answerB.text).not.toMatch(/[0-9０-９]+\s*[名件]/)
  })

  it('context_label is present ONLY when the lens can read the rows — the shipped rule', () => {
    // `karute-chat.ts:86-92`: customerName is non-null only when in-scope rows
    // came back, so the label can never name a customer the lens cannot read.
    const a = buildConversation(conversationPlane, WORLD_A).find((t) => t.contextLabel)
    expect(a?.contextLabel).toBe('テスト くらら様のカルテ2件')
    // cus-08 books in 代官山 too, but has no record there — so no label at all,
    // rather than 「…のカルテ0件」.
    const b = buildConversation(conversationPlane, WORLD_B)
    expect(b.every((t) => t.contextLabel === null)).toBe(true)
  })

  it('今日のヒント is composed from the world, and its roster count is exact', () => {
    const chipsA = buildSignals(signalPlane, WORLD_A)
    expect(chipsA.map((c) => c.id)).toEqual(['sig-roster', 'sig-revisit'])
    const nA = new Set(WORLD_A.todayAppointments.map((a) => a.customer_id)).size
    expect(nA).toBe(todayRosterSize(WORLD_A))
    expect(chipsA[0].title).toBe(`本日ご来店の${nA}名のお客様の要点まとめ`)
    expect(chipsA[0].contextLabel).toBe(`本日ご来店のお客様${nA}名のカルテ`)
    expect(chipsA[1].title).toBe('見本 いつき様：前回のご提案が記録に残っています')
    expect(chipsA[1].contextLabel).toBe('見本 いつき様のカルテ2件')

    const chipsB = buildSignals(signalPlane, WORLD_B)
    expect(chipsB.map((c) => c.id)).toEqual(['sig-roster', 'sig-waitlist'])
    // cus-03 has no record anywhere, so the chip carries no context label — the
    // contract's own rule, not a special case for this chip.
    expect(chipsB[1].contextLabel).toBeNull()
    // …and a store with nothing booked today loses the roster chip entirely,
    // rather than showing 「本日ご来店の0名」.
    expect(buildSignals(signalPlane, { ...WORLD_A, todayAppointments: [] }).map((c) => c.id)).toEqual(['sig-revisit'])
  })

  it('じっくり相談 carries the phone’s three, and the dead keys are NOT imported', () => {
    expect(templatePlane).toHaveLength(3)
    expect(templatePlane.map((t) => t.title)).toEqual([
      'ブライダル目標のお客様',
      '集中期→メンテナンス移行率',
      '夏前ボディメイクコース',
    ])
    // ⚖ D-5 — `suggestion1`–`suggestion4` in the phone's namespace are legacy
    // keys no component consumes; nothing in this room may carry them.
    // Read the CODE, not the prose: this room DOCUMENTS the dead keys so a later
    // editor knows why they are absent, and a scan of the raw file would then be
    // failed by its own explanation.
    for (const src of [PLANE_CODE, LIB_CODE, PROPS_CODE, SCREEN_CODE]) {
      expect(src).not.toMatch(/suggestion[1-4]/)
    }
  })
})

describe('the scope strip — four labelled facts, exact', () => {
  it('every chip says WHAT it counts, and the number is the world’s own', () => {
    const facts = scopeCounts(WORLD_A)
    expect(facts.map((f) => f.label)).toEqual(['カルテ', '顧客', '予約', '録音'])
    // ⚖ 8/25 — never a bare number.
    for (const f of facts) expect(f.value).toMatch(/^\d+(件|名)$/)

    const apptIds = new Set(WORLD_A.appointments.map((a) => a.id))
    const mine = recordPlane.filter((r) => apptIds.has(r.appointment_id))
    expect(facts[0].value).toBe(`${mine.length}件`)
    expect(facts[1].value).toBe(`${new Set(WORLD_A.appointments.map((a) => a.customer_id)).size}名`)
    expect(facts[2].value).toBe(`${WORLD_A.upcomingAppointments.length}件`)
    expect(facts[3].value).toBe(`${mine.filter((r) => r.recording !== null).length}件`)
    // …and the counts genuinely differ per lens, so the strip is store-clamped
    // rather than business-wide with a label on it.
    expect(scopeCounts(WORLD_B)[0].value).not.toBe(facts[0].value)
  })
})

describe('who may consult — the phone’s own rule, mirrored', () => {
  it('the admitted personas are the presets that hold customers.view', () => {
    for (const role of ['オーナー', '店舗管理者', '上級スタッフ', 'スタッフ', '受付']) {
      expect({ role, consult: accessFor(role).consult }).toEqual({ role, consult: true })
    }
  })

  it('a blank custom role is DENIED, and so is a prototype-chain name', () => {
    for (const role of ['', '  ', 'カスタム', 'constructor', '__proto__', 'toString']) {
      expect({ role, consult: accessFor(role).consult }).toEqual({ role, consult: false })
    }
  })

  it('the permission note names the real rule, never 「権限がありません」 alone', () => {
    const lines = permissionNotice(accessFor(''))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toContain('顧客を閲覧できる権限')
    expect(permissionNotice(accessFor('店舗管理者'))).toEqual([])
  })
})

describe('the props assembly — the two gates, above the serializer', () => {
  it('a denied reader’s payload contains NONE of this room’s data', async () => {
    const { props } = await askAiProps({ locale: 'ja', store: STORE_A, world: { role: '' } })
    expect(props.noticeLines.length).toBeGreaterThan(0)
    expect(props.feed).toEqual([])
    expect(props.turns).toEqual([])
    expect(props.signals).toEqual([])
    expect(props.templates).toEqual([])
    expect(props.scope).toEqual([])
    // …and the payload itself carries no person, no record and no question.
    const json = JSON.stringify(props)
    for (const name of customers.map((c) => c.name)) expect(json).not.toContain(name)
    for (const r of recordPlane) expect(json).not.toContain(r.id)
    for (const t of conversationPlane) expect(json).not.toContain(t.text)
  })

  it('an admitted reader gets the room, and the store clamp leaves NOTHING behind', async () => {
    const a = await askAiProps({ locale: 'ja', store: STORE_A })
    const b = await askAiProps({ locale: 'ja', store: STORE_B })
    expect(a.storeKey).toBe(STORE_A)
    expect(b.storeKey).toBe(STORE_B)

    const jsonA = JSON.stringify(a.props)
    const jsonB = JSON.stringify(b.props)
    // Each lens carries its OWN store's person and record…
    expect(jsonA).toContain(A_ONLY_NAME)
    expect(jsonB).toContain(B_ONLY_NAME)
    // …and not one trace of the other's, in either direction.
    expect(jsonA).not.toContain(B_ONLY_NAME)
    expect(jsonB).not.toContain(A_ONLY_NAME)
    expect(jsonA).not.toContain('K-0011')
    expect(jsonB).not.toContain('K-0001')
    // …nor the other store's own name or id.
    expect(jsonA).not.toContain('テスト代官山店')
    expect(jsonB).not.toContain('テスト銀座店')
  })

  it('every card’s action targets a live room and CARRIES the current lens', async () => {
    const { props } = await askAiProps({ locale: 'ja', store: STORE_B })
    expect(props.feed.length).toBeGreaterThan(0)
    for (const c of props.feed) {
      expect(c.href).toBe(`/ja/business/${c.segment}?store=${encodeURIComponent(STORE_B)}`)
      expect(LIVE_SEGMENTS[c.segment]).toBeTruthy()
      // registry ⑥ — no room accepts a record-level param at this tip, so none
      // is ever invented.
      expect(c.href).not.toMatch(/[?&]id=/)
    }
    expect(props.boundary.backHref).toBe(`/ja/business/today?store=${encodeURIComponent(STORE_B)}`)
  })

  it('an unknown ?store= opens on the operator’s own store, never a merge', async () => {
    const { props, storeKey } = await askAiProps({ locale: 'ja', store: 'store-does-not-exist' })
    expect(storeKey).toBe(STORE_A)
    expect(props.lensLabel).toBe('テスト銀座店')
    // ⚖ N-STORES: this is a per-store room and the count of stores never enters
    // the page — the switcher is the shell's, and すべての店舗 is not offered.
    expect(JSON.stringify(props)).not.toContain('すべての店舗')
  })

  it('the data states the design was drawn against all render', async () => {
    // zero suggestions → canon's empty state, and the count says 0 rather than
    // the section vanishing (a feed with nothing in it is still a feed).
    const empty = await askAiProps({ locale: 'ja', store: STORE_A, world: { suggestions: [] } })
    expect(empty.props.feed).toEqual([])
    expect(empty.props.feedEmpty.title).toBe('提案はまだありません')
    expect(empty.props.feedEmpty.body).toContain('録音記録の確定・予約の変化')

    // zero conversation → the phone's own startHint, verbatim.
    const quiet = await askAiProps({ locale: 'ja', store: STORE_A, world: { conversation: [] } })
    expect(quiet.props.turns).toEqual([])
    expect(quiet.props.startHint).toBe('上のプロンプトを選ぶか、質問を入力して会話を始めてください。')

    // 業種未設定 → the profileHint, and NEVER both it and the tuned label.
    const unset = await askAiProps({ locale: 'ja', store: STORE_A, world: { businessType: null } })
    expect(unset.props.profileHint?.title).toBe('業種が未設定です')
    expect(unset.props.tunedLabel).toBeNull()
    const set = await askAiProps({ locale: 'ja', store: STORE_A })
    expect(set.props.profileHint).toBeNull()
    expect(set.props.tunedLabel).toBe('最適化対象：美容整体')

    // longest strings — an unbroken run has to survive the join and reach the
    // screen intact, so the sheet's break-words rule has something to break.
    const RUN = 'https://example.invalid/' + 'a'.repeat(120)
    const long = await askAiProps({
      locale: 'ja',
      store: STORE_A,
      world: { conversation: [{ id: 'q', role: 'user', text: `この記事の内容を要約してください ${RUN}`, sources: [], contextRef: null }] },
    })
    expect(long.props.turns[0].text).toContain(RUN)
  })

  it('the trace card states something REAL or says 未接続 — never a blank', async () => {
    const { props } = await askAiProps({ locale: 'ja', store: STORE_A })
    expect(props.trace.length).toBeGreaterThan(0)
    for (const row of props.trace) {
      expect(row.label.trim()).not.toBe('')
      expect(row.value.trim()).not.toBe('')
      expect({ label: row.label, honest: row.unconnected === row.value.includes('未接続') })
        .toEqual({ label: row.label, honest: true })
    }
    // registry ⑦ — the dials' home is the 設定 room, which builds LAST.
    expect(props.trace.some((r) => r.label === '提案の積極度' && r.unconnected)).toBe(true)
    // registry ③ — the ephemerality is stated as a fact, not a promise.
    expect(props.trace.some((r) => r.value.includes('保存しません'))).toBe(true)
  })

  it('the privacy line says what the shipped contract actually does', async () => {
    const { props } = await askAiProps({ locale: 'ja', store: STORE_A })
    expect(props.privacyLines[0]).toContain('保存されません')
    expect(props.privacyLines[0]).toContain('使った回数だけ')
    expect(props.privacyLines[1]).toContain('予約の中身そのものは読み取りません')
  })
})

describe('⚖ ASKING IS A CALL, AND THIS ROOM MAKES NONE', () => {
  it('nothing in the room’s runtime fetches anything', () => {
    for (const [name, src] of [['screen', SCREEN_CODE], ['props', PROPS_CODE], ['lib', LIB_CODE], ['page', PAGE_CODE], ['plane', PLANE_CODE]] as const) {
      expect({ name, fetch: /\bfetch\s*\(/.test(src) }).toEqual({ name, fetch: false })
      expect({ name, api: /['"`]\/api\//.test(src) }).toEqual({ name, api: false })
      expect({ name, xhr: /XMLHttpRequest|EventSource|WebSocket/.test(src) }).toEqual({ name, xhr: false })
    }
  })

  it('⚖ D-2 — no generation theatre: no thinking state, no synthetic reply', () => {
    for (const src of [SCREEN_CODE, PROPS_CODE, LIB_CODE, PLANE_CODE]) {
      expect(src).not.toContain('確認しています')
      expect(src).not.toContain('thinking')
    }
    // …and no timer that resolves into content. The one timer in the room is
    // the toast's, and it only takes a message AWAY.
    const timers = [...SCREEN_CODE.matchAll(/setTimeout\(/g)]
    expect(timers).toHaveLength(1)
    expect(SCREEN_CODE).toContain('toastTimer.current = setTimeout(() => setToast(null), 2800)')
  })

  it('SEND refuses honestly, names registry ①, and changes NOTHING', () => {
    expect(REFUSAL.send).toContain('回答を生成できません')
    expect(REFUSAL.send).toContain('登録①')
    // The composer's state is never touched on the refusal path: `refuseSend`
    // sets the refusal and nothing else, and no handler clears the draft.
    expect(SCREEN_CODE).toContain('const refuseSend = (contextLabel: string | null = null) => {')
    expect(SCREEN_CODE).not.toMatch(/setDraft\(''\)/)
    // …and the box stays usable — `disabled` is the EMPTY-input contract only.
    expect(SCREEN_CODE).toContain("disabled={draft.trim() === ''}")
  })

  it('Enter sends and Shift+Enter is a newline — the contract the hint documents', () => {
    expect(SCREEN_CODE).toContain("if (e.key !== 'Enter' || e.shiftKey) return")
    expect(SCREEN_CODE).toContain('if (draft.trim()) refuseSend()')
    expect(PROPS_CODE).toContain('改行は Shift + Enter')
  })

  it('the two prompt systems keep their two DIFFERENT click behaviours', () => {
    // Read the two handler BODIES rather than measuring a distance: a proximity
    // regex is a pin that can be true for a second reason (the M10 lesson), and
    // these two behaviours are the whole difference between the systems.
    const signalBody = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('const takeSignal'),
      SCREEN_CODE.indexOf('const takeTemplate'),
    )
    const templateBody = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('const takeTemplate'),
      SCREEN_CODE.indexOf('const onComposerKey'),
    )
    expect(signalBody.length).toBeGreaterThan(60)
    expect(templateBody.length).toBeGreaterThan(60)
    // 今日のヒント: fills AND walks the send path, with its context label.
    expect(signalBody).toContain('setDraft(chip.prompt)')
    expect(signalBody).toContain('refuseSend(chip.contextLabel)')
    // じっくり相談: fills ONLY — no send, no refusal.
    expect(templateBody).toContain('setDraft(pill.example)')
    expect(templateBody).toContain('setRefusal(null)')
    expect(templateBody).not.toContain('refuseSend')
  })

  it('却下 is DEMO-LOCAL and says so — and is persisted nowhere', () => {
    expect(DISMISS_TOAST).toBe('提案を却下しました（デモ・保存されません）')
    // In-memory only: no storage of any kind anywhere in the room's runtime.
    for (const src of [SCREEN_CODE, PROPS_CODE, LIB_CODE, PAGE_CODE]) {
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
    }
    expect(SCREEN_CODE).toContain('const [dismissed, setDismissed] = useState<string[]>([])')
  })

  it('a store switch RESETS the screen, because the route keys it by the lens', () => {
    expect(PAGE_CODE).toContain('<AskAiScreen key={storeKey} {...props} />')
  })

  it('the room reaches into the phone’s AI runtime NOWHERE', () => {
    for (const src of [SCREEN_SRC, PROPS_SRC, LIB_SRC, PAGE_SRC, PLANE_SRC]) {
      expect(src).not.toMatch(/from ['"]@\/lib\/ai\//)
      expect(src).not.toMatch(/from ['"]@\/lib\/app-api\//)
      expect(src).not.toMatch(/from ['"]@\/components\/ai\//)
      expect(src).not.toMatch(/from ['"]@\/lib\/karute\//)
      expect(src).not.toMatch(/from ['"]@\/lib\/welcome\//)
    }
    // react-dom is off territory's import allowlist and this room adds no use
    // for it (the topbar's action slot is context, not a portal).
    expect(SCREEN_SRC).not.toMatch(/react-dom/)
  })

  it('the shared engine and the shared read libs are UNTOUCHED', () => {
    // guide.ts is FROZEN: this room wires a trigger and an overlay to it.
    const guide = read('src/business/lib/guide.ts')
    expect(guide).not.toContain('ask-ai')
    expect(guide).not.toContain('ak-')
    // …and the plane joins the world as-is: zero edits to the shared planes.
    expect(read('src/business/lib/fixtures.ts')).not.toContain('askAi')
    expect(read('src/business/lib/fixtures-karute.ts')).not.toContain('ask')
    expect(read('src/business/lib/clock.ts')).not.toContain('ask')
    expect(read('src/business/lib/today-board.ts')).not.toContain('ask-ai')
  })
})

describe('the shell one-liners', () => {
  const SIDEBAR = read('src/app/[locale]/(business)/BusinessSidebar.tsx')
  const TOPBAR = read('src/app/[locale]/(business)/BusinessTopbar.tsx')

  it('the nav item is LIVE and points at this room’s segment', () => {
    expect(SIDEBAR).toContain("{ key: 'askAi', segment: 'ask-ai', label: 'AI相談', mini: 'AI相談', live: true }")
    // ⚖ a nav-bar item never blinks — nothing in the rail animates for this room.
    expect(SIDEBAR).not.toMatch(/animate|blink|pulse/)
  })

  it('the breadcrumb leaf is the room’s own name', () => {
    expect(TOPBAR).toContain("'ask-ai': 'AI相談',")
  })

  it('the loading string exists, so the route’s own convention has copy', () => {
    const i18n = JSON.parse(read('src/business/i18n/ja.json'))
    expect(i18n.askAi.loading).toBe('読み込み中…')
  })

  it('録音 and コーチング and 設定 stay 準備中 — this room flips ONE line', () => {
    expect(SIDEBAR).toContain("{ key: 'recording', segment: null, label: '録音', mini: '録音', live: false }")
    expect(SIDEBAR).toContain("{ key: 'coaching', segment: null, label: 'コーチング', mini: 'コーチ', live: false }")
    expect(SIDEBAR).toContain("{ key: 'settings', segment: null, label: '設定', mini: '設定', live: false }")
  })
})

describe('⚖ THE SIBLING-SHEET FENCE, derived FRESH from today’s sheets', () => {
  const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
  const stripCss = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  /** ⚠ WALKS THE AT-RULES INSTEAD OF SPLITTING BLINDLY (the ⚖ fence-method
   *  amendment, room-5 lens 3). A naive `split('}')` + `indexOf('{')` never sees
   *  the FIRST rule inside any `@media` block — the first `{` found is the media
   *  query's own brace — and a planted unscoped rule at the top of a media block
   *  passes every pin. Conditional groups lose their PRELUDE and keep their
   *  rules; keyframes and font-face blocks go entirely, so `from`/`to` never read
   *  as selectors. Red-proven below against exactly that plant. */
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
    if (d === 'ask-ai') return false
    try {
      readFileSync(join(BIZ, 'business', d, `${d}.css`))
      return true
    } catch {
      return false
    }
  })

  const mine = new Set<string>(['pill', 'good', 'warn', 'alert', 'indigo', 'btn', 'primary', 'danger', 'page'])
  for (const sel of selectorsOf(CSS_SRC)) {
    if (!sel.includes('pg-ask-ai')) continue
    for (const c of classesIn(sel)) if (c !== 'pg-ask-ai') mine.add(c)
  }

  it('the parser SEES the first rule inside an @media block (red-proven)', () => {
    const planted = '@media (max-width: 743px) {\n  .biz .btn { padding: 0; }\n  .biz .pg-ask-ai .ak-send { padding: 0; }\n}'
    expect(selectorsOf(planted)).toEqual(['.biz .btn', '.biz .pg-ask-ai .ak-send'])
  })

  it('the neighbours are all here — read from disk, never restated', () => {
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'customers', 'inbox', 'karute', 'register', 'reservations', 'shifts', 'today'])
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
      'customers::.biz .page .btn',
      'reservations::.biz .btn',
      'reservations::.biz .btn.primary',
    ])
    // …and this room states its own value for each of them, at FOUR levels.
    const BASE = CSS_CODE.slice(0, CSS_CODE.indexOf('@media'))
    expect(BASE.length).toBeGreaterThan(1000)
    for (const fence of [
      '.biz .page.pg-ask-ai { padding:',
      '.biz .page.pg-ask-ai h1 {',
      '.biz .page.pg-ask-ai .btn {',
      '.biz .page.pg-ask-ai .btn.primary {',
    ]) {
      expect({ fence, inBaseSheet: BASE.includes(fence) }).toEqual({ fence, inBaseSheet: true })
    }
    // The room's own root rule is NEVER stated at three levels — that is the tie
    // a sibling's three-level rule wins on insertion order.
    expect(CSS_CODE).not.toMatch(/\.biz \.pg-ask-ai \{/)
    expect(CSS_CODE).not.toMatch(/\.biz \.pg-ask-ai h1 \{/)
  })

  it('this room’s own names exist NOWHERE else in the family', () => {
    const own = [...mine].filter((n) => n.startsWith('ak-'))
    expect(own.length).toBeGreaterThan(30)
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const n of own) {
        expect({ dir, name: n, used: src.includes(`.${n}`) }).toEqual({ dir, name: n, used: false })
      }
    }
    const shell = readFileSync(join(BIZ, 'business-shell.css'), 'utf8')
    for (const n of own) expect({ name: n, inShell: shell.includes(`.${n}`) }).toEqual({ name: n, inShell: false })
  })

  it('every class name the SCREEN renders is this room’s own, or one of the shell’s', () => {
    const rendered = new Set<string>()
    for (const m of SCREEN_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const name of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (name && /^[a-z][\w-]*$/.test(name)) rendered.add(name)
      }
    }
    const SHELL = new Set(['page', 'pg-ask-ai', 'btn', 'primary'])
    expect([...rendered].filter((n) => !n.startsWith('ak-') && !SHELL.has(n))).toEqual([])
    expect([...rendered].filter((n) => n.startsWith('ak-')).length).toBeGreaterThan(30)
    // …and the shell names it does render are exactly the two it fences.
    expect([...rendered].filter((n) => !n.startsWith('ak-')).sort()).toEqual(['btn', 'primary'])
    expect(SCREEN_CODE).toContain("const ROOT = 'page pg-ask-ai'")
  })

  it('⚖ PAGE-SCROLL — not one container in this room owns an axis', () => {
    // The one exception is the composer, which is a TEXT CONTROL and not a
    // wrapper: it is named here so the exemption is argued rather than assumed.
    const offenders = []
    for (const block of stripCss(CSS_SRC).split('}')) {
      const i = block.indexOf('{')
      if (i < 0) continue
      const sel = block.slice(0, i).trim()
      const body = block.slice(i + 1)
      if (/overflow(-x|-y)?\s*:\s*(auto|scroll)/.test(body) || /overscroll-behavior/.test(body) || /max-height/.test(body)) {
        offenders.push(sel)
      }
    }
    expect(offenders).toEqual([])
    // …and `position: sticky` appears nowhere at all in this room.
    expect(CSS_CODE).not.toMatch(/position:\s*sticky/)
  })

  it('⚖ R13 + the one-way accent law — no black-filled interactive, accent on pressables only', () => {
    // The commit action and the deep link are the ONLY solid accent fills.
    const solid = [...CSS_CODE.matchAll(/([^{}]+)\{([^}]*background:\s*var\(--ak-accent\)[^}]*)\}/g)].map((m) => m[1].trim())
    expect(solid.sort()).toEqual([
      '.biz .pg-ask-ai .ak-open',
      '.biz .pg-ask-ai .ak-send',
    ])
    // …and the hover DARKENS within the accent rather than lightening toward
    // the page (an opacity hover drops white text below AA).
    expect(CSS_CODE).toContain('.biz .pg-ask-ai .ak-send:hover:not(:disabled) { background: var(--ak-accent-hover); }')
    expect(CSS_CODE).not.toMatch(/hover:?[^{]*\{[^}]*opacity/)
    // Nothing in this room is black-filled, and nothing borrows the shell's
    // `bg-foreground`-shaped darks.
    expect(CSS_CODE).not.toMatch(/background:\s*#0{3,6}\b/)
    expect(CSS_CODE).not.toMatch(/background:\s*(black|var\(--ink\))/)
  })
})

describe('the tour placement correction — pure, and it really moves the card', () => {
  it('a card that would cover a section’s heading is moved off it', () => {
    const viewport = { width: 1280, height: 800 }
    const card = { width: 300, height: 160 }
    // A section taller than the viewport: the engine's last-resort clamp parks
    // the card at the target's own top, which is where the heading is.
    const tall = { left: 900, top: 0, width: 360, height: 2400 }
    const clamped = { top: 10, left: 940 }
    const moved = keepCardOffHeading(clamped, card, tall, viewport)
    expect(moved.top).toBeGreaterThan(clamped.top)
    expect(moved.top + card.height).toBeLessThanOrEqual(viewport.height)
    // …and a card that already clears the heading is returned untouched.
    const clear = { top: 600, left: 940 }
    expect(keepCardOffHeading(clear, card, tall, viewport)).toEqual(clear)
  })
})
