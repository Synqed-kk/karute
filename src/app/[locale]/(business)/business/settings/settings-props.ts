// 設定 — THE ROOM'S PROP ASSEMBLY, beside the page rather than inside it (the
// room-3 F1 law): the evidence harness imports THIS function, so an isolated
// shot runs the same assembly the deployed route does and a drift between them
// is a compile error rather than a picture nobody can check.
//
// ══ EVERY CANON PAGE IS BUILT HERE ══════════════════════════════════════════
//
// The eighteen `fable-settings-*.html` pages plus `fable-billing-plan.html`, each
// read end-to-end and carried into this room's grammar: its own sections, its own
// controls, its own copy, its own gating. Nothing is a 準備中 stub, because the
// owner ruled that a settings page that does not work is not a settings page.
//
// ══ WHERE EVERY VALUE ON THIS PAGE COMES FROM ═══════════════════════════════
//
// ⚠ THIS ROOM OWNS NO VALUE THAT ANOTHER ROOM ALREADY OWNS. A settings page
// carrying its own copy of a store's dial is the second home the ⚖ one-truth law
// forbids — and the copy is the one the reader believes, so a page saying 「15分」
// while the board snaps to 30 is worse than a page saying nothing. Everything the
// rooms have shipped is READ from the plane that ships it (the list is in
// `fixtures-settings.ts`'s own header); `fixtures-settings` states only what the
// product has nowhere else to put.
//
// ══ SCOPE IS PRINTED ON EVERY POLICY ROW, AND IT IS NOT DECORATION ══════════
//
// canon's own 予約ボードの操作 block says 「事業（…）の設定です」 — a BUSINESS
// setting, not a store one — and the world agrees: `opsConfig` /
// `storeBookingPolicy` are one object for the whole tenant, while the settings
// plane is keyed BY STORE. A manager who changes a business-wide dial believing
// it touches only their shop is the mistake-proofing law's own failure case, so
// every policy row states which it is and the store switcher proves it.
//
// EVERY DATE CROSSES THE CLIENT BOUNDARY AS A FORMATTED STRING (the family law):
// the screen holds no clock and no formatter.

import { analyticsPolicy, salesTargets } from '@/business/lib/fixtures-analytics'
import { defaultStoreId, listStoreOptions, renderNow, type StoreLens } from '@/business/lib/data'
import { business, menus, operator, reserveSync, staff, stores } from '@/business/lib/fixtures'
import { cashTolerance, MAX_CASH_TOLERANCE } from '@/business/lib/fixtures-register'
import {
  AUDIT_CATEGORIES,
  bookingPalette,
  businessProfiles,
  colorTokenMeaning,
  connectorCatalog,
  entitlement,
  planPricing,
  rulebook,
  storeDials,
  type StoreDials,
} from '@/business/lib/fixtures-settings'
import { shiftsPolicy } from '@/business/lib/fixtures-shifts'
import { closedWeekday, operatingHours, opsConfig, resources, storeBookingPolicy } from '@/business/lib/fixtures-today'
import {
  accessFor,
  clampCoachingFloor,
  clampCoachingRetention,
  clampWinBackDays,
  COACHING_FLOOR_MAX,
  COACHING_FLOOR_MIN,
  dayTitle,
  firstOpenSection,
  gateOf,
  hhmm,
  minutesLabel,
  RAIL,
  RETENTION_MAX_MONTHS,
  RETENTION_MIN_MONTHS,
  sectionById,
  WEEKDAY_OF,
  weeklyHoursFrom,
  WIN_BACK_MAX,
  WIN_BACK_MIN,
  withCurrent,
  yen,
  type ControlOption,
  type RailEntry,
  type RailRow,
  type RowControl,
  type SettingsAccess,
  type SettingsBlock,
  type SettingsProps,
  type SettingsRow,
  type SettingsSection,
} from '@/business/lib/settings'
import { storePolicyProps, type StorePolicyPropsInput } from './store-policy-props'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const fmtDayWeek = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', ...JST })
/** ⚖ S17 STEP 1 — the save stamp's clock. Formatted HERE because the family law
 *  is that the screen holds neither a clock nor a formatter, and pinned to the
 *  page's own render instant so a shot of the same page is the same picture
 *  twice. 24-hour, JST, exactly as the topbar's own Reserve同期 stamp reads. */
const fmtClock = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, ...JST })

/** ⚖ 8/25 — a number says WHAT it counts. One home for the units this room
 *  repeats, so 「61日」 on the row and 「14日」 in its guardrail are the same
 *  spelling by construction. */
const days = (n: number) => `${n}日`
const months = (n: number) => `${n}か月`
const people = (n: number) => `${n}名`
const times = (n: number) => `${n}回`

export interface SettingsPropsInput {
  locale: string
  store?: string
  /** ⚖ LINKED UP. A trace card in another room points at a SECTION, and the link
   *  really lands on it — `?section=決済` opens 決済 rather than dropping the
   *  reader on whatever the page opens on and leaving them to hunt. */
  section?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness and the suite need worlds this demo plane does not hold —
   *  a reader with no settings rights, a store whose settings are missing — and
   *  the only honest way to picture one is to run the REAL derivations on it. */
  world?: {
    role?: string
    dials?: StoreDials | null
  }
}

export interface SettingsPropsResult {
  props: SettingsProps
  /** ⚖ S17 / A1 — ONE ASSEMBLY. 予約と確保's payload is built by
   *  `storePolicyProps()` (#812's own page body) and handed through here, so the
   *  route and the evidence harness render the SAME assembly rather than a
   *  hand-written replica of it. It rides BESIDE `props` because
   *  `@/business/lib/settings` is the room's PURE rules file — its inventory is
   *  empty and pinned that way, so a props type from another module may not
   *  enter it. */
  storePolicy: Awaited<ReturnType<typeof storePolicyProps>>
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. `page.tsx` keys the screen by it, so which
   *  section is open resets when the store changes — the ⚖ 8/17 isolation law at
   *  the frame as well as the read. */
  storeKey: string
}

export async function settingsProps({ locale, store, section, world }: SettingsPropsInput): Promise<SettingsPropsResult> {
  void locale
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  // ⚖ S17 — the lens is REALLY read now: 予約と確保's assembly takes it as its
  // first argument, which is the data door's own rule (`foundation.test.ts`:
  // 「every read requires the store lens as its first argument」).
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  const now = renderNow()
  const role = world?.role ?? operator.role
  const access = accessFor(role, rulebook)
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'

  // ⚠ THE STORE CLAMP IS THE READ, not a filter after it: one store's settings
  // are fetched by id and no other store's row is ever in the payload (⚖ 8/17).
  const dials = world?.dials !== undefined ? world.dials : clamped ? (storeDials[storeId!] ?? null) : null

  const ctx: Ctx = {
    storeId: clamped ? storeId! : null,
    lensLabel,
    dials,
    access,
    now,
  }

  // ⚖ S17 / A1 — 予約と確保's own assembly, run HERE so the room has one. The
  // input is what this function already settled: the resolved lens, the store
  // list it was resolved against and the render's ONE clock read, passed in
  // rather than re-read so the two halves of the page cannot disagree about
  // which store or which instant they describe.
  const storePolicyInput: StorePolicyPropsInput = { lens, storeId, clamped, storeOptions, now }
  const storePolicy = await storePolicyProps(storePolicyInput)

  const sections = RAIL.map((entry) => buildSection(entry, ctx))
  // ⚖ A LINK FROM ANOTHER ROOM LANDS WHERE IT POINTED — but only where the
  // reader may actually go: an unknown or gated `?section=` falls back to the
  // first section this reader can open, rather than to a boundary they did not
  // ask for.
  const asked = section ? sectionById(section) : null
  const opening = asked && gateOf(asked, access) === 'open' ? asked : firstOpenSection(access)

  const props: SettingsProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    subtitle:
      'お店の決まりごとと、自分の見え方をここでまとめて変えます。左の一覧から見たい設定を選ぶと、右にその中身が出ます。',
    // ⚖ H3 — and the same sentence where the room is one column deep, told the
    // way it is actually true there: the list is above, and the section OPENS.
    subtitleNarrow:
      'お店の決まりごとと、自分の見え方をここでまとめて変えます。下の一覧から見たい設定を選ぶと、その中身が開きます。',
    rail: RAIL.map<RailRow>((entry) => ({
      id: entry.id,
      group: entry.group,
      label: entry.label,
      state: gateOf(entry, access),
      scope: entry.scope,
    })),
    railHeading: '設定カテゴリー',
    sections,
    openingSectionId: opening?.id ?? null,
    // ⚖ H1 — and whether that id is the READER'S ASK or this page's own default.
    // Resolved here because here is where `?section=` was resolved: a browser
    // re-deriving it would have to read the URL on the client and disagree with
    // the server's first render about what the page is showing.
    openedByUrl: opening !== null && asked !== null && opening.id === asked.id,
    // ⚠ ONE HONEST SENTENCE, ON EVERY STORE SECTION (the room-5 F5-1 law: the
    // foot is rendered whichever section is open, so nothing here may describe a
    // screen the reader is not on). It replaces sixteen refusal paragraphs.
    demoSaveLine: '保存はこの画面の中だけに反映されます（実データ接続後に本保存）。',
    selfSaveLine: 'この設定はこの端末のこのブラウザに保存され、ほかのスタッフの画面は変わりません。',
    boundaryFallback: '設定を変更できる権限がありません。店舗の設定は、権限のあるアカウントでのみ表示されます。',
    // The demo persona, so the boundary sentences can say who is reading rather
    // than 「あなた」 to somebody who is not who the page thinks they are.
    roleLabel: role,
    saveStampTime: fmtClock.format(now),
  }

  return { props, storePolicy, storeKey: clamped ? storeId! : 'all-stores' }
}

// ── the builders' shorthand ─────────────────────────────────────────────────
//
// ⚖ ONE VOCABULARY, NINETEEN PAGES. Every control site below is one of eight
// shapes, so a reader who learns one settings page has learned all of them and a
// reviewer reads one grammar rather than nineteen bespoke blocks.

interface Ctx {
  storeId: string | null
  lensLabel: string
  dials: StoreDials | null
  access: SettingsAccess
  now: Date
}

const opts = (pairs: Array<[string, string]>): ControlOption[] => pairs.map(([value, label]) => ({ value, label }))
const minuteOpts = (list: readonly number[], current: number): ControlOption[] =>
  withCurrent(list, current).map((m) => ({ value: String(m), label: minutesLabel(m) }))

const seg = (id: string, aria: string, options: ControlOption[], value: string, locked?: string): RowControl =>
  ({ id, aria, control: { kind: 'segment', options }, value, ...(locked ? { locked } : {}) })
const sw = (id: string, aria: string, onLabel: string, offLabel: string, value: boolean, locked?: string): RowControl =>
  ({ id, aria, control: { kind: 'switch', onLabel, offLabel }, value, ...(locked ? { locked } : {}) })
const sel = (id: string, aria: string, options: ControlOption[], value: string, locked?: string): RowControl =>
  ({ id, aria, control: { kind: 'select', options }, value, ...(locked ? { locked } : {}) })
const txt = (
  id: string,
  aria: string,
  value: string,
  extra: { placeholder?: string; maxLength?: number; required?: boolean } = {},
): RowControl => ({ id, aria, control: { kind: 'text', ...extra }, value })
const num = (id: string, aria: string, value: number, min: number, max: number, step: number, unit: string): RowControl =>
  ({ id, aria, control: { kind: 'number', min, max, step, unit }, value: String(value) })
const tim = (id: string, aria: string, value: string): RowControl => ({ id, aria, control: { kind: 'time' }, value })
const chips = (
  id: string,
  aria: string,
  options: ControlOption[],
  value: string[],
  locked?: string,
  grid?: boolean,
  keep?: { value: string; reason: string },
): RowControl =>
  ({ id, aria, control: { kind: 'chips', options, ...(grid ? { grid } : {}), ...(keep ? { keep } : {}) }, value, ...(locked ? { locked } : {}) })
const swatch = (id: string, aria: string, options: ControlOption[], value: string): RowControl =>
  ({ id, aria, control: { kind: 'swatch', options }, value })
const ro = (id: string, aria: string, text: string, unit = '', numeric = false): RowControl =>
  ({ id, aria, control: { kind: 'readout', unit, numeric }, value: text })

const row = (
  id: string,
  label: string,
  description: string,
  controls: RowControl[],
  extra: Partial<Pick<SettingsRow, 'scopeLabel' | 'meta' | 'trio' | 'link' | 'source' | 'weekday'>> = {},
): SettingsRow => ({
  id,
  label,
  description,
  scopeLabel: extra.scopeLabel ?? null,
  meta: extra.meta ?? [],
  controls,
  ...(extra.trio ? { trio: extra.trio } : {}),
  ...(extra.link ? { link: extra.link } : {}),
  // ⚖ S17 — the receipt, beside the value it is a receipt for (see
  // `SettingsRow.source`). It prints inside the row's own 詳しく.
  ...(extra.source ? { source: extra.source } : {}),
  ...(extra.weekday !== undefined ? { weekday: extra.weekday } : {}),
})

const block = (
  id: string,
  title: string,
  note: string,
  rows: SettingsRow[],
  extra: Partial<Omit<SettingsBlock, 'id' | 'title' | 'note' | 'rows'>> = {},
): SettingsBlock => ({
  id,
  title,
  note,
  rows,
  facts: extra.facts ?? [],
  links: extra.links ?? [],
  list: extra.list ?? null,
  table: extra.table ?? null,
  filterBy: extra.filterBy ?? [],
  preview: extra.preview ?? null,
  action: extra.action ?? null,
  audit: extra.audit ?? null,
  collection: extra.collection ?? null,
  ...(extra.layout ? { layout: extra.layout } : {}),
  ...(extra.flag ? { flag: extra.flag } : {}),
  ...(extra.rightsNote ? { rightsNote: extra.rightsNote } : {}),
})

const BUSINESS_SCOPE = '事業全体'
const STORE_SCOPE = 'この店舗'
const SELF_SCOPE = '自分だけ'

// ── the sections ────────────────────────────────────────────────────────────

function buildSection(entry: RailEntry, ctx: Ctx): SettingsSection {
  const gate = gateOf(entry, ctx.access)
  const base = {
    id: entry.id,
    group: entry.group,
    label: entry.label,
    scope: entry.scope,
    gate,
    boundaryLine: gate === 'no-rights' ? boundaryLineFor(entry, ctx.access.role) : null,
  }

  // ⚠ THE GATE IS ANSWERED PER SECTION AND NOTHING BELOW IT RUNS FOR A CLOSED
  // ONE: a section a reader may not open has no content in its payload at all,
  // rather than content a class is hiding.
  if (gate === 'no-rights') {
    return { ...base, kicker: '権限', title: entry.label, lead: '', blocks: [], aside: null, persist: null }
  }

  if (entry.scope === 'self') return myDisplay(base)
  if (ctx.dials === null) return noStore(base, entry)
  return storeSection(base, entry, ctx, ctx.dials)
}

type SectionBase = Pick<SettingsSection, 'id' | 'group' | 'label' | 'scope' | 'gate' | 'boundaryLine'>

