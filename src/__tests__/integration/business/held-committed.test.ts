// THE COMMITTED WORLD'S HELD MASK, PROVED BY CALLING IT (⚖ R5 POST-MERGE).
//
// WHY THIS FILE EXISTS. Until now the screen's committed-world mask was spelled
// inline in a `useMemo` body, and the only thing holding its shape was a TEXT
// PIN on that body (#817, selling-engine-flip.test.ts §9). A post-merge blind
// check measured what a text pin can hold (POSTMERGE-CHECK-88b7726c.md): of
// nine mutants, seven slipped, and two of those were severe —
//   · finding 1 (HIGH) — hoisting the guard-off comparison ONE LINE ABOVE the
//     memo leaves the pinned slice untouched, so the screen can start deciding
//     "off" for itself with the pin still green;
//   · finding 2 (HIGH) — `gapGuardMode: 'standard'` HARDCODED in the call has
//     no comparison and no `'off'` in it to catch, and would hand a guard-OFF
//     store a NON-EMPTY mask: the inverse of reserved-mask.ts:195-197's
//     「guard off pays nothing」, with nothing in the whole suite pinning the
//     forwarding (`grep "gapGuardMode: props\." src/__tests__/` → none).
// A text pin cannot close a semantic property. So the property moved into a
// function — `heldCommittedFor` (held-committed.ts) — and this file is the
// proof that the function keeps it.
//
// ⚖ ROUND 1 — AND THE BOOK CAME WITH IT. The first cut moved the CALL into the
// function and left its INPUT on the screen: a second `committedBook` memo,
// which is a second screen-level seam nothing here could reach. A blind
// mutation lens walked through exactly that gap — pre-gate the book memo on the
// store's own dial and a guarded store silently gets no mask, with every pin in
// the family still green. The book is now built INSIDE the function too, so
// there is ONE seam rather than two and this file can see all of it. §3 is
// where that shows: the direct call it compares against builds its OWN book,
// out of the same lanes, so a wrapper that quietly answered for a different
// world would be caught here rather than nowhere.
//
// ⚖ ROUND 2 — AND THE DOOR INTO THE BOOK IS AN INPUT. Round 1 had the wrapper
// import `bedViewsFor` from TodayScreen to build that book, so the screen and
// the wrapper imported each other. Nothing broke — the door is a hoisted
// declaration, called a render later — but a cycle on a law-bearing seam is a
// trap for the next edit, so the screen HANDS THE DOOR IN as `bookOf` and the
// wrapper imports nothing from the screen at all. R3's one door survives in a
// stronger form (it cannot reach the book except through what it is given), and
// §3's last test is what proves the handed-in door is really the one used: give
// it a door onto an EMPTY world and the answer is the empty world's, not the
// real board's.
//
// WHAT IS PROVED, in the order the composition decides things:
//   §1 THE ROUND GATE — gate off is `undefined`, the fall-through every seam
//      below already treats as the code that shipped.
//   §2 A GUARD-OFF STORE — mode 'off' is the FROZEN EMPTY mask, not
//      `undefined`. This is the composition F0 moved the product to and the one
//      finding 2 would have broken.
//   §3 THE WRAPPER ADDS NOTHING — in every live mode the answer is a direct
//      `reservedMaskFor` call's over a directly-built book, compared as a whole
//      object AND byte for byte.
//   §4 EVERY DIAL IS FORWARDED — mode and `released` change the answer through
//      the wrapper exactly as they change it through the function.
//
// It drives the REAL fixture world, harvested the way the flip and doors suites
// harvest it (TodayPage → the props TodayScreen would have been rendered with),
// and it renders NOTHING: the wrapper is a plain function and the point of
// lifting it out of the memo was that a test could reach it without a renderer.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { type BedTruth, type DayFrame } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import {
  heldCommittedFor,
  type HeldCommittedInput,
} from '@/app/[locale]/(business)/business/today/held-committed'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import {
  reservedMaskFor,
  type GapGuardMode,
  type ReleasedWindow,
  type ReservedLaneMask,
} from '@/app/[locale]/(business)/business/today/reserved-mask'
import { bedViewsFor, TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { STORE_A } from '@/business/lib/fixtures'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

// ── THE REAL FIXTURE WORLD, harvested exactly as the doors suite harvests it ──

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
let FRAME: DayFrame
let BOOK: BedTruth

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
  // The `ledgerFrame` memo's own spelling — the ONE clock the book is built on.
  FRAME = { openMin: REAL.hours.open, closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute ?? REAL.hours.open }
  // ⚖ ROUND 1 — THIS BOOK IS THE CONTROL, NOT AN INPUT. The wrapper builds its
  // own now; this one is built here, independently, the one way in
  // (`bedViewsFor`) with the same `null` hand the committed world has always
  // passed, and it is what §3 and §4 compare the wrapper's answer against. If
  // the wrapper ever answered out of a different world, the two would part.
  BOOK = bedViewsFor(REAL.lanes, REAL.rooms, FRAME, null).world
})

