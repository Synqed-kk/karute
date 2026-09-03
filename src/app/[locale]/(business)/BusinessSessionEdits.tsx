'use client'

// ⚖ Liam 22 (2026-08-21) — THE SESSION'S EDITS LIVE ABOVE THE SCREEN.
//
// Day navigation on 今日の運営 is a real LINK (`?day=±N`, today/page.tsx:22-24 —
// a ±45-day window cannot ship as client state), so TodayPage re-executes and
// TodayScreen REMOUNTS. Every edit the operator had staged lived in
// TodayScreen's own useState and died with the remount: the parked 仮押さえ chip
// that ⚖ 22 says must survive the flip, and — worse — the cards it had already
// placed on the day they flipped to. The local harness never saw it because it
// mounts TodayScreen directly and never navigates.
//
// The LAYOUT does not remount across a `?day=` navigation, so the state moves
// here. Same shape as the topbar's ActionSlot (BusinessTopbar.tsx:32-41) and
// for the same stated reason: react-dom's createPortal is off territory's
// import allowlist, so React Context is the house tool.
//
// IT IS ONE FAMILY, ON PURPOSE. A chip carried to another day lands in `added`,
// stays hidden on its origin day through `parked`, takes its span from `moves`
// and stands on the hold bar through `pending`. Carrying the chip alone and
// leaving the other four behind would mean the chip survives the flip and the
// booking it was placed as does not — the ⚖-ruled flow losing a booking in
// silence, which is worse than the bug it was fixing.
//
// ⚖ BATCH-6 flag 45 (2026-08-21) — `bedMoves` JOINS THE FAMILY for exactly that
// reason. A booking is a person AND a room, and the room's lane is a membership
// of its own; it belongs beside `moves` and not below it, because a staff lane
// that survives a day flip while its bed lane does not is the same half-a-
// booking failure in a new place. Id-keyed is day-safe here on `moves`' own
// argument: a booking id belongs to exactly one day.
//
// NOTHING PERSISTS beyond the tab: this is component state, so a reload still
// resets the board exactly as every toast on this screen promises.
//
// ⚖ 46 FORERUNNER (slice C, Greptile #737 P1) — EVERY ELEMENT IS STORE-STAMPED.
// This provider survives `?store=` for the same reason it survives `?day=`: the
// layout does not remount. So each element carries the store identity that was
// on screen when it was made, and the screen renders/evaluates only its own —
// see `onShownBoard` / `sameStore` in today-interactions.ts for the rule and the
// SUPERSESSION NOTE: slice F (batch 7, feat/business-transplant-today) ships the
// fuller ⚖ 46 design and REPLACES everything marked "⚖ 46 forerunner" here.
//
// `moves` takes no stamp, and that is a finding rather than an omission. It is
// keyed by `caseId`, and `applyMoves` can only act on a key the board on screen
// already carries: its `kept`/`moved` passes read `moves[item.caseId]` off that
// board's own items, and its `arrivals` pass drops any id `homeStaffItem` (built
// from the same board) does not know. A real booking id belongs to one store, so
// neither path can reach across. The one id that WAS forgeable across boards is
// the synthetic `nextvisit-N` — `createSeq` is a ref inside the screen and the
// screen remounts on every navigation, so store B's first placement was also
// `nextvisit-1`. That is fixed at the id (TodayScreen `placeNextVisit`), which is
// the root cause, rather than by rippling a required `store` through `Move` — a
// shape that also describes drag origins and block spans, where it means nothing.
//
// NOT CARRIED, deliberately: `blockMoves`. A 予定ブロック is keyed by `item.key`
// and the same block is drawn on every day of the fixture world, so a surviving
// block move would show up on all of them — day-scoping it is a separate
// decision, and dying on the flip is the safe default until it is made.

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { Move, Moves } from './business/today/today-interactions'
import type { BoardItem, BookingCategory } from '@/business/lib/today-board'

