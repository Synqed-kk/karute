// 受信トレイ — the canon screen (fable-store-inbox.html), transplanted whole
// under ⚖ Liam's 8/19 transplant ruling: same structure, same layout, same
// wording, running on PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join,
// deadline and time format happens here, so the client receives plain strings.
// No timezone and no locale can drift between the two renders, and no data
// access exists on the client at all.
//
// READING AND TRIAGE ARE BUILDABLE; SENDING IS A WRITE. Canon's 返信する and
// 対応を完了する both change the world — one sends a message to a real person,
// the other writes a resolution and an operator into the record. Both ship
// REFUSED with their reason, in the family's own grammar, and both are named in
// the build report's registry rather than half-built behind a dialog whose only
// outcome is a toast saying nothing happened (the dead-lever class one level
// down — 予約一覧 and スタッフ・シフト set that precedent).
//
// ONE FIXTURE WORLD, and this room is the one that proves it: a thread's
// deadline is 予約一覧's own `deadlineOf`, its status is 今日の運営's own
// 次に決めること card, its booking line is the appointment every other room
// paints, its 履歴 is that booking's own 操作履歴, and its 連絡同意 is the
// 顧客台帳's — in the 顧客 screen's own words. The room states almost nothing of
// its own, which is the point.
//
// THE STORE LENS IS THE ONLY GATE. Canon puts no role gate on this page (no
// 権限 copy, no role word, no hidden branch in its script — grepped), so the
// room ships ungated and the question 「who may read customer messages」 is
// raised by name in the settings registry rather than invented here.

import { requireBusinessAdmission } from '@/business/lib/admission'
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
import { threads as threadPlane } from '@/business/lib/fixtures-inbox'
import { buildThreads, FILTERS, summarize } from '@/business/lib/inbox'
import { InboxScreen } from './InboxScreen'
import './inbox.css'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  // A missing or unknown ?store= opens on the operator's own store, never the
  // business-wide merge — defaultStoreId owns that rule for every screen.
  const storeId = defaultStoreId(query.store, storeOptions)
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
    threads: threadPlane,
    customers,
    appointments,
    menus,
    reservations: reservationPlanes.reservations,
    decisions: dayPlanes.decisions,
    auditTrail: reservationPlanes.auditTrail,
    nowMinute: dayPlanes.boardNow,
    closeMinute: dayPlanes.operatingHours.close,
    dayLabel: (iso) => fmtDay.format(new Date(iso)),
    minuteOf: (iso) => jstMinuteOfDay(iso),
  })

  const summary = summarize(models)
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : ''

  return (
    <InboxScreen
      dateline={`サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`}
      lensLabel={lensLabel}
      filters={FILTERS}
      threads={models.map((t) => ({
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
      }))}
      summary={summary}
      // Canon's own subtitle, unchanged.
      subtitle="予約変更、来店なし、空き待ち、配信失敗を、期限と連絡許可の事実から処理します。"
      // The two standing explainer paragraphs — canon's head note and the 対応
      // 状況 strip's own sentence — word for word, now behind the ? affordance
      // instead of printed above the numbers every morning.
      helpText="メッセージの数ではなく、店舗が次に行う対応を並べています。顧客カルテの施術内容はここには表示しません。期限、予約への影響、同意済み連絡先、配信証跡を確認してから送信します。"
      // ONE line where the room used to carry two refusal paragraphs. The
      // per-control reasons above are unchanged; this is the standing sentence.
      actionFootnote="見本データのため送信・記録はできません — 実データ接続後に有効になります。"
      refreshRefusal="見本データのため、Reserve・配信状態の再取得はできません。"
    />
  )
}