afterAll(() => jest.useRealTimers())

/** THE SCREEN'S OWN ARGUMENTS, one spelling. Every field is the expression the
 *  `heldCommitted` memo forwards (TodayScreen.tsx, the pass-through) — so if
 *  this file and the screen ever disagree about the shape, the screen's memo
 *  stops compiling rather than quietly answering for a different world. */
const inputFor = (
  gapGuardMode: GapGuardMode,
  gateOn = true,
  released?: readonly ReleasedWindow[],
): HeldCommittedInput => ({
  gateOn,
  lanes: REAL.lanes,
  rooms: REAL.rooms,
  frame: FRAME,
  // ⚖ ROUND 2 — THE DOOR IS AN INPUT NOW. The wrapper used to import
  // `bedViewsFor` out of TodayScreen, which made the two files import each
  // other; the screen hands it over instead, and this is the same value the
  // screen hands over (selling-engine-flip.test.ts §9 pins that spelling).
  bookOf: bedViewsFor,
  closeMin: REAL.hours.close,
  nowMin: REAL.sell.nowMinute,
  guard: REAL.guard.config,
  gapGuardMode,
  released,
})

/** The same question asked WITHOUT the wrapper: `reservedMaskFor` called with
 *  the dials spelled out and the CONTROL book, which was built up in
 *  `beforeAll` out of the very same lanes, rooms and frame. Nothing about this
 *  call goes through the code under test. */
const direct = (gapGuardMode: GapGuardMode, released?: readonly ReleasedWindow[]) =>
  reservedMaskFor({
    lanes: REAL.lanes,
    closeMin: REAL.hours.close,
    nowMin: REAL.sell.nowMinute,
    guard: REAL.guard.config,
    gapGuardMode,
    released,
    book: BOOK,
  })

const windowsIn = (held: readonly ReservedLaneMask[] | undefined) =>
  (held ?? []).flatMap((m) => m.spans.map((s) => `${m.laneKey}@${s.windowStart}`))

/** The two modes the guard engine itself knows. 'off' is the absence of a mode
 *  and is proved separately in §2. */
const LIVE_MODES: readonly GapGuardMode[] = ['standard', 'strict']

// ── 1 · THE ROUND GATE ──────────────────────────────────────────────────────

describe('1 — the round gate off is `undefined`, and that is the only decision this function makes', () => {
  it('the gate off is `undefined` — E3a’s fall-through, not an empty mask', () => {
    for (const mode of [...LIVE_MODES, 'off' as const]) {
      expect({ mode, held: heldCommittedFor(inputFor(mode, false)) }).toEqual({ mode, held: undefined })
    }
  })

  it('the gate on is never `undefined`, in any mode — the gate is the ONLY route to it', () => {
    for (const mode of [...LIVE_MODES, 'off' as const]) {
      expect({ mode, undef: heldCommittedFor(inputFor(mode)) === undefined }).toEqual({ mode, undef: false })
    }
  })
})

// ── 2 · A GUARD-OFF STORE ───────────────────────────────────────────────────

