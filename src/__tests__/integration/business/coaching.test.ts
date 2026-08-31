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
  MATURITY_MIN_SESSIONS,
  MIN_HISTORY,
  accessFor,
  bandOf,
  buildSelfView,
  buildTriage,
  categoryLabel,
  declineLabel,
  helpActionFor,
  maturityNote,
  maturityOf,
  moduleOn,
  sampleFloor,
  sessionsOf,
} from '@/business/lib/coaching'
import { coachingStaff, coachingStores, teamPatterns } from '@/business/lib/fixtures-coaching'
import { STORE_A, STORE_B, staff as worldStaff } from '@/business/lib/fixtures'
import { coachingProps } from '@/app/[locale]/(business)/business/coaching/coaching-props'

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
        'action', 'band', 'bandLabel', 'bandTone', 'focusAreas', 'maturityNote', 'staffLabel', 'trajectoryLine',
      ])
    }
  })

  it('NO staff member’s own number reaches the owner’s payload — planted and hunted', async () => {
    // ⚠ THE STRUCTURAL PROOF, not a spot check. Every number the fixture plane
    // holds for every staff member is planted with a value that could only have
    // come from this room's coaching data, and the SERIALIZED owner payload is
    // then scanned whole for any of them.
    const marked = coachingStaff.map((r, i) => ({
      ...r,
      sessions: 9100 + i,
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
    const planted = ['910', '0.91', '4.91', '9101', '9105', '9106']
    for (const needle of planted) {
      expect({ needle, inOwnerPayload: payload.includes(needle) }).toEqual({ needle, inOwnerPayload: false })
    }
    // …and the board really did render — a payload with nothing in it would
    // pass the scan above for the wrong reason (⚖ HARNESS-TRUTH).
    expect(props.team!.rows.length).toBeGreaterThanOrEqual(4)
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

  it('the LIB’s own triage row has FIVE fields, and a number is not one of them', () => {
    // ⚠ THE PROPS FILE IS A SECOND WALL, NOT THE FIRST ONE. `coaching-props.ts`
    // maps each row field by field, so an extra number added to `TriageRow`
    // never reaches the payload — and the payload pin above therefore cannot
    // see it. That is a pin true for a second reason: the guarantee this room
    // claims is that the MODEL has no field for a number, so the model is where
    // it is measured. (Mutant M1 survived the whole battery until this existed.)
    const view = buildTriage({ roster: [{ id: 'p-06', name: '見本 あずさ' }], rows: coachingStaff, floor: FLOOR_DEFAULT })
    expect(Object.keys(view.rows[0]).sort()).toEqual([
      'band', 'focusAreas', 'maturity', 'needsSupport', 'staffLabel', 'status', 'suggestedAction',
    ])
    for (const [k, v] of Object.entries(view.rows[0])) {
      expect({ field: k, isNumber: typeof v === 'number' }).toEqual({ field: k, isNumber: false })
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
      expect({ name, sortsRoster: /rows\.sort|roster\.sort|\.sort\(\s*\(a, ?b\)\s*=>\s*b\./.test(code) }).toEqual({ name, sortsRoster: false })
    }
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

  it('the grant is read in exactly ONE place, and it is the aggregate', () => {
    const reads = [...LIB_CODE.matchAll(/\.grant\b/g)].length
    expect({ reads }).toEqual({ reads: 1 })
    expect(LIB_CODE).toContain("byStaff.get(m.id)?.grant === 'granted'")
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

  it('every refusal reason is DISTINCT and names the seam it waits on', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    const reasons = [...Object.values(props.refusals), ...Object.values(props.helpRefusals)]
    expect(new Set(reasons).size).toBe(reasons.length)
    for (const r of reasons) {
      expect({ r, saysSample: r.startsWith('見本データのため') }).toEqual({ r, saysSample: true })
      expect({ r, namesRegistry: REGISTRY.some((line) => r.includes(line)) }).toEqual({ r, namesRegistry: true })
    }
  })

  it('the census is COMPLETE — every refused control on the page is one of them', async () => {
    pinClock(MID_MONTH)
    const { props } = await coachingProps(GINZA)
    unpinClock()
    // Every `refused(` call in the screen, and what it is handed.
    const calls = [...SCREEN_CODE.matchAll(/refused\(\s*'([^']+)',\s*([^,)]+)/g)].map((m) => ({ label: m[1], reason: m[2].trim() }))
    expect(calls.map((c) => c.label).sort()).toEqual([
      'コーチングの設定', '共有された内容を見る', '共有をオンにする', '気づきを作り直す',
    ])
    // …plus the ONE dynamic call, which resolves through the help table.
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
    expect(shell).toContain('.biz .app:has(.page.pg-inbox, .page.pg-register, .page.pg-karute, .page.pg-coaching) { min-width: 0; }')
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
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'customers', 'inbox', 'karute', 'register', 'reservations', 'shifts', 'today'])
  })

  it('every sibling rule that could reach this room is FENCED at four levels', () => {
    const collisions: string[] = []
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const sel of selectorsOf(src)) {
        if (!sel.startsWith('.biz') || sel.includes('.pg-')) continue
        const names = classesIn(sel)
        if (names.length && names.every((n) => mine.has(n))) collisions.push(`${dir}::${sel}`)
      }
    }
    // Derived, not copied: a neighbour that ever states a bare rule on a name
    // this room renders appears here, and the fence has to grow in the same pass.
    expect(collisions.sort()).toEqual([
      'customers::.biz .page .btn',
      'reservations::.biz .btn',
      'reservations::.biz .btn.primary',
    ])
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
    expect([...rendered].filter((n) => n.startsWith('is-')).sort()).toEqual(['is-on', 'is-support'])
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
    expect([...isNames].sort()).toEqual(['is-on', 'is-priority', 'is-strength', 'is-support', 'is-watch'])
    // …and no neighbour states a bare rule on any of them.
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const sel of selectorsOf(src)) {
        if (sel.includes('.pg-')) continue
        for (const n of isNames) {
          expect({ dir, sel, name: n, bare: classesIn(sel).includes(n) }).toEqual({ dir, sel, name: n, bare: false })
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
  /** The field names an interface in OUR plane declares. */
  const fieldsOf = (src: string, name: string): string[] => {
    const at = src.indexOf(`export interface ${name} {`)
    expect({ name, found: at >= 0 }).toEqual({ name, found: true })
    const body = src.slice(at + `export interface ${name} {`.length, src.indexOf('\n}', at))
    return [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s{2}([a-zA-Z_][\w]*)\??:/gm)].map((m) => m[1]).sort()
  }

  it('the FINDING mirrors personal-findings.ts’s own findings[] item', () => {
    const schema = requiredAfter(FINDINGS, "const OUTPUT_SCHEMA").filter((f) => f !== 'window' && f !== 'status' && f !== 'headline' && f !== 'findings')
    void schema
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
    for (const row of coachingStaff) {
      for (const f of row.findingsRun.findings) {
        expect({ id: f.id, checks: f.evidence.count_total === f.evidence.session_refs.length || f.evidence.session_refs.length > 0 })
          .toEqual({ id: f.id, checks: true })
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
    // the ONLY numbers are the four band counts and the two adoption integers
    const allowed = JSON.stringify([props.team!.counts, props.team!.adoptionLine]).match(/\d+/g) ?? []
    expect(digits.sort()).toEqual(allowed.sort())
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
    // …and structurally: `helpActionFor` takes a band and a module id, nothing else.
    expect(LIB).toContain('export function helpActionFor(band: PerformanceBand | null, moduleId: string | null)')
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
