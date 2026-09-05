// コーチング — the room's PROP ASSEMBLY, beside the page rather than inside it
// (the room-3 F1 law): the evidence harness imports THIS function, so an
// isolated shot runs the same assembly the deployed route does and a drift
// between them is a compile error rather than a picture nobody can check.
//
// EVERY DATE AND EVERY MONTH CROSSES THE CLIENT BOUNDARY AS A FORMATTED STRING.
// The screen holds no clock and no formatter, so no timezone and no locale can
// drift between the two renders — and every month-dependent assertion about this
// room runs on a PINNED clock in the suite, which is the 9/1 lesson: a
// month-dependent assertion taken on the real clock is a test that passes 28
// days out of 31.
//
// ⚠ THE TWO REDACTIONS HAPPEN ABOVE THIS FILE, IN `coaching.ts`.
//   (1) The module gate is asked BEFORE the plane is read, so a store with
//       coaching switched off has no coaching data in its payload to hide.
//   (2) The team board is only BUILT for a reader who holds `analytics.viewAll`
//       — `team` is null otherwise, so a colleague's band never reaches a staff
//       member's payload, and no per-staff NUMBER reaches anyone's, because
//       `TriageRow` has no field for one.
//
// ⚠ AND TWO FIELDS ARE COMPOSED HERE RATHER THAN STATED IN THE PLANE, both for
// the same reason: the demo world is dated RELATIVE TO TODAY, so a fixed string
// would be a date this world is not on.
//   · personal-findings.ts:219 `window.date_range` — composed from the clock.
//   · contract.ts:49 `MetricPoint.periodStart` — the month ticks, likewise.
// The COUNTS behind both are the run's own; only the dates are the clock's.

import { jstYmd } from '@/business/lib/clock'
import {
  accessFor,
  buildModuleLibrary,
  buildPatternLibrary,
  buildRoi,
  buildSelfView,
  buildTriage,
  BAND_LABEL,
  CONSENT_STATE,
  effectiveRole,
  focusAreaFrequency,
  HELP_REFUSAL,
  isRolePreviewEnabled,
  maturityNote,
  moduleOn,
  PREVIEW_ROLES,
  resolveVisibility,
  sampleFloor,
  STATUS_BODY,
  STATUS_TITLE,
  type RoiLift,
  type SelfState,
  type TriageView,
} from '@/business/lib/coaching'
import { defaultStoreId, listStaff, listStoreOptions, renderNow, type StoreLens } from '@/business/lib/data'
import { operator } from '@/business/lib/fixtures'
import {
  coachingConsent,
  coachingPolicy,
  coachingStaff,
  coachingStores,
  learningModules,
  patternLibrary,
  patternLibraryNote,
  storeRoi,
  teamPatterns,
  type FixtureCoachingStaff,
  type FixtureConsentRecord,
} from '@/business/lib/fixtures-coaching'
import type { CoachingProps } from './CoachingScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const fmtMonth = new Intl.DateTimeFormat('ja-JP', { month: 'long', ...JST })

/** The analysis window, in days. ⚖ A ROLLING WINDOW, NOT A CALENDAR MONTH, and
 *  the deviation is argued in the build report (C8-3): the phone's own words are
 *  「今月の気づき」, but a coaching spine that empties every time a calendar month
 *  turns over is an instrument that is broken on the 1st and the 2nd — exactly
 *  the rollover that took two of room 6's tests red on 9/1. A rolling window
 *  never has that day, and ⚖ 8/25 is satisfied by SAYING which window it is on
 *  the screen rather than by leaving 「今月」 to mean whatever the date is. */
const WINDOW_DAYS = 90

/** ⚖ EVERY REFUSAL SAYS WHY IN ITS OWN WORDS, AND NAMES THE SEAM IT IS WAITING
 *  ON — IN THE CODE. One generic sentence on six controls tells the reader
 *  nothing about which of them would have done what.
 *
 *  ⚠ THE SEAM IS NAMED HERE, NOT IN THE SENTENCE. Each reason used to end with
 *  a build-tracking tag — 「（登録: ②コーチング生成）」 — on a sentence a salon
 *  manager reads, and `refused()` folds that whole sentence into the button's
 *  accessible NAME, so a screen reader voiced the ticket code on every disabled
 *  control. ⚖ plain names: a reader is not owed our vocabulary. The registry
 *  line stays beside the string it belongs to, so the sentence on the screen
 *  and the Anthony ask in build-report §9 are still the same seam:
 *
 *    regenerate → 登録 ②コーチング生成
 *    share      → 登録 ③同意の実保存
 *    depth      → 登録 ④深掘り共有の権限
 *    settings   → 登録 ⑤店舗設定ダイヤル
 *    consent    → 登録 ③同意の実保存
 *    deletion   → 登録 ③同意の実保存
 *
 *  ⚠ ONE WORD FOR THE SAMPLE STATE. The shell's own honesty chip says
 *  ◈ サンプルデータ and this room's dateline says サンプルデータ; these
 *  sentences said 見本データ for the identical thing, three lines apart on one
 *  screen. The Business family still says 見本データ in its other rooms' refusal
 *  copy — a one-word family sweep is owed and is named in the build report. */
const REFUSAL = {
  regenerate:
    'サンプルデータのため気づきを作り直せません。作り直しはあなたのセッションをAIにかけ直す操作で、料金の発生する処理のため、実データとAIの接続後に有効になります。',
  share:
    'サンプルデータのため共有の設定を変えられません。この切り替えはあなた自身が許可を出す記録で、取り消しも履歴も残る操作のため、同意の保存をつないだあとに有効になります。',
  depth:
    'サンプルデータのため詳しい内容を開けません。スタッフが許可した範囲だけを開く仕組みはサーバー側で判定する必要があるため、権限の実装後に有効になります。',
  settings:
    'サンプルデータのためコーチングの設定を変えられません。オン・オフ、共有の方針、記録の保存期間は店舗ごとの設定のため、設定画面の接続後に有効になります。',
  // ⚖ THE LOOK-FIX ROUND'S TWO NEW LEVERS GET THEIR OWN SENTENCES, because the
  // rule above is not decoration: one generic reason on eight controls tells a
  // reader nothing about which of them would have done what. Both are legal
  // records and both wait on the SAME seam as `share` — 登録 ③同意の実保存 —
  // but they are different acts and they say so.
  consent:
    'サンプルデータのため同意の記録を残せません。同意するかどうかはあなた自身の決定として保存され、いつ・どの文面に同意したかが履歴に残る操作のため、同意の保存をつないだあとに有効になります。',
  deletion:
    'サンプルデータのため削除リクエストを送れません。リクエストは受け付けた日時と内容が記録として残り、オーナーへの通知も伴う操作のため、同意の保存をつないだあとに有効になります。',
} as const

