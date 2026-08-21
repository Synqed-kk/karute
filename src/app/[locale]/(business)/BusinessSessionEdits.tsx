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
// NOTHING PERSISTS beyond the tab: this is component state, so a reload still
// resets the board exactly as every toast on this screen promises.
//
// NOT CARRIED, deliberately: `blockMoves`. A 予定ブロック is keyed by `item.key`
// and the same block is drawn on every day of the fixture world, so a surviving
// block move would show up on all of them — day-scoping it is a separate
// decision, and dying on the flip is the safe default until it is made.

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { Move, Moves } from './business/today/today-interactions'
import type { BoardItem } from '@/business/lib/today-board'

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
 *  restore on an absolute date instead, and this comment can go with it. */
export interface ParkHome extends Move {
  dayOffset: number
  dayLabel: string
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
  dayOffset: number
  dayLabel: string
}

/** canon's 配置モード (`placing`, :6826). Armed by 次回予約を作成, disarmed by the
 *  ×, by Escape, or by the placement itself. ⚖ Liam 21: it survives day
 *  navigation — which is exactly what its own toast promises out loud
 *  (「日付を移動してもそのまま」), and what the remount was quietly breaking. */
export interface PlacingIntent {
  label: string
  name: string
}

interface SessionEdits {
  added: AddedRow[]
  setAdded: Dispatch<SetStateAction<AddedRow[]>>
  moves: Moves
  setMoves: Dispatch<SetStateAction<Moves>>
  parked: string[]
  setParked: Dispatch<SetStateAction<string[]>>
  parkChips: ParkChip[]
  setParkChips: Dispatch<SetStateAction<ParkChip[]>>
  pending: PendingChange | null
  setPending: Dispatch<SetStateAction<PendingChange | null>>
  placing: PlacingIntent | null
  setPlacing: Dispatch<SetStateAction<PlacingIntent | null>>
}

const SessionEditsContext = createContext<SessionEdits | null>(null)

/** Wraps the screen under the persisting layout. No memo on the value: this
 *  component re-renders only when one of its own six states changes, which is
 *  exactly when the screen reading them has to re-render anyway. `children`
 *  keeps its element identity across those renders, so nothing else does. */
export function BusinessSessionEdits({ children }: { children: ReactNode }) {
  const [added, setAdded] = useState<AddedRow[]>([])
  const [moves, setMoves] = useState<Moves>({})
  const [parked, setParked] = useState<string[]>([])
  const [parkChips, setParkChips] = useState<ParkChip[]>([])
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [placing, setPlacing] = useState<PlacingIntent | null>(null)
  return (
    <SessionEditsContext.Provider
      value={{
        added, setAdded,
        moves, setMoves,
        parked, setParked,
        parkChips, setParkChips,
        pending, setPending,
        placing, setPlacing,
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
