// CANON-LOGIC — the board's drag lattice and its guard checks, lifted from
// fable-store-today.html (:3698–3747, :3889–3923, :4454–4626, :4681–4733).
//
// Canon places cards in PERCENT of the board's width, and every rule below is
// stated in those percent units, exactly as canon states them. The screen
// converts to minutes only when it needs to say a time out loud.
//
// The two things worth understanding before changing anything here:
//
//   1. THE DUAL LATTICE. Canon snaps the AMOUNT MOVED, not the absolute
//      position — so a booking that genuinely starts at 17:12 moves to 17:42,
//      not to a lie about 17:00 (⚖ canon 8/9, preserve-by-default). But that
//      alone refuses an operator who is deliberately carrying that card to a
//      clean 17:00 slot (⚖ canon 8/10, heal-on-intent). The fix is two
//      lattices at once — the card's own phase and the clean one — with the
//      candidate nearest the pointer winning, ties going to clean. Nothing is
//      stored: the phase is re-read from the card's real position at every
//      drag start, so a card that lands clean behaves cleanly from then on.
//
//   2. THE CHECKS ARE THE GATE. `computeChecks` is what the 仮押さえ bar shows
//      and what decides whether 確定 is even pressable. It is re-run at confirm
//      time, not trusted from staging time — canon's R11-7 rule, so a lane
//      locked after staging cannot be confirmed through.

/** Percent-of-board for one 30-minute step, given how many hours the board
 *  spans. canon `STEP_PCT` (:3540) = HOUR_PCT / (60 / bookingStepMin). */
export function stepPct(boardHours: number, stepMin = 30): number {
  return (100 / boardHours) / (60 / stepMin)
}

export function snapPct(v: number, step: number): number {
  return Math.round(v / step) * step
}

/** canon `snapFloor` (:3700). The epsilon keeps a value already sitting on a
 *  lattice point from falling to the one below it through float noise. */
export function snapFloor(v: number, step: number): number {
  return Math.floor(v / step + 1e-9) * step
}

/** canon `snapCeil` (:3717) — snapFloor's mirror, via floor(-v) = -ceil(v). */
export function snapCeil(v: number, step: number): number {
  return -snapFloor(-v, step)
}

/** canon `latticeOrigin` (:3712): the fraction of a step this position already
 *  carries — the phase of the card's own lattice. */
export function latticeOrigin(x: number, step: number): number {
  return x - snapFloor(x, step)
}

/** canon `latticeClamp` (:3723). Snap onto the lattice with the given phase,
 *  then clamp to [lo, hi] — but clamp ONTO the same lattice, so the clamp
 *  cannot silently kill the phase. The low side ceils and the high side floors:
 *  floor on the low side would put the lattice point just under the bound. */
export function latticeClamp(rawPct: number, origin: number, lo: number, hi: number, step: number): number {
  const v = origin + snapPct(rawPct - origin, step)
  const top = origin + snapFloor(hi - origin, step)
  const bot = origin + snapCeil(lo - origin, step)
  return Math.max(bot, Math.min(v, top))
}

/** canon `dualLatticeX` (:3737). See note 1 in this file's header. */
export function dualLatticeX(rawPct: number, deltaOrigin: number, lo: number, hi: number, step: number): number {
  const clean = latticeClamp(rawPct, 0, lo, hi, step)
  if (deltaOrigin === 0) return clean
  const delta = latticeClamp(rawPct, deltaOrigin, lo, hi, step)
  return Math.abs(delta - rawPct) < Math.abs(clean - rawPct) ? delta : clean
}

/** canon `OVERLAP_EPS` + `spansOverlap` (:4680). Three-decimal percent
 *  coordinates make back-to-back placement look like a 0.001% overlap
 *  (45.455 + 9.091 = 54.546 vs 54.545). 0.05% ≈ 20 seconds: it eats the
 *  rounding crumbs and still catches a real one-minute overlap (0.152%). */
export const OVERLAP_EPS = 0.05

export function spansOverlap(ax: number, aw: number, bx: number, bw: number): boolean {
  return ax + OVERLAP_EPS < bx + bw && bx + OVERLAP_EPS < ax + aw
}

export type DragMode = 'move' | 'resize' | 'resizeL'

/** canon `dragStart` (:4435): which edge the pointer grabbed. 10px from either
 *  end is a resize; anywhere else is a move. */
export function dragModeFor(pointerX: number, rectLeft: number, rectRight: number): DragMode {
  if (rectRight - pointerX <= 10) return 'resize'
  if (pointerX - rectLeft <= 10) return 'resizeL'
  return 'move'
}

export interface DragOrigin {
  x: number
  w: number
  mode: DragMode
  /** canon dragCtx.deltaOriginX / deltaOriginE (:4442) — the phase of whichever
   *  edge this drag actually moves, re-read at every drag start. */
  deltaOriginX: number
  deltaOriginE: number
}

export function dragOrigin(x: number, w: number, mode: DragMode, step: number): DragOrigin {
  return { x, w, mode, deltaOriginX: latticeOrigin(x, step), deltaOriginE: latticeOrigin(x + w, step) }
}

/** canon `dragMove` (:4488–4508) and its authoritative re-run at pointerup
 *  (`finishNormalBookingDrag`, :4569–4586) — one function, because two spellings
 *  of the same geometry is exactly how a release lands somewhere the drag never
 *  showed. `deltaPct` is (dx / trackWidth) × 100. */
