'use client'

// 予約と確保 — ONE SECTION inside 設定, and #812's whole room re-homed into it.
//
// ⚖ S17 FOLD (Liam's kickoff, PACKET-ROOM9-S17 §1/A1). Two 設定 rooms existed at
// one path: this one (PR #812, the store-policy dials) and the family's settings
// home behind a category rail. The rail is the SHELL; these dials are its
// 予約と確保 section, placed second under 店舗運営. Every line below came out of
// #812's `SettingsScreen.tsx` unchanged — the 12 sections, the presets, the
// preview, the dial state, `clampSlot`, `PENDING_NOTE`, the `<details>` — with
// exactly three things removed and one added:
//   · the PAGE ROOT (`ROOT`, `.st-measure`) — the panel is the page now;
//   · the page HEADER and its ? button — 設定 owns the page head, and this
//     section's own `data-guide-title`/`data-guide` pair rides the section head
//     the rail renders (A2: ONE tour engine, the shell's);
//   · the TOUR ENGINE (tourIdx, the four spot layers, the keydown effect) — same
//     reason. What arrives instead is `tourOpen`, so the ⚖ F12 invariant holds:
//     opening the walk still forces 詳細設定 open, or the nine dials inside a
//     collapsed <details> measure zero and drop out of the count.
//   · `.st-seg` → `.sp-seg` and `st-save` → `sp-save` (A9): both names already
//     belonged to the shell room's sheet, and the fewest pins move.
//
// ⚖ Liam 9/1: the approved `settings-mock.html` is the spec, and its anatomy is
// presets → live preview → 詳細設定, with the mock's own one-line description
// under every dial (⚖ HIS 8/31 GENERAL LAW: 「every settings entry carries a
// one-line description of what it changes/turns off」 — every 説明 below is the
// mock's, verbatim).
//
// ⚖ 1b RULED, SUPERSEDED BY D-15 (2026-09-13) — 新規のお客様の確保 used to be
// THREE CHIPS (60分/75分/90分) because core's write side was the literal union
// `60 | 75 | 90` and a control that can name a value the store cannot save is a
// lie with a number in it. Liam's ruling now forbids the OPPOSITE lie — a
// business whose real length is 75 minutes shown three choices none of which is
// 75. The field is free again, the mock's own shape (`store-policy-seam.ts`'s
// `readMinutes` is the ONE home of what a typed value may say); the write side
// still lags the wire (CORE-10, PLAN-R3-FREE-DURATIONS.md §6) and that debt is
// carried at the seam, not answered by narrowing the control back to three.
//
// THE PREVIEW IS THE SHIPPED CARD, not a drawing of one: it imports
// `warnFaceFor` — the board's own composer — and paints the model it hands back
// in the board's own `wc-*` grammar. Every judgement on that card (the three
// permission faces, the long press, the name line, the alternative shapes, the
// ¥) is decided by that function and by nothing here, which is what makes the
// preview an honest answer to 「what will my staff actually see?」.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ResourceWords } from '@/business/lib/resource-words'
import { commitNumberField } from '@/business/lib/settings'
import {
  CALENDAR_TIGHT_RANGE,
  clampCalendarTight,
  guardVerdictAt,
  overrideLevelFor,
  protectedCapacityOf,
  warnFaceFor,
  type OverrideLevel,
  type RailCell,
} from '../today/today-interactions'
import type { PriceFrame } from '@/business/lib/canon-logic/pricing'
import type { BoardLane } from '@/business/lib/today-board'
import { Collapse, DetailToggle } from './Collapse'
import { sceneKeyFor, type GapGuardMode } from './store-policy-seam'

/** The 確保 verdict + capacity at ONE pair of dial values, computed CLIENT-SIDE
 *  now (⚖ D-15 — the length is free, so there is no fixed set of pairs left to
 *  precompute server-side). `capacity` is the ENGINE'S own count of 新規
 *  windows the day can hold at this length (`protectedCapacity`, over the
 *  day's own `freePockets`) — never derived here, one basis, ⚖ 54. `cell` is
 *  the guard's verdict at the sample landing; `null` = the day has no landing
 *  that costs the store a protected window, so there is no warn card to show. */
export interface StorePolicyScene {
  capacity: number
  cell: RailCell | null
}

/** ⚖ D-15 — EVERYTHING `computeScene` NEEDS THAT IS DATA, assembled once on
 *  the server (`store-policy-props.ts`) so the browser can re-evaluate the
 *  scene on every blur with no data access and no arithmetic of its own beyond
 *  the two engine functions themselves.
 *
 *  `guardBase` is `guardConfigFor`'s own inputs (`store-policy-props.ts`)
 *  MINUS the two fields that depend on the live dials — `newClientSessionMin`
 *  (the typed minutes) and `mode` (STANDARD/STRICT) — which `computeScene`
 *  fills in per call. Read `guardConfigFor`: those two are its ONLY
 *  minutes/strict-dependent fields, so this is the whole of the rest of it. */
export interface SceneInput {
  lanes: BoardLane[]
  words: ResourceWords
  hours: { open: number; close: number }
  stepMin: number
  dur: number
  nowMinute: number | null
  sampleLaneKey: string | null
  sampleStart: number
  guardBase: {
    services: Array<{ name: string; dur: number }>
    protectedLabel: string
    gapFillMinMin: number
    blockStepMin: number
    leadTimeMin: number
  }
}

/** THE SCENE, computed where the free length lives now: in the browser, on
 *  every blur of the 新規のお客様の確保 field. Same two engine functions
 *  (`protectedCapacityOf`, `guardVerdictAt`) `store-policy-props.ts` called
 *  server-side per fixed choice until ⚖ D-15; same `RailInput` shape
 *  `railInputFor` there has always built. ⚠ CAPACITY IS ALWAYS ASKED UNDER
 *  STANDARD (`mode === 'STANDARD'`, never the live `mode`) — it does not
 *  depend on strict/standard at all (the reason lives beside `scene.capacity`
 *  below), and asking it any other way would be a second, disagreeing
 *  derivation. `cell` is `null` at OFF or with no sample landing to preview. */
export function computeScene(input: SceneInput, mode: GapGuardMode, minutes: number): StorePolicyScene {
  const railInput = (strict: boolean) => ({
    open: input.hours.open,
    close: input.hours.close,
    stepMin: input.stepMin,
    dur: input.dur,
    protectedDur: minutes,
    nowMinute: input.nowMinute,
    locked: [] as string[],
    guard: { ...input.guardBase, newClientSessionMin: minutes, mode: strict ? ('strict' as const) : ('standard' as const) },
  })
  const capacity = protectedCapacityOf(input.lanes, railInput(false))
  // ⚖ D-25 F2 — THE SEAM'S OWN OFF ANSWER, ASKED HERE TOO. This used to spell
  // `mode === 'OFF'` inline — a second, coincidentally-matching definition of
  // OFF beside the screen's own `sceneKeyFor(mode, minutes) === null`. One
  // home now: the two can no longer drift apart because there is only one of
  // them to drift.
  const cell =
    sceneKeyFor(mode, minutes) === null || input.sampleLaneKey === null
      ? null
      : guardVerdictAt(input.lanes, input.sampleLaneKey, input.sampleStart, railInput(mode === 'STRICT'), { byLaneKey: {}, generic: input.words })
  return { capacity, cell }
}

/** ⚖ D-25 F3 — THE FREE-LENGTH COMMIT, LIFTED TO ONE PURE HOME. Both 新規の
 *  お客様の確保 and 予約の刻み call this from their own onBlur; before this it
 *  was a four-line body repeated at each call site, pinned only by a source
 *  substring (`setMinutes(commit.value)`) a snap elsewhere on the path could
 *  dodge. Same shape `commitNumberField` already gives every free-minute
 *  field: `SLOT_MIN` floor, the caller's own ceiling, '分' unit. */
// ⚖ D-30 — digits only: `Number()` would accept 1e2 / 0x10 / +5 and rewrite
// the text into another number.
export function isIntegerTextAtLeast(text: string, floor: number): boolean { const t = text.trim(); return /^[0-9]+$/.test(t) && Number(t) >= floor }

export function commitMinutes(text: string, lastGood: number, ceiling: number): { value: number; message: string | null } {
  // ⚖ D-27 — typed text is never rewritten into a different number; anything
  // that is not a positive integer restores the previous value and says so.
  const raw = isIntegerTextAtLeast(text, SLOT_MIN) ? text.trim() : ''
  return commitNumberField(raw, lastGood, SLOT_MIN, ceiling, '分')
}

/** ⚖ D-28 — an emptied box nudges from the committed value, never from
 *  `Number('') = 0`. ⚖ D-29 — the nudge starts from the committed value
 *  whenever the box holds anything the commit would refuse. ⚖ D-30 — the
 *  floor is the field's own: `SLOT_MIN` for the minute fields, `TIGHT_MIN`
 *  for 残りわずかの目安, which allows 0. */
export function nudgeBase(text: string, lastGood: number, floor: number): number {
  return isIntegerTextAtLeast(text, floor) ? Number(text.trim()) : lastGood
}

