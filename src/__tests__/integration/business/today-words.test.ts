// ⚖ D-53 (n) — PKT-BUILD-N2A-BOARD-WORDS.md commit 3 item 7(a)/(c)/(d).
//
// The PRODUCER-level half of the N2A proof: everything reachable as a pure
// function or a plain prop, through the exact door `today-no-bed-store.test.ts`'s
// GYM suite already established (TodayPage → screenProps). The JSX-only half
// (the rendered DOM: the group header, the tab, the legend, the rail tour,
// the create-dialog, the hold popover) is proven separately, on the SAME tip,
// by the mounted harness at
// LIVEDRAG-2026-09-10/harness/new-window/n2a-words.harness.test.tsx — see
// its own header for the run command and BUILD-REPORT-N2A-<tip>.md for its
// results.
//
// (a) STORE_A byte-identity of the two PURE sites: `blockKinds` (page.tsx
//     #30) and the 予約種別 fact's 個室のみ・ prefix (page.tsx #29, apt-29).
// (c) the null-word gates, driven through the PRODUCER: a test-only mocked
//     `listStoreOptions` door returns yoga_studio for STORE_A's own id, and
//     the PRODUCTION `blockKinds` — never filtered or rebuilt in this file —
//     is asserted directly.
// (d) the viewAll chrome (C7): `chromeWords` is a pure, exported function,
//     tested directly (page.tsx's own `defaultStoreId` never returns null
//     under these fixtures — three stores, always at least one option — so
//     the viewAll branch is unreachable through the page door today; C7 is
//     provable only as a unit, which is exactly why R5/commit-3(d) rules it
//     that way) — plus a source-text pin that page.tsx actually CALLS the
//     tested helper, so a correct-but-unused helper cannot satisfy this leg.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
// ⚖ item 7(c) — the ONE seam this file re-types a store through: a jest.fn()
// wrapping the REAL `listStoreOptions`, so every other test in this file
// reads the real fixture rows unchanged.
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return { ...actual, listStoreOptions: jest.fn(actual.listStoreOptions) }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_A, STORE_B, stores } from '@/business/lib/fixtures'
import { chromeWords, resourceWordsFor, RESOURCE_WORDS, type ResourceWords } from '@/business/lib/resource-words'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import * as data from '@/business/lib/data'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

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

beforeAll(() => {
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
})

afterAll(() => jest.useRealTimers())
afterEach(() => jest.restoreAllMocks())

async function propsFor(store: string): Promise<TodayProps> {
  return screenProps(
    await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store }) }),
  )!
}

describe('N2A (a) — STORE_A byte-identity of the pure sites', () => {
  it('site #30 — blockKinds is byte-identical to 825f91bfa\'s literal (chiropractic turnoverWord 清掃)', async () => {
    const props = await propsFor(STORE_A)
    expect(props.dialogs.create.blockKinds).toEqual(['休憩', '準備', '記録', '清掃', 'ミーティング'])
  })

  it('site #29 — apt-29\'s 予約種別 fact carries 個室のみ・, from the booking\'s own store', async () => {
    const props = await propsFor(STORE_A)
    const fact = props.cases['apt-29']?.facts.find(([label]) => label === '予約種別')?.[1]
    expect(fact).toBeDefined()
    expect(fact).toContain('個室のみ・')
    // The tag's word is the resolved store's own privateWord (個室 — STORE_A
    // is chiropractic, byte-identical to `other`, C9) — never the generic
    // fallback on this fixture (a real private-class store answers itself).
    expect(fact).toContain('個室のみ・単発')
  })
})

