// The ONE switch registry for the 予約 numbers work (spec §10). Plain
// constants — no env, no settings read; the settings door (a per-store UI to
// flip these) is a later slice. Every switch is honest when OFF: nothing it
// gates ever half-renders.
export const BOOKING_SWITCHES = {
  /** The 空き (free-time) cell. ⚖ Liam 9/15 11:1x answered question (a) —
   *  「show those 3 hours free even if it's spread out into 30-minute gaps…
   *  that's the whole point of the 隙間ガード」: ON, everywhere, not solo-only.
   *  The honesty gate is unchanged — the cell still renders only where
   *  `capacityDefensible` holds (spec §14); elsewhere the slot takes 予約時間. */
  freeTimeCell: true,
  /** The 休 (closed-day) cell replacing a zero-booking day's numbers. ON —
   *  ⚖ Liam 9/15 16:0x 「everything as the mock」, ruled again at R1-3: the
   *  cell is honest either way (it reads the store's SAVED hours; with none
   *  saved nothing changes), and a staff member who can see the shop is shut
   *  is better off than one who cannot. The remaining gap is the WRITE side —
   *  the app will still accept a booking into a 休 day — and that door is
   *  closed on the app side by PKT-1c-C, this same release; core's own
   *  write-path refusal stays the ask (core ticket 1). */
  closedDays: true,
  /** The month page's selected-day list-card below the grid. ON — spec §S1,
   *  this round's build. Flip: never expected; a floor once 1b-month lands. */
  selectedDayCard: true,
  /** The month page's numbers line above the grid. ON — spec §S3, this
   *  round's build. Flip: never expected; a floor once 1b-month lands. */
  monthLine: true,
  /** 先月同期間比 (month-over-month compare) on the month line. ON — ⚖ Liam
   *  9/15 16:0x 「everything as the mock」: the second month's data is now read
   *  by the app itself (a second paged window through the same door, the same
   *  filter and the same 件 definition as the month's own), so the clause no
   *  longer waits on core's count door. It is honest either way — no honest
   *  number means no clause, never a 0 and never a dash. The cost of the flip
   *  is one extra window read per 月 page view, and only there. */
  monthCompare: true,
} as const
