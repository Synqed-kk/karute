// THE PARITY BATTERY (R2 of the 今日の運営 layer rebuild).
//
// WHAT THIS FILE PROVES, STATED NARROWLY — because the honest scope is smaller
// than "the book's answers are today's answers", and a proof artifact that
// oversells itself is worth less than one that does not.
//
// Both sides bottom out in the SAME search: `bedFeasibility` calls
// `allocateBed`, and the book calls `allocateBed`. So agreement here CANNOT
// prove that the search is right, and — stated plainly after the R3 blind round
// — it does not prove the SWAP either. This file proves that TWO
// IMPLEMENTATIONS OF THE SAME QUESTION AGREE. That the screen now asks a
// DIFFERENT question at rest (a new client, rather than the staged card) is
// R3's subject and is pinned where it happens, in the screen's own suite
// (`today-screen-interactions.test.ts`, the ⚖ R3 one world describe) and in
// RAIL-DELTA-r3.
//
// What agreement here does prove is the two things a new layer can actually get
// wrong around that one search:
//
//   1. the book's memoisation and cache keying never corrupt that one search
//      (index-keyed lattice rows, per-duration and per-store-binding keys, the
//      two-world split, the 満室 run walk, the mask) — a wrong key returns
//      another question's answer, and that IS visible here;
//   2. the shadow wiring's bindings match the rail's — same stores, same hand,
//      same length, same clock (P8 pins the assembly itself).
//
// WHAT IT DOES NOT TOUCH: the board's OTHER bed readers — the sell layer's
// per-slot Set, the gap layer's `bedLedger`, the confirm gate's span overlap.
// Those are the readers the rebuild exists to delete, and comparing them is
// R3+'s subject, not this round's. Nor does it exercise `newClientMask`,
// `freeBedKeys`/`freeBedCount` or any of Phase 2 against a legacy counterpart
// — see R3-DEBT-r2.md for the full uncompared surface and the binding gap that
// comes with it.
//
// HOW EVERY CLAIM IS MADE. Both paths are driven on the SAME lanes, and the
// mapping between them is spelled at each P-item rather than assumed:
//
//   legacy  `bedFeasibility(lanes, excludeId, policy)(lane, start, dur)`
//           — today-interactions :1549, the callback the 60分配置 rail is
//             handed (⚖ flag 76). Its bindings are fixed by that function:
//             `id: excludeId`, `currentBed:` the bed lane holding excludeId,
//             `vip:` that booking's own category, `stores: lane.stores`.
//   book    `bedTruthViews(lanes, policy, frame, hand).world` (no hand) or
//           `.worldMinusHand` (hand), asked `bedFor(start, start+dur, asker)`
//           where the asker is the SAME four facts — a `NewClient` when the
//           rail excludes nobody, a `Subject` when it excludes the hand.
//
// The board under test is the REAL one: `TodayPage` is executed and the props
// it hands `TodayScreen` are read, so the lanes, the room policy, the hours
// and the dials are the ones the operator sees, assembled by page.tsx rather
// than by this file. Territory has no DOM renderer — business-isolation.test.ts
// allows only react/next/node bare packages, so @testing-library never
// resolves here.
//
// ⚖ R3 (2026-08-25) — THE CANARY IS GONE AND THE PARITY IS NOT. R2's shadow
// reader (`shadowArgs`, `shadowCompare`, the env allowlist, the hook) existed
// to prove the book's answers equalled the rail's BEFORE the rail read the
// book. R3 wired the book in for real, so there is one answer and nothing left
// to compare: every pin that drove that machinery is deleted with it (named in
// PIN-DELTA-r3, reason "R2 canary retired by R3's real wiring"). What SURVIVES
// is this file's whole point — `bedFor` ≡ `bedFeasibility` on the real board,
// on synthetic boards and across the dials — and it is now the live proof that
// the swap did not drift the search underneath the operator.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { STORE_A } from '@/business/lib/fixtures'
import {
  bedTruthViews,
  LATTICE_STEP_MIN,
  type Asker,
  type BedTruth,
  type DayFrame,
} from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import {
  bedFeasibility,
  gapLayerFor,
  guardRailsFor,
  sellLayerFor,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { cleanupBlocks, hhmm, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

// ── the real board, assembled by the page itself ────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function screenProps(node: any): TodayProps | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === TodayScreen) return node.props
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = screenProps(kid)
    if (hit) return hit
  }
  return null
}

/** The props the screen is handed for the operator's own store — one build for
 *  the whole file, because it is a pure read of the fixture world and every
 *  P-item asks about the SAME board. */
let REAL: TodayProps

beforeAll(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z'))
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({ select: () => chain(r), eq: () => chain(r), maybeSingle: async () => r })
  service.mockReturnValue({
    from: (table: string) =>
      chain(
        table === 'business_workspace_grants'
          ? { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null }
          : table === 'profiles'
            ? { data: { customer_id: 'biz-1', is_management: false }, error: null }
            : { data: null, error: null },
      ),
  })
  REAL = screenProps(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ store: STORE_A }),
    }),
  )!
})

afterAll(() => jest.useRealTimers())