function boundaryLineFor(entry: RailEntry, role: string): string {
  // ⚖ S17 · C7 — THE SENTENCE WAS WRONG AND IS CORRECTED AT THE SOURCE.
  // It used to end 「この権限は、スタッフ管理の権限の一覧からは配れません」, on the
  // first cut's reading of canon's staff MOCK, which lists eight tokens and not
  // this one. The product's own list has eighteen and `business.manage` is #2
  // (`src/lib/auth/permissions.ts:16`): owner-only BY DEFAULT — excluded from
  // the manager preset at `:76` — and grantable per staff member, since nothing
  // strips it from an explicit grant the way `effectiveCapabilities()` strips
  // `recordings.viewAll` for non-owners (`:137`). Telling a manager that a
  // permission cannot be handed out, when it can, is the room closing a door
  // that is open.
  if (entry.needs === 'business.manage') {
    return `${entry.label}を変えられるのは「事業の管理」の権限を持つ人です（標準ではオーナーだけ）。${role}の権限では開けません。この権限は、スタッフ管理の権限の一覧から配れます。`
  }
  return `${entry.label}は、${role}の権限では開けません。この設定を変更できる権限を持つアカウントでのみ表示されます。`
}

function noStore(base: SectionBase, entry: RailEntry): SettingsSection {
  return {
    ...base,
    kicker: '店舗を選んでください',
    title: entry.label,
    lead: 'お店の設定は店舗ごとの値です。左上の店舗の切替でどの店舗を見るか選ぶと、その店舗の値が表示されます。',
    blocks: [],
    aside: null,
    persist: null,
  }
}

/** 自分の表示設定 — THE ONE SECTION THAT REALLY SAVES OUTSIDE THIS SCREEN.
 *
 *  ⚠ IT IS ALSO THE ROOM'S PROOF. It sits inside a group full of permission-gated
 *  store sections and is reachable with NO permission at all, because `gateOf`
 *  answers `open` for a self-scoped section before it looks at access. */
function myDisplay(base: SectionBase): SettingsSection {
  return {
    ...base,
    kicker: '自分だけの設定',
    title: '自分の表示設定',
    // canon fable-settings-colors.html, kept in meaning: 個人スコープ、権限ゲートなし.
    lead: 'ボードの見え方の好みは人によって分かれます。ここは自分だけの設定で、ほかの人の画面は変わりません。権限に関わらず、どのアカウントでも変更できます。',
    blocks: [
      block(
        'my-display.prefs',
        '見え方の好み',
        'ボードの予約カードをどう見せるかの好みです。押すとすぐ下のプレビューが変わります。',
        [
          row('my-display.row-density', '密度', 'ボードの予約カードの間隔です。', [
            seg('my-display.density', '密度', opts([['spacious', 'ゆったり'], ['standard', '標準'], ['compact', 'コンパクト']]), 'standard'),
          ], { scopeLabel: SELF_SCOPE }),
          row('my-display.row-emphasis', '強調', '予約カードの状態をどれくらい強く見せるかです。', [
            seg('my-display.emphasis', '強調', opts([['subtle', '控えめ'], ['standard', '標準'], ['strong', '強め']]), 'standard'),
          ], { scopeLabel: SELF_SCOPE }),
        ],
        {
          preview: {
            template: 'いまの設定は「{my-display.density}・{my-display.emphasis}」です。この端末に保存しました。',
            attrs: { 'data-density': 'my-display.density', 'data-emphasis': 'my-display.emphasis' },
          },
        },
      ),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '保存先', value: 'この端末のこのブラウザだけ' },
        { label: '他のスタッフ', value: '影響しません' },
        { label: '権限', value: '不要（お店の設定とは別です）' },
      ],
      note: 'お店の設定が変えられないアカウントでも、ここは変えられます。自分の見え方は自分のものだからです。',
    },
    persist: 'local',
  }
}

// ── the store sections ──────────────────────────────────────────────────────

function storeSection(base: SectionBase, entry: RailEntry, ctx: Ctx, d: StoreDials): SettingsSection {
  switch (entry.id) {
    case 'store-hours':
      return storeHours(base, ctx, d)
    case 'booking-guard':
      return bookingGuard(base)
    case 'services':
      return services(base, ctx, d)
    case 'people-equipment':
      return peopleEquipment(base, ctx, d)
    case 'payments':
      return payments(base, ctx, d)
    case 'customer-contact':
      return customerContact(base, ctx, d)
    case 'pricing-points':
      return pricingPoints(base, ctx, d)
    case 'ai':
      return aiSettings(base, ctx, d)
    case 'recording':
      return recording(base, ctx, d)
    case 'coaching':
      return coaching(base, ctx, d)
    case 'sync':
      return sync(base, ctx, d)
    case 'reserve-acceptance':
      return reserveAcceptance(base, ctx, d)
    case 'notifications':
      return notifications(base, ctx, d)
    case 'staff':
      return staffAdmin(base, ctx, d)
    case 'integrations':
      return integrations(base, ctx, d)
    case 'data-io':
      return dataIo(base, ctx, d)
    case 'audit-log':
      return auditLog(base, ctx, d)
    case 'language-display':
      return languageDisplay(base, ctx, d)
    case 'colors':
      return colors(base, ctx, d)
    default:
      // Unreachable while RAIL and this switch agree — and the suite proves they
      // do, section by section, rather than trusting the comment. 事業構成 and
      // 契約・請求 never arrive here because both are gated shut above.
      return businessSection(base, entry, ctx, d)
  }
}

/** 事業構成 and 契約・請求 — built, and reachable only for the role canon gives
 *  them. They are in this arm because the demo persona never opens them, and a
 *  section nobody in the demo can open still has to be a real page for the role
 *  that can. */
function businessSection(base: SectionBase, entry: RailEntry, ctx: Ctx, d: StoreDials): SettingsSection {
  return entry.id === 'billing' ? billing(base, ctx, d) : businessStructure(base, ctx, d)
}

// ── 予約と確保 ──────────────────────────────────────────────────────────────
//
// ⚖ S17 FOLD — THE SECTION HEAD AND NOTHING ELSE. Every control in this section
// lives in `StorePolicySection.tsx`, which is #812's own room re-homed: the
// presets, the live card and the eight dials keep their own state, their own
// save and their own `data-guide` declarations there. What this file supplies is
// the section's PLACE in the rail — its kicker, its title, its lead and the one
// declaration the shell's ?-walk reads off the section head (A2).

/** ⚖ A2 — #812's own page-head declaration, re-homed onto the section head. The
 *  literal is kept whole so the tour step a manager reads is the one that
 *  shipped, and so the room's suite can pin it where it now lives. */
const BOOKING_GUARD_GUIDE =
  'この店舗の予約と確保のルールを、まとめて決める画面です。まずプリセットを選び、変えたいところだけ詳細設定で直します。右のカードは、いまの設定でスタッフの画面に出るものです。'

/** #812's two lead paragraphs, verbatim and in order — the section's own lead. */
const BOOKING_GUARD_LEAD =
  '予約と確保のルールを、ここでまとめて決めます。まずは3つのプリセットから選び、直したいところだけ詳細設定で変えられます。右のカードは、いまの設定でスタッフの画面に出てくるものです。'
/** ⚖ mock D4 — ONE CHARACTER, and it is label truth rather than polish. The card
 *  is on the RIGHT only where the sticky stack fits (the ③ composition); below
 *  that it rides above the panel, and a lead pointing right would be pointing at
 *  nothing. Both forms ship and the sheet shows the true one. */
const BOOKING_GUARD_LEAD_NARROW = BOOKING_GUARD_LEAD.replace('右のカード', '下のカード')

function bookingGuard(base: SectionBase): SettingsSection {
  return {
    ...base,
    kicker: '店舗運営',
    title: '予約と確保',
    lead: BOOKING_GUARD_LEAD,
    leadNarrow: BOOKING_GUARD_LEAD_NARROW,
    guide: BOOKING_GUARD_GUIDE,
    // ⚠ NO BLOCKS, AND THAT IS THE POINT. A second copy of these dials in this
    // file's vocabulary would be exactly the two-rooms-one-path problem the fold
    // exists to end.
    blocks: [],
    // The right column of this section is #812's live スタッフが見るカード, which
    // the section renders itself; a trace card beside it would be a second
    // answer to 「where does this value come from」.
    aside: null,
    persist: null,
  }
}

// ── 店舗情報・営業時間 ──────────────────────────────────────────────────────

const WEEKDAYS: Array<[number, string]> = [
  [1, '月'], [2, '火'], [3, '水'], [4, '木'], [5, '金'], [6, '土'], [0, '日'],
]

function storeHours(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const p = storeBookingPolicy
  // ⚖ C1 — the plane boundary, and the ONE place the seven days come into being.
  const fallbackWindow = { open: hhmm(operatingHours.open), close: hhmm(operatingHours.close) }
  const weekly = weeklyHoursFrom(fallbackWindow.open, fallbackWindow.close, closedWeekday)
  const closedName = `${WEEKDAYS.find(([n]) => n === closedWeekday)?.[1] ?? ''}曜`
  return {
    ...base,
    kicker: '店舗運営',
    title: '店舗情報・営業時間',
    lead: 'お店の基本情報と、いつ営業しているかの設定です。営業時間はReserveの予約枠の土台になり、ボードの操作の刻みもここで決めます。',
    blocks: [
      block('store-hours.info', '店舗情報', '予約ページ・アプリに表示される基本情報です。', [
        row('store-hours.row-name', '店舗名', 'お客様に表示される名称です。', [
          txt('store-hours.name', '店舗名', ctx.lensLabel, { required: true, maxLength: 40 }),
        ], { scopeLabel: STORE_SCOPE }),
        row('store-hours.row-address', '住所', '予約確認と地図の表示に使われます。', [
          txt('store-hours.address', '住所', d.profile.address, { maxLength: 80 }),
        ], { scopeLabel: STORE_SCOPE }),
        row('store-hours.row-phone', '電話番号', 'お客様からのお問い合わせ用です。', [
          txt('store-hours.phone', '電話番号', d.profile.phone, { maxLength: 20 }),
        ], { scopeLabel: STORE_SCOPE }),
        row('store-hours.row-photo', '店舗写真', '予約ページのいちばん上に表示されます。', [
          ro('store-hours.photo', '店舗写真', d.profile.photo ?? '未設定'),
        ], { scopeLabel: STORE_SCOPE }),
      ], {
        facts: ['店舗写真の登録はこれから用意します。それまでは未設定のまま表示されます。'],
      }),
      // ⚖ S17 · C1 — SEVEN DAYS, EACH WITH ITS OWN PAIR, because that is what
      // core's `weekly_hours` is (`WeeklyHours`, dist/types.d.ts:1047-1050 — one
      // window per weekday, a null weekday meaning 定休日). The seven are
      // DERIVED here, once, from the single pair the board and Reserve already
      // read (`fixtures-today.operatingHours` + `closedWeekday`): the settings
      // plane states no second copy of them (`fixtures-settings`'s own ADD-ONLY
      // law). `row.weekday` carries the day number so the payload can be read
      // back off the rendered rows rather than off an id format.
      block('store-hours.hours', '営業時間', '曜日ごとの通常営業です。定休日は「営業する」をオフにします。', WEEKDAYS.map(([dayIndex, name]) => {
        const day = weekly[WEEKDAY_OF[dayIndex]] ?? null
        return {
          ...row(`store-hours.row-day-${dayIndex}`, `${name}曜`, '', [
            sw(`store-hours.day-${dayIndex}`, `${name}曜に営業する`, '営業', '定休日', day !== null),
            // ⚠ A CLOSED DAY KEEPS ITS OWN WINDOW IN THE FIELDS. The wire sends
            // `null` for it, and the room could render two empty boxes to match
            // — but then turning Monday back on would ask the manager to retype
            // hours the store never actually forgot. The store's window is what
            // the boxes show; the SWITCH is what decides whether it is sent.
            tim(`store-hours.open-${dayIndex}`, `${name}曜の開始時刻`, (day ?? fallbackWindow).open),
            tim(`store-hours.close-${dayIndex}`, `${name}曜の終了時刻`, (day ?? fallbackWindow).close),
          ]),
          weekday: dayIndex,
        }
      }), {
        layout: 'week',
        // ⚖ C1 — THE SENTENCE READS THE SEVEN, and it had to stop being a fact.
        // 「いまの営業時間は10:00〜19:00、定休日は月曜です」 was true of the ONE pair
        // the plane used to hold; with seven independent days it goes stale the
        // moment a manager closes Thursday, and a stale sentence beside a live
        // control is the dead-lever defect with words. As a preview it is
        // rewritten from the seven switches on every press.
        preview: {
          template: WEEKDAYS.map(([n, name]) => `${name}曜{store-hours.day-${n}}`).join('・')
            + '。ボードの1日と、Reserveの受付枠は、この範囲を描きます。',
        },
        links: [{ label: '変更の記録を見る', sectionId: 'audit-log' }],
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -2))}（${closedName}を定休日に設定）`,
      }),
      block('store-hours.ops', '予約ボードの操作', '「今日の運営」のボードで、予約や予定ブロックを動かすときの刻みと、空きの守り方です。', [
        // ⚖ S17 — ONE RULE ONE HOME. スキマガード（強さ）・予約の移動単位・販売
        // 可能な最小の長さ・確保枠の会員ランク開放 all had a second control here
        // and their real home is 予約と確保, where #812's dials write the same
        // plane values. The four are GONE from this block and this one row
        // stands in their place — a sentence that says where the rules are
        // decided, and a control that really opens that section (⚖ label truth:
        // 「決めます」+「開く」, never 「ここで変更」).
        row(
          'store-hours.row-guard-moved',
          '予約の刻み・スキマガードの強さ・すき間の販売・確保枠の会員ランク開放・上書きの権限は「予約と確保」で決めます',
          '',
          [],
          { link: { label: '予約と確保を開く', sectionId: 'booking-guard' } },
        ),
        row('store-hours.row-block-step', '予定ブロックの移動単位', '休憩・準備・記録・レジ・清掃を動かすときの刻みです。', [
          seg('store-hours.block-step', '予定ブロックの移動単位', minuteOpts([5, 10, 15, 30], opsConfig.blockStepMin), String(opsConfig.blockStepMin)),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 5分',
            guardrail: '既にある予定ブロックは、いまの位置のまま刻みだけが変わります。近い刻みへ勝手に丸めることはしません。',
          },
        }),
        // ⚖ S17 · F8 — ONE DIAL, TWO CONSEQUENCES, AND BOTH ARE SAID.
        // This list is also 予約と確保's SAVE GATE: `store-policy-props.ts:265`
        // reads `opsConfig.releaseHeldRoles` as `managerRoles` and hands it to
        // `saveRefusal` (`store-policy-seam.ts:136-137`), which is the sentence
        // 「保存できるのは…です」 that section prints
        // (`StorePolicySection.tsx:792`). Narrowing this row to オーナー would
        // therefore take a 店舗管理者's own save right away, from a row that used
        // to talk only about held slots. The description names both; the chip
        // for the reader's OWN 役職 refuses the remove direction.
        row('store-hours.row-release', '確保枠を早めに売りに戻せる役職', '新規のお客様のために確保した枠を、まだ埋まらないうちに通常の販売へ戻せる人で、「予約と確保」の設定を保存できる人でもあります。', [
          chips(
            'store-hours.release',
            '確保枠を売りに戻せる役職',
            roleOptions(),
            [...p.releaseHeldRoles],
            undefined,
            undefined,
            // …and only when the reader's own 役職 is a choice this row offers —
            // a guard naming a chip that is not on screen is a promise about
            // nothing.
            roleOptions().some((o) => o.value === operator.role)
              ? { value: operator.role, reason: '自分の役職は外せません。外すと、この人が「予約と確保」を保存できなくなります' }
              : undefined,
          ),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: オーナー・店舗管理者',
            guardrail: '誰も戻せない状態にはできません。埋まらない確保枠が、最後まで空いたまま残ってしまうためです。',
          },
          // ⚖ S17 · F10 — TWO ROLE VOCABULARIES STAND IN THIS ROOM, AND THIS
          // ROW SAYS WHICH ONE IT IS SPEAKING.
          //   · 権限表 (スタッフ管理) = Karute's SIX permission presets
          //     (`permissions.ts:51-58`), the templates a person's capabilities
          //     are seeded from.
          //   · `roleOptions()` = the BOARD's three staff roles
          //     (オーナー・店舗管理者・スタッフ), which is what 今日の運営
          //     compares against `staff.role` and what 予約と確保's
          //     「保存できるのは…です」 echoes.
          // They are two different facts TODAY, and unifying them is a PLANE
          // question (a rulebook role vs the board's role string) that belongs
          // to the reconnect era, not to this room's layout round — it is filed
          // in QUEUE-FROM-S17-SETTINGS-2026-09-05.md. What this round owes the
          // reader is the honest line, so 主任 missing from these chips reads as
          // 「a different list」 rather than as a bug.
          source: 'ここで選ぶのは、今日の運営がスタッフに付けている役職名です（権限表のひな形とは別の一覧です）',
        }),
        row('store-hours.row-breaks', '休憩の有給扱い', '人件費の概算で、休憩の時間ぶんも払うものとして計算するかどうかです。', [
          sw('store-hours.breaks-paid', '休憩の有給扱い', '有給（休憩も含めて計算）', '無給（休憩を除いて計算）', false),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 無給',
            guardrail: `金額を動かす設定のため、人件費を見られる役職（${shiftsPolicy.laborCostRoles.join('・')}）だけが変えられます。`,
            businessType: '業種による初期値: サロンは無給、固定シフトのお店は有給が多いです。',
          },
        }),
      ], {
        // ⚖ S17 — the sentence describes ONLY the dials this block still holds. A
        // preview naming a control that moved would be a dead lever with words.
        preview: {
          template: '予定ブロックは{store-hours.block-step}きざみで動きます。確保枠を早めに売りに戻せるのは{store-hours.release}で、休憩は{store-hours.breaks-paid}です。',
        },
        links: [{ label: 'お客様が選べる開始時刻はReserve受付で', sectionId: 'reserve-acceptance' }],
      }),
      // ⚖ S17 · C2 — 臨時休業 IS AN ADD/REMOVE LIST, and 特別営業 IS GONE.
      // The wire is `listClosedDays` / `addClosedDay` / `removeClosedDay`
      // (dist/store-policies.d.ts:20-27) over `StoreClosedDay { date, reason }`
      // (dist/types.d.ts:1081-1089), with a 409 on a date that is already
      // closed. The first cut offered a per-date segment of 臨時休業 / 特別営業 /
      // 通常営業, which could neither add nor remove a day and offered 特別営業 —
      // a value core has no field for at all (registry ⑨ `special_open_days`;
      // named in the report and in the Anthony column list, never on screen).
      block('store-hours.closures', '臨時休業', '通常の営業時間を休みにする、その日限りの予定です。', [], {
        collection: {
          // ⚖ F9 — ONE FORMATTER, and the id is what it reads. A seeded row and
          // an added row used to be titled by two different code paths, so the
          // list changed calendars the moment 追加 was pressed.
          items: d.closures.map((c) => {
            const date = isoDay(dayFrom(ctx.now, c.dayOffset))
            return { id: date, title: dayTitle(date), note: c.note }
          }),
          dateControlId: 'store-hours.closure-date',
          reasonControlId: 'store-hours.closure-reason',
          addLabel: '追加',
          removeLabel: '取り消す',
          emptyLine: '臨時休業の予定はありません。',
          // The wire's own 409, spoken at the press instead of after it.
          duplicateError: 'その日はすでに臨時休業です',
          emptyDateError: '日付を選んでください。',
        },
        facts: ['臨時休業にすると、その日にすでに入っている予約へ店舗都合の連絡が必要になります。'],
        audit: d.closures.length === 0 ? null : `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -1))}（臨時休業を追加）`,
      }),
    ],
    aside: {
      title: 'この値の出どころ',
      lines: [
        { label: 'スキマガード', value: '今日の運営が実際に使っている値' },
        { label: '移動単位', value: '今日の運営のドラッグが実際に使っている値' },
        // ⚖ S17 — 上書きできる人 went with the スキマガード row it explained: who
        // may override is 予約と確保 § 上書きの権限 now, and a read-only line here
        // would be a second place to look it up.
        { label: '新規のための確保', value: `${minutesLabel(p.newClientSessionMinutes)}（予約と確保で変更）` },
        { label: '休憩の有給扱い', value: '人件費の計算はいま休憩を除いています' },
      ],
      note: 'この画面の値は、それぞれの機能が実際に使っている値です。ここで変えた内容は、この画面の中だけに反映されます。',
    },
    persist: null,
  }
}

/** ⚖ C7 — one place turns a role KEY into the word a reader sees, and it is the
 *  rulebook's own label. A second table would let 主任 read as 主任 on one page
 *  and as senior on another. */
const roleLabelOf = (key: string): string => rulebook.roles.find((r) => r.key === key)?.label ?? key

const roleOptions = (): ControlOption[] => opts([['オーナー', 'オーナー'], ['店舗管理者', '店舗管理者'], ['スタッフ', 'スタッフ']])

/** ⚖ S17 · C4 — 0…23 as 「0時」…「23時」, the VALUES being the integers
 *  `SyncConfig.business_hours_start` / `_end` hold. The label carries its unit
 *  (⚖ numbers explain themselves) and the value carries nothing but the number
 *  the wire keeps. */
const hourOptions = (): ControlOption[] =>
  Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h}時` }))

