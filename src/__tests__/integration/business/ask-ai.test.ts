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
 * Third job: ASKING IS A CALL AND THIS ROOM MAKES NONE. 送信 refuses in PLAIN
 * WORDS, nothing here fetches anything, nothing renders the phone's
 * 「確認しています…」, and 却下 is honest about being demo-local.
 */

// ⚖ L2-2 — THE DENIED READER'S PROOF IS EXECUTED, NOT INFERRED. A scan of the
// output shape alone would pass a refactor that READ the whole store and then
// discarded it, which is the same payload and a completely different program.
// The four data doors are wrapped so the pin can assert the assembly never
// opened one — and assert, differentially, that an ADMITTED reader does, so the
// green is a gate rather than a mock nobody wired. `jest.spyOn` cannot redefine
// an ES-module namespace property (the シフト room's own note), so the module is
// re-exported with exactly those four wrapped and everything else passed
// through untouched.
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return {
    ...actual,
    listCustomers: jest.fn(actual.listCustomers),
    listAppointments: jest.fn(actual.listAppointments),
    listMenus: jest.fn(actual.listMenus),
    listStaff: jest.fn(actual.listStaff),
  }
})

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jstDayKey } from '@/business/lib/clock'
import { listAppointments, listCustomers, listMenus, listStaff, renderNow } from '@/business/lib/data'
import { appointments, customers, menus, staff, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { threads as threadPlane } from '@/business/lib/fixtures-inbox'
import { records as recordPlane } from '@/business/lib/fixtures-karute'
import {
  conversation as conversationPlane,
  genericTemplates as genericTemplatePlane,
  signals as signalPlane,
  suggestions as suggestionPlane,
  templates as templatePlane,
  type FixtureSuggestion,
} from '@/business/lib/fixtures-ask-ai'
import {
  accessFor,
  askAiIndex,
  namePrompt,
  personForRef,
  precedingQuestion,
  splitAtName,
  splitEvidence,
  splitLead,
  subjectOf,
  buildConversation,
  buildFeed,
  buildSignals,
  CATEGORY_LABEL,
  DISMISS_TOAST,
  evidenceLineOf,
  feedOrder,
  FEED_WINDOW,
  keepCardOffHeading,
  LIVE_SEGMENTS,
  permissionNotice,
  REFUSAL,
  scopeCounts,
  todayRosterSize,
  urgencyOf,
  windowFeed,
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
  it('the plane imports NOTHING, in any spelling, so it cannot restate the world', () => {
    // The machine-readable half of this lives in foundation.test.ts's INVENTORY
    // (an empty list for this file). Here it is read directly, because a plane
    // that grew one import is the whole breach class in one line.
    //
    // ⚠ AND THE PIN IS SPELLED AS WIDE AS THE NAME IT CLAIMS (L3-5). A bare
    // `^import` sees the static form only; `export … from` re-exports a module's
    // rows just as effectively, and `import(` reaches one at runtime. All four
    // doors, one regex, so the pin and its title say the same thing.
    expect(PLANE_CODE).not.toMatch(/(^\s*import\s)|(\bimport\s*\()|(^\s*export\b[^\n]*\bfrom\s)|(\brequire\s*\()/m)
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
    // ⚠ RE-DERIVED, AND ITS REASON CORRECTED (R4-9, blind lens L2-F6). This loop
    // used to say 「the 準備中 rooms are NOT on that list」 and name 録音 / コーチング /
    // 設定 — and #823 and #812 shipped two of those three while this branch was
    // out, so the pin's stated REASON went stale in the very round that
    // re-derived the fold, even though the assertion still held (it held because
    // `LIVE_SEGMENTS` was never extended, which is a second reason — the disease
    // this programme hunts). The narrower thing that is still true: this room
    // offers a card into EIGHT rooms and into no others, and the rooms it does
    // not offer are absent for reasons that have nothing to do with each other.
    // So the list is READ FROM THE RAIL rather than typed here, and each absence
    // carries the rail's own current flag beside it.
    const navRows = [...read('src/app/[locale]/(business)/BusinessSidebar.tsx').matchAll(
      /\{ key: '([^']+)', segment: (null|'[^']+'), label: '[^']*', mini: '[^']*', live: (true|false) \}/g,
    )].map((m) => ({ key: m[1], live: m[3] === 'true' }))
    expect(navRows).toHaveLength(12)
    const notOffered = navRows
      .filter((n) => !Object.hasOwn(LIVE_SEGMENTS, n.key))
      .map((n) => `${n.key}:${n.live ? 'live' : '準備中'}`)
    // 録音, 設定 and — since the 2026-09-05 fold of コーチング (⑥) — コーチング
    // are LIVE rooms this room simply has no suggestion shaped for; AI相談 is
    // this room itself. RE-DERIVED AGAIN at that fold: the flag beside コーチング
    // moved because the rail moved, which is this pin reading the rail rather
    // than remembering it.
    expect(notOffered.sort()).toEqual(['askAi:live', 'coaching:live', 'recording:live', 'settings:live'])
  })

  it('⚖ S15 — every suggestion carries a TO-DO and a REASON, and neither states a world fact', () => {
    // The accepted mock's card leads with what to do. The two new fields are
    // ADD-only on the plane and they obey the same law as `text`: they say what
    // to DO and WHY, and they restate nothing the world already answers — which
    // is why the person is a SLOT rather than a name.
    for (const s of suggestionPlane) {
      expect({ id: s.id, slot: s.headline.includes('{name}') }).toEqual({ id: s.id, slot: true })
      expect({ id: s.id, reason: s.reason.trim().length > 6 }).toEqual({ id: s.id, reason: true })
      // a reason is ONE line — the paragraph is `text`, behind the press
      expect({ id: s.id, oneLine: !s.reason.includes('。') }).toEqual({ id: s.id, oneLine: true })
    }
    // …and the plane-law scan above (no person, no staff, no menu, no date)
    // covers these two strings too, because it reads the whole FILE.
  })

  it('⚖ S15 — the {name} slot is filled by the SAME resolver the 根拠 line uses', () => {
    // THE MUTANT THIS EXISTS FOR: substituting from the plane literal, or from
    // any second lookup. A headline can then name somebody the lens cannot see,
    // which is the isolation law failing at the copy rather than at the read.
    for (const [lens, world] of [['銀座', WORLD_A], ['代官山', WORLD_B]] as const) {
      const ix = askAiIndex(world)
      for (const c of buildFeed(suggestionPlane, world)) {
        const plane = suggestionPlane.find((s) => s.id === c.id)!
        const person = personForRef(plane.sourceRef, ix)
        expect({ lens, id: c.id, person: person !== null }).toEqual({ lens, id: c.id, person: true })
        // ⚠ THE EXPECTATION IS SPELLED THE WAY PRODUCTION IS (R4-14, lens L2-F11).
        // `String.replace` with a STRING replacement is exactly the form R2-4
        // removed — an expectation written in it cannot tell the two replacers
        // apart, so it was quietly re-implementing the bug it sits beside.
        expect({ lens, id: c.id, headline: c.headline })
          .toEqual({ lens, id: c.id, headline: plane.headline.split('{name}').join(person!) })
        // the slot never reaches a reader, and the name really is in the line
        expect({ lens, id: c.id, raw: c.headline.includes('{name}') }).toEqual({ lens, id: c.id, raw: false })
        expect({ lens, id: c.id, named: c.headline.includes(person!) }).toEqual({ lens, id: c.id, named: true })
        // …and the 根拠 line's own name is the SAME string, which is what lets
        // the screen cut the line at it instead of guessing where a name is.
        expect({ lens, id: c.id, evName: c.evidenceName }).toEqual({ lens, id: c.id, evName: person })
        expect({ lens, id: c.id, inLine: c.evidence.includes(person!) }).toEqual({ lens, id: c.id, inLine: true })
        expect({ lens, id: c.id, reason: c.reason }).toEqual({ lens, id: c.id, reason: plane.reason })
      }
    }
  })

  it('⚖ R2-4 — a customer whose NAME contains a replacement pattern is printed literally', () => {
    // `String.replace` reads `$&`, `$\'`, `$\`` and `$1` inside its REPLACEMENT,
    // so a string replacer rewrites the very name it was asked to print. A
    // FUNCTION replacer is exempt by specification — one character of diff, and
    // the only fix that does not need a sanitiser nobody would maintain.
    const world = { ...WORLD_A, customers: WORLD_A.customers.map((c) => ({ ...c, name: "$& 様$'" })) }
    const card = buildFeed(suggestionPlane, world)[0]
    expect(card.headline).toContain("$& 様$'")
    expect(card.headline).not.toContain('{name}')
    // …and the name really is the literal one rather than the pattern's meaning:
    // `$&` would have expanded to `{name}` and `$\'` to the rest of the headline.
    expect(card.headline.startsWith("$& 様$'")).toBe(true)
  })

  it('⚖ R2-6 · R2-7 — ONE resolver, and it answers with the PERSON rather than the name', () => {
    // This world holds cus-01 and cus-09, two DIFFERENT customers sharing one
    // name, on purpose. Anything that identifies a person by their name folds
    // them together — which is a chip that fills the composer with a question
    // about somebody else.
    const ix = askAiIndex(WORLD_A)
    const one = subjectOf({ collection: 'customers', id: 'cus-01' }, ix)!
    const two = subjectOf({ collection: 'customers', id: 'cus-09' }, ix)!
    expect(one.name).toBe(two.name)
    expect(one.id).not.toBe(two.id)
    expect(one.memberNumber).not.toBe(two.memberNumber)
    // R2-7: `evidenceLineOf` reads THIS resolver rather than re-deriving beside
    // it — proven by the lines it produces being the resolver's own strings.
    for (const ref of [
      { collection: 'karuteRecords' as const, id: 'K-0001' },
      { collection: 'bookings' as const, id: 'apt-26' },
      { collection: 'inbox' as const, id: 'inb-change' },
      { collection: 'customers' as const, id: 'cus-08' },
    ]) {
      const line = evidenceLineOf(ref, ix)!
      const who = subjectOf(ref, ix)!
      expect({ ref: ref.id, named: line.includes(`${who.name}様`) }).toEqual({ ref: ref.id, named: true })
    }
    expect(subjectOf({ collection: 'customers', id: 'cus-9999' }, ix)).toBeNull()
    // ⚠ AND THE STRUCTURAL HALF (R4-11, blind lens L2-F8). Everything above
    // measures AGREEMENT — and two independent derivations that happen to agree
    // satisfy it, which is the whole failure mode R2-7 closed. So the claim is
    // also read off the function itself: `evidenceLineOf` reaches the person
    // through THE resolver in every one of its collection arms, and reaches them
    // through the module's private name lookup in none of them.
    const evBody = LIB_CODE.slice(
      LIB_CODE.indexOf('export function evidenceLineOf'),
      LIB_CODE.indexOf('export function urgencyOf'),
    )
    expect(evBody.length).toBeGreaterThan(600)
    expect(evBody).not.toMatch(/personOf\(/)
    const arms = evBody.split("case '").slice(1).map((a) => a.slice(0, a.indexOf("'")))
    expect(arms.sort()).toEqual(['bookings', 'customers', 'inbox', 'karuteRecords'])
    for (const arm of evBody.split("case '").slice(1)) {
      expect({ arm: arm.slice(0, arm.indexOf("'")), resolves: arm.includes('subjectOf(') })
        .toEqual({ arm: arm.slice(0, arm.indexOf("'")), resolves: true })
    }
  })

  it('⚖ R2-6 — an answer citing BOTH 見本 あかり’s renders TWO chips, told apart by 会員番号', () => {
    // The demo answer cites one person per row, so the same-name pair never
    // meets on screen today — and a dedupe on the NAME is a bug that waits for
    // the day it does. Both halves are pinned: two chips, and labels a reader
    // can tell apart.
    const both = buildConversation([{
      id: 'x', role: 'assistant', text: 'テストです。',
      sources: [
        { collection: 'karuteRecords', id: 'K-0006' },  // cus-01 見本 あかり
        { collection: 'karuteRecords', id: 'K-0009' },  // cus-09 見本 あかり
      ],
      contextRef: null,
    }], WORLD_A)[0]
    expect(both.sources).toHaveLength(2)
    expect(both.people.map((p) => p.id)).toEqual(['cus-01', 'cus-09'])
    expect(both.people.map((p) => p.name)).toEqual(['見本 あかり', '見本 あかり'])
    expect(new Set(both.people.map((p) => p.label)).size).toBe(2)
    for (const p of both.people) {
      const number = customers.find((c) => c.id === p.id)!.member_number
      expect({ id: p.id, label: p.label }).toEqual({ id: p.id, label: `${p.name}様（${number}）` })
    }
    // …and an answer whose people are all distinct carries NO member numbers —
    // the suffix is for the collision, not a permanent tax on every chip.
    const plain = buildConversation(conversationPlane, WORLD_A).find((t) => t.role === 'assistant')!
    expect(plain.people.map((p) => p.label)).toEqual(plain.people.map((p) => `${p.name}様`))
    for (const p of plain.people) expect(p.label).not.toMatch(/（[A-Z]-\d+）/)
  })

  it('⚖ R2-5 — the 回数券 card names the LOWEST-balance ticket holder its own lens can see', () => {
    // ⚖ the demo-data law (8/9): a card claiming 「残りが少なくなっています」 about
    // the customer holding the MOST tickets is fixed at the DATA, not at the
    // copy. The subject is compared against every OTHER ticket-holding customer
    // the same lens can read.
    // ⚠ THE RIVALS COME OUT OF THE ROOM'S OWN LENS DOOR (R4-10, blind lens
    // L2-F7). They used to be re-derived here — `new Set(appointments.map(…))`,
    // the room's own rule for 「who can this store see」 written a second time
    // beside it, which is the ⚖ A8 disease this suite hunts everywhere else. It
    // reads `askAiIndex().lensCustomers` now: the very set `refInLens` gates
    // every card, every 根拠 line and every 出典 row on. (⚠ AND THAT SET IS
    // BOOKING-DERIVED BY LAW, not by accident — a customer row carries no
    // `store_id` at all (CM-9), so a person is 「in this store」 exactly when a
    // clamped booking names them. A customer with no booking here is not a
    // rival this card could ever have been about, because this room cannot see
    // them.)
    const ixB = askAiIndex(WORLD_B)
    const ticketsOf = (id: string) =>
      (ixB.customer.get(id) as unknown as { ticket_balance?: number } | undefined)?.ticket_balance
    const card = buildFeed(suggestionPlane, WORLD_B).find((c) => c.id === 'sug-ticket')!
    const subject = subjectOf(suggestionPlane.find((s) => s.id === 'sug-ticket')!.sourceRef, ixB)!
    const mine = ticketsOf(subject.id)
    expect(mine).toBeGreaterThan(0)
    const holders = [...ixB.lensCustomers]
      .map((id) => ({ id, tickets: ticketsOf(id) }))
      .filter((r): r is { id: string; tickets: number } => typeof r.tickets === 'number')
    // …and the comparison can never go quiet (L2-F7): `ticketsOf` casts through
    // `as unknown`, so a renamed field would empty this list and leave a loop
    // asserting nothing under a comment claiming a comparison. TWO ticket-bearing
    // customers is what 代官山 actually holds — cus-04 and the subject — so this
    // is the world's own floor, not a number picked to be safe.
    expect(holders.length).toBeGreaterThanOrEqual(2)
    const rivals = holders.filter((r) => r.id !== subject.id)
    expect(rivals.length).toBeGreaterThanOrEqual(1)
    for (const r of rivals) {
      expect({ id: r.id, lower: r.tickets >= (mine as number) }).toEqual({ id: r.id, lower: true })
    }
    // …stated once more as the thing the card's sentence actually claims.
    expect(Math.min(...holders.map((h) => h.tickets))).toBe(mine)
    expect(card.evidenceName).toBe(subject.name)
  })

  it('⚖ S15 · R2-1 — splitAtName cuts on the RESOLVER’s string, AFTER the line’s own separator', () => {
    const parts = splitAtName('カルテ K-0001・見本 いつき様（担当 見本 しろう）', '見本 いつき')
    expect(parts).toEqual({ before: 'カルテ K-0001・', name: '見本 いつき様', after: '（担当 見本 しろう）' })
    // ⚠ THE TAG IS NOT SEARCHABLE (R2-1, blind lens L1-1). A bare `indexOf`
    // finds the needle wherever it first appears — including inside 「予約 R-4826」
    // — so a customer named 「予約」, 「カルテ」 or with a latin initial had their
    // chip painted over the reference number. The human half of a resolved line
    // starts after its first 「・」, and that is where the search starts.
    expect(splitAtName('予約 R-4826・予約様（担当 見本 しろう）', '予約'))
      .toEqual({ before: '予約 R-4826・', name: '予約様', after: '（担当 見本 しろう）' })
    expect(splitAtName('カルテ K-0001・カルテ様（担当 見本 しろう）', 'カルテ'))
      .toEqual({ before: 'カルテ K-0001・', name: 'カルテ様', after: '（担当 見本 しろう）' })
    expect(splitAtName('予約 R-4826・R様（担当 見本 しろう）', 'R'))
      .toEqual({ before: '予約 R-4826・', name: 'R様', after: '（担当 見本 しろう）' })
    // …and a HEADLINE has no separator at all, so the search is unchanged there
    // (`indexOf` −1, +1 = 0) — which is what keeps the rail card's own chip right.
    expect(splitAtName('見本 いつき様に再来のご案内', '見本 いつき'))
      .toEqual({ before: '', name: '見本 いつき様', after: 'に再来のご案内' })
    // a line with no name to find keeps all of itself, rather than being cut in
    // a place a regex guessed at
    expect(splitAtName('受信トレイ・空き待ち', null)).toEqual({ before: '受信トレイ・空き待ち', name: '', after: '' })
    expect(splitAtName('受信トレイ・空き待ち', '誰か')).toEqual({ before: '受信トレイ・空き待ち', name: '', after: '' })
  })

  it('⚖ R4-1 — 「様」 travels INSIDE the name, because that is the thing a reader sees', () => {
    // Blind lens L3-1: the world stores 「見本 さくら」 and the page shows
    // 「見本 さくら様」 — one thing, and the accepted mock wraps it whole
    // (`ASK-AI-MOCK-v1.html:801`, `:808`). Cutting on the bare name stranded the
    // honorific in plain text one pixel outside the blue chip, on EVERY rail
    // headline and EVERY 根拠 line in the room, at every width, in every world.
    expect(splitAtName('予約 R-4826・見本 さくら様（担当 見本 しろう / テスト整体 60分）', '見本 さくら').name)
      .toBe('見本 さくら様')
    expect(splitAtName('見本 さくら様に返事をもらう', '見本 さくら').name).toBe('見本 さくら様')
    // …and a name the line does NOT follow with 様 cuts exactly where it did
    // before: this extends the cut, it does not invent an honorific.
    expect(splitAtName('予約 R-4826・見本 さくら（担当 見本 しろう）', '見本 さくら'))
      .toEqual({ before: '予約 R-4826・', name: '見本 さくら', after: '（担当 見本 しろう）' })
    // …and the room's own resolved lines really are the 様-carrying shape, so
    // the rule above is about the strings this room actually renders rather than
    // a hand-typed sample of them.
    const ix = askAiIndex(WORLD_A)
    for (const card of buildFeed(suggestionPlane, WORLD_A)) {
      for (const [what, line] of [['headline', card.headline], ['evidence', card.evidence]] as const) {
        const cut = splitAtName(line, card.evidenceName)
        expect({ id: card.id, what, ends: cut.name.endsWith('様') }).toEqual({ id: card.id, what, ends: true })
        expect({ id: card.id, what, whole: cut.before + cut.name + cut.after }).toEqual({ id: card.id, what, whole: line })
        // …and the honorific is not left behind to be painted twice
        expect({ id: card.id, what, stranded: cut.after.startsWith('様') }).toEqual({ id: card.id, what, stranded: false })
      }
    }
    // the 出典 pill reads the same way, from the same resolver (R4-2)
    const answer = buildConversation(conversationPlane, WORLD_A).find((t) => t.role === 'assistant')!
    const plane = conversationPlane.find((t) => t.id === answer.id)!
    for (const s of answer.sources) {
      const ref = plane.sources.find((r) => `${r.collection}:${r.id}` === s.ref)!
      const cut = splitAtName(splitEvidence(s.line).rest, s.name)
      expect({ ref: s.ref, name: cut.name }).toEqual({ ref: s.ref, name: `${subjectOf(ref, ix)!.name}様` })
    }
  })

  it('⚖ R4-2 — an 出典 row carries the PERSON it is about, from the ONE resolver', () => {
    // The accepted mock bolds the customer's name inside a cite pill
    // (`ASK-AI-MOCK-v1.html:706`), and the only honest way to know where that
    // name ends is to be told by the derivation that put it there — the same
    // string the rail card's 根拠 line is cut on. A screen pattern-matching a
    // person back out of the rendered prose is the regex ⚖-ADJ D forbids.
    const answer = buildConversation(conversationPlane, WORLD_A).find((t) => t.role === 'assistant')!
    expect(answer.sources.length).toBeGreaterThan(0)
    expect(answer.sources[0].name).toBe('見本 いつき')
    const ix = askAiIndex(WORLD_A)
    const plane = conversationPlane.find((t) => t.id === answer.id)!
    for (const s of answer.sources) {
      // …every row, and always the resolver's own answer rather than a second
      // derivation that happens to agree (⚖ A8).
      const ref = plane.sources.find((r) => `${r.collection}:${r.id}` === s.ref)!
      expect({ ref: s.ref, name: s.name }).toEqual({ ref: s.ref, name: subjectOf(ref, ix)!.name })
      expect({ ref: s.ref, inLine: s.line.includes(`${s.name}様`) }).toEqual({ ref: s.ref, inLine: true })
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
      ['sug-absence', 'sug-change', 'sug-draft', 'sug-hold', 'sug-noshow', 'sug-revisit', 'sug-vip-settle'],
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
    // ⚠ THE 顧客 BRANCH IS PINNED DIRECTLY, and it is pinned here because F2-6
    // took the last plane row that used it (turn-2's sources are three karute
    // records now). A resolver arm nothing exercises is one a later edit can
    // break silently — the collection is still part of the room's contract
    // (`contextRef` reaches the lens through it), so its LINE is held too.
    expect(evidenceLineOf({ collection: 'customers', id: 'cus-08' }, ixA))
      .toBe('顧客 C-3008・テスト くらら様')
    expect(evidenceLineOf({ collection: 'customers', id: 'cus-08' }, askAiIndex(WORLD_B)))
      .toBe('顧客 C-3008・テスト くらら様')
    // …and an unresolvable customer is DROPPED rather than printed as an id.
    // (Which customers a LENS may cite is `refInLens`'s job, not this one's —
    // the two are separate on purpose, and the lens half is proven by the
    // both-directions conversation pins below.)
    expect(evidenceLineOf({ collection: 'customers', id: 'cus-9999' }, ixA)).toBeNull()
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

  it('⚖ the door’s WORDS come from LIVE_SEGMENTS and nowhere else — one label per room, uniform on every card', () => {
    // The allowlist is not only WHICH rooms a card may point at; it is what the
    // button SAYS. A label composed anywhere else would let two cards pointing
    // at one room offer two different doors — and would let a segment with no
    // entry render a button reading its own machine name.
    for (const c of [...buildFeed(suggestionPlane, WORLD_A), ...buildFeed(suggestionPlane, WORLD_B)]) {
      expect({ id: c.id, label: c.linkLabel }).toEqual({ id: c.id, label: LIVE_SEGMENTS[c.segment] })
      expect({ id: c.id, machine: c.linkLabel === c.segment }).toEqual({ id: c.id, machine: false })
      expect({ id: c.id, opens: c.linkLabel.endsWith('を開く') }).toEqual({ id: c.id, opens: true })
    }
  })

  it('a suggestion pointed at a room that is not live never becomes a card', () => {
    const bad: FixtureSuggestion[] = [
      { ...suggestionPlane[0], id: 'sug-dead', deepLink: 'coaching' },
    ]
    expect(buildFeed(bad, WORLD_A)).toEqual([])
  })

  it('⚖ ANY-ROSTER-SIZE on the feed dimension — 25+ suggestions, arithmetic exact', () => {
    const feed = buildFeed(bulk(30), WORLD_A)
    expect(feed).toHaveLength(30)
    // none of them badged (a karute record carries no hard fact), so the order
    // is the plane's own — a 30-row feed must not reshuffle itself.
    expect(feed.map((c) => c.id)).toEqual(bulk(30).map((s) => s.id))
    // …and the sheet gives the RAIL no vertical axis of its own to hide them in.
    // The WINDOW below is what shortens the page; a height cap on the rail would
    // be the ⚖ page-scroll ruling broken, not the fix for it.
    // ⚠ AND NOWHERE IN THE ROOM, IN ANY BAND (⚖-ADJ A's other half): the ONE
    // bounded box is the transcript reading panel, and `overscroll-behavior` is
    // deliberately absent from it so the page keeps the document's axis. The
    // exhaustive equality — which selectors own which axis — is the ⚖ PAGE-SCROLL
    // pin below; here the RAIL's own half is what matters.
    expect(CSS_CODE).not.toMatch(/overscroll-behavior/)
    for (const sel of ['.ak-rail {', '.ak-rail-body {', '.ak-rail-list {']) {
      const at = CSS_CODE.indexOf(sel)
      expect({ sel, found: at > 0 }).toEqual({ sel, found: true })
      const body = CSS_CODE.slice(at, CSS_CODE.indexOf('}', at))
      expect({ sel, cappedOrScrolling: /max-height|overflow-y:\s*(auto|scroll)/.test(body) })
        .toEqual({ sel, cappedOrScrolling: false })
    }
  })

  /** The 25+ world, built once per call so a test that mutates its own copy
   *  cannot reach the next one. */
  const bulk = (n: number): FixtureSuggestion[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `bulk-${i}`,
      category: 'customer_follow' as const,
      headline: '{name}様に見本の確認をする',
      reason: '見本のため、理由の行もここに入ります',
      text: `見本の提案 ${i}`,
      sourceRef: { collection: 'karuteRecords' as const, id: 'K-0001' },
      deepLink: 'karute',
    }))

  it('⚖ THE WINDOW WALKS EVERY STEP, and the remainder label is exact at each one', () => {
    const feed = buildFeed(bulk(30), WORLD_A)
    expect(FEED_WINDOW).toBe(6)
    const walked: Array<{ shown: number; remaining: number; label: string | null }> = []
    for (let steps = 1; steps <= 12; steps += 1) {
      const w = windowFeed(feed, steps)
      // The window is a PREFIX: it never reorders the feed the sort decided and
      // never shows a row twice.
      expect(w.shown.map((c) => c.id)).toEqual(feed.slice(0, w.shown.length).map((c) => c.id))
      // ⚠ THE LABEL AND THE ARITHMETIC ARE ONE CALL. A remainder that disagreed
      // with total − shown is the mutation this pin exists to redden.
      expect({ steps, remaining: w.remaining }).toEqual({ steps, remaining: feed.length - w.shown.length })
      expect(w.moreLabel).toBe(w.remaining > 0 ? `さらに表示（あと${w.remaining}件）` : null)
      walked.push({ shown: w.shown.length, remaining: w.remaining, label: w.moreLabel })
      if (w.remaining === 0) break
    }
    expect(walked.map((s) => s.shown)).toEqual([6, 12, 18, 24, 30])
    expect(walked.map((s) => s.remaining)).toEqual([24, 18, 12, 6, 0])
    expect(walked[0].label).toBe('さらに表示（あと24件）')
    expect(walked[4].label).toBeNull()
    // A step count below one is still one window — a control cannot walk the
    // reader backwards past the page they opened on.
    expect(windowFeed(feed, 0).shown).toHaveLength(6)
    expect(windowFeed(feed, -3).shown).toHaveLength(6)
  })

  it('a DISMISSED card leaves the total AND the window arithmetic together', () => {
    const feed = buildFeed(bulk(30), WORLD_A)
    // Dismissal is browsing state on the screen, so what the window is handed is
    // the list the reader can still SEE. Take one out of the first window and one
    // out of the last: the head's total and the footer's remainder both move, and
    // they still add up.
    const visible = feed.filter((c) => c.id !== 'bulk-2' && c.id !== 'bulk-29')
    const w = windowFeed(visible, 1)
    expect(visible).toHaveLength(28)
    expect(w.shown).toHaveLength(6)
    expect(w.moreLabel).toBe('さらに表示（あと22件）')
    expect(w.remaining).toBe(visible.length - w.shown.length)
    // …and the row the first window pulled up to replace the dismissed one is
    // the next one in the feed's own order, never a reshuffle.
    expect(w.shown.map((c) => c.id)).toEqual(['bulk-0', 'bulk-1', 'bulk-3', 'bulk-4', 'bulk-5', 'bulk-6'])
  })

  it('⚖ F2-8 — the window control is REACHABLE in the shipped demo, and absent where the feed fits', () => {
    // S7-9, the family's own 「the demo was hiding a feature」 precedent (the
    // board's 詰め込み layer before apt-29 moved to 14:05): the demo world's
    // 銀座 feed was EXACTLY the window, so さらに表示 — and the tour step that
    // explains it — could not be reached by anyone opening this room. A seventh
    // 銀座 row, sourced at a real world record, puts both on screen.
    expect(feedA).toHaveLength(7)
    expect(windowFeed(feedA, 1).shown).toHaveLength(FEED_WINDOW)
    expect(windowFeed(feedA, 1).remaining).toBe(1)
    expect(windowFeed(feedA, 1).moreLabel).toBe('さらに表示（あと1件）')
    // …and one press opens the rest and takes the control away with it.
    expect(windowFeed(feedA, 2).shown).toHaveLength(7)
    expect(windowFeed(feedA, 2).moreLabel).toBeNull()
    // 代官山's three still fit, so it shows no control at all: the walk shrinks
    // and grows by itself, which is what keeps the step meaningful.
    expect(feedB.length).toBeLessThanOrEqual(FEED_WINDOW)
    expect(windowFeed(feedB, 1).remaining).toBe(0)
    expect(windowFeed(feedB, 1).moreLabel).toBeNull()
    // The new row is a STAFFING one and carries no badge — apt-23's own hard
    // fact is 来店なし, which is not a deadline and not an unaccepted slot.
    const added = feedA.find((c) => c.id === 'sug-noshow')!
    expect(added.category).toBe('staffing')
    expect(added.badge).toBeNull()
    expect(added.segment).toBe('shifts')
  })

  it('⚖ F2-7 — a deadline prints ONCE: the badge owns it, the 根拠 line drops it', () => {
    // S7-7. `urgencyOf` puts an 受信トレイ 回答期限 in the badge, and the same
    // clause rode the 根拠 line a few pixels below — one card saying one time
    // twice. ONE derivation now knows both: `buildFeed` asks for the badge, then
    // builds the line knowing the answer.
    const ixA = askAiIndex(WORLD_A)
    const ixB = askAiIndex(WORLD_B)
    const due = threadPlane.find((t) => t.id === 'inb-wait')!.due!
    const hh = `${String(Math.floor(due / 60)).padStart(2, '0')}:${String(due % 60).padStart(2, '0')}`
    const card = feedB.find((c) => c.id === 'sug-waitlist')!
    expect(card.badge).toBe(`回答期限 ${hh}`)
    expect(card.evidence).toContain('空き待ちのお申し込み')
    expect(card.evidence).not.toContain('回答期限')
    // …and the UN-BADGED spelling KEEPS the clause — that is the shape an
    // answer's 出典 row renders, where no badge exists above it and the deadline
    // is the only place a reader can learn it.
    expect(evidenceLineOf({ collection: 'inbox', id: 'inb-wait' }, ixB)).toContain(`回答期限 ${hh}`)
    expect(evidenceLineOf({ collection: 'inbox', id: 'inb-wait' }, ixB, true)).not.toContain('回答期限')
    // A thread with no deadline reads the same either way, so the flag only ever
    // removes something that was genuinely printed twice.
    expect(evidenceLineOf({ collection: 'inbox', id: 'inb-change' }, ixA))
      .toBe(evidenceLineOf({ collection: 'inbox', id: 'inb-change' }, ixA, true))
    // …swept across BOTH lenses' whole feeds: no card says its 期限 twice.
    for (const c of [...feedA, ...feedB]) {
      expect({ id: c.id, twice: Boolean(c.badge) && c.evidence.includes('回答期限') })
        .toEqual({ id: c.id, twice: false })
    }
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
      'カルテ K-0001・見本 いつき様（担当 見本 しろう / テスト整体 60分）',
      'カルテ K-0014・テスト なぎ様（担当 見本 あずさ / テスト整体 60分）',
    ])
    // ⚖ 8/25 — the label says what it counts, and it counts what is printed.
    expect(answer.sourceCountLabel).toBe(`出典 ${answer.sources.length}件`)
    // …and a question carries none, never 「出典 0件」.
    expect(turns[0].sources).toEqual([])
    expect(turns[0].sourceCountLabel).toBeNull()
    // ⚖ AND NO SENTENCE COUNTS ITS OWN SOURCES. Under 代官山 two of the three
    // rows are out of lens; a text that said 「2件」 would then be false.
    const turnsB = buildConversation(conversationPlane, WORLD_B)
    const answerB = turnsB.find((t) => t.role === 'assistant')!
    expect(answerB.sources.map((s) => s.line)).toEqual([
      'カルテ K-0013・見本 きり様（担当 見本 たろう / テスト深層ケア 120分）',
    ])
    expect(answerB.text).toBe(answer.text)
    expect(answerB.text).not.toMatch(/[0-9０-９]+\s*[名件]/)
  })

  it('⚖ F2-6 — the answer’s CLAIM is true of EVERY 出典 row, under EITHER lens', () => {
    // S7-6, and this pin reads the WORLD row by row rather than matching a
    // string. The earlier cut promised its sources two things — that a 次回の
    // ご提案 was still in the karute AND that no later booking had been taken —
    // and the world does not hold rows that carry both under both lenses
    // (cus-08 has a 銀座 booking three days out; 代官山's one record with a 次回
    // entry belongs to a customer booked five days out). The DATA was re-picked
    // first, and the sentence kept only the half every row can carry.
    for (const [lens, world] of [['銀座', WORLD_A], ['代官山', WORLD_B]] as const) {
      const answer = buildConversation(conversationPlane, world).find((t) => t.role === 'assistant')!
      // A claim about rows nobody can see would be vacuously "true" — each lens
      // must genuinely render at least one.
      expect({ lens, hasRows: answer.sources.length > 0 }).toEqual({ lens, hasRows: true })
      for (const s of answer.sources) {
        const [collection, id] = s.ref.split(':')
        // The sentence says 出典のカルテ, so every row must BE a karute record —
        // a 顧客 or 予約 row under it would be the sentence pointing elsewhere.
        expect({ lens, ref: s.ref, collection }).toEqual({ lens, ref: s.ref, collection: 'karuteRecords' })
        const rec = recordPlane.find((r) => r.id === id)!
        // 「次回のご提案が残っています」 — the record's 転帰 is 再来のご提案 AND its
        // 次回 drawer still holds the proposal. Both read from the カルテ plane.
        expect({ lens, id, outcome: rec.outcome?.status }).toEqual({ lens, id, outcome: 'revisit' })
        const next = rec.entries.find((e) => e.category === 'next')
        expect({ lens, id, proposal: Boolean(next && next.text.trim()) })
          .toEqual({ lens, id, proposal: true })
        expect({ lens, id, discarded: rec.discarded !== null }).toEqual({ lens, id, discarded: false })
        // …and the record really is one THIS lens can read, so the claim is
        // being checked against the store the reader is standing in.
        expect({ lens, id, inLens: world.appointments.some((a) => a.id === rec.appointment_id) })
          .toEqual({ lens, id, inLens: true })
      }
    }
    // AND THE HALF THE WORLD CANNOT CARRY IS GONE (deviation R7-G1).
    const claim = buildConversation(conversationPlane, WORLD_A).find((t) => t.role === 'assistant')!.text
    expect(claim).toContain('次回のご提案が残っています')
    expect(claim).not.toContain('そのあとのご予約がまだ入っていない')
  })

  it('⚖ S15 · ⚖-ADJ D — the answer’s SHAPE is derived from the contract’s ONE string', () => {
    // The shipped contract returns a single `reply` paragraph
    // (`src/lib/ai/karute-chat.ts`), so the desk cannot be handed a lead and a
    // body: it CUTS at the first 「。」. Authoring the split in the plane would be
    // inventing a response shape the reconnect seam does not return.
    const answer = buildConversation(conversationPlane, WORLD_A).find((t) => t.role === 'assistant')!
    const { lead, advice } = splitLead(answer.text)
    expect(lead.endsWith('。')).toBe(true)
    expect(lead + advice).toBe(answer.text.replace(lead, lead))
    expect(answer.text.startsWith(lead)).toBe(true)
    expect(answer.text.endsWith(advice)).toBe(true)
    expect(advice.length).toBeGreaterThan(0)
    // a ONE-sentence reply has no advice, and the row simply does not render —
    // never an empty box under a heading
    expect(splitLead('わかりました。')).toEqual({ lead: 'わかりました。', advice: '' })
    // …and a reply with no full stop at all is ALL lead rather than all advice.
    expect(splitLead('確認中')).toEqual({ lead: '確認中', advice: '' })
  })

  it('⚖ S15 — an answer’s NAME CHIPS are the distinct people of its resolved 出典 rows', () => {
    const a = buildConversation(conversationPlane, WORLD_A).find((t) => t.role === 'assistant')!
    // Order of FIRST APPEARANCE, distinct, and derived from the rows that
    // actually rendered — so a lens that drops a row drops its chip with it.
    expect(a.people.map((p) => p.name)).toEqual(['見本 いつき', 'テスト なぎ'])
    expect(a.people.map((p) => p.prompt)).toEqual(a.people.map((p) => namePrompt(p.name)))
    expect(a.people[0].prompt).toBe('見本 いつき様の記録をもとに、ご案内の文面を作ってください。')
    const b = buildConversation(conversationPlane, WORLD_B).find((t) => t.role === 'assistant')!
    expect(b.people.map((p) => p.name)).toEqual(['見本 きり'])
    // a question and a failure carry no people at all
    for (const t of buildConversation(conversationPlane, WORLD_A)) {
      if (t.role !== 'assistant') expect({ id: t.id, people: t.people }).toEqual({ id: t.id, people: [] })
    }
    // …and DISTINCT really is distinct: three rows about one customer are ONE
    // chip, not three.
    // K-0002 and K-0004 are two records of ONE customer (テスト くらら) — the
    // pair the context label 「…のカルテ2件」 counts, so the fixture is the
    // world's own rather than a hand-built duplicate.
    const one = buildConversation([{
      id: 'x', role: 'assistant', text: 'テストです。',
      sources: [
        { collection: 'karuteRecords', id: 'K-0002' },
        { collection: 'karuteRecords', id: 'K-0004' },
      ],
      contextRef: null,
    }], WORLD_A)[0]
    expect(one.sources.length).toBeGreaterThan(1)
    expect(one.people).toHaveLength(1)
  })

  it('⚖ S15 — a cite pill is the SAME line, cut at its first 「・」', () => {
    const a = buildConversation(conversationPlane, WORLD_A).find((t) => t.role === 'assistant')!
    expect(splitEvidence(a.sources[0].line))
      .toEqual({ tag: 'カルテ K-0001', rest: '見本 いつき様（担当 見本 しろう / テスト整体 60分）' })
    expect(splitEvidence('受信トレイ・テスト えいた様（予約日時の変更希望）'))
      .toEqual({ tag: '受信トレイ', rest: 'テスト えいた様（予約日時の変更希望）' })
    // …and a line with no separator keeps all of itself, so the pill shows no tag
    expect(splitEvidence('出どころ不明')).toEqual({ tag: '', rest: '出どころ不明' })
    // ⚠ AND THE CUT IS THE **FIRST** SEPARATOR, PROVEN ON A LINE THAT HAS TWO.
    // The resolver's own lines carry exactly one 「・」 today, so a cut at the
    // LAST one is a no-op on every row this world holds — and would silently
    // swallow a customer's story the day a menu name or a subject line contains
    // the character. A pin that can only be true on today's data is not a pin.
    expect(splitEvidence('カルテ K-0001・見本 いつき様（担当 見本 しろう・テスト整体 60分）'))
      .toEqual({ tag: 'カルテ K-0001', rest: '見本 いつき様（担当 見本 しろう・テスト整体 60分）' })
    // ONE GRAMMAR, TWO RENDERINGS: whatever is cut here is the same string the
    // rail's 根拠 line prints whole.
    for (const s of a.sources) {
      const { tag, rest } = splitEvidence(s.line)
      expect({ ref: s.ref, whole: `${tag}・${rest}` }).toEqual({ ref: s.ref, whole: s.line })
    }
  })

  it('⚖ S15 · ⚖-ADJ F — 「もう一度送る」 re-sends the NEAREST PRECEDING question', () => {
    // This supersedes R7-10's waiver of the error-state retry law: the failed
    // turn now carries its own way out, and what it sends is the question it was
    // answering — the same text and the same context hint the reader can see
    // above it, so the refusal that follows names the right slice of data.
    const turns = buildConversation(conversationPlane, WORLD_A)
    const err = turns.find((t) => t.role === 'error')!
    const q = precedingQuestion(turns, err.id)!
    const asked = turns.filter((t) => t.role === 'user')
    expect(q.text).toBe(asked[asked.length - 1].text)
    expect(q.contextLabel).toBe(asked[asked.length - 1].contextLabel)
    expect(q.contextLabel).toBe('テスト くらら様のカルテ2件')
    // …and under 代官山 the SAME question carries no label, because the lens can
    // read none of that customer's records — so the refusal cannot promise one.
    const tB = buildConversation(conversationPlane, WORLD_B)
    expect(precedingQuestion(tB, 'turn-4')!.contextLabel).toBeNull()
    // A FAILURE WITH NOTHING BEFORE IT HAS NOTHING TO RE-SEND, and the screen
    // renders no button — a retry that asked an empty question would be a lever
    // with no effect (⚖ §A-2).
    const orphan = buildConversation([{ id: 'e', role: 'error', text: 'だめでした。', sources: [], contextRef: null }], WORLD_A)
    expect(precedingQuestion(orphan, 'e')).toBeNull()
    expect(precedingQuestion(turns, 'no-such-turn')).toBeNull()
    // ⚠ AND THE ROLE FILTER IS LOAD-BEARING, PROVEN WHERE IT ACTUALLY BITES.
    // In the demo thread the turn before the failure happens to BE the question,
    // so 「nearest preceding」 and 「nearest preceding USER turn」 agree and a
    // dropped filter changes nothing. Put an ANSWER between them — which is what
    // a second failed attempt looks like — and only the filtered walk returns
    // the reader's own words instead of the model's.
    const between = buildConversation([
      { id: 'q1', role: 'user', text: '本当に送りたかった質問です。', sources: [], contextRef: null },
      { id: 'a1', role: 'assistant', text: 'AIが返した文章です。', sources: [], contextRef: null },
      { id: 'e1', role: 'error', text: '受け取れませんでした。', sources: [], contextRef: null },
    ], WORLD_A)
    expect(precedingQuestion(between, 'e1')!.text).toBe('本当に送りたかった質問です。')
    expect(precedingQuestion(between, 'e1')!.text).not.toBe('AIが返した文章です。')
    // …and an answer between the failure and the question does not become the
    // question: only a `user` turn can.
    expect(precedingQuestion(turns, 'turn-2')!.text).toBe(turns[0].text)
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
  /** The four store-clamped doors, wrapped at the top of this file. The cast is
   *  the mock's shape asserted, not assumed — the differential test below fails
   *  loudly if the wrapping ever stops happening. */
  const DOORS = { listCustomers, listAppointments, listMenus, listStaff } as unknown as Record<string, jest.Mock>

  it('a denied reader’s payload contains NONE of this room’s data, and NO DOOR IS EVER OPENED', async () => {
    for (const fn of Object.values(DOORS)) fn.mockClear()
    const { props } = await askAiProps({ locale: 'ja', store: STORE_A, world: { role: '' } })

    // ⚖ L2-2 — THE EXECUTED HALF, and it is the one that outranks the shape. A
    // refactor that read the whole store and then threw it away would produce
    // this exact payload; it would also put every customer of this store through
    // a process that was told it may not see them.
    for (const [name, fn] of Object.entries(DOORS)) {
      expect({ name, calls: fn.mock.calls.length }).toEqual({ name, calls: 0 })
    }

    expect(props.noticeLines.length).toBeGreaterThan(0)
    expect(props.feed).toEqual([])
    expect(props.turns).toEqual([])
    expect(props.signals).toEqual([])
    expect(props.templates).toEqual([])
    expect(props.scope).toEqual([])
    // …and the payload itself carries no person, no record, no question — and
    // (L2-6) no suggestion's own words or the id it joins the world on, which is
    // the one shape the three scans above could not have caught.
    const json = JSON.stringify(props)
    for (const name of customers.map((c) => c.name)) expect(json).not.toContain(name)
    for (const r of recordPlane) expect(json).not.toContain(r.id)
    for (const t of conversationPlane) expect(json).not.toContain(t.text)
    for (const s of suggestionPlane) {
      expect({ id: s.id, leaked: json.includes(s.text) }).toEqual({ id: s.id, leaked: false })
      expect({ id: s.id, ref: json.includes(s.sourceRef.id) }).toEqual({ id: s.id, ref: false })
    }
  })

  it('…and the SAME doors really do open for an admitted reader (the pin is a gate, not a dead mock)', async () => {
    for (const fn of Object.values(DOORS)) fn.mockClear()
    await askAiProps({ locale: 'ja', store: STORE_A })
    for (const [name, fn] of Object.entries(DOORS)) {
      expect({ name, opened: fn.mock.calls.length > 0 }).toEqual({ name, opened: true })
    }
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

  it('⚖ F2-4 — 業種未設定 shows the GENERIC trio, never another type’s prompts', async () => {
    // S7-4: the unset desk printed 「業種が未設定です」 and 美容整体's bridal
    // prompts in one column — the page contradicting itself, and a reconnect
    // contract gap (the shipped mechanism HAS a generic fallback and the room
    // did not mirror it). The trio is now picked by the SAME one fact the tuned
    // label and the profileHint are.
    const unset = await askAiProps({ locale: 'ja', store: STORE_A, world: { businessType: null } })
    expect(genericTemplatePlane).toHaveLength(3)
    expect(unset.props.templates.map((t) => t.title)).toEqual(genericTemplatePlane.map((t) => t.title))
    // NOT ONE type-specific title survives into the unset state…
    const typed = new Set(templatePlane.map((t) => t.title))
    for (const t of unset.props.templates) {
      expect({ title: t.title, typeSpecific: typed.has(t.title) }).toEqual({ title: t.title, typeSpecific: false })
    }
    // …and the two lists genuinely differ, so the pin cannot pass by both being
    // the same three rows.
    expect(genericTemplatePlane.map((t) => t.title)).not.toEqual(templatePlane.map((t) => t.title))
    // A shop that HAS chosen a type still gets its own three — the fallback is a
    // fallback, not a replacement.
    const set = await askAiProps({ locale: 'ja', store: STORE_A })
    expect(set.props.templates.map((t) => t.title)).toEqual(templatePlane.map((t) => t.title))
    // ⚖ the recognition floor: the trio is the phone's own rows, at the cite the
    // plane carries beside them.
    expect(genericTemplatePlane.map((t) => t.id)).toEqual(['g-analysis', 'g-customer', 'g-strategy'])
    expect(PLANE_SRC).toContain('business-types.ts:100-137')
  })

  it('⚖ F2-1 — the feed carries TWO empty states, and the dismissed one tells the truth', async () => {
    // S7-1: dismissing every card left 「提案はまだありません」 on a feed that
    // ARRIVED full — the one sentence that is false about the state the reader
    // had just made, quietly contradicting the toast they had read four times.
    const { props } = await askAiProps({ locale: 'ja', store: STORE_A })
    expect(props.feedEmpty.title).toBe('提案はまだありません')
    expect(props.feedDismissedEmpty.title).toBe('この画面で提案をすべて却下しました')
    // …and its second line is the truth the toast already tells.
    expect(props.feedDismissedEmpty.body).toContain('保存されない')
    expect(props.feedDismissedEmpty.body).toContain('開き直すと元に戻ります')
    expect(DISMISS_TOAST).toContain('保存されません')
    // The zero-suggestions copy stays RESERVED for a store with genuinely
    // nothing to show — the two are never the same sentence.
    expect(props.feedDismissedEmpty.title).not.toBe(props.feedEmpty.title)
    expect(props.feedDismissedEmpty.body).not.toBe(props.feedEmpty.body)
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
    // …and its window is longer only when there is an undo to offer, which is
    // the ONE thing the timer's length is allowed to depend on.
    expect(SCREEN_CODE).toContain('toastTimer.current = setTimeout(() => setToast(null), undoId ? 5000 : 2800)')
    // ⚖ D-2's other half, made explicit by the accepted mock: the mock's own
    // typing indicator and entrance stagger are MOCK-ONLY theatre. Every turn is
    // present at first paint, so none of their machinery exists here.
    for (const ghost of ['typing', 'dots', 'playConversation', 'stagger']) {
      expect({ ghost, present: SCREEN_CODE.includes(ghost) }).toEqual({ ghost, present: false })
    }
    expect(CSS_CODE).not.toContain('@keyframes')
  })

  it('SEND refuses honestly, IN PLAIN WORDS, and changes NOTHING', () => {
    expect(REFUSAL.send).toContain('回答を生成できません')
    // ⚖ L4-1 — the missing thing is named in WORDS a shop reads, and the sentence
    // closes with the family's bare 未接続 honesty (the カルテ room's own
    // permissionNotice shape, `karute.ts:107`). What it must never carry is the
    // reconnect registry's internal numbering.
    expect(REFUSAL.send).toContain('実データとAIの接続後')
    expect(REFUSAL.send).toContain('（未接続）')
    expect(REFUSAL.settings).toContain('AI設定を開けません')
    // ⚠ RE-PINNED AT THE MAIN-MOVED FOLD (S15). The sentence used to say the
    // settings SCREEN was still to come, and #812 shipped it. What is missing is
    // narrower — the 設定 room holds 予約と確保, and the AI items are not in it —
    // so the copy says that instead. A refusal naming a thing that already
    // shipped is a surface lying about the family (⚖ A10).
    expect(REFUSAL.settings).toContain('設定画面にまだ用意されていない項目です')
    expect(REFUSAL.settings).not.toContain('設定画面の追加後')
    expect(REFUSAL.settings).toContain('（未接続）')
    // The composer's state is never touched on the refusal path: `refuseSend`
    // sets the refusal and nothing else, and no handler clears the draft.
    // ⚠ ALL THREE QUOTE SPELLINGS (L3-2). A pin that only saw `setDraft('')`
    // would go green on a refactor that typed the same statement with double
    // quotes or a backtick — the runtime half (probe D1) is load-bearing, and
    // this half must at least be spelled as wide as the claim it makes.
    expect(SCREEN_CODE).toContain('const refuseSend = (contextLabel: string | null = null, intended: string | null = null) => {')
    expect(SCREEN_CODE).not.toMatch(/setDraft\(\s*(''|""|``)\s*\)/)
    // …and the box stays usable — `disabled` is the EMPTY-input contract only.
    expect(SCREEN_CODE).toContain("disabled={draft.trim() === ''}")
  })

  it('⚖ NO REGISTRY NUMBERING REACHES THE READER — swept across every screen-reachable string', () => {
    // L4-1's root fix, made a rule rather than two corrected sentences: the
    // reconnect registry is an INTERNAL index, and 「登録①」 on a shop's screen is
    // jargon whatever string it rides in. The sweep reads CODE, so a comment may
    // still carry the mapping — which is the point of the second half.
    for (const [name, src] of [['lib', LIB_CODE], ['props', PROPS_CODE], ['plane', PLANE_CODE], ['screen', SCREEN_CODE], ['page', PAGE_CODE]] as const) {
      expect({ name, token: /登録/.test(src) }).toEqual({ name, token: false })
      expect({ name, circled: /[①-⑳]/.test(src) }).toEqual({ name, circled: false })
    }
    // …and the mapping stays GREP-ABLE for the reconnect spec, in the comments
    // beside the two strings it belongs to — the seam is still named, it is just
    // named where engineers read and shops do not.
    expect(LIB_SRC).toContain('登録① AI応答の生成')
    expect(LIB_SRC).toContain('登録⑦ AI設定ダイヤル接続')
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
    // ⚠ RE-PINNED FOR S15's TWO NAMED PATHS. There are now three controls that
    // carry a question — a 今日 chip, 「もう一度送る」 and a じっくり chip — and
    // exactly TWO behaviours between them, so each behaviour lives in ONE helper
    // and the pins read the helper rather than three copies of it (⚖ A8, and
    // ⚖-ADJ D's ceiling: the day the F2-3 guard is argued for the fill path it
    // moves in one place).
    const bodyBetween = (from: string, to: string) =>
      SCREEN_CODE.slice(SCREEN_CODE.indexOf(from), SCREEN_CODE.indexOf(to))
    const fillBody = bodyBetween('const fill = (text: string)', 'const walkSend')
    const sendBody = bodyBetween('const walkSend', 'const takeSignal')
    expect(fillBody.length).toBeGreaterThan(40)
    expect(sendBody.length).toBeGreaterThan(60)
    // THE SEND PATH: fills AND refuses, with the context label — and the fill is
    // GUARDED (⚖ F2-3: it may not type over a typed question).
    expect(sendBody).toContain("const typed = draft.trim() !== '' && draft !== text")
    expect(sendBody).toContain('if (!typed) setDraft(text)')
    expect(sendBody).toContain('refuseSend(contextLabel, typed ? text : null)')
    // …and there is exactly ONE write to the draft in it, the guarded one.
    expect([...sendBody.matchAll(/setDraft\(/g)]).toHaveLength(1)
    // THE FILL PATH: sets the draft and CLEARS the standing refusal — no send.
    expect(fillBody).toContain('setDraft(text)')
    expect(fillBody).toContain('setRefusal(null)')
    expect(fillBody).not.toContain('refuseSend')
    // …and the three controls each pick one of the two, visibly.
    expect(SCREEN_CODE).toContain('const takeSignal = (chip: SignalChip) => walkSend(chip.prompt, chip.contextLabel)')
    expect(SCREEN_CODE).toContain('const takeTemplate = (pill: TemplatePill) => fill(pill.example)')
    expect(SCREEN_CODE).toContain('const takeRetry = (q: { text: string; contextLabel: string | null }) => walkSend(q.text, q.contextLabel)')
    // …and an answer's name chip is the TEMPLATE semantics, not the send path.
    expect(SCREEN_CODE).toContain('onClick={() => fill(p.prompt)}')
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

  it('the breadcrumb names this room’s own GROUP and its own leaf', () => {
    expect(TOPBAR).toContain("'ask-ai': 'AI相談',")
    // ⚠ ADDED AT ROUND 5 (Greptile G-2). The leaf shipped without a group entry,
    // so the crumb fell through to the 店舗フロア default and told the reader a
    // different thing from the rail they had just used. The group is DERIVED from
    // the rail rather than typed twice: whichever NAV group holds `ask-ai` is the
    // word the crumb must print, so the two cannot drift apart.
    const railGroup = SIDEBAR.slice(0, SIDEBAR.indexOf("segment: 'ask-ai'"))
      .match(/group: '([^']+)'/g)!.pop()!.replace(/^group: '|'$/g, '')
    expect(railGroup).toBe('記録・AI')
    expect(TOPBAR).toContain(`'ask-ai': '${railGroup}',`)
    // …and the default is still the default: 録音 and カルテ sit in that same rail
    // group and keep falling through to 店舗フロア. That is another room's pin to
    // move, named in the report rather than fixed inside this room's diff.
    expect(TOPBAR).toContain("{GROUP[segment] ?? '店舗フロア'}")
    const groupBody = TOPBAR.slice(TOPBAR.indexOf('const GROUP: Record<string, string> = {'))
    const groupKeys = groupBody.slice(0, groupBody.indexOf('}')).match(/^\s*'?([\w-]+)'?:/gm)!
      .map((k) => k.trim().replace(/'|:/g, ''))
    // ⚠ RE-DERIVED AT S16: コーチング joined the map with its own room's diff
    // (the rail files it under 記録・AI too). 録音 and カルテ still fall through,
    // which is the half this census is really guarding.
    expect(groupKeys.sort()).toEqual(['ask-ai', 'coaching', 'settings'])
  })

  it('the loading string exists, so the route’s own convention has copy', () => {
    const i18n = JSON.parse(read('src/business/i18n/ja.json'))
    expect(i18n.askAi.loading).toBe('読み込み中…')
  })

  it('this room flips ONE line — 録音/設定/コーチング were flipped by THEIR rounds', () => {
    // ⚠ RE-DERIVED AT THE MAIN-MOVED FOLD (#823 録音, #812 設定) AND AGAIN AT THE
    // 2026-09-05 FOLD OF コーチング (⑥): each of those rooms is LIVE in the rail
    // now, so a pin still asserting they are 準備中 would be this suite claiming
    // a fact about the family that stopped being true. What the pin is actually
    // FOR survives unchanged — this room flips exactly one line, and it is not
    // this one. ⚠ AND NO ROOM IS 準備中 AT THIS TIP: all twelve rail items are
    // live, so the ⚖ NAV LAW's greying is currently unexercised — this pin no
    // longer proves it, and says so rather than implying it still does. The
    // cross-check below is what proves the direction.
    expect(SIDEBAR).toContain("{ key: 'coaching', segment: 'coaching', label: 'コーチング', mini: 'コーチ', live: true }")
    expect(SIDEBAR).toContain("{ key: 'recording', segment: 'recording', label: '録音', mini: '録音', live: true }")
    expect(SIDEBAR).toContain("{ key: 'settings', segment: 'settings', label: '設定', mini: '設定', live: true }")
  })

  it('⚖ EVERY DOOR THIS ROOM OFFERS IS OPEN IN THE RAIL ITSELF — cross-checked, never self-asserted', () => {
    // L3-1. `LIVE_SEGMENTS` was pinned only against a hand-typed list in this
    // file and another in the probe, so a room quietly rolled BACK to 準備中 left
    // every card in this feed pointing at a door that no longer opens — and both
    // "gates" stayed green because they were reading each other. The rail is
    // read at run time instead, and it is the rail that decides.
    const NAV = [...SIDEBAR.matchAll(
      /\{ key: '([^']+)', segment: (null|'[^']+'), label: '[^']*', mini: '[^']*', live: (true|false) \}/g,
    )].map((m) => ({ key: m[1], segment: m[2] === 'null' ? null : m[2].slice(1, -1), live: m[3] === 'true' }))
    // ⚖ NAV LAW: all twelve items render, always — so a parse that found fewer
    // is a parse that stopped working, not a rail that shrank.
    expect(NAV).toHaveLength(12)

    const liveSegments = new Set(NAV.filter((n) => n.live && n.segment).map((n) => n.segment))
    for (const segment of Object.keys(LIVE_SEGMENTS)) {
      expect({ segment, liveInTheRail: liveSegments.has(segment) }).toEqual({ segment, liveInTheRail: true })
    }
    // …and nothing the rail still calls 準備中 is on this room's list, in either
    // spelling it could be written (the item's key, or a segment it might grow).
    for (const item of NAV.filter((n) => !n.live)) {
      expect({ key: item.key, offered: Object.hasOwn(LIVE_SEGMENTS, item.key) }).toEqual({ key: item.key, offered: false })
    }
    // The probe keeps its own copy of this list as redundancy; this is the pin
    // that fails in THIS suite rather than in a neighbour's.
    expect(Object.keys(LIVE_SEGMENTS).sort()).toEqual(
      ['analytics', 'customers', 'inbox', 'karute', 'register', 'reservations', 'shifts', 'today'],
    )
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
   *  as selectors. Red-proven below against exactly that plant.
   *
   *  ⚠ AND IT KEEPS THE BAND (R4-6, blind lens L2-F3). `selectorsOf` used to
   *  throw the at-rule PRELUDE away, and the ⚖ PAGE-SCROLL re-pin below needs
   *  it: 「the same box, capped once at the desk and once at ≤743」 is a claim
   *  about WHICH BAND each declaration is in, and a list of bare selector names
   *  cannot express it — so deleting the touch cap while duplicating the desk one
   *  read as byte-identical and passed. One walker answers both questions now;
   *  `selectorsOf` is the same walk with the bands dropped, so the two can never
   *  disagree about what a rule is. */
  type CssRule = { band: string; selectors: string[]; body: string }
  const rulesOf = (src: string): CssRule[] => {
    let rest = stripCss(src)
      .replace(/@(?:keyframes|font-face|counter-style|property)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    const out: CssRule[] = []
    const bands: string[] = []
    while (rest.length > 0) {
      const open = rest.indexOf('{')
      const close = rest.indexOf('}')
      if (open < 0 && close < 0) break
      // a band ending before the next rule opens: leave it, and carry on
      if (close >= 0 && (open < 0 || close < open)) {
        bands.pop()
        rest = rest.slice(close + 1)
        continue
      }
      const head = rest.slice(0, open).trim()
      rest = rest.slice(open + 1)
      // a conditional group opens a BAND — its rules are read, its prelude kept
      if (head.startsWith('@')) {
        bands.push(head.replace(/\s+/g, ' '))
        continue
      }
      const end = rest.indexOf('}')
      out.push({
        band: bands.length > 0 ? bands.join(' / ') : 'base',
        selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
        body: end < 0 ? rest : rest.slice(0, end),
      })
      rest = end < 0 ? '' : rest.slice(end + 1)
    }
    return out
  }
  const selectorsOf = (src: string) => rulesOf(src).flatMap((r) => r.selectors).filter((s) => !s.startsWith('@'))
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
    // ⚠ AND IT SEES THE TWO SHAPES THAT PASSED THE OLD ⚖ PAGE-SCROLL PIN (R4-6,
    // blind lens L2-F3), demonstrated here rather than described:
    //  (a) a SECOND vertical scroller riding the panel's own rule on a multi-line
    //      comma selector — invisible to a parser that keeps only the last line;
    const comma = '.biz .pg-ask-ai .ak-newbox,\n.biz .pg-ask-ai .ak-chat-scroll { overflow-y: auto; }'
    expect(rulesOf(comma)[0].selectors)
      .toEqual(['.biz .pg-ask-ai .ak-newbox', '.biz .pg-ask-ai .ak-chat-scroll'])
    //  (b) the SAME cap stated twice in ONE band — indistinguishable from one per
    //      band to a list that records no band.
    const twice = '.a { max-height: 10px; }\n@media (max-width: 743px) { .a { max-height: 20px; } }'
    expect(rulesOf(twice).map((r) => `${r.band}::${r.selectors.join(',')}`))
      .toEqual(['base::.a', '@media (max-width: 743px)::.a'])
  })

  it('the neighbours are all here — read from disk, never restated', () => {
    // ⚠ RE-DERIVED AT THE MAIN-MOVED FOLD: `recording` (#823) and `settings`
    // (#812) shipped their own sheets while this branch was out, and a new
    // neighbour is MEANT to fail here once — the collision list below is
    // re-derived against both in the same pass rather than the bleed being
    // found in a browser. Both scope every rule under their own `.pg-` class,
    // so neither adds a collision. RE-DERIVED AGAIN at the 2026-09-05 fold of
    // コーチング (⑥): its sheet joined the family the same way, scoped under
    // `.pg-coaching`, and the collision list below is unchanged by it.
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'coaching', 'customers', 'inbox', 'karute', 'recording', 'register', 'reservations', 'settings', 'shifts', 'today'])
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
    // RE-DERIVED AT THE #832 FOLD: 予約一覧 rewrote `reservations.css` and now
    // scopes every rule under `.pg-reservations`, so its two bare `.btn` rules
    // are gone from disk — main made the same narrowing in the 施術記録 and
    // 売上・レジ lists in the same PR. The list is DERIVED, so it shrinks with
    // the sheets; the room's own four-level fences below are untouched.
    //
    // ⚠ RE-DERIVED AGAIN AT THE #834 FOLD, AND IT IS EMPTY NOW: 顧客's V2
    // redesign retired `customers.css`'s bare `.biz .page .btn` — its buttons
    // are `cu-btn-*` — which was this room's last surviving collision, and the
    // same narrowing main made in the 施術記録 / 売上・レジ / 受信トレイ lists in
    // that PR. Derived freshly on every run, so the day a neighbour states a
    // bare rule on one of this room's names again, this goes red and the fence
    // grows in the same pass. What the fence is FOR is unchanged and is proven
    // below, not here: the room states its own value at FOUR levels regardless
    // of whether a neighbour is currently contesting it.
    expect(collisions.sort()).toEqual([])
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

  it('⚖ PAGE-SCROLL — EXACTLY ONE wrapper owns a vertical axis, and it is the transcript', () => {
    // ⚖-ADJ A, and it is RE-PINNED rather than loosened. The ⚖ 8/22 ruling
    // targets board and list wrappers — a reader hunting a row inside a box —
    // and the accepted mock's conversation is a READING panel of the same class
    // as 破棄の記録's `.rc-tscroll` (recording.css:1443), which Liam approved by
    // name. So the pin becomes an EQUALITY on the room's whole sheet: one
    // vertical scroller, and it is `.ak-chat-scroll`; the two horizontal panners
    // are content strips, which the ruling allows and each owns its own
    // container; nothing else caps a height; and `overscroll-behavior` is absent
    // everywhere, so the page keeps the document's axis when the panel ends.
    // ⚠ REWRITTEN ON THE WALKER (R4-6, blind lens L2-F3). The previous spelling
    // was three equalities that BOTH passed while the truth was broken, proven on
    // this sheet: (a) `block.slice(0, i).trim().split('\n').pop()` keeps only the
    // LAST line of a selector, so a second vertical scroller sharing this rule
    // through a multi-line comma selector was invisible; (b) `capped` recorded
    // bare names with no band, so deleting the ≤743 cap and duplicating the desk
    // one was byte-identical to the truth. Both are impossible to write now: the
    // sets are COMMA-SPLIT, and every cap carries the band it is stated in.
    const rules = rulesOf(CSS_SRC)
    expect(rules.length).toBeGreaterThan(80)
    const carrying = (re: RegExp) => rules.filter((r) => re.test(r.body))
    const setOf = (rs: CssRule[]) => [...new Set(rs.flatMap((r) => r.selectors))].sort()
    const banded = (rs: CssRule[]) => rs.flatMap((r) => r.selectors.map((s) => `${r.band}::${s}`)).sort()

    expect(setOf(carrying(/overflow-y\s*:\s*(auto|scroll)/))).toEqual(['.biz .pg-ask-ai .ak-chat-scroll'])
    expect(setOf(carrying(/overflow-x\s*:\s*(auto|scroll)/)))
      .toEqual(['.biz .pg-ask-ai .ak-hintrow', '.biz .pg-ask-ai .ak-rail-list'])
    // the SAME one box, once at the desk ceiling and once at the ≤743 one — and
    // the band is part of the assertion, so the two cannot be swapped for each
    // other or collapsed into one band stated twice.
    expect(banded(carrying(/max-height/))).toEqual([
      '@media (max-width: 743px)::.biz .pg-ask-ai .ak-chat-scroll',
      'base::.biz .pg-ask-ai .ak-chat-scroll',
    ])
    expect(CSS_CODE).not.toMatch(/overscroll-behavior/)
    // …and `position: sticky` appears nowhere at all in this room.
    expect(CSS_CODE).not.toMatch(/position:\s*sticky/)
    // ⚠ AND THE PANEL REALLY IS THE ONE THE SCREEN SCROLLS TO ITS NEWEST ENTRY.
    expect(SCREEN_CODE).toContain('el.scrollTop = el.scrollHeight')
    expect(SCREEN_CODE).toContain('<div className="ak-chat-scroll" ref={chatRef}>')
  })

  it('⚖ R13 + the one-way accent law — no black-filled interactive, accent on pressables only', () => {
    // The commit action and the deep link are the ONLY solid accent fills.
    const solid = [...CSS_CODE.matchAll(/([^{}]+)\{([^}]*background:\s*var\(--ak-accent\)[^}]*)\}/g)]
      .map((m) => m[1].trim().split('\n').pop()!.trim())
    expect(solid.sort()).toEqual([
      '.biz .pg-ask-ai .ak-door',
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

describe('⚖ THE TZ MATRIX — pinned clocks, and the JST day is sliced from a UTC machine', () => {
  // L3-4, and it was an honest catch against the packet's own §4: the acceptance
  // line claimed a TZ matrix and NO pin stood behind it. This room reads the
  // clock in exactly one place (`ask-ai-props.ts`) and slices 本日 with
  // `jstDayKey`; the failure it must not have is the one every server has —
  // running on UTC, where the machine's own calendar is still yesterday for the
  // first nine hours of every JST day.
  //
  // FOUR PINNED INSTANTS around ONE JST midnight (the room-5 matrix shape). The
  // fixture world is derived from the same instant, so a correct slicer gives the
  // SAME roster at all four and a day-key drift gives an empty one.
  const PINNED = [
    { at: '2026-09-14T02:00:00Z', says: '11:00 JST — mid-day, the control' },
    { at: '2026-09-14T14:58:00Z', says: '23:58 JST — the last minutes of the JST day' },
    { at: '2026-09-14T15:00:00Z', says: '00:00 JST, the NEXT day — the machine still reads 14 Sep' },
    { at: '2026-09-14T15:02:00Z', says: '00:02 JST' },
  ]
  afterAll(() => { jest.useRealTimers() })

  it('the pinned instants really do straddle a JST midnight the machine cannot see', () => {
    const key = (iso: string) => jstDayKey(new Date(iso))
    expect(key('2026-09-14T14:58:00Z')).toBe(key('2026-09-14T02:00:00Z'))
    expect(key('2026-09-14T15:00:00Z')).toBe(key('2026-09-14T14:58:00Z') + 1)
    expect(key('2026-09-14T15:02:00Z')).toBe(key('2026-09-14T15:00:00Z'))
    // …and a UTC machine reading its own calendar sees ONE day across all four,
    // which is exactly the mistake the matrix is here to fail.
    expect(new Set(PINNED.map((p) => new Date(p.at).getUTCDate())).size).toBe(1)
  })

  for (const p of PINNED) {
    it(`slices 本日 and 予約 correctly at ${p.at} — ${p.says}`, async () => {
      jest.useFakeTimers().setSystemTime(new Date(p.at))
      const now = new Date(p.at)
      // The clock the assembly reads IS the pinned one — otherwise every
      // assertion below would be measuring the wall clock and passing by luck.
      expect(renderNow().getTime()).toBe(now.getTime())

      const mine = appointments(now).filter((a) => a.store_id === STORE_A)
      const todayKey = jstDayKey(now)
      const roster = new Set(
        mine.filter((a) => jstDayKey(new Date(a.starts_at)) === todayKey).map((a) => a.customer_id).filter(Boolean),
      ).size
      const upcoming = mine.filter((a) => a.starts_at > now.toISOString() && a.status !== 'cancelled').length

      const { props } = await askAiProps({ locale: 'ja', store: STORE_A })

      // 本日 — the roster chip's own number. Never zero in this world: a pin that
      // went green because both sides were empty would prove nothing at all.
      expect(roster).toBeGreaterThan(0)
      expect(props.signals[0].title).toBe(`本日ご来店の${roster}名のお客様の要点まとめ`)
      expect(props.signals[0].contextLabel).toBe(`本日ご来店のお客様${roster}名のカルテ`)
      // 予約 — the scope strip's third fact, off the SAME instant, so one render
      // can never put two different days on one screen.
      expect(props.scope[2]).toEqual({ key: 'bookings', label: '予約', value: `${upcoming}件` })
      // …and the dateline prints the JST calendar day, not the machine's.
      expect(props.dateline).toContain(
        new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(now),
      )
    })
  }

  it('the roster is the SAME on both sides of the JST midnight — the day moved, the slicing did not', () => {
    // Each test above proved the ROOM's roster equals the world's at its own
    // instant; this proves the world's is one number across the straddle. So a
    // slicer that dropped the day at 15:00Z would have to disagree with one of
    // the two, and there is nowhere for it to hide.
    const rosterAt = (iso: string) => {
      const at = new Date(iso)
      const key = jstDayKey(at)
      return new Set(
        appointments(at)
          .filter((a) => a.store_id === STORE_A && jstDayKey(new Date(a.starts_at)) === key)
          .map((a) => a.customer_id)
          .filter(Boolean),
      ).size
    }
    const all = PINNED.map((p) => rosterAt(p.at))
    expect(all[0]).toBeGreaterThan(0)
    expect(new Set(all).size).toBe(1)
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
