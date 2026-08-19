/**
 * canon-logic — the lifted mock behaviour, checked against canon's own arithmetic.
 *
 * WHY THESE CASES LOOK ODD: every expectation below was derived by HAND-EXECUTING
 * fable-store-today.html / gap-guard-engine.js on paper, not by running this code
 * and writing down what came out. That is the only way a lift can be proven to be
 * a lift rather than a plausible rewrite — a self-consistent reimplementation
 * passes its own tests happily.
 *
 * Where canon's own numbers are quoted (7130, 6270, the 7000/7700 list prices),
 * they are there because they are what canon's arithmetic was hand-run on — the
 * SCREEN never sees them; it runs on our fixtures.
 */

import {
  clampPriceInputs,
  discountNote,
  floorDiscountPercent,
  framingSample,
  gapFillPrice,
  gapFillRawTotal,
  hqNote,
  packedPrice,
  priceAt,
  priceButtonCaption,
  priceLabel,
  tierOf,
  CURVE_MAX_DIP,
} from '@/business/lib/canon-logic/pricing'
import {
  computeChecks,
  confirmCaption,
  dragGeometry,
  dragModeFor,
  dragOrigin,
  dualLatticeX,
  keyboardNudge,
  latticeOrigin,
  shelfLanding,
  snapCeil,
  snapFloor,
  spansOverlap,
  stepPct,
} from '@/business/lib/canon-logic/drag-rules'
import { createGapGuard } from '@/business/lib/canon-logic/gap-guard'
import {
  buildSellLayer,
  deriveSellableCells,
  freePockets,
  mergeBands,
  trackFree,
  type SellResourceLane,
  type SellStaffLane,
} from '@/business/lib/canon-logic/availability'

// canon's own HQ band for the 美容整体 world its dialog was written against.
const HQ = { hqMin: 6600, hqMax: 7260 }