/** ⚠ A RECEIPT IS ALWAYS IN THE PAST (⚖ S17 fix round 4 · B1). `dayFrom` ADDS
 *  days, and eleven 「最終変更」 lines were written with POSITIVE offsets — so a
 *  page whose own dateline read 9月6日 printed 「最終変更 ・ 9月22日(火)」 sixteen
 *  days into its future, on nine of the eleven. Sample data is product truth
 *  (⚖ 8/9): a demo that states an impossible fact teaches the reader to stop
 *  believing the honest ones beside it.
 *
 *  The offsets a RECEIPT takes are ≤ 0, always. A FUTURE offset is still right
 *  where the thing being dated has not happened yet — the store's own upcoming
 *  臨時休業 dates take `c.dayOffset` — so the rule is about what the date is
 *  ABOUT, not about the helper: 「最終変更」 looks backwards, a closure looks
 *  forwards, and the suite reads every audit line back out of the props and
 *  compares it against the page's own dateline. */
function dayFrom(now: Date, offset: number): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + offset)
  return d
}

/** ⚖ C2 — `YYYY-MM-DD`, which is `StoreClosedDay.date`'s own spelling and the
 *  identity a duplicate is refused on. Formatted in JST like every other date
 *  this file prints, so a store closed on the 10th is the 10th in Tokyo and not
 *  the 9th somewhere else. */
const fmtIso = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...JST })
function isoDay(d: Date): string {
  return fmtIso.format(d)
}

// ── 提供内容 ────────────────────────────────────────────────────────────────

function services(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const own = menus.filter((m) => m.store_id === ctx.storeId || m.store_id === null)
  const priceOf = new Map(own.map((m) => [m.id, m.price]))
  return {
    ...base,
    kicker: '店舗運営',
    title: '提供内容',
    lead: 'お店が提供するメニューと、回数券の整合の確認です。金額そのものは料金・ポイントで設定します。',
    blocks: [
      block('services.menus', 'カテゴリーとメニュー', 'Reserveの予約ページに出すメニューです。オフにすると、お客様の予約ページからは選べなくなります（過去の記録には影響しません）。', own.map((m) =>
        row(`services.row-${m.id}`, m.name, '', [
          sw(`services.visible-${m.id}`, `${m.name}をReserveに表示`, '表示', '非表示', d.menuVisible[m.id] ?? true),
        ], {
          meta: [minutesLabel(m.duration_minutes), yen(m.price), m.store_id === null ? '全店舗' : STORE_SCOPE],
        })), {
        facts: ['メニューの追加はこれから用意します。いまある内容の表示・非表示はここで切り替えられます。'],
        links: [{ label: '金額の設定は料金・ポイントで', sectionId: 'pricing-points' }],
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, 0))}（メニューの表示を変更）`,
      }),
      block('services.tickets', '回数券の整合', '回数券の単価が、いまの最低価格を上回っていないかの確認です。上回っていると、回数券より空き時間帯の直接予約のほうがお得になってしまいます。', d.tickets.map((t, i) =>
        row(`services.row-ticket-${i}`, t.name, '', [
          num(`services.ticket-${i}`, `${t.name}の単価`, t.unitPrice, 500, 100000, 100, '円'),
        ], {
          meta: [`対象メニューの最低価格 ${yen(floorPriceOf(priceOf.get(t.menuId) ?? 0))}`, t.unitPrice > floorPriceOf(priceOf.get(t.menuId) ?? 0) ? '要確認' : '問題なし'],
        })), {
        facts: d.tickets.length === 0 ? ['この店舗では回数券を使っていません。'] : [],
        preview: d.tickets.length === 0 ? null : { template: 'いまの単価は{services.ticket-0}です。最低価格を上回ると、この行の右に「要確認」が出ます。' },
      }),
      block('services.new-client', '新規のお客様の所要時間', '問診を含めた予約枠の長さです。この長さが、スキマガードが守る新規枠の長さになります。', [
        // ⚖ S17 — ONE RULE ONE HOME. The 60/75/90/120 select here could name 120,
        // which `SetStoreBookingPolicyInput.new_client_session_minutes` (60 | 75 |
        // 90) cannot save — a control that offers a value the store cannot keep.
        // 予約と確保's three chips ARE that enum, so the length is decided there.
        row(
          'services.row-new-client-moved',
          '新規のお客様の確保の長さは「予約と確保」で決めます（60分・75分・90分）',
          '',
          [],
          { link: { label: '予約と確保を開く', sectionId: 'booking-guard' } },
        ),
      ], {
        links: [{ label: 'Reserveでの見え方はReserve受付で', sectionId: 'reserve-acceptance' }],
      }),
    ],
    aside: {
      title: 'この値の出どころ',
      lines: [
        { label: 'メニューと所要時間', value: '予約作成とレジが使っているメニュー一覧' },
        { label: '定価', value: '料金・ポイントの価格表' },
        { label: '新規の確保時間', value: '今日の運営のスキマガードが実際に使っている値（変更は予約と確保で）' },
      ],
      note: '回数券の「最低価格」は、定価から割引の上限（−30%）を引いた金額です。',
    },
    persist: null,
  }
}

/** 割引の上限は定価の−30%（canon-logic/pricing.ts の CURVE_MAX_DIP と同じ床）。 */
const floorPriceOf = (listPrice: number) => Math.round((listPrice * 0.7) / 10) * 10

// ── 人・設備 ────────────────────────────────────────────────────────────────

function peopleEquipment(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const nameOf = new Map(staff.map((s) => [s.id, s.full_name]))
  const roster = Object.keys(d.staffActive)
  const beds = resources.filter((r) => r.store_id === ctx.storeId)
  return {
    ...base,
    kicker: '店舗運営',
    title: '人・設備',
    lead: '誰が働いているか、どれだけの設備があるかの設定です。予約枠の空きは、この2つとスタッフのシフトから計算されます。',
    blocks: [
      block('people.staff', 'スタッフ', 'この店舗で働く人の稼働状態です。役職と権限はスタッフ管理で扱います。', roster.map((id) =>
        row(`people.row-${id}`, nameOf.get(id) ?? id, '', [
          sw(`people.active-${id}`, `${nameOf.get(id) ?? id}を稼働にする`, '稼働', '休止', d.staffActive[id]),
        ], {
          meta: [roleLabelOf(d.staffSettings[id]?.preset ?? 'practitioner')],
        })), {
        facts: ['休止にすると、その人の予約枠はボードにもReserveにも出なくなります。すでに入っている予約は残ります。'],
        links: [{ label: '役職と権限はスタッフ管理で', sectionId: 'staff' }],
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -3))}（稼働状態を変更）`,
      }),
      block('people.equipment', '設備・枠', `この数は、ボードの空き枠計算に使われます（設備の台数 × 営業時間）。`, beds.map((r) =>
        row(`people.row-${r.id}`, r.name, r.note, [
          seg(`people.class-${r.id}`, `${r.name}の種類`, opts([['standard', '施術室'], ['private', '個室・VIP']]), r.room_class),
          num(`people.cleanup-${r.id}`, `${r.name}の清掃時間`, r.cleanup_minutes, 0, 60, 5, '分'),
        ])), {
        facts: [
          `いまこの店舗には設備が${people(beds.length)}あります。`,
          '清掃時間を0分にすると、予約と予約のあいだに何も確保しません。',
        ],
      }),
      block('people.room-policy', '部屋の自動割り当て', '予約に部屋を自動で決めるときの決まりです。人は選ばれるもの、部屋は解かれるもの — この2つの判断だけで決まります。', [
        row('people.row-vip', '個室の予約は個室から出さない', '個室・VIPの予約は、個室が埋まっていればその予約にとって満室として扱います。', [
          sw('people.vip-stays', '個室の予約は個室から出さない', '出さない', '空きがあれば施術室へ', opsConfig.roomPolicy.vipStaysPrivate),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 出さない',
            guardrail: 'オフにすると、個室でお迎えするはずのお客様が施術室に入ることがあります。',
          },
        }),
        row('people.row-last-resort', '個室は最後の手段', '通常の予約が個室を取れるのは、施術室に空きがないときだけにします。', [
          sw('people.private-last', '個室は最後の手段', '施術室が満室のときだけ', 'いつでも使える', opsConfig.roomPolicy.privateIsLastResort),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 施術室が満室のときだけ',
            guardrail: 'オフにすると、個室が早い時間で埋まり、あとから来る個室のご予約を受けられなくなります。',
          },
        }),
      ], {
        preview: { template: '個室の予約は{people.vip-stays}、通常の予約にとって個室は{people.private-last}という決まりで割り当てます。' },
      }),
      block('people.shifts', 'シフト', '誰がいつ働くかは、別の画面で管理します。', [], {
        facts: ['シフトの管理は「スタッフ・シフト」で行います。ここには同じ機能を重ねていません。'],
      }),
    ],
    aside: {
      title: 'この値の出どころ',
      lines: [
        { label: '名簿', value: 'スタッフ・シフトが使っている名簿' },
        { label: '設備', value: '今日の運営のベッド割り当てが使っている一覧' },
        { label: '部屋の決まり', value: '今日の運営の自動割り当てが実際に読んでいる値' },
      ],
      note: '稼働・設備の数を変えると、Reserveの空き枠は翌日の再計算から変わります。',
    },
    persist: null,
  }
}

