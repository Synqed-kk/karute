/**
 * 設定 — the room every other room's setting was promised to.
 *
 * FIRST JOB — THIS ROOM OWNS NO VALUE ANOTHER ROOM ALREADY OWNS. A settings page
 * that kept its own copy of any of them would be the second home the ⚖ one-truth
 * law forbids, and the copy is the one a reader believes. So the census below is
 * asserted as EQUALITIES AGAINST THE WORLD's own planes, never as spot checks —
 * mutate `opsConfig.blockStepMin` and this file goes red, which is exactly what a
 * hardcoded 「15分」 in the props would survive.
 *
 * SECOND JOB — THE STRUCTURAL DUTY (DIAL-HOME-MAP (d)). Canon gates a settings
 * page with ONE page-wide `boundaryPanel`, so a personal preference sitting
 * beside a store policy is gated with it: 「positional discipline, not a rule the
 * markup enforces」. Here `gateOf` answers ONE SECTION, and answers `open` for a
 * self-scoped one BEFORE it looks at access. The battery's own mutant — make the
 * gate page-wide — is killed here from three directions: the rule, the payload a
 * rights-less reader gets, and the screen's source.
 *
 * THIRD JOB — THE DEMO-INTERACTION CENSUS, WHICH REPLACED THE REFUSAL CENSUS
 * (⚖ Liam 2026-09-01, overturning DS-2 and DS-3). The first cut of this room
 * built nine of canon's nineteen pages and refused every store control with its
 * own paragraph; the owner ruled that a settings page that does not work is not
 * a settings page. So the pins here are: EVERY canon page has a section, EVERY
 * section has real content, EVERY control is LIVE and carries a unique id and an
 * accessible name, and the honesty is ONE footnote rather than sixteen refusals.
 * The DEAD-LEVER law is now the star: a control with no observable effect is the
 * defect this suite and the probe hunt together.
 *
 * FOURTH JOB — NO INTERNAL CODE REACHES THE READER. The last describe in this
 * file scans every reader-facing string in every world — including every preview
 * and action sentence AFTER it is filled from the live values — for tags,
 * circled indexes, codenames and capability tokens. That block is the recurrence
 * guard for the room-8 N8-1 class, which this room shipped once. Read it before
 * adding any string.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyticsPolicy, salesTargets } from '@/business/lib/fixtures-analytics'
import { menus, operator, STORE_A, STORE_B, stores } from '@/business/lib/fixtures'
import { cashTolerance, MAX_CASH_TOLERANCE } from '@/business/lib/fixtures-register'
import { AUDIT_CATEGORIES, businessProfiles, rulebook, storeDials } from '@/business/lib/fixtures-settings'
import { shiftsPolicy } from '@/business/lib/fixtures-shifts'
import { closedWeekday, operatingHours, opsConfig, resources, storeBookingPolicy } from '@/business/lib/fixtures-today'
import {
  accessFor,
  addToCollection,
  blockDirty,
  hitOf,
  blockingError,
  changedCount,
  rowChanges,
  rowsOfBlock,
  clampCoachingFloor,
  controlIdsOfBlock,
  dayTitle,
  clampCoachingRetention,
  clampWinBackDays,
  COACHING_FLOOR_MAX,
  COACHING_FLOOR_MIN,
  commitNumberField,
  controlIdsOf,
  fillTemplate,
  firstOpenSection,
  gateOf,
  hhmm,
  labelOfValue,
  PREFS_DEFAULT,
  RAIL,
  readPrefs,
  RETENTION_MAX_MONTHS,
  RETENTION_MIN_MONTHS,
  matchesQuery,
  sameValue,
  searchTextOf,
  sectionById,
  sectionDirty,
  weekDaysOf,
  weeklyHoursPayload,
  WIN_BACK_MAX,
  WIN_BACK_MIN,
  withCurrent,
  type RowControl,
  type RowValue,
  type SettingsProps,
  type SettingsSection,
} from '@/business/lib/settings'
import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'

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
 *  explains in comments the codes it deliberately does not print — so a pin that
 *  scanned the lib for a tag would read the note about the tag as the tag. */
const LIB_CODE = stripLine(stripComments(LIB_SRC))
const PROPS_CODE = stripLine(stripComments(PROPS_SRC))
/** ⚖ S17 FOLD — 予約と確保's server assembly, #812's own page body re-homed. */
const SECTION_PROPS_CODE = stripLine(stripComments(read(`${ROOM_DIR}/store-policy-props.ts`)))
const SECTION_CODE = stripLine(stripComments(read(`${ROOM_DIR}/StorePolicySection.tsx`)))
const SCREEN_CODE = stripLine(stripComments(SCREEN_SRC))
const PLANE_CODE = stripLine(stripComments(PLANE_SRC))

const assemble = async (input?: { store?: string; role?: string; section?: string; dials?: null }) =>
  settingsProps({
    locale: 'ja',
    store: input?.store,
    section: input?.section,
    world: input?.role !== undefined || input?.dials !== undefined ? { role: input?.role, dials: input?.dials } : undefined,
  })

const room = async (input?: { store?: string; role?: string; section?: string; dials?: null }) =>
  (await assemble(input)).props

/** ⚖ S17 FOLD — 予約と確保's own payload. Its five dials are not in the rail's
 *  block vocabulary (they are #812's, rendered by `StorePolicySection`), so the
 *  ONE-TRUTH pins below read them where they now live rather than being
 *  deleted. */
const policyOf = async (input?: { store?: string; role?: string }) => (await assemble(input)).storePolicy

const sectionOf = (props: SettingsProps, id: string): SettingsSection => {
  const s = props.sections.find((x) => x.id === id)
  if (!s) throw new Error(`no section ${id}`)
  return s
}
const controlsOf = (props: SettingsProps): RowControl[] =>
  props.sections.flatMap((s) => s.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls)))
