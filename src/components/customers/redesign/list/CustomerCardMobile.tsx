'use client'

import { Phone } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { formatJpPhone } from '@/lib/format/phone'
import { cn } from '@/lib/utils'
import { getStaffColorByKey, type StaffColor } from '@/lib/staff-colors'
import type { CustomerListRow } from '../types'
import { STATUS_STYLES } from '../types'
import { AiStatusChipRow } from './AiStatusChipRow'

interface CustomerCardMobileProps {
  c: CustomerListRow
  staffColorKey: StaffColor['key'] | null
  /**
   * When `true`, renders a row of AI status chips at the bottom of
   * the card (体調予測 / 推奨 / 要約 / 録音, all 対応予定 for now).
   * Used by the カルテ tab to frame the same customer rows as
   * karute folders. Defaults to false on the 顧客 tab so the CRM
   * view stays compact.
   */
  karuteContext?: boolean
  /**
   * URL base for the card's tap target. The customer id gets
   * appended as `${hrefBase}/${c.id}`. Defaults to `/customers` so
   * 顧客-tab cards route to the customer profile (with tabs). The
   * カルテ tab passes `/karute/customer` so cards route to the
   * karute-detail page (vertical stack, spike's layout).
   */
  hrefBase?: string
}

/**
 * Mobile list row — mirrors the design-spike's compact `CustomerRow` layout:
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ ▎ (●) Name 様 #00120                            [status chip] │
 *   │     32歳・女性 · 登録 2026年2月10日                              │
 *   │     前回 2026/04/12（28日前）· 来店4回                            │
 *   │     担当：高橋 さくら · 推奨来店 2026/05/10                        │
 *   │     ☎ 090-1234-5678                                          │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Sibling rows separate via `border-b` and the parent list container
 * supplies the rounded card chrome. The 3px staff color stripe is
 * absolutely positioned on the left edge so it stays flush regardless
 * of row height.
 */
