'use client'

// LIFTED FROM SPIKE (visual: verbatim)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/reservation/MobileReservationAgenda.tsx
//
// Rich row layout for the 予約 tab on mobile. Each row shows:
//   - 3px left status stripe (green = 予約済, orange = 施術中,
//     blue = 新規, grey = 完了)
//   - Time + duration in the left gutter (HH:MM big, NN分 small)
//   - Family-initial avatar (5x5) + customer name + 様 honorific
//   - 施術中: animated pulsing Radio icon next to the name (live indicator)
//   - Service line (e.g. フェイシャル・保湿強化) — hidden when title is empty
//   - 担当 + staff name with a 1.5x1.5 colored dot
//   - Status pill on the right (filled tinted bg + border, from the shared
//     BADGE_COLORS source — matches the customer-record badge style)
//   - Completed rows render at opacity-60 to fade out finished sessions
//
// Replaces the old card-style agenda (per-row tinted bg, larger avatar,
// dot-as-live-indicator) which Liam called out as too far from the spike.
//
// ANTHONY: real-time refresh (so the 施術中 pill flips automatically when
// the clock crosses a start_time) is not wired — the page is server-rendered
// and only updates on navigation/refresh. A 60s revalidate or a client-side
// `useEffect` interval would handle the live transition; out of scope for
// this UI pass.

import { useTranslations } from 'next-intl'
import { Radio } from 'lucide-react'

import type { DisplayStatus, ReservationView } from '@/lib/adapters/reservation-view'
import { getStaffColor } from '@/lib/staff/colors'
import { BADGE_COLORS } from '@/lib/badge-styles'

interface Props {
  reservations: ReservationView[]
  onSelect?: (view: ReservationView) => void
}

// Each booking status → a color from the shared BADGE_COLORS source, so these
// pills match the customer-record badges exactly. Colors (Liam, 2026-06-03):
//   予約済 booked = green · 施術中 in_session = orange · 完了 completed = slate ·
//   新規 new = blue  (新規 is blue everywhere — matches the customer record).
interface StatusVisuals {
  /** Solid color for the 3px left stripe. */
  stripe: string
  /** Filled pill: bg + text + border — the canonical badge look. */
  bg: string
  text: string
  border: string
}

const STATUS_VISUALS: Record<DisplayStatus, StatusVisuals> = {
  booked: {
    stripe: BADGE_COLORS.green.solid,
    bg: BADGE_COLORS.green.bg,
    text: BADGE_COLORS.green.text,
    border: BADGE_COLORS.green.border,
  },
  in_session: {
    stripe: BADGE_COLORS.orange.solid,
    bg: BADGE_COLORS.orange.bg,
    text: BADGE_COLORS.orange.text,
    border: BADGE_COLORS.orange.border,
  },
  completed: {
    stripe: BADGE_COLORS.slate.solid,
    bg: BADGE_COLORS.slate.bg,
    text: BADGE_COLORS.slate.text,
    border: BADGE_COLORS.slate.border,
  },
  new: {
    stripe: BADGE_COLORS.blue.solid,
    bg: BADGE_COLORS.blue.bg,
    text: BADGE_COLORS.blue.text,
    border: BADGE_COLORS.blue.border,
  },
}

export function ReservationMobileAgenda({ reservations, onSelect }: Props) {
  const t = useTranslations('reservation')
  const sorted = [...reservations].sort((a, b) =>
    a.startTimeHm.localeCompare(b.startTimeHm),
  )

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {t('mobile.empty')}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/5 dark:ring-white/5">
      <div className="divide-y divide-black/5 dark:divide-white/5">
        {sorted.map((r) => (
          <AgendaRow key={r.id} reservation={r} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function AgendaRow({
  reservation: r,
  onSelect,
}: {
  reservation: ReservationView
  onSelect?: (view: ReservationView) => void
}) {
  const t = useTranslations('reservation.card')
  const tStatus = useTranslations('reservation.status')
  const visuals = STATUS_VISUALS[r.displayStatus]
  const isLive = r.displayStatus === 'in_session'
  const isCompleted = r.displayStatus === 'completed'
  const honorific = t('customerSuffix')
  const interactive = !!onSelect
  const staffColor = getStaffColor(r.staffId) ?? 'var(--muted)'

  const content = (
    <>
      {/* Status accent stripe — absolute left edge */}
      <span
        aria-hidden
        className={`absolute bottom-3.5 left-0 top-3.5 w-[3px] rounded-r-full ${visuals.stripe}`}
      />

      {/* Time + duration column */}
      <div className="w-12 shrink-0 text-left">
        <div className="text-[17px] font-semibold leading-none tabular-nums text-foreground">
          {r.startTimeHm}
        </div>
        <div className="mt-1 text-[11px] leading-none tabular-nums text-muted-foreground">
          {t('duration', { n: r.durationMin })}
        </div>
      </div>

      {/* Main column: name, service, 担当 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-1 ring-black/5"
            style={{ background: staffColor }}
            aria-hidden
          >
            {r.customerInitials}
          </span>
          <span className="truncate text-[15px] font-medium text-foreground">
            {r.customerName}
          </span>
          {honorific && (
            <span className="text-[12px] text-muted-foreground">{honorific}</span>
          )}
          {isLive && (
            <Radio
              className="size-3 shrink-0 animate-pulse text-orange-600 dark:text-orange-400"
              aria-label="live"
            />
          )}
        </div>

        {/* Service — hidden when title is empty (no misleading "セッション"
         *  fallback). Duration is already in the left column. */}
        {r.service && (
          <div className="mt-0.5 truncate text-[13px] text-foreground/85">
            {r.service}
          </div>
        )}

        {/* 担当 line — only renders when we have a staff name to show. */}
        {r.staffName && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted-foreground">
            <span
              className="inline-block size-1.5 shrink-0 rounded-full"
              style={{ background: staffColor }}
              aria-hidden
            />
            <span className="truncate">
              {t('tantou', { name: r.staffName })}
            </span>
          </div>
        )}
      </div>

      {/* 更新案内 — action flag (amber): the customer's pack is finished, so
       *  prompt a renewal/re-sell before they leave. Distinct from the neutral
       *  status pill; can show alongside it (e.g. 予約済 + 更新案内). */}
      {r.needsRenewal && (
        <span
          className={`mr-1 inline-flex h-5 shrink-0 items-center self-center rounded-full border px-2 text-[10px] font-medium ${BADGE_COLORS.amber.bg} ${BADGE_COLORS.amber.text} ${BADGE_COLORS.amber.border}`}
        >
          {t('renewalFlag')}
        </span>
      )}

      {/* Status pill — filled tinted bg + border (canonical badge style). */}
      <span
        className={`inline-flex h-5 shrink-0 items-center self-center rounded-full border px-2 text-[10px] font-medium ${visuals.bg} ${visuals.text} ${visuals.border}`}
      >
        {tStatus(r.displayStatus)}
      </span>

    </>
  )

  const rowClass = `relative flex min-h-[72px] items-start gap-3 px-4 py-3.5 ${
    isCompleted ? 'opacity-60' : ''
  } ${interactive ? 'cursor-pointer text-left transition-colors active:bg-black/[0.02]' : ''}`

  if (interactive) {
    return (
      <button type="button" onClick={() => onSelect?.(r)} className={`${rowClass} w-full`}>
        {content}
      </button>
    )
  }
  return <div className={rowClass}>{content}</div>
}