const FOOTNOTE = 'サンプルデータのため、この画面から記録・共有・割り当てはできません — 実データ接続後に有効になります。'

/** ⚠ A COUNT THAT DOES NOT CHECK IS SAID OUT LOUD (personal-findings.ts:26-27
 *  makes the arithmetic the APP's job). ⚖ A8 — ONE HOME: the finding card and the
 *  practice sheet's 根拠 column show the same count, so they say the same thing
 *  about it or they are two truths for one question. */
const COUNT_WARNING = '根拠のセッション件数が一致しません。この件数は確認中です。'

/** ⚖ I-1 (S16C) — THE PRACTICE SHEET'S OWN THREE WORDS, and they live HERE with
 *  every other string a reader sees, not in the screen. The two honest lines
 *  below are the sheet's designed EMPTY states: a run may name a move the
 *  catalog has no module for, and a focus may be the run's own conclusion rather
 *  than a finding's — and a column that simply went blank would be the silent
 *  failure this room rules out everywhere else. */
const SHEET = {
  title: '今週の練習',
  doTitle: 'やること',
  whyTitle: '根拠',
  moduleEmpty: '手順のある練習メニューは、この一手にはまだ用意されていません。',
  receiptEmpty: 'この一手のもとになった会話は、まだ記録から見つかっていません。',
} as const

/** ⚖ THE SHARE STATE IS THE VIEWER'S OWN GRANT, AND IT IS READ, NOT ASSUMED.
 *  The state line, the body and the button label all resolve from
 *  `SelfView.grant` — the viewer's own plane row, looked up by their own id.
 *
 *  `declined` and `none` are ONE state HERE on purpose: to the person
 *  themselves the question is 「is my detail shared」, and the honest answer is
 *  no either way. The two stay different facts in the plane and collapse
 *  separately in the owner aggregate, which is where the anti-coercion rule
 *  lives — this is the person's own screen, not a manager's.
 *
 *  ⚠ NEITHER STATE CARRIES A REQUEST OR A NAG (COACHING_VISIBILITY_MODEL §3):
 *  turning it ON is the staff member's, and turning it OFF is theirs too. */
const SHARE_STATE = {
  on: {
    stateLine: '現在オン（店長は「どの場面を伸ばすとよいか」だけを見られます）',
    body: '店長が見られるのは「どの場面を伸ばすとよいか」だけです。会話の引用と録音は渡っていません。いつでも取り消せます。取り消しても勤務には影響しませんし、取り消したことは表示されません。',
    buttonLabel: '共有をやめる',
  },
  off: {
    stateLine: '現在オフ（あなたの詳しい内容は誰にも共有されていません）',
    body: '共有をオンにすると、店長はあなたが「どの場面を伸ばすとよいか」だけを見られます。会話の引用と録音は、オンにしても渡りません。いつでも取り消せます。断っても勤務には影響しませんし、断ったことは表示されません。',
    buttonLabel: '共有をオンにする',
  },
} as const

/** ⚖ THE NINE ITEMISED FACTS (audit #42), carried WORD FOR WORD from
 *  `ja.json coaching.data.staffOnly.*` / `.ownerVisible.*` — the phone's own
 *  legally-reviewed wording, not a paraphrase this room wrote. Two of them
 *  already lived here as `noticeLines`; the other seven had no home in Business
 *  at all, which is the largest copy gap the audit found. */
const TRANSPARENCY = {
  missionTitle: 'プライバシーに関する考え方',
  missionBody:
    'コーチング機能は「成長のサポート」を目的に、個別のセッション内容をAIが分析します。ただし、あなたの会話内容そのものや個別の学習提案は、オーナー・マネージャーに表示されない仕組みになっています。サポートはチームで、プライバシーはあなただけに。',
  staffOnlyTitle: 'あなたにしか見えない情報',
  staffOnly: [
    '会話の録音・文字起こし',
    '個別のセッション詳細',
    '具体的なお客様とのやり取り',
    'あなたが受け取る個別の学習提案',
    '個人的なメモ',
  ],
  ownerVisibleTitle: 'オーナー・マネージャーに見える情報',
  ownerVisible: [
    'パフォーマンス指標（成約率、再来店率など）',
    '成長の傾向',
    'AIによる成長エリアの分析（カテゴリーレベル）',
    '学習モジュールの進捗',
  ],
  synqedTitle: 'Synqedによるデータ利用',
  synqedIntro:
    'Synqedは本サービスの提供事業者として、お店のオーナー・マネージャーとは別の立場で、コーチング機能の運営と継続的な改善のために、以下の範囲でデータにアクセスします。',
  synqed: [
    '匿名化された会話パターンの抽出（チーム共有のパターンライブラリ生成のため）',
    'AIモデルの継続的な改善（個人を特定できない形で学習データとして利用）',
    'サブ処理事業者: Anthropic（AI推論）、Supabase（データ保管）',
    '人間がデータを閲覧するのは、削除リクエスト・技術サポート・法的要請の対応時のみで、すべて監査ログに記録されます',
  ],
  retentionLabel: 'データ保持期間',
  retentionBody: 'セッションごとに最大365日。削除リクエスト後は30日以内に完全削除されます。',
} as const

/** ⚖ 8/25 — A STAT SAYS WHAT IT COUNTS, and a lift says what it is a lift OF.
 *  These are `ja.json coaching.owner.roi.metric.*`'s own four words. */
const ROI_METRIC_LABEL: Record<RoiLift['key'], string> = {
  closingRate: '成約率',
  rebookingRate: '再来率',
  avgRevenue: '平均客単価',
  satisfaction: '満足度',
}

/** `ja.json coaching.owner.roi.confMature/confBuilding/confEarly`, plus the
 *  fourth state the ROOM's model has and the phone's three-value chip does not:
 *  `effectiveness.ts:75`'s `Confidence` includes 'none', and a metric with no
 *  horizon carrying data has no lift at all. Printing a 0 for it would be the
 *  silent failure this room rules out. */
const ROI_CONFIDENCE_LABEL = { mature: '確立', building: '構築中', early: '初期', none: '判定前' } as const

