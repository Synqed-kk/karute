// 設定 — THE ROOM'S RULES, AS PURE FUNCTIONS.
//
// Nothing here reads data, holds state or knows React (the family's plane/lib/
// screen split, and `foundation.test.ts`'s import inventory is the pin). The
// props file joins these rules to the world's planes; the screen renders the
// answer.
//
// ══ THE ONE STRUCTURAL DUTY THIS ROOM WAS BUILT FOR ═════════════════════════
//
// ⚠ GATING IS SECTION-SCOPED BY CONSTRUCTION. The DIAL-HOME-MAP's (d) finding
// names the real gap in canon: every gated settings page uses ONE page-wide
// `boundaryPanel` div, so a personal preference that happens to sit beside a
// store policy is gated along with it — 「positional discipline, not a rule the
// markup enforces」. colors.html gets away with it because 自分の表示設定 sits
// physically after the boundary markup in the DOM.
//
// Here the check CANNOT be page-wide, because there is no page-level gate to
// write: `gateOf` takes ONE SECTION and returns that section's own answer, and
// its first line returns `open` for a self-scoped section WITHOUT LOOKING AT
// ACCESS AT ALL. A future builder who wants to gate the whole page has to delete
// that line, and the suite's mutation battery kills exactly that edit.
//
// ══ THE CAPABILITY VOCABULARY ═══════════════════════════════════════════════
//
// canon's スタッフ管理 page (fable-settings-staff.html) is the ONE place the real
// tokens are enumerated — eight of them. This room spends three:
//   · `settings.manage`  — the blanket settings token every gated canon page
//                          cites. There is no PER-SECTION settings capability
//                          today; that is registry ② and the map's conflict (c)1.
//   · `billing.manage`   — owner-only, canon's own gate on 契約・請求.
//   · `business.manage`  — ⚠ NOT ONE OF THE EIGHT. canon's roster comment names
//                          it to explain why a 店舗管理者 cannot reach 事業構成,
//                          and the map's conflict (c)2 is that it does not
//                          exist. The room keeps canon's rail behaviour and says
//                          the honest thing in the refusal rather than inventing
//                          a token or pretending the row is reachable.

export type Capability = 'settings.manage' | 'billing.manage' | 'business.manage'

/** The demo world's roles → the tokens they hold. The signed-in persona is a
 *  店舗管理者 (`fixtures.operator.role`), and canon's own preset table is where
 *  these come from — an unknown role holds NOTHING, never a default grant. */
const TOKENS_BY_ROLE: Record<string, readonly Capability[]> = {
  オーナー: ['settings.manage', 'billing.manage'],
  店舗管理者: ['settings.manage'],
  スタッフ: [],
}

export interface SettingsAccess {
  has(cap: Capability): boolean
  /** The role's own word, kept so a refusal can say WHO is reading. */
  role: string
}

export function accessFor(role: string): SettingsAccess {
  const held = TOKENS_BY_ROLE[role] ?? []
  return { role, has: (cap) => held.includes(cap) }
}

// ── the rail ────────────────────────────────────────────────────────────────

/** ⚠ SCOPE IS THE GATE'S ONLY EXEMPTION, AND IT IS A PROPERTY OF THE SECTION.
 *  `self` = 「個人スコープ、権限ゲートなし」 (fable-settings-colors.html:492's own
 *  comment, and the same shape as 自分の音声登録). A self section is the reader's
 *  own preference: nobody's permission is involved, so no permission can hide it. */
export type SectionScope = 'store' | 'self'

export interface RailEntry {
  id: string
  /** canon's own five rail groups, verbatim. */
  group: string
  label: string
  scope: SectionScope
  /** The capability a STORE section needs, or null when it needs none. Ignored
   *  entirely for `self`. */
  needs: Capability | null
  /** false = the section is designed but carries no dial yet (準備中). */
  live: boolean
}

