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
  buildSelfView,
  buildTriage,
  BAND_LABEL,
  HELP_REFUSAL,
  maturityNote,
  moduleOn,
  sampleFloor,
  STATUS_BODY,
  STATUS_TITLE,
  type SelfState,
  type TriageView,
} from '@/business/lib/coaching'
import { defaultStoreId, listStaff, listStoreOptions, renderNow, type StoreLens } from '@/business/lib/data'
import { operator } from '@/business/lib/fixtures'
import { coachingStaff, coachingStores, teamPatterns, type FixtureCoachingStaff } from '@/business/lib/fixtures-coaching'
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
 *  ON. One generic sentence on six controls tells the reader nothing about which
 *  of them would have done what. Each reason ends with the registry line the
 *  build report reconnects it through, so the sentence on the screen and the
 *  Anthony ask are the same sentence. */
const REFUSAL = {
  regenerate:
    '見本データのため気づきを作り直せません。作り直しはあなたのセッションをAIにかけ直す操作で、料金の発生する処理のため、実データとAIの接続後に有効になります（登録: ②コーチング生成）。',
  share:
    '見本データのため共有の設定を変えられません。この切り替えはあなた自身が許可を出す記録で、取り消しも履歴も残る操作のため、同意の保存をつないだあとに有効になります（登録: ③同意の実保存）。',
  depth:
    '見本データのため詳しい内容を開けません。スタッフが許可した範囲だけを開く仕組みはサーバー側で判定する必要があるため、権限の実装後に有効になります（登録: ④深掘り共有の権限）。',
  settings:
    '見本データのためコーチングの設定を変えられません。オン・オフ、共有の方針、記録の保存期間は店舗ごとの設定のため、設定画面の接続後に有効になります（登録: ⑤店舗設定ダイヤル）。',
} as const

const FOOTNOTE = '見本データのため、この画面から記録・共有・割り当てはできません — 実データ接続後に有効になります。'

export interface CoachingPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
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
  }
}

export interface CoachingPropsResult {
  props: CoachingProps
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. `page.tsx` keys the screen by it, so which
   *  tab is open and which step of the tour the reader is on reset when the
   *  store changes — the ⚖ 8/17 isolation law at the frame as well as the read. */
  storeKey: string
}

export async function coachingProps({ locale, store, world }: CoachingPropsInput): Promise<CoachingPropsResult> {
  void locale
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  // ONE CLOCK READ PER RENDER (the cycle-1 law): the window label, the trend's
  // month ticks and the dateline all derive from this one instant.
  const now = renderNow()
  const { y, m } = jstYmd(now)

  const roster = world?.roster ?? (await listStaff(lens)).map((s) => ({ id: s.id, name: s.full_name }))
  const role = world?.role ?? operator.role
  const selfId = world?.selfId ?? operator.staff_id
  const access = accessFor(role)
  const floor = sampleFloor(world?.floor)

  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'

  // ⚖ (1) THE MODULE GATE, ASKED FIRST. Off = the plane is never read, so the
  // dormant payload contains no coaching data at all rather than data a class
  // is hiding.
  const on = moduleOn(storeId, world?.enabledStores ?? coachingStores)
  const rows = on ? (world?.rows ?? coachingStaff) : []

  const self: SelfState = on ? buildSelfView({ selfId, rows, patterns: teamPatterns }) : { kind: 'none' }

  // ⚖ (2) THE TEAM BOARD IS ONLY BUILT FOR A READER WHO HOLDS THE CAPABILITY.
  // Not filtered afterwards — never built, so there is nothing in the payload
  // for a mis-wired component to find.
  const team: TriageView | null = on && access.viewTeam ? buildTriage({ roster, rows, floor }) : null

  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
  // personal-findings.ts:219 `window.date_range`, composed from the clock.
  const dateRange = `${fmtDay.format(windowStart)}〜${fmtDay.format(now)}`
  const windowLabel = `直近${WINDOW_DAYS}日（${dateRange}）`

  // contract.ts:47-51 MetricPoint — one tick per history point, newest LAST,
  // the axis always ending on the month the reader is in.
  const historyLength = self.kind === 'ready' ? self.view.history.length : 0
  const trendLabels = Array.from({ length: historyLength }, (_, i) =>
    fmtMonth.format(new Date(Date.UTC(y, m - 1 - (historyLength - 1 - i), 15))),
  )

  const props: CoachingProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    windowLabel,
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
    selfTabLabel: '自分のコーチング',
    teamTabLabel: '全スタッフ表示',
    canViewTeam: access.viewTeam,
    // canon's boundary-rights sentence (fable-coaching.html:363), kept verbatim
    // in meaning and spelled without the capability code, because a reader is
    // not owed our permission vocabulary.
    teamBoundaryLine:
      '全スタッフ表示は、店舗全体を見る権限のあるアカウントでのみ表示されます。現在は自分のコーチングのみを表示しています。',
    self:
      self.kind === 'ready'
        ? {
            kind: 'ready',
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
              countWarning: f.countChecks ? null : '根拠のセッション件数が一致しません。この件数は確認中です。',
              confidenceNote: f.confidenceNote,
            })),
            focus: self.view.focus.map((f) => ({
              category: f.category,
              categoryLabel: labelOf(self.view.categories, f.category),
              label: f.label,
              description: f.description,
              // staff-focus.ts:171 — 'early_signal' is capped at priority
              // 'medium' by the module's own rule, and it is SAID rather than
              // hidden: a thin signal presented as settled is the mislabelling
              // the whole floor exists to prevent.
              confidenceNote: f.confidence === 'early_signal' ? 'まだ初期の傾向です' : null,
            })),
            outcomes: {
              title: `不成約の理由（${windowLabel} ${self.view.noDealTotal}件）`,
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
          }
        : {
            kind: 'none',
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
            { key: 'building', label: '判断できる回数に未到達', value: `${team.counts.building}名` },
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
            trajectoryLine: r.band ? TRAJECTORY_LINE[r.band] : 'セッションの回数が判断できる数に届いていません。',
            action: r.suggestedAction ? { kind: r.suggestedAction.kind, label: r.suggestedAction.label } : null,
          })),
          adoptionLine: `深い共有を許可しているスタッフ ${team.sharingAdoption.granted}名 / 在籍 ${team.sharingAdoption.total}名`,
          adoptionNote:
            '誰が許可していないかは表示しません。共有はスタッフ本人が決めるもので、断っても勤務には影響しません。',
          limitNote:
            '在籍人数が少ない店舗では、区分だけにしても誰のことか分かってしまいます。区分はここでの見え方を「支援」に寄せるためのもので、匿名にするためのものではありません。',
        }
      : null,
    actionFootnote: FOOTNOTE,
    refusals: {
      regenerate: REFUSAL.regenerate,
      share: REFUSAL.share,
      depth: REFUSAL.depth,
      settings: REFUSAL.settings,
    },
    // The help actions' reasons ride the same table the ACTION does, so the
    // button a manager presses and the sentence it refuses with are decided in
    // one place (`coaching.ts`) rather than paired up by hand in the screen.
    helpRefusals: HELP_REFUSAL,
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}

const pct = (r: number) => `${Math.round(r * 100)}%`
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
