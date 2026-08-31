// 設定 — THE ROOM'S PROP ASSEMBLY, beside the page rather than inside it (the
// room-3 F1 law): the evidence harness imports THIS function, so an isolated
// shot runs the same assembly the deployed route does and a drift between them
// is a compile error rather than a picture nobody can check.
//
// ══ WHERE EVERY NUMBER ON THIS PAGE COMES FROM ══════════════════════════════
//
// ⚠ THIS ROOM OWNS NO DIAL VALUE THAT ANOTHER ROOM ALREADY OWNS. A settings page
// carrying its own copy of a store's dial is the second home the ⚖ one-truth law
// forbids — and the copy is the one the reader believes, so a page saying 「15分」
// while the board snaps to 30 is worse than a page saying nothing. Five of the
// dials below are read from the rooms that ship them:
//
//   スキマガード / 厳しさ          ← fixtures-today `storeBookingPolicy.gapGuardMode`
//   予約の移動単位                 ← fixtures-today `opsConfig.bookingStepMin`
//   予定ブロックの移動単位          ← fixtures-today `opsConfig.blockStepMin`
//   販売可能な最小の長さ            ← fixtures-today `opsConfig.minSellableMin`
//   上書き権限の現状               ← fixtures-today `storeBookingPolicy.overridePolicy`
//   現金差異の承認しきい値          ← fixtures-register `cashTolerance` / `MAX_CASH_TOLERANCE`
//   人件費を見られる役職            ← fixtures-shifts `shiftsPolicy.laborCostRoles`
//
// and the rest come from `fixtures-settings`, which exists for exactly the dials
// no shipped room owns a value for.
//
// ══ SCOPE IS PRINTED ON EVERY ROW, AND IT IS NOT DECORATION ═════════════════
//
// canon's own 予約ボードの操作 block says 「事業（…）の設定です」 — a BUSINESS
// setting, not a store one — and the world agrees: `opsConfig` /
// `storeBookingPolicy` are one object for the whole tenant, while the dial plane
// is keyed BY STORE. A manager who changes a business-wide dial believing it
// touches only their shop is the mistake-proofing law's own failure case, so
// every row states which it is and the store switcher proves it: switching
// stores moves the store-scoped values and leaves the business-scoped ones
// exactly where they were.
//
// EVERY DATE CROSSES THE CLIENT BOUNDARY AS A FORMATTED STRING (the family law):
// the screen holds no clock and no formatter.

import { defaultStoreId, listStoreOptions, renderNow, type StoreLens } from '@/business/lib/data'
import { operator } from '@/business/lib/fixtures'
import { cashTolerance, MAX_CASH_TOLERANCE } from '@/business/lib/fixtures-register'
import { storeDials, type StoreDials } from '@/business/lib/fixtures-settings'
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
  minutesLabel,
  RAIL,
  refusalFor,
  RETENTION_MAX_MONTHS,
  RETENTION_MIN_MONTHS,
  WIN_BACK_MAX,
  WIN_BACK_MIN,
  withCurrent,
  type DialId,
  type RailEntry,
} from '@/business/lib/settings'
import type { SettingsProps, SettingsSection, DialRow, RailRow } from './SettingsScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/** ⚖ 8/25 — a number says WHAT it counts. One home for the two units this room
 *  repeats, so 「61日」 on the row and 「14日」 in its guardrail are the same
 *  spelling by construction. */
const days = (n: number) => `${n}日`
const months = (n: number) => `${n}か月`

export interface SettingsPropsInput {
  locale: string
  store?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness and the suite need worlds this demo plane does not hold —
   *  a reader with no settings rights, a store whose dials are missing — and the
   *  only honest way to picture one is to run the REAL derivations on it. */
  world?: {
    role?: string
    dials?: StoreDials | null
  }
}

export interface SettingsPropsResult {
  props: SettingsProps
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. `page.tsx` keys the screen by it, so which
   *  section is open resets when the store changes — the ⚖ 8/17 isolation law at
   *  the frame as well as the read. */
  storeKey: string
}

