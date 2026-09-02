// 録音 — the room's PROP ASSEMBLY, beside the page rather than inside it.
//
// WHY THIS FILE EXISTS (the room-3 F1 law, inherited from day one): the evidence
// harness imports THIS function, so an isolated shot is the same assembly the
// deployed page runs and a drift between them is a compile error rather than a
// picture nobody can check. `page.tsx` keeps the admission gate, the route
// params and the sheet import — the things a route entry owns.
//
// EVERY DATE CROSSES THE CLIENT BOUNDARY AS A FORMATTED STRING, and every day
// comparison crosses it as `jstDayKey`'s integer. The screen holds no clock, no
// formatter and no data access at all: it cannot put a different day on a take
// from the one the server counted, and no locale or timezone can drift between
// the two renders.
//
// ⚠ THE THREE REDACTIONS HAPPEN ABOVE THIS FILE, IN `recording.ts`. Another
// store's takes never enter the model; a staff reader's model contains only
// their OWN takes; and a discarded take's reason and transcript never enter it
// for a reader without `discardReview`. None of the three can therefore be in
// the serialized props for a screen to "hide" — that is what the
// leaves-nothing-behind pins measure.
//
// ⚖ W7-4 — EVERY POLICY FACT ON THIS PAGE COMES FROM THE PLANE'S SAVED TRUTH.
// The room owns no settings write, so there is no optimistic or pending policy
// state to promote: the pinned consent version, the floor and the store's own
// facts are read here, once, and rendered. A policy string sourced from anywhere
// else is one of the battery's own reds.

import { jstDayKey, jstMinuteOfDay, jstYmd } from '@/business/lib/clock'
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
import { operator, staffCards, type FixtureAppointment } from '@/business/lib/fixtures'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '@/business/lib/karute'
import { records as recordPlane } from '@/business/lib/fixtures-karute'
import {
  consentGrants as grantPlane,
  takes as takePlane,
  CONSENT_POLICY_VERSION,
  type FixtureConsentGrant,
  type FixtureTake,
} from '@/business/lib/fixtures-recording'
import {
  accessFor,
  attentionCounts,
  bookingPhaseOf,
  briefFactsOf,
  buildTakes,
  cardIdOfStaff,
  canStartRecording,
  consentActionLabel,
  consentGateNote,
  consentOf,
  consentProofLine,
  consentScript,
  consentShortLine,
  daysLeftLine,
  defaultPick,
  slotHint,
  BRIEF_RECORDS_SHOWN,
  CONSENT_INSTRUCTIONS,
  CONSENT_LABEL,
  CONSENT_TONE,
  CONTACT_TAGS_DISCLAIMER,
  discardCounts,
  discardFailLine,
  discardLedger,
  durationText,
  feedsCounts,
  isBelowFloor,
  ownDiscardsThisMonth,
  permissionNotice,
  pickerOptions,
  staffBand,
  takeDurationLabel,
  transcriptEntries,
  DISCARD_SUBMITTING_LABEL,
  TAKE_REASON_LINE,
  TAKE_STATE_CHIP,
  TAKE_STATE_LABEL,
  TRANSCRIPT_ABSENCE_LINE,
  TRANSCRIPT_POLICY_LINE,
} from '@/business/lib/recording'
import { hhmm } from '@/business/lib/today-board'
import {
  type RecordingContextProps,
  type RecordingProps,
  type RecordingTakeProps,
  type DiscardRowProps,
} from './RecordingScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const fmtDayLong = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', ...JST })
const fmtDayShort = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', ...JST })

/** ⚠ THE REFUSALS, IN ONE PLACE, AND EACH ONE SAYS WHY IN ITS OWN WORDS. One
 *  generic sentence on six different controls tells the reader nothing about
 *  which of them would have done what. They ride each control's ACCESSIBLE NAME
 *  as well as its title, because a screen reader drops `title` once
 *  `aria-describedby` is present (the room-3 F4 lesson).
 *
 *  ⚖ R6-D3 — 「この録音を使う」 REFUSES, and the reason has to say why THIS one
 *  refuses while the discard beside it runs: a demo commit would claim a カルテ
 *  change the カルテ room provably does not show. */
