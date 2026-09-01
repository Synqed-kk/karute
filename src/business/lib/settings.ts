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
  /** Multi-select. `value` is a string[]. */
  | { kind: 'chips'; options: ControlOption[] }
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
  /** 事業全体 / この店舗 / 自分だけ — printed, never inferred by the reader.
   *  `null` on a row that is a list entry rather than a policy (a weekday, a
   *  menu, a person), where the block's own scope already answered it. */
  scopeLabel: string | null
  /** Read-only facts beside the label: 所要60分, 担当3名, ¥6,600. */
  meta: string[]
  controls: RowControl[]
  trio?: Trio
}

export interface SettingsBlock {
  id: string
  title: string
  note: string
  /** 準備中 / 適用範囲: 組織全体 / 本部設定 — canon's own block-head chip. */
  flag?: string
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