// ── the shared mapping, written once ────────────────────────────────────────

const staffLanesOf = (lanes: BoardLane[]) => lanes.filter((l) => l.group === 'staff')

/** Every lattice start the day has, exactly the book's own lattice: anchored to
 *  the absolute clock (not to the door) and stopping one step before closing.
 *  See capacity-ledger's `latticeStart` comment for why the anchor matters. */
function latticeOf(hours: { open: number; close: number }): number[] {
  const first = Math.ceil(hours.open / LATTICE_STEP_MIN) * LATTICE_STEP_MIN
  const out: number[] = []
  for (let s = first; s < hours.close; s += LATTICE_STEP_MIN) out.push(s)
  return out
}

const frameOf = (hours: { open: number; close: number }, nowMin: number): DayFrame => ({
  openMin: hours.open,
  closeMin: hours.close,
  nowMin,
})

/** THE HAND, bound exactly as `bedFeasibility` binds it (today-interactions
 *  :1555-1558): the booking's own card anywhere on the board for its 個室のみ
 *  tag, and the BED lane it is standing on for the room it carries in. */
function handBinding(lanes: BoardLane[], handId: string) {
  const held = lanes.flatMap((l) => l.items).find((i) => i.caseId === handId)
  const currentBed = lanes.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === handId))?.key ?? null
  return { held, currentBed, requiresPrivate: held?.requiresPrivateRoom === true }
}

/** ONE comparison, run on every board this file touches. Returns the number of
 *  (lane, start) questions asked and the disagreements found — a count rather
 *  than a boolean, so a battery that silently stopped asking cannot pass. */
function parityRun(
  lanes: BoardLane[],
  hours: { open: number; close: number },
  nowMin: number,
  durs: number[],
  handId: string | null = null,
): { asked: number; diverged: string[]; truth: BedTruth } {
  const views = bedTruthViews(lanes, frameOf(hours, nowMin), handId === null ? null : { id: handId })
  const truth = views.worldMinusHand ?? views.world
  const { currentBed, requiresPrivate } =
    handId === null ? { currentBed: null, requiresPrivate: false } : handBinding(lanes, handId)
  const legacy = bedFeasibility(lanes, handId)!
  const starts = latticeOf(hours)
  const diverged: string[] = []
  let asked = 0
  for (const lane of staffLanesOf(lanes)) {
    const asker = (): Asker =>
      handId === null ? { stores: lane.stores } : { id: handId, currentBed, requiresPrivate, stores: lane.stores }
    for (const dur of durs) {
      for (const start of starts) {
        asked += 1
        const theirs = legacy(lane, start, dur)
        const ours = truth.bedFor(start, start + dur, asker()).laneKey !== null
        if (theirs !== ours) diverged.push(`${lane.key}@${start}/${dur}: rail=${theirs} book=${ours}`)
      }
    }
  }
  return { asked, diverged, truth }
}

// ── the synthetic boards (P4 · P5) ──────────────────────────────────────────
//
// R1's battery exports the same builder, but a test file cannot be imported by
// another test file without RE-REGISTERING its 74 tests inside this suite
// (measured, 2026-08-25) — so the shape is rebuilt here from the same
// today-board primitives (`place`, `cleanupBlocks`, `BoardItem`, `BoardLane`)
// rather than borrowed. Deterministic: one seed in, the same board out.