describe('pricing — canon fable-store-today.html :3046–3094, :4839, :4997–5032', () => {
  it('the curve dips exactly as far as canon says it can', () => {
    // canon :4838 — min multiplier is .85, so the deepest dip is 15%.
    expect(CURVE_MAX_DIP).toBeCloseTo(0.15, 10)
  })

  it('priceAt scales the list price by the store lever, then the hour curve', () => {
    // Hand-run on canon's own defaults (list 7000, base 7130):
    // 17:00 sits at the curve's peak (1.0) → no discount at any depth.
    expect(priceAt(7000, 17, 7130, 7130, 30)).toBe(7000)
    // 10:00 sits at the curve's floor (.85) → the FULL configured depth:
    //   depth = (1 − .85) / .15 × .30 = .30 → 7000 × .70 = 4900
    expect(priceAt(7000, 10, 7130, 7130, 30)).toBe(4900)
    // A lever above the base scales every list price proportionally:
    //   list = 7700 × 7843/7130 = 8470
    //   depth = (1 − .95) / .15 × .20 = .0666… → 8470 × .93333 = 7905.33
    //   ¥10 rounding, once, at the end → 7910
    expect(priceAt(7700, 12, 7843, 7130, 20)).toBe(7910)
  })

  it('clampPriceInputs is where the −30% floor lives', () => {
    // Above HQ's ceiling clamps down; the floor is the ceiling × 0.7, ¥10.
    expect(clampPriceInputs(7500, 0, HQ)).toEqual({ hi: 7260, lo: 5080, floor: 5080 })
    // Below HQ's floor clamps up; a 最低価格 above 最高価格 is pulled back to it.
    expect(clampPriceInputs(6500, 7000, HQ)).toEqual({ hi: 6600, lo: 6600, floor: 4620 })
    // canon's own shipped defaults (:3047/:3050) land untouched.
    expect(clampPriceInputs(7130, 6270, { hqMin: 6600, hqMax: 7260 })).toEqual({ hi: 7130, lo: 6270, floor: 4990 })
  })

  it('the guardrail sentence quotes the clamp, so it cannot drift from it', () => {
    expect(floorDiscountPercent(7260)).toBe(30)
    expect(floorDiscountPercent(7130)).toBe(30)
    expect(floorDiscountPercent(6600)).toBe(30)
  })

  it('the two annotations beside the inputs (canon :3084–3086)', () => {
    expect(hqNote(6600, 6600)).toBe('標準')
    expect(hqNote(7260, 6600)).toBe('+10%')
    expect(discountNote(7260, 7260)).toBe('割引なし')
    expect(discountNote(7260, 5080)).toBe('−30%')
    expect(discountNote(7260, 6534)).toBe('−10%')
  })

  it('the save button reports STATE, not an offer (canon :3058)', () => {
    expect(priceButtonCaption(0, true)).toBe('公開枠なし')
    expect(priceButtonCaption(2, false)).toBe('公開価格は変更されていません')
    expect(priceButtonCaption(2, true)).toBe('2枠の公開価格を更新')
  })

  it('both framings quote the same two prices, from opposite ends (canon :3068)', () => {
    expect(framingSample(7260, 5080, 'discount')).toBe(
      '例: 定価 ¥7,260 → 空き時間帯は最大−30%（¥5,080）の割引表示（枠の実価格は同じ・Reserve側の表示に反映）',
    )
    expect(framingSample(7260, 5080, 'markup')).toBe(
      '例: 基準 ¥5,080 → 人気時間帯は+43%（¥7,260）の加算表示（枠の実価格は同じ・Reserve側の表示に反映）',
    )
    expect(framingSample(7260, 7260, 'discount')).toBe(
      '最低価格＝最高価格：全時間帯が定価表示になります（枠の実価格は同じ・Reserve側の表示に反映）',
    )
  })

  it('gap-fill pro-rates hour by hour and rounds ONCE (canon :4997–5020)', () => {
    const frame = { hi: 7130, lo: 4990, hqMin: 7130, hqMax: 7130 }
    // No depth: every hour is the flat list price, so a straddling hour is too.
    expect(gapFillRawTotal(7000, 13 * 60 + 30, 14 * 60 + 30, frame, 0)).toBe(7000)
    // Depth 30: 13:00 curve .92 → 7000 × (1 − .08/.15 × .3) = 5880
    //           14:00 curve .85 → 7000 × .70               = 4900
    //           half an hour of each                       = 5390
    expect(gapFillRawTotal(7000, 13 * 60 + 30, 14 * 60 + 30, frame, 30)).toBe(5390)
    // …then the 10% スキマ割 (4851) is BELOW HQ's floor (4900), so the floor wins.
    expect(gapFillPrice(7000, 13 * 60 + 30, 14 * 60 + 30, frame, 30, 10)).toBe(4900)
    // A packed session takes no discount, so it stays at the pro-rated total.
    expect(packedPrice(7000, 13 * 60 + 30, 14 * 60 + 30, frame, 30)).toBe(5390)
  })

  it('packedPrice is a tripwire, not a clamp — it throws if the depth cap moves', () => {
    const frame = { hi: 7130, lo: 4990, hqMin: 7130, hqMax: 7130 }
    // 60% depth is outside the store's 0–30 lever; canon's own guarantee that a
    // full-price session always clears the floor stops holding, and it says so.
    expect(() => packedPrice(7000, 14 * 60, 15 * 60, frame, 60)).toThrow(/below the floor/)
  })

  it('the three price zones, and the flat day that refuses to invent them', () => {
    expect(tierOf(6500, 6000, 9000)).toBe(1)
    expect(tierOf(7500, 6000, 9000)).toBe(2)
    expect(tierOf(8500, 6000, 9000)).toBe(3)
    // Spread under 5% of the floor → one zone for the whole day (canon :5351).
    expect(tierOf(7000, 7000, 7100)).toBe(2)
    expect(tierOf(7100, 7000, 7100)).toBe(2)
    // A bed cell has no price of its own and never colours a zone.
    expect(tierOf(null, 6000, 9000)).toBe(1)
  })

  it('priceLabel (canon :5340)', () => {
    expect(priceLabel(7000, 7000)).toBe('¥7,000')
    expect(priceLabel(6160, 7000)).toBe('¥6,160〜')
  })
})