const REFUSAL = {
  use: '見本データのためカルテに反映できません。反映はお客様のカルテ本体を書き換える操作で、この見本ではカルテ画面に何も現れないため、実データの接続後に有効になります。（録音の破棄はこの画面で最後まで試せます。）',
  save: '見本データのため保存できません。保存は録音をカルテとして残す操作のため、実データの接続後に有効になります。録音はこの案内が消えるまで失われません。',
  // ⚠ 「保存する機能」, NOT 「保存できる場所」 (the 9/1 native pass). 場所 maps a
  // storage model straight onto product prose; a Japanese writer describing a
  // missing feature says the FUNCTION does not exist yet.
  checked: '見本データのため確認済みにできません。確認済みの印を保存する機能はまだありません（破棄の記録は作成と一覧のみに対応しています）。必要かどうかを含めて検討中です。',
  transcript: '保存された録音の文字起こしは、この画面では開けません。閲覧できる範囲は店舗の設定で決まる仕組みで、まだつないでいません。',
  policy: '見本データのため録音の設定は変更できません。録音の設定は「設定」画面にまとまる予定で、まだつないでいません。',
  enroll: '見本データのため音声の登録はできません。自分の声の登録は「設定」画面の録音設定にまとまる予定で、まだつないでいません。',
} as const

// ⚠ TWO SENTENCES, NOT AN EM-DASH (the 9/1 native pass). Japanese UI copy
// essentially never joins two clauses with ` — `; it is the one English habit
// this room's otherwise natural copy kept borrowing.
const FOOTNOTE = '見本データのため、カルテへの反映・保存・設定の変更はできません。実データ接続後に有効になります。'

export interface RecordingPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** ⚖ W7-3 — THE RECOVERY SLOT, BEHIND ITS OWN NAMED QUERY PARAM. `?recovery=1`
   *  renders the ONE deterministic residue state. It is a param rather than a
   *  standing surface because a recovery banner is what a crash LEAVES BEHIND —
   *  a page that always shows one is a page claiming a failure that did not
   *  happen — and it is SINGLE-SLOT by construction: the props carry one
   *  `recovery` object or none, so a draft and a take can never render at once. */
  recovery?: string
  /** ⚖ W7-2 — THE REFUSED WRITE, BEHIND ITS OWN NAMED QUERY PARAM (the
   *  `?recovery=1` precedent). `?discardFail=1` renders the ordinary refusal and
   *  `?discardFail=stale` the take-has-moved-on one, so the shape a reconnect
   *  lands on — typed text surviving, dialog still open, nothing discarded — is
   *  designed rather than guessed. A page that ALWAYS fails would be claiming a
   *  failure that did not happen, which is why it is a param. */
  discardFail?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness needs worlds this demo plane does not contain — a
   *  200-take desk, a store that has never recorded anything, a 25-staff counts
   *  block, a staff member's own view — and the only honest way to picture any
   *  of them is to run the REAL derivations on a different fixture world, never
   *  a class toggle or a hand-written replica. Every field is exactly the shape
   *  the fixture module exports. */
  world?: {
    takes?: FixtureTake[]
    grants?: FixtureConsentGrant[]
    /** The harness's own booking set, REPLACING the door's — a take resolves its
     *  date, store, customer and staff through a booking, so a 200-take desk
     *  needs 200 bookings to hang off. ⚠ THE LENS STILL DECIDES: the one line
     *  below applies the door's own rule to whatever the harness supplies, so a
     *  synthetic world cannot smuggle another store's booking past the isolation
     *  proof — and the isolation proof itself runs on the DEMO world through the
     *  REAL door, untouched. */
    appointments?: FixtureAppointment[]
    /** The role the page is being read by. The demo operator is a 店舗管理者. */
    role?: string
  }
}

export interface RecordingPropsResult {
  props: RecordingProps
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. `page.tsx` keys the screen by it, which is
   *  what makes the picker, the demo machine and the open screen reset on a
   *  store switch instead of surviving into a desk that no longer contains
   *  them. */
  storeKey: string
}

/** Resolve everything RecordingScreen is handed. Server-only by construction:
 *  every read goes through `@/business/lib/data`'s store-clamped fixture door. */
