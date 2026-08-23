// 受信トレイ — the room's PROP ASSEMBLY, extracted from page.tsx so that the
// page and the evidence harness cannot drift apart.
//
// WHY THIS FILE EXISTS AT ALL. The rebuild's isolated evidence used to render a
// hand-authored HTML replica of InboxScreen, and the replica silently drifted
// from the product (five rows under a filter that shows four, a customer wearing
// the wrong 顧客番号). Every shot then pictured a page the product could not
// produce. The fix is structural rather than diligent: the probe now imports
// THIS function, so an isolated shot is the same assembly the deployed page
// runs, and a drift is a compile error instead of a picture nobody can check.
//
// Everything the page did between admission and the render lives here — the
// lens, the one clock read, the five store-clamped reads, the derivations and
// the string formatting. `page.tsx` keeps the admission gate, the route params
// and the sheet import, which are the things a route entry owns.

import { jstDayKey, jstMinuteOfDay } from '@/business/lib/clock'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listStoreOptions,
  readDayPlanes,
  readReservationPlanes,
  renderNow,
  type StoreLens,
} from '@/business/lib/data'
import { threads as threadPlane, type FixtureThread } from '@/business/lib/fixtures-inbox'
import { type FixtureDecision } from '@/business/lib/fixtures-today'
import { buildThreads, FILTERS, summarize } from '@/business/lib/inbox'
import { type InboxProps } from './InboxScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })

export interface InboxPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness needs two worlds this demo plane does not contain — a
   *  64-thread queue and an all-clear morning — and the only honest way to
   *  picture either is to run the REAL derivations on a different fixture
   *  world, never a class toggle or a hand-written replica. Both fields are
   *  exactly the shapes the fixture modules export. */
  world?: {
    threads?: FixtureThread[]
    decisions?: FixtureDecision[]
  }
}

export interface InboxPropsResult {
  props: InboxProps
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. `page.tsx` keys the screen by it, which is
   *  what makes filter / selection / detail-open reset on a store switch
   *  instead of surviving into a queue that no longer contains them. */
  storeKey: string
}

/** Resolve everything InboxScreen is handed. Server-only by construction: every
 *  read goes through `@/business/lib/data`'s store-clamped fixture door. */
export async function inboxProps({ locale, store, world }: InboxPropsInput): Promise<InboxPropsResult> {
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  // ONE CLOCK READ PER RENDER (the cycle-1 law): the queue's day, its
  // deadlines and its 期限超過 flags all derive from this one instant, so a
  // render crossing JST midnight cannot put two different days on one screen.
  const now = renderNow()
  const todayKey = jstDayKey(now)

  const [customers, appointments, menus, dayPlanes, reservationPlanes] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listMenus(lens),
    readDayPlanes(lens, todayKey),
    readReservationPlanes(lens),
  ])

  const models = buildThreads({
    threads: world?.threads ?? threadPlane,
    customers,
    appointments,
    menus,
    reservations: reservationPlanes.reservations,
    decisions: world?.decisions ?? dayPlanes.decisions,
    auditTrail: reservationPlanes.auditTrail,
    nowMinute: dayPlanes.boardNow,
    closeMinute: dayPlanes.operatingHours.close,
    dayLabel: (iso) => fmtDay.format(new Date(iso)),
    minuteOf: (iso) => jstMinuteOfDay(iso),
  })

  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : ''

  const props: InboxProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    filters: FILTERS,
    threads: models.map((t) => ({
      id: t.id,
      category: t.category,
      categoryLabel: t.categoryLabel,
      mark: t.mark,
      markTone: t.markTone,
      status: t.status,
      statusLabel: t.statusLabel,
      overdue: t.overdue,
      customerName: t.customerName,
      memberNumber: t.memberNumber,
      subject: t.subject,
      preview: t.preview,
      receivedLabel: t.receivedLabel,
      dueLabel: t.dueLabel,
      source: t.source,
      proofTitle: t.proofTitle,
      proofLines: t.proofLines,
      bookingLabel: t.bookingLabel,
      bookingNo: t.bookingNo,
      deliveryState: t.deliveryState,
      deliveryLabel: t.deliveryLabel,
      next: t.next,
      reply: t.reply,
      channels: t.channels,
      recommendedReason: t.recommendedReason,
      history: t.history,
      // 予約一覧で事実を確認 — a real link, but only where there IS a booking
      // to confirm. A 空き待ち has none, so the control refuses with its
      // reason rather than sending the reader to a list that cannot answer.
      bookingHref: t.bookingNo ? `/${locale}/business/reservations${storeQuery}` : null,
      // ⚠SETTINGS-BATCH / registry: 返信 and 対応の完了 are WRITES. Both ship
      // refused with the reason on the control itself, and the reply the room
      // WOULD send is shown above them — refusing to send is honest, hiding
      // what would have been sent is not.
      primaryLabel:
        t.category === 'waitlist' ? '空き枠を提案' : t.category === 'delivery' ? '同意を確認して再送' : '返信する',
      primaryRefusal:
        '見本データのため送信できません。実際の送信はReserveの連絡機能につないだあとに行います。',
      resolveLabel: t.category === 'noshow' ? '今回は請求しない' : '解決として記録',
      resolveRefusal:
        '見本データのため記録できません。完了の記録は実行者と理由を残す操作のため、実データの接続後に有効になります。',
    })),
    summary: summarize(models),
    // Canon's own subtitle, unchanged.
    subtitle: '予約変更、来店なし、空き待ち、配信失敗を、期限と連絡許可の事実から処理します。',
    // The two standing explainer paragraphs — canon's head note and the 対応
    // 状況 strip's own sentence — word for word, now behind the ? disclosure
    // instead of printed above the numbers every morning. One entry per
    // paragraph, because the disclosure prints them as two.
    helpText: [
      'メッセージの数ではなく、店舗が次に行う対応を並べています。顧客カルテの施術内容はここには表示しません。',
      '期限、予約への影響、同意済み連絡先、配信証跡を確認してから送信します。',
    ],
    // ONE line where the room used to carry two refusal paragraphs. The
    // per-control reasons above are unchanged; this is the standing sentence.
    actionFootnote: '見本データのため送信・記録はできません — 実データ接続後に有効になります。',
    refreshRefusal: '見本データのため、Reserve・配信状態の再取得はできません。',
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}