describe('drag rules — canon :3698–3747, :3889, :4488, :4681', () => {
  // A 9-hour board: one 30-minute step is (100/9)/2 = 5.5556% of it.
  const H = 9
  const STEP = stepPct(H)

  it('one step is one half hour of the board', () => {
    expect(STEP).toBeCloseTo(100 / 9 / 2, 10)
    expect(stepPct(11)).toBeCloseTo(100 / 11 / 2, 10)
  })

  it('snapFloor and snapCeil are mirrors, and neither drifts off a lattice point', () => {
    expect(snapFloor(12, STEP)).toBeCloseTo(2 * STEP, 9)
    expect(snapCeil(12, STEP)).toBeCloseTo(3 * STEP, 9)
    // Already ON a point: floor must not fall to the point below (the 1e-9).
    expect(snapFloor(2 * STEP, STEP)).toBeCloseTo(2 * STEP, 9)
    expect(snapCeil(2 * STEP, STEP)).toBeCloseTo(2 * STEP, 9)
  })

  it('the dual lattice PRESERVES an odd start on a small nudge…', () => {
    // A card at 12% carries a 0.889% phase (12 − 2×5.5556).
    const origin = latticeOrigin(12, STEP)
    expect(origin).toBeCloseTo(12 - 2 * STEP, 9)
    // Dragged to 13%: its own lattice offers 12.0 (1.0 away), the clean lattice
    // offers 11.111 (1.889 away) — the card's own phase is nearer, so it wins
    // and the odd minute survives the move.
    expect(dualLatticeX(13, origin, 0, 100, STEP)).toBeCloseTo(12, 6)
  })

  it('…and HEALS it when the card is carried at a clean slot', () => {
    const origin = latticeOrigin(12, STEP)
    // Dragged to 14.5%: clean offers 16.667 (2.167 away), its own lattice offers
    // 12.0 (2.5 away) — clean is nearer, so the card lands clean and from then
    // on has no phase left to preserve.
    expect(dualLatticeX(14.5, origin, 0, 100, STEP)).toBeCloseTo(3 * STEP, 6)
    // A card already in phase with the clean lattice skips the composition.
    expect(dualLatticeX(14.5, 0, 0, 100, STEP)).toBeCloseTo(3 * STEP, 6)
  })

  it('the clamp lands ON the lattice rather than on the bare bound', () => {
    const origin = latticeOrigin(12, STEP)
    // Pulled hard left: the low bound is 0, but the card's own lattice's lowest
    // point at or above 0 is its phase itself — not 0, which would kill it.
    expect(dualLatticeX(-40, origin, 0, 100, STEP)).toBeCloseTo(0, 6)
    // Bounded to a window narrower than a step: it cannot escape it.
    const v = dualLatticeX(90, 0, 0, 3 * STEP, STEP)
    expect(v).toBeLessThanOrEqual(3 * STEP + 1e-9)
  })

  it('the grab point decides move vs resize (canon :4435)', () => {
    expect(dragModeFor(105, 100, 300)).toBe('resizeL')
    expect(dragModeFor(295, 100, 300)).toBe('resize')
    expect(dragModeFor(200, 100, 300)).toBe('move')
  })

  it('each mode moves its own edge and clamps to its own bound', () => {
    const at = { x: 2 * STEP, w: 2 * STEP }
    const move = dragOrigin(at.x, at.w, 'move', STEP)
    expect(dragGeometry(move, STEP, STEP)).toEqual({ x: 3 * STEP, w: 2 * STEP })
    // A move can never push the card past the right edge of the board.
    expect(dragGeometry(move, 400, STEP).x).toBeCloseTo(100 - 2 * STEP, 6)

    const right = dragOrigin(at.x, at.w, 'resize', STEP)
    const grown = dragGeometry(right, STEP, STEP)
    expect(grown.x).toBeCloseTo(2 * STEP, 9)
    expect(grown.w).toBeCloseTo(3 * STEP, 9)
    // …and a resize can never shrink the card below one step.
    expect(dragGeometry(right, -400, STEP).w).toBeCloseTo(STEP, 6)

    const left = dragOrigin(at.x, at.w, 'resizeL', STEP)
    const pulled = dragGeometry(left, -STEP, STEP)
    expect(pulled.x).toBeCloseTo(STEP, 6)
    expect(pulled.w).toBeCloseTo(3 * STEP, 6)
  })

  it('keyboard nudges move 30 minutes, and say so when they cannot', () => {
    const n = keyboardNudge(2 * STEP, 2 * STEP, 'resizeL', -1, STEP)!
    expect(n.x).toBeCloseTo(STEP, 6)
    expect(n.w).toBeCloseTo(3 * STEP, 6)
    // At the board's left edge there is nowhere further to go — null, so the
    // caller can announce it rather than silently doing nothing.
    expect(keyboardNudge(0, 2 * STEP, 'resizeL', -1, STEP)).toBeNull()
    // Same at the right edge for the end handle.
    expect(keyboardNudge(100 - 2 * STEP, 2 * STEP, 'resize', 1, STEP)).toBeNull()
    // Shrinking the start handle can never cross the end handle.
    expect(keyboardNudge(0, STEP, 'resizeL', 1, STEP)).toBeNull()
  })

  it('back-to-back is not an overlap, but one minute is (canon :4676)', () => {
    const HOUR = 100 / 9
    // 11:00–12:00 followed by 12:00–13:00: legal, and three-decimal rounding
    // must not turn it into a conflict.
    expect(spansOverlap(0, HOUR, HOUR, HOUR)).toBe(false)
    expect(spansOverlap(0, 11.111, 11.111, 11.111)).toBe(false)
    // One real minute of overlap on a 9-hour board is 0.185% — caught.
    expect(spansOverlap(0, HOUR, HOUR - 100 / 540, HOUR)).toBe(true)
    expect(spansOverlap(0, HOUR, HOUR / 2, HOUR)).toBe(true)
  })

  it('a parked card comes back on the same lattice, centred on the pointer', () => {
    // Dropped at 50% of a lane with a 2-step card: the centre lands at 50, so
    // the left edge wants 50 − STEP and snaps from there.
    const landed = shelfLanding(0.5, 2 * STEP, 0, STEP)
    expect(landed % STEP).toBeCloseTo(0, 6)
    expect(Math.abs(landed - (50 - STEP))).toBeLessThanOrEqual(STEP / 2 + 1e-6)
  })
})

