'use client'

// LIFTED FROM SPIKE (visual: ~90% verbatim, hooks adapted)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute-list/KaruteListRow.tsx
//
// Renders one karute record as a list row. Date column sits left on
// desktop only (on mobile the date is redundant — the parent's date
// group header already shows it). Staff color stripe on the left
// edge matches the customer-card pattern so a stylist's color stays
// consistent everywhere they appear.
//
// Adaptations from spike:
//   useT() / useTheme()                  → useTranslations() + useLocale()
//   useShowCrossStaffNamesKarute / mask  → not lifted (cross-staff privacy
//                                          toggle not in karute yet)
//   findKaruteNumberByName fallback      → not needed (number passed in)
//   AIStatusChip / ConversionStatusChip  → inline below (small, file-local)

import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { getStaffColorByKey } from '@/lib/staff-colors'
import type {
  KaruteListItem,
  KaruteAiStatus,
  KaruteConversionStatus,
} from './types'

interface Props {
  item: KaruteListItem
}

export function KaruteListRow({ item }: Props) {
  const t = useTranslations('karute.recordList')
  const staffColor = getStaffColorByKey(item.staffColorKey)

  return (
    <Link
      href={item.href as Parameters<typeof Link>[0]['href']}
      className="group relative flex min-h-[60px] items-center gap-3 border-b border-black/5 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted/30 active:bg-muted/50 dark:border-white/5 md:gap-4"
    >
      {/* Staff color stripe (left edge) — same idiom as customer cards */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full',
          staffColor.stripe,
        )}
      />

      {/* Per-row date — desktop only. Mobile groups by date in the
       *  parent header, so per-row would be redundant noise. */}
      <div className="hidden w-12 shrink-0 text-center md:block">
        <div className="text-xs font-semibold tabular-nums text-foreground">
          {item.date.slice(5).replace('-', '/')}
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {item.weekday}
        </div>
      </div>

      {/* Avatar — subtle staff-color tint + dark legible initials. */}
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1',
          staffColor.bg,
          staffColor.text,
          staffColor.ring,
        )}
      >
        {item.customerInitials}
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1">
        {/* Line 1 — customer name + honorific + karute # + chips */}
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[14px] font-medium text-foreground">
            {item.customerName}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            様
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {item.customerKaruteNumber}
          </span>
          {/* Mobile chips: AI + conversion status on the right.
           *  Suppressed for placeholders — a customer with no karute yet has
           *  nothing drafted (下書き) and no conversion to resolve (仮カルテ);
           *  those chips would misread as "session in progress". */}
          {!item.isPlaceholder && (
            <span className="ml-auto flex shrink-0 items-center gap-1 md:hidden">
              <ConversionChip status={item.conversionStatus} />
              <AiChip status={item.aiStatus} />
            </span>
          )}
        </div>

        {/* Line 2 — summary (truncate) */}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {item.summary || '—'}
        </p>

        {/* Line 3 (mobile) — service + duration + staff */}
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground md:hidden">
          <span className="truncate">
            {item.service}
            {item.duration > 0 && (
              <>
                <span className="mx-1 text-muted-foreground/40">·</span>
                <span className="tabular-nums">
                  {item.duration}
                  {t('minutesSuffix')}
                </span>
              </>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 truncate">
            <span
              aria-hidden
              className={cn('size-1.5 shrink-0 rounded-full', staffColor.stripe)}
            />
            <span className="truncate">{item.staffName}</span>
          </span>
        </div>
      </div>

      {/* Desktop-only columns: service + duration + staff + chips */}
      <div className="hidden w-[160px] shrink-0 text-[11px] text-muted-foreground md:block">
        <div className="truncate">{item.service}</div>
        {item.duration > 0 && (
          <div className="tabular-nums">
            {item.duration}
            {t('minutesSuffix')}
          </div>
        )}
      </div>

      <div className="hidden w-[120px] shrink-0 truncate text-[11px] text-muted-foreground md:block">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn('size-1.5 shrink-0 rounded-full', staffColor.stripe)}
          />
          <span className="truncate">{item.staffName}</span>
        </span>
      </div>

      {/* Status chips (desktop) — suppressed for placeholders; see mobile note. */}
      {!item.isPlaceholder && (
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <ConversionChip status={item.conversionStatus} />
          <AiChip status={item.aiStatus} />
        </div>
      )}
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────
// Inline chips — kept file-local since they're tightly coupled to
// this row's status taxonomy. If reused elsewhere, lift into their
// own files.
// ─────────────────────────────────────────────────────────────

const AI_STATUS_STYLE: Record<
  KaruteAiStatus,
  { bg: string; text: string; border: string }
> = {
  summarized: {
    bg: 'bg-green-50 dark:bg-green-500/10',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-500/20',
  },
  pending: {
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-500/30',
  },
  needsReview: {
    bg: 'bg-rose-50 dark:bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-500/20',
  },
  draft: {
    bg: 'bg-gray-50 dark:bg-white/[0.05]',
    text: 'text-gray-700 dark:text-gray-300',
    border: 'border-gray-200 dark:border-white/10',
  },
}

function AiChip({ status }: { status: KaruteAiStatus }) {
  const t = useTranslations('karute.recordList.aiStatus')
  const s = AI_STATUS_STYLE[status]
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium ${s.bg} ${s.text} ${s.border}`}
    >
      <span aria-hidden>✦</span>
      <span>{t(status)}</span>
    </span>
  )
}

function ConversionChip({ status }: { status: KaruteConversionStatus }) {
  const t = useTranslations('karute.recordList.conversionStatus')
  if (status !== 'provisional') return null
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      <span aria-hidden>◷</span>
      <span>{t('provisional')}</span>
    </span>
  )
}