/** ⚖ Liam 22 — where a parked card came from, WITH THE DAY AS DATA. Canon's
 *  park snapshot carries `day` on every element it took (fable-store-today.html
 *  :5567-5570) and its × restore reads it back (:5589); ours carried the origin
 *  day only as the baked 元: sentence, which no code can act on. `dayLabel` is
 *  the same string `pending` already keeps for the same reason — the bar and the
 *  chip both have to be able to NAME the day they are answering for.
 *
 *  MIDNIGHT-ROLLOVER CAVEAT: an offset is the fixture world's only coherent
 *  coordinate — bookings regenerate relative to the real now, so a board left
 *  open across JST midnight re-bases every one of them and yesterday's `0` is
 *  today's `-1`. The shelf fails SOFT when that happens (see `unparkOutcome`):
 *  the chip stays put rather than vanishing. Real-data reconnect will key the
 *  restore on an absolute date instead, and this comment can go with it.
 *
 *  ⚖ Liam flag 46 (2026-08-21) — AND THE STORE, for the same reason and by the
 *  same mechanism. `?store=` is a Link too, so the shelf survives a store switch
 *  and the chip can end up on a board whose staff and rooms it has nothing to do
 *  with. `store` is what the placement is checked against; `storeLabel` is
 *  what the refusal SAYS, because the operator thinks in 銀座店, not in an id. */
export interface ParkHome extends Move {
  dayOffset: number
  dayLabel: string
  store: string | null
  storeLabel: string
}

/** A booking sitting in the 仮置きエリア. It carries the whole card, because the
 *  day it came from may not be the day on screen any more (⚖ Liam 22) and the
 *  chip is then the only record of what is being carried. */
export interface ParkChip {
  id: string
  title: string
  line1: string
  line2: string
  category: string | null
  home: ParkHome
  lenMin: number
  item: BoardItem
}

/** ⚖ Liam 22 — a card this session put on a board, and THE DAY it belongs to.
 *  Canon keeps every day in one DOM and stamps a card `data-day`; our board is
 *  one day per server render, so the day travels with the row instead. Without
 *  it a card placed from the shelf onto 8/22 would reappear on every other day
 *  of the month. `fromChip` is what 元に戻す puts back on the shelf. */
export interface AddedRow {
  dayOffset: number
  /** ⚖ 46 forerunner — and THE STORE, for the same reason as the day. Two stores
   *  that share a staff member share that staff member's lane key, so a row
   *  scoped by day alone painted onto both boards. */
  store: string | null
  laneKey: string
  item: BoardItem
  fromChip?: ParkChip
}

/** canon's `pendingChange`, and — ⚖ R11-4 (:5686) — the DAY it is staged on. A
 *  仮押さえ survives day navigation, so the bar can outlive the board that
 *  explains it; without the day it would compute its checks against whatever
 *  board happened to be on screen and answer for a card that is not there. */
export interface PendingChange {
  id: string
  origin: Move
  /** ⚖ BATCH-6 flag 45 — THE OTHER HALF OF THE SNAPSHOT. canon's `stageChange`
   *  snaps per element (:4652-4661), so its 元に戻す puts BOTH drawings back
   *  whichever one was dragged. Ours held one Move and called it the origin,
   *  which meant a bed-side move had nothing to revert the person to. Absent for
   *  a booking with no bed row, and for a creation (whose 元に戻す deletes it). */
  bedOrigin?: Move
  /** ⚖ flag 87 fix round (2026-08-30) — THE ROOM THE OPERATOR PICKED BY HAND,
   *  as opposed to the one the allocator solved for them. Written only by a
   *  BED-ROW drag that actually changed room — the one gesture that says WHICH
   *  ROOM out loud — replaced by a later such drag, and never cleared by a time
   *  adjustment, because a staff-row drag or a Shift/Alt+Arrow is not an opinion
   *  about rooms. `seedBed` reads it ahead of `bedOrigin`; absent on every
   *  change nobody has bed-dragged. */
  bedChosen?: string
  dayOffset: number
  dayLabel: string
  /** ⚖ 46 forerunner — the board it is staged on. Without it the bar re-ran its
   *  checks against whichever STORE was on screen and answered for a card that
   *  board has never had; the day-pin now names the store too when it differs. */
  store: string | null
  storeLabel: string
  /** ⚖ Liam flag 50(d) (2026-08-22) — THE RED REASON THIS LANDING OVERRODE.
   *  A 置けない landing never places by itself; an authorised operator may place
   *  through 「注意して配置」, and the change then carries the sentence it walked
   *  past. The confirm surface shows it as a △ row and `overrideCaption` lets
   *  that one row — and only that one — stop blocking 確定. Absent on every
   *  ordinary landing. */
  override?: string
}

/** canon's 配置モード (`placing`, :6826). Armed by 次回予約を作成, disarmed by the
 *  ×, by Escape, or by the placement itself. ⚖ Liam 21: it survives day
 *  navigation — which is exactly what its own toast promises out loud
 *  (「日付を移動してもそのまま」), and what the remount was quietly breaking.
 *
 *  ⚖ Liam flag 46 rider — and it carries the store it was armed on, because it
 *  survives a store switch as well as a day flip and the customer it names is
 *  ご来店中 at ONE store. Same two fields, same check, same refusal as the shelf
 *  chip's: one store-isolation rule, not two that can drift. */