describe('the 仮押さえ checks — canon computeChecks :4691', () => {
  const HOUR = 100 / 9
  const base = {
    bookingId: 'apt-1',
    staffName: '見本 しろう',
    staffUntil: '18:00',
    laneLocked: false,
    minutesOf: (x: number) => Math.round(600 + (x / 100) * 540),
  }

  it('a clean landing passes every check and unlocks 確定', () => {
    const checks = computeChecks(
      { x: 0, w: HOUR },
      { ...base, spans: [{ id: 'apt-2', x: 2 * HOUR, w: HOUR, title: '見本 はなこ', derived: false, parked: false }] },
    )
    expect(checks.map((c) => c.label)).toEqual([
      '時間帯の重複なし',
      '見本 しろうの勤務時間内（〜18:00）',
      '整体資格 一致',
      '予約時価格を保持（動的価格は適用しません）',
    ])
    expect(confirmCaption(checks)).toEqual({ enabled: true, label: 'この内容で確定' })
  })

  it('a real conflict names who it hit, and the button says the placement is refused', () => {
    const checks = computeChecks(
      { x: 0, w: HOUR },
      {
        ...base,
        spans: [
          { id: 'apt-2', x: HOUR / 2, w: HOUR, title: '見本 はなこ', derived: false, parked: false },
          { id: 'apt-3', x: HOUR / 2, w: HOUR, title: '見本 はなこ', derived: false, parked: false },
        ],
      },
    )
    // Deduplicated — one person, named once.
    expect(checks[0]).toEqual({ ok: false, label: '時間帯が重複: 見本 はなこ' })
    expect(confirmCaption(checks)).toEqual({ enabled: false, label: 'この位置では確定できません' })
  })

  it('derived inventory yields instead of blocking, and says it will be recomputed', () => {
    const checks = computeChecks(
      { x: 0, w: HOUR },
      { ...base, spans: [{ id: 'cleanup-1', x: HOUR / 2, w: HOUR, title: '清掃', derived: true, parked: false }] },
    )
    expect(checks[0].ok).toBe(true)
    expect(checks[1].label).toBe('空き枠・清掃は確定時に自動再配置（清掃バッファは設定に従う）')
    expect(confirmCaption(checks).enabled).toBe(true)
  })

  it('a parked card holds no ground, and the card itself is never its own conflict', () => {
    const checks = computeChecks(
      { x: 0, w: HOUR },
      {
        ...base,
        spans: [
          { id: 'apt-1', x: 0, w: HOUR, title: '自分', derived: false, parked: false },
          { id: 'apt-9', x: 0, w: HOUR, title: '棚の上', derived: false, parked: true },
        ],
      },
    )
    expect(checks[0]).toEqual({ ok: true, label: '時間帯の重複なし' })
  })

  it('past the shift end, and on a locked lane, the placement is refused with the reason', () => {
    // 8 hours in from 10:00 ends at 18:00 exactly — still inside.
    expect(computeChecks({ x: 7 * HOUR, w: HOUR }, { ...base, spans: [] })[1].ok).toBe(true)
    const late = computeChecks({ x: 8 * HOUR, w: HOUR }, { ...base, spans: [] })
    expect(late[1]).toEqual({ ok: false, label: '見本 しろうは18:00以降勤務不可' })
    const locked = computeChecks({ x: 0, w: HOUR }, { ...base, spans: [], laneLocked: true })
    expect(locked.some((c) => c.label === '見本 しろうはシフトロック中（新規配置不可）')).toBe(true)
    expect(confirmCaption(locked).enabled).toBe(false)
  })
})