export interface StorePolicyProps {
  storeKey: string
  storeLabel: string
  policy: {
    /** ⚠SETTINGS-BATCH — `storeBookingPolicy.overridePolicy.roles`. */
    overrideRoles: string[]
    /** The store's own manager-level list (`releaseHeldRoles`), which is also
     *  what the save gate reads. DATA, never a literal. */
    managerRoles: string[]
    /** ⚠SETTINGS-BATCH — `overridePolicy.lockedOut`, staff_id で名指し. */
    lockedOut: string[]
    /** core `gap_guard_mode`, WHOLE — 'OFF' | 'STANDARD' | 'STRICT'. ⚖ 9/1 (fix
     *  round 1 F4): a boolean here threw the third state away, so an off store
     *  opened on a dial claiming it ran standard warnings. */
    mode: GapGuardMode
    /** ⚠SETTINGS-BATCH — `overrideHoldToConfirm`. */
    holdToConfirm: boolean
    /** core `new_client_session_minutes`. ⚖ D-15 — any positive integer, no
     *  fixed ladder; the ceiling is `dayLenMin` below. */
    newClientMinutes: number
    /** ⚠SETTINGS-BATCH — `heldRankAccess`. */
    heldRankAccess: 'closed' | 'silver' | 'gold' | 'platinum'
    /** ⚠SETTINGS-BATCH — the store advertises its leftovers (`minSellableMin`). */
    gapSelling: boolean
    /** ⚖ S17 · C12 — the LENGTH behind that switch, printed as a receipt in the
     *  row rather than offered as a second control (see `store-policy-props`). */
    minSellableMin: number
    /** ⚠SETTINGS-BATCH — `opsConfig.bookingStepMin`, 予約のドラッグ刻み. */
    bookingStepMin: number
    /** ⚠SETTINGS-BATCH — `storeBookingPolicy.calendarTightMax`, 残りわずかの目安.
     *  Clamped on the server by `clampCalendarTight`, the same one call the
     *  今日の運営 page makes: one clamp, two readers. */
    calendarTightMax: number
  }
  sceneInput: SceneInput
  /** ⚖ D-15 — THE DERIVED CEILING for every free-minute field in this section:
   *  the store's own operating day, in minutes (`hours.close − hours.open`).
   *  Never a number this file invents. */
  dayLenMin: number
  sample: {
    laneKey: string
    laneLabel: string
    summary: string
    rows: Array<{ label: string; tone: '' | 'bad' | 'warn' }>
    confirmEnabled: boolean
    listPrice: number
    frame: PriceFrame
    depth: number
  } | null
  operator: { name: string; role: string; staff_id: string }
  sampleStaffRole: string
  roster: Array<{ id: string; name: string }>
  /** ⚖ THE HQ SAVE GATE, decided on the server off the ROLES HOME. `refusal` is
   *  the one sentence the control prints when it cannot fire, `null` when it
   *  could; `roles` is the store's own manager-level list, named on screen so an
   *  operator who is refused knows who to ask. */
  save: { refusal: string | null; roles: string[] }
}

/** ⚠ D-1 (S17) — WHAT THE SECTION RENDERS WITH, which is the server-assembled
 *  half PLUS one render flag. `tourOpen` cannot live in `StorePolicyProps`
 *  itself: that interface is exactly what `storePolicyProps()` returns on the
 *  server, and whether the shell's ?-walk is open is a fact about this browser
 *  at this moment. Folding it in would have forced an `Omit<>` at the one place
 *  the packet calls ONE ASSEMBLY (A1). So the data is one type, the render is
 *  the data plus the flag, and no assembly anywhere invents a value for it.
 *
 *  ⚖ A2 / F12 — and this is the whole of what the section needs from the walk.
 *  `spotTargets` drops zero-sized nodes (the right law: a hidden dial is not
 *  explained), and a collapsed `<details>` makes all nine of them zero — so a
 *  manager who folded 詳細設定 away and then pressed ? was walked through three
 *  steps instead of twelve, with the count reading 「1 / 3」 as though that were
 *  the page. The walk opens the section it is about to explain. */
export type StorePolicySectionProps = StorePolicyProps & {
  tourOpen: boolean
  /** ⚖ S17 fix round 1 · F15 — the reader's own motion preference, handed down
   *  exactly as it is to every row of the twenty-two sections: the 詳しく panels
   *  in here run on the room's ONE spring, and a spring that cannot see the
   *  preference is a spring that ignores it. */
  reduced: boolean
  /** ⚖ S17 STEP 1 — THREE SLOTS, PLACED BY THE ROOM. See the note above `main`
   *  at the bottom of the component: 設定 puts the dials in the panel, the live
   *  card at the top of its sticky stack and the 保存 block in the save slot, and
   *  a component cannot return three trees to three parents. Every dial's state
   *  stays inside this section, which is ⚖ A12 — a store switch remounts it and
   *  the dials re-seed from the new store. */
  render: (slots: StorePolicySlots) => ReactNode
}

/** ⚖ S17 STEP 1 — THIS SECTION'S OWN ANCHORS, for the room's このページの中身.
 *
 *  Every other section's jump list is built from its BLOCKS, which this section
 *  deliberately has none of: a second copy of these dials in the rail room's
 *  block vocabulary is exactly the two-rooms-at-one-path problem the fold
 *  existed to end. So the section names its own two anchors, and renders the
 *  ids on them, and the room asks the same list it renders.
 *
 *  ⚠ TWO ANCHORS, NOT NINE — and 詳細設定 IS ONE OF THEM (⚖ S17 fix round 4 ·
 *  M2). The eight dials live inside the disclosure and are not anchors of their
 *  own, because a jump item landing on a collapsed panel is the dead lever this
 *  room's own census exists to catch. That reason was written directly above an
 *  anchor pointing at the collapsible panel itself: pressing 詳細設定 in
 *  このページの中身 with the section folded scrolled the reader to a closed
 *  summary and left it closed. The anchor stays — it is a real destination and a
 *  reader looking for those dials should be able to reach them — and the jump
 *  OPENS it on the way, through `onAnchorJump`. The card is not an anchor
 *  either: it is IN the stack that holds the list. */
/** ⚖ S17 · F13 — WHAT A READER CAN TYPE TO FIND THIS SECTION.
 *
 *  Every other section is indexed from `settingsProps`' own blocks and rows.
 *  This one renders itself (⚖ A1) and has no blocks in that vocabulary, so it
 *  hands over its own sub-headings — the twelve `data-guide-title` declarations
 *  it really draws. There is still no second list: the suite pins every entry
 *  here against a declaration in this file, so a heading that is renamed or
 *  removed fails the round rather than quietly leaving the search index.
 *
 *  ⚠ NOT the jump list. `STORE_POLICY_ANCHORS` is two on purpose (⚖ D-8): the
 *  eight dials live inside a `<details>` a reader may have folded away, and a
 *  jump item landing on a collapsed panel is a dead lever. Being FINDABLE and
 *  being JUMPABLE are different questions. */
export const STORE_POLICY_HEADINGS: ReadonlyArray<string> = [
  'プリセット',
  'スタッフが見るカード',
  '詳細設定',
  '上書きの権限',
  '名指しロック',
  '長押しで確定',
  '店長のみでも警告を止める',
  'すき間の販売',
  '新規のお客様の確保',
  '確保枠の会員ランク開放',
  '予約の刻み',
  '残りわずかの目安',
  '保存',
]

export const STORE_POLICY_ANCHORS: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'bg.presets', title: 'プリセット' },
  { id: 'bg.adv', title: '詳細設定' },
]

/** What the section hands back for the room to position. */
export interface StorePolicySlots {
  /** プリセット + 詳細設定 — the panel's own reading column. */
  main: ReactNode
  /** スタッフが見るカード — the sticky stack's top on a desk, the band above the
   *  panel below it. */
  card: ReactNode
  /** #812's own 保存 block, for the save slot every section ends in (⚖ A3). */
  save: ReactNode
  /** `STORE_POLICY_ANCHORS`, handed back so the room never reaches past the
   *  section for a list the section owns. */
  jump: ReadonlyArray<{ id: string; title: string }>
  /** ⚖ S17 fix round 4 · M2 — WHAT THE SECTION HAS TO DO BEFORE A JUMP LANDS.
   *
   *  詳細設定 IS the collapsible one, and a jump item that lands on a folded
   *  panel is the dead lever this room's own census exists to catch: the reader
   *  was scrolled to a closed summary they then had to press. The fold's state
   *  belongs to this section (⚖ A12), so the room cannot open it — and reaching
   *  into the DOM for `details.open` would fight the React state that owns it.
   *  The section hands back the one call instead, and the room's `jumpTo` makes
   *  it first. An anchor with nothing to prepare is a no-op. */
  onAnchorJump: (id: string) => void
}

// ── the mock's own presets ───────────────────────────────────────────────────

type Perm = 'staff' | 'approve' | 'manager'
type Rank = StorePolicyProps['policy']['heldRankAccess']
/** One dial state, and the mock's own key set — 名指しロック is deliberately NOT
 *  in it (see `PRESETS`). */
interface Dials { perm: Perm; hold: boolean; mode: GapGuardMode; gaps: boolean; minutes: number; rank: Rank; slot: number }

/** ⚖ the mock's three presets, value for value. 名指しロック is a PER-PERSON
 *  exception rather than a policy dial, so it lives outside this set and
 *  choosing a preset never silently frees a locked staff member — the mock's own
 *  adjudicated rule, carried. */
const PRESETS: Record<string, Dials> = {
  auto: { perm: 'staff', hold: true, mode: 'STANDARD', gaps: true, minutes: 90, rank: 'closed', slot: 30 },
  trust: { perm: 'staff', hold: false, mode: 'STANDARD', gaps: true, minutes: 90, rank: 'closed', slot: 30 },
  watch: { perm: 'manager', hold: true, mode: 'STRICT', gaps: true, minutes: 90, rank: 'closed', slot: 30 },
}

const PRESET_CARDS: Array<{ key: string; name: string; lines: string[] }> = [
  { key: 'auto', name: 'おまかせ（標準）', lines: ['スタッフも置けます。ただし確保枠を壊す場所では、長押しの確認が入ります。'] },
  { key: 'trust', name: 'スタッフに任せる', lines: ['スタッフがそのまま置けます。長押しの確認はありません。', '回転の速いお店向け。上書きは記録に残ります。'] },
  { key: 'watch', name: '店長がしっかり見る', lines: ['確保枠を壊す場所に置けるのは店長だけです。', 'スタッフには安全な時間の提案だけが出て、確定はできません。'] },
]