export interface PlacingIntent {
  label: string
  name: string
  store: string | null
  storeLabel: string
  /** ⚖ 51 — THE NEXT VISIT'S CATEGORY RIDES THE INTENT, so the landing can ask
   *  the room floor the same question a card asks. 配置モード placed the ご来店中
   *  customer's 次回予約 with `vip: false` hardcoded, so a VIP was solved onto a
   *  standard bed with no word said — the silent path ⚖ 51 exists to prevent.
   *
   *  ⚖ Greptile #827 — the NEXT visit's, not today's. VIP and 回数券 are the
   *  customer's own traits; 新規 is a fact about the visit being paid for now,
   *  and the intent describes the one after it. TodayScreen's
   *  `nextVisitCategory` is the one place that word is turned over. */
  category: BookingCategory
}

/** ⚖ Liam flag 41 (2026-08-21) — A CONFIRM SURFACE EXISTS ONLY WHILE ITS
 *  DECISION IS OPEN. The day's own standing 仮押さえ (the incident's) had no
 *  answered state at all: its popover was tied to the PROP being there, so
 *  答えても消えず、他のカードを動かすたびに戻ってきた. The old full-width bar hid
 *  that — it was always on screen by design — and a floating popover cannot.
 *
 *  `null` = still open. Answering closes it for the session, and WHICH answer
 *  is the other half of the state: 確定 turns the card's own colour, 元に戻す
 *  leaves it 仮押さえ. Here rather than in the screen so a day flip cannot
 *  resurrect a question the operator already answered — the screen remounts on
 *  every `?day=` navigation, this provider does not. */
export type HoldAnswer = 'confirmed' | 'reverted' | null

interface SessionEdits {
  added: AddedRow[]
  setAdded: Dispatch<SetStateAction<AddedRow[]>>
  moves: Moves
  setMoves: Dispatch<SetStateAction<Moves>>
  /** ⚖ BATCH-6 flag 45 — the BED lane each booking sits on, when this session
   *  has moved it off the one the server drew. Same shape and same key as
   *  `moves`; the span in it is the pair's, kept in step by the one writer. */
  bedMoves: Moves
  setBedMoves: Dispatch<SetStateAction<Moves>>
  parked: string[]
  setParked: Dispatch<SetStateAction<string[]>>
  parkChips: ParkChip[]
  setParkChips: Dispatch<SetStateAction<ParkChip[]>>
  pending: PendingChange | null
  setPending: Dispatch<SetStateAction<PendingChange | null>>
  placing: PlacingIntent | null
  setPlacing: Dispatch<SetStateAction<PlacingIntent | null>>
  holdAnswer: HoldAnswer
  setHoldAnswer: Dispatch<SetStateAction<HoldAnswer>>
}

const SessionEditsContext = createContext<SessionEdits | null>(null)

/** Wraps the screen under the persisting layout. No memo on the value: this
 *  component re-renders only when one of its own states changes, which is
 *  exactly when the screen reading them has to re-render anyway. `children`
 *  keeps its element identity across those renders, so nothing else does. */
export function BusinessSessionEdits({ children }: { children: ReactNode }) {
  const [added, setAdded] = useState<AddedRow[]>([])
  const [moves, setMoves] = useState<Moves>({})
  const [bedMoves, setBedMoves] = useState<Moves>({})
  const [parked, setParked] = useState<string[]>([])
  const [parkChips, setParkChips] = useState<ParkChip[]>([])
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [placing, setPlacing] = useState<PlacingIntent | null>(null)
  const [holdAnswer, setHoldAnswer] = useState<HoldAnswer>(null)
  return (
    <SessionEditsContext.Provider
      value={{
        added, setAdded,
        moves, setMoves,
        bedMoves, setBedMoves,
        parked, setParked,
        parkChips, setParkChips,
        pending, setPending,
        placing, setPlacing,
        holdAnswer, setHoldAnswer,
      }}
    >
      {children}
    </SessionEditsContext.Provider>
  )
}

/** Screen side. It THROWS rather than falling back to an empty default the way
 *  the topbar's slot does: a no-op default would swallow every park, placement
 *  and 仮押さえ silently, which is the failure this whole file exists to stop. */
export function useSessionEdits(): SessionEdits {
  const edits = useContext(SessionEditsContext)
  if (!edits) throw new Error('今日の運営の編集状態は BusinessSessionEdits の内側でのみ読めます')
  return edits
}
