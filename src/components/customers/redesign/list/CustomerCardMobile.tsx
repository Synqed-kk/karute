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
        {/* Line 1: name · honorific · karute # · status chip.
         *  The name gets `min-w-0` (so it truncates) and the trailing
         *  items get `shrink-0`, so a long name can't push the #number +
         *  status chip onto a second line — that wrap read as the chip
         *  "drifting to center" + the number "going missing". */}
        <div className="flex flex-wrap items-baseline gap-1.5">
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

        {/* Line 2: meta — segments render ONLY with real content, joined with
         *  '·' (no dangling separators). age/gender are stub-null today; 登録日
         *  shows only while the customer is 新規 (Liam: a regular's join date
         *  is trivia). Line skips entirely when empty. */}
        {(() => {
          const segs: string[] = []
          if (c.age != null) segs.push(t('row.ageValue', { age: c.age }))
          if (c.gender) segs.push(c.gender)
          if (c.status === 'new') segs.push(t('joined', { date: c.joinDate }))
          return segs.length > 0 ? (
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {segs.join(' · ')}
            </div>
          ) : null
        })()}

        {/* Line 3: last visit — THREE honest states. (a) dated visit → full
         *  line. (b) no date but a nonzero count (QR carries visit_count
         *  without visit rows) → count + 「最終来店日の記録なし」; NEVER print
         *  来店履歴なし next to 来店4回 (a literal contradiction). (c) truly
         *  zero history → the single 来店履歴なし token, once. */}
        {c.lastVisitDate !== '—' ? (
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {/* Emphasis FLIPPED (Liam ①): the（N日前）token is the decision-
             *  relevant string — full foreground, amber once the resolver says
             *  要フォロー/休眠 (same thresholds, single source); the date is
             *  the muted detail. */}
            <span className="text-muted-foreground/60">
              {t('row.lastVisitPrefix')} {c.lastVisitDate}
            </span>
            <span
              className={
                c.status === 'needs-followup' || c.status === 'dormant'
                  ? 'font-medium text-amber-600 dark:text-amber-400'
                  : 'font-medium text-foreground/90'
              }
            >
              {' '}（{c.lastVisitAgo}）
            </span>
            <span> · </span>
            {c.lastVisitService && (
              <span className="text-foreground/80">{c.lastVisitService} · </span>
            )}
            <span>{t('row.visitsSuffix', { n: c.totalKarute })}</span>
          </div>
        ) : c.totalKarute > 0 ? (
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            <span>{t('row.visitsSuffix', { n: c.totalKarute })}</span>
            <span className="text-muted-foreground/60">
              {' '}
              ·（{t('lastVisit.dateUnknown')}）
            </span>
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {c.lastVisitAgo}
          </div>
        )}

        {/* Line 3b: 回数券 — remaining sessions, unconsumed value, 次回予約.
         *  Renders ONLY for pack holders (no clutter otherwise). 'contact'
         *  alert = pulsing red 要連絡 pill (manager-dismissable in P3b);
         *  'low' = amber 残り1回 (next-pack conversation). */}
        {c.pack && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
            {c.packAlert === 'contact' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-1.5 py-px font-medium text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                {t('row.packContact')}
              </span>
            )}
            {/* Color budget (Liam ③): healthy counts are PLAIN text — color
             *  only where action is needed (amber 残り1回, red 要連絡 pill), so
             *  the post-import list doesn't become a wall of green. */}
            <span
              className={
                c.packAlert === 'low'
                  ? 'font-medium text-amber-600 dark:text-amber-400'
                  : 'font-medium text-foreground/90'
              }
            >
              {t('row.packRemaining', { n: c.pack.remaining })}
            </span>
            {c.pack.unconsumed > 0 && (
              <span className="text-muted-foreground">
                ¥{c.pack.unconsumed.toLocaleString('ja-JP')}
              </span>
            )}
            <span
              className={
                c.hasNextBooking
                  ? 'text-muted-foreground'
                  : 'text-amber-600 dark:text-amber-400'
              }
            >
              {c.hasNextBooking ? t('row.nextBookingYes') : t('row.nextBookingNo')}
            </span>
          </div>
        )}

        {/* Line 4: staff + recommended next visit — each half renders only
         *  when it has real content. 担当：— told staff nothing; 推奨来店 ー is
         *  a stub (defaultAiPredict returns '—' until the model ships) that
         *  printed an unexplained dash on ~90% of cards. Whole line skipped
         *  when both are empty. */}
        {(c.preferredStaffName ?? c.bookingStaffName) || c.aiPredict.when !== '—' ? (
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {(c.preferredStaffName ?? c.bookingStaffName) && (
              <span>
                {t('row.staff', {
                  name: c.preferredStaffName ?? c.bookingStaffName ?? '',
                })}
              </span>
            )}
            {c.aiPredict.when !== '—' && (
              <span className="text-muted-foreground/40">
                {(c.preferredStaffName ?? c.bookingStaffName) ? ' · ' : ''}
                {t('row.recommendPrefix')} {c.aiPredict.when}
              </span>
            )}
          </div>
        ) : null}

        {/* Line 5: phone — only on the 顧客 tab (CRM context). The
         *  カルテ tab is treatment-focused; phone is contact data, not
         *  treatment context. Hide it there to tighten the row + match
         *  the spike's karute pattern. */}
        {/* PLAIN text by design (Liam): in the list you're SCANNING, not
         *  calling — a blue link on every card is noise + a mis-tap hazard
         *  inside the card's big tap-target. Calling lives where there's
         *  INTENT: the profile's tel: link, and the round call button that
         *  appears on 要連絡 cards below. */}
        {c.phone && !karuteContext && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <Phone className="size-2.5 shrink-0" aria-hidden />
            <span>{formatJpPhone(c.phone)}</span>
          </div>
        )}

        {/* Line 6 (karute context only): AI status chip row */}
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
          className="flex size-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-red-400 text-red-600 transition-transform active:scale-95 dark:border-red-500/50 dark:text-red-400"
        >
          <Phone className="size-[18px]" aria-hidden />
        </button>
      )}
    </Link>
  )
}