export interface CoachingPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** ⚖ THE ROLE PREVIEW's raw `?as=` value (audit #71). Honoured ONLY behind
   *  `isRolePreviewEnabled()` and only when it names a role the access table
   *  itself knows — `effectiveRole` owns both rules, and a production build
   *  folds it to the real role. */
  as?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness needs worlds this demo plane does not contain — a 25+
   *  roster for the ANY-ROSTER-SIZE proof, a staff member's own view of the same
   *  store, a store whose module was never switched on — and the only honest way
   *  to picture any of them is to run the REAL derivations on a different world. */
  world?: {
    rows?: FixtureCoachingStaff[]
    roster?: Array<{ id: string; name: string }>
    /** Which stores have the module on. Replaces the plane's own list. */
    enabledStores?: string[]
    /** The role the page is being read by. The demo operator is a 店舗管理者. */
    role?: string
    /** The signed-in staff id. The demo operator is p-06. */
    selfId?: string
    /** The store's sample-size floor (registry ⑤'s dial). Clamped, always. */
    floor?: number
    /** ⚖ Q6 — the business's own 評価の公開範囲 dial (registry ⑤). The harness
     *  needs the `'all-staff'` world to prove the widening really happens AND
     *  that it still carries no per-staff number; a bogus value proves the
     *  fail-closed parse. `unknown` on purpose: the plane is a settings row
     *  nobody validates yet, so the room must survive whatever is in it. */
    policy?: { evaluationVisibility?: unknown }
    /** ⚖ GREPTILE-1 — the CONSENT PLANE, replaced whole. The demo plane cannot
     *  hold an 「unset consent over an analysed run」 world, because that state is
     *  impossible in the product (the analysis is what the consent authorises) —
     *  and yet it is exactly the state the self gate has to refuse. The only
     *  honest way to picture the refusal is to run the REAL derivations against a
     *  consent plane the harness supplies, the same seam `rows` and `floor` are. */
    consent?: Record<string, FixtureConsentRecord>
  }
}

export interface CoachingPropsResult {
  props: CoachingProps
  /** The RESOLVED lens AND the resolved reading role, returned rather than
   *  re-derived by the caller so the clamp keeps exactly one home. `page.tsx`
   *  keys the screen by it, so which tab is open and which step of the tour the
   *  reader is on reset when the store changes — the ⚖ 8/17 isolation law at the
   *  frame as well as the read.
   *
   *  ⚠ VL-6 — THE ROLE IS *NOT* IN THIS KEY (`storeKey` below is `clamped ?
   *  storeId! : 'all-stores'` — the store only). What keeps a persona switch
   *  from stranding a reader on a tab their new role has no panel for is two
   *  OTHER facts, not this key: the preview's role pill is a plain `<a href>`
   *  (a hard navigation — nothing client-side survives it) and the screen
   *  clamps its own `activeTab` to `'self'` whenever the capability is missing
   *  (fail-closed at the render, regardless of what mounted before it). */
  storeKey: string
}

