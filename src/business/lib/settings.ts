// 設定 — THE ROOM'S RULES AND ITS VOCABULARY, AS PURE FUNCTIONS AND TYPES.
//
// Nothing here reads data, holds state or knows React (the family's plane/lib/
// screen split; `foundation.test.ts`'s import inventory is the pin). The props
// file joins these rules to the world's planes; the screen renders the answer
// and owns the interaction.
//
// ══ WHAT CHANGED IN THE LOOK-FIX ROUND, AND WHY ═════════════════════════════
//
// ⚖ THE OWNER OVERTURNED TWO ADJUDICATIONS (2026-09-01). The first cut built
// only the sections that had a mapped dial and left ten designed 準備中 panels;
// and it refused every store control with its own paragraph. His words: 「why
// does everything say it's being prepared? Nothing works… What's the point if
// the settings page doesn't work?」
//
// So: EVERY canon page is built (the eighteen fable-settings-*.html pages plus
// fable-billing-plan.html), and EVERY control is LIVE — it changes, the section
// goes dirty, 保存 commits, and the change is visible. The honesty is carried by
// the page's own サンプルデータ dateline plus ONE footnote per store section
// (「保存はこの画面の中だけに反映されます（実データ接続後に本保存）」) instead of
// sixteen refusal paragraphs.
//
// ⚠ THE SEAL IS NOT OVERTURNED AND NEVER WAS. Nothing here writes to core. What
// the round retires is the pretence that a DEMO cannot move — the 録音 room's
// demo machine is the family precedent, and canon's own settings mocks are fully
// interactive with dirty/save semantics against a page-local store.
//
// ⚠ THE BUILD REGISTRY LIVES IN THIS COMMENT AND IN THE BUILD REPORT — NEVER IN
// A STRING A READER CAN SEE (the room-8 N8-1 class, killed as a class in the fix
// round and kept killed here). The eight seams this room's store dials reconnect
// through, for the Anthony ask:
//   ① 店舗ポリシーの保存        — the write door for the board-policy cluster
//   ② 設定の権限トークン        — per-section settings capabilities + guard.override
//   ③ コーチングの店舗設定      — org_settings for the four コーチング dials
//   ④ 文字起こしの公開範囲の実装 — enforcement at the data door, not the screen
//   ⑤ 再来促しのしきい値        — ONE value both doors read
//   ⑥ 現金差異の承認しきい値    — the write door; the value is read from レジ today
//   ⑦ 表示言語                  — the ALL-LANGUAGES retrofit round
//   ⑧ 動的価格の店舗設定        — the store-wide master does not exist yet
// A ninth is now named by the round that built the rest of canon: ⑨ 店舗プロ
// フィールの保存 (店舗情報・営業時間・臨時休業・設備・メニュー・通知・同期・
// 連携・データ入出力・色トークン・請求) — everything this page now edits demo-
// locally and will one day persist.
//
// ══ THE ONE STRUCTURAL DUTY THIS ROOM WAS BUILT FOR ═════════════════════════
//
// ⚠ GATING IS SECTION-SCOPED BY CONSTRUCTION. The DIAL-HOME-MAP's (d) finding
// names the real gap in canon: every gated settings page uses ONE page-wide
// `boundaryPanel`, so a personal preference that happens to sit beside a store
// policy is gated along with it — 「positional discipline, not a rule the markup
// enforces」. colors.html gets away with it because 自分の表示設定 sits
// physically after the boundary markup in the DOM.
//
// Here the check CANNOT be page-wide, because there is no page-level gate to
// write: `gateOf` takes ONE SECTION and returns that section's own answer, and
// its first line returns `open` for a self-scoped section WITHOUT LOOKING AT
// ACCESS AT ALL. A future builder who wants to gate the whole page has to delete
// that line, and the suite's mutation battery kills exactly that edit.

// ── the capability vocabulary ───────────────────────────────────────────────
//
// canon's スタッフ管理 page (fable-settings-staff.html) is the ONE place the real
// tokens are enumerated — EIGHT of them, plus `business.manage`, which canon's
// own roster comment names to explain why a 店舗管理者 cannot reach 事業構成 and
// which is NOT one of the eight (DIAL-HOME-MAP conflict (c)2). The room keeps
// canon's rail behaviour and says the honest thing rather than inventing it.

export type Capability =
  | 'staff.manage'
  | 'staff.invite'
  | 'settings.manage'
  | 'records.write'
  | 'customers.view'
  | 'analytics.viewAll'
  | 'billing.manage'
  | 'data.export'
  /** ⚠ NOT ONE OF THE EIGHT — see the note above. */
  | 'business.manage'

/** ⚠ THE READER NEVER SEES A TOKEN, AND THAT IS A RULING RATHER THAN A TASTE
 *  (⚖ 「plain names, never codes」). canon's mock prints `staff.manage` as a chip
 *  because canon is a developer artefact; this room prints what the permission
 *  DOES. The grid is canon's — eight switches, the same eight facts — wearing
 *  the product's own language. Deviation S9L-2, argued in the build report. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  'staff.manage': 'スタッフの管理',
  'staff.invite': 'スタッフの招待',
  'settings.manage': '設定の変更',
  'records.write': 'カルテの記録',
  'customers.view': '顧客の閲覧',
  'analytics.viewAll': '売上分析の閲覧（店舗全体）',
  'billing.manage': '契約・請求の管理',
  'data.export': 'データの書き出し',
  'business.manage': '事業構成の管理',
}

/** canon's own eight, in canon's own order (fable-settings-staff.html CAP_ORDER).
 *  `business.manage` is deliberately NOT here: a switch for a permission that
 *  does not exist would be the room inventing a contract. */