const RANK_OPTIONS: Array<[Rank, string]> = [
  ['closed', '開放しない'],
  ['silver', 'シルバー以上'],
  ['gold', 'ゴールド以上'],
  ['platinum', 'プラチナ以上'],
]

/** ⚖ D-15 — THE FLOOR, SHARED BY BOTH FREE-MINUTE FIELDS IN THIS SECTION
 *  (予約の刻み and 新規のお客様の確保): any positive integer's smallest member.
 *  Not a step — the old 5-minute granularity is gone, the ± buttons below move
 *  by `NUDGE_MIN` as a convenience only, and typing is free. Each field's
 *  CEILING is `props.dayLenMin`, the store's own operating day — read at the
 *  call site, never spelled here. */
const SLOT_MIN = 1
/** The ± buttons' own step — a convenience default, never a cap: nothing stops
 *  a typed value that is not a multiple of it. */
const NUDGE_MIN = 5

/** 残りわずかの目安's bounds — READ FROM THE DIAL'S OWN HOME, never spelled here
 *  (⚖ Liam 9/12). The board's paint, this room's stepper and its blur commit all
 *  hold the same guardrail because there is only one of it. 0 is inside it on
 *  purpose: it is how a store turns the 橙 tier off. */
const { min: TIGHT_MIN, max: TIGHT_MAX } = CALENDAR_TIGHT_RANGE

/** The mock's own honest note for a dial core has no field for yet
 *  (⚠SETTINGS-BATCH). ONE sentence, reused, so eight rows cannot drift into
 *  eight different promises. */
const PENDING_NOTE = 'この設定はまだ保存できません。画面での動きだけ確認できます'
/** ⚖ D-28 — THE ONE WARN SENTENCE, all three free-text fields. Byte-identical
 *  to the blind native pass (JP-NATIVE-R3/A1-WARN-LINE.md): ⚖ D-27 keeps what
 *  was typed on screen, so the old sentence — which claimed the non-digit
 *  characters had just been erased — was describing something that no longer
 *  happens. */
const NON_DIGIT_WARN = '数字以外は保存されません。欄を離れると前の値に戻ります'
/** The padlock the approved warn card opens its provenance line with — the same
 *  path today.css's own card draws, so the preview is the card. */
const WC_LOCK_PATH = 'M4 7V5a4 4 0 018 0v2h1v8H3V7h1zm2 0h4V5a2 2 0 10-4 0v2z'