// ── 決済 ────────────────────────────────────────────────────────────────────

function payments(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  return {
    ...base,
    kicker: 'レジ',
    title: '決済',
    lead: 'レジで受け取れる支払い方法と、締めのときの現金の扱いです。ポイント制の有効・無効は料金・ポイントで設定します。',
    blocks: [
      block('payments.methods', 'レジで使える支払い方法', 'スタッフのレジ画面に表示される支払い方法です。オフにした方法はその場では選べなくなります（過去の記録には影響しません）。', [
        row('payments.row-cash', '現金', '店頭での現金でのお支払いです。', [
          sw('payments.cash', '現金でのお支払いを受け付ける', '受け付ける', '受け付けない', d.payCash),
        ], { scopeLabel: STORE_SCOPE }),
        row('payments.row-card', 'カード', 'クレジット・デビットカード（レジ据置端末）です。', [
          sw('payments.card', 'カードでのお支払いを受け付ける', '受け付ける', '受け付けない', d.payCard),
        ], { scopeLabel: STORE_SCOPE }),
        row('payments.row-qr', 'QRコード決済', 'スマートフォンで読み取るお支払いです。', [
          sw('payments.qr', 'QRコード決済を受け付ける', '受け付ける', '受け付けない', d.payQr),
        ], { scopeLabel: STORE_SCOPE }),
      ], {
        preview: { template: 'いまレジで選べるのは、現金は{payments.cash}、カードは{payments.card}、QRコード決済は{payments.qr}です。' },
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -4))}（カード決済をオンに）`,
      }),
      block('payments.tolerance', '現金の締め', 'レジを締めるとき、どこまでの差異を理由なしで通してよいかの設定です。', [
        row('payments.row-tolerance', '現金差異の承認しきい値', 'この金額までの差異は理由なしで通せます。これを超えると、店舗管理者の承認が必要になります。', [
          num('payments.tolerance', '現金差異の承認しきい値', cashTolerance, 0, MAX_CASH_TOLERANCE, 100, '円'),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: ¥0',
            guardrail: `上限は${yen(MAX_CASH_TOLERANCE)}です。これ以上にすると、取引まるごとの抜けが差異として通ってしまいます。`,
            businessType: '業種による初期値: 施術のお店は¥0、少額の現金売りが多いお店は数百円が目安です。',
          },
        }),
      ], {
        preview: { template: 'いまの設定では、{payments.tolerance}までの差異は理由なしで締められます。' },
        links: [{ label: 'ポイント制の設定は料金・ポイントで', sectionId: 'pricing-points' }],
      }),
      block('payments.online', 'オンライン決済', 'Web予約のときの事前のお支払いです。', [], {
        flag: '準備中',
        facts: [
          'この店舗はまだオンライン決済につながっていません。つなぐと、Web予約の事前のお支払いとキャンセル料の自動精算ができるようになります。',
          'つなぐには決済代行会社との契約（法人単位）が必要です。対応が始まり次第、この画面からご案内します。',
        ],
      }),
    ],
    aside: {
      title: 'この値の出どころ',
      lines: [
        { label: '現在のしきい値', value: yen(cashTolerance) },
        { label: '読んでいる画面', value: '売上・レジの締め' },
        { label: '上限', value: `${yen(MAX_CASH_TOLERANCE)}（これ以上は設定できません）` },
        { label: 'ポイント制', value: d.pointsEnabled ? '有効中（料金・ポイントで管理）' : '停止中（料金・ポイントで管理）' },
      ],
      note: '支払い方法を変えても、すでに済んだ会計の記録は変わりません。',
    },
    persist: null,
  }
}

// ── 顧客・連絡 ──────────────────────────────────────────────────────────────

function customerContact(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const winBack = clampWinBackDays(d.winBackDays)
  return {
    ...base,
    kicker: '再来促し',
    title: '顧客・連絡',
    lead: 'しばらくご来店のないお客様に、カルテがお声がけの案を出すまでの日数です。',
    blocks: [
      block('contact.winback', '再来促し', '最後のご来店からこの日数が経つと、カルテにお声がけの案が出るようになります。', [
        row('contact.row-winback', '再来促しの日数', '短すぎるとまだ来る時期でない方に届き、長すぎると引っ越された方に届きます。', [
          num('contact.winback', '再来促しの日数', winBack, WIN_BACK_MIN, WIN_BACK_MAX, 1, '日'),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 61日',
            guardrail: `${days(WIN_BACK_MIN)}より短くも、${days(WIN_BACK_MAX)}より長くも設定できません。`,
            businessType: '業種による初期値: 来店の間隔は業種で大きく違うため、業種ごとの初期値を持ちます。',
          },
        }),
      ], {
        preview: { template: '最後のご来店から{contact.winback}が経つと、カルテにお声がけの案が出ます。' },
        facts: ['同じ数字がカルテとBusinessの両方に出るため、値はひとつの置き場所にだけ持ちます。'],
      }),
      block('contact.channels', 'お客様への連絡', 'どの連絡手段を使ってよいかは、お客様おひとりずつの同意で決まります。', [], {
        facts: [
          'お客様ごとの同意状況は、顧客の画面の「同意・連絡」で確認できます。',
          '同意のない手段では、この画面の設定に関わらず連絡しません。',
        ],
        links: [{ label: '予約・キャンセルのお知らせは通知で', sectionId: 'notifications' }],
      }),
    ],
    aside: {
      title: 'この値の出どころ',
      lines: [
        { label: 'この店舗の日数', value: days(winBack) },
        { label: '同じ値を使う画面', value: 'カルテ（スマホ）のお声がけの案' },
        { label: '値の置き場所', value: 'ひとつだけ（二か所には持ちません）' },
      ],
      note: '同じ数字がカルテとBusinessの両方に出るため、値はひとつの置き場所にだけ持ちます。',
    },
    persist: null,
  }
}

// ── 料金・ポイント ──────────────────────────────────────────────────────────

function pricingPoints(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const own = menus.filter((m) => m.store_id === ctx.storeId || m.store_id === null)
  const target = ctx.storeId !== null ? (salesTargets[ctx.storeId] ?? 0) : 0
  return {
    ...base,
    kicker: '料金',
    title: '料金・ポイント',
    lead: 'メニューごとの最低・最高価格と、前払ポイント制の設定です。時間帯ごとの実際の価格は、予約の実績から毎晩自動で計算されます。',
    blocks: [
      block('pricing.dynamic', '動的価格', '空いている時間を安く、人気の時間を定価で売る仕組みです。公開価格はどの窓口でも同じです。', [
        row('pricing.row-dyn', '動的価格を使う', 'オフにすると、すべての時間帯が定価で公開されます。', [
          sw('pricing.dyn', '動的価格を使う', '使う', '使わない', d.dynamicPricing),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 使わない',
            guardrail: '割引の深さには上限があり、定価の−30%より下がらないところで止まります。',
          },
        }),
        row('pricing.row-framing', '価格の見せ方', '実際の価格は同じです。定価からの割引として見せるか、基準への加算として見せるかだけが変わります。', [
          sel('pricing.framing', '価格の見せ方', opts([['discount', '割引型（定価から引く）'], ['markup', '加算型（基準に足す）']]), d.priceFraming),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 割引型',
            guardrail: '基準価格での取引が少なくなると、法令への配慮のため自動的に通常価格の表示へ切り替わります。切り替わるときはお知らせします。',
          },
        }),
      ], {
        preview: { template: '動的価格は{pricing.dyn}、価格の見せ方は{pricing.framing}です。動的価格がオンのあいだは、予約ページで価格を隠せません。' },
        facts: ['動的価格をオンにしているあいだ、予約ページの価格表示は隠せません（法とお客様への誠実さのためです）。'],
        links: [{ label: '再計算中に価格を隠す設定はReserve受付で', sectionId: 'reserve-acceptance' }],
      }),
      block('pricing.bands', 'メニューごとの価格', '最低価格は割引の下限、最高価格は定価です。時間帯ごとの価格はこの間で自動で決まります。', own.map((m) =>
        row(`pricing.row-${m.id}`, m.name, '', [
          num(`pricing.lo-${m.id}`, `${m.name}の最低価格`, floorPriceOf(m.price), Math.round(m.price * 0.5), m.price, 10, '円'),
          num(`pricing.hi-${m.id}`, `${m.name}の最高価格`, m.price, Math.round(m.price * 0.5), Math.round(m.price * 1.2), 10, '円'),
        ], {
          meta: [`安全範囲 ${yen(floorPriceOf(m.price))}〜${yen(Math.round(m.price * 1.1))}`],
        })), {
        facts: ['最低価格を定価の−30%より下げることはできません。改装やスタッフの入れ替えのあとは、実績からの学び直しをお願いできます。'],
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, 0))}（最低価格を変更）`,
      }),
      block('pricing.points', 'ポイント制（前払）', 'お客様が金額をチャージし（1pt＝1円）、どの時間帯にも公開価格で使えます。空いている時間帯を選ぶほど回数が増えます。', [
        row('pricing.row-points', 'ポイント制を使う', '有効にすると新しい回数券の販売は止まります。すでにお持ちの回数券は引き続き使えます。', [
          sw('pricing.points', 'ポイント制を使う', '使う', '使わない', d.pointsEnabled),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 使わない',
            guardrail: 'やめても、購入済みの残高はそのまま使えます。お客様のお金は消えません。払戻しは法令の例外の範囲だけです。',
          },
        }),
        ...d.walletPacks.map((p, i) =>
          row(`pricing.row-pack-${i}`, `販売パック ${yen(p.price)}`, p.points > p.price ? `おまけ +${(p.points - p.price).toLocaleString('ja-JP')}pt` : '等価パック（1pt＝1円）', [
            num(`pricing.pack-price-${i}`, `${yen(p.price)}パックの販売価格`, p.price, 1000, 500000, 1000, '円'),
            num(`pricing.pack-points-${i}`, `${yen(p.price)}パックの付与ポイント`, p.points, 1000, 600000, 100, 'pt'),
          ])),
      ], {
        facts: [
          'パックの購入はWebのお支払いのみです。パックを削除しても、購入済みの残高はそのまま使えます。',
          '残高は譲渡できず、この事業の中でのみ使えます。',
        ],
        preview: { template: 'ポイント制は{pricing.points}です。いちばん小さいパックは{pricing.pack-price-0}で、付与は{pricing.pack-points-0}です。' },
      }),
      block('pricing.watch', '状態・見守り', '自動計算と法令ラインの現在地です。ここは表示だけで、操作はありません。', [
        row('pricing.row-target', '月間売上目標', 'この店舗の今月の目標です。売上分析の進捗はこの数字に対して出ます。', [
          num('pricing.target', '月間売上目標', target, 0, 100000000, 100000, '円'),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 店舗ごとに設定',
            guardrail: '0にすると、売上分析の進捗は「目標なし」と表示されます。届かない目標は、スタッフの励みになりません。',
          },
        }),
      ], {
        facts: [
          '公開価格の再計算は、Reserveが予約の実績から毎晩行います。日中に価格が動くことはありません。',
          '未使用ポイントの残高が基準日に事業全体で1,000万円を超えると、財務局への届出と残高の半額以上の供託が必要になります。近づくとここでお知らせします。',
        ],
        preview: { template: '今月の目標は{pricing.target}です。売上分析の進捗はこの数字に対して出ます。' },
      }),
    ],
    aside: {
      title: 'この値の出どころ',
      lines: [
        { label: '定価', value: '予約作成とレジが使っているメニューの金額' },
        { label: '安全範囲', value: '定価から割引の上限（−30%）まで' },
        { label: '月間売上目標', value: yen(target) },
        { label: '割引の深さ', value: '料金表から計算しています（設定値ではありません）' },
      ],
      note: 'ボードの「販売可能枠の表示」は見る人ごとの表示設定で、お店の設定ではありません。',
    },
    persist: null,
  }
}

// ── AI設定 ──────────────────────────────────────────────────────────────────