interface Spec {
  staff: number
  beds: number
  stores: string[]
  profile: 'sparse' | 'dense'
  seed: number
  privateBeds?: number
  cleanupMinutes?: number
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const pad = (n: number) => String(n + 1).padStart(2, '0')

function synthBoard(spec: Spec, hours: Hours): BoardLane[] {
  const privateBeds = spec.privateBeds ?? 1
  const next = rng(spec.seed)
  const perLane = spec.profile === 'dense' ? 5 : 2
  const durations = [45, 60, 90] as const
  const isPrivate = (j: number) => j >= spec.beds - privateBeds
  const storeOfStaff = (i: number) => spec.stores[i % spec.stores.length]
  const storeOfBed = (j: number) => spec.stores[j % spec.stores.length]
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    a.end > b.start && a.start < b.end

  const made: Array<{ id: string; staff: number; bed: number; vip: boolean; start: number; end: number }> = []
  const busy = (staffI: number, bedJ: number, span: { start: number; end: number }) =>
    made.some((b) => (b.staff === staffI || b.bed === bedJ) && overlaps(b, span))

  for (let i = 0; i < spec.staff; i += 1) {
    for (let n = 0; n < perLane; n += 1) {
      const dur = durations[Math.floor(next() * durations.length) % durations.length]
      const steps = Math.floor((hours.close - hours.open - dur) / 30)
      const start = hours.open + Math.floor(next() * (steps + 1)) * 30
      const span = { start, end: start + dur }
      const vip = (i + n) % 7 === 0
      // ⚖ 51 — a VIP is never DRAWN in a room the rule forbids: impossible
      // states get fixed at the data, never rendered and explained.
      const candidates: number[] = []
      for (let j = 0; j < spec.beds; j += 1) {
        if (vip && !isPrivate(j)) continue
        if (storeOfBed(j) !== storeOfStaff(i)) continue
        candidates.push(j)
      }
      if (candidates.length === 0) continue
      const bed = candidates[Math.floor(next() * candidates.length) % candidates.length]
      if (busy(i, bed, span)) continue
      made.push({ id: `apt-${pad(i)}-${n}`, staff: i, bed, vip, start, end: start + dur })
    }
  }

  const card = (b: (typeof made)[number], suffix: 'staff' | 'bed'): BoardItem => ({
    key: `${b.id}-${suffix}`,
    kind: 'booking',
    state: 'confirmed',
    category: b.vip ? 'vip' : 'repeat',
    ...place(b.start, b.end, hours),
    title: `顧客 ${b.id}`,
    tag: '',
    time: `${hhmm(b.start)}〜`,
    ticketCat: null,
    ticketCore: null,
    held: false,
    micro: false,
    caseId: b.id,
    label: `${hhmm(b.start)}〜${hhmm(b.end)}`,
  })

  const lanes: BoardLane[] = []
  for (let i = 0; i < spec.staff; i += 1) {
    lanes.push({
      key: `p-${pad(i)}`,
      group: 'staff',
      label: `見本 ${pad(i)}`,
      sub: '',
      absentNote: null,
      mine: false,
      items: made.filter((b) => b.staff === i).map((b) => card(b, 'staff')).sort((a, b) => a.x - b.x),
      window: { from: hours.open, until: hours.close },
      untilLabel: hhmm(hours.close),
      listPrice: 7000,
      stores: [storeOfStaff(i)],
      roomClass: null,
    })
  }
  for (let j = 0; j < spec.beds; j += 1) {
    const on = made.filter((b) => b.bed === j)
    const items = on.map((b) => card(b, 'bed'))
    for (const c of cleanupBlocks(on.map((b) => ({ id: b.id, start: b.start, end: b.end })), spec.cleanupMinutes ?? 0, hours)) {
      items.push({
        key: c.id,
        kind: 'cleanup',
        state: null,
        category: null,
        ...place(c.start, c.end, hours),
        title: '清掃',
        tag: '',
        time: `${hhmm(c.start)}〜`,
        ticketCat: null,
        ticketCore: null,
        held: false,
        micro: c.end - c.start <= 20,
        caseId: null,
        label: '清掃・予約不可',
      })
    }
    lanes.push({
      key: `bed-${pad(j)}`,
      group: 'beds',
      label: `ベッド${j + 1}`,
      sub: isPrivate(j) ? '個室' : '施術室',
      absentNote: null,
      mine: false,
      items: items.sort((a, b) => a.x - b.x),
      window: null,
      untilLabel: null,
      listPrice: 0,
      stores: [storeOfBed(j)],
      roomClass: isPrivate(j) ? 'private' : 'standard',
    })
  }
  return lanes
}

const SYNTH_HOURS: Hours = { open: 600, close: 1140 }
const SYNTH_NOW = 600
const TWO_STORE: Spec = { staff: 8, beds: 4, stores: ['store-a', 'store-b'], profile: 'sparse', seed: 1212 }
const SPARSE_25: Spec = { staff: 25, beds: 10, stores: ['store-a'], profile: 'sparse', seed: 4242 }
const DENSE_25: Spec = { ...SPARSE_25, profile: 'dense', seed: 9001 }

// ── the artifact writer (DIAL-SWEEP-r2.txt) ─────────────────────────────────

const EVIDENCE = process.env.CAPACITY_R2_EVIDENCE ?? ''

// ═══════════════════════════════════════════════════════════════════════════
// P1 — HYPOTHETICAL ≡ LEGACY-NO-EXCLUDE
// ═══════════════════════════════════════════════════════════════════════════

describe('P1 — the book’s hypothetical answer IS the rail’s, on the real board', () => {
  it('every staff lane, every lattice start, two lengths: zero disagreements', () => {
    const durs = [REAL.guard.standardSessionMin, REAL.guard.protectedDurationMin]
    const run = parityRun(REAL.lanes, REAL.hours, REAL.sell.nowMinute ?? REAL.hours.open, durs)
    // Guard of the guard: a run that asked nothing would "agree" vacuously.
    expect(run.asked).toBe(staffLanesOf(REAL.lanes).length * durs.length * latticeOf(REAL.hours).length)
    // …and the literal, so the number this round reports is the number the
    // suite enforces: 6 staff lanes × 108 lattice starts × 2 lengths.
    expect(run.asked).toBe(1296)
    expect(run.diverged).toEqual([])
  })

  it('and the answers are not all one value — the comparison can actually fail', () => {
    // Without this, a book that returned `true` everywhere would pass P1 on a
    // board whose rail also happened to say true everywhere.
    const dur = REAL.guard.standardSessionMin
    const truth = bedTruthViews(REAL.lanes, frameOf(REAL.hours, REAL.sell.nowMinute ?? REAL.hours.open), null).world
    const lane = staffLanesOf(REAL.lanes)[0]
    const answers = new Set(
      latticeOf(REAL.hours).map((s) => truth.bedFor(s, s + dur, { stores: lane.stores }).laneKey !== null),
    )
    expect([...answers].sort()).toEqual([false, true])
  })

  it('the store binding is part of the question — a foreign store gets a different answer', () => {
    const lanes = synthBoard(TWO_STORE, SYNTH_HOURS)
    const truth = bedTruthViews(lanes, frameOf(SYNTH_HOURS, SYNTH_NOW), null).world
    const a = latticeOf(SYNTH_HOURS).map((s) => truth.bedFor(s, s + 60, { stores: ['store-a'] }).laneKey)
    const b = latticeOf(SYNTH_HOURS).map((s) => truth.bedFor(s, s + 60, { stores: ['store-b'] }).laneKey)
    expect(a).not.toEqual(b)
    for (const key of a) expect(key === null || key === 'bed-01' || key === 'bed-03').toBe(true)
    for (const key of b) expect(key === null || key === 'bed-02' || key === 'bed-04').toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// P2 — EXCLUDED ≡ LEGACY-EXCLUDE (a real hand, VIP and not)
// ═══════════════════════════════════════════════════════════════════════════

describe('P2 — with a card in hand, worldMinusHand IS the rail’s excluded world', () => {
  /** Real bookings off the real board, one of each kind the room floor cares
   *  about. ⚖ ROOM RULE — that is the booking's own 個室のみ tag now, not the
   *  customer's VIP badge, so the two hands are TAGGED and UNTAGGED. */
  const handsOn = (lanes: BoardLane[]) => {
    const cards = staffLanesOf(lanes).flatMap((l) => l.items).filter((i) => i.caseId)
    return {
      tagged: cards.find((i) => i.requiresPrivateRoom === true)?.caseId ?? null,
      plain: cards.find((i) => i.requiresPrivateRoom !== true)?.caseId ?? null,
    }
  }

  it('the fixture board actually carries both kinds of hand', () => {
    const hands = handsOn(REAL.lanes)
    expect(typeof hands.tagged).toBe('string')
    expect(typeof hands.plain).toBe('string')
  })

  it('an UNTAGGED hand: zero disagreements across the lattice', () => {
    const hand = handsOn(REAL.lanes).plain!
    const run = parityRun(REAL.lanes, REAL.hours, REAL.sell.nowMinute ?? REAL.hours.open, [REAL.guard.standardSessionMin], hand)
    expect(run.asked).toBe(648) // 6 staff lanes × 108 lattice starts
    expect(run.diverged).toEqual([])
  })

  it('a 個室のみ hand: zero disagreements, and the tag is what makes it a different question', () => {
    const hand = handsOn(REAL.lanes).tagged!
    const bound = handBinding(REAL.lanes, hand)
    expect(bound.requiresPrivate).toBe(true)
    const run = parityRun(REAL.lanes, REAL.hours, REAL.sell.nowMinute ?? REAL.hours.open, [REAL.guard.standardSessionMin], hand)
    expect(run.asked).toBe(648)
    expect(run.diverged).toEqual([])
    // …and the tag binding is LOAD-BEARING: the same hand asked untagged gets a
    // different set of rooms, so `requiresPrivate: false` is not a harmless
    // mutation.
    const views = bedTruthViews(REAL.lanes, frameOf(REAL.hours, REAL.sell.nowMinute ?? REAL.hours.open), { id: hand })
    const lane = staffLanesOf(REAL.lanes)[0]
    const asTagged = latticeOf(REAL.hours).map((s) => views.worldMinusHand!.bedFor(s, s + 60, { id: hand, currentBed: bound.currentBed, requiresPrivate: true, stores: lane.stores }).laneKey)
    const asPlain = latticeOf(REAL.hours).map((s) => views.worldMinusHand!.bedFor(s, s + 60, { id: hand, currentBed: bound.currentBed, requiresPrivate: false, stores: lane.stores }).laneKey)
    expect(asTagged).not.toEqual(asPlain)
  })

  /** ONE VARIABLE PER ASSERTION. The earlier version of this pin changed TWO
   *  things at once — it compared a NewClient on the unlifted world against a
   *  Subject on the lifted one — and then read the difference as proof that the
   *  LIFT does something. It is not: measured on this board, the asker is what
   *  moved the answer, and the lift alone moves nothing at all for a Subject
   *  (see the equivalence pin below). Isolated properly, the lift IS
   *  load-bearing, just for the other asker: ask the SAME hypothetical question
   *  of the two worlds and the answers part, because the lifted world has one
   *  fewer card standing in a room. */
  it('the LIFT is load-bearing for a hypothetical asker — same question, two worlds, different answers', () => {
    const hand = handsOn(REAL.lanes).plain!
    const now = REAL.sell.nowMinute ?? REAL.hours.open
    const withCard = bedTruthViews(REAL.lanes, frameOf(REAL.hours, now), null).world
    const lifted = bedTruthViews(REAL.lanes, frameOf(REAL.hours, now), { id: hand }).worldMinusHand!
    let boolDiff = 0
    let keyDiff = 0
    let asked = 0
    for (const lane of staffLanesOf(REAL.lanes)) {
      for (const start of latticeOf(REAL.hours)) {
        asked += 1
        const a = withCard.bedFor(start, start + 60, { stores: lane.stores })
        const b = lifted.bedFor(start, start + 60, { stores: lane.stores })
        if ((a.laneKey !== null) !== (b.laneKey !== null)) boolDiff += 1
        if (a.laneKey !== b.laneKey) keyDiff += 1
      }
    }
    expect(asked).toBe(648)
    // Measured on this fixture at this tip. Pinned as counts rather than as
    // "not equal" so that a change in HOW MUCH the lift moves is visible too.
    expect(boolDiff).toBe(66)
    expect(keyDiff).toBe(72)
  })

  /** WHY TWO MUTATIONS OF THE HAND BINDING CANNOT BE KILLED THROUGH THIS
   *  COMPARISON, proven rather than asserted (mutation-r2 M6 and M8).
   *
   *  The rail's callback answers a BOOLEAN — "is some room free?" — so the two
   *  facts below are invisible to it by construction, and a battery claiming to
   *  have killed them would be lying about its own reach:
   *
   *   · LIFTING THE CARD, for a SUBJECT asker, is a no-op on the WHOLE ANSWER —
   *     not merely on the boolean. `allocateBed` already excludes the subject's
   *     own card and its own trailing 清掃 (:1500), which is exactly what
   *     `excludedWorld` filters out, so the two worlds present that subject with
   *     identical blockers and hand back the identical room. Measured below:
   *     0 boolean differences AND 0 key differences over 648 asks. The lift
   *     still matters — architecturally it is the only sanctioned door to a
   *     world with a card out of it, and for a HYPOTHETICAL asker it changes 72
   *     answers (pinned above) — but for the subject it is redundant, and a
   *     battery claiming to have killed M6 would be lying about its own reach.
   *   · `currentBed` is the keep-if-free FIRST CANDIDATE, so it changes WHICH
   *     room comes back and never WHETHER one does: the room it names is always
   *     already in the candidate list it would otherwise search. Measured: 0
   *     boolean differences, 186 key differences.
   *
   *  Both numbers are pinned rather than described. The subject-lift no-op is
   *  the honest tripwire for M6: the day the lift becomes load-bearing for a
   *  subject — a re-derived world rather than an item filter — that 0 goes
   *  non-zero and this pin says so. */
  it('the lift is a no-op for a SUBJECT and the kept room only moves keys — M6 and M8, measured', () => {
    const hand = handsOn(REAL.lanes).plain!
    const now = REAL.sell.nowMinute ?? REAL.hours.open
    const bound = handBinding(REAL.lanes, hand)
    const lifted = bedTruthViews(REAL.lanes, frameOf(REAL.hours, now), { id: hand }).worldMinusHand!
    const unlifted = bedTruthViews(REAL.lanes, frameOf(REAL.hours, now), null).world
    const ask = (t: BedTruth, lane: BoardLane, start: number, currentBed: string | null) =>
      t.bedFor(start, start + 60, { id: hand, currentBed, requiresPrivate: bound.requiresPrivate, stores: lane.stores })
    let asked = 0
    const lift = { bool: 0, key: 0 }
    const kept = { bool: 0, key: 0 }
    for (const lane of staffLanesOf(REAL.lanes)) {
      for (const start of latticeOf(REAL.hours)) {
        asked += 1
        // M6's variable: the LIFT, with the asker held fixed.
        const a = ask(lifted, lane, start, bound.currentBed)
        const b = ask(unlifted, lane, start, bound.currentBed)
        if ((a.laneKey !== null) !== (b.laneKey !== null)) lift.bool += 1
        if (a.laneKey !== b.laneKey) lift.key += 1
        // M8's variable: currentBed, with the world held fixed.
        const c = ask(lifted, lane, start, null)
        if ((a.laneKey !== null) !== (c.laneKey !== null)) kept.bool += 1
        if (a.laneKey !== c.laneKey) kept.key += 1
      }
    }
    expect(asked).toBe(648)
    expect(lift).toEqual({ bool: 0, key: 0 })
    expect(kept).toEqual({ bool: 0, key: 186 })
  })
})

/** The rail the screen builds — the same call shape as TodayScreen's `rails`
 *  memo (stepMin 30, canon's own), for any board. */
function railsFor(lanes: BoardLane[], hours: { open: number; close: number }, excludeId: string | null, dur: number, nowMinute: number | null = null) {
  return guardRailsFor(lanes, {
    open: hours.open,
    close: hours.close,
    stepMin: 30,
    dur,
    protectedDur: REAL.guard.protectedDurationMin,
    nowMinute,
    locked: [],
    guard: REAL.guard.config,
    excludeId,
    placementFeasible: bedFeasibility(lanes, excludeId),
  })
}

/** …and the same thing for the real board, at its own clock. */
const railsOn = (props: TodayProps, excludeId: string | null, dur = props.guard.standardSessionMin) =>
  railsFor(props.lanes, props.hours, excludeId, dur, props.sell.nowMinute)

// ═══════════════════════════════════════════════════════════════════════════
// P3 — 満室 RUNS ≡ THE STARTS THE RAIL REFUSES FOR WANT OF A ROOM
// ═══════════════════════════════════════════════════════════════════════════

// The first two pins here are the book against ITSELF — `fullRuns` is a walk
// over `bedFor`, so this is clip-contract arithmetic, not a rail comparison.
// The rail enters at the third and fourth pins.
describe('P3 — fullRuns is the book’s own bedFor walk, and the rail agrees with it', () => {
  const bindingsOf = (lanes: BoardLane[]) => {
    const seen = new Map<string, string[] | null>()
    for (const l of staffLanesOf(lanes)) seen.set(l.stores === null ? '*' : [...l.stores].sort().join('|'), l.stores)
    return [...seen.values()]
  }

  it('per store binding, run coverage ≡ the refused starts (clip contract honoured)', () => {
    const dur = REAL.guard.standardSessionMin
    const now = REAL.sell.nowMinute ?? REAL.hours.open
    const truth = bedTruthViews(REAL.lanes, frameOf(REAL.hours, now), null).world
    let checked = 0
    for (const stores of bindingsOf(REAL.lanes)) {
      const runs = truth.fullRuns(dur, stores)
      const covered = new Set<number>()
      for (const r of runs) for (let s = r.startMin; s < r.endMin; s += LATTICE_STEP_MIN) covered.add(s)
      // The clip contract: only starts a booking of this length could BEGIN at.
      const inDay = latticeOf(REAL.hours).filter((s) => s + dur <= REAL.hours.close)
      const refused = new Set(inDay.filter((s) => truth.bedFor(s, s + dur, { stores }).laneKey === null))
      expect([...covered].sort((a, b) => a - b)).toEqual([...refused].sort((a, b) => a - b))
      checked += inDay.length
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('a start past the last possible one is in NO run — neither full nor bookable', () => {
    const dur = REAL.guard.standardSessionMin
    const truth = bedTruthViews(REAL.lanes, frameOf(REAL.hours, REAL.hours.open), null).world
    const stores = bindingsOf(REAL.lanes)[0]
    const runs = truth.fullRuns(dur, stores)
    const tail = latticeOf(REAL.hours).filter((s) => s + dur > REAL.hours.close)
    expect(tail.length).toBeGreaterThan(0)
    for (const s of tail) expect(runs.some((r) => s >= r.startMin && s < r.endMin)).toBe(false)
  })

  /** The rail's own words when the pocket held and the ROOM is what refused —
   *  `railCell`'s ⚖ 76 branch (today-interactions :975), which is the rail's
   *  sentence and deliberately NOT `reasonLine`'s generic one. */
  const NO_ROOM = (dur: number) => new RegExp(`^この開始ではベッドを${dur}分確保できません$`)

  /** A board where the ROOM is the only thing that can refuse: one free staff
   *  lane, one room, and the room is busy all day under somebody else. The
   *  fixture store cannot reach that branch — with six people and three rooms
   *  the staff pocket always runs out first, and canon's order is pocket first,
   *  rooms second — so the branch is proven where it actually fires rather than
   *  asserted where it never does. */
  const roomStarvedBoard = (): BoardLane[] => {
    const hours: Hours = { open: 600, close: 1140 }
    const card = (id: string, suffix: string): BoardItem => ({
      key: `${id}-${suffix}`,
      kind: 'booking',
      state: 'confirmed',
      category: 'repeat',
      ...place(600, 1140, hours),
      title: '顧客',
      tag: '',
      time: '10:00〜',
      ticketCat: null,
      ticketCore: null,
      held: false,
      micro: false,
      caseId: id,
      label: '10:00〜19:00',
    })
    const staff = (key: string, items: BoardItem[]): BoardLane => ({
      key, group: 'staff', label: key, sub: '', absentNote: null, mine: false, items,
      window: { from: 600, until: 1140 }, untilLabel: '19:00', listPrice: 7000,
      stores: ['store-a'], roomClass: null,
    })
    return [
      staff('p-free', []),
      staff('p-busy', [card('apt-hog', 'staff')]),
      {
        key: 'bed-01', group: 'beds', label: 'ベッド1', sub: '施術室', absentNote: null, mine: false,
        items: [card('apt-hog', 'bed')], window: null, untilLabel: null, listPrice: 0,
        stores: ['store-a'], roomClass: 'standard',
      },
    ]
  }

  it('spot-check — every ベッド refusal the rail paints sits inside a 満室 run (fixture board)', () => {
    const dur = REAL.guard.standardSessionMin
    const now = REAL.sell.nowMinute ?? REAL.hours.open
    const truth = bedTruthViews(REAL.lanes, frameOf(REAL.hours, now), null).world
    const byKey = new Map(REAL.lanes.map((l) => [l.key, l]))
    let cells = 0
    for (const rail of railsOn(REAL, null)) {
      const lane = byKey.get(rail.laneKey)!
      const runs = truth.fullRuns(dur, lane.stores)
      for (const cell of rail.cells) {
        cells += 1
        if (!NO_ROOM(dur).test(cell.sentence)) continue
        if (cell.start + dur > REAL.hours.close) continue // outside the clip contract
        expect(runs.some((r) => cell.start >= r.startMin && cell.start < r.endMin)).toBe(true)
      }
    }
    // The whole rail really was walked — without this the two `continue`s could
    // skip every cell and the test would pass by doing nothing.
    expect(cells).toBeGreaterThan(50)
    // HOW MANY FIRED IS RECORDED HERE, NOT ASSERTED: on the six-person /
    // three-room fixture store the staff pocket refuses first at every
    // 30-minute rail start, so this branch never fires — today the count is 0.
    // It is deliberately not pinned. Pinning the 0 would make an unrelated
    // fixture edit look like a regression, and any bound on the count would be
    // arithmetic rather than evidence (it could only be compared against the
    // walk it is counted inside). The claim that matters is the one in the loop
    // — a cell that DID fire had to sit inside a 満室 run — and the next test
    // fires the branch on purpose to prove that claim is reachable.
  })

  it('…and on a board where the ROOM is the only blocker, every rail cell says so and every one is in a run', () => {
    const lanes = roomStarvedBoard()
    const hours = { open: 600, close: 1140 }
    const dur = 60
    const truth = bedTruthViews(lanes, frameOf(hours, 600), null).world
    const runs = truth.fullRuns(dur, ['store-a'])
    // The one free lane's rail: the pocket is the whole day, so the only thing
    // left that can refuse is the room — and it refuses everywhere.
    const rail = guardRailsFor(lanes, {
      open: hours.open, close: hours.close, stepMin: 30, dur,
      protectedDur: REAL.guard.protectedDurationMin, nowMinute: null, locked: [],
      guard: REAL.guard.config, excludeId: null,
      placementFeasible: bedFeasibility(lanes, null),
    }).find((r) => r.laneKey === 'p-free')!
    const refused = rail.cells.filter((c) => NO_ROOM(dur).test(c.sentence) && c.start + dur <= hours.close)
    expect(refused.length).toBeGreaterThan(0)
    for (const cell of refused) {
      expect(runs.some((r) => cell.start >= r.startMin && cell.start < r.endMin)).toBe(true)
    }
    // …and the book calls the whole clipped day 満室, which is what a single
    // room occupied end to end means.
    const inDay = latticeOf(hours).filter((s) => s + dur <= hours.close)
    const covered = new Set<number>()
    for (const r of runs) for (let s = r.startMin; s < r.endMin; s += LATTICE_STEP_MIN) covered.add(s)
    expect([...covered].sort((a, b) => a - b)).toEqual(inDay)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// P4 — DIAL SWEEP (the artifact that guards R4)
// ═══════════════════════════════════════════════════════════════════════════

// TWO LEGS, and they are not the same claim. The ANNIHILATION leg is the
// honest 12-way sweep: all three dials move and the board must keep
// advertising. The PARITY leg is narrower — only `sessionMin` reaches the book
// (it becomes the asked length); `gridMin` and `minSellableMin` shape the sell
// and gap layers and never enter a bed question at all. So the parity claim
// here is "the book agrees at every session length in {45, 60, 90}", asserted
// twelve times because the sweep runs twelve times.
describe('P4 — no dial combination annihilates a layer, and the book agrees at every session length', () => {
  const GRID = [30, 60]
  const SESSION = [45, 60, 90]
  const MIN_SELLABLE = [0, 30]

  it('12 combinations: counts recorded, no layer goes to zero, parity holds at each', () => {
    const lanes = synthBoard(TWO_STORE, SYNTH_HOURS)
    /** THE SCREEN'S OWN RESTING PRICE DIALS, not invented ones. TodayScreen
     *  opens at `{ hi: hqMax, lo: base }` (:856) and runs both layers through
     *  `clampPriceInputs` (:1156); `packedPrice` keeps a floor tripwire that a
     *  made-up frame trips immediately, and a sweep that priced off fake
     *  numbers would be sweeping a different product. */
    const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
    const depth = Math.round((1 - price.lo / price.hi) * 100)
    const priceFrame = { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax }
    // The board really does have room to sell — otherwise "no layer is zero"
    // would be a claim about an empty board.
    expect(staffLanesOf(lanes).length).toBe(8)
    expect(lanes.filter((l) => l.group === 'beds').length).toBe(4)

    const rows: string[] = []
    const zero: string[] = []
    const gapEmpty: string[] = []
    for (const gridMin of GRID) {
      for (const sessionMin of SESSION) {
        for (const minSellableMin of MIN_SELLABLE) {
          const sell = sellLayerFor(lanes, SYNTH_HOURS, {
            gridMin,
            nowMinute: null,
            locked: [],
            showPrice: true,
            hi: price.hi,
            hqMin: REAL.dialogs.pricing.hqMin,
            depth,
          })
          const gap = gapLayerFor(lanes, {
            gridMin,
            sessionMin,
            gapFillMin: 30,
            gapFillDiscountPct: 10,
            minSellableMin,
            nowMinute: null,
            locked: [],
            frame: priceFrame,
            depth,
            guard: REAL.guard.config,
          })
          const run = parityRun(lanes, SYNTH_HOURS, SYNTH_NOW, [sessionMin])
          expect(run.asked).toBe(864) // 8 staff lanes × 108 lattice starts, every combination
          expect(run.diverged).toEqual([])
          rows.push(
            `grid=${String(gridMin).padStart(2)} S=${String(sessionMin).padStart(2)} minSell=${String(minSellableMin).padStart(2)}` +
              ` | cells=${String(sell.cells.length).padStart(3)} packed=${String(gap.packed.length).padStart(3)}` +
              ` scraps=${String(gap.scraps.length).padStart(3)} | parity ${run.asked} asked, ${run.diverged.length} diverged`,
          )
          // THE ANNIHILATION TEST: the BOARD stops advertising. A single layer
          // being empty is not that — see the grid-mode block below.
          if (sell.cells.length + gap.packed.length + gap.scraps.length === 0) zero.push(rows[rows.length - 1])
          if (gap.packed.length + gap.scraps.length === 0) {
            gapEmpty.push(`grid=${gridMin} S=${sessionMin} minSell=${minSellableMin}`)
            // …and when the gap layer is empty the normal layer is carrying the
            // whole day, which is the difference between grid mode and a hole.
            expect(sell.cells.length).toBeGreaterThan(0)
          }
        }
      }
    }
    expect(rows.length).toBe(12)
    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, 'DIAL-SWEEP-r2.txt'),
        [
          '# DIAL-SWEEP-r2 — the two-store synthetic board across every dial combination',
          '# board: 8 staff / 4 rooms (1 個室) / 2 stores / 10:00-19:00 / seed 1212 / turnaround OFF',
          '# columns: sell cells · 詰め込み packed · スキマ scraps · P1 ledger parity at that session length',
          '',
          ...rows,
          '',
          `board-offerless combinations (cells+packed+scraps == 0): ${zero.length === 0 ? 'NONE' : zero.join(' ; ')}`,
          `gap-layer-empty combinations: ${gapEmpty.length === 0 ? 'NONE' : gapEmpty.join(' ; ')}`,
          '',
          'WHY THE TWO grid=30 S=60 ROWS SHOW packed=0 scraps=0 — it is canon GRID',
          'MODE, not annihilation. availability.ts:427 branches on `S === 60 &&',
          'kGrid === kPack`: when a 60-minute session lands on the customer grid as',
          'often as raw packing could fit it, the NORMAL 販売可能枠 layer is already',
          'advertising those sessions, so the packing layer contributes only the',
          'pocket\'s leftover ENDS (`gapFillPieces`, :303). Every pocket on this board',
          'begins and ends on a 30-minute boundary, so at gridMin=30 there are no ends',
          'and the gap layer is correctly silent — while the normal layer is at its',
          'maximum for the board (80 cells, the most any row here reaches). The board',
          'never stops advertising at any of the twelve combinations.',
          '',
        ].join('\n'),
      )
    }
    // THE CLAIM: no combination leaves the board with nothing to advertise on a
    // day that plainly has free staff and free rooms. (v1's layer annihilation
    // is exactly this going to zero off the fixture dials.)
    expect(zero).toEqual([])
    // …and the one layer that DOES go quiet does so for canon's stated reason,
    // at exactly the dials that reason names — pinned so a later round cannot
    // widen it silently. R4 owns the gridMin<60 clamp; this is its baseline.
    expect(gapEmpty).toEqual(['grid=30 S=60 minSell=0', 'grid=30 S=60 minSell=30'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// P5 — SCALE (25 staff / 10 rooms, sparse and dense)
// ═══════════════════════════════════════════════════════════════════════════

describe('P5 — parity survives a 25-staff roster, and the shared cache is what makes it affordable', () => {
  for (const [name, spec] of [['sparse', SPARSE_25], ['dense', DENSE_25]] as const) {
    it(`${name}: zero disagreements over the whole lattice`, () => {
      const lanes = synthBoard(spec, SYNTH_HOURS)
      expect(staffLanesOf(lanes).length).toBe(25)
      const run = parityRun(lanes, SYNTH_HOURS, SYNTH_NOW, [60])
      expect(run.asked).toBe(25 * latticeOf(SYNTH_HOURS).length)
      expect(run.asked).toBe(2700)
      expect(run.diverged).toEqual([])
      // THE BUDGET. One store binding, one length: the book pays for the
      // lattice ONCE and every one of the 25 lanes reads the same row. The
      // legacy callback caches per (lane, start, dur), so it pays 25×.
      expect(run.truth.stats.storeBindings).toBe(1)
      expect(run.truth.stats.allocateBedCalls).toBe(latticeOf(SYNTH_HOURS).length)
    })
  }

  it('two store bindings cost two rows, never one shared wrong one', () => {
    const lanes = synthBoard(TWO_STORE, SYNTH_HOURS)
    const run = parityRun(lanes, SYNTH_HOURS, SYNTH_NOW, [60])
    expect(run.asked).toBe(864)
    expect(run.diverged).toEqual([])
    expect(run.truth.stats.storeBindings).toBe(2)
    expect(run.truth.stats.allocateBedCalls).toBe(2 * latticeOf(SYNTH_HOURS).length)
  })
})