export async function settingsProps({ locale, store, world }: SettingsPropsInput): Promise<SettingsPropsResult> {
  void locale
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }
  void lens

  const now = renderNow()
  const role = world?.role ?? operator.role
  const access = accessFor(role)
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'

  // ⚠ THE STORE CLAMP IS THE READ, not a filter after it: one store's dials are
  // fetched by id and no other store's row is ever in the payload (⚖ 8/17).
  const dials = world?.dials !== undefined ? world.dials : clamped ? (storeDials[storeId!] ?? null) : null

  const sections = RAIL.map((entry) => buildSection(entry, access, dials, lensLabel))
  const opening = firstOpenSection(access)

  const props: SettingsProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    subtitle:
      'お店の決まりごとと、自分の見え方をここでまとめて変えます。いま画面が出しているのは、それぞれの機能が実際に使っている値です。',
    rail: RAIL.map<RailRow>((entry) => ({
      id: entry.id,
      group: entry.group,
      label: entry.label,
      state: gateOf(entry, access) === 'no-rights' ? 'no-rights' : entry.live ? 'live' : 'soon',
      scope: entry.scope,
    })),
    railHeading: '設定カテゴリー',
    sections,
    openingSectionId: opening?.id ?? null,
    // ⚠ TRUE ON EVERY SECTION (the room-5 F5-1 law): the head is the one element
    // this room renders whichever section is open, so nothing here may describe
    // a screen the reader is not on.
    noSaveLine:
      'この画面からは保存できません。見本データのため、お店の設定はどれも読み取り専用です — 実データの接続後に変更できるようになります。',
    boundaryFallback:
      '設定を変更できる権限がありません。店舗の設定は、権限のあるアカウントでのみ表示されます。',
    // The demo persona, so the boundary sentences can say who is reading rather
    // than 「あなた」 to somebody who is not who the page thinks they are.
    roleLabel: role,
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}

// ── the sections ────────────────────────────────────────────────────────────

function buildSection(
  entry: RailEntry,
  access: ReturnType<typeof accessFor>,
  dials: StoreDials | null,
  lensLabel: string,
): SettingsSection {
  const gate = gateOf(entry, access)
  const base = {
    id: entry.id,
    group: entry.group,
    label: entry.label,
    scope: entry.scope,
    gate,
    boundaryLine: gate === 'no-rights' ? boundaryLineFor(entry, access.role) : null,
  }

  // ⚠ THE GATE IS ANSWERED PER SECTION AND NOTHING BELOW IT RUNS FOR A CLOSED
  // ONE: a section a reader may not open has no dials in its payload at all,
  // rather than dials a class is hiding.
  if (gate === 'no-rights') {
    return { ...base, kicker: '権限', title: entry.label, lead: '', dials: [], aside: null, soon: null, prefs: false }
  }

  if (entry.scope === 'self') return selfSection(base)
  if (!entry.live) return soonSection(base, entry)
  if (dials === null) return noStoreSection(base, entry)
  return storeSection(base, entry, dials, lensLabel)
}

type SectionBase = Pick<SettingsSection, 'id' | 'group' | 'label' | 'scope' | 'gate' | 'boundaryLine'>

function boundaryLineFor(entry: RailEntry, role: string): string {
  // ⚠ `business.manage` IS NOT ONE OF THE EIGHT REAL TOKENS (DIAL-HOME-MAP (c)2).
  // canon's roster comment names it to explain this exact row, and the honest
  // sentence says the row is not reachable for anyone yet rather than implying a
  // permission somebody could be granted.
  if (entry.needs === 'business.manage') {
    return `${entry.label}は、いまのアカウントの権限では開けません。この画面を開くための権限そのものがまだ用意されていないため、どの役職からも開けない状態です（登録: ②設定の権限トークン）。`
  }
  return `${entry.label}は、${role}の権限では開けません。この設定を変更できる権限を持つアカウントでのみ表示されます。`
}

