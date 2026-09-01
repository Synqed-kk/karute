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
import { storeDials } from '@/business/lib/fixtures-settings'
import { shiftsPolicy } from '@/business/lib/fixtures-shifts'
import { closedWeekday, operatingHours, opsConfig, resources, storeBookingPolicy } from '@/business/lib/fixtures-today'
import {
  accessFor,
  blockingError,
  CAPABILITY_LABEL,
  CAPABILITY_ORDER,
  clampCoachingFloor,
  clampCoachingRetention,
  clampWinBackDays,
  COACHING_FLOOR_MAX,
  COACHING_FLOOR_MIN,
  commitNumber,
  controlIdsOf,
  fillTemplate,
  firstOpenSection,
  gateOf,
  hhmm,
  labelOfValue,
  PREFS_DEFAULT,
  PRESET_GRANTS,
  RAIL,
  readPrefs,
  RETENTION_MAX_MONTHS,
  RETENTION_MIN_MONTHS,
  sameValue,
  sectionById,
  sectionDirty,
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
const SCREEN_CODE = stripLine(stripComments(SCREEN_SRC))
const PLANE_CODE = stripLine(stripComments(PLANE_SRC))

const room = async (input?: { store?: string; role?: string; section?: string; dials?: null }) =>
  (
    await settingsProps({
      locale: 'ja',
      store: input?.store,
      section: input?.section,
      world: input?.role !== undefined || input?.dials !== undefined ? { role: input?.role, dials: input?.dials } : undefined,
    })
  ).props

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
    expect(controlOf(props, 'store-hours.guard').value).toBe(storeBookingPolicy.gapGuardMode)
    expect(controlOf(props, 'store-hours.booking-step').value).toBe(String(opsConfig.bookingStepMin))
    expect(controlOf(props, 'store-hours.block-step').value).toBe(String(opsConfig.blockStepMin))
    expect(controlOf(props, 'store-hours.min-sellable').value).toBe(String(opsConfig.minSellableMin))
    expect(controlOf(props, 'store-hours.rank').value).toBe(storeBookingPolicy.heldRankAccess)
    expect(controlOf(props, 'store-hours.release').value).toEqual([...storeBookingPolicy.releaseHeldRoles])
    expect(controlOf(props, 'services.new-client').value).toBe(String(storeBookingPolicy.newClientSessionMinutes))
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
    for (const source of [
      'storeBookingPolicy.gapGuardMode',
      'opsConfig.bookingStepMin',
      'opsConfig.blockStepMin',
      'opsConfig.minSellableMin',
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
  const NOBODY = accessFor('スタッフ')
  const MANAGER = accessFor(operator.role)

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
      expect({ role, open: gateOf(sectionById('business-structure')!, accessFor(role)) }).toEqual({ role, open: 'no-rights' })
    }
    expect(gateOf(sectionById('business-structure')!, accessFor('オーナー'))).toBe('open')
    expect(gateOf(sectionById('billing')!, accessFor('オーナー'))).toBe('open')
    expect(CAPABILITY_ORDER).not.toContain('business.manage')
  })

  it('an unknown role holds nothing — never a default grant', () => {
    expect(accessFor('不明').has('settings.manage')).toBe(false)
    expect(firstOpenSection(accessFor('不明'))?.id).toBe('recording')
    // …and the presets are canon's own, unedited.
    expect(PRESET_GRANTS.manager).toContain('settings.manage')
    expect(PRESET_GRANTS.practitioner).not.toContain('settings.manage')
    expect(PRESET_GRANTS.owner).toContain('billing.manage')
    expect(PRESET_GRANTS.manager).not.toContain('billing.manage')
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
    // …plus the two this room adds, and nothing else.
    expect(labels.filter((l) => !CANON_PAGES.includes(l))).toEqual(['顧客・連絡', '自分の表示設定'])
    expect(RAIL).toHaveLength(21)
  })

  it('NOT ONE SECTION IS A STUB — every open section carries real content', async () => {
    for (const role of ['店舗管理者', 'オーナー']) {
      const props = await room({ store: STORE_A, role })
      for (const s of props.sections) {
        if (s.gate !== 'open') continue
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
  })

  it('the staff matrix is canon’s own eight capabilities, in plain words', async () => {
    const props = await room({ store: STORE_A })
    const grid = controlsOf(props).find((c) => c.id.startsWith('staff.caps-'))!
    expect(grid.control.kind).toBe('chips')
    const options = grid.control.kind === 'chips' ? grid.control.options : []
    expect(options.map((o) => o.value)).toEqual([...CAPABILITY_ORDER])
    expect(options).toHaveLength(8)
    // ⚠ AND NOT ONE OF THEM IS SPELLED AS A TOKEN. canon's mock prints
    // `staff.manage` on a chip because canon is a developer artefact; ⚖ 「plain
    // names, never codes」 outranks the mock, so the grid keeps canon's eight
    // facts and wears the product's own language (S9L-2).
    for (const o of options) {
      expect({ value: o.value, plain: o.label === CAPABILITY_LABEL[o.value as never] && !/\./.test(o.label) })
        .toEqual({ value: o.value, plain: true })
    }
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

  it('a number field is corrected ON COMMIT, never while it is being typed', () => {
    // ⚠ A CLAMP THAT FIRES PER KEYSTROKE MAKES 「1」 UNREACHABLE on the way to
    // 「14」 — the guardrail would fight the reader instead of protecting them.
    expect(commitNumber('4000', WIN_BACK_MIN, WIN_BACK_MAX)).toBe(WIN_BACK_MAX)
    expect(commitNumber('', WIN_BACK_MIN, WIN_BACK_MAX)).toBe(WIN_BACK_MIN)
    expect(commitNumber('abc', WIN_BACK_MIN, WIN_BACK_MAX)).toBe(WIN_BACK_MIN)
    expect(commitNumber('61', WIN_BACK_MIN, WIN_BACK_MAX)).toBe(61)
    expect(SCREEN_CODE).toContain('onBlur={locked ? undefined : (e) => onChange(c.id, String(commitNumber(e.target.value, k.min, k.max)))}')
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
    expect(CSS_CODE).toContain('.st-readout.is-phrase b { font-size: 14px;')
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
          ['a control’s accessible name', '予約の移動単位'],
          ['a block fact', '記録は削除できません。すべての変更は自動で記録され、いつでも確認できます。'],
          ['a switch label', '有給（休憩も含めて計算）'],
          ['a list item', 'まとめての書き出しはできません。'],
        ] as const) {
          expect({ shape, seen: strings.includes(sample) }).toEqual({ shape, seen: true })
        }
        // …and a FILLED preview sentence really arrives in the scan.
        expect(strings.some((s) => s.startsWith('予約は30分きざみ'))).toBe(true)
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
    for (const id of ['store-hours.guard', 'store-hours.booking-step', 'store-hours.block-step', 'store-hours.min-sellable', 'payments.tolerance']) {
      expect({ id, same: controlOf(ginza, id).value === controlOf(daikanyama, id).value }).toEqual({ id, same: true })
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
    expect(rowOf('store-hours.row-booking-step').scopeLabel).toBe('事業全体')
    expect(rowOf('coaching.row-enabled').scopeLabel).toBe('この店舗')
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

  it('every term of the ①→② threshold is REALLY SPENT by a rule, not just summed', () => {
    // `--st-ctl-min` was once declared, summed and consumed by NO RULE: the
    // control track was `minmax(0, max-content)`, floor zero, so the threshold
    // pin proved that three numbers add up while the column squeezed to 198 and
    // wrapped an orphan chip across 744-791. A term that nothing spends is not a
    // term.
    expect((CSS_CODE.match(/--st-ctl-min:\s*\d+px/g) ?? []).length).toBe(1)
    expect(CSS_CODE).toMatch(
      /\.st-dial \{\s*grid-template-columns: minmax\(var\(--st-what-min\), 1fr\) minmax\(var\(--st-ctl-min\), max-content\);/,
    )
    expect(CSS_CODE).not.toMatch(/\.st-dial \{[^}]*minmax\(0, max-content\)/)
    // …and a control set that must wrap anyway wraps to the RIGHT, so a spare
    // chip is never orphaned under the first one.
    expect(CSS_CODE).toContain('.st-dial > .st-dial-ctl .st-seg { justify-content: flex-end; }')
    for (const token of ['--st-what-min', '--st-what-gap']) {
      const uses = (CSS_CODE.match(new RegExp(`var\\(${token}\\)`, 'g')) ?? []).length
      expect({ token, uses: uses >= 1 }).toEqual({ token, uses: true })
    }
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
    for (const id of ['store-hours.rank', 'pricing.framing', 'reserve.cutoff', 'reserve.gapfill', 'reserve.gapdisc', 'reserve.lead']) {
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
    expect(queries.map((q) => q.join(' '))).toEqual([
      'st-panel min-width: 720px',
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
    const panel = (page: number, railOpen = false) => {
      const shellRail = page >= 1024 && railOpen ? 264 : 76
      const content = page - shellRail - 2 * gutter(page)
      return page >= 744 ? content - 220 - 20 : content
    }
    const main = (page: number, railOpen = false) => {
      const p = panel(page, railOpen)
      return p < 720 ? p : ((p - 20) * 2.2) / 3.2
    }

    // ⚠ CHECKED AGAINST A HARDCODED EXPECTATION, not one derived by sorting the
    // same values this pin exists to catch: a sort-then-walk is monotonic BY
    // CONSTRUCTION no matter what `main()` returns, which is why that shape
    // shipped once already (V9-1) and had to be re-pinned as a literal array.
    const LEVEL_AT = 410
    const widths = [390, 412, 480, 743, 744, 768, 800, 1024, 1180, 1280, 1586]
    const level = widths.map((w) => `${w}:${Math.round(main(w))}:${main(w) >= LEVEL_AT ? '②' : '①'}`)
    expect(level).toEqual([
      '390:286:①', '412:308:①', '480:376:①', '743:639:②',
      '744:392:①', '768:416:②', '800:448:②', '1024:660:②',
      '1180:547:②', '1280:616:②', '1586:821:②',
    ])
    expect(level.some((r) => r.endsWith('②')) && level.some((r) => r.endsWith('①'))).toBe(true)
    // ⚠ iPad PORTRAIT IS ②, and 744 split view is ① — named, because that is the
    // pair the ladder turns on and the next reader will check it first.
    expect({ p768: main(768) >= LEVEL_AT, split744: main(744) >= LEVEL_AT }).toEqual({ p768: true, split744: false })
    expect(main(1024, true) >= LEVEL_AT).toBe(true)
    const desk = [390, 743, 744, 800, 1024, 1180, 1280, 1586].map((w) => panel(w) >= 720)
    expect(desk).toEqual([false, false, false, false, false, true, true, true])
    // ⚠ AND THE REFERENCE LAPTOP WITH THE SHELL'S RAIL OPEN, which is the state
    // this product is really read in: 1280 open must reach the desk composition.
    expect(panel(1280, true) >= 720).toBe(true)
    expect(main(1180) >= LEVEL_AT).toBe(true)
  })

  it('the ONE media-driven swap is the ⚖ list-is-the-page law, and nothing else', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toMatch(/\.st-panel \{ display: none; \}/)
    expect(phone).toMatch(/\.pg-settings\.is-detail \.st-rail \{ display: none; \}/)
    expect(phone).toMatch(/\.pg-settings\.is-detail \.st-panel \{ display: flex; \}/)
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
    for (const sel of ['.st-opt', '.st-help', '.st-switch', '.st-swatch', '.st-select', '.st-input', '.st-back', '.st-link', '.st-save', '.st-spot-foot button']) {
      expect({ sel, sized: touch.includes(sel) }).toEqual({ sel, sized: true })
    }
    // The rail's own rows are 44 at EVERY width — they are the page on a phone.
    expect(CSS_CODE).toMatch(/\.st-rail-item \{[^}]*min-height: 44px/)
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
    const accented = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*var\(--st-accent[^}]*\}/g)].map((m) => m[1].trim())
    for (const sel of accented) {
      const pressable = /st-rail-item|st-help|st-opt|st-switch|st-swatch|st-save|st-act|st-link/.test(sel)
      expect({ sel, pressable }).toEqual({ sel, pressable: true })
    }
    // The selected option really is R13's wash recipe, never a solid fill…
    expect(CSS_CODE).toMatch(/\.st-opt\[aria-pressed="true"\] \{ background: var\(--st-accent-wash\)/)
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
    const block = CSS_CODE.slice(CSS_CODE.indexOf('.st-rail-item:active'), CSS_CODE.indexOf('transform: scale(.98)'))
    expect(block).toContain('.st-opt:not([aria-disabled="true"]):active')
    expect(block).toContain('.st-save:active')
    expect(block).not.toMatch(/\.st-opt:active[,\s]/)
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

  it('the neighbours are all here — EIGHT sheets, read from disk, never restated', () => {
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'customers', 'inbox', 'karute', 'register', 'reservations', 'shifts', 'today'])
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
    expect(topbar).toContain('const CRUMB_GROUP: Record<string, string | null> = { settings: null }')
    expect(topbar).toContain("const DEFAULT_GROUP = '店舗フロア'")
    expect(read('src/business/i18n/ja.json')).toContain('"settings"')
  })

  it('⚖ LINKED UP — the two rooms that point at 設定 point at its SECTION, as links', () => {
    // ⚠ A SIGNPOST THAT NAMES A DESTINATION WITHOUT REACHING IT is a sentence
    // asking the reader to do the navigating. Both now carry `?section=`, which
    // the settings page reads and opens on.
    const today = read('src/app/[locale]/(business)/business/today/TodayScreen.tsx')
    expect(today).toContain('/business/settings?section=store-hours')
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