function aiSettings(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  const profileLabel = businessProfiles.find((p) => p.value === d.businessProfile)?.label ?? d.businessProfile
  return {
    ...base,
    kicker: 'Karute設定',
    title: 'AI設定',
    lead: 'カルテのAIが何をどう書くかの設定です。カルテとAI相談が同じ設定を読みます。',
    blocks: [
      block('ai.summary', '要約スタイル', 'カルテのAI要約の分量と言い回しです。内容そのものは変わりません。', [
        row('ai.row-length', '要約の長さ', 'カルテの記録に表示されるAI要約の分量です。', [
          seg('ai.length', '要約の長さ', opts([['short', '短め'], ['standard', '標準'], ['detailed', '詳しめ']]), d.aiSummaryLength),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 標準',
            guardrail: '短めにしても、記録の元になった内容は消えません。表示の長さだけが変わります。',
          },
        }),
        // ⚖ S17 · C4 — KARUTE-OWNED, so Karute's own NAME and Karute's own three
        // LABELS. The key is `ai_voice_style` (`src/actions/org-settings.ts:22`,
        // `'formal' | 'polite' | 'friendly'`); Karute's screen calls it ボイス
        // スタイル with the labels フォーマル / 丁寧 / フレンドリー
        // (`messages/ja.json:2535-2538`, read through
        // `src/components/settings/redesign/sections/AISection.tsx:22-26`), and
        // its description is 「AIがメッセージを書くときの口調。」
        // (`messages/ja.json:2539`). The first cut called it 要約のトーン and
        // offered two of the three, so フォーマル was a setting the product has
        // and this page could not reach — and two names for one dial is the
        // reader having to guess which one the product believes.
        row('ai.row-voice-style', 'ボイススタイル', 'AIがメッセージを書くときの口調です。', [
          seg('ai.voice-style', 'ボイススタイル', opts([['formal', 'フォーマル'], ['polite', '丁寧'], ['friendly', 'フレンドリー']]), d.aiVoiceStyle),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 丁寧',
            guardrail: '口調を変えても、記録の中身は変わりません。すでに保存された文章もそのままです。',
          },
          source: 'カルテのAI設定と同じ値です（カルテ側の画面ではまだ「近日公開」で、値だけが先にあります）',
        }),
        row('ai.row-language', 'AIの応答言語', 'AI要約とAI相談の文章に使う言語です。', [
          sel('ai.language', 'AIの応答言語', opts([['ja', '日本語'], ['en', 'English']]), d.aiLanguage),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 日本語',
            guardrail: '対応していない言語を選んでも、日本語のまま表示します。空白の画面にはしません。',
          },
        }),
      ], {
        preview: { template: 'いまの設定では、要約は{ai.length}・{ai.voice-style}で、{ai.language}で書かれます。' },
      }),
      block('ai.outcomes', '施術結果の選択肢', 'カルテの「施術結果」の欄で選べる言葉です。カルテの一覧と記録が同じ言葉を読みます。', d.aiOutcomes.map((term, i) =>
        row(`ai.row-outcome-${i}`, `選択肢 ${i + 1}`, '', [
          txt(`ai.outcome-${i}`, `施術結果の選択肢 ${i + 1}`, term, { required: true, maxLength: 12 }),
        ])), {
        facts: ['空欄のまま保存はできません。選択肢は最低ひとつ必要です。'],
      }),
      block('ai.advice', 'AI相談', '提案の積極度と、出す提案の種類です。', [
        row('ai.row-agg', '提案の積極度', '積極的にするほど、確度の低い提案も出るようになります。', [
          seg('ai.aggressiveness', '提案の積極度', opts([['light', '控えめ'], ['standard', '標準'], ['active', '積極的']]), d.aiAggressiveness),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 標準',
            guardrail: '積極的にすると提案の数が増え、確かさは下がります。判断はいつもスタッフのものです。',
          },
        }),
        row('ai.row-cats', '出す提案の種類', 'どの種類の提案を表示するかです。', [
          chips('ai.categories', '出す提案の種類', opts([
            ['followup', '顧客フォロー'], ['staffing', 'スタッフ配置・欠勤対応'], ['waitlist', '予約・空き待ち案内'], ['vip', 'VIP・ロイヤルティ'],
          ]), Object.entries(d.aiCategories).filter(([, on]) => on).map(([k]) => k)),
        ], { scopeLabel: STORE_SCOPE }),
      ], {
        preview: { template: '積極度は{ai.aggressiveness}、出す提案の種類は{ai.categories}です。' },
      }),
      // ⚖ S17 · C4 — the 26 are KARUTE'S, verbatim (`businessProfiles` carries
      // the cite and `settings.test.ts` reads Karute's file off disk to prove
      // they still match). The scope chip follows the column the STORE dialog
      // writes — core's `stores.business_type` — and the 出どころ line names the
      // other home rather than leaving the reader to find out that changing it
      // in one place does not change it in the other.
      block('ai.profile', '業種プロファイル', '予約とカルテの言葉づかいや画面の構成の土台になります。', [
        row('ai.row-profile', '現在のプロファイル', '26の業種のうち、いまこの店舗に選ばれているものです。', [
          sel('ai.profile', '業種プロファイル', businessProfiles.map((p) => ({ value: p.value, label: p.label })), d.businessProfile, 'プロファイルの変更はサポートが承ります（この画面からは変えられません）。'),
        ], {
          scopeLabel: STORE_SCOPE,
          source: 'カルテと同じ26業種の一覧です。店舗ごとの業種と、事業を始めるときに選んだ業種は別に持たれていて、片方を変えても、もう片方は変わりません',
        }),
      ], {
        facts: [`いまのプロファイルは「${profileLabel}」です。`],
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '読んでいる画面', value: 'カルテの記録・カルテ一覧・AI相談' },
        { label: '業種プロファイル', value: profileLabel },
        { label: 'プロファイルの変更', value: 'サポートが承ります' },
      ],
      note: '要約の書き方を変えても、すでに保存された記録の文面は変わりません。次の記録から新しい書き方になります。',
    },
    persist: null,
  }
}

// ── 録音設定 ────────────────────────────────────────────────────────────────

function recording(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  // ⚠ canon's own per-block gate: the PAGE is open to everyone, and the ORG
  // block is the part that needs the right. That is a SECOND, finer proof that
  // the gate here is not page-wide — a reader without 設定の変更 still gets this
  // page, their own voice registration, and the policy they are working under.
  const mayEdit = ctx.access.has('settings.manage')
  const rightsNote = mayEdit ? undefined : '権限がありません — この設定を変更するには、設定を変更できる権限が必要です。いまの内容は読めます。'
  const locked = mayEdit ? undefined : '設定を変更できる権限が必要です。'
  return {
    ...base,
    kicker: 'Karute設定',
    title: '録音設定',
    lead: '録音に関するお店の決まりと、自分の音声登録です。このページは誰でも開けます — 変えられる範囲は、それぞれのまとまりの権限で決まります。',
    blocks: [
      block('recording.org', '組織の録音設定', '録音を始めてよい条件です。', [
        row('recording.row-consent', '同意が必要', 'オンのあいだは、お客様の同意が確認できるまで録音を始められません。', [
          sw('recording.consent', '録音前に同意確認を必須にする', '必要', '不要', d.recordingConsentRequired, locked),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 必要',
            guardrail: '不要にしても、お客様が断ったことの記録は残ります。同意のないお客様の録音は、どの設定でも始められません。',
          },
        }),
        // ⚖ S17 · C5 — the dial stands exactly as Liam ruled it on 8/30 (default
        // private), and its 詳しく now tells the truth of TODAY: nothing saves
        // this value yet, and what actually decides who may read a transcript is
        // Karute's `recordings.viewAll` capability, which is owner-only by
        // default (`src/lib/auth/permissions.ts:31-36`). Saying so is the
        // difference between a dial that is ahead of its wire and a dial that
        // lies about what it is doing.
        row('recording.row-transcript', '文字起こしの公開範囲', 'スタッフの録音から起こした文字を、店長・オーナーも読めるようにするかどうかです。', [
          seg('recording.transcript', '文字起こしの公開範囲', opts([['staff-only', 'スタッフのみ'], ['managers-too', '管理者も閲覧可']]), d.transcriptVisibility, locked),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: スタッフのみ（安全な側）',
            guardrail: 'スタッフは録音を始める前に、いまどちらの設定かを必ず見られます。設定を変えたことは記録に残ります。',
          },
          source: 'いまは「録音の全件閲覧」権限（標準ではオーナーだけ）がこの役目を担っています。この設定がコアに保存されるようになると、その決まりに置き換わります',
        }),
      ], {
        flag: '適用範囲: 事業全体',
        ...(rightsNote ? { rightsNote } : {}),
        preview: { template: '録音の前の同意確認は{recording.consent}、文字起こしを読めるのは{recording.transcript}です。' },
        facts: ['誰が読めるかは画面側ではなくデータの側で判定します。画面側で隠すだけでは守れないためです。'],
      }),
      block('recording.retention', '業態別の保持クラス', '保持クラスは録音を作ったときに、お店の業態から決まります。自由な保存日数や一律の自動削除を決める項目ではありません。', [
        row('recording.row-class', 'この店舗の保持クラス', 'いまの業態は「保持義務なし」が既定です。必要な場合は、保持クラスだけを保守的に引き上げられます。', [
          sel('recording.class', 'この店舗の保持クラス', opts([['no-duty', '保持義務なし（既定）'], ['statutory', '法定保持クラスへ引き上げ']]), d.retentionClass, locked),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 保持義務なし',
            guardrail: '引き上げると5年間は消せなくなります。下げることはできません。変更は店舗ごとに記録に残ります。',
          },
        }),
      ], {
        flag: '適用範囲: この店舗',
        table: {
          head: ['業態', '保持クラス'],
          rows: [
            { cells: ['医科クリニック', '法定保持 — 5年間（法定下限・変更不可）'], tags: [] },
            { cells: ['歯科クリニック', '法定保持 — 5年間（法定下限・変更不可）'], tags: [] },
            { cells: ['整骨院', '法定対象 — 5年間（完全自費のみ調整可）'], tags: [] },
          ],
        },
        facts: ['ほかの業態の方針は参考として並べています。この店舗の設定ではありません。'],
      }),
      block('recording.export-policy', '録音の書き出しの決まり', '操作の項目ではなく、Businessで必ず適用される決まりです。', [], {
        list: {
          title: '必ず適用される決まり',
          items: [
            'オーナーまたは店舗管理者だけが、保存済みの録音を1件ずつ書き出せます。',
            '書面の理由の入力が必須で、実行日時・実行者・理由を記録に残します。',
            'まとめての書き出しはできません。',
            'スタッフごとの評価に関わる指標は書き出しの対象外です。',
            '封をした録音と破棄した録音は、どの経路からも読めず、書き出しもできません。',
          ],
        },
      }),
      block('recording.voice', '自分の音声登録', '自分の声を登録すると、録音の文字起こしの精度が上がります。ここは権限に関わらず本人だけが変えられます。', [
        // ⚖ S17 · C4 — the value is a STATE, not a flag: Karute holds
        // `voice_enrollments[staffId].status` as `'saved' | 'revoked'`
        // (`src/actions/org-settings.ts:35-44,76`; written at
        // `src/actions/voice.ts:116` and `:230`). 「取り消し済み」 is not the same
        // fact as 「未登録」 — the consent and its withdrawal are both on the
        // record — so the switch maps ON/OFF onto those two words rather than
        // onto a boolean that throws the difference away. SELF scope, and it is
        // never gated: `gateOf` cannot reach a self-scoped section at all, and
        // this row sits inside a store section on purpose, as the finer proof.
        row('recording.row-voice', '自分の声の登録', '登録した音声は本人だけに使われます。ほかのスタッフの声と混同されることはありません。', [
          sw('recording.voice', '自分の声を登録する', '登録済み', '取り消し済み', d.voiceStatus === 'saved'),
        ], {
          scopeLabel: SELF_SCOPE,
          source: 'カルテの音声登録と同じ値です（登録済み / 取り消し済み）',
        }),
      ], {
        preview: { template: 'いまの状態は「{recording.voice}」です。削除すると、次の録音では文字起こしの精度が下がることがあります。' },
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '初期値', value: 'スタッフのみ（安全な側）' },
        { label: '判定する場所', value: 'データの側（画面側ではありません）' },
        { label: 'このページの権限', value: mayEdit ? '変更できます' : '読むことができます' },
        { label: '自分の音声登録', value: '権限に関わらず本人が変えられます' },
      ],
      note: '設定を変えたことは記録に残ります。録音そのものの削除や封は、この画面では扱いません。',
    },
    persist: null,
  }
}

// ── コーチング ──────────────────────────────────────────────────────────────

function coaching(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const retention = clampCoachingRetention(d.coachingRetentionMonths)
  const floor = clampCoachingFloor(d.coachingSampleFloor)
  return {
    ...base,
    kicker: 'Karute設定',
    title: 'コーチング',
    lead: `接客の振り返りを${ctx.lensLabel}で使うかどうかと、その見せ方の決まりです。`,
    blocks: [
      block('coaching.use', '利用と共有', 'この店舗で振り返りを使うかどうかと、共有してよい範囲です。', [
        // ⚖ C4 — `coaching_enabled` lives in the business's own org-settings blob,
        // so it is a 事業全体 fact wherever the reader is standing.
        row('coaching.row-enabled', 'コーチングの利用', 'オフのあいだは分析が動かず、成績も気づきも出ません。', [
          sw('coaching.enabled', 'コーチングの利用', '使う', '使わない', d.coachingEnabled),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 使わない（お申し込みで使えるようになります）',
            guardrail: 'オフにしても、すでにある記録は消えません。保存期間の設定に従います。',
            businessType: '業種による初期値: 会話の項目名は業種の言葉に合わせて変わります。',
          },
        }),
        row('coaching.row-sharing', '共有の方針', 'スタッフが自分の振り返りを誰に見せられるかの範囲です。許可を出すのは常に本人です。', [
          seg('coaching.sharing', '共有の方針', opts([['manager-grant', '店長への共有まで'], ['peer', 'スタッフ同士も']]), d.coachingSharing),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 店長への共有まで',
            guardrail: 'どちらでも初期は全員オフです。断っても勤務に影響せず、断ったことは誰にも表示されません。会話の引用は許可しても渡りません。',
          },
        }),
      ], {
        preview: { template: 'この事業のコーチングは{coaching.enabled}、共有の範囲は{coaching.sharing}です。' },
        list: {
          title: 'この機能にないもの',
          items: [
            '全メッセージの監視や、音声の常時確認はありません。',
            '本人だけのパネルは、本人だけが見られます。',
            '全スタッフの集計は、売上分析を見られる権限を持つ人だけが見られます。',
          ],
        },
      }),
      block('coaching.records', '記録と判断', 'どれくらい記録を持ち、いつから区分を出してよいかです。', [
        row('coaching.row-retention', '記録の保存期間', '振り返りの記録をどれくらいの期間もっておくかです。', [
          num('coaching.retention', '記録の保存期間', retention, RETENTION_MIN_MONTHS, RETENTION_MAX_MONTHS, 1, 'か月'),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 12か月',
            guardrail: `${months(RETENTION_MIN_MONTHS)}より短くも、${months(RETENTION_MAX_MONTHS)}より長くも設定できません。短すぎると前と比べられず、長すぎると本人が辞めたあとも記録が残ります。`,
          },
        }),
        row('coaching.row-floor', '判断に必要なセッション数', 'この回数に届くまでは、そのスタッフの区分を出しません。「まだ判断できません」と表示します。', [
          num('coaching.floor', '判断に必要なセッション数', floor, COACHING_FLOOR_MIN, COACHING_FLOOR_MAX, 1, '回'),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 20回',
            guardrail: `${times(COACHING_FLOOR_MIN)}より少なくも、${times(COACHING_FLOOR_MAX)}より多くも設定できません。少なすぎるとまぐれが評価になり、多すぎると画面が事実上オフになります。`,
          },
        }),
        row('coaching.row-cadence', '気づきを届ける頻度', '本人だけのパネルに気づきを届ける間隔です。', [
          sel('coaching.cadence', '気づきを届ける頻度', opts([['daily', '毎日'], ['weekly', '毎週'], ['biweekly', '隔週']]), d.coachingCadence),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 毎週',
            guardrail: '頻度を上げるほど、まだ判断できない回数で気づきが出やすくなります。',
          },
        }),
      ], {
        preview: { template: '記録は{coaching.retention}のあいだ持ち、{coaching.floor}に届いてから区分を出します。気づきは{coaching.cadence}届きます。' },
        links: [{ label: '共有の権限はスタッフ管理で', sectionId: 'staff' }],
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: 'この店舗', value: d.coachingEnabled ? '使っています' : '使っていません' },
        { label: '深い共有', value: 'スタッフ本人が許可したときだけ' },
        { label: '会話の引用', value: '許可しても店長には渡りません' },
      ],
      note: '断ったスタッフが誰かは、どの画面にも表示されません。共有は評価のためではなく、支援を配るためのものです。',
    },
    persist: null,
  }
}

// ── 予約同期 ────────────────────────────────────────────────────────────────

