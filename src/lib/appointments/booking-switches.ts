// The ONE switch registry for the 予約 numbers work (spec §10). Plain
// constants — no env, no settings read; the settings door (a per-store UI to
// flip these) is a later slice. Every switch is honest when OFF: nothing it
// gates ever half-renders.
export const BOOKING_SWITCHES = {
  /** The 空き (free-time) cell. OFF today — Liam's open question (a): drop
   *  everywhere, or flip ON for solo stores only. Flip: his word, spec §13(a). */
  freeTimeCell: false,
  /** The 休 (closed-day) cell replacing a zero-booking day's numbers. OFF — a
   *  discovered surface; core's write-path refusal is still the ask (core
   *  ticket 1) so a staff member could still book INTO a 休 day today. The
   *  1a wire field ships regardless. Flip: once core ships the refusal, or
   *  Liam accepts the gap. */
  closedDays: false,
  /** The month page's selected-day list-card below the grid. ON — spec §S1,
   *  this round's build. Flip: never expected; a floor once 1b-month lands. */
  selectedDayCard: true,
  /** The month page's numbers line above the grid. ON — spec §S3, this
   *  round's build. Flip: never expected; a floor once 1b-month lands. */
  monthLine: true,
  /** 先月同期間比 (month-over-month compare) on the month line. OFF — needs a
   *  second month's data or core's count door (spec §8/§10). Flip: once that
   *  data exists. */
  monthCompare: false,
} as const
