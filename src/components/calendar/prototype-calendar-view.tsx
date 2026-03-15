'use client'

import { useMemo, type ReactNode } from 'react'
import { type EmployeeTimelineBarData } from '@/components/ui/employee-timeline-bar'
import { Timetable, type TimetableEmployee, type TimetableTab } from '@/components/ui/timetable'

export interface TopTabItem {
  id: string
  label: string
  icon?: ReactNode
}

export interface TimelineStaff {
  id: string
  name: string
  avatarInitials: string
  avatarSrc?: string
}

export type TimelineBarType = 'booking' | 'open' | 'blocked' | 'recording' | 'processing'

export interface TimelineBarItem {
  id: string
  rowId: string
  startMinute: number
  durationMinute: number
  title: string
  subtitle?: string
  type: TimelineBarType
}

export interface TimetableWithTabsProps {
  tabs: TopTabItem[]
  activeTabId: string
  onTabChange?: (id: string) => void
  staff: TimelineStaff[]
  bars: TimelineBarItem[]
  onBarsChange?: (bars: TimelineBarItem[]) => void
  onTimeSlotClick?: (payload: { rowId: string; startMinute: number }) => void
  onBarDragEnd?: (payload: {
    bar: TimelineBarItem
    previousRowId: string
    previousStartMinute: number
  }) => void
  onBarClick?: (bar: TimelineBarItem) => void
  renderBarPopover?: (bar: TimelineBarItem) => ReactNode
  startHour?: number
  endHour?: number
  currentTimeLabel?: string
  currentMinute?: number
  rowHeight?: number
  activeRowId?: string
  className?: string
}

export function TimetableWithTabs({
  tabs,
  activeTabId,
  onTabChange,
  staff,
  bars,
  onBarsChange,
  onTimeSlotClick,
  onBarDragEnd,
  onBarClick,
  renderBarPopover,
  startHour = 10,
  endHour = 18,
  currentTimeLabel = '12:24',
  currentMinute = 12 * 60 + 24,
  rowHeight = 84,
  activeRowId,
  className = '',
}: TimetableWithTabsProps) {
  const mappedTabs: TimetableTab[] = useMemo(
    () => tabs.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon })),
    [tabs]
  )

  const mappedEmployees: TimetableEmployee[] = useMemo(
    () =>
      staff.map((member) => ({
        ...member,
        segments: bars.filter((bar) => bar.rowId === member.id),
      })),
    [staff, bars]
  )

  const handleEmployeesChange = (employees: TimetableEmployee[]) => {
    if (!onBarsChange) return
    const nextBars = employees
      .flatMap((employee) => employee.segments.map((segment) => ({ ...segment, rowId: employee.id })))
      .sort((a, b) => a.startMinute - b.startMinute)
    onBarsChange(nextBars)
  }

  return (
    <Timetable
      tabs={mappedTabs}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      employees={mappedEmployees}
      onEmployeesChange={onBarsChange ? handleEmployeesChange : undefined}
      onTimeSlotClick={onTimeSlotClick}
      onBarDragEnd={onBarDragEnd}
      onBarClick={onBarClick}
      renderBarPopover={renderBarPopover}
      startHour={startHour}
      endHour={endHour}
      currentTimeLabel={currentTimeLabel}
      currentMinute={currentMinute}
      rowHeight={rowHeight}
      snapMinutes={60}
      allowOverlap={false}
      showFrame={false}
      activeRowId={activeRowId}
      className={`h-full min-h-0 flex-1 ${className}`}
    />
  )
}

export type { EmployeeTimelineBarData as TimelineBarData }
export type { TimetableEmployee }
