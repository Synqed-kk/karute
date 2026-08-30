// カルテ — the room's PROP ASSEMBLY, beside the page rather than inside it.
//
// WHY THIS FILE EXISTS (the room-3 F1 law, inherited from day one): the evidence
// harness imports THIS function, so an isolated shot is the same assembly the
// deployed page runs and a drift between them is a compile error rather than a
// picture nobody can check. `page.tsx` keeps the admission gate, the route
// params and the sheet import — the things a route entry owns.
//
// EVERY DATE CROSSES THE CLIENT BOUNDARY AS A FORMATTED STRING, and every day
// comparison crosses it as `jstDayKey`'s integer. The screen holds no clock, no
// formatter and no data access at all: it cannot put a different day on the row
// from the one the server counted, and no locale or timezone can drift between
// the two renders.
//
// ⚠ THE TWO REDACTIONS HAPPEN ABOVE THIS FILE, IN `karute.ts`. Another store's
// records never enter the model, and a 破棄済み record's content never enters it
// for a reader who may not read it — so neither can be in the serialized props
// for a screen to "hide". That is what the leaves-nothing-behind pins measure.

import { jstDayKey, jstYmd } from '@/business/lib/clock'
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
import { operator, type FixtureAppointment } from '@/business/lib/fixtures'
import { records as recordPlane, type FixtureKaruteRecord } from '@/business/lib/fixtures-karute'
import {
  accessFor,
  buildRecords,
  DECLINE_LABEL,
  FILTERS,
  monthCensus,
  OUTCOME_LABEL,
  OUTCOME_PILL,
  outcomeNote,
  permissionNotice,
  revealCandidates,
  STATE_LABEL,
  STATE_PILL,
} from '@/business/lib/karute'
import { hhmm } from '@/business/lib/today-board'
import { type KaruteProps, type KaruteRowProps } from './KaruteScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const fmtDayLong = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', ...JST })
const fmtTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, ...JST })

/** ⚠ THE REFUSALS, IN ONE PLACE, AND EACH ONE SAYS WHY IN ITS OWN WORDS. One
 *  generic sentence on eight different controls tells the reader nothing about
 *  which of them would have done what. They ride each control's ACCESSIBLE NAME
 *  as well as its title, because a screen reader drops `title` once
 *  `aria-describedby` is present (the room-3 F4 lesson).
 *
 *  ⚖ EVERY EDIT ON THIS PAGE IS A WRITE TO SOMEBODY'S MEDICAL-ADJACENT RECORD,
 *  which is why not one of them is half-built behind a dialog whose only outcome
 *  is a toast saying nothing happened. */
const REFUSAL = {
  entry: '見本データのため記入内容を編集できません。カルテの記入は記録の本文を書き換える操作のため、実データの接続後に有効になります。',
  summary: '見本データのため詳細記録を編集できません。編集はスタッフ名と時刻を編集履歴に残す操作のため、実データの接続後に有効になります。',
  regenerate: '見本データのためAIでの再生成はできません。再生成は録音の内容から記録を作り直す操作のため、実データとAIの接続後に有効になります。',
  message: '見本データのためAI提案メッセージを編集できません。文面の編集は送信内容を書き換える操作のため、実データの接続後に有効になります。',
  send: '見本データのため送信できません。送信はお客様へ実際にメッセージを届ける操作のため、連絡機能をつないだあとに有効になります。',
  outcome: '見本データのためセッションの結果を変更できません。結果は成約率とAIの学習に使われる記録のため、実データの接続後に有効になります。',
  // ⚖ #547 — カルテに削除はありません. The control that does not exist is not
  // refused here; it is ABSENT, and this line explains the absence where a
  // reader would look for it.
  reassign: '見本データのためカルテの顧客を変更できません。付け替えは監査ログに残る操作のため、実データの接続後に有効になります。',
  photo: '見本データのため写真を開けません。写真の閲覧と比較は画像の保管場所につないだあとに有効になります。',
} as const

const FOOTNOTE = '見本データのため編集・送信・記録はできません — 実データ接続後に有効になります。'

