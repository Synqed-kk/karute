// AI相談 — the room's PROP ASSEMBLY, beside the page rather than inside it.
//
// WHY THIS FILE EXISTS (the room-3 F1 law, inherited from day one): the evidence
// harness imports THIS function, so an isolated shot is the same assembly the
// deployed page runs and a drift between them is a compile error rather than a
// picture nobody can check. `page.tsx` keeps the admission gate, the route
// params and the sheet import — the things a route entry owns.
//
// THE CLOCK LIVES HERE AND NOWHERE ELSE. `ask-ai.ts` is pure, so it is TOLD
// which bookings are today's and which are still ahead rather than asking; the
// screen holds no clock, no formatter and no data access at all.
//
// ⚠ THE DENIAL HAPPENS ABOVE THE SERIALIZER. A reader whose persona does not
// resolve to a preset holding `customers.view` gets props with no suggestion, no
// question, no answer and no customer's name in them — not a rendered surface
// hidden behind a flag. That is what the both-ways permission pin measures.
//
// ⚠ AND SO DOES THE STORE CLAMP. Every read below goes through the clamped
// fixture door, and a suggestion, an evidence line or an 出典 row whose record
// does not reach the lens through one of those bookings never ENTERS the model
// (⚖ the 8/17 isolation law) — which is what the leaves-nothing-behind pin
// scans the serialized payload for.

import { jstDayKey } from '@/business/lib/clock'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listStaff,
  listStoreOptions,
  renderNow,
  type StoreLens,
} from '@/business/lib/data'
import { operator } from '@/business/lib/fixtures'
import { threads as threadPlane } from '@/business/lib/fixtures-inbox'
import { records as recordPlane } from '@/business/lib/fixtures-karute'
import {
  businessType as planeBusinessType,
  conversation as conversationPlane,
  genericTemplates as genericTemplatePlane,
  signals as signalPlane,
  suggestions as suggestionPlane,
  templates as templatePlane,
  type FixtureSignal,
  type FixtureSuggestion,
  type FixtureTemplate,
  type FixtureTurn,
} from '@/business/lib/fixtures-ask-ai'
import {
  accessFor,
  buildConversation,
  buildFeed,
  buildSignals,
  buildTemplates,
  DISMISS_TOAST,
  FOOTNOTE,
  permissionNotice,
  REFUSAL,
  scopeCounts,
  type AskAiWorld,
} from '@/business/lib/ask-ai'
import { type AskAiCardProps, type AskAiProps } from './AskAiScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })

/** The phone's own words, where the desk shows the same meaning — ⚖ the
 *  recognition floor (`messages/ja.json` askAi, line ~3179). A staffer who reads
 *  this app on a phone all day must land here and already know the vocabulary.
 *  ⚠ `suggestion1`–`suggestion4` in that namespace are DEAD keys (no component
 *  consumes them) and are deliberately not carried (⚖ D-5); `thinking` is
 *  carried NOWHERE, because a sealed room that rendered it would be pretending
 *  to think (⚖ D-2). */
const PHONE = {
  subtitle: 'お店に関することを何でも質問してください。回答はカルテ・お客様・録音データに基づきます。',
  scopeTitle: '接続済みデータ',
  startHint: '上のプロンプトを選ぶか、質問を入力して会話を始めてください。',
  placeholder: 'お店について質問してください — 例：「今週再予約が必要なお客様は？」',
  inputHint: '回答はお店のデータに基づきます · 改行は Shift + Enter',
  sendLabel: '送信',
  profileNotSet: '業種が未設定です',
  profileNotSetBody: '「設定」で業種を選ぶと、お店の用語に合わせてAIが調整され、業種別のおすすめプロンプトが表示されます。',
  profileCta: '設定する',
  tunedFor: '最適化対象：',
} as const

/** ⚖ THE DESK'S OWN NEW SENTENCES (S15), written from scratch in native
 *  register — not one of them is a translation of an English line, and none
 *  carries a mid-sentence dash. */
