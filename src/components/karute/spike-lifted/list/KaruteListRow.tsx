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

import { useEffect, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { getStaffColorByKey } from '@/lib/staff-colors'
import { deriveFamilyInitials } from '@/lib/customers/identity'
import { partsInJst } from '@/lib/date/jst'
import { isNativeShell } from '@/lib/platform'
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

// ─────────────────────────────────────────────────────────────
// NoKaruteRevealRow — the カルテ tab search-reveal's ONE row (PR-1b 検索
// リビール): a customer matching the search term who has no karute yet in
// this store. Deliberately NOT a KaruteListItem — the reveal action returns
// a much smaller shape (id/name/code/registeredDate; no staff, no status),
// so this gets its own small renderer rather than overloading KaruteListRow
// with a second data shape.
//
// Web renders a カルテを作成 button (opens NewKaruteDialog preselected —
// wired by the caller via onCreateClick); the phone shell has no wired
// create action (createManualKaruteRecord is a deliberate notWired stub
// there), so it makes the whole row a Link to the customer hub instead —
// same destination the pre-PR-1a placeholder rows used. isNativeShell() is
// the existing app-wide "are we in the Capacitor shell" signal (src/lib/
// platform.ts, e.g. WebOnly) — deferred to a post-mount effect so SSR and
// the shell agree on the FIRST paint (same defensive posture WebOnly uses).
// ─────────────────────────────────────────────────────────────

export interface NoKaruteCandidate {
  id: string
  name: string
  code: string
  registeredDate: string
}

interface NoKaruteRevealRowProps {
  candidate: NoKaruteCandidate
  onCreateClick: () => void
}

export function NoKaruteRevealRow({ candidate, onCreateClick }: NoKaruteRevealRowProps) {
  const t = useTranslations('karute.recordList')
  const [isNative, setIsNative] = useState(false)
  useEffect(() => {
    setIsNative(isNativeShell())
  }, [])

  const isoDate = candidate.registeredDate.slice(0, 10)
  // JST-EXPLICIT weekday (fix round 6), same defect and same fix as
  // screen-rows.ts: the instant is anchored to JST midnight, but `.getDay()`
  // reads it back in the BROWSER's zone, so a viewer west of Japan saw the
  // previous day's character. The registered date is a JST business fact.
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][
    partsInJst(new Date(`${isoDate}T00:00:00+09:00`)).weekday
  ]
  const initials = deriveFamilyInitials(candidate.name)

  const body = (
    <>
      <div className="hidden w-12 shrink-0 text-center md:block">
        <div className="text-xs font-semibold tabular-nums text-muted-foreground">
          {isoDate.slice(5).replace('-', '/')}
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">{weekday}</div>
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-border">
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[14px] font-medium text-foreground">
            {candidate.name}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">様</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {candidate.code}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
          {t('revealSummary')}
        </p>
      </div>
    </>
  )

  if (isNative) {
    return (
      <Link
        href={`/customers/${candidate.id}` as Parameters<typeof Link>[0]['href']}
        className="group relative flex min-h-[60px] items-center gap-3 border-b border-black/5 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted/30 active:bg-muted/50 dark:border-white/5 md:gap-4"
      >
        {body}
        <span className="shrink-0 text-[11px] text-muted-foreground">{t('noSessionYet')}</span>
      </Link>
    )
  }

  return (
    <div className="relative flex min-h-[60px] items-center gap-3 border-b border-black/5 px-4 py-2.5 last:border-b-0 dark:border-white/5 md:gap-4">
      {body}
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{t('noSessionYet')}</span>
        <button
          type="button"
          onClick={onCreateClick}
          className="inline-flex shrink-0 items-center rounded-lg border border-primary/30 bg-primary/8 px-3 py-1.5 text-[11.5px] font-bold text-primary whitespace-nowrap"
        >
          {t('revealCreate')}
        </button>
      </div>
    </div>
  )
}
