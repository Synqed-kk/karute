'use client'

import { useTransition } from 'react'
import {
  DayWeekMonthToggle,
  MonthGrid,
  ReservationLegend,
  ReservationPageHeader,
  WeekDayCard,
  type DayWeekMonthView,
  type MonthGridCell,
  type WeekDayCardData,
} from '@synqed-kk/ui'
import { useRouter, usePathname } from '@/i18n/navigation'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import type { OrgSettings } from '@/actions/org-settings'
import type { AppointmentRow } from '@/actions/appointments'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

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
        <ReservationLegend
          items={[
            { tone: 'booked', label: 'Booked' },
            { tone: 'in_progress', label: 'Recording' },
            { tone: 'completed', label: 'Completed' },
            { tone: 'block', label: 'Blocked' },
          ]}
        />
      </div>

      {view === 'day' ? (
        <div className="-mx-4 md:-mx-6">
          <DashboardClient
            staff={props.staff}
            activeStaffId={props.activeStaffId}
            authProfileId={props.authProfileId}
            customers={props.customers}
            locale={props.locale}
            orgSettings={props.orgSettings}
            initialAppointments={props.initialAppointments}
          />
        </div>
      ) : view === 'week' && props.weekData && props.weekStartIso ? (
        <WeekGridSection
          data={props.weekData}
          weekStartIso={props.weekStartIso}
          onPickDay={(date) => navigateTo('day', date)}
        />
      ) : view === 'month' && props.monthData ? (
        <MonthGrid
          cells={props.monthData}
          onPickDay={(date) => navigateTo('day', date)}
        />
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