export function StorePolicySection(props: StorePolicySectionProps) {
  const { policy, sample } = props

  // ── the dials ─────────────────────────────────────────────────────────────
  // Seeded from the STORE's own values, never from a preset: a store whose dials
  // match no preset opens on カスタム, which is the truth about it.
  const [perm, setPerm] = useState<Perm>(policy.overrideRoles.includes(props.sampleStaffRole) ? 'staff' : 'manager')
  const [hold, setHold] = useState(policy.holdToConfirm)
  // ⚖ 9/1 (fix round 1 F4) — the WHOLE enum, so a store that arrives OFF stays
  // OFF until the operator presses one of the dial's two positions on purpose.
  const [mode, setMode] = useState<GapGuardMode>(policy.mode)
  const [gaps, setGaps] = useState(policy.gapSelling)
  // ⚖ D-15 — 新規のお客様の確保 IS NOW 予約の刻み'S OWN SHAPE: TEXT while typing
  // (`minutesText`), a COMMITTED number the scene/card actually read (`minutes`,
  // changed only on blur — see the render leg in PKT-BUILD-R3-A1.md commit 2),
  // and the same last-good/warn/message trio the field beside it uses.
  const [minutesText, setMinutesText] = useState(String(policy.newClientMinutes))
  const [minutes, setMinutes] = useState(policy.newClientMinutes)
  const [minutesWarn, setMinutesWarn] = useState(false)
  const [minutesMsg, setMinutesMsg] = useState<string | null>(null)
  const lastGoodMinutes = useRef(clampSlot(Number(minutesText), props.dayLenMin))
  const [rank, setRank] = useState<Rank>(policy.heldRankAccess)
  // 予約の刻み is held as TEXT while it is being typed — a half-typed 「1」 on the
  // way to 「15」 must not clamp itself to 5 under the operator's fingers. The
  // committed number is `slotMin` below, and it is what everything else reads.
  const [slotText, setSlotText] = useState(String(policy.bookingStepMin))
  const [slotWarn, setSlotWarn] = useState(false)
  /** ⚖ S17 fix round 4 · M4 — what this field last held that the guardrail
   *  accepted, so an EMPTY box on blur can be handed back rather than becoming
   *  the floor. Tracked from the value, so the ± stepper and a preset that
   *  rewrites the field are remembered the same way typing is. */
  const [slotMsg, setSlotMsg] = useState<string | null>(null)
  const lastGoodSlot = useRef(clampSlot(Number(slotText), props.dayLenMin))
  /** ⚖ Liam 9/12 — 残りわずかの目安, held exactly like 予約の刻み above it: TEXT
   *  while it is being typed (a half-typed 「1」 on the way to 「4」 must not
   *  commit itself under the operator's fingers), committed on blur, with the
   *  last accepted value remembered so an emptied box is handed back rather than
   *  becoming the floor — and this field's floor is 0, which would switch the
   *  橙 tier off without anyone choosing that. */
  const [tightText, setTightText] = useState(String(policy.calendarTightMax))
  const [tightWarn, setTightWarn] = useState(false)
  const [tightMsg, setTightMsg] = useState<string | null>(null)
  const lastGoodTight = useRef(clampCalendarTight(policy.calendarTightMax))
  const [locks, setLocks] = useState<string[]>(policy.lockedOut)
  const [lockPick, setLockPick] = useState('')
  /** ⚖ S17 fix round 1 · F15 — WHICH DIALS HAVE THEIR 詳しく OPEN.
   *  The room's own rows fold 初期値・決まり・出どころ behind 詳しく and keep the
   *  ONE-LINE description on the face; these eight stacked three and four
   *  caveat lines under every control at every width instead, so the section
   *  read a notch denser and a notch smaller than the twenty-two around it.
   *  Same grammar now, same spring, same closed-by-default. */
  const [detOpen, setDetOpen] = useState<Record<string, boolean>>({})
  const toggleDet = (id: string) => setDetOpen((was) => ({ ...was, [id]: !was[id] }))
  // The preview's sample operator — the mock's 見本の操作者 segment.
  const [op, setOp] = useState<'staff' | 'manager'>('staff')
  /** ⚖ 9/1 (fix round 1 F12) — 詳細設定 IS CONTROLLED, so the tour can open it.
   *  `spotTargets` drops zero-sized nodes (which is the right law: a hidden dial
   *  is not explained), and a collapsed `<details>` makes all nine of them zero —
   *  so a manager who folded the section away and then pressed ? was walked
   *  through 3 steps instead of 12, with the count reading 「1 / 3」 as though
   *  that were the page. The walk opens the section it is about to explain. */
  const [advOpen, setAdvOpen] = useState(true)

  /** ⚖ A2 / F12 — the invariant, carried onto the shell's walk. #812 forced
   *  詳細設定 open from its own ? handler (`onClick={() => { setAdvOpen(true);
   *  setTourIdx(0) }}`); the ? now belongs to 設定, so the section answers the
   *  walk instead of launching it. Same guarantee, one owner.
   *
   *  ⚖ S17 fix round 4 · M3 — AND IT PUTS THE PAGE BACK. The walk is a READ-ONLY
   *  action: a manager who folded 詳細設定 away, pressed ?, read four steps and
   *  pressed Escape came back to a page they had not left it as. F12 has to
   *  force the fold open — nine dials inside a closed `<details>` measure zero
   *  and drop out of the count — but forcing it open is a loan, not a decision.
   *
   *  ⚠ UNLESS THE READER CHANGED IT DURING THE WALK, which is the one case where
   *  restoring would be the rude answer: if 詳細設定 is CLOSED when the tour
   *  ends, that is the reader's own press and it stands. Only a fold still
   *  standing open — the state the tour itself put there — is handed back. */
  const advOpenRef = useRef(advOpen)
  useEffect(() => { advOpenRef.current = advOpen }, [advOpen])
  const beforeTour = useRef<boolean | null>(null)
  useEffect(() => {
    if (props.tourOpen) {
      beforeTour.current = advOpenRef.current
      setAdvOpen(true)
      return
    }
    const was = beforeTour.current
    if (was === null) return
    beforeTour.current = null
    setAdvOpen((now) => (now ? was : now))
  }, [props.tourOpen])

  // ⚖ D-27 — `lastGood*` moves ONLY on a commit (blur / nudge / preset /
  // initial), never on a keystroke. The three effects that used to update it
  // on every valid keystroke are gone; each `lastGood*.current =` assignment
  // now sits beside the committed-value set it belongs to.

  const dials: Dials = { perm, hold, mode, gaps, minutes: Number(minutesText), rank, slot: Number(slotText) }
  const activePreset =
    Object.keys(PRESETS).find((k) => {
      const p = PRESETS[k]
      return p.perm === dials.perm && p.hold === dials.hold && p.mode === dials.mode &&
        p.gaps === dials.gaps && p.minutes === dials.minutes && p.rank === dials.rank && p.slot === dials.slot
    }) ?? null

  function choosePreset(key: string) {
    const p = PRESETS[key]
    setPerm(p.perm); setHold(p.hold); setMode(p.mode); setGaps(p.gaps)
    // A preset press is a commit, not typing — both the text and the value the
    // scene reads move together, same as every other dial a preset sets.
    setMinutesText(String(p.minutes)); setMinutes(p.minutes); setMinutesWarn(false); setMinutesMsg(null)
    lastGoodMinutes.current = p.minutes
    setRank(p.rank); setSlotText(String(p.slot))
    lastGoodSlot.current = p.slot
  }

  /** ⚖ D-26 N1 — A NUDGE IS A COMMIT TOO, same as `choosePreset` above: the
   *  manager clicked a BUTTON, not a keystroke, so there is no blur coming to
   *  reconcile typed vs committed. Before this fix the ± handlers moved only
   *  `minutesText`, leaving `minutesPending` true forever after one press — the
   *  card kept the old length and the line underneath told the manager to
   *  「欄を離れる」 a field they were never in. `commitMinutes` is the same pure
   *  function `onBlur` already calls; a nudge just supplies its own candidate
   *  instead of the typed text. 予約の刻み has no separate committed state
   *  (`dials.slot` reads `slotText` directly, so its old nudge already took
   *  effect at once) — it still routes through `commitMinutes` here so both
   *  fields share one shape and one message/clamp behaviour. */
  function nudgeMinutes(delta: number) {
    const next = clampSlot(nudgeBase(minutesText, lastGoodMinutes.current, SLOT_MIN) + delta, props.dayLenMin)
    const commit = commitMinutes(String(next), lastGoodMinutes.current, props.dayLenMin)
    lastGoodMinutes.current = commit.value
    setMinutesText(String(commit.value)); setMinutes(commit.value); setMinutesWarn(false); setMinutesMsg(commit.message)
  }
  function nudgeSlot(delta: number) {
    const next = clampSlot(nudgeBase(slotText, lastGoodSlot.current, SLOT_MIN) + delta, props.dayLenMin)
    const commit = commitMinutes(String(next), lastGoodSlot.current, props.dayLenMin)
    lastGoodSlot.current = commit.value
    setSlotText(String(commit.value)); setSlotWarn(false); setSlotMsg(commit.message)
  }
  // ── the live preview ──────────────────────────────────────────────────────

  /** ⚖ WHO the preview is standing in for. The スタッフ seat is the sample
   *  landing's OWN lane owner at the role the store's data calls non-manager
   *  (`sampleStaffRole`, derived server-side from the override dial minus the
   *  manager-level list); the 店長 seat is the real operator, at their real role.
   *  Neither role is spelled in this file. */
  const previewOp =
    sample === null || op === 'manager'
      ? props.operator
      : { name: sample.laneLabel, role: props.sampleStaffRole, staff_id: sample.laneKey }

  /** ⚖ ruling 91's three levels. `overrideLevelFor` is the board's own consult
   *  and answers `lockedOut` FIRST — a store that named a person has named them
   *  whatever their role says — so the 名指しロック chips are live in the preview
   *  without this file re-deciding anything.
   *
   *  'needs-approval' is the one level that consult cannot RETURN (its comment
   *  says why: a real request→approve moment needs server-backed request state
   *  this board does not have), and `warnFaceFor`'s own note says the face 「exists
   *  so the settings round LIGHTS it rather than inventing it」. This is that
   *  lighting, and it lights nothing else: the level is composed here, for the
   *  preview only, and no policy value anywhere can produce it. */
  // ponytail: no memo. This is a pure fold over four values the render above
  // just settled, and `previewOp` is a fresh object every pass — a memo here
  // would buy nothing and would need that object as a dep, which is the
  // stale-answer trap TodayScreen's own composer avoids for the same reason.
  const level: OverrideLevel = (() => {
    const roles = perm === 'manager' ? policy.managerRoles : [...policy.managerRoles, props.sampleStaffRole]
    const base = overrideLevelFor({ roles, lockedOut: locks }, previewOp)
    return perm === 'approve' && base === 'allow-warned' ? 'needs-approval' : base
  })()

  /** ⚖ 9/1 (fix round 1 F4) — WHETHER THERE IS A SCENE TO PREVIEW AT ALL: the
   *  guard is OFF for this store, so there is no verdict to preview and the
   *  card below is not drawn. The seam still owns the OFF answer (`null`), so
   *  this screen and `computeScene` cannot disagree about what OFF means —
   *  ⚖ D-25 F2: `computeScene`'s own cell branch asks `sceneKeyFor` too now,
   *  the same call this line makes, so the claim is true by construction and
   *  not merely by two spellings agreeing today. */
  const guardOff = sceneKeyFor(mode, minutes) === null
  /** ⚖ 9/1 (fix round 1 F4b) — AND AT OFF THE CAPACITY IS STILL THE REAL ONE.
   *  A `{ capacity: 0 }` fallback would print the amber 「この長さでは…ひとつも
   *  作れません（0枠）」 at every OFF store — a room-tight alarm about a day that
   *  is not tight, invented rather than measured. `computeScene` asks the
   *  engine under STANDARD regardless of `mode` (the number does not depend on
   *  it at all), so the honest one is right there even with the guard off, and
   *  `cell` stays `null` so the card stays suppressed. It is also the point of
   *  the line at OFF — 作れます is a potential, true in every mode, and an
   *  owner deciding whether to switch the guard ON deserves to see what the
   *  day can hold BEFORE they switch it (⚖ 8/21 mistake-proofing).
   *
   *  ⚖ D-15 — COMMITTED, NOT TYPED. `minutes` is the last BLURRED value (see
   *  the field below), so a keystroke mid-edit never repaints this line or the
   *  card — only a completed commit does, exactly like every other engine read
   *  in this room. */
  const scene = useMemo(() => computeScene(props.sceneInput, mode, minutes), [props.sceneInput, mode, minutes])
  /** ⚖ D-25 F4 — THE BOX CAN READ SOMETHING THE CARD HAS NOT SEEN YET. The
   *  typed value already drives the preset chip (`dials.minutes`, above); the
   *  capacity line below still read the OLD committed `minutes` mid-edit, so a
   *  manager could type 100, watch プリセット flip to カスタム, and read 90分's
   *  count beside it as the answer to what they just typed (⚖ 8/21
   *  mistake-proofing: staff CAN'T err). No new state — this is the same
   *  `minutesText`/`minutes` pair already held, compared at render. */
  const minutesPending = minutesText.trim() !== String(minutes)

  /** THE CARD, composed by the BOARD'S OWN function. Every branch of it —
   *  the three faces, the hold/press/approval commit, the provenance line, the
   *  safe answer, the ¥ — is `warnFaceFor`'s; this room decides nothing about
   *  what a staff member sees, which is the only way a preview can be trusted. */
  const card = sample === null || guardOff ? null : warnFaceFor({
    rows: sample.rows,
    cell: scene.cell,
    // The preview stages a landing directly; nothing was walked past on the way,
    // so there is no overridden sentence to carry.
    override: null,
    level,
    holdToConfirm: hold,
    targetLaneMine: previewOp.staff_id === sample.laneKey,
    operatorName: previewOp.name,
    listPrice: sample.listPrice,
    frame: sample.frame,
    depth: sample.depth,
    protectedDur: minutes,
    confirmEnabled: sample.confirmEnabled,
  })
  // ── 名指しロック ──────────────────────────────────────────────────────────

  /** ⚖ 8/21 MISTAKE-PROOFING — A STORE MAY NOT LOCK OUT EVERYONE
   *  (`fixtures-today.ts`'s own guardrail, named where the dial was specified).
   *  The last un-locked person on the roster cannot be added, and the control
   *  says so instead of going quietly dead. */
  const lockable = props.roster.filter((s) => !locks.includes(s.id))
  /** ⚖ 9/1 (fix round 1 F14) — AND AN EMPTY ROSTER IS NOT A STORE DOWN TO ITS
   *  LAST PERSON. `<= 1` answered TRUE at zero, so a lens with no staff at all
   *  printed 「全員を名指しロックにはできません」 and disabled 追加 — a guardrail
   *  firing about people who are not there, over a picker that is empty anyway. */
  const lastOneStanding = props.roster.length > 0 && lockable.length <= 1
  /** ⚖ 8/17 STORE ISOLATION (fix round 1 F14) — A FOREIGN staff_id NEVER RENDERS.
   *  `lockedOut` is the STORE POLICY's list and this screen is opened under one
   *  store's lens, so an id belonging to another store's roster found no name and
   *  fell back to printing the raw key — 「p-05 ×」 — which is precisely the
   *  existence the isolation law hides. Filtered for DISPLAY only: the id stays in
   *  `locks`, so nothing this screen does erases a lock it is not allowed to show. */
  const rosterIds = new Set(props.roster.map((s) => s.id))
  const shownLocks = locks.filter((id) => rosterIds.has(id))
  const nameOf = (id: string) => props.roster.find((s) => s.id === id)?.name ?? id

  // ⚖ S17 STEP 1 — THE SECTION HANDS BACK THREE SLOTS, and the room places
  // them. #812 shipped as a whole route, so its presets, its live card and its
  // 保存 block were one tree in one column; inside 設定 they belong in three
  // different places — the dials in the panel, the card at the top of the
  // sticky stack beside it, the 保存 block in the save slot every section ends
  // in. A component cannot return three trees to three parents, and lifting the
  // dial state out would break ⚖ A12 (the state is the section's, and remounts
  // with it), so the section keeps ALL of its state and hands the room the three
  // nodes to position. Nothing about what each node CONTAINS changed.
  /* ============ presets ============ */
  const presets = (
      <section
        className="st-col-presets"
        id="st-blk-bg.presets"
        aria-labelledby="st-blkh-bg.presets"
        data-guide-title="プリセット"
        data-guide="よくある決め方を3つ用意しています。押すと下の詳細設定がまとめて切り替わります。名指しロックだけは個人ごとの例外なので、プリセットでは変わりません。"
      >
        <div className="st-sec-h">
          {/* ⚠ THE JUMP LANDS ON THE HEADING ITSELF (⚖ S17 fix round 4 · H4).
              This anchor used to be a 0×0 `aria-hidden="true"` span beside the
              label, and `jumpTo` focused it — so pressing プリセット in
              このページの中身 moved a keyboard reader's caret onto a node the
              screen reader is told does not exist, and said nothing (axe's
              `aria-hidden-focus`). Every other block in this room lands on its
              own `<h3 tabIndex={-1}>` with real text; this one anchor was the
              exception, and there was no reason for it — the heading was right
              there. It also NAMES the section (`aria-labelledby`), so the two
              jobs are one element instead of two. */}
          <h3 className="st-sec-l" id="st-blkh-bg.presets" tabIndex={-1}>プリセット</h3>
          {activePreset === null && <span className="st-chip custom">カスタム</span>}
        </div>
        <p className="st-sec-d">よくある決め方を3つ用意しました。選ぶと、下の詳細設定がまとめて変わります。</p>
        <div className="st-presets">
          {PRESET_CARDS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`st-pcard${activePreset === p.key ? ' on' : ''}`}
              aria-pressed={activePreset === p.key}
              onClick={() => choosePreset(p.key)}
            >
              <span className="st-pcard-n">{p.name}</span>
              {p.lines.map((line) => <span className="st-pcard-s" key={line}>{line}</span>)}
              <span className="st-pcard-h">詳細設定で個別に変更できます</span>
            </button>
          ))}
        </div>
      </section>
  )

  /* ============ the live card preview ============ */
  const cardSlot = (
      <section
        className="st-col-preview"
        aria-labelledby="stPreviewLabel"
        data-guide-title="スタッフが見るカード"
        data-guide="いまの設定で、確保枠を壊す場所に予約を置こうとしたスタッフに出るカードです。表示だけで、ここから予約は動きません。見本の操作者を切り替えると、権限による見え方の違いも確認できます。"
      >
        <div className="st-sec-h">
          <p className="st-sec-l" id="stPreviewLabel">スタッフが見るカード</p>
          <span className="st-chip">表示のみ</span>
        </div>

        <div className="st-pv-op">
          <p className="st-ctrl-l" id="stOpLabel">見本の操作者</p>
          <div className="sp-seg" role="group" aria-labelledby="stOpLabel">
            <button type="button" className={op === 'staff' ? 'on' : undefined} aria-pressed={op === 'staff'} onClick={() => setOp('staff')}>スタッフ</button>
            <button type="button" className={op === 'manager' ? 'on' : undefined} aria-pressed={op === 'manager'} onClick={() => setOp('manager')}>店長</button>
          </div>
          <p className="st-ctrl-d">誰がこの操作をしているかで、出てくるカードが変わります</p>
        </div>

        {guardOff ? (
          // ⚖ 9/1 (fix round 1 F4) — AND AN OFF STORE SAYS SO. `gap_guard_mode`
          // has a third state, and a store that turned the 確保 guard off has
          // no warning card at all — not a standard one. Its own sentence,
          // rather than a scene borrowed from the mode next door.
          <p className="st-pv-none">この店舗では、確保枠の見張りそのものを止めています。詳細設定の「店長のみでも警告を止める」でONかOFFを選ぶと、ここにスタッフが見るカードが出ます。</p>
        ) : sample === null || card === null ? (
          // ⚖ HONEST WHEN THERE IS NOTHING TO SHOW. No landing on this
          // store's day costs it a protected window, so there is no warning
          // card to preview — said out loud rather than drawn from a scene
          // this room invented.
          <p className="st-pv-none">いまの1日には、確保枠を壊してしまう配置がありません。設定を変えると、ここにスタッフが見るカードが出ます。</p>
        ) : (
          /* ⚖ 9/1 (fix round 1 F2) — `role="img"` IS DELETED. ARIA img is
             children-presentational, so the whole card — the impact line, the
             ¥, the provenance, the commit label, the check rows — collapsed
             into its own 12-character label for a screen reader: the manager
             asking 「what will my staff actually see?」 was answered 「a
             picture」. It is the exact pattern ⚖ flag 44(3) took off the
             board's own rail. `group` keeps the region NAMED and leaves every
             child readable. */
          <div className="hold-pop st-pv-card" role="group" aria-label="スタッフが見るカードの見本">
            <div className="hp-head">
              <span className="status waiting">仮押さえ</span>
              <strong>{sample.summary}</strong>
            </div>
            {card.face === 'warn' ? (
              <>
                {card.impact.head && (
                  <p className="wc-impact">
                    {card.impact.head}
                    {card.impact.yen && <span className="wc-yen">（{card.impact.yen}）</span>}
                    {card.impact.tail}
                  </p>
                )}
                {card.provenance && (
                  <p className="wc-prov">
                    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d={WC_LOCK_PATH} fill="currentColor" /></svg>
                    <span>{card.provenance}</span>
                  </p>
                )}
                {card.safePrimary?.kind === 'place' && (
                  <span className="btn primary wc-safe">
                    <span className="wc-safe-main">{card.safePrimary.main}</span>
                    <span className="wc-safe-sub">{card.safePrimary.sub}</span>
                  </span>
                )}
                {card.commit?.kind === 'hold' && (
                  <span className={`wc-hold${card.commit.enabled ? '' : ' st-off'}`}>
                    <span className="wc-hold-clip" aria-hidden="true"><span className="wc-hold-fill" /></span>
                    <span className="wc-hold-text">{card.commit.label}</span>
                  </span>
                )}
                {card.commit?.kind === 'press' && (
                  <span className={`btn wc-warn-btn${card.commit.enabled ? '' : ' st-off'}`}>{card.commit.label}</span>
                )}
                {card.commit?.kind === 'approval' && (
                  <span className={`btn wc-approve${card.commit.enabled ? '' : ' st-off'}`}>{card.commit.label}</span>
                )}
                {card.commit?.note && <p className="wc-note">{card.commit.note}</p>}
                {card.lock && (
                  <p className="wc-lock">
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d={WC_LOCK_PATH} fill="currentColor" /></svg>
                    <span>{card.lock}</span>
                  </p>
                )}
                {card.greensLine && <p className="wc-greens">{card.greensLine}</p>}
                {card.rows.length > 0 && (
                  <div className="holdbar-checks wc-rows">
                    {card.rows.map((c) => <span className={`ck${c.tone ? ` ${c.tone}` : ''}`} key={c.label}>{c.label}</span>)}
                  </div>
                )}
                <div className="hp-actions wc-foot"><span className="btn">元に戻す</span></div>
              </>
            ) : (
              // The CLEAN face, byte-identical to the one the board ships:
              // the check strip and the two buttons, nothing else.
              <>
                <div className="holdbar-checks">
                  {card.rows.map((c) => <span className={`ck${c.tone ? ` ${c.tone}` : ''}`} key={c.label}>{c.label}</span>)}
                </div>
                <div className="hp-actions">
                  <span className="btn primary">この内容で確定</span>
                  <span className="btn">元に戻す</span>
                </div>
              </>
            )}
          </div>
        )}

        <p className="st-pv-cap">設定を変えると、スタッフが見るカードがその場で変わります</p>
        <p className="st-pv-cap dim">すき間の販売・会員ランク・予約の刻みは、このカードには出ません</p>
      </section>
  )

  /* ============ 詳細設定 ============ */
  const adv = (
      <div className="st-col-adv" id="st-blk-bg.adv">
        <details className="st-adv" open={advOpen} onToggle={(e) => setAdvOpen(e.currentTarget.open)}>
          <summary id="st-blkh-bg.adv"><span className="st-caret" aria-hidden="true" />詳細設定<span className="st-sum-d">一つずつ変えられます</span></summary>

          {/* a. 上書きの権限 */}
          <section
            className="st-row st-dial"
            aria-labelledby="stPermLabel"
            data-guide-title="上書きの権限"
            data-guide="確保枠を壊す場所に、誰が自分の権限で置けるかを決めます。下の「店長のみでも警告を止める」がOFFのあいだは、権限のないスタッフも確認のうえで置けます。ONにすると、権限のないスタッフは確定できなくなります。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stPermLabel">上書きの権限</h3></div>
              <p className="st-dial-desc">確保枠を壊す場所に、誰が自分の権限で置けるか</p>
              <DetailToggle open={detOpen['perm'] === true} controls="st-det-bg.perm" onToggle={() => toggleDet('perm')} />
            </div>
            <div className="st-dial-ctl">
              <div className="sp-seg" role="group" aria-labelledby="stPermLabel">
                <button type="button" className={perm === 'staff' ? 'on' : undefined} aria-pressed={perm === 'staff'} onClick={() => setPerm('staff')}>スタッフOK</button>
                <button type="button" className={perm === 'approve' ? 'on' : undefined} aria-pressed={perm === 'approve'} onClick={() => setPerm('approve')}>店長の承認</button>
                <button type="button" className={perm === 'manager' ? 'on' : undefined} aria-pressed={perm === 'manager'} onClick={() => setPerm('manager')}>店長のみ</button>
              </div>
            </div>
            {/* ⚖ 9/1 (fix round 1 F1) — AND IT SAYS WHAT THIS DIAL DOES IN
                BOTH STRICT STATES. 「誰が置けるか」 was false at the loosened
                setting: ⚖ ruling 1/2 lets everyone place through a merely
                costly landing, and what this dial changes there is WHOSE
                authority the record carries. It becomes a wall only when the
                dial below is ON, and that is the half worth naming — a
                manager reading one sentence about two states deserves both. */}
            <Collapse open={detOpen['perm'] === true} id="st-det-bg.perm" reduced={props.reduced}>
              <ul className="st-det">
                <li className="st-det-rail">下の「店長のみでも警告を止める」がOFFのあいだは、権限のないスタッフも確認のうえで置けます（操作した人の名前が記録に残ります）。ONにすると、権限のないスタッフは確定できなくなります</li>
                <li className="st-det-src"><span className="st-chip">準備中</span>「店長の承認」の承認フローは、近日追加予定です</li>
                <li className="st-det-src"><span className="st-chip">準備中</span>{PENDING_NOTE}</li>
              </ul>
            </Collapse>
          </section>

          {/* b. 名指しロック */}
          <section
            className="st-row st-dial"
            aria-labelledby="stLockLabel"
            data-guide-title="名指しロック"
            data-guide="いつも注意が必要な場所に置いてしまうスタッフを、名前で指定して止められます。プリセットでは変わらない、個人ごとの例外です。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stLockLabel">名指しロック</h3></div>
              <p className="st-dial-desc">名指しされたスタッフは、注意が必要な場所に置けなくなります</p>
              <DetailToggle open={detOpen['lock'] === true} controls="st-det-bg.lock" onToggle={() => toggleDet('lock')} />
            </div>
            <div className="st-dial-ctl st-dial-ctl-stack">
              <div className="st-locks">
                {shownLocks.length === 0
                  ? <span className="st-locks-empty">まだ誰も指定していません</span>
                  : shownLocks.map((id) => (
                      <span className="st-lockchip" key={id}>
                        {nameOf(id)}
                        <button type="button" aria-label={`${nameOf(id)} を名指しロックから外す`} onClick={() => setLocks((was) => was.filter((x) => x !== id))}>×</button>
                      </span>
                    ))}
            </div>
            <div className="st-lockadd">
              {/* ⚖ MOCK DEVIATION, and the reason is the data: `lockedOut` is
                  keyed by staff_id, and a typed NAME cannot produce one. The
                  mock's free-text field would either mis-key or need a
                  matcher that guesses at people. A roster picker is the same
                  control with no way to get it wrong (⚖ 8/21 — staff CAN'T
                  err at the moment of the action). */}
              <select value={lockPick} onChange={(e) => setLockPick(e.target.value)} aria-label="名指しロックに追加するスタッフ">
                <option value="">スタッフを選ぶ</option>
                {lockable.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}
              </select>
              <button
                type="button"
                className="st-btn-add"
                disabled={lockPick === '' || lastOneStanding}
                onClick={() => { setLocks((was) => [...was, lockPick]); setLockPick('') }}
              >
                追加
              </button>
            </div>
            </div>
            {/* ⚠ A WARNING STAYS ON THE FACE. 詳しく folds CONTEXT a manager opens
                while changing a dial; 「why can I not do this」 is read before the
                press — the room's own M5 law for a lock reason, applied to the
                one line here that is a refusal rather than a note. */}
            {lastOneStanding && <p className="st-ctrl-d warn">全員を名指しロックにはできません。少なくとも一人は置ける人が必要です</p>}
            <Collapse open={detOpen['lock'] === true} id="st-det-bg.lock" reduced={props.reduced}>
              <ul className="st-det">
                <li className="st-det-rail">名指しロックは、プリセットとは別の個人ごとの例外です</li>
                <li className="st-det-src"><span className="st-chip">準備中</span>{PENDING_NOTE}</li>
              </ul>
            </Collapse>
          </section>

          {/* c. 長押しで確定 */}
          <section
            className="st-row st-dial"
            aria-labelledby="stHoldLabel"
            data-guide-title="長押しで確定"
            data-guide="注意が必要な場所に置くときだけ、確定を長押しにします。ふつうの確定はどの設定でもタップのままです。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stHoldLabel">長押しで確定</h3></div>
              {/* The sentence ⚖ 92 wrote for this dial, in `fixtures-today.ts`,
                  carried word for word so the settings round does not invent a
                  second description of one switch. */}
              <p className="st-dial-desc">注意が必要な場所への配置に、0.6秒の長押しを求めます</p>
              <DetailToggle open={detOpen['hold'] === true} controls="st-det-bg.hold" onToggle={() => toggleDet('hold')} />
            </div>
            <div className="st-dial-ctl">
              <div className="sp-seg" role="group" aria-labelledby="stHoldLabel">
                <button type="button" className={hold ? 'on' : undefined} aria-pressed={hold} onClick={() => setHold(true)}>ON</button>
                <button type="button" className={!hold ? 'on' : undefined} aria-pressed={!hold} onClick={() => setHold(false)}>OFF</button>
              </div>
            </div>
            <Collapse open={detOpen['hold'] === true} id="st-det-bg.hold" reduced={props.reduced}>
              <ul className="st-det">
                <li className="st-det-src"><span className="st-chip">準備中</span>{PENDING_NOTE}</li>
              </ul>
            </Collapse>
          </section>

          {/* d. 店長のみでも警告を止める — core `gap_guard_mode` STRICT */}
          <section
            className="st-row st-dial"
            aria-labelledby="stStrictLabel"
            data-guide-title="店長のみでも警告を止める"
            data-guide="ONにすると、権限のないスタッフは注意が必要な場所に確定できなくなります。カードには安全な時間の提案と元に戻すだけが残ります。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stStrictLabel">店長のみでも警告を止める</h3></div>
              <p className="st-dial-desc">ONにすると、権限のないスタッフは注意が必要な場所に確定できなくなります（安全な時間の提案と元に戻すだけになります）</p>
            </div>
            {/* ⚖ 9/1 (fix round 1 F4) — THREE STATES, TWO BUTTONS, AND NO
                FABRICATED POSITION. A store whose guard is OFF is neither ON
                nor OFF on this dial, so neither button is pressed and the
                line below says why — rather than lighting OFF, which would
                read as 「the guard is running, without the wall」 and would
                quietly turn the guard ON the moment anything saved. */}
            <div className="st-dial-ctl">
              <div className="sp-seg" role="group" aria-labelledby="stStrictLabel">
                <button type="button" className={mode === 'STRICT' ? 'on' : undefined} aria-pressed={mode === 'STRICT'} onClick={() => setMode('STRICT')}>ON</button>
                <button type="button" className={mode === 'STANDARD' ? 'on' : undefined} aria-pressed={mode === 'STANDARD'} onClick={() => setMode('STANDARD')}>OFF</button>
              </div>
            </div>
            {guardOff && <p className="st-ctrl-d warn">いまこの店舗は、確保枠の見張りそのものを止めています。ONとOFFのどちらを押しても、見張りは動き出します</p>}
          </section>

          {/* e. すき間の販売 */}
          <section
            className="st-row st-dial"
            aria-labelledby="stGapsLabel"
            data-guide-title="すき間の販売"
            data-guide="予約と予約のあいだに残った短い空き時間を、そのまま予約枠として売るかどうかです。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stGapsLabel">すき間の販売</h3></div>
              <p className="st-dial-desc">短い空き時間も予約枠として販売します</p>
              <DetailToggle open={detOpen['gaps'] === true} controls="st-det-bg.gaps" onToggle={() => toggleDet('gaps')} />
            </div>
            <div className="st-dial-ctl">
              <div className="sp-seg" role="group" aria-labelledby="stGapsLabel">
                <button type="button" className={gaps ? 'on' : undefined} aria-pressed={gaps} onClick={() => setGaps(true)}>ON</button>
                <button type="button" className={!gaps ? 'on' : undefined} aria-pressed={!gaps} onClick={() => setGaps(false)}>OFF</button>
              </div>
            </div>
            <Collapse open={detOpen['gaps'] === true} id="st-det-bg.gaps" reduced={props.reduced}>
              <ul className="st-det">
                {/* ⚖ S17 · C12 — the receipt, not a second dial. 店舗情報・営業時間's
                    own 販売可能な最小の長さ control moved here as this ON/OFF; the
                    number it was set to is still the number 今日の運営 uses, so the
                    row says it instead of leaving the manager to wonder from how
                    short a gap counts. */}
                <li className="st-det-src">販売可能な最小の長さ {props.policy.minSellableMin}分（今日の運営の値）</li>
                <li className="st-det-src"><span className="st-chip">準備中</span>{PENDING_NOTE}</li>
              </ul>
            </Collapse>
          </section>

          {/* f. 新規のお客様の確保 — core `new_client_session_minutes` */}
          <section
            className="st-row st-dial"
            aria-labelledby="stMinutesLabel"
            data-guide-title="新規のお客様の確保"
            data-guide="新規のお客様のために空けておく施術時間の長さです。長くするほど一枠は取りやすくなりますが、1日に確保できる枠の数は減ります。下の行がその数を教えてくれます。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stMinutesLabel">新規のお客様の確保</h3></div>
              <p className="st-dial-desc">新規のお客様のために確保する施術時間の長さ</p>
            </div>
            {/* ⚖ D-15 — ANY POSITIVE MINUTES, the same free-field shape 予約の
                刻み uses below: text input + ±NUDGE_MIN nudge, committed on
                blur. Typing is free; only the committed value (`minutes`)
                ever reaches the scene or the card. */}
            <div className="st-dial-ctl">
              <div className="st-step">
                <div className="st-step-g">
                  <button type="button" aria-label={`${NUDGE_MIN}分減らす`} onClick={() => nudgeMinutes(-NUDGE_MIN)}>−</button>
                  <input
                    id="stMinutes"
                    type="text"
                    inputMode="numeric"
                    aria-labelledby="stMinutesLabel"
                    /* ⚖ S28's pattern (SettingsScreen `NumberField`): the unit is the
                       field's DESCRIPTION, never folded into its name — a screen reader
                       hears the unit while every name-based query keeps its name. Same id
                       shape, `st-unit-<field>`, on all three fields of this section. */
                    aria-describedby="st-unit-stMinutes"
                    value={minutesText}
                    onChange={(e) => {
                      setMinutesMsg(null)
                      setMinutesWarn(/[^0-9]/.test(e.target.value))
                      setMinutesText(e.target.value)
                    }}
                    onBlur={() => {
                      const commit = commitMinutes(minutesText, lastGoodMinutes.current, props.dayLenMin)
                      lastGoodMinutes.current = commit.value
                      setMinutesText(String(commit.value))
                      setMinutes(commit.value)
                      setMinutesWarn(false)
                      setMinutesMsg(commit.message)
                    }}
                  />
                  <button type="button" aria-label={`${NUDGE_MIN}分増やす`} onClick={() => nudgeMinutes(NUDGE_MIN)}>＋</button>
                </div>
                <span id="st-unit-stMinutes" className="st-step-u">分</span>
              </div>
            </div>
            <p className={`st-ctrl-d${minutesWarn || minutesMsg !== null ? ' warn' : ' dim'}`} aria-live="polite">
              {minutesWarn
                ? NON_DIGIT_WARN
                : (minutesMsg ?? '数字以外は保存されません')}
            </p>
            {/* ⚖ THE GUARDRAIL, from the store's real day through the guard
                engine's own `protectedCapacity` — never a count this room
                derives. ⚖ 8/25 — the number says WHAT it counts.
                ⚖ D-25 F4 — AND ONLY WHILE THE FIELD AGREES WITH WHAT IS
                COMMITTED. While typed ≠ committed, this line says so instead
                of showing the pre-edit count — modelled on this room's own
                save-bar 反映されます grammar (「保存はこの画面の中だけに反映され
                ます」, below). Same `st-ctrl-d dim` class, `aria-live`
                unchanged; no new sentence spelled twice. */}
            <p className={`st-ctrl-d${minutesPending || scene.capacity !== 0 ? ' dim' : ' warn'}`} aria-live="polite">
              {minutesPending
                ? '入力中です。欄を離れると反映されます'
                : scene.capacity === 0
                  ? `この長さでは、この店舗の1日に新規のお客様の確保枠をひとつも作れません（0枠）`
                  : `この店舗では、1日に新規のお客様の確保枠を${scene.capacity}枠作れます`}
            </p>
          </section>

          {/* g. 確保枠の会員ランク開放 */}
          <section
            className="st-row st-dial"
            aria-labelledby="stRankLabel"
            data-guide-title="確保枠の会員ランク開放"
            data-guide="新規のお客様のために空けている枠を、選んだランク以上の常連さんにもネット予約で開放するかどうかです。既定では開放しません。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stRankLabel">確保枠の会員ランク開放</h3></div>
              <p className="st-dial-desc">確保枠の標準枠を、選んだランク以上のお客様のネット予約に開放します</p>
              <DetailToggle open={detOpen['rank'] === true} controls="st-det-bg.rank" onToggle={() => toggleDet('rank')} />
            </div>
            <div className="st-dial-ctl">
              <div className="sp-seg" role="group" aria-labelledby="stRankLabel">
                {RANK_OPTIONS.map(([value, label]) => (
                  <button key={value} type="button" className={rank === value ? 'on' : undefined} aria-pressed={rank === value} onClick={() => setRank(value)}>{label}</button>
                ))}
              </div>
            </div>
            <Collapse open={detOpen['rank'] === true} id="st-det-bg.rank" reduced={props.reduced}>
              <ul className="st-det">
                <li className="st-det-src"><span className="st-chip">準備中</span>{PENDING_NOTE}</li>
              </ul>
            </Collapse>
          </section>

          {/* h. 予約の刻み */}
          <section
            className="st-row st-dial"
            aria-labelledby="stSlotLabel"
            data-guide-title="予約の刻み"
            data-guide="予約カードが動く時間の単位です。30分なら、予約は10:00・10:30…にそろいます。数字以外は保存されません。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stSlotLabel">予約の刻み</h3></div>
              <p className="st-dial-desc">予約がそろう時間の単位</p>
              <DetailToggle open={detOpen['slot'] === true} controls="st-det-bg.slot" onToggle={() => toggleDet('slot')} />
            </div>
            <div className="st-dial-ctl">
              <div className="st-step">
                <div className="st-step-g">
                  <button type="button" aria-label={`${NUDGE_MIN}分減らす`} onClick={() => nudgeSlot(-NUDGE_MIN)}>−</button>
                  <input
                    id="stSlot"
                    type="text"
                    inputMode="numeric"
                    aria-labelledby="stSlotLabel"
                    aria-describedby="st-unit-stSlot"
                    value={slotText}
                    onChange={(e) => {
                      setSlotMsg(null)
                      // ⚖ 9/1 (fix round 2 D3) — SET EVERY KEYSTROKE, never only
                      // on rejection. `setSlotWarn(true)` alone cleared only on
                      // blur, so 「…消しました」 stood over the NEXT, clean
                      // keystroke — a sentence about something that just did not
                      // happen, which is worse than the colour-only state F10
                      // replaced. (ponytail: two identical rejections in a row
                      // still cannot re-announce — aria-live fires on change, and
                      // the text is unchanged. Known ceiling, accepted.)
                      // ⚖ D-27 — the text is kept AS TYPED (no stripping); the
                      // warn line still lights while a non-digit is present, but
                      // the commit — not this handler — decides what is saved.
                      setSlotWarn(/[^0-9]/.test(e.target.value))
                      setSlotText(e.target.value)
                    }}
                    /* ⚖ S17 fix round 4 · M4 — AN EMPTY BOX IS NOT A NUMBER, so
                       it does not become one silently. Clearing 30 and tabbing
                       away used to commit 5分 — the tightest granularity in the
                       store — with the live line still reading 「数字以外は保存
                       されません」, which is about characters. The honest
                       fallback is the value that was there, and the field says
                       what it did. Out of range still clamps, and says which
                       range. */
                    onBlur={() => {
                      const commit = commitMinutes(slotText, lastGoodSlot.current, props.dayLenMin)
                      lastGoodSlot.current = commit.value
                      setSlotText(String(commit.value))
                      setSlotWarn(false)
                      setSlotMsg(commit.message)
                    }}
                  />
                  <button type="button" aria-label={`${NUDGE_MIN}分増やす`} onClick={() => nudgeSlot(NUDGE_MIN)}>＋</button>
                </div>
                <span id="st-unit-stSlot" className="st-step-u">分</span>
            </div>
            </div>
            {/* ⚖ 9/1 (fix round 1 F10) — THE REJECTION IS SAID, NOT ONLY
                COLOURED. A polite live region whose TEXT never changes
                announces nothing, so the only signal that a keystroke was
                thrown away was quiet→orange: WCAG 1.4.1, colour as the sole
                carrier of information, on the one field in this room an
                operator actually types into. The sentence itself changes now,
                inside the region that was already there.
                ⚠ AND IT STAYS ON THE FACE (⚖ F15): a live region folded into a
                closed 詳しく is announced to a screen reader and invisible to
                everyone else — the two readers would be told different things. */}
            <p className={`st-ctrl-d${slotWarn || slotMsg !== null ? ' warn' : ' dim'}`} aria-live="polite">
              {slotWarn
                ? NON_DIGIT_WARN
                : (slotMsg ?? '数字以外は保存されません')}
            </p>
            <Collapse open={detOpen['slot'] === true} id="st-det-bg.slot" reduced={props.reduced}>
              <ul className="st-det">
                <li className="st-det-src"><span className="st-chip">準備中</span>{PENDING_NOTE}</li>
              </ul>
            </Collapse>
          </section>

          {/* i. 残りわずかの目安 — ⚖ Liam 2026-09-12. 月カレンダーの橙の境目。
              予約の刻み の作りをそのまま借りている（テキスト保持 → blur で確定、
              ± は1枠ずつ、拒否は声にも出す）。違うのは二点だけ:
              ・ガードレールは CALENDAR_TIGHT_RANGE から読む。この画面には数字を
                書かない — 盤面の塗りと同じ住所を見る。
              ・0 が合法で、しかも「効かなくなる」設定なので、その一行を面に出す。
                黙って効かなくなるつまみが、まさに ⚖ 8/21 の失敗。
              プリセットの3つには入れていない（名指しロックと同じ理由: お店ごとの
              判断であって、おまかせ／任せる／しっかり見る のどれかに従属する値では
              ない）。 */}
          <section
            className="st-row st-dial"
            aria-labelledby="stTightLabel"
            data-guide-title="残りわずかの目安"
            data-guide="月カレンダーで「残りわずか」として橙で示す、あと入る予約数の上限です。2なら、あと1〜2枠の日が橙になります。0にすると橙は出ません。"
          >
            <div className="st-dial-what">
              <div className="st-dial-label"><h3 id="stTightLabel">残りわずかの目安</h3></div>
              <p className="st-dial-desc">月カレンダーで、あと入る数がこの数以下の日を橙で示します</p>
              <DetailToggle open={detOpen['tight'] === true} controls="st-det-bg.tight" onToggle={() => toggleDet('tight')} />
            </div>
            <div className="st-dial-ctl">
              <div className="st-step">
                <div className="st-step-g">
                  {/* ⚠ THE ± CLEAR THE COMMIT SENTENCE (⚖ COLD-READ C4). Without
                      it a stale 「0枠から5枠のあいだで…」 from an earlier blur sits
                      in the live region while the operator steps down to 0, and
                      「0にすると橙は出ません」 — the one state this row exists to say
                      out loud — never gets its turn. */}
                  <button type="button" aria-label="1枠減らす" onClick={() => { const next = clampCalendarTight(nudgeBase(tightText, lastGoodTight.current, TIGHT_MIN) - 1); lastGoodTight.current = next; setTightMsg(null); setTightText(String(next)) }}>−</button>
                  <input
                    id="stTight"
                    type="text"
                    inputMode="numeric"
                    aria-labelledby="stTightLabel"
                    aria-describedby="st-unit-stTight"
                    value={tightText}
                    onChange={(e) => {
                      setTightMsg(null)
                      // ⚖ D-27 — text kept as typed; the commit decides what saves.
                      setTightWarn(/[^0-9]/.test(e.target.value))
                      setTightText(e.target.value)
                    }}
                    onBlur={() => {
                      // ⚖ D-30 — same predicate `commitMinutes` uses, at this field's
                      // own floor (0 is legal — it is how a store turns the 橙 tier off).
                      const raw = isIntegerTextAtLeast(tightText, TIGHT_MIN) ? tightText.trim() : ''
                      const commit = commitNumberField(raw, lastGoodTight.current, TIGHT_MIN, TIGHT_MAX, '枠')
                      lastGoodTight.current = commit.value
                      setTightText(String(commit.value))
                      setTightWarn(false)
                      setTightMsg(commit.message)
                    }}
                  />
                  <button type="button" aria-label="1枠増やす" onClick={() => { const next = clampCalendarTight(nudgeBase(tightText, lastGoodTight.current, TIGHT_MIN) + 1); lastGoodTight.current = next; setTightMsg(null); setTightText(String(next)) }}>＋</button>
                </div>
                <span id="st-unit-stTight" className="st-step-u">枠</span>
            </div>
            </div>
            {/* ⚖ F10 の同じ生き領域。⚠ そして 0 のときは「効かない」ことを言う:
                オフ状態を黙っているつまみは、ミス防止の失敗そのもの（⚖ 8/21）。 */}
            <p className={`st-ctrl-d${tightWarn || tightMsg !== null ? ' warn' : ' dim'}`} aria-live="polite">
              {tightWarn
                ? NON_DIGIT_WARN
                : (tightMsg ?? (tightText.trim() === '0' ? '0にすると橙は出ません' : '数字以外は保存されません'))}
            </p>
            <Collapse open={detOpen['tight'] === true} id="st-det-bg.tight" reduced={props.reduced}>
              <ul className="st-det">
                <li className="st-det-src"><span className="st-chip">準備中</span>{PENDING_NOTE}</li>
              </ul>
            </Collapse>
          </section>
        </details>
      </div>
  )

  /* ⚖ A3 — THE SAVE GRAMMAR. #812's own 保存 control, in the shell room's save
     slot, so every section of 設定 ends in one shape. The shell's generic
     dirty/保存 bar and its 「保存はこの画面の中だけに反映されます」 footnote are NOT
     rendered for this section: the seam's `saveRefusal` is the gate's ANSWER,
     and a demo-local commit here would contradict the seam this section
     imports. */
  const save = (
        /* i. 保存 — ⚖ THE HQ GATE, and an honest refusal.
            The control is REFUSED rather than hidden, and its own reason
            rides its accessible DESCRIPTION: per accname the button's text
            content wins the NAME (この設定を保存), and `title` supplies the
            description — which is the correct place for a reason, and is
            what every sibling in this family already does. (⚖ 9/1 fix round
            1 F9 — this note used to claim the reason was on the NAME. The
            behaviour was right and the sentence describing it was wrong,
            which is the kind of comment a later round builds on.) The
            refusal is also PRINTED under the control, so it does not depend
            on a tooltip at all. The family's standing pattern for an
            action with no wire yet (BusinessTopbar's 操作履歴,
            BusinessSidebar's 事業切替) is 「disabled with the reason, never a
            button that pretends」 (⚖ L-7). Who MAY save is the store's own
            manager-level list, decided on the server and named here so a
            refused operator knows who to ask rather than just being stopped. */
        <section
          className="st-row sp-save"
          aria-labelledby="stSaveLabel"
          data-guide-title="保存"
          data-guide="変更を店舗の設定として保存します。保存できるのは、この店舗の責任者だけです。いまはまだ保存できないので、この画面での動きを確認したあと、そのまま閉じて大丈夫です。"
        >
          <p className="st-ctrl-l" id="stSaveLabel">保存</p>
          {/* ⚠ REFUSED, NOT REMOVED FROM THE PAGE (⚖ S17 fix round 4 · M5). This
              was the one refusal in the room wearing a hard `disabled`, while
              the room states its own law twice for its own controls — a refused
              control stays FOCUSABLE (`aria-disabled`, never `disabled`) so its
              reason is reachable by keyboard and by a screen reader. `disabled`
              takes the button out of the tab order and its `title` with it, so
              the reader who most needs the reason is the one who cannot reach
              it. The printed line below stays; this is the same sentence made
              reachable by the control it is about. */}
          <button
            className="btn primary"
            type="button"
            aria-disabled={props.save.refusal !== null ? 'true' : undefined}
            title={props.save.refusal ?? undefined}
            aria-label={props.save.refusal !== null ? `この設定を保存 — ${props.save.refusal}` : undefined}
            // ⚠ AND THE PRESS IS GUARDED WHERE THE REFUSAL IS DECIDED. An
            // `aria-disabled` button is a real button: the browser will not stop
            // it, so the room does — the same shape every locked control in this
            // room uses. The save wire lands in this handler when ⑨ reconnects.
            onClick={props.save.refusal !== null ? (e) => e.preventDefault() : undefined}
          >
            この設定を保存
          </button>
          {props.save.refusal !== null && <p className="st-ctrl-d warn">{props.save.refusal}</p>}
        </section>
  )

  /** ⚖ S17 fix round 3 · R3-1 — THE TWO STANDING SENTENCES, IN FLOW.
   *  Both are true of the whole section rather than of the press, and at ① the
   *  save block is stuck to the bottom of the phone's screen — so carrying them
   *  there charged ~90px of a 390×844 phone against every scroll position, for
   *  sentences a reader needs once. They read at the END of the dials, which is
   *  where a manager arrives when they go looking for 保存, and the save card
   *  keeps only what belongs to the ACT: the button and its one refusal.
   *  ⚠ NOTHING IS LOST — that is the whole point of moving them rather than
   *  dropping them, and the room's other sections do the same with their own
   *  `.st-foot` line, from the same place in the same column.
   *
   *  ⚖ S17 fix round 1 · F15 stands: 「この設定はまだ保存できません」 used to ride
   *  five of the eight dials as a 準備中 line in the open; folding those into
   *  詳しく would have left the truth with no home on the face at all. It is
   *  still said ONCE, and the per-dial chips stay in each row's 詳しく as that
   *  dial's own detail.
   *
   *  ⚖ S17 fix round 3 · R3-2 — ONE FACT, ONE SENTENCE. 「見本データのため保存
   *  できません。実データの接続後に有効になります。」 (the seam's refusal, printed
   *  on the bar) and 「この設定はまだ保存できません。画面での動きだけ確認できます」
   *  say the SAME thing, and the review found them standing side by side. The
   *  note is the FALLBACK, not a second voice: it reads when the seam has no
   *  refusal to give and the wire is still not live; the moment the seam refuses,
   *  its own sentence — which also names WHEN the control comes alive — is the
   *  one a manager reads. ⚠ AND IT IS NOT LOST EITHER WAY: the six dials whose
   *  wire is still play-phase carry it in their own 詳しく, with the 準備中 chip. */
  const foot = (
        <div className="st-foots">
          <p className="st-foot">保存できるのは{props.save.roles.join('・')}です</p>
          {props.save.refusal === null && <p className="st-foot">{PENDING_NOTE}</p>}
        </div>
  )

  /* `.st-wrap` STAYS, and it is no longer a grid. #812 used it to put the
     preview column beside the dials; the room's own composition does that now,
     from one place, for every section. What it holds is the same two children in
     the same order, so the sheet's rule for it is a stack and main's own pin on
     the name still lands on the element it named. */
  const main = (
    <div className="st-wrap">
      {presets}
      {adv}
      {foot}
    </div>
  )

  /** ⚖ M2 — 詳細設定 is the one anchor with something to prepare. */
  const onAnchorJump = (id: string) => { if (id === 'bg.adv') setAdvOpen(true) }

  return <>{props.render({ main, card: cardSlot, save, jump: STORE_POLICY_ANCHORS, onAnchorJump })}</>
}

