'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { TimetableWithTabs } from '@/components/calendar/prototype-calendar-view'
import { RecordingPanel } from '@/components/dashboard/RecordingPanel'
import { useTimetableStore } from '@/stores/timetable-store'
import { useRecordingUIStore } from '@/stores/recording-store'
import { getBarsByDate } from '@/actions/dashboard'
import type { TimelineBarItem } from '@/components/calendar/prototype-calendar-view'
import type { TimelineBar } from '@/stores/timetable-store'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

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

export function DashboardClient({ staff, activeStaffId, authProfileId, customers, locale }: DashboardClientProps) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const { minute: currentMinute, label: currentTimeLabel, date: today } = useCurrentTime()

  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [recordingOpen, setRecordingOpen] = useState(false)

  // Listen for recording panel open signal from sidebar
  const shouldOpenPanel = useRecordingUIStore((s) => s.shouldOpenPanel)
  const clearOpenRequest = useRecordingUIStore((s) => s.clearOpenRequest)

  useEffect(() => {
    if (shouldOpenPanel && !recordingOpen && activeStaffId) {
      setRecordingOpen(true)
      clearOpenRequest()
    }
  }, [shouldOpenPanel, recordingOpen, activeStaffId, clearOpenRequest])

  // In-progress recording bars from zustand (temp rec_* bars)
  const liveBars = useTimetableStore((s) => s.bars)
  const setBars = useTimetableStore((s) => s.setBars)
  const recordingBarId = useTimetableStore((s) => s.recordingBarId)

  // Saved karute records as timeline bars (fetched from DB by date)
  const [savedBars, setSavedBars] = useState<TimelineBar[]>([])

  const isToday = useMemo(() => {
    const now = new Date()
    return (
      selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate()
    )
  }, [selectedDate])

  // Fetch saved bars when date changes
  useEffect(() => {
    const dateStr = selectedDate.toISOString().split('T')[0]
    getBarsByDate(dateStr).then((dbBars) => {
      setSavedBars(
        dbBars.map((b) => ({
          id: b.id,
          rowId: b.staffId,
          startMinute: b.startMinute,
          durationMinute: b.durationMinute,
          title: b.title,
          subtitle: b.subtitle,
          type: 'booking' as const,
        }))
      )
    })
  }, [selectedDate])

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
  }

  const handleNextDay = () => {
    setSelectedDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      return next
    })
  }

  const handleToday = () => setSelectedDate(new Date())

  const handleBarClick = useCallback(
    (bar: TimelineBarItem) => {
      // Only navigate for real persisted bars — temp IDs (rec_*) have no karute record
      if (bar.type === 'booking' && !bar.id.startsWith('rec_')) {
        router.push(`/karute/${bar.id}` as Parameters<typeof router.push>[0])
      }
    },
    [router]
  )

  const handleCloseRecording = () => {
    setRecordingOpen(false)
    // Refresh saved bars in case a new karute was saved
    const dateStr = selectedDate.toISOString().split('T')[0]
    getBarsByDate(dateStr).then((dbBars) => {
      setSavedBars(
        dbBars.map((b) => ({
          id: b.id,
          rowId: b.staffId,
          startMinute: b.startMinute,
          durationMinute: b.durationMinute,
          title: b.title,
          subtitle: b.subtitle,
          type: 'booking' as const,
        }))
      )
    })
  }

  const timetableStaff = useMemo(
    () => staff.map((s) => ({ id: s.id, name: s.name, avatarInitials: s.avatarInitials })),
    [staff]
  )

  const tabs = useMemo(() => [{ id: 'dashboard', label: t('title') }], [t])

  return (
    <>
      {/* Date navigation */}
      <div className="flex items-center mb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePrevDay}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            &larr;
          </button>
          <span className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            {formatDate(selectedDate, 'en')}
          </span>
          <button
            type="button"
            onClick={handleNextDay}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            &rarr;
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={handleToday}
              className="rounded-lg bg-[#84a2aa] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#6d8d96]"
            >
              {t('today')}
            </button>
          )}
        </div>
      </div>

      {/* Timetable */}
      <div className="min-h-0 flex-1" style={{ minHeight: `${staff.length * 84 + 100}px` }}>
        <TimetableWithTabs
          tabs={tabs}
          activeTabId="dashboard"
          staff={timetableStaff}
          bars={bars}
          onBarsChange={setBars}
          onBarClick={handleBarClick}
          startHour={10}
          endHour={24}
          currentTimeLabel={isToday ? currentTimeLabel : ''}
          currentMinute={isToday ? currentMinute : 0}
          activeRowId={authProfileId ?? activeStaffId ?? undefined}
        />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4 pb-2 mt-4">
        <div className="rounded-2xl bg-[#7d9ea7] p-4 text-white">
          <div className="text-3xl font-bold">0</div>
          <div className="text-sm opacity-90">{t('customersServed')}</div>
        </div>
        <div className="rounded-2xl bg-[#c4888e] p-4 text-white">
          <div className="text-3xl font-bold">0</div>
          <div className="text-sm opacity-90">{t('recordingsThisWeek')}</div>
        </div>
        <div className="rounded-2xl bg-[#5a9a6e] p-4 text-white">
          <div className="text-3xl font-bold">0</div>
          <div className="text-sm opacity-90">{t('karuteGenerated')}</div>
        </div>
      </div>

      {/* Recording panel overlay — slides from left (next to sidebar) */}
      {recordingOpen && activeStaffId && (
        <RecordingPanel
          activeStaffId={activeStaffId}
          customers={customers}
          locale={locale}
          onClose={handleCloseRecording}
        />
      )}
    </>
  )
}