const controlOf = (props: SettingsProps, id: string): RowControl => {
  const c = controlsOf(props).find((x) => x.id === id)
  if (!c) throw new Error(`no control rendered for ${id}`)
  return c
}
const rowsOf = (props: SettingsProps) => props.sections.flatMap((s) => s.blocks.flatMap((b) => b.rows))
const trioRows = (props: SettingsProps) => rowsOf(props).filter((r) => r.trio)
const seedOf = (props: SettingsProps): Record<string, RowValue> =>
  Object.fromEntries(controlsOf(props).map((c) => [c.id, c.value]))

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ ONE TRUTH — every value this room shows is READ from the room that ships it', () => {
  it('the board policy values equal the board’s own plane, value for value', async () => {
    const props = await room({ store: STORE_A })
    // ⚠ EQUALITIES AGAINST THE WORLD, not literals. A props file that spelled
    // 「30分」 would pass a literal check for ever; it cannot pass this one the
    // moment the board's own number moves, which is the mutant the battery runs.
    expect(controlOf(props, 'store-hours.block-step').value).toBe(String(opsConfig.blockStepMin))
    expect(controlOf(props, 'store-hours.release').value).toEqual([...storeBookingPolicy.releaseHeldRoles])
    // ⚖ S17 FOLD — RE-DERIVED, NOT DROPPED. スキマガード・予約の移動単位・販売可能
    // な最小の長さ・確保枠の会員ランク開放・新規のお客様の所要時間 had a second
    // control in this vocabulary and their ONE home is 予約と確保 now, so the
    // equality against the world is asked of the payload that section actually
    // renders. Same plane, same values, one reader.
    const policy = (await policyOf({ store: STORE_A })).policy
    expect(policy.mode).toBe(storeBookingPolicy.gapGuardMode.toUpperCase())
    expect(policy.bookingStepMin).toBe(opsConfig.bookingStepMin)
    expect(policy.gapSelling).toBe(opsConfig.minSellableMin > 0)
    expect(policy.heldRankAccess).toBe(storeBookingPolicy.heldRankAccess)
    expect(policy.newClientMinutes).toBe(storeBookingPolicy.newClientSessionMinutes)
    // …and NOT ONE of them is still offered by the rail's own vocabulary: a
    // second control on one rule is exactly what the fold ended.
    for (const gone of ['store-hours.guard', 'store-hours.booking-step', 'store-hours.min-sellable', 'store-hours.rank', 'services.new-client']) {
      expect({ id: gone, stillHere: controlsOf(props).some((c) => c.id === gone) }).toEqual({ id: gone, stillHere: false })
    }
    expect(controlOf(props, 'reserve.grid').value).toBe(String(opsConfig.reserveStartGridMin))
    expect(controlOf(props, 'reserve.session').value).toBe(String(opsConfig.standardSessionMin))
    expect(controlOf(props, 'reserve.gapfill').value).toBe(String(opsConfig.gapFillMinMin))
    expect(controlOf(props, 'reserve.gapdisc').value).toBe(String(opsConfig.gapFillDiscountPct))
    expect(controlOf(props, 'reserve.lead').value).toBe(String(opsConfig.leadTimeMin))
    expect(controlOf(props, 'people.vip-stays').value).toBe(opsConfig.roomPolicy.vipStaysPrivate)
    expect(controlOf(props, 'people.private-last').value).toBe(opsConfig.roomPolicy.privateIsLastResort)
  })

  it('the money values equal レジ’s and 分析’s own planes, and name their ceilings', async () => {
    const props = await room({ store: STORE_A })
    expect(controlOf(props, 'payments.tolerance').value).toBe(String(cashTolerance))
    const tolerance = rowsOf(props).find((r) => r.id === 'payments.row-tolerance')!
    expect(tolerance.trio!.guardrail).toContain(`¥${MAX_CASH_TOLERANCE.toLocaleString('ja-JP')}`)
    expect(controlOf(props, 'pricing.target').value).toBe(String(salesTargets[STORE_A]))
  })

  it('the 人件費 and 売上分析 gates name the planes’ own role lists rather than restating them', async () => {
    const props = await room({ store: STORE_A })
    const breaks = rowsOf(props).find((r) => r.id === 'store-hours.row-breaks')!
    expect(breaks.trio!.guardrail).toContain(shiftsPolicy.laborCostRoles.join('・'))
    const facts = sectionOf(props, 'staff').blocks.flatMap((b) => b.facts).join(' ')
    expect(facts).toContain(analyticsPolicy.viewRoles.join('・'))
    expect(facts).toContain(storeBookingPolicy.overridePolicy.roles.join('・'))
  })

  it('the roster, the menus, the beds and the hours are the world’s own', async () => {
    const props = await room({ store: STORE_A })
    // 営業時間 is DERIVED from the board's window and its closed weekday, never
    // restated: change either and this goes red.
    expect(controlOf(props, `store-hours.open-${closedWeekday === 1 ? 2 : 1}`).value).toBe(hhmm(operatingHours.open))
    expect(controlOf(props, `store-hours.close-${closedWeekday === 1 ? 2 : 1}`).value).toBe(hhmm(operatingHours.close))
    expect(controlOf(props, `store-hours.day-${closedWeekday}`).value).toBe(false)
    // メニュー: one row per menu this store sells, keyed by the world's own ids.
    const own = menus.filter((m) => m.store_id === STORE_A || m.store_id === null)
    for (const m of own) expect({ id: m.id, has: controlsOf(props).some((c) => c.id === `services.visible-${m.id}`) }).toEqual({ id: m.id, has: true })
    // 設備: one row per bed the board allocates in this store.
    for (const r of resources.filter((r) => r.store_id === STORE_A)) {
      expect(controlOf(props, `people.class-${r.id}`).value).toBe(r.room_class)
      expect(controlOf(props, `people.cleanup-${r.id}`).value).toBe(String(r.cleanup_minutes))
    }
    // 店舗一覧: the business's own stores, not a second list.
    const table = sectionOf(props, 'business-structure')
    void table
    expect(PROPS_CODE).toContain('stores.map((s) => ({')
  })

  it('the ADD-ONLY plane states NOTHING the world already states', () => {
    // The fence, machine-read: if a later round copies a world number into this
    // room's plane, the name it would have to use appears here and fails.
    for (const forbidden of [
      'gapGuardMode',
      'bookingStepMin',
      'blockStepMin',
      'minSellableMin',
      'overridePolicy',
      'releaseHeldRoles',
      'heldRankAccess',
      'newClientSessionMinutes',
      'reserveStartGridMin',
      'gapFillMinMin',
      'standardSessionMin',
      'leadTimeMin',
      'roomPolicy',
      'operatingHours',
      'closedWeekday',
      'cashTolerance',
      'laborCostRoles',
      'hourlyWage',
      'salesTargets',
      'viewRoles',
    ]) {
      expect({ forbidden, inPlane: PLANE_CODE.includes(forbidden) }).toEqual({ forbidden, inPlane: false })
    }
    // …and it imports the world's ids ONLY — a plane that imported a derivation
    // could restate a fact instead of adding one.
    expect(PLANE_CODE).toContain("import { STORE_A, STORE_B } from './fixtures'")
    expect(PLANE_CODE.match(/^import /gm) ?? []).toHaveLength(1)
  })

  it('the props file reads the planes, and spells no world value of its own', () => {
    // ⚖ S17 FOLD — RE-DERIVED. `storeBookingPolicy.gapGuardMode`,
    // `opsConfig.bookingStepMin` and `opsConfig.minSellableMin` left this file
    // with the controls they fed; they are read by 予約と確保's own assembly now,
    // and the pin follows them there rather than being dropped.
    for (const source of ['gapGuardMode', 'bookingStepMin', 'minSellableMin', 'heldRankAccess', 'newClientSessionMin']) {
      expect({ source, read: SECTION_PROPS_CODE.includes(source) }).toEqual({ source, read: true })
    }
    for (const source of [
      'opsConfig.blockStepMin',
      'opsConfig.reserveStartGridMin',
      'opsConfig.roomPolicy',
      'operatingHours.open',
      'closedWeekday',
      'cashTolerance',
      'MAX_CASH_TOLERANCE',
      'shiftsPolicy.laborCostRoles',
      'analyticsPolicy.viewRoles',
      'salesTargets',
      'storeDials',
    ]) {
      expect({ source, read: PROPS_CODE.includes(source) }).toEqual({ source, read: true })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE STRUCTURAL DUTY — gating is SECTION-scoped, and cannot be made page-wide', () => {
  const NOBODY = accessFor('スタッフ', rulebook)
  const MANAGER = accessFor(operator.role, rulebook)

  it('a self-scoped section is open to a reader who holds no settings right', () => {
    const mine = sectionById('my-display')!
    expect(mine.scope).toBe('self')
    expect(gateOf(mine, NOBODY)).toBe('open')
    // …and it does not merely happen to be open: the rule never asks.
    const exploding = { role: 'スタッフ', has: () => { throw new Error('gateOf asked access about a self section') } }
    expect(gateOf(mine, exploding)).toBe('open')
  })

  it('the same reader gets NO gated store section, and still gets their own', async () => {
    const props = await room({ role: 'スタッフ' })
    const open = props.sections.filter((s) => s.gate === 'open').map((s) => s.id)
    // ⚠ canon's OWN gating, carried: 録音設定 and データ入出力 say in canon's own
    // words 「このページは誰でも開けます」, so a rights-less reader gets those two
    // and their own preferences — and nothing else. That is a SECOND proof the
    // gate is not page-wide: three different answers on one rail, for one reader.
    expect(open).toEqual(['recording', 'data-io', 'my-display'])
    expect(sectionOf(props, 'my-display').persist).toBe('local')
    // ⚠ AND THE RAIL STILL WORKS: hiding the whole page from a staff member is
    // the same defect wearing a different coat.
    expect(props.rail).toHaveLength(RAIL.length)
    expect(props.openingSectionId).toBe('recording')
  })

  it('a closed section carries NO content in the payload — never content a class hides', async () => {
    const props = await room({ role: 'スタッフ' })
    for (const section of props.sections) {
      if (section.gate === 'open') continue
      expect({ id: section.id, blocks: section.blocks.length, aside: section.aside }).toEqual({ id: section.id, blocks: 0, aside: null })
    }
    // Not one guardrail or store value from a gated section reaches a reader who
    // may read none of them.
    const payload = JSON.stringify(props)
    expect(payload).not.toContain('スキマガード')
    expect(payload).not.toContain('現金差異の承認しきい値')
  })

  it('a boundary is a SENTENCE with a reason, naming the reader’s own role', async () => {
    for (const [role, ids] of [
      ['店舗管理者', ['business-structure', 'billing']],
      ['スタッフ', ['store-hours', 'coaching', 'staff']],
    ] as const) {
      const props = await room({ store: STORE_A, role })
      for (const id of ids) {
        const s = sectionOf(props, id)
        expect({ role, id, gate: s.gate }).toEqual({ role, id, gate: 'no-rights' })
        const line = s.boundaryLine ?? ''
        // ⚠ 「権限がありません」 ON ITS OWN IS NOT A REASON. The sentence has to
        // name WHO is reading and WHAT would open it, or the reader is told they
        // are locked out and nothing else.
        expect({ role, id, names: line.includes(s.label) }).toEqual({ role, id, names: true })
        expect({ role, id, long: line.length >= 40 }).toEqual({ role, id, long: true })
        expect({ role, id, whose: line.includes(role) }).toEqual({ role, id, whose: true })
      }
    }
    // …and 事業構成's own sentence carries the truth (c)2 records: the permission
    // exists, but a store cannot hand it out from the capability grid.
    const asManager = await room({ store: STORE_A })
    // ⚖ S17 · C7 — RE-PINNED, AND THE SECOND HALF SAYS THE OPPOSITE OF WHAT IT
    // DID. The sentence used to end 「権限の一覧からは配れません」 on the first
    // cut's reading of canon's staff MOCK; `business.manage` is capability #2 of
    // the product's eighteen, owner-only BY DEFAULT and grantable per staff
    // member (`src/lib/auth/permissions.ts:16`, excluded from the manager preset
    // at `:76`, never stripped by `effectiveCapabilities()`). Telling a manager a
    // permission cannot be handed out, when it can, is a closed door that is open.
    expect(sectionOf(asManager, 'business-structure').boundaryLine).toContain('「事業の管理」の権限を持つ人です')
    expect(sectionOf(asManager, 'business-structure').boundaryLine).toContain('権限の一覧から配れます')
    expect(sectionOf(asManager, 'business-structure').boundaryLine).not.toContain('配れません')
  })

  it('a rights-less reader gets the INERT half of the pages canon opens to everyone', async () => {
    const props = await room({ role: 'スタッフ' })
    const org = sectionOf(props, 'recording').blocks.find((b) => b.id === 'recording.org')!
    // canon's own inline 権限がありません strip, and the controls inside it are
    // locked with a VISIBLE reason rather than removed — a reader is told what
    // the store's policy is even when they cannot change it.
    expect(org.rightsNote).toContain('権限がありません')
    expect(org.rows.every((r) => r.controls.every((c) => typeof c.locked === 'string'))).toBe(true)
    // …while their own voice registration, in the same section, is NOT locked.
    const voice = sectionOf(props, 'recording').blocks.find((b) => b.id === 'recording.voice')!
    expect(voice.rows[0].controls[0].locked).toBeUndefined()
    // …and 書き出し refuses with its own reason and drops its action button.
    const exportBlock = sectionOf(props, 'data-io').blocks.find((b) => b.id === 'io.export')!
    expect(exportBlock.action).toBeNull()
    expect(exportBlock.rightsNote).toContain('権限がありません')
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
    expect(SCREEN_CODE.indexOf('className="st-rail"')).toBeLessThan(SCREEN_CODE.indexOf("section.gate === 'no-rights' ?"))
    // The sheet cannot undo it either: no rule hides the body or a block.
    expect(CSS_CODE).not.toMatch(/\.pg-settings\.is-locked/)
    expect(CSS_CODE).not.toMatch(/\.st-body\s*\{[^}]*display:\s*none/)
  })

  it('a manager opens the store sections, and 事業構成 / 契約・請求 keep canon’s own gating', () => {
    expect(gateOf(sectionById('store-hours')!, MANAGER)).toBe('open')
    expect(gateOf(sectionById('business-structure')!, MANAGER)).toBe('no-rights')
    expect(gateOf(sectionById('billing')!, MANAGER)).toBe('no-rights')
    // ⚠ `business.manage` IS NOT ONE OF CANON'S EIGHT (DIAL-HOME-MAP (c)2), and
    // that is a statement about the MATRIX, not about who holds it: canon's own
    // roster comment reasons that the demo persona is denied 事業構成 and
    // 契約・請求 「i.e. no business.manage, which rules out owner」. So an owner
    // opens it, nobody can be granted it from the capability grid, and the
    // boundary sentence says exactly that.
    for (const role of ['店舗管理者', 'スタッフ', '不明']) {
      expect({ role, open: gateOf(sectionById('business-structure')!, accessFor(role, rulebook)) }).toEqual({ role, open: 'no-rights' })
    }
    expect(gateOf(sectionById('business-structure')!, accessFor('オーナー', rulebook))).toBe('open')
    expect(gateOf(sectionById('billing')!, accessFor('オーナー', rulebook))).toBe('open')
    // ⚖ S17 · C7 — RE-PINNED, AND THE CLAIM IS THE OPPOSITE OF WHAT IT WAS.
    // The old pin asserted `business.manage` is NOT in the grid, on the first
    // cut's reading of canon's staff MOCK. The product's own list has it as
    // capability #2 (`src/lib/auth/permissions.ts:16`), owner-only BY DEFAULT
    // and grantable per staff member — so it IS in the grid, and the boundary
    // sentence says how it is handed out rather than that it cannot be.
    expect(rulebook.capabilities.map((c) => c.token)).toContain('business.manage')
    expect(rulebook.grants.owner).toContain('business.manage')
    expect(rulebook.grants.manager).not.toContain('business.manage')
  })

  it('an unknown role holds nothing — never a default grant', () => {
    expect(accessFor('不明', rulebook).has('settings.manage')).toBe(false)
    expect(firstOpenSection(accessFor('不明', rulebook))?.id).toBe('recording')
    // …and the presets are KARUTE's own, unedited (⚖ C7).
    expect(rulebook.grants.manager).toContain('settings.manage')
    expect(rulebook.grants.practitioner).not.toContain('settings.manage')
    expect(rulebook.grants.owner).toContain('billing.manage')
    expect(rulebook.grants.manager).not.toContain('billing.manage')
    // ⚠ `custom` IS A REAL ROLE AND IT STARTS EMPTY — Karute's own 「blank
    // canvas」 (`permissions.ts:88`). A role the room dropped is a role a store
    // cannot give anyone.
    expect(rulebook.grants.custom).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⚖ THE OWNER'S OWN BAR (2026-09-01): every canon page built, every control live.
describe('⚖ EVERY CANON PAGE IS BUILT, AND EVERY CONTROL MOVES', () => {
  /** canon's nineteen pages, by the label its own rail gives them. */
  const CANON_PAGES = [
    '店舗情報・営業時間', '提供内容', '人・設備', '決済', '事業構成', '料金・ポイント',
    'AI設定', '録音設定', 'コーチング', '予約同期', 'Reserve 受付', '通知',
    'スタッフ管理', '外部連携', 'データ入出力', '監査ログ', '言語・表示', '色・テーマ', '契約・請求',
  ]

  it('every one of canon’s nineteen pages has a rail row of its own', () => {
    const labels = RAIL.map((e) => e.label)
    for (const page of CANON_PAGES) {
      expect({ page, onRail: labels.includes(page) }).toEqual({ page, onRail: true })
    }
    // …plus the three this room adds, and nothing else. ⚖ S17 FOLD — 予約と確保
    // is the third: canon has no page for it because it is #812's room, which
    // arrived as ONE section of this rail rather than as a second 設定 route at
    // the same path. It sits SECOND, right after 店舗情報・営業時間.
    expect(labels.filter((l) => !CANON_PAGES.includes(l))).toEqual(['予約と確保', '顧客・連絡', '自分の表示設定'])
    expect(labels[1]).toBe('予約と確保')
    expect(RAIL).toHaveLength(22)
  })

  it('NOT ONE SECTION IS A STUB — every open section carries real content', async () => {
    for (const role of ['店舗管理者', 'オーナー']) {
      const props = await room({ store: STORE_A, role })
      for (const s of props.sections) {
        if (s.gate !== 'open') continue
        // ⚖ S17 FOLD — THE ONE SECTION THAT IS NOT BUILT FROM THIS VOCABULARY,
        // and it is the opposite of a stub: 予約と確保 is #812's whole room, and
        // `StorePolicySection` renders its presets, its live card and its eight
        // dials from `storePolicyProps()`'s payload. Its substance is asserted
        // directly below, against that payload, rather than against blocks it
        // deliberately does not have.
        if (s.id === 'booking-guard') continue
        const rows = s.blocks.reduce((n, b) => n + b.rows.length, 0)
        const substance = s.blocks.reduce((n, b) => n + b.rows.length + b.facts.length + (b.list ? 1 : 0) + (b.table ? 1 : 0), 0)
        expect({ role, id: s.id, blocks: s.blocks.length > 0 }).toEqual({ role, id: s.id, blocks: true })
        expect({ role, id: s.id, substance: substance >= 2 }).toEqual({ role, id: s.id, substance: true })
        expect({ role, id: s.id, aside: s.aside !== null }).toEqual({ role, id: s.id, aside: true })
        void rows
      }
    }
    // ⚠ AND THE WORD ITSELF IS GONE FROM EVERY SECTION TITLE AND LEAD. The owner
    // read 「準備中」 on ten rail rows and ruled the room rebuilt; a section that
    // reintroduced the stub would say so here.
    const props = await room({ store: STORE_A })
    for (const s of props.sections) {
      expect({ id: s.id, stub: `${s.kicker} ${s.title} ${s.lead}`.includes('準備中') }).toEqual({ id: s.id, stub: false })
    }
    // ⚖ S17 FOLD — AND 予約と確保 IS THE OPPOSITE OF A STUB, proven where its
    // substance actually lives. Its section head carries a real kicker, title,
    // lead and tour declaration; its payload carries the store's own eight dial
    // values, its roster and its save answer; and its screen renders eight dial
    // rows plus the presets, the live card and 保存.
    const head = sectionOf(props, 'booking-guard')
    expect(head.title).toBe('予約と確保')
    expect(head.kicker).toBe('店舗運営')
    expect(head.lead.length).toBeGreaterThan(20)
    expect((head.guide ?? '').length).toBeGreaterThan(20)
    const section = await policyOf({ store: STORE_A })
    // ⚖ S17 · C12 — TEN, not nine: `minSellableMin` joined the payload so the
    // すき間の販売 row can print the length behind its switch as a RECEIPT
    // (「販売可能な最小の長さ 30分（今日の運営の値）」) rather than the room growing
    // a second control for a value core has no int field for yet.
    expect(Object.keys(section.policy)).toHaveLength(10)
    expect(Object.keys(section.policy)).toContain('minSellableMin')
    expect(SECTION_CODE).toContain('販売可能な最小の長さ {props.policy.minSellableMin}分（今日の運営の値）')
    expect(section.save.roles.length).toBeGreaterThan(0)
    for (const dial of ['上書きの権限', '名指しロック', '長押しで確定', '店長のみでも警告を止める', 'すき間の販売', '新規のお客様の確保', '確保枠の会員ランク開放', '予約の刻み', '保存']) {
      expect({ dial, declared: SECTION_CODE.includes(`data-guide-title="${dial}"`) }).toEqual({ dial, declared: true })
    }
  })

  it('⚖ S17 — the cross-link rows are the ONE home’s address, and they really navigate', async () => {
    // ⚖ ONE RULE ONE HOME. Five controls left this vocabulary; two rows stand in
    // their place, and a row that says where a rule is decided and cannot take
    // the reader there is a signpost with no road.
    const props = await room({ store: STORE_A })
    const linked = rowsOf(props).filter((r) => r.link)
    expect(linked.map((r) => r.id).sort()).toEqual(['services.row-new-client-moved', 'store-hours.row-guard-moved'])
    for (const r of linked) {
      expect({ id: r.id, to: r.link!.sectionId }).toEqual({ id: r.id, to: 'booking-guard' })
      // ⚖ LABEL TRUTH — the link OPENS, it never promises to change anything.
      expect({ id: r.id, label: r.link!.label }).toEqual({ id: r.id, label: '予約と確保を開く' })
      expect({ id: r.id, says: r.label.includes('「予約と確保」で決めます') }).toEqual({ id: r.id, says: true })
      // …and it is a signpost, not a second control.
      expect({ id: r.id, controls: r.controls.length }).toEqual({ id: r.id, controls: 0 })
    }
    // FIRST in its own block, so the address is met before the dials that stayed.
    const ops = sectionOf(props, 'store-hours').blocks.find((b) => b.id === 'store-hours.ops')!
    expect(ops.rows[0].id).toBe('store-hours.row-guard-moved')
    // …the destination is a real rail row…
    expect(RAIL.some((e) => e.id === 'booking-guard')).toBe(true)
    // …and the screen renders the address as a REAL button that navigates (⚖ the
    // keyboard-reach law: a tap-to-open control ships focusable).
    expect(SCREEN_CODE).toContain('onClick={() => onLink(row.link!.sectionId)}')
    expect(SCREEN_CODE).toContain('<button type="button" className="st-link"')
  })

  it('every control is LIVE, uniquely keyed, and carries an accessible name', async () => {
    const props = await room({ store: STORE_A, role: 'オーナー' })
    const controls = controlsOf(props)
    // A settings page whose controls do not outnumber its sections is a page of
    // headings. Nineteen canon pages carry well over a hundred controls.
    expect(controls.length).toBeGreaterThan(100)
    const ids = controls.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of controls) {
      expect({ id: c.id, aria: c.aria.length > 0 }).toEqual({ id: c.id, aria: true })
      // A `readout` is the ONE shape that is not a lever — it is a fact the room
      // shows and no reader can change. Everything else must be operable.
      const operable = c.control.kind !== 'readout'
      expect({ id: c.id, operable: operable || c.control.kind === 'readout' }).toEqual({ id: c.id, operable: true })
    }
    // …and the readouts are the small minority they are meant to be.
    const readouts = controls.filter((c) => c.control.kind === 'readout')
    expect(readouts.length).toBeLessThan(controls.length / 10)
  })

  it('every section that can go dirty CAN go dirty — the save bar is reachable from every one', async () => {
    const props = await room({ store: STORE_A, role: 'オーナー' })
    const seed = seedOf(props)
    for (const s of props.sections) {
      if (s.gate !== 'open' || s.persist === 'local') continue
      // ⚖ S17 FOLD / A3 — 予約と確保 DOES NOT USE THIS SAVE BAR, and that is a
      // ruling rather than an omission: its 保存 is #812's own, gated by the
      // seam's `saveRefusal` answer. The rail's demo-local dirty/保存 grammar
      // beside it would be a second, contradicting save story on one section.
      if (s.id === 'booking-guard') continue
      const ids = controlIdsOf(s)
      expect({ id: s.id, controls: ids.length > 0 }).toEqual({ id: s.id, controls: true })
      // Clean at rest…
      expect({ id: s.id, dirty: sectionDirty(s, seed, seed) }).toEqual({ id: s.id, dirty: false })
      // …and dirty the moment ANY one of its controls moves. A section whose
      // save button could never light up is a section whose controls are dead.
      const moved = { ...seed, [ids[0]]: flip(seed[ids[0]]) }
      expect({ id: s.id, dirty: sectionDirty(s, moved, seed) }).toEqual({ id: s.id, dirty: true })
    }
  })

  it('the honest frame is ONE footnote, not a refusal under every row', async () => {
    const props = await room({ store: STORE_A })
    expect(props.demoSaveLine).toBe('保存はこの画面の中だけに反映されます（実データ接続後に本保存）。')
    expect(props.dateline).toContain('サンプルデータ')
    // The screen prints it on store sections and the SELF line on the self one —
    // printing 「実データ接続後に本保存」 under a block that really does save
    // would be the page contradicting the control the reader just used.
    expect(SCREEN_CODE).toContain('{props.selfSaveLine}')
    expect(SCREEN_CODE).toContain('{props.demoSaveLine}')
    expect(SCREEN_CODE).toContain("section.persist === 'local' ?")
    // ⚠ AND THE RETIRED REFUSALS ARE REALLY GONE — from the payload and from the
    // room's own source. The room used to carry sixteen 「見本データのため…変えら
    // れません」 paragraphs; the owner overturned that, and this is the pin that
    // stops a later round quietly bringing one back.
    const payload = JSON.stringify(props)
    expect(payload).not.toContain('見本データのため')
    expect(payload).not.toContain('保存先をつないだあとに変更できます')
    expect(payload).not.toContain('この画面からは保存できません')
    expect(PROPS_CODE).not.toContain('見本データのため')
    expect(LIB_CODE).not.toMatch(/REFUSAL|refusalFor|seamFor/)
  })

  it('a preview sentence really moves — every template resolves against LIVE values', async () => {
    const props = await room({ store: STORE_A, role: 'オーナー' })
    const seed = seedOf(props)
    const kinds = Object.fromEntries(controlsOf(props).map((c) => [c.id, c.control]))
    const label = (values: Record<string, RowValue>) => (id: string) =>
      kinds[id] ? labelOfValue(kinds[id], values[id]) : null

    const previews = props.sections.flatMap((s) => s.blocks.filter((b) => b.preview).map((b) => [s.id, b] as const))
    expect(previews.length).toBeGreaterThan(12)
    for (const [sectionId, b] of previews) {
      const rendered = fillTemplate(b.preview!.template, label(seed))
      // ⚠ A TEMPLATE WHOSE TERM NEVER RESOLVED IS A DEAD PREVIEW. `fillTemplate`
      // leaves an unknown id UNTOUCHED on purpose, so a typo shows up here as
      // the brace itself rather than as a silently shorter sentence.
      expect({ sectionId, id: b.id, unresolved: /\{[a-z0-9.-]+\}/i.test(rendered) }).toEqual({ sectionId, id: b.id, unresolved: false })
      // …and it really CHANGES when one of its own controls changes.
      const term = [...b.preview!.template.matchAll(/\{([a-z0-9.-]+)\}/gi)].map((m) => m[1])[0]
      const moved = { ...seed, [term]: flip(seed[term]) }
      expect({ sectionId, id: b.id, moves: fillTemplate(b.preview!.template, label(moved)) !== rendered })
        .toEqual({ sectionId, id: b.id, moves: true })
    }
  })

  it('an action button says what it did, and refuses an empty required input', async () => {
    const props = await room({ store: STORE_A })
    const actions = props.sections.flatMap((s) => s.blocks.filter((b) => b.action))
    expect(actions.length).toBeGreaterThanOrEqual(2)
    for (const b of actions) {
      expect({ id: b.id, label: b.action!.label.length > 0 }).toEqual({ id: b.id, label: true })
      expect({ id: b.id, says: b.action!.template.length > 10 }).toEqual({ id: b.id, says: true })
      if (b.action!.requires) {
        expect({ id: b.id, why: (b.action!.requireError ?? '').length > 0 }).toEqual({ id: b.id, why: true })
      }
    }
  })

  it('the 監査ログ table really filters, and says so when nothing matches', async () => {
    const props = await room({ store: STORE_A })
    const block = sectionOf(props, 'audit-log').blocks.find((b) => b.id === 'audit.rows')!
    expect(block.filterBy).toEqual(['audit.period', 'audit.category'])
    expect(block.table!.rows.length).toBeGreaterThan(5)
    // Every row belongs to its own category AND to every period it is inside —
    // so 「今日」 and 「30日」 are both true of a row from today.
    for (const r of block.table!.rows) {
      expect({ tags: r.tags, has30: r.tags.includes('30') }).toEqual({ tags: r.tags, has30: true })
    }
    const today = block.table!.rows.filter((r) => r.tags.includes('0'))
    expect(today.length).toBeGreaterThan(0)
    expect(today.length).toBeLessThan(block.table!.rows.length)
    // …and the empty state is a designed sentence, in the screen.
    expect(SCREEN_CODE).toContain('この条件に一致する記録はありません')
  })

  it('a cross-link names a REAL rail row, so every link really navigates', async () => {
    const props = await room({ store: STORE_A, role: 'オーナー' })
    const ids = new Set(RAIL.map((e) => e.id))
    const links = props.sections.flatMap((s) => s.blocks.flatMap((b) => b.links))
    expect(links.length).toBeGreaterThan(10)
    for (const l of links) {
      expect({ to: l.sectionId, real: ids.has(l.sectionId) }).toEqual({ to: l.sectionId, real: true })
      expect({ to: l.sectionId, labelled: l.label.length > 0 }).toEqual({ to: l.sectionId, labelled: true })
    }
    // …and the screen turns them into a press that opens that section.
    expect(SCREEN_CODE).toContain('onClick={() => onLink(l.sectionId)}')
  })

  it('a link from ANOTHER room lands on the section it pointed at', async () => {
    const props = await room({ store: STORE_A, section: 'payments' })
    expect(props.openingSectionId).toBe('payments')
    // …and an unknown or gated target falls back to a section this reader may
    // actually open, rather than dropping them on a boundary they did not ask for.
    expect((await room({ store: STORE_A, section: 'not-a-section' })).openingSectionId).toBe('store-hours')
    expect((await room({ store: STORE_A, section: 'billing' })).openingSectionId).toBe('store-hours')
    expect((await room({ store: STORE_A, section: 'billing', role: 'オーナー' })).openingSectionId).toBe('billing')
    expect(PAGE_SRC).toContain('section: query.section')

    // ⚖ S17 fix round 4 · H1 — …AND THE PAGE SAYS WHETHER THAT WAS THE READER'S
    // ASK. `openingSectionId` alone cannot answer it: it is non-null on every
    // load, so a screen reading it as 「the reader asked for this」 would open
    // every phone in detail mode, and a screen ignoring it dropped a deep link
    // on the list. Two questions, two fields, both settled on the server.
    expect((await room({ store: STORE_A, section: 'payments' })).openedByUrl).toBe(true)
    expect((await room({ store: STORE_A })).openedByUrl).toBe(false)
    // …a target this reader may not open is NOT their ask — they get the
    // fallback section, and the page opens the way it always does.
    expect((await room({ store: STORE_A, section: 'billing' })).openedByUrl).toBe(false)
    expect((await room({ store: STORE_A, section: 'not-a-section' })).openedByUrl).toBe(false)
    expect((await room({ store: STORE_A, section: 'billing', role: 'オーナー' })).openedByUrl).toBe(true)
  })

  // ⚖ S17 · C7 — RE-DERIVED. The pin used to assert EIGHT capabilities, taken
  // from canon's staff MOCK's `CAP_ORDER`; the product's own list is EIGHTEEN.
  it('the staff matrix is KARUTE’s own eighteen capabilities, in plain words', async () => {
    const props = await room({ store: STORE_A })
    const grid = controlsOf(props).find((c) => c.id.startsWith('staff.caps-'))!
    expect(grid.control.kind).toBe('chips')
    const options = grid.control.kind === 'chips' ? grid.control.options : []
    expect(options.map((o) => o.value)).toEqual(rulebook.capabilities.map((c) => c.token))
    expect(options).toHaveLength(18)
    // ⚠ AND NOT ONE OF THEM IS SPELLED AS A TOKEN. Karute's own file carries the
    // tokens with English comments; ⚖ 「plain names, never codes」 means the grid
    // wears the product's own language (S9L-2, kept).
    for (const o of options) {
      expect({ value: o.value, plain: !/\./.test(o.label) && o.label.length > 0 })
        .toEqual({ value: o.value, plain: true })
    }
    // ⚠ AND IT IS A GRID, NOT A RAG (⚖ mock D9): eighteen chips wrapping freely
    // is the readability defect this round is for.
    expect(grid.control.kind === 'chips' && grid.control.grid).toBe(true)
  })

  // ⚖ S17 · C7 — THE PIN THAT MAKES THE MIRROR REAL. Business territory may not
  // import `src/lib/**`, so the rulebook is COPIED with its cite; this reads
  // Karute's own file off disk and asserts the copy still matches it. A drift on
  // either side goes red the day it lands, which is the whole difference between
  // a mirrored contract and a stale one.
  it('⚖ C7 — the rulebook still equals Karute’s own permissions.ts', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/auth/permissions.ts'), 'utf8')
    const caps = src.slice(src.indexOf('export const CAPABILITIES = ['), src.indexOf('] as const', src.indexOf('export const CAPABILITIES = [')))
    const tokens = [...caps.matchAll(/^\s*'([a-z]+\.[a-zA-Z]+)',/gm)].map((m) => m[1])
    expect(tokens).toEqual(rulebook.capabilities.map((c) => c.token))
    expect(tokens).toHaveLength(18)

    const roles = src.slice(src.indexOf('export const PERMISSION_ROLES = ['), src.indexOf('] as const', src.indexOf('export const PERMISSION_ROLES = [')))
    const roleKeys = [...roles.matchAll(/^\s*'([a-z]+)',/gm)].map((m) => m[1])
    expect(roleKeys).toEqual(rulebook.roles.map((r) => r.key))
    // ⚠ SIX ADOPTED. Karute's own `PERMISSION_ROLES` (`permissions.ts:51-58`) is
    // where a role gets a preset grant behind it, and it names six. The WIRE
    // names nine — see the pin below, which is the half this one cannot see.
    expect(roleKeys).toHaveLength(6)
  })

  // ⚖ S17 · C7 / F1 — THE SECOND HALF OF THE SAME CONTRACT, READ FROM THE WIRE.
  //
  // ⚠ THE FIRST CUT OF THIS ROUND GOT THIS WRONG, AND THE WAY IT GOT IT WRONG IS
  // the reason this pin exists: it grepped KARUTE'S TREE for `PermissionRoleKey`,
  // found nothing, and wrote 「there is no such symbol anywhere on origin/main」.
  // True of that tree — and false as a statement about the CONTRACT, which lives
  // in the SDK. A room that mirrors a wire has to read the wire.
  it('⚖ C7/F1 — the nine role keys still equal the SDK’s own PermissionRoleKey', () => {
    const dts = readFileSync(join(process.cwd(), 'node_modules/@synqed-kk/client/dist/types.d.ts'), 'utf8')
    const line = dts.slice(dts.indexOf('export type PermissionRoleKey'))
    const decl = line.slice(0, line.indexOf(';'))
    const keys = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(keys).toEqual([
      'owner', 'manager', 'senior', 'practitioner', 'frontdesk', 'custom',
      'area_manager', 'trainee', 'accountant',
    ])
    expect(keys).toHaveLength(9)
    // …and the room's own two lists ADD UP to it, with nothing invented and
    // nothing dropped: the six it OFFERS plus the three it only NAMES.
    expect([...rulebook.roles.map((r) => r.key), ...rulebook.unadoptedRoleKeys].sort()).toEqual([...keys].sort())
    // ⚠ THE THREE CARRY NO JAPANESE LABEL, deliberately. A label is a promise
    // that the role can be chosen, and none of these can be yet — Karute has no
    // preset grant for any of them, so a store selecting one would be handing
    // somebody a role with no capabilities behind it.
    for (const k of rulebook.unadoptedRoleKeys) {
      expect({ key: k, offered: rulebook.roles.some((r) => r.key === k) }).toEqual({ key: k, offered: false })
      expect({ key: k, granted: rulebook.grants[k] !== undefined }).toEqual({ key: k, granted: false })
    }
    // …and the rulebook the reconnect will call for is the one named here, so
    // the swap is a call rather than a re-read of this file.
    expect(dts).toContain('export interface PermissionRulebook')
    expect(dts).toContain('roles: PermissionRoleKey[];')
    expect(dts).toContain('presets: Record<PermissionRoleKey, string[]>;')
  })

  // ⚖ S17 · F6 — AND THE PAGE SAYS SO IN JAPANESE, NOT IN WIRE KEYS.
  // The first cut printed `area_manager / trainee / accountant` inside the
  // sentence. The counts are the reader's half of this contract; the keys are
  // the SDK pin's half (above). This pin holds both halves of that split, so a
  // later hand cannot put the identifiers back into the copy and cannot drop
  // the count that makes the sentence true.
  it('⚖ C7/F1/F6 — and the page SAYS how many, in Japanese, where the roles are chosen', async () => {
    const props = await room({ store: STORE_A })
    const roster = rowsOf(props).find((r) => r.id.startsWith('staff.row-') && r.controls.some((c) => c.id.startsWith('staff.preset-')))!
    const src = roster.source ?? ''
    // The counts in that sentence are DERIVED, so a tenth role on the wire
    // cannot ship beside a page still saying nine…
    const total = rulebook.roles.length + rulebook.unadoptedRoleKeys.length
    expect(src).toContain(`役職の種類が${total}つ`)
    expect(src).toContain(`いまカルテが使っているのは${rulebook.roles.length}つ`)
    expect(src).toContain(`残る${rulebook.unadoptedRoleKeys.length}つ`)
    expect(total).toBe(9)
    // …and NOT ONE of the wire's own identifiers is printed at the reader.
    for (const k of rulebook.unadoptedRoleKeys) expect(src).not.toContain(k)
    // …while the CONTROL still offers only the six that have grants behind them.
    const preset = roster.controls.find((c) => c.id.startsWith('staff.preset-'))!
    const options = preset.control.kind === 'select' ? preset.control.options : []
    expect(options.map((o) => o.value)).toEqual(rulebook.roles.map((r) => r.key))
    for (const k of rulebook.unadoptedRoleKeys) {
      expect({ key: k, offered: options.some((o) => o.value === k) }).toEqual({ key: k, offered: false })
    }
  })

  // ⚖ S17 · F19 — ON A PHONE A SECTION OPENS ON ITS SETTINGS, NOT ON ITS INDEX.
  // このページの中身 rendered OPEN at ①: four items plus a two-line note, ~248px
  // between the section head and the first block, so the whole 390×844 first
  // screen held ZERO settings — a reader opened a section to change one rule and
  // had to scroll past a table of contents and a save bar to reach anything.
  // ⚖ apple-design §16.6 (the common path first, the rest one level deeper);
  // ⚖ codex-dashboard-architect §6 (keep the surface the job needs in front).
  it('⚖ F19 — このページの中身 is a closed disclosure at ①, and a heading everywhere else', () => {
    // the width is asked in an EFFECT, never in the initialiser — this one
    // reaches MARKUP, so a client that knew during hydration would render a
    // different tree than the server sent (the opposite call to the motion
    // preference, whose value reaches only springs).
    const hook = SCREEN_CODE.slice(SCREEN_CODE.indexOf('function useNarrow'))
    const body = hook.slice(0, hook.indexOf('return narrow'))
    expect(body).toContain('const [narrow, setNarrow] = useState(false)')
    expect(body).not.toMatch(/useState\(\s*\(\)\s*=>[^)]*matchMedia/)
    expect(body).toContain("window.matchMedia('(max-width: 899px)')")
    expect(body).toContain("mq.addEventListener('change', apply)")
    // …closed by default, and only ① has a control at all…
    expect(SCREEN_CODE).toContain('const [jumpOpen, setJumpOpen] = useState(false)')
    expect(SCREEN_CODE).toContain('aria-expanded={jumpOpen}')
    expect(SCREEN_CODE).toContain('aria-controls="stJumpList"')
    expect(SCREEN_CODE).toContain('<div className="st-jump-head">このページの中身</div>')
    // …the list itself is written ONCE, whichever wrapper it lands in…
    expect((SCREEN_CODE.match(/className="st-jump-list"/g) ?? []).length).toBe(1)
    expect(SCREEN_CODE).toContain('? <Collapse open={jumpOpen} id="stJumpList" reduced={reduced}>{jumpList}</Collapse>')
    expect(SCREEN_CODE).toContain(': <div id="stJumpList">{jumpList}</div>')
    // …and at ① it is a real control: a touch height, a caret that turns with
    // `aria-expanded`, and a press.
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 899px)'))
    const head = phone.slice(phone.indexOf('.st-jump-head'))
    expect(head).toContain('min-height: 44px')
    expect(head).toContain('cursor: pointer')
    expect(head).toContain('.st-jump-head[aria-expanded="true"] .st-det-caret { transform: rotate(180deg); }')
    expect(head).toContain('.st-jump-head:active { transform: scale(.97); }')
    // ⚖ F25 — AND NOTHING FLASHES ON THE WAY IN. The server renders the OPEN
    // wrapper (it cannot know the width); the client learns it in an effect and
    // swaps in the disclosure, which mounts closed. At ① that is ~248px of list
    // appearing and vanishing on the first hydrated frame of a phone reloading
    // straight into a section. The rule hides ONLY the pre-hydration plain
    // wrapper — `:not(.st-det-wrap)` keeps it off the real disclosure, whose
    // height is its spring's — and it lives inside ①, so no other band sees it.
    expect(phone).toContain('.biz .pg-settings .st-jump #stJumpList:not(.st-det-wrap) { display: none; }')
    // …and HIDING it is ①'s alone: everywhere else that same wrapper is a
    // pass-through (`display: contents`), so ②'s toolbar and ③'s column lay the
    // list and its note out exactly as they did when they were direct children.
    const above = CSS_CODE.slice(0, CSS_CODE.indexOf('@media (max-width: 899px)'))
    expect(above).toContain('.biz .pg-settings .st-jump #stJumpList:not(.st-det-wrap) { display: contents; }')
    expect(above).not.toMatch(/#stJumpList[^\n]*display: none/)
  })

  // ⚖ S17 · F18 — EVERY PRESSABLE ANSWERS THE FINGER, NOT THE RELEASE.
  // Five did not: 取り消す, the ? that opens the walk, 詳細設定's own summary and
  // the walk's three footer buttons. ⚖ apple-design §1 — feedback lives on
  // pointer-down; a page where some controls answer and some do not reads as
  // broken rather than restrained. `.st-coll-del` is the SECOND miss of its kind
  // on one element (the probe already caught it out of the ≤1023 touch list),
  // which is why this pin is derived from the sheet rather than listed.
  it('⚖ F18 — every class the sheet styles as a pressable has a press rule, and reduced motion removes it', () => {
    const pressables = new Set<string>()
    for (const rule of CSS_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/cursor:\s*pointer/.test(rule[2])) continue
      for (const one of rule[1].split(',')) {
        const cls = one.match(/\.[a-z][a-z0-9-]*/g)
        if (cls) pressables.add(cls[cls.length - 1])
      }
    }
    expect(pressables.size).toBeGreaterThan(15)
    // every rule in the sheet that states a press, whatever block it lives in
    const pressed = new Set<string>()
    for (const rule of CSS_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/transform:\s*scale/.test(rule[2])) continue
      for (const one of rule[1].split(',')) {
        if (!one.includes(':active')) continue
        const cls = one.match(/\.[a-z][a-z0-9-]*/g)
        if (cls) pressed.add(cls[cls.length - 1])
      }
    }
    const EXEMPT = new Set([
      '.pg-settings',
      // the tour's own scrim: a full-page catch layer, not a control
      '.st-spot-catch',
      // the ✕ inside the 44px search field presses with the field
      '.st-search-clear',
      // a chip's ✕ presses with its chip, and the stepper group with its buttons
      '.st-lockchip', '.st-step-g',
      // a container whose CHILDREN are the buttons (they carry their own rules)
      '.st-spot-foot',
      // ⚖ F19 — a control only at ①; its press lives in that block (asserted in
      // the F19 pin), because at every other band it is a heading.
      '.st-jump-head',
    ])
    expect([...pressables].filter((c) => !EXEMPT.has(c) && !pressed.has(c))).toEqual([])
    // …and the five this round added are really in the grouped rule…
    const group = CSS_CODE.slice(CSS_CODE.indexOf('.st-rail-item:active'), CSS_CODE.indexOf('{ transform: scale(.97); }'))
    for (const sel of ['.st-coll-del', '.st-help', '.st-adv > summary', '.st-spot-prev', '.st-spot-next', '.st-spot-done']) {
      expect({ sel, presses: group.includes(sel) }).toEqual({ sel, presses: true })
    }
    // …and the reduced-motion mirror removes every one of them, `:not()` and all
    // (⚖ apple-design §14 — the press becomes a colour change, not a scale).
    const reduce = CSS_CODE.slice(CSS_CODE.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    const off = reduce.slice(reduce.indexOf('.st-rail-item:active'), reduce.indexOf('{ transform: none; }'))
    for (const sel of ['.st-coll-del', '.st-help', '.st-adv > summary', '.st-spot-prev', '.st-spot-next', '.st-spot-done']) {
      expect({ sel, stilled: off.includes(sel) }).toEqual({ sel, stilled: true })
    }
  })

  // ⚖ S17 · F16 — SECTION CHANGE HAS MOTION, ON THE ROOM'S ONE SPRING.
  // It had none: the old panel was replaced on the frame, on the room's most
  // frequent transition (22 rail rows, and the purpose sentence has a manager
  // landing on the right one between two bookings). The reduced-motion clause
  // was written around a cross-fade that did not exist.
  // ⚖ apple-design §3 (start from the presentation value — a fast rail-clicker
  // must not see each panel restart from invisible), §7 (one axis, so the path
  // in and the path out are the same line), §14 (the reduced equivalent is
  // gentler, never the absence of feedback).
  // ⚠ AND UNDER REDUCE IT SWAPS IN PLACE, not cross-fades: the FROZEN spring
  // applies every `set` instantly when `reduced` is on (`spring.ts:107-112`), so
  // the seat at 0 and the target at 1 land in the same synchronous block and the
  // browser never paints the 0. Written down because the first cut of this pin
  // claimed a fade that the code does not perform.
  it('⚖ F16 — the panel cross-fades and rises on section change, and swaps in place under reduce', () => {
    expect(SCREEN_CODE).toContain('const SPRING_PANEL = 0.32')
    expect(SCREEN_CODE).toContain('<div className="st-panel" ref={panelRef}>')
    const eff = SCREEN_CODE.slice(SCREEN_CODE.indexOf('const panelSpring = useRef'))
    const body = eff.slice(0, eff.indexOf('}, [picked, section?.id, reduced])'))
    // transform AND opacity, never a width or a height…
    expect(body).toContain('n.style.opacity = String(t)')
    expect(body).toContain("n.style.transform = reduced ? '' : `translateY(${((1 - t) * 6).toFixed(2)}px)`")
    // …driven by the room's ONE integrator, keyed on the section AND on the
    // preference, so a reader who turns 「動きを減らす」 on mid-session is obeyed…
    expect(body).toContain('makeSpring(')
    expect(body).toContain('{ response: SPRING_PANEL, reduced, eps: 0.004 }')
    expect(body).toContain('panelBuiltWith.current !== reduced')
    expect(eff).toContain('}, [picked, section?.id, reduced])')
    // …starting from the CURRENT rendered opacity rather than from zero…
    expect(body).toContain('const live = Number(el.style.opacity)')
    expect(body).toContain('spring.jump(Number.isFinite(live) && live < 1 ? live : 0)')
    // …and the first paint does not animate: a page that fades in on load is a
    // page that looks slow.
    expect(body).toContain('panelFirst.current')
    // ⚠ AND NO SECOND MOTION LANGUAGE: no keyframes for state anywhere, and no
    // CSS transition on the panel's own transform racing the spring.
    expect(CSS_CODE).not.toContain('@keyframes')
    expect(CSS_CODE).not.toMatch(/\.st-panel \{[^}]*transition/)
  })

  // ⚖ S17 · F15 — 予約と確保'S EIGHT DIALS SPEAK THE ROOM'S ROW GRAMMAR.
  // The section arrived from #812 as a stacked block at EVERY width — label over
  // control over three or four description lines, 12px/11px against the room's
  // 13px/12px — so the one section a manager reads a rule and its consequence in
  // was the one place the round's own row improvement was never applied.
  // ⚖ Studio / codex-dashboard-architect §10: use the same grammar on new
  // screens; ⚖ apple-design §16.6: the common path first, the rest one level
  // deeper.
  it('⚖ S17 fix round 4 · H4 — the jump list’s landing pad is a REAL heading, never an aria-hidden span', () => {
    // ⚠ THE ONE ANCHOR IN THE ROOM THAT WAS NOT A HEADING. `jumpTo` focuses
    // `#st-blkh-<id>`; every block renders that id on an `<h3 tabIndex={-1}>`
    // with text, and 予約と確保's プリセット rendered it on a 0×0
    // `aria-hidden="true"` span beside the label instead — so pressing プリセット
    // in このページの中身 moved a keyboard reader's caret onto a node the screen
    // reader is told does not exist, and said nothing. axe calls that
    // `aria-hidden-focus`; the fix is that the heading was already there.
    expect(SECTION_CODE).toContain('<h3 className="st-sec-l" id="st-blkh-bg.presets" tabIndex={-1}>プリセット</h3>')
    // …and the hidden pad is GONE, from the markup and from the sheet — a class
    // nothing renders is the next reader's puzzle.
    expect(SECTION_CODE).not.toContain('st-anchor')
    expect(CSS_CODE).not.toContain('st-anchor')
    expect(SECTION_CODE).not.toMatch(/tabIndex=\{-1\}[^>]*aria-hidden/)
    expect(SECTION_CODE).not.toMatch(/aria-hidden="true"[^>]*tabIndex=\{-1\}/)
    // …the section is NAMED by that same heading now, so the two jobs are one
    // element rather than two ids pointing at one word.
    expect(SECTION_CODE).toContain('aria-labelledby="st-blkh-bg.presets"')
    expect(SECTION_CODE).not.toContain('stPresetsLabel')
    // …and the room's own rule for every other block is unchanged.
    expect(SCREEN_CODE).toContain('<h3 id={`st-blkh-${block.id}`} tabIndex={-1}>{block.title}</h3>')
  })

  it('⚖ F15 — the eight dials are the room’s two-track row, with 詳しく and <h3> sub-headings', () => {
    const rows = [...SECTION_CODE.matchAll(/className="st-row st-dial"/g)]
    expect(rows).toHaveLength(8)
    // …the room's own two tracks, its label block and its description class…
    expect((SECTION_CODE.match(/className="st-dial-what"/g) ?? []).length).toBe(8)
    expect((SECTION_CODE.match(/className="st-dial-ctl(?: st-dial-ctl-stack)?"/g) ?? []).length).toBe(8)
    expect((SECTION_CODE.match(/className="st-dial-desc"/g) ?? []).length).toBe(8)
    // …every dial title is an <h3> inside the room's label block (L1: the eight
    // appeared in no heading outline at all), and none is a bare <p> any more…
    expect((SECTION_CODE.match(/<div className="st-dial-label"><h3 id="st[A-Za-z]+Label">/g) ?? []).length).toBe(8)
    expect(SECTION_CODE).not.toMatch(/<p className="st-ctrl-l" id="st(Perm|Lock|Hold|Strict|Gaps|Minutes|Rank|Slot)Label">/)
    // …the caveat lines fold behind the room's own disclosure rather than
    // standing between two dials…
    const folded = (SECTION_CODE.match(/<Collapse open=\{detOpen\['[a-z]+'\] === true\}/g) ?? []).length
    expect(folded).toBe(6)
    expect((SECTION_CODE.match(/<DetailToggle open=\{detOpen\['[a-z]+'\] === true\}/g) ?? []).length).toBe(folded)
    // …and the room's disclosure, not a second one: same component, same spring.
    expect(SECTION_CODE).toContain("from './Collapse'")
    expect(SECTION_CODE).not.toContain('<details className="st-row')
    // ⚠ AND FOLDING A TRUTH GAVE IT A HOME. 「この設定はまだ保存できません」 rode
    // five of the eight dials in the open; folded, it would have had nowhere on
    // the face at all. It is said ONCE, and the per-dial chips stay in each
    // row's 詳しく as that dial's own detail.
    //
    // ⚖ S17 fix round 3 · R3-1 (D-27) — RE-POINTED, because ITS HOME MOVED. The
    // sentence was pinned INSIDE the 保存 block; at ① that block is stuck to the
    // bottom of the phone's own screen, so a sentence living in it is charged
    // against the reader's screen at every scroll position. It now reads at the
    // END of the section's column, under the last dial, where a manager arrives
    // when they go looking for 保存 — the claim 「said ONCE, on the face」 is
    // unchanged and the pin still holds one copy, on the face, in the section.
    expect((SECTION_CODE.match(/\{PENDING_NOTE\}/g) ?? []).length).toBe(7)
    const foot = SECTION_CODE.slice(SECTION_CODE.indexOf('<div className="st-foots">'))
    expect(foot.slice(0, foot.indexOf('</div>'))).toContain('{PENDING_NOTE}</p>')
    /* ⚖ S17 fix round 3 · R3-2 — AND IT IS SAID ONCE PER FACE, NOT TWICE. The
       seam's refusal 「見本データのため保存できません。実データの接続後に有効に
       なります。」 and this note say the same thing, and the review found them
       standing side by side — one on the bar, one under it. The note is the
       FALLBACK: it reads when the seam has no refusal to give and the wire is
       still not live, and the moment the seam refuses, its own sentence (which
       also names WHEN the control comes alive) is the one a manager reads. */
    expect(foot).toContain('{props.save.refusal === null && <p className="st-foot">{PENDING_NOTE}</p>}')
    // ⚠ WHAT DOES NOT FOLD, and this is the half a later hand will get wrong: a
    // WARNING and a LIVE RESULT stay on the face. 詳しく holds context a manager
    // opens WHILE changing a dial; 「why can I not do this」 and 「this is what
    // your change just did」 are read before and at the press. A live region
    // inside a closed panel is also announced to one reader and invisible to the
    // other.
    for (const live of [
      '{lastOneStanding && <p className="st-ctrl-d warn">',
      '{guardOff && <p className="st-ctrl-d warn">',
      'aria-live="polite"',
    ]) {
      expect({ live, onFace: SECTION_CODE.includes(live) }).toEqual({ live, onFace: true })
    }
    // …and the sheet gives that face line both tracks, so it is not squeezed
    // into the control column.
    expect(CSS_SRC).toContain('.biz .pg-settings .st-dial > .st-ctrl-d { grid-column: 1 / -1; }')
    expect(CSS_SRC).toContain('.biz .pg-settings .st-dial-label h3 {')
  })

  // ⚖ S17 · F8 — ONE DIAL, TWO CONSEQUENCES, AND THE ROOM SAYS BOTH.
  // 確保枠を早めに売りに戻せる役職 edits `opsConfig.releaseHeldRoles`, and THAT
  // list is 予約と確保's save gate (`store-policy-props.ts:265` →
  // `saveRefusal`). Neither end said so, so a manager narrowing this row to
  // オーナー would have taken away their own ability to save that section from a
  // row that talked only about held slots. This pin holds the coupling itself —
  // if the save gate ever stops reading this list, or this row stops naming the
  // second consequence, it goes red.
  it('⚖ F8 — the release row IS 予約と確保’s save gate, says so, and refuses to lock the reader out', async () => {
    const { props, storePolicy } = await assemble({ store: STORE_A })
    const release = rowsOf(props).find((r) => r.id === 'store-hours.row-release')!
    const chips = release.controls.find((c) => c.id === 'store-hours.release')!
    // ONE LIST, read by both ends — not two lists that happen to agree today.
    expect(chips.value).toEqual(storePolicy.save.roles)
    expect(storePolicy.save.roles).toEqual([...opsConfig.releaseHeldRoles])
    // …and the row's own description names the second consequence, in the words
    // 予約と確保 uses for itself.
    expect(release.description).toContain('通常の販売へ戻せる')
    expect(release.description).toContain('「予約と確保」の設定を保存できる')
    // …and the reader's own 役職 cannot be taken off the list — the mistake-
    // proofing guardrail, on the chip, with its reason said out loud.
    const keep = chips.control.kind === 'chips' ? chips.control.keep : undefined
    expect(keep?.value).toBe(operator.role)
    expect(keep?.reason ?? '').toContain('自分の役職は外せません')
    // …and it names a chip that is really on screen.
    const options = chips.control.kind === 'chips' ? chips.control.options.map((o) => o.value) : []
    expect(options).toContain(operator.role)
    // …while the EMPTY-LIST guardrail it stands beside is untouched.
    expect(release.trio?.guardrail ?? '').toContain('誰も戻せない状態にはできません')
  })

  // ⚖ S17 · F10 — TWO ROLE VOCABULARIES, AND THE ROW SAYS WHICH ONE IT SPEAKS.
  // 権限表 offers Karute's six presets (オーナー・店舗管理者・主任・施術スタッフ・
  // 受付・カスタム); this row offers the BOARD's three staff roles. A reader who
  // meets 主任 on one page and cannot find it on the other is owed the reason,
  // and the reason is that they are two different facts today. Unifying them is
  // a plane question for the reconnect era (queue file), not this room's to
  // restructure — so what ships is the honest line, and this pin holds it.
  it('⚖ F10 — the release row names WHICH list of 役職 it is offering', async () => {
    const props = await room({ store: STORE_A })
    const release = rowsOf(props).find((r) => r.id === 'store-hours.row-release')!
    expect(release.source ?? '').toContain('今日の運営がスタッフに付けている役職名')
    expect(release.source ?? '').toContain('権限表のひな形とは別の一覧')
    // …and the two lists really ARE different, which is what makes the line true
    // rather than a decoration: the 権限表's own labels are not what this row
    // offers.
    const chips = release.controls.find((c) => c.id === 'store-hours.release')!
    const offered = chips.control.kind === 'chips' ? chips.control.options.map((o) => o.label) : []
    const presets = rulebook.roles.map((r) => r.label)
    expect(offered).not.toEqual(presets)
    expect(presets.filter((l) => !offered.includes(l)).length).toBeGreaterThan(0)
  })

  // ⚖ S17 · F7 — 契約・請求 NAMES ONE DESTINATION, ONCE.
  // The section used to send the reader two ways for one errand: its lead said
  // 「このWeb画面」 and the block's own fact line said 「Webのお支払い画面」, six
  // lines apart. A reader who reads both has to work out whether they are the
  // same place. The lead's words are the room's words; the fact line adds only
  // what the lead does not enumerate, and no second name for the destination
  // survives anywhere in the section.
  it('⚖ F7 — 契約・請求 names ONE destination for the plan change, in one form of words', async () => {
    const sec = sectionOf(await room({ store: STORE_A, role: 'オーナー' }), 'billing')
    const facts = sec.blocks.flatMap((b) => b.facts ?? [])
    const change = facts.find((f) => f.includes('プランの変更'))!
    expect(change).toContain('このWeb画面')
    expect(sec.lead).toContain('このWeb画面')
    // …and the second name is gone from every reader-facing string of the section.
    const reader = [sec.lead, ...facts, ...sec.blocks.flatMap((b) => [b.title, b.note ?? '', ...b.rows.flatMap((r) => [r.label, r.description, r.source ?? ''])])]
    expect(reader.filter((t) => t.includes('Webのお支払い画面'))).toEqual([])
    // …and 「この画面」 on its own never stands for two different places in one
    // section: the row's receipt says WHICH screen cannot change the plan.
    expect(reader.filter((t) => /この画面/.test(t) && !/この設定画面|このWeb画面/.test(t))).toEqual([])
  })

  // ⚖ S17 · C4 — the same proof for the 26 business types.
  it('⚖ C4 — the 26 業種 still equal Karute’s own business-types.ts', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/welcome/business-types.ts'), 'utf8')
    const block = src.slice(src.indexOf('export const BUSINESS_TYPES'), src.indexOf('\n]', src.indexOf('export const BUSINESS_TYPES')))
    const pairs = [...block.matchAll(/\{ value: '([^']+)',[^}]*labelJa: '([^']+)' \}/g)].map((m) => ({ value: m[1], label: m[2] }))
    expect(pairs).toHaveLength(26)
    expect(businessProfiles.map((p) => ({ value: p.value, label: p.label }))).toEqual(pairs)
  })

  // ⚖ S17 · C8 — and for the audit writers' own categories.
  it('⚖ C8 — the 種類 filter offers the categories the writers really emit', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/audit.ts'), 'utf8')
    const block = src.slice(src.indexOf('export const AUDIT_CATEGORIES = ['), src.indexOf('] as const', src.indexOf('export const AUDIT_CATEGORIES = [')))
    const declared = [...block.matchAll(/^\s*'([a-z]+)',/gm)].map((m) => m[1])
    expect(declared).toHaveLength(10)
    // ⚠ NINE ARE OFFERED, NOT TEN. `billing` is declared and never written: its
    // only `FACADE_AUDIT_MAP` row is `kind: 'skip'`, which `logFacadeAudit`
    // returns on before it can call `audit()`. A filter option that can never
    // match a row is a dead lever with a label on it.
    expect(AUDIT_CATEGORIES.map((c) => c.token)).toEqual(declared.filter((d) => d !== 'billing'))
    expect(src).toContain("'entitlement.read': { kind: 'skip', category: 'billing'")
    for (const c of AUDIT_CATEGORIES) expect(c.label).not.toMatch(/[a-z]\./)
  })
})

