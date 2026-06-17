'use client'

// The 来店リズム panel (Plan B) — used on the customer profile + pre-session
// brief, the surfaces where staff study a customer before a deliberate call.
// Renders the days-since figure against the customer's usual interval and a bar
// whose drift-to-amber IS the 離脱気味 signal. A hard 目安 marker flags that the
// interval is a SMOOTHED estimate, not a measured per-visit cadence (the detail
// table is empty today). Returns null when there's no honest rhythm to plot
// (computeVisitRhythm gave null) — never a fabricated bar.

import { useTranslations } from 'next-intl'
import type { VisitRhythm, VisitSegment } from '@/lib/visits/segment'
import { SegmentChip } from './SegmentChip'
import { RHYTHM_FILL_CLASS } from './tone'

interface VisitRhythmPanelProps {
  rhythm: VisitRhythm | null
  segment: VisitSegment | null
}

// One usual-interval occupies this fraction of the track, leaving room to show
// drift out to the clamped 2.5× without the marker running off the end.
const INTERVAL_PCT = 100 / 2.5 // = 40%

export function VisitRhythmPanel({ rhythm, segment }: VisitRhythmPanelProps) {
  const t = useTranslations('visits.rhythm')
  if (!rhythm) return null

  const over = rhythm.state !== 'on-rhythm'
  const overdueDays = Math.max(0, rhythm.daysSince - rhythm.avgIntervalDays)
  const todayPct = Math.min((rhythm.ratio / 2.5) * 100, 98)

  return (
    <div className="bg-muted/50 px-4 py-3.5 md:px-6">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('title')}
      </div>

      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground/70">
            {t('sinceLabel')}
          </div>
          <div className="tabular-nums">
            <span className={`text-[34px] font-semibold leading-none ${over ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
              {rhythm.daysSince}
            </span>
            <span className="text-sm text-muted-foreground"> {t('daysUnit')}</span>
          </div>
        </div>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
          {t('usual', { n: rhythm.avgIntervalDays })}
        </span>
      </div>

      {/* Rhythm bar — sage while on-rhythm, amber once today drifts past the
          usual-interval tick. 目安 anchors the right end as an estimate flag. */}
      <div className="relative mb-1 mt-3 h-2 rounded-full border border-border bg-card">
        <span
          className="absolute top-0 h-2 w-0.5 bg-border"
          style={{ left: `${INTERVAL_PCT}%` }}
          aria-hidden
        />
        <span
          className={`absolute left-0 top-0.5 h-1 rounded-full ${over ? RHYTHM_FILL_CLASS.over : RHYTHM_FILL_CLASS.onRhythm}`}
          style={{ width: `${todayPct}%` }}
          aria-hidden
        />
        <span
          className={`absolute top-[-3px] h-[11px] w-[11px] -translate-x-1/2 rounded-full border-2 border-card ${over ? 'bg-amber-500' : 'bg-green-500'}`}
          style={{ left: `${todayPct}%` }}
          aria-hidden
        />
        <span className="absolute right-0 top-3 text-[9px] italic text-muted-foreground/70">
          {t('estimate')}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SegmentChip segment={segment} size="sm" />
        <span className="text-[11px] text-muted-foreground">
          {over ? t('longerBy', { n: overdueDays }) : t('onRhythm')}
        </span>
      </div>
    </div>
  )
}