export interface KarutePropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness needs worlds this demo plane does not contain — a
   *  200-record desk, a store that has never recorded anything, a staff member's
   *  view of a discarded row — and the only honest way to picture any of them is
   *  to run the REAL derivations on a different fixture world, never a class
   *  toggle or a hand-written replica. Both fields are exactly the shapes the
   *  fixture module exports. */
  world?: {
    records?: FixtureKaruteRecord[]
    /** The harness's own booking set, REPLACING the door's — because a record
     *  resolves its date, its store, its customer, its staff and its menu
     *  through a booking, so a 200-record desk needs 200 bookings to hang off.
     *
     *  ⚠ THE LENS STILL DECIDES. The one line below applies the door's own rule
     *  to whatever the harness supplies, so a synthetic world cannot smuggle
     *  another store's booking past the isolation proof — and the isolation
     *  proof itself runs on the DEMO world through the REAL door, untouched. */
    appointments?: FixtureAppointment[]
    /** The role the page is being read by. The demo operator is a 店舗管理者. */
    role?: string
  }
}

export interface KarutePropsResult {
  props: KaruteProps
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. `page.tsx` keys the screen by it, which is
   *  what makes the search, the filter, the window walk and the open record
   *  reset on a store switch instead of surviving into a desk that no longer
   *  contains them. */
  storeKey: string
}

/** Resolve everything KaruteScreen is handed. Server-only by construction:
 *  every read goes through `@/business/lib/data`'s store-clamped fixture door. */