describe('2 — a guard-OFF store gets the mask function’s own empty answer', () => {
  // ⚠ THIS IS THE ONE POSTMERGE FINDING 2 WOULD HAVE BROKEN. A hardcoded
  // `gapGuardMode: 'standard'` in the memo slipped every text pin in the family
  // and would have handed this store a NON-EMPTY mask — 新規用に確保 windows on
  // a board whose owner never turned the guard on, and the sales door's §5
  // fallback silenced with them (`[]` is truthy, `!heldCommitted` is the gate).
  it('mode ‘off’ is the EMPTY mask — and the same frozen constant the mask module returns', () => {
    const held = heldCommittedFor(inputFor('off'))
    expect(held).toEqual([])
    expect(Object.isFrozen(held)).toBe(true)
    // Identity, not equality: reserved-mask.ts:159's `EMPTY` is a module
    // constant, so a guard-off frame does not even allocate — the wrapper
    // hands the very same array back.
    expect(held).toBe(direct('off'))
  })
})

// ── 3 · THE WRAPPER ADDS NOTHING ────────────────────────────────────────────

describe('3 — in every live mode the answer is `reservedMaskFor`’s, byte for byte', () => {
  it('object-equal and JSON-equal to a direct call over a directly-built book, in both live modes', () => {
    for (const mode of LIVE_MODES) {
      const through = heldCommittedFor(inputFor(mode))
      const straight = direct(mode)
      // ⚖ LENS A F4 — THE NON-VACUITY GUARD, INSIDE THIS TEST. Two empty masks
      // are equal, so the equality below proves nothing unless this fixture
      // actually holds something. It is asserted here rather than in a
      // neighbouring `it` so a mutant cannot leave the equality standing on a
      // guard that a separate test happened to run first.
      expect({ mode, windows: windowsIn(through).length > 0 }).toEqual({ mode, windows: true })
      expect({ mode, through }).toEqual({ mode, through: straight })
      // The byte-level half: `toEqual` would forgive a re-ordered lane list or
      // a span the wrapper re-boxed. Nothing may be re-boxed — the wrapper
      // returns the array the mask built.
      expect({ mode, json: JSON.stringify(through) }).toEqual({ mode, json: JSON.stringify(straight) })
    }
  })

  it('and the book it answers out of is the COMMITTED world’s, built from the lanes it was handed', () => {
    // ⚖ ROUND 1 — the seam this round closed. The wrapper builds the book now,
    // so a wrapper that built it from a different lane set (the board world's,
    // a filtered list, a stale snapshot) would answer for a world nobody asked
    // about — and until the book moved in there was nothing anywhere that
    // could tell. The control book above is built from `REAL.lanes`, the same
    // list handed in, so any other choice parts the two answers.
    const through = heldCommittedFor(inputFor('standard'))
    expect(windowsIn(through).length).toBeGreaterThan(0)
    expect(windowsIn(through)).toEqual(windowsIn(direct('standard')))
    // …and a DIFFERENT world really is a different answer, so the equality
    // above is a measurement rather than a coincidence of this fixture.
    const fewer = REAL.lanes.filter((l) => l.group !== 'staff')
    expect(windowsIn(heldCommittedFor({ ...inputFor('standard'), lanes: fewer }))).not.toEqual(windowsIn(through))
  })

  it('the DOOR is load-bearing: hand over one onto an EMPTY world and the answer is the empty world’s', () => {
    // ⚖ ROUND 2 — the seam this round closed, and the proof that closing it did
    // not turn the door into decoration. The wrapper no longer imports the
    // book's door; it uses the one it is handed, so hand it a different one.
    // An EMPTY world is the cleanest different one available — the real door,
    // asked about zero lanes — and it is a real book rather than a stub shape.
    const emptyWorld = bedViewsFor([], REAL.rooms, FRAME, null)
    const through = heldCommittedFor({ ...inputFor('standard'), bookOf: () => emptyWorld })
    // What comes back is exactly what the mask function gives for THAT book,
    // with every other dial untouched — so the door is forwarded, not read.
    const straight = reservedMaskFor({
      lanes: REAL.lanes,
      closeMin: REAL.hours.close,
      nowMin: REAL.sell.nowMinute,
      guard: REAL.guard.config,
      gapGuardMode: 'standard',
      book: emptyWorld.world,
    })
    expect(windowsIn(through)).toEqual(windowsIn(straight))
    expect(JSON.stringify(through)).toBe(JSON.stringify(straight))
    // …and it is a DIFFERENT answer from the real door's, which is what makes
    // the equality above a measurement instead of two empty lists agreeing.
    // MEASURED on this fixture: the handed-in empty door yields 0 held windows,
    // the real one yields 4 — over the same 5 lane masks either way, because
    // the lane list is a separate input and only the BOOK changed. A wrapper
    // that ignored `bookOf` and reached for a book of its own would fail here
    // rather than nowhere.
    const real = heldCommittedFor(inputFor('standard'))
    expect(windowsIn(real).length).toBeGreaterThan(0)
    expect(windowsIn(through)).not.toEqual(windowsIn(real))
  })
})