export const CAPABILITY_ORDER: readonly Capability[] = [
  'staff.manage',
  'staff.invite',
  'settings.manage',
  'records.write',
  'customers.view',
  'analytics.viewAll',
  'billing.manage',
  'data.export',
]

/** canon's FROZEN preset grants (fable-settings-staff.html PRESET_GRANTS, from
 *  the real app's ROLE_PRESETS), filtered to the eight tokens the grid shows. */
export const PRESET_GRANTS: Record<string, readonly Capability[]> = {
  owner: ['staff.manage', 'staff.invite', 'settings.manage', 'records.write', 'customers.view', 'analytics.viewAll', 'billing.manage', 'data.export'],
  manager: ['staff.manage', 'staff.invite', 'settings.manage', 'records.write', 'customers.view', 'analytics.viewAll', 'data.export'],
  senior: ['records.write', 'customers.view', 'analytics.viewAll', 'data.export'],
  practitioner: ['records.write', 'customers.view'],
  frontdesk: ['customers.view'],
}

export const PRESET_LABEL: Record<string, string> = {
  owner: 'オーナー',
  manager: '店舗管理者',
  senior: '主任',
  practitioner: '施術スタッフ',
  frontdesk: '受付',
}

/** The demo world's roles → the tokens they hold, THROUGH canon's own presets.
 *  An unknown role holds NOTHING, never a default grant. */
const PRESET_BY_ROLE: Record<string, string> = {
  オーナー: 'owner',
  店舗管理者: 'manager',
  スタッフ: 'practitioner',
}

/** ⚠ THE NINTH TOKEN, AND WHY IT IS NOT IN THE MATRIX (DIAL-HOME-MAP (c)2).
 *  `business.manage` gates 事業構成, and canon's staff page does NOT list it
 *  among the eight a store can switch — because it is not a store's to grant.
 *  canon's own roster comment reasons exactly that way about the demo persona:
 *  she is denied 事業構成 and 契約・請求, 「i.e. no business.manage, which rules
 *  out owner」. So an OWNER holds it, a 店舗管理者 does not, and the capability
 *  grid offers no switch for it. The room says that in the boundary sentence
 *  rather than inventing a permission somebody could be given. */
const OWNER_ONLY: readonly Capability[] = ['business.manage']

export interface SettingsAccess {
  has(cap: Capability): boolean
  /** The role's own word, kept so a boundary sentence can say WHO is reading. */
  role: string
}

export function accessFor(role: string): SettingsAccess {
  const preset = PRESET_BY_ROLE[role] ?? ''
  const held: readonly Capability[] = [
    ...(PRESET_GRANTS[preset] ?? []),
    ...(preset === 'owner' ? OWNER_ONLY : []),
  ]
  return { role, has: (cap) => held.includes(cap) }
}

// ── the rail ────────────────────────────────────────────────────────────────

/** ⚠ SCOPE IS THE GATE'S ONLY EXEMPTION, AND IT IS A PROPERTY OF THE SECTION.
 *  `self` = 「個人スコープ、権限ゲートなし」 (fable-settings-colors.html's own
 *  comment, and the same shape as 自分の音声登録). A self section is the reader's
 *  own preference: nobody's permission is involved, so no permission can hide it. */
export type SectionScope = 'store' | 'self'

export interface RailEntry {
  id: string
  /** canon's own five rail groups, verbatim. */
  group: string
  label: string
  scope: SectionScope
  /** The capability a STORE section needs, or null when canon itself says the
   *  page is open to everyone. Ignored entirely for `self`. */
  needs: Capability | null
}

/** THE RAIL, in canon's own order and grouping (the shared `cat-rail` markup
 *  every fable-settings-*.html page carries). Canon's NINETEEN entries, plus the
 *  two this room adds:
 *    · 顧客・連絡 — the map's row #14 asks for 「a NEW row under 顧客 / 連絡
 *      settings」 and canon has no page for it.
 *    · 自分の表示設定 — canon keeps it INSIDE 色・テーマ, under the same roof as
 *      store-wide colour policy. Neighbouring a store policy is exactly the
 *      arrangement the map's (d) gap breaks on, so this room gives it its own
 *      row and leaves it in the same group: the structure has to hold where it
 *      is hard, and a self-scoped row sitting between two gated ones is the
 *      proof (S9L-1).
 *
 *  ⚠ `live` IS GONE FROM THIS SHAPE. Every row is built; there is nothing left
 *  for the flag to mean. */
