'use client'

// 来店ペース (Plan P1) — the customer-page visit cadence as its OWN card, between
// the identity card and 回数券. Leads with the FACTS the staff close on: how
// often (平均間隔, with its inputs shown as proof), when (前回, date + N日前), and —
// when the customer holds a pack — the REAL 残りN回 from the ledger, so the
// closing thought is whole in one glance. A まだ/そろそろ/空きすぎ verdict + a
// labeled rhythm bar sit up top. The bottom line is a FACT, not floating advice:
// a pack-holder sees 残りN回・約N週分 (the span the pack covers at their pace,
// gated on a solid cadence + a single pack); a returning customer with cadence
// but no pack gets the suggest-a-pack tactic; otherwise 同期待ち. Every value is a
// date/count/span — factual business cadence, no 薬機法/景表法 surface.

import { useTranslations } from 'next-intl'
import { Activity, RefreshCw, Ticket } from 'lucide-react'
import { type VisitPace, type RhythmState } from '@/lib/visits/pace'
import { visitTacticKey } from '@/lib/visits/segment'

interface VisitPaceCardProps {
  pace: VisitPace
  /** Compact last-visit date, e.g. "4/29(火)" — already locale-formatted. */
  lastVisitDateShort: string | null
  lastVisitService: string | null
  hasTicketPack: boolean
}

const VERDICT_LABEL: Record<RhythmState, 'verdictMada' | 'verdictSoro' | 'verdictOver'> = {
  'on-rhythm': 'verdictMada',
  'slightly-over': 'verdictSoro',
  over: 'verdictOver',
}

const INTERVAL_PCT = 100 / 2.5 // usual-interval tick sits at 40% of the track

export function VisitPaceCard({
  pace,
  lastVisitDateShort,
  lastVisitService,
  hasTicketPack,
}: VisitPaceCardProps) {
  const t = useTranslations('visits.pace')
  const tTactic = useTranslations('visits.tactic')

  const over = pace.state != null && pace.state !== 'on-rhythm'

  const intervalLabel =
    pace.avgIntervalDays == null
      ? '—'
      : pace.avgIntervalDays >= 21
        ? t('aboutWeeks', { n: Math.round(pace.avgIntervalDays / 7) })
        : t('aboutDays', { n: pace.avgIntervalDays })

  const lastVisitValue =
    pace.lastVisitAgoDays != null ? t('daysAgoValue', { n: pace.lastVisitAgoDays }) : '—'

  // The pace card is CADENCE ONLY — no ticket facts (those live, once, in the
  // 回数券 card). The bottom line is the suggest-a-pack tactic for a returning
  // customer WITHOUT a pack (the ticket card has nothing to say for them); a
  // pack-holder gets nothing here — their 残り + span live in the 回数券 card.
  let bottom: React.ReactNode = null
  if (!hasTicketPack && pace.hasDates && pace.segment) {
    bottom = (
      <div className="mt-2.5 flex items-start gap-2 text-[12px] text-muted-foreground">
        <Ticket size={13} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
        <p>{tTactic(visitTacticKey(pace.segment, hasTicketPack))}</p>
      </div>
    )
  } else if (pace.pending) {
    bottom = (
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
        <RefreshCw size={11} aria-hidden />
        {t('syncing')}
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Activity size={14} aria-hidden />
          {t('title')}
        </span>
        {pace.hasDates && pace.state && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              over
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {t(VERDICT_LABEL[pace.state])}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {pace.hasDates ? (
          <Cell
            label={t('avgInterval')}
            value={intervalLabel}
            caption={t('inputs', { visits: pace.totalVisits, months: pace.spanMonths ?? 0 })}
          />
        ) : (
          <Cell label={t('total')} value={`${pace.totalVisits}`} caption={t('existingCustomer')} />
        )}
        <Cell
          label={t('lastVisit')}
          value={lastVisitValue}
          valueClass={over ? 'text-amber-600 dark:text-amber-400' : undefined}
          caption={
            lastVisitDateShort
              ? lastVisitService
                ? `${lastVisitDateShort}・${lastVisitService}`
                : lastVisitDateShort
              : t('noVisitDate')
          }
        />
      </div>

      {pace.hasDates && pace.ratio != null && (
        <div className="relative mb-0.5 mt-2.5 h-1.5 rounded-full bg-muted">
          <span
            className="absolute top-0 h-1.5 w-0.5 bg-border"
            style={{ left: `${INTERVAL_PCT}%` }}
            aria-hidden
          />
          <span
            className={`absolute left-0 top-0 h-1.5 rounded-full ${
              over ? 'bg-amber-400 dark:bg-amber-500/70' : 'bg-green-400 dark:bg-green-500/60'
            }`}
            style={{ width: `${Math.min((pace.ratio / 2.5) * 100, 98)}%` }}
            aria-hidden
          />
        </div>
      )}

      {bottom}
    </section>
  )
}

function Cell({
  label,
  value,
  valueClass,
  caption,
}: {
  label: string
  value: string
  valueClass?: string
  caption: string
}) {
  return (
    <div className="rounded-xl bg-muted/60 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={`text-[19px] font-semibold leading-tight tabular-nums ${valueClass ?? 'text-foreground'}`}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">{caption}</div>
    </div>
  )
}
