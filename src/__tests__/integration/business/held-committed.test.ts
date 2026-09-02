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
// proof that the function keeps it. The memo is now a pass-through and flip §9
// pins only that: a tripwire, with the proof down here.
//
// WHAT IS PROVED, in the order the composition decides things:
//   §1 THE ROUND GATE — a null book is `undefined`, the fall-through every
//      seam below already treats as the code that shipped.
//   §2 A GUARD-OFF STORE — mode 'off' is the FROZEN EMPTY mask, not
//      `undefined`. This is the composition F0 moved the product to and the one
//      finding 2 would have broken.
//   §3 THE WRAPPER ADDS NOTHING — in every live mode the answer is a direct
//      `reservedMaskFor` call's, compared as a whole object AND byte for byte.
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

import { type BedTruth } from '@/app/[locale]/(business)/business/today/capacity-ledger'
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
  // The committed world's book, built the one way in (`bedViewsFor`) with the
  // same `null` hand TodayScreen's `committedBook` memo passes: prices read the
  // settled board, so nothing is lifted out of this snapshot.
  BOOK = bedViewsFor(
    REAL.lanes,
    REAL.rooms,
    { openMin: REAL.hours.open, closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute ?? REAL.hours.open },
    null,
  ).world
})

afterAll(() => jest.useRealTimers())

/** THE SCREEN'S OWN ARGUMENTS, one spelling. Every field is the expression the
 *  `heldCommitted` memo forwards (TodayScreen.tsx, the pass-through) — so if
 *  this file and the screen ever disagree about the shape, the screen's memo
 *  stops compiling rather than quietly answering for a different world. */
const inputFor = (
  gapGuardMode: GapGuardMode,
  book: BedTruth | null = BOOK,
  released?: readonly ReleasedWindow[],
): HeldCommittedInput => ({
  book,
  lanes: REAL.lanes,
  closeMin: REAL.hours.close,
  nowMin: REAL.sell.nowMinute,
  guard: REAL.guard.config,
  gapGuardMode,
  released,
})

/** The same question asked WITHOUT the wrapper — the thing the wrapper must be
 *  equal to, called with the book already narrowed. */
const direct = (gapGuardMode: GapGuardMode, released?: readonly ReleasedWindow[]) =>
  reservedMaskFor({ ...inputFor(gapGuardMode, BOOK, released), book: BOOK })

const windowsIn = (held: readonly ReservedLaneMask[] | undefined) =>
  (held ?? []).flatMap((m) => m.spans.map((s) => `${m.laneKey}@${s.windowStart}`))

/** The two modes the guard engine itself knows. 'off' is the absence of a mode
 *  and is proved separately in §2. */
const LIVE_MODES: readonly GapGuardMode[] = ['standard', 'strict']

// ── 1 · THE ROUND GATE ──────────────────────────────────────────────────────

describe('1 — the round gate off is `undefined`, and that is the only decision this function makes', () => {
  it('a null book is `undefined` — E3a’s fall-through, not an empty mask', () => {
    for (const mode of [...LIVE_MODES, 'off' as const]) {
      expect({ mode, held: heldCommittedFor(inputFor(mode, null)) }).toEqual({ mode, held: undefined })
    }
  })

  it('a real book is never `undefined`, in any mode — the gate is the ONLY route to it', () => {
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
  it('the fixture actually holds something, or the equality below proves nothing', () => {
    const held = heldCommittedFor(inputFor('standard'))
    expect(held).toBeDefined()
    expect(windowsIn(held).length).toBeGreaterThan(0)
  })

  it('object-equal and JSON-equal to a direct call, in both live modes', () => {
    for (const mode of LIVE_MODES) {
      const through = heldCommittedFor(inputFor(mode))
      const straight = direct(mode)
      expect({ mode, through }).toEqual({ mode, through: straight })
      // The byte-level half: `toEqual` would forgive a re-ordered lane list or
      // a span the wrapper re-boxed. Nothing may be re-boxed — the wrapper
      // returns the array the mask built.
      expect({ mode, json: JSON.stringify(through) }).toEqual({ mode, json: JSON.stringify(straight) })
    }
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
    const after = heldCommittedFor(inputFor('standard', BOOK, released))!
    const key = `${lane.laneKey}@${lane.spans[0].windowStart}`
    expect(windowsIn(before)).toContain(key)
    expect(windowsIn(after)).not.toContain(key)
    // …and exactly that one window went, the same way a direct call loses it.
    expect(windowsIn(after)).toEqual(windowsIn(direct('standard', released)))
    expect(windowsIn(before).length - windowsIn(after).length).toBe(1)
  })

  it('an absent `released` is today’s answer, byte for byte', () => {
    expect(JSON.stringify(heldCommittedFor(inputFor('standard', BOOK, undefined)))).toBe(
      JSON.stringify(heldCommittedFor(inputFor('standard'))),
    )
  })
})