function selfSection(base: SectionBase): SettingsSection {
  return {
    ...base,
    kicker: '保存範囲: 自分',
    title: '自分の表示設定',
    // canon fable-settings-colors.html:495, kept in meaning: 個人スコープ、権限ゲートなし.
    lead: 'ボードの見え方の好みは人によって分かれます。ここは自分だけの設定で、ほかの人の画面は変わりません。権限に関わらず、どのアカウントでも変更できます。',
    dials: [],
    aside: {
      title: 'この設定について',
      lines: [
        { label: '保存範囲', value: 'この端末のこのブラウザだけ' },
        { label: '他のスタッフ', value: '影響しません' },
        { label: '権限', value: '不要（お店の設定とは別です）' },
      ],
      note: 'お店の設定が変えられないアカウントでも、ここは変えられます。自分の見え方は自分のものだからです。',
    },
    soon: null,
    prefs: true,
  }
}

function noStoreSection(base: SectionBase, entry: RailEntry): SettingsSection {
  return {
    ...base,
    kicker: '店舗を選んでください',
    title: entry.label,
    lead: 'お店の設定は店舗ごとの値です。左上の店舗の切替でどの店舗を見るか選ぶと、その店舗の値が表示されます。',
    dials: [],
    aside: null,
    soon: null,
    prefs: false,
  }
}

/** ⚖ BIG-TECH SIMPLICITY: 準備中 is a DESIGNED panel, never an option wall and
 *  never a blank. It says what will live here and what is already true today, so
 *  a reader who came looking for a dial learns where the answer is instead of
 *  finding a grey rectangle. */
function soonSection(base: SectionBase, entry: RailEntry): SettingsSection {
  const soon = SOON[entry.id]
  return {
    ...base,
    kicker: '準備中',
    title: entry.label,
    lead: soon.body,
    dials: [],
    aside: null,
    soon: { title: 'ここに入る予定のもの', body: soon.today, willCarry: soon.willCarry },
    prefs: false,
  }
}

const SOON: Record<string, { body: string; today: string; willCarry: string[] }> = {
  services: {
    body: 'メニューと回数券の設定です。いまはカルテとレジがそれぞれの画面で扱っています。',
    today: 'メニューの一覧は「今日の運営」の予約作成と、レジの会計で使われています。',
    willCarry: ['カテゴリーとメニュー', '回数券の整合', '新規のお客様の所要時間'],
  },
  'people-equipment': {
    body: 'スタッフと設備・枠の登録です。いまは「スタッフ・シフト」が名簿と勤務を扱っています。',
    today: '名簿と勤務時間は「スタッフ・シフト」で確認できます。',
    willCarry: ['スタッフ', '設備・枠', 'シフトの初期設定'],
  },
  'business-structure': {
    body: '事業体・店舗・本部の構成です。',
    today: '店舗の切替は左上のカードで行えます。',
    willCarry: ['事業体', '店舗', 'ブランド・本部'],
  },
  ai: {
    body: 'カルテのAIが何をどう書くかの設定です。',
    today: 'AIの要約はカルテの各記録に表示されています。',
    willCarry: ['要約スタイル', '転帰の選択肢', 'AI相談', '業種プロファイル'],
  },
  sync: {
    body: 'Reserveの予約をどう取り込むかの設定です。',
    today: '同期の状況は画面右上の「Reserve同期」に出ています。',
    willCarry: ['同期ステータス', '同期の間隔', '重なったときの優先ルール'],
  },
  'reserve-acceptance': {
    body: 'お客様がReserveで予約できる範囲の設定です。',
    today: 'お客様が選べる開始時刻は、このページの「予約の移動単位」とは別の設定です。',
    willCarry: ['受付ウィンドウ', 'キャンセル規定', '価格の見え方'],
  },
  notifications: {
    body: 'お客様とスタッフへの通知の設定です。',
    today: '予約とキャンセルの連絡は「受信トレイ」に集まります。',
    willCarry: ['予約・キャンセルの通知', '価格・ガードのお知らせ', '静かな時間'],
  },
  integrations: {
    body: '外部サービスとのつなぎ込みの設定です。',
    today: 'いまつながっているのはReserveの予約同期だけです。',
    willCarry: ['連携の一覧', '接続と解除'],
  },
  'data-io': {
    body: 'データの書き出しと取り込みの設定です。',
    today: '顧客の書き出しはカルテのQR書き出しで行えます。',
    willCarry: ['エクスポート', 'インポート', '書き出しの権限'],
  },
  'audit-log': {
    body: '誰がいつ何を変えたかの記録です。',
    today: '記録そのものはすでにサーバー側に残っています。読む画面がまだありません。',
    willCarry: ['絞り込み', '変更記録'],
  },
  billing: {
    body: '契約と請求の設定です。Webからのみ変更できます。',
    today: '請求はまだ発生していません。',
    willCarry: ['プラン', '支払い方法', '請求の履歴', '解約'],
  },
}