export const RAIL: readonly RailEntry[] = [
  { id: 'store-hours', group: '店舗運営', label: '店舗情報・営業時間', scope: 'store', needs: 'settings.manage' },
  // ⚖ S17 FOLD — 予約と確保, SECOND, right after 店舗情報・営業時間. It is #812's
  // whole room (PR #812, 2026-09-01) arriving as ONE section of this rail rather
  // than as a second 設定 route at the same path; `settings.manage` like its
  // neighbours, and the save-ROLE gate inside it is the store's own
  // `releaseHeldRoles` (A12).
  { id: 'booking-guard', group: '店舗運営', label: '予約と確保', scope: 'store', needs: 'settings.manage' },
  { id: 'services', group: '店舗運営', label: '提供内容', scope: 'store', needs: 'settings.manage' },
  { id: 'people-equipment', group: '店舗運営', label: '人・設備', scope: 'store', needs: 'settings.manage' },
  { id: 'payments', group: '店舗運営', label: '決済', scope: 'store', needs: 'settings.manage' },
  { id: 'customer-contact', group: '店舗運営', label: '顧客・連絡', scope: 'store', needs: 'settings.manage' },
  { id: 'business-structure', group: '店舗運営', label: '事業構成', scope: 'store', needs: 'business.manage' },
  { id: 'pricing-points', group: '料金・ポイント', label: '料金・ポイント', scope: 'store', needs: 'settings.manage' },
  { id: 'ai', group: 'Karute設定', label: 'AI設定', scope: 'store', needs: 'settings.manage' },
  // ⚠ canon's own words on the 録音設定 page: 「このページは誰でも開けます —
  // セクションごとに必要な権限が異なります」. So the PAGE is ungated and the
  // ORG block inside it carries the rights note, which is canon's gating rather
  // than ours (and a second, finer proof that the gate is not page-wide).
  { id: 'recording', group: 'Karute設定', label: '録音設定', scope: 'store', needs: null },
  { id: 'coaching', group: 'Karute設定', label: 'コーチング', scope: 'store', needs: 'settings.manage' },
  { id: 'sync', group: 'Karute設定', label: '予約同期', scope: 'store', needs: 'settings.manage' },
  { id: 'reserve-acceptance', group: 'Reserve設定', label: 'Reserve 受付', scope: 'store', needs: 'settings.manage' },
  { id: 'notifications', group: 'Reserve設定', label: '通知', scope: 'store', needs: 'settings.manage' },
  // canon gates スタッフ管理 on staff.manage OR staff.invite; the room takes the
  // stricter of the two it can express, which is the one the matrix edits with.
  { id: 'staff', group: '組織・管理', label: 'スタッフ管理', scope: 'store', needs: 'staff.manage' },
  { id: 'integrations', group: '組織・管理', label: '外部連携', scope: 'store', needs: 'settings.manage' },
  // canon: 「このページ自体は誰でも開けます — 実際にできる操作は、下の各セク
  // ションの権限によって決まります」.
  { id: 'data-io', group: '組織・管理', label: 'データ入出力', scope: 'store', needs: null },
  { id: 'audit-log', group: '組織・管理', label: '監査ログ', scope: 'store', needs: 'settings.manage' },
  { id: 'language-display', group: '組織・管理', label: '言語・表示', scope: 'store', needs: 'settings.manage' },
  { id: 'colors', group: '組織・管理', label: '色・テーマ', scope: 'store', needs: 'settings.manage' },
  { id: 'my-display', group: '組織・管理', label: '自分の表示設定', scope: 'self', needs: null },
  { id: 'billing', group: '組織・管理', label: '契約・請求', scope: 'store', needs: 'billing.manage' },
]

export type SectionGate = 'open' | 'no-rights'

/** THE GATE, AND IT IS ASKED ONE SECTION AT A TIME.
 *
 *  ⚠ THE FIRST LINE IS THE WHOLE STRUCTURAL DUTY (map (d)): a self-scoped
 *  section returns `open` before `access` is read, so no permission — present,
 *  absent or mis-wired — can reach it. There is deliberately no `gateOfPage`,
 *  no `pageGate` and no boolean the screen could hang the whole `<main>` on. */
export function gateOf(entry: RailEntry, access: SettingsAccess): SectionGate {
  if (entry.scope === 'self') return 'open'
  if (entry.needs === null) return 'open'
  return access.has(entry.needs) ? 'open' : 'no-rights'
}

export function sectionById(id: string): RailEntry | null {
  return RAIL.find((e) => e.id === id) ?? null
}

/** The section a desk opens on: the first one this reader may open. A reader who
 *  may reach nothing gets `null`, which the screen renders as the boundary
 *  rather than as a blank panel. */
export function firstOpenSection(access: SettingsAccess): RailEntry | null {
  return RAIL.find((e) => gateOf(e, access) === 'open') ?? null
}

// ── the guardrails ──────────────────────────────────────────────────────────
//
// ⚖ Liam 8/21, mistake-proofing: a store dial never ships without a DEFAULT and
// a GUARDRAIL against a store harming itself with it. Each clamp below is that
// guardrail, and the number it refuses to cross is stated in its own comment so
// the screen can print the same sentence the code enforces.

/** 再来促し. Under two weeks the nudge reaches customers who are simply not due
 *  yet; past a year it reaches people who have moved away. */
export const WIN_BACK_MIN = 14
export const WIN_BACK_MAX = 365
export function clampWinBackDays(days: number): number {
  return clampInt(days, WIN_BACK_MIN, WIN_BACK_MAX)
}

/** コーチングの保存期間, months. Under three months a trajectory has no baseline
 *  to be a trajectory against; past three years the record outlives the person
 *  it is about. */
export const RETENTION_MIN_MONTHS = 3
export const RETENTION_MAX_MONTHS = 36
export function clampCoachingRetention(months: number): number {
  return clampInt(months, RETENTION_MIN_MONTHS, RETENTION_MAX_MONTHS)
}

/** 判断に必要なセッション数. Room 8's own bar, carried by value with its cite:
 *  `coaching.ts FLOOR_MIN/FLOOR_MAX` on that branch. Below ten a coin flip
 *  becomes a verdict about a person; above sixty the board is switched off by
 *  the back door. */
export const COACHING_FLOOR_MIN = 10
export const COACHING_FLOOR_MAX = 60
export function clampCoachingFloor(sessions: number): number {
  return clampInt(sessions, COACHING_FLOOR_MIN, COACHING_FLOOR_MAX)
}

/** ⚠ A NON-FINITE INPUT IS NOT ZERO. `Math.min(NaN, …)` is NaN, and a NaN that
 *  reaches a screen prints as 「NaN日」 — so the clamp answers the LOW end for
 *  anything that is not a real number, which is the safe side of every dial
 *  above (the shortest window, the shortest retention, the smallest floor a
 *  guardrail allows). */
