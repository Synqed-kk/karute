/**
 * 設定 — the room every other room's dial was promised to.
 *
 * THE ONE THING THIS SUITE IS FOR: THIS ROOM OWNS NO VALUE ANOTHER ROOM ALREADY
 * OWNS. Nine rooms shipped a dial with a ⚠SETTINGS-BATCH marker beside it; a
 * settings page that kept its own copy of any of them would be the second home
 * the ⚖ one-truth law forbids, and the copy is the one a reader believes. So the
 * dial census below is asserted as EQUALITIES AGAINST THE WORLD's own planes,
 * never as spot checks — mutate `opsConfig.blockStepMin` and this file goes red,
 * which is exactly what a hardcoded 「15分」 in the props would survive.
 *
 * SECOND JOB — THE STRUCTURAL DUTY (DIAL-HOME-MAP (d)). Canon gates a settings
 * page with ONE page-wide `boundaryPanel`, so a personal preference sitting
 * beside a store policy is gated with it: 「positional discipline, not a rule the
 * markup enforces」. Here `gateOf` answers ONE SECTION, and answers `open` for a
 * self-scoped one BEFORE it looks at access. The battery's own mutant — make the
 * gate page-wide — is killed here from three directions: the rule, the payload a
 * rights-less reader gets, and the screen's source.
 *
 * THIRD JOB — EVERY STORE DIAL REFUSES HONESTLY. Sixteen rows, sixteen DIFFERENT
 * reasons, each TIED to the registry line it reconnects through, each carrying
 * the mistake-proofing trio (⚖ 8/21: default · guardrail · and a business-type
 * line ONLY where a ruling gave one). A generic reason and a missing guardrail
 * are both mutants this file kills.
 *
 * FOURTH JOB, ADDED BY THE FIX ROUND — NO INTERNAL CODE REACHES THE READER. The
 * seam a refusal waits on is a FIELD beside the sentence rather than a substring
 * inside it, and the last describe in this file scans every reader-facing string
 * in every world for tags, circled indexes, codenames and tokens. That block is
 * the recurrence guard for the room-8 N8-1 class, which this room shipped again
 * BECAUSE the pin here required the code. Read it before adding any string.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { operator, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { cashTolerance, MAX_CASH_TOLERANCE } from '@/business/lib/fixtures-register'
import { storeDials } from '@/business/lib/fixtures-settings'
import { shiftsPolicy } from '@/business/lib/fixtures-shifts'
import { opsConfig, storeBookingPolicy } from '@/business/lib/fixtures-today'
import {
  accessFor,
  clampCoachingFloor,
  clampCoachingRetention,
  clampWinBackDays,
  COACHING_FLOOR_MAX,
  COACHING_FLOOR_MIN,
  firstOpenSection,
  gateOf,
  PREFS_DEFAULT,
  RAIL,
  readPrefs,
  REGISTRY,
  refusalFor,
  RETENTION_MAX_MONTHS,
  RETENTION_MIN_MONTHS,
  seamFor,
  sectionById,
  WIN_BACK_MAX,
  WIN_BACK_MIN,
  withCurrent,
} from '@/business/lib/settings'
import { RENDERED_DIALS, settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import type { DialId } from '@/business/lib/settings'
import type { DialRow, SettingsProps } from '@/app/[locale]/(business)/business/settings/SettingsScreen'

const ROOM_DIR = 'src/app/[locale]/(business)/business/settings'
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PLANE_SRC = read('src/business/lib/fixtures-settings.ts')
const LIB_SRC = read('src/business/lib/settings.ts')
const SCREEN_SRC = read(`${ROOM_DIR}/SettingsScreen.tsx`)
const PROPS_SRC = read(`${ROOM_DIR}/settings-props.ts`)
const PAGE_SRC = read(`${ROOM_DIR}/page.tsx`)
const CSS_SRC = read(`${ROOM_DIR}/settings.css`)

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const stripLine = (src: string) => src.replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS_SRC)
/** ⚠ BOTH COMMENT FORMS. `stripComments` alone leaves `//` lines, and this room
 *  explains the codes it no longer prints — so a pin that scans the lib for a tag
 *  would read the note about the tag as the tag. */
const LIB_CODE = stripLine(stripComments(LIB_SRC))
const PROPS_CODE = stripLine(stripComments(PROPS_SRC))
const SCREEN_CODE = stripLine(stripComments(SCREEN_SRC))
const PLANE_CODE = stripLine(stripComments(PLANE_SRC))

const room = async (input?: { store?: string; role?: string; dials?: null }) =>
  (
    await settingsProps({
      locale: 'ja',
      store: input?.store,
      world: input?.role !== undefined || input?.dials !== undefined ? { role: input?.role, dials: input?.dials } : undefined,
    })
  ).props

