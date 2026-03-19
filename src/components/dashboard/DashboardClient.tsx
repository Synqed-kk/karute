'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { TimetableWithTabs } from '@/components/calendar/prototype-calendar-view'
import { AppointmentPopout } from '@/components/dashboard/AppointmentPopout'
import { useTimetableStore } from '@/stores/timetable-store'
import { getBarsByDate } from '@/actions/dashboard'
import { getAppointmentsByDate, type AppointmentRow } from '@/actions/appointments'
import type { OrgSettings } from '@/actions/org-settings'
import type { TimelineBarItem } from '@/components/calendar/prototype-calendar-view'
import type { TimelineBar } from '@/stores/timetable-store'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import { getOperatingHoursForDate } from '@/lib/operating-hours'

interface StaffItem {
  id: string
  name: string
  avatarInitials: string
}

interface DashboardClientProps {
  staff: StaffItem[]
  activeStaffId: string | null
  authProfileId: string | null
  customers: CustomerOption[]
  locale: string
  orgSettings: OrgSettings | null
}

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const minute = now.getHours() * 60 + now.getMinutes()
  const label = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return { minute, label, date: now }
}

function formatDate(date: Date, locale: string) {
  return date.toLocaleDateString(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

interface SlotClickState {
  rowId: string
  startMinute: number
  clickX: number
  clickY: number
}

export function DashboardClient({ staff, activeStaffId, authProfileId, customers, locale, orgSettings }: DashboardClientProps) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const { minute: currentMinute, label: currentTimeLabel } = useCurrentTime()

  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [slotClick, setSlotClick] = useState<SlotClickState | null>(null)
  const lastClickRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // In-progress recording bars from zustand (temp rec_* bars)
  const liveBars = useTimetableStore((s) => s.bars)
  const setBars = useTimetableStore((s) => s.setBars)

  // Saved bars (karute records + appointments) fetched from DB by date
  const [savedBars, setSavedBars] = useState<TimelineBar[]>([])
  const [rawAppointments, setRawAppointments] = useState<AppointmentRow[]>([])

  const isToday = useMemo(() => {
    const now = new Date()
    return (
      selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate()
    )
  }, [selectedDate])

  // Fetch saved bars + appointments when date changes
  const refreshBars = useCallback(() => {
    const dateStr = toLocalDateStr(selectedDate)
    const tzOffset = new Date().getTimezoneOffset()

    Promise.all([
      getBarsByDate(dateStr, tzOffset),
      getAppointmentsByDate(dateStr, tzOffset),
    ]).then(([karuteBars, appointments]) => {
      const karute: TimelineBar[] = karuteBars.map((b) => ({
        id: b.id,
        rowId: b.staffId,
        startMinute: b.startMinute,
        durationMinute: b.durationMinute,
        title: b.title,
        subtitle: b.subtitle,
        type: 'booking' as const,
      }))

      // Appointments that don't have a linked karute yet show as 'open' type
      // Appointments with linked karute are already covered by karuteBars
      const karuteIds = new Set(karuteBars.map((b) => b.id))
      const appt: TimelineBar[] = appointments
        .filter((a) => !a.karute_record_id || !karuteIds.has(a.karute_record_id))
        .map((a) => {
          const startAt = new Date(a.start_time)
          const startMin = startAt.getHours() * 60 + startAt.getMinutes()
          const customerName = a.customers?.name ?? ''
          const h1 = Math.floor(startMin / 60)
          const m1 = startMin % 60
          const endMin = startMin + a.duration_minutes
          const h2 = Math.floor(endMin / 60)
          const m2 = endMin % 60
          const title = `${h1}:${String(m1).padStart(2, '0')}-${h2}:${String(m2).padStart(2, '0')}`
          return {
            id: `appt_${a.id}`,
            rowId: a.staff_profile_id,
            startMinute: startMin,
            durationMinute: a.duration_minutes,
            title,
            subtitle: customerName,
            type: 'open' as const,
          }
        })

      setSavedBars([...karute, ...appt])
      setRawAppointments(appointments)
    })
  }, [selectedDate])

  useEffect(() => {
    refreshBars()
  }, [refreshBars])

  // Merge saved bars with live recording bars (only show live bars on today)
  const bars = useMemo(() => {
    const savedIds = new Set(savedBars.map((b) => b.id))
    const activeLiveBars = isToday
      ? liveBars.filter((b) => !savedIds.has(b.id))
      : []
    return [...savedBars, ...activeLiveBars]
  }, [savedBars, liveBars, isToday])

  const handlePrevDay = () => {
    setSelectedDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() - 1)
      return next
    })
    setSlotClick(null)
  }

  const handleNextDay = () => {
    setSelectedDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      return next
    })
    setSlotClick(null)
  }

  const handleToday = () => {
    setSelectedDate(new Date())
    setSlotClick(null)
  }

  const handleBarClick = useCallback(
    (bar: TimelineBarItem) => {
      if (bar.type === 'booking' && !bar.id.startsWith('rec_')) {
        router.push(`/karute/${bar.id}` as Parameters<typeof router.push>[0])
      }
    },
    [router]
  )

  // Capture mouse position for popout placement
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      lastClickRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [])

  const handleTimeSlotClick = useCallback(
    (payload: { rowId: string; startMinute: number }) => {
      if (activeStaffId && payload.rowId !== activeStaffId) return
      setSlotClick({
        ...payload,
        clickX: lastClickRef.current.x,
        clickY: lastClickRef.current.y,
      })
    },
    [activeStaffId]
  )

  const handleAppointmentCreated = () => {
    setSlotClick(null)
    refreshBars()
  }

  const timetableStaff = useMemo(
    () => staff.map((s) => ({ id: s.id, name: s.name, avatarInitials: s.avatarInitials })),
    [staff]
  )

  const tabs = useMemo(() => [] as { id: string; label: string }[], [])

  const slotClickStaff = slotClick ? staff.find((s) => s.id === slotClick.rowId) : null
  const selectedDayHours = useMemo(
    () => getOperatingHoursForDate(orgSettings?.operating_hours, selectedDate),
    [orgSettings?.operating_hours, selectedDate]
  )


  return (
    <>
      {/* Timetable header: Appointments left, date picker center */}
      <div className="relative flex items-center rounded-t-[22px] bg-[#7d9ea7]/88 px-5 py-2.5">
        <span className="text-sm font-semibold text-white/90">{t('title')}</span>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <button type="button" onClick={handlePrevDay} className="rounded-md px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors">&larr;</button>
          <span className="text-sm font-medium text-white">{formatDate(selectedDate, 'en')}</span>
          <button type="button" onClick={handleNextDay} className="rounded-md px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors">&rarr;</button>
          {!isToday && (
            <button type="button" onClick={handleToday} className="rounded-md bg-white/20 px-2 py-1 text-xs font-medium text-white hover:bg-white/30 transition-colors">{t('today')}</button>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1" style={{ minHeight: `${staff.length * 84 + 100}px` }}>
        <TimetableWithTabs
          tabs={tabs}
          activeTabId="dashboard"
          staff={timetableStaff}
          bars={bars}
          onBarsChange={setBars}
          onBarClick={handleBarClick}
          onTimeSlotClick={handleTimeSlotClick}
          startMinute={selectedDayHours.openMinute}
          endMinute={selectedDayHours.closeMinute}
          currentTimeLabel={isToday ? currentTimeLabel : ''}
          currentMinute={isToday ? currentMinute : 0}
          activeRowId={authProfileId ?? activeStaffId ?? undefined}
        />

        {/* Click-outside overlay for appointment popout */}
        {slotClick && slotClickStaff && (
          <div className="fixed inset-0 z-[55]" onClick={() => setSlotClick(null)} />
        )}
        {/* Appointment creation popout — always centered in viewport */}
        {slotClick && slotClickStaff && (
          <div
            className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <AppointmentPopout
              staffId={slotClick.rowId}
              staffName={slotClickStaff.name}
              startMinute={slotClick.startMinute}
              selectedDate={selectedDate}
              operatingHours={selectedDayHours}
              customers={customers}
              onCreated={handleAppointmentCreated}
              onClose={() => setSlotClick(null)}
            />
          </div>
        )}
      </div>

    </>
  )
}
