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
import { minuteOf, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'
import {
  blockChrome,
  landingVerdict,
  parkChipText,
  withheldSub,
  type LandingQuestion,
} from '@/app/[locale]/(business)/business/today/today-interactions'

const HOURS: Hours = { open: 600, close: 1140 } // 10:00–19:00

// STORE_A's words (chiropractic) and the generic row — byte-identical to
// `other` (D-13).
const A = RESOURCE_WORDS.chiropractic
const G = RESOURCE_WORDS.other

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
  })

  describe('(c) the null cases — a row with no word falls back to the generic row', () => {
    // ⚖ D-53 (s)/(u) — withheldSub's own field (`resourceNoun`) is never
    // null in the table (P13, resource-words.test.ts), so it takes no
    // generic fallback and needs no null-case leg here.
    const NO_PRIVATE = RESOURCE_WORDS.yoga_studio // privateWord: null, turnoverWord: null

    it('parkChipText — a null privateWord falls back to the generic 個室', () => {
      const vip = booking({ key: 'a', caseId: 'apt-1', requiresPrivateRoom: true }, 660, 750)
      expect(parkChipText(vip, HOURS, '8/20', NO_PRIVATE, G).line1).toBe('90分・個室のみ')
    })

    it('landingVerdict — a null privateWord falls back to the generic word in all three slots', () => {
      const v = landingVerdict(roomBoard, roomAsk(true), null, NO_PRIVATE, G)
      expect(v.reason).toBe('個室のみの予約です。ベッド1は個室ではないので、個室の行に置いてください')
    })

    // ⚖ m4 (PKT-BUILD-N2B1-SINGLE-LANE.md) — blockChrome itself takes an
    // already-resolved `turnoverWord: string`, never a nullable row, so the
    // generic fallback lives at the CALLER (TodayScreen.tsx), not here. A
    // wrong-lane turnover word never goes RED on this static fixture
    // (STORE_A's own chrome word is the same literal); this source pin is
    // the disclosed proof the fallback exists at all three call sites, and
    // the DOM-level proof is the N2b-2 blind round's own item.
    it('TodayScreen resolves a missing lane turnover word from the generic row — source pin', () => {
      const SRC = readFileSync(
        join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
        'utf8',
      )
      expect(SRC).toContain('?? props.genericWords.turnoverWord!')
    })
  })
})
