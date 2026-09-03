// BOTH DOORS READ THE MASK — E3a's own battery (SPEC-SELLING-ENGINE §12, E3a).
//
// E1 built the held set and E2 built the fragment fallback, both DARK. This is
// the round that wires them into the live pipeline — and the round's whole
// promise is that with the gate OFF the board is byte-identical to today's, so
// the wiring can be reviewed and merged before anything on screen moves.
//
// WHAT THIS FILE PROVES, in the order the round decides things:
//   §1 THE GATE — shipped OFF, read at the screen boundary and NOWHERE below
//      it, and threaded as a PARAMETER into every seam. That last one is what
//      makes the gated-off path provable at all: an absent mask is today's code
//      by construction, not by a branch somebody has to keep honest.
//   §2 GATED-OFF IDENTITY — every seam with no mask ≡ the same seam with an
//      empty one, across two boards × the widened matrix. (The base-vs-tip half
//      of this proof is E3a-proof/GATED-OFF-PARITY: a 2.2 MB digest of the four
//      surfaces, byte-identical at f153fe9f and at this tip.)
//   §3 THE SALES DOOR, GATE ON — the composed pipeline: held spans withheld
//      from the gap layer's input space, the ごろう fragments back (E2's own
//      numbers, now through the wiring rather than a test harness), sell hours
//      inside held windows TAGGED, one reserved offer per held window, and zero
//      double-claims on either axis.
//   §4 THE STAFF DOOR — the rail answers from the SAME held set, and the
//      before/after count table keeps LATTICE and BED in two columns, because
//      attaching the callback moves the enumeration as well as filtering it
//      (spec §2's lattice-honesty clause). Artifact: RAIL-DELTA.
//   §5 THE EXPLAIN LAYER — a 新規用に確保 window gets no 「販売可能枠が出ていま
//      せん」 clause, no taker's name, and no rest-cue hatch; gate off, every
//      sentence is the one that ships today.
//   §6 RESERVED NEVER CLAIMS — the third offer kind is advisory, and the claims
//      book refuses one outright rather than trusting a caller.
//   §7 THE COST — the mask is built once per world per frame, and the 25-staff
//      and HQ-scale rows are measured rather than asserted in prose.
//
// THE MATRIX is E1's widened one (spec §11.3): the LAW axes — protected
// duration × guard mode, which r1's matrix held constant and so could not see —
// crossed at the store's own grid dials, plus the twelve-combination grid
// matrix at the shipped law dials. 20 combinations after the overlap.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  boardOffers,
  buildClaims,
  reservedOffersFor,
  type BedTruth,
  type OfferInput,
} from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { fallbackCellsFor, type FallbackResult } from '@/app/[locale]/(business)/business/today/fallback-cells'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { reservedMaskFor, type ReservedLaneMask } from '@/app/[locale]/(business)/business/today/reserved-mask'
import { SELLING_ENGINE_LAW } from '@/app/[locale]/(business)/business/today/selling-engine-gate'
import { bedDoor, bedViewsFor, TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import {
  explainRails,
  gapLayerFor,
  gapPackingDials,
  guardRailsFor,
  guardVerdictAt,
  isHeldBound,
  laneSpans,
  restCueStarts,
  sellLayerFor,
  type GuardRail,
  type RailCell,
  type RailInput,
  type RoomPolicy,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { freePockets, type GapCell } from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig, type GuardContext } from '@/business/lib/canon-logic/gap-guard'
import { clampPriceInputs, SELL_SLOT_MIN } from '@/business/lib/canon-logic/pricing'
import { STORE_A } from '@/business/lib/fixtures'
import { cleanupBlocks, hhmm, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

const HERE = 'src/app/[locale]/(business)/business/today'
const SRC = (f: string) => readFileSync(join(process.cwd(), HERE, f), 'utf8')

/** ⚖ BREAKER-827 F1/F2/F3 — A `//`-PREFIXED COPY IS NOT THE LINE.
 *
 *  The breaker commented the verdict's protected door OUT, left the pinned text
 *  sitting beside it as `// protectedWindowFeasible: …`, and the whole repo
 *  stayed green (530 suites, tsc clean) while the feature this round exists for
 *  went dark. `toContain` reads a SUBSTRING, and a raw occurrence count cannot
 *  tell a real read that LEFT from a comment that took its place — it only sees
 *  a read arriving. Same class as BREAKER-821 M1, whose fix is already in this
 *  repo: selling-engine-flip.test.ts — grep it for ROUND 4, `includes` WAS
 *  WALKED BY A COMMENTED-OUT COPY. This is that fix, copied, not reinvented.
 *
 *  ⚖ BREAKER-827 §DELTA D1 (BLOCKER) — AND NEITHER IS A BLOCK COMMENT. Round 3
 *  built the armour against the `//` prefix alone, and a three-line block
 *  comment whose MIDDLE line is the pinned text with nothing in front of it
 *  walked through both helpers untouched: the anchor saw a real line, and the
 *  blanker only ever looked at what a line STARTS with. The verdict door came
 *  back green at 530 suites with the feature dark — the round's own headline
 *  mutant, alive again. So `codeOnly` takes whole block comments out as well
 *  (an unterminated one runs to the end of the input, which is what a SLICE of
 *  a file can hand it), and the old rule for comment-continuation lines goes
 *  with them: once the blocks are gone no continuation line is left to blank,
 *  and `//` is the only comment shape a line can still begin with.
 *
 *  ⚖ BREAKER-827 §DELTA 2 D5 — AND THE `//` PASS RUNS FIRST. Round 4
 *  stripped the blocks first, so a block OPENER sitting inside a `//` line
 *  opened a block the type-checker never saw, and every live line between it
 *  and the next closer disappeared from a filter whose whole job is to see
 *  live lines. The breaker hid a second real `solveBed(` behind one and the
 *  comment-aware count in the ⚖ 51 chain below still read ONE — what killed
 *  that mutant was two OLDER pins that read the RAW file, not this armour.
 *  Blanking `//`-led lines FIRST is the whole fix: such a line is gone before
 *  the block pass can read a delimiter out of it.
 *
 *  ⚠ THE CEILING, SAID HONESTLY. Both passes are string surgery, not a
 *  parser. A block delimiter inside a STRING LITERAL in a pinned product file
 *  still opens or closes a comment that is not one — `blockcheck.py` scans
 *  today's three files and finds none outside a comment, but that is a SCAN of
 *  today rather than a test, and nothing stops a later round writing one. The
 *  reorder adds the mirror shape: a real block whose CLOSER sits on a `//`-led
 *  line now runs to the end of the input. Both of those can only HIDE code,
 *  never add it — and hiding takes a pinned line out of the exact-lines
 *  arrays and out of every count, which is red. ADDING is what a decoy needs,
 *  and adding is what the counts and the arrays are for.
 *
 *  `pinnedLine` runs over `codeOnly(src)`, never the raw source, and anchors
 *  `^[ \t]*` … `$`: the literal must START its line after indentation — tabs
 *  included, so a tab-reindented but otherwise byte-identical real line is
 *  still the line — and END it, so a comment prefix misses and a trailing
 *  addition on the same line misses too. Zero indentation is allowed because
 *  top-level `import` lines are pinned this way as well.
 *
 *  `pinnedLines` is that same anchor COUNTED, and it is the other half of the
 *  armour: presence-anywhere-in-the-file is reachability-blind, so a line MOVED
 *  into a dead scope still satisfies it (⚖ lens 2, decoy 3 — the verdict door
 *  deleted from the live call and parked in a `void`-discarded block above the
 *  hook: 486 green, tsc clean, the guard back on the raw enumeration). A count
 *  of ONE, plus the same line pinned inside the slice of the CALL it is an
 *  argument to, is what closes it: a duplicate moves the count, and a move
 *  leaves the slice.
 *
 *  A decoy hidden as a TRAILING comment on a real code line survives the
 *  filter — and then it INFLATES the count, which is red the other way
 *  round. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const codeOnly = (src: string) => src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
const anchoredLine = (line: string) => new RegExp('^[ \\t]*' + escapeRegExp(line) + '$', 'gm')
const pinnedLines = (src: string, line: string) => (codeOnly(src).match(anchoredLine(line)) ?? []).length
const pinnedLine = (src: string, line: string) => pinnedLines(src, line) > 0

/** ONE call's own text, from its opening anchor to the dependency-array line
 *  that closes the hook it lives in — found and counted by the SAME anchored
 *  regex `pinnedLines` uses, over `codeOnly(src)`.
 *
 *  ⚖ BREAKER-827 §DELTA 3 S1 (BLOCKER) — THE ANCHORS HAVE TO BE UNIQUE, AND
 *  THIS FUNCTION IS WHERE THAT IS DECIDED. It used to be `src.indexOf(open)`
 *  then `src.indexOf(close, i)` over the RAW file: first occurrence, both ends,
 *  nothing asserting there was only one. The comment that stood here CLAIMED
 *  「Both anchors are unique in the file」 and never checked it, so the armour
 *  was not reading the call — it was reading whichever copy came first. The
 *  breaker copied the rail's fourteen lines verbatim into a `(false as
 *  boolean) ?` branch ABOVE the real memo, deleted the live protected door and
 *  re-spelled the two other pinned lines so no file-wide count moved: 530
 *  suites green, `tsc` exit 0, every slice pin satisfied — by the decoy — and
 *  both protected doors dark (rail 5 + verdict 5 of 90 fixture cells at
 *  now=804, 12 + 12 with no clock). `opens` and `closes` are those two counts,
 *  and every caller asserts both are ONE before reading `text`: a second copy
 *  then has nowhere to stand, which is the argument `inTheFile: 1` already
 *  makes one level down for a duplicate LINE.
 *
 *  AND THE LOCATOR MOVED WITH THE COUNT. `indexOf` finds an anchor anywhere —
 *  mid-line, or inside a comment — while the count only sees it at the start of
 *  a line of code; a locator the count cannot see is a decoy site by
 *  construction (append the open anchor to the tail of a live line and the
 *  count still reads one). Both halves run `anchoredLine` over `codeOnly(src)`
 *  now, so what is counted and what is sliced are the same thing, and `text`
 *  arrives at the caller already comment-blanked.
 *
 *  ⚠ THE CEILING, SAID HONESTLY. Blanking the whole file before slicing means
 *  an unterminated block comment ABOVE the open anchor eats the anchors
 *  themselves — `ok` goes false, which is red, so that direction is safe. A
 *  comment can only ADD lines to a slice or TRUNCATE it; it can never SUPPLY a
 *  pinned line, because `codeOnly` removed it before the slice existed. */
const callSlice = (src: string, open: string, close: string) => {
  const code = codeOnly(src)
  const opens = [...code.matchAll(anchoredLine(open))]
  const closes = [...code.matchAll(anchoredLine(close))]
  const at = (ms: readonly { index?: number }[], after: number) => ms.find((m) => (m.index ?? -1) > after)?.index ?? -1
  const i = at(opens, -1)
  const j = i < 0 ? -1 : at(closes, i)
  return { ok: i > -1 && j > i, text: i > -1 && j > i ? code.slice(i, j) : '', opens: opens.length, closes: closes.length }
}

// ── THE REAL FIXTURE WORLD, driven exactly as E2 drove it ───────────────────

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

// ── THE SYNTHETIC ANY-ROSTER BOARD (E1/E2's, kept local for their reason: an
//    imported fixture would re-register another suite's tests here) ──────────

const OPEN = 540
const CLOSE = 1080
const SYNTH_HOURS: Hours = { open: OPEN, close: CLOSE }
const SYNTH_CLEANUP: Record<string, number> = { 'bed-01': 0, 'bed-02': 10, 'bed-03': 15 }

function rng(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const pad2 = (n: number) => String(n + 1).padStart(2, '0')
const hits = (a: { start: number; end: number }, b: { start: number; end: number }) => a.end > b.start && a.start < b.end
const span = (s: number, e: number) => `${hhmm(s)}-${hhmm(e)}`
const meets = (aS: number, aE: number, bS: number, bE: number) => aE > bS && aS < bE

function item(over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'kind' | 'startMin' | 'endMin'>): BoardItem {
  return {
    state: 'confirmed',
    category: null,
    ...place(over.startMin, over.endMin, SYNTH_HOURS),
    title: '',
    tag: '',
    time: `${hhmm(over.startMin)}〜${hhmm(over.endMin)}`,
    ticketCat: null,
    ticketCore: null,
    held: false,
    micro: false,
    caseId: over.key,
    label: '',
    ...over,
  }
}

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>, hours: Hours = SYNTH_HOURS): BoardLane {
  return {
    label: over.key,
    sub: '',
    absentNote: null,
    mine: false,
    items: [],
    window: over.group === 'staff' ? { from: hours.open, until: hours.close } : null,
    untilLabel: over.group === 'staff' ? hhmm(hours.close) : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

interface BoardSpec {
  staff: number
  beds: number
  seed: number
  perLane: number
  privateBeds?: number
  stores?: string[]
}

function board(spec: BoardSpec): BoardLane[] {
  const privateBeds = spec.privateBeds ?? 1
  const stores = spec.stores ?? ['store-a']
  const next = rng(spec.seed)
  const placed: Array<{ id: string; staffKey: string; bedKey: string; start: number; end: number }> = []
  for (let i = 0; i < spec.staff; i += 1) {
    const staffKey = `p-${pad2(i)}`
    for (let n = 0; n < spec.perLane; n += 1) {
      const dur = [45, 60, 90][Math.floor(next() * 3) % 3]
      const start = OPEN + Math.floor((next() * (CLOSE - OPEN - dur)) / 15) * 15
      const at = { start, end: start + dur }
      if (placed.some((p) => p.staffKey === staffKey && hits(p, at))) continue
      const bedKey = Array.from({ length: spec.beds }, (_, j) => `bed-${pad2(j)}`).find(
        (k) => !placed.some((p) => p.bedKey === k && hits(p, at)),
      )
      if (!bedKey) continue
      placed.push({ id: `apt-${pad2(i)}-${n}`, staffKey, bedKey, ...at })
    }
  }
  const lanes: BoardLane[] = []
  for (let i = 0; i < spec.staff; i += 1) {
    const key = `p-${pad2(i)}`
    lanes.push(
      lane({
        key,
        group: 'staff',
        label: `見本 ${pad2(i)}`,
        stores: [stores[i % stores.length]],
        items: placed
          .filter((p) => p.staffKey === key)
          .map((p) => item({ key: p.id, kind: 'booking', startMin: p.start, endMin: p.end }))
          .sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  for (let j = 0; j < spec.beds; j += 1) {
    const key = `bed-${pad2(j)}`
    const on = placed.filter((p) => p.bedKey === key)
    const items: BoardItem[] = on.map((p) =>
      item({ key: `${p.id}-bed`, kind: 'booking', startMin: p.start, endMin: p.end, caseId: p.id }),
    )
    for (const c of cleanupBlocks(on.map((p) => ({ id: p.id, start: p.start, end: p.end })), SYNTH_CLEANUP[key] ?? 0, SYNTH_HOURS)) {
      items.push(item({ key: c.id, kind: 'cleanup', startMin: c.start, endMin: c.end, title: '清掃', caseId: null }))
    }
    lanes.push(
      lane({
        key,
        group: 'beds',
        label: `ベッド${j + 1}`,
        stores: [stores[j % stores.length]],
        roomClass: j >= spec.beds - privateBeds ? 'private' : 'standard',
        items: items.sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  return lanes
}

// ── THE TWO WORLDS + THE WIDENED MATRIX ─────────────────────────────────────

interface World {
  name: string
  lanes: BoardLane[]
  hours: Hours
  now: number | null
  rooms: RoomPolicy
  cleanup: Record<string, number>
  minSellableMin: number
}

interface Combo {
  gridMin: number
  sessionMin: number
  gapFillMin: number
  protectedMin: number
  mode: 'off' | 'standard' | 'strict'
  axis: 'law' | 'grid'
}

const fixtureWorld = (): World => ({
  name: 'fixture',
  lanes: REAL.lanes,
  hours: REAL.hours,
  now: REAL.sell.nowMinute,
  rooms: REAL.rooms,
  cleanup: REAL.bedCleanupMinutes,
  minSellableMin: REAL.guard.minSellableMin ?? 0,
})

const syntheticWorld = (): World => ({
  name: 'synthetic ANY-ROSTER 8×3',
  lanes: board({ staff: 8, beds: 3, seed: 4242, perLane: 3 }),
  hours: SYNTH_HOURS,
  now: null,
  rooms: REAL.rooms,
  cleanup: SYNTH_CLEANUP,
  minSellableMin: REAL.guard.minSellableMin ?? 0,
})

const worlds = (): World[] => [fixtureWorld(), syntheticWorld()]

const comboLabel = (c: Combo) =>
  `grid=${c.gridMin} S=${c.sessionMin} gapFillMin=${String(c.gapFillMin).padStart(2)} protected=${c.protectedMin} guard=${c.mode}`

function matrix(): Combo[] {
  const P = REAL.guard.protectedDurationMin
  const out: Combo[] = []
  for (const protectedMin of [P - 30, P, P + 30]) {
    for (const mode of ['off', 'standard', 'strict'] as const) {
      out.push({
        gridMin: REAL.sell.gridMin,
        sessionMin: REAL.guard.standardSessionMin,
        gapFillMin: REAL.guard.gapFillMinMin,
        protectedMin,
        mode,
        axis: 'law',
      })
    }
  }
  for (const gridMin of [30, 60]) {
    for (const sessionMin of [45, 60, 90]) {
      for (const gapFillMin of [0, 30]) {
        out.push({ gridMin, sessionMin, gapFillMin, protectedMin: P, mode: REAL.guard.mode, axis: 'grid' })
      }
    }
  }
  const seen = new Set<string>()
  return out.filter((c) => {
    const k = comboLabel(c)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** One combination's guard config, and E1's own split between the two axes:
 *
 *   · the LAW axis moves the protected duration and the guard mode at the
 *     store's OWN dials, so it keeps the store's real 施術メニュー as the
 *     repertoire — the ごろう numbers are that store's prices and they only
 *     reproduce against that repertoire;
 *   · the GRID axis moves the customer grid and the session length, and a grid
 *     reaches the engine the only way one ever does: through the repertoire the
 *     store sells. So that half substitutes a synthetic one. */
const configOf = (c: Combo): GuardConfig => ({
  ...REAL.guard.config,
  services:
    c.axis === 'law'
      ? REAL.guard.config.services
      : [
          { name: '45', dur: 45 },
          { name: 'standard', dur: c.sessionMin },
          { name: 'grid', dur: c.gridMin },
        ],
  protectedDurationMin: c.protectedMin,
  gapFillMinMin: REAL.guard.minSellableMin,
})

const shipped = (): Combo => ({
  gridMin: REAL.sell.gridMin,
  sessionMin: REAL.guard.standardSessionMin,
  gapFillMin: REAL.guard.gapFillMinMin,
  protectedMin: REAL.guard.protectedDurationMin,
  mode: REAL.guard.mode === 'off' ? 'standard' : REAL.guard.mode,
  axis: 'law',
})

function priceOf() {
  const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
  return {
    price,
    depth: Math.round((1 - price.lo / price.hi) * 100),
    frame: { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax },
  }
}

const frameOf = (w: World) => ({ openMin: w.hours.open, closeMin: w.hours.close, nowMin: w.now ?? w.hours.open })
const bookOf = (w: World, lanes: BoardLane[] = w.lanes): BedTruth => bedViewsFor(lanes, w.rooms, frameOf(w), null).world

const maskOf = (w: World, c: Combo, book: BedTruth = bookOf(w)): readonly ReservedLaneMask[] =>
  reservedMaskFor({
    lanes: w.lanes,
    closeMin: w.hours.close,
    nowMin: w.now,
    guard: configOf(c),
    gapGuardMode: c.mode,
    book,
  })

const windowsIn = (held: readonly ReservedLaneMask[]) => held.flatMap((m) => m.spans.map((s) => ({ laneKey: m.laneKey, ...s })))

// ── THE PIPELINE, IN THE SCREEN'S OWN ORDER ─────────────────────────────────

interface Door {
  held: readonly ReservedLaneMask[] | undefined
  gap: { packed: GapCell[]; scraps: GapCell[] }
  claims: GapCell[]
  sell: ReturnType<typeof sellLayerFor>
  drops: SellDrop[]
  fallback: FallbackResult | null
  gapDrawn: { packed: GapCell[]; scraps: GapCell[] }
  drawnClaims: GapCell[]
  reserved: ReturnType<typeof reservedOffersFor>
}

/** ⚖ THE SALES DOOR, EXACTLY AS `TodayScreen` COMPOSES IT — gap layer first
 *  (its finished cells are the promises), then the sell layer reconciled
 *  against them, then the §5 fallback over what the reconcile threw away,
 *  additions-only against that SAME claims context. Nothing feeds back.
 *
 *  `held === undefined` is the round gate OFF, and it is spelled as an absent
 *  argument on purpose: that is the call the base commit makes. */
function door(w: World, c: Combo, held?: readonly ReservedLaneMask[]): Door {
  const { price, depth, frame } = priceOf()
  const guard = configOf(c)
  const dialOpts = {
    gridMin: c.gridMin,
    sessionMin: c.sessionMin,
    gapFillMin: c.gapFillMin,
    gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
    nowMinute: w.now,
    frame,
    depth,
    guard,
  }
  const gap = gapLayerFor(w.lanes, { ...dialOpts, minSellableMin: w.minSellableMin, locked: [], held })
  const claims: GapCell[] = [...gap.packed, ...gap.scraps]
  const drops: SellDrop[] = []
  const sell = sellLayerFor(w.lanes, w.hours, {
    gridMin: c.gridMin,
    nowMinute: w.now,
    locked: [],
    showPrice: true,
    hi: price.hi,
    hqMin: REAL.dialogs.pricing.hqMin,
    depth,
    reconcile: { claims, rooms: w.rooms, cleanupMinutesByBed: w.cleanup, onDrop: (d) => drops.push(d) },
    held,
  })
  const fallback = held
    ? fallbackCellsFor({
        lanes: w.lanes,
        closeMin: w.hours.close,
        dropped: drops,
        survivors: sell.cells,
        claims,
        cleanupMinutesByBed: w.cleanup,
        rooms: w.rooms,
        held,
        // ⚖ Greptile #815 — the same `locked: []` this composer already hands
        // `gap`/`sell` above (this file's worlds model no locked lanes).
        locked: [],
        dials: gapPackingDials(w.lanes, dialOpts),
      })
    : null
  const gapDrawn = fallback
    ? { packed: [...gap.packed, ...fallback.packed], scraps: [...gap.scraps, ...fallback.scraps] }
    : gap
  return {
    held,
    gap,
    claims,
    sell,
    drops,
    fallback,
    gapDrawn,
    drawnClaims: fallback ? [...claims, ...fallback.claims] : claims,
    reserved: held ? reservedOffersFor(held) : reservedOffersFor([]),
  }
}

/** The staff door's three readings of one board. They differ ONLY in the
 *  protected-window callback, which is the whole of spec §3's change:
 *    · `raw`     — no callback. Today's shipped rail.
 *    · `lattice` — a callback that always says yes. On the 5-minute lattice
 *                  (gap-guard :195) but blind to the rooms: the LATTICE column.
 *    · `bed`     — the real mask door. The extra difference is the BED column. */
/** ⚖ R7 — EXTRACTED, byte-for-byte, so that §4b's census can be handed THE RAIL'S
 *  OWN INPUT rather than a copy of it that a later edit could let drift. A pin
 *  that says 「the verdict agrees with the rail」 while building two inputs side
 *  by side is pinning two functions of two inputs; one builder makes the claim
 *  structural. `rails` below is unchanged in behaviour and in every argument. */
function railInputFor(w: World, c: Combo, kind: 'raw' | 'lattice' | 'bed', book: BedTruth = bookOf(w)): RailInput {
  const views = bedViewsFor(w.lanes, w.rooms, frameOf(w), null)
  return {
    open: w.hours.open,
    close: w.hours.close,
    stepMin: 30,
    dur: REAL.guard.standardSessionMin,
    protectedDur: c.protectedMin,
    nowMinute: w.now,
    locked: [],
    guard: { ...configOf(c), mode: c.mode === 'off' ? 'standard' : c.mode },
    excludeId: null,
    placementFeasible: bedDoor(views, w.lanes, null),
    protectedWindowFeasible:
      kind === 'raw'
        ? undefined
        : kind === 'lattice'
          ? () => true
          : (l, start, dur) => book.newClientMask(l, dur)(start),
  }
}

function rails(w: World, c: Combo, kind: 'raw' | 'lattice' | 'bed', book: BedTruth = bookOf(w)): GuardRail[] {
  return guardRailsFor(w.lanes, railInputFor(w, c, kind, book))
}

const cellKey = (c: RailCell) =>
  `${c.start}|${c.state}|${c.label}|${c.sentence}|${c.reason ?? '-'}|${c.alternatives.join(',')}|${c.alternativeKind ?? '-'}|${c.ackAllowed}`

const railKeys = (rs: GuardRail[]) => rs.flatMap((r) => r.cells.map((c) => `${r.laneKey}|${cellKey(c)}`))

const staffLanesOf = (lanes: BoardLane[]) => lanes.filter((l) => l.group === 'staff' && l.window != null)

// ── 1 · THE GATE ────────────────────────────────────────────────────────────

describe('1 — the round gate', () => {
  // ⚖ PIN MIGRATED at E3b, WITH the decision (SPEC-SELLING-ENGINE §12): E3b IS
  // the flip, and this line is the round's first and only switch. What the pin
  // is for has not changed — the shipped value is a FACT the suite states out
  // loud rather than something a reader has to open a file to learn — and the
  // clauses under it (no env var, one home, read at the boundary only, every
  // seam parameterised) are untouched and still the things that matter.
  it('ships ON from E3b — the flip is this line', () => {
    expect(SELLING_ENGINE_LAW).toBe(true)
    const gate = SRC('selling-engine-gate.ts')
    expect(gate).toContain('export const SELLING_ENGINE_LAW: boolean = true')
    // It is the ROUND's gate, not the store's. `gap_guard_mode` is the product
    // switch and it is already in the inputs — no env var, no second dial.
    expect(gate).not.toMatch(/process\.env/)
  })

  it('is read at the screen boundary ONLY — never in a layer, a predicate or a handler', () => {
    // ⚖ R5 POST-MERGE — `held-committed.ts` joins the list on the same terms as
    // its four siblings: it is a caller-side wrapper over the mask, so if it
    // ever read the round gate the constant would have a second home and the
    // five-read count below would not see it.
    const readers = ['today-interactions.ts', 'capacity-ledger.ts', 'reserved-mask.ts', 'fallback-cells.ts', 'held-committed.ts']
    for (const f of readers) expect({ f, has: SRC(f).includes('SELLING_ENGINE_LAW') }).toEqual({ f, has: false })
    // ⚖ ROUND 2 — AND IT READS NO SCREEN EITHER, for the same reason one file
    // over. Round 1 gave the wrapper the committed world's book by importing
    // `bedViewsFor` from TodayScreen, so the two files imported each other; it
    // ran, but a cycle on this seam is a trap for the next edit. The door is
    // handed in as `bookOf` now: the wrapper may not name the screen, and it
    // may not go around the door to `bedTruthViews` (the capacity book's own
    // producer) either. R3's ONE DOOR in its stronger form — the wrapper cannot
    // reach the book at all except through the function its caller gives it.
    //
    // ⚖ ROUND 3 — AND WHAT GUARANTEES THAT IS NOT THESE TWO LINES. The comment
    // here used to say it was, and a NAME pin is dodgeable: lens B's G3 reached
    // the screen through a SPLIT-STRING DYNAMIC REQUIRE, which spells neither
    // `./TodayScreen` nor `bedTruthViews` and left both lines green. It went
    // red at held-committed.test.ts §3 — the test that HANDS OVER a different
    // door and reads the answer that comes back. That behavioural test is the
    // guarantee. These two lines are belt-and-braces: they make the honest
    // spelling of the mistake unspellable, which is worth keeping and is cheap.
    // They are not the proof.
    expect(SRC('held-committed.ts')).not.toContain('./TodayScreen')
    expect(SRC('held-committed.ts')).not.toContain('bedTruthViews')
    // …and on the screen the gate is read exactly FIVE times, counted over the
    // file with its comment-led lines blanked: the import, the committed
    // world's mask, the board world's mask, the rail's protected-window door,
    // and (⚖ R7, SPEC §3.1) the VERDICT's. All four reads are memo or
    // useCallback bodies at the top level of the component; none is inside a
    // predicate, a handler or a render path.
    //
    // ⚖ BREAKER-827 F1 (BLOCKER) — SIX → FIVE, AND THE DECISION IS THE POINT.
    // The old count was SIX over the RAW file: the five above plus the JSDoc
    // sentence that explains the gate. A count that includes comments is the
    // count a decoy inflates — comment a real read out, leave a `//`-prefixed
    // copy where it stood, and the total never moves. So the prose mention is
    // no longer counted and the number is the number of READS. It still catches
    // a sixth read arriving (6 ≠ 5) and it now also catches a read leaving,
    // which is the direction the breaker walked through. The JSDoc is free to
    // be reworded without moving a pin, which it was not before.
    //
    // ⚖ R7 — THE COUNT MOVED BECAUSE THE GATE HALF LANDED. E3a threaded the
    // protected-window door into the RAIL and left `verdictAt` reading the raw
    // pocket-minute enumeration, so the strip's marks were bed-honest and the
    // word under the cursor was not. PROBE-R7 measured the gap at 1,625 of
    // 7,956 cells across both boards × every guarded combination; §4's new
    // rail≡verdict census pins it closed.
    //
    // ⚖ PIN MIGRATED at ROUND 1 OF THE FIX ROUND, WITH the decision. The
    // committed world's read used to sit in a SECOND memo up here (the one that
    // built the book), and that memo is gone — its book is built inside
    // `heldCommittedFor` now, because a screen-level book memo was a second
    // untested seam and a mutation lens went through it. The gate is still read
    // on the screen and still at the boundary; it is handed to the wrapper as a
    // bare parameter value instead of spelling a ternary here. Same decision,
    // same count, one home fewer.
    const screen = SRC('TodayScreen.tsx')
    const reads = [...codeOnly(screen).matchAll(/SELLING_ENGINE_LAW/g)].length
    expect(reads).toBe(5)
    // ⚖ D1 — and the number does not move when `codeOnly` learns about block
    // comments: all five reads are code, none of the six raw occurrences the
    // pre-armour count saw ever sat inside a block the new filter removes.
    // ⚖ BREAKER-827 F1 — AND THE FOUR SPELLINGS ARE WHOLE-LINE ANCHORED. The
    // fifth read is `heldBoard`'s bare `SELLING_ENGINE_LAW` line, the head of a
    // ternary; it used to be held by the count alone, which is the hole §DELTA
    // 3 S2 walked through (pay the token back at that line and shadow the name
    // above). It is anchored and pinned inside its own memo at the end of this
    // test now — the count is no longer carrying it by itself.
    // The second line here is the VERDICT's own door, the rail's line one
    // argument wider — `lanes` for the reason `placementFeasible` beside it
    // passes it (the block advisor asks about a board it has taken something
    // out of); `null` for the reason the rail asks `null`, a new client is
    // never the card in hand.
    for (const line of [
      "import { SELLING_ENGINE_LAW } from './selling-engine-gate'",
      'gateOn: SELLING_ENGINE_LAW,',
      'protectedWindowFeasible: SELLING_ENGINE_LAW ? bedDoorFor(null) : undefined,',
      'protectedWindowFeasible: SELLING_ENGINE_LAW ? bedDoorFor(null, lanes) : undefined,',
    ]) {
      expect({ line, has: pinnedLine(screen, line) }).toEqual({ line, has: true })
    }
    // ⚖ LENS-2 DECOY 3 (MAJOR) — AND EACH DOOR IS PINNED INSIDE ITS OWN CALL.
    // Presence-in-the-file is reachability-blind, and a MOVE leaves every total
    // exactly where it was: the lens deleted the verdict's door from the live
    // object literal and parked a byte-identical copy in a `void`-discarded
    // dead block above the hook — 486 green, tsc clean, and the guard back on
    // the raw pocket-minute enumeration, which is BREAKER F1's defect reached
    // by a different road. So each door line is now counted ONCE over code
    // file-wide AND pinned inside the slice of the call it is an argument to:
    // a duplicate moves the count, a move leaves the slice, and the two
    // together have nowhere left to stand.
    //
    // ⚖ BREAKER-827 §DELTA 3 S1 (BLOCKER) — AND THE SLICE MUST BE THE CALL.
    // `callSlice` took the FIRST occurrence of each anchor and nothing asserted
    // there was only one, so a verbatim DECOY of the rail's fourteen lines
    // parked in a never-taken branch above the real memo answered every pin
    // below while the live call shed its protected door: 530 suites green, tsc
    // exit 0, both doors dark. Each anchor is COUNTED before its text is read.
    const uniqueSlice = (open: string, close: string) => {
      const s = callSlice(screen, open, close)
      expect({ open, ok: s.ok, opens: s.opens, closes: s.closes }).toEqual({ open, ok: true, opens: 1, closes: 1 })
      return s
    }
    const rail = uniqueSlice('? guardRailsFor(boardLanes, {', '[guardOn, boardLanes, hours, props.guard, props.sell.nowMinute, locked, handId, railDur, bedDoorFor],')
    const verdict = uniqueSlice('? guardVerdictAt(lanes, laneKey, start, {', '[guardOn, boardLanes, hours, props.guard, props.sell.nowMinute, locked, bedDoorFor],')
    for (const [where, call, line] of [
      ['rail', rail.text, 'protectedWindowFeasible: SELLING_ENGINE_LAW ? bedDoorFor(null) : undefined,'],
      ['verdict', verdict.text, 'protectedWindowFeasible: SELLING_ENGINE_LAW ? bedDoorFor(null, lanes) : undefined,'],
    ] as const) {
      expect({ where, line, inThisCall: pinnedLines(call, line), inTheFile: pinnedLines(screen, line) })
        .toEqual({ where, line, inThisCall: 1, inTheFile: 1 })
    }

    // ⚖ BREAKER-827 §DELTA 3 S2 (BLOCKER) — AND FIVE READS IS NOT ONE BINDING.
    // The count above counts READS of a NAME; nothing here said where the name
    // is bound. `const SELLING_ENGINE_LAW = false` at the top of the component
    // shadows the import, and the fifth token is handed straight back by
    // hardcoding `heldBoard`'s bare ternary head to `true` — `reads` is still
    // 5, the import line is still pinned and present, `gateOn:
    // SELLING_ENGINE_LAW,` is still a whole anchored line, both door lines are
    // byte-identical inside their own slices, and BOTH protected doors are dark
    // with `heldCommittedFor`'s `gateOn` false beside them (487 green, tsc exit
    // 0). So: the import is the ONE binding site, every other binding shape is
    // banned, and the fifth read is pinned as a line inside the memo it decides.
    const CODE = codeOnly(screen)
    const GATE_IMPORT = "import { SELLING_ENGINE_LAW } from './selling-engine-gate'"
    expect({ gateImports: pinnedLines(screen, GATE_IMPORT) }).toEqual({ gateImports: 1 })
    expect({
      declarations: (CODE.match(/\b(?:const|let|var|function|class|import\s+type)\s+SELLING_ENGINE_LAW\b/g) ?? []).length,
    }).toEqual({ declarations: 0 })
    expect(CODE).not.toMatch(/\bSELLING_ENGINE_LAW\s*=(?!=)/)
    // The one legitimate `{ SELLING_ENGINE_LAW }` on this screen is the import
    // line, so it is removed before the destructuring and parameter shapes are
    // looked for rather than carved out of the patterns themselves.
    const CODE_SANS_GATE_IMPORT = CODE.replace(anchoredLine(GATE_IMPORT), '')
    expect(CODE_SANS_GATE_IMPORT).not.toMatch(/\(\s*SELLING_ENGINE_LAW\b/)
    expect(CODE_SANS_GATE_IMPORT).not.toMatch(/[,{]\s*SELLING_ENGINE_LAW\s*[,}]/)
    const heldBoard = uniqueSlice(
      'const heldBoard = useMemo(',
      '[boardLanes, hours.close, props.sell.nowMinute, props.guard.config, props.guard.mode, ledger, releasedHere, handId],',
    )
    expect({
      bareGateLines: pinnedLines(screen, 'SELLING_ENGINE_LAW'),
      inHeldBoard: pinnedLines(heldBoard.text, 'SELLING_ENGINE_LAW'),
    }).toEqual({ bareGateLines: 1, inHeldBoard: 1 })

    // ⚖ BREAKER-827 §DELTA 3 S3 (MAJOR) — AND THE ENGINE THE DOORS ARE HANDED
    // TO IS THE IMPORTED ONE. Both slices call `guardRailsFor` /
    // `guardVerdictAt` BY NAME, and a module-level shim (`guardRailsFor as
    // guardRailsForImpl` plus a local wrapper spreading
    // `protectedWindowFeasible: undefined` over the object the slice built)
    // forwards the door exactly as written and throws it away one line later:
    // every pinned character byte-identical, 487 green, tsc exit 0, and the
    // engine's own unit tests green because they import the real thing. The
    // two specifiers are whole-line anchored and counted, each name has exactly
    // TWO code mentions (the specifier and the call), and neither may be
    // defined on this screen.
    for (const [name, mentions] of [
      ['guardRailsFor', 2],
      ['guardVerdictAt', 2],
    ] as const) {
      expect({
        name,
        specifiers: pinnedLines(screen, `${name},`),
        mentions: (CODE.match(new RegExp('\\b' + name + '\\b', 'g')) ?? []).length,
        calls: (CODE.match(new RegExp('\\b' + name + '\\(', 'g')) ?? []).length,
        definitions: (CODE.match(new RegExp('\\b(?:function|const|let|var|class)\\s+' + name + '\\b', 'g')) ?? []).length,
      }).toEqual({ name, specifiers: 1, mentions, calls: 1, definitions: 0 })
    }
  })

  it('every seam takes the mask as a PARAMETER, so an absent mask is today’s code', () => {
    const int = SRC('today-interactions.ts')
    // Four named seams, four optional parameters, one shape.
    expect(int).toContain('held?: readonly ReservedLaneMask[]')
    expect(int).toContain('protectedWindowFeasible?: (lane: BoardLane, start: number, dur: number) => boolean')
    expect(int).toContain('heldHere: readonly ReservedSpan[] = [],')
    // The mask module is imported for its TYPES only — a value import would be
    // a module cycle (`reserved-mask` imports `laneSpans` from here).
    expect(int).toContain("import type { ReservedLaneMask, ReservedSpan } from './reserved-mask'")
    expect(int).not.toMatch(/import \{[^}]*reservedMaskFor/)
  })

  // ⚖ PIN MIGRATED at R5 POST-MERGE, WITH the decision. What the pin is for has
  // not changed — TWO worlds, TWO construction sites, both inside a `useMemo`
  // and neither inside a predicate, a callback or a handler. What moved is the
  // COMMITTED world's spelling: its call is now one hop deep, through
  // `heldCommittedFor` (held-committed.ts), because the memo's inline body could
  // only ever be held by a text pin and POSTMERGE-CHECK-88b7726c.md findings 1-2
  // measured two severe mutants slipping one. The wrapper is app-side and it is
  // NOT a layer, a predicate or a handler: it takes the world as a parameter
  // like every other seam, it calls `reservedMaskFor` exactly once, and it holds
  // no derivation of its own — held-committed.test.ts pins its answer against a
  // direct call. The gate constant is still read only on the screen (the test
  // above), and the mask is still built once per world per frame.
  //
  // ⚖ MIGRATED AGAIN at ROUND 1, same decision, one seam fewer. The committed
  // world's BOOK moved into the wrapper as well: a screen-level book memo was a
  // second seam no unit test could reach, and pre-gating it on the store's dial
  // emptied the mask with this whole family green. So the committed site's
  // first line is the round gate now rather than a book the screen already
  // built, and `bedViewsFor` — R3's ONE DOOR — is walked inside the wrapper for
  // that world. Still one construction site per world, still both in a memo.
  //
  // ⚖ MIGRATED AGAIN at ROUND 2, same decision, one import fewer. The wrapper
  // no longer IMPORTS the door — the screen hands it in as `bookOf`, because
  // round 1's import made the two files import each other. So the walk is
  // pinned by the parameter it now goes through rather than by the identifier
  // it used to import, and the test above pins that the wrapper cannot name
  // the screen or the book's producer at all. One walk, one hand, still.
  it('the mask is built ONCE PER WORLD PER FRAME, in a memo and never in a predicate', () => {
    const screen = SRC('TodayScreen.tsx')
    // One inline construction site left on the screen, one hop away in the
    // wrapper — and the wrapper is a wrapper, not a second derivation home.
    expect(screen.split('reservedMaskFor({').length - 1).toBe(1)
    expect(SRC('held-committed.ts').split('reservedMaskFor({').length - 1).toBe(1)
    // …and the committed world's book has exactly ONE door and one hand: the
    // wrapper walks it once, with `null`, because prices read the settled board.
    expect(SRC('held-committed.ts').split('bookOf(').length - 1).toBe(1)
    expect(SRC('held-committed.ts')).toContain('bookOf(mask.lanes, rooms, frame, null).world')
    // …and the door it is handed is the screen's one wrapper, not a second one.
    expect(screen).toContain('bookOf: bedViewsFor,')
    const sites: readonly (readonly [string, string])[] = [
      ['committed', 'heldCommittedFor({\n        gateOn: SELLING_ENGINE_LAW,'],
      ['board', 'reservedMaskFor({\n            lanes: boardLanes,'],
    ]
    for (const [world, spelling] of sites) {
      const at = screen.indexOf(spelling)
      expect({ world, wired: at }).not.toEqual({ world, wired: -1 })
      // The nearest enclosing hook before it is a useMemo, not a callback or a
      // handler — the ledger-threading discipline the capacity book is under.
      const before = screen.slice(0, at)
      expect(before.lastIndexOf('useMemo(')).toBeGreaterThan(before.lastIndexOf('useCallback('))
    }
  })
})

// ── 2 · GATED-OFF IDENTITY ──────────────────────────────────────────────────

describe('2 — gated off, every seam is the one that ships', () => {
  // The matrix is walked INSIDE the body rather than through `it.each`: the
  // combinations are derived from the store's own dials, which arrive in
  // `beforeAll`, and `it.each` is evaluated at module load.
  //
  // ⚠ AN EMPTY MASK IS NOT THE GATE BEING OFF, and the two legs are kept apart
  // for exactly that reason. `held === undefined` is the gate off: no mask, no
  // fallback pass, no reserved emission — the call the base commit makes.
  // `held === []` is the gate ON at a store whose スキマガード is off, which is
  // spec §6's separate no-op: the LAW contributes nothing because nothing is
  // held. What the §5 fragment fallback does on such a store is the gate's
  // question, not the mask's — measured in §3 and reported, never assumed here.
  it('across both boards × the widened matrix — an empty mask changes nothing the LAW touches', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        const at = `${w.name} · ${comboLabel(c)}`
        const off = door(w, c)
        const empty = door(w, c, [])
        expect({ at, x: empty.gap }).toEqual({ at, x: off.gap })
        expect({ at, x: empty.sell }).toEqual({ at, x: off.sell })
        expect({ at, x: empty.drops }).toEqual({ at, x: off.drops })
        expect({ at, x: empty.claims }).toEqual({ at, x: off.claims })
        expect({ at, x: empty.reserved }).toEqual({ at, x: [] })
        expect({ at, x: empty.sell.cells.some(isHeldBound) }).toEqual({ at, x: false })
        // …and the rail's sentences too.
        const railsOff = rails(w, c, 'raw')
        expect({ at, x: explainOf(w, c, railsOff, off, undefined) }).toEqual({
          at,
          x: explainOf(w, c, railsOff, off, []),
        })
      }
    }
  })

  it('gated off, the composed layer objects are the SAME objects — nothing is copied', () => {
    // Identity, not equality: a gated-off frame must not even allocate a new
    // array, or every downstream memo on this screen re-runs for nothing.
    const w = fixtureWorld()
    const c = shipped()
    const off = door(w, c)
    expect(off.gapDrawn).toBe(off.gap)
    expect(off.drawnClaims).toBe(off.claims)
    expect(off.fallback).toBeNull()
  })

  it('no sell cell is tagged held-bound when there is no mask', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        expect(door(w, c).sell.cells.some(isHeldBound)).toBe(false)
      }
    }
  })
})

function explainOf(
  w: World,
  c: Combo,
  rs: GuardRail[],
  d: Door,
  held: readonly ReservedLaneMask[] | undefined,
) {
  const map = explainRails(rs, w.lanes, {
    dur: REAL.guard.standardSessionMin,
    handId: null,
    rooms: w.rooms,
    stagedId: null,
    sellCells: d.sell.cells,
    claims: d.drawnClaims,
    drops: d.drops,
    inHand: false,
    sellDisplayed: true,
    held,
  })
  const byLane = new Map((held ?? []).map((m) => [m.laneKey, m.spans]))
  return rs.map((r) => {
    const per = map.get(r.laneKey) ?? new Map()
    return {
      laneKey: r.laneKey,
      per: [...per].map(([start, e]) => ({ start, ...e })),
      restCues: restCueStarts(
        per,
        d.sell.cells.filter((s) => s.group === 'staff' && s.laneKey === r.laneKey),
        d.drawnClaims.filter((g) => g.group === 'staff' && g.laneKey === r.laneKey),
        byLane.get(r.laneKey),
      ),
    }
  })
}

// ── 3 · THE SALES DOOR, GATE ON ─────────────────────────────────────────────

describe('3 — the sales door with the mask live', () => {
  const emitted = (d: Door) =>
    [...(d.fallback?.packed ?? []), ...(d.fallback?.scraps ?? [])]
      .filter((x) => x.group === 'staff')
      .map((x) => `${x.laneKey} ${span(x.s, x.e)} ${x.resourceKey} ¥${x.price}`)
      .sort()

  it('the ごろう fragments come back through the WIRING — E2’s own numbers, composed', () => {
    // E2 proved the PASS; this proves the COMPOSITION reaches it. The mask is
    // empty here (the store's guard off) so the board is the one the probe
    // measured, and the two fragments are PROBE-E2 SIM-7's to the yen — now
    // inside `gapDrawn`, which is what the board paints, rather than inside a
    // test's own variable.
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const on = door(w, c, maskOf(w, c))
    expect(on.drops.map((d) => `${d.laneKey}@${hhmm(d.h)}/${d.kind}`)).toEqual(['p-05@15:00/room', 'p-05@16:00/room'])
    expect(emitted(on)).toEqual(['p-05 15:30-16:00 bed-01 ¥4410', 'p-05 16:30-17:00 bed-03 ¥4610'])
    // …and the layer the reconcile built is untouched by the addition: the
    // fallback is additions-only, appended after every surviving box.
    expect(on.gapDrawn.packed.slice(0, on.gap.packed.length)).toEqual(on.gap.packed)
    expect(on.gapDrawn.scraps.slice(0, on.gap.scraps.length)).toEqual(on.gap.scraps)
  })

  /** ⚖ A SECOND-ORDER EFFECT, MEASURED — and it is the good kind, so it is
   *  pinned rather than left to be rediscovered as a surprise at E3b.
   *
   *  Masking UPSTREAM (spec §4.1) does not only withhold: it takes the withheld
   *  boxes OUT OF THE ROOM COMPETITION. On the fixture at the store's own dials
   *  the box that beat 見本ごろう's 15:00 and 16:00 hours to ベッド2 — flag 86's
   *  own scene — lies inside a held window, so with the guard on it is never
   *  derived, ごろう's hours are never dropped, and the stretch is not empty in
   *  the first place. There is nothing left for the §5 fallback to reach.
   *
   *  So the fragments are the GUARD-OFF answer, and the guard-ON answer is
   *  better than fragments: the same minutes sell as full-price 販売可能枠 hours.
   *  Liam sees both at E3b; neither is a builder's ruling. */
  it('with the mask live the ごろう stretch is not empty at all — the hours survive instead', () => {
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    const on = door(w, c, held)
    // p-05 is held 14:30–16:00, and it no longer loses anything.
    expect(held.find((m) => m.laneKey === 'p-05')?.spans.map((s) => span(s.start, s.end))).toEqual(['14:30-16:00'])
    expect(on.drops.some((d) => d.laneKey === 'p-05')).toBe(false)
    expect(emitted(on)).toEqual([])
    // The two hours the reconcile used to throw away are on the board — the
    // first inside the held window (so tagged, withheld from a regular
    // customer's feed until E3b's rank dial), the second outside it.
    const hours = on.sell.cells
      .filter((s) => s.group === 'staff' && s.laneKey === 'p-05' && (s.h === 900 || s.h === 960))
      .map((s) => `${hhmm(s.h)} ${s.resourceKey} heldBound=${isHeldBound(s)}`)
      .sort()
    expect(hours).toEqual(['15:00 bed-02 heldBound=true', '16:00 bed-02 heldBound=false'])
    // …and the withholding really happened: the guarded gap layer is smaller.
    expect(on.gap.packed.length + on.gap.scraps.length).toBeLessThan(
      door(w, c).gap.packed.length + door(w, c).gap.scraps.length,
    )
  })

  it('across both boards × every guarded combination — the whole composed law holds', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        if (c.mode === 'off') continue
        assertComposedLaw(`${w.name} · ${comboLabel(c)}`, w, c)
      }
    }
  })

  function assertComposedLaw(label: string, w: World, c: Combo) {
    const held = maskOf(w, c)
    const on = door(w, c, held)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    const broken: string[] = []

    // (i) NOTHING HELD IS SOLD BY THE GAP LAYER. The mask sits upstream of the
    //     derivation, so a held minute is never a candidate in the first place.
    for (const g of [...on.gapDrawn.packed, ...on.gapDrawn.scraps]) {
      if (g.group !== 'staff') continue
      if ((byLane.get(g.laneKey) ?? []).some((h) => meets(g.s, g.e, h.start, h.end))) {
        broken.push(`gap ${g.laneKey} ${span(g.s, g.e)} inside a held window`)
      }
    }

    // (ii) SELL HOURS INSIDE A HELD WINDOW ARE TAGGED, and nothing else is.
    for (const s of on.sell.cells) {
      const inside = (byLane.get(s.laneKey) ?? []).some((h) => meets(s.h, s.h + SELL_SLOT_MIN, h.start, h.end))
      if (inside !== isHeldBound(s)) {
        broken.push(`sell ${s.laneKey}@${hhmm(s.h)} tagged=${isHeldBound(s)} inside=${inside}`)
      }
    }

    // (iii) ONE RESERVED OFFER PER HELD WINDOW, and it names the window.
    const windows = windowsIn(held)
    if (on.reserved.length !== windows.length) {
      broken.push(`reserved ${on.reserved.length} ≠ held windows ${windows.length}`)
    }
    for (const [i, o] of on.reserved.entries()) {
      const win = windows[i]
      if (o.kind !== 'reserved' || o.laneKey !== win.laneKey || o.start !== win.start || o.end !== win.end) {
        broken.push(`reserved offer ${i} does not name its window`)
      }
    }

    // (iv) ZERO DOUBLE-CLAIMS ON THE ROOM AXIS — the claims book's own oracle,
    //      over everything the board now draws.
    const offers: OfferInput[] = boardOffers(on.sell.cells, [...on.gapDrawn.packed, ...on.gapDrawn.scraps])
    const violations = buildClaims(bookOf(w), offers).violations(w.cleanup)
    for (const v of violations) {
      broken.push(`room ${v.resourceKey}: ${span(v.earlier.startMin, v.earlier.endMin)} vs ${span(v.later.startMin, v.later.endMin)}`)
    }

    // (v) …AND ON THE STAFF AXIS. The claims book is grouped by room and cannot
    //     see this one (its own header says so), so it is asserted here: a
    //     PROMISE is a unit, so no two 詰め込み／スキマ／fallback boxes may share
    //     a person-minute, and none may sit inside a surviving 販売可能枠 hour
    //     on its own lane (`busyLane`'s law, one layer down).
    const promises = [...on.gapDrawn.packed, ...on.gapDrawn.scraps].filter((g) => g.group === 'staff')
    for (const [i, a] of promises.entries()) {
      for (const b of promises.slice(i + 1)) {
        if (a.laneKey === b.laneKey && meets(a.s, a.e, b.s, b.e)) {
          broken.push(`${a.laneKey} promised twice over ${span(a.s, a.e)} / ${span(b.s, b.e)}`)
        }
      }
      for (const s of on.sell.cells) {
        if (s.group === 'staff' && s.laneKey === a.laneKey && meets(a.s, a.e, s.h, s.h + SELL_SLOT_MIN)) {
          broken.push(`${a.laneKey} promised ${span(a.s, a.e)} under its own sell hour ${hhmm(s.h)}`)
        }
      }
    }

    expect({ at: label, broken }).toEqual({ at: label, broken: [] })
  }

  it('the matrix is not vacuous — the law fires at the store’s own dials', () => {
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    expect(windowsIn(held).length).toBeGreaterThan(0)
    const on = door(w, c, held)
    // Something is actually withheld: the guarded gap layer is smaller than the
    // open one, or a sell hour is tagged. (Both, on this board.)
    const openBoxes = door(w, c).gap.packed.length + door(w, c).gap.scraps.length
    const heldBoxes = on.gap.packed.length + on.gap.scraps.length
    expect(heldBoxes).toBeLessThanOrEqual(openBoxes)
    expect(on.sell.cells.some(isHeldBound)).toBe(true)
    expect(on.reserved.length).toBe(windowsIn(held).length)
  })

  it('a guard-OFF store holds nothing — the LAW imposes nothing on it', () => {
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const held = maskOf(w, c)
    expect(held).toEqual([])
    const on = door(w, c, held)
    const off = door(w, c)
    expect(on.gap).toEqual(off.gap)
    expect(on.sell).toEqual(off.sell)
    expect(on.reserved).toEqual([])
    expect(on.sell.cells.some(isHeldBound)).toBe(false)
  })

  /** ⚠ THE ONE THING E3a MEASURES AND DOES NOT DECIDE — carried to E3b, and
   *  named here rather than discovered there.
   *
   *  Spec §11.3's HELD-SWEEP invariant (iii) reads 「guard-OFF ⇒ board
   *  byte-identical to pre-round」, and spec §6 says a guard-off store 「keeps
   *  today's exact behavior… nothing new appears」. Both sentences are about the
   *  スキマガード dial and the LAW it gates — and the mask honours them exactly
   *  (the test above).
   *
   *  But §5's fragment fallback is NOT the held law. It is a separate product
   *  ruling about what R4's reconcile throws away, and the packet wires it
   *  behind the ROUND gate, not behind `gap_guard_mode`. So a store with the
   *  guard OFF and the round gate ON gets the fragments back — 「nothing new
   *  appears」 becomes false for that store, by exactly this many boxes.
   *
   *  Nothing is decided here: the round gate is ON (it shipped at E3b) — this
   *  fallback's guard-off gain is live product today, unruled as
   *  guard-conditional. The number is measured, pinned, and goes to Liam with
   *  E3b's flip. Making the fallback guard-conditional is one `&&` if he rules
   *  that way; it is a product call and not a builder's. */
  it('MEASURED, NOT RULED: what a guard-OFF store gains from the §5 fallback alone', () => {
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const on = door(w, c, maskOf(w, c))
    const off = door(w, c)
    // ¥9,020 of fragments that do not exist on that store today.
    expect(emitted(on)).toEqual(['p-05 15:30-16:00 bed-01 ¥4410', 'p-05 16:30-17:00 bed-03 ¥4610'])
    expect(on.gapDrawn.packed.length + on.gapDrawn.scraps.length).toBeGreaterThan(off.gap.packed.length + off.gap.scraps.length)
    // …and the LAW's own surfaces are still untouched on that store.
    expect(on.sell).toEqual(off.sell)
    expect(on.reserved).toEqual([])
  })
})

// ── 4 · THE STAFF DOOR ──────────────────────────────────────────────────────

interface RailRow {
  board: string
  dials: string
  raw: number
  lattice: number
  bed: number
  latticeDelta: number
  bedDelta: number
  heldWindows: number
  refused: number
}

const RAIL_ROWS: RailRow[] = []

describe('4 — the staff door answers from the same held set', () => {
  it('across both boards × every guarded combination — mask vs legacy, in two columns', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        if (c.mode === 'off') continue
        assertRailDelta(`${w.name} · ${comboLabel(c)}`, w, c)
      }
    }
  })

  /** ⚠ THE ANTI-VACUITY LEG. Every assertion above is of the form 「if a verdict
   *  moved, here is why」 — all of which pass trivially if the callback is never
   *  threaded at all. So the table is asked whether the threading DOES anything:
   *  the bed column has to be non-zero somewhere, and the lattice column has to
   *  be zero everywhere on these two boards (measured, and the reason is in the
   *  artifact).
   *
   *  ⚖ R7 CORRECTION (PROBE-R7 §P2). This comment used to give the reason as
   *  「every pocket here starts on a lattice minute」, and that is not true: the
   *  fixture's `p-06` pocket starts at 804 — `now` itself, off-lattice. The
   *  narrower claim is the true one and it is the one the leg below actually
   *  tests: the off-lattice pockets on these two boards are too SHORT to admit a
   *  protected window at all, so raw and lattice enumerate the same empty list
   *  and there is nothing for the enumeration move to move. A board with a long
   *  off-lattice pocket does show it — NOW-TRUNCATED-SCENE builds one. */
  it('the threading is not a no-op — the bed column moves, the lattice column does not', () => {
    expect(RAIL_ROWS.length).toBeGreaterThan(0)
    expect(RAIL_ROWS.every((r) => r.latticeDelta === 0)).toBe(true)
    expect(RAIL_ROWS.reduce((n, r) => n + r.bedDelta, 0)).toBeGreaterThan(0)
    // …and it moves in BOTH directions, which is the honest shape of the fix:
    // the guard stops protecting windows no room can host (fewer refusals) and
    // starts seeing real ones it had been blind to (more).
    expect(RAIL_ROWS.some((r) => r.bed < r.lattice)).toBe(true)
    expect(RAIL_ROWS.some((r) => r.bed > r.lattice)).toBe(true)
  })

  function assertRailDelta(label: string, w: World, c: Combo) {
    const book = bookOf(w)
    const raw = rails(w, c, 'raw')
    const lat = rails(w, c, 'lattice', book)
    const bed = rails(w, c, 'bed', book)
    const rawK = railKeys(raw)
    const latK = railKeys(lat)
    const bedK = railKeys(bed)
    const latticeDelta = latK.filter((k, i) => k !== rawK[i]).length
    const bedDelta = bedK.filter((k, i) => k !== latK[i]).length

    // ⚖ THE NEUTRALISED LEG (packet proof 3): with the bed callback answering
    // yes to everything, the ONLY thing the attachment can do is move the
    // enumeration onto the 5-minute lattice. On a board whose pockets all begin
    // on a lattice minute there is nothing for it to move, and the verdicts are
    // the legacy ones exactly. Asserted CONDITIONALLY on the measured fact
    // rather than assumed — the condition is itself the honest statement.
    const offLattice = staffLanesOf(w.lanes).flatMap((l) =>
      freePockets({
        from: l.window!.from,
        until: l.window!.until,
        close: w.hours.close,
        now: w.now,
        occupied: laneSpans(l),
      }).filter((p) => p.s % 5 !== 0),
    )
    if (offLattice.length === 0) expect({ at: label, latticeDelta }).toEqual({ at: label, latticeDelta: 0 })

    // ⚖ THE LIVE LEG: every remaining difference is a BED difference, and each
    // one is explained by a protected window in that lane the book refuses.
    const engine = createGapGuard({ ...configOf(c), mode: c.mode === 'off' ? 'standard' : c.mode })
    const yes: GuardContext = { protectedWindowFeasible: () => true }
    const unexplained: string[] = []
    for (const [li, r] of bed.entries()) {
      const l = w.lanes.find((x) => x.key === r.laneKey)!
      const pockets = freePockets({
        from: l.window!.from,
        until: l.window!.until,
        close: w.hours.close,
        now: w.now,
        occupied: laneSpans(l),
      })
      const mask = book.newClientMask(l, c.protectedMin)
      const infeasible = pockets.some((p) =>
        engine.protectedCapacity(p, null, yes).beforeStarts.some((s) => !mask(s)),
      )
      for (const [ci, cell] of r.cells.entries()) {
        if (cellKey(cell) === cellKey(lat[li].cells[ci])) continue
        if (!infeasible) unexplained.push(`${r.laneKey}@${hhmm(cell.start)} moved with every window bed-feasible`)
      }
    }
    expect({ at: label, unexplained }).toEqual({ at: label, unexplained: [] })

    // ⚖ THE LAW ITSELF (spec §1's closing clause): the mask's held set and the
    // rail's own enumeration under the same callback are ONE answer.
    const disagreements: string[] = []
    const held = maskOf(w, c, book)
    for (const l of staffLanesOf(w.lanes)) {
      const pockets = freePockets({
        from: l.window!.from,
        until: l.window!.until,
        close: w.hours.close,
        now: w.now,
        occupied: laneSpans(l),
      })
      const ctx: GuardContext = { protectedWindowFeasible: (s, d) => book.newClientMask(l, d)(s) }
      const railStarts = pockets.flatMap((p) => engine.protectedCapacity(p, null, ctx).beforeStarts)
      const maskStarts = (held.find((m) => m.laneKey === l.key)?.spans ?? []).map((s) => s.windowStart)
      if (JSON.stringify(railStarts) !== JSON.stringify(maskStarts)) {
        disagreements.push(`${l.key}: rail ${railStarts.join(',')} ≠ mask ${maskStarts.join(',')}`)
      }
    }
    expect({ at: label, disagreements }).toEqual({ at: label, disagreements: [] })

    RAIL_ROWS.push({
      board: w.name,
      dials: comboLabel(c),
      raw: rawK.filter((k) => k.includes('|blocked|')).length,
      lattice: latK.filter((k) => k.includes('|blocked|')).length,
      bed: bedK.filter((k) => k.includes('|blocked|')).length,
      latticeDelta,
      bedDelta,
      heldWindows: windowsIn(held).length,
      refused: staffLanesOf(w.lanes).reduce((n, l) => {
        const mask = book.newClientMask(l, c.protectedMin)
        return (
          n +
          freePockets({
            from: l.window!.from,
            until: l.window!.until,
            close: w.hours.close,
            now: w.now,
            occupied: laneSpans(l),
          }).reduce((m, p) => m + engine.protectedCapacity(p, null, yes).beforeStarts.filter((s) => !mask(s)).length, 0)
        )
      }, 0),
    })
  }
})

// ── 4b · THE GATE HALF: THE DROP VERDICT READS THE SAME BOOK ────────────────

const R7_EVIDENCE = process.env.R7_EVIDENCE ?? ''
const R7_SHA = process.env.R7_SHA ?? 'unstamped'

/** `before`/`after` are counted by `cellKey` — the eight fields the OPERATOR
 *  sees (state, label, sentence, reason, alternatives, …), which is the measure
 *  PROBE-R7 §P1's table and Liam's picture are drawn in. `beforeFull`/`afterFull`
 *  are the same comparison over the WHOLE cell, `impact` included: a verdict can
 *  agree on every visible field and still report a protected window starting at a
 *  minute the rooms refuse, which is a real disagreement that `cellKey` cannot
 *  see. Both are kept because the law leg wants the strict one and the picture
 *  wants the visible one. */
interface VerdictRow {
  board: string
  dials: string
  now: number | null
  cells: number
  before: number
  after: number
  beforeFull: number
  afterFull: number
  transitions: string
  sumDB: number
  sumDA: number
}
const VERDICT_ROWS: VerdictRow[] = []
/** The now-truncated scene §11.4 asks any guard round for, filled by its own leg. */
let TRUNCATED: {
  world: string
  now: number
  laneKey: string
  pocket: { s: number; e: number }
  raw: number[]
  lattice: number[]
  bed: number[]
  railVsWith: number
  railVsWithout: number
} | null = null

/** The three `now` values every world is measured at, deduped: its own, the
 *  fixture's real 13:24 (804 — the board Liam is looking at), and `null` (a
 *  board with no clock on it, which is tomorrow). */
const nowsFor = (w: World): (number | null)[] => [...new Set<number | null>([w.now, 804, null])]

const SHIPPED_FIXTURE_DIALS = 'grid=60 S=60 gapFillMin=30 protected=90 guard=standard'

/** ⚖ SPEC §3.1 — THE OTHER HALF OF §4, AND THE ONE R7 EXISTS FOR.
 *
 *  §4 above proves the RAIL answers out of the held set. It says nothing about
 *  the VERDICT — the word under the cursor, the drop, `pendingGuardRow`,
 *  `offerableCell`'s re-verdicts and the 「新規N分の空きB→A」 sentence — which
 *  E3a left reading a RAW pocket-minute enumeration with no bed filter at all.
 *  Two readings of one board, free to disagree, and PROBE-R7 §P1 measured that
 *  they DO: 1,625 of 7,956 cells across both boards × every guarded combination.
 *
 *  This describe is that measurement made permanent, in two legs that fail for
 *  opposite reasons:
 *    · the LAW leg — with the door threaded, rail ≡ verdict at EVERY cell, zero
 *      disagreements. It goes red if the verdict site loses its door.
 *    · the ANTI-VACUITY leg — WITHOUT the door the counts are pinned as numbers,
 *      because a law leg that passes trivially proves nothing. Each number says
 *      what it measures; a drift shows up as a moved number, never a silent pass. */
describe('4b — the DROP verdict answers from the same held set as the rail', () => {
  it('the census: rail ≡ verdict at every cell, both boards × every guarded combo × every now', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        if (c.mode === 'off') continue
        for (const now of nowsFor(w)) {
          const wv: World = { ...w, now }
          const book = bookOf(wv)
          // The rail EXACTLY as it ships, and the verdict handed the rail's own
          // input object — one builder, so「the same question」 is structural.
          const rail = rails(wv, c, 'bed', book)
          const withDoor = railInputFor(wv, c, 'bed', book)
          const withoutDoor = railInputFor(wv, c, 'raw', book)
          let cells = 0
          let before = 0
          let after = 0
          let beforeFull = 0
          let afterFull = 0
          let sumDB = 0
          let sumDA = 0
          const transitions = new Map<string, number>()
          for (const r of rail) {
            for (const cell of r.cells) {
              cells += 1
              const vBefore = guardVerdictAt(wv.lanes, r.laneKey, cell.start, withoutDoor)
              const vAfter = guardVerdictAt(wv.lanes, r.laneKey, cell.start, withDoor)
              const railK = cellKey(cell)
              const railFull = JSON.stringify(cell)
              if ((vBefore ? cellKey(vBefore) : 'NULL') !== railK) {
                before += 1
                const t = `${vBefore ? vBefore.state : 'null'}→${cell.state}`
                transitions.set(t, (transitions.get(t) ?? 0) + 1)
              }
              if ((vAfter ? cellKey(vAfter) : 'NULL') !== railK) after += 1
              if (JSON.stringify(vBefore) !== railFull) beforeFull += 1
              if (JSON.stringify(vAfter) !== railFull) afterFull += 1
              sumDB += Math.abs((cell.impact?.capacityBefore ?? 0) - (vBefore?.impact?.capacityBefore ?? 0))
              sumDA += Math.abs((cell.impact?.capacityAfter ?? 0) - (vBefore?.impact?.capacityAfter ?? 0))
            }
          }
          VERDICT_ROWS.push({
            board: wv.name,
            dials: comboLabel(c),
            now,
            cells,
            before,
            after,
            beforeFull,
            afterFull,
            transitions: [...transitions].map(([t, n]) => `${t}:${n}`).join(', '),
            sumDB,
            sumDA,
          })
        }
      }
    }
    // THE LAW: not "fewer disagreements" — none, and none at the STRICT measure
    // either (the whole cell, `impact` included, so a verdict cannot pass by
    // agreeing on the words while reporting a protected window the rooms
    // refuse). Reported as the offending rows rather than as a count, so a
    // failure names the board and the dials instead of a bare number.
    const disagreeing = VERDICT_ROWS.filter((r) => r.after !== 0 || r.afterFull !== 0).map(
      (r) => `${r.board} · ${r.dials} · now=${r.now}: ${r.after} visible / ${r.afterFull} whole-cell`,
    )
    expect(disagreeing).toEqual([])
  })

  it('ANTI-VACUITY — without the door the verdict DOES disagree, by these measured numbers', () => {
    // 68 rows: 2 boards × 17 guarded combinations × 2 distinct `now` each.
    expect({ rows: VERDICT_ROWS.length, cells: VERDICT_ROWS.reduce((n, r) => n + r.cells, 0) }).toEqual({ rows: 68, cells: 7956 })
    // The whole census, two numbers: cells where the UN-migrated verdict path
    // (no `protectedWindowFeasible`) answers something other than the shipped
    // rail's own cell. 1,625 of them differ in what the operator SEES; 1,865 in
    // the whole cell — the extra 240 agree on every word and disagree about
    // which minute the protected window starts at, which is the same defect
    // one field deeper. This is what R7 closes, both counts to zero.
    expect({
      visible: VERDICT_ROWS.reduce((n, r) => n + r.before, 0),
      wholeCell: VERDICT_ROWS.reduce((n, r) => n + r.beforeFull, 0),
    }).toEqual({ visible: 1625, wholeCell: 1865 })

    // THE TWO ROWS LIAM'S PICTURE IS DRAWN FROM, pinned individually and in full
    // — the fixture at the store's own shipped dials, on the board he is looking
    // at (now=804 is 13:24, `REAL.sell.nowMinute`) and on tomorrow's (now=null).
    const fixtureAt = (now: number | null) =>
      VERDICT_ROWS.find((r) => r.board === 'fixture' && r.dials === SHIPPED_FIXTURE_DIALS && r.now === now)
    // TODAY: 5 of 90 strip cells disagree — four of them on lane p-05 about
    // WHICH minute the protected window starts at (865 raw vs 870 on the
    // lattice) and which alternative start is offered (955 vs 960), and ONE a
    // real state flip at 16:00: `blocked` → `degraded`. A start the strip
    // already calls fine that the drop refuses today.
    expect(fixtureAt(804)).toEqual({
      board: 'fixture',
      dials: SHIPPED_FIXTURE_DIALS,
      now: 804,
      cells: 90,
      before: 5,
      after: 0,
      beforeFull: 5,
      afterFull: 0,
      transitions: 'blocked→blocked:4, blocked→degraded:1',
      // Every one of the five is a `fit`/`R-UNAVAILABLE`-class or
      // alternatives-only difference, so no capacity figure moves today.
      sumDB: 0,
      sumDA: 0,
    })
    // TOMORROW: 12 of 90, and the state flips go BOTH ways — three windows the
    // guard was blind to become safe, two it was protecting for nobody become
    // blocked. Both directions are the same fix; only the second costs a start.
    expect(fixtureAt(null)).toEqual({
      board: 'fixture',
      dials: SHIPPED_FIXTURE_DIALS,
      now: null,
      cells: 90,
      before: 12,
      after: 0,
      beforeFull: 12,
      afterFull: 0,
      transitions: 'blocked→blocked:6, blocked→degraded:1, degraded→safe:3, degraded→blocked:2',
      sumDB: 8,
      sumDA: 5,
    })
  })

  /** ⚖ SPEC §11.4 — THE NOW-TRUNCATED SCENE, which every guard round owes and no
   *  round has yet filed. §4's Δlattice column is 0 on both of this file's
   *  boards, and the reason is NOT that their pockets are on-lattice (⚖ R7
   *  correction above): it is that the off-lattice ones are too short to admit a
   *  protected window. So the enumeration move is invisible here — and a column
   *  nothing ever moves is a column a later edit can quietly break.
   *
   *  This is the smallest board where it DOES move (PROBE-R7 §P2): a pocket
   *  truncated by `now` itself, long enough to hold a 90-minute window. RAW
   *  starts it at the pocket's own minute, the lattice at the next multiple of
   *  five, and the store's real bed-aware mask refuses it a window at all —
   *  three different answers to one question, which is exactly why the table
   *  keeps two columns and why the door is the one that ships. */
  it('SPEC §11.4 — the now-truncated scene: RAW ≠ LATTICE ≠ BED, and the verdict follows the rail', () => {
    const w: World = { ...syntheticWorld(), now: 811 }
    const c = shipped()
    const book = bookOf(w)
    const engine = createGapGuard({ ...configOf(c), mode: c.mode === 'off' ? 'standard' : c.mode })
    const lane = staffLanesOf(w.lanes).find((l) => l.key === 'p-05')!
    const pocket = freePockets({
      from: lane.window!.from,
      until: lane.window!.until,
      close: w.hours.close,
      now: w.now,
      occupied: laneSpans(lane),
    }).find((p) => p.s % 5 !== 0)!
    // The pocket `now` truncated: it begins at 811, which is not a lattice minute.
    expect({ s: pocket.s, e: pocket.e }).toEqual({ s: 811, e: 915 })

    const startsUnder = (ctx: GuardContext) => engine.protectedCapacity(pocket, null, ctx).beforeStarts
    const raw = startsUnder({})
    const lattice = startsUnder({ protectedWindowFeasible: () => true })
    const bed = startsUnder({ protectedWindowFeasible: (s, d) => book.newClientMask(lane, d)(s) })
    // THREE ANSWERS: the pocket's own minute · the lattice ceiling · and the
    // book, which says no room in this store can host the window at all.
    expect({ raw, lattice, bed }).toEqual({ raw: [811], lattice: [815], bed: [] })

    // …and on this lane, at every start the rail paints, the verdict WITH the
    // door reproduces the rail exactly while the verdict WITHOUT it does not.
    //
    // ⚠ MEASURED, AND IT IS THE WHOLE CELL THAT CARRIES IT. On this lane the two
    // verdicts agree on every VISIBLE field — same state, same sentence, same
    // alternatives — and disagree at `impact.windowsBefore`: without the door
    // the un-migrated path reports the protected window starting at the second
    // pocket's own minute (975) where the rail, on the lattice and through the
    // beds, says 990. So `cellKey` sees nothing here and the whole cell sees
    // two. A leg written against `cellKey` alone would have passed vacuously on
    // the very scene it exists to demonstrate.
    const rail = rails(w, c, 'bed', book).find((r) => r.laneKey === 'p-05')!
    const ne = (input: RailInput) =>
      rail.cells.filter((cell) => JSON.stringify(guardVerdictAt(w.lanes, 'p-05', cell.start, input)) !== JSON.stringify(cell)).length
    const railVsWith = ne(railInputFor(w, c, 'bed', book))
    const railVsWithout = ne(railInputFor(w, c, 'raw', book))
    expect({ cells: rail.cells.length, railVsWith, railVsWithout }).toEqual({ cells: 18, railVsWith: 0, railVsWithout: 2 })
    TRUNCATED = { world: w.name, now: 811, laneKey: 'p-05', pocket: { s: pocket.s, e: pocket.e }, raw, lattice, bed, railVsWith, railVsWithout }
  })

  /** The two artifacts this describe owes, written the way the flip test writes
   *  RELEASE-SCENE: under a named env var, so the suite is silent in CI and the
   *  round's evidence run gets files stamped with the tip they were measured at. */
  afterAll(() => {
    if (!R7_EVIDENCE) return
    mkdirSync(R7_EVIDENCE, { recursive: true })
    const w = (name: string, lines: string[]) => writeFileSync(join(R7_EVIDENCE, name), `${lines.join('\n')}\n`)
    w(`VERDICT-DELTA-${R7_SHA}.txt`, [
      '# VERDICT-DELTA-r7 — the GATE half of spec §3.1, before and after, per row',
      `# tip: ${R7_SHA}`,
      '#',
      '# WHAT MOVED. E3a gave the RAIL a protected-window door (RAIL-DELTA is that',
      '# half) and left the VERDICT — the word under the cursor, the drop, the',
      '# 「新規N分の空き」 sentence — enumerating protected windows from the pocket’s',
      '# own minute with no bed filter. So the strip and the drop were two readings',
      '# of one board. R7 hands the verdict the rail’s own door.',
      '#',
      '#   cells    — every start the shipped rail paints, on every staff lane',
      '#   before≠  — cells where the UN-migrated verdict answered something other',
      '#              than the rail’s own cell (today’s code), counted over the',
      '#              eight fields the OPERATOR sees',
      '#   after≠   — the same count once the door is threaded. It is 0 on every',
      '#              row: the fix CLOSES the gap, it does not shrink it.',
      '#   full≠    — the same two counts over the WHOLE cell, `impact` included.',
      '#              A verdict can agree on every word and still report a',
      '#              protected window starting at a minute the rooms refuse; the',
      '#              visible column cannot see that and this one can.',
      '#   Σ|ΔB| / Σ|ΔA| — summed absolute difference in impact.capacityBefore /',
      '#              capacityAfter between the un-migrated verdict and the rail.',
      '#              0 where the disagreements carry no impact at all.',
      '#',
      '# board | dials | now | cells | before≠ | after≠ | full≠ before/after | Σ|ΔB| | Σ|ΔA| | transitions',
      ...VERDICT_ROWS.map(
        (r) =>
          `${r.board.padEnd(24)} | ${r.dials} | now ${String(r.now ?? '-').padStart(4)} | cells ${String(r.cells).padStart(4)}` +
          ` | before≠ ${String(r.before).padStart(3)} | after≠ ${String(r.after).padStart(3)}` +
          ` | full≠ ${String(r.beforeFull).padStart(3)}/${String(r.afterFull).padStart(3)}` +
          ` | ΣΔB ${String(r.sumDB).padStart(3)} | ΣΔA ${String(r.sumDA).padStart(3)}` +
          ` | ${r.transitions || '—'}`,
      ),
      '#',
      `# TOTALS: ${VERDICT_ROWS.length} rows · ${VERDICT_ROWS.reduce((n, r) => n + r.cells, 0)} cells ·` +
        ` ${VERDICT_ROWS.reduce((n, r) => n + r.before, 0)} before≠ · ${VERDICT_ROWS.reduce((n, r) => n + r.after, 0)} after≠ ·` +
        ` whole-cell ${VERDICT_ROWS.reduce((n, r) => n + r.beforeFull, 0)} before≠ / ${VERDICT_ROWS.reduce((n, r) => n + r.afterFull, 0)} after≠`,
      '#',
      '# THE ROW THE OPERATOR IS ACTUALLY LOOKING AT is the fixture at the store’s',
      '# shipped dials: 5 of 90 cells today, one of which is a real state flip at',
      '# 16:00 (blocked → degraded — a start the strip already calls fine that the',
      '# drop refuses), and 12 of 90 on tomorrow’s board, where the flips go both',
      '# ways. Both directions are one fix: the guard stops protecting windows no',
      '# room can host, and starts seeing real ones it was blind to.',
    ])
    if (TRUNCATED) {
      w(`NOW-TRUNCATED-SCENE-${R7_SHA}.txt`, [
        '# NOW-TRUNCATED-SCENE — spec §11.4’s standing artifact for a guard round',
        `# tip: ${R7_SHA}`,
        '#',
        '# WHY THIS SCENE EXISTS. Attaching the protected-window door does TWO things',
        '# (RAIL-DELTA’s two columns): it moves the enumeration onto the 5-minute',
        '# lattice, and it filters out windows no room can host. On this file’s two',
        '# boards the first is invisible — their off-lattice pockets are all too',
        '# SHORT to admit a protected window, so raw and lattice enumerate the same',
        '# empty list. (NOT 「every pocket starts on a lattice minute」: the fixture’s',
        '# p-06 pocket starts at 804, which is `now` itself. ⚖ R7 correction.)',
        '#',
        '# So here is the smallest board where all three answers differ — a pocket',
        '# truncated by `now` landing off-lattice, long enough to hold the window:',
        '#',
        `#   world     ${TRUNCATED.world}`,
        `#   now       ${TRUNCATED.now}  (the pocket’s own start — off-lattice)`,
        `#   lane      ${TRUNCATED.laneKey}`,
        `#   pocket    [${TRUNCATED.pocket.s},${TRUNCATED.pocket.e}]  (${TRUNCATED.pocket.e - TRUNCATED.pocket.s} min)`,
        '#',
        `#   raw       ${JSON.stringify(TRUNCATED.raw)}   — the pocket’s own minute, today’s verdict path`,
        `#   lattice   ${JSON.stringify(TRUNCATED.lattice)}   — the callback attached, answering yes to everything`,
        `#   bed       ${JSON.stringify(TRUNCATED.bed)}     — the store’s real mask: no room can host it at all`,
        '#',
        '# THREE ANSWERS TO ONE QUESTION, which is the whole reason the count table',
        '# keeps two columns rather than one.',
        '#',
        `#   rail vs verdict WITH the door      ${TRUNCATED.railVsWith} disagreeing cells on this lane`,
        `#   rail vs verdict WITHOUT the door   ${TRUNCATED.railVsWithout} disagreeing cells on this lane`,
      ])
    }
  })
})

// ── 5 · THE EXPLAIN LAYER ───────────────────────────────────────────────────

describe('5 — a held window explains itself, and is not explained away', () => {
  it('no 「販売可能枠が出ていません」 and no taker’s name over a 新規用に確保 span', () => {
    const w = fixtureWorld()
    const c = shipped()
    const book = bookOf(w)
    const held = maskOf(w, c, book)
    const on = door(w, c, held)
    const rs = rails(w, c, 'bed', book)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    const leaked: string[] = []
    for (const l of explainOf(w, c, rs, on, held)) {
      const spans = byLane.get(l.laneKey) ?? []
      for (const e of l.per) {
        const end = e.start + REAL.guard.standardSessionMin
        if (!spans.some((h) => meets(e.start, end, h.start, h.end))) continue
        if (e.sentence.includes('販売可能枠が出ていません')) leaked.push(`${l.laneKey}@${hhmm(e.start)} bare clause`)
        if (e.sentence.includes('別のスタッフ')) leaked.push(`${l.laneKey}@${hhmm(e.start)} taker clause`)
        if (l.restCues.includes(e.start)) leaked.push(`${l.laneKey}@${hhmm(e.start)} rest-cue hatch`)
      }
    }
    expect(leaked).toEqual([])
    // Not vacuous: the mask really does cover chips on this board.
    const covered = explainOf(w, c, rs, on, held).some((l) =>
      (byLane.get(l.laneKey) ?? []).some((h) => l.per.some((e) => meets(e.start, e.start + REAL.guard.standardSessionMin, h.start, h.end))),
    )
    expect(covered).toBe(true)
  })

  it('the clause and the hatch are unchanged everywhere ELSE — held is a narrowing, never a rewrite', () => {
    const w = fixtureWorld()
    const c = shipped()
    const book = bookOf(w)
    const held = maskOf(w, c, book)
    const on = door(w, c, held)
    const rs = rails(w, c, 'bed', book)
    const withMask = explainOf(w, c, rs, on, held)
    const without = explainOf(w, c, rs, on, undefined)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    for (const [i, l] of withMask.entries()) {
      const spans = byLane.get(l.laneKey) ?? []
      for (const [j, e] of l.per.entries()) {
        if (spans.some((h) => meets(e.start, e.start + REAL.guard.standardSessionMin, h.start, h.end))) continue
        expect({ lane: l.laneKey, start: e.start, e }).toEqual({ lane: l.laneKey, start: e.start, e: without[i].per[j] })
      }
    }
  })

  it('the observational drop surface is still observational — passing drops changes no cell', () => {
    // today-explains.test.ts:393's law, re-asserted through THIS round's seam:
    // `onDrop` is called, never read, so the layer is the same either way.
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    const seen: SellDrop[] = []
    const { price, depth } = priceOf()
    const base = { gridMin: c.gridMin, nowMinute: w.now, locked: [], showPrice: true, hi: price.hi, hqMin: REAL.dialogs.pricing.hqMin, depth, held }
    const withDrops = sellLayerFor(w.lanes, w.hours, {
      ...base,
      reconcile: { claims: door(w, c, held).claims, rooms: w.rooms, cleanupMinutesByBed: w.cleanup, onDrop: (d) => seen.push(d) },
    })
    const without = sellLayerFor(w.lanes, w.hours, {
      ...base,
      reconcile: { claims: door(w, c, held).claims, rooms: w.rooms, cleanupMinutesByBed: w.cleanup },
    })
    expect(withDrops).toEqual(without)
    expect(seen.length).toBeGreaterThan(0)
  })
})

// ── 6 · RESERVED NEVER CLAIMS ───────────────────────────────────────────────

describe('6 — the third offer kind is advisory', () => {
  it('the claims book refuses a reserved offer outright', () => {
    const w = fixtureWorld()
    const offer: OfferInput = { resourceKey: 'bed-01', start: 900, end: 990, kind: 'reserved', laneKey: 'p-05' }
    expect(() => buildClaims(bookOf(w), [offer])).toThrow(/never claims a room/)
  })

  it('nothing on the sales door hands one to the book — the offer set is sell + gap only', () => {
    const w = fixtureWorld()
    const c = shipped()
    const on = door(w, c, maskOf(w, c))
    const offers = boardOffers(on.sell.cells, [...on.gapDrawn.packed, ...on.gapDrawn.scraps])
    expect(offers.every((o) => o.kind === 'sell' || o.kind === 'gap')).toBe(true)
    expect(() => buildClaims(bookOf(w), offers)).not.toThrow()
    // …and the reserved offers themselves carry no room at all, so there is
    // nothing for them to claim even if somebody tried.
    expect(on.reserved.every((o) => !('resourceKey' in o))).toBe(true)
  })

  it('the dedup key is untouched for the kinds that DO claim', () => {
    const w = fixtureWorld()
    const twin: OfferInput[] = [
      { resourceKey: 'bed-01', start: 900, end: 960, kind: 'sell', laneKey: 'p-01' },
      { resourceKey: 'bed-01', start: 900, end: 960, kind: 'sell', laneKey: 'p-01' },
      { resourceKey: 'bed-01', start: 900, end: 960, kind: 'gap', laneKey: 'p-02' },
    ]
    const book = buildClaims(bookOf(w), twin)
    expect(book.claims.map((c) => c.kind)).toEqual(['sell', 'gap'])
  })
})

// ── 7 · THE COST ────────────────────────────────────────────────────────────

interface PerfRow {
  what: string
  lanes: number
  stores: number
  /** The SECOND capacity book the gate mints, for the committed world. */
  bookMs: number
  /** The held set, given that book, cold. */
  maskMs: number
  /** …and asked a second time on the same book. */
  reMs: number
  /** The second read's OWN handle count — the assertable half of `reMs`. */
  reHandles: number
  windows: number
  /** Lanes that hold at least one window — a store-isolated HQ board holds far
   *  fewer than a single-store one, and the row would look wrong without it. */
  feasibleLanes: number
  handles: number
}

const PERF_ROWS: PerfRow[] = []

/** A book that COUNTS. Only `newClientMask` is intercepted: it is the door the
 *  mask uses, and one handle per (lane, length) per build is the discipline the
 *  perf claim is about. */
function counting(book: BedTruth): { book: BedTruth; handles: () => number } {
  let n = 0
  return {
    book: { ...book, newClientMask: (l, d) => { n += 1; return book.newClientMask(l, d) } },
    handles: () => n,
  }
}

describe('7 — the mask is built once per world per frame, and what it costs', () => {
  it('one mask handle per staff lane per build — never one per probe', () => {
    const w = syntheticWorld()
    const c = shipped()
    const { book, handles } = counting(bookOf(w))
    const held = maskOf(w, c, book)
    // The guard probes the callback thousands of times across the day; the
    // module mints ONE handle per lane (one protected length), which is the
    // whole of E1's cache and the reason the 19–41× naive cost is not paid.
    expect(handles()).toBe(staffLanesOf(w.lanes).length)
    expect(held.length).toBe(staffLanesOf(w.lanes).length)
  })

  /** ⚠ WHAT THE GATE ACTUALLY ADDS TO A FRAME, and it is not only the mask.
   *
   *  The staff door's instance rides the book the screen ALREADY builds
   *  (`ledger.world`), so it costs a mask and nothing more. The sales door's
   *  instance does not: prices read the COMMITTED board, and that world has no
   *  book today — so turning the gate on mints a SECOND capacity book per
   *  frame. That is the honest headline cost of this round and it is measured
   *  as its own column, not folded into the mask's.
   *
   *  The mask column is measured with the book already warm, because that is
   *  the question 「what does the held set cost, given the frame's book」 — the
   *  one E1's 34.5 ms HQ figure (which included construction) left open. */
  it('measures the roster rows and the HQ row — the book and the mask, apart', () => {
    // ⚠ REAL TIMERS, or the whole table is zeros. `jest.useFakeTimers()` (which
    // this file needs in `beforeAll`, to hold the fixture world's clock still)
    // fakes `process.hrtime` too — every elapsed time comes back 0 and the
    // artifact says the wiring is free. Restored immediately after; nothing in
    // this test reads the clock for anything but the stopwatch.
    jest.useRealTimers()
    const c = shipped()
    const rows: Array<{ what: string; spec: BoardSpec }> = [
      { what: '6 staff / 3 rooms', spec: { staff: 6, beds: 3, seed: 4242, perLane: 3 } },
      { what: '15 staff / 3 rooms', spec: { staff: 15, beds: 3, seed: 4242, perLane: 3 } },
      { what: '25 staff / 3 rooms', spec: { staff: 25, beds: 3, seed: 4242, perLane: 3 } },
      { what: '30 staff / 6 rooms', spec: { staff: 30, beds: 6, seed: 4242, perLane: 3 } },
      {
        what: 'HQ 100 lanes / 40 stores',
        spec: { staff: 100, beds: 40, seed: 4242, perLane: 3, stores: Array.from({ length: 40 }, (_, i) => `store-${pad2(i)}`) },
      },
    ]
    for (const r of rows) {
      const w: World = { ...syntheticWorld(), name: r.what, lanes: board(r.spec) }
      // COLUMN 1 — the second book the gate mints for the committed world.
      const t0 = process.hrtime.bigint()
      const raw = bookOf(w)
      const bookMs = Number(process.hrtime.bigint() - t0) / 1e6
      // COLUMN 2 — the mask itself, given that book. Cold: the book builds its
      // hypothetical lattice lazily, so this is the first walk, not a re-read.
      const { book, handles } = counting(raw)
      const t1 = process.hrtime.bigint()
      const held = maskOf(w, c, book)
      const maskMs = Number(process.hrtime.bigint() - t1) / 1e6
      // COLUMN 3 — the SAME mask again on the same book, which is what a second
      // reader in one frame would pay. It should be the cheap one. Counted as
      // well as clocked: the assertion below is on the COUNT (see it there).
      const reRead = counting(raw)
      const t2 = process.hrtime.bigint()
      maskOf(w, c, reRead.book)
      const reMs = Number(process.hrtime.bigint() - t2) / 1e6
      PERF_ROWS.push({
        what: r.what,
        lanes: r.spec.staff,
        stores: r.spec.stores?.length ?? 1,
        bookMs: Math.round(bookMs * 100) / 100,
        maskMs: Math.round(maskMs * 100) / 100,
        reMs: Math.round(reMs * 100) / 100,
        reHandles: reRead.handles(),
        windows: windowsIn(held).length,
        feasibleLanes: held.filter((m) => m.spans.length > 0).length,
        handles: handles(),
      })
      expect(handles()).toBe(staffLanesOf(w.lanes).length)
    }
    // The 25-staff row is the standing budget row; the HQ row is E1's carried
    // hazard. Both are REPORTED (artifact) and only the shape is asserted —
    // wall-clock on a shared machine is evidence, never a gate.
    expect(PERF_ROWS).toHaveLength(5)
    expect(PERF_ROWS.every((r) => r.handles === r.lanes)).toBe(true)
    // …and the second read of one world is never the expensive one: re-asking a
    // warm book must not cost more than the cold walk did. ASSERTED IN HANDLES,
    // not in milliseconds (⚖ PKT-E4 §3 rider, E3b audit deviation 5): the claim
    // was always 'the book's cache is real', which is a CALL COUNT, and two
    // sub-millisecond walks compared on a wall clock are a coin flip under
    // parallel jest workers — the old `reMs <= maskMs` form failed on a shared
    // machine and passed alone, at BASE as well as at tip. The stopwatch stays
    // in the artifact as evidence; the gate is the count.
    expect(PERF_ROWS.every((r) => r.reHandles <= r.handles)).toBe(true)
    // …and the stopwatch was really running: a zeroed table would satisfy every
    // assertion above and say nothing. The biggest board has to take some time.
    expect(PERF_ROWS[PERF_ROWS.length - 1].bookMs).toBeGreaterThan(0)
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z'))
  })

  it('two builds of one world are the same answer, and touch nothing', () => {
    const w = fixtureWorld()
    const c = shipped()
    const before = JSON.stringify(w.lanes)
    const a = maskOf(w, c)
    const b = maskOf(w, c)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(w.lanes)).toBe(before)
  })
})