describe('N2A (c) — the null-word gates, driven through the producer', () => {
  it('a yoga-typed STORE_A produces blockKinds with NO 清掃 and NO null (turnoverWord: null)', async () => {
    ;(data.listStoreOptions as jest.Mock).mockResolvedValueOnce(
      stores.map((s) => (s.id === STORE_A ? { ...s, business_type: 'yoga_studio' } : s)),
    )
    const props = await propsFor(STORE_A)
    // Never constructed or filtered here — this is the PRODUCTION array.
    expect(props.dialogs.create.blockKinds).toEqual(['休憩', '準備', '記録', 'ミーティング'])
    expect(props.dialogs.create.blockKinds).not.toContain('清掃')
    expect(props.dialogs.create.blockKinds.some((k) => k == null)) .toBe(false)
    // The capability the gate reads is really off (C6's type default) —
    // pinned so a future change to page.tsx's page-local `capabilitiesByStore`
    // map's formula (⚖ D-53 (z): not a TodayProps field — TodayScreen never
    // read it) that still happened to produce the right blockKinds by
    // coincidence fails HERE instead of hiding behind the array shape.
    expect(props.caps).toEqual({ privateClass: false, turnover: false })
    expect(props.words.turnoverWord).toBeNull()
    expect(props.words.privateWord).toBeNull()
  })

  it('the yoga row itself has privateWord: null (proves the #17 fallback is real, not coincidental)', () => {
    // ⚖ D-53 (n) — the impossible-state guard, pinned: a card tagged
    // requiresPrivateRoom on a store whose type has no private class can
    // only happen on this play-phase fixture through direct injection (N3/N4
    // build the upstream gate that makes it unreachable for real); #17's own
    // formula is `lw.privateWord ?? genericWords.privateWord`, so the
    // fallback is provable directly: the lane's row is null, the generic
    // row is not, and null ?? '個室' is '個室' — the SAME bytes 825f91bfa
    // shipped, for a reason the null row can no longer supply on its own.
    const yoga = resourceWordsFor('yoga_studio')
    const generic = resourceWordsFor('other')
    expect(yoga.privateWord).toBeNull()
    expect(generic.privateWord).toBe('個室')
    expect(yoga.privateWord ?? generic.privateWord).toBe('個室')
  })

  it('the caps.turnover-gated example pairs read 「休憩・準備」 / 「休憩や準備」 for a no-turnover type', () => {
    // ⚖ D-53 (n) R-N2-4 — the exact formula #19/#25/#28 use
    // (`caps.turnover ? w.turnoverWord! : '準備'`), proven against the real
    // yoga row: 準備 is an EXISTING block kind (page.tsx's own blockKinds,
    // proven above), never a new word.
    const w = resourceWordsFor('yoga_studio')
    const caps = { privateClass: w.privateWord != null, turnover: w.turnoverWord != null }
    const slot = caps.turnover ? w.turnoverWord! : '準備'
    expect(slot).toBe('準備')
    // ⚖ D-53 (x) N5 — the delta-verify found the three expects that used to
    // stand here (`` `休憩・${slot}` ``, its `startsWith` sibling, and the
    // や form) proved only JavaScript string concatenation against a value
    // this same test built — no mutant on TodayScreen.tsx could ever turn
    // one of them red. Replaced with SOURCE pins on the real gate
    // expression at its two actual sites (・ form: #19's hint at :8752; や
    // form: #25's popover advice at :9839). The DOM proof for #19/#24/#28
    // already lives in the harness's yoga scenario
    // (n2a-words.harness.test.tsx, 'N2A — a yoga-typed chrome store…').
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    const nakaguroCount = src.split("休憩・{caps.turnover ? w.turnoverWord! : '準備'}").length - 1
    const yaCount = src.split("休憩や${caps.turnover ? w.turnoverWord! : '準備'}").length - 1
    console.log('N2A-NAKAGURO-PIN', { count: nakaguroCount })
    console.log('N2A-YA-PIN', { count: yaCount })
    expect(nakaguroCount).toBeGreaterThanOrEqual(1)
    expect(yaCount).toBeGreaterThanOrEqual(1)
  })

  // ⚖ D-53 (n) L2's own finding, item 8 — the OLD body re-derived this
  // ternary locally and asserted its own copy, never touching TodayScreen's
  // real render (a tautology: it did not catch mutant w3, which loosened the
  // gate to `bedCleanupOn` alone). Replaced with a SOURCE pin on the exact
  // gate expression, plus the mounted DOM proof (bedCleanupOn forced true,
  // caps.turnover false) in the harness's yoga scenario (item 5(b)) —
  // n2a-words.harness.test.tsx, 'N2A — a yoga-typed chrome store…'.
  it('the #24 gate is source-present as `props.bedCleanupOn && caps.turnover` exactly once (catches w3; DOM proof in the harness)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    const count = src.split('props.bedCleanupOn && caps.turnover').length - 1
    console.log('N2A-24-PIN', { count })
    expect(count).toBe(1)
  })

  // ⚖ D-53 (n) item 5(a) — L1 MINOR-4: #28 had no source pin and no
  // no-turnover render anywhere in the repo (both mounted stores are
  // turnover-ON). The rendered no-turnover proof is item 5(b), the same
  // harness yoga scenario referenced above.
  it('#28\'s gate is source-present as `turnoverWord={caps.turnover ? w.turnoverWord! : \'準備\'}` exactly once', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    const count = src.split("turnoverWord={caps.turnover ? w.turnoverWord! : '準備'}").length - 1
    console.log('N2A-28-PIN', { count })
    expect(count).toBe(1)
  })

  // ⚖ D-53 (x) — the delta-verify's m5 (the `l.group === 'staff' &&` filter
  // reverted) left the whole battery and the harness green: the standing-hold
  // popover's own lane pick had no pin and no test anywhere. This pin is the
  // fix's proof, the same form as #24/#28 above (no `holdPopWords` legs exist
  // in this file to sit beside, so it lives here with the other source pins).
  it('the standing-hold lane resolves through a staff-group lane only, source-present exactly once', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    const count = src.split("boardLanes.find((l) => l.group === 'staff' && l.items.some((it) => it.caseId === props.hold!.bookingId))").length - 1
    console.log('N2A-HOLD-PIN', { count })
    expect(count).toBe(1)
  })
})