const DESK = {
  /** The trust row's disclosure. It names BOTH halves a reader might be asking
   *  about, because the row it opens under is a row of counts and the two
   *  questions those counts raise are 「what does an answer actually read?」 and
   *  「is what I type kept?」. */
  why: '回答が読み取るもの・相談の保存について',
  /** …and the third line inside it: where the 今日 hints come from. The words
   *  are the phone's own hint (`messages/ja.json` askAi.todayHintsHint), made a
   *  whole sentence because here it stands on its own instead of under a
   *  heading that already said 今日のヒント. */
  hintNote: '質問のヒントの「今日」は、今日の予約とカルテから自動で提案しています。',
  /** The dashed chip a shop with no 業種 wears, in the trust row's own grammar:
   *  the same slot the 最適化対象 chip uses, saying what is missing instead. */
  unsetType: '業種：未設定',
  traceTitle: 'この画面の値の設定元',
  traceLead: 'この画面が出している値の出どころです。まだつないでいないものは「未接続」と書いています。',
  /** The collapsed bar at the foot of the page. It names both of the things
   *  behind it, so a reader who only wants the 見本データ note knows it is in
   *  there too. */
  footnoteBar: 'この画面の値の設定元 ・ 見本データについて',
  undo: '元に戻す',
} as const

/** ⚖ THE PRIVACY LINE SAYS WHAT IS TRUE, and both halves come from the shipped
 *  contract rather than from a reassuring instinct:
 *  · nothing is kept — history lives in the client's own state and is re-sent
 *    whole on every request, and the ONE server write is an audit row counting
 *    the exchange (`src/app/api/ai/chat/route.ts:113-119`, `{ first_turn,
 *    history_len }` — never message text). Registry ③.
 *  · what an ANSWER reads is karute content, ten recent customer names and the
 *    business type (`src/lib/ai/karute-chat.ts:75-109`). No booking data, no raw
 *    transcript. The 予約 chip above counts what the STORE has connected — the
 *    phone's own four facts — so this line is what keeps the strip from being
 *    read as a promise the answer cannot keep. */
const PRIVACY = [
  '相談の内容は保存されません。記録として残るのは、AI相談を使った回数だけです。',
  '回答が読み取るのは、この店舗のカルテとお客様の記録です。予約の中身そのものは読み取りません。',
]

/** この画面の値の設定元 — REWRITTEN FOR TRUTH (canon's trace card gives its rows
 *  to 録音設定 / 予約同期, neither of which exists at this tip). Every row states
 *  something real or says 未接続, and the 未接続 rows name the room that will own
 *  them: the 設定 room builds LAST (contract v2), so until it lands this card is
 *  where a reader finds out that nothing is deciding these values yet. */
const TRACE: Array<{ label: string; value: string; unconnected: boolean }> = [
  // ⚠ TRUTH-FIX AT THE MAIN-MOVED FOLD (S15): 「設定画面は準備中です」 stopped
  // being true when the 設定 room merged (#812). It holds 予約と確保; the AI
  // items are not in it yet, which is a narrower and honest thing to say.
  { label: '提案の積極度', value: 'AI設定（未接続 — 設定画面にAIの項目がまだありません）', unconnected: true },
  { label: '提案のカテゴリ', value: 'AI設定（未接続 — 顧客フォロー / スタッフ配置・欠勤対応 / 予約・空き待ち案内 / VIP・ロイヤルティ）', unconnected: true },
  { label: '回答の言語', value: 'AI設定（未接続 — いまは日本語で表示しています）', unconnected: true },
  { label: '回答が読み取るデータ', value: 'この店舗のカルテとお客様の記録', unconnected: false },
  { label: '相談の履歴', value: '保存しません（残るのは利用回数のみ）', unconnected: false },
  { label: '提案のもとになるデータ', value: '見本データ（未接続 — 実データの提案は接続後）', unconnected: true },
]

/** Canon's own empty state (fable-ask-ai.html:353-356), verbatim in meaning —
 *  and RESERVED for a store with genuinely nothing to show. */
const EMPTY_FEED = {
  title: '提案はまだありません',
  body: '録音記録の確定・予約の変化・欠勤や空き待ちの発生があると、ここに新しい提案が表示されます。',
}