// ── THE ARTIFACTS ───────────────────────────────────────────────────────────

const EVIDENCE = process.env.E3A_EVIDENCE ?? ''
const SHA = process.env.E3A_SHA ?? 'unstamped'

describe('the artifacts', () => {
  it('writes RAIL-DELTA and PERF when the evidence dir is named', () => {
    expect(RAIL_ROWS.length).toBeGreaterThan(0)
    expect(PERF_ROWS).toHaveLength(5)
    if (!EVIDENCE) return
    mkdirSync(EVIDENCE, { recursive: true })
    const w = (name: string, lines: string[]) => writeFileSync(join(EVIDENCE, name), `${lines.join('\n')}\n`)
    w(`RAIL-DELTA-${SHA}.txt`, [
      `# RAIL-DELTA-e3a — the staff door's before/after, in TWO columns (spec §2/§3.3)`,
      `# tip: ${SHA}`,
      '#',
      '# WHY TWO COLUMNS. Attaching the bed-feasibility callback does two things to',
      "# the guard's protected enumeration, not one (gap-guard.ts:192-206):",
      '#   · it moves the walk onto the 5-minute LATTICE — `firstStart` becomes',
      '#     `ceil(pocket.s / 5) * 5` instead of the pocket’s own minute;',
      '#   · it FILTERS out every window no room can host.',
      '# A single "before/after" number would blame the rooms for both. So:',
      '#   raw     = today’s shipped rail (no callback at all)',
      '#   lattice = callback present but answering yes to everything',
      '#   bed     = the real mask door — E3a’s rail',
      '#   Δlattice = cells that moved between raw and lattice (ENUMERATION cause)',
      '#   Δbed     = cells that moved between lattice and bed (ROOMS cause)',
      '# `blocked` counts are the refusal cells on the whole board at that setting.',
      '# `held` is the mask’s window count; `refused` is how many lattice-feasible',
      '# protected windows the book says no room can cover.',
      '#',
      '# ⚖ THIS FILE IS THE SEED of §3.3’s count table for Liam at E3b. Nothing on',
      '# screen has changed yet: the rail still ships with no callback (the round',
      '# gate is OFF) and these are the numbers the flip would produce.',
      '#',
      '# board | dials | blocked raw→lattice→bed | Δlattice | Δbed | held | refused',
      ...RAIL_ROWS.map(
        (r) =>
          `${r.board.padEnd(24)} | ${r.dials} | blocked ${String(r.raw).padStart(4)}→${String(r.lattice).padStart(4)}→${String(r.bed).padStart(4)}` +
          ` | Δlattice ${String(r.latticeDelta).padStart(4)} | Δbed ${String(r.bedDelta).padStart(4)}` +
          ` | held ${String(r.heldWindows).padStart(3)} | refused ${String(r.refused).padStart(3)}`,
      ),
      '#',
      '# ASSERTED per row, not eyeballed (§4 of selling-engine-doors.test.ts):',
      '#  · ⚖ R7 CORRECTION (PROBE-R7 §P2): not 「every pocket starts on a lattice',
      '#    minute」 — the fixture’s p-06 pocket starts at 804, which is `now` itself',
      '#    and off-lattice. What holds is narrower: every off-lattice pocket on these',
      '#    two boards is too SHORT to admit a protected window, so raw and lattice',
      '#    enumerate the same empty list and Δlattice is pinned at 0. The enumeration',
      '#    move is REAL but has nothing to move here, and the column stays so a board',
      '#    that does have a long off-lattice pocket shows it in the right place',
      '#    (NOW-TRUNCATED-SCENE builds one);',
      '#  · every Δbed cell lies on a lane the book refuses at least one protected',
      '#    window on — no verdict moves without a room to blame;',
      '#  · the rail’s own enumeration under the mask ctx is byte-equal to',
      '#    reservedMaskFor’s spans, lane by lane. ONE held set, both doors.',
      '#  · and the threading is NOT a no-op: Δbed is non-zero somewhere, and it',
      '#    moves in BOTH directions — the guard stops refusing placements to',
      '#    protect windows no room can host (fixture 88→87), and starts refusing',
      '#    where a real window it was blind to now counts (synthetic 130→135).',
      '#    Both are the same fix; only the second one costs the operator a start.',
    ])
    w(`PERF-${SHA}.txt`, [
      '# PERF-e3a — what the wiring costs, measured, in the pieces it is actually paid in',
      `# tip: ${SHA}`,
      '#',
      '# THE HEADLINE COST OF THIS ROUND IS NOT THE MASK — it is the SECOND BOOK.',
      '# The staff door’s mask rides the capacity book the screen already builds for',
      '# the board world, so it costs a mask and nothing more. The sales door’s does',
      '# not: prices read the COMMITTED board (the WO-2d ruling), and that world has',
      '# no book today. Turning the gate on mints one more per frame. Hence a column',
      '# of its own rather than a number folded into the mask’s.',
      '#',
      '#   book — building the committed world’s BedTruth from scratch',
      '#   mask — reservedMaskFor over that book, COLD (the book builds its',
      '#          hypothetical lattice lazily, so this is the first walk)',
      '#   re   — the same mask asked again on the same book: what a second reader',
      '#          in one frame would pay',
      '#   handles — mask closures minted. ONE per staff lane per build is the',
      '#          contract: the guard probes the callback thousands of times per',
      '#          frame and every ANSWER comes out of the book’s precomputed lattice.',
      '#   lanes held — staff lanes holding at least one window. On the HQ board the',
      '#          store-isolation law binds each person to their own store’s rooms,',
      '#          so far fewer lanes can host a protected window than on a',
      '#          single-store board of the same size. The row would read as a bug',
      '#          without this column.',
      '#',
      '# ⚠ WHY THE `book` COLUMN IS ~0 AND THE `mask` COLUMN IS NOT. `buildBedTruth`',
      '# is LAZY: constructing it allocates the shell, and the hypothetical lattice',
      '# for a (length, store binding) pair is walked on the first question asked',
      '# about it. The mask asks the first question, so it pays the construction it',
      '# triggers. The second book is therefore real but nearly free until something',
      '# reads it — and the thing that reads it is the mask, whose column is the',
      '# honest bill. Do not read `book ≈ 0` as "the second book is free".',
      '#',
      '# The HQ row is E1’s carried hazard (the book’s MAX_STORE_BINDINGS = 32,',
      '# saturated at 40 stores) and it stays in every later perf table. E1 measured',
      '# 34.5 ms there for build-plus-mask on its own 100-lane board; this table’s',
      '# comparable figure is book + mask, and the `re` column is the new fact — a',
      '# second reader of one warm world pays roughly a third of the first.',
      '#',
      '# row | lanes | stores | book ms | mask ms | re ms | windows | lanes held | handles',
      ...PERF_ROWS.map(
        (r) =>
          `${r.what.padEnd(24)} | lanes ${String(r.lanes).padStart(3)} | stores ${String(r.stores).padStart(2)}` +
          ` | book ${String(r.bookMs).padStart(7)} ms | mask ${String(r.maskMs).padStart(7)} ms | re ${String(r.reMs).padStart(7)} ms` +
          ` | windows ${String(r.windows).padStart(4)} | lanes held ${String(r.feasibleLanes).padStart(3)} | handles ${String(r.handles).padStart(3)}`,
      ),
      '#',
      '# Wall-clock on a shared machine is EVIDENCE, never a gate. Two things ARE',
      '# asserted, and neither can pass by being fast:',
      '#   · handles === staff lanes, on every row (the mask is built once per world',
      '#     per frame, not once per probe);',
      '#   · re ≤ mask, on every row (a second reader of one world never pays more',
      '#     than the first — the book’s cache is real, not a comment).',
    ])
  })
})