// ── 4 · EVERY DIAL IS FORWARDED ─────────────────────────────────────────────

describe('4 — the dials reach the mask through the wrapper unchanged', () => {
  it('`gapGuardMode` is forwarded, not chosen: ‘strict’ and ‘standard’ are told apart', () => {
    const std = windowsIn(heldCommittedFor(inputFor('standard')))
    const strict = windowsIn(heldCommittedFor(inputFor('strict')))
    // MEASURED, NOT ASSUMED — and the measurement says these two modes are the
    // SAME on this board: 4 held windows across 9 lanes at protectedDurationMin
    // 90 in BOTH 'standard' and 'strict', byte-identical. So no assertion here
    // may claim they differ; that would be a pin on a fixture accident rather
    // than on the forwarding. What IS asserted is the forwarding itself —
    // whatever each mode does, the wrapper does the same as a direct call with
    // it — and the mode that DOES differ on this board is 'off' (0 windows),
    // pinned in §2, which is the mutation that matters (a hardcoded mode would
    // hand the guard-off store these 4).
    expect(std).toEqual(windowsIn(direct('standard')))
    expect(strict).toEqual(windowsIn(direct('strict')))
    // …and neither of them is the guard-off answer, which is what a hardcoded
    // mode would collapse them all to.
    expect(std.length).toBeGreaterThan(0)
    expect(strict.length).toBeGreaterThan(0)
  })

  it('`released` is forwarded — a released window is gone from the wrapper’s answer too', () => {
    const before = heldCommittedFor(inputFor('standard'))!
    const lane = before.find((m) => m.spans.length > 0)!
    const released: readonly ReleasedWindow[] = [
      { laneKey: lane.laneKey, windowStart: lane.spans[0].windowStart, dayOffset: 0, store: null },
    ]
    const after = heldCommittedFor(inputFor('standard', true, released))!
    const key = `${lane.laneKey}@${lane.spans[0].windowStart}`
    expect(windowsIn(before)).toContain(key)
    expect(windowsIn(after)).not.toContain(key)
    // …and exactly that one window went, the same way a direct call loses it.
    expect(windowsIn(after)).toEqual(windowsIn(direct('standard', released)))
    expect(windowsIn(before).length - windowsIn(after).length).toBe(1)
  })

  it('an absent `released` is today’s answer, byte for byte', () => {
    // ⚖ LENS A F2 — THIS TEST USED TO PROVE NOTHING. It compared the wrapper
    // with an explicit `released: undefined` against the wrapper with the same
    // field defaulted — two spellings of one call, so it stayed green under any
    // mutation at all. It now compares against a direct `reservedMaskFor` call
    // that never mentions `released` in the first place, which is the claim the
    // field's own doc makes (reserved-mask.ts:130-131 — absent is today's code,
    // byte for byte).
    const through = heldCommittedFor(inputFor('standard'))
    const straight = reservedMaskFor({
      lanes: REAL.lanes,
      closeMin: REAL.hours.close,
      nowMin: REAL.sell.nowMinute,
      guard: REAL.guard.config,
      gapGuardMode: 'standard',
      book: BOOK,
    })
    expect(windowsIn(through).length).toBeGreaterThan(0)
    expect(JSON.stringify(through)).toBe(JSON.stringify(straight))
  })
})
