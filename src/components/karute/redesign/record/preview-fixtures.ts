// ─────────────────────────────────────────────────────────────
// PREVIEW FIXTURES — record/sessions page demo data
// ─────────────────────────────────────────────────────────────
// Used by sessions/page.tsx ONLY when the tenant has zero
// bookings for today AND no recent karute records. Lets staff +
// Anthony see the full record-page UI (recording-target card,
// pre-session brief, AI-hint scaffolding, memo block, picker
// dropdown) before real booking data exists in the DB.
//
// Auto-disables the moment the tenant has any real booking in
// the ±36h window — the server detects this in sessions/page.tsx
// and `previewMode` flips false.
//
// Values mirror the spike's `c1` customer (田中 美咲) so the UI
// matches Liam's design reference one-to-one. Anthony: this file
// is purely a scaffolding fixture — feel free to delete once the
// tenant onboarding flow seeds at least one demo booking on org
// creation.

import type { RecordPageNextAppointment } from './RecordPageView'
import type { RecordTargetBooking } from './RecordingTargetCard'
import type { PreSessionBrief } from './PreSessionBriefCard'

/** Build the preview booking, anchored to today at 14:00 JST. */
export function buildPreviewAppointment(now: Date): RecordPageNextAppointment {
  // Anchor to 14:00 JST today. Stored as ISO so the rest of the
  // pipeline (RecordPageView timezone formatter) renders it the
  // same way real bookings flow through.
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      // 14:00 JST = 05:00 UTC
      5,
      0,
      0,
      0,
    ),
  )
  const startMs = start.getTime()
  const endMs = startMs + 60 * 60_000
  const nowMs = now.getTime()
  const statusKey: 'in-session' | 'booked' | 'done' =
    startMs <= nowMs && nowMs < endMs
      ? 'in-session'
      : nowMs < startMs
        ? 'booked'
        : 'done'
  return {
    id: 'preview-c1',
    customerName: '田中 美咲',
    customerId: 'preview-c1-customer',
    startTime: start.toISOString(),
    durationMinutes: 60,
    title: 'フェイシャル・保湿強化コース',
    notes: null,
    statusKey,
  }
}

/** Picker rows — one current booking + two siblings so the
 *  「別の予約を選択」 dropdown has realistic content. */
export function buildPreviewNearbyBookings(now: Date): RecordTargetBooking[] {
  const baseHour = 14
  const rows: Array<{
    id: string
    hour: number
    customer: string
    initials: string
    karute: string | null
    service: string
    staff: string
    statusKey: RecordTargetBooking['statusKey']
    statusLabel: string
  }> = [
    {
      id: 'preview-c1',
      hour: baseHour,
      customer: '田中 美咲',
      initials: '田',
      karute: '#00120',
      service: 'フェイシャル・保湿強化コース',
      staff: '佐藤 あかり',
      statusKey: 'in-session',
      statusLabel: '施術中',
    },
    {
      id: 'preview-c2',
      hour: baseHour + 1,
      customer: '山本 葵',
      initials: '山',
      karute: '#00098',
      service: '頭皮スパ・60分',
      staff: '中島 ゆうこ',
      statusKey: 'booked',
      statusLabel: '予約済',
    },
    {
      id: 'preview-c3',
      hour: baseHour + 2,
      customer: '高橋 ひかり',
      initials: '高',
      karute: null,
      service: 'カウンセリング・新規',
      staff: '佐藤 あかり',
      statusKey: 'new',
      statusLabel: '新規',
    },
  ]
  return rows.map((r) => {
    const start = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        r.hour - 9, // JST → UTC
        0,
        0,
        0,
      ),
    )
    const end = new Date(start.getTime() + 60 * 60_000)
    const hhmm = (d: Date) =>
      d.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
      })
    return {
      id: r.id,
      start: hhmm(start),
      end: hhmm(end),
      customer: r.customer,
      initials: r.initials,
      karute: r.karute,
      service: r.service,
      staff: r.staff,
      statusKey: r.statusKey,
      statusLabel: r.statusLabel,
    }
  })
}

/** Brief built to match the spike's c1 fixture so the rendered
 *  card matches Liam's design reference visually. lastVisit
 *  derived from today so the 28-day-ago copy stays accurate. */
export function buildPreviewBrief(now: Date, locale: string): PreSessionBrief {
  const lastVisit = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
  const lastVisitDate =
    locale === 'ja'
      ? `${lastVisit.getFullYear()}年${lastVisit.getMonth() + 1}月${lastVisit.getDate()}日`
      : lastVisit.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
  const lastVisitAgo = locale === 'ja' ? '28日前' : '28d ago'

  return {
    isFirstTimeVisit: false,
    lastVisitDate,
    lastVisitAgo,
    reservationMemo:
      locale === 'ja'
        ? '頬の乾燥が気になります。花粉症が始まってから特に酷くなりました。前回いただいた試供品の本製品の購入も検討しています。'
        : "Cheek dryness has been bothering me. It's gotten worse since hay-fever season started. I'm also considering purchasing the full-size of the sample you gave me last time.",
    hooks:
      locale === 'ja'
        ? [
            {
              title: '愛犬ラグ（柴犬・3歳）',
              body: '昨年保護施設から引き取り。花粉アレルギーあり。散歩は朝夕1時間ずつ。',
            },
            {
              title: '先月京都旅行',
              body: '久しぶりの家族旅行で嵐山へ。竹林が気に入ったとのこと。',
            },
            {
              title: '「モイストシールド」試供品に好反応',
              body: '前回お渡し。本製品の購入を検討中。',
            },
          ]
        : [
            {
              title: 'Dog "Rug" (Shiba Inu, 3yrs)',
              body: 'Rescued from a shelter last year. Has pollen allergy. Walks twice daily.',
            },
            {
              title: 'Kyoto trip last month',
              body: 'First family trip in a while — Arashiyama bamboo forest was the highlight.',
            },
            {
              title: 'Strong reaction to MoistShield sample',
              body: 'Given last visit. Considering buying the full-size.',
            },
          ],
    concerns:
      locale === 'ja'
        ? ['頬の乾燥が主訴。花粉季で悪化傾向', '前回の肩こりは維持ケアで改善傾向']
        : [
            'Main complaint: cheek dryness. Worsening with pollen season.',
            'Previous shoulder tension improving with maintenance care.',
          ],
    lastProduct:
      locale === 'ja'
        ? {
            name: '新保湿クリーム「モイストシールド」試供品',
            reaction: '好反応。本製品の購入を検討中',
          }
        : {
            name: 'MoistShield moisturizer sample',
            reaction: 'Strong positive reaction. Considering full-size purchase.',
          },
    recommendedFocus:
      locale === 'ja'
        ? '保湿ケアの継続と、花粉季明けのアフターケア提案'
        : 'Continue moisture care; propose post-pollen-season aftercare.',
  }
}