export function clampInt(raw: number, lo: number, hi: number): number {
  if (!Number.isFinite(raw)) return lo
  return Math.min(hi, Math.max(lo, Math.round(raw)))
}

// ── 自分の表示設定 (self scope) ──────────────────────────────────────────────

export const DENSITY_OPTIONS = ['spacious', 'standard', 'compact'] as const
export const EMPHASIS_OPTIONS = ['subtle', 'standard', 'strong'] as const
export type Density = (typeof DENSITY_OPTIONS)[number]
export type Emphasis = (typeof EMPHASIS_OPTIONS)[number]

export interface Prefs {
  density: Density
  emphasis: Emphasis
}
export const PREFS_DEFAULT: Prefs = { density: 'standard', emphasis: 'standard' }

/** ⚠ A STORED PREFERENCE IS UNTRUSTED INPUT. localStorage survives a rename, a
 *  half-finished round and another tab's older build, so a value that is no
 *  longer an option must fall back to the default rather than render a state
 *  this room has no styles for. */
export function readPrefs(raw: string | null): Prefs {
  if (!raw) return PREFS_DEFAULT
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return PREFS_DEFAULT
  }
  if (typeof parsed !== 'object' || parsed === null) return PREFS_DEFAULT
  const o = parsed as Record<string, unknown>
  return {
    density: DENSITY_OPTIONS.includes(o.density as Density) ? (o.density as Density) : PREFS_DEFAULT.density,
    emphasis: EMPHASIS_OPTIONS.includes(o.emphasis as Emphasis) ? (o.emphasis as Emphasis) : PREFS_DEFAULT.emphasis,
  }
}

// ── THE PAYLOAD'S VOCABULARY ────────────────────────────────────────────────
//
// ⚖ ONE CONTROL VOCABULARY FOR NINETEEN CANON PAGES. canon's family states every
// setting in the same handful of shapes — a segmented control, a switch, a
// select, a text/number/time field, a chip set, a colour swatch — and this room
// carries exactly those and no more. A twentieth bespoke block per page is how a
// settings page becomes unmaintainable; one grammar is how nineteen pages get
// built in one round and stay reviewable.
//
// EVERY CONTROL IS LIVE. `value` is the SEED the screen starts from; from the
// first press the value belongs to the screen's own state, the section goes
// dirty, and 保存 commits it — demo-locally, which the footnote says out loud.

export interface ControlOption {
  /** A machine id. Never rendered. */
  value: string
  label: string
  /** A colour swatch's own paint. Only `swatch` uses it. */
  hex?: string
}

export type ControlKind =
  | { kind: 'segment'; options: ControlOption[] }
  | { kind: 'switch'; onLabel: string; offLabel: string }
  | { kind: 'select'; options: ControlOption[] }
  | { kind: 'text'; placeholder?: string; maxLength?: number; required?: boolean }
  | { kind: 'number'; min: number; max: number; step: number; unit: string }
  | { kind: 'time' }
  /** ⚖ S17 · C2 — a calendar date, `YYYY-MM-DD`, which is the wire's own
   *  spelling for `StoreClosedDay.date`. The native control, so a phone gets its
   *  own picker and a keyboard gets its own typing, for no code (ladder rung 4). */
  | { kind: 'date'; min?: string }
  /** Multi-select. `value` is a string[].
   *  `grid` = these options are a FIXED SET OF FACTS about one subject (the
   *  capability rulebook's eight-per-person switches), so they lay out as a grid
   *  rather than ragging across the column. It is a property of the DATA — the
   *  set is closed and the same for every person — which is why it is declared
   *  here and not guessed from the control's id. */
  | { kind: 'chips'; options: ControlOption[]; grid?: boolean }
  | { kind: 'swatch'; options: ControlOption[] }
  /** ⚠ `numeric` IS A LAYOUT FACT, NOT A TYPE HINT. A readout carries either a
   *  MEASURE (¥0, 61日, 12か月, 20回) — which wants the big tabular figure a
   *  reader scans for — or a phrase (a role list), which at that size becomes a
   *  headline shouting over the section title. */
  | { kind: 'readout'; unit: string; numeric: boolean }

export type RowValue = string | string[] | boolean

export interface RowControl {
  /** Unique across the WHOLE page: it is the state key. */
  id: string
  /** The accessible name. A control inside a table row needs its row's subject
   *  in its own name, because a screen reader does not read the column header. */
  aria: string
  control: ControlKind
  value: RowValue
  /** canon's own inertness — 本部設定, 保険で固定, a flag that is off, a
   *  permission the reader does not hold. The reason is VISIBLE, never a
   *  tooltip, and it is canon refusing rather than this room refusing. */
  locked?: string
}

export interface Trio {
  base: string
  guardrail: string
  /** ⚖ 8/21's third part, and it prints ONLY where a ruling actually gave one.
   *  A null sentence on twelve rows is not the third part — it is noise standing
   *  where the guardrail should be read (DS9-10). */
  businessType?: string
}