describe('スキマガード — ported from gap-guard-engine.js', () => {
  const guard = createGapGuard({
    services: [{ name: '美容整体60分', dur: 60 }],
    protectedDurationMin: 90,
    protectedLabel: '新規',
    gapFillMinMin: 0,
    mode: 'standard',
  })

  it('durationSet unions the menu lengths with the protected length', () => {
    expect(guard.durationSet()).toEqual([60, 90])
  })

  it('fillableExactly is the 5-minute coin problem', () => {
    expect(guard.fillableExactly(0)).toBe(true)
    expect(guard.fillableExactly(120)).toBe(true) // 60 + 60
    expect(guard.fillableExactly(150)).toBe(true) // 90 + 60
    expect(guard.fillableExactly(50)).toBe(false)
    expect(guard.fillableExactly(55)).toBe(false)
    expect(guard.fillableExactly(-60)).toBe(false)
  })

  it('fillDecomposition is greedy and ADMITS it, exactly as canon documents', () => {
    const g = createGapGuard({ services: [{ name: 'a', dur: 45 }, { name: 'b', dur: 60 }], protectedDurationMin: 90 })
    expect(g.fillDecomposition(150)).toEqual([90, 60])
    // 105 = 45 + 60, but largest-first takes 90 and jams on the remaining 15.
    // canon keeps this behaviour deliberately (:107–110) — the caller treats
    // null as "show it as its own offer" rather than pretending it packed.
    expect(g.fillableExactly(105)).toBe(true)
    expect(g.fillDecomposition(105)).toBeNull()
  })

  it('protectedCapacity counts non-overlapping 新規 windows, earliest-finish', () => {
    // A 240-minute pocket holds two 90-minute windows (0–90, 90–180); the third
    // would run past the end.
    const cap = guard.protectedCapacity({ s: 0, e: 240 }, null)
    expect(cap.before).toBe(2)
    expect(cap.beforeStarts).toEqual([0, 90])
  })

  it('a 60 placed at the pocket edge costs NOTHING and passes', () => {
    // Hand-run: placing 0–60 leaves 60–150 and 150–240 for two 新規 windows, so
    // protected capacity is unchanged; the 180-minute residue is exactly
    // fillable (60×3) so nothing is dead, and no other menu length is lost.
    const r = guard.evaluate({ s: 0, e: 240 }, { start: 0, dur: 60 })
    expect(r.protectedCapacityBefore).toBe(2)
    expect(r.protectedCapacityAfter).toBe(2)
    expect(r.verdict).toBe('ok')
  })

  it('the same 60 placed five minutes in is REFUSED, and points at the safe starts', () => {
    // Hand-run: 5–65 leaves a 5-minute stub and a 175-minute residue that no
    // combination of 60/90 can fill — 180 dead minutes — AND it destroys one
    // 新規 window. Both worse than start 0, so it is refused with choices.
    const r = guard.evaluate({ s: 0, e: 240 }, { start: 5, dur: 60 })
    expect(r.verdict).toBe('refuse')
    expect(r.reason!.code).toBe('R-REP')
    expect(r.reason!.params.label).toBe('新規（90分）')
    expect(r.reason!.ackAllowed).toBe(true) // standard mode lets a lead override
    expect(r.alternativeKind).toBe('safe')
    expect(r.alternatives).toContain(0)
  })

  it('strict mode refuses the same placement WITHOUT an override', () => {
    const strict = createGapGuard({
      services: [{ name: '美容整体60分', dur: 60 }],
      protectedDurationMin: 90,
      gapFillMinMin: 0,
      mode: 'strict',
    })
    expect(strict.evaluate({ s: 0, e: 240 }, { start: 5, dur: 60 }).reason!.ackAllowed).toBe(false)
  })

  it('when EVERY start loses the same, it degrades rather than refusing', () => {
    // A 180-minute pocket holds two 新規 windows, and any 60 placed in it kills
    // one. Nowhere is better, so the loss is logged, not blocked.
    const r = guard.evaluate({ s: 0, e: 180 }, { start: 0, dur: 60 })
    expect(r.verdict).toBe('degraded')
    expect(r.protectedCapacityLoss).toBe(1)
    expect(r.leastLossStart).toBe(0)
    expect(r.reason!.code).toBe('DEGRADED')
    // The underlying reason survives into the log — a lead reading it later can
    // still see WHAT was unavoidable.
    expect(r.reason!.params.capacityLost).toBe(1)
  })

  it('safeStarts returns the zero-loss starts, and only those', () => {
    const safe = guard.safeStarts({ s: 0, e: 240 }, 60)
    expect(safe).toContain(0)
    expect(safe).toContain(180)
    expect(safe).not.toContain(5)
    expect(safe).not.toContain(60)
  })

  it('a placement the world cannot host is refused before any ranking', () => {
    const r = guard.evaluate({ s: 0, e: 240 }, { start: 0, dur: 60 }, { placementFeasible: (s) => s >= 60 })
    expect(r.verdict).toBe('refuse')
    expect(r.reason!.code).toBe('R-UNAVAILABLE')
    // Never ackAllowed: impossible is not a judgement call.
    expect(r.reason!.ackAllowed).toBe(false)
  })

  it('a residue against a wall was never sellable, so it is EXEMPT rather than dead', () => {
    // 0–65 in a 65-minute pocket walled on both sides: the 5-minute stub would
    // be dead time, except the wall says it was never on sale.
    const g = createGapGuard({ services: [{ name: 'a', dur: 60 }], protectedDurationMin: null, gapFillMinMin: 0 })
    const r = g.evaluate({ s: 0, e: 65, walls: { left: 'opening', right: 'closing' } }, { start: 0, dur: 60 })
    expect(r.verdict).toBe('exempt')
    expect(r.reason!.code).toBe('EXEMPT')
    expect(r.reason!.params.trigger).toBe('wall')
    expect(r.reason!.params.wallType).toBe('closing')
  })

  it('a salvageable residue is counted apart from a dead one', () => {
    // With a 30-minute スキマ枠 dial, a 35-minute leftover is salvage, not dead.
    // The menu here is longer than the whole pocket, so no repertoire is lost
    // either and the salvage term is what the reason ends up reporting.
    const g = createGapGuard({ services: [{ name: 'a', dur: 120 }], protectedDurationMin: null, gapFillMinMin: 30 })
    const r = g.evaluate({ s: 0, e: 95 }, { start: 0, dur: 60 })
    expect(r.verdict).toBe('degraded')
    expect(r.reason!.code).toBe('DEGRADED')
    expect(r.reason!.params.n).toBe(35)
    // Without the dial the same 35 minutes are honestly dead, not salvage.
    const noDial = createGapGuard({ services: [{ name: 'a', dur: 120 }], protectedDurationMin: null, gapFillMinMin: 0 })
    expect(noDial.evaluate({ s: 0, e: 95 }, { start: 0, dur: 60 }).reason!.params.n).toBe(35)
  })
})