export function CustomerCardMobile({
  c,
  staffColorKey,
  karuteContext = false,
  hrefBase = '/customers',
}: CustomerCardMobileProps) {
  const t = useTranslations('customers.list')
  const status = STATUS_STYLES[c.status]
  const honorific = t('row.honorific')
  const staff = getStaffColorByKey(staffColorKey)
  return (
    <Link
      href={`${hrefBase}/${c.id}` as Parameters<typeof Link>[0]['href']}
      className={`relative flex items-center gap-3 border-b border-border transition-colors hover:bg-muted/30 active:bg-muted/50 last:border-b-0 ${
        karuteContext ? 'px-4 py-2.5' : 'px-4 py-3'
      }`}
    >
      {/* Staff color stripe on left edge — same idiom as the spike.
       *  Falls back to a subtle muted bar (instead of transparent) when
       *  the customer has no preferred staff so the row still reads as
       *  "list item with consistent left-edge accent" rather than
       *  visually collapsing. The bar is intentionally inset 12px from
       *  top/bottom so the row's border-b can pass through cleanly,
       *  giving the cut-into-sections look from the spike. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full',
          staffColorKey ? staff.stripe : 'bg-border',
        )}
      />

      {/* Avatar — smaller in karute context (size-8 / 32px) to match
       *  the spike's tighter karute-tab density; full size (size-10 /
       *  40px) on the 顧客 tab where the CRM card has more breathing
       *  room. */}
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-foreground ring-1 ring-border/60 ${
          karuteContext ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
        }`}
      >
        {c.initials}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* ── 案A "rails" (Liam-approved): NO flex-wrap anywhere in this card.
         *  Every line is a single flex row; fixed tokens are shrink-0 +
         *  whitespace-nowrap; exactly ONE element per line may truncate.
         *  With no legal wrap points, overflow can only resolve as an
         *  ellipsis in the designated truncator — token orphaning (the
         *  来店1回-on-its-own-line bug) is impossible by construction.
         *  Right edges form four scannable rails: chip → （N日前）→ 予約 → ☎. */}

        {/* L1 IDENTITY — name is the sole truncator; chip pinned right. */}
        <div className="flex items-baseline gap-1.5">
          {/* Name — `text-[15px] md:text-sm font-medium` mirrors the
           *  design spike. Previous `text-sm font-semibold` rendered
           *  smaller + heavier, making the name look "fatter and
           *  smaller" vs the spike's airier, slightly larger feel. */}
          <span className="min-w-0 truncate text-[15px] font-medium text-foreground md:text-sm">
            {c.name}
          </span>
          {honorific && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {honorific}
            </span>
          )}
          {/* Plain muted text — no boxed badge. Matches the spike's
           *  cleaner "name · #00120" treatment vs the previous code-
           *  block look. */}
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {c.karuteNumber}
          </span>
          {/* EXCEPTIONS-ONLY chip (Liam): 継続中 is the default state — a green
           *  chip on ~90% of rows camouflaged the rare amber/red ones staff
           *  actually scan for. No chip = fine; 新規/要フォロー/休眠 pop. */}
          {c.status !== 'on-track' && (
            <span
              className={`ml-auto shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} ${status.border}`}
            >
              {t(`status.${c.status}`)}
            </span>
          )}
        </div>

        {/* L2 VISIT — date (muted, compact) | course (sole truncator, doubles
         *  as the spacer) |（N日前）pinned right (the recency rail; amber via
         *  the resolver's own 要フォロー/休眠 states). Three honest states. */}
        {c.lastVisitDate !== '—' ? (
          <div className="mt-1 flex items-baseline gap-x-2 text-[11px] tabular-nums">
            <span className="shrink-0 whitespace-nowrap text-muted-foreground/60">
              {t('row.lastVisitPrefix')} {c.lastVisitDateCompact ?? c.lastVisitDate}
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground/80">
              {c.lastVisitService ?? ''}
            </span>
            <span
              className={`ml-auto shrink-0 whitespace-nowrap font-medium ${
                c.status === 'needs-followup' || c.status === 'dormant'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-foreground/90'
              }`}
            >
              （{c.lastVisitAgo}）
            </span>
          </div>
        ) : c.totalKarute > 0 ? (
          <div className="mt-1 flex items-baseline gap-x-2 text-[11px] tabular-nums">
            <span className="shrink-0 text-muted-foreground/60">
              {t('lastVisit.dateUnknown')}
            </span>
          </div>
        ) : (
          <div className="mt-1 flex items-baseline gap-x-2 text-[11px] text-muted-foreground tabular-nums">
            <span className="shrink-0">{c.lastVisitAgo}</span>
            {c.status === 'new' && (
              <span className="shrink-0 whitespace-nowrap text-muted-foreground/60">
                {t('joined', { date: c.joinDateCompact ?? c.joinDate })}
              </span>
            )}
          </div>
        )}

        {/* L3 PACK (holders only) — every token shrink-0; the booking rail
         *  pinned right shows the REAL next-booking date (予約 6/15), not a
         *  boolean. Color budget: red 要連絡 pill / amber 残り1回・予約なし only. */}
        {c.pack && (
          <div className="mt-1 flex items-center gap-x-2 text-[11px] tabular-nums">
            {c.packAlert === 'contact' && (
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-1.5 py-px font-medium text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                {t('row.packContact')}
              </span>
            )}
            <span
              className={`shrink-0 whitespace-nowrap font-medium ${
                c.packAlert === 'low'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-foreground/90'
              }`}
            >
              {t('row.packRemainingShort', { n: c.pack.remaining })}
            </span>
            {c.pack.unconsumed > 0 && (
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                ¥{c.pack.unconsumed.toLocaleString('ja-JP')}
              </span>
            )}
            <span
              className={`ml-auto shrink-0 whitespace-nowrap ${
                c.nextBookingDate
                  ? 'text-muted-foreground'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {c.nextBookingDate
                ? t('row.bookingDate', { date: c.nextBookingDate })
                : t('row.bookingNone')}
            </span>
          </div>
        )}

        {/* L4 RELATIONSHIP — 担当 (this line's truncator + spacer) | 来店N回
         *  (the formerly-orphaned token, now physically un-orphanable) | ☎
         *  pinned right (plain text per Liam's rule; intent lives in the
         *  要連絡 button + profile tel:). Skips entirely when empty. */}
        {(() => {
          const staffName = c.preferredStaffName ?? c.bookingStaffName
          const showPhone = !!c.phone && !karuteContext
          if (!staffName && c.totalKarute === 0 && !showPhone) return null
          return (
            <div className="mt-1 flex items-center gap-x-2 text-[11px] text-muted-foreground tabular-nums">
              {staffName ? (
                <span className="min-w-0 flex-1 truncate">
                  {t('row.staff', { name: staffName })}
                </span>
              ) : (
                <span className="min-w-0 flex-1" aria-hidden />
              )}
              {c.totalKarute > 0 && (
                <span className="shrink-0 whitespace-nowrap">
                  {t('row.visitsSuffix', { n: c.totalKarute })}
                </span>
              )}
              {showPhone && (
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
                  <Phone className="size-2.5 shrink-0" aria-hidden />
                  {formatJpPhone(c.phone!)}
                </span>
              )}
            </div>
          )
        })()}

        {/* karute context only: AI status chip row */}
        {karuteContext && <AiStatusChipRow />}
      </div>

      {/* 要連絡 cards get a round call button on the right edge — the alert
       *  and its resolution sit together (design #4). Same idiom as the
       *  profile's bottom-right mic button. */}
      {c.packAlert === 'contact' && c.phone && !karuteContext && (
        <button
          type="button"
          aria-label={`${c.name} ${formatJpPhone(c.phone)}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            window.location.href = `tel:${c.phone}`
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-red-400 text-red-600 transition-transform active:scale-95 dark:border-red-500/50 dark:text-red-400"
        >
          <Phone className="size-[18px]" aria-hidden />
        </button>
      )}
    </Link>
  )
}