function sync(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  return {
    ...base,
    kicker: 'Karute設定',
    title: '予約同期',
    lead: 'Reserveの予約をどう取り込むかの設定です。いまの状態は画面の右上にも出ています。',
    blocks: [
      block('sync.status', '同期の状態', 'Reserveとの予約同期のいまの状態です。', [], {
        facts: [
          `最終同期は${reserveSync.minutes_ago}分前、同期元はReserveです。いまのところ正常です。`,
          '次の自動同期は、下の間隔と稼働時間帯に従って行われます。',
        ],
      }),
      block('sync.settings', '同期の設定', '同期の間隔と、同期を行う時間帯です。', [
        row('sync.row-interval', '同期の間隔', 'Reserveの予約の変更をBusinessに取り込む間隔です。', [
          sel('sync.interval', '同期の間隔', opts([['15', '15分ごと'], ['30', '30分ごと'], ['60', '60分ごと']]), String(d.syncIntervalMin)),
        ], {
          // ⚖ C4 — `SyncConfig` is ONE ROW PER BUSINESS (`business_id`, no
          // `store_id` of its own for the schedule), so the interval is a
          // business-wide fact and the chip has to say so.
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 15分ごと',
            guardrail: '間隔を長くすると、Reserveで入った予約がボードに出るまで時間がかかります。',
          },
        }),
        // ⚖ S17 · C4 — TWO HOUR SELECTS, BECAUSE THE WIRE HOLDS TWO INTEGERS.
        // `SyncConfig.business_hours_start` / `business_hours_end`
        // (@synqed-kk/client@1.34.0 dist/types.d.ts:633-634, and the same two on
        // `UpsertSyncConfigInput` at :653-654) are plain `number` HOURS. The
        // first cut rendered them as two `time` fields, so the room offered
        // 「8:30」 — a value core has no way to keep, which it would silently
        // round or refuse. An hour is what the wire stores, so an hour is what
        // the reader picks (⚖ label truth, and ⚖ mistake-proofing: the control
        // cannot name a value the store cannot save).
        row('sync.row-window', '稼働時間帯', 'この時間帯の外では同期を行いません。時刻は1時間きざみです。', [
          sel('sync.start', '稼働時間帯の開始', hourOptions(), String(d.syncStartHour)),
          sel('sync.end', '稼働時間帯の終了', hourOptions(), String(d.syncEndHour)),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 8時〜22時',
            guardrail: '停止しているあいだの変更は、次に動いたときにまとめて取り込みます。取りこぼしはありません。',
          },
          source: '予約同期の設定は事業ぜんたいでひとつです。店舗ごとには分かれていません',
        }),
        row('sync.row-conflict', '重なったときの優先ルール', 'Reserveと店舗の両方から同じ予約が同時に変更されたときの決まりです。', [
          sel('sync.conflict', '重なったときの優先ルール', opts([
            ['latest', '自動（新しい方を優先）'], ['reserve', 'Reserveの内容を優先'], ['manual', '手動で確認してから反映'],
          ]), d.syncConflict),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 自動（新しい方を優先）',
            guardrail: '手動にすると、確認するまで予約が古いまま残ります。確認が必要な予約は受信トレイに出ます。',
          },
        }),
      ], {
        preview: { template: '同期は{sync.interval}、{sync.start}から{sync.end}のあいだだけ動きます。重なったときは{sync.conflict}です。' },
        links: [{ label: '予約の受付の範囲はReserve受付で', sectionId: 'reserve-acceptance' }],
      }),
    ],
    aside: {
      title: 'いまの状態',
      lines: [
        { label: '最終同期', value: `${reserveSync.minutes_ago}分前` },
        { label: '同期元', value: 'Reserve' },
        { label: '取りこぼし', value: '停止中の変更は次の同期でまとめて取り込みます' },
      ],
      note: '画面右上の「Reserve同期」は、この設定に従って動いた結果を表示しています。',
    },
    persist: null,
  }
}

// ── Reserve 受付 ────────────────────────────────────────────────────────────

function reserveAcceptance(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  return {
    ...base,
    kicker: 'Reserve設定',
    title: 'Reserve 受付',
    lead: 'お客様がオンラインで予約できる範囲と、キャンセルの決まりです。営業時間そのものは店舗情報・営業時間で管理します。',
    blocks: [
      block('reserve.window', '受付ウィンドウ', 'お客様がオンラインで予約できる期間です。', [
        row('reserve.row-days', '何日先まで受け付けるか', 'この日数を超える先の予約は、オンラインでは受け付けません（店頭・電話は対象外です）。', [
          num('reserve.days', '何日先まで受け付けるか', d.bookingOpenDays, 1, 90, 1, '日'),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 30日',
            guardrail: '上限は90日です。長すぎると、先の予定が変わったときのキャンセルが増えます。',
          },
        }),
        // ⚖ S17 · C6 — THE LABEL IS HOURS, THE VALUE IS MINUTES, because
        // `cutoff_minutes` (dist/types.d.ts:1054) is minutes. A reader thinks in
        // 「2時間前」 and the wire keeps 120; holding hours here and multiplying
        // at the seam is where a factor of 60 goes missing between two rounds.
        row('reserve.row-cutoff', '直前締切', '予約開始時刻の何時間前に、オンラインの受付を締め切るかです。', [
          sel('reserve.cutoff', '直前締切', opts([['60', '1時間前'], ['120', '2時間前'], ['180', '3時間前'], ['360', '6時間前']]), String(d.cutoffMinutes)),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 2時間前',
            guardrail: '締切のあとの空きは、店頭・電話でのみ扱えます。短くすると直前の準備が間に合わなくなります。',
          },
          source: 'コアは「分」で持ちます（2時間前 = 120分）',
        }),
        row('reserve.row-grid', 'お客様が選べる開始時刻', 'お客様がReserveで選べる開始時刻の刻みです。コースの長さはメニュー側の設定に従います。', [
          seg('reserve.grid', 'お客様が選べる開始時刻', minuteOpts([15, 30, 60], opsConfig.reserveStartGridMin), String(opsConfig.reserveStartGridMin)),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 60分',
            guardrail: 'スタッフがボードで動かすときの刻みとは別の設定です。細かくするほど、下の「スキマ枠」に出る端は小さくなります。',
          },
        }),
        row('reserve.row-session', '標準セッションの長さ', '1回分の施術の標準的な長さです。空き時間にこの長さが何回まるごと収まるかを先に数えます。', [
          seg('reserve.session', '標準セッションの長さ', minuteOpts([30, 45, 60, 90], opsConfig.standardSessionMin), String(opsConfig.standardSessionMin)),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 60分',
            guardrail: '収められる本数を、区切りの良い開始時刻より優先します。長くすると、収まる本数が減ります。',
          },
        }),
        row('reserve.row-gapfill', 'スキマ枠の販売', '予約と予約のあいだにできる空きのうち、開始時刻の刻みに乗らない端の部分だけを特価で売ります。', [
          sel('reserve.gapfill', 'スキマ枠の販売', opts([['0', '販売しない'], ['15', '15分'], ['30', '30分'], ['45', '45分'], ['60', '60分']]), String(opsConfig.gapFillMinMin)),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 30分',
            guardrail: 'この長さより短い端は掲載しません。刻みを細かくするほど端は小さくなり、この枠自体が縮みます。',
          },
        }),
        row('reserve.row-gapdisc', 'スキマ割', '端のスキマ枠に適用する割引です。時間帯ごとの価格から、この割合を引いて掲載します。', [
          sel('reserve.gapdisc', 'スキマ割', opts([['0', '0%'], ['5', '5%'], ['10', '10%'], ['15', '15%'], ['20', '20%']]), String(opsConfig.gapFillDiscountPct)),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 10%',
            guardrail: '最大割引ライン（定価の−30%）を下回ることはありません。',
          },
        }),
        row('reserve.row-lead', '直前の空きは売らない', '開始までこの時間を切った空きは、お客様に出しません。', [
          sel('reserve.lead', '直前の空きは売らない', opts([['0', '制限なし'], ['30', '30分前まで'], ['60', '60分前まで'], ['120', '120分前まで']]), String(opsConfig.leadTimeMin)),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          trio: {
            base: '初期値: 60分前まで',
            guardrail: '制限なしにすると、準備の時間がない予約が入ります。締め切った空きは店頭・電話でのみ扱えます。',
          },
        }),
      ], {
        preview: { template: 'お客様には{reserve.days}先まで、{reserve.grid}きざみの開始時刻を出します。{reserve.cutoff}で締め切り、{reserve.lead}の空きは出しません。スキマ枠は{reserve.gapfill}以上を{reserve.gapdisc}引きで掲載します。' },
        links: [{ label: 'ボードの操作の刻みは店舗情報・営業時間で', sectionId: 'store-hours' }],
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -6))}（受付ウィンドウを変更）`,
      }),
      block('reserve.guard', 'スキマガードの見え方', 'ガードが有効なとき、お客様に出す開始時刻がどう変わるかです。オン・オフと厳しさは予約と確保で変更します。', [], {
        facts: [
          '新規のお客様の枠を壊す開始時刻は、お客様には最初から表示されません。打ち消し線ではなく、選べる時間として存在しません。',
          '安全な開始がひとつもない場合は、通常の「空きなし」として表示します。',
        ],
        table: {
          head: ['', '10:00', '11:00', '12:00', '13:00'],
          rows: [
            { cells: ['ガードなし', '選べます', '選べます', '選べます', '選べます'], tags: [] },
            { cells: ['ガードあり', '選べます', '出しません', '選べます', '選べます'], tags: [] },
          ],
        },
        links: [{ label: 'スキマガードの設定は予約と確保で', sectionId: 'booking-guard' }],
      }),
      block('reserve.cancel', 'キャンセル規定', 'お客様都合のキャンセルと、ご連絡のないキャンセルの扱いです。', [
        row('reserve.row-free', '無料キャンセル期限', 'この時刻より前のキャンセルは、キャンセル料がかかりません。', [
          sel('reserve.free', '無料キャンセル期限', opts([['12', '12時間前'], ['24', '24時間前'], ['48', '48時間前']]), String(d.cancelFreeUntilHours)),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 24時間前',
            guardrail: '長くすると、直前まで変更しづらいお客様が予約をためらいます。',
          },
        }),
        row('reserve.row-sameday', '当日キャンセル料', '無料の期限を過ぎたキャンセルにかかる料金です（メニュー代に対する割合）。', [
          seg('reserve.sameday', '当日キャンセル料', opts([['0', '無料'], ['50', '50%'], ['100', '100%']]), String(d.cancelLatePct)),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 50%',
            guardrail: '100%にすると、体調不良のお客様も全額のご負担になります。',
          },
        }),
        row('reserve.row-noshow', '無断キャンセル料', 'ご連絡がなくご来店がなかった場合の料金です。', [
          seg('reserve.noshow', '無断キャンセル料', opts([['0', '無料'], ['50', '50%'], ['100', '100%']]), String(d.noShowPct)),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 100%',
            guardrail: '無断キャンセルは、ご連絡がなくご来店がなかった場合だけを指します。ご連絡のあった当日キャンセルは上の行の扱いです。',
          },
        }),
      ], {
        preview: { template: '{reserve.free}までは無料、それ以降のキャンセルは{reserve.sameday}、ご連絡のないキャンセルは{reserve.noshow}です。' },
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -9))}（当日キャンセル料を変更）`,
      }),
      block('reserve.lock', '価格の見え方', '毎晩の再計算のあいだ、確定するまで新規予約の価格表示を一時的に隠せます。', [
        row('reserve.row-lock', '再計算中は価格を隠す', '空き状況（◯／△／×）の表示は、価格を隠しているあいだも止まりません。', [
          sw('reserve.lock', '再計算中は価格を隠す', '隠す', '隠さない', d.priceLockDuringRecalc),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 隠さない',
            guardrail: 'ポイント制が有効な店舗では、価格を隠しているあいだポイントでのお支払いができません。その時間帯は新規の受付を一時停止します。',
          },
        }),
      ], {
        preview: { template: '再計算のあいだ、新規予約の価格は{reserve.lock}設定です。' },
        links: [{ label: 'ポイント制の設定は料金・ポイントで', sectionId: 'pricing-points' }],
      }),
    ],
    aside: {
      title: 'この値の出どころ',
      lines: [
        { label: 'お客様の開始時刻', value: `${minutesLabel(opsConfig.reserveStartGridMin)}きざみ（今日の運営の公開レイヤーが読む値）` },
        { label: 'スキマ枠', value: `${minutesLabel(opsConfig.gapFillMinMin)}以上・${opsConfig.gapFillDiscountPct}%引き` },
        { label: 'スキマガード', value: '予約と確保で変更します' },
        { label: '営業時間', value: '店舗情報・営業時間で変更します' },
      ],
      note: '受付できるのは営業時間の範囲内だけです。価格は時間帯ごとの価格を分単位で按分し、¥10単位で表示します。',
    },
    persist: null,
  }
}

// ── 通知 ────────────────────────────────────────────────────────────────────

const NOTIFY_EVENTS: Array<[string, string, string]> = [
  ['new-booking', '新規予約', '新しい予約が入ったときのお知らせです。'],
  ['changed', '予約変更', '日時やメニューが変更されたときのお知らせです。'],
  ['cancelled', 'キャンセル', 'お客様都合と無断キャンセルの両方を含みます。'],
]

function notifications(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const channelOpts = opts([['app', 'アプリ'], ['mail', 'メール']])
  return {
    ...base,
    kicker: 'Reserve設定',
    title: '通知',
    lead: '予約まわりの出来事と、価格まわりの注意サインを、どの経路で届けるかの設定です。',
    blocks: [
      block('notify.booking', '予約・キャンセル', 'お客様の予約に関わる出来事のお知らせです。経路はそれぞれ選べます。', NOTIFY_EVENTS.map(([id, label, description]) =>
        row(`notify.row-${id}`, label, description, [
          chips(`notify.${id}`, `${label}のお知らせの経路`, channelOpts, channelsOf(d.notify[id])),
        ], { scopeLabel: STORE_SCOPE })), {
        preview: { template: '新規予約は{notify.new-booking}、予約変更は{notify.changed}、キャンセルは{notify.cancelled}に届きます。' },
        facts: ['経路をどちらも外すと、その出来事のお知らせはどこにも届きません。受信トレイには残ります。'],
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -12))}（キャンセルのお知らせにメールを追加）`,
      }),
      block('notify.guard', '価格のお知らせ', '価格の自動計算まわりの注意サインです。', [
        row('notify.row-guard', '表示の健全性のお知らせ', '比較表示のもとになる価格での取引が基準を割り込みそうなとき、切り替わる前にお知らせします。', [
          sw('notify.guard', '表示の健全性のお知らせを受け取る', '受け取る', '受け取らない', d.guardAlert),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 受け取る',
            guardrail: '止めても、通常価格の表示への切り替え自体は自動で行われます。お知らせが届かなくなるだけです。',
          },
        }),
      ], {
        preview: { template: '表示の健全性のお知らせは{notify.guard}設定です。' },
        links: [{ label: '価格の状態は料金・ポイントで', sectionId: 'pricing-points' }],
      }),
      block('notify.quiet', '静かな時間', 'この時間帯はアプリのお知らせを届けません（メールは対象外です）。', [
        row('notify.row-quiet', '静かな時間', '直前のキャンセルなど、必ず届けるべきお知らせは静かな時間中でも届きます。', [
          tim('notify.quiet-start', '静かな時間の開始', d.quietStart),
          tim('notify.quiet-end', '静かな時間の終了', d.quietEnd),
        ], {
          scopeLabel: STORE_SCOPE,
          trio: {
            base: '初期値: 21:00〜9:00',
            guardrail: '長くしても、当日のキャンセルなど必ず届けるべきお知らせは止まりません。',
          },
        }),
      ], {
        preview: { template: '{notify.quiet-start}から{notify.quiet-end}のあいだ、アプリのお知らせは届きません。' },
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -16))}（静かな時間を設定）`,
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '届く先', value: 'アプリ（スタッフの端末）とメール' },
        { label: '静かな時間', value: 'アプリのみ対象（メールは届きます）' },
        { label: '受信トレイ', value: 'お知らせを止めても、出来事は受信トレイに残ります' },
      ],
      note: 'お客様への連絡は、この画面の設定ではなくお客様ごとの同意で決まります。',
    },
    persist: null,
  }
}