// ── the store sections, and their dials ─────────────────────────────────────

function storeSection(base: SectionBase, entry: RailEntry, d: StoreDials, lensLabel: string): SettingsSection {
  switch (entry.id) {
    case 'store-hours':
      return {
        ...base,
        kicker: '予約ボードの操作',
        title: '店舗情報・営業時間',
        lead: '「今日の運営」のボードで、予約や予定ブロックを動かすときの刻みと、空きの守り方です。',
        dials: [guardDial(), bookingStepDial(), blockStepDial(), minSellableDial(), breaksPaidDial(d)],
        aside: {
          title: 'この値の出どころ',
          lines: [
            { label: 'スキマガード', value: '今日の運営が実際に使っている値' },
            { label: '移動単位', value: '今日の運営のドラッグが実際に使っている値' },
            { label: '上書きできる人', value: `${storeBookingPolicy.overridePolicy.roles.join('・')} — 変更はスタッフ管理から` },
            { label: '休憩の有給扱い', value: '人件費の計算はいま休憩を除いています' },
          ],
          note: 'まだつないでいないものは、それぞれの行に理由を書いています。店舗情報・営業時間・臨時休業は、この画面ではまだ扱いません。',
        },
        soon: null,
        prefs: false,
      }
    case 'payments':
      return {
        ...base,
        kicker: 'レジ',
        title: '決済',
        lead: 'レジの締めで、現金の差異をどこまで理由なしで通してよいかの設定です。',
        dials: [cashToleranceDial()],
        aside: {
          title: 'この値の出どころ',
          lines: [
            { label: '現在のしきい値', value: yen(cashTolerance) },
            { label: '読んでいる画面', value: '売上・レジ の締め' },
            { label: '上限', value: `${yen(MAX_CASH_TOLERANCE)}（これ以上は設定できません）` },
          ],
          note: '支払い方法とポイント制の設定は、この画面ではまだ扱いません。',
        },
        soon: null,
        prefs: false,
      }
    case 'customer-contact':
      return {
        ...base,
        kicker: '再来促し',
        title: '顧客・連絡',
        lead: 'しばらくご来店のないお客様に、カルテがお声がけの案を出すまでの日数です。',
        dials: [winBackDial(d)],
        aside: {
          title: 'この値の出どころ',
          lines: [
            { label: 'この店舗の日数', value: days(clampWinBackDays(d.winBackDays)) },
            { label: '同じ値を使う画面', value: 'カルテ（スマホ）のお声がけの案' },
            { label: '値の置き場所', value: 'core にひとつ（二か所には持ちません）' },
          ],
          note: '同じ数字がカルテとBusinessの両方に出るため、値はcore側にひとつだけ置きます。',
        },
        soon: null,
        prefs: false,
      }
    case 'pricing-points':
      return {
        ...base,
        kicker: '料金',
        title: '料金・ポイント',
        lead: '空いている時間帯の価格を自動で下げて売るかどうかの、店舗全体の切り替えです。',
        dials: [dynamicPricingDial(d)],
        aside: {
          title: 'いま実際に起きていること',
          lines: [
            { label: '店舗全体の切り替え', value: 'まだありません' },
            { label: '割引の深さ', value: '料金表から計算しています（設定値ではありません）' },
            { label: 'ボードの表示', value: '見る人ごとの表示設定です（お店の設定ではありません）' },
          ],
          note: 'ポイント制の設定は、この画面ではまだ扱いません。',
        },
        soon: null,
        prefs: false,
      }
    case 'recording':
      return {
        ...base,
        kicker: '録音',
        title: '録音設定',
        lead: 'スタッフの録音から起こした文字を、誰が読めるようにするかの設定です。',
        dials: [transcriptDial(d)],
        aside: {
          title: 'この設定について',
          lines: [
            { label: '初期値', value: 'スタッフのみ（安全な側）' },
            { label: '判定する場所', value: 'サーバー側のデータの入口' },
            { label: '録音の同意', value: '製品の決まりです（店舗ごとの切り替えはありません）' },
          ],
          note: '画面側で隠すだけでは守れないため、誰が読めるかはサーバー側で判定します。設定を変えたことは記録に残ります。',
        },
        soon: null,
        prefs: false,
      }
    case 'coaching':
      return {
        ...base,
        kicker: 'コーチング',
        title: 'コーチング',
        lead: `接客の振り返りを${lensLabel}で使うかどうかと、その見せ方の決まりです。`,
        dials: [coachingEnabledDial(d), coachingSharingDial(d), coachingRetentionDial(d), coachingFloorDial(d)],
        aside: {
          title: 'この設定について',
          lines: [
            { label: 'この店舗', value: d.coachingEnabled ? '使っています' : '使っていません' },
            { label: '深い共有', value: 'スタッフ本人が許可したときだけ' },
            { label: '会話の引用', value: '許可しても店長には渡りません' },
          ],
          note: '断ったスタッフが誰かは、どの画面にも表示されません。共有は評価のためではなく、支援を配るためのものです。',
        },
        soon: null,
        prefs: false,
      }
    case 'staff':
      return {
        ...base,
        kicker: '権限',
        title: 'スタッフ管理',
        lead: '誰が何をできるかの設定です。いまの権限の仕組みでは足りない部分が二つあり、どちらもこの画面からは変えられません。',
        dials: [overrideRightsDial(), settingsRightsDial()],
        aside: {
          title: 'いまの権限の仕組み',
          lines: [
            { label: '設定の権限', value: '「設定を変更できる」ひとつだけ（ページごとには分かれていません）' },
            { label: '上書きの権限', value: '権限の一覧に項目がありません' },
            { label: '人件費を見られる役職', value: shiftsPolicy.laborCostRoles.join('・') },
          ],
          note: 'スタッフ一覧と招待は、この画面ではまだ扱いません。',
        },
        soon: null,
        prefs: false,
      }
    case 'language-display':
      return {
        ...base,
        kicker: '表示',
        title: '言語・表示',
        lead: 'この画面を何語で表示するかの設定です。',
        dials: [languageDial(d)],
        aside: {
          title: 'いまの状態',
          lines: [
            { label: '表示言語', value: '日本語' },
            { label: '対応予定', value: 'すべての画面を言語に対応させる作業をこれから行います' },
            { label: 'スマホ', value: '端末の言語に合わせる形を予定しています' },
          ],
          note: '予約の色分けの設定は、この画面ではまだ扱いません。',
        },
        soon: null,
        prefs: false,
      }
    default:
      // Unreachable while RAIL and this switch agree — and the suite proves they
      // do, section by section, rather than trusting the comment.
      return soonSection(base, entry)
  }
}

