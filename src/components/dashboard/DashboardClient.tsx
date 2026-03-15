'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import { TimetableWithTabs } from '@/components/calendar/prototype-calendar-view'
import { RecordingPanel } from '@/components/dashboard/RecordingPanel'
import { useTimetableStore } from '@/stores/timetable-store'
import type { TimelineBarItem } from '@/components/calendar/prototype-calendar-view'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

interface StaffItem {
  id: string
  name: string
  avatarInitials: string
}

interface DashboardClientProps {
  staff: StaffItem[]
  activeStaffId: string | null
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

export function DashboardClient({ staff, activeStaffId, customers, locale }: DashboardClientProps) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const { minute: currentMinute, label: currentTimeLabel, date: today } = useCurrentTime()

  const searchParams = useSearchParams()
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [recordingOpen, setRecordingOpen] = useState(false)

  // Open recording panel when ?record=true is in URL (from sidebar Recording link)
  useEffect(() => {
    if (searchParams.get('record') === 'true' && !recordingOpen && activeStaffId) {
      setRecordingOpen(true)
      // Clean up URL without navigation
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [searchParams, recordingOpen, activeStaffId])

  const bars = useTimetableStore((s) => s.bars)
  const setBars = useTimetableStore((s) => s.setBars)
  const recordingBarId = useTimetableStore((s) => s.recordingBarId)

  const isToday = useMemo(() => {
    const now = new Date()
    return (
      selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate()
    )
  }, [selectedDate])

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
          activeRowId={activeStaffId ?? undefined}
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