export function dragGeometry(origin: DragOrigin, deltaPct: number, step: number): { x: number; w: number } {
  if (origin.mode === 'resize') {
    const rawE = origin.x + origin.w + deltaPct
    const edge = dualLatticeX(rawE, origin.deltaOriginE, origin.x + step, 100, step)
    return { x: origin.x, w: edge - origin.x }
  }
  if (origin.mode === 'resizeL') {
    const rawX = origin.x + deltaPct
    const x = dualLatticeX(rawX, origin.deltaOriginX, 0, origin.x + origin.w - step, step)
    return { x, w: origin.x + origin.w - x }
  }
  const rawX = origin.x + deltaPct
  return { x: dualLatticeX(rawX, origin.deltaOriginX, 0, 100 - origin.w, step), w: origin.w }
}

/** canon `keyboardResizeBooking` (:3899–3911). Shift+arrows move the start,
 *  Alt+arrows move the end, one 30-minute step at a time. A nudge that would
 *  change nothing returns null so the caller can say so out loud instead of
 *  pretending it moved. */
export function keyboardNudge(
  x: number,
  w: number,
  mode: 'resize' | 'resizeL',
  direction: -1 | 1,
  step: number,
): { x: number; w: number } | null {
  let nextX = x
  let nextW = w
  if (mode === 'resizeL') {
    nextX = Math.max(0, Math.min(x + w - step, x + direction * step))
    nextW = x + w - nextX
  } else {
    nextW = Math.max(step, Math.min(100 - x, w + direction * step))
  }
  if (Math.abs(nextX - x) < 0.001 && Math.abs(nextW - w) < 0.001) return null
  return { x: nextX, w: nextW }
}

/** canon `placeFromShelf` (:5662): a parked card returns on the same dual
 *  lattice, centred on the pointer. */
export function shelfLanding(pointerFraction: number, w: number, parkedX: number, step: number): number {
  return dualLatticeX(pointerFraction * 100 - w / 2, latticeOrigin(parkedX, step), 0, 100 - w, step)
}

// ── the guard checks ───────────────────────────────────────────────────────

export interface CheckSpan {
  /** The booking/block this span belongs to; the dragged card's own spans are
   *  excluded by id, exactly as canon excludes by `data-book`. */
  id: string
  x: number
  w: number
  title: string
  /** canon `isDerivedInventory` (:4686): 空き枠 and 清掃 are derived inventory —
   *  a real placement always wins and they are recomputed at confirm. */
  derived: boolean
  /** Parked cards hold no ground (canon skips `.parked` everywhere). */
  parked: boolean
}

export interface Check {
  ok: boolean
  label: string
}

export interface CheckContext {
  /** Every span on every track this booking occupies (staff lane + bed lane). */
  spans: CheckSpan[]
  bookingId: string
  staffName: string
  /** The staff member's last workable minute today, as a clock string, or null
   *  when the lane carries no shift bound. */
  staffUntil: string | null
  laneLocked: boolean
  /** x → minute, so the shift check can compare against `staffUntil`. */
  minutesOf: (x: number) => number
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/** canon `computeChecks` (:4691). The evidence the 仮押さえ bar shows and the
 *  gate 確定 is behind — shared by the bar and the create dialog so the two can
 *  never disagree about whether a placement is legal. */
export function computeChecks(now: { x: number; w: number }, ctx: CheckContext): Check[] {
  const checks: Check[] = []
  let yieldsDerived = false
  const conflicts: string[] = []
  for (const span of ctx.spans) {
    if (span.id === ctx.bookingId || span.parked) continue
    if (!spansOverlap(now.x, now.w, span.x, span.w)) continue
    if (span.derived) {
      yieldsDerived = true
      continue
    }
    if (!conflicts.includes(span.title)) conflicts.push(span.title)
  }
  checks.push(
    conflicts.length
      ? { ok: false, label: `時間帯が重複: ${conflicts.join('・')}` }
      : { ok: true, label: '時間帯の重複なし' },
  )
  if (!conflicts.length && yieldsDerived) {
    checks.push({ ok: true, label: '空き枠・清掃は確定時に自動再配置（清掃バッファは設定に従う）' })
  }
  if (ctx.staffUntil) {
    const okUntil = ctx.minutesOf(now.x + now.w) <= toMin(ctx.staffUntil)
    checks.push({
      ok: okUntil,
      label: okUntil ? `${ctx.staffName}の勤務時間内（〜${ctx.staffUntil}）` : `${ctx.staffName}は${ctx.staffUntil}以降勤務不可`,
    })
  }
  if (ctx.laneLocked) {
    checks.push({ ok: false, label: `${ctx.staffName}はシフトロック中（新規配置不可）` })
  }
  checks.push({ ok: true, label: '整体資格 一致' })
  checks.push({ ok: true, label: '予約時価格を保持（動的価格は適用しません）' })
  return checks
}

/** canon `renderHoldBar` (:4776–4777): the confirm button is the checks. */
export function confirmCaption(checks: Check[]): { enabled: boolean; label: string } {
  const allOk = checks.every((c) => c.ok)
  return { enabled: allOk, label: allOk ? 'この内容で確定' : 'この位置では確定できません' }
}