/** …AND THE OTHER EMPTY (F2-1). A reader who has just 却下'd the last card was
 *  told 「提案はまだありません」 — the one sentence that is false about the state
 *  they made, and it quietly contradicted the toast they had read four times.
 *  The honest state is derived rather than guessed: the feed ARRIVED with rows,
 *  and this visit emptied it. The second line is the truth the toast already
 *  tells, said once more where the reader is now looking. */
const EMPTY_DISMISSED = {
  title: 'この画面で提案をすべて却下しました',
  body: '却下は保存されないため、画面を開き直すと元に戻ります。',
}

/** Boundary markup, present-but-inert — the matrix row `nav.record_ai.ai_consult`
 *  defines only a boundary-ENTITLEMENT state (no `by_rights` variant), so there
 *  is one mount and one copy, canon's own (fable-ask-ai.html:372-377). */
const BOUNDARY = {
  kicker: 'この機能は含まれていません',
  title: 'AI相談は Karute プランでご利用いただけます。現在の事業（Reserveのみ）には含まれていません。',
  body: 'AIが提案する次のアクションを使うには Karute プランへの切り替えが必要です。',
  backLabel: '今日の運営に戻る',
}

export interface AskAiPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness and the suite need worlds this demo plane does not
   *  contain — a feed of 25+ suggestions, a store with nothing to suggest, a
   *  conversation nobody has started, a question carrying an unbroken run, a
   *  reader whose custom role is blank — and the only honest way to picture any
   *  of them is to run the REAL derivations on a different fixture world, never
   *  a class toggle or a hand-written replica. Every field is exactly the shape
   *  the fixture module exports. */
  world?: {
    suggestions?: FixtureSuggestion[]
    signals?: FixtureSignal[]
    templates?: FixtureTemplate[]
    conversation?: FixtureTurn[]
    businessType?: { key: string; label: string } | null
    /** The role the page is being read by. The demo operator is a 店舗管理者. */
    role?: string
  }
}

export interface AskAiPropsResult {
  props: AskAiProps
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. `page.tsx` keys the screen by it, which is
   *  what makes the composer, the conversation view and the dismissed cards
   *  reset on a store switch instead of surviving into a desk that no longer
   *  contains them. */
  storeKey: string
}