export interface SettingsRow {
  id: string
  label: string
  description: string
  /** ⚖ S17 — ONE RULE ONE HOME. A row whose control moved to another section
   *  keeps its PLACE and points at the home, with a control that really
   *  navigates (a real button — ⚖ keyboard reach). The label never promises more
   *  than the destination can do: 「…で決めます」 + 「開く」, never 「ここで変更」. */
  link?: { label: string; sectionId: string }
  /** 事業全体 / この店舗 / 自分だけ — printed, never inferred by the reader.
   *  `null` on a row that is a list entry rather than a policy (a weekday, a
   *  menu, a person), where the block's own scope already answered it. */
  scopeLabel: string | null
  /** Read-only facts beside the label: 所要60分, 担当3名, ¥6,600. */
  meta: string[]
  controls: RowControl[]
  trio?: Trio
  /** ⚖ S17 · C1 — WHICH DAY THIS ROW IS, `Date.getDay()`'s numbering.
   *  Only the 営業時間 block's seven rows carry it. It exists so the wire
   *  payload can be read back off the rendered rows (`weekDaysOf`) rather than
   *  by parsing a control id, which would make the id format a contract. */
  weekday?: number
  /** ⚖ S17 STEP 1 — THE RECEIPT, BESIDE THE VALUE IT IS A RECEIPT FOR.
   *
   *  The room used to answer 「where did this number come from?」 in ONE trace
   *  card standing beside the whole section, which meant the reader had to hold
   *  a row in their head while they walked a list looking for its line. The
   *  card leaves the right column in this round (the jump list and the save
   *  state earn that width instead), and every receipt that names a row moves
   *  INTO that row, behind its 詳しく — evidence one line under the value.
   *
   *  ⚠ ONLY A RECEIPT THAT NAMES A ROW MOVES. A section-level fact (「このページ
   *  の権限」, 「保存先」) is not about any single row, and forcing it into one
   *  would put a true sentence under a false heading. Those stay in the
   *  section's own folded card — see `SettingsSection.aside`. */
  source?: string
}

export interface SettingsBlock {
  id: string
  title: string
  note: string
  /** 準備中 / 適用範囲: 組織全体 / 本部設定 — canon's own block-head chip. */
  flag?: string
  /** ⚖ S17 STEP 1 — the ONE block whose rows are a WEEK rather than a list.
   *
   *  営業時間 is seven rows that all answer the same three questions (営業する ·
   *  開始 · 終了), and stacked as ordinary rows that is twenty-one controls with
   *  no column to compare down. `week` renders the same rows as a seven-line
   *  table with 曜日 · 営業 · 開始 · 終了 heads, so a manager checking 「are we
   *  open on Thursdays」 reads one column instead of scanning seven rows.
   *
   *  It is a LAYOUT fact, so it lives on the block rather than in the screen: a
   *  second block that is a week states it here and gets the same shape. The
   *  rows themselves are unchanged — same ids, same controls, same order — so
   *  the value plane and every pin on it are untouched by the shape. */
  layout?: 'week'
  /** canon's inline 権限がありません strip, when the PAGE is open but the block
   *  is not (録音設定's org block, データ入出力's export). */
  rightsNote?: string
  rows: SettingsRow[]
  /** canon's `.fact-line` sentences. */
  facts: string[]
  /** A cross-reference that really navigates: the rail row it opens. */
  links: Array<{ label: string; sectionId: string }>
  /** canon's `.impact` / `.policy-list` — a rule the reader cannot change. */
  list: { title: string; items: string[] } | null
  /** A data table the reader reads rather than edits. `tags` drives the one
   *  filtered table in the room (監査ログ). */
  table: { head: string[]; rows: Array<{ cells: string[]; tags: string[] }> } | null
  /** The control ids whose values filter `table.rows` by tag. A value of `all`
   *  matches everything, which is how canon's own 全て option behaves. */
  filterBy: string[]
  /** THE DEAD-LEVER LAW, GENERALISED. `template` is resolved against the LIVE
   *  values, so a press really rewrites a sentence the reader is looking at —
   *  canon's own 「このページ内プレビュー」. `{control-id}` is substituted with
   *  that control's current LABEL. */
  preview: { template: string; attrs?: Record<string, string> } | null
  /** A block-level action button — canon's エクスポートする, 需要履歴をリセット,
   *  招待を送信する, 接続をリクエストする. Pressing it resolves `template` into
   *  the block's result line. `requires` names a chips control that must not be
   *  empty (canon's own 「対象を1つ以上選んでください」). */
  action: { label: string; template: string; requires?: string; requireError?: string } | null
  /** canon's 変更履歴 line. */
  audit: string | null
  /** ⚖ S17 · C2 — 臨時休業 IS A COLLECTION, BECAUSE THE WIRE IS A COLLECTION.
   *
   *  THE CONTRACT (@synqed-kk/client@1.34.0 dist/store-policies.d.ts:20-27):
   *    listClosedDays(storeId, range?) → { closed_days: StoreClosedDay[] }
   *    addClosedDay(storeId, input)    → StoreClosedDay   // HQ-gated; 409 when
   *                                                       // the date is already closed
   *    removeClosedDay(storeId, id, actingStaffId) → void
   *  and dist/types.d.ts:1081-1095:
   *    StoreClosedDay { id; store_id; date (YYYY-MM-DD); reason: string | null; … }
   *    AddClosedDayInput { date; reason?: string | null; acting_staff_id; audit? }
   *
   *  The first cut rendered this as two SEGMENTED ROWS offering 臨時休業 /
   *  特別営業 / 通常営業 per pre-existing date — which cannot express the wire at
   *  all: there is no way to add a date, no way to remove one, and 特別営業 is a
   *  value core has no field for (⚖ label truth: a control that names a value
   *  the store cannot save is a lie with a picture on it). It is an add/remove
   *  list, so it is rendered as one.
   *
   *  `null` on every other block. */
  collection: SettingsCollection | null
}