describe('N2A (d) — the viewAll chrome (C7), a pure leg on chromeWords', () => {
  const CHIRO = RESOURCE_WORDS.chiropractic
  const MASSAGE = RESOURCE_WORDS.massage
  const GYM_ROW = RESOURCE_WORDS.personal_gym
  const GENERIC = RESOURCE_WORDS.other

  it('[] (no store options at all) returns the generic row', () => {
    expect(chromeWords([])).toEqual(GENERIC)
  })

  it('every row agreeing (chiropractic × massage, both byte-identical to other) returns that row', () => {
    expect(chromeWords([CHIRO, MASSAGE])).toEqual(CHIRO)
  })

  it('personal_gym × personal_gym agrees with itself', () => {
    expect(chromeWords([GYM_ROW, GYM_ROW])).toEqual(GYM_ROW)
  })

  it('disagreement with personal_gym FIRST, and every permutation, returns the generic row (w5 falsifier)', () => {
    const rows: ReadonlyArray<readonly ResourceWords[]> = [
      [GYM_ROW, CHIRO],
      [GYM_ROW, MASSAGE],
      [CHIRO, GYM_ROW],
      [MASSAGE, GYM_ROW],
      [GYM_ROW, CHIRO, MASSAGE],
      [CHIRO, GYM_ROW, MASSAGE],
      [CHIRO, MASSAGE, GYM_ROW],
    ]
    for (const permutation of rows) {
      expect(chromeWords(permutation)).toEqual(GENERIC)
    }
  })

  it('a single row (no disagreement possible) returns that row', () => {
    expect(chromeWords([GYM_ROW])).toEqual(GYM_ROW)
  })

  it('⚖ pin — page.tsx actually CALLS chromeWords (a correct-but-unused helper cannot satisfy C7)', () => {
    const page = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'),
      'utf8',
    )
    expect(page).toContain('const words: ResourceWords = clamped ? wordsByStore[storeId!] : chromeWords(storeOptions.map((s) => wordsByStore[s.id]))')
  })
})

describe('N2A — cross-check: STORE_B (massage) is also byte-identical (C9)', () => {
  it('STORE_B\'s blockKinds are the same literal as STORE_A\'s (massage === other)', async () => {
    const props = await propsFor(STORE_B)
    expect(props.dialogs.create.blockKinds).toEqual(['休憩', '準備', '記録', '清掃', 'ミーティング'])
  })
})

// ⚖ D-53 (u)/(ad)/(n2b2) — Commit 2b's own leg: the real bug on main, fixed.
// `c-05` (staff `p-05`) belongs to BOTH STORE_A and STORE_B
// (fixtures.ts:349), so `readStaffStores` hands its lane `stores: [STORE_A,
// STORE_B]` regardless of which store the operator is looking at
// (`staffStoreMap` ignores the lens entirely). Before the fix, a clamped
// `wordsByStore` carried every store's row, so `wordsForLane`'s
// `lane.stores?.[0]` picked STORE_A's row on STORE_B's own board. The
// mounted DOM proof (a rendered lane showing no ユニット anywhere) is the
// blind round's own item, on the harness at
// LIVEDRAG-2026-09-10/harness/new-window/ — this leg is the PRODUCER half,
// the same door every other leg in this file uses.
describe('N2b-2 Commit 2b — the shared-lane fix: a clamped board indexes only its own store', () => {
  it("STORE_B's page props, with STORE_A retyped dental: wordsByStore has exactly one key (STORE_B), and c-05's shared lane cannot read STORE_A's row", async () => {
    ;(data.listStoreOptions as jest.Mock).mockResolvedValueOnce(
      stores.map((s) => (s.id === STORE_A ? { ...s, business_type: 'dental_clinic' } : s)),
    )
    const props = await propsFor(STORE_B)
    // The map carries ONLY the selected store's row — the fix itself.
    expect(Object.keys(props.wordsByStore)).toEqual([STORE_B])
    expect(props.wordsByStore[STORE_A]).toBeUndefined()
    // The shared lane really does carry BOTH stores (the fixture fact the bug
    // depends on) — `stores[0]` is STORE_A, the retyped dental store.
    const sharedLane = props.lanes.find((l) => l.group === 'staff' && l.key === 'p-05')!
    expect(sharedLane.stores).toEqual([STORE_A, STORE_B])
    // `wordsForLane` (TodayScreen) falls to `props.words` for any store
    // affiliation the (now-narrowed) map has no row for — which is STORE_B's
    // own row (massage ≡ other, D-13), never the dental row (ユニット) STORE_A
    // now carries, even though the lane's first affiliation is STORE_A.
    expect(props.wordsByStore[STORE_B]).toEqual(props.words)
    expect(props.words.resourceNoun).toBe('ベッド')
    expect(props.words.resourceNoun).not.toBe('ユニット')
  })

  // viewAll is not reachable through this page door on this fixture set
  // (`defaultStoreId` always resolves to a real store — see this file's own
  // header, item (d)); the unclamped branch of `wordsByStore` (every store
  // option keeps its own row, unnarrowed) is exercised directly in
  // page.tsx's own logic and needs no separate leg here.
})