export async function askAiProps({ locale, store, world }: AskAiPropsInput): Promise<AskAiPropsResult> {
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : ''
  const hrefOf = (segment: string) => `/${locale}/business/${segment}${storeQuery}`

  const now = renderNow()
  const role = world?.role ?? operator.role
  const access = accessFor(role)

  // ⚠ THE GATE IS READ BEFORE THE DOOR IS OPENED. A denied reader's props are
  // built without a single read, so there is nothing of this room's data in the
  // payload for a screen to be trusted to hide.
  if (!access.consult) {
    return {
      props: {
        dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
        lensLabel,
        subtitle: PHONE.subtitle,
        noticeLines: permissionNotice(access),
        scopeTitle: PHONE.scopeTitle,
        scope: [],
        privacyLines: PRIVACY,
        signals: [],
        templates: [],
        tunedLabel: null,
        unsetTypeLabel: DESK.unsetType,
        profileHint: null,
        turns: [],
        startHint: PHONE.startHint,
        feed: [],
        feedEmpty: EMPTY_FEED,
        feedDismissedEmpty: EMPTY_DISMISSED,
        trace: TRACE,
        boundary: { ...BOUNDARY, backHref: hrefOf('today') },
        composer: { placeholder: PHONE.placeholder, hint: PHONE.inputHint, sendLabel: PHONE.sendLabel },
        refusals: { send: REFUSAL.send, settings: REFUSAL.settings },
        dismissToast: DISMISS_TOAST,
        undoLabel: DESK.undo,
        footnote: FOOTNOTE,
        why: { label: DESK.why, lines: [PHONE.subtitle, ...PRIVACY, DESK.hintNote] },
        traceTitle: DESK.traceTitle,
        traceLead: DESK.traceLead,
        footnoteBarLabel: DESK.footnoteBar,
      },
      storeKey: clamped ? storeId! : 'all-stores',
    }
  }

  const [customers, appointments, menus, staff] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listMenus(lens),
    listStaff(lens),
  ])

  // ONE CLOCK READ PER RENDER (the cycle-1 law): the roster chip's count and the
  // 予約 scope figure derive from this one instant, so a render crossing JST
  // midnight cannot put two different days on one screen.
  const todayKey = jstDayKey(now)
  const nowIso = now.toISOString()
  const model: AskAiWorld = {
    appointments,
    todayAppointments: appointments.filter((a) => jstDayKey(new Date(a.starts_at)) === todayKey),
    // The phone counts `appointments.list({ from: nowIso })`
    // (`src/app/[locale]/(app)/ask-ai/page.tsx:70-72`). A CANCELLED booking is
    // not an upcoming one — the world says so in its own words (fixtures.ts:
    // 「A cancelled booking is not a 次回予約」) — so the count that a shop would
    // recognise excludes it rather than inheriting a page-size artefact.
    upcomingAppointments: appointments.filter((a) => a.starts_at > nowIso && a.status !== 'cancelled'),
    customers,
    menus,
    staff,
    records: recordPlane,
    threads: threadPlane,
  }

  const feed: AskAiCardProps[] = buildFeed(world?.suggestions ?? suggestionPlane, model).map((c) => ({
    ...c,
    href: hrefOf(c.segment),
  }))

  // A local rather than a ternary on the optional chain: `world?.businessType`
  // is `undefined` both when the harness passes no override AND when it passes
  // no world at all, and reading `world.businessType` in the false branch would
  // be asking the narrowing to do work it should not have to.
  const typeOverride = world?.businessType
  const type = typeOverride === undefined ? planeBusinessType : typeOverride

  return {
    props: {
      dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
      lensLabel,
      subtitle: PHONE.subtitle,
      noticeLines: [],
      scopeTitle: PHONE.scopeTitle,
      scope: scopeCounts(model),
      privacyLines: PRIVACY,
      signals: buildSignals(world?.signals ?? signalPlane, model),
      // ⚖ F2-4 — THE TRIO IS PICKED BY THE SAME ONE FACT the label and the hint
      // are. A 業種未設定 desk used to print 美容整体's bridal prompts directly
      // under its own 「業種が未設定です」 note: the page contradicting itself in
      // one column. The shipped mechanism has a GENERIC fallback trio
      // (`business-types.ts:100-137`) and the plane now mirrors it, so the unset
      // state shows the note AND prompts that belong to it.
      templates: buildTemplates(world?.templates ?? (type ? templatePlane : genericTemplatePlane)),
      // ⚖ TYPE TIER 2, through the mechanism that already exists: the business
      // type sets which prompt templates are the defaults, and says so. A shop
      // that has not chosen one gets the profileHint instead — never both.
      tunedLabel: type ? `${PHONE.tunedFor}${type.label}` : null,
      unsetTypeLabel: DESK.unsetType,
      profileHint: type
        ? null
        : { title: PHONE.profileNotSet, body: PHONE.profileNotSetBody, cta: PHONE.profileCta },
      turns: buildConversation(world?.conversation ?? conversationPlane, model),
      startHint: PHONE.startHint,
      feed,
      feedEmpty: EMPTY_FEED,
      feedDismissedEmpty: EMPTY_DISMISSED,
      trace: TRACE,
      boundary: { ...BOUNDARY, backHref: hrefOf('today') },
      composer: { placeholder: PHONE.placeholder, hint: PHONE.inputHint, sendLabel: PHONE.sendLabel },
      refusals: { send: REFUSAL.send, settings: REFUSAL.settings },
      dismissToast: DISMISS_TOAST,
      undoLabel: DESK.undo,
      footnote: FOOTNOTE,
      // ⚖ THE HEAD'S SENTENCE MOVED, VERBATIM (S15 §2.2). `subtitle` is still
      // the phone's own headerSubtitle and still a prop; it now reads inside the
      // trust row's pop-down, beside the two privacy lines and the hint note,
      // because the head became ONE compact title row. Dead prose FOLDS, it is
      // never cut.
      why: { label: DESK.why, lines: [PHONE.subtitle, ...PRIVACY, DESK.hintNote] },
      traceTitle: DESK.traceTitle,
      traceLead: DESK.traceLead,
      footnoteBarLabel: DESK.footnoteBar,
    },
    storeKey: clamped ? storeId! : 'all-stores',
  }
}