const dialsOf = (props: SettingsProps): DialRow[] => props.sections.flatMap((s) => s.dials)
const dialOf = (props: SettingsProps, id: string): DialRow => {
  const row = dialsOf(props).find((d) => d.id === id)
  if (!row) throw new Error(`no dial rendered for ${id}`)
  return row
}
const currentOf = (row: DialRow): string => {
  const c = row.control
  if (c.kind === 'segment') return c.current
  if (c.kind === 'switch') return String(c.on)
  return c.text
}

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ ONE TRUTH — every dial this room shows is READ from the room that ships it', () => {
  it('the board policy dials equal the board’s own plane, value for value', async () => {
    const props = await room({ store: STORE_A })
    // ⚠ EQUALITIES AGAINST THE WORLD, not literals. A props file that spelled
    // 「30分」 would pass a literal check for ever; it cannot pass this one the
    // moment the board's own number moves, which is the mutant the battery runs.
    expect(currentOf(dialOf(props, 'guard-mode'))).toBe(storeBookingPolicy.gapGuardMode)
    expect(currentOf(dialOf(props, 'booking-step'))).toBe(String(opsConfig.bookingStepMin))
    expect(currentOf(dialOf(props, 'block-step'))).toBe(String(opsConfig.blockStepMin))
    expect(currentOf(dialOf(props, 'min-sellable'))).toBe(String(opsConfig.minSellableMin))
    expect(currentOf(dialOf(props, 'override-rights'))).toBe(storeBookingPolicy.overridePolicy.roles.join('・'))
  })

  it('the money dials equal レジ’s own plane, and name its ceiling', async () => {
    const props = await room({ store: STORE_A })
    const row = dialOf(props, 'cash-tolerance')
    expect(currentOf(row)).toBe(`¥${cashTolerance.toLocaleString('ja-JP')}`)
    expect(row.trio.guardrail).toContain(`¥${MAX_CASH_TOLERANCE.toLocaleString('ja-JP')}`)
  })

  it('the 人件費 gate names シフト’s own role list rather than restating it', async () => {
    const props = await room({ store: STORE_A })
    expect(dialOf(props, 'breaks-paid').trio.guardrail).toContain(shiftsPolicy.laborCostRoles.join('・'))
  })

  it('the ADD-ONLY plane states NOTHING the world already states', () => {
    // The fence, machine-read: if a later round copies a board number into this
    // room's plane, the name it would have to use appears here and fails.
    for (const forbidden of [
      'gapGuardMode',
      'bookingStepMin',
      'blockStepMin',
      'minSellableMin',
      'overridePolicy',
      'cashTolerance',
      'laborCostRoles',
      'hourlyWage',
    ]) {
      expect({ forbidden, inPlane: PLANE_CODE.includes(forbidden) }).toEqual({ forbidden, inPlane: false })
    }
    // …and it imports the world's ids ONLY — a plane that imported a derivation
    // could restate a fact instead of adding one.
    expect(PLANE_CODE).toContain("import { STORE_A, STORE_B } from './fixtures'")
    expect(PLANE_CODE.match(/^import /gm) ?? []).toHaveLength(1)
  })

  it('the props file reads the planes, and spells no dial value of its own', () => {
    for (const source of [
      'storeBookingPolicy.gapGuardMode',
      'opsConfig.bookingStepMin',
      'opsConfig.blockStepMin',
      'opsConfig.minSellableMin',
      'cashTolerance',
      'MAX_CASH_TOLERANCE',
      'shiftsPolicy.laborCostRoles',
      'storeDials',
    ]) {
      expect({ source, read: PROPS_CODE.includes(source) }).toEqual({ source, read: true })
    }
    // ⚠ NO CURRENT VALUE IS A LITERAL. `current:` is the field a screen reads to
    // decide which option is live, and a literal there is the whole disease.
    expect(PROPS_CODE).not.toMatch(/current:\s*['"]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE STRUCTURAL DUTY — gating is SECTION-scoped, and cannot be made page-wide', () => {
  const NOBODY = accessFor('スタッフ')
  const MANAGER = accessFor(operator.role)

  it('a self-scoped section is open to a reader who holds NOTHING', () => {
    const mine = sectionById('my-display')!
    expect(mine.scope).toBe('self')
    expect(gateOf(mine, NOBODY)).toBe('open')
    // …and it does not merely happen to be open: the rule never asks.
    const exploding = { role: 'スタッフ', has: () => { throw new Error('gateOf asked access about a self section') } }
    expect(gateOf(mine, exploding)).toBe('open')
  })

  it('the same reader gets NO store section, and still gets their own', async () => {
    const props = await room({ role: 'スタッフ' })
    const open = props.sections.filter((s) => s.gate === 'open').map((s) => s.id)
    expect(open).toEqual(['my-display'])
    const mine = props.sections.find((s) => s.id === 'my-display')!
    expect(mine.prefs).toBe(true)
    // ⚠ AND THE RAIL STILL WORKS: hiding the whole page from a staff member is
    // the same defect wearing a different coat.
    expect(props.rail).toHaveLength(RAIL.length)
    expect(props.openingSectionId).toBe('my-display')
  })

  it('a closed section carries NO dials in the payload — never dials a class hides', async () => {
    const props = await room({ role: 'スタッフ' })
    for (const section of props.sections) {
      if (section.gate === 'open') continue
      expect({ id: section.id, dials: section.dials.length, aside: section.aside }).toEqual({ id: section.id, dials: 0, aside: null })
    }
    // Not one refusal sentence, guardrail or store value reaches a reader who may
    // read none of them.
    // ⚠ THE BOUNDARY'S OWN 登録 LINE IS ALLOWED and is why this is asserted per
    // refusal rather than on the word 「登録」: 事業構成 says the token it is
    // waiting on, which a reader who cannot open it still deserves to know.
    const payload = JSON.stringify(props)
    for (const id of RENDERED_DIALS) {
      expect({ id, leaked: payload.includes(refusalFor(id)) }).toEqual({ id, leaked: false })
    }
    expect(payload).not.toContain('スキマガード')
  })

  it('the SCREEN has no page-level gate to hang the whole page on', () => {
    // The mutant the battery plants is a wrapper — `props.gate === 'no-rights' ?
    // <Boundary/> : <>…</>` around the body. Three pins, because one grep is a
    // pin that can be true for the wrong reason.
    expect(SCREEN_CODE).not.toMatch(/props\.gate/)
    expect(SCREEN_CODE).not.toMatch(/pageGate|isLocked|allGated/)
    // The boundary is rendered from the SECTION's own field, inside the panel.
    expect(SCREEN_CODE).toContain("section.gate === 'no-rights' ?")
    // …and the rail is rendered before it, outside any gate expression: the rail
    // markup must appear ahead of the first `gate` mention in the file.
    expect(SCREEN_CODE.indexOf('className="st-rail"')).toBeLessThan(SCREEN_CODE.indexOf('section.gate'))
    // The sheet cannot undo it either: no rule hides the body or the prefs block.
    expect(CSS_CODE).not.toMatch(/\.pg-settings\.is-locked/)
    expect(CSS_CODE).not.toMatch(/\.st-body\s*\{[^}]*display:\s*none/)
  })

  it('the prefs block is mounted on the SECTION’s own flag, never on access', () => {
    expect(SCREEN_CODE).toContain('{section.prefs && <PrefsBlock')
    // The live controls call `onChange` directly — no refusal, no gate, no role.
    expect(SCREEN_CODE).toMatch(/onClick=\{\(\) => onChange\(\{ \.\.\.prefs, density: value \}\)\}/)
    expect(SCREEN_CODE).toMatch(/onClick=\{\(\) => onChange\(\{ \.\.\.prefs, emphasis: value \}\)\}/)
  })

  it('a manager opens the store sections, and 事業構成 / 契約・請求 stay shut for everyone', () => {
    expect(gateOf(sectionById('store-hours')!, MANAGER)).toBe('open')
    expect(gateOf(sectionById('business-structure')!, MANAGER)).toBe('no-rights')
    expect(gateOf(sectionById('billing')!, MANAGER)).toBe('no-rights')
    // ⚠ `business.manage` IS NOT A REAL TOKEN (DIAL-HOME-MAP (c)2) — no role in
    // this world holds it, and the refusal says so rather than implying a grant.
    for (const role of ['オーナー', '店舗管理者', 'スタッフ', '不明']) {
      expect({ role, open: gateOf(sectionById('business-structure')!, accessFor(role)) }).toEqual({ role, open: 'no-rights' })
    }
    expect(gateOf(sectionById('billing')!, accessFor('オーナー'))).toBe('open')
  })

  it('an unknown role holds nothing — never a default grant', () => {
    expect(accessFor('不明').has('settings.manage')).toBe(false)
    expect(firstOpenSection(accessFor('不明'))?.id).toBe('my-display')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ 8/21 MISTAKE-PROOFING — every dial ships default, guardrail and type note', () => {
  it('the census is complete, and it is the props file’s own list', async () => {
    const props = await room({ store: STORE_A })
    expect(dialsOf(props).map((d) => d.id).sort()).toEqual([...RENDERED_DIALS].sort())
    expect(RENDERED_DIALS).toHaveLength(16)
  })

  it('the default and the guardrail are present on every dial, and say something specific', async () => {
    const props = await room({ store: STORE_A })
    for (const row of dialsOf(props)) {
      expect({ id: row.id, base: row.trio.base.length > 0 }).toEqual({ id: row.id, base: true })
      expect({ id: row.id, rail: row.trio.guardrail.length > 0 }).toEqual({ id: row.id, rail: true })
      // A default that does not say what it defaults TO is not a default.
      expect({ id: row.id, names: row.trio.base.startsWith('初期値') }).toEqual({ id: row.id, names: true })
      // ⚠ A GUARDRAIL IS A SENTENCE ABOUT A LIMIT. Sixteen copies of one sentence
      // would pass a length check; distinctness is what kills the mutant.
      expect({ id: row.id, long: row.trio.guardrail.length >= 20 }).toEqual({ id: row.id, long: true })
    }
    const rails = dialsOf(props).map((d) => d.trio.guardrail)
    expect(new Set(rails).size).toBe(rails.length)
  })

  // ⚠ RE-POINTED (DS9-10). This pin used to require the SENTENCE 「業種による初期値
  // の決まりはありません」 on every unruled dial, which is how twelve rows came to
  // carry a null statement. ⚖ 8/21 says a dial with no ruled type default must not
  // INVENT one — and silence already satisfies that. The pin now asserts the
  // stronger claim in both directions: exactly the ruled dials carry a 業種 line,
  // every other dial carries NONE, and the null sentence exists nowhere at all.
  it('a 業種 line prints ONLY where a ruling gave one — absence is SILENCE, never a null sentence', async () => {
    const props = await room({ store: STORE_A })
    const RULED = ['cash-tolerance', 'breaks-paid', 'win-back', 'coaching-enabled']
    for (const row of dialsOf(props)) {
      const states = typeof row.trio.businessType === 'string' && row.trio.businessType.length > 0
      expect({ id: row.id, statesOne: states }).toEqual({ id: row.id, statesOne: RULED.includes(row.id) })
      if (states) expect({ id: row.id, real: row.trio.businessType!.startsWith('業種による初期値:') }).toEqual({ id: row.id, real: true })
    }
    expect(dialOf(props, 'cash-tolerance').trio.businessType).toContain('¥0')
    // …and the null sentence is gone from the WHOLE payload, not just from the
    // rows this test walked — a section the census does not reach cannot smuggle
    // it back in.
    expect(JSON.stringify(props)).not.toContain('業種による初期値の決まりはありません')
    expect(PROPS_CODE).not.toContain('業種による初期値の決まりはありません')
    // The screen renders the line CONDITIONALLY, so a future dial that omits it
    // cannot print an empty bullet.
    expect(SCREEN_CODE).toContain('{row.trio.businessType && <li className="st-trio-type">{row.trio.businessType}</li>}')
  })

  it('every clamp refuses the harmful end, both ways, and survives a non-number', () => {
    expect(clampWinBackDays(1)).toBe(WIN_BACK_MIN)
    expect(clampWinBackDays(9999)).toBe(WIN_BACK_MAX)
    expect(clampWinBackDays(61)).toBe(61)
    expect(clampCoachingRetention(0)).toBe(RETENTION_MIN_MONTHS)
    expect(clampCoachingRetention(999)).toBe(RETENTION_MAX_MONTHS)
    expect(clampCoachingFloor(1)).toBe(COACHING_FLOOR_MIN)
    expect(clampCoachingFloor(500)).toBe(COACHING_FLOOR_MAX)
    // ⚠ NaN IS NOT ZERO. `Math.min(NaN, …)` is NaN and a NaN on screen prints as
    // 「NaN日」 — the clamp answers the SAFE end instead.
    expect(clampWinBackDays(Number.NaN)).toBe(WIN_BACK_MIN)
    expect(clampCoachingFloor(Number.POSITIVE_INFINITY)).toBe(COACHING_FLOOR_MIN)
  })

  it('a readout is a FIGURE or a PHRASE, and the sheet sizes them differently', async () => {
    // ⚠ CAUGHT BY THE SHOTS, NOT BY A TEST. 「オーナー・店舗管理者・スタッフ」 at
    // the figure's 20px read as a headline shouting over the section title, while
    // 「¥0」 at that size is exactly the number a manager scans for.
    const props = await room({ store: STORE_A })
    const NUMERIC = ['cash-tolerance', 'win-back', 'coaching-retention', 'coaching-floor']
    for (const row of dialsOf(props)) {
      if (row.control.kind !== 'readout') continue
      expect({ id: row.id, numeric: row.control.numeric }).toEqual({ id: row.id, numeric: NUMERIC.includes(row.id) })
    }
    expect(CSS_CODE).toContain('.st-readout.is-phrase b { font-size: 14px;')
    expect(SCREEN_CODE).toContain("className={`st-readout${c.numeric ? '' : ' is-phrase'}`}")
  })

  it('a stored value outside the presets is ADDED to them, never rounded away', () => {
    // canon's own ruling (fable-settings-store-hours.html:4218-4231): silently
    // showing the nearest preset makes 「現在値をプリセット」 a lie.
    expect(withCurrent([15, 30, 60], 20)).toEqual([15, 20, 30, 60])
    expect(withCurrent([15, 30, 60], 30)).toEqual([15, 30, 60])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ EVERY REFUSAL IS ITS OWN, AND NAMES ITS SEAM', () => {
  it('sixteen dials, sixteen different reasons, each tied to a registry line', async () => {
    const props = await room({ store: STORE_A })
    const reasons = dialsOf(props).map((d) => d.refusal)
    expect(new Set(reasons).size).toBe(reasons.length)
    for (const row of dialsOf(props)) {
      // ⚠ THE TIE IS A FIELD, NOT A SUBSTRING (NS9-1 / DS9-4). This used to be
      // `/登録: [①-⑧]/` on the sentence itself, which is what MADE the room red
      // without an internal code in its copy. The seam is now data beside the
      // text, so the census is stronger AND the reader sees plain Japanese.
      expect({ id: row.id, seam: seamFor(row.id as DialId) in REGISTRY }).toEqual({ id: row.id, seam: true })
      // ⚠ AND IT IS NOT GENERIC: the reason has to say something about THIS dial,
      // so it carries the dial's own label or the subject the label names.
      expect({ id: row.id, long: row.refusal.length >= 40 }).toEqual({ id: row.id, long: true })
    }
    // The table is the ONE home, and the props file never writes a reason itself.
    expect(PROPS_CODE).toContain('refusal: refusalFor(row.id)')
    expect(PROPS_CODE).not.toMatch(/refusal:\s*['"]/)
  })

  it('the eight registry lines are all spent, and every one is a plain name', () => {
    const spent = new Set(RENDERED_DIALS.map((id) => seamFor(id)))
    expect([...spent].sort()).toEqual(Object.keys(REGISTRY).sort())
    // ⚠ AND NOT ONE OF THEM CARRIES A CODE. The circled numbers live in the
    // registry's own comments, the build report and the Anthony ask — never in a
    // value that could be interpolated into a sentence by the next builder.
    for (const [key, name] of Object.entries(REGISTRY)) {
      expect({ key, plain: !/[①-⑳]|登録/.test(name) }).toEqual({ key, plain: true })
    }
  })

  it('the reason is VISIBLE TEXT, not only a tooltip', () => {
    // A refused control whose reason lives in a `title` is a dead lever to
    // everybody who does not hover it.
    expect(SCREEN_CODE).toContain('<p className="st-why">{row.refusal}</p>')
    // …and it also rides the accessible name, because a screen reader drops
    // `title` once a description is present.
    expect(SCREEN_CODE).toContain("'aria-label': `${label} — ${reason}`")
    expect(SCREEN_CODE).toContain("'aria-disabled': 'true' as const")
    // `aria-disabled`, never `disabled`: the control has to stay focusable for
    // its reason to be reachable by keyboard.
    expect(SCREEN_CODE).not.toMatch(/(?<!aria-)\bdisabled\b(?!=\{tourStep)/)
  })

  it('自分の表示設定 is the ONE block that is not refused, and it really saves', () => {
    expect(SCREEN_CODE).toContain("const PREF_KEY = 'synqedBizDisplayPrefs.v1'")
    expect(SCREEN_CODE).toContain('window.localStorage.setItem(PREF_KEY, JSON.stringify(next))')
    // Its controls are NOT built through the refusal helper.
    const prefsBlock = SCREEN_CODE.slice(SCREEN_CODE.indexOf('function PrefsBlock'))
    expect(prefsBlock).not.toContain('refused(')
    // A storage refusal (private mode) is not a reason to break the page.
    expect(SCREEN_CODE).toMatch(/try \{[\s\S]*?window\.localStorage\.getItem\(PREF_KEY\)[\s\S]*?\} catch/)
  })

  it('a stored preference is untrusted input', () => {
    expect(readPrefs(null)).toEqual(PREFS_DEFAULT)
    expect(readPrefs('not json')).toEqual(PREFS_DEFAULT)
    expect(readPrefs('[]')).toEqual(PREFS_DEFAULT)
    expect(readPrefs('{"density":"enormous"}')).toEqual(PREFS_DEFAULT)
    expect(readPrefs('{"density":"compact","emphasis":"strong"}')).toEqual({ density: 'compact', emphasis: 'strong' })
  })

  // ⚠ ADDED BY THE BATTERY (M18 survived without it). The census above covers the
  // sixteen DIAL refusals; the BOUNDARY sentences a gated section renders were
  // held by nothing, and one of them carries the room's most easily-lost truth.
  it('a boundary sentence tells the truth about a token that does not exist', async () => {
    const props = await room({ store: STORE_A })
    const structure = props.sections.find((s) => s.id === 'business-structure')!
    expect(structure.gate).toBe('no-rights')
    // ⚠ `business.manage` is NOT one of canon's eight real tokens (DIAL-HOME-MAP
    // (c)2). The honest sentence says the row is unreachable for EVERYONE rather
    // than implying a permission somebody could be granted.
    // ⚠ RE-POINTED (NS9-1 / DS9-4): this pin used to require 「登録: ②」 IN the
    // sentence, which is how a build-registry code came to be printed to a shop
    // owner. What matters is the CLAIM, and the claim is sayable in plain words.
    expect(structure.boundaryLine).toContain('どの役職からも開けない')
    expect(structure.boundaryLine).toContain('権限そのものがまだ用意されていない')
    expect(structure.boundaryLine).not.toMatch(/登録|[①-⑳]/)
    // …while a row gated on a token that DOES exist stays an ordinary permission
    // sentence, naming the reader's own role rather than a missing capability.
    const billing = props.sections.find((s) => s.id === 'billing')!
    expect(billing.boundaryLine).not.toContain('どの役職からも開けない')
    expect(billing.boundaryLine).toContain(operator.role)
  })

  it('the 保存できません line rides STORE sections only', () => {
    // Printing it under a block that really does save would be the page
    // contradicting the control the reader just used.
    expect(SCREEN_CODE).toContain("{section.scope === 'store' && section.gate === 'open' && <p className=\"st-foot\">")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE RECURRENCE KILLER — READ THIS BEFORE ADDING ANY STRING TO THIS ROOM.
//
// THE CLASS: an INTERNAL CODE reaching the reader (room 8's N8-1, which room 9
// then shipped again). All sixteen refusals and the 事業構成 boundary sentence
// closed with 「（登録: ①店舗ポリシーの保存）」 — a build-registry citation printed
// to a salon owner seventeen times, in visible copy AND in the accessible name a
// screen reader speaks on every focus — while three more lines carried 「core」,
// this codebase's internal name for the shared backend. ⚖ 「plain names, never
// codes」 forbids both, and the room's own sheet already stated the rule for the
// three trio lines sitting directly beside the offending sentences.
//
// AND THE SUITE OF THE DAY REQUIRED IT: `/登録: [①-⑧]/` was asserted on every
// refusal, so the room was RED without the defect. That is why this guard is
// written at the level of the CLASS rather than of the seventeen instances.
//
// WHAT IT DOES: walks the payload the route really assembles — in every world —
// and scans EVERY string a reader can see. A new field is scanned the day it
// lands, because the walk is structural rather than a list; only keys that are
// machine identifiers are skipped, and that skip list is short and named.
//
// ⚠ IF A FUTURE ROUND NEEDS A CODE IN THE COPY, IT DOES NOT. The code belongs
// BESIDE the sentence — in `REGISTRY`, in the build report, in the Anthony ask.
describe('⚠ NO INTERNAL CODE EVER REACHES THE READER (the N8-1 class, killed as a class)', () => {
  /** Keys whose values are machine identifiers, never rendered as words: the
   *  section/rail/dial ids, the gate and scope enums, a control's `kind`.
   *
   *  ⚠ AND SKIPPING BY KEY NAME ALONE IS NOT ENOUGH — THE BATTERY PROVED IT ON
   *  THIS VERY GUARD. The first cut also skipped every `value`, because a
   *  segment option's `value` is the machine id `current` is compared against.
   *  But the TRACE CARD's lines are `{ label, value }`, and that `value` is a
   *  sentence the reader looks straight at — 「値の置き場所: core にひとつ」 was
   *  one of them. Mutant M20 put the codename back into it and this guard stayed
   *  GREEN. So the skip is by PATH: `value` and `current` are machine ids only
   *  inside a `control`, and everywhere else they are words. */
  const MACHINE_KEYS = new Set(['id', 'openingSectionId', 'gate', 'scope', 'state', 'kind'])
  const isMachine = (path: string[]) => {
    const key = path[path.length - 1] ?? ''
    if (MACHINE_KEYS.has(key)) return true
    return (key === 'value' || key === 'current') && path.includes('control')
  }

  const readerText = (node: unknown, path: string[] = []): string[] => {
    if (typeof node === 'string') return isMachine(path) ? [] : [node]
    if (Array.isArray(node)) return node.flatMap((v) => readerText(v, path))
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => readerText(v, [...path, k]))
    }
    return []
  }

  const FORBIDDEN: Array<[string, RegExp]> = [
    ['a build-registry tag', /登録\s*[:：]/],
    ['a circled index', /[①-⑳]/],
    ['the backend codename 「core」', /\bcore\b/i],
    ['a capability token', /settings\.manage|billing\.manage|business\.manage|guard\.override/],
    ['a plane or fixture name', /fixtures-|storeDials|opsConfig|storeBookingPolicy|shiftsPolicy/],
    ['a dial or section id', /guard-mode|min-sellable|coaching-floor|display-language|my-display|store-hours/],
    ['config `=` syntax', /[^\s]=[^\s=]/],
    ['a storage key or a code identifier', /localStorage|synqedBiz|aria-|className/],
  ]

  it('every string in every world’s payload is words, not codes', async () => {
    const worlds: Array<[string, SettingsProps]> = [
      ['manager', await room({ store: STORE_A })],
      ['other store', await room({ store: STORE_B })],
      ['rights-less staff', await room({ role: 'スタッフ' })],
      ['owner', await room({ role: 'オーナー' })],
      ['unknown role', await room({ role: '不明' })],
      ['no dials', await room({ store: STORE_A, dials: null })],
    ]
    const hits: string[] = []
    for (const [world, props] of worlds) {
      const strings = readerText(props)
      // The walk really reaches the room's copy, or every check below is vacuous.
      expect({ world, reaches: strings.length > 40 }).toEqual({ world, reaches: true })
      // ⚠ AND IT REACHES THE EXACT PLACES A SKIP RULE COULD SWALLOW — named, one
      // per shape, because a key-name skip is what hid the trace card once. A
      // collector that quietly stops seeing a field is a guard that passes on
      // nothing, which is worse than no guard at all.
      if (world === 'manager') {
        for (const [shape, sample] of [
          ['a trace-card value', 'ひとつだけ（二か所には持ちません）'],
          ['a dial scope label', '事業全体'],
          ['a readout’s own text', '設定ページ全体でひとつ'],
          ['a 準備中 bullet', '書き出しの権限'],
          ['a switch label', '有給（休憩も含めて計算）'],
        ] as const) {
          expect({ shape, seen: strings.includes(sample) }).toEqual({ shape, seen: true })
        }
        expect(strings.some((s) => s.startsWith('見本データのためスキマガード'))).toBe(true)
      }
      for (const s of strings) {
        for (const [what, re] of FORBIDDEN) {
          if (re.test(s)) hits.push(`${world} · ${what} · ${s.slice(0, 60)}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('the ACCESSIBLE NAME carries the same words and nothing more', () => {
    // A screen reader drops `title` once a description is present, so the reason
    // rides the accessible name — which means a code in the reason is a code
    // spoken aloud on every focus. The name is composed of the dial's own label
    // and its refusal, both of which the scan above covers; this pins that it is
    // composed of exactly those two and never of a third, code-carrying part.
    expect(SCREEN_CODE).toContain("'aria-label': `${label} — ${reason}`")
    expect(SCREEN_CODE).toContain('title: reason,')
    expect(SCREEN_CODE).not.toMatch(/aria-label[^\n]*登録/)
  })

  it('the room’s own SOURCE keeps the codes where codes belong', () => {
    // The registry values are plain names; the numbering lives in comments.
    expect(LIB_CODE).not.toMatch(/登録\s*[:：]/)
    expect(PROPS_CODE).not.toMatch(/登録\s*[:：]/)
    expect(SCREEN_CODE).not.toMatch(/登録\s*[:：]/)
    // …and the refusal table still ties every sentence to a seam, in a field.
    expect(LIB_SRC).toMatch(/seam: '[a-zA-Z]+',/)
    expect(LIB_SRC).toContain('return REFUSAL[dial].seam')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ 8/17 STORE ISOLATION — the clamp is the read', () => {
  it('store-scoped dials move with the lens; business-scoped ones do not', async () => {
    const ginza = await room({ store: STORE_A })
    const daikanyama = await room({ store: STORE_B })
    const STORE_SCOPED = ['breaks-paid', 'win-back', 'coaching-enabled']
    for (const id of STORE_SCOPED) {
      expect({ id, same: currentOf(dialOf(ginza, id)) === currentOf(dialOf(daikanyama, id)) }).toEqual({ id, same: false })
    }
    for (const id of ['guard-mode', 'booking-step', 'block-step', 'min-sellable', 'cash-tolerance']) {
      expect({ id, same: currentOf(dialOf(ginza, id)) === currentOf(dialOf(daikanyama, id)) }).toEqual({ id, same: true })
    }
  })

  it('the OTHER store’s values are nowhere in the payload', async () => {
    const ginza = JSON.stringify(await room({ store: STORE_A }))
    // 代官山 runs a 90-day win-back cycle; 銀座's payload must not carry it.
    expect(storeDials[STORE_B].winBackDays).toBe(90)
    expect(ginza).not.toContain('90日')
    expect(ginza).not.toContain(STORE_B)
  })

  it('every dial states WHICH scope it is — 事業全体 or この店舗, never inferred', async () => {
    const props = await room({ store: STORE_A })
    for (const row of dialsOf(props)) {
      expect({ id: row.id, scope: ['事業全体', 'この店舗'].includes(row.scopeLabel) }).toEqual({ id: row.id, scope: true })
    }
    expect(dialOf(props, 'booking-step').scopeLabel).toBe('事業全体')
    expect(dialOf(props, 'coaching-enabled').scopeLabel).toBe('この店舗')
  })

  it('a world with no dials is a DESIGNED state, not a blank panel', async () => {
    const props = await room({ store: STORE_A, dials: null })
    const section = props.sections.find((s) => s.id === 'store-hours')!
    expect(section.dials).toEqual([])
    expect(section.kicker).toBe('店舗を選んでください')
    expect(section.lead.length).toBeGreaterThan(20)
  })

  it('the screen is keyed by the resolved lens, so an open section cannot survive a switch', () => {
    expect(PAGE_SRC).toContain('<SettingsScreen key={storeKey}')
  })

  // ⚠ ADDED BY THE BATTERY (M6 survived without it). Every other pin here hands
  // the room an EXPLICIT store, so the clamp's real job — deciding what happens
  // when the URL names no store, or names one that is not ours — was held by
  // nothing. A clamp that answered `null` there would open the page on
  // すべての店舗 and turn every store section into 「店舗を選んでください」,
  // which is the ⚖ 8/17 failure from the quiet end rather than the loud one.
  it('no ?store= and an UNKNOWN ?store= both open on a real store, never on すべての店舗', async () => {
    for (const store of [undefined, 'store-that-is-not-ours']) {
      const { props, storeKey } = await settingsProps({ locale: 'ja', store })
      expect({ store, key: storeKey }).not.toEqual({ store, key: 'all-stores' })
      expect({ store, label: props.lensLabel }).not.toEqual({ store, label: 'すべての店舗' })
      // …and the section really carries its dials, rather than the designed
      // no-store panel a null lens would render.
      const hours = props.sections.find((s) => s.id === 'store-hours')!
      expect({ store, dials: hours.dials.length }).toEqual({ store, dials: 5 })
      expect({ store, kicker: hours.kicker }).not.toEqual({ store, kicker: '店舗を選んでください' })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the rail — canon’s IA, and never an option wall', () => {
  it('canon’s five groups, in canon’s order, plus the one row the map asked for', () => {
    const groups: string[] = []
    for (const e of RAIL) if (!groups.includes(e.group)) groups.push(e.group)
    expect(groups).toEqual(['店舗運営', '料金・ポイント', 'Karute設定', 'Reserve設定', '組織・管理'])
    // 顧客・連絡 is room 9's own addition — the map's row #14 needs a home and
    // canon has none. It sits INSIDE an existing group rather than making a
    // sixth, which is the big-tech-simplicity call argued in the build report.
    expect(RAIL.filter((e) => e.label === '顧客・連絡').map((e) => e.group)).toEqual(['店舗運営'])
    expect(RAIL).toHaveLength(20)
  })

  it('every rail row leads somewhere designed — no dead rows, no option wall', async () => {
    const props = await room({ store: STORE_A })
    expect(props.sections.map((s) => s.id)).toEqual(RAIL.map((e) => e.id))
    for (const section of props.sections) {
      const designed =
        section.dials.length > 0 || section.soon !== null || section.prefs || section.boundaryLine !== null
      expect({ id: section.id, designed }).toEqual({ id: section.id, designed: true })
      expect({ id: section.id, titled: section.title.length > 0 }).toEqual({ id: section.id, titled: true })
    }
  })

  it('a 準備中 panel says what will live there AND what is already true today', async () => {
    const props = await room({ store: STORE_A })
    const soon = props.sections.filter((s) => s.soon !== null)
    expect(soon.length).toBeGreaterThanOrEqual(9)
    for (const section of soon) {
      expect({ id: section.id, items: section.soon!.willCarry.length > 0 }).toEqual({ id: section.id, items: true })
      expect({ id: section.id, today: section.soon!.body.length > 10 }).toEqual({ id: section.id, today: true })
      expect({ id: section.id, kicker: section.kicker }).toEqual({ id: section.id, kicker: '準備中' })
    }
  })

  it('every live section in the rail is really built — RAIL and the builder agree', async () => {
    const props = await room({ store: STORE_A })
    for (const entry of RAIL) {
      if (!entry.live || entry.needs === 'business.manage' || entry.needs === 'billing.manage') continue
      const section = props.sections.find((s) => s.id === entry.id)!
      // A live entry whose builder fell through to the 準備中 default would show
      // up here as a soon panel — which is exactly the drift the switch's
      // `default:` arm could hide.
      expect({ id: entry.id, soon: section.soon }).toEqual({ id: entry.id, soon: null })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ the LADDER — three compositions, two thresholds, arithmetic that parses', () => {
  const tokenOf = (name: string) => {
    const m = CSS_CODE.match(new RegExp(`--${name}:\\s*(\\d+)px`))
    if (!m) throw new Error(`token --${name} not declared`)
    return Number(m[1])
  }

  it('each threshold equals the SUM of its own terms plus its stated slack', () => {
    // ⚠ THE NUMBERS ARE PARSED, NEVER RETYPED (room-6 B4-1). Move one term and
    // the threshold has to move with it or this goes red.
    expect(tokenOf('st-what-min') + tokenOf('st-what-gap') + tokenOf('st-ctl-min') + 4).toBe(410)
    expect(tokenOf('st-main-min') + tokenOf('st-cols-gap') + tokenOf('st-aside-min') + 10).toBe(720)
  })

  // ⚠ ADDED BY THE FIX ROUND (DS9-2), AND IT IS WHY THE PIN ABOVE MEANS ANYTHING.
  // `--st-ctl-min` was declared, summed and consumed by NO RULE: the control
  // track was `minmax(0, max-content)`, floor zero, so the threshold pin proved
  // that three numbers add to 380 while the column was free to squeeze to 198 and
  // wrap an orphan chip across 744-791. A term that nothing spends is not a term.
  it('every term of the ①→② threshold is REALLY SPENT by a rule, not just summed', () => {
    const declaration = /--st-ctl-min:\s*\d+px/g
    expect((CSS_CODE.match(declaration) ?? []).length).toBe(1)
    // The control track states the token as its own MINIMUM — that is the whole
    // fix: the threshold now says the ROW fits, not that numbers add up.
    expect(CSS_CODE).toMatch(
      /\.st-dial \{\s*grid-template-columns: minmax\(var\(--st-what-min\), 1fr\) minmax\(var\(--st-ctl-min\), max-content\);/,
    )
    // …and nothing anywhere re-introduces a zero floor on that track.
    expect(CSS_CODE).not.toMatch(/\.st-dial \{[^}]*minmax\(0, max-content\)/)
    // ⚠ AND THE PREFERENCE ROWS TAKE THE SAME FLOOR — measured, after the first
    // cut of this round deliberately left them without one. The probe, once it
    // walked every rail row instead of the section the page opens on, found 密度
    // WRAPPING across main 410-413: a four-pixel band at the bottom of the LEVEL
    // composition, on the one block on this page that really saves. There is ONE
    // level composition, so there is one rule.
    expect(CSS_CODE).toMatch(
      /\.st-pref-row \{\s*grid-template-columns: minmax\(var\(--st-what-min\), 1fr\) minmax\(var\(--st-ctl-min\), max-content\);/,
    )
    expect(CSS_CODE).not.toMatch(/\.st-pref-row \{[^}]*minmax\(0, max-content\)/)
    // …and a segment that must wrap anyway wraps to the RIGHT, in BOTH row
    // kinds, so a spare chip is never orphaned under the first one.
    for (const sel of ['.st-dial > .st-dial-ctl .st-seg', '.st-pref-row > .st-seg']) {
      expect({ sel, endWrapped: CSS_CODE.includes(`${sel} { justify-content: flex-end; }`) }).toEqual({ sel, endWrapped: true })
    }
    // Both other terms are spent by the same rule, in the same block.
    for (const token of ['--st-what-min', '--st-what-gap']) {
      const uses = (CSS_CODE.match(new RegExp(`var\\(${token}\\)`, 'g')) ?? []).length
      expect({ token, uses: uses >= 1 }).toEqual({ token, uses: true })
    }
  })

  it('exactly two container queries, both min-width, one per container', () => {
    const queries = [...CSS_CODE.matchAll(/@container\s+(st-\w+)\s*\(([^)]*)\)/g)].map((m) => [m[1], m[2].trim()])
    // The row shape is stated twice (a dial row and a preference row) against the
    // SAME threshold; the split once. Three blocks, two distinct thresholds.
    expect(queries.map((q) => q.join(' '))).toEqual([
      'st-panel min-width: 720px',
      'st-main min-width: 410px',
      'st-main min-width: 410px',
    ])
    // ⚠ NO `max-width` CONTAINER QUERY ANYWHERE. A max-width band can be left and
    // re-entered on the way up, which is exactly the non-monotonic ladder the
    // gate forbids; every composition here is gained once and never given back.
    expect(CSS_CODE).not.toMatch(/@container[^)]*max-width/)
  })

  it('the ladder is crossed once across the sweep, at the shell’s REAL rail widths', () => {
    // ⚠ THE HARNESS-GEOMETRY LAW, ARITHMETICALLY. `.st-main` is the page minus
    // the shell rail, minus the page's own gutters, minus this room's 220px rail
    // and its 20px gap (from 744 up). The shell rail is 76px collapsed, 264px
    // open, and ALWAYS 76 below 1024 (business-shell.css ≤1023 band).
    const gutter = (page: number) => (page >= 1400 ? 28 : page >= 1024 ? 24 : page >= 744 ? 18 : 14)
    // The PANEL is the second grid track: the page's content box minus this
    // room's 220px rail and the 20px between them, from 744 up (below that the
    // rail is the page and the panel takes the whole width).
    const panel = (page: number, railOpen = false) => {
      const shellRail = page >= 1024 && railOpen ? 264 : 76
      const content = page - shellRail - 2 * gutter(page)
      return page >= 744 ? content - 220 - 20 : content
    }
    // …and MAIN is the panel until the desk composition splits it 2.2 : 1.
    const main = (page: number, railOpen = false) => {
      const p = panel(page, railOpen)
      return p < 720 ? p : ((p - 20) * 2.2) / 3.2
    }

    // ⚠ MONOTONIC IN THE WIDTH THAT DECIDES IT, WHICH IS NOT THE VIEWPORT. At 743
    // the rail IS the page, so a chosen section gets the whole width (main 639);
    // at 744 the rail comes back beside it and the panel is 247px NARROWER (main
    // 392) — a real ① at a wider viewport than the ② right next to it. Checked
    // against a HARDCODED expectation, not one derived by sorting the same values
    // this pin exists to catch: a sort-then-walk is monotonic by construction no
    // matter what `main()` returns, which is why that shape shipped once already
    // (this is the DS9-3 disease) and had to be re-pinned as a literal array.
    const LEVEL_AT = 410
    const widths = [390, 412, 480, 743, 744, 768, 800, 1024, 1180, 1280, 1586]
    const level = widths.map((w) => `${w}:${Math.round(main(w))}:${main(w) >= LEVEL_AT ? '②' : '①'}`)
    expect(level).toEqual([
      '390:286:①', '412:308:①', '480:376:①', '743:639:②',
      '744:392:①', '768:416:②', '800:448:②', '1024:660:②',
      '1180:547:②', '1280:616:②', '1586:821:②',
    ])
    // …and the crossing really happens INSIDE the sweep rather than never.
    expect(level.some((r) => r.endsWith('②')) && level.some((r) => r.endsWith('①'))).toBe(true)
    // ⚠ iPad PORTRAIT IS ②, and 744 split view is ① — named, because that is the
    // pair the fix round moved and the next reader will check it first.
    expect({ p768: main(768) >= LEVEL_AT, split744: main(744) >= LEVEL_AT }).toEqual({ p768: true, split744: false })
    // The 1024 sidebar-OPEN state is the narrowest page the shell can make; it
    // must not drop a composition the closed state at the same width has.
    expect(main(1024, true) >= LEVEL_AT).toBe(true)
    // ②→③ likewise: once, between 1024 and 1180.
    const desk = [390, 743, 744, 800, 1024, 1180, 1280, 1586].map((w) => panel(w) >= 720)
    expect(desk).toEqual([false, false, false, false, false, true, true, true])
    // ⚠ AND THE REFERENCE LAPTOP WITH THE SHELL'S RAIL OPEN, which is the state
    // this product is really read in: 1280 open must reach the desk composition.
    // It did not at the first threshold, and only the shots said so.
    expect(panel(1280, true) >= 720).toBe(true)
    // …and the desk composition never arrives before the level one.
    expect(main(1180) >= LEVEL_AT).toBe(true)
  })

  it('the ONE media-driven swap is the ⚖ list-is-the-page law, and nothing else', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toMatch(/\.st-panel \{ display: none; \}/)
    expect(phone).toMatch(/\.pg-settings\.is-detail \.st-rail \{ display: none; \}/)
    expect(phone).toMatch(/\.pg-settings\.is-detail \.st-panel \{ display: flex; \}/)
    // The rail/panel split is a media rule for the same reason — a device law.
    expect(CSS_CODE).toMatch(/@media \(min-width: 744px\) \{\s*\.biz \.pg-settings \.st-body \{ grid-template-columns: 220px/)
    // …and no media band restates a COMPOSITION the container queries decided.
    const bands = CSS_CODE.slice(CSS_CODE.indexOf('@media (min-width: 1400px)'))
    expect(bands).not.toMatch(/\.st-dial \{[^}]*grid-template-columns/)
    expect(bands).not.toMatch(/\.st-cols \{[^}]*grid-template-columns/)
  })

  it('the ALL-SCREEN ladder states every band the law names', () => {
    for (const band of [
      '@media (min-width: 1400px)',
      '@media (max-width: 1399px)',
      '@media (max-width: 1023px)',
      '@media (max-width: 743px)',
      '@media (min-width: 744px)',
      '@media (prefers-reduced-motion: reduce)',
    ]) {
      expect({ band, present: CSS_SRC.includes(band) }).toEqual({ band, present: true })
    }
  })

  it('≥44px targets from 1023 down — every touch device, not just the phone', () => {
    const touch = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 1023px)'), CSS_CODE.indexOf('@media (max-width: 743px)'))
    for (const sel of ['.st-opt', '.st-help', '.st-switch', '.st-back', '.st-spot-foot button']) {
      expect({ sel, sized: touch.includes(sel) }).toEqual({ sel, sized: true })
    }
    // The rail's own rows are 44 at EVERY width — they are the page on a phone.
    expect(CSS_CODE).toMatch(/\.st-rail-item \{[^}]*min-height: 44px/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ R13 + the one-way accent law — state is not action', () => {
  it('no black-filled anything', () => {
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|#111|#18181b|black)/)
    expect(CSS_CODE).not.toMatch(/background:\s*var\(--ink/)
  })

  it('the accent is spent ONLY where a press really does something', () => {
    // ⚠ THIS IS THE ROOM'S OWN DESIGN RULING, and it is checkable: a refused
    // control's 「current」 mark is a NEUTRAL wash, because it shows how things
    // ARE rather than something the reader chose. The accent goes to the rail
    // (navigation), the ? (opens the tour) and the two live preference controls.
    const accented = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*var\(--st-accent[^}]*\}/g)].map((m) => m[1].trim())
    for (const sel of accented) {
      const live = /st-rail-item|st-help|st-prefs \.st-opt/.test(sel)
      expect({ sel, live }).toEqual({ sel, live: true })
    }
    // …and the refused segment's selected option really is the neutral token.
    expect(CSS_CODE).toMatch(/\.st-opt\[aria-pressed="true"\] \{ background: var\(--st-current-bg\)/)
    expect(CSS_CODE).toMatch(/\.st-prefs \.st-opt\[aria-pressed="true"\] \{ background: var\(--st-accent-wash\)/)
  })

  it('press feedback exists for live controls and NOT for refused ones', () => {
    const active = CSS_CODE.match(/([^{}]+):active,?[\s\S]*?transform: scale\(\.98\)/)
    expect(active).not.toBeNull()
    const block = CSS_CODE.slice(CSS_CODE.indexOf('.st-rail-item:active'), CSS_CODE.indexOf('transform: scale(.98)'))
    expect(block).toContain('.st-prefs .st-opt:active')
    // A refused option must NOT be in the pressed-feedback list: nothing happens
    // when it is pressed, so nothing should look like it did.
    expect(block).not.toMatch(/\.st-dial \.st-opt:active|\.st-seg button:active/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ PAGE-SCROLL + the ring — the sheet’s own structural pins', () => {
  it('not one container in this room owns an axis', () => {
    expect(CSS_CODE).not.toMatch(/overflow-y/)
    expect(CSS_CODE).not.toMatch(/overscroll-behavior/)
    expect(CSS_CODE).not.toMatch(/max-height/)
    expect(CSS_CODE).not.toMatch(/overflow-x/)
  })

  it('NO container holding a focusable clips — a ring the room clips is not a ring', () => {
    const clippers = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*overflow\s*:\s*hidden[^}]*\}/g)].map((m) => m[1].trim())
    expect(clippers).toEqual([])
  })

  it('the room states no width floor of its own — the shell owns that', () => {
    const declarations = CSS_CODE.replace(/@media[^{]*\{/g, '{').replace(/@container[^{]*\{/g, '{')
    expect(declarations).not.toMatch(/min-width\s*:\s*\d{3,}px/)
    expect(CSS_CODE).not.toContain('.biz .app')
  })

  it('the room joins the shell’s 1180px floor opt-in list, and only the SHELL states it', () => {
    const shell = read('src/app/[locale]/(business)/business-shell.css')
    expect(shell).toContain('.biz .app:has(.page.pg-inbox, .page.pg-register, .page.pg-karute, .page.pg-settings) { min-width: 0; }')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE SIBLING-SHEET FENCE, derived FRESH from today’s sheets', () => {
  const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
  /** ⚠ WALKS THE AT-RULES INSTEAD OF SPLITTING BLINDLY (F-K11, room 5). The naive
   *  cut did `src.split('}')` then `slice(0, indexOf('{'))`, and for the FIRST
   *  rule inside any `@media`/`@container` block the first `{` found is the
   *  query's OWN brace — so that selector was never seen at all. A planted
   *  unscoped rule at the top of a media block passed every pin. This parser is
   *  red-proven against exactly that plant, below. */
  const selectorsOf = (src: string) =>
    stripComments(src)
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
    if (d === 'settings') return false
    try {
      readFileSync(join(BIZ, 'business', d, `${d}.css`))
      return true
    } catch {
      return false
    }
  })

  const mine = new Set<string>(['btn', 'primary', 'page'])
  for (const sel of selectorsOf(CSS_SRC)) {
    if (!sel.includes('pg-settings')) continue
    for (const c of classesIn(sel)) if (c !== 'pg-settings') mine.add(c)
  }

  it('the parser really sees the FIRST rule inside a conditional block', () => {
    // A pin that can be true for two reasons is not a pin. This plant is the
    // room-2 BLOCKER's own shape, sitting where the naive parser was blind.
    const plant = '@media (max-width: 743px) {\n  .biz .inspector { display: none; }\n  .biz .pg-settings .st-foo { color: red; }\n}'
    expect(selectorsOf(plant)).toContain('.biz .inspector')
    const planted = '@container st-main (min-width: 380px) {\n  .biz .stray { color: red; }\n}'
    expect(selectorsOf(planted)).toContain('.biz .stray')
  })

  it('the neighbours are all here — EIGHT sheets, read from disk, never restated', () => {
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'customers', 'inbox', 'karute', 'register', 'reservations', 'shifts', 'today'])
  })

  it('every rule is scoped — nothing here can reach a neighbour', () => {
    const unscoped = selectorsOf(CSS_SRC).filter((s) => !s.includes('pg-settings'))
    expect({ unscoped }).toEqual({ unscoped: [] })
    // …and the parser really does see inside conditional blocks, or the pin above
    // is vacuous: this room states rules in six of them.
    expect(selectorsOf(CSS_SRC).length).toBeGreaterThan(
      CSS_SRC.split('}').length - CSS_SRC.split('@media').length - CSS_SRC.split('@container').length,
    )
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
    expect(collisions.sort()).toEqual([
      'customers::.biz .page .btn',
      'reservations::.biz .btn',
      'reservations::.biz .btn.primary',
    ])
    expect(CSS_CODE).toContain('.biz .page.pg-settings .btn { font-weight: 500; }')
    expect(CSS_CODE).toContain('.biz .page.pg-settings .btn.primary { font-weight: 600; }')
  })

  it('the room’s own PAGE rule is four levels — never three, which ties', () => {
    const base = CSS_CODE.slice(0, CSS_CODE.indexOf('@container'))
    expect(base).toContain('.biz .page.pg-settings { padding:')
    expect(base).not.toMatch(/\.biz \.pg-settings \{/)
    expect(base).toContain('.biz .page.pg-settings h1 {')
  })

  it('every class name the SCREEN renders is this room’s own, or one of the shell’s', () => {
    const rendered = new Set<string>()
    for (const m of SCREEN_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const name of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (name && /^[a-z][\w-]*$/.test(name)) rendered.add(name)
      }
    }
    const SHELL = new Set(['page', 'pg-settings', 'btn', 'primary'])
    // ⚠ `is-*` STATE MODIFIERS ARE ALLOWED AND STILL FENCED. They are never
    // stated alone in this sheet (`.st-flag.is-rights`, `.pg-settings.is-detail`),
    // so they carry no rule of their own — and because they DO enter the `mine`
    // set above, a sibling that ever states a bare `.biz .is-on` shows up in the
    // collision list below rather than reaching this room unnoticed.
    const strays = [...rendered].filter((n) => !n.startsWith('st-') && !n.startsWith('is-') && !SHELL.has(n))
    expect(strays).toEqual([])
    expect([...rendered].filter((n) => n.startsWith('st-')).length).toBeGreaterThan(25)
  })

  it('this room’s own names exist NOWHERE else in the family', () => {
    const own = [...mine].filter((n) => n.startsWith('st-'))
    expect(own.length).toBeGreaterThan(25)
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const n of own) {
        expect({ dir, name: n, used: src.includes(`.${n}`) }).toEqual({ dir, name: n, used: false })
      }
    }
    const shell = readFileSync(join(BIZ, 'business-shell.css'), 'utf8')
    for (const n of own) expect({ name: n, inShell: shell.includes(`.${n}`) }).toEqual({ name: n, inShell: false })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the shell one-liners, and the signposts that had to stop saying 準備中', () => {
  it('設定 is live in the rail, and its crumb drops the doubled word', () => {
    const sidebar = read('src/app/[locale]/(business)/BusinessSidebar.tsx')
    expect(sidebar).toContain("{ key: 'settings', segment: 'settings', label: '設定', mini: '設定', live: true }")
    const topbar = read('src/app/[locale]/(business)/BusinessTopbar.tsx')
    expect(topbar).toContain("settings: '設定',")
    // 「設定 / 店 / 設定」 is the same word twice with a store between them, so the
    // group drops for this room only. Every other screen keeps 店舗フロア.
    expect(topbar).toContain('const CRUMB_GROUP: Record<string, string | null> = { settings: null }')
    expect(topbar).toContain("const DEFAULT_GROUP = '店舗フロア'")
    expect(read('src/business/i18n/ja.json')).toContain('"settings"')
  })

  it('the two rooms that pointed at a 準備中 設定 room now point at its section', () => {
    // ⚠ A SIGNPOST THAT OUTLIVES ITS DESTINATION'S OPENING IS A CHECK LYING ABOUT
    // STATE (the ⚖ transplant gate's disease class 10). Flipping the nav made two
    // shipped sentences false, so this round corrected both.
    const today = read('src/app/[locale]/(business)/business/today/TodayScreen.tsx')
    expect(today).toContain('変更は「設定」＞店舗情報・営業時間で')
    expect(today).not.toContain('変更は「設定」ルームで（準備中）')
    const register = read('src/app/[locale]/(business)/business/register/register-props.ts')
    expect(register).toContain('「設定」＞決済')
    expect(register).not.toContain('設定の画面はまだ準備中')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ RECONNECT-READINESS + the three doctrine lines', () => {
  it('the room reads through ONE door and holds no client-side data access', () => {
    expect(PAGE_SRC).toContain('await requireBusinessAdmission()')
    expect(PAGE_SRC).toContain("import { settingsProps } from './settings-props'")
    expect(SCREEN_CODE).not.toMatch(/fixtures|listStore|renderNow|Intl\./)
  })

  it('NOTHING on this page branches on a business type — the note is printed, never obeyed', () => {
    // ⚖ TYPE is Tier 2: the type sets DEFAULTS, and the room says which. A
    // conditional on a business type here would be Tier 3 without the named
    // capability axis the doctrine requires.
    for (const token of ['businessType ===', 'businessType ?', 'switch (type', 'salon', 'seitai']) {
      // ⚠ CODE, NOT PROSE. Read from the comment-stripped sources: the room's own
      // notes are allowed to say the word 「salon」 while explaining a ruling; what
      // the doctrine forbids is a BRANCH on a business type.
      expect({ token, branches: PROPS_CODE.includes(token) || LIB_CODE.includes(token) }).toEqual({ token, branches: false })
    }
  })

  it('the page states its three doctrine lines where the next builder will read them', () => {
    for (const line of ['N-STORES', 'HQ —', 'TYPE —']) {
      expect({ line, stated: PAGE_SRC.includes(line) }).toEqual({ line, stated: true })
    }
  })

  it('the ⚠ merge note on the two facts room 8 also states is present and findable', () => {
    // Both branches are cut from ab8fec28, so `coachingEnabled` and the sample
    // floor exist twice until one of them lands. The note names the duty.
    expect(PLANE_SRC).toContain('⚠ ONE HOME AT MERGE')
    expect(PLANE_SRC).toContain('fixtures-coaching.coachingStores')
  })
})