/** The list half of a block that adds and removes rows. */
export interface SettingsCollection {
  /** The store's rows, newest-first as the wire returns them. */
  items: Array<{ id: string; title: string; note: string }>
  /** What the 追加 row's two controls are called, so the screen reads the value
   *  map rather than guessing an id shape. */
  dateControlId: string
  reasonControlId: string
  addLabel: string
  removeLabel: string
  /** canon's own empty state, and it is a sentence rather than a blank box. */
  emptyLine: string
  /** ⚠ THE WIRE'S 409, SPOKEN BEFORE IT IS EARNED (⚖ mistake-proofing at the
   *  moment of the mistake): the room refuses a duplicate date itself, in the
   *  same words the server would answer with, rather than letting the operator
   *  press 追加 and find out later. */
  duplicateError: string
  /** The one field that must not be empty. */
  emptyDateError: string
}

export interface SettingsSection {
  id: string
  group: string
  label: string
  scope: SectionScope
  gate: SectionGate
  boundaryLine: string | null
  kicker: string
  title: string
  lead: string
  /** ⚖ S17 / A2 — ONE TOUR ENGINE, and this is how a section that arrived with
   *  its OWN walk keeps its own words. The screen declares the section head with
   *  `data-guide-title={title}` + `data-guide={guide ?? lead}`, so a section
   *  whose explanation is not simply its lead (予約と確保, which came from #812
   *  carrying a page-head declaration of its own) states it here instead of the
   *  screen growing a second engine to hold it. */
  guide?: string
  blocks: SettingsBlock[]
  aside: { title: string; lines: Array<{ label: string; value: string }>; note: string } | null
  /** `local` = this section's values round-trip through the reader's own
   *  browser, which is 自分の表示設定 and nothing else. */
  persist: 'local' | null
}

export interface RailRow {
  id: string
  group: string
  label: string
  state: 'open' | 'no-rights'
  scope: SectionScope
}

export interface SettingsProps {
  dateline: string
  lensLabel: string
  subtitle: string
  rail: RailRow[]
  railHeading: string
  sections: SettingsSection[]
  openingSectionId: string | null
  /** ⚠ ONE HONEST FOOTNOTE REPLACES SIXTEEN REFUSAL PARAGRAPHS. */
  demoSaveLine: string
  selfSaveLine: string
  boundaryFallback: string
  roleLabel: string
  /** ⚖ S17 STEP 1 — THE SAVE STAMP'S CLOCK, FORMATTED ON THE SERVER.
   *
   *  「保存しました」 without a time is a sentence a reader cannot check twice: it
   *  looks identical after the second save. The stamp needs an HH:MM, and this
   *  room's own family law is that the screen holds no clock and no formatter —
   *  so the PAGE'S pinned render clock is formatted here and the screen prints
   *  it. It also makes the shot deterministic, which a `new Date()` in the
   *  browser never is. */
  saveStampTime: string
}

// ── the value helpers the screen renders through ────────────────────────────

/** What a control's CURRENT value reads as, in words. One home, so a preview
 *  sentence and a save note can never spell the same choice differently. */
export function labelOfValue(control: ControlKind, value: RowValue): string {
  switch (control.kind) {
    case 'switch':
      return value ? control.onLabel : control.offLabel
    case 'segment':
    case 'select':
    case 'swatch':
      return control.options.find((o) => o.value === value)?.label ?? String(value)
    case 'chips': {
      const picked = Array.isArray(value) ? value : []
      if (picked.length === 0) return 'なし'
      return control.options.filter((o) => picked.includes(o.value)).map((o) => o.label).join('・')
    }
    case 'number':
      return `${String(value)}${control.unit}`
    default:
      return String(value)
  }
}

/** `{control-id}` → that control's current label. An id the block does not hold
 *  is left EXACTLY AS IT STANDS rather than blanked: a preview that silently
 *  drops a term is a sentence that lies about what it is describing, and the
 *  suite pins the untouched form. */
export function fillTemplate(template: string, label: (id: string) => string | null): string {
  return template.replace(/\{([a-z0-9.-]+)\}/gi, (whole, id: string) => label(id) ?? whole)
}

/** ⚠ ARRAY VALUES COMPARE BY CONTENT, NOT BY REFERENCE. A chips control whose
 *  selection is rebuilt on every render would be permanently dirty otherwise —
 *  a save button that can never go quiet is a save button nobody believes. */
export function sameValue(a: RowValue | undefined, b: RowValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i])
  return a === b
}

/** Every control id a section holds, in render order. */
export function controlIdsOf(section: SettingsSection): string[] {
  return section.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls.map((c) => c.id)))
}

// ── ⚖ S17 STEP 1 — FIND BY TYPING, AND THE INDEX IS THE PAGE'S OWN DATA ─────
//
// Twenty-two rows and three hundred-odd controls is past the size a reader can
// scan, and Apple's and Google's own settings apps answer that with a search
// field rather than with more grouping. The index is built FROM `sections` —
// every section's title and every one of its block titles — so there is no
// second list to keep in step: a block that renders is a block that is findable,
// and one that is deleted stops being findable in the same commit.

/** What a rail row matches on: its own label, its group, its section's title and
 *  every block title inside it. */
export function searchTextOf(row: RailRow, section: SettingsSection | null): string {
  const parts = [row.label, row.group]
  if (section) {
    parts.push(section.title)
    for (const b of section.blocks) parts.push(b.title)
  }
  return parts.join(' ')
}

/** ⚠ CASE-FOLDED, AND THAT IS FOR THE LATIN IN A JAPANESE PAGE. 「Reserve 受付」
 *  and 「AI設定」 are the row labels a reader types lowercase; Japanese is
 *  unaffected by the fold, so one comparison serves both. An empty query matches
 *  everything rather than nothing — a blank field is not a filter. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return haystack.toLowerCase().includes(q)
}

/** The block title that EXPLAINS a hit whose row label does not contain the
 *  query — 「休憩」 finds 店舗情報・営業時間 through its 予約ボードの操作 block, and
 *  the rail says so instead of looking like a mismatch. `null` when the row's
 *  own label already carries the query. */