export async function recordingProps({
  locale,
  store,
  recovery,
  discardFail,
  world,
}: RecordingPropsInput): Promise<RecordingPropsResult> {
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  // ONE CLOCK READ PER RENDER (the cycle-1 law): today's picker, the 今月 counts,
  // every take's date and the window walk's axis all derive from this one
  // instant, so a render crossing JST midnight cannot put two different days on
  // one screen.
  const now = renderNow()
  const todayKey = jstDayKey(now)
  const { y, m } = jstYmd(now)

  const [customers, doorAppointments, menus, staff] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listMenus(lens),
    listStaff(lens),
  ])
  const appointments = world?.appointments
    ? world.appointments.filter((a) => (clamped ? a.store_id === storeId : true))
    : doorAppointments

  const grants = world?.grants ?? grantPlane
  const role = world?.role ?? operator.role
  const access = accessFor(role)
  const selfCardId = cardIdOfStaff(operator.staff_id, staffCards, staff)

  const models = buildTakes({
    takes: world?.takes ?? takePlane,
    appointments,
    customers,
    staff,
    staffCards,
    records: recordPlane,
    storeId,
    todayKey,
    access,
    selfCardId,
  })

  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : ''
  const karuteHref = `/${locale}/business/karute${storeQuery}`
  const staffHref = `/${locale}/business/shifts${storeQuery}`

  const dayOf = (dayKey: number) => new Date(dayKey * 86_400_000)
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const recordByAppointment = new Map(recordPlane.map((r) => [r.appointment_id, r]))

  // ── the picker, and one context object per option ─────────────────────────
  // Selection is CLIENT state — a receptionist changes which booking they are
  // about to record without a round trip — so every option's whole context is
  // resolved HERE and the screen only chooses between them. That is what keeps
  // the screen free of a clock, a formatter and the consent rule all at once.
  // ⚖ LIAM F-1 R1-3 — THE PICKER IS STAFF-SCOPED. `operator.staff_id` is a
  // PROFILE id and a booking's `staff_id` is the same space, so the scope needs
  // no bridge (the take side does — that is `selfCardId` above).
  const ownStaffId = operator.staff_id
  const nowMinute = jstMinuteOfDay(now)
  const options = pickerOptions({
    appointments,
    customers,
    menus,
    staff,
    grants,
    todayKey,
    minuteOf: jstMinuteOfDay,
    ownStaffId,
  })

  const contexts: RecordingContextProps[] = options.map((o) => {
    const consent = consentOf(o.customerId, grants)
    const customer = customerById.get(o.customerId)!
    const record = recordByAppointment.get(o.appointmentId) ?? null
    const timeLabel = hhmm(o.startedMinute)
    const dateLabel = fmtDayLong.format(new Date(o.startsAt))
    const phase = bookingPhaseOf(o.startedMinute, o.endMinute, nowMinute)
    // ⚖ CANON's contact tags (:640) — the customer profile's own 連絡許可, which
    // is NOT recording consent and says so on the line beneath.
    const tags: string[] = []
    if (customer.consent?.line) tags.push('LINE')
    if (customer.consent?.sms) tags.push('SMS')
    if (customer.consent?.email) tags.push('メール')
    // ⚖ 前回までの流れ — the phone's before-session brief, fuller. A JOIN over
    // the lens's own bookings and the カルテ plane; this room states none of it.
    const facts = briefFactsOf({
      customerId: o.customerId,
      todayKey,
      appointments,
      menus,
      staff,
      records: recordPlane,
      categoryOrder: CATEGORY_ORDER,
      categoryLabel: CATEGORY_LABEL,
    })
    const shown = facts.records.slice(0, BRIEF_RECORDS_SHOWN)
    return {
      appointmentId: o.appointmentId,
      customerId: o.customerId,
      customerName: o.customerName,
      staffName: o.staffName,
      menuName: o.menuName,
      optionLabel: `${timeLabel} ${o.customerName}様（${o.staffName}）`,
      timeLabel,
      dateLabel,
      metaLabel: `${dateLabel} ${timeLabel} ・ ${o.menuName} ・ 担当 ${o.staffName}`,
      // The hero's own meta is the TIME RANGE, the menu and the staffer — the
      // mock's `.hero-meta`. The full date stays on the picker's own label; a
      // hero that repeats 「本日」 to a reader looking at today's list is noise.
      heroMetaLabel: `${timeLabel} ー ${hhmm(o.endMinute)} ・ ${o.menuName} ・ 担当 ${o.staffName}`,
      // ⚖ DERIVED FROM THE ONE CLOCK READ, and it is the same read the default
      // selection and every take date came from.
      heroChipLabel:
        phase === 'now' ? 'いま施術中' : phase === 'upcoming' ? `このあと ${timeLabel} 開始` : `終了 ${hhmm(o.endMinute)}`,
      heroChipTone: phase,
      slotHint: slotHint(phase, o.visitsBefore),
      consentState: consent.state,
      consentLabel: CONSENT_LABEL[consent.state],
      consentTone: CONSENT_TONE[consent.state],
      consentProof: consentProofLine(consent),
      consentShort: consentShortLine(consent),
      consentAction: consentActionLabel(consent.state),
      brief: {
        // ⚠ 前回のご来店 IS A SENTENCE ABOUT A SESSION THAT HAPPENED, so a
        // customer with none gets the mock's own empty copy rather than a line
        // with holes in it.
        lastLine:
          facts.last === null
            ? null
            : `${fmtDayLong.format(dayOf(facts.last.dayKey))} ・ ${facts.last.menuName} ・ 担当 ${facts.last.staffName}`,
        visitsTag: facts.visitsBefore === 0 ? '初めてのご来店' : `ご来店 ${facts.visitsBefore + 1}回目`,
        lastKaruteLabel: facts.last?.recordId ?? null,
        records: shown.map((r) => ({
          id: r.recordId,
          dateLabel: fmtDayShort.format(dayOf(r.dayKey)),
          // ⚠ THE MENU NAME IS THE TITLE, because the plane has no topic titles
          // and this room may not write one (R6-24).
          title: r.title,
        })),
        // v5-3 recent-first-with-doors: the depth goes behind ONE link, and the
        // number on it is the number of records there actually are.
        doorLabel: facts.records.length > shown.length ? `すべてのカルテを見る（${facts.records.length}件）` : null,
        summary: facts.summary,
        memo: facts.memo,
      },
      // ⚖ W7-1 — THE GATE IS ONE CALL, and its answer is serialized ONCE. The
      // screen renders `canStart`; it never re-decides it, so there is no second
      // home for a mode or a flag to be read in.
      canStart: canStartRecording(consent),
      gateNote: consentGateNote(consent, o.customerName),
      contactTags: tags,
      script: consentScript(o.customerName),
      // Canon's use-block proof (:722) and its confirm rows (:804) — read from
      // the カルテ plane through the SAME booking, so the room can name the
      // record a commit WOULD touch rather than describing one.
      targetRecordId: record?.id ?? null,
      targetOutcomeLabel: record?.outcome
        ? { success: '成約', no_deal: '不成約', pending: '仮カルテ', revisit: '通常ご来店' }[record.outcome.status]
        : '結果 未記録',
      targetSummaryLabel: record === null
        ? '—'
        : record.summary_ai === null
          ? 'AI補完待ち'
          : record.summary_state === 'confirmed'
            ? '確定'
            : '下書き',
      useProof: record
        ? `対象のカルテ記録: ${record.id}（${o.customerName}様 ・ 結果 ${
            record.outcome
              ? { success: '成約', no_deal: '不成約', pending: '仮カルテ', revisit: '通常ご来店' }[record.outcome.status]
              : '未記録'
          }）`
        : `${o.customerName}様のカルテ記録はまだありません。新しいカルテ記録を作成します。`,
    }
  })

  // ── 録音履歴 ──────────────────────────────────────────────────────────────
  const takeRows: RecordingTakeProps[] = models.map((t) => ({
    id: t.id,
    dayKey: t.dayKey,
    dateLabel: fmtDay.format(dayOf(t.dayKey)),
    timeLabel: hhmm(t.startedMinute),
    // 顧客未設定 is the phone's own word for an unbound take
    // (recording.inbox.unsetCustomer) — never a 「—」 that reads as broken.
    customerLabel: t.customerName ?? '顧客未設定',
    // The row's identity anchor (the カルテ room's own list grammar): a name's
    // first character, or the mock's ？ for a take that never got a customer.
    customerInitial: t.customerName === null ? '？' : [...t.customerName][0],
    hasCustomer: t.customerName !== null,
    byName: t.byName,
    // ⚖ SELF-EXPLAINING NUMBERS (Liam 8/25): the duration says WHAT it measures,
    // and it says it EXACTLY — one home, `takeDurationLabel`, shared with the
    // 破棄の記録 screen so the two surfaces cannot disagree about one take.
    // ⚠ AND 10秒未満 IS A PLAIN FACT beside it (W7-2), never a warning.
    durationLabel: takeDurationLabel(t.durationSeconds, t.belowFloor),
    stateLabel: TAKE_STATE_LABEL[t.state],
    stateChip: TAKE_STATE_CHIP[t.state],
    reasonLine: t.reason === null ? null : TAKE_REASON_LINE[t.reason],
    isDiscarded: t.state === 'discarded',
    // ⚖ R2 + A2-3 — A DISCARDED ROW OFFERS NOTHING. `null` here is the whole
    // affordance suppression, decided from the STATE and nothing else, so no
    // later branch can read `karuteRecordId` (which stays TRUE — this room never
    // erases evidence) and hand a discarded row a lever.
    // ⚠ AND IT ASKS `feedsCounts`, THE NAMED GATE, rather than spelling
    // 「破棄済み」 a third time (B1-5). One predicate, every consumer, so the next
    // count or lever added cannot route around the rule by forgetting it.
    action: !feedsCounts(t.state)
      ? null
      : t.karuteRecordId !== null
        ? { kind: 'karute' as const, label: 'カルテ一覧を開く', href: karuteHref }
        : t.state === 'recoverable'
          ? { kind: 'save' as const, label: '保存する', href: null }
          : null,
    karuteRecordLabel: feedsCounts(t.state) ? t.karuteRecordId : null,
  }))

  // ⚠ THE COUNTS ARE GATED WHERE THE ROWS ARE GATED, ABOVE THE SERIALIZER. They
  // used to be computed unconditionally and written into every persona's props,
  // and the staff screen simply never rendered them — so the redaction was the
  // SCREEN's, not the model's, and it was empty by VALUE (the demo operator owns
  // no discard) rather than by construction. The moment a role exists with
  // `storeWide: true, discardReview: false` — registry ⑤ splits exactly those
  // two questions — that reader's props would have carried every colleague's
  // name and monthly total behind a client-side `&&`. `null` here means the
  // props have nothing to hide.
  const counts = access.discardReview ? discardCounts(models, y, m) : null
  const ownDiscards = ownDiscardsThisMonth(models, selfCardId, y, m)

  const discardRows: DiscardRowProps[] = access.discardReview
    ? discardLedger(models, (model) => {
        // ⚖ 8/20 (b) — R2 keeps the burn out of every NUMBER; it does not erase
        // that one happened, and the manager owns the correction. Read off the
        // PLANE rather than off the R2-nulled model field.
        const source = (world?.takes ?? takePlane).find((x) => x.id === model.id)
        return source?.ticket_redeemed ?? false
      }).map((r) => {
        const length = durationText(r.durationSeconds)
        return {
          takeId: r.takeId,
          // ⚖ THE ROW IS CUSTOMER-LED (the approved 8/31 mock). 顧客未選択 is the
          // mock's own word for an unbound take — never a 「—」 that reads broken.
          customerLabel: r.customerName === null ? '顧客未選択' : `${r.customerName}様`,
          hasCustomer: r.customerName !== null,
          // The identity anchor: a name's own first character, or the mock's ？
          // for a take that never got one. Decorative — the name is beside it.
          initial: r.customerName === null ? '？' : [...r.customerName][0],
          recordedAtLabel: `${fmtDayLong.format(dayOf(r.dayKey))} ${hhmm(r.startedMinute)}`,
          // ⚠ THE LIST GETS THE SHORT DATE and the DETAIL the full one. A 340px
          // master column carrying 「2026年8月29日(土) 10:04 ・ 破棄 同日 12:20 ・
          // 見本 はなこ」 wraps to three lines and stops being scannable; the year
          // is never the thing a manager is looking for in a list, and it is one
          // press away where it is.
          recordedShortLabel: `${fmtDayShort.format(dayOf(r.dayKey))} ${hhmm(r.startedMinute)}`,
          // The plane stamps a discard as a JST minute of the take's OWN session
          // day, so 同日 is a fact rather than a shortening.
          discardedAtLabel: `同日 ${hhmm(r.minute)}`,
          // ⚠ THE LENGTH ALONE, one home: the row's pill, the detail's 録音時間
          // and the reading panel's header all compose from this one string, so
          // three surfaces cannot state three different lengths for one take.
          lengthText: length ?? '記録なし',
          byName: r.byName,
          reason: r.reason,
          transcript: r.transcript === null ? null : transcriptEntries(r.transcript),
          absenceLine: TRANSCRIPT_ABSENCE_LINE[r.absence],
          ticketNote: r.ticketRedeemed
            ? '破棄前にこのセッションで回数券を1回消化していました。返却の要否をご確認ください。'
            : null,
        }
      })
    : []

  // ── ⚖ W7-3 · THE RECOVERY SLOT ───────────────────────────────────────────
  // ONE object or none, and it is built from the plane's own single recoverable
  // take. A draft-shaped offer and a take-shaped offer can never render at once
  // because there is exactly one field for either of them to live in — the
  // structural version of 「never draft and take simultaneously」.
  const recoverable = models.find((t) => t.state === 'recoverable') ?? null
  const wantRecovery = recovery === '1' && recoverable !== null
  // ⚠ AN UNBOUND TAKE HAS NO DESTINATION YET, AND THE BANNER HAS TO SAY SO
  // (B1-11). The room's only residue is unbound (`appointment_id: null`), and it
  // named the customer 「未選択（保存時に選択）」 while the button underneath still
  // said 保存する and the caption still said 「保存するまでこの案内が残ります。」 —
  // so the one recovery state this room ships told the staffer the wrong next
  // step. The phone branches on exactly this (`RecoveryBanner.tsx:181-187`) and
  // both of its strings are taken verbatim.
  const recoveryBound = recoverable !== null && recoverable.customerName !== null
  const recoveryProps = wantRecovery
    ? {
        title: 'このカルテは正しく保存されませんでした',
        customerLabel: recoverable!.customerName ?? '未選択（保存時に選択）',
        recordedAtLabel: `${fmtDayLong.format(dayOf(recoverable!.dayKey))} ${hhmm(recoverable!.startedMinute)}`,
        lengthLabel:
          recoverable!.durationSeconds === null
            ? null
            : `${recoverable!.durationSeconds}秒`,
        recordedByLabel: recoverable!.byName,
        // ⚖ 8/26 (b) — the discard exit exists ONLY for a below-floor TAKE, and
        // `isBelowFloor` is the same predicate the chip and the manager screen
        // read, so a fourth spelling of 「short」 cannot appear.
        belowFloor: isBelowFloor(recoverable!.durationSeconds),
        // `recoverSaveAction` / `recoverPickAndSaveAction`, verbatim. The action
        // still REFUSES (the demo plane saves nothing) — what changes is which
        // next step it names, and the refusal grammar is unchanged.
        saveLabel: recoveryBound ? '保存する' : 'お客様を選んで保存する',
        // `recoverCaption` / `recoverCaptionUnbound`, verbatim; the phone's
        // `{date}` is the recording DAY alone, which is this room's own
        // `fmtDayShort`.
        caption: recoveryBound
          ? '録音は消えません。保存するまでこの案内が残ります。'
          : `録音日（${fmtDayShort.format(dayOf(recoverable!.dayKey))}）の予約リストからお客様を選びます。`,
        // ⚠ THE ROOM'S OWN LONG-RECORDING TRUTH (§2b-8 cross-lane crumb): the
        // phone's auto-stop copy says 「自動的に保存しました」 and the 2h cap only
        // STOPS. This room must not copy the lie, so its own sentence says
        // stop-not-save.
        stopNote: '長い録音は自動で停止します。停止しただけで保存はされないため、保存するまでこの案内は消えません。',
      }
    : null

  const failLine = discardFailLine(discardFail)

  // ── ⚖ 要対応 — ONE SLIM STRIP, AND ONLY WHEN THERE IS SOMETHING TO DO ──────
  // ⚠ THE COUNTS COME OFF THE SAME MODEL LIST THE FILTER ROW NARROWS, so a
  // pill's number is exactly what its press reveals (the ⚖ pill/count law). A
  // count taken from a different predicate is one of the battery's own reds.
  // ⚠ AND THE STRIP IS ABSENT AT ZERO. 「要対応 0件」 over three empty pills is a
  // page inventing a warning; a clean desk sees no strip at all.
  const attn = attentionCounts(models)
  const attention =
    attn.total === 0
      ? null
      : {
          title: '要対応',
          countLine: `${attn.total}件`,
          hint: 'いま手を動かす必要がある録音',
          pills: [
            attn.recoverable > 0
              ? {
                  key: 'recoverable' as const,
                  chip: TAKE_STATE_CHIP.recoverable,
                  stateLabel: TAKE_STATE_LABEL.recoverable,
                  countLabel: `${attn.recoverable}件`,
                  // The plane's own 7-day local-take window, and `null` once a
                  // residue is past it rather than a promise of 「あと0日」.
                  note: recoverable === null ? null : daysLeftLine(recoverable.dayKey, todayKey),
                  // The SAME refused save lever the row carries, same reason.
                  action: { kind: 'save' as const, label: '保存する' },
                  tone: 'amber' as const,
                }
              : null,
            attn.failed > 0
              ? {
                  key: 'failed' as const,
                  chip: TAKE_STATE_CHIP.failed,
                  stateLabel: TAKE_STATE_LABEL.failed,
                  countLabel: `${attn.failed}件`,
                  note: null,
                  action: { kind: 'filter' as const, label: '見る' },
                  tone: 'red' as const,
                }
              : null,
            attn.awaiting > 0
              ? {
                  key: 'awaiting' as const,
                  chip: TAKE_STATE_CHIP['awaiting-check'],
                  stateLabel: TAKE_STATE_LABEL['awaiting-check'],
                  countLabel: `${attn.awaiting}件`,
                  note: null,
                  action: { kind: 'filter' as const, label: '確認する' },
                  tone: 'blue' as const,
                }
              : null,
          ].filter((p) => p !== null),
        }

  const props: RecordingProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    operatorName: operator.name,
    // Canon's own subtitle (fable-record-session.html:404), amended for the two
    // things §2b-5 makes true that canon predates: consent is CURRENT-consent
    // under a pinned version, and the room's picker is booking-bound.
    subtitle:
      '施術中の会話を録音し、一時停止・停止をはさんで、その録音をカルテに使います。録音を始められるのは、いまの説明文で録音の同意をいただけている予約だけです。',
    // ⚠ THE HEAD'S TOUR SENTENCE IS ACCESS-DERIVED, like the three beside it
    // (B1-9). It used to promise 「破棄された録音の記録」 to every reader, and the
    // 破棄の記録 screen exists only for `discardReview` — so the room's own
    // opening sentence was false for the スタッフ persona §2e-2 makes a proven,
    // first-class mode of this room. What each reader is told they can see is
    // now exactly what they can open.
    headGuide:
      '施術中の会話を録音して、その録音からカルテを作る画面です。録音そのものはスマホのアプリでも行えます。この画面では、録音を始める前の同意の確認と、' +
      (access.discardReview
        ? '録音の履歴、そして破棄された録音の記録をまとめて見られます。'
        : '自分の録音の履歴を見られます。'),
    contexts,
    // ⚖ LIAM F-1 R1-3 — the label SAYS whose list this is and how long it is, so
    // a manager who also treats can see at a glance that the recorder is her own
    // bookings and the history below is the store's.
    pickerLabel: `あなたの担当の予約 ${contexts.length}件（${operator.name}・本日）`,
    // ⚠ THE OWN-SCOPE EMPTY STATE. A manager with no bookings of her own today
    // is the ORDINARY evening case, not a broken page — and the sentence has to
    // say WHOSE list is empty, or she reads it as「the store has no bookings」.
    emptyOwnScope:
      contexts.length > 0
        ? null
        : {
            title: '本日、あなたの担当の予約はありません',
            body: '予約が入ると、ここに時間順で並びます。録音は予約を選んでから始めます。',
          },
    attention,
    // ⚖ THE SCREEN NEVER PICKS (§2.3). In-progress → next up → last of the day,
    // decided from the SAME clock read the hero chips and every take date used.
    defaultAppointmentId: defaultPick(options, nowMinute),
    takes: takeRows,
    // ⚖ 8/25 ruling B, staff half — `null` renders NOTHING, never 0.
    ownDiscardLine: ownDiscards === null ? null : `自分が今月破棄した録音 ${ownDiscards}件`,
    // ⚠ AND IT NAMES THE SPAN IT OPENS ON (B1-13). The phone's own caption is
    // 「過去7日間の自分の録音」; this room WALKS past that on request, so it cannot
    // claim the phone's fixed window — but saying nothing at all let the list
    // read as the whole history. 「1週間ぶん」 is the same wording さらに表示
    // uses, so the two surfaces state one span in one voice.
    historyCaption: access.storeWide
      ? 'この店舗の録音（新しい順・まず1週間ぶん）'
      : '自分の録音（新しい順・まず1週間ぶん）',
    // ⚖ 8/25 RULING B, kept WORD FOR WORD while the mock's SHAPE is adopted: one
    // quiet labelled band instead of two same-weight count cards. The numbers
    // stay the shipped screen's own sentences (`settings.discardReasons
    // .countThisMonth` / `.countTotal` / `.byStaffTitle`) — the mock's shorter
    // 「累計 N件」 would break the recognition floor on a phone-daily manager and
    // the verbatim half of ⚖ 8/25 B (deviation R6-11).
    counts:
      counts === null
        ? null
        : {
            thisMonthLine: `今月の破棄 ${counts.thisMonth}件`,
            totalLine: `記録されている破棄 全${counts.total}件`,
            byStaffLabel: 'スタッフ別（今月）',
            // ⚠ KEYED BY CARD ID, not by name: two departed staffers both resolve
            // to 担当者不明, and a list keyed on the name would give two different
            // people one React key — the exact case ⚖ #799 shaped this plane for.
            // …and `staffBand` is what makes the band READABLE once there are two
            // dozen of them: the model keeps every card, the band prints the
            // unresolvable ones as ONE entry that says how many people it stands
            // for. A named person is `people: 1` and renders exactly as before.
            byStaff: staffBand(counts.byStaff).map((s) => ({
              rowKey: s.rowKey,
              name: s.people > 1 ? `${s.name}（${s.people}名）` : s.name,
              line: `${s.thisMonth}件`,
            })),
            truncatedLine: counts.truncated ? '古い記録を除いた件数です。' : null,
            listTruncatedLine: counts.truncated ? '件数が多いため、古い記録は表示していません。' : null,
          },
    discardRows,
    canReviewDiscards: access.discardReview,
    recovery: recoveryProps,
    noticeLines: permissionNotice(access),
    // ⚖ W7-4 — the trace rows are the PLANE's saved truth and the shell's own
    // real routes. Canon's own trace card claimed two org dials that do not
    // exist on main (a 保持期間 org setting and a configurable consent switch);
    // §2b-7 rewrites both for truth rather than carrying a link to a control
    // nobody built.
    trace: [
      {
        label: '録音の同意',
        value: `この製品の決まりです（${CONSENT_POLICY_VERSION}）。店舗ごとの切り替えはありません。`,
        href: null,
      },
      {
        label: '文字起こしの公開範囲',
        value: `${TRANSCRIPT_POLICY_LINE}保存された録音の文字起こしを開く画面は、どちらの設定でもまだありません。`,
        href: null,
      },
      {
        label: '端末に残る録音',
        value: '保存されなかった録音は、録音した端末に7日間だけ残ります。店舗ごとの保持期間の設定はありません。',
        href: null,
      },
      { label: '自分の音声登録', value: '「設定」の録音設定にまとまる予定です（未接続）。', href: null },
      { label: '担当者の名簿', value: 'スタッフ・シフト', href: staffHref },
    ],
    traceNote:
      'この画面が出している値の出どころです。まだつないでいないものは「未接続」と書いています。',
    consentInstructions: CONSENT_INSTRUCTIONS,
    contactDisclaimer: CONTACT_TAGS_DISCLAIMER,
    // ⚖ W7-2 — the refused write's own two strings, or `null` for every render
    // the param does not name (which is every ordinary one).
    discardFail: failLine === null ? null : { submitLabel: DISCARD_SUBMITTING_LABEL, errorLine: failLine },
    actionFootnote: FOOTNOTE,
    // ⚖ THE FOOTNOTE DISCLOSURE (§2.6) — the trace card FOLDS, nothing is cut.
    // The bar's own words name both halves it hides, so a reader knows what is
    // behind it before pressing.
    footnoteBar: 'この画面の値の設定元 ・ 見本データについて',
    footnoteTitle: 'この画面の値の設定元',
    refusals: {
      use: REFUSAL.use,
      save: REFUSAL.save,
      checked: REFUSAL.checked,
      transcript: REFUSAL.transcript,
      policy: REFUSAL.policy,
      enroll: REFUSAL.enroll,
    },
    karuteHref,
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}
