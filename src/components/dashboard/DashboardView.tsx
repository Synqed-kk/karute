'use client'

import { useMemo, useState } from 'react'
import {
  AppointmentRow,
  DashboardHeader,
  DashboardStatStrip,
  RecentKaruteList,
  TodaysAppointments,
  type DashboardStatCardData,
  type RecentKaruteItem,
} from '@synqed-kk/ui'
import { Link } from '@/i18n/navigation'
import {
  appointmentsToRowData,
  karuteToRecentItems,
  type DashboardAppointmentInput,
  type DashboardKaruteInput,
} from '@/lib/adapters/dashboard'

interface DashboardViewProps {
  staffName: string
  activeStaffId: string | null
  stats: DashboardStatCardData[]
  todayAppointments: DashboardAppointmentInput[]
  recentKarute: DashboardKaruteInput[]
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function DashboardView({
  staffName,
  activeStaffId,
  stats,
  todayAppointments,
  recentKarute,
}: DashboardViewProps) {
  const [showAll, setShowAll] = useState(false)

  // Filter to appointments that fall on the user's local date
  const localToday = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
  const todayOnly = useMemo(
    () =>
      todayAppointments.filter(
        (a) => new Date(a.startTime).toLocaleDateString('en-CA') === localToday,
      ),
    [todayAppointments, localToday],
  )

  const filteredAppointments = useMemo(() => {
    if (showAll || !activeStaffId) return todayOnly
    return todayOnly.filter((a) => a.staffId === activeStaffId)
  }, [todayOnly, activeStaffId, showAll])

  const filteredKarute = useMemo(() => {
    if (showAll || !activeStaffId) return recentKarute.slice(0, 5)
    return recentKarute.filter((r) => r.staffId === activeStaffId).slice(0, 5)
  }, [recentKarute, activeStaffId, showAll])

  const apptRows = useMemo(
    () => appointmentsToRowData(filteredAppointments),
    [filteredAppointments],
  )
  const recentItems: RecentKaruteItem[] = useMemo(
    () => karuteToRecentItems(filteredKarute),
    [filteredKarute],
  )

  const greeting = `Good day, ${staffName}`
  const dateFormatted = formatLongDate(new Date())

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <DashboardHeader greeting={greeting} dateFormatted={dateFormatted} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-text)]"
        >
          {showAll ? 'My view' : 'All staff'}
        </button>
      </div>

      <DashboardStatStrip stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TodaysAppointments
          total={apptRows.length}
          completed={0}
          showAllSlot={(children) => (
            <Link
              href={'/appointments' as Parameters<typeof Link>[0]['href']}
            >
              {children}
            </Link>
          )}
        >
          {apptRows.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[var(--color-text-muted)]">
              No appointments today.
            </p>
          ) : (
            apptRows.map((row) => (
              <AppointmentRow key={row.id} appointment={row} />
            ))
          )}
        </TodaysAppointments>

        <RecentKaruteList
          items={recentItems}
          showAllSlot={(children) => (
            <Link href={'/karute' as Parameters<typeof Link>[0]['href']}>
              {children}
            </Link>
          )}
          asItemLink={(item, children) => (
            <Link
              href={`/karute/${item.id}` as Parameters<typeof Link>[0]['href']}
              className="block"
            >
              {children}
            </Link>
          )}
        />
      </div>
    </div>
  )
}