export function blockHitOf(row: RailRow, section: SettingsSection | null, query: string): string | null {
  const q = query.trim()
  if (q === '' || section === null) return null
  if (matchesQuery(row.label, q)) return null
  return section.blocks.find((b) => matchesQuery(b.title, q))?.title ?? null
}

// ── ⚖ S17 STEP 1 — WHAT IS UNSAVED, PER BLOCK AND PER SECTION ───────────────
//
// The jump list dots a block that holds an unsaved change and the save state
// counts them, so both questions are asked of the same function rather than of
// two loops that can disagree about what 「changed」 means.

/** The control ids of ONE block, in render order. */
export function controlIdsOfBlock(block: SettingsBlock): string[] {
  return block.rows.flatMap((r) => r.controls.map((c) => c.id))
}

/** A block is dirty when any control inside it differs from what was saved. */
export function blockDirty(
  block: SettingsBlock,
  values: Record<string, RowValue>,
  saved: Record<string, RowValue>,
): boolean {
  return controlIdsOfBlock(block).some((id) => !sameValue(values[id], saved[id]))
}

/** ⚠ 変更 n件 COUNTS CONTROLS, AND THE LABEL SAYS SO (⚖ numbers explain
 *  themselves). Counting blocks would make one changed dial and eight changed
 *  dials both read 「1件」; counting controls is the number a reader can check
 *  against what they actually pressed. */
export function changedCount(
  section: SettingsSection,
  values: Record<string, RowValue>,
  saved: Record<string, RowValue>,
): number {
  return controlIdsOf(section).filter((id) => !sameValue(values[id], saved[id])).length
}

/** A section is dirty when any of its controls differs from what was saved. */
export function sectionDirty(
  section: SettingsSection,
  values: Record<string, RowValue>,
  saved: Record<string, RowValue>,
): boolean {
  return controlIdsOf(section).some((id) => !sameValue(values[id], saved[id]))
}

/** ⚖ MISTAKE-PROOFING AT THE MOMENT OF THE MISTAKE. A required field left empty
 *  blocks the save and says which field it is — canon's own 「店舗名を入力して
 *  ください（空欄では保存できません）」 — rather than saving a shop with no name.
 *  Returns the first blocking sentence, or null. */
export function blockingError(section: SettingsSection, values: Record<string, RowValue>): string | null {
  for (const block of section.blocks) {
    for (const row of block.rows) {
      for (const c of row.controls) {
        if (c.control.kind !== 'text' || !c.control.required) continue
        const v = values[c.id]
        if (typeof v === 'string' && v.trim() !== '') continue
        return `${row.label}が空欄です — 保存できません。`
      }
    }
  }
  return null
}

/** A number field, corrected on commit rather than while it is being typed: a
 *  clamp that fires per keystroke makes 「1」 unreachable on the way to 「14」.
 *  An empty or unreadable field answers the LOW end for the same reason
 *  `clampInt` does. */
export function commitNumber(raw: string, min: number, max: number): number {
  return clampInt(Number(raw), min, max)
}

// ── the tour card's room-local correction ───────────────────────────────────
//
// ⚠ ROOM-LOCAL CORRECTION to the SHARED engine's documented LAST RESORT, and it
// is the THIRD copy of one function in this family. That is stated plainly
// because it is a debt rather than a coincidence.
//
// `spotCardAt` (@/business/lib/guide) places the tour card below the target,
// else above it, else BESIDE it — and when a region has no free side at all its
// last resort is `Math.max(10, target.left - card.width - 12)`, which puts the
// card on top of the thing it is explaining. MEASURED on this room's own tip:
// at 1280 and 820 every step has a free side and the card never touches its
// target; at 390 a dial row is FULL WIDTH and taller than half the viewport, so
// neither side fits.
//
// The engine is ONE SHARED HOME for every Business page and the packet FREEZES
// it, so the correction lives here — the register room's D-M2 precedent (room-
// local now, engine fix queued), which カルテ cites for its own copy and
// コーチング carries a third. ⚠ THE PROMOTION IS OWED.
//
// It is deliberately the SMALLEST correction that fixes the real failure: the
// card keeps the x the engine chose, and only its TOP moves, to whichever
// viewport edge is farther from the target's heading zone. A card that does not
// sit over the heading is returned untouched, so every step with a free side
// still gets exactly the engine's own answer.
export function keepCardOffHeading(
  at: { top: number; left: number },
  card: { width: number; height: number },
  target: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  /** A row's heading lives in its first rows; 64px covers this room's own label
   *  line plus its scope chip at every band. */
  headingZone = 64,
): { top: number; left: number } {
  const zoneTop = target.top
  const zoneBottom = target.top + Math.min(headingZone, target.height)
  const overlapsX = at.left < target.left + target.width && at.left + card.width > target.left
  const overlapsHeading = at.top < zoneBottom && at.top + card.height > zoneTop
  if (!overlapsX || !overlapsHeading) return at
  const zoneMid = (zoneTop + zoneBottom) / 2
  const room = { top: zoneMid, bottom: viewport.height - zoneMid }
  const top = room.bottom >= room.top ? viewport.height - card.height - 10 : 10
  return { top: Math.max(10, top), left: at.left }
}

/** 分 as this family prints it. One home, so 15分 on a settings row and 15分 on
 *  the board are the same string by construction. */
