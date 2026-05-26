'use client'

import { ArrowRight, Clock, MessageCircle } from 'lucide-react'
import { Link } from '@/i18n/navigation'

// Narrowed from the 5-member spike union — dashboard/page.tsx only
// ever assigns 'booked' or 'completed'. The other three styles
// ('in-session' / 'pending' / 'new') had no producer, so the pill
// styles never rendered. Same class of bug as the レビュー要 filter
// chip from PR #63. ANTHONY: when in-session tracking + provisional
// booking states are wired (probably alongside the reservation
// agenda's display_status work), restore the union + STATUS_STYLES
// entries.
export type AppointmentStatusKey = 'booked' | 'completed'

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
  reservationMemo?: string | null
}

const STATUS_STYLES: Record<AppointmentStatusKey, { bg: string; text: string; border: string }> = {
  booked: { bg: 'bg-sky-500/15', text: 'text-sky-300', border: 'border-sky-500/30' },
  completed: { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' },
}

export function TodaysAppointmentsCard({
  appointments,
}: {
  appointments: DashboardAppointment[]
}) {
  const completed = appointments.filter((a) => a.statusKey === 'completed').length

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            Today&apos;s appointments
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {completed} / {appointments.length}
          </span>
        </div>
        <Link
          href={'/appointments' as Parameters<typeof Link>[0]['href']}
          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300"
        >
          <span>Show all</span>
          <ArrowRight size={12} />
        </Link>
      </div>

      {appointments.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          No appointments today.
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
          {a.duration}m
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
          {/* "New" badge removed — `isNew` field was never set by
           *  the dashboard page producer, so the badge never showed.
           *  Same class of bug as レビュー要. ANTHONY: when first-
           *  visit detection lands (probably via a customers join +
           *  visitCount === 0 check), restore as a real DashboardAppointment
           *  field + this conditional. */}
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