const channelsOf = (v: { app: boolean; mail: boolean } | undefined): string[] => {
  const out: string[] = []
  if (v?.app) out.push('app')
  if (v?.mail) out.push('mail')
  return out
}

// ── スタッフ管理 ────────────────────────────────────────────────────────────

function staffAdmin(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const nameOf = new Map(staff.map((s) => [s.id, s.full_name]))
  const roster = Object.keys(d.staffSettings)
  // ⚖ S17 · C7 — THE GRID RENDERS FROM THE RULEBOOK. Both lists are Karute's
  // own, mirrored with their cites in `fixtures-settings.rulebook`; at the
  // reconnect they are replaced by `PermissionClient.rulebook()` and nothing
  // else on this page has to move. `custom` is offered like any other role
  // because Karute offers it — a blank canvas is a real answer to 「what is this
  // person allowed to do」.
  const presetOpts = rulebook.roles.map((r) => ({ value: r.key, label: r.label }))
  const capOpts = rulebook.capabilities.map((c) => ({ value: c.token, label: c.label }))
  return {
    ...base,
    kicker: '組織・管理',
    title: 'スタッフ管理',
    lead: '誰が何をできるかの設定です。役職を選ぶと権限がまとめて切り替わり、そのあと個別に調整できます。',
    blocks: [
      block('staff.roster', 'スタッフ一覧', '役職と、その人ができることです。役職はひな形で、下の一覧で個別に足し引きできます。', roster.map((id) => {
        const s = d.staffSettings[id]
        const granted = s.caps.length > 0 ? s.caps : [...(rulebook.grants[s.preset] ?? [])]
        const name = nameOf.get(id) ?? id
        return row(`staff.row-${id}`, name, '', [
          sel(`staff.preset-${id}`, `${name}の役職`, presetOpts, s.preset),
          chips(`staff.caps-${id}`, `${name}ができること`, capOpts, granted, undefined, true),
        ], {
          meta: [s.pin ? '暗証番号 設定済み' : '暗証番号 未設定', s.voice ? '音声登録 済み' : '音声登録 なし'],
          // ⚖ C7 / F1 / F6 — the wire's rulebook defines NINE role keys
          // (`PermissionRoleKey`, dist/types.d.ts:1186 — `area_manager` /
          // `trainee` / `accountant` are the three Karute has not adopted) and
          // Karute has preset grants behind six of them. So the row OFFERS six
          // and COUNTS all nine.
          //
          // ⚠ THE THREE KEYS ARE NOT PRINTED. The first cut dropped
          // `area_manager / trainee / accountant` into the middle of a Japanese
          // sentence: a salon owner opening 詳しく met three raw English
          // identifiers, which reads as an unfinished developer artifact rather
          // than as something written for them. The fix for 「we have not named
          // these yet」 is a sentence that SAYS so in Japanese — and not an
          // invented Japanese gloss either, because a name for a role nobody can
          // currently be is a label the room made up. The keys live in this
          // comment and in the SDK disk-read pin; the reader gets the count.
          source: `カルテと同じ権限の一覧です（役職を選ぶとひな形どおりに入り、そのあと1つずつ足し引きできます）。コアの権限表には役職の種類が${rulebook.roles.length + rulebook.unadoptedRoleKeys.length}つあり、いまカルテが使っているのは${rulebook.roles.length}つです。残る${rulebook.unadoptedRoleKeys.length}つは、まだ名前も権限のひな形も用意されていません。`,
        })
      }), {
        facts: [
          // ⚖ 8/25 — a number says WHAT it counts, and both are DERIVED from the
          // rulebook so a nineteenth capability cannot ship beside a page still
          // claiming eighteen.
          `権限は全部で${rulebook.capabilities.length}項目、役職のひな形は${rulebook.roles.length}つです。`,
          '氏名は人・設備の名簿と合わせています。この画面では氏名を編集しません。',
          '音声登録は録音設定で本人が行います。この画面では状態だけを表示します。',
        ],
        links: [
          { label: '氏名と稼働は人・設備で', sectionId: 'people-equipment' },
          { label: '音声登録は録音設定で', sectionId: 'recording' },
        ],
        preview: { template: `いま${nameOf.get(roster[0]) ?? ''}さんは{staff.preset-${roster[0]}}で、できることは{staff.caps-${roster[0]}}です。` },
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -3))}（権限を更新）`,
      }),
      block('staff.invite', '招待', 'まだ参加していない人に、参加のご案内を送ります。', [
        row('staff.row-invite', '招待する人', '氏名・メールアドレス・最初の役職を決めて送ります。', [
          txt('staff.invite-name', '招待する人の氏名', '', { placeholder: '例）見本 はなこ' }),
          txt('staff.invite-email', '招待する人のメールアドレス', '', { placeholder: '例）hanako@example.com' }),
          sel('staff.invite-preset', '招待する人の最初の役職', presetOpts, 'practitioner'),
        ]),
      ], {
        action: {
          label: '招待を送る',
          template: '{staff.invite-name} さんを {staff.invite-preset} として招待しました（この画面の中だけの記録です）。',
          requires: 'staff.invite-name',
          requireError: '氏名を入力してください。',
        },
        facts: ['保留中の招待はありません。参加後も役職と権限はこの画面でいつでも変更できます。'],
      }),
      block('staff.gaps', 'いまの権限の仕組みで足りないところ', 'この2つは、いまの権限の一覧に項目そのものがありません。', [], {
        list: {
          title: 'まだ用意されていない権限',
          items: [
            // ⚖ S17 — THE LINE WAS TRUE UNTIL THE FOLD AND IS NOT ANY MORE.
            // 予約と確保 ships 上書きの権限 AND 名指しロック, so 「no control
            // exists」 became false the moment #812 arrived. What is still
            // missing is the SAVE — the capability token that records who may
            // override, in core (registry ②) — and that is what this now says.
            '「置けない」場所への上書きは「予約と確保」で決めます。権限としての本保存（誰に上書き権限があるかをコアに記録する項目）はまだありません。',
            '設定ページごとの権限 — いまは「設定の変更」ひとつで、すべての設定ページをまとめて開いています。',
          ],
        },
        facts: [
          `いま「置けない」場所に置けるのは ${storeBookingPolicy.overridePolicy.roles.join('・')} です。`,
          `人件費を見られるのは ${shiftsPolicy.laborCostRoles.join('・')} です。`,
          `売上分析を店舗全体で見られるのは ${analyticsPolicy.viewRoles.join('・')} です。`,
        ],
        links: [{ label: '予約と確保を開く', sectionId: 'booking-guard' }],
      }),
    ],
    aside: {
      title: 'いまの権限の仕組み',
      lines: [
        { label: '設定の権限', value: 'ひとつだけ（ページごとには分かれていません）' },
        { label: '上書きの権限', value: '権限の一覧に項目がありません' },
        { label: '人件費を見られる役職', value: shiftsPolicy.laborCostRoles.join('・') },
        { label: '売上分析を見られる役職', value: analyticsPolicy.viewRoles.join('・') },
      ],
      note: '役職はひな形です。役職を選んだあと、その人だけできることを足したり外したりできます。',
    },
    persist: null,
  }
}

// ── 外部連携 ────────────────────────────────────────────────────────────────

function integrations(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  return {
    ...base,
    kicker: '組織・管理',
    title: '外部連携',
    lead: '外部のサービスとのつながりの設定です。つなぐと、その種類のデータをやり取りできるようになります。',
    blocks: [
      block('link.list', '連携', 'つなぎたいサービスの種類を選んでください。特定の会社名ではなく、種類でお選びいただきます。', connectorCatalog.map((c) =>
        row(`link.row-${c.id}`, c.name, c.note, [
          sw(`link.${c.id}`, `${c.name}につなぐ`, 'リクエスト済み', '未接続', d.connectors[c.id] === 'pending'),
        ], { scopeLabel: STORE_SCOPE })), {
        preview: { template: '外部カレンダーは{link.calendar}、会計ソフトは{link.accounting}、メッセージ配信は{link.messaging}、外部予約サイトは{link.booking-site}です。' },
        facts: ['つなぐ・外すの操作は記録に残ります。実際のつなぎ込みは、リクエストのあとで担当が行います。'],
        links: [{ label: '操作の記録は監査ログで', sectionId: 'audit-log' }],
      }),
    ],
    aside: {
      title: 'いまの状態',
      lines: [
        { label: 'つながっているもの', value: 'Reserveの予約同期だけです' },
        { label: 'リクエスト', value: '担当が確認してからつなぎます' },
        { label: '記録', value: 'つなぐ・外すはどちらも記録に残ります' },
      ],
      note: '特定の会社名を出していないのは、まだつないでいないサービスの名前を出すと、つながっているように読めてしまうためです。',
    },
    persist: null,
  }
}

// ── データ入出力 ────────────────────────────────────────────────────────────

function dataIo(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  // ⚖ C7 — the room gates SECTIONS on six tokens; this block's own finer gate
  // asks the same rulebook the grid renders, so 「may this reader export」 has
  // one answer rather than a second copy of the grant table.
  const mayExport = (rulebook.grants[rulebook.roleKeyOf[ctx.access.role] ?? ''] ?? []).includes('data.export')
  const locked = mayExport ? undefined : 'データを書き出す権限が必要です。'
  return {
    ...base,
    kicker: '組織・管理',
    title: 'データ入出力',
    lead: 'データの書き出しと取り込みです。このページは誰でも開けます — 実際にできる操作は、それぞれのまとまりの権限で決まります。',
    blocks: [
      block('io.export', '書き出し', '書き出す対象と形式を選んでください。', [
        row('io.row-scope', '対象データ', '選んだ種類だけを書き出します。', [
          chips('io.scope', '書き出す対象データ', opts([
            ['customers', '顧客'], ['bookings', '予約'], ['records', 'カルテ'], ['sales', '売上'],
          ]), d.exportScopes, locked),
        ], { scopeLabel: STORE_SCOPE }),
        row('io.row-format', '形式', '表計算ソフトで開くならCSVを選んでください。', [
          seg('io.format', '書き出しの形式', opts([['csv', 'CSV'], ['json', 'JSON']]), d.exportFormat, locked),
        ], { scopeLabel: STORE_SCOPE }),
      ], {
        ...(mayExport ? {} : { rightsNote: '権限がありません — データを書き出すには、書き出しの権限が必要です。' }),
        action: mayExport
          ? {
              label: '書き出す',
              template: '{io.scope} を {io.format} で書き出しました（この画面の中だけの記録です）。',
              requires: 'io.scope',
              requireError: '書き出す対象を1つ以上選んでください。',
            }
          : null,
        facts: [`最後の書き出し: ${d.lastExport}`, '書き出しの操作は記録に残ります。'],
      }),
      block('io.intake', '取り込み', 'ファイルを選んで、内容を確認してから取り込みます。', [], {
        flag: '準備中',
        rightsNote: '取り込みはこれから用意します。用意ができるまで、ファイルの選択と取り込みは行えません。',
        table: {
          head: ['行', '氏名', '状態'],
          rows: [
            { cells: ['1', '例）見本 はなこ', '確認待ち'], tags: [] },
            { cells: ['2', '例）見本 たろう', '確認待ち'], tags: [] },
          ],
        },
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: 'このページ', value: '誰でも開けます' },
        { label: '書き出し', value: mayExport ? '行えます' : '権限が必要です' },
        { label: '取り込み', value: '準備中です' },
        { label: '記録', value: '書き出し・取り込みはどちらも記録に残ります' },
      ],
      note: '録音の書き出しは、この画面ではなく録音設定の決まりに従います。まとめての書き出しはできません。',
    },
    persist: null,
  }
}

// ── 監査ログ ────────────────────────────────────────────────────────────────

/** ⚖ S17 · C8 — the filter's options ARE the writers' own categories, plus
 *  canon's own 「すべて」 (which the screen's `filterTable` treats as matching
 *  every row). Derived from `AUDIT_CATEGORIES` so a tenth category cannot ship
 *  beside a filter that cannot find it. */
const AUDIT_FILTER: Array<[string, string]> = [
  ['all', 'すべて'],
  ...AUDIT_CATEGORIES.map((c) => [c.token, c.label] as [string, string]),
]

function auditLog(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const catLabel = new Map(AUDIT_FILTER)
  return {
    ...base,
    kicker: '組織・管理',
    title: '監査ログ',
    lead: '誰が・いつ・何を変えたかの記録です。表示だけで、ここから編集はできません。',
    blocks: [
      block('audit.filter', '絞り込み', '期間と種類で、表示する記録を絞り込みます。押すとすぐ下の表が変わります。', [
        row('audit.row-period', '期間', 'この日数より前の記録は表示しません。', [
          seg('audit.period', '期間', opts([['0', '今日'], ['7', '7日'], ['30', '30日']]), '30'),
        ]),
        row('audit.row-category', '種類', '変更の種類で絞り込みます。', [
          sel('audit.category', '種類', AUDIT_FILTER.map(([value, label]) => ({ value, label })), 'all'),
        ]),
      ], {
        preview: { template: 'いま{audit.period}以内・{audit.category}の記録を表示しています。' },
      }),
      block('audit.rows', '変更の記録', '変更の内容は「前 → 後」で表示します。', [], {
        filterBy: ['audit.period', 'audit.category'],
        table: {
          head: ['日時', '誰が', '何を', '変更の内容'],
          rows: d.auditLog.map((e) => ({
            cells: [
              `${fmtDayWeek.format(dayFrom(ctx.now, -e.dayOffset))} ${e.at}`,
              e.who,
              `${e.what}（${catLabel.get(e.category) ?? e.category}）`,
              `${e.subject}: ${e.before} → ${e.after}`,
            ],
            // ⚠ THE TAGS ARE WHAT THE FILTER READS. A row belongs to its own
            // category and to every period it is inside, so 「今日」 and 「30日」
            // are both true of a row from today rather than being two lists.
            tags: [e.category, ...periodTags(e.dayOffset)],
          })),
        },
        facts: ['記録は削除できません。すべての変更は自動で記録され、いつでも確認できます。'],
      }),
    ],
    aside: {
      title: 'この記録について',
      lines: [
        { label: 'この店舗の記録', value: `${d.auditLog.length}件` },
        { label: '残る期間', value: '削除はできません' },
        { label: '書き込む人', value: '設定を変えた本人とシステム' },
      ],
      note: '価格の自動切り替えなど、システムが行った変更も同じ記録に残ります。',
    },
    persist: null,
  }
}

const periodTags = (dayOffset: number): string[] => {
  const out = ['30']
  if (dayOffset <= 7) out.push('7')
  if (dayOffset <= 0) out.push('0')
  return out
}

// ── 言語・表示 ──────────────────────────────────────────────────────────────

const BOOKING_CATEGORIES: Array<[string, string, string]> = [
  ['new', '新規予約', 'はじめてのお客様'],
  ['repeat', '再来（リピート）', '2回目以降のご来店'],
  ['renewal', '更新案内が必要', '回数券の残りが少ない・期限が近い'],
  ['pack', '回数券利用', '回数券を消化する予約'],
  ['vip', 'VIP', 'お店が指定したお客様'],
]

function languageDisplay(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  const langOpts = opts([['ja', '日本語'], ['en', 'English']])
  const paletteOpts = bookingPalette.map((p) => ({ value: p.value, label: p.label, hex: p.hex }))
  return {
    ...base,
    kicker: '組織・管理',
    title: '言語・表示',
    lead: '表示言語と、予約の色分けです。言語は人ごと、色分けは店舗ごとの設定です。',
    blocks: [
      block('lang.language', '表示言語', 'SYNQEDの3つの製品それぞれで、使う人が自分の言語を選べます。', [
        row('lang.row-ui', 'この画面の言語', 'この画面を含む管理画面の言語です。スタッフごとに別の言語を選べます。', [
          sel('lang.ui', 'この画面の言語', langOpts, d.uiLanguage),
        ], {
          scopeLabel: SELF_SCOPE,
          trio: {
            base: '初期値: 端末の言語に合わせる',
            guardrail: 'まだ対応していない画面は日本語のまま表示します。空白の画面にはしません。すべての画面の対応はこれから行います。',
          },
        }),
        row('lang.row-karute', 'カルテ（スタッフのアプリ）の言語', 'スタッフ本人がアプリの中で選びます。ここでの設定は最初の値になります。', [
          sel('lang.karute', 'カルテの最初の言語', langOpts, d.karuteLanguage),
        ], { scopeLabel: STORE_SCOPE }),
        row('lang.row-reserve', 'Reserve（お客様の予約ページ）の言語', 'お客様のブラウザの設定に従い、ページの上でも切り替えられます。お店が固定はしません。', [
          ro('lang.reserve', 'Reserveの言語', 'お客様が選択（日本語 / English）'),
        ], { scopeLabel: STORE_SCOPE }),
      ], {
        preview: { template: 'この画面は{lang.ui}、カルテの最初の言語は{lang.karute}です。切り替えると、メニュー・状態・お知らせの文がすべて選んだ言語になります。' },
        facts: ['すべての画面を言語に対応させる作業はこれから行います。それまでは日本語で表示されます。'],
      }),
      block('lang.colors', '予約の色分け', '予約の種類ごとの色です。ボードと一覧の左端の帯・点に出ます。', BOOKING_CATEGORIES.map(([id, label, hint]) =>
        row(`lang.row-color-${id}`, label, hint, [
          swatch(`lang.color-${id}`, `${label}の色`, paletteOpts, d.bookingColors[id] ?? 'gray'),
        ], { scopeLabel: STORE_SCOPE })), {
        preview: { template: '新規予約は{lang.color-new}、再来は{lang.color-repeat}、更新案内は{lang.color-renewal}の帯で表示します。' },
        facts: [
          '状態の色は変えられません — 緑（確定）・琥珀（要対応）・赤（停止・障害）は全店舗共通の安全の決まりです。',
          '帯と点は予約の種類、ピルはいまの状態です。別のものを見せています。',
        ],
        links: [{ label: '画面全体の色は色・テーマで', sectionId: 'colors' }],
      }),
    ],
    aside: {
      title: 'いまの状態',
      lines: [
        { label: 'この画面の言語', value: d.uiLanguage === 'ja' ? '日本語' : 'English' },
        { label: '対応予定', value: 'すべての画面を言語に対応させる作業をこれから行います' },
        { label: 'スマホ', value: '端末の言語に合わせる形を予定しています' },
        { label: '状態の色', value: '変更できません（全店舗共通）' },
      ],
      note: '言語は人ごと、色分けは店舗ごとの設定です。ひとつの画面にありますが、届く範囲が違います。',
    },
    persist: null,
  }
}

// ── 色・テーマ ──────────────────────────────────────────────────────────────

/** ⚖ S17 · C9 — 色・テーマ IS BUSINESS'S OWN, AND IT SHARES NO KEY WITH KARUTE.
 *
 *  Karute has a colour setting called `theme_colors` and it is a DIFFERENT
 *  QUESTION: `src/lib/theme.ts:1-9` `ThemeColors { barOpen, barBooking,
 *  barRecording, barCompleted, barBlocked, barProcessing, tableBg, tableRowBg }`
 *  — the six status colours of the phone's appointment bars plus two table
 *  surfaces. What this section edits is the FAMILY'S OWN CSS token names
 *  (`--commit-bg`, `--select-bg`, …). Zero overlap, verified key by key, so
 *  writing this room's values into `theme_colors` would silently repaint the
 *  phone's status bars with a settings page's accent.
 *
 *  ⚠ NO WIRE: the column these belong in does not exist. Registry line —
 *  `business_theme`, per business, on the Anthony list. NEVER `theme_colors`. */
function colors(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  void ctx
  const tokens = Object.keys(d.colorTokens)
  /** ⚠ A SWATCH IS NAMED BY ITS COLOUR, NOT BY ITS HEX. The accessible name is
   *  what a screen reader says on every focus, and 「#2563eb」 spoken aloud is a
   *  code (⚖ plain names). The store's own current colour keeps its place in the
   *  row even when it is not one of the named eight — canon's own rule that a
   *  preset list must contain the value it claims to be showing. */
  const NAMED: Array<[string, string]> = [
    ['#2563eb', '青'], ['#0f766e', '緑青'], ['#7c3aed', '紫'], ['#b45309', '橙'],
    ['#166534', '緑'], ['#b91c1c', '赤'], ['#a16207', '黄土'], ['#3f3f46', '墨'],
  ]
  const paletteFor = (hex: string): ControlOption[] => {
    const named = NAMED.map(([h, label]) => ({ value: h, label, hex: h }))
    return named.some((o) => o.value === hex) ? named : [{ value: hex, label: '現在の色', hex }, ...named]
  }
  return {
    ...base,
    kicker: '組織・管理',
    title: '色・テーマ',
    lead: 'この製品が使う色の元です。押すと、すぐ下のプレビューがその色になります。',
    blocks: [
      block('colors.tokens', '色の設定', 'それぞれの色が画面のどこを塗るかを、色の横に書いています。', tokens.map((t) =>
        row(`colors.row-${t}`, colorTokenMeaning[t] ?? t, '', [
          swatch(`colors.${t}`, `${colorTokenMeaning[t] ?? t}の色`, paletteFor(d.colorTokens[t]), d.colorTokens[t]),
        ], { scopeLabel: STORE_SCOPE })), {
        preview: { template: '確定・保存ボタンは{colors.--commit-bg}、選択中の行は{colors.--select-bg}、注意のしるしは{colors.--orange}です。' },
        facts: [
          'ボタンやタブなどの押せるところを黒一色にしないのが既定です。色は「選んでいる」「実行する」を見分けるために使います。',
          '読みにくい組み合わせになったときは、この下にお知らせします。選べなくはしません。',
        ],
        links: [{ label: '予約の種類ごとの色は言語・表示で', sectionId: 'language-display' }],
      }),
      block('colors.mine', '自分の見え方', 'カードの見せ方の好みは、自分の表示設定で変えられます。ここはお店ぜんたいの色です。', [], {
        facts: ['密度と強調は自分だけの設定で、権限に関わらず誰でも変えられます。'],
        links: [{ label: '自分の表示設定を開く', sectionId: 'my-display' }],
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '届く範囲', value: 'この店舗のすべての画面' },
        { label: '状態の色', value: '緑・琥珀・赤は変更できません' },
        { label: '自分の見え方', value: '自分の表示設定で別に決められます' },
      ],
      note: '押せるところを黒一色にしないのは、押せるものと押せないものを見分けられるようにするためです。',
    },
    persist: null,
  }
}

// ── 事業構成 ────────────────────────────────────────────────────────────────

/** ⚖ S17 · C10 — 会社名 IS ITS OWN KEY, and it is not `OrgSettings.name`.
 *
 *  Karute binds the org-settings name to `salon_name` — the SHOP's public name,
 *  which `upsertOrgSettings` writes straight through to `orgSettings.upsert({
 *  name })` (`src/actions/org-settings.ts:363-366`). The contracting entity
 *  behind it (「見本サンプル整体 合同会社」) is a different fact from the shop's
 *  name, and a business whose legal entity is renamed has not renamed its salon.
 *  So 会社名 · 代表 · 法人格 keep their OWN keys (`companyName`,
 *  `representative`, `companyForm` in `fixtures-settings`), all NO WIRE, and
 *  they stay read-only-until-reconnect exactly as built. Registry ⑨. */
function businessStructure(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  return {
    ...base,
    kicker: '店舗運営',
    title: '事業構成',
    lead: '事業体としての基本情報と、運営する店舗の一覧です。日々の運営の設定はそれぞれのカテゴリーで行います。',
    blocks: [
      block('org.entity', '事業体', '契約の主体の基本情報です。請求書と契約書に使われます。', [
        row('org.row-company', '会社名', '請求書・契約書に使われる正式名称です。', [
          txt('org.company', '会社名', d.companyName, { required: true, maxLength: 60 }),
        ], { scopeLabel: BUSINESS_SCOPE }),
        row('org.row-rep', '代表', '代表者名です。', [
          ro('org.rep', '代表', d.representative),
        ], { scopeLabel: BUSINESS_SCOPE }),
        row('org.row-form', '法人格', '設立の形です。', [
          ro('org.form', '法人格', d.companyForm),
        ], { scopeLabel: BUSINESS_SCOPE }),
      ], {
        facts: ['代表と法人番号の変更は、本人確認のうえサポートが承ります（この画面からは変更できません）。'],
        audit: `最終変更: ${operator.name} ・ ${fmtDayWeek.format(dayFrom(ctx.now, -34))}（会社名の表記を修正）`,
      }),
      block('org.stores', '店舗', `${business.name}が運営する店舗の一覧です。ほかの店舗の設定はここからは変更できません。`, [], {
        table: {
          head: ['店舗', 'この店舗', ''],
          rows: stores.map((s) => ({
            cells: [s.name, s.id === ctx.storeId ? 'いま見ている店舗' : '—', s.id === ctx.storeId ? '' : '設定は店舗を切り替えてから'],
            tags: [],
          })),
        },
        facts: ['新しい店舗の開設はサポートまでご連絡ください。既存の店舗の設定は店舗ごとに独立しています。'],
      }),
      block('org.brand', 'ブランド・本部', 'この事業の運営の範囲についての情報です。', [], {
        facts: [`${stores.length}店舗の運営のため、価格帯とポイント制はこの事業のオーナー権限で管理します。本部による一括の管理は使っていません。`],
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '事業体', value: d.companyName },
        { label: '店舗数', value: people(stores.length).replace('名', '店舗') },
        { label: '代表の変更', value: 'サポートが承ります' },
      ],
      note: '店舗ごとの設定は、左上の店舗の切替でその店舗に移ってから変更します。',
    },
    persist: null,
  }
}

// ── 契約・請求 ──────────────────────────────────────────────────────────────

function billing(base: SectionBase, ctx: Ctx, d: StoreDials): SettingsSection {
  const total = planPricing.karute + planPricing.reserve
  return {
    ...base,
    kicker: '組織・管理',
    title: '契約・請求',
    lead: 'プランの変更・お支払い・領収書は、このWeb画面だけで扱います。カルテやReserveのアプリの中で請求することはありません。',
    blocks: [
      // ⚖ S17 · C11 — A STATEMENT AND A DOOR, NOT TWO SWITCHES.
      // The entitlement is `{ business_id, tier, is_unlimited }` — ONE row for
      // the whole business (dist/types.d.ts:250-254) — so the first cut's two
      // per-STORE switches offered something the model cannot hold: カルテ on
      // for 銀座 and off for 代官山. And a settings screen does not write it at
      // all: the billing seam does, through Stripe, which is also canon's own
      // 「Web限定」 ruling. So the plan is READ, the money is stated, and the way
      // to change it is a door that really opens (⚖ label truth — 「Web限定」 is
      // what it says, and this Web page is where it lands).
      block('billing.plan', 'ご契約中のプラン', 'この事業のご契約です。プランは事業ぜんたいでひとつで、店舗ごとには分かれていません。', [
        row('billing.row-tier', '現在のプラン', 'カルテ（カルテ・AI・録音）とReserve（オンライン予約受付）が含まれます。', [
          ro('billing.tier', '現在のプラン', entitlement.tierLabel),
        ], {
          scopeLabel: BUSINESS_SCOPE,
          meta: [entitlement.isUnlimited ? '上限なし' : '通常の上限'],
          source: '契約はコアの事業ごとの記録から読んでいます（この設定画面からは変更しません）',
        }),
      ], {
        facts: [
          `いまの月額の合計は${yen(total)}（税込）です。`,
          // ⚖ F7 — ONE DESTINATION, ONE NAME. This line used to send the reader
          // to 「Webのお支払い画面」 while the section's own lead six lines up
          // sends them to 「このWeb画面」. Two names for one place, in one
          // section, is a reader working out whether they are the same. It is
          // the lead's words now, and it adds only what the lead does not
          // enumerate (お支払い方法の変更) — no new promise.
          'プランの変更・お支払い方法の変更・領収書は、このWeb画面だけで扱います。',
        ],
        // ⚠ NO DOOR HERE, AND THAT IS THE LABEL-TRUTH RULE DOING ITS JOB. The
        // 「Web限定」 destination IS this page — a button that opens the section it
        // is already in is a dead lever with a promise on it. The sentence above
        // says where the change happens; when the Stripe portal has a real
        // address, this becomes a link to THAT.
      }),
      block('billing.payment', 'お支払い方法', 'お支払いはStripeの安全なWeb画面で行い、この設定画面には結果だけが届きます。', [
        row('billing.row-card', 'カード', `有効期限 ${d.cardExpiry}`, [
          ro('billing.card', 'カード', `•••• ${d.cardLast4}`),
        ], { scopeLabel: BUSINESS_SCOPE }),
      ], {
        facts: ['カードの情報はこの製品に保存されません。'],
      }),
      block('billing.history', '請求の履歴', '金額は税込です。領収書はいつでも再発行できます。', [], {
        table: {
          head: ['請求日', '内容', '金額', '状態'],
          rows: [0, 1, 2].map((i) => ({
            cells: [fmtDay.format(dayFrom(ctx.now, -i * 30)), '月額プラン', yen(total), i === 0 ? '請求予定' : '支払済み'],
            tags: [],
          })),
        },
      }),
      block('billing.cancel', '解約', '解約は期末（次回請求日の前日）まで有効です。データは90日間保持し、その間は再開できます。', [], {
        list: {
          title: '解約の前に確認すること',
          items: [
            '公開中のReserveの受付が止まります。',
            'スタッフのアカウントは読み取りのみになります。',
            'データは90日間保持し、その間はいつでも再開できます。',
          ],
        },
      }),
    ],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '扱う場所', value: 'Webのこの画面だけ' },
        { label: 'カード情報', value: 'この製品には保存しません' },
        { label: '解約', value: '期末まで有効・90日間データ保持' },
      ],
      note: 'アプリの中で請求することはありません。決済はStripeのWeb画面で行います。',
    },
    persist: null,
  }
}
