/**
 * コーチング (ROOM 8) — the room's own suite.
 *
 * THE ROOM'S ONE LOAD-BEARING CLAIM is that its visibility wall is STRUCTURAL:
 * a per-staff number cannot reach an owner's payload because there is no field
 * for it to travel in, and a colleague's row cannot reach a staff member's
 * payload because the self read is a LOOKUP BY ID rather than a filter. Both are
 * asserted here against the SERIALIZED props — the thing that actually crosses
 * to the client — rather than against the model that produced them.
 *
 * ⚠ EVERY MONTH- OR DATE-DEPENDENT ASSERTION RUNS ON A PINNED CLOCK. The 9/1
 * lesson, from room 6: the demo world is dated relative to today, so an
 * assertion taken on the real clock is a test that passes 28 days out of 31.
 * One hoisted `pinClock` / `unpinClock` pair, shared with the JST matrix at the
 * bottom, so the two cannot drift apart.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  BAND_LABEL,
  CATEGORY_TOKENS,
  FINDINGS_MIN_SESSIONS,
  FLOOR_DEFAULT,
  FLOOR_MAX,
  FLOOR_MIN,
  FOCUS_MIN_SESSIONS,
  HELP_REFUSAL,
  MATURITY_MIN_SESSIONS,
  MIN_HISTORY,
  accessFor,
  bandOf,
  buildSelfView,
  buildTriage,
  buildModuleLibrary,
  buildPatternLibrary,
  buildRoi,
  categoryLabel,
  confidenceFor,
  CONSENT_STATE,
  declineLabel,
  effectiveRole,
  focusAreaFrequency,
  horizonEffect,
  HORIZON_WEIGHTS,
  MODULE_BASIS,
  MONEY_LINE_CONFIDENCE,
  PATTERN_CATEGORIES,
  PATTERN_SHELF,
  PREVIEW_ROLES,
  shrink,
  SHRINK_K,
  helpActionFor,
  maturityNote,
  maturityOf,
  moduleOn,
  sampleFloor,
  sessionsOf,
  summaryLeaks,
} from '@/business/lib/coaching'
import { coachingConsent, coachingStaff, coachingStores, learningModules, patternLibrary, storeRoi, teamPatterns } from '@/business/lib/fixtures-coaching'
import { STORE_A, STORE_B, staff as worldStaff } from '@/business/lib/fixtures'
import { coachingProps } from '@/app/[locale]/(business)/business/coaching/coaching-props'
import type { CoachingSelf } from '@/app/[locale]/(business)/business/coaching/CoachingScreen'

const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
const ROOM_DIR = join(BIZ, 'business/coaching')
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const CSS_SRC = readFileSync(join(ROOM_DIR, 'coaching.css'), 'utf8')
const SCREEN_SRC = readFileSync(join(ROOM_DIR, 'CoachingScreen.tsx'), 'utf8')
const PROPS_SRC = readFileSync(join(ROOM_DIR, 'coaching-props.ts'), 'utf8')
const LIB_SRC = readFileSync(join(process.cwd(), 'src/business/lib/coaching.ts'), 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS_CODE = stripComments(CSS_SRC)
const SCREEN_CODE = stripComments(SCREEN_SRC).replace(/^\s*\/\/.*$/gm, '')
const LIB_CODE = stripComments(LIB_SRC).replace(/^\s*\/\/.*$/gm, '')

// ── the pinned clock, one mechanism for the whole file ──────────────────────
/** 12:00 JST on the 15th — mid-month on purpose, so no assertion in this file
 *  can be true because of which day the suite happened to run. */
const MID_MONTH = '2026-08-15T03:00:00Z'
const RealDate = Date
/** The room-6 mechanism, carried verbatim so the two rooms cannot drift apart. */
function pinClock(iso: string) {
  const fixed = new RealDate(iso)
  global.Date = class extends RealDate {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed.getTime())
      else super(...(args as [number]))
    }
    static now() { return fixed.getTime() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}
function unpinClock() { global.Date = RealDate }

