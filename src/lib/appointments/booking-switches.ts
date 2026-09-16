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

  // ── capacity (PKT-1c-B, council C4 §(2)) ────────────────────────────────
  // The four keys below gate the ONE capacity model (src/lib/capacity). They
  // are disjoint from the five above: those gate CELLS, these gate where the
  // capacity number comes from.

  /** ONE switch for 稼働 AND 空き on multi-staff stores — never two (C4: 稼働%
   *  and 空き are the same saved capacity wearing two dresses, so they can
   *  never be flipped apart). ON: the day's lanes are the store's booking
   *  roster, any store. OFF: only a solo-mode store with at most one booked
   *  staffer gets a lane at all — exactly the gate that shipped before this
   *  packet — and every other store falls back to the count table.
   *  ⚖ Liam 2026-09-15 11:4x 「automatic… beds, staff, what percentage is full
   *  or empty」 + 16:0x 「everything in one look」: ON. */
  multiStaffCapacity: true,
  /** The fixed percentage table (少なめ <35 · 普通 35–65 · 混雑 >65) as the
   *  COLOUR, on the month dots, the week dots and the pop-down panel TOGETHER
   *  (C3 E18: two calendars on one screen may never disagree). ON — the fact
   *  rides the wire from this packet; the surfaces read it in the wiring
   *  round, so flipping it changes nothing until they do. */
  percentBands: true,
  /** Beds as lanes. OFF and reserved — C1 §4 found zero Resource rows and
   *  Karute never writes resource_id, so no store can be identified as
   *  bed-bound at all; nothing reads this key yet. When beds arrive, OFF must
   *  mean `laneKind: 'none'` for a bed-having store (the count table), NEVER a
   *  fall-through to staff lanes (C4 §3) — a bed store's staff count is not
   *  its capacity. Flip: when bookings actually claim beds. */
  bedLanes: false,
  /** Per-staff shift minutes as the lane time, replacing roster × hours.
   *  OFF and reserved — it needs core's shift data (CORE-8). Until then a
   *  rostered staffer who is off today still counts, which is the recorded
   *  limitation behind the lead's 空き ruling. Flip: when CORE-8 lands. */
  shiftLanes: false,
} as const