/** THE RAIL, in canon's own order and grouping (fable-settings-*.html's shared
 *  sidebar markup). Eighteen canon entries plus 契約・請求, and ONE this room
 *  adds: 顧客・連絡, the home the map's row #14 asks for.
 *
 *  ⚖ BIG-TECH SIMPLICITY: an entry that carries no dial yet is NOT deleted and
 *  NOT an option wall — it opens a designed 準備中 panel that says what will live
 *  there. Canon's IA is the product's IA; a rail that shrinks and grows between
 *  releases is a rail nobody learns. */
export const RAIL: readonly RailEntry[] = [
  { id: 'store-hours', group: '店舗運営', label: '店舗情報・営業時間', scope: 'store', needs: 'settings.manage', live: true },
  { id: 'services', group: '店舗運営', label: '提供内容', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'people-equipment', group: '店舗運営', label: '人・設備', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'payments', group: '店舗運営', label: '決済', scope: 'store', needs: 'settings.manage', live: true },
  { id: 'customer-contact', group: '店舗運営', label: '顧客・連絡', scope: 'store', needs: 'settings.manage', live: true },
  { id: 'business-structure', group: '店舗運営', label: '事業構成', scope: 'store', needs: 'business.manage', live: false },
  { id: 'pricing-points', group: '料金・ポイント', label: '料金・ポイント', scope: 'store', needs: 'settings.manage', live: true },
  { id: 'ai', group: 'Karute設定', label: 'AI設定', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'recording', group: 'Karute設定', label: '録音設定', scope: 'store', needs: 'settings.manage', live: true },
  { id: 'coaching', group: 'Karute設定', label: 'コーチング', scope: 'store', needs: 'settings.manage', live: true },
  { id: 'sync', group: 'Karute設定', label: '予約同期', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'reserve-acceptance', group: 'Reserve設定', label: 'Reserve 受付', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'notifications', group: 'Reserve設定', label: '通知', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'staff', group: '組織・管理', label: 'スタッフ管理', scope: 'store', needs: 'settings.manage', live: true },
  { id: 'integrations', group: '組織・管理', label: '外部連携', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'data-io', group: '組織・管理', label: 'データ入出力', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'audit-log', group: '組織・管理', label: '監査ログ', scope: 'store', needs: 'settings.manage', live: false },
  { id: 'language-display', group: '組織・管理', label: '言語・表示', scope: 'store', needs: 'settings.manage', live: true },
  // ⚠ THE ONE SELF-SCOPED SECTION, and it sits in the middle of the gated ones on
  // purpose: canon's own 自分の表示設定 lives INSIDE colors.html, under the same
  // roof as store-wide colour policy. Neighbouring a store policy is exactly the
  // arrangement the map's (d) gap breaks on, so this room puts it there rather
  // than tucking it somewhere safe — the structure has to hold where it is hard.
  { id: 'my-display', group: '組織・管理', label: '自分の表示設定', scope: 'self', needs: null, live: true },
  { id: 'billing', group: '組織・管理', label: '契約・請求', scope: 'store', needs: 'billing.manage', live: false },
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

/** The section a desk opens on: the first one that is both live and reachable.
 *  A reader who may reach nothing gets `null`, which the screen renders as the
 *  boundary rather than as a blank panel. */
export function firstOpenSection(access: SettingsAccess): RailEntry | null {
  return RAIL.find((e) => e.live && gateOf(e, access) === 'open') ?? null
}

// ── the guardrails ──────────────────────────────────────────────────────────
//
// ⚖ Liam 8/21, mistake-proofing: a dial never ships without a DEFAULT and a
// GUARDRAIL against a store harming itself with it. Each clamp below is that
// guardrail, and the number it refuses to cross is stated in its own comment so
// the screen can print the same sentence the code enforces.

/** 再来促し (dial #14). Under two weeks the nudge reaches customers who are
 *  simply not due yet; past a year it reaches people who have moved away. */
export const WIN_BACK_MIN = 14
export const WIN_BACK_MAX = 365
export function clampWinBackDays(days: number): number {
  return clampInt(days, WIN_BACK_MIN, WIN_BACK_MAX)
}

/** コーチングの保存期間 (dial #22), months. Under three months a trajectory has
 *  no baseline to be a trajectory against; past three years the record outlives
 *  the person it is about. */
export const RETENTION_MIN_MONTHS = 3
export const RETENTION_MAX_MONTHS = 36
export function clampCoachingRetention(months: number): number {
  return clampInt(months, RETENTION_MIN_MONTHS, RETENTION_MAX_MONTHS)
}

/** 判断に必要なセッション数 (dial #23). Room 8's own bar, carried by value with
 *  its cite: `coaching.ts FLOOR_MIN/FLOOR_MAX` on that branch. Below ten a coin
 *  flip becomes a verdict about a person; above sixty the board is switched off
 *  by the back door. */
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
function clampInt(raw: number, lo: number, hi: number): number {
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

// ── the registry, and the refusals that name it ─────────────────────────────
//
// ⚖ EVERY REFUSAL SAYS WHY IN ITS OWN WORDS AND CARRIES THE SEAM IT WAITS ON
// (the room-6/8 law). One generic sentence on sixteen dials tells the reader
// nothing about which of them would have done what — and the sentence on the
// screen is the same sentence the Anthony ask is written from. The seam rides
// BESIDE the sentence rather than inside it; the note on `REGISTRY` below is why.

// ⚠ WHAT IS DELIBERATELY *NOT* ON THIS RAIL, AND WHY (⚖ DS-4, and the map's own
// conflict (c)4). The board's per-feature kill switches — drag verdicts, the
// block advisor, crumb-coalescing offers — are ENGINEERING ROLLBACK LEVERS, not
// decisions a shop owner makes about their business. Putting them on the rail
// would be the option wall big-tech simplicity forbids, and would ask a
// receptionist to rule on a question that is not theirs. They belong to the
// standing 「discovered surfaces ship disconnected behind named off-switches,
// default OFF, one registry」 rule, on a NON-RAIL advanced surface that is
// RECONNECT-ERA work — so this room mints no registry line for them and shows no
// row. There is deliberately nothing to find here; that is the decision, not an
// omission.

// ⚠ THE REGISTRY LINE IS DATA BESIDE THE SENTENCE, NEVER A STRING INSIDE IT —
// AND THAT IS THE RECURRENCE FIX, NOT A TIDY-UP (NS9-1 / DS9-4, the room-8 N8-1
// class). The first cut closed all sixteen refusals AND the 事業構成 boundary
// line with 「（登録: ①店舗ポリシーの保存）」: an internal build-registry citation
// printed to a shop owner seventeen times, in VISIBLE copy and — through
// `refused()`'s `aria-label` — in the accessible name a screen reader speaks
// aloud on every focus. ⚖ 「plain names, never codes」 forbids exactly that, and
// this room's own sheet already states the rule for the trio beside it
// (settings.css: 「NO CODES, AND THAT IS A RULE RATHER THAN A TASTE」).
//
// The root cause was the shape, not the wording: while the seam's tie to a dial
// was a SUBSTRING of the reader's sentence, every refusal had to carry the code
// to stay pinnable. So the tie is now a FIELD the screen never renders. The
// reader gets a sentence in their own words; the census still proves that every
// dial names one of the eight lines and that all eight are spent; and there is
// no string left for a tag to ride out on. The suite's tag-leak mutant is the
// guard that keeps it that way.
//
// The circled numbers live HERE, in comments, and in the build report and the
// Anthony ask — where a number is a number rather than a code stapled onto a
// sentence a receptionist has to read.
export const REGISTRY = {
  /** ① */ storePolicyWrite: '店舗ポリシーの保存',
  /** ② */ settingsTokens: '設定の権限トークン',
  /** ③ */ coachingOrgSettings: 'コーチングの店舗設定',
  /** ④ */ transcriptEnforcement: '文字起こしの公開範囲の実装',
  /** ⑤ */ winBackCore: '再来促しのしきい値',
  /** ⑥ */ cashToleranceWrite: '現金差異の承認しきい値',
  /** ⑦ */ displayLanguage: '表示言語',
  /** ⑧ */ dynamicPricingMaster: '動的価格の店舗設定',
} as const

/** The eight seams, as a type — so a refusal cannot wait on a line that is not
 *  one of them, and a ninth line cannot appear without the census noticing. */
export type RegistryLine = keyof typeof REGISTRY

export type DialId =
  | 'guard-mode'
  | 'booking-step'
  | 'block-step'
  | 'min-sellable'
  | 'breaks-paid'
  | 'override-rights'
  | 'settings-rights'
  | 'cash-tolerance'
  | 'win-back'
  | 'dynamic-pricing'
  | 'transcript-visibility'
  | 'coaching-enabled'
  | 'coaching-sharing'
  | 'coaching-retention'
  | 'coaching-floor'
  | 'display-language'

/** A refusal is the SENTENCE the reader gets and the SEAM it waits on, kept
 *  apart on purpose (see the registry note above). Only `text` ever reaches a
 *  screen; `seam` is what the census, the build report and the Anthony ask are
 *  written from. */
interface Refusal {
  seam: RegistryLine
  text: string
}

// ⚠ 「サーバー側」 IS NOT A WORD THIS APP USES (NS9-3). It appeared SEVEN times in
// this room — four here, three in the props file — and nowhere else in the
// product, in a page that otherwise reaches for plain business language. The room's own idiom is 「データの入口 / データの側」 —
// which also says the thing that matters: the check cannot live in the screen,
// because a screen can only hide, not protect.
const REFUSAL: Record<DialId, Refusal> = {
  'guard-mode': {
    seam: 'storePolicyWrite',
    text: '見本データのためスキマガードの設定を変えられません。オン・オフと厳しさは店舗ごとのポリシーで、いま画面が出している値は「今日の運営」が実際に使っている値です。保存先をつないだあとに変更できます。',
  },
  'booking-step': {
    seam: 'storePolicyWrite',
    text: '見本データのため予約の移動単位を変えられません。この刻みはボードのドラッグとReserveに同時に効く店舗ポリシーのため、保存先をつないだあとに変更できます。',
  },
  'block-step': {
    seam: 'storePolicyWrite',
    text: '見本データのため予定ブロックの移動単位を変えられません。休憩や清掃の刻みは店舗ポリシーのため、保存先をつないだあとに変更できます。',
  },
  'min-sellable': {
    seam: 'storePolicyWrite',
    text: '見本データのため販売可能な最小の長さを変えられません。この長さより短い空きをお店として売りに出すかどうかの判断のため、保存先をつないだあとに変更できます。',
  },
  'breaks-paid': {
    seam: 'storePolicyWrite',
    text: '見本データのため休憩の有給扱いを変えられません。この設定は人件費の金額そのものを動かすため、金額を見られる権限とあわせて、データの側で判定する必要があります。',
  },
  'override-rights': {
    seam: 'settingsTokens',
    text: 'この画面からは上書き権限を変えられません。「置けない」場所に置ける役職とスタッフの指定は、権限そのものを配る操作です。いまの権限の一覧に上書き用の項目がなく、項目を増やすところから必要になります。',
  },
  'settings-rights': {
    seam: 'settingsTokens',
    text: 'この画面からは設定の権限を変えられません。いまは「設定を変更できる」というひとつの権限ですべての設定ページをまとめて開いており、ページごとに分けるには権限の項目を増やす必要があります。',
  },
  'cash-tolerance': {
    seam: 'cashToleranceWrite',
    text: '見本データのため現金差異の承認しきい値を変えられません。この金額は理由なしで通せる差異の上限で、レジの締めがそのまま読んでいる値です。保存先をつないだあとに変更できます。',
  },
  'win-back': {
    seam: 'winBackCore',
    // ⚠ 「core」 IS AN INTERNAL BACKEND CODENAME (NS9-2) and a salon owner has
    // never heard it. The fact the reader needs is that the number has ONE home
    // both doors read — which is sayable without naming a system.
    text: '見本データのため再来促しの日数を変えられません。この日数はカルテと共通のひとつの値です。二か所に分かれないよう、両方が読むひとつの置き場所を用意してから変更できるようにします。',
  },
  'dynamic-pricing': {
    seam: 'dynamicPricingMaster',
    text: '見本データのため動的価格を切り替えられません。店舗全体の切り替え自体がまだ存在せず、いまの割引の深さは料金表から計算しています。',
  },
  'transcript-visibility': {
    seam: 'transcriptEnforcement',
    text: '見本データのため文字起こしの公開範囲を変えられません。誰が文字起こしを読めるかはデータの入口で判定する必要があり、画面側の切り替えだけでは守れません。',
  },
  'coaching-enabled': {
    seam: 'coachingOrgSettings',
    text: '見本データのためコーチングの利用を切り替えられません。オン・オフは店舗ごとの申し込みの記録のため、店舗設定の保存先をつないだあとに変更できます。',
  },
  'coaching-sharing': {
    seam: 'coachingOrgSettings',
    text: '見本データのため共有の方針を変えられません。共有はスタッフ本人が許可するもので、許可の記録と取り消しをデータの側に持つ必要があります。',
  },
  'coaching-retention': {
    seam: 'coachingOrgSettings',
    text: '見本データのため記録の保存期間を変えられません。保存期間は記録を消す操作につながるため、店舗設定の保存先をつないだあとに変更できます。',
  },
  'coaching-floor': {
    seam: 'coachingOrgSettings',
    text: '見本データのため判断に必要なセッション数を変えられません。この数はスタッフの区分を出してよいかどうかの境目のため、店舗設定の保存先をつないだあとに変更できます。',
  },
  'display-language': {
    seam: 'displayLanguage',
    text: '見本データのため表示言語を変えられません。この画面の言葉はまだ日本語で書き込まれており、すべての画面を言語に対応させる作業をこれから行います。',
  },
}

export function refusalFor(dial: DialId): string {
  return REFUSAL[dial].text
}

/** The seam a dial waits on. The census is proved from THIS rather than from a
 *  substring of the reader's sentence — which is what let the code into the copy
 *  in the first place. */
export function seamFor(dial: DialId): RegistryLine {
  return REFUSAL[dial].seam
}

// ── the tour card's room-local correction ───────────────────────────────────
//
// ⚠ ROOM-LOCAL CORRECTION to the SHARED engine's documented LAST RESORT, and it
// is the THIRD copy of one function in this family. That is stated plainly
// because it is now a debt rather than a coincidence.
//
// `spotCardAt` (@/business/lib/guide) places the tour card below the target,
// else above it, else BESIDE it — and when a region has no free side at all its
// last resort is `Math.max(10, target.left - card.width - 12)`, which puts the
// card on top of the thing it is explaining. MEASURED on this room's own tip:
// at 1280 and 820 every step has a free side and the card never touches its
// target; at 390 a dial row is FULL WIDTH and ~340px tall inside an 844px
// viewport, so neither side fits and all five board dials were covered.
//
// The engine is ONE SHARED HOME for every Business page and the packet FREEZES
// it for this round, so the correction lives here — the register room's D-M2
// precedent (room-local now, engine fix queued), which カルテ cites for its own
// copy and コーチング carries a third. ⚠ THE PROMOTION IS OWED: three rooms with
// one correction is the trigger, and it is named in the build report rather than
// taken in a packet that forbids touching `guide.ts`.
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

/** ⚠ THE SEGMENTED CONTROL'S OPTION LIST HAS TO CONTAIN THE STORE'S OWN VALUE.
 *  canon rules that silently rounding a stored value to the nearest preset makes
 *  「現在値をプリセット」 a lie (fable-settings-store-hours.html:4218-4231). So a
 *  value outside the preset list is ADDED to it, in order, and the reader sees
 *  the truth rather than a nearby number. */
export function withCurrent(options: readonly number[], current: number): number[] {
  return options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b)
}