export async function karuteProps({ locale, store, world }: KarutePropsInput): Promise<KarutePropsResult> {
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  // ONE CLOCK READ PER RENDER (the cycle-1 law): the 今週 window, the 今月
  // census, every row's date and the window walk's axis all derive from this
  // one instant, so a render crossing JST midnight cannot put two different
  // days on one screen.
  const now = renderNow()
  const todayKey = jstDayKey(now)
  const { y, m, wd } = jstYmd(now)

  const [customers, doorAppointments, menus, staff] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listMenus(lens),
    listStaff(lens),
  ])
  // The harness's synthetic booking set, run through the lens's own rule rather
  // than trusted: a clamped lens keeps this store's rows and nothing else, which
  // is exactly what `inLens` does inside the door for a booking (null-store rows
  // stay hidden). The page never passes `world`, so this branch is the harness's
  // alone and the deployed read is the door's, unchanged.
  const appointments = world?.appointments
    ? world.appointments.filter((a) => (clamped ? a.store_id === storeId : true))
    : doorAppointments

  const role = world?.role ?? operator.role
  const access = accessFor(role)

  const models = buildRecords({
    records: world?.records ?? recordPlane,
    appointments,
    customers,
    menus,
    staff,
    todayKey,
    todayWeekday: wd,
    access,
  })

  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : ''
  const customersHref = `/${locale}/business/customers${storeQuery}`

  const dayOf = (dayKey: number) => new Date(dayKey * 86_400_000)
  const census = monthCensus(models, y, m)
  /** The lens's own customers, by id. `listCustomers(lens)` is the SAME clamped
   *  read every other fact on a row comes through, so a contact detail cannot
   *  reach a row the clamp already refused. */
  const contact = new Map(customers.map((c) => [c.id, { phone: c.phone, email: c.email }]))

  const rows: KaruteRowProps[] = models.map((r) => {
    return {
      id: r.id,
      customerId: r.customerId,
      customerName: r.customerName,
      furigana: r.furigana,
      memberNumber: r.memberNumber,
      mark: r.mark,
      // ⚖ THE DESIGN ROUND — the person header's contact row, the phone's own
      // (`CustomerHeaderCard`). Read from the SAME store-clamped customer the
      // rest of the row is read from, so the isolation proof covers it by
      // construction: another store's customer never enters `contactOf`'s map,
      // and its pin now scans the payload for the other store's phone and mail
      // as well as its names. `null` where the customer has none — an empty
      // link is a lever with nowhere to go.
      phone: contact.get(r.customerId)?.phone ?? null,
      email: contact.get(r.customerId)?.email ?? null,
      staffId: r.staffId,
      staffName: r.staffName,
      service: r.service,
      bookingNo: r.bookingNo,
      dayKey: r.dayKey,
      thisWeek: r.thisWeek,
      state: r.state,
      stateLabel: STATE_LABEL[r.state],
      statePill: STATE_PILL[r.state],
      dateLabel: fmtDay.format(dayOf(r.dayKey)),
      dateLongLabel: fmtDayLong.format(dayOf(r.dayKey)),
      timeLabel: fmtTime.format(new Date(r.startsAt)),
      preview: r.preview,
      // ⚖ SILENT FAILURE IS A BUG. An empty preview gets a SENTENCE saying which
      // reason it is, never a blank the reader has to guess at.
      //
      // ⚠ AND THE DISCARD IS SAID ONCE, WHERE IT BELONGS (⚖ A8). Only a reader
      // who may NOT read the content is told 「破棄されたカルテです」 here — for
      // them it IS the reason the line is empty. A 店舗管理者 CAN read it, so
      // their empty line has an ordinary cause (nothing was written, or the AI
      // never summarised it) and saying 破棄 to them would answer a question
      // the grayed row, the pill and the banner have already answered
      // — found in my own 1280 review of the discarded record.
      previewFallback:
        r.discarded && r.discarded.reason === null
          ? '破棄されたカルテです（内容は店舗管理者のみ）'
          : r.entries.length === 0
            ? 'まだ何も記入されていません'
            : 'AIの要約はまだ作成されていません',
      // ⚖ THE RECOGNITION FLOOR — the drawer's own id rides along beside its
      // label, so the screen can paint the phone's exact tone for it without
      // holding a second copy of `CATEGORY_TONE`, and without ever deciding
      // which drawer a line belongs to (that is `buildRecords`'s answer, and
      // this is a serializer).
      entries: r.entries.map((e) => ({ category: e.category, label: e.label, text: e.text, handwritten: e.handwritten })),
      summaryBullets: r.summaryBullets,
      summaryEdited: r.summaryEdited,
      // NEWEST FIRST — the order the section names out loud, decided ONCE in
      // `buildRecords` over the merged event list rather than by rendering a
      // discard row above an unsorted edit array (F-K7).
      history: r.history.map((h) => ({
        when: `${fmtDay.format(dayOf(r.dayKey))} ${hhmm(h.minute)}`,
        what: h.kind === 'discard' ? 'カルテを破棄' : '詳細記録を編集',
        detail: h.note
          ? `${h.by} ・ ${h.note}`
          : h.kind === 'discard'
            ? `${h.by} ・ 理由は店舗管理者のみが確認できます`
            : h.by,
      })),
      photos: r.photos.map((p) => ({ category: p.category, caption: p.caption })),
      // ⚖ SELF-EXPLAINING NUMBERS (Liam 8/25): the count says WHAT it counts,
      // and it counts THIS session's photos.
      // ⚠ …AND IT IS OMITTED, NEVER ZERO, for a reader whose own permission
      // emptied the array (F-K14). The photos array is redacted above this line,
      // so 「写真 0枚」 to a staff member reading a discarded record would be a
      // number their permission made false — the same 「failed count OMITTED,
      // never 0」 instinct ⚖ §7a applies to counts.
      photoCountLabel: r.contentWithheld ? null : `このセッションの写真 ${r.photos.length}枚`,
      aiMessage: r.aiMessage,
      // 「—」 IS NOT 「同意なし」, and neither is 「録音なし」: three states, three
      // sentences (the 受信トレイ consent lesson, carried).
      recordingLine: !r.hasRecording
        ? 'この記録に紐づく録音はありません。'
        : r.consentOnFile
          ? '録音の同意を確認済みです。'
          : '録音はありますが、同意の記録がありません。',
      consentLabel: r.hasRecording && r.consentOnFile ? '同意確認済' : null,
      outcomeLabel: r.outcome ? OUTCOME_LABEL[r.outcome.status] : '結果 未記録',
      outcomePill: r.outcome ? OUTCOME_PILL[r.outcome.status] : 'pill',
      outcomeNote: outcomeNote(
        r.outcome
          ? {
              status: r.outcome.status,
              reason: r.outcome.reason ? DECLINE_LABEL[r.outcome.reason as keyof typeof DECLINE_LABEL] : null,
            }
          : null,
      ),
      // ⚖ TYPE TIER 1 — data presence, never a business-type branch: the ticket
      // line exists only on a record that holds a burn. A shop that does not
      // sell 回数券 has records that never hold one, and the same code renders
      // nothing for it. 26 業種, one rule.
      ticketLine: r.ticketRedeemed ? 'このセッションで回数券を1回消化しました' : null,
      discard: r.discarded
        ? {
            whenLabel: `${fmtDay.format(dayOf(r.dayKey))} ${hhmm(r.discarded.at)}`,
            by: r.discarded.by,
            reason: r.discarded.reason,
            // ⚖ 8/20's build requirement (b): R2 keeps a discarded record out of
            // every NUMBER, and money never auto-reverses — so a manager still
            // has to be told a ticket was consumed, or the correction they own
            // is one they cannot know to make. Manager-gated above the
            // serializer like the reason itself (F-K6).
            ticketNote: r.discarded.hadTicketBurn
              ? '破棄前にこのセッションで回数券を1回消化していました。返却の要否をご確認ください。'
              : null,
          }
        : null,
      visitLabel: `来店${r.visitNumber}回目`,
      lastVisitLabel: r.previousDayKey === null ? null : fmtDay.format(dayOf(r.previousDayKey)),
      customersHref,
    }
  })

  const props: KaruteProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    // Canon's own subtitle (MOCK-karute-list.html:348), trimmed of the mock's
    // ＋新規カルテ sentence: creating a record is the phone's job — the computer
    // door reads records back, and a create button here would be a lever with
    // nowhere to go (registry-free by design, and the head says so).
    //
    // ⚠ TWO MORE CANON SECTIONS ARE DELIBERATELY ABSENT, argued here because the
    // room's other omissions are (F-K15):
    // · AI体調予測 (MOCK-karute-detail.html:509-524) is an always-visible
    //   「対応予定」 slot rendering the app's own preview STUB — a faux confidence
    //   bar over data no fixture can derive. ⚖ 8/17 (the disconnected-depth
    //   overturn) ships discovered/speculative surfaces OFF, and a poster of a
    //   feature is the "not a tool" class the room-3 zero-state was rebuilt to
    //   end. It is not a registry line because there is no contract to reconnect
    //   — the prediction does not exist on either door yet.
    // · AIコーチング (:562-582) is a Layer-1 STAFF-PRIVATE surface: the phone
    //   hides it from owners outright, its suggestions are `null` in the app
    //   today, and packet §0-5 routes coaching's own laws
    //   (project_voice_recognition_isolation · coaching_design_principle) to the
    //   phone rather than here. Building a staff-private panel on the computer
    //   door — the one every manager reads — is the wrong home for it, so it is
    //   omitted rather than gated.
    subtitle:
      '施術記録の一覧です。行を選ぶと、記入内容・詳細記録・写真・結果をまとめて確認できます。検索や絞り込みは表示が変わるだけで、記録の内容は変わりません。',
    filters: FILTERS,
    // Canon's 担当 scope (`SCOPE_FILTERS`), with the logged-in operator as 自分.
    selfStaffId: operator.staff_id,
    selfLabel: `自分（${operator.name}）`,
    rows,
    // The quiet reveal's candidates — the lens's own customers with no record
    // here. Shown ONLY while searching, one row, and never a standing section.
    reveals: revealCandidates({ appointments, customers, records: models, clamped }).map((c) => ({
      customerId: c.customerId,
      name: c.name,
      furigana: c.furigana,
      memberNumber: c.memberNumber,
      mark: c.mark,
      customersHref,
    })),
    // ⚖ THE HONEST STATUS LINE (packet §7a). Both halves are backed by the
    // fixture world's real counts; the screen appends 表示中 from the rows it is
    // actually printing, so the head can never claim a number the list is not
    // showing. 「うち破棄」 is named rather than folded in — ⚖ R2 says a
    // discarded record feeds no statistic, so a reader must be able to take it
    // back out of the total without doing arithmetic.
    monthLabel:
      census.discarded > 0
        ? `カルテ 今月 ${census.total}件（うち破棄 ${census.discarded}件）`
        : `カルテ 今月 ${census.total}件`,
    noticeLines: permissionNotice(access),
    canReassign: access.reassign,
    actionFootnote: FOOTNOTE,
    refusals: {
      entry: REFUSAL.entry,
      summary: REFUSAL.summary,
      regenerate: REFUSAL.regenerate,
      message: REFUSAL.message,
      send: REFUSAL.send,
      outcome: REFUSAL.outcome,
      reassign: REFUSAL.reassign,
      photo: REFUSAL.photo,
    },
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}
