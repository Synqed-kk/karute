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
          <span
            className={`ml-auto shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} ${status.border}`}
          >
            {t(`status.${c.status}`)}
          </span>
        </div>

        {/* Line 2: meta */}
        <div className="text-[11px] text-muted-foreground tabular-nums">
          <span>{c.age ?? '—'}</span>
          <span> · </span>
          <span>{c.gender ?? '—'}</span>
          <span> · </span>
          <span>{t('joined', { date: c.joinDate })}</span>
        </div>

        {/* Line 3: last visit summary — date ·（ago）· [last treatment] · visit count */}
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span>{t('row.lastVisitPrefix')} {c.lastVisitDate}</span>
          <span className="text-muted-foreground/60"> （{c.lastVisitAgo}） · </span>
          {c.lastVisitService && (
            <span className="text-foreground/80">{c.lastVisitService} · </span>
          )}
          <span>{t('row.visitsSuffix', { n: c.totalKarute })}</span>
        </div>

        {/* Line 4: staff + recommended next visit (recommend half is stubbed) */}
        <div className="text-[11px] text-muted-foreground tabular-nums">
          <span>
            {t('row.staff', { name: c.preferredStaffName ?? c.bookingStaffName ?? '—' })}
          </span>
          <span className="text-muted-foreground/40">
            {' · '}
            {t('row.recommendPrefix')} {c.aiPredict.when}
          </span>
        </div>

        {/* Line 5: phone — only on the 顧客 tab (CRM context). The
         *  カルテ tab is treatment-focused; phone is contact data, not
         *  treatment context. Hide it there to tighten the row + match
         *  the spike's karute pattern. */}
        {c.phone && !karuteContext && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <Phone className="size-2.5 shrink-0" aria-hidden />
            <span>{formatJpPhone(c.phone)}</span>
          </div>
        )}

        {/* Line 6 (karute context only): AI status chip row */}
        {karuteContext && <AiStatusChipRow />}
      </div>
    </Link>
  )
}