export async function coachingProps({ locale, store, as, world }: CoachingPropsInput): Promise<CoachingPropsResult> {
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  // ONE CLOCK READ PER RENDER (the cycle-1 law): the window label, the trend's
  // month ticks and the dateline all derive from this one instant.
  const now = renderNow()
  const { y, m } = jstYmd(now)

  const roster = world?.roster ?? (await listStaff(lens)).map((s) => ({ id: s.id, name: s.full_name }))
  // ⚖ THE REAL ROLE AND THE ROLE THE PAGE IS BEING READ AS ARE TWO DIFFERENT
  // FACTS, and both are on screen. `world.role` is the evidence harness's own
  // seam (it has been here since the build round); `?as=` is the reader's, and
  // it is honoured only behind the preview gate.
  const realRole = world?.role ?? operator.role
  const role = effectiveRole(realRole, as)
  const previewOn = isRolePreviewEnabled()
  const selfId = world?.selfId ?? operator.staff_id
  // ⚖ Q6 — THE BUSINESS'S OWN DIAL, READ ONCE, AND ONLY THROUGH `accessFor`.
  // The plane holds the value; `resolveVisibility` decides what an unknown one
  // means; `accessFor` is the only place it can change anything. Nothing below
  // branches on it, which is what keeps 「who may see the board」 to one home.
  const policy = world?.policy ?? coachingPolicy
  const visibility = resolveVisibility(policy.evaluationVisibility)
  const access = accessFor(role, policy)
  const floor = sampleFloor(world?.floor)
  // The query the pill's links must preserve: switching persona must not throw
  // the reader back to a different store.
  const keepStore = clamped ? `?store=${encodeURIComponent(storeId!)}&` : '?'
  // ⚖ R1-3 — THE SETTINGS ROOM EXISTS (#812), so the door to it is a REAL LINK
  // and it keeps the lens the reader is on (the 売上分析 pattern,
  // analytics-props.ts:400). What does NOT exist is the ⚖ Q6 dial's own editor
  // inside that room — and the NOTE SENTENCE under the link is what says so
  // (R2-1: a 「準備中」 chip beside a working link reads as a broken door).
  // One truth, one place: the label promises OPENING, which the link really
  // does; the note names what is still missing.
  const settingsHref = `/${locale}/business/settings${clamped ? `?store=${encodeURIComponent(storeId!)}` : ''}`

  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'

  // ⚖ (1) THE MODULE GATE, ASKED FIRST. Off = the plane is never read, so the
  // dormant payload contains no coaching data at all rather than data a class
  // is hiding.
  const on = moduleOn(storeId, world?.enabledStores ?? coachingStores)
  const rows = on ? (world?.rows ?? coachingStaff) : []
  // ⚖ GREPTILE-1 — ONE CONSENT PLANE, READ ONCE, by BOTH derivations. The self
  // gate and the board's own consent filter must never be able to disagree about
  // what a person decided, so they read the same object rather than the same
  // import twice — and the harness seam replaces it in exactly one place.
  const consentPlane = world?.consent ?? coachingConsent

  // ⚠ MODULE OFF = THE PLANE IS NEVER READ, consent included. The dormant page
  // renders no self panel at all, so the value below is the consent type's own
  // default-pre-prompt state rather than a claim about this reader — reading
  // their real record here would be the module gate leaking one row.
  const self: SelfState = on
    ? buildSelfView({ selfId, rows, patterns: teamPatterns, consent: consentPlane })
    : { kind: 'none', consent: { status: 'unset', policyVersion: null } }

  // ⚖ (2) THE TEAM BOARD IS ONLY BUILT FOR A READER WHO HOLDS THE CAPABILITY.
  // Not filtered afterwards — never built, so there is nothing in the payload
  // for a mis-wired component to find.
  // ⚖ R2-17 — AND IT IS BUILT FROM THE SAME CONSENT PLANE THE SELF VIEW READS.
  // Consent to be coached gates whether any L1 artifact exists at all, so a
  // member who has not granted it has no band to show a manager — and the
  // derivation, not the screen, is where that is decided.
  const team: TriageView | null =
    on && access.viewTeam
      ? buildTriage({ roster, rows, floor, consent: consentPlane, patternCategories: teamPatterns.map((p) => p.categoryKey) })
      : null

  // ⚖ (3) THE ROI SCREEN IS ONLY BUILT FOR A READER WHO HOLDS ITS OWN
  // CAPABILITY — the same construction as the board, one layer over. A
  // 店舗管理者's payload contains no money estimate to leak, and a staff
  // member's contains no store aggregate at all.
  const roi = on && access.viewRoi ? buildRoi({ roi: clamped ? storeRoi[storeId!] : undefined }) : null

  // The catalog, and the id→title lookup every module REFERENCE resolves
  // through. One home, so a finding, a focus card and the catalog cannot end up
  // calling the same module three different things.
  const myModuleIds = self.kind === 'ready' ? self.view.focus.map((f) => f.moduleId) : []
  const modules = on ? buildModuleLibrary(learningModules, myModuleIds) : []
  const moduleTitle = new Map(modules.map((mod) => [mod.moduleId, mod.title]))
  const shelves = on ? buildPatternLibrary(patternLibrary, roster) : []

  // ⚖ I-1 — THE PRACTICE SHEET'S TWO JOINS, RESOLVED ONCE, HERE.
  //  · the MODULE is the catalog card the focus run's own `module_id` names
  //    (staff-focus.ts:173) — the same lookup the 練習するもの chip already uses,
  //    so the steps beside the move and the card the chip jumps to can never be
  //    two different modules;
  //  · the RECEIPT is the finding whose own `linked_module_id`
  //    (personal-findings.ts:242) is that SAME module. ⚠ NOT a category match:
  //    `focus.category` is a `CoachingCategoryKey` (categories.ts:20-24) and
  //    `finding.category` is the business-native pattern name the model writes
  //    (personal-findings.ts:235), so the two never compare equal and a category
  //    join would silently always fall through — a dead branch wearing a live
  //    one's clothes (S16C-D1). The module id is the ONE reference the two shapes
  //    really share. Failing that, the ranked findings' own first item, which is
  //    the run's 「what is costing you most」.
  const focusOne = self.kind === 'ready' ? self.view.focus[0] : undefined
  const sheetModule = focusOne?.moduleId ? (modules.find((m) => m.moduleId === focusOne.moduleId) ?? null) : null
  const sheetFinding =
    self.kind === 'ready'
      ? (self.view.findings.find((f) => f.linkedModuleId !== null && f.linkedModuleId === focusOne?.moduleId) ??
        self.view.findings[0] ??
        null)
      : null

  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
  // personal-findings.ts:219 `window.date_range`, composed from the clock.
  const dateRange = `${fmtDay.format(windowStart)}〜${fmtDay.format(now)}`
  const windowLabel = `直近${WINDOW_DAYS}日（${dateRange}）`

  // contract.ts:47-51 MetricPoint — one tick per history point, newest LAST,
  // the axis always ending on the month the reader is in.
  const historyLength = self.kind === 'ready' ? self.view.history.length : 0
  // ONE month-tick composer, used by BOTH trends: the self screen's 成約率 bars
  // and the owner ROI's treated/control lines. Two of them would be two homes
  // for one arithmetic (⚖ A8) — and the ROI chart's axis and the spine's axis
  // disagreeing by a month is exactly the kind of drift nobody would spot.
  const monthTicks = (n: number) =>
    Array.from({ length: n }, (_, i) => fmtMonth.format(new Date(Date.UTC(y, m - 1 - (n - 1 - i), 15))))
  const trendLabels = monthTicks(historyLength)

  /** A lift, formatted for its own unit. ⚠ THE SIGN IS ALWAYS SPELLED, including
   *  on a negative: a coaching lift that came out negative is a fact the owner
   *  is owed, and 「誇張しません」 is only true if the screen can print a minus. */
  const liftDisplay = (l: RoiLift): string => {
    if (l.lift === null) return '—'
    const sign = l.lift >= 0 ? '+' : '−'
    const v = Math.abs(l.lift)
    if (l.unit === 'rate') return `${sign}${(v * 100).toFixed(1)}pt`
    if (l.unit === 'money') return `${sign}${money({ amount: Math.round(v), currency: 'JPY' })}`
    return `${sign}${v.toFixed(2)}点`
  }
  const levelDisplay = (l: RoiLift, v: number): string =>
    l.unit === 'rate' ? pct(v) : l.unit === 'money' ? money({ amount: v, currency: 'JPY' }) : `${v.toFixed(1)} / 5.0`
  const roiLift = (l: RoiLift) => ({
    key: l.key,
    label: ROI_METRIC_LABEL[l.key],
    liftDisplay: liftDisplay(l),
    beforeDisplay: levelDisplay(l, l.before),
    afterDisplay: levelDisplay(l, l.after),
    confidence: l.confidence,
    confidenceLabel: ROI_CONFIDENCE_LABEL[l.confidence],
    // ⚖ THE RECEIPT FOR A LIFT IS WHICH WINDOWS IT SURVIVED. A number with no
    // horizons behind it is 判定前, and it says so rather than reading as 0.
    horizonNote:
      l.horizonsUsed.length > 0
        ? `${l.horizonsUsed.join('・')}日の実績から算出`
        : 'まだ算出できる期間の実績がありません',
  })

  // ⚖ R2-17 — ONE COMPOSITION OF THE CONSENT BLOCK, read by both branches of
  // `self`. The question 「may we analyse your sessions」 comes BEFORE there is
  // anything to analyse, so the reader who has nothing on their screen yet is
  // the reader who most needs to be asked — and a second composition would be a
  // second place for the three states to fork.
  const ownConsent = self.kind === 'ready' ? self.view.consent : self.consent
  const consentBlock = {
    status: ownConsent.status,
    ...CONSENT_STATE[ownConsent.status],
    // ⚖-ADJ B — the ONE LINE the granted state prints as a strip. Null for the
    // two states that are still a decision, which is what makes the screen's
    // branch a fact about the payload rather than a rule the component keeps.
    strip: CONSENT_STATE[ownConsent.status].strip ?? null,
  }

  const props: CoachingProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    windowLabel,
    // ⚖ THE HEAD IS ONE ROW NOW (S16 §2.1), so the two orientation LINES became
    // two neutral CHIPS — and neither sentence was cut. The chip is the short
    // form; the whole sentence rides its `title`, which is where the retired
    // 「…のセッションを見ています」 paragraph lives (⚖-ADJ K: a string with no
    // new home fails the round).
    windowChip: `直近${WINDOW_DAYS}日 ・ ${dateRange}`,
    windowTitle: `${windowLabel}のセッションを見ています`,
    // ⚠ TRUE ON BOTH SCREENS (the room-5 F5-1 law). The head is the one element
    // this room renders on the self view AND the board, so a sentence about
    // 「your own sessions」 would be the page describing a screen the reader is
    // not on — found in my own read of the board's shot. What stays here is what
    // never stops being true: what the page is FOR, and the wall that holds on
    // both sides of it.
    subtitle:
      'セッションの記録から、事実にもとづく気づきを表示します。一人ひとりの詳しい内容は、本人だけが見られます。',
    moduleOn: on,
    // ⚠ THE DORMANT SENTENCE NAMES THE REAL REASON, and never a fake 「読み込み
    // 中」: the module is switched off for this store, which is a decision
    // somebody made, not a wait.
    dormantTitle: 'この店舗ではコーチングを使っていません',
    dormantBody: `コーチングは店舗ごとに申し込む機能です。${lensLabel}では現在オフのため、分析は行われず、この画面には成績も気づきも表示されません。ご利用の申し込みは設定＞コーチングから行います。`,
    // ⚖ 8/17 — the ENTITLEMENT boundary is stated in words rather than built as
    // a hidden panel (deviation C8-2). Canon carries a `[hidden]` boundary panel
    // for a state this business cannot be in; a poster of a state is the class
    // the room-3 zero-state rebuild ended.
    noticeLines: [
      'コーチングはKarute（記録・AI）をご利用の事業でのみ表示されます。',
      '会話の録音と文字起こしは、店長・オーナーを含め、この画面のどこにも表示されません。',
    ],
    // ⚖ THE PRIVACY MARKER, ON EVERY L1 SECTION (audit #10). The phone repeats
    // 「あなただけが見ることができます」 ten times, on every private card; this
    // room said it twice, in prose, and had no per-section marker at all — so a
    // reader scanning the desk could not tell which panels are theirs alone.
    // ONE string, handed down, so the promise cannot come apart card by card.
    privacyBadge: 'あなただけが見られます',
    // ⚖ WHOSE EYES IS THIS? — the audit's §3 found NO viewer-identity label
    // anywhere in either system, on the phone or here; the dev pill was the only
    // prior art and it was built to be deleted. The room's own grammar answers
    // it: one quiet always-visible line in the head that names the role the page
    // is being read as AND what that role can reach, so orientation does not
    // depend on having seen the other variant. True in production, where there
    // is no preview and the role is simply the reader's own.
    // The chip says WHO is reading; the whole sentence — including the reach
    // list — is its `title` AND the head's guide text (R2-20 made the second
    // half of that true: a `title` on a non-focusable span is mouse-only, so the
    // tour carries the sentence for a keyboard and a finger). Same fact, two
    // lengths. ⚠ 「…として表示中」 rather than 「…として表示」: the bare verb stem
    // reads clipped beside its own finished-sentence `title` (R2-4).
    viewerChip: `${role}として表示中`,
    viewerLine: `この画面は「${role}」として表示しています ・ ${
      access.viewRoi
        ? '自分のコーチング・全スタッフ表示・経営への効果'
        : access.viewTeam
          ? '自分のコーチング・全スタッフ表示'
          : '自分のコーチングのみ'
    }`,
    // ⚖ THE THREE-WAY ROLE PREVIEW (audit #71), and all four of the dormant
    // mechanism's guard rails are kept:
    //  1. it is a WORLD override, never a privilege change — `requireBusiness
    //     Admission()` is untouched and every payload is still built by the
    //     server for exactly the persona it is handed to;
    //  2. the real identity is always on screen — the first chip is 実（…）;
    //  3. previewing the wrong role shows the REFUSAL, not the content: as
    //     スタッフ the tab row is gone and canon's boundary sentence stands in
    //     its place, because the board was never built;
    //  4. production renders NOTHING — not hidden, absent, and `?as=` is not
    //     read either (`isRolePreviewEnabled` gates both halves).
    preview: previewOn
      ? {
          label: '開発用',
          note: '表示を切り替えるだけの開発用の機能です。実際の権限は変わりません。本番では表示されません。',
          realLabel: `実（${realRole}）`,
          realHref: `${keepStore}`.replace(/[?&]$/, '') || '?',
          current: role,
          isOverridden: role !== realRole,
          roles: PREVIEW_ROLES.map((r) => ({ role: r, href: `${keepStore}as=${encodeURIComponent(r)}` })),
        }
      : null,
    selfTabLabel: '自分のコーチング',
    teamTabLabel: '全スタッフ表示',
    roiTabLabel: '経営への効果',
    canViewTeam: access.viewTeam,
    canViewRoi: access.viewRoi,
    // canon's boundary-rights sentence (fable-coaching.html:363), kept verbatim
    // in meaning and spelled without the capability code, because a reader is
    // not owed our permission vocabulary.
    teamBoundaryLine:
      '全スタッフ表示は、店舗全体を見る権限のあるアカウントでのみ表示されます。現在は自分のコーチングのみを表示しています。',
    // ⚖ Q6 (Liam 9/2) — AND THE READER IS TOLD IT IS A SETTING, not a law of the
    // product. The clause renders only when the dial really is at 'managers',
    // because under 'all-staff' this sentence would be false for the one reader
    // who could still land here (a role the access table does not know).
    // ⚠ 「設定を開く」, NEVER 「設定で変更」 (the 9/4 label law): the editor is
    // registry ⑤ and does not exist yet, so the label may not promise a change
    // its destination cannot make.
    // ⚠ R2-1 — AND THE CAVEAT IS A NOTE SENTENCE, NOT A CHIP. In this app a
    // 「準備中」 CHIP always marks a disabled control, so one standing beside a
    // link that really navigates says 「this door is broken」. The family's own
    // grammar for exactly this shape is 売上分析's (a plain link plus a `note`
    // naming what is unfinished), and it is what this door wears now: the label
    // promises opening, the sentence says the editing is not built yet.
    teamBoundaryPolicy:
      visibility === 'managers'
        ? {
            line: 'この事業の設定では、全スタッフ表示は店長・オーナーのみに表示されます。',
            doorLabel: '設定を開く',
            doorHref: settingsHref,
            note: '公開範囲の編集は準備中です。',
          }
        : null,
    self:
      self.kind === 'ready'
        ? {
            kind: 'ready',
            // ⚖ COACHING IS OPT-IN, AND THE PAGE NOW SAYS SO (audit #2/#3/#6).
            // The room refused the DEPTH-SHARE from day one but never said the
            // ANALYSIS ITSELF is the staff member's to allow, so the page read
            // as if coaching simply happens to you. The decision is READ from
            // the viewer's own record; the CONTROL stays refused, because
            // writing a consent record is a legal act.
            consent: consentBlock,
            status: self.view.status,
            statusTitle: STATUS_TITLE[self.view.status],
            statusBody: STATUS_BODY[self.view.status],
            runHeadline: self.view.headline,
            sessionsLabel: `${self.view.sessionsReviewed}回のセッションから`,
            maturityNote: maturityNote(self.view.sessionsReviewed),
            stats: [
              { key: 'closingRate', label: '成約率', value: pct(self.view.closingRate) },
              { key: 'rebookingRate', label: '再来率', value: pct(self.view.rebookingRate) },
              { key: 'customerSatisfaction', label: '満足度', value: `${self.view.customerSatisfaction.toFixed(1)} / 5.0` },
              { key: 'avgRevenue', label: '平均客単価', value: money(self.view.avgRevenue) },
              // ⚖ 「後で決める」 IS A FIRST-CLASS METRIC, not a footnote: chronic
              // deferral is where the sales leak, and it says what it counts.
              { key: 'pendingCount', label: '「後で決める」のまま', value: `${self.view.pendingCount}件` },
            ],
            trendTitle: '成約率の推移（月ごと）',
            // ⚖ I-3 — THE SPARKLINE'S OWN SENTENCE, composed here from the FIRST
            // and LAST points the trend really has. The picture is never the only
            // place the movement exists: a reader who cannot see four 26px bars
            // reads the same fact in words, and so does a screen reader.
            trendCaption: trendCaption(
              self.view.history.map((v, i) => ({ label: trendLabels[i] ?? '', display: pct(v) })),
            ),
            trend: self.view.history.map((v, i) => ({ label: trendLabels[i] ?? '', value: v, display: pct(v) })),
            findings: self.view.findings.map((f) => ({
              id: f.id,
              severity: f.severity,
              severityLabel: SEVERITY_LABEL[f.severity],
              category: f.category,
              headline: f.headline,
              impact: f.impact,
              countLabel: f.countLabel,
              recommendation: f.recommendation,
              moment: f.moment
                ? { date: f.moment.date, quote: f.moment.quote, speakerLabel: f.moment.speakerLabel }
                : null,
              checklistItemMatched: f.checklistItemMatched,
              // ⚠ A COUNT THAT DOES NOT CHECK IS SAID OUT LOUD (personal-findings
              // .ts:26-27 makes the arithmetic check the APP's job). Silent
              // failure is a bug: rather than print a number the evidence does
              // not support, the card says the evidence is short.
              countWarning: f.countChecks ? null : COUNT_WARNING,
              confidenceNote: f.confidenceNote,
              // personal-findings.ts:242-243 — the loop closed: what fixes this,
              // named. Null when the run linked nothing, or when the reference
              // does not resolve — never an id printed at a reader.
              moduleTitle: moduleTitle.get(f.linkedModuleId ?? '') ?? null,
              // ⚖-ADJ D — the ANCHOR of that same card, from the SAME lookup, so
              // a link can never point at a card the catalog did not render: both
              // fields are null together or set together.
              moduleAnchor: moduleTitle.has(f.linkedModuleId ?? '') ? f.linkedModuleId : null,
              patternBehavior: f.patternBehavior,
            })),
            // ⚖ staff-focus.ts:200-204 — 「detail MUST cite the evidencing
            // metric/pattern」, and the plane has carried this since the build
            // round while the room rendered nothing (audit §5 rank 4). Honest,
            // not sweet: a strength here is a strength with a receipt attached.
            strengths: self.view.strengths.map((s) => ({ label: s.label, detail: s.detail })),
            focus: self.view.focus.map((f) => ({
              category: f.category,
              categoryLabel: labelOf(self.view.categories, f.category),
              label: f.label,
              description: f.description,
              // staff-focus.ts:173 — the module this focus points at, resolved
              // to the catalog's own title. Before this round `module_id` was a
              // reference into nothing (audit #8).
              moduleTitle: moduleTitle.get(f.moduleId ?? '') ?? null,
              // ⚖-ADJ D — same lookup, same pair: a title without a rendered card
              // carries no anchor, and the chip falls back to plain text.
              moduleAnchor: moduleTitle.has(f.moduleId ?? '') ? f.moduleId : null,
              // staff-focus.ts:171 — 'early_signal' is capped at priority
              // 'medium' by the module's own rule, and it is SAID rather than
              // hidden: a thin signal presented as settled is the mislabelling
              // the whole floor exists to prevent.
              confidenceNote: f.confidence === 'early_signal' ? 'まだ初期の傾向です' : null,
            })),
            // ⚖ I-1 — THE PRACTICE SHEET. Null when the run named no next move,
            // because a sheet with nothing on it is not a designed state — the
            // status card below already says why the run has nothing to point at.
            sheet: focusOne
              ? {
                  ...SHEET,
                  module: sheetModule
                    ? { title: sheetModule.title, durationLabel: sheetModule.durationLabel, steps: sheetModule.steps }
                    : null,
                  moduleEmpty: sheetModule ? null : SHEET.moduleEmpty,
                  receipt: sheetFinding
                    ? {
                        countLabel: sheetFinding.countLabel,
                        countWarning: sheetFinding.countChecks ? null : COUNT_WARNING,
                        moment: sheetFinding.moment
                          ? {
                              date: sheetFinding.moment.date,
                              quote: sheetFinding.moment.quote,
                              speakerLabel: sheetFinding.moment.speakerLabel,
                            }
                          : null,
                      }
                    : null,
                  receiptEmpty: sheetFinding ? null : SHEET.receiptEmpty,
                }
              : null,
            outcomes: {
              // ⚖ D8-6 — no windowLabel here: OutcomesSummary (contract.ts:162-172)
              // carries no window field, so the title states only what the count
              // actually counts, not a window this plane never claimed.
              title: `不成約の理由（${self.view.noDealTotal}件）`,
              reasons: self.view.declineReasons,
              pendingLine:
                self.view.pendingCount > 0
                  ? `「後で決める」のまま決まっていないセッションが${self.view.pendingCount}件あります。次にいつ返事をもらうかだけでも決めておくと、ここが減ります。`
                  : null,
            },
            categoriesTitle: '会話スキル（上位層との比較）',
            categories: self.view.categories.map((c) => ({
              key: c.key,
              label: c.label,
              score: c.score,
              topBenchmark: c.topBenchmark,
              // contract.ts:55 Confidence, said in words only when it is worth
              // saying: a 'low' score is a score the reader should weigh less.
              confidenceNote: c.confidence === 'low' ? '記録が少なく、参考値です' : null,
            })),
            learnFromTop: self.view.learnFromTop,
            // ⚖ D8-1 — the viewer's OWN grant decides what this section says
            // and what its button offers, instead of a hardcoded 「現在オフ」.
            share: SHARE_STATE[self.view.grant === 'granted' ? 'on' : 'off'],
          }
        : {
            kind: 'none',
            consent: consentBlock,
            statusTitle: '分析されたセッションがまだありません',
            statusBody: 'セッションの記録がたまると、あなただけが見られる成績と気づきがここに表示されます。',
          },
    team: team
      ? {
          framingLine: 'この画面は評価のためではなく、支援を配るためのものです。順位はつけません。',
          counts: [
            { key: 'growing', label: BAND_LABEL.growing, value: `${team.counts.growing}名` },
            { key: 'steady', label: BAND_LABEL.steady, value: `${team.counts.steady}名` },
            { key: 'needs-support', label: BAND_LABEL['needs-support'], value: `${team.counts.needsSupport}名` },
            // ⚠ R2-17 — THE FOURTH COUNT IS REASON-FREE. It holds three kinds of
            // person — too few sessions, never asked, and declined — and naming
            // any one of them would let a manager subtract and identify the
            // others. It says only what is true of all three, in the same words
            // the row's own band chip uses.
            { key: 'building', label: 'まだ判断できません', value: `${team.counts.building}名` },
          ],
          rows: team.rows.map((r) => ({
            staffLabel: r.staffLabel,
            band: r.band,
            // ⚠ A BAND-LESS ROW SAYS SO IN WORDS AND CARRIES NO NUMBER. Telling
            // an owner how many sessions somebody has run is the same lever the
            // band exists to remove.
            bandLabel: r.band ? BAND_LABEL[r.band] : 'まだ判断できません',
            bandTone: r.band ? BAND_CLASS[r.band] : 'cg-band-building',
            // staff-focus.ts:190 — the maturity flag, said only when it changes
            // how the band should be read.
            maturityNote: r.band !== null && r.maturity === 'early' ? '初期の傾向' : null,
            // staff-focus.ts:159 — 「categorical only, no number, no name」.
            focusAreas: r.focusAreas.map((f) => ({ label: f.label, summaryText: f.summaryText, priority: f.priority })),
            // ⚠ AN OMITTED SENTENCE IS SAID OUT LOUD, exactly as a short count
            // is (`countWarning` above). staff-focus.ts:144-145's remedy is to
            // OMIT a leaking L2 entry; a board that just went quiet about one
            // person would be the silent failure this room rules out.
            summaryWarning: r.summaryChecks
              ? null
              : '重点項目の文に数字か名前が入っていたため、この行では表示していません。',
            // ⚠ R2-17 — AND SO IS THE SENTENCE. 「回数」 was a reason, and a reason
            // is exactly what separates the person who declined from the person
            // who is simply new. The word must not appear here (source pin).
            trajectoryLine: r.band ? TRAJECTORY_LINE[r.band] : 'まだ判断できる材料がありません。',
            action: r.suggestedAction ? { kind: r.suggestedAction.kind, label: r.suggestedAction.label } : null,
          })),
          // ⚖ サポートエリア頻度ランキング (audit #24) — the ONE owner-facing
          // 「what does the whole store need」 answer, and the only surface on
          // this page that aggregates ACROSS people.
          //
          // ⚠ NO LEADERBOARD GRAMMAR, AND THE LABEL SAYS WHAT IT COUNTS
          // (⚖ 8/25): 「クロージング ・ 3名」 is a fact about the store's shape.
          // There is no rank number, no 1位, no medal and no arrow — and the
          // count is of STAFF, never of sessions or of anything a person could
          // be measured by. It reads the BOARD (bands and leak guard already
          // applied), so an area too unsafe to print is not counted either.
          focusRanking: {
            title: '店舗全体のサポートエリア',
            note: 'いま支援が必要な場面を、人数で並べています。誰のことかは表示しません。順位ではありません。',
            rows: focusAreaFrequency(team.rows).map((f) => ({
              key: f.category,
              label: f.label,
              value: `${f.count}名`,
            })),
            emptyLine: '支援が必要と判断できたスタッフがまだいません。',
          },
          // ⚖ R2-18 — the board's own empty branch, in the same grammar the
          // ranking rail already uses: an absence is said, never left blank.
          filteredEmptyLine: 'この区分に当てはまるスタッフはいません。',
          adoptionLine: `深い共有を許可しているスタッフ ${team.sharingAdoption.granted}名 / 在籍 ${team.sharingAdoption.total}名`,
          adoptionNote:
            '誰が許可していないかは表示しません。共有はスタッフ本人が決めるもので、断っても勤務には影響しません。',
          limitNote:
            '在籍人数が少ない店舗では、区分だけにしても誰のことか分かってしまいます。区分はここでの見え方を「支援」に寄せるためのもので、匿名にするためのものではありません。',
        }
      : null,
    // ⚖ THE OWNER ROI SCREEN (audit §5 rank 1) — the surface that answers
    // 「これ、払う価値ある？」, which this room had NO answer for.
    //
    // ⚠ EVERY NUMBER ON IT IS A SUBTRACTION. `buildRoi` computes each lift as
    // 「this store's change − untreated stores' change」, shrinks it toward a
    // zero prior and labels it by which horizons matured — so a good season
    // cannot be sold as a coaching win, and a thin sample cannot outrank a
    // year's work. The honesty note is not decoration beside the numbers; it is
    // the description of the arithmetic that produced them, which is why it
    // rides the same object and renders whenever a lift does.
    roi: roi
      ? {
          heroLabel: 'コーチング導入後の売上への効果',
          hero: roiLift(roi.headline),
          heroSub: `導入からの${roi.sinceMonths}ヶ月ぶんの実績です。季節や他の要因を差し引いた、コーチングによる押し上げ分だけを表示しています。`,
          confidenceLead: '確からしさ',
          trendTitle: '店舗の成約率の推移',
          trendSub: '縦の線がコーチングを始めた時点です。以降、コーチングを使っていない他店舗の平均との差が開いています。',
          treatedLabel: 'この店舗',
          controlLabel: '他店舗平均（コーチング未導入）',
          trend: {
            treated: roi.treated,
            control: roi.control,
            labels: monthTicks(roi.treated.length),
            startFraction: roi.coachingStartFraction,
          },
          liftsTitle: '指標ごとの押し上げ',
          liftsSub: 'それぞれ、他の要因を差し引いたコーチングによる効果です。まだ判断が早いものは「初期」「構築中」と表示します。',
          lifts: roi.lifts.map(roiLift),
          // ⚖ 「誇張しません」 — ja.json coaching.owner.roi.honestyNote, carried
          // in the phone's own words and spelled out in plain language, because
          // it is what makes these numbers safe to show an owner.
          honestyNote:
            '数字は「差分の差分法」で出しています — コーチングを受けたこの店舗の変化から、コーチングを使っていない他店舗の自然な変化を差し引き、残った押し上げ分だけを表示しています。データが少ないうちに大きく出た数字は自動的に抑えめに補正し、確からしさが足りないものは正直に「構築中」「初期」と表示します。誇張しません。',
          pitchTitle: 'この機能は、費用を上回る売上を生んでいます',
          pitchSub: roi.monthlyValueEstimate
            ? `この規模の店舗で、月あたり約 ${money(roi.monthlyValueEstimate)} の売上に相当します。`
            : null,
          // ⚠ THE ABSENCE IS SAID OUT LOUD, like every other short receipt in
          // this room: an owner who does not see a money line is told the bar
          // was not met, rather than left to wonder where it went.
          pitchWithheld:
            roi.monthlyValueEstimate === null
              ? '金額に置き換えた目安は、確からしさが「確立」になるまで表示しません。'
              : null,
        }
      : null,
    // ⚖ あなたのデータについて (audit #40-#45) — nine itemised facts, the
    // Synqed-as-processor disclosure and the mission line, all in the phone's
    // own legally-reviewed words. Two of the nine already lived here as
    // `noticeLines`; the other seven had no home in Business at all. It is a
    // SECTION rather than a route because this room is one page — the reader
    // never has to leave the screen the promise is about.
    transparency: {
      title: 'あなたのデータについて',
      // ⚖ TRUE ON BOTH SIDES OF THE WALL (the room-5 F5-1 law). A staff member
      // and an owner read the same sentence here, because the facts below are
      // the same facts whichever side you are on — what changes is which column
      // is about you.
      subtitle: 'コーチング機能で扱われる情報と、店長・オーナーに見える範囲です。',
      // ⚖-ADJ A — the bar's own second clause. The notice is legal prose a
      // reader opens deliberately, so the closed bar has to say what is behind
      // it in the words the reader would use to look for it.
      barLead: '記録される情報と、店長・オーナーに見える範囲',
      ...TRANSPARENCY,
      staffOnlyLead: '本人だけが見られます。店長・オーナーの画面には表示されません。',
      ownerVisibleLead: '店長・オーナーが見られる範囲です。これ以外は渡りません。',
      // ⚖ 削除リクエストは法的な記録 — registry ③（同意の実保存）と同じ seam。
      deletionTitle: 'データ削除リクエスト',
      deletionBody:
        'コーチングで貯まったあなた固有のデータ（会話の録音・文字起こし・個別の学習提案）の削除をリクエストできます。成績などの業務データは対象外です。',
      deletionCta: 'データ削除をリクエストする',
    },
    // ⚖ THE PATTERN LIBRARY (audit #46-#48) — five NAMED shelves with the actual
    // line a top performer says, where the room used to show two loose anonymous
    // sentences. Every shelf renders, empty or not.
    patterns: shelves.length > 0
      ? {
          title: 'トップパフォーマーのパターン',
          subtitle: '成績の良いスタッフのやり方を、名前を伏せてまとめています。誰のやり方かは表示されません。',
          note: patternLibraryNote,
          emptyLine: 'この場面のパターンは、今月はまだ見つかっていません。',
          shelves,
        }
      : null,
    // ⚖ THE LEARNING-MODULE CATALOG (audit #49-#57). The room diagnosed and then
    // refused into nothing — 学習モジュールを割り当てる pointed at a library that
    // did not exist. It exists now, as a READ surface: assignment stays the
    // board's refused action, because it is a write that notifies a person.
    modules: modules.length > 0
      ? {
          title: '学習モジュール',
          subtitle: '気づきに対して、何をどう練習するかをまとめたものです。AIが上位層のやり方から組み立てています。',
          calloutTitle: '毎週あたらしいモジュールが増えます',
          calloutBody:
            '上位層のやり方からモジュールを自動で組み立てます。効果が確認できたものほど、次からの提案で優先されます。',
          mineLabel: 'あなたの次の一手',
          cards: modules,
        }
      : null,
    actionFootnote: FOOTNOTE,
    refusals: {
      regenerate: REFUSAL.regenerate,
      share: REFUSAL.share,
      depth: REFUSAL.depth,
      settings: REFUSAL.settings,
      consent: REFUSAL.consent,
      deletion: REFUSAL.deletion,
    },
    // The help actions' reasons ride the same table the ACTION does, so the
    // button a manager presses and the sentence it refuses with are decided in
    // one place (`coaching.ts`) rather than paired up by hand in the screen.
    helpRefusals: HELP_REFUSAL,
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}