const flip = (v: RowValue): RowValue => {
  if (typeof v === 'boolean') return !v
  if (Array.isArray(v)) return v.length ? [] : ['__moved__']
  return `${v}__moved__`
}

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ 8/21 MISTAKE-PROOFING — a policy row ships default, guardrail and type note', () => {
  it('every policy row states its default and its guardrail, and says something specific', async () => {
    const props = await room({ store: STORE_A })
    const rows = trioRows(props)
    // Every genuine store POLICY carries the trio; a list entry (a weekday, a
    // menu, a person) does not, because the block's own scope already answered.
    expect(rows.length).toBeGreaterThanOrEqual(25)
    for (const r of rows) {
      expect({ id: r.id, base: r.trio!.base.startsWith('初期値') }).toEqual({ id: r.id, base: true })
      // ⚠ A GUARDRAIL IS A SENTENCE ABOUT A LIMIT. Thirty copies of one sentence
      // would pass a length check; distinctness is what kills the mutant.
      expect({ id: r.id, long: r.trio!.guardrail.length >= 20 }).toEqual({ id: r.id, long: true })
    }
    const rails = rows.map((r) => r.trio!.guardrail)
    expect(new Set(rails).size).toBe(rails.length)
  })

  it('⚖ S17 fix round 4 · B1 — EVERY 最終変更 receipt is dated on or before the page’s own dateline', async () => {
    // ⚠ DERIVED FROM THE PROPS, NEVER FROM A LIST OF SECTIONS. A pin holding
    // eleven hand-copied offsets would go stale the day a twelfth receipt
    // ships; this one reads every audit line the payload actually contains and
    // compares it against the ONE date the page prints about itself. Nine of
    // the eleven were in the FUTURE — 「最終変更 ・ 9月22日(火)」 on a page whose
    // own dateline read 9月6日 — because `dayFrom` adds and the offsets were
    // written positive (⚖ 8/9: sample data is product truth).
    const props = await room({ store: STORE_A, role: 'オーナー' })
    const dayOf = (s: string): { m: number; d: number } | null => {
      const m = /(\d+)月(\d+)日/.exec(s)
      return m ? { m: Number(m[1]), d: Number(m[2]) } : null
    }
    const today = dayOf(props.dateline)
    expect({ dateline: props.dateline, parsed: today !== null }).toEqual({ dateline: props.dateline, parsed: true })
    // Day-of-year, with the ONE wrap this room can produce: a receipt up to 34
    // days back crosses New Year, so a month far AHEAD of the dateline is last
    // year rather than a defect. Anything else ahead of it is the defect.
    const ord = (x: { m: number; d: number }) => x.m * 31 + x.d
    const audits = props.sections.flatMap((s) => s.blocks.map((b) => ({ section: s.id, block: b.id, line: b.audit })))
      .filter((a): a is { section: string; block: string; line: string } => typeof a.line === 'string' && a.line.includes('最終変更'))
    expect(audits.length).toBeGreaterThanOrEqual(10)
    for (const a of audits) {
      const on = dayOf(a.line)
      expect({ block: a.block, parsed: on !== null }).toEqual({ block: a.block, parsed: true })
      const ahead = ord(on!) - ord(today!)
      const past = ahead <= 0 || ahead > 300
      expect({ block: a.block, line: a.line, past }).toEqual({ block: a.block, line: a.line, past: true })
    }
    // …and the SOURCE says the same thing, so a receipt written with a positive
    // offset fails here rather than in a reader's eyes: every `audit:` line in
    // the props file takes a 0 or negative `dayFrom` offset.
    const auditOffsets = [...PROPS_CODE.matchAll(/audit:[^\n]*dayFrom\(ctx\.now, (-?\d+)\)/g)].map((m) => Number(m[1]))
    expect(auditOffsets.length).toBeGreaterThanOrEqual(audits.length)
    expect(auditOffsets.filter((n) => n > 0)).toEqual([])
  })

  it('a 業種 line prints ONLY where a ruling gave one — absence is SILENCE, never a null sentence', async () => {
    const props = await room({ store: STORE_A })
    const RULED = ['payments.row-tolerance', 'store-hours.row-breaks', 'contact.row-winback', 'coaching.row-enabled']
    for (const r of trioRows(props)) {
      const states = typeof r.trio!.businessType === 'string' && r.trio!.businessType.length > 0
      expect({ id: r.id, statesOne: states }).toEqual({ id: r.id, statesOne: RULED.includes(r.id) })
      if (states) expect({ id: r.id, real: r.trio!.businessType!.startsWith('業種による初期値:') }).toEqual({ id: r.id, real: true })
    }
    // …and the null sentence is gone from the WHOLE payload, not just from the
    // rows this test walked.
    expect(JSON.stringify(props)).not.toContain('業種による初期値の決まりはありません')
    expect(PROPS_CODE).not.toContain('業種による初期値の決まりはありません')
    // The screen renders the line CONDITIONALLY, so a future row that omits it
    // cannot print an empty bullet.
    // ⚖ S17 STEP 1 — RE-PINNED AT ITS NEW HOME. The three lines did not change
    // and none of them was cut; they moved behind the row's own 詳しく, where a
    // manager opens them at the moment they are changing the dial instead of
    // reading them between every pair of dials the rest of the time. The
    // CONDITION is what this pin is about, and it is still a condition: a 業種
    // line prints only where a ruling gave one.
    expect(SCREEN_CODE).toContain("if (row.trio.businessType) detail.push({ cls: 'st-det-type', text: row.trio.businessType })")
    expect(SCREEN_CODE).toContain("detail.push({ cls: 'st-det-base', text: row.trio.base })")
    expect(SCREEN_CODE).toContain("detail.push({ cls: 'st-det-rail', text: row.trio.guardrail })")
    // …and a row with none of the four grows no 詳しく at all — an empty
    // disclosure is a control that opens onto nothing.
    expect(SCREEN_CODE).toContain('{detail.length > 0 && (')
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

  it('a number field is corrected ON COMMIT, never while it is being typed — and an EMPTY box is not a number', () => {
    // ⚠ A CLAMP THAT FIRES PER KEYSTROKE MAKES 「1」 UNREACHABLE on the way to
    // 「14」 — the guardrail would fight the reader instead of protecting them.
    // ⚠ D-36 (⚖ S17 fix round 4 · M4) — AND `commitNumber` IS GONE, replaced by
    // `commitNumberField`, because the old signature could not answer the
    // question honestly: it took no previous value, so 「this is not a number」
    // and 「this number is too small」 both came back as the guardrail's floor,
    // silently. Measured on the parent: 予約の刻み 30 → clear → blur = 5分, the
    // tightest granularity in the store; コーチング 記録の保存期間 → clear = 3か月.
    // Against ⚖ 8/21 mistake-proofing that is the dial harming the store
    // quietly. The clamp itself is unchanged — same floor, same ceiling, same
    // commit-time firing — and what is new is the fallback and the sentence.
    const win = (raw: string, prev: number) => commitNumberField(raw, prev, WIN_BACK_MIN, WIN_BACK_MAX, '日')
    // out of range still CLAMPS, and now says which range it was held to…
    expect(win('4000', 30).value).toBe(WIN_BACK_MAX)
    expect(win('4000', 30).message).toBe(`${WIN_BACK_MIN}日から${WIN_BACK_MAX}日のあいだで設定できます。${WIN_BACK_MAX}日にしました`)
    expect(win('1', 30).value).toBe(WIN_BACK_MIN)
    // …a number inside the guardrail goes in as typed, and says NOTHING…
    expect(win('61', 30)).toEqual({ value: 61, message: null })
    // …and an empty or unreadable box is handed the PREVIOUS value back, out loud.
    expect(win('', 45)).toEqual({ value: 45, message: '数字を入れてください。前の値の45日に戻しました' })
    expect(win('   ', 45).value).toBe(45)
    expect(win('abc', 45)).toEqual({ value: 45, message: '数字を入れてください。前の値の45日に戻しました' })
    // …the fallback is itself inside the guardrail, so a previous value that has
    // gone stale cannot smuggle a forbidden number back in.
    expect(win('', 9999).value).toBe(WIN_BACK_MAX)
    // THE FIELD REMEMBERS THE LAST ACCEPTED VALUE, not the last saved one: a
    // reader who moves 30 → 45 and then clears the box gets 45 back, because 45
    // is what they last told this page.
    expect(SCREEN_CODE).toContain('const lastGood = useRef<number>(clampInt(Number(text), k.min, k.max))')
    expect(SCREEN_CODE).toContain('if (text.trim() !== \'\' && Number.isFinite(n) && n >= k.min && n <= k.max) lastGood.current = Math.round(n)')
    expect(SCREEN_CODE).toContain('const commit = commitNumberField(e.target.value, lastGood.current, k.min, k.max, k.unit ?? \'\')')
    expect(SCREEN_CODE).toContain('setMessage(commit.message)')
    expect(SCREEN_CODE).toContain('onChange(c.id, String(commit.value))')
    // …and the sentence has a home on the face, in a region that stays mounted
    // so a screen reader hears it CHANGE (⚖ F10's own lesson).
    expect(SCREEN_CODE).toContain('<span className="st-field-msg" role="status">{message ?? \'\'}</span>')
    expect(CSS_CODE).toContain('.biz .pg-settings .st-numline .st-field-msg:empty { display: none; }')
  })

  it('a required field blocks the save and names itself', async () => {
    const props = await room({ store: STORE_A })
    const hours = sectionOf(props, 'store-hours')
    const seed = seedOf(props)
    expect(blockingError(hours, seed)).toBeNull()
    expect(blockingError(hours, { ...seed, 'store-hours.name': '   ' })).toBe('店舗名が空欄です — 保存できません。')
    // …and the save button is really disabled by it.
    expect(SCREEN_CODE).toContain('disabled={!dirty || blocked !== null}')
  })

  it('a readout is a FIGURE or a PHRASE, and the sheet sizes them differently', async () => {
    const props = await room({ store: STORE_A, role: 'オーナー' })
    for (const c of controlsOf(props)) {
      if (c.control.kind !== 'readout') continue
      // ⚠ CAUGHT BY THE SHOTS, NOT BY A TEST, ON THE FIRST ROUND. A role list at
      // the figure's 20px read as a headline shouting over the section title.
      expect({ id: c.id, phrase: c.control.numeric === false }).toEqual({ id: c.id, phrase: true })
    }
    // ⚖ S17 STEP 1 — RE-PINNED TO THE ROOM'S NEW SCALE. The compact head took
    // the page's whole type scale down a step (h1 26→22, section title 19→17),
    // so the readout came with it: 20→15 for a figure, 14→12.5 for a phrase.
    // The CLAIM is unchanged and is what this pin is for — a MEASURE gets the
    // big tabular figure a reader scans for, a PHRASE does not, because at the
    // figure's size a role list shouts over the section title.
    expect(CSS_CODE).toContain('.st-readout b { font-size: 15px;')
    expect(CSS_CODE).toContain('.st-readout.is-phrase b { font-size: 12.5px;')
    expect(SCREEN_CODE).toContain("className={`st-readout${k.numeric ? '' : ' is-phrase'}`}")
  })

  it('a stored value outside the presets is ADDED to them, never rounded away', () => {
    // canon's own ruling (fable-settings-store-hours.html:4218-4231): silently
    // showing the nearest preset makes 「現在値をプリセット」 a lie.
    expect(withCurrent([15, 30, 60], 20)).toEqual([15, 20, 30, 60])
    expect(withCurrent([15, 30, 60], 30)).toEqual([15, 30, 60])
  })

  it('an array value compares by CONTENT — a chip set is not permanently dirty', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameValue([], [])).toBe(true)
    expect(sameValue('x', 'x')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE RECURRENCE KILLER — READ THIS BEFORE ADDING ANY STRING TO THIS ROOM.
//
// THE CLASS: an INTERNAL CODE reaching the reader (room 8's N8-1, which room 9
// then shipped again as 「（登録: ①店舗ポリシーの保存）」 on sixteen refusals). The
// refusals are gone; the guard is not, because the class is what it guards
// against and this round adds a hundred new strings.
//
// WHAT IT DOES: walks the payload the route really assembles — in every world —
// and scans EVERY string a reader can see, INCLUDING every preview and action
// sentence AFTER it is filled from the live values. A new field is scanned the
// day it lands, because the walk is structural rather than a list; only keys
// that are machine identifiers are skipped, and that skip list is short, named,
// and self-checked below.
describe('⚠ NO INTERNAL CODE EVER REACHES THE READER (the N8-1 class, kept killed)', () => {
  /** Keys whose values are machine identifiers, never rendered as words.
   *
   *  ⚠ AND SKIPPING BY KEY NAME ALONE IS NOT ENOUGH — THE BATTERY PROVED IT ON
   *  THIS VERY GUARD once already: the trace card's lines are `{ label, value }`
   *  and that `value` is a SENTENCE the reader looks straight at, while a
   *  segment option's `value` is a machine id. So the skip is by PATH. */
  const MACHINE_KEYS = new Set([
    'id', 'openingSectionId', 'gate', 'scope', 'state', 'kind', 'sectionId', 'filterBy', 'tags', 'persist',
    // A raw template still carries `{control-id}` braces; it is scanned FILLED,
    // below, which is the form a reader actually meets.
    'template',
    // `requires` names a control, and `attrs` maps an attribute name to one.
    'requires',
    // ⚖ S17 · C2 — a collection's two fields name the controls its 追加 row reads
    // (`SettingsCollection.dateControlId` / `reasonControlId`). Same shape as
    // `requires`: an id the SCREEN uses, never a string a reader meets. Its
    // visible words — `addLabel`, `removeLabel`, `emptyLine`, `duplicateError`,
    // `emptyDateError`, and every item's `title`/`note` — are NOT skipped, and
    // the sample below proves the walk still reaches them.
    'dateControlId', 'reasonControlId',
  ])
  /** ⚠ THE SKIP IS BY PATH, AND THE BATTERY PROVED WHY once already: the trace
   *  card's lines are `{ label, value }` and that `value` is a SENTENCE the
   *  reader looks straight at, while a segment option's `value` is a machine id.
   *  A CONTROL's own `value` is the same fork — a `readout` renders it as words,
   *  every other shape renders a LABEL and keeps the value as a key — so it is
   *  skipped only where the control it belongs to is not a readout. */
  const isMachine = (path: string[], root: unknown) => {
    const key = path[path.length - 1] ?? ''
    if (MACHINE_KEYS.has(key)) return true
    if (path.includes('attrs')) return true
    if ((key === 'value' || key === 'hex') && path.includes('options')) return true
    if (key === 'value' && path[path.length - 2] === undefined) return false
    return key === 'value' && isKeyedControl(root)
  }
  /** A `RowControl` is the only object in this payload carrying `aria` beside a
   *  `control`; a readout is the one kind whose `value` really is words. */
  const isKeyedControl = (node: unknown) => {
    if (!node || typeof node !== 'object') return false
    const o = node as Record<string, unknown>
    if (typeof o.aria !== 'string' || typeof o.control !== 'object' || o.control === null) return false
    return (o.control as { kind?: string }).kind !== 'readout'
  }

  const readerText = (node: unknown, path: string[] = [], owner: unknown = null): string[] => {
    if (typeof node === 'string') return isMachine(path, owner) ? [] : [node]
    if (Array.isArray(node)) return node.flatMap((v) => readerText(v, path, owner))
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => readerText(v, [...path, k], node))
    }
    return []
  }

  const filledSentences = (props: SettingsProps): string[] => {
    const kinds = Object.fromEntries(controlsOf(props).map((c) => [c.id, c.control]))
    const seed = seedOf(props)
    const label = (id: string) => (kinds[id] ? labelOfValue(kinds[id], seed[id]) : null)
    return props.sections.flatMap((s) =>
      s.blocks.flatMap((b) => [
        ...(b.preview ? [fillTemplate(b.preview.template, label)] : []),
        ...(b.action ? [fillTemplate(b.action.template, label)] : []),
      ]),
    )
  }

  const FORBIDDEN: Array<[string, RegExp]> = [
    ['a build-registry tag', /登録\s*[:：]/],
    ['a circled index', /[①-⑳]/],
    ['the backend codename 「core」', /\bcore\b/i],
    ['a capability token', /staff\.manage|staff\.invite|settings\.manage|records\.write|customers\.view|analytics\.viewAll|billing\.manage|data\.export|business\.manage|guard\.override/],
    ['a plane or fixture name', /fixtures-|storeDials|opsConfig|storeBookingPolicy|shiftsPolicy|salesTargets/],
    ['a section or control id', /store-hours\.|my-display\.|pricing-points|reserve-acceptance|audit-log|data-io/],
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
      ['no settings', await room({ store: STORE_A, dials: null })],
    ]
    const hits: string[] = []
    for (const [world, props] of worlds) {
      const strings = [...readerText(props), ...filledSentences(props)]
      // The walk really reaches the room's copy, or every check below is vacuous.
      expect({ world, reaches: strings.length > 60 }).toEqual({ world, reaches: true })
      // ⚠ AND IT REACHES THE EXACT PLACES A SKIP RULE COULD SWALLOW — named, one
      // per shape, because a key-name skip is what hid the trace card once. A
      // collector that quietly stops seeing a field is a guard that passes on
      // nothing, which is worse than no guard at all.
      if (world === 'manager') {
        for (const [shape, sample] of [
          ['a trace-card value', 'ひとつだけ（二か所には持ちません）'],
          ['a row scope label', '事業全体'],
          // ⚖ S17 FOLD — the old sample (予約の移動単位) was a control that moved
          // to 予約と確保. The shape is what matters, so the sample is another
          // accessible name from the same block that stayed.
          ['a control’s accessible name', '予定ブロックの移動単位'],
          ['a block fact', '記録は削除できません。すべての変更は自動で記録され、いつでも確認できます。'],
          ['a switch label', '有給（休憩も含めて計算）'],
          ['a list item', 'まとめての書き出しはできません。'],
          // ⚖ S17 · C2 — the collection's own visible words, one per shape, so
          // the two id keys skipped above cannot quietly take the block with them.
          ['a collection refusal', 'その日はすでに臨時休業です'],
          ['a collection empty state', '臨時休業の予定はありません。'],
        ] as const) {
          expect({ shape, seen: strings.includes(sample) }).toEqual({ shape, seen: true })
        }
        // …and a FILLED preview sentence really arrives in the scan. ⚖ S17 FOLD —
        // the 予約ボードの操作 preview names only the dials that block still holds,
        // so the sentence it fills starts with the one that stayed.
        expect(strings.some((s) => s.startsWith('予定ブロックは15分きざみ'))).toBe(true)
      }
      for (const s of strings) {
        for (const [what, re] of FORBIDDEN) {
          if (re.test(s)) hits.push(`${world} · ${what} · ${s.slice(0, 60)}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('the ACCESSIBLE NAME of a locked control carries the same words and nothing more', () => {
    // A screen reader drops `title` once a description is present, so the reason
    // rides the accessible name — which means a code in the reason is a code
    // spoken aloud on every focus.
    expect(SCREEN_CODE).toContain("'aria-label': `${c.aria} — ${c.locked}`")
    expect(SCREEN_CODE).toContain("'aria-disabled': 'true' as const")
    // `aria-disabled`, never `disabled`, on a locked control: it has to stay
    // focusable for its reason to be reachable by keyboard. The two `disabled`
    // attributes in this file are the save button and the tour's 前へ, which are
    // genuinely unusable rather than refusing.
    expect((SCREEN_CODE.match(/(?<!aria-)\bdisabled=/g) ?? [])).toHaveLength(2)
  })

  it('the room’s own SOURCE keeps the codes where codes belong', () => {
    expect(LIB_CODE).not.toMatch(/登録\s*[:：]/)
    expect(PROPS_CODE).not.toMatch(/登録\s*[:：]/)
    expect(SCREEN_CODE).not.toMatch(/登録\s*[:：]/)
    // The eight seams live in the lib's COMMENT and in the build report — never
    // in a value a sentence could interpolate.
    expect(LIB_SRC).toContain('① 店舗ポリシーの保存')
    expect(LIB_CODE).not.toContain('店舗ポリシーの保存')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ 8/17 STORE ISOLATION — the clamp is the read', () => {
  it('store-scoped values move with the lens; business-scoped ones do not', async () => {
    const ginza = await room({ store: STORE_A })
    const daikanyama = await room({ store: STORE_B })
    for (const id of ['contact.winback', 'coaching.enabled', 'payments.qr', 'pricing.dyn', 'store-hours.address']) {
      expect({ id, same: JSON.stringify(controlOf(ginza, id).value) === JSON.stringify(controlOf(daikanyama, id).value) })
        .toEqual({ id, same: false })
    }
    for (const id of ['store-hours.block-step', 'payments.tolerance']) {
      expect({ id, same: controlOf(ginza, id).value === controlOf(daikanyama, id).value }).toEqual({ id, same: true })
    }
    // ⚖ S17 FOLD — RE-DERIVED, NOT DROPPED. スキマガード・予約の移動単位・販売可能
    // な最小の長さ are business-scoped still; they are just read through
    // 予約と確保's own payload now, so the same equality is asked there.
    const [gz, dk] = [await policyOf({ store: STORE_A }), await policyOf({ store: STORE_B })]
    for (const key of ['mode', 'bookingStepMin', 'gapSelling'] as const) {
      expect({ key, same: gz.policy[key] === dk.policy[key] }).toEqual({ key, same: true })
    }
  })

  it('the OTHER store’s values are nowhere in the payload', async () => {
    const ginza = JSON.stringify(await room({ store: STORE_A }))
    // 代官山 runs a 90-day win-back cycle and its own address; 銀座's payload
    // must not carry either.
    expect(storeDials[STORE_B].winBackDays).toBe(90)
    // ⚠ READ THE CONTROL, NOT A SUBSTRING. 銀座's own 受付ウィンドウ guardrail
    // legitimately says 「上限は90日です」, so scanning the payload for 「90日」
    // would be a pin that fails for the wrong reason — the disease this file is
    // written against.
    expect(controlOf(await room({ store: STORE_A }), 'contact.winback').value).toBe('61')
    expect(ginza).not.toContain(storeDials[STORE_B].profile.address)
    expect(ginza).not.toContain(STORE_B)
  })

  it('every policy row states WHICH scope it is — never inferred', async () => {
    const props = await room({ store: STORE_A })
    for (const r of trioRows(props)) {
      expect({ id: r.id, scope: ['事業全体', 'この店舗', '自分だけ'].includes(r.scopeLabel ?? '') })
        .toEqual({ id: r.id, scope: true })
    }
    const rowOf = (id: string) => rowsOf(props).find((r) => r.id === id)!
    // ⚖ S17 FOLD — 予約の移動単位 moved to 予約と確保; 予定ブロックの移動単位 is
    // the row in the same block that stayed, and it carries the same scope.
    expect(rowOf('store-hours.row-block-step').scopeLabel).toBe('事業全体')
    // ⚖ S17 · C4 — RE-PINNED TO 事業全体. `coaching_enabled` lives in the
    // BUSINESS's own org-settings blob, so a manager switching it off in 銀座
    // switches it off for 代官山 too — which is exactly the mistake the scope
    // chip exists to prevent, and the chip was saying the opposite.
    expect(rowOf('coaching.row-enabled').scopeLabel).toBe('事業全体')
    // …and a row that really IS per-store still says so, so the pin is not just
    // agreeing with whatever the payload happens to hold.
    expect(rowOf('store-hours.row-breaks').scopeLabel).toBe('この店舗')
  })

  it('a world with no settings is a DESIGNED state, not a blank panel', async () => {
    const props = await room({ store: STORE_A, dials: null })
    const section = sectionOf(props, 'store-hours')
    expect(section.blocks).toEqual([])
    expect(section.kicker).toBe('店舗を選んでください')
    expect(section.lead.length).toBeGreaterThan(20)
  })

  it('the screen is keyed by the resolved lens, so a store switch resets every value', () => {
    expect(PAGE_SRC).toContain('<SettingsScreen key={storeKey}')
    // …and the seed is taken ONCE, from the payload the remount hands it.
    expect(SCREEN_CODE).toContain('useState<Record<string, RowValue>>(() => seedOf(props))')
  })

  it('no ?store= and an UNKNOWN ?store= both open on a real store, never on すべての店舗', async () => {
    for (const store of [undefined, 'store-that-is-not-ours']) {
      const { props, storeKey } = await settingsProps({ locale: 'ja', store })
      expect({ store, key: storeKey }).not.toEqual({ store, key: 'all-stores' })
      expect({ store, label: props.lensLabel }).not.toEqual({ store, label: 'すべての店舗' })
      // …and the section really carries its blocks, rather than the designed
      // no-store panel a null lens would render.
      const hours = props.sections.find((s) => s.id === 'store-hours')!
      expect({ store, blocks: hours.blocks.length }).toEqual({ store, blocks: 4 })
      expect({ store, kicker: hours.kicker }).not.toEqual({ store, kicker: '店舗を選んでください' })
    }
  })

  it('the store list names every store, and marks the one being read', async () => {
    const props = await room({ store: STORE_A, role: 'オーナー' })
    expect(sectionOf(props, 'business-structure').gate).toBe('open')
    const table = sectionOf(props, 'business-structure').blocks.find((b) => b.id === 'org.stores')!.table!
    expect(table.rows).toHaveLength(stores.length)
    expect(table.rows.filter((r) => r.cells.includes('いま見ている店舗'))).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the rail — canon’s IA, and never an option wall', () => {
  it('canon’s five groups, in canon’s order, plus the rows the map asked for', () => {
    const groups: string[] = []
    for (const e of RAIL) if (!groups.includes(e.group)) groups.push(e.group)
    expect(groups).toEqual(['店舗運営', '料金・ポイント', 'Karute設定', 'Reserve設定', '組織・管理'])
    // 顧客・連絡 is room 9's own addition — the map's row #14 needs a home and
    // canon has none. It sits INSIDE an existing group rather than making a
    // sixth, which is the big-tech-simplicity call argued in the build report.
    expect(RAIL.filter((e) => e.label === '顧客・連絡').map((e) => e.group)).toEqual(['店舗運営'])
    // …and 自分の表示設定 sits between two GATED rows on purpose (S9L-1): the
    // structural duty has to hold where it is hard.
    const around = RAIL.map((e) => e.id)
    const i = around.indexOf('my-display')
    expect(RAIL[i - 1].needs).toBe('settings.manage')
    expect(RAIL[i + 1].needs).toBe('billing.manage')
  })

  it('every rail row leads to a real section, in rail order', async () => {
    const props = await room({ store: STORE_A, role: 'オーナー' })
    expect(props.sections.map((s) => s.id)).toEqual(RAIL.map((e) => e.id))
    for (const s of props.sections) {
      expect({ id: s.id, titled: s.title.length > 0 }).toEqual({ id: s.id, titled: true })
      // A GATED section has no lead by construction — nothing below the gate
      // runs for it, which is the structural duty rather than an omission.
      if (s.gate !== 'open') continue
      expect({ id: s.id, led: s.lead.length > 0 }).toEqual({ id: s.id, led: true })
    }
  })

  it('the rail row’s own state is the section’s gate, and nothing else', async () => {
    const props = await room({ store: STORE_A })
    for (const r of props.rail) {
      const s = sectionOf(props, r.id)
      expect({ id: r.id, agree: r.state === s.gate }).toEqual({ id: r.id, agree: true })
    }
    // ⚠ THE 準備中 FLAG IS GONE FROM THE RAIL, and that is the owner's ruling in
    // one assertion: there is no third state left for a row to be in.
    expect(SCREEN_CODE).not.toContain('準備中')
    expect(props.rail.every((r) => r.state === 'open' || r.state === 'no-rights')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⚖ S17 STEP 1 — THE FIVE NEW TRUTHS, EACH WITH A KILLER OF ITS OWN.
// Every one of these is a rule this round introduced, lifted into a pure
// function on purpose so it can be RUN here rather than only read: this suite
// cannot mount React (no react-dom in the module map), and a rule that only
// exists inside a handler can only be checked by mounting one.
describe('⚖ S17 — find by typing, what is unsaved, and the wire’s own shapes', () => {
  it('the search index is the ROW, its GROUP, its SECTION, every BLOCK TITLE and every ROW LABEL inside it', async () => {
    const props = await room({ store: STORE_A })
    const byId = Object.fromEntries(props.sections.map((sec) => [sec.id, sec]))
    const rowOf = (id: string) => props.rail.find((r) => r.id === id)!

    // ⚠ THE BLOCK TITLES ARE THE HALF THAT MATTERS. A rail that matched only its
    // own 22 labels would be a filter over the page's table of contents; what a
    // manager types is the name of the THING they want (「休憩」, 「臨時休業」),
    // which is a block inside a section whose label says none of it.
    const hours = searchTextOf(rowOf('store-hours'), byId['store-hours'])
    expect(hours).toContain('店舗情報・営業時間')
    expect(hours).toContain('店舗運営')
    expect(hours).toContain('予約ボードの操作')
    expect(hours).toContain('臨時休業')
    // …and a query that matches ONLY a block title still finds the row, and the
    // rail says WHICH block explained it rather than looking like a mismatch.
    expect(matchesQuery(hours, '臨時休業')).toBe(true)
    expect(hitOf(rowOf('store-hours'), byId['store-hours'], '臨時休業')).toBe('臨時休業')
    // …and a query the row's OWN label carries needs no explanation.
    expect(hitOf(rowOf('store-hours'), byId['store-hours'], '営業時間')).toBeNull()

    // ⚖ S17 · F13 — AND THE SETTINGS THEMSELVES ARE FINDABLE BY THEIR OWN NAME.
    // The room's own worked example was false: 「休憩」 is 休憩の有給扱い, a ROW,
    // and no block title contains it — so typing the word the tour teaches
    // returned the empty state. Row labels are in the index now, and the rail
    // chip names the ROW rather than the block it happens to sit in, because the
    // row is what the reader typed.
    expect(hours).toContain('休憩の有給扱い')
    expect(matchesQuery(hours, '休憩')).toBe(true)
    expect(hitOf(rowOf('store-hours'), byId['store-hours'], '休憩')).toBe('休憩の有給扱い')
    // …and the tour really does teach that word, so the sentence is true as
    // written rather than true in a later round.
    expect(SCREEN_CODE).toContain('「休憩」と入れると、その言葉を持つページが残ります。')
    // …every row label of every section is in its own row's index — not a
    // sample, the whole page (339 controls' worth of names).
    for (const sec of props.sections) {
      const text = searchTextOf(rowOf(sec.id), sec)
      for (const b of sec.blocks) for (const r of b.rows) {
        expect({ section: sec.id, row: r.label, indexed: text.includes(r.label) }).toEqual({ section: sec.id, row: r.label, indexed: true })
      }
    }
    // …and the ONE section that renders itself hands over its own sub-headings,
    // so 予約と確保 is findable by 上書きの権限 like every other setting is
    // findable by its name (⚖ D-8 keeps the JUMP list at two — findable and
    // jumpable are different questions).
    // ⚠ READ OUT OF THE SECTION'S OWN SOURCE, not imported: this suite's import
    // fence keeps react-dom out, so the component module cannot be loaded here —
    // and reading the list from the file is the stronger pin anyway, because the
    // next assertion checks every entry against a declaration in that same file.
    const headBlock = SECTION_CODE.slice(SECTION_CODE.indexOf('export const STORE_POLICY_HEADINGS'))
    const headings = [...headBlock.slice(headBlock.indexOf('= ['), headBlock.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(headings.length).toBe(12)
    // …and the list COVERS everything that section declares, which is the
    // direction that matters: a heading it draws and this list forgets is a
    // setting a reader cannot type the name of. (詳細設定 declares nothing — it
    // is the disclosure the eight dials fold into, not a setting — so it is
    // checked as text.)
    const declared = [...SECTION_CODE.matchAll(/data-guide-title="([^"]+)"/g)].map((m) => m[1])
    expect(declared.length).toBeGreaterThan(0)
    for (const d of declared) expect({ declares: d, indexed: headings.includes(d) }).toEqual({ declares: d, indexed: true })
    expect(headings).toContain('詳細設定')
    expect(SECTION_CODE).toContain("{ id: 'bg.adv', title: '詳細設定' }")
    const bg = searchTextOf(rowOf('booking-guard'), byId['booking-guard'], headings)
    for (const h of headings) expect({ heading: h, indexed: bg.includes(h) }).toEqual({ heading: h, indexed: true })
    expect(hitOf(rowOf('booking-guard'), byId['booking-guard'], '上書きの権限', headings)).toBe('上書きの権限')
    expect(byId['booking-guard'].blocks).toEqual([])
    // …and the SCREEN really hands them over — to the filter AND to the chip.
    // Without this the list above is a fact about a function nobody calls with
    // it, which is exactly how the battery caught the first cut of this pin.
    expect(SCREEN_CODE).toContain('(id === BOOKING_GUARD_ID ? STORE_POLICY_HEADINGS : undefined)')
    expect(SCREEN_CODE).toContain('searchTextOf(row, sectionById[row.id] ?? null, termsFor(row.id))')
    expect(SCREEN_CODE).toContain('hitOf(row, sectionById[row.id] ?? null, query, termsFor(row.id))')
    // An empty query is not a filter; a query nothing matches is honest silence.
    expect(matchesQuery(hours, '')).toBe(true)
    expect(matchesQuery(hours, '   ')).toBe(true)
    expect(props.rail.filter((r) => matchesQuery(searchTextOf(r, byId[r.id] ?? null), 'ぜったいにない語')))
      .toEqual([])
    // ⚠ CASE-FOLDED, for the Latin in a Japanese page: 「Reserve 受付」 and
    // 「AI設定」 are the two rows a reader types in lowercase.
    expect(matchesQuery(searchTextOf(rowOf('reserve-acceptance'), byId['reserve-acceptance']), 'reserve')).toBe(true)
    expect(matchesQuery(searchTextOf(rowOf('ai'), byId['ai']), 'ai')).toBe(true)
    // …and the footer's count is DERIVED, so a 23rd section cannot ship beside a
    // rail still claiming 22.
    expect(props.rail).toHaveLength(22)
    expect(SCREEN_CODE).toContain('`全${props.rail.length}件の設定 ・ 名前とページの中の見出しから探せます`')
  })

  it('⚖ S17 fix round 4 · L3 — a DESK pointer target clears WCAG 2.5.8’s 24px too', () => {
    // ⚠ THE ≤1023 BAND'S 44px FLOOR DOES NOT REACH A DESK, and the room's
    // smallest controls lived there: the ? — this page's ONLY entry to
    // 画面の説明 — measured 22×22, 詳しく 61×23, and a capability chip 106×27.
    // WCAG 2.5.8's minimum is 24 CSS px, and a mouse is not a reason to go under
    // it. The numbers are read out of the SHEET (fix round 2 · P3's lesson: a
    // pin that reads a number cannot be argued with) and the probe measures the
    // rendered boxes at 1280 and 1024.
    const decl = (sel: string, prop: string): number => {
      const at = CSS_CODE.indexOf(sel)
      expect({ sel, found: at >= 0 }).toEqual({ sel, found: true })
      const body = CSS_CODE.slice(at, CSS_CODE.indexOf('}', at))
      const m = new RegExp(`${prop}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(body)
      expect({ sel, prop, stated: m !== null }).toEqual({ sel, prop, stated: true })
      return Number(m![1])
    }
    expect(decl('.biz .pg-settings .st-help {', 'width')).toBeGreaterThanOrEqual(24)
    expect(decl('.biz .pg-settings .st-help {', 'height')).toBeGreaterThanOrEqual(24)
    expect(decl('.biz .pg-settings .st-det-btn {', 'min-height')).toBeGreaterThanOrEqual(26)
    expect(decl('.biz .pg-settings .st-pick {', 'min-height')).toBeGreaterThanOrEqual(28)
    expect(decl('.biz .pg-settings .st-select,', 'min-height')).toBeGreaterThanOrEqual(28)
  })

  it('⚖ S17 fix round 4 · M6 — filtering past the OPEN section keeps its row, marked 表示中, and the count still counts matches', () => {
    // ⚠ THE PANEL MUST ALWAYS HAVE A CURRENT ROW. Open 契約・請求, type
    // 「コーチング」, and the rail showed one row (コーチング) while the panel
    // still showed 契約・請求 — `.st-rail-item.is-on` count 0, and nothing on
    // screen saying which section the panel belonged to.
    expect(SCREEN_CODE).toContain('if (shownId === null || railHits.some((r) => r.id === shownId)) return railHits')
    expect(SCREEN_CODE).toContain('return open ? [open, ...railHits] : railHits')
    // …it is PREPENDED, so it sits at the top of its own group rather than
    // wherever the unfiltered order would have dropped it…
    expect(SCREEN_CODE).toContain('kept={!railHits.some((r) => r.id === row.id)}')
    expect(SCREEN_CODE).toContain('{kept && <span className="st-flag is-shown">表示中</span>}')
    // …and the COUNT is still the count of MATCHES, or the room would be lying
    // about its own search to explain a row it added itself.
    expect(SCREEN_CODE).toContain('`${railHits.length}件 / 全${props.rail.length}件の設定`')
    expect(SCREEN_CODE).not.toContain('`${shownRail.length}件 / 全${props.rail.length}件の設定`')
    // …and a query nothing answers still says so, ABOVE the kept row.
    expect(SCREEN_CODE).toContain('{railHits.length === 0 && (')
    expect(SCREEN_CODE).toContain('に当てはまる設定は見つかりませんでした。')
    // …the chip is NEUTRAL: the row already carries the accent as `.is-on`, and
    // 表示中 is a statement about where the reader is, never an action.
    expect(CSS_CODE).toContain('.biz .pg-settings .st-flag.is-shown { background: var(--st-soft); color: var(--ink-3); }')
  })

  it('a block is dirty when one of ITS OWN controls moved, and 変更 n件 counts controls', async () => {
    const props = await room({ store: STORE_A })
    const sec = sectionOf(props, 'store-hours')
    const seed = seedOf(props)
    const first = sec.blocks[0]
    const second = sec.blocks[1]

    expect(blockDirty(first, seed, seed)).toBe(false)
    expect(changedCount(sec, seed, seed)).toBe(0)

    const moved = { ...seed, [controlIdsOfBlock(first)[0]]: '__moved__' }
    // ⚠ THE DOT IS PER BLOCK, and that is the whole point of it: 色・テーマ has 67
    // controls, so 「something on this page is unsaved」 is not an answer — WHICH
    // group is.
    expect(blockDirty(first, moved, seed)).toBe(true)
    expect(blockDirty(second, moved, seed)).toBe(false)
    // …and the COUNT counts controls, not blocks: one changed dial and eight
    // changed dials would both read 「1件」 otherwise.
    expect(changedCount(sec, moved, seed)).toBe(1)
    const two = { ...moved, [controlIdsOfBlock(second)[0]]: '__moved__' }
    expect(changedCount(sec, two, seed)).toBe(2)
    expect(blockDirty(second, two, seed)).toBe(true)
  })

  it('⚖ S17 fix round 4 · B2 — a 臨時休業 row added or removed IS an unsaved change, and 保存 commits it', async () => {
    // ⚠ THE DEFECT THIS PINS. `sectionDirty` / `changedCount` / `blockDirty`
    // read `controlIdsOf` alone, so a reader who added 12月24日 saw the count
    // still say 「変更はありません」, no dot on 臨時休業, 保存する dimmed — and the
    // block's own note standing over it reading 「●は未保存の変更です」. The rows
    // are part of the section's state; every question is asked of both maps.
    const props = await room({ store: STORE_A })
    const sec = sectionOf(props, 'store-hours')
    const seed = seedOf(props)
    const coll = sec.blocks.find((b) => b.collection !== null)!
    const other = sec.blocks.find((b) => b.collection === null)!
    const base = coll.collection!.items

    // At rest the two maps are EMPTY and everything falls back to the payload.
    expect(rowsOfBlock(coll, {})).toEqual(base)
    expect(sectionDirty(sec, seed, seed, {}, {})).toBe(false)
    expect(changedCount(sec, seed, seed, {}, {})).toBe(0)
    expect(blockDirty(coll, seed, seed, {}, {})).toBe(false)

    // …a day ADDED is one change, on that block only.
    const added = addToCollection(coll.collection!, base, '2026-12-24', '設備メンテナンスのため')
    expect(added.error).toBeNull()
    const live = { [coll.id]: added.rows }
    expect(rowChanges(coll, live, {})).toBe(1)
    expect(blockDirty(coll, seed, seed, live, {})).toBe(true)
    expect(blockDirty(other, seed, seed, live, {})).toBe(false)
    expect(sectionDirty(sec, seed, seed, live, {})).toBe(true)
    expect(changedCount(sec, seed, seed, live, {})).toBe(1)
    // …and it COUNTS ALONGSIDE the controls, because a reader who moved a dial
    // and added a day made two changes to this page.
    const moved = { ...seed, [controlIdsOfBlock(other)[0]]: '__moved__' }
    expect(changedCount(sec, moved, seed, live, {})).toBe(2)

    // …a day REMOVED is one change too, and it is the same question.
    const gone = { [coll.id]: base.filter((r) => r.id !== base[0].id) }
    expect(rowChanges(coll, gone, {})).toBe(1)
    expect(sectionDirty(sec, seed, seed, gone, {})).toBe(true)

    // …and once 保存 has committed the rows, the same live map is CLEAN: the
    // baseline holds rows, so the dot goes out and the count goes back to zero.
    expect(sectionDirty(sec, seed, seed, live, live)).toBe(false)
    expect(changedCount(sec, seed, seed, live, live)).toBe(0)
    expect(blockDirty(coll, seed, seed, live, live)).toBe(false)
    // …and a REORDER is not a change: the DATE is the row's identity, which is
    // the wire's own rule (one row per store per date).
    expect(rowChanges(coll, { [coll.id]: [...base].reverse() }, {})).toBe(0)

    // THE SCREEN REALLY ASKS WITH THE ROWS. The two maps are optional
    // parameters, so a call site that forgets them compiles and under-reports —
    // the defect this item exists to remove. All four asks carry them, and
    // 保存 writes the baseline.
    expect(SCREEN_CODE).toContain('sectionDirty(section, values, saved, listRows, savedRows)')
    expect(SCREEN_CODE).toContain('changedCount(section, values, saved, listRows, savedRows)')
    expect(SCREEN_CODE).toContain('blockDirty(b, values, saved, listRows, savedRows)')
    const commit = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('const commitSection = useCallback'),
      SCREEN_CODE.indexOf('const openSection = useCallback'),
    )
    expect(commit).toContain('setSavedRows((prev) => {')
    expect(commit).toContain('for (const b of target.blocks) if (b.collection !== null) next[b.id] = rowsOfBlock(b, listRows)')
  })

  it('⚖ C1 — a day switched OFF sends `null` for THAT DAY, and never a null object', async () => {
    const props = await room({ store: STORE_A })
    const hours = sectionOf(props, 'store-hours').blocks.find((b) => b.id === 'store-hours.hours')!
    expect(hours.layout).toBe('week')
    expect(hours.rows).toHaveLength(7)
    // Every row carries its own weekday, which is how the payload is read back
    // off what was rendered rather than off an id format.
    expect(hours.rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])

    const seed = seedOf(props)
    const days = weekDaysOf(hours, seed)
    const payload = weeklyHoursPayload(days)
    // 月曜 is this world's 定休日, so it is `null` — 定休日, not 「unconfigured」.
    expect(payload.mon).toBeNull()
    expect(payload.tue).toEqual({ open: '10:00', close: '19:00' })
    expect(Object.keys(payload).sort()).toEqual(['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed'])
    // …and the row really renders as 定休日 for the reader, not only in the payload.
    const monSwitch = hours.rows[0].controls.find((c) => c.control.kind === 'switch')!
    expect(seed[monSwitch.id]).toBe(false)
    expect(labelOfValue(monSwitch.control, false)).toBe('定休日')

    // ⚠ TURN A SECOND DAY OFF AND ONLY THAT DAY GOES NULL. The whole-object null
    // means 「this store has never configured hours」, which switches the hours
    // filter off entirely — a screen that answered 「closed on Thursdays」 with it
    // would open the store's booking window to every hour of every day.
    const thu = hours.rows[3].controls.find((c) => c.control.kind === 'switch')!
    const off = weeklyHoursPayload(weekDaysOf(hours, { ...seed, [thu.id]: false }))
    expect(off.thu).toBeNull()
    expect(off.tue).toEqual({ open: '10:00', close: '19:00' })
    // …and switching every day off is still SEVEN nulls, never one.
    const allIds = hours.rows.map((r) => r.controls.find((c) => c.control.kind === 'switch')!.id)
    const allOff = weeklyHoursPayload(weekDaysOf(hours, { ...seed, ...Object.fromEntries(allIds.map((id) => [id, false])) }))
    expect(Object.values(allOff).every((v) => v === null)).toBe(true)
    expect(Object.keys(allOff)).toHaveLength(7)
  })

  it('⚖ C2 — 臨時休業 adds, removes, and refuses a duplicate date in the wire’s own words', async () => {
    const props = await room({ store: STORE_A })
    const block = sectionOf(props, 'store-hours').blocks.find((b) => b.id === 'store-hours.closures')!
    const coll = block.collection!
    expect(block.title).toBe('臨時休業')
    // ⚠ 特別営業 IS GONE FROM THE PAGE, AND FROM THE PLANE BEHIND IT. Core has no
    // field for it (registry ⑨ `special_open_days`), and a control that offers a
    // value the store cannot save is a lie with a picture on it. The `kind`
    // discriminator went with it, so a later round cannot quietly re-derive the
    // option from data that is still there.
    expect(JSON.stringify(block)).not.toContain('特別営業')
    expect(JSON.stringify(storeDials)).not.toContain('特別営業')
    expect(JSON.stringify(storeDials)).not.toContain("'extra'")
    // …and no closure's REASON describes the opposite of a closure. A row that
    // says 「10:00〜22:00（通常より延長）」 under a 臨時休業 heading is a sentence
    // about being open, on a list of days the store is shut (⚖ demo data is
    // product truth).
    for (const item of coll.items) {
      expect({ id: item.id, note: /延長|営業時間を延ばす/.test(item.note) }).toEqual({ id: item.id, note: false })
      expect(item.note.length).toBeGreaterThan(0)
    }

    const rows = coll.items
    expect(rows.length).toBeGreaterThan(0)
    const existing = rows[0].id
    expect(existing).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // adding a NEW date puts a row in…
    const added = addToCollection(coll, rows, '2026-12-24', '設備メンテナンスのため')
    expect(added.error).toBeNull()
    expect(added.rows).toHaveLength(rows.length + 1)
    // ⚠ D-19 RE-PIN (⚖ S17 fix round 1, F9): the added row's TITLE was the raw
    // ISO, so one list read 「9月13日(日)」 and 「2026-09-25」 together the moment
    // 追加 was used, and 取り消す announced the ISO to a screen reader. The id is
    // still the wire's `YYYY-MM-DD` — it is the identity a duplicate is refused
    // on — and only the title moved.
    expect(added.rows[added.rows.length - 1]).toEqual({ id: '2026-12-24', title: '12月24日(木)', note: '設備メンテナンスのため' })
    // ⚖ F9 — ONE LIST, ONE CALENDAR: a seeded row and an added row are titled by
    // the same function, so the shape holds across the whole list.
    const JP_DAY = /^\d+月\d+日\(.\)$/
    for (const r of added.rows) expect({ id: r.id, japanese: JP_DAY.test(r.title) }).toEqual({ id: r.id, japanese: true })
    // …and it is the CALENDAR date, never an instant re-projected into a zone:
    // a closed day is the day it says, everywhere.
    expect(dayTitle('2026-01-01')).toBe('1月1日(木)')

    // …the SAME date is refused, in the sentence the server would answer with,
    // and the list is left exactly as it was.
    const dup = addToCollection(coll, rows, existing, 'なんでも')
    expect(dup.error).toBe('その日はすでに臨時休業です')
    expect(dup.rows).toEqual([...rows])

    // …an empty date is refused too, and says which field.
    expect(addToCollection(coll, rows, '   ', '理由').error).toBe('日付を選んでください。')
    expect(addToCollection(coll, rows, '   ', '理由').rows).toEqual([...rows])

    // …and removal is the list minus that one row, which is what the screen does.
    expect(rows.filter((r) => r.id !== existing)).toHaveLength(rows.length - 1)
    expect(coll.removeLabel).toBe('取り消す')

    /* ⚠ D-33 (⚖ S17 fix round 4 · H6) — AND THE HANDLER REALLY CALLS IT. This
       test named a BEHAVIOUR (「臨時休業 adds, removes…」) and only ran the pure
       function, so the fresh-eyes round gutted `addRow` — `setListRows((prev) =>
       ({ ...prev }))`, dropping `next.rows` — and all 170 tests stayed green
       while 追加 was a completely dead lever: the two fields still cleared, so
       the press LOOKED like it worked and nothing anywhere said otherwise.

       No suite in this folder can mount React (territory's import fence), so
       the shape is read out of the handler's OWN slice: the decision comes from
       the rule, and the rule's answer is what reaches the state. The probe
       presses it for real (P1–P6d). */
    const addBody = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('const addRow = useCallback((block: SettingsBlock) => {'),
      SCREEN_CODE.indexOf('const removeFromCollection = useCallback'),
    )
    expect(addBody.length).toBeGreaterThan(100)
    expect(addBody).toContain('addToCollection(')
    // the refusal is spoken, and it is the ONLY thing that stops the row…
    const guard = 'if (next.error !== null) return'
    expect(addBody).toContain(guard)
    const afterGuard = addBody.slice(addBody.indexOf(guard) + guard.length)
    // …nothing else returns between the decision and the state…
    expect(afterGuard.slice(0, afterGuard.indexOf('setListRows('))).not.toMatch(/\breturn\b/)
    // …and what reaches the state is the RULE'S OWN ANSWER, not a copy of what
    // was already there.
    const call = afterGuard.slice(afterGuard.indexOf('setListRows('))
    const line = call.slice(0, call.indexOf('\n'))
    expect({ line, carriesTheAnswer: line.includes('next.rows') }).toEqual({ line, carriesTheAnswer: true })
    // …and 取り消す is the same shape: the row leaves the list it is removed from.
    const delBody = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('const removeFromCollection = useCallback'),
      SCREEN_CODE.indexOf('const commitSection = useCallback'),
    )
    expect(delBody).toContain('rows.filter((r) => r.id !== rowId)')
  })

  it('⚖ C6 — the 直前締切 select stores MINUTES and only says hours', async () => {
    const props = await room({ store: STORE_A })
    const cutoff = controlOf(props, 'reserve.cutoff')
    const options = cutoff.control.kind === 'select' ? cutoff.control.options : []
    // ⚠ THE VALUE IS `cutoff_minutes`. Holding hours here and multiplying at the
    // seam is exactly where a factor of 60 goes missing between two rounds.
    expect(options.map((o) => o.value)).toEqual(['60', '120', '180', '360'])
    expect(options.map((o) => o.label)).toEqual(['1時間前', '2時間前', '3時間前', '6時間前'])
    for (const o of options) expect(Number(o.value) % 60).toBe(0)
    // …and the seeded value is a real minute count, not an hour that happens to
    // be inside the list.
    expect(Number(cutoff.value)).toBeGreaterThanOrEqual(60)
    expect(options.some((o) => o.value === String(cutoff.value))).toBe(true)
    // The other four of the five mirrored fields keep the wire's own units.
    expect(controlOf(props, 'reserve.days').control.kind).toBe('number')
    expect(controlOf(props, 'reserve.free').control.kind).toBe('select')
    expect(controlOf(props, 'reserve.noshow').control.kind).toBe('segment')
  })

  it('⚖ mock D4 — the lead that points at the live card is TRUE at both widths', async () => {
    const props = await room({ store: STORE_A })
    const sec = sectionOf(props, 'booking-guard')
    // ⚠ THE PAYLOAD IS WHAT THIS PIN IS ABOUT, and the mutant that found the gap
    // proved why: the screen's fallback (`section.leadNarrow ? … : section.lead`)
    // renders perfectly well with the narrow form MISSING, so a source-only pin
    // stays green while the sentence goes back to pointing at nothing below ③.
    expect(sec.lead).toContain('右のカード')
    expect(sec.leadNarrow).toBeDefined()
    expect(sec.leadNarrow).toContain('下のカード')
    expect(sec.leadNarrow).not.toContain('右のカード')
    // …and the two are the SAME SENTENCE apart from that one word, so the pair
    // cannot drift into two different explanations of one card.
    expect(sec.leadNarrow!.replace('下のカード', '右のカード')).toBe(sec.lead)
    // …and no other section claims a narrow form it does not need.
    expect(props.sections.filter((x) => x.leadNarrow !== undefined).map((x) => x.id)).toEqual(['booking-guard'])
  })

  it('⚖ S17 fix round 4 · H3 — the PAGE’s own subtitle gets the same treatment, and so does the ? walk', async () => {
    // ⚠ THE ROOM SOLVED THIS ONCE AND LEFT ITS OWN HEADER OUT. 予約と確保's lead
    // got `leadNarrow` for exactly this reason, while the page subtitle went on
    // saying 「左の一覧から見たい設定を選ぶと、右にその中身が出ます」 at 390 —
    // where the list IS the page and a section REPLACES it. Same pair, same rule.
    const props = await room({ store: STORE_A })
    expect(props.subtitle).toContain('左の一覧')
    expect(props.subtitle).toContain('右にその中身が出ます')
    expect(props.subtitleNarrow).toContain('下の一覧から見たい設定を選ぶと、その中身が開きます')
    for (const word of ['左の一覧', '右に']) expect(props.subtitleNarrow).not.toContain(word)
    // …and the two are the same sentence up to the clause that points at a
    // column, so the pair cannot drift into two descriptions of one page.
    const stem = (s: string) => s.slice(0, s.indexOf('。') + 1)
    expect(stem(props.subtitleNarrow)).toBe(stem(props.subtitle))
    // BOTH forms are in the DOM and the SHEET picks — never JS, or the server
    // and the browser would disagree about the page's own description.
    expect(SCREEN_CODE).toContain('<span className="st-sub-wide">{props.subtitle}</span>')
    expect(SCREEN_CODE).toContain('<span className="st-sub-narrow">{props.subtitleNarrow}</span>')
    expect(CSS_CODE).toContain('.biz .pg-settings .st-sub-wide { display: none; }')
    expect(CSS_CODE).toContain('.biz .pg-settings .st-sub-narrow { display: inline; }')
    const wide = CSS_CODE.slice(CSS_CODE.indexOf('@media (min-width: 900px)'))
    expect(wide).toContain('.biz .pg-settings .st-sub-wide { display: inline; }')
    expect(wide).toContain('.biz .pg-settings .st-sub-narrow { display: none; }')
    // …and the ?-WALK's own head text, which is an ATTRIBUTE and therefore may
    // be swapped after mount: the tour was TEACHING the two-column sentence to
    // a reader who has one column.
    expect(SCREEN_CODE).toContain('data-guide={narrow ? HEAD_GUIDE_NARROW : HEAD_GUIDE_WIDE}')
    const guideWide = /const HEAD_GUIDE_WIDE =\s*\n\s*'([^']+)'/.exec(SCREEN_CODE)?.[1] ?? ''
    const guideNarrow = /const HEAD_GUIDE_NARROW =\s*\n\s*'([^']+)'/.exec(SCREEN_CODE)?.[1] ?? ''
    expect(guideWide).toContain('左の一覧')
    expect(guideNarrow).toContain('下の一覧から見たい設定を選ぶと、その中身が開きます')
    for (const word of ['左の一覧', '右に']) expect(guideNarrow).not.toContain(word)
  })

  it('⚖ mock review v2-3 — a DOOR is a wash pill; the solid accent is for COMMITS only', () => {
    // A door opens a page. A commit changes something. The family gives the
    // solid accent to the second and the wash to the first, and the mock's own
    // pixel review caught 予約と確保を開く wearing a solid fill.
    // ⚠ THE SCAN IS OVER BUTTON SURFACES. A switch's THUMB is a 18px dot inside
    // a control — the moving part of a selected state, whose track already wears
    // the wash — not a surface a reader reads as 「press me to commit」. It is
    // named out rather than silently skipped.
    const solid = [...CSS_CODE.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => /background: var\(--st-accent\)[;\s]/.test(m[2]))
      .map((m) => m[1].trim())
      .filter((sel) => !sel.includes('thumb'))
    expect(solid).toEqual([
      '.biz .pg-settings .st-act',
      '.biz .pg-settings .st-save',
    ])
    // …and both of them really are commits, by name.
    expect(SCREEN_CODE).toMatch(/className="st-act"[^>]*>\{block\.action\.label\}/)
    expect(SCREEN_CODE).toContain('className="st-save"')
    expect(SCREEN_CODE).toContain('保存する')
    // …and the door really is the wash tier, with accent text on an accent line.
    expect(CSS_CODE).toMatch(/\.st-link \{[^}]*background: var\(--st-accent-wash\)/)
    expect(CSS_CODE).toMatch(/\.st-link \{[^}]*color: var\(--st-accent\)/)
    expect(CSS_CODE).not.toMatch(/\.st-link \{[^}]*background: var\(--st-accent\);/)
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
    //
    // ⚖ S17 STEP 1 — RE-DERIVED, because the compositions changed. The ①→②
    // threshold RETIRED: the row's label track is now `minmax(0, min(240px,42%))`
    // beside `minmax(min-content, 1fr)`, so it has no floor to cross — the label
    // yields and the shape holds at every width the panel can be, and the stack
    // is the phone's media band instead. What replaced it is the ②→③ threshold,
    // which is the one this room actually has a choice about: whether the sticky
    // stack fits beside the panel.
    expect(
      tokenOf('st-rail-w') + tokenOf('st-gap') + tokenOf('st-main-min') + tokenOf('st-gap') + tokenOf('st-side-w'),
    ).toBe(960)
    // three preset cards + their two 12px gaps + 16px of slack
    expect(tokenOf('st-preset-min') * 3 + 24 + 16).toBe(640)
  })

  it('every term of the ②→③ threshold is REALLY SPENT by a rule, not just summed', () => {
    // A term that nothing spends is not a term — the defect this pin was written
    // for (`--st-ctl-min` was once declared, summed, and consumed by no rule at
    // all, so the arithmetic proved three numbers add up while the column
    // squeezed to 198). Every token below is read by the rule that lays out the
    // composition its number belongs to.
    for (const token of ['--st-rail-w', '--st-side-w', '--st-gap', '--st-main-min']) {
      const uses = (CSS_CODE.match(new RegExp(`var\\(${token}\\)`, 'g')) ?? []).length
      expect({ token, uses: uses >= 1 }).toEqual({ token, uses: true })
    }
    // ③ really is rail | panel | stack, and the stack's column is the token.
    expect(CSS_CODE).toMatch(/\.st-grid \{ grid-template-columns: var\(--st-rail-w\) minmax\(0, 1fr\); \}/)
    expect(CSS_CODE).toMatch(/\.st-panel \{ grid-template-columns: minmax\(var\(--st-main-min\), 1fr\) var\(--st-side-w\); \}/)
    // …and the ROW's own track is the bounded one the ultra-wide law asks for:
    // a label track that CAN shrink to zero (so a wide dial is never clipped)
    // but never grows past 240px (so a 2560px display becomes page white on the
    // right rather than 400px of dead space) — ⚖ mock review v2-1 / D14 / D15.
    expect(CSS_CODE).toMatch(
      /\.st-dial \{\s*display: grid;\s*grid-template-columns: minmax\(0, min\(var\(--st-label-w\), 42%\)\) minmax\(min-content, 1fr\);/,
    )
    expect(CSS_CODE).not.toMatch(/\.st-dial \{[^}]*minmax\(0, max-content\)/)
    // …and the control track is CAPPED, which is what stops the field floating.
    expect(CSS_CODE).toMatch(/\.st-dial-ctl \{[^}]*max-width: var\(--st-ctl-max\)/)
  })

  it('⚠ THE OVER-WIDE CHOICES USE canon’s OTHER SHAPE, THE SELECT (S9L-3)', async () => {
    // ⚠ THE GEOMETRY LAW IS A LAW, NOT AN ASPIRATION — and it is MEASURED by the
    // probe, at every band, across every rail row (B6), because a control's real
    // width is a fact about the cascade and no character count can stand in for
    // it. What jest holds is the STRUCTURAL half: canon states these six choices
    // as segmented controls whose labels are far wider than any column this room
    // can give them (「割引型（定価から引く）」, 「120分前まで」, five 分 options).
    // Raising `--st-ctl-min` to fit them would push iPad portrait (main 416) back
    // into the STACKED composition to serve six rows, so they wear canon's OTHER
    // shape instead — the select, which canon already uses on eight of its own
    // rows. If a later round turns one back into a segment, the probe will find
    // the wrap; this is the pin that says it was a decision.
    const props = await room({ store: STORE_A, role: 'オーナー' })
    // ⚠ THE LAST TWO WERE FOUND BY THE PROBE ON THIS ROUND'S OWN TIP, not by
    // reading: 所要時間 and 無料キャンセル期限 measured 261px — the widest segment
    // anywhere in the room — and wrapped at main 416 and 448. A geometry claim is
    // a fact about rects, and the browser is the only place it can be settled.
    // ⚖ S17 FOLD — `store-hours.rank` and `services.new-client` left this
    // vocabulary with the fold (their ONE home is 予約と確保, where #812 renders
    // them as segments sized by its own sheet). The geometry law still holds for
    // every over-wide choice this room still states.
    for (const id of ['pricing.framing', 'reserve.cutoff', 'reserve.gapfill', 'reserve.gapdisc', 'reserve.lead', 'reserve.free']) {
      expect({ id, shape: controlOf(props, id).control.kind }).toEqual({ id, shape: 'select' })
    }
    // …and the segments that REMAIN are the short ones: no single-choice segment
    // in the room carries more options than the four the floor was measured from.
    for (const c of controlsOf(props)) {
      if (c.control.kind !== 'segment') continue
      expect({ id: c.id, options: c.control.options.length <= 4 }).toEqual({ id: c.id, options: true })
    }
  })

  it('exactly two container queries, both min-width, one per container', () => {
    const queries = [...CSS_CODE.matchAll(/@container\s+(st-\w+)\s*\(([^)]*)\)/g)].map((m) => [m[1], m[2].trim()])
    // ⚖ S17 STEP 1 — RE-DERIVED. `st-panel`/`st-main` at 720/410 were the trace
    // card's threshold and the row's; the trace card is gone from the column and
    // the row has no threshold. What is left is the composition (`st-body`) and
    // the three-across grids (`st-main`). ⚠ ONE BLOCK EACH: two blocks at one
    // threshold are two places to read the same number, which is the thing this
    // pin exists to stop.
    // ⚠ AND THE ORDER IS PART OF THE PIN, because it is what makes ③ WIN. A
    // container query and a media query carry the SAME specificity, so at 1280
    // with the shell's rail open — where ②'s `@media (min-width: 900px)` and ③'s
    // `@container st-body (min-width: 960px)` both match — the winner is
    // whichever is written LAST. Written first, ③'s column lost to ②'s strip at
    // the exact width this product is read on, and only the shot showed it (the
    // jump list rendered as a row of chips inside the right column). `st-main`
    // is the three-across grid and sits above both, where nothing competes.
    expect(queries.map((q) => q.join(' '))).toEqual([
      'st-main min-width: 640px',
      'st-body min-width: 960px',
    ])
    expect(CSS_CODE.indexOf('@container st-body (min-width: 960px)'))
      .toBeGreaterThan(CSS_CODE.indexOf('@media (min-width: 900px)'))
    // ⚠ NO `max-width` CONTAINER QUERY ANYWHERE. A max-width band can be left and
    // re-entered on the way up, which is exactly the non-monotonic ladder the
    // gate forbids; every composition here is gained once and never given back.
    expect(CSS_CODE).not.toMatch(/@container[^)]*max-width/)
    // ⚠ AND NEITHER CONTAINER IS THE PAGE ROOT. `container-type: inline-size`
    // computes to `contain: layout …`, and `contain: layout` makes an element the
    // containing block for its `position: fixed` descendants — the ?-tour's four
    // layers are fixed and are children of the root, so a container there would
    // pin the spotlight to the page instead of the viewport.
    expect(CSS_CODE).not.toMatch(/\.page\.pg-settings \{[^}]*container/)
    expect(CSS_CODE).toMatch(/\.st-body \{ container: st-body \/ inline-size/)
    expect(CSS_CODE).toMatch(/\.st-main \{ container: st-main \/ inline-size/)
  })

  it('EVERY composition rule comes after EVERY base rule — the cascade, not the memory', () => {
    // ⚠ THIS PIN EXISTS BECAUSE THE SAME DEFECT LANDED TWICE IN ONE ROUND, and
    // both times every other pin stayed green.
    //   · ③'s sticky column was written above ②'s band, so at 1280 — where both
    //     match — ②'s strip won and the jump list rendered as a row of chips.
    //   · the three-across preset rule was written above #812's own
    //     `.st-presets` base rule (which lives in the APPENDED block, after the
    //     room's, by A9's ruling), so the presets NEVER went three across at any
    //     width the room can reach. The probe measured `.st-presets` resolving to
    //     one column at main 652 / 748 / 686 / 836, all over the 640 threshold.
    // A container query adds NO specificity, so between it and a bare rule of
    // the same selector the LATER one wins — which makes 「where the block is
    // written」 the composition, not a filing preference.
    const at = [...CSS_CODE.matchAll(/^@(container|media)[^\n]*/gm)]
    const compositions = at.filter((m) => !/prefers-reduced-motion/.test(m[0]))
    // every bare rule — a selector at the start of a line, outside any block
    const bare = [...CSS_CODE.matchAll(/^\.biz [^{\n]*\{/gm)]
    const lastBare = bare[bare.length - 1].index!
    const firstComposition = compositions[0].index!
    expect({ firstComposition: firstComposition > lastBare }).toEqual({ firstComposition: true })
    // …and the two that decide the same subjects are in ladder order: ② before
    // ③, so ③ wins where both match.
    expect(CSS_CODE.indexOf('@container st-body (min-width: 960px)'))
      .toBeGreaterThan(CSS_CODE.indexOf('@media (min-width: 900px)'))
    // …and the phone band is ONE band, not two, so 「the rules for a phone」 has
    // one home rather than a home and a leftover.
    expect((CSS_CODE.match(/@media \(max-width: 899px\)/g) ?? [])).toHaveLength(1)
    expect((CSS_CODE.match(/@media \(max-width: 1023px\)/g) ?? [])).toHaveLength(1)
  })

  it('the ladder is crossed once across the sweep, at the shell’s REAL rail widths', () => {
    // ⚠ THE HARNESS-GEOMETRY LAW, ARITHMETICALLY. The composition turns on
    // `.st-body`'s own width — the page minus the SHELL's rail minus this page's
    // gutters, capped at the ultra-wide 1416 — and never on the viewport's,
    // because the shell rail is 264px at ≥1024 and 76px below it, so a viewport
    // rule decides this from the wrong number.
    const gutter = (page: number) => (page >= 1400 ? 28 : page >= 1024 ? 24 : page >= 900 ? 18 : 14)
    const body = (page: number, railOpen = false) => {
      const shellRail = page >= 1024 && railOpen ? 264 : 76
      return Math.min(page - shellRail - 2 * gutter(page), 1416)
    }
    const rail = (page: number) => (page >= 1440 ? 240 : 200)
    const side = (page: number) => (page >= 1440 ? 300 : 288)
    const gap = (page: number) => (page >= 1440 ? 20 : 16)
    const SIDE_AT = 960
    const main = (page: number, railOpen = false) => {
      const b = body(page, railOpen)
      return b >= SIDE_AT ? b - rail(page) - gap(page) - side(page) - gap(page) : b - rail(page) - gap(page)
    }

    // ⚠ CHECKED AGAINST A HARDCODED EXPECTATION, not one derived by sorting the
    // same values this pin exists to catch: a sort-then-walk is monotonic BY
    // CONSTRUCTION no matter what the function returns, which is why that shape
    // shipped once already (V9-1) and had to be re-pinned as a literal array.
    const widths = [900, 1024, 1180, 1280, 1440, 1680, 1920, 2560]
    const shape = widths.map((w) => `${w}:${body(w, true)}:${body(w, true) >= SIDE_AT ? '③' : '②'}`)
    expect(shape).toEqual([
      '900:788:②', '1024:712:②', '1180:868:②', '1280:968:③',
      '1440:1120:③', '1680:1360:③', '1920:1416:③', '2560:1416:③',
    ])
    // ⚠ THE REFERENCE LAPTOP, WITH THE SHELL'S RAIL OPEN, IS THE WHOLE POINT.
    // 1280 open lands on 968 — EIGHT pixels over the threshold, deliberately,
    // because that is the width this product is actually read on. The fold
    // round's own D-2 was this arithmetic wrong by 52px in the other direction,
    // and the first cut of THIS round put it at exactly 960 (a scrollbar would
    // have dropped the room back to the strip) before the gutter band was fixed.
    expect(body(1280, true)).toBe(968)
    expect(body(1280, true) - SIDE_AT).toBe(8)
    // …and the reading column still clears its own floor there.
    expect(main(1280, true)).toBe(448)
    expect(main(1280, true) >= 440).toBe(true)
    // The strip is REACHED, so the composition is not a one-state ladder: a
    // narrow laptop with the rail open is ②, the same laptop collapsed is ③.
    expect(body(1180, true) >= SIDE_AT).toBe(false)
    expect(body(1180, false) >= SIDE_AT).toBe(true)
    // ⚖ ULTRA-WIDE — past 1920 the extra width is page margin, never stretch.
    expect(body(2560, true)).toBe(body(1920, true))
  })

  it('the ONE media-driven swap is the ⚖ list-is-the-page law, and nothing else', () => {
    // ⚖ S17 STEP 1 — 899, NOT 743. At 744-899 the rail and the panel together
    // left the panel under 400px, which is NARROWER than the phone's own
    // full-width section: the composition meant to be the richer one was the
    // poorer one. From 900 up both are on screen and the panel has room.
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 899px)'))
    expect(phone).toMatch(/\.st-panel \{ display: none; \}/)
    expect(phone).toMatch(/\.pg-settings\.is-detail \.st-rail \{ display: none; \}/)
    expect(phone).toMatch(/\.pg-settings\.is-detail \.st-panel \{ display: grid; \}/)
    // ⚠ `display: contents` IS WHAT LETS ONE DOM SERVE THREE COMPOSITIONS: the
    // stack dissolves so its three children become grid items of the panel in
    // their own right, which is the only way このページの中身 lands under the head
    // and the save bar sticks to the bottom without either being rendered twice.
    expect(phone).toMatch(/\.st-side \{ display: contents; \}/)
    expect(CSS_CODE).toMatch(/@media \(min-width: 900px\) \{\s*\.biz \.pg-settings \.st-grid \{ grid-template-columns: var\(--st-rail-w\)/)
    // …and no media band restates a COMPOSITION the container queries decided.
    const bands = CSS_CODE.slice(CSS_CODE.indexOf('@media (min-width: 1440px)'))
    expect(bands).not.toMatch(/\.st-grid \{[^}]*grid-template-columns/)
    expect(bands).not.toMatch(/\.st-panel \{[^}]*grid-template-columns/)
  })

  it('the ALL-SCREEN ladder states every band the law names', () => {
    for (const band of [
      '@media (min-width: 1440px)',
      '@media (max-width: 1399px)',
      '@media (max-width: 1023px)',
      '@media (max-width: 899px)',
      '@media (min-width: 900px)',
      '@media (prefers-reduced-motion: reduce)',
    ]) {
      expect({ band, present: CSS_SRC.includes(band) }).toEqual({ band, present: true })
    }
  })

  it('≥44px targets from 1023 down — every touch device, not just the phone', () => {
    const touch = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 1023px)'), CSS_CODE.indexOf('@media (max-width: 899px)'))
    for (const sel of [
      '.st-opt', '.st-pick', '.st-help', '.st-switch', '.st-swatch', '.st-select', '.st-input',
      '.st-back', '.st-link', '.st-save', '.st-jump-item', '.st-rail-item', '.st-det-btn',
      '.st-search-field', '.st-coll-del', '.st-spot-foot button',
      // ⚖ S17 fix round 1 · F14 — AND #812'S OWN CONTROL VOCABULARY. This list
      // was written from the room's `st-` names, so the twenty-four controls of
      // 予約と確保 — a whole section that arrived with its own class names —
      // measured 30–38px at 1023 · 899 · 768 · 744 · 440 · 390 while the other
      // five sections measured zero under 44. The list is now derived from what
      // the sheet DRAWS rather than from what this room happens to have named.
      '.sp-seg button', '.st-step-g button', '.st-step-g input', '.st-btn-add',
      '.st-lockadd select', '.btn.primary', '.st-lockchip button',
      '.st-pcard', '.st-adv > summary',
    ]) {
      expect({ sel, sized: touch.includes(sel) }).toEqual({ sel, sized: true })
    }
    // …and the list COVERS THE SHEET. Derived from every rule that declares
    // `cursor: pointer`, so a control class added next round fails HERE rather
    // than measuring 32px on somebody's phone — which is exactly how the
    // twenty-four controls of 予約と確保 shipped: the list was written from the
    // names this room happened to have, and a whole section arrived with its
    // own.
    const EXEMPT = new Set([
      // sized by their own rules inside the band, a few lines above:
      '.st-help', '.st-search-field', '.st-switch', '.st-swatch', '.st-step-g',
      '.st-lockchip',
      // not controls: the search ✕ sits INSIDE the 44px field, and the spot
      // layer is the tour's own scrim.
      '.st-search-clear', '.st-spot-catch',
      // ⚖ F19 — このページの中身's head is a CONTROL only at ①, where the list is
      // a disclosure; at every other band it is a heading (a `<div>`), because a
      // button that cannot change anything is a lever with a promise on it. It
      // is sized and pressed inside the ① block, asserted there rather than here.
      '.st-jump-head',
    ])
    const pressables = new Set<string>()
    for (const rule of CSS_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/cursor:\s*pointer/.test(rule[2])) continue
      for (const one of rule[1].split(',')) {
        const cls = one.match(/\.[a-z][a-z0-9-]*/g)
        if (cls) pressables.add(cls[cls.length - 1])
      }
    }
    expect(pressables.size).toBeGreaterThan(15)
    expect([...pressables].filter((c) => !EXEMPT.has(c) && !touch.includes(c))).toEqual([])
    // ⚠ RE-PINNED AS A GROUPED SELECTOR. The rail's rows used to carry their own
    // `min-height: 44px` at every width; the room's rows are 34px on a desk now
    // (the compact head's own scale) and grow to 44 in the touch band with every
    // other control, which is where the law actually applies.
    expect(touch).toMatch(/\.st-rail-item,[\s\S]*min-height: 44px/)
    /* ⚠ AND THE TWO NUMBERS THE LIST ABOVE CANNOT HOLD (⚖ S17 fix round 2 · P3).
       `.st-lockchip button` was already IN that list while it measured 34px, and
       the list stayed green: it asserts that a selector is NAMED inside the band,
       which is the right claim for the shared `min-height: 44px` group and no
       claim at all about a control sized by its own rule. The chip and its ✕ are
       both sized by their own rules — which is also why `.st-lockchip` sits in
       EXEMPT above — so naming them proved nothing.
       They are held HERE or nowhere: `lockedOut` is empty in every fixture, so
       the ✕ is a pressable no width sweep in this repo ever renders. The probe's
       G1b meets it only because that sweep ADDS a lock chip first, and a probe is
       not a pin. Same class of miss as F14 itself, one layer in. */
    expect(touch).toMatch(/\.st-lockchip \{[^}]*min-height: 44px/)
    expect(touch).toMatch(/\.st-lockchip button \{[^}]*width: 44px;[^}]*height: 44px/)
  })

  /* ⚖ S17 fix round 3 · R3-1 — A STICKY BAR IS CHARGED AGAINST THE SCREEN AT
     EVERY SCROLL POSITION, so what stands in it has to be the ACT. At ① the save
     card is `position: sticky; bottom: 0`, and 予約と確保's carried the 保存
     label, the row's own 18px of section padding and THREE sentences: ~185–220
     CSS px of a 390×844 phone, permanently, on a button that cannot be pressed
     on sample data — the section's first preset was a sliver between the head
     and the card. The sentences are not gone; they moved into the reading column
     where the room's own rooms already put theirs, and the bar kept the button
     and its one reason. */
  it('⚖ S17 fix round 3 · R3-1 — at ① the sticky save bar is the button and its one reason, and the standing sentences read in the column', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 899px)'))
    // the bar really is stuck to the bottom of the phone's screen (the reason
    // the rest of this pin exists)…
    expect(phone).toMatch(/\.st-save-card \{[^}]*position: sticky; bottom: 0/)
    // …so the section's save ROW is a button line: no section padding, no rule
    // above it, and its reason beside the control rather than under it.
    expect(phone).toMatch(/\.st-save-card \.st-row \{[\s\S]*?padding: 0; border-top: 0;/)
    expect(phone).toMatch(/\.st-save-card \.st-row \{[\s\S]*?display: flex; align-items: center/)
    expect(phone).toMatch(/\.st-save-card \.st-ctrl-d \{ margin: 0/)
    /* ⚠ THE 保存 LABEL IS HIDDEN, NOT DELETED, and that distinction is the whole
       accessibility of this row: `.sp-save` names itself through
       `aria-labelledby="stSaveLabel"`, and per accname a DIRECTLY REFERENCED
       element supplies the name whether or not it is displayed. Delete the
       element and the section loses its name; hide it and a sighted reader reads
       the name off the button they are looking at (この設定を保存) while a screen
       reader still hears 「保存」. */
    expect(phone).toMatch(/\.st-save-card \.st-ctrl-l \{ display: none; \}/)
    expect(SECTION_CODE).toContain('<p className="st-ctrl-l" id="stSaveLabel">保存</p>')
    expect(SECTION_CODE).toContain('aria-labelledby="stSaveLabel"')
    // …and the block itself is ONE control and at most ONE sentence: the hidden
    // label and the seam's refusal. A third line put back here is the defect
    // this item removed.
    const save = SECTION_CODE.slice(SECTION_CODE.indexOf('data-guide-title="保存"'))
    const saveBlock = save.slice(0, save.indexOf('</section>'))
    expect((saveBlock.match(/<p /g) ?? []).length).toBe(2)
    expect(saveBlock).not.toContain('PENDING_NOTE')
    expect(saveBlock).not.toContain('{props.save.roles')
    expect(saveBlock).toContain('{props.save.refusal}</p>')
    // …the two standing sentences read at the end of the section's own column…
    expect(SECTION_CODE).toMatch(/<div className="st-wrap">[\s\S]*\{foot\}[\s\S]*<\/div>/)
    expect(CSS_SRC).toContain('.biz .pg-settings .st-foots { display: flex; flex-direction: column; gap: 3px; }')
    /* ⚠ AND THE ROOM'S OWN FOOTNOTE MOVED THE SAME WAY, from the same place, for
       the same reason — one mechanism for all 22 sections, not a special case for
       the one the review looked at. ⚠ ② GAINED IT: the strip's card is a
       one-line toolbar and used to hide this line outright, so between 900 and
       959 the sentence was not merely low — it was GONE. */
    const mainBlock = SCREEN_CODE.slice(SCREEN_CODE.lastIndexOf('<div className="st-main">'))
    expect(mainBlock.slice(0, mainBlock.indexOf('</div>,'))).toContain('<p className="st-foot">{props.demoSaveLine}</p>')
    const sideBlock = SCREEN_CODE.slice(SCREEN_CODE.indexOf('sideNode(', SCREEN_CODE.lastIndexOf('<div className="st-main">')))
    expect(sideBlock.slice(0, sideBlock.indexOf('changed > 0,'))).not.toContain('st-foot')
    expect(CSS_CODE).not.toMatch(/\.st-save-card \.st-foot \{/)
  })

  it('⚖ S17 fix round 3 · R3-3 — closed, このページの中身 hugs its head instead of standing as an empty card', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 899px)'))
    /* ⚠ THE NUMBERS, NOT THE NAME (⚖ fix round 2 · P3's lesson, one layer in).
       `.st-jump` was NAMED in this band and still measured 67px, because what it
       is named for is its head's 44px touch height — nothing held the box's own
       padding. The head is 44 and the box's borders are 1 each way, so 3px of
       padding puts the closed box at 52 against the bar's 56. */
    expect(phone).toMatch(/\.st-jump-head \{[\s\S]*?min-height: 44px/)
    expect(phone).toContain('.biz .pg-settings .st-jump:has(.st-jump-head[aria-expanded="false"]) { padding-top: 3px; padding-bottom: 3px; }')
    // …and only when it is CLOSED: an open list keeps the box it needs.
    expect(phone).not.toMatch(/\.st-jump:has\(\.st-jump-head\[aria-expanded="true"\]\)/)
    // …and the state the rule reads is the one the head really publishes.
    expect(SCREEN_CODE).toContain('aria-expanded={jumpOpen}')
  })

  it('⚖ S17 fix round 3 · R3-4 — the 「‹ 設定」 back control is the width of its own words, on the axis a GRID actually reads', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 899px)'))
    /* ⚠ THE AXIS IS THE WHOLE FINDING. At ① `.st-side` is `display: contents`,
       so the pill is a direct item of `.st-panel` — and `.st-panel` is a grid.
       `align-self` is the grid's BLOCK axis; the inline axis is `justify-self`,
       whose initial value is `stretch`. A declaration that READS like the fix was
       already there and could not do it, which is why the pill measured 286px at
       390 and 664px at 768. Both are pinned: the one that was inert is kept
       because the panel is a flex column in the boundary states, and the one that
       does the work is named beside it. */
    expect(phone).toMatch(/\.st-back \{[\s\S]*?align-self: flex-start; justify-self: start;/)
    expect(phone).toMatch(/\.pg-settings\.is-detail \.st-panel \{ display: grid; \}/)
    // …and it is still a 44px target: the floor is the touch band's shared group.
    const touch = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 1023px)'), CSS_CODE.indexOf('@media (max-width: 899px)'))
    expect(touch).toMatch(/\.st-back,[\s\S]*min-height: 44px/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ R13 + the one-way accent law — pressables only', () => {
  it('no black-filled anything', () => {
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|#111|#18181b|black)/)
    expect(CSS_CODE).not.toMatch(/background:\s*var\(--ink/)
  })

  it('the accent is spent ONLY on things a reader can press', () => {
    // ⚖ THE ONE-WAY ACCENT LAW. Now that every control is live, the accent
    // belongs to every one of them — the wash recipe on a selected option, and
    // the SOLID fill on the two commit actions, which is what R13 reserves a
    // solid fill for. A decoration or a status line carrying accent would fail.
    // ⚠ THE SCAN IS FOR THE SATURATED ACCENT, NOT FOR THE WASH — and that
    // distinction IS the law rather than a loosening of it. CLAUDE.md's own
    // clause: 「LEGAL and out of scope: soft washes (bg-primary/8, bg-blue-50
    // info banners, wash-styled status chips — wash-level opacity or a *-50
    // tint, never a solid bg-primary fill on a non-pressable)」. So
    // `--st-accent-wash` is allowed anywhere and `--st-accent` / `--st-accent-dark`
    // are allowed only on a pressable. The old regex caught both because nothing
    // non-pressable in this room wore a wash yet; the preview card does now, and
    // a pin that cannot tell a wash from a fill would have forced the card to
    // lose the tint the law explicitly permits.
    const SATURATED = /var\(--st-accent(?!-wash)[a-z-]*\)/
    const accented = [...CSS_CODE.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => SATURATED.test(m[2]))
      .map((m) => m[1].trim())
    for (const sel of accented) {
      // ⚖ S17 STEP 1 — RE-DERIVED, and the four new names are all pressables or
      // parts of one. `st-seg-thumb` is the selected state OF the segment (it is
      // `pointer-events: none` decoration behind a real button); `st-rail-hit` is
      // a span INSIDE the rail's own `<button>` — 「judge the ELEMENT, not the
      // file: accent on a span inside a link/button is part of the pressable」
      // (CLAUDE.md, the one-way accent law's own clause). `st-jump-item`,
      // `st-det-btn`, `st-pick`, `st-back` and `st-search-field` are buttons and
      // a field.
      // `st-spot-hole` is the ?-walk's RING around the element being explained
      // and `st-spot-next` is its own button — the first is the law's named
      // exemption (「focus rings and focus-visible styles (a11y)」: a ring drawn
      // around the thing being taught is the same category), the second is a
      // control.
      const pressable = /st-rail-item|st-rail-hit|st-help|st-opt|st-seg-thumb|st-pick|st-switch|st-swatch|st-save|st-act|st-link|st-jump-item|st-det-btn|st-back|st-search-field|st-coll-del|st-spot-hole|st-spot-next/.test(sel)
      expect({ sel, pressable }).toEqual({ sel, pressable: true })
    }
    // …and the WASH really is limited to the surfaces the law names — a selected
    // state, a door, and one info card — rather than being sprayed about because
    // the scan above stopped looking at it.
    const washed = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*var\(--st-accent-wash\)[^}]*\}/g)].map((m) => m[1].trim())
    for (const sel of washed) {
      const named = /st-preview|st-help|st-opt|st-seg-thumb|st-pick|st-switch|st-rail-item|st-link|st-jump-item|st-det-btn|st-back|st-block|st-spot-next/.test(sel)
      expect({ sel, named }).toEqual({ sel, named: true })
    }
    // The selected option really is R13's wash recipe, never a solid fill — and
    // ⚖ S17 STEP 1 re-pins WHERE the recipe is painted rather than whether it is.
    // The segment grew a THUMB that travels on the room's spring, so the wash and
    // the accent border moved onto the thumb and the accent TEXT stayed on the
    // selected button. Same three ingredients, same law, one of them now moving.
    // (The mock drew a white thumb on a grey track — the platform's own
    // segmented control — which would have left the room with no accent at all
    // on the thing that IS selected. The law outranks the picture.)
    expect(CSS_CODE).toMatch(/\.st-seg-thumb \{[^}]*border: 1px solid var\(--st-accent\)/)
    expect(CSS_CODE).toMatch(/\.st-seg-thumb \{[^}]*background: var\(--st-accent-wash\)/)
    expect(CSS_CODE).toMatch(/\.st-opt\[aria-pressed="true"\] \{ color: var\(--st-accent\)/)
    expect(CSS_CODE).not.toMatch(/\.st-seg-thumb \{[^}]*background: #fff/)
    // …and the commit button really is the solid fill with its own text colour
    // and a hover that DARKENS within the accent rather than lightening.
    expect(CSS_CODE).toMatch(/background: var\(--st-accent\); color: #fff;/)
    expect(CSS_CODE).toContain('--st-accent-dark: #1d4ed8;')
    expect(CSS_CODE).not.toMatch(/\.st-save:hover \{[^}]*opacity/)
    // …and a control canon LOCKS stays neutral: nothing happens when it is
    // pressed, so nothing looks like it did.
    expect(CSS_CODE).toMatch(/\.st-opt\[aria-disabled="true"\]\[aria-pressed="true"\] \{ background: var\(--st-current-bg\)/)
  })

  it('press feedback exists for live controls and NOT for locked ones', () => {
    // ⚠ AND THE REDUCED-MOTION RESET MIRRORS THE SAME SELECTORS. It was written
    // once with a bare `.st-opt:active`, which states a press rule for a LOCKED
    // option even though its effect is to turn motion off — a rule that reads as
    // the opposite of the law it obeys. The scan is the WHOLE sheet for exactly
    // that reason.
    expect(CSS_CODE).toContain('.st-opt:not([aria-disabled="true"]):active')
    expect(CSS_CODE).toContain('.st-save:not(:disabled):active')
    expect(CSS_CODE).not.toMatch(/\.st-opt:active[,\s{]/)
    expect(CSS_CODE).not.toMatch(/\.st-pick:active[,\s{]/)
    expect(CSS_CODE).toMatch(/transform: scale\(\.97\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ PAGE-SCROLL + the ring — the sheet’s own structural pins', () => {
  it('the PAGE scrolls, and the two boxes that own an axis are the two that are pinned', () => {
    // ⚖ S17 STEP 1 — RE-DERIVED FROM 「NOT ONE CONTAINER」 TO 「TWO, NAMED」, and
    // the reason is a property of `position: sticky` rather than a preference: a
    // box pinned to the viewport that is TALLER than the viewport can never show
    // its own last row, because the page scroll no longer moves it. The rail
    // (22 rows) and the stack (a live card + a jump list + the save state) are
    // both pinned at ③, so each is capped at the viewport and scrolls inside
    // itself. This is the ② room's `.rv-sheet` precedent — one named exception,
    // stated where it is made — and the pin NAMES them so a third one goes red.
    const axisOwners = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*overflow-y:\s*auto[^}]*\}/g)].map((m) => m[1].trim())
    expect(axisOwners).toEqual([
      '.biz .pg-settings .st-side',
      // ⚠ THE LIST, NOT THE RAIL. The rail is the pinned FRAME and the list is
      // what moves inside it, so the 設定を検索 field and the count stay put
      // whatever is scrolled to — a field that scrolls away is one a reader has
      // to scroll back to in order to change what they are looking for.
      '.biz .pg-settings .st-rail-list',
    ])
    expect(CSS_CODE).not.toMatch(/\.st-rail \{[^}]*overflow-y/)
    // …and BOTH are inside the ③ query, where the stickiness that makes them
    // necessary also lives. At ② and ① neither is sticky and neither owns an axis.
    const three = CSS_CODE.slice(CSS_CODE.indexOf('@container st-body (min-width: 960px)'))
    for (const owner of axisOwners) expect(three).toContain(owner)
    // ⚠ AND THE PANEL NEVER DOES. The reading column is what the page is for; a
    // scroller around it would put the room's content behind a second scrollbar.
    expect(CSS_CODE).not.toMatch(/\.st-panel \{[^}]*overflow/)
    expect(CSS_CODE).not.toMatch(/\.st-main \{[^}]*overflow/)
    // ⚠ AND ③ UNDOES ALL OF ②, not just the parts that happened to look wrong.
    // ②'s `order` values put the toolbar above the dials and the live card below
    // them; left standing at ③ they reorder the STACK instead, so the card — the
    // stack's TOP by §2.4's ruling — was pushed ~509px down and its own caption
    // ended up ~99px below the pinned column's fold, reachable only by scrolling
    // inside the box that exists to avoid exactly that. Measured by the probe's
    // S4 at 1280 rail-open; the sheet-level guarantee is that every ② placement
    // is reset here.
    expect(three).toMatch(/\.st-side-card,\s*\n\s*\.biz \.pg-settings \.st-jump,\s*\n\s*\.biz \.pg-settings \.st-save-card \{ order: 0; grid-column: auto; max-width: none; \}/)
    // …and the toolbar's one-line `nowrap` does not follow it into the column.
    expect(three).toMatch(/\.st-save-card \{[^}]*white-space: normal/)

    // ⚠ NO HORIZONTAL AXIS ANYWHERE except the ② strip's own jump run, which is
    // a one-line chip scroller and says so by removing the vertical one.
    const xOwners = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*overflow-x:\s*auto[^}]*\}/g)].map((m) => m[1].trim())
    expect(xOwners).toEqual(['.biz .pg-settings .st-jump-list'])
    expect(CSS_CODE).toMatch(/\.st-jump-list \{[^}]*overflow-x: auto; overflow-y: hidden/)
  })

  it('NO container holding a focusable clips — a ring the room clips is not a ring', () => {
    const clippers = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*overflow\s*:\s*hidden[^}]*\}/g)].map((m) => m[1].trim())
    // ⚖ S17 FOLD — RE-DERIVED, AND THE LAW KEPT ITS TEETH. #812's sheet brought
    // three clippers. Two of them — its joined segmented control and its 刻み
    // stepper — really do hold `<button>`s, so `overflow: hidden` came OFF both
    // and the corners are drawn on their end children instead (D-4). The third
    // is the ONE allowed here, named rather than waved through: `.wc-hold-clip`
    // is the long-press fill's mask INSIDE the inert preview card, whose own
    // rule sets `pointer-events: none` and whose only child is a `<span>`. It
    // can clip no ring because no ring can exist inside it — and this pin says
    // so by name, so a fourth clipper still goes red.
    // ⚖ S17 STEP 1 — TWO MORE, AND EACH IS PROVEN RATHER THAN LISTED.
    //   `.st-det-wrap` is the 詳しく panel's height animator: `overflow: hidden`
    //     is what a height spring needs, and the panel holds FOUR SENTENCES —
    //     the proof below scans the screen's own markup for a focusable inside
    //     it, so the day someone puts a button in there this goes red.
    //   `.st-sr` is the visually-hidden helper that carries the dirty dot's
    //     sentence to a screen reader. It is a `<span>` of text by construction.
    expect(clippers).toEqual([
      '.biz .pg-settings .st-det-wrap',
      '.biz .pg-settings .st-sr',
      '.biz .pg-settings .st-pv-card .wc-hold-clip',
    ])
    // …proven, not asserted: the card that holds it is inert, and the mask's
    // only child is not focusable.
    expect(CSS_CODE).toMatch(/\.biz \.pg-settings \.st-pv-card \{[^}]*pointer-events: none/)
    expect(SECTION_CODE).toContain('<span className="wc-hold-clip" aria-hidden="true"><span className="wc-hold-fill" /></span>')
    // …and the 詳しく panel really holds nothing that can take focus: its whole
    // body is the `<ul className="st-det">` of `<li>` sentences, and the screen
    // renders no interactive element inside `Collapse`.
    const collapse = SCREEN_CODE.slice(SCREEN_CODE.indexOf('<Collapse open={open}'), SCREEN_CODE.indexOf('</Collapse>'))
    for (const focusable of ['<button', '<input', '<select', '<a ', 'tabIndex']) {
      expect({ focusable, inside: collapse.includes(focusable) }).toEqual({ focusable, inside: false })
    }
    // …and `.st-sr` is the screen-reader span, never a box anything is put in.
    expect(SCREEN_CODE).toMatch(/<span className="st-sr">[^<]+<\/span>/)
  })

  it('the room states no width floor of its own — the shell owns that', () => {
    const declarations = CSS_CODE.replace(/@media[^{]*\{/g, '{').replace(/@container[^{]*\{/g, '{')
    // ⚖ S17 FOLD — THE COPIED CARD IS EXEMPT, AND ONLY IT. `.st-pv-card`'s rules
    // are today.css's own warn-card rules carried byte for byte (⚖ flag 69), and
    // two of them state a `min-width` on a `width: fit-content` button. That is
    // not a PAGE floor: every one of them is capped by `max-width: 100%` in the
    // same rule, so the card can never be wider than the column it sits in —
    // which is what this law is actually about. Excised by SELECTOR, so a floor
    // anywhere else in the room still goes red.
    const noCard = declarations.replace(/[^{}]*\.st-pv-card[^{}]*\{[^}]*\}/g, '')
    expect(noCard).not.toMatch(/min-width\s*:\s*\d{3,}px/)
    for (const rule of [...CSS_CODE.matchAll(/([^{}]*\.st-pv-card[^{}]*)\{([^}]*min-width\s*:\s*\d{3,}px[^}]*)\}/g)]) {
      expect({ sel: rule[1].trim(), capped: /max-width\s*:\s*100%/.test(rule[2]) })
        .toEqual({ sel: rule[1].trim(), capped: true })
    }
    expect(CSS_CODE).not.toContain('.biz .app')
  })

  it('the room joins the shell’s 1180px floor opt-in list, and only the SHELL states it', () => {
    const shell = read('src/app/[locale]/(business)/business-shell.css')
    // ⚖ S17 FOLD (A5) — RE-DERIVED. ONE line, the UNION, main's order kept and
    // `.page.pg-settings` appended LAST: 録音・売上分析・予約一覧・顧客・AI相談 all
    // joined the shell's floor exemption on main while this room was building,
    // and the literal moves with them — which is the pin working, not failing.
    expect(shell).toContain('.biz .app:has(.page.pg-inbox, .page.pg-register, .page.pg-karute, .page.pg-recording, .page.pg-analytics, .page.pg-reservations, .page.page-customers, .page.pg-ask-ai, .page.pg-settings) { min-width: 0; }')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ THE SIBLING-SHEET FENCE, derived FRESH from today’s sheets', () => {
  const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
  /** ⚠ WALKS THE AT-RULES INSTEAD OF SPLITTING BLINDLY (F-K11, room 5). The naive
   *  cut did `src.split('}')` then `slice(0, indexOf('{'))`, and for the FIRST
   *  rule inside any `@media`/`@container` block the first `{` found is the
   *  query's OWN brace — so that selector was never seen at all. */
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
    const plant = '@media (max-width: 743px) {\n  .biz .inspector { display: none; }\n  .biz .pg-settings .st-foo { color: red; }\n}'
    expect(selectorsOf(plant)).toContain('.biz .inspector')
    const planted = '@container st-main (min-width: 380px) {\n  .biz .stray { color: red; }\n}'
    expect(selectorsOf(planted)).toContain('.biz .stray')
  })

  it('the neighbours are all here — TEN sheets, read from disk, never restated', () => {
    // ⚖ S17 FOLD — RE-DERIVED, NOT EXTENDED BY HABIT: `recording` (room 6) and
    // `ask-ai` (room 7) arrived on main between this room's build and its fold.
    // The list is READ from disk and this line is the pin on what was read — a
    // new neighbour is MEANT to fail here once, so the round that folds it
    // re-derives the collision list below in the same pass.
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'ask-ai', 'customers', 'inbox', 'karute', 'recording', 'register', 'reservations', 'shifts', 'today'])
  })

  it('every rule is scoped — nothing here can reach a neighbour', () => {
    const unscoped = selectorsOf(CSS_SRC).filter((s) => !s.includes('pg-settings'))
    expect({ unscoped }).toEqual({ unscoped: [] })
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
    // ⚖ S17 FOLD — RE-DERIVED FROM DISK, and the list grew for TWO reasons at
    // once. (1) customers.css and reservations.css tightened their own `.btn`
    // rules on main while this room was building, so the three that used to be
    // here are gone. (2) 予約と確保 renders today.css's SHIPPED warn card, by its
    // own class names — that is what makes the preview the card rather than a
    // drawing of it — so every bare `wc-*` / `hold-pop` / `holdbar-checks` /
    // `status` rule today.css states can now reach this room. Every one of them
    // IS fenced, and the loop below proves it name by name rather than trusting
    // this list to mean it.
    expect(collisions.sort()).toEqual([
      'today::.biz .holdbar-checks',
      'today::.biz .holdbar-checks .ck',
      'today::.biz .holdbar-checks .ck.bad',
      'today::.biz .holdbar-checks .ck.bad::before',
      'today::.biz .holdbar-checks .ck.warn',
      'today::.biz .holdbar-checks .ck.warn::before',
      'today::.biz .holdbar-checks .ck::before',
      'today::.biz .holdbar-checks.wc-rows',
      'today::.biz .hp-actions',
      'today::.biz .hp-actions .btn',
      'today::.biz .hp-actions.wc-foot',
      'today::.biz .hp-actions.wc-foot .btn',
      'today::.biz .hp-head',
      'today::.biz .hp-head strong',
      'today::.biz .status',
      'today::.biz .status.waiting',
      'today::.biz .wc-approve',
      'today::.biz .wc-approve:hover:not(:disabled)',
      'today::.biz .wc-greens',
      'today::.biz .wc-hold',
      'today::.biz .wc-hold',
      'today::.biz .wc-hold-clip',
      'today::.biz .wc-hold-fill',
      'today::.biz .wc-hold-text',
      'today::.biz .wc-hold::after',
      'today::.biz .wc-hold:disabled',
      'today::.biz .wc-impact',
      'today::.biz .wc-impact .wc-yen',
      'today::.biz .wc-lock',
      'today::.biz .wc-lock svg',
      'today::.biz .wc-note',
      'today::.biz .wc-prov',
      'today::.biz .wc-prov svg',
      'today::.biz .wc-safe',
      'today::.biz .wc-safe .wc-safe-main',
      'today::.biz .wc-safe .wc-safe-sub',
      'today::.biz .wc-warn-btn',
      'today::.biz .wc-warn-btn:hover:not(:disabled)',
    ])
    // THE FENCE ITSELF, per colliding name: this room states the same name at
    // FOUR levels or more, so it wins the tie in either visit order (⚖ flag 69).
    const roomSelectors = selectorsOf(CSS_SRC).filter((sel) => sel.includes('pg-settings'))
    for (const name of [...new Set(collisions.flatMap((c) => classesIn(c.split('::')[1])))].sort()) {
      const fenced = roomSelectors.some(
        (sel) => classesIn(sel).includes(name) && (sel.match(/\./g) ?? []).length >= 4,
      )
      expect({ name, fenced }).toEqual({ name, fenced: true })
    }
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
    const strays = [...rendered].filter((n) => !n.startsWith('st-') && !n.startsWith('is-') && !SHELL.has(n))
    expect(strays).toEqual([])
    expect([...rendered].filter((n) => n.startsWith('st-')).length).toBeGreaterThan(35)
  })

  it('this room’s own names exist NOWHERE else in the family', () => {
    const own = [...mine].filter((n) => n.startsWith('st-'))
    expect(own.length).toBeGreaterThan(35)
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
describe('the shell one-liners, and the signposts that now really navigate', () => {
  it('設定 is live in the rail, and its crumb drops the doubled word', () => {
    const sidebar = read('src/app/[locale]/(business)/BusinessSidebar.tsx')
    expect(sidebar).toContain("{ key: 'settings', segment: 'settings', label: '設定', mini: '設定', live: true }")
    const topbar = read('src/app/[locale]/(business)/BusinessTopbar.tsx')
    expect(topbar).toContain("settings: '設定',")
    // 「設定 / 店 / 設定」 is the same word twice with a store between them, so the
    // group drops for this room only. Every other screen keeps 店舗フロア.
    // ⚖ S17 FOLD (A4) — RE-PINNED, with its reason: main shipped a `GROUP` map
    // for AI相談's crumb while this room shipped `CRUMB_GROUP` for its own null.
    // Two maps answering one question is the disease; the fold keeps main's NAME
    // with this room's null semantics, so there is ONE table and no default to
    // disagree with.
    expect(topbar).toContain("const GROUP: Record<string, string | null> = {")
    expect(topbar).toContain('  settings: null,')
    expect(topbar).toContain("{GROUP[segment] === null ? '' : `${GROUP[segment] ?? '店舗フロア'} / `}")
    expect(topbar).not.toContain('CRUMB_GROUP')
    expect(topbar).not.toContain('DEFAULT_GROUP')
    expect(read('src/business/i18n/ja.json')).toContain('"settings"')
  })

  it('⚖ LINKED UP — the two rooms that point at 設定 point at its SECTION, as links', () => {
    // ⚠ A SIGNPOST THAT NAMES A DESTINATION WITHOUT REACHING IT is a sentence
    // asking the reader to do the navigating. Both now carry `?section=`, which
    // the settings page reads and opens on.
    const today = read('src/app/[locale]/(business)/business/today/TodayScreen.tsx')
    // ⚖ S17 FOLD — RE-PINNED, with its reason: the board's 保護ルール signpost used
    // to open 店舗情報・営業時間, which held スキマガード. After the fold that dial
    // has ONE home — 予約と確保 — so a link to the old section would open a page
    // that cannot do what the chip promises (⚖ label truth). The old target is
    // forbidden, not merely replaced.
    expect(today).toContain('/business/settings?section=booking-guard')
    expect(today).not.toContain('/business/settings?section=store-hours')
    expect(today).not.toContain('変更は「設定」ルームで（準備中）')
    const register = read('src/app/[locale]/(business)/business/register/register-props.ts')
    expect(register).toContain('/business/settings?section=payments')
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
    expect(PLANE_SRC).toContain('⚠ ONE HOME AT MERGE')
    expect(PLANE_SRC).toContain('fixtures-coaching.coachingStores')
  })

  it('a stored preference is untrusted input, and the defaults stand when it is not', () => {
    expect(readPrefs(null)).toEqual(PREFS_DEFAULT)
    expect(readPrefs('not json')).toEqual(PREFS_DEFAULT)
    expect(readPrefs('[]')).toEqual(PREFS_DEFAULT)
    expect(readPrefs('{"density":"enormous"}')).toEqual(PREFS_DEFAULT)
    expect(readPrefs('{"density":"compact","emphasis":"strong"}')).toEqual({ density: 'compact', emphasis: 'strong' })
  })
})
