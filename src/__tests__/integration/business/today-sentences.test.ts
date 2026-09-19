// ⚖ D-53 (u)/(n2b1) — the four single-lane sentence functions read the
// resource words their (already-resolved) caller passes, instead of the
// hardcoded ベッド/個室/清掃 literals (PKT-BUILD-N2B1-SINGLE-LANE.md item 10).
//
// The generic-row invariant itself (`other` carries every word non-null) is
// ALREADY pinned at resource-words.test.ts:68-75 (plus the table equality at
// :42 / :78-82) — referenced here, not re-proven.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RESOURCE_WORDS } from '@/business/lib/resource-words'
import {
  buildLanes,
  hhmm,
  minuteOf,
  place,
  type BoardBooking,
  type BoardItem,
  type BoardLane,
  type BuildInput,
  type Hours,
} from '@/business/lib/today-board'
import {
  allocateBed,
  applyMoves,
  blockChrome,
  explainRails,
  guardRailsFor,
  guardVerdictAt,
  landingVerdict,
  parkChipText,
  railExplain,
  reseatSentence,
  sellLayerFor,
  withheldSub,
  type LandingQuestion,
  type Moves,
  type RailCell,
  type RailInput,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { computeChecks, type CheckContext } from '@/business/lib/canon-logic/drag-rules'
import type { GuardConfig } from '@/business/lib/canon-logic/gap-guard'
import type { GapCell } from '@/business/lib/canon-logic/availability'
import type { FixtureResource } from '@/business/lib/fixtures-today'
import type { FixtureStaff } from '@/business/lib/fixtures'

const HOURS: Hours = { open: 600, close: 1140 } // 10:00–19:00

// STORE_A's words (chiropractic) and the generic row — byte-identical to
// `other` (D-13).
const A = RESOURCE_WORDS.chiropractic
const G = RESOURCE_WORDS.other
// ⚖ D-53 (ak)/(al) N2c-1 — the allocator's own resolved pair, STORE_A's;
// byte-identical to `other` (D-13), so no expected value below moves.
const ASK_A = { resourceNoun: A.resourceNoun, privateWord: A.privateWord! }

function booking(over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'caseId'>, start: number, end: number): BoardItem {
  return {
    kind: 'booking', state: 'confirmed', category: 'repeat',
    ...place(start, end, HOURS),
    title: '見本 はなこ', tag: '【ベッド1】', time: '',
    ticketCat: null, ticketCore: null, held: false, micro: false,
    label: '', ...over,
  }
}

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key, sub: '', absentNote: null, mine: false, items: [],
    window: over.group === 'staff' ? { from: HOURS.open, until: HOURS.close } : null,
    untilLabel: over.group === 'staff' ? '19:00' : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: over.group === 'staff' ? null : ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

// The smallest board for #47-49's own stop: a private-tagged ask over a
// standard bed. Shape mirrors today-screen-interactions.test.ts:12935-12945
// (I11, `bed('bed-01', 'standard')` → label 'ベッド1'); its :12945 is the
// unchanged runtime expectation this file pins again through the new
// `words`/`generic` parameters.
const staffLane = lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'] })
const standardBed = lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard', stores: ['store-a'] })
const roomBoard = [staffLane, standardBed]

const roomAsk = (requiresPrivate: boolean): LandingQuestion => ({
  staffLane: 'p-01', bedLane: 'bed-01', solveRoom: false, id: null, requiresPrivate,
  start: 960, end: 1020, span: place(960, 1020, HOURS), foreignRefusal: null, hasPrice: true,
  locked: [], minutesOf: (x: number) => minuteOf(x, HOURS),
})

describe('⚖ D-53 (u)/(n2b1) — the sentence functions read the resolved words', () => {
  describe('(a) STORE_A byte identity — the old literals, unchanged, through the new parameters', () => {
    it('blockChrome — the cleanup deletion refusal', () => {
      expect(blockChrome('cleanup', A.turnoverWord!).notDeletable).toBe(
        'この清掃は直前の予約に付いています。予約を動かせば一緒に動き、予約が消えれば一緒に消えます。',
      )
    })

    it('withheldSub — the withheld-resource sentence', () => {
      expect(withheldSub(60, A)).toBe('60分・ベッドが空いていません・確保が解除されれば販売に戻ります')
    })

    it('parkChipText — the 個室のみ tag rides the shelf only for a tagged item', () => {
      const vip = booking({ key: 'a', caseId: 'apt-1', requiresPrivateRoom: true }, 660, 750)
      const plain = booking({ key: 'b', caseId: 'apt-2', requiresPrivateRoom: false }, 660, 750)
      expect(parkChipText(vip, HOURS, '8/20', A, G).line1).toBe('90分・個室のみ')
      expect(parkChipText(plain, HOURS, '8/20', A, G).line1).not.toContain('個室のみ')
    })

    it('landingVerdict — the explicit-bed room-class stop', () => {
      const v = landingVerdict(roomBoard, roomAsk(true), null, A, G)
      expect(v.reason).toBe('個室のみの予約です。ベッド1は個室ではないので、個室の行に置いてください')
    })
  })

  describe('(b) a different business type\'s words actually reach the sentence', () => {
    const GYM = RESOURCE_WORDS.personal_gym // ブース / 清掃
    const DENTAL = RESOURCE_WORDS.dental_clinic // ユニット / 消毒

    it('withheldSub carries the store\'s own resourceNoun', () => {
      const gym = withheldSub(60, GYM)
      const dental = withheldSub(60, DENTAL)
      console.log('today-sentences withheldSub', { gym, dental })
      expect(gym).toBe('60分・ブースが空いていません・確保が解除されれば販売に戻ります')
      expect(dental).toBe('60分・ユニットが空いていません・確保が解除されれば販売に戻ります')
    })

    it('blockChrome carries the store\'s own turnoverWord', () => {
      const gym = blockChrome('cleanup', GYM.turnoverWord!).notDeletable
      const dental = blockChrome('cleanup', DENTAL.turnoverWord!).notDeletable
      console.log('today-sentences blockChrome', { gym, dental })
      expect(gym).toBe('この清掃は直前の予約に付いています。予約を動かせば一緒に動き、予約が消えれば一緒に消えます。')
      expect(dental).toBe('この消毒は直前の予約に付いています。予約を動かせば一緒に動き、予約が消えれば一緒に消えます。')
    })

    it('parkChipText carries the store\'s own privateWord (D-53 (af) item 8)', () => {
      // The table's actual private word — both gym and dental — is 個室 (say so).
      expect(GYM.privateWord).toBe('個室')
      expect(DENTAL.privateWord).toBe('個室')
      const vip = booking({ key: 'a', caseId: 'apt-1', requiresPrivateRoom: true }, 660, 750)
      const gym = parkChipText(vip, HOURS, '8/20', GYM, G).line1
      const dental = parkChipText(vip, HOURS, '8/20', DENTAL, G).line1
      console.log('today-sentences parkChipText', { gym, dental })
      expect(gym).toBe('90分・個室のみ')
      expect(dental).toBe('90分・個室のみ')
    })

    it('landingVerdict carries the store\'s own privateWord (D-53 (af) item 8)', () => {
      // Byte-identical to STORE_A's own (a) reason: the table's private word
      // is 個室 for both rows, so this leg proves the row REACHES the
      // function — the byte identity itself is the table's fact, not a
      // discriminating check (MINOR-2 above covers discrimination).
      const gym = landingVerdict(roomBoard, roomAsk(true), null, GYM, G).reason
      const dental = landingVerdict(roomBoard, roomAsk(true), null, DENTAL, G).reason
      console.log('today-sentences landingVerdict', { gym, dental })
      expect(gym).toBe('個室のみの予約です。ベッド1は個室ではないので、個室の行に置いてください')
      expect(dental).toBe('個室のみの予約です。ベッド1は個室ではないので、個室の行に置いてください')
    })
  })

  describe('(c) the null cases — a row with no word falls back to the generic row', () => {
    // ⚖ D-53 (s)/(u) — withheldSub's own field (`resourceNoun`) is never
    // null in the table (P13, resource-words.test.ts), so it takes no
    // generic fallback and needs no null-case leg here.
    const NO_PRIVATE = RESOURCE_WORDS.yoga_studio // privateWord: null, turnoverWord: null
    // ⚖ D-53 (af) MINOR-2 — a distinguishable generic word, so a hardcoded 個室 fails
    const G_PROBE = { ...G, privateWord: '個室X' }

    it('parkChipText — a null privateWord falls back to the generic 個室', () => {
      const vip = booking({ key: 'a', caseId: 'apt-1', requiresPrivateRoom: true }, 660, 750)
      expect(parkChipText(vip, HOURS, '8/20', NO_PRIVATE, G).line1).toBe('90分・個室のみ')
      expect(parkChipText(vip, HOURS, '8/20', NO_PRIVATE, G_PROBE).line1).toBe('90分・個室Xのみ')
    })

    it('landingVerdict — a null privateWord falls back to the generic word in all three slots', () => {
      const v = landingVerdict(roomBoard, roomAsk(true), null, NO_PRIVATE, G)
      expect(v.reason).toBe('個室のみの予約です。ベッド1は個室ではないので、個室の行に置いてください')
      const vProbe = landingVerdict(roomBoard, roomAsk(true), null, NO_PRIVATE, G_PROBE)
      expect(vProbe.reason).toBe('個室Xのみの予約です。ベッド1は個室Xではないので、個室Xの行に置いてください')
    })

    // ⚖ m4 (PKT-BUILD-N2B1-SINGLE-LANE.md) — blockChrome itself takes an
    // already-resolved `turnoverWord: string`, never a nullable row, so the
    // generic fallback lives at the CALLER (TodayScreen.tsx), not here. A
    // wrong-lane turnover word never goes RED on this static fixture
    // (STORE_A's own chrome word is the same literal); this source pin
    // counts the fallback expression at all three call sites (⚖ D-53 (af)
    // MINOR-4 — a bare `toContain` proved only one; a count pin proves all
    // three: the drag proxy, the card face, the dialog), and the DOM-level
    // proof is the N2b-2 blind round's own item.
    // ⚖ D-53 (ak)/(al) N2c-2 — DISCLOSED PIN MOVE: 3 → 4. `checksFor`'s Home D
    // resolution (`turnoverWord: (staffLane ? wordsForLane(staffLane) :
    // props.words).turnoverWord ?? props.genericWords.turnoverWord!`) is a
    // genuine fourth call site of the same fallback expression.
    it('TodayScreen resolves a missing lane turnover word from the generic row — source pin', () => {
      const SRC = readFileSync(
        join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
        'utf8',
      )
      expect(SRC.match(/\?\? props\.genericWords\.turnoverWord!/g)).toHaveLength(4)
    })

    it('page.tsx hands the generic row from the \'other\' business type — source pin', () => {
      const SRC = readFileSync(
        join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'),
        'utf8',
      )
      // ⚖ D-53 (af) MINOR-3 — every `generic.privateWord!` / `generic.turnoverWord!`
      // rests on page.tsx handing `other`'s row as `genericWords`; C5 pins
      // the call COUNT, this pins the ARGUMENT.
      expect(SRC.match(/resourceWordsFor\('other'\)/g)).toHaveLength(1)
    })
  })
})

// ⚖ D-53 (u)/(n2b2) — THE WHOLE-BOARD FUNCTIONS: `applyMoves`/`withTrailingCleanup`/
// `cleanupShell` (#31/#32), `guardRailsFor`/`guardVerdictAt`/`railCell` (#34),
// `reseatSentence`/`railExplain` (#36-#41) read the lane→words MAP TodayScreen
// builds, instead of the hardcoded literals (PKT-BUILD-N2B2-BOARD-MAP.md item 10).
// `withTrailingCleanup`/`cleanupShell`/`railCell` are module-private — driven here
// through `applyMoves`/`guardRailsFor`/`guardVerdictAt`, their only exported doors.
describe('⚖ D-53 (u)/(n2b2) — the whole-board functions read the resolved words map', () => {
  const GYM = RESOURCE_WORDS.personal_gym // ブース / 清掃 / 満席
  const DENTAL = RESOURCE_WORDS.dental_clinic // ユニット / 消毒 / 空きなし
  const RAIL_GUARD: GuardConfig = {
    services: [{ name: '整体60', dur: 60 }],
    newClientSessionMin: 90,
    protectedLabel: '新規',
    gapFillMinMin: 30,
    leadTimeMin: 0,
    mode: 'standard',
  }
  const railInput = (over: Partial<RailInput> = {}): RailInput => ({
    open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
    nowMinute: null, locked: [], guard: RAIL_GUARD, placementFeasible: () => false,
    ...over,
  })
  const openStaffLane = (key: string, label = key) => lane({ key, group: 'staff', label, stores: ['store-a'] })

  describe('(a) STORE_A bytes — #31/#32, a newly minted turnaround through applyMoves', () => {
    // A booking the SERVER drew no turnaround for at all (no `-cleanup` item
    // anywhere), staged onto a DIFFERENT bed than the one the server drew it
    // on (`movedRoom`) with that destination's own positive cleanup dial —
    // the one path that reaches `cleanupShell` fresh (I:1084's own comment).
    const origin = () => lane({
      key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard', stores: ['store-a'],
      items: [booking({ key: 'apt-1-bed', caseId: 'apt-1' }, 600, 660)],
    })
    const dest = () => lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', roomClass: 'standard', stores: ['store-a'] })
    const bedMoves: Moves = { 'apt-1': { laneKey: 'bed-02', x: 0, w: 0 } }
    const tailOf = (words: { byLaneKey: Record<string, typeof A>; generic: typeof A }): BoardItem => {
      const out = applyMoves([origin(), dest()], {}, [], [], HOURS, words, bedMoves, { 'bed-02': 15 })
      return out.find((l) => l.key === 'bed-02')!.items.find((i) => i.kind === 'cleanup')!
    }

    it('mints a fresh turnaround titled and labelled with the destination\'s own turnoverWord (清掃)', () => {
      const tail = tailOf({ byLaneKey: {}, generic: A })
      expect(tail.title).toBe('清掃')
      expect(tail.label).toContain('、清掃・予約不可')
    })

    it('(b) a gym destination mints ブース\'s own 清掃; a dental destination mints ユニット\'s own 消毒', () => {
      const gym = tailOf({ byLaneKey: { 'beds:bed-02': GYM }, generic: G })
      const dental = tailOf({ byLaneKey: { 'beds:bed-02': DENTAL }, generic: G })
      console.log('today-sentences #31/#32 tail', { gymTitle: gym.title, dentalTitle: dental.title })
      expect(gym.title).toBe('清掃')
      expect(dental.title).toBe('消毒')
      expect(dental.label).toContain('、消毒・予約不可')
    })

    it('(c) the impossible-state guard — a null-turnover row on the destination falls to the generic turnover word', () => {
      // Pinned never-hit on the real fixture (every mounted store type ships
      // a turnover word); reachable only by direct injection, exactly like
      // the identity suite's own #17 null-fallback proof.
      const tail = tailOf({ byLaneKey: { 'beds:bed-02': RESOURCE_WORDS.yoga_studio }, generic: G })
      expect(tail.title).toBe(G.turnoverWord)
    })
  })

  describe('(a)/(b) #34 — railCell\'s R-UNAVAILABLE sentence, through guardRailsFor + guardVerdictAt', () => {
    // `placementFeasible: () => false` is a CALLBACK — its mere presence (not
    // its return value) selects #34's sentence at `railCell`'s own site; a
    // wide-open staff lane guarantees the pocket check above it holds, so
    // every 30-minute start reaches the engine and is refused R-UNAVAILABLE
    // (the engine's own doc: "emits R-UNAVAILABLE only when a
    // placementFeasible callback answered false").
    it('STORE_A — 「この開始ではベッドを60分確保できません」', () => {
      const lanes = [openStaffLane('p-01')]
      const words = { byLaneKey: {}, generic: A }
      const rails = guardRailsFor(lanes, railInput(), words)
      const cell = rails[0].cells.find((c) => c.start === 780)!
      expect([cell.state, cell.reason]).toEqual(['blocked', 'bed'])
      expect(cell.sentence).toBe('この開始ではベッドを60分確保できません')
      // `guardVerdictAt` composes the identical sentence for the same ask.
      const verdict = guardVerdictAt(lanes, 'p-01', 780, railInput(), words)!
      expect(verdict.sentence).toBe(cell.sentence)
    })

    it('(b) a gym map says ブース; a dental map says ユニット', () => {
      const lanes = [openStaffLane('p-01')]
      const gym = guardRailsFor(lanes, railInput(), { byLaneKey: {}, generic: GYM }).find((r) => r.laneKey === 'p-01')!
        .cells.find((c) => c.start === 780)!
      const dental = guardVerdictAt(lanes, 'p-01', 780, railInput(), { byLaneKey: {}, generic: DENTAL })!
      console.log('today-sentences #34', { gym: gym.sentence, dental: dental.sentence })
      expect(gym.sentence).toBe('この開始ではブースを60分確保できません')
      expect(dental.sentence).toBe('この開始ではユニットを60分確保できません')
    })
  })

  // #36 (`reseatSentence`), #37-#40 (`railExplain`'s two chip ternaries) and
  // #41 (the taker clause) are exercised directly against `railExplain` on a
  // hand-built `RailCell` — the smallest scene each site actually needs
  // (its own composed sentence/word never depends on how the cell itself was
  // derived, only on the cell's `reason`/`state` and the `opts` handed in;
  // the existing suites' full board-simulation helpers prove the WIRING from
  // a real gesture into these same functions, which this file does not
  // repeat).
  describe('#36/#37-40/#41 — railExplain\'s chip word, reseat clause and taker clause', () => {
    const OPEN: RailCell = {
      start: 780, state: 'safe', label: '✓13:00', sentence: '13:00〜14:00の新規90分の空きを守れます',
      reason: null, alternatives: [], alternativeKind: null, ackAllowed: true,
    }
    const BED_REFUSED: RailCell = {
      start: 780, state: 'blocked', label: '—', sentence: 'placeholder',
      reason: 'bed', alternatives: [], alternativeKind: null, ackAllowed: false,
    }
    const booker = (kind: BoardItem['kind']): BoardItem => booking({ key: 'x', caseId: 'x', kind }, 780, 840)

    it('#36 — the reseat clause names the store\'s own resourceNoun (STORE_A)', () => {
      const said = railExplain(OPEN, 60, {
        reseat: { tone: 'safe', lines: ['見本 さくら様 ベッド1 → ベッド2'], caution: null },
        words: A,
      })
      expect(said.sentence).toBe(reseatSentence(OPEN.sentence + '（13:00〜14:00）', ['見本 さくら様 ベッド1 → ベッド2'], null, A))
      expect(said.sentence).toContain('ほかのお客様のベッドを入れ替えて収めます')
    })

    it('(b) #36 on a gym/dental row names ブース/ユニット', () => {
      const gym = railExplain(OPEN, 60, { reseat: { tone: 'safe', lines: ['x'], caution: null }, words: GYM }).sentence
      const dental = railExplain(OPEN, 60, { reseat: { tone: 'safe', lines: ['x'], caution: null }, words: DENTAL }).sentence
      console.log('today-sentences #36', { gym, dental })
      expect(gym).toContain('ほかのお客様のブースを入れ替えて収めます')
      expect(dental).toContain('ほかのお客様のユニットを入れ替えて収めます')
    })

    it('#37-40 — the chip word: a busy room says fullWord, an all-cleanup room says turnoverWord (STORE_A)', () => {
      const busy = railExplain(BED_REFUSED, 60, {
        room: { refusal: 'x', blockers: [booker('booking')] }, words: A,
      })
      expect(busy.word).toBe('満室')
      const turning = railExplain(BED_REFUSED, 60, {
        room: { refusal: 'x', blockers: [booker('cleanup')] }, words: A,
      })
      expect(turning.word).toBe('清掃')
    })

    it('(b) the same on a gym row (満席/清掃) and a dental row (空きなし/消毒)', () => {
      const gymBusy = railExplain(BED_REFUSED, 60, { room: { refusal: 'x', blockers: [booker('booking')] }, words: GYM }).word
      const gymTurning = railExplain(BED_REFUSED, 60, { room: { refusal: 'x', blockers: [booker('cleanup')] }, words: GYM }).word
      const dentalBusy = railExplain(BED_REFUSED, 60, { room: { refusal: 'x', blockers: [booker('booking')] }, words: DENTAL }).word
      const dentalTurning = railExplain(BED_REFUSED, 60, { room: { refusal: 'x', blockers: [booker('cleanup')] }, words: DENTAL }).word
      console.log('today-sentences #37-40', { gymBusy, gymTurning, dentalBusy, dentalTurning })
      expect(gymBusy).toBe(GYM.fullWord)
      expect(gymTurning).toBe(GYM.turnoverWord)
      expect(dentalBusy).toBe(DENTAL.fullWord)
      expect(dentalTurning).toBe(DENTAL.turnoverWord)
    })

    it('(c) a null-turnover row (yoga) gives fullWord even when every blocker is a cleanup', () => {
      const NO_TURNOVER = RESOURCE_WORDS.yoga_studio
      const allCleanup = railExplain(BED_REFUSED, 60, {
        room: { refusal: 'x', blockers: [booker('cleanup'), booker('cleanup')] }, words: NO_TURNOVER,
      })
      expect(NO_TURNOVER.turnoverWord).toBeNull()
      expect(allCleanup.word).toBe(NO_TURNOVER.fullWord)
    })

    it('#41 — the taker clause names the store\'s own resourceNoun (STORE_A), and its gym/dental forms', () => {
      const a = railExplain(OPEN, 60, { adless: true, takerLabel: '見本 かおる', words: A }).sentence
      const gym = railExplain(OPEN, 60, { adless: true, takerLabel: '見本 かおる', words: GYM }).sentence
      const dental = railExplain(OPEN, 60, { adless: true, takerLabel: '見本 かおる', words: DENTAL }).sentence
      console.log('today-sentences #41', { a, gym, dental })
      expect(a).toContain('ベッドは別のスタッフ（見本 かおる）の枠が使うため')
      expect(gym).toContain('ブースは別のスタッフ（見本 かおる）の枠が使うため')
      expect(dental).toContain('ユニットは別のスタッフ（見本 かおる）の枠が使うため')
    })
  })

  describe('(d) the map itself: group+key resolution, chrome fallback, and one driven production consumer', () => {
    // ⚖ b4 (PKT-BUILD-N2B2-BOARD-MAP.md) — a locally reconstructed map alone
    // proves nothing about production; TodayScreen's OWN construction is
    // pinned at its source (the group-qualified key expression, exactly
    // once), and this leg proves the RULE ITSELF disambiguates a same-key
    // staff/beds collision through a real consumer.
    it('TodayScreen builds `laneWords` keyed GROUP + KEY — source pin (catches b4)', () => {
      const src = readFileSync(
        join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
        'utf8',
      )
      const count = src.split('`${l.group}:${l.key}`').length - 1
      console.log('N2B2-B4-PIN', { count })
      expect(count).toBe(1)
    })

    // ⚖ b5 — `boardLanes`' own dependency array must list `laneWords` (it
    // reads it via `applyMoves`); dropping it from the deps is the mutant.
    it('`boardLanes`\' dependency array carries `laneWords` — source pin (catches b5)', () => {
      const src = readFileSync(
        join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
        'utf8',
      )
      expect(src).toContain('[placedLanes, liveMoves, parked, addedHere, hours, laneWords, liveBedMoves, props.bedCleanupMinutes]')
    })

    it('a staff lane and a beds lane sharing one literal key resolve to their OWN rows, never each other\'s (the group half of the key)', () => {
      // The exact formula `laneWords` composes (`${l.group}:${l.key}`),
      // reconstructed here only to prove the FORMULA disambiguates a
      // collision — the fact that TodayScreen really builds it this way is
      // the source pin above, not re-proven by this map.
      const words = { byLaneKey: { 'staff:shared': GYM, 'beds:shared': DENTAL }, generic: G }
      const staffLane = openStaffLane('shared')
      const cell = guardVerdictAt([staffLane], 'shared', 780, railInput(), words)!
      expect(cell.sentence).toContain(GYM.resourceNoun)
      expect(cell.sentence).not.toContain(DENTAL.resourceNoun)
    })

    it('a floating/unknown lane and a missing key both fall to the map\'s own generic row', () => {
      const floating = lane({ key: 'p-float', group: 'staff', label: '見本 ふろー', stores: null })
      const words = { byLaneKey: {}, generic: DENTAL }
      const cell = guardVerdictAt([floating], 'p-float', 780, railInput(), words)!
      expect(cell.sentence).toBe(`この開始では${DENTAL.resourceNoun}を60分確保できません`)
    })

    it('production consumer — guardVerdictAt on a gym staff lane says ブース (mutant b2\'s own catch)', () => {
      const gymLane = openStaffLane('p-gym', '見本 スタジオ')
      const words = { byLaneKey: { 'staff:p-gym': GYM }, generic: G }
      const cell = guardVerdictAt([gymLane], 'p-gym', 780, railInput(), words)!
      expect(cell.sentence).toContain('ブース')
    })

    // ⚖ D-53 (ai) F-1 — the one production path from the map into railExplain, pinned
    it('explainRails resolves EACH rail\'s own row from the map — a gym rail wears ブース\'s words, never the generic row', () => {
      const gymLane = openStaffLane('p-gym', '見本 スタジオ')
      // The smallest board that reaches `explainRails`' internal `allocate`
      // call with each blocker class — the same shape as today-explains.test.ts
      // §2's `sceneWith`/`cleanup` scene (one open staff lane, one bed lane,
      // the bed's own items switching the blocker kind), rebuilt locally since
      // this file does not import that file's helpers.
      const bedLane = lane({
        key: 'bed-01', group: 'beds', label: 'ベッド1',
        items: [
          { ...booking({ key: 'clean-1', caseId: null }, 780, 840), kind: 'cleanup', state: null, category: null, title: '清掃' },
          booking({ key: 'apt-1', caseId: 'apt-1' }, 900, 960),
        ],
      })
      // generic = A (chiropractic), never GYM — so a mutant that falls back to
      // the generic row for every rail cannot pass by coincidence.
      const words = { byLaneKey: { 'staff:p-gym': GYM }, generic: A }
      const rails = guardRailsFor([gymLane, bedLane], railInput(), words)
      const explained = explainRails(rails, [gymLane, bedLane], {
        dur: 60, handId: null, stagedId: null,
        sellCells: [], claims: [], drops: [], inHand: false, sellDisplayed: true,
        words,
      })
      const chips = explained.get('p-gym')!
      console.log('today-sentences F-1 explainRails', {
        cleanupWord: chips.get(780)!.word, bookingWord: chips.get(900)!.word,
        GYM_turnoverWord: GYM.turnoverWord, GYM_fullWord: GYM.fullWord,
      })
      // The table, first: GYM's (personal_gym) own two words.
      expect(GYM.turnoverWord).toBe('清掃')
      expect(GYM.fullWord).toBe('満席')
      // An all-cleanup window wears the gym's OWN turnover word.
      expect(chips.get(780)!.word).toBe(GYM.turnoverWord)
      // A real-booking window wears the gym's OWN full word — 満席, never the
      // generic row's 満室 — the one value that actually tells `railWords`
      // (this rail's own row) apart from `opts.words.generic` (F-1's mutant).
      expect(chips.get(900)!.word).toBe(GYM.fullWord)
      expect(chips.get(900)!.word).not.toBe(A.fullWord)
      // Neither chip reaches the taker clause or the reseat clause: both are
      // bed-refused (`state === 'blocked'`), and `railExplain` returns the
      // bare sentence for a blocked chip before either clause is asked — this
      // scene proves the WORD only, not those two sites.
      expect(chips.get(780)!.sentence).not.toContain('別のスタッフ')
      expect(chips.get(900)!.sentence).not.toContain('別のスタッフ')
    })
  })

  // (e) the identity suite calls none of applyMoves/guardRailsFor/
  // guardVerdictAt/explainRails/railExplain/reseatSentence directly (its four
  // raw calls are all `allocateBed`/`sellLayerFor`, N2c/untouched territory)
  // — verified by reading today-off-identity.test.ts and its frozen json at
  // build time; `git diff` for both files is empty (this build never opens
  // them). Recorded here rather than re-proven as a jest assertion: a diff
  // check is a build-time fact, not a runtime one.
})

// ⚖ D-53 (ak)/(al) N2c-1 (COLD-READ F11) — THE FROZEN WORD-MINTING FILES READ
// THE HANDED-IN WORDS: `fullRoomsRefusal` (the allocator's own refusal
// sentence, today-interactions.ts) and the frozen `capacity-ledger.ts` that
// forwards the pair to it. `allocateBed`/`sellLayerFor` themselves are
// N2c-1's own family (untouched by n2b1/n2b2 above); this describe is the
// one home for their sentence-level proof.
describe('⚖ D-53 (ak)/(al) — the frozen word-minting files read the handed-in words', () => {
  const busyBoard = (title = '見本 かえる') => [
    staffLane,
    lane({
      key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard', stores: ['store-a'],
      items: [booking({ key: 'b1', caseId: 'apt-1', title }, 960, 1020)],
    }),
  ]
  const askOver = (words: { resourceNoun: string; privateWord: string }, requiresPrivate = false) => ({
    id: null, currentBed: null, stores: ['store-a'], words, requiresPrivate, start: 960, end: 1020,
  })

  describe('(a) STORE_A bytes — byte-for-byte against today’s shipped sentence', () => {
    it('the untagged ask over an occupied bed', () => {
      const solved = allocateBed(busyBoard(), askOver(ASK_A))
      // Spot-checked against `git show c8cab5df77c1d74ead30ab116bbcc01883fa6fb7:
      // src/app/[locale]/(business)/business/today/today-interactions.ts`'s own
      // `fullRoomsRefusal` — the window/room/named/predicate composition,
      // unchanged.
      expect(solved.refusal).toBe('16:00〜17:00はベッドに空きがありません。ベッド1（見本 かえる様）が使用中です')
    })

    it('the tagged ask on a private-less board', () => {
      const solved = allocateBed(roomBoard, askOver(ASK_A, true))
      // Spot-checked the same way — the base's `rows.length === 0` literal,
      // byte for byte.
      expect(solved.refusal).toBe('この店舗には個室がありません。個室のある店舗へ移してください')
    })
  })

  describe('(b) a dental pair and a gym pair reach the same sentence', () => {
    const DENTAL_ASK = { resourceNoun: RESOURCE_WORDS.dental_clinic.resourceNoun, privateWord: RESOURCE_WORDS.dental_clinic.privateWord! }
    const GYM_ASK = { resourceNoun: RESOURCE_WORDS.personal_gym.resourceNoun, privateWord: RESOURCE_WORDS.personal_gym.privateWord! }

    it('a dental pair carries ユニット into the untagged refusal', () => {
      const solved = allocateBed(busyBoard(), askOver(DENTAL_ASK))
      console.log('today-sentences (b) dental', { refusal: solved.refusal })
      expect(solved.refusal).toBe('16:00〜17:00はユニットに空きがありません。ベッド1（見本 かえる様）が使用中です')
    })

    it('a gym pair carries ブース into the untagged refusal', () => {
      const solved = allocateBed(busyBoard(), askOver(GYM_ASK))
      console.log('today-sentences (b) gym', { refusal: solved.refusal })
      expect(solved.refusal).toBe('16:00〜17:00はブースに空きがありません。ベッド1（見本 かえる様）が使用中です')
    })
  })

  describe('(c) the probe — a hardcoded word would fail this', () => {
    const PROBE = { resourceNoun: 'ベッドX', privateWord: '個室X' }

    it('the untagged slot reads the probe’s resourceNoun', () => {
      const solved = allocateBed(busyBoard(), askOver(PROBE))
      expect(solved.refusal).toBe('16:00〜17:00はベッドXに空きがありません。ベッド1（見本 かえる様）が使用中です')
    })

    it('the private-less-board slot reads the probe’s privateWord in BOTH positions', () => {
      const solved = allocateBed(roomBoard, askOver(PROBE, true))
      expect(solved.refusal).toBe('この店舗には個室Xがありません。個室Xのある店舗へ移してください')
    })
  })

  it('(d) sellLayerFor’s words is pass-through: a dental pair produces byte-identical sell cells to STORE_A’s own', () => {
    const opts = { gridMin: 60, sellSlotMin: 60, nowMinute: null, locked: [], showPrice: true, hi: 7260, hqMin: 6600, depth: 9 }
    const dentalAsk = { resourceNoun: RESOURCE_WORDS.dental_clinic.resourceNoun, privateWord: RESOURCE_WORDS.dental_clinic.privateWord! }
    // ⚖ D-53 (ao) L1 finding 3 — without a `reconcile` claim `opts.words` is
    // never read (`sellLayerFor` only forwards it into `reconcileSellCells`,
    // and that call is itself gated on `opts.reconcile`), so the old leg's
    // equality held trivially. `p-09` is a STAFF LANE NOT ON THIS BOARD — its
    // promise on bed-01 is a ROOM collision, not p-01's own lane, so p-01's
    // own hour becomes a LOSER and is re-searched through `allocateBed` with
    // `opts.words` (same shape as today-one-offer.test.ts §3/§4's `promise`);
    // roomBoard has exactly one bed, so the loser has nowhere to land and is
    // DROPPED rather than re-bedded — the drop is the observable proof the
    // search ran.
    const promiseOnBedOne: GapCell[] = [
      { laneKey: 'p-09', resourceKey: 'bed-01', group: 'staff', staff: 'p-09', s: 960, e: 1020, price: 5000 },
      { laneKey: 'p-09', resourceKey: 'bed-01', group: 'beds', staff: 'p-09', s: 960, e: 1020, price: 5000 },
    ]
    const reconcile = { claims: promiseOnBedOne, cleanupMinutesByBed: {} }
    const bare = sellLayerFor(roomBoard, HOURS, { ...opts, words: ASK_A })
    const withA = sellLayerFor(roomBoard, HOURS, { ...opts, words: ASK_A, reconcile })
    const withDental = sellLayerFor(roomBoard, HOURS, { ...opts, words: dentalAsk, reconcile })
    console.log('today-sentences (d) sellLayerFor pass-through cell counts', {
      bare: bare.cells.length, withA: withA.cells.length, withDental: withDental.cells.length,
    })
    // the pair is REQUIRED and unobservable on this path by construction —
    // `reconcileSellCells` reads only `found.laneKey`, never `found.refusal`;
    // this leg pins the pass-through claim, not a visible word.
    expect(withDental.cells).toEqual(withA.cells)
    // …and the reconcile path actually RAN, so `opts.words` actually reached
    // `allocateBed`: the promised hour survives with no reconcile at all, and
    // is dropped — nowhere else to land on this one-bed board — once it runs.
    expect(bare.cells.some((c) => c.group === 'staff' && c.h === 960)).toBe(true)
    expect(withA.cells.some((c) => c.h === 960)).toBe(false)
  })

  describe('(e) SOURCE pins — the wiring the sentences above rest on', () => {
    const SCREEN_PATH = join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx')
    const LEDGER_PATH = join(process.cwd(), 'src/app/[locale]/(business)/business/today/capacity-ledger.ts')

    it('TodayScreen — the `ledger` memo’s dependency array carries `chromeAsk`', () => {
      const src = readFileSync(SCREEN_PATH, 'utf8')
      expect(src).toContain('[boardLanes, ledgerFrame, handId, chromeAsk],')
    })

    // ⚖ addendum (session model line audit of 78aa61d8e) — TEN hooks read
    // `chromeAsk` without listing it; `bedDoorFor` and `windowDoorOn` are the
    // two that hand foreign books to the rail, named explicitly here.
    it('TodayScreen — `bedDoorFor`’s dependency array carries `chromeAsk`', () => {
      const src = readFileSync(SCREEN_PATH, 'utf8')
      expect(src).toContain('[boardLanes, ledger, ledgerFrame, handId, chromeAsk],')
    })

    it('TodayScreen — `windowDoorOn`’s dependency array carries `chromeAsk`', () => {
      const src = readFileSync(SCREEN_PATH, 'utf8')
      expect(src).toContain('}, [ledgerFrame, chromeAsk])')
    })

    it('TodayScreen — `bookFor`’s `frameKey` template carries the words', () => {
      const src = readFileSync(SCREEN_PATH, 'utf8')
      expect(src).toContain('${words.resourceNoun}|${words.privateWord}')
    })

    // ⚖ D-53 (ao), a6 — the SOURCE half of the coverage gap: `confirmPending`
    // resolves the COMPANION'S OWN bed lane and asks for ITS words, never the
    // board's chrome pair — pinned once each so a rewrite that swapped in
    // `chromeAsk` would fail here even on a fixture no screen-level scene can
    // reach (recorded in the report; the mixed-type fixture rides N3).
    it('TodayScreen — `confirmPending` resolves the COMPANION’S OWN bed lane, exactly once', () => {
      const src = readFileSync(SCREEN_PATH, 'utf8')
      expect((src.match(/boardLanes\.find\(\(l\) => l\.group === 'beds' && l\.key === c\.bedTo\)/g) ?? []).length).toBe(1)
    })

    it('TodayScreen — `companionRoomStillFree` is asked with that lane’s words, never `chromeAsk`, exactly once', () => {
      const src = readFileSync(SCREEN_PATH, 'utf8')
      expect((src.match(/companionRoomStillFree\(boardLanes, c, span, hours, askWordsForLane\(companionBedLane\)\)/g) ?? []).length).toBe(1)
    })

    it('capacity-ledger.ts — the `search` ask carries `words,` exactly once', () => {
      const src = readFileSync(LEDGER_PATH, 'utf8')
      expect((src.match(/^\s*words,\s*$/gm) ?? []).length).toBe(1)
    })

    it('capacity-ledger.ts — `bedTruthViews` takes four parameters', () => {
      const src = readFileSync(LEDGER_PATH, 'utf8')
      const start = src.indexOf('export function bedTruthViews(')
      const sig = src.slice(start, src.indexOf('): { world: BedTruth', start))
      const params = sig.slice(sig.indexOf('(') + 1).split(',').map((s) => s.trim()).filter(Boolean)
      console.log('today-sentences (e) bedTruthViews params', params)
      expect(params).toEqual(['lanes: BoardLane[]', 'frame: DayFrame', 'hand: Hand | null', 'words: AskWords'])
    })
  })

  // ⚖ D-53 (ak)/(al) N2c-2 — Homes B/C/D: `today-board.ts`'s card label and
  // cleanup rows, and `drag-rules.ts`'s guard-check label, read the words
  // handed in through `BuildInput`/`CheckContext` instead of the hardcoded
  // ベッド/個室/清掃 literals. (e)'s "resource wins" and "staff fallback" cases
  // use SYNTHETIC per-store words rather than only real business-type rows:
  // every non-null `privateWord` in the real table is the same literal
  // (個室), so a real-data-only version of that pair would be vacuously true
  // — disclosed in the build report.
  describe('(f) the board builder and the guard check', () => {
    const CHIRO = 'store-f-chiro'
    const DENTAL = 'store-f-dental'
    const HAIR = 'store-f-hair'
    const YOGA = 'store-f-yoga'
    const PROBE_STORE = 'store-f-probe'
    const RESOURCE_STORE = 'store-f-resource-wins'
    const STAFF_STORE = 'store-f-staff-fallback'

    const WORDS_BY_STORE: Record<string, { privateWord: string | null; turnoverWord: string | null }> = {
      [CHIRO]: RESOURCE_WORDS.chiropractic,
      [DENTAL]: RESOURCE_WORDS.dental_clinic,
      [HAIR]: RESOURCE_WORDS.hair_salon,
      [YOGA]: RESOURCE_WORDS.yoga_studio,
      [PROBE_STORE]: { privateWord: '個室X', turnoverWord: '清掃X' },
      [RESOURCE_STORE]: { privateWord: 'Ｒ個室', turnoverWord: '清掃' },
      [STAFF_STORE]: { privateWord: 'Ｓ個室', turnoverWord: '清掃' },
    }

    const mkResource = (over: Partial<FixtureResource> & Pick<FixtureResource, 'id' | 'store_id'>): FixtureResource => ({
      name: over.id, note: '', cleanup_minutes: 0, room_class: 'standard', ...over,
      kind_id: over.kind_id ?? `kind-${over.store_id}`,
    })

    const mkStaff = (id: string): FixtureStaff => ({ id, full_name: id, email: null })

    const mkBooking = (over: Partial<BoardBooking> & Pick<BoardBooking, 'id' | 'staffId' | 'resourceId'>): BoardBooking => ({
      displayNo: '', customerId: 'c-1', customerName: '見本 花子', staffName: '見本 太郎', menuName: '',
      resourceName: 'ベッド1', startMinute: 600, endMinute: 660, timeRange: '10:00〜11:00', price: null,
      category: 'repeat', requiresPrivateRoom: false, state: 'confirmed', settlement: null, source: '',
      reassignedFromName: null, ticketBalance: null, takenDaysAgo: 0, updatedMinute: null, onBoard: true,
      ...over,
    })

    const mkInput = (over: Partial<BuildInput>): BuildInput => ({
      appointments: [], customers: [], menus: [], staff: [], resources: [],
      shifts: [], qualifications: {}, staffListPrice: {}, staffStores: {},
      absence: null, blocks: [], sellSlots: [], decisions: [], hours: HOURS,
      dayKey: 0, operatorStaffId: '', storeNames: new Map(), crossStore: false,
      wordsByStore: WORDS_BY_STORE, genericWords: RESOURCE_WORDS.other,
      ...over,
    })

    it('(a) STORE_A-equivalent bytes — buildLanes’ card label, cleanup row, and computeChecks’ own label, all byte-for-byte against today’s shipped sentence', () => {
      const resource = mkResource({ id: 'r-a', store_id: CHIRO, cleanup_minutes: 15 })
      const staff = mkStaff('s-a')
      const vip = mkBooking({ id: 'apt-a-vip', staffId: staff.id, resourceId: resource.id, requiresPrivateRoom: true })
      const input = mkInput({ staff: [staff], resources: [resource], staffStores: { [staff.id]: [CHIRO] } })
      const lanes = buildLanes(input, [vip])

      const bedLane = lanes.find((l) => l.key === resource.id)!
      const card = bedLane.items.find((i) => i.caseId === vip.id)!
      expect(card.label).toContain('個室のみ・')

      const cleanup = bedLane.items.find((i) => i.kind === 'cleanup')!
      expect(cleanup.title).toBe('清掃')
      expect(cleanup.label).toBe(`${resource.name}、${hhmm(vip.endMinute)}から${hhmm(vip.endMinute + resource.cleanup_minutes)}、清掃・予約不可`)

      const ctx: CheckContext = {
        spans: [{ id: 'other-cleanup', x: 0, w: 10, title: '清掃', derived: true, parked: false }],
        bookingId: vip.id, staffName: staff.full_name, staffUntil: null, laneLocked: false,
        minutesOf: (x) => x, turnoverWord: '清掃',
      }
      const checks = computeChecks({ x: 0, w: 10 }, ctx)
      expect(checks.some((c) => c.label === '空き枠・清掃は確定時に自動再配置（清掃バッファは設定に従う）')).toBe(true)
    })

    it('(b) a dental resource’s cleanup row reads 消毒, and a hair-salon resource reads 片付け', () => {
      const dentalResource = mkResource({ id: 'r-b-dental', store_id: DENTAL, cleanup_minutes: 10 })
      const hairResource = mkResource({ id: 'r-b-hair', store_id: HAIR, cleanup_minutes: 10 })
      const dentalBooking = mkBooking({ id: 'apt-b-dental', staffId: null, resourceId: dentalResource.id })
      const hairBooking = mkBooking({ id: 'apt-b-hair', staffId: null, resourceId: hairResource.id })
      const input = mkInput({ resources: [dentalResource, hairResource] })
      const lanes = buildLanes(input, [dentalBooking, hairBooking])

      const dentalCleanup = lanes.find((l) => l.key === dentalResource.id)!.items.find((i) => i.kind === 'cleanup')!
      expect(dentalCleanup.title).toBe('消毒')
      expect(dentalCleanup.label).toContain('、消毒・予約不可')

      const hairCleanup = lanes.find((l) => l.key === hairResource.id)!.items.find((i) => i.kind === 'cleanup')!
      expect(hairCleanup.title).toBe('片付け')
      expect(hairCleanup.label).toContain('、片付け・予約不可')
    })

    it('(c) the probe — a hardcoded word would fail this: the card label, the cleanup row, and computeChecks’ own label all read the probe’s words', () => {
      const resource = mkResource({ id: 'r-c', store_id: PROBE_STORE, cleanup_minutes: 10 })
      const staff = mkStaff('s-c')
      const vip = mkBooking({ id: 'apt-c-vip', staffId: staff.id, resourceId: resource.id, requiresPrivateRoom: true })
      const input = mkInput({ staff: [staff], resources: [resource], staffStores: { [staff.id]: [PROBE_STORE] } })
      const lanes = buildLanes(input, [vip])
      const bedLane = lanes.find((l) => l.key === resource.id)!
      const card = bedLane.items.find((i) => i.caseId === vip.id)!
      expect(card.label).toContain('個室Xのみ・')

      const cleanup = bedLane.items.find((i) => i.kind === 'cleanup')!
      expect(cleanup.title).toBe('清掃X')
      expect(cleanup.label).toContain('、清掃X・予約不可')

      const ctx: CheckContext = {
        spans: [{ id: 'other', x: 0, w: 10, title: '清掃X', derived: true, parked: false }],
        bookingId: vip.id, staffName: staff.full_name, staffUntil: null, laneLocked: false,
        minutesOf: (x) => x, turnoverWord: '清掃X',
      }
      const checks = computeChecks({ x: 0, w: 10 }, ctx)
      expect(checks.some((c) => c.label === '空き枠・清掃Xは確定時に自動再配置（清掃Xバッファは設定に従う）')).toBe(true)
    })

    it('(d) the null cases — a yoga resource (privateWord/turnoverWord both null) falls to the generic 個室/清掃 row', () => {
      const resource = mkResource({ id: 'r-d', store_id: YOGA, cleanup_minutes: 10 })
      const staff = mkStaff('s-d')
      const vip = mkBooking({ id: 'apt-d-vip', staffId: staff.id, resourceId: resource.id, requiresPrivateRoom: true })
      const input = mkInput({ staff: [staff], resources: [resource], staffStores: { [staff.id]: [YOGA] } })
      const lanes = buildLanes(input, [vip])
      const bedLane = lanes.find((l) => l.key === resource.id)!
      const card = bedLane.items.find((i) => i.caseId === vip.id)!
      expect(card.label).toContain('個室のみ・')

      const cleanup = bedLane.items.find((i) => i.kind === 'cleanup')!
      expect(cleanup.title).toBe('清掃')
      expect(cleanup.label).toContain('、清掃・予約不可')
    })

    it('(e) Home B’s store resolution — the booking’s RESOURCE store wins over its staff’s first store, and a no-unit booking falls to the staff’s store', () => {
      const resource = mkResource({ id: 'r-e', store_id: RESOURCE_STORE })
      const staff = mkStaff('s-e')
      const withResource = mkBooking({ id: 'apt-e-with-resource', staffId: staff.id, resourceId: resource.id, requiresPrivateRoom: true })
      const input = mkInput({ staff: [staff], resources: [resource], staffStores: { [staff.id]: [STAFF_STORE] } })
      const lanes = buildLanes(input, [withResource])
      const bedLane = lanes.find((l) => l.key === resource.id)!
      const card = bedLane.items.find((i) => i.caseId === withResource.id)!
      expect(card.label).toContain('Ｒ個室のみ・')
      expect(card.label).not.toContain('Ｓ個室')

      const noUnit = mkBooking({ id: 'apt-e-no-unit', staffId: staff.id, resourceId: null, requiresPrivateRoom: true })
      const lanes2 = buildLanes(input, [noUnit])
      const staffLane = lanes2.find((l) => l.key === staff.id)!
      const card2 = staffLane.items.find((i) => i.caseId === noUnit.id)!
      expect(card2.label).toContain('Ｓ個室のみ・')
    })

    // (f) the widened census = { offenders: 0 } on the tip — proven directly
    // in resource-words.test.ts's own census leg (R-6), not re-proven here.
  })
})
