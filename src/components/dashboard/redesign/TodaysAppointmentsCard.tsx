'use client'

import { ArrowRight, Clock, MessageCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

// Full 5-state union preserved from the spike. dashboard/page.tsx
// only assigns 'booked' or 'completed' today (the other three need
// producers — see ANTHONY notes below) but the union + STATUS_STYLES
// stay as the spec so the schema/producer work is obvious. Each
// missing producer:
//   - 'in-session': active-now tracking from reservation agenda
//     display_status logic (already exists in reservation-view.ts)
//   - 'pending':    booking-confirmation state when bookings come
//     from a public channel (LINE / web form) and need owner approval
//   - 'new':        first-visit detection — customer.visitCount === 0
//     at booking time
export type AppointmentStatusKey =
  | 'booked'
  | 'in-session'
  | 'completed'
  | 'pending'
  | 'new'

export interface DashboardAppointment {
  id: string
  time: string // "HH:MM"
  duration: number // minutes
  customerName: string
  karuteNumber: string | null
  service: string
  staffName: string
  staffColor: string | null // hex
  statusKey: AppointmentStatusKey
  statusLabel: string
  /** First-visit badge — ANTHONY: producer set when customer
   *  visitCount === 0 at booking time. */
  isNew?: boolean
  reservationMemo?: string | null
}

const STATUS_STYLES: Record<AppointmentStatusKey, { bg: string; text: string; border: string }> = {
  booked: { bg: 'bg-sky-500/15', text: 'text-sky-300', border: 'border-sky-500/30' },
  'in-session': { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/30' },
  completed: { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' },
  pending: { bg: 'bg-orange-500/15', text: 'text-orange-300', border: 'border-orange-500/30' },
  new: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30' },
}

export function TodaysAppointmentsCard({
  appointments,
}: {
  appointments: DashboardAppointment[]
}) {
  const t = useTranslations('dashboard')
  const completed = appointments.filter((a) => a.statusKey === 'completed').length

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            {t('todaysAppointments')}
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {completed} / {appointments.length}
          </span>
        </div>
        <Link
          href={'/appointments' as Parameters<typeof Link>[0]['href']}
          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300"
        >
          <span>{t('viewAll')}</span>
          <ArrowRight size={12} />
        </Link>
      </div>

      {appointments.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          {t('noAppointmentsToday')}
        </p>
      ) : (
        <div className="flex flex-col">
          {appointments.map((a) => (
            <AppointmentRow key={a.id} a={a} />
          ))}
        </div>
      )}
    </section>
  )
}

function AppointmentRow({ a }: { a: DashboardAppointment }) {
  const t = useTranslations('dashboard')
  const done = a.statusKey === 'completed'
  const status = STATUS_STYLES[a.statusKey]
  return (
    <div
      className={`flex items-start gap-3 border-b border-border py-3 last:border-b-0 ${
        done ? 'opacity-60' : ''
      }`}
    >
      <div className="w-14 shrink-0">
        <div className="text-sm font-semibold tabular-nums text-foreground">
          {a.time}
        </div>
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {t('minutesShort', { n: a.duration })}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">
            {a.customerName}
          </span>
          {a.karuteNumber && (
            <span className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
              #{a.karuteNumber}
            </span>
          )}
          {a.isNew && (
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
              {t('newBadge')}
            </span>
          )}
          <span
            className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} ${status.border}`}
          >
            {a.statusLabel}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">{a.service}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {a.staffColor && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: a.staffColor }}
            />
          )}
          <span>{a.staffName}</span>
        </div>
        {a.reservationMemo && (
          <div className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <MessageCircle size={11} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{a.reservationMemo}</span>
          </div>
        )}
      </div>
    </div>
  )
}
