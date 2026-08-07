'use client'

// 次のお客様 hero (Liam-approved mock) — the 90-second prep that used to take
// multiple spreadsheets: who's next, how many tickets left, what they asked
// for when booking, and what happened last session (AI karute). Swipe peeks
// at the following bookings. Never empty: after the last session it flips to
// tomorrow's first customer, or a day-complete card.

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { VisitRound } from '@/lib/dashboard/flow'

export interface HeroSlideView {
  appointmentId: string
  clientId: string
  customerName: string
  startIso: string
  timeHm: string
  durationMinutes: number
  inProgress: boolean
  round: VisitRound
  /** Booking title (course), e.g. 10回券 / 新規コース ¥1,980. */
  course: string | null
  staffName: string
  ticket: { remaining: number; size: number } | null
  requestNote: string | null
  lastVisit: { text: string; dateLabel: string; href: string } | null
}

export interface TomorrowFirstView {
  dateLabel: string
  timeHm: string
  customerName: string
  count: number
}

interface NextCustomerHeroProps {
  slides: HeroSlideView[]
  tomorrow: TomorrowFirstView | null
  /** Completed sessions today — the day-complete card's headline. */
  doneCount: number
}

/** Minutes until start, re-evaluated every 30s — flips to 施術中 live once
 *  the start time passes (not frozen at the server-render's clock). Rendered
 *  client-side only to keep server HTML deterministic (no hydration
 *  mismatch). */
function Countdown({ startIso }: { startIso: string }) {
  const t = useTranslations('dashboard.flow')
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => {
      const diffMs = new Date(startIso).getTime() - Date.now()
      if (diffMs <= 0) {
        setLabel(t('inSession'))
        // Terminal state — stop ticking instead of re-setting the same
        // string every 30s for the life of the component.
        clearInterval(id)
        return
      }
      const mins = Math.round(diffMs / 60_000)
      setLabel(
        mins >= 60
          ? t('hoursMinsLeft', { h: Math.floor(mins / 60), m: mins % 60 })
          : t('minsLeft', { n: mins }),
      )
    }
    const id = setInterval(tick, 30_000)
    tick()
    return () => clearInterval(id)
  }, [startIso, t])
  if (!label) return null
  // Neutral on purpose (案A, Liam 8/6): the countdown is state, not an
  // action — it reads in the same ink as the time it annotates.
  return <span>{label}</span>
}

function RoundTag({ round }: { round: VisitRound }) {
  const t = useTranslations('dashboard.flow')
  if (round.kind === 'first') {
    return (
      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
        {t('firstVisit')}
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
      {round.kind === 'nth' ? t('nthVisit', { n: round.n }) : t('repeat')}
    </span>
  )
}

function Slide({ slide }: { slide: HeroSlideView }) {
  const t = useTranslations('dashboard.flow')
  return (
    <div className="w-full shrink-0 snap-center px-0.5">
      {/* Neutral frame + label (案A, Liam 8/6): blue is reserved for the
       *  pressable links below — state and decoration stay achromatic. */}
      <div className="rounded-2xl border-2 border-border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground">{t('nextCustomer')}</span>
          <span className="text-sm font-medium tabular-nums">
            {slide.timeHm} · <Countdown startIso={slide.startIso} />
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          {slide.ticket && (
            <div
              className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full ${
                slide.ticket.remaining <= 1
                  ? 'bg-amber-50 dark:bg-amber-500/10'
                  : 'bg-emerald-50 dark:bg-emerald-500/10'
              }`}
            >
              <span
                className={`text-[15px] font-semibold leading-none ${
                  slide.ticket.remaining <= 1
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {slide.ticket.remaining}
              </span>
              <span
                className={`text-[8px] ${
                  slide.ticket.remaining <= 1
                    ? 'text-amber-700/70 dark:text-amber-300/70'
                    : 'text-emerald-700/70 dark:text-emerald-300/70'
                }`}
              >
                {t('remainingOf', { m: slide.ticket.size })}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/customers/${slide.clientId}`}
                className="truncate text-xl font-semibold hover:underline"
              >
                {t('customerHonorific', { name: slide.customerName })}
              </Link>
              <RoundTag round={slide.round} />
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {[slide.course, t('durationMin', { n: slide.durationMinutes }), slide.staffName]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
        {slide.requestNote && (
          <p className="mt-2.5 rounded-lg bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">{t('requestLabel')}</span>
            {slide.requestNote}
          </p>
        )}
        {slide.lastVisit && (
          <Link
            href={slide.lastVisit.href}
            className="mt-1.5 block rounded-lg bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground hover:bg-muted"
          >
            <span className="font-medium text-primary">
              {t('lastVisitLabel', { date: slide.lastVisit.dateLabel })}
            </span>
            <span className="line-clamp-2">{slide.lastVisit.text}</span>
          </Link>
        )}
        <div className="mt-2.5 flex items-center justify-between">
          <Link
            href={`/customers/${slide.clientId}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t('openKarute')}
          </Link>
        </div>
      </div>
    </div>
  )
}

export function NextCustomerHero({ slides, tomorrow, doneCount }: NextCustomerHeroProps) {
  const t = useTranslations('dashboard.flow')
  const scroller = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  if (slides.length === 0) {
    return (
      <section className="rounded-2xl border-2 border-border bg-card p-4">
        {tomorrow ? (
          <>
            <span className="text-[11px] font-semibold text-muted-foreground">{t('tomorrowFirst')}</span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-xl font-semibold">
                {t('customerHonorific', { name: tomorrow.customerName })}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {tomorrow.dateLabel} {tomorrow.timeHm}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('tomorrowCount', { n: tomorrow.count })}
            </p>
          </>
        ) : (
          <>
            <span className="text-[11px] font-semibold text-muted-foreground">{t('dayDoneTitle')}</span>
            <p className="mt-1.5 text-xl font-semibold">{t('dayDone', { n: doneCount })}</p>
          </>
        )}
      </section>
    )
  }

  return (
    <section aria-label={t('nextCustomer')}>
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth))
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
      >
        {slides.map((s) => (
          <Slide key={s.appointmentId} slide={s} />
        ))}
      </div>
      {slides.length > 1 && (
        <div className="mt-1.5 flex items-center justify-center gap-1.5">
          {slides.map((s, i) => (
            <span
              key={s.appointmentId}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-4 bg-foreground/50' : 'w-1.5 bg-muted-foreground/30'
              }`}
            />
          ))}
          <span className="ml-1 text-[10px] text-muted-foreground">{t('swipeHint')}</span>
        </div>
      )}
    </section>
  )
}
