'use client'

import { useTransition } from 'react'
import {
  DayWeekMonthToggle,
  MonthGrid,
  ReservationPageHeader,
  WeekDayCard,
  type DayWeekMonthView,
  type MonthGridCell,
  type WeekDayCardData,
} from '@synqed-kk/ui'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import { MobileReservationAgenda } from '@/components/reservation/MobileReservationAgenda'
import { ReservationTotals } from '@/components/reservation/ReservationTotals'
import type { OrgSettings } from '@/actions/org-settings'
import type { AppointmentRow } from '@/actions/appointments'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import type { ReservationStaff } from '@/components/reservation/StaffRow'
import type { BusinessHours } from '@/components/reservation/TimeAxis'

interface AppointmentsViewProps {
  staff: {
    id: string
    name: string
    avatarInitials: string
    avatarUrl?: string
  }[]
  activeStaffId: string | null
  authProfileId: string | null
  customers: CustomerOption[]
  locale: string
  orgSettings: OrgSettings | null
  initialAppointments?: AppointmentRow[]
  initialView: DayWeekMonthView
  selectedDateIso: string
  weekData: WeekDayCardData[] | null
  weekStartIso: string | null
  monthData: MonthGridCell[] | null
  monthStartIso: string | null
  reservationViews: ReservationView[]
  reservationStaff: ReservationStaff[]
  businessHours: BusinessHours
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCompactDate(d: Date): string {
  const m = d.getMonth() + 1
  const day = d.getDate()
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  return `${m}/${day} (${wd})`
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function AppointmentsView(props: AppointmentsViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  const view = props.initialView
  const selectedDate = new Date(props.selectedDateIso)
  const today = new Date()
  const tReservation = useTranslations('reservation')

  function navigateTo(nextView: DayWeekMonthView, nextDate: Date) {
    const search = new URLSearchParams()
    search.set('view', nextView)
    search.set('date', formatYmd(nextDate))
    startTransition(() => {
      router.push(
        `${pathname}?${search.toString()}` as Parameters<typeof router.push>[0],
      )
    })
  }

  const headerDate =
    view === 'day'
      ? today
      : selectedDate

  return (
    <div className="space-y-3 p-4 md:p-6">
      <ReservationPageHeader
        dateDisplay={formatLongDate(headerDate)}
        dateDisplayCompact={formatCompactDate(headerDate)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <DayWeekMonthToggle
          view={view}
          onChange={(v) => navigateTo(v, selectedDate)}
        />
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">{tReservation('legend.label')}</span>
          {(['booked', 'in_session', 'completed', 'new', 'pending'] as const).map((tone) => (
            <span key={tone} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{
                  background: `var(--reservation-${tone.replace('_', '-')}-bg)`,
                  border: `1px ${tone === 'pending' || tone === 'new' ? 'dashed' : 'solid'} var(--reservation-${tone.replace('_', '-')}-border)`,
                }}
              />
              {tReservation(`status.${tone}`)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="reservation-block-pattern inline-block h-2.5 w-4 rounded-sm border border-border" />
            {tReservation('legend.block')}
          </span>
        </div>
      </div>

      {view === 'day' ? (
        <>
          <div className="hidden md:block">
            <ReservationGrid
              staff={props.reservationStaff}
              reservations={props.reservationViews}
              businessHours={props.businessHours}
            />
          </div>
          <div className="md:hidden">
            <MobileReservationAgenda reservations={props.reservationViews} />
          </div>
          <ReservationTotals reservations={props.reservationViews} />
        </>
      ) : view === 'week' && props.weekData && props.weekStartIso ? (
        <WeekGridSection
          data={props.weekData}
          weekStartIso={props.weekStartIso}
          onPickDay={(date) => navigateTo('day', date)}
        />
      ) : view === 'month' && props.monthData ? (
        <div className="md:h-[calc(100vh-260px)]">
          <MonthGrid
            cells={props.monthData}
            onPickDay={(date) => navigateTo('day', date)}
            className="h-full"
          />
        </div>
      ) : (
        <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-card)] p-8 text-center text-sm text-[var(--color-text-muted)] ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          No data.
        </div>
      )}
    </div>
  )
}

function WeekGridSection({
  data,
  weekStartIso,
  onPickDay,
}: {
  data: WeekDayCardData[]
  weekStartIso: string
  onPickDay: (date: Date) => void
}) {
  const weekStart = new Date(weekStartIso)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
      {data.map((day, i) => {
        const date = new Date(weekStart)
        date.setDate(date.getDate() + i)
        return (
          <WeekDayCard
            key={i}
            data={day}
            onPick={() => onPickDay(date)}
          />
        )
      })}
    </div>
  )
}