const GINZA = { locale: 'ja', store: STORE_A }

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE VISIBILITY WALL — enforced ABOVE the serializer', () => {
  it('the owner’s payload carries BANDS and nothing a number could hide in', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    expect(props.team).not.toBeNull()
    // Every field on every row, enumerated: the shape IS the guarantee, so the
    // pin is on the shape rather than on a sample of values.
    for (const row of props.team!.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'action', 'band', 'bandLabel', 'bandTone', 'focusAreas', 'maturityNote', 'staffLabel', 'summaryWarning', 'trajectoryLine',
      ])
    }
  })

  it('NO staff member’s own number reaches the owner’s payload — planted and hunted', async () => {
    // ⚠ THE STRUCTURAL PROOF, not a spot check. Every number the fixture plane
    // holds for every staff member is planted with a value that could only have
    // come from this room's coaching data, and the SERIALIZED owner payload is
    // then scanned whole for any of them.
    //
    // ⚠ THE SESSION COUNT AND THE HISTORY ARE PLANTED AT THEIR REAL HOMES. The
    // first cut planted `sessions: 9100 + i` — a field `FixtureCoachingStaff`
    // no longer has, because the battery's own M16 finding collapsed it into
    // `findingsRun.sessions_reviewed`. So the plant was a dead property nothing
    // reads, and the one per-staff number the doctrine names FIRST — a session
    // count — was neither planted nor hunted, nor were the history values.
    // Both are now planted where the room really reads them, and the history is
    // kept THREE points long so every row still earns a band: a planted world
    // whose rows all fall below MIN_HISTORY would empty the board and pass this
    // scan for the wrong reason (⚖ HARNESS-TRUTH).
    const marked = coachingStaff.map((r, i) => ({
      ...r,
      findingsRun: { ...r.findingsRun, sessions_reviewed: 9200 + i },
      history: [0.9107, 0.9108, 0.9109],
      closingRate: 0.9101,
      rebookingRate: 0.9102,
      customerSatisfaction: 4.9103,
      avgRevenue: { amount: 910400 + i, currency: 'JPY' },
      outcomes: { ...r.outcomes, noDealTotal: 9105 + i, pendingCount: 9106 + i },
    }))
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { rows: marked } })
    unpinClock()
    const payload = JSON.stringify(props.team)
    const planted = ['910', '0.91', '4.91', '9101', '9105', '9106', '920', '9107', '9108', '9109']
    for (const needle of planted) {
      expect({ needle, inOwnerPayload: payload.includes(needle) }).toEqual({ needle, inOwnerPayload: false })
    }
    // …and the board really did render, WITH bands and with the per-staff
    // sentences on it — a payload with nothing in it would pass the scan above
    // for the wrong reason (⚖ HARNESS-TRUTH).
    expect(props.team!.rows.length).toBeGreaterThanOrEqual(4)
    expect(props.team!.rows.filter((r) => r.band !== null).length).toBeGreaterThanOrEqual(4)
    expect(props.team!.rows.some((r) => r.focusAreas.length > 0)).toBe(true)
  })

  it('a colleague’s data never enters the staff member’s own payload', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    expect(props.self.kind).toBe('ready')
    const mine = JSON.stringify(props.self)
    // Every OTHER staff member's headline finding, and every other row's decline
    // counts, hunted in the operator's own payload.
    for (const row of coachingStaff.filter((r) => r.staffId !== 'p-06')) {
      for (const f of row.findingsRun.findings) {
        expect({ staffId: row.staffId, leaked: mine.includes(f.headline) }).toEqual({ staffId: row.staffId, leaked: false })
      }
    }
    // …and no colleague's NAME either.
    for (const member of worldStaff.filter((s) => s.id !== 'p-06')) {
      expect({ name: member.full_name, leaked: mine.includes(member.full_name) }).toEqual({ name: member.full_name, leaked: false })
    }
  })

  it('the self read is a LOOKUP, not a filter — the source says so and the model proves it', () => {
    // A scope that filters can be un-filtered; a scope that never reads cannot.
    expect(LIB_CODE).toContain('rows.find((r) => r.staffId === selfId)')
    expect(LIB_CODE).not.toMatch(/rows\.filter\([^)]*staffId/)
    const built = buildSelfView({ selfId: 'p-06', rows: coachingStaff, patterns: teamPatterns })
    expect(built.kind).toBe('ready')
    if (built.kind !== 'ready') return
    expect(built.view.sessionsReviewed).toBe(34)
  })

  it('a reader without the roster capability is handed NO team payload at all', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { role: 'スタッフ', selfId: 'p-01' } })
    unpinClock()
    expect(props.canViewTeam).toBe(false)
    // Not hidden by a class — absent. There is nothing in the payload to reveal.
    expect(props.team).toBeNull()
    expect(props.teamBoundaryLine).toContain('自分のコーチング')
  })

  it('the capability table is FAIL-CLOSED on its own rows', () => {
    expect(accessFor('オーナー').viewTeam).toBe(true)
    expect(accessFor('店舗管理者').viewTeam).toBe(true)
    expect(accessFor('スタッフ').viewTeam).toBe(false)
    // A prototype-chain name must not resolve to a capability.
    expect(accessFor('constructor').viewTeam).toBe(false)
    expect(accessFor('__proto__').viewTeam).toBe(false)
    expect(accessFor('').viewTeam).toBe(false)
  })

  it('the LIB’s own triage row has EIGHT fields on EVERY row, and a number is not one of them', () => {
    // ⚠ THE PROPS FILE IS A SECOND WALL, NOT THE FIRST ONE. `coaching-props.ts`
    // maps each row field by field, so an extra number added to `TriageRow`
    // never reaches the payload — and the payload pin above therefore cannot
    // see it. That is a pin true for a second reason: the guarantee this room
    // claims is that the MODEL has no field for a number, so the model is where
    // it is measured. (Mutant M1 survived the whole battery until this existed.)
    //
    // ⚠ EVERY ROW OF A MIXED ROSTER, NOT ROW ZERO OF A ROSTER OF ONE. The first
    // cut read `Object.keys(view.rows[0])` on a roster holding only p-06, whose
    // band is not needs-support — so a number added CONDITIONALLY, on flagged
    // rows only, never appeared on the row that was measured and survived the
    // whole suite (and an object spread dodges TypeScript's excess-property
    // check, so the compile-time half was silent too). The roster below is the
    // one the ordering test uses: growing, steady, needs-support and a
    // below-the-floor hire, so every branch of the row builder is measured.
    const roster = [
      { id: 'p-04', name: '見本 しろう' },
      { id: 'p-09', name: '見本 みらい' },
      { id: 'p-01', name: '見本 はなこ' },
      { id: 'p-05', name: '見本 ごろう' },
    ]
    const view = buildTriage({ roster, rows: coachingStaff, floor: FLOOR_DEFAULT })
    expect(new Set(view.rows.map((r) => r.band)).size).toBeGreaterThanOrEqual(3)
    expect(view.rows.some((r) => r.needsSupport)).toBe(true)
    for (const row of view.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'band', 'focusAreas', 'maturity', 'needsSupport', 'staffLabel', 'status', 'suggestedAction', 'summaryChecks',
      ])
      for (const [k, v] of Object.entries(row)) {
        expect({ staff: row.staffLabel, field: k, isNumber: typeof v === 'number' }).toEqual({ staff: row.staffLabel, field: k, isNumber: false })
      }
    }
  })

  it('the board comes back in the ROSTER’s own order — never re-ordered by band', () => {
    // ⚠ BEHAVIOURAL, NOT A GREP. A source scan for `.sort(` is dodged by naming
    // the variable something else, which is exactly how mutant M2 survived: it
    // sorted `out`, and the scan was looking for `rows`/`roster`. What cannot be
    // dodged is the ORDER that comes back, so that is what is asserted — a
    // roster deliberately arranged so that any band ordering would move it.
    const roster = [
      { id: 'p-04', name: 'needs-support first' },
      { id: 'p-09', name: 'below the floor second' },
      { id: 'p-01', name: 'growing third' },
      { id: 'p-05', name: 'steady fourth' },
    ]
    const view = buildTriage({ roster, rows: coachingStaff, floor: FLOOR_DEFAULT })
    expect(view.rows.map((r) => r.staffLabel)).toEqual(roster.map((m) => m.name))
    // …and the bands really are mixed, or the order would be trivially stable.
    expect(new Set(view.rows.map((r) => r.band)).size).toBeGreaterThanOrEqual(3)
  })

  it('there is no ranking control, no sort key and no comparator anywhere in the room', () => {
    // ⚖ A TRIAGE BOARD, NEVER A LEADERBOARD. Not a copy rule — a code rule.
    for (const [name, code] of [['lib', LIB_CODE], ['screen', SCREEN_CODE], ['props', stripComments(PROPS_SRC)]] as const) {
      // ⚠ THE ONE DESCENDING COMPARATOR IN THE ROOM IS EXCLUDED BY NAME, NOT BY
      // LOOSENING THE PATTERN (the look-fix round). サポートエリア頻度 orders
      // CATEGORIES by how many staff need each — 「頻度順」 is the surface's own
      // job — and the two facts that keep it from being a leaderboard are pinned
      // right below rather than assumed: it takes `TriageRow[]` (bands, already
      // through the leak guard) and returns rows with no staff field at all, and
      // the BOARD's own row order is still the roster's.
      const withoutRanking = code.replace(/export function focusAreaFrequency[\s\S]*?\n\}/, '')
      expect({ name, sortsRoster: /rows\.sort|roster\.sort|\.sort\(\s*\(a, ?b\)\s*=>\s*b\./.test(withoutRanking) })
        .toEqual({ name, sortsRoster: false })
    }
    // …and the carve-out is proven, not trusted: the frequency rows carry a
    // category, a label and a count, and nothing a person could be identified
    // or measured by.
    const freq = focusAreaFrequency(
      buildTriage({ roster: [{ id: 'p-04', name: 'x' }, { id: 'p-01', name: 'y' }], rows: coachingStaff, floor: FLOOR_DEFAULT }).rows,
    )
    for (const row of freq) expect(Object.keys(row).sort()).toEqual(['category', 'count', 'label'])
    expect(/export function focusAreaFrequency\(rows: TriageRow\[\]\)/.test(LIB_CODE)).toBe(true)
    // The ONE sort in the room ranks a person's OWN findings by severity, which
    // is 「lead with what is costing you」 — never a comparison between people.
    // ⚠ THE ONE SORT IN THE ROOM IS THE RUN'S OWN RANK, not a re-ranking this
    // room applies: personal-findings.ts:140-144 ranks by (sessions touched) ×
    // (outcome gap) with any safety finding first, and re-sorting here would
    // silently overrule the single judgement this page exists to carry.
    expect(LIB_CODE).toContain('.sort((a, b) => a.rank - b.rank)')
    // ⚠ THE WORD IS NOT THE VIOLATION — the CONTROL is. The board's own tour
    // text says 「順位はつけません」 out loud, which is the page telling a
    // manager what it will not do; a pin that banned the word would have
    // deleted the sentence and kept the risk.
    expect(SCREEN_CODE).not.toMatch(/onClick=\{[^}]*[Ss]ort|aria-sort|順位で並/)
    expect(SCREEN_CODE).toContain('順位はつけません')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ ANTI-COERCION — a declined share is INDISTINGUISHABLE from an absent one', () => {
  const roster = [{ id: 'p-01', name: 'A' }, { id: 'p-04', name: 'B' }]
  const base = coachingStaff.filter((r) => r.staffId === 'p-01' || r.staffId === 'p-04')

  it('declined and never-asked produce BYTE-IDENTICAL rows', () => {
    const declined = base.map((r) => ({ ...r, grant: 'declined' as const }))
    const never = base.map((r) => ({ ...r, grant: 'none' as const }))
    const a = buildTriage({ roster, rows: declined, floor: FLOOR_DEFAULT })
    const b = buildTriage({ roster, rows: never, floor: FLOOR_DEFAULT })
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows))
    // …and the aggregate agrees they are the same fact.
    expect(a.sharingAdoption).toEqual(b.sharingAdoption)
    expect(a.sharingAdoption.granted).toBe(0)
  })

  it('a GRANT changes the aggregate and NOTHING on any row', () => {
    const none = buildTriage({ roster, rows: base.map((r) => ({ ...r, grant: 'none' as const })), floor: FLOOR_DEFAULT })
    const granted = buildTriage({ roster, rows: base.map((r) => ({ ...r, grant: 'granted' as const })), floor: FLOOR_DEFAULT })
    expect(JSON.stringify(granted.rows)).toBe(JSON.stringify(none.rows))
    expect(granted.sharingAdoption).toEqual({ granted: 2, total: 2 })
  })

  it('the grant is read in exactly TWO places — the aggregate, and the VIEWER’S OWN row', () => {
    // ⚠ TWO READS, AND EACH IS NAMED. The owner side is unchanged: one read,
    // into a count, never onto a row. The second read is the L1 side and it is
    // the viewer's OWN field, resolved through the same lookup-by-id the whole
    // self view is built from — COACHING_VISIBILITY_MODEL:21 lists 「own
    // grant/consent history」 as content the staff member is entitled to. A
    // third read, or a read that walks the roster, is what this pin catches.
    const reads = [...LIB_CODE.matchAll(/\.grant\b/g)].length
    expect({ reads }).toEqual({ reads: 2 })
    expect(LIB_CODE).toContain("byStaff.get(m.id)?.grant === 'granted'")
    expect(LIB_CODE).toContain('grant: mine.grant')
    // …and neither read filters or maps the roster for grants.
    expect(LIB_CODE).not.toMatch(/rows\.(filter|map|find)\([^)]*grant/)
  })

  it('the owner surface carries a COUNT and never a per-person sharing marker', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    expect(props.team!.adoptionLine).toMatch(/深い共有を許可しているスタッフ \d+名 \/ 在籍 \d+名/)
    expect(props.team!.adoptionNote).toContain('誰が許可していないかは表示しません')
    expect(JSON.stringify(props.team!.rows)).not.toMatch(/grant|shared|declin|共有/)
  })

  it('there is NO in-app request button — a manager can only ask a person', () => {
    // COACHING_VISIBILITY_MODEL §3: request ≠ grant, and no nag mechanic.
    expect(SCREEN_CODE).not.toMatch(/共有を依頼|リクエスト|お願いする/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE MODULE GATE — off means the data is never read', () => {
  it('a store with coaching off carries NO coaching data in its payload', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ locale: 'ja', store: STORE_B })
    unpinClock()
    expect(props.moduleOn).toBe(false)
    expect(props.team).toBeNull()
    expect(props.self.kind).toBe('none')
    // p-02 is a real row in the plane for this store; the gate is what keeps it
    // out, not a class on a div.
    const payload = JSON.stringify(props)
    expect(payload).not.toContain('見本 たろう')
    for (const f of coachingStaff.find((r) => r.staffId === 'p-02')!.findingsRun.findings) {
      expect(payload).not.toContain(f.headline)
    }
  })

  it('the dormant sentence names the real reason, never a fake wait', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ locale: 'ja', store: STORE_B })
    unpinClock()
    expect(props.dormantTitle).toBe('この店舗ではコーチングを使っていません')
    expect(props.dormantBody).toContain('テスト代官山店')
    expect(props.dormantBody).not.toMatch(/読み込み|しばらく|お待ち/)
  })

  it('the gate has no honest answer for a business-wide lens, and says no', () => {
    expect(moduleOn(STORE_A, coachingStores)).toBe(true)
    expect(moduleOn(STORE_B, coachingStores)).toBe(false)
    expect(moduleOn(null, coachingStores)).toBe(false)
  })

  it('the gate is asked BEFORE the plane is read — the source is the pin', () => {
    const code = stripComments(PROPS_SRC)
    expect(code).toContain('const rows = on ? (world?.rows ?? coachingStaff) : []')
    expect(code.indexOf('const on = moduleOn')).toBeLessThan(code.indexOf('const rows ='))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE SAMPLE-SIZE FLOOR — a new hire is never mislabelled', () => {
  it('below the floor there is NO band, whatever the history says', () => {
    expect(bandOf([0.1, 0.2, 0.9], FLOOR_DEFAULT - 1, FLOOR_DEFAULT)).toBeNull()
    expect(bandOf([0.1, 0.2, 0.9], FLOOR_DEFAULT, FLOOR_DEFAULT)).toBe('growing')
  })

  it('a band needs a trajectory, not a snapshot — two points is not a trend', () => {
    expect(MIN_HISTORY).toBe(3)
    expect(bandOf([0.2, 0.9], 100, FLOOR_DEFAULT)).toBeNull()
    expect(bandOf([0.2, 0.2, 0.9], 100, FLOOR_DEFAULT)).toBe('growing')
  })

  it('the dial is CLAMPED both ways — no store can turn a coin flip into a verdict', () => {
    expect(sampleFloor(undefined)).toBe(FLOOR_DEFAULT)
    expect(sampleFloor(Number.NaN)).toBe(FLOOR_DEFAULT)
    expect(sampleFloor(1)).toBe(FLOOR_MIN)
    expect(sampleFloor(5000)).toBe(FLOOR_MAX)
    expect(sampleFloor(31.4)).toBe(31)
    expect(FLOOR_MIN).toBeLessThan(FLOOR_DEFAULT)
    expect(FLOOR_DEFAULT).toBeLessThan(FLOOR_MAX)
  })

  it('the new hire’s OWN screen carries the RUN’s own status, not a state this room invented', () => {
    // ⚠ THE FLOOR STATE IS THE GENERATOR'S. personal-findings.ts:153 sets
    // `status: 'insufficient_data'` below SIX sessions and leaves findings
    // empty — so the room renders that status rather than a 「below the dial」
    // screen of its own. The dial (FLOOR_DEFAULT) gates the BAND on the owner's
    // board, which is a different artifact with a different bar.
    const mirai = coachingStaff.find((r) => r.staffId === 'p-09')!
    expect(sessionsOf(mirai)).toBeLessThan(FINDINGS_MIN_SESSIONS)
    expect(mirai.findingsRun.status).toBe('insufficient_data')
    expect(mirai.findingsRun.findings).toEqual([])
  })

  it('the new hire’s screen says the arithmetic instead of showing blanks', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { selfId: 'p-09' } })
    unpinClock()
    expect(props.self.kind).toBe('ready')
    if (props.self.kind !== 'ready') return
    expect(props.self.status).toBe('insufficient_data')
    expect(props.self.statusBody).toContain(`${FINDINGS_MIN_SESSIONS}回`)
    // …and the spine still renders, because the metrics are the door's facts
    // rather than the run's — a new hire sees their own five numbers on day one.
    expect(props.self.stats).toHaveLength(5)
  })

  it('a band-less row on the BOARD says so in words and carries no number', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const mirai = props.team!.rows.find((r) => r.staffLabel === '見本 みらい')!
    expect(mirai.band).toBeNull()
    expect(mirai.bandLabel).toBe('まだ判断できません')
    expect(mirai.trajectoryLine).not.toMatch(/\d/)
    expect(mirai.action).toBeNull()
  })

  it('a staff member with no coaching row at all gets the empty state, not a zero', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { selfId: 'p-99-nobody' } })
    unpinClock()
    expect(props.self.kind).toBe('none')
    if (props.self.kind !== 'none') return
    expect(props.self.statusBody).not.toMatch(/0回|0%/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE BAND IS AGAINST YOUR OWN BASELINE — a triage board, not a league', () => {
  it('two people can hold the same band from completely different numbers', () => {
    const low = bandOf([0.10, 0.11, 0.20], 40, FLOOR_DEFAULT)
    const high = bandOf([0.70, 0.71, 0.80], 40, FLOOR_DEFAULT)
    expect(low).toBe('growing')
    expect(high).toBe('growing')
  })

  it('a falling line is needs-support and a flat one is steady — 3pt either way', () => {
    expect(bandOf([0.50, 0.50, 0.50], 40, FLOOR_DEFAULT)).toBe('steady')
    expect(bandOf([0.50, 0.50, 0.529], 40, FLOOR_DEFAULT)).toBe('steady')
    expect(bandOf([0.50, 0.50, 0.53], 40, FLOOR_DEFAULT)).toBe('growing')
    expect(bandOf([0.50, 0.50, 0.47], 40, FLOOR_DEFAULT)).toBe('needs-support')
  })

  it('one good month cannot carry a falling line — the baseline is every prior period', () => {
    // Mean of 0.6/0.5/0.4 = 0.5; a 0.45 current period is still below it.
    expect(bandOf([0.6, 0.5, 0.4, 0.45], 40, FLOOR_DEFAULT)).toBe('needs-support')
  })

  it('the demo store reads growing / steady / needs-support / building — all four states', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const bands = props.team!.rows.map((r) => r.bandLabel)
    expect(bands).toContain(BAND_LABEL.growing)
    expect(bands).toContain(BAND_LABEL.steady)
    expect(bands).toContain(BAND_LABEL['needs-support'])
    expect(bands).toContain('まだ判断できません')
  })

  it('no band tone is red, and no tone is an alarm', () => {
    expect(CSS_CODE).toMatch(/\.cg-band-grow\s*\{[^}]*var\(--green-soft\)/)
    expect(CSS_CODE).toMatch(/\.cg-band-support\s*\{[^}]*var\(--cg-priority-soft\)/)
    // ⚖ 8/25 B family — not one red token anywhere in the sheet.
    expect(CSS_CODE).not.toMatch(/--red|#c74237|#8f3232|#fadfdd/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ EVERY needs-support FLAG IS PAIRED 1:1 WITH A HELP ACTION', () => {
  it('the pairing is the function’s return — a flag without an action is unbuildable', () => {
    // contract.ts:253 — the module the action targets is the FOCUS RUN's own
    // `module_id` (staff-focus.ts:173), never one this room picked.
    expect(helpActionFor('needs-support', 'mod-next-01')).toEqual({ kind: 'assign-module', label: '学習モジュールを割り当てる', moduleId: 'mod-next-01' })
    expect(helpActionFor('needs-support', null)).toEqual({ kind: 'manager-coaching', label: '1対1の時間をつくる', moduleId: null })
    expect(helpActionFor('growing', 'mod-next-01')).toBeNull()
    expect(helpActionFor('steady', 'mod-next-01')).toBeNull()
    expect(helpActionFor(null, 'mod-next-01')).toBeNull()
  })

  it('across the demo store, every flagged row carries one and no other row does', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    for (const row of props.team!.rows) {
      expect({ id: row.staffLabel, flagged: row.band === 'needs-support', hasAction: row.action !== null })
        .toEqual({ id: row.staffLabel, flagged: row.band === 'needs-support', hasAction: row.band === 'needs-support' })
    }
    expect(props.team!.rows.filter((r) => r.action).length).toBeGreaterThan(0)
  })

  it('the action is never punitive, and the board says what it is FOR', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    expect(props.team!.framingLine).toContain('評価のためではなく')
    for (const row of props.team!.rows) {
      if (!row.action) continue
      expect(row.action.label).not.toMatch(/警告|注意|指導|評価|減点/)
    }
  })

  it('the screen reads the row’s support state from the ACTION, never a second boolean', () => {
    expect(SCREEN_CODE).toContain("cg-row${r.action ? ' is-support' : ''}")
    expect(SCREEN_CODE).not.toMatch(/r\.needsSupport/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE 26-TYPE TOKEN LAW — labels resolve, judgements never hardcode', () => {
  it('a known key resolves through the table', () => {
    expect(categoryLabel('questioning_depth')).toBe('質問の深さ')
    expect(categoryLabel('next_step')).toBe('クロージング')
  })

  it('an UNKNOWN key renders its key — never a Japanese word this room invented', () => {
    expect(categoryLabel('mobility-range')).toBe('mobility-range')
    expect(categoryLabel('constructor')).toBe('constructor')
    expect(categoryLabel('__proto__')).toBe('__proto__')
  })

  it('the decline reasons are the phone’s own words, and an unknown one passes through', () => {
    expect(declineLabel('budget')).toBe('予算')
    expect(declineLabel('follow_up')).toBe('後日連絡予定')
    expect(declineLabel('brand_new_reason')).toBe('brand_new_reason')
  })

  it('nothing in the room branches on a business type', () => {
    for (const [name, code] of [['lib', LIB_CODE], ['screen', SCREEN_CODE], ['props', stripComments(PROPS_SRC)]] as const) {
      expect({ name, branches: /business_?[Tt]ype|businessType|整体|美容室|歯科|ジム/.test(code) }).toEqual({ name, branches: false })
    }
  })

  it('the room reaches into the phone’s coaching runtime NOWHERE', () => {
    for (const [name, code] of [['lib', LIB_SRC], ['screen', SCREEN_SRC], ['props', PROPS_SRC]] as const) {
      expect({ name, imports: /from '@\/lib\/karute/.test(code) }).toEqual({ name, imports: false })
    }
    // …and the mirror is CITED, so a reader can check the shape against its source.
    expect(LIB_SRC).toContain('contract.ts')
    expect(LIB_SRC).toContain('COACHING_VISIBILITY_MODEL')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ STORE ISOLATION — both directions, and nothing left behind', () => {
  it('the 銀座 payload contains no 代官山 person, and vice versa', async () => {
    pinClock(MID_MONTH)
    const ginza = await coachingProps(GINZA)
    const daikan = await coachingProps({ locale: 'ja', store: STORE_B, world: { enabledStores: [STORE_A, STORE_B] } })
    unpinClock()
    // p-02 works only in 代官山; p-06 only in 銀座.
    expect(JSON.stringify(ginza.props)).not.toContain('見本 たろう')
    expect(JSON.stringify(daikan.props)).not.toContain('見本 あずさ')
    expect(daikan.props.team!.rows.map((r) => r.staffLabel)).toContain('見本 たろう')
  })

  it('an unknown ?store= opens on the operator’s own store, never a business-wide merge', async () => {
    pinClock(MID_MONTH)
    const { props, storeKey } = await coachingProps({ locale: 'ja', store: 'store-does-not-exist' })
    unpinClock()
    expect(storeKey).toBe(STORE_A)
    expect(props.lensLabel).toBe('テスト銀座店')
  })

  it('the page KEYS the screen by the resolved lens, so no view state survives a switch', () => {
    const pageSrc = readFileSync(join(ROOM_DIR, 'page.tsx'), 'utf8')
    expect(pageSrc).toContain('<CoachingScreen key={storeKey} {...props} />')
  })

  it('leaves nothing behind — the two lenses share no coaching row', async () => {
    pinClock(MID_MONTH)
    const ginza = await coachingProps(GINZA)
    const daikan = await coachingProps({ locale: 'ja', store: STORE_B, world: { enabledStores: [STORE_A, STORE_B] } })
    unpinClock()
    const a = new Set(ginza.props.team!.rows.map((r) => r.staffLabel))
    const b = daikan.props.team!.rows.map((r) => r.staffLabel)
    // c-03 and p-05 work in BOTH stores (c-03 has no store card at all and is
    // floating; p-05's card lists both) — the overlap is the WORLD's fact about
    // its roster, named rather than swept up, and nothing this room decides.
    expect(b.filter((id) => a.has(id)).sort()).toEqual(['テスト さぶろう', '見本 ごろう'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ EVERY MONTH AND DATE ASSERTION RUNS ON A PINNED CLOCK', () => {
  it('the analysis window is ROLLING, so it never empties on the 1st of a month', async () => {
    for (const at of ['2026-09-01T00:30:00Z', '2026-08-31T14:59:00Z', '2026-02-01T03:00:00Z', '2026-12-31T15:30:00Z']) {
      pinClock(at)
      const { props } = await coachingProps(GINZA)
      unpinClock()
      expect({ at, kind: props.self.kind }).toEqual({ at, kind: 'ready' })
      expect(props.windowLabel).toMatch(/^直近90日（.+〜.+）$/)
    }
  })

  it('D8-6 — the outcomes title claims no window: OutcomesSummary carries none', async () => {
    // contract.ts:162-172 OutcomesSummary has no window field, so the count's
    // own label must not borrow the run's windowLabel — a stamped window on a
    // field the plane never scoped is the exact honesty defect this room polices
    // everywhere else (⚖ every stat says WHAT it counts).
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    expect(props.self.outcomes.title).not.toMatch(/直近\d+日/)
    expect(props.self.outcomes.title).toMatch(/^不成約の理由（\d+件）$/)
  })

  it('the trend’s month ticks end on the month the reader is in', async () => {
    pinClock(MID_MONTH) // 2026-08-15 JST
    const { props } = await coachingProps(GINZA)
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    expect(props.self.trend.map((p) => p.label)).toEqual(['5月', '6月', '7月', '8月'])
  })

  it('the ticks walk across a YEAR boundary without inventing a month', async () => {
    pinClock(('2026-01-15T03:00:00Z'))
    const { props } = await coachingProps(GINZA)
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    expect(props.self.trend.map((p) => p.label)).toEqual(['10月', '11月', '12月', '1月'])
  })

  it('THE JST MATRIX — the same instant reads the same day either side of UTC midnight', async () => {
    // 2026-08-19T15:30Z is already 00:30 JST on 8/20. The dateline must say 8/20.
    for (const [at, day] of [
      ['2026-08-19T14:30:00Z', '8月19日'],
      ['2026-08-19T15:30:00Z', '8月20日'],
      ['2026-08-19T23:30:00Z', '8月20日'],
    ] as const) {
      pinClock(at)
      const { props } = await coachingProps(GINZA)
      unpinClock()
      expect({ at, dateline: props.dateline.includes(day) }).toEqual({ at, dateline: true })
    }
  })

  it('the SCREEN holds no clock and no formatter', () => {
    expect(SCREEN_CODE).not.toMatch(/new Date\(|Intl\.|toLocale|getMonth|getFullYear/)
    // The only clock reads it holds are the double-click settle stamp and its
    // comparison — a DURATION, never a calendar (⚖ R6-20) — and they are counted
    // here so the pin above cannot be loosened by accident.
    expect([...SCREEN_CODE.matchAll(/Date\.now\(\)/g)].length).toBe(2)
    for (const m of SCREEN_CODE.split('\n').filter((l) => l.includes('Date.now()'))) {
      expect({ line: m.trim(), aboutSettle: m.includes('settledAt') }).toEqual({ line: m.trim(), aboutSettle: true })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ HONEST STATES + SELF-EXPLAINING NUMBERS', () => {
  it('every stat says WHAT it counts', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    expect(props.self.stats.map((s) => s.label)).toEqual(['成約率', '再来率', '満足度', '平均客単価', '「後で決める」のまま'])
    expect(props.self.stats.find((s) => s.key === 'customerSatisfaction')!.value).toMatch(/^\d\.\d \/ 5\.0$/)
    expect(props.self.stats.find((s) => s.key === 'pendingCount')!.value).toMatch(/^\d+件$/)
    expect(props.self.sessionsLabel).toBe('34回のセッションから')
  })

  it('an early read is CAVEATED, and a mature one stops apologising', () => {
    // staff-focus.ts:114 sets the bar at 12 sessions, so the caveat is the
    // MODULE's own judgement of thin data rather than a number this room chose.
    expect(maturityNote(11)).toContain('11回ぶん')
    expect(maturityNote(11)).toContain('荒削り')
    expect(maturityNote(MATURITY_MIN_SESSIONS)).toBeNull()
    expect(maturityNote(34)).toBeNull()
  })

  it('every finding carries its real numerator and denominator', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    // ⚠ THE SENTENCE IS THE RUN'S OWN `evidence.comparison`
    // (personal-findings.ts:196 — 「the quantified impact in words」), not one
    // this room composes: a page that rewrote it would be putting its own words
    // where the generator's belong.
    for (const f of props.self.findings) {
      expect(f.countLabel).toMatch(/\d/)
      expect(f.countWarning).toBeNull()
    }
    expect(props.self.findings[0].countLabel).toBe('12回中8回、うち5回が不成約')
  })

  it('findings LEAD with what is costing outcomes and END with the strengths', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    expect(props.self.findings.map((f) => f.severity)).toEqual(['priority', 'watch', 'strength'])
  })

  it('the receipts are the staff member’s OWN verbatim moments, and they are quoted', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    // personal-findings.ts:202 — ONE verbatim moment per finding, or none. Never
    // an array: the schema's `verbatim_moment` is a single object or null, and a
    // page that rendered two would be rendering a shape the generator cannot
    // produce.
    const withReceipts = props.self.findings.filter((f) => f.moment !== null)
    expect(withReceipts.length).toBeGreaterThanOrEqual(3)
    for (const f of withReceipts) {
      expect(f.moment!.quote.length).toBeGreaterThan(0)
      expect(['スタッフ', 'お客様', '話者不明']).toContain(f.moment!.speakerLabel)
      expect(f.moment!.date.length).toBeGreaterThan(0)
    }
  })

  it('「後で決める」 rides the spine as a first-class metric, with its own sentence', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { selfId: 'p-04', floor: 20 } })
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    expect(props.self.outcomes.pendingLine).toContain('17件')
    expect(props.self.findings[0].headline).toContain('後で決める')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE REFUSAL CENSUS — every lever, its own reason, its own registry line', () => {
  const REGISTRY = ['①集計の実データ接続', '②コーチング生成', '③同意の実保存', '④深掘り共有の権限', '⑤店舗設定ダイヤル', '⑦ピア共有']

  it('every refusal reason is DISTINCT and says which sample state it is in — in ONE word', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const reasons = [...Object.values(props.refusals), ...Object.values(props.helpRefusals)]
    expect(new Set(reasons).size).toBe(reasons.length)
    for (const r of reasons) {
      expect({ r, saysSample: r.startsWith('サンプルデータのため') }).toEqual({ r, saysSample: true })
    }
    // ⚠ ONE WORD FOR ONE THING, on the screen a reader is actually on. The
    // shell's own honesty chip says ◈ サンプルデータ and this room's dateline
    // says サンプルデータ; these sentences said 見本データ for the identical
    // thing three lines below it.
    expect(props.dateline.startsWith('サンプルデータ')).toBe(true)
    expect(props.actionFootnote.startsWith('サンプルデータのため')).toBe(true)
    expect(JSON.stringify(props)).not.toContain('見本データ')
  })

  it('the REGISTRY LINE is in the code, and NEVER in a sentence a reader gets', async () => {
    // ⚖ plain names. Each reason used to end with 「（登録: ②コーチング生成）」 —
    // an internal ticket code on a control a salon manager reads — and
    // `refused()` folds the whole reason into the button's accessible NAME, so
    // a screen reader voiced the code as one unbroken utterance on every
    // disabled control on the page.
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    // nothing a reader can see, hear or hover carries a tag — the whole
    // serialized payload, not a list of the strings I remembered to check
    expect(JSON.stringify(props)).not.toMatch(/登録:|[①-⑳]/)
    // …and the seam each lever waits on is still NAMED, beside the string it
    // belongs to, so the sentence on screen and the build report’s §9 ask stay
    // the same seam (mutant M22).
    for (const line of REGISTRY) {
      expect({ line, inSource: PROPS_SRC.includes(line) || LIB_SRC.includes(line) }).toEqual({ line, inSource: true })
    }
    // ⚠ THE MAP, NOT THE MERE PRESENCE — and this is the look-fix round's own
    // correction. The round added two levers (consent, deletion) that wait on
    // the SAME seam as `share` (③同意の実保存), so three lines now carry ③ and a
    // pin that only asked 「does ③ appear somewhere」 could no longer tell
    // whether `share`'s OWN line had been deleted. Mutant M22 survived on
    // exactly that. The pin now reads the seam map itself and requires ONE
    // ENTRY PER LEVER, so a refusal losing its line is a refusal with no seam.
    const seamMap = Object.fromEntries(
      [...PROPS_SRC.matchAll(/^\s*\*\s+([a-z]+)\s+→ 登録 ([①-⑳]\S*)/gm)].map((m) => [m[1], m[2]]),
    )
    expect(Object.keys(seamMap).sort()).toEqual(Object.keys(props.refusals).sort())
    const helpSeams = Object.fromEntries(
      [...LIB_SRC.matchAll(/^\s*\*\s+([a-z-]+)\s+→ 登録 ([①-⑳]\S*)/gm)].map((m) => [m[1], m[2]]),
    )
    expect(Object.keys(helpSeams).sort()).toEqual(Object.keys(props.helpRefusals).sort())
    // and the tags really are in COMMENTS — stripping them leaves none behind
    expect(stripComments(PROPS_SRC).replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/[①-⑳]/)
    expect(stripComments(LIB_SRC).replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/[①-⑳]/)
    expect(SCREEN_CODE).not.toMatch(/登録:|[①-⑳]/)
  })

  it('⚖ NOTHING ON THIS PAGE IS RENDERED `hidden` — a poster of a state is not a state', () => {
    // ⚖ 8/17, and the room-3 zero-state rebuild that ended the class. Canon
    // carried a `[hidden]` boundary panel for a state the business cannot be
    // in; this room states such boundaries in WORDS instead (deviation C8-2).
    //
    // ⚠ IT IS ALSO THE CHEAPEST WAY TO DELETE A TRUTH FROM THIS PAGE, which is
    // how the look-fix round found it: mutants M39 (the ROI's honesty note) and
    // M45 (the consent gate) both simply added `hidden` to a section, and every
    // pin that read the SOURCE for the string, and every probe verdict that read
    // `textContent`, stayed green — because `hidden` removes the box, not the
    // text. One structural rule kills both, and states a law the room already
    // lives by.
    // ⚠ `aria-hidden` IS A DIFFERENT WORD AND A LEGITIMATE ONE — it removes a
    // decorative mark from the accessibility tree (the chart's start line, the
    // skill track's benchmark tick) without removing anything a reader sees.
    // What this pin bans is the BOX-REMOVING attribute.
    expect(SCREEN_CODE).not.toMatch(/(?<!aria-)\bhidden\b/)
    expect(SCREEN_CODE).not.toContain('display: none')
    expect(SCREEN_CODE).not.toContain('visibility: hidden')
    // ⚖ VL-4 — THE LAW REACHES THE STYLESHEET TOO. The identical deletion,
    // expressed in the room's own CSS instead of a JSX prop (`.cg-x { display:
    // none }`), is the same box-removing sentence in a different file, and
    // nothing pinned it there.
    expect(CSS_CODE).not.toMatch(/display:\s*none/)
    expect(CSS_CODE).not.toMatch(/visibility:\s*hidden/)
  })

  it('the census is COMPLETE — every refused control on the page is one of them', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    // Every LITERAL `refused(` call in the screen, and what it is handed.
    const calls = [...SCREEN_CODE.matchAll(/refused\(\s*'([^']+)',\s*([^,)]+)/g)].map((m) => ({ label: m[1], reason: m[2].trim() }))
    expect(calls.map((c) => c.label).sort()).toEqual([
      'コーチングの設定', '共有された内容を見る', '気づきを作り直す',
    ])
    // …plus the TWO dynamic calls. The help action resolves through the help
    // table; the share button's LABEL now resolves from the viewer's own grant,
    // so it is 共有をオンにする or 共有をやめる rather than a hardcoded word.
    expect(SCREEN_CODE).toContain('refused(ready.share.buttonLabel, props.refusals.share')
    expect(SCREEN_CODE).toContain('refused(r.action.label, props.helpRefusals[r.action.kind]')
    expect(Object.keys(props.helpRefusals).sort()).toEqual(['assign-module', 'manager-coaching', 'peer-pairing'])
  })

  it('a refusal is FOCUSABLE and carries its reason on the accessible NAME', () => {
    expect(SCREEN_CODE).toContain("'aria-disabled': 'true' as const")
    expect(SCREEN_CODE).toContain("'aria-label': `${label} — ${reason}`")
    // The class merge is LAST, so a call site cannot write over `.btn` (F-K1).
    const helper = SCREEN_CODE.slice(SCREEN_CODE.indexOf('const refused ='), SCREEN_CODE.indexOf('const self = props.self'))
    expect(helper.lastIndexOf('className:')).toBeGreaterThan(helper.indexOf("'aria-label'"))
  })

  it('NOTHING on the page writes — no form, no fetch, no action, no live model call', () => {
    expect(SCREEN_CODE).not.toMatch(/<form|fetch\(|useTransition|'use server'|onSubmit/)
    expect(stripComments(PROPS_SRC)).not.toMatch(/fetch\(|openai|OpenAI/i)
  })

  it('the standing footnote is on the page and says the same thing once', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    expect(props.actionFootnote).toContain('実データ接続後に有効になります')
    expect(SCREEN_CODE).toContain('{props.actionFootnote}')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ ANY-ROSTER-SIZE — 25+ staff, arithmetic exact, no scroller', () => {
  const bigRoster = Array.from({ length: 28 }, (_, i) => ({ id: `syn-${i}`, name: `合成 ${i}` }))
  const bigRows = bigRoster.map((m, i) => ({
    ...coachingStaff[0],
    staffId: m.id,
    sessions: i < 4 ? 5 : 30 + i,
    // three real trajectories, plus a below-floor tail
    history: i % 3 === 0 ? [0.30, 0.32, 0.44] : i % 3 === 1 ? [0.50, 0.50, 0.50] : [0.55, 0.50, 0.40],
    grant: (i % 7 === 0 ? 'granted' : i % 5 === 0 ? 'declined' : 'none') as 'granted' | 'declined' | 'none',
  }))

  it('the board renders every member and the four counts add up to the roster', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { roster: bigRoster, rows: bigRows } })
    unpinClock()
    expect(props.team!.rows.length).toBe(28)
    const nums = props.team!.counts.map((c) => Number(c.value.replace('名', '')))
    expect(nums.reduce((a, b) => a + b, 0)).toBe(28)
  })

  it('the adoption aggregate is exact, and counts grants only', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { roster: bigRoster, rows: bigRows } })
    unpinClock()
    const granted = bigRows.filter((r) => r.grant === 'granted').length
    expect(props.team!.adoptionLine).toBe(`深い共有を許可しているスタッフ ${granted}名 / 在籍 28名`)
  })

  it('a 28-row board still carries NO number per row', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { roster: bigRoster, rows: bigRows } })
    unpinClock()
    for (const row of props.team!.rows) {
      expect({ id: row.staffLabel, digits: /\d/.test(row.trajectoryLine) }).toEqual({ id: row.staffLabel, digits: false })
    }
  })

  it('the sheet gives the roster NO container of its own to scroll in', () => {
    // ⚖ PAGE-SCROLL, ruled twice: the page grows, the room owns no axis.
    expect(CSS_CODE).not.toMatch(/overflow-y|overflow-x|overscroll-behavior|max-height/)
    expect(CSS_CODE).not.toMatch(/\.cg-rows[^{]*\{[^}]*height/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE SHEET — the ladder’s arithmetic, the ring, and page scroll', () => {
  it('the two-column threshold equals the SUM of its own terms, read from the sheet', () => {
    // ⚠ A literal 「880」 goes stale the moment one of the three terms moves —
    // the room-6 B4-1 lesson. The numbers are parsed and the threshold is
    // asserted against them, so widening a column without moving the threshold
    // fails HERE rather than in somebody's browser.
    const num = (name: string) => {
      const m = CSS_CODE.match(new RegExp(`--${name}:\\s*(\\d+)px`))
      if (!m) throw new Error(`missing --${name}`)
      return Number(m[1])
    }
    const main = num('cg-main-min')
    const side = num('cg-side-min')
    const colsGap = num('cg-cols-gap')
    const cardGap = num('cg-card-gap')
    expect({ main, side, colsGap, cardGap }).toEqual({ main: 520, side: 320, colsGap: 24, cardGap: 18 })
    const thresholds = [...CSS_CODE.matchAll(/@container cg-page \(min-width: (\d+)px\)/g)].map((m) => Number(m[1]))
    const distinct = [...new Set(thresholds)].sort((a, b) => a - b)
    // TWO thresholds, THREE compositions — and each one equals the sum of its
    // own terms plus a stated slack, so widening a column without moving its
    // threshold fails HERE rather than in somebody's browser.
    expect(distinct).toEqual([700, 880])
    // ⚠ AND EACH THRESHOLD ACTUALLY DOES ITS JOB. A threshold that exists but
    // sets the same shape on both sides is a band with no composition — mutant
    // M28 removed the fold's two-across cards and survived until this pin.
    const fold = CSS_CODE.slice(CSS_CODE.indexOf('@container cg-page (min-width: 700px)'))
    expect(fold.slice(0, 200)).toContain('.cg-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
    const desk = CSS_CODE.slice(CSS_CODE.indexOf('@container cg-page (min-width: 880px)'))
    expect(desk.slice(0, 320)).toContain('grid-template-columns: minmax(var(--cg-main-min), 1.5fr) minmax(var(--cg-side-min), 1fr)')
    expect(desk.slice(0, 320)).toContain('.cg-side { grid-template-columns: 1fr; }')
    const deskFits = main + side + colsGap
    expect(deskFits).toBe(864)
    expect(distinct[1]).toBeGreaterThanOrEqual(deskFits)
    expect(distinct[1] - deskFits).toBeLessThanOrEqual(24)
    const foldFits = side + side + cardGap
    expect(foldFits).toBe(658)
    expect(distinct[0]).toBeGreaterThanOrEqual(foldFits)
  })

  it('the ladder has exactly ONE column threshold, and it is a CONTAINER query', () => {
    // Container width is monotonic in page width, so the shape cannot gain a
    // column, lose it and gain it again across a sweep — monotonicity by
    // construction rather than by a media ladder anyone keeps ordered.
    // Container width is monotonic in page width, so each threshold is crossed
    // EXACTLY ONCE across a sweep — the room never gains a column, loses it and
    // gains it again. Four blocks, two distinct widths: the page columns and the
    // board row each recompose at both.
    expect([...CSS_CODE.matchAll(/@container/g)].length).toBe(4)
    expect(CSS_CODE).toContain('container: cg-page / inline-size')
    // …and NO media band ever restates a composition, so a viewport rule cannot
    // disagree with the shape the container decided.
    const inMedia = CSS_CODE.slice(CSS_CODE.indexOf('@media (min-width: 1400px)'))
    expect(inMedia).not.toContain('grid-template-columns')
  })

  it('the room states its own PAGE rule at FOUR levels — never three, which ties', () => {
    const base = CSS_CODE.slice(0, CSS_CODE.indexOf('@container'))
    expect(base).toContain('.biz .page.pg-coaching { padding:')
    expect(base).not.toMatch(/\.biz \.pg-coaching \{/)
    expect(base).toContain('.biz .page.pg-coaching h1 {')
    expect(base).toContain('.biz .page.pg-coaching .btn { font-weight: 500; }')
    expect(base).toContain('.biz .page.pg-coaching .btn.primary { font-weight: 600; }')
  })

  it('no container in this room clips a focus ring', () => {
    // The shell paints 3px OUTSIDE at 2px offset — a ring the room clips is not
    // a ring (the room-3 F2 lesson).
    expect(CSS_CODE).not.toContain('overflow: hidden')
  })

  it('the room joins the shell’s 1180px floor opt-in list, and only the SHELL states it', () => {
    const shell = read('src/app/[locale]/(business)/business-shell.css')
    // Re-derived at the 2026-09-05 fold: five rooms joined the list on main
    // (録音 · 売上分析 · 予約一覧 · 顧客 · AI相談) and ⑥ stays appended LAST.
    expect(shell).toContain('.biz .app:has(.page.pg-inbox, .page.pg-register, .page.pg-karute, .page.pg-recording, .page.pg-analytics, .page.pg-reservations, .page.page-customers, .page.pg-ask-ai, .page.pg-coaching) { min-width: 0; }')
    expect(CSS_CODE).not.toContain('.biz .app')
  })

  it('touch targets reach 44px on EVERY touch device, not just the phone', () => {
    // ⚖ ALL-SCREEN names ≥44px at ≤743; that is the floor. 744–1023 is the iPad
    // portrait / mini / opened-foldable band the same law lists, and the probe
    // measured a 26px ? and 38–42px buttons there before this band existed.
    const touch = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 1023px)'), CSS_CODE.indexOf('@media (max-width: 743px)'))
    for (const rule of ['.cg-tab { min-height: 44px', '.cg-help { width: 44px', '.btn { min-height: 44px', '.cg-spot-foot button { min-height: 44px']) {
      expect(touch).toContain(rule)
    }
    // …and the phone band keeps only what is about LAYOUT.
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toContain('.cg-tab { flex: 1 1 auto; }')
    expect(phone).toContain('.cg-row-act { width: 100%; }')
    expect(phone).not.toContain('min-height: 44px')
  })

  it('one unbroken latin run cannot push the page sideways', () => {
    // MEASURED: the probe's hostile world scrolled the PAGE horizontally at
    // 1586 / 1280 / 1024 / 820 before this line. `anywhere` rather than
    // `break-word` because only `anywhere` lets the break count toward
    // min-content, so a grid track can shrink past the long word.
    expect(CSS_CODE).toMatch(/\.biz \.page\.pg-coaching \{[\s\S]*?overflow-wrap: anywhere;/)
  })

  it('the interactive accent is R13’s ONE blue, and no control is filled black', () => {
    expect(CSS_CODE).toContain('--cg-accent: #2563eb;')
    expect(CSS_CODE).not.toContain('#3f5be8')
    // The selected tab is a WASH, never a solid fill (⚖ R13's own recipe).
    expect(CSS_CODE).toMatch(/\.cg-tab\.is-on\s*\{[^}]*background: var\(--cg-accent-wash\)/)
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|#18181b|black)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE SIBLING-SHEET FENCE, derived FRESH from today’s sheets', () => {
  const stripCss = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  /** ⚠ WALKS THE AT-RULES INSTEAD OF SPLITTING BLINDLY (the room-5 F-K11 fix,
   *  ported): for the FIRST rule inside any `@media` block a blind
   *  `split('}')` + `indexOf('{')` finds the media query's OWN brace, so the
   *  selector is never seen — the exact shape the room-2 BLOCKER wore. */
  const selectorsOf = (src: string) =>
    stripCss(src)
      .replace(/@(?:keyframes|font-face|counter-style|property)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .replace(/@(?:media|supports|layer|container)[^{]*\{/g, '')
      .split('}')
      .flatMap((block) => {
        const i = block.indexOf('{')
        return i < 0 ? [] : block.slice(0, i).split(',').map((s) => s.trim()).filter(Boolean)
      })
      .filter((s) => !s.startsWith('@'))
  const classesIn = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'biz')

  const SIBLING_DIRS = readdirSync(join(BIZ, 'business')).filter((d) => {
    if (d === 'coaching') return false
    try {
      readFileSync(join(BIZ, 'business', d, `${d}.css`))
      return true
    } catch {
      return false
    }
  })

  const mine = new Set<string>(['pill', 'good', 'warn', 'alert', 'indigo', 'btn', 'primary', 'danger', 'page'])
  for (const sel of selectorsOf(CSS_SRC)) {
    if (!sel.includes('pg-coaching')) continue
    for (const c of classesIn(sel)) if (c !== 'pg-coaching') mine.add(c)
  }

  it('the parser is RED-PROVEN against a first-in-@media plant', () => {
    const plant = '@media (max-width: 743px) {\n  .biz .cg-row { display: none; }\n  .biz .zzz { color: red; }\n}'
    expect(selectorsOf(plant)).toEqual(['.biz .cg-row', '.biz .zzz'])
  })

  it('the neighbours are all here — read from disk, never restated', () => {
    // Re-derived at the 2026-09-05 fold: 録音 · 売上分析 · 予約一覧 · 顧客 ·
    // AI相談 · 設定 all landed on main since this pin was written, so the family
    // is ELEVEN sheets beside this room's own. Each newcomer scopes its rules
    // under its own `.pg-` / `.page-` class, so none of them widens the fence.
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'ask-ai', 'customers', 'inbox', 'karute', 'recording', 'register', 'reservations', 'settings', 'shifts', 'today'])
  })

  /** The collision rule itself, factored out so the RED-RUN plant below is
   *  judged by exactly the logic the real sheets are judged by. */
  const collisionsIn = (dir: string, src: string) => {
    const out: string[] = []
    for (const sel of selectorsOf(src)) {
      if (!sel.startsWith('.biz') || sel.includes('.pg-')) continue
      const names = classesIn(sel)
      if (names.length && names.every((n) => mine.has(n))) out.push(`${dir}::${sel}`)
    }
    return out
  }

  it('every sibling rule that could reach this room is FENCED at four levels', () => {
    const collisions: string[] = []
    let selectorsRead = 0
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      selectorsRead += selectorsOf(src).length
      collisions.push(...collisionsIn(dir, src))
    }
    // Derived, not copied: a neighbour that ever states a bare rule on a name
    // this room renders appears here, and the fence has to grow in the same pass.
    // Re-derived at the 2026-09-05 fold and legitimately EMPTY: ③ 予約一覧
    // (#832) and ④ 顧客 (#834) RETIRED the bare `.biz .btn` / `.biz .btn.primary`
    // / `.biz .page .btn` rules this pin used to catch, so at this tip no
    // sibling states an unscoped rule on a name this room renders.
    expect(collisions.sort()).toEqual([])
    // ⚠ ANTI-VACUITY, because an empty list proves nothing on its own. Two
    // things have to hold for the emptiness to MEAN something: the parser
    // actually read the family's sheets…
    expect(selectorsRead).toBeGreaterThan(100)
    // …and a planted bare rule still comes back RED through the same function.
    // The plant lives in memory — a sibling's file is never touched.
    expect(collisionsIn('plant', '.biz .btn { font-weight: 500; }\n.biz .page .btn.primary { color: red; }\n.biz .page.pg-plant .btn { color: red; }'))
      .toEqual(['plant::.biz .btn', 'plant::.biz .page .btn.primary'])
  })

  /** Every class name the MARKUP produces. A `${…}` hole is an EXPRESSION, so it
   *  is stripped — which leaves the STEM of a computed name (`cg-find is-${…}`
   *  → `is-`) rather than the names it can resolve to. Those stems are collected
   *  separately and pinned in their own test below, because a name only a
   *  template literal can spell is exactly the kind a scan quietly loses (the
   *  room-4 M10 lesson). */
  const rendered = new Set<string>()
  const stems = new Set<string>()
  for (const m of SCREEN_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    for (const name of raw.replace(/\$\{[^}]*\}/g, ' $ ').split(/\s+/)) {
      if (name === '$' || !name) continue
      if (/^[a-z][\w-]*-$/.test(name)) { stems.add(name); continue }
      if (/^[a-z][\w-]*$/.test(name)) rendered.add(name)
    }
    // ⚠ ONLY THE TERNARY'S BRANCHES. A bare quoted-string scan also collects the
    // COMPARISON literals (`tab === 'self'`), which are state values and not
    // class names — a pin that reported them would be flagging the room for
    // classes it never renders.
    for (const name of [...raw.matchAll(/[?:]\s*'\s*([a-z][\w-]*)\s*'/g)].map((x) => x[1])) rendered.add(name)
  }

  it('every class name the SCREEN renders is this room’s own, or one of the shell’s', () => {
    const SHELL = new Set(['page', 'pg-coaching', 'btn'])
    // ⚠ `is-*` ARE THIS ROOM'S STATE MODIFIERS, and they are allowed here for
    // ONE reason, proven in the next test: this sheet never states one on its
    // own — every rule compounds it with a `cg-` class, so a neighbour's bare
    // `.biz .is-on` has nothing at three levels to tie with.
    const strays = [...rendered].filter((n) => !n.startsWith('cg-') && !n.startsWith('is-') && !SHELL.has(n))
    expect(strays).toEqual([])
    expect([...rendered].filter((n) => n.startsWith('cg-')).length).toBeGreaterThan(30)
    // The computed names really are the ones this room means.
    expect([...stems].sort()).toEqual(['is-'])
    // ⚠ THE LIST IS ENUMERATED ON PURPOSE — a new state modifier must be
    // ADDED here, so nobody can introduce a bare name the fence has not been
    // reasoned about. The look-fix round adds four: the ROI chart's two data
    // series, the catalog's 「this one is yours」 card, and the two columns of
    // the visibility wall.
    expect([...rendered].filter((n) => n.startsWith('is-')).sort())
      .toEqual(['is-control', 'is-mine', 'is-on', 'is-support', 'is-theirs', 'is-treated'])
  })

  it('every `is-` state modifier is stated COMPOUNDED with a cg- class, never alone', () => {
    // The room's own half of the fence for the one family of names that is not
    // `cg-` prefixed. `.is-priority` / `.is-watch` / `.is-strength` are spelled
    // only by a template literal, so they are read out of the SHEET.
    const isNames = new Set<string>()
    for (const sel of selectorsOf(CSS_SRC)) {
      for (const part of sel.split(/\s+/)) {
        for (const cls of part.matchAll(/\.(is-[\w-]+)/g)) {
          isNames.add(cls[1])
          // the compound the modifier lives on must carry a cg- class too
          expect({ selector: sel, part, compounded: /\.cg-[\w-]+/.test(part) })
            .toEqual({ selector: sel, part, compounded: true })
        }
      }
    }
    expect([...isNames].sort()).toEqual([
      'is-building', 'is-control', 'is-declined', 'is-early', 'is-mature', 'is-mine', 'is-none',
      'is-on', 'is-priority', 'is-strength', 'is-support', 'is-theirs', 'is-treated', 'is-unset', 'is-watch',
    ])
    // …and no neighbour states a bare rule on any of them.
    /** ⚠ COMPOUND-AWARE, re-derived at the 2026-09-05 fold. BARE means the
     *  modifier stands ALONE in its compound — nothing glued to it, so it can
     *  match this room's element on the modifier alone. `.biz .is-none` is
     *  bare; `.cu-cnext.is-none` is NOT, because the neighbour's own class has
     *  to match first. The old form asked `classesIn(sel).includes(n)`, which
     *  reads the WHOLE selector and so reported ④'s
     *  `.biz .page-customers .cu-cnext.is-none .cu-a` as bare although the
     *  modifier never stands alone there. Splitting on the COMBINATORS
     *  (whitespace · `>` · `+` · `~`) is what makes the question answerable.
     *  `.biz` does not count as a partner (`classesIn` drops it), so a
     *  `.biz.is-on` would still be reported. */
    const statesBare = (sel: string, name: string) =>
      sel
        .split(/[\s>+~]+/)
        .filter(Boolean)
        .some((part) => {
          const names = classesIn(part)
          return names.length === 1 && names[0] === name
        })
    // Proven both ways in memory before it is trusted on the real sheets.
    expect(statesBare('.biz .page-customers .cu-cnext.is-none .cu-a', 'is-none')).toBe(false)
    expect(statesBare('.biz .page-customers .is-none .cu-a', 'is-none')).toBe(true)
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const sel of selectorsOf(src)) {
        if (sel.includes('.pg-')) continue
        for (const n of isNames) {
          expect({ dir, sel, name: n, bare: statesBare(sel, n) }).toEqual({ dir, sel, name: n, bare: false })
        }
      }
    }
  })

  it('this room’s own names exist NOWHERE else in the family', () => {
    const own = [...mine].filter((n) => n.startsWith('cg-'))
    expect(own.length).toBeGreaterThan(30)
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const n of own) expect({ dir, name: n, used: src.includes(`.${n}`) }).toEqual({ dir, name: n, used: false })
    }
    const shell = readFileSync(join(BIZ, 'business-shell.css'), 'utf8')
    for (const n of own) expect({ name: n, inShell: shell.includes(`.${n}`) }).toEqual({ name: n, inShell: false })
  })

  it('the only SHELL class the markup names is `btn`, and the sheet states it at four levels', () => {
    // ⚠ A `className=` SCAN CANNOT SEE A CLASS A HELPER ASSEMBLES — and `btn` is
    // exactly that: every refused control gets it from `refused()`'s own merge,
    // in JS, so it never appears in an attribute. A pin that only read
    // attributes would report this room as naming NO shell class at all while
    // spending the family's most-collided one on nine controls. Both sources are
    // read here (the room-4 M10 lesson, in its second shape).
    const fromHelper = [...SCREEN_CODE.matchAll(/\[\s*'([a-z][\w-]*)',\s*className\s*\]/g)].map((m) => m[1])
    expect(fromHelper).toEqual(['btn'])
    const shellNames = new Set([...rendered, ...fromHelper].filter((n) => !n.startsWith('cg-') && !n.startsWith('is-')))
    expect([...shellNames].sort()).toEqual(['btn'])
    // …plus the ROUTE WRAPPER, which the screen does not spell as a literal.
    expect(SCREEN_CODE).toContain("const ROOT = 'page pg-coaching'")
    expect(CSS_CODE).toContain('.biz .page.pg-coaching .btn { font-weight: 500; }')
    expect(CSS_CODE).toContain('.biz .page.pg-coaching .btn.primary { font-weight: 600; }')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the fixture plane ADDS and never restates', () => {
  it('a coaching row states no name, no store and no date', () => {
    const src = readFileSync(join(process.cwd(), 'src/business/lib/fixtures-coaching.ts'), 'utf8')
    const code = stripComments(src).replace(/^\s*\/\/.*$/gm, '')
    for (const member of worldStaff) {
      expect({ name: member.full_name, restated: code.includes(member.full_name) }).toEqual({ name: member.full_name, restated: false })
    }
    // The only world value it names is the store id it switches the module on
    // for, and it IMPORTS that rather than spelling it.
    expect(code).toContain("import { STORE_A } from './fixtures'")
    expect(code).not.toContain("'store-test-ginza'")
    expect(code).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('every row joins a real world staff id', () => {
    const ids = new Set(worldStaff.map((s) => s.id))
    for (const row of coachingStaff) expect({ id: row.staffId, real: ids.has(row.staffId) }).toEqual({ id: row.staffId, real: true })
  })

  it('the plane holds every data state the room has to render', () => {
    expect(coachingStaff.find((r) => sessionsOf(r) >= 34 && r.findingsRun.findings.length >= 3)).toBeTruthy() // rich
    expect(coachingStaff.find((r) => sessionsOf(r) < FLOOR_DEFAULT)).toBeTruthy() // below the floor
    expect(coachingStaff.find((r) => r.outcomes.pendingCount > r.outcomes.noDealTotal)).toBeTruthy() // defer-heavy
    expect(coachingStaff.find((r) => r.grant === 'granted')).toBeTruthy()
    expect(coachingStaff.find((r) => r.grant === 'declined')).toBeTruthy()
    expect(coachingStaff.find((r) => r.grant === 'none')).toBeTruthy()
    // the longest string the room can be handed
    // the longest string the room can be handed from its OWN plane; the
    // deliberately hostile ones (unbroken latin, doubled length) are the probe's
    // stress worlds, where they belong — the demo plane stays believable.
    const longest = Math.max(
      ...coachingStaff.flatMap((r) => [
        ...r.findingsRun.findings.map((f) => f.impact.length),
        ...r.focus.focus_areas.map((f) => f.summary_text.length),
      ]),
    )
    expect(longest).toBeGreaterThan(80)
    // and a store the module was never switched on for
    expect(coachingStores).toEqual([STORE_A])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the shell one-liners — the room is REACHABLE, and never a dead link', () => {
  const SIDEBAR = read('src/app/[locale]/(business)/BusinessSidebar.tsx')
  const TOPBAR = read('src/app/[locale]/(business)/BusinessTopbar.tsx')

  it('the nav item is LIVE — a real Link on its own segment, never a 準備中 stub', () => {
    // ⚖ the NAV LAW (L-5): all twelve items always render; flipping a screen
    // live is one `live: true`. A room that shipped with `live: false` would be
    // a page nobody can reach, and a room whose segment is `null` would render
    // the greyed 準備中 treatment over a screen that exists.
    expect(SIDEBAR).toContain("{ key: 'coaching', segment: 'coaching', label: 'コーチング', mini: 'コーチ', live: true }")
    expect(SIDEBAR).not.toContain("key: 'coaching', segment: null")
  })

  it('the breadcrumb names the room, so the topbar never falls back to 顧客', () => {
    expect(TOPBAR).toContain("coaching: 'コーチング',")
  })

  it('the loading state has its own string, like every other room', () => {
    const i18n = JSON.parse(read('src/business/i18n/ja.json'))
    expect(i18n.coaching).toEqual({ loading: '読み込み中…' })
    expect(readFileSync(join(ROOM_DIR, 'loading.tsx'), 'utf8')).toContain('businessStrings.coaching.loading')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ SHAPE FIDELITY — every rendered shape mirrors its generator, field for field', () => {
  // ⚠ THE PROMPT FILES ARE READ FROM DISK AND THE FIELD NAMES ARE DERIVED FROM
  // THEM. Liam 9/1: the coaching prompts are the carefully built asset, and a
  // page that renders a shape the generator cannot produce is a page that has to
  // be rebuilt at reconnect. So these pins do not restate the schemas — they
  // PARSE them, and a change to a prompt module goes red HERE rather than in
  // somebody's browser six months from now.
  const P = 'src/lib/karute/coaching/prompts'
  const FINDINGS = read(`${P}/personal-findings.ts`)
  const FOCUS = read(`${P}/staff-focus.ts`)
  const SCORING = read(`${P}/category-scoring.ts`)
  const CATS = read(`${P}/categories.ts`)
  const CONTRACT = read('src/lib/karute/coaching/contract.ts')
  const PLANE = readFileSync(join(process.cwd(), 'src/business/lib/fixtures-coaching.ts'), 'utf8')

  /** The `required: [...]` list of the schema block that starts at `anchor`. */
  const requiredAfter = (src: string, anchor: string): string[] => {
    const at = src.indexOf(anchor)
    expect({ anchor, found: at >= 0 }).toEqual({ anchor, found: true })
    const m = /required:\s*\[([^\]]*)\]/.exec(src.slice(at))
    if (!m) throw new Error(`no required[] after ${anchor}`)
    return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort()
  }
  /** The field names an interface in OUR plane declares.
   *  ⚠ `{2,}`, NOT `{2}`. The first cut demanded EXACTLY two leading spaces, so
   *  a plane field written at four — a re-indent, a merge, a hand edit — was
   *  invisible to the mirror and the 「field for field」 gate silently compared a
   *  SUBSET. Proven: `  coachNote?: string` on FixtureFindingEvidence went red,
   *  `    coachNote?: string` stayed green. Every field of these interfaces is
   *  declared on its own line, so a looser indent cannot pull in an inner
   *  object's keys. */
  const fieldsOf = (src: string, name: string): string[] => {
    const at = src.indexOf(`export interface ${name} {`)
    expect({ name, found: at >= 0 }).toEqual({ name, found: true })
    const body = src.slice(at + `export interface ${name} {`.length, src.indexOf('\n}', at))
    return [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^ {2,}([a-zA-Z_][\w]*)\??:/gm)].map((m) => m[1]).sort()
  }

  it('the RUN ENVELOPE mirrors personal-findings.ts’s own OUTPUT_SCHEMA', () => {
    // ⚠ THIS PARSE USED TO RUN AND BE THROWN AWAY (`void schema`), so all that
    // survived was the anchor-exists check inside `requiredAfter`. The envelope
    // really is a mirror and now says so: the module's own `window` object is
    // the one field this plane FLATTENS, and it flattens to the single number
    // inside it (`sessions_reviewed`) because `date_range` is composed from the
    // render clock — the demo world is dated relative to today.
    const schema = requiredAfter(FINDINGS, 'const OUTPUT_SCHEMA')
    expect(schema).toEqual(['findings', 'headline', 'status', 'window'])
    expect(requiredAfter(FINDINGS, "required: ['sessions_reviewed'")).toEqual(['date_range', 'sessions_reviewed'])
    expect(fieldsOf(PLANE, 'FixtureFindingsRun')).toEqual(
      schema.filter((f) => f !== 'window').concat('sessions_reviewed').sort(),
    )
  })

  it('the FINDING mirrors personal-findings.ts’s own findings[] item', () => {
    const required = requiredAfter(FINDINGS, "required: ['id', 'severity'")
    // the two OPTIONAL fields the schema lists outside `required` but inside
    // `properties` — a mirror that dropped them would lose the module link and
    // the pattern reference the fix sentence points at.
    expect(fieldsOf(PLANE, 'FixtureFinding')).toEqual([...required, 'linked_module_id', 'pattern_reference'].sort())
  })

  it('the EVIDENCE block mirrors personal-findings.ts’s EVIDENCE_SCHEMA', () => {
    expect(fieldsOf(PLANE, 'FixtureFindingEvidence')).toEqual(requiredAfter(FINDINGS, 'const EVIDENCE_SCHEMA'))
  })

  it('the VERBATIM MOMENT mirrors its own sub-schema — and it is ONE, never an array', () => {
    expect(fieldsOf(PLANE, 'FixtureVerbatimMoment')).toEqual(['date', 'quote', 'session_id', 'speaker'])
    // the schema says `anyOf: [object, null]`, so the room may render one or none
    expect(FINDINGS).toContain("required: ['session_id', 'date', 'quote', 'speaker']")
    expect(PLANE).toContain('verbatim_moment: FixtureVerbatimMoment | null')
    // …and the screen renders exactly that: `moment`, singular, nullable.
    expect(SCREEN_CODE).toContain('moment: CoachingMoment | null')
    // ⚠ `moments?:` AS WELL AS `moments:` — an OPTIONAL array is still an array
    // the generator cannot fill, and the first cut of this pin missed the `?`
    // (mutant M24 survived on it).
    expect(SCREEN_CODE).not.toMatch(/moments\??\s*:/)
    expect(PROPS_SRC).not.toMatch(/moments\??\s*:/)
  })

  it('the SESSION REF mirrors its own sub-schema, and the count is RE-CHECKED against it', () => {
    expect(fieldsOf(PLANE, 'FixtureSessionRef')).toEqual(['date', 'session_id'])
    // personal-findings.ts:26-27 makes the arithmetic the APP's job, not the
    // model's — so the room checks it rather than trusting it.
    expect(LIB_CODE).toContain('countChecks: f.evidence.count_total === f.evidence.session_refs.length')
    // ⚠ THE FIXTURE-INTEGRITY HALF, WITHOUT ITS ESCAPE HATCH. The first cut read
    // `count_total === len(refs) || len(refs) > 0`, and the second clause is
    // true of every finding with a single ref — so the half that is supposed to
    // prove THIS PLANE states every ref it claims could not fail. The lib-side
    // re-check pinned above is a source grep and does hold; this is the data.
    for (const row of coachingStaff) {
      for (const f of row.findingsRun.findings) {
        expect({ id: f.id, count: f.evidence.count_total, refs: f.evidence.session_refs.length })
          .toEqual({ id: f.id, count: f.evidence.count_total, refs: f.evidence.count_total })
      }
    }
  })

  it('the RUN STATUS is the module’s own four-value enum, and every one has a designed state', () => {
    const enumLine = /status: \{ type: 'string', enum: \[([^\]]*)\]/.exec(FINDINGS)![1]
    const values = enumLine.split(',').map((x) => x.trim().replace(/'/g, '')).sort()
    expect(values).toEqual(['capture_gap', 'findings', 'insufficient_data', 'routine_excellence'])
    for (const v of values) {
      expect({ status: v, hasTitle: LIB_SRC.includes(`${v}:`) }).toEqual({ status: v, hasTitle: true })
    }
  })

  it('the FOCUS card mirrors staff-focus.ts’s FOCUS_L1', () => {
    expect(fieldsOf(PLANE, 'FixtureFocusL1')).toEqual(requiredAfter(FOCUS, 'const FOCUS_L1'))
  })

  it('the BOARD’s per-staff sentence mirrors staff-focus.ts’s FOCUS_L2', () => {
    expect(fieldsOf(PLANE, 'FixtureFocusL2')).toEqual(requiredAfter(FOCUS, 'const FOCUS_L2'))
    // …and FOCUS_L2 is the L2 half BY DESIGN: 「categorical only, no number, no
    // name」 is the module's own instruction for this exact field.
    expect(FOCUS).toContain("summary_text: { type: 'string', description: 'categorical only, no number, no name' }")
  })

  it('the CATEGORY SCORE mirrors contract.ts’s CategoryScore — the VIEW type', () => {
    expect(fieldsOf(PLANE, 'FixtureCategoryScore')).toEqual(['confidence', 'key', 'score', 'topBenchmark'])
    expect(CONTRACT).toContain('export interface CategoryScore {')
    // `topBenchmark` is L1-ONLY, and the contract says why in its own words.
    expect(CONTRACT).toContain('which is why this field lives on the staff view alone')
  })

  it('the CATEGORY KEYS are categories.ts’s own four — never names this room made up', () => {
    const declared = [...CATS.matchAll(/^\s*\|\s*'([a-z_]+)'/gm)].map((m) => m[1]).sort()
    expect(declared).toEqual(['acknowledgment', 'next_step', 'questioning_depth', 'value_presentation'])
    expect(CATEGORY_TOKENS.map((c) => c.key).sort()).toEqual(declared)
    // the token table's SHAPE is `ResolvedCoachingCategory` (categories.ts:190-194)
    expect(CATS).toContain('export interface ResolvedCoachingCategory {')
    for (const t of CATEGORY_TOKENS) expect(Object.keys(t).sort()).toEqual(['def', 'key', 'label'])
    // …and every score in the plane names one of them.
    for (const row of coachingStaff) {
      for (const c of row.categories) expect({ key: c.key, real: declared.includes(c.key) }).toEqual({ key: c.key, real: true })
    }
  })

  it('the labels are categories.ts’s OWN ja strings, not a translation this room wrote', () => {
    for (const t of CATEGORY_TOKENS) {
      expect({ key: t.key, label: t.label, inSource: CATS.includes(`labelJa: '${t.label}'`) })
        .toEqual({ key: t.key, label: t.label, inSource: true })
      expect({ key: t.key, defInSource: CATS.includes(`defJa: '${t.def}'`) }).toEqual({ key: t.key, defInSource: true })
    }
  })

  it('the SCORE and CONFIDENCE ranges are category-scoring.ts’s own', () => {
    expect(SCORING).toContain('minimum: 0')
    expect(SCORING).toContain('maximum: 100')
    expect(SCORING).toContain("enum: ['high', 'medium', 'low', null]")
    for (const row of coachingStaff) {
      for (const c of row.categories) {
        expect({ key: c.key, inRange: c.score >= 0 && c.score <= 100 }).toEqual({ key: c.key, inRange: true })
        expect(['low', 'medium', 'high']).toContain(c.confidence)
      }
    }
  })

  it('the SPINE mirrors contract.ts’s CoreMetrics + OutcomesSummary, and money is TAGGED', () => {
    expect(CONTRACT).toContain('export interface CoreMetrics {')
    expect(CONTRACT).toContain('export interface OutcomesSummary {')
    for (const row of coachingStaff) {
      expect(Object.keys(row.avgRevenue).sort()).toEqual(['amount', 'currency'])
      expect(Object.keys(row.outcomes).sort()).toEqual(['declineReasons', 'noDealTotal', 'pendingCount'])
    }
    // contract.ts:163-167 — there is deliberately NO revisit slot. Measured on
    // the CODE, not the prose: the comment beside the field explains the
    // omission and naturally contains the word.
    const planeCode = stripComments(PLANE).replace(/^\s*\/\/.*$/gm, '')
    expect(planeCode).not.toContain('revisit')
  })

  it('the OWNER ROW mirrors contract.ts’s OwnerTriageRow + staff-focus’s L2 half', () => {
    expect(CONTRACT).toContain('export interface OwnerTriageRow {')
    expect(CONTRACT).toContain('export interface HelpAction {')
    const kinds = /kind: '([^']*)' \| '([^']*)' \| '([^']*)'/.exec(CONTRACT)!
    expect([kinds[1], kinds[2], kinds[3]].sort()).toEqual(['assign-module', 'manager-coaching', 'peer-pairing'])
    const view = buildTriage({ roster: [{ id: 'p-04', name: 'x' }], rows: coachingStaff, floor: FLOOR_DEFAULT })
    expect(Object.keys(view.rows[0].suggestedAction!).sort()).toEqual(['kind', 'label', 'moduleId'])
    // staff-focus.ts:183 + :190 — the two fields the L2 half adds.
    expect(FOCUS).toContain("status: { type: 'string', enum: ['generated', 'skipped']")
    expect(FOCUS).toContain("overall_maturity: { type: 'string', enum: ['established', 'early'] }")
    expect(view.rows[0].status).toBe('generated')
    expect(['established', 'early']).toContain(view.rows[0].maturity)
  })

  it('the ADOPTION aggregate mirrors contract.ts’s sharingAdoption, name and all', () => {
    expect(CONTRACT).toContain('sharingAdoption: { granted: number; total: number }')
    const view = buildTriage({ roster: [{ id: 'p-01', name: 'x' }], rows: coachingStaff, floor: FLOOR_DEFAULT })
    expect(Object.keys(view.sharingAdoption).sort()).toEqual(['granted', 'total'])
  })

  it('the TEAM PATTERN mirrors contract.ts’s TeamPattern', () => {
    expect(CONTRACT).toContain('export interface TeamPattern {')
    for (const p of teamPatterns) expect(Object.keys(p).sort()).toEqual(['adoptionNote', 'behavior', 'categoryKey', 'id'])
  })

  it('the two GENERATOR FLOORS are the modules’ own numbers, not this room’s', () => {
    expect(FINDINGS).toContain("'insufficient_data': <6 sessions")
    expect(FINDINGS_MIN_SESSIONS).toBe(6)
    expect(FOCUS).toContain("If <4 sessions this month, return status 'skipped'")
    expect(FOCUS_MIN_SESSIONS).toBe(4)
    expect(FOCUS).toContain('sessions at 180d+')
    expect(FOCUS.replace(/\s+/g, ' ')).toContain("maturity 'early' / <12 sessions at 180d+")
    expect(MATURITY_MIN_SESSIONS).toBe(12)
    expect(maturityOf(11)).toBe('early')
    expect(maturityOf(12)).toBe('established')
  })

  it('every mirrored shape CITES the file it mirrors — a mirror nobody can check is a guess', () => {
    for (const cite of ['personal-findings.ts:', 'staff-focus.ts:', 'category-scoring.ts:', 'categories.ts:', 'contract.ts:']) {
      expect({ cite, inPlane: PLANE.includes(cite) }).toEqual({ cite, inPlane: true })
    }
    for (const cite of ['personal-findings.ts:', 'staff-focus.ts:', 'categories.ts:', 'contract.ts:']) {
      expect({ cite, inLib: LIB_SRC.includes(cite) }).toEqual({ cite, inLib: true })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE VISIBILITY SPEC’s own §7 — the four mistakes, structurally not repeated', () => {
  const SPEC = read('docs/coaching/COACHING_VISIBILITY_MODEL.md')
  const LIB = LIB_CODE

  it('the spec really names four production violations — read from the doc, not restated', () => {
    const at = SPEC.indexOf('## 7. Production surfaces that already violate this')
    expect(at).toBeGreaterThan(-1)
    const seven = SPEC.slice(at, SPEC.indexOf('## 8.'))
    for (const name of ['StaffPerformanceTable', 'AssignModulesCard', 'showSource', 'role-context.tsx']) {
      expect({ name, named: seven.includes(name) }).toEqual({ name, named: true })
    }
  })

  it('§7-a EXACT NUMBERS TO AN OWNER — there is no field for one to travel in', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    // every digit in the whole owner payload, and where it lives
    const digits = JSON.stringify(props.team).match(/\d+/g) ?? []
    // the ONLY numbers are the four band counts, the two adoption integers, and
    // — since the look-fix round — the サポートエリア頻度 head-counts, which are
    // the SAME CLASS of fact as the band counts: how many staff, never which,
    // never how well. Every one of the three is an aggregate over the roster.
    const allowed = JSON.stringify([props.team!.counts, props.team!.adoptionLine, props.team!.focusRanking.rows])
      .match(/\d+/g) ?? []
    expect(digits.sort()).toEqual(allowed.sort())
    // …and the new one really is an aggregate: every value counts STAFF, and no
    // row can be tied to a person — the label is a category, never a name.
    const names = props.team!.rows.map((r) => r.staffLabel)
    for (const r of props.team!.focusRanking.rows) {
      expect({ label: r.label, value: r.value, endsWithPeople: /^\d+名$/.test(r.value) })
        .toEqual({ label: r.label, value: r.value, endsWithPeople: true })
      expect(names.some((n) => r.label.includes(n) || n.includes(r.label))).toBe(false)
    }
  })

  it('§7-b MODULE ASSIGNMENT IS DECOUPLED FROM CONSENT — the most anxious get help too', () => {
    // The phone's AssignModulesCard filtered `!isTopPerformer && consentGiven`,
    // so a staff member who DECLINED coaching was excluded from receiving help
    // modules — backwards. Here the help action is a function of the BAND and
    // the focus run's module id, and reads the grant NOWHERE.
    const declined = coachingStaff.map((r) => ({ ...r, grant: 'declined' as const }))
    const none = coachingStaff.map((r) => ({ ...r, grant: 'none' as const }))
    const roster = [{ id: 'p-04', name: 'x' }]
    const a = buildTriage({ roster, rows: declined, floor: FLOOR_DEFAULT })
    const b = buildTriage({ roster, rows: none, floor: FLOOR_DEFAULT })
    expect(a.rows[0].suggestedAction).not.toBeNull()
    expect(a.rows[0].suggestedAction).toEqual(b.rows[0].suggestedAction)
    // …and structurally: NOTHING about a grant, a consent or a share is in
    // `helpActionFor`'s parameter list. (It gained a third argument when the
    // peer-pairing arm went live; what matters is not the count but that the
    // grant is not among them, so the pin reads the list rather than a literal
    // signature that a legitimate change makes stale.)
    const params = /export function helpActionFor\(([\s\S]*?)\): HelpAction/.exec(LIB)
    expect(params).not.toBeNull()
    expect(params![1]).toContain('band: PerformanceBand | null')
    expect(params![1]).toContain('moduleId: string | null')
    expect(params![1]).not.toMatch(/grant|consent|shar|同意|共有/i)
  })

  it('§7-c THE PATTERN SOURCE IS NOT ROLE-HARDCODED — there is no source at all', async () => {
    // `showSource = role === 'owner'` was hardcoded rather than gated on the
    // source's own consent. contract.ts:176-183 removes the question: a
    // TeamPattern carries no name, no id of a performer, and no source field, so
    // no role can be wired to reveal one.
    for (const p of teamPatterns) expect(Object.keys(p)).not.toContain('sourceStaffName')
    pinClock(MID_MONTH)
    const owner = await coachingProps({ ...GINZA, world: { role: 'オーナー' } })
    const manager = await coachingProps(GINZA)
    unpinClock()
    expect(owner.props.self.kind).toBe('ready')
    if (owner.props.self.kind !== 'ready' || manager.props.self.kind !== 'ready') return
    // the same patterns, byte-identical, whoever is looking
    expect(JSON.stringify(owner.props.self.learnFromTop)).toBe(JSON.stringify(manager.props.self.learnFromTop))
    expect(SCREEN_CODE).not.toMatch(/showSource|sourceStaff/)
  })

  it('§7-d THE ROLE MODEL IS A CAPABILITY TIER, not a binary staff|owner', () => {
    // 店舗管理者 is a REAL tier with its own row, not an owner alias and not a
    // staff member — which is the thing `role-context.tsx`'s binary model could
    // not express.
    expect(accessFor('オーナー').viewTeam).toBe(true)
    expect(accessFor('店舗管理者').viewTeam).toBe(true)
    expect(accessFor('スタッフ').viewTeam).toBe(false)
    expect(LIB).toContain('export interface CoachingAccess {')
    expect(LIB).toContain('viewTeam: boolean')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE VISIBILITY SPEC’s persona rules', () => {
  it('L2 renders for BOTH the owner AND the 店舗管理者 — never owner-only', async () => {
    pinClock(MID_MONTH)
    const owner = await coachingProps({ ...GINZA, world: { role: 'オーナー' } })
    const manager = await coachingProps({ ...GINZA, world: { role: '店舗管理者' } })
    const staffMember = await coachingProps({ ...GINZA, world: { role: 'スタッフ', selfId: 'p-01' } })
    unpinClock()
    expect(owner.props.canViewTeam).toBe(true)
    expect(manager.props.canViewTeam).toBe(true)
    expect(staffMember.props.canViewTeam).toBe(false)
    // …and the board they get is the SAME board: the L2 layer is one artifact.
    expect(JSON.stringify(owner.props.team)).toBe(JSON.stringify(manager.props.team))
  })

  it('DECLINE-INVISIBILITY holds for BOTH personas, on the rendered payload', async () => {
    const declined = coachingStaff.map((r) => ({ ...r, grant: 'declined' as const }))
    const never = coachingStaff.map((r) => ({ ...r, grant: 'none' as const }))
    for (const role of ['オーナー', '店舗管理者']) {
      pinClock(MID_MONTH)
      const a = await coachingProps({ ...GINZA, world: { role, rows: declined } })
      const b = await coachingProps({ ...GINZA, world: { role, rows: never } })
      unpinClock()
      expect({ role, same: JSON.stringify(a.props.team!.rows) === JSON.stringify(b.props.team!.rows) })
        .toEqual({ role, same: true })
      // no marker of any kind, in either payload
      expect(JSON.stringify(a.props.team)).not.toMatch(/declin|拒否|未共有|共有なし/)
    }
  })

  it('THE OWNER IS NOT SPECIAL FOR L1 — their payload carries no colleague’s detail', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { role: 'オーナー' } })
    unpinClock()
    const payload = JSON.stringify(props)
    // Every OTHER staff member's finding headline, impact and verbatim quote —
    // hunted in the OWNER's whole payload, not just the board's.
    for (const row of coachingStaff.filter((r) => r.staffId !== 'p-06')) {
      for (const f of row.findingsRun.findings) {
        expect({ id: f.id, headline: payload.includes(f.headline) }).toEqual({ id: f.id, headline: false })
        expect({ id: f.id, impact: payload.includes(f.impact) }).toEqual({ id: f.id, impact: false })
        const q = f.evidence.verbatim_moment?.quote
        if (q) expect({ id: f.id, quote: payload.includes(q) }).toEqual({ id: f.id, quote: false })
      }
    }
    // …and adoption is ONE aggregate count, N of M.
    expect(props.team!.adoptionLine).toMatch(/^深い共有を許可しているスタッフ \d+名 \/ 在籍 \d+名$/)
  })

  it('the framing banner and the flagged rows are on the SAME screen', () => {
    // ⚖ §4 — 「every needs-support flag ships paired 1:1, SAME SCREEN, with a
    // help action」, under a banner saying the board is for deploying support.
    const panel = SCREEN_CODE.slice(SCREEN_CODE.indexOf('id="cgPanelTeam"'), SCREEN_CODE.indexOf('cg-foot'))
    expect(panel).toContain('cg-framing-line')
    expect(panel).toContain('cg-rows')
    expect(panel).toContain('props.helpRefusals[r.action.kind]')
  })

  it('the sample floor renders as a BUILDING-DATA state, never as a bucket', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const building = props.team!.rows.filter((r) => r.band === null)
    expect(building.length).toBeGreaterThan(0)
    for (const r of building) {
      expect(r.bandLabel).toBe('まだ判断できません')
      expect(r.bandTone).toBe('cg-band-building')
      // not a bucket: no band, no focus sentence, no action, no number
      expect(r.focusAreas).toEqual([])
      expect(r.action).toBeNull()
      expect(r.trajectoryLine).not.toMatch(/\d/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE RUN’S OWN STATUS DECIDES WHAT THE FINDINGS PANEL SHOWS', () => {
  it('a capture_gap window says it is a RECORDER problem, and shows no findings', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { selfId: 'p-05' } })
    unpinClock()
    expect(props.self.kind).toBe('ready')
    if (props.self.kind !== 'ready') return
    expect(props.self.status).toBe('capture_gap')
    expect(props.self.findings).toEqual([])
    expect(props.self.statusTitle).toContain('会話の記録')
    expect(props.self.statusBody).toContain('接客の問題ではなく')
  })

  it('a routine_excellence window is reported with its real numbers, never as a nitpick', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { selfId: 'p-01' } })
    unpinClock()
    if (props.self.kind !== 'ready') throw new Error('expected ready')
    expect(props.self.status).toBe('routine_excellence')
    expect(props.self.runHeadline).toContain('41回')
    expect(props.self.findings).toEqual([])
  })

  it('the SCREEN gates on the status, not merely on an empty array', () => {
    // ⚠ `findings.length > 0` ALONE IS NOT THE GATE. A run can report
    // `capture_gap` and still, one day, carry a stray item; the status is the
    // run's own verdict on whether this window MEANS anything, and the panel
    // reads it (mutant M29 removed the status half and survived until this pin).
    expect(SCREEN_CODE).toContain("ready.status === 'findings' && ready.findings.length > 0")
  })

  it('the session count has ONE home — the run’s own window', () => {
    expect(LIB_CODE).toContain('return row.findingsRun.sessions_reviewed')
    // nothing else in the room reads a second session number off a row
    expect(LIB_CODE).not.toMatch(/row!?\.sessions\b/)
    expect(stripComments(readFileSync(join(process.cwd(), 'src/business/lib/fixtures-coaching.ts'), 'utf8')))
      .not.toMatch(/^\s{2}sessions: number/m)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// FIX ROUND 1 — the truths this round added. Each one is a finding from the
// blind round, and each has a mutant in the battery.
// ═══════════════════════════════════════════════════════════════════════════

describe('⚖ D8-1 — the staff member’s OWN share state is READ, never assumed', () => {
  it('the state, the body and the button all resolve from the viewer’s own grant', async () => {
    pinClock(MID_MONTH)
    const granted = await coachingProps({ ...GINZA, world: { selfId: 'p-01' } }) // plane says 'granted'
    const never = await coachingProps(GINZA) // p-06, plane says 'none'
    const declined = await coachingProps({ ...GINZA, world: { selfId: 'p-04' } }) // plane says 'declined'
    unpinClock()
    if (granted.props.self.kind !== 'ready' || never.props.self.kind !== 'ready' || declined.props.self.kind !== 'ready') {
      throw new Error('expected ready')
    }
    expect(granted.props.self.share.stateLine).toContain('現在オン')
    expect(granted.props.self.share.buttonLabel).toBe('共有をやめる')
    expect(never.props.self.share.stateLine).toContain('現在オフ')
    expect(never.props.self.share.buttonLabel).toBe('共有をオンにする')
    // ⚖ ANTI-COERCION, ON THE PERSON'S OWN SCREEN TOO: 'declined' and 'none'
    // are one state here, because the question this section answers is 「is my
    // detail shared」 and the honest answer is no either way.
    expect(declined.props.self.share).toEqual(never.props.self.share)
    // …and the ON copy does not describe an OFF switch.
    expect(granted.props.self.share.body).toContain('取り消せます')
    expect(granted.props.self.share.body).not.toContain('共有をオンにすると')
  })

  it('⚖ A8 — ONE truth for one question: the screens that say ON equal the owner’s count', async () => {
    // The defect this pin exists for: the state sentence was HARDCODED off, so
    // a staff member whose plane row says `granted` was told their detail was
    // shared with nobody while `adoptionLine` in the same payload counted them
    // among 深い共有を許可しているスタッフ.
    pinClock(MID_MONTH)
    const owner = await coachingProps(GINZA)
    const counted = Number(/許可しているスタッフ (\d+)名/.exec(owner.props.team!.adoptionLine)![1])
    let saidOn = 0
    for (const r of coachingStaff) {
      const view = await coachingProps({ ...GINZA, world: { selfId: r.staffId } })
      if (view.props.self.kind === 'ready' && view.props.self.share.stateLine.startsWith('現在オン')) saidOn += 1
    }
    unpinClock()
    expect({ counted, saidOn }).toEqual({ counted: 1, saidOn: 1 })
  })

  it('the grant reaches the self view by the same LOOKUP the rest of it uses', () => {
    const mine = buildSelfView({ selfId: 'p-01', rows: coachingStaff, patterns: teamPatterns })
    const theirs = buildSelfView({ selfId: 'p-06', rows: coachingStaff, patterns: teamPatterns })
    expect(mine.kind).toBe('ready')
    if (mine.kind !== 'ready' || theirs.kind !== 'ready') return
    expect(mine.view.grant).toBe('granted')
    expect(theirs.view.grant).toBe('none')
    // and NOT from the roster — a colleague's grant is not on this model at all
    expect(JSON.stringify(mine.view)).not.toMatch(/declined/)
  })
})

describe('⚖ D8-2 — the L2 leak guard, the check staff-focus.ts calls THIS app’s job', () => {
  const ROSTER = [{ id: 'p-04', name: '見本 しろう' }]
  const NEEDLES = ['見本 しろう', '見本', 'しろう']
  const withSummary = (text: string) =>
    coachingStaff.map((r) =>
      r.staffId === 'p-04'
        ? { ...r, focus: { ...r.focus, focus_areas: r.focus.focus_areas.map((f) => ({ ...f, summary_text: text })) } }
        : r,
    )
  const built = (text: string) => buildTriage({ roster: ROSTER, rows: withSummary(text), floor: FLOOR_DEFAULT }).rows[0]

  it('a DIGIT-FREE quantity — the 三割 class the module names — is OMITTED, not printed', () => {
    // staff-focus.ts:12-24: 「三割 / 半分 / 二回 are numbers with zero ASCII
    // digits」, which is exactly why a shape-match is not a guard.
    for (const text of ['成約率が三割まで落ちています。', '半分のセッションで同じ場面が出ています。', '二回に一回は保留で終わっています。']) {
      const row = built(text)
      expect({ text, printed: row.focusAreas.length, checks: row.summaryChecks }).toEqual({ text, printed: 0, checks: false })
    }
  })

  it('an ASCII or full-width digit is caught as well', () => {
    for (const text of ['成約率が30%まで落ちています。', '成約率が３０％まで落ちています。']) {
      expect(built(text).focusAreas).toEqual([])
    }
  })

  it('a roster NAME — full, or just the given name — never reaches the board', () => {
    for (const text of ['見本 しろうさんは締めくくりが弱い傾向です。', 'しろうさんは締めくくりが弱い傾向です。']) {
      const row = built(text)
      expect({ text, printed: row.focusAreas.length }).toEqual({ text, printed: 0 })
    }
    // …including THIS staff member's own name, which staff-focus.ts names
    // explicitly, and a colleague's, which is the worse half.
    expect(summaryLeaks('あずさのやり方に近づけると変わります。', ['見本 あずさ', '見本', 'あずさ'])).toBe(true)
  })

  it('the guard is a QUANTITY rule, not a character rule — 一緒に is not a number', () => {
    // A bare `[一二三…]` class would drop this plane's OWN honest sentences and
    // call it safety. Two of them carry 一緒に.
    expect(summaryLeaks('会話の締めくくり方を一緒に整えると、変化が出やすい時期です。', NEEDLES)).toBe(false)
    expect(summaryLeaks('成約率が三割まで落ちています。', [])).toBe(true)
  })

  it('every sentence THIS PLANE actually states passes — the guard is not a blanket', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const printed = props.team!.rows.flatMap((r) => r.focusAreas)
    // the board really is printing sentences, or the pin below proves nothing
    expect(printed.length).toBeGreaterThanOrEqual(3)
    for (const r of props.team!.rows) {
      expect({ staff: r.staffLabel, withheld: r.summaryWarning }).toEqual({ staff: r.staffLabel, withheld: null })
    }
  })

  it('an omission is SAID OUT LOUD, exactly as a short count is', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { rows: withSummary('成約率が三割まで落ちています。') } })
    unpinClock()
    const flagged = props.team!.rows.filter((r) => r.summaryWarning !== null)
    expect(flagged.length).toBeGreaterThanOrEqual(1)
    expect(flagged[0].summaryWarning).toContain('表示していません')
    // …and the sentence the guard withheld is nowhere in the owner's payload
    expect(JSON.stringify(props.team)).not.toContain('三割')
    // …and it carries no digit of its own, so §7-a still holds
    expect(flagged[0].summaryWarning).not.toMatch(/\d/)
  })

  it('the guard sits in the LIB, above the serializer, like every other redaction', () => {
    expect(LIB_CODE).toContain('const safe = areas.filter((f) => !summaryLeaks(f.summaryText, needles))')
    expect(LIB_CODE).toContain('summaryChecks: safe.length === areas.length')
    // the module's own remedy, cited where it is obeyed
    expect(LIB_SRC).toContain('staff-focus.ts:144-145')
  })
})

describe('⚖ D8-3 — the tour describes the PAYLOAD, and nothing the shape cannot keep', () => {
  it('the 上位層から学ぶ text promises no permission gate, because there is none', () => {
    const learn = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('data-guide-title="上位層から学ぶ"'),
      SCREEN_CODE.indexOf('data-guide-title="マネージャーへの共有"'),
    )
    expect(learn).toContain('誰のやり方かは分かりません')
    expect(learn).not.toContain('許可したものだけ')
    // …because a TeamPattern carries no consent, opt-in or permission field at
    // all — in this room's plane or in the contract it mirrors.
    for (const p of teamPatterns) {
      expect(Object.keys(p).sort()).toEqual(['adoptionNote', 'behavior', 'categoryKey', 'id'])
    }
    const contract = read('src/lib/karute/coaching/contract.ts')
    const shape = contract.slice(contract.indexOf('export interface TeamPattern'), contract.indexOf('}', contract.indexOf('export interface TeamPattern')))
    expect(shape).not.toMatch(/consent|permission|optIn|opt_in|granted/i)
  })
})

describe('⚖ D8-4 — all THREE help actions are reachable; none is a dead lever', () => {
  it('the third arm exists, and the band still decides whether there is one at all', () => {
    expect(helpActionFor('needs-support', 'mod-1')!.kind).toBe('assign-module')
    expect(helpActionFor('needs-support', null, true)!.kind).toBe('peer-pairing')
    expect(helpActionFor('needs-support', null, false)!.kind).toBe('manager-coaching')
    for (const band of ['growing', 'steady', null] as const) {
      expect({ band, action: helpActionFor(band, null, true) }).toEqual({ band, action: null })
    }
    // every kind carries its own label and its own refusal, all distinct
    const kinds = ['assign-module', 'manager-coaching', 'peer-pairing'] as const
    const labels = [
      helpActionFor('needs-support', 'mod-1')!.label,
      helpActionFor('needs-support', null, false)!.label,
      helpActionFor('needs-support', null, true)!.label,
    ]
    expect(new Set(labels).size).toBe(3)
    expect(new Set(kinds.map((k) => HELP_REFUSAL[k])).size).toBe(3)
  })

  it('the BOARD really routes it — a flagged staff member with no module of their own gets the pair', () => {
    const rows = coachingStaff.map((r) =>
      r.staffId === 'p-04'
        ? {
            ...r,
            focus: {
              ...r.focus,
              focus_recommendations: [{ ...r.focus.focus_recommendations[0], module_id: null, category: 'acknowledgment' }],
            },
          }
        : r,
    )
    const view = buildTriage({
      roster: [{ id: 'p-04', name: '見本 しろう' }],
      rows,
      floor: FLOOR_DEFAULT,
      patternCategories: teamPatterns.map((p) => p.categoryKey),
    })
    expect(view.rows[0].suggestedAction).toEqual({ kind: 'peer-pairing', label: 'ペアを組んで学ぶ', moduleId: null })
    // …and with no pattern behind that category, the same staff member gets a
    // person instead — the peer arm is a real branch, not a constant.
    const alone = buildTriage({ roster: [{ id: 'p-04', name: '見本 しろう' }], rows, floor: FLOOR_DEFAULT, patternCategories: [] })
    expect(alone.rows[0].suggestedAction!.kind).toBe('manager-coaching')
  })

  it('what the board is told about the patterns is CATEGORY KEYS and nothing else', () => {
    // The pattern plane is anonymous by construction; the board only needs to
    // know whether anybody is behind the third action, never who.
    expect(stripComments(PROPS_SRC)).toContain('patternCategories: teamPatterns.map((p) => p.categoryKey)')
    expect(LIB_CODE).toContain('patternCategories?: string[]')
  })
})

describe('⚖ FIX ROUND 1 — the design corrections, pinned in the sheet and the screen', () => {
  /** The four container blocks, each isolated to itself. `.cg-side` + the head
   *  recompose at 700 and `.cg-cols` at 880; the BOARD ROW has its own pair of
   *  blocks lower down — reading one when you mean the other is how a pin ends
   *  up green for the wrong reason.
   *
   *  ⚠ RESOLVED INSIDE EACH TEST, NEVER AT COLLECTION TIME. A `throw` in a
   *  describe body takes the whole FILE down, which turns a mutant that ought to
   *  be caught by one named assertion into a crash — and ⚖ HARNESS-TRUTH rider 3
   *  is that a crash proves DETECTION, not discrimination. */
  const nth = (at: number, i: number) => {
    const found = [...CSS_CODE.matchAll(/@container cg-page \(min-width: (\d+)px\) \{[\s\S]*?\n\}/g)]
      .filter((m) => Number(m[1]) === at)
      .map((m) => m[0])
    expect({ at, blocks: found.length }).toEqual({ at, blocks: 2 })
    return found[i] ?? ''
  }

  it('D8-2D · a finding states its count ONCE, as the receipt’s arithmetic', () => {
    const card = SCREEN_CODE.slice(SCREEN_CODE.indexOf('cg-find-head'), SCREEN_CODE.indexOf('cg-find-caveat'))
    // the count is no longer the paragraph immediately under the impact
    // sentence whose numbers it restates — it sits with the quoted moment
    expect(card.indexOf('cg-find-count')).toBeGreaterThan(card.indexOf('cg-find-fix'))
    expect(card.indexOf('cg-find-count')).toBeLessThan(card.indexOf('cg-quote'))
    expect(card).toContain('<b>該当した回数</b>')
    // …and the generator's own `comparison` is still what it prints — the room
    // composes no sentence a generator owns
    expect(LIB_CODE).toContain('countLabel: f.evidence.comparison ?? `${f.evidence.count_total}回`')
  })

  it('D8-2E · the head’s own action is PLACED by the sheet, never pushed between title and sentence', () => {
    expect(SCREEN_CODE).not.toContain('cg-spacer')
    expect(CSS_CODE).not.toContain('cg-spacer')
    const head = SCREEN_CODE.slice(SCREEN_CODE.indexOf('<header'), SCREEN_CODE.indexOf('</header>'))
    expect(head.indexOf('cg-settings')).toBeGreaterThan(head.indexOf('cg-sub'))
    expect(head.indexOf('cg-settings')).toBeGreaterThan(head.indexOf('cg-window'))
    // STACKED is the base — under the sentence, full width — and the title-line
    // placement is a CONTAINER rule like every other shape in this room, never
    // a viewport band that could disagree with the container.
    expect(CSS_CODE).toContain('.cg-head { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px;')
    expect(CSS_CODE).toContain('.cg-settings { grid-column: 1; justify-self: stretch; margin-top: 4px; }')
    const sideFold = nth(700, 0)
    expect(sideFold).toContain('.cg-head { grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; }')
    expect(sideFold).toContain('.cg-settings { grid-column: 2; grid-row: 2; justify-self: end; margin-top: 0; }')
  })

  it('D8-2F · the fold band never orphans a card in a half-empty row', () => {
    // the count is read off the DOM, so no number here can go stale
    expect(nth(700, 0)).toContain('.cg-side > *:last-child:nth-child(odd) { grid-column: 1 / -1; }')
  })

  it('D8-2G · the desk board row reserves no empty action track', () => {
    const boardDesk = nth(880, 1)
    expect(boardDesk).toContain('grid-template-columns: minmax(110px, 168px) minmax(110px, max-content) minmax(0, 1fr);')
    // …so the sentence column ends at the same edge on every row, and the
    // action keeps the placement the FOLD band gives it — under its own row
    expect(boardDesk).not.toContain('.cg-row-act')
    expect(nth(700, 1)).toContain('.cg-row-act { grid-column: 3; justify-self: start; }')
  })

  it('D8-2H · the sheet’s own accent sentence is TRUE — it names the one data mark', () => {
    const header = CSS_SRC.slice(0, CSS_SRC.indexOf('/* ── the fence'))
    expect(header).toContain('.cg-bar:last-child')
    expect(header).toContain('chart/data')
    // and the paint it names really is there
    expect(CSS_CODE).toContain('.cg-bar:last-child .cg-bar-fill { background: var(--cg-accent); }')
  })

  it('D8-2M · no row pairs a BAND with a sentence saying there is not enough to judge', async () => {
    // ⚖ demo data = product truth. 見本 ごろう read 安定 beside 「まだ判断材料が
    // 足りません」 — coherent inside the model, a contradiction on a 3-second
    // read. The room's ONE 「we cannot judge」 sentence is the band-less row's.
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const banded = props.team!.rows.filter((r) => r.band !== null)
    expect(banded.length).toBeGreaterThanOrEqual(3)
    for (const r of banded) {
      for (const f of r.focusAreas) {
        for (const phrase of ['判断材料が足りません', 'まだ判断できません', '判断できる数に届いて']) {
          expect({ staff: r.staffLabel, phrase, says: f.summaryText.includes(phrase) })
            .toEqual({ staff: r.staffLabel, phrase, says: false })
        }
      }
    }
    // …and the band-less row still says exactly that, in its own words
    const building = props.team!.rows.filter((r) => r.band === null)
    expect(building.length).toBeGreaterThan(0)
    expect(building[0].trajectoryLine).toContain('判断できる数に届いていません')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// LOOK-FIX ROUND — the surfaces the 9/1 coverage audit found missing.
//
// EVERY NEW SHAPE JOINS THE MACHINE FIDELITY GATE. The rule the build round set
// is unchanged: these pins do not RESTATE a schema, they PARSE it off disk, so a
// change to a prompt module or to `contract.ts` goes red here rather than in
// somebody's browser six months from now.
// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ SHAPE FIDELITY — the look-fix round’s new shapes, parsed not restated', () => {
  const P = 'src/lib/karute/coaching/prompts'
  const PATTERNS_PROMPT = read(`${P}/top-performer-patterns.ts`)
  const MODULE_PROMPT = read(`${P}/learning-module.ts`)
  const CONTRACT = read('src/lib/karute/coaching/contract.ts')
  const EFFECTIVENESS = read('src/lib/karute/coaching/effectiveness.ts')
  const CONSENT_TYPES = read('src/lib/coaching-consent/types.ts')
  const DEV_PREVIEW = read('src/lib/coaching-dev-preview/hooks.ts')
  const CATEGORIES_FILE = read('src/components/coaching/redesign/pattern-categories.ts')
  const JA = JSON.parse(read('messages/ja.json')) as { coaching: Record<string, never> }
  const PLANE = readFileSync(join(process.cwd(), 'src/business/lib/fixtures-coaching.ts'), 'utf8')

  const requiredAfter = (src: string, anchor: string): string[] => {
    const at = src.indexOf(anchor)
    expect({ anchor, found: at >= 0 }).toEqual({ anchor, found: true })
    const m = /required:\s*\[([^\]]*)\]/.exec(src.slice(at))
    if (!m) throw new Error(`no required[] after ${anchor}`)
    return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort()
  }
  const fieldsOf = (src: string, name: string): string[] => {
    const at = src.indexOf(`export interface ${name} {`)
    expect({ name, found: at >= 0 }).toEqual({ name, found: true })
    const body = src.slice(at + `export interface ${name} {`.length, src.indexOf('\n}', at))
    return [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^ {2,}([a-zA-Z_][\w]*)\??:/gm)].map((m) => m[1]).sort()
  }

  it('the ROI’s raw input mirrors effectiveness.ts’s own HorizonInput', () => {
    expect(fieldsOf(PLANE, 'FixtureHorizonInput')).toEqual(fieldsOf(EFFECTIVENESS, 'HorizonInput'))
    // …and the four legal horizons are the module's own list, not this room's.
    const horizons = /export const HORIZONS = \[([^\]]*)\]/.exec(EFFECTIVENESS)![1]
      .split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
    expect(horizons).toEqual([30, 90, 180, 365])
    expect(Object.keys(HORIZON_WEIGHTS).map(Number).sort((a, b) => a - b)).toEqual(horizons)
    for (const h of horizons) {
      const w = new RegExp(`\\n\\s+${h}: ([\\d.]+),`).exec(EFFECTIVENESS)
      expect({ h, weight: HORIZON_WEIGHTS[h] }).toEqual({ h, weight: Number(w![1]) })
    }
    expect(SHRINK_K).toBe(Number(/export const SHRINK_K = (\d+)/.exec(EFFECTIVENESS)![1]))
  })

  it('the DiD arithmetic is effectiveness.ts’s own three functions, mirrored', () => {
    // C1 — the subtraction, and it really subtracts.
    expect(EFFECTIVENESS).toContain('return input.treatedDelta - input.controlDelta')
    expect(horizonEffect({ treatedDelta: 0.09, controlDelta: 0.02 })).toBeCloseTo(0.07, 10)
    // C3 — shrinkage, including its n=0 collapse to the prior.
    expect(EFFECTIVENESS).toContain('return (n * rawScore + k * priorMean) / (n + k)')
    expect(shrink(1, 0, 0.4)).toBe(0.4)
    expect(shrink(0.07, 22, 0)).toBeCloseTo((22 * 0.07) / 34, 10)
    // the confidence ladder, value for value
    expect(EFFECTIVENESS).toContain("if (used.includes(180) || used.includes(365)) return 'mature'")
    expect(confidenceFor([])).toBe('none')
    expect(confidenceFor([30])).toBe('early')
    expect(confidenceFor([30, 90])).toBe('building')
    expect(confidenceFor([30, 90, 180])).toBe('mature')
    expect(confidenceFor([365])).toBe('mature')
  })

  it('the ROI view mirrors contract.ts’s StoreCoachingRoi and StoreMetricLift', () => {
    expect(CONTRACT).toContain('export interface StoreCoachingRoi {')
    expect(CONTRACT).toContain('export interface StoreMetricLift {')
    // contract.ts:277 — the confidence enum the CHIP is drawn from.
    expect(CONTRACT).toContain("confidence: 'early' | 'building' | 'mature'")
    const view = buildRoi({ roi: storeRoi[STORE_A] })!
    expect(Object.keys(view).sort()).toEqual([
      'coachingStartFraction', 'control', 'headline', 'lifts', 'monthlyValueEstimate', 'scope', 'sinceMonths', 'treated',
    ])
    // ⚠ STORE AGGREGATE ONLY (contract.ts:284-286) — there is no staff field
    // anywhere in the shape, so no individual can reach the selling screen.
    expect(JSON.stringify(view)).not.toMatch(/staff|Staff|名前|name/)
    for (const l of view.lifts) {
      expect(Object.keys(l).sort()).toEqual(['after', 'before', 'confidence', 'horizonsUsed', 'key', 'lift', 'unit'])
    }
    // the money amount is a MoneyAmount, never a bare JPY number.
    expect(Object.keys(view.monthlyValueEstimate!).sort()).toEqual(['amount', 'currency'])
    // ⚠ THE LIFTS ARE THE PLANE'S OWN METRICS, ONE EACH — no extra row, no
    // duplicate key, and nothing a mis-wiring could append. Mutant M38 pushed a
    // second closingRate row onto the list and every field-shape pin stayed
    // green, because a well-shaped extra row is still well-shaped.
    expect(view.lifts.map((l) => l.key)).toEqual(storeRoi[STORE_A].lifts.map((l) => l.key))
    expect(new Set(view.lifts.map((l) => l.key)).size).toBe(view.lifts.length)
    for (const l of view.lifts) expect(['closingRate', 'rebookingRate', 'avgRevenue', 'satisfaction']).toContain(l.key)
    // …and the hero is one OF them, never a row of its own.
    expect(view.lifts).toContain(view.headline)
  })

  it('the pattern mirrors top-performer-patterns.ts’s own patterns[] item — minus the name it must never carry', () => {
    const required = requiredAfter(PATTERNS_PROMPT, "required: ['category', 'title'")
    expect(fieldsOf(PLANE, 'FixtureTopPattern')).toEqual(required)
    expect(fieldsOf(PLANE, 'FixturePatternEvidence')).toEqual(requiredAfter(PATTERNS_PROMPT, "required: ['presentInTopPerformers'"))
    // ⚠ THE ABSENCE IS THE GUARANTEE (COACHING_VISIBILITY_MODEL:123 flags the
    // phone's `showSource = role === 'owner'`): there is no field for a source
    // name in the plane, in the model, in the props or on the screen — so no
    // role check can switch one on.
    // ⚠ MEASURED ON THE CODE, NOT THE PROSE. Each of these files EXPLAINS why
    // the field is absent, and a raw grep would flag the explanation — the same
    // trap the SPINE pin's `revisit` check already documents.
    const code = (src: string) => stripComments(src).replace(/^\s*\/\/.*$/gm, '')
    for (const [name, src] of [['plane', PLANE], ['lib', LIB_SRC], ['props', PROPS_SRC], ['screen', SCREEN_SRC]] as const) {
      expect({ name, hasSource: /sourceStaffName|showSource/.test(code(src)) }).toEqual({ name, hasSource: false })
    }
  })

  it('the five shelves are pattern-categories.ts’s production taxonomy, in its own order', () => {
    const declared = /export const PATTERN_CATEGORIES: readonly PatternCategory\[\] = \[([\s\S]*?)\]/.exec(CATEGORIES_FILE)![1]
      .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)
    expect([...PATTERN_CATEGORIES]).toEqual(declared)
    // …and the shelf titles + descriptions are ja.json's own words, not a
    // translation this room wrote.
    const cats = (JA.coaching as unknown as { patterns: { categories: Record<string, { title: string; description: string }> } }).patterns.categories
    for (const key of PATTERN_CATEGORIES) {
      expect({ key, ...PATTERN_SHELF[key] }).toEqual({ key, title: cats[key].title, description: cats[key].description })
    }
    // EVERY shelf renders, empty or not — the phone's own deliberate choice.
    const shelves = buildPatternLibrary(patternLibrary)
    expect(shelves.map((s) => s.key)).toEqual(declared)
    expect(shelves.some((s) => s.entries.length === 0)).toBe(true)
    // …and the evidence FRACTION never survives into a rendered entry.
    for (const s of shelves) {
      for (const e of s.entries) {
        expect(Object.keys(e).sort()).toEqual(['adoptionNote', 'behavior', 'confidenceNote', 'example', 'title', 'transferability'])
        expect(e.adoptionNote).not.toMatch(/\d/)
      }
    }
  })

  it('the module mirrors learning-module.ts’s generated module, plus the ONE id the storage layer owns', () => {
    const required = requiredAfter(MODULE_PROMPT, "required: ['title', 'description'")
    expect(fieldsOf(PLANE, 'FixtureLearningModule')).toEqual([...required, 'moduleId'].sort())
    expect(fieldsOf(PLANE, 'FixtureModuleStep')).toEqual(requiredAfter(MODULE_PROMPT, "required: ['step', 'title', 'detail']"))
    // the four evidenceBasis values, read off the schema's own enum
    const basis = /evidenceBasis: \{[\s\S]*?enum: \[([^\]]*)\]/.exec(MODULE_PROMPT)![1]
      .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort()
    expect(Object.keys(MODULE_BASIS).sort()).toEqual(basis)
    // ⚠ NO ASSIGNMENT STATE ANYWHERE — that is a write, and it stays the board's
    // refused help action. `owner-types.ts:73-82` carries assigned/assignedTo/
    // completionRate; this plane deliberately carries none of them.
    const card = buildModuleLibrary(learningModules, ['mod-ack-01'])
    for (const c of card) {
      expect(Object.keys(c).sort()).toEqual(['basisLabel', 'description', 'durationLabel', 'isMine', 'moduleId', 'steps', 'title'])
    }
    expect(/assigned|completionRate|consentGiven/.test(stripComments(PLANE).replace(/^\s*\/\/.*$/gm, ''))).toBe(false)
    // …and the two ids the run already pointed at really resolve now (audit #81).
    const ids = new Set(learningModules.map((m) => m.moduleId))
    for (const row of coachingStaff) {
      for (const f of row.findingsRun.findings) if (f.linked_module_id) expect(ids.has(f.linked_module_id)).toBe(true)
      for (const f of row.focus.focus_recommendations) if (f.module_id) expect(ids.has(f.module_id)).toBe(true)
    }
  })

  it('the consent record mirrors coaching-consent/types.ts, three states and all', () => {
    expect(fieldsOf(PLANE, 'FixtureConsentRecord')).toEqual(fieldsOf(CONSENT_TYPES, 'CoachingConsentRecord'))
    const statuses = /export type CoachingConsentStatus = ([^\n]*)/.exec(CONSENT_TYPES)![1]
      .split('|').map((x) => x.trim().replace(/'/g, '')).sort()
    expect(statuses).toEqual(['declined', 'granted', 'unset'])
    // every state has its own designed sentence — none falls back to another's
    for (const s of statuses) expect(Object.keys(CONSENT_STATE)).toContain(s)
    const bodies = Object.values(CONSENT_STATE).map((c) => c.body)
    expect(new Set(bodies).size).toBe(3)
    // ⚠ AND THE PLANE REACHES ALL THREE, so the walk crosses every state.
    expect(new Set(Object.values(coachingConsent).map((c) => c.status)).size).toBe(3)
  })

  it('⚖ VL-1 — the declined-consent state does what its own card SAYS: nothing generated renders below it', () => {
    // COACHING_VISIBILITY_MODEL.md:32 — consent to be coached 「gates whether
    // ANY L1 artifact is generated at all. If off, there is nothing to share」.
    // `CONSENT_STATE.declined.body` already tells the reader so on this exact
    // screen; this pin is the source fact that keeps that sentence true —
    // everything from the metric spine through the module catalog sits behind
    // it, and the consent card itself sits ABOVE the gate so it always renders.
    const consentAt = SCREEN_CODE.indexOf('className={`cg-consent')
    const gate = "ready.consent.status !== 'declined' && ("
    const gateAt = SCREEN_CODE.indexOf(gate)
    const spineAt = SCREEN_CODE.indexOf('className="cg-spine"')
    const modulesAt = SCREEN_CODE.indexOf('className="cg-modules"')
    const gateCloseAt = SCREEN_CODE.indexOf('</>', modulesAt)
    for (const at of [consentAt, gateAt, spineAt, modulesAt, gateCloseAt]) expect(at).toBeGreaterThan(-1)
    expect(consentAt).toBeLessThan(gateAt)
    expect(gateAt).toBeLessThan(spineAt)
    expect(spineAt).toBeLessThan(modulesAt)
    expect(modulesAt).toBeLessThan(gateCloseAt)
  })

  it('every new mirrored shape CITES the file it mirrors', () => {
    for (const cite of ['effectiveness.ts:', 'top-performer-patterns.ts:', 'learning-module.ts:', 'coaching-consent/types.ts:']) {
      expect({ cite, inPlane: PLANE.includes(cite) }).toEqual({ cite, inPlane: true })
    }
    for (const cite of ['effectiveness.ts:', 'top-performer-patterns.ts:', 'learning-module.ts:', 'pattern-categories.ts:']) {
      expect({ cite, inLib: LIB_SRC.includes(cite) }).toEqual({ cite, inLib: true })
    }
  })

  it('the role preview mirrors coaching-dev-preview’s own gate, three ways', () => {
    // the env gate, value for value
    expect(DEV_PREVIEW).toContain("process.env.NODE_ENV === 'development'")
    expect(DEV_PREVIEW).toContain("process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW === 'true'")
    expect(LIB_SRC).toContain("process.env.NODE_ENV === 'development'")
    expect(LIB_SRC).toContain("process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW === 'true'")
    // ⚠ THE THREE ROLES ARE THE ACCESS TABLE'S OWN KEYS, derived rather than
    // restated: a preview offering a role the table does not know is not a value
    // this room can build.
    expect(PREVIEW_ROLES).toEqual(['オーナー', '店舗管理者', 'スタッフ'])
    const table = /const ACCESS_BY_ROLE: Record<string, CoachingAccess> = \{([\s\S]*?)\n\}/.exec(LIB_SRC)![1]
    expect([...table.matchAll(/^\s*([^\s:]+):/gm)].map((m) => m[1])).toEqual([...PREVIEW_ROLES])
    // …and every offered role is a role the table really knows, so the preview
    // cannot render a persona that falls through to NO_ACCESS by accident.
    // ⚠ THREE DISTINCT OUTCOMES, which is what makes this a three-way preview
    // rather than a two-way one with a decorative third chip.
    const known = PREVIEW_ROLES.map((r) => JSON.stringify(accessFor(r)))
    expect(new Set(known).size).toBe(3)
    expect(accessFor('オーナー')).toEqual({ viewTeam: true, viewRoi: true })
    expect(accessFor('店舗管理者')).toEqual({ viewTeam: true, viewRoi: false })
    expect(accessFor('スタッフ')).toEqual({ viewTeam: false, viewRoi: false })
    expect(accessFor('constructor')).toEqual({ viewTeam: false, viewRoi: false })
    // fail-closed on the GATE, on the REAL (untouched) test env: NODE_ENV is
    // 'test' and the flag is unset here, so the gate is OFF and a legal
    // override must still be ignored (M44 — the ?as= override honoured with
    // the preview gate off).
    expect(effectiveRole('スタッフ', 'オーナー')).toBe('スタッフ')
    // fail-closed on the VALUE as well as on the gate (hooks.ts:88-95).
    // ⚖ VL-2 — pinned with the gate FORCED ON. With the gate left alone (as
    // just proven above), `effectiveRole` returns at its FIRST line
    // (`!isRolePreviewEnabled()`) and never reaches the value check below —
    // every assertion here would pass just as well with that check deleted.
    // Forcing the gate on is what makes this pin exercise the line it claims to.
    const ORIGINAL_FLAG = process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW = 'true'
    try {
      expect(effectiveRole('スタッフ', 'constructor')).toBe('スタッフ')
      expect(effectiveRole('スタッフ', '__proto__')).toBe('スタッフ')
      expect(effectiveRole('スタッフ', undefined)).toBe('スタッフ')
      // …and a LEGAL override, under the same forced-on gate, really does swap.
      expect(effectiveRole('スタッフ', 'オーナー')).toBe('オーナー')
    } finally {
      process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW = ORIGINAL_FLAG
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE WALL HOLDS UNDER EVERY PERSONA — the role preview walked, per role', () => {
  /** The three personas the preview offers, and what each may reach. Written as
   *  DATA so the walk cannot quietly skip one: every persona in `PREVIEW_ROLES`
   *  must appear here or the last case in this block fails. */
  const EXPECTED: Record<string, { team: boolean; roi: boolean }> = {
    オーナー: { team: true, roi: true },
    店舗管理者: { team: true, roi: false },
    スタッフ: { team: false, roi: false },
  }

  it('the walk covers every role the preview offers — no persona goes unpinned', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PREVIEW_ROLES].sort())
  })

  for (const [role, can] of Object.entries(EXPECTED)) {
    it(`${role}: the payload carries exactly what the capability allows, and NOTHING a wall forbids`, async () => {
      pinClock(MID_MONTH)
      const { props } = await coachingProps({ ...GINZA, world: { role } })
      unpinClock()

      // (1) the two capability gates, on the payload rather than on a class name
      expect({ role, team: props.team !== null }).toEqual({ role, team: can.team })
      expect({ role, roi: props.roi !== null }).toEqual({ role, roi: can.roi })
      expect({ role, canViewTeam: props.canViewTeam }).toEqual({ role, canViewTeam: can.team })
      expect({ role, canViewRoi: props.canViewRoi }).toEqual({ role, canViewRoi: can.roi })

      // (2) L1 IS ALWAYS THE VIEWER'S OWN — the verbatim quote, the consent
      // record and the strengths are the SAME on every persona, because they
      // are read by a lookup on the viewer's own id and a role cannot widen it.
      const self = props.self as Extract<CoachingSelf, { kind: 'ready' }>
      expect(self.kind).toBe('ready')
      expect(self.consent.status).toBe('granted')

      // (3) NO PER-STAFF NUMBER ANYWHERE THE ROLE CAN SEE. The board's digits
      // are already pinned in §7-a; this is the ROI screen's half — a store
      // aggregate must carry no roster name at all.
      if (props.roi) {
        const roster = (await coachingProps(GINZA)).props.team!.rows.map((r) => r.staffLabel)
        for (const name of roster) expect(JSON.stringify(props.roi).includes(name)).toBe(false)
      }

      // (4) THE VIEWER LINE NAMES THIS ROLE, so the page says whose eyes it is.
      expect(props.viewerLine).toContain(role)
    })
  }

  it('a STAFF reader’s payload has no colleague and no store aggregate in it at all', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { role: 'スタッフ', selfId: 'p-01' } })
    unpinClock()
    expect(props.team).toBeNull()
    expect(props.roi).toBeNull()
    // p-04's own numbers exist in the plane and reach nothing here.
    const blob = JSON.stringify(props)
    expect(blob).not.toContain('見本 しろう')
    expect(blob).not.toContain('後で決める」で終えています')
    // …and the boundary sentence stands where the tab row would be.
    expect(props.teamBoundaryLine).toContain('権限のあるアカウント')
  })

  it('the ROI screen is a SEPARATE capability — a 店舗管理者 has no money estimate to leak', async () => {
    pinClock(MID_MONTH)
    const manager = await coachingProps({ ...GINZA, world: { role: '店舗管理者' } })
    const owner = await coachingProps({ ...GINZA, world: { role: 'オーナー' } })
    unpinClock()
    expect(manager.props.roi).toBeNull()
    expect(JSON.stringify(manager.props)).not.toContain('182,000')
    expect(owner.props.roi!.pitchSub).toContain('182,000')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE OWNER ROI SCREEN — every number is a subtraction, and it says so', () => {
  it('the lift really is treated MINUS control — deleting the control arm moves the number', () => {
    const base = buildRoi({ roi: storeRoi[STORE_A] })!
    const closing = base.lifts.find((l) => l.key === 'closingRate')!
    // the same world with the untreated stores flat: the lift must GROW, which
    // is only true if the control arm is being subtracted at all.
    const noControl = buildRoi({
      roi: {
        ...storeRoi[STORE_A],
        lifts: storeRoi[STORE_A].lifts.map((l) => ({ ...l, horizons: l.horizons.map((h) => ({ ...h, controlDelta: 0 })) })),
      },
    })!
    const closingNoControl = noControl.lifts.find((l) => l.key === 'closingRate')!
    expect(closingNoControl.lift!).toBeGreaterThan(closing.lift!)
    // …and the arithmetic is the module's own, to the digit.
    const h = storeRoi[STORE_A].lifts.find((l) => l.key === 'closingRate')!.horizons
    const used = h.map((x) => x.horizon).sort((a, b) => a - b)
    const wSum = used.reduce((s, x) => s + HORIZON_WEIGHTS[x], 0)
    const expected = h.reduce((s, x) => s + shrink(x.treatedDelta - x.controlDelta, x.n, 0) * (HORIZON_WEIGHTS[x.horizon] / wSum), 0)
    expect(closing.lift!).toBeCloseTo(expected, 12)
  })

  it('a thin sample is SHRUNK toward the prior, so a fluke cannot outrank real work', () => {
    const thin = buildRoi({ roi: { ...storeRoi[STORE_A], lifts: [{ key: 'closingRate', before: 0.3, after: 0.6, unit: 'rate', horizons: [{ horizon: 30, treatedDelta: 0.3, controlDelta: 0, n: 1 }] }] } })!
    // raw effect .3; shrunk at n=1 toward a zero prior it is a fraction of that.
    expect(thin.headline.lift!).toBeLessThan(0.3 / 3)
    expect(thin.headline.confidence).toBe('early')
  })

  it('the MONEY LINE is gated on the headline’s own confidence, and the withholding is SAID', async () => {
    const mature = buildRoi({ roi: storeRoi[STORE_A] })!
    expect(mature.headline.confidence).toBe(MONEY_LINE_CONFIDENCE)
    expect(mature.monthlyValueEstimate).not.toBeNull()
    // the same store, with only an early horizon: no estimate, and the screen
    // is handed the sentence that says why rather than left silent.
    const early = buildRoi({
      roi: { ...storeRoi[STORE_A], lifts: storeRoi[STORE_A].lifts.map((l) => ({ ...l, horizons: l.horizons.filter((h) => h.horizon === 30) })) },
    })!
    expect(early.headline.confidence).toBe('early')
    expect(early.monthlyValueEstimate).toBeNull()
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { role: 'オーナー' } })
    unpinClock()
    expect(props.roi!.pitchWithheld).toBeNull()
    expect(props.roi!.pitchSub).not.toBeNull()
  })

  it('the HONESTY NOTE cannot be separated from the numbers it describes', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { role: 'オーナー' } })
    unpinClock()
    // it rides the SAME object as the lifts, so there is no payload in which
    // one exists without the other…
    expect(props.roi!.lifts.length).toBeGreaterThan(0)
    expect(props.roi!.honestyNote).toContain('差分の差分法')
    expect(props.roi!.honestyNote).toContain('誇張しません')
    // …and the screen renders it unconditionally inside the ROI panel, never
    // behind a flag a fix could flip.
    const panel = SCREEN_CODE.slice(SCREEN_CODE.indexOf('id="cgPanelRoi"'), SCREEN_CODE.indexOf('cg-foot'))
    expect(panel).toContain('{props.roi.honestyNote}')
    expect(panel).not.toMatch(/\{[^}]*&&\s*<section className="cg-honesty"/)
  })

  it('every confidence state has a designed label — none renders as a bare zero', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps({ ...GINZA, world: { role: 'オーナー' } })
    unpinClock()
    // ⚠ THE PLANE EXERCISES THREE OF THE FOUR ON ONE SCREEN, so 「構築中」 and
    // 「初期」 are states a reader meets rather than branches only a test sees.
    const seen = new Set(props.roi!.lifts.map((l) => l.confidence))
    expect([...seen].sort()).toEqual(['building', 'early', 'mature'])
    for (const l of props.roi!.lifts) {
      expect({ key: l.key, label: l.confidenceLabel, empty: l.confidenceLabel.length === 0 }).toEqual({ key: l.key, label: l.confidenceLabel, empty: false })
      expect(l.horizonNote.length).toBeGreaterThan(0)
    }
    // the fourth state has a word too, so a metric with no data never prints 0.
    const none = buildRoi({ roi: { ...storeRoi[STORE_A], lifts: [{ key: 'closingRate', before: 0.3, after: 0.3, unit: 'rate', horizons: [] }] } })!
    expect(none.headline.lift).toBeNull()
    expect(none.headline.confidence).toBe('none')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE LOOK-FIX SURFACES — each one really reaches the screen', () => {
  it('the CONSENT gate is rendered, and it is a READ with a REFUSED control', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const self = props.self as Extract<CoachingSelf, { kind: 'ready' }>
    expect(self.consent.title).toBe(CONSENT_STATE.granted.title)
    // the page SAYS coaching is opt-in — the gap §5 rank 6 named.
    expect(self.consent.body).toContain('取り消せます')
    expect(CONSENT_STATE.unset.body).toContain('同意しなくても仕事には影響しません')
    // …and the control is refused with ITS OWN reason, like every other write on
    // this page. ⚖ one generic sentence on eight controls tells a reader nothing
    // about which of them would have done what, so the reasons are all distinct.
    expect(SCREEN_CODE).toContain("refused(ready.consent.cta, props.refusals.consent, 'cg-consent-btn')")
    expect(SCREEN_CODE).toContain("refused(props.transparency.deletionCta, props.refusals.deletion, 'cg-delete-btn')")
    const reasons = Object.values(props.refusals)
    expect(new Set(reasons).size).toBe(reasons.length)
    for (const r of reasons) {
      // no build-tracking code ever reaches a sentence a salon manager reads
      expect({ r, code: /登録|PKT|CE-|registry/i.test(r) }).toEqual({ r, code: false })
      expect(r.endsWith('。')).toBe(true)
    }
    // ⚠ AND 「同意内容を見る」 IS GONE, not refused: the whole of the consent text
    // now stands on this page, so a control that took the reader to where the
    // reader already is stopped being a control this room needs.
    expect(SCREEN_CODE).not.toContain('reviewCta')
  })

  it('あなたの強み and the FULL focus list both reach the payload', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const self = props.self as Extract<CoachingSelf, { kind: 'ready' }>
    expect(self.strengths.length).toBeGreaterThan(0)
    // staff-focus.ts:203 — the detail MUST cite the evidencing metric.
    for (const s of self.strengths) expect(s.detail).toMatch(/\d/)
    // ⚖ VL-5 — THE REAL PLANE EXERCISES THE PLURAL CASE, not just a synthetic
    // override: p-06's own fixture now carries two focus_recommendations, so
    // the 「そのあとに効くもの」 list this room already renders (audit #31) is
    // reachable in an actual rendered world, not only in the test below.
    expect(self.focus.length).toBeGreaterThan(1)
    // the whole ≤3 list is resolved, not just the hero (audit #31)
    const view = buildSelfView({
      selfId: 'p-06',
      rows: [{ ...coachingStaff[0], focus: { ...coachingStaff[0].focus, focus_recommendations: [
        ...coachingStaff[0].focus.focus_recommendations,
        { category: 'next_step', label: '二番目', description: 'x', confidence: 'established', priority: 'medium', module_id: 'mod-next-01', suggested_new_module_title: null },
      ] } }],
      patterns: teamPatterns,
    })
    expect(view.kind).toBe('ready')
    expect((view as { kind: 'ready'; view: { focus: unknown[] } }).view.focus.length).toBe(3)
    expect(SCREEN_CODE).toContain('ready.focus.slice(1)')
  })

  it('the PRIVACY MARKER is one prop on every L1 section — and on none of the shared ones', () => {
    // one string, one element, so the promise cannot come apart card by card
    expect([...SCREEN_CODE.matchAll(/\{lock\}/g)].length).toBeGreaterThanOrEqual(6)
    expect([...SCREEN_CODE.matchAll(/className="cg-lock"/g)].length).toBe(1)
    // …and it is NOT on the anonymous team content or the shared library.
    for (const marker of ['cg-learn', 'cg-patterns', 'cg-modules', 'cg-board', 'cg-adoption', 'cg-ranking']) {
      const at = SCREEN_CODE.indexOf(`className="${marker}"`)
      expect({ marker, found: at > 0 }).toEqual({ marker, found: true })
      const head = SCREEN_CODE.slice(at, at + 900)
      expect({ marker, locked: head.includes('{lock}') }).toEqual({ marker, locked: false })
    }
  })

  it('the FINDING now points at what fixes it — resolved to names, never ids', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const self = props.self as Extract<CoachingSelf, { kind: 'ready' }>
    const linked = self.findings.filter((f) => f.moduleTitle !== null)
    expect(linked.length).toBeGreaterThan(0)
    for (const f of self.findings) {
      // never an id at a reader, on either link
      expect({ id: f.id, mod: f.moduleTitle }).not.toMatchObject({ mod: expect.stringMatching(/^mod-/) })
      expect({ id: f.id, pat: f.patternBehavior }).not.toMatchObject({ pat: expect.stringMatching(/^tp-/) })
    }
    // a dangling reference resolves to null rather than to a printed id
    const dangling = buildSelfView({
      selfId: 'p-06',
      rows: [{ ...coachingStaff[0], findingsRun: { ...coachingStaff[0].findingsRun, findings: coachingStaff[0].findingsRun.findings.map((f) => ({ ...f, pattern_reference: 'tp-nope' })) } }],
      patterns: teamPatterns,
    }) as { kind: 'ready'; view: { findings: Array<{ patternBehavior: string | null }> } }
    for (const f of dangling.view.findings) expect(f.patternBehavior).toBeNull()
  })

  it('the TRANSPARENCY block carries all NINE facts, plus the processor disclosure', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const t = props.transparency
    expect(t.staffOnly.length).toBe(5)
    expect(t.ownerVisible.length).toBe(4)
    expect(t.synqed.length).toBe(4)
    // ⚠ THE WORDS ARE ja.json's OWN, not a paraphrase this room wrote.
    const data = (JSON.parse(read('messages/ja.json')) as { coaching: { data: { staffOnly: Record<string, string>; ownerVisible: Record<string, string>; synqedAccess: Record<string, string>; missionBody: string } } }).coaching.data
    expect([...t.staffOnly].sort()).toEqual(Object.entries(data.staffOnly).filter(([k]) => k !== 'title').map(([, v]) => v).sort())
    expect([...t.ownerVisible].sort()).toEqual(Object.entries(data.ownerVisible).filter(([k]) => k !== 'title').map(([, v]) => v).sort())
    expect([...t.synqed].sort()).toEqual(Object.entries(data.synqedAccess).filter(([k]) => !['title', 'intro'].includes(k)).map(([, v]) => v).sort())
    expect(t.missionBody).toBe(data.missionBody)
    // …and it is on the page for EVERY persona, because the wall it describes
    // does not change when the tab does.
    expect(SCREEN_CODE.indexOf('className="cg-notice"')).toBeGreaterThan(SCREEN_CODE.indexOf('{props.actionFootnote}'))
  })

  it('サポートエリア頻度 counts STAFF per category, once each, and orders without ranking people', () => {
    const rows = buildTriage({
      roster: [{ id: 'p-04', name: 'a' }, { id: 'p-01', name: 'b' }, { id: 'p-05', name: 'c' }],
      rows: coachingStaff,
      floor: FLOOR_DEFAULT,
    }).rows
    const freq = focusAreaFrequency(rows)
    // a staff member with the same category twice counts once
    const dup = focusAreaFrequency([{ ...rows[0], focusAreas: [...rows[0].focusAreas, ...rows[0].focusAreas] }])
    expect(dup[0].count).toBe(1)
    // the total never exceeds the roster
    for (const f of freq) expect(f.count).toBeLessThanOrEqual(rows.length)
    // …and the BOARD's own row order is untouched by the ranking existing.
    expect(rows.map((r) => r.staffLabel)).toEqual(['a', 'b', 'c'])
  })
})
