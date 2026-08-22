'use client'

// THE SHIFT ROOM'S STAGED EDITS LIVE ABOVE THE SCREEN — the same lesson, and
// the same fix, as BusinessSessionEdits (⚖ Liam 22).
//
// スタッフ・シフト navigates for real: `?view=`, `?week=` and `?ym=` are Links,
// so ShiftsScreen REMOUNTS on every flip and anything it held in its own
// useState dies with it. Canon keeps its edits alive across a 週/月 switch by
// mutating one shared day cache — that is the behaviour being carried, and a
// staged shift that vanished the moment the operator looked at the same month
// from the other board would be the parked-chip bug (flag 30) in a new place.
// The LAYOUT does not remount across those navigations, so the state lives
// here.
//
// NOTHING PERSISTS beyond the tab, and nothing is written anywhere: the
// play-phase fence forbids every write in Business territory, so a staged shift
// is exactly what the dialog says it is — a change this screen is holding until
// the tab closes.
//
// SEPARATE FROM BusinessSessionEdits on purpose. That provider is the board's
// family of five, keyed to booking ids and typed against today-interactions;
// this is two flat lists keyed to (staff, day). Folding shifts into it would
// tie two rooms' state to one shape for no shared behaviour.

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { StagedLeave, StagedShift } from '@/business/lib/shifts'

interface ShiftEdits {
  /** Shifts the operator changed in this session, newest wins per (staff, day). */
  shiftEdits: StagedShift[]
  setShiftEdits: Dispatch<SetStateAction<StagedShift[]>>
  /** 希望休 answered in this session. */
  leaveAnswers: StagedLeave[]
  setLeaveAnswers: Dispatch<SetStateAction<StagedLeave[]>>
}

const ShiftEditsContext = createContext<ShiftEdits | null>(null)

export function ShiftsSessionEdits({ children }: { children: ReactNode }) {
  const [shiftEdits, setShiftEdits] = useState<StagedShift[]>([])
  const [leaveAnswers, setLeaveAnswers] = useState<StagedLeave[]>([])
  return (
    <ShiftEditsContext.Provider value={{ shiftEdits, setShiftEdits, leaveAnswers, setLeaveAnswers }}>
      {children}
    </ShiftEditsContext.Provider>
  )
}

/** Screen side. THROWS rather than defaulting to an inert pair: a silent
 *  no-op would swallow every staged edit and every 希望休 answer, which is the
 *  failure this file exists to stop. */
export function useShiftEdits(): ShiftEdits {
  const edits = useContext(ShiftEditsContext)
  if (!edits) throw new Error('シフトの編集状態は ShiftsSessionEdits の内側でのみ読めます')
  return edits
}
