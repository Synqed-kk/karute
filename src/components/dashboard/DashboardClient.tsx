'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { TimetableWithTabs } from '@/components/calendar/prototype-calendar-view'
import { AppointmentPopout } from '@/components/dashboard/AppointmentPopout'
import { useTimetableStore } from '@/stores/timetable-store'
import { getAppointmentsByDate, updateAppointment, deleteAppointment, type AppointmentRow } from '@/actions/appointments'
import { deleteKaruteRecord } from '@/actions/karute'
import { toast } from 'sonner'
import type { OrgSettings } from '@/actions/org-settings'
import type { TimelineBarItem } from '@/components/calendar/prototype-calendar-view'
import type { TimelineBar } from '@/stores/timetable-store'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import { getOperatingHoursForDate } from '@/lib/operating-hours'

interface StaffItem {
  id: string
  name: string
  avatarInitials: string
  avatarUrl?: string
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

    getAppointmentsByDate(dateStr, tzOffset).then((appointments) => {
      // Only show appointment bars on the timetable (no standalone karute bars)
      // - Linked to karute → 'completed' type (green, has View Karute + Delete)
      // - Not linked → 'open' type (blue-gray, has Delete)
      const appt: TimelineBar[] = appointments.map((a) => {
          const startAt = new Date(a.start_time)
          // Always display in business timezone (JST) regardless of viewer's locale
          const jstOffset = 9 * 60 // JST = UTC+9
          const utcMin = startAt.getUTCHours() * 60 + startAt.getUTCMinutes()
          const startMin = (utcMin + jstOffset) % 1440
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
            type: (a.karute_record_id ? 'completed' : 'open') as 'completed' | 'open',
          }
        })

      setSavedBars(appt)
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

  // Capture mouse position for popout placement
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      lastClickRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [])

  const isPastDay = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
    return selected < today
  }, [selectedDate])

  const handleTimeSlotClick = useCallback(
    (payload: { rowId: string; startMinute: number }) => {
      if (activeStaffId && payload.rowId !== activeStaffId) return
      // Block past time slots
      if (isPastDay) return
      // Only block if the entire slot is in the past (slot end <= current time)
      if (isToday && payload.startMinute + 30 <= currentMinute) return
      setSlotClick({
        ...payload,
        clickX: lastClickRef.current.x,
        clickY: lastClickRef.current.y,
      })
    },
    [activeStaffId, isPastDay, isToday, currentMinute]
  )

  const handleAppointmentCreated = () => {
    setSlotClick(null)
    refreshBars()
  }

  // Drag and drop — update appointment time/staff in DB
  const handleBarDragEnd = useCallback(
    async (payload: { bar: TimelineBarItem; previousRowId: string; previousStartMinute: number }) => {
      const { bar } = payload
      // Only handle appointment bars (appt_*) and saved karute bars
      const isAppt = bar.id.startsWith('appt_')
      if (!isAppt) return

      const appointmentId = bar.id.replace('appt_', '')
      const newDate = new Date(selectedDate)
      newDate.setHours(Math.floor(bar.startMinute / 60), bar.startMinute % 60, 0, 0)

      const result = await updateAppointment(appointmentId, {
        staffProfileId: bar.rowId,
        startTime: newDate.toISOString(),
      })

      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Appointment moved')
      }
      refreshBars()
    },
    [selectedDate, refreshBars]
  )

  // Delete appointment from bar popover
  const handleDeleteAppointment = useCallback(
    async (barId: string) => {
      const isAppt = barId.startsWith('appt_')
      if (!isAppt) return

      const appointmentId = barId.replace('appt_', '')
      const result = await deleteAppointment(appointmentId)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Appointment deleted')
      }
      refreshBars()
    },
    [refreshBars]
  )

  const handleDeleteKarute = useCallback(
    async (karuteId: string) => {
      const result = await deleteKaruteRecord(karuteId)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Karute deleted')
      }
      refreshBars()
    },
    [refreshBars]
  )

  // Bar popover — show details + actions based on type
  const renderBarPopover = useCallback(
    (bar: TimelineBarItem) => {
      const isAppt = bar.id.startsWith('appt_')
      const appointmentId = isAppt ? bar.id.replace('appt_', '') : null
      const linkedAppt = appointmentId
        ? rawAppointments.find((a) => a.id === appointmentId)
        : null
      const karuteId = linkedAppt?.karute_record_id

      return (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">{bar.title}</p>
            {bar.subtitle && <p className="text-sm text-gray-700">{bar.subtitle}</p>}
          </div>
          <div className="flex flex-col gap-2">
            {/* View Karute — for completed appointments or standalone karute bars */}
            {karuteId && (
              <button
                type="button"
                onClick={() => router.push(`/karute/${karuteId}` as Parameters<typeof router.push>[0])}
                className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                View Karute
              </button>
            )}
            {!isAppt && (
              <button
                type="button"
                onClick={() => router.push(`/karute/${bar.id}` as Parameters<typeof router.push>[0])}
                className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                View Karute
              </button>
            )}
            {/* Delete karute — for standalone karute bars or completed appointments */}
            {karuteId && (
              <button
                type="button"
                onClick={() => handleDeleteKarute(karuteId)}
                className="w-full rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
              >
                Delete Karute
              </button>
            )}
            {!isAppt && (
              <button
                type="button"
                onClick={() => handleDeleteKarute(bar.id)}
                className="w-full rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
              >
                Delete Karute
              </button>
            )}
            {/* Delete appointment */}
            {isAppt && (
              <button
                type="button"
                onClick={() => handleDeleteAppointment(bar.id)}
                className="w-full rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
              >
                Delete Appointment
              </button>
            )}
          </div>
        </div>
      )
    },
    [router, handleDeleteAppointment, handleDeleteKarute, rawAppointments]
  )

  const timetableStaff = useMemo(
    () => staff.map((s) => ({ id: s.id, name: s.name, avatarInitials: s.avatarInitials, avatarSrc: s.avatarUrl })),
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
      {/* Timetable header */}
      <div className="relative flex items-center px-5 py-2.5">
        <span className="text-sm font-semibold text-foreground">{t('title')}</span>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <button type="button" onClick={handlePrevDay} className="rounded-md px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">&larr;</button>
          <span className="text-sm font-medium text-foreground">{formatDate(selectedDate, 'en')}</span>
          <button type="button" onClick={handleNextDay} className="rounded-md px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">&rarr;</button>
          <label className="relative rounded-md px-1.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
            <input
              type="date"
              value={toLocalDateStr(selectedDate)}
              onChange={(e) => { if (e.target.value) { setSelectedDate(new Date(e.target.value + 'T12:00:00')); setSlotClick(null) } }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </label>
          {!isToday && (
            <button type="button" onClick={handleToday} className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors">{t('today')}</button>
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
          onBarDragEnd={handleBarDragEnd}
          renderBarPopover={renderBarPopover}
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