// ── the dial rows ───────────────────────────────────────────────────────────
//
// ⚖ EVERY STORE DIAL CARRIES THE MISTAKE-PROOFING TRIO (Liam 8/21): the value it
// DEFAULTS to, the GUARDRAIL that stops a store harming itself with it, and the
// 業種 note where a ruling actually gave one. A dial with no ruled type default
// says 「業種による初期値の決まりはありません」 rather than inventing one.

/** ⚠ A DIAL CANNOT BE BUILT WITHOUT ITS REGISTRY-NAMED REASON, and that is a
 *  COMPILE-TIME fact rather than a review note: the builders below hand over
 *  everything except `refusal`, and the id they pass is a `DialId`, so a new dial
 *  with no entry in the refusal table does not typecheck. */
const dial = (row: Omit<DialRow, 'refusal'> & { id: DialId }): DialRow => ({ ...row, refusal: refusalFor(row.id) })

const BUSINESS_SCOPE = '事業全体'
const STORE_SCOPE = 'この店舗'

const GUARD_MODES: Array<{ value: string; label: string }> = [
  { value: 'off', label: 'オフ' },
  { value: 'standard', label: '標準' },
  { value: 'strict', label: '厳格' },
]

function guardDial(): DialRow {
  return dial({
    id: 'guard-mode',
    label: 'スキマガード',
    description: '空きが売れない形になる置き方を防ぎます。標準は、上書きできる人だけが承知のうえで置けます。厳格は上書きを許しません。',
    scopeLabel: BUSINESS_SCOPE,
    control: { kind: 'segment', options: GUARD_MODES, current: storeBookingPolicy.gapGuardMode },
    trio: {
      base: '初期値: 標準',
      guardrail: 'オフにしても、どこに置いても損が避けられない区間は警告と記録が残ります。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function bookingStepDial(): DialRow {
  return dial({
    id: 'booking-step',
    label: '予約の移動単位',
    description: 'スタッフがボードで予約を動かすときの刻みです。お客様がReserveで選べる開始時刻とは別の設定です。',
    scopeLabel: BUSINESS_SCOPE,
    control: {
      kind: 'segment',
      options: withCurrent([15, 30, 60], opsConfig.bookingStepMin).map((m) => ({ value: String(m), label: minutesLabel(m) })),
      current: String(opsConfig.bookingStepMin),
    },
    trio: {
      base: '初期値: 30分',
      guardrail: '細かくするほどボードの操作は敏感になります。既にある予約は、いまの位置のまま刻みだけが変わります。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function blockStepDial(): DialRow {
  return dial({
    id: 'block-step',
    label: '予定ブロックの移動単位',
    description: '休憩・準備・記録・レジ・清掃を動かすときの刻みです。',
    scopeLabel: BUSINESS_SCOPE,
    control: {
      kind: 'segment',
      options: withCurrent([5, 10, 15, 30], opsConfig.blockStepMin).map((m) => ({ value: String(m), label: minutesLabel(m) })),
      current: String(opsConfig.blockStepMin),
    },
    trio: {
      base: '初期値: 5分',
      guardrail: '既にある予定ブロックは、いまの位置のまま刻みだけが変わります。近い刻みへ勝手に丸めることはしません。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function minSellableDial(): DialRow {
  return dial({
    id: 'min-sellable',
    label: '販売可能な最小の長さ',
    description: 'これより短い空きは、お店として売りに出しません。ボードにも案内が出ません。',
    scopeLabel: BUSINESS_SCOPE,
    control: {
      kind: 'segment',
      options: withCurrent([15, 30, 45, 60], opsConfig.minSellableMin).map((m) => ({ value: String(m), label: minutesLabel(m) })),
      current: String(opsConfig.minSellableMin),
    },
    trio: {
      base: '初期値: 30分',
      guardrail: '短くしすぎると、受けきれない細切れの予約が入ります。0分にはできません。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function breaksPaidDial(d: StoreDials): DialRow {
  return dial({
    id: 'breaks-paid',
    label: '休憩の有給扱い',
    description: '人件費の概算で、休憩の時間ぶんも払うものとして計算するかどうかです。',
    scopeLabel: STORE_SCOPE,
    control: { kind: 'switch', on: d.breaksPaid, onLabel: '有給（休憩も含めて計算）', offLabel: '無給（休憩を除いて計算）' },
    trio: {
      base: '初期値: 無給',
      guardrail: `金額を動かす設定のため、人件費を見られる役職（${shiftsPolicy.laborCostRoles.join('・')}）だけが変えられます。`,
      businessType: '業種による初期値: サロンは無給、固定シフトのお店は有給が多いです。',
    },
  })
}

function cashToleranceDial(): DialRow {
  return dial({
    id: 'cash-tolerance',
    label: '現金差異の承認しきい値',
    description: 'レジを締めるとき、この金額までの差異は理由なしで通せます。これを超えると、店舗管理者の承認が必要になります。',
    scopeLabel: BUSINESS_SCOPE,
    control: { kind: 'readout', text: yen(cashTolerance), unit: '', numeric: true },
    trio: {
      base: '初期値: ¥0',
      guardrail: `上限は${yen(MAX_CASH_TOLERANCE)}です。これ以上にすると、取引まるごとの抜けが差異として通ってしまいます。`,
      businessType: '業種による初期値: 施術のお店は¥0、少額の現金売りが多いお店は数百円が目安です。',
    },
  })
}

function winBackDial(d: StoreDials): DialRow {
  const value = clampWinBackDays(d.winBackDays)
  return dial({
    id: 'win-back',
    label: '再来促しの日数',
    description: '最後のご来店からこの日数が経つと、カルテにお声がけの案が出るようになります。',
    scopeLabel: STORE_SCOPE,
    control: { kind: 'readout', text: days(value), unit: '', numeric: true },
    trio: {
      base: '初期値: 61日',
      guardrail: `${days(WIN_BACK_MIN)}より短くも、${days(WIN_BACK_MAX)}より長くも設定できません。短すぎるとまだ来る時期でない方に届き、長すぎると引っ越された方に届きます。`,
      businessType: '業種による初期値: 来店の間隔は業種で大きく違うため、業種ごとの初期値を持ちます。',
    },
  })
}

function dynamicPricingDial(d: StoreDials): DialRow {
  return dial({
    id: 'dynamic-pricing',
    label: '動的価格',
    description: '空いている時間帯の価格を自動で下げて売るかどうかです。',
    scopeLabel: STORE_SCOPE,
    control: { kind: 'switch', on: d.dynamicPricing, onLabel: '使う', offLabel: '使わない' },
    trio: {
      base: '初期値: 使わない',
      guardrail: '割引の深さには上限があり、料金表より下がらないところで止まります。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function transcriptDial(d: StoreDials): DialRow {
  return dial({
    id: 'transcript-visibility',
    label: '文字起こしの公開範囲',
    description: 'スタッフの録音から起こした文字を、店長・オーナーも読めるようにするかどうかです。',
    scopeLabel: STORE_SCOPE,
    control: {
      kind: 'segment',
      options: [
        { value: 'staff-only', label: 'スタッフのみ' },
        { value: 'managers-too', label: '管理者も閲覧可' },
      ],
      current: d.transcriptVisibility,
    },
    trio: {
      base: '初期値: スタッフのみ',
      guardrail: 'スタッフは録音を始める前に、いまどちらの設定かを必ず見られます。設定を変えたことは記録に残ります。',
      businessType: '業種による初期値の決まりはありません。プライバシーは業種で変わらないためです。',
    },
  })
}

function coachingEnabledDial(d: StoreDials): DialRow {
  return dial({
    id: 'coaching-enabled',
    label: 'コーチングの利用',
    description: 'この店舗で接客の振り返りを使うかどうかです。オフのあいだは分析が動かず、成績も気づきも出ません。',
    scopeLabel: STORE_SCOPE,
    control: { kind: 'switch', on: d.coachingEnabled, onLabel: '使う', offLabel: '使わない' },
    trio: {
      base: '初期値: 使わない（お申し込みで使えるようになります）',
      guardrail: 'オフにしても、すでにある記録は消えません。保存期間の設定に従います。',
      businessType: '業種による初期値: 会話の項目名は業種の言葉に合わせて変わります。',
    },
  })
}

function coachingSharingDial(d: StoreDials): DialRow {
  return dial({
    id: 'coaching-sharing',
    label: '共有の方針',
    description: 'スタッフが自分の振り返りを誰かに見せられるようにするかどうかの範囲です。許可を出すのは常に本人です。',
    scopeLabel: STORE_SCOPE,
    control: {
      kind: 'segment',
      options: [
        { value: 'manager-grant', label: '店長への共有まで' },
        { value: 'peer', label: 'スタッフ同士も' },
      ],
      current: d.coachingSharing,
    },
    trio: {
      base: '初期値: 店長への共有まで',
      guardrail: 'どちらでも初期は全員オフです。断っても勤務に影響せず、断ったことは誰にも表示されません。会話の引用は許可しても渡りません。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function coachingRetentionDial(d: StoreDials): DialRow {
  const value = clampCoachingRetention(d.coachingRetentionMonths)
  return dial({
    id: 'coaching-retention',
    label: '記録の保存期間',
    description: '振り返りの記録をどれくらいの期間もっておくかです。',
    scopeLabel: STORE_SCOPE,
    control: { kind: 'readout', text: months(value), unit: '', numeric: true },
    trio: {
      base: '初期値: 12か月',
      guardrail: `${months(RETENTION_MIN_MONTHS)}より短くも、${months(RETENTION_MAX_MONTHS)}より長くも設定できません。短すぎると前と比べられず、長すぎると本人が辞めたあとも記録が残ります。`,
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function coachingFloorDial(d: StoreDials): DialRow {
  const value = clampCoachingFloor(d.coachingSampleFloor)
  return dial({
    id: 'coaching-floor',
    label: '判断に必要なセッション数',
    description: 'この回数に届くまでは、そのスタッフの区分を出しません。「まだ判断できません」と表示します。',
    scopeLabel: STORE_SCOPE,
    control: { kind: 'readout', text: `${value}回`, unit: '', numeric: true },
    trio: {
      base: '初期値: 20回',
      guardrail: `${COACHING_FLOOR_MIN}回より少なくも、${COACHING_FLOOR_MAX}回より多くも設定できません。少なすぎるとまぐれが評価になり、多すぎると画面が事実上オフになります。`,
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function languageDial(d: StoreDials): DialRow {
  return dial({
    id: 'display-language',
    label: '表示言語',
    description: 'この画面を何語で表示するかです。',
    scopeLabel: STORE_SCOPE,
    control: {
      kind: 'segment',
      options: [{ value: 'ja', label: '日本語' }],
      current: d.displayLanguage,
    },
    trio: {
      base: '初期値: 端末の言語に合わせる（予定）',
      guardrail: '対応していない言語を選んでも、日本語のまま表示します。空白の画面にはしません。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

// ── the two permission rows, refused by design (DS-3) ───────────────────────
//
// ⚠ THESE TWO ARE NOT DIALS THIS ROOM COULD BUILD. Both need a capability token
// that does not exist in canon's own eight-token legend, which is a core change,
// not a settings-page decision (DIAL-HOME-MAP conflicts (c)1 and (c)3). They
// render as rows so the reader can see WHAT is missing and where the ask lives —
// the ⚖ 8/17 rule is that a surface with no capability points at its registry
// line rather than guessing a contract.

function overrideRightsDial(): DialRow {
  const p = storeBookingPolicy.overridePolicy
  return dial({
    id: 'override-rights',
    label: '「置けない」場所への上書き',
    description: 'スキマガードが止めた場所に、承知のうえで置ける役職と、名指しで止めるスタッフの指定です。',
    scopeLabel: BUSINESS_SCOPE,
    control: {
      kind: 'readout',
      text: p.roles.join('・'),
      unit: p.lockedOut.length === 0 ? '個別に止めているスタッフはいません' : `個別に止めているスタッフ ${p.lockedOut.length}名`,
      numeric: false,
    },
    trio: {
      base: '初期値: オーナー・店舗管理者・スタッフ',
      guardrail: '全員を上書き不可にはできません。どこに置いても損が避けられない日に、誰も予約を入れられなくなるためです。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

function settingsRightsDial(): DialRow {
  return dial({
    id: 'settings-rights',
    label: '設定を変更できる権限',
    description: 'どの設定を誰が変えられるかです。いまは設定ページ全体でひとつの権限になっています。',
    scopeLabel: BUSINESS_SCOPE,
    control: { kind: 'readout', text: '設定ページ全体でひとつ', unit: 'ページごとには分かれていません', numeric: false },
    trio: {
      base: '初期値: オーナーと店舗管理者',
      guardrail: '設定を変更できる人を全員外すことはできません。誰も設定を戻せなくなるためです。',
      businessType: '業種による初期値の決まりはありません。',
    },
  })
}

/** The dial ids this room renders, in rail order. Exported so the suite can
 *  prove the census rather than re-listing it — a dial added without a refusal,
 *  a trio or a registry line fails there. */
export const RENDERED_DIALS: readonly DialId[] = [
  'guard-mode',
  'booking-step',
  'block-step',
  'min-sellable',
  'breaks-paid',
  'cash-tolerance',
  'win-back',
  'dynamic-pricing',
  'transcript-visibility',
  'coaching-enabled',
  'coaching-sharing',
  'coaching-retention',
  'coaching-floor',
  'override-rights',
  'settings-rights',
  'display-language',
]