const pct = (r: number) => `${Math.round(r * 100)}%`

/** ⚖ I-3 — 「6月 38% → 9月 52%」. The FIRST and the LAST point the run really
 *  carries, never a window this plane did not scope: with fewer than two points
 *  there is no movement to state and the sparkline does not render either. */
const trendCaption = (points: Array<{ label: string; display: string }>) => {
  if (points.length < 2) return ''
  const a = points[0]
  const b = points[points.length - 1]
  return `${a.label} ${a.display} → ${b.label} ${b.display}`
}
/** contract.ts:38-43 — money is ALWAYS currency-tagged, never a bare JPY number. */
const money = (m: { amount: number; currency: string }) => {
  try {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(m.amount)
  } catch {
    return `${m.amount.toLocaleString('ja-JP')} ${m.currency}`
  }
}

/** A focus area names a CATEGORY key; the reader gets the word the scores use,
 *  so 「クロージング」 on the focus card and 「クロージング」 in the skill list are
 *  the same thing rather than two spellings a reader has to reconcile. */
const labelOf = (cats: Array<{ key: string; label: string }>, key: string) =>
  cats.find((c) => c.key === key)?.label ?? key

const SEVERITY_LABEL = { priority: '重点', watch: '注目', strength: '強み' } as const

/** The band's tone, resolved here so the screen carries neither a map nor a
 *  judgement — the same reason the pill tones arrive as props in every other
 *  room. */
const BAND_CLASS = { growing: 'cg-band-grow', steady: 'cg-band-steady', 'needs-support': 'cg-band-support' } as const
const TRAJECTORY_LINE = {
  growing: '本人のこれまでと比べて、成約率が上がっています。',
  steady: '本人のこれまでと比べて、大きな変化はありません。',
  'needs-support': '本人のこれまでと比べて、成約率が下がっています。',
} as const
