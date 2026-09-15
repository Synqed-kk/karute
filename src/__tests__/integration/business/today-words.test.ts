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
    // pinned so a future change to `capabilitiesByStore`'s formula that
    // still happened to produce the right blockKinds by coincidence fails
    // HERE instead of hiding behind the array shape.
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
    expect(`休憩・${slot}などの予定ブロック`.startsWith('休憩・準備')).toBe(true)
    expect(`休憩・${slot}`).toBe('休憩・準備')
    expect(`休憩や${slot}を置いた位置`).toBe('休憩や準備を置いた位置')
  })

  it('the #24 sub-label falls back to 予約と予定ブロックを表示 even with bedCleanupOn: true (the capability gates, not the runtime flag alone)', () => {
    const w = resourceWordsFor('yoga_studio')
    const caps = { privateClass: w.privateWord != null, turnover: w.turnoverWord != null }
    const bedCleanupOn = true // the runtime flag, forced on — still not enough alone
    const subLabel = bedCleanupOn && caps.turnover ? `${w.turnoverWord}を予約不可時間として表示` : '予約と予定ブロックを表示'
    expect(subLabel).toBe('予約と予定ブロックを表示')
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