export function minutesLabel(minutes: number): string {
  return `${minutes}分`
}

/** ¥ as this family prints it. */
export function yen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

/** ⚠ THE SEGMENTED CONTROL'S OPTION LIST HAS TO CONTAIN THE STORE'S OWN VALUE.
 *  canon rules that silently rounding a stored value to the nearest preset makes
 *  「現在値をプリセット」 a lie (fable-settings-store-hours.html:4218-4231). So a
 *  value outside the preset list is ADDED to it, in order, and the reader sees
 *  the truth rather than a nearby number. */
export function withCurrent(options: readonly number[], current: number): number[] {
  return options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b)
}

/** A minutes-from-midnight number as canon prints a time field's value. The
 *  world's planes hold minutes; a `time` control needs `HH:MM`. */
export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ══ ⚖ S17 · C1 — 営業時間 IS THE WIRE'S `weekly_hours`, AND IT IS PER DAY ════
//
// THE CONTRACT, mirrored BY SHAPE with its cite (⚖ C0 — Business reaches core
// nowhere in this round; the swap to `StorePolicyClient.set` is the deliberate
// reconnect PR):
//
//   @synqed-kk/client@1.34.0 dist/types.d.ts:1047-1050
//     export type WeeklyHours = Partial<Record<
//       'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun',
//       { open: string; close: string } | null>>
//     /** One open/close window per weekday ("10:00"–"20:00"); null/absent
//      *  weekday = 定休日 (regular weekly closed day). */
//   …:1062  StoreBookingPolicy.weekly_hours: WeeklyHours | null
//   …:1076  SetStoreBookingPolicyInput.weekly_hours?: WeeklyHours | null
//           /** undefined = keep; null = clear back to unconfigured; object = set. */
//
// ⚠ THE TWO NULLS ARE DIFFERENT NULLS, AND CONFUSING THEM IS A DATA LOSS.
// `weekly_hours[day] = null` says 「this store is closed on Mondays」.
// `weekly_hours = null` says 「this store has never configured hours at all」,
// which switches the whole hours filter off. A screen that answered 「the store
// is closed every day」 by clearing the object would silently open the store's
// booking window to every hour of every day. So the payload below can produce
// a null DAY and can never produce a null OBJECT.
//
// ⚠ AND THE ROOM DOES NOT STATE THE SEVEN DAYS ANYWHERE. `fixtures-today` holds
// this world's ONE open/close pair plus its closed weekday, which is what the
// board and Reserve read; a second, seven-day copy in the settings plane would
// be the two-homes defect the room exists to avoid. The seven days are DERIVED
// from that pair, once, at the plane boundary — `weeklyHoursFrom` below.

/** The wire's own weekday keys, in the order a Japanese week is read. */
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

/** One day's window, or `null` for 定休日 — the wire's own shape. */
export type DayHours = { open: string; close: string } | null
export type WeeklyHours = Partial<Record<WeekdayKey, DayHours>>

/** ⚠ THE ROOM'S DAY NUMBERS ARE `Date.getDay()`'s (0 = 日), because that is what
 *  `fixtures-today.closedWeekday` speaks and what every control id in the
 *  営業時間 block is keyed by. The wire speaks weekday NAMES. One table, so the
 *  two vocabularies meet in exactly one place. */
export const WEEKDAY_OF: Record<number, WeekdayKey> = {
  1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 0: 'sun',
}

/** The seven days this world actually has, derived ONCE from the pair the board
 *  reads. The closed weekday becomes `null` — 定休日 — and every other day
 *  carries the store's own window. */
export function weeklyHoursFrom(open: string, close: string, closedWeekday: number): WeeklyHours {
  const out: WeeklyHours = {}
  for (const [num, key] of Object.entries(WEEKDAY_OF)) {
    out[key] = Number(num) === closedWeekday ? null : { open, close }
  }
  return out
}

/** WHAT THE RECONNECT PR WILL SEND, built from what the reader actually did.
 *
 *  `open`/`close` are the two `time` controls of that day's row and `on` is its
 *  営業する switch: OFF emits `null` for that DAY (定休日) and keeps every other
 *  day's window untouched. The suite pins both halves — a store with 月曜 OFF
 *  renders 定休日 and produces `weekly_hours.mon === null` — because the shape
 *  is the whole of what 「the contract is correct」 means before the reconnect. */
export function weeklyHoursPayload(
  days: ReadonlyArray<{ day: number; on: boolean; open: string; close: string }>,
): WeeklyHours {
  const out: WeeklyHours = {}
  for (const d of days) {
    const key = WEEKDAY_OF[d.day]
    if (key === undefined) continue
    out[key] = d.on ? { open: d.open, close: d.close } : null
  }
  return out
}

/** Read one 営業時間 block's live values back into the payload's input shape.
 *  The control ids are the block's own (`<prefix>.day-3` / `.open-3` / `.close-3`),
 *  which is why the row carries its day number in `weekday`. */
export function weekDaysOf(
  block: SettingsBlock,
  values: Record<string, RowValue>,
): Array<{ day: number; on: boolean; open: string; close: string }> {
  const out: Array<{ day: number; on: boolean; open: string; close: string }> = []
  for (const row of block.rows) {
    if (row.weekday === undefined) continue
    const sw = row.controls.find((c) => c.control.kind === 'switch')
    const times = row.controls.filter((c) => c.control.kind === 'time')
    out.push({
      day: row.weekday,
      on: sw ? values[sw.id] === true : true,
      open: String(values[times[0]?.id ?? ''] ?? ''),
      close: String(values[times[1]?.id ?? ''] ?? ''),
    })
  }
  return out
}