/** The shared nudge-clamp for 予約の刻み AND 新規のお客様の確保 — ⚖ D-15 gave
 *  both fields the same floor (`SLOT_MIN`, any positive integer's smallest
 *  member) and the same kind of ceiling (the store's own day, read at the call
 *  site rather than spelled here), so one function serves both nudge pairs.
 *  `!(x >= SLOT_MIN)` rather than `x < SLOT_MIN` for the one reason that
 *  spelling exists in this codebase: NaN fails EVERY comparison, so `<` would
 *  let an empty or non-numeric field through and `String(NaN)` would land
 *  「NaN」 in the box. Same shape as `impactOf`'s own `!(protectedDur > 0)`.
 *
 *  ⚖ D-25 L2 FOLD (m5) — EXPORTED so its own ceiling is pinned directly
 *  (`settings-room.test.ts`), not only through the nudge buttons that call
 *  it: nothing else in the battery drove `clampSlot`'s return value on its
 *  own, so a mutant dropping `Math.min(ceiling, …)` survived the whole
 *  battery green. The committed value stays safe either way
 *  (`commitNumberField`'s own `clampInt` re-clamps to the same ceiling on
 *  blur) — this only ever affects the live text box between a nudge click
 *  and the next blur. */
export function clampSlot(value: number, ceiling: number): number {
  if (!(Number.isFinite(value) && value >= SLOT_MIN)) return SLOT_MIN
  return Math.min(ceiling, Math.round(value))
}
