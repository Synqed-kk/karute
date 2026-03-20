'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EmployeeTimelineBar, type EmployeeTimelineBarData } from './employee-timeline-bar'

export interface TimetableTab {
  id: string
  label: string
  icon?: ReactNode
}

export interface TimetableEmployee {
  id: string
  name: string
  avatarInitials: string
  avatarSrc?: string
  segments: EmployeeTimelineBarData[]
}

export type TimetableStaffRow = Omit<TimetableEmployee, 'segments'>

export interface TimePassedOverlayProps {
  startMinute: number
  endMinute: number
  currentMinute: number
  leftOffsetPx?: number
  rightOffsetPx?: number
  className?: string
  style?: CSSProperties
}

export interface TimetableProps {
  tabs: TimetableTab[]
  activeTabId: string
  onTabChange?: (id: string) => void
  employees: TimetableEmployee[]
  onEmployeesChange?: (employees: TimetableEmployee[]) => void
  onTimeSlotClick?: (payload: { rowId: string; startMinute: number }) => void
  onBarDragEnd?: (payload: {
    bar: EmployeeTimelineBarData
    previousRowId: string
    previousStartMinute: number
  }) => void
  onBarClick?: (bar: EmployeeTimelineBarData) => void
  renderBarPopover?: (bar: EmployeeTimelineBarData) => ReactNode
  startHour?: number
  endHour?: number
  startMinute?: number
  endMinute?: number
  currentTimeLabel?: string
  currentMinute?: number
  rowHeight?: number
  snapMinutes?: number
  allowOverlap?: boolean
  customBody?: ReactNode
  showFrame?: boolean
  activeRowId?: string
  className?: string
}

const DEFAULT_ROW_HEIGHT = 84
const AVATAR_WIDTH = 78
const DRAG_THRESHOLD = 6

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const minutesToPercent = (value: number, startMinute: number, totalMinutes: number) =>
  ((value - startMinute) / totalMinutes) * 100
const intervalsOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd
const formatMinuteLabel = (minute: number) => {
  if (minute === 24 * 60) return '24:00'
  const hour = Math.floor(minute / 60)
  const min = minute % 60
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function TimePassedOverlay({
  startMinute,
  endMinute,
  currentMinute,
  leftOffsetPx = 0,
  rightOffsetPx = 0,
  className = '',
  style,
}: TimePassedOverlayProps) {
  const total = endMinute - startMinute
  const overlayWidth = clamp(minutesToPercent(currentMinute, startMinute, total), 0, 100)
  const usableWidth = `calc(100% - ${leftOffsetPx + rightOffsetPx}px)`

  return (
    <div
      className={`pointer-events-none absolute inset-y-0 left-0 bg-[#8a8f95]/46 ${className}`}
      style={{ ...style, left: `${leftOffsetPx}px`, width: `calc(${usableWidth} * ${overlayWidth / 100})` }}
      aria-hidden
    />
  )
}

// ============================================================================
// DRAG STATE
// ============================================================================

interface DragState {
  bar: EmployeeTimelineBarData
  originX: number
  originY: number
  activated: boolean
  targetRowId: string | null
  targetStartMinute: number | null
  valid: boolean
}

export function Timetable({
  tabs,
  activeTabId,
  onTabChange,
  employees,
  onEmployeesChange,
  onTimeSlotClick,
  onBarDragEnd,
  onBarClick,
  renderBarPopover,
  startHour = 10,
  endHour = 18,
  startMinute,
  endMinute,
  currentTimeLabel = '12:24',
  currentMinute = 12 * 60 + 24,
  rowHeight = DEFAULT_ROW_HEIGHT,
  snapMinutes = 60,
  allowOverlap = false,
  customBody,
  showFrame = true,
  activeRowId,
  className = '',
}: TimetableProps) {
  const [localEmployees, setLocalEmployees] = useState<TimetableEmployee[]>(employees)
  const [popoverBarId, setPopoverBarId] = useState<string | null>(null)

  const effectiveEmployees = onEmployeesChange ? employees : localEmployees
  const startMinuteVal = startMinute ?? startHour * 60
  const endMinuteVal = endMinute ?? endHour * 60
  const totalMinutes = endMinuteVal - startMinuteVal
  const maxSlotStart = Math.max(startMinuteVal, endMinuteVal - snapMinutes)
  const timelineContentHeight = effectiveEmployees.length * rowHeight
  const currentTimeLeft = clamp(minutesToPercent(currentMinute, startMinuteVal, totalMinutes), 0, 100)

  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)

  const hourMarkers = useMemo(() => {
    const list: number[] = []
    const firstHourMinute = Math.ceil(startMinuteVal / 60) * 60
    for (let minute = firstHourMinute; minute <= endMinuteVal; minute += 60) {
      list.push(minute)
    }
    return list
  }, [startMinuteVal, endMinuteVal])

  const slotStarts = useMemo(() => {
    const slots: number[] = []
    for (let minute = startMinuteVal; minute < endMinuteVal; minute += snapMinutes) slots.push(minute)
    return slots
  }, [startMinuteVal, endMinuteVal, snapMinutes])

  const canPlaceBar = useCallback((bar: EmployeeTimelineBarData, rowId: string, candidateStart: number) => {
    const candidateEnd = candidateStart + bar.durationMinute
    if (candidateStart < startMinuteVal || candidateEnd > endMinuteVal) return false
    if (allowOverlap) return true
    const row = effectiveEmployees.find((e) => e.id === rowId)
    if (!row) return false
    return !row.segments.some((item) => {
      if (item.id === bar.id) return false
      return intervalsOverlap(candidateStart, candidateEnd, item.startMinute, item.startMinute + item.durationMinute)
    })
  }, [effectiveEmployees, startMinuteVal, endMinuteVal, allowOverlap])

  const mouseToGrid = useCallback((clientX: number, clientY: number): { rowId: string; startMinute: number } | null => {
    if (!gridRef.current) return null
    const rect = gridRef.current.getBoundingClientRect()
    const relY = clientY - rect.top
    const rowIndex = Math.floor(relY / rowHeight)
    if (rowIndex < 0 || rowIndex >= effectiveEmployees.length) return null
    const rowId = effectiveEmployees[rowIndex].id

    const relX = clientX - rect.left
    const fraction = relX / rect.width
    const rawMinute = startMinuteVal + fraction * totalMinutes
    const snapped = Math.round((rawMinute - startMinuteVal) / snapMinutes) * snapMinutes + startMinuteVal
    const clampedMinute = clamp(snapped, startMinuteVal, maxSlotStart)

    return { rowId, startMinute: clampedMinute }
  }, [effectiveEmployees, rowHeight, startMinuteVal, totalMinutes, snapMinutes, maxSlotStart])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return

      if (!drag.activated) {
        const dx = e.clientX - drag.originX
        const dy = e.clientY - drag.originY
        if (Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return
        drag.activated = true
        setPopoverBarId(null)
      }

      const target = mouseToGrid(e.clientX, e.clientY)
      if (target) {
        drag.targetRowId = target.rowId
        drag.targetStartMinute = target.startMinute
        drag.valid = canPlaceBar(drag.bar, target.rowId, target.startMinute)
      }
      setDragState({ ...drag })
    }

    const handleMouseUp = () => {
      const drag = dragRef.current
      if (!drag) return

      if (drag.activated && drag.targetRowId && drag.targetStartMinute !== null) {
        const moved = drag.targetRowId !== drag.bar.rowId || drag.targetStartMinute !== drag.bar.startMinute
        if (moved && drag.valid) {
          onBarDragEnd?.({
            bar: { ...drag.bar, rowId: drag.targetRowId, startMinute: drag.targetStartMinute },
            previousRowId: drag.bar.rowId,
            previousStartMinute: drag.bar.startMinute,
          })
        }
      } else if (!drag.activated) {
        const clickable = drag.bar.type === 'booking' || drag.bar.type === 'open' || drag.bar.type === 'completed'
        if (onBarClick && clickable) {
          onBarClick(drag.bar)
        } else if (clickable && renderBarPopover) {
          setPopoverBarId((current) => (current === drag.bar.id ? null : drag.bar.id))
        }
      }

      dragRef.current = null
      setDragState(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [mouseToGrid, canPlaceBar, onBarDragEnd, onBarClick, renderBarPopover])

  const handleBarMouseDown = useCallback((e: React.MouseEvent, bar: EmployeeTimelineBarData) => {
    if (bar.type !== 'booking' && bar.type !== 'open' && bar.type !== 'completed') return
    e.preventDefault()
    dragRef.current = {
      bar,
      originX: e.clientX,
      originY: e.clientY,
      activated: false,
      targetRowId: null,
      targetStartMinute: null,
      valid: false,
    }
  }, [])

  const handleSlotClick = (rowId: string, slotStart: number, segments: EmployeeTimelineBarData[]) => {
    if (!onTimeSlotClick) return
    const slotEnd = slotStart + snapMinutes
    const isOccupied = segments.some((segment) => {
      const segmentEnd = segment.startMinute + segment.durationMinute
      return intervalsOverlap(slotStart, slotEnd, segment.startMinute, segmentEnd)
    })
    if (isOccupied) return
    setPopoverBarId(null)
    onTimeSlotClick({ rowId, startMinute: slotStart })
  }

  const isDragging = dragState?.activated === true
  const dragBarId = isDragging ? dragState.bar.id : null

  return (
    <section
      className={`relative overflow-hidden text-[#eef2f4] font-['Arial_Narrow','Franklin_Gothic_Medium','sans-serif'] ${
        showFrame ? 'rounded-[32px] border border-[#b4b0a7] bg-[#c9c6bd] p-7' : 'p-0'
      } flex h-full flex-col ${className}`}
    >
      <div className="relative flex w-full gap-[1px]">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange?.(tab.id)}
              className={`flex h-[44px] flex-1 items-center justify-center gap-2 rounded-t-2xl px-3 text-[16px] font-semibold transition ${
                active ? 'bg-gray-400/80 text-gray-800 dark:bg-gray-600 dark:text-white' : 'bg-gray-300/60 text-gray-600 hover:bg-gray-400/60 dark:bg-gray-700 dark:text-white/80 dark:hover:bg-gray-600'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="relative min-h-0 flex-1 bg-[#d5d5d5] dark:bg-[#444] p-2">
        <div className="relative flex h-full min-h-0 flex-col border border-gray-400/20 dark:border-white/10 bg-[#ccc] dark:bg-[#4a4a4a] p-1">
          {!customBody ? (
            <div className="relative h-[50px] border-b border-white/20">
              <div
                className="absolute top-[6px] text-[20px] font-semibold text-white/78"
                style={{ left: `calc(${AVATAR_WIDTH}px + (100% - ${AVATAR_WIDTH + 16}px) * ${currentTimeLeft / 100})`, transform: 'translateX(-50%)' }}
              >
                {currentTimeLabel}
              </div>
              <div className="absolute top-[6px] text-[20px] font-semibold text-white/78" style={{ left: `${AVATAR_WIDTH}px` }}>
                {formatMinuteLabel(startMinuteVal)}
              </div>
              <div className="absolute right-4 top-[6px] text-[20px] font-semibold text-white/82">
                {formatMinuteLabel(endMinuteVal)}
              </div>
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1" style={{ paddingBottom: customBody ? 0 : 'max(88px, 8vh)' }}>
            {customBody ? (
              <div className="relative z-10 h-full min-h-0 overflow-y-auto overflow-x-hidden p-4">{customBody}</div>
            ) : (
              <>
            <div className="pointer-events-none absolute top-0 bottom-0 right-4 z-10" style={{ left: `${AVATAR_WIDTH}px` }}>
              {hourMarkers.map((markerMinute) => {
                const left = minutesToPercent(markerMinute, startMinuteVal, totalMinutes)
                return (
                  <div
                    key={markerMinute}
                    className="absolute top-0 h-full w-px bg-white/50"
                    style={{ left: `${left}%` }}
                  />
                )
              })}
            </div>

            <div className={`relative ${popoverBarId ? 'z-30' : 'z-10'}`} ref={gridRef} style={{ marginLeft: `${AVATAR_WIDTH}px`, marginRight: '16px' }}>
              {effectiveEmployees.map((member) => {
                const isActiveRow = activeRowId === member.id
                return (
                <div key={member.id} className="relative border-b border-white/20 last:border-b-0" style={{ height: `${rowHeight}px` }}>
                  <div className={`absolute inset-y-0 left-0 right-0 rounded-[24px] ${
                    isActiveRow ? 'bg-[#d0dce0]' : 'bg-[#c3c9cd]'
                  }`} />

                  {slotStarts.map((slotStart) => {
                    const slotLeft = minutesToPercent(slotStart, startMinuteVal, totalMinutes)
                    const slotWidth = (snapMinutes / totalMinutes) * 100

                    const slotTimeLabel = `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`
                    return (
                      <button
                        key={`${member.id}-${slotStart}`}
                        type="button"
                        aria-label={`Create at ${slotTimeLabel} for ${member.name}`}
                        className="group absolute inset-y-0 z-20 rounded-[20px] border border-transparent bg-transparent transition-all hover:border-white/30 hover:bg-white/10"
                        style={{ left: `${slotLeft}%`, width: `${slotWidth}%` }}
                        onClick={() => handleSlotClick(member.id, slotStart, member.segments)}
                      >
                        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-medium text-white/0 group-hover:text-white/50 transition-colors">
                          {slotTimeLabel}
                        </span>
                      </button>
                    )
                  })}

                  {member.segments.map((item) => {
                    const left = minutesToPercent(item.startMinute, startMinuteVal, totalMinutes)
                    const width = (item.durationMinute / totalMinutes) * 100
                    const isBeingDragged = dragBarId === item.id
                    const isPopoverOpen = popoverBarId === item.id && !isDragging

                    return (
                      <div
                        key={item.id}
                        data-booking-segment="true"
                        className={`absolute inset-y-0 ${isPopoverOpen ? 'z-50' : 'z-30'} ${
                          isBeingDragged ? 'opacity-30' : ''
                        }`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                        }}
                        onMouseDown={(e) => handleBarMouseDown(e, item)}
                      >
                        <EmployeeTimelineBar
                          item={item}
                          className="cursor-pointer"
                        />
                        {renderBarPopover && (item.type === 'booking' || item.type === 'open' || item.type === 'completed') && isPopoverOpen ? (
                          <div
                            className="absolute left-1/2 top-full z-[60] mt-2 w-64 -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {renderBarPopover(item)}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}

                  {isDragging && dragState.targetRowId === member.id && dragState.targetStartMinute !== null ? (() => {
                    const tStart = dragState.targetStartMinute
                    const tEnd = tStart + dragState.bar.durationMinute
                    const timeLabel = `${String(Math.floor(tStart / 60)).padStart(2, '0')}:${String(tStart % 60).padStart(2, '0')} - ${String(Math.floor(tEnd / 60)).padStart(2, '0')}:${String(tEnd % 60).padStart(2, '0')}`
                    return (
                      <div
                        className={`pointer-events-none absolute inset-y-0 z-40 transition-[left] duration-100 ${
                          dragState.valid ? '' : 'opacity-40'
                        }`}
                        style={{
                          left: `${minutesToPercent(tStart, startMinuteVal, totalMinutes)}%`,
                          width: `${(dragState.bar.durationMinute / totalMinutes) * 100}%`,
                        }}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/75 px-2 py-0.5 text-xs font-semibold text-white shadow-lg">
                          {timeLabel}
                        </div>
                        <EmployeeTimelineBar
                          item={{ ...dragState.bar, rowId: member.id, startMinute: tStart }}
                          className={`shadow-xl ring-2 ${dragState.valid ? 'ring-white/70' : 'ring-red-400/70'}`}
                        />
                        {!dragState.valid ? (
                          <div className="pointer-events-none absolute inset-0 rounded-[24px] border-2 border-red-400/60 bg-red-500/10" />
                        ) : null}
                      </div>
                    )
                  })() : null}
                </div>
                )
              })}
            </div>

            <div className="pointer-events-none absolute top-0 left-0 z-30" style={{ width: `${AVATAR_WIDTH}px` }}>
              {effectiveEmployees.map((member) => {
                const isActiveRow = activeRowId === member.id
                return (
                <div key={member.id} className="relative" style={{ height: `${rowHeight}px` }}>
                  <div className="absolute left-0 top-1/2 -translate-y-1/2">
                    <div className={`h-[78px] w-[78px] overflow-hidden rounded-[24px] border bg-[#f5f6f8] text-[#4f5962] ${
                      isActiveRow ? 'border-gray-400' : 'border-white/70'
                    }`}>
                      <div className="h-[56px] bg-gradient-to-br from-[#f7f7f7] to-[#dadde3]">
                        {member.avatarSrc ? (
                          <img src={member.avatarSrc} alt={member.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-3xl font-semibold">{member.avatarInitials}</div>
                        )}
                      </div>
                      <div className="bg-white/78 px-1 text-center text-[14px] font-semibold leading-5 text-[#5b6268]">{member.name}</div>
                    </div>
                  </div>
                </div>
                )
              })}
            </div>

            <TimePassedOverlay
              startMinute={startMinuteVal}
              endMinute={endMinuteVal}
              currentMinute={currentMinute}
              leftOffsetPx={AVATAR_WIDTH}
              rightOffsetPx={16}
              className="z-20 rounded-r-[24px]"
              style={{ height: `${timelineContentHeight}px` }}
            />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Click-outside dismiss for popover */}
      {popoverBarId && (
        <div className="fixed inset-0 z-[25]" onClick={() => setPopoverBarId(null)} />
      )}
    </section>
  )
}