describe('availability — canon deriveSellableCells :4868, mergeBands :5304, density :5369', () => {
  const HOURS = { open: 10 * 60, close: 19 * 60 }
  const staff = (over: Partial<SellStaffLane> = {}): SellStaffLane => ({
    key: 's1', name: '見本 しろう', from: 10 * 60, until: 19 * 60, locked: false, occupied: [], listPrice: 7000, stores: null, ...over,
  })
  const bed = (over: Partial<SellResourceLane> = {}): SellResourceLane => ({ key: 'b1', name: 'ベッド1', occupied: [], storeId: 'store-a', ...over })
  const flat = { open: HOURS.open, close: HOURS.close, gridMin: 60, priceFor: () => 7000 }

  it('trackFree is a plain interval test, back-to-back included', () => {
    const busy = [{ start: 600, end: 660 }]
    expect(trackFree(busy, 660, 720)).toBe(true)
    expect(trackFree(busy, 630, 690)).toBe(false)
    expect(trackFree(busy, 540, 600)).toBe(true)
  })

  it('a window needs BOTH a free person and a free bed', () => {
    // One staff, no beds at all: canon offers nothing (:4906).
    expect(deriveSellableCells({ ...flat, staffLanes: [staff()], resourceLanes: [], now: null })).toEqual([])
    // One staff, one bed: nine hours → nine windows, mirrored onto the bed lane.
    const cells = deriveSellableCells({ ...flat, staffLanes: [staff()], resourceLanes: [bed()], now: null })
    expect(cells.filter((c) => c.group === 'staff')).toHaveLength(9)
    expect(cells.filter((c) => c.group === 'beds')).toHaveLength(9)
  })

  it('a person is never paired with a bed in a store they do not work in', () => {
    // Under viewAll the board sees both stores. Pairing across them would
    // advertise a window no store could actually run (⚖ 8/9), so it does not.
    const cells = deriveSellableCells({
      ...flat,
      staffLanes: [staff({ stores: ['store-a'] })],
      resourceLanes: [bed({ key: 'b-other', storeId: 'store-b' })],
      now: null,
    })
    expect(cells).toEqual([])
    // The same person WITH a bed in their own store sells normally…
    expect(
      deriveSellableCells({
        ...flat,
        staffLanes: [staff({ stores: ['store-a'] })],
        resourceLanes: [bed({ key: 'b-other', storeId: 'store-b' }), bed()],
        now: null,
      }).filter((c) => c.group === 'staff'),
    ).toHaveLength(9)
    // …and a floating member (stores: null) works anywhere.
    expect(
      deriveSellableCells({
        ...flat,
        staffLanes: [staff({ stores: null })],
        resourceLanes: [bed({ key: 'b-other', storeId: 'store-b' })],
        now: null,
      }).filter((c) => c.group === 'staff'),
    ).toHaveLength(9)
  })

  it('two free people and ONE bed advertise one window, not two (canon :4907–4914)', () => {
    const cells = deriveSellableCells({
      ...flat,
      staffLanes: [staff(), staff({ key: 's2', name: '見本 はなこ' })],
      resourceLanes: [bed()],
      now: null,
    })
    // Paired index-wise and truncated at the shorter list: the second person
    // has no bed, so the board never promises a window the store cannot honour.
    expect(cells.filter((c) => c.group === 'staff' && c.h === 600).map((c) => c.laneKey)).toEqual(['s1'])
  })

  it('past hours are not inventory, and "now" rounds UP to the grid (canon :4880)', () => {
    // 13:24 on a 60-minute grid: the first sellable start is 14:00.
    const cells = deriveSellableCells({ ...flat, staffLanes: [staff()], resourceLanes: [bed()], now: 13 * 60 + 24 })
    expect(Math.min(...cells.map((c) => c.h))).toBe(14 * 60)
    // On a 30-minute grid the same clock first sells at 13:30.
    const finer = deriveSellableCells({ ...flat, gridMin: 30, staffLanes: [staff()], resourceLanes: [bed()], now: 13 * 60 + 24 })
    expect(Math.min(...finer.map((c) => c.h))).toBe(13 * 60 + 30)
  })

  it('a booking, a shift bound and a lock each remove their own windows', () => {
    const busy = deriveSellableCells({
      ...flat,
      staffLanes: [staff({ occupied: [{ start: 12 * 60, end: 13 * 60 }] })],
      resourceLanes: [bed()],
      now: null,
    })
    expect(busy.some((c) => c.h === 12 * 60)).toBe(false)
    const short = deriveSellableCells({ ...flat, staffLanes: [staff({ until: 15 * 60 })], resourceLanes: [bed()], now: null })
    expect(Math.max(...short.map((c) => c.h))).toBe(14 * 60)
    expect(deriveSellableCells({ ...flat, staffLanes: [staff({ locked: true })], resourceLanes: [bed()], now: null })).toEqual([])
  })

  it('bands merge adjacent hours of the SAME tier, and break at a tier change', () => {
    const cells = [
      { laneKey: 's1', resourceKey: 'b1', group: 'staff' as const, h: 600, staff: 'A', bed: 'B', price: 7000, tier: 1 as const },
      { laneKey: 's1', resourceKey: 'b1', group: 'staff' as const, h: 660, staff: 'A', bed: 'B', price: 7000, tier: 1 as const },
      { laneKey: 's1', resourceKey: 'b1', group: 'staff' as const, h: 720, staff: 'A', bed: 'B', price: 9000, tier: 3 as const },
    ]
    const bands = mergeBands(cells)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toMatchObject({ hStart: 600, hEnd: 720, lo: 7000, hi: 7000 })
    expect(bands[1]).toMatchObject({ hStart: 720, hEnd: 780, tier: 3 })
  })

  it('the chip carries canon’s counter word and punctuation', () => {
    const cells = deriveSellableCells({ ...flat, staffLanes: [staff()], resourceLanes: [bed()], now: null })
    const layer = buildSellLayer(cells, true)
    // One merged band across nine identical-price hours.
    expect(layer.staffBands).toHaveLength(1)
    expect(layer.chipLabel).toBe('オンライン販売中 1窓 · ¥7,000')
    // With slot prices switched off the price half disappears, the count stays.
    expect(buildSellLayer(cells, false).chipLabel).toBe('オンライン販売中 1窓')
  })

  it('E9c: past the density ceiling, tint degrades to drag-only', () => {
    // 13 lanes each holding one lonely hour = 13 bands, one over the ceiling.
    const many = Array.from({ length: 13 }, (_, i) => ({
      laneKey: `s${i}`, resourceKey: 'b1', group: 'staff' as const, h: 600 + i * 60,
      staff: `A${i}`, bed: 'B', price: 7000 + i * 100, tier: 1 as const,
    }))
    expect(buildSellLayer(many, true).degraded).toBe(true)
    expect(buildSellLayer(many.slice(0, 12), true).degraded).toBe(false)
  })

  it('free pockets carry their walls, so the guard knows what was never for sale', () => {
    const pockets = freePockets({ from: 600, until: 1140, occupied: [{ start: 720, end: 780 }] })
    expect(pockets).toEqual([
      { s: 600, e: 720, walls: { left: 'opening', right: null } },
      { s: 780, e: 1140, walls: { left: null, right: 'closing' } },
    ])
    // A fully booked lane has no pockets rather than a zero-length one.
    expect(freePockets({ from: 600, until: 660, occupied: [{ start: 600, end: 660 }] })).toEqual([])
  })
})
